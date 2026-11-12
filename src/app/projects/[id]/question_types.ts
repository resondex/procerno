import { POOLS, POOL_LABEL as ENGINE_POOL_LABEL } from "@/lib/engine/measures";
import { viewsOf, type ViewKey } from "@/lib/engine/views";

/**
 * The dashboard's names for question types (2026-11-11): one place for the
 * labels Build a table and Prompt health show, matching the Map's row names.
 * The engine's contract names stay in measures.ts (POOLS) and are the
 * fallback for any type without an override here.
 */
export const QUESTION_TYPE_LABEL: Record<ViewKey, string> = {
  ...ENGINE_POOL_LABEL,
  // The Map's own row names (2026-11-11), so a pool reads the same in Build
  // a table, By question type and Prompt health as on the Map.
  awareness_routing: "Awareness",
  awareness_explainer: "Learning the category",
  criteria_taught: "Criteria taught",
  head_to_head_entity: "Head-to-head",
  offensive_capture: "Rivals' customers switching",
  repertoire: "Habit - stick with you",
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
