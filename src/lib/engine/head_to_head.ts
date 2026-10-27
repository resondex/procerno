import { ENGINES } from "./providers";
import { buildResolver } from "./brand_resolve";
import { containsSeq, famTokens } from "./brand_family";
import { cachedView, cell, poolOf, type PoolRow, type RateCell, type ViewData } from "./view_data";
import type { DictionaryEntry, Intent, Project, Run } from "../types";

/**
 * The head-to-head views (2026-10-27): prompted win rate per named rival,
 * never pooled into the headline (CODING_DECISIONS section 8). Entity cells
 * name a tracked rival in their angle; class cells (angle "class") set the
 * client against a class of product named in the question ("a Visa card") -
 * the class brand is read from the cell's text, since intents do not store it.
 *
 * Each answer lands in exactly one bucket: won (the top pick resolves to the
 * client), lost (to the named rival or class brand), another pick (the top
 * pick is some third name), or no single pick (conditional, no_pick,
 * clarification). Top picks resolve through the current dictionary at read
 * time, so "Pixel 11" counts for Google Pixel and "Chase Sapphire Preferred"
 * for Chase. On class cells a third-party product on the class's rail (an
 * issuer's card) stays "another pick": rail attribution needs card-level
 * resolution and is never guessed (AGENTS.md, rail rollup constraints).
 */

export type { RateCell };

export interface NamedCount {
  name: string;
  n: number;
}

export interface HeadToHeadRow {
  /** Rival identity: the dictionary entry id, or "?" + the name when unresolved. */
  key: string;
  rival: string;
  /** False when the rival named by the cell is not an active dictionary entry. */
  resolved: boolean;
  cells: number;
  answers: number;
  /** Prompted win rate: the client is the pick. */
  won: RateCell;
  lost: RateCell;
  other: RateCell;
  undecided: RateCell;
  /** Won over won + lost - the straight two-way record. */
  winOfDecided: RateCell;
  otherPicks: NamedCount[];
}

export interface HeadToHeadSlice {
  key: string;
  label: string;
  answers: number;
  won: RateCell;
  lost: RateCell;
  undecided: RateCell;
}

export interface HeadToHeadView {
  kind: "entity" | "class";
  brand: string;
  answers: number;
  uncoded: number;
  /** Across every rival of this kind - the overall prompted record. */
  overall: { won: RateCell; lost: RateCell; other: RateCell; undecided: RateCell; winOfDecided: RateCell };
  rows: HeadToHeadRow[];
  byEngine: HeadToHeadSlice[];
}

export interface HeadToHeadViews {
  runId: string;
  source: string;
  brand: string;
  entity: HeadToHeadView | null;
  class: HeadToHeadView | null;
}

type Bucket = "won" | "lost" | "other" | "undecided";

/** The class brand a class cell names: the longest active entry form found
 * in the cell's text, the client excluded. */
function classBrandOf(
  intent: Intent,
  forms: { seq: string[]; entry: DictionaryEntry }[],
  targetKey: string
): DictionaryEntry | null {
  const hay = famTokens(intent.text);
  let best: { seq: string[]; entry: DictionaryEntry } | null = null;
  for (const f of forms) {
    if (f.entry.id === targetKey) continue;
    if (containsSeq(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
  }
  return best?.entry ?? null;
}

function tallyOf(rows: { bucket: Bucket }[]) {
  const n = rows.length;
  const count = (b: Bucket) => rows.filter((r) => r.bucket === b).length;
  const won = count("won");
  const lost = count("lost");
  return {
    won: cell(won, n),
    lost: cell(lost, n),
    other: cell(count("other"), n),
    undecided: cell(count("undecided"), n),
    winOfDecided: cell(won, won + lost),
  };
}

function computeKind(data: ViewData, kind: "entity" | "class"): HeadToHeadView | null {
  const { project, dictionary } = data;
  const resolve = buildResolver(dictionary);
  const targetKey = resolve(project.brand).key;
  const { rows: pool, uncoded, core } = poolOf(
    data,
    kind === "entity" ? "head_to_head_entity" : "head_to_head_class"
  );
  if (pool.length === 0 && uncoded === 0) return null;

  const forms: { seq: string[]; entry: DictionaryEntry }[] = [];
  for (const e of dictionary) {
    if (e.status !== "active") continue;
    for (const f of [e.canonical, ...e.aliases]) forms.push({ seq: famTokens(f), entry: e });
  }
  const rivalOfIntent = new Map<string, { key: string; name: string; resolved: boolean }>();
  const rivalOf = (intent: Intent) => {
    const hit = rivalOfIntent.get(intent.id);
    if (hit) return hit;
    let out: { key: string; name: string; resolved: boolean };
    if (kind === "class") {
      const e = classBrandOf(intent, forms, targetKey);
      out = e
        ? { key: e.id, name: e.display_name ?? e.canonical, resolved: true }
        : { key: `?${intent.id}`, name: intent.text, resolved: false };
    } else {
      const r = resolve(intent.angle);
      out = r.status === "active"
        ? { key: r.key, name: r.name, resolved: true }
        : { key: r.key, name: intent.angle, resolved: false };
    }
    rivalOfIntent.set(intent.id, out);
    return out;
  };

  const scored: { row: PoolRow; rival: string; bucket: Bucket; otherName?: string }[] = [];
  for (const row of pool) {
    const rival = rivalOf(row.intent);
    const c = row.code;
    let bucket: Bucket = "undecided";
    let otherName: string | undefined;
    if (c.outcome === "pick" && c.top_pick) {
      const r = resolve(c.top_pick);
      if (r.key === targetKey) bucket = "won";
      else if (r.key === rival.key) bucket = "lost";
      else {
        bucket = "other";
        otherName = r.name;
      }
    }
    scored.push({ row, rival: rival.key, bucket, otherName });
  }

  const byRival = new Map<string, typeof scored>();
  for (const s of scored) byRival.set(s.rival, [...(byRival.get(s.rival) ?? []), s]);
  const rivalMeta = new Map([...rivalOfIntent.values()].map((r) => [r.key, r]));
  const rows: HeadToHeadRow[] = [...byRival.entries()].map(([key, list]) => {
    const meta = rivalMeta.get(key)!;
    const others = new Map<string, number>();
    for (const s of list) if (s.otherName) others.set(s.otherName, (others.get(s.otherName) ?? 0) + 1);
    return {
      key,
      rival: meta.name,
      resolved: meta.resolved,
      cells: new Set(list.map((s) => s.row.intent.id)).size,
      answers: list.length,
      ...tallyOf(list),
      otherPicks: [...others.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([name, n]) => ({ name, n })),
    };
  });
  rows.sort((a, b) => b.answers - a.answers || a.rival.localeCompare(b.rival));

  const engineLabel = new Map(ENGINES.map((e) => [e.id, e.label]));
  const byEngine: HeadToHeadSlice[] = [...core]
    .map((m) => {
      const list = scored.filter((s) => s.row.model === m);
      const t = tallyOf(list);
      return { key: m, label: engineLabel.get(m) ?? m, answers: list.length, won: t.won, lost: t.lost, undecided: t.undecided };
    })
    .filter((s) => s.answers > 0);

  return {
    kind,
    brand: project.brand,
    answers: scored.length,
    uncoded,
    overall: tallyOf(scored),
    rows,
    byEngine,
  };
}

export function computeHeadToHead(data: ViewData): HeadToHeadViews {
  return {
    runId: data.run.id,
    source: data.source,
    brand: data.project.brand,
    entity: computeKind(data, "entity"),
    class: computeKind(data, "class"),
  };
}

const HEAD_TO_HEAD_VERSION = "hh1";
export function computeHeadToHeadCached(run: Run, project: Project): Promise<HeadToHeadViews | null> {
  return cachedView("head_to_head", HEAD_TO_HEAD_VERSION, run, project, computeHeadToHead);
}
