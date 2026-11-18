/**
 * The fact layer's pure basics (split from answer_facts.ts, 2026-11-17, fact layer step 6): the question types and
 * the verdict vocabularies. No imports, so the browser (the Data page, which counts its tables with the same
 * measure book) can read them without pulling in the server-side answer build.
 */

/* ------------------------------- question types ------------------------------- */

/** The question types the fact layer counts in. One per Map row, except What to buy, which is two types
 * (a buyer's general question and a question about one job), and the worries, split by stage. */
export const QUESTION_TYPES = [
  "discovery",
  "use_case",
  "social_validation",
  "premium_worth",
  "repertoire",
  "comparison_entity",
  "comparison_class",
  "switching",
  "looking_around",
  "pricing",
  "criteria",
  "problem_recognition",
  "category_education",
  "objections",
  "churn_triggers",
  "renewal",
  "business_case",
  "expansion",
  "ecosystem",
  "advocacy",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** A cell's question type from its stage and angle; null = a retired or unknown stage (never counted). */
export function questionTypeOf(stage: string, angle: string | null | undefined): QuestionType | null {
  switch (stage) {
    case "discovery":
    case "use_case":
    case "social_validation":
    case "premium_worth":
    case "repertoire":
    case "pricing":
    case "criteria":
    case "problem_recognition":
    case "category_education":
    case "objections":
    case "churn_triggers":
    case "renewal":
    case "business_case":
    case "expansion":
    case "ecosystem":
    case "advocacy":
      return stage;
    case "comparison":
      return angle === "class" ? "comparison_class" : "comparison_entity";
    case "alternatives":
      return angle === "defensive" ? "looking_around" : "switching";
    default:
      return null;
  }
}


export const VERDICT_FIELDS = [
  "outcome",
  "tier_stance",
  "worth_it",
  "proceed_or_avoid",
  "keep_or_leave",
  "premise_verdict",
  "category_routed",
  "relationship_verdict",
  "case_strength",
  "growth_stance",
] as const;
export type VerdictField = (typeof VERDICT_FIELDS)[number];

/** The values each verdict may carry. case_strength carries both settled vocabularies (business case
 * strong / hedged / undermined, answering a critic strong / partial / concedes). */
export const VERDICT_VALUES: Record<VerdictField, readonly string[]> = {
  outcome: ["pick", "conditional", "no_pick", "clarification"],
  tier_stance: ["premium", "basic", "balanced", "none"],
  worth_it: ["yes", "depends", "no"],
  proceed_or_avoid: ["proceed", "avoid", "undecided"],
  keep_or_leave: ["keep", "leave", "undecided"],
  premise_verdict: ["confirms", "rebuts", "mixed"],
  category_routed: ["category", "adjacent", "none"],
  relationship_verdict: ["strengthens", "neutral", "weakens"],
  case_strength: ["strong", "hedged", "undermined", "partial", "concedes"],
  growth_stance: ["backs", "neutral", "redirects"],
};

