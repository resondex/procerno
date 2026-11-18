/**
 * The Brief's figures carried through its string composition (fact layer step 5, part 2 - every figure is a fact).
 *
 * A figure is printed only from a fact: a card's Stat (stat_registry.ts - the number as a card draws it, with the
 * fact it is) through `figOf`, or a fact ref a statement prints (an Overview finding's number, a Map claim's number,
 * a derived ref such as the visibility chart's level line) through `refFig`. Either travels inside the composed text
 * as an inert marker: U+2063, two private-use characters naming the figure, the value as printed, U+2063. String
 * joins and the voice pass keep working (the voice pass replaces on the plain text and keeps each marker on its
 * number - `trReplace`); the link pass reads the marker and links the number by its FACT ID to where that fact is
 * drawn (brief.ts linkUnit - a lookup, never a match), then strips it.
 *
 * There is no other way to print a number: a number token in a Brief field that no marker covers is a fault the
 * Brief's harness fails on (scripts/brief_links_harness.mts).
 */
import type { Stat } from "./stat_registry";
import type { StmtNums } from "./facts/statements";

const MK = "⁣";
const PUA = 0xe000;
const WIDTH = 6400;
const enc = (n: number) => String.fromCharCode(PUA + Math.floor(n / WIDTH)) + String.fromCharCode(PUA + (n % WIDTH));
const dec = (a: string, b: string) => (a.charCodeAt(0) - PUA) * WIDTH + (b.charCodeAt(0) - PUA);
const MARK = /⁣([-])([-])([^⁣]*)⁣/g;

/** A figure: a card's stat (its `fact` is the fact id), or a fact ref printed by a statement (a fact id or a derived
 * ref, statements.ts) with the text it printed. */
export type Fig = { stat: Stat; ref: string } | { ref: string; value: string; stat?: undefined };

export interface FigTable {
  list: Fig[];
  byKey: Map<string, number>;
}
export const newFigTable = (): FigTable => ({ list: [], byKey: new Map() });

function mark(t: FigTable, key: string, f: Fig, value: string): string {
  let i = t.byKey.get(key);
  if (i === undefined) {
    i = t.list.push(f) - 1;
    t.byKey.set(key, i);
  }
  return `${MK}${enc(i)}${value}${MK}`;
}

/** A card's figure: printed as the card draws it, carrying the card's fact id. */
export function figOf(t: FigTable, s: Stat): string {
  if (!s.fact) throw new Error(`stat ${s.id} carries no fact id - every number a card draws is a fact (fact layer step 4)`);
  return mark(t, `s:${s.id}`, { stat: s, ref: s.fact }, s.value);
}
/** A statement's figure (an Overview finding, a Map claim, a derived ref): the text it printed, carrying its ref. */
export const refFig = (t: FigTable, ref: string, value: string): string => mark(t, `r:${ref}\u0000${value}`, { ref, value }, value);

/** A finished statement (plain text, and where each number sits with its ref - statements.ts `finish`) as Brief text:
 * every number marked with its ref, so it links by its fact id like any other figure. */
export function fromStatement(t: FigTable, text: string, nums: StmtNums | undefined): string {
  if (!nums?.length) return text;
  let out = "";
  let last = 0;
  for (const [at, len, ref] of [...nums].sort((a, b) => a[0] - b[0])) {
    if (at < last) continue;
    out += text.slice(last, at) + refFig(t, ref, text.slice(at, at + len));
    last = at + len;
  }
  return out + text.slice(last);
}

export const hasFigs = (s: string) => s.includes(MK);

/** A composed string as plain text plus where each figure's value sits in it. */
export interface Tr {
  s: string;
  m: { at: number; len: number; i: number }[];
}

export function decode(text: string): Tr {
  const m: Tr["m"] = [];
  let s = "";
  let last = 0;
  for (const x of text.matchAll(MARK)) {
    s += text.slice(last, x.index);
    m.push({ at: s.length, len: x[3].length, i: dec(x[1], x[2]) });
    s += x[3];
    last = x.index! + x[0].length;
  }
  s += text.slice(last);
  return { s, m };
}

export function encode(tr: Tr): string {
  let out = "";
  let last = 0;
  for (const x of [...tr.m].sort((a, b) => a.at - b.at)) {
    out += tr.s.slice(last, x.at) + MK + enc(x.i) + tr.s.slice(x.at, x.at + x.len) + MK;
    last = x.at + x.len;
  }
  return out + tr.s.slice(last);
}

export const strip = (text: string): string => (text.includes(MK) ? text.replace(MARK, "$3") : text);

type Repl = string | ((...args: never[]) => string);
const expand = (repl: string, m: RegExpExecArray) => repl.replace(/\$(\$|&|\d{1,2})/g, (_x, g: string) => (g === "$" ? "$" : g === "&" ? m[0] : (m[Number(g)] ?? "")));
const countOf = (hay: string, needle: string, upTo = hay.length) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && i < upTo; i = hay.indexOf(needle, i + 1)) n++;
  return n;
};
const nthIndex = (hay: string, needle: string, n: number) => {
  let i = hay.indexOf(needle);
  for (let k = 0; k < n && i >= 0; k++) i = hay.indexOf(needle, i + 1);
  return i;
};

/**
 * String.prototype.replace on the plain text, keeping each figure on its number: a figure outside every match
 * moves with the text; one inside a match follows its value into the replacement when the replacement keeps that
 * value as often as the match had it ("against your 15%" -> "against <brand>'s 15%"); a figure the replacement
 * turns into a word ("in 0% of answers" -> "never") is dropped - the word carries no number.
 */
export function trReplace(tr: Tr, re: RegExp, repl: Repl): Tr {
  const matches: RegExpExecArray[] = [];
  if (re.global) {
    re.lastIndex = 0;
    for (let x = re.exec(tr.s); x; x = re.exec(tr.s)) {
      matches.push(x);
      if (x[0] === "") re.lastIndex++;
    }
    re.lastIndex = 0;
  } else {
    const x = re.exec(tr.s);
    if (x) matches.push(x);
  }
  if (!matches.length) return tr;
  let s = "";
  let last = 0;
  const m: Tr["m"] = [];
  const pending = [...tr.m];
  for (const x of matches) {
    const from = x.index;
    const to = from + x[0].length;
    const r = typeof repl === "string" ? expand(repl, x) : (repl as (...a: unknown[]) => string)(...x, from, tr.s);
    const base = s.length + (from - last);
    for (const k of pending.filter((y) => y.at >= last && y.at + y.len <= from && !(y.len === 0 && y.at === from && from < to))) m.push({ ...k, at: s.length + (k.at - last) });
    for (const k of pending.filter((y) => y.at >= from && y.at < to || (y.len === 0 && y.at === from && from < to))) {
      const v = tr.s.slice(k.at, k.at + k.len);
      if (!v) continue;
      const nth = countOf(x[0], v, k.at - from);
      const inMatch = countOf(x[0], v);
      if (countOf(r, v) !== inMatch) continue;
      const at = nthIndex(r, v, nth);
      if (at >= 0) m.push({ ...k, at: base + at });
    }
    s += tr.s.slice(last, from) + r;
    last = to;
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at < to) pending.splice(i, 1);
  }
  for (const k of pending) m.push({ ...k, at: s.length + (k.at - last) });
  s += tr.s.slice(last);
  return { s, m };
}

/* ---------------- deciding from the figure printed ---------------- */

/**
 * A stat's counts (stat_registry.ts `k` / `n`, read from the number's own tip). The Brief decides with these and
 * nothing else for a card's figures: a sentence that says "under half" decides from the very figure it prints.
 * A decision on a stat with no counts is a bug in the caller, so these throw rather than guess.
 */
function counts(s: Stat): { k: number; n: number } {
  if (s.k === undefined || s.n === undefined) throw new Error(`stat ${s.id} carries no counts to decide with`);
  return { k: s.k, n: s.n };
}
/** The numerator ("picks", "answers that name it"). */
export const kOf = (s: Stat): number => counts(s).k;
/** The base. */
export const nOf = (s: Stat): number => counts(s).n;
/** k / n exactly (0 on an empty base) - never the rounded display value. */
export const rateOf = (s: Stat): number => {
  const { k, n } = counts(s);
  return n > 0 ? k / n : 0;
};
/** The tip a stat's counts state, in the Brief's tip format ("k of n"). */
export const tipOfStat = (s: Stat): string => `${kOf(s)} of ${nOf(s)}`;
