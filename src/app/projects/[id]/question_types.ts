import { POOLS, POOL_LABEL as ENGINE_POOL_LABEL } from "@/lib/engine/measures";
import { ROW_NAME } from "@/lib/engine/question_names";
import { viewsOf, type ViewKey } from "@/lib/engine/views";

/**
 * The dashboard's names for question types (2026-11-11): one place for the
 * labels Build a table and Prompt health show, matching the Map's row names.
 * The engine's contract names stay in measures.ts (POOLS) and are the
 * fallback for any type without an override here.
 */
export const QUESTION_TYPE_LABEL: Record<ViewKey, string> = {
  ...ENGINE_POOL_LABEL,
  // The Map's own row names (question_names.ts, one list since 2026-11-12),
  // so a pool reads the same in Build a table, search and the question check
  // as on the Map. Settled-customer pools keep their own specific names.
  headline: ROW_NAME.open,
  awareness_routing: ROW_NAME.awareness,
  awareness_explainer: ROW_NAME.explainer,
  criteria_taught: ROW_NAME.criteria,
  premium_tier: ROW_NAME.premium,
  head_to_head_entity: ROW_NAME.h2h,
  offensive_capture: ROW_NAME.leavers,
  doubt: ROW_NAME.buyers,
  value: ROW_NAME.value,
  keep_or_leave: ROW_NAME.customers,
  defensive_hold: ROW_NAME.hold,
  repertoire: ROW_NAME.repertoire,
};

/** Question types in journey order. */
export const QUESTION_TYPE_ORDER: readonly ViewKey[] = POOLS.map((p) => p.key);

/** A cell's question type: its view (views.ts). Premium vs basic counts in
 * the headline too, but it reads as its own type. null = a retired stage. */
export function questionTypeOf(stage: string, angle: string | null | undefined): ViewKey | null {
  const views = viewsOf(stage, angle);
  if (views.includes("premium_tier")) return "premium_tier";
  return views[0] ?? null;
}
