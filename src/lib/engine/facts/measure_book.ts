/**
 * Layer 2 of the fact layer (FACT_LAYER_DESIGN_2026-11-17.md, step 2): ONE rulebook of measures. Each measure
 * states once its plain name, what counts (the numerator), out of what (the base), the question types it is legal
 * on - asking for it on any other type is refused with an error naming the measure and the type, never
 * approximated - and how it is printed.
 *
 * The rulings it encodes (section 5 of the design):
 *  2  an argument "when another brand is picked" = another pick of a brand in analysis;
 *  3  price "instead": each price answer in one bucket (a rival, else the tracker's own option, else nowhere);
 *  5  problem routing: "adjacent" is its own share, "none" is its own share (never folded into "outside");
 *  6  a pick counts as named and recommended, everywhere (answer_facts.ts sets it);
 *  7  "what to buy, all buyers" = discovery + use case only (fact.ts WHAT_TO_BUY_ALL);
 *  8  share of picks is out of picks of brands in analysis; out-of-analysis and out-of-category picks are their
 *     own buckets; a brand outside of analysis is never a subject;
 *  9  "agrees the worry is fair" is out of the answers that agree, partly agree or disagree.
 *
 * Pure: reads AnswerFact records only.
 */
import type { AnswerFact, AnswerFactSet, QuestionType } from "./answer_facts";
import { QUESTION_TYPES } from "./answer_facts";

/* ------------------------------- floors ------------------------------- */

/**
 * The floors and tests, in one table. The values are today's card values (panel_build.ts, panel_tags.ts); nothing
 * reads this table yet. Conflicting values found in the inventory (ENGINE_INVENTORY_2026-11-17.md section 4 and
 * the cards report), listed so the choice is visible when the screens move onto this table:
 *  - minimum answers: 20 on a card and in the Overview's findings (PANEL_MIN, MIN_BASE), but 20 a side in the
 *    Map's lift and contest tests (MIN_SIDE), 10 a side for weighs and AI-company sections (ARGS_MIN), 5 for an
 *    explanation (DETAIL_MIN), 3 for a drawn row (ROW_MIN);
 *  - an AI-company breakdown: 3 answers per company in one card section (vendorItems), 10 in the others;
 *  - "which argument wins": 20 a side with 2% incidence; 10 a side with 5%; 10 a side with no floor; and two
 *    more variants (five in all);
 *  - "one AI company supplies the picks": the Map's watch badge (40% of picks, 10 picks) against the Overview's
 *    finding (40% of picks, 3 engines);
 *  - "converts": the visibility view's level line (ruling 11) against The diagnosis' quarter-of-named rule;
 *  - "close": under 3 points OR inside the Wilson range on the cards, ranges apart (non-overlap) in the findings.
 */
export const FLOORS = {
  /** A card with fewer answers is thin and drops its tags. */
  minAnswers: 20,
  /** A drawn row needs this many answers. */
  rowMin: 3,
  /** An explanation needs this many answers. */
  detailMin: 5,
  /** A side needs this many answers carrying arguments (weighs, AI-company sections). */
  argsMin: 10,
  /** A brand is listed among a card's competitors with this many picks. */
  brandFloor: 5,
  /** A case table needs this many answers on a side, and a gap of this many points between sides. */
  caseMin: 10,
  gapMin: 0.1,
  /** Two shares are close under this many points, or when one sits inside the other's 95% range. */
  closePts: 3,
  /** "Well below" / "well above": a ratio at or past these. */
  wellBelowRatio: 0.6,
  wellAboveRatio: 1.6,
  /** One-line takeaways (panel_tags.ts). */
  majorityPct: 50,
  leanRatio: 1.5,
  leanPts: 5,
  leanGapPts: 8,
  noSideFirstPct: 70,
  nowhereClearPct: 60,
  /** Ranges apart = non-overlapping 95% Wilson ranges (the findings' test). */
  apartZ: 1.96,
} as const;

/* ------------------------------- types ------------------------------- */

/** "ai" = the measure is about the answer, not a brand; "rival" = each answer's own named rival (head-to-heads,
 * switching); otherwise a brand's dictionary entry id. */
export type SubjectRef = string;

export interface MeasureCtx {
  set: AnswerFactSet;
  /** The subject's brand key (null for "ai" / "rival"). */
  brand: string | null;
  /** True when the subject is "rival" (each answer's own named rival). */
  rival: boolean;
  /** The argument code an argument measure reads. */
  arg: string | null;
}

export interface Measure {
  id: string;
  name: string;
  /** What the subject may be. */
  subject: "brand" | "ai" | "brand_or_rival";
  /** Reads an argument code (passed in the subject as "<subject>/arg:<code>"). */
  arg?: boolean;
  /** The question types it is legal on; any other type is refused. */
  legal: readonly QuestionType[];
  /** The base: which answers count in the denominator. */
  base: (f: AnswerFact, c: MeasureCtx) => boolean;
  /** The numerator, among the base. */
  hit: (f: AnswerFact, c: MeasureCtx) => boolean;
  /** "whole": whole points, "<1%" for anything under half a point; "fine": one decimal under 10% (the cards'
   * "picked, of all answers"). */
  print: "whole" | "fine";
}

/* ------------------------------- type groups ------------------------------- */

const ALL: readonly QuestionType[] = QUESTION_TYPES;
/** Types whose schema asks the outcome and the pick. */
export const PICK_TYPES: readonly QuestionType[] = ["discovery", "use_case", "social_validation", "premium_worth", "repertoire", "comparison_entity", "comparison_class", "switching"];
const H2H: readonly QuestionType[] = ["comparison_entity", "comparison_class"];
const KEEP: readonly QuestionType[] = ["churn_triggers", "renewal", "looking_around"];
const PREMISE: readonly QuestionType[] = ["objections", "churn_triggers", "renewal", "advocacy"];
const DESTS: readonly QuestionType[] = ["objections", "churn_triggers", "renewal", "looking_around"];
const REDIRECT: readonly QuestionType[] = ["business_case", "expansion", "ecosystem", "advocacy"];
const ROUTED: readonly QuestionType[] = ["problem_recognition", "category_education"];
const SETTLED: readonly QuestionType[] = ["business_case", "expansion", "ecosystem", "advocacy"];

/* ------------------------------- helpers ------------------------------- */

const all = () => true;
const named = (f: AnswerFact, key: string | null) => !!key && f.brands.some((b) => b.key === key);
const recommended = (f: AnswerFact, key: string | null) => !!key && f.brands.some((b) => b.key === key && b.recommended);
const pickIs = (f: AnswerFact, key: string | null) => !!key && f.pick.state !== "none" && f.pick.key === key;
const inAnalysisPick = (f: AnswerFact) => f.pick.state === "in_analysis";
/** The brand a subject means on this answer ("rival" = the answer's own named rival). */
const subjectKey = (f: AnswerFact, c: MeasureCtx) => (c.rival ? f.rival?.key ?? null : c.brand);
const rivalPick = (f: AnswerFact) => !!f.rival && pickIs(f, f.rival.key);
const youPick = (f: AnswerFact, c: MeasureCtx) => pickIs(f, c.set.target.key);
const v = (f: AnswerFact, field: keyof AnswerFact["verdicts"], ...values: string[]) => values.includes(f.verdicts[field] ?? "");
const judged = (f: AnswerFact) => v(f, "premise_verdict", "confirms", "mixed", "rebuts");
const argues = (f: AnswerFact, c: MeasureCtx) => !!c.arg && (f.args ?? []).includes(c.arg);
const verdict = (id: string, name: string, legal: readonly QuestionType[], field: keyof AnswerFact["verdicts"], values: string[]): Measure => ({
  id,
  name,
  subject: "ai",
  legal,
  base: all,
  hit: (f) => v(f, field, ...values),
  print: "whole",
});

/* ------------------------------- the book ------------------------------- */

export const MEASURES: readonly Measure[] = [
  /* -- brand measures -- */
  { id: "named", name: "Named", subject: "brand", legal: ALL, base: all, hit: (f, c) => named(f, c.brand), print: "whole" },
  { id: "recommended", name: "Recommended", subject: "brand", legal: ALL, base: all, hit: (f, c) => recommended(f, c.brand), print: "whole" },
  { id: "picked", name: "Picked, of all answers", subject: "brand", legal: PICK_TYPES, base: all, hit: (f, c) => pickIs(f, c.brand), print: "fine" },
  { id: "share_of_picks", name: "Share of picks", subject: "brand", legal: PICK_TYPES, base: inAnalysisPick, hit: (f, c) => pickIs(f, c.brand), print: "whole" },
  { id: "converts", name: "Recommendations that end as the pick", subject: "brand", legal: PICK_TYPES, base: (f, c) => recommended(f, c.brand), hit: (f, c) => pickIs(f, c.brand), print: "whole" },
  { id: "named_not_recommended", name: "Named but not recommended", subject: "brand", legal: ALL, base: all, hit: (f, c) => named(f, c.brand) && !recommended(f, c.brand), print: "whole" },
  {
    id: "negative_when_named_not_recommended",
    name: "Of those named but not recommended, named as one to avoid",
    subject: "brand",
    legal: ALL,
    base: (f, c) => named(f, c.brand) && !recommended(f, c.brand),
    hit: (f, c) => f.brands.some((b) => b.key === c.brand && b.negative),
    print: "whole",
  },
  {
    id: "recommended_lost",
    name: "Recommended, but another brand is the pick",
    subject: "brand",
    legal: PICK_TYPES,
    base: (f, c) => recommended(f, c.brand),
    hit: (f, c) => inAnalysisPick(f) && !pickIs(f, c.brand),
    print: "whole",
  },
  {
    id: "recommended_no_pick",
    name: "Recommended, and no single pick",
    subject: "brand",
    legal: PICK_TYPES,
    base: (f, c) => recommended(f, c.brand),
    hit: (f) => f.pick.state === "none",
    print: "whole",
  },
  {
    id: "names_any_brand",
    name: "The answer names any brand",
    subject: "ai",
    legal: ALL,
    base: all,
    hit: (f) => f.brands.some((b) => b.bucket === "in_analysis"),
    print: "whole",
  },
  {
    id: "named_when_any",
    name: "Named, when the answer names a brand",
    subject: "brand",
    legal: ALL,
    base: (f) => f.brands.some((b) => b.bucket === "in_analysis"),
    hit: (f, c) => named(f, c.brand),
    print: "whole",
  },

  /* -- the pick, about the AI -- */
  { id: "commit_rate", name: "Commits to one brand in analysis", subject: "ai", legal: PICK_TYPES, base: all, hit: inAnalysisPick, print: "whole" },
  { id: "picks_outside_analysis", name: "Picks a brand outside of analysis", subject: "ai", legal: PICK_TYPES, base: all, hit: (f) => f.pick.state === "outside_analysis", print: "whole" },
  { id: "picks_outside_category", name: "Picks something outside the category", subject: "ai", legal: PICK_TYPES, base: all, hit: (f) => f.pick.state === "outside_category", print: "whole" },
  verdict("outcome_conditional", "Gives conditions, no pick", PICK_TYPES, "outcome", ["conditional"]),
  verdict("outcome_no_pick", "Picks nothing", PICK_TYPES, "outcome", ["no_pick"]),

  /* -- head-to-heads (the rival is a fact of the question) -- */
  { id: "h2h_win", name: "The pick (head to head)", subject: "brand_or_rival", legal: H2H, base: all, hit: (f, c) => pickIs(f, subjectKey(f, c)), print: "whole" },
  { id: "h2h_decided", name: "Picks one of the two", subject: "ai", legal: H2H, base: all, hit: (f, c) => youPick(f, c) || rivalPick(f), print: "whole" },
  { id: "h2h_neither", name: "Picks neither of the two", subject: "ai", legal: H2H, base: all, hit: (f, c) => !youPick(f, c) && !rivalPick(f), print: "whole" },
  { id: "h2h_another", name: "Picks another brand", subject: "ai", legal: H2H, base: all, hit: (f, c) => f.pick.state !== "none" && !youPick(f, c) && !rivalPick(f), print: "whole" },
  { id: "h2h_no_pick", name: "No single pick", subject: "ai", legal: H2H, base: all, hit: (f) => f.pick.state === "none", print: "whole" },
  {
    id: "h2h_two_way",
    name: "Two-way record",
    subject: "brand_or_rival",
    legal: H2H,
    base: (f, c) => youPick(f, c) || rivalPick(f),
    hit: (f, c) => {
      const k = subjectKey(f, c);
      return pickIs(f, k) && (k === c.set.target.key || k === f.rival?.key);
    },
    print: "whole",
  },

  /* -- worries and staying -- */
  verdict("go_ahead", "Go ahead", ["objections"], "proceed_or_avoid", ["proceed"]),
  verdict("steer_clear", "Steer clear", ["objections"], "proceed_or_avoid", ["avoid"]),
  verdict("buyer_no_side", "No side (go ahead or steer clear)", ["objections"], "proceed_or_avoid", ["undecided"]),
  verdict("stay", "Stay", KEEP, "keep_or_leave", ["keep"]),
  verdict("leave", "Leave", KEEP, "keep_or_leave", ["leave"]),
  verdict("customer_no_side", "No side (stay or leave)", KEEP, "keep_or_leave", ["undecided"]),
  { id: "agrees", name: "Agrees the worry is fair", subject: "ai", legal: PREMISE, base: judged, hit: (f) => v(f, "premise_verdict", "confirms"), print: "whole" },
  { id: "partly_agrees", name: "Partly agrees", subject: "ai", legal: PREMISE, base: judged, hit: (f) => v(f, "premise_verdict", "mixed"), print: "whole" },
  { id: "disagrees", name: "Says the worry is wrong", subject: "ai", legal: PREMISE, base: judged, hit: (f) => v(f, "premise_verdict", "rebuts"), print: "whole" },
  { id: "sent_to", name: "Named as where to go", subject: "brand", legal: DESTS, base: all, hit: (f, c) => !!f.sent?.brands.some((b) => b.key === c.brand), print: "whole" },
  { id: "sent_to_any", name: "Names another brand to go to", subject: "ai", legal: DESTS, base: all, hit: (f) => (f.sent?.brands.length ?? 0) > 0, print: "whole" },
  { id: "redirected_to", name: "Redirected to", subject: "brand", legal: REDIRECT, base: all, hit: (f, c) => !!f.sent?.brands.some((b) => b.key === c.brand), print: "whole" },

  /* -- price questions (ruling 3) -- */
  verdict("worth_yes", "Worth it", ["pricing"], "worth_it", ["yes"]),
  verdict("worth_depends", "It depends", ["pricing"], "worth_it", ["depends"]),
  verdict("worth_no", "Not worth it", ["pricing"], "worth_it", ["no"]),
  { id: "instead_rival", name: "Points to a rival", subject: "ai", legal: ["pricing"], base: all, hit: (f) => f.price?.bucket === "rival", print: "whole" },
  { id: "instead_own", name: "Points only to your own cheaper option", subject: "ai", legal: ["pricing"], base: all, hit: (f) => f.price?.bucket === "own", print: "whole" },
  { id: "instead_nowhere", name: "Points nowhere", subject: "ai", legal: ["pricing"], base: all, hit: (f) => f.price?.bucket === "nowhere", print: "whole" },
  { id: "named_instead", name: "Recommended instead", subject: "brand", legal: ["pricing"], base: all, hit: (f, c) => !!f.price?.rivals.some((r) => r.key === c.brand), print: "whole" },

  /* -- problem routing (ruling 5) -- */
  verdict("routed_category", "Points to the category", ROUTED, "category_routed", ["category"]),
  verdict("routed_adjacent", "Points to something adjacent", ROUTED, "category_routed", ["adjacent"]),
  verdict("routed_none", "Points nowhere", ROUTED, "category_routed", ["none"]),

  /* -- premium vs basic -- */
  verdict("tier_premium", "Sides with premium", ["premium_worth"], "tier_stance", ["premium"]),
  verdict("tier_basic", "Sides with basic", ["premium_worth"], "tier_stance", ["basic"]),
  verdict("tier_balanced", "Balanced", ["premium_worth"], "tier_stance", ["balanced"]),
  verdict("tier_none", "Takes no tier stance", ["premium_worth"], "tier_stance", ["none"]),

  /* -- settled customers -- */
  verdict("relationship_strengthens", "Strengthens the relationship", SETTLED, "relationship_verdict", ["strengthens"]),
  verdict("relationship_neutral", "Leaves the relationship where it is", SETTLED, "relationship_verdict", ["neutral"]),
  verdict("relationship_weakens", "Weakens the relationship", SETTLED, "relationship_verdict", ["weakens"]),
  verdict("case_strong", "A strong case", ["business_case", "advocacy"], "case_strength", ["strong"]),
  verdict("case_hedged", "A hedged case", ["business_case"], "case_strength", ["hedged"]),
  verdict("case_undermined", "Argues against you", ["business_case"], "case_strength", ["undermined"]),
  verdict("case_partial", "A partial answer", ["advocacy"], "case_strength", ["partial"]),
  verdict("case_concedes", "Drops your side", ["advocacy"], "case_strength", ["concedes"]),
  verdict("growth_backs", "Backs it", ["expansion"], "growth_stance", ["backs"]),
  verdict("growth_neutral", "Neither backs nor discourages", ["expansion"], "growth_stance", ["neutral"]),
  verdict("growth_redirects", "Points them elsewhere", ["expansion"], "growth_stance", ["redirects"]),

  /* -- arguments (ruling 2) -- */
  { id: "argues", name: "Argues it", subject: "ai", arg: true, legal: ALL, base: all, hit: argues, print: "whole" },
  { id: "argues_when_picked", name: "Argues it, when the brand is the pick", subject: "brand", arg: true, legal: PICK_TYPES, base: (f, c) => pickIs(f, c.brand), hit: argues, print: "whole" },
  {
    id: "argues_when_other_picked",
    name: "Argues it, when another brand in analysis is the pick",
    subject: "brand",
    arg: true,
    legal: PICK_TYPES,
    base: (f, c) => inAnalysisPick(f) && !pickIs(f, c.brand),
    hit: argues,
    print: "whole",
  },
];

export const MEASURE_BY_ID: ReadonlyMap<string, Measure> = new Map(MEASURES.map((m) => [m.id, m]));

/** The measure, refused when it is not legal on every type asked for. */
export function legalMeasure(id: string, types: readonly QuestionType[]): Measure {
  const m = MEASURE_BY_ID.get(id);
  if (!m) throw new Error(`fact layer: no measure "${id}"`);
  for (const t of types) if (!m.legal.includes(t)) throw new Error(`fact layer: measure "${id}" (${m.name}) is not legal on question type "${t}" - refused, never approximated`);
  return m;
}

/* ------------------------------- printing ------------------------------- */

/** Whole points; "<1%" for anything above zero under half a point. */
export function printWhole(k: number, n: number): string {
  const x = n > 0 ? k / n : 0;
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
}

/** One decimal under 10% (the cards' "picked, of all answers"); whole points from 10%. */
export function printFine(k: number, n: number): string {
  const x = n > 0 ? k / n : 0;
  if (x <= 0) return "0%";
  if (x < 0.001) return "<0.1%";
  if (x < 0.1) return `${(Math.round(x * 1000) / 10).toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(x * 100)}%`;
}

export const printOf = (m: Measure, k: number, n: number) => (m.print === "fine" ? printFine(k, n) : printWhole(k, n));
