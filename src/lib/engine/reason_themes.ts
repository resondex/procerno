import { createHash } from "node:crypto";
import { firstJsonObject } from "./brief_writer";
import { DOSSIER_THEME_MODEL } from "./models";
import { openaiClient } from "./providers";
import { isWallWording } from "./wall_wording";
import type { RuleGroup } from "./rules_explorer";
import { withCostContext } from "../cost_log";
import { store } from "../store";
import type { CacheMeta, Intent } from "../types";
import type { AnswerRef, RouteShare } from "./analysis_types";

/**
 * The reason themes (moved out of dossiers.ts 2026-11-09, option D - one
 * panel grammar): the two-level LLM grouping of a run's stated reasons
 * (per buying situation, then across situations), per side, and the tree a
 * side's pool partitions into. Shared by the Rivals dossiers and the analysis
 * map's position panel, so both surfaces read one vocabulary through ONE
 * cache (`dossier_themes:dt4:...` - the key prefix, prompts and call inputs
 * are byte-identical to the dossier's own since dt4; never rename them).
 * Imports neither dossiers.ts nor analysis_map.ts (dossiers imports the map).
 */

/** Same formatting as the brief's (answer_cards.ts pctOf) - local to keep the import graph acyclic. */
const pctOf = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

/** One stated reason inside a situation's theme: its share of the side's
 * base over its questions in that situation. */
export interface DossierThemeGroup {
  label: string;
  share: string;
  /** Possession-shaped wording (isWallWording): a state the buyer is in, not an argument. Set only when true. */
  wall?: boolean;
}

/** One buying situation's theme inside a total theme. members is empty when
 * the bucket is a single reason worded as the bucket. */
export interface DossierThemeBucket {
  scenario: string;
  label: string;
  share: string;
  members: DossierThemeGroup[];
  /** Set (true only) when the bucket renders as a single reason (members empty) worded as a wall. */
  wall?: boolean;
}

/** A theme of stated reasons across buying situations. buckets is empty when
 * the theme is a single reason in a single situation (reads as a flat row). */
export interface DossierTheme {
  label: string;
  share: string;
  buckets: DossierThemeBucket[];
  /** Set (true only) when the theme renders flat (buckets empty) and its wording is a wall. */
  wall?: boolean;
  /** am15 / do7 (additive): up to 2 answers stating a member reason, on
   * different engines; find = the answer's own wording of it. */
  receipts?: AnswerRef[];
  /** am15 / do7, away-side themes only: the active brands the member rules
   * send buyers to - top 3 with >= 15% of the theme's answers that name a
   * destination and at least 2 answers. */
  routes?: RouteShare[];
}

/** One answer's statement of one rule group (rules_explorer capture, never
 * served): its own wording, where its rules in the group send buyers (active
 * brands, away side only), its engine and its question. */
export interface AnswerRule {
  said: string;
  to: string[];
  model: string;
  intent: string;
}

/** Group id -> response id -> that answer's statement of the group. */
export type AnswerRules = Map<string, Map<string, AnswerRule>>;

/** What a theme tree attaches its evidence from (optional; the tree itself
 * is unchanged without it). `accept` narrows the receipts (a dossier's
 * themes take only answers that send buyers to its brand). */
export interface ThemeEvidence {
  rules: AnswerRules;
  side: ThemeSide;
  accept?: (r: AnswerRule) => boolean;
}

export const ROUTE_MIN_SHARE = 0.15;
export const ROUTE_MIN_ANSWERS = 2;
export const ROUTE_TOP = 3;

/** Up to `k` statements on distinct engines, in order (the first engine's first statement first). */
export function spreadRefs(items: { id: string; find: string; model: string }[], k = 2): AnswerRef[] {
  const out: AnswerRef[] = [];
  const models = new Set<string>();
  const ids = new Set<string>();
  for (const x of items) {
    if (out.length >= k) break;
    if (models.has(x.model) || ids.has(x.id) || !x.find.trim()) continue;
    models.add(x.model);
    ids.add(x.id);
    out.push({ responseId: x.id, find: x.find });
  }
  return out;
}

/** Where a set of answers is sent: per answer its destination names; the
 * share is of the answers naming any destination. */
export function routeShares(destinations: Iterable<string[]>): RouteShare[] {
  const by = new Map<string, number>();
  let routed = 0;
  for (const to of destinations) {
    const set = new Set(to);
    if (!set.size) continue;
    routed++;
    for (const name of set) by.set(name, (by.get(name) ?? 0) + 1);
  }
  if (!routed) return [];
  return [...by.entries()]
    .filter(([, k]) => k >= ROUTE_MIN_ANSWERS && k / routed >= ROUTE_MIN_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, ROUTE_TOP)
    .map(([name, k]) => ({ name, share: pctOf(k / routed) }));
}

/** A theme's receipts and routes from its member groups (largest first). */
function themeEvidenceOf(groupIds: string[], ev: ThemeEvidence, inCell: (r: AnswerRule) => boolean): Pick<DossierTheme, "receipts" | "routes"> {
  const statements: { id: string; find: string; model: string }[] = [];
  const dest = new Map<string, string[]>();
  for (const gid of groupIds) {
    for (const [id, r] of ev.rules.get(gid) ?? []) {
      if (!inCell(r)) continue;
      if (!ev.accept || ev.accept(r)) statements.push({ id, find: r.said, model: r.model });
      if (ev.side === "away") dest.set(id, [...(dest.get(id) ?? []), ...r.to]);
    }
  }
  const receipts = spreadRefs(statements);
  const routes = ev.side === "away" ? routeShares(dest.values()) : [];
  return { ...(receipts.length ? { receipts } : {}), ...(routes.length ? { routes } : {}) };
}

/** The pseudo-situation for cells asked across all buyers (no room). */
export const EVERY_BUYER = "Every buyer";
export const THEME_VERSION = "dt4";
export const THEME_TTL_MS = 100 * 365 * 24 * 3600 * 1000; // forever in practice - the saved-tracker rule (2026-11-09): re-keyed by THEME_VERSION or the input hash, never aged out
export const THEME_CONCURRENCY = 6;

/** Which way the pooled reasons point. The pass runs once per side (dt4), so
 * a theme's name is coined from one direction's members only - the shared-pool
 * version named the axis both sides pivot on, and the identical label then
 * read as a contradiction across the two columns. */
export type ThemeSide = "toward" | "away";

export const sidePhrase = (side: ThemeSide) =>
  side === "toward" ? "points the buyer toward the client's product" : "points the buyer away from the client's product, to a rival";

export const THEME_REPLY =
  'Reply with ONLY a JSON object {"themes": [{"name": "...", "members": [indices]}]}. ' +
  "Name each theme in short plain buyer language, two to five words, with no digits and no counts. " +
  "A theme's name states what its conditions say, keeping their direction and the qualifier that carries " +
  "it - how much, with or without a cost, wanted or avoided - never the bare subject area the conditions " +
  "share. Every index must appear in exactly one theme.";

export const scenarioThemeSystem = (side: ThemeSide) =>
  "You group short conditions into themes. Each condition is a reason a buyer states, or a circumstance " +
  `a buyer describes, when an AI assistant ${sidePhrase(side)}. All the ` +
  "conditions you are given come from one buying situation, listed most common first. Beneath a condition, " +
  "sample lines show what buyers actually said under it; judge the condition's meaning from them. Group conditions " +
  "that express the same underlying reason, even when they are worded differently. Conditions that state " +
  "the same decision or stance in different words belong together; group by the buyer's underlying reason, " +
  "never by the product area the words mention. A condition that shares no reason with any other stays in " +
  "a theme of its own - never gather leftovers into one broad theme, since a name wide enough to cover " +
  "different reasons marks a wrong grouping. Typical output is three to ten themes. " +
  THEME_REPLY;

export const totalThemeSystem = (side: ThemeSide) =>
  "You merge themes across buying situations. Each theme gathers reasons buyers state when an AI assistant " +
  `${sidePhrase(side)}, and each belongs to one buying situation; they are listed ` +
  "most common first, each with the conditions it holds. Merge themes that express the same underlying " +
  "reason across situations into one theme. Judge each merge by what the member conditions say, not by " +
  "the theme's name; a merge is wrong when the members state different reasons, even when one name could " +
  "cover both. A theme whose reason is specific to its own situation, or that cannot merge anywhere, " +
  "stays a theme of its own. When the list is large, typical output is six to twelve themes. " +
  THEME_REPLY;

export const THEME_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "themes",
    strict: true,
    schema: {
      type: "object",
      properties: {
        themes: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, members: { type: "array", items: { type: "integer" } } },
            required: ["name", "members"],
            additionalProperties: false,
          },
        },
      },
      required: ["themes"],
      additionalProperties: false,
    },
  },
} as const;

/** A validated grouping: every index 0..n-1 in exactly one theme. */
export type ThemeGrouping = { name: string; members: number[] }[];

/** Sanitizes a theme name; empty or digit-bearing names fall back to the caller's label. */
export function cleanThemeName(raw: unknown, fallback: string): string {
  let n = typeof raw === "string" ? raw : "";
  n = n.replace(/[—–]/g, " - ").replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== n; ) {
    prev = n;
    n = n.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").replace(/[.,;:!?]+$/, "").trim();
  }
  return !n || /\d/.test(n) ? fallback : n;
}

/**
 * The mechanical guards over a parsed reply (or a cached value): indices out
 * of range dropped, an index in two themes keeps its first, an unplaced index
 * becomes its own theme, names sanitized (fallback: the theme's heaviest
 * member, i.e. its lowest index, since inputs are ordered by weight). Null
 * when the value is not a {themes: [...]} object at all.
 */
export function validateThemes(value: unknown, labels: string[]): ThemeGrouping | null {
  const themes = (value as { themes?: unknown } | null)?.themes;
  if (!Array.isArray(themes)) return null;
  const seen = new Set<number>();
  const out: ThemeGrouping = [];
  for (const t of themes) {
    const raw = (t as { members?: unknown })?.members;
    const members = (Array.isArray(raw) ? raw : [])
      .filter((i): i is number => Number.isInteger(i) && i >= 0 && i < labels.length && !seen.has(i))
      .filter((i, k, xs) => xs.indexOf(i) === k)
      .sort((a, b) => a - b);
    if (members.length === 0) continue;
    for (const i of members) seen.add(i);
    out.push({ name: cleanThemeName((t as { name?: unknown }).name, labels[members[0]]), members });
  }
  for (let i = 0; i < labels.length; i++) if (!seen.has(i)) out.push({ name: cleanThemeName(labels[i], labels[i]), members: [i] });
  return out;
}

/** Request params by model family, as the repo's other callers send them:
 * luna jobs run with reasoning off; sol jobs run at the model's default
 * reasoning, so the cap leaves room for the reasoning tokens. */
export function themeParams(): Record<string, unknown> {
  return /luna/.test(DOSSIER_THEME_MODEL) ? { max_completion_tokens: 4000, reasoning_effort: "none" } : { max_completion_tokens: 16000 };
}

/** One grouping call, cached per (model, input). Throws when the reply stays
 * unparseable after one steered retry, or the vendor call fails twice. */
export async function themeCall(system: string, user: string, input: unknown, labels: string[], meta: CacheMeta): Promise<ThemeGrouping> {
  const key = `dossier_themes:${THEME_VERSION}:${DOSSIER_THEME_MODEL}:${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16)}`;
  const hit = await store.cacheGet(key, THEME_TTL_MS).catch(() => null);
  if (hit) {
    try {
      const v = validateThemes(JSON.parse(hit), labels);
      if (v) return v;
    } catch {
      /* unreadable entry - recompute */
    }
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
      ...(attempt > 0 && lastErr === "unparseable"
        ? [{ role: "user", content: 'Your previous reply was not a valid JSON object of the form {"themes": [{"name": "...", "members": [indices]}]}. Reply with ONLY that object.' }]
        : []),
    ];
    try {
      const res = await openaiClient().chat.completions.create({
        model: DOSSIER_THEME_MODEL,
        messages,
        ...themeParams(),
        response_format: THEME_SCHEMA,
      } as never);
      const text = (res as { choices: { message?: { content?: string | null } }[] }).choices[0]?.message?.content ?? "";
      const json = firstJsonObject(text);
      const v = json ? validateThemes(JSON.parse(json), labels) : null;
      if (v) {
        await store.cacheSet(key, JSON.stringify({ themes: v }), meta).catch(() => {});
        return v;
      }
      lastErr = "unparseable";
    } catch (e) {
      lastErr = e instanceof SyntaxError ? "unparseable" : e;
    }
  }
  throw new Error(`dossier theme call failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** The two-level theme map over the pooled condition labels. */
export interface ThemeMap {
  /** `${situation}\u0000${label}` -> situation theme index. */
  stOf: Map<string, number>;
  stName: string[];
  /** Situation theme index -> its buying situation. */
  stSit: string[];
  /** Situation theme index -> total theme index. */
  totOf: number[];
  totName: string[];
}

export const slKey = (situation: string, label: string) => `${situation}\u0000${label}`;

/**
 * Themes the run's stated reasons at two levels: each buying situation's
 * labels are grouped by one call (a situation with a single label is its own
 * theme, no call), then one call merges the situation themes that give the
 * same reason across situations. `cells` is label -> situation -> the
 * distinct questions carrying it there; order (and so a theme's fallback
 * name) follows those counts. Null when no OpenAI key or model is configured;
 * throws when any call fails, so the caller never serves a partial mix.
 */
export async function themeReasons(
  cells: Map<string, Map<string, Set<string>>>,
  samples: Map<string, string[]>,
  side: ThemeSide,
  meta: CacheMeta,
  costCtx: { projectId: string; runId: string }
): Promise<ThemeMap | null> {
  if (cells.size === 0 || !DOSSIER_THEME_MODEL.startsWith("gpt-") || !process.env.OPENAI_API_KEY) return null;
  const bySit = new Map<string, { label: string; n: number }[]>();
  for (const [label, per] of cells)
    for (const [sit, set] of per) {
      const list = bySit.get(sit) ?? [];
      list.push({ label, n: set.size });
      bySit.set(sit, list);
    }
  const sits = [...bySit.keys()].sort((a, b) => (a === EVERY_BUYER ? -1 : b === EVERY_BUYER ? 1 : a.localeCompare(b)));
  return withCostContext({ purpose: "views:themes", projectId: costCtx.projectId, runId: costCtx.runId, rnd: false }, async () => {
    const perSit: { sit: string; labels: string[]; groups: ThemeGrouping }[] = new Array(sits.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(THEME_CONCURRENCY, sits.length) }, async () => {
        while (next < sits.length) {
          const i = next++;
          const sit = sits[i];
          const labels = bySit.get(sit)!.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((x) => x.label);
          if (labels.length < 2) {
            perSit[i] = { sit, labels, groups: [{ name: labels[0], members: [0] }] };
            continue;
          }
          const ev = labels.map((l) => samples.get(l) ?? []);
          const user =
            `Buying situation: ${sit}${sit === EVERY_BUYER ? " (questions asked across all buyers)" : ""}\nConditions, most common first:\n` +
            labels.map((l, k) => `${k}. ${l}${ev[k].map((w) => `\n   sample: ${JSON.stringify(w)}`).join("")}`).join("\n");
          perSit[i] = { sit, labels, groups: await themeCall(scenarioThemeSystem(side), user, { level: "situation", side, situation: sit, labels, samples: ev }, labels, meta) };
        }
      })
    );

    const stOf = new Map<string, number>();
    const st: { sit: string; name: string; weight: number; labels: string[] }[] = [];
    for (const { sit, labels, groups } of perSit)
      for (const g of groups) {
        const union = new Set<string>();
        for (const m of g.members) {
          stOf.set(slKey(sit, labels[m]), st.length);
          for (const c of cells.get(labels[m])?.get(sit) ?? []) union.add(c);
        }
        st.push({ sit, name: g.name, weight: union.size, labels: g.members.map((m) => labels[m]) });
      }
    const order = st.map((_, i) => i).sort((a, b) => st[b].weight - st[a].weight || st[a].sit.localeCompare(st[b].sit) || st[a].name.localeCompare(st[b].name));
    let totals: ThemeGrouping;
    if (order.length < 2) totals = order.map((i, k) => ({ name: st[i].name, members: [k] }));
    else {
      const items = order.map((i) => ({ scenario: st[i].sit, name: st[i].name, conditions: st[i].labels }));
      const user = `Themes, most common first:\n${items.map((t, k) => `${k}. [${t.scenario}] ${t.name}\n   conditions: ${t.conditions.map((c) => JSON.stringify(c)).join("; ")}`).join("\n")}`;
      totals = await themeCall(totalThemeSystem(side), user, { level: "total", side, themes: items }, items.map((t) => t.name), meta);
    }
    const totOf = new Array<number>(st.length);
    const totName: string[] = [];
    totals.forEach((t, ti) => {
      totName.push(t.name);
      for (const k of t.members) totOf[order[k]] = ti;
    });
    return { stOf, stName: st.map((x) => x.name), stSit: st.map((x) => x.sit), totOf, totName };
  });
}

/**
 * One side's pool partitioned into the theme tree. Shares are of `base` over
 * union sets at every level: a theme's over all its questions (deduplicated
 * across situations), a bucket's over its questions in that situation, a
 * reason row's over its own questions in that situation.
 */
export function themeTree(
  pool: RuleGroup[],
  base: number,
  tm: ThemeMap | null,
  cellSets: Map<string, string[]>,
  sitOf: Map<string, string>,
  /** Intent ids: when present, each group's questions are intersected with it
   * before counting (the map's per-cell trees). Omitted = the run-wide tree. */
  filter?: Set<string>,
  /** am15 / do7: attach receipts (and, away side, routes) to each theme. */
  evidence?: ThemeEvidence
): DossierTheme[] {
  if (!tm || base <= 0 || pool.length === 0) return [];
  const order = new Map(pool.map((g, i) => [g.id, i]));
  type Bucket = { union: Set<string>; groups: Map<string, { label: string; n: number; o: number }> };
  const tots = new Map<number, { union: Set<string>; buckets: Map<number, Bucket> }>();
  const totGroups = new Map<number, Map<string, number>>();
  for (const g of pool)
    for (const c of cellSets.get(g.id) ?? []) {
      if (filter && !filter.has(c)) continue;
      const s = tm.stOf.get(slKey(sitOf.get(c) ?? EVERY_BUYER, g.label));
      if (s === undefined) continue;
      const t = tm.totOf[s];
      const tot = tots.get(t) ?? { union: new Set<string>(), buckets: new Map<number, Bucket>() };
      tots.set(t, tot);
      tot.union.add(c);
      const b = tot.buckets.get(s) ?? { union: new Set<string>(), groups: new Map() };
      tot.buckets.set(s, b);
      b.union.add(c);
      const row = b.groups.get(g.id) ?? { label: g.label, n: 0, o: order.get(g.id)! };
      row.n++;
      b.groups.set(g.id, row);
      const tg = totGroups.get(t) ?? new Map<string, number>();
      tg.set(g.id, (tg.get(g.id) ?? 0) + 1);
      totGroups.set(t, tg);
    }
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const wallOf = (label: string) => isWallWording([label]);
  return [...tots.entries()]
    .map(([t, tot]) => {
      const buckets = [...tot.buckets.entries()]
        .map(([s, b]) => {
          const rows = [...b.groups.values()].sort((x, y) => y.n - x.n || x.o - y.o);
          const label = tm.stName[s];
          const single = rows.length === 1 && same(rows[0].label, label);
          return {
            n: b.union.size,
            bucket: {
              scenario: tm.stSit[s],
              label,
              share: pctOf(b.union.size / base),
              members: single ? [] : rows.map((r) => ({ label: r.label, share: pctOf(r.n / base), ...(wallOf(r.label) ? { wall: true } : {}) })),
              ...(single && wallOf(label) ? { wall: true } : {}),
            },
          };
        })
        .sort((a, b) => b.n - a.n || a.bucket.label.localeCompare(b.bucket.label))
        .map((x) => x.bucket);
      const label = tm.totName[t];
      const flat = buckets.length === 1 && buckets[0].members.length === 0 && same(buckets[0].label, label);
      const ev = evidence ? themeEvidenceOf(rankedIds(totGroups.get(t), order), evidence, (r) => !filter || filter.has(r.intent)) : {};
      return { n: tot.union.size, theme: { label, share: pctOf(tot.union.size / base), buckets: flat ? [] : buckets, ...(flat && wallOf(label) ? { wall: true } : {}), ...ev } };
    })
    .sort((a, b) => b.n - a.n || a.theme.label.localeCompare(b.theme.label))
    .map((x) => x.theme);
}

/** A theme's member group ids, most-stated first (pool order breaks ties). */
function rankedIds(m: Map<string, number> | undefined, order: Map<string, number>): string[] {
  return [...(m ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)).map(([id]) => id);
}

/**
 * One side's theme-call inputs over its listed groups: label -> situation ->
 * the distinct questions (intent ids) carrying it there, and each label's
 * evidence (the other wordings its groups gathered; the label itself is
 * listed once already). The map and the dossier build their inputs here, from
 * the same computeRules capture, so their theme calls key identically.
 */
export function poolInputs(groups: RuleGroup[], surfaces: Map<string, string[]>, cellSets: Map<string, string[]>, sitOf: Map<string, string>) {
  const labelCells = new Map<string, Map<string, Set<string>>>();
  const labelSamples = new Map<string, string[]>();
  for (const g of groups) {
    const have = labelSamples.get(g.label) ?? [];
    for (const w of (surfaces.get(g.id) ?? []).slice(1)) if (have.length < 2 && !have.some((x) => x.toLowerCase() === w.toLowerCase())) have.push(w);
    labelSamples.set(g.label, have);
    const per = labelCells.get(g.label) ?? new Map<string, Set<string>>();
    labelCells.set(g.label, per);
    for (const c of cellSets.get(g.id) ?? []) {
      const sit = sitOf.get(c) ?? EVERY_BUYER;
      const set = per.get(sit) ?? new Set<string>();
      set.add(c);
      per.set(sit, set);
    }
  }
  return { labelCells, labelSamples };
}

/** Intent id -> buying situation (EVERY_BUYER for cells asked of no particular buyer). */
export const situationsOf = (intents: Intent[]) => new Map(intents.map((it) => [it.id, it.situation || EVERY_BUYER]));

/** The condition card's rank (by answers stating it, then rules, then label) -
 * the order the theme pools are built in, on both surfaces. */
export const rankGroups = <T extends { answers: number; rules: number; label: string }>(xs: T[]) =>
  [...xs].sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label));

/**
 * The analysis map's per-cell tree (am13): the same two-level partition and
 * wall flags as themeTree, but every count is DISTINCT ANSWERS (response ids)
 * inside the cell's questions - question grain saturates inside a cell, since
 * with every engine answering each question nearly every common reason
 * touches every question. Situation attribution stays by the intent's
 * situation. Base = the distinct answers stating any of the side's pooled
 * reasons in the cell; a theme's share = its distinct answers / base, a
 * bucket's = its answers in that situation / base, a reason row's = that
 * group's answers in that situation / base. [] on base 0 or no theme map.
 */
export function themeTreeAnswers(
  pool: RuleGroup[],
  tm: ThemeMap | null,
  cellAnswers: Map<string, Map<string, Set<string>>>,
  sitOf: Map<string, string>,
  cellIntents: Set<string>,
  /** am15: attach receipts (and, away side, routes) to each theme. */
  evidence?: ThemeEvidence
): DossierTheme[] {
  if (!tm || pool.length === 0) return [];
  const order = new Map(pool.map((g, i) => [g.id, i]));
  const all = new Set<string>();
  const totGroups = new Map<number, Map<string, number>>();
  type Bucket = { union: Set<string>; groups: Map<string, { label: string; ids: Set<string>; o: number }> };
  const tots = new Map<number, { union: Set<string>; buckets: Map<number, Bucket> }>();
  for (const g of pool) {
    const per = cellAnswers.get(g.id);
    if (!per) continue;
    for (const [c, ids] of per) {
      if (!cellIntents.has(c) || ids.size === 0) continue;
      for (const id of ids) all.add(id);
      const s = tm.stOf.get(slKey(sitOf.get(c) ?? EVERY_BUYER, g.label));
      if (s === undefined) continue;
      const t = tm.totOf[s];
      const tot = tots.get(t) ?? { union: new Set<string>(), buckets: new Map<number, Bucket>() };
      tots.set(t, tot);
      const b = tot.buckets.get(s) ?? { union: new Set<string>(), groups: new Map() };
      tot.buckets.set(s, b);
      const row = b.groups.get(g.id) ?? { label: g.label, ids: new Set<string>(), o: order.get(g.id)! };
      b.groups.set(g.id, row);
      for (const id of ids) {
        tot.union.add(id);
        b.union.add(id);
        row.ids.add(id);
      }
      const tg = totGroups.get(t) ?? new Map<string, number>();
      tg.set(g.id, (tg.get(g.id) ?? 0) + ids.size);
      totGroups.set(t, tg);
    }
  }
  const base = all.size;
  if (base === 0) return [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const wallOf = (label: string) => isWallWording([label]);
  return [...tots.entries()]
    .map(([t, tot]) => {
      const buckets = [...tot.buckets.entries()]
        .map(([s, b]) => {
          const rows = [...b.groups.values()].sort((x, y) => y.ids.size - x.ids.size || x.o - y.o);
          const label = tm.stName[s];
          const single = rows.length === 1 && same(rows[0].label, label);
          return {
            n: b.union.size,
            bucket: {
              scenario: tm.stSit[s],
              label,
              share: pctOf(b.union.size / base),
              members: single ? [] : rows.map((r) => ({ label: r.label, share: pctOf(r.ids.size / base), ...(wallOf(r.label) ? { wall: true } : {}) })),
              ...(single && wallOf(label) ? { wall: true } : {}),
            },
          };
        })
        .sort((a, b) => b.n - a.n || a.bucket.label.localeCompare(b.bucket.label))
        .map((x) => x.bucket);
      const label = tm.totName[t];
      const flat = buckets.length === 1 && buckets[0].members.length === 0 && same(buckets[0].label, label);
      const ev = evidence ? themeEvidenceOf(rankedIds(totGroups.get(t), order), evidence, (r) => cellIntents.has(r.intent)) : {};
      return { n: tot.union.size, theme: { label, share: pctOf(tot.union.size / base), buckets: flat ? [] : buckets, ...(flat && wallOf(label) ? { wall: true } : {}), ...ev } };
    })
    .sort((a, b) => b.n - a.n || a.theme.label.localeCompare(b.theme.label))
    .map((x) => x.theme);
}
