import { buildResolver, type Resolved, type Resolver } from "./brand_resolve";
import { containsSeq, famTokens } from "./brand_family";
import { excludedWords } from "./definition_overlap";
import { conditionKeysFor, conditionStemKey } from "./condition_groups";
import { ENUM_TOWARD, GENERIC_AWAY } from "./rules_explorer";
import { isWallWording } from "./wall_wording";
import { computeBrandSummary, type BrandSummaryView, type Insight } from "./brand_summary";
import { computeValue, type ValueRow } from "./value";
import { exitResolver } from "./exits";
import { ENGINES, engineDisplayLabel } from "./providers";
import { viewsOf, type ViewKey } from "./views";
import { cachedView, cell, condCache, coreOf, facetsOf, poolOf, requestOf, type PoolRow, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import {
  type AnalysisMapView,
  type Archetype,
  type CastingLine,
  type CellBadge,
  type CellVerdict,
  type ConditionItem,
  type LiftItem,
  type MapBand,
  type MapCell,
  type MapRow,
  type Position,
  type PositionReceipt,
  type PositionStatus,
  type Triage,
} from "./analysis_types";
import type { DictionaryEntry, Intent, Project, Run } from "../types";

/**
 * The analysis map (2026-11-03, ANALYSIS_REDESIGN_2026-11-03.md, "Map
 * refinement" + "Alternatives considered" amendment 2): the coverage map
 * banded by what each contest varies by, one POSITION per cell, the casting
 * line and the memo tensions - one payload, computed from answer_codes under
 * the project's codes source with zero model calls (the context judge's
 * cached verdicts are read like every other view; condition grouping is the
 * run-wide embeddings grouping with the deterministic stem fallback).
 *
 * BANDS (a row exists only when its cells do; a cell only when it has answers):
 *   "Where the buyer chooses"  - per ROOM (intent situations in setup order):
 *       Open choice (discovery + use-case, per room); Social validation
 *       (base-voiced, one wide cell); Awareness (problem recognition per room;
 *       a base-voiced problem cell is wide); Learning the category (category
 *       education, wide); Value (per room, labelled "room - line" from the
 *       confirmed setup decision); Premium vs basic (wide); Criteria taught
 *       (per room when room-pinned, else wide).
 *   "The named fights" - Head-to-head (one cell per entity rival, then one
 *       per class brand); Rival leavers (one cell per rival angle when the
 *       offensive cells carry 2+ angles, else one wide cell).
 *   "The doubts" - Buyers' worries (one cell per objections concern);
 *       Customers' worries (one per churn/renewal concern); Holding your own
 *       (wide); Repertoire (wide).
 *   "The settled customer" - one cell per Set C stage present.
 * Cell ids: "<band>:<row>:<key>", key = the stored room / rival / worry /
 * stage trimmed and lowercased ("all" on a wide cell). A worry voiced at both
 * churn and renewal keeps two cells, keyed "<concern>|<stage>".
 *
 * VERDICT (per cell, within its own pool only - never pooled across cells):
 * each cell defines a brand side and a taker side over a side-taking
 * denominator D, then
 *   nocall    - D < MIN_SIDE (20) or neither side holds an answer;
 *   yours     - the brand's Wilson 95% range sits wholly above the taker's;
 *   theirs    - the taker's range sits wholly above the brand's;
 *   contested - the ranges overlap and both sides hold >= MATERIAL (15%) of
 *               D, or both sit under it (a fragmented split);
 *   otherwise (overlap, one side under 15%) the larger side takes the call -
 *               the overlap there is thin-sample noise, not a split.
 * Sides by band:
 *   open choice / social / premium - your picks vs the top other in-category
 *     brand's picks, over in-category picks (brand_resolve + context judge,
 *     exactly as headline.ts; B5);
 *   head-to-head - won vs lost (the two-way record); rival leavers - captured
 *     vs the top captor, over in-category picks;
 *   buyers' worries - go ahead vs conceded (avoid, or the AI agrees the worry
 *     is warranted without telling the buyer to go ahead). "Avoid" alone is
 *     too rare to ever clear the floor (reasons.ts r6), so the concession is
 *     the unfavorable side the cell actually carries;
 *   customers' worries / holding your own - stay vs leave; repertoire -
 *     stick with you vs switch;
 *   value - worth it vs not worth it;
 *   awareness - answers recommending you vs answers recommending the top
 *     rival, over answers recommending any in-category brand;
 *   criteria taught - mechanical overlap: the cell's five most-taught codes
 *     against the tracker's winning arguments (positive open-choice lift
 *     whose ranges separate, top 3) and losing ones (negative, top 3):
 *     theirs when no winner is taught, yours when a winner is taught and no
 *     loser is, contested when both; nocall under 20 criteria answers or
 *     with no lift list;
 *   settled - strengthens vs weakens.
 *
 * BADGES:
 *   leak    - out-of-category picks (ruled out, pending or unknown names)
 *             >= 10% of the cell's firm picks, with >= 20 firm picks;
 *   inhouse - value cells: of the doubting answers that point anywhere, the
 *             share pointing to the brand's own cheaper rung (value.ts v6
 *             ownRung vs recommendsInstead) >= 50%, with >= 20 doubting;
 *   watch   - (a) one engine supplies >= 40% of the cell's brand-side answers
 *             (>= 10 of them), or (b) settled advocacy / business-case cells
 *             when the advocacy-vs-objection signal holds (summary_insights:
 *             advocacy strengthens or strong >= 50% AND buyers' worries
 *             agreed >= 50%, both >= 20 answers);
 *   wall    - one of the cell's top-3 away condition groups (>= WALL_MIN
 *             grouped answers) is possession/state-shaped (WALL_PATTERN, not
 *             WANT_PATTERN - see isWallWording).
 *
 * POSITIONS: status = surplus (yours), deficit (theirs, or contested with
 * the taker ahead), watch (nocall, contested even or leaning toward you, an
 * engine-dependent cell, or a value loss caught in-house). Triage, first match:
 *   surplus/watch with yours: overclaimed when a watch badge fired, else earned
 *     (windfall needs an untargeted room; every room on the map was confirmed
 *     at setup, so it is never suggested on a room cell);
 *   inhouse value loss: windfall (the loss stays in the brand's own ladder);
 *   deficit: strategy_misfit for a wall or a leak; proof_missing for criteria
 *     theirs/contested, or a buyers' worry conceded >= 50% and still given the
 *     go-ahead in >= 30% of those; product_truth when >= 3 vendors each carry
 *     the deficit (taker side ahead on >= 5 side-taking answers) and none
 *     runs the other way; strategy_misfit when the cell's away conditions
 *     describe the median buyer (proxy until the narrow/median classifier
 *     ships: the top away group is >= 2x the top toward group and covers >=
 *     10% of the cell's rule-bearing answers); proof_missing otherwise;
 *   nocall: earned when no rival holds the cell, else proof_missing.
 *   record_wrong is never suggested: no stale-fact signal is stored on the
 *   code rows, and a triage the engine cannot support is not faked.
 *
 * CASTING (decision tree, first match; facts from the open choice, the
 * prompted head-to-head record pooled over the entity rivals, and the
 * mentions). "Leads" = your share of decided picks is the highest or within
 * DEFAULT_MARGIN (5 points) of the top brand's; "wins prompted" = the pooled
 * two-way record is >= 50% (or no head-to-heads were asked).
 *   1 default    - leads AND wins prompted;
 *   2 reference  - the most-named brand in the open choice, loses prompted,
 *                  and sits within 15 points of the top brand's share of
 *                  decided (explained against, not recommended);
 *   3 challenger - the prompted record is >= 60% and beats the open share of
 *                  decided by >= 30 points, you are the second-most-picked
 *                  brand, and you + the top brand hold >= 60% of decided
 *                  picks (a two-brand open choice lost to one default);
 *   4 companion  - wins prompted, and you are recommended beside another
 *                  brand's pick in >= 30% of the open-choice answers that
 *                  pick another in-category brand;
 *   5 specialist - everything else (named widely, picked when the buyer
 *                  matches, losing the named fights).
 * Fixture ground truth (harness): American Express specialist, Jira
 * reference, Google Pixel challenger, Netflix default, Doritos companion.
 */

export type { RateCell };

/* ------------------------------ constants ------------------------------ */

const MIN_SIDE = 20;
const MATERIAL = 0.15;
const LEAK_SHARE = 0.1;
const INHOUSE_SHARE = 0.5;
const WATCH_ENGINE_SHARE = 0.4;
const WATCH_ENGINE_MIN = 10;
const LIFT_MIN = 10;
const LIFT_MIN_INCIDENCE = 0.05;
const LIFT_TOP = 8;
const COND_TOP = 6;
const RECEIPTS = 5;
const WALL_MIN = 5;
const DEFAULT_MARGIN = 0.05;

/* ----------------------------- small helpers ---------------------------- */

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pctOf = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const pct = (c: RateCell) => pctOf(rate(c));
const norm = (s: string) => s.trim().toLowerCase();
const share = (k: number, n: number) => (n > 0 ? k / n : 0);

/* The wall detector lives in wall_wording.ts (shared with the summary insights). */
export { isWallWording };

/* ------------------------------ cell plumbing ----------------------------- */

type BandSlug = "chooses" | "fights" | "doubts" | "settled";

interface Taker {
  name: string;
  kind: string;
}

const TAKER = {
  rival: "a rival",
  default: "the category default",
  undecided: "no single pick - the undecided mass",
  own: "your own lower rung",
  outside: "out of category",
  nobody: "nobody - held",
} as const;

interface CellSpec {
  band: BandSlug;
  row: string;
  rowLabel: string;
  key: string;
  label: string;
  wide?: boolean;
  rows: PoolRow[];
  /** Brand side / taker side of the side-taking denominator. */
  you: PoolRow[];
  them: PoolRow[];
  /** The side-taking denominator both sides are read over (default you +
   * them): in-category picks on choice-shaped cells, answers recommending
   * any in-category brand on awareness cells. */
  sideD?: number;
  taker: Taker;
  /** Notes and claims, filled after the verdict. */
  note: (v: CellVerdict) => string;
  claim: (v: CellVerdict) => string;
  lift?: { wins: PoolRow[]; others: PoolRow[]; note: string };
  lifts?: LiftItem[];
  liftNote?: string;
  leakShare?: number;
  inhouseShare?: number;
  /** Buyers' worries: share agreed, share of agreed still told to go ahead. */
  conceded?: { agree: RateCell; goAheadOfAgreed: RateCell };
  /** Criteria: the computed verdict (no sides). */
  verdictOverride?: { verdict: CellVerdict; lean: number };
  criteria?: { winnerTaught: string | null; winnerUntaught: string | null; taught: string[] };
  settledWatch?: boolean;
  /** Where rules are thin: exits named on the unfavorable side. */
  exitFallback?: { name: string; n: number }[];
}

/** Wilson-separation verdict over a side-taking denominator. lean > 0 = toward you. */
function classify(b: number, t: number, d: number): { verdict: CellVerdict; lean: number } {
  if (d < MIN_SIDE || b + t === 0) return { verdict: "nocall", lean: 0 };
  const B = cell(b, d);
  const T = cell(t, d);
  const lean = Math.sign(b - t);
  if (B.low > T.high) return { verdict: "yours", lean: 1 };
  if (T.low > B.high) return { verdict: "theirs", lean: -1 };
  const bs = b / d;
  const ts = t / d;
  if ((bs >= MATERIAL && ts >= MATERIAL) || (bs < MATERIAL && ts < MATERIAL)) return { verdict: "contested", lean };
  return { verdict: b > t ? "yours" : "theirs", lean };
}

/** Where one rule routes, by its schema's choice vocabulary (rules_explorer's destinationOf). */
function ruleSide(rule: { choice: string; product?: string }, schema: string, resolve: Resolver, targetKey: string): "you" | "away" {
  const choice = rule.choice.trim();
  const product = rule.product?.trim();
  const byName = (r: Resolved) => (r.key === targetKey ? "you" : "away");
  if (schema === "choice" || schema === "expansion" || schema === "ecosystem" || schema === "premium") {
    if (schema === "premium" && !product) return "away";
    return byName(resolve(schema === "premium" ? product! : choice));
  }
  if (product) return byName(resolve(product));
  if (ENUM_TOWARD.has(choice)) return "you";
  if (GENERIC_AWAY[choice]) return "away";
  return byName(resolve(choice));
}

/* ------------------------------- the compute ------------------------------ */

interface Group {
  label: string;
  n: number;
  surfaces: string[];
}

/** One wall-calibration line (exported for the harness). */
export interface WallProbe {
  cellId: string;
  label: string;
  n: number;
  rank: number;
  wall: boolean;
  samples: string[];
}

/** Casting facts (exported for the harness). */
export interface CastingFacts {
  shareYou: number;
  shareTop: number;
  topName: string;
  youTop: boolean;
  named: number;
  picked: number;
  mostNamed: boolean;
  prompted: number | null;
  promptedN: number;
  beside: number;
  besideN: number;
  /** Your place by share of decided picks (1 = most picked). */
  rank: number;
  /** You + the top rival, as a share of the decided picks. */
  topTwo: number;
}

export interface AnalysisMapDebug {
  walls: WallProbe[];
  casting: CastingFacts;
  /** Harness only: insights to place through the tensions' cell matcher
   * (default: the summary's served insights); results land in `placements`.
   * `how` is "match" when a bs8 detector found its own cell, "generic" when
   * it fell back, "other" for the older detectors (not instrumented). */
  probeInsights?: Insight[];
  placements?: { key: string; kind: string; cellId: string | null; how: string }[];
}

export async function computeAnalysisMap(data: ViewData, request: ViewRequest = {}, debug?: AnalysisMapDebug): Promise<AnalysisMapView> {
  const { project, dictionary } = data;
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const brand = project.brand;
  const summary = await computeBrandSummary(data, eng);
  const defaultKey = summary.brands.find((b) => b.role !== "target" && b.chosen.k > 0)?.key ?? null;

  /* -- room order: intent situations in setup order -- */
  const rooms: string[] = [];
  for (const it of [...data.intents].sort((a, b) => a.seq - b.seq)) {
    if (it.situation && viewsOf(it.stage, it.angle).length > 0 && !rooms.includes(it.situation)) rooms.push(it.situation);
  }
  const roomIndex = (r: string) => rooms.indexOf(r);
  const intentSeq = new Map(data.intents.map((i) => [i.id, i.seq]));

  /* -- pools -- */
  const pools = new Map<ViewKey, PoolRow[]>();
  const pool = (v: ViewKey) => {
    let p = pools.get(v);
    if (!p) {
      p = poolOf(data, v, eng).rows;
      pools.set(v, p);
    }
    return p;
  };

  /* -- per-answer pick facts -- */
  type Pick = { status: Resolved["status"] | "none"; key: string | null; name: string | null };
  const pickMemo = new Map<string, Pick>();
  const pickOf = (row: PoolRow): Pick => {
    const id = row.code.response_id;
    let p = pickMemo.get(id);
    if (!p) {
      const c = row.code;
      if (c.outcome === "pick" && c.top_pick) {
        const r = resolve(c.top_pick);
        p = { status: r.status, key: r.key, name: r.name };
      } else p = { status: "none", key: null, name: null };
      pickMemo.set(id, p);
    }
    return p;
  };
  const recommendsOf = (row: PoolRow) => {
    const out = new Map<string, string>();
    for (const m of row.code.mentions ?? []) {
      if (m.framing !== "recommended") continue;
      const r = resolve(m.brand);
      if (r.status === "active") out.set(r.key, r.name);
    }
    return out;
  };
  const namesTarget = (row: PoolRow) =>
    (row.code.mentions ?? []).some((m) => resolve(m.brand).key === targetKey) || pickOf(row).key === targetKey;
  const takerKindOf = (key: string | null): string => (key && key === defaultKey ? TAKER.default : TAKER.rival);

  /* -- builders -- */
  const specs: CellSpec[] = [];

  /** Open choice / social / premium: your picks vs the top other in-category brand. */
  const choiceSpec = (band: BandSlug, row: string, rowLabel: string, key: string, label: string, rows: PoolRow[], wide = false): CellSpec => {
    const firm = rows.filter((r) => pickOf(r).status !== "none");
    const inCat = firm.filter((r) => pickOf(r).status === "active");
    const outside = firm.filter((r) => pickOf(r).status !== "active");
    const you = inCat.filter((r) => pickOf(r).key === targetKey);
    const byBrand = new Map<string, { name: string; rows: PoolRow[] }>();
    for (const r of inCat) {
      const p = pickOf(r);
      if (p.key === targetKey) continue;
      const t = byBrand.get(p.key!) ?? { name: p.name!, rows: [] };
      t.rows.push(r);
      byBrand.set(p.key!, t);
    }
    const top = [...byBrand.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length || a[1].name.localeCompare(b[1].name))[0];
    const them = top ? top[1].rows : [];
    const named = cell(rows.filter(namesTarget).length, rows.length);
    const youC = cell(you.length, inCat.length);
    const themC = cell(them.length, inCat.length);
    const noPick = cell(rows.length - firm.length, rows.length);
    const leakShare = firm.length >= MIN_SIDE ? share(outside.length, firm.length) : 0;
    const outsideTakes = outside.length > them.length && leakShare >= LEAK_SHARE;
    const outNames = new Map<string, number>();
    for (const r of outside) outNames.set(pickOf(r).name!, (outNames.get(pickOf(r).name!) ?? 0) + 1);
    const topOut = [...outNames.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([n]) => n);
    const taker: Taker = outsideTakes
      ? { name: topOut.join(", "), kind: TAKER.outside }
      : top
        ? { name: top[1].name, kind: takerKindOf(top[0]) }
        : { name: "No single pick", kind: TAKER.undecided };
    const where =
      row === "open" ? `For ${label}` : row === "social" ? "Asked what most buyers pick" : row === "premium" ? "Asked whether premium beats basic" : rowLabel;
    return {
      band, row, rowLabel, key, label, wide, rows,
      you, them: outsideTakes ? outside : them, taker,
      sideD: outsideTakes ? firm.length : inCat.length,
      leakShare,
      note: (v) => {
        if (v === "nocall") return inCat.length < MIN_SIDE ? `${pct(noPick)} no single pick` : "no side taken";
        if (v === "yours") return `you ${pct(youC)} of decided${top ? ` - ${top[1].name} ${pct(themC)}` : ""}`;
        return `${taker.name} ${pct(outsideTakes ? cell(outside.length, firm.length) : themC)} - you ${pct(youC)}`;
      },
      claim: (v) => {
        const lead = `${where}, ${brand} is named in ${pct(named)} of answers`;
        if (v === "nocall")
          return `${lead}, but the AI makes no single in-category pick in ${pct(cell(rows.length - inCat.length, rows.length))} of them - the choice is left to the buyer.`;
        if (v === "yours") return `${lead} and takes ${pct(youC)} of the decided picks${top ? `, ahead of ${top[1].name} at ${pct(themC)}` : ""}.`;
        if (outsideTakes) return `${lead}, yet ${pctOf(leakShare)} of the firm picks leave the category - led by ${taker.name} - and ${brand} takes ${pct(youC)} of the decided picks.`;
        return v === "contested"
          ? `${lead}; the decided picks split - ${brand} ${pct(youC)}, ${taker.name} ${pct(themC)}.`
          : `${lead} and takes ${pct(youC)} of the decided picks; ${taker.name} takes ${pct(themC)}.`;
      },
      lift: { wins: you, others: inCat.filter((r) => pickOf(r).key !== targetKey), note: "Share of answers arguing each code when you are picked vs when another brand in the category is." },
    };
  };

  /* Band 1: where the buyer chooses */
  const headline = pool("headline");
  const byRoom = (rows: PoolRow[]) => {
    const m = new Map<string, PoolRow[]>();
    for (const r of rows) {
      const s = r.intent.situation;
      if (!s) continue;
      m.set(s, [...(m.get(s) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => roomIndex(a[0]) - roomIndex(b[0]));
  };
  for (const [room, rows] of byRoom(headline.filter((r) => r.intent.stage === "discovery" || r.intent.stage === "use_case")))
    specs.push(choiceSpec("chooses", "open", "Open choice", norm(room), room, rows));
  const social = headline.filter((r) => r.intent.stage === "social_validation");
  if (social.length) specs.push(choiceSpec("chooses", "social", "Social validation", "all", "", social, true));

  // Awareness (problem recognition per room; a base-voiced one is wide) and category education.
  const awarenessSpec = (row: string, rowLabel: string, key: string, label: string, rows: PoolRow[], wide: boolean): CellSpec => {
    const recRows = rows.map((r) => ({ r, rec: recommendsOf(r) })).filter((x) => x.rec.size > 0);
    const you = recRows.filter((x) => x.rec.has(targetKey)).map((x) => x.r);
    const others = new Map<string, { name: string; rows: PoolRow[] }>();
    for (const x of recRows)
      for (const [k, name] of x.rec) {
        if (k === targetKey) continue;
        const t = others.get(k) ?? { name, rows: [] };
        t.rows.push(x.r);
        others.set(k, t);
      }
    const top = [...others.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length || a[1].name.localeCompare(b[1].name))[0];
    const named = cell(rows.filter(namesTarget).length, rows.length);
    const recYou = cell(you.length, rows.length);
    const recTop = cell(top ? top[1].rows.length : 0, rows.length);
    const routed = rows.filter((r) => r.code.category_routed === "category" || r.code.category_routed === "adjacent");
    const adjacent = cell(rows.filter((r) => r.code.category_routed === "adjacent").length, routed.length);
    const where = row === "awareness" && !wide ? `In ${label}'s problem questions` : wide ? `On ${rowLabel.toLowerCase()} questions` : rowLabel;
    return {
      band: "chooses", row, rowLabel, key, label, wide, rows,
      you, them: top ? top[1].rows : [],
      sideD: recRows.length,
      taker: top ? { name: top[1].name, kind: takerKindOf(top[0]) } : { name: "No brand recommended", kind: TAKER.undecided },
      note: (v) =>
        v === "nocall"
          ? recRows.length < MIN_SIDE ? `named ${pct(named)}, not backed` : "no side taken"
          : `recommended ${pct(recYou)}${top ? ` - ${top[1].name} ${pct(recTop)}` : ""}`,
      claim: (v) => {
        const lead = `${where}, ${brand} is named in ${pct(named)} of answers and recommended in ${pct(recYou)}`;
        const route = routed.length >= MIN_SIDE && rate(adjacent) >= 0.1 ? `; ${pct(adjacent)} of the routed answers send the buyer outside the category` : "";
        if (v === "nocall") return `${lead} - too few answers recommend any brand to call who the category is explained around${route}.`;
        if (!top) return `${lead}${route}.`;
        return `${lead}, against ${top[1].name} at ${pct(recTop)}${route}.`;
      },
    };
  };
  const routing = pool("awareness_routing");
  for (const [room, rows] of byRoom(routing)) specs.push(awarenessSpec("awareness", "Awareness", norm(room), room, rows, false));
  const routingBase = routing.filter((r) => !r.intent.situation);
  if (routingBase.length) specs.push(awarenessSpec("awareness", "Awareness", "all", "", routingBase, true));
  const explainer = pool("awareness_explainer");
  if (explainer.length) specs.push(awarenessSpec("explainer", "Learning the category", "all", "", explainer, true));

  // Value per room (computeValue: the v6 own rung, the confirmed lines).
  const valueView = computeValue(data, eng);
  const valueRowOf = new Map<string, ValueRow>((valueView?.rooms ?? []).map((r) => [r.key, r]));
  const valueRows = pool("value");
  const valueGroups = new Map<string, PoolRow[]>();
  for (const r of valueRows) valueGroups.set(r.intent.situation ?? "", [...(valueGroups.get(r.intent.situation ?? "") ?? []), r]);
  for (const [room, rows] of [...valueGroups.entries()].sort((a, b) => roomIndex(a[0]) - roomIndex(b[0]))) {
    const vr = valueRowOf.get(room);
    const line = vr?.line ?? null;
    const label = room ? (line ? `${room} - ${line}` : room) : line ?? "";
    const yes = rows.filter((r) => r.code.worth_it === "yes");
    const no = rows.filter((r) => r.code.worth_it === "no");
    const worthC = cell(yes.length, rows.length);
    const notC = cell(no.length, rows.length);
    const own = vr?.ownRung.k ?? 0;
    const riv = vr?.recommendsInstead.k ?? 0;
    const doubting = vr?.ownRung.n ?? 0;
    const inhouseShare = doubting >= MIN_SIDE && own + riv > 0 ? own / (own + riv) : 0;
    const ownTop = vr?.instead.find((i) => i.own);
    const rivTop = vr?.instead.find((i) => !i.own);
    const taker: Taker =
      inhouseShare >= INHOUSE_SHARE && ownTop
        ? { name: ownTop.name, kind: TAKER.own }
        : rivTop
          ? { name: rivTop.name, kind: TAKER.rival }
          : { name: "A cheaper option, unnamed", kind: TAKER.undecided };
    const subject = line ?? brand;
    specs.push({
      band: "chooses", row: "value", rowLabel: "Value", key: norm(room) || "all", label, wide: !room, rows,
      you: yes, them: no, taker, inhouseShare,
      note: (v) => (v === "nocall" ? `${pct(cell(rows.length - yes.length - no.length, rows.length))} "depends"` : `${pct(worthC)} worth it / ${pct(notC)} not`),
      claim: (v) => {
        const lead = `${room ? `For ${room}, ` : ""}${subject} is judged worth it over a cheaper option in ${pct(worthC)} of answers and not worth it in ${pct(notC)}`;
        if (v === "nocall") return `${lead} - the rest say it depends, so the AI takes no side here.`;
        if (doubting >= MIN_SIDE && own + riv > 0)
          return `${lead}; of the doubts, ${pctOf(share(own, doubting))} point to ${brand}'s own cheaper option and ${pctOf(share(riv, doubting))} to a rival${taker.kind !== TAKER.undecided ? `, led by ${taker.name}` : ""}.`;
        return `${lead}.`;
      },
      lift: { wins: yes, others: no, note: "Share of worth-it answers vs not-worth-it answers arguing each code." },
    });
  }

  // Premium vs basic (wide).
  const premium = pool("premium_tier");
  if (premium.length) specs.push(choiceSpec("chooses", "premium", "Premium vs basic", "all", "", premium, true));

  // Criteria taught: per room when room-pinned, else wide.
  const lift = summary.reasonLift;
  const winners = lift.filter((l) => l.lift > 0 && l.wins.low > l.others.high).slice(0, 3);
  const losers = [...lift].reverse().filter((l) => l.lift < 0 && l.others.low > l.wins.high).slice(0, 3);
  const liftOf = new Map(lift.map((l) => [l.code, l.lift]));
  const criteriaSpec = (key: string, label: string, rows: PoolRow[], wide: boolean): CellSpec => {
    const counts = new Map<string, number>();
    const withReasons = rows.filter((r) => r.code.reasons !== null);
    for (const r of withReasons) for (const c of r.code.reasons!) counts.set(c, (counts.get(c) ?? 0) + 1);
    const taughtAll = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top5 = taughtAll.slice(0, 5).map(([c]) => c);
    const taughtRate = (c: string) => cell(counts.get(c) ?? 0, withReasons.length);
    const winTaught = winners.filter((w) => top5.includes(w.code));
    const loseTaught = losers.filter((l) => top5.includes(l.code));
    let verdict: CellVerdict = "nocall";
    let lean = 0;
    if (withReasons.length >= MIN_SIDE && (winners.length > 0 || losers.length > 0)) {
      if (winTaught.length === 0) { verdict = "theirs"; lean = -1; }
      else if (loseTaught.length === 0) { verdict = "yours"; lean = 1; }
      else { verdict = "contested"; lean = Math.sign(winTaught.length - loseTaught.length); }
    }
    const untaught = winners.find((w) => !top5.includes(w.code)) ?? null;
    const items: LiftItem[] = [...new Set([...top5, ...winners.map((w) => w.code), ...losers.map((l) => l.code)])]
      .filter((c) => liftOf.has(c))
      .map((c) => ({
        label: top5.includes(c) ? `${c} (taught ${pct(taughtRate(c))})` : `${c} (untaught)`,
        value: Math.round((liftOf.get(c) ?? 0) * 100),
      }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, LIFT_TOP);
    const taughtText = top5.slice(0, 3).map((c) => `${c} (${pct(taughtRate(c))})`).join(", ");
    const you = withReasons.filter((r) => winTaught.some((w) => r.code.reasons!.includes(w.code)));
    const them = withReasons.filter((r) => loseTaught.some((l) => r.code.reasons!.includes(l.code)));
    return {
      band: "chooses", row: "criteria", rowLabel: "Criteria taught", key, label, wide, rows,
      you, them: them.length ? them : withReasons.filter((r) => r.code.reasons!.includes(top5[0] ?? "")),
      taker: { name: "The taught checklist", kind: TAKER.undecided },
      verdictOverride: { verdict, lean },
      criteria: { winnerTaught: winTaught[0]?.code ?? null, winnerUntaught: untaught?.code ?? null, taught: top5 },
      lifts: items,
      liftNote: "Each argument's open-choice lift (argued when you are picked minus when another brand is), labelled with how often this cell's criteria answers teach it.",
      note: (v) =>
        v === "nocall"
          ? withReasons.length < MIN_SIDE ? "too few answers" : "no winning argument measured"
          : v === "theirs" && untaught ? `teaches ${top5[0] ?? "-"}; ${untaught.code} untaught` : `teaches ${top5.slice(0, 2).join(", ")}`,
      claim: (v) => {
        const where = wide ? "The criteria the AI teaches" : `For ${label}, the criteria the AI teaches`;
        if (v === "nocall") return `${where} lead with ${taughtText || "no single argument"} - too little to set against your winning arguments.`;
        if (v === "theirs")
          return `${where} lead with ${taughtText}${untaught ? ` - while ${untaught.code}, an argument that travels with your wins, goes untaught` : ", none of them an argument that travels with your wins"}.`;
        if (v === "yours") return `${where} lead with ${taughtText}, including ${winTaught[0].code} - an argument that travels with your wins.`;
        return `${where} lead with ${taughtText}: ${winTaught[0].code} helps you, ${loseTaught[0].code} favors the rival picks.`;
      },
    };
  };
  const criteria = pool("criteria_taught");
  for (const [room, rows] of byRoom(criteria)) specs.push(criteriaSpec(norm(room), room, rows, false));
  const criteriaBase = criteria.filter((r) => !r.intent.situation);
  if (criteriaBase.length) specs.push(criteriaSpec("all", "", criteriaBase, true));

  /* Band 2: the named fights */
  const forms: { seq: string[]; entry: DictionaryEntry }[] = [];
  for (const e of dictionary) {
    if (e.status !== "active") continue;
    for (const f of [e.canonical, ...e.aliases]) forms.push({ seq: famTokens(f), entry: e });
  }
  const classBrandOf = (intent: Intent): DictionaryEntry | null => {
    const hay = famTokens(intent.text);
    let best: { seq: string[]; entry: DictionaryEntry } | null = null;
    for (const f of forms) {
      if (f.entry.id === targetKey) continue;
      if (containsSeq(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
    }
    return best?.entry ?? null;
  };
  const h2hSpec = (key: string, rival: { key: string; name: string }, rows: PoolRow[]): CellSpec => {
    const won = rows.filter((r) => pickOf(r).key === targetKey);
    const lost = rows.filter((r) => pickOf(r).key === rival.key);
    const firm = rows.filter((r) => pickOf(r).status !== "none");
    const outside = firm.filter((r) => pickOf(r).status !== "active");
    const rec = cell(won.length, won.length + lost.length);
    const undecided = cell(rows.length - firm.length, rows.length);
    return {
      band: "fights", row: "h2h", rowLabel: "Head-to-head", key, label: rival.name, rows,
      you: won, them: lost,
      taker: { name: rival.name, kind: takerKindOf(rival.key) },
      leakShare: firm.length >= MIN_SIDE ? share(outside.length, firm.length) : 0,
      note: (v) => (v === "nocall" ? `${pct(undecided)} no single pick` : `${pct(rec)} of decided`),
      claim: (v) =>
        v === "nocall"
          ? `Named against ${rival.name}, the AI declines to pick between you in ${pct(undecided)} of answers.`
          : `Named against ${rival.name}, ${brand} wins ${pct(rec)} of the decided head-to-heads${undecided.k > 0 ? ` (no single pick in ${pct(undecided)})` : ""}.`,
      lift: { wins: won, others: lost, note: `Within this matchup: share of answers arguing each code when you win vs when ${rival.name} does.` },
    };
  };
  const entity = pool("head_to_head_entity");
  const entityGroups = new Map<string, { rival: { key: string; name: string }; key: string; seq: number; rows: PoolRow[] }>();
  for (const r of entity) {
    const res = resolve(r.intent.angle);
    const rk = res.status === "active" ? res.key : `?${norm(r.intent.angle)}`;
    const g = entityGroups.get(rk) ?? { rival: { key: rk, name: res.status === "active" ? res.name : r.intent.angle }, key: norm(r.intent.angle), seq: intentSeq.get(r.intent.id) ?? 0, rows: [] };
    g.rows.push(r);
    entityGroups.set(rk, g);
  }
  for (const g of [...entityGroups.values()].sort((a, b) => a.seq - b.seq)) specs.push(h2hSpec(g.key, g.rival, g.rows));
  const classRows = pool("head_to_head_class");
  const classGroups = new Map<string, { rival: { key: string; name: string }; key: string; seq: number; rows: PoolRow[] }>();
  for (const r of classRows) {
    const e = classBrandOf(r.intent);
    const rk = e ? e.id : `?${r.intent.id}`;
    const name = e ? e.display_name ?? e.canonical : r.intent.text;
    const g = classGroups.get(rk) ?? { rival: { key: rk, name }, key: `class-${norm(name)}`, seq: intentSeq.get(r.intent.id) ?? 0, rows: [] };
    g.rows.push(r);
    classGroups.set(rk, g);
  }
  for (const g of [...classGroups.values()].sort((a, b) => a.seq - b.seq)) specs.push(h2hSpec(g.key, g.rival, g.rows));

  // Rival leavers.
  const offensive = pool("offensive_capture");
  const leaverSpec = (key: string, label: string, rows: PoolRow[], wide: boolean, leftKey: string | null): CellSpec => {
    const firm = rows.filter((r) => pickOf(r).status !== "none");
    const inCat = firm.filter((r) => pickOf(r).status === "active");
    const you = inCat.filter((r) => pickOf(r).key === targetKey);
    const capt = new Map<string, { name: string; rows: PoolRow[] }>();
    for (const r of inCat) {
      const p = pickOf(r);
      if (p.key === targetKey) continue;
      const t = capt.get(p.key!) ?? { name: p.name!, rows: [] };
      t.rows.push(r);
      capt.set(p.key!, t);
    }
    const top = [...capt.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length || a[1].name.localeCompare(b[1].name))[0];
    const named = cell(rows.filter(namesTarget).length, rows.length);
    const youC = cell(you.length, inCat.length);
    const topC = cell(top ? top[1].rows.length : 0, inCat.length);
    const picked = cell(you.length, rows.length);
    const outside = firm.length - inCat.length;
    const whose = wide ? "Buyers leaving a rival" : `Buyers leaving ${label}`;
    return {
      band: "fights", row: "leavers", rowLabel: "Rival leavers", key, label: wide ? "" : label, wide, rows,
      you, them: top ? top[1].rows : [],
      sideD: inCat.length,
      taker: top
        ? { name: top[1].name, kind: top[0] === leftKey ? "the brand they are leaving" : takerKindOf(top[0]) }
        : { name: "No single pick", kind: TAKER.undecided },
      leakShare: firm.length >= MIN_SIDE ? share(outside, firm.length) : 0,
      note: (v) => (v === "nocall" ? `named ${pct(named)}, picked ${pct(picked)}` : `named ${pct(named)}, picked ${pct(picked)}${top ? ` - ${top[1].name} ${pct(topC)} of decided` : ""}`),
      claim: (v) =>
        `${whose}: ${brand} is named in ${pct(named)} of answers and picked in ${pct(picked)}${
          v === "nocall" ? " - too few firm picks to call who captures them" : top ? `; ${top[1].name} takes ${pct(topC)} of the decided picks against your ${pct(youC)}` : ""
        }.`,
      lift: { wins: you, others: inCat.filter((r) => pickOf(r).key !== targetKey), note: "Share of leaver answers arguing each code when you capture them vs when another brand does." },
    };
  };
  const leaverGroups = new Map<string, { key: string; name: string; leftKey: string | null; seq: number; rows: PoolRow[] }>();
  for (const r of offensive) {
    const angle = r.intent.angle;
    const generic = !angle || angle === "generic";
    const res = generic ? null : resolve(angle);
    const gk = generic ? "generic" : res!.status === "active" ? res!.key : `?${norm(angle)}`;
    const g = leaverGroups.get(gk) ?? {
      key: generic ? "generic" : norm(angle),
      name: generic ? "No rival named" : res!.status === "active" ? res!.name : angle,
      leftKey: generic ? null : res!.key,
      seq: intentSeq.get(r.intent.id) ?? 0,
      rows: [],
    };
    g.rows.push(r);
    leaverGroups.set(gk, g);
  }
  const rivalAngles = [...leaverGroups.keys()].filter((k) => k !== "generic").length;
  if (offensive.length) {
    if (rivalAngles >= 2) for (const g of [...leaverGroups.values()].sort((a, b) => a.seq - b.seq)) specs.push(leaverSpec(g.key, g.name, g.rows, false, g.leftKey));
    else specs.push(leaverSpec("all", "", offensive, true, [...leaverGroups.values()][0]?.leftKey ?? null));
  }

  /* Band 3: the doubts */
  const exitsOf = exitResolver(project, dictionary, resolve, targetKey);
  const topExits = (rows: PoolRow[]) => {
    const m = new Map<string, number>();
    for (const r of rows) for (const x of exitsOf(r.code.destinations).exits.values()) m.set(x.name, (m.get(x.name) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n }));
  };
  const exitTaker = (unfav: PoolRow[], fallback: Taker): Taker => {
    const ex = topExits(unfav)[0];
    return ex && ex.n >= Math.max(3, unfav.length * 0.2) ? { name: ex.name, kind: TAKER.rival } : fallback;
  };
  const objections = pool("doubt");
  const worryGroups = (rows: PoolRow[]) => {
    const m = new Map<string, { concern: string; stage: string; seq: number; rows: PoolRow[] }>();
    for (const r of rows) {
      const k = `${r.intent.stage}|${r.intent.concern ?? ""}`;
      const g = m.get(k) ?? { concern: r.intent.concern ?? "", stage: r.intent.stage, seq: intentSeq.get(r.intent.id) ?? 0, rows: [] };
      g.rows.push(r);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.seq - b.seq);
  };
  for (const g of worryGroups(objections)) {
    const rows = g.rows;
    const proceed = rows.filter((r) => r.code.proceed_or_avoid === "proceed");
    const conceded = rows.filter((r) => r.code.proceed_or_avoid === "avoid" || (r.code.premise_verdict === "confirms" && r.code.proceed_or_avoid !== "proceed"));
    const judged = rows.filter((r) => r.code.premise_verdict === "confirms" || r.code.premise_verdict === "mixed" || r.code.premise_verdict === "rebuts");
    const agreed = judged.filter((r) => r.code.premise_verdict === "confirms");
    const agree = cell(agreed.length, judged.length);
    const go = cell(proceed.length, rows.length);
    const goOfAgreed = cell(agreed.filter((r) => r.code.proceed_or_avoid === "proceed").length, agreed.length);
    const label = g.concern || "A worry";
    specs.push({
      band: "doubts", row: "buyers", rowLabel: "Buyers' worries", key: norm(label), label, rows,
      you: proceed, them: conceded,
      taker: exitTaker(conceded, { name: "The worry, conceded", kind: TAKER.undecided }),
      conceded: { agree, goAheadOfAgreed: goOfAgreed },
      exitFallback: topExits(rows).slice(0, COND_TOP),
      note: () => `agreed ${pct(agree)} · go ahead ${pct(go)}`,
      claim: (v) =>
        `When a buyer worries "${label}", the AI agrees the worry is warranted in ${pct(agree)} of the answers that judge it and tells them to go ahead in ${pct(go)}${
          v === "nocall" ? " - most answers take no side" : agreed.length >= MIN_SIDE && rate(goOfAgreed) >= 0.3 ? `, including ${pct(goOfAgreed)} of the answers that agree` : ""
        }.`,
      lift: { wins: proceed, others: conceded, note: "Share of go-ahead answers vs conceding answers arguing each code." },
    });
  }
  const stayRows = pool("keep_or_leave");
  const custGroups = worryGroups(stayRows);
  const concernCount = new Map<string, number>();
  for (const g of custGroups) concernCount.set(norm(g.concern), (concernCount.get(norm(g.concern)) ?? 0) + 1);
  const staySpec = (row: string, rowLabel: string, key: string, label: string, rows: PoolRow[], wide: boolean, who: string): CellSpec => {
    const keep = rows.filter((r) => r.code.keep_or_leave === "keep");
    const leave = rows.filter((r) => r.code.keep_or_leave === "leave");
    const keepC = cell(keep.length, rows.length);
    const leaveC = cell(leave.length, rows.length);
    const taker = exitTaker(leave, leave.length > 0 ? { name: "Leaving, no destination named", kind: TAKER.undecided } : { name: "No side taken", kind: TAKER.undecided });
    return {
      band: "doubts", row, rowLabel, key, label, wide, rows,
      you: keep, them: leave, taker,
      exitFallback: topExits(rows).slice(0, COND_TOP),
      note: () => `stay ${pct(keepC)} · leave ${pct(leaveC)}`,
      claim: (v) =>
        `${who}, the AI says stay in ${pct(keepC)} of answers and leave in ${pct(leaveC)}${v === "nocall" ? " - most take no side" : taker.kind === TAKER.rival ? `; ${taker.name} is where the leavers are sent most` : ""}.`,
      lift: { wins: keep, others: leave, note: "Share of stay answers vs leave answers arguing each code." },
    };
  };
  for (const g of custGroups) {
    const label = g.concern || "A worry";
    const key = (concernCount.get(norm(g.concern)) ?? 0) > 1 ? `${norm(label)}|${g.stage}` : norm(label);
    specs.push(staySpec("customers", "Customers' worries", key, label, g.rows, false, `When a customer worries "${label}"`));
  }
  const hold = pool("defensive_hold");
  if (hold.length) specs.push(staySpec("hold", "Holding your own", "all", "", hold, true, "When your own customer asks what else to look at"));
  const repertoire = pool("repertoire");
  if (repertoire.length) {
    const stick = repertoire.filter((r) => pickOf(r).key === targetKey);
    const sw = repertoire.filter((r) => pickOf(r).status !== "none" && pickOf(r).key !== targetKey);
    const swNames = new Map<string, number>();
    for (const r of sw) swNames.set(pickOf(r).name!, (swNames.get(pickOf(r).name!) ?? 0) + 1);
    const topSw = [...swNames.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const stickC = cell(stick.length, repertoire.length);
    const swC = cell(sw.length, repertoire.length);
    specs.push({
      band: "doubts", row: "repertoire", rowLabel: "Repertoire", key: "all", label: "", wide: true, rows: repertoire,
      you: stick, them: sw,
      taker: topSw ? { name: topSw[0], kind: TAKER.rival } : { name: "No single pick", kind: TAKER.undecided },
      note: () => `stick ${pct(stickC)} · switch ${pct(swC)}`,
      claim: (v) =>
        `Asked whether to keep buying ${brand} out of habit, the AI says stick with it in ${pct(stickC)} of answers and switch in ${pct(swC)}${v !== "nocall" && topSw ? `, most often to ${topSw[0]}` : ""}.`,
      lift: { wins: stick, others: sw, note: "Share of stick answers vs switch answers arguing each code." },
    });
  }

  /* Band 4: the settled customer */
  const objectionsAgree = (() => {
    const judged = objections.filter((r) => r.code.premise_verdict === "confirms" || r.code.premise_verdict === "mixed" || r.code.premise_verdict === "rebuts");
    return cell(judged.filter((r) => r.code.premise_verdict === "confirms").length, judged.length);
  })();
  const settledStages: [ViewKey, string, string][] = [
    ["settled_business_case", "business case", "Business case"],
    ["settled_expansion", "expansion", "Expansion"],
    ["settled_ecosystem", "ecosystem", "Ecosystem"],
    ["settled_advocacy", "advocacy", "Advocacy"],
  ];
  for (const [view, key, label] of settledStages) {
    const rows = pool(view);
    if (!rows.length) continue;
    const str = rows.filter((r) => r.code.relationship_verdict === "strengthens");
    const weak = rows.filter((r) => r.code.relationship_verdict === "weakens");
    const strC = cell(str.length, rows.length);
    const strong = cell(rows.filter((r) => r.code.case_strength === "strong").length, rows.length);
    const defend = rate(strC) >= rate(strong) ? strC : strong;
    const asked = view === "settled_advocacy" || view === "settled_business_case";
    const settledWatch = asked && defend.n >= MIN_SIDE && objectionsAgree.n >= MIN_SIDE && rate(defend) >= 0.5 && rate(objectionsAgree) >= 0.5;
    const redirects = new Map<string, number>();
    for (const r of rows) for (const x of exitsOf(r.code.redirect_to).exits.values()) redirects.set(x.name, (redirects.get(x.name) ?? 0) + 1);
    const topRed = [...redirects.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    specs.push({
      band: "settled", row: "settled", rowLabel: "Settled customers", key, label, rows,
      you: str, them: weak,
      taker: topRed && topRed[1] >= Math.max(3, rows.length * 0.1) ? { name: topRed[0], kind: TAKER.rival } : { name: "No side taken", kind: TAKER.undecided },
      settledWatch,
      note: () => `strengthens ${pct(strC)}`,
      claim: (v) => {
        const lead = `Asked about ${key} as a settled customer, the AI strengthens the relationship in ${pct(strC)} of answers`;
        if (settledWatch) return `${lead}; asked neutrally about buyers' worries, it agrees with them in ${pct(objectionsAgree)} - the asker set the side here.`;
        return v === "nocall" ? `${lead} - most answers stay neutral.` : `${lead}${weak.length ? ` and weakens it in ${pct(cell(weak.length, rows.length))}` : ""}.`;
      },
      lift: { wins: str, others: rows.filter((r) => r.code.relationship_verdict !== "strengthens"), note: "Share of strengthening answers vs the rest arguing each code." },
    });
  }

  /* -- one condition grouping over every rule in the map -- */
  const exclude = excludedWords([project.category]);
  const countRules = (rows: Iterable<PoolRow>) => {
    const counts = new Map<string, number>();
    for (const r of rows)
      for (const rule of r.code.decision_rules ?? []) {
        const c = rule.condition.trim();
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    return counts;
  };
  const mapRows = () => {
    const seen = new Map<string, PoolRow>();
    for (const s of specs) for (const r of s.rows) seen.set(r.code.response_id, r);
    return seen.values();
  };
  const fullRows = () => {
    const seen = new Map<string, PoolRow>();
    for (const v of new Set(specs.flatMap((s) => s.rows.map((r) => viewsOf(r.intent.stage, r.intent.angle)).flat())))
      for (const r of poolOf(data, v).rows) seen.set(r.code.response_id, r);
    return seen.values();
  };
  const condKeys = await conditionKeysFor(countRules(mapRows()), request.engines ? () => countRules(fullRows()) : null, exclude, {
    large: true,
    cache: condCache(data, "analysis_map"),
  });
  const keyOf = (c: string) => condKeys.get(c) ?? conditionStemKey(c, exclude);

  const groupsOf = (rows: PoolRow[]) => {
    type Acc = { n: number; surfaces: Map<string, number> };
    const sides = { you: new Map<string, Acc>(), away: new Map<string, Acc>() };
    let bearing = 0;
    for (const r of rows) {
      const dr = r.code.decision_rules;
      if (dr == null) continue;
      bearing++;
      const seen = new Set<string>();
      for (const rule of dr) {
        const c = rule.condition.trim();
        if (!c) continue;
        const side = ruleSide(rule, r.code.schema, resolve, targetKey);
        const ck = keyOf(c);
        if (seen.has(`${side}|${ck}`)) continue;
        seen.add(`${side}|${ck}`);
        const acc = sides[side].get(ck) ?? { n: 0, surfaces: new Map() };
        acc.n++;
        acc.surfaces.set(c, (acc.surfaces.get(c) ?? 0) + 1);
        sides[side].set(ck, acc);
      }
    }
    const list = (m: Map<string, Acc>): Group[] =>
      [...m.values()]
        .sort((a, b) => b.n - a.n)
        .map((a) => {
          const surf = [...a.surfaces.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || (x[0] < y[0] ? -1 : 1));
          return { label: surf[0][0], n: a.n, surfaces: surf.slice(0, 5).map(([s]) => s) };
        });
    return { toward: list(sides.you), away: list(sides.away), bearing };
  };

  /* -- finish each cell: verdict, badges, position -- */
  const engineLabel = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));
  const bands: MapBand[] = [];
  const positions: Record<string, Position> = {};
  const cellById = new Map<string, MapCell>();
  const walls: WallProbe[] = [];

  const quoteOf = (r: PoolRow) => (r.code.quote ?? r.code.premise_quote ?? "").trim();
  const receiptsOf = (rows: PoolRow[]): PositionReceipt[] => {
    const withQ = rows.filter((r) => quoteOf(r));
    const pickFrom = [...withQ, ...rows.filter((r) => !quoteOf(r))];
    // Spread across engines: one per engine first, in order.
    const out: PoolRow[] = [];
    const usedModels = new Set<string>();
    for (const r of pickFrom) {
      if (out.length >= RECEIPTS) break;
      if (usedModels.has(r.model)) continue;
      usedModels.add(r.model);
      out.push(r);
    }
    for (const r of pickFrom) {
      if (out.length >= RECEIPTS) break;
      if (!out.includes(r)) out.push(r);
    }
    return out.map((r) => (quoteOf(r) ? { responseId: r.code.response_id, quote: quoteOf(r) } : { responseId: r.code.response_id }));
  };
  const liftsOf = (wins: PoolRow[], others: PoolRow[]): LiftItem[] => {
    const w = wins.filter((r) => r.code.reasons !== null);
    const o = others.filter((r) => r.code.reasons !== null);
    if (w.length < LIFT_MIN || o.length < LIFT_MIN) return [];
    const counts = new Map<string, number>();
    for (const r of [...w, ...o]) for (const c of r.code.reasons!) counts.set(c, (counts.get(c) ?? 0) + 1);
    const total = w.length + o.length;
    return [...counts.entries()]
      .filter(([, k]) => k / total >= LIFT_MIN_INCIDENCE)
      .map(([code]) => ({
        label: code,
        value: Math.round((share(w.filter((r) => r.code.reasons!.includes(code)).length, w.length) - share(o.filter((r) => r.code.reasons!.includes(code)).length, o.length)) * 100),
      }))
      .filter((l) => l.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label))
      .slice(0, LIFT_TOP);
  };
  const vendorDeficit = (s: CellSpec) => {
    const by = new Map<string, { b: number; t: number }>();
    for (const r of s.you) {
      const v = facetsOf(r.model).vendor;
      by.set(v, { ...(by.get(v) ?? { b: 0, t: 0 }), b: (by.get(v)?.b ?? 0) + 1 });
    }
    for (const r of s.them) {
      const v = facetsOf(r.model).vendor;
      by.set(v, { b: by.get(v)?.b ?? 0, t: (by.get(v)?.t ?? 0) + 1 });
    }
    const ok = [...by.entries()].filter(([, x]) => x.b + x.t >= 5);
    const behind = ok.filter(([, x]) => x.t > x.b).length;
    const ahead = ok.filter(([, x]) => x.b > x.t).length;
    return { behind, ahead, vendors: ok.length };
  };

  const ROW_ORDER: Record<BandSlug, string[]> = {
    chooses: ["open", "social", "awareness", "explainer", "value", "premium", "criteria"],
    fights: ["h2h", "leavers"],
    doubts: ["buyers", "customers", "hold", "repertoire"],
    settled: ["settled"],
  };
  const BAND_META: Record<BandSlug, { title: string; sub: string }> = {
    chooses: { title: "Where the buyer chooses", sub: "These contests vary by buyer room - the rooms you confirmed at setup." },
    fights: { title: "The named fights", sub: "These contests vary by rival - the buyer is held fixed, so this is relative strength." },
    doubts: { title: "The doubts", sub: "One cell per worry you confirmed at the worries gate." },
    settled: { title: "The settled customer", sub: "Asked-for questions from committed customers - a ceiling, not a standing." },
  };

  for (const band of ["chooses", "fights", "doubts", "settled"] as BandSlug[]) {
    const rowsOut: MapRow[] = [];
    for (const rowSlug of ROW_ORDER[band]) {
      const inRow = specs.filter((s) => s.band === band && s.row === rowSlug && s.rows.length > 0);
      if (!inRow.length) continue;
      const cells: MapCell[] = [];
      for (const s of inRow) {
        const id = `${band}:${rowSlug}:${s.key}`;
        const d = s.sideD ?? s.you.length + s.them.length;
        const { verdict, lean } = s.verdictOverride ?? classify(s.you.length, s.them.length, d);
        const badges: CellBadge[] = [];
        const conds = groupsOf(s.rows);
        // Walls: top-3 away groups, possession-shaped.
        const wallGroups: Group[] = [];
        conds.away.slice(0, 3).forEach((g, i) => {
          const isWall = g.n >= WALL_MIN && isWallWording([g.label, ...g.surfaces]);
          if (isWall) wallGroups.push(g);
          if (g.n >= WALL_MIN) walls.push({ cellId: id, label: g.label, n: g.n, rank: i + 1, wall: isWall, samples: g.surfaces.slice(0, 3) });
        });
        if (wallGroups.length) badges.push("wall");
        if ((s.leakShare ?? 0) >= LEAK_SHARE) badges.push("leak");
        if ((s.inhouseShare ?? 0) >= INHOUSE_SHARE) badges.push("inhouse");
        // Watch: one engine carries the brand side.
        let engineWatch: { model: string; share: number } | null = null;
        if (s.you.length >= WATCH_ENGINE_MIN) {
          const byModel = new Map<string, number>();
          for (const r of s.you) byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
          const [model, k] = [...byModel.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
          if (k / s.you.length >= WATCH_ENGINE_SHARE) engineWatch = { model, share: k / s.you.length };
        }
        if (engineWatch || s.settledWatch) badges.push("watch");

        const mapCell: MapCell = {
          id,
          label: s.label,
          verdict,
          note: s.note(verdict),
          badges,
          ...(s.wide ? { wide: true } : {}),
          n: s.rows.length,
        };
        cells.push(mapCell);
        cellById.set(id, mapCell);

        /* -- the position -- */
        const inhouse = badges.includes("inhouse") && verdict !== "yours";
        const status: PositionStatus =
          verdict === "yours"
            ? engineWatch ? "watch" : "surplus"
            : verdict === "theirs" || (verdict === "contested" && lean < 0)
              ? inhouse ? "watch" : engineWatch ? "watch" : "deficit"
              : "watch";
        const topAway = conds.away[0];
        const topToward = conds.toward[0];
        const median = !!topAway && conds.bearing > 0 && topAway.n >= 2 * (topToward?.n ?? 0) && topAway.n / conds.bearing >= 0.1;
        let triage: Triage;
        let why: string;
        const sideD = d;
        const youS = cell(s.you.length, sideD);
        const themS = cell(s.them.length, sideD);
        const engineName = engineWatch ? engineLabel.get(engineWatch.model) ?? engineWatch.model : "";
        if (verdict === "yours" || (status !== "deficit" && verdict === "contested" && lean > 0)) {
          if (s.settledWatch) {
            triage = "overclaimed";
            why = `Asked to defend ${brand}, the AI strengthens the case; asked neutrally about buyers' worries, it agrees with them in ${pct(objectionsAgree)}. The strength appears only when the asker stands on it.`;
          } else if (engineWatch) {
            triage = "overclaimed";
            why = `${engineName} supplies ${pctOf(engineWatch.share)} of your side of this cell - a one-engine read would overstate the standing.`;
          } else {
            triage = "earned";
            why = verdict === "yours"
              ? `You hold ${pct(youS)} of the side-taking answers against ${pct(themS)} for ${s.taker.name}, outside the noise.`
              : `You lead ${pct(youS)} to ${pct(themS)}, inside the noise - held, not won.`;
          }
        } else if (inhouse) {
          triage = "windfall";
          why = `Most of the doubts here point to ${brand}'s own cheaper option (${s.taker.name}) - a loss that stays in-house. Size how much steps down versus walks away.`;
        } else if (status === "deficit") {
          const vd = vendorDeficit(s);
          const conc = s.conceded;
          if (wallGroups.length) {
            triage = "strategy_misfit";
            why = `The largest condition away ("${wallGroups[0].label}") is a state the buyer is already in, not an argument - it is routed around, not out-argued.`;
          } else if (badges.includes("leak")) {
            triage = "strategy_misfit";
            why = `${pctOf(s.leakShare ?? 0)} of the firm picks here leave the category - the AI answers the buyer's job with something outside it.`;
          } else if (s.criteria) {
            triage = "proof_missing";
            why = s.criteria.winnerUntaught
              ? `${s.criteria.winnerUntaught} travels with your wins but is absent from what the AI teaches here; it teaches ${s.criteria.taught.slice(0, 3).join(", ")}.`
              : `What the AI teaches here (${s.criteria.taught.slice(0, 3).join(", ")}) carries none of the arguments that travel with your wins.`;
          } else if (conc && conc.agree.n >= MIN_SIDE && rate(conc.agree) >= 0.5 && conc.goAheadOfAgreed.n >= MIN_SIDE && rate(conc.goAheadOfAgreed) >= 0.3) {
            triage = "proof_missing";
            why = `The AI agrees with the worry in ${pct(conc.agree)} and still says go ahead in ${pct(conc.goAheadOfAgreed)} of those - the go-ahead exists, the counter-evidence does not.`;
          } else if (vd.behind >= 3 && vd.ahead === 0) {
            triage = "product_truth";
            why = `The deficit holds on all ${vd.behind} vendors with enough answers to read - consistent enough to read as how the product is, not how it is described.`;
          } else if (median) {
            triage = "strategy_misfit";
            why = `The conditions away ("${topAway.label}") outweigh the conditions toward you${topToward ? ` ("${topToward.label}")` : ""} - they describe more of the buyers than yours do.`;
          } else {
            triage = "proof_missing";
            why = `${s.taker.name} takes ${pct(themS)} of the side-taking answers against your ${pct(youS)}, with no wall, leak or cross-vendor consistency behind it - the case the AI reads for you is the gap.`;
          }
        } else if (verdict === "nocall") {
          triage = s.them.length > s.you.length && sideD > 0 ? "proof_missing" : "earned";
          why = sideD < MIN_SIDE
            ? `Too few answers take a side here to call it; ${triage === "earned" ? "nobody holds it against you" : `${s.taker.name} leads the few that do`}.`
            : `The answers here take no clear side.`;
        } else {
          // contested, even or engine-dependent deficit
          if (engineWatch) {
            triage = "overclaimed";
            why = `${engineName} supplies ${pctOf(engineWatch.share)} of your side of this cell - read it engine by engine before acting.`;
          } else {
            triage = "earned";
            why = `The side-taking answers split ${pct(youS)} to ${pct(themS)} - a live contest, not a loss.`;
          }
        }

        const LEVER: Record<Triage, [string, string]> = {
          record_wrong: ["Correct the record where the AI reads - the facts it states here are out of date.", "Evidence audit"],
          proof_missing: [
            s.criteria
              ? "Put your winning argument into the category's teaching material where the AI reads, so the checklist carries your ground too."
              : s.conceded
                ? "Publish the counter-evidence for this worry where the AI reads, so the go-ahead comes with a reason."
                : "Publish the evidence for your case in this contest where the AI reads - the answers make the rival's case and not yours.",
            "GEO playbook",
          ],
          strategy_misfit: [
            wallGroups.length
              ? "Spend nothing out-arguing the wall; route around it to the buyers it does not hold."
              : badges.includes("leak")
                ? "Answer the buyer's whole job where the AI reads, or cede the room knowingly - a leak is a strategy call before it is content."
                : "Own an unconditional case for one median buyer, or accept the lane - the away conditions describe more buyers than yours.",
            "Strategy pulse",
          ],
          product_truth: ["Reality audit before content: confirm the experience against your own data. If the AI is right, the fix is the product.", "Reality audit"],
          earned: ["Defend and cement: keep the evidence behind this standing current and visible.", "Defend and cement"],
          overclaimed: ["Read this number as a ceiling, not a standing - substantiate it where the unprompted answers are made.", "Watch, then substantiate"],
          windfall: ["Validate and size: how much demand steps down to your own option versus walks away.", "Validate and size"],
        };
        const [lever, family] = LEVER[triage];

        const toward: ConditionItem[] = conds.toward.slice(0, COND_TOP).map((g) => ({ text: g.label, n: g.n }));
        let away: ConditionItem[] = conds.away.slice(0, COND_TOP).map((g) => ({ text: g.label, n: g.n, ...(wallGroups.includes(g) ? { wall: true } : {}) }));
        if (conds.bearing < 5 && away.length === 0 && s.exitFallback?.length) away = s.exitFallback.map((x) => ({ text: `Sent to ${x.name}`, n: x.n }));

        const numerator = verdict === "yours" ? s.you : verdict === "theirs" ? s.them : verdict === "contested" ? [...s.you, ...s.them] : s.rows;
        const lifts = s.lifts ?? (s.lift ? liftsOf(s.lift.wins, s.lift.others) : []);
        const liftNote = s.liftNote ?? (lifts.length && s.lift ? s.lift.note : undefined);
        const where = `${s.rowLabel}${s.label ? ` · ${s.label}` : " · every buyer"}`;
        const taker = verdict === "yours" ? { name: "Nobody", kind: TAKER.nobody } : s.taker;
        positions[id] = {
          cellId: id,
          where,
          claim: s.claim(verdict),
          taker: taker.name,
          takerKind: taker.kind,
          status,
          triageSuggested: triage,
          triageWhy: why,
          lifts,
          ...(liftNote ? { liftNote } : {}),
          toward,
          away,
          receipts: receiptsOf(numerator.length ? numerator : s.rows),
          lever,
          family,
        };
      }
      rowsOut.push({ stage: inRow[0].rowLabel, cells });
    }
    if (rowsOut.length) bands.push({ ...BAND_META[band], rows: rowsOut });
  }

  /* -- casting -- */
  const facts = castingFacts(summary, pool("headline"), pickOf, recommendsOf, targetKey);
  const casting = castingLine(facts, brand);
  if (debug) {
    debug.walls = walls;
    debug.casting = facts;
  }

  /* -- dots + share of decided -- */
  const t = summary.target;
  const decided = summary.firmPickInCategory.k;
  const others = summary.brands.filter((b) => b.role !== "target" && b.chosen.k > 0);
  const shown = others.slice(0, 3);
  const rest = others.slice(3).reduce((a, b) => a + b.chosen.k, 0);
  const shareOfDecided = [
    ...[...shown.map((b) => ({ brand: b.name, you: false, share: b.shareOfDecided })), { brand, you: true, share: t.shareOfDecided }].sort(
      (a, b) => b.share.k - a.share.k || a.brand.localeCompare(b.brand)
    ),
    ...(decided > 0 && rest / decided >= 0.05 ? [{ brand: "Others", you: false, share: cell(rest, decided) }] : []),
  ];

  /* -- tensions -- */
  const probe = debug ? { insights: debug.probeInsights ?? summary.insights, out: [] as NonNullable<AnalysisMapDebug["placements"]> } : undefined;
  const tensions = tensionsOf(summary, facts, specs, cellById, brand, probe);
  if (debug && probe) debug.placements = probe.out;

  /* -- honesty line: map answers on the core panel with no code row -- */
  const core = coreOf(data, eng);
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const mapPrompts = new Set(
    data.prompts.filter((p) => {
      const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
      return it && viewsOf(it.stage, it.angle).length > 0;
    }).map((p) => p.id)
  );
  const coded = new Set(data.codes.map((c) => c.response_id));
  let uncoded = 0;
  for (const r of data.responses) if (mapPrompts.has(r.prompt_id) && core.has(r.model ?? data.run.model) && !coded.has(r.id)) uncoded++;

  return { casting, dots: { named: t.mentioned, picked: t.chosen }, shareOfDecided, tensions, bands, positions, uncoded };
}

/* ------------------------------- casting ------------------------------- */

function castingFacts(
  s: BrandSummaryView,
  headline: PoolRow[],
  pickOf: (r: PoolRow) => { status: string; key: string | null },
  recommendsOf: (r: PoolRow) => Map<string, string>,
  targetKey: string
): CastingFacts {
  const others = s.brands.filter((b) => b.role !== "target");
  const top = [...others].sort((a, b) => b.chosen.k - a.chosen.k || a.name.localeCompare(b.name))[0];
  const mostNamedOther = [...others].sort((a, b) => b.mentioned.k - a.mentioned.k)[0];
  const won = s.headToHead.reduce((a, r) => a + r.won.k, 0);
  const lost = s.headToHead.reduce((a, r) => a + r.lost.k, 0);
  const otherPicks = headline.filter((r) => pickOf(r).status === "active" && pickOf(r).key !== targetKey);
  const beside = otherPicks.filter((r) => recommendsOf(r).has(targetKey)).length;
  return {
    shareYou: rate(s.target.shareOfDecided),
    shareTop: top ? rate(top.shareOfDecided) : 0,
    topName: top?.name ?? "",
    youTop: !top || s.target.chosen.k >= top.chosen.k,
    named: rate(s.target.mentioned),
    picked: rate(s.target.chosen),
    mostNamed: !mostNamedOther || s.target.mentioned.k >= mostNamedOther.mentioned.k,
    prompted: won + lost >= MIN_SIDE ? won / (won + lost) : null,
    promptedN: won + lost,
    beside: share(beside, otherPicks.length),
    besideN: otherPicks.length,
    rank: 1 + others.filter((b) => b.chosen.k > s.target.chosen.k).length,
    topTwo: rate(s.target.shareOfDecided) + (top ? rate(top.shareOfDecided) : 0),
  };
}

function classifyArchetype(f: CastingFacts): Archetype {
  const leads = f.youTop || f.shareYou >= f.shareTop - DEFAULT_MARGIN;
  const winsPrompted = f.prompted === null || f.prompted >= 0.5;
  if (leads && winsPrompted) return "default";
  if (f.mostNamed && !winsPrompted && f.shareTop - f.shareYou <= 0.15) return "reference";
  if (f.prompted !== null && f.prompted >= 0.6 && f.prompted - f.shareYou >= 0.3 && f.rank === 2 && f.topTwo >= 0.6) return "challenger";
  if (winsPrompted && f.besideN >= MIN_SIDE && f.beside >= 0.3) return "companion";
  return "specialist";
}

const HEADING: Record<Archetype, string> = {
  default: "The default",
  specialist: "The specialist",
  reference: "The reference brand",
  challenger: "The challenger",
  companion: "The companion",
};

function castingLine(f: CastingFacts, brand: string): CastingLine {
  const archetype = classifyArchetype(f);
  const named = pctOf(f.named);
  const picked = pctOf(f.picked);
  const you = pctOf(f.shareYou);
  const top = pctOf(f.shareTop);
  const prompted = f.prompted !== null ? pctOf(f.prompted) : null;
  const beside = pctOf(f.beside);
  switch (archetype) {
    case "default":
      return {
        archetype,
        heading: HEADING.default,
        casting: `The AI treats ${brand} as the default answer - the brand the open choice lands on when nothing pulls it elsewhere.`,
        detail: `Named in ${named} of open-choice answers and picked in ${picked} - ${you} of the decided picks${f.topName ? `; ${f.topName} is next at ${top}` : ""}.`,
      };
    case "challenger":
      return {
        archetype,
        heading: HEADING.challenger,
        casting: `The AI rates ${brand} the better choice in direct comparisons - and still hands the open choice to ${f.topName}.`,
        detail: `${prompted} of decided head-to-heads against ${you} of the open choice's decided picks; ${f.topName} takes ${top}.`,
      };
    case "companion":
      return {
        archetype,
        heading: HEADING.companion,
        casting: `The AI recommends ${brand} beside the pick, rarely as the pick.`,
        detail: `Recommended in ${beside} of the open-choice answers that pick another brand, yet ${you} of the decided picks - ${f.topName} takes ${top}${prompted ? `; named against a rival, it wins ${prompted} of decided head-to-heads` : ""}.`,
      };
    case "reference":
      return {
        archetype,
        heading: HEADING.reference,
        casting: `The AI explains the category through ${brand} - the most-named brand, not its recommendation.`,
        detail: `Named in ${named} of open-choice answers, more than any rival, and picked in ${picked} - ${you} of the decided picks${prompted ? `; ${prompted} of decided head-to-heads` : ""}.`,
      };
    case "specialist":
      return {
        archetype,
        heading: HEADING.specialist,
        casting: `The AI treats ${brand} as the right choice for a specific buyer, never the default.`,
        detail: `Named in ${named} of open-choice answers, picked in ${picked} - ${you} of the decided picks, against ${top} for ${f.topName}${prompted ? `; ${prompted} of decided head-to-heads` : ""}.`,
      };
  }
}

/* ------------------------------- tensions ------------------------------- */

function tensionsOf(
  s: BrandSummaryView,
  f: CastingFacts,
  specs: CellSpec[],
  cells: Map<string, MapCell>,
  brand: string,
  probe?: { insights: Insight[]; out: { key: string; kind: string; cellId: string | null; how: string }[] }
): { title: string; body: string; cellId: string }[] {
  const ids = [...cells.keys()];
  const firstOf = (prefix: string) => ids.find((id) => id.startsWith(prefix)) ?? null;
  const openCells = specs.filter((x) => x.band === "chooses" && x.row === "open");
  const idOf = (x: CellSpec) => `${x.band}:${x.row}:${x.key}`;
  // Known vs picked points at the open-choice room with the widest named-vs-picked gap.
  const fallbackOpen = firstOf("chooses:open:") ?? firstOf("chooses:social:") ?? ids[0] ?? "";
  const containsName = (text: string, name: string) => name.length > 0 && text.toLowerCase().includes(name.toLowerCase());
  const longestMatch = (text: string, list: CellSpec[], nameOf: (x: CellSpec) => string) =>
    [...list].filter((x) => containsName(text, nameOf(x))).sort((a, b) => nameOf(b).length - nameOf(a).length)[0] ?? null;

  const out: { title: string; body: string; cellId: string }[] = [];
  out.push({
    title: `Named in ${pctOf(f.named)}, picked in ${pctOf(f.picked)}`,
    body: `${brand} is named in ${pctOf(f.named)} of open-choice answers and picked in ${pctOf(f.picked)} - ${pctOf(f.shareYou)} of the picks that land on a brand in the category${
      f.topName && !f.youTop ? `, against ${pctOf(f.shareTop)} for ${f.topName}` : ""
    }.`,
    cellId: openCells.length ? idOf(openCells[0]) : fallbackOpen,
  });

  // bs8 placement bookkeeping for the harness probe ("match" / "generic").
  let how = "other";
  const found = (id: string | null, strict: boolean, fallback: () => string | null): string | null => {
    if (id) {
      how = "match";
      return id;
    }
    if (strict) return null;
    how = "generic";
    return fallback();
  };
  const leakCells = () => ids.filter((id) => cells.get(id)!.badges.includes("leak"));
  const cellFor = (kind: string, key: string, title: string, body: string): string | null => {
    const t = cellForText(kind, key, title, true);
    return t ?? cellForText(kind, key, `${title} ${body}`, false);
  };
  const cellForText = (kind: string, key: string, text: string, strict: boolean): string | null => {
    switch (kind) {
      case "room": {
        const hit = longestMatch(text, openCells, (x) => x.label);
        return hit ? idOf(hit) : strict ? null : fallbackOpen;
      }
      case "rival": {
        if (key === "conversion_vs_rival") {
          // The rival's fight cell (head-to-head, else its leavers), else an
          // open-choice cell the rival takes.
          const fight = longestMatch(text, specs.filter((x) => x.row === "h2h" || x.row === "leavers"), (x) => x.label);
          const taken = fight ?? longestMatch(text, openCells, (x) => x.taker.name);
          return found(taken ? idOf(taken) : null, strict, () => firstOf("fights:h2h:") ?? fallbackOpen);
        }
        const h2h = specs.filter((x) => x.row === "h2h");
        const hit = longestMatch(text, h2h, (x) => x.label);
        return hit ? idOf(hit) : strict ? null : firstOf("fights:h2h:") ?? fallbackOpen;
      }
      case "doubt": {
        if (key === "worst_worry" || key === "leave_no_exit") {
          const cust = specs.filter((x) => x.band === "doubts" && x.row === "customers");
          // The named worry; for no-exit leaves, the worry with the most leave answers.
          const hit =
            key === "worst_worry"
              ? longestMatch(text, cust, (x) => x.label)
              : [...cust].sort((a, b) => b.them.length - a.them.length || idOf(a).localeCompare(idOf(b)))[0] ?? null;
          return found(hit ? idOf(hit) : null, strict, () => firstOf("doubts:customers:") ?? firstOf("doubts:"));
        }
        if (key === "advocacy_vs_objection") return firstOf("settled:settled:advocacy") ?? firstOf("doubts:buyers:");
        const worries = specs.filter((x) => x.band === "doubts" && (x.row === "buyers" || x.row === "customers"));
        const hit = longestMatch(text, worries, (x) => x.label);
        if (hit) return idOf(hit);
        if (strict) return null;
        return firstOf(text.toLowerCase().includes("customer") && !text.toLowerCase().includes("buyer") ? "doubts:customers:" : "doubts:buyers:") ?? firstOf("doubts:");
      }
      case "value": {
        const vals = specs.filter((x) => x.row === "value");
        const hit = longestMatch(text, vals, (x) => x.label.split(" - ")[0]);
        return hit ? idOf(hit) : strict ? null : firstOf("chooses:value:");
      }
      case "argument":
        if (key === "neutralized_differentiator") {
          // The rival that takes most of the losses, named in the body.
          const hit = longestMatch(text, specs.filter((x) => x.row === "h2h"), (x) => x.label);
          return found(hit ? idOf(hit) : null, strict, () => firstOf("fights:h2h:") ?? firstOf("chooses:criteria:") ?? fallbackOpen);
        }
        return firstOf("chooses:criteria:") ?? fallbackOpen;
      case "engine": {
        const watched = ids.find((id) => cells.get(id)!.badges.includes("watch") && id.startsWith("chooses:open:"));
        return watched ?? fallbackOpen;
      }
      case "question": {
        // The insight quotes the question's wording (shortened); find its room.
        const quoted = /"([^"]+?)(?:\.\.\.)?"/.exec(text)?.[1]?.trim();
        if (quoted) {
          const hit = openCells.find((x) => x.rows.some((r) => r.intent.text.replace(/\s+/g, " ").startsWith(quoted)));
          if (hit) return idOf(hit);
        }
        return strict ? null : fallbackOpen;
      }
      case "switching": {
        // own_defense reads the holding-your-own cell; leaver_capture the
        // named rival's leaver cell, else the pooled one.
        if (key === "own_defense") return firstOf("doubts:hold:") ?? (strict ? null : firstOf("fights:leavers:") ?? fallbackOpen);
        const leavers = specs.filter((x) => x.row === "leavers");
        const hit = longestMatch(text, leavers, (x) => x.label);
        return hit ? idOf(hit) : strict ? null : firstOf("fights:leavers:") ?? fallbackOpen;
      }
      case "condition": {
        // The away condition names where it routes; the rival's head-to-head
        // carries its conditions. Else a wall-badged cell, else the open choice.
        const h2h = specs.filter((x) => x.row === "h2h");
        const hit = longestMatch(text, h2h, (x) => x.label);
        if (hit) return idOf(hit);
        const walled = ids.find((id) => cells.get(id)!.badges.includes("wall"));
        return walled ?? (strict ? null : fallbackOpen);
      }
      case "leak": {
        if (key === "leak_problem") {
          // The room's problem-recognition cell.
          const hit = longestMatch(text, specs.filter((x) => x.row === "awareness"), (x) => x.label);
          return found(hit ? idOf(hit) : null, strict, () => leakCells()[0] ?? firstOf("chooses:awareness:") ?? fallbackOpen);
        }
        // Out-of-category picks: a leak-badged cell, the named room's first.
        const leaky = new Set(leakCells());
        const named = longestMatch(text, specs.filter((x) => leaky.has(idOf(x))), (x) => x.label);
        // The room is named in the body, so the title-only pass waits for it.
        return found(named ? idOf(named) : strict ? null : leakCells()[0] ?? null, strict, () => fallbackOpen);
      }
      case "funnel":
      default:
        return fallbackOpen;
    }
  };
  const kinds = new Set<string>();
  for (const ins of s.insights) {
    if (out.length >= 5) break;
    if (ins.kind === "funnel") continue; // the known-vs-picked paragraph already carries it
    // One paragraph per kind of finding: a memo, not a feed.
    if (kinds.has(ins.kind)) continue;
    kinds.add(ins.kind);
    const cellId = cellFor(ins.kind, ins.key, ins.title, ins.body);
    if (!cellId) continue;
    out.push({ title: ins.title.charAt(0).toUpperCase() + ins.title.slice(1), body: ins.body, cellId });
  }
  if (probe)
    for (const ins of probe.insights) {
      how = "other";
      const cellId = cellFor(ins.kind, ins.key, ins.title, ins.body);
      probe.out.push({ key: ins.key, kind: ins.kind, cellId, how });
    }
  return out;
}

/* -------------------------------- cache -------------------------------- */

// am1 (2026-11-03): first version.
// am2 (2026-11-04): the summary's bs8 detectors reach the tensions (new kind "leak"; key-specific placement for the bs8 keys).
// am3 (2026-11-04): the tensions read the bs9 quota-served list (one per kind, wider composition).
// am4 (2026-11-04): reads the bs10 served list (rank-fill effect floor).
const ANALYSIS_MAP_VERSION = "am4";
export function computeAnalysisMapCached(run: Run, project: Project, request: ViewRequest = {}): Promise<AnalysisMapView | null> {
  const r = requestOf(request, false);
  return cachedView("analysis_map", ANALYSIS_MAP_VERSION, run, project, (d) => computeAnalysisMap(d, r), { setupDecision: true, judge: true }, r);
}
