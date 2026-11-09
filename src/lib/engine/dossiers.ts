import { buildResolver } from "./brand_resolve";
import { computeBrandSummary, type SummaryBrand } from "./brand_summary";
import { computeAnalysisMap, type AnalysisMapDebug, type MapCellStat } from "./analysis_map";
import { brandHeadline, cardSourcesOf, type Lift, conversionOf, funnelRows, liftEnds, pctOf, picksFromRow, supplyLine, topQuestionRow } from "./answer_cards";
import { createHash } from "node:crypto";
import { computeRules, type RuleGroup } from "./rules_explorer";
import { isDefaultCondition } from "./condition_groups";
import type { InsightInputs } from "./summary_insights";
import { cachedView, requestOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { firstJsonObject } from "./brief_writer";
import { DOSSIER_THEME_MODEL } from "./models";
import { openaiClient } from "./providers";
import { withCostContext } from "../cost_log";
import { store } from "../store";
import type { CacheMeta, Project, Run } from "../types";

/**
 * Brand dossiers (2026-11-08, the owner's ratified shape -
 * public/_position_panel_options.html tab 6): the Rivals pill becomes one
 * standing page per rival brand - the brief's brand card promoted to a page,
 * with the brand's own map cells folded in.
 *
 * Every number restates an object the brief already reads, through the SAME
 * helpers the brand card uses (answer_cards.ts funnelRows / picksFromRow /
 * topQuestionRow / liftEnds / supplyLine over cardSourcesOf), so a dossier and
 * the brief's brand card can never disagree. The head-to-head record is the
 * summary's (entity matchups) or, for a class matchup, the map cell's sides;
 * switching reads the leaver cell's own pool (computeAlternatives' capture
 * row, the map's leaver figures); routing reads the run's condition groups
 * (the condition card's away branches). No model call beyond the context
 * judge the summary already pays.
 *
 * No counts: values are percentages and template sentences only.
 */

export interface DossierArg {
  label: string;
  /** Signed points (wins share minus others share), for the bar. */
  value: number;
  wins: string;
  others: string;
}

export interface Dossier {
  key: string;
  name: string;
  /** Leads the chip row: takes >= 2% of the picks, or has a matchup or leaver cell (the rest fold under "More brands"). */
  prominent: boolean;
  headline: string;
  /** Named / Share of picks / Picked, of all answers / Recommendations that end as the pick. */
  tiles: { value: string; label: string }[];
  /** Where its picks come from: by question type and its top question's share (each null under the floor). */
  picksFrom: { byType: string | null; topQuestion: string | null };
  /** Against the tracker's brand: the two-way record, or an absent-matchup note. */
  h2h:
    | { kind: "record"; you: string; them: string; youLabel: string; themLabel: string; /** Asked against the brand's whole class of product, not the brand. */ asClass?: boolean }
    | { kind: "missing"; note: string; alert: boolean };
  /** Its leaver cell's read, or the pooled leavers' line; null when neither applies. */
  switching: string | null;
  /** The no-pick share of those leaver answers (its own cell's, or the pooled leavers' with the pooled line). */
  switchingNoPick: string | null;
  /** The argument it wins on and the one it loses on (empty under the floor). */
  args: DossierArg[];
  /** "See more": its full lift list (every code clearing liftForBrand's floors), best first. */
  argsAll: DossierArg[];
  argSides: [string, string];
  /** The largest stated reason to leave you that points buyers to it, when one exists. */
  routes: string | null;
  /** "See more": every stated reason to leave you whose top route is this brand, with its share of the questions where the AI gives any reason to leave you. */
  routesAll: { label: string; share: string }[];
  /** do2: the default ("otherwise") branch away from you, when its top route is this brand. */
  routesDefault: string | null;
  /** do2, the other side of the contest: the stated reasons that point buyers back to
   * you (the run's toward-you groups, top 6), each with its share of the questions
   * where the AI gives any reason to pick you - a DIFFERENT base from routesAll's. */
  routesBack: { label: string; share: string }[];
  /** do2: the default branch toward you, when one exists. */
  routesBackDefault: string | null;
  /** The slide-over only: routesAll gathered into themes - per buying
   * situation, then merged across situations (themeReasons). Every share is
   * of routesAll's base, over the UNION of the questions beneath - never a
   * sum. Empty when the theme pass did not run or failed (flat list instead). */
  routesThemes: DossierTheme[];
  /** Every toward-you group (not just the top 6), themed the same way, on routesBack's base. */
  routesBackThemes: DossierTheme[];
  /** The vendor-supply line, when the detector's threshold clears. */
  supply: string | null;
  /** "See more": its picks split per company and per assistant, each with its share of the questions answered. */
  supplyAll: { vendors: SupplyRow[]; assistants: SupplyRow[] };
  /** Map cell ids for the links (null when the map has no such cell). */
  cells: { h2h: string | null; leaver: string | null };
}

/** One stated reason inside a situation's theme: its share of the side's
 * base over its questions in that situation. */
export interface DossierThemeGroup {
  label: string;
  share: string;
}

/** One buying situation's theme inside a total theme. members is empty when
 * the bucket is a single reason worded as the bucket. */
export interface DossierThemeBucket {
  scenario: string;
  label: string;
  share: string;
  members: DossierThemeGroup[];
}

/** A theme of stated reasons across buying situations. buckets is empty when
 * the theme is a single reason in a single situation (reads as a flat row). */
export interface DossierTheme {
  label: string;
  share: string;
  buckets: DossierThemeBucket[];
}

export interface SupplyRow {
  label: string;
  /** Share of its picks. */
  picks: string;
  /** Share of the questions this unit answers. */
  answers: string;
}

export interface DossiersView {
  runId: string;
  brand: string;
  dossiers: Dossier[];
}

/** A brand taking at least this share of the picks with no matchup asked gets the amber callout. */
const NO_H2H_ALERT = 0.1;
/** The pooled leavers' line needs this share of the leavers' picks, over this many picks. */
const CAPTURE_NOTE = 0.1;
const MIN_SIDE = 20;

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pct = (c: RateCell) => pctOf(rate(c));
const poss = (name: string) => `${name}'s`;

function headlineOf(b: SummaryBrand, all: SummaryBrand[], f: ReturnType<typeof funnelRows>): string {
  const top = [...all].sort((x, y) => y.chosen.k - x.chosen.k)[0];
  const mostPicked = top && top.key === b.key && b.chosen.k > 0 && !all.some((x) => x.key !== b.key && x.chosen.k === b.chosen.k);
  const convertible = all.filter((x) => x.recommended.k >= MIN_SIDE);
  const bestConv =
    b.recommended.k >= MIN_SIDE &&
    b.chosen.k > 0 &&
    convertible.length >= 2 &&
    convertible.every((x) => x.key === b.key || conversionOf(x) < conversionOf(b));
  if (mostPicked) return `${b.name} is named in ${f.named.value} of answers and takes ${f.share.value} of the picks - the most of any brand - turning ${f.converts.value} of its recommendations into picks.`;
  if (bestConv && rate(b.mentioned) < 0.5)
    return `${b.name} is named in just ${f.named.value} of answers yet takes ${f.share.value} of the picks - it turns ${f.converts.value} of its recommendations into picks, the best conversion on the board.`;
  if (bestConv) return `${b.name} is named in ${f.named.value} of answers and takes ${f.share.value} of the picks - it turns ${f.converts.value} of its recommendations into picks, the best conversion on the board.`;
  return brandHeadline(b.name, b);
}

/** The pseudo-situation for cells asked across all buyers (no room). */
const EVERY_BUYER = "Every buyer";
const THEME_VERSION = "dt3";
const THEME_TTL_MS = 183 * 24 * 3600 * 1000;
const THEME_CONCURRENCY = 6;

const THEME_REPLY =
  'Reply with ONLY a JSON object {"themes": [{"name": "...", "members": [indices]}]}. ' +
  "Name each theme in short plain buyer language, two to five words, with no digits and no counts. " +
  "Every index must appear in exactly one theme.";

export const SCENARIO_THEME_SYSTEM =
  "You group short conditions into themes. Each condition is a reason a buyer states, or a circumstance " +
  "a buyer describes, when an AI assistant points the buyer toward or away from a product. All the " +
  "conditions you are given come from one buying situation, listed most common first. Beneath a condition, " +
  "sample lines show what buyers actually said under it; judge the condition's meaning from them. Group conditions " +
  "that express the same underlying reason, even when they are worded differently. Conditions that state " +
  "the same decision or stance in different words belong together; group by the buyer's underlying reason, " +
  "never by the product area the words mention. A condition that shares no reason with any other stays in " +
  "a theme of its own. Typical output is three to ten themes. " +
  THEME_REPLY;

export const TOTAL_THEME_SYSTEM =
  "You merge themes across buying situations. Each theme gathers reasons buyers state when an AI assistant " +
  "points them toward or away from a product, and each belongs to one buying situation; they are listed " +
  "most common first, each with the conditions it holds. Merge themes that express the same underlying " +
  "reason across situations into one theme. Judge each merge by what the member conditions say, not by " +
  "the theme's name. A theme whose reason is specific to its own situation, or that cannot merge anywhere, " +
  "stays a theme of its own. When the list is large, typical output is six to twelve themes. " +
  THEME_REPLY;

const THEME_SCHEMA = {
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
function themeParams(): Record<string, unknown> {
  return /luna/.test(DOSSIER_THEME_MODEL) ? { max_completion_tokens: 4000, reasoning_effort: "none" } : { max_completion_tokens: 16000 };
}

/** One grouping call, cached per (model, input). Throws when the reply stays
 * unparseable after one steered retry, or the vendor call fails twice. */
async function themeCall(system: string, user: string, input: unknown, labels: string[], meta: CacheMeta): Promise<ThemeGrouping> {
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
interface ThemeMap {
  /** `${situation}\u0000${label}` -> situation theme index. */
  stOf: Map<string, number>;
  stName: string[];
  /** Situation theme index -> its buying situation. */
  stSit: string[];
  /** Situation theme index -> total theme index. */
  totOf: number[];
  totName: string[];
}

const slKey = (situation: string, label: string) => `${situation}\u0000${label}`;

/**
 * Themes the run's stated reasons at two levels: each buying situation's
 * labels are grouped by one call (a situation with a single label is its own
 * theme, no call), then one call merges the situation themes that give the
 * same reason across situations. `cells` is label -> situation -> the
 * distinct questions carrying it there; order (and so a theme's fallback
 * name) follows those counts. Null when no OpenAI key or model is configured;
 * throws when any call fails, so the caller never serves a partial mix.
 */
async function themeReasons(
  cells: Map<string, Map<string, Set<string>>>,
  samples: Map<string, string[]>,
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
          perSit[i] = { sit, labels, groups: await themeCall(SCENARIO_THEME_SYSTEM, user, { level: "situation", situation: sit, labels, samples: ev }, labels, meta) };
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
      totals = await themeCall(TOTAL_THEME_SYSTEM, user, { level: "total", themes: items }, items.map((t) => t.name), meta);
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
function themeTree(pool: RuleGroup[], base: number, tm: ThemeMap | null, cellSets: Map<string, string[]>, sitOf: Map<string, string>): DossierTheme[] {
  if (!tm || base <= 0 || pool.length === 0) return [];
  const order = new Map(pool.map((g, i) => [g.id, i]));
  type Bucket = { union: Set<string>; groups: Map<string, { label: string; n: number; o: number }> };
  const tots = new Map<number, { union: Set<string>; buckets: Map<number, Bucket> }>();
  for (const g of pool)
    for (const c of cellSets.get(g.id) ?? []) {
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
    }
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return [...tots.entries()]
    .map(([t, tot]) => {
      const buckets = [...tot.buckets.entries()]
        .map(([s, b]) => {
          const rows = [...b.groups.values()].sort((x, y) => y.n - x.n || x.o - y.o);
          const label = tm.stName[s];
          return {
            n: b.union.size,
            bucket: {
              scenario: tm.stSit[s],
              label,
              share: pctOf(b.union.size / base),
              members: rows.length === 1 && same(rows[0].label, label) ? [] : rows.map((r) => ({ label: r.label, share: pctOf(r.n / base) })),
            },
          };
        })
        .sort((a, b) => b.n - a.n || a.bucket.label.localeCompare(b.bucket.label))
        .map((x) => x.bucket);
      const label = tm.totName[t];
      const flat = buckets.length === 1 && buckets[0].members.length === 0 && same(buckets[0].label, label);
      return { n: tot.union.size, theme: { label, share: pctOf(tot.union.size / base), buckets: flat ? [] : buckets } };
    })
    .sort((a, b) => b.n - a.n || a.theme.label.localeCompare(b.theme.label))
    .map((x) => x.theme);
}

export async function computeDossiers(data: ViewData, request: ViewRequest = {}): Promise<DossiersView> {
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  const capture: { inputs?: InsightInputs } = {};
  const summary = await computeBrandSummary(data, eng, capture);
  const inputs = capture.inputs!;
  const debug = { walls: [], casting: {}, cells: {} } as unknown as AnalysisMapDebug & { cells: Record<string, MapCellStat> };
  const map = await computeAnalysisMap(data, eng, debug, { summary, inputs });
  const { src } = cardSourcesOf(data, eng, summary, inputs);
  const resolve = buildResolver(data.dictionary, data.judged);
  const brand = data.project.brand;
  const target = summary.target;
  const targetName = resolve(brand).name;
  const all = [target, ...summary.brands.filter((b) => b.key !== target.key)];

  const cellOf = (row: string, key: string): string | null => {
    for (const [id, st] of Object.entries(debug.cells)) if (st.row === row && !st.pooled && st.rivalKey === key && map.positions[id]) return id;
    return null;
  };
  const offensive = inputs.alternatives.offensive;
  // Every away branch the run's rules explorer groups (its own one-per-run
  // grouping), ranked as the condition card ranks them (by answers stating
  // it), so "the largest single reason" means what the brief means by it.
  // do2: a default-shaped branch ("otherwise") is not a reason - it leaves
  // the lists and renders as one default line per side.
  const cellSets = new Map<string, string[]>();
  const surfaces = new Map<string, string[]>();
  const rules = await computeRules(data, eng, { cellSets, surfaces });
  const rank = <T extends { answers: number; rules: number; label: string }>(xs: T[]) => [...xs].sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label));
  const awayAll = rank(rules.groups.filter((g) => g.side === "away"));
  const awayGroups = awayAll.filter((g) => !isDefaultCondition(g.label));
  const awayDefaults = awayAll.filter((g) => isDefaultCondition(g.label));
  const awayCells = rules.cellsBySide.away;
  const towardAll = rank(rules.groups.filter((g) => g.side === "you"));
  const towardCells = rules.cellsBySide.you;
  const routesBack = towardCells > 0 ? towardAll.filter((g) => !isDefaultCondition(g.label)).slice(0, 6).map((g) => ({ label: g.label, share: pctOf(g.cells / towardCells) })) : [];
  const backDefault = towardAll.find((g) => isDefaultCondition(g.label));
  const routesBackDefault =
    backDefault && towardCells > 0
      ? `The default: when no stated reason applies, the AI points buyers back to you (in ${pctOf(backDefault.cells / towardCells)} of those questions).`
      : null;
  // The slide-over's theme tree: ONE two-level theming over every listed
  // (non-default) group label on both sides, so a wording themes identically
  // wherever it appears; each label is attributed to the buying situations of
  // the questions carrying it. Keyless, or when any call fails, every side
  // gets no themes and the slide-over reads the flat lists.
  const towardListed = towardAll.filter((g) => !isDefaultCondition(g.label));
  const sitOf = new Map(data.intents.map((it) => [it.id, it.situation || EVERY_BUYER]));
  const labelCells = new Map<string, Map<string, Set<string>>>();
  // A label's evidence: the other wordings its groups gathered (the label itself is listed once already).
  const labelSamples = new Map<string, string[]>();
  for (const g of [...awayGroups, ...towardListed]) {
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
  let themeMap: ThemeMap | null = null;
  try {
    themeMap = await themeReasons(labelCells, labelSamples, { brand: data.project.brand, category: data.project.category, projectId: data.project.id }, { projectId: data.project.id, runId: data.run.id });
  } catch (e) {
    console.warn(`dossier themes failed, flat lists served: ${e instanceof Error ? e.message : e}`);
    // A failed pass is served flat but the view is not cached, so the next open retries.
    data.judgeIncomplete = true;
  }
  const themesOf = (pool: RuleGroup[], base: number) => themeTree(pool, base, themeMap, cellSets, sitOf);
  const routesBackThemes = themesOf(towardListed, towardCells);
  const captors = offensive ? [...offensive.captors].sort((a, b) => b.chosen.k - a.chosen.k || b.named.k - a.named.k || a.name.localeCompare(b.name)) : [];

  const dossiers: Dossier[] = summary.brands
    .filter((b) => b.key !== target.key && b.mentioned.k > 0)
    .sort((a, b) => b.chosen.k - a.chosen.k || b.mentioned.k - a.mentioned.k || a.name.localeCompare(b.name))
    .map((b): Dossier => {
      const f = funnelRows(b);
      const h2hCell = cellOf("h2h", b.key);
      const leaverCell = cellOf("leavers", b.key);

      // Against you, head to head: the summary's entity record, else a class cell's sides.
      let h2h: Dossier["h2h"];
      const rec = summary.headToHead.find((r) => r.key === b.key);
      const st = h2hCell ? debug.cells[h2hCell] : null;
      const youLabel = `${brand} picked, of the answers that pick one of the two`;
      if (rec && rec.winOfDecided.n > 0) {
        h2h = { kind: "record", you: pct(rec.winOfDecided), them: pctOf(rec.lost.k / rec.winOfDecided.n), youLabel, themLabel: `${b.name} picked` };
      } else if (st && st.you + st.them > 0) {
        h2h = { kind: "record", you: pctOf(st.you / (st.you + st.them)), them: pctOf(st.them / (st.you + st.them)), youLabel, themLabel: `${b.name} picked`, ...(h2hCell!.includes(":class-") ? { asClass: true } : {}) };
      } else if (h2hCell) {
        h2h = { kind: "missing", note: `Asked beside ${brand} directly, the AI picks neither of the two.`, alert: false };
      } else if (rate(b.shareOfDecided) >= NO_H2H_ALERT) {
        h2h = {
          kind: "missing",
          note: `No head-to-head was asked against ${b.name} this wave - it takes ${f.share.value} of the picks without ever being put beside you directly. A matchup cell is a setup decision away.`,
          alert: true,
        };
      } else h2h = { kind: "missing", note: `No head-to-head was asked against ${b.name} this wave.`, alert: false };

      // Switching: its own leavers, else where rival leavers end up.
      let switching: string | null = null;
      let switchingNoPick: string | null = null;
      const noPickLine = (c: RateCell, whose: string) => `The AI commits to no single pick in ${pct(c)} of ${whose} answers.`;
      const row = offensive?.rows.find((r) => r.key === b.key && r.answers > 0);
      if (row) {
        const inCat = row.captured.k + row.anotherBrand.k + row.sameBrand.k;
        const top = row.captors.find((c) => c.name !== targetName);
        let tail = "";
        if (top && inCat > 0) {
          const share = pctOf(top.n / inCat);
          tail = top.name === b.name ? ` - ${share} of those picks stay with ${b.name}` : ` - ${top.name} takes ${share} of those picks`;
        }
        switching = `When ${poss(b.name)} customers ask what to switch to, ${brand} is named in ${pct(row.named)} of answers and picked in ${pct(row.captured)}${tail}.`;
        switchingNoPick = noPickLine(row.undecided, "those");
      } else if (offensive) {
        const c = offensive.captors.find((x) => x.key === b.key);
        if (c && c.shareOfDecided.n >= MIN_SIDE && rate(c.shareOfDecided) >= CAPTURE_NOTE) {
          const rank = captors.findIndex((x) => x.key === b.key);
          const lead = captors[0];
          const tail = rank === 0 ? " - more than any other brand" : rank === 1 && lead ? ` - second only to ${lead.key === target.key ? brand : lead.name}` : "";
          switching = `When a rival's customers ask what to switch to, ${b.name} takes ${pct(c.shareOfDecided)} of the picks${tail}.`;
          switchingNoPick = noPickLine(offensive.overall.undecided, "rival leavers'");
        }
      }

      // The arguments: the lift list's two ends, drawn as bars with their shares.
      const ends = liftEnds(src, b.key);
      const toArg = (l: Lift): DossierArg => ({ label: l.code, value: Math.round(l.lift * 100), wins: pct(l.wins), others: pct(l.others) });
      const args: DossierArg[] = ends ? [ends.win, ...(ends.lose ? [ends.lose] : [])].map(toArg) : [];
      const argsAll: DossierArg[] = src.liftOf(b.key).map(toArg);

      // The reasons pointing to it: every stated reason to leave you whose
      // top route is this brand, in the card's rank, each with its share of
      // the questions where the AI gives any reason to leave you; the
      // section's line states the first (the condition card's "The biggest
      // reason pointing to <brand>").
      const mine = awayGroups.filter((g) => g.routes[0] && resolve(g.routes[0].name).key === b.key);
      const routesAll = awayCells > 0 ? mine.map((g) => ({ label: g.label, share: pctOf(g.cells / awayCells) })) : [];
      const routes = routesAll.length
        ? `When the AI gives buyers a reason to leave you, "${routesAll[0].label}" → ${b.name} is one of them in ${routesAll[0].share} of those questions${mine[0] === awayGroups[0] ? " - the largest single reason" : ""}.`
        : null;
      // The default away branch belongs on the dossier of the brand it points to.
      const dflt = awayCells > 0 ? awayDefaults.find((g) => g.routes[0] && resolve(g.routes[0].name).key === b.key) : undefined;
      const routesThemes = themesOf(mine, awayCells);
      const routesDefault = dflt ? `The default: when no stated reason applies, the AI points buyers to ${b.name} (in ${pctOf(dflt.cells / awayCells)} of those questions).` : null;

      // Who supplies its picks, in full: per company and per assistant.
      const ep = inputs.enginePicks.find((x) => x.key === b.key);
      const supplyAll: Dossier["supplyAll"] = { vendors: [], assistants: [] };
      if (ep && ep.total > 0 && summary.answers > 0) {
        type U = { label: string; p: number; a: number };
        const asst: U[] = summary.byEngine.map((e) => ({ label: e.label, p: ep.byModel[e.key] ?? 0, a: e.answers }));
        const vend = new Map<string, U>();
        for (const e of summary.byEngine) {
          const v = vend.get(e.vendor) ?? { label: e.vendor, p: 0, a: 0 };
          v.p += ep.byModel[e.key] ?? 0;
          v.a += e.answers;
          vend.set(e.vendor, v);
        }
        const out = (us: U[]): SupplyRow[] =>
          [...us]
            .sort((x, y) => y.p - x.p || x.label.localeCompare(y.label))
            .map((u) => ({ label: u.label, picks: pctOf(u.p / ep.total), answers: pctOf(u.a / summary.answers) }));
        supplyAll.assistants = out(asst);
        supplyAll.vendors = vend.size >= 2 ? out([...vend.values()]) : [];
      }

      const sup = supplyLine(summary, inputs, b.key);
      return {
        key: b.key,
        name: b.name,
        prominent: rate(b.shareOfDecided) >= 0.02 || !!h2hCell || !!leaverCell,
        headline: headlineOf(b, all, f),
        tiles: [
          { value: f.named.value, label: "Named when buyers ask what to buy" },
          { value: f.share.value, label: "Share of picks" },
          { value: f.picked.value, label: "Picked, of all answers" },
          { value: f.converts.value, label: "Recommendations that end as the pick" },
        ],
        picksFrom: { byType: picksFromRow(src, b.key)?.value ?? null, topQuestion: topQuestionRow(src, b.key)?.value ?? null },
        h2h,
        switching,
        switchingNoPick,
        args,
        argsAll,
        argSides: ["its picks", "rivals' picks"],
        routes,
        routesAll,
        routesDefault,
        routesBack,
        routesBackDefault,
        routesThemes,
        routesBackThemes,
        supply: sup ? `${sup.label} ${sup.value}.` : null,
        supplyAll,
        cells: { h2h: h2hCell, leaver: leaverCell },
      };
    });
  return { runId: data.run.id, brand, dossiers };
}

// do1 (2026-11-08): first version - the Rivals pill as brand dossiers.
// do2 (2026-11-08): the owner's three rulings - the routes line reworded as a
// reason to leave you; the section two-sided (reasons pointing to it AND back
// to you, each on its own base); default-shaped branches ("otherwise") leave
// the lists for one default line per side.
// do3 (2026-11-08): the slide-over's theme rollup - routesThemes /
// routesBackThemes (additive; the flat lists stay for stale clients).
// do4 (2026-11-09): themes by two LLM grouping calls (per buying situation,
// then across situations) replace the embedding rollup; themes nest buckets.
const DOSSIERS_VERSION = "do4";
export function computeDossiersCached(run: Run, project: Project, request: ViewRequest = {}): Promise<DossiersView | null> {
  const r = requestOf(request);
  return cachedView("dossiers", DOSSIERS_VERSION, run, project, (d) => computeDossiers(d, r), { judge: true, setupDecision: true }, r);
}
