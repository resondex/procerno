/**
 * The Brief's figures carried through its string composition (2026-11-17, "one engine, stat IDs", stage 2).
 *
 * A figure the Brief takes from a card is printed only from a Stat object (stat_registry.ts) - `figOf(table, stat)`
 * - and travels inside the composed text as an inert marker: U+2063, two private-use characters naming the figure,
 * the value as the card renders it, U+2063. String joins and the voice pass keep working (the voice pass replaces
 * on the plain text and keeps each marker on its number - `trReplace`); the link pass reads the marker to link the
 * number to its stat straight from the registry (no matching), then strips it. A figure that has no card home yet
 * is printed with `legacyFig` - tagged, never silently mixed in: the harness lists every one.
 */
import type { Stat } from "./stat_registry";

const MK = "⁣";
const PUA = 0xe000;
const WIDTH = 6400;
const enc = (n: number) => String.fromCharCode(PUA + Math.floor(n / WIDTH)) + String.fromCharCode(PUA + (n % WIDTH));
const dec = (a: string, b: string) => (a.charCodeAt(0) - PUA) * WIDTH + (b.charCodeAt(0) - PUA);
const MARK = /⁣([-])([-])([^⁣]*)⁣/g;

/** A figure: a card's stat, or one printed the old way because no card shows it (listed by the harness). */
export type Fig = { stat: Stat } | { legacy: string; value: string };

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

/** The only way the migrated Brief prints a card's figure: from its Stat. */
export const figOf = (t: FigTable, s: Stat): string => mark(t, `s:${s.id}`, { stat: s }, s.value);
/** A figure with no card home (printed as before, tagged `kind` for the harness's needs-a-card-home list). */
export const legacyFig = (t: FigTable, kind: string, value: string): string => mark(t, `l:${kind}:${value}`, { legacy: kind, value }, value);

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
 * turns into a word ("in 0% of answers" -> "never") is dropped - the word carries no link.
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
