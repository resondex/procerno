import { buildResolver, type Resolved, type Resolver } from "./brand_resolve";
import { containsSeq, famTokens } from "./brand_family";
import { excludedWords } from "./definition_overlap";
import { conditionKeysFor, conditionStemKey, isDefaultCondition } from "./condition_groups";
import { ENUM_TOWARD, GENERIC_AWAY, type RuleGroup } from "./rules_explorer";
import { pickRefs, routeShares, spreadRefs, themeTreeAnswers, type DossierTheme, type ThemeMap } from "./reason_themes";
import { rulesForThemes, sharedRules, sharedRunThemes, type RulesShared } from "./run_themes";
import { isWallWording } from "./wall_wording";
import { ROW_NAME } from "./question_names";
import { commitSentence, insightBar, insightInputs, pctFine, productNoun, rankedInsights, type ExampleIndex, type InsightInputs } from "./summary_insights";
import { BRAND_SUMMARY_VERSION, computeBrandSummary, sharedBrandSummary, type BrandSummaryView, type Insight } from "./brand_summary";
import { computeValue, type ValueRow } from "./value";
import { exitResolver } from "./exits";
import { ENGINES, engineDisplayLabel } from "./providers";
import { viewsOf, type ViewKey } from "./views";
import { cachedView, cell, computeMemo, condCache, coreOf, facetsOf, poolOf, requestOf, type PoolRow, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import {
  type AnalysisMapView,
  type AnswerRef,
  type Archetype,
  type BrandRead,
  type RivalHere,
  type ArgsMode,
  type ArgsRow,
  type CastingLine,
  type CellBadge,
  type CellVerdict,
  type BothWaysItem,
  type ConditionItem,
  type LiftItem,
  type MapBand,
  type MapCell,
  type MapRow,
  type Position,
  type PositionBrand,
  type PositionNotes,
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
 * BANDS (a row exists only when its cells do; a cell only when it has answers).
 * Every row that would hold two or more cells opens with a pooled "All" cell
 * (key "all", MapCell.all) - the row at zero variance, rendered first with a
 * divider (2026-11-05). The open-choice All cell is the headline pool whole
 * (the Verdict's base - slightly more than its room cells' sum, since the
 * pool includes questions asked of no particular buyer) and its position is
 * where the UI mounts the full decision-rules ledger. Pooled cells never
 * feed the brief's moves or SWOT strengths (the verdict paragraph carries
 * the market totals); a sole wide cell is not pooled and stays movable.
 *   "Where the buyer chooses"  - per ROOM (intent situations in setup order):
 *       Open choice (discovery + use-case, per room); Social validation
 *       (base-voiced, one wide cell); Awareness (problem recognition per room;
 *       a base-voiced problem cell is wide); Learning the category (category
 *       education, wide); Value (per room, labelled "room - line" from the
 *       confirmed setup decision); Premium vs basic (wide); Criteria taught
 *       (per room when room-pinned, else wide).
 *   "The named fights" - Head-to-head (one cell per entity rival, then one
 *       per class brand; the All cell pools the entity rivals only - am9);
 *       Rival leavers (one cell per rival angle when the
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
/** am21 both-ways: answers needed per side, the smaller side's minimum ratio to the larger, rows shown. */
const BOTH_MIN = 3;
const BOTH_RATIO = 1 / 3;
const BOTH_SHARE = 0.02; // each side at least 2% of the contest's rule-bearing answers
const BOTH_TOP = 4;
/** am22: the most themes a rival's per-contest `sendsThemes` carries (the panel draws 3, its fold 8). */
const SENDS_THEME_TOP = 8;
export const RECEIPTS = 5;
const WALL_MIN = 5;
const DEFAULT_MARGIN = 0.05;
/** am15: a brand needs this many in-category picks in a contest to be listed
 * in Position.brands; two brands (you included) must clear it. */
const BRAND_FLOOR = 5;
const BRANDS_TOP = 5;
const BRAND_PROOF = 3;
/** am15: argsMode rival / all / topics need this many answers carrying the field. */
const ARGS_MIN = 10;
const ARGS_TOP = 5;
/** am18: every argument row a panel draws carries its example answers. */
const REF_ROWS = 12;

/* ----------------------------- small helpers ---------------------------- */

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pctOf = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const pct = (c: RateCell) => pctOf(rate(c));
const norm = (s: string) => s.trim().toLowerCase();
const share = (k: number, n: number) => (n > 0 ? k / n : 0);
const tipC = (c: RateCell) => `${c.k} of ${c.n}`;
/** A signed lift in points, as the summary's insights print it ("+30 points"). */
const signedPts = (x: number) => `${x >= 0 ? "+" : "-"}${Math.round(Math.abs(x) * 100)} points`;
/** am11: a lift row's two shares for its sub-line, in the brief's formatting. */
const liftShares = (l: { wins: RateCell; others: RateCell }) => ({ wins: pct(l.wins), others: pct(l.others), tip: `${tipC(l.wins)} · ${tipC(l.others)}` });

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
  /** The row's roll-up cell (key "all") among split siblings: rendered with a
   * divider, excluded from the brief's moves and strengths. */
  pooled?: boolean;
  /** Head-to-head cells: the rival's dictionary key (the brief anchors a matchup by it). */
  rivalKey?: string;
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
  /** sides: the sub-line's words for the two buckets (default your picks /
   * rivals' picks). */
  lift?: { wins: PoolRow[]; others: PoolRow[]; note: string; sides?: [string, string] };
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
  /** The panel's "The numbers" block (am9; cell-scoped since am10): the figures that answer this cell's question. */
  figures?: Figure[];
}

/** One line of a position's "The numbers" block. */
type Figure = { label: string; value: string; tip?: string };

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

/** am15: the active rival brand one away rule sends buyers to (ruleSide's
 * resolution), or null when it names no active brand other than the target. */
function ruleTo(rule: { choice: string; product?: string }, schema: string, resolve: Resolver, targetKey: string): string | null {
  const choice = rule.choice.trim();
  const product = rule.product?.trim();
  let r: Resolved;
  if (schema === "choice" || schema === "expansion" || schema === "ecosystem" || schema === "premium") {
    if (schema === "premium" && !product) return null;
    r = resolve(schema === "premium" ? product! : choice);
  } else if (product) r = resolve(product);
  else if (ENUM_TOWARD.has(choice) || GENERIC_AWAY[choice]) return null;
  else r = resolve(choice);
  return r.status === "active" && r.key !== targetKey ? r.name : null;
}

/** am21: the product one rule names, as written (the examples' "Sent to"). */
function ruleCard(rule: { choice: string; product?: string }, schema: string): string {
  const choice = rule.choice.trim();
  const product = rule.product?.trim();
  if (schema === "choice" || schema === "expansion" || schema === "ecosystem") return choice;
  if (product) return product;
  if (ENUM_TOWARD.has(choice)) return ""; // a verdict, not a product - the side already says it
  return GENERIC_AWAY[choice] ?? choice;
}

/* ------------------------------- the compute ------------------------------ */

interface Group {
  /** am21: the condition key - shared across sides, so one reason stated both ways has one key. */
  ck: string;
  label: string;
  n: number;
  surfaces: string[];
  /** am15: response id -> the answer's own wording, engine and away destinations. */
  answers: Map<string, { said: string; model: string; to: Set<string>; cards: string[]; mixed: number }>;
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
  /** The brief (brief.ts, bf1): each cell's sides as counts, filled when
   * the object is passed - the memo sentences need the numbers a Position
   * carries only as prose. */
  cells?: Record<string, MapCellStat>;
  /** The brief: the summary the map computed (so the brief never pays for a second one). */
  summary?: BrandSummaryView;
}

/** One map cell's side counts (exported for the brief). */
export interface MapCellStat {
  band: string;
  row: string;
  label: string;
  verdict: CellVerdict;
  lean: number;
  you: number;
  them: number;
  /** The side-taking denominator. */
  d: number;
  n: number;
  taker: string;
  takerKind: string;
  /** The first possession-shaped away condition, when the cell carries the wall badge. */
  wall: string | null;
  badges: CellBadge[];
  /** The row's pooled All cell: excluded from the brief's moves and strengths. */
  pooled: boolean;
  /** Head-to-head cells: the rival's dictionary key; rival-leaver cells: the brand being left. */
  rivalKey?: string;
}

export async function computeAnalysisMap(
  data: ViewData,
  request: ViewRequest = {},
  debug?: AnalysisMapDebug,
  pre?: { summary?: BrandSummaryView; inputs?: InsightInputs; rules?: RulesShared }
): Promise<AnalysisMapView> {
  const { project, dictionary } = data;
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const brand = project.brand;
  const capture: { inputs?: InsightInputs } = {};
  const summary = pre?.summary ?? (await computeBrandSummary(data, eng, capture));
  // The detectors' sibling-view inputs: the figures restate their numbers exactly (am9).
  const inputs = pre?.inputs ?? capture.inputs ?? (await insightInputs(data, eng));
  if (debug) debug.summary = summary;
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
  /** am15: one pick contest's in-category split, most picked first - the ONE
   * computation behind the "Share of the picks here, by brand" figure and
   * Position.brands, so the two can never disagree. */
  const brandSplit = (rows: PoolRow[]) => {
    const inCat = rows.filter((r) => pickOf(r).status === "active");
    const by = new Map<string, { key: string; name: string; rows: PoolRow[] }>();
    for (const r of inCat) {
      const p = pickOf(r);
      const t = by.get(p.key!) ?? { key: p.key!, name: p.key === targetKey ? brand : p.name!, rows: [] };
      t.rows.push(r);
      by.set(p.key!, t);
    }
    return { n: inCat.length, list: [...by.values()].sort((a, c) => c.rows.length - a.rows.length || a.name.localeCompare(c.name)) };
  };

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
      row === "open"
        ? key === "all"
          ? "Across every open buying question (including the ones asked of no particular buyer)"
          : `For ${label}`
        : row === "social" ? "Asked what most buyers pick"
        : row === "premium" ? "Asked whether premium beats basic"
        : rowLabel;
    return {
      band, row, rowLabel, key, label, wide, rows,
      you, them: outsideTakes ? outside : them, taker,
      sideD: outsideTakes ? firm.length : inCat.length,
      leakShare,
      note: (v) => {
        if (v === "nocall") return inCat.length < MIN_SIDE ? `${pct(noPick)} no clear pick` : "no side taken";
        if (v === "yours") return `you ${pct(youC)} of picks${top ? ` - ${top[1].name} ${pct(themC)}` : ""}`;
        return `${taker.name} ${pct(outsideTakes ? cell(outside.length, firm.length) : themC)} - you ${pct(youC)}`;
      },
      claim: (v) => {
        const lead = `${where}, ${brand} is named in ${pct(named)} of answers`;
        if (v === "nocall")
          return `${lead}, but the AI commits to no single pick in your category in ${pct(cell(rows.length - inCat.length, rows.length))} of them - the choice is left to the buyer.`;
        if (v === "yours") return `${lead} and takes ${pct(youC)} of the picks${top ? `, ahead of ${top[1].name} at ${pct(themC)}` : ""}.`;
        if (outsideTakes) return `${lead}, yet ${pctOf(leakShare)} of the answers that commit to a pick choose something outside the category - led by ${taker.name} - and ${brand} takes ${pct(youC)} of the picks.`;
        return v === "contested"
          ? `${lead}; the picks split - ${brand} ${pct(youC)}, ${taker.name} ${pct(themC)}.`
          : `${lead} and takes ${pct(youC)} of the picks; ${taker.name} takes ${pct(themC)}.`;
      },
      lift: { wins: you, others: inCat.filter((r) => pickOf(r).key !== targetKey), note: "Share of answers arguing each code when you are picked vs when another brand in the category is." },
    };
  };

  /** Mark a spec as its row's roll-up and push it (always first in its row). */
  const pushAll = (s: CellSpec) => {
    s.pooled = true;
    specs.push(s);
  };

  /* Band 1: where the buyer chooses. The open-choice All cell is the headline
   * pool whole (the Verdict's own base; its position mounts the full
   * decision-rules ledger in the UI), not just the room cells' union -
   * assistants stay the Panel lens and conditions stay inside positions. */
  const headline = pool("headline");
  if (headline.length) pushAll(choiceSpec("chooses", "open", ROW_NAME.open, "all", "All buyers", headline));
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
    specs.push(choiceSpec("chooses", "open", ROW_NAME.open, norm(room), room, rows));
  const social = headline.filter((r) => r.intent.stage === "social_validation");
  if (social.length) specs.push(choiceSpec("chooses", "social", ROW_NAME.social, "all", "", social, true));

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
    const where =
      row === "awareness" && key === "all" && !wide
        ? "Across every problem question"
        : row === "awareness" && key === "general" && !wide
          ? "In the problem questions asked of no particular buyer"
          : row === "awareness" && !wide
            ? `In ${label}'s problem questions`
            : wide
              ? `On ${rowLabel.toLowerCase()} questions`
              : rowLabel;
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
        const route = routed.length >= MIN_SIDE && rate(adjacent) >= 0.1 ? `; ${pct(adjacent)} of the answers that point to a solution send the buyer outside the category` : "";
        if (v === "nocall") return `${lead} - too few answers recommend any brand to call who the category is explained around${route}.`;
        if (!top) return `${lead}${route}.`;
        return `${lead}, against ${top[1].name} at ${pct(recTop)}${route}.`;
      },
    };
  };
  const routing = pool("awareness_routing");
  const routingRooms = byRoom(routing);
  const routingBase = routing.filter((r) => !r.intent.situation);
  const routingCells = routingRooms.length + (routingBase.length ? 1 : 0);
  if (routingCells >= 2) pushAll(awarenessSpec("awareness", ROW_NAME.awareness, "all", "All buyers", routing, false));
  for (const [room, rows] of routingRooms) specs.push(awarenessSpec("awareness", ROW_NAME.awareness, norm(room), room, rows, false));
  // A base-voiced cell among siblings keys "general" (the All cell owns "all"); alone, it keeps the sole-wide form.
  if (routingBase.length)
    specs.push(
      routingCells >= 2
        ? awarenessSpec("awareness", ROW_NAME.awareness, "general", "No particular buyer", routingBase, false)
        : awarenessSpec("awareness", ROW_NAME.awareness, "all", "", routingBase, true)
    );
  const explainer = pool("awareness_explainer");
  if (explainer.length) specs.push(awarenessSpec("explainer", ROW_NAME.explainer, "all", "", explainer, true));

  // Value per room (computeValue: the v6 own rung, the confirmed lines).
  const valueView = computeValue(data, eng);
  const valueRowOf = new Map<string, ValueRow>((valueView?.rooms ?? []).map((r) => [r.key, r]));
  const valueRows = pool("value");
  const valueGroups = new Map<string, PoolRow[]>();
  for (const r of valueRows) valueGroups.set(r.intent.situation ?? "", [...(valueGroups.get(r.intent.situation ?? "") ?? []), r]);
  if (valueGroups.size >= 2) {
    const yes = valueRows.filter((r) => r.code.worth_it === "yes");
    const no = valueRows.filter((r) => r.code.worth_it === "no");
    const worthC = cell(yes.length, valueRows.length);
    const notC = cell(no.length, valueRows.length);
    const vRooms = valueView?.rooms ?? [];
    const own = vRooms.reduce((a, v) => a + v.ownRung.k, 0);
    const riv = vRooms.reduce((a, v) => a + v.recommendsInstead.k, 0);
    const doubting = vRooms.reduce((a, v) => a + v.ownRung.n, 0);
    const inhouseShare = doubting >= MIN_SIDE && own + riv > 0 ? own / (own + riv) : 0;
    const byName = new Map<string, { name: string; n: number; own: boolean }>();
    for (const v of vRooms)
      for (const i of v.instead) {
        const t = byName.get(`${i.own}|${i.name}`) ?? { name: i.name, n: 0, own: i.own };
        t.n += i.n;
        byName.set(`${i.own}|${i.name}`, t);
      }
    const tops = [...byName.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const ownTop = tops.find((i) => i.own);
    const rivTop = tops.find((i) => !i.own);
    const taker: Taker =
      inhouseShare >= INHOUSE_SHARE && ownTop
        ? { name: ownTop.name, kind: TAKER.own }
        : rivTop
          ? { name: rivTop.name, kind: TAKER.rival }
          : { name: "A cheaper option, unnamed", kind: TAKER.undecided };
    pushAll({
      band: "chooses", row: "value", rowLabel: ROW_NAME.value, key: "all", label: "All buyers", rows: valueRows,
      you: yes, them: no, taker, inhouseShare,
      note: (v) => (v === "nocall" ? `${pct(cell(valueRows.length - yes.length - no.length, valueRows.length))} "depends"` : `${pct(worthC)} worth it / ${pct(notC)} not`),
      claim: (v) => {
        const lead = `Across every buying situation, ${brand} is judged worth it over a cheaper option in ${pct(worthC)} of answers and not worth it in ${pct(notC)}`;
        if (v === "nocall") return `${lead} - the rest say it depends, so the AI takes no side here.`;
        if (doubting >= MIN_SIDE && own + riv > 0)
          return `${lead}; of the doubts, ${pctOf(share(own, doubting))} point to ${brand}'s own cheaper option and ${pctOf(share(riv, doubting))} to a rival${taker.kind !== TAKER.undecided ? `, led by ${taker.name}` : ""}.`;
        return `${lead}.`;
      },
      lift: { wins: yes, others: no, note: "Share of worth-it answers vs not-worth-it answers arguing each code.", sides: ["worth-it answers", "not-worth-it answers"] },
    });
  }
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
      band: "chooses", row: "value", rowLabel: ROW_NAME.value, key: norm(room) || (valueGroups.size >= 2 ? "general" : "all"), label, wide: !room && valueGroups.size < 2, rows,
      you: yes, them: no, taker, inhouseShare,
      note: (v) => (v === "nocall" ? `${pct(cell(rows.length - yes.length - no.length, rows.length))} "depends"` : `${pct(worthC)} worth it / ${pct(notC)} not`),
      claim: (v) => {
        const lead = `${room ? `For ${room}, ` : ""}${subject} is judged worth it over a cheaper option in ${pct(worthC)} of answers and not worth it in ${pct(notC)}`;
        if (v === "nocall") return `${lead} - the rest say it depends, so the AI takes no side here.`;
        if (doubting >= MIN_SIDE && own + riv > 0)
          return `${lead}; of the doubts, ${pctOf(share(own, doubting))} point to ${brand}'s own cheaper option and ${pctOf(share(riv, doubting))} to a rival${taker.kind !== TAKER.undecided ? `, led by ${taker.name}` : ""}.`;
        return `${lead}.`;
      },
      lift: { wins: yes, others: no, note: "Share of worth-it answers vs not-worth-it answers arguing each code.", sides: ["worth-it answers", "not-worth-it answers"] },
    });
  }

  // Premium vs basic (wide).
  const premium = pool("premium_tier");
  if (premium.length) specs.push(choiceSpec("chooses", "premium", ROW_NAME.premium, "all", "", premium, true));

  // Criteria taught: per room when room-pinned, else wide.
  const lift = summary.reasonLift;
  const winners = lift.filter((l) => l.lift > 0 && l.wins.low > l.others.high).slice(0, 3);
  const losers = [...lift].reverse().filter((l) => l.lift < 0 && l.others.low > l.wins.high).slice(0, 3);
  const liftOf = new Map(lift.map((l) => [l.code, l.lift]));
  const liftRow = new Map(lift.map((l) => [l.code, l]));
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
        ...liftShares(liftRow.get(c)!),
      }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, LIFT_TOP);
    const taughtText = top5.slice(0, 3).map((c) => `${c} (${pct(taughtRate(c))})`).join(", ");
    const you = withReasons.filter((r) => winTaught.some((w) => r.code.reasons!.includes(w.code)));
    const them = withReasons.filter((r) => loseTaught.some((l) => r.code.reasons!.includes(l.code)));
    return {
      band: "chooses", row: "criteria", rowLabel: ROW_NAME.criteria, key, label, wide, rows,
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
        const where =
          key === "all" && !wide
            ? "Across every buying situation, the criteria the AI teaches"
            : key === "general" && !wide
              ? "Asked with no particular buyer in mind, the criteria the AI teaches"
              : wide
                ? "The criteria the AI teaches"
                : `For ${label}, the criteria the AI teaches`;
        if (v === "nocall") return `${where} lead with ${taughtText || "no single argument"} - too little to set against your winning arguments.`;
        if (v === "theirs")
          return `${where} lead with ${taughtText}${untaught ? ` - while ${untaught.code}, an argument that comes up more when you win, goes untaught` : ", none of them an argument that comes up more when you win"}.`;
        if (v === "yours") return `${where} lead with ${taughtText}, including ${winTaught[0].code} - an argument that comes up more when you win.`;
        return `${where} lead with ${taughtText}: ${winTaught[0].code} helps you, ${loseTaught[0].code} favors the rival picks.`;
      },
    };
  };
  const criteria = pool("criteria_taught");
  const criteriaRooms = byRoom(criteria);
  const criteriaBase = criteria.filter((r) => !r.intent.situation);
  const criteriaCells = criteriaRooms.length + (criteriaBase.length ? 1 : 0);
  if (criteriaCells >= 2) pushAll(criteriaSpec("all", "All buyers", criteria, false));
  for (const [room, rows] of criteriaRooms) specs.push(criteriaSpec(norm(room), room, rows, false));
  if (criteriaBase.length)
    specs.push(criteriaCells >= 2 ? criteriaSpec("general", "No particular buyer", criteriaBase, false) : criteriaSpec("all", "", criteriaBase, true));

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
      band: "fights", row: "h2h", rowLabel: ROW_NAME.h2h, key, label: rival.name, rivalKey: rival.key, rows,
      you: won, them: lost,
      taker: { name: rival.name, kind: takerKindOf(rival.key) },
      leakShare: firm.length >= MIN_SIDE ? share(outside.length, firm.length) : 0,
      note: (v) => (v === "nocall" ? `${pct(undecided)} no clear pick` : `${pct(rec)} of picks`),
      claim: (v) =>
        v === "nocall"
          ? `Asked to compare ${brand} with ${rival.name} directly, the AI declines to pick between them in ${pct(undecided)} of answers.`
          : `Asked to compare ${brand} with ${rival.name} directly, the AI picks ${brand} in ${pct(rec)} of the answers that pick one of them${undecided.k > 0 ? ` (no clear pick in ${pct(undecided)})` : ""}.`,
      lift: { wins: won, others: lost, note: `Within this matchup: share of answers arguing each code when you win vs when ${rival.name} does.`, sides: ["your wins", `${rival.name}'s wins`] },
    };
  };
  /** Every prompted matchup against a NAMED rival pooled (am9: entity rivals
   * only - a class contest and a company contest are not mutually exclusive,
   * so class matchups are stated beside the pooled number in the figures,
   * never summed into it): you win vs the named rival wins. */
  const h2hAllSpec = (groups: { rival: { key: string; name: string }; rows: PoolRow[] }[], classes: { rival: { key: string; name: string }; rows: PoolRow[] }[]): CellSpec => {
    const rows = groups.flatMap((g) => g.rows);
    const won: PoolRow[] = [];
    const lost: PoolRow[] = [];
    const lostBy = new Map<string, { name: string; k: number }>();
    for (const g of groups)
      for (const r of g.rows) {
        const p = pickOf(r);
        if (p.key === targetKey) won.push(r);
        else if (p.key === g.rival.key) {
          lost.push(r);
          const t = lostBy.get(g.rival.key) ?? { name: g.rival.name, k: 0 };
          t.k++;
          lostBy.set(g.rival.key, t);
        }
      }
    const tough = [...lostBy.values()].sort((a, b) => b.k - a.k || a.name.localeCompare(b.name))[0];
    const firm = rows.filter((r) => pickOf(r).status !== "none");
    const outside = firm.filter((r) => pickOf(r).status !== "active");
    const rec = cell(won.length, won.length + lost.length);
    const undecided = cell(rows.length - firm.length, rows.length);
    return {
      band: "fights", row: "h2h", rowLabel: ROW_NAME.h2h, key: "all", label: "All rivals", rows,
      you: won, them: lost,
      taker: tough ? { name: tough.name, kind: TAKER.rival } : { name: "No single pick", kind: TAKER.undecided },
      leakShare: firm.length >= MIN_SIDE ? share(outside.length, firm.length) : 0,
      note: (v) => (v === "nocall" ? `${pct(undecided)} no clear pick` : `${pct(rec)} of picks across ${groups.length} rivals`),
      claim: (v) =>
        v === "nocall"
          ? `Asked to compare ${brand} with one of its named rivals directly, the AI declines to pick between them in ${pct(undecided)} of answers.`
          : `Across its named rivals, asked to compare ${brand} with one of them directly, the AI picks ${brand} in ${pct(rec)} of the answers that pick one of them${tough ? `; ${tough.name} wins the most of them against you` : ""}.`,
      figures: classes.map((g) => {
        const w = g.rows.filter((r) => pickOf(r).key === targetKey).length;
        const l = g.rows.filter((r) => pickOf(r).key === g.rival.key).length;
        return { label: `Asked against the ${g.rival.name} class (not in the pooled number)`, value: `${pct(cell(w, w + l))} of picks`, tip: `${w} won, ${l} lost` };
      }),
      lift: { wins: won, others: lost, note: "Pooled across every matchup: share of answers arguing each code when you win vs when the named rival does.", sides: ["your wins", "rivals' wins"] },
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
  const entityList = [...entityGroups.values()].sort((a, b) => a.seq - b.seq);
  const classList = [...classGroups.values()].sort((a, b) => a.seq - b.seq);
  if (entityList.length + classList.length >= 2) pushAll(h2hAllSpec(entityList, classList));
  for (const g of entityList) specs.push(h2hSpec(g.key, g.rival, g.rows));
  for (const g of classList) specs.push(h2hSpec(g.key, g.rival, g.rows));

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
    // A mention of the target framed recommended, or the target as the pick (alternatives.ts).
    const recommended = cell(rows.filter((r) => recommendsOf(r).has(targetKey) || pickOf(r).key === targetKey).length, rows.length);
    const youC = cell(you.length, inCat.length);
    const topC = cell(top ? top[1].rows.length : 0, inCat.length);
    const picked = cell(you.length, rows.length);
    const outside = firm.length - inCat.length;
    const whose = key === "all" ? "Buyers leaving a rival" : `Buyers leaving ${label}`;
    return {
      band: "fights", row: "leavers", rowLabel: ROW_NAME.leavers, key, label, wide, rows,
      // The brand being left (debug.cells only - the brand dossiers link its leaver cell by it).
      ...(leftKey ? { rivalKey: leftKey } : {}),
      you, them: top ? top[1].rows : [],
      sideD: inCat.length,
      taker: top
        ? { name: top[1].name, kind: top[0] === leftKey ? "the brand they are leaving" : takerKindOf(top[0]) }
        : { name: "No single pick", kind: TAKER.undecided },
      leakShare: firm.length >= MIN_SIDE ? share(outside, firm.length) : 0,
      note: (v) => (v === "nocall" ? `named ${pct(named)}, picked ${pct(picked)}` : `named ${pct(named)}, picked ${pct(picked)}${top ? ` - ${top[1].name} ${pct(topC)} of picks` : ""}`),
      claim: (v) =>
        `${whose}: ${brand} is named in ${pct(named)} of answers and picked in ${pct(picked)}${
          v === "nocall" ? " - too few answers commit to a pick to call who captures them" : top ? `; ${top[1].name} takes ${pct(topC)} of the picks against your ${pct(youC)}` : ""
        }.`,
      lift: { wins: you, others: inCat.filter((r) => pickOf(r).key !== targetKey), note: "Share of the switching customers' answers arguing each code when the AI tells them to pick you vs another brand." },
      figures: [
        { label: `${brand} named`, value: pct(named), tip: tipC(named) },
        { label: `${brand} recommended`, value: pct(recommended), tip: tipC(recommended) },
        { label: `${brand} picked, of all answers`, value: pct(picked), tip: tipC(picked) },
        ...(top ? [{ label: `${top[1].name}'s share of the picks`, value: pct(topC), tip: tipC(topC) }] : []),
        ...(firm.length ? [{ label: "Picks outside the category", value: pct(cell(outside, firm.length)), tip: `${outside} of ${firm.length} firm picks` }] : []),
      ],
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
    const soleLeft = rivalAngles === 1 ? [...leaverGroups.values()].find((g) => g.leftKey)?.leftKey ?? null : null;
    if (rivalAngles >= 2) {
      pushAll(leaverSpec("all", "All rivals", offensive, false, null));
      for (const g of [...leaverGroups.values()].sort((a, b) => a.seq - b.seq)) specs.push(leaverSpec(g.key, g.name, g.rows, false, g.leftKey));
    } else specs.push(leaverSpec("all", "", offensive, true, soleLeft));
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
  const buyersSpec = (key: string, label: string, rows: PoolRow[], who: string): CellSpec => {
    const proceed = rows.filter((r) => r.code.proceed_or_avoid === "proceed");
    const conceded = rows.filter((r) => r.code.proceed_or_avoid === "avoid" || (r.code.premise_verdict === "confirms" && r.code.proceed_or_avoid !== "proceed"));
    const judged = rows.filter((r) => r.code.premise_verdict === "confirms" || r.code.premise_verdict === "mixed" || r.code.premise_verdict === "rebuts");
    const agreed = judged.filter((r) => r.code.premise_verdict === "confirms");
    const agree = cell(agreed.length, judged.length);
    const go = cell(proceed.length, rows.length);
    const goOfAgreed = cell(agreed.filter((r) => r.code.proceed_or_avoid === "proceed").length, agreed.length);
    return {
      band: "doubts", row: "buyers", rowLabel: ROW_NAME.buyers, key, label, rows,
      you: proceed, them: conceded,
      taker: exitTaker(conceded, { name: "The worry, conceded", kind: TAKER.undecided }),
      conceded: { agree, goAheadOfAgreed: goOfAgreed },
      exitFallback: topExits(rows).slice(0, COND_TOP),
      note: () => `agreed ${pct(agree)} · go ahead ${pct(go)}`,
      claim: (v) =>
        `${who}, the AI agrees the worry is warranted in ${pct(agree)} of the answers that judge it and tells them to go ahead in ${pct(go)}${
          v === "nocall" ? " - most answers take no side" : agreed.length >= MIN_SIDE && rate(goOfAgreed) >= 0.3 ? `, including ${pct(goOfAgreed)} of the answers that agree` : ""
        }.`,
      lift: { wins: proceed, others: conceded, note: "Share of go-ahead answers vs conceding answers arguing each code.", sides: ["go-ahead answers", "conceding answers"] },
    };
  };
  const buyerGroups = worryGroups(objections);
  if (buyerGroups.length >= 2) pushAll(buyersSpec("all", "All worries", objections, "Across every buyer worry"));
  for (const g of buyerGroups) {
    const label = g.concern || "A worry";
    specs.push(buyersSpec(norm(label), label, g.rows, `When a buyer worries "${label}"`));
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
        `${who}, the AI says stay in ${pct(keepC)} of answers and leave in ${pct(leaveC)}${v === "nocall" ? " - most take no side" : taker.kind === TAKER.rival ? `; ${taker.name} is where the AI sends most of the customers it tells to leave` : ""}.`,
      lift: { wins: keep, others: leave, note: "Share of stay answers vs leave answers arguing each code.", sides: ["stay answers", "leave answers"] },
    };
  };
  if (custGroups.length >= 2) pushAll(staySpec("customers", ROW_NAME.customers, "all", "All worries", stayRows, false, "Across every customer worry"));
  for (const g of custGroups) {
    const label = g.concern || "A worry";
    const key = (concernCount.get(norm(g.concern)) ?? 0) > 1 ? `${norm(label)}|${g.stage}` : norm(label);
    specs.push(staySpec("customers", ROW_NAME.customers, key, label, g.rows, false, `When a customer worries "${label}"`));
  }
  const hold = pool("defensive_hold");
  if (hold.length) specs.push(staySpec("hold", ROW_NAME.hold, "all", "", hold, true, "When your own customer asks what else to look at"));
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
      band: "doubts", row: "repertoire", rowLabel: ROW_NAME.repertoire, key: "all", label: "", wide: true, rows: repertoire,
      you: stick, them: sw,
      taker: topSw ? { name: topSw[0], kind: TAKER.rival } : { name: "No single pick", kind: TAKER.undecided },
      note: () => `stick ${pct(stickC)} · switch ${pct(swC)}`,
      claim: (v) =>
        `Asked whether to keep buying ${brand} out of habit, the AI says stick with it in ${pct(stickC)} of answers and switch in ${pct(swC)}${v !== "nocall" && topSw ? `, most often to ${topSw[0]}` : ""}.`,
      lift: { wins: stick, others: sw, note: "Share of stick answers vs switch answers arguing each code.", sides: ["stick answers", "switch answers"] },
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
  const settledPresent = settledStages.map(([view, key, label]) => ({ view, key, label, rows: pool(view) })).filter((s) => s.rows.length > 0);
  if (settledPresent.length >= 2) {
    const rows = settledPresent.flatMap((s) => s.rows);
    const str = rows.filter((r) => r.code.relationship_verdict === "strengthens");
    const weak = rows.filter((r) => r.code.relationship_verdict === "weakens");
    const strC = cell(str.length, rows.length);
    const redirects = new Map<string, number>();
    for (const r of rows) for (const x of exitsOf(r.code.redirect_to).exits.values()) redirects.set(x.name, (redirects.get(x.name) ?? 0) + 1);
    const topRed = [...redirects.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const names = settledPresent.map((s) => s.key);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    pushAll({
      band: "settled", row: "settled", rowLabel: ROW_NAME.settled, key: "all", label: "All questions", rows,
      you: str, them: weak,
      taker: topRed && topRed[1] >= Math.max(3, rows.length * 0.1) ? { name: topRed[0], kind: TAKER.rival } : { name: "No side taken", kind: TAKER.undecided },
      note: () => `strengthens ${pct(strC)}`,
      claim: (v) => {
        const lead = `Asked by your customers across ${list}, the AI strengthens the relationship in ${pct(strC)} of answers`;
        return v === "nocall" ? `${lead} - most answers stay neutral.` : `${lead}${weak.length ? ` and weakens it in ${pct(cell(weak.length, rows.length))}` : ""}.`;
      },
      lift: { wins: str, others: rows.filter((r) => r.code.relationship_verdict !== "strengthens"), note: "Share of strengthening answers vs the rest arguing each code.", sides: ["strengthening answers", "the rest"] },
    });
  }
  for (const { view, key, label, rows } of settledPresent) {
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
      band: "settled", row: "settled", rowLabel: ROW_NAME.settled, key, label, rows,
      you: str, them: weak,
      taker: topRed && topRed[1] >= Math.max(3, rows.length * 0.1) ? { name: topRed[0], kind: TAKER.rival } : { name: "No side taken", kind: TAKER.undecided },
      settledWatch,
      note: () => `strengthens ${pct(strC)}`,
      claim: (v) => {
        const lead = `Asked by your customers about ${key}, the AI strengthens the relationship in ${pct(strC)} of answers`;
        if (settledWatch) return `${lead}; asked neutrally about buyers' worries, it agrees with them in ${pct(objectionsAgree)} - the asker set the side here.`;
        return v === "nocall" ? `${lead} - most answers stay neutral.` : `${lead}${weak.length ? ` and weakens it in ${pct(cell(weak.length, rows.length))}` : ""}.`;
      },
      lift: { wins: str, others: rows.filter((r) => r.code.relationship_verdict !== "strengthens"), note: "Share of strengthening answers vs the rest arguing each code.", sides: ["strengthening answers", "the rest"] },
    });
  }

  /* -- the numbers (am9, the citation ruling): every figure a brief cites,
   * stated on the cell whose pool it reads. Where the brief reads the
   * summary or the detectors' inputs, the figure restates that same stat
   * from the same object (byte-equal by construction); cell-local figures
   * recompute from the cell's rows. Counts ride in `tip` only. -- */
  const specId = (x: CellSpec) => `${x.band}:${x.row}:${x.key}`;
  const specOf = (id: string) => specs.find((x) => specId(x) === id);
  const addFigs = (id: string | undefined, figs: Figure[]) => {
    const sp = id ? specOf(id) : undefined;
    if (sp && figs.length) sp.figures = [...(sp.figures ?? []), ...figs];
  };
  /** A row's pooled cell: its All cell, else the row's only cell. */
  const pooledId = (prefix: string) => {
    if (specOf(`${prefix}all`)) return `${prefix}all`;
    const ids = specs.map(specId).filter((id) => id.startsWith(prefix));
    return ids.length === 1 ? ids[0] : undefined;
  };
  const F = (label: string, c: RateCell, value = pct(c)): Figure => ({ label, value, tip: tipC(c) });
  const listVal = (xs: string[]) => xs.join(" · ");
  const conv = (b: { chosen: RateCell; recommended: RateCell }) => (b.recommended.k > 0 ? b.chosen.k / b.recommended.k : 0);
  const product = productNoun(project.category);
  {
    // Open choice, every buyer: the target's funnel.
    const S = summary.target;
    const figs: Figure[] = [
      F("Named when buyers ask what to buy", S.mentioned),
      F("Recommended", S.recommended),
      { label: "Recommended, of the answers that name it", value: pctOf(rate(S.mentioned) > 0 ? rate(S.recommended) / rate(S.mentioned) : 0), tip: `${S.recommended.k} recommending of ${S.mentioned.k} naming` },
      F(`The AI commits to one ${product}`, summary.firmPickInCategory),
      F("Share of picks", S.shareOfDecided),
      F("Picked, of all answers", S.chosen, pctFine(rate(S.chosen))),
      { label: "Recommendations that end as the pick", value: pctOf(conv(S)), tip: `${S.chosen.k} picks of ${S.recommended.k} recommending answers` },
    ];
    // am10 (2026-11-07, the answer cards): this panel answers its own
    // question - the target's funnel, its arguments, the picks that leave the
    // category. Every other brand's funnel, the stage and question splits, the
    // assistants and the conditions moved to the brief's answer cards
    // (answer_cards.ts: brand / engines / condition).
    // am11 (2026-11-07): the target's arguments left "The numbers" - they ride
    // the arguments section's rows (Position.lifts, built from the same
    // summary.reasonLift objects) and the open-choice card restates them.
    // Picks that leave the category (B5), overall and by buying situation.
    const lk = inputs.leak;
    if (lk.firm > 0) {
      figs.push(F("Picks outside the category", cell(lk.firm - lk.inCategory, lk.firm)));
      const rr = lk.rooms.filter((r) => r.firm > 0 && r.outside > 0);
      if (rr.length) figs.push({ label: "Picks outside the category, by buying situation", value: listVal(rr.map((r) => `${r.room} ${pct(cell(r.outside, r.firm))}`)) });
    }
    addFigs("chooses:open:all", figs);
  }
  // Open choice, per buying situation: every brand's share of the picks there.
  for (const sp of specs.filter((x) => x.band === "chooses" && x.row === "open" && x.key !== "all")) {
    const { n, list } = brandSplit(sp.rows);
    // am18: the same funnel lines the all-buyers cell states, read from this
    // buying situation's own answers - the two panels list the same numbers.
    const rs = sp.rows;
    const firmN = rs.filter((r) => pickOf(r).status !== "none").length;
    const inCatN = rs.filter((r) => pickOf(r).status === "active").length;
    const youN = rs.filter((r) => pickOf(r).status === "active" && pickOf(r).key === targetKey).length;
    const namedN = rs.filter(namesTarget).length;
    const recN = rs.filter((r) => recommendsOf(r).has(targetKey) || pickOf(r).key === targetKey).length;
    const chosenC = cell(youN, rs.length);
    const funnel: Figure[] = [
      F("Named when buyers ask what to buy", cell(namedN, rs.length)),
      F("Recommended", cell(recN, rs.length)),
      { label: "Recommended, of the answers that name it", value: pctOf(namedN > 0 ? recN / namedN : 0), tip: `${recN} recommending of ${namedN} naming` },
      F(`The AI commits to one ${product}`, cell(inCatN, rs.length)),
      F("Picked, of all answers", chosenC, pctFine(rate(chosenC))),
      { label: "Recommendations that end as the pick", value: pctOf(recN > 0 ? youN / recN : 0), tip: `${youN} picks of ${recN} recommending answers` },
      ...(firmN > 0 ? [F("Picks outside the category", cell(firmN - inCatN, firmN))] : []),
    ];
    sp.figures = [
      ...(sp.figures ?? []),
      ...funnel,
      ...(list.length ? [{ label: "Share of the picks here, by brand", value: listVal(list.map((b) => `${b.name} ${pct(cell(b.rows.length, n))}`)), tip: `${n} in-category picks` }] : []),
    ];
  }
  {
    // Head-to-head, every named rival: each rival's record, and the arguments in wins and losses.
    const h = summary.headToHead;
    const won = h.reduce((a, r) => a + r.won.k, 0);
    const lost = h.reduce((a, r) => a + r.lost.k, 0);
    const figs: Figure[] = [];
    if (won + lost > 0) figs.push(F("Direct matchups won, named rivals pooled", cell(won, won + lost)));
    const recs = h.filter((r) => r.winOfDecided.n > 0);
    if (recs.length) figs.push({ label: "Won against each rival", value: listVal(recs.map((r) => `${r.rival} ${pct(r.winOfDecided)}`)), tip: recs.map((r) => `${r.rival} ${r.won.k}-${r.lost.k}`).join("; ") });
    const se = summary.byMode.find((m) => m.key === "search");
    const ins = summary.byMode.find((m) => m.key === "instinct");
    if (se && ins && se.h2h.n > 0 && ins.h2h.n > 0) figs.push({ label: "Direct matchups won, with and without web search", value: `with ${pct(se.h2h)} · without ${pct(ins.h2h)}` });
    const ha = inputs.h2hArgs;
    if (ha.wins > 0 && ha.losses > 0)
      for (const c of ha.codes.filter((x) => x.wins >= MIN_SIDE && x.losses >= MIN_SIDE && x.wins / ha.wins >= 0.4))
        figs.push({ label: `${c.code}: argued in the matchups you win / lose`, value: `${pct(cell(c.wins, ha.wins))} / ${pct(cell(c.losses, ha.losses))}`, tip: `${c.wins} of ${ha.wins} wins; ${c.losses} of ${ha.losses} losses` });
    addFigs(pooledId("fights:h2h:"), figs);
  }
  // Head-to-head, per rival: the rival's side and the undecided share.
  for (const sp of specs.filter((x) => x.row === "h2h" && x.key !== "all")) {
    const w = sp.you.length;
    const l = sp.them.length;
    sp.figures = [...(sp.figures ?? []), F(`${brand} picked, of the answers that pick one of the two`, cell(w, w + l)), F(`${sp.label} picked, of the answers that pick one of the two`, cell(l, w + l))];
  }
  {
    // Rival leavers, pooled: the alternatives view's own numbers.
    const o = inputs.alternatives.offensive;
    if (o) {
      const t = o.overall;
      const figs: Figure[] = [F(`${brand} named`, t.named), F(`${brand} recommended`, t.recommended), F(`${brand} picked, of all answers`, t.captured)];
      const takers = o.captors.filter((c) => c.chosen.k > 0);
      if (takers.length) figs.push({ label: "Share of the switching customers' picks, by brand", value: listVal(takers.slice(0, 8).map((c) => `${c.name} ${pct(c.shareOfDecided)}`)) });
      const srcs = o.rows.filter((r) => r.key !== "generic" && r.answers > 0);
      if (srcs.length) figs.push({ label: `${brand} picked, by the rival being left`, value: listVal(srcs.map((r) => `${r.rival} ${pct(r.captured)}`)) });
      addFigs(pooledId("fights:leavers:"), figs);
      for (const sp of specs.filter((x) => x.row === "leavers" && x.key !== "all")) {
        const angle = sp.rows[0]?.intent.angle;
        const key = !angle || angle === "generic" ? "generic" : resolve(angle).key;
        const row = o.rows.find((r) => r.key === key);
        if (row) sp.figures = [...(sp.figures ?? []), F(`${brand} recommended (all answers here)`, row.recommended), F(`${brand} picked (all answers here)`, row.captured)];
      }
    }
    // Holding your own: the defensive view.
    const d = inputs.alternatives.defensive;
    if (d) {
      const figs: Figure[] = [F("Told to stay", d.verdicts.keep), F("Told to leave", d.verdicts.leave), F("No side taken", d.verdicts.undecided), F("Another brand shown", d.offersExit)];
      const dests = d.destinations.slice(0, 6);
      if (dests.length) figs.push({ label: "Shown as an exit, by brand", value: listVal(dests.map((x) => `${x.name} ${pct(x.offered)}`)) });
      addFigs(pooledId("doubts:hold:"), figs);
    }
  }
  {
    // The doubts: the doubt view's numbers, pooled and per worry.
    const o = inputs.doubt.objections;
    const bd = summary.buyersDoubt;
    const bf: Figure[] = [];
    if (bd) bf.push(F("Told to go ahead", bd.proceed), F("Told to avoid", bd.avoid), F("The AI agrees the worry is warranted", bd.agree));
    if (o) bf.push(F("Agrees, of the answers that judge the worry", o.premise.confirms), F("Still told to go ahead, of the answers that agree", o.matrix.confirms.proceed));
    addFigs(pooledId("doubts:buyers:"), bf);
    const k = inputs.doubt.keepOrLeave;
    const cd = summary.customersDoubt;
    const cf: Figure[] = [];
    if (cd) cf.push(F("Told to stay", cd.keep), F("Told to leave", cd.leave), { label: "No side either way", value: pctOf(Math.max(0, 1 - rate(cd.keep) - rate(cd.leave))) }, F("The AI agrees the worry is warranted", cd.agree));
    if (k) {
      cf.push(F("Agrees, of the answers that judge the worry", k.premise.confirms), F("Still told to stay, of the answers that agree", k.matrix.confirms.keep));
      const withExit = k.offersExitBy.leave;
      if (withExit.n > 0) cf.push(F("Leave answers naming nowhere to go", cell(withExit.n - withExit.k, withExit.n)));
      // The worst worry's baseline, with the same sort worst_worry uses.
      const ok = k.rows.filter((r) => r.answers >= MIN_SIDE);
      const top = [...ok].sort((a, b) => rate(b.verdicts.leave) - rate(a.verdicts.leave) || a.concern.localeCompare(b.concern))[0];
      if (top && k.rows.length >= 2) {
        const others = k.rows.filter((r) => r.key !== top.key);
        cf.push(F(`Told to leave, excluding "${top.concern || "the most-leaving worry"}"`, cell(others.reduce((x, r) => x + r.verdicts.leave.k, 0), others.reduce((x, r) => x + r.answers, 0))));
      }
    }
    addFigs(pooledId("doubts:customers:"), cf);
    // Per worry: its own row of the doubt view.
    for (const sp of specs.filter((x) => x.band === "doubts" && (x.row === "buyers" || x.row === "customers") && x.key !== "all")) {
      const it = sp.rows[0]?.intent;
      if (!it) continue;
      const view = sp.row === "buyers" ? o : k;
      const row = view?.rows.find((r) => r.stage === it.stage && r.concern === (it.concern ?? ""));
      if (!row) continue;
      const fig: Figure[] = [F("Agrees, of the answers that judge the worry", row.premise.confirms)];
      for (const [v, c] of Object.entries(row.verdicts) as [string, RateCell][]) fig.push(F(v === "proceed" ? "Told to go ahead" : v === "avoid" ? "Told to avoid" : v === "keep" ? "Told to stay" : v === "leave" ? "Told to leave" : "No side taken", c));
      if (row.topExits[0]) fig.push(F(`${row.topExits[0].name} offered as the exit`, cell(row.topExits[0].n, row.answers)));
      sp.figures = [...(sp.figures ?? []), ...fig];
    }
  }
  {
    // Value: the value view, pooled and per buying situation.
    const v = inputs.value;
    if (v) {
      const figs: Figure[] = [F("Worth it", v.worth.yes), F("It depends", v.worth.depends), F("Not worth it", v.worth.no)];
      if (v.ownRung.n > 0) figs.push(F("Doubts pointing to its own cheaper option", v.ownRung), F("Doubts pointing to a rival", v.recommendsInstead));
      addFigs(pooledId("chooses:value:"), figs);
      for (const sp of specs.filter((x) => x.row === "value" && x.key !== "all")) {
        const room = sp.rows[0]?.intent.situation ?? "";
        const row = v.rooms.find((r) => r.key === room);
        if (row) sp.figures = [...(sp.figures ?? []), F("Worth it", row.worth.yes), F("Not worth it", row.worth.no), ...(row.ownRung.n > 0 ? [F("Doubts pointing to its own cheaper option", row.ownRung), F("Doubts pointing to a rival", row.recommendsInstead)] : [])];
      }
    }
  }
  {
    // Criteria taught: what the AI teaches, and the lift of the codes it teaches.
    if (inputs.taught.length) {
      const figs: Figure[] = [{ label: "Most-taught criteria", value: listVal(inputs.taught.slice(0, 8).map((t) => `${t.code} ${pct(t.rate)}`)) }];
      const lift = summary.reasonLift;
      const top5 = new Set(inputs.taught.slice(0, 5).map((t) => t.code));
      for (const l of [lift[0], ...lift.filter((x) => top5.has(x.code) && x.lift < 0)].filter(Boolean))
        figs.push({ label: `${l.code}: how much more often it comes up when ${brand} is picked than when another brand is`, value: signedPts(l.lift), tip: `${tipC(l.wins)} picks; ${tipC(l.others)} other picks` });
      addFigs(pooledId("chooses:criteria:"), figs);
    }
    // Awareness: problem questions sent outside the category (the problem pool's denominator).
    const pr = inputs.problem;
    if (pr) {
      addFigs(pooledId("chooses:awareness:"), [F("Problem questions answered outside the category", pr.all)]);
      for (const r of pr.rooms) {
        const others = pr.rooms.filter((x) => x.room !== r.room);
        const rest = cell(others.reduce((x, o) => x + o.out.k, 0), others.reduce((x, o) => x + o.out.n, 0));
        addFigs(`chooses:awareness:${norm(r.room)}`, [F("Problem questions answered outside the category", r.out), ...(rest.n > 0 ? [F("The same, for the other buying situations", rest)] : [])]);
      }
    }
    // Settled customers: the settled views.
    const st = inputs.settled;
    const sfig = (vw: { verdicts: Record<string, RateCell> } | null, extra: Figure[] = []): Figure[] => (vw ? [F("Strengthens the relationship", vw.verdicts.strengthens), F("Weakens it", vw.verdicts.weakens), ...extra] : []);
    const adv = st.advocacy;
    const bc = st.businessCase;
    const ob = inputs.doubt.objections;
    addFigs("settled:settled:advocacy", sfig(adv, adv ? [F("Makes a strong case", adv.caseStrength.strong), ...(ob ? [F("Agrees with buyers' worries, asked neutrally", ob.premise.confirms)] : [])] : []));
    addFigs("settled:settled:business case", sfig(bc, bc ? [F("Makes a strong case", bc.caseStrength.strong)] : []));
    addFigs("settled:settled:expansion", sfig(st.expansion));
    addFigs("settled:settled:ecosystem", sfig(st.ecosystem));
    if (adv) addFigs(pooledId("settled:settled:"), [F("Asked to defend it: strengthens the case", adv.verdicts.strengthens), F("Asked to defend it: a strong case", adv.caseStrength.strong), ...(ob ? [F("Agrees with buyers' worries, asked neutrally", ob.premise.confirms)] : [])]);
    else if (bc) addFigs(pooledId("settled:settled:"), [F("Asked for a business case: a strong one", bc.caseStrength.strong)]);
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
    type Acc = { ck: string; n: number; surfaces: Map<string, number>; answers: Group["answers"] };
    const sides = { you: new Map<string, Acc>(), away: new Map<string, Acc>() };
    const mine = new Map<string, { you: Set<string>; away: Set<string> }>();
    let bearing = 0;
    for (const r of rows) {
      const dr = r.code.decision_rules;
      if (dr == null) continue;
      bearing++;
      const rid = r.code.response_id;
      const seen = new Set<string>();
      for (const rule of dr) {
        const c = rule.condition.trim();
        if (!c) continue;
        const side = ruleSide(rule, r.code.schema, resolve, targetKey);
        const ck = keyOf(c);
        const to = side === "away" ? ruleTo(rule, r.code.schema, resolve, targetKey) : null;
        const card = ruleCard(rule, r.code.schema);
        const ms = mine.get(rid) ?? { you: new Set<string>(), away: new Set<string>() };
        ms[side].add(ck);
        mine.set(rid, ms);
        if (seen.has(`${side}|${ck}`)) {
          // am15: a second rule of the same group in one answer adds only its destination.
          const st = sides[side].get(ck)!.answers.get(rid)!;
          if (to) st.to.add(to);
          if (card && !st.cards.includes(card)) st.cards.push(card);
          continue;
        }
        seen.add(`${side}|${ck}`);
        const acc = sides[side].get(ck) ?? { ck, n: 0, surfaces: new Map(), answers: new Map() };
        acc.n++;
        acc.surfaces.set(c, (acc.surfaces.get(c) ?? 0) + 1);
        acc.answers.set(rid, { said: c, model: r.model, to: new Set(to ? [to] : []), cards: card ? [card] : [], mixed: 0 });
        sides[side].set(ck, acc);
      }
    }
    // am21: 2 = the answer states this condition on the other side too, 1 = it
    // sends buyers the other way under another condition, 0 = one way only.
    for (const side of ["you", "away"] as const)
      for (const [ck, acc] of sides[side])
        for (const [rid, st] of acc.answers) {
          const other = mine.get(rid)?.[side === "you" ? "away" : "you"];
          st.mixed = other?.has(ck) ? 2 : other && other.size > 0 ? 1 : 0;
        }
    const list = (m: Map<string, Acc>): Group[] =>
      [...m.values()]
        .sort((a, b) => b.n - a.n)
        .map((a) => {
          const surf = [...a.surfaces.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || (x[0] < y[0] ? -1 : 1));
          return { ck: a.ck, label: surf[0][0], n: a.n, surfaces: surf.slice(0, 5).map(([s]) => s), answers: a.answers };
        });
    return { toward: list(sides.you), away: list(sides.away), bearing };
  };
  /** am15: a flat condition row's share, receipts and (away) routes. */
  const conditionExtras = (g: Group, bearing: number, away: boolean, evidence: boolean): { share?: string; receipts?: ConditionItem["receipts"]; routes?: ConditionItem["routes"] } => {
    const receipts = evidence ? pickRefs([...g.answers.entries()].map(([id, a]) => ({ id, find: a.said, model: a.model, cards: a.cards, mixed: a.mixed })), g.label) : [];
    const routes = evidence && away ? routeShares([...g.answers.values()].map((a) => [...a.to])) : [];
    return {
      ...(bearing > 0 ? { share: pctOf(g.n / bearing) } : {}),
      ...(receipts.length ? { receipts } : {}),
      ...(routes.length ? { routes } : {}),
    };
  };

  /** am21: the conditions a contest states on both sides at similar rates -
   * the same reason sending some buyers to you and others away. Each side
   * needs BOTH_MIN answers and BOTH_SHARE of the contest and the smaller side at least BOTH_RATIO of the
   * larger; ranked by answers on both sides together. */
  const bothWaysOf = (conds: { toward: Group[]; away: Group[]; bearing: number }): BothWaysItem[] => {
    const away = new Map(conds.away.filter((g) => !isDefaultCondition(g.label)).map((g) => [g.ck, g]));
    // One-way answers first, and never the same answer on both sides.
    const pick = (g: Group, skip: Set<string> = new Set()) =>
      pickRefs([...g.answers.entries()].filter(([id]) => !skip.has(id)).map(([id, a]) => ({ id, find: a.said, model: a.model, cards: a.cards, mixed: a.mixed })), g.label);
    return conds.toward
      .filter((g) => !isDefaultCondition(g.label))
      .flatMap((t) => {
        const a = away.get(t.ck);
        if (!a || Math.min(t.n, a.n) < Math.max(BOTH_MIN, BOTH_SHARE * conds.bearing) || Math.min(t.n, a.n) < BOTH_RATIO * Math.max(t.n, a.n)) return [];
        return [{ t, a }];
      })
      .sort((x, y) => y.t.n + y.a.n - (x.t.n + x.a.n) || x.t.label.localeCompare(y.t.label))
      .slice(0, BOTH_TOP)
      .map(({ t, a }) => {
        const towardRefs = pick(t);
        const awayRefs = pick(a, new Set(towardRefs.map((r) => r.responseId)));
        const routes = routeShares([...a.answers.values()].map((x) => [...x.to]));
        return {
          text: t.n >= a.n ? t.label : a.label,
          towardShare: pctOf(t.n / conds.bearing),
          awayShare: pctOf(a.n / conds.bearing),
          ...(towardRefs.length ? { towardRefs } : {}),
          ...(awayRefs.length ? { awayRefs } : {}),
          ...(routes.length ? { routes } : {}),
        };
      });
  };

  /* -- finish each cell: verdict, badges, position -- */
  const engineLabel = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));
  const bands: MapBand[] = [];
  const positions: Record<string, Position> = {};
  const cellById = new Map<string, MapCell>();
  const walls: WallProbe[] = [];

  const liftsOf = (wins: PoolRow[], others: PoolRow[]): LiftItem[] => {
    const w = wins.filter((r) => r.code.reasons !== null);
    const o = others.filter((r) => r.code.reasons !== null);
    if (w.length < LIFT_MIN || o.length < LIFT_MIN) return [];
    const counts = new Map<string, number>();
    for (const r of [...w, ...o]) for (const c of r.code.reasons!) counts.set(c, (counts.get(c) ?? 0) + 1);
    const total = w.length + o.length;
    return [...counts.entries()]
      .filter(([, k]) => k / total >= LIFT_MIN_INCIDENCE)
      .map(([code]) => {
        const wc = cell(w.filter((r) => r.code.reasons!.includes(code)).length, w.length);
        const oc = cell(o.filter((r) => r.code.reasons!.includes(code)).length, o.length);
        return { label: code, value: Math.round((share(wc.k, wc.n) - share(oc.k, oc.n)) * 100), ...liftShares({ wins: wc, others: oc }) };
      })
      .filter((l) => l.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label))
      .slice(0, LIFT_TOP);
  };
  /** am11: the pooled open-choice cell's arguments come from the SAME
   * summary.reasonLift objects the brief reads (byte-equal shares): its
   * |lift| top-N selection UNION every code the brief cites there - the
   * argument it wins on (reasonLift[0]), the one it loses on (the last) and
   * the most-taught codes it loses on (taught_vs_winning). am12: the answer
   * card draws these entries itself (bars + shares). */
  const pooledOpenLifts = (selected: LiftItem[]): LiftItem[] => {
    const rl = summary.reasonLift;
    const first = rl[0];
    const last = rl[rl.length - 1];
    const taughtTop = new Set(inputs.taught.slice(0, 5).map((t) => t.code));
    const cited = [first.code, last.code, ...rl.filter((l) => taughtTop.has(l.code) && l.lift < 0).map((l) => l.code)];
    const byCode = new Map(rl.map((l) => [l.code, l]));
    const own = new Map(selected.map((x) => [x.label, x]));
    const codes = [...new Set([...selected.map((x) => x.label), ...cited])];
    const items: LiftItem[] = [];
    for (const code of codes) {
      const l = byCode.get(code);
      if (!l) {
        const x = own.get(code);
        if (x) items.push(x);
        continue;
      }
      items.push({
        label: code,
        value: (l.lift < 0 ? -1 : 1) * Math.round(Math.abs(l.lift) * 100),
        ...liftShares(l),
      });
    }
    return items.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label));
  };
  /** am15: one answer per side arguing `code` - the first side's first, then
   * the second side's first on another engine (else any). */
  const liftRefs = (code: string, wins: PoolRow[], others: PoolRow[]): AnswerRef[] => {
    const has = (r: PoolRow) => !!r.code.reasons?.includes(code);
    const a = wins.find(has);
    const b = others.find((r) => has(r) && r !== a && (!a || r.model !== a.model)) ?? others.find((r) => has(r) && r !== a);
    return [a, b].filter((r): r is PoolRow => !!r).map((r) => ({ responseId: r.code.response_id, find: code }));
  };
  /** am20: one brand's funnel inside one contest (the rival panel's lead read). */
  const brandRead = (rows: PoolRow[], key: string, name: string): BrandRead => {
    const namedSurf = (r: PoolRow) => (r.code.mentions ?? []).find((m) => resolve(m.brand).key === key)?.brand;
    const recSurf = (r: PoolRow) => (r.code.mentions ?? []).find((m) => m.framing === "recommended" && resolve(m.brand).key === key)?.brand;
    const picks = (r: PoolRow) => pickOf(r).key === key;
    const named = rows.filter((r) => namedSurf(r) || picks(r));
    const rec = rows.filter((r) => recSurf(r) || picks(r));
    const picked = rows.filter(picks);
    const refs = (xs: PoolRow[], find: (r: PoolRow) => string) => spreadRefs(xs.map((r) => ({ id: r.code.response_id, find: find(r), model: r.model })), RECEIPTS);
    const nC = cell(named.length, rows.length);
    const rC = cell(rec.length, rows.length);
    const pC = cell(picked.length, rows.length);
    const cC = cell(picked.length, rec.length);
    const nr = refs(named, (r) => namedSurf(r) ?? r.code.top_pick ?? name);
    const rr = refs(rec, (r) => recSurf(r) ?? r.code.top_pick ?? name);
    const pr = refs(picked, (r) => quoteOf(r) || r.code.top_pick || name);
    return {
      named: pct(nC),
      recommended: pct(rC),
      picked: pct(pC),
      converts: pct(cC),
      tips: { named: tipC(nC), recommended: tipC(rC), picked: tipC(pC), converts: tipC(cC) },
      refs: { ...(nr.length ? { named: nr } : {}), ...(rr.length ? { recommended: rr } : {}), ...(pr.length ? { picked: pr } : {}) },
    };
  };
  /** am20: a rival inside one contest - its funnel, the arguments when it is
   * picked (beside your picks when you have enough), and the stated conditions
   * on the buyer that send picks to it here. */
  const rivalHere = (rows: PoolRow[], key: string, name: string, itsPicks: PoolRow[], yourPicks: PoolRow[], away: Group[], cellIntents: Set<string>): RivalHere => {
    const out: RivalHere = { read: brandRead(rows, key, name), sends: [] };
    // am22: the same stated conditions in the run's themes - the away pool
    // scoped to this contest's questions, counting only the answers whose
    // rule in the group sends the buyer to this rival. Present (possibly
    // empty) whenever the theme map exists; the flat `sends` stays the fallback.
    if (awayThemeMap) {
      const sendsHere = (gid: string, id: string) => !!rulesShared.answerRules.get(gid)?.get(id)?.to.includes(name);
      out.sendsThemes = themeTreeAnswers(awayPool, awayThemeMap, rulesShared.cellAnswers, sitOf, cellIntents, { rules: rulesShared.answerRules, side: "away", own: project.brand }, sendsHere).slice(0, SENDS_THEME_TOP);
    }
    const compare = liftsOf(itsPicks, yourPicks).map((l) => {
      const refs = liftRefs(l.label, itsPicks, yourPicks);
      return refs.length ? { ...l, receipts: refs } : l;
    });
    if (compare.length) {
      out.argsMode = "compare";
      out.args = compare;
    } else {
      const withR = itsPicks.filter((r) => r.code.reasons !== null);
      if (withR.length >= ARGS_MIN) {
        const counts = new Map<string, number>();
        for (const r of withR) for (const c of new Set(r.code.reasons!)) counts.set(c, (counts.get(c) ?? 0) + 1);
        const argRows = [...counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, ARGS_TOP)
          .map(([label, k]) => ({
            label,
            share: pctOf(k / withR.length),
            receipts: spreadRefs(withR.filter((r) => r.code.reasons!.includes(label)).map((r) => ({ id: r.code.response_id, find: label, model: r.model }))),
          }));
        if (argRows.length) {
          out.argsMode = "alone";
          out.argsRows = argRows;
        }
      }
    }
    // The stated conditions sending picks to it: each away group's answers that route here.
    const routed = new Set<string>();
    const per = away
      .filter((g) => !isDefaultCondition(g.label))
      .map((g) => {
        const hits = [...g.answers.entries()].filter(([, a]) => a.to.has(name));
        for (const [id] of hits) routed.add(id);
        return { g, hits };
      })
      .filter((x) => x.hits.length > 0);
    if (routed.size > 0) {
      out.sends = per
        .sort((a, b) => b.hits.length - a.hits.length || a.g.label.localeCompare(b.g.label))
        .slice(0, COND_TOP)
        .map(({ g, hits }) => {
          const receipts = pickRefs(hits.map(([id, a]) => ({ id, find: a.said, model: a.model, cards: a.cards, mixed: a.mixed })), g.label);
          return {
            text: g.label,
            n: hits.length,
            share: pctOf(hits.length / routed.size),
            ...(isWallWording([g.label], project.brand) ? { wall: true } : {}),
            ...(receipts.length ? { receipts } : {}),
          };
        });
      out.sendsShare = pctOf(routed.size / rows.length);
    }
    return out;
  };
  /** am15: the panel's arguments block when the two-sided lift is absent. */
  const argsBlock = (rows: PoolRow[], lifts: LiftItem[]): { mode?: ArgsMode; rows?: ArgsRow[] } => {
    if (lifts.length) return { mode: "compare" };
    const tally = (base: PoolRow[], of: (r: PoolRow) => string[]): ArgsRow[] => {
      const counts = new Map<string, number>();
      for (const r of base) for (const c of new Set(of(r))) counts.set(c, (counts.get(c) ?? 0) + 1);
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, ARGS_TOP)
        .map(([label, k]) => ({
          label,
          share: pctOf(k / base.length),
          receipts: spreadRefs(base.filter((r) => of(r).includes(label)).map((r) => ({ id: r.code.response_id, find: label, model: r.model }))),
        }));
    };
    const reasons = (r: PoolRow) => r.code.reasons ?? [];
    const rival = rows.filter((r) => r.code.reasons !== null && pickOf(r).status === "active" && pickOf(r).key !== targetKey);
    if (rival.length >= ARGS_MIN) {
      const out = tally(rival, reasons);
      if (out.length) return { mode: "rival", rows: out };
    }
    const withR = rows.filter((r) => r.code.reasons !== null);
    if (withR.length >= ARGS_MIN && withR.some((r) => r.code.reasons!.length > 0)) return { mode: "all", rows: tally(withR, reasons) };
    const withT = rows.filter((r) => r.code.topics !== null);
    if (withR.length === 0 && withT.length >= ARGS_MIN && withT.some((r) => r.code.topics!.length > 0)) return { mode: "topics", rows: tally(withT, (r) => r.code.topics ?? []) };
    return {};
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

  /* -- the reasons' themes (am13, option D): the dossier's own two-level
   * theme pass over the run's rules-explorer groups, per side - same pools,
   * same inputs, so the themeCall keys match and both surfaces read one
   * vocabulary through the dt4 cache. Each position draws its own tree with
   * that cell's questions as the filter. Keyless or non-gpt -> no themes
   * (flat lists); a failed pass -> no themes on either side and the view is
   * served uncached so the next open retries. -- */
  // am22: the pass lives in run_themes.ts (sharedRunThemes) - same pools,
  // same inputs, one memoized pass the map, the Stations, the dossiers, the
  // summary and the head-to-head view all read.
  const runThemes = await sharedRunThemes(data, eng);
  const rulesShared = pre?.rules ?? runThemes.rules;
  const { sitOf, towardPool, awayPool } = runThemes;
  const towardThemeMap: ThemeMap | null = runThemes.toward;
  const awayThemeMap: ThemeMap | null = runThemes.away;
  /** One side's tree scoped to a cell's questions, shares at ANSWER grain
   * (question grain saturates inside a cell: with every engine answering each
   * question, nearly every common reason touches every question). A side with
   * no answer stating any of its reasons in the cell stays undefined. */
  const cellThemes = (pool: RuleGroup[], tm: ThemeMap | null, cellIntents: Set<string>, side: "toward" | "away"): DossierTheme[] | undefined => {
    if (!tm) return undefined;
    const tree = themeTreeAnswers(pool, tm, rulesShared.cellAnswers, sitOf, cellIntents, { rules: rulesShared.answerRules, side, own: project.brand });
    return tree.length ? tree : undefined;
  };

  const ROW_ORDER: Record<BandSlug, string[]> = {
    chooses: ["open", "social", "awareness", "explainer", "value", "premium", "criteria"],
    fights: ["h2h", "leavers"],
    doubts: ["buyers", "customers", "hold", "repertoire"],
    settled: ["settled"],
  };
  const BAND_META: Record<BandSlug, { title: string; sub: string }> = {
    chooses: {
      title: "Where the buyer chooses",
      sub: "One row for each kind of buying question, split by the buying situations you confirmed at setup. The first box in a row counts every buyer together.",
    },
    fights: { title: "The named fights", sub: "Questions that put you next to one rival. The buyer is the same in each, so this shows how you do against each rival." },
    doubts: { title: "The doubts", sub: "One box for each worry you confirmed at setup." },
    settled: { title: "Your customers making your case", sub: "Your own customers asking the AI to make the case for you. Read it as a best case, not as where you stand." },
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
          const isWall = g.n >= WALL_MIN && isWallWording([g.label], project.brand);
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
          ...(s.pooled ? { all: true } : {}),
          n: s.rows.length,
        };
        cells.push(mapCell);
        cellById.set(id, mapCell);
        if (debug?.cells)
          debug.cells[id] = {
            band, row: rowSlug, label: s.label, verdict, lean,
            you: s.you.length, them: s.them.length, d, n: s.rows.length,
            taker: s.taker.name, takerKind: s.taker.kind,
            wall: wallGroups[0]?.label ?? null,
            badges: [...badges],
            pooled: !!s.pooled,
            ...(s.rivalKey ? { rivalKey: s.rivalKey } : {}),
          };

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
            why = `${engineName} supplies ${pctOf(engineWatch.share)} of your side of this cell - a read on one AI assistant would overstate the standing.`;
          } else {
            triage = "earned";
            why = verdict === "yours"
              ? `You hold ${pct(youS)} of the answers that take a side against ${pct(themS)} for ${s.taker.name}, clear of the noise.`
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
            why = `What sends buyers away most here ("${wallGroups[0].label}") is a situation the buyer is already in, not an argument - it can be worked around, not argued down.`;
          } else if (badges.includes("leak")) {
            triage = "strategy_misfit";
            why = `${pctOf(s.leakShare ?? 0)} of the picks here leave the category - the AI answers the buyer's job with something outside it.`;
          } else if (s.criteria) {
            triage = "proof_missing";
            why = s.criteria.winnerUntaught
              ? `${s.criteria.winnerUntaught} comes up more when you win but is missing from what the AI teaches here; it teaches ${s.criteria.taught.slice(0, 3).join(", ")}.`
              : `What the AI teaches here (${s.criteria.taught.slice(0, 3).join(", ")}) includes none of the arguments that come up more when you win.`;
          } else if (conc && conc.agree.n >= MIN_SIDE && rate(conc.agree) >= 0.5 && conc.goAheadOfAgreed.n >= MIN_SIDE && rate(conc.goAheadOfAgreed) >= 0.3) {
            triage = "proof_missing";
            why = `The AI agrees with the worry in ${pct(conc.agree)} and still says go ahead in ${pct(conc.goAheadOfAgreed)} of those - the go-ahead exists, the counter-evidence does not.`;
          } else if (vd.behind >= 3 && vd.ahead === 0) {
            triage = "product_truth";
            why = `The deficit holds on all ${vd.behind} vendors with enough answers to read - consistent enough to read as how the product is, not how it is described.`;
          } else if (median) {
            triage = "strategy_misfit";
            why = `What sends buyers away ("${topAway.label}") comes up more than what brings them to you${topToward ? ` ("${topToward.label}")` : ""} - it describes more of the buyers than yours does.`;
          } else {
            triage = "proof_missing";
            why = `${s.taker.name} takes ${pct(themS)} of the answers that take a side against your ${pct(youS)}, with no fixed situation, no picks leaving the category and no pattern across vendors behind it - the case the AI finds for you is what is missing.`;
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
            why = `${engineName} supplies ${pctOf(engineWatch.share)} of your side of this cell - read it assistant by assistant before acting.`;
          } else {
            triage = "earned";
            why = `The answers that take a side split ${pct(youS)} to ${pct(themS)} - a live contest, not a loss.`;
          }
        }

        // am15: the plain-wording pass (the owner's approved map) - move names
        // and lever sentences in the buyer's register, no method terms.
        const LEVER: Record<Triage, [string, string]> = {
          record_wrong: ["The facts the AI states here are out of date. Correct them in the sources the AI draws on.", "Fix the record"],
          proof_missing: [
            s.criteria
              ? "When the AI teaches buyers what to look for, your strongest point is missing. Get it into the guides and explainers the AI draws on."
              : s.conceded
                ? "The AI tells buyers to go ahead without answering the worry. Publish the evidence that answers it where the AI looks for it."
                : "The answers here make the rival's case and not yours. Publish the evidence for your side where the AI looks for it.",
            "Publish your case",
          ],
          strategy_misfit: [
            wallGroups.length
              ? "Don't spend on arguing against this. Aim at the buyers it does not apply to."
              : badges.includes("leak")
                ? "Either cover everything this buyer needs, or decide to leave this buyer to others. Make that call before producing content."
                : "Either build a case that works for the typical buyer with no conditions attached, or accept being the specialist. What sends buyers away describes more buyers than what brings them to you.",
            "Choose where to compete",
          ],
          product_truth: ["Before writing anything, check whether the AI is right: compare what it says with your own data. If it is right, the fix is the product, not the content.", "Check the facts first"],
          earned: ["You hold this. Keep the proof behind it current and easy for the AI to find.", "Keep it"],
          overclaimed: ["Treat this number as the best case, not your standing. Build the proof where buyers ask without being prompted.", "Back it up"],
          windfall: ["Find out how much of this demand moves to your own cheaper option and how much leaves altogether.", "Size the trade-down"],
        };
        const [lever, family] = LEVER[triage];

        const cellIntents = new Set(s.rows.map((r) => r.intent.id));
        const towardThemes = cellThemes(towardPool, towardThemeMap, cellIntents, "toward");
        const awayThemes = cellThemes(awayPool, awayThemeMap, cellIntents, "away");
        // am15: the flat rows carry their share always; receipts and routes only
        // on a side the themes do not cover (the panel draws themes when they exist).
        const toward: ConditionItem[] = conds.toward.slice(0, COND_TOP).map((g) => ({ text: g.label, n: g.n, ...conditionExtras(g, conds.bearing, false, !towardThemes) }));
        let away: ConditionItem[] = conds.away.slice(0, COND_TOP).map((g) => ({ text: g.label, n: g.n, ...(wallGroups.includes(g) ? { wall: true } : {}), ...conditionExtras(g, conds.bearing, true, !awayThemes) }));
        const bothWays = bothWaysOf(conds);
        if (conds.bearing < 5 && away.length === 0 && s.exitFallback?.length) away = s.exitFallback.map((x) => ({ text: `Sent to ${x.name}`, n: x.n }));

        const numerator = verdict === "yours" ? s.you : verdict === "theirs" ? s.them : verdict === "contested" ? [...s.you, ...s.them] : s.rows;
        let lifts = s.lifts ?? (s.lift ? liftsOf(s.lift.wins, s.lift.others) : []);
        if (id === "chooses:open:all" && summary.reasonLift.length) lifts = pooledOpenLifts(lifts);
        // am15: each argument row carries one answer from each side arguing it.
        lifts = lifts.map((l, i) => {
          if (i >= REF_ROWS) return l;
          const refs = liftRefs(codeOfLift(l.label), s.lift?.wins ?? s.rows, s.lift?.others ?? s.rows);
          return refs.length ? { ...l, receipts: refs } : l;
        });
        const args = argsBlock(s.rows, lifts);
        // am15: who takes the picks, on the pick contests (the figure's own split).
        let brands: PositionBrand[] | undefined;
        let youShare: string | undefined;
        let youRead: BrandRead | undefined;
        if (PICK_ROWS.has(rowSlug)) {
          const split = brandSplit(s.rows);
          const clear = split.list.filter((b) => b.rows.length >= BRAND_FLOOR);
          if (clear.length >= 2) {
            const youRows = split.list.find((b) => b.key === targetKey)?.rows ?? [];
            brands = clear
              .filter((b) => b.key !== targetKey)
              .slice(0, BRANDS_TOP)
              .map((b) => ({
                name: b.name,
                share: pct(cell(b.rows.length, split.n)),
                proof: receiptsOf(b.rows.filter((r) => quoteOf(r))).slice(0, BRAND_PROOF),
                here: rivalHere(s.rows, b.key, b.name, b.rows, youRows, conds.away, cellIntents),
              }));
            youShare = pct(cell(youRows.length, split.n));
            youRead = brandRead(s.rows, targetKey!, brand);
          }
        }
        const notes: PositionNotes = {
          ...(wallGroups[0] ? { wall: wallGroups[0].label } : {}),
          ...(badges.includes("inhouse") ? { inHouse: true as const } : {}),
          ...(badges.includes("leak") ? { leak: true as const } : {}),
          ...(engineWatch ? { soft: "one_assistant" as const } : s.settledWatch ? { soft: "asked_for" as const } : {}),
        };
        const liftNote = s.liftNote ?? (lifts.length && s.lift ? s.lift.note : undefined);
        const where = `${s.rowLabel}${s.label ? ` · ${s.label}` : " · every buyer"}`;
        const taker = verdict === "yours" ? { name: "Nobody", kind: TAKER.nobody } : s.taker;
        // The sides in the cell's own unit (the brief's "today" sentences read these).
        const sideFigs: Figure[] = sidesFigures(rowSlug, s.you.length, s.them.length, d, s.rows.length, s.taker.name, rowSlug === "h2h" && s.key === "all");
        const figures = dedupeFigures([...sideFigs, ...(s.figures ?? [])]);
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
          ...(lifts.length ? { liftSides: s.lift?.sides ?? (["your picks", "rivals' picks"] as [string, string]) } : {}),
          toward,
          away,
          ...(bothWays.length ? { bothWays } : {}),
          ...(towardThemes ? { towardThemes } : {}),
          ...(awayThemes ? { awayThemes } : {}),
          receipts: receiptsOf(numerator.length ? numerator : s.rows),
          lever,
          family,
          ...(figures.length ? { figures } : {}),
          ...(brands && brands.length ? { brands, youShare, ...(youRead ? { youRead } : {}) } : {}),
          ...(args.mode ? { argsMode: args.mode } : {}),
          ...(args.rows ? { argsRows: args.rows } : {}),
          ...(Object.keys(notes).length ? { notes } : {}),
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
  // am19: every board row and headline number opens its answers (the same
  // pool, resolver and predicate as the summary's numbers).
  const ex = inputs.ex;
  const refsOf = (refs: AnswerRef[] | undefined) => (refs && refs.length ? { refs } : {});
  const shareOfDecided: AnalysisMapView["shareOfDecided"] = [
    ...[
      ...shown.map((b) => ({ brand: b.name, you: false, share: b.shareOfDecided, ...refsOf(ex?.picks(b.key)) })),
      { brand, you: true, share: t.shareOfDecided, ...refsOf(ex?.picks(t.key)) },
    ].sort((a, b) => b.share.k - a.share.k || a.brand.localeCompare(b.brand)),
    ...(decided > 0 && rest / decided >= 0.05
      ? [{ brand: "Others", you: false, share: cell(rest, decided), ...refsOf(ex?.picks(others.slice(3).map((b) => b.key))) }]
      : []),
  ];
  const examples = ex ? { named: ex.named(t.key), commits: ex.picks(null) } : undefined;

  /* -- tensions -- */
  const probe = debug ? { insights: debug.probeInsights ?? summary.insights, out: [] as NonNullable<AnalysisMapDebug["placements"]> } : undefined;
  const placed: { key: string; title: string; cellId: string }[] = [];
  const tensions = tensionsOf(summary, facts, specs, cellById, brand, probe, placed, ex);
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

  return {
    casting,
    dots: { named: t.mentioned, picked: t.chosen },
    ...(examples ? { examples } : {}),
    shareOfDecided,
    tensions,
    bands,
    positions,
    uncoded,
    insightCells: placed,
  };
}

/* ------------------------------ rule pools ------------------------------ */

// RulesShared / rulesForThemes / sharedRules moved to run_themes.ts
// (2026-11-12, the reasons harmonization); re-exported for their importers.
export { rulesForThemes, sharedRules, type RulesShared };

export interface SharedAnalysisMap {
  view: AnalysisMapView;
  /** Always collected: every cell's side counts, and the placements of the
   * summary's full ranked list (probeInsights = `ranked`), as the brief reads them. */
  debug: AnalysisMapDebug & { cells: Record<string, MapCellStat> };
  rules: RulesShared;
  /** rankedInsights(summary, inputs) - the list `debug.placements` follows, index for index. */
  ranked: Insight[];
}

const mapMemo = computeMemo<SharedAnalysisMap>("analysis_map");

/** The analysis map once per load epoch and engine set (view_data
 * computeMemo), built on the shared summary and the shared rules; the map
 * route, the dossiers and the brief all read it. READ-ONLY. */
export function sharedAnalysisMap(data: ViewData, eng: ViewRequest): Promise<SharedAnalysisMap> {
  const e: ViewRequest = eng.engines ? { engines: eng.engines } : {};
  return mapMemo.get(data, e, async (d) => {
    const { view: summary, inputs } = await sharedBrandSummary(d, e);
    const rules = await sharedRules(d, e);
    const ranked = rankedInsights(summary, inputs);
    const debug = { walls: [], casting: {}, cells: {}, probeInsights: ranked } as unknown as SharedAnalysisMap["debug"];
    const view = await computeAnalysisMap(d, e, debug, { summary, inputs, rules });
    return { view, debug, rules, ranked };
  });
}

/* ------------------------------- receipts ------------------------------- */

/** am15: the rows whose contest is a pick between brands (Position.brands). */
const PICK_ROWS = new Set(["open", "social", "premium", "leavers"]);
/** A criteria lift's code, without the "(taught x%)" / "(untaught)" label suffix. */
const codeOfLift = (label: string) => label.replace(/ \((?:taught [^)]*|untaught)\)$/, "");

const quoteOf = (r: PoolRow) => (r.code.quote ?? r.code.premise_quote ?? "").trim();

/** Up to RECEIPTS answers as receipts: quoted rows first, spread across
 * engines (one per engine first, in order). Shared with the dossiers' pick
 * receipts (option D). */
export function receiptsOf(rows: PoolRow[]): PositionReceipt[] {
  const withQ = rows.filter((r) => quoteOf(r));
  const pickFrom = [...withQ, ...rows.filter((r) => !quoteOf(r))];
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
}

/* ------------------------------- figures ------------------------------- */

/** A cell's two sides in its own unit - the same arithmetic the brief's
 * "today" sentence uses (brief.ts todayOf), so the numbers match exactly. */
function sidesFigures(row: string, you: number, them: number, d: number, n: number, taker: string, pooledRivals = false): Figure[] {
  const youD = pctOf(d > 0 ? you / d : 0);
  const themD = pctOf(d > 0 ? them / d : 0);
  const youN = pctOf(n > 0 ? you / n : 0);
  // The pooled head-to-head cell's `them` spans every named rival's wins, so
  // that side is labeled by the pool, never by the toughest rival.
  const themLabel = pooledRivals ? "The named rivals' share of the picks here" : `${taker}'s share of the picks here`;
  const tip = `${you} on your side, ${them} on ${pooledRivals ? "the named rivals'" : `${taker}'s`}, of ${d} that take a side; ${n} answers`;
  switch (row) {
    case "open":
    case "social":
    case "premium":
    case "leavers":
    case "h2h":
      return [
        { label: "Your share of the picks here", value: youD, tip },
        { label: themLabel, value: themD, tip },
      ];
    case "value":
      return [{ label: "Answers calling it worth it", value: youN, tip }];
    case "buyers":
      return [{ label: "Told to go ahead", value: youN, tip }];
    case "customers":
    case "hold":
      return [{ label: "Told to stay", value: youN, tip }];
    case "awareness":
    case "explainer":
      return [{ label: "Answers recommending you", value: youN, tip }];
    case "criteria":
      return [{ label: "Answers teaching an argument that wins for you", value: youN, tip }];
    case "repertoire":
      return [{ label: "Told to stick with you", value: youN, tip }];
    case "settled":
      return [{ label: "Strengthens the relationship", value: youN, tip }];
    default:
      return [{ label: "Your side", value: youD, tip }];
  }
}

/** One line per label + value. */
function dedupeFigures(xs: Figure[]): Figure[] {
  const seen = new Set<string>();
  return xs.filter((f) => {
    const k = `${f.label}\u0000${f.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Share of answers arguing each code when `key` is picked vs when another
 * in-category brand is, over the headline pool (brand_summary's lift, for any
 * brand) - shared with the brief so a rival's argument numbers match. */
export function liftForBrand(data: ViewData, request: ViewRequest, key: string): { code: string; wins: RateCell; others: RateCell; lift: number }[] {
  const resolve = buildResolver(data.dictionary, data.judged);
  const rows = poolOf(data, "headline", request).rows;
  const facts = rows.map(({ code }) => {
    let pick: string | null = null;
    if (code.outcome === "pick" && code.top_pick) {
      const r = resolve(code.top_pick);
      if (r.status === "active") pick = r.key;
    }
    return { pick, reasons: code.reasons };
  });
  const wins = facts.filter((f) => f.pick === key && f.reasons !== null);
  const others = facts.filter((f) => f.pick !== null && f.pick !== key && f.reasons !== null);
  if (wins.length < MIN_SIDE || others.length < MIN_SIDE) return [];
  const withR = facts.filter((f) => f.reasons !== null);
  const counts = new Map<string, number>();
  for (const f of withR) for (const r of f.reasons!) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, k]) => k / withR.length >= 0.02)
    .map(([code]) => {
      const w = cell(wins.filter((f) => f.reasons!.includes(code)).length, wins.length);
      const o = cell(others.filter((f) => f.reasons!.includes(code)).length, others.length);
      return { code, wins: w, others: o, lift: rate(w) - rate(o) };
    })
    .sort((a, b) => b.lift - a.lift);
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
  const you = pctOf(f.shareYou);
  const top = pctOf(f.shareTop);
  const prompted = f.prompted !== null ? pctOf(f.prompted) : null;
  const beside = pctOf(f.beside);
  switch (archetype) {
    case "default":
      return {
        archetype,
        heading: HEADING.default,
        casting: `The AI treats ${brand} as the default answer - the brand it lands on when buyers ask what to buy and nothing pulls it elsewhere.`,
        detail: `Named in ${named} of answers when buyers ask what to buy, and the pick ${you} of the time the AI commits to one${f.topName ? `; ${f.topName} is next at ${top}` : ""}.`,
      };
    case "challenger":
      return {
        archetype,
        heading: HEADING.challenger,
        casting: `The AI rates ${brand} the better choice in direct comparisons - and still hands the pick to ${f.topName} when buyers ask what to buy.`,
        detail: `Picked in ${prompted} of direct matchups, against ${you} of the picks when buyers ask what to buy; ${f.topName} takes ${top}.`,
      };
    case "companion":
      return {
        archetype,
        heading: HEADING.companion,
        casting: `The AI recommends ${brand} beside the pick, rarely as the pick.`,
        detail: `Recommended in ${beside} of the answers that pick another brand, yet the pick only ${you} of the time - ${f.topName} takes ${top}${prompted ? `; compared with a rival directly, it wins ${prompted} of matchups` : ""}.`,
      };
    case "reference":
      return {
        archetype,
        heading: HEADING.reference,
        casting: `The AI explains the category through ${brand} - the most-named brand, not its recommendation.`,
        detail: `Named in ${named} of answers when buyers ask what to buy, more than any rival, yet the pick only ${you} of the time${prompted ? `; it wins ${prompted} of direct matchups` : ""}.`,
      };
    case "specialist":
      return {
        archetype,
        heading: HEADING.specialist,
        casting: `The AI treats ${brand} as the right choice for a specific buyer, never the default.`,
        detail: `Named in ${named} of answers when buyers ask what to buy, but the pick only ${you} of the time, against ${top} for ${f.topName}${prompted ? `; it wins ${prompted} of direct matchups` : ""}.`,
      };
  }
}

/* ------------------------------- tensions ------------------------------- */

/** am19: a bar with its example answers, when any. */
const withExamples = <B extends object>(b: B, refs: AnswerRef[] | undefined): B => (refs && refs.length ? { ...b, refs } : b);

function tensionsOf(
  s: BrandSummaryView,
  f: CastingFacts,
  specs: CellSpec[],
  cells: Map<string, MapCell>,
  brand: string,
  probe?: { insights: Insight[]; out: { key: string; kind: string; cellId: string | null; how: string }[] },
  placed?: { key: string; title: string; cellId: string }[],
  ex?: ExampleIndex
): AnalysisMapView["tensions"] {
  const ids = [...cells.keys()];
  const firstOf = (prefix: string) => ids.find((id) => id.startsWith(prefix)) ?? null;
  // Pooled All cells never match by label (an "All buyers" label would catch
  // stray prose); they serve as generic fallbacks through firstOf, where the
  // row's first cell is now its All cell.
  const splitCells = specs.filter((x) => !x.pooled);
  const openCells = splitCells.filter((x) => x.band === "chooses" && x.row === "open");
  const idOf = (x: CellSpec) => `${x.band}:${x.row}:${x.key}`;
  // Known vs picked points at the open-choice room with the widest named-vs-picked gap.
  const fallbackOpen = firstOf("chooses:open:") ?? firstOf("chooses:social:") ?? ids[0] ?? "";
  const containsName = (text: string, name: string) => name.length > 0 && text.toLowerCase().includes(name.toLowerCase());
  const longestMatch = (text: string, list: CellSpec[], nameOf: (x: CellSpec) => string) =>
    [...list].filter((x) => containsName(text, nameOf(x))).sort((a, b) => nameOf(b).length - nameOf(a).length)[0] ?? null;

  const out: AnalysisMapView["tensions"] = [];
  out.push({
    title: `Named in ${pctOf(f.named)}, picked in ${pctFine(f.picked)}`,
    body: `${brand} is named in ${pctOf(f.named)} of answers when buyers ask what to buy. ${commitSentence(s.category, brand, s.firmPickInCategory, s.target.shareOfDecided, s.target.chosen)}${
      f.topName && !f.youTop ? ` ${f.topName} is the pick ${pctOf(f.shareTop)} of the time.` : ""
    }`,
    // The pooled funnel paragraph anchors on the open-choice All cell itself.
    cellId: cells.has("chooses:open:all") ? "chooses:open:all" : openCells.length ? idOf(openCells[0]) : fallbackOpen,
    viz: [
      withExamples(insightBar("Named", f.named, pctOf(f.named)), ex?.named(s.target.key)),
      withExamples(insightBar("Recommended", s.target.recommended), ex?.recommended(s.target.key)),
      withExamples(insightBar("Picked", f.picked, pctFine(f.picked), true), ex?.picks(s.target.key)),
    ],
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
          const fight = longestMatch(text, splitCells.filter((x) => x.row === "h2h" || x.row === "leavers"), (x) => x.label);
          const taken = fight ?? longestMatch(text, openCells, (x) => x.taker.name);
          return found(taken ? idOf(taken) : null, strict, () => firstOf("fights:h2h:") ?? fallbackOpen);
        }
        const h2h = splitCells.filter((x) => x.row === "h2h");
        const hit = longestMatch(text, h2h, (x) => x.label);
        return hit ? idOf(hit) : strict ? null : firstOf("fights:h2h:") ?? fallbackOpen;
      }
      case "doubt": {
        if (key === "worst_worry" || key === "leave_no_exit") {
          const cust = splitCells.filter((x) => x.band === "doubts" && x.row === "customers");
          // The named worry; for no-exit leaves, the worry with the most leave answers.
          const hit =
            key === "worst_worry"
              ? longestMatch(text, cust, (x) => x.label)
              : [...cust].sort((a, b) => b.them.length - a.them.length || idOf(a).localeCompare(idOf(b)))[0] ?? null;
          return found(hit ? idOf(hit) : null, strict, () => firstOf("doubts:customers:") ?? firstOf("doubts:"));
        }
        if (key === "advocacy_vs_objection") return firstOf("settled:settled:advocacy") ?? firstOf("doubts:buyers:");
        const worries = splitCells.filter((x) => x.band === "doubts" && (x.row === "buyers" || x.row === "customers"));
        const hit = longestMatch(text, worries, (x) => x.label);
        if (hit) return idOf(hit);
        if (strict) return null;
        return firstOf(text.toLowerCase().includes("customer") && !text.toLowerCase().includes("buyer") ? "doubts:customers:" : "doubts:buyers:") ?? firstOf("doubts:");
      }
      case "value": {
        const vals = splitCells.filter((x) => x.row === "value");
        const hit = longestMatch(text, vals, (x) => x.label.split(" - ")[0]);
        return hit ? idOf(hit) : strict ? null : firstOf("chooses:value:");
      }
      case "argument":
        if (key === "neutralized_differentiator") {
          // The rival that takes most of the losses, named in the body.
          const hit = longestMatch(text, splitCells.filter((x) => x.row === "h2h"), (x) => x.label);
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
        const leavers = splitCells.filter((x) => x.row === "leavers");
        const hit = longestMatch(text, leavers, (x) => x.label);
        return hit ? idOf(hit) : strict ? null : firstOf("fights:leavers:") ?? fallbackOpen;
      }
      case "condition": {
        // The away condition names where it routes; the rival's head-to-head
        // carries its conditions. Else a wall-badged cell, else the open choice.
        const h2h = splitCells.filter((x) => x.row === "h2h");
        const hit = longestMatch(text, h2h, (x) => x.label);
        if (hit) return idOf(hit);
        const walled = ids.find((id) => cells.get(id)!.badges.includes("wall"));
        return walled ?? (strict ? null : fallbackOpen);
      }
      case "leak": {
        if (key === "leak_problem") {
          // The room's problem-recognition cell.
          const hit = longestMatch(text, splitCells.filter((x) => x.row === "awareness"), (x) => x.label);
          return found(hit ? idOf(hit) : null, strict, () => leakCells()[0] ?? firstOf("chooses:awareness:") ?? fallbackOpen);
        }
        // Out-of-category picks: a leak-badged cell, the named room's first.
        const leaky = new Set(leakCells());
        const named = longestMatch(text, splitCells.filter((x) => leaky.has(idOf(x))), (x) => x.label);
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
    out.push({ title: ins.title.charAt(0).toUpperCase() + ins.title.slice(1), body: ins.body, cellId, ...(ins.viz ? { viz: ins.viz } : {}) });
  }
  if (probe)
    for (const ins of probe.insights) {
      how = "other";
      const cellId = cellFor(ins.kind, ins.key, ins.title, ins.body);
      probe.out.push({ key: ins.key, kind: ins.kind, cellId, how });
    }
  if (placed)
    for (const ins of s.insights) {
      const cellId = cellFor(ins.kind, ins.key, ins.title, ins.body);
      if (cellId && cells.has(cellId)) placed.push({ key: ins.key, title: ins.title, cellId });
    }
  return out;
}

/* -------------------------------- cache -------------------------------- */

// am1 (2026-11-03): first version.
// am2 (2026-11-04): the summary's bs8 detectors reach the tensions (new kind "leak"; key-specific placement for the bs8 keys).
// am3 (2026-11-04): the tensions read the bs9 quota-served list (one per kind, wider composition).
// am4 (2026-11-04): reads the bs10 served list (rank-fill effect floor).
// am5 (2026-11-04): the brief's language pass - reads bs11, and the casting, tensions, cell notes and position claims say share of picks / direct matchups / buying situations instead of method terms; the first tension carries the commit-rate convention.
// am6 (2026-11-05): the Overall band - the pooled open-choice cell (the Verdict's base; its position mounts the full decision-rules ledger in the UI) and the pooled rival-leavers cell, which moves here from the fights band's single-angle wide form; the first tension anchors on the pooled cell.
// am7 (2026-11-05): the Overall band folds into first-of-row All cells - every row with 2+ cells opens with its pooled roll-up (open choice = the headline pool whole, still the ledger's home at chooses:open:all; new pooled cells for head-to-head, rival leavers, both worry rows, value, awareness, criteria and the settled band); base-voiced awareness/criteria cells re-key "general" beside siblings; pooled cells are marked (MapCell.all / MapCellStat.pooled) and never match tension text by label.
// am8 (2026-11-06): the payload carries insightCells - every served insight placed on its cell - so the brief's facts can link into the map.
// am9 (2026-11-06): the citation ruling - positions carry `figures` ("The numbers": every figure a brief cites, stated on the cell whose pool it reads; the open-choice All cell states the whole brand table, the conditions, the assistants and the arguments; the doubt, leaver, hold, value, criteria, awareness and settled cells restate their views' numbers); the head-to-head All cell pools ENTITY rivals only (MECE - class matchups are stated beside it in the figures, never summed into it); leaver cells read a recommended rate.
// am10 (2026-11-07): the answer cards - the pooled open-choice panel slims back to its own question (the target's funnel, its arguments, the picks leaving the category); every other brand's funnel line, the stage, room and question splits, every brand's lift, the vendor-supply lines, the assistants (company, assistant, mode) and the conditions moved to the brief's answer cards (answer_cards.ts). Every other cell's figures are unchanged.
// am11 (2026-11-07): the open-choice panel's arguments render once - the target's lift rows leave the pooled cell's "The numbers" and its arguments section carries them (every code the brief cites there, from the same summary.reasonLift objects), each lift row now carries its two shares for a sub-line (every cell), and the open-choice card restates the lift lines from Position.lifts.
// am12 (2026-11-07): the LiftItem.card text lines are gone - the brief's cell answer card now draws the position's lifts as the panel does (bars + share sub-lines). The pooled open-choice cell's lift selection (top N UNION the cited codes) and every lift's wins/others/tip are unchanged.
// am13 (2026-11-09): option D - positions carry towardThemes / awayThemes (additive): the dossier's per-side two-level theme trees scoped to each cell's questions, with answer-grain shares (distinct answers in the cell); themes ride the dossier's dt4 cache (identical theme-call inputs, one vocabulary). Flat toward/away, walls, badges, levers and verdicts unchanged.
// am14 (2026-11-09): the naming sweep - the triage whys, the strategy-misfit lever and the chooses band sub say "reasons" (to pick you / to leave you), the word every visible surface uses since the reasons rename; "conditions" survives only in analyst tools.
// am15 (2026-11-10): the one-panel redesign - positions carry brands / youShare (the pick split of pick contests, the figure's own numbers), argsMode / argsRows, lift and condition receipts (AnswerRef), condition shares and away routes, notes (the badges' meaning), and theme receipts / routes; the plain-wording pass renames the moves (Keep it, Publish your case, ...) and rewrites every lever, the triage whys, the criteria claims, the band sub and the "Rivals' customers switching" row. Verdicts, badges and numbers unchanged.
// am16 (2026-11-10): the tightened wall test - the wall sentence now advises, so it reads the shown wording only.
// am17 (2026-11-10): each tension carries `viz` (the Overview finding card's 2-4 bars).
// am18 (2026-11-10): each buying situation's open-choice cell states the same funnel figures as the all-buyers cell.
// am22 (2026-11-12): the reasons harmonization - each rival's `here` carries `sendsThemes` (the run's dt4 themes, scoped to the contest and to answers sending the buyer to that rival); the theme pass moves to run_themes.ts (same inputs, same dt4 keys); reads bs17 (the away-condition sentence names its theme). Row names come from question_names.ts (the plain-wording pass: What to buy, What's popular, Spotting the problem, What to look for, Habit, Your customers looking around, Your customers making your case) and the band descriptions are rewritten.
export const ANALYSIS_MAP_VERSION = "am22"; // am21 (2026-11-12): reason-row examples prefer answers that send the buyer one way only, then the wording closest to the row name, and each carries `to` (the product it sends the buyer to). // am20 (2026-11-12): each rival in a pick contest's `brands` carries `here` (its funnel in that contest, the arguments when it is picked beside your picks, the stated conditions sending picks to it) and the position carries `youRead` - the rival panel's lead read. Additive; theme inputs unchanged. // am19 am19 (2026-11-11): every Overview number opens its answers - `examples` (named, commits), refs on each share-of-picks row and on the tension bars (the first tension's funnel bars and the bs16 insight bars). // am18 (2026-11-10): each buying situation's open-choice cell states the same funnel figures as the all-buyers cell (named, recommended, commits, picked, outside the category), from its own answers. // // am17 (2026-11-10): each tension carries `viz` (the Overview finding card's 2-4 bars) - the first from the casting facts, the rest from the bs15 insights
// The fold (2026-11-09, Tyler): a view's cache key carries the versions of
// the views whose content it embeds, so the lockstep bump convention is
// mechanical - the map embeds the summary's insights, casting and verdict.
// Still manual (embedded content with no key ride): the rules explorer's
// grouping code and the per-type computes the summary's detectors read.
const MAP_KEY_VERSION = `${ANALYSIS_MAP_VERSION}.${BRAND_SUMMARY_VERSION}`;
export function computeAnalysisMapCached(run: Run, project: Project, request: ViewRequest = {}): Promise<AnalysisMapView | null> {
  const r = requestOf(request, false);
  return cachedView("analysis_map", MAP_KEY_VERSION, run, project, async (d) => (await sharedAnalysisMap(d, r)).view, { setupDecision: true, judge: true }, r);
}
