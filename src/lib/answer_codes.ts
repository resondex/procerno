import type { AnswerCodes } from "./types";

/**
 * answer_codes (2026-10-27): one answer's codes under the v2 / Set C
 * contracts, keyed by (response_id, source). Both stores read and write
 * through these helpers so the column list cannot drift between them.
 * Design: DASHBOARD_STORAGE_DESIGN_2026-10-27.md.
 */

/** Plain TEXT columns, stored as-is. */
const TEXT_COLS = [
  "response_id", "source", "run_id", "project_id", "contract", "schema",
  "outcome", "top_pick", "tier_stance", "worth_it", "proceed_or_avoid",
  "keep_or_leave", "premise_verdict", "category_routed",
  "relationship_verdict", "case_strength", "growth_stance",
  "quote", "premise_quote", "uncoded",
] as const;
/** Booleans, stored as INTEGER 0/1. */
const FLAG_COLS = ["clarification_requested", "includes_prices", "includes_specs"] as const;
/** Lists and objects, stored as TEXT JSON. */
const JSON_COLS = [
  "reasons", "topics", "destinations", "redirect_to", "pairings", "mentions",
  "decision_rules",
] as const;

export const ANSWER_CODE_COLUMNS: readonly string[] = [...TEXT_COLS, ...FLAG_COLS, ...JSON_COLS];

/** Column DDL shared by both stores (TEXT/INTEGER mean the same in each). */
export const ANSWER_CODE_DDL = ANSWER_CODE_COLUMNS.map((c) =>
  `${c} ${(FLAG_COLS as readonly string[]).includes(c) ? "INTEGER" : "TEXT"}${
    ["response_id", "source", "run_id", "project_id", "contract", "schema"].includes(c) ? " NOT NULL" : ""
  }`
).join(",\n  ");

/** AnswerCodes -> a row of column values, in ANSWER_CODE_COLUMNS order. */
export function answerCodesToRow(c: AnswerCodes): Record<string, string | number | null> {
  const row: Record<string, string | number | null> = {};
  for (const k of TEXT_COLS) row[k] = c[k] ?? null;
  for (const k of FLAG_COLS) row[k] = c[k] == null ? null : c[k] ? 1 : 0;
  for (const k of JSON_COLS) row[k] = c[k] == null ? null : JSON.stringify(c[k]);
  return row;
}

/** A stored row -> AnswerCodes. */
export function answerCodesFromRow(r: Record<string, unknown>): AnswerCodes {
  const out: Record<string, unknown> = {};
  for (const k of TEXT_COLS) out[k] = (r[k] as string | null | undefined) ?? null;
  for (const k of FLAG_COLS) out[k] = r[k] == null ? null : Number(r[k]) === 1;
  for (const k of JSON_COLS) out[k] = r[k] == null ? null : JSON.parse(r[k] as string);
  return out as unknown as AnswerCodes;
}
