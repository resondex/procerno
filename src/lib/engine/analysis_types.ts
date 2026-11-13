import type { RateCell } from "./view_data";
import type { DossierTheme } from "./reason_themes";

/**
 * The analysis tier's contract (2026-11-03, ANALYSIS_REDESIGN_2026-11-03.md,
 * ratified from the clickable prototype): the coverage map is BANDED BY WHAT
 * EACH CONTEST VARIES BY - buyer rooms, named rivals, confirmed worries,
 * settled-customer questions - so every cell is a real contest and blank
 * cells cannot occur. Each cell opens a POSITION: claim, taker, status with
 * a triage suggestion, the arguments and conditions behind it, receipts,
 * and a lever into the playbook. These types are shared by the map engine
 * (analysis_map.ts), the decision record (store + route) and the UI, so the
 * three stay on one shape.
 */

/** Who holds the cell. "nocall" is a verdict (the AI takes no side), never
 * missing data; thin cells (small n) also read nocall with the count in n. */
export type CellVerdict = "yours" | "contested" | "theirs" | "nocall";

/** wall: lost to a possession, not an argument (route around, don't
 * out-argue). leak: picks leave the category (B5). inhouse: caught by the
 * brand's own cheaper rung (value ownRung). watch: the number reads better
 * than the standing (asked-for advocacy, one-engine dependence). */
export type CellBadge = "wall" | "leak" | "inhouse" | "watch";

export interface MapCell {
  /** Stable id, also the position key and the decision-record key:
   * "<band>:<stage>:<key>" with key the room / rival / worry / question in
   * canonical form. Stable across waves so the portfolio can track it. */
  id: string;
  /** The contest's own name in the customer's vocabulary: the room (with
   * its Value line where one applies), the rival, the worry, the settled
   * question. Empty on a full-width cell whose row names it. */
  label: string;
  verdict: CellVerdict;
  /** One short line under the verdict word - plain words, percentages
   * allowed, raw counts stay in n (the tooltip). */
  note: string;
  badges: CellBadge[];
  /** Spans its whole row (rival leavers, holding your own, criteria). */
  wide?: boolean;
  /** The row's pooled roll-up cell (key "all"), rendered first with a divider
   * after it; set only when the row also carries split cells. */
  all?: boolean;
  /** am27: a head-to-head lost on balance whose position carries `exception`. */
  exception?: true;
  /** Answers behind the cell (the tooltip's denominator). */
  n: number;
}

export interface MapRow {
  stage: string;
  cells: MapCell[];
}

export interface MapBand {
  title: string;
  sub: string;
  rows: MapRow[];
}

/** The engine's read of what the brand IS to the AI, classified from
 * measured facts (share of decided vs top rival, the prompted-vs-open gap,
 * condition breadth). Sentences are templates filled with typed facts -
 * never generated prose. */
export type Archetype = "default" | "specialist" | "reference" | "challenger" | "companion";

export interface CastingLine {
  archetype: Archetype;
  /** The archetype as a heading, e.g. "The specialist". */
  heading: string;
  /** One italic sentence: how the AI casts the brand. */
  casting: string;
  /** One supporting sentence with the two or three numbers behind it. */
  detail: string;
}

export type Triage =
  | "record_wrong"
  | "proof_missing"
  | "strategy_misfit"
  | "product_truth"
  | "earned"
  | "overclaimed"
  | "windfall";

export const TRIAGE_LABEL: Record<Triage, string> = {
  record_wrong: "Record is wrong",
  proof_missing: "Proof is missing",
  strategy_misfit: "Strategy misfit",
  product_truth: "Product truth",
  earned: "Earned",
  overclaimed: "Overclaimed",
  windfall: "Windfall",
};

/** Deficit triage answers "is the AI right about you?"; surplus triage
 * answers "is the standing earned?" (the portfolio playbook's two sides). */
export const DEFICIT_TRIAGES: readonly Triage[] = ["record_wrong", "proof_missing", "strategy_misfit", "product_truth"];
export const SURPLUS_TRIAGES: readonly Triage[] = ["earned", "overclaimed", "windfall"];

export type PositionStatus = "deficit" | "surplus" | "watch";

export interface PositionReceipt {
  responseId: string;
  /** The code row's quote where one exists - the verdict's own receipt. */
  quote?: string;
}

/** am15 (the one-panel redesign, 2026-11-10): a pointer into one answer for
 * the panel's inline passages - the UI fetches the body lazily
 * (/api/runs/[id]/answer_bodies) and highlights `find` in it
 * (answer_passage.ts passageOf): the answer's own wording of a condition, a
 * code label, or the code row's quote. Never the body itself. */
export interface AnswerRef {
  responseId: string;
  find: string;
  /** am21: on a reason-row example, the product(s) this answer's rules under
   * the row send the buyer to - the modal's "Sent to" line. */
  to?: string;
  /** am27: on a "lost, with an exception" example, the brand the answer
   * actually picked - the modal's "Picked" line. */
  picked?: string;
}

/** am27 (2026-11-12): one condition the AI still gives for choosing you in a
 * head-to-head it hands to the rival. share = of the lost answers. */
export interface ExceptionItem {
  text: string;
  share: string;
  /** A situation the buyer is already in (the possession test). Set only when true. */
  wall?: true;
  /** Answers that picked the rival and state this condition toward you. */
  refs?: AnswerRef[];
  tip?: string;
}

/** am27: a head-to-head lost on balance where the AI still assigns you an
 * exception in at least half of the lost answers. */
export interface PositionException {
  /** The rival that wins the matchup. */
  rival: string;
  /** Share of the lost answers stating any condition toward you. */
  lostShare: string;
  /** Counts for the tooltip. */
  tip: string;
  rows: ExceptionItem[];
}

/** One brand's share of a pick contest (Position.brands). */
export interface PositionBrand {
  name: string;
  /** Its share of the in-category picks here - the same number the
   * "Share of the picks here, by brand" figure states. */
  share: string;
  /** Up to 3 quoted answers where it is the pick, spread across engines. */
  proof: PositionReceipt[];
  /** am20: the brand inside this one contest - the rival panel's lead read. */
  here?: RivalHere;
}

/** am20 (2026-11-12): one brand's funnel inside one contest. Every share is of
 * the contest's answers except `converts` (its picks per recommendation).
 * Counts ride `tips` only; `refs` open the answers behind each number. */
export interface BrandRead {
  named: string;
  recommended: string;
  picked: string;
  converts: string;
  tips: { named: string; recommended: string; picked: string; converts: string };
  refs: { named?: AnswerRef[]; recommended?: AnswerRef[]; picked?: AnswerRef[] };
}

/** am20: a rival inside one contest - how it gets its picks here, what the AI
 * argues when it picks it, and which buyers the AI sends to it. */
export interface RivalHere {
  read: BrandRead;
  /** compare: what comes up more when it is picked than when you are (value =
   * its-picks share minus your-picks share; liftSides ["its picks", "your picks"]);
   * alone: you are picked too rarely here to compare, so the share of its pick
   * answers arguing each code (argsRows); absent: too few picks of its own. */
  argsMode?: "compare" | "alone";
  args?: LiftItem[];
  argsRows?: ArgsRow[];
  /** The conditions on the buyer that send picks to it here, share of the
   * answers here that send buyers to it with any stated condition. */
  sends: ConditionItem[];
  /** Share of the contest's answers that send buyers to it with a stated condition. */
  sendsShare?: string;
  /** am22: the same, in the run's reason themes (dt4): the away pool scoped
   * to this contest's questions and to answers whose rule in the group sends
   * the buyer to it; shares are of those answers. Present (possibly empty)
   * whenever the theme map exists - then `sends` is only a fallback. */
  sendsThemes?: DossierTheme[];
}

/** What the panel's "What the AI says about the <category>" section draws:
 * compare = the two-sided lifts (Position.lifts; argsRows absent); rival =
 * your side is under the lift floor, so the share of the rival-pick answers
 * arguing each code; all = no pick on either side, so the share of the
 * contest's answers arguing each code; topics = the schema codes topics, not
 * reasons (awareness, learning the category). */
export type ArgsMode = "compare" | "rival" | "all" | "topics";

export interface ArgsRow {
  label: string;
  share: string;
  receipts: AnswerRef[];
}

/** The badges' meaning as data for the panel's plain sentences. */
export interface PositionNotes {
  /** The top possession-shaped away condition's wording (the wall badge). */
  wall?: string;
  inHouse?: true;
  leak?: true;
  /** one_assistant: one engine carries your side (watch); asked_for: the
   * settled-customer number appears only when the asker sets the side. */
  soft?: "one_assistant" | "asked_for";
}

/** Where an away condition (or theme) sends buyers: an active brand and its
 * share of the condition's answers that name a destination. */
export interface RouteShare {
  name: string;
  share: string;
}

export interface LiftItem {
  label: string;
  /** Signed points (argued-in-your-wins minus argued-in-rival-wins, or the
   * band's own signed read); drawn as bars about zero. */
  value: number;
  /** am11: the two shares behind the bar, formatted like the brief's own
   * sentences ("31%"), for the row's sub-line; the tip carries the counts.
   * Absent on payloads cached before am11. */
  wins?: string;
  others?: string;
  tip?: string;
  /** am15: one answer that picks you (the lift's first side) and one that
   * picks a rival (its second), both arguing the code, when available. */
  receipts?: AnswerRef[];
}

export interface ConditionItem {
  text: string;
  /** Grouped answer count, approximate by construction. */
  n: number;
  wall?: boolean;
  /** am15: answer-grain share of the contest's rule-bearing answers stating it. */
  share?: string;
  /** am15: up to 2 answers stating it (different engines), find = their own wording. */
  receipts?: AnswerRef[];
  /** am15, away side only: the active brands it sends buyers to - top 3 with
   * >= 15% of its answers that name a destination, and at least 2 answers. */
  routes?: RouteShare[];
}

/** am21: one stated condition the AI gives in this contest on BOTH sides -
 * sending some buyers to you and others away - at similar rates. Shares are of
 * the contest's rule-bearing answers, like ConditionItem.share. */
export interface BothWaysItem {
  text: string;
  towardShare: string;
  awayShare: string;
  /** Up to 2 answers per side, each with where it sends the buyer. */
  towardRefs?: AnswerRef[];
  awayRefs?: AnswerRef[];
  /** The active rivals the away side sends buyers to (ConditionItem.routes rule). */
  routes?: RouteShare[];
}

export interface Position {
  cellId: string;
  /** "Open choice · Premium traveler" - the cell's address in words. */
  where: string;
  /** The claim with its tension inline - one template sentence. */
  claim: string;
  /** Who takes the cell: a rival, the category default, the undecided mass,
   * the brand's own rung, out-of-category, or nobody. */
  taker: string;
  takerKind: string;
  status: PositionStatus;
  triageSuggested: Triage;
  /** One or two sentences: why the engine suggests that triage. */
  triageWhy: string;
  lifts: LiftItem[];
  liftNote?: string;
  /** am11: what the two sides of the lift are ("your picks", "rivals' picks")
   * - the sub-line's words. */
  liftSides?: [string, string];
  toward: ConditionItem[];
  away: ConditionItem[];
  /** am21: conditions stated on both sides at similar rates (absent when none). */
  bothWays?: BothWaysItem[];
  /** am13 (option D): the reasons as the dossier's theme trees, scoped to
   * this cell's questions - each share is of the cell's questions where the
   * AI gives buyers any reason that way. Absent keyless, on a failed theme
   * pass, or when no reason that way touches the cell (flat lists render). */
  towardThemes?: DossierTheme[];
  awayThemes?: DossierTheme[];
  receipts: PositionReceipt[];
  /** The move as plain sentences (am15) - a template per triage. */
  lever: string;
  /** The move's name in plain words (am15), e.g. "Publish your case". */
  family: string;
  /** "The numbers" (2026-11-06, the citation ruling): every figure a brief
   * cites from this cell, stated plainly - label left, value right; counts
   * stay in `tip` (the hover). Recomputed from the cell's own pool, or the
   * identical stat where the brief reads the summary. Additive. am10
   * (2026-11-07): cell-scoped only - the brief's brand, engines and condition
   * answer cards carry the figures that are not this cell's question. */
  figures?: { label: string; value: string; tip?: string }[];
  /** am15: the in-category pick split of a pick contest (open choice, social
   * validation, premium vs basic, rivals' customers switching) - the top 5
   * rivals by share, the figure's own numbers. Present only when at least two
   * brands (you included) clear BRAND_FLOOR picks. */
  brands?: PositionBrand[];
  /** Your share of the same picks (present with `brands`). */
  youShare?: string;
  /** am20: your own funnel in this contest, beside each rival's `here.read`. */
  youRead?: BrandRead;
  /** am15: which arguments block the panel draws (absent when none has content). */
  argsMode?: ArgsMode;
  /** am15: top 5 rows for argsMode rival / all / topics. */
  argsRows?: ArgsRow[];
  /** am15: the badges' meaning for the panel's sentences (cells keep `badges`). */
  notes?: PositionNotes;
  /** am27: lost, with an exception (head-to-head cells only; see PositionException). */
  exception?: PositionException;
}

/** The one payload the Map and Verdict tabs read (positions ride along so
 * a cell click never refetches). */
export interface AnalysisMapView {
  casting: CastingLine;
  /** The brand's two-dot line and who-wins-instead bars (open choice). */
  dots: { named: RateCell; picked: RateCell };
  /** am19 (2026-11-11): the Overview's headline numbers open their answers -
   * up to 5 each, spread across assistants. named = open-choice answers that
   * name the brand; commits = answers that commit to one in-category pick
   * (the "picked" numbers read the brand's own shareOfDecided row's refs). */
  examples?: { named: AnswerRef[]; commits: AnswerRef[] };
  /** refs (am19): answers whose pick resolves to this brand (for "Others",
   * to any brand the board folds into it). */
  shareOfDecided: { brand: string; you: boolean; share: RateCell; refs?: AnswerRef[] }[];
  /** The 3-5 highest-ranked tensions as memo paragraphs, each pointing at
   * a map cell. */
  tensions: {
    title: string;
    body: string;
    cellId: string;
    /** 2026-11-10 (am17): the finding card's small chart - 2-4 bars of the
     * numbers the sentence states (value 0-100, text as the sentence prints
     * it, hi = the one row the finding is about). Absent when the finding has
     * no clean numeric rows. */
    viz?: {
      label: string;
      value: number;
      text: string;
      hi?: true;
      /** am19: the answers behind the bar's numerator, when the finding has them in hand. */
      refs?: AnswerRef[];
    }[];
  }[];
  bands: MapBand[];
  positions: Record<string, Position>;
  /** Pool answers with no code row under the source (honesty line). */
  uncoded: number;
  /** Every served insight (the summary's list) placed on a map cell by the
   * tensions' matcher, generic fallbacks included; only ids present in the
   * map. Match by key AND title - a detector can serve more than one. */
  insightCells?: { key: string; title: string; cellId: string }[];
}

/** projects.analysis_decision - the gate pattern (recommended vs decided),
 * one record per project, additive like taxonomy_decision. Keys are cell
 * ids; a cell absent from the record carries the engine's suggestion. */
export interface AnalysisDecisionEntry {
  suggested: Triage;
  decided?: Triage;
  decidedAt?: string;
  inPlaybook?: boolean;
  addedAt?: string;
}

export interface AnalysisDecision {
  v: 1;
  positions: Record<string, AnalysisDecisionEntry>;
}
