import { ENGINES, engineDisplayLabel } from "./providers";
import { matchKey } from "../brand_key";
import { famTokens } from "./brand_family";
import { buildResolver, type Resolver } from "./brand_resolve";
import { cachedView, cell, facetsOf, poolOf, requestOf, type EngineFacets, type PoolRow, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import type { Project, Run } from "../types";

/**
 * The Value view (2026-10-27), never pooled into the headline (CODING_DECISIONS
 * section 8 / section 12: "within-brand view per room"). Every Value cell
 * names one of the client's lines and asks, for one room's buyer, whether it
 * is worth it over a generic cheaper option. Read: worth_it yes / depends /
 * no per room, and per designed line (rooms that share a line pool into it).
 *
 * The line each room asked about is the confirmed one in
 * projects.setup_decision (valueLines.decided[room].line); cells without a
 * record show no line. Alongside the verdict: the brands an answer
 * recommends instead, read from the answer's mentions - an active brand
 * other than the client framed recommended, on answers that say "no" or
 * "depends". Value cells name no rival, so these are the cheaper options the
 * AI puts forward on its own.
 *
 * The own rung (v6, 2026-11-03): a "no" or "depends" can point to the
 * brand's OWN cheaper option - an ad plan, the base model under the Pro -
 * which the rivals-only list cannot see (the target is skipped by
 * construction). `ownRung` counts the doubting answers that do; the names
 * ride `instead` with `own: true`. An answer points to its own rung when:
 *   1. a decision rule chooses "cheaper" with a product that resolves to the
 *      client and names a line other than the asked one (the test in 2), or
 *      that the dictionary cannot place but carries every distinctive word of
 *      a confirmed line's name (a bare plan name; category vocabulary - the
 *      category and the counterparts' words - never counts); or
 *   2. a mention framed recommended resolves to the client and names a
 *      specific line: its surface carries a word that is not in the brand's
 *      own name (canonical, display name or a one-word alias - those are
 *      spellings), and it is not the row's own asked line (its words, digits
 *      stripped, are not all words of that line; a bare model number counts
 *      as a different line only when the asked line is itself a named line);
 *   3. or a recommended mention names the row's counterpart when the
 *      counterpart resolves to the client.
 * A sibling product that is not cheaper (a different product line the AI
 * points to instead) is caught by (2) too: the measure is "the doubt stays
 * in-house", not a price ladder. `recommendsInstead` keeps meaning rivals.
 */

export type { RateCell };

export type Worth = "yes" | "depends" | "no";
export const WORTH: readonly Worth[] = ["yes", "depends", "no"];

export interface ValueRow {
  key: string;
  label: string;
  /** Rooms in this row (one for a room row, every room sharing the line for a line row). */
  rooms: string[];
  line: string | null;
  counterpart: string | null;
  answers: number;
  worth: Record<Worth, RateCell>;
  /** Of the "no" and "depends" answers, how many recommend another brand. */
  recommendsInstead: RateCell;
  /** Of the "no"/"depends" answers: share recommending the brand's own cheaper line or plan (a mention resolving to the target whose surface form is not the bare brand name, or that names the row's counterpart when the counterpart is the brand's own). */
  ownRung: RateCell;
  /** Rivals (own: false, top `limit`) then the brand's own options (own: true, top 3), most named first. */
  instead: InsteadEntry[];
}

export interface InsteadEntry {
  name: string;
  n: number;
  /** True = the brand's own line or plan (the own rung). */
  own: boolean;
}

export interface ValueSlice {
  key: string;
  label: string;
  answers: number;
  worth: Record<Worth, RateCell>;
}

export interface ValueView {
  runId: string;
  source: string;
  brand: string;
  answers: number;
  uncoded: number;
  worth: Record<Worth, RateCell>;
  recommendsInstead: RateCell;
  /** Of the "no"/"depends" answers: share recommending the brand's own cheaper line or plan (a mention resolving to the target whose surface form is not the bare brand name, or that names the row's counterpart when the counterpart is the brand's own). */
  ownRung: RateCell;
  /** Rivals (own: false, top 10) then the brand's own options (own: true, top 5), most named first. */
  instead: InsteadEntry[];
  rooms: ValueRow[];
  lines: ValueRow[];
  byEngine: (ValueSlice & EngineFacets)[];
}

interface Facts {
  row: PoolRow;
  room: string;
  worth: Worth;
  /** Active brands other than the client the answer recommends. */
  instead: Map<string, string>;
  /** The client's own options the answer points to: grouping key (non-brand words) -> surface as written. */
  own: Map<string, string>;
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

function worthCells(list: Facts[]): Record<Worth, RateCell> {
  return Object.fromEntries(WORTH.map((w) => [w, cell(count(list, (f) => f.worth === w), list.length)])) as Record<Worth, RateCell>;
}

/** Fold own-option groups whose key is a subset of another's and names no
 * confirmed-line word ("ad" folds into "ad standard"; "gold" never folds
 * into "business gold"). */
function foldOwn(own: Map<string, { n: number; forms: Map<string, number> }>, lineWords: Set<string>) {
  const keys = [...own.keys()];
  const setOf = (k: string) => new Set(k.split(" "));
  for (const a of keys) {
    const A = setOf(a);
    if ([...A].some((w) => lineWords.has(w))) continue;
    const targets = keys.filter((b) => b !== a && own.has(b) && [...A].every((w) => setOf(b).has(w)));
    if (targets.length === 0 || !own.has(a)) continue;
    // Merge a and all its supersets into one group keyed by a.
    const g = own.get(a)!;
    for (const b of targets) {
      const t = own.get(b)!;
      g.n += t.n;
      for (const [f, c] of t.forms) g.forms.set(f, (g.forms.get(f) ?? 0) + c);
      own.delete(b);
    }
  }
}

function insteadOf(list: Facts[], limit: number, ownLimit: number, lineWords: Set<string> = new Set()) {
  const doubting = list.filter((f) => f.worth !== "yes");
  const m = new Map<string, number>();
  for (const f of doubting) for (const name of f.instead.values()) m.set(name, (m.get(name) ?? 0) + 1);
  // Own options group by their key; the label is the most-written surface.
  const own = new Map<string, { n: number; forms: Map<string, number> }>();
  for (const f of doubting)
    for (const [k, surface] of f.own) {
      const t = own.get(k) ?? { n: 0, forms: new Map<string, number>() };
      t.n++;
      t.forms.set(surface, (t.forms.get(surface) ?? 0) + 1);
      own.set(k, t);
    }
  foldOwn(own, lineWords);
  const byCount = (a: InsteadEntry, b: InsteadEntry) => b.n - a.n || a.name.localeCompare(b.name);
  const rivals: InsteadEntry[] = [...m.entries()].map(([name, n]) => ({ name, n, own: false })).sort(byCount).slice(0, limit);
  const owns: InsteadEntry[] = [...own.values()]
    .map((t) => ({ name: titleCase([...t.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]), n: t.n, own: true }))
    .sort(byCount)
    .slice(0, ownLimit);
  return {
    recommendsInstead: cell(count(doubting, (f) => f.instead.size > 0), doubting.length),
    ownRung: cell(count(doubting, (f) => f.own.size > 0), doubting.length),
    instead: [...rivals, ...owns].sort(byCount),
  };
}

/** Each word's first letter upper-cased; the rest kept as written. */
const titleCase = (s: string) => s.replace(/(^|\s)(\p{Ll})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());

/** A product or mention as written, with price tags dropped ("at $8.99", "$12.99/mo"). */
const surfaceOf = (raw: string) =>
  raw
    .replace(/\s*\b(at|for)\s+\$\s?\d[\d.,]*(\s*\/\s*\w+)?/gi, "")
    .replace(/\$\s?\d[\d.,]*(\s*\/\s*\w+)?\s*/g, "")
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Words with digits stripped ("10a" -> "a", "11" -> gone). */
const wordsOf = (tokens: string[]) => tokens.map((t) => t.replace(/[0-9]/g, "")).filter(Boolean);

/** The own-rung test's fixed inputs for one project: the brand's own name
 * tokens (spellings) and the distinctive words of every confirmed line. */
interface OwnBasis {
  brandTokens: Set<string>;
  /** Per confirmed line, its distinctive (non-brand, non-category) words, digits stripped, 3+ letters. */
  lineWords: Set<string>[];
}

function ownBasis(resolve: Resolver, brand: string, category: string, lines: Map<string, { line: string; counterpart: string | null }>): OwnBasis {
  const e = resolve(brand).entry;
  const brandTokens = new Set<string>(famTokens(brand));
  if (e) {
    for (const f of [e.canonical, e.display_name ?? ""]) for (const t of famTokens(f)) brandTokens.add(t);
    for (const a of e.aliases) {
      const t = famTokens(a);
      if (t.length === 1) brandTokens.add(t[0]);
    }
  }
  // Category vocabulary (the category and the generic counterparts) never
  // marks a line: "card" in "Gold Card" is the category's noun, not a tier.
  const singular = (w: string) => w.replace(/s$/, "");
  const generic = new Set<string>();
  for (const t of famTokens(category)) generic.add(singular(t));
  for (const { counterpart } of lines.values()) for (const t of famTokens(counterpart ?? "")) generic.add(singular(t));
  const lineWords: Set<string>[] = [];
  for (const { line } of lines.values()) {
    const ws = new Set(wordsOf(famTokens(line).filter((t) => !brandTokens.has(t))).filter((w) => w.length >= 3 && !generic.has(singular(w))));
    if (ws.size > 0) lineWords.push(ws);
  }
  return { brandTokens, lineWords };
}

/** A description of an option, never a named one: "a cheaper business
 * card", "no-annual-fee card", "the basic plan". Starts with an article or
 * carries a comparative / generic-tier word. */
const DESCRIPTOR = /\b(cheaper|cheapest|lower[- ]cost|low[- ]cost|no[- ](annual[- ])?fee|basic|budget|entry[- ]level|affordable|less expensive|more affordable)\b/i;
export function isDescription(surface: string): boolean {
  return /^(a|an|the)\s/i.test(surface) || /\d+\s?%/.test(surface) || /\bflat[- ]rate\b/i.test(surface) || DESCRIPTOR.test(surface);
}

/** Grouping words of an own option: non-brand, no stop words, singular -
 * so "Standard with ads", "with ads" and "ad-supported tier" share "ad". */
const OWN_STOP = new Set(["with", "tier", "tiers", "plan", "plans", "supported", "version", "option", "the", "its", "their", "edition", "model", "line"]);
const ownWords = (surface: string, basis: OwnBasis) =>
  [...new Set(wordsOf(famTokens(surface).filter((t) => !basis.brandTokens.has(t))).filter((w) => !OWN_STOP.has(w)).map((w) => w.replace(/s$/, "")))].sort();

/** A mention resolving to the client: is it a specific own line other than
 * the row's asked line? */
function namesOtherLine(surface: string, line: string | null, basis: OwnBasis): boolean {
  const d = famTokens(surface).filter((t) => !basis.brandTokens.has(t));
  if (d.length === 0) return false; // the bare brand
  const words = wordsOf(d);
  const lineW = line ? wordsOf(famTokens(line).filter((t) => !basis.brandTokens.has(t))) : [];
  if (words.length === 0) return lineW.length > 0; // a bare model number
  const asked = new Set(lineW);
  return !words.every((w) => asked.has(w));
}

/** Room -> the confirmed line and counterpart, from the setup decision. */
function decidedLines(json: string | null | undefined): Map<string, { line: string; counterpart: string | null }> {
  const out = new Map<string, { line: string; counterpart: string | null }>();
  if (!json) return out;
  try {
    const decided = (JSON.parse(json) as { valueLines?: { decided?: Record<string, unknown> } }).valueLines?.decided ?? {};
    for (const [room, v] of Object.entries(decided)) {
      if (typeof v === "string") out.set(room, { line: v, counterpart: null });
      else if (v && typeof v === "object" && typeof (v as { line?: unknown }).line === "string") {
        const c = (v as { counterpart?: unknown }).counterpart;
        out.set(room, { line: (v as { line: string }).line, counterpart: typeof c === "string" ? c : null });
      }
    }
  } catch {
    // An unreadable record shows no lines; the verdicts still read.
  }
  return out;
}

function factsOf(
  row: PoolRow,
  resolve: Resolver,
  targetKey: string,
  line: { line: string; counterpart: string | null } | undefined,
  basis: OwnBasis
): Facts {
  const instead = new Map<string, string>();
  const own = new Map<string, string>();
  // Grouped by the surface's non-brand words, so "<Brand> Standard with
  // ads" and "Standard with ads" are one option.
  const addOwn = (raw: string) => {
    const surface = surfaceOf(raw);
    if (isDescription(surface)) return;
    const d = ownWords(surface, basis);
    const k = d.length > 0 ? d.join(" ") : matchKey(surface);
    if (k && !own.has(k)) own.set(k, surface);
  };
  const counterpartOwn = line?.counterpart ? resolve(line.counterpart).key === targetKey : false;
  for (const m of row.code.mentions ?? []) {
    if (m.framing !== "recommended") continue;
    const r = resolve(m.brand);
    if (r.status === "active" && r.key !== targetKey) instead.set(r.key, r.name);
    else if (r.key === targetKey) {
      const surface = surfaceOf(m.brand);
      if (namesOtherLine(surface, line?.line ?? null, basis)) addOwn(m.brand);
      else if (counterpartOwn && matchKey(surface) === matchKey(line!.counterpart!)) addOwn(m.brand);
    }
  }
  for (const rule of row.code.decision_rules ?? []) {
    if (rule.choice !== "cheaper" || !rule.product) continue;
    const surface = surfaceOf(rule.product);
    if (!surface) continue;
    const r = resolve(surface);
    const words = wordsOf(famTokens(surface));
    const has = new Set(words);
    const mine =
      r.key === targetKey
        ? namesOtherLine(surface, line?.line ?? null, basis)
        : r.status !== "active" && basis.lineWords.some((ws) => [...ws].every((w) => has.has(w)));
    if (mine) addOwn(rule.product);
  }
  const w = row.code.worth_it;
  return {
    row,
    room: row.intent.situation ?? "",
    worth: w === "yes" || w === "no" ? w : "depends",
    instead,
    own,
  };
}

/** `request.room` (Journey's buyer filter) keeps that room's Value cells. */
export function computeValue(data: ViewData, request: ViewRequest = {}): ValueView | null {
  const { project, dictionary } = data;
  const { rows: pool, uncoded, core } = poolOf(data, "value", request);
  if (pool.length === 0 && uncoded === 0) return null;
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const lines = decidedLines(data.setupDecision);
  const basis = ownBasis(resolve, project.brand, project.category, lines);
  const lineWordSet = new Set<string>();
  for (const ws of basis.lineWords) for (const w of ws) lineWordSet.add(w.replace(/s$/, ""));
  const facts = pool.map((r) => factsOf(r, resolve, targetKey, lines.get(r.intent.situation ?? ""), basis));

  const rowOf = (key: string, label: string, list: Facts[]): ValueRow => {
    const rooms = [...new Set(list.map((f) => f.room))];
    const ls = [...new Set(rooms.map((r) => lines.get(r)?.line ?? null))];
    const cs = [...new Set(rooms.map((r) => lines.get(r)?.counterpart ?? null))];
    return {
      key,
      label,
      rooms,
      line: ls.length === 1 ? ls[0] : null,
      counterpart: cs.length === 1 ? cs[0] : null,
      answers: list.length,
      worth: worthCells(list),
      ...insteadOf(list, 4, 3, lineWordSet),
    };
  };

  const byRoom = new Map<string, Facts[]>();
  for (const f of facts) byRoom.set(f.room, [...(byRoom.get(f.room) ?? []), f]);
  const rooms = [...byRoom.entries()]
    .map(([room, list]) => rowOf(room, room || "No room", list))
    .sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));

  const byLine = new Map<string, Facts[]>();
  for (const f of facts) {
    const line = lines.get(f.room)?.line;
    if (line) byLine.set(line, [...(byLine.get(line) ?? []), f]);
  }
  const lineRows = [...byLine.entries()]
    .map(([line, list]) => rowOf(line, line, list))
    .sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));

  const labels = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));
  return {
    runId: data.run.id,
    source: data.source,
    brand: project.brand,
    answers: facts.length,
    uncoded,
    worth: worthCells(facts),
    ...insteadOf(facts, 10, 5, lineWordSet),
    rooms,
    lines: lineRows,
    byEngine: [...core]
      .map((m) => {
        const list = facts.filter((f) => f.row.model === m);
        return { key: m, label: labels.get(m) ?? m, ...facetsOf(m), answers: list.length, worth: worthCells(list) };
      })
      .filter((s) => s.answers > 0),
  };
}

// v2 (2026-10-28): names resolve through the context judge (context_judge.ts).
// v5 (2026-11-03): engine slices carry vendor / tier / mode (the Panel lens's Group-by).
// v6 (2026-11-03): the own rung - ownRung and own: true entries in `instead`.
const VALUE_VERSION = "v6";
export function computeValueCached(run: Run, project: Project, request: ViewRequest = {}): Promise<ValueView | null> {
  const r = requestOf(request, true);
  return cachedView("value", VALUE_VERSION, run, project, (d) => computeValue(d, r), { setupDecision: true, judge: true }, r);
}
