/**
 * Every number a card shows, with the words it sits beside and where it is (2026-11-17): by default, or behind
 * exactly one interaction (a step selected, "Show competitors" on, a fold opened, a rival's own card). Derived from
 * the same data the card UI renders (panels_v2.tsx / panel_parts.tsx) through the shared decisions in
 * panel_view.ts. The Brief resolves its links against it (brief_links.ts), and the links harness asserts them.
 *
 * Stage 1 of the stat ids (2026-11-17): the one walk here also gives every number its location in the data - a
 * path keyed by stable keys (step key, line key, row label, brand name), never by display position where a key
 * exists. stat_registry.ts turns the walk into the registry of stats (one id per location); indexPanel /
 * indexAcross stay the (value, words) view the link resolver reads, byte-identical to before.
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

/** One number as the walk meets it in one state of a card: the index entry plus its location (`path`). */
export interface WalkEntry extends IndexEntry {
  /** The number's location on its card ("steps/named/you", "lines/share/avg", "conditions/away/<row>/share"). */
  path: string;
  /** The card's part the path lives in: "" for the card itself, "rival:<name>" for a rival's own card inside a cell. */
  part: string;
  pct?: number;
  /** The exact counts behind the number (stage 3): read from the number's own tip ("k of n ..."), which every
   * PanelNum and every keyed span built from one carries - so the reading is the same in process or after JSON. */
  kn?: KN;
  /** The fact the number is (fact layer), when the card looked it up. */
  fact?: string;
}

export interface KN {
  k: number;
  n: number;
}
/** The counts a number's tip states ("47 of 100 answers" -> 47, 100); undefined when the tip states none. */
export function knOfTip(tip: string | undefined): KN | undefined {
  const m = tip ? /^(\d+) of (\d+)\b/.exec(tip) : null;
  return m ? { k: Number(m[1]), n: Number(m[2]) } : undefined;
}

type Raw = { value: string; words: string; path: string; pct?: number; kn?: KN; fact?: string };
type Out = Raw[];

/**
 * Paths for one card: a path names one location in the data. The walk meets a location again in another state
 * (the same object): it keeps its path. Two different objects that would get the same path (a duplicated row label,
 * say) get "#2", "#3" in the order the walk first meets them - the same in every state, so ids stay stable.
 */
class Paths {
  private seen = new Map<string, unknown[]>();
  id(path: string, src: unknown): string {
    if (src === undefined) return path;
    let xs = this.seen.get(path);
    if (!xs) this.seen.set(path, (xs = []));
    let i = xs.indexOf(src);
    if (i < 0) i = xs.push(src) - 1;
    return i === 0 ? path : `${path}#${i + 1}`;
  }
}

const T = (t: PanelText | undefined) => (t ?? []).map((s) => s.t).join("");
const isSpan = (c: PanelNum | PanelSpan): c is PanelSpan => "t" in c;
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
/** A key segment: the words as written, with the path separator taken out. */
const k = (s: string | number) => String(s).replace(/\//g, "∕");

interface W {
  out: Out;
  P: Paths;
  /** The "Other" rows are open (the competitor group's fold). */
  other?: boolean;
}
const num = (w: W, n: PanelNum | undefined, words: string, path: string) => {
  if (!n) return;
  const kn = knOfTip(n.tip);
  w.out.push({ value: n.value, words, path: w.P.id(path, n), pct: n.pct, ...(kn ? { kn } : {}), ...(n.fact ? { fact: n.fact } : {}) });
};
/** The numbers in a sentence: a keyed span (PanelSpan.key) holding one number is `<path>/<key>`, else `<path>/<i>`
 * (i = the number's order in the sentence). */
const text = (w: W, t: PanelText | string | undefined, path: string, words?: string) => {
  const s = typeof t === "string" ? t : T(t);
  const spans = typeof t === "string" || !t ? null : t;
  const bounds: { from: number; to: number; span: PanelSpan }[] = [];
  if (spans) {
    let at = 0;
    for (const sp of spans) {
      bounds.push({ from: at, to: at + sp.t.length, span: sp });
      at += sp.t.length;
    }
  }
  let i = 0;
  for (const m of s.matchAll(NUMBER_TOKEN)) {
    const b = bounds.find((x) => m.index! >= x.from && m.index! < x.to);
    // A figure inside a name (a product as written) is part of the name, never a number on the card.
    if (b?.span.name) continue;
    const keyed = b && b.span.key && numberTokens(b.span.t).length === 1 && m.index! + m[0].length <= b.to;
    const p = keyed ? `${path}/${k(b!.span.key!)}` : `${path}/${i}`;
    // A keyed span holds exactly one number, built from a PanelNum (panel_text NK): its tip is that number's counts.
    const kn = keyed ? knOfTip(b!.span.tip) : undefined;
    // A share under half a point prints as "<1%": the sign is part of the figure the card shows.
    const shown = m.index! > 0 && s[m.index! - 1] === "<" ? `<${m[0]}` : m[0];
    // A span holding exactly this one number names the fact it is (keyed or not).
    const fact = b && b.span.fact && numberTokens(b.span.t).length === 1 ? b.span.fact : undefined;
    w.out.push({ value: shown, words: `${words ? `${words} ` : ""}${s}`, path: w.P.id(p, b ? b.span : (t as unknown) ?? path), ...(kn ? { kn } : {}), ...(fact ? { fact } : {}) });
    i++;
  }
};

/** StepCard (panel_parts.tsx): the bars a step draws in a view. */
function stepNums(w: W, s: PanelStep, usual: PanelStep | undefined, comp: boolean, labels: { here: string; usual: string }, rivalLabel?: string) {
  const ranked = comp || !!rivalLabel;
  const p = `steps/${k(s.key)}`;
  if (s.here) {
    const youL = comp && !s.rivals?.length && (s.compHereLabel || s.hereLabel) ? s.compHereLabel ?? s.hereLabel! : ranked ? "You" : s.hereLabel ?? labels.here;
    num(w, s.here, `${s.label} - ${youL}`, `${p}/you`);
    if (ranked) for (const r of s.rivals ?? []) num(w, r.num, `${s.label} - ${r.name}`, `${p}/rival/${k(r.name)}`);
    // The competitor group's Other row (no bar): its brands are drawn when it is opened.
    if (ranked && w.other && s.other) for (const r of s.other.rows) num(w, r.num, `${s.label} - Other - ${r.name}`, `${p}/other/${k(r.name)}`);
    const vs = !ranked && s.vs;
    if (vs) num(w, vs.num, `${s.label} - ${vs.name}`, `${p}/vs`);
    const u = s.usual ?? usual?.here;
    if (!ranked && !vs && u) num(w, u, `${s.label} - ${s.usualLabel ?? labels.usual}`, `${p}/usual`);
  } else if (ranked && s.rivals?.length) for (const r of s.rivals) num(w, r.num, `${s.label} - ${r.name}`, `${p}/rival/${k(r.name)}`);
  for (const g of s.segments ?? []) num(w, g.num, `${s.label} - ${cap(g.label)}`, `${p}/seg/${k(g.key)}`);
  if (!ranked && usual?.segments?.length) for (const g of usual.segments) num(w, g.num, `${s.label} - ${cap(g.label)} - usual`, `${p}/usualseg/${k(g.key)}`);
  for (const it of s.items ?? []) num(w, it.num, `${s.label} - ${it.label}`, `${p}/item/${k(it.label)}`);
  text(w, s.note, `${p}/note`, s.label);
}

/** RivalDetail (panels_v2.tsx): a step's explanation. `p` = "detail/<step>" (or "detailComp/<step>"). */
function detailNums(w: W, d: PanelStepDetail | RivalStepDetail, outcomesAll: boolean, p: string, rivalName = "") {
  text(w, d.body, `${p}/body`, d.heading);
  const cols = "columns" in d ? d.columns : undefined;
  for (const r of d.rows ?? []) {
    num(w, r.rival, `${d.heading} - ${r.label} - ${cols?.rival ?? rivalName}`, `${p}/row/${k(r.label)}/rival`);
    num(w, r.you, `${d.heading} - ${r.label} - ${cols?.you ?? "You"}`, `${p}/row/${k(r.label)}/you`);
  }
  if ("list" in d && d.list) for (const r of d.list.rows) num(w, r.num, `${d.heading} - ${d.list.title} ${r.label}`, `${p}/list/${k(r.label)}`);
  const ol = d.outcomeLabels;
  if (d.outcomes && ol) {
    const { shown } = outcomeRowsShown(d.outcomes as { you?: true; usual?: true }[], outcomesAll);
    for (const o of shown as NonNullable<PanelStepDetail["outcomes"]>) for (const x of ["picked", "lost", "none", "outside"] as const) if (ol[x]) num(w, o[x], `${d.heading} - ${o.name} - ${ol[x]}`, `${p}/outcome/${k(o.name)}/${x}`);
  }
  text(w, d.both, `${p}/both`, d.heading);
  if ("sections" in d)
    for (const s of d.sections ?? []) {
      for (const r of s.rows) num(w, r.num, `${s.title} - ${r.label}`, `${p}/section/${k(s.title)}/${k(r.label)}`);
      text(w, s.note, `${p}/section/${k(s.title)}/note`, s.title);
    }
}

function condNums(w: W, c: PanelConditions | undefined, comp: boolean, all: boolean, p = "conditions") {
  if (!c) return;
  for (const [side, title, also] of [["toward", c.towardTitle, c.alsoToward], ["away", c.awayTitle, c.alsoAway]] as const) {
    for (const r of conditionRowsShown(c[side], all)) {
      const rp = `${p}/${side}/${k(r.text)}`;
      num(w, r.share, `${c.title} - ${title} ${r.text}`, `${rp}/share`);
      num(w, r.both?.either, `${c.title} - ${r.text} - ${also}`, `${rp}/also`);
      if (comp) for (const x of r.to ?? []) num(w, x.num, `${c.title} - ${r.text} - ${x.name}`, `${rp}/to/${k(x.name)}`);
      num(w, r.youPicked, `${c.title} - ${r.text} - you are the pick`, `${rp}/youPicked`);
    }
  }
}

const tableNums = (w: W, t: PanelTable | undefined, p: string) => {
  if (!t) return;
  for (const r of t.rows)
    r.cells.forEach((c, i) => {
      if (!c) return;
      const words = `${t.title} - ${r.label} - ${t.columns[i] ?? ""}`;
      const cp = `${p}/${k(t.title)}/${k(r.label)}/${i}`;
      if (isSpan(c)) text(w, [c], cp, words);
      else num(w, c, words, cp);
    });
};
const weighNums = (w: W, x: PanelWeighs | undefined, p: string) => {
  if (!x) return;
  x.columns.forEach((c, ci) => {
    for (const r of c.rows) {
      num(w, r.num, `${x.title} - ${c.title ?? ""} - ${r.name}`, `${p}/${ci}/${k(r.name)}/num`);
      if (r.other) num(w, r.other.num, `${x.title} - ${r.other.label} - ${r.name}`, `${p}/${ci}/${k(r.name)}/other`);
    }
  });
};

/** PositionPanelView in one state. */
function panelState(pp: PositionPanel, usualSteps: PanelStep[] | undefined, comp: boolean, sel: string | undefined, condAll: boolean, outAll: boolean, P: Paths, other = false): Out {
  const w: W = { out: [], P, other };
  text(w, pp.claim, "claim", "claim");
  text(w, pp.lead, "lead", "lead");
  text(w, pp.thin, "thin");
  const { selectable, defaultSel } = panelSelection(pp, comp);
  const details = (comp ? pp.detailsComp : pp.details) ?? {};
  const labels = { here: pp.hereKey ?? "You", usual: pp.usualKey ?? "" };
  for (const s of pp.steps) stepNums(w, s, usualSteps?.find((u) => u.key === s.key), comp, labels);
  for (const b of PANEL_ORDER[pp.kind] ?? []) {
    if (b === "byproduct") tableNums(w, pp.byProduct, "byProduct");
    if (b === "detail") {
      const d = sel ? details[sel as keyof typeof details] : undefined;
      if (d) detailNums(w, d, outAll, `${comp && d !== pp.details?.[sel as keyof typeof details] ? "detailComp" : "detail"}/${k(sel!)}`);
      else if (!selectable || sel === defaultSel) {
        const pd = comp ? pp.detailComp ?? pp.detail : pp.detail;
        if (pd) text(w, pd.body, `${comp && pd !== pp.detail ? "detailComp" : "detail"}/_panel/body`, pd.heading);
      }
    }
    if (b === "conditions") condNums(w, pp.conditions, comp, condAll);
    if (b === "competitors" && competitorsShown(pp, comp))
      for (const r of pp.competitors!.rows) {
        // The Other row is "competitors/~other"; its brands, drawn when it is opened, "competitors/~other/<name>".
        num(w, r.num, `${pp.competitors!.title} - ${r.shown ?? (r.you ? "You" : r.name)}`, `competitors/${r.you ? "you" : r.other ? "~other" : k(r.name)}`);
        if (r.other && other) for (const x of r.other.rows) num(w, x.num, `${pp.competitors!.title} - Other - ${x.name}`, `competitors/~other/${k(x.name)}`);
      }
    // The competitor group's Other row with no bar (its brands drawn when it is opened).
    if (b === "competitors" && competitorsShown(pp, comp) && other && pp.competitors!.other)
      for (const x of pp.competitors!.other.rows) num(w, x.num, `${pp.competitors!.title} - Other - ${x.name}`, `competitors/~other/${k(x.name)}`);
    if (b === "lines") for (const l of (comp ? pp.linesComp ?? pp.lines : pp.lines) ?? []) text(w, l.value, `lines/${k(l.key ?? l.label)}`, l.label);
    if (b === "weighs") {
      const x = comp ? pp.weighsComp ?? pp.weighs : pp.weighs;
      weighNums(w, x, comp && x !== pp.weighs ? "weighs/comp" : "weighs/plain");
    }
    if (b === "ends") weighNums(w, pp.ends, "ends");
    if (b === "table") {
      const t = comp ? pp.tableComp ?? pp.table : pp.table;
      tableNums(w, t, comp && t !== pp.table ? "tableComp" : "table");
    }
    if (b === "tables") for (const t of pp.tables ?? []) tableNums(w, t, "tables");
  }
  return w.out;
}

/** RivalInCell (panel 11) as it opens. */
function rivalInCellState(r: PanelRival, P: Paths): Out {
  const w: W = { out: [], P };
  text(w, r.claim, "claim", `${r.name} claim`);
  text(w, r.lead, "lead", r.name);
  text(w, r.thin, "thin");
  for (const s of r.steps) stepNums(w, s, undefined, false, { here: "You", usual: "" }, r.name);
  const sel = rivalInCellDefault(r);
  const d = sel ? (r.details ?? {})[sel as "named"] : undefined;
  if (d) detailNums(w, d, false, `detail/${k(sel!)}`, r.name);
  condNums(w, r.conditions, false, false);
  for (const l of r.lines ?? []) text(w, l.value, `lines/${k(l.key ?? l.label)}`, l.label);
  weighNums(w, r.weighs, "weighs/plain");
  for (const c of r.byCell ?? []) {
    num(w, c.rival, `${r.byCellTitle ?? ""} - ${c.label} - ${r.name}`, `byCell/${k(c.cellId)}/rival`);
    num(w, c.you, `${r.byCellTitle ?? ""} - ${c.label} - You`, `byCell/${k(c.cellId)}/you`);
  }
  return w.out;
}

const keyOf = (e: { value: string; words: string }) => `${e.value}\u0000${e.words}`;
const tag = (xs: Out, at: IndexEntry["at"], reveal: PanelReveal | undefined, part = ""): WalkEntry[] => xs.map((x) => ({ ...x, at, ...(reveal ? { reveal } : {}), part }));
/** The index view of a walk: first (value, words) wins, in walk order - the bf33 index exactly. */
function dedupe(xs: WalkEntry[]): WalkEntry[] {
  const seen = new Set<string>();
  const out: WalkEntry[] = [];
  for (const x of xs) {
    const kk = keyOf(x);
    if (seen.has(kk)) continue;
    seen.add(kk);
    out.push(x);
  }
  return out;
}
const toIndex = (x: WalkEntry): IndexEntry => ({ value: x.value, words: x.words, at: x.at, ...(x.reveal ? { reveal: x.reveal } : {}) });

/** The full walk of a cell's card, every state in order (default first, then each one-interaction state). */
export function walkPanel(p: Position, usualSteps?: PanelStep[]): WalkEntry[] {
  const pp = p.panel;
  if (!pp) return [];
  const P = new Paths();
  const out: WalkEntry[] = [];
  const { selectable, defaultSel } = panelSelection(pp, false);
  out.push(...tag(panelState(pp, usualSteps, false, defaultSel, false, false, P), "default", undefined));
  // One interaction: another step, the competitors switch, a fold, a rival's own card.
  if (selectable) for (const s of pp.steps) if (s.key !== defaultSel && pp.details?.[s.key]) out.push(...tag(panelState(pp, usualSteps, false, s.key, false, false, P), "one", { step: s.key }));
  if (pp.compare) out.push(...tag(panelState(pp, usualSteps, true, panelSelection(pp, true).defaultSel, false, false, P), "one", { competitors: true }));
  // The competitor group's Other rows, opened (with competitors shown).
  if (pp.compare && (pp.steps.some((s) => !!s.other) || pp.competitors?.rows.some((r) => !!r.other) || !!pp.competitors?.other))
    out.push(...tag(panelState(pp, usualSteps, true, panelSelection(pp, true).defaultSel, false, false, P, true), "one", { competitors: true, fold: "other" }));
  if (pp.conditions && conditionsFold(pp.conditions.toward, pp.conditions.away)) out.push(...tag(panelState(pp, usualSteps, false, defaultSel, true, false, P), "one", { fold: "conditions" }));
  out.push(...tag(panelState(pp, usualSteps, false, defaultSel, false, true, P), "one", { fold: "outcomes" }));
  for (const r of pp.rivals ?? []) out.push(...tag(rivalInCellState(r, new Paths()).map((x) => ({ ...x, words: `${r.name} - ${x.words}` })), "one", { rival: r.name }, `rival:${r.name}`));
  return out;
}

/** Every number on a cell's card. `usualSteps` = the row's All cell's steps (drawn as the usual bars). */
export function indexPanel(p: Position, usualSteps?: PanelStep[]): IndexEntry[] {
  return dedupe(walkPanel(p, usualSteps)).map(toIndex);
}
/** indexPanel with each entry's location kept (the harness reads it). */
export function indexPanelWalk(p: Position, usualSteps?: PanelStep[]): WalkEntry[] {
  return dedupe(walkPanel(p, usualSteps));
}

/** RivalAcrossView (the By rival card) in one state. */
function acrossState(r: RivalAcross, sel: string | undefined, condAll: boolean, P: Paths): Out {
  const w: W = { out: [], P };
  text(w, r.claim, "claim", `${r.name} claim`);
  for (const s of r.steps) for (const b of s.bars) if (b.who !== "other") num(w, b.num, `${s.label} - ${b.who === "rival" ? r.name : "You"}`, `steps/${k(s.key)}/bar/${b.who}`);
  const s = r.steps.find((x) => x.key === sel) ?? r.steps[0];
  if (s) {
    const p = `steps/${k(s.key)}`;
    text(w, s.body, `${p}/body`, s.heading);
    for (const b of s.bars) num(w, b.num, `${s.label} - ${b.name}`, b.who === "other" ? `${p}/bar/other/${k(b.name)}` : `${p}/bar/${b.who}`);
    condNums(w, s.conditions, false, condAll, `${p}/conditions`);
    tableNums(w, s.table, `${p}/table`);
    text(w, s.fold, `${p}/fold`, s.label);
  }
  tableNums(w, r.byBuyer, "byBuyer");
  tableNums(w, r.products, "products");
  return w.out;
}

/** The full walk of a rival's By rival card, every state in order. */
export function walkAcross(r: RivalAcross): WalkEntry[] {
  const P = new Paths();
  const out: WalkEntry[] = [];
  const def = acrossDefault(r);
  out.push(...tag(acrossState(r, def, false, P), "default", undefined));
  for (const s of r.steps) if (s.key !== def) out.push(...tag(acrossState(r, s.key, false, P), "one", { step: s.key }));
  const ds = r.steps.find((x) => x.key === def);
  if (ds?.conditions && conditionsFold(ds.conditions.toward, ds.conditions.away)) out.push(...tag(acrossState(r, def, true, P), "one", { fold: "conditions" }));
  return out;
}

/** Every number on a rival's By rival card. */
export function indexAcross(r: RivalAcross): IndexEntry[] {
  return dedupe(walkAcross(r)).map(toIndex);
}
export function indexAcrossWalk(r: RivalAcross): WalkEntry[] {
  return dedupe(walkAcross(r));
}
