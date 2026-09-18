/**
 * Per-engine list prices, USD per MILLION tokens, plus per-search tool
 * fees. Staff financials only - these are LIST prices maintained by hand
 * (checked 2026-09-18); they price the metered answer tokens exactly and
 * the extraction coders by estimate. Update when vendors reprice.
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
};

/** Answer cost in USD for one engine's token sums. Unknown engines price
 * at a conservative mid rate so totals never silently omit them. */
export function answerCost(model: string, inTok: number, outTok: number, searches: number): number {
  const p = ENGINE_PRICES[model] ?? { in: 3, out: 15 };
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out + searches * (p.perSearch ?? 0);
}

/**
 * ESTIMATED extraction cost for one answer: three coder reads (coder A,
 * coder B, focus) whose input is the answer plus ~600 prompt tokens,
 * ~200 output tokens each, priced at a blended coder rate (gpt-4o-mini /
 * Haiku / occasional Sonnet adjudication). Clearly an estimate - exact
 * coder metering is a deeper refactor.
 */
export function coderCostEstimate(answerChars: number): number {
  const answerTok = Math.ceil(answerChars / 4);
  const inTok = (answerTok + 600) * 3;
  const outTok = 200 * 3;
  const BLEND_IN = 0.6; // $/M, blended
  const BLEND_OUT = 3;
  return (inTok / 1e6) * BLEND_IN + (outTok / 1e6) * BLEND_OUT;
}
