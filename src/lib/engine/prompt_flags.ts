import { store } from "../store";
import type { FitResult } from "./question_fit";
import type { Project, Prompt, Run } from "../types";

/**
 * The question check's flag log (2026-11-11): every flag the check raises is
 * written to prompt_flags, one row per (run, prompt), so problems can be
 * reviewed across trackers (scripts/list_prompt_flags.mts). A re-check
 * updates the row in place; a flag that no longer fires reads "cleared" -
 * rows are never deleted. A resolved row (replaced / kept) is never
 * reopened by a re-check.
 */

/** Log the counted check's wording flags for one run. */
export async function logWordingFlags(input: {
  project: Project;
  run: Pick<Run, "id">;
  fit: FitResult;
  prompts: Prompt[];
}): Promise<void> {
  const { project, run, fit } = input;
  const textOf = new Map(input.prompts.map((p) => [p.id, p.text]));
  const flagged = new Set<string>();
  for (const w of fit.wordings) {
    flagged.add(w.prompt);
    await store.upsertPromptFlag({
      project_id: project.id,
      run_id: run.id,
      prompt_id: w.prompt,
      intent_id: w.intent,
      stage: w.stage,
      kind: "wording",
      prompt_text: textOf.get(w.prompt) ?? "",
      rate: w.rate,
      siblings_rate: w.siblings,
      answers: w.answers,
      reason: w.reason,
      examples: JSON.stringify(w.examples),
      status: "open",
    });
  }
  await clearStale(run.id, "wording", new Set(fit.checked), flagged);
}

/** Log the legacy model check's flags (trackers with no codes source). */
export async function logLegacyFlags(input: {
  project: Project;
  runId: string;
  items: { id: string; prompt: string; answers: number }[];
  flagged: { id: string; reason: string }[];
}): Promise<void> {
  const itemOf = new Map(input.items.map((x) => [x.id, x]));
  const flagged = new Set<string>();
  for (const f of input.flagged) {
    const it = itemOf.get(f.id);
    if (!it) continue;
    flagged.add(f.id);
    await store.upsertPromptFlag({
      project_id: input.project.id,
      run_id: input.runId,
      prompt_id: f.id,
      intent_id: null,
      stage: null,
      kind: "model",
      prompt_text: it.prompt,
      rate: null,
      siblings_rate: null,
      answers: it.answers,
      reason: f.reason,
      examples: null,
      status: "open",
    });
  }
  await clearStale(input.runId, "model", new Set(input.items.map((x) => x.id)), flagged);
}

/** Open rows of this run and kind whose prompt was judged and no longer
 * flags read "cleared". */
async function clearStale(runId: string, kind: string, judged: Set<string>, flagged: Set<string>): Promise<void> {
  for (const row of await store.listPromptFlags({ runId, status: "open" })) {
    if (row.kind !== kind) continue;
    if (judged.has(row.prompt_id) && !flagged.has(row.prompt_id)) await store.updatePromptFlag(row.id, { status: "cleared" });
  }
}

export interface FlagExamples {
  off: string[];
  siblingsOn: string[];
}

export function parseExamples(raw: string | null): FlagExamples {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<FlagExamples>) : {};
    return {
      off: Array.isArray(v.off) ? v.off.filter((x): x is string => typeof x === "string") : [],
      siblingsOn: Array.isArray(v.siblingsOn) ? v.siblingsOn.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return { off: [], siblingsOn: [] };
  }
}
