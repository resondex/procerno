import { store } from "../store";
import { computeHeadlineCached, type HeadlineView } from "./headline";
import { computeAwarenessCached } from "./awareness";
import { computeHeadToHeadCached, type HeadToHeadRow } from "./head_to_head";
import { computeAlternativesCached } from "./alternatives";
import { computeDoubtCached } from "./doubt";
import { computeValueCached } from "./value";
import { computeRepertoireCached } from "./repertoire";
import { computePremiumCached } from "./premium";
import { computeReasonsCached } from "./reasons";
import { computeBrandSummaryCached } from "./brand_summary";
import { computeRulesCached, type RuleGroup, type RulePool, type RulesView, type SliceGroup } from "./rules_explorer";
import type { ReasonsView } from "./reasons";
import { computeSettledCached } from "./settled";
import { buildResolver, type Resolver } from "./brand_resolve";
import { STATION_LABEL, stationQuestion, viewsOf, type StationKey, type ViewKey } from "./views";
import { cell, type RateCell } from "./view_data";
import type { Project, Run } from "../types";

export type { RateCell, StationKey };

/**
 * The Stations home view (v2, 2026-11-01 - the RATIFIED analysis-tier
 * restructure, WORKBENCH_REDESIGN_2026-10-30.md top section). Six stations
 * of one shape: the buyer's question as the title, one number, the best
 * rival's same number as the anchor (where the instrument asks a rival;
 * otherwise the range or the destination), the number of question kinds,
 * and under it the drill - who gets picked, the arguments behind it, you
 * win when / you lose when, and the OPEN inventory of every question kind
 * that routes to the station (a kind the tracker did not ask is a greyed
 * row - the completeness principle: nothing collected is curated out).
 *
 * Nothing is computed here that a view does not already compute - every
 * number is read off a cached view payload (headline, awareness,
 * head-to-head, alternatives, doubt, value, repertoire, premium, reasons,
 * brand summary, rules, settled), so the map is a cache hit once the views
 * have been opened. The station map itself is views.ts STATION_OF.
 *
 * Stations are independent populations - each is its own set of questions
 * asked of its own answers - never stages one buyer walks through.
 *
 * The buyer filter (?room=): headline, awareness, value and the criteria
 * reasons take the room and keep that room's cells only (poolOf's strict
 * rule). Every other number - head-to-heads since s10, the worries module,
 * rival leavers, holding your own, repertoire, Set C, category education,
 * social validation, premium vs basic - is never asked in one buyer's
 * voice, so under a room filter it comes back at its all-buyers value
 * marked invariant, never hidden and never presented as the room's. Under a
 * room filter, Consideration's arguments come from the room-filtered reasons
 * view and the Consideration and Value conditions from the rules view's
 * per-room slice; Comparison, Doubts and Customers read invariant pools, so
 * their conditions stay run-wide and are listed in the station's `unfiltered`.
 */

/** Bumped whenever the payload shape or a number's meaning changes. */
export const JOURNEY_VERSION = "j3";

export interface JourneyMetric {
  key: string;
  label: string;
  cell: RateCell;
  /** Measured across all buyers by design - the room filter does not reach it. */
  invariant: boolean;
}

export interface JourneyAnchor {
  kind: "rival" | "range" | "named_instead" | "leave";
  text: string;
  cell: RateCell | null;
}

export interface InventoryRow {
  /** The view key, or view key + ":" + the rival / worry / room for per-item rows. */
  key: ViewKey | string;
  label: string;
  asked: boolean;
  answers: number;
  /** What the row's number reads as ("picked", "you win", "told to stay"). */
  readsAs: string;
  you: RateCell | null;
  beside: string;
  /** Shown at its all-buyers value under a room filter. */
  invariant: boolean;
}

export interface ConditionLine {
  label: string;
  /** Answers at this station stating it. */
  answers: number;
  /** Resolved names the condition routes to, deduped, at most 3. */
  routes: string[];
}

export interface JourneyPick {
  name: string;
  role: "target" | "rival" | "other";
  cell: RateCell;
}

export interface JourneyArgument {
  code: string;
  forYou: boolean;
  inYourPicks: RateCell;
  inRivalPicks: RateCell;
}

export interface JourneyStation {
  key: StationKey;
  label: string;
  question: string;
  /** One number; null when the tracker asks no question that carries it. */
  lead: JourneyMetric | null;
  /** At most 2 companion numbers. */
  sub: JourneyMetric[];
  anchor: JourneyAnchor | null;
  /** Question kinds ASKED at this station (inventory rows with asked = true). */
  kinds: number;
  /** EVERY question kind that routes to this station, asked or not. */
  inventory: InventoryRow[];
  /** The station's "who gets picked" block; [] where it has none. */
  picks: JourneyPick[];
  /** Top 2 for + top 2 against (brand summary reason lift; under a room filter, the room-filtered reasons view); [] where not applicable. */
  arguments: JourneyArgument[];
  /** Top 3 each from the rules view, restricted to the station's question types. */
  conditions: { win: ConditionLine[]; lose: ConditionLine[] };
  /** Every number on the station is measured across all buyers by design. */
  invariant: boolean;
  /** Parts shown at their all-buyers value under a room filter
   * ("arguments", "conditions"); [] without a filter. */
  unfiltered: ("arguments" | "conditions")[];
}

export interface JourneyView {
  version: string;
  runId: string;
  source: string;
  brand: string;
  category: string;
  /** The buyer filter applied; null = all buyers. */
  room: string | null;
  /** Every room (cell situation) the instrument asks in, in setup order. */
  rooms: string[];
  stations: JourneyStation[];
}

const m = (key: string, label: string, c: RateCell, invariant: boolean): JourneyMetric => ({ key, label, cell: c, invariant });
const pct = (c: RateCell | null | undefined) => (c && c.n > 0 ? `${Math.round((100 * c.k) / c.n)}%` : "-");
const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);

const row = (
  key: string,
  label: string,
  readsAs: string,
  answers: number,
  you: RateCell | null,
  beside: string,
  invariant: boolean
): InventoryRow => ({ key, label, asked: answers > 0, answers, readsAs, you, beside, invariant });

const notAsked = (key: string, label: string, readsAs: string, invariant: boolean): InventoryRow => ({
  key,
  label,
  asked: false,
  answers: 0,
  readsAs,
  you: null,
  beside: "not asked on this tracker",
  invariant,
});

/** Distinct rooms in setup order, from cells that route to a view. */
async function roomsOf(project: Project): Promise<string[]> {
  const intents = await store.listIntents(project.id);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of [...intents].sort((a, b) => a.seq - b.seq)) {
    if (!it.situation || seen.has(it.situation) || viewsOf(it.stage, it.angle).length === 0) continue;
    seen.add(it.situation);
    out.push(it.situation);
  }
  return out;
}

/** The rules view's question types each station reads. */
const STATION_POOLS: Record<StationKey, RulePool[]> = {
  awareness: [],
  consideration: ["open_choice", "premium"],
  comparison: ["head_to_head", "rival_leavers"],
  doubts: ["buyer_worries"],
  value: ["value"],
  customer_base: ["holding", "customer_worries", "expansion", "ecosystem"],
};

/** Routes carry dictionary brands only (active or rejected entries, by their
 * entry name); generic "elsewhere" labels and names the dictionary cannot
 * place are dropped - a line may end with none. */
function dictionaryRoutes(names: string[], resolve: Resolver): string[] {
  const seen = new Set<string>();
  const routes: string[] = [];
  for (const r of names) {
    const res = resolve(r);
    if (res.status !== "active" && res.status !== "rejected") continue;
    if (seen.has(res.key)) continue;
    seen.add(res.key);
    routes.push(res.name);
  }
  return routes.slice(0, 3);
}

/**
 * Conditions for one room, from the rules view's per-room slice. A room
 * slice is not split by question type: its rule-bearing answers are the
 * room-pinned cells, which are only open-choice (discovery, use-case) and
 * value cells - premium, head-to-heads, worries and the customer pools are
 * never asked in one buyer's voice. So Consideration and Value under a room
 * filter both read the room slice as-is (a condition stated in the room's
 * value cells can show on Consideration and vice versa). The slice's lose
 * side is "away" groups only (rules_explorer does not slice "elsewhere").
 */
function roomConditionsOf(rules: RulesView | null, room: string, resolve: Resolver): { win: ConditionLine[]; lose: ConditionLine[] } {
  const slice = rules?.rooms.find((r) => r.key === room);
  if (!slice) return { win: [], lose: [] };
  const lines = (groups: SliceGroup[]): ConditionLine[] =>
    groups
      .slice(0, 3)
      .map((g) => ({ label: g.label, answers: g.answers, routes: dictionaryRoutes(g.routes.map((r) => r.name), resolve) }));
  return { win: lines(slice.win), lose: lines(slice.lose) };
}

/** Both pick buckets must hold this many answers (brand summary's floor). */
const ARG_MIN_ANSWERS = 20;
/** A code argued in under this share of the type's answers never lists (brand summary's floor). */
const ARG_MIN_INCIDENCE = 0.02;

/**
 * Top 2 for / top 2 against from the room-filtered reasons view: the
 * open-choice type's code incidence when the answer picks you vs picks
 * another brand. The reasons view's "Picks another" bucket counts any other
 * pick (in-category or not), where the brand summary's lift counts other
 * in-category picks only.
 */
function roomArgumentsOf(reasons: ReasonsView | null): JourneyArgument[] {
  const t = reasons?.types.find((x) => x.key === "headline");
  if (!reasons || !t) return [];
  const bucket = (k: string) => t.verdicts.find((v) => v.key === k)?.answers ?? 0;
  if (bucket("you") < ARG_MIN_ANSWERS || bucket("other") < ARG_MIN_ANSWERS) return [];
  const lift = reasons.codes
    .flatMap((c) => {
      const all = c.byType.headline;
      const v = c.byVerdict.headline;
      if (!all || !v?.you || !v.other || all.n === 0 || all.k / all.n < ARG_MIN_INCIDENCE) return [];
      return [{ code: c.key, wins: v.you, others: v.other, lift: rate(v.you) - rate(v.other) }];
    })
    .sort((a, b) => b.lift - a.lift);
  const forYou = lift.filter((r) => r.lift > 0).slice(0, 2);
  const against = lift.filter((r) => r.lift < 0).slice(-2).reverse();
  return [...forYou, ...against].map((r) => ({ code: r.code, forYou: r.lift > 0, inYourPicks: r.wins, inRivalPicks: r.others }));
}

function conditionsOf(rules: RulesView | null, key: StationKey, resolve: Resolver): { win: ConditionLine[]; lose: ConditionLine[] } {
  const pools = new Set(STATION_POOLS[key]);
  if (!rules || pools.size === 0) return { win: [], lose: [] };
  const inStation = (g: RuleGroup) => g.pools.filter((p) => pools.has(p.pool)).reduce((a, p) => a + p.answers, 0);
  const lines = (groups: RuleGroup[]): ConditionLine[] => {
    // One line per condition group: "away" and "elsewhere" both lose, and
    // a condition can route to both - merged, routes unioned.
    const byCond = new Map<string, { label: string; answers: number; top: number; routes: string[] }>();
    for (const g of groups) {
      const n = inStation(g);
      if (n === 0) continue;
      const cur = byCond.get(g.cond) ?? { label: g.label, answers: 0, top: 0, routes: [] };
      cur.answers += n;
      if (n > cur.top) {
        cur.top = n;
        cur.label = g.label;
      }
      cur.routes.push(...g.routes.map((r) => r.name));
      byCond.set(g.cond, cur);
    }
    return [...byCond.values()]
      .sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label))
      .slice(0, 3)
      .map((x) => ({ label: x.label, answers: x.answers, routes: dictionaryRoutes(x.routes, resolve) }));
  };
  return {
    win: lines(rules.groups.filter((g) => g.side === "you")),
    lose: lines(rules.groups.filter((g) => g.side !== "you")),
  };
}

function station(
  key: StationKey,
  project: Project,
  parts: {
    lead: JourneyMetric | null;
    sub?: JourneyMetric[];
    anchor?: JourneyAnchor | null;
    inventory: InventoryRow[];
    picks?: JourneyPick[];
    arguments?: JourneyArgument[];
    conditions?: { win: ConditionLine[]; lose: ConditionLine[] };
    unfiltered?: ("arguments" | "conditions")[];
  }
): JourneyStation {
  const sub = (parts.sub ?? []).slice(0, 2);
  const nums = [...(parts.lead ? [parts.lead] : []), ...sub];
  return {
    key,
    label: STATION_LABEL[key],
    question: stationQuestion(key, project.brand, project.category),
    lead: parts.lead,
    sub,
    anchor: parts.anchor ?? null,
    kinds: parts.inventory.filter((r) => r.asked).length,
    inventory: parts.inventory,
    picks: parts.picks ?? [],
    arguments: parts.arguments ?? [],
    conditions: parts.conditions ?? { win: [], lose: [] },
    invariant: nums.length > 0 && nums.every((x) => x.invariant),
    unfiltered: parts.unfiltered ?? [],
  };
}

const roleOfBrand = (r: string): JourneyPick["role"] => (r === "target" ? "target" : r === "competitor" ? "rival" : "other");

/** A headline stage row for the consideration inventory. */
function stageRow(view: HeadlineView | null, stage: string, label: string, invariant: boolean): InventoryRow {
  const s = view?.byStage.find((x) => x.key === stage);
  if (!s || s.answers === 0) return notAsked(`headline:${stage}`, label, "picked", invariant);
  return row(`headline:${stage}`, label, "picked", s.answers, s.chosen, `named ${pct(s.mentioned)}, one brand picked in ${pct(s.firmPickInCategory)}`, invariant);
}

/** Margin from an even two-way split - the closest and widest rivals. */
const margin = (r: HeadToHeadRow) => Math.abs(rate(r.winOfDecided) - 0.5);

export async function computeJourney(run: Run, project: Project, room?: string): Promise<JourneyView | null> {
  const filtered = room !== undefined;
  const [headline, headlineAll, awareness, awarenessAll, h2h, alts, doubt, value, repertoire, premium, reasons, summary, rules, settled, rooms] =
    await Promise.all([
      computeHeadlineCached(run, project, room),
      filtered ? computeHeadlineCached(run, project) : Promise.resolve(null),
      computeAwarenessCached(run, project, room),
      filtered ? computeAwarenessCached(run, project) : Promise.resolve(null),
      computeHeadToHeadCached(run, project),
      computeAlternativesCached(run, project),
      computeDoubtCached(run, project),
      computeValueCached(run, project, room),
      computeRepertoireCached(run, project),
      computePremiumCached(run, project),
      computeReasonsCached(run, project, room),
      // Under a room filter the arguments come from the room-filtered reasons view.
      filtered ? Promise.resolve(null) : computeBrandSummaryCached(run, project),
      computeRulesCached(run, project),
      computeSettledCached(run, project),
      roomsOf(project),
    ]);
  // Every view reads the same codes source; no source = nothing coded to map.
  const any = headline ?? headlineAll ?? h2h ?? doubt ?? alts;
  if (!any) return null;
  const unfilteredConditions: ("arguments" | "conditions")[] = filtered ? ["conditions"] : [];
  const category = project.category;
  const resolve = buildResolver(await store.getDictionary(project.id));

  // ---------- Awareness ----------
  const pr = awareness?.routing && awareness.routing.answers > 0 ? awareness.routing : null;
  const ceSource = filtered ? awarenessAll?.explainer : awareness?.explainer;
  const ce = ceSource && ceSource.answers > 0 ? ceSource : null;
  const prRival = pr ? [...pr.brands].filter((b) => !b.you).sort((a, b) => b.named.k - a.named.k)[0] : undefined;
  const awarenessStation = station("awareness", project, {
    lead: pr ? m("pr_names", "Names you when the problem is described", pr.namesYou, false) : ce ? m("ce_names", "Names you when the category is explained", ce.namesYou, true) : null,
    sub: [
      ...(pr ? [m("pr_category", `Points them to ${category}`, pr.routed.category, false)] : []),
      ...(pr && ce ? [m("ce_names", "Names you when the category is explained", ce.namesYou, true)] : []),
    ],
    anchor: prRival
      ? { kind: "rival", text: `best rival ${prRival.name} ${pct(prRival.named)}`, cell: prRival.named }
      : null,
    inventory: [
      pr
        ? row("awareness_routing", "Problem recognition", "names you", pr.answers, pr.namesYou, `points them to ${category} ${pct(pr.routed.category)}, to products ${pct(pr.pointsToProducts)}`, false)
        : notAsked("awareness_routing", "Problem recognition", "names you", false),
      ce
        ? row("awareness_explainer", "Category education", "names you", ce.answers, ce.namesYou, `points to products ${pct(ce.pointsToProducts)}`, true)
        : notAsked("awareness_explainer", "Category education", "names you", true),
    ],
  });

  // ---------- Consideration ----------
  const hv = headline && headline.answers > 0 ? headline : null;
  const target = hv?.brands.find((b) => b.role === "target");
  const rivalTop = hv ? hv.brands.filter((b) => b.role !== "target" && b.chosen.k > 0).sort((a, b) => rate(b.shareOfDecided) - rate(a.shareOfDecided))[0] : undefined;
  const allStages = filtered ? headlineAll : headline;
  const criteriaType = reasons?.types.find((t) => t.key === "criteria_taught");
  const criteriaTop = reasons
    ? [...reasons.codes]
        .filter((c) => (c.byType.criteria_taught?.k ?? 0) > 0)
        .sort((a, b) => rate(b.byType.criteria_taught!) - rate(a.byType.criteria_taught!))
        .slice(0, 3)
        .map((c) => c.label)
    : [];
  const lift = summary?.reasonLift ?? [];
  const forYou = lift.filter((r) => r.lift > 0).slice(0, 2);
  const against = lift.filter((r) => r.lift < 0).slice(-2).reverse();
  const considerationStation = station("consideration", project, {
    lead: target ? m("share_of_decided", "Win rate when one is picked", target.shareOfDecided, false) : null,
    sub: target ? [m("chosen", "Picked in all answers", target.chosen, false), m("mentioned", "Named", target.mentioned, false)] : [],
    anchor: rivalTop ? { kind: "rival", text: `best rival ${rivalTop.name} ${pct(rivalTop.shareOfDecided)}`, cell: rivalTop.shareOfDecided } : null,
    inventory: [
      stageRow(headline, "discovery", "Discovery", false),
      stageRow(headline, "use_case", "Use-case fit", false),
      stageRow(allStages, "social_validation", "Social validation", true),
      premium && premium.answers > 0
        ? row("premium_tier", "Premium vs basic", "picked", premium.answers, premium.picksYou, `backs the premium end ${pct(premium.stance.premium)}, the basic end ${pct(premium.stance.basic)}`, true)
        : notAsked("premium_tier", "Premium vs basic", "picked", true),
      criteriaType && criteriaType.answers > 0
        ? row("criteria_taught", "Criteria", "criteria taught", criteriaType.answers, null, criteriaTop.length > 0 ? `most taught: ${criteriaTop.join(", ")}` : "no criteria taught", false)
        : notAsked("criteria_taught", "Criteria", "criteria taught", false),
    ],
    // The pick set is the SAME under every buyer (Tyler, 2026-11-01): every
    // brand picked anywhere across all buyers, plus you. Under a room filter
    // a brand nobody picked there shows at 0% rather than vanishing - a
    // tracked rival never chosen for this buyer is a finding, and a stable
    // set reads across buyers.
    picks: (() => {
      const base = (filtered ? headlineAll : headline) ?? null;
      if (!hv || !base || base.answers === 0) return [];
      const set = base.brands.filter((b) => b.chosen.k > 0 || b.role === "target");
      const here = new Map(hv.brands.map((b) => [b.key, b] as const));
      const decided = hv.brands.find((b) => b.role === "target")?.shareOfDecided.n ?? 0;
      return set
        .map((b) => {
          const h = here.get(b.key);
          return { name: b.name, role: roleOfBrand(b.role), cell: h ? h.shareOfDecided : cell(0, decided) };
        })
        .sort((a, b) => rate(b.cell) - rate(a.cell) || a.name.localeCompare(b.name));
    })(),
    arguments: filtered
      ? roomArgumentsOf(reasons)
      : [...forYou, ...against].map((r) => ({ code: r.code, forYou: r.lift > 0, inYourPicks: r.wins, inRivalPicks: r.others })),
    conditions: room !== undefined ? roomConditionsOf(rules, room, resolve) : conditionsOf(rules, "consideration", resolve),
  });

  // ---------- Comparison ----------
  const entity = h2h?.entity && h2h.entity.answers > 0 ? h2h.entity : null;
  const klass = h2h?.class && h2h.class.answers > 0 ? h2h.class : null;
  const offensive = alts?.offensive && alts.offensive.answers > 0 ? alts.offensive : null;
  const decidedRows = entity ? entity.rows.filter((r) => r.winOfDecided.n > 0) : [];
  const closest = [...decidedRows].sort((a, b) => margin(a) - margin(b))[0];
  const widest = [...decidedRows].sort((a, b) => margin(b) - margin(a))[0];
  const h2hRow = (prefix: string, r: HeadToHeadRow) =>
    row(`${prefix}:${r.key}`, `Against ${r.rival}`, "you win", r.answers, r.won, `two-way ${pct(r.winOfDecided)}, ${r.rival} wins ${pct(r.lost)}`, true);
  const comparisonStation = station("comparison", project, {
    lead: entity ? m("h2h_won", "You win against a named rival", entity.overall.won, true) : klass ? m("h2h_class_won", "You win against a class", klass.overall.won, true) : null,
    sub: [
      ...(entity && klass ? [m("h2h_class_won", "You win against a class", klass.overall.won, true)] : []),
      ...(offensive ? [m("leavers_captured", "A rival's leavers pick you", offensive.overall.captured, true)] : []),
    ],
    anchor:
      closest && widest
        ? { kind: "range", text: `closest ${closest.rival} ${pct(closest.winOfDecided)}, widest ${widest.rival} ${pct(widest.winOfDecided)}`, cell: closest.winOfDecided }
        : null,
    inventory: [
      ...(entity ? entity.rows.map((r) => h2hRow("head_to_head_entity", r)) : [notAsked("head_to_head_entity", "Against a named rival", "you win", true)]),
      ...(klass ? klass.rows.map((r) => h2hRow("head_to_head_class", r)) : [notAsked("head_to_head_class", "Against a class", "you win", true)]),
      ...(offensive
        ? offensive.rows.map((r) => row(`offensive_capture:${r.key}`, `Leaving ${r.rival}`, "picks you", r.answers, r.captured, `named ${pct(r.named)}${r.captors[0] ? `, most picked ${r.captors[0].name}` : ""}`, true))
        : [notAsked("offensive_capture", "A rival's leavers", "picks you", true)]),
    ],
    picks: entity ? entity.rows.map((r) => ({ name: r.rival, role: "rival" as const, cell: r.winOfDecided })) : [],
    conditions: conditionsOf(rules, "comparison", resolve),
    unfiltered: unfilteredConditions,
  });

  // ---------- Doubts (buyers' worries only) ----------
  const obj = doubt?.objections && doubt.objections.answers > 0 ? doubt.objections : null;
  const worryRows = obj ? obj.rows.filter((r) => r.answers > 0) : [];
  const minW = [...worryRows].sort((a, b) => rate(a.verdicts.proceed) - rate(b.verdicts.proceed))[0];
  const maxW = [...worryRows].sort((a, b) => rate(b.verdicts.proceed) - rate(a.verdicts.proceed))[0];
  const doubtsStation = station("doubts", project, {
    lead: obj ? m("go_ahead", "Told to go ahead", obj.verdicts.proceed, true) : null,
    sub: obj ? [m("agrees", "Agrees with the worry", obj.premise.confirms, true)] : [],
    anchor:
      minW && maxW && minW !== maxW
        ? { kind: "range", text: `from ${pct(minW.verdicts.proceed)} on "${minW.concern || "a worry"}" to ${pct(maxW.verdicts.proceed)} on "${maxW.concern || "a worry"}"`, cell: minW.verdicts.proceed }
        : null,
    inventory: worryRows.length
      ? worryRows.map((r) =>
          row(`doubt:${r.key}`, r.concern || "A buyer's worry", "go ahead", r.answers, r.verdicts.proceed, `agrees with the worry ${pct(r.premise.confirms)}, points them to another brand ${pct(r.offersExit)}`, true)
        )
      : [notAsked("doubt", "A buyer's worry", "go ahead", true)],
    conditions: conditionsOf(rules, "doubts", resolve),
    unfiltered: unfilteredConditions,
  });

  // ---------- Value ----------
  const val = value && value.answers > 0 ? value : null;
  const topInstead = val?.instead[0];
  const valueStation = station("value", project, {
    lead: val ? m("worth_it", "Worth it", val.worth.yes, false) : null,
    sub: val ? [m("not_worth_it", "Not worth it", val.worth.no, false)] : [],
    anchor: topInstead && val ? { kind: "named_instead", text: `${topInstead.name} recommended instead`, cell: cell(topInstead.n, val.recommendsInstead.n) } : null,
    inventory: val
      ? val.rooms.map((r) =>
          row(`value:${r.key}`, r.label, "worth it", r.answers, r.worth.yes, `${r.line ? `${r.line}, ` : ""}not worth it ${pct(r.worth.no)}${r.instead[0] ? `, ${r.instead[0].name} recommended instead` : ""}`, false)
        )
      : [notAsked("value", "Worth it over a cheaper option", "worth it", false)],
    conditions: room !== undefined ? roomConditionsOf(rules, room, resolve) : conditionsOf(rules, "value", resolve),
  });

  // ---------- Customers ----------
  const keep = doubt?.keepOrLeave && doubt.keepOrLeave.answers > 0 ? doubt.keepOrLeave : null;
  const defensive = alts?.defensive && alts.defensive.answers > 0 ? alts.defensive : null;
  const rep = repertoire && repertoire.answers > 0 ? repertoire : null;
  const bc = settled?.businessCase && settled.businessCase.answers > 0 ? settled.businessCase : null;
  const ex = settled?.expansion && settled.expansion.answers > 0 ? settled.expansion : null;
  const eco = settled?.ecosystem && settled.ecosystem.answers > 0 ? settled.ecosystem : null;
  const adv = settled?.advocacy && settled.advocacy.answers > 0 ? settled.advocacy : null;
  const keepStage = (stage: string, label: string): InventoryRow => {
    const s = keep?.byStage.find((x) => x.key === stage);
    return s && s.answers > 0
      ? row(`keep_or_leave:${stage}`, label, "told to stay", s.answers, s.verdicts.keep, `told to leave ${pct(s.verdicts.leave)}, agrees with the worry ${pct(s.confirms)}`, true)
      : notAsked(`keep_or_leave:${stage}`, label, "told to stay", true);
  };
  const customersStation = station("customer_base", project, {
    lead: keep ? m("worries_stay", "Told to stay", keep.verdicts.keep, true) : null,
    sub: keep ? [m("agrees", "Agrees with the worry", keep.premise.confirms, true)] : [],
    anchor: keep ? { kind: "leave", text: `told to leave ${pct(keep.verdicts.leave)}`, cell: keep.verdicts.leave } : null,
    inventory: [
      keepStage("churn_triggers", "Thinking of leaving"),
      keepStage("renewal", "Up for renewal"),
      defensive
        ? row("defensive_hold", "Weighing a move", "told to stay", defensive.answers, defensive.verdicts.keep, `told to leave ${pct(defensive.verdicts.leave)}, points them to another brand ${pct(defensive.offersExit)}`, true)
        : notAsked("defensive_hold", "Weighing a move", "told to stay", true),
      rep
        ? row("repertoire", "Habit check", "stick with you", rep.answers, rep.verdict.stick, `switch ${pct(rep.verdict.switch)}`, true)
        : notAsked("repertoire", "Habit check", "stick with you", true),
      bc
        ? row("settled_business_case", "Business case", "confident case", bc.answers, bc.caseStrength.strong, `hedged ${pct(bc.caseStrength.hedged)}, undermined ${pct(bc.caseStrength.undermined)}`, true)
        : notAsked("settled_business_case", "Business case", "confident case", true),
      ex
        ? row("settled_expansion", "Doing more with you", "backs the step", ex.answers, ex.growth.backs, `points them to another brand ${pct(ex.growth.redirects)}`, true)
        : notAsked("settled_expansion", "Doing more with you", "backs the step", true),
      eco
        ? row("settled_ecosystem", "What to pair with you", "strengthens the relationship", eco.answers, eco.verdicts.strengthens, eco.pairings.length ? `most paired: ${eco.pairings.slice(0, 3).map((p) => p.name).join(", ")}` : "no pairings named", true)
        : notAsked("settled_ecosystem", "What to pair with you", "strengthens the relationship", true),
      adv
        ? row("settled_advocacy", "Defending you to a critic", "pushes back on the critic", adv.answers, adv.premise.rebuts, `confident case ${pct(adv.caseStrength.strong)}`, true)
        : notAsked("settled_advocacy", "Defending you to a critic", "pushes back on the critic", true),
    ],
    conditions: conditionsOf(rules, "customer_base", resolve),
    unfiltered: unfilteredConditions,
  });

  return {
    version: JOURNEY_VERSION,
    runId: run.id,
    source: any.source,
    brand: project.brand,
    category,
    room: room ?? null,
    rooms,
    stations: [awarenessStation, considerationStation, comparisonStation, doubtsStation, valueStation, customersStation],
  };
}
