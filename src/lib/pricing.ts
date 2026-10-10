/**
 * Per-engine list prices, USD per MILLION tokens, plus per-search tool
 * fees. Staff financials only - these are LIST prices maintained by hand
 * (checked 2026-09-18); answer tokens and extraction-coder tokens are both
 * vendor-metered, so every row prices exactly. Update when vendors reprice.
 */
export const ENGINE_PRICES: Record<
  string,
  {
    in: number;
    out: number;
    perSearch?: number;
    perRequest?: number;
    /** Cache-hit price as a multiple of `in` (default 0.1). */
    cachedMult?: number;
  }
> = {
  // GPT-5.6 list prices checked 2026-09-26; search-content tokens bill as
  // input at model rates, on top of the per-call fee.
  "gpt-5.6-luna": { in: 0.2, out: 1.2 },
  "gpt-5.6-luna-search": { in: 0.2, out: 1.2, perSearch: 0.01 },
  "gpt-5.6-sol": { in: 4, out: 20 },
  "gpt-5.6-sol-search": { in: 4, out: 20, perSearch: 0.01 },
  // Retired ChatGPT engines - priced for the answers already stored.
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-5-search": { in: 1.25, out: 10, perSearch: 0.01 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gpt-5-mini-search": { in: 0.25, out: 2, perSearch: 0.01 },
  // $2/$10 became the standing Sonnet 5 price (the $3/$15 step-up planned
  // for 2026-09-01 was cancelled - Anthropic pricing page, 2026-10-10).
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-5-search": { in: 2, out: 10, perSearch: 0.01 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  // Updated 2026-09-28 to what the aliases now serve (3.1 Pro / 3.8 Flash);
  // 3.6 Flash is at the intro rate through 2026-12-31 (then 1.5/7.5).
  "gemini-pro-latest": { in: 2, out: 12 },
  "gemini-flash-latest": { in: 0.75, out: 3.75 },
  "gemini-3.6-flash": { in: 0.75, out: 3.75 },
  // Opus 5.5 cache hits bill at 0.05x base.
  "claude-opus-5-5": { in: 4, out: 20, cachedMult: 0.05 },
  "claude-opus-5-5-search": { in: 4, out: 20, perSearch: 0.01, cachedMult: 0.05 },
  "grok-4": { in: 3, out: 15 },
  // Perplexity bills per REQUEST, by search depth, and reports the exact
  // cost on every response (usage.cost.total_cost) - the ledger records
  // that. These rates are only the fallback when a response omits it; the
  // 0.0025 request fee is what our default (low) depth billed on the
  // 2026-10-10 probe.
  sonar: { in: 1, out: 1, perRequest: 0.0025 },
  "sonar-pro": { in: 3, out: 15, perRequest: 0.0025 },
  // Internal-job models (GPT-6 list prices checked 2026-09-26, short
  // context). Unlisted models price at the $3/$15 fallback.
  "gpt-6-luna": { in: 0.1, out: 0.5 },
  "gpt-6-sol": { in: 2, out: 10 },
  "gpt-6-astra": { in: 10, out: 50 },
  // Extraction coders that never serve as answer engines.
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "grok-4.6": { in: 2, out: 6 },
  "grok-4-fast": { in: 0.2, out: 0.5 },
};

/** Answer cost in USD for ONE answer's tokens (callers summing many
 * answers of a per-request-fee engine should call this per answer, or add
 * requestFee separately). Unknown engines price at a conservative mid rate
 * so totals never silently omit them. */
export function answerCost(model: string, inTok: number, outTok: number, searches: number): number {
  const p = ENGINE_PRICES[model] ?? { in: 3, out: 15 };
  return (
    (inTok / 1e6) * p.in +
    (outTok / 1e6) * p.out +
    searches * (p.perSearch ?? 0) +
    (p.perRequest ?? 0)
  );
}

/** Per-request fees for an AGGREGATED row of `calls` answers. */
export function requestFee(model: string, calls: number): number {
  return calls * (ENGINE_PRICES[model]?.perRequest ?? 0);
}

/** Per-search tool fee for a ledger row. Search engines call the vendor
 * under their BASE api model name (gpt-5-search calls "gpt-5"), so a row
 * with searches on a fee-less model looks up its -search variant; $0.01
 * is the conservative fallback. Rows without searches cost nothing here. */
export function searchFee(model: string, searches: number): number {
  if (searches <= 0) return 0;
  const fee =
    ENGINE_PRICES[model]?.perSearch ??
    ENGINE_PRICES[`${model}-search`]?.perSearch ??
    0.01;
  return searches * fee;
}

/**
 * EXACT extraction cost for one answer, from the responses.coder_usage
 * JSON (model -> vendor-metered {input, output}; Anthropic inputs already
 * folded to billed-equivalent tokens for prompt caching). Null or
 * malformed usage - answers coded before metering existed - price as 0.
 */
export function coderCost(coderUsageJson: string | null): number {
  if (!coderUsageJson) return 0;
  let usage: Record<string, { input?: number; output?: number }>;
  try {
    usage = JSON.parse(coderUsageJson);
  } catch {
    return 0;
  }
  let total = 0;
  for (const [model, u] of Object.entries(usage ?? {})) {
    const p = ENGINE_PRICES[model] ?? { in: 3, out: 15 };
    total += ((u?.input ?? 0) / 1e6) * p.in + ((u?.output ?? 0) / 1e6) * p.out;
  }
  return total;
}

/**
 * EXACT cost of one vendor call from its billed usage (lib/engine/usage.ts).
 * A vendor-reported cost wins outright (xAI, Perplexity). Otherwise: base
 * input + cache reads at the model's cache-hit multiple + cache writes at
 * 1.25x + all output, halved for vendor batch jobs (OpenAI, Anthropic and
 * Gemini batches bill tokens at 50% of list), plus tool fees, which batches
 * do not discount (both vendors' pricing pages), plus any per-request fee.
 * `model` is the engine id where there is one (search variants carry the
 * per-search fee), else the API model.
 */
export function billedCost(
  model: string,
  u: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    searches: number;
    vendorCostUsd: number | null;
  },
  opts?: { batch?: boolean }
): number {
  if (u.vendorCostUsd !== null) return u.vendorCostUsd;
  const p = ENGINE_PRICES[model] ?? { in: 3, out: 15 };
  const tokens =
    (u.inputTokens / 1e6) * p.in +
    (u.cachedInputTokens / 1e6) * p.in * (p.cachedMult ?? 0.1) +
    (u.cacheWriteTokens / 1e6) * p.in * 1.25 +
    (u.outputTokens / 1e6) * p.out;
  return tokens * (opts?.batch ? 0.5 : 1) + searchFee(model, u.searches) + (p.perRequest ?? 0);
}
