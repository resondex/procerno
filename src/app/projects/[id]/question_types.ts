import { DATA_POOLS, dataPoolOf, type DataPoolKey } from "@/lib/engine/facts/measure_book";
import { questionTypeOf as factQuestionType } from "@/lib/engine/facts/basics";
import { ROW_NAME } from "@/lib/engine/question_names";

/**
 * The dashboard's names for groups of questions (2026-11-11; on the fact layer's groups since 2026-11-17, step 6):
 * one place for the labels Build a table, search and the question check show, matching the Map's row names
 * (question_names.ts). The groups are the measure book's (facts/measure_book.ts DATA_POOLS) - ruling 7: What to buy
 * is a buyer's question and a question about one job; What's popular and Premium vs basic are their own groups.
 */
export const QUESTION_TYPE_LABEL: Record<DataPoolKey, string> = {
  problem: ROW_NAME.awareness,
  learning: ROW_NAME.explainer,
  what_to_buy: ROW_NAME.open,
  popular: ROW_NAME.social,
  criteria: ROW_NAME.criteria,
  premium: ROW_NAME.premium,
  h2h: ROW_NAME.h2h,
  h2h_class: "Head-to-head - classes",
  switching: ROW_NAME.leavers,
  buyers_worries: ROW_NAME.buyers,
  value: ROW_NAME.value,
  customers_worries: ROW_NAME.customers,
  looking_around: ROW_NAME.hold,
  habit: ROW_NAME.repertoire,
  business_case: "Business case",
  expansion: "Expansion",
  ecosystem: "What to use alongside you",
  advocacy: "Answering a critic",
};

/** Groups in journey order. */
export const QUESTION_TYPE_ORDER: readonly DataPoolKey[] = DATA_POOLS.map((p) => p.key);

/** A cell's group of questions. null = a retired stage. */
export function questionTypeOf(stage: string, angle: string | null | undefined): DataPoolKey | null {
  const t = factQuestionType(stage, angle);
  return t ? dataPoolOf(t) : null;
}
