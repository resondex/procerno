import { ENGINES, engineDisplayLabel } from "./providers";
import { buildResolver } from "./brand_resolve";
import { containsSeq, famTokens } from "./brand_family";
import { excludedWords } from "./definition_overlap";
import { conditionKeyMap, conditionStemKey } from "./condition_groups";
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

/**
 * The conditions panel (hh2, 2026-10-27, CONDITIONS_PANEL_PLAN_2026-10-27.md):
 * the head-to-head cells are context-free by design (s10), so the
 * circumstance-coloring lives inside the answers as stated carve-outs, and
 * the v0.4 decision_rules capture exactly those. Per matchup, each rule's
 * choice resolves through the dictionary like a top pick and lands on a
 * side: routes to you, routes to the rival, or routes to a third brand
 * (the leakage the two-way record hides). Conditions are grouped by their
 * distinctive stems (the definition_overlap stemming, category words out) -
 * deterministic, zero model calls; the group's label is its most frequent
 * surface wording. Rules are deduplicated per answer by (side, resolved
 * brand, condition group), since drc2 splits a multi-product branch into
 * one rule per product repeating the condition.
 */
export interface ConditionGroup {
  /** The group's most frequent surface wording. */
  label: string;
  /** Rules in the group after per-answer dedup. */
  n: number;
  /** A sample of the carrying answers' response ids. */
  ids: string[];
}

export interface ElsewhereBrand {
  name: string;
  n: number;
  conditions: ConditionGroup[];
}

export interface MatchupConditions {
  /** All stated rules on this matchup's answers (before dedup). */
  rules: number;
  /** Answers whose decision_rules is [] - pure default answers. */
  unconditional: number;
  you: ConditionGroup[];
  /** Condition groups beyond the listed top of `you` / `rival`. */
  youMore: number;
  rival: ConditionGroup[];
  rivalMore: number;
  elsewhere: ElsewhereBrand[];
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
  /** Absent when the codes source carries no decision_rules (pre-v0.4). */
  conditions?: MatchupConditions;
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

const GROUP_CAP = 12;
const ID_CAP = 8;

/** The conditions panel for one matchup - see MatchupConditions above.
 * Undefined when none of the matchup's answers carry decision_rules. */
function conditionsOf(
  list: { row: PoolRow }[],
  resolve: (name: string) => { key: string; name: string },
  targetKey: string,
  rivalKey: string,
  keyOf: (condition: string) => string
): MatchupConditions | undefined {
  type Acc = { n: number; surfaces: Map<string, number>; ids: Set<string> };
  const fresh = (): Acc => ({ n: 0, surfaces: new Map(), ids: new Set() });
  const sides = { you: new Map<string, Acc>(), rival: new Map<string, Acc>() };
  const elsewhere = new Map<string, { name: string; n: number; conds: Map<string, Acc> }>();
  let rules = 0;
  let unconditional = 0;
  let any = false;
  for (const { row } of list) {
    const dr = row.code.decision_rules;
    if (dr == null) continue;
    any = true;
    if (dr.length === 0) { unconditional++; continue; }
    const seen = new Set<string>();
    for (const rule of dr) {
      rules++;
      const r = resolve(rule.choice);
      const side = r.key === targetKey ? "you" : r.key === rivalKey ? "rival" : "elsewhere";
      const condition = rule.condition.trim();
      const ck = keyOf(condition);
      const dedup = `${side}|${side === "elsewhere" ? r.key : ""}|${ck}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      let acc: Acc;
      if (side === "elsewhere") {
        let e = elsewhere.get(r.key);
        if (!e) { e = { name: r.name, n: 0, conds: new Map() }; elsewhere.set(r.key, e); }
        e.n++;
        acc = e.conds.get(ck) ?? fresh();
        e.conds.set(ck, acc);
      } else {
        acc = sides[side].get(ck) ?? fresh();
        sides[side].set(ck, acc);
      }
      acc.n++;
      acc.surfaces.set(condition, (acc.surfaces.get(condition) ?? 0) + 1);
      if (acc.ids.size < ID_CAP) acc.ids.add(row.code.response_id);
    }
  }
  if (!any) return undefined;
  const groups = (m: Map<string, Acc>, cap = GROUP_CAP): ConditionGroup[] =>
    [...m.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, cap)
      .map((a) => ({
        label: [...a.surfaces.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0][0],
        n: a.n,
        ids: [...a.ids],
      }));
  return {
    rules,
    unconditional,
    you: groups(sides.you),
    youMore: Math.max(0, sides.you.size - GROUP_CAP),
    rival: groups(sides.rival),
    rivalMore: Math.max(0, sides.rival.size - GROUP_CAP),
    elsewhere: [...elsewhere.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .map((e) => ({ name: e.name, n: e.n, conditions: groups(e.conds, 4) })),
  };
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

async function computeKind(data: ViewData, kind: "entity" | "class"): Promise<HeadToHeadView | null> {
  const { project, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged);
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
  const exclude = excludedWords([project.category]);
  // One grouping over the whole view's conditions (embeddings-first, stem
  // fallback) - the same wording groups identically across every matchup.
  const condCounts = new Map<string, number>();
  for (const s of scored) {
    for (const rule of s.row.code.decision_rules ?? []) {
      const c = rule.condition.trim();
      condCounts.set(c, (condCounts.get(c) ?? 0) + 1);
    }
  }
  const condKeys = await conditionKeyMap(condCounts, exclude);
  const keyOf = (c: string) => condKeys.get(c) ?? conditionStemKey(c, exclude);
  const rows: HeadToHeadRow[] = [...byRival.entries()].map(([key, list]) => {
    const meta = rivalMeta.get(key)!;
    const others = new Map<string, number>();
    for (const s of list) if (s.otherName) others.set(s.otherName, (others.get(s.otherName) ?? 0) + 1);
    const conditions = conditionsOf(list, resolve, targetKey, key, keyOf);
    return {
      key,
      rival: meta.name,
      resolved: meta.resolved,
      cells: new Set(list.map((s) => s.row.intent.id)).size,
      answers: list.length,
      ...tallyOf(list),
      ...(conditions && { conditions }),
      otherPicks: [...others.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([name, n]) => ({ name, n })),
    };
  });
  rows.sort((a, b) => b.answers - a.answers || a.rival.localeCompare(b.rival));

  const engineLabel = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));
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

export async function computeHeadToHead(data: ViewData): Promise<HeadToHeadViews> {
  return {
    runId: data.run.id,
    source: data.source,
    brand: data.project.brand,
    entity: await computeKind(data, "entity"),
    class: await computeKind(data, "class"),
  };
}

// hh4 (2026-10-28): names resolve through the context judge (context_judge.ts) -
// a rival's maker-less products move from "routes elsewhere" to the rival's side.
const HEAD_TO_HEAD_VERSION = "hh5";
export function computeHeadToHeadCached(run: Run, project: Project): Promise<HeadToHeadViews | null> {
  return cachedView("head_to_head", HEAD_TO_HEAD_VERSION, run, project, computeHeadToHead, { judge: true });
}
