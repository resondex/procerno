import type { RateCell } from "./view_data";

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

export interface LiftItem {
  label: string;
  /** Signed points (argued-in-your-wins minus argued-in-rival-wins, or the
   * band's own signed read); drawn as bars about zero. */
  value: number;
}

export interface ConditionItem {
  text: string;
  /** Grouped answer count, approximate by construction. */
  n: number;
  wall?: boolean;
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
  toward: ConditionItem[];
  away: ConditionItem[];
  receipts: PositionReceipt[];
  /** The move, in the treatment ladder's terms - a template per triage. */
  lever: string;
  /** Treatment family from the service ladder, e.g. "Evidence audit". */
  family: string;
}

/** The one payload the Map and Verdict tabs read (positions ride along so
 * a cell click never refetches). */
export interface AnalysisMapView {
  casting: CastingLine;
  /** The brand's two-dot line and who-wins-instead bars (open choice). */
  dots: { named: RateCell; picked: RateCell };
  shareOfDecided: { brand: string; you: boolean; share: RateCell }[];
  /** The 3-5 highest-ranked tensions as memo paragraphs, each pointing at
   * a map cell. */
  tensions: { title: string; body: string; cellId: string }[];
  bands: MapBand[];
  positions: Record<string, Position>;
  /** Pool answers with no code row under the source (honesty line). */
  uncoded: number;
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
