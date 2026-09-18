import { AsyncLocalStorage } from "node:async_hooks";
import { store } from "./store";

/**
 * The token-spend ledger. Every vendor API call made through the metered
 * clients in lib/engine/providers.ts appends one row here - answers,
 * coder passes, re-codes, setup composes, edit-time regenerations,
 * checkers, advisories - so redone or discarded work is captured at the
 * moment it was paid for, not reconstructed from whatever survived.
 */

/** Attribution for token spend: which surface asked for the work. Merged
 * down the call tree - a nested context keeps the outer project/run
 * unless it sets its own. */
export interface CostContext {
  projectId?: string | null;
  runId?: string | null;
  purpose?: string;
}

const als = new AsyncLocalStorage<CostContext>();

export function withCostContext<T>(ctx: CostContext, fn: () => T): T {
  const outer = als.getStore() ?? {};
  return als.run({ ...outer, ...ctx }, fn);
}

export function currentCostContext(): CostContext {
  return als.getStore() ?? {};
}

/** Tag the remainder of the current async execution - one line at the top
 * of a route handler or pipeline stage, merging over any outer context.
 * Use withCostContext instead where a scoped boundary matters (e.g. two
 * differently-tagged calls inside one function). */
export function tagCosts(ctx: CostContext): void {
  als.enterWith({ ...(als.getStore() ?? {}), ...ctx });
}

/** Append one vendor call's usage to the ledger. Fire-and-forget: a
 * ledger miss is logged, never thrown - metering must not break the work
 * it measures. Zero-usage results are skipped. */
export function logCost(entry: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  searches?: number;
  purpose?: string;
  projectId?: string | null;
  runId?: string | null;
}): void {
  const searches = entry.searches ?? 0;
  if (entry.inputTokens + entry.outputTokens + searches === 0) return;
  const ctx = currentCostContext();
  void store
    .insertCostEntry({
      projectId: entry.projectId ?? ctx.projectId ?? null,
      runId: entry.runId ?? ctx.runId ?? null,
      purpose: entry.purpose ?? ctx.purpose ?? "untagged",
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      searches,
    })
    .catch((err) => console.error("cost ledger write failed:", err));
}
