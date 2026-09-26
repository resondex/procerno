import OpenAI from "openai";
import { nameAppearsBounded } from "./mention_filter";
import type { ExtractedMention, ExtractionResult } from "../types";
import { matchKey } from "../brand_key";

import { logCost } from "../cost_log";

export interface ExtractionContext {
  targetBrand: string;
  knownBrands: string[];
  reasonCodes: string[];
  /** Confirmed scope sentence per reason code (the consolidation "why" the
   * customer ratifies). Rendered with the reasons rule so a code covers
   * everything its definition names, not just what its name suggests.
   * Absent = names-only enum, the pre-2026-09-25 behavior. */
  reasonDefinitions?: Record<string, string>;
  /** Exact coder metering: every extraction model call reports its
   * vendor-metered usage here (input already folded to billed-equivalent
   * tokens for Anthropic prompt caching: uncached + 1.25x creation +
   * 0.1x reads). Absent = caller doesn't meter. */
  usageSink?: (model: string, inputTokens: number, outputTokens: number) => void;
}

export interface CompletionProvider {
  /** Answer a buyer-intent prompt the way a consumer assistant would. */
  complete(prompt: string, model: string): Promise<string>;
  /** Full per-answer coding: mentions, top pick, outcome, reasons, focus quote. */
  extractCoding(
    responseText: string,
    ctx: ExtractionContext,
    /** Override the coder for evaluation; production uses EXTRACT_MODEL. */
    model?: string,
    /** Consensus runs the focus read once for both coders. */
    skipFocus?: boolean
  ): Promise<ExtractionResult>;
}

/**
 * The measurement engines — the assistants whose answers we sample. Every
 * one is a distinct "view" of the category; adding an engine adds rows to
 * the analyses, never new analysis code. Extraction deliberately stays on
 * ONE fixed coder across all engines (see EXTRACT_MODEL): if the coder
 * varied by engine, coder drift would masquerade as engine differences.
 */
export type EngineMode = "instinct" | "search";

export interface Engine {
  id: string;
  label: string;
  vendor: string;
  keyEnv: string;
  /** OpenAI-compatible endpoint; absent means the vendor's own SDK. */
  baseURL?: string;
  sdk?: "anthropic";
  /**
   * Instinct = the model answers from its trained knowledge, no retrieval —
   * the stable baseline. Search = the assistant may search the web
   * mid-answer, the way the consumer apps behave; answers carry citations
   * and a per-answer search count. Same underlying model, two instruments.
   */
  mode: EngineMode;
  /** Model id sent to the vendor when it differs from our registry id
   * (search variants share the base model). */
  apiModel?: string;
  /** Set on a retired engine: the engine new runs collect on instead (see
   * currentEngineId). Retired entries stay registered so stored answers
   * keep their label, mode and price. */
  successor?: string;
}

/** Web searches one search-mode answer may run, on every vendor that lets
 * us bound it (Anthropic max_uses, OpenAI max_tool_calls; Perplexity is
 * always-grounded and unbounded by design). Uncapped, gpt-5-search ran 7+
 * searches on 22-36% of answers and search fees dominated its cost. */
export const SEARCH_CAP = 3;

/** Extraction-coder-only models: routable like engines, never selectable
 * as answer engines. */
const CODER_ONLY: Record<string, Pick<Engine, "id" | "keyEnv" | "baseURL">> = {
  "grok-4-fast": { id: "grok-4-fast", keyEnv: "XAI_API_KEY", baseURL: "https://api.x.ai/v1" },
};

export const ENGINES: Engine[] = [
  // ChatGPT surfaces, re-pointed 2026-09-26 to what consumers get: Free runs
  // GPT-5.6 Luna, Plus runs GPT-5.6 Sol (third-party plan comparisons, Sept
  // 2026). When ChatGPT moves again, add the new pair and set `successor`
  // on these - projects and schedules follow without a config change.
  { id: "gpt-5.6-luna", label: "ChatGPT (default tier)", vendor: "OpenAI", keyEnv: "OPENAI_API_KEY", mode: "instinct" },
  { id: "gpt-5.6-luna-search", label: "ChatGPT (default tier) + search", vendor: "OpenAI", keyEnv: "OPENAI_API_KEY", mode: "search", apiModel: "gpt-5.6-luna" },
  { id: "gpt-5.6-sol", label: "ChatGPT (premium tier)", vendor: "OpenAI", keyEnv: "OPENAI_API_KEY", mode: "instinct" },
  { id: "gpt-5.6-sol-search", label: "ChatGPT (premium tier) + search", vendor: "OpenAI", keyEnv: "OPENAI_API_KEY", mode: "search", apiModel: "gpt-5.6-sol" },
  // Retired ChatGPT stand-ins (Aug 2025 models) - every run collected
  // before 2026-09-26 answered on these.
  { id: "gpt-5-mini", label: "ChatGPT (default tier, gpt-5-mini - retired)", vendor: "OpenAI", keyEnv: "OPENAI_API_KEY", mode: "instinct", successor: "gpt-5.6-luna" },
  { id: "gpt-5-mini-search", label: "ChatGPT (default tier, gpt-5-mini - retired) + search", vendor: "OpenAI", keyEnv: "OPENAI_API_KEY", mode: "search", apiModel: "gpt-5-mini", successor: "gpt-5.6-luna-search" },
  { id: "gpt-5", label: "ChatGPT (premium tier, gpt-5 - retired)", vendor: "OpenAI", keyEnv: "OPENAI_API_KEY", mode: "instinct", successor: "gpt-5.6-sol" },
  { id: "gpt-5-search", label: "ChatGPT (premium tier, gpt-5 - retired) + search", vendor: "OpenAI", keyEnv: "OPENAI_API_KEY", mode: "search", apiModel: "gpt-5", successor: "gpt-5.6-sol-search" },
  { id: "claude-sonnet-5", label: "Claude (Sonnet)", vendor: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", sdk: "anthropic", mode: "instinct" },
  { id: "claude-sonnet-5-search", label: "Claude (Sonnet) + search", vendor: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", sdk: "anthropic", mode: "search", apiModel: "claude-sonnet-5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude (Haiku)", vendor: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", sdk: "anthropic", mode: "instinct" },
  {
    id: "gemini-pro-latest",
    label: "Gemini (Pro)",
    vendor: "Google",
    keyEnv: "GEMINI_API_KEY",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    mode: "instinct",
  },
  {
    id: "gemini-flash-latest",
    label: "Gemini (Flash)",
    vendor: "Google",
    keyEnv: "GEMINI_API_KEY",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    mode: "instinct",
  },
  { id: "grok-4", label: "Grok", vendor: "xAI", keyEnv: "XAI_API_KEY", baseURL: "https://api.x.ai/v1", mode: "instinct" },
  {
    // Perplexity has no instinct mode — retrieval IS the product.
    id: "sonar",
    label: "Perplexity (grounded)",
    vendor: "Perplexity",
    keyEnv: "PERPLEXITY_API_KEY",
    baseURL: "https://api.perplexity.ai",
    mode: "search",
  },
];

/** Which mode an engine id measures; unknown ids read as instinct. */
export function engineMode(id: string): EngineMode {
  return getEngine(id)?.mode ?? "instinct";
}

export function getEngine(id: string): Engine | undefined {
  return ENGINES.find((e) => e.id === id);
}

/** The engine a NEW run collects on for a configured id: retired engines
 * resolve along their successor chain, everything else is itself. Applied
 * where runs are created, so a run's stored engine list, its responses and
 * its batch bookkeeping all carry the same (current) ids. */
export function currentEngineId(id: string): string {
  let e = getEngine(id);
  const seen = new Set<string>();
  while (e?.successor && !seen.has(e.id)) {
    seen.add(e.id);
    e = getEngine(e.successor);
  }
  return e?.id ?? id;
}

/** Resolve a configured engine list for a new run (order kept, deduped). */
export function currentEngineIds(ids: string[]): string[] {
  return [...new Set(ids.map(currentEngineId))];
}

/** Selectable engines whose vendor key is present in this environment. */
export function availableEngines(): Engine[] {
  return ENGINES.filter((e) => !e.successor && Boolean(process.env[e.keyEnv]));
}

export function engineAvailable(id: string): boolean {
  const e = getEngine(id);
  return Boolean(e && process.env[e.keyEnv]);
}

/** Answering + coding both need OpenAI: it is the fixed extraction coder. */
export function apiKeyConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getProvider(): CompletionProvider {
  return openaiProvider;
}

/** Transport-level spend metering: every vendor call made through these
 * clients appends one ledger row (lib/cost_log.ts), attributed to the
 * active cost context. The subscription never blocks or fails the call. */
function meterOpenAI(c: OpenAI): OpenAI {
  const chat = c.chat.completions;
  const chatCreate = chat.create.bind(chat);
  chat.create = ((body: { model?: string }, opts?: unknown) => {
    const p = chatCreate(body as never, opts as never);
    void (p as Promise<unknown>).then((res) => {
      const u = (res as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
      logCost({
        model: body?.model ?? "unknown",
        inputTokens: u?.prompt_tokens ?? 0,
        outputTokens: u?.completion_tokens ?? 0,
      });
    }, () => {});
    return p;
  }) as unknown as typeof chat.create;
  const responses = c.responses;
  const respCreate = responses.create.bind(responses);
  responses.create = ((body: { model?: string }, opts?: unknown) => {
    const p = respCreate(body as never, opts as never);
    void (p as Promise<unknown>).then((res) => {
      const r = res as {
        usage?: { input_tokens?: number; output_tokens?: number };
        output?: { type: string }[];
      };
      logCost({
        model: body?.model ?? "unknown",
        inputTokens: r?.usage?.input_tokens ?? 0,
        outputTokens: r?.usage?.output_tokens ?? 0,
        searches: (r?.output ?? []).filter((o) => o.type === "web_search_call").length,
      });
    }, () => {});
    return p;
  }) as unknown as typeof responses.create;
  return c;
}

type AnthropicSdk = import("@anthropic-ai/sdk").default;
function meterAnthropic(a: AnthropicSdk): AnthropicSdk {
  const messages = a.messages;
  const create = messages.create.bind(messages);
  messages.create = ((body: { model?: string }, opts?: unknown) => {
    const p = create(body as never, opts as never);
    void (p as Promise<unknown>).then((res) => {
      const u = (res as { usage?: unknown })?.usage as
        | { output_tokens?: number; server_tool_use?: { web_search_requests?: number } }
        | undefined;
      logCost({
        model: body?.model ?? "unknown",
        inputTokens: claudeBilledInput(u),
        outputTokens: u?.output_tokens ?? 0,
        searches: u?.server_tool_use?.web_search_requests ?? 0,
      });
    }, () => {});
    return p;
  }) as unknown as typeof messages.create;
  return a;
}

let _client: OpenAI | null = null;
export function openaiClient(): OpenAI {
  // The SDK default timeout is 600s - a stalled call occupies a request
  // for ten minutes before its retries even start. The slowest legitimate
  // call (the gpt-5 market read) runs ~100-120s; 150s bounds a stall
  // while leaving headroom, and the SDK's retries then get a fresh start.
  if (!_client) _client = meterOpenAI(new OpenAI({ timeout: 150_000, maxRetries: 1 }));
  return _client;
}
const client = openaiClient;

const _compat = new Map<string, OpenAI>();
function compatClient(engine: Engine): OpenAI {
  const key = engine.baseURL ?? "default";
  let c = _compat.get(key);
  if (!c) {
    // Same stall bound as the OpenAI client: the vendor defaults (600s
    // timeout x 2 retries, stacked on our own withRetry) let one wedged
    // Gemini/Grok/Sonar call pin a worker far past a chunk budget.
    c = meterOpenAI(
      new OpenAI({
        apiKey: process.env[engine.keyEnv],
        baseURL: engine.baseURL,
        timeout: 150_000,
        maxRetries: 1,
      })
    );
    _compat.set(key, c);
  }
  return c;
}

/** Metered OpenAI-compatible client for a coder model (engine registry or
 * CODER_ONLY). Discovery and other coder-side callers use this so every
 * vendor call lands in the cost ledger like the rest of the pipeline. */
export function coderCompatClient(model: string): OpenAI {
  const eng = getEngine(model) ?? CODER_ONLY[model];
  return eng?.baseURL ? compatClient(eng as Engine) : client();
}

let _anthropic: import("@anthropic-ai/sdk").default | null = null;
export async function anthropicClient() {
  if (!_anthropic) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    // 180s, not 150: search-tool answers (web_search + 4096 max_tokens)
    // run longer than any OpenAI call we make. Single SDK retry - the
    // engine layer's withRetry already retries transient failures.
    _anthropic = meterAnthropic(new Anthropic({ timeout: 180_000, maxRetries: 1 }));
  }
  return _anthropic;
}

/** Sample one answer from a named engine, the way a consumer assistant
 * would answer it: single turn, no system prompt, fresh session. The finish
 * reason is recorded so truncation is a stored fact, not a guess. Search
 * engines may retrieve mid-answer; how often they chose to is recorded as
 * searchCount (null = the vendor doesn't report it). */
export async function completeWithEngine(
  engineId: string,
  prompt: string,
  opts?: {
    /** Raise the Anthropic output cap for truncation retries; other
     * vendors run at their own intrinsic limits and ignore this. */
    maxTokens?: number;
    /** Per-request deadline override (a long retry generation needs more
     * than the client's stall bound). */
    timeoutMs?: number;
  }
): Promise<{
  text: string;
  finishReason: string | null;
  /** Source URLs for grounded/search answers; null when ungrounded. */
  citations: string[] | null;
  /** Web searches the model chose to run for this answer; 0 = had the tool
   * but answered from weights; null = not reported (instinct engines, and
   * always-grounded vendors like Perplexity). */
  searchCount: number | null;
  /** Vendor-reported token usage for the answer call - the raw material
   * of the staff financials view. null when a vendor omits it. */
  usage: { input: number | null; output: number | null };
}> {
  const engine = getEngine(engineId);
  if (!engine) throw new Error(`unknown engine: ${engineId}`);
  if (!process.env[engine.keyEnv]) {
    throw new Error(`${engine.keyEnv} is not configured for ${engine.label}`);
  }
  const model = engine.apiModel ?? engine.id;
  return withRetry(async () => {
    if (engine.sdk === "anthropic") {
      const a = await anthropicClient();
      const res = await a.messages.create(
        {
        model,
        // 8192, not 4096: the cap is OUR artifact, not assistant reality -
        // 18 of 1,040 Anthropic answers on the jira battery hit 4096 and
        // truncated. Output is billed as generated, so headroom is free.
        max_tokens: opts?.maxTokens ?? 8192,
        messages: [{ role: "user", content: prompt }],
        ...(engine.mode === "search"
          ? {
              tools: [
                // Server-side web search — the model decides per answer
                // whether to use it, mirroring claude.ai's default.
                { type: "web_search_20250305" as const, name: "web_search" as const, max_uses: SEARCH_CAP },
              ],
            }
          : {}),
        },
        opts?.timeoutMs ? { timeout: opts.timeoutMs } : undefined
      );
      const urls = new Set<string>();
      for (const b of res.content) {
        if (b.type !== "text") continue;
        const cites = (b as { citations?: { url?: string }[] }).citations;
        for (const c of cites ?? []) if (c.url) urls.add(c.url);
      }
      const usage = res.usage as unknown as {
        input_tokens?: number;
        output_tokens?: number;
        server_tool_use?: { web_search_requests?: number };
      };
      return {
        usage: { input: usage.input_tokens ?? null, output: usage.output_tokens ?? null },
        text: res.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n"),
        finishReason: res.stop_reason ?? null,
        citations: urls.size > 0 ? [...urls] : null,
        searchCount:
          engine.mode === "search"
            ? usage.server_tool_use?.web_search_requests ?? 0
            : null,
      };
    }
    if (engine.mode === "search" && !engine.baseURL) {
      // OpenAI search variants go through the Responses API — web search is
      // a first-class tool there, with each search recorded in the output.
      const res = await client().responses.create(
        {
          model,
          input: prompt,
          tools: [{ type: "web_search" }],
          // Same bound as Anthropic's max_uses (web_search is the only tool).
          max_tool_calls: SEARCH_CAP,
        } as Parameters<ReturnType<typeof client>["responses"]["create"]>[0],
        // Per-request override: a search answer legitimately runs multiple
        // retrieval rounds (avg 4.4 searches before the cap) - the client's 150s
        // stall bound cut off ~1% of gpt-5-search answers. Only this call
        // gets the long leash; setup and instinct calls keep 150s.
        { timeout: 300_000 }
      );
      const output = (res as unknown as { output?: { type: string; content?: { type: string; annotations?: { type: string; url?: string }[] }[] }[] }).output ?? [];
      const searches = output.filter((i) => i.type === "web_search_call").length;
      const urls = new Set<string>();
      for (const item of output) {
        for (const part of item.content ?? []) {
          for (const ann of part.annotations ?? []) {
            if (ann.type === "url_citation" && ann.url) urls.add(ann.url);
          }
        }
      }
      const r = res as unknown as {
        output_text?: string;
        status?: string;
        incomplete_details?: { reason?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      return {
        usage: { input: r.usage?.input_tokens ?? null, output: r.usage?.output_tokens ?? null },
        text: r.output_text ?? "",
        finishReason:
          r.incomplete_details?.reason ?? (r.status === "completed" ? "stop" : r.status ?? null),
        citations: urls.size > 0 ? [...urls] : null,
        searchCount: searches,
      };
    }
    const c = engine.baseURL ? compatClient(engine) : client();
    const res = await c.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
    });
    // Perplexity attaches the grounded source list as non-standard fields.
    const extra = res as unknown as {
      citations?: string[];
      search_results?: { url?: string }[];
    };
    const citations =
      extra.citations ??
      extra.search_results
        ?.map((r) => r.url)
        .filter((u): u is string => Boolean(u)) ??
      null;
    return {
      usage: {
        input: res.usage?.prompt_tokens ?? null,
        output: res.usage?.completion_tokens ?? null,
      },
      text: res.choices[0]?.message?.content ?? "",
      finishReason: res.choices[0]?.finish_reason ?? null,
      citations: citations && citations.length > 0 ? citations : null,
      searchCount: null,
    };
  });
}

const EXTRACT_MODEL = process.env.EXTRACT_MODEL ?? "gpt-4o-mini";

/** The fixed coder's id — recorded on every response as provenance. */
export function extractModelId(): string {
  return EXTRACT_MODEL;
}

function extractSchema(reasonCodes: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      mentions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            brand: { type: "string" },
            framing: {
              type: "string",
              enum: ["recommended", "mentioned", "negative"],
            },
          },
          required: ["brand", "framing"],
        },
      },
      top_pick_brand: { type: ["string", "null"] },
      ...(isDecompose()
        ? outcomeMode() === "decompose3_split"
          ? {
              q_recommends_any: { type: "boolean" },
              q_default_named: { type: "boolean" },
              q_splits_decision: { type: "boolean" },
              q_asks_and_waits: { type: "boolean" },
            }
          : {
              // Evidence fields come BEFORE the booleans on purpose: strict
              // decoding follows property order, so the quotes are emitted
              // (and attended to) before the verdicts.
              ...(outcomeMode() === "decompose3_evidence"
                ? {
                    advice_evidence: { type: ["string", "null"] },
                    default_evidence: { type: ["string", "null"] },
                  }
                : {}),
              q_recommends_any: { type: "boolean" },
              q_single_direction: { type: "boolean" },
              q_asks_and_waits: { type: "boolean" },
              ...(outcomeMode() === "decompose3_default"
                ? { default_candidate_brand: { type: ["string", "null"] } }
                : {}),
            }
        : {
            outcome: {
              type: "string",
              enum: ["pick", "conditional", "no_pick", "clarification"],
            },
          }),
      reasons: reasonQuotesOn()
        ? {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                code:
                  reasonCodes.length > 0
                    ? { type: "string", enum: reasonCodes }
                    : { type: "string" },
                quote: { type: "string" },
              },
              required: ["code", "quote"],
            },
          }
        : reasonCodes.length > 0
          ? { type: "array", items: { type: "string", enum: reasonCodes } }
          : { type: "array", items: { type: "string" } },
      clarification_requested: { type: "boolean" },
      gives_recommendation: { type: "boolean" },
      includes_prices: { type: "boolean" },
      includes_specs: { type: "boolean" },
    },
    required: [
      "mentions",
      "top_pick_brand",
      ...(isDecompose()
        ? outcomeMode() === "decompose3_split"
          ? ["q_recommends_any", "q_default_named", "q_splits_decision", "q_asks_and_waits"]
          : [
              ...(outcomeMode() === "decompose3_evidence"
                ? ["advice_evidence", "default_evidence"]
                : []),
              "q_recommends_any",
              "q_single_direction",
              "q_asks_and_waits",
              ...(outcomeMode() === "decompose3_default" ? ["default_candidate_brand"] : []),
            ]
        : ["outcome"]),
      "reasons",
      "clarification_requested",
      "gives_recommendation",
      "includes_prices",
      "includes_specs",
    ],
  };
}

/** Derive the outcome from the decompose booleans - by code, so it can
 * never be internally inconsistent or invent a category. */
type DecomposeBooleans = {
  q_recommends_any?: boolean;
  q_single_direction?: boolean;
  q_default_named?: boolean;
  q_splits_decision?: boolean;
  q_asks_and_waits?: boolean;
};

/** The boolean that separates pick from conditional. In split mode a named
 * default wins outright - q_splits_decision exists to force the model to
 * confront the contrast, never to veto a default. */
function singleDirection(q: DecomposeBooleans): boolean {
  return outcomeMode() === "decompose3_split"
    ? Boolean(q.q_default_named)
    : Boolean(q.q_single_direction);
}

function deriveOutcome(q: DecomposeBooleans): ExtractionResult["outcome"] {
  if (!q.q_recommends_any) return q.q_asks_and_waits ? "clarification" : "no_pick";
  return singleDirection(q) ? "pick" : "conditional";
}

/** Flatten quote-required reasons ({code, quote} pairs) back to codes; a
 * pair whose quote is blank earns no code. Raw pairs ride along on the
 * result (as reason_quotes) so the eval can verify quotes offline. */
function flattenReasons(parsed: ExtractionResult): void {
  if (!reasonQuotesOn()) return;
  const raw = (parsed.reasons ?? []) as unknown as { code?: string; quote?: string }[];
  const pairs = raw.filter(
    (e): e is { code: string; quote: string } =>
      Boolean(e && typeof e === "object" && e.code && (e.quote ?? "").trim().length > 0)
  );
  parsed.reasons = [...new Set(pairs.map((p) => p.code))];
  (parsed as ExtractionResult & { reason_quotes?: { code: string; quote: string }[] }).reason_quotes = pairs;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Outcome-mechanism experiment (2026-09-19): "" = classic O-TEST text,
 * "ladder" = ordered stop-at-first-match ladder with cross-category worked
 * examples, "ladder_bare" = the ladder without the examples (isolates the
 * examples' effect), "decompose" = outcome never coded - three booleans,
 * derived by code. Any mode implies v2 framing + hardened reasons. */
const OUTCOME_MODES = [
  "ladder",
  "ladder_bare",
  "decompose",
  "decompose2",
  // decompose3 round (2026-09-20): three independent attacks on the
  // pick->conditional cell (412 of 1,308 decompose2 errors, 265 O-DEFAULT).
  "decompose3_split", // q_single_direction split into default-named vs splits-decision
  "decompose3_tiebreak", // decompose2 + a second reading pass on the boundary cell only
  "decompose3_default", // decompose2 + always-asked default_candidate_brand
  "decompose3_survival", // q_single_direction with hardened survival clause + in-question micro-examples
  "decompose3_evidence", // quote-then-decide: verbatim evidence fields precede the booleans
  "decompose3_fewshot", // decompose2 + ratified precedents as worked cases
  "decompose3_contrast", // decompose2 + balanced near-miss pairs and do-NOT rules
  "decompose3_traps", // decompose2 + named checklist of measured coder mistakes
  "decompose3_summary", // summarize the answer first, then code the summary
] as const;
type OutcomeMode = "" | (typeof OUTCOME_MODES)[number];

function outcomeMode(): OutcomeMode {
  const m = process.env.EXTRACT_OUTCOME_MODE ?? "";
  return (OUTCOME_MODES as readonly string[]).includes(m) ? (m as OutcomeMode) : "";
}

/** decompose3 round: reasons as {code, quote} pairs - a code only counts
 * when the coder can quote the because-clause it argues from. Measured
 * motive: grok fires codes on topic presence (1.78 codes/answer vs the
 * ground truth's 1.22; precision 43.9%). */
function reasonQuotesOn(): boolean {
  return process.env.EXTRACT_REASON_QUOTES === "1";
}

/** Both decompose generations share the boolean schema and derivation. */
function isDecompose(): boolean {
  return outcomeMode().startsWith("decompose");
}

const LADDER_STEPS =
  "outcome — decide this FIRST, by walking these steps IN ORDER and " +
  "stopping at the first match. Decide by what the answer DECIDES - " +
  "never by whether it asks a question: questions at the end change " +
  "nothing at any step.\n" +
  "STEP 1 - Does the answer put forward ANY named product or brand as " +
  "advice (recommend, rank as advice, name a best-for, or tell the " +
  "reader to keep what they have)? Named means a proper noun: generic " +
  "categories ('a premium variety', 'thick-cut chips', 'a 0%-intro " +
  "card', 'a mid-range phone') are NOT product direction, however " +
  "firmly advised.\n" +
  "  NO, and it declines to advise until the reader supplies details " +
  "(it asks and waits) -> 'clarification'. This is rare: the answer " +
  "must offer NO product direction at all.\n" +
  "  NO, and it informs, diagnoses, compares neutrally, or recommends " +
  "only ACTIONS (audit, test-drive, check docs) or playbooks (timing, " +
  "cancellation steps) rather than products -> 'no_pick'. An answer " +
  "that lays out options while championing none is no_pick even when " +
  "the options are described in detail.\n" +
  "STEP 2 - Is exactly ONE product named as what to do - an outright " +
  "pick OR a stated default? A default survives everything that " +
  "follows it: exceptions ('unless you...'), caveats, alternatives " +
  "listed after, and follow-up questions. A #1 in a ranking presented " +
  "as advice for the reader's stated scenario is a default. Advice to " +
  "keep or renew the reader's current product is a pick of that " +
  "product.\n" +
  "  YES -> 'pick'; that product is top_pick.\n" +
  "STEP 3 - Otherwise the answer advises but splits the decision -> " +
  "'conditional'. This covers: branches keyed to the reader's " +
  "situation with no default named, two or more finalists presented " +
  "as equals, and shortlists to pilot or trial.\n";

const LADDER_EXAMPLES =
  "WORKED MICRO-EXAMPLES (imitate the reasoning):\n" +
  "- 'X works best overall for your dip table; keep a small bowl of Y " +
  "for the die-hards.' -> pick (X); the add-on role for Y changes " +
  "nothing (STEP 2).\n" +
  "- 'For your team I'd start with X. If you outgrow it, Y is the " +
  "natural step up. What's your rollout timeline?' -> pick (X); the " +
  "alternative and the trailing question change nothing (STEP 2).\n" +
  "- 'X wins for your situation - one catch: only worth it if you pay " +
  "in full each month.' -> pick (X); an eligibility caveat after a " +
  "stated winner is an exception, not a branch (STEP 2).\n" +
  "- 'If you want the cleaner label, X; if you want the loudest " +
  "flavor, Y.' / 'Three good choices are X, Y and Z - pick whichever " +
  "fits.' -> conditional (STEP 3).\n" +
  "- 'Renewing what you already have is the safest decision here.' -> " +
  "pick (the incumbent) (STEP 2).\n" +
  "- 'Sign up the day the finale drops, cancel immediately, set a " +
  "reminder - here's the step-by-step.' -> no_pick; a thorough " +
  "playbook that champions no product (STEP 1).\n" +
  "- 'The failures you describe are usually account flags - check the " +
  "app, then call the number on your card.' -> no_pick (STEP 1).\n" +
  "- 'Look for scoop-shaped or restaurant-style chips - they hold up " +
  "under toppings.' -> no_pick; generic categories firmly advised, no " +
  "named product (STEP 1).\n" +
  "- 'That depends entirely on your budget and how you'll use it - " +
  "what are they?' with nothing recommended -> clarification " +
  "(STEP 1).\n";

const DECOMPOSE_QUESTIONS =
  "Answer these three questions about the answer FIRST - each is a " +
  "plain reading question; decide by what the answer DECIDES, never " +
  "by whether it asks a question at the end.\n" +
  "q_recommends_any - Does the answer put forward ANY named product " +
  "or brand as advice for the reader (recommend it, rank it as " +
  "advice, call it best-for, or tell the reader to keep what they " +
  "already have)? Named means a proper noun - generic categories ('a " +
  "premium variety', 'a 0%-intro card') are not products, and neither " +
  "are actions (audit, test-drive, check docs) or playbooks (timing, " +
  "cancellation steps).\n" +
  "q_single_direction - Is exactly ONE product named as what the " +
  "reader should do - an outright pick or a stated default? A default " +
  "survives exceptions, caveats, alternatives listed after it, and " +
  "follow-up questions. A #1 in an advice-ranking is a default. Keep " +
  "or renew what you have is a pick of that product.\n" +
  "q_asks_and_waits - Does the answer decline to advise until the " +
  "reader supplies more details - asking and waiting, offering no " +
  "product direction at all in the meantime?\n" +
  "top_pick_brand - ONLY when exactly one product is what to do, its " +
  "name exactly as the answer writes it; otherwise null.\n";

/** decompose2 (grok round, 2026-09-19): the three booleans sharpened
 * against measured failure modes - tail-anchoring (26% phantom-clar with
 * trailing offers), the two-way q1 advice boundary (18 hedged misses + 38
 * over-detections), and 22 missed stated defaults. */
const DECOMPOSE2_QUESTIONS =
  "Answer these three questions about the answer FIRST - each is a " +
  "plain reading question about the WHOLE answer. The evidence may " +
  "appear ANYWHERE - openings and middles count exactly as much as " +
  "endings; a verdict stated early and hedged later still counts.\n" +
  "q_recommends_any - Does the answer put forward ANY named product " +
  "or brand as advice for the reader? Hedged advice counts: 'good " +
  "candidates to check are X and Y', a best-for named mid-answer, a " +
  "ranked list presented as advice, or telling the reader to keep " +
  "what they already have. But DESCRIBING is not advising: a list or " +
  "table of options with strengths and weaknesses, where none is put " +
  "forward for the reader, is 'no'. Named means a proper noun - " +
  "generic categories ('a premium variety', 'a 0%-intro card') are " +
  "not products, and neither are actions (audit, test-drive) or " +
  "playbooks (timing, cancellation steps).\n" +
  "q_single_direction - Is exactly ONE product named as what the " +
  "reader should do - an outright pick or a stated default? A default " +
  "followed by alternatives is still exactly one direction ('start " +
  "with X; Y if you outgrow it' -> yes, X). A default survives " +
  "exceptions, caveats, and follow-up questions. A #1 in an " +
  "advice-ranking is a default. Keep or renew what you have is a pick " +
  "of that product.\n" +
  "q_asks_and_waits - Does the answer give NO direction and ONLY ask " +
  "for details? An offer to help further AFTER giving information or " +
  "advice ('tell me your setup and I'll narrow it down', 'want me to " +
  "compare these?') is NOT asking-and-waiting - answer 'no' for " +
  "those. 'Yes' is rare: the answer must advise nothing and only " +
  "ask.\n" +
  "top_pick_brand - ONLY when exactly one product is what to do, its " +
  "name exactly as the answer writes it; otherwise null.\n";

/** decompose3_split (2026-09-20, h1): q_single_direction asked grok to
 * count directions, and 'exactly ONE' misfires when a default is followed
 * by named alternatives - 265 of the 412 pick->conditional misses were
 * O-DEFAULT. Split the compound question into its two halves and let a
 * named default win by derivation. */
const DECOMPOSE3_SPLIT_QUESTIONS =
  "Answer these four questions about the answer FIRST - each is a " +
  "plain reading question about the WHOLE answer. The evidence may " +
  "appear ANYWHERE - openings and middles count exactly as much as " +
  "endings; a verdict stated early and hedged later still counts.\n" +
  "q_recommends_any - Does the answer put forward ANY named product " +
  "or brand as advice for the reader? Hedged advice counts: 'good " +
  "candidates to check are X and Y', a best-for named mid-answer, a " +
  "ranked list presented as advice, or telling the reader to keep " +
  "what they already have. But DESCRIBING is not advising: a list or " +
  "table of options with strengths and weaknesses, where none is put " +
  "forward for the reader, is 'no'. Named means a proper noun - " +
  "generic categories ('a premium variety', 'a 0%-intro card') are " +
  "not products, and neither are actions (audit, test-drive) or " +
  "playbooks (timing, cancellation steps).\n" +
  "q_default_named - Does the answer put ONE product first - a " +
  "default, first choice, or starting recommendation? Count a " +
  "default stated anywhere and however phrased: 'start with X', 'X " +
  "is the safest bet', 'I'd go with X', a #1 in a ranking presented " +
  "as advice, or advice to keep what the reader already has. A " +
  "default REMAINS the default when it is followed by alternatives " +
  "('start with X; Y if you outgrow it'), exceptions ('unless " +
  "you...'), caveats, or follow-up questions - none of those take it " +
  "away. Answer 'no' only when NO single product is put first.\n" +
  "q_splits_decision - Does the answer leave the choice split: two " +
  "or more finalists treated as equals, or branches keyed to the " +
  "reader's situation ('X if ..., Y if ...') with NO product put " +
  "first? If any single product is put first, answer 'no' even when " +
  "branches follow it.\n" +
  "q_asks_and_waits - Does the answer give NO direction and ONLY ask " +
  "for details? An offer to help further AFTER giving information or " +
  "advice ('tell me your setup and I'll narrow it down', 'want me to " +
  "compare these?') is NOT asking-and-waiting - answer 'no' for " +
  "those. 'Yes' is rare: the answer must advise nothing and only " +
  "ask.\n" +
  "top_pick_brand - ONLY when one product is put first, its name " +
  "exactly as the answer writes it; otherwise null.\n";

/** decompose3_default (2026-09-20, h4): decompose2 unchanged, plus an
 * always-asked default-candidate field. Derivation turns a conditional
 * with a confident candidate into a pick of that candidate. */
const DECOMPOSE3_DEFAULT_EXTRA =
  "default_candidate_brand - EVEN when more than one product is " +
  "advised: the single product the answer most treats as its default " +
  "or first choice - the one it would start this reader on ('start " +
  "with X', 'X is the safest bet', a #1 in a ranking presented as " +
  "advice), named exactly as the answer writes it. null when the " +
  "answer genuinely treats its finalists as equals, or advises " +
  "none.\n";

/** decompose3_survival (2026-09-20, rung 2 of the stated-default round):
 * decompose2 with only q_single_direction rewritten - hardened survival
 * clause plus worked micro-examples inside the question, built from the
 * measured miss taxonomy (178 trailing if/unless, 100 best-overall labels,
 * 32 keep/renew, 15 rankings among the 412 pick->conditional misses). */
const DECOMPOSE3_SURVIVAL_Q2 =
  "q_single_direction - Is exactly ONE product named as what the " +
  "reader should do - an outright pick or a stated default? A default " +
  "SURVIVES everything that trails or surrounds it: alternatives " +
  "listed after it, 'if you...' branches, 'unless' exceptions, " +
  "caveats, comparisons, and follow-up questions - none of them take " +
  "the default away. A #1 or 'Best Overall' in a ranking presented as " +
  "advice is a default. Advice to keep or renew what the reader " +
  "already has is a pick of that product. Worked examples:\n" +
  "  'Start with X. If you outgrow it, Y is the natural step up.' -> " +
  "yes (X): the branch to Y does not remove the default.\n" +
  "  'X (Best Overall for your case). Y (Best for tight budgets).' - " +
  "a labeled ranking presented as advice -> yes (X).\n" +
  "  'Keep X; only consider switching if the audit fails.' -> yes " +
  "(X, the incumbent).\n" +
  "  'X if you want simplicity, Y if you need power', with NO " +
  "product put first -> no: branches with no stated default split " +
  "the decision.\n";

const DECOMPOSE3_SURVIVAL_QUESTIONS = DECOMPOSE2_QUESTIONS.replace(
  /q_single_direction - [\s\S]*?(?=q_asks_and_waits - )/,
  DECOMPOSE3_SURVIVAL_Q2
);

/** decompose3_evidence (2026-09-20): quote-then-decide. Strict JSON gives
 * the coder no reasoning space, and the q1 miss taxonomy shows two-sided
 * boundary noise (326 under-reads of hedged/branch advice, 435 over-reads
 * of playbooks/pricing/diagnostics). Two verbatim evidence fields precede
 * the booleans so the verdicts must point at a sentence. */
const DECOMPOSE3_EVIDENCE_PREFIX =
  "Collect evidence FIRST - two verbatim quotes - then answer the " +
  "questions from that evidence.\n" +
  "advice_evidence - quote VERBATIM (max 200 chars) the single " +
  "sentence that most clearly puts a named product or brand forward " +
  "as advice for THIS reader. Hedged advice counts ('good candidates " +
  "to check are X and Y', 'X is worth a look for your case'), branch " +
  "advice counts ('use X if you need deep customization'), and so " +
  "does advice to keep what the reader already has. null when NO " +
  "sentence advises: describing, comparing, pricing, diagnosing, or " +
  "walking through steps is not advising, and a product named inside " +
  "an explanation ('the culprit is usually configuration, not X " +
  "being bad') is not being advised.\n" +
  "default_evidence - quote VERBATIM the sentence that puts exactly " +
  "ONE product first: a stated default, 'start with X', a #1 or Best " +
  "Overall presented as advice, or keep-what-you-have. null when no " +
  "single product is put first.\n" +
  "Answer in AGREEMENT with your evidence: q_recommends_any is yes " +
  "only when advice_evidence is non-null; q_single_direction is yes " +
  "only when default_evidence is non-null.\n";

/** decompose3_fewshot (2026-09-20): decompose2 plus PRECEDENTS - worked
 * cases drawn from the human-ratified reference set, chosen from rows that
 * three or more bakeoff coder configs missed. The error-overlap diagnostic
 * showed grok's residual errors are shared difficulty, not model noise:
 * the codebook's distinctions did not transfer as rule text, so transfer
 * them as cases. Quotes are verbatim from ratified rows. */
const DECOMPOSE3_PRECEDENTS =
  "PRECEDENTS - ratified codings of real cases. Apply the same " +
  "reasoning; the quote is the decisive sentence of a longer answer.\n" +
  "- 'Default safe choice: Renew Jira for 12 months' -> " +
  "recommends yes, single direction yes (Jira). Renewing or keeping " +
  "what the reader has is a pick of that product.\n" +
  "- 'You can usually get 60-80% of the benefit you want from Jira " +
  "by auditing and simplifying' -> recommends yes, single direction " +
  "yes (Jira). Fix-in-place advice champions the incumbent - that is " +
  "product direction, not a mere playbook.\n" +
  "- 'For engineering-heavy backlogs with scaled delivery, choose " +
  "Jira', where the reader described exactly that situation -> " +
  "recommends yes, single direction yes (Jira). A branch whose " +
  "condition matches the reader's stated case is a pick, not a " +
  "split.\n" +
  "- 'Best-in-class if you're coming from another Jira instance' " +
  "alongside other best-ifs, none put first -> recommends yes, " +
  "single direction no. Hedged best-if branches are still advice - " +
  "never 'describing only'.\n" +
  "- 'Three platforms with the strongest, most battle-tested " +
  "migration paths' (a championed shortlist) -> recommends yes, " +
  "single direction no. Championing a shortlist is advice even with " +
  "no winner named.\n" +
  "- 'I can recommend the single best fit and outline a short " +
  "migration plan' after presenting options -> recommends yes, " +
  "single direction no, asks-and-waits no. An offer to narrow later " +
  "does not erase the advice already given.\n" +
  "- 'Jira is still the default for large enterprises and teams that " +
  "need deep workflow customization' in a neutral market overview -> " +
  "recommends no. Market-position language ('the default', 'industry " +
  "standard') describes the market, it does not advise the reader.\n" +
  "- A diagnosis ending 'tell me which tool (Jira Cloud/Data Center, " +
  "Azure DevOps, etc.) and I can tailor this' -> recommends no, " +
  "asks-and-waits no (information was already given). Products named " +
  "inside a question or an explanation are not being advised.\n";

/** decompose3_contrast (2026-09-21): every earlier variant pushed the
 * boundary from one side and traded cells. These are balanced near-miss
 * PAIRS - both sides of each failing boundary, plus do-NOT rules mined
 * from the giveback cells. */
const DECOMPOSE3_CONTRAST =
  "CONTRAST PAIRS - near-identical cases whose codings differ; the one " +
  "stated difference decides. Apply the same distinctions.\n" +
  "PAIR A (default vs split):\n" +
  "- 'Start with X. If you outgrow it, Y is the natural step up.' -> " +
  "q_single_direction YES (X is put first; the branch does not remove " +
  "it).\n" +
  "- 'X if you want simplicity; Y if you need power.' -> " +
  "q_single_direction NO (branches only; nothing put first).\n" +
  "The difference: is one product put first BEFORE the branching, or " +
  "is branching all there is?\n" +
  "PAIR B (labeled winner vs labeled shortlist):\n" +
  "- 'X (Best Overall). Y (Best for tight budgets).' -> " +
  "q_single_direction YES (a Best-Overall label puts X first).\n" +
  "- '1) X - best for enterprises. 2) Y - best for startups. 3) Z - " +
  "best for solo use.', no overall winner -> q_single_direction NO " +
  "(best-fors only; no product put first).\n" +
  "PAIR C (hedged advice vs description):\n" +
  "- 'The extra $75/month for X Premium is likely worth it for a team " +
  "your size.' -> q_recommends_any YES (hedged advice is advice).\n" +
  "- 'X Premium costs an extra $75/month and includes a 12,000-run " +
  "pool.' -> q_recommends_any NO (pricing facts; no direction).\n" +
  "PAIR D (fix-in-place advice vs diagnosis that names brands):\n" +
  "- 'Most teams solve this without leaving X - audit your workflows " +
  "first.' -> q_recommends_any YES (keep-what-you-have direction).\n" +
  "- 'The culprit is usually configuration, not X being bad at scale " +
  "- here is the audit checklist.' -> q_recommends_any NO (diagnosis " +
  "and playbook; X is named only inside the explanation).\n" +
  "DO NOT rules (each is a measured coder mistake):\n" +
  "- Do NOT answer q_single_direction 'no' merely because " +
  "alternatives, exceptions, caveats or questions follow a stated " +
  "default.\n" +
  "- Do NOT answer q_recommends_any 'yes' merely because brands are " +
  "named inside explanations, pricing, tables, or how-to steps.\n" +
  "- Do NOT answer q_recommends_any 'no' merely because the advice is " +
  "hedged ('likely worth it', 'good candidates') or split into " +
  "branches.\n";

/** decompose3_traps (2026-09-21): the same failure knowledge delivered as
 * a named checklist of the coder's measured mistake patterns, to prime
 * self-checking rather than teach by pairs. */
const DECOMPOSE3_TRAPS =
  "KNOWN CODING TRAPS - the measured mistake patterns of coders on " +
  "this task. Check every headline against the answer BEFORE " +
  "answering the questions.\n" +
  "- STATED DEFAULT, THEN BRANCHES: a default followed by 'if you " +
  "outgrow it...', 'unless...', caveats, alternatives, or questions " +
  "is still exactly one direction. Trap: coding it as split.\n" +
  "- BEST OVERALL LABEL: a #1, 'Best Overall', or 'top pick' in a " +
  "ranking presented as advice puts that product first. Trap: " +
  "reading the ranking as a neutral list.\n" +
  "- KEEP OR RENEW: advice to stay with, renew, or fix the reader's " +
  "current product is a pick of that product. Trap: coding it as no " +
  "advice.\n" +
  "- HEDGED TIER ADVICE: 'likely worth it', 'worth the upgrade for " +
  "your size', 'good candidates to check' is advice. Trap: reading " +
  "hedges as description.\n" +
  "- BEST-FOR SHORTLIST: options each championed for a situation " +
  "('Best for: ...') are advice that splits the decision. Trap: " +
  "coding the set as a neutral comparison.\n" +
  "- PLAYBOOK WITH BRAND NAMES: steps, audits, pricing math, and " +
  "diagnoses that merely name products are NOT advice. Trap: " +
  "crowning a brand named inside an explanation.\n" +
  "- MARKET-POSITION LANGUAGE: 'the industry standard', 'still the " +
  "default for large enterprises' describes the market, not the " +
  "reader's direction. Trap: reading it as a recommendation.\n";

/** decompose3_summary (2026-09-21): normalize before judging - a first
 * call rewrites the answer as a structured brief (brands, advice
 * structure, questions), and the coding questions run on the brief.
 * Stays blind: the summary prompt never names the study's focus brand. */
const SUMMARY_SYSTEM =
  "Rewrite the following AI assistant answer as a compact structured " +
  "brief for a coder. Include exactly three sections:\n" +
  "BRANDS: every company, brand, product, or service named, in order " +
  "of first appearance, including ones named only as integrations - " +
  "copy each name exactly as written.\n" +
  "ADVICE: what the answer tells the reader to do - which products " +
  "(if any) it puts forward as advice and how strongly; whether any " +
  "single product is put first as a default or first choice, and " +
  "which; what branches, conditions, caveats, or alternatives " +
  "surround the advice; or state plainly that it only informs, " +
  "diagnoses, compares, or instructs without advising any product. " +
  "Preserve hedging verbs exactly ('likely worth it', 'best for', " +
  "'start with').\n" +
  "QUESTIONS: copy verbatim any question the answer asks the reader, " +
  "or write 'none'. Nothing else in this section.\n" +
  "Max 250 words. Report only what the answer says; add nothing, and " +
  "never repeat wording from these instructions.";

/** decompose3_tiebreak (2026-09-20, h3): the entire pick->conditional gap
 * lives in one boolean, so re-ask only that boolean, only on the boundary
 * cell (q_recommends_any && !q_single_direction, ~34% of answers). */
const TIEBREAK_SYSTEM =
  "You are re-checking one reading question about an AI assistant " +
  "answer. The answer advises on products, and a first read said it " +
  "splits the decision among several. Re-read the WHOLE answer and " +
  "decide: is any SINGLE named product the answer's first choice, " +
  "default, or starting recommendation - even with branches, " +
  "alternatives, caveats, or follow-up questions after it? 'Start " +
  "with X; Y if you outgrow it' means X is the default. A #1 in a " +
  "ranking presented as advice is a default. Advice to keep what the " +
  "reader already has is a default (that product). Two or more " +
  "finalists treated as equals, or branches keyed to the reader's " +
  "situation with no product put first, mean NO default. " +
  "default_brand: the default's name exactly as the answer writes " +
  "it, or null.";

/** Framing rules, v1 (shipped Aug 2026) vs v2 (the ratified codebook,
 * 2026-09-18: direction test, branch verbs, market descriptors, reported
 * claims, net-caveat, incumbent defense - category-agnostic by design).
 * EXTRACT_PROMPT_V2 selects; the A/B control runs both on fixed answers. */
function framingRules(): string {
  if (!process.env.EXTRACT_PROMPT_V2 && !outcomeMode()) {
    return (
      "framing per mention — 'recommended' only when the answer " +
      "endorses it for the reader's situation (a pick, a 'best for " +
      "you', a clear favourable ranking). 'negative' when criticized, " +
      "warned about, or advised against — including a caveat like " +
      "'powerful but too heavy for a small team'. 'mentioned' when it " +
      "is merely listed, compared factually, or named as an " +
      "integration. Being included in a list is NOT an endorsement.\n"
    );
  }
  return (
    "framing per mention — decide by DIRECTION, not enthusiasm.\n" +
    "  'recommended' ONLY when the answer points THIS reader toward " +
    "the brand: an outright pick, a stated default, a 'best for your " +
    "situation', the top of a ranking presented as advice — or a " +
    "conditional branch with a strong directive verb ('X is your best " +
    "bet if you're on a tight budget'): branch advice is still advice. " +
    "When the answer's operative advice is to KEEP or renew something " +
    "the reader already uses, that incumbent is recommended even " +
    "without superlatives.\n" +
    "  'mentioned' when listed, compared factually, or named as an " +
    "adjacent product. ALSO mentioned: praise with no direction (a " +
    "glowing description that never tells the reader what to do), " +
    "market-position superlatives ('the industry standard') not tied " +
    "to advice, weak-verb hedges ('worth considering', 'worth a " +
    "look'), and REPORTED opinions ('often recommended', 'has a " +
    "reputation for being clunky') — attributing a view to others is " +
    "not the answer's own verdict, in either direction.\n" +
    "  'negative' when the answer itself criticizes, warns, or steers " +
    "away — including a caveat that disqualifies the brand for THIS " +
    "reader's stated situation ('powerful, but too heavy for a team " +
    "your size'). A caveat inside a standing endorsement does NOT " +
    "flip it: 'X wins for you, though budget for the learning curve' " +
    "stays recommended — the reader is still being sent to X.\n"
  );
}

/** Reasons rule: v2 requires the answer to ARGUE FROM the attribute. */
function reasonsRule(): string {
  if (outcomeMode()) {
    return (
      "reasons — assign a code ONLY where the answer argues FROM that " +
      "attribute — the attribute must carry a 'because' that justifies " +
      "recommending or warning ('X wins because its automation holds up " +
      "at scale' -> automation capabilities). A feature table row, a " +
      "spec listed without judgement, or a capability named in passing " +
      "carries no code. Most answers earn 1-4 codes; more than 6 is " +
      "almost always over-coded.\n" +
      (reasonQuotesOn()
        ? "For each code, quote VERBATIM (max 200 chars) the sentence " +
          "where the answer argues from that attribute - the quote must " +
          "contain the because-clause that justifies recommending or " +
          "warning. If no sentence in the answer qualifies, the code is " +
          "not assigned. A quote that merely names the topic (a feature " +
          "list row, a spec) does not qualify.\n"
        : "")
    );
  }
  if (!process.env.EXTRACT_PROMPT_V2) {
    return "reasons — which allowed argument codes the answer uses.\n";
  }
  return (
    "reasons — the allowed argument codes the answer actually ARGUES " +
    "FROM to justify a recommendation or a warning — never codes whose " +
    "topic merely appears. An attribute named in passing that supports " +
    "no judgement gets no code.\n"
  );
}

function reasonDefinitionsBlock(ctx: ExtractionContext): string {
  const defs = ctx.reasonDefinitions;
  if (!defs) return "";
  const lines = ctx.reasonCodes.filter((c) => defs[c]).map((c) => `- ${c}: ${defs[c]}`);
  if (lines.length === 0) return "";
  return (
    "Allowed reason codes - each code covers everything in its " +
    "definition; use the most specific code that applies:\n" +
    lines.join("\n") +
    "\n"
  );
}

/** One instruction set, whichever vendor codes — so a coder swap changes
 * the model and nothing else. */
function codingInstructions(ctx: ExtractionContext): string {
  const mode = outcomeMode();
  const outcomeSection =
    mode === "decompose3_split"
      ? DECOMPOSE3_SPLIT_QUESTIONS
      : mode === "decompose3_default"
        ? DECOMPOSE2_QUESTIONS + DECOMPOSE3_DEFAULT_EXTRA
        : mode === "decompose3_survival"
          ? DECOMPOSE3_SURVIVAL_QUESTIONS
          : mode === "decompose3_evidence"
            ? DECOMPOSE3_EVIDENCE_PREFIX + DECOMPOSE2_QUESTIONS
            : mode === "decompose3_fewshot"
              ? DECOMPOSE2_QUESTIONS + DECOMPOSE3_PRECEDENTS
              : mode === "decompose3_contrast"
                ? DECOMPOSE2_QUESTIONS + DECOMPOSE3_CONTRAST
                : mode === "decompose3_traps"
                  ? DECOMPOSE2_QUESTIONS + DECOMPOSE3_TRAPS
                  : mode === "decompose2" ||
                      mode === "decompose3_tiebreak" ||
                      mode === "decompose3_summary"
                    ? DECOMPOSE2_QUESTIONS
          : mode === "decompose"
            ? DECOMPOSE_QUESTIONS
            : mode === "ladder"
              ? LADDER_STEPS + LADDER_EXAMPLES
              : mode === "ladder_bare"
                ? LADDER_STEPS
                : "";
  return (
    "You are coding one AI assistant answer for a brand study. Be " +
    "literal: code only what the text says.\n\n" +
    // Experiment modes decide outcome (or its booleans) FIRST.
    outcomeSection +
    "mentions — every company, brand, product, or service named, in " +
    "order of first appearance, including ones named only as " +
    "integrations or adjacent tools. Completeness matters; relevance " +
    "is decided later. ONLY proper-noun names: a generic descriptor " +
    "('a self-hosted server', 'open-source tools', 'spreadsheets') is " +
    "never a mention. A phrase naming several brands is one mention " +
    "PER brand. Name the PRODUCT, not its parts: a feature, module, " +
    "view, add-on, edition, or pricing tier of a product is coded as " +
    "that product itself, so a product, its board view, and its " +
    "enterprise edition are all the SAME one name, recorded once. A " +
    "bare feature fragment with no brand attached is omitted.\n" +
    framingRules() +
    (mode !== "" ? "" :
    "outcome — exactly one of four. Decide by what the answer DECIDES, " +
    "never by whether it asks a question at the end.\n" +
    "  THE TEST — apply it literally, do not weigh emphasis or tone: " +
    "could a reader who saw ONLY this answer act on it right now and buy " +
    "ONE named product, WITHOUT first having to decide something about " +
    "their own situation (their size, budget, stack, or scale)?\n" +
    "  YES, one product is named as what to do → 'pick'. This holds even " +
    "when the answer then lists alternatives, adds caveats, or asks a " +
    "follow-up question. A stated default with exceptions after it is a " +
    "pick, and the default is the top_pick.\n" +
    "  NO, the reader must first classify themselves before the answer " +
    "tells them what to buy → 'conditional'. Branches with no stated " +
    "default ('X for enterprises, Y for startups'), or two finalists " +
    "presented as equals, are conditional.\n" +
    "  NO, and the answer names no way forward at all until the reader " +
    "supplies details → 'clarification'. Nothing ranked, no shortlist.\n" +
    "  NO, and it lays out options while recommending none and routing " +
    "to none → 'no_pick'.\n" +
    "  A long or enthusiastic write-up is not by itself a pick: if the " +
    "answer never says what to do, the test fails.\n") +
    (isDecompose() ? "" :
    "top_pick_brand — the ONE brand that leads. MUST be null unless " +
    "outcome is 'pick', and MUST be a single brand name written exactly " +
    "as the answer writes it — never two names joined by 'or', '+', '/' " +
    "or a parenthetical. If the answer genuinely leads with two, that " +
    "is 'conditional', not a pick.\n") +
    reasonsRule() +
    reasonDefinitionsBlock(ctx) +
    "clarification_requested — independent of outcome: true whenever " +
    "the answer asks the reader any question, including when it has " +
    "already recommended something.\n" +
    "gives_recommendation — does it recommend at least one option?\n" +
    "includes_prices — true ONLY if an actual figure appears (a " +
    "number with a currency or a per-seat/per-month rate). 'Pricing " +
    "varies' or 'it is expensive' is false.\n" +
    "includes_specs — true ONLY if concrete numeric limits or " +
    "quantities appear (storage, seats, API limits, versions). " +
    "Feature names without numbers are false.\n" +
    `Known brands (extract others too): ${ctx.knownBrands.join(", ")}.`
  );
}

/** Anthropic call that pins temperature 0 but survives models that
 * reject the parameter ("temperature is deprecated for this model",
 * e.g. claude-sonnet-5): retry once without it. Determinism where the
 * model allows it, graceful default where it does not. */
async function anthropicCreateT0(
  a: AnthropicSdk,
  params: Record<string, unknown>,
  opts?: { timeout?: number }
): Promise<import("@anthropic-ai/sdk").default.Message> {
  try {
    return (await a.messages.create({ ...params, temperature: 0 } as never, opts as never)) as never;
  } catch (err) {
    if (/temperature.{0,30}deprecated/i.test(String(err))) {
      return (await a.messages.create(params as never, opts as never)) as never;
    }
    throw err;
  }
}

/** Billed-equivalent input tokens under Anthropic prompt caching. */
function claudeBilledInput(u: unknown): number {
  const x = (u ?? {}) as { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  return Math.round((x.input_tokens ?? 0) + (x.cache_creation_input_tokens ?? 0) * 1.25 + (x.cache_read_input_tokens ?? 0) * 0.1);
}

/** Claude as the extraction coder: a forced tool call is Anthropic's
 * equivalent of structured outputs. */
async function codeWithClaude(
  responseText: string,
  ctx: ExtractionContext,
  model: string,
  skipFocus?: boolean
): Promise<ExtractionResult> {
  const a = await anthropicClient();
  const schema = extractSchema(ctx.reasonCodes);
  const res = await anthropicCreateT0(a, {
    model,
    max_tokens: 2000,
    // The instructions are identical for every answer in a run, so cache
    // them: first call writes (1.25x input), the other ~419 read at 0.1x.
    // Covers the tools + system prefix. No-op below Anthropic's minimum
    // cacheable length (1,024 tokens on Sonnet), so it can never hurt.
    system: [
      {
        type: "text",
        text: codingInstructions(ctx),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "emit_coding",
        description: "Return the coding for this answer.",
        input_schema: schema as unknown as { type: "object" },
      },
    ],
    tool_choice: { type: "tool", name: "emit_coding" },
    messages: [{ role: "user", content: responseText }],
  });
  ctx.usageSink?.(model, claudeBilledInput(res.usage), (res.usage as { output_tokens?: number }).output_tokens ?? 0);
  const block = res.content.find((b) => b.type === "tool_use");
  const parsed = (block && "input" in block ? block.input : {}) as ExtractionResult;
  const pick =
    parsed.top_pick_brand &&
    !/^(null|none|n\/a|no pick|no_pick)$/i.test(parsed.top_pick_brand.trim())
      ? parsed.top_pick_brand
      : null;
  // The focus read stays a separate, later call here too.
  let focusQuote: string | null = null;
  let focusInterpretation: string | null = null;
  try {
    if (skipFocus) throw new Error("skip");
    const f = await anthropicCreateT0(a, {
      model,
      max_tokens: 400,
      system:
        `Read this AI assistant answer and report how it treats "${ctx.targetBrand}".`,
      tools: [
        {
          name: "emit_focus",
          description: "Return the focus read.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              focus_quote: { type: ["string", "null"] },
              focus_interpretation: { type: ["string", "null"] },
            },
            required: ["focus_quote", "focus_interpretation"],
          } as unknown as { type: "object" },
        },
      ],
      tool_choice: { type: "tool", name: "emit_focus" },
      messages: [{ role: "user", content: responseText }],
    });
    ctx.usageSink?.(model, claudeBilledInput(f.usage), (f.usage as { output_tokens?: number }).output_tokens ?? 0);
    const fb = f.content.find((b) => b.type === "tool_use");
    const fp = (fb && "input" in fb ? fb.input : {}) as {
      focus_quote?: string | null;
      focus_interpretation?: string | null;
    };
    focusQuote = fp.focus_quote ?? null;
    focusInterpretation = fp.focus_interpretation ?? null;
  } catch {
    // Quotes are optional; the coding is not.
  }
  if (isDecompose()) {
    const q = parsed as unknown as DecomposeBooleans;
    parsed.outcome = deriveOutcome(q);
    if (!singleDirection(q)) parsed.top_pick_brand = null;
  }
  flattenReasons(parsed);
  const cwcMentions = dedupeMentions(
    // Boundary validation: a mention must appear token-bounded in the
    // answer ("Marvel" inside "Marvelous" is not a mention).
    (parsed.mentions ?? []).filter((m) => nameAppearsBounded(responseText, m.brand, new Set(ctx.knownBrands.map((b) => b.trim().toLowerCase()))))
  );
  // Anthropic forced-tool calls do not hard-enforce enum constraints the
  // way OpenAI structured outputs do - invented reason codes slip through
  // (caught in the Phase 2 examples). Validate against the taxonomy here.
  const allowed = new Set(ctx.reasonCodes);
  return {
    ...parsed,
    top_pick_brand: parsed.outcome === "pick" ? pick : null,
    mentions: cwcMentions,
    total_recommendations: recommendedCount(cwcMentions),
    reasons: [...new Set(parsed.reasons ?? [])].filter((r) => allowed.size === 0 || allowed.has(r)),
    focus_quote: focusQuote,
    focus_interpretation: focusInterpretation,
  };
}

/** OpenAI-compatible twin of anthropicCreateT0: pin temperature 0, but
 * survive models that reject the parameter (gpt-5 family: "'temperature'
 * does not support 0 with this model") by retrying without it. */
async function openaiCreateT0(
  c: ReturnType<typeof client>,
  params: Omit<Parameters<typeof c.chat.completions.create>[0], "temperature">
): Promise<import("openai/resources/chat/completions").ChatCompletion> {
  try {
    return (await c.chat.completions.create({ ...params, temperature: 0 } as never)) as never;
  } catch (err) {
    if (/temperature.{0,60}(does not support|unsupported)/i.test(String(err))) {
      return (await c.chat.completions.create(params as never)) as never;
    }
    throw err;
  }
}

const openaiProvider: CompletionProvider = {
  async complete(prompt, model) {
    return withRetry(async () => {
      const res = await client().chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
      });
      return res.choices[0]?.message?.content ?? "";
    });
  },

  async extractCoding(responseText, ctx, model, skipFocus) {
    const coder = model ?? EXTRACT_MODEL;
    if (coder.startsWith("claude")) {
      return codeWithClaude(responseText, ctx, coder, skipFocus);
    }
    // A coder that lives in the engine registry with its own baseURL
    // (grok, gemini) talks to ITS vendor; anything else is an OpenAI model.
    // CODER_ONLY covers models used exclusively as extraction coders - they
    // never appear in engine pickers, so they don't belong in ENGINES.
    const coderEngine = getEngine(coder) ?? CODER_ONLY[coder];
    const c = coderEngine?.baseURL ? compatClient(coderEngine as Engine) : client();
    return withRetry(async () => {
      // decompose3_summary: normalize first - the coding questions then run
      // on the structured brief instead of the raw answer.
      let codingText = responseText;
      if (outcomeMode() === "decompose3_summary") {
        const s = await openaiCreateT0(c, {
          model: coder,
          max_tokens: 450,
          messages: [
            { role: "system", content: SUMMARY_SYSTEM },
            { role: "user", content: responseText },
          ],
        });
        ctx.usageSink?.(coder, s.usage?.prompt_tokens ?? 0, s.usage?.completion_tokens ?? 0);
        codingText = s.choices[0]?.message?.content?.trim() || responseText;
      }
      const res = await openaiCreateT0(c, {
        model: coder,
        messages: [
          {
            role: "system",
            content:
              // Deliberately blind: naming the study's focus brand here made
              // the coder crown it — measured at 28% of picks moving when the
              // focus changed. This pass never learns whose study it is.
codingInstructions(ctx),
          },
          { role: "user", content: codingText },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "answer_coding",
            strict: true,
            schema: extractSchema(ctx.reasonCodes),
          },
        },
      });
      ctx.usageSink?.(coder, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0);
      const raw = res.choices[0]?.message?.content ?? "{}";
      if (process.env.EXTRACT_DEBUG_RAW === "1") console.error("RAW:", raw);
      const parsed = JSON.parse(raw) as ExtractionResult;
      if (outcomeMode() === "decompose3_summary") {
        // Ride along so the eval can audit what the coder actually judged.
        (parsed as unknown as { summary_text?: string }).summary_text = codingText;
      }
      // The focus brand is needed only for the quote fields, so it is asked
      // for in its own call — after the judgement calls are already made.
      let focusQuote: string | null = null;
      let focusInterpretation: string | null = null;
      try {
        if (skipFocus) throw new Error("skip");
        const f = await openaiCreateT0(c, {
          model: coder,
          messages: [
            {
              role: "system",
              content:
                `Read this AI assistant answer and report how it treats ` +
                `"${ctx.targetBrand}". focus_quote: one verbatim sentence ` +
                `(max 200 chars) about that brand, or null if it never ` +
                `appears. focus_interpretation: one plain sentence on how the ` +
                `answer positions it, or null if absent. Quote exactly.`,
            },
            { role: "user", content: responseText },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "focus_read",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  focus_quote: { type: ["string", "null"] },
                  focus_interpretation: { type: ["string", "null"] },
                },
                required: ["focus_quote", "focus_interpretation"],
              },
            },
          },
        });
        ctx.usageSink?.(coder, f.usage?.prompt_tokens ?? 0, f.usage?.completion_tokens ?? 0);
        const fp = JSON.parse(f.choices[0]?.message?.content ?? "{}");
        focusQuote = fp.focus_quote ?? null;
        focusInterpretation = fp.focus_interpretation ?? null;
      } catch {
        // A failed focus read costs quotes, never the coding itself.
      }
      const realBrand = (b: string | null | undefined) =>
        b && !/^(null|none|n\/a|no pick|no_pick)$/i.test(b.trim()) ? b : null;
      if (isDecompose()) {
        const q = parsed as unknown as DecomposeBooleans;
        parsed.outcome = deriveOutcome(q);
        if (!singleDirection(q)) parsed.top_pick_brand = null;
        // decompose3 overrides live on this path only - grok is the sole
        // coder under test; the Claude path derives but never overrides.
        if (outcomeMode() === "decompose3_default" && parsed.outcome === "conditional") {
          const cand = realBrand(
            (parsed as unknown as { default_candidate_brand?: string | null })
              .default_candidate_brand
          );
          if (cand) {
            parsed.outcome = "pick";
            parsed.top_pick_brand = cand;
          }
        }
        if (outcomeMode() === "decompose3_tiebreak" && parsed.outcome === "conditional") {
          const tb = await openaiCreateT0(c, {
            model: coder,
            messages: [
              { role: "system", content: TIEBREAK_SYSTEM },
              { role: "user", content: responseText },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "default_check",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    has_default: { type: "boolean" },
                    default_brand: { type: ["string", "null"] },
                  },
                  required: ["has_default", "default_brand"],
                },
              },
            },
          });
          ctx.usageSink?.(coder, tb.usage?.prompt_tokens ?? 0, tb.usage?.completion_tokens ?? 0);
          const tbp = JSON.parse(tb.choices[0]?.message?.content ?? "{}") as {
            has_default?: boolean;
            default_brand?: string | null;
          };
          const tbBrand = realBrand(tbp.default_brand);
          if (tbp.has_default && tbBrand) {
            parsed.outcome = "pick";
            parsed.top_pick_brand = tbBrand;
          }
          // Ride along for the eval's analysis of how often the pass fired.
          (parsed as unknown as { tiebreak?: unknown }).tiebreak = {
            fired: true,
            has_default: Boolean(tbp.has_default),
            default_brand: tbBrand,
          };
        }
      }
      // Structured outputs guarantee the TYPE, not the semantics: the model
      // occasionally writes the string "null" where it means no pick.
      const pick = realBrand(parsed.top_pick_brand);
      flattenReasons(parsed);
      const oaMentions = dedupeMentions(
        (parsed.mentions ?? []).filter((m) => nameAppearsBounded(responseText, m.brand, new Set(ctx.knownBrands.map((b) => b.trim().toLowerCase()))))
      );
      return {
        ...parsed,
        // A conditional or undecided answer crowns nobody, whatever the
        // model volunteered.
        top_pick_brand: parsed.outcome === "pick" ? pick : null,
        mentions: oaMentions,
        total_recommendations: recommendedCount(oaMentions),
        reasons: [...new Set(parsed.reasons ?? [])],
        focus_quote: focusQuote,
        focus_interpretation: focusInterpretation,
      };
    });
  },
};

/**
 * Consensus coding: two independent coders, then adjudication where they
 * disagree.
 *
 * No single cheap model codes these answers correctly every time — measured
 * field accuracy sat in the 70-90% range for both candidates, with different
 * strengths (Claude reads outcome and mentions better; GPT reads the crown
 * and numeric flags better). Running both and escalating disagreements to a
 * stronger judge turns two imperfect coders into a pipeline whose residual
 * error is both smaller and *visible*: every adjudication is recorded, so
 * the study can report how often its coders disagreed instead of pretending
 * they never do.
 */
export const CODER_A = process.env.EXTRACT_MODEL ?? "gpt-4o-mini";
export const CODER_B = process.env.EXTRACT_MODEL_B ?? "claude-haiku-4-5-20251001";
const ADJUDICATOR = process.env.EXTRACT_JUDGE ?? "claude-sonnet-5";

export interface ConsensusResult extends ExtractionResult {
  /** Provenance for the honesty table: who coded, and who settled ties. */
  coderProvenance: string;
  /** Judgement fields the two coders disagreed on, before adjudication. */
  disagreements: string[];
}

/**
 * A crown must name ONE brand. Coders occasionally emit a compound —
 * "GitHub Issues + Projects (or Linear)" — which matches no dictionary entry
 * and so vanishes from every brand metric instead of failing loudly.
 *
 * A name that the answer's own mentions (or the known brand list) contain is
 * kept whole, so legitimately parenthesised names like "GitHub Projects (v2)"
 * survive. Otherwise the compound is split and the first fragment naming a
 * real brand wins — that is the leading brand the answer actually crowned.
 */
function singleBrand(
  raw: string | null,
  mentions: ExtractedMention[],
  known: string[]
): string | null {
  const clean = raw?.trim();
  if (!clean) return null;
  const pool = [...mentions.map((m) => m.brand), ...known];
  // A trailing qualifier is part of one name ("Acme Projects (v2)"), not a
  // join, so drop it before deciding whether two names are being welded
  // together.
  const base = clean.replace(/\s*\([^)]*\)\s*$/, "").trim() || clean;
  const JOIN = /\s*(?:\+|\/|,|\bor\b)\s*/i;
  if (!JOIN.test(base)) {
    return pool.find((p) => matchKey(p) === matchKey(base)) ?? base;
  }
  // Compound. The whole-string match is NOT an escape hatch here: once a
  // compound name is itself extracted as a mention, matching against mentions
  // would wave it straight through, which is how "GitHub Issues + Projects"
  // survived the first version of this guard.
  const parts = base.split(JOIN).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const hit = pool.find((p) => matchKey(p) === matchKey(part));
    if (hit) return hit;
  }
  // No fragment names a brand the answer actually discussed, so this is not a
  // crown at all ("PR/task-list-first"). Better no winner than a fake one.
  return null;
}

/**
 * A coder that fails on one answer is noise; a coder that fails on most of
 * them is an outage, and quietly degrading to solo coding across a whole run
 * silently halves the methodology. Track the rate and stop the run once it is
 * unambiguous, so the failure is loud instead of buried in a provenance
 * string.
 */
export class CoderUnavailableError extends Error {}
const secondCoder = { attempts: 0, failures: 0, lastError: "" };
const OUTAGE_MIN_ATTEMPTS = 20;
const OUTAGE_FAILURE_RATE = 0.5;

function noteSecondCoder(ok: boolean, err?: unknown): void {
  secondCoder.attempts++;
  if (ok) {
    // A success proves the vendor is reachable; forget earlier blips so a
    // long healthy run cannot accumulate its way into a false alarm.
    secondCoder.failures = 0;
    return;
  }
  secondCoder.failures++;
  secondCoder.lastError = err instanceof Error ? err.message : String(err);
  console.error(
    `second coder (${CODER_B}) failed — ${secondCoder.failures} consecutive:`,
    secondCoder.lastError
  );
}

function assertSecondCoderHealthy(): void {
  if (
    secondCoder.attempts >= OUTAGE_MIN_ATTEMPTS &&
    secondCoder.failures / secondCoder.attempts > OUTAGE_FAILURE_RATE
  ) {
    throw new CoderUnavailableError(
      `consensus coding is degraded: ${CODER_B} failed on ` +
        `${secondCoder.failures} of ${secondCoder.attempts} answers. ` +
        `Last error: ${secondCoder.lastError}`
    );
  }
}

/**
 * When EXTRACT_SOLO names a model, that one model codes each answer alone
 * instead of the two-coder-plus-adjudicator consensus. Production runs solo
 * claude-sonnet-5 as of 2026-08-13 (Tyler's call, pending the framing
 * hand-labels); unset the variable to return to consensus. The focus read
 * stays a SEPARATE call regardless — folding it in would name the brand
 * under study in the same prompt that decides the crown, which is the exact
 * contamination the blind judgement pass exists to prevent.
 */
const SOLO_CODER = process.env.EXTRACT_SOLO ?? "";

/**
 * Coding provenance derived from the data itself, for exports. Reading the
 * per-answer coder_model column means the description can never disagree
 * with what actually coded the run — switching EXTRACT_SOLO changes future
 * runs' provenance and this summary follows automatically.
 */
export function summarizeCoderProvenance(
  coderModels: (string | null)[]
): string {
  const counts = new Map<string, number>();
  for (const m of coderModels) {
    const key = m ?? "unrecorded";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (parts.length === 0) return "no coded answers";
  if (parts.length === 1) {
    return `${parts[0][0]} — all ${parts[0][1]} answers`;
  }
  return parts
    .map(([m, n]) => `${m} (${n} answer${n === 1 ? "" : "s"})`)
    .join("; ");
}

/** Per-answer accumulator for exact coder metering: pass `sink` as the
 * ExtractionContext usageSink, then read `usage` after the consensus call.
 * Anthropic inputs arrive already folded to billed-equivalent tokens.
 * `prior` seeds from a stored responses.coder_usage JSON so a re-code
 * accumulates spend on the answer instead of overwriting what the first
 * coding pass cost. */
export function coderUsageAccumulator(prior?: string | null): {
  sink: NonNullable<ExtractionContext["usageSink"]>;
  usage: Record<string, { input: number; output: number }>;
} {
  let usage: Record<string, { input: number; output: number }> = {};
  if (prior) {
    try {
      const parsed = JSON.parse(prior) as Record<string, { input?: number; output?: number }>;
      for (const [m, u] of Object.entries(parsed ?? {})) {
        usage[m] = { input: u?.input ?? 0, output: u?.output ?? 0 };
      }
    } catch {
      usage = {};
    }
  }
  return {
    usage,
    sink: (model, input, output) => {
      const u = (usage[model] ??= { input: 0, output: 0 });
      u.input += input;
      u.output += output;
    },
  };
}

export async function extractCodingConsensus(
  responseText: string,
  ctx: ExtractionContext
): Promise<ConsensusResult> {
  const provider = getProvider();
  if (SOLO_CODER) {
    const [only, focus] = await Promise.all([
      provider.extractCoding(responseText, ctx, SOLO_CODER, true),
      // Eval drivers set EXTRACT_SKIP_FOCUS=1: focus fields are never
      // scored, and the default focus reader is a per-answer Claude call.
      process.env.EXTRACT_SKIP_FOCUS === "1"
        ? Promise.resolve({ focus_quote: null, focus_interpretation: null })
        : readFocus(responseText, ctx).catch(() => ({
            focus_quote: null,
            focus_interpretation: null,
          })),
    ]);
    return {
      ...only,
      top_pick_brand: singleBrand(
        only.outcome === "pick" ? only.top_pick_brand : null,
        only.mentions,
        ctx.knownBrands
      ),
      focus_quote: focus.focus_quote,
      focus_interpretation: focus.focus_interpretation,
      coderProvenance: `${SOLO_CODER} (solo)`,
      disagreements: [],
    };
  }
  // Three calls in flight at once rather than four in sequence: each coder
  // used to make its own focus read, so the same quote was extracted twice
  // and every answer paid for two serial round trips it did not need.
  const [a, b, focus] = await Promise.all([
    provider.extractCoding(responseText, ctx, CODER_A, true),
    provider
      .extractCoding(responseText, ctx, CODER_B, true)
      .then((r) => {
        noteSecondCoder(true);
        return r;
      })
      .catch((err) => {
        noteSecondCoder(false, err);
        return null;
      }),
    readFocus(responseText, ctx).catch(() => ({
      focus_quote: null,
      focus_interpretation: null,
    })),
  ]);
  if (!b) {
    // Throws once the failures stop looking like bad luck.
    assertSecondCoderHealthy();
    return {
      ...a,
      focus_quote: focus.focus_quote,
      focus_interpretation: focus.focus_interpretation,
      coderProvenance: `${CODER_A} (solo)`,
      disagreements: [],
    };
  }
  const sameBrand = (x: string | null, y: string | null) =>
    (x ?? "").trim().toLowerCase() === (y ?? "").trim().toLowerCase();
  const disagreements: string[] = [];
  if (a.outcome !== b.outcome) disagreements.push("outcome");
  if (!sameBrand(a.top_pick_brand, b.top_pick_brand)) disagreements.push("top_pick_brand");

  // Union the mentions: a brand either coder saw is a brand the answer named,
  // and recall was the weaker side of both coders. Framing ties break toward
  // the stronger reading (negative > recommended > mentioned) only when the
  // same brand is framed differently — a criticism seen by one coder and
  // missed by the other is still a criticism.
  const rank: Record<string, number> = { negative: 3, recommended: 2, mentioned: 1 };
  const merged = new Map<string, ExtractedMention>();
  for (const m of [...a.mentions, ...b.mentions]) {
    const key = m.brand.trim().toLowerCase();
    const prev = merged.get(key);
    if (!prev || rank[m.framing] > rank[prev.framing]) merged.set(key, m);
  }

  let outcome = a.outcome;
  let topPick = a.top_pick_brand;
  let provenance = `${CODER_A}+${CODER_B} (agreed)`;
  if (disagreements.length > 0) {
    const verdict = await adjudicate(responseText, a, b, ctx).catch(() => null);
    if (verdict) {
      outcome = verdict.outcome;
      topPick = verdict.outcome === "pick" ? verdict.top_pick_brand : null;
      provenance = `${CODER_A}+${CODER_B} → ${ADJUDICATOR}`;
    } else {
      // Judge unreachable: keep the more conservative reading rather than
      // inventing a winner.
      outcome = a.outcome === "pick" && b.outcome === "pick" ? "pick" : "conditional";
      topPick = outcome === "pick" ? a.top_pick_brand : null;
      provenance = `${CODER_A}+${CODER_B} (unresolved)`;
    }
  }
  const mentions = [...merged.values()];
  return {
    ...a,
    outcome,
    top_pick_brand: singleBrand(topPick, mentions, ctx.knownBrands),
    mentions,
    // Numeric flags: agree, or take the affirmative only when both saw it.
    includes_prices: a.includes_prices && b.includes_prices,
    includes_specs: a.includes_specs && b.includes_specs,
    total_recommendations: recommendedCount(mentions),
    reasons: [...new Set([...(a.reasons ?? []), ...(b.reasons ?? [])])],
    focus_quote: focus.focus_quote,
    focus_interpretation: focus.focus_interpretation,
    coderProvenance: provenance,
    disagreements,
  };
}

/**
 * One focus read per answer, shared by both coders.
 *
 * Runs on Anthropic rather than the OpenAI coder: this is quotation, not
 * judgement — it never touches outcome, crown, mentions, or framing — and
 * OpenAI's tokens-per-minute bucket is the run's binding constraint, while
 * Anthropic's is thirty times larger.
 */
const FOCUS_MODEL = process.env.EXTRACT_FOCUS_MODEL ?? CODER_B;

async function readFocus(
  responseText: string,
  ctx: ExtractionContext
): Promise<{ focus_quote: string | null; focus_interpretation: string | null }> {
  if (FOCUS_MODEL.startsWith("claude")) {
    const a = await anthropicClient();
    const res = await anthropicCreateT0(a, {
      model: FOCUS_MODEL,
      max_tokens: 400,
      system:
        `Read this AI assistant answer and report how it treats ` +
        `"${ctx.targetBrand}". Quote exactly; invent nothing.`,
      tools: [
        {
          name: "emit_focus",
          description: "Return the focus read.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              focus_quote: {
                type: ["string", "null"],
                description:
                  "One verbatim sentence (max 200 chars) about the brand, or null if it never appears.",
              },
              focus_interpretation: {
                type: ["string", "null"],
                description:
                  "One plain sentence on how the answer positions the brand, or null if absent.",
              },
            },
            required: ["focus_quote", "focus_interpretation"],
          } as unknown as { type: "object" },
        },
      ],
      tool_choice: { type: "tool", name: "emit_focus" },
      messages: [{ role: "user", content: responseText }],
    });
    ctx.usageSink?.(FOCUS_MODEL, claudeBilledInput(res.usage), (res.usage as { output_tokens?: number }).output_tokens ?? 0);
    const block = res.content.find((b) => b.type === "tool_use");
    const fp = (block && "input" in block ? block.input : {}) as {
      focus_quote?: string | null;
      focus_interpretation?: string | null;
    };
    return {
      focus_quote: fp.focus_quote ?? null,
      focus_interpretation: fp.focus_interpretation ?? null,
    };
  }
  const res = await client().chat.completions.create({
    model: FOCUS_MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          `Read this AI assistant answer and report how it treats ` +
          `"${ctx.targetBrand}". focus_quote: one verbatim sentence (max 200 ` +
          `chars) about that brand, or null if it never appears. ` +
          `focus_interpretation: one plain sentence on how the answer ` +
          `positions it, or null if absent. Quote exactly.`,
      },
      { role: "user", content: responseText },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "focus_read",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            focus_quote: { type: ["string", "null"] },
            focus_interpretation: { type: ["string", "null"] },
          },
          required: ["focus_quote", "focus_interpretation"],
        },
      },
    },
  });
  ctx.usageSink?.(FOCUS_MODEL, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0);
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
  return {
    focus_quote: parsed.focus_quote ?? null,
    focus_interpretation: parsed.focus_interpretation ?? null,
  };
}

async function adjudicate(
  responseText: string,
  a: ExtractionResult,
  b: ExtractionResult,
  ctx: ExtractionContext
): Promise<{ outcome: ExtractionResult["outcome"]; top_pick_brand: string | null }> {
  const anthropic = await anthropicClient();
  const res = await anthropicCreateT0(anthropic, {
    model: ADJUDICATOR,
    max_tokens: 500,
    system:
      "Two coders disagree about one AI answer. Decide from the text alone. " +
      "outcome — apply this test literally, do not weigh emphasis or " +
      "tone: could a reader who saw ONLY this answer act on it right now " +
      "and buy ONE named product, without first having to decide " +
      "something about their own size, budget, stack, or scale? YES, one " +
      "product is named as what to do → 'pick', even if alternatives, " +
      "caveats, or a follow-up question follow it; a stated default with " +
      "exceptions after it is a pick. NO, the reader must classify " +
      "themselves first → 'conditional'. NO, and no way forward is named " +
      "at all until they supply details → 'clarification'. NO, and it " +
      "recommends none and routes to none → 'no_pick'. A long or " +
      "enthusiastic write-up is not by itself a pick. top_pick_brand is " +
      "null unless outcome is 'pick', and must be ONE brand name — never " +
      "two joined by 'or', '+', '/' or a parenthetical.",
    tools: [
      {
        name: "settle",
        description: "Settle the disagreement.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            outcome: {
              type: "string",
              enum: ["pick", "conditional", "no_pick", "clarification"],
            },
            top_pick_brand: { type: ["string", "null"] },
          },
          required: ["outcome", "top_pick_brand"],
        } as unknown as { type: "object" },
      },
    ],
    tool_choice: { type: "tool", name: "settle" },
    messages: [
      {
        role: "user",
        content:
          `ANSWER:\n${responseText.slice(0, 8000)}\n\n` +
          `CODER A said: outcome=${a.outcome}, top_pick=${a.top_pick_brand}\n` +
          `CODER B said: outcome=${b.outcome}, top_pick=${b.top_pick_brand}`,
      },
    ],
  });
  ctx.usageSink?.(ADJUDICATOR, claudeBilledInput(res.usage), (res.usage as { output_tokens?: number }).output_tokens ?? 0);
  const block = res.content.find((x) => x.type === "tool_use");
  return (block && "input" in block ? block.input : {}) as {
    outcome: ExtractionResult["outcome"];
    top_pick_brand: string | null;
  };
}

/** Derived, not coded (Tyler 2026-09-19): the coded count disagreed with
 * the mention framings on 20-30% of answers - one source of truth now. */
function recommendedCount(mentions: ExtractedMention[]): number {
  return mentions.filter((m) => m.framing === "recommended").length;
}

function dedupeMentions(mentions: ExtractedMention[]): ExtractedMention[] {
  const seen = new Set<string>();
  return mentions.filter((m) => {
    const key = m.brand.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
