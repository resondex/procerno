/**
 * The Brief pill - shared contract (2026-11-04, BRIEF_PILL_DESIGN_2026-11-04.md).
 *
 * One payload per (run, source, subject brand, engine set) carries ALL six (bf29)
 * frames, server-composed as finished lay sentences: the UI renders sections
 * verbatim and never re-words a number. Visible text is percentages-only,
 * jargon-free (the design doc's dictionary); counts live ONLY in `tip`
 * fields, rendered as hover tooltips and left out of print.
 *
 * This shape is FROZEN for the 2026-11-04 build: the engine may add optional
 * fields, never change or remove these.
 */

import type { PanelReveal } from "./panel_view";

export type BriefFrame =
  | "now_what" // default: the verdict, then the moves - each an opening, the move, and its watch metric
  | "diagnosis" // bf29: one argument - conversion, price, the winning argument, the threat, where to act
  | "swot" // 2x2 quadrant: strengths / weaknesses / opportunities / threats (TOWS retired in bf29)
  | "funnel" // Named -> Recommended -> Picked -> Kept
  | "matrix" // visibility vs conversion: every brand placed by named % vs share of firm picks
  | "jobs"; // by buying situation: each room, who wins it, what decides it (Situation - complication - resolution retired in bf29)

export const BRIEF_FRAMES: BriefFrame[] = ["now_what", "diagnosis", "swot", "funnel", "matrix", "jobs"];

export const BRIEF_FRAME_LABELS: Record<BriefFrame, string> = {
  now_what: "Now what?",
  diagnosis: "The diagnosis",
  swot: "SWOT",
  funnel: "The funnel",
  matrix: "Visibility vs conversion",
  jobs: "By buying situation",
};

/** A link from a fact to the analysis-map cell it was read from (2026-11-06).
 * Rendered as a quiet map pin after the text; a click opens that cell's
 * position on The Map pill. Never printed. `label` is the position's `where`
 * and shows only as the pin's tooltip (it may carry analyst wording, which
 * visible text never does). */
export interface BriefAnchor {
  id: string;
  label: string;
  /** What the pin opens (2026-11-07, the answer cards): absent = "cell" (back-compat).
   * Every anchor's id is also its key into BriefView.cards; a reader should
   * trust the card's own kind over this field (the written memo rebuilds
   * anchors as {id, label} only). */
  kind?: AnswerCardKind;
  /** bf15 (2026-11-07, the fact is the link): on a unit whose visible text has
   * no number token, the exact substring of that text this anchor links
   * (a move's watch phrase). Absent on numbered
   * units - there the anchor links the numbers its card states. */
  at?: string;
}

/** The answer cards (2026-11-07, the owner's ratified shape - public/_position_panel_options.html
 * tab 4): every pin opens one small card that answers ONE question. A cell
 * card is a map cell's own story; a brand card one brand's open-question
 * funnel; the engines card the assistants split; the condition card what
 * routes buyers away. The citation contract: every visible number in a
 * paragraph or row is stated by one of its pins' cards (headline, crumb, or a
 * row's label or value - never a tip, which carries counts). */
export type AnswerCardKind = "cell" | "brand" | "engines" | "condition";

export interface AnswerCard {
  kind: AnswerCardKind;
  /** The card's quiet top line ("Wells Fargo · open buying questions"). */
  crumb: string;
  /** One claim sentence. */
  headline: string;
  /** label / value lines; counts in `tip` (title attribute only). */
  rows: { label: string; value: string; tip?: string }[];
  /** The one "go deeper" link (bf20, the owner's ruling: cite a
   * non-Build-a-table surface whenever one exists): The Map at `cellId`, a
   * rival's dossier under Rivals (`brand` = the dossier key), Stations, or
   * Build a table - the fallback when nothing more specific exists. */
  go?: { label: string; target: "map" | "metrics" | "rivals" | "journey"; cellId?: string; brand?: string };
  /** bf17 (2026-11-07): a cell card's arguments, drawn like the map panel's -
   * a diverging bar per code (`value` = signed points) with the two shares
   * as a sub-line ("31% of your picks · 1% of rivals' picks"); counts in
   * `tip` only. cardText states each label, both shares and the signed
   * points ("+30 points"). */
  lifts?: { label: string; value: number; wins?: string; others?: string; tip?: string; seldom?: boolean }[];
  /** The sub-line's two side words ("your picks", "rivals' picks"). */
  liftSides?: [string, string];
  /** Fact layer step 5, part 2: where each number of the headline and the rows sits, with its fact id ("headline",
   * "rows.<i>"). Never drawn. */
  facts?: Record<string, [number, number, string][]>;
}

/** bf33 (2026-11-17): where one number in a unit opens - resolved at compose time (brief_links.ts), never guessed
 * in the UI. `token` is the number as written, `occurrence` its 0-based count among that token's occurrences in
 * the unit (lead, then text). A cell or rival card opens with only `reveal`'s part changed; "card" opens the
 * Brief's own answer card (the figure has no home on a card). */
export interface BriefLink {
  token: string;
  occurrence: number;
  dest:
    | { kind: "cell"; id: string }
    | { kind: "rival"; name: string }
    | { kind: "card"; id: string }
    /** bf34: a table on the Data page (a library entry: its pool, measure and rows), for a figure no card shows. */
    | { kind: "table"; entry: string; pool: string; measures: string[]; row: string };
  reveal?: PanelReveal;
  /** Stage 2 (stat ids, 2026-11-17): the card location the link opens (stat_registry.ts id) - never matched. */
  stat?: string;
  /** Fact layer step 5, part 2: the fact the number is (measure | subject | scope, or a derived ref); the link opens a
   * card location that draws this same fact. */
  fact?: string;
}

/** One scoreboard or table line. `tip` holds the counts (tooltip only). */
export interface BriefRow {
  label: string;
  value: string;
  /** The same measure for the average competitor (the competitors listed on the what-to-buy card, taken together); only on rows that have one. */
  avg?: string;
  /** The same measure for the most-picked competitor (present with `avg`). */
  top?: string;
  /** Scoreboard layout, set only when the competitor columns exist: "vs" rows form the against-competitors table, "note" is a sentence under the tables, the rest form the second table. */
  kind?: "vs" | "note";
  /** On the first "vs" row: the column heads (the subject and the most-picked competitor). */
  heads?: { subject: string; top?: string };
  tip?: string;
  /** The map cell behind the row's number (pin after the value). */
  cell?: BriefAnchor;
  /** bf33: where each number in the row's value opens. */
  links?: BriefLink[];
}

/** One paragraph. `lead` renders bold at the front. `tip` holds counts. */
export interface BriefPara {
  lead?: string;
  text: string;
  tip?: string;
  /** One or more map cells behind the paragraph's facts (pins after the text). */
  cells?: BriefAnchor[];
  /** bf33: where each number in the lead and text opens. */
  links?: BriefLink[];
}

/** A 2x2 quadrant pair (one grid row: two titled cells side by side). */
export interface BriefQuad {
  headers: [string, string];
  cells: [BriefPara[], BriefPara[]];
}

/** A frame's visual (2026-11-04 mirror of the library exemplars): a small,
 * declarative spec the UI draws as inline SVG - grey-first, one accent, the
 * finding in the title. Numbers are rates in points of 100. */
export type BriefVizKind = "funnel" | "scatter" | "pairs";
export interface BriefVizItem {
  label: string;
  /** funnel: the stage rate; scatter: x (named %); pairs: the subject's share. */
  a?: number;
  /** scatter: y (share of picks %); pairs: the leader's share. */
  b?: number;
  /** pairs: the leader's name. */
  who?: string;
  /** The accented item (the subject, or the stage the finding is about). */
  accent?: boolean;
  /** scatter: draw the point without its own label (folded into clusterNote). */
  unlabeled?: boolean;
  /** scatter: label x/y nudge in px. */
  dx?: number;
  dy?: number;
  note?: string;
  /** The served display text of `a` / `b` ("6.7%") - the UI prints these verbatim, never re-formats. */
  value?: string;
  bValue?: string;
}

/** The scatter's drawing frame, shared so the engine can place labels in the
 * same pixel space the UI draws in (viewBox units). A label's default anchor
 * is its start-baseline at (dot x + labelDx, dot y + labelDy); an item's
 * dx/dy are added to that default. */
export const BRIEF_SCATTER_GEOM = { w: 760, h: 440, left: 52, right: 24, top: 18, bottom: 46, labelDx: 10, labelDy: 4 } as const;
export function scatterPx(x: number, y: number, xMax: number, yMax: number): { x: number; y: number } {
  const g = BRIEF_SCATTER_GEOM;
  return {
    x: g.left + (Math.min(Math.max(x, 0), xMax) / xMax) * (g.w - g.left - g.right),
    y: g.h - g.bottom - (Math.min(Math.max(y, 0), yMax) / yMax) * (g.h - g.top - g.bottom),
  };
}
export interface BriefViz {
  kind: BriefVizKind;
  /** States the finding, with its number. */
  title: string;
  subtitle?: string;
  items: BriefVizItem[];
  /** scatter: axis words and the two reference lines. */
  xLabel?: string;
  yLabel?: string;
  /** scatter: vertical reference at this x (the visibility line). */
  vline?: number;
  vlineLabel?: string;
  /** scatter: diagonal reference y = x / diag (the converting line). */
  diag?: number;
  diagLabel?: string;
  /** scatter: the diagLabel's end-anchored baseline point, in viewBox pixels (default: above the line's end). */
  diagLabelPx?: { x: number; y: number };
  /** scatter (bf29): a horizontal reference at this y (the conversion of the charted brands together), its label and the label's end-anchored baseline point in viewBox pixels. */
  hline?: number;
  hlineLabel?: string;
  hlineLabelPx?: { x: number; y: number };
  /** scatter: one quiet note naming the unlabeled cluster, drawn near it. */
  clusterNote?: string;
  /** scatter: the clusterNote's start-baseline anchor, in BRIEF_SCATTER_GEOM viewBox pixels. */
  notePx?: { x: number; y: number };
  /** scatter: the clusterNote's words broken onto lines (14px apart) when one line would not clear the marks. */
  noteLines?: string[];
  /** scatter: the axes' upper bounds (rates in points of 100; default 100). */
  xMax?: number;
  yMax?: number;
  /** pairs: the two legend swatches - [the subject, the comparison bar]. */
  legend?: [string, string];
}

/** One section of a memo. Exactly one of paras / rows / quads / table / viz is set. */
export interface BriefSection {
  key: string;
  heading?: string;
  paras?: BriefPara[];
  rows?: BriefRow[];
  quads?: BriefQuad[];
  table?: { headers: string[]; rows: string[][]; highlightRow?: number };
  viz?: BriefViz;
}

export interface BriefMemo {
  frame: BriefFrame;
  /** e.g. "American Express - Now what? - wave 1" (also the print title). */
  title: string;
  sections: BriefSection[];
  /** One lay line, no methodology: "One wave of answers from 13 AI assistants, October 2026." */
  footer: string;
}

export interface BriefView {
  /** The brand this payload's memos are about, as the dictionary displays it. */
  subject: string;
  /** Every brand selectable in the dropdown (target first, then active analyzed brands). */
  subjects: string[];
  /** All seven frames, composed; a frame the subject lacks data for still renders with fewer sections. */
  memos: Record<BriefFrame, BriefMemo>;
  /** Engines the payload was computed on (display labels), for the "on N assistants" line. */
  engineCount: number;
  /** Every pin's answer card, keyed by the anchor id (bf14; only cards a surviving pin opens). */
  cards?: Record<string, AnswerCard>;
}
