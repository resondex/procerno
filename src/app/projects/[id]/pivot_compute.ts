import type { WorkbenchView } from "@/lib/engine/workbench_rows";
import { R, decodeFacts } from "@/lib/engine/workbench_rows";
import type { AnswerFact } from "@/lib/engine/facts/answer_facts";
import { factId, type Scope } from "@/lib/engine/facts/fact_id";
import {
  DATA_MEASURES,
  DATA_POOLS,
  DATA_POOL_BY_KEY,
  MEASURE_BY_ID,
  dataIllegal,
  printOf,
  type DataMeasure,
  type DataPoolKey,
  type MeasureCtx,
} from "@/lib/engine/facts/measure_book";
import { EVIDENCE_CAP } from "./evidence_panel";
import { MODE_LABEL, TIER_LABEL } from "./view_parts";

/**
 * The Data page's pivot as a pure function (2026-11-11): settings + one
 * workbench payload -> rows, columns and cells. The builder renders it, and
 * Wave over wave runs the SAME function on the previous wave's payload, then
 * matches the two by label (`match`), never by index - index-based keys
 * (b3, e2) differ between runs.
 *
 * Fact layer step 6 (2026-11-17): the payload is the run's answer facts and
 * every cell is a FACT - a measure from the one measure book
 * (engine/facts/measure_book.ts), about a subject, in a scope - counted here
 * with the measure's own base and numerator, and carrying its fact id (not
 * drawn) so a check can recompute it on the server. A measure is read inside
 * one group of questions and only where the book makes it legal on every
 * question type in the group; a measure or dimension that is not legal
 * resolves away here (to the group's default number, to "None"), so no table
 * renders a number its questions never asked.
 *
 * Settings name the brand, the argument and the source by NAME, not index,
 * so the same settings resolve on another run's payload.
 *
 * Sources (2026-11-18): the sites a search assistant's answer cites
 * (facts/sources.ts). "Source" works like "Argument": a context list when the
 * lead number reads a source (each row reads its own site), a filter
 * otherwise (the answers citing that site, scope `when` "srcany:<site>").
 */

export type DimKey = "none" | "room" | "worry" | "rival" | "stage" | "question" | "engine" | "vendor" | "tier" | "mode" | "brand" | "parent" | "argument" | "source";

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
  { key: "source", label: "Source" },
];
export const DIM_LABEL = Object.fromEntries(DIMS.map((d) => [d.key, d.label])) as Record<DimKey, string>;
const DIM_KEYS = new Set<string>(DIMS.map((d) => d.key));

/** A dimension as a noun inside a sentence ("for each buying situation"). */
export const DIM_NOUN: Record<DimKey, string> = {
  none: "",
  room: "buying situation",
  worry: "worry",
  rival: "rival",
  stage: "question type",
  question: "question",
  engine: "assistant",
  vendor: "AI company",
  tier: "free or paid tier",
  mode: "search setting",
  brand: "brand",
  parent: "company",
  argument: "argument",
  source: "source",
};

/** Dimensions a table can be narrowed to one value of ("only this buyer"):
 * attributes of the answer itself, never a brand or argument context. */
export const FILTER_DIMS: readonly DimKey[] = ["room", "worry", "rival", "engine", "vendor", "tier", "mode"];

/** Narrow a table to the answers carrying one value of a dimension, matched
 * by label so the same filter resolves on another wave. */
export interface PivotWhere {
  dim: DimKey;
  label: string;
}

/** The number a group of questions opens on. */
export const POOL_DEFAULT: Partial<Record<DataPoolKey, string>> = {
  what_to_buy: "picked",
  popular: "picked",
  premium: "tier_premium",
  habit: "habit_stick",
  h2h: "h2h_you",
  h2h_class: "h2h_you",
  switching: "picked",
  looking_around: "stay",
  value: "worth_yes",
  criteria: "argues",
  problem: "routed_category",
  learning: "routed_category",
  buyers_worries: "go_ahead",
  customers_worries: "stay",
  business_case: "relationship_strengthens",
  expansion: "relationship_strengthens",
  ecosystem: "relationship_strengthens",
  advocacy: "relationship_strengthens",
};

/** A Data page number: a measure of the book, as the page offers it (`brand`: read for a brand, or the row's). */
export type MeasureDef = DataMeasure & { brand: boolean };
/** Every number the page offers, in picker order. */
export const MEASURES: readonly MeasureDef[] = DATA_MEASURES.map((m) => ({ ...m, brand: m.subject === "brand" }));
const DATA_BY_ID = new Map(MEASURES.map((m) => [m.id, m]));

export const mLabel = (m: MeasureDef) => m.label;
export const mTip = (m: MeasureDef) => m.tip;

/** Why a number cannot be read on a group of questions (the book's legality); null = legal. */
export const illegalReason = (m: MeasureDef, pool: DataPoolKey) => dataIllegal(m, pool);
/** The groups a number can be read on, in journey order. */
export const legalPools = (m: MeasureDef): DataPoolKey[] => DATA_POOLS.map((p) => p.key).filter((k) => !illegalReason(m, k));

/** At most this many measures side by side (Columns = None only). */
export const MAX_MEASURES = 4;
/** Cells under this many answers are muted, starred, and get no change. */
export const THIN = 20;
/** Brand, argument and source dimensions list at most this many values. */
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
  pool: DataPoolKey | null;
  /** Number ids (DATA_MEASURES); only the first is kept when Columns is a real dimension. */
  measures: string[];
  row: DimKey;
  col: DimKey;
  /** The brand a brand measure reads, by name; null = the tracker's own. */
  brand: string | null;
  /** The argument an incidence measure reads, by label; null = the first. */
  arg: string | null;
  /** The source (site) a source number reads, by name; null = the most cited. */
  src: string | null;
  /** Only the answers carrying this value (search sets it); absent = all. */
  where?: PivotWhere | null;
}

/** Settings read back from storage: anything malformed falls back. */
export function sanitizeSettings(x: unknown): PivotSettings | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const dim = (v: unknown): DimKey => (typeof v === "string" && DIM_KEYS.has(v) ? (v as DimKey) : "none");
  const w = o.where as Record<string, unknown> | null | undefined;
  return {
    pool: typeof o.pool === "string" && DATA_POOL_BY_KEY.has(o.pool as DataPoolKey) ? (o.pool as DataPoolKey) : null,
    measures: Array.isArray(o.measures) ? o.measures.filter((m): m is string => typeof m === "string").slice(0, MAX_MEASURES) : [],
    row: dim(o.row),
    col: dim(o.col),
    brand: typeof o.brand === "string" ? o.brand : null,
    arg: typeof o.arg === "string" ? o.arg : null,
    src: typeof o.src === "string" ? o.src : null,
    where:
      w && typeof w === "object" && typeof w.label === "string" && FILTER_DIMS.includes(dim(w.dim))
        ? { dim: dim(w.dim), label: w.label }
        : null,
  };
}

/** What the settings come to on one payload, after legality. */
export interface Resolved {
  pool: DataPoolKey;
  measures: MeasureDef[];
  rowDim: DimKey;
  colDim: DimKey;
  brand: number;
  arg: number;
  /** Index into the payload's `sources`. */
  src: number;
  /** The groups this payload carries, in journey order. */
  present: DataPoolKey[];
  /** The group's answers (the filter applied). */
  poolRows: AnswerFact[];
  needsBrand: boolean;
  needsArg: boolean;
  needsSrc: boolean;
  /** The filter, when legal for this group; poolRows are already narrowed. */
  where: PivotWhere | null;
}

/** The groups a payload carries, in journey order. */
export function presentPools(data: WorkbenchView): DataPoolKey[] {
  const seen = new Set<DataPoolKey>();
  for (const row of data.facts ?? []) seen.add(data.prompts[row[R.prompt]].pool);
  return DATA_POOLS.map((p) => p.key).filter((k) => seen.has(k));
}

/** Why a dimension cannot be used for this group and number; null = legal. */
export function dimReason(data: WorkbenchView, pool: DataPoolKey, measure: MeasureDef, poolRows: AnswerFact[], k: DimKey): string | null {
  void pool;
  switch (k) {
    case "room":
      return poolRows.some((f) => f.situation !== null) ? null : "these questions are not asked per buying situation";
    case "worry":
      return poolRows.some((f) => f.worry !== null) ? null : "these questions carry no worry";
    case "rival":
      return poolRows.some((f) => f.rival !== null) ? null : "these questions name no rival";
    case "brand":
      return measure.brand ? null : "this measure is not per brand";
    case "parent":
      if (!measure.brand) return "this measure is not per brand";
      return data.brands.some((b) => b.listed && b.parent) ? null : "no parent companies set";
    case "argument":
      return poolRows.some((f) => (f.args ?? []).length > 0) ? null : "no arguments are coded for these questions";
    case "source":
      return poolRows.some((f) => (f.sources ?? []).length > 0) ? null : "none of these answers cite a source";
    default:
      return null;
  }
}

/** The group's answers (the payload's decoded answer facts in it). */
const poolAnswers = (data: WorkbenchView, pool: DataPoolKey) => {
  const all = decodeFacts(data);
  return all.filter((_, i) => data.prompts[data.facts[i][R.prompt]].pool === pool);
};

export function resolveSettings(s: PivotSettings, data: WorkbenchView): Resolved | null {
  if (!data.facts) return null;
  const present = presentPools(data);
  const pool = s.pool && present.includes(s.pool) ? s.pool : present.includes("what_to_buy") ? "what_to_buy" : (present[0] ?? null);
  if (!pool) return null;
  let measures = [...new Set(s.measures)]
    .map((id) => DATA_BY_ID.get(id))
    .filter((m): m is MeasureDef => !!m && !illegalReason(m, pool));
  if (measures.length === 0) {
    const d = POOL_DEFAULT[pool];
    const fallback = d ? DATA_BY_ID.get(d) : undefined;
    const first = fallback && !illegalReason(fallback, pool) ? fallback : MEASURES.find((m) => !illegalReason(m, pool));
    if (!first) return null;
    measures = [first];
  }
  const allPoolRows = poolAnswers(data, pool);
  // A dimension must be legal for EVERY measure on the table.
  const legal = (k: DimKey) => measures.every((m) => !dimReason(data, pool, m, allPoolRows, k));
  const where = s.where && FILTER_DIMS.includes(s.where.dim) && legal(s.where.dim) ? s.where : null;
  const poolRows = where ? allPoolRows.filter((f) => whereLabel(data, where.dim, f) === where.label) : allPoolRows;
  const rowDim: DimKey = legal(s.row) ? s.row : "none";
  const colDim: DimKey = !legal(s.col) || s.col === rowDim ? "none" : s.col;
  if (colDim !== "none") measures = measures.slice(0, 1);
  measures = measures.slice(0, MAX_MEASURES);
  const named = s.brand === null ? -1 : data.brands.findIndex((b) => b.listed && b.name === s.brand);
  const brand = named >= 0 ? named : data.target;
  const a = s.arg === null ? -1 : data.args.indexOf(s.arg);
  const arg = a >= 0 ? a : 0;
  const sx = s.src === null || !data.sources ? -1 : data.sources.indexOf(s.src);
  const src = sx >= 0 ? sx : 0;
  const byBrand = (d: DimKey) => d === "brand" || d === "parent";
  return {
    pool,
    measures,
    rowDim,
    colDim,
    brand,
    arg,
    src,
    present,
    poolRows,
    needsBrand: measures.some((m) => m.brand) && !byBrand(rowDim) && !byBrand(colDim),
    needsArg: measures.some((m) => m.arg) && rowDim !== "argument" && colDim !== "argument",
    needsSrc: measures.some((m) => m.src) && rowDim !== "source" && colDim !== "source",
    where,
  };
}

/** The label an answer carries on a filterable dimension (the same labels computePivot's rows use). */
export function whereLabel(data: WorkbenchView, dim: DimKey, f: AnswerFact): string | null {
  const e = f.engine;
  switch (dim) {
    case "room":
      return f.situation;
    case "worry":
      return f.worry;
    case "rival":
      return f.rival?.name ?? null;
    case "engine":
      return data.engines.find((x) => x.id === e.id)?.label ?? e.id;
    case "vendor":
      return e.vendor;
    case "tier":
      return TIER_LABEL[e.tier as keyof typeof TIER_LABEL] ?? e.tier;
    case "mode":
      return MODE_LABEL[e.mode as keyof typeof MODE_LABEL] ?? e.mode;
    default:
      return null;
  }
}

/** The scope a filter stands for (the answers carrying its label). */
function whereScope(data: WorkbenchView, w: PivotWhere, rows: AnswerFact[]): Partial<Scope> {
  const f = rows.find((x) => whereLabel(data, w.dim, x) === w.label);
  if (!f) return {};
  switch (w.dim) {
    case "room":
      return { situation: f.situation };
    case "worry":
      return { worry: f.worry };
    case "rival":
      return { rival: f.rival?.key ?? "generic" };
    case "engine":
      return { engines: [f.engine.id] };
    case "vendor":
      return { vendor: f.engine.vendor };
    case "tier":
      return { tier: f.engine.tier };
    case "mode":
      return { mode: f.engine.mode };
    default:
      return {};
  }
}

/** The settings a resolution stands for (to resolve the same table on another wave's payload). */
export function settingsOf(r: Resolved, data: WorkbenchView): PivotSettings {
  return {
    pool: r.pool,
    measures: r.measures.map((m) => m.id),
    row: r.rowDim,
    col: r.colDim,
    brand: r.brand === data.target ? null : (data.brands[r.brand]?.name ?? null),
    arg: data.args[r.arg] ?? null,
    src: data.sources?.[r.src] ?? null,
    where: r.where,
  };
}

/** A cell: its counts, its printed text (the measure's print rule), the answers it counts (the evidence drill) and
 * the fact it is - not drawn; the check recomputes it on the server from this id alone. */
export interface Acc {
  k: number;
  n: number;
  ids: string[];
  text: string;
  fact: string;
}

/** One dimension value: its key, label and what it sets on the cell's fact - a part of the scope, a subject (a
 * brand or a company) or an argument. */
export interface DimValue {
  key: string;
  label: string;
  /** What matches it across waves (its label; a question's full text). */
  match: string;
  /** Question values: the full prompt text (tooltip, csv) and its question type. */
  full?: string;
  group?: string;
  /** Brand / company context: the brand indexes it reads. */
  brands?: Set<number>;
  /** The fact subject it sets (a brand key, "co:<company>"). */
  subject?: string;
  arg?: number;
  /** Source context: the index into `sources` it reads. */
  src?: number;
  /** The scope fields it narrows. */
  scope?: Partial<Scope>;
}

/** A column: a dimension value read with the table's one measure, or (when Columns is None) one of the table's
 * measures. */
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

const enc = (s: string) => encodeURIComponent(s);

export function computePivot(res: Resolved, data: WorkbenchView): Pivot {
  const { measures, rowDim, colDim, brand, arg, src, poolRows, pool } = res;
  const lead = measures[0];
  const B = data.brands;
  const T = B[data.target];
  const set = { target: { key: T.key, name: T.name } } as unknown as MeasureCtx["set"];
  const engineScope: Partial<Scope> = data.engineScope ? { engines: data.engineScope } : {};
  const baseScope: Scope = { types: DATA_POOL_BY_KEY.get(pool)!.types, ...engineScope, ...(res.where ? whereScope(data, res.where, poolRows) : {}) };
  const labelOfEngine = new Map(data.engines.map((e) => [e.id, e.label]));
  const cellIndex = new Map(data.cellIds.map((id, i) => [id, i]));
  const engineOrder = new Map(data.engines.map((e, i) => [e.id, i]));

  // Brand / argument dimensions are CONTEXT for a measure that reads them (every answer sits in every brand's cell,
  // the measure read for that brand); argument is a FILTER otherwise (the answers carrying it).
  const brandValues = (grain: "brand" | "parent"): DimValue[] => {
    if (grain === "brand") {
      return B.flatMap((b, i) => (b.listed ? [{ key: `b${i}`, label: b.name, match: b.name, brands: new Set([i]), subject: b.key }] : []));
    }
    const groups = new Map<string, DimValue>();
    B.forEach((b, i) => {
      if (!b.listed) return;
      const name = b.parent ?? b.name;
      const g = groups.get(name) ?? { key: `p${name}`, label: name, match: name, brands: new Set<number>(), subject: `co:${name}` };
      g.brands!.add(i);
      groups.set(name, g);
    });
    return [...groups.values()];
  };
  const argValues: DimValue[] = data.args.map((a, i) => ({ key: `a${i}`, label: a, match: a, arg: i }));
  const argFilter = (i: number): DimValue => ({ ...argValues[i], scope: { when: `argany:${enc(data.args[i])}` } });
  const sites = data.sources ?? [];
  const srcValues: DimValue[] = sites.map((x, i) => ({ key: `s${i}`, label: x, match: x, src: i }));
  const srcAt = new Map(sites.map((x, i) => [x, i]));
  const srcFilter = (i: number): DimValue => ({ ...srcValues[i], scope: { when: `srcany:${enc(sites[i])}` } });
  const one = (key: string, label: string, scope: Partial<Scope>): DimValue => ({ key, label, match: label, scope });

  const valuesOf = (dim: DimKey): ((f: AnswerFact) => DimValue[]) | DimValue[] => {
    switch (dim) {
      case "none":
        return [one("all", "All answers", {})];
      case "room":
        return (f) => [f.situation !== null ? one(`r:${f.situation}`, f.situation, { situation: f.situation }) : one("r-", "Every buyer (not one situation)", { situation: null })];
      case "worry":
        return (f) => [f.worry !== null ? one(`w:${f.worry}`, f.worry, { worry: f.worry }) : one("w-", "No worry", { worry: null })];
      case "rival":
        return (f) => [f.rival ? one(`b:${f.rival.key}`, f.rival.name, { rival: f.rival.key }) : one("-", "No rival named", { rival: "generic" })];
      case "stage":
        return (f) => [one(f.type, titleCase(f.type), { types: [f.type] })];
      case "question":
        // One value per question (cell): its seed and rewordings pool, the seed wording names it.
        return (f) => {
          const i = cellIndex.get(f.intentId) ?? -1;
          const text = data.cells[i] ?? "";
          return [{ key: `q${i}`, label: shortText(text, 90), match: text, full: text, group: titleCase(f.type), scope: { intent: f.intentId } }];
        };
      case "engine":
        return (f) => [one(`e:${f.engine.id}`, labelOfEngine.get(f.engine.id) ?? f.engine.id, { engines: [f.engine.id] })];
      case "vendor":
        return (f) => [one(`v:${f.engine.vendor}`, f.engine.vendor, { vendor: f.engine.vendor })];
      case "tier":
        return (f) => [one(`t:${f.engine.tier}`, TIER_LABEL[f.engine.tier as keyof typeof TIER_LABEL] ?? f.engine.tier, { tier: f.engine.tier })];
      case "mode":
        return (f) => [one(f.engine.mode, MODE_LABEL[f.engine.mode as keyof typeof MODE_LABEL] ?? f.engine.mode, { mode: f.engine.mode })];
      case "brand":
      case "parent":
        return brandValues(dim);
      case "argument":
        if (lead.arg) return argValues;
        return (f) => (f.args ?? []).map((a) => argFilter(data.args.indexOf(a)));
      case "source":
        if (lead.src) return srcValues;
        return (f) => (f.sources ?? []).map((x) => srcFilter(srcAt.get(x.site)!));
    }
  };
  const rowVals = valuesOf(rowDim);
  const at = (v: ((f: AnswerFact) => DimValue[]) | DimValue[], f: AnswerFact) => (typeof v === "function" ? v(f) : v);
  // Columns: one per measure when Columns is None, else the dimension's values read with the one measure.
  const measureCols: PivotCol[] = measures.map((m) => ({ key: `m:${m.id}`, label: mLabel(m), match: `m:${m.id}`, measure: m }));
  const colVals = colDim === "none" ? null : valuesOf(colDim);
  const colsAt = (f: AnswerFact): PivotCol[] => (colVals ? at(colVals, f).map((v) => ({ ...v, measure: lead })) : measureCols);

  // Each cell's fact: the measure, the subject (the row's or column's brand or company, else the table's brand,
  // you, the rival or the answer), the argument, and the scope (the group's types, the panel cut, the filter, and
  // whatever the row and column narrow).
  const cellSpec = (rv: DimValue, cv: PivotCol) => {
    const m = cv.measure;
    const book = MEASURE_BY_ID.get(m.measure)!;
    const head = m.subject === "brand" ? (rv.subject ?? cv.subject ?? B[brand].key) : m.subject === "you" ? T.key : m.subject;
    const argIdx = rv.arg ?? cv.arg ?? arg;
    const argCode = m.arg ? (data.args[argIdx] ?? null) : null;
    const srcIdx = rv.src ?? cv.src ?? src;
    const site = m.src ? (sites[srcIdx] ?? null) : null;
    const scope: Scope = { ...baseScope, ...rv.scope, ...cv.scope };
    const companyKeys = head.startsWith("co:") ? new Set([...(rv.brands ?? cv.brands ?? [])].map((i) => B[i].key)) : null;
    const ctx: MeasureCtx = { set, brand: head === "ai" || head === "rival" || companyKeys ? null : head, brands: companyKeys, rival: head === "rival", arg: argCode, src: site, cond: null, slice: null };
    return { book, ctx, id: factId(m.measure, `${head}${argCode ? `/arg:${argCode}` : ""}${site ? `/src:${site}` : ""}`, scope), scope };
  };

  const cells = new Map<string, Acc>();
  const specs = new Map<string, ReturnType<typeof cellSpec>>();
  const rowOrder = new Map<string, DimValue>();
  const colOrder = new Map<string, PivotCol>();
  for (const f of poolRows) {
    for (const rv of at(rowVals, f)) {
      for (const cv of colsAt(f)) {
        const key = `${rv.key}|${cv.key}`;
        let sp = specs.get(key);
        if (!sp) specs.set(key, (sp = cellSpec(rv, cv)));
        if (!sp.book.base(f, sp.ctx)) continue;
        if (!rowOrder.has(rv.key)) rowOrder.set(rv.key, rv);
        if (!colOrder.has(cv.key)) colOrder.set(cv.key, cv);
        const acc = cells.get(key) ?? { k: 0, n: 0, ids: [], text: "", fact: sp.id };
        acc.n++;
        if (sp.book.hit(f, sp.ctx)) {
          acc.k++;
          if (acc.ids.length < EVIDENCE_CAP) acc.ids.push(f.responseId);
        }
        cells.set(key, acc);
      }
    }
  }
  for (const [key, acc] of cells) acc.text = printOf(specs.get(key)!.book, acc.k, acc.n);
  // Order: context lists (brands, arguments) by numerator volume, capped; everything else by its own order.
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
    if (dim === "brand" || dim === "parent" || (dim === "argument" && lead.arg) || (dim === "source" && lead.src)) {
      list = list
        .map((v) => ({ v, k: total(v) }))
        .filter((s) => s.k > 0 || s.v.brands?.has(data.target))
        .sort((a, b) => b.k - a.k || a.v.label.localeCompare(b.v.label))
        .slice(0, DIM_CAP)
        .map((s) => s.v);
    } else if (dim === "source") {
      // A filter over hundreds of sites: the sites carrying the most answers first, capped like the context lists.
      const answers = (v: DimValue) => {
        let n = 0;
        for (const [key, acc] of cells) {
          const [rk, ck] = key.split("|");
          if ((side === "row" ? rk : ck) === v.key) n += acc.n;
        }
        return n;
      };
      list = list
        .map((v) => ({ v, n: answers(v) }))
        .sort((a, b) => b.n - a.n || a.v.label.localeCompare(b.v.label))
        .slice(0, DIM_CAP)
        .map((s) => s.v);
    } else if (dim === "question") {
      // Grouped under the question type, then the questions carrying most of the numerator first.
      list = list
        .map((v) => ({ v, k: total(v) }))
        .sort((a, b) => (a.v.group ?? "").localeCompare(b.v.group ?? "") || b.k - a.k || a.v.label.localeCompare(b.v.label))
        .map((s) => s.v);
    } else if (dim === "engine") {
      list.sort((a, b) => (engineOrder.get(a.key.slice(2)) ?? 0) - (engineOrder.get(b.key.slice(2)) ?? 0));
    } else {
      // Alphabetical, with the catch-all bucket ("not one situation", "no worry", "no rival") last.
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
