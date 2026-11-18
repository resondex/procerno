import { famTokens } from "./brand_family";
import type { DossierTheme } from "./reason_themes";
import { rulesForThemes, sharedRules, type RulesShared } from "./run_themes";
import { isWallWording } from "./wall_wording";
import { EXC_MIN_LOST, EXC_MIN_SHARE, EXC_ROWS } from "./assigned_exception";
import { ROW_NAME } from "./question_names";
import { findingMove, type MoveNames } from "./finding_moves";
import { commitSentence, insightBar, insightInputs, productNoun, rankedInsights, type InsightInputs } from "./summary_insights";
import { BRAND_SUMMARY_VERSION, computeBrandSummary, sharedBrandSummary, type BrandSummaryView, type Insight, type ReasonLift } from "./brand_summary";
import { buildPanels, buildRivalAcross, knOf, type PanelCellInput } from "./panel_build";
import type { QuestionType } from "./facts/answer_facts";
import type { Scope } from "./facts/fact";
import type { SelMember } from "./facts/selections";
import { MAP_FLOORS } from "./facts/measure_book";
import { extremeWords, fc, finish, isFactCell, parseFactId, pd, pfine, pw, stripDeep, type FactCell, type StmtNums } from "./facts/statements";
import { cardCondRows, refsFor, sharedRunFacts, type RunFacts } from "./facts/overview_facts";
import { scopeSentences, wordingIndex } from "./panel_filter";
import { pluralNoun } from "./panel_text";
import { questionLabels, type LabelAsk } from "./question_labels";
import { ENGINES, engineDisplayLabel } from "./providers";
import { viewsOf } from "./views";
import { cachedView, cell, computeMemo, coreOf, facetsOf, requestOf, type PoolRow, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import {
  type PanelCondition,
  type PositionPanel,
  type AnalysisMapView,
  type AnswerRef,
  type CellPanelPayload,
  type RivalAcross,
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
  type PanelKind,
  type Position,
  type PositionBrand,
  type PositionException,
  type PositionNotes,
  type PositionReceipt,
  type PositionStatus,
  type Triage,
} from "./analysis_types";
import type { Project, Run } from "../types";

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

const MIN_SIDE = MAP_FLOORS.minSide;
const MATERIAL = MAP_FLOORS.material;
const LEAK_SHARE = MAP_FLOORS.leakShare;
const INHOUSE_SHARE = MAP_FLOORS.inhouseShare;
const WATCH_ENGINE_SHARE = MAP_FLOORS.watchEngineShare;
const WATCH_ENGINE_MIN = MAP_FLOORS.watchEngineMin;
const LIFT_MIN = MAP_FLOORS.liftMin;
const LIFT_MIN_INCIDENCE = MAP_FLOORS.liftMinIncidence;
const LIFT_TOP = MAP_FLOORS.liftTop;
const COND_TOP = 6;
/** Both-sides rows shown per cell (the card's rows stated on the other side too). */
const BOTH_TOP = 3;
/** am24: both-ways rows are drawn only where the two sides are different products (a pick between brands). */
const BOTH_ROWS = new Set(["open", "social", "premium", "leavers", "h2h"]);
/** am22: the most themes a rival's per-contest `sendsThemes` carries (the panel draws 3, its fold 8). */
const SENDS_THEME_TOP = 8;
export const RECEIPTS = 5;
const WALL_MIN = MAP_FLOORS.wallMin;
const DEFAULT_MARGIN = MAP_FLOORS.defaultMargin;
const BRAND_FLOOR = MAP_FLOORS.brandFloor;
const BRANDS_TOP = MAP_FLOORS.brandsTop;
const BRAND_PROOF = 3;
const ARGS_MIN = MAP_FLOORS.argsMin;
const ARGS_TOP = MAP_FLOORS.argsTop;
const EXIT_MIN = MAP_FLOORS.exitMin;
const EXIT_SHARE = MAP_FLOORS.exitShare;
const REDIRECT_SHARE = MAP_FLOORS.redirectShare;
const ROOM_LIFT_MIN = MAP_FLOORS.roomLiftMin;

/* ----------------------------- small helpers ---------------------------- */

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pctOf = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const pct = (c: RateCell) => pctOf(rate(c));
const norm = (s: string) => s.trim().toLowerCase();
const tipC = (c: RateCell) => `${c.k} of ${c.n}`;
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
  /** Head-to-head cells: the rival's dictionary key; rival-leaver cells: the brand being left. */
  rivalKey?: string;
  leftKey?: string | null;
  /** The cell's scope on the fact layer - the same scope its card counts in. */
  scope: Scope;
  rows: PoolRow[];
  /** The two sides as facts over the side-taking base (you.n === them.n): the verdict reads classify(you.k, them.k,
   * you.n). The slices name each side's answers (examples, the assistant watch, the vendor pattern). */
  you: FactCell;
  them: FactCell;
  youSlice: string;
  themSlice: string;
  /** The brand side as a share of every answer in the cell (the side figure of the verdict cells). */
  youAll?: FactCell;
  taker: Taker;
  note: (v: CellVerdict) => string;
  claim: (v: CellVerdict) => string;
  /** The two lift slices (the arguments of the brand side against the taker side). */
  lift?: { wins: string; others: string; note: string; sides?: [string, string] };
  lifts?: LiftItem[];
  liftNote?: string;
  /** Picks outside the category, of every pick. */
  leak?: FactCell;
  /** Value: of the price answers that point somewhere, only the brand's own cheaper option. */
  inhouse?: FactCell;
  line?: string | null;
  conceded?: { agree: FactCell; goAheadOfAgreed: FactCell };
  verdictOverride?: { verdict: CellVerdict; lean: number };
  criteria?: { winnerTaught: string | null; winnerUntaught: string | null; taught: string[] };
  settledWatch?: boolean;
  exitFallback?: { name: string; n: number }[];
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

/* ------------------------------- the compute ------------------------------ */

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
  /** The facts the casting prints (statements). */
  cells?: { named: FactCell; shareYou: FactCell; shareTop?: FactCell; prompted?: FactCell; beside: FactCell };
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
  /** bf29, the brief's By buying situation view: one buyer's own lift (the criteria cell's roomLift, for any
   * subject; [] below 10 picks a side, null without the buyer's answers) and one side's argued codes. */
  roomLift?: (room: string, subjectKey?: string) => { code: string; wins: RateCell; others: RateCell; lift: number }[] | null;
  roomCodes?: (room: string, brandKey: string) => { n: number; codes: { code: string; rate: RateCell }[] };
  /** The brief: the summary the map computed (so the brief never pays for a second one). */
  summary?: BrandSummaryView;
  /** am31, harness only: the codes ruling 5 left out of a panel's lists. */
  panelOmissions?: { cellId: string; list: "weighs" | "topics" | "checklist" | "case"; code: string; share: number; hit: string; via: "name" | "scope" }[];
  /** The panel builder's inputs and helpers (proofs only: the fact layer's product test against the old one). */
  panelBuild?: { inputs: Map<string, PanelCellInput>; helpers: Parameters<typeof buildPanels>[1] };
  /** am31, harness only: each panel cell's answers (response ids). */
  panelCells?: Record<string, string[]>;
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
  /** am68: a What-to-look-for cell's winning argument the AI seldom teaches there (the move names it). */
  criteriaWinner?: string;
  /** Statements: the two side facts the verdict reads (classify(you.k, them.k, you.n)); `override` = the criteria cell's
   * computed verdict. */
  youFact?: string;
  themFact?: string;
  override?: boolean;
}

export async function computeAnalysisMap(
  data: ViewData,
  request: ViewRequest = {},
  debug?: AnalysisMapDebug,
  pre?: { summary?: BrandSummaryView; inputs?: InsightInputs; rules?: RulesShared }
): Promise<AnalysisMapView> {
  const { project } = data;
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  const brand = project.brand;
  const capture: { inputs?: InsightInputs } = {};
  const summary = pre?.summary ?? (await computeBrandSummary(data, eng, capture));
  // The detectors' inputs: the figures restate their facts exactly (am9).
  const inputs = pre?.inputs ?? capture.inputs ?? (await insightInputs(data, eng));
  if (debug) debug.summary = summary;
  // Step 5 of the fact layer: every cell, figure, claim, badge and position reads the run's one fact book - the same
  // facts the cards draw (each card's scope is the cell's scope), so a cell and the card it opens agree by construction.
  const rf = await sharedRunFacts(data, eng);
  const { book, sel, set } = rf;
  const targetKey = set.target.key;
  const resolve = set.resolve;
  const F = (m: string, s: string, sc: Scope): FactCell => fc(book, m, s, sc);
  const sub = (k: string) => (k === targetKey ? "you" : k);
  const rowsOf = (sc: Scope): PoolRow[] => book.rows(sc).map((f) => rf.rowById.get(f.responseId)!).filter(Boolean);
  const hitRows = (m: string, s: string, sc: Scope): PoolRow[] => book.answers(m, s, sc).hit.map((f) => rf.rowById.get(f.responseId)!).filter(Boolean);
  const sliceRows = (slice: string, sc: Scope): PoolRow[] => hitRows("slice_share", `ai/slice:${slice}`, sc);
  const has = (sc: Scope) => book.rows(sc).length > 0;
  const defaultKey = summary.brands.find((b) => b.role !== "target" && b.chosen.k > 0)?.key ?? null;
  const takerKindOf = (key: string | null): string => (key && key === defaultKey ? TAKER.default : TAKER.rival);
  const product = productNoun(project.category);

  /* -- room order: intent situations in setup order -- */
  const rooms: string[] = [];
  for (const it of [...data.intents].sort((a, b) => a.seq - b.seq)) {
    if (it.situation && viewsOf(it.stage, it.angle).length > 0 && !rooms.includes(it.situation)) rooms.push(it.situation);
  }
  const roomsIn = (sc: Scope) => {
    const present = new Set(book.rows(sc).map((f) => f.situation).filter((x): x is string => !!x));
    return rooms.filter((r) => present.has(r));
  };
  const intentSeq = new Map(data.intents.map((i) => [i.id, i.seq]));

  /* -- the cells -- */
  const specs: CellSpec[] = [];
  const pushAll = (s: CellSpec) => {
    s.pooled = true;
    specs.push(s);
  };
  /** The top other brand by picks in a pick scope (the card's leader selection). */
  const leaderOf = (sc: Scope) => (sel.selection("leader", "you", sc).members[0] as SelMember | undefined) ?? null;
  /** Names of the picks outside the category in a scope, most first (a selection of names). */
  const outsideNames = (sc: Scope) => {
    const m = new Map<string, number>();
    for (const a of book.answers("slice_share", "ai/slice:pick:outside_category", { ...sc, when: "!pick:none" }).hit) {
      const nm = a.pick.name ?? a.pick.written ?? "";
      if (nm) m.set(nm, (m.get(nm) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  };

  /** What to buy / What's popular / Premium vs basic / Rivals' customers switching: your share of the picks against the
   * leader's, over the picks of brands in analysis (ruling 8); a cell whose picks mostly leave the category sets your
   * picks against those, over every pick. */
  const pickSpec = (band: BandSlug, row: string, rowLabel: string, key: string, label: string, sc: Scope, wide = false, leftKey: string | null = null): CellSpec => {
    const youShare = F("share_of_picks", "you", sc);
    const lead = leaderOf(sc);
    const themShare = lead ? F("share_of_picks", sub(lead.key), sc) : F("slice_share_of_picks", "ai/slice:pick:none", sc);
    const firm = F("slice_share", "ai/slice:!pick:none", sc);
    const outOfFirm = F("slice_share", "ai/slice:pick:outside_category", { ...sc, when: "!pick:none" });
    const leakOk = firm.k >= MIN_SIDE;
    const outsideTakes = leakOk && outOfFirm.k > themShare.k && rate(outOfFirm) >= LEAK_SHARE;
    const you = outsideTakes ? F("slice_share", "ai/slice:pick:you", { ...sc, when: "!pick:none" }) : youShare;
    const them = outsideTakes ? outOfFirm : themShare;
    const named = F("named", "you", sc);
    const noCommit = F("slice_share", "ai/slice:!pick:in_analysis", sc);
    const topOut = outsideTakes ? outsideNames(sc).slice(0, 2) : [];
    const taker: Taker = outsideTakes
      ? { name: topOut.join(", "), kind: TAKER.outside }
      : lead
        ? { name: lead.name, kind: lead.key === leftKey ? "the brand they are leaving" : takerKindOf(lead.key) }
        : { name: "No single pick", kind: TAKER.undecided };
    const where =
      row === "open"
        ? key === "all"
          ? "Across all buyers asking what to buy"
          : `For ${label}`
        : row === "social" ? "Asked what most buyers pick"
        : row === "premium" ? "Asked whether premium beats basic"
        : rowLabel;
    const spec: CellSpec = {
      band, row, rowLabel, key, label, wide, scope: sc, rows: rowsOf(sc),
      you, them, youSlice: "pick:you", themSlice: outsideTakes ? "pick:outside_category" : lead ? `pick:${lead.key}` : "pick:none",
      youAll: F("picked", "you", sc),
      taker, leftKey,
      leak: leakOk ? outOfFirm : undefined,
      note: (v) => {
        if (v === "nocall") return youShare.n < MIN_SIDE ? `${pw(F("slice_share", "ai/slice:pick:none", sc))} no clear pick` : "no side taken";
        if (v === "yours") return `you ${pw(youShare)} of picks${lead ? ` - ${lead.name} ${pw(themShare)}` : ""}`;
        return `you ${pw(youShare)} of picks - ${taker.name} ${pw(outsideTakes ? outOfFirm : themShare)}`;
      },
      claim: (v) => {
        const head = `${where}, ${brand} is named in ${pw(named)} of answers`;
        if (v === "nocall") return `${head}, but the AI commits to no single pick in your category in ${pw(noCommit)} of them - the choice is left to the buyer.`;
        if (v === "yours") return `${head} and takes ${pw(youShare)} of the picks${lead ? `, ahead of ${lead.name} at ${pw(themShare)}` : ""}.`;
        if (outsideTakes) return `${head}, yet ${pw(outOfFirm)} of the answers that commit to a pick choose something outside the category - led by ${taker.name} - and ${brand} takes ${pw(youShare)} of the picks.`;
        return v === "contested"
          ? `${head}; the picks split - ${brand} ${pw(youShare)}, ${taker.name} ${pw(themShare)}.`
          : `${head} and takes ${pw(youShare)} of the picks; ${taker.name} takes ${pw(themShare)}.`;
      },
      lift: { wins: "pick:you", others: "pick:other", note: "Share of answers arguing each code when you are picked vs when another brand in the category is." },
    };
    return spec;
  };

  /* Band 1: where the buyer chooses. Ruling 7: the all-buyers What to buy cell is the buyer cards' types only. */
  const WTB_S: Scope = { types: ["discovery", "use_case"] };
  if (has(WTB_S)) pushAll(pickSpec("chooses", "open", ROW_NAME.open, "all", "All buyers", WTB_S));
  for (const room of roomsIn(WTB_S)) specs.push(pickSpec("chooses", "open", ROW_NAME.open, norm(room), room, { ...WTB_S, situation: room }));
  const SOC: Scope = { types: ["social_validation"] };
  if (has(SOC)) specs.push(pickSpec("chooses", "social", ROW_NAME.social, "all", "", SOC, true));

  /** Spotting the problem / Learning the category: answers recommending you against answers recommending the most
   * recommended rival, over the answers recommending any brand in analysis. */
  const awarenessSpec = (row: string, rowLabel: string, key: string, label: string, sc: Scope, wide: boolean): CellSpec => {
    const recBase: Scope = { ...sc, when: "recin" };
    const others = summaryBrandsIn(sc).filter((b) => b.key !== targetKey).map((b) => ({ ...b, rec: F("recommended", b.key, sc) })).sort((a, b) => b.rec.k - a.rec.k || a.name.localeCompare(b.name));
    const top = others[0] && others[0].rec.k > 0 ? others[0] : null;
    const you = F("slice_share", "ai/slice:rec:you", recBase);
    const them = top ? F("slice_share", `ai/slice:rec:${top.key}`, recBase) : F("slice_share", "ai/slice:!args&args", recBase);
    const named = F("named", "you", sc);
    const recYou = F("recommended", "you", sc);
    const recTop = top ? top.rec : null;
    const out = row === "awareness" ? F("routed_adjacent", "ai", sc) : null;
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
      band: "chooses", row, rowLabel, key, label, wide, scope: sc, rows: rowsOf(sc),
      you, them, youSlice: "rec:you", themSlice: top ? `rec:${top.key}` : "!args&args", youAll: F("slice_share", "ai/slice:rec:you", sc),
      taker: top ? { name: top.name, kind: takerKindOf(top.key) } : { name: "No brand recommended", kind: TAKER.undecided },
      note: (v) => (v === "nocall" ? (you.n < MIN_SIDE ? `named ${pw(named)}, not backed` : "no side taken") : `you ${pw(recYou)} recommended${top ? ` - ${top.name} ${pw(recTop!)}` : ""}`),
      claim: (v) => {
        const head = `${where}, ${brand} is named in ${pw(named)} of answers and recommended in ${pw(recYou)}`;
        // Ruling 5: answers pointing outside the category ("adjacent") are a share of every answer.
        const route = out && out.n >= MIN_SIDE && rate(out) >= 0.1 ? `; ${pw(out)} of the answers send the buyer to something outside the category` : "";
        if (v === "nocall") return `${head} - too few answers recommend any brand to call who the category is explained around${route}.`;
        if (!top) return `${head}${route}.`;
        return `${head}, against ${top.name} at ${pw(recTop!)}${route}.`;
      },
    };
  };
  const PRB: Scope = { types: ["problem_recognition"] };
  if (has(PRB)) {
    const pr = roomsIn(PRB);
    const base: Scope = { ...PRB, situation: null };
    const cells = pr.length + (has(base) ? 1 : 0);
    if (cells >= 2) pushAll(awarenessSpec("awareness", ROW_NAME.awareness, "all", "All buyers", PRB, false));
    for (const room of pr) specs.push(awarenessSpec("awareness", ROW_NAME.awareness, norm(room), room, { ...PRB, situation: room }, false));
    if (has(base)) specs.push(cells >= 2 ? awarenessSpec("awareness", ROW_NAME.awareness, "general", "No particular buyer", base, false) : awarenessSpec("awareness", ROW_NAME.awareness, "all", "", PRB, true));
  }
  const EDU: Scope = { types: ["category_education"] };
  if (has(EDU)) specs.push(awarenessSpec("explainer", ROW_NAME.explainer, "all", "", EDU, true));

  // Value (ruling 3: each price answer in one bucket - a rival, else only the brand's own cheaper option, else nowhere).
  const PRC: Scope = { types: ["pricing"] };
  const valueSpec = (key: string, label: string, room: string | null, sc: Scope, wide: boolean, pooled: boolean): CellSpec => {
    const side: Scope = { ...sc, when: "v:worth_it:yes,no" };
    const you = F("slice_share", "ai/slice:v:worth_it:yes", side);
    const them = F("slice_share", "ai/slice:v:worth_it:no", side);
    const worthC = F("worth_yes", "ai", sc);
    const notC = F("worth_no", "ai", sc);
    const rivalC = F("instead_rival", "ai", sc);
    const ownC = F("instead_own", "ai", sc);
    const inhouse = F("slice_share", "ai/slice:price:own", { ...sc, when: "price:own|price:rival" });
    const inhouseOk = worthC.n >= MIN_SIDE && inhouse.n > 0;
    const ownTop = set.ladder ? ((sel.selection("own_options", "ai", sc).members as SelMember[])[0] ?? null) : null;
    const rivTop = (sel.selection("instead_brands", "ai", sc).members as SelMember[])[0] ?? null;
    const taker: Taker =
      inhouseOk && rate(inhouse) >= INHOUSE_SHARE && ownTop
        ? { name: ownTop.name, kind: TAKER.own }
        : rivTop
          ? { name: rivTop.name, kind: TAKER.rival }
          : { name: "A cheaper option, unnamed", kind: TAKER.undecided };
    const line = book.rows(sc)[0]?.line ?? null;
    const subject = pooled ? brand : line ?? brand;
    return {
      band: "chooses", row: "value", rowLabel: ROW_NAME.value, key, label, wide, scope: sc, rows: rowsOf(sc),
      you, them, youSlice: "v:worth_it:yes", themSlice: "v:worth_it:no", youAll: worthC, taker,
      inhouse: inhouseOk ? inhouse : undefined,
      line,
      note: (v) => (v === "nocall" ? `${pw(F("worth_depends", "ai", sc))} "depends"` : `worth it ${pw(worthC)} - not worth it ${pw(notC)}`),
      claim: (v) => {
        const head = pooled
          ? `Across every buying situation, ${brand} is judged worth it over a cheaper option in ${pw(worthC)} of answers and not worth it in ${pw(notC)}`
          : `${room ? `For ${room}, ` : ""}${subject} is judged worth it over a cheaper option in ${pw(worthC)} of answers and not worth it in ${pw(notC)}`;
        if (v === "nocall") return `${head} - the rest say it depends, so the AI takes no side here.`;
        // Ruling 3: shares of every price answer (the card's own figures), never shares of the doubts.
        const tail = [rivalC.k > 0 ? `points the buyer to a rival instead in ${pw(rivalC)} of answers` : null, ownC.k > 0 ? `to only ${brand}'s own cheaper option in ${pw(ownC)}` : null].filter(Boolean);
        const led = taker.kind !== TAKER.undecided ? taker.name : "";
        return tail.length ? `${head}; the AI ${tail.join(" and ")}.${led ? ` It names ${led} most often.` : ""}` : `${head}.`;
      },
      lift: { wins: "v:worth_it:yes", others: "v:worth_it:no", note: "Share of worth-it answers vs not-worth-it answers arguing each code.", sides: ["worth-it answers", "not-worth-it answers"] },
    };
  };
  if (has(PRC)) {
    const vr = roomsIn(PRC);
    const base: Scope = { ...PRC, situation: null };
    const groups = vr.length + (has(base) ? 1 : 0);
    if (groups >= 2) pushAll(valueSpec("all", "All buyers", null, PRC, false, true));
    for (const room of vr) {
      const sc: Scope = { ...PRC, situation: room };
      const line = book.rows(sc)[0]?.line ?? null;
      specs.push(valueSpec(norm(room), line ? `${room} - ${line}` : room, room, sc, false, false));
    }
    if (has(base)) {
      const line = book.rows(base)[0]?.line ?? null;
      specs.push(valueSpec(groups >= 2 ? "general" : "all", line ?? "", null, groups >= 2 ? base : PRC, groups < 2, false));
    }
  }

  // Premium vs basic (wide).
  const PRM: Scope = { types: ["premium_worth"] };
  if (has(PRM)) specs.push(pickSpec("chooses", "premium", ROW_NAME.premium, "all", "", PRM, true));

  // What to look for: per buying situation when room-pinned, else wide. Ruling 7: what wins reads what-to-buy answers.
  const allLift = summary.reasonLift;
  /** One buyer's own what-to-buy lift (am66): 10 picks a side, else none; facts on that buyer's What to buy card. */
  const roomLift = (room: string, subjectKey: string = targetKey): ReasonLift[] | null => {
    const sc: Scope = { ...WTB_S, situation: room };
    if (!has(sc)) return null;
    const s0 = sub(subjectKey);
    const yo = F("slice_share", `ai/slice:pick:${s0}&args`, sc);
    const ot = F("slice_share", `ai/slice:pick:in_analysis&!pick:${s0}&args`, sc);
    if (yo.k < ROOM_LIFT_MIN || ot.k < ROOM_LIFT_MIN) return [];
    const codes = [...new Set(book.rows(sc).filter((f) => f.pick.state === "in_analysis").flatMap((f) => f.args ?? []))].sort();
    return codes
      .map((code) => {
        const w = F("argues_when_picked", `${s0}/arg:${code}`, sc);
        const o = F("argues_when_other_picked", `${s0}/arg:${code}`, sc);
        return { code, wins: w, others: o, lift: rate(w) - rate(o) };
      })
      .filter((l) => l.wins.k + l.others.k > 0)
      .sort((a, b) => b.lift - a.lift || a.code.localeCompare(b.code));
  };
  if (debug) {
    debug.roomLift = (room: string, subjectKey?: string) => roomLift(room, subjectKey);
    // One side only: the codes argued in one buyer's answers whose pick is `brandKey` (most argued first).
    debug.roomCodes = (room: string, brandKey: string) => {
      const sc: Scope = { ...WTB_S, situation: room, when: `pick:${sub(brandKey)}&args` };
      const codes = [...new Set(book.rows(sc).flatMap((f) => f.args ?? []))].map((code) => ({ code, rate: F("argues", `ai/arg:${code}`, sc) }));
      return { n: F("slice_share", "ai/slice:args", sc).n, codes: codes.sort((a, b) => b.rate.k - a.rate.k || a.code.localeCompare(b.code)) };
    };
  }
  const CRT: Scope = { types: ["criteria"] };
  const criteriaSpec = (key: string, label: string, sc: Scope, wide: boolean, own: ReasonLift[] | null = null): CellSpec => {
    const lift = own ?? allLift;
    const winners = lift.filter((l) => l.lift > 0 && l.wins.low > l.others.high).slice(0, 3);
    const losers = [...lift].reverse().filter((l) => l.lift < 0 && l.others.low > l.wins.high).slice(0, 3);
    const liftRow = new Map(lift.map((l) => [l.code, l]));
    // The card's own "what to look for" list (the checklist selection).
    const top5 = (sel.selection("checklist", "ai", sc).members as SelMember[]).map((m) => m.key);
    const withArgs = F("slice_share", "ai/slice:args", sc);
    const n = withArgs.n;
    const taughtRate = (c: string) => F("argues", `ai/arg:${c}`, sc);
    const winTaught = winners.filter((w) => top5.includes(w.code));
    const loseTaught = losers.filter((l) => top5.includes(l.code));
    let verdict: CellVerdict = "nocall";
    let lean = 0;
    if (withArgs.k >= MIN_SIDE && (winners.length > 0 || losers.length > 0)) {
      if (winTaught.length === 0) { verdict = "theirs"; lean = -1; }
      else if (loseTaught.length === 0) { verdict = "yours"; lean = 1; }
      else { verdict = "contested"; lean = Math.sign(winTaught.length - loseTaught.length); }
    }
    const untaught = winners.find((w) => !top5.includes(w.code)) ?? null;
    const items: LiftItem[] = [...new Set([...top5, ...winners.map((w) => w.code), ...losers.map((l) => l.code)])]
      .filter((c) => liftRow.has(c))
      .map((c) => {
        const l = liftRow.get(c)!;
        return {
          label: top5.includes(c) ? `${c} (taught ${pw(taughtRate(c))})` : `${c} (seldom taught)`,
          value: Math.round(l.lift * 100),
          ...liftShares(l),
        };
      })
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, LIFT_TOP);
    const taughtText = top5.slice(0, 3).map((c) => `${c} (${pw(taughtRate(c))})`).join(", ");
    const anyOf = (codes: string[]) => (codes.length ? `argany:${codes.map((c) => encodeURIComponent(c)).join(",")}` : "!args&args");
    const youSlice = anyOf(winTaught.map((w) => w.code));
    const themSlice = loseTaught.length ? anyOf(loseTaught.map((l) => l.code)) : anyOf(top5.slice(0, 1));
    return {
      band: "chooses", row: "criteria", rowLabel: ROW_NAME.criteria, key, label, wide, scope: sc, rows: rowsOf(sc),
      you: F("slice_share", `ai/slice:${youSlice}`, sc), them: F("slice_share", `ai/slice:${themSlice}`, sc), youSlice, themSlice,
      taker: { name: "The taught checklist", kind: TAKER.undecided },
      verdictOverride: { verdict, lean },
      criteria: { winnerTaught: winTaught[0]?.code ?? null, winnerUntaught: untaught?.code ?? null, taught: top5 },
      lifts: items,
      liftNote: "Each argument's lift when buyers ask what to buy (argued when you are picked minus when another brand is), labelled with how often this cell's criteria answers teach it.",
      note: (v) =>
        v === "nocall"
          ? n < MIN_SIDE ? "too few answers" : "no winning argument measured"
          : v === "theirs" && untaught ? `teaches ${top5[0] ?? "-"} - ${untaught.code} seldom taught` : `teaches ${top5.slice(0, 2).join(", ")}`,
      claim: (v) => {
        const where =
          key === "all" && !wide
            ? "Across every buying situation, what the AI tells buyers to look for"
            : key === "general" && !wide
              ? "Asked with no particular buyer in mind, what the AI tells buyers to look for"
              : wide
                ? "What the AI tells buyers to look for"
                : `For ${label}, what the AI tells buyers to look for`;
        if (v === "nocall") return `${where} leads with ${taughtText || "no single argument"} - too little to set against your winning arguments.`;
        if (v === "theirs")
          return `${where} leads with ${taughtText}${untaught ? ` - while ${untaught.code}, an argument that comes up more when you win, is seldom taught` : ", none of them an argument that comes up more when you win"}.`;
        if (v === "yours") return `${where} leads with ${taughtText}, including ${winTaught[0].code} - an argument that comes up more when you win.`;
        return `${where} leads with ${taughtText}: ${winTaught[0].code} helps you, ${loseTaught[0].code} favors the rival picks.`;
      },
    };
  };
  if (has(CRT)) {
    const cr = roomsIn(CRT);
    const base: Scope = { ...CRT, situation: null };
    const cells = cr.length + (has(base) ? 1 : 0);
    if (cells >= 2) pushAll(criteriaSpec("all", "All buyers", CRT, false));
    for (const room of cr) specs.push(criteriaSpec(norm(room), room, { ...CRT, situation: room }, false, roomLift(room)));
    if (has(base)) specs.push(cells >= 2 ? criteriaSpec("general", "No particular buyer", base, false) : criteriaSpec("all", "", CRT, true));
  }

  /* Band 2: the named fights */
  const h2hSpec = (key: string, rival: { key: string; name: string }, sc: Scope): CellSpec => {
    const you = F("h2h_two_way", "you", sc);
    const them = F("h2h_two_way", "rival", sc);
    const undecided = F("h2h_no_pick", "ai", sc);
    const firm = F("slice_share", "ai/slice:!pick:none", sc);
    const outOfFirm = F("slice_share", "ai/slice:pick:outside_category", { ...sc, when: "!pick:none" });
    return {
      band: "fights", row: "h2h", rowLabel: ROW_NAME.h2h, key, label: rival.name, rivalKey: rival.key, scope: sc, rows: rowsOf(sc),
      you, them, youSlice: "pick:you", themSlice: "pick:rival",
      taker: { name: rival.name, kind: takerKindOf(rival.key) },
      leak: firm.k >= MIN_SIDE ? outOfFirm : undefined,
      note: (v) => (v === "nocall" ? `${pw(undecided)} no clear pick` : `you ${pw(you)} of picks`),
      claim: (v) =>
        v === "nocall"
          ? `Asked to compare ${brand} with ${rival.name} directly, the AI declines to pick between them in ${pw(undecided)} of answers.`
          : `Asked to compare ${brand} with ${rival.name} directly, the AI picks ${brand} in ${pw(you)} of the answers that pick one of them${undecided.k > 0 ? ` (no clear pick in ${pw(undecided)})` : ""}.`,
      lift: { wins: "pick:you", others: "pick:rival", note: `Within this matchup: share of answers arguing each code when you win vs when ${rival.name} does.`, sides: ["your wins", `${rival.name}'s wins`] },
    };
  };
  const ENT: Scope = { types: ["comparison_entity"] };
  const CLS: Scope = { types: ["comparison_class"] };
  const rivalsOf = (type: "comparison_entity" | "comparison_class") => {
    const m = new Map<string, { key: string; name: string; seq: number; angle: string }>();
    for (const f of set.facts) if (f.type === type && f.rival && !m.has(f.rival.key)) m.set(f.rival.key, { key: f.rival.key, name: f.rival.name, seq: intentSeq.get(f.intentId) ?? 0, angle: f.angle ?? f.rival.name });
    return [...m.values()].sort((a, b) => a.seq - b.seq);
  };
  const entityList = rivalsOf("comparison_entity");
  const classList = rivalsOf("comparison_class");
  if (entityList.length + classList.length >= 2) {
    const you = F("h2h_two_way", "you", ENT);
    const them = F("h2h_two_way", "rival", ENT);
    const undecided = F("h2h_no_pick", "ai", ENT);
    const lostBy = entityList.map((r) => ({ ...r, lost: F("h2h_win", "rival", { ...ENT, rival: r.key }) })).sort((a, b) => b.lost.k - a.lost.k || a.name.localeCompare(b.name));
    const tough = lostBy[0] && lostBy[0].lost.k > 0 ? lostBy[0] : null;
    const firm = F("slice_share", "ai/slice:!pick:none", ENT);
    const outOfFirm = F("slice_share", "ai/slice:pick:outside_category", { ...ENT, when: "!pick:none" });
    pushAll({
      band: "fights", row: "h2h", rowLabel: ROW_NAME.h2h, key: "all", label: "All rivals", scope: ENT, rows: rowsOf(ENT),
      you, them, youSlice: "pick:you", themSlice: "pick:rival",
      taker: tough ? { name: tough.name, kind: TAKER.rival } : { name: "No single pick", kind: TAKER.undecided },
      leak: firm.k >= MIN_SIDE ? outOfFirm : undefined,
      note: (v) => (v === "nocall" ? `${pw(undecided)} no clear pick` : `you ${pw(you)} of picks - across ${entityList.length} rivals`),
      claim: (v) =>
        v === "nocall"
          ? `Asked to compare ${brand} with one of its named rivals directly, the AI declines to pick between them in ${pw(undecided)} of answers.`
          : `Across its named rivals, asked to compare ${brand} with one of them directly, the AI picks ${brand} in ${pw(you)} of the answers that pick one of them${tough ? `; ${tough.name} wins the most of them against you` : ""}.`,
      figures: classList.map((g) => {
        const c = F("h2h_two_way", "you", { ...CLS, rival: g.key });
        return { label: `Asked against the ${g.name} class (not in the pooled number)`, value: `${pw(c)} of picks`, tip: `${c.k} won, ${c.n - c.k} lost` };
      }),
      lift: { wins: "pick:you", others: "pick:rival", note: "Pooled across every matchup: share of answers arguing each code when you win vs when the named rival does.", sides: ["your wins", "rivals' wins"] },
    });
  }
  for (const g of entityList) specs.push(h2hSpec(norm(g.angle), g, { ...ENT, rival: g.key }));
  for (const g of classList) specs.push(h2hSpec(`class-${norm(g.name)}`, g, { ...CLS, rival: g.key }));

  // Rivals' customers switching.
  const SWT: Scope = { types: ["switching"] };
  if (has(SWT)) {
    const left = new Map<string, { key: string; name: string; leftKey: string | null; scopeRival: string; seq: number }>();
    for (const f of book.rows(SWT)) {
      const generic = !f.rival;
      const k = generic ? "generic" : f.rival!.key;
      if (!left.has(k))
        left.set(k, { key: generic ? "generic" : norm(f.angle ?? f.rival!.name), name: generic ? "No rival named" : f.rival!.name, leftKey: generic ? null : f.rival!.key, scopeRival: k, seq: intentSeq.get(f.intentId) ?? 0 });
    }
    const angles = [...left.keys()].filter((k) => k !== "generic").length;
    const leaver = (key: string, label: string, sc: Scope, wide: boolean, leftKey: string | null): CellSpec => {
      const s = pickSpec("fights", "leavers", ROW_NAME.leavers, key, label, sc, wide, leftKey);
      const named = F("named", "you", sc);
      const recommended = F("recommended", "you", sc);
      const picked = F("picked", "you", sc);
      const lead = leaderOf(sc);
      const topC = lead ? F("share_of_picks", sub(lead.key), sc) : null;
      const youC = F("share_of_picks", "you", sc);
      const firm = F("slice_share", "ai/slice:!pick:none", sc);
      const outsideOfFirm = F("slice_share", "ai/slice:pick:outside_category", { ...sc, when: "!pick:none" });
      const whose = key === "all" ? "Buyers leaving a rival" : `Buyers leaving ${label}`;
      return {
        ...s,
        ...(leftKey ? { rivalKey: leftKey } : {}),
        note: (v) => (v === "nocall" ? `named ${pw(named)}, picked ${pw(picked)}` : `you ${pw(picked)} of picks${lead ? ` - ${lead.name} ${pw(topC!)}` : ""}`),
        claim: (v) =>
          `${whose}: ${brand} is named in ${pw(named)} of answers and picked in ${pw(picked)}${
            v === "nocall" ? " - too few answers commit to a pick to call who captures them" : lead ? `; ${lead.name} takes ${pw(topC!)} of the picks ${youC.k === 0 ? "and you none" : `against your ${pw(youC)}`}` : ""
          }.`,
        lift: { wins: "pick:you", others: "pick:other", note: "Share of the switching customers' answers arguing each code when the AI tells them to pick you vs another brand." },
        figures: [
          { label: `${brand} named`, value: pw(named), tip: tipC(named) },
          { label: `${brand} recommended`, value: pw(recommended), tip: tipC(recommended) },
          { label: `${brand} picked, of all answers`, value: pw(picked), tip: tipC(picked) },
          ...(lead ? [{ label: `${lead.name}'s share of the picks`, value: pw(topC!), tip: tipC(topC!) }] : []),
          ...(firm.k ? [{ label: "Picks outside the category", value: pw(outsideOfFirm), tip: `${outsideOfFirm.k} of ${outsideOfFirm.n} firm picks` }] : []),
        ],
      };
    };
    if (angles >= 2) {
      pushAll(leaver("all", "All rivals", SWT, false, null));
      for (const g of [...left.values()].sort((a, b) => a.seq - b.seq)) specs.push(leaver(g.key, g.name, { ...SWT, rival: g.scopeRival }, false, g.leftKey));
    } else {
      const sole = angles === 1 ? [...left.values()].find((g) => g.leftKey)?.leftKey ?? null : null;
      specs.push(leaver("all", "", SWT, true, sole));
    }
  }

  /* Band 3: the doubts */
  const exitTaker = (sc: Scope, unfav: FactCell, unfavSlice: string, fallback: Taker): Taker => {
    const top = (sel.selection("sent_brands", "ai", { ...sc, when: unfavSlice }).members as SelMember[])[0];
    return top && top.count >= Math.max(EXIT_MIN, unfav.k * EXIT_SHARE) ? { name: top.name, kind: TAKER.rival } : fallback;
  };
  const exitsOf = (sc: Scope) => (sel.selection("sent_brands", "ai", sc).members as SelMember[]).slice(0, COND_TOP).map((m) => ({ name: m.name, n: m.count }));
  const OBJ: Scope = { types: ["objections"] };
  const CONCEDED = "v:proceed_or_avoid:avoid|v:premise_verdict:confirms&!v:proceed_or_avoid:proceed";
  const buyersSpec = (key: string, label: string, sc: Scope, who: string): CellSpec => {
    const side: Scope = { ...sc, when: "v:proceed_or_avoid:proceed,avoid|v:premise_verdict:confirms" };
    const you = F("slice_share", "ai/slice:v:proceed_or_avoid:proceed", side);
    const them = F("slice_share", `ai/slice:${CONCEDED}`, side);
    const agree = F("agrees", "ai", sc);
    const go = F("go_ahead", "ai", sc);
    const goOfAgreed = F("go_ahead", "ai", { ...sc, when: "v:premise_verdict:confirms" });
    return {
      band: "doubts", row: "buyers", rowLabel: ROW_NAME.buyers, key, label, scope: sc, rows: rowsOf(sc),
      you, them, youSlice: "v:proceed_or_avoid:proceed", themSlice: CONCEDED, youAll: go,
      taker: exitTaker(sc, them, CONCEDED, { name: "The worry, conceded", kind: TAKER.undecided }),
      conceded: { agree, goAheadOfAgreed: goOfAgreed },
      exitFallback: exitsOf(sc),
      note: () => `go ahead ${pw(go)} - agrees with the worry ${pw(agree)}`,
      claim: (v) =>
        `${who}, the AI agrees the worry is fair in ${pw(agree)} of the answers that judge it and tells them to go ahead in ${pw(go)}${
          v === "nocall" ? " - most answers take no side" : goOfAgreed.n >= MIN_SIDE && rate(goOfAgreed) >= 0.3 ? `, including ${pw(goOfAgreed)} of the answers that agree` : ""
        }.`,
      lift: { wins: "v:proceed_or_avoid:proceed", others: CONCEDED, note: "Share of go-ahead answers vs conceding answers arguing each code.", sides: ["go-ahead answers", "conceding answers"] },
    };
  };
  const worriesOf = (types: QuestionType[]) => {
    const m = new Map<string, { concern: string; stage: string; seq: number }>();
    for (const it of [...data.intents].sort((a, b) => a.seq - b.seq)) {
      if (!types.includes(it.stage as QuestionType)) continue;
      const k = `${it.stage}|${it.concern ?? ""}`;
      if (!m.has(k) && has({ types: [it.stage as QuestionType], worry: it.concern ?? undefined } as Scope)) m.set(k, { concern: it.concern ?? "", stage: it.stage, seq: it.seq });
    }
    return [...m.values()];
  };
  if (has(OBJ)) {
    const ws = worriesOf(["objections"]);
    if (ws.length >= 2) pushAll(buyersSpec("all", "All worries", OBJ, "Across every buyer worry"));
    for (const w of ws) {
      const label = w.concern || "A worry";
      specs.push(buyersSpec(norm(label), label, { ...OBJ, worry: w.concern }, `When a buyer worries "${label}"`));
    }
  }
  const CUS: Scope = { types: ["churn_triggers", "renewal"] };
  const staySpec = (row: string, rowLabel: string, key: string, label: string, sc: Scope, wide: boolean, who: string): CellSpec => {
    const side: Scope = { ...sc, when: "v:keep_or_leave:keep,leave" };
    const you = F("slice_share", "ai/slice:v:keep_or_leave:keep", side);
    const them = F("slice_share", "ai/slice:v:keep_or_leave:leave", side);
    const keepC = F("stay", "ai", sc);
    const leaveC = F("leave", "ai", sc);
    const taker = exitTaker(sc, F("leave", "ai", sc), "v:keep_or_leave:leave", leaveC.k > 0 ? { name: "Leaving, no destination named", kind: TAKER.undecided } : { name: "No side taken", kind: TAKER.undecided });
    return {
      band: "doubts", row, rowLabel, key, label, wide, scope: sc, rows: rowsOf(sc),
      you, them, youSlice: "v:keep_or_leave:keep", themSlice: "v:keep_or_leave:leave", youAll: keepC, taker,
      exitFallback: exitsOf(sc),
      note: () => `stay ${pw(keepC)} - leave ${pw(leaveC)}`,
      claim: (v) =>
        `${who}, the AI says stay in ${pw(keepC)} of answers and leave in ${pw(leaveC)}${v === "nocall" ? " - most take no side" : taker.kind === TAKER.rival ? `; ${taker.name} is where the AI sends most of the customers it tells to leave` : ""}.`,
      lift: { wins: "v:keep_or_leave:keep", others: "v:keep_or_leave:leave", note: "Share of stay answers vs leave answers arguing each code.", sides: ["stay answers", "leave answers"] },
    };
  };
  if (has(CUS)) {
    const ws = worriesOf(["churn_triggers", "renewal"]);
    const count = new Map<string, number>();
    for (const w of ws) count.set(norm(w.concern), (count.get(norm(w.concern)) ?? 0) + 1);
    if (ws.length >= 2) pushAll(staySpec("customers", ROW_NAME.customers, "all", "All worries", CUS, false, "Across every customer worry"));
    for (const w of ws) {
      const label = w.concern || "A worry";
      const both = (count.get(norm(w.concern)) ?? 0) > 1;
      // The card's scope: both stages unless the worry is asked at both (then one cell per stage).
      const sc: Scope = both ? { types: [w.stage as QuestionType], worry: w.concern } : { ...CUS, worry: w.concern };
      specs.push(staySpec("customers", ROW_NAME.customers, both ? `${norm(label)}|${w.stage}` : norm(label), label, sc, false, `When a customer worries "${label}"`));
    }
  }
  const LKA: Scope = { types: ["looking_around"] };
  // The looking-around card's own scope: its buying situation (questions asked of no particular buyer: none).
  if (has(LKA)) specs.push(staySpec("hold", ROW_NAME.hold, "all", "", { ...LKA, situation: book.rows(LKA)[0]?.situation ?? null }, true, "When your own customer asks what else to look at"));
  const REP: Scope = { types: ["repertoire"] };
  if (has(REP)) {
    const side: Scope = { ...REP, when: "!pick:none" };
    const stickC = F("picked", "you", REP);
    const swC = F("slice_share", "ai/slice:!pick:none&!pick:you", REP);
    const sw = new Map<string, number>();
    for (const a of book.answers("slice_share", "ai/slice:!pick:none&!pick:you", REP).hit) if (a.pick.name) sw.set(a.pick.name, (sw.get(a.pick.name) ?? 0) + 1);
    const topSw = [...sw.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    specs.push({
      band: "doubts", row: "repertoire", rowLabel: ROW_NAME.repertoire, key: "all", label: "", wide: true, scope: REP, rows: rowsOf(REP),
      you: F("slice_share", "ai/slice:pick:you", side), them: F("slice_share", "ai/slice:!pick:you", side), youSlice: "pick:you", themSlice: "!pick:none&!pick:you", youAll: stickC,
      taker: topSw ? { name: topSw[0], kind: TAKER.rival } : { name: "No single pick", kind: TAKER.undecided },
      note: () => `stick with you ${pw(stickC)} - switch ${pw(swC)}`,
      claim: (v) => `Asked whether to keep buying ${brand} out of habit, the AI says stick with it in ${pw(stickC)} of answers and switch in ${pw(swC)}${v !== "nocall" && topSw ? `, most often to ${topSw[0]}` : ""}.`,
      lift: { wins: "pick:you", others: "!pick:none&!pick:you", note: "Share of stick answers vs switch answers arguing each code.", sides: ["stick answers", "switch answers"] },
    });
  }

  /* Band 4: the settled customer */
  const objectionsAgree = F("agrees", "ai", OBJ);
  const SETTLED: [QuestionType, string, string][] = [
    ["business_case", "business case", "Business case"],
    ["expansion", "expansion", "Expansion"],
    ["ecosystem", "ecosystem", "What to use alongside you"],
    ["advocacy", "advocacy", "Answering a critic"],
  ];
  const present = SETTLED.filter(([t]) => has({ types: [t] }));
  const settledSpec = (key: string, label: string, sc: Scope, lead: (strC: string) => string, asked: boolean, pooled: boolean): CellSpec => {
    const side: Scope = { ...sc, when: "v:relationship_verdict:strengthens,weakens" };
    const strC = F("relationship_strengthens", "ai", sc);
    const weakC = F("relationship_weakens", "ai", sc);
    const strong = asked ? F("case_strong", "ai", sc) : null;
    const defend = strong && rate(strong) > rate(strC) ? strong : strC;
    const settledWatch = asked && defend.n >= MIN_SIDE && objectionsAgree.n >= MIN_SIDE && rate(defend) >= 0.5 && rate(objectionsAgree) >= 0.5;
    const red = (sel.selection("redirect_dests", "ai", sc).members as SelMember[])[0];
    return {
      band: "settled", row: "settled", rowLabel: ROW_NAME.settled, key, label, scope: sc, rows: rowsOf(sc),
      you: F("slice_share", "ai/slice:v:relationship_verdict:strengthens", side), them: F("slice_share", "ai/slice:v:relationship_verdict:weakens", side),
      youSlice: "v:relationship_verdict:strengthens", themSlice: "v:relationship_verdict:weakens", youAll: strC,
      taker: red && red.count >= Math.max(EXIT_MIN, strC.n * REDIRECT_SHARE) ? { name: red.name, kind: TAKER.rival } : { name: "No side taken", kind: TAKER.undecided },
      settledWatch,
      note: () => `strengthens ${pw(strC)}`,
      claim: (v) => {
        const head = lead(pw(strC));
        if (settledWatch && !pooled) return `${head}; asked neutrally about buyers' worries, it agrees with them in ${pw(objectionsAgree)} - the asker set the side here.`;
        return v === "nocall" ? `${head} - most answers stay neutral.` : `${head}${weakC.k ? ` and weakens it in ${pw(weakC)}` : ""}.`;
      },
      lift: { wins: "v:relationship_verdict:strengthens", others: "!v:relationship_verdict:strengthens", note: "Share of strengthening answers vs the rest arguing each code.", sides: ["strengthening answers", "the rest"] },
    };
  };
  if (present.length >= 2) {
    const names = present.map(([, k]) => k);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    const s = settledSpec("all", "All questions", { types: present.map(([t]) => t) }, (x) => `Asked by your customers across ${list}, the AI strengthens the relationship in ${x} of answers`, false, true);
    s.settledWatch = false;
    pushAll(s);
  }
  for (const [t, key, label] of present)
    specs.push(settledSpec(key, label, { types: [t] }, (x) => `Asked by your customers about ${key}, the AI strengthens the relationship in ${x} of answers`, t === "advocacy" || t === "business_case", false));

  /* -- the numbers (am9, the citation ruling): every figure a cell states, from the fact the card draws. -- */
  const specId = (x: CellSpec) => `${x.band}:${x.row}:${x.key}`;
  const specOf = (id: string) => specs.find((x) => specId(x) === id);
  const addFigs = (id: string | undefined, figs: Figure[]) => {
    const sp = id ? specOf(id) : undefined;
    if (sp && figs.length) sp.figures = [...(sp.figures ?? []), ...figs];
  };
  const pooledId = (prefix: string) => {
    if (specOf(`${prefix}all`)) return `${prefix}all`;
    const ids = specs.map(specId).filter((id) => id.startsWith(prefix));
    return ids.length === 1 ? ids[0] : undefined;
  };
  const Fg = (label: string, c: FactCell, value = pw(c)): Figure => ({ label, value, tip: tipC(c) });
  const listVal = (xs: string[]) => xs.join(" · ");
  {
    const S = summary.target;
    const figs: Figure[] = [
      Fg("Named when buyers ask what to buy", S.mentioned as FactCell),
      Fg("Recommended", S.recommended as FactCell),
      { label: "Recommended, of the answers that name it", value: pd("kk", [S.recommended, S.mentioned]), tip: `${S.recommended.k} recommending of ${S.mentioned.k} naming` },
      Fg(`The AI commits to one ${product}`, summary.firmPickInCategory as FactCell),
      Fg("Share of picks", S.shareOfDecided as FactCell),
      Fg("Picked, of all answers", S.chosen as FactCell, pfine(S.chosen)),
      ...(S.converts ? [Fg("Recommendations that end as the pick", S.converts as FactCell)] : []),
    ];
    const lk = inputs.leak;
    if (lk.firm > 0 && lk.outsideCell) {
      figs.push(Fg("Picks outside the category", lk.outsideCell as FactCell));
      const rr = lk.rooms.filter((r) => r.firm > 0 && r.outside > 0 && lk.roomCells?.[r.room]);
      if (rr.length) figs.push({ label: "Picks outside the category, by buying situation", value: listVal(rr.map((r) => `${r.room} ${pw(lk.roomCells![r.room])}`)) });
    }
    addFigs("chooses:open:all", figs);
  }
  for (const sp of specs.filter((x) => x.band === "chooses" && x.row === "open" && x.key !== "all")) {
    const sc = sp.scope;
    const named = F("named", "you", sc);
    const rec = F("recommended", "you", sc);
    const commit = F("commit_rate", "ai", sc);
    const picked = F("picked", "you", sc);
    const conv = F("converts", "you", sc);
    const firm = F("slice_share", "ai/slice:!pick:none", sc);
    const outOfFirm = F("slice_share", "ai/slice:pick:outside_category", { ...sc, when: "!pick:none" });
    const pickedKeys = new Map<string, string>();
    for (const f of book.rows(sc)) if (f.pick.state === "in_analysis" && !pickedKeys.has(f.pick.key!)) pickedKeys.set(f.pick.key!, f.pick.key === targetKey ? brand : f.pick.name!);
    const takers = [...pickedKeys.entries()].map(([k, name]) => ({ name, c: F("share_of_picks", sub(k), sc) })).sort((a, b) => b.c.k - a.c.k || a.name.localeCompare(b.name));
    sp.figures = [
      ...(sp.figures ?? []),
      Fg("Named when buyers ask what to buy", named),
      Fg("Recommended", rec),
      { label: "Recommended, of the answers that name it", value: pd("kk", [rec, named]), tip: `${rec.k} recommending of ${named.k} naming` },
      Fg(`The AI commits to one ${product}`, commit),
      Fg("Picked, of all answers", picked, pfine(picked)),
      Fg("Recommendations that end as the pick", conv),
      ...(firm.k > 0 ? [Fg("Picks outside the category", outOfFirm)] : []),
      ...(takers.length ? [{ label: "Share of the picks here, by brand", value: listVal(takers.map((t) => `${t.name} ${pw(t.c)}`)), tip: `${commit.k} picks of a brand in the category` }] : []),
    ];
  }
  {
    const h = summary.headToHead;
    const pooledC = summary.headToHeadAll as FactCell | undefined;
    const figs: Figure[] = [];
    if (pooledC && pooledC.n > 0) figs.push(Fg("Direct matchups won, named rivals pooled", pooledC));
    const recs = h.filter((r) => r.winOfDecided.n > 0);
    if (recs.length) figs.push({ label: "Won against each rival", value: listVal(recs.map((r) => `${r.rival} ${pw(r.winOfDecided)}`)), tip: recs.map((r) => `${r.rival} ${r.won.k}-${r.lost.k}`).join("; ") });
    const se = summary.byMode.find((m) => m.key === "search");
    const ins = summary.byMode.find((m) => m.key === "instinct");
    if (se && ins && se.h2h.n > 0 && ins.h2h.n > 0) figs.push({ label: "Direct matchups won, with and without web search", value: `with ${pw(se.h2h)} · without ${pw(ins.h2h)}` });
    const ha = inputs.h2hArgs;
    if (ha.wins > 0 && ha.losses > 0)
      for (const c of ha.codes.filter((x) => x.wins >= MIN_SIDE && x.losses >= MIN_SIDE && x.wins / ha.wins >= 0.4 && x.w && x.l))
        figs.push({ label: `${c.code}: argued in the matchups you win / lose`, value: `${pw(c.w!)} / ${pw(c.l!)}`, tip: `${c.wins} of ${ha.wins} wins; ${c.losses} of ${ha.losses} losses` });
    addFigs(pooledId("fights:h2h:"), figs);
  }
  for (const sp of specs.filter((x) => x.row === "h2h" && x.key !== "all"))
    sp.figures = [...(sp.figures ?? []), Fg(`${brand} picked, of the answers that pick one of the two`, sp.you), Fg(`${sp.label} picked, of the answers that pick one of the two`, sp.them)];
  {
    const o = inputs.alternatives.offensive;
    if (o) {
      const t = o.overall;
      const figs: Figure[] = [Fg(`${brand} named`, t.named as FactCell), Fg(`${brand} recommended`, t.recommended as FactCell), Fg(`${brand} picked, of all answers`, t.captured as FactCell)];
      const takers = o.captors.filter((c) => c.chosen.k > 0);
      if (takers.length) figs.push({ label: "Share of the switching customers' picks, by brand", value: listVal(takers.slice(0, 8).map((c) => `${c.name} ${pw(c.shareOfDecided)}`)) });
      const srcs = o.rows.filter((r) => r.key !== "generic" && r.answers > 0);
      if (srcs.length) figs.push({ label: `${brand} picked, by the rival being left`, value: listVal(srcs.map((r) => `${r.rival} ${pw(r.captured)}`)) });
      addFigs(pooledId("fights:leavers:"), figs);
      for (const sp of specs.filter((x) => x.row === "leavers" && x.key !== "all")) {
        const row = o.rows.find((r) => r.key === (sp.leftKey ?? "generic"));
        if (row) sp.figures = [...(sp.figures ?? []), Fg(`${brand} recommended (all answers here)`, row.recommended as FactCell), Fg(`${brand} picked (all answers here)`, row.captured as FactCell)];
      }
    }
    const d = inputs.alternatives.defensive;
    if (d) {
      const figs: Figure[] = [Fg("Told to stay", d.verdicts.keep as FactCell), Fg("Told to leave", d.verdicts.leave as FactCell), Fg("No side taken", d.verdicts.undecided as FactCell), Fg("Another brand shown", d.offersExit as FactCell)];
      const dests = d.destinations.slice(0, 6);
      if (dests.length) figs.push({ label: "Shown as an exit, by brand", value: listVal(dests.map((x) => `${x.name} ${pw(x.offered)}`)) });
      addFigs(pooledId("doubts:hold:"), figs);
    }
  }
  {
    const o = inputs.doubt.objections;
    const bd = summary.buyersDoubt;
    const bf: Figure[] = [];
    if (bd) bf.push(Fg("Told to go ahead", bd.proceed as FactCell), Fg("Told to steer clear", bd.avoid as FactCell), Fg("The AI agrees the worry is fair", bd.agree as FactCell));
    if (o) bf.push(Fg("Agrees, of the answers that judge the worry", o.premise.confirms as FactCell), Fg("Still told to go ahead, of the answers that agree", o.matrix.confirms.proceed as FactCell));
    addFigs(pooledId("doubts:buyers:"), bf);
    const k = inputs.doubt.keepOrLeave;
    const cd = summary.customersDoubt;
    const cf: Figure[] = [];
    if (cd) cf.push(Fg("Told to stay", cd.keep as FactCell), Fg("Told to leave", cd.leave as FactCell), Fg("No side either way", F("customer_no_side", "ai", CUS)), Fg("The AI agrees the worry is warranted", cd.agree as FactCell));
    if (k) {
      cf.push(Fg("Agrees, of the answers that judge the worry", k.premise.confirms as FactCell), Fg("Still told to stay, of the answers that agree", k.matrix.confirms.keep as FactCell));
      const none = F("slice_share", "ai/slice:!sent:any", { ...CUS, when: "v:keep_or_leave:leave" });
      if (none.n > 0) cf.push(Fg("Leave answers naming nowhere to go", none));
      const ok = k.rows.filter((r) => r.answers >= MIN_SIDE);
      const top = [...ok].sort((a, b) => rate(b.verdicts.leave) - rate(a.verdicts.leave) || a.concern.localeCompare(b.concern))[0];
      if (top && k.rows.length >= 2) cf.push(Fg(`Told to leave, excluding "${top.concern || "the most-leaving worry"}"`, F("leave", "ai", { ...CUS, when: `!worry:${encodeURIComponent(top.concern)}|!stage:${top.stage}` })));
    }
    addFigs(pooledId("doubts:customers:"), cf);
    for (const sp of specs.filter((x) => x.band === "doubts" && (x.row === "buyers" || x.row === "customers") && x.key !== "all")) {
      const sc = sp.scope;
      const fig: Figure[] = [Fg("Agrees, of the answers that judge the worry", F("agrees", "ai", sc))];
      if (sp.row === "buyers") fig.push(Fg("Told to go ahead", F("go_ahead", "ai", sc)), Fg("Told to avoid", F("steer_clear", "ai", sc)), Fg("No side taken", F("buyer_no_side", "ai", sc)));
      else fig.push(Fg("Told to stay", F("stay", "ai", sc)), Fg("Told to leave", F("leave", "ai", sc)), Fg("No side taken", F("customer_no_side", "ai", sc)));
      const top = (sel.selection("sent_brands", "ai", sc).members as SelMember[])[0];
      if (top) fig.push(Fg(`${top.name} offered as the exit`, F("sent_to", top.key, sc)));
      sp.figures = [...(sp.figures ?? []), ...fig];
    }
  }
  {
    for (const sp of specs.filter((x) => x.row === "value")) {
      const sc = sp.scope;
      const pooledV = sp.pooled || (sp.wide && !specs.some((x) => x.row === "value" && x !== sp));
      sp.figures = [
        ...(sp.figures ?? []),
        ...(pooledV
          ? [Fg("Worth it", F("worth_yes", "ai", sc)), Fg("It depends", F("worth_depends", "ai", sc)), Fg("Not worth it", F("worth_no", "ai", sc))]
          : [Fg("Worth it", F("worth_yes", "ai", sc)), Fg("Not worth it", F("worth_no", "ai", sc)), Fg("Says it depends", F("worth_depends", "ai", sc))]),
        // Ruling 3: of every price answer, one bucket each.
        Fg("Points to a rival instead", F("instead_rival", "ai", sc)),
        ...(set.ladder ? [Fg("Points to only its own cheaper option", F("instead_own", "ai", sc))] : []),
      ];
    }
  }
  {
    const criteriaAll = pooledId("chooses:criteria:");
    const csp = criteriaAll ? specOf(criteriaAll) : undefined;
    if (csp && inputs.taught.length) {
      const figs: Figure[] = [];
      if (inputs.taught.length) figs.push({ label: "Most often taught", value: listVal(inputs.taught.slice(0, 8).map((t) => `${t.code} ${pw(t.rate)}`)) });
      const lift = summary.reasonLift;
      const top5 = new Set(inputs.taught.slice(0, 5).map((t) => t.code));
      for (const l of [lift[0], ...lift.filter((x) => top5.has(x.code) && x.lift < 0)].filter(Boolean))
        figs.push({ label: `${l.code}: how much more often it comes up when ${brand} is picked than when another brand is`, value: pd("diff_signed", [l.wins, l.others]), tip: `${tipC(l.wins)} picks; ${tipC(l.others)} other picks` });
      addFigs(criteriaAll, figs);
    }
    // Spotting the problem: ruling 5 - answers pointing to something adjacent, of every answer.
    const awPooled = pooledId("chooses:awareness:");
    for (const sp of specs.filter((x) => x.row === "awareness" && (specId(x) === awPooled || !!x.scope.situation))) {
      const figs: Figure[] = [Fg("Problem questions answered outside the category", F("routed_adjacent", "ai", sp.scope))];
      const room = sp.scope.situation;
      if (room && roomsIn(PRB).length >= 2) {
        const rest = F("routed_adjacent", "ai", { ...PRB, when: `!sit:${encodeURIComponent(room)}&!sit:~none` });
        if (rest.n > 0) figs.push(Fg("The same, for the other buying situations", rest));
      }
      addFigs(specId(sp), figs);
    }
    {
      const adv = specs.find((x) => x.band === "settled" && x.key === "advocacy");
      const bc = specs.find((x) => x.band === "settled" && x.key === "business case");
      const pid = pooledId("settled:settled:");
      if (adv) addFigs(pid, [Fg("Asked to defend it: strengthens the case", F("relationship_strengthens", "ai", adv.scope)), Fg("Asked to defend it: a strong case", F("case_strong", "ai", adv.scope)), ...(objectionsAgree.n > 0 ? [Fg("Agrees with buyers' worries, asked neutrally", objectionsAgree)] : [])]);
      else if (bc) addFigs(pid, [Fg("Asked for a business case: a strong one", F("case_strong", "ai", bc.scope))]);
    }
    for (const sp of specs.filter((x) => x.band === "settled" && !x.pooled)) {
      const sc = sp.scope;
      const figs: Figure[] = [Fg("Strengthens the relationship", F("relationship_strengthens", "ai", sc)), Fg("Weakens it", F("relationship_weakens", "ai", sc))];
      if (sp.key === "advocacy" || sp.key === "business case") figs.push(Fg("Makes a strong case", F("case_strong", "ai", sc)));
      if (sp.key === "advocacy" && objectionsAgree.n > 0) figs.push(Fg("Agrees with buyers' worries, asked neutrally", objectionsAgree));
      addFigs(specId(sp), figs);
    }
  }

  /* -- per-cell lifts, brands and exceptions (what the cards read before they are built) -- */
  const refRows = (rows: PoolRow[]) => receiptsOf(rows);
  /** One cell's lift list (MAP_FLOORS): an argument's share among the wins against among the others, each its own
   * fact on the cell's scope. */
  const liftsOf = (sc: Scope, wins: string, others: string): LiftItem[] => {
    const wn = F("slice_share", `ai/slice:${andArgs(wins)}`, sc);
    const on = F("slice_share", `ai/slice:${andArgs(others)}`, sc);
    if (wn.k < LIFT_MIN || on.k < LIFT_MIN) return [];
    const both = `${andArgs(wins)}|${andArgs(others)}`;
    const total = wn.k + on.k;
    const codes = [...new Set(book.rows(sc).flatMap((f) => f.args ?? []))].sort();
    return codes
      .map((code) => {
        const inc = F("argues", `ai/arg:${code}`, { ...sc, when: both });
        if (inc.k / total < LIFT_MIN_INCIDENCE) return null;
        const wc = F("argues", `ai/arg:${code}`, { ...sc, when: andArgs(wins) });
        const oc = F("argues", `ai/arg:${code}`, { ...sc, when: andArgs(others) });
        return { label: code, value: Math.round((rate(wc) - rate(oc)) * 100), ...liftShares({ wins: wc, others: oc }), _w: wc, _o: oc };
      })
      .filter((l): l is NonNullable<typeof l> => !!l && l.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label))
      .slice(0, LIFT_TOP)
      .map(({ _w, _o, ...l }) => {
        const refs = liftRefs(l.label, _w, _o);
        return refs.length ? { ...l, receipts: refs } : l;
      });
  };
  /** One answer per side arguing the code: the first of each side's own fact's answers, on different engines. */
  const liftRefs = (code: string, w: FactCell, o: FactCell): AnswerRef[] => {
    const first = (c: FactCell) => {
      const p = parseFactId(c.id);
      return book.answers(p.measure, p.subject, p.scope).hit.map((f) => rf.rowById.get(f.responseId)!).filter(Boolean);
    };
    const ws = first(w);
    const os = first(o);
    const a = ws[0];
    const b = os.find((r) => r !== a && (!a || r.model !== a.model)) ?? os.find((r) => r !== a);
    return [a, b].filter((r): r is PoolRow => !!r).map((r) => ({ responseId: r.code.response_id, find: code }));
  };
  const pooledOpenLifts = (selected: LiftItem[]): LiftItem[] => {
    const rl = summary.reasonLift;
    if (!rl.length) return selected;
    const first = rl[0];
    const last = rl[rl.length - 1];
    const taughtTop = new Set(inputs.taught.slice(0, 5).map((t) => t.code));
    const cited = [first.code, last.code, ...rl.filter((l) => taughtTop.has(l.code) && l.lift < 0).map((l) => l.code)];
    const byCode = new Map(rl.map((l) => [l.code, l]));
    const own = new Map(selected.map((x) => [x.label, x]));
    const items: LiftItem[] = [];
    for (const code of [...new Set([...selected.map((x) => x.label), ...cited])]) {
      const l = byCode.get(code);
      if (!l) {
        const x = own.get(code);
        if (x) items.push(x);
        continue;
      }
      const refs = liftRefs(code, l.wins as FactCell, l.others as FactCell);
      items.push({ label: code, value: (l.lift < 0 ? -1 : 1) * Math.round(Math.abs(l.lift) * 100), ...liftShares(l), ...(refs.length ? { receipts: refs } : {}) });
    }
    return items.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label));
  };
  /** One brand's funnel inside one contest (the rival panel's lead read). */
  const brandRead = (sc: Scope, key: string): BrandRead => {
    const s0 = sub(key);
    const nC = F("named", s0, sc);
    const rC = F("recommended", s0, sc);
    const pC = F("picked", s0, sc);
    const cC = F("converts", s0, sc);
    const refs = (c: FactCell) => refsFor(rf, c.id, RECEIPTS);
    const nr = refs(nC);
    const rr = refs(rC);
    const pr = refs(pC);
    return {
      named: pw(nC),
      recommended: pw(rC),
      picked: pw(pC),
      converts: pw(cC),
      tips: { named: tipC(nC), recommended: tipC(rC), picked: tipC(pC), converts: tipC(cC) },
      refs: { ...(nr.length ? { named: nr } : {}), ...(rr.length ? { recommended: rr } : {}), ...(pr.length ? { picked: pr } : {}) },
    };
  };
  /** A rival inside one contest: its funnel, the arguments when it is picked, and the conditions that send buyers to it
   * there (the card's own away rows for that rival - the run's one grouping, shares of all the contest's answers). */
  const rivalHere = (sc: Scope, key: string): RivalHere => {
    const out: RivalHere = { read: brandRead(sc, key), sends: [] };
    const compare = liftsOf(sc, `pick:${key}`, "pick:you");
    if (compare.length) {
      out.argsMode = "compare";
      out.args = compare;
    } else {
      const base = F("slice_share", `ai/slice:pick:${key}&args`, sc);
      if (base.k >= ARGS_MIN) {
        const codes = [...new Set(book.rows({ ...sc, when: `pick:${key}&args` }).flatMap((f) => f.args ?? []))];
        const argRows = codes
          .map((code) => ({ code, c: F("argues", `ai/arg:${code}`, { ...sc, when: `pick:${key}&args` }) }))
          .sort((a, b) => b.c.k - a.c.k || a.code.localeCompare(b.code))
          .slice(0, ARGS_TOP)
          .map(({ code, c }) => ({ label: code, share: pw(c), receipts: refsFor(rf, c.id, 2).map((r) => ({ ...r, find: code })) }));
        if (argRows.length) {
          out.argsMode = "alone";
          out.argsRows = argRows;
        }
      }
    }
    const rows = book.rows(sc).some((f) => f.conds !== null) ? (sel.selection("conditions_shown", "ai", sc, { side: "away", flavor: rf.themed ? "themed" : "group", to: key }).members as unknown as { label: string; units: string[]; raw?: string }[]) : [];
    if (rows.length) {
      const items = rows.map((m) => {
        const c = F("cond_share", `ai/cond:${[...m.units].sort().join("+")}>to:${key}`, sc);
        return { m, c };
      }).filter((x) => x.c.k > 0);
      out.sends = items.slice(0, COND_TOP).map(({ m, c }) => {
        const receipts = refsFor(rf, c.id, 2);
        return { text: m.label, n: c.k, share: pw(c), ...(isWallWording([m.raw ?? m.label], brand) ? { wall: true } : {}), ...(receipts.length ? { receipts } : {}) };
      });
      if (items.length) {
        const all = F("cond_share", `ai/cond:${[...new Set(items.flatMap((x) => x.m.units))].sort().join("+")}>to:${key}`, sc);
        out.sendsShare = pw(all);
      }
      if (rf.themed) out.sendsThemes = out.sends.slice(0, SENDS_THEME_TOP).map((x) => ({ label: x.text, share: x.share ?? "", buckets: [], ...(x.wall ? { wall: true } : {}), ...(x.receipts ? { receipts: x.receipts } : {}) }));
    }
    return out;
  };
  /** The arguments block when the two-sided lift is absent. */
  const argsBlock = (sc: Scope, lifts: LiftItem[]): { mode?: ArgsMode; rows?: ArgsRow[] } => {
    if (lifts.length) return { mode: "compare" };
    const tallyOf = (when: string): ArgsRow[] => {
      const codes = [...new Set(book.rows({ ...sc, when }).flatMap((f) => f.args ?? []))];
      return codes
        .map((code) => ({ code, c: F("argues", `ai/arg:${code}`, { ...sc, when }) }))
        .sort((a, b) => b.c.k - a.c.k || a.code.localeCompare(b.code))
        .slice(0, ARGS_TOP)
        .map(({ code, c }) => ({ label: code, share: pw(c), receipts: refsFor(rf, c.id, 2).map((r) => ({ ...r, find: code })) }));
    };
    const rival = F("slice_share", "ai/slice:pick:other&args", sc);
    if (rival.k >= ARGS_MIN) {
      const out = tallyOf("pick:other&args");
      if (out.length) return { mode: "rival", rows: out };
    }
    const withA = F("slice_share", "ai/slice:args", sc);
    const kind = book.rows({ ...sc, when: "args" })[0]?.argsKind;
    const all = withA.k >= ARGS_MIN ? tallyOf("args") : [];
    if (all.length) return { mode: kind === "topics" ? "topics" : "all", rows: all };
    return {};
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

  /* -- pass 1: verdicts, lifts, brands, exceptions, and the cards' inputs -- */
  type Pass = { s: CellSpec; id: string; verdict: CellVerdict; lean: number; lifts: LiftItem[]; brands?: PositionBrand[]; youShare?: string; youRead?: BrandRead; exception?: PositionException };
  const passes: Pass[] = [];
  const panelInputs = new Map<string, PanelCellInput>();
  for (const band of ["chooses", "fights", "doubts", "settled"] as BandSlug[])
    for (const rowSlug of ROW_ORDER[band])
      for (const s of specs.filter((x) => x.band === band && x.row === rowSlug && x.rows.length > 0)) {
        const id = `${band}:${rowSlug}:${s.key}`;
        const { verdict, lean } = s.verdictOverride ?? classify(s.you.k, s.them.k, s.you.n);
        let lifts = s.lifts ?? (s.lift ? liftsOf(s.scope, s.lift.wins, s.lift.others) : []);
        if (id === "chooses:open:all") lifts = pooledOpenLifts(lifts);
        let brands: PositionBrand[] | undefined;
        let youShare: string | undefined;
        let youRead: BrandRead | undefined;
        if (PICK_ROWS.has(rowSlug)) {
          const list = (sel.selection("pick_brands", "ai", s.scope).members as SelMember[]).filter((b) => b.count >= BRAND_FLOOR);
          if (list.length >= 2) {
            brands = list
              .filter((b) => b.key !== targetKey)
              .slice(0, BRANDS_TOP)
              .map((b) => {
                const c = F("share_of_picks", b.key, s.scope);
                return { name: b.name, share: pw(c), proof: refRows(hitRows("share_of_picks", b.key, s.scope).filter((r) => quoteOf(r))).slice(0, BRAND_PROOF), here: rivalHere(s.scope, b.key) };
              });
            youShare = pw(F("share_of_picks", "you", s.scope));
            youRead = brandRead(s.scope, targetKey);
          }
        }
        // Lost, with an exception: the card's own "Who it still sends to you" rows - shares of the answers that pick the rival.
        let exception: PositionException | undefined;
        if (rowSlug === "h2h" && s.key !== "all" && verdict === "theirs" && s.them.k >= EXC_MIN_LOST) {
          // The card's own exception step: answers that pick the rival stating a condition row for you (the card's
          // grouping, the default clause left out).
          const any = F("slice_share", `ai/slice:cond:toward:${rf.themed ? "theme" : "group"}`, { ...s.scope, when: "pick:rival" });
          const exRows = cardCondRows(rf, data, s.scope, "toward", "pick:rival");
          if (rate(any) >= EXC_MIN_SHARE && exRows.length) {
            const rival = s.taker.name;
            exception = {
              rival,
              lostShare: pw(any),
              lostRate: rate(any),
              tip: `${any.k} of ${any.n} answers that pick ${rival} still state a case for ${brand}`,
              rows: exRows.slice(0, EXC_ROWS).map((row) => {
                const refs = refsFor(rf, row.share.id, 3).map((r) => ({ ...r, picked: rival }));
                return { text: row.label, share: pw(row.share), ...(row.wall ? { wall: true as const } : {}), ...(refs.length ? { refs } : {}), tip: `${row.share.k} of ${row.share.n} answers that pick ${rival}` };
              }),
            };
          }
        }
        passes.push({ s, id, verdict, lean, lifts, brands, youShare, youRead, exception });
        const kind = panelKindOf(id);
        if (kind) {
          const cellIntents = new Set(s.rows.map((r) => r.intent.id));
          panelInputs.set(id, {
            id,
            kind,
            row: rowSlug,
            key: s.key,
            label: s.label,
            pooled: !!s.pooled,
            rows: s.rows,
            you: sliceRows(s.youSlice, s.scope),
            them: sliceRows(s.themSlice, s.scope),
            cellIntents,
            ...(rowSlug === "h2h" && s.key !== "all" ? { rivalKey: s.rivalKey, rivalName: s.label } : {}),
            ...(rowSlug === "leavers" && s.rivalKey ? { rivalKey: s.rivalKey, rivalName: s.label } : {}),
            ...(exception ? { exception } : {}),
            lifts,
            ...(brands && brands.length ? { brands } : {}),
            ...(rowSlug === "value" ? { line: s.line ?? null } : {}),
            ...(rowSlug === "buyers" || rowSlug === "customers" ? { concern: s.label } : {}),
          });
          if (debug) (debug.panelCells ??= {})[id] = s.rows.map((r) => r.code.response_id);
        }
      }

  /* -- the cards (panel_build.ts), after every cell exists so each card can read its row's All card -- */
  const panels = new Map<string, PositionPanel>();
  let rivalPanels: RivalAcross[] = [];
  {
    const targetEntry = resolve(brand).entry;
    const scopes = scopeSentences(project.taxonomy_proposal);
    {
      const LABEL_KINDS: Partial<Record<PanelKind, "buyer" | "customer">> = { popular: "buyer", learning: "buyer", alongside: "customer", critic: "customer", expansion: "customer", business_case: "customer" };
      const asks: LabelAsk[] = [];
      for (const inp of panelInputs.values()) {
        const who = LABEL_KINDS[inp.kind];
        if (!who) continue;
        const it = [...new Map(inp.rows.map((r) => [r.intent.id, r.intent])).values()].sort((a, b) => a.seq - b.seq)[0];
        if (!it?.text?.trim()) continue;
        if (inp.kind === "critic" && it.concern?.trim()) inp.criticism = it.concern.trim();
        asks.push({ id: inp.id, seed: it.text, who, ...(inp.kind === "critic" && it.concern?.trim() ? { criticism: it.concern.trim() } : {}) });
      }
      if (asks.length) {
        const forms = new Set<string>([brand, ...(targetEntry ? [targetEntry.canonical, targetEntry.display_name ?? "", ...targetEntry.aliases] : [])].filter((x) => x.trim().length >= 2));
        const others = new Set<string>();
        for (const e of data.dictionary) if (e.status === "active" && e.id !== targetEntry?.id) for (const f of [e.canonical, e.display_name ?? ""]) if (f.trim().length >= 2 && !forms.has(f)) others.add(f);
        const ql = await questionLabels(asks, { projectId: project.id, brand, category: project.category, noun: product, brandForms: [...forms], otherBrands: [...others], meta: { brand, category: project.category, projectId: project.id } });
        if (ql.incomplete) data.judgeIncomplete = true;
        for (const a of asks) {
          const inp = panelInputs.get(a.id);
          if (inp) inp.asked = ql.asked.get(a.id);
        }
      }
    }
    const brandTokens = new Set<string>(famTokens(brand));
    if (targetEntry) {
      for (const f of [targetEntry.canonical, targetEntry.display_name ?? ""]) for (const t of famTokens(f)) brandTokens.add(t);
      for (const a of targetEntry.aliases) {
        const t = famTokens(a);
        if (t.length === 1) brandTokens.add(t[0]);
      }
    }
    const intentText = new Map(data.intents.map((i) => [i.id, i.text]));
    const omissions: NonNullable<AnalysisMapDebug["panelOmissions"]> = [];
    const pickOf = (row: PoolRow) => {
      const c = row.code;
      if (c.outcome === "pick" && c.top_pick) {
        const r = resolve(c.top_pick);
        return { status: r.status, key: r.key, name: r.name };
      }
      return { status: "none", key: null, name: null };
    };
    const recommendsOf = (row: PoolRow) => {
      const out = new Map<string, string>();
      for (const m of row.code.mentions ?? []) if (m.framing === "recommended") {
        const r = resolve(m.brand);
        if (r.status === "active") out.set(r.key, r.name);
      }
      return out;
    };
    const panelHelpers: Parameters<typeof buildPanels>[1] = {
      brand,
      targetKey,
      category: project.category,
      noun: product,
      plural: pluralNoun(project.category),
      resolve,
      pickOf,
      recommendsOf,
      namesTarget: (row) => (row.code.mentions ?? []).some((m) => resolve(m.brand).key === targetKey) || pickOf(row).key === targetKey,
      quoteOf,
      brandSplit: () => ({ n: 0, list: [] }),
      activeDests: (list) => {
        const out = new Map<string, string>();
        for (const d of list ?? []) {
          const r = resolve(d);
          if (r.status === "active" && r.key !== targetKey) out.set(r.key, r.name);
        }
        return out;
      },
      productOf: (card) => {
        const c = card.trim();
        if (!c || resolve(c).key !== targetKey) return null;
        return famTokens(c).some((t) => !brandTokens.has(t)) ? c : null;
      },
      valueFacts: new Map(),
      headline: [...rf.rowById.values()],
      reasonLift: summary.reasonLift,
      classKeys: new Set(classList.map((g) => g.key)),
      wordings: (ci, extra = []) => wordingIndex([...data.prompts.filter((p) => p.intent_id && ci.has(p.intent_id) && !p.staged && !p.retired).map((p) => p.text), ...[...ci].map((i) => intentText.get(i) ?? ""), ...extra]),
      scopes,
      omissions,
      facts: { set, book, sel, themed: rf.themed },
    };
    if (debug) debug.panelBuild = { inputs: panelInputs, helpers: panelHelpers };
    try {
      for (const [id, p] of buildPanels(panelInputs, panelHelpers)) panels.set(id, p);
      rivalPanels = buildRivalAcross(panelInputs, panels, panelHelpers, summary.brands.filter((b) => b.key !== summary.target.key && b.mentioned.k > 0).map((b) => ({ key: b.key, name: b.name })));
    } catch (e) {
      // A coding error the fact layer refuses (ruling 1) must not take the Map down: the cards are left without a panel.
      console.error(`[analysis_map] the fact-built cards failed for ${project.brand}:`, e);
    }
    if (debug) debug.panelOmissions = omissions;
  }

  /* -- pass 2: badges, positions (the conditions are the card's own rows) -- */
  const engineLabel = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));
  const bands: MapBand[] = [];
  const positions: Record<string, Position> = {};
  const cellById = new Map<string, MapCell>();
  const walls: WallProbe[] = [];
  const condItem = (c: PanelCondition, away: boolean): ConditionItem => ({
    text: c.text,
    n: knOf(c.share)?.k ?? 0,
    ...(c.wall ? { wall: true } : {}),
    share: c.share.value,
    ...(c.share.refs?.length ? { receipts: c.share.refs } : {}),
    ...(away && c.to?.length ? { routes: c.to.map((t) => ({ name: t.name, share: t.num.value })) } : {}),
  });
  const themeOf = (c: PanelCondition, away: boolean): DossierTheme => ({
    label: c.text,
    share: c.share.value,
    buckets: [],
    ...(c.wall ? { wall: true } : {}),
    ...(c.share.refs?.length ? { receipts: c.share.refs } : {}),
    ...(away && c.to?.length ? { routes: c.to.map((t) => ({ name: t.name, share: t.num.value })) } : {}),
  });
  for (const band of ["chooses", "fights", "doubts", "settled"] as BandSlug[]) {
    const rowsOut: MapRow[] = [];
    for (const rowSlug of ROW_ORDER[band]) {
      const inRow = passes.filter((p) => p.s.band === band && p.s.row === rowSlug);
      if (!inRow.length) continue;
      const cells: MapCell[] = [];
      for (const { s, id, verdict, lean, lifts, brands, youShare, youRead, exception } of inRow) {
        const panel = panels.get(id);
        const pc = panel?.conditions;
        const towardRows = pc?.toward ?? [];
        const awayRows = pc?.away ?? [];
        const badges: CellBadge[] = [];
        // Fixed situations: the card's top-3 away rows, possession-shaped.
        const wallRows: PanelCondition[] = [];
        awayRows.slice(0, 3).forEach((r, i) => {
          const n = knOf(r.share)?.k ?? 0;
          const isWall = n >= WALL_MIN && !!r.wall;
          if (isWall) wallRows.push(r);
          if (n >= WALL_MIN) walls.push({ cellId: id, label: r.text, n, rank: i + 1, wall: isWall, samples: [r.text] });
        });
        if (wallRows.length) badges.push("wall");
        if (s.leak && rate(s.leak) >= LEAK_SHARE) badges.push("leak");
        if (s.inhouse && rate(s.inhouse) >= INHOUSE_SHARE) badges.push("inhouse");
        // Watch: one assistant carries the brand side (each assistant's share of that side - one fact each).
        let engineWatch: { model: string; share: number; c: FactCell } | null = null;
        if (s.you.k >= WATCH_ENGINE_MIN) {
          const per = rf.engines.map((m) => ({ m, c: F("slice_share", `ai/slice:eng:${m}`, { ...s.scope, when: s.youSlice }) })).sort((a, b) => b.c.k - a.c.k || a.m.localeCompare(b.m));
          if (per[0] && rate(per[0].c) >= WATCH_ENGINE_SHARE) engineWatch = { model: per[0].m, share: rate(per[0].c), c: per[0].c };
        }
        if (engineWatch || s.settledWatch) badges.push("watch");

        const noteT = finish(s.note(verdict));
        const mapCell: MapCell = {
          id,
          label: s.label,
          verdict,
          note: noteT.text,
          badges,
          ...(s.wide ? { wide: true } : {}),
          ...(s.pooled ? { all: true } : {}),
          ...(exception ? { exception: true as const } : {}),
          n: s.rows.length,
          ...(noteT.nums.length ? { facts: { note: noteT.nums } } : {}),
        };
        cells.push(mapCell);
        cellById.set(id, mapCell);
        if (debug?.cells)
          debug.cells[id] = {
            band, row: rowSlug, label: s.label, verdict, lean,
            you: s.you.k, them: s.them.k, d: s.you.n, n: s.rows.length,
            taker: s.taker.name, takerKind: s.taker.kind,
            wall: wallRows[0]?.text ?? null,
            badges: [...badges],
            pooled: !!s.pooled,
            ...(s.rivalKey ? { rivalKey: s.rivalKey } : {}),
            ...(s.criteria?.winnerUntaught ? { criteriaWinner: s.criteria.winnerUntaught } : {}),
            youFact: s.you.id,
            themFact: s.them.id,
            override: !!s.verdictOverride,
          };

        /* -- the position -- */
        const inhouse = badges.includes("inhouse") && verdict !== "yours";
        const nothingToPush = !!s.criteria && !s.criteria.winnerUntaught && verdict !== "yours";
        const status: PositionStatus =
          verdict === "yours"
            ? engineWatch ? "watch" : "surplus"
            : (verdict === "theirs" || (verdict === "contested" && lean < 0)) && !nothingToPush
              ? inhouse ? "watch" : engineWatch ? "watch" : "deficit"
              : "watch";
        const topAway = awayRows[0];
        const topToward = towardRows[0];
        const tk = (r: PanelCondition | undefined) => knOf(r?.share)?.k ?? 0;
        const median = !!topAway && tk(topAway) >= 2 * tk(topToward) && (knOf(topAway.share)?.n ?? 0) > 0 && tk(topAway) / knOf(topAway.share)!.n >= 0.1;
        let triage: Triage;
        let why: string;
        const youS = s.you;
        const themS = s.them;
        const engineName = engineWatch ? engineLabel.get(engineWatch.model) ?? engineWatch.model : "";
        if (nothingToPush) {
          triage = "earned";
          why = s.criteria!.winnerTaught
            ? `${s.criteria!.winnerTaught} comes up more when you win and the AI already teaches it here - no winning argument is missing.`
            : "No argument here comes up more when you win - there is nothing measured to push into these answers yet.";
        } else if (verdict === "yours" || (status !== "deficit" && verdict === "contested" && lean > 0)) {
          if (s.settledWatch) {
            triage = "overclaimed";
            why = `Asked to defend ${brand}, the AI strengthens the case; asked neutrally about buyers' worries, it agrees with them in ${pw(objectionsAgree)}. The strength appears only when the asker stands on it.`;
          } else if (engineWatch) {
            triage = "overclaimed";
            why = `${engineName} supplies ${pw(engineWatch.c)} of your side of this cell - a read on one AI assistant would overstate the standing.`;
          } else {
            triage = "earned";
            why = verdict === "yours"
              ? `You hold ${pw(youS)} of the answers that take a side against ${pw(themS)} for ${s.taker.name}, clear of the noise.`
              : `You lead ${pw(youS)} to ${pw(themS)}, inside the noise - held, not won.`;
          }
        } else if (inhouse) {
          triage = "windfall";
          why = `Most of the price answers that point elsewhere point to ${brand}'s own cheaper option (${s.taker.name}) - a loss that stays in-house. Size how much steps down versus walks away.`;
        } else if (status === "deficit") {
          const vendors = [...new Set(rf.engines.map((m) => facetsOf(m).vendor))];
          const vd = vendors
            .map((v) => ({ b: F("slice_share", `ai/slice:${s.youSlice}`, { ...s.scope, vendor: v }).k, t: F("slice_share", `ai/slice:${s.themSlice}`, { ...s.scope, vendor: v }).k }))
            .filter((x) => x.b + x.t >= 5);
          const behind = vd.filter((x) => x.t > x.b).length;
          const ahead = vd.filter((x) => x.b > x.t).length;
          const conc = s.conceded;
          if (wallRows.length) {
            triage = "strategy_misfit";
            why = `What sends buyers away most here ("${wallRows[0].text}") is a situation the buyer is already in, not an argument - it can be worked around, not argued down.`;
          } else if (badges.includes("leak")) {
            triage = "strategy_misfit";
            why = `${pw(s.leak!)} of the picks here leave the category - the AI answers the buyer's job with something outside it.`;
          } else if (s.criteria) {
            triage = "proof_missing";
            why = s.criteria.winnerUntaught
              ? `${s.criteria.winnerUntaught} comes up more when you win but is missing from what the AI teaches here; it teaches ${s.criteria.taught.slice(0, 3).join(", ")}.`
              : `What the AI teaches here (${s.criteria.taught.slice(0, 3).join(", ")}) includes none of the arguments that come up more when you win.`;
          } else if (conc && conc.agree.n >= MIN_SIDE && rate(conc.agree) >= 0.5 && conc.goAheadOfAgreed.n >= MIN_SIDE && rate(conc.goAheadOfAgreed) >= 0.3) {
            triage = "proof_missing";
            why = `The AI agrees with the worry in ${pw(conc.agree)} and still says go ahead in ${pw(conc.goAheadOfAgreed)} of those - the go-ahead exists, the counter-evidence does not.`;
          } else if (behind >= 3 && ahead === 0) {
            triage = "product_truth";
            why = `The deficit holds on all ${behind} vendors with enough answers to read - consistent enough to read as how the product is, not how it is described.`;
          } else if (median) {
            triage = "strategy_misfit";
            why = `What sends buyers away ("${topAway.text}") comes up more than what brings them to you${topToward ? ` ("${topToward.text}")` : ""} - it describes more of the buyers than yours does.`;
          } else {
            triage = "proof_missing";
            why = `${s.taker.name} takes ${pw(themS)} of the answers that take a side ${youS.k === 0 ? "and you none" : `against your ${pw(youS)}`}, with no fixed situation, no picks leaving the category and no pattern across vendors behind it - the case the AI finds for you is what is missing.`;
          }
        } else if (verdict === "nocall") {
          triage = s.them.k > s.you.k && s.you.n > 0 ? "proof_missing" : "earned";
          why = s.you.n < MIN_SIDE ? `Too few answers take a side here to call it; ${triage === "earned" ? "nobody holds it against you" : `${s.taker.name} leads the few that do`}.` : `The answers here take no clear side.`;
        } else if (engineWatch) {
          triage = "overclaimed";
          why = `${engineName} supplies ${pw(engineWatch.c)} of your side of this cell - read it assistant by assistant before acting.`;
        } else {
          triage = "earned";
          why = `The answers that take a side split ${pw(youS)} to ${pw(themS)} - a live contest, not a loss.`;
        }

        const LEVER: Record<Triage, [string, string]> = {
          record_wrong: ["The facts the AI states here are out of date. Correct them in the sources the AI draws on.", "Fix the record"],
          proof_missing: [
            s.criteria?.winnerUntaught
              ? `When the AI teaches buyers what to look for, ${s.criteria.winnerUntaught} - an argument that comes up more when you win - is missing. Get it into the guides and explainers the AI draws on.`
              : s.conceded
                ? "The AI tells buyers to go ahead without answering the worry. Publish the evidence that answers it where the AI looks for it."
                : "The answers here make the rival's case and not yours. Publish the evidence for your side where the AI looks for it.",
            "Publish your case",
          ],
          strategy_misfit: [
            wallRows.length
              ? "Don't spend on arguing against this. Aim at the buyers it does not apply to."
              : badges.includes("leak")
                ? "Either cover everything this buyer needs, or decide to leave this buyer to others. Make that call before producing content."
                : "Either build a case that works for the typical buyer with no conditions attached, or accept being the specialist. What sends buyers away describes more buyers than what brings them to you.",
            "Choose where to compete",
          ],
          product_truth: ["Before writing anything, check whether the AI is right: compare what it says with your own data. If it is right, the fix is the product, not the content.", "Check the facts first"],
          earned: [
            nothingToPush
              ? "Nothing measured here is missing from what the AI teaches, so there is nothing to push into these answers yet. Keep the facts behind your winning arguments current."
              : "You hold this. Keep the proof behind it current and easy for the AI to find.",
            "Keep it",
          ],
          overclaimed: ["Treat this number as the best case, not your standing. Build the proof where buyers ask without being prompted.", "Back it up"],
          windfall: ["Find out how much of this demand moves to your own cheaper option and how much leaves altogether.", "Size the trade-down"],
        };
        const [lever, family] = LEVER[triage];

        // Conditions: the card's own rows (ruling 14: the run's one grouping, ruling 4: shares of all its answers).
        const toward = towardRows.map((r) => condItem(r, false));
        let away = awayRows.map((r) => condItem(r, true));
        const towardThemes = pc?.grouped && towardRows.length ? towardRows.map((r) => themeOf(r, false)) : undefined;
        const awayThemes = pc?.grouped && awayRows.length ? awayRows.map((r) => themeOf(r, true)) : undefined;
        // Both sides: the card's rows stated on the other side too (the run's one grouping), pick contests only.
        const bothWays: BothWaysItem[] = BOTH_ROWS.has(rowSlug)
          ? towardRows
              .filter((r) => r.both)
              .map((r) => ({ r, n: (knOf(r.share)?.k ?? 0) + (knOf(r.both!.either)?.k ?? 0) }))
              .sort((a, b) => b.n - a.n || a.r.text.localeCompare(b.r.text))
              .slice(0, BOTH_TOP)
              .map(({ r }) => ({
                text: r.text,
                towardShare: r.share.value,
                awayShare: r.both!.either.value,
                ...(r.share.refs?.length ? { towardRefs: r.share.refs } : {}),
                ...(r.both!.either.refs?.length ? { awayRefs: r.both!.either.refs } : {}),
              }))
          : [];
        if (!pc?.toward.length && !pc?.away.length && away.length === 0 && s.exitFallback?.length) away = s.exitFallback.map((x) => ({ text: `Sent to ${x.name}`, n: x.n }));

        const numerator = verdict === "yours" ? sliceRows(s.youSlice, s.scope) : verdict === "theirs" ? sliceRows(s.themSlice, s.scope) : verdict === "contested" ? sliceRows(`${s.youSlice}|${s.themSlice}`, s.scope) : s.rows;
        const args = argsBlock(s.scope, lifts);
        const notes: PositionNotes = {
          ...(wallRows[0] ? { wall: wallRows[0].text } : {}),
          ...(badges.includes("inhouse") ? { inHouse: true as const } : {}),
          ...(badges.includes("leak") ? { leak: true as const } : {}),
          ...(engineWatch ? { soft: "one_assistant" as const } : s.settledWatch ? { soft: "asked_for" as const } : {}),
        };
        const liftNote = s.liftNote ?? (lifts.length && s.lift ? s.lift.note : undefined);
        const where = `${s.rowLabel}${s.label ? ` · ${s.label}` : " · every buyer"}`;
        const taker = verdict === "yours" ? { name: "Nobody", kind: TAKER.nobody } : s.taker;
        const sideFigs: Figure[] = sidesFigures(rowSlug, s.you, s.them, s.youAll, s.taker.name, rowSlug === "h2h" && s.key === "all");
        const figures = dedupeFigures([...sideFigs, ...(s.figures ?? [])]);
        const claimT = finish(extremeWords(s.claim(verdict)));
        const whyT = finish(extremeWords(why));
        const facts: Record<string, StmtNums> = {};
        if (claimT.nums.length) facts.claim = claimT.nums;
        if (whyT.nums.length) facts.triageWhy = whyT.nums;
        const figsOut = figures.map((f, i) => {
          const v = finish(f.value);
          if (v.nums.length) facts[`figures.${i}`] = v.nums;
          return { ...f, value: v.text };
        });
        const liftsOut = lifts.map((l) => ({ ...l, label: finish(l.label).text }));
        // The exception's figures are statements too (the card's own exception step and rows).
        let exceptionOut = exception;
        if (exception) {
          const ls = finish(exception.lostShare);
          if (ls.nums.length) facts["exception.lostShare"] = ls.nums;
          exceptionOut = {
            ...exception,
            lostShare: ls.text,
            rows: exception.rows.map((r, i) => {
              const sh = finish(r.share);
              if (sh.nums.length) facts[`exception.rows.${i}`] = sh.nums;
              return { ...r, share: sh.text };
            }),
          };
        }
        positions[id] = {
          cellId: id,
          where,
          claim: claimT.text,
          taker: taker.name,
          takerKind: taker.kind,
          status,
          triageSuggested: triage,
          triageWhy: whyT.text,
          lifts: liftsOut,
          ...(liftNote ? { liftNote } : {}),
          ...(liftsOut.length ? { liftSides: s.lift?.sides ?? (["your picks", "rivals' picks"] as [string, string]) } : {}),
          toward,
          away,
          ...(bothWays.length ? { bothWays } : {}),
          ...(towardThemes ? { towardThemes } : {}),
          ...(awayThemes ? { awayThemes } : {}),
          receipts: receiptsOf(numerator.length ? numerator : s.rows),
          lever,
          family,
          ...(figsOut.length ? { figures: figsOut } : {}),
          ...(brands && brands.length ? { brands, youShare, ...(youRead ? { youRead } : {}) } : {}),
          ...(args.mode ? { argsMode: args.mode } : {}),
          ...(args.rows ? { argsRows: args.rows } : {}),
          ...(Object.keys(notes).length ? { notes } : {}),
          ...(exceptionOut ? { exception: exceptionOut } : {}),
          ...(Object.keys(facts).length ? { facts } : {}),
        };
        // Sub-blocks printed from facts whose positions are not recorded (brands, a rival's read, the exception, the
        // arguments rows): plain text only.
        positions[id] = { ...stripDeep(positions[id]), ...(panel ? { panel } : {}) };
      }
      rowsOut.push({ stage: inRow[0].s.rowLabel, cells });
    }
    if (rowsOut.length) bands.push({ ...BAND_META[band], rows: rowsOut });
  }

  /* -- casting -- */
  const facts = castingFacts(summary, F("slice_share", "ai/slice:rec:you", { ...WTB_S, when: "pick:other" }));
  const casting = castingLine(facts, brand);
  if (debug) {
    debug.walls = walls;
    debug.casting = facts;
  }

  /* -- dots + share of picks (the picks board): every row a fact -- */
  const t = summary.target;
  const others = summary.brands.filter((b) => b.role !== "target" && b.chosen.k > 0);
  const shown = others.slice(0, 3);
  const restC = F("slice_share_of_picks", `ai/slice:pick:in_analysis&!pick:you${shown.map((b) => `&!pick:${b.key}`).join("")}`, WTB_S);
  const refsOfC = (c: RateCell) => (isFactCell(c) ? refsFor(rf, c.id) : []);
  const withR = (refs: AnswerRef[]) => (refs.length ? { refs } : {});
  const shareOfDecided: AnalysisMapView["shareOfDecided"] = [
    ...[...shown.map((b) => ({ brand: b.name, you: false, share: b.shareOfDecided, ...withR(refsOfC(b.shareOfDecided)) })), { brand, you: true, share: t.shareOfDecided, ...withR(refsOfC(t.shareOfDecided)) }].sort((a, b) => b.share.k - a.share.k || a.brand.localeCompare(b.brand)),
    ...(restC.n > 0 && rate(restC) >= 0.05 ? [{ brand: "Others", you: false, share: restC, ...withR(refsFor(rf, restC.id)) }] : []),
  ];
  const examples = { named: refsOfC(t.mentioned), commits: refsOfC(summary.firmPickInCategory) };

  /* -- tensions -- */
  const probe = debug ? { insights: debug.probeInsights ?? summary.insights, out: [] as NonNullable<AnalysisMapDebug["placements"]> } : undefined;
  const placed: { key: string; title: string; cellId: string }[] = [];
  const tensions = tensionsOf(summary, facts, specs, cellById, brand, probe, placed, positions, rf);
  if (debug && probe) debug.placements = probe.out;

  /* -- honesty line: map answers on the core panel with no code row (not a measure: a fact exists only for a coded
   * answer) -- */
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

  /** The brands in analysis a scope's answers name (a selection of whom to look up). */
  function summaryBrandsIn(sc: Scope): { key: string; name: string }[] {
    const out = new Map<string, string>();
    for (const f of book.rows(sc)) for (const b of f.brands) if (b.bucket === "in_analysis" && !out.has(b.key)) out.set(b.key, b.key === targetKey ? brand : b.name);
    return [...out.entries()].map(([key, name]) => ({ key, name }));
  }

  return {
    casting,
    dots: { named: t.mentioned, picked: t.chosen, commit: summary.firmPickInCategory },
    examples,
    shareOfDecided,
    tensions,
    bands,
    positions,
    uncoded,
    insightCells: placed,
    ...(rivalPanels.length ? { rivalPanels } : {}),
  };
}

/** A slice with the "answers carrying arguments" term on each of its OR branches. */
const andArgs = (slice: string) => slice.split("|").map((b) => `${b}&args`).join("|");

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

/** am31: which panel a cell draws (PANEL_BUILD_SPEC section 0); null = the old panels. */
function panelKindOf(id: string): PanelKind | null {
  const [band, row, ...rest] = id.split(":");
  const key = rest.join(":");
  if (band === "chooses" && row === "open") return "buy";
  if (band === "fights" && row === "h2h") return "h2h";
  if (band === "fights" && row === "leavers") return "switching";
  if (band === "doubts" && row === "buyers") return "buyer_worry";
  if (band === "doubts" && row === "customers") return "customer_worry";
  if (band === "doubts" && row === "hold") return "looking_around";
  if (band === "chooses" && row === "value") return "value";
  if (band === "chooses" && row === "awareness") return "problem";
  if (band === "chooses" && row === "criteria") return "criteria";
  if (band === "settled" && row === "settled" && key === "expansion") return "expansion";
  if (band === "settled" && row === "settled" && key === "business case") return "business_case";
  if (band === "chooses" && row === "social") return "popular";
  if (band === "chooses" && row === "explainer") return "learning";
  if (band === "settled" && row === "settled" && key === "ecosystem") return "alongside";
  if (band === "settled" && row === "settled" && key === "advocacy") return "critic";
  if (band === "chooses" && row === "premium") return "premium";
  if (band === "doubts" && row === "repertoire") return "habit";
  if (band === "settled" && row === "settled" && key === "all") return "settled_all";
  return null;
}

/** am15: the rows whose contest is a pick between brands (Position.brands). */
const PICK_ROWS = new Set(["open", "social", "premium", "leavers"]);

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

/** A cell's two sides in its own unit: the side facts (shares of the side-taking base) on the pick contests, the brand
 * side as a share of every answer elsewhere. */
function sidesFigures(row: string, you: FactCell, them: FactCell, youAll: FactCell | undefined, taker: string, pooledRivals = false): Figure[] {
  const themLabel = pooledRivals ? "The named rivals' share of the picks here" : `${taker}'s share of the picks here`;
  const tip = `${you.k} on your side, ${them.k} on ${pooledRivals ? "the named rivals'" : `${taker}'s`}, of ${you.n} that take a side`;
  const all = youAll ?? you;
  switch (row) {
    case "open":
    case "social":
    case "premium":
    case "leavers":
    case "h2h":
      return [
        { label: "Your share of the picks here", value: pw(you), tip },
        { label: themLabel, value: pw(them), tip },
      ];
    case "value":
      return [{ label: "Answers calling it worth it", value: pw(all), tip }];
    case "buyers":
      return [{ label: "Told to go ahead", value: pw(all), tip }];
    case "customers":
    case "hold":
      return [{ label: "Told to stay", value: pw(all), tip }];
    case "awareness":
    case "explainer":
      return [{ label: "Answers recommending you", value: pw(all), tip }];
    case "criteria":
      return [{ label: "Answers teaching an argument that wins for you", value: pw(all), tip }];
    case "repertoire":
      return [{ label: "Told to stick with you", value: pw(all), tip }];
    case "settled":
      return [{ label: "Strengthens the relationship", value: pw(all), tip }];
    default:
      return [{ label: "Your side", value: pw(you), tip }];
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

/* ------------------------------- casting ------------------------------- */

function castingFacts(s: BrandSummaryView, beside: FactCell): CastingFacts {
  const others = s.brands.filter((b) => b.role !== "target");
  const top = [...others].sort((a, b) => b.chosen.k - a.chosen.k || a.name.localeCompare(b.name))[0];
  const mostNamedOther = [...others].sort((a, b) => b.mentioned.k - a.mentioned.k)[0];
  const pooled = s.headToHeadAll as FactCell | undefined;
  const promptedN = pooled?.n ?? 0;
  return {
    shareYou: rate(s.target.shareOfDecided),
    shareTop: top ? rate(top.shareOfDecided) : 0,
    topName: top?.name ?? "",
    youTop: !top || s.target.chosen.k >= top.chosen.k,
    named: rate(s.target.mentioned),
    picked: rate(s.target.chosen),
    mostNamed: !mostNamedOther || s.target.mentioned.k >= mostNamedOther.mentioned.k,
    prompted: pooled && promptedN >= MIN_SIDE ? rate(pooled) : null,
    promptedN,
    beside: rate(beside),
    besideN: beside.n,
    rank: 1 + others.filter((b) => b.chosen.k > s.target.chosen.k).length,
    topTwo: rate(s.target.shareOfDecided) + (top ? rate(top.shareOfDecided) : 0),
    cells: {
      named: s.target.mentioned as FactCell,
      shareYou: s.target.shareOfDecided as FactCell,
      ...(top ? { shareTop: top.shareOfDecided as FactCell } : {}),
      ...(pooled && promptedN >= MIN_SIDE ? { prompted: pooled } : {}),
      beside,
    },
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
  const line = castingDraft(f, brand);
  const ct = finish(line.casting);
  const dt = finish(extremeWords(line.detail));
  const facts: Record<string, StmtNums> = {};
  if (ct.nums.length) facts.casting = ct.nums;
  if (dt.nums.length) facts.detail = dt.nums;
  return { ...line, casting: ct.text, detail: dt.text, ...(Object.keys(facts).length ? { facts } : {}) };
}

function castingDraft(f: CastingFacts, brand: string): CastingLine {
  const archetype = classifyArchetype(f);
  const c = f.cells;
  const named = c ? pw(c.named) : pctOf(f.named);
  const you = c ? pw(c.shareYou) : pctOf(f.shareYou);
  const top = c?.shareTop ? pw(c.shareTop) : pctOf(f.shareTop);
  const prompted = f.prompted !== null ? (c?.prompted ? pw(c.prompted) : pctOf(f.prompted)) : null;
  const beside = c ? pw(c.beside) : pctOf(f.beside);
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


function tensionsOf(
  s: BrandSummaryView,
  f: CastingFacts,
  specs: CellSpec[],
  cells: Map<string, MapCell>,
  brand: string,
  probe?: { insights: Insight[]; out: { key: string; kind: string; cellId: string | null; how: string }[] },
  placed?: { key: string; title: string; cellId: string }[],
  positions?: Record<string, Position>,
  rf?: RunFacts
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
  // am62: the move for a finding (finding_moves.ts), else the lever of the cell it is placed on.
  const moveFor = (key: string, names: MoveNames | undefined, cellId: string): AnalysisMapView["tensions"][number]["move"] => {
    const m = findingMove(key, names);
    if (m) return m;
    const p = positions?.[cellId];
    return { family: p?.family ?? "Keep it", text: p?.lever ?? "" };
  };
  {
    // The opening funnel paragraph: the What to buy card's own facts (ruling 7), each bar with its fact's answers.
    const T = s.target;
    const bar = (label: string, c: RateCell, text?: string, hi = false) => {
      const b = insightBar(label, c, text, hi);
      const r = finish(b.text);
      const ref = r.nums[0]?.[2];
      const refs = ref && rf ? refsFor(rf, ref) : [];
      return { ...b, text: r.text, ...(ref ? { fact: ref } : {}), ...(refs.length ? { refs } : {}), who: "you" as const };
    };
    const tt = finish(`Named in ${pw(T.mentioned)}, picked in ${pfine(T.chosen)}`);
    const bt = finish(
      `${brand} is named in ${pw(T.mentioned)} of answers when buyers ask what to buy. ${commitSentence(s.category, brand, s.firmPickInCategory, T.shareOfDecided, T.chosen)}${
        f.topName && !f.youTop && f.cells?.shareTop ? ` ${f.topName} is the pick ${pw(f.cells.shareTop)} of the time.` : ""
      }`
    );
    out.push({
      key: "known_vs_picked",
      title: tt.text,
      body: bt.text,
      // The pooled funnel paragraph anchors on the What to buy All cell itself.
      cellId: cells.has("chooses:open:all") ? "chooses:open:all" : openCells.length ? idOf(openCells[0]) : fallbackOpen,
      viz: [bar("Named", T.mentioned), bar("Recommended", T.recommended), bar("Picked", T.chosen, pfine(T.chosen), true)],
      move: findingMove("known_vs_picked", undefined)!,
      facts: { title: tt.nums, body: bt.nums },
    });
  }

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
  // am29: the contest (never a pooled All cell) whose away reasons state one
  // of the wordings the text quotes, by the largest share of that contest.
  const statedIn = (text: string): string | null => {
    if (!positions) return null;
    const norm = (t: string) => t.replace(/\.\.\.$/, "").replace(/\s+/g, " ").trim().toLowerCase();
    const quoted = [...text.matchAll(/"([^"]+)"/g)].map((m) => norm(m[1])).filter((q) => q.length >= 4);
    if (!quoted.length) return null;
    const says = (label: string) => {
      const l = norm(label);
      return quoted.some((q) => l === q || (q.length >= 20 && l.startsWith(q)));
    };
    let best: { id: string; share: number } | null = null;
    for (const x of splitCells) {
      const id = idOf(x);
      const p = positions[id];
      if (!p) continue;
      let share = 0;
      for (const t of p.awayThemes ?? []) {
        if (says(t.label) || t.buckets.some((b) => says(b.label) || b.members.some((m) => says(m.label)))) share = Math.max(share, parseFloat(t.share) || 0);
      }
      for (const c of p.away ?? []) if (says(c.text)) share = Math.max(share, parseFloat(c.share ?? "") || 0.1);
      if (share > 0 && (!best || share > best.share)) best = { id, share };
    }
    return best ? best.id : null;
  };
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
        if (key === "unasked_rival") {
          // bs23: never asked head to head, so no fight cell - an open-choice
          // cell the rival takes, else its own leavers' cell.
          const taken = longestMatch(text, openCells, (x) => x.taker.name) ?? longestMatch(text, splitCells.filter((x) => x.row === "leavers"), (x) => x.label);
          return found(taken ? idOf(taken) : null, strict, () => fallbackOpen);
        }
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
              : [...cust].sort((a, b) => b.them.k - a.them.k || idOf(a).localeCompare(idOf(b)))[0] ?? null;
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
        if (key === "argument_flip") {
          // am30: the all-buyers cell of the question type where the argument
          // goes against you (the foot names it second; the title names none).
          const t = text.toLowerCase();
          const rows: [string, string][] = [
            ["when rivals' customers ask where to switch it is the other way", "fights:leavers:"],
            ["in direct matchups it is the other way", "fights:h2h:"],
            ["when buyers ask what to buy it is the other way", "chooses:open:"],
          ];
          const row = rows.find(([phrase]) => t.includes(phrase));
          return found(row ? firstOf(row[1]) : null, strict, () => fallbackOpen);
        }
        if (key === "neutralized_differentiator") {
          // The rival that takes most of the losses, named in the body.
          const hit = longestMatch(text, splitCells.filter((x) => x.row === "h2h"), (x) => x.label);
          return found(hit ? idOf(hit) : null, strict, () => firstOf("fights:h2h:") ?? firstOf("chooses:criteria:") ?? fallbackOpen);
        }
        return firstOf("chooses:criteria:") ?? fallbackOpen;
      case "engine": {
        if (key === "vendor_outlier") {
          // am25: the question type its title names - that row's all-buyers cell.
          const t = text.toLowerCase();
          const row = [
            [ROW_NAME.customers, "doubts:customers:"],
            [ROW_NAME.buyers, "doubts:buyers:"],
            [ROW_NAME.hold, "doubts:hold:"],
            [ROW_NAME.leavers, "fights:leavers:"],
            [ROW_NAME.value, "chooses:value:"],
          ].find(([name]) => t.includes(name.toLowerCase()));
          return found(row ? firstOf(row[1]) : null, strict, () => fallbackOpen);
        }
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
        if (key === "assigned_exception") {
          // am27: the lost matchup where the exception comes up most - named in
          // the title (one matchup) or the body ("most of all against X");
          // the quoted condition is left out of the match.
          const h2h = splitCells.filter((x) => x.row === "h2h" && x.key !== "all");
          const named = /lose to (.+?) with one exception/.exec(text)?.[1] ?? /most of all against (.+?)[.;]/.exec(text)?.[1];
          const exact = named ? h2h.find((x) => x.label.toLowerCase() === named.trim().toLowerCase()) : undefined;
          const hit = exact ?? longestMatch(text.replace(/"[^"]*"/g, " "), h2h, (x) => x.label);
          return found(hit ? idOf(hit) : null, strict, () => firstOf("fights:h2h:") ?? fallbackOpen);
        }
        // Ruling 10: the away condition is the What to buy card's own row - the finding opens on that card.
        if (key === "away_condition" && cells.has("chooses:open:all")) return found("chooses:open:all", strict, () => null);
        // The away condition names where it routes; the rival's head-to-head
        // carries its conditions. Else a wall-badged cell, else the open choice.
        // am29: first the contest whose own away list states the quoted
        // condition with the largest share - the finding opens where it is
        // strongest, not on the general open-choice row.
        const stated = statedIn(text);
        if (stated) return found(stated, strict, () => null);
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
    out.push({
      key: ins.key,
      title: ins.title.charAt(0).toUpperCase() + ins.title.slice(1),
      body: ins.body,
      cellId,
      move: moveFor(ins.key, ins.names, cellId),
      ...(ins.viz ? { viz: ins.viz } : {}),
      ...(ins.matchup ? { matchup: ins.matchup } : {}),
      ...(ins.facts ? { facts: ins.facts } : {}),
    });
  }
  // am62: a sentence already said above on the page is said once - later findings carry `repeat`.
  {
    const said = new Set<string>();
    // The opening funnel paragraph is not a card on the Overview, so it never counts as said.
    for (const t of out) {
      if (t.key === "known_vs_picked") continue;
      if (said.has(t.move.text)) t.move = { ...t.move, repeat: true };
      said.add(t.move.text);
    }
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
export const ANALYSIS_MAP_VERSION = "am82"; // am82 (2026-11-17, fact layer step 5, part 2): a claim or triage reason that set a rival's share against "your 0%" says "and you none" (the Brief voices it "and <brand> none") - "<rival> takes every pick against your 0%" read oddly; no number, verdict or fact changes. // am81 (2026-11-17, fact layer step 5, part 1): every Map cell is a scope on the fact layer - the scope its card counts in - and its line, verdict, claim, figures, badges, lifts, brands, exception, casting, picks board and examples are statements over the run's facts (Position.facts / MapCell.facts / CastingLine.facts: where each number sits, with its fact id; the verdict reads classify on the two side facts). The Map's own condition grouping is retired (ruling 14): a cell's conditions, fixed situations, both-sides rows and median test are its card's own rows. Rulings that land: 7 (the all-buyers What to buy cell is discovery + use case), 2, 3 (Value claims and figures: shares of every price answer), 4, 5, 8, 9, 10 (the away-condition finding opens on the What to buy card), 12, 13, 14, 15. // am80 (2026-11-17, fact layer step 4, last slice): Spotting the problem, Learning the category, What to look for, the business case, expansion, What to use alongside you, Answering a critic and the settled All questions card are built from the run's facts and selections, and so is every By rival page (every step, bar, body, table, by-buyer row, condition row and argument) - every number carries its fact id, every list its selection id; the old card builders are deleted (a card the fact layer refuses is left without a panel). Rulings that land here: 5, 6, 7 (By rival What to buy conditions, arguments and products on the buyer cards' scope), 8, 14, 15 (one product grouping - the alongside pairings named first too) and the ratified competitor shape on Spotting the problem (by recommendations, floor 5) and Learning the category (by answers naming it, floor 3). // am79 (2026-11-17, fact layer step 4, third slice): the Value cards (each buyer and all buyers), both worries cards (each worry and all of them) and the looking-around card, their step explanations and the rival cards inside them, are built from the run's facts and selections - every number carries its fact id, every list its selection id; rulings 3 (each price answer in one "where it points the buyer instead" bucket), 8 (a brand outside of analysis is never listed or counted as where to go), 9, 14 (the looking-around condition rows on the run's one grouping) and 15 (every product list - your own cheaper options included - on the run's one product grouping, with full and short names; the product grouping keeps the model letter "a"). The competitor lists keep their own rule (the brands named as where to go / instead, 3 answers at least, top five). // am78 (2026-11-17, fact layer step 4, second slice): the head-to-head cards (a named rival, a class, all your named rivals - the lost-with-an-exception step included), What's popular, Premium vs basic and Habit, and the rival cards inside them, are built from the run's facts and selections - every number carries its fact id, every list its selection id; rulings 6, 8, 12 (a pick outside the category its own share), 13 (Premium vs basic: no stance its own share), 14 (one condition grouping - the Premium vs basic rows on the run's condition keys) and 15 (one product grouping; a product named but never picked is a product of its own on the lists of products named), and the ratified competitor shape ranked by recommendations on What's popular and Premium vs basic (head-to-head rivals tagged, an Other row with no bar, the average competitor every listed rival pooled). // am77 (2026-11-17, fact layer step 4, first slice): the What to buy cards (every buyer and all buyers) and the Rivals' customers switching cards are built from the run's facts and selections - every number carries its fact id, every list its selection id; rulings 7, 8, 12, 14, 15 and the ratified competitor group (with its Other row) land on them. // am76 (2026-11-17): the What to look for card carries its list of topics as data (checklist, never drawn) for the Brief to read. // am75 (2026-11-17, Tyler picked option A): each By rival page has a "What to buy - picked, of all answers" row (the rival beside you; the commit rate in its explanation). // am74 (2026-11-17): card lines and sentence spans carry optional stable keys (never drawn) so each number has an id by location. // am73 (2026-11-17): each By rival page has a "What to buy - named" row (the rival's named rate beside yours, with both recommended rates in its explanation) and its headline opens on that rate. // am72 (2026-11-17): the What to buy and switching cards open their lines with "The AI commits to one <noun>: In N% of answers" - the share of the cell's answers that name one in-category pick. // am71 (2026-11-17): a two-sided "What the answer weighs" row carries the other side's share of the same topic (drawn small beside it); a Value claim states where the AI points the buyer instead with the card's own figures (shares of all its answers), not shares of the doubts. // am70 (2026-11-17): the What to buy and switching cards state the average competitor's share of the picks beside yours, and a "Picked, of all answers" line (you and the average competitor). // am69 (2026-11-16): a Value cell's numbers state the "it depends" share (the Brief quotes it). // am68 (2026-11-16, Tyler): the What-to-look-for move is offered only on a cell that names a winning argument the AI seldom teaches there, and names it; a cell with none measured is watched, triage "Keep it" with its own lever (nothing measured to push). // am67 (2026-11-16): a brand the tracker asks about as a class ("a <brand> card") is never among a funnel card's competitors or in its average competitor. // am66 (2026-11-16): a buyer's What to look for cell reads the winning argument from that buyer's own what-to-buy answers; with too few picks it names none (it never borrows the all-buyers argument). // am65 (2026-11-16): Map claims and figures use the cards' words (the worry is fair, steer clear, what the AI tells buyers to look for). // am64 (2026-11-16): every Map cell's line follows one format - your number first, then the one thing it is set against, joined by " - ". // am62 (2026-11-16): each tension carries its key and a move written for the finding (finding_moves.ts; the cell's lever only as a fallback, repeats flagged), and every finding bar says whose number it is. // am61 (2026-11-16): the settled customers' All questions cell opens a small card - what the answer does for the relationship, and an index to the four questions under it (each opens its card). // am60 (2026-11-16): the Habit cell opens its own panel - stick with you or try something else, how often it suggests another brand (the brands suggested, who first, your own it suggests), stick with you if / try something else if, what each side weighs. // am59 (2026-11-16): the Premium vs basic cell opens its own panel - which end the AI sides with, the open-choice funnel, choose premium / choose basic conditions, who it names at each end, what each side weighs. // am58 (2026-11-16): the What to look for step carries which buyers are taught each winning topic off the checklist, which AI companies teach it (when they differ), how long the list is and which brands it names. // am57 (2026-11-16): the critic card's two steps explain themselves (strength: which AI companies, which rivals come up; premise: how strong the answer is when it grants the criticism, which AI companies side with the critic). // am56 (2026-11-16): the alongside card's step carries whose products the AI names, how many, which first and which AI companies name your own. // am55 (2026-11-16): the Map cells "Ecosystem" and "Advocacy" carry their cards' names ("What to use alongside you", "Answering a critic"). // am54 (2026-11-16): name variants of one product are one row in the step explanations' product lists (expansion, business case, learning, looking around). // am53 (2026-11-16): the business case card's step carries which AI companies give a confident case most, which of your products it is built on and which rivals come up (the "also points to" line is gone). // am52 (2026-11-16): the expansion card's step carries which of your products the AI backs, which AI companies back it most and where it points customers instead. // am51 (2026-11-16): the looking-around card's two steps explain themselves; "shows another" carries how long the list is, the rivals shown (moved from the block below), who is shown first, which products and your own. // am50 (2026-11-16): the worries cards' two steps explain themselves ("Agrees the worry is fair": the other judgements, the advice after agreeing, which worries, which AI companies). // am49 (2026-11-16): the exception step is tagged "The exception". // am48 (2026-11-16): a head-to-head lost with an exception carries an "exception" step (of the answers that pick the rival, how many still say when to choose you) whose explanation names who is still sent to you. // am47 (2026-11-16): the checklist table's last column is one bar per topic with a line where the checklist starts. // am46 (2026-11-16): the checklist table's last column is two short cells (share taught, and the word). // am45 (2026-11-16): What to look for - a topic off the checklist reads "seldom taught" with its share (or "never taught"), and the checklist and taught terms carry help text. // am44 (2026-11-16): the product test counts a rival's name that is only where a verdict sends the buyer at a higher bar (25% of the answers naming it), so a rival's points programme is no longer listed as one of its products. // am43 (2026-11-16): a name is listed as one of a brand's products only when some answer in the run picks it or it is a confirmed Value line (a programme or feature is named, never picked). // am42 (2026-11-16): a rival's card inside Value, the worries and looking around - no "you named" row (the question names you), Value sets the rival against you as the better option, and its weighs block is set against the cell's other answers. // am41 (2026-11-16): What's popular - the "names one pick" step explains itself (what the answer does instead, who gets the pick, which AI companies name one). // am40 (2026-11-16): a both-sides condition row's "also said for" figure is the other side's own share (it was the share saying it for either side). // am39 (2026-11-16): Value - "mostly names no cheaper option" needs 60%, about half reads as half and says which way the rest goes; the own-options list says it counts answers that also name a rival. // am38 (2026-11-16): Value's two steps explain themselves (details.worth / details.instead; the rivals named instead, the rival products and your own cheaper options move into the "where it points" explanation), Value names the product asked about (and an all-buyers cell asking about several carries a by-product table), and "What the answer weighs" is a sized block on every panel that showed it as a line; every non-panel Position field byte-identical. // am37 (2026-11-16): the six-reader panel audit fixes - "lose" / "gap" wording only when behind, tags agree with their numbers (3-point closeness, Level, Always, Split), no usual-comparison default detail on average-competitor panels, one own-cheaper share per Value panel, product names merged, possessives and articles, condition rows normalised, critic / criteria / worry headings agree with their bars; every non-panel Position field byte-identical. // am36 (2026-11-16): the verdict panels (Value, both worries, looking around, expansion, business case, critic, alongside, what to look for) tag each step with a one-line takeaway read off its own numbers (panel_tags.ts thresholds), the same in both views; their explanation is a heading and one sentence with no number the top bars draw (the usual said in words); the looking-around lead quotes its conditions without shares; the head-to-head default explanation carries no bar number. Every non-panel Position field byte-identical. // am35 (2026-11-16): a panel with no usual sets you against the average competitor with the switch off (PositionPanel.avgComp, step.usual = the listed competitors added up, "... the average competitor" tags, details against it); every step explanation is a heading, one sentence with no number the step bars draw, then only new facts (who takes the pick after recommending you as rows; converts keeps only "lose to another" and "no single pick"). Every non-panel Position field byte-identical. // am34 (2026-11-16): the question-type panels' steps explain themselves - PositionPanel.details / detailsComp (named, recommended, ends as the pick; head-to-heads: picks one of the two, who it picks), served through /cell_panel only; every non-panel Position field byte-identical. // am33 (2026-11-15): recompute only - buyer-question labels re-keyed (the asker is "they"). // am32 (2026-11-15): recompute only - buyer-question labels are rewritten under the no-you check (question_labels.ts); no compute change. // am31 (2026-11-15): the per-question-type panels - Position.panel on every cell of the eleven panel kinds (PANEL_BUILD_SPEC; panel_build.ts): claims, steps with "your usual" / rank / duel tags, conditions as shares of all the cell's answers, competitors and panel 11 rivals, every number with up to 3 example answers; the served map carries a panelStub per cell and /cell_panel serves one cell's panel from the same cached result. Every other Position field byte-identical; theme and condition-grouping inputs unchanged. // am30 (2026-11-13): the argument_flip insight (bs24) places on the all-buyers cell of the question type where the argument goes against you. // am29 (2026-11-13): the away-condition finding opens on the contest whose own away reasons state its quoted condition with the largest share (was: a rival named in the text, a fixed-tagged cell, else the general open-choice row). // am28 (2026-11-13): a grouped reason is tagged a fixed situation by its own NAME only, also when it has sub-rows (reason_themes) - a fixed member wording never tags the whole group. // am27 (2026-11-12): lost, with an exception - a head-to-head lost on balance with at least 20 lost answers, half of them still stating a case for you, carries Position.exception (the up-to-3 client-side conditions in the lost answers, themed when themes exist, with examples that picked the rival) and MapCell.exception; the assigned_exception insight (bs19) places on the lost matchup where its condition comes up most. // am26 (2026-11-12): both-ways rows whose wordings fall in the same reason theme on both sides are one row. // am25 (2026-11-12): the vendor_outlier insight (bs18) places on the all-buyers cell of the question type its title names. // am24 (2026-11-12): both-ways rows only on pick contests, each side at least 5% and half the other, top 3, never a reason paired with its opposite. // am23 (2026-11-12): an answer shown as an example toward you is never shown away; a rival's panel examples name only its own products in `to`. // am21 (2026-11-12): reason-row examples prefer answers that send the buyer one way only, then the wording closest to the row name, and each carries `to` (the product it sends the buyer to). // am20 (2026-11-12): each rival in a pick contest's `brands` carries `here` (its funnel in that contest, the arguments when it is picked beside your picks, the stated conditions sending picks to it) and the position carries `youRead` - the rival panel's lead read. Additive; theme inputs unchanged. // am19 am19 (2026-11-11): every Overview number opens its answers - `examples` (named, commits), refs on each share-of-picks row and on the tension bars (the first tension's funnel bars and the bs16 insight bars). // am18 (2026-11-10): each buying situation's open-choice cell states the same funnel figures as the all-buyers cell (named, recommended, commits, picked, outside the category), from its own answers. // // am17 (2026-11-10): each tension carries `viz` (the Overview finding card's 2-4 bars) - the first from the casting facts, the rest from the bs15 insights
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

/**
 * The map as the browser loads it (am31): every position's `panel` body is
 * left out and replaced by `panelStub` (its kind and which rivals carry a
 * panel), since a panel is read only when its slide-over opens and the
 * bodies would multiply the payload. The full result stays the one cached
 * compute; /cell_panel serves one cell's panel from that same result
 * (cellPanelOf). Never mutates `view` (it may be a shared, memoized object).
 */
export function slimAnalysisMap(view: AnalysisMapView): AnalysisMapView {
  const positions: AnalysisMapView["positions"] = {};
  for (const [id, p] of Object.entries(view.positions)) {
    if (!p.panel) {
      positions[id] = p;
      continue;
    }
    const { panel, ...rest } = p;
    positions[id] = { ...rest, panelStub: { kind: panel.kind, rivals: (panel.rivals ?? []).map((r) => ({ name: r.name, full: r.full })) } };
  }
  const { rivalPanels, ...restView } = view;
  return { ...restView, positions, ...(rivalPanels?.length ? { rivalStubs: rivalPanels.map((r) => r.name) } : {}) };
}

/** One rival across every question type (panel 15), read off the full map
 * result - the By rival tab's lazy load. Null when the rival carries none. */
export function rivalPanelOf(view: AnalysisMapView, name: string): RivalAcross | null {
  const n = name.trim().toLowerCase();
  return view.rivalPanels?.find((r) => r.name.toLowerCase() === n) ?? null;
}

/** One cell's panel (its rivals included) and its usual cell's steps, read
 * off the full map result - the slide-over's lazy load. */
export function cellPanelOf(view: AnalysisMapView, cellId: string): CellPanelPayload {
  const panel = view.positions[cellId]?.panel ?? null;
  const usualSteps = panel?.usualCellId ? view.positions[panel.usualCellId]?.panel?.steps : undefined;
  return { panel, ...(usualSteps ? { usualSteps } : {}) };
}
