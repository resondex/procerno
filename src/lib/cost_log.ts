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
  /** The setup (draft) id for spend before a project exists - transferred
   * onto the project at create (attachSetupCosts). A tracker has a unique
   * id from the moment someone STARTS it. */
  setupId?: string | null;
  /** Marks spend as REWORK - fixes, repairs, redos, experiments - so the
   * real cost of a tracker stays readable (production COGS = NOT rnd).
   * Normal product-path spend is never rnd, whoever owns the tracker. */
  rnd?: boolean;
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
  setupId?: string | null;
  rnd?: boolean;
}): void {
  const searches = entry.searches ?? 0;
  if (entry.inputTokens + entry.outputTokens + searches === 0) return;
  const ctx = currentCostContext();
  void store
    .insertCostEntry({
      projectId: entry.projectId ?? ctx.projectId ?? null,
      runId: entry.runId ?? ctx.runId ?? null,
      setupId: entry.setupId ?? ctx.setupId ?? null,
      purpose: entry.purpose ?? ctx.purpose ?? "untagged",
      rnd: entry.rnd ?? ctx.rnd ?? false,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      searches,
    })
    .catch((err) => console.error("cost ledger write failed:", err));
}

/** Tag the request's spend with the wizard's setup id when the client sent
 * one (x-setup-id) - one line at the top of every setup route handler. */
export function tagSetupFromRequest(req: Request): void {
  const id = req.headers.get("x-setup-id");
  if (id && /^[0-9a-f-]{36}$/i.test(id)) tagCosts({ setupId: id });
}
