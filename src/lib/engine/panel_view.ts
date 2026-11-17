/**
 * What a question-type card shows, decided once (2026-11-17). The Map's card UI (panels_v2.tsx, panel_parts.tsx)
 * and the engine's index of what a card shows (panel_index.ts) both read these pure helpers, so the place a number
 * sits - by default, or behind one interaction - can never drift between the two.
 *
 * The interactions a card has: a step selected (the step's explanation), "Show competitors" on, a fold opened
 * (the conditions' "See all", a step explanation's "Show all ... competitors"), a rival's own card opened.
 */
import type { PanelKind, PanelRival, PanelStepKey, PositionPanel, RivalAcross } from "./analysis_types";

/** One part of a card opened for one visit, nothing else changed (the user's remembered switch untouched). */
export interface PanelReveal {
  /** A step selected (its explanation shown): a PanelStepKey on a cell card, a RivalAcrossStep key on a rival card. */
  step?: string;
  /** "Show competitors" on, for this open only. */
  competitors?: true;
  /** A fold opened: the conditions' "See all", or a step explanation's "Show all ... competitors". */
  fold?: "conditions" | "outcomes";
  /** A rival's own card inside this cell (panel 11). */
  rival?: string;
}

export type PanelBlockKey = "stack" | "byproduct" | "detail" | "conditions" | "ends" | "competitors" | "lines" | "weighs" | "table" | "tables";

/** The blocks of each card, in the order the card draws them. */
export const PANEL_ORDER: Record<PanelKind, PanelBlockKey[]> = {
  buy: ["stack", "detail", "conditions", "competitors", "lines", "weighs"],
  switching: ["stack", "detail", "conditions", "competitors", "lines", "weighs"],
  h2h: ["stack", "detail", "conditions", "lines", "weighs"],
  buyer_worry: ["stack", "detail", "competitors", "lines", "weighs"],
  customer_worry: ["stack", "detail", "competitors", "lines", "weighs"],
  // am38: Value's rivals moved into the "where it points" explanation; the by-product table sits right under the steps.
  value: ["stack", "byproduct", "detail", "competitors", "lines", "weighs"],
  looking_around: ["stack", "detail", "competitors", "conditions", "lines", "weighs"],
  problem: ["stack", "detail", "competitors", "lines", "table"],
  criteria: ["stack", "detail", "table", "lines"],
  expansion: ["stack", "detail", "conditions", "lines"],
  business_case: ["stack", "lines", "detail", "table"],
  popular: ["stack", "detail", "conditions", "competitors", "tables"],
  learning: ["stack", "detail", "table"],
  alongside: ["stack", "detail", "conditions"],
  critic: ["stack", "lines", "detail", "table"],
  // am59: Premium vs basic - which end, the funnel, the conditions by end, who it names at each end, what each side weighs.
  premium: ["stack", "detail", "conditions", "ends", "competitors", "weighs"],
  // am60: Habit - the brands suggested instead live in the "suggests another brand" explanation (the looking-around pattern).
  habit: ["stack", "detail", "conditions", "lines", "weighs"],
  // am61: the settled customers' All questions card - the step and its explanation (an index to the four questions).
  settled_all: ["stack", "detail"],
};

/** The conditions columns show this many rows a side until "See all". */
export const PREVIEW_ROWS = 4;

/** Which step a card selects, in the normal or the comparison view. */
export function panelSelection(pp: PositionPanel, comp: boolean): { selectable: boolean; defaultSel: PanelStepKey | undefined } {
  const details = (comp ? pp.detailsComp : pp.details) ?? {};
  const selectable = pp.steps.some((s) => !!details[s.key]);
  // am37: only a step that explains itself can be selected (or start selected).
  const focus = comp ? pp.focusComp : pp.focus;
  const first = pp.steps.find((s) => !!details[s.key])?.key;
  return { selectable, defaultSel: selectable ? (focus && details[focus] ? focus : first) : focus };
}

/** Whether the competitors block draws (a card with the switch shows it only with the switch on). */
export const competitorsShown = (pp: PositionPanel, comp: boolean) => !!pp.competitors && pp.competitors.rows.length > 0 && (!pp.compare || comp);

/** The conditions rows a side shows. */
export const conditionRowsShown = <T,>(rows: T[], all: boolean): T[] => (all ? rows : rows.slice(0, PREVIEW_ROWS));
export const conditionsFold = (toward: unknown[], away: unknown[]) => toward.length > PREVIEW_ROWS || away.length > PREVIEW_ROWS;

/** A step explanation's outcome rows: yours (and your usual) and the first other brand, the rest behind "Show all". */
export function outcomeRowsShown<O extends { you?: true; usual?: true }>(outcomes: O[], all: boolean): { shown: O[]; folded: number } {
  const mine = (o: O) => !!o.you || !!o.usual;
  const firstOther = outcomes.find((o) => !mine(o));
  const short = outcomes.filter((o) => mine(o) || o === firstOther);
  return { shown: all ? outcomes : short, folded: outcomes.length - short.length };
}

/** A rival's own card inside a cell (panel 11): the step it opens on. */
export const isFunnelStep = (k: string): k is "named" | "recommended" | "converts" => k === "named" || k === "recommended" || k === "converts";
export function rivalInCellDefault(r: PanelRival): PanelStepKey | undefined {
  const details = r.details ?? {};
  return r.focus ?? r.steps.find((s) => isFunnelStep(s.key) && details[s.key as "named"])?.key;
}

/** The By rival card: the question it opens on. */
export const acrossDefault = (r: RivalAcross): string | undefined => r.focus ?? r.steps[0]?.key;
