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
  | "funnel" // Named -> Recommended -> Picked -> Kept -> Defended
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

/** One section of a memo. Exactly one of paras / rows / quads / table is set. */
export interface BriefSection {
  key: string;
  heading?: string;
  paras?: BriefPara[];
  rows?: BriefRow[];
  quads?: BriefQuad[];
  table?: { headers: string[]; rows: string[][]; highlightRow?: number };
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
