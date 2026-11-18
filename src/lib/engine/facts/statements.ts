/**
 * Layer 4 of the fact layer (FACT_LAYER_DESIGN_2026-11-17.md): STATEMENTS - a finding, a Map claim, a Map cell's line
 * and figure are each a template plus the facts it prints and the selections it reads. Deciding whether to write a
 * statement and how to word it reads those same facts.
 *
 * How a number travels: a statement's number is printed only from a FactCell (a fact's counts with its id) through
 * `pw` / `pfine` (a whole or fine percentage) or `pd` (a number derived from facts by a stated op: a difference in
 * points, a ratio, an even split). The printed text carries an inert marker naming its ref; string composition keeps
 * working. `finish(text)` strips the markers and returns the plain text and where each number sits, with its ref - the
 * statement's `nums`. A served payload carries the plain text and, never drawn, its `facts` (field -> nums).
 *
 * A ref is a fact id ("measure|subject|scope", fact.ts) or a derived ref "=<op>\u001f<ref>\u001f<ref>..." whose value
 * is recomputed from the facts it names (`evalRef`). `parseFactId` reads a fact id back into its triple, so a proof can
 * recompute every number from its id alone.
 *
 * Gates: a decision a statement reads (a floor, two ranges apart, a threshold) is taken through `gate*` helpers, which
 * evaluate it from FactCells and, while a log is open (`openGates` / `closeGates`), record it with its refs, so a
 * proof can recompute each decision from its facts.
 *
 * The floors the Map and the Overview read are in measure_book.ts FLOORS / OVERVIEW_FLOORS (one table).
 */
import { cell, type RateCell } from "../view_data";
import { MEASURE_BY_ID, printFine, printOf, printWhole } from "./measure_book";
import type { Fact, FactBook, Scope } from "./fact";
import type { QuestionType } from "./answer_facts";

/* ------------------------------- fact cells ------------------------------- */

/** A rate cell that is a fact: its counts, its Wilson range and its id. */
export type FactCell = RateCell & { id: string };

export const fcellOf = (f: Fact): FactCell => ({ ...cell(f.k, f.n), id: f.id });
export const isFactCell = (c: unknown): c is FactCell => !!c && typeof (c as FactCell).id === "string" && typeof (c as FactCell).k === "number";
/** A fact, as a FactCell. */
export const fc = (book: FactBook, measure: string, subject: string, scope: Scope): FactCell => fcellOf(book.fact(measure, subject, scope));

/* ------------------------------- refs ------------------------------- */

const US = "\u001f";
/** A derived ref: an op over refs (facts or derived), with an optional numeric argument (an even split's count). */
export const dref = (op: DerivedOp, refs: string[], arg?: number) => `=${op}${US}${arg ?? ""}${US}${refs.join(US)}`;
export type DerivedOp =
  /** a.k/a.n - b.k/b.n, printed as points (absolute) */
  | "diff_pts"
  /** a.k/a.n - b.k/b.n, signed, as "+N points" / "-N points" */
  | "diff_signed"
  /** a.k / b.k (the first fact's numerator over the second's), as a percentage */
  | "kk"
  /** 1 / arg, as a percentage (an even split among `arg` members; the members are named by the statement) */
  | "even";

export function parseDerived(ref: string): { op: DerivedOp; arg: number | null; refs: string[] } | null {
  if (!ref.startsWith("=")) return null;
  const [op, arg, ...refs] = ref.slice(1).split(US);
  return { op: op as DerivedOp, arg: arg === "" ? null : Number(arg), refs: refs.filter((r) => r !== "") };
}

/* ------------------------------- markers ------------------------------- */

const MS = "⁤";
const MX = "⁢";
/** The separator of a fact printed at exactly all of its base (k = n > 0): "100%" that is not a rounding of 99.5%. */
const MXA = "\u2063";
const MARK = /⁤([^⁢\u2063⁤]*)[⁢\u2063]([^⁤]*)⁤/g;

const mark = (ref: string, text: string) => `${MS}${ref}${MX}${text}${MS}`;
const markAll = (ref: string, text: string) => `${MS}${ref}${MXA}${text}${MS}`;
export const hasMarks = (s: string) => s.includes(MS);
export const plain = (s: string): string => (s.includes(MS) ? s.replace(MARK, "$2") : s);

/* ------------------------------- never / every ------------------------------- */

/** The words a share may print as at its extremes, each carrying the share's fact id (the statements harness reads
 * "never" / "none" as k = 0 and "every" / "always" as k = n > 0). */
export const EXTREME_ZERO = new Set(["never", "none"]);
export const EXTREME_ALL = new Set(["every", "always"]);

const VERBS = "picks|names|recommends|says|tells|calls|points|sends|backs|gives|sides|agrees|commits|brings|teaches|mentions|takes|wins|chooses|treats";
const OBJ = "[^.;,⁤⁢\u2063]{1,40}?";
const Z = "⁤([^⁢\u2063⁤]+)⁢0%⁤";
const A = "⁤([^⁢\u2063⁤]+)\u2063100%⁤";
const END = "(?=[.;,:]| -|$)";
/** A share whose verb is shared with a second share ("says stay in 0% of answers and leave in 95%") keeps its figure:
 * the word would swallow the coordinated clause. */
const NOT_SHARED = "(?! and [^.;,⁤]{1,40}? in ⁤)(?!,? and [^.;,⁤]{1,40}? ⁤)";

/**
 * "never" for a share that is exactly zero and "every" / "always" for exactly all, in a running sentence (the Brief's
 * rule; bars, tables, chart labels and cell lines keep their figures). Only sentence forms that read cleanly are
 * rewritten - "<verb> <object> in 0% of answers" -> "never <verb> <object>", "<verb> <object> 0% of the time it ..." ->
 * "never <verb> <object> when it ...", "takes 0% of the picks" -> "takes none of the picks", and the 100% forms; any
 * other place a 0% / 100% sits keeps its figure. The word keeps the share's fact id.
 */
export function extremeWords(text: string): string {
  if (!text.includes(MS)) return text;
  let t = text;
  const zero = (ref: string) => mark(ref, "never");
  const always = (ref: string) => markAll(ref, "always");
  // <verb> <object> 0% / 100% of the time it|they ...
  t = t.replace(new RegExp(`\\b(${VERBS}) (${OBJ}) ${Z} of the time (it|they)\\b`, "g"), (_m, v, o, r, w) => `${zero(r)} ${v} ${o} when ${w}`);
  t = t.replace(new RegExp(`\\b(${VERBS}) (${OBJ}) ${A} of the time (it|they)\\b`, "g"), (_m, v, o, r, w) => `${always(r)} ${v} ${o} when ${w}`);
  // <verb> <object> in 0% / 100% of the answers that pick one of them|you|the two -> the Brief's form (bf26)
  t = t.replace(new RegExp(`\\b(${VERBS}) (${OBJ}) in ${Z} of the answers that pick one of (them|you|the two)\\b`, "g"), (_m, v, o, r, w) => `${zero(r)} ${v} ${o} when it picks one of ${w === "them" ? "the two" : w}`);
  t = t.replace(new RegExp(`\\b(${VERBS}) (${OBJ}) in ${A} of the answers that pick one of (them|you|the two)\\b`, "g"), (_m, v, o, r, w) => `${always(r)} ${v} ${o} when it picks one of ${w === "them" ? "the two" : w}`);
  // takes|wins 0% / 100% of the picks|matchups
  t = t.replace(new RegExp(`\\b(take|takes|win|wins) ${Z} of (?:the )?(picks|matchups)\\b`, "g"), (_m, v, r, x) => `${v} ${mark(r, "none")} of the ${x}`);
  t = t.replace(new RegExp(`\\b(take|takes|win|wins) ${A} of (?:the )?(picks|matchups)\\b`, "g"), (_m, v, r, x) => `${v} ${markAll(r, "every")} ${x.replace(/s$/, "")}`);
  // <verb> <object> in 0% of answers | of the answers ... | of those answers ... | (end)
  t = t.replace(new RegExp(`\\b(${VERBS}) (${OBJ}) in ${Z}(?: of answers\\b|${END})${NOT_SHARED}`, "g"), (_m, v, o, r) => `${zero(r)} ${v} ${o}`);
  t = t.replace(new RegExp(`\\b(${VERBS}) (${OBJ}) in ${Z} of (the|those) answers\\b${NOT_SHARED}`, "g"), (_m, v, o, r, d) => `${zero(r)} ${v} ${o} in ${d} answers`);
  t = t.replace(new RegExp(`\\b(${VERBS}) (${OBJ}) in ${A}(?: of answers\\b|${END})${NOT_SHARED}`, "g"), (_m, v, o, r) => `${v} ${o} in ${markAll(r, "every")} answer`);
  t = t.replace(new RegExp(`\\b(${VERBS}) (${OBJ}) in ${A} of (the|those) answers\\b${NOT_SHARED}`, "g"), (_m, v, o, r, d) => `${v} ${o} in ${markAll(r, "every")} one of ${d} answers`);
  return t;
}

const rateOf = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);

/** A fact as its measure prints it (measure_book.ts: whole points, "<1%" under half a point; one decimal under 10% for
 * "picked, of all answers"), marked with its fact id; a number that is no fact prints whole points, unmarked. */
export function pw(c: RateCell | number): string {
  if (typeof c === "number") return printWhole(c, 1);
  if (!isFactCell(c)) return c.n > 0 ? printWhole(c.k, c.n) : "0%";
  const m = MEASURE_BY_ID.get(c.id.slice(0, c.id.indexOf("|")));
  const t = c.n > 0 ? (m ? printOf(m, c.k, c.n) : printWhole(c.k, c.n)) : "0%";
  return c.n > 0 && c.k === c.n ? markAll(c.id, t) : mark(c.id, t);
}
/** One decimal under 10% (the "picked, of all answers" print); marked when it is a fact. */
export function pfine(c: RateCell): string {
  const t = c.n > 0 ? printFine(c.k, c.n) : "0%";
  return isFactCell(c) ? (c.n > 0 && c.k === c.n ? markAll(c.id, t) : mark(c.id, t)) : t;
}
/** A number derived from facts by a stated op, printed as the op prints it; marked with the derived ref when every
 * input is a fact. */
export function pd(op: DerivedOp, cells: RateCell[], arg?: number): string {
  const v = derivedValue(op, cells.map((c) => ({ k: c.k, n: c.n })), arg ?? null);
  const t = printDerived(op, v);
  return cells.every(isFactCell) ? mark(dref(op, (cells as FactCell[]).map((c) => c.id), arg), t) : t;
}
/** A derived value as a plain number (for a bar's length, an effect). */
export function derivedValue(op: DerivedOp, xs: { k: number; n: number }[], arg: number | null): number {
  const r = (x: { k: number; n: number }) => (x.n > 0 ? x.k / x.n : 0);
  switch (op) {
    case "diff_pts":
      return Math.abs(r(xs[0]) - r(xs[1]));
    case "diff_signed":
      return r(xs[0]) - r(xs[1]);
    case "kk":
      return xs[1].k > 0 ? xs[0].k / xs[1].k : 0;
    case "even":
      return arg ? 1 / arg : 0;
  }
}
export function printDerived(op: DerivedOp, v: number): string {
  switch (op) {
    case "diff_pts":
      return `${Math.round(Math.abs(v) * 100)} points`;
    case "diff_signed":
      return `${v >= 0 ? "+" : "-"}${Math.round(Math.abs(v) * 100)} points`;
    case "kk":
    case "even":
      return v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`;
  }
}
/** Mark an already printed text with a ref (a number printed by another layer's rule from a fact it names). */
export const pref = (ref: string, text: string) => mark(ref, text);

/** Every string under a value with its markers stripped (a list or object a statement filled with printed facts whose
 * positions it does not record - a card-like sub-block). */
export function stripDeep<T>(x: T): T {
  if (typeof x === "string") return plain(x) as T;
  if (Array.isArray(x)) return x.map((y) => stripDeep(y)) as T;
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) out[k] = stripDeep(v);
    return out as T;
  }
  return x;
}

/** A statement's numbers: [at, length, ref] in its plain text. */
export type StmtNums = [number, number, string][];

/** Strip the markers: the plain text and where each number sits, with its ref. */
export function finish(text: string): { text: string; nums: StmtNums } {
  if (!text.includes(MS)) return { text, nums: [] };
  const nums: StmtNums = [];
  let s = "";
  let last = 0;
  for (const x of text.matchAll(MARK)) {
    s += text.slice(last, x.index);
    nums.push([s.length, x[2].length, x[1]]);
    s += x[2];
    last = x.index! + x[0].length;
  }
  s += text.slice(last);
  return { text: s, nums };
}

/** Finish every string field of an object (one level), recording each field's nums under `facts`. */
export function finishFields<T extends object>(o: T, fields: (keyof T)[]): T & { facts?: Record<string, StmtNums> } {
  const facts: Record<string, StmtNums> = {};
  const out = { ...o } as T & { facts?: Record<string, StmtNums> };
  for (const f of fields) {
    const v = o[f];
    if (typeof v !== "string") continue;
    const r = finish(v);
    (out as Record<string, unknown>)[f as string] = r.text;
    if (r.nums.length) facts[f as string] = r.nums;
  }
  if (Object.keys(facts).length) out.facts = { ...((o as { facts?: Record<string, StmtNums> }).facts ?? {}), ...facts };
  return out;
}

/* ------------------------------- parsing a fact id ------------------------------- */

const SCOPE_TAG = /^(t|s|w|r|l|e|v|h)=/;
/** A fact id read back into its triple (fact.ts factId / scopeKey). */
export function parseFactId(id: string): { measure: string; subject: string; scope: Scope } {
  const parts = id.split("|");
  const measure = parts[0];
  const ti = parts.findIndex((p, i) => i > 0 && p.startsWith("t="));
  if (ti < 0) throw new Error(`not a fact id: ${id}`);
  const subject = parts.slice(1, ti).join("|");
  // Scope parts: a part opens with its tag; a later piece without a tag belongs to the part before it (an OR slice).
  const fields: [string, string][] = [];
  for (const p of parts.slice(ti)) {
    const m = SCOPE_TAG.exec(p);
    if (m && (fields.length === 0 || m[1] !== "t")) fields.push([m[1], p.slice(2)]);
    else fields[fields.length - 1][1] += `|${p}`;
  }
  const scope: Scope = { types: [] };
  for (const [tag, v] of fields) {
    switch (tag) {
      case "t":
        scope.types = v.split("+") as QuestionType[];
        break;
      case "s":
        scope.situation = v === "~none" ? null : v;
        break;
      case "w":
        scope.worry = v;
        break;
      case "r":
        scope.rival = v;
        break;
      case "l":
        scope.line = v;
        break;
      case "e":
        scope.engines = v.split("+");
        break;
      case "v":
        scope.vendor = v;
        break;
      case "h":
        scope.when = v;
        break;
    }
  }
  return { measure, subject, scope };
}

/** A ref's value recomputed from the fact book alone (a fact: k/n; derived: its op over its refs' facts). */
export function evalRef(book: FactBook, ref: string): { text: string; value: number; k?: number; n?: number } {
  const d = parseDerived(ref);
  if (d) {
    const xs = d.refs.map((r) => {
      const x = evalRef(book, r);
      return { k: x.k ?? 0, n: x.n ?? 0 };
    });
    const v = derivedValue(d.op, xs, d.arg);
    return { text: printDerived(d.op, v), value: v };
  }
  const { measure, subject, scope } = parseFactId(ref);
  const f = book.countUnchecked(measure, subject, scope);
  const m = MEASURE_BY_ID.get(measure);
  return { text: m ? f.text : printWhole(f.k, f.n), value: f.n > 0 ? f.k / f.n : 0, k: f.k, n: f.n };
}

/* ------------------------------- gates ------------------------------- */

/** One decision a statement reads, with the facts it reads. */
export interface Gate {
  rule: GateRule;
  refs: string[];
  arg?: number;
  pass: boolean;
}
export type GateRule =
  /** refs[0].n >= arg */
  | "n_at_least"
  /** refs[0].k >= arg */
  | "k_at_least"
  /** rate(refs[0]) >= arg */
  | "rate_at_least"
  /** rate(refs[0]) < arg */
  | "rate_below"
  /** refs[0].low > refs[1].high (the 95% ranges do not overlap, the first above) */
  | "apart"
  /** |rate(refs[0]) - rate(refs[1])| >= arg */
  | "gap_at_least"
  /** rate(refs[0]) > rate(refs[1]) */
  | "above"
  /** refs[0].low > arg (a range clears a level) */
  | "low_above";

let LOG: Gate[] | null = null;
/** Open a gate log (synchronous use only: open, run the statement's decisions, close). */
export function openGates(): void {
  LOG = [];
}
export function closeGates(): Gate[] {
  const g = LOG ?? [];
  LOG = null;
  return g;
}
const rec = (rule: GateRule, cells: RateCell[], pass: boolean, arg?: number) => {
  if (LOG && cells.every(isFactCell)) LOG.push({ rule, refs: (cells as FactCell[]).map((c) => c.id), ...(arg !== undefined ? { arg } : {}), pass });
  return pass;
};
/** Evaluate a gate from counts (the same arithmetic the proof recomputes). */
export function evalGate(rule: GateRule, xs: { k: number; n: number }[], arg?: number): boolean {
  const r = (x: { k: number; n: number }) => (x.n > 0 ? x.k / x.n : 0);
  const w = (x: { k: number; n: number }) => cell(x.k, x.n);
  switch (rule) {
    case "n_at_least":
      return xs[0].n >= arg!;
    case "k_at_least":
      return xs[0].k >= arg!;
    case "rate_at_least":
      return r(xs[0]) >= arg!;
    case "rate_below":
      return r(xs[0]) < arg!;
    case "apart":
      return w(xs[0]).low > w(xs[1]).high;
    case "gap_at_least":
      return Math.abs(r(xs[0]) - r(xs[1])) >= arg!;
    case "above":
      return r(xs[0]) > r(xs[1]);
    case "low_above":
      return w(xs[0]).low > arg!;
  }
}
const g = (rule: GateRule, cells: RateCell[], arg?: number) => rec(rule, cells, evalGate(rule, cells, arg), arg);
export const gN = (c: RateCell, min: number) => g("n_at_least", [c], min);
export const gK = (c: RateCell, min: number) => g("k_at_least", [c], min);
export const gAtLeast = (c: RateCell, x: number) => g("rate_at_least", [c], x);
export const gBelow = (c: RateCell, x: number) => g("rate_below", [c], x);
export const gApart = (hi: RateCell, lo: RateCell) => g("apart", [hi, lo]);
export const gGap = (a: RateCell, b: RateCell, x: number) => g("gap_at_least", [a, b], x);
export const gAbove = (a: RateCell, b: RateCell) => g("above", [a, b]);
export const gLowAbove = (c: RateCell, x: number) => g("low_above", [c], x);
export const rateOfCell = rateOf;
