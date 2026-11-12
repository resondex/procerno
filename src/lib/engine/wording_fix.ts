import { store } from "../store";
import { withCostContext } from "../cost_log";
import { PHRASINGS_WRITER_MODEL } from "./models";
import { apiKeyConfigured } from "./providers";
import { ModeratorsShape } from "./instrument_shapes";
import { brandAliasForms } from "./brand_aliases";
import { deriveCheckSpec, type CellCheckSpec, type RosterRoles } from "./battery_checks";
import { isWorryIntent } from "./surfaces";
import {
  generatePhrasings,
  humanize,
  tokenEdits,
  type Moderators,
  type ScenarioSpec,
} from "./instrument";
import type { Intent, Project, Prompt } from "../types";

/**
 * One replacement wording for a cell whose live wording drifted off the
 * category (the question check's first-wave review, 2026-11-11).
 *
 * Written by the setup's own paraphrase machinery (generatePhrasings): the
 * same writer model and contract prompt, the stage's keep note, the brand
 * rule, the mechanical battery checks and the structure check - so a
 * suggestion passes exactly what a setup paraphrase passes. The fix rides a
 * `steer` (instrument.ts): the cell's existing wordings and the flagged one
 * are never repeated or near-repeated, and one bracket note asks that the
 * product being chosen stay the plain subject of the ask. The steer keys its
 * own cache entries, so the setup's paraphrase sets are never touched.
 *
 * One retry (a second attempt keys fresh), else no suggestion - the review
 * then offers "write your own" only. Ledger purpose health:suggest.
 */

/** The bracket note the writer reads on the cell (generic by rule: no
 * category or brand words, no examples). */
export const FIX_NOTE =
  "fresh wording: one wording of this question drew answers that were not about the products being chosen - " +
  "keep the product being chosen as the plain subject of the ask, so the question reads as about that product " +
  "and nothing around it";

export interface WordingSuggestion {
  text: string;
  meta: {
    model: string;
    attempt: number;
    checks: string[];
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Text identity for "is this an existing wording" - the same folding the
 * paraphrase dedupe uses (case, punctuation, spacing). */
export function foldWording(t: string): string {
  return humanize(t).trim().toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ");
}

/** True when `text` is an existing wording or within two token edits of
 * one (the paraphrase writer's near-duplicate rule). Pure. */
export function repeatsWording(text: string, existing: string[]): boolean {
  const a = foldWording(text).split(" ").filter(Boolean);
  return existing.some((e) => {
    const b = foldWording(e).split(" ").filter(Boolean);
    return a.join(" ") === b.join(" ") || tokenEdits(a, b) <= 2;
  });
}

/** Everything generatePhrasings needs about a live tracker, rebuilt from the
 * project row, its setup_decision record and its intents - never a model
 * call. Null when the tracker was not built with the Landscape setup. */
export async function fixContext(project: Project, intents: Intent[]): Promise<{
  base: Moderators;
  scenarios: ScenarioSpec[];
  valueLines: Record<string, { line: string; counterpart: string } | null>;
  avoidConcerns: string[];
  rosterRoles?: RosterRoles;
  aliasForms: Record<string, string[]>;
} | null> {
  if (!project.moderators) return null;
  let base: Moderators;
  try {
    const parsed = ModeratorsShape.safeParse(JSON.parse(project.moderators));
    if (!parsed.success) return null;
    base = parsed.data as Moderators;
  } catch {
    return null;
  }
  let decision: Obj | null = null;
  try {
    const raw = await store.getSetupDecision(project.id);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    decision = isObj(v) ? v : null;
  } catch {
    decision = null;
  }
  const journeys = (() => {
    try {
      return project.scenario_journeys ? (JSON.parse(project.scenario_journeys) as Record<string, ScenarioSpec["journey"]>) : {};
    } catch {
      return {} as Record<string, ScenarioSpec["journey"]>;
    }
  })();
  const dRooms = isObj(decision?.rooms) ? (decision!.rooms as Obj) : null;
  const described = new Map<string, string>();
  if (dRooms && Array.isArray(dRooms.decided))
    for (const r of dRooms.decided.filter(isObj)) {
      const label = str(r.label);
      if (label) described.set(label, str(r.description) ?? "");
    }
  const situations = [...new Set(intents.map((i) => i.situation).filter((x): x is string => !!x))];
  const scenarios: ScenarioSpec[] = situations.map((label) => ({
    label,
    description: described.get(label) ?? "",
    journey: journeys[label] ?? null,
  }));
  const dValue = isObj(decision?.valueLines) ? (decision!.valueLines as Obj) : null;
  const valueLines: Record<string, { line: string; counterpart: string } | null> = {};
  if (isObj(dValue?.decided))
    for (const [room, v] of Object.entries(dValue!.decided as Obj))
      valueLines[room] = isObj(v) && str(v.line) && str(v.counterpart) ? { line: str(v.line)!, counterpart: str(v.counterpart)! } : null;
  const avoidConcerns = [...new Set(intents.filter(isWorryIntent).map((i) => i.concern!).filter(Boolean))];
  // Roster roles live on the setup draft only (the documented gap); read
  // them when the tracker's draft is still there, else untyped.
  let rosterRoles: RosterRoles | undefined;
  try {
    const setupId = await store.setupIdForProject(project.id, project.brand);
    const draft = setupId ? await store.getSetupDraft(setupId) : null;
    const grid = isObj(draft?.wizard) && isObj((draft!.wizard as Obj).grid) ? ((draft!.wizard as Obj).grid as Obj) : null;
    if (grid && isObj(grid.rosterRoles)) rosterRoles = grid.rosterRoles as RosterRoles;
  } catch {
    rosterRoles = undefined;
  }
  const aliasForms = await brandAliasForms([project.brand, ...project.competitors]).catch(() => ({}) as Record<string, string[]>);
  return { base, scenarios, valueLines, avoidConcerns, rosterRoles, aliasForms };
}

/**
 * One replacement wording for `flagged` (a live prompt of `intent`'s cell),
 * or null. Spends one writer pass (plus the paraphrase checks) per attempt,
 * at most two attempts. Never throws: a failure is no suggestion.
 */
export async function suggestReplacement(input: {
  project: Project;
  intent: Intent;
  /** Every live wording of the cell, the flagged one included. */
  wordings: Prompt[];
  flagged: Prompt;
  intents: Intent[];
  meta?: { runId?: string };
}): Promise<WordingSuggestion | null> {
  if (!apiKeyConfigured()) return null;
  const { project, intent } = input;
  const ctx = await fixContext(project, input.intents).catch(() => null);
  if (!ctx) return null;
  const avoid = [...new Set([intent.text, ...input.wordings.map((w) => w.text), input.flagged.text])];
  let spec: CellCheckSpec | null = null;
  try {
    if (intent.angle !== "class")
      spec = deriveCheckSpec(
        { stage: intent.stage, angle: intent.angle, text: intent.text, concern: intent.stage === "advocacy" ? null : intent.concern ?? null },
        project.brand,
        project.competitors,
        project.category,
        ctx.aliasForms
      );
  } catch {
    spec = null;
  }
  const valueLine = intent.stage === "pricing" && intent.situation ? ctx.valueLines[intent.situation] ?? null : null;
  for (const attempt of [0, 1]) {
    try {
      const sets = await withCostContext({ purpose: "health:suggest", projectId: project.id, runId: input.meta?.runId ?? null }, () =>
        generatePhrasings({
          brand: project.brand,
          category: project.category,
          competitors: project.competitors,
          audience: project.audience ?? null,
          base: ctx.base,
          scenarios: ctx.scenarios,
          cells: [
            {
              stage: intent.stage,
              situation: intent.situation,
              angle: intent.angle,
              mode: intent.mode ?? null,
              text: intent.text,
              spec,
              concern: intent.stage === "advocacy" ? null : intent.concern ?? null,
              valueLine,
            },
          ],
          // Three candidates through the checks; the first that is not an
          // existing wording is the suggestion.
          count: 4,
          avoidConcerns: ctx.avoidConcerns.length > 0 ? ctx.avoidConcerns : undefined,
          rosterRoles: ctx.rosterRoles,
          steer: { avoid, note: FIX_NOTE, attempt },
          meta: { brand: project.brand, projectId: project.id, source: "health:suggest" },
        })
      );
      const pick = (sets[0] ?? []).map((p) => humanize(p.text).trim()).find((t) => t && !repeatsWording(t, avoid));
      if (pick)
        return {
          text: pick,
          meta: {
            model: PHRASINGS_WRITER_MODEL,
            attempt,
            checks: ["brand rule", "stage ask", "battery checks", "structure check", "not an existing wording"],
          },
        };
    } catch (err) {
      console.error(`wording fix (${project.brand}) attempt ${attempt} failed:`, err);
    }
  }
  return null;
}
