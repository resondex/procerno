import { cell } from "./view_data";
import { EVERY_BUYER, pickRefs, slKey, type AnswerRules, type RefCandidate, type ThemeMap } from "./reason_themes";
import type { RuleGroup } from "./rules_explorer";
import { isWallWording } from "./wall_wording";
import { isDefaultCondition } from "./condition_groups";
import type { AnswerRef } from "./analysis_types";

/**
 * "Lost, with an exception" (2026-11-12): in a head-to-head the AI picks the
 * named rival, yet still states a case for choosing the client ("choose
 * <brand> if ..."). A plain rate of that is close to structural - a two-brand
 * question draws a two-sided answer - so what this module reads is the
 * CONTENT: which condition, how often, and whether it is a situation the
 * buyer is already in (wall_wording.ts).
 *
 * Inputs are the run's shared rules capture (run_themes.ts): the toward pool
 * (the client side, the default "otherwise" clause left out) and each
 * group's per-answer statements. Rows are counted at ANSWER grain over the
 * lost answers only (answers whose pick is the rival), so every example is an
 * answer that picked the rival and still states the condition toward the
 * client. With a theme map the rows are the run's dt4 themes (attributed per
 * statement exactly as themeTreeAnswers attributes them - no new theme call);
 * without one (keyless, a failed pass) the raw condition groups.
 *
 * Imported by analysis_map.ts (the per-matchup block on a lost head-to-head
 * cell) and summary_insights.ts (the pooled finding); imports neither.
 */

/** A matchup needs this many lost answers before its exceptions are read. */
export const EXC_MIN_LOST = 20;
/** ... and at least this share of them stating a case for the client. */
export const EXC_MIN_SHARE = 0.5;
/** Rows per matchup. */
export const EXC_ROWS = 3;
/** Examples per row. */
export const EXC_REFS = 3;

/** Mirror of analysis_map.ts classify() on a head-to-head cell (won vs lost
 * over the answers that pick one of the two): true when the verdict is
 * "theirs". Kept in step with classify's floors (MIN_SIDE 20, MATERIAL 0.15). */
export function lostOnBalance(won: number, lost: number): boolean {
  const d = won + lost;
  if (d < 20 || d === 0) return false;
  const B = cell(won, d);
  const T = cell(lost, d);
  if (B.low > T.high) return false;
  if (T.low > B.high) return true;
  const bs = won / d;
  const ts = lost / d;
  if ((bs >= 0.15 && ts >= 0.15) || (bs < 0.15 && ts < 0.15)) return false;
  return lost > won;
}

export interface ExceptionRow {
  label: string;
  /** Distinct lost answers stating it. */
  ids: Set<string>;
  /** A situation the buyer is already in (the possession test). */
  wall: boolean;
  /** Each lost answer's statement under the row (one per answer). */
  statements: RefCandidate[];
  /** The member wordings, most-stated first (themed rows; the raw group's own label otherwise). */
  members: string[];
}

/**
 * The lost answers stating ANY client-side condition, read off the answers'
 * own rules (`toward` decides a rule's side; the default "otherwise" clause
 * never counts) - not off the pooled groups, which list only conditions
 * stated by 2+ answers and so undercount the share.
 */
export function anyException(
  rows: { code: { response_id: string; schema: string; decision_rules: { condition: string; choice: string; product?: string }[] | null } }[],
  toward: (rule: { condition: string; choice: string; product?: string }, schema: string) => boolean
): Set<string> {
  const out = new Set<string>();
  for (const r of rows)
    if ((r.code.decision_rules ?? []).some((rule) => rule.condition.trim() !== "" && !isDefaultCondition(rule.condition) && toward(rule, r.code.schema))) out.add(r.code.response_id);
  return out;
}

/**
 * The client-side conditions stated in a set of lost answers, from the
 * pooled toward groups. `any` = the lost answers stating any POOLED group
 * (use anyException for the share); rows sorted by answers, then label.
 */
export function exceptionRows(
  lost: Set<string>,
  towardPool: RuleGroup[],
  answerRules: AnswerRules,
  tm: ThemeMap | null,
  sitOf: Map<string, string>
): { any: Set<string>; rows: ExceptionRow[] } {
  const any = new Set<string>();
  type Acc = { label: string; ids: Set<string>; st: Map<string, RefCandidate>; members: Map<string, number> };
  const by = new Map<string, Acc>();
  for (const g of towardPool) {
    const said = answerRules.get(g.id);
    if (!said) continue;
    for (const [rid, ar] of said) {
      if (!lost.has(rid)) continue;
      any.add(rid);
      let key = `g:${g.id}`;
      let label = g.label;
      if (tm) {
        const s = tm.stOf.get(slKey(sitOf.get(ar.intent) ?? EVERY_BUYER, g.label));
        if (s !== undefined) {
          key = `t:${tm.totOf[s]}`;
          label = tm.totName[tm.totOf[s]];
        }
      }
      const acc = by.get(key) ?? { label, ids: new Set<string>(), st: new Map(), members: new Map() };
      by.set(key, acc);
      acc.ids.add(rid);
      acc.members.set(g.label, (acc.members.get(g.label) ?? 0) + 1);
      if (!acc.st.has(rid)) acc.st.set(rid, { id: rid, find: ar.said, model: ar.model, cards: ar.cards, mixed: ar.mixed });
    }
  }
  const rows = [...by.values()].map((a) => {
    const members = [...a.members.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([l]) => l);
    // A themed row is fixed when its name is possession-shaped or its largest member wording is.
    const wall = isWallWording([a.label], null) || (members.length > 0 && isWallWording([members[0]], null));
    return { label: a.label, ids: a.ids, wall, statements: [...a.st.values()], members };
  });
  rows.sort((a, b) => b.ids.size - a.ids.size || a.label.localeCompare(b.label));
  return { any, rows };
}

/** A row's examples: answers that picked the rival and state the row toward
 * the client, one per assistant first, best fit to the row name; each says
 * where it sends the buyer (`to`) and what the answer actually picked. */
export function exceptionRefs(row: ExceptionRow, picked: string | ((responseId: string) => string | undefined), k = EXC_REFS): AnswerRef[] {
  return pickRefs(row.statements, row.label, k).map((r) => {
    const p = typeof picked === "string" ? picked : picked(r.responseId);
    return p ? { ...r, picked: p } : r;
  });
}
