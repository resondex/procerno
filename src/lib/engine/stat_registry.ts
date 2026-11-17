/**
 * The stat registry (2026-11-17, "one engine, stat IDs", stage 1). Every number a card draws - a Map cell's card,
 * a rival's own card inside a cell, a rival's By rival card - is one Stat with a stable id nested by location:
 *
 *   <dest>::<path>
 *   dest = cell:<cellId> | cell:<cellId>/rival:<name> | rival:<name>
 *   path = steps/<stepKey>/you | steps/<stepKey>/rival/<name> | steps/<stepKey>/vs | steps/<stepKey>/usual
 *        | steps/<stepKey>/seg/<segKey> | lines/<lineKey>/<spanKey|i> | competitors/<name|you>
 *        | conditions/<toward|away>/<row text>/<share|also|to/<name>|youPicked>
 *        | weighs/<plain|comp>/<col>/<row name>/<num|other> | table/<title>/<row label>/<col>
 *        | detail/<stepKey>/... | claim/<i> | (By rival) steps/<stepKey>/bar/<rival|you> | steps/<stepKey>/body/<key|i> ...
 *
 * Built from the one walk in panel_index.ts (the same decisions the card UI draws from, panel_view.ts), so a stat
 * exists exactly where a card shows the number. `at` / `reveal` are the cheapest state that shows it (by default
 * wins); `views` keeps every state the walk met it in (the words beside it can differ between views: "You, with
 * this buyer" in the normal view, "You" with competitors on).
 *
 * The Brief takes its funnel figures from here as Stat objects (brief.ts), never as numbers it computes.
 */
import type { AnalysisMapView } from "./analysis_types";
import type { PanelReveal } from "./panel_view";
import { walkAcross, walkPanel, type WalkEntry } from "./panel_index";

export type StatDest = { kind: "cell"; id: string } | { kind: "rival"; name: string };

export interface StatView {
  at: "default" | "one";
  reveal?: PanelReveal;
  words: string;
}

export interface Stat {
  id: string;
  /** As the card renders it ("47%", "<1%", "6.7%"). */
  value: string;
  /** 0-100, the bar width (absent on a number inside a sentence). */
  pct?: number;
  /** Stage 3: the exact counts behind the number (absent on a number inside an unkeyed sentence) - what the Brief
   * decides with (rateOf, brief_figs.ts), so a sentence decides from the very figure it prints. */
  k?: number;
  n?: number;
  /** The card to open. */
  dest: StatDest;
  at: "default" | "one";
  reveal?: PanelReveal;
  /** The words beside it in its cheapest view. */
  words: string;
  views: StatView[];
}

/** A path segment as the walk writes it (the path separator in a label is replaced). */
export const seg = (s: string | number) => String(s).replace(/\//g, "∕");

/** Stat id constructors - callers never hand-write id strings. */
export const statId = {
  cell: (cellId: string) => `cell:${cellId}`,
  cellRival: (cellId: string, name: string) => `cell:${cellId}/rival:${name}`,
  rival: (name: string) => `rival:${name}`,
  at: (dest: string, path: string) => `${dest}::${path}`,
  /** A step's bar on a cell's card: you, the usual (or the average competitor), the matchup rival (vs), or one competitor. */
  step: (cellId: string, stepKey: string, who: "you" | "usual" | "vs" | { rival: string }) =>
    `cell:${cellId}::steps/${seg(stepKey)}/${typeof who === "string" ? who : `rival/${seg(who.rival)}`}`,
  segment: (cellId: string, stepKey: string, segKey: string) => `cell:${cellId}::steps/${seg(stepKey)}/seg/${seg(segKey)}`,
  /** The prefix of one section's rows in a step's explanation (each row: prefix + row label). */
  section: (cellId: string, stepKey: string, title: string) => `cell:${cellId}::detail/${seg(stepKey)}/section/${seg(title)}/`,
  /** A number on a line of a cell's card: by its span key ("you", "avg", "usual", "rate") or its order. */
  line: (cellId: string, lineKey: string, i: string | number) => `cell:${cellId}::lines/${seg(lineKey)}/${seg(i)}`,
  competitor: (cellId: string, name: string | "you") => `cell:${cellId}::competitors/${name === "you" ? "you" : seg(name)}`,
  condition: (cellId: string, side: "toward" | "away", row: string, what: "share" | "also" | "youPicked" | { to: string }) =>
    `cell:${cellId}::conditions/${side}/${seg(row)}/${typeof what === "string" ? what : `to/${seg(what.to)}`}`,
  weighs: (cellId: string, view: "plain" | "comp", col: number, row: string, what: "num" | "other") => `cell:${cellId}::weighs/${view}/${col}/${seg(row)}/${what}`,
  table: (cellId: string, title: string, row: string, col: number, view: "table" | "tableComp" | "tables" | "byProduct" = "table") =>
    `cell:${cellId}::${view}/${seg(title)}/${seg(row)}/${col}`,
  /** A By rival card's bar for one question: the rival's or yours. */
  rivalStep: (name: string, stepKey: string, who: "rival" | "you") => `rival:${name}::steps/${seg(stepKey)}/bar/${who}`,
  /** A number in a By rival card step's sentence, by its span key (or order). */
  rivalBody: (name: string, stepKey: string, key: string | number) => `rival:${name}::steps/${seg(stepKey)}/body/${seg(key)}`,
  /** A By rival card's table ("byBuyer", "products"), column by index. */
  rivalTable: (name: string, table: "byBuyer" | "products", title: string, row: string, col: number) => `rival:${name}::${table}/${seg(title)}/${seg(row)}/${col}`,
};

export interface StatRegistry {
  get(id: string): Stat | undefined;
  has(id: string): boolean;
  all(): Stat[];
  /** Typed queries (undefined when no card shows that fact). */
  step(cellId: string, stepKey: string, who: "you" | "usual" | "vs" | { rival: string }): Stat | undefined;
  /** Stage 4: one segment of a step's split bar (a verdict: "yes" / "no" / "depends", "keep" / "leave" / "none" ...). */
  segment(cellId: string, stepKey: string, segKey: string): Stat | undefined;
  /** Stage 4: the rows of one section of a step's explanation, in the card's own order. */
  section(cellId: string, stepKey: string, title: string): { label: string; stat: Stat }[];
  line(cellId: string, lineKey: string, i: string | number): Stat | undefined;
  competitor(cellId: string, name: string | "you"): Stat | undefined;
  rivalStep(name: string, stepKey: string, who: "rival" | "you"): Stat | undefined;
  rivalBody(name: string, stepKey: string, key: string | number): Stat | undefined;
  rivalTable(name: string, table: "byBuyer" | "products", title: string, row: string, col: number): Stat | undefined;
  /** The By rival cards that carry a step (every rival with a "named" stat, say). */
  rivalsWith(stepKey: string, who?: "rival" | "you"): string[];
  /** Same-id stats the walk met with two different values (always empty; the harness asserts it). */
  conflicts: { id: string; values: string[] }[];
}

const sameReveal = (a?: PanelReveal, b?: PanelReveal) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function buildStatRegistry(map: Pick<AnalysisMapView, "positions" | "rivalPanels">): StatRegistry {
  const byId = new Map<string, Stat>();
  const conflicts = new Map<string, Set<string>>();
  const add = (destId: string, dest: StatDest, e: WalkEntry) => {
    const id = `${destId}${e.part ? `/${e.part}` : ""}::${e.path}`;
    const view: StatView = { at: e.at, ...(e.reveal ? { reveal: e.reveal } : {}), words: e.words };
    const s = byId.get(id);
    if (!s) {
      byId.set(id, { id, value: e.value, ...(e.pct !== undefined ? { pct: e.pct } : {}), ...(e.kn ? { k: e.kn.k, n: e.kn.n } : {}), dest, at: e.at, ...(e.reveal ? { reveal: e.reveal } : {}), words: e.words, views: [view] });
      return;
    }
    if (s.value !== e.value) conflicts.set(id, (conflicts.get(id) ?? new Set([s.value])).add(e.value));
    if (!s.views.some((v) => v.at === view.at && sameReveal(v.reveal, view.reveal) && v.words === view.words)) s.views.push(view);
  };
  for (const [cellId, p] of Object.entries(map.positions)) {
    if (!p.panel) continue;
    const usual = p.panel.usualCellId ? map.positions[p.panel.usualCellId]?.panel?.steps : undefined;
    for (const e of walkPanel(p, usual)) add(statId.cell(cellId), { kind: "cell", id: cellId }, e);
  }
  for (const r of map.rivalPanels ?? []) for (const e of walkAcross(r)) add(statId.rival(r.name), { kind: "rival", name: r.name }, e);

  const rivalSteps = new Map<string, Set<string>>();
  for (const s of byId.values()) {
    const m = /^rival:(.+?)::steps\/([^/]+)\/bar\/(rival|you)$/.exec(s.id);
    if (m) {
      const k = `${m[2]}|${m[3]}`;
      if (!rivalSteps.has(k)) rivalSteps.set(k, new Set());
      rivalSteps.get(k)!.add(m[1]);
    }
  }
  const get = (id: string) => byId.get(id);
  return {
    get,
    has: (id) => byId.has(id),
    all: () => [...byId.values()],
    step: (c, k, w) => get(statId.step(c, k, w)),
    segment: (c, k, g) => get(statId.segment(c, k, g)),
    section: (c, k, title) => {
      const pre = statId.section(c, k, title);
      const out: { label: string; stat: Stat }[] = [];
      for (const s of byId.values()) {
        if (!s.id.startsWith(pre)) continue;
        const rest = s.id.slice(pre.length);
        if (!rest.includes("/")) out.push({ label: rest.replace(/∕/g, "/"), stat: s });
      }
      return out;
    },
    line: (c, k, i) => get(statId.line(c, k, i)),
    competitor: (c, n) => get(statId.competitor(c, n)),
    rivalStep: (n, k, w) => get(statId.rivalStep(n, k, w)),
    rivalBody: (n, k, key) => get(statId.rivalBody(n, k, key)),
    rivalTable: (n, t, title, row, col) => get(statId.rivalTable(n, t, title, row, col)),
    rivalsWith: (k, w = "rival") => [...(rivalSteps.get(`${k}|${w}`) ?? [])],
    conflicts: [...conflicts.entries()].map(([id, v]) => ({ id, values: [...v] })),
  };
}
