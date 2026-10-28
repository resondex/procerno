import { createHash } from "node:crypto";
import { store } from "../store";
import { wilson } from "./metrics";
import { viewsOf, type ViewKey } from "./views";
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
}

/** Project records a view can opt into; each one also keys the view's cache. */
export interface ViewExtras {
  setupDecision?: boolean;
  codeGroups?: boolean;
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

/** The answers a view counts on the core panel. `uncoded` = pool answers
 * with no code row under the source. */
export function poolOf(data: ViewData, view: ViewKey): { rows: PoolRow[]; uncoded: number; core: Set<string> } {
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const intentOfPrompt = new Map<string, Intent>();
  for (const p of data.prompts) {
    const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
    if (it && viewsOf(it.stage, it.angle).includes(view)) intentOfPrompt.set(p.id, it);
  }
  const core = corePanel(data);
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

/** Everything the views read. null = the project reads no codes source yet. */
export async function loadViewData(
  run: Run,
  project: Project,
  opts: ViewExtras = {}
): Promise<ViewData | null> {
  const source = await store.getCodesSource(project.id);
  if (!source) return null;
  const [codes, responses, prompts, intents, dictionary, setupDecision, codeGroups] = await Promise.all([
    store.listAnswerCodes(run.id, source),
    store.listResponseMeta(run.id),
    store.listPrompts(project.id),
    store.listIntents(project.id),
    store.getDictionary(project.id),
    opts.setupDecision ? store.getSetupDecision(project.id) : Promise.resolve(undefined),
    opts.codeGroups ? store.getCodeGroups(project.id) : Promise.resolve(undefined),
  ]);
  return {
    run,
    project,
    source,
    codes,
    responses: responses.map((r) => ({ id: r.id, prompt_id: r.prompt_id, model: r.model })),
    prompts,
    intents,
    dictionary,
    ...(setupDecision !== undefined && { setupDecision }),
    ...(codeGroups !== undefined && { codeGroups }),
  };
}

/**
 * A view through the cache, keyed on everything that feeds it: the run's
 * data revision (responses, mentions, labels, prompts, answer_codes), the
 * codes source, the dictionary version and the project fields the views
 * read. A store that cannot fingerprint (local SQLite) computes fresh.
 */
export async function cachedView<T>(
  name: string,
  version: string,
  run: Run,
  project: Project,
  compute: (data: ViewData) => T | Promise<T>,
  opts: ViewExtras = {}
): Promise<T | null> {
  const source = await store.getCodesSource(project.id);
  if (!source) return null;
  const rev = await store.runDataRevision(run.id);
  // A view that reads a project record keys on it too (it can change without a prompt changing).
  const extras: (string | null)[] = [];
  if (opts.setupDecision) extras.push(await store.getSetupDecision(project.id));
  if (opts.codeGroups) extras.push(await store.getCodeGroups(project.id));
  const projectHash = createHash("sha256")
    .update(JSON.stringify(extras.length === 0 ? [project.brand, project.competitors, project.engine_set] : [project.brand, project.competitors, project.engine_set, ...extras]))
    .digest("hex")
    .slice(0, 12);
  const prefix = `${name}:${version}:${run.id}:`;
  const key = `${prefix}${source}:${project.dictionary_version}:${projectHash}:${rev}`;
  if (rev !== null) {
    const raw = await store.cacheGet(key, 24 * 3600 * 1000);
    if (raw) return JSON.parse(raw) as T;
  }
  const data = await loadViewData(run, project, opts);
  if (!data) return null;
  const view = await compute(data);
  if (rev !== null) {
    await store.cacheSet(key, JSON.stringify(view), {
      brand: project.brand,
      category: project.category,
      projectId: project.id,
    });
    // Older generations of this run's view stop being addressed; drop them.
    await store.cachePurge(prefix, key);
  }
  return view;
}
