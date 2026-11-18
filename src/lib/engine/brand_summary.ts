import { cachedView, computeMemo, requestOf, type EngineFacets, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { composeVerdict, detectInsights, type Insight, type InsightInputs } from "./summary_insights";
import { inputsFromFacts, sharedRunFacts, summaryFromFacts } from "./facts/overview_facts";
import type { StmtNums } from "./facts/statements";
import type { Project, Run } from "../types";

export type { RateCell, Insight };

/**
 * The brand summary (2026-10-30): the answer_codes equivalent of the legacy
 * RunMetrics pooled brand table and outcome splits, feeding the Boardroom
 * and Five-questions executive views. One payload, so both render from one
 * fetch and one cache entry.
 *
 * The base is the HEADLINE pool - open-choice answers on the core panel
 * (the presentation rule, CODING_DECISIONS section 8): the funnel, the
 * outcome split, the brand table, the engine/mode splits and the argument
 * lift all read the same answers the headline view reads. The doubt and
 * head-to-head rollups come from their own pools and are reported beside
 * the headline numbers, never summed with them.
 */

export interface SummaryBrand {
  key: string;
  name: string;
  role: "target" | "competitor" | "emerged";
  mentioned: RateCell;
  recommended: RateCell;
  chosen: RateCell;
  /** Chosen over in-category picks. */
  shareOfDecided: RateCell;
  /** bs28: recommendations that end as the pick (a pick counts as recommended). */
  converts?: RateCell;
}

export interface SummarySlice {
  key: string;
  label: string;
  mode: "instinct" | "search";
  /** Engines pooled into the slice (1 on an engine row). */
  engines: number;
  answers: number;
  mentioned: RateCell;
  chosen: RateCell;
  /** The target's picks over the slice's in-category picks (bs5). */
  decided: RateCell;
  /** bs7: the prompted entity head-to-heads on the slice's engines - won
   * over won + lost (n = 0 where no head-to-head was asked). Its own pool,
   * reported beside the open-choice numbers, never summed with them. */
  h2h: RateCell;
  /** bs28: the share of the slice's answers that commit to one brand in analysis (its own fact). */
  firm?: RateCell;
}

/** Share of answers arguing the code when the target is picked vs when
 * another in-category brand is - the arguments that travel with wins. */
export interface ReasonLift {
  code: string;
  wins: RateCell;
  others: RateCell;
  /** rate(wins) - rate(others), in points of 1. */
  lift: number;
}

export interface DoubtSummary {
  answers: number;
  /** Over answers with a premise verdict: the AI agrees the worry is warranted. */
  agree: RateCell;
}

/** One template sentence of the brief's opening verdict: percentages in
 * `text`, counts in `foot`, and the station that holds the evidence. */
export interface VerdictFact {
  key: string;
  text: string;
  foot: string;
  look?: Insight["look"];
  /** bs28: where each number of `text` sits, with its fact id (never drawn). */
  facts?: Record<string, StmtNums>;
}

export interface BrandSummaryView {
  runId: string;
  source: string;
  brand: string;
  category: string;
  /** Coded headline answers on the core panel - the funnel's base. */
  answers: number;
  uncoded: number;
  outcomes: { pick: number; conditional: number; no_pick: number; clarification: number };
  firmPick: RateCell;
  /** Picks whose top pick resolves to an active dictionary brand (B5). */
  firmPickInCategory: RateCell;
  target: SummaryBrand;
  /** Active, analyzed brands named in the pool, most chosen first. */
  brands: SummaryBrand[];
  byMode: SummarySlice[];
  byEngine: (SummarySlice & EngineFacets)[];
  /** The engines the pool counts, in panel order - the Panel lens's
   * options (on an engine-filtered request, the set itself). */
  core: ({ id: string; label: string } & EngineFacets)[];
  /** Sorted by lift, best first; [] when either pick bucket is too small. */
  reasonLift: ReasonLift[];
  /** Buyers voicing a worry (objections): go ahead / avoid. */
  buyersDoubt: (DoubtSummary & { proceed: RateCell; avoid: RateCell }) | null;
  /** Customers voicing a worry (churn/renewal): stay / leave. */
  customersDoubt: (DoubtSummary & { keep: RateCell; leave: RateCell }) | null;
  /** bs28: every named rival's direct matchups pooled - won over won + lost (the question's own rival on each answer). */
  headToHeadAll?: RateCell;
  /** Entity head-to-heads: the prompted two-way record per named rival. */
  headToHead: {
    key: string;
    rival: string;
    answers: number;
    won: RateCell;
    lost: RateCell;
    /** Won over won + lost. */
    winOfDecided: RateCell;
  }[];
  /** Ranked findings across engines, rooms, rivals, arguments, doubts and
   * the funnel (summary_insights.ts, bs5; switching, conditions and engine decisiveness from bs7): at most one per detector, at most 8. */
  insights: Insight[];
  /** 3-6 template sentences in fixed order (standing, prompted vs open, concentration, doubts, value, settled), each only when its inputs clear the floors. The brief opens with them. */
  verdict: VerdictFact[];
}

/** `capture` (the brief, bf1): receives the sibling-view inputs the detectors read, so a caller never computes them twice.
 * Step 5 of the fact layer: the summary and the detectors' inputs are looked up from the run's one fact book
 * (facts/overview_facts.ts); nothing here counts answers. */
export async function computeBrandSummary(data: ViewData, request: ViewRequest = {}, capture?: { inputs?: InsightInputs }): Promise<BrandSummaryView> {
  const rf = await sharedRunFacts(data, request);
  const summary = summaryFromFacts(data, rf);
  const inputs = inputsFromFacts(data, rf, summary);
  if (capture) capture.inputs = inputs;
  return { ...summary, insights: detectInsights(summary, inputs), verdict: composeVerdict(summary, inputs) };
}

const summaryMemo = computeMemo<{ view: BrandSummaryView; inputs: InsightInputs }>("brand_summary");

/** The brand summary and its detectors' inputs, computed once per load epoch
 * and engine set and shared by the summary route, the map, the dossiers and
 * the brief (view_data computeMemo). READ-ONLY: callers copy before reshaping. */
export function sharedBrandSummary(data: ViewData, eng: ViewRequest): Promise<{ view: BrandSummaryView; inputs: InsightInputs }> {
  const e: ViewRequest = eng.engines ? { engines: eng.engines } : {};
  return summaryMemo.get(data, e, async (d) => {
    const capture: { inputs?: InsightInputs } = {};
    const view = await computeBrandSummary(d, e, capture);
    return { view, inputs: capture.inputs! };
  });
}

// bs1 (2026-10-30): first version; names resolve through the context judge.
// bs4 (2026-11-03): engine slices carry vendor / tier / mode and the payload lists its core engines (the Panel lens).
// bs5 (2026-11-03): ranked server-side insights (summary_insights.ts) and a per-slice share of decided.
// bs6 (2026-11-03): the verdict sentences and six cross-pool detectors; loads the setup decision (Value line names).
// bs7 (2026-11-03): engine and mode slices carry the prompted head-to-head record; detectors over rival leavers, holding your own, the run's decision rules (one shared condition grouping) and engine decisiveness / head-to-head flips / one-engine pick concentration.
// bs8 (2026-11-04): detectors for a neutralized differentiator (pooled head-to-head arguments), conversion vs the top rival, picks and problem questions leaving the category, the customers' worst worry and leave verdicts naming no destination.
// bs9 (2026-11-04): kind quotas on the served list - each firing kind's best insight gets a slot before any kind gets a second (funnel/value exempt: the verdict carries them), remaining slots by rank, cap 12, effect order kept.
// bs10 (2026-11-04): the rank-fill slots need effect >= 0.3 (quota slots unfloored), so the served list stops where the findings do instead of padding to the cap.
// bs11 (2026-11-04): the language pass for the Verdict pill - insight bodies and verdict sentences drop method terms (share of picks, direct matchups, buying situations, with / without web search); the standing sentence carries the commit-rate convention (BRIEF_PILL_DESIGN_2026-11-04.md).
// bs12 (2026-11-09): the condition insight's title, body and foot say "reason" (the reasons rename); kind key unchanged.
// bs13 (2026-11-10): the plain-wording pass - insight titles, bodies and feet drop "reason", "routes", "wall", "leavers", "travels with your wins" and "closest contest" (what sends buyers away / brings them to you, a fixed situation, rivals' customers, best matchup); the argument insight's title says the code comes up when you win. Keys, kinds, numbers and effects unchanged.
// bs14 (2026-11-10): the away-condition insight reads the tightened wall flag.
// bs15 (2026-11-10): every insight carries `viz` - 2-4 small bars of the numbers its sentence uses (the Overview finding cards)
// bs17 (2026-11-12): the reasons harmonization - the brief's condition branches (inputs.conditions) read reason THEMES (run_themes.ts themeRollup) when the run has theme maps, raw groups only without one; the away-condition finding still DETECTS on raw condition groups (Tyler 2026-11-12: a broad theme can cover every away question and swallowed the Netflix Prime blocker and the Jira fixed situation) and its sentence names the theme the wording sits under. Rules and themes come from the shared pass (no new model call).
// bs18 (2026-11-12): vendor_outlier - one AI company (its engines pooled) answers a question outside the open choice and the head-to-heads (customers' and buyers' worries, Value, rivals' customers switching, your customers looking around) apart from every other company pooled, by at least 10 points.
export const BRAND_SUMMARY_VERSION = "bs29"; // bs29 (2026-11-17, fact layer step 6): a customers' worry asked at one stage only is counted on its card's own scope (both stages pooled for that worry - same answers, the card's fact id), and worst_worry's "their other worries" is the other worry's own card fact when there is exactly one; the Brief sentences quoting those findings now link. // bs28 (2026-11-17, fact layer step 5): the summary, its brand table, splits, lift, doubt and matchup rollups and every detector's inputs are looked up from the run's one fact book (facts/overview_facts.ts) - every number a fact with its id (Insight.facts, InsightBar.fact, VerdictFact.facts), every decision a logged gate (statements.ts); a bar's example answers are its own fact's answers. Rulings that land: 7 (what to buy = discovery + use case), 2, 3 (Value: shares of every price answer, one bucket each - the value sentences reworded), 8, 9, 10 (away_condition reads the What to buy card's own rows; assigned_exception one lost matchup card's own rows). // bs27 (2026-11-16): the findings use the cards' words (the worry is fair, agrees with most, tells buyers to look for). // bs26 (2026-11-16): each insight carries the names its Overview move fills in, each finding bar says whose number it is (you / rival / other), and a quoted question is whole up to 180 characters (was cut at 80, mid-sentence). // bs25 (2026-11-16): the taught-vs-winning title says "seldom taught". // bs24 (2026-11-13): the argument_flip insight - one argument that comes up more when you are picked in one pick contest and more when a rival is picked in another. // bs23 (2026-11-13): the unasked_rival insight - a rival taking at least 10% of the picks with no direct matchup asked against it (matchup_gap.ts, the rival dossier's callout rule), carrying `matchup` for the Overview's "Ask this matchup" action. // bs22 (2026-11-13): the themed away_condition finding names one destination only when it takes at least half the answers behind the condition, otherwise the top two with "mostly" (destOf). Keyless output unchanged. // bs21 (2026-11-13): the one counting rule reaches the specific situations - the themed away_condition finding states its blocker and fixed-situation wordings as shares of the same answer base as its headline, folds a fixed situation worded like the quoted lead wording into one sentence, and never names a default ("otherwise") wording; the brief's condition inputs carry each themed side's answer base and per-theme answers. Keyless output unchanged. // bs20 (2026-11-13): one counting rule - with reason themes, the away_condition and assigned_exception findings count the top theme at answer grain and quote its most-stated wording; a blocker brand or fixed situation is still detected on one wording and gets its own sentence. Keyless output unchanged. // bs19 (2026-11-12): the assigned_exception insight - in the direct matchups lost on balance, the largest condition the AI still gives for choosing the brand (raw condition groups, named by its theme). // bs16 (2026-11-11): the finding bars carry `refs` - up to 5 answers behind each bar's numerator, where the detector reads a plain filter of a pool (summary_insights ExampleIndex); bars with no natural answer set carry none. // bs15 (2026-11-10): every insight carries `viz` - 2-4 small bars of the numbers its sentence uses (the Overview finding cards)
export function computeBrandSummaryCached(run: Run, project: Project, request: ViewRequest = {}): Promise<BrandSummaryView | null> {
  const r = requestOf(request);
  return cachedView("brand_summary", BRAND_SUMMARY_VERSION, run, project, async (d) => (await sharedBrandSummary(d, r)).view, { judge: true, setupDecision: true }, r);
}
