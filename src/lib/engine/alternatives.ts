import { matchKey } from "../brand_key";
import { ENGINES } from "./providers";
import { buildResolver, type Resolver } from "./brand_resolve";
import { roleOf, type HeadlineBrand } from "./headline";
import { cachedView, cell, poolOf, type PoolRow, type RateCell, type ViewData } from "./view_data";
import type { Project, Run } from "../types";

/**
 * The alternatives views (2026-10-27), each its own view, never pooled into
 * the headline (CODING_DECISIONS section 8 / section 12 routing).
 *
 * Offensive capture: a rival's customer says they are leaving it and asks
 * what to get instead (generic-angle cells - no rival named - ride the same
 * view). Read: is the client named, recommended, picked, and who captures
 * the leaver. Each answer lands in one bucket: you (the top pick resolves to
 * the client), another brand (an active entry other than the client and the
 * rival being left), back to the same brand (the pick resolves to the rival
 * itself - a different product of the brand they said they were leaving),
 * outside your dictionary (rejected, pending or unknown), or no single pick.
 *
 * Defensive hold: the client's own customer is considering leaving and asks
 * what to look at instead. Read: keep / leave / undecided (keep_or_leave,
 * native on the alt_defensive schema) and the exits offered. Destinations
 * fill under ANY verdict (Tyler 2026-10-13), so they are always reported
 * paired with the verdict - an offered exit on a keep answer is not a loss.
 * A destination that resolves to the client is the brand's own product
 * (offered, but not an exit) and is counted apart.
 */

export type { RateCell };

export interface NamedCount {
  name: string;
  n: number;
}

// ---------- offensive capture ----------

export interface CaptureRow {
  /** The rival being left: its dictionary entry id, "?" + name when
   * unresolved, or "generic" for cells that name no rival. */
  key: string;
  rival: string;
  resolved: boolean;
  answers: number;
  named: RateCell;
  recommended: RateCell;
  captured: RateCell;
  anotherBrand: RateCell;
  sameBrand: RateCell;
  outside: RateCell;
  undecided: RateCell;
  /** Who the firm picks went to, most first (resolved names). */
  captors: NamedCount[];
}

export interface CaptureSlice {
  key: string;
  label: string;
  answers: number;
  named: RateCell;
  captured: RateCell;
  undecided: RateCell;
}

export interface CaptorBrand {
  key: string;
  name: string;
  role: HeadlineBrand["role"];
  named: RateCell;
  chosen: RateCell;
  /** Chosen over the in-category picks (the same-brand returns included). */
  shareOfDecided: RateCell;
}

export interface OffensiveView {
  brand: string;
  answers: number;
  uncoded: number;
  overall: Omit<CaptureRow, "key" | "rival" | "resolved" | "answers" | "captors">;
  rows: CaptureRow[];
  captors: CaptorBrand[];
  outsidePicks: NamedCount[];
  byEngine: CaptureSlice[];
}

// ---------- defensive hold ----------

export interface Verdicts {
  keep: RateCell;
  leave: RateCell;
  undecided: RateCell;
}

export interface DestinationRow {
  key: string;
  name: string;
  /** "outside" = not an approved, analyzed brand (no row is shown). */
  role: HeadlineBrand["role"] | "outside";
  /** Answers offering it, over all defensive answers. */
  offered: RateCell;
  /** Answers offering it, by the answer's verdict (counts). */
  onKeep: number;
  onLeave: number;
  onUndecided: number;
}

export interface HoldSlice {
  key: string;
  label: string;
  answers: number;
  verdicts: Verdicts;
  offersExit: RateCell;
}

export interface DefensiveView {
  brand: string;
  answers: number;
  uncoded: number;
  verdicts: Verdicts;
  /** Answers naming at least one exit (a destination that is not the client). */
  offersExit: RateCell;
  /** offersExit within each verdict. */
  offersExitBy: { keep: RateCell; leave: RateCell; undecided: RateCell };
  /** Mean exits named per answer that names any. */
  exitsPerAnswer: number;
  /** Answers listing the client's own product among the destinations. */
  ownProduct: RateCell;
  destinations: DestinationRow[];
  outsideDestinations: NamedCount[];
  byEngine: HoldSlice[];
}

export interface AlternativesViews {
  runId: string;
  source: string;
  brand: string;
  offensive: OffensiveView | null;
  defensive: DefensiveView | null;
}

const engineLabels = () => new Map(ENGINES.map((e) => [e.id, e.label]));
const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
const topCounts = (m: Map<string, number>, limit: number): NamedCount[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, n]) => ({ name, n }));

type CaptureBucket = "captured" | "anotherBrand" | "sameBrand" | "outside" | "undecided";

interface CaptureFacts {
  rival: { key: string; name: string; resolved: boolean };
  model: string;
  bucket: CaptureBucket;
  pickKey: string | null;
  pickName: string | null;
  named: Set<string>;
  recommended: Set<string>;
}

function rivalOf(angle: string | null, resolve: Resolver) {
  if (!angle || angle === "generic") return { key: "generic", name: "No rival named", resolved: true };
  const r = resolve(angle);
  return r.status === "active"
    ? { key: r.key, name: r.name, resolved: true }
    : { key: r.key, name: angle, resolved: false };
}

function captureFacts(row: PoolRow, resolve: Resolver, targetKey: string): CaptureFacts {
  const c = row.code;
  const rival = rivalOf(row.intent.angle, resolve);
  const named = new Set<string>();
  const recommended = new Set<string>();
  for (const m of c.mentions ?? []) {
    const r = resolve(m.brand);
    if (r.status !== "active") continue;
    named.add(r.key);
    if (m.framing === "recommended") recommended.add(r.key);
  }
  let bucket: CaptureBucket = "undecided";
  let pickKey: string | null = null;
  let pickName: string | null = null;
  if (c.outcome === "pick" && c.top_pick) {
    const r = resolve(c.top_pick);
    pickName = r.name;
    if (r.status !== "active") bucket = "outside";
    else {
      pickKey = r.key;
      named.add(r.key);
      recommended.add(r.key);
      bucket = r.key === targetKey ? "captured" : r.key === rival.key ? "sameBrand" : "anotherBrand";
    }
  }
  return { rival, model: row.model, bucket, pickKey, pickName, named, recommended };
}

function captureTally(list: CaptureFacts[], targetKey: string) {
  const n = list.length;
  const b = (x: CaptureBucket) => cell(count(list, (f) => f.bucket === x), n);
  return {
    named: cell(count(list, (f) => f.named.has(targetKey)), n),
    recommended: cell(count(list, (f) => f.recommended.has(targetKey)), n),
    captured: b("captured"),
    anotherBrand: b("anotherBrand"),
    sameBrand: b("sameBrand"),
    outside: b("outside"),
    undecided: b("undecided"),
  };
}

function computeOffensive(data: ViewData, resolve: Resolver, targetKey: string): OffensiveView | null {
  const { project, dictionary } = data;
  const { rows: pool, uncoded, core } = poolOf(data, "offensive_capture");
  if (pool.length === 0 && uncoded === 0) return null;
  const facts = pool.map((r) => captureFacts(r, resolve, targetKey));

  const byRival = new Map<string, CaptureFacts[]>();
  for (const f of facts) byRival.set(f.rival.key, [...(byRival.get(f.rival.key) ?? []), f]);
  const rows: CaptureRow[] = [...byRival.values()].map((list) => {
    const captors = new Map<string, number>();
    for (const f of list) if (f.pickName && f.bucket !== "outside") captors.set(f.pickName, (captors.get(f.pickName) ?? 0) + 1);
    return {
      key: list[0].rival.key,
      rival: list[0].rival.name,
      resolved: list[0].rival.resolved,
      answers: list.length,
      ...captureTally(list, targetKey),
      captors: topCounts(captors, 4),
    };
  });
  rows.sort((a, b) => b.answers - a.answers || a.rival.localeCompare(b.rival));

  // Who captures the leavers, across every rival.
  const n = facts.length;
  const inCategory = count(facts, (f) => f.pickKey !== null);
  const entryByKey = new Map(dictionary.map((e) => [e.id, e]));
  const legacy = new Set(project.competitors.map(matchKey));
  const tally = new Map<string, { named: number; chosen: number }>();
  for (const f of facts) {
    for (const k of f.named) {
      const t = tally.get(k) ?? { named: 0, chosen: 0 };
      t.named++;
      tally.set(k, t);
    }
    if (f.pickKey) tally.get(f.pickKey)!.chosen++;
  }
  if (!tally.has(targetKey)) tally.set(targetKey, { named: 0, chosen: 0 });
  const captors: CaptorBrand[] = [];
  for (const [key, t] of tally) {
    const entry = entryByKey.get(key) ?? null;
    if (entry && !entry.analyzed && key !== targetKey) continue;
    captors.push({
      key,
      name: entry ? entry.display_name ?? entry.canonical : project.brand,
      role: roleOf(key, targetKey, entry, legacy),
      named: cell(t.named, n),
      chosen: cell(t.chosen, n),
      shareOfDecided: cell(t.chosen, inCategory),
    });
  }
  captors.sort((a, b) => b.chosen.k - a.chosen.k || b.named.k - a.named.k || a.name.localeCompare(b.name));

  const outside = new Map<string, number>();
  for (const f of facts) if (f.bucket === "outside" && f.pickName) outside.set(f.pickName, (outside.get(f.pickName) ?? 0) + 1);

  const labels = engineLabels();
  const byEngine: CaptureSlice[] = [...core]
    .map((m) => {
      const list = facts.filter((f) => f.model === m);
      const t = captureTally(list, targetKey);
      return { key: m, label: labels.get(m) ?? m, answers: list.length, named: t.named, captured: t.captured, undecided: t.undecided };
    })
    .filter((s) => s.answers > 0);

  return {
    brand: project.brand,
    answers: n,
    uncoded,
    overall: captureTally(facts, targetKey),
    rows,
    captors,
    outsidePicks: topCounts(outside, 12),
    byEngine,
  };
}

// ---------- defensive ----------

type Verdict = "keep" | "leave" | "undecided";

interface HoldFacts {
  model: string;
  verdict: Verdict;
  /** Resolved exits (the client excluded), deduped per answer. */
  exits: Map<string, { name: string; role: DestinationRow["role"] }>;
  ownProduct: boolean;
}

function verdictsOf(list: HoldFacts[]): Verdicts {
  const n = list.length;
  return {
    keep: cell(count(list, (f) => f.verdict === "keep"), n),
    leave: cell(count(list, (f) => f.verdict === "leave"), n),
    undecided: cell(count(list, (f) => f.verdict === "undecided"), n),
  };
}

function computeDefensive(data: ViewData, resolve: Resolver, targetKey: string): DefensiveView | null {
  const { project, dictionary } = data;
  const { rows: pool, uncoded, core } = poolOf(data, "defensive_hold");
  if (pool.length === 0 && uncoded === 0) return null;
  const entryByKey = new Map(dictionary.map((e) => [e.id, e]));
  const legacy = new Set(project.competitors.map(matchKey));
  const outsideNames = new Map<string, number>();

  const facts: HoldFacts[] = pool.map(({ code: c, model }) => {
    const verdict: Verdict = c.keep_or_leave === "keep" || c.keep_or_leave === "leave" ? c.keep_or_leave : "undecided";
    const exits = new Map<string, { name: string; role: DestinationRow["role"] }>();
    let ownProduct = false;
    const outsideHere = new Set<string>();
    for (const d of c.destinations ?? []) {
      const r = resolve(d);
      if (r.key === targetKey) {
        ownProduct = true;
        continue;
      }
      if (r.status === "active") {
        const entry = entryByKey.get(r.key) ?? null;
        // An exit to an unanalyzed brand still counts as an exit; only its row is hidden.
        exits.set(r.key, { name: r.name, role: entry && !entry.analyzed ? "outside" : roleOf(r.key, targetKey, entry, legacy) });
      } else {
        exits.set(r.key, { name: r.name, role: "outside" });
        outsideHere.add(r.name);
      }
    }
    for (const name of outsideHere) outsideNames.set(name, (outsideNames.get(name) ?? 0) + 1);
    return { model, verdict, exits, ownProduct };
  });

  const n = facts.length;
  const dest = new Map<string, DestinationRow & { k: number }>();
  for (const f of facts) {
    for (const [key, x] of f.exits) {
      const d = dest.get(key) ?? { key, name: x.name, role: x.role, offered: cell(0, n), onKeep: 0, onLeave: 0, onUndecided: 0, k: 0 };
      d.k++;
      if (f.verdict === "keep") d.onKeep++;
      else if (f.verdict === "leave") d.onLeave++;
      else d.onUndecided++;
      dest.set(key, d);
    }
  }
  const destinations: DestinationRow[] = [...dest.values()]
    .filter((d) => d.role !== "outside")
    .map(({ k, ...d }) => ({ ...d, offered: cell(k, n) }))
    .sort((a, b) => b.offered.k - a.offered.k || a.name.localeCompare(b.name));

  const withExits = facts.filter((f) => f.exits.size > 0);
  const exitBy = (v: Verdict) => {
    const list = facts.filter((f) => f.verdict === v);
    return cell(count(list, (f) => f.exits.size > 0), list.length);
  };
  const labels = engineLabels();
  const byEngine: HoldSlice[] = [...core]
    .map((m) => {
      const list = facts.filter((f) => f.model === m);
      return {
        key: m,
        label: labels.get(m) ?? m,
        answers: list.length,
        verdicts: verdictsOf(list),
        offersExit: cell(count(list, (f) => f.exits.size > 0), list.length),
      };
    })
    .filter((s) => s.answers > 0);

  return {
    brand: project.brand,
    answers: n,
    uncoded,
    verdicts: verdictsOf(facts),
    offersExit: cell(withExits.length, n),
    offersExitBy: { keep: exitBy("keep"), leave: exitBy("leave"), undecided: exitBy("undecided") },
    exitsPerAnswer: withExits.length > 0 ? withExits.reduce((a, f) => a + f.exits.size, 0) / withExits.length : 0,
    ownProduct: cell(count(facts, (f) => f.ownProduct), n),
    destinations,
    outsideDestinations: topCounts(outsideNames, 12),
    byEngine,
  };
}

export function computeAlternatives(data: ViewData): AlternativesViews {
  const resolve = buildResolver(data.dictionary);
  const targetKey = resolve(data.project.brand).key;
  return {
    runId: data.run.id,
    source: data.source,
    brand: data.project.brand,
    offensive: computeOffensive(data, resolve, targetKey),
    defensive: computeDefensive(data, resolve, targetKey),
  };
}

const ALTERNATIVES_VERSION = "alt1";
export function computeAlternativesCached(run: Run, project: Project): Promise<AlternativesViews | null> {
  return cachedView("alternatives", ALTERNATIVES_VERSION, run, project, computeAlternatives);
}
