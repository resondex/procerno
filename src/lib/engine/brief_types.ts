/**
 * The Brief pill - shared contract (2026-11-04, BRIEF_PILL_DESIGN_2026-11-04.md).
 *
 * One payload per (run, source, subject brand, engine set) carries ALL seven
 * frames, server-composed as finished lay sentences: the UI renders sections
 * verbatim and never re-words a number. Visible text is percentages-only,
 * jargon-free (the design doc's dictionary); counts live ONLY in `tip`
 * fields, rendered as hover tooltips and left out of print.
 *
 * This shape is FROZEN for the 2026-11-04 build: the engine may add optional
 * fields, never change or remove these.
 */

export type BriefFrame =
  | "now_what" // default: the verdict, then the moves - each an opening, the move, and its watch metric
  | "swot" // 2x2 quadrant: strengths / weaknesses / opportunities / threats
  | "tows" // the action form: S-O / W-O / S-T / W-T strategy pairings
  | "funnel" // Named -> Recommended -> Picked -> Kept
  | "matrix" // visibility vs conversion: every brand placed by named % vs share of firm picks
  | "jobs" // by buying situation: each room, who wins it, what decides it
  | "minto"; // situation - complication - resolution

export const BRIEF_FRAMES: BriefFrame[] = ["now_what", "swot", "tows", "funnel", "matrix", "jobs", "minto"];

export const BRIEF_FRAME_LABELS: Record<BriefFrame, string> = {
  now_what: "Now what?",
  swot: "SWOT",
  tows: "TOWS",
  funnel: "The funnel",
  matrix: "Visibility vs conversion",
  jobs: "By buying situation",
  minto: "Situation - complication - resolution",
};

/** One scoreboard or table line. `tip` holds the counts (tooltip only). */
export interface BriefRow {
  label: string;
  value: string;
  tip?: string;
}

/** One paragraph. `lead` renders bold at the front. `tip` holds counts. */
export interface BriefPara {
  lead?: string;
  text: string;
  tip?: string;
}

/** A 2x2 quadrant pair (one grid row: two titled cells side by side). */
export interface BriefQuad {
  headers: [string, string];
  cells: [BriefPara[], BriefPara[]];
}

/** A frame's visual (2026-11-04 mirror of the library exemplars): a small,
 * declarative spec the UI draws as inline SVG - grey-first, one accent, the
 * finding in the title. Numbers are rates in points of 100. */
export type BriefVizKind = "funnel" | "scatter" | "pairs" | "pyramid";
export interface BriefVizItem {
  label: string;
  /** funnel: the stage rate; scatter: x (named %); pairs: the subject's share; pyramid: unused. */
  a?: number;
  /** scatter: y (share of picks %); pairs: the leader's share. */
  b?: number;
  /** pairs: the leader's name. */
  who?: string;
  /** The accented item (the subject, or the stage the finding is about). */
  accent?: boolean;
  /** scatter: draw the point without its own label (folded into clusterNote). */
  unlabeled?: boolean;
  /** scatter: label x/y nudge in px. pyramid: the item's one-sentence line. */
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
}
