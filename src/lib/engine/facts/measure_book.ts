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
 * Besides the fixed measures, four take a parameter in the subject (fact.ts parses it):
 *  - an argument: "<subject>/arg:<code>";
 *  - a source (a site the answer cites, sources.ts): "<subject>/src:<site>" - never with an argument;
 *  - a condition: "<subject>/cond:<units>[>to:<key>][>card:<name key>][@<slice>]" (layer 1's statements);
 *  - a slice: "ai/slice:<slice>" (slices.ts) - the share of the scope's answers in the slice.
 * And any measure can be counted on a slice of a scope (Scope.when): a side of "What the answer weighs", the answers
 * that agree, the answers that pick the rival.
 *
 * Pure: reads AnswerFact records only.
 */
import type { AnswerFact, AnswerFactSet, QuestionType } from "./answer_facts";
import { QUESTION_TYPES } from "./basics";
import { famTokens } from "../brand_family";

/* ------------------------------- floors ------------------------------- */

/**
 * The floors and tests, in one table. Every screen reads these; a screen keeps no local copy of a floor for an idea
 * listed here. The rulings on floors that used to differ between screens (Tyler, 2026-11-18) are written into the
 * values below: one "argument that comes up more when you win" (liftMinSide + seldomShare, no incidence gate), one
 * AI-company breakdown floor (argsMin), one floor for a sentence that advises on a fixed situation (fixedAdviseMin),
 * one floor for who buyers are sent to (takerMin / takerShare); "converts" is the visibility view's level line
 * (ruling 11). The two differences kept on purpose are listed at FLOOR_CONFLICTS.
 */
export const FLOORS = {
  /** A card with fewer answers is thin and drops its tags. */
  minAnswers: 20,
  /** A drawn row needs this many answers. */
  rowMin: 3,
  /** An explanation needs this many answers. */
  detailMin: 5,
  /** A side needs this many answers carrying arguments (weighs); an AI company needs this many answers to be listed in
   * any card section that breaks answers down by AI company. */
  argsMin: 10,
  /** "An argument comes up more when you win" (every screen): at least this many answers on each side - the answers
   * that pick the brand (or take its side) and the answers that pick another brand (or take the other side). No
   * incidence gate: an argument raised in under seldomShare of the two sides' answers together is kept and marked
   * `seldom` (seldomOf). */
  liftMinSide: 10,
  seldomShare: 0.05,
  /** A row is tagged a fixed situation at MAP_FLOORS.wallMin answers; a sentence that ADVISES on it (do not contest it)
   * needs this many answers on the row. One floor with the Overview's specific away wording (awaySpecificMin). */
  fixedAdviseMin: 15,
  /** Who buyers are sent to (a worry's exit, a settled card's redirect): at least this many answers and this share. */
  takerMin: 3,
  takerShare: 0.2,
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
  /** ... and a specific wording (a blocker brand, a fixed situation) this many - the floor for advising on a fixed
   * situation (FLOORS.fixedAdviseMin). */
  awaySpecificMin: FLOORS.fixedAdviseMin,
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
  /** The argument lift (the reasonLift list): FLOORS.liftMinSide answers a side, no incidence gate (seldomOf). */
  liftMinAnswers: FLOORS.liftMinSide,
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
  /** Watch: one assistant supplies this share of the cell's brand side, from this many answers, AND the 95% range of
   * that share clears the assistant's share of the cell's answers (the Overview finding's test, clearsConcentration in
   * summary_insights.ts). */
  watchEngineShare: 0.4,
  watchEngineMin: 10,
  /** A cell's lift list: FLOORS.liftMinSide answers a side, no incidence gate (seldomOf), top 8. */
  liftMin: FLOORS.liftMinSide,
  liftTop: 8,
  /** A row is tagged a fixed situation with this many answers ... */
  wallMin: 5,
  /** ... and the cell advises on it (the wall line, the move box, the triage reason) with this many. */
  wallAdviseMin: FLOORS.fixedAdviseMin,
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
  /** Who buyers are sent to - the exit taker on a worry and the settled cells' redirect taker: one floor. */
  exitMin: FLOORS.takerMin,
  exitShare: FLOORS.takerShare,
  redirectShare: FLOORS.takerShare,
  /** The criteria cell's what-to-buy lift for one buyer: FLOORS.liftMinSide picks a side. */
  roomLiftMin: FLOORS.liftMinSide,
} as const;

/**
 * The two floors that differ for the same-sounding idea ON PURPOSE (Tyler, 2026-11-18); every other former conflict is
 * one floor above.
 *  - "lost with an exception": the Map cell needs 20 lost answers and half of them stating a case for you
 *    (MAP_FLOORS.excMinLost / excMinShare); the Overview's finding needs 15 answers stating its one condition and 20% of
 *    the lost answers (OVERVIEW_FLOORS.excMinAnswers / excMinShare). Two different measures: the cell asks whether the
 *    lost answers still make a case at all, the finding whether one condition does.
 *  - "close": a card calls two shares close under FLOORS.closePts points or inside each other's 95% range (cards
 *    describe); a finding needs ranges apart (non-overlapping, FLOORS.apartZ) to fire (findings decide).
 */
export const FLOOR_CONFLICTS = true;

/** "Seldom raised": an argument raised in under FLOORS.seldomShare of the answers on the two sides together (the
 * answers that pick the brand and the answers that pick another brand, or the two sides of a verdict). The one
 * definition every lift list uses; a seldom row stays in its list, marked. */
export function seldomOf(w: { k: number; n: number }, o: { k: number; n: number }): boolean {
  const n = w.n + o.n;
  return n === 0 ? true : (w.k + o.k) / n < FLOORS.seldomShare;
}

/** The argument a sentence names as THE one that comes up more when the brand wins (sign 1) or when another brand does
 * (sign -1): the first in `rows` (already in the caller's order of strength) that is not seldom raised; only when every
 * row is seldom, the first of them, flagged so the sentence can say so. */
export function liftLead<T extends { seldom: boolean }>(rows: T[]): { row: T; seldom: boolean } | null {
  const row = rows.find((r) => !r.seldom) ?? rows[0];
  return row ? { row, seldom: row.seldom } : null;
}

/** `rows` with every row that is not seldom raised first, each group in its own order (a list a sentence names from). */
export function leadsFirst<T extends { seldom: boolean }>(rows: T[]): T[] {
  return [...rows.filter((r) => !r.seldom), ...rows.filter((r) => r.seldom)];
}

/* ------------------------------- types ------------------------------- */

/** "ai" = the measure is about the answer, not a brand; "rival" = each answer's own named rival (head-to-heads,
 * switching); otherwise a brand's dictionary entry id. */
export type SubjectRef = string;

export interface MeasureCtx {
  set: AnswerFactSet;
  /** The subject's brand key (null for "ai" / "rival" / a company). */
  brand: string | null;
  /** A company subject ("co:<name>"): its brands in analysis (fact.ts companyMembers); null otherwise. */
  brands?: ReadonlySet<string> | null;
  /** True when the subject is "rival" (each answer's own named rival). */
  rival: boolean;
  /** The argument code an argument measure reads. */
  arg: string | null;
  /** The site a source measure reads (sources.ts). */
  src: string | null;
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
  /** Reads a site the answer cites (passed in the subject as "<subject>/src:<site>"); never with `arg`. */
  src?: boolean;
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
const pickIs = (f: AnswerFact, key: string | null) => !!key && f.pick.state !== "none" && f.pick.key === key;
/** Is this brand the subject - the subject's one brand, or one of a company subject's brands? */
const isSubj = (c: MeasureCtx, key: string | null | undefined) => !!key && (c.brands ? c.brands.has(key) : key === c.brand);
const named = (f: AnswerFact, c: MeasureCtx) => f.brands.some((b) => isSubj(c, b.key));
const recommended = (f: AnswerFact, c: MeasureCtx) => f.brands.some((b) => isSubj(c, b.key) && b.recommended);
const picks = (f: AnswerFact, c: MeasureCtx) => f.pick.state !== "none" && isSubj(c, f.pick.key);
const inAnalysisPick = (f: AnswerFact) => f.pick.state === "in_analysis";
/** The brand a subject means on this answer ("rival" = the answer's own named rival). */
const subjectKey = (f: AnswerFact, c: MeasureCtx) => (c.rival ? f.rival?.key ?? null : c.brand);
const rivalPick = (f: AnswerFact) => !!f.rival && pickIs(f, f.rival.key);
const youPick = (f: AnswerFact, c: MeasureCtx) => pickIs(f, c.set.target.key);
const v = (f: AnswerFact, field: keyof AnswerFact["verdicts"], ...values: string[]) => values.includes(f.verdicts[field] ?? "");
const judged = (f: AnswerFact) => v(f, "premise_verdict", "confirms", "mixed", "rebuts");
const argues = (f: AnswerFact, c: MeasureCtx) => !!c.arg && (f.args ?? []).includes(c.arg);
/** The answer cites at least one site (a search assistant that cited something). */
const cited = (f: AnswerFact) => (f.sources?.length ?? 0) > 0;
/** The answer cites the measure's site. */
const citesSite = (f: AnswerFact, c: MeasureCtx) => !!c.src && !!f.sources?.some((s) => s.site === c.src);
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
  // The answers in the scope (k = n): the base a table's "Answers" column and "Based on N answers" print.
  { id: "answers", name: "Answers", subject: "ai", legal: ALL, base: all, hit: all, print: "whole" },
  { id: "named", name: "Named", subject: "brand", legal: ALL, base: all, hit: (f, c) => named(f, c), print: "whole" },
  { id: "recommended", name: "Recommended", subject: "brand", legal: ALL, base: all, hit: (f, c) => recommended(f, c), print: "whole" },
  { id: "picked", name: "Picked, of all answers", subject: "brand", legal: PICK_TYPES, base: all, hit: (f, c) => picks(f, c), print: "fine" },
  { id: "share_of_picks", name: "Share of picks", subject: "brand", legal: PICK_TYPES, base: inAnalysisPick, hit: (f, c) => picks(f, c), print: "whole" },
  { id: "converts", name: "Recommendations that end as the pick", subject: "brand", legal: PICK_TYPES, base: (f, c) => recommended(f, c), hit: (f, c) => picks(f, c), print: "whole" },
  { id: "named_not_recommended", name: "Named but not recommended", subject: "brand", legal: ALL, base: all, hit: (f, c) => named(f, c) && !recommended(f, c), print: "whole" },
  {
    id: "negative_when_named_not_recommended",
    name: "Of those named but not recommended, named as one to avoid",
    subject: "brand",
    legal: ALL,
    base: (f, c) => named(f, c) && !recommended(f, c),
    hit: (f, c) => f.brands.some((b) => isSubj(c, b.key) && b.negative),
    print: "whole",
  },
  {
    id: "recommended_lost",
    name: "Recommended, but another brand is the pick",
    subject: "brand",
    legal: PICK_TYPES,
    base: (f, c) => recommended(f, c),
    hit: (f, c) => inAnalysisPick(f) && !picks(f, c),
    print: "whole",
  },
  {
    id: "recommended_no_pick",
    name: "Recommended, and no single pick",
    subject: "brand",
    legal: PICK_TYPES,
    base: (f, c) => recommended(f, c),
    hit: (f) => f.pick.state === "none",
    print: "whole",
  },
  {
    id: "recommended_outside_category",
    name: "Recommended, and the pick is outside the category",
    subject: "brand",
    legal: PICK_TYPES,
    base: (f, c) => recommended(f, c),
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
    hit: (f, c) => named(f, c),
    print: "whole",
  },

  {
    id: "negative",
    name: "Named as one to avoid, when named",
    subject: "brand",
    legal: ALL,
    base: (f, c) => named(f, c),
    hit: (f, c) => f.brands.some((b) => isSubj(c, b.key) && b.negative),
    print: "whole",
  },
  {
    // Ruling 8: first among the brands in analysis the answer names (a brand outside of analysis never counts).
    id: "named_first",
    name: "Named first, when named",
    subject: "brand",
    legal: ALL,
    base: (f, c) => named(f, c),
    hit: (f, c) => isSubj(c, f.brands.filter((b) => b.bucket === "in_analysis").sort((a, b) => a.order - b.order)[0]?.key),
    print: "whole",
  },

  /* -- the pick, about the AI -- */
  { id: "commit_rate", name: "Commits to one brand in analysis", subject: "ai", legal: PICK_TYPES, base: all, hit: inAnalysisPick, print: "whole" },
  { id: "picks_outside_analysis", name: "Picks a brand outside of analysis", subject: "ai", legal: PICK_TYPES, base: all, hit: (f) => f.pick.state === "outside_analysis", print: "whole" },
  { id: "picks_outside_category", name: "Picks something outside the category", subject: "ai", legal: PICK_TYPES, base: all, hit: (f) => f.pick.state === "outside_category", print: "whole" },
  verdict("outcome_conditional", "Gives conditions, no pick", PICK_TYPES, "outcome", ["conditional"]),
  verdict("outcome_no_pick", "Picks nothing", PICK_TYPES, "outcome", ["no_pick"]),
  verdict("outcome_clarification", "Asks the buyer for more", PICK_TYPES, "outcome", ["clarification"]),
  // The Habit card's "picks another brand": any pick that is not the tracker - in the category or not.
  { id: "picks_other", name: "Picks something other than the tracker", subject: "ai", legal: PICK_TYPES, base: all, hit: (f, c) => f.pick.state !== "none" && f.pick.key !== c.set.target.key, print: "whole" },

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
  { id: "sent_to", name: "Named as where to go", subject: "brand", legal: DESTS, base: all, hit: (f, c) => !!f.sent?.brands.some((b) => isSubj(c, b.key)), print: "whole" },
  { id: "sent_to_any", name: "Names another brand to go to", subject: "ai", legal: DESTS, base: all, hit: (f) => (f.sent?.brands.length ?? 0) > 0, print: "whole" },
  { id: "sent_own", name: "Offers another of the tracker's own products as where to go", subject: "ai", legal: DESTS, base: all, hit: (f) => (f.sent?.own.length ?? 0) > 0, print: "whole" },
  { id: "redirected_to", name: "Redirected to", subject: "brand", legal: REDIRECT, base: all, hit: (f, c) => !!f.sent?.brands.some((b) => isSubj(c, b.key)), print: "whole" },
  { id: "redirected_any", name: "Redirects to another brand", subject: "ai", legal: REDIRECT, base: all, hit: (f) => (f.sent?.brands.length ?? 0) > 0, print: "whole" },

  /* -- price questions (ruling 3) -- */
  verdict("worth_yes", "Worth it", ["pricing"], "worth_it", ["yes"]),
  verdict("worth_depends", "It depends", ["pricing"], "worth_it", ["depends"]),
  verdict("worth_no", "Not worth it", ["pricing"], "worth_it", ["no"]),
  { id: "instead_rival", name: "Points to a rival", subject: "ai", legal: ["pricing"], base: all, hit: (f) => f.price?.bucket === "rival", print: "whole" },
  { id: "instead_own", name: "Points only to your own cheaper option", subject: "ai", legal: ["pricing"], base: all, hit: (f) => f.price?.bucket === "own", print: "whole" },
  { id: "instead_nowhere", name: "Points nowhere", subject: "ai", legal: ["pricing"], base: all, hit: (f) => f.price?.bucket === "nowhere", print: "whole" },
  { id: "named_instead", name: "Recommended instead", subject: "brand", legal: ["pricing"], base: all, hit: (f, c) => !!f.price?.rivals.some((r) => isSubj(c, r.key)), print: "whole" },

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
  { id: "argues_when_picked", name: "Argues it, when the brand is the pick", subject: "brand", arg: true, legal: PICK_TYPES, base: (f, c) => picks(f, c), hit: argues, print: "whole" },
  {
    id: "argues_when_other_picked",
    name: "Argues it, when another brand in analysis is the pick",
    subject: "brand",
    arg: true,
    legal: PICK_TYPES,
    base: (f, c) => inAnalysisPick(f) && !picks(f, c),
    hit: argues,
    print: "whole",
  },

  /* -- sources: the sites a search assistant's answer cites (sources.ts; one per distinct site). An answer from an
   * assistant that does not search is in no source measure's base. -- */
  { id: "cites_any", name: "Cites a source", subject: "ai", legal: ALL, base: (f) => f.sources !== null, hit: cited, print: "whole" },
  { id: "cites", name: "Cites the site", subject: "ai", src: true, legal: ALL, base: cited, hit: citesSite, print: "whole" },
  { id: "cites_when_picked", name: "Cites the site, when the brand is the pick", subject: "brand", src: true, legal: PICK_TYPES, base: (f, c) => cited(f) && picks(f, c), hit: citesSite, print: "whole" },
  {
    // "Another brand" as argues_when_other_picked (ruling 2): another pick of a brand in analysis.
    id: "cites_when_other_picked",
    name: "Cites the site, when another brand in analysis is the pick",
    subject: "brand",
    src: true,
    legal: PICK_TYPES,
    base: (f, c) => cited(f) && inAnalysisPick(f) && !picks(f, c),
    hit: citesSite,
    print: "whole",
  },
  { id: "cites_site_of", name: "Cites the brand's own site", subject: "brand", legal: ALL, base: cited, hit: (f, c) => !!f.sources?.some((s) => s.owners.some((o) => isSubj(c, o))), print: "whole" },
  { id: "cites_a_brand_site", name: "Cites a brand's own site", subject: "ai", legal: ALL, base: cited, hit: (f) => !!f.sources?.some((s) => s.owners.length > 0), print: "whole" },

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

/* ------------------------------- the Data page's catalog ------------------------------- */

/**
 * The Data page (step 6) reads THIS rulebook: each number it offers is a measure above, with the measure's own
 * legality - a number is offered on a group of questions only when the measure is legal on every question type in
 * the group. What follows is only the page's wording and grouping: which measures it offers, under what name, about
 * which subject (`brand`: the brand chosen, or the row's brand or company; `you`: the tracker; `rival`: each
 * question's own named rival; `ai`: the answer itself) and with what one-line explanation.
 */
export interface DataMeasure {
  /** The page's id (a settings key: a table names its numbers by it). */
  id: string;
  /** The measure in the book. */
  measure: string;
  subject: "brand" | "you" | "rival" | "ai";
  /** Reads an argument (the argument chosen, or the row's argument). */
  arg?: boolean;
  /** Reads a source (the site chosen, or the row's site). */
  src?: boolean;
  label: string;
  group: string;
  /** What it counts and out of what, in plain words. */
  tip: string;
  /** Offered only on these groups - wording, not legality: the same count is offered elsewhere under its general
   * name ("Sticks with you" is "Picked" for you, said the Habit card's way). */
  only?: readonly DataPoolKey[];
}

const dm = (id: string, measure: string, subject: DataMeasure["subject"], group: string, label: string, tip: string, arg?: boolean, only?: DataPoolKey[]): DataMeasure => ({
  id,
  measure,
  subject,
  group,
  label,
  tip,
  ...(arg ? { arg } : {}),
  ...(only ? { only } : {}),
});

export const DATA_MEASURES: readonly DataMeasure[] = [
  dm("named", "named", "brand", "Brand", "Named", "Answers that name the brand, out of every answer."),
  dm("recommended", "recommended", "brand", "Brand", "Recommended", "Answers that recommend the brand (the pick counts as a recommendation), out of every answer."),
  dm("picked", "picked", "brand", "Brand", "Picked", "Answers whose one pick is the brand, out of every answer."),
  dm("share_of_picks", "share_of_picks", "brand", "Brand", "Share of picks", "Of the answers where the AI picks one brand in analysis, the share that pick this brand."),
  dm("converts", "converts", "brand", "Brand", "Recommendations that end as the pick", "Of the answers that recommend the brand, the share that pick it."),
  dm("negative", "negative", "brand", "Brand", "Named negatively", "Of the answers that name the brand, the share that name it as one to avoid."),
  dm("named_first", "named_first", "brand", "Brand", "Named first", "Of the answers that name the brand, the share that name it before any other brand in analysis."),
  dm("named_instead", "named_instead", "brand", "Brand", "Recommended instead", "Answers that recommend the brand instead of yours, out of every answer."),
  dm("sent_to", "sent_to", "brand", "Brand", "Named as where to go", "Answers that name the brand as where to go, out of every answer."),
  dm("redirected_to", "redirected_to", "brand", "Brand", "Pointed to instead", "Answers that point your customer to the brand, out of every answer."),

  dm("commit_rate", "commit_rate", "ai", "The pick", "Picks one brand", "Answers that pick one brand in analysis, out of every answer."),
  dm("picks_outside_analysis", "picks_outside_analysis", "ai", "The pick", "Picks a brand outside of analysis", "Answers whose pick is a brand you left out of analysis, out of every answer."),
  dm("picks_outside_category", "picks_outside_category", "ai", "The pick", "Picks something outside the category", "Answers whose pick is outside the category, out of every answer."),
  dm("outcome_conditional", "outcome_conditional", "ai", "The pick", "Gives conditions, no pick", "Answers that say which brand suits which buyer and pick none, out of every answer."),
  dm("outcome_no_pick", "outcome_no_pick", "ai", "The pick", "Picks nothing", "Answers that pick nothing, out of every answer."),
  dm("outcome_clarification", "outcome_clarification", "ai", "The pick", "Asks the buyer for more", "Answers that ask the buyer for more before picking, out of every answer."),

  dm("h2h_you", "h2h_win", "you", "Head-to-head", "You win", "Answers whose pick is you, out of every answer."),
  dm("h2h_rival", "h2h_win", "rival", "Head-to-head", "Rival wins", "Answers whose pick is the rival the question names, out of every answer."),
  dm("h2h_another", "h2h_another", "ai", "Head-to-head", "Picks another brand", "Answers that pick something other than you and the named rival, out of every answer."),
  dm("h2h_no_pick", "h2h_no_pick", "ai", "Head-to-head", "No single pick", "Answers that pick nothing, out of every answer."),
  dm("h2h_two_way", "h2h_two_way", "you", "Head-to-head", "Two-way record", "Of the answers that pick you or the named rival, the share that pick you."),

  dm("habit_stick", "picked", "you", "Habit", "Sticks with you", "Answers whose pick is you, out of every answer.", false, ["habit"]),
  dm("habit_switch", "picks_other", "ai", "Habit", "Picks something else", "Answers that pick something other than you, in the category or not, out of every answer.", false, ["habit"]),

  dm("tier_premium", "tier_premium", "ai", "Premium vs basic", "Sides with premium", "Answers that side with the premium end, out of every answer."),
  dm("tier_basic", "tier_basic", "ai", "Premium vs basic", "Sides with basic", "Answers that side with the basic end, out of every answer."),
  dm("tier_balanced", "tier_balanced", "ai", "Premium vs basic", "Balanced", "Answers that weigh both ends, out of every answer."),
  dm("tier_none", "tier_none", "ai", "Premium vs basic", "Takes no side", "Answers that take no stance on the two ends, out of every answer."),

  dm("worth_yes", "worth_yes", "ai", "Value", "Worth it", "Answers that call your line worth its price over a cheaper option, out of every answer."),
  dm("worth_depends", "worth_depends", "ai", "Value", "It depends", "Answers that say it depends, out of every answer."),
  dm("worth_no", "worth_no", "ai", "Value", "Not worth it", "Answers that call your line not worth its price, out of every answer."),
  dm("instead_rival", "instead_rival", "ai", "Value", "Points to a rival", "Answers that recommend a rival instead, out of every answer."),
  dm("instead_own", "instead_own", "ai", "Value", "Points only to your own cheaper option", "Answers whose only cheaper suggestion is one of your own, out of every answer."),
  dm("instead_nowhere", "instead_nowhere", "ai", "Value", "Points nowhere", "Answers that suggest no cheaper option at all, out of every answer."),

  dm("go_ahead", "go_ahead", "ai", "Buyers' worries", "Go ahead", "Answers that tell the worried buyer to go ahead, out of every answer."),
  dm("steer_clear", "steer_clear", "ai", "Buyers' worries", "Steer clear", "Answers that tell the worried buyer to steer clear, out of every answer."),
  dm("buyer_no_side", "buyer_no_side", "ai", "Buyers' worries", "No side", "Answers that take no side, out of every answer."),
  dm("stay", "stay", "ai", "Stay or leave", "Stay", "Answers that tell the customer to stay, out of every answer."),
  dm("leave", "leave", "ai", "Stay or leave", "Leave", "Answers that tell the customer to leave, out of every answer."),
  dm("customer_no_side", "customer_no_side", "ai", "Stay or leave", "No side", "Answers that take no side, out of every answer."),
  dm("agrees", "agrees", "ai", "The worry", "Agrees the worry is fair", "Of the answers that agree, partly agree or disagree with the worry, the share that agree."),
  dm("partly_agrees", "partly_agrees", "ai", "The worry", "Partly agrees", "Of the answers that agree, partly agree or disagree with the worry, the share that partly agree."),
  dm("disagrees", "disagrees", "ai", "The worry", "Says the worry is wrong", "Of the answers that agree, partly agree or disagree with the worry, the share that disagree."),
  dm("sent_to_any", "sent_to_any", "ai", "Where it sends them", "Names another brand to go to", "Answers that name another brand in analysis as where to go, out of every answer."),
  dm("sent_own", "sent_own", "ai", "Where it sends them", "Offers your own other product", "Answers that offer another of your own products as the way out, out of every answer."),

  dm("routed_category", "routed_category", "ai", "Spotting the problem", "Points to the category", "Answers that point the asker to your category, out of every answer."),
  dm("routed_adjacent", "routed_adjacent", "ai", "Spotting the problem", "Points outside the category", "Answers that point the asker to another kind of solution, out of every answer."),
  dm("routed_none", "routed_none", "ai", "Spotting the problem", "Points nowhere", "Answers that explain without pointing anywhere, out of every answer."),

  dm("relationship_strengthens", "relationship_strengthens", "ai", "Relationship", "Strengthens", "Answers that strengthen the customer relationship, out of every answer."),
  dm("relationship_neutral", "relationship_neutral", "ai", "Relationship", "Neutral", "Answers that leave the relationship where it is, out of every answer."),
  dm("relationship_weakens", "relationship_weakens", "ai", "Relationship", "Weakens", "Answers that weaken the relationship, out of every answer."),
  dm("redirected_any", "redirected_any", "ai", "Relationship", "Points to another brand", "Answers that point your customer to another brand in analysis, out of every answer."),
  dm("case_strong", "case_strong", "ai", "Case strength", "A strong case", "Answers that make a strong case for you, out of every answer."),
  dm("case_hedged", "case_hedged", "ai", "Case strength", "A hedged case", "Business cases that hedge, out of every answer."),
  dm("case_undermined", "case_undermined", "ai", "Case strength", "Argues against you", "Business cases the answer argues against, out of every answer."),
  dm("case_partial", "case_partial", "ai", "Case strength", "A partial answer", "Answers to a critic that make only part of the case, out of every answer."),
  dm("case_concedes", "case_concedes", "ai", "Case strength", "Drops your side", "Answers to a critic that drop your side, out of every answer."),
  dm("growth_backs", "growth_backs", "ai", "Expansion", "Backs it", "Answers that back doing more with you, out of every answer."),
  dm("growth_neutral", "growth_neutral", "ai", "Expansion", "Neither backs nor discourages", "Answers that neither back nor discourage it, out of every answer."),
  dm("growth_redirects", "growth_redirects", "ai", "Expansion", "Points them elsewhere", "Answers that point them elsewhere, out of every answer."),

  dm("argues", "argues", "ai", "Arguments", "Argues it", "Answers that make the argument, out of every answer.", true),
  dm("argues_when_picked", "argues_when_picked", "brand", "Arguments", "Argues it, when the brand is the pick", "Of the answers that pick the brand, the share that make the argument.", true),
  dm("argues_when_other_picked", "argues_when_other_picked", "brand", "Arguments", "Argues it, when another brand is the pick", "Of the answers that pick another brand in analysis, the share that make the argument.", true),

  dm("cites_any", "cites_any", "ai", "Sources", "Cites a source", "Of the answers from assistants that search the web, the share that cite at least one source."),
  { ...dm("cites", "cites", "ai", "Sources", "Cites this source", "Of the answers that cite at least one source, the share that cite this site."), src: true },
  { ...dm("cites_when_picked", "cites_when_picked", "brand", "Sources", "Cites this source, when the brand is the pick", "Of the answers that cite at least one source and pick the brand, the share that cite this site."), src: true },
  { ...dm("cites_when_other_picked", "cites_when_other_picked", "brand", "Sources", "Cites this source, when another brand is the pick", "Of the answers that cite at least one source and pick another brand in analysis, the share that cite this site."), src: true },
  dm("cites_site_of", "cites_site_of", "brand", "Sources", "Cites the brand's own site", "Of the answers that cite at least one source, the share that cite the brand's own site."),
  dm("cites_a_brand_site", "cites_a_brand_site", "ai", "Sources", "Cites a brand's own site", "Of the answers that cite at least one source, the share that cite the own site of any brand in analysis."),
];

export const DATA_MEASURE_BY_ID: ReadonlyMap<string, DataMeasure> = new Map(DATA_MEASURES.map((m) => [m.id, m]));

/** The Data page's groups of questions, in journey order: one group per kind of question, never two kinds pooled
 * (ruling 7: What to buy is a buyer's question and a question about one job; What's popular and Premium vs basic
 * are their own groups; the customers' worries pool the two stages they are asked at, as their card does). */
export type DataPoolKey =
  | "problem"
  | "learning"
  | "what_to_buy"
  | "popular"
  | "criteria"
  | "premium"
  | "h2h"
  | "h2h_class"
  | "switching"
  | "buyers_worries"
  | "value"
  | "customers_worries"
  | "looking_around"
  | "habit"
  | "business_case"
  | "expansion"
  | "ecosystem"
  | "advocacy";

export interface DataPool {
  key: DataPoolKey;
  types: readonly QuestionType[];
  /** The journey stage it sits in (views.ts StationKey). */
  station: "awareness" | "consideration" | "comparison" | "doubts" | "value" | "customer_base";
}

export const DATA_POOLS: readonly DataPool[] = [
  { key: "problem", types: ["problem_recognition"], station: "awareness" },
  { key: "learning", types: ["category_education"], station: "awareness" },
  { key: "what_to_buy", types: ["discovery", "use_case"], station: "consideration" },
  { key: "popular", types: ["social_validation"], station: "consideration" },
  { key: "criteria", types: ["criteria"], station: "consideration" },
  { key: "premium", types: ["premium_worth"], station: "consideration" },
  { key: "h2h", types: ["comparison_entity"], station: "comparison" },
  { key: "h2h_class", types: ["comparison_class"], station: "comparison" },
  { key: "switching", types: ["switching"], station: "comparison" },
  { key: "buyers_worries", types: ["objections"], station: "doubts" },
  { key: "value", types: ["pricing"], station: "value" },
  { key: "customers_worries", types: ["churn_triggers", "renewal"], station: "customer_base" },
  { key: "looking_around", types: ["looking_around"], station: "customer_base" },
  { key: "habit", types: ["repertoire"], station: "customer_base" },
  { key: "business_case", types: ["business_case"], station: "customer_base" },
  { key: "expansion", types: ["expansion"], station: "customer_base" },
  { key: "ecosystem", types: ["ecosystem"], station: "customer_base" },
  { key: "advocacy", types: ["advocacy"], station: "customer_base" },
];
export const DATA_POOL_BY_KEY: ReadonlyMap<DataPoolKey, DataPool> = new Map(DATA_POOLS.map((p) => [p.key, p]));

/** The Data page group a question type sits in. */
export function dataPoolOf(type: QuestionType): DataPoolKey | null {
  return DATA_POOLS.find((p) => p.types.includes(type))?.key ?? null;
}

/** Why a Data page number cannot be read on a group of questions (its measure is not legal on every type in it);
 * null = legal. */
export function dataIllegal(m: DataMeasure, pool: DataPoolKey): string | null {
  const p = DATA_POOL_BY_KEY.get(pool);
  const measure = MEASURE_BY_ID.get(m.measure);
  if (!p || !measure || (m.only && !m.only.includes(pool))) return "not asked by these questions";
  return p.types.every((t) => measure.legal.includes(t)) ? null : "not asked by these questions";
}
