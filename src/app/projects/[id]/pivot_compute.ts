import type { ViewKey } from "@/lib/engine/views";
import type { WorkbenchView } from "@/lib/engine/workbench";
import {
  MEASURES,
  MEASURE_BY_ID,
  POOLS,
  R,
  illegalReason,
  poolAsks,
  type MeasureCtx,
  type MeasureDef,
  type WbRow,
} from "@/lib/engine/measures";
import { EVIDENCE_CAP } from "./evidence_panel";
import { TIER_LABEL } from "./view_parts";

/**
 * The Data page's pivot as a pure function (2026-11-11): settings + one
 * workbench payload -> rows, columns and cells. The builder renders it, and
 * Wave over wave runs the SAME function on the previous wave's payload, then
 * matches the two by label (`match`), never by index - index-based keys
 * (b3, e2) differ between runs.
 *
 * Legality stays in engine/measures.ts: a measure is read inside one pool,
 * and a measure or dimension the pool does not ask resolves away here (to
 * the pool's default measure, to "None"), so no table renders a number its
 * pool never asked.
 *
 * Settings name the brand and the argument by NAME, not index, so the same
 * settings resolve on another run's payload.
 */

export type DimKey = "none" | "room" | "worry" | "rival" | "stage" | "question" | "engine" | "vendor" | "tier" | "mode" | "brand" | "parent" | "argument";

export const DIMS: { key: DimKey; label: string }[] = [
  { key: "none", label: "None" },
  { key: "room", label: "Buying situation" },
  { key: "worry", label: "Worry" },
  { key: "rival", label: "Rival" },
  { key: "stage", label: "Question type" },
  { key: "question", label: "Question" },
  { key: "engine", label: "Assistant" },
  { key: "vendor", label: "AI company" },
  { key: "tier", label: "Free or paid" },
  { key: "mode", label: "Search on or off" },
  { key: "brand", label: "Brand" },
  { key: "parent", label: "Company" },
  { key: "argument", label: "Argument" },
];
export const DIM_LABEL = Object.fromEntries(DIMS.map((d) => [d.key, d.label])) as Record<DimKey, string>;

/** The measure a pool opens on. */
export const POOL_DEFAULT: Partial<Record<ViewKey, string>> = {
  headline: "chosen",
  premium_tier: "tier_premium",
  repertoire: "rep_stick",
  head_to_head_entity: "h2h_you",
  head_to_head_class: "h2h_you",
  offensive_capture: "chosen",
  defensive_hold: "keep",
  value: "worth_yes",
  criteria_taught: "argues",
  awareness_routing: "routed_category",
  awareness_explainer: "routed_category",
  doubt: "proceed",
  keep_or_leave: "keep",
  settled_business_case: "rel_strengthens",
  settled_expansion: "rel_strengthens",
  settled_ecosystem: "rel_strengthens",
  settled_advocacy: "rel_strengthens",
};

const MEASURE_LABEL: Record<string, string> = {
  chosen: "Picked",
  share_of_decided: "Share of picks",
  negative: "Named negatively",
  firm_pick: "Picks one",
  premise_rebuts: "Pushes back",
  exit_named: "Points to another brand",
};
export const mLabel = (m: MeasureDef) => MEASURE_LABEL[m.id] ?? m.label;
/** Plain-word explanations for the measures whose engine tip is written in
 * method vocabulary; every other renamed measure keeps "engine name: tip". */
const MEASURE_TIP: Record<string, string> = {
  share_of_decided: "Of the answers where the AI commits to one product in the category, the share that pick this brand.",
  chosen: "The share of all answers where this brand is the one product the AI picks.",
};
export const mTip = (m: MeasureDef) => MEASURE_TIP[m.id] ?? (MEASURE_LABEL[m.id] ? `${m.label}: ${m.tip}` : m.tip);

/** At most this many measures side by side (Columns = None only). */
export const MAX_MEASURES = 4;
/** Cells under this many answers are muted, starred, and get no change. */
export const THIN = 20;
/** Brand and argument dimensions list at most this many values. */
const DIM_CAP = 20;

/** Wilson 95% interval - the same math as engine/metrics.ts wilson(). */
export const wilson = (k: number, n: number) => {
  if (n === 0) return { low: 0, high: 0 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, center - m), high: Math.min(1, center + m) };
};
export const pct = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
/** Text shortened for a row (~90 chars) or a column header. */
export const shortText = (t: string, cap: number) => (t.length > cap ? `${t.slice(0, cap - 1).trimEnd()}…` : t);

/** What the user (or a library entry) asked for. */
export interface PivotSettings {
  pool: ViewKey | null;
  /** Measure ids; only the first is kept when Columns is a real dimension. */
  measures: string[];
  row: DimKey;
  col: DimKey;
  /** The brand a brand measure reads, by name; null = the tracker's own. */
  brand: string | null;
  /** The argument an incidence measure reads, by label; null = the first. */
  arg: string | null;
}

/** What the settings come to on one payload, after legality. */
export interface Resolved {
  pool: ViewKey;
  measures: MeasureDef[];
  rowDim: DimKey;
  colDim: DimKey;
  brand: number;
  arg: number;
  /** The pools this payload carries, in journey order. */
  present: ViewKey[];
  poolRows: WbRow[];
  needsBrand: boolean;
  needsArg: boolean;
}

/** The pools a payload carries, in journey order. */
export function presentPools(data: WorkbenchView): ViewKey[] {
  const seen = new Set<ViewKey>();
  for (const row of data.facts ?? []) for (const v of data.prompts[row[R.prompt]].views) seen.add(v);
  return POOLS.map((p) => p.key).filter((k) => seen.has(k));
}

/** Why a dimension cannot be used for this pool and measure; null = legal. */
export function dimReason(
  data: WorkbenchView,
  pool: ViewKey,
  measure: MeasureDef,
  poolRows: WbRow[],
  k: DimKey
): string | null {
  const anyPrompt = (f: (p: WorkbenchView["prompts"][number]) => boolean) => poolRows.some((r) => f(data.prompts[r[R.prompt]]));
  switch (k) {
    case "room":
      return anyPrompt((p) => p.room >= 0) ? null : "these questions are not asked per buying situation";
    case "worry":
      return anyPrompt((p) => p.worry >= 0) ? null : "these questions carry no worry";
    case "rival":
      return anyPrompt((p) => p.rival >= 0 || p.angle >= 0) ? null : "these questions name no rival";
    case "brand":
      return measure.brand ? null : "this measure is not per brand";
    case "parent":
      if (!measure.brand) return "this measure is not per brand";
      return data.brands.some((b) => b.listed && b.parent) ? null : "no parent companies set";
    case "argument":
      return poolAsks(pool, "arguments") ? null : "no arguments are coded for these questions";
    default:
      return null;
  }
}

export function resolveSettings(s: PivotSettings, data: WorkbenchView): Resolved | null {
  if (!data.facts) return null;
  const present = presentPools(data);
  const pool = s.pool && present.includes(s.pool) ? s.pool : present.includes("headline") ? "headline" : (present[0] ?? null);
  if (!pool) return null;
  let measures = [...new Set(s.measures)]
    .map((id) => MEASURE_BY_ID.get(id))
    .filter((m): m is MeasureDef => !!m && !illegalReason(m, pool));
  if (measures.length === 0) {
    const d = POOL_DEFAULT[pool];
    const fallback = d ? MEASURE_BY_ID.get(d) : undefined;
    const first = fallback && !illegalReason(fallback, pool) ? fallback : MEASURES.find((m) => !illegalReason(m, pool));
    if (!first) return null;
    measures = [first];
  }
  const poolRows = data.facts.filter((r) => data.prompts[r[R.prompt]].views.includes(pool));
  // A dimension must be legal for EVERY measure on the table.
  const legal = (k: DimKey) => measures.every((m) => !dimReason(data, pool, m, poolRows, k));
  const rowDim: DimKey = legal(s.row) ? s.row : "none";
  const colDim: DimKey = !legal(s.col) || s.col === rowDim ? "none" : s.col;
  if (colDim !== "none") measures = measures.slice(0, 1);
  measures = measures.slice(0, MAX_MEASURES);
  const named = s.brand === null ? -1 : data.brands.findIndex((b) => b.name === s.brand);
  const brand = named >= 0 ? named : data.target;
  const a = s.arg === null ? -1 : data.args.indexOf(s.arg);
  const arg = a >= 0 ? a : 0;
  const byBrand = (d: DimKey) => d === "brand" || d === "parent";
  return {
    pool,
    measures,
    rowDim,
    colDim,
    brand,
    arg,
    present,
    poolRows,
    needsBrand: measures.some((m) => m.brand) && !byBrand(rowDim) && !byBrand(colDim),
    needsArg: measures.some((m) => m.arg) && rowDim !== "argument" && colDim !== "argument",
  };
}

/** The settings a resolution stands for (to resolve the same table on
 * another wave's payload). */
export function settingsOf(r: Resolved, data: WorkbenchView): PivotSettings {
  return {
    pool: r.pool,
    measures: r.measures.map((m) => m.id),
    row: r.rowDim,
    col: r.colDim,
    brand: r.brand === data.target ? null : (data.brands[r.brand]?.name ?? null),
    arg: data.args[r.arg] ?? null,
  };
}

export interface Acc {
  k: number;
  n: number;
  ids: string[];
}

/** One dimension value: its key, label and (for brand / argument context)
 * what it sets on the measure. */
export interface DimValue {
  key: string;
  label: string;
  /** What matches it across waves (its label; a question's full text). */
  match: string;
  /** Question values: the full prompt text (tooltip, csv) and its stage. */
  full?: string;
  group?: string;
  brands?: Set<number>;
  arg?: number;
}

/** A column: a dimension value read with the table's one measure, or (when
 * Columns is None) one of the table's measures. */
export interface PivotCol extends DimValue {
  measure: MeasureDef;
}

export interface Pivot {
  rows: DimValue[];
  cols: PivotCol[];
  cells: Map<string, Acc>;
  answers: number;
}

export const cellKey = (r: DimValue, c: PivotCol) => `${r.key}|${c.key}`;

export function computePivot(res: Resolved, data: WorkbenchView): Pivot {
  const { measures, rowDim, colDim, brand, arg, poolRows } = res;
  const P = data.prompts;
  const engineOf = (r: WbRow) => data.engines[r[R.engine]];
  const lead = measures[0];

  // Brand / argument dimensions are CONTEXT for a measure that reads them
  // (every answer sits in every brand's cell, the measure evaluated for
  // that brand); argument is a FILTER otherwise (answers carrying it).
  const brandValues = (grain: "brand" | "parent"): DimValue[] => {
    if (grain === "brand") {
      return data.brands.flatMap((b, i) => (b.listed ? [{ key: `b${i}`, label: b.name, match: b.name, brands: new Set([i]) }] : []));
    }
    const groups = new Map<string, DimValue>();
    data.brands.forEach((b, i) => {
      if (!b.listed) return;
      const name = b.parent ?? b.name;
      const g = groups.get(name) ?? { key: `p${name}`, label: name, match: name, brands: new Set<number>() };
      g.brands!.add(i);
      groups.set(name, g);
    });
    return [...groups.values()];
  };
  const argValues: DimValue[] = data.args.map((a, i) => ({ key: `a${i}`, label: a, match: a, arg: i }));
  const one = (key: string, label: string): DimValue => ({ key, label, match: label });

  const valuesOf = (dim: DimKey): ((r: WbRow) => DimValue[]) | DimValue[] => {
    switch (dim) {
      case "none":
        return [one("all", "All answers")];
      case "room":
        return (r) => {
          const i = P[r[R.prompt]].room;
          return [i >= 0 ? one(`r${i}`, data.rooms[i]) : one("r-", "Every buyer (not one situation)")];
        };
      case "worry":
        return (r) => {
          const i = P[r[R.prompt]].worry;
          return [i >= 0 ? one(`w${i}`, data.worries[i]) : one("w-", "No worry")];
        };
      case "rival":
        return (r) => {
          const p = P[r[R.prompt]];
          if (p.rival >= 0) return [one(`b${p.rival}`, data.brands[p.rival].name)];
          if (p.angle >= 0) return [one(`g${p.angle}`, titleCase(data.angles[p.angle]))];
          return [one("-", "No rival named")];
        };
      case "stage":
        return (r) => {
          const s = P[r[R.prompt]].stage;
          return [one(s, titleCase(s))];
        };
      case "question":
        // One value per question (cell): its seed and paraphrases pool, the
        // seed wording names it. Pre-wb5 payloads fall back to one per prompt.
        return (r) => {
          const i = r[R.prompt];
          const p = P[i];
          const cell = p.cell ?? -1;
          const text = cell >= 0 && data.cells?.[cell] ? data.cells[cell] : p.text;
          return [{ key: cell >= 0 ? `q${cell}` : `p${i}`, label: shortText(text, 90), match: text, full: text, group: titleCase(p.stage) }];
        };
      case "engine":
        return (r) => [one(`e${r[R.engine]}`, engineOf(r).label)];
      case "vendor":
        // Engines pooled by vendor (older payloads carry no vendor: the label).
        return (r) => {
          const v = engineOf(r).vendor ?? engineOf(r).label;
          return [one(`v:${v}`, v)];
        };
      case "tier":
        return (r) => {
          const t = engineOf(r).tier ?? "both";
          return [one(`t:${t}`, TIER_LABEL[t])];
        };
      case "mode":
        return (r) => {
          const m = engineOf(r).mode;
          return [one(m, titleCase(m))];
        };
      case "brand":
      case "parent":
        return brandValues(dim);
      case "argument":
        if (lead.arg) return argValues;
        return (r) => r[R.args].map((a) => argValues[a]);
    }
  };
  const rowVals = valuesOf(rowDim);
  const at = (v: ((r: WbRow) => DimValue[]) | DimValue[], r: WbRow) => (typeof v === "function" ? v(r) : v);
  // Columns: one per measure when Columns is None, else the dimension's
  // values read with the one measure.
  const measureCols: PivotCol[] = measures.map((m) => ({ key: `m:${m.id}`, label: mLabel(m), match: `m:${m.id}`, measure: m }));
  const colVals = colDim === "none" ? null : valuesOf(colDim);
  const colsAt = (r: WbRow): PivotCol[] => (colVals ? at(colVals, r).map((v) => ({ ...v, measure: lead })) : measureCols);

  const cells = new Map<string, Acc>();
  const rowOrder = new Map<string, DimValue>();
  const colOrder = new Map<string, PivotCol>();
  const fixedBrands = new Set([brand]);
  for (const r of poolRows) {
    const prompt = P[r[R.prompt]];
    for (const rv of at(rowVals, r)) {
      for (const cv of colsAt(r)) {
        const ctx: MeasureCtx = {
          target: data.target,
          brands: rv.brands ?? cv.brands ?? fixedBrands,
          arg: rv.arg ?? cv.arg ?? arg,
          prompt,
        };
        const hit = cv.measure.calc(r, ctx);
        if (hit === null) continue;
        if (!rowOrder.has(rv.key)) rowOrder.set(rv.key, rv);
        if (!colOrder.has(cv.key)) colOrder.set(cv.key, cv);
        const key = `${rv.key}|${cv.key}`;
        const acc = cells.get(key) ?? { k: 0, n: 0, ids: [] };
        acc.n++;
        if (hit === 1) {
          acc.k++;
          if (acc.ids.length < EVIDENCE_CAP) acc.ids.push(data.responseIds[r[R.response]]);
        }
        cells.set(key, acc);
      }
    }
  }

  // Order: context lists (brands, arguments) by numerator volume, capped;
  // everything else in first-seen order of its own index.
  const ordered = <V extends DimValue>(m: Map<string, V>, dim: DimKey, side: "row" | "col"): V[] => {
    let list = [...m.values()];
    if (side === "col" && dim === "none") {
      // Measure columns keep the order the user put them in.
      const order = measures.map((x) => `m:${x.id}`);
      return list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    }
    const total = (v: DimValue) => {
      let k = 0;
      for (const [key, acc] of cells) {
        const [rk, ck] = key.split("|");
        if ((side === "row" ? rk : ck) === v.key) k += acc.k;
      }
      return k;
    };
    if (dim === "brand" || dim === "parent" || (dim === "argument" && lead.arg)) {
      list = list
        .map((v) => ({ v, k: total(v) }))
        .filter((s) => s.k > 0 || s.v.brands?.has(data.target))
        .sort((a, b) => b.k - a.k || a.v.label.localeCompare(b.v.label))
        .slice(0, DIM_CAP)
        .map((s) => s.v);
    } else if (dim === "question") {
      // Grouped under the stage, then the questions carrying most of the
      // numerator first - one question can own a tracker's number.
      list = list
        .map((v) => ({ v, k: total(v) }))
        .sort((a, b) => (a.v.group ?? "").localeCompare(b.v.group ?? "") || b.k - a.k || a.v.label.localeCompare(b.v.label))
        .map((s) => s.v);
    } else if (dim === "engine") {
      list.sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
    } else {
      // Alphabetical, with the catch-all bucket ("not one situation", "no
      // worry", "no rival") last.
      const last = (v: DimValue) => (v.key.endsWith("-") ? 1 : 0);
      list.sort((a, b) => last(a) - last(b) || a.label.localeCompare(b.label));
    }
    return list;
  };
  return {
    rows: ordered(rowOrder, rowDim, "row"),
    cols: ordered(colOrder, colDim, "col"),
    cells,
    answers: poolRows.length,
  };
}

/** The previous wave's cell for this wave's (row, column), matched by label. */
export function matchPrev(prev: Pivot | null): ((r: DimValue, c: PivotCol) => Acc | undefined) | null {
  if (!prev) return null;
  const rows = new Map(prev.rows.map((r) => [r.match, r]));
  const cols = new Map(prev.cols.map((c) => [c.match, c]));
  return (r, c) => {
    const pr = rows.get(r.match);
    const pc = cols.get(c.match);
    return pr && pc ? prev.cells.get(cellKey(pr, pc)) : undefined;
  };
}

/** Change in points, or null when either side is missing or thin. */
export function changePts(now: Acc | undefined, before: Acc | undefined): number | null {
  if (!now || !before || now.n < THIN || before.n < THIN) return null;
  return Math.round((now.k / now.n) * 100) - Math.round((before.k / before.n) * 100);
}
