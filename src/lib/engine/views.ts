/**
 * The per-type view router (2026-10-27, Tyler; design
 * DASHBOARD_STORAGE_DESIGN_2026-10-27.md section 3). Each answer's view is
 * decided by its cell's stage and angle - never by qtype, which is the
 * labeling/coding key: qtype files offensive alternatives as open_choice
 * and repertoire as doubt, while CODING_DECISIONS section 12 gives both
 * their own views. The headline rates come only from views marked
 * `headline` (the presentation rule, section 8).
 */

/** The contract schemas a code row can carry (v2 + Set C). */
export type CodeSchema =
  | "awareness_pr" | "awareness_ce" | "choice" | "criteria" | "premium" | "value"
  | "alt_defensive" | "objections" | "churn_renewal"
  | "business_case" | "expansion" | "ecosystem" | "advocacy";

export type ViewKey =
  | "headline"
  | "premium_tier"
  | "repertoire"
  | "head_to_head_entity"
  | "head_to_head_class"
  | "offensive_capture"
  | "defensive_hold"
  | "value"
  | "criteria_taught"
  | "awareness_routing"
  | "awareness_explainer"
  | "doubt"
  | "keep_or_leave"
  | "settled_business_case"
  | "settled_expansion"
  | "settled_ecosystem"
  | "settled_advocacy";

/** The schema the labeler's builder (labeling/build_batch.mts v2SchemaOf,
 * frozen 2026-10-22) and the Set C mode give a cell. Kept identical by the
 * dashboard fixture's per-row check. null = retired or unknown stage. */
export function schemaOf(stage: string, angle: string | null | undefined): CodeSchema | null {
  switch (stage) {
    case "problem_recognition": return "awareness_pr";
    case "category_education": return "awareness_ce";
    case "discovery":
    case "use_case":
    case "social_validation":
    case "repertoire":
    case "comparison": return "choice";
    case "criteria": return "criteria";
    case "premium_worth": return "premium";
    case "pricing": return "value";
    case "objections": return "objections";
    case "churn_triggers":
    case "renewal": return "churn_renewal";
    // Generic-angle alternatives share the offensive choice shape (as in the builder).
    case "alternatives": return angle === "defensive" ? "alt_defensive" : "choice";
    case "business_case":
    case "expansion":
    case "ecosystem":
    case "advocacy": return stage;
    default: return null;
  }
}

/** The views an answer counts in. Usually one; premium_worth counts in the
 * headline AND its own tier view (Tyler 2026-10-27). [] = not shown
 * (retired stages: shortlist, feature_screening, problem_resolution). */
export function viewsOf(stage: string, angle: string | null | undefined): ViewKey[] {
  switch (stage) {
    case "discovery":
    case "use_case":
    case "social_validation": return ["headline"];
    case "premium_worth": return ["headline", "premium_tier"];
    case "repertoire": return ["repertoire"];
    case "comparison": return [angle === "class" ? "head_to_head_class" : "head_to_head_entity"];
    case "alternatives": return [angle === "defensive" ? "defensive_hold" : "offensive_capture"];
    case "pricing": return ["value"];
    case "criteria": return ["criteria_taught"];
    case "problem_recognition": return ["awareness_routing"];
    case "category_education": return ["awareness_explainer"];
    case "objections": return ["doubt"];
    case "churn_triggers":
    case "renewal": return ["keep_or_leave"];
    case "business_case": return ["settled_business_case"];
    case "expansion": return ["settled_expansion"];
    case "ecosystem": return ["settled_ecosystem"];
    case "advocacy": return ["settled_advocacy"];
    default: return [];
  }
}

/** The fields each schema asks (null-vs-[] rule: a field outside this list
 * is null on the row; inside it, an empty answer is [] or a value). The
 * four mechanical flags, quote and mentions ride every schema. */
const UNIVERSAL = ["clarification_requested", "includes_prices", "includes_specs", "quote", "mentions"] as const;
export const SCHEMA_FIELDS: Record<CodeSchema, readonly string[]> = {
  awareness_pr: [...UNIVERSAL, "category_routed", "topics", "uncoded"],
  awareness_ce: [...UNIVERSAL, "category_routed", "topics", "uncoded"],
  choice: [...UNIVERSAL, "outcome", "top_pick", "reasons", "uncoded"],
  criteria: [...UNIVERSAL, "reasons", "uncoded"],
  premium: [...UNIVERSAL, "outcome", "top_pick", "tier_stance", "reasons", "uncoded"],
  value: [...UNIVERSAL, "worth_it", "reasons", "uncoded"],
  alt_defensive: [...UNIVERSAL, "keep_or_leave", "destinations", "reasons", "uncoded"],
  objections: [...UNIVERSAL, "proceed_or_avoid", "destinations", "premise_verdict", "premise_quote", "reasons", "uncoded"],
  churn_renewal: [...UNIVERSAL, "keep_or_leave", "destinations", "premise_verdict", "premise_quote", "reasons", "uncoded"],
  // Set C: premise is asked on advocacy only (its cells quote a critic);
  // the other three stages' "n/a" is stored as not asked.
  business_case: [...UNIVERSAL, "relationship_verdict", "case_strength", "redirect_to", "reasons", "uncoded"],
  expansion: [...UNIVERSAL, "relationship_verdict", "growth_stance", "redirect_to", "reasons", "uncoded"],
  ecosystem: [...UNIVERSAL, "relationship_verdict", "pairings", "redirect_to", "reasons", "uncoded"],
  advocacy: [...UNIVERSAL, "relationship_verdict", "case_strength", "redirect_to", "premise_verdict", "premise_quote", "reasons", "uncoded"],
};
