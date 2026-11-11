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

/**
 * 2026-11-10: the 5-minute expiry made the first dashboard open after any
 * short break pay the full hash (~3.5s) on every view request before a
 * single cached page could be read. The stored revision now carries the
 * cheap signature it was computed under (store.runDataSignature: counts and
 * newest timestamps, milliseconds). Past the 5-minute fresh window a lookup
 * recomputes only the signature: unchanged means the stored revision is
 * still right and is kept; changed means the data moved, so the full hash
 * runs. HARD_TTL_MS bounds the one case the signature cannot see - a row
 * edited in place by a path that does not stamp created_at (no app path does;
 * a hand-run SQL update could). purgeRunRevision still forces a fresh hash.
 */
const TTL_MS = 5 * 60 * 1000;
const HARD_TTL_MS = 24 * 60 * 60 * 1000;
const memo = new Map<string, { rev: string; at: number }>();

const keyOf = (runId: string) => `run_rev:${runId}`;

interface Stored {
  rev: string;
  sig: string;
  /** When the full hash was computed. */
  hashedAt: number;
  /** When the signature last confirmed it. */
  checkedAt: number;
}

function parseStored(raw: string | null): Stored | null {
  if (!raw || raw[0] !== "{") return null; // a pre-2026-11-10 row is the bare revision: treat as absent
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    return typeof v.rev === "string" && typeof v.sig === "string" && typeof v.hashedAt === "number" && typeof v.checkedAt === "number" ? (v as Stored) : null;
  } catch {
    return null;
  }
}

export async function cachedRunRevision(runId: string): Promise<string | null> {
  const hit = memo.get(runId);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.rev;
  if (hit) memo.delete(runId);

  const key = keyOf(runId);
  const now = Date.now();
  const stored = parseStored(await store.cacheGet(key, HARD_TTL_MS));
  if (stored && now - stored.hashedAt <= HARD_TTL_MS) {
    if (now - stored.checkedAt <= TTL_MS) {
      memo.set(runId, { rev: stored.rev, at: stored.checkedAt });
      return stored.rev;
    }
    const sig = await store.runDataSignature(runId);
    if (sig !== null && sig === stored.sig) {
      // cacheSet keeps the row's original created_at semantics out of it: the
      // ages that matter ride inside the value.
      await store.cacheSet(key, JSON.stringify({ ...stored, checkedAt: now } satisfies Stored));
      memo.set(runId, { rev: stored.rev, at: now });
      return stored.rev;
    }
  }

  // Signature first, hash second: a write landing between the two leaves a
  // stale signature beside a fresh revision, which the next check corrects
  // with one extra hash - never a stale revision beside a fresh signature.
  const sig = await store.runDataSignature(runId);
  const rev = await store.runDataRevision(runId);
  if (rev === null) return null;
  if (sig !== null) await store.cacheSet(key, JSON.stringify({ rev, sig, hashedAt: now, checkedAt: now } satisfies Stored));
  memo.set(runId, { rev, at: now });
  return rev;
}

/** Drop the memoized revision so a data write is seen on the next request. */
export async function purgeRunRevision(runId: string): Promise<void> {
  memo.delete(runId);
  await store.cacheDelete(keyOf(runId));
}
