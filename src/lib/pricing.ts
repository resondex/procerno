/**
 * Per-engine list prices, USD per MILLION tokens, plus per-search tool
 * fees. Staff financials only - these are LIST prices maintained by hand
 * (checked 2026-09-18); answer tokens and extraction-coder tokens are both
 * vendor-metered, so every row prices exactly. Update when vendors reprice.
 */
export const ENGINE_PRICES: Record<string, { in: number; out: number; perSearch?: number; perRequest?: number }> = {
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-5-search": { in: 1.25, out: 10, perSearch: 0.01 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gpt-5-mini-search": { in: 0.25, out: 2, perSearch: 0.01 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-sonnet-5-search": { in: 3, out: 15, perSearch: 0.01 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "gemini-pro-latest": { in: 1.25, out: 10 },
  "gemini-flash-latest": { in: 0.3, out: 2.5 },
  "grok-4": { in: 3, out: 15 },
  // Perplexity bills per REQUEST, not per search, and reports no search
  // count - a perSearch fee against searchCount null priced sonar at ~7%
  // of its true cost on the jira shakedown.
  sonar: { in: 1, out: 1, perRequest: 0.008 },
  // Extraction coders that never serve as answer engines.
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
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
