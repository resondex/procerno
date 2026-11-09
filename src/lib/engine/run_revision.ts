/**
 * Memoized run data revision.
 *
 * store.runDataRevision fingerprints a run by hashing the full row text of its
 * responses, mentions, labels, prompts and answer_codes. On prod postgres that
 * is ~3.9s cold / ~370ms warm per call, and every per-type view request needs
 * it before it can even read its cache - one dashboard open fires ~12.
 *
 * Runs are immutable after collection; the revision exists to catch recodes
 * and relabels. So the revision itself is memoized in two layers:
 *   1. an in-process map (5 min) - the same lambda across sequential requests;
 *   2. an llm_cache row `run_rev:<runId>` (5 min) - across lambdas.
 * Writers of revision-hashed data in the app paths call purgeRunRevision right
 * after writing, so a recode takes effect immediately; the 5-minute TTL bounds
 * staleness wherever a purge is missed (out-of-band scripts, prompt edits).
 *
 * A null revision (SQLite cannot fingerprint) is never cached: null keeps
 * meaning "no fingerprint, compute fresh".
 *
 * Known residual, deliberate: ~12 concurrent first requests on a cold revision
 * can each pay one fresh hash - there is no cross-lambda coalescing. Not worth
 * a lease for a once-per-5-minutes cost.
 */
import { store } from "../store";

const TTL_MS = 5 * 60 * 1000;
const memo = new Map<string, { rev: string; at: number }>();

const keyOf = (runId: string) => `run_rev:${runId}`;

export async function cachedRunRevision(runId: string): Promise<string | null> {
  const hit = memo.get(runId);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.rev;
  if (hit) memo.delete(runId);

  const key = keyOf(runId);
  const raw = await store.cacheGet(key, TTL_MS);
  if (raw) {
    memo.set(runId, { rev: raw, at: Date.now() });
    return raw;
  }

  const rev = await store.runDataRevision(runId);
  if (rev === null) return null;
  await store.cacheSet(key, rev);
  memo.set(runId, { rev, at: Date.now() });
  return rev;
}

/** Drop the memoized revision so a data write is seen on the next request. */
export async function purgeRunRevision(runId: string): Promise<void> {
  memo.delete(runId);
  await store.cacheDelete(keyOf(runId));
}
