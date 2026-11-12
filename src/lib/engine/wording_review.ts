import { store } from "../store";
import { withCostContext } from "../cost_log";
import { completeWithEngine, engineAvailable } from "./providers";
import { coderSource } from "./coder";
import { codeWaveChunk } from "./coding_wave";
import { purgeRunRevision } from "./run_revision";
import { dashboardRun } from "./prompt_health";
import { foldWording, repeatsWording, suggestReplacement } from "./wording_fix";
import type { Project, Prompt, PromptFlagRow, Run } from "../types";

/**
 * The first-wave wording review (2026-11-11, Tyler): after a tracker's FIRST
 * coded wave, the question check's open wording flags are shown in a
 * warning before any analysis lands, each with one suggested replacement
 * wording. With two warnings or fewer, the replacements' answers are
 * collected and coded ahead of time (staged - invisible to every reader),
 * so accepting one is an instant swap.
 *
 * "First wave" = the project has no EARLIER run carrying coded answers.
 * Later waves only log their flags (the question-check dialog shows them);
 * a replacement here hides the old wording's answers in every run, so the
 * replace path is refused outside the first wave.
 *
 * A staged prompt (prompts.staged = 1) is invisible: store.listPrompts never
 * returns it and every response / code listing leaves its answers out.
 * Accepting swaps it live in one transaction (store.acceptStagedPrompt): the
 * old wording is retired with replaced_by set, which hides its answers.
 */

/** Pre-collect only when the run has this many open flags or fewer. */
export const PRESTAGE_MAX_FLAGS = 2;

function utcMs(ts: string): number {
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z").getTime();
}

/** The answer_codes source the coding wave writes for this tracker. */
async function waveSource(projectId: string): Promise<{ source: string; adapter: string | null }> {
  const adapter = await store.getReasonsAdapter(projectId);
  return { source: coderSource(adapter), adapter };
}

/** True when no run created before `run` carries coded answers under the
 * project's codes source (or, without one, under the coder's source). */
export async function isFirstWave(project: Project, run: Pick<Run, "id" | "created_at">): Promise<boolean> {
  const source = (await store.getCodesSource(project.id)) ?? (await waveSource(project.id)).source;
  const at = utcMs(run.created_at);
  for (const r of await store.listRuns(project.id)) {
    if (r.id === run.id || utcMs(r.created_at) >= at) continue;
    if ((await store.countAnswerCodes(r.id, source)) > 0) return false;
  }
  return true;
}

/** Open wording flags on `run` whose wording is still live. */
async function openFlags(project: Project, runId: string): Promise<{ flags: PromptFlagRow[]; prompts: Prompt[] }> {
  const prompts = await store.listPrompts(project.id);
  const live = new Map(prompts.filter((p) => p.retired === 0).map((p) => [p.id, p]));
  const flags = (await store.listPromptFlags({ projectId: project.id, runId, status: "open" })).filter(
    (f) => f.kind === "wording" && live.has(f.prompt_id)
  );
  return { flags, prompts };
}

/** The review the dashboard shows: the dashboard run's open wording flags,
 * on a first wave only. Null = nothing to review. */
export async function firstWaveReview(project: Project): Promise<{ run: Run; flags: PromptFlagRow[]; prompts: Prompt[] } | null> {
  if (!(await store.getCodesSource(project.id))) return null;
  const run = await dashboardRun(project.id);
  if (!run) return null;
  const { flags, prompts } = await openFlags(project, run.id);
  if (flags.length === 0) return null;
  if (!(await isFirstWave(project, run))) return null;
  return { run, flags, prompts };
}

/** The engines a staged wording is asked on: the run's panel, minus engines
 * with no key and engines the run's preflight dropped. */
function panelOf(run: Run): string[] {
  let engines = (run.models.length > 0 ? run.models : [run.model]).filter((m) => engineAvailable(m));
  if (run.error?.startsWith("engine(s) failed preflight")) {
    const dead = run.error.slice(run.error.indexOf(":") + 1).split(",").map((x) => x.trim());
    engines = engines.filter((m) => !dead.includes(m));
  }
  return engines;
}

/** Collect a staged wording's answers on the run's panel - live calls
 * through the runner's own engine entry point (search cap and ledger as
 * usual, attributed to the run). Resumable: done (repeat, engine) pairs are
 * skipped. Returns the answers stored for the wording after the pass. */
export async function collectStaged(run: Run, staged: Prompt, deadline: number): Promise<{ stored: number; expected: number }> {
  const engines = panelOf(run);
  const expected = engines.length * run.repeats;
  const done = new Set(
    (await store.listResponseMetaForPrompts(run.id, [staged.id])).map((r) => `${r.repeat_idx}:${r.model}`)
  );
  const tasks: { repeat: number; model: string }[] = [];
  for (let r = 0; r < run.repeats; r++) for (const m of engines) if (!done.has(`${r}:${m}`)) tasks.push({ repeat: r, model: m });
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length && Date.now() < deadline) {
      const t = tasks[cursor++];
      try {
        const res = await withCostContext({ purpose: "run:answer", projectId: run.project_id, runId: run.id }, () =>
          completeWithEngine(t.model, staged.text)
        );
        if (!res.text.trim()) throw new Error("empty answer");
        await store.insertResponse({
          runId: run.id,
          promptId: staged.id,
          repeatIdx: t.repeat,
          model: t.model,
          finishReason: res.finishReason,
          citations: res.citations,
          coderModel: null,
          searchCount: res.searchCount,
          inputTokens: res.usage.input,
          outputTokens: res.usage.output,
          text: res.text,
          mentions: [],
          coding: null,
        });
      } catch (err) {
        console.error(`staged wording ${staged.id} on ${t.model} failed:`, err);
      }
    }
  };
  // A staged wording is one prompt: one call per engine and repeat, all at once.
  await Promise.all(Array.from({ length: Math.min(16, tasks.length) }, worker));
  const stored = (await store.listResponseMetaForPrompts(run.id, [staged.id])).length;
  return { stored, expected };
}

/** Code a staged wording's answers through the app's coding wave, under the
 * source the wave writes. RUN_COLLECT_ONLY holds this half exactly as it
 * holds the wave. */
export async function codeStaged(
  project: Project,
  run: Run,
  staged: Prompt,
  deadline: number
): Promise<{ held: boolean; coded: number; uncoded: number; blocked?: string }> {
  const meta = await store.listResponseMetaForPrompts(run.id, [staged.id]);
  if (process.env.RUN_COLLECT_ONLY) return { held: true, coded: 0, uncoded: meta.length };
  const { source, adapter } = await waveSource(project.id);
  const already = new Set(await store.listAnswerCodeIds(run.id, source));
  const uncoded = meta.filter((r) => !already.has(r.id));
  if (uncoded.length > 0) {
    const bodies = new Map((await store.getResponseTexts(uncoded.map((r) => r.id))).map((t) => [t.id, t.text]));
    const wave = await codeWaveChunk({
      runId: run.id,
      project,
      source,
      adapter,
      uncoded,
      bodyOf: async (i, rows) => bodies.get(rows[i].id) ?? "",
      deadline,
      extraPrompts: [staged],
    });
    if (wave.outcome === "blocked") {
      const after = new Set(await store.listAnswerCodeIds(run.id, source));
      return { held: false, coded: meta.filter((r) => after.has(r.id)).length, uncoded: meta.filter((r) => !after.has(r.id)).length, blocked: wave.message };
    }
  }
  const after = new Set(await store.listAnswerCodeIds(run.id, source));
  return { held: false, coded: meta.filter((r) => after.has(r.id)).length, uncoded: meta.filter((r) => !after.has(r.id)).length };
}

/** The staged prompt carrying `text` for this flag, reused when its text
 * matches, else a new one (an edited suggestion is a new wording). */
async function stagedFor(project: Project, flag: PromptFlagRow, old: Prompt, text: string): Promise<Prompt> {
  const staged = await store.listStagedPrompts(project.id);
  const reuse =
    staged.find((p) => p.id === flag.staged_prompt_id && foldWording(p.text) === foldWording(text)) ??
    staged.find((p) => p.replaces === old.id && foldWording(p.text) === foldWording(text));
  const s =
    reuse ??
    (await store.insertStagedPrompt(project.id, {
      text,
      theme: old.theme,
      intentId: old.intent_id,
      asker: old.asker,
      replaces: old.id,
    }));
  if (flag.staged_prompt_id !== s.id) await store.updatePromptFlag(flag.id, { staged_prompt_id: s.id });
  return s;
}

/**
 * After a first wave's question check (finalizeRun, or the hand-run
 * script): one suggestion per open wording flag, and - with two flags or
 * fewer - each suggestion staged, collected and coded so its swap is
 * instant. Bounded by `deadline`; a failure leaves the flag open with no
 * staged data (the accept then does the work on demand). SPENDS: one writer
 * pass (+ checks) per flag, and with staging one answer per engine and
 * repeat plus coding.
 */
export async function prepareFirstWaveReview(project: Project, run: Run, deadline: number): Promise<{ flags: number; suggested: number; staged: number }> {
  if (!(await isFirstWave(project, run))) return { flags: 0, suggested: 0, staged: 0 };
  const { flags, prompts } = await openFlags(project, run.id);
  if (flags.length === 0) return { flags: 0, suggested: 0, staged: 0 };
  const intents = await store.listIntents(project.id);
  const intentById = new Map(intents.map((i) => [i.id, i]));
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  let suggested = 0;
  let stagedN = 0;
  for (const flag of flags) {
    if (Date.now() >= deadline) break;
    if (flag.suggested_text) {
      suggested++;
      continue;
    }
    const old = promptById.get(flag.prompt_id);
    const intent = old?.intent_id ? intentById.get(old.intent_id) : undefined;
    if (!old || !intent) continue;
    const wordings = prompts.filter((p) => p.intent_id === intent.id && p.retired === 0);
    const s = await suggestReplacement({ project, intent, wordings, flagged: old, intents, meta: { runId: run.id } });
    if (!s) continue;
    flag.suggested_text = s.text;
    await store.updatePromptFlag(flag.id, { suggested_text: s.text, suggestion_meta: JSON.stringify(s.meta) });
    suggested++;
  }
  if (flags.length <= PRESTAGE_MAX_FLAGS) {
    for (const flag of flags) {
      if (!flag.suggested_text || Date.now() >= deadline) continue;
      const old = promptById.get(flag.prompt_id);
      if (!old) continue;
      try {
        const staged = await stagedFor(project, flag, old, flag.suggested_text);
        const c = await collectStaged(run, staged, deadline);
        if (c.stored > 0) await codeStaged(project, run, staged, deadline);
        stagedN++;
      } catch (err) {
        console.error(`wording review: staging for flag ${flag.id} failed:`, err);
      }
    }
  }
  console.log(`wording review (${project.brand}): ${flags.length} open, ${suggested} suggested, ${stagedN} staged`);
  return { flags: flags.length, suggested, staged: stagedN };
}

/** Whether a flag's staged replacement is fully measured: every panel
 * answer collected and (unless the coding hold is on) coded. */
export async function stagedReady(project: Project, run: Run, flag: PromptFlagRow): Promise<boolean> {
  if (!flag.staged_prompt_id || !flag.suggested_text) return false;
  const staged = (await store.listStagedPrompts(project.id)).find((p) => p.id === flag.staged_prompt_id);
  if (!staged || foldWording(staged.text) !== foldWording(flag.suggested_text)) return false;
  const meta = await store.listResponseMetaForPrompts(run.id, [staged.id]);
  if (meta.length < panelOf(run).length * run.repeats || meta.length === 0) return false;
  if (process.env.RUN_COLLECT_ONLY) return true;
  const { source } = await waveSource(project.id);
  const coded = new Set(await store.listAnswerCodeIds(run.id, source));
  return meta.every((r) => coded.has(r.id));
}

export type ActResult =
  | { ok: true; status: "replaced" | "kept"; held?: boolean; uncoded?: number }
  | { ok: false; error: string; code: number };

/**
 * The review's two actions on one flag.
 *  keep    - the flag reads "kept", the prompt's flag clears, nothing else.
 *  replace - the wording `text` (default: the suggestion) replaces the
 *            flagged one. With its answers staged and measured, a swap in
 *            one transaction; otherwise they are collected and coded now
 *            (about a minute), then swapped. Nothing is swapped when no
 *            answer could be collected - the flag stays open.
 */
export async function actOnFlag(
  project: Project,
  flagId: string,
  action: "replace" | "keep",
  text: string | undefined,
  deadline: number
): Promise<ActResult> {
  const flag = await store.getPromptFlag(flagId);
  if (!flag || flag.project_id !== project.id) return { ok: false, error: "not found", code: 404 };
  if (flag.status !== "open") return { ok: false, error: "this flag is already resolved", code: 409 };
  const prompts = await store.listPrompts(project.id);
  const old = prompts.find((p) => p.id === flag.prompt_id);
  if (!old || old.retired !== 0) return { ok: false, error: "the wording is no longer live", code: 409 };

  if (action === "keep") {
    await store.updatePromptFlag(flag.id, { status: "kept", resolved_text: old.text });
    await store.setPromptFlag(old.id, null);
    await purgeRunRevision(flag.run_id);
    return { ok: true, status: "kept" };
  }

  const run = await store.getRun(flag.run_id);
  if (!run) return { ok: false, error: "run not found", code: 404 };
  if (!(await isFirstWave(project, run)))
    return { ok: false, error: "a wording can be swapped here only on a tracker's first wave", code: 409 };
  const wanted = (text ?? flag.suggested_text ?? "").trim();
  if (wanted.length < 4) return { ok: false, error: "write the new wording first", code: 400 };
  const cell = prompts.filter((p) => p.intent_id === old.intent_id && p.retired === 0);
  if (repeatsWording(wanted, cell.map((p) => p.text)))
    return { ok: false, error: "that wording is already one of this question's wordings", code: 400 };

  const staged = await stagedFor(project, flag, old, wanted);
  const c = await collectStaged(run, staged, deadline);
  if (c.stored === 0) return { ok: false, error: "no answers could be collected for the new wording - try again", code: 502 };
  const coding = await codeStaged(project, run, staged, deadline);
  if (coding.blocked) console.error(`wording review: coding of ${staged.id} blocked: ${coding.blocked}`);
  await store.acceptStagedPrompt({ stagedId: staged.id, oldId: old.id, flagId: flag.id, resolvedText: staged.text });
  await purgeRunRevision(run.id);
  return { ok: true, status: "replaced", held: coding.held, uncoded: coding.uncoded };
}
