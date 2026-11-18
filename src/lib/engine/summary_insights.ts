import type { ValueView, DoubtViews, WorryRow, SettledViews } from "./view_types";
import { cell, facetsOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { isDefaultCondition } from "./condition_groups";
import type { BrandSummaryView, VerdictFact } from "./brand_summary";
import type { AnswerRef } from "./analysis_types";
import type { AlternativesViews } from "./view_types";
import { ROW_NAME } from "./question_names";
import { clearsMatchupGap } from "./matchup_gap";
import type { MoveNames } from "./finding_moves";
import { buyerPhrase, possName } from "./brief_words";
import { condLabel } from "./panel_text";
import type { Scope } from "./facts/fact";
import { OVERVIEW_FLOORS as OF, leadsFirst, liftLead } from "./facts/measure_book";
import { closeGates, extremeWords, finish, gApart, gAtLeast, gBelow, gGap, gK, gLowAbove, gN, isFactCell, openGates, pd, pfine, pw, type FactCell, type Gate, type StmtNums } from "./facts/statements";
import { inputsFromFacts, refsFor, sharedRunFacts, sitSlice, summaryFromFacts, worrySlice, type CardCondRow, type RunFacts } from "./facts/overview_facts";

/**
 * Insight detection for the summary documents (2026-11-03): mechanical
 * detectors over the brand summary and the sibling views (per-room headline,
 * value, doubt), ranked by effect size. Every detector emits at most one
 * insight; every insight names its effect in points of 1, a one-sentence
 * claim with percentages only (counts live in `foot`, the tooltip) and the
 * place in the dashboard that carries the full table.
 *
 * A spread is reported only when both ends clear the floor and their 95%
 * ranges do not overlap - a gap inside the noise is never a finding. The
 * request's engine set applies to every input (a one-engine set has no
 * engine spread, so those detectors stay silent). The room filter never
 * applies: the summary is the all-buyers read; the room detectors compare
 * rooms against each other.
 *
 * bs6 (2026-11-03) adds the contrasts BETWEEN pools and the concentrations
 * INSIDE a pool that the cross-tracker findings were built from: prompted
 * head-to-heads vs the open choice, the share of picks that come from one
 * buyer room or one question, worries the AI agrees with and still says
 * proceed or stay, arguments that win but are not taught (and taught ones
 * that lose), whether the Value doubts stay in-house (the brand's own
 * cheaper rung) or go to rivals, and the case the AI makes when asked to
 * defend the brand vs what it concedes when asked about buyers' worries.
 * Where a detector reads a tension rather than a gap, its effect is a
 * stated share (agreed_yet_stay: answers that both agree and still say
 * proceed; advocacy_vs_objection: how far both sides sit above even;
 * concentrations: the share above an even split). The same inputs feed the
 * verdict (composeVerdict): fixed-order template sentences the brief opens
 * with, each only when its inputs clear the floors.
 *
 * The prompted head-to-head record is the summary's own entity rollup
 * (headToHead) - the same rows and rival resolution as computeHeadToHead,
 * without its matchup condition grouping.
 *
 * bs7 (2026-11-03) reads three areas the detectors never did:
 *   switching   - rival leavers (leaver_capture: named but never taken, or
 *                 the share of decided leavers you take) and your own
 *                 customers weighing a move (own_defense: how often one
 *                 rival is the exit shown beside a stay verdict);
 *   conditions  - the run's decision rules through the rules explorer's
 *                 compute, so the grouping is the ONE run-wide grouping
 *                 under the "rules" condition-key cache scope (an
 *                 embedding call is paid once per run + revision and shared
 *                 with the explorer; keyless, the deterministic stem keys):
 *                 away_condition names the largest group routing answers
 *                 away, how many questions it decides, whether it is a wall
 *                 (a state the buyer is already in, wall_wording.ts) and
 *                 whether it names a brand the AI almost never picks;
 *   engines     - decisiveness by mode (firm in-category picks over
 *                 open-choice answers), a head-to-head record that runs
 *                 opposite to the open-choice share by mode, and one engine
 *                 supplying >= 40% of a brand's open-choice picks (the
 *                 analysis map's watch threshold).
 * Effects for the shapes that are not a two-ended spread: the leaver
 * tension is the named-to-captured drop (the funnel's convention), the
 * leaver strength the captured share of decided leavers above an even split
 * among the brands that capture any; own_defense is the top exit's share of
 * answers minus the stay share; away_condition is the share of the
 * questions with any away rule that the group appears in; engine pick
 * concentration is the picks' share above the engine's (or vendor's) own
 * share of the open-choice answers.
 *
 * bs8 (2026-11-04) adds four reads:
 *   neutralized_differentiator - an argument carried by >= 40% of your
 *                 prompted head-to-head wins that rides the rival's wins at
 *                 the same or a higher rate (the rival is credited with it,
 *                 so it no longer sets you apart);
 *   conversion_vs_rival - recommendations turned into picks, you vs the
 *                 rival with the largest share of decided;
 *   leak        - open-choice firm picks that leave the category
 *                 (leak_picks) and the buyer room whose problem questions
 *                 the AI routes outside the category most (leak_problem);
 *   retention   - the customers' worry whose leave rate sits apart above
 *                 the rest (worst_worry) and leave verdicts that name no
 *                 destination (leave_no_exit, read from the doubt view's
 *                 existing offersExitBy - no view change).
 * Effects: the neutralized argument is its loss share minus its win share
 * (a parity argument ranks near zero, one the rival owns ranks high);
 * conversion and the worst worry are the gap; out-of-category picks are
 * their share of firm picks (any leak is a loss, there is no even baseline);
 * the problem leak and the no-exit share are the share above half.
 *
 * Serving (2026-11-04, Tyler's kind-quota call): the served list is no
 * longer the top MAX_INSIGHTS by effect alone - each kind that fires gets
 * its best insight a slot before any kind gets a second, and the remaining
 * slots fill by global rank above FILL_MIN_EFFECT (so a quiet tracker's
 * list stops where the findings do instead of padding to the cap; the
 * quota slots carry no floor - effects are not on one scale across
 * detectors). funnel and value are exempt from the
 * guarantee (never from serving by rank): the verdict's own sentences
 * carry both by construction. The served list is returned in global
 * effect order, so a quota-admitted insight still ranks where its effect
 * puts it. MAX_INSIGHTS is 12 so the guarantee widens the list instead of
 * evicting large findings (eleven kinds can fire at once).
 *
 * bs18 (2026-11-12) adds vendor_outlier: one AI company answering a question
 * OUTSIDE the open choice and the head-to-heads differently from the rest.
 * Measures, each from its view's engine slices pooled by company (sum k /
 * sum n): customers' worries stay and leave, buyers' worries go ahead and
 * steer clear, Value worth it yes and no, rivals' customers switching picked
 * you, your customers looking around told to stay. Each company is compared
 * with every other company pooled; both sides need MIN_BASE answers, the
 * ranges must not overlap, the gap must reach VENDOR_MIN_GAP, and the measure
 * needs at least three companies with MIN_BASE answers (so a narrowed engine
 * set of one or two companies never fires it). One insight per tracker: the
 * pair whose two ranges sit furthest apart across every measure (so a thin
 * pool never outranks a well-measured company), and a verdict and its
 * complement never both fire. Effect = the gap.
 *
 * bs19 (2026-11-12) adds assigned_exception: in the direct matchups the brand
 * loses on balance (the map's verdict, assigned_exception.ts), the condition
 * the AI most often still gives for choosing the brand in the answers it
 * hands the rival. Not a rate of two-sided answers (a two-brand question
 * draws one by construction) - the content: which condition, how often, and
 * whether it is a situation the buyer is already in. bs20: counted on the
 * run's reason themes at answer grain when it has them (the theme by name,
 * its most-stated wording quoted), on the raw condition groups keyless. Fires with at least one lost matchup, MIN_BASE
 * pooled lost answers, and the top condition in at least 15 of them and 20%.
 * Effect = that share.
 *
 * bs20 (2026-11-13, one counting rule): with reason themes, away_condition's
 * headline counts the top away theme at answer grain too (awayConditionThemed);
 * a blocker brand or a fixed situation is still detected on one raw wording
 * and stated in its own sentence. Keyless both findings are unchanged.
 */

export type InsightKind = "engine" | "room" | "rival" | "argument" | "doubt" | "funnel" | "question" | "value" | "switching" | "condition" | "leak";
// "why" (2026-11-05) and "buyers" (2026-11-09) are retired pills: `look` has no
// reader (summary_views.tsx, its last one, was deleted 2026-11-18), so the targets
// stay as written rather than paying a version bump to repoint a dead field.
export type InsightPill = "stations" | "why" | "rivals" | "buyers" | "table";

export interface Insight {
  key: string;
  kind: InsightKind;
  title: string;
  /** One sentence; percentages only, never raw counts. */
  body: string;
  /** Evidence numbers, counts included - the tooltip. */
  foot: string;
  look: { pill: InsightPill; station?: string; label: string };
  /** Points of 1: the gap between the two ends (for the funnel, the drop). */
  effect: number;
  /** bs15 (2026-11-10): 2-4 small bars for the Overview's finding card - the
   * same numbers the sentence uses, formatted the way the sentence prints
   * them; `hi` marks the one row the finding is about. Absent when the
   * finding has no clean numeric rows. */
  viz?: InsightBar[];
  /** bs23 (2026-11-13): the rival an unasked_rival finding is about - the
   * Overview card's "Ask this matchup" action reads it. */
  matchup?: { key: string; name: string };
  /** bs26 (2026-11-16): the names its Overview move fills in (finding_moves.ts; variant = which way it reads). */
  names?: MoveNames;
  /** bs28 (statements): where each number of the title, body and bars sits, with its fact id ("viz.<i>" for a bar) -
   * never drawn; a proof recomputes every number from its id. */
  facts?: Record<string, StmtNums>;
}

/** One bar of a finding's small chart: value 0-100 (bar length), text the
 * display string, label in plain words (no counts). */
export interface InsightBar {
  label: string;
  value: number;
  text: string;
  hi?: true;
  /** bs16 (2026-11-11): up to EXAMPLES answers behind the bar's numerator,
   * spread across assistants - only where the detector reads a pool whose
   * numerator is a plain filter of answers. Absent otherwise (never faked). */
  refs?: AnswerRef[];
  /** bs26 (2026-11-16): whose number it is - you (blue), a named rival (pink), anything else (grey). */
  who?: "you" | "rival" | "other";
  /** bs28: the fact (or derived ref) the bar prints - its example answers are that fact's own answers. Never drawn. */
  fact?: string;
}

/** How many example answers a number carries (a bar's examples are its fact's own answers - finishInsight). */
export const EXAMPLES = 5;

/* -------- bf26: the Brief's style (third person, buyers as words, the cards' vocabulary) --------
 * rankedInsights(s, inp, { name }) runs the same detectors with STYLE set: the served insights (STYLE null)
 * keep the second person the Overview and the Map read; the Brief reads the same findings about its subject
 * by name. Detectors are synchronous, so STYLE is set and restored around one run. */
export interface InsightStyle {
  name: string;
  /** bf34: the What to buy card's figures for an argument, when the card shows it in that side's top three
   * ("you": the answers that pick the subject; "rival": those that pick another) - `here` on that side, `there`
   * on the other. The Brief quotes only arguments the card shows; a finding with none is left out (body ""). */
  cardArg?: (code: string, side: "you" | "rival") => { name: string; here: string; there: string } | null;
  /** bf34: a figure as a Map cell's card shows it (cell id, step key, segment key), e.g. the all-worries leave share. */
  cardStep?: (cellId: string, step: string, segment: string) => string | null;
  /** bf35: the subject's share of the picks as the What to buy card states it - one buying situation's card, or
   * the all-buyers card when `room` is null. */
  roomShare?: (room: string | null) => string | null;
  /** bf35: the share of a Spotting-the-problem card's answers that point to something outside the category - one
   * buying situation's card, or the all-buyers card when `room` is null. */
  outsideShare?: (room: string | null) => string | null;
  /** bf35: a condition that sends buyers away, as a card's row shows it: the share and where ("when buyers ask
   * what to buy", "when the AI compares X with Y directly"); null when no card row names it. */
  awayRow?: (labels: string[], dests: string[]) => { value: string; where: string } | null;
  /** bf35: a lost matchup's exception as that head-to-head card shows it ("who it still sends to you"). */
  exceptionRow?: (labels: string[], rival: string) => string | null;
}

/** bf35: the away-condition finding in the Brief's style - "Buyers who say ... are most often sent away, to ..." -
 * with only the share a card row shows (no pooled shares). */
function awayBrief(labels: string[], quote: string, dests: string[], dest: string, extra: string): string {
  // bf36: a share only from a card row naming this condition with the same destination (What to buy first).
  const row = dests.length ? STYLE!.awayRow!(labels, dests) : null;
  return `Buyers who say "${qc(shorten(quote))}" are most often sent away${dest ? `, ${dest}` : ""}${row ? ` - in ${row.value} of the answers ${row.where}` : ""}.${extra}`;
}
let STYLE: InsightStyle | null = null;
const yo = () => (STYLE ? STYLE.name : "you");
const yr = () => (STYLE ? possName(STYLE.name) : "your");
const Yr = () => (STYLE ? possName(STYLE.name) : "Your");
/** One clause in each voice: the second person as served, the third about the named subject. */
const yt = (second: string, third: (n: string) => string) => (STYLE ? third(STYLE.name) : second);
/** bf29, the Brief's style only: a share, "none" at zero ("in none of those"). */
const pz = (c: RateCell) => (c.k === 0 ? "none" : pct(c));
/** A buying situation inside a sentence (served: the label as written). */
const buyer = (label: string) => (STYLE ? buyerPhrase(label) : label);
/** The cards' word for an agreed worry. */
const fairW = () => "fair";
/** A quoted condition: the asker's "you" is "they" in the Brief (condLabel). */
const qc = (label: string) => (STYLE ? condLabel(label) : label);

/** bf26: the Brief's "picks X ... of the time it picks one of the two", with never / always at the extremes. */
const pickedOfTwo = (c: RateCell) =>
  c.k === 0 ? `never picks ${yo()} when it picks one of the two` : c.k === c.n ? `always picks ${yo()} when it picks one of the two` : `picks ${yo()} ${pct(c)} of the time it picks one of the two`;

/** bs26: a bar marked with whose number it is. */
const W = (who: "you" | "rival" | "other", b: InsightBar | null | undefined | false): InsightBar | null | undefined | false => (b ? { ...b, who } : b);


/** A bar from a share (0-1) or a rate cell; text defaults to the sentences' pct. */
export function insightBar(label: string, x: number | RateCell, text?: string, hi = false): InsightBar {
  const r = typeof x === "number" ? x : x.n > 0 ? x.k / x.n : 0;
  // A fact's bar prints from the fact (its marker carries the id - finishInsight reads it back for the bar's fact
  // and its example answers).
  return { label, value: Math.max(0, Math.min(100, Math.round(r * 1000) / 10)), text: text ?? (typeof x !== "number" && isFactCell(x) ? pw(x) : pctShare(r)), ...(hi ? { hi: true as const } : {}) };
}
const pctShare = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
/** 2-4 bars or nothing: a single bar is not a comparison. */
function vizOf(rows: (InsightBar | null | undefined | false)[]): InsightBar[] | undefined {
  const r = rows.filter((x): x is InsightBar => !!x).slice(0, 4);
  return r.length >= 2 ? r : undefined;
}
/** Bar labels from data (rooms, worries, conditions) stay short. */
const lbl = (t: string, n = 44) => {
  const x = t.replace(/\s+/g, " ").trim();
  const s = x.length <= n ? x : `${x.slice(0, n - 1).replace(/\s+\S*$/, "").replace(/[\s.,;:!?-]+$/, "")}...`;
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Both ends of a spread need this many decided (or judged) answers -
 * the same floor brand_summary's argument lift uses. */
const MIN_BASE = OF.minBase;
const MAX_INSIGHTS = OF.maxInsights;
/** Kinds the verdict's own sentences carry by construction - no guaranteed
 * slot in the served list (they still serve wherever global rank puts them). */
const QUOTA_EXEMPT: ReadonlySet<InsightKind> = new Set(["funnel", "value"]);
/** Rank-fill slots (round 2) need this much effect - the quota slots do not,
 * because effects are not on one scale across detectors (a 0.16 leak can be
 * a bigger story than a 0.4 engine spread) and each detector already proved
 * itself statistically to fire. The floor only stops a quiet tracker's list
 * from padding to the cap with small-gap findings. */
const FILL_MIN_EFFECT = OF.fillMinEffect;

/** The detectors' inputs (facts/overview_facts.ts inputsFromFacts): every number a FactCell looked up from the run's
 * one fact book under the summary's engine set. The field shapes the Brief's legacy paths and the dossiers read are
 * kept. */
export interface InsightInputs {
  /** Per buying situation (what to buy, ruling 7): your share of the picks there, your picks, the picks of a brand in
   * analysis there (firm) and every pick there (firmAll). */
  rooms: { room: string; decided: RateCell; picks: number; firm: number; firmAll: number }[];
  value: ValueView | null;
  doubt: DoubtViews;
  /** Per what-to-buy question (cell - seed + paraphrases, named by the seed): picks by brand in analysis. */
  questions: { id: string; text: string; answers: number; picks: Record<string, number> }[];
  settled: SettledViews;
  /** What to look for: each code's share of those answers, most taught first; [] under the floor. */
  taught: { code: string; rate: RateCell }[];
  alternatives: AlternativesViews;
  /** Ruling 10: the What to buy card's own away condition rows (shares of all its answers, ruling 4). null without
   * rules. `groups` / `cells` / `lead` (the run-wide rollup) are the Brief's legacy input, filled by the Brief only. */
  away: {
    rows?: CardCondRow[];
    scope?: Scope;
    groups: {
      label: string;
      rules: number;
      answers: number;
      cells: number;
      wall: boolean;
      routes: { name: string; n: number }[];
      names: { key: string; name: string } | null;
    }[];
    cells: number;
    grouping: "embeddings" | "stems";
    lead?: {
      label: string;
      answers: number;
      base: number;
      wall: boolean;
      wording: string;
      routes: { name: string; n: number }[];
      top: { label: string; answers: number }[];
    };
  } | null;
  /** Picks per brand in analysis on what to buy, by assistant (model id). */
  enginePicks: { key: string; total: number; byModel: Record<string, number> }[];
  /** Arguments on the pooled direct matchups: the answers you win and those the named rival wins, per code. */
  h2hArgs: {
    wins: number;
    losses: number;
    rivals: Record<string, string>;
    codes: { code: string; wins: number; losses: number; lossesBy: Record<string, number>; w?: RateCell; l?: RateCell }[];
    winsCell?: RateCell;
    lossesCell?: RateCell;
  };
  /** Picks that leave the category (ruling 8: outside the category), overall and per buying situation. */
  leak: {
    firm: number;
    inCategory: number;
    names: { name: string; n: number }[];
    rooms: { room: string; firm: number; outside: number }[];
    outsideCell?: RateCell;
    roomCells?: Record<string, RateCell>;
  };
  /** Problem questions answered outside the category (ruling 5: adjacent), overall and per buying situation. */
  problem: { all: RateCell; rooms: { room: string; out: RateCell }[] } | null;
  /** The Brief's legacy condition rollup (brief_legacy_inputs.ts) - not read by any detector; absent on the summary. */
  conditions?: {
    toward: { label: string; rules: number; cells: number; wall: boolean; routes: { name: string; n: number }[]; answers?: number; wording?: string }[];
    away: { label: string; rules: number; cells: number; wall: boolean; routes: { name: string; n: number }[]; answers?: number; wording?: string }[];
    towardCells: number;
    awayCells: number;
    towardThemed?: true;
    awayThemed?: true;
    towardBase?: number;
    awayBase?: number;
    defaults?: { side: "you" | "away"; label: string; cells: number; routes: { name: string; n: number }[] }[];
  } | null;
  /** Ruling 10: each direct matchup lost on balance, with its card's own toward rows counted in the answers that pick
   * the rival (the lost-with-an-exception step). */
  exception?: {
    cards: { key: string; name: string; scope: Scope; lost: FactCell; any: FactCell; rows: CardCondRow[] }[];
  } | null;
  /** Per argument, its share of the answers that pick you and of those that pick another brand in analysis, in each
   * pick contest. */
  argSides: { code: string; types: { type: ArgContest; you: RateCell; other: RateCell }[] }[];
  /** The rival keys the run asked a direct matchup against. */
  asked?: string[];
  /** In-process only: look up the pooled fact a detector states (the rest of the buying situations, the other AI
   * companies, the rest of the worries) - one fact, never a sum. */
  F?: { fact: (measure: string, subject: string, scope: Scope) => FactCell; wtb: Scope; engines: string[]; rf: RunFacts };
}

/** The detectors' inputs for a load, from the run's facts (one fact book shared with the Map). */
export async function insightInputs(data: ViewData, request: ViewRequest = {}): Promise<InsightInputs> {
  const rf = await sharedRunFacts(data, request);
  return inputsFromFacts(data, rf, summaryFromFacts(data, rf));
}

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
/** A share in print, from a fact (marked with its id - statements.ts) or, for a number that is no fact, plain. */
const pct = (c: RateCell | number) => pw(c);
/** A share in print: one decimal under 10% (so the convention's "6.7% of
 * all answers" survives rounding), whole points above. */
export const pctFine = (x: number) => {
  if (x <= 0) return "0%";
  if (x < 0.001) return "<0.1%";
  if (x < 0.1) return `${(Math.round(x * 1000) / 10).toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(x * 100)}%`;
};

/** The category's product noun in the singular ("credit cards" -> "credit
 * card", "beauty retailers" -> "beauty retailer"); unchanged when the last
 * word is not a regular plural. Mechanical - never a lookup. */
export function productNoun(category: string): string {
  const words = category.trim().split(/\s+/);
  const last = words[words.length - 1] ?? "";
  let one = last;
  if (/ies$/i.test(last) && last.length > 4) one = last.slice(0, -3) + "y";
  else if (/(ches|shes|sses|xes)$/i.test(last)) one = last.slice(0, -2);
  else if (/[^s]s$/i.test(last) && last.length > 3) one = last.slice(0, -1);
  words[words.length - 1] = one;
  return words.join(" ") || "product";
}

/** The two-pick-numbers convention (BRIEF_PILL_DESIGN_2026-11-04.md): the
 * commit rate bridges share of picks and Picked whenever both appear. */
export function commitSentence(category: string, brand: string, commit: RateCell, share: RateCell, picked: RateCell): string {
  return `The AI commits to one ${productNoun(category)} in ${pct(commit)} of answers. When it does, ${brand} is the pick ${pct(share)} of the time - ${pfine(picked)} of all answers.`;
}

/** The gap between two shares in points, derived from the two facts (statements.ts "diff_pts"). */
const pts = (a: RateCell, b: RateCell) => pd("diff_pts", [a, b]);
const counts = (c: RateCell) => `${c.k} of ${c.n} (95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%)`;
/** Two ranges apart (the first above) - a decision, logged with its facts while a gate log is open. */
const apart = (hi: RateCell, lo: RateCell) => gApart(hi, lo);
/** A base that clears the floor - logged likewise. */
const enough = (c: RateCell, min = MIN_BASE) => gN(c, min);

/** The highest and lowest of the items whose base clears the floor, when
 * their ranges do not overlap. */
function ends<T>(items: T[], cellOf: (t: T) => RateCell): { hi: T; lo: T } | null {
  const ok = items.filter((t) => enough(cellOf(t)));
  if (ok.length < 2) return null;
  const sorted = [...ok].sort((a, b) => rate(cellOf(b)) - rate(cellOf(a)));
  const hi = sorted[0];
  const lo = sorted[sorted.length - 1];
  return apart(cellOf(hi), cellOf(lo)) ? { hi, lo } : null;
}

type Summary = Omit<BrandSummaryView, "insights" | "verdict">;

function engineSpread(s: Summary): Insight | null {
  const e = ends(s.byEngine, (x) => x.decided);
  if (!e) return null;
  const gap = rate(e.hi.decided) - rate(e.lo.decided);
  return {
    key: "engine_spread",
    kind: "engine",
    title: `${e.hi.label} picks ${yo()} most, ${e.lo.label} least`,
    body: `${Yr()} share of picks is ${pct(e.hi.decided)} on ${e.hi.label} but ${pct(e.lo.decided)} on ${e.lo.label}.`,
    foot: `${e.hi.label}: ${counts(e.hi.decided)}. ${e.lo.label}: ${counts(e.lo.decided)}. Engines with fewer than ${MIN_BASE} decided answers are left out.`,
    look: { pill: "table", label: "Metrics - by engine" },
    effect: gap,
    viz: vizOf([
      W("you", insightBar(e.hi.label, e.hi.decided)),
      W("you", insightBar(e.lo.label, e.lo.decided)),
    ]),
    names: { vendor: e.lo.label, vendor2: e.hi.label },
  };
}

/** Your share of the picks by mode or by AI company: each its own fact (the mode's engines, or the company, as the
 * scope) - never a sum of the engine rows. */
function pooled(s: Summary, inp: InsightInputs | undefined, by: "mode" | "vendor"): { key: string; decided: RateCell; engines: number }[] {
  if (by === "mode") return s.byMode.map((m) => ({ key: m.key, decided: m.decided, engines: m.engines }));
  if (!inp?.F) return [];
  const vendors = [...new Set(s.byEngine.map((e) => e.vendor))].sort();
  return vendors.map((v) => ({ key: v, decided: inp.F!.fact("share_of_picks", "you", { ...inp.F!.wtb, vendor: v }), engines: s.byEngine.filter((e) => e.vendor === v).length }));
}

function modeGap(s: Summary): Insight | null {
  const modes = pooled(s, undefined, "mode");
  const search = modes.find((m) => m.key === "search");
  const instinct = modes.find((m) => m.key === "instinct");
  if (!search || !instinct || !enough(search.decided) || !enough(instinct.decided)) return null;
  const [hi, lo] = rate(search.decided) >= rate(instinct.decided) ? [search, instinct] : [instinct, search];
  if (!apart(hi.decided, lo.decided)) return null;
  const searchWins = hi === search;
  return {
    key: "engine_mode",
    kind: "engine",
    title: searchWins ? `Web search helps ${yo()}` : `Web search hurts ${yo()}`,
    body: `With web search, ${yr()} share of picks is ${pct(search.decided)}; without web search, ${pct(instinct.decided)}.`,
    foot: `Search (${search.engines} engines): ${counts(search.decided)}. Instinct (${instinct.engines} engines): ${counts(instinct.decided)}.`,
    look: { pill: "table", label: "Metrics - by mode" },
    effect: rate(hi.decided) - rate(lo.decided),
    viz: vizOf([
      W("you", insightBar("With web search", search.decided)),
      W("you", insightBar("Without web search", instinct.decided)),
    ]),
    names: { variant: searchWins ? "helps" : "hurts" },
  };
}

function vendorGap(s: Summary, inp: InsightInputs): Insight | null {
  const e = ends(pooled(s, inp, "vendor"), (x) => x.decided);
  if (!e) return null;
  return {
    key: "engine_vendor",
    kind: "engine",
    title: `${e.hi.key} favors ${yo()} most, ${e.lo.key} least`,
    body: `Across each company's AI assistants, ${yr()} share of picks is ${pct(e.hi.decided)} on ${e.hi.key} and ${pct(e.lo.decided)} on ${e.lo.key}.`,
    foot: `${e.hi.key} (${e.hi.engines} engines): ${counts(e.hi.decided)}. ${e.lo.key} (${e.lo.engines} engines): ${counts(e.lo.decided)}.`,
    look: { pill: "table", label: "Metrics - by vendor" },
    effect: rate(e.hi.decided) - rate(e.lo.decided),
    viz: vizOf([
      W("you", insightBar(e.hi.key, e.hi.decided)),
      W("you", insightBar(e.lo.key, e.lo.decided)),
    ]),
    names: { vendor: e.lo.key, vendor2: e.hi.key },
  };
}

function roomWin(inp: InsightInputs): Insight | null {
  const e = ends(inp.rooms, (r) => r.decided);
  if (!e) return null;
  return {
    key: "room_win",
    kind: "room",
    title: `Strongest with ${buyer(e.hi.room)}, weakest with ${buyer(e.lo.room)}`,
    body:
      STYLE && e.lo.decided.k === 0
        ? `${Yr()} share of picks is ${pct(e.hi.decided)} for ${buyer(e.hi.room)}, but it takes none of the picks for ${buyer(e.lo.room)}.`
        : `${Yr()} share of picks is ${pct(e.hi.decided)} for ${buyer(e.hi.room)} but ${pct(e.lo.decided)} for ${buyer(e.lo.room)}.`,
    foot: `${e.hi.room}: ${counts(e.hi.decided)}. ${e.lo.room}: ${counts(e.lo.decided)}. Open-choice questions asked for each buyer; rooms under ${MIN_BASE} decided answers left out.`,
    look: { pill: "buyers", label: "Buyers" },
    effect: rate(e.hi.decided) - rate(e.lo.decided),
    viz: vizOf([
      W("you", insightBar(lbl(e.hi.room), e.hi.decided)),
      W("you", insightBar(lbl(e.lo.room), e.lo.decided)),
    ]),
    names: { buyer: e.lo.room, buyer2: e.hi.room },
  };
}

function roomValue(inp: InsightInputs, brand: string): Insight | null {
  const rows = (inp.value?.rooms ?? []).filter((r) => r.key !== "");
  const e = ends(rows, (r) => r.worth.yes);
  if (!e) return null;
  return {
    key: "room_value",
    kind: "room",
    title: `Worth it most for ${buyer(e.hi.label)}, least for ${buyer(e.lo.label)}`,
    body:
      STYLE && e.lo.worth.yes.k === 0
        ? `Asked whether ${brand} is worth paying more for, the AI says yes ${pct(e.hi.worth.yes)} of the time for ${buyer(e.hi.label)} and never for ${buyer(e.lo.label)}.`
        : `Asked whether ${brand} is worth paying more for, the AI says yes ${pct(e.hi.worth.yes)} of the time for ${buyer(e.hi.label)} and ${pct(e.lo.worth.yes)} for ${buyer(e.lo.label)}.`,
    foot: `${e.hi.label}: ${counts(e.hi.worth.yes)}. ${e.lo.label}: ${counts(e.lo.worth.yes)}.`,
    look: { pill: "stations", station: "value", label: "Stations - Value" },
    effect: rate(e.hi.worth.yes) - rate(e.lo.worth.yes),
    viz: vizOf([
      W("you", insightBar(lbl(e.hi.label), e.hi.worth.yes)),
      W("you", insightBar(lbl(e.lo.label), e.lo.worth.yes)),
    ]),
    names: { buyer: e.lo.label, buyer2: e.hi.label },
  };
}

function rivalOpen(s: Summary): Insight | null {
  const top = s.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
  if (!top || !enough(s.target.shareOfDecided)) return null;
  const [hi, lo] = rate(top.shareOfDecided) > rate(s.target.shareOfDecided) ? [top.shareOfDecided, s.target.shareOfDecided] : [s.target.shareOfDecided, top.shareOfDecided];
  if (!apart(hi, lo)) return null;
  return {
    key: "rival_open",
    kind: "rival",
    title: rate(top.shareOfDecided) > rate(s.target.shareOfDecided) ? `${top.name} out-picks ${yo()}` : yt(`You lead ${top.name}`, (n) => `${n} leads ${top.name}`),
    body: `When buyers ask what to buy, ${top.name} takes ${pct(top.shareOfDecided)} of the picks - ${yt("you take", (n) => `${n} takes`)} ${pct(s.target.shareOfDecided)}.`,
    foot: `${top.chosen.k} picks to your ${s.target.chosen.k}, of ${s.firmPickInCategory.k} decided open-choice answers.`,
    look: { pill: "rivals", label: "Rivals" },
    effect: Math.abs(rate(top.shareOfDecided) - rate(s.target.shareOfDecided)),
    viz: vizOf([
      W("rival", insightBar(top.name, top.shareOfDecided)),
      W("you", insightBar(s.brand, s.target.shareOfDecided, undefined, true)),
    ]),
    names: { variant: rate(top.shareOfDecided) > rate(s.target.shareOfDecided) ? "behind" : "ahead", rival: top.name },
  };
}

/** The hardest direct matchup: the lowest two-way record; ties by the most answers that pick the rival, then by name.
 * One rule for the hardest-matchup finding, the prompted-vs-open finding and the exception finding. */
function hardestOf(ok: Summary["headToHead"]): Summary["headToHead"][number] | null {
  return [...ok].sort((a, b) => rate(a.winOfDecided) - rate(b.winOfDecided) || b.lost.k - a.lost.k || a.rival.localeCompare(b.rival))[0] ?? null;
}

function rivalHeadToHead(s: Summary): Insight | null {
  const ok = s.headToHead.filter((r) => enough(r.winOfDecided));
  if (ok.length === 0) return null;
  const closest = [...ok].sort((a, b) => Math.abs(rate(a.winOfDecided) - 0.5) - Math.abs(rate(b.winOfDecided) - 0.5))[0];
  const worst = hardestOf(ok)!;
  const foot = (r: typeof closest) =>
    `vs ${r.rival}: won ${r.won.k}, lost ${r.lost.k} - 95% range ${Math.round(r.winOfDecided.low * 100)}-${Math.round(r.winOfDecided.high * 100)}%`;
  if (closest.key === worst.key) {
    return {
      key: "rival_h2h",
      kind: "rival",
      title: `Direct matchup with ${worst.rival}`,
      body: STYLE
        ? `Asked to choose between ${yo()} and ${worst.rival}, the AI ${pickedOfTwo(worst.winOfDecided)}.`
        : `Asked to choose between you and ${worst.rival}, the AI picks you ${pct(worst.winOfDecided)} of the time it picks one of you.`,
      foot: `${foot(worst)}. Matchups under ${MIN_BASE} decided answers left out.`,
      look: { pill: "rivals", label: "Rivals - head-to-head" },
      effect: Math.abs(rate(worst.winOfDecided) - 0.5),
      viz: h2hBars(ok, worst.key, undefined),
      names: { variant: rate(worst.winOfDecided) < 0.5 ? "lose" : "win", rival: worst.rival },
    };
  }
  return {
    key: "rival_h2h",
    kind: "rival",
    title: `Hardest direct matchup: ${worst.rival}`,
    body: STYLE
      ? `Asked to compare ${yo()} with ${worst.rival} directly, the AI ${pickedOfTwo(worst.winOfDecided)}; its best matchup is ${closest.rival}, at ${pct(closest.winOfDecided)}.`
      : `Asked to compare you with ${worst.rival} directly, the AI picks you ${pct(worst.winOfDecided)} of the time it picks one of you; your best matchup is ${closest.rival}, at ${pct(closest.winOfDecided)}.`,
    foot: `${foot(worst)}. ${foot(closest)}. Matchups under ${MIN_BASE} decided answers left out.`,
    look: { pill: "rivals", label: "Rivals - head-to-head" },
    effect: Math.abs(rate(closest.winOfDecided) - rate(worst.winOfDecided)),
    viz: h2hBars(ok, worst.key, closest.key),
    names: { variant: rate(worst.winOfDecided) < 0.5 ? "lose" : "win", rival: worst.rival },
  };
}

/** One bar per named rival's direct-matchup record, the hardest first and
 * marked; the best matchup always kept; at most four. */
function h2hBars(ok: Summary["headToHead"], hardest: string, keep?: string): InsightBar[] | undefined {
  const asc = [...ok].sort((a, b) => rate(a.winOfDecided) - rate(b.winOfDecided) || a.rival.localeCompare(b.rival));
  let rows = asc.slice(0, 4);
  const best = keep ? asc.find((r) => r.key === keep) : undefined;
  if (best && !rows.includes(best)) rows = [...rows.slice(0, 3), best];
  // Each bar is your win share against that rival - your number.
  return vizOf(rows.map((r) => W("you", insightBar(`vs ${r.rival}`, r.winOfDecided, undefined, r.key === hardest))));
}

function argument(s: Summary): Insight | null {
  // Ruling 1 (2026-11-18): each end is the strongest argument that is not seldom raised; a seldom one leads only when
  // every argument on its side is seldom raised, and the sentence says so.
  const rl = s.reasonLift;
  const best = liftLead(rl.filter((l) => l.lift > 0))?.row ?? rl[0];
  const worst = liftLead([...rl].reverse().filter((l) => l.lift < 0))?.row ?? (rl.length > 1 ? rl[rl.length - 1] : undefined);
  if (!best || !worst || worst === best) return null;
  const st = (x: { seldom: boolean }) => (x.seldom ? ", though it is seldom raised" : "");
  // bf34: the Brief quotes the card - the strongest winning and losing arguments the card shows, its own figures.
  const ca = STYLE?.cardArg;
  const cb = ca ? leadsFirst(rl.filter((l) => l.lift > 0)).map((l) => ({ l, f: ca(l.code, "you") })).find((x) => x.f) : undefined;
  const cw = ca ? leadsFirst([...rl].reverse().filter((l) => l.lift < 0)).map((l) => ({ l, f: ca(l.code, "rival") })).find((x) => x.f) : undefined;
  const cardBody = !ca
    ? null
    : cb
      ? `${cb.f!.name} comes up in ${cb.f!.here} of the answers that pick ${STYLE!.name} and ${cb.f!.there} of those that pick a rival${st(cb.l)}.${cw ? ` Answers that pick a rival bring up ${cw.f!.name.toLowerCase()} in ${cw.f!.here}, against ${cw.f!.there} when ${STYLE!.name} is picked${st(cw.l)}.` : ""}`
      : "";
  return {
    key: "argument",
    kind: "argument",
    title: `${best.code.charAt(0).toUpperCase()}${best.code.slice(1)} comes up when ${yt("you win", (n) => `${n} wins`)}`,
    // bf29: the Brief's style states both shares in plain words (no points shorthand); the served text is unchanged.
    body: cardBody !== null
      ? cardBody
      : STYLE
      ? `${best.code.charAt(0).toUpperCase()}${best.code.slice(1)} comes up in ${pz(best.wins)} of the answers that pick ${STYLE.name} and ${pz(best.others)} of those that pick a rival${st(best)}. Answers that pick a rival bring up ${worst.code} in ${pz(worst.others)}, against ${pz(worst.wins)} when ${STYLE.name} is picked${st(worst)}.`
      : `${best.code.charAt(0).toUpperCase()}${best.code.slice(1)} comes up ${pts(best.wins, best.others)} ${best.lift >= 0 ? "more" : "less"} often in answers that pick ${yo()} than in answers that pick a rival${st(best)}. Answers that pick a rival bring up ${worst.code} ${worst.lift <= 0 ? "more" : "less"} (${pts(worst.wins, worst.others)})${st(worst)}.`,
    foot: `${best.code}: ${pct(best.wins)} of ${best.wins.n} wins vs ${pct(best.others)} of ${best.others.n} rival picks. ${worst.code}: ${pct(worst.wins)} vs ${pct(worst.others)}.`,
    look: { pill: "why", label: "Why" },
    effect: best.lift - worst.lift,
    viz: vizOf([
      W("you", insightBar("In your picks", best.wins, undefined, true)),
      W("rival", insightBar("In rivals' picks", best.others)),
    ]),
    names: { topic: best.code },
  };
}

function doubtRollup(s: Summary): Insight | null {
  const b = s.buyersDoubt;
  const c = s.customersDoubt;
  if (!b && !c) return null;
  const raw = [b && `buyers told to go ahead ${pct(b.proceed)}`, c && `customers told to stay ${pct(c.keep)}`].filter(Boolean).join(" - ");
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  const body = [
    b && `When a buyer voices a worry about ${s.brand}, the AI agrees it is ${fairW()} ${pct(b.agree)} of the time it takes a side.`,
    c && `Customers weighing a worry are told to leave ${pct(c.leave)}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const foot = [
    b && `Buyers: go ahead ${counts(b.proceed)}, avoid ${b.avoid.k}, agrees ${counts(b.agree)}.`,
    c && `Customers: stay ${counts(c.keep)}, leave ${c.leave.k}, agrees ${counts(c.agree)}.`,
    "Reported apart from the open-choice numbers.",
  ]
    .filter(Boolean)
    .join(" ");
  const effect = Math.max(
    b ? Math.abs(rate(b.proceed) - rate(b.avoid)) : 0,
    c ? Math.abs(rate(c.keep) - rate(c.leave)) : 0
  );
  return {
    key: "doubt_rollup",
    kind: "doubt",
    title,
    body,
    foot,
    look: { pill: "stations", station: b ? "doubts" : "customer_base", label: b ? "Stations - Doubts" : "Stations - Customers" },
    effect,
    viz: vizOf([
      b && W("you", insightBar("Buyers told to go ahead", b.proceed)),
      b && W("other", insightBar("Agrees with buyers' worries", b.agree)),
      c && W("you", insightBar("Customers told to stay", c.keep)),
      c && W("other", insightBar("Customers told to leave", c.leave)),
    ]),
    names: { variant: (c && rate(c.leave) > rate(c.keep)) || (b && rate(b.avoid) > rate(b.proceed)) ? "loses" : "holds" },
  };
}

function doubtWorry(inp: InsightInputs): Insight | null {
  type Cand = { row: WorryRow<string>; pool: RateCell; who: "buyer" | "customer" };
  const cands: Cand[] = [];
  const o = inp.doubt.objections;
  const k = inp.doubt.keepOrLeave;
  if (o) for (const row of o.rows) cands.push({ row, pool: o.premise.confirms, who: "buyer" });
  if (k) for (const row of k.rows) cands.push({ row, pool: k.premise.confirms, who: "customer" });
  const ok = cands.filter((c) => enough(c.row.premise.confirms));
  if (ok.length < 2) return null;
  const top = [...ok].sort((a, b) => rate(b.row.premise.confirms) - rate(a.row.premise.confirms))[0];
  const gap = rate(top.row.premise.confirms) - rate(top.pool);
  // The pool contains the worry, so the test is the worry's range clearing the pool's rate.
  if (!gLowAbove(top.row.premise.confirms, rate(top.pool))) return null;
  return {
    key: "doubt_worry",
    kind: "doubt",
    title: `The worry it agrees with most: ${top.row.concern}`,
    body: `When a ${top.who} raises "${top.row.concern}", the AI agrees it is ${fairW()} ${
      STYLE && top.row.premise.confirms.k === top.row.premise.confirms.n ? "every time it takes a side" : `${pct(top.row.premise.confirms)} of the time it takes a side`
    } - against ${pct(top.pool)} across all ${top.who}s' worries.`,
    foot: `${top.row.concern}: ${counts(top.row.premise.confirms)}. All ${top.who} worries: ${counts(top.pool)}. Worries under ${MIN_BASE} judged answers left out.`,
    look: { pill: "stations", station: top.who === "buyer" ? "doubts" : "customer_base", label: top.who === "buyer" ? "Stations - Doubts" : "Stations - Customers" },
    effect: gap,
    viz: vizOf([
      W(
        "you",
        insightBar(lbl(top.row.concern), top.row.premise.confirms, undefined, true)
      ),
      W("other", insightBar(`All ${top.who}s' worries`, top.pool)),
    ]),
    names: { worry: top.row.concern },
  };
}

function funnelDrop(s: Summary): Insight | null {
  if (!enough(s.target.mentioned)) return null;
  const named = rate(s.target.mentioned);
  const rec = rate(s.target.recommended);
  const picked = rate(s.target.chosen);
  const steps = [
    { from: "named", to: "recommended", a: named, b: rec, ca: s.target.mentioned, cb: s.target.recommended },
    { from: "recommended", to: "picked", a: rec, b: picked, ca: s.target.recommended, cb: s.target.chosen },
  ];
  const worst = steps.sort((x, y) => y.a - y.b - (x.a - x.b))[0];
  const drop = worst.a - worst.b;
  if (drop <= 0) return null;
  return {
    key: "funnel",
    kind: "funnel",
    title: `The drop is from ${worst.from} to ${worst.to}`,
    body: STYLE
      ? `When buyers ask what to buy, ${STYLE.name} is ${worst.from} in ${pct(worst.ca)} of answers but ${worst.to} in ${worst.to === "picked" ? pfine(worst.cb) : pct(worst.cb)}; no other step loses as many answers.`
      : `When buyers ask what to buy, you are ${worst.from} in ${pct(worst.ca)} of answers but ${worst.to} in ${worst.to === "picked" ? pfine(worst.cb) : pct(worst.cb)} - the biggest step down in the funnel.`,
    foot: `Named ${counts(s.target.mentioned)}; recommended ${counts(s.target.recommended)}; picked ${counts(s.target.chosen)}.`,
    look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
    effect: drop,
    viz: vizOf([
      W("you", insightBar("Named", s.target.mentioned)),
      W("you", insightBar("Recommended", s.target.recommended, undefined, worst.to === "recommended")),
      W("you", insightBar("Picked", s.target.chosen, pfine(s.target.chosen), worst.to === "picked")),
    ]),
  };
}

/** The prompted head-to-head record pooled over the entity rivals, with the
 * hardest matchup (lowest win share) that clears the floor. */
function promptedRecord(s: Summary): { pooled: RateCell; won: number; lost: number; hardest: Summary["headToHead"][number] | null } | null {
  // The pooled record is its own fact (every named rival's matchups, the question's own rival on each answer).
  const pooled = s.headToHeadAll;
  if (!pooled || !enough(pooled)) return null;
  const ok = s.headToHead.filter((r) => enough(r.winOfDecided));
  const hardest = hardestOf(ok);
  return { pooled, won: pooled.k, lost: pooled.n - pooled.k, hardest };
}

function promptedVsOpen(s: Summary): Insight | null {
  const rec = promptedRecord(s);
  const open = s.target.shareOfDecided;
  if (!rec || !enough(open)) return null;
  const gap = rate(rec.pooled) - rate(open);
  if (!gGap(rec.pooled, open, OF.promptedGap)) return null;
  if (!(gap > 0 ? apart(rec.pooled, open) : apart(open, rec.pooled))) return null;
  const hard = rec.hardest;
  const hardText = hard ? ` (${pct(hard.winOfDecided)} against ${hard.rival})` : "";
  return {
    key: "prompted_vs_open",
    kind: "rival",
    title: gap > 0 ? "Wins when compared directly, loses when buyers ask what to buy" : "Wins when buyers ask what to buy, loses when compared directly",
    body:
      gap > 0
        ? `Asked to compare ${yo()} with a rival directly, the AI picks ${yo()} in ${pct(rec.pooled)} of matchups${hardText}, but when buyers ask what to buy ${yt("you take", (n) => `${n} takes`)} ${pct(open)} of the picks.`
        : `When buyers ask what to buy ${yt("you take", (n) => `${n} takes`)} ${pct(open)} of the picks, but asked to compare ${yo()} with a rival directly, the AI picks ${yo()} in only ${pct(rec.pooled)} of matchups${hardText}.`,
    foot: `Head-to-heads: won ${rec.won}, lost ${rec.lost} - ${counts(rec.pooled)}${hard ? `; vs ${hard.rival} ${counts(hard.winOfDecided)}` : ""}. Open choice: ${counts(open)}.`,
    look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
    effect: Math.abs(gap),
    viz: vizOf([
      W("you", insightBar("Direct matchups won", rec.pooled)),
      W("you", insightBar("Share of picks when buyers ask", open, undefined, true)),
      hard && W("you", insightBar(`Against ${hard.rival}`, hard.winOfDecided)),
    ]),
    names: { variant: gap > 0 ? "matchups" : "open" },
  };
}

/** The room the target's open-choice picks come from most. */
function roomConcentration(s: Summary, inp: InsightInputs) {
  const total = s.target.chosen.k;
  if (!inp.F || inp.rooms.length < 2) return null;
  const top = [...inp.rooms].sort((a, b) => b.picks - a.picks || a.room.localeCompare(b.room))[0];
  // Of your picks, the share from that buying situation; your share of the picks everywhere else - two facts.
  const shareC = inp.F.fact("slice_share", `ai/slice:${sitSlice(top.room)}`, { ...inp.F.wtb, when: "pick:you" });
  if (!enough(shareC) || !gAtLeast(shareC, OF.roomConcentration)) return null;
  const outside = inp.F.fact("share_of_picks", "you", { ...inp.F.wtb, when: `!${sitSlice(top.room)}` });
  return { top, share: rate(shareC), shareC, total, outside, rooms: inp.rooms.length };
}

function pickConcentrationRoom(s: Summary, inp: InsightInputs): Insight | null {
  const c = roomConcentration(s, inp);
  if (!c) return null;
  return {
    key: "pick_concentration_room",
    kind: "room",
    title: `${Yr()} picks come from ${buyer(c.top.room)}`,
    // bf35: the Brief states only what the cards show - the share of the picks for that buyer and across all
    // buyers (the share of its own picks and "everywhere else" are on no card).
    body: STYLE?.roomShare
      ? (() => {
          const here = STYLE.roomShare!(c.top.room);
          const all = STYLE.roomShare!(null);
          return here ? `When ${buyer(c.top.room)} asks what to buy, ${STYLE.name} takes ${here} of the picks${all ? `, against ${all} across all buyers` : ""}.` : "";
        })()
      : `${pct(c.shareC)} of the times the AI picks ${s.brand} when buyers ask what to buy come from one buying situation, ${buyer(c.top.room)} - there ${yt("you take", (n) => `${n} takes`)} ${pct(c.top.decided)} of the picks, everywhere else ${pct(c.outside)}.`,
    foot: `${c.top.picks} of ${c.total} picks from ${c.top.room} (one of ${c.rooms} rooms). Inside: ${counts(c.top.decided)}. Outside: ${counts(c.outside)}.`,
    look: { pill: "buyers", label: "Buyers" },
    effect: c.share - 1 / c.rooms,
    viz: vizOf([
      W("you", insightBar(`Your picks from ${lbl(c.top.room, 32)}`, c.shareC, undefined, true)),
      W("you", insightBar(`Share of picks there`, c.top.decided)),
      W("you", insightBar("Share of picks elsewhere", c.outside)),
    ]),
    names: { buyer: c.top.room },
  };
}

/** "Ruffles'" / "Max's" - possessive of a brand name. */
const poss = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

const shorten = (t: string, n = 80) => {
  const x = t.replace(/\s+/g, " ").trim();
  return x.length <= n ? x : `${x.slice(0, n - 1).replace(/\s+\S*$/, "").replace(/[\s.,;:!?-]+$/, "")}...`;
};

/** bs26: a quoted question is whole when it fits (every fixture question does - the longest is under 180
 * characters); a longer one is cut at a word boundary with the ellipsis inside the quotes. It was cut at 80,
 * mid-sentence ("What credit cards should I..."). */
const QUOTE_MAX = 180;
const quoteQuestion = (t: string) => shorten(t, QUOTE_MAX);

/** The question (cell) a brand's picks concentrate in, for the target and the top rival. */
function questionConcentration(s: Summary, inp: InsightInputs, key: string) {
  if (!inp.F || inp.questions.length < 2) return null;
  const top = [...inp.questions].sort((a, b) => (b.picks[key] ?? 0) - (a.picks[key] ?? 0) || a.id.localeCompare(b.id))[0];
  // Of the brand's picks, the share from that one question - one fact.
  const shareC = inp.F.fact("slice_share", `ai/slice:cell:${top.id}`, { ...inp.F.wtb, when: `pick:${key === s.target.key ? "you" : key}` });
  if (!enough(shareC) || !gAtLeast(shareC, OF.questionConcentration)) return null;
  return { top, k: shareC.k, total: shareC.n, share: rate(shareC), shareC, n: inp.questions.length };
}

function pickConcentrationQuestion(s: Summary, inp: InsightInputs): Insight | null {
  const rival = s.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
  const cands = [
    { who: s.brand, isTarget: true, key: s.target.key, c: questionConcentration(s, inp, s.target.key) },
    ...(rival ? [{ who: rival.name, isTarget: false, key: rival.key, c: questionConcentration(s, inp, rival.key) }] : []),
  ].filter((x) => x.c !== null);
  if (cands.length === 0) return null;
  const best = cands.sort((a, b) => b.c!.share - a.c!.share)[0];
  const c = best.c!;
  const q = quoteQuestion(c.top.text);
  return {
    key: "pick_concentration_question",
    kind: "question",
    title: best.isTarget ? `One question carries ${yr()} picks` : `One question carries ${best.who}'s picks`,
    // bf35: no card is per question, so the Brief does not cite this finding.
    body: STYLE?.roomShare ? "" : `${pct(c.shareC)} of ${best.isTarget ? yr() : `${best.who}'s`} picks come from one question: "${q}"`,
    foot: `${c.k} of ${c.total} picks of ${best.who} from this question (one of ${c.n} open-choice questions, ${c.top.answers} answers, a seed and its paraphrases pooled).`,
    look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
    effect: c.share - 1 / c.n,
    viz: vizOf([
      W(best.isTarget ? "you" : "rival", insightBar("Picks from this question", c.shareC, undefined, true)),
      W("other", insightBar("If spread evenly", 1 / c.n, pd("even", [], c.n))),
    ]),
    names: best.isTarget ? { variant: "you" } : { variant: "rival", rival: best.who },
  };
}

function agreedYetStay(inp: InsightInputs): Insight | null {
  type C = { who: "buyer" | "customer"; kind: "objections" | "keep"; confirmed: RateCell; given: RateCell; verb: string };
  const cands: C[] = [];
  const o = inp.doubt.objections;
  const k = inp.doubt.keepOrLeave;
  if (o) cands.push({ who: "buyer", kind: "objections", confirmed: o.premise.confirms, given: o.matrix.confirms.proceed, verb: "go ahead" });
  if (k) cands.push({ who: "customer", kind: "keep", confirmed: k.premise.confirms, given: k.matrix.confirms.keep, verb: "stay" });
  const ok = cands.filter((c) => enough(c.confirmed) && enough(c.given) && gAtLeast(c.confirmed, OF.agreedShare) && gAtLeast(c.given, OF.agreedGiven));
  if (ok.length === 0) return null;
  const best = ok.sort((a, b) => rate(b.confirmed) * rate(b.given) - rate(a.confirmed) * rate(a.given))[0];
  return {
    key: "agreed_yet_stay",
    kind: "doubt",
    title: best.who === "buyer" ? "Agrees with the worry, still says go ahead" : "Agrees with the worry, still says stay",
    body: `When a ${best.who} raises a worry, the AI agrees it is ${fairW()} ${pct(best.confirmed)} of the time it takes a side - and in ${pct(best.given)} of those answers still tells them to ${best.verb}.`,
    foot: `Agrees: ${counts(best.confirmed)}. Of those, ${best.verb}: ${counts(best.given)}.`,
    look: { pill: "stations", station: best.who === "buyer" ? "doubts" : "customer_base", label: best.who === "buyer" ? "Stations - Doubts" : "Stations - Customers" },
    effect: rate(best.confirmed) * rate(best.given),
    viz: vizOf([
      W("other", insightBar("Agrees the worry is fair", best.confirmed)),
      W(
        "you",
        insightBar(`Still told to ${best.verb}`, best.given, undefined, true)
      ),
    ]),
  };
}

function taughtVsWinning(s: Summary, inp: InsightInputs): Insight | null {
  if (inp.taught.length === 0 || s.reasonLift.length === 0) return null;
  const top5 = inp.taught.slice(0, 5);
  const taughtSet = new Set(top5.map((t) => t.code));
  // Ruling 1: the winning argument is the strongest that is not seldom raised (liftLead), the losing one likewise.
  const best = liftLead(s.reasonLift.filter((l) => l.lift > 0))?.row ?? s.reasonLift[0];
  const untaught = best.lift > 0 && !taughtSet.has(best.code) && apart(best.wins, best.others) ? best : null;
  const losing = leadsFirst(
    top5
      .map((t) => s.reasonLift.find((l) => l.code === t.code))
      .filter((l): l is NonNullable<typeof l> => !!l && l.lift < 0 && apart(l.others, l.wins))
      .sort((a, b) => a.lift - b.lift)
  )[0] ?? null;
  const st = (x: { seldom: boolean }) => (x.seldom ? ", though it is seldom raised" : "");
  if (!untaught && !losing) return null;
  const taughtOf = (code: string) => inp.taught.find((t) => t.code === code)?.rate;
  const parts: string[] = [];
  const foot: string[] = [];
  // bf34: in the Brief only an argument the card shows is cited, with the card's figures.
  const ca = STYLE?.cardArg;
  const cu = untaught && ca ? ca(untaught.code, "you") : null;
  const cl = losing && ca ? ca(losing.code, "rival") : null;
  const cited: string[] = [];
  if (ca) {
    if (cu) cited.push(`${cu.name.toLowerCase()} comes up in ${cu.here} of the answers that pick ${STYLE!.name} and ${cu.there} of those that pick a rival${st(untaught!)}, but is not among the five things the AI most often tells buyers to look for`);
    if (cl) cited.push(`${cu ? "it" : "the AI"} tells buyers to look for ${cl.name.toLowerCase()}, which comes up in ${cl.here} of the answers that pick a rival and ${cl.there} of those that pick ${STYLE!.name}${st(losing!)}`);
  }
  if (untaught) {
    parts.push(
      STYLE
        ? `${untaught.code} comes up in ${pz(untaught.wins)} of the answers that pick ${STYLE.name} and ${pz(untaught.others)} of those that pick a rival${st(untaught)}, but is not among the five things the AI most often tells buyers to look for`
        : `${untaught.code} comes up ${pts(untaught.wins, untaught.others)} more often when you win${st(untaught)} but is not among the five things the AI most often tells buyers to look for`
    );
    const tr = taughtOf(untaught.code);
    foot.push(`${untaught.code}: ${pct(untaught.wins)} of wins vs ${pct(untaught.others)} of rival picks; taught in ${tr ? counts(tr) : "no"} criteria answers.`);
  }
  if (losing) {
    parts.push(
      STYLE
        ? `${untaught ? "it" : "the AI"} tells buyers to look for ${losing.code}, which comes up in ${pz(losing.others)} of the answers that pick a rival and ${pz(losing.wins)} of those that pick ${STYLE.name}${st(losing)}`
        : `${untaught ? "it" : "the AI"} tells buyers to look for ${losing.code}, which shows up more when a rival is picked (${pd("diff_signed", [losing.wins, losing.others])})${st(losing)}`
    );
    foot.push(`${losing.code}: ${pct(losing.wins)} of wins vs ${pct(losing.others)} of rival picks; taught in ${counts(taughtOf(losing.code)!)}.`);
  }
  // In the Brief each cited argument is its own sentence, so each figure is read with its own argument.
  const joined = ca ? cited.map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(". ") : parts.join("; ");
  const body = joined;
  const effect = Math.max(untaught ? Math.abs(untaught.lift) : 0, losing ? Math.abs(losing.lift) : 0);
  return {
    key: "taught_vs_winning",
    kind: "argument",
    title: untaught ? `${untaught.code} wins but is seldom taught` : `The AI tells buyers to look for ${losing!.code}, which favors rivals`,
    body: body ? `${body.charAt(0).toUpperCase()}${body.slice(1)}.` : "",
    foot: `${foot.join(" ")} Top five taught: ${top5.map((t) => t.code).join(", ")}.`,
    look: { pill: "why", label: "Why" },
    effect,
    viz: (() => {
      const x = untaught ?? losing!;
      const tr = taughtOf(x.code);
      return vizOf([
        W("you", insightBar("In your picks", x.wins, undefined, true)),
        W("rival", insightBar("In rivals' picks", x.others)),
        tr && W("other", insightBar("In what the AI teaches buyers", tr)),
      ]);
    })(),
    names: untaught ? { variant: "untaught", topic: untaught.code } : { variant: "losing", topic: losing!.code },
  };
}

function valueInHouse(inp: InsightInputs, brand: string): Insight | null {
  // Ruling 3: each price answer in one bucket - a rival, else only the brand's own cheaper option, else nowhere -
  // as shares of ALL the price answers.
  const v = inp.value;
  if (!v || !enough(v.ownRung)) return null;
  const own = rate(v.ownRung);
  const riv = rate(v.recommendsInstead);
  if (!gAtLeast(v.ownRung, OF.valueSide) && !gAtLeast(v.recommendsInstead, OF.valueSide)) return null;
  const ladder = !!inp.F?.rf.set.ladder;
  const inHouse = ladder && own >= riv;
  const top = v.instead.find((i) => i.own === inHouse);
  const topText = top ? ` - most often ${top.name}` : "";
  return {
    key: "value_in_house",
    kind: "value",
    title: inHouse ? "On price, the AI points to your own cheaper option" : "On price, the AI points to rivals",
    // A brand that sells no ladder of its own lines has no own cheaper option to name (ruling 3's own bucket).
    body: inHouse
      ? `Asked whether ${brand} is worth the price, the AI points the buyer to only its own cheaper option in ${pct(v.ownRung)} of answers${topText}, and to a rival in ${pct(v.recommendsInstead)}.`
      : `Asked whether ${brand} is worth the price, the AI points the buyer to a rival in ${pct(v.recommendsInstead)} of answers${topText}${ladder ? `, and to only its own cheaper option in ${pct(v.ownRung)}` : ""}.`,
    foot: `Of every price answer: only your own cheaper option ${counts(v.ownRung)}; a rival ${counts(v.recommendsInstead)}.${top ? ` ${top.name}: ${top.n}.` : ""}`,
    look: { pill: "stations", station: "value", label: "Stations - Value" },
    effect: Math.abs(own - riv),
    viz: vizOf([ladder && W("you", insightBar("Your own cheaper option", v.ownRung, undefined, inHouse)), W("rival", insightBar("A rival", v.recommendsInstead, undefined, !inHouse)), !ladder && W("other", insightBar("Nowhere", inp.F!.fact("instead_nowhere", "ai", { types: ["pricing"] })))]),
    names: { variant: inHouse ? "own" : "rivals" },
  };
}

function advocacyVsObjection(inp: InsightInputs): Insight | null {
  const adv = inp.settled.advocacy;
  const o = inp.doubt.objections;
  if (!adv || !o) return null;
  const strengthens = adv.verdicts.strengthens;
  const strong = adv.caseStrength.strong;
  const defend = rate(strengthens) >= rate(strong) ? strengthens : strong;
  const confirms = o.premise.confirms;
  if (!enough(defend) || !enough(confirms) || !gAtLeast(defend, OF.advocacyShare) || !gAtLeast(confirms, OF.advocacyShare)) return null;
  return {
    key: "advocacy_vs_objection",
    kind: "doubt",
    title: `Defends ${yo()} when asked, concedes when asked neutrally`,
    body: `Asked to defend the brand, the AI strengthens the case ${pct(defend)} of the time; asked about buyers' worries, it agrees they are ${fairW()} ${pct(confirms)} of the time.`,
    foot: `Advocacy: ${counts(defend)}. Buyers' worries agreed: ${counts(confirms)}.`,
    look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    effect: Math.min(rate(defend), rate(confirms)) - 0.5,
    viz: vizOf([
      W("you", insightBar("Makes the case when asked", defend)),
      W("other", insightBar("Agrees with buyers' worries", confirms)),
    ]),
  };
}

/* ------------------------------ bs7: switching ----------------------------- */


function leaverCapture(inp: InsightInputs): Insight | null {
  const o = inp.alternatives.offensive;
  if (!o || !enough(o.overall.named)) return null;
  const t = o.overall;
  const you = o.captors.find((c) => c.role === "target") ?? null;
  const takers = o.captors.filter((c) => c.chosen.k > 0);
  const decided = takers.length ? takers[0].shareOfDecided.n : 0;
  const lead = takers[0] ?? null;
  // Strength: you are the brand rival leavers are sent to most.
  if (you && lead && lead.role === "target" && decided >= MIN_BASE && enough(you.shareOfDecided) && takers.length >= 2) {
    const sources = o.rows.filter((r) => r.answers >= MIN_BASE && r.key !== "generic");
    const src = [...sources].sort((a, b) => rate(b.captured) - rate(a.captured) || a.rival.localeCompare(b.rival))[0];
    const second = takers.find((c) => c.role !== "target");
    return {
      key: "leaver_capture",
      kind: "switching",
      title: `Rivals' customers come to ${yo()}`,
      body: `When a rival's customer asks what to switch to, the AI picks ${yo()} in ${pct(t.captured)} of answers - ${yt("you take", (n) => `${n} takes`)} ${pct(you.shareOfDecided)} of the picks${src ? ` - most often for customers leaving ${src.rival}, at ${pct(src.captured)}` : ""}.`,
      foot: `Picked ${counts(t.captured)}; of the switching customers' picks ${counts(you.shareOfDecided)}.${second ? ` Next: ${second.name}, ${second.chosen.k}.` : ""}${src ? ` Leaving ${src.rival}: ${counts(src.captured)}.` : ""}`,
      look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
      effect: rate(you.shareOfDecided) - 1 / takers.length,
      viz: vizOf([
        W("you", insightBar("Picked", t.captured)),
        W("you", insightBar("Share of the picks", you.shareOfDecided, undefined, true)),
        src && W("you", insightBar(`Leaving ${src.rival}`, src.captured)),
      ]),
      names: { variant: "capture", ...(src ? { rival: src.rival } : {}) },
    };
  }
  // Tension: leavers hear about you and are almost never told to take you.
  if (gAtLeast(t.named, OF.leaverNamed) && gBelow(t.captured, OF.leaverNever) && apart(t.named, t.captured)) {
    const other = takers.find((c) => c.role !== "target") ?? null;
    return {
      key: "leaver_capture",
      kind: "switching",
      title: `Rivals' customers hear about ${yo()}, then go elsewhere`,
      body: `When a rival's customer asks what to switch to, the AI names ${yo()} in ${pct(t.named)} of answers and recommends ${STYLE ? "it" : "you"} in ${pct(t.recommended)}, but ${
        STYLE && t.captured.k === 0 ? "never picks it" : `picks ${STYLE ? "it" : "you"} in ${pct(t.captured)}`
      }${other ? ` - ${other.name} takes the most, ${pct(other.shareOfDecided)} of the picks` : ""}.`,
      foot: `Named ${counts(t.named)}; recommended ${counts(t.recommended)}; picked ${counts(t.captured)}.${other ? ` ${other.name}: ${other.chosen.k} of ${other.shareOfDecided.n} decided.` : ""}`,
      look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
      effect: rate(t.named) - rate(t.captured),
      viz: vizOf([W("you", insightBar("Named", t.named)), W("you", insightBar("Recommended", t.recommended)), W("you", insightBar("Picked", t.captured, undefined, true))]),
      names: { variant: "miss", ...(other ? { rival: other.name } : {}) },
    };
  }
  return null;
}

function ownDefense(inp: InsightInputs): Insight | null {
  const d = inp.alternatives.defensive;
  if (!d || !enough(d.verdicts.keep)) return null;
  const top = d.destinations[0];
  const keep = d.verdicts.keep;
  if (!top || !gAtLeast(top.offered, OF.ownDefenseShown) || !gBelow(keep, OF.ownDefenseShown)) return null;
  // Exits shown about as often as the top one are named with it (a list of
  // alternatives often carries the same two or three brands every time).
  const tied = d.destinations.filter((x) => rate(top.offered) - rate(x.offered) <= OF.ownDefenseTiedPts).slice(0, 3);
  const names = tied.map((x) => x.name);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    key: "own_defense",
    kind: "switching",
    title: `${who} ${names.length === 1 ? "is the exit" : "are the exits"} shown to ${yr()} customers`,
    body: `Asked what else to consider, ${yr()} own customers ${
      keep.k === 0 && d.verdicts.leave.k === 0
        ? `are never told to stay or to leave,`
        : STYLE && keep.k === 0
          ? `are never told to stay, are told to leave in ${pct(d.verdicts.leave)} of answers, the AI takes no side in ${pct(d.verdicts.undecided)},`
          : `are told to stay in ${pct(keep)} of answers and to leave in ${pct(d.verdicts.leave)}, the AI takes no side in ${pct(d.verdicts.undecided)},`
    } and ${names.length === 1 ? `${who} appears in ${pct(top.offered)}` : `${who} each appear in at least ${pct(tied[tied.length - 1].offered)}`}.`,
    foot: `Stay ${counts(keep)}; leave ${counts(d.verdicts.leave)}; no side ${counts(d.verdicts.undecided)}; another brand shown ${counts(d.offersExit)}; ${tied.map((x) => `${x.name} ${x.offered.k} (${x.onKeep} on stay answers)`).join("; ")}.`,
    look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    // One rival as the default exit, held down by how often the AI still says stay.
    effect: Math.min(rate(top.offered), 1 - rate(keep)) - 0.5,
    viz: vizOf([W("you", insightBar("Told to stay", keep, undefined, true)), ...tied.map((x) => W("rival", insightBar(`${x.name} shown`, x.offered)))]),
    names: { rival: who },
  };
}

/* ------------------------------ bs7: conditions ---------------------------- */

/** Condition counts are lower bounds (wordings the grouping did not join are
 * left out), so the floor is on grouped rules, not MIN_BASE answers. */
const AWAY_MIN_RULES = 15;
/** A brand the AI almost never picks in the open choice. */
const BLOCKER_SHARE = 0.02;

/**
 * Ruling 10 (2026-11-17): the condition that sends buyers away is counted inside ONE question type - the What to buy
 * card's own away rows, every share of all the card's answers (ruling 4) - and the finding opens on that card. The
 * lead is the card's first row; a fixed situation (a possession-shaped row) and a blocker (a row naming a brand the AI
 * almost never picks) are that card's rows too, each with its own share.
 */
function awayCondition(s: Summary, inp: InsightInputs): Insight | null {
  const rows = inp.away?.rows ?? [];
  const lead = rows[0];
  if (!lead || !gK(lead.share, OF.awayLeadMin)) return null;
  const dest = destOf(lead.routes, lead.routed);
  const to = lead.routes[0];
  // A blocker: the lead row names a brand that almost never wins when buyers ask what to buy.
  let blocker = "";
  let blockerFoot = "";
  let blockerBrief = "";
  if (lead.names && lead.names.key !== s.target.key && enough(s.target.shareOfDecided)) {
    const b = s.brands.find((x) => x.key === lead.names!.key);
    const share = b ? b.shareOfDecided : inp.F?.fact("share_of_picks", lead.names.key, inp.F.wtb);
    if (share && gBelow(share, OF.blockerShare)) {
      blocker = ` It names ${lead.names.name}, a brand with ${pct(share)} of the picks, so it blocks ${yo()} without winning for it.`;
      blockerBrief = ` That wording names ${lead.names.name}, a brand with ${pct(share)} of the picks when buyers ask what to buy, so it blocks ${yo()} without winning for it.`;
      blockerFoot = ` ${lead.names.name}: ${counts(share)} of the picks.`;
    }
  }
  // The largest fixed situation among the card's rows (the lead itself, or a later row with enough answers).
  const w = rows.find((x) => x.wall && gK(x.share, OF.awaySpecificMin));
  const fixed =
    w === lead
      ? " That is a situation the buyer is already in, not an argument to answer."
      : w
        ? ` The largest fixed situation, "${qc(shorten(w.label, 60))}", comes up in ${pct(w.share)} of those answers - a situation the buyer is already in, not an argument to answer.`
        : "";
  const put = !sameWords(lead.wording, lead.label) ? `, most often put as "${qc(shorten(lead.wording))}"` : "";
  return {
    key: "away_condition",
    kind: "condition",
    title: lead.wall ? `A fixed situation sends buyers away: "${qc(shorten(lead.label, 60))}"` : `What sends buyers away most: "${qc(shorten(lead.label, 60))}"`,
    body: STYLE?.awayRow
      ? awayBrief([lead.label], lead.label, dest ? dest.names : [], dest ? destPhrase(dest) : "", `${w === lead ? " That is a situation the buyer is already in, not an argument to answer." : ""}${blockerBrief}${w && w !== lead ? ` The largest fixed situation, "${qc(shorten(w.label, 60))}", is a situation the buyer is already in, not an argument to answer.` : ""}`)
      : `When buyers ask what to buy, the condition that most often sends them away from ${yo()} is "${qc(shorten(lead.label))}"${dest ? `, and the AI sends them ${destPhrase(dest)}` : ""}: it comes up in ${pct(lead.share)} of those answers${put}.${fixed}${blocker}`,
    foot: `${counts(lead.share)} of the What to buy answers state "${lead.label}"${to ? `; ${to.n} of them send buyers to ${to.name}` : ""}.${blockerFoot}${w && w !== lead ? ` "${w.label}": ${counts(w.share)}.` : ""}`,
    look: { pill: "why", label: "Why - decision rules" },
    effect: rate(lead.share),
    viz: vizOf(rows.slice(0, 3).map((x, i) => W("rival", insightBar(lbl(x.label, 40), x.share, undefined, i === 0)))),
    names: { variant: lead.wall ? "fixed" : "argument", condition: shorten(lead.label, 60), ...(dest ? { rival: listNames(dest.names) } : {}) },
  };
}

const sameWords = (x: string, y: string) => x.replace(/\s+/g, " ").trim().toLowerCase() === y.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * bs20 (2026-11-13, one counting rule): with reason themes the headline
 * counts the top away THEME at answer grain (its distinct answers over the
 * distinct answers stating any listed away condition - question grain
 * saturates, every assistant answers each question). A named specific
 * situation is still detected on one wording: the blocker (the top raw group
 * names a brand that almost never wins the open choice) and the fixed
 * situation (the first raw group among the top ones that clears the floor and
 * is possession-shaped) each get their own sentence with their own share,
 * whether or not the wording sits in the lead theme - a broad theme never
 * swallows them.
 */
type AwayGroup = NonNullable<InsightInputs["away"]>["groups"][number];

/**
 * bs21: the named specific situations the themed away_condition finding
 * states beside its lead theme, detected on ONE raw wording each - shared
 * with the brief's condition card (answer_cards.ts), so the card states the
 * finding's numbers. `blocker`: the top raw away group clears the floor and
 * names a brand that almost never wins the open choice (`share` = that
 * brand's share of picks). `fixed`: the first possession-shaped raw group
 * among the top ones that clears the floor (not the blocker). A default
 * ("otherwise") wording is never either - it sits outside the answer base
 * the shares are read over. Themed path only: the keyless finding keeps its
 * own question-grain logic.
 */
/**
 * bs22: where a themed condition sends buyers. One destination is named alone
 * only when it takes at least half of the condition's answers; otherwise the
 * top two are named and the sentence says "mostly" (a pooled condition whose
 * leading destination holds a third of its answers is not "sent to" it).
 */
export function destOf(routes: { name: string; n: number }[], answers: number): { names: string[]; mostly: boolean } | null {
  const a = routes[0];
  if (!a) return null;
  if (answers <= 0 || a.n / answers >= 0.5) return { names: [a.name], mostly: false };
  return { names: routes[1] ? [a.name, routes[1].name] : [a.name], mostly: true };
}
/** "X" / "mostly to X and Y" after a leading "to ". */
export const destPhrase = (d: { names: string[]; mostly: boolean }) => `${d.mostly ? "mostly " : ""}to ${d.names.join(" and ")}`;

export function awaySpecifics(
  s: Pick<Summary, "firmPickInCategory" | "brands" | "target">,
  a: NonNullable<InsightInputs["away"]>
): { blocker: { group: AwayGroup; share: RateCell } | null; fixed: AwayGroup | null } {
  const g = a.groups[0];
  let blocker: { group: AwayGroup; share: RateCell } | null = null;
  if (g && !isDefaultCondition(g.label) && g.rules >= AWAY_MIN_RULES && g.names && s.firmPickInCategory.k >= MIN_BASE && g.names.key !== s.target.key) {
    const b = s.brands.find((x) => x.key === g.names!.key);
    const share = b ? b.shareOfDecided : cell(0, s.firmPickInCategory.k);
    if (rate(share) < BLOCKER_SHARE) blocker = { group: g, share };
  }
  const fixed = a.groups.find((x) => x.wall && !isDefaultCondition(x.label) && x.rules >= AWAY_MIN_RULES && x !== blocker?.group) ?? null;
  return { blocker, fixed };
}

/* --------------------- bs19: lost, with an exception --------------------- */

/** bf35: the exception in the Brief's style - for the matchup it is most common in, with that head-to-head card's
 * own share ("who it still sends to you"), or no share when the card does not show it. */
function excBrief(brand: string, rival: string | null, labels: string[], label: string, fixed: string): string {
  const v = rival ? STYLE!.exceptionRow!(labels, rival) : null;
  return rival
    ? `When the AI picks ${rival} over ${brand} in a direct matchup, it still says to choose ${brand} for buyers who say "${qc(shorten(label))}"${v ? ` - in ${v} of the answers that pick ${rival}` : ""}.${fixed}`
    : `When the AI picks a rival over ${brand} in a direct matchup, its most common exception is "${qc(shorten(label))}".${fixed}`;
}

/**
* Ruling 10 (2026-11-17): lost, with an exception - read on ONE lost matchup's card: its "Who it still sends to you"
 * rows (the exception step), each a share of the answers that pick the rival in that matchup - the card's own fact id.
 * It names the matchup the hardest-matchup finding names (hardestOf); if that matchup has no qualifying exception row,
 * the lost matchup with the most answers that pick the rival that has one.
 */
function assignedException(s: Summary, inp: InsightInputs): Insight | null {
  const cards = inp.exception?.cards ?? [];
  type C = { card: (typeof cards)[number]; row: CardCondRow };
  const cands: C[] = [];
  for (const card of cards) {
    if (!enough(card.lost)) continue;
    const row = card.rows[0];
    if (!row) continue;
    // row.share is already of the answers that pick the rival (the card's exception rows).
    if (!gK(row.share, OF.excMinAnswers) || !gAtLeast(row.share, OF.excMinShare)) continue;
    cands.push({ card, row });
  }
  // The matchup the hardest-matchup finding names; if it has no qualifying exception row, the lost matchup with the
  // most answers that pick the rival that does.
  const hard = hardestOf(s.headToHead.filter((r) => enough(r.winOfDecided)));
  const best = cands.find((c) => hard && c.card.key === hard.key) ?? [...cands].sort((a, b) => b.card.lost.k - a.card.lost.k || a.card.name.localeCompare(b.card.name))[0];
  if (!best) return null;
  const { card, row } = best;
  const fixed = row.wall ? " That is a situation the buyer is already in, not something to argue for." : "";
  const put = !sameWords(row.wording, row.label) ? ` It is most often put as "${qc(shorten(row.wording))}".` : "";
  const openC = inp.F?.fact("slice_share", "ai/slice:cond:toward", { ...inp.F.wtb, when: "pick:other" });
  const open = openC && enough(openC) ? ` When buyers ask what to buy and the AI picks someone else, it still gives a case for ${s.brand} in ${pct(openC)} of those answers.` : "";
  return {
    key: "assigned_exception",
    kind: "condition",
    title: yt(`You lose to ${card.name} with one exception`, (n) => `${n} loses to ${card.name} directly, yet the AI still says when to choose it`),
    body: STYLE?.exceptionRow
      ? excBrief(s.brand, card.name, [row.label, row.wording], row.label, fixed)
      : `When the AI picks ${card.name} over ${s.brand} in a direct matchup, it still says to choose ${s.brand} for buyers who say "${qc(shorten(row.label))}" - in ${pct(row.share)} of the answers that pick ${card.name}.${put}${fixed}${STYLE ? "" : open}`,
    foot: `${counts(row.share)} answers that pick ${card.name} state "${row.label}"; ${card.any.k} of them state any case for you.${openC && enough(openC) ? ` When buyers ask what to buy: ${counts(openC)}.` : ""}`,
    look: { pill: "why", label: "Why - decision rules" },
    effect: rate(row.share),
    // Each bar is a case the AI still gives for you - your side; shares of the answers that pick the rival.
    viz: vizOf(card.rows.slice(0, 3).map((x, i) => W("you", insightBar(lbl(x.label, 40), x.share, undefined, i === 0)))),
    names: { rival: card.name, ...(STYLE ? { condition: qc(shorten(row.label)) } : {}) },
  };
}

/* -------------------------------- bs7: engines ----------------------------- */

/** Open-choice answers and in-category firm picks per mode. */
/** One mode's commit rate and your share of its picks - the mode's own facts (summary.byMode). */
function modeFirm(s: Summary, mode: "search" | "instinct") {
  const m = s.byMode.find((x) => x.key === mode);
  return { engines: m?.engines ?? 0, firm: (m?.firm ?? cell(0, 0)) as RateCell, decided: (m?.decided ?? cell(0, 0)) as RateCell };
}

function engineDecisiveness(s: Summary): Insight | null {
  const se = modeFirm(s, "search");
  const ins = modeFirm(s, "instinct");
  if (!enough(se.firm) || !enough(ins.firm)) return null;
  const [hi, lo] = rate(se.firm) >= rate(ins.firm) ? [se, ins] : [ins, se];
  if (!apart(hi.firm, lo.firm)) return null;
  const hiName = hi === se ? "with web search" : "without web search";
  const loName = hi === se ? "without web search" : "with web search";
  const shareOk = se.decided.n >= MIN_BASE && ins.decided.n >= MIN_BASE;
  const shareApart = shareOk && (apart(se.decided, ins.decided) || apart(ins.decided, se.decided));
  const tail = !shareOk
    ? "."
    : shareApart
      ? `, and ${yr()} share of those picks is ${pct(se.decided)} with web search and ${pct(ins.decided)} without.`
      : ` - ${yr()} share of those picks does not separate (${pct(se.decided)} with web search vs ${pct(ins.decided)} without), so the gap is how often the AI commits, not who it prefers.`;
  return {
    key: "engine_decisiveness",
    kind: "engine",
    title: `${hiName.charAt(0).toUpperCase()}${hiName.slice(1)}, the AI commits to a pick more often`,
    body: `When buyers ask what to buy, the AI commits to one brand in ${STYLE ? "the" : "your"} category in ${pct(hi.firm)} of answers ${hiName} and ${pct(lo.firm)} ${loName}${tail}`,
    foot: `Search (${se.engines} engines): firm pick ${counts(se.firm)}, yours ${counts(se.decided)}. Instinct (${ins.engines} engines): firm pick ${counts(ins.firm)}, yours ${counts(ins.decided)}.`,
    look: { pill: "table", label: "Metrics - by mode" },
    effect: rate(hi.firm) - rate(lo.firm),
    viz: vizOf([
      // How often the AI commits at all - any brand's pick, nobody's number.
      W("other", insightBar(hiName.charAt(0).toUpperCase() + hiName.slice(1), hi.firm)),
      W("other", insightBar(loName.charAt(0).toUpperCase() + loName.slice(1), lo.firm)),
    ]),
    names: { mode: hiName },
  };
}

/** The open-choice gap by mode that a head-to-head flip must run against. */
const FLIP_MIN_OPEN = OF.flipMinOpen;

function engineHeadToHeadFlip(s: Summary): Insight | null {
  const se = s.byMode.find((m) => m.key === "search");
  const ins = s.byMode.find((m) => m.key === "instinct");
  if (!se || !ins) return null;
  if (se.h2h.n < MIN_BASE || ins.h2h.n < MIN_BASE || se.decided.n < MIN_BASE || ins.decided.n < MIN_BASE) return null;
  const h2hGap = rate(se.h2h) - rate(ins.h2h);
  const openGap = rate(se.decided) - rate(ins.decided);
  if (!(h2hGap > 0 ? apart(se.h2h, ins.h2h) : apart(ins.h2h, se.h2h))) return null;
  if (Math.sign(h2hGap) === Math.sign(openGap) || Math.abs(openGap) < FLIP_MIN_OPEN) return null;
  const h2hHi = h2hGap > 0 ? "search" : "instinct";
  return {
    key: "engine_h2h_flip",
    kind: "engine",
    title: `${h2hHi === "search" ? "With" : "Without"} web search the AI backs ${yo()} in direct matchups, not when buyers ask what to buy`,
    body: `Asked to compare ${yo()} with a rival directly, the AI picks ${yo()} in ${pct(se.h2h)} of matchups with web search and ${pct(ins.h2h)} without, while ${yr()} share of picks when buyers ask what to buy is ${pct(se.decided)} with web search and ${pct(ins.decided)} without - the two run in opposite order.`,
    foot: `Head-to-heads: search ${counts(se.h2h)}, instinct ${counts(ins.h2h)}. Open choice: search ${counts(se.decided)}, instinct ${counts(ins.decided)}.`,
    look: { pill: "table", label: "Metrics - by mode" },
    effect: Math.abs(h2hGap),
    viz: vizOf([
      W("you", insightBar("Matchups, with web search", se.h2h)),
      W("you", insightBar("Matchups, without web search", ins.h2h)),
      W("you", insightBar("Picks, with web search", se.decided)),
      W("you", insightBar("Picks, without web search", ins.decided)),
    ]),
  };
}

/** The analysis map's watch threshold (WATCH_ENGINE_SHARE), at summary level. */
const ENGINE_CONC_SHARE = OF.engineConcShare;
const ENGINE_CONC_MIN_ENGINES = OF.engineConcMinEngines;

/**
 * The one "one assistant / one AI company supplies the picks" test (the Overview finding's, and the Map's watch caveat
 * on top of its own floors): the unit supplies at least OF.engineConcShare of the picks AND the 95% range of that share
 * clears the unit's own share of the answers (`base`, 0-1).
 */
export function clearsConcentration(picks: RateCell, base: number): boolean {
  return rate(picks) >= ENGINE_CONC_SHARE && picks.low > base;
}

/**
 * One engine - or one vendor's assistants pooled - supplies >= 40% of a
 * brand's open-choice picks (the target or a tracked rival, >= MIN_BASE
 * picks). The baseline is the unit's own share of the open-choice answers
 * (a vendor with four engines asks a third of the questions), so the
 * finding needs the picks' 95% range to clear it; the effect is the share
 * above that baseline.
 */
function enginePickConcentration(s: Summary, inp: InsightInputs): Insight | null {
  if (s.byEngine.length < ENGINE_CONC_MIN_ENGINES || s.answers === 0) return null;
  const names = new Map(s.brands.filter((b) => b.role !== "emerged").map((b) => [b.key, b.name]));
  type Unit = { label: string; models: string[]; answers: number; vendor: boolean };
  const units: Unit[] = s.byEngine.map((e) => ({ label: e.label, models: [e.key], answers: e.answers, vendor: false }));
  const vendors = new Map<string, Unit>();
  for (const e of s.byEngine) {
    const u = vendors.get(e.vendor) ?? { label: e.vendor, models: [], answers: 0, vendor: true };
    u.models.push(e.key);
    u.answers += e.answers;
    vendors.set(e.vendor, u);
  }
  // A one-engine vendor is the engine row already; vendors need two or more
  // vendors on the panel to be a split at all.
  if (vendors.size >= 2) for (const u of vendors.values()) if (u.models.length >= 2) units.push(u);
  type C = { key: string; name: string; isTarget: boolean; unit: Unit; picks: RateCell; base: number; baseC: RateCell };
  const cands: C[] = [];
  for (const b of inp.enginePicks) {
    if (b.total < MIN_BASE || !names.has(b.key) || !inp.F) continue;
    for (const u of units) {
      // Of the brand's picks, the share these assistants supply; of the questions, the share they answer - two facts.
      const picks = inp.F.fact("slice_share", `ai/slice:eng:${u.models.join(",")}`, { ...inp.F.wtb, when: `pick:${b.key === s.target.key ? "you" : b.key}` });
      const baseC = inp.F.fact("slice_share", `ai/slice:eng:${u.models.join(",")}`, inp.F.wtb);
      const base = rate(baseC);
      if (clearsConcentration(picks, base)) {
        gAtLeast(picks, ENGINE_CONC_SHARE);
        gLowAbove(picks, base);
        cands.push({ key: b.key, name: names.get(b.key)!, isTarget: b.key === s.target.key, unit: u, picks, base, baseC });
      }
    }
  }
  if (cands.length === 0) return null;
  const best = cands.sort(
    (a, b) => rate(b.picks) - b.base - (rate(a.picks) - a.base) || b.picks.n - a.picks.n || a.name.localeCompare(b.name)
  )[0];
  const whose = best.isTarget ? yr() : poss(best.name);
  const unit = best.unit.vendor ? `${best.unit.label}'s ${best.unit.models.length} assistants` : best.unit.label;
  return {
    key: "engine_pick_concentration",
    kind: "engine",
    title: `${best.unit.label} carries ${whose} picks`,
    body: `${unit} supply ${pct(best.picks)} of ${whose} picks while answering ${pct(best.baseC)} of the questions - a read without ${best.unit.vendor ? "them" : "it"} would put ${best.isTarget ? yo() : best.name} far lower.`,
    foot: `${best.picks.k} of ${best.picks.n} open-choice picks of ${best.name} (95% range ${Math.round(best.picks.low * 100)}-${Math.round(best.picks.high * 100)}%) from ${unit}, which answer ${best.unit.answers} of ${s.answers} open-choice questions.`,
    look: { pill: "table", label: best.unit.vendor ? "Metrics - by vendor" : "Metrics - by engine" },
    effect: rate(best.picks) - best.base,
    viz: vizOf([
      W(best.isTarget ? "you" : "rival", insightBar(`Picks from ${best.unit.label}`, best.picks, undefined, true)),
      W("other", insightBar("Questions it answers", best.baseC)),
    ]),
    names: best.isTarget ? { variant: "you", vendor: best.unit.label } : { variant: "rival", vendor: best.unit.label, rival: best.name },
  };
}

/* ------------------------- bs18: one AI company apart ------------------------ */

/** A company needs a gap this large against the others pooled. Calibrated on
 * the five fixture trackers (2026-11-12): ranges apart alone admit leans of
 * 4-9 points on rare verdicts (a 5% vs 0.5% steer-clear rate, a 7% vs 0.2%
 * capture rate) where both sides are near zero; ten points keeps those out.
 * On the fixture every tracker's largest gap is 24-55 points, so the guard
 * changes no firing there - it only stops a quiet tracker's lone near-zero
 * lean from becoming the finding. */
const VENDOR_MIN_GAP = OF.vendorMinGap;
/** At least this many companies with MIN_BASE answers on the measure. */
const VENDOR_MIN_COMPANIES = OF.vendorMinCompanies;

/** The measures outside the open choice and the head-to-heads, one per
 * verdict, each read from its view's engine slices pooled by company. */
interface VendorMeasure {
  id: string;
  /** Plain name of the question type (question_names.ts), lower-cased in the title. */
  row: string;
  station: string;
  stationLabel: string;
  /** The sentence: company, its rate, the others' rate. */
  says: (company: string, a: string, b: string) => string;
  /** Short bar wording for the company's bar. */
  bar: string;
  /** The measure and the scope it is counted on; a company's number is the fact on its own engines, the others' the
   * fact on every other company's engines. */
  measure: string;
  subject: string;
  scope: Scope;
}

function vendorMeasures(inp: InsightInputs, brand: string): VendorMeasure[] {
  const out: VendorMeasure[] = [];
  const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
  if (inp.doubt.keepOrLeave) {
    const base = { row: lower(ROW_NAME.customers), station: "customer_base", stationLabel: "Stations - Customers", subject: "ai", scope: { types: ["churn_triggers", "renewal"] } as Scope };
    out.push({ ...base, id: "keep", measure: "stay", says: (c, a, b) => `Asked by ${yr()} customers whether to stay, ${c} says stay in ${a} of answers; the other AI assistants together, ${b}.`, bar: "say stay" });
    out.push({ ...base, id: "leave", measure: "leave", says: (c, a, b) => `Asked by ${yr()} customers whether to stay, ${c} says leave in ${a} of answers; the other AI assistants together, ${b}.`, bar: "say leave" });
  }
  if (inp.doubt.objections) {
    const base = { row: lower(ROW_NAME.buyers), station: "doubts", stationLabel: "Stations - Doubts", subject: "ai", scope: { types: ["objections"] } as Scope };
    out.push({ ...base, id: "proceed", measure: "go_ahead", says: (c, a, b) => `When a buyer voices a worry about ${brand}, ${c} says go ahead in ${a} of answers; the other AI assistants together, ${b}.`, bar: "say go ahead" });
    out.push({ ...base, id: "avoid", measure: "steer_clear", says: (c, a, b) => `When a buyer voices a worry about ${brand}, ${c} says steer clear in ${a} of answers; the other AI assistants together, ${b}.`, bar: "say steer clear" });
  }
  if (inp.value) {
    const base = { row: lower(ROW_NAME.value), station: "value", stationLabel: "Stations - Value", subject: "ai", scope: { types: ["pricing"] } as Scope };
    out.push({ ...base, id: "worth_yes", measure: "worth_yes", says: (c, a, b) => `Asked whether ${brand} is worth paying more for, ${c} says yes in ${a} of answers; the other AI assistants together, ${b}.`, bar: "say worth it" });
    out.push({ ...base, id: "worth_no", measure: "worth_no", says: (c, a, b) => `Asked whether ${brand} is worth paying more for, ${c} says no in ${a} of answers; the other AI assistants together, ${b}.`, bar: "say not worth it" });
  }
  if (inp.alternatives.offensive)
    out.push({ id: "captured", row: lower(ROW_NAME.leavers), station: "comparison", stationLabel: "Stations - Comparison", measure: "picked", subject: "you", scope: { types: ["switching"] }, says: (c, a, b) => `When a rival's customer asks what to switch to, ${c} picks ${yo()} in ${a} of answers; the other AI assistants together, ${b}.`, bar: "pick you" });
  if (inp.alternatives.defensive)
    out.push({ id: "hold_stay", row: lower(ROW_NAME.hold), station: "customer_base", stationLabel: "Stations - Customers", measure: "stay", subject: "ai", scope: { types: ["looking_around"], situation: null }, says: (c, a, b) => `When ${yr()} own customers ask what else to consider, ${c} tells them to stay in ${a} of answers; the other AI assistants together, ${b}.`, bar: "say stay" });
  return out;
}

/** Every (measure, company) pair whose rate sits apart from the other
 * companies pooled - exported for the calibration dump; the detector serves
 * the one whose ranges sit furthest apart, at or above VENDOR_MIN_GAP. Each
 * side is its own fact (the company's engines; every other company's engines). */
export function vendorOutlierCandidates(inp: InsightInputs, brand: string) {
  const out: { measure: VendorMeasure; vendor: string; models: string[]; own: RateCell; rest: RateCell; gap: number; clear: number }[] = [];
  if (!inp.F) return out;
  const byVendor = new Map<string, string[]>();
  for (const m of inp.F.engines) {
    const v = facetsOf(m).vendor;
    byVendor.set(v, [...(byVendor.get(v) ?? []), m]);
  }
  for (const m of vendorMeasures(inp, brand)) {
    const per = [...byVendor.entries()].map(([vendor, models]) => ({ vendor, models, own: inp.F!.fact(m.measure, m.subject, { ...m.scope, engines: models }) }));
    if (per.filter((x) => x.own.n >= MIN_BASE).length < VENDOR_MIN_COMPANIES) continue;
    for (const x of per) {
      const others = [...byVendor.entries()].filter(([v]) => v !== x.vendor).flatMap(([, ms]) => ms);
      if (!others.length) continue;
      const own = x.own;
      const rest = inp.F.fact(m.measure, m.subject, { ...m.scope, engines: others });
      if (own.n < MIN_BASE || rest.n < MIN_BASE) continue;
      if (!(own.low > rest.high) && !(rest.low > own.high)) continue;
      const gap = rate(own) - rate(rest);
      // How far the two 95% ranges sit from each other - the ranking, so a
      // thin pool with a wide range never outranks a well-measured company.
      const clear = gap > 0 ? own.low - rest.high : rest.low - own.high;
      out.push({ measure: m, vendor: x.vendor, models: x.models, own, rest, gap, clear });
    }
  }
  return out.sort((a, b) => b.clear - a.clear || a.measure.id.localeCompare(b.measure.id) || a.vendor.localeCompare(b.vendor));
}

/**
 * One AI company answers a non-open-choice question differently from the
 * rest: its pooled rate (its engines' answers together) against every other
 * company pooled, ranges apart, at least VENDOR_MIN_GAP, with at least three
 * companies on the measure. One insight per tracker - the pair whose two
 * ranges sit furthest apart (not the largest raw gap: a 20-answer pool at 0%
 * would outrank a 240-answer one), so a verdict and its complement
 * (stay / leave, yes / no) never both fire. Effect = the gap.
 */
function vendorOutlier(inp: InsightInputs, brand: string): Insight | null {
  const best = vendorOutlierCandidates(inp, brand).find((c) => Math.abs(c.gap) >= VENDOR_MIN_GAP);
  if (!best) return null;
  enough(best.own);
  enough(best.rest);
  if (best.gap > 0) apart(best.own, best.rest);
  else apart(best.rest, best.own);
  gGap(best.own, best.rest, VENDOR_MIN_GAP);
  const m = best.measure;
  const engines = best.models.length;
  return {
    key: "vendor_outlier",
    kind: "engine",
    title: `${best.vendor} is the outlier on ${m.row}`,
    body: m.says(best.vendor, pct(best.own), pct(best.rest)),
    foot: `${best.vendor} (${engines} ${engines === 1 ? "engine" : "engines"}): ${counts(best.own)}. The other AI assistants together: ${counts(best.rest)}.`,
    look: { pill: "stations", station: m.station, label: m.stationLabel },
    effect: Math.abs(best.gap),
    viz: vizOf([
      W("you", insightBar(`${best.vendor} - ${m.bar}`, best.own, undefined, true)),
      W("other", insightBar(`The others - ${m.bar}`, best.rest)),
    ]),
    names: { vendor: best.vendor, question: m.row },
  };
}

/* ---------------------- bs8: neutralized differentiator --------------------- */

/** An argument carried by this share of your head-to-head wins is one you win on. */
const ND_WIN_SHARE = OF.ndWinShare;

/**
 * An argument in >= 40% of the target's prompted head-to-head wins (all
 * entity rivals pooled) whose share of the losses is not significantly
 * below its share of the wins: the rival is credited with it too. Both the
 * win and loss buckets, and the code's count in each, clear MIN_BASE. The
 * strongest shape is losses apart ABOVE wins; among candidates of the same
 * shape the highest loss share is reported. Effect = loss share - win share,
 * so a parity argument ranks near zero and one the rival owns ranks high
 * (a code argued less in losses than in wins never fires).
 */
function neutralizedDifferentiator(inp: InsightInputs): Insight | null {
  const a = inp.h2hArgs;
  if (!a.winsCell || !a.lossesCell || !enough(a.winsCell, MIN_BASE) || a.wins < MIN_BASE || a.losses < MIN_BASE) return null;
  const cands = a.codes
    .filter((c) => c.wins >= MIN_BASE && c.losses >= MIN_BASE && c.w && c.l)
    .map((c) => ({ ...c, w: c.w!, l: c.l! }))
    .filter((c) => rate(c.w) >= ND_WIN_SHARE && !apart(c.w, c.l) && rate(c.l) > rate(c.w))
    .map((c) => ({ ...c, above: apart(c.l, c.w) }))
    .sort((x, y) => Number(y.above) - Number(x.above) || rate(y.l) - rate(x.l) || x.code.localeCompare(y.code));
  const best = cands[0];
  if (!best) return null;
  const [rivalKey, rivalLosses] = Object.entries(best.lossesBy).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0] ?? [null, 0];
  const rival = rivalKey ? a.rivals[rivalKey] ?? null : null;
  const rivalText = rival ? `, most often to ${rival}` : "";
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  // bf34: no card sets an argument's share of the matchups won against those lost, so the Brief cites none.
  const uncited = !!STYLE?.cardArg;
  return {
    key: "neutralized_differentiator",
    kind: "argument",
    title: best.above ? `${Yr()} rivals are credited with ${best.code}` : `${cap(best.code)} no longer sets ${yo()} apart`,
    body: uncited
      ? ""
      : STYLE
      ? best.above
        ? `${cap(best.code)} is argued in ${pct(best.w)} of the direct matchups ${STYLE.name} wins but ${pct(best.l)} of those it loses${rivalText} - the AI credits its rivals with it more than ${STYLE.name}.`
        : `${cap(best.code)} is argued in ${pct(best.w)} of the direct matchups ${STYLE.name} wins and ${pct(best.l)} of those it loses${rivalText} - it comes up in its rivals' wins as often as in its own.`
      : best.above
        ? `${cap(best.code)} is argued in ${pct(best.w)} of the direct matchups you win but ${pct(best.l)} of those you lose${rivalText} - the AI credits your rivals with it more than you.`
        : `${cap(best.code)} is argued in ${pct(best.w)} of the direct matchups you win and ${pct(best.l)} of those you lose${rivalText} - it comes up in your rivals' wins as often as in yours.`,
    foot: `In wins: ${counts(best.w)}. In losses: ${counts(best.l)}${rival ? `; ${rivalLosses} of those losses to ${rival}` : ""}. Prompted head-to-heads against every named rival, pooled; arguments in under ${Math.round(ND_WIN_SHARE * 100)}% of wins left out.`,
    look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
    effect: rate(best.l) - rate(best.w),
    viz: vizOf([
      W("you", insightBar("In matchups you win", best.w)),
      W("rival", insightBar("In matchups you lose", best.l, undefined, true)),
    ]),
    names: { topic: best.code, ...(rival ? { rival } : {}) },
  };
}

/* ------------------- bs24: one argument, two directions ------------------- */

/** The pick contests an argument is read in: both sides are a product
 * picked, so "comes up when you are picked" means the same thing in each.
 * Yes/no question types (Value, worries) are left out on purpose: there an
 * argument's share by verdict follows which worry or product line the
 * answers are about, not who the argument favours. */
type ArgContest = "headline" | "head_to_head_entity" | "offensive_capture";
const ARG_CONTEST: Record<ArgContest, { when: string; row: string }> = {
  headline: { when: "when buyers ask what to buy", row: ROW_NAME.open },
  head_to_head_entity: { when: "in direct matchups", row: ROW_NAME.h2h },
  offensive_capture: { when: "when rivals' customers ask where to switch", row: ROW_NAME.leavers },
};

/**
 * An argument that comes up more when you are picked in one pick contest and
 * more when a rival is picked in another. Each side needs MIN_BASE answers
 * in both contests and non-overlapping ranges in both. Effect = the smaller
 * of the two gaps (both directions must be real for the finding to be one).
 */
function argumentFlip(inp: InsightInputs): Insight | null {
  type Side = { type: ArgContest; you: RateCell; other: RateCell; gap: number };
  let best: { code: string; help: Side; hurt: Side; effect: number } | null = null;
  for (const c of inp.argSides) {
    const sides: Side[] = c.types
      .filter((t) => t.you.n >= MIN_BASE && t.other.n >= MIN_BASE && (apart(t.you, t.other) || apart(t.other, t.you)))
      .map((t) => ({ ...t, gap: rate(t.you) - rate(t.other) }));
    const help = sides.filter((x) => x.gap > 0).sort((a, b) => b.gap - a.gap || a.type.localeCompare(b.type))[0];
    const hurt = sides.filter((x) => x.gap < 0).sort((a, b) => a.gap - b.gap || a.type.localeCompare(b.type))[0];
    if (!help || !hurt) continue;
    const effect = Math.min(help.gap, -hurt.gap);
    if (!best || effect > best.effect || (effect === best.effect && c.code.localeCompare(best.code) < 0)) best = { code: c.code, help, hurt, effect };
  }
  if (!best) return null;
  const { code, help, hurt } = best;
  const cap = code.charAt(0).toUpperCase() + code.slice(1);
  const up = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const H = ARG_CONTEST[help.type];
  const U = ARG_CONTEST[hurt.type];
  return {
    key: "argument_flip",
    kind: "argument",
    title: `${cap} works for ${yo()} in one place and against ${STYLE ? "it" : "you"} in another`,
    body: `${up(H.when)}, ${code} comes up more in answers that pick ${yo()} (${pct(help.you)}) than in answers that pick a rival (${pct(help.other)}). ${up(U.when)} it is the other way round: ${pct(hurt.you)} of answers that pick ${yo()}, ${pct(hurt.other)} of answers that pick a rival.`,
    foot: `${H.row}: ${counts(help.you)} picking you vs ${counts(help.other)} picking a rival. ${U.row}: ${counts(hurt.you)} vs ${counts(hurt.other)}. Only questions where the AI picks a product are compared.`,
    look: { pill: "stations", station: hurt.type === "headline" ? "consideration" : "comparison", label: `Stations - ${U.row}` },
    effect: best.effect,
    viz: vizOf([
      W("you", insightBar(`${H.row}: you picked`, help.you)),
      W("rival", insightBar(`${H.row}: rival picked`, help.other)),
      W("you", insightBar(`${U.row}: you picked`, hurt.you)),
      W("rival", insightBar(`${U.row}: rival picked`, hurt.other, undefined, true)),
    ]),
    names: { topic: code, question: U.when },
  };
}

/* ------------------------- bs8: conversion vs rival ------------------------- */

/**
 * Recommendations turned into picks (chosen over recommended - the pick
 * always counts as recommended), the target against the rival with the
 * largest share of decided; both need MIN_BASE recommendations and the two
 * ranges must not overlap, either direction. Effect = the gap.
 */
function conversionVsRival(s: Summary): Insight | null {
  const rival = s.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
  if (!rival) return null;
  // Recommendations that end as the pick: each brand's own fact (a pick counts as recommended, ruling 6).
  const you = s.target.converts;
  const them = rival.converts;
  if (!you || !them || !enough(you) || !enough(them)) return null;
  const rivalAhead = rate(them) > rate(you);
  if (!(rivalAhead ? apart(them, you) : apart(you, them))) return null;
  return {
    key: "conversion_vs_rival",
    kind: "rival",
    title: rivalAhead ? `${rival.name} turns its recommendations into picks, ${yo()} less so` : yt(`You turn recommendations into picks better than ${rival.name}`, (n) => `${n} turns recommendations into picks better than ${rival.name}`),
    body: rivalAhead
      ? `The AI recommends ${yo()} but picks ${rival.name} - ${rival.name} is the pick in ${pct(them)} of the answers that recommend it, ${yo()} in ${pct(you)} of those that recommend ${STYLE ? "it" : "you"}.`
      : `When the AI recommends ${yo()}, ${yt("you are", (n) => `${n} is`)} the pick in ${pct(you)} of those answers; ${rival.name} in ${pct(them)} of the answers that recommend it.`,
    foot: `${rival.name}: picked in ${counts(them)} recommending answers. You: ${counts(you)}. ${rival.name} has the largest share of decided open-choice picks among your rivals.`,
    look: { pill: "rivals", label: "Rivals" },
    effect: Math.abs(rate(them) - rate(you)),
    viz: vizOf([W("you", insightBar(s.brand, you, undefined, true)), W("rival", insightBar(rival.name, them))]),
    names: { variant: rivalAhead ? "behind" : "ahead", rival: rival.name },
  };
}

/* ---------------------- bs23: a rival never asked about ---------------------- */

/**
 * A rival that takes picks when buyers ask what to buy, with no direct
 * matchup asked against it (matchup_gap.ts - the same rule as the rival
 * dossier's amber callout). The largest share of picks wins when several
 * qualify. Effect = its share of picks.
 */
function unaskedRival(s: Summary, inp: InsightInputs): Insight | null {
  if (!inp.asked) return null;
  const asked = new Set(inp.asked);
  const rival = s.brands
    .filter((b) => b.role !== "target" && b.key !== s.target.key && !asked.has(b.key) && clearsMatchupGap(b.shareOfDecided))
    .sort((a, b) => rate(b.shareOfDecided) - rate(a.shareOfDecided) || b.chosen.k - a.chosen.k || a.name.localeCompare(b.name))[0];
  if (!rival) return null;
  return {
    key: "unasked_rival",
    kind: "rival",
    title: STYLE
      ? `${rival.name} takes ${pct(rival.shareOfDecided)} of the picks, and the AI has never been asked to compare it with ${STYLE.name}`
      : `${rival.name} takes ${pct(rival.shareOfDecided)} of the picks, and you have never been asked about it head to head`,
    body: STYLE
      ? `${rival.name} takes ${pct(rival.shareOfDecided)} of the picks when buyers ask what to buy, but the AI has never been asked to choose between ${STYLE.name} and ${rival.name} directly, so there is no read on how ${STYLE.name} would do against it.`
      : `${rival.name} takes ${pct(rival.shareOfDecided)} of the picks when buyers ask what to buy, but the AI has never been asked to choose between you and ${rival.name} directly, so you cannot see how you would do against it.`,
    foot: `${rival.name}: ${counts(rival.shareOfDecided)} of the picks. You: ${counts(s.target.shareOfDecided)}. No direct matchup against ${rival.name} was asked this wave.`,
    look: { pill: "rivals", label: "Rivals" },
    effect: rate(rival.shareOfDecided),
    viz: vizOf([W("rival", insightBar(rival.name, rival.shareOfDecided, undefined, true)), W("you", insightBar(s.brand, s.target.shareOfDecided))]),
    names: { rival: rival.name },
    matchup: { key: rival.key, name: rival.name },
  };
}

/* ------------------------------- bs8: leaks -------------------------------- */

/** The analysis map's leak badge threshold (LEAK_SHARE), at summary level. */
const LEAK_PICKS_SHARE = OF.leakPicksShare;
/** Problem questions routed outside the category in at least this share. */
const LEAK_PROBLEM_SHARE = OF.leakProblemShare;

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Firm open-choice picks that leave the category (B5). Effect = the share. */
function leakPicks(inp: InsightInputs): Insight | null {
  // Ruling 8: of every pick, the share outside the category (a pick outside of analysis is its own bucket).
  const l = inp.leak;
  const outside = l.outsideCell;
  if (!outside || !enough(outside) || !gAtLeast(outside, LEAK_PICKS_SHARE)) return null;
  const top = l.names.slice(0, 3);
  const room = [...l.rooms]
    .filter((r) => r.firm >= MIN_BASE && r.outside > 0)
    .sort((a, b) => b.outside / b.firm - a.outside / a.firm || a.room.localeCompare(b.room))[0];
  const roomCell = room ? l.roomCells?.[room.room] ?? null : null;
  const roomText = room && roomCell && rate(roomCell) > rate(outside) ? `; for ${buyer(room.room)} it is ${pct(roomCell)}` : "";
  return {
    key: "leak_picks",
    kind: "leak",
    title: top.length ? `Picks leave the category - led by ${top[0].name}` : "Picks leave the category",
    body: `${pct(outside)} of the answers that commit to a pick choose something outside ${STYLE ? "the" : "your"} category${top.length ? `, led by ${listNames(top.map((x) => x.name))}` : ""}${roomText}.`,
    foot: `${counts(outside)} firm picks outside the category${top.length ? `: ${top.map((x) => `${x.name} ${x.n}`).join(", ")}` : ""}.${room && roomCell ? ` ${room.room}: ${counts(roomCell)}.` : ""} Outside = ruled out on the dictionary board, pending, or not in it.`,
    look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
    effect: rate(outside),
    viz: vizOf([
      W("other", insightBar("Outside the category", outside, undefined, true)),
      roomText && roomCell
        ? W("other", insightBar(lbl(room!.room), roomCell))
        : W("other", insightBar("Inside the category", inp.F ? inp.F.fact("slice_share", "ai/slice:!pick:outside_category", { ...inp.F.wtb, when: "!pick:none" }) : 1 - rate(outside))),
    ]),
    names: roomText && room ? { buyer: room.room } : {},
  };
}

/**
 * The buyer room whose problem questions the AI routes outside the category
 * most (>= 50%, MIN_BASE answers). When that room's range does not clear
 * the other rooms pooled, the finding is category-wide and is said so (the
 * run-level rate must then clear 50% too). Effect = the share above half.
 */
function leakProblem(inp: InsightInputs): Insight | null {
  const p = inp.problem;
  if (!p) return null;
  const top = p.rooms.filter((r) => enough(r.out)).sort((a, b) => rate(b.out) - rate(a.out) || a.room.localeCompare(b.room))[0];
  if (!top || !gAtLeast(top.out, LEAK_PROBLEM_SHARE) || !inp.F) return null;
  // The other buying situations (questions asked of a buyer), pooled as one fact.
  const rest = inp.F.fact("routed_adjacent", "ai", { types: ["problem_recognition"], when: `!${sitSlice(top.room)}&!sit:~none` });
  const oneRoom = rest.n >= MIN_BASE && apart(top.out, rest);
  if (!oneRoom && !gAtLeast(p.all, LEAK_PROBLEM_SHARE)) return null;
  return {
    key: "leak_problem",
    kind: "leak",
    title: oneRoom ? `${top.room}: the problem is solved outside the category` : "Problem questions are solved outside the category",
    // bf35: the Brief sets the buyer's figure against the all-buyers card's (both on cards); "the other buying
    // situations" pooled is on no card.
    body: STYLE?.outsideShare && oneRoom
      ? (() => {
          const here = STYLE.outsideShare!(top.room);
          const all = STYLE.outsideShare!(null);
          return here
            ? `For ${buyer(top.room)}, the AI points ${here} of the problem questions that do not name the category to a solution outside it${all ? `, against ${all} across all buyers` : ""}.`
            : `For ${buyer(top.room)}, the AI answers ${pct(top.out)} of the problem questions that do not name the category with a solution outside it.`;
        })()
      : oneRoom
      ? `For ${buyer(top.room)}, the AI answers ${pct(top.out)} of the problem questions that do not name the category with a solution outside it - ${pct(rest)} for the other buying situations.`
      : `Across every buying situation, the AI answers ${pct(p.all)} of the problem questions that do not name the category with a solution outside it (${pct(top.out)} for ${buyer(top.room)}).`,
    foot: `${top.room}: ${counts(top.out)}.${rest.n > 0 ? ` Other rooms: ${counts(rest)}.` : ""} All problem-recognition answers: ${counts(p.all)}.`,
    look: { pill: "stations", station: "awareness", label: "Stations - Awareness" },
    effect: (oneRoom ? rate(top.out) : rate(p.all)) - LEAK_PROBLEM_SHARE,
    viz: oneRoom
      ? vizOf([
          W("other", insightBar(lbl(top.room), top.out, undefined, true)),
          W("other", insightBar("Other buying situations", rest)),
        ])
      : vizOf([
          W("other", insightBar("Every buying situation", p.all, undefined, true)),
          W("other", insightBar(lbl(top.room), top.out)),
        ]),
    names: oneRoom ? { buyer: top.room } : {},
  };
}

/* ------------------------------ bs8: retention ------------------------------ */

/** The customers' worry whose leave rate sits apart above the pooled rest. Effect = the gap. */
function worstWorry(inp: InsightInputs): Insight | null {
  const k = inp.doubt.keepOrLeave;
  if (!k || k.rows.length < 2) return null;
  const ok = k.rows.filter((r) => enough(r.verdicts.leave));
  if (ok.length === 0 || !inp.F) return null;
  const top = [...ok].sort((a, b) => rate(b.verdicts.leave) - rate(a.verdicts.leave) || a.concern.localeCompare(b.concern))[0];
  // Every other customers' worry (another worry, or the same worry at the other stage), pooled as one fact - or,
  // when there is exactly one other, that worry's own card fact (the same answers, the card's scope and id).
  const others = k.rows.filter((r) => r !== top);
  const rest = others.length === 1 ? others[0].verdicts.leave : inp.F.fact("leave", "ai", { types: ["churn_triggers", "renewal"], when: `!${worrySlice(top.concern)}|!stage:${top.stage}` });
  if (!enough(rest) || !apart(top.verdicts.leave, rest)) return null;
  const exit = top.topExits[0];
  const concern = top.concern || "this worry";
  return {
    key: "worst_worry",
    kind: "doubt",
    title: `The worry that loses customers: ${concern}`,
    // bf34: the Brief sets it against the all-worries card's own figure (never "their other worries" pooled).
    body: STYLE?.cardStep
      ? (() => {
          const all = STYLE.cardStep!("doubts:customers:all", "verdict", "leave");
          return `When a customer says "${concern}", the AI tells them to leave in ${pct(top.verdicts.leave)} of answers${exit ? `, most often for ${exit.name}` : ""}${all ? `. Across every customer worry it says leave in ${all}.` : "."}`;
        })()
      : `When a customer says "${concern}", the AI tells them to leave in ${pct(top.verdicts.leave)} of answers${exit ? `, most often for ${exit.name}` : ""} - against ${pct(rest)} across their other worries.`,
    foot: `${concern}: leave ${counts(top.verdicts.leave)}. Other customers' worries: ${counts(rest)}.${exit ? ` ${exit.name}: ${exit.n} answers.` : ""}`,
    look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    effect: rate(top.verdicts.leave) - rate(rest),
    viz: vizOf([
      W("you", insightBar(lbl(concern), top.verdicts.leave, undefined, true)),
      W("other", insightBar("Their other worries", rest)),
    ]),
    names: { worry: concern },
  };
}

/** Leave verdicts naming no destination at all. */
const NO_EXIT_SHARE = OF.noExitShare;

/** Of the customers' leave verdicts, the share naming no destination (the
 * doubt view's offersExitBy.leave, inverted). Effect = the share above half. */
function leaveNoExit(inp: InsightInputs, brand: string): Insight | null {
  const k = inp.doubt.keepOrLeave;
  if (!k) return null;
  const withExit = k.offersExitBy.leave;
  if (!enough(withExit) || !inp.F) return null;
  // Of the leave answers, the share naming nowhere to go - one fact.
  const none = inp.F.fact("slice_share", "ai/slice:!sent:any", { types: ["churn_triggers", "renewal"], when: "v:keep_or_leave:leave" });
  if (!gAtLeast(none, NO_EXIT_SHARE)) return null;
  return {
    key: "leave_no_exit",
    kind: "doubt",
    title: "Told to leave, with nowhere to go",
    // bf35: no card shows where the AI sends the customers it tells to leave, so the Brief does not cite it.
    body: STYLE?.roomShare ? "" : `When the AI tells a customer weighing a worry to leave ${brand}, ${pct(none)} of those answers name nowhere to go - the cancel is a loss to ${yo()} without being any rival's gain.`,
    foot: `Leave answers naming no destination: ${counts(none)}. Leave answers overall: ${counts(k.verdicts.leave)}.`,
    look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    effect: rate(none) - NO_EXIT_SHARE,
    viz: vizOf([W("other", insightBar("Name nowhere to go", none, undefined, true)), W("other", insightBar("Name somewhere to go", withExit))]),
  };
}

/**
 * The verdict the brief opens with: template sentences in fixed order
 * (standing, prompted vs open, concentration, doubts, value, settled), each
 * only when its inputs clear the floors. Percentages in `text`, counts in `foot`.
 */
export function composeVerdict(s: Summary, inp: InsightInputs, decisions?: Decision[]): VerdictFact[] {
  openGates();
  try {
    return composeVerdictRun(s, inp);
  } finally {
    const gates = closeGates();
    decisions?.push({ key: "verdict", fired: true, gates });
  }
}

function composeVerdictRun(s: Summary, inp: InsightInputs): VerdictFact[] {
  const out: VerdictFact[] = [];
  const decidedOk = gK(s.firmPickInCategory, MIN_BASE);

  // 1. Standing.
  if (enough(s.target.mentioned)) {
    const rival = s.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
    let text: string;
    let foot = `Named ${counts(s.target.mentioned)}; picked ${counts(s.target.chosen)}`;
    if (decidedOk) {
      // The two-pick-numbers convention: commit rate, share of picks, picked of all.
      text = `${s.brand} is named in ${pct(s.target.mentioned)} of answers when buyers ask what to buy. ${commitSentence(s.category, s.brand, s.firmPickInCategory, s.target.shareOfDecided, s.target.chosen)}`;
      foot += `; ${s.target.chosen.k} of ${s.firmPickInCategory.k} in-category picks`;
      if (rival) {
        text += ` ${rival.name} is the pick ${pct(rival.shareOfDecided)} of the time, ${rate(rival.shareOfDecided) > rate(s.target.shareOfDecided) ? "ahead of" : "behind"} ${s.brand}.`;
        foot += `; ${rival.name} ${rival.chosen.k}`;
      }
    } else {
      text = `${s.brand} is named in ${pct(s.target.mentioned)} of answers when buyers ask what to buy and is the pick in ${pfine(s.target.chosen)} of all answers.`;
    }
    out.push({ key: "standing", text, foot: `${foot}.`, look: { pill: "stations", station: "consideration", label: "Stations - Consideration" } });
  }

  // 2. Prompted vs open.
  const rec = promptedRecord(s);
  if (rec && decidedOk) {
    const hard = rec.hardest ? ` (${pct(rec.hardest.winOfDecided)} against ${rec.hardest.rival})` : "";
    const gap = rate(rec.pooled) - rate(s.target.shareOfDecided);
    const openText = `${pct(s.target.shareOfDecided)} of the picks when buyers ask what to buy`;
    const text =
      gap >= OF.verdictPromptedGap
        ? `Asked to compare it with a rival directly, the AI picks it in ${pct(rec.pooled)} of matchups${hard} - but it takes only ${openText}.`
        : gap <= -OF.verdictPromptedGap
          ? `It takes ${openText}, but asked to compare it with a rival directly, the AI picks it in only ${pct(rec.pooled)} of matchups${hard}.`
          : `Asked to compare it with a rival directly, the AI picks it in ${pct(rec.pooled)} of matchups${hard}, in line with its ${openText}.`;
    out.push({
      key: "prompted_vs_open",
      text,
      foot: `Head-to-heads won ${rec.won}, lost ${rec.lost}${rec.hardest ? `; vs ${rec.hardest.rival} ${rec.hardest.won.k}-${rec.hardest.lost.k}` : ""}. Open choice ${s.target.chosen.k} of ${s.firmPickInCategory.k} decided picks.`,
      look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
    });
  }

  // 3. Concentration: one buyer room, else one question.
  const room = roomConcentration(s, inp);
  if (room) {
    out.push({
      key: "concentration",
      text: `${pct(room.shareC)} of its picks come from one buying situation, ${room.top.room}.`,
      foot: `${room.top.picks} of ${room.total} open-choice picks; ${room.rooms} rooms.`,
      look: { pill: "buyers", label: "Buyers" },
    });
  } else {
    const q = questionConcentration(s, inp, s.target.key);
    if (q)
      out.push({
        key: "concentration",
        text: `${pct(q.shareC)} of its picks come from one question: "${quoteQuestion(q.top.text)}"`,
        foot: `${q.k} of ${q.total} open-choice picks; ${q.n} questions.`,
        look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
      });
  }

  // 4. Doubts.
  const b = s.buyersDoubt && enough(s.buyersDoubt.proceed) && enough(s.buyersDoubt.agree) ? s.buyersDoubt : null;
  const c = s.customersDoubt && enough(s.customersDoubt.keep) ? s.customersDoubt : null;
  if (b || c) {
    const text = b
      ? `The AI agrees with buyers' worries in ${pct(b.agree)} of the answers that take a side, and still tells buyers to go ahead in ${pct(b.proceed)}${c ? `; customers with a worry are told to stay in ${pct(c.keep)}` : ""}.`
      : `Customers voicing a worry are told to stay in ${pct(c!.keep)} and to leave in ${pct(c!.leave)}.`;
    const foot = [b && `Buyers: agrees ${counts(b.agree)}; go ahead ${counts(b.proceed)}.`, c && `Customers: stay ${counts(c.keep)}; leave ${counts(c.leave)}.`]
      .filter(Boolean)
      .join(" ");
    out.push({ key: "doubts", text, foot, look: { pill: "stations", station: b ? "doubts" : "customer_base", label: b ? "Stations - Doubts" : "Stations - Customers" } });
  }

  // 5. Value.
  const v = inp.value;
  if (v && enough(v.worth.yes)) {
    const subject = v.lines.length === 1 ? v.lines[0].label : `${s.brand}'s lines`;
    const verb = v.lines.length === 1 ? "is" : "are";
    let tail = "";
    // Ruling 3: each price answer in one bucket, shares of ALL the price answers.
    if (enough(v.ownRung)) {
      const own = rate(v.ownRung);
      const riv = rate(v.recommendsInstead);
      const topRival = v.instead.find((i) => !i.own);
      if (own >= OF.valueMost && own >= riv) tail = "; most answers point the buyer to only its own cheaper option";
      else if (riv >= OF.valueMost && riv > own) tail = `; most answers point the buyer to a rival instead${topRival ? `, led by ${topRival.name}` : ""}`;
      else if (own >= OF.valueSide || riv >= OF.valueSide)
        tail = inp.F?.rf.set.ladder
          ? `; the AI points the buyer to only its own cheaper option in ${pct(v.ownRung)} of answers and to a rival in ${pct(v.recommendsInstead)}`
          : `; the AI points the buyer to a rival instead in ${pct(v.recommendsInstead)} of answers`;
    }
    out.push({
      key: "value",
      text: `${subject} ${verb} judged worth it in ${pct(v.worth.yes)} of answers${tail}.`,
      foot: `Worth it ${counts(v.worth.yes)}.${v.ownRung.n > 0 ? ` Of every price answer: only its own option ${v.ownRung.k}, a rival ${v.recommendsInstead.k}, of ${v.ownRung.n}.` : ""}`,
      look: { pill: "stations", station: "value", label: "Stations - Value" },
    });
  }

  // 6. Settled customers.
  const adv = inp.settled.advocacy && enough(inp.settled.advocacy.verdicts.strengthens) ? inp.settled.advocacy : null;
  const bc = inp.settled.businessCase && enough(inp.settled.businessCase.caseStrength.strong) ? inp.settled.businessCase : null;
  const obj = inp.doubt.objections && enough(inp.doubt.objections.premise.confirms) ? inp.doubt.objections : null;
  if (adv) {
    out.push({
      key: "settled",
      text: obj
        ? `Asked to defend it, the AI strengthens the case in ${pct(adv.verdicts.strengthens)}; asked neutrally about buyers' worries, it agrees with them in ${pct(obj.premise.confirms)}.`
        : `Asked to defend it, the AI strengthens the case in ${pct(adv.verdicts.strengthens)}.`,
      foot: `Advocacy strengthens ${counts(adv.verdicts.strengthens)}.${obj ? ` Buyers' worries agreed ${counts(obj.premise.confirms)}.` : ""}`,
      look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    });
  } else if (bc) {
    out.push({
      key: "settled",
      text: `Asked for a business case, the AI makes a strong one in ${pct(bc.caseStrength.strong)}.`,
      foot: `Strong case ${counts(bc.caseStrength.strong)}.`,
      look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    });
  }
  // Statements: the plain text, and where each number sits with its fact id (never drawn).
  return out.map((v) => {
    const t = finish(extremeWords(v.text));
    return { ...v, text: t.text, foot: finish(v.foot).text, ...(t.nums.length ? { facts: { text: t.nums } } : {}) };
  });
}

/** The served list: each firing kind's best insight gets a slot before any
 * kind gets a second (QUOTA_EXEMPT kinds aside), the rest fill by global
 * rank, and the result keeps global effect order. */
export function detectInsights(s: Summary, inp: InsightInputs): Insight[] {
  const all = rankedInsights(s, inp);
  const taken = new Set<Insight>();
  const seen = new Set<InsightKind>();
  // Round 1: `all` is effect-sorted, so the first of a kind is its best.
  for (const i of all) {
    if (taken.size >= MAX_INSIGHTS) break;
    if (QUOTA_EXEMPT.has(i.kind) || seen.has(i.kind)) continue;
    seen.add(i.kind);
    taken.add(i);
  }
  // Round 2: the remaining slots by global rank, any kind, above the floor.
  for (const i of all) {
    if (taken.size >= MAX_INSIGHTS || i.effect < FILL_MIN_EFFECT) break;
    taken.add(i);
  }
  return all.filter((i) => taken.has(i));
}

/** One detector's decision, for a proof: whether it fired, and every gate it read (statements.ts). */
export interface Decision {
  key: string;
  fired: boolean;
  gates: Gate[];
}

/** Every detector that fires, ranked by effect, uncapped (harnesses read the tail). `decisions` (proofs) receives
 * every detector's gates, fired or not. */
export function rankedInsights(s: Summary, inp: InsightInputs, style?: InsightStyle, decisions?: Decision[]): Insight[] {
  const prev = STYLE;
  STYLE = style ?? null;
  try {
    return rankedRun(s, inp, decisions);
  } finally {
    STYLE = prev;
  }
}

/** A finished insight: plain text, each number's fact id under `facts`, each bar's fact and its example answers (the
 * bar's own fact's answers). */
function finishInsight(ins: Insight, inp: InsightInputs): Insight {
  const facts: Record<string, StmtNums> = {};
  const fin = (field: string, text: string) => {
    const r = finish(extremeWords(text));
    if (r.nums.length) facts[field] = r.nums;
    return r.text;
  };
  const viz = ins.viz?.map((b, i) => {
    const r = finish(b.text);
    if (r.nums.length) facts[`viz.${i}`] = r.nums;
    const ref = r.nums.length === 1 ? r.nums[0][2] : undefined;
    const refs = ref && inp.F ? refsFor(inp.F.rf, ref, EXAMPLES) : [];
    return { ...b, text: r.text, ...(ref ? { fact: ref } : {}), ...(refs.length ? { refs } : {}) };
  });
  const names = ins.names ? (Object.fromEntries(Object.entries(ins.names).map(([k, v]) => [k, typeof v === "string" ? finish(v).text : v])) as MoveNames) : undefined;
  return {
    ...ins,
    title: fin("title", ins.title),
    body: fin("body", ins.body),
    foot: finish(ins.foot).text,
    ...(viz ? { viz } : {}),
    ...(names ? { names } : {}),
    ...(Object.keys(facts).length ? { facts } : {}),
  };
}

function rankedRun(s: Summary, inp: InsightInputs, decisions?: Decision[]): Insight[] {
  const detectors: [string, () => Insight | null][] = [
    ["engine_spread", () => engineSpread(s)],
    ["engine_mode", () => modeGap(s)],
    ["engine_vendor", () => vendorGap(s, inp)],
    ["room_win", () => roomWin(inp)],
    ["room_value", () => roomValue(inp, s.brand)],
    ["rival_open", () => rivalOpen(s)],
    ["rival_h2h", () => rivalHeadToHead(s)],
    ["argument", () => argument(s)],
    ["doubt_rollup", () => doubtRollup(s)],
    ["doubt_worry", () => doubtWorry(inp)],
    ["funnel", () => funnelDrop(s)],
    ["prompted_vs_open", () => promptedVsOpen(s)],
    ["pick_concentration_room", () => pickConcentrationRoom(s, inp)],
    ["pick_concentration_question", () => pickConcentrationQuestion(s, inp)],
    ["agreed_yet_stay", () => agreedYetStay(inp)],
    ["taught_vs_winning", () => taughtVsWinning(s, inp)],
    ["value_in_house", () => valueInHouse(inp, s.brand)],
    ["advocacy_vs_objection", () => advocacyVsObjection(inp)],
    ["leaver_capture", () => leaverCapture(inp)],
    ["own_defense", () => ownDefense(inp)],
    ["away_condition", () => awayCondition(s, inp)],
    ["assigned_exception", () => assignedException(s, inp)],
    ["engine_decisiveness", () => engineDecisiveness(s)],
    ["engine_h2h_flip", () => engineHeadToHeadFlip(s)],
    ["engine_pick_concentration", () => enginePickConcentration(s, inp)],
    ["neutralized_differentiator", () => neutralizedDifferentiator(inp)],
    ["argument_flip", () => argumentFlip(inp)],
    ["conversion_vs_rival", () => conversionVsRival(s)],
    ["unasked_rival", () => unaskedRival(s, inp)],
    ["leak_picks", () => leakPicks(inp)],
    ["leak_problem", () => leakProblem(inp)],
    ["worst_worry", () => worstWorry(inp)],
    ["leave_no_exit", () => leaveNoExit(inp, s.brand)],
    ["vendor_outlier", () => vendorOutlier(inp, s.brand)],
  ];
  const found: Insight[] = [];
  for (const [key, run] of detectors) {
    openGates();
    let ins: Insight | null;
    try {
      ins = run();
    } finally {
      const gates = closeGates();
      if (decisions) decisions.push({ key, fired: false, gates });
      if (decisions) decisions[decisions.length - 1].gates = gates;
    }
    const fired = !!ins && ins.effect > 0;
    if (decisions) decisions[decisions.length - 1].fired = fired;
    if (fired) found.push(finishInsight(ins!, inp));
  }
  return found.sort((a, b) => b.effect - a.effect || a.key.localeCompare(b.key));
}
