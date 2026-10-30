/**
 * The coding wave on procerno_reason_coder (2026-10-29): one budgeted chunk
 * of the run's uncoded answers through the Fireworks coder, written to
 * answer_codes under the coder's source. Called by runner.ts
 * codeCollectedChunk AFTER its gates (the RUN_COLLECT_ONLY hold, the
 * truncation recollect, the health note) - nothing here runs for a held run.
 *
 * What it refuses, loudly (outcome "blocked" -> the run parks at
 * "collected" with the message, collection data safe):
 *   - no FIREWORKS_API_KEY;
 *   - the tracker's coder inputs or codebook are incomplete
 *     (projects.coder_inputs, scope sentences, advocacy criticisms);
 *   - a reasons adapter trained from another base;
 *   - a missing / unbound deployment (the app never provisions one);
 *   - a deployment still not routable after CODER_WAKE_WINDOW_MIN of chunks;
 *   - 12 consecutive transport failures, or replies breaking the contract on
 *     more than 20% of a chunk's rows (a misbound model, not one bad answer).
 * Answers whose cell has no contract schema (retired stages, classic
 * batteries) are left uncoded and reported. A row whose reply breaks the
 * contract is a terminal per-row failure, recorded in llm_cache
 * (coder_fail:<source>:<response id>) and never re-sent: at temperature 0
 * the same request fails the same way. codes_source is never set here - the
 * views read a coder's rows only after Tyler's explicit flip.
 */
import { store } from "../store";
import { withCostContext } from "../cost_log";
import type { Intent, Project, ResponseMetaRow } from "../types";
import {
  buildCoderRequest,
  parseCoderInputs,
  resolveCodebook,
  CoderInputError,
  type CoderPromptContext,
} from "./coder_prompts";
import {
  CODER_MODEL,
  adapterMismatch,
  codeAnswer,
  CoderTransportError,
  logCoderGpuEstimate,
} from "./coder";
import { checkCoderReady, CoderDeploymentError, CODER_DEPLOYMENT, forgetCoderReadiness } from "./coder_deployment";

const CONCURRENCY = Number(process.env.CODER_CONCURRENCY ?? 24);
const WAKE_WINDOW_MS = Number(process.env.CODER_WAKE_WINDOW_MIN ?? 20) * 60_000;
const FAIL_TTL_MS = 10 * 365 * 24 * 3600_000;
const OUTAGE_CONSECUTIVE_TRANSPORT = 12;
const OUTAGE_MIN_ROWS = 30;
const OUTAGE_CONTRACT_RATE = 0.2;

export const coderFailKey = (source: string, responseId: string) => `coder_fail:${source}:${responseId}`;
const wakeKey = (runId: string) => `coder_wake:${runId}`;
/** The latest reason a run's coding wave was blocked (JSON {message, at}). */
export const coderBlockKey = (runId: string) => `coder_block:${runId}`;

export type WaveOutcome =
  | { outcome: "continue" | "finalize" }
  | { outcome: "blocked"; message: string };

export async function codeWaveChunk(opts: {
  runId: string;
  project: Project;
  source: string;
  adapter: string | null;
  uncoded: ResponseMetaRow[];
  /** Answer bodies by id, filled a page ahead of the workers. */
  bodyOf: (i: number, rows: ResponseMetaRow[]) => Promise<string>;
  deadline: number;
}): Promise<WaveOutcome> {
  const { runId, project, source, adapter, deadline } = opts;
  const blocked = (message: string): WaveOutcome => ({ outcome: "blocked", message: `coder: ${message}` });

  // Cells: the contract schema comes from the answer's intent.
  const [prompts, intents] = await Promise.all([store.listPrompts(project.id), store.listIntents(project.id)]);
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  const intentById = new Map<string, Intent>(intents.map((i) => [i.id, i]));
  const cellOf = (r: ResponseMetaRow) => {
    const iid = promptById.get(r.prompt_id)?.intent_id;
    return iid ? intentById.get(iid) ?? null : null;
  };

  // Codebook + frozen inputs. Built before any spend: an incomplete tracker
  // blocks the wave rather than coding against a different prompt.
  let ctx: CoderPromptContext;
  try {
    const inputs = parseCoderInputs(await store.getCoderInputs(project.id));
    const book = resolveCodebook(project, inputs);
    ctx = { brand: project.brand, codes: book.codes, defs: book.defs, inputs };
  } catch (err) {
    if (err instanceof CoderInputError) return blocked(err.message);
    throw err;
  }
  const mismatch = adapterMismatch(adapter);
  if (mismatch) return blocked(mismatch);

  const codable: ResponseMetaRow[] = [];
  let contractless = 0;
  for (const r of opts.uncoded) {
    const cell = cellOf(r);
    let req;
    try {
      // Validates the cell's design inputs (e.g. an advocacy criticism)
      // once per cell, with no answer text yet.
      req = buildCoderRequest(cell, "", "", ctx);
    } catch (err) {
      if (err instanceof CoderInputError) return blocked(err.message);
      throw err;
    }
    if (!req) {
      contractless++;
      continue;
    }
    codable.push(r);
  }
  if (contractless) console.log(`coding wave ${runId}: ${contractless} answer(s) have no contract schema (retired stage or no cell) - left uncoded`);

  const failed = await store.cacheGetMany(codable.map((r) => coderFailKey(source, r.id)), FAIL_TTL_MS);
  const todo = codable.filter((r) => !failed.has(coderFailKey(source, r.id)));
  if (todo.length === 0) return { outcome: "finalize" };

  const key = process.env.FIREWORKS_API_KEY;
  if (!key) return blocked("FIREWORKS_API_KEY is not set - nothing was coded; set the key and resume the run");

  // Preflight: deployment present, models DEPLOYED, routable. Never provisions.
  const models = adapter ? [CODER_MODEL, adapter] : [CODER_MODEL];
  const gpu0 = Date.now();
  let readiness;
  try {
    readiness = await checkCoderReady(key, models, Math.min(deadline, Date.now() + 150_000));
  } catch (err) {
    if (err instanceof CoderDeploymentError) return blocked(err.message);
    throw err;
  }
  if (!readiness.ready) {
    const since = Number((await store.cacheGet(wakeKey(runId), WAKE_WINDOW_MS * 4)) ?? 0);
    const first = since > 0 ? since : Date.now();
    if (since <= 0) await store.cacheSet(wakeKey(runId), String(first));
    logCoderGpuEstimate("chunk", (Date.now() - gpu0) / 3_600_000, { runId, deployment: CODER_DEPLOYMENT, phase: "waking", coded: 0 });
    if (Date.now() - first > WAKE_WINDOW_MS) {
      await store.cacheSet(wakeKey(runId), "0");
      return blocked(
        `deployment ${CODER_DEPLOYMENT} did not become routable within ${Math.round(WAKE_WINDOW_MS / 60_000)} min (last: ${readiness.detail}) - check it with scripts/coder_deployment.mts status`
      );
    }
    console.log(`coding wave ${runId}: ${CODER_DEPLOYMENT} still waking (${readiness.detail}) - next chunk re-probes`);
    return { outcome: "continue" };
  }
  await store.cacheSet(wakeKey(runId), "0");

  // Workers.
  let cursor = 0;
  let coded = 0, degraded = 0, transport = 0, consecutiveTransport = 0, attempts = 0;
  let lastEnd = Date.now();
  const contractFails: { id: string; why: string; raw: string }[] = [];
  const modes: Record<string, number> = {};
  let outage: string | null = null;
  let firstDegraded = "";
  async function worker(): Promise<void> {
    while (cursor < todo.length && Date.now() < deadline && !outage) {
      const i = cursor++;
      const r = todo[i];
      try {
        const text = await opts.bodyOf(i, todo);
        const req = buildCoderRequest(cellOf(r), promptById.get(r.prompt_id)?.text ?? "", text, ctx)!;
        const res = await withCostContext({ purpose: "run:coding", projectId: project.id, runId }, () =>
          codeAnswer({
            key: key!,
            request: req,
            base: { response_id: r.id, source, run_id: runId, project_id: project.id },
            answerText: text,
            codes: ctx.codes,
            adapter,
            // In-flight calls end before the function's 300s ceiling.
            hardStop: deadline + 60_000,
          })
        );
        attempts++;
        consecutiveTransport = 0;
        if (res.ok) {
          await store.upsertAnswerCodes([res.row]);
          coded++;
          modes[res.mode] = (modes[res.mode] ?? 0) + 1;
          if (res.degraded) {
            degraded++;
            if (!firstDegraded) firstDegraded = `${r.id}: ${res.degraded}`;
          }
        } else {
          contractFails.push({ id: r.id, why: res.why, raw: res.raw });
          if (attempts >= OUTAGE_MIN_ROWS && contractFails.length / attempts > OUTAGE_CONTRACT_RATE) {
            outage = `replies break the trained contract on ${contractFails.length} of ${attempts} rows (e.g. ${contractFails[0].why}) - check what is bound to ${CODER_DEPLOYMENT}`;
          }
        }
      } catch (err) {
        if (!(err instanceof CoderTransportError)) {
          console.error(`coding of response ${r.id} failed:`, err);
          continue;
        }
        transport++;
        consecutiveTransport++;
        if (err.status === 401 || err.status === 403 || err.status === 404) {
          // Key revoked or model unbound mid-wave: no retry will fix it.
          outage = err.message;
        } else if (consecutiveTransport >= OUTAGE_CONSECUTIVE_TRANSPORT) {
          outage = `${consecutiveTransport} consecutive coder calls failed (last: ${err.message})`;
        }
      } finally {
        lastEnd = Date.now();
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  logCoderGpuEstimate("chunk", (lastEnd - gpu0) / 3_600_000, {
    runId, deployment: CODER_DEPLOYMENT, models, coded, attempts,
  });
  if (outage) {
    // Contract failures under an outage are NOT recorded as terminal: the
    // likely cause is the deployment, and the rows must be retried once it
    // is fixed.
    forgetCoderReadiness();
    return blocked(outage);
  }
  for (const f of contractFails) {
    await store.cacheSet(coderFailKey(source, f.id), JSON.stringify({ why: f.why, raw: f.raw.slice(0, 4000), at: new Date().toISOString() }));
    console.error(`coding wave ${runId}: response ${f.id} failed the contract (${f.why}) - recorded, not retried`);
  }
  if (degraded) console.error(`coding wave ${runId}: ${degraded} row(s) kept the base coder's reasons (reasons adapter pass failed; e.g. ${firstDegraded})`);
  const done = coded + contractFails.length;
  console.log(
    `coding wave ${runId} [${source}]: coded ${coded}, contract failures ${contractFails.length}, transport failures ${transport}, ` +
      `degraded ${degraded}, parse modes ${JSON.stringify(modes)}; ${todo.length - done} left`
  );
  if (done >= todo.length) {
    // The wave's last chunk: the scale-to-zero idle tail after it.
    logCoderGpuEstimate("idle_tail", Number(process.env.CODER_IDLE_TAIL_HOURS ?? 1), { runId, deployment: CODER_DEPLOYMENT });
    return { outcome: "finalize" };
  }
  return { outcome: "continue" };
}
