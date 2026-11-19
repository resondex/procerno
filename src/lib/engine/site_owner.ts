import { createHash } from "node:crypto";
import { matchKey } from "../brand_key";
import { withCostContext } from "../cost_log";
import { store } from "../store";
import { parseSiteOwners, enteredOwners } from "../site_owners";
import { buildResolver } from "./brand_resolve";
import { siteBoard, siteOf, type BoardBrand } from "./facts/sources";
import { SITE_OWNER_MODEL } from "./models";
import { apiKeyConfigured, openaiClient } from "./providers";
import type { DictionaryEntry, Project, Run } from "../types";
import type { ViewData } from "./view_data";

/**
 * Whose own site a cited site is - the model check (2026-11-19, Tyler: "a small model check per site for the client
 * and competitors, and clients can edit it"). The second of the three owner rules (facts/sources.ts): what a person
 * entered wins, then this check, then the name match. The name match alone misses a maker's or parent company's site
 * (the brand's name is not the site's name) and every name under four characters.
 *
 * One verdict per (tracker, site), judged once and kept forever (the saved-tracker rule) under
 *   site_owner:<SITE_RULES_VERSION>:<model>:<project id>:<sha256 of the site>  ->  {"owners": [board names]}
 * The verdict stores brand NAMES as shown to the model, never entry ids; they resolve through the CURRENT dictionary
 * at read time (resolveVerdictNames), so a dictionary edit re-resolves every verdict and nothing is re-judged.
 *
 * Which sites are checked: every site cited by at least MIN_ANSWERS answers of the run the dashboard shows (every
 * question type, the core panel), most cited first, CHUNK sites per call, each with up to two of its cited URLs as
 * written. The model sees the category and the board (every brand in analysis, the tracker marked as the client,
 * each with its parent company when one is set).
 *
 * The views never call the model. After a prewarm, the run's verdicts are also written as ONE snapshot row
 *   site_owner_run:<SITE_RULES_VERSION>:<model>:<project id>:<run id>  ->  {"verdicts": {[site]: [board names]}}
 * which is what a view reads (readSiteSnapshot): one cache read, and its hash rides the view's cache key - a view's
 * cache hit cannot see which sites the run cites without reading the run, so the key cannot be stamped from the
 * per-site rows directly. readSiteVerdicts reads the per-site rows (the prewarm itself, tests).
 *
 * Keyless environments judge nothing and write nothing. Ledger purpose views:site_owner.
 */

// so1 (2026-11-19): first rules. Bump when the prompt changes meaning; verdicts then re-judge on the next prewarm.
export const SITE_RULES_VERSION = "so1";
/** The saved-tracker rule: a self-versioned verdict reads forever. */
const CACHE_TTL_MS = 100 * 365 * 24 * 3600 * 1000;
/** Sites per model call. */
export const SITE_CHUNK = 40;
/** A site is checked when at least this many answers of the shown run cite it. */
export const SITE_MIN_ANSWERS = 3;
/** Calls in flight at once. */
const CONCURRENCY = 4;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const siteOwnerKey = (projectId: string, site: string, model = SITE_OWNER_MODEL) =>
  `site_owner:${SITE_RULES_VERSION}:${model}:${projectId}:${sha(site)}`;
export const siteSnapshotKey = (projectId: string, runId: string, model = SITE_OWNER_MODEL) =>
  `site_owner_run:${SITE_RULES_VERSION}:${model}:${projectId}:${runId}`;

/* ------------------------------- the board ------------------------------- */

/** The brands the check may name: the brands in analysis (facts/sources.ts siteBoard), the Other bucket left out. */
export function checkBoard(project: Pick<Project, "brand">, dictionary: DictionaryEntry[]): BoardBrand[] {
  const targetKey = buildResolver(dictionary)(project.brand).key;
  return siteBoard(project.brand, dictionary, targetKey).filter((b) => b.client || b.name !== "Other");
}

/** A verdict's brand names -> entry ids, through the current board: exact match key on any of a brand's names
 * (canonical, display name, aliases; the tracker's configured name). Names that no longer resolve are dropped. */
export function resolveVerdictNames(names: readonly string[], board: readonly BoardBrand[]): string[] {
  const byKey = new Map<string, string>();
  for (const b of board) for (const n of [b.name, ...b.names]) if (!byKey.has(matchKey(n))) byKey.set(matchKey(n), b.key);
  const out: string[] = [];
  for (const n of names) {
    const id = byKey.get(matchKey(n));
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/* ------------------------------- the prompt ------------------------------- */

/** No category- or brand-specific examples (operating rule, 2026-10-03). */
export function siteOwnerSystemPrompt(category: string): string {
  return (
    `You decide whose own website a site is, for a market study of ${category}. ` +
    "You are given the brands the study tracks (the board), each with its parent company when one is known, and websites that AI assistants cited, each with up to two of the addresses cited on it.\n" +
    "For each site, list the brands on the board whose own site it is, written exactly as they appear on the board. The list may be empty.\n" +
    "Rules:\n" +
    "- A site belongs to a brand when the brand itself, its maker or its parent company runs it as its own site. That includes the company's online store, support, help, blog, community, developer and investor sites.\n" +
    "- A company site of a maker or parent company that sells several brands on the board belongs to each of those brands.\n" +
    "- A site run by anyone else belongs to nobody: a publisher, a review or comparison site, a forum, a marketplace, a retailer or reseller that merely carries the brand, a partner or an affiliate. The one exception is a company that is itself a brand on the board: its own site belongs to that brand.\n" +
    "- When you are not sure who runs a site, it belongs to nobody.\n" +
    "- Return every site exactly once, written exactly as given."
  );
}

export interface SiteToCheck {
  site: string;
  /** Up to two URLs cited on the site, as written. */
  urls: string[];
}

export function siteOwnerUserMessage(board: readonly BoardBrand[], sites: readonly SiteToCheck[]): string {
  // The client is named on its own line, never as a suffix on its board name: a reply copying "<name> (the client)"
  // would not be a name on the board and would be dropped.
  const client = board.find((b) => b.client);
  const brands = board.map((b) => `- ${b.name}${b.parent ? ` - parent company: ${b.parent}` : ""}`).join("\n");
  const list = sites.map((s, i) => `${i + 1}. ${s.site}${s.urls.map((u) => `\n   ${u}`).join("")}`).join("\n");
  return `Brands on the board:\n${brands}\n${client ? `\nThe client is ${client.name}.\n` : ""}\nSites:\n${list}`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sites: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { site: { type: "string" }, owners: { type: "array", items: { type: "string" } } },
        required: ["site", "owners"],
      },
    },
  },
  required: ["sites"],
} as const;

/** The model call, injectable for tests: sites in -> board names per site, by the site as the reply wrote it
 * (lower-cased, trimmed). A site the reply leaves out is absent. Throws on a failed or cut-off call. */
export type SiteJudge = (input: { category: string; board: readonly BoardBrand[]; sites: readonly SiteToCheck[] }) => Promise<Map<string, string[]>>;

const openaiSiteJudge: SiteJudge = async ({ category, board, sites }) => {
  const cap = Math.max(2000, sites.length * 60);
  const res = await openaiClient().chat.completions.create({
    model: SITE_OWNER_MODEL,
    // gpt-6 / gpt-5 family: no temperature, reasoning off, completion cap (the parent_suggest pattern).
    ...(/^gpt-[5-9]/.test(SITE_OWNER_MODEL)
      ? { max_completion_tokens: cap, reasoning_effort: "none" as const }
      : { temperature: 0, max_tokens: cap }),
    messages: [
      { role: "system", content: siteOwnerSystemPrompt(category) },
      { role: "user", content: siteOwnerUserMessage(board, sites) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "site_owners", strict: true, schema: SCHEMA } },
  });
  if (res.choices[0]?.finish_reason === "length") throw new Error(`site owner batch cut off (${sites.length} sites)`);
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{"sites":[]}') as { sites?: { site?: unknown; owners?: unknown }[] };
  const out = new Map<string, string[]>();
  for (const r of parsed.sites ?? []) {
    if (typeof r.site !== "string" || !Array.isArray(r.owners)) continue;
    out.set(r.site.trim().toLowerCase(), r.owners.filter((x): x is string => typeof x === "string"));
  }
  return out;
};

/** Only names exactly on the board list are kept (trimmed, each once). */
export function keepBoardNames(names: readonly string[], board: readonly BoardBrand[]): string[] {
  const shown = new Set(board.map((b) => b.name));
  return [...new Set(names.map((n) => n.trim()).filter((n) => shown.has(n)))];
}

/* ------------------------------- reads ------------------------------- */

/** The saved per-site verdicts (board names), for the sites that have one. Cache read only. */
export async function readSiteVerdicts(project: Pick<Project, "id">, sites: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (sites.length === 0) return out;
  const keys = sites.map((s) => siteOwnerKey(project.id, s));
  let hits = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 500) {
    const got = await store.cacheGetMany(keys.slice(i, i + 500), CACHE_TTL_MS);
    hits = new Map([...hits, ...got]);
  }
  sites.forEach((s, i) => {
    const raw = hits.get(keys[i]);
    if (!raw) return;
    try {
      const v = JSON.parse(raw) as { owners?: unknown };
      if (Array.isArray(v.owners)) out.set(s, v.owners.filter((x): x is string => typeof x === "string"));
    } catch {
      /* a corrupt row is a miss */
    }
  });
  return out;
}

/** The run's verdict snapshot (what a view reads): its raw row (null = no prewarm wrote one) and site -> board names. */
export async function readSiteSnapshot(projectId: string, runId: string): Promise<{ raw: string | null; verdicts: Record<string, string[]> }> {
  const raw = await store.cacheGet(siteSnapshotKey(projectId, runId), CACHE_TTL_MS);
  if (!raw) return { raw: null, verdicts: {} };
  try {
    const v = JSON.parse(raw) as { verdicts?: Record<string, unknown> };
    const verdicts: Record<string, string[]> = {};
    for (const [site, names] of Object.entries(v.verdicts ?? {})) {
      if (Array.isArray(names)) verdicts[site] = names.filter((x): x is string => typeof x === "string");
    }
    return { raw, verdicts };
  } catch {
    return { raw: null, verdicts: {} };
  }
}

/** What the owner rules above the name match read for one run, resolved to entry ids (ViewData.siteOwners). */
export interface SiteOwnerLoad {
  entered: Record<string, string[]>;
  checked: Record<string, string[]>;
}

export async function loadSiteOwnerInputs(project: Project, runId: string, dictionary: DictionaryEntry[]): Promise<SiteOwnerLoad> {
  const [enteredRaw, snap] = await Promise.all([store.getSiteOwners(project.id), readSiteSnapshot(project.id, runId)]);
  const board = checkBoard(project, dictionary);
  const checked: Record<string, string[]> = {};
  for (const [site, names] of Object.entries(snap.verdicts)) checked[site] = resolveVerdictNames(names, board);
  return { entered: enteredOwners(parseSiteOwners(enteredRaw)), checked };
}

/** The part of a view's cache key the site owners ride: the rules version and model, the entered map and the run's
 * verdict snapshot (each by a short hash of its stored row). Two small reads; never the run's answers. */
export async function siteOwnerStamp(projectId: string, runId: string): Promise<string> {
  const [entered, snap] = await Promise.all([store.getSiteOwners(projectId), store.cacheGet(siteSnapshotKey(projectId, runId), CACHE_TTL_MS)]);
  const h = (s: string | null) => (s ? sha(s).slice(0, 12) : "none");
  return `sites:${SITE_RULES_VERSION}:${SITE_OWNER_MODEL}:${h(entered)}:${h(snap)}`;
}

/* ------------------------------- the check ------------------------------- */

export interface CitedSite extends SiteToCheck {
  /** Answers of the run (the answer-fact population: every question type, the core panel) citing the site. */
  answers: number;
}

/** Every site the answers cite, most cited first, with up to two of its cited URLs as written. */
export function citedSites(facts: readonly { responseId: string; sources: readonly { site: string }[] | null }[], citationsOf: (responseId: string) => readonly string[] | null): CitedSite[] {
  const by = new Map<string, CitedSite>();
  for (const f of facts) {
    if (!f.sources?.length) continue;
    const urls = citationsOf(f.responseId) ?? [];
    for (const { site } of f.sources) {
      const s = by.get(site) ?? { site, answers: 0, urls: [] };
      s.answers++;
      if (s.urls.length < 2) for (const u of urls) if (s.urls.length < 2 && !s.urls.includes(u) && siteOf(u) === site) s.urls.push(u);
      by.set(site, s);
    }
  }
  return [...by.values()].sort((a, b) => b.answers - a.answers || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0));
}

/** The run's cited sites from loaded view data (dynamic import: answer_facts imports view_data, which imports this). */
export async function citedSitesOf(data: ViewData): Promise<CitedSite[]> {
  const { buildAnswerFacts } = await import("./facts/answer_facts");
  const set = buildAnswerFacts(data);
  const byId = new Map(data.responses.map((r) => [r.id, r.citations]));
  return citedSites(set.facts, (id) => byId.get(id) ?? null);
}

export interface SiteCheckPlan {
  board: BoardBrand[];
  /** The sites to check (cited by at least SITE_MIN_ANSWERS answers), most cited first. */
  sites: CitedSite[];
  /** The saved verdicts among them (board names). */
  cached: Map<string, string[]>;
  /** The sites with no saved verdict, in the order they would be sent. */
  misses: CitedSite[];
}

/** What a prewarm would send for one run. Reads only (the run and the cache); no model call. */
export async function planSiteOwnerCheck(run: Run, project: Project): Promise<SiteCheckPlan | null> {
  const { loadViewData } = await import("./view_data");
  const data = await loadViewData(run, project);
  if (!data) return null;
  const sites = (await citedSitesOf(data)).filter((s) => s.answers >= SITE_MIN_ANSWERS);
  const cached = await readSiteVerdicts(project, sites.map((s) => s.site));
  return { board: checkBoard(project, data.dictionary), sites, cached, misses: sites.filter((s) => !cached.has(s.site)) };
}

export interface SiteWarmCounts {
  /** Sites to check on the run. */
  sites: number;
  /** Already judged before this call. */
  cached: number;
  /** Judged by this call. */
  judged: number;
  /** Left without a verdict: a failed call, a site the reply left out twice, or out of time. */
  failed: number;
}

/**
 * Judge the run's never-checked sites and write the run's snapshot. No key (and no injected judge) = a no-op that
 * reads nothing. A chunk that fails is skipped and logged, never thrown; a site the reply leaves out is sent once
 * more on its own chunk, and still left out gets no verdict (nothing cached - the next prewarm asks again).
 */
export async function prewarmSiteOwners(
  run: Run,
  project: Project,
  opts: { deadlineMs?: number; judge?: SiteJudge } = {}
): Promise<SiteWarmCounts> {
  const zero: SiteWarmCounts = { sites: 0, cached: 0, judged: 0, failed: 0 };
  const judge = opts.judge ?? (apiKeyConfigured() && /^gpt-/.test(SITE_OWNER_MODEL) ? openaiSiteJudge : null);
  if (!judge) return zero;
  const plan = await planSiteOwnerCheck(run, project);
  if (!plan || plan.sites.length === 0) return zero;
  const counts: SiteWarmCounts = { sites: plan.sites.length, cached: plan.cached.size, judged: 0, failed: 0 };
  const verdicts = new Map(plan.cached);
  const meta = { brand: project.brand, category: project.category, projectId: project.id };
  const late = () => opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs;

  const ask = async (chunk: readonly CitedSite[]): Promise<Map<string, string[]>> => {
    const got = await judge({ category: project.category, board: plan.board, sites: chunk.map(({ site, urls }) => ({ site, urls })) });
    const out = new Map<string, string[]>();
    for (const s of chunk) {
      const names = got.get(s.site);
      if (names) out.set(s.site, keepBoardNames(names, plan.board));
    }
    return out;
  };
  const chunks: CitedSite[][] = [];
  for (let i = 0; i < plan.misses.length; i += SITE_CHUNK) chunks.push(plan.misses.slice(i, i + SITE_CHUNK));

  await withCostContext({ purpose: "views:site_owner", projectId: project.id }, async () => {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
        while (next < chunks.length) {
          const chunk = chunks[next++];
          if (late()) {
            counts.failed += chunk.length;
            continue;
          }
          try {
            const got = await ask(chunk);
            const omitted = chunk.filter((s) => !got.has(s.site));
            if (omitted.length > 0 && !late()) {
              try {
                for (const [s, v] of await ask(omitted)) got.set(s, v);
              } catch (err) {
                console.error(`site owner check: retry of ${omitted.length} omitted sites failed for ${project.id}:`, err);
              }
            }
            for (const s of chunk) {
              const names = got.get(s.site);
              if (!names) {
                counts.failed++;
                continue;
              }
              verdicts.set(s.site, names);
              counts.judged++;
              await store.cacheSet(siteOwnerKey(project.id, s.site), JSON.stringify({ owners: names }), meta).catch(() => {});
            }
          } catch (err) {
            counts.failed += chunk.length;
            console.error(`site owner check: a chunk of ${chunk.length} sites failed for ${project.id}:`, err);
          }
        }
      })
    );
  });

  // The run's snapshot: every checked site with a verdict, sorted, no timestamp - an unchanged set writes the same
  // row, so the views' key does not move.
  const snapshot = JSON.stringify({
    verdicts: Object.fromEntries(plan.sites.filter((s) => verdicts.has(s.site)).map((s) => [s.site, verdicts.get(s.site)!]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  });
  const prior = await store.cacheGet(siteSnapshotKey(project.id, run.id), CACHE_TTL_MS);
  if (prior !== snapshot) await store.cacheSet(siteSnapshotKey(project.id, run.id), snapshot, meta);
  return counts;
}
