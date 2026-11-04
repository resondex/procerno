import {
  TRIAGE_LABEL,
  type AnalysisDecision,
  type AnalysisDecisionEntry,
  type Triage,
} from "./engine/analysis_types";

/**
 * The analysis tier's portfolio record (projects.analysis_decision,
 * 2026-11-03): the gate pattern - per position, what the engine suggested
 * vs what the customer decided, plus the playbook flag. Pure functions so
 * the route's semantics are testable without HTTP or a database.
 */

export const TRIAGES = Object.keys(TRIAGE_LABEL) as Triage[];

export function isTriage(v: unknown): v is Triage {
  return typeof v === "string" && (TRIAGES as string[]).includes(v);
}

/** One write from the Portfolio UI. decided: undefined leaves the override
 * alone, null clears it back to the suggestion; inPlaybook: undefined leaves
 * the flag alone, false removes the position from the playbook. */
export interface AnalysisDecisionPatch {
  cellId: string;
  suggested: Triage;
  decided?: Triage | null;
  inPlaybook?: boolean;
}

/** Cap on recorded positions - a map has tens of cells, so this only stops
 * a runaway client from growing the column without bound. */
export const MAX_POSITIONS = 2000;

export function emptyAnalysisDecision(): AnalysisDecision {
  return { v: 1, positions: {} };
}

/** Parse the stored JSON. Absent, unreadable or wrong-shaped = null; entries
 * whose triage values are not in the Triage union are dropped (a renamed
 * triage never crashes the read). */
export function parseAnalysisDecision(json: string | null | undefined): AnalysisDecision | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { v?: unknown; positions?: unknown };
  if (r.v !== 1 || !r.positions || typeof r.positions !== "object" || Array.isArray(r.positions)) {
    return null;
  }
  const positions: Record<string, AnalysisDecisionEntry> = {};
  for (const [id, val] of Object.entries(r.positions as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const e = val as Record<string, unknown>;
    if (!isTriage(e.suggested)) continue;
    const entry: AnalysisDecisionEntry = { suggested: e.suggested };
    if (isTriage(e.decided)) {
      entry.decided = e.decided;
      if (typeof e.decidedAt === "string") entry.decidedAt = e.decidedAt;
    }
    if (e.inPlaybook === true) {
      entry.inPlaybook = true;
      if (typeof e.addedAt === "string") entry.addedAt = e.addedAt;
    }
    positions[id] = entry;
  }
  return { v: 1, positions };
}

/** Merge one patch into the record - never replaces the whole record and
 * never mutates prev. The entry's suggestion always tracks the engine's
 * current one; timestamps move only when the decision or the playbook flag
 * actually changes. */
export function mergeAnalysisDecision(
  prev: AnalysisDecision | null,
  patch: AnalysisDecisionPatch,
  now: string = new Date().toISOString()
): AnalysisDecision {
  const base = prev ?? emptyAnalysisDecision();
  const before = base.positions[patch.cellId];
  const entry: AnalysisDecisionEntry = { ...(before ?? {}), suggested: patch.suggested };

  if (patch.decided === null) {
    delete entry.decided;
    delete entry.decidedAt;
  } else if (patch.decided !== undefined && patch.decided !== before?.decided) {
    entry.decided = patch.decided;
    entry.decidedAt = now;
  }

  if (patch.inPlaybook === false) {
    delete entry.inPlaybook;
    delete entry.addedAt;
  } else if (patch.inPlaybook === true && before?.inPlaybook !== true) {
    entry.inPlaybook = true;
    entry.addedAt = now;
  }

  return { v: 1, positions: { ...base.positions, [patch.cellId]: entry } };
}
