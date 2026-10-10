/**
 * Vendor usage -> billed usage. Every vendor reports tokens differently, and
 * the differences were costing the ledger accuracy (measured 2026-10-10 on
 * live probes):
 *
 * - Gemini (OpenAI-compatible): completion_tokens EXCLUDES thinking; the
 *   thoughts only show in total_tokens (prompt 17, completion 987, total
 *   2012). Billed output = total - prompt.
 * - xAI: reasoning_tokens sit outside completion_tokens (594 + 1,426
 *   reasoning) and the response carries its own exact cost
 *   (usage.cost_in_usd_ticks, 1e-10 USD).
 * - Perplexity: per-request fees vary with search depth; the response
 *   carries usage.cost.total_cost.
 * - OpenAI: completion/output includes reasoning; cached input is reported
 *   separately and bills at a tenth. Responses API search fees bill per
 *   tool_usage.web_search.num_requests - counting web_search_call items
 *   over-counts (one call can hold open_page/find actions, and up to 4
 *   "search" actions billed as 3; September GPT-5.6 batch archives).
 * - Anthropic: input_tokens is already the uncached part; cache writes and
 *   reads are separate fields.
 *
 * The universal output rule max(completion, total - prompt) covers OpenAI,
 * Perplexity (total = prompt + completion), xAI and Gemini alike.
 */

export interface BilledUsage {
  /** Input billed at the base rate (uncached). */
  inputTokens: number;
  /** Cache reads (bill at the model's cache-hit multiple). */
  cachedInputTokens: number;
  /** Cache writes (Anthropic, 1.25x base). */
  cacheWriteTokens: number;
  /** Every billed output token, reasoning/thinking included. */
  outputTokens: number;
  /** Billed web-search calls. */
  searches: number;
  /** Exact cost the vendor reported on the response, when it does. */
  vendorCostUsd: number | null;
  /** The vendor's usage object as received, for audit. */
  raw: unknown;
}

type Num = number | null | undefined;
const n = (x: Num): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** Chat Completions usage from any OpenAI-compatible vendor. Gemini's
 * BATCH output spells the counts camelCase (promptTokens, totalTokens,
 * completionTokens - probe 2026-10-10); both spellings are read. */
export function fromChatUsage(u: unknown): BilledUsage {
  const c = (u ?? {}) as { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  const x = (u ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    cost_in_usd_ticks?: number;
    cost?: { total_cost?: number };
  };
  const prompt = n(x.prompt_tokens ?? c.promptTokens);
  const cached = Math.min(prompt, n(x.prompt_tokens_details?.cached_tokens));
  const output = Math.max(
    n(x.completion_tokens ?? c.completionTokens),
    n(x.total_tokens ?? c.totalTokens) - prompt
  );
  const vendorCostUsd =
    typeof x.cost_in_usd_ticks === "number"
      ? x.cost_in_usd_ticks / 1e10
      : typeof x.cost?.total_cost === "number"
        ? x.cost.total_cost
        : null;
  return {
    inputTokens: prompt - cached,
    cachedInputTokens: cached,
    cacheWriteTokens: 0,
    outputTokens: output,
    searches: 0,
    vendorCostUsd,
    raw: u ?? null,
  };
}

/** OpenAI Responses API body (usage + tool_usage + output items). */
export function fromResponsesBody(body: unknown): BilledUsage {
  const b = (body ?? {}) as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
    tool_usage?: { web_search?: { num_requests?: number } };
    output?: { type: string; action?: { type?: string } }[];
  };
  const input = n(b.usage?.input_tokens);
  const cached = Math.min(input, n(b.usage?.input_tokens_details?.cached_tokens));
  const billed = b.tool_usage?.web_search?.num_requests;
  const searches =
    typeof billed === "number"
      ? billed
      : (b.output ?? []).filter(
          (o) => o.type === "web_search_call" && (o.action?.type ?? "search") === "search"
        ).length;
  return {
    inputTokens: input - cached,
    cachedInputTokens: cached,
    cacheWriteTokens: 0,
    outputTokens: n(b.usage?.output_tokens),
    searches,
    vendorCostUsd: null,
    raw: { usage: b.usage ?? null, tool_usage: b.tool_usage ?? null },
  };
}

/** Anthropic Messages usage. */
export function fromAnthropicUsage(u: unknown): BilledUsage {
  const x = (u ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    server_tool_use?: { web_search_requests?: number };
  };
  return {
    inputTokens: n(x.input_tokens),
    cachedInputTokens: n(x.cache_read_input_tokens),
    cacheWriteTokens: n(x.cache_creation_input_tokens),
    outputTokens: n(x.output_tokens),
    searches: n(x.server_tool_use?.web_search_requests),
    vendorCostUsd: null,
    raw: u ?? null,
  };
}

/** Total input tokens processed (all cache states) - what a response row
 * records as input_tokens. */
export function totalInput(u: BilledUsage): number {
  return u.inputTokens + u.cachedInputTokens + u.cacheWriteTokens;
}
