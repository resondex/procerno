import { createHash } from "node:crypto";
import { store } from "../store";
import { wilson } from "./metrics";
import { cachedRunRevision } from "./run_revision";
import { viewsOf, type ViewKey } from "./views";
import { CONTEXT_JUDGE_MODEL, CONTEXT_JUDGE_VERSION, primeContextVerdicts } from "./context_judge";
import { ENGINES, engineFacets, type EngineFacets } from "./providers";
import type { ConditionKeysCache } from "./condition_groups";
import type { AnswerCodes, DictionaryEntry, Intent, Project, Prompt, Run } from "../types";

/**
 * Shared plumbing for the per-type views (2026-10-27): one load per run
 * (codes under the project's codes_source, response meta, prompts, intents,
 * dictionary - never answer bodies), the core engine panel, the pool of
 * answers a view counts, and the revision-keyed cache.
 */

export interface RateCell {
  k: number;
  n: number;
  low: number;
  high: number;
}

export const cell = (k: number, n: number): RateCell => ({ k, n, ...wilson(k, n) });

export type { EngineFacets };
/** Vendor, tier and mode for a by-engine slice (2026-11-03): the client's
 * Group-by toggle pools slices on them without parsing labels. */
export const facetsOf = (model: string): EngineFacets => engineFacets(model);

export interface ViewData {
  run: Run;
  project: Project;
  source: string;
  codes: AnswerCodes[];
  /** response id -> prompt id and engine, bodies never loaded. */
  responses: { id: string; prompt_id: string; model: string | null }[];
  prompts: Prompt[];
  intents: Intent[];
  dictionary: DictionaryEntry[];
  /** projects.setup_decision JSON - loaded only for views that ask for it. */
  setupDecision?: string | null;
  /** projects.code_groups JSON - loaded only for views that ask for it. */
  codeGroups?: string | null;
  /** Context-judge verdicts (matchKey -> maker) for names the dictionary
   * cannot place - loaded only for views that opt in. */
  judged?: Map<string, string>;
  /** True while judgeable names remain unjudged: the view computes but is
   * not cached, so the next open picks up where the slab ended. */
  judgeIncomplete?: boolean;
  /** The run's data revision when the view is computed through cachedView
   * (null on a store that cannot fingerprint). Computes use it to key their
   * own run-scoped caches (the condition grouping); never in a payload. */
  revision?: string | null;
}

/** Project records a view can opt into; each one also keys the view's cache.
 * `judge` opts into the read-time context judge (context_judge.ts); its
 * version + model ride the cache key, the verdicts themselves do not (they
 * only grow, and an incomplete set blocks the cache write). */
export interface ViewExtras {
  setupDecision?: boolean;
  codeGroups?: boolean;
  judge?: boolean;
}

/** One coded answer in a view's pool, with its cell and engine. */
export interface PoolRow {
  code: AnswerCodes;
  intent: Intent;
  model: string;
}

/** The core panel, as metrics.ts: the declared set where it was sampled. */
export function corePanel(data: ViewData): Set<string> {
  const sampled = [...new Set(data.responses.map((r) => r.model ?? data.run.model))];
  const declared = data.project.engine_set.filter((m) => sampled.includes(m));
  return new Set(declared.length > 0 ? declared : sampled);
}

/**
 * Request data a view can be asked for on top of its project records
 * (Journey's buyer filter, 2026-10-30). Each field rides the cache key only
 * when present, so an unfiltered request keys exactly as before.
 *
 * room: keep only cells whose situation is this room. Strict - a cell
 * asked across all buyers (situation null: head-to-heads, the worries
 * module, social validation, premium vs basic, category education) is
 * dropped, never counted as the room's. Only the room-pinned views take it.
 */
export interface ViewRequest {
  room?: string;
  /** The Panel lens (2026-11-03): keep only answers from these engines
   * (registry ids, sorted, deduped), intersected with the core panel - an
   * engine not on the core panel is ignored. Absent = the whole core panel.
   * Every view takes it; the by-engine tables shrink to the set. */
  engines?: string[];
}

/** The core panel narrowed to a request's engine set (order kept). */
export function coreOf(data: ViewData, opts: ViewRequest = {}): Set<string> {
  const core = corePanel(data);
  if (opts.engines === undefined) return core;
  const keep = new Set(opts.engines);
  return new Set([...core].filter((m) => keep.has(m)));
}

/** A request's engine set in canonical form: registry ids only, deduped,
 * sorted; undefined when none survive or none were asked. */
export function normalizeEngines(engines: readonly string[] | undefined): string[] | undefined {
  if (!engines) return undefined;
  const known = new Set(ENGINES.map((e) => e.id));
  const ids = [...new Set(engines.map((e) => e.trim()).filter((e) => known.has(e)))].sort();
  return ids.length > 0 ? ids : undefined;
}

/** The request a view route was asked for, with only the fields present -
 * an unfiltered request is `{}` and keys exactly as before. `room` is kept
 * only for the room-pinned views (`allowRoom`). */
export function requestOf(req: ViewRequest = {}, allowRoom = false): ViewRequest {
  const out: ViewRequest = {};
  if (allowRoom && req.room !== undefined) out.room = req.room;
  const engines = normalizeEngines(req.engines);
  if (engines) out.engines = engines;
  return out;
}

/** The answers a view counts on the core panel. `uncoded` = pool answers
 * with no code row under the source. With `room`, only that room's cells. */
export function poolOf(
  data: ViewData,
  view: ViewKey,
  opts: ViewRequest = {}
): { rows: PoolRow[]; uncoded: number; core: Set<string> } {
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const intentOfPrompt = new Map<string, Intent>();
  for (const p of data.prompts) {
    const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
    if (it && viewsOf(it.stage, it.angle).includes(view) && (opts.room === undefined || it.situation === opts.room))
      intentOfPrompt.set(p.id, it);
  }
  const core = coreOf(data, opts);
  const pool = new Map<string, { intent: Intent; model: string }>();
  for (const r of data.responses) {
    const intent = intentOfPrompt.get(r.prompt_id);
    const model = r.model ?? data.run.model;
    if (intent && core.has(model)) pool.set(r.id, { intent, model });
  }
  const rows: PoolRow[] = [];
  for (const code of data.codes) {
    const at = pool.get(code.response_id);
    if (at) rows.push({ code, ...at });
  }
  return { rows, uncoded: pool.size - rows.length, core };
}

/**
 * The shared load (2026-11-09): the heavy per-run reads, done once per
 * (run, source, dictionary version, data revision) and shared by every view
 * computed in this process - a cold dashboard open fires ~10 view routes at
 * once, and each used to pay its own full read of the run's coded rows.
 *
 * READ-ONLY BY CONTRACT: these arrays and their elements are shared across
 * concurrent computes. A compute that needs a different order or shape
 * copies locally (`[...data.codes].sort(...)`, `poolOf`'s fresh arrays);
 * nothing may sort, push, splice or assign into them or their elements.
 * The same holds for the shared `judged` Map below.
 */
interface SharedLoad {
  source: string;
  codes: AnswerCodes[];
  /** Already mapped to the ViewData shape - mapped once, shared. */
  responses: { id: string; prompt_id: string; model: string | null }[];
  prompts: Prompt[];
  intents: Intent[];
  dictionary: DictionaryEntry[];
}

/** Entries expire after this long - the backstop for anything the key cannot
 * see, and the whole invalidation story on a store that cannot fingerprint
 * (rev "null"). */
const SHARED_TTL_MS = 60 * 1000;
/** Each load holds several MB (a run's coded rows); keep only a few. */
const SHARED_MAX = 4;

interface MemoEntry<T> {
  at: number;
  promise: Promise<T>;
}

/** A promise memo with TTL (from insertion) and LRU eviction. Concurrent
 * callers share one in-flight promise; a rejected promise is evicted at
 * once, so a failure is never served to the next caller. */
function promiseMemo<T>() {
  const m = new Map<string, MemoEntry<T>>();
  const drop = (key: string, entry: MemoEntry<T>) => {
    if (m.get(key) === entry) m.delete(key);
  };
  return {
    get(key: string, make: () => Promise<T>): Promise<T> {
      // Expired entries are released on any access, so a warm instance never
      // keeps a run's rows resident past the TTL for want of a re-read.
      const now = Date.now();
      for (const [k, e] of m) if (k !== key && now - e.at > SHARED_TTL_MS) m.delete(k);
      const hit = m.get(key);
      if (hit && Date.now() - hit.at <= SHARED_TTL_MS) {
        // Refresh recency (LRU), never the insertion time (TTL).
        m.delete(key);
        m.set(key, hit);
        return hit.promise;
      }
      if (hit) m.delete(key);
      const entry: MemoEntry<T> = { at: Date.now(), promise: make() };
      m.set(key, entry);
      entry.promise.catch(() => drop(key, entry));
      while (m.size > SHARED_MAX) {
        const oldest = m.keys().next().value as string;
        m.delete(oldest);
      }
      return entry.promise;
    },
    /** Evict `key` if it still holds `promise`. */
    evict(key: string, promise: Promise<T>) {
      const hit = m.get(key);
      if (hit && hit.promise === promise) m.delete(key);
    },
    /** Test hook: the entry for a key (to age it or inspect it). */
    peek(key: string): MemoEntry<T> | undefined {
      return m.get(key);
    },
    clear() {
      m.clear();
    },
  };
}

const loadMemo = promiseMemo<SharedLoad>();
const judgeMemo = promiseMemo<{ judged: Map<string, string>; incomplete: boolean }>();

/** Test/diagnostic hooks for the shared load (scripts only). */
export const sharedLoadMemo = {
  load: loadMemo,
  judge: judgeMemo,
  clear() {
    loadMemo.clear();
    judgeMemo.clear();
  },
  keyOf: async (run: Run, project: Project, source: string) => sharedKey(run, project, source),
};

async function sharedKey(run: Run, project: Project, source: string): Promise<string> {
  const rev = await cachedRunRevision(run.id);
  return `${run.id}:${source}:${project.dictionary_version}:${rev === null ? "null" : rev}`;
}

async function readShared(run: Run, project: Project, source: string): Promise<SharedLoad> {
  const [codes, responses, prompts, intents, dictionary] = await Promise.all([
    store.listAnswerCodes(run.id, source),
    store.listResponseMeta(run.id),
    store.listPrompts(project.id),
    store.listIntents(project.id),
    store.getDictionary(project.id),
  ]);
  return {
    source,
    codes,
    responses: responses.map((r) => ({ id: r.id, prompt_id: r.prompt_id, model: r.model })),
    prompts,
    intents,
    dictionary,
  };
}

/** Everything the views read. null = the project reads no codes source yet.
 * The heavy reads come from the shared load (read-only, see SharedLoad);
 * the ViewData wrapper is fresh per call. */
export async function loadViewData(
  run: Run,
  project: Project,
  opts: ViewExtras = {}
): Promise<ViewData | null> {
  const source = await store.getCodesSource(project.id);
  if (!source) return null;
  const key = await sharedKey(run, project, source);
  const [shared, setupDecision, codeGroups] = await Promise.all([
    loadMemo.get(key, () => readShared(run, project, source)),
    opts.setupDecision ? store.getSetupDecision(project.id) : Promise.resolve(undefined),
    opts.codeGroups ? store.getCodeGroups(project.id) : Promise.resolve(undefined),
  ]);
  const { codes, responses, prompts, intents, dictionary } = shared;
  const data: ViewData = {
    run,
    project,
    source,
    codes,
    responses,
    prompts,
    intents,
    dictionary,
    ...(setupDecision !== undefined && { setupDecision }),
    ...(codeGroups !== undefined && { codeGroups }),
  };
  if (opts.judge) {
    const jkey = `${key}:judge`;
    const primed = judgeMemo.get(jkey, () =>
      primeContextVerdicts({
        project,
        dictionary,
        codes,
        meta: { brand: project.brand, category: project.category, projectId: project.id },
      })
    );
    const { judged, incomplete } = await primed;
    // An incomplete slab is never kept: the next call re-primes and judging
    // picks up where the slab ended (the per-name verdict cache).
    if (incomplete) judgeMemo.evict(jkey, primed);
    data.judged = judged;
    data.judgeIncomplete = incomplete;
  }
  return data;
}

/**
 * A view through the cache, keyed on everything that feeds it: the run's
 * data revision (responses, mentions, labels, prompts, answer_codes), the
 * codes source, the dictionary version and the project fields the views
 * read. A store that cannot fingerprint (local SQLite) computes fresh.
 *
 * Request data (ViewRequest) is appended to the key as a suffix ONLY when
 * present - `:room:<sha-12 of the room>`, then `:eng:<sha-12 of the sorted
 * engine ids>` - so an unfiltered request keys,
 * reads, writes and purges exactly as before (cache-era rule case 1). The
 * purge always keeps the unfiltered key as its LIKE prefix, so one
 * generation's unfiltered and per-room entries live side by side and only
 * older generations are dropped, whichever request computes first.
 */
export async function cachedView<T>(
  name: string,
  version: string,
  run: Run,
  project: Project,
  compute: (data: ViewData) => T | Promise<T>,
  opts: ViewExtras = {},
  request: ViewRequest = {}
): Promise<T | null> {
  const source = await store.getCodesSource(project.id);
  if (!source) return null;
  const rev = await cachedRunRevision(run.id);
  // A view that reads a project record keys on it too (it can change without a prompt changing).
  const extras: (string | null)[] = [];
  if (opts.setupDecision) extras.push(await store.getSetupDecision(project.id));
  if (opts.codeGroups) extras.push(await store.getCodeGroups(project.id));
  if (opts.judge) extras.push(`ctx:${CONTEXT_JUDGE_VERSION}:${CONTEXT_JUDGE_MODEL}`);
  const projectHash = createHash("sha256")
    .update(JSON.stringify(extras.length === 0 ? [project.brand, project.competitors, project.engine_set] : [project.brand, project.competitors, project.engine_set, ...extras]))
    .digest("hex")
    .slice(0, 12);
  const prefix = `${name}:${version}:${run.id}:`;
  const base = `${prefix}${source}:${project.dictionary_version}:${projectHash}:${rev}`;
  // Fixed suffix order: room, then engines - each only when present.
  let key = base;
  if (request.room !== undefined)
    key += `:room:${createHash("sha256").update(request.room).digest("hex").slice(0, 12)}`;
  if (request.engines !== undefined)
    key += `:eng:${createHash("sha256").update(request.engines.join(",")).digest("hex").slice(0, 12)}`;
  if (rev !== null) {
    const raw = await store.cacheGet(key, 183 * 24 * 3600 * 1000);
    if (raw) return JSON.parse(raw) as T;
  }
  const data = await loadViewData(run, project, opts);
  if (!data) return null;
  data.revision = rev;
  const view = await compute(data);
  // A half-judged view is served but never cached: the per-name verdict
  // cache makes the next compute pay only for the remaining slab.
  if (rev !== null && !data.judgeIncomplete) {
    await store.cacheSet(key, JSON.stringify(view), {
      brand: project.brand,
      category: project.category,
      projectId: project.id,
    });
    // Older generations of this run's view stop being addressed; drop them.
    // `base` keeps this generation's per-room entries too (LIKE base%).
    await store.cachePurge(prefix, base);
  }
  return view;
}

/** The `?room=` query param of a room-pinned view route; empty or absent =
 * every buyer (the unfiltered request). */
export function roomParam(req: Request): string | undefined {
  const room = new URL(req.url).searchParams.get("room");
  return room ? room : undefined;
}

/** The `?engines=a,b,c` query param (the Panel lens): registry ids only,
 * deduped and sorted; absent, empty or all-unknown = the whole core panel. */
export function enginesParam(req: Request): string[] | undefined {
  const raw = new URL(req.url).searchParams.get("engines");
  if (!raw) return undefined;
  return normalizeEngines(raw.split(","));
}

/** Both request fields a view route reads from its query string. */
export function viewRequestParams(req: Request): ViewRequest {
  const out: ViewRequest = {};
  const room = roomParam(req);
  if (room !== undefined) out.room = room;
  const engines = enginesParam(req);
  if (engines) out.engines = engines;
  return out;
}

/** The run-scoped cache a view's condition grouping may use (see
 * condition_groups.conditionKeysFor): null outside cachedView or on a store
 * that cannot fingerprint. The room rides the scope - a room's conditions
 * are their own population. */
export function condCache(data: ViewData, scope: string, request: ViewRequest = {}): ConditionKeysCache | null {
  if (!data.revision) return null;
  const room =
    request.room !== undefined ? `:room:${createHash("sha256").update(request.room).digest("hex").slice(0, 12)}` : "";
  return {
    runId: data.run.id,
    revision: data.revision,
    scope: scope + room,
    meta: { brand: data.project.brand, category: data.project.category, projectId: data.project.id },
  };
}
