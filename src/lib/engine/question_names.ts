/**
 * The customer-facing names of the question rows (2026-11-12, the Map's
 * plain-wording pass): ONE list, read by the analysis map's row labels and by
 * the dashboard's question-type names (question_types.ts - Build a table,
 * search, the question check), so a row reads the same everywhere. Keyed by
 * the map's row slug.
 */
export const ROW_NAME = {
  open: "What to buy",
  social: "What's popular",
  premium: "Premium vs basic",
  awareness: "Spotting the problem",
  explainer: "Learning the category",
  value: "Value",
  criteria: "What to look for",
  h2h: "Head-to-head",
  leavers: "Rivals' customers switching",
  buyers: "Buyers' worries",
  customers: "Customers' worries",
  hold: "Your customers looking around",
  repertoire: "Habit",
  settled: "Your customers making your case",
} as const;

export type RowSlug = keyof typeof ROW_NAME;
