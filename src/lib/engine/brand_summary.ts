import { matchKey } from "../brand_key";
import { ENGINES, engineDisplayLabel } from "./providers";
import { buildResolver, type Resolver } from "./brand_resolve";
import { roleOf } from "./headline";
import { cachedView, cell, poolOf, type RateCell, type ViewData } from "./view_data";
import type { AnswerCodes, Project, Run } from "../types";

export type { RateCell };

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
  byEngine: SummarySlice[];
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
  targetKey: string
): SummarySlice {
  return {
    key,
    label,
    mode,
    engines,
    answers: list.length,
    mentioned: cell(list.filter((f) => f.named.has(targetKey)).length, list.length),
    chosen: cell(list.filter((f) => f.pickKey === targetKey).length, list.length),
  };
}

export function computeBrandSummary(data: ViewData): BrandSummaryView {
  const { run, project, source, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const legacy = new Set(project.competitors.map(matchKey));
  const { rows, uncoded, core } = poolOf(data, "headline");

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

  // Engine and mode splits of the target's rates, over the same pool.
  const engineMeta = new Map(ENGINES.map((e) => [e.id, { label: engineDisplayLabel(e), mode: e.mode }]));
  const byEngine = [...core]
    .filter((m) => facts.some((f) => f.model === m))
    .map((m) => {
      const meta = engineMeta.get(m);
      return sliceOf(m, meta?.label ?? m, meta?.mode ?? "instinct", 1, facts.filter((f) => f.model === m), targetKey);
    });
  const byMode = (["instinct", "search"] as const).flatMap((mode) => {
    const engines = byEngine.filter((e) => e.mode === mode);
    if (engines.length === 0) return [];
    const list = facts.filter((f) => (engineMeta.get(f.model)?.mode ?? "instinct") === mode);
    return [sliceOf(mode, mode, mode, engines.length, list, targetKey)];
  });

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
  const doubt = poolOf(data, "doubt").rows.map((r) => r.code);
  const keep = poolOf(data, "keep_or_leave").rows.map((r) => r.code);
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
  const h2h = poolOf(data, "head_to_head_entity").rows;
  const byRival = new Map<string, { rival: string; won: number; lost: number; n: number }>();
  for (const { code: c, intent } of h2h) {
    const r = resolve(intent.angle);
    const key = r.status === "active" ? r.key : `?${matchKey(intent.angle)}`;
    const name = r.status === "active" ? r.name : intent.angle;
    const row = byRival.get(key) ?? { rival: name, won: 0, lost: 0, n: 0 };
    row.n++;
    if (c.outcome === "pick" && c.top_pick) {
      const p = resolve(c.top_pick);
      if (p.key === targetKey) row.won++;
      else if (p.key === key) row.lost++;
    }
    byRival.set(key, row);
  }
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

  return {
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
    reasonLift,
    buyersDoubt,
    customersDoubt,
    headToHead,
  };
}

// bs1 (2026-10-30): first version; names resolve through the context judge.
const BRAND_SUMMARY_VERSION = "bs2";
export function computeBrandSummaryCached(run: Run, project: Project): Promise<BrandSummaryView | null> {
  return cachedView("brand_summary", BRAND_SUMMARY_VERSION, run, project, computeBrandSummary, { judge: true });
}
