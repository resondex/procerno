/**
 * Per-engine list prices, USD per MILLION tokens, plus per-search tool
 * fees. Staff financials only - these are LIST prices maintained by hand
 * (checked 2026-09-18); answer tokens and extraction-coder tokens are both
 * vendor-metered, so every row prices exactly. Update when vendors reprice.
 */
export const ENGINE_PRICES: Record<string, { in: number; out: number; perSearch?: number }> = {
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
  sonar: { in: 1, out: 1, perSearch: 0.008 },
  // Extraction coders that never serve as answer engines.
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};

/** Answer cost in USD for one engine's token sums. Unknown engines price
 * at a conservative mid rate so totals never silently omit them. */
export function answerCost(model: string, inTok: number, outTok: number, searches: number): number {
  const p = ENGINE_PRICES[model] ?? { in: 3, out: 15 };
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out + searches * (p.perSearch ?? 0);
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
