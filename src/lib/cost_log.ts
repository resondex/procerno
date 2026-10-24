import { AsyncLocalStorage } from "node:async_hooks";
import { store } from "./store";
import { billedCost } from "./pricing";
import type { BilledUsage } from "./engine/usage";

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
  /** The answer engine (registry id) the call collected for. Search
   * variants call the vendor under their base model name, so the API model
   * alone cannot tell gpt-5.6-sol from gpt-5.6-sol-search - this can. */
  engine?: string | null;
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
 * it measures. Zero-usage results are skipped.
 *
 * Pass `usage` (lib/engine/usage.ts) wherever the vendor response is at
 * hand: the row then carries cached/cache-write tokens, every reasoning
 * token, the billed search count, the vendor's own cost where it reports
 * one, and the exact USD cost priced at write time (cost_usd). The bare
 * input/output/searches form remains for callers that only have totals. */
export function logCost(entry: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  searches?: number;
  usage?: BilledUsage;
  purpose?: string;
  projectId?: string | null;
  runId?: string | null;
  setupId?: string | null;
  rnd?: boolean;
  engine?: string | null;
  /** Vendor batch job: tokens bill at 50% of list. */
  batch?: boolean;
}): void {
  const u: BilledUsage = entry.usage ?? {
    inputTokens: entry.inputTokens ?? 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: entry.outputTokens ?? 0,
    searches: entry.searches ?? 0,
    vendorCostUsd: null,
    raw: null,
  };
  const searches = entry.searches ?? u.searches;
  if (
    u.inputTokens + u.cachedInputTokens + u.cacheWriteTokens + u.outputTokens + searches === 0 &&
    !u.vendorCostUsd
  ) {
    return;
  }
  const ctx = currentCostContext();
  const engine = entry.engine ?? ctx.engine ?? null;
  const batch = entry.batch ?? false;
  void store
    .insertCostEntry({
      projectId: entry.projectId ?? ctx.projectId ?? null,
      runId: entry.runId ?? ctx.runId ?? null,
      setupId: entry.setupId ?? ctx.setupId ?? null,
      purpose: entry.purpose ?? ctx.purpose ?? "untagged",
      rnd: entry.rnd ?? ctx.rnd ?? false,
      model: entry.model,
      engine,
      batch,
      inputTokens: u.inputTokens,
      cachedInputTokens: u.cachedInputTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      outputTokens: u.outputTokens,
      searches,
      vendorCostUsd: u.vendorCostUsd,
      // Priced under the engine id when there is one: search variants carry
      // the per-search fee their base model's row does not.
      costUsd: billedCost(engine ?? entry.model, { ...u, searches }, { batch }),
      usageRaw: u.raw === null || u.raw === undefined ? null : JSON.stringify(u.raw),
    })
    .catch((err) => console.error("cost ledger write failed:", err));
}

const SETUP_ID_RE = /^[0-9a-f-]{36}$/i;

/** Ownership verdicts per (user, setup id), memoized per instance: a setup
 * walk sends dozens of requests under one id, and a draft's owner never
 * changes. Only positive verdicts are kept for long - a draft saved a
 * moment after its first spend call must be able to pass. */
const ownedMemo = new Map<string, { ok: boolean; at: number }>();
const OWNED_OK_MS = 30 * 60_000;
const OWNED_NO_MS = 15_000;

/** True when `setupId` is a stored draft owned by this caller. Dev mode
 * (userId null with auth off) owns the user-less drafts, as listing does.
 * One primary-key probe per request at most (memoized), never per model
 * call. */
export async function ownsSetup(setupId: string, userId: string | null): Promise<boolean> {
  if (!SETUP_ID_RE.test(setupId)) return false;
  const k = `${userId ?? "-"}|${setupId}`;
  const hit = ownedMemo.get(k);
  if (hit && Date.now() - hit.at < (hit.ok ? OWNED_OK_MS : OWNED_NO_MS)) return hit.ok;
  const row = await store.getSetupDraftOwner(setupId).catch(() => null);
  const ok = row !== null && row.user_id === userId;
  if (ownedMemo.size > 2000) ownedMemo.clear();
  ownedMemo.set(k, { ok, at: Date.now() });
  return ok;
}

/** The wizard's setup id (x-setup-id) this request's spend books to, or
 * null. The id is client-chosen, so it is honored only when it names a
 * draft the caller owns: spend under anyone else's id (or before the
 * first draft save) books untagged. The demo session never owns a draft
 * (it cannot store one). Call AFTER auth and tag in the handler itself -
 * `tagCosts({ setupId: await setupIdFromRequest(req, auth) })` - because
 * tagCosts inside an awaited helper would not reach the caller's context. */
export async function setupIdFromRequest(
  req: Request,
  auth: { userId: string | null; email: string | null }
): Promise<string | null> {
  if (auth.email === "demo" && auth.userId === null) return null;
  const id = req.headers.get("x-setup-id");
  if (!id || !SETUP_ID_RE.test(id)) return null;
  return (await ownsSetup(id, auth.userId)) ? id : null;
}
