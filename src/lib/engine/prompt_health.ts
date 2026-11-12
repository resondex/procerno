import { store } from "../store";
import { tagCosts } from "../cost_log";
import { matchKey } from "../brand_key";
import { buildCanonicalizer } from "./metrics";
import { apiKeyConfigured, openaiClient } from "./providers";
import { PROMPT_HEALTH_MODEL } from "./models";
import { promptsForRun } from "./surfaces";
import { healthChecks } from "./prompt_health_rule";
import { buildResolver } from "./brand_resolve";
import { cachedContextVerdicts } from "./context_judge";
import { computeQuestionFit, type FitResult } from "./question_fit";
import { logLegacyFlags, logWordingFlags } from "./prompt_flags";
import type {
  AnswerCodes,
  DictionaryEntry,
  Intent,
  MentionRow,
  Project,
  Prompt,
  Run,
} from "../types";

// Contract (2026-10-14): the model returns ONLY the defective prompts; a
// prompt we sent that is absent from the list is healthy and its flag clears.
// The old one-verdict-per-prompt contract failed two ways: gpt-6-luna returned
// only the defective prompts anyway (8 of 12 test runs), so flags never
// cleared, and gpt-5-mini timed out writing 280 verdicts on AmEx's battery.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    defective: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          // Anchors each verdict to its prompt; an id we did not send is
          // discarded rather than guessed at.
          id: { type: "string" },
          reason: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } },
        },
        required: ["id", "reason", "alternatives"],
      },
    },
  },
  required: ["defective"],
} as const;

export { healthChecks } from "./prompt_health_rule";

/* ------------------------------------------------------------------------ */
/* The input the model sees - pure                                           */
/* ------------------------------------------------------------------------ */

/** Where the CURRENT dictionary (plus cached context-judge verdicts) places
 * a recalled name: an approved brand of the category; ruled out at review or
 * judged no product of a category maker; or not yet reviewed. Only the
 * answer_codes path carries it - the legacy path never did. */
// "not_competitor" is NOT "off topic": a name the brand board ignores is only
// ruled out as a competitor to count. It is often something the category's
// brands sell, include or partner with (2026-11-11: a retailer tracker's
// carried product brands read as "outside the category" and half its
// questions were flagged). Whether it is a different kind of product is the
// model's call.
export type HealthStatus = "in_category" | "not_competitor" | "unreviewed";

export interface HealthBrand {
  brand: string;
  answers: number;
  status?: HealthStatus;
}

/** One question as the model sees it (the user message is the JSON list of
 * these, exactly as built). */
export interface HealthItem {
  id: string;
  prompt: string;
  answers: number;
  recalled_brands: HealthBrand[];
}

export interface HealthInput {
  mode: "codes" | "mentions";
  items: HealthItem[];
  /** Questions this run asked that the rule leaves out. */
  skipped: number;
  /** Left-out questions still carrying a flag from an earlier rule: a
   * completed check clears them, since no later check will ever judge them. */
  stale: string[];
}

interface BaseArgs {
    run: Pick<Run, "surfaces">;
  prompts: Prompt[];
  intents: Intent[];
  /** response id -> prompt id (bodies never needed). */
  responses: { id: string; prompt_id: string }[];
}

/** Which of the run's questions are sent, and under which rule. */
function selectPrompts(args: BaseArgs) {
  const intentById = new Map(args.intents.map((i) => [i.id, i]));
  // Only prompts this run asked: a skip wave sending a worry prompt with
  // zero answers would let the model clear the flag its monthly wave set.
  const asked = promptsForRun(args.run, args.prompts, args.intents);
  const picked: Prompt[] = [];
  let skipped = 0;
  const stale: string[] = [];
  for (const p of asked) {
    const intent = p.intent_id ? intentById.get(p.intent_id) : undefined;
    if (healthChecks(p, intent)) picked.push(p);
    else {
      skipped++;
      if (p.flagged) stale.push(p.id);
    }
  }
  return { picked, skipped, stale };
}

function rowsByPrompt(responses: { id: string; prompt_id: string }[]) {
  const out = new Map<string, string[]>();
  for (const r of responses) {
    const list = out.get(r.prompt_id) ?? [];
    list.push(r.id);
    out.set(r.prompt_id, list);
  }
  return out;
}

/** Weigh brands by how many answers named them, not by how many distinct
 * names appeared: a prompt whose answers are overwhelmingly on-category but
 * which picked up a long tail of one-off strays used to read as heavily
 * defective, because every stray counted the same as the category leader. */
function rank<T extends { answers: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.answers - a.answers);
}

/**
 * The input for a project reading answer_codes (codes_source set). Pure: no
 * store, no model. Each answer's mentions resolve through the CURRENT
 * dictionary (brand_resolve.ts) with the cached context-judge verdicts;
 * `nulls` are names the judge ruled are no product of a category maker
 * (counted as "not_competitor").
 */
export function buildHealthInput(
  args: BaseArgs & {
    codes: AnswerCodes[];
    dictionary: DictionaryEntry[];
    judged?: Map<string, string>;
    nulls?: Set<string>;
  }
): HealthInput {
  const { picked, skipped, stale } = selectPrompts(args);
  const resolve = buildResolver(args.dictionary, args.judged);
  const codeById = new Map(args.codes.map((c) => [c.response_id, c]));
  const byPrompt = rowsByPrompt(args.responses);
  const statusOf = (raw: string): { key: string; name: string; status: HealthStatus } => {
    const r = resolve(raw);
    if (r.status === "active") return { key: r.key, name: r.name, status: "in_category" };
    if (r.status === "rejected") return { key: r.key, name: r.name, status: "not_competitor" };
    if (r.status === "unknown" && r.via === null && args.nulls?.has(matchKey(raw)))
      return { key: r.key, name: r.name, status: "not_competitor" };
    return { key: r.key, name: r.name, status: "unreviewed" };
  };
  const items: HealthItem[] = [];
  for (const prompt of picked) {
    const ids = byPrompt.get(prompt.id) ?? [];
    const counts = new Map<string, HealthBrand>();
    for (const id of ids) {
      const code = codeById.get(id);
      const seen = new Set<string>();
      for (const m of code?.mentions ?? []) {
        if (!m?.brand?.trim()) continue;
        const s = statusOf(m.brand);
        if (seen.has(s.key)) continue;
        seen.add(s.key);
        const b = counts.get(s.key) ?? { brand: s.name, answers: 0, status: s.status };
        b.answers++;
        counts.set(s.key, b);
      }
    }
    items.push({ id: prompt.id, prompt: prompt.text, answers: ids.length, recalled_brands: rank([...counts.values()]) });
  }
  return { mode: "codes", items, skipped, stale };
}

/** The legacy input (no codes_source): the mentions table, canonicalized as
 * before. Byte-identical to the pre-2026-11-11 user message for the prompts
 * it sends (no status field). */
export function buildLegacyHealthInput(
  args: BaseArgs & { mentions: Pick<MentionRow, "response_id" | "brand">[]; dictionary: DictionaryEntry[] }
): HealthInput {
  const canon = buildCanonicalizer(args.dictionary);
  // The legacy rule is theme-only, as it always was.
  const unbranded = promptsForRun(args.run, args.prompts, args.intents);
  const sent = unbranded.filter((p) => p.theme !== "branded");
  const mentionsByResponse = new Map<string, string[]>();
  for (const m of args.mentions) {
    const list = mentionsByResponse.get(m.response_id) ?? [];
    list.push(canon.canonical(m.brand));
    mentionsByResponse.set(m.response_id, list);
  }
  const byPrompt = rowsByPrompt(args.responses);
  const items = sent.map((p) => {
    const ids = byPrompt.get(p.id) ?? [];
    const counts = new Map<string, number>();
    for (const id of ids) {
      for (const b of new Set(mentionsByResponse.get(id) ?? [])) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return {
      id: p.id,
      prompt: p.text,
      answers: ids.length,
      recalled_brands: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([brand, answers]) => ({ brand, answers })),
    };
  });
  return { mode: "mentions", items, skipped: unbranded.length - sent.length, stale: [] };
}

/** The system prompt. Unchanged from 2026-10-14 for the legacy input; the
 * answer_codes input adds ONE sentence describing its per-brand status
 * field (no examples - the rule on prompt text). */
export function healthSystemPrompt(category: string, withStatus: boolean): string {
  return (
    "You audit a brand-visibility study's prompts after a run. " +
    `The study measures the category "${category}". For each ` +
    "prompt you get its id, how many answers it collected, and the " +
    "brands those answers recalled with the number of answers naming " +
    "each. " +
    (withStatus
      ? "Each brand also carries a status from the study's reviewed " +
        "brand list: in_category (an approved brand of the category), " +
        "not_competitor (reviewed and not counted as a competing brand - " +
        "this says nothing about topic: it is often something the " +
        "category's brands sell, carry, include or partner with), or " +
        "unreviewed (not on the list yet). For not_competitor and " +
        "unreviewed names, judge yourself whether the name belongs to a " +
        "DIFFERENT kind of product than the category; names that sit " +
        "inside the category's own offering are on-category recall, " +
        "however many answers name them. "
      : "") +
    "Judge by that weight, not by the length of the brand list: " +
    "one stray brand named in a single answer is noise, while a " +
    "non-category brand named in most answers is evidence. A " +
    "prompt is defective when a substantial share of recall " +
    "is OUTSIDE the category — evidence the prompt was read as being " +
    "about something broader or different (e.g. it asked for 'a tool' " +
    "without naming the category at all, so answers ranged across " +
    "unrelated kinds of product). A few stray adjacent brands in an " +
    "otherwise " +
    "on-category answer set are normal — do not flag those. For each " +
    "defective prompt: reason = one plain sentence naming what the " +
    "answers drifted to; alternatives = exactly 2 rewritten prompts " +
    "that keep the original intent, length, and casual register but " +
    "anchor the category unmistakably. Never include brand names in " +
    "alternatives. List ONLY the defective prompts, each with its id " +
    "echoed back exactly; every prompt you leave out is treated as " +
    "healthy. An empty list means every prompt is healthy."
  );
}

/* ------------------------------------------------------------------------ */
/* Load, run, record                                                         */
/* ------------------------------------------------------------------------ */

/** The "check ran" record: an llm_cache marker per run, written only when a
 * readable verdict list was applied (or there was nothing to send). Its
 * absence means the check never ran on that wave. */
// ph4 (2026-11-11): the question-level (cell) findings are gone - the
// record carries the wording check only. A ph3 record is still READ (minus
// its cells) so a wave checked before ph4 reads as checked, and a fresh run
// of the check deletes it, which clears any question-level flag it held.
export const HEALTH_RECORD_VERSION = "ph4";
export const healthRecordKey = (runId: string) => `prompt_health:${HEALTH_RECORD_VERSION}:${runId}`;
const PRIOR_RECORD_KEYS = (runId: string) => [`prompt_health:ph3:${runId}`];
const FOREVER_MS = 100 * 365 * 24 * 3600 * 1000;

export interface HealthRecord {
  at: string;
  mode: "codes" | "mentions";
  source: string | null;
  model: string | null;
  sent: number;
  flagged: number;
}

export async function readHealthRecord(runId: string): Promise<HealthRecord | null> {
  try {
    for (const key of [healthRecordKey(runId), ...PRIOR_RECORD_KEYS(runId)]) {
      const raw = await store.cacheGet(key, FOREVER_MS);
      if (!raw) continue;
      // A ph3 record's question-level findings are never served.
      const { at, mode, source, model, sent, flagged } = JSON.parse(raw) as HealthRecord & { cells?: unknown };
      return { at, mode, source, model, sent, flagged };
    }
    return null;
  } catch {
    return null;
  }
}

/** Drop the pre-ph4 records of a run (their question-level flags with them). */
async function dropPriorRecords(runId: string): Promise<void> {
  for (const key of PRIOR_RECORD_KEYS(runId)) await store.cacheDelete(key).catch(() => {});
}

/** Everything the check reads, built into its input. No model call. */
export async function loadHealthInput(
  projectId: string,
  runId: string
): Promise<{ project: Project; run: Run; source: string | null; input: HealthInput } | null> {
  const project = await store.getProject(projectId);
  if (!project) return null;
  const run = await store.getRun(runId);
  if (!run) return null;
  const source = await store.getCodesSource(projectId);
  const [prompts, intents, responses, dictionary] = await Promise.all([
    store.listPrompts(projectId),
    store.listIntents(projectId),
    store.listResponseMeta(runId),
    store.getDictionary(projectId),
  ]);
  const base = {
    project,
    run,
    prompts,
    intents,
    responses: responses.map((r) => ({ id: r.id, prompt_id: r.prompt_id })),
    dictionary,
  };
  if (source) {
    const codes = await store.listAnswerCodes(runId, source);
    // Cached verdicts only - never a model call, in any environment.
    const { judged, nulls } = await cachedContextVerdicts({ project, dictionary, codes });
    return { project, run, source, input: buildHealthInput({ ...base, codes, judged, nulls }) };
  }
  const mentions = await store.listMentionsForRun(runId);
  return { project, run, source: null, input: buildLegacyHealthInput({ ...base, mentions }) };
}

export interface HealthResult {
  ran: boolean;
  /** Why it did not run, when it did not. */
  reason?: "no project" | "no key" | "dry" | "unreadable" | "no codes";
  sent: number;
  flagged: number;
  input?: HealthInput;
  /** Coded trackers: the counted result (question_fit.ts). */
  fit?: FitResult;
}

/**
 * The coded-tracker check (2026-11-11): counted from answer_codes by
 * question_fit.ts - no model call, no key, no spend. Every asked wording it
 * can judge gets its flag set or cleared, and every flag is logged
 * (prompt_flags.ts). `dry` returns the result without writing.
 */
async function analyzeCoded(
  project: Project,
  run: Run,
  source: string,
  opts: { dry?: boolean }
): Promise<HealthResult> {
  const [prompts, intents, responses, dictionary, codes] = await Promise.all([
    store.listPrompts(project.id),
    store.listIntents(project.id),
    store.listResponseMeta(run.id),
    store.getDictionary(project.id),
    store.listAnswerCodes(run.id, source),
  ]);
  // Cached verdicts only - never a model call, in any environment.
  const { judged } = await cachedContextVerdicts({ project, dictionary, codes });
  const fit = computeQuestionFit({
    brand: project.brand,
    run,
    prompts,
    intents,
    responses: responses.map((r) => ({ id: r.id, prompt_id: r.prompt_id })),
    codes,
    dictionary,
    judged,
  });
  const sent = fit.checked.length;
  const flagged = fit.wordings.length;
  if (opts.dry) return { ran: false, reason: "dry", sent, flagged, fit };
  // No coded answers at all: nothing was checked, so record nothing.
  if (sent === 0) return { ran: false, reason: "no codes", sent, flagged, fit };

  const flagOf = new Map(fit.wordings.map((w) => [w.prompt, w]));
  const was = new Map(prompts.map((p) => [p.id, p.flagged === 1]));
  for (const id of fit.checked) {
    const w = flagOf.get(id);
    if (!w && !was.get(id)) continue;
    await store.setPromptFlag(id, w ? { reason: w.reason, alternatives: [] } : null);
  }
  // Every flag is logged (prompt_flags), and a logged flag that stopped
  // firing reads "cleared" - never deleted.
  await logWordingFlags({ project, run, fit, prompts });
  const rec: HealthRecord = {
    at: new Date().toISOString(),
    mode: "codes",
    source,
    model: null,
    sent,
    flagged,
  };
  await store.cacheSet(healthRecordKey(run.id), JSON.stringify(rec), {
    brand: project.brand,
    category: project.category,
    projectId: project.id,
  });
  await dropPriorRecords(run.id);
  console.log(`question check (${project.brand}): ${flagged} of ${sent} wordings flagged`);
  return { ran: true, sent, flagged, fit };
}

/**
 * Post-run health check: a prompt whose answers recall mostly out-of-category
 * brands was probably measuring the wrong conversation. Called by finalizeRun
 * after every completed run, and by scripts/run_prompt_health.mts for a
 * coded run still held at "collected" - a battery that was healthy at launch
 * can drift as the assistants change. Flags defective prompts and proposes
 * anchored alternatives for refielding. Flags are advisory and recomputed
 * each run; nothing is retired automatically. `dry` builds the input and
 * returns it - no model call, no writes.
 */
export async function analyzePromptHealth(
  projectId: string,
  runId: string,
  opts: { dry?: boolean } = {}
): Promise<HealthResult> {
  const codedSource = await store.getCodesSource(projectId);
  if (codedSource) {
    const [p, r] = await Promise.all([store.getProject(projectId), store.getRun(runId)]);
    if (!p || !r) return { ran: false, reason: "no project", sent: 0, flagged: 0 };
    return analyzeCoded(p, r, codedSource, opts);
  }
  if (!opts.dry) {
    tagCosts({ purpose: "run:prompt_health" });
    if (!apiKeyConfigured()) return { ran: false, reason: "no key", sent: 0, flagged: 0 };
  }
  const loaded = await loadHealthInput(projectId, runId);
  if (!loaded) return { ran: false, reason: "no project", sent: 0, flagged: 0 };
  const { project, source, input } = loaded;
  if (opts.dry) return { ran: false, reason: "dry", sent: input.items.length, flagged: 0, input };

  const record = async (flagged: number) => {
    const rec: HealthRecord = {
      at: new Date().toISOString(),
      mode: input.mode,
      source,
      model: input.items.length > 0 ? PROMPT_HEALTH_MODEL : null,
      sent: input.items.length,
      flagged,
    };
    await store.cacheSet(healthRecordKey(runId), JSON.stringify(rec), {
      brand: project.brand,
      category: project.category,
      projectId: project.id,
    });
  };

  // Nothing judgeable this wave: record that the check ran, touch no flag.
  if (input.items.length === 0) {
    for (const id of input.stale) await store.setPromptFlag(id, null);
    await record(0);
    return { ran: true, sent: 0, flagged: 0 };
  }

  const res = await openaiClient().chat.completions.create({
    model: PROMPT_HEALTH_MODEL,
    messages: [
      { role: "system", content: healthSystemPrompt(project.category, input.mode === "codes") },
      { role: "user", content: JSON.stringify(input.items) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "health", strict: true, schema: SCHEMA },
    },
  });
  // No parsable reply means no verdicts: leave every flag as it was. Under
  // this contract an empty default would read as "all healthy" and clear them.
  const content = res.choices[0]?.message?.content;
  let defective: { id: string; reason: string; alternatives: string[] }[];
  try {
    defective = (JSON.parse(content ?? "") as { defective: typeof defective }).defective;
    if (!Array.isArray(defective)) throw new Error("no defective list");
  } catch {
    console.warn(`prompt health check (${project.brand}): unreadable reply - flags unchanged`);
    return { ran: false, reason: "unreadable", sent: input.items.length, flagged: 0 };
  }

  const sent = new Set(input.items.map((x) => x.id));
  const byId = new Map(defective.filter((r) => sent.has(r.id)).map((r) => [r.id, r]));
  const unknown = defective.length - byId.size;
  if (unknown > 0) {
    console.warn(
      `prompt health check (${project.brand}): ${unknown} verdicts named ids we did not send or repeated an id - discarded`
    );
  }
  let flagged = 0;
  for (const x of input.items) {
    const r = byId.get(x.id);
    if (r) flagged++;
    await store.setPromptFlag(
      x.id,
      r
        ? {
            reason: r.reason || "answers drifted off-category",
            alternatives: r.alternatives.slice(0, 2),
          }
        : null
    );
  }
  for (const id of input.stale) await store.setPromptFlag(id, null);
  await logLegacyFlags({
    project,
    runId,
    items: input.items,
    flagged: [...byId.values()].map((r) => ({ id: r.id, reason: r.reason || "answers drifted off-category" })),
  }).catch((err) => console.error("prompt flag log failed:", err));
  await record(flagged);
  console.log(`prompt health check (${project.brand}): ${flagged}/${input.items.length} prompts flagged`);
  return { ran: true, sent: input.items.length, flagged };
}

/** The run the dashboard shows results for (scripts/warm_views.mts's rule):
 * the latest complete run, else the latest run carrying codes under the
 * project's codes source (a coded run held at "collected"). */
export async function dashboardRun(projectId: string): Promise<Run | null> {
  const runs = await store.listRuns(projectId);
  const complete = runs.find((r) => r.status === "complete");
  if (complete) return complete;
  const source = await store.getCodesSource(projectId);
  if (!source) return null;
  for (const r of runs) if ((await store.countAnswerCodes(r.id, source)) > 0) return r;
  return null;
}
