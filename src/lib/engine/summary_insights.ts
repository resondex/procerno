import { computeHeadline } from "./headline";
import { computeValue, type ValueView } from "./value";
import { computeDoubt, type DoubtViews, type WorryRow } from "./doubt";
import { computeSettled, type SettledViews } from "./settled";
import { computeReasons } from "./reasons";
import { buildResolver } from "./brand_resolve";
import { containsSeq, famTokens } from "./brand_family";
import { computeAlternatives, type AlternativesViews } from "./alternatives";
import type { RuleGroup } from "./rules_explorer";
import { isDefaultCondition } from "./condition_groups";
import { sharedRunThemes, themeRollup, type ThemeRollup } from "./run_themes";
import { viewsOf } from "./views";
import { cell, poolOf, type PoolRow, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import type { BrandSummaryView, VerdictFact } from "./brand_summary";
import type { AnswerRef } from "./analysis_types";
import { matchKey } from "../brand_key";
import { ROW_NAME } from "./question_names";

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
 */

export type InsightKind = "engine" | "room" | "rival" | "argument" | "doubt" | "funnel" | "question" | "value" | "switching" | "condition" | "leak";
// "why" (2026-11-05) and "buyers" (2026-11-09) are retired pills: `look` is
// consumed only by the unreferenced summary_views.tsx, so the targets stay as
// written rather than paying a version bump to repoint a dead field.
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
}

/* ------------------------- bs16: example answers ------------------------- */

/** How many example answers a number carries. */
export const EXAMPLES = 5;

/** Up to `k` answers as AnswerRefs, deterministic (response id order) and
 * spread across assistants: one per assistant first, then the rest in order.
 * Rows with nothing to highlight are skipped. */
export function exampleRefs(rows: PoolRow[], findOf: (r: PoolRow) => string, k = EXAMPLES): AnswerRef[] {
  const sorted = [...rows].sort((a, b) => (a.code.response_id < b.code.response_id ? -1 : a.code.response_id > b.code.response_id ? 1 : 0));
  const withFind = sorted.map((r) => ({ r, find: findOf(r).trim() }));
  // An answer with nothing to highlight is left out (the modal needs a passage).
  const order = withFind.filter((x) => x.find);
  const out: { r: PoolRow; find: string }[] = [];
  const models = new Set<string>();
  const ids = new Set<string>();
  for (const x of order) {
    if (out.length >= k) break;
    if (models.has(x.r.model) || ids.has(x.r.code.response_id)) continue;
    models.add(x.r.model);
    ids.add(x.r.code.response_id);
    out.push(x);
  }
  for (const x of order) {
    if (out.length >= k) break;
    if (ids.has(x.r.code.response_id)) continue;
    ids.add(x.r.code.response_id);
    out.push(x);
  }
  return out.map((x) => ({ responseId: x.r.code.response_id, find: x.find }));
}

/**
 * The answers behind the detectors' numerators (bs16): each method filters
 * the same pool, under the same engine set and resolver, with the same
 * predicate the number counts, and returns example refs. Built once per
 * insightInputs; in-process only (closures - never serialized).
 */
export interface ExampleIndex {
  /** Open-choice answers whose pick resolves to `key` (a key list pools
   * several; null = any in-category pick), optionally on some engines, in a
   * room, outside a room, or in one question (intent). */
  picks(key: string | string[] | null, opt?: { models?: string[]; room?: string; notRoom?: string; intentId?: string }): AnswerRef[];
  /** Open-choice answers naming the brand (any active mention, or the pick). */
  named(key: string): AnswerRef[];
  /** Open-choice answers recommending the brand (a recommended mention, or the pick). */
  recommended(key: string): AnswerRef[];
  /** Open-choice firm picks outside the category (B5), optionally in a room. */
  outside(opt?: { room?: string }): AnswerRef[];
  /** Open-choice answers arguing `code`, picking you or another in-category brand. */
  argued(code: string, side: "you" | "others"): AnswerRef[];
  /** Entity head-to-heads the target wins, optionally against one rival (the
   * summary's rival key) or on some engines. */
  h2hWins(opt?: { rivalKey?: string; models?: string[] }): AnswerRef[];
  /** Entity head-to-heads won / lost to the cell's rival, arguing `code`. */
  h2hArg(code: string, side: "wins" | "losses"): AnswerRef[];
  /** Buyers' worries (objections) or customers' worries (keep or leave) matching the predicate. */
  doubt(kind: "objections" | "keep", pred: (r: PoolRow) => boolean): AnswerRef[];
  /** Value answers in a room with the verdict. */
  value(room: string, worth: "yes"): AnswerRef[];
  /** Problem-recognition answers routed outside the category. */
  routing(opt?: { room?: string; notRoom?: string }): AnswerRef[];
}

function buildExampleIndex(data: ViewData, engines: ViewRequest, resolve: ReturnType<typeof buildResolver>, targetKey: string): ExampleIndex {
  const pools = new Map<string, PoolRow[]>();
  const pool = (v: Parameters<typeof poolOf>[1]) => {
    let p = pools.get(v);
    if (!p) pools.set(v, (p = poolOf(data, v, engines).rows));
    return p;
  };
  const memo = new Map<string, { key: string | null; status: string }>();
  const res = (s: string) => {
    let r = memo.get(s);
    if (!r) {
      const x = resolve(s);
      memo.set(s, (r = { key: x.status === "active" ? x.key : null, status: x.status }));
    }
    return r;
  };
  /** The active key of an answer's pick, or null. */
  const pickKey = (r: PoolRow) => (r.code.outcome === "pick" && r.code.top_pick ? res(r.code.top_pick).key : null);
  const quote = (r: PoolRow) => (r.code.quote ?? "").trim();
  /** The brand as the answer writes it, or the quote when it names the brand. */
  const brandFind = (key: string) => (r: PoolRow) => {
    let form = "";
    for (const m of r.code.mentions ?? []) if (res(m.brand).key === key) {
      form = m.brand;
      break;
    }
    if (!form && r.code.top_pick && res(r.code.top_pick).key === key) form = r.code.top_pick;
    const q = quote(r);
    if (q && (!form || q.toLowerCase().includes(form.toLowerCase()))) return q;
    return form || q;
  };
  const pickFind = (r: PoolRow) => {
    const k = pickKey(r);
    return k ? brandFind(k)(r) : quote(r) || (r.code.top_pick ?? "");
  };
  const doubtFind = (r: PoolRow) => (r.code.premise_quote ?? "").trim() || quote(r);
  const inModels = (models?: string[]) => (r: PoolRow) => !models || models.includes(r.model);
  return {
    picks(key, opt = {}) {
      const keys = key === null ? null : new Set(Array.isArray(key) ? key : [key]);
      const m = inModels(opt.models);
      const rows = pool("headline").filter((r) => {
        const k = pickKey(r);
        if (!k || (keys && !keys.has(k)) || !m(r)) return false;
        if (opt.room !== undefined && r.intent.situation !== opt.room) return false;
        if (opt.notRoom !== undefined && r.intent.situation === opt.notRoom) return false;
        if (opt.intentId !== undefined && r.intent.id !== opt.intentId) return false;
        return true;
      });
      return exampleRefs(rows, pickFind);
    },
    named(key) {
      const rows = pool("headline").filter((r) => pickKey(r) === key || (r.code.mentions ?? []).some((x) => res(x.brand).key === key));
      return exampleRefs(rows, brandFind(key));
    },
    recommended(key) {
      const rows = pool("headline").filter(
        (r) => pickKey(r) === key || (r.code.mentions ?? []).some((x) => x.framing === "recommended" && res(x.brand).key === key)
      );
      return exampleRefs(rows, brandFind(key));
    },
    outside(opt = {}) {
      const rows = pool("headline").filter(
        (r) => r.code.outcome === "pick" && !pickKey(r) && (opt.room === undefined || r.intent.situation === opt.room)
      );
      return exampleRefs(rows, (r) => (r.code.top_pick ?? "").trim() || quote(r));
    },
    argued(code, side) {
      const rows = pool("headline").filter((r) => {
        const k = pickKey(r);
        if (!k || r.code.reasons === null || !r.code.reasons.includes(code)) return false;
        return side === "you" ? k === targetKey : k !== targetKey;
      });
      return exampleRefs(rows, () => code);
    },
    h2hWins(opt = {}) {
      const m = inModels(opt.models);
      const rows = pool("head_to_head_entity").filter((r) => {
        if (pickKey(r) !== targetKey || !m(r)) return false;
        if (opt.rivalKey === undefined) return true;
        const a = res(r.intent.angle);
        return (a.key ?? `?${matchKey(r.intent.angle)}`) === opt.rivalKey;
      });
      return exampleRefs(rows, brandFind(targetKey));
    },
    h2hArg(code, side) {
      const rows = pool("head_to_head_entity").filter((r) => {
        if (r.code.outcome !== "pick" || !r.code.top_pick || r.code.reasons === null || !r.code.reasons.includes(code)) return false;
        const a = res(r.intent.angle).key;
        if (!a) return false;
        const k = pickKey(r);
        return side === "wins" ? k === targetKey : k === a;
      });
      return exampleRefs(rows, () => code);
    },
    doubt(kind, pred) {
      return exampleRefs(pool(kind === "objections" ? "doubt" : "keep_or_leave").filter(pred), doubtFind);
    },
    value(room, worth) {
      return exampleRefs(
        pool("value").filter((r) => (r.intent.situation ?? "") === room && r.code.worth_it === worth),
        quote
      );
    },
    routing(opt = {}) {
      const rows = pool("awareness_routing").filter((r) => {
        if (r.code.category_routed !== "adjacent") return false;
        if (opt.room !== undefined && r.intent.situation !== opt.room) return false;
        if (opt.notRoom !== undefined && (!r.intent.situation || r.intent.situation === opt.notRoom)) return false;
        return true;
      });
      return exampleRefs(rows, quote);
    },
  };
}

/** The models of the summary's engine slices that pass the filter. */
const modelsOf = (s: Omit<BrandSummaryView, "insights" | "verdict">, f: (e: Omit<BrandSummaryView, "insights" | "verdict">["byEngine"][number]) => boolean) =>
  s.byEngine.filter(f).map((e) => e.key);
/** A worry's row key, as doubt.ts groups answers: stage + concern. */
const worryKey = (r: PoolRow) => `${r.intent.stage}|${r.intent.concern ?? ""}`;

/** A bar with its example answers attached (when any). */
const withRefs = (b: InsightBar | null | undefined | false, refs: AnswerRef[] | undefined): InsightBar | null | undefined | false =>
  b && refs && refs.length ? { ...b, refs } : b;

/** A bar from a share (0-1) or a rate cell; text defaults to the sentences' pct. */
export function insightBar(label: string, x: number | RateCell, text?: string, hi = false): InsightBar {
  const r = typeof x === "number" ? x : x.n > 0 ? x.k / x.n : 0;
  return { label, value: Math.max(0, Math.min(100, Math.round(r * 1000) / 10)), text: text ?? pctShare(r), ...(hi ? { hi: true as const } : {}) };
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
const MIN_BASE = 20;
const MAX_INSIGHTS = 12;
/** Kinds the verdict's own sentences carry by construction - no guaranteed
 * slot in the served list (they still serve wherever global rank puts them). */
const QUOTA_EXEMPT: ReadonlySet<InsightKind> = new Set(["funnel", "value"]);
/** Rank-fill slots (round 2) need this much effect - the quota slots do not,
 * because effects are not on one scale across detectors (a 0.16 leak can be
 * a bigger story than a 0.4 engine spread) and each detector already proved
 * itself statistically to fire. The floor only stops a quiet tracker's list
 * from padding to the cap with small-gap findings. */
const FILL_MIN_EFFECT = 0.3;

/** The sibling-view inputs the detectors read, all under the summary's request. */
export interface InsightInputs {
  /** Per buyer room: the target's share of decided in that room's open-choice
   * answers, its picks there and the room's in-category picks (bs8: firmAll,
   * every firm pick, in the category or not). */
  rooms: { room: string; decided: RateCell; picks: number; firm: number; firmAll: number }[];
  value: ValueView | null;
  doubt: DoubtViews;
  /** Per open-choice question (cell - seed + paraphrases, named by the seed): picks by resolved active brand key. */
  questions: { id: string; text: string; answers: number; picks: Record<string, number> }[];
  settled: SettledViews;
  /** Criteria-taught incidence per code, most taught first; [] without a criteria pool. */
  taught: { code: string; rate: RateCell }[];
  /** bs7: rival leavers and holding your own (computeAlternatives). */
  alternatives: AlternativesViews;
  /** bs7: the run's largest away-routing condition groups (top AWAY_TOP by
   * answers) and the questions with any away rule; null without rules. */
  away: {
    groups: {
      label: string;
      rules: number;
      answers: number;
      cells: number;
      wall: boolean;
      routes: { name: string; n: number }[];
      /** The longest active dictionary form in the wording, the client excluded. */
      names: { key: string; name: string } | null;
      /** bs17: the reason theme this wording sits under on the Map, when its name differs. */
      theme?: string;
    }[];
    cells: number;
    grouping: "embeddings" | "stems";
  } | null;
  /** bs7: open-choice picks per resolved active brand, by engine (model id). */
  enginePicks: { key: string; total: number; byModel: Record<string, number> }[];
  /** bs8: reason codes on the pooled entity head-to-heads - answers the
   * target wins (top pick = the client) and loses (top pick = the cell's
   * rival), per code with the losses split by rival key. */
  h2hArgs: {
    wins: number;
    losses: number;
    rivals: Record<string, string>;
    codes: { code: string; wins: number; losses: number; lossesBy: Record<string, number> }[];
  };
  /** bs8: open-choice firm picks (B5) - all of them, the in-category ones,
   * and the names outside the category (ruled out, pending, unknown); per room. */
  leak: {
    firm: number;
    inCategory: number;
    names: { name: string; n: number }[];
    rooms: { room: string; firm: number; outside: number }[];
  };
  /** bs8: problem recognition - answers routed outside the category
   * (category_routed adjacent), overall and per buyer room; null without the pool. */
  problem: { all: RateCell; rooms: { room: string; out: RateCell }[] } | null;
  /** The brief (bf1): both branches of the run's decision rules - the largest
   * condition groups routing toward the client and away, with the questions
   * each side appears in. Not read by any detector. null without rules. */
  conditions?: {
    toward: { label: string; rules: number; cells: number; wall: boolean; routes: { name: string; n: number }[] }[];
    away: { label: string; rules: number; cells: number; wall: boolean; routes: { name: string; n: number }[] }[];
    towardCells: number;
    awayCells: number;
    /** bs17: that side's list is reason THEMES (`rules` = statements), as `away.themed`. */
    towardThemed?: true;
    awayThemed?: true;
    /** 2026-11-08: the largest default-shaped group per side ("otherwise" -
     * isDefaultCondition), whatever its rank, for the condition card's default
     * row. The lists above are unchanged (they still carry a default group that
     * ranks into them, since the brief's sentences cite them). */
    defaults?: { side: "you" | "away"; label: string; cells: number; routes: { name: string; n: number }[] }[];
  } | null;  /** bs16: the answers behind the detectors' numerators (in-process only). */
  ex?: ExampleIndex;
}

const AWAY_TOP = 3;

/** Computed from the summary's own load (one data read, no extra fetches):
 * the same pure computes the headline, value and doubt routes cache, with
 * the summary's engine set. */
export async function insightInputs(data: ViewData, request: ViewRequest = {}): Promise<InsightInputs> {
  const engines = request.engines ? { engines: request.engines } : {};
  const roomSet = new Set<string>();
  for (const it of data.intents)
    if (it.situation && viewsOf(it.stage, it.angle).includes("headline")) roomSet.add(it.situation);
  const rooms = [...roomSet].sort().map((room) => {
    const h = computeHeadline(data, { room, ...engines });
    const t = h.brands.find((b) => b.role === "target");
    return { room, decided: t ? t.shareOfDecided : cell(0, h.firmPickInCategory.k), picks: t ? t.chosen.k : 0, firm: h.firmPickInCategory.k, firmAll: h.firmPick.k };
  });
  // Per question (the CELL: a seed and its paraphrases pooled, keyed by the
  // intent like workbench.ts's Question dimension, named by its seed
  // wording): in-category picks by resolved brand, headline pool.
  const resolve = buildResolver(data.dictionary, data.judged);
  const qs = new Map<string, { id: string; text: string; answers: number; picks: Record<string, number> }>();
  const byBrand = new Map<string, { key: string; total: number; byModel: Record<string, number> }>();
  for (const { code, intent, model } of poolOf(data, "headline", engines).rows) {
    const q = qs.get(intent.id) ?? { id: intent.id, text: intent.text, answers: 0, picks: {} };
    q.answers++;
    if (code.outcome === "pick" && code.top_pick) {
      const r = resolve(code.top_pick);
      if (r.status === "active") {
        q.picks[r.key] = (q.picks[r.key] ?? 0) + 1;
        const b = byBrand.get(r.key) ?? { key: r.key, total: 0, byModel: {} };
        b.total++;
        b.byModel[model] = (b.byModel[model] ?? 0) + 1;
        byBrand.set(r.key, b);
      }
    }
    qs.set(intent.id, q);
  }
  const reasons = computeReasons(data, engines);
  const criteria = reasons.types.find((t) => t.key === "criteria_taught");
  const taught =
    criteria && criteria.answers >= MIN_BASE
      ? reasons.codes
          .filter((c) => c.byType.criteria_taught && c.byType.criteria_taught.k > 0)
          .map((c) => ({ code: c.key, rate: c.byType.criteria_taught! }))
          .sort((a, b) => b.rate.k - a.rate.k || a.code.localeCompare(b.code))
      : [];
  // The run's decision rules: the explorer's own compute (sides, dedup and
  // the one run-wide condition grouping, cached under its scope).
  const targetKey = resolve(data.project.brand).key;
  const forms: { seq: string[]; key: string; name: string }[] = [];
  for (const e of data.dictionary) {
    if (e.status !== "active" || e.id === targetKey) continue;
    for (const f of [e.canonical, ...e.aliases]) {
      const seq = famTokens(f);
      if (seq.length) forms.push({ seq, key: e.id, name: e.display_name ?? e.canonical });
    }
  }
  const namesIn = (label: string) => {
    const hay = famTokens(label);
    let best: (typeof forms)[number] | null = null;
    for (const f of forms) if (containsSeq(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
    return best ? { key: best.key, name: best.name } : null;
  };
  // bs17 (2026-11-12, the reasons harmonization): the run's shared rules and
  // reason themes (run_themes.ts) - the same RulesView computeRules served
  // here before, plus the dt4 theme maps. With theme maps, the away groups and
  // the brief's condition branches read THEME rollups (a theme's name, its
  // statements, answers, questions, fixed-situation test and destinations);
  // without them (keyless, a failed pass) the raw groups as before.
  const rt = await sharedRunThemes(data, engines);
  const rules = rt.rules.rules;
  const awayThemed = !!rt.away;
  const towardThemed = !!rt.toward;
  const awayRoll = themeRollup(rt.awayPool, rt.away, rt.rules, rt.sitOf, "away", data.project.brand);
  const towardRoll = themeRollup(rt.towardPool, rt.toward, rt.rules, rt.sitOf, "toward", data.project.brand);
  // bs17 (Tyler 2026-11-12): the away-condition finding DETECTS on the raw
  // condition groups as before - its numbers count exactly the wording it
  // names, and a broad theme (one can cover every away question) never
  // swallows a specific blocker or fixed situation - and its sentence names the
  // theme the wording sits under, so it reads in the Map's vocabulary.
  const themeOf = (label: string) => {
    if (!awayThemed) return undefined;
    const t = awayRoll.find((x) => x.members.includes(label));
    return t && t.label.trim().toLowerCase() !== label.trim().toLowerCase() ? t.label : undefined;
  };
  const awayGroups = rules.groups
    .filter((g) => g.side === "away")
    .sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label))
    .slice(0, AWAY_TOP)
    .map((g) => ({ label: g.label, rules: g.rules, answers: g.answers, cells: g.cells, wall: g.wall, routes: g.routes, names: namesIn(g.label), theme: themeOf(g.label) }));
  const themeTop = (xs: ThemeRollup[]) => xs.slice(0, 6).map((t) => ({ label: t.label, rules: t.rules, cells: t.cells, wall: t.wall, routes: t.routes }));

  // bs8: reason codes on the pooled entity head-to-heads (the summary's own
  // rival resolution: the cell's angle through the dictionary).
  const h2hArgs: InsightInputs["h2hArgs"] = { wins: 0, losses: 0, rivals: {}, codes: [] };
  const codeTally = new Map<string, { code: string; wins: number; losses: number; lossesBy: Record<string, number> }>();
  for (const { code, intent } of poolOf(data, "head_to_head_entity", engines).rows) {
    if (code.outcome !== "pick" || !code.top_pick || code.reasons === null) continue;
    const r = resolve(intent.angle);
    if (r.status !== "active") continue;
    const p = resolve(code.top_pick);
    const side = p.key === targetKey ? "wins" : p.key === r.key ? "losses" : null;
    if (!side) continue;
    h2hArgs[side]++;
    if (side === "losses") h2hArgs.rivals[r.key] = r.name;
    for (const c of new Set(code.reasons)) {
      const t = codeTally.get(c) ?? { code: c, wins: 0, losses: 0, lossesBy: {} };
      t[side]++;
      if (side === "losses") t.lossesBy[r.key] = (t.lossesBy[r.key] ?? 0) + 1;
      codeTally.set(c, t);
    }
  }
  h2hArgs.codes = [...codeTally.values()].sort((a, b) => b.wins - a.wins || a.code.localeCompare(b.code));

  // bs8: firm picks that leave the category (the headline's B5 buckets), run level and per room.
  const runHeadline = computeHeadline(data, engines);
  const outNames = new Map<string, number>();
  for (const x of [...runHeadline.ruledOutPicks, ...runHeadline.pendingPicks, ...runHeadline.notInDictionaryPicks])
    outNames.set(x.name, (outNames.get(x.name) ?? 0) + x.n);
  const leak: InsightInputs["leak"] = {
    firm: runHeadline.firmPick.k,
    inCategory: runHeadline.firmPickInCategory.k,
    names: [...outNames.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n })),
    rooms: rooms.map((r) => ({ room: r.room, firm: r.firmAll, outside: r.firmAll - r.firm })),
  };

  // bs8: problem recognition routed outside the category, per room.
  const routing = poolOf(data, "awareness_routing", engines).rows;
  let problem: InsightInputs["problem"] = null;
  if (routing.length > 0) {
    const byRoom = new Map<string, { out: number; n: number }>();
    for (const { code, intent } of routing) {
      if (!intent.situation) continue;
      const t = byRoom.get(intent.situation) ?? { out: 0, n: 0 };
      t.n++;
      if (code.category_routed === "adjacent") t.out++;
      byRoom.set(intent.situation, t);
    }
    problem = {
      all: cell(routing.filter((r) => r.code.category_routed === "adjacent").length, routing.length),
      rooms: [...byRoom.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([room, t]) => ({ room, out: cell(t.out, t.n) })),
    };
  }

  return {
    ex: buildExampleIndex(data, engines, resolve, targetKey),
    rooms,
    value: computeValue(data, engines),
    doubt: computeDoubt(data, engines),
    questions: [...qs.values()],
    settled: computeSettled(data, engines),
    taught,
    alternatives: computeAlternatives(data, engines),
    away: rules.answers > 0 ? { groups: awayGroups, cells: rules.cellsBySide.away, grouping: rules.grouping } : null,
    enginePicks: [...byBrand.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)),
    h2hArgs,
    leak,
    problem,
    conditions:
      rules.answers > 0
        ? {
            toward: towardThemed ? themeTop(towardRoll) : sideTop(rules.groups, "you"),
            away: awayThemed ? themeTop(awayRoll) : sideTop(rules.groups, "away"),
            ...(towardThemed ? { towardThemed: true as const } : {}),
            ...(awayThemed ? { awayThemed: true as const } : {}),
            towardCells: rules.cellsBySide.you,
            awayCells: rules.cellsBySide.away,
            defaults: (["you", "away"] as const).flatMap((side) => {
              const g = rules.groups
                .filter((x) => x.side === side && isDefaultCondition(x.label))
                .sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label))[0];
              return g ? [{ side, label: g.label, cells: g.cells, routes: g.routes }] : [];
            }),
          }
        : null,
  };
}

/** The largest groups on one side of the rules, for the brief's conditions paragraph. */
function sideTop(groups: RuleGroup[], side: "you" | "away") {
  return groups
    .filter((g) => g.side === side)
    .sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map((g) => ({ label: g.label, rules: g.rules, cells: g.cells, wall: g.wall, routes: g.routes }));
}

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pct = (c: RateCell | number) => {
  const x = typeof c === "number" ? c : rate(c);
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
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
  return `The AI commits to one ${productNoun(category)} in ${pct(commit)} of answers. When it does, ${brand} is the pick ${pct(share)} of the time - ${pctFine(rate(picked))} of all answers.`;
}

const pts = (x: number) => `${Math.round(Math.abs(x) * 100)} points`;
const counts = (c: RateCell) => `${c.k} of ${c.n} (95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%)`;
const apart = (hi: RateCell, lo: RateCell) => hi.low > lo.high;

/** The highest and lowest of the items whose base clears the floor, when
 * their ranges do not overlap. */
function ends<T>(items: T[], cellOf: (t: T) => RateCell): { hi: T; lo: T } | null {
  const ok = items.filter((t) => cellOf(t).n >= MIN_BASE);
  if (ok.length < 2) return null;
  const sorted = [...ok].sort((a, b) => rate(cellOf(b)) - rate(cellOf(a)));
  const hi = sorted[0];
  const lo = sorted[sorted.length - 1];
  return apart(cellOf(hi), cellOf(lo)) ? { hi, lo } : null;
}

type Summary = Omit<BrandSummaryView, "insights" | "verdict">;

function engineSpread(s: Summary, ex?: ExampleIndex): Insight | null {
  const e = ends(s.byEngine, (x) => x.decided);
  if (!e) return null;
  const gap = rate(e.hi.decided) - rate(e.lo.decided);
  return {
    key: "engine_spread",
    kind: "engine",
    title: `${e.hi.label} picks you most, ${e.lo.label} least`,
    body: `Your share of picks is ${pct(e.hi.decided)} on ${e.hi.label} but ${pct(e.lo.decided)} on ${e.lo.label}.`,
    foot: `${e.hi.label}: ${counts(e.hi.decided)}. ${e.lo.label}: ${counts(e.lo.decided)}. Engines with fewer than ${MIN_BASE} decided answers are left out.`,
    look: { pill: "table", label: "Metrics - by engine" },
    effect: gap,
    viz: vizOf([
      withRefs(insightBar(e.hi.label, e.hi.decided), ex?.picks(s.target.key, { models: [e.hi.key] })),
      withRefs(insightBar(e.lo.label, e.lo.decided), ex?.picks(s.target.key, { models: [e.lo.key] })),
    ]),
  };
}

/** Pools the by-engine slices on a key: target picks over in-category picks. */
function pooled(s: Summary, keyOf: (e: Summary["byEngine"][number]) => string): { key: string; decided: RateCell; engines: number }[] {
  const m = new Map<string, { k: number; n: number; engines: number }>();
  for (const e of s.byEngine) {
    const k = keyOf(e);
    const t = m.get(k) ?? { k: 0, n: 0, engines: 0 };
    t.k += e.decided.k;
    t.n += e.decided.n;
    t.engines++;
    m.set(k, t);
  }
  return [...m.entries()].map(([key, t]) => ({ key, decided: cell(t.k, t.n), engines: t.engines }));
}

function modeGap(s: Summary, ex?: ExampleIndex): Insight | null {
  const modes = pooled(s, (e) => e.mode);
  const search = modes.find((m) => m.key === "search");
  const instinct = modes.find((m) => m.key === "instinct");
  if (!search || !instinct || search.decided.n < MIN_BASE || instinct.decided.n < MIN_BASE) return null;
  const [hi, lo] = rate(search.decided) >= rate(instinct.decided) ? [search, instinct] : [instinct, search];
  if (!apart(hi.decided, lo.decided)) return null;
  const searchWins = hi === search;
  return {
    key: "engine_mode",
    kind: "engine",
    title: searchWins ? "Web search helps you" : "Web search hurts you",
    body: `With web search, your share of picks is ${pct(search.decided)}; without web search, ${pct(instinct.decided)}.`,
    foot: `Search (${search.engines} engines): ${counts(search.decided)}. Instinct (${instinct.engines} engines): ${counts(instinct.decided)}.`,
    look: { pill: "table", label: "Metrics - by mode" },
    effect: rate(hi.decided) - rate(lo.decided),
    viz: vizOf([
      withRefs(insightBar("With web search", search.decided), ex?.picks(s.target.key, { models: modelsOf(s, (e) => e.mode === "search") })),
      withRefs(insightBar("Without web search", instinct.decided), ex?.picks(s.target.key, { models: modelsOf(s, (e) => e.mode === "instinct") })),
    ]),
  };
}

function vendorGap(s: Summary, ex?: ExampleIndex): Insight | null {
  const e = ends(pooled(s, (x) => x.vendor), (x) => x.decided);
  if (!e) return null;
  return {
    key: "engine_vendor",
    kind: "engine",
    title: `${e.hi.key} favors you most, ${e.lo.key} least`,
    body: `Across each company's AI assistants, your share of picks is ${pct(e.hi.decided)} on ${e.hi.key} and ${pct(e.lo.decided)} on ${e.lo.key}.`,
    foot: `${e.hi.key} (${e.hi.engines} engines): ${counts(e.hi.decided)}. ${e.lo.key} (${e.lo.engines} engines): ${counts(e.lo.decided)}.`,
    look: { pill: "table", label: "Metrics - by vendor" },
    effect: rate(e.hi.decided) - rate(e.lo.decided),
    viz: vizOf([
      withRefs(insightBar(e.hi.key, e.hi.decided), ex?.picks(s.target.key, { models: modelsOf(s, (x) => x.vendor === e.hi.key) })),
      withRefs(insightBar(e.lo.key, e.lo.decided), ex?.picks(s.target.key, { models: modelsOf(s, (x) => x.vendor === e.lo.key) })),
    ]),
  };
}

function roomWin(inp: InsightInputs, targetKey: string): Insight | null {
  const e = ends(inp.rooms, (r) => r.decided);
  if (!e) return null;
  return {
    key: "room_win",
    kind: "room",
    title: `Strongest with ${e.hi.room}, weakest with ${e.lo.room}`,
    body: `Your share of picks is ${pct(e.hi.decided)} for ${e.hi.room} but ${pct(e.lo.decided)} for ${e.lo.room}.`,
    foot: `${e.hi.room}: ${counts(e.hi.decided)}. ${e.lo.room}: ${counts(e.lo.decided)}. Open-choice questions asked for each buyer; rooms under ${MIN_BASE} decided answers left out.`,
    look: { pill: "buyers", label: "Buyers" },
    effect: rate(e.hi.decided) - rate(e.lo.decided),
    viz: vizOf([
      withRefs(insightBar(lbl(e.hi.room), e.hi.decided), inp.ex?.picks(targetKey, { room: e.hi.room })),
      withRefs(insightBar(lbl(e.lo.room), e.lo.decided), inp.ex?.picks(targetKey, { room: e.lo.room })),
    ]),
  };
}

function roomValue(inp: InsightInputs, brand: string): Insight | null {
  const rows = (inp.value?.rooms ?? []).filter((r) => r.key !== "");
  const e = ends(rows, (r) => r.worth.yes);
  if (!e) return null;
  return {
    key: "room_value",
    kind: "room",
    title: `Worth it most for ${e.hi.label}, least for ${e.lo.label}`,
    body: `Asked whether ${brand} is worth paying more for, the AI says yes ${pct(e.hi.worth.yes)} of the time for ${e.hi.label} and ${pct(e.lo.worth.yes)} for ${e.lo.label}.`,
    foot: `${e.hi.label}: ${counts(e.hi.worth.yes)}. ${e.lo.label}: ${counts(e.lo.worth.yes)}.`,
    look: { pill: "stations", station: "value", label: "Stations - Value" },
    effect: rate(e.hi.worth.yes) - rate(e.lo.worth.yes),
    viz: vizOf([
      withRefs(insightBar(lbl(e.hi.label), e.hi.worth.yes), inp.ex?.value(e.hi.key, "yes")),
      withRefs(insightBar(lbl(e.lo.label), e.lo.worth.yes), inp.ex?.value(e.lo.key, "yes")),
    ]),
  };
}

function rivalOpen(s: Summary, ex?: ExampleIndex): Insight | null {
  const top = s.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
  if (!top || s.firmPickInCategory.k < MIN_BASE) return null;
  const [hi, lo] = rate(top.shareOfDecided) > rate(s.target.shareOfDecided) ? [top.shareOfDecided, s.target.shareOfDecided] : [s.target.shareOfDecided, top.shareOfDecided];
  if (!apart(hi, lo)) return null;
  return {
    key: "rival_open",
    kind: "rival",
    title: rate(top.shareOfDecided) > rate(s.target.shareOfDecided) ? `${top.name} out-picks you` : `You lead ${top.name}`,
    body: `When buyers ask what to buy, ${top.name} takes ${pct(top.shareOfDecided)} of the picks - you take ${pct(s.target.shareOfDecided)}.`,
    foot: `${top.chosen.k} picks to your ${s.target.chosen.k}, of ${s.firmPickInCategory.k} decided open-choice answers.`,
    look: { pill: "rivals", label: "Rivals" },
    effect: Math.abs(rate(top.shareOfDecided) - rate(s.target.shareOfDecided)),
    viz: vizOf([
      withRefs(insightBar(top.name, top.shareOfDecided), ex?.picks(top.key)),
      withRefs(insightBar(s.brand, s.target.shareOfDecided, undefined, true), ex?.picks(s.target.key)),
    ]),
  };
}

function rivalHeadToHead(s: Summary, ex?: ExampleIndex): Insight | null {
  const ok = s.headToHead.filter((r) => r.winOfDecided.n >= MIN_BASE);
  if (ok.length === 0) return null;
  const closest = [...ok].sort((a, b) => Math.abs(rate(a.winOfDecided) - 0.5) - Math.abs(rate(b.winOfDecided) - 0.5))[0];
  const worst = [...ok].sort((a, b) => rate(a.winOfDecided) - rate(b.winOfDecided))[0];
  const foot = (r: typeof closest) =>
    `vs ${r.rival}: won ${r.won.k}, lost ${r.lost.k} - 95% range ${Math.round(r.winOfDecided.low * 100)}-${Math.round(r.winOfDecided.high * 100)}%`;
  if (closest.key === worst.key) {
    return {
      key: "rival_h2h",
      kind: "rival",
      title: `Direct matchup with ${worst.rival}`,
      body: `Asked to choose between you and ${worst.rival}, the AI picks you ${pct(worst.winOfDecided)} of the time it picks one of you.`,
      foot: `${foot(worst)}. Matchups under ${MIN_BASE} decided answers left out.`,
      look: { pill: "rivals", label: "Rivals - head-to-head" },
      effect: Math.abs(rate(worst.winOfDecided) - 0.5),
      viz: h2hBars(ok, worst.key, undefined, ex),
    };
  }
  return {
    key: "rival_h2h",
    kind: "rival",
    title: `Hardest direct matchup: ${worst.rival}`,
    body: `Asked to compare you with ${worst.rival} directly, the AI picks you ${pct(worst.winOfDecided)} of the time it picks one of you; your best matchup is ${closest.rival}, at ${pct(closest.winOfDecided)}.`,
    foot: `${foot(worst)}. ${foot(closest)}. Matchups under ${MIN_BASE} decided answers left out.`,
    look: { pill: "rivals", label: "Rivals - head-to-head" },
    effect: Math.abs(rate(closest.winOfDecided) - rate(worst.winOfDecided)),
    viz: h2hBars(ok, worst.key, closest.key, ex),
  };
}

/** One bar per named rival's direct-matchup record, the hardest first and
 * marked; the best matchup always kept; at most four. */
function h2hBars(ok: Summary["headToHead"], hardest: string, keep?: string, ex?: ExampleIndex): InsightBar[] | undefined {
  const asc = [...ok].sort((a, b) => rate(a.winOfDecided) - rate(b.winOfDecided) || a.rival.localeCompare(b.rival));
  let rows = asc.slice(0, 4);
  const best = keep ? asc.find((r) => r.key === keep) : undefined;
  if (best && !rows.includes(best)) rows = [...rows.slice(0, 3), best];
  return vizOf(rows.map((r) => withRefs(insightBar(`vs ${r.rival}`, r.winOfDecided, undefined, r.key === hardest), ex?.h2hWins({ rivalKey: r.key }))));
}

function argument(s: Summary, ex?: ExampleIndex): Insight | null {
  const best = s.reasonLift[0];
  const worst = s.reasonLift.length > 1 ? s.reasonLift[s.reasonLift.length - 1] : undefined;
  if (!best || !worst) return null;
  return {
    key: "argument",
    kind: "argument",
    title: `${best.code.charAt(0).toUpperCase()}${best.code.slice(1)} comes up when you win`,
    body: `${best.code.charAt(0).toUpperCase()}${best.code.slice(1)} comes up ${pts(best.lift)} ${best.lift >= 0 ? "more" : "less"} often in answers that pick you than in answers that pick a rival. Answers that pick a rival bring up ${worst.code} ${worst.lift <= 0 ? "more" : "less"} (${pts(worst.lift)}).`,
    foot: `${best.code}: ${pct(best.wins)} of ${best.wins.n} wins vs ${pct(best.others)} of ${best.others.n} rival picks. ${worst.code}: ${pct(worst.wins)} vs ${pct(worst.others)}.`,
    look: { pill: "why", label: "Why" },
    effect: best.lift - worst.lift,
    viz: vizOf([
      withRefs(insightBar("In your picks", best.wins, undefined, true), ex?.argued(best.code, "you")),
      withRefs(insightBar("In rivals' picks", best.others), ex?.argued(best.code, "others")),
    ]),
  };
}

function doubtRollup(s: Summary, ex?: ExampleIndex): Insight | null {
  const b = s.buyersDoubt;
  const c = s.customersDoubt;
  if (!b && !c) return null;
  const raw = [b && `buyers told to go ahead ${pct(b.proceed)}`, c && `customers told to stay ${pct(c.keep)}`].filter(Boolean).join(" - ");
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  const body = [
    b && `When a buyer voices a worry about ${s.brand}, the AI agrees it is warranted ${pct(b.agree)} of the time it takes a side.`,
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
      b && withRefs(insightBar("Buyers told to go ahead", b.proceed), ex?.doubt("objections", (r) => r.code.proceed_or_avoid === "proceed")),
      b && withRefs(insightBar("Agrees with buyers' worries", b.agree), ex?.doubt("objections", (r) => r.code.premise_verdict === "confirms")),
      c && withRefs(insightBar("Customers told to stay", c.keep), ex?.doubt("keep", (r) => r.code.keep_or_leave === "keep")),
      c && withRefs(insightBar("Customers told to leave", c.leave), ex?.doubt("keep", (r) => r.code.keep_or_leave === "leave")),
    ]),
  };
}

function doubtWorry(inp: InsightInputs): Insight | null {
  type Cand = { row: WorryRow<string>; pool: RateCell; who: "buyer" | "customer" };
  const cands: Cand[] = [];
  const o = inp.doubt.objections;
  const k = inp.doubt.keepOrLeave;
  if (o) for (const row of o.rows) cands.push({ row, pool: o.premise.confirms, who: "buyer" });
  if (k) for (const row of k.rows) cands.push({ row, pool: k.premise.confirms, who: "customer" });
  const ok = cands.filter((c) => c.row.premise.confirms.n >= MIN_BASE);
  if (ok.length < 2) return null;
  const top = [...ok].sort((a, b) => rate(b.row.premise.confirms) - rate(a.row.premise.confirms))[0];
  const gap = rate(top.row.premise.confirms) - rate(top.pool);
  // The pool contains the worry, so the test is the worry's range clearing the pool's rate.
  if (top.row.premise.confirms.low <= rate(top.pool)) return null;
  return {
    key: "doubt_worry",
    kind: "doubt",
    title: `The worry it backs most: ${top.row.concern}`,
    body: `When a ${top.who} raises "${top.row.concern}", the AI agrees it is warranted ${pct(top.row.premise.confirms)} of the time it takes a side - against ${pct(top.pool)} across all ${top.who}s' worries.`,
    foot: `${top.row.concern}: ${counts(top.row.premise.confirms)}. All ${top.who} worries: ${counts(top.pool)}. Worries under ${MIN_BASE} judged answers left out.`,
    look: { pill: "stations", station: top.who === "buyer" ? "doubts" : "customer_base", label: top.who === "buyer" ? "Stations - Doubts" : "Stations - Customers" },
    effect: gap,
    viz: vizOf([
      withRefs(
        insightBar(lbl(top.row.concern), top.row.premise.confirms, undefined, true),
        inp.ex?.doubt(top.who === "buyer" ? "objections" : "keep", (r) => worryKey(r) === top.row.key && r.code.premise_verdict === "confirms")
      ),
      withRefs(insightBar(`All ${top.who}s' worries`, top.pool), inp.ex?.doubt(top.who === "buyer" ? "objections" : "keep", (r) => r.code.premise_verdict === "confirms")),
    ]),
  };
}

function funnelDrop(s: Summary, ex?: ExampleIndex): Insight | null {
  if (s.answers < MIN_BASE) return null;
  const named = rate(s.target.mentioned);
  const rec = rate(s.target.recommended);
  const picked = rate(s.target.chosen);
  const steps = [
    { from: "named", to: "recommended", a: named, b: rec },
    { from: "recommended", to: "picked", a: rec, b: picked },
  ];
  const worst = steps.sort((x, y) => y.a - y.b - (x.a - x.b))[0];
  const drop = worst.a - worst.b;
  if (drop <= 0) return null;
  return {
    key: "funnel",
    kind: "funnel",
    title: `The drop is from ${worst.from} to ${worst.to}`,
    body: `When buyers ask what to buy, you are ${worst.from} in ${pct(worst.a)} of answers but ${worst.to} in ${worst.to === "picked" ? pctFine(worst.b) : pct(worst.b)} - the biggest step down in the funnel.`,
    foot: `Named ${counts(s.target.mentioned)}; recommended ${counts(s.target.recommended)}; picked ${counts(s.target.chosen)}.`,
    look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
    effect: drop,
    viz: vizOf([
      withRefs(insightBar("Named", named), ex?.named(s.target.key)),
      withRefs(insightBar("Recommended", rec, undefined, worst.to === "recommended"), ex?.recommended(s.target.key)),
      withRefs(insightBar("Picked", picked, pctFine(picked), worst.to === "picked"), ex?.picks(s.target.key)),
    ]),
  };
}

/** The prompted head-to-head record pooled over the entity rivals, with the
 * hardest matchup (lowest win share) that clears the floor. */
function promptedRecord(s: Summary): { pooled: RateCell; won: number; lost: number; hardest: Summary["headToHead"][number] | null } | null {
  const won = s.headToHead.reduce((a, r) => a + r.won.k, 0);
  const lost = s.headToHead.reduce((a, r) => a + r.lost.k, 0);
  if (won + lost < MIN_BASE) return null;
  const ok = s.headToHead.filter((r) => r.winOfDecided.n >= MIN_BASE);
  const hardest = ok.length ? [...ok].sort((a, b) => rate(a.winOfDecided) - rate(b.winOfDecided))[0] : null;
  return { pooled: cell(won, won + lost), won, lost, hardest };
}

function promptedVsOpen(s: Summary, ex?: ExampleIndex): Insight | null {
  const rec = promptedRecord(s);
  const open = s.target.shareOfDecided;
  if (!rec || open.n < MIN_BASE) return null;
  const gap = rate(rec.pooled) - rate(open);
  if (Math.abs(gap) < 0.15) return null;
  if (!(gap > 0 ? apart(rec.pooled, open) : apart(open, rec.pooled))) return null;
  const hard = rec.hardest;
  const hardText = hard ? ` (${pct(hard.winOfDecided)} against ${hard.rival})` : "";
  return {
    key: "prompted_vs_open",
    kind: "rival",
    title: gap > 0 ? "Wins when compared directly, loses when buyers ask what to buy" : "Wins when buyers ask what to buy, loses when compared directly",
    body:
      gap > 0
        ? `Asked to compare you with a rival directly, the AI picks you in ${pct(rec.pooled)} of matchups${hardText}, but when buyers ask what to buy you take ${pct(open)} of the picks.`
        : `When buyers ask what to buy you take ${pct(open)} of the picks, but asked to compare you with a rival directly, the AI picks you in only ${pct(rec.pooled)} of matchups${hardText}.`,
    foot: `Head-to-heads: won ${rec.won}, lost ${rec.lost} - ${counts(rec.pooled)}${hard ? `; vs ${hard.rival} ${counts(hard.winOfDecided)}` : ""}. Open choice: ${counts(open)}.`,
    look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
    effect: Math.abs(gap),
    viz: vizOf([
      withRefs(insightBar("Direct matchups won", rec.pooled), ex?.h2hWins()),
      withRefs(insightBar("Share of picks when buyers ask", open, undefined, true), ex?.picks(s.target.key)),
      hard && withRefs(insightBar(`Against ${hard.rival}`, hard.winOfDecided), ex?.h2hWins({ rivalKey: hard.key })),
    ]),
  };
}

/** The room the target's open-choice picks come from most. */
function roomConcentration(s: Summary, inp: InsightInputs) {
  const total = s.target.chosen.k;
  if (total < MIN_BASE || inp.rooms.length < 2) return null;
  const top = [...inp.rooms].sort((a, b) => b.picks - a.picks || a.room.localeCompare(b.room))[0];
  const share = top.picks / total;
  if (share < 0.5) return null;
  const outside = cell(total - top.picks, Math.max(0, s.firmPickInCategory.k - top.firm));
  return { top, share, total, outside, rooms: inp.rooms.length };
}

function pickConcentrationRoom(s: Summary, inp: InsightInputs): Insight | null {
  const c = roomConcentration(s, inp);
  if (!c) return null;
  return {
    key: "pick_concentration_room",
    kind: "room",
    title: `Your picks come from ${c.top.room}`,
    body: `${pct(c.share)} of the times the AI picks ${s.brand} when buyers ask what to buy come from one buying situation, ${c.top.room} - there you take ${pct(c.top.decided)} of the picks, everywhere else ${pct(c.outside)}.`,
    foot: `${c.top.picks} of ${c.total} picks from ${c.top.room} (one of ${c.rooms} rooms). Inside: ${counts(c.top.decided)}. Outside: ${counts(c.outside)}.`,
    look: { pill: "buyers", label: "Buyers" },
    effect: c.share - 1 / c.rooms,
    viz: vizOf([
      withRefs(insightBar(`Your picks from ${lbl(c.top.room, 32)}`, c.share, undefined, true), inp.ex?.picks(s.target.key, { room: c.top.room })),
      withRefs(insightBar(`Share of picks there`, c.top.decided), inp.ex?.picks(s.target.key, { room: c.top.room })),
      withRefs(insightBar("Share of picks elsewhere", c.outside), inp.ex?.picks(s.target.key, { notRoom: c.top.room })),
    ]),
  };
}

/** "Ruffles'" / "Max's" - possessive of a brand name. */
const poss = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

const shorten = (t: string, n = 80) => {
  const x = t.replace(/\s+/g, " ").trim();
  return x.length <= n ? x : `${x.slice(0, n - 1).replace(/\s+\S*$/, "").replace(/[\s.,;:!?-]+$/, "")}...`;
};

/** The question (cell) a brand's picks concentrate in, for the target and the top rival. */
function questionConcentration(s: Summary, inp: InsightInputs, key: string) {
  const total = inp.questions.reduce((a, q) => a + (q.picks[key] ?? 0), 0);
  if (total < MIN_BASE || inp.questions.length < 2) return null;
  const top = [...inp.questions].sort((a, b) => (b.picks[key] ?? 0) - (a.picks[key] ?? 0) || a.id.localeCompare(b.id))[0];
  const k = top.picks[key] ?? 0;
  const share = k / total;
  return share >= 0.3 ? { top, k, total, share, n: inp.questions.length } : null;
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
  const q = shorten(c.top.text);
  return {
    key: "pick_concentration_question",
    kind: "question",
    title: best.isTarget ? "One question carries your picks" : `One question carries ${best.who}'s picks`,
    body: `${pct(c.share)} of ${best.isTarget ? "your" : `${best.who}'s`} picks come from one question: "${q}"`,
    foot: `${c.k} of ${c.total} picks of ${best.who} from this question (one of ${c.n} open-choice questions, ${c.top.answers} answers, a seed and its paraphrases pooled).`,
    look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
    effect: c.share - 1 / c.n,
    viz: vizOf([
      withRefs(insightBar("Picks from this question", c.share, undefined, true), inp.ex?.picks(best.key, { intentId: c.top.id })),
      insightBar("If spread evenly", 1 / c.n),
    ]),
  };
}

function agreedYetStay(inp: InsightInputs): Insight | null {
  type C = { who: "buyer" | "customer"; kind: "objections" | "keep"; confirmed: RateCell; given: RateCell; verb: string };
  const cands: C[] = [];
  const o = inp.doubt.objections;
  const k = inp.doubt.keepOrLeave;
  if (o) cands.push({ who: "buyer", kind: "objections", confirmed: o.premise.confirms, given: o.matrix.confirms.proceed, verb: "go ahead" });
  if (k) cands.push({ who: "customer", kind: "keep", confirmed: k.premise.confirms, given: k.matrix.confirms.keep, verb: "stay" });
  const ok = cands.filter((c) => c.confirmed.n >= MIN_BASE && c.given.n >= MIN_BASE && rate(c.confirmed) >= 0.5 && rate(c.given) >= 0.3);
  if (ok.length === 0) return null;
  const best = ok.sort((a, b) => rate(b.confirmed) * rate(b.given) - rate(a.confirmed) * rate(a.given))[0];
  return {
    key: "agreed_yet_stay",
    kind: "doubt",
    title: best.who === "buyer" ? "Agrees with the worry, still says go ahead" : "Agrees with the worry, still says stay",
    body: `When a ${best.who} raises a worry, the AI agrees it is warranted ${pct(best.confirmed)} of the time it takes a side - and in ${pct(best.given)} of those answers still tells them to ${best.verb}.`,
    foot: `Agrees: ${counts(best.confirmed)}. Of those, ${best.verb}: ${counts(best.given)}.`,
    look: { pill: "stations", station: best.who === "buyer" ? "doubts" : "customer_base", label: best.who === "buyer" ? "Stations - Doubts" : "Stations - Customers" },
    effect: rate(best.confirmed) * rate(best.given),
    viz: vizOf([
      withRefs(insightBar("Agrees the worry is warranted", best.confirmed), inp.ex?.doubt(best.kind, (r) => r.code.premise_verdict === "confirms")),
      withRefs(
        insightBar(`Still told to ${best.verb}`, best.given, undefined, true),
        inp.ex?.doubt(best.kind, (r) => r.code.premise_verdict === "confirms" && (best.kind === "objections" ? r.code.proceed_or_avoid === "proceed" : r.code.keep_or_leave === "keep"))
      ),
    ]),
  };
}

function taughtVsWinning(s: Summary, inp: InsightInputs): Insight | null {
  if (inp.taught.length === 0 || s.reasonLift.length === 0) return null;
  const top5 = inp.taught.slice(0, 5);
  const taughtSet = new Set(top5.map((t) => t.code));
  const best = s.reasonLift[0];
  const untaught = best.lift > 0 && !taughtSet.has(best.code) && apart(best.wins, best.others) ? best : null;
  const losing = top5
    .map((t) => s.reasonLift.find((l) => l.code === t.code))
    .filter((l): l is NonNullable<typeof l> => !!l && l.lift < 0 && apart(l.others, l.wins))
    .sort((a, b) => a.lift - b.lift)[0] ?? null;
  if (!untaught && !losing) return null;
  const taughtOf = (code: string) => inp.taught.find((t) => t.code === code)?.rate;
  const parts: string[] = [];
  const foot: string[] = [];
  if (untaught) {
    parts.push(`${untaught.code} comes up ${pts(untaught.lift)} more often when you win but is not among the five criteria the AI teaches buyers to weigh`);
    const tr = taughtOf(untaught.code);
    foot.push(`${untaught.code}: ${pct(untaught.wins)} of wins vs ${pct(untaught.others)} of rival picks; taught in ${tr ? counts(tr) : "no"} criteria answers.`);
  }
  if (losing) {
    parts.push(`${untaught ? "it" : "the AI"} teaches buyers to weigh ${losing.code}, which shows up more when a rival is picked (-${pts(losing.lift)})`);
    foot.push(`${losing.code}: ${pct(losing.wins)} of wins vs ${pct(losing.others)} of rival picks; taught in ${counts(taughtOf(losing.code)!)}.`);
  }
  const body = parts.join("; ");
  const effect = Math.max(untaught ? Math.abs(untaught.lift) : 0, losing ? Math.abs(losing.lift) : 0);
  return {
    key: "taught_vs_winning",
    kind: "argument",
    title: untaught ? `${untaught.code} wins but is not taught` : `The AI teaches ${losing!.code}, which favors rivals`,
    body: `${body.charAt(0).toUpperCase()}${body.slice(1)}.`,
    foot: `${foot.join(" ")} Top five taught: ${top5.map((t) => t.code).join(", ")}.`,
    look: { pill: "why", label: "Why" },
    effect,
    viz: (() => {
      const x = untaught ?? losing!;
      const tr = taughtOf(x.code);
      return vizOf([
        withRefs(insightBar("In your picks", x.wins, undefined, true), inp.ex?.argued(x.code, "you")),
        withRefs(insightBar("In rivals' picks", x.others), inp.ex?.argued(x.code, "others")),
        tr && insightBar("In what the AI teaches buyers", tr),
      ]);
    })(),
  };
}

function valueInHouse(inp: InsightInputs, brand: string): Insight | null {
  const v = inp.value;
  if (!v || v.ownRung.n < MIN_BASE) return null;
  const own = rate(v.ownRung);
  const riv = rate(v.recommendsInstead);
  if (own < 0.3 && riv < 0.3) return null;
  const inHouse = own >= riv;
  const top = v.instead.find((i) => i.own === inHouse);
  const topText = top ? ` - most often ${top.name}` : "";
  return {
    key: "value_in_house",
    kind: "value",
    title: inHouse ? "The value doubts stay in-house" : "The value doubts go to rivals",
    body: inHouse
      ? `When the AI doubts ${brand} is worth the price, ${pct(own)} of those answers point to its own cheaper option${topText}; ${pct(riv)} point to a rival.`
      : `When the AI doubts ${brand} is worth the price, ${pct(riv)} of those answers point to a rival${topText}; ${pct(own)} point to its own cheaper option.`,
    foot: `Of answers saying no or it depends: own option ${counts(v.ownRung)}; a rival ${counts(v.recommendsInstead)}.${top ? ` ${top.name}: ${top.n}.` : ""}`,
    look: { pill: "stations", station: "value", label: "Stations - Value" },
    effect: Math.abs(own - riv),
    viz: vizOf([insightBar("Your own cheaper option", own, undefined, inHouse), insightBar("A rival", riv, undefined, !inHouse)]),
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
  if (defend.n < MIN_BASE || confirms.n < MIN_BASE || rate(defend) < 0.5 || rate(confirms) < 0.5) return null;
  return {
    key: "advocacy_vs_objection",
    kind: "doubt",
    title: "Defends you when asked, concedes when asked neutrally",
    body: `Asked to defend the brand, the AI strengthens the case ${pct(defend)} of the time; asked about buyers' worries, it agrees they are warranted ${pct(confirms)} of the time.`,
    foot: `Advocacy: ${counts(defend)}. Buyers' worries agreed: ${counts(confirms)}.`,
    look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    effect: Math.min(rate(defend), rate(confirms)) - 0.5,
    viz: vizOf([
      insightBar("Makes the case when asked", defend),
      withRefs(insightBar("Agrees with buyers' worries", confirms), inp.ex?.doubt("objections", (r) => r.code.premise_verdict === "confirms")),
    ]),
  };
}

/* ------------------------------ bs7: switching ----------------------------- */

/** A capture share this low on rival leavers who hear about you is "never taken". */
const LEAVER_NEVER = 0.05;
/** The share of leavers' answers naming you before "heard about" is the read. */
const LEAVER_NAMED = 0.5;

function leaverCapture(inp: InsightInputs): Insight | null {
  const o = inp.alternatives.offensive;
  if (!o || o.answers < MIN_BASE) return null;
  const t = o.overall;
  const you = o.captors.find((c) => c.role === "target") ?? null;
  const takers = o.captors.filter((c) => c.chosen.k > 0);
  const decided = takers.length ? takers[0].shareOfDecided.n : 0;
  const lead = takers[0] ?? null;
  // Strength: you are the brand rival leavers are sent to most.
  if (you && lead && lead.role === "target" && decided >= MIN_BASE && takers.length >= 2) {
    const sources = o.rows.filter((r) => r.answers >= MIN_BASE && r.key !== "generic");
    const src = [...sources].sort((a, b) => rate(b.captured) - rate(a.captured) || a.rival.localeCompare(b.rival))[0];
    const second = takers.find((c) => c.role !== "target");
    return {
      key: "leaver_capture",
      kind: "switching",
      title: "Rivals' customers come to you",
      body: `When a rival's customer asks what to switch to, the AI picks you in ${pct(t.captured)} of answers - you take ${pct(you.shareOfDecided)} of the picks${src ? ` - most often for customers leaving ${src.rival}, at ${pct(src.captured)}` : ""}.`,
      foot: `Picked ${counts(t.captured)}; of the switching customers' picks ${counts(you.shareOfDecided)}.${second ? ` Next: ${second.name}, ${second.chosen.k}.` : ""}${src ? ` Leaving ${src.rival}: ${counts(src.captured)}.` : ""}`,
      look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
      effect: rate(you.shareOfDecided) - 1 / takers.length,
      viz: vizOf([
        insightBar("Picked", t.captured),
        insightBar("Share of the picks", you.shareOfDecided, undefined, true),
        src && insightBar(`Leaving ${src.rival}`, src.captured),
      ]),
    };
  }
  // Tension: leavers hear about you and are almost never told to take you.
  if (rate(t.named) >= LEAVER_NAMED && rate(t.captured) < LEAVER_NEVER && apart(t.named, t.captured)) {
    const other = takers.find((c) => c.role !== "target") ?? null;
    return {
      key: "leaver_capture",
      kind: "switching",
      title: "Rivals' customers hear about you, then go elsewhere",
      body: `When a rival's customer asks what to switch to, the AI names you in ${pct(t.named)} of answers and recommends you in ${pct(t.recommended)}, but picks you in ${pct(t.captured)}${other ? ` - ${other.name} takes the most, ${pct(other.shareOfDecided)} of the picks` : ""}.`,
      foot: `Named ${counts(t.named)}; recommended ${counts(t.recommended)}; picked ${counts(t.captured)}.${other ? ` ${other.name}: ${other.chosen.k} of ${other.shareOfDecided.n} decided.` : ""}`,
      look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
      effect: rate(t.named) - rate(t.captured),
      viz: vizOf([insightBar("Named", t.named), insightBar("Recommended", t.recommended), insightBar("Picked", t.captured, undefined, true)]),
    };
  }
  return null;
}

function ownDefense(inp: InsightInputs): Insight | null {
  const d = inp.alternatives.defensive;
  if (!d || d.answers < MIN_BASE) return null;
  const top = d.destinations[0];
  const keep = d.verdicts.keep;
  if (!top || rate(top.offered) < 0.5 || rate(keep) >= 0.5) return null;
  // Exits shown about as often as the top one are named with it (a list of
  // alternatives often carries the same two or three brands every time).
  const tied = d.destinations.filter((x) => rate(top.offered) - rate(x.offered) <= 0.05).slice(0, 3);
  const names = tied.map((x) => x.name);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    key: "own_defense",
    kind: "switching",
    title: `${who} ${names.length === 1 ? "is the exit" : "are the exits"} shown to your customers`,
    body: `Asked what else to consider, your own customers ${
      keep.k === 0 && d.verdicts.leave.k === 0
        ? `are never told to stay or to leave,`
        : `are told to stay in ${pct(keep)} of answers and to leave in ${pct(d.verdicts.leave)}, the AI takes no side in ${pct(d.verdicts.undecided)},`
    } and ${names.length === 1 ? `${who} appears in ${pct(top.offered)}` : `${who} each appear in at least ${pct(tied[tied.length - 1].offered)}`}.`,
    foot: `Stay ${counts(keep)}; leave ${counts(d.verdicts.leave)}; no side ${counts(d.verdicts.undecided)}; another brand shown ${counts(d.offersExit)}; ${tied.map((x) => `${x.name} ${x.offered.k} (${x.onKeep} on stay answers)`).join("; ")}.`,
    look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    // One rival as the default exit, held down by how often the AI still says stay.
    effect: Math.min(rate(top.offered), 1 - rate(keep)) - 0.5,
    viz: vizOf([insightBar("Told to stay", keep, undefined, true), ...tied.map((x) => insightBar(`${x.name} shown`, x.offered))]),
  };
}

/* ------------------------------ bs7: conditions ---------------------------- */

/** Condition counts are lower bounds (wordings the grouping did not join are
 * left out), so the floor is on grouped rules, not MIN_BASE answers. */
const AWAY_MIN_RULES = 15;
/** A brand the AI almost never picks in the open choice. */
const BLOCKER_SHARE = 0.02;

function awayCondition(s: Summary, inp: InsightInputs): Insight | null {
  const a = inp.away;
  if (!a || a.cells === 0) return null;
  const g = a.groups[0];
  if (!g || g.rules < AWAY_MIN_RULES) return null;
  const spread = g.cells / a.cells;
  const to = g.routes[0];
  let blocker = "";
  let blockerFoot = "";
  if (g.names && s.firmPickInCategory.k >= MIN_BASE && g.names.key !== s.target.key) {
    const b = s.brands.find((x) => x.key === g.names!.key);
    const share = b ? b.shareOfDecided : cell(0, s.firmPickInCategory.k);
    if (rate(share) < BLOCKER_SHARE) {
      blocker = `. It names ${g.names.name}, a brand with ${pct(share)} of the picks when buyers ask what to buy, so it blocks you without winning for it`;
      blockerFoot = ` ${g.names.name} in the open choice: ${counts(share)}.`;
    }
  }
  // The wall variant: the top group is possession-shaped, or a later one of
  // the top groups that clears the same floor is.
  const laterWall = !g.wall ? a.groups.slice(1).find((x) => x.wall && x.rules >= AWAY_MIN_RULES) ?? null : null;
  const wall = g.wall
    ? blocker
      ? ""
      : " - a situation the buyer is already in, not an argument to answer"
    : laterWall
      ? `; the largest fixed situation among them, "${shorten(laterWall.label, 60)}", comes up in ${pct(laterWall.cells / a.cells)} of them - a situation the buyer is already in, not an argument to answer`
      : "";
  const wallFoot = laterWall ? ` "${laterWall.label}": at least ${laterWall.rules} rules across ${laterWall.cells} questions.` : "";
  const toFoot = to ? `; to ${to.name} ${to.n}` : "";
  const lower = `Counts are lower bounds: ${a.grouping === "stems" ? "conditions are grouped by their words, and" : ""} wordings the grouping did not join are left out.`;
  const underTheme = g.theme ? `, one of the reasons grouped as "${shorten(g.theme, 60)}"` : "";
  return {
    key: "away_condition",
    kind: "condition",
    title: g.wall ? `A fixed situation sends buyers away: "${shorten(g.label, 60)}"` : `What sends buyers away most: "${shorten(g.label, 60)}"`,
    body: `The condition that most often sends buyers away from you is "${shorten(g.label)}"${underTheme}${to ? `, and the AI sends them to ${to.name}` : ""}; it comes up in ${pct(spread)} of the questions where the AI gives any condition that sends buyers away${blocker}${wall}.`,
    foot: `At least ${g.rules} rules in ${g.answers} answers across ${g.cells} of ${a.cells} questions where the AI gives a condition that sends buyers away${toFoot}.${blockerFoot}${wallFoot} ${lower}`,
    look: { pill: "why", label: "Why - decision rules" },
    effect: spread,
    viz: vizOf(a.groups.map((x, i) => insightBar(lbl(x.label, 40), x.cells / a.cells, undefined, i === 0))),
  };
}

/* -------------------------------- bs7: engines ----------------------------- */

/** Open-choice answers and in-category firm picks per mode. */
function modeFirm(s: Summary, mode: "search" | "instinct") {
  const list = s.byEngine.filter((e) => e.mode === mode);
  const answers = list.reduce((x, e) => x + e.answers, 0);
  const firm = list.reduce((x, e) => x + e.decided.n, 0);
  const won = list.reduce((x, e) => x + e.decided.k, 0);
  return { engines: list.length, firm: cell(firm, answers), decided: cell(won, firm) };
}

function engineDecisiveness(s: Summary, ex?: ExampleIndex): Insight | null {
  const se = modeFirm(s, "search");
  const ins = modeFirm(s, "instinct");
  if (se.firm.n < MIN_BASE || ins.firm.n < MIN_BASE) return null;
  const [hi, lo] = rate(se.firm) >= rate(ins.firm) ? [se, ins] : [ins, se];
  if (!apart(hi.firm, lo.firm)) return null;
  const hiName = hi === se ? "with web search" : "without web search";
  const loName = hi === se ? "without web search" : "with web search";
  const shareOk = se.decided.n >= MIN_BASE && ins.decided.n >= MIN_BASE;
  const shareApart = shareOk && (apart(se.decided, ins.decided) || apart(ins.decided, se.decided));
  const tail = !shareOk
    ? "."
    : shareApart
      ? `, and your share of those picks is ${pct(se.decided)} with web search and ${pct(ins.decided)} without.`
      : ` - your share of those picks does not separate (${pct(se.decided)} with web search vs ${pct(ins.decided)} without), so the gap is how often the AI commits, not who it prefers.`;
  return {
    key: "engine_decisiveness",
    kind: "engine",
    title: `${hiName.charAt(0).toUpperCase()}${hiName.slice(1)}, the AI commits to a pick more often`,
    body: `When buyers ask what to buy, the AI commits to one brand in your category in ${pct(hi.firm)} of answers ${hiName} and ${pct(lo.firm)} ${loName}${tail}`,
    foot: `Search (${se.engines} engines): firm pick ${counts(se.firm)}, yours ${counts(se.decided)}. Instinct (${ins.engines} engines): firm pick ${counts(ins.firm)}, yours ${counts(ins.decided)}.`,
    look: { pill: "table", label: "Metrics - by mode" },
    effect: rate(hi.firm) - rate(lo.firm),
    viz: vizOf([
      withRefs(insightBar(hiName.charAt(0).toUpperCase() + hiName.slice(1), hi.firm), ex?.picks(null, { models: modelsOf(s, (e) => e.mode === (hi === se ? "search" : "instinct")) })),
      withRefs(insightBar(loName.charAt(0).toUpperCase() + loName.slice(1), lo.firm), ex?.picks(null, { models: modelsOf(s, (e) => e.mode === (hi === se ? "instinct" : "search")) })),
    ]),
  };
}

/** The open-choice gap by mode that a head-to-head flip must run against. */
const FLIP_MIN_OPEN = 0.05;

function engineHeadToHeadFlip(s: Summary, ex?: ExampleIndex): Insight | null {
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
    title: h2hHi === "search" ? "With web search the AI backs you in direct matchups, not when buyers ask what to buy" : "Without web search the AI backs you in direct matchups, not when buyers ask what to buy",
    body: `Asked to compare you with a rival directly, the AI picks you in ${pct(se.h2h)} of matchups with web search and ${pct(ins.h2h)} without, while your share of picks when buyers ask what to buy is ${pct(se.decided)} with web search and ${pct(ins.decided)} without - the two run in opposite order.`,
    foot: `Head-to-heads: search ${counts(se.h2h)}, instinct ${counts(ins.h2h)}. Open choice: search ${counts(se.decided)}, instinct ${counts(ins.decided)}.`,
    look: { pill: "table", label: "Metrics - by mode" },
    effect: Math.abs(h2hGap),
    viz: vizOf([
      withRefs(insightBar("Matchups, with web search", se.h2h), ex?.h2hWins({ models: modelsOf(s, (e) => e.mode === "search") })),
      withRefs(insightBar("Matchups, without web search", ins.h2h), ex?.h2hWins({ models: modelsOf(s, (e) => e.mode === "instinct") })),
      withRefs(insightBar("Picks, with web search", se.decided), ex?.picks(s.target.key, { models: modelsOf(s, (e) => e.mode === "search") })),
      withRefs(insightBar("Picks, without web search", ins.decided), ex?.picks(s.target.key, { models: modelsOf(s, (e) => e.mode === "instinct") })),
    ]),
  };
}

/** The analysis map's watch threshold (WATCH_ENGINE_SHARE), at summary level. */
const ENGINE_CONC_SHARE = 0.4;
const ENGINE_CONC_MIN_ENGINES = 3;

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
  type C = { key: string; name: string; isTarget: boolean; unit: Unit; picks: RateCell; base: number };
  const cands: C[] = [];
  for (const b of inp.enginePicks) {
    if (b.total < MIN_BASE || !names.has(b.key)) continue;
    for (const u of units) {
      const k = u.models.reduce((x, m) => x + (b.byModel[m] ?? 0), 0);
      const picks = cell(k, b.total);
      const base = u.answers / s.answers;
      if (rate(picks) >= ENGINE_CONC_SHARE && picks.low > base) cands.push({ key: b.key, name: names.get(b.key)!, isTarget: b.key === s.target.key, unit: u, picks, base });
    }
  }
  if (cands.length === 0) return null;
  const best = cands.sort(
    (a, b) => rate(b.picks) - b.base - (rate(a.picks) - a.base) || b.picks.n - a.picks.n || a.name.localeCompare(b.name)
  )[0];
  const whose = best.isTarget ? "your" : poss(best.name);
  const unit = best.unit.vendor ? `${best.unit.label}'s ${best.unit.models.length} assistants` : best.unit.label;
  return {
    key: "engine_pick_concentration",
    kind: "engine",
    title: `${best.unit.label} carries ${whose} picks`,
    body: `${unit} supply ${pct(best.picks)} of ${whose} picks while answering ${pct(best.base)} of the questions - a read without ${best.unit.vendor ? "them" : "it"} would put ${best.isTarget ? "you" : best.name} far lower.`,
    foot: `${best.picks.k} of ${best.picks.n} open-choice picks of ${best.name} (95% range ${Math.round(best.picks.low * 100)}-${Math.round(best.picks.high * 100)}%) from ${unit}, which answer ${best.unit.answers} of ${s.answers} open-choice questions.`,
    look: { pill: "table", label: best.unit.vendor ? "Metrics - by vendor" : "Metrics - by engine" },
    effect: rate(best.picks) - best.base,
    viz: vizOf([
      withRefs(insightBar(`Picks from ${best.unit.label}`, best.picks, undefined, true), inp.ex?.picks(best.key, { models: best.unit.models })),
      insightBar("Questions it answers", best.base),
    ]),
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
const VENDOR_MIN_GAP = 0.1;
/** At least this many companies with MIN_BASE answers on the measure. */
const VENDOR_MIN_COMPANIES = 3;

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
  slices: { vendor: string; models: string[]; k: number; n: number }[];
  /** Example answers for a company's numerator, where a pool filter is natural. */
  refs?: (models: string[]) => AnswerRef[] | undefined;
}

/** Pools engine slices on their vendor. */
function byVendor<T extends { key: string; vendor: string }>(slices: T[], cellOf: (s: T) => RateCell): VendorMeasure["slices"] {
  const m = new Map<string, { vendor: string; models: string[]; k: number; n: number }>();
  for (const s of slices) {
    const c = cellOf(s);
    const t = m.get(s.vendor) ?? { vendor: s.vendor, models: [], k: 0, n: 0 };
    t.models.push(s.key);
    t.k += c.k;
    t.n += c.n;
    m.set(s.vendor, t);
  }
  return [...m.values()];
}

function vendorMeasures(inp: InsightInputs, brand: string): VendorMeasure[] {
  const out: VendorMeasure[] = [];
  const k = inp.doubt.keepOrLeave;
  const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
  if (k) {
    const row = lower(ROW_NAME.customers);
    const base = { row, station: "customer_base", stationLabel: "Stations - Customers" };
    out.push({
      ...base,
      id: "keep",
      says: (c, a, b) => `Asked by your customers whether to stay, ${c} says stay in ${a} of answers; the other AI assistants together, ${b}.`,
      bar: "say stay",
      slices: byVendor(k.byEngine, (s) => s.verdicts.keep),
      refs: (models) => inp.ex?.doubt("keep", (r) => models.includes(r.model) && r.code.keep_or_leave === "keep"),
    });
    out.push({
      ...base,
      id: "leave",
      says: (c, a, b) => `Asked by your customers whether to stay, ${c} says leave in ${a} of answers; the other AI assistants together, ${b}.`,
      bar: "say leave",
      slices: byVendor(k.byEngine, (s) => s.verdicts.leave),
      refs: (models) => inp.ex?.doubt("keep", (r) => models.includes(r.model) && r.code.keep_or_leave === "leave"),
    });
  }
  const o = inp.doubt.objections;
  if (o) {
    const row = lower(ROW_NAME.buyers);
    const base = { row, station: "doubts", stationLabel: "Stations - Doubts" };
    out.push({
      ...base,
      id: "proceed",
      says: (c, a, b) => `When a buyer voices a worry about ${brand}, ${c} says go ahead in ${a} of answers; the other AI assistants together, ${b}.`,
      bar: "say go ahead",
      slices: byVendor(o.byEngine, (s) => s.verdicts.proceed),
      refs: (models) => inp.ex?.doubt("objections", (r) => models.includes(r.model) && r.code.proceed_or_avoid === "proceed"),
    });
    out.push({
      ...base,
      id: "avoid",
      says: (c, a, b) => `When a buyer voices a worry about ${brand}, ${c} says steer clear in ${a} of answers; the other AI assistants together, ${b}.`,
      bar: "say steer clear",
      slices: byVendor(o.byEngine, (s) => s.verdicts.avoid),
      refs: (models) => inp.ex?.doubt("objections", (r) => models.includes(r.model) && r.code.proceed_or_avoid === "avoid"),
    });
  }
  const v = inp.value;
  if (v) {
    const row = lower(ROW_NAME.value);
    const base = { row, station: "value", stationLabel: "Stations - Value" };
    out.push({
      ...base,
      id: "worth_yes",
      says: (c, a, b) => `Asked whether ${brand} is worth paying more for, ${c} says yes in ${a} of answers; the other AI assistants together, ${b}.`,
      bar: "say worth it",
      slices: byVendor(v.byEngine, (s) => s.worth.yes),
    });
    out.push({
      ...base,
      id: "worth_no",
      says: (c, a, b) => `Asked whether ${brand} is worth paying more for, ${c} says no in ${a} of answers; the other AI assistants together, ${b}.`,
      bar: "say not worth it",
      slices: byVendor(v.byEngine, (s) => s.worth.no),
    });
  }
  const off = inp.alternatives.offensive;
  if (off)
    out.push({
      id: "captured",
      row: lower(ROW_NAME.leavers),
      station: "comparison",
      stationLabel: "Stations - Comparison",
      says: (c, a, b) => `When a rival's customer asks what to switch to, ${c} picks you in ${a} of answers; the other AI assistants together, ${b}.`,
      bar: "pick you",
      slices: byVendor(off.byEngine, (s) => s.captured),
    });
  const def = inp.alternatives.defensive;
  if (def)
    out.push({
      id: "hold_stay",
      row: lower(ROW_NAME.hold),
      station: "customer_base",
      stationLabel: "Stations - Customers",
      says: (c, a, b) => `When your own customers ask what else to consider, ${c} tells them to stay in ${a} of answers; the other AI assistants together, ${b}.`,
      bar: "say stay",
      slices: byVendor(def.byEngine, (s) => s.verdicts.keep),
    });
  return out;
}

/** Every (measure, company) pair whose rate sits apart from the other
 * companies pooled - exported for the calibration dump; the detector serves
 * the one whose ranges sit furthest apart, at or above VENDOR_MIN_GAP. */
export function vendorOutlierCandidates(inp: InsightInputs, brand: string) {
  const out: { measure: VendorMeasure; vendor: string; models: string[]; own: RateCell; rest: RateCell; gap: number; clear: number }[] = [];
  for (const m of vendorMeasures(inp, brand)) {
    if (m.slices.filter((x) => x.n >= MIN_BASE).length < VENDOR_MIN_COMPANIES) continue;
    for (const s of m.slices) {
      const others = m.slices.filter((x) => x !== s);
      const own = cell(s.k, s.n);
      const rest = cell(
        others.reduce((x, o) => x + o.k, 0),
        others.reduce((x, o) => x + o.n, 0)
      );
      if (own.n < MIN_BASE || rest.n < MIN_BASE) continue;
      if (!apart(own, rest) && !apart(rest, own)) continue;
      const gap = rate(own) - rate(rest);
      // How far the two 95% ranges sit from each other - the ranking, so a
      // thin pool with a wide range never outranks a well-measured company.
      const clear = gap > 0 ? own.low - rest.high : rest.low - own.high;
      out.push({ measure: m, vendor: s.vendor, models: s.models, own, rest, gap, clear });
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
      withRefs(insightBar(`${best.vendor} - ${m.bar}`, best.own, undefined, true), m.refs?.(best.models)),
      insightBar(`The others - ${m.bar}`, best.rest),
    ]),
  };
}

/* ---------------------- bs8: neutralized differentiator --------------------- */

/** An argument carried by this share of your head-to-head wins is one you win on. */
const ND_WIN_SHARE = 0.4;

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
  if (a.wins < MIN_BASE || a.losses < MIN_BASE) return null;
  const cands = a.codes
    .filter((c) => c.wins >= MIN_BASE && c.losses >= MIN_BASE)
    .map((c) => ({ ...c, w: cell(c.wins, a.wins), l: cell(c.losses, a.losses) }))
    .filter((c) => rate(c.w) >= ND_WIN_SHARE && !apart(c.w, c.l) && rate(c.l) > rate(c.w))
    .map((c) => ({ ...c, above: apart(c.l, c.w) }))
    .sort((x, y) => Number(y.above) - Number(x.above) || rate(y.l) - rate(x.l) || x.code.localeCompare(y.code));
  const best = cands[0];
  if (!best) return null;
  const [rivalKey, rivalLosses] = Object.entries(best.lossesBy).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0] ?? [null, 0];
  const rival = rivalKey ? a.rivals[rivalKey] ?? null : null;
  const rivalText = rival ? `, most often to ${rival}` : "";
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  return {
    key: "neutralized_differentiator",
    kind: "argument",
    title: best.above ? `Your rivals are credited with ${best.code}` : `${cap(best.code)} no longer sets you apart`,
    body: best.above
      ? `${cap(best.code)} is argued in ${pct(best.w)} of the direct matchups you win but ${pct(best.l)} of those you lose${rivalText} - the AI credits your rivals with it more than you.`
      : `${cap(best.code)} is argued in ${pct(best.w)} of the direct matchups you win and ${pct(best.l)} of those you lose${rivalText} - it comes up in your rivals' wins as often as in yours.`,
    foot: `In wins: ${counts(best.w)}. In losses: ${counts(best.l)}${rival ? `; ${rivalLosses} of those losses to ${rival}` : ""}. Prompted head-to-heads against every named rival, pooled; arguments in under ${Math.round(ND_WIN_SHARE * 100)}% of wins left out.`,
    look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
    effect: rate(best.l) - rate(best.w),
    viz: vizOf([
      withRefs(insightBar("In matchups you win", best.w), inp.ex?.h2hArg(best.code, "wins")),
      withRefs(insightBar("In matchups you lose", best.l, undefined, true), inp.ex?.h2hArg(best.code, "losses")),
    ]),
  };
}

/* ------------------------- bs8: conversion vs rival ------------------------- */

/**
 * Recommendations turned into picks (chosen over recommended - the pick
 * always counts as recommended), the target against the rival with the
 * largest share of decided; both need MIN_BASE recommendations and the two
 * ranges must not overlap, either direction. Effect = the gap.
 */
function conversionVsRival(s: Summary, ex?: ExampleIndex): Insight | null {
  const rival = s.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
  if (!rival) return null;
  const you = cell(s.target.chosen.k, s.target.recommended.k);
  const them = cell(rival.chosen.k, rival.recommended.k);
  if (you.n < MIN_BASE || them.n < MIN_BASE) return null;
  const rivalAhead = rate(them) > rate(you);
  if (!(rivalAhead ? apart(them, you) : apart(you, them))) return null;
  return {
    key: "conversion_vs_rival",
    kind: "rival",
    title: rivalAhead ? `${rival.name} turns its recommendations into picks, you less so` : `You turn recommendations into picks better than ${rival.name}`,
    body: rivalAhead
      ? `The AI recommends you but picks ${rival.name} - ${rival.name} is the pick in ${pct(them)} of the answers that recommend it, you in ${pct(you)} of those that recommend you.`
      : `When the AI recommends you, you are the pick in ${pct(you)} of those answers; ${rival.name} in ${pct(them)} of the answers that recommend it.`,
    foot: `${rival.name}: picked in ${counts(them)} recommending answers. You: ${counts(you)}. ${rival.name} has the largest share of decided open-choice picks among your rivals.`,
    look: { pill: "rivals", label: "Rivals" },
    effect: Math.abs(rate(them) - rate(you)),
    viz: vizOf([withRefs(insightBar(s.brand, you, undefined, true), ex?.picks(s.target.key)), withRefs(insightBar(rival.name, them), ex?.picks(rival.key))]),
  };
}

/* ------------------------------- bs8: leaks -------------------------------- */

/** The analysis map's leak badge threshold (LEAK_SHARE), at summary level. */
const LEAK_PICKS_SHARE = 0.1;
/** Problem questions routed outside the category in at least this share. */
const LEAK_PROBLEM_SHARE = 0.5;

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Firm open-choice picks that leave the category (B5). Effect = the share. */
function leakPicks(inp: InsightInputs): Insight | null {
  const l = inp.leak;
  if (l.firm < MIN_BASE) return null;
  const outside = cell(l.firm - l.inCategory, l.firm);
  if (rate(outside) < LEAK_PICKS_SHARE) return null;
  const top = l.names.slice(0, 3);
  const room = [...l.rooms]
    .filter((r) => r.firm >= MIN_BASE && r.outside > 0)
    .sort((a, b) => b.outside / b.firm - a.outside / a.firm || a.room.localeCompare(b.room))[0];
  const roomCell = room ? cell(room.outside, room.firm) : null;
  const roomText = room && roomCell && rate(roomCell) > rate(outside) ? `; for ${room.room} it is ${pct(roomCell)}` : "";
  return {
    key: "leak_picks",
    kind: "leak",
    title: top.length ? `Picks leave the category - led by ${top[0].name}` : "Picks leave the category",
    body: `${pct(outside)} of the answers that commit to a pick choose something outside your category${top.length ? `, led by ${listNames(top.map((x) => x.name))}` : ""}${roomText}.`,
    foot: `${counts(outside)} firm picks outside the category${top.length ? `: ${top.map((x) => `${x.name} ${x.n}`).join(", ")}` : ""}.${room && roomCell ? ` ${room.room}: ${counts(roomCell)}.` : ""} Outside = ruled out on the dictionary board, pending, or not in it.`,
    look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
    effect: rate(outside),
    viz: vizOf([
      withRefs(insightBar("Outside the category", outside, undefined, true), inp.ex?.outside()),
      roomText && roomCell
        ? withRefs(insightBar(lbl(room!.room), roomCell), inp.ex?.outside({ room: room!.room }))
        : withRefs(insightBar("Inside the category", 1 - rate(outside)), inp.ex?.picks(null)),
    ]),
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
  const top = p.rooms.filter((r) => r.out.n >= MIN_BASE).sort((a, b) => rate(b.out) - rate(a.out) || a.room.localeCompare(b.room))[0];
  if (!top || rate(top.out) < LEAK_PROBLEM_SHARE) return null;
  const others = p.rooms.filter((r) => r.room !== top.room);
  const rest = cell(
    others.reduce((x, r) => x + r.out.k, 0),
    others.reduce((x, r) => x + r.out.n, 0)
  );
  const oneRoom = rest.n >= MIN_BASE && apart(top.out, rest);
  if (!oneRoom && rate(p.all) < LEAK_PROBLEM_SHARE) return null;
  return {
    key: "leak_problem",
    kind: "leak",
    title: oneRoom ? `${top.room}: the problem is solved outside the category` : "Problem questions are solved outside the category",
    body: oneRoom
      ? `For ${top.room}, the AI answers ${pct(top.out)} of the problem questions that do not name the category with a solution outside it - ${pct(rest)} for the other buying situations.`
      : `Across every buying situation, the AI answers ${pct(p.all)} of the problem questions that do not name the category with a solution outside it (${pct(top.out)} for ${top.room}).`,
    foot: `${top.room}: ${counts(top.out)}.${rest.n > 0 ? ` Other rooms: ${counts(rest)}.` : ""} All problem-recognition answers: ${counts(p.all)}.`,
    look: { pill: "stations", station: "awareness", label: "Stations - Awareness" },
    effect: (oneRoom ? rate(top.out) : rate(p.all)) - LEAK_PROBLEM_SHARE,
    viz: oneRoom
      ? vizOf([
          withRefs(insightBar(lbl(top.room), top.out, undefined, true), inp.ex?.routing({ room: top.room })),
          withRefs(insightBar("Other buying situations", rest), inp.ex?.routing({ notRoom: top.room })),
        ])
      : vizOf([
          withRefs(insightBar("Every buying situation", p.all, undefined, true), inp.ex?.routing()),
          withRefs(insightBar(lbl(top.room), top.out), inp.ex?.routing({ room: top.room })),
        ]),
  };
}

/* ------------------------------ bs8: retention ------------------------------ */

/** The customers' worry whose leave rate sits apart above the pooled rest. Effect = the gap. */
function worstWorry(inp: InsightInputs): Insight | null {
  const k = inp.doubt.keepOrLeave;
  if (!k || k.rows.length < 2) return null;
  const ok = k.rows.filter((r) => r.answers >= MIN_BASE);
  if (ok.length === 0) return null;
  const top = [...ok].sort((a, b) => rate(b.verdicts.leave) - rate(a.verdicts.leave) || a.concern.localeCompare(b.concern))[0];
  const others = k.rows.filter((r) => r.key !== top.key);
  const rest = cell(
    others.reduce((x, r) => x + r.verdicts.leave.k, 0),
    others.reduce((x, r) => x + r.answers, 0)
  );
  if (rest.n < MIN_BASE || !apart(top.verdicts.leave, rest)) return null;
  const exit = top.topExits[0];
  const concern = top.concern || "this worry";
  return {
    key: "worst_worry",
    kind: "doubt",
    title: `The worry that loses customers: ${concern}`,
    body: `When a customer says "${concern}", the AI tells them to leave in ${pct(top.verdicts.leave)} of answers${exit ? `, most often for ${exit.name}` : ""} - against ${pct(rest)} across their other worries.`,
    foot: `${concern}: leave ${counts(top.verdicts.leave)}. Other customers' worries: ${counts(rest)}.${exit ? ` ${exit.name}: ${exit.n} answers.` : ""}`,
    look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    effect: rate(top.verdicts.leave) - rate(rest),
    viz: vizOf([
      withRefs(insightBar(lbl(concern), top.verdicts.leave, undefined, true), inp.ex?.doubt("keep", (r) => worryKey(r) === top.key && r.code.keep_or_leave === "leave")),
      withRefs(insightBar("Their other worries", rest), inp.ex?.doubt("keep", (r) => worryKey(r) !== top.key && r.code.keep_or_leave === "leave")),
    ]),
  };
}

/** Leave verdicts naming no destination at all. */
const NO_EXIT_SHARE = 0.5;

/** Of the customers' leave verdicts, the share naming no destination (the
 * doubt view's offersExitBy.leave, inverted). Effect = the share above half. */
function leaveNoExit(inp: InsightInputs, brand: string): Insight | null {
  const k = inp.doubt.keepOrLeave;
  if (!k) return null;
  const withExit = k.offersExitBy.leave;
  if (withExit.n < MIN_BASE) return null;
  const none = cell(withExit.n - withExit.k, withExit.n);
  if (rate(none) < NO_EXIT_SHARE) return null;
  return {
    key: "leave_no_exit",
    kind: "doubt",
    title: "Told to leave, with nowhere to go",
    body: `When the AI tells a customer weighing a worry to leave ${brand}, ${pct(none)} of those answers name nowhere to go - the cancel is a loss to you without being any rival's gain.`,
    foot: `Leave answers naming no destination: ${counts(none)}. Leave answers overall: ${counts(k.verdicts.leave)}.`,
    look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    effect: rate(none) - NO_EXIT_SHARE,
    viz: vizOf([insightBar("Name nowhere to go", none, undefined, true), insightBar("Name somewhere to go", withExit)]),
  };
}

/**
 * The verdict the brief opens with: template sentences in fixed order
 * (standing, prompted vs open, concentration, doubts, value, settled), each
 * only when its inputs clear the floors. Percentages in `text`, counts in `foot`.
 */
export function composeVerdict(s: Summary, inp: InsightInputs): VerdictFact[] {
  const out: VerdictFact[] = [];
  const decidedOk = s.firmPickInCategory.k >= MIN_BASE;

  // 1. Standing.
  if (s.answers >= MIN_BASE) {
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
      text = `${s.brand} is named in ${pct(s.target.mentioned)} of answers when buyers ask what to buy and is the pick in ${pctFine(rate(s.target.chosen))} of all answers.`;
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
      gap >= 0.1
        ? `Asked to compare it with a rival directly, the AI picks it in ${pct(rec.pooled)} of matchups${hard} - but it takes only ${openText}.`
        : gap <= -0.1
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
      text: `${pct(room.share)} of its picks come from one buying situation, ${room.top.room}.`,
      foot: `${room.top.picks} of ${room.total} open-choice picks; ${room.rooms} rooms.`,
      look: { pill: "buyers", label: "Buyers" },
    });
  } else {
    const q = questionConcentration(s, inp, s.target.key);
    if (q)
      out.push({
        key: "concentration",
        text: `${pct(q.share)} of its picks come from one question: "${shorten(q.top.text)}"`,
        foot: `${q.k} of ${q.total} open-choice picks; ${q.n} questions.`,
        look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
      });
  }

  // 4. Doubts.
  const b = s.buyersDoubt && s.buyersDoubt.answers >= MIN_BASE && s.buyersDoubt.agree.n >= MIN_BASE ? s.buyersDoubt : null;
  const c = s.customersDoubt && s.customersDoubt.answers >= MIN_BASE ? s.customersDoubt : null;
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
  if (v && v.answers >= MIN_BASE) {
    const subject = v.lines.length === 1 ? v.lines[0].label : `${s.brand}'s lines`;
    const verb = v.lines.length === 1 ? "is" : "are";
    let tail = "";
    if (v.ownRung.n >= MIN_BASE) {
      const own = rate(v.ownRung);
      const riv = rate(v.recommendsInstead);
      const topRival = v.instead.find((i) => !i.own);
      if (own >= 0.5 && own >= riv) tail = "; most of the doubts point to its own cheaper option";
      else if (riv >= 0.5 && riv > own) tail = `; most of the doubts point to a rival${topRival ? `, led by ${topRival.name}` : ""}`;
      else if (own >= 0.3 || riv >= 0.3) tail = `; ${pct(own)} of the doubts point to its own cheaper option and ${pct(riv)} to a rival`;
    }
    out.push({
      key: "value",
      text: `${subject} ${verb} judged worth it in ${pct(v.worth.yes)} of answers${tail}.`,
      foot: `Worth it ${counts(v.worth.yes)}.${v.ownRung.n > 0 ? ` Of the no and it-depends answers: own option ${v.ownRung.k}, a rival ${v.recommendsInstead.k}, of ${v.ownRung.n}.` : ""}`,
      look: { pill: "stations", station: "value", label: "Stations - Value" },
    });
  }

  // 6. Settled customers.
  const adv = inp.settled.advocacy && inp.settled.advocacy.answers >= MIN_BASE ? inp.settled.advocacy : null;
  const bc = inp.settled.businessCase && inp.settled.businessCase.answers >= MIN_BASE ? inp.settled.businessCase : null;
  const obj = inp.doubt.objections && inp.doubt.objections.premise.confirms.n >= MIN_BASE ? inp.doubt.objections : null;
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
  return out;
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

/** Every detector that fires, ranked by effect, uncapped (harnesses read the tail). */
export function rankedInsights(s: Summary, inp: InsightInputs): Insight[] {
  const found = [
    engineSpread(s, inp.ex),
    modeGap(s, inp.ex),
    vendorGap(s, inp.ex),
    roomWin(inp, s.target.key),
    roomValue(inp, s.brand),
    rivalOpen(s, inp.ex),
    rivalHeadToHead(s, inp.ex),
    argument(s, inp.ex),
    doubtRollup(s, inp.ex),
    doubtWorry(inp),
    funnelDrop(s, inp.ex),
    promptedVsOpen(s, inp.ex),
    pickConcentrationRoom(s, inp),
    pickConcentrationQuestion(s, inp),
    agreedYetStay(inp),
    taughtVsWinning(s, inp),
    valueInHouse(inp, s.brand),
    advocacyVsObjection(inp),
    leaverCapture(inp),
    ownDefense(inp),
    awayCondition(s, inp),
    engineDecisiveness(s, inp.ex),
    engineHeadToHeadFlip(s, inp.ex),
    enginePickConcentration(s, inp),
    neutralizedDifferentiator(inp),
    conversionVsRival(s, inp.ex),
    leakPicks(inp),
    leakProblem(inp),
    worstWorry(inp),
    leaveNoExit(inp, s.brand),
    vendorOutlier(inp, s.brand),
  ].filter((x): x is Insight => x !== null && x.effect > 0);
  return found.sort((a, b) => b.effect - a.effect || a.key.localeCompare(b.key));
}
