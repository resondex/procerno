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
import { RULE_VIEWS, type RuleGroup, type RulePool } from "./rules_explorer";
import { sharedRunThemes } from "./run_themes";
import { isDefaultCondition } from "./condition_groups";
import { EVERY_BUYER, rankGroups, slKey, THEME_VERSION, type DossierTheme, type ThemeMap } from "./reason_themes";
import { isWallWording } from "./wall_wording";
import type { ReasonsView } from "./reasons";
import { computeSettledCached } from "./settled";
import { buildResolver, type Resolver } from "./brand_resolve";
import { roleOf } from "./headline";
import { matchKey } from "../brand_key";
import { STATION_LABEL, stationQuestion, viewsOf, type StationKey, type ViewKey } from "./views";
import { cachedView, cell, requestOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import type { DictionaryEntry, Project, Run } from "../types";

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
 * view and the Consideration and Value reasons from their own question
 * types in that room (j5); Comparison, Doubts and Customers read invariant
 * pools, so their reasons stay run-wide and are listed in the station's
 * `unfiltered`.
 *
 * j4 (2026-11-03, Tyler): every station carries the same three blocks in its
 * own terms - who it routes to (picks), the arguments behind its verdict and
 * the conditions. Picks: Awareness = brands named when the problem is
 * described; Consideration = who gets picked; Comparison = your two-way win
 * per rival; Doubts = brands offered as an exit on buyers' worries; Value =
 * brands recommended instead; Customers = brands offered as a destination on
 * customers' worries and moves (deduped by resolved brand). Arguments split
 * the station's own question types by their verdict (picked, win, worth it,
 * stay; Doubts' premise split is not computed yet), read off the reasons view with the brand summary's floors;
 * `argumentLabels` names the two sides so the client never guesses. Where a
 * station's picks follow the room (Awareness, Consideration, Value) the set
 * is the all-buyers set plus you, zeros where the room picked none.
 *
 * j5 (2026-11-10, Stations option B + A's sweep, ratified): the conditions
 * block becomes the reasons block in the panel grammar the Map and the
 * Rivals dossiers speak. `conditions` (top-3 raw rule-group labels with
 * inline counts) is replaced by `reasons` - per side, the run's dt4 THEME
 * assignment scoped to the station's question types (a filter over the
 * run-wide assignment: the theme call's inputs are the map's run-wide
 * poolInputs, byte-identical, so it is a cache hit and never a new call),
 * ANSWER-GRAIN shares of the station's answers on that side, situation
 * buckets, wall flags, receipt ids per row, and the flat list of every
 * stated reason with its routes (the "See every reason" fold, and the
 * fallback wherever no themes exist - keyless, a failed pass). Under a room
 * filter Consideration and Value read their own question types in that room
 * (was: the room's whole rule slice). StationPart "conditions" -> "reasons".
 * The reasons ride their own cached view (station_reasons) so a journey open
 * never recomputes the rules capture.
 */

/** Bumped whenever the payload shape or a number's meaning changes. */
export const JOURNEY_VERSION = "j6"; // j6 (2026-11-10): the tightened wall test (shown wording only, own-brand complaints excluded)

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

/** One stated reason (a rule-explorer condition group) at a station, on one
 * side. Shares are of the side's base; counts are for tooltips only. */
export interface StationReasonRow {
  label: string;
  /** Formatted share of the side's base ("12%", "<1%"). */
  share: string;
  /** Distinct station answers stating it (tooltips only). */
  answers: number;
  /** Lose side: dictionary brands it routes to, deduped, at most 3; [] on the win side. */
  routes: string[];
  wall?: boolean;
  /** Up to RECEIPT_IDS sample response ids - the receipts. */
  ids: string[];
}

/** A theme row in the station's reasons: the dt4 theme with its situation
 * buckets (DossierTheme, so ReasonList renders it as the Map does), plus its
 * answer count and receipt ids. A reason the theme pass never covered (the
 * lose side's no-named-destination reasons) sits here as a flat row
 * (buckets []), its own label. */
export interface StationReasonTheme extends DossierTheme {
  answers: number;
  ids: string[];
}

export interface StationReasonSide {
  /** Distinct station answers stating any listed reason on this side - every share's denominator (tooltips only). */
  base: number;
  /** [] when no theme map exists (keyless, failed pass) - the flat list is the fallback. */
  themes: StationReasonTheme[];
  /** Every listed reason on this side, largest first, with routes - the fold and the fallback. */
  flat: StationReasonRow[];
}

export interface StationReasons {
  win: StationReasonSide;
  lose: StationReasonSide;
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

export type StationPart = "picks" | "arguments" | "reasons";

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
  /** The station's "who gets picked" block, in the station's terms; [] where it has none. */
  picks: JourneyPick[];
  /** Title of the picks block. */
  picksLabel: string;
  /** One line under the picks title: what each rate is a share of. */
  picksNote: string;
  /** Top 2 for + top 2 against (Consideration unfiltered: brand summary reason lift;
   * otherwise the reasons view's verdict split on the station's types); [] where not applicable. */
  arguments: JourneyArgument[];
  /** The two sides an argument's cells read as: [inYourPicks, inRivalPicks]. */
  argumentLabels: [string, string];
  /** Why the arguments block is empty when it is (a reason, not a count). */
  argumentsNote: string | null;
  /** The station's reasons, both sides (station_reasons view). */
  reasons: StationReasons;
  /** Every number on the station is measured across all buyers by design. */
  invariant: boolean;
  /** Parts shown at their all-buyers value under a room filter
   * ("picks", "arguments", "reasons"); [] without a filter. */
  unfiltered: StationPart[];
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

/** Both pick buckets must hold this many answers (brand summary's floor). */
const ARG_MIN_ANSWERS = 20;
/** A code argued in under this share of the type's answers never lists (brand summary's floor). */
const ARG_MIN_INCIDENCE = 0.02;

/**
 * Top 2 for / top 2 against from the reasons view: a code's incidence among
 * the station's answers on the favorable side of its verdict vs the other
 * side, pooled over the station's question types (each answer sits in one
 * type, so the counts add). Both sides must hold ARG_MIN_ANSWERS and the code
 * must be argued in ARG_MIN_INCIDENCE of the types' answers - the brand
 * summary's floors. For the open-choice type the sides are "picks you" vs
 * "picks another" (any other pick, in-category or not - the brand summary's
 * lift counts other in-category picks only).
 */
function argumentsOf(reasons: ReasonsView | null, types: string[], favorable: string, other: string): JourneyArgument[] {
  const ts = reasons ? reasons.types.filter((x) => types.includes(x.key)) : [];
  if (!reasons || ts.length === 0) return [];
  const bucket = (k: string) => ts.reduce((a, t) => a + (t.verdicts.find((v) => v.key === k)?.answers ?? 0), 0);
  if (bucket(favorable) < ARG_MIN_ANSWERS || bucket(other) < ARG_MIN_ANSWERS) return [];
  const keys = ts.map((t) => t.key);
  const sum = (cells: (RateCell | undefined)[]) =>
    cells.reduce<RateCell | null>((a, c) => (c ? (a ? cell(a.k + c.k, a.n + c.n) : c) : a), null);
  const lift = reasons.codes
    .flatMap((c) => {
      const all = sum(keys.map((k) => c.byType[k]));
      const fav = sum(keys.map((k) => c.byVerdict[k]?.[favorable]));
      const oth = sum(keys.map((k) => c.byVerdict[k]?.[other]));
      if (!all || !fav || !oth || all.n === 0 || all.k / all.n < ARG_MIN_INCIDENCE) return [];
      return [{ code: c.key, wins: fav, others: oth, lift: rate(fav) - rate(oth) }];
    })
    .sort((a, b) => b.lift - a.lift);
  const forYou = lift.filter((r) => r.lift > 0).slice(0, 2);
  const against = lift.filter((r) => r.lift < 0).slice(-2).reverse();
  return [...forYou, ...against].map((r) => ({ code: r.code, forYou: r.lift > 0, inYourPicks: r.wins, inRivalPicks: r.others }));
}

/** A picks list never runs longer than this (the awareness view's own brand cap). */
const PICKS_MAX = 12;

/**
 * The same-set rule for picks that follow the room: the set is every brand
 * in the all-buyers list (plus you, when `you` is given), each read from the
 * room's list, or 0 over the room's base when the room names none.
 */
function sameSet(base: JourneyPick[], here: JourneyPick[], roomBase: number, you?: JourneyPick): JourneyPick[] {
  const at = new Map(here.map((p) => [p.name, p] as const));
  const set = [...base];
  if (you && !set.some((p) => p.role === "target")) set.push(you);
  return set
    .map((p) => (p.role === "target" && you ? you : { ...p, cell: at.get(p.name)?.cell ?? cell(0, roomBase) }))
    .sort((a, b) => rate(b.cell) - rate(a.cell) || a.name.localeCompare(b.name));
}

/* ------------------------------ the reasons ------------------------------ */

/** Receipt ids carried per reason row. */
const RECEIPT_IDS = 5;

const pctOf = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

const EMPTY_SIDE: StationReasonSide = { base: 0, themes: [], flat: [] };
const EMPTY_REASONS: StationReasons = { win: EMPTY_SIDE, lose: EMPTY_SIDE };

/** Every station's reasons for one request (room + engines), keyed by station. */
export type StationReasonsView = Partial<Record<StationKey, StationReasons>>;

/** The stations whose reasons follow the buyer filter (their question types
 * are asked in one buyer's voice). */
const ROOM_REASONS: ReadonlySet<StationKey> = new Set(["consideration", "value"]);

/**
 * One side of a station's reasons, over the rules capture (sharedRules) and
 * the run's theme map for that side. Every count is DISTINCT ANSWERS inside
 * the station's questions (`intents`) - the map's answer-grain rule
 * (themeTreeAnswers): with every engine answering each question, nearly every
 * common reason touches every question, so question grain saturates. Base =
 * the distinct station answers stating any listed reason on the side; a
 * theme's share = its answers / base, a bucket's = its answers in that
 * situation / base, a reason row's = that group's answers in that situation
 * / base. Mirrors themeTreeAnswers (reason_themes.ts) with two additions it
 * does not carry: receipt ids per row, and the side's no-theme reasons
 * (the lose side's "elsewhere" groups, which the theme pass never sees) as
 * flat rows on the same base. `themeLabel` names the label a group is looked
 * up under in the theme map (null = the theme pass never covered it).
 */
export function stationSide(
  groups: RuleGroup[],
  tm: ThemeMap | null,
  themeLabel: (g: RuleGroup) => string | null,
  cellAnswers: Map<string, Map<string, Set<string>>>,
  sitOf: Map<string, string>,
  intents: Set<string>,
  routesOf: ((g: RuleGroup[]) => string[]) | null,
  own?: string | null
): StationReasonSide {
  // Station-scoped answers per group (insertion order = the ranked group
  // order, then intent order: deterministic receipt picks).
  const scoped: { g: RuleGroup; perIntent: [string, Set<string>][]; all: Set<string> }[] = [];
  const base = new Set<string>();
  for (const g of groups) {
    const per = cellAnswers.get(g.id);
    if (!per) continue;
    const perIntent: [string, Set<string>][] = [];
    const all = new Set<string>();
    for (const [c, ids] of per) {
      if (!intents.has(c) || ids.size === 0) continue;
      perIntent.push([c, ids]);
      for (const id of ids) {
        all.add(id);
        base.add(id);
      }
    }
    if (all.size > 0) scoped.push({ g, perIntent, all });
  }
  const n = base.size;
  if (n === 0) return EMPTY_SIDE;
  const take = (ids: Iterable<string>) => {
    const out: string[] = [];
    for (const id of ids) {
      if (out.length >= RECEIPT_IDS) break;
      out.push(id);
    }
    return out;
  };

  // The flat list: one row per condition group (cond), the lose side's
  // "away" and "elsewhere" halves of one condition merged, routes unioned.
  const byCond = new Map<string, { label: string; top: number; members: RuleGroup[]; ids: Set<string>; wall: boolean }>();
  for (const x of scoped) {
    const cur = byCond.get(x.g.cond) ?? { label: x.g.label, top: 0, members: [], ids: new Set<string>(), wall: false };
    if (x.all.size > cur.top) {
      cur.top = x.all.size;
      cur.label = x.g.label;
    }
    cur.members.push(x.g);
    for (const id of x.all) cur.ids.add(id);
    cur.wall = cur.wall || x.g.wall;
    byCond.set(x.g.cond, cur);
  }
  const flat: StationReasonRow[] = [...byCond.values()]
    .sort((a, b) => b.ids.size - a.ids.size || a.label.localeCompare(b.label))
    .map((r) => ({
      label: r.label,
      share: pctOf(r.ids.size / n),
      answers: r.ids.size,
      routes: routesOf ? routesOf(r.members) : [],
      ...(r.wall ? { wall: true } : {}),
      ids: take(r.ids),
    }));

  // The themes: the run's assignment, filtered to the station.
  if (!tm) return { base: n, themes: [], flat };
  type Row = { label: string; ids: Set<string>; o: number };
  type Bucket = { union: Set<string>; groups: Map<string, Row> };
  const tots = new Map<number, { union: Set<string>; buckets: Map<number, Bucket> }>();
  const raw = new Map<string, { label: string; ids: Set<string>; wall: boolean }>();
  scoped.forEach((x, o) => {
    const lbl = themeLabel(x.g);
    for (const [c, ids] of x.perIntent) {
      const s = lbl === null ? undefined : tm.stOf.get(slKey(sitOf.get(c) ?? EVERY_BUYER, lbl));
      if (s === undefined) {
        // Outside the theme pass: its own flat row on the same base.
        const r = raw.get(x.g.cond) ?? { label: x.g.label, ids: new Set<string>(), wall: false };
        for (const id of ids) r.ids.add(id);
        r.wall = r.wall || x.g.wall;
        raw.set(x.g.cond, r);
        continue;
      }
      const t = tm.totOf[s];
      const tot = tots.get(t) ?? { union: new Set<string>(), buckets: new Map<number, Bucket>() };
      tots.set(t, tot);
      const b = tot.buckets.get(s) ?? { union: new Set<string>(), groups: new Map<string, Row>() };
      tot.buckets.set(s, b);
      const row = b.groups.get(x.g.id) ?? { label: x.g.label, ids: new Set<string>(), o };
      b.groups.set(x.g.id, row);
      for (const id of ids) {
        tot.union.add(id);
        b.union.add(id);
        row.ids.add(id);
      }
    }
  });
  if (tots.size === 0) return { base: n, themes: [], flat };
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // routesOf is the away side's marker; an away wording naming the brand itself is no wall.
  const wallOf = (label: string) => isWallWording([label], routesOf ? own : null);
  const themed: StationReasonTheme[] = [...tots.entries()].map(([t, tot]) => {
    const buckets = [...tot.buckets.entries()]
      .map(([s, b]) => {
        const rows = [...b.groups.values()].sort((x, y) => y.ids.size - x.ids.size || x.o - y.o);
        const label = tm.stName[s];
        const single = rows.length === 1 && same(rows[0].label, label);
        return {
          n: b.union.size,
          bucket: {
            scenario: tm.stSit[s],
            label,
            share: pctOf(b.union.size / n),
            members: single ? [] : rows.map((r) => ({ label: r.label, share: pctOf(r.ids.size / n), ...(wallOf(r.label) ? { wall: true } : {}) })),
            ...(single && wallOf(label) ? { wall: true } : {}),
          },
        };
      })
      .sort((a, b) => b.n - a.n || a.bucket.label.localeCompare(b.bucket.label))
      .map((x) => x.bucket);
    const label = tm.totName[t];
    const flatTheme = buckets.length === 1 && buckets[0].members.length === 0 && same(buckets[0].label, label);
    return {
      label,
      share: pctOf(tot.union.size / n),
      buckets: flatTheme ? [] : buckets,
      ...(flatTheme && wallOf(label) ? { wall: true } : {}),
      answers: tot.union.size,
      ids: take(tot.union),
    };
  });
  for (const r of raw.values())
    themed.push({ label: r.label, share: pctOf(r.ids.size / n), buckets: [], ...(r.wall ? { wall: true } : {}), answers: r.ids.size, ids: take(r.ids) });
  themed.sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));
  return { base: n, themes: themed, flat };
}

/**
 * Every station's reasons for one request. The rules capture and the two
 * theme maps are the analysis map's own: sharedRules over the engines-only
 * request, the side pools built exactly as the map builds them (ranked, the
 * default clause left out), so themeReasons' calls carry byte-identical
 * inputs and key the same dt4 cache entries - station scoping is a filter
 * over that assignment (the station's intents), never a new call. Keyless or
 * a non-gpt theme model -> no theme maps, flat lists only; a failed pass ->
 * flat lists and the view is served uncached (judgeIncomplete), as the map.
 */
export async function computeStationReasons(data: ViewData, request: ViewRequest = {}): Promise<StationReasonsView> {
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  // 2026-11-12: the rules capture, the side pools and both theme maps are the
  // run's shared pass (run_themes.ts sharedRunThemes) - the very pools this
  // function used to build inline, so the dt4 calls key identically.
  const rt = await sharedRunThemes(data, eng);
  const shared = rt.rules;
  const { sitOf, towardPool, awayPool } = rt;
  const groups = shared.rules.groups;
  // The lose side also lists "elsewhere" (no named in-category destination);
  // the theme pass only ever saw "away", so those carry no theme of their own.
  const elsewherePool = rankGroups(groups.filter((g) => g.side === "elsewhere")).filter((g) => !isDefaultCondition(g.label));
  const towardMap: ThemeMap | null = rt.toward;
  const awayMap: ThemeMap | null = rt.away;

  // Intent -> the rule pool computeRules assigns it (the first RULE_VIEWS match).
  const poolOfIntent = new Map<string, RulePool>();
  for (const it of data.intents) {
    const views = viewsOf(it.stage, it.angle);
    const hit = RULE_VIEWS.find(([v]) => views.includes(v));
    if (hit) poolOfIntent.set(it.id, hit[1]);
  }
  const resolve = buildResolver(data.dictionary, data.judged);
  // An "elsewhere" half of a condition the "away" pass themed reads under that theme.
  const awayLabelByCond = new Map(awayPool.map((g) => [g.cond, g.label] as const));
  const loseGroups = rankGroups([...awayPool, ...elsewherePool]);
  const routesOf = (gs: RuleGroup[]) => dictionaryRoutes(gs.flatMap((g) => g.routes.map((r) => r.name)), resolve);

  const out: StationReasonsView = {};
  for (const key of Object.keys(STATION_POOLS) as StationKey[]) {
    const pools = new Set(STATION_POOLS[key]);
    if (pools.size === 0) continue;
    const intents = new Set<string>();
    for (const it of data.intents) {
      const p = poolOfIntent.get(it.id);
      if (!p || !pools.has(p)) continue;
      if (request.room !== undefined && ROOM_REASONS.has(key) && it.situation !== request.room) continue;
      intents.add(it.id);
    }
    if (intents.size === 0) {
      out[key] = EMPTY_REASONS;
      continue;
    }
    out[key] = {
      win: stationSide(towardPool, towardMap, (g) => g.label, shared.cellAnswers, sitOf, intents, null),
      lose: stationSide(
        loseGroups,
        awayMap,
        (g) => (g.side === "away" ? g.label : awayLabelByCond.get(g.cond) ?? null),
        shared.cellAnswers,
        sitOf,
        intents,
        routesOf,
        data.project.brand
      ),
    };
  }
  return out;
}

/** The station reasons through the view cache. The key carries the theme
 * version (the theme labels are embedded) beside the journey version;
 * rules-explorer grouping changes ride manually, as for the map. */
export function computeStationReasonsCached(run: Run, project: Project, request: ViewRequest = {}): Promise<StationReasonsView | null> {
  const r = requestOf(request, true);
  return cachedView("station_reasons", `${JOURNEY_VERSION}.${THEME_VERSION}`, run, project, (d) => computeStationReasons(d, r), { judge: true }, r);
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
    picksLabel: string;
    picksNote: string;
    arguments?: JourneyArgument[];
    argumentLabels: [string, string];
    argumentsNote?: string | null;
    reasons?: StationReasons;
    unfiltered?: StationPart[];
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
    picksLabel: parts.picksLabel,
    picksNote: parts.picksNote,
    arguments: parts.arguments ?? [],
    argumentLabels: parts.argumentLabels,
    argumentsNote: parts.argumentsNote ?? null,
    reasons: parts.reasons ?? EMPTY_REASONS,
    invariant: nums.length > 0 && nums.every((x) => x.invariant),
    unfiltered: parts.unfiltered ?? [],
  };
}

const roleOfBrand = (r: string): JourneyPick["role"] => (r === "target" ? "target" : r === "competitor" ? "rival" : "other");

/** A picks role for a brand known only by name, through the current dictionary. */
function nameRoles(project: Project, dictionary: DictionaryEntry[], resolve: Resolver) {
  const targetKey = resolve(project.brand).key;
  const entryById = new Map(dictionary.map((e) => [e.id, e]));
  const legacy = new Set(project.competitors.map(matchKey));
  return (name: string): JourneyPick["role"] => {
    const r = resolve(name);
    if (r.key === targetKey) return "target";
    if (r.status !== "active") return "other";
    return roleOfBrand(roleOf(r.key, targetKey, entryById.get(r.key) ?? null, legacy));
  };
}

/** A headline stage row for the consideration inventory. */
function stageRow(view: HeadlineView | null, stage: string, label: string, invariant: boolean): InventoryRow {
  const s = view?.byStage.find((x) => x.key === stage);
  if (!s || s.answers === 0) return notAsked(`headline:${stage}`, label, "picked", invariant);
  return row(`headline:${stage}`, label, "picked", s.answers, s.chosen, `named ${pct(s.mentioned)}, one brand picked in ${pct(s.firmPickInCategory)}`, invariant);
}

/** Margin from an even two-way split - the closest and widest rivals. */
const margin = (r: HeadToHeadRow) => Math.abs(rate(r.winOfDecided) - 0.5);

/** `request.engines` (the Panel lens) narrows every view the map reads;
 * `request.room` reaches only the room-pinned ones (see above). */
export async function computeJourney(run: Run, project: Project, request: ViewRequest = {}): Promise<JourneyView | null> {
  const room = request.room;
  const filtered = room !== undefined;
  // Every view: the engine set only. Room-pinned views: the room too.
  const all: ViewRequest = request.engines ? { engines: request.engines } : {};
  const pinned: ViewRequest = filtered ? { ...all, room } : all;
  const [headline, headlineAll, awareness, awarenessAll, h2h, alts, doubt, value, valueAll, repertoire, premium, reasons, reasonsAll, summary, stationReasons, settled, rooms] =
    await Promise.all([
      computeHeadlineCached(run, project, pinned),
      filtered ? computeHeadlineCached(run, project, all) : Promise.resolve(null),
      computeAwarenessCached(run, project, pinned),
      filtered ? computeAwarenessCached(run, project, all) : Promise.resolve(null),
      computeHeadToHeadCached(run, project, all),
      computeAlternativesCached(run, project, all),
      computeDoubtCached(run, project, all),
      computeValueCached(run, project, pinned),
      filtered ? computeValueCached(run, project, all) : Promise.resolve(null),
      computeRepertoireCached(run, project, all),
      computePremiumCached(run, project, all),
      computeReasonsCached(run, project, pinned),
      // The invariant stations' arguments read the all-buyers reasons view (the
      // room-filtered one drops every type not asked in one buyer's voice).
      filtered ? computeReasonsCached(run, project, all) : Promise.resolve(null),
      // Under a room filter the arguments come from the room-filtered reasons view.
      filtered ? Promise.resolve(null) : computeBrandSummaryCached(run, project, all),
      // The reasons blocks: one cached view for every station; the room reaches
      // only the room-pinned question types inside it.
      computeStationReasonsCached(run, project, pinned),
      computeSettledCached(run, project, all),
      roomsOf(project),
    ]);
  // Every view reads the same codes source; no source = nothing coded to map.
  const any = headline ?? headlineAll ?? h2h ?? doubt ?? alts;
  if (!any) return null;
  const invariantParts: StationPart[] = filtered ? ["picks", "arguments", "reasons"] : [];
  const reasonsOf = (key: StationKey): StationReasons => stationReasons?.[key] ?? EMPTY_REASONS;
  const category = project.category;
  const dictionary = await store.getDictionary(project.id);
  const resolve = buildResolver(dictionary);
  const roleByName = nameRoles(project, dictionary, resolve);
  const reasonsBase = filtered ? reasonsAll : reasons;

  // ---------- Awareness ----------
  const pr = awareness?.routing && awareness.routing.answers > 0 ? awareness.routing : null;
  const ceSource = filtered ? awarenessAll?.explainer : awareness?.explainer;
  const ce = ceSource && ceSource.answers > 0 ? ceSource : null;
  const prRival = pr ? [...pr.brands].filter((b) => !b.you).sort((a, b) => b.named.k - a.named.k)[0] : undefined;
  // Picks = brands named when the problem is described (problem recognition,
  // room-pinned, same-set rule). A tracker that asks no problem recognition
  // at all reads the category explainer's names instead (asked across all buyers).
  const prAll = (filtered ? awarenessAll?.routing : awareness?.routing) ?? null;
  const hasRouting = !!prAll && prAll.answers > 0;
  const awarenessPickList = (b: { name: string; you: boolean; named: RateCell }[]): JourneyPick[] =>
    b.map((x) => ({ name: x.name, role: x.you ? "target" : roleByName(x.name), cell: x.named }));
  const awarenessPicks: JourneyPick[] = (() => {
    if (hasRouting) {
      if (!pr) return [];
      const you: JourneyPick = { name: project.brand, role: "target", cell: pr.namesYou };
      const youIn = pr.brands.find((b) => b.you);
      if (youIn) you.name = youIn.name;
      return sameSet(awarenessPickList(prAll!.brands), awarenessPickList(pr.brands), pr.namesYou.n, you);
    }
    if (!ce) return [];
    return awarenessPickList(ce.brands)
      .sort((a, b) => rate(b.cell) - rate(a.cell) || a.name.localeCompare(b.name))
      .slice(0, PICKS_MAX);
  })();
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
    picks: awarenessPicks,
    picksLabel: "Who it names",
    picksNote: hasRouting
      ? "Share of answers to a described problem that name each brand."
      : "Share of answers explaining the category that name each brand.",
    // Awareness answers carry topics, never arguments for or against a brand:
    // the reasons view leaves awareness stages out.
    arguments: [],
    argumentLabels: ["when you are named", "when you are not"],
    argumentsNote: "Awareness answers are coded for the topics they raise, not for arguments for or against a brand.",
    unfiltered: filtered && !hasRouting && awarenessPicks.length > 0 ? ["picks"] : [],
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
    picksLabel: "Who gets picked",
    picksNote: "Each brand's share of the answers that pick one brand in the category.",
    arguments: filtered
      ? argumentsOf(reasons, ["headline"], "you", "other")
      : [...forYou, ...against].map((r) => ({ code: r.code, forYou: r.lift > 0, inYourPicks: r.wins, inRivalPicks: r.others })),
    argumentLabels: ["when you are picked", "when another brand is picked"],
    reasons: reasonsOf("consideration"),
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
    picksLabel: "Who wins each head-to-head",
    picksNote: "Your win rate against each named rival, when one of the two is picked.",
    arguments: argumentsOf(reasonsBase, ["head_to_head_entity", "head_to_head_class"], "you", "other"),
    argumentLabels: ["when you win", "when the rival wins"],
    reasons: reasonsOf("comparison"),
    unfiltered: invariantParts,
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
    picks: obj ? obj.exits.slice(0, PICKS_MAX).map((x) => ({ name: x.name, role: roleOfBrand(x.role), cell: x.offered })) : [],
    picksLabel: "Where it sends them instead",
    picksNote: "Share of answers to a buyer's worry that offer each brand as another option.",
    // Favorable side = the AI REBUTS the worry (a confirmed worry is the
    // argument against you).
    arguments: argumentsOf(reasonsBase, ["doubt"], "rebuts", "confirms"),
    argumentLabels: ["when it rebuts the worry", "when it agrees the worry is warranted"],
    reasons: reasonsOf("doubts"),
    unfiltered: invariantParts,
  });

  // ---------- Value ----------
  const val = value && value.answers > 0 ? value : null;
  const topInstead = val?.instead[0];
  // Picks = brands recommended instead, as a share of the value answers
  // (room-pinned, same-set rule over the all-buyers list).
  const insteadList = (v: { worth: { yes: RateCell }; instead: { name: string; n: number }[] }): JourneyPick[] =>
    v.instead.map((x) => ({ name: x.name, role: roleByName(x.name), cell: cell(x.n, v.worth.yes.n) }));
  const valBase = (filtered ? valueAll : value) ?? null;
  const valuePicks: JourneyPick[] =
    !val || !valBase || valBase.answers === 0
      ? []
      : filtered
        ? sameSet(insteadList(valBase), insteadList(val), val.worth.yes.n)
        : insteadList(val).sort((a, b) => rate(b.cell) - rate(a.cell) || a.name.localeCompare(b.name));
  const valueStation = station("value", project, {
    lead: val ? m("worth_it", "Worth it", val.worth.yes, false) : null,
    sub: val ? [m("not_worth_it", "Not worth it", val.worth.no, false)] : [],
    anchor: topInstead && val ? { kind: "named_instead", text: `${topInstead.name} recommended instead`, cell: cell(topInstead.n, val.recommendsInstead.n) } : null,
    inventory: val
      ? val.rooms.map((r) =>
          row(`value:${r.key}`, r.label, "worth it", r.answers, r.worth.yes, `${r.line ? `${r.line}, ` : ""}not worth it ${pct(r.worth.no)}${r.instead[0] ? `, ${r.instead[0].name} recommended instead` : ""}`, false)
        )
      : [notAsked("value", "Worth it over a cheaper option", "worth it", false)],
    picks: valuePicks,
    picksLabel: "Who is recommended instead",
    picksNote: "Share of value answers that recommend each brand instead of you.",
    arguments: argumentsOf(reasons, ["value"], "yes", "no"),
    argumentLabels: ["when worth it", "when not worth it"],
    reasons: reasonsOf("value"),
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
  // Picks = brands offered as a destination on customers' worries (churn,
  // renewal) and on a customer weighing a move, deduped by resolved brand.
  // The two pools are disjoint answers, so offers add and the base is both pools.
  const customerPicks: JourneyPick[] = (() => {
    const pools = [
      ...(keep ? [{ n: keep.offersExit.n, rows: keep.exits }] : []),
      ...(defensive ? [{ n: defensive.offersExit.n, rows: defensive.destinations }] : []),
    ];
    const n = pools.reduce((a, p) => a + p.n, 0);
    if (n === 0) return [];
    const by = new Map<string, { name: string; role: JourneyPick["role"]; k: number }>();
    for (const p of pools)
      for (const r of p.rows) {
        const cur = by.get(r.key) ?? { name: r.name, role: roleOfBrand(r.role), k: 0 };
        cur.k += r.offered.k;
        by.set(r.key, cur);
      }
    return [...by.values()]
      .map((x) => ({ name: x.name, role: x.role, cell: cell(x.k, n) }))
      .sort((a, b) => rate(b.cell) - rate(a.cell) || a.name.localeCompare(b.name))
      .slice(0, PICKS_MAX);
  })();
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
    picks: customerPicks,
    picksLabel: "Where it sends your customers",
    picksNote: "Share of answers to a customer's worry or a customer weighing a move that offer each brand as somewhere to go.",
    arguments: argumentsOf(reasonsBase, ["keep_or_leave", "defensive_hold"], "keep", "leave"),
    argumentLabels: ["when told to stay", "when told to leave"],
    reasons: reasonsOf("customer_base"),
    unfiltered: invariantParts,
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
