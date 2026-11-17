/**
 * Every number a card shows, with the words it sits beside and where it is (2026-11-17): by default, or behind
 * exactly one interaction (a step selected, "Show competitors" on, a fold opened, a rival's own card). Derived from
 * the same data the card UI renders (panels_v2.tsx / panel_parts.tsx) through the shared decisions in
 * panel_view.ts. The Brief resolves its links against it (brief_links.ts), and the links harness asserts them.
 *
 * Not indexed: tag pills (words, no numbers), the move box (template sentences), example answers.
 */
import type { PanelConditions, PanelNum, PanelRival, PanelSpan, PanelStep, PanelStepDetail, PanelTable, PanelText, PanelWeighs, Position, PositionPanel, RivalAcross, RivalStepDetail } from "./analysis_types";
import { PANEL_ORDER, acrossDefault, competitorsShown, conditionRowsShown, conditionsFold, outcomeRowsShown, panelSelection, rivalInCellDefault, type PanelReveal } from "./panel_view";

/** A number token as the Brief writes it (brief.ts NUMBER_TOKEN). */
export const NUMBER_TOKEN = /\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g;
export const numberTokens = (t: string): string[] => t.match(NUMBER_TOKEN) ?? [];

export interface IndexEntry {
  /** The number as the card renders it ("47%", "<1%"). */
  value: string;
  /** The words it sits beside: the row or bar label, the block title, the sentence it is part of. */
  words: string;
  /** Visible on opening, or behind the one interaction `reveal` names. */
  at: "default" | "one";
  reveal?: PanelReveal;
}

const T = (t: PanelText | undefined) => (t ?? []).map((s) => s.t).join("");
const isSpan = (c: PanelNum | PanelSpan): c is PanelSpan => "t" in c;
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

type Out = { value: string; words: string }[];
const num = (out: Out, n: PanelNum | undefined, words: string) => {
  if (n) out.push({ value: n.value, words });
};
const text = (out: Out, t: PanelText | string | undefined, words?: string) => {
  const s = typeof t === "string" ? t : T(t);
  for (const v of numberTokens(s)) out.push({ value: v, words: `${words ? `${words} ` : ""}${s}` });
};

/** StepCard (panel_parts.tsx): the bars a step draws in a view. */
function stepNums(out: Out, s: PanelStep, usual: PanelStep | undefined, comp: boolean, labels: { here: string; usual: string }, rivalLabel?: string) {
  const ranked = comp || !!rivalLabel;
  if (s.here) {
    const youL = comp && !s.rivals?.length && (s.compHereLabel || s.hereLabel) ? s.compHereLabel ?? s.hereLabel! : ranked ? "You" : s.hereLabel ?? labels.here;
    num(out, s.here, `${s.label} - ${youL}`);
    if (ranked) for (const r of s.rivals ?? []) num(out, r.num, `${s.label} - ${r.name}`);
    const vs = !ranked && s.vs;
    if (vs) num(out, vs.num, `${s.label} - ${vs.name}`);
    const u = s.usual ?? usual?.here;
    if (!ranked && !vs && u) num(out, u, `${s.label} - ${s.usualLabel ?? labels.usual}`);
  } else if (ranked && s.rivals?.length) for (const r of s.rivals) num(out, r.num, `${s.label} - ${r.name}`);
  for (const g of s.segments ?? []) num(out, g.num, `${s.label} - ${cap(g.label)}`);
  if (!ranked && usual?.segments?.length) for (const g of usual.segments) num(out, g.num, `${s.label} - ${cap(g.label)} - usual`);
  for (const it of s.items ?? []) num(out, it.num, `${s.label} - ${it.label}`);
  text(out, s.note, s.label);
}

/** RivalDetail (panels_v2.tsx): a step's explanation. */
function detailNums(out: Out, d: PanelStepDetail | RivalStepDetail, outcomesAll: boolean, rivalName = "") {
  text(out, d.body, d.heading);
  const cols = "columns" in d ? d.columns : undefined;
  for (const r of d.rows ?? []) {
    num(out, r.rival, `${d.heading} - ${r.label} - ${cols?.rival ?? rivalName}`);
    num(out, r.you, `${d.heading} - ${r.label} - ${cols?.you ?? "You"}`);
  }
  if ("list" in d && d.list) for (const r of d.list.rows) num(out, r.num, `${d.heading} - ${d.list.title} ${r.label}`);
  const ol = d.outcomeLabels;
  if (d.outcomes && ol) {
    const { shown } = outcomeRowsShown(d.outcomes as { you?: true; usual?: true }[], outcomesAll);
    for (const o of shown as NonNullable<PanelStepDetail["outcomes"]>) for (const k of ["picked", "lost", "none"] as const) if (ol[k]) num(out, o[k], `${d.heading} - ${o.name} - ${ol[k]}`);
  }
  text(out, d.both, d.heading);
  if ("sections" in d) for (const s of d.sections ?? []) {
    for (const r of s.rows) num(out, r.num, `${s.title} - ${r.label}`);
    text(out, s.note, s.title);
  }
}

function condNums(out: Out, c: PanelConditions | undefined, comp: boolean, all: boolean) {
  if (!c) return;
  for (const [side, title, also] of [["toward", c.towardTitle, c.alsoToward], ["away", c.awayTitle, c.alsoAway]] as const) {
    for (const r of conditionRowsShown(c[side], all)) {
      num(out, r.share, `${c.title} - ${title} ${r.text}`);
      num(out, r.both?.either, `${c.title} - ${r.text} - ${also}`);
      if (comp) for (const x of r.to ?? []) num(out, x.num, `${c.title} - ${r.text} - ${x.name}`);
      num(out, r.youPicked, `${c.title} - ${r.text} - you are the pick`);
    }
  }
}

const tableNums = (out: Out, t: PanelTable | undefined) => {
  if (!t) return;
  for (const r of t.rows) r.cells.forEach((c, i) => c && (isSpan(c) ? text(out, c.t, `${t.title} - ${r.label} - ${t.columns[i] ?? ""}`) : num(out, c, `${t.title} - ${r.label} - ${t.columns[i] ?? ""}`)));
};
const weighNums = (out: Out, w: PanelWeighs | undefined) => {
  if (!w) return;
  for (const c of w.columns)
    for (const r of c.rows) {
      num(out, r.num, `${w.title} - ${c.title ?? ""} - ${r.name}`);
      if (r.other) num(out, r.other.num, `${w.title} - ${r.other.label} - ${r.name}`);
    }
};

/** PositionPanelView in one state. */
function panelState(pp: PositionPanel, usualSteps: PanelStep[] | undefined, comp: boolean, sel: string | undefined, condAll: boolean, outAll: boolean): Out {
  const out: Out = [];
  text(out, pp.claim, "claim");
  text(out, pp.lead, "lead");
  text(out, pp.thin);
  const { selectable, defaultSel } = panelSelection(pp, comp);
  const details = (comp ? pp.detailsComp : pp.details) ?? {};
  const labels = { here: pp.hereKey ?? "You", usual: pp.usualKey ?? "" };
  for (const s of pp.steps) stepNums(out, s, usualSteps?.find((u) => u.key === s.key), comp, labels);
  for (const b of PANEL_ORDER[pp.kind] ?? []) {
    if (b === "byproduct") tableNums(out, pp.byProduct);
    if (b === "detail") {
      const d = sel ? details[sel as keyof typeof details] : undefined;
      if (d) detailNums(out, d, outAll);
      else if (!selectable || sel === defaultSel) {
        const pd = comp ? pp.detailComp ?? pp.detail : pp.detail;
        if (pd) text(out, pd.body, pd.heading);
      }
    }
    if (b === "conditions") condNums(out, pp.conditions, comp, condAll);
    if (b === "competitors" && competitorsShown(pp, comp)) for (const r of pp.competitors!.rows) num(out, r.num, `${pp.competitors!.title} - ${r.shown ?? (r.you ? "You" : r.name)}`);
    if (b === "lines") for (const l of (comp ? pp.linesComp ?? pp.lines : pp.lines) ?? []) text(out, l.value, l.label);
    if (b === "weighs") weighNums(out, comp ? pp.weighsComp ?? pp.weighs : pp.weighs);
    if (b === "ends") weighNums(out, pp.ends);
    if (b === "table") tableNums(out, comp ? pp.tableComp ?? pp.table : pp.table);
    if (b === "tables") for (const t of pp.tables ?? []) tableNums(out, t);
  }
  return out;
}

/** RivalInCell (panel 11) as it opens. */
function rivalInCellState(r: PanelRival): Out {
  const out: Out = [];
  text(out, r.claim, `${r.name} claim`);
  text(out, r.lead, r.name);
  text(out, r.thin);
  for (const s of r.steps) stepNums(out, s, undefined, false, { here: "You", usual: "" }, r.name);
  const sel = rivalInCellDefault(r);
  const d = sel ? (r.details ?? {})[sel as "named"] : undefined;
  if (d) detailNums(out, d, false, r.name);
  condNums(out, r.conditions, false, false);
  for (const l of r.lines ?? []) text(out, l.value, l.label);
  weighNums(out, r.weighs);
  for (const c of r.byCell ?? []) {
    num(out, c.rival, `${r.byCellTitle ?? ""} - ${c.label} - ${r.name}`);
    num(out, c.you, `${r.byCellTitle ?? ""} - ${c.label} - You`);
  }
  return out;
}

const keyOf = (e: { value: string; words: string }) => `${e.value}\u0000${e.words}`;
function merge(into: IndexEntry[], seen: Set<string>, xs: Out, at: IndexEntry["at"], reveal?: PanelReveal) {
  for (const x of xs) {
    const k = keyOf(x);
    if (seen.has(k)) continue;
    seen.add(k);
    into.push({ ...x, at, ...(reveal ? { reveal } : {}) });
  }
}

/** Every number on a cell's card. `usualSteps` = the row's All cell's steps (drawn as the usual bars). */
export function indexPanel(p: Position, usualSteps?: PanelStep[]): IndexEntry[] {
  const pp = p.panel;
  if (!pp) return [];
  const out: IndexEntry[] = [];
  const seen = new Set<string>();
  const { selectable, defaultSel } = panelSelection(pp, false);
  merge(out, seen, panelState(pp, usualSteps, false, defaultSel, false, false), "default");
  // One interaction: another step, the competitors switch, a fold, a rival's own card.
  if (selectable) for (const s of pp.steps) if (s.key !== defaultSel && pp.details?.[s.key]) merge(out, seen, panelState(pp, usualSteps, false, s.key, false, false), "one", { step: s.key });
  if (pp.compare) merge(out, seen, panelState(pp, usualSteps, true, panelSelection(pp, true).defaultSel, false, false), "one", { competitors: true });
  if (pp.conditions && conditionsFold(pp.conditions.toward, pp.conditions.away)) merge(out, seen, panelState(pp, usualSteps, false, defaultSel, true, false), "one", { fold: "conditions" });
  merge(out, seen, panelState(pp, usualSteps, false, defaultSel, false, true), "one", { fold: "outcomes" });
  for (const r of pp.rivals ?? []) merge(out, seen, rivalInCellState(r).map((x) => ({ ...x, words: `${r.name} - ${x.words}` })), "one", { rival: r.name });
  return out;
}

/** RivalAcrossView (the By rival card) in one state. */
function acrossState(r: RivalAcross, sel: string | undefined, condAll: boolean): Out {
  const out: Out = [];
  text(out, r.claim, `${r.name} claim`);
  for (const s of r.steps) for (const b of s.bars) if (b.who !== "other") num(out, b.num, `${s.label} - ${b.who === "rival" ? r.name : "You"}`);
  const s = r.steps.find((x) => x.key === sel) ?? r.steps[0];
  if (s) {
    text(out, s.body, s.heading);
    for (const b of s.bars) num(out, b.num, `${s.label} - ${b.name}`);
    condNums(out, s.conditions, false, condAll);
    tableNums(out, s.table);
    text(out, s.fold, s.label);
  }
  tableNums(out, r.byBuyer);
  tableNums(out, r.products);
  return out;
}

/** Every number on a rival's By rival card. */
export function indexAcross(r: RivalAcross): IndexEntry[] {
  const out: IndexEntry[] = [];
  const seen = new Set<string>();
  const def = acrossDefault(r);
  merge(out, seen, acrossState(r, def, false), "default");
  for (const s of r.steps) if (s.key !== def) merge(out, seen, acrossState(r, s.key, false), "one", { step: s.key });
  const ds = r.steps.find((x) => x.key === def);
  if (ds?.conditions && conditionsFold(ds.conditions.toward, ds.conditions.away)) merge(out, seen, acrossState(r, def, true), "one", { fold: "conditions" });
  return out;
}
