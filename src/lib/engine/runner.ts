import { store } from "../store";
import { cleanSurface } from "../brand_key";
import { tagCosts, withCostContext } from "../cost_log";
import {
  coderUsageAccumulator,
  CoderUnavailableError,
  completeWithEngine,
  engineAvailable,
  extractCodingConsensus,
  getEngine,
} from "./providers";
import { analyzePromptHealth } from "./prompt_health";
import { classifyNonBrands } from "./suggest";
import { getDictionarySuggestions } from "./dict_suggest";
import { prewarmDictionaryExamples } from "./dict_examples";
import { batchableEngine, hasOpenBatches, pollRunBatches } from "./batch";
import { bootstrapRunChunk } from "./bootstrap";

// Sized when a run sampled one engine from one vendor. A six-engine panel
// spreads across four vendors, so 4 global slots left each vendor running
// roughly one request at a time while the rest of the run waited.
// A 420-answer run is ~121 minutes of API time (search engines take 20-27s
// per answer because they genuinely browse). Wall-clock is that divided by
// how many run at once, so this number IS the run duration. 32 lands near
// four minutes; raise it if the vendors tolerate more, but watch for 429s —
// retries make an over-subscribed run slower, not faster.
const CONCURRENCY = Number(process.env.RUN_CONCURRENCY ?? 64);

// Collection runs one worker pool PER VENDOR, sized to what each vendor's
// rate limits actually tolerate (measured on the jira battery: OpenAI and
// Anthropic take heavy concurrency; Gemini and Perplexity 429 well before
// 48). A shared pool made every vendor run at the timid common denominator
// and let one throttled vendor drag the whole run.
const VENDOR_CONCURRENCY: Record<string, number> = {
  OpenAI: Number(process.env.RUN_CONCURRENCY_OPENAI ?? 64),
  Anthropic: Number(process.env.RUN_CONCURRENCY_ANTHROPIC ?? 48),
  Google: Number(process.env.RUN_CONCURRENCY_GOOGLE ?? 16),
  xAI: Number(process.env.RUN_CONCURRENCY_XAI ?? 24),
  Perplexity: Number(process.env.RUN_CONCURRENCY_PERPLEXITY ?? 8),
};

// Circuit breaker: an engine failing this many times in a chunk with zero
// successes is parked for the REST OF THE CHUNK (its tasks stay pending and
// retry fresh next chunk). A depleted billing account or dead key burns
// hundreds of doomed attempts otherwise - the jira shakedown burned ~800
// against Gemini's drained prepaid credits.
const BREAKER_THRESHOLD = 12;

// Serverless functions cap at maxDuration=300s; leave headroom for in-flight
// completions to finish and the chain handoff to fire.
export const VERCEL_CHUNK_BUDGET_MS = 220_000;

interface Task {
  promptId: string;
  promptText: string;
  repeatIdx: number;
  /** Which engine answers this task — the third axis of the grid. */
  model: string;
}

export type ChunkOutcome =
  | "complete"
  | "continue"
  | "failed"
  | "finalize"
  /** Batch-pipeline run with vendor batches still out: nothing to do live
   * right now; the batch poller resumes the run. */
  | "waiting"
  /** Coder outage during the coding wave: collection is safe under status
   * "collected"; the chain stops and coding resumes on the next drive. */
  | "coding_blocked"
  /** Init bootstrap finished (or held): the run sits at "collected" waiting
   * on a human gate - nothing more to drive until a confirmation. */
  | "gated";

/**
 * Process as much of a run as fits in budgetMs, then report whether work
 * remains. Tasks are (prompt × repeat × engine) triples; already-stored
 * responses are skipped, so a chunk can resume a run that a killed function
 * left behind. Answers come from each engine; coding always comes from the
 * one fixed extraction model, so engine differences are real differences.
 */
export async function driveRunChunk(
  runId: string,
  budgetMs: number
): Promise<ChunkOutcome> {
  const run = await store.getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status === "complete" || run.status === "failed") return run.status;
  const project = await store.getProject(run.project_id);
  if (!project) throw new Error(`project ${run.project_id} not found`);
  const prompts = (await store.listPrompts(project.id)).filter(
    (p) => !p.retired
  );
  const knownBrands = [project.brand, ...project.competitors];
  const extractionCtx = {
    targetBrand: project.brand,
    knownBrands,
    reasonCodes: project.reason_taxonomy,
  };
  tagCosts({ projectId: project.id, runId });

  // Engines whose vendor key is missing would fail every task; drop them and
  // measure what we can rather than failing the whole run.
  let engines = (run.models.length > 0 ? run.models : [run.model]).filter(
    (m) => engineAvailable(m)
  );

  if (run.status === "pending") {
    // Preflight: one probe answer per engine BEFORE thousands of calls -
    // a drained billing account or revoked key costs one failed cent here
    // instead of a chunk of doomed retries. Failed engines are dropped for
    // the whole run, named in the run note.
    const probes = await Promise.all(
      engines.map(async (m) => {
        try {
          await withCostContext({ purpose: "run:preflight" }, () =>
            completeWithEngine(m, "Reply with the single word: ok")
          );
          return { m, ok: true as const };
        } catch (err) {
          console.error(`preflight failed for ${m}:`, err);
          return { m, ok: false as const };
        }
      })
    );
    const dead = probes.filter((p) => !p.ok).map((p) => p.m);
    if (dead.length > 0) {
      engines = engines.filter((m) => !dead.includes(m));
      await store.updateRunStatus(
        runId,
        "running",
        `engine(s) failed preflight and were skipped: ${dead.join(", ")}`
      );
    } else {
      await store.updateRunStatus(runId, "running");
    }
  } else if (run.error?.startsWith("engine(s) failed preflight")) {
    // Later chunks honor the first chunk's verdict instead of re-probing.
    const dead = run.error
      .slice(run.error.indexOf(":") + 1)
      .split(",")
      .map((x) => x.trim());
    engines = engines.filter((m) => !dead.includes(m));
  }
  if (engines.length === 0) {
    await store.updateRunStatus(
      runId,
      "failed",
      `no API key configured for any requested engine (${run.models.join(", ")})`
    );
    return "failed";
  }

  // Batch-pipeline runs: while vendor batches are out, the live driver only
  // collects the engines batches can't cover; the mop-up (any batch lines
  // that failed) happens live once every batch is terminal.
  const batchesOpen = run.pipeline === "batch" && (await hasOpenBatches(runId));
  if (batchesOpen) {
    engines = engines.filter((m) => !batchableEngine(m));
  }

  const doneKeys = new Set(
    (await store.listResponses(runId)).map(
      (r) => `${r.prompt_id}:${r.repeat_idx}:${r.model}`
    )
  );
  const total = prompts.length * run.repeats * engines.length;
  const pending: Task[] = [];
  for (const p of prompts) {
    for (let r = 0; r < run.repeats; r++) {
      for (const model of engines) {
        if (!doneKeys.has(`${p.id}:${r}:${model}`)) {
          pending.push({
            promptId: p.id,
            promptText: p.text,
            repeatIdx: r,
            model,
          });
        }
      }
    }
  }

  if (pending.length === 0) {
    if (batchesOpen) return "waiting";
    // First-run pipeline: while the taxonomy is unratified there is nothing
    // to code against - the run owes the discovery bootstrap instead, and is
    // told "collected" only once the codebook proposal and brand
    // observations are ready for their gates.
    if ((project.taxonomy_status ?? "pending") !== "ratified") {
      return bootstrapRunChunk(runId, project, Date.now() + budgetMs);
    }
    return codeCollectedChunk(runId, run.status, project.id, extractionCtx, Date.now() + budgetMs, {
      expected: total,
    });
  }
  if (engines.length === 0) return "waiting";

  const deadline = Date.now() + budgetMs;
  let inserted = 0;

  // Collection stores answers UNCODED (coding null): the text is the
  // expensive, irreplaceable half, and a coder outage must never cost
  // collection budget. The coding wave runs once collection is complete.
  // Per-vendor queues so each vendor runs at its own ceiling.
  const byVendor = new Map<string, Task[]>();
  for (const task of pending) {
    const vendor = getEngine(task.model)?.vendor ?? "OpenAI";
    (byVendor.get(vendor) ?? byVendor.set(vendor, []).get(vendor)!).push(task);
  }
  // Circuit breaker state, per engine, per chunk.
  const failStreak = new Map<string, number>();
  const succeeded = new Set<string>();
  const parked = new Set<string>();

  async function collectFrom(queue: Task[], cursorBox: { i: number }): Promise<void> {
    while (cursorBox.i < queue.length && Date.now() < deadline) {
      const task = queue[cursorBox.i++];
      if (parked.has(task.model)) continue;
      try {
        const { text, finishReason, citations, searchCount, usage } = await withCostContext(
          { purpose: "run:answer" },
          () => completeWithEngine(task.model, task.promptText)
        );
        // An empty answer is a failed collection, not a datum - storing it
        // would waste a coding pass and pollute metrics.
        if (!text.trim()) throw new Error("empty answer");
        await store.insertResponse({
          runId,
          promptId: task.promptId,
          repeatIdx: task.repeatIdx,
          model: task.model,
          finishReason,
          citations,
          coderModel: null,
          searchCount,
          inputTokens: usage.input,
          outputTokens: usage.output,
          text,
          mentions: [],
          coding: null,
        });
        inserted++;
        succeeded.add(task.model);
        failStreak.set(task.model, 0);
      } catch (err) {
        const streak = (failStreak.get(task.model) ?? 0) + 1;
        failStreak.set(task.model, streak);
        if (streak >= BREAKER_THRESHOLD && !succeeded.has(task.model)) {
          parked.add(task.model);
          console.error(
            `procerno run ${runId}: parked ${task.model} for this chunk after ${streak} straight failures`
          );
        }
        console.error(`procerno run ${runId} task failed:`, err);
      }
    }
  }

  await Promise.all(
    [...byVendor.entries()].flatMap(([vendor, queue]) => {
      const cursorBox = { i: 0 };
      const size = Math.min(VENDOR_CONCURRENCY[vendor] ?? 16, queue.length);
      return Array.from({ length: size }, () => collectFrom(queue, cursorBox));
    })
  );

  const remaining = pending.length - inserted;
  if (remaining === 0 && batchesOpen) return "waiting";
  if (remaining === 0) {
    // Collection is done; the coding wave (next chunk, fresh budget) takes
    // over, and finalize (dictionary, prompt health) follows it.
    return "continue";
  }
  if (inserted > 0) return "continue";
  if (batchesOpen) return "waiting";
  // A full chunk with zero progress: either every request errors (bad key,
  // bad model) or only permanently-failing tasks remain.
  const doneCount = total - remaining;
  if (doneCount > 0) {
    await store.updateRunStatus(
      runId,
      "complete",
      `${remaining}/${total} requests failed`
    );
    return "complete";
  }
  await store.updateRunStatus(
    runId,
    "failed",
    "every request failed — check API key and model"
  );
  return "failed";
}

/** Both store drivers emit UTC; sqlite omits the T and Z. */
function utcMs(ts: string): number {
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z").getTime();
}

/**
 * Auto-resume sweep: non-terminal runs with no open vendor batches and no
 * stored progress for `staleMs` are orphans - a died driver process, a
 * dropped chunk hop - and get re-driven by the caller. Held runs
 * (RUN_COLLECT_ONLY + collected) are parked on purpose, not stalled.
 */
export async function findStalledRuns(staleMs = 45 * 60 * 1000): Promise<string[]> {
  const stalled: string[] = [];
  const cutoff = Date.now() - staleMs;
  for (const project of await store.listProjects()) {
    for (const run of await store.listRuns(project.id)) {
      if (!["pending", "running", "collected"].includes(run.status)) continue;
      if (run.status === "collected" && process.env.RUN_COLLECT_ONLY) continue;
      if (run.pipeline === "batch" && (await hasOpenBatches(run.id))) continue;
      const latest = await store.latestResponseAt(run.id);
      const lastActivity = latest ? utcMs(latest) : utcMs(run.created_at);
      if (lastActivity < cutoff) stalled.push(run.id);
    }
  }
  return stalled;
}

/** Local driver: chunk in-process until the run reaches a terminal state. */
/**
 * Re-code a run's stored answers without touching the vendors that produced
 * them. The text is already on disk and coding is a pure function of it, so a
 * coder change can be applied to existing data — and, more usefully, measured
 * against it: re-coding holds the answers constant, so any difference is the
 * coder change alone rather than the assistants having drifted that day.
 *
 * Costs roughly a third of a full run and takes well under a minute, since no
 * search engines are in the loop.
 */
export async function recodeRun(runId: string): Promise<number> {
  const run = await store.getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  const project = await store.getProject(run.project_id);
  if (!project) throw new Error(`project ${run.project_id} not found`);
  const ctx = {
    targetBrand: project.brand,
    knownBrands: [project.brand, ...project.competitors],
    reasonCodes: project.reason_taxonomy,
  };
  tagCosts({ projectId: project.id, runId, purpose: "run:recode" });
  const responses = await store.listResponses(runId);
  let cursor = 0;
  let recoded = 0;
  // Holder object: a plain `let` assigned only inside the worker closure
  // gets narrowed to `never` by control-flow analysis.
  const outage: { err: CoderUnavailableError | null } = { err: null };
  async function worker(): Promise<void> {
    while (cursor < responses.length) {
      const r = responses[cursor++];
      try {
        // Seeded from the stored usage: a re-code ADDS to the answer's coder
        // spend - the first pass's tokens were still bought.
        const meter = coderUsageAccumulator(r.coder_usage);
        const coding = await extractCodingConsensus(r.text, {
          ...ctx,
          usageSink: meter.sink,
        });
        await store.writeResponseCoding(
          r.id,
          coding,
          coding.coderProvenance,
          coding.mentions,
          meter.usage
        );
        recoded++;
      } catch (err) {
        if (err instanceof CoderUnavailableError) {
          outage.err = err;
          cursor = responses.length;
          return;
        }
        // One answer failing keeps its previous coding rather than losing it.
        console.error(`recode of response ${r.id} failed:`, err);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, responses.length) }, worker)
  );
  if (outage.err) {
    // Loud: a partially re-coded run is worse than an un-re-coded one, so the
    // caller has to know rather than read it off a provenance column later.
    throw new CoderUnavailableError(
      `${outage.err.message} Re-code stopped after ${recoded} of ${responses.length} answers.`
    );
  }
  console.log(`recoded ${recoded}/${responses.length} answers for run ${runId}`);
  return recoded;
}

/**
 * Everything a run owes after its last answer lands: unmatched names into the
 * dictionary queue, the junk filter, the pre-computed Identify suggestions,
 * and the prompt health check. The run stays "running" throughout — the
 * dashboard reads that as its "Analyzing answers" stage — and is marked
 * complete only once this finishes, so a reader never opens a finished run
 * onto an empty dictionary or a health check that has not happened yet.
 *
 * Every step is individually guarded and the run is completed regardless: a
 * failure here must not strand a run with 420 good answers in "running".
 */
/**
 * The coding wave: code every uncoded stored answer, within budget. Runs
 * only after collection is complete - the collected text is the asset, and
 * a coder outage here parks the run at "collected" (data safe, coding
 * resumes on the next drive) instead of failing it.
 */
/** finish_reason values that mean the answer hit an output cap. */
const TRUNCATED_FINISH = new Set(["max_tokens", "length", "max_output_tokens"]);
/** Retry cap for truncated answers - and the self-limit: a row that
 * already produced more output than RETRY_SKIP_OUTPUT was a high-cap retry
 * that still maxed out, so it is kept as-is rather than retried forever. */
const TRUNCATION_RETRY_CAP = 16_384;
const RETRY_SKIP_OUTPUT = 12_000;

async function codeCollectedChunk(
  runId: string,
  status: string,
  projectId: string,
  ctx: { targetBrand: string; knownBrands: string[]; reasonCodes: string[] },
  deadline: number,
  health: { expected: number }
): Promise<ChunkOutcome> {
  const responses = await store.listResponses(runId);
  const uncoded = responses.filter((r) => !r.coder_model && !r.outcome);

  // Operational hold: with RUN_COLLECT_ONLY set, runs park at "collected"
  // and never spend a coding cent - used while the coder question (solo vs
  // consensus vs fast) is unsettled. Clear the env and hit /continue to
  // code a held run.
  if (process.env.RUN_COLLECT_ONLY && uncoded.length > 0) {
    await store.updateRunStatus(
      runId,
      "collected",
      "collect-only hold (RUN_COLLECT_ONLY): coding deferred"
    );
    return "coding_blocked";
  }

  // Recollect truncated answers at a higher cap BEFORE any coding spend:
  // coding a cut-off answer measures our cap, not the assistant.
  const retryable = uncoded.filter(
    (r) =>
      TRUNCATED_FINISH.has(r.finish_reason ?? "") &&
      (r.output_tokens ?? 0) < RETRY_SKIP_OUTPUT
  );
  let recollected = 0;
  if (retryable.length > 0) {
    const promptText = new Map(
      (await store.listPrompts(projectId)).map((p) => [p.id, p.text])
    );
    for (const r of retryable) {
      if (Date.now() >= deadline) break;
      const text = promptText.get(r.prompt_id);
      if (!text) continue;
      try {
        const fresh = await withCostContext({ purpose: "run:truncation_retry" }, () =>
          // A 16K generation can outrun the client's default deadline, so
          // the retry also carries a longer per-request timeout.
          completeWithEngine(r.model, text, {
            maxTokens: TRUNCATION_RETRY_CAP,
            timeoutMs: 240_000,
          })
        );
        if (!fresh.text.trim()) continue;
        // Keep the longer read: a retry that truncated even higher is
        // still more of the answer than we had.
        if (fresh.text.length >= r.text.length) {
          await store.replaceResponseAnswer(r.id, {
            text: fresh.text,
            finishReason: fresh.finishReason,
            citations: fresh.citations,
            searchCount: fresh.searchCount,
            inputTokens: fresh.usage.input,
            outputTokens: fresh.usage.output,
          });
          r.text = fresh.text;
          r.finish_reason = fresh.finishReason;
          r.output_tokens = fresh.usage.output;
          recollected++;
        }
      } catch (err) {
        console.error(`truncation retry failed for response ${r.id}:`, err);
      }
    }
    // Budget died mid-recollect: resume it next chunk before coding starts.
    const stillPending = retryable.some(
      (r) =>
        TRUNCATED_FINISH.has(r.finish_reason ?? "") &&
        (r.output_tokens ?? 0) < RETRY_SKIP_OUTPUT
    );
    if (stillPending && Date.now() >= deadline) return "continue";
  }

  if (status !== "collected" && uncoded.length > 0) {
    // Health gate at the wave boundary: how much of the grid actually
    // arrived - and in what shape - is recorded before a coding cent is
    // spent.
    const truncated = responses.filter((r) =>
      TRUNCATED_FINISH.has(r.finish_reason ?? "")
    ).length;
    const parts: string[] = [];
    if (responses.length < health.expected) {
      parts.push(`collected ${responses.length}/${health.expected} answers`);
    }
    if (truncated > 0 || recollected > 0) {
      parts.push(`${truncated} truncated, ${recollected} recollected at a higher cap`);
    }
    await store.updateRunStatus(
      runId,
      "collected",
      parts.length > 0 ? parts.join("; ") : undefined
    );
  }
  if (uncoded.length === 0) return "finalize";

  let cursor = 0;
  let coded = 0;
  const outage: { err: CoderUnavailableError | null } = { err: null };
  async function worker(): Promise<void> {
    while (cursor < uncoded.length && Date.now() < deadline && !outage.err) {
      const r = uncoded[cursor++];
      try {
        const meter = coderUsageAccumulator(r.coder_usage);
        const coding = await withCostContext({ purpose: "run:coder" }, () =>
          extractCodingConsensus(r.text, { ...ctx, usageSink: meter.sink })
        );
        await store.writeResponseCoding(
          r.id,
          coding,
          coding.coderProvenance,
          coding.mentions,
          meter.usage
        );
        coded++;
      } catch (err) {
        if (err instanceof CoderUnavailableError) {
          outage.err = err;
          return;
        }
        console.error(`coding of response ${r.id} failed:`, err);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, uncoded.length) }, worker)
  );
  if (outage.err) {
    await store.updateRunStatus(runId, "collected", outage.err.message);
    console.error(`procerno run ${runId} coding halted: ${outage.err.message}`);
    return "coding_blocked";
  }
  return coded < uncoded.length ? "continue" : "finalize";
}

/** Scheduled-run contract: a run is marked "complete" - the user's "run
 * finished" signal - only after collection, the coding wave, and everything
 * here (new-name dictionary triggers, junk filter, pre-warmed suggestions,
 * prompt health) have finished. Future codebook triggers (drift detection on
 * a ratified taxonomy) belong in this function, before the status flip. */
export async function finalizeRun(runId: string): Promise<void> {
  const run = await store.getRun(runId);
  if (!run || run.status === "complete" || run.status === "failed") return;
  const project = await store.getProject(run.project_id);
  if (!project) return;
  tagCosts({ projectId: project.id, runId, purpose: "run:finalize" });
  try {
    const [runMentions, runResponses] = await Promise.all([
      store.listMentionsForRun(runId),
      store.listResponses(runId),
    ]);
    // cleanSurface, same as the observations queue path - a mention's "®"
    // or doubled spaces must not become part of a pill's name.
    await store.queueDictionaryCandidates(project.id, [
      ...new Set(
        [
          ...runMentions.map((m) => m.brand),
          ...runResponses
            .map((r) => r.top_pick_brand)
            .filter((b): b is string => Boolean(b)),
        ].map(cleanSurface)
      ),
    ]);
    const dict = await store.getDictionary(project.id);
    const pendingEntries = dict.filter((e) => e.status === "pending");
    if (pendingEntries.length > 0) {
      const nonBrands = await classifyNonBrands(
        pendingEntries.map((e) => e.canonical)
      );
      let excluded = 0;
      for (const e of pendingEntries) {
        if (nonBrands.has(e.canonical.trim().toLowerCase())) {
          await store.upsertDictionaryEntry({
            id: e.id,
            projectId: project.id,
            canonical: e.canonical,
            aliases: e.aliases,
            status: "rejected",
          });
          excluded++;
        }
      }
      if (excluded > 0) {
        await store.bumpDictionaryVersion(project.id);
        console.log(
          `dictionary junk filter: pre-excluded ${excluded} non-brand name(s)`
        );
      }
    }
    const suggestions = await getDictionarySuggestions(
      project.id,
      project.category
    );
    // Same review-phase contract as the bootstrap: every flagged pill's
    // examples are warm before the run reads "complete". Cache-first, so a
    // warm project pays one batch read; soft 2-minute budget.
    await prewarmDictionaryExamples(
      project.id,
      suggestions,
      Date.now() + 120_000
    );
  } catch (err) {
    console.error("dictionary finalize failed:", err);
  }
  try {
    await analyzePromptHealth(project.id, runId);
  } catch (err) {
    console.error("prompt health check failed:", err);
  }
  await store.updateRunStatus(runId, "complete", null);
}

export function runInBackground(runId: string): Promise<void> {
  return (async () => {
    let outcome = await driveRunChunk(runId, 7 * 24 * 3600 * 1000);
    while (outcome === "continue" || outcome === "waiting") {
      if (outcome === "waiting") {
        // Local driver doubles as the batch poller.
        const { open } = await pollRunBatches(runId);
        if (open > 0) await new Promise((r) => setTimeout(r, 60_000));
      }
      // loop — retries tasks that failed transiently
      outcome = await driveRunChunk(runId, 7 * 24 * 3600 * 1000);
    }
    if (outcome === "finalize") await finalizeRun(runId);
  })().catch(async (err) => {
    console.error(`procerno run ${runId} crashed:`, err);
    await store.updateRunStatus(runId, "failed", String(err));
  });
}

/**
 * Serverless driver: process one budgeted chunk, then hand the rest to a
 * fresh invocation via the run's /continue endpoint so no single function
 * has to outlive maxDuration.
 */
export async function driveAndChain(
  runId: string,
  origin: string
): Promise<void> {
  try {
    const outcome = await driveRunChunk(runId, VERCEL_CHUNK_BUDGET_MS);
    if (outcome === "finalize") {
      // Fresh invocation, fresh budget. If the hop cannot be made at all,
      // finalize inline rather than leaving the run stuck in "running".
      try {
        const res = await fetch(`${origin}/api/runs/${runId}/finalize`, {
          method: "POST",
          headers: process.env.CRON_SECRET
            ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
            : undefined,
        });
        if (!res.ok) await finalizeRun(runId);
      } catch {
        await finalizeRun(runId);
      }
    } else if (outcome === "waiting") {
      // Vendor batches are out; the hourly batch cron resumes this run.
      return;
    } else if (outcome === "continue") {
      // Server-to-server hop carries no session cookies; the continue route
      // accepts the cron secret as chain credentials.
      await fetch(`${origin}/api/runs/${runId}/continue`, {
        method: "POST",
        headers: process.env.CRON_SECRET
          ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
          : undefined,
      });
    }
  } catch (err) {
    console.error(`procerno run ${runId} crashed:`, err);
    await store.updateRunStatus(runId, "failed", String(err));
  }
}
