import { matchKey } from "../brand_key";
import { ENGINES, engineDisplayLabel } from "./providers";
import { buildResolver, type Resolver } from "./brand_resolve";
import { roleOf } from "./headline";
import { cachedView, cell, computeMemo, facetsOf, poolOf, requestOf, type EngineFacets, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { composeVerdict, detectInsights, insightInputs, type Insight, type InsightInputs } from "./summary_insights";
import type { AnswerCodes, Project, Run } from "../types";

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

/** Both pick buckets must hold this many answers for lift to be reported. */
const LIFT_MIN_ANSWERS = 20;
/** A code argued in under this share of the pool never makes the lift list. */
const LIFT_MIN_INCIDENCE = 0.02;

interface Facts {
  model: string;
  outcome: string | null;
  pickKey: string | null;
  pickInCategory: boolean;
  named: Set<string>;
  recommended: Set<string>;
  reasons: string[] | null;
}

function factsOf(c: AnswerCodes, model: string, resolve: Resolver): Facts {
  const named = new Set<string>();
  const recommended = new Set<string>();
  for (const m of c.mentions ?? []) {
    const r = resolve(m.brand);
    if (r.status !== "active") continue;
    named.add(r.key);
    if (m.framing === "recommended") recommended.add(r.key);
  }
  let pickKey: string | null = null;
  let pickInCategory = false;
  if (c.outcome === "pick" && c.top_pick) {
    const r = resolve(c.top_pick);
    if (r.status === "active") {
      pickKey = r.key;
      pickInCategory = true;
      named.add(r.key);
      recommended.add(r.key);
    }
  }
  return { model, outcome: c.outcome, pickKey, pickInCategory, named, recommended, reasons: c.reasons };
}

function sliceOf(
  key: string,
  label: string,
  mode: "instinct" | "search",
  engines: number,
  list: Facts[],
  targetKey: string,
  h2h: RateCell
): SummarySlice {
  return {
    h2h,
    key,
    label,
    mode,
    engines,
    answers: list.length,
    mentioned: cell(list.filter((f) => f.named.has(targetKey)).length, list.length),
    chosen: cell(list.filter((f) => f.pickKey === targetKey).length, list.length),
    decided: cell(list.filter((f) => f.pickKey === targetKey).length, list.filter((f) => f.pickInCategory).length),
  };
}

/** `capture` (the brief, bf1): receives the sibling-view inputs the detectors read, so a caller never computes them twice. */
export async function computeBrandSummary(data: ViewData, request: ViewRequest = {}, capture?: { inputs?: InsightInputs }): Promise<BrandSummaryView> {
  const { run, project, source, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const legacy = new Set(project.competitors.map(matchKey));
  const { rows, uncoded, core } = poolOf(data, "headline", request);

  const facts = rows.map(({ code, model }) => factsOf(code, model, resolve));
  const n = facts.length;
  const outcomes = { pick: 0, conditional: 0, no_pick: 0, clarification: 0 };
  for (const f of facts) if (f.outcome && f.outcome in outcomes) outcomes[f.outcome as keyof typeof outcomes]++;
  const inCategoryPicks = facts.filter((f) => f.pickInCategory).length;

  // The pooled brand table - every active, analyzed brand the pool names.
  const entryByKey = new Map(dictionary.map((e) => [e.id, e]));
  const tally = new Map<string, { named: number; rec: number; chosen: number }>();
  const bump = (key: string, field: "named" | "rec" | "chosen") => {
    const t = tally.get(key) ?? { named: 0, rec: 0, chosen: 0 };
    t[field]++;
    tally.set(key, t);
  };
  for (const f of facts) {
    for (const k of f.named) bump(k, "named");
    for (const k of f.recommended) bump(k, "rec");
    if (f.pickKey) bump(f.pickKey, "chosen");
  }
  if (!tally.has(targetKey)) tally.set(targetKey, { named: 0, rec: 0, chosen: 0 });
  const brands: SummaryBrand[] = [];
  for (const [key, t] of tally) {
    const entry = entryByKey.get(key) ?? null;
    if (entry && !entry.analyzed && key !== targetKey) continue;
    brands.push({
      key,
      name: entry ? entry.display_name ?? entry.canonical : project.brand,
      role: roleOf(key, targetKey, entry, legacy),
      mentioned: cell(t.named, n),
      recommended: cell(t.rec, n),
      chosen: cell(t.chosen, n),
      shareOfDecided: cell(t.chosen, inCategoryPicks),
    });
  }
  brands.sort((a, b) => b.chosen.k - a.chosen.k || b.mentioned.k - a.mentioned.k || a.name.localeCompare(b.name));
  const target = brands.find((b) => b.key === targetKey)!;

  // Argument lift: wins vs other in-category picks, both buckets big enough.
  const wins = facts.filter((f) => f.pickKey === targetKey && f.reasons !== null);
  const others = facts.filter((f) => f.pickInCategory && f.pickKey !== targetKey && f.reasons !== null);
  let reasonLift: ReasonLift[] = [];
  if (wins.length >= LIFT_MIN_ANSWERS && others.length >= LIFT_MIN_ANSWERS) {
    const withReasons = facts.filter((f) => f.reasons !== null);
    const counts = new Map<string, number>();
    for (const f of withReasons) for (const r of f.reasons!) counts.set(r, (counts.get(r) ?? 0) + 1);
    const share = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
    reasonLift = [...counts.entries()]
      .filter(([, k]) => k / withReasons.length >= LIFT_MIN_INCIDENCE)
      .map(([code]) => {
        const w = cell(wins.filter((f) => f.reasons!.includes(code)).length, wins.length);
        const o = cell(others.filter((f) => f.reasons!.includes(code)).length, others.length);
        return { code, wins: w, others: o, lift: share(w) - share(o) };
      })
      .sort((a, b) => b.lift - a.lift);
  }

  // Doubt rollups, each from its own pool (never pooled with the headline).
  const premiseAgree = (codes: AnswerCodes[]): RateCell => {
    const judged = codes.filter((c) => c.premise_verdict !== null);
    return cell(judged.filter((c) => c.premise_verdict === "confirms").length, judged.length);
  };
  const doubt = poolOf(data, "doubt", request).rows.map((r) => r.code);
  const keep = poolOf(data, "keep_or_leave", request).rows.map((r) => r.code);
  const buyersDoubt =
    doubt.length === 0
      ? null
      : {
          answers: doubt.length,
          proceed: cell(doubt.filter((c) => c.proceed_or_avoid === "proceed").length, doubt.length),
          avoid: cell(doubt.filter((c) => c.proceed_or_avoid === "avoid").length, doubt.length),
          agree: premiseAgree(doubt),
        };
  const customersDoubt =
    keep.length === 0
      ? null
      : {
          answers: keep.length,
          keep: cell(keep.filter((c) => c.keep_or_leave === "keep").length, keep.length),
          leave: cell(keep.filter((c) => c.keep_or_leave === "leave").length, keep.length),
          agree: premiseAgree(keep),
        };

  // Entity head-to-heads: the two-way record per named rival (the full
  // matchup detail, conditions included, lives in the head-to-head view).
  const h2h = poolOf(data, "head_to_head_entity", request).rows;
  const byRival = new Map<string, { rival: string; won: number; lost: number; n: number }>();
  const h2hByModel = new Map<string, { won: number; lost: number }>();
  for (const { code: c, intent, model } of h2h) {
    const r = resolve(intent.angle);
    const key = r.status === "active" ? r.key : `?${matchKey(intent.angle)}`;
    const name = r.status === "active" ? r.name : intent.angle;
    const row = byRival.get(key) ?? { rival: name, won: 0, lost: 0, n: 0 };
    row.n++;
    if (c.outcome === "pick" && c.top_pick) {
      const p = resolve(c.top_pick);
      const em = h2hByModel.get(model) ?? { won: 0, lost: 0 };
      if (p.key === targetKey) {
        row.won++;
        em.won++;
      } else if (p.key === key) {
        row.lost++;
        em.lost++;
      }
      h2hByModel.set(model, em);
    }
    byRival.set(key, row);
  }
  // Engine and mode splits of the target's rates, over the same pool; each
  // slice carries the prompted head-to-head record on its engines beside it.
  const h2hCell = (models: string[]): RateCell => {
    let won = 0;
    let lost = 0;
    for (const m of models) {
      const e = h2hByModel.get(m);
      if (e) {
        won += e.won;
        lost += e.lost;
      }
    }
    return cell(won, won + lost);
  };
  const engineMeta = new Map(ENGINES.map((e) => [e.id, { label: engineDisplayLabel(e), mode: e.mode }]));
  const byEngine = [...core]
    .filter((m) => facts.some((f) => f.model === m))
    .map((m) => {
      const meta = engineMeta.get(m);
      return { ...sliceOf(m, meta?.label ?? m, meta?.mode ?? "instinct", 1, facts.filter((f) => f.model === m), targetKey, h2hCell([m])), ...facetsOf(m) };
    });
  const byMode = (["instinct", "search"] as const).flatMap((mode) => {
    const engines = byEngine.filter((e) => e.mode === mode);
    if (engines.length === 0) return [];
    const list = facts.filter((f) => (engineMeta.get(f.model)?.mode ?? "instinct") === mode);
    return [sliceOf(mode, mode, mode, engines.length, list, targetKey, h2hCell(engines.map((e) => e.key)))];
  });

  const headToHead = [...byRival.entries()]
    .map(([key, r]) => ({
      key,
      rival: r.rival,
      answers: r.n,
      won: cell(r.won, r.n),
      lost: cell(r.lost, r.n),
      winOfDecided: cell(r.won, r.won + r.lost),
    }))
    .sort((a, b) => b.answers - a.answers || a.rival.localeCompare(b.rival));

  const summary: Omit<BrandSummaryView, "insights" | "verdict"> = {
    runId: run.id,
    source,
    brand: project.brand,
    category: project.category,
    answers: n,
    uncoded,
    outcomes,
    firmPick: cell(outcomes.pick, n),
    firmPickInCategory: cell(inCategoryPicks, n),
    target,
    brands,
    byMode,
    byEngine,
    core: [...core].map((id) => ({ id, label: engineMeta.get(id)?.label ?? id, ...facetsOf(id) })),
    reasonLift,
    buyersDoubt,
    customersDoubt,
    headToHead,
  };
  const inputs = await insightInputs(data, request);
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
export const BRAND_SUMMARY_VERSION = "bs22"; // bs22 (2026-11-13): the themed away_condition finding names one destination only when it takes at least half the answers behind the condition, otherwise the top two with "mostly" (destOf). Keyless output unchanged. // bs21 (2026-11-13): the one counting rule reaches the specific situations - the themed away_condition finding states its blocker and fixed-situation wordings as shares of the same answer base as its headline, folds a fixed situation worded like the quoted lead wording into one sentence, and never names a default ("otherwise") wording; the brief's condition inputs carry each themed side's answer base and per-theme answers. Keyless output unchanged. // bs20 (2026-11-13): one counting rule - with reason themes, the away_condition and assigned_exception findings count the top theme at answer grain and quote its most-stated wording; a blocker brand or fixed situation is still detected on one wording and gets its own sentence. Keyless output unchanged. // bs19 (2026-11-12): the assigned_exception insight - in the direct matchups lost on balance, the largest condition the AI still gives for choosing the brand (raw condition groups, named by its theme). // bs16 (2026-11-11): the finding bars carry `refs` - up to 5 answers behind each bar's numerator, where the detector reads a plain filter of a pool (summary_insights ExampleIndex); bars with no natural answer set carry none. // bs15 (2026-11-10): every insight carries `viz` - 2-4 small bars of the numbers its sentence uses (the Overview finding cards)
export function computeBrandSummaryCached(run: Run, project: Project, request: ViewRequest = {}): Promise<BrandSummaryView | null> {
  const r = requestOf(request);
  return cachedView("brand_summary", BRAND_SUMMARY_VERSION, run, project, async (d) => (await sharedBrandSummary(d, r)).view, { judge: true, setupDecision: true }, r);
}
