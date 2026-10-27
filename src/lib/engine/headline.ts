import { createHash } from "node:crypto";
import { store } from "../store";
import { matchKey } from "../brand_key";
import { ENGINES } from "./providers";
import { wilson } from "./metrics";
import { viewsOf } from "./views";
import { buildResolver, type Resolver } from "./brand_resolve";
import type { AnswerCodes, DictionaryEntry, Intent, Project, Prompt, Run } from "../types";

/**
 * The headline view (2026-10-27): win / pick / visibility over open-choice
 * answers only - the presentation rule (CODING_DECISIONS section 8) made
 * mechanical by the view router. The pool is every answer whose cell routes
 * to "headline" (discovery, use_case, social_validation, premium_worth),
 * on the tracker's core engine panel, read from answer_codes under the
 * project's codes_source. Brands resolve through the CURRENT dictionary at
 * read time (brand_resolve.ts); the B5 in-category flag is "the top pick
 * resolves to an active entry".
 *
 * Rates (all over headline answers unless named otherwise):
 * - mentioned: the answer names the brand in any framing;
 * - recommended: a mention of the brand is framed recommended, or the brand
 *   is the top pick (the crowned brand always counts as recommended);
 * - chosen: the top pick resolves to the brand (top_pick only exists on
 *   outcome = pick);
 * - share of decided: chosen over in-category picks;
 * - negative: a mention framed negative, over answers naming the brand.
 */

export interface RateCell {
  k: number;
  n: number;
  low: number;
  high: number;
}

export interface HeadlineBrand {
  key: string;
  name: string;
  role: "target" | "competitor" | "emerged";
  mentioned: RateCell;
  recommended: RateCell;
  chosen: RateCell;
  shareOfDecided: RateCell;
  negative: RateCell;
}

/** The target's rates inside one stage or one engine. */
export interface HeadlineSlice {
  key: string;
  label: string;
  answers: number;
  mentioned: RateCell;
  recommended: RateCell;
  chosen: RateCell;
  firmPickInCategory: RateCell;
}

export interface NamedCount {
  name: string;
  n: number;
}

export interface HeadlineView {
  runId: string;
  source: string;
  brand: string;
  /** Coded headline answers on the core panel - every rate's base. */
  answers: number;
  /** Headline answers on the core panel with no code row under the source. */
  uncoded: number;
  outcomes: { pick: number; conditional: number; no_pick: number; clarification: number };
  firmPick: RateCell;
  /** B5: picks whose top pick resolves to an active dictionary brand. */
  firmPickInCategory: RateCell;
  picks: {
    inCategory: number;
    /** Resolved to a rejected entry - the board ruled the name out. */
    ruledOut: number;
    pending: number;
    notInDictionary: number;
  };
  ruledOutPicks: NamedCount[];
  pendingPicks: NamedCount[];
  notInDictionaryPicks: NamedCount[];
  /** Active, analyzed brands named at least once, most-mentioned first. */
  brands: HeadlineBrand[];
  byStage: HeadlineSlice[];
  byEngine: HeadlineSlice[];
}

export interface HeadlineData {
  run: Run;
  project: Project;
  source: string;
  codes: AnswerCodes[];
  /** response id -> prompt id and engine, bodies never loaded. */
  responses: { id: string; prompt_id: string; model: string | null }[];
  prompts: Prompt[];
  intents: Intent[];
  dictionary: DictionaryEntry[];
}

const cell = (k: number, n: number): RateCell => ({ k, n, ...wilson(k, n) });

const STAGE_ORDER = ["discovery", "use_case", "social_validation", "premium_worth"];

function topCounts(m: Map<string, number>, limit = 12): NamedCount[] {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, n]) => ({ name, n }));
}

function roleOf(
  key: string,
  targetKey: string,
  entry: DictionaryEntry | null,
  legacyCompetitors: Set<string>
): HeadlineBrand["role"] {
  if (key === targetKey) return "target";
  if (entry?.role) return entry.role;
  return entry && legacyCompetitors.has(matchKey(entry.canonical)) ? "competitor" : "emerged";
}

/** Per-answer brand facts, resolved once. */
interface AnswerFacts {
  stage: string;
  model: string;
  outcome: string | null;
  pickKey: string | null;
  pickInCategory: boolean;
  named: Set<string>;
  recommended: Set<string>;
  negative: Set<string>;
}

function factsOf(c: AnswerCodes, stage: string, model: string, resolve: Resolver): AnswerFacts {
  const named = new Set<string>();
  const recommended = new Set<string>();
  const negative = new Set<string>();
  for (const m of c.mentions ?? []) {
    const r = resolve(m.brand);
    if (r.status !== "active") continue;
    named.add(r.key);
    if (m.framing === "recommended") recommended.add(r.key);
    if (m.framing === "negative") negative.add(r.key);
  }
  let pickKey: string | null = null;
  let pickInCategory = false;
  if (c.outcome === "pick" && c.top_pick) {
    const r = resolve(c.top_pick);
    if (r.status === "active") {
      pickKey = r.key;
      pickInCategory = true;
      named.add(r.key);
      recommended.add(r.key);
    }
  }
  return { stage, model, outcome: c.outcome, pickKey, pickInCategory, named, recommended, negative };
}

function sliceOf(key: string, label: string, rows: AnswerFacts[], targetKey: string): HeadlineSlice {
  const n = rows.length;
  return {
    key,
    label,
    answers: n,
    mentioned: cell(rows.filter((f) => f.named.has(targetKey)).length, n),
    recommended: cell(rows.filter((f) => f.recommended.has(targetKey)).length, n),
    chosen: cell(rows.filter((f) => f.pickKey === targetKey).length, n),
    firmPickInCategory: cell(rows.filter((f) => f.pickInCategory).length, n),
  };
}

export function computeHeadline(data: HeadlineData): HeadlineView {
  const { run, project, source, codes, responses, prompts, intents, dictionary } = data;
  const resolve = buildResolver(dictionary);
  const targetKey = resolve(project.brand).key;
  const legacy = new Set(project.competitors.map(matchKey));

  const intentById = new Map(intents.map((i) => [i.id, i]));
  const stageOfPrompt = new Map<string, string>();
  for (const p of prompts) {
    const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
    if (it && viewsOf(it.stage, it.angle).includes("headline")) stageOfPrompt.set(p.id, it.stage);
  }

  // Core panel, as metrics.ts: the declared set where it was sampled.
  const sampled = [...new Set(responses.map((r) => r.model ?? run.model))];
  const declared = project.engine_set.filter((m) => sampled.includes(m));
  const core = new Set(declared.length > 0 ? declared : sampled);

  const pool = new Map<string, { stage: string; model: string }>();
  for (const r of responses) {
    const stage = stageOfPrompt.get(r.prompt_id);
    const model = r.model ?? run.model;
    if (stage && core.has(model)) pool.set(r.id, { stage, model });
  }

  const facts: AnswerFacts[] = [];
  const ruledOut = new Map<string, number>();
  const pending = new Map<string, number>();
  const unknown = new Map<string, number>();
  const outcomes = { pick: 0, conditional: 0, no_pick: 0, clarification: 0 };
  for (const c of codes) {
    const at = pool.get(c.response_id);
    if (!at) continue;
    const f = factsOf(c, at.stage, at.model, resolve);
    facts.push(f);
    if (c.outcome && c.outcome in outcomes) outcomes[c.outcome as keyof typeof outcomes]++;
    if (c.outcome === "pick" && c.top_pick && !f.pickInCategory) {
      const r = resolve(c.top_pick);
      const bucket = r.status === "rejected" ? ruledOut : r.status === "pending" ? pending : unknown;
      bucket.set(r.name, (bucket.get(r.name) ?? 0) + 1);
    }
  }
  const n = facts.length;
  const inCategoryPicks = facts.filter((f) => f.pickInCategory).length;

  // Brand rows: every active, analyzed brand the pool names.
  const entryByKey = new Map(dictionary.map((e) => [e.id, e]));
  const tally = new Map<string, { named: number; rec: number; chosen: number; neg: number }>();
  const bump = (key: string, field: "named" | "rec" | "chosen" | "neg") => {
    const t = tally.get(key) ?? { named: 0, rec: 0, chosen: 0, neg: 0 };
    t[field]++;
    tally.set(key, t);
  };
  for (const f of facts) {
    for (const k of f.named) bump(k, "named");
    for (const k of f.recommended) bump(k, "rec");
    for (const k of f.negative) bump(k, "neg");
    if (f.pickKey) bump(f.pickKey, "chosen");
  }
  if (!tally.has(targetKey)) tally.set(targetKey, { named: 0, rec: 0, chosen: 0, neg: 0 });
  const brands: HeadlineBrand[] = [];
  for (const [key, t] of tally) {
    const entry = entryByKey.get(key) ?? null;
    if (entry && !entry.analyzed && key !== targetKey) continue;
    brands.push({
      key,
      name: entry ? entry.display_name ?? entry.canonical : project.brand,
      role: roleOf(key, targetKey, entry, legacy),
      mentioned: cell(t.named, n),
      recommended: cell(t.rec, n),
      chosen: cell(t.chosen, n),
      shareOfDecided: cell(t.chosen, inCategoryPicks),
      negative: cell(t.neg, t.named),
    });
  }
  brands.sort((a, b) => b.mentioned.k - a.mentioned.k || a.name.localeCompare(b.name));

  const engineLabel = new Map(ENGINES.map((e) => [e.id, e.label]));
  const stages = STAGE_ORDER.filter((s) => facts.some((f) => f.stage === s));
  const models = [...core].filter((m) => facts.some((f) => f.model === m));

  return {
    runId: run.id,
    source,
    brand: project.brand,
    answers: n,
    uncoded: pool.size - n,
    outcomes,
    firmPick: cell(outcomes.pick, n),
    firmPickInCategory: cell(inCategoryPicks, n),
    picks: {
      inCategory: inCategoryPicks,
      ruledOut: [...ruledOut.values()].reduce((a, b) => a + b, 0),
      pending: [...pending.values()].reduce((a, b) => a + b, 0),
      notInDictionary: [...unknown.values()].reduce((a, b) => a + b, 0),
    },
    ruledOutPicks: topCounts(ruledOut),
    pendingPicks: topCounts(pending),
    notInDictionaryPicks: topCounts(unknown),
    brands,
    byStage: stages.map((s) => sliceOf(s, s, facts.filter((f) => f.stage === s), targetKey)),
    byEngine: models.map((m) =>
      sliceOf(m, engineLabel.get(m) ?? m, facts.filter((f) => f.model === m), targetKey)
    ),
  };
}

/** Everything the view reads, bodies never loaded. null = the project
 * reads no codes source yet. */
export async function loadHeadlineData(run: Run, project: Project): Promise<HeadlineData | null> {
  const source = await store.getCodesSource(project.id);
  if (!source) return null;
  const [codes, responses, prompts, intents, dictionary] = await Promise.all([
    store.listAnswerCodes(run.id, source),
    store.listResponseMeta(run.id),
    store.listPrompts(project.id),
    store.listIntents(project.id),
    store.getDictionary(project.id),
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
  };
}

/**
 * Cached on everything that feeds it: the run's data revision (responses,
 * mentions, labels, prompts, answer_codes), the dictionary version and the
 * project fields the view reads. A store that cannot fingerprint (local
 * SQLite) computes fresh every time.
 */
const HEADLINE_VERSION = "h1";
export async function computeHeadlineCached(run: Run, project: Project): Promise<HeadlineView | null> {
  const source = await store.getCodesSource(project.id);
  if (!source) return null;
  const rev = await store.runDataRevision(run.id);
  const projectHash = createHash("sha256")
    .update(JSON.stringify([project.brand, project.competitors, project.engine_set]))
    .digest("hex")
    .slice(0, 12);
  const key = `headline:${HEADLINE_VERSION}:${run.id}:${source}:${project.dictionary_version}:${projectHash}:${rev}`;
  if (rev !== null) {
    const raw = await store.cacheGet(key, 24 * 3600 * 1000);
    if (raw) return JSON.parse(raw) as HeadlineView;
  }
  const data = await loadHeadlineData(run, project);
  if (!data) return null;
  const view = computeHeadline(data);
  if (rev !== null) {
    await store.cacheSet(key, JSON.stringify(view), {
      brand: project.brand,
      category: project.category,
      projectId: project.id,
    });
    // Older generations of this run's view stop being addressed; drop them.
    await store.cachePurge(`headline:${HEADLINE_VERSION}:${run.id}:`, key);
  }
  return view;
}
