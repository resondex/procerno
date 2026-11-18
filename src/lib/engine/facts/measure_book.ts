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
 *  9  "agrees the worry is fair" is out of the answers that agree, partly agree or disagree;
 *  10 a condition is counted inside one question type's scope, never pooled across types (fact.ts refuses);
 *  12 a pick outside the category is never "no single pick": the "no single pick" measures count only answers with
 *     no pick at all; a pick outside the category is its own share (picks_outside_category, slice pick:outside_category);
 *  13 a premium answer with no tier stance is its own share (tier_none), never "balanced".
 *
 * Besides the fixed measures, three take a parameter in the subject (fact.ts parses it):
 *  - an argument: "<subject>/arg:<code>";
 *  - a condition: "<subject>/cond:<units>[>to:<key>][>card:<name key>][@<slice>]" (layer 1's statements);
 *  - a slice: "ai/slice:<slice>" (slices.ts) - the share of the scope's answers in the slice.
 * And any measure can be counted on a slice of a scope (Scope.when): a side of "What the answer weighs", the answers
 * that agree, the answers that pick the rival.
 *
 * Pure: reads AnswerFact records only.
 */
import type { AnswerFact, AnswerFactSet, QuestionType } from "./answer_facts";
import { QUESTION_TYPES } from "./answer_facts";
import { famTokens } from "../brand_family";

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

/**
 * The Overview's findings and the Map's cells (statements, layer 4) read their floors from here - each value as the
 * detector or cell used it before it moved onto the fact layer (nothing silently changed). Where two places use
 * different floors for the same idea, both stay and the conflict is listed in CONFLICTS below.
 */
export const OVERVIEW_FLOORS = {
  /** Both ends of a spread, every finding's base (MIN_BASE). */
  minBase: 20,
  /** The served list: at most this many findings; a rank-fill slot needs this effect. */
  maxInsights: 12,
  fillMinEffect: 0.3,
  /** prompted_vs_open: the gap between matchups won and the open share of picks. */
  promptedGap: 0.15,
  /** The verdict's prompted-vs-open sentence: "ahead / behind / in line" at this gap. */
  verdictPromptedGap: 0.1,
  /** pick_concentration_room: one buying situation holds this share of your picks. */
  roomConcentration: 0.5,
  /** pick_concentration_question: one question holds this share of a brand's picks. */
  questionConcentration: 0.3,
  /** agreed_yet_stay: agrees at least this often, and still says go ahead / stay at least this often among those. */
  agreedShare: 0.5,
  agreedGiven: 0.3,
  /** value_in_house: own option or a rival at least this share. */
  valueSide: 0.3,
  /** The verdict's value sentence: "most" at this share, a two-part sentence at valueSide. */
  valueMost: 0.5,
  /** advocacy_vs_objection: both sides at least this share. */
  advocacyShare: 0.5,
  /** leaver_capture: named in this share of leavers' answers and picked under leaverNever. */
  leaverNamed: 0.5,
  leaverNever: 0.05,
  /** own_defense: an exit shown in this share, stay under it; exits within tiedPts of the top are named with it. */
  ownDefenseShown: 0.5,
  ownDefenseTiedPts: 0.05,
  /** away_condition: its lead row needs this many answers (the themed path's MIN_BASE) ... */
  awayLeadMin: 20,
  /** ... and a specific wording (a blocker brand, a fixed situation) this many (was 15 grouped rules). */
  awaySpecificMin: 15,
  /** A brand the AI almost never picks (the blocker clause). */
  blockerShare: 0.02,
  /** assigned_exception: the exception in this many lost answers and this share of them. */
  excMinAnswers: 15,
  excMinShare: 0.2,
  /** engine_h2h_flip: the open-choice gap by mode a flip must run against. */
  flipMinOpen: 0.05,
  /** engine_pick_concentration: one assistant or company supplies this share of a brand's picks; 3 assistants at least. */
  engineConcShare: 0.4,
  engineConcMinEngines: 3,
  /** vendor_outlier: a gap this large against the others pooled; 3 companies with minBase answers. */
  vendorMinGap: 0.1,
  vendorMinCompanies: 3,
  /** neutralized_differentiator: an argument in this share of your matchup wins. */
  ndWinShare: 0.4,
  /** leak_picks: picks outside the category at this share; leak_problem: problem questions at this share. */
  leakPicksShare: 0.1,
  leakProblemShare: 0.5,
  /** leave_no_exit: leave answers naming nowhere at this share. */
  noExitShare: 0.5,
  /** The argument lift (the reasonLift list): 20 answers a side, an argument in 2% of the pool. */
  liftMinAnswers: 20,
  liftMinIncidence: 0.02,
} as const;

/** The Map's cell floors (analysis_map.ts), as they were. */
export const MAP_FLOORS = {
  /** A cell's side-taking denominator below this is "no side taken" (MIN_SIDE). */
  minSide: 20,
  /** Overlapping ranges: both sides at least this share is contested (MATERIAL). */
  material: 0.15,
  /** Badges: picks outside the category, own cheaper option, one assistant. */
  leakShare: 0.1,
  inhouseShare: 0.5,
  watchEngineShare: 0.4,
  watchEngineMin: 10,
  /** A cell's lift list: 10 answers a side, an argument in 5% of the two sides, top 8. */
  liftMin: 10,
  liftMinIncidence: 0.05,
  liftTop: 8,
  /** A fixed situation on the away side needs this many answers. */
  wallMin: 5,
  /** Casting: "leads" within this margin of the top brand's share of picks. */
  defaultMargin: 0.05,
  /** Position.brands: a brand with this many picks in the contest is listed; at most 5. */
  brandFloor: 5,
  brandsTop: 5,
  /** The arguments block when there is no lift: 10 answers, top 5. */
  argsMin: 10,
  argsTop: 5,
  /** Lost with an exception: 20 lost answers, half of them still stating a case for you. */
  excMinLost: 20,
  excMinShare: 0.5,
  /** The exit taker on a worry: at least this many answers and this share. */
  exitMin: 3,
  exitShare: 0.2,
  /** The settled cells' redirect taker. */
  redirectShare: 0.1,
  /** The criteria cell's what-to-buy lift for one buyer: 10 picks a side. */
  roomLiftMin: 10,
} as const;

/**
 * Floors that differ for the same idea (kept as they are, listed for the ruling):
 *  - "an argument comes up more when you win": the Overview's lift needs 20 answers a side and 2% incidence
 *    (liftMinAnswers / liftMinIncidence); a Map cell's lift needs 10 a side and 5% (MAP_FLOORS.liftMin /
 *    liftMinIncidence); a buyer's criteria cell reads 10 picks a side (roomLiftMin) with no incidence floor.
 *  - "one assistant supplies the picks": the Map's watch badge (40% of the cell's brand side, 10 answers) and the
 *    Overview's finding (40% of a brand's picks, 20 picks, 3 assistants, the range clearing the assistant's share of
 *    questions).
 *  - "a fixed situation": the Map's wall needs 5 answers on the row (wallMin); the Overview's away finding needs 15 on a specific
 *    wording (awaySpecificMin).
 *  - the exit / redirect taker: 3 answers and 20% on a worry (exitShare), 3 answers and 10% on a settled cell
 *    (redirectShare).
 *  - "lost with an exception": the Map cell needs 20 lost answers and half of them stating a case for you; the
 *    Overview's finding needs 15 answers stating its one condition and 20% of the lost answers.
 */
export const FLOOR_CONFLICTS = true;

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
  /** The condition a condition measure reads. */
  cond: CondSpec | null;
  /** The slice a slice measure counts (slices.ts). */
  slice: ((f: AnswerFact) => boolean) | null;
}

/**
 * A condition as a measure reads it: a set of units (conditions.ts - themes, groups, the Map's groups) that count as
 * one condition, optionally only the statements that send the buyer to one brand, and optionally only on answers in
 * a slice (a filter on the numerator; the base stays the scope's).
 *
 * Written in a subject as "<subject>/cond:<unit>+<unit>[>to:<brand key>][>card:<name key>][@<slice>]".
 */
export interface CondSpec {
  units: Set<string>;
  to: string | null;
  /** A product the statements name, by its name key (famTokens joined) - "cond_card" only. */
  card: string | null;
  /** A slice the stating answer must also be in (slices.ts). */
  only: ((f: AnswerFact) => boolean) | null;
}

export interface Measure {
  id: string;
  name: string;
  /** What the subject may be. */
  subject: "brand" | "ai" | "brand_or_rival";
  /** Reads an argument code (passed in the subject as "<subject>/arg:<code>"). */
  arg?: boolean;
  /** Reads a condition (passed in the subject as "<subject>/cond:<spec>"). */
  cond?: boolean;
  /** Reads a slice as its numerator (passed in the subject as "ai/slice:<slice>"). */
  slice?: boolean;
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
/** The answer's statements of the measure's condition (to-filter applied). */
const condStmts = (f: AnswerFact, c: MeasureCtx) => (c.cond ? (f.conds ?? []).filter((s) => c.cond!.units.has(s.unit) && (!c.cond!.to || s.toKeys.includes(c.cond!.to))) : []);
/** The answer states the measure's condition (and is in its numerator slice). */
const states = (f: AnswerFact, c: MeasureCtx) => condStmts(f, c).length > 0 && (!c.cond!.only || c.cond!.only(f));
/** Where the answer's statements of the condition send the buyer (active brands, by entry id). */
const condTo = (f: AnswerFact, c: MeasureCtx) => new Set(condStmts(f, c).flatMap((s) => s.toKeys));
/** A product's name key: its words, case and punctuation set aside (the alongside card's grouping of products). */
export const cardKey = (c: string) => famTokens(c).join(" ") || c.trim().toLowerCase();
/** The products the answer's statements of the condition name, by name key. */
const condCards = (f: AnswerFact, c: MeasureCtx) => new Set(condStmts(f, c).flatMap((s) => s.cards.filter((x) => x.trim()).map(cardKey)));
/** Condition measures are legal wherever decision rules are coded. */
const RULE_TYPES: readonly QuestionType[] = ["discovery", "use_case", "social_validation", "premium_worth", "repertoire", "comparison_entity", "comparison_class", "switching", "looking_around", "pricing", "objections", "churn_triggers", "renewal", "expansion", "ecosystem"];
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
    id: "recommended_outside_category",
    name: "Recommended, and the pick is outside the category",
    subject: "brand",
    legal: PICK_TYPES,
    base: (f, c) => recommended(f, c.brand),
    hit: (f) => f.pick.state === "outside_category",
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

  /* -- a slice of the scope's answers, as a share of them: "picks another brand", "sticks with you", "suggests
   * another brand" - the slice states what it counts (slices.ts). -- */
  { id: "slice_share", name: "In the slice", subject: "ai", slice: true, legal: ALL, base: all, hit: (f, c) => !!c.slice && c.slice(f), print: "whole" },

  /* -- a slice's share of the picks of brands in analysis (the "Other" bar of a card's competitor group: the picks
   * of every brand in analysis the group does not list, ruling 8's base) -- */
  { id: "slice_share_of_picks", name: "Share of picks, in the slice", subject: "ai", slice: true, legal: PICK_TYPES, base: inAnalysisPick, hit: (f, c) => !!c.slice && c.slice(f), print: "whole" },

  /* -- which of a brand's products it picks: the scope's `when` is the brand's picks ("pick:<key>"), EVERY pick of it,
   * including the picks that name no specific product (those are their own row, slice "pickprod:none") -- */
  { id: "pick_product_share", name: "Of the brand's picks (every pick, including those naming no specific product), the share naming the product", subject: "ai", slice: true, legal: PICK_TYPES, base: all, hit: (f, c) => !!c.slice && c.slice(f), print: "whole" },

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

  /* -- conditions (layer 1's statements; ruling 4: of ALL the answers in the scope; ruling 10: one question-type
   * scope at a time - a scope pooling question types is refused) -- */
  { id: "cond_share", name: "States the condition", subject: "ai", cond: true, legal: RULE_TYPES, base: all, hit: states, print: "whole" },
  { id: "cond_none", name: "States none of the condition's units", subject: "ai", cond: true, legal: RULE_TYPES, base: all, hit: (f, c) => !states(f, c), print: "whole" },
  {
    id: "cond_you_picked",
    name: "Of the answers stating the condition, the tracker is the pick",
    subject: "ai",
    cond: true,
    legal: RULE_TYPES,
    base: states,
    hit: (f, c) => pickIs(f, c.set.target.key),
    print: "whole",
  },
  {
    id: "cond_dest",
    name: "Of the answers stating the condition that name a destination under it, sends the buyer to the brand",
    subject: "brand",
    cond: true,
    legal: RULE_TYPES,
    base: (f, c) => states(f, c) && condTo(f, c).size > 0,
    hit: (f, c) => condTo(f, c).has(c.brand ?? ""),
    print: "whole",
  },
  {
    id: "cond_card",
    name: "Of the answers stating the condition that name a product under it, names the product",
    subject: "ai",
    cond: true,
    legal: RULE_TYPES,
    base: (f, c) => states(f, c) && condCards(f, c).size > 0,
    hit: (f, c) => condCards(f, c).has(c.cond!.card ?? ""),
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
