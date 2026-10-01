import { store } from "../store";
import type { Intent, Prompt, Run, RunSurface } from "../types";

/**
 * Per-surface collection cadence (Tyler 2026-10-01). A run collects the
 * "core" surface on the tracker's own cadence; the "worries" surface -
 * doubt cells carrying a ratified worry - rides only monthly-inclusion
 * waves, whatever the tracker's schedule.
 *
 * The decision is made once, at run creation, and stored on the run row
 * (runs.surfaces), so every later reader - drivers, metrics, progress -
 * reads what the run carried instead of re-deriving it from the clock.
 * runs.surfaces NULL = a run created before per-surface cadence, which
 * collected every prompt; it reads as carrying every surface.
 */

export type Surface = RunSurface;

/** Stages whose concern-bearing cells form the buyer-worries surface. */
export const WORRY_STAGES = new Set(["objections", "churn_triggers", "renewal"]);

/** Monthly inclusion lookback - the same margin the cron uses for its
 * monthly schedule, so a weekly tracker's 4th weekly wave (day 28) and a
 * monthly tracker's every wave both re-include the surface. */
export const WORRIES_LOOKBACK_DAYS = 27;

/** Zip-era doubt cells have concern NULL and stay on the core cadence. */
export function isWorryIntent(i: Pick<Intent, "stage" | "concern">): boolean {
  return WORRY_STAGES.has(i.stage) && i.concern != null;
}

/** Ids of the prompts on the worries surface (retired ones included). */
export function worryPromptIds(prompts: Prompt[], intents: Intent[]): Set<string> {
  const worryIntents = new Set(intents.filter(isWorryIntent).map((i) => i.id));
  if (worryIntents.size === 0) return new Set();
  return new Set(
    prompts
      .filter((p) => p.intent_id !== null && worryIntents.has(p.intent_id))
      .map((p) => p.id)
  );
}

export function runCarries(run: Pick<Run, "surfaces">, surface: Surface): boolean {
  return run.surfaces === null || run.surfaces.includes(surface);
}

/** Prompts whose surface this run carried - retired prompts kept, since a
 * past run may hold answers to a prompt retired after it. */
export function carriedPrompts(
  run: Pick<Run, "surfaces">,
  prompts: Prompt[],
  worryIds: Set<string>
): Prompt[] {
  if (worryIds.size === 0 || runCarries(run, "worries")) return prompts;
  return prompts.filter((p) => !worryIds.has(p.id));
}

/** THE collection choke point: the prompts a run asks. Every driver (live
 * runner, batch submission) and every progress denominator reads this. */
export function promptsForRun(
  run: Pick<Run, "surfaces">,
  prompts: Prompt[],
  intents: Intent[]
): Prompt[] {
  return carriedPrompts(run, prompts, worryPromptIds(prompts, intents)).filter(
    (p) => !p.retired
  );
}

export async function loadRunPrompts(run: Run): Promise<Prompt[]> {
  const [prompts, intents] = await Promise.all([
    store.listPrompts(run.project_id),
    store.listIntents(run.project_id),
  ]);
  return promptsForRun(run, prompts, intents);
}

/** Both store drivers emit UTC; sqlite omits the T and Z, postgres has them. */
function utcMs(ts: string): number {
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z").getTime();
}

export interface NextRunPlan {
  surfaces: Surface[];
  /** Live prompts the next run would ask. */
  promptCount: number;
  /** Live worry-surface prompts; included in promptCount only when the
   * next run carries the surface. */
  worryPromptCount: number;
}

/**
 * The inclusion rule: the next run carries the worries surface iff the
 * tracker has live worry prompts AND no non-failed run created within the
 * last WORRIES_LOOKBACK_DAYS carried it. Failed runs don't count (their
 * wave is unusable, so the next run retries the surface). A tracker with no
 * worry prompts stores ["core"], so worries added later are collected on
 * the very next run rather than waiting out a lookback nothing filled.
 */
export function planNextRun(input: {
  prompts: Prompt[];
  intents: Intent[];
  runs: Run[];
  now?: number;
}): NextRunPlan {
  const live = input.prompts.filter((p) => !p.retired);
  const worryIds = worryPromptIds(live, input.intents);
  const worryPromptCount = worryIds.size;
  if (worryPromptCount === 0) {
    return { surfaces: ["core"], promptCount: live.length, worryPromptCount };
  }
  const cutoff = (input.now ?? Date.now()) - WORRIES_LOOKBACK_DAYS * 24 * 3600 * 1000;
  const recent = input.runs.some(
    (r) =>
      r.status !== "failed" &&
      runCarries(r, "worries") &&
      utcMs(r.created_at) > cutoff
  );
  return recent
    ? { surfaces: ["core"], promptCount: live.length - worryPromptCount, worryPromptCount }
    : { surfaces: ["core", "worries"], promptCount: live.length, worryPromptCount };
}

/** Run-creation entry point (manual runs route and cron alike). */
export async function planRunSurfaces(projectId: string): Promise<Surface[]> {
  const [prompts, intents, runs] = await Promise.all([
    store.listPrompts(projectId),
    store.listIntents(projectId),
    store.listRuns(projectId),
  ]);
  return planNextRun({ prompts, intents, runs }).surfaces;
}
