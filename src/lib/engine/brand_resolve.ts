import { matchKey } from "../brand_key";
import { famTokens, familyContains } from "./brand_family";
import type { DictionaryEntry } from "../types";

/**
 * Read-time brand resolution for the per-type views (2026-10-27). Labels
 * store brands as written; the CURRENT dictionary decides who a name is
 * (CODING_DECISIONS section 6), so every board edit recomputes every view
 * without recoding. Pure - no store or model imports.
 *
 * Precedence, most deliberate first:
 *   1. an active entry's canonical or alias (merged names live here);
 *   2. a rejected entry's canonical or alias - reviewed and ruled out;
 *   3. a pending entry - not yet reviewed;
 *   4. family containment over active entries, longest form wins - the
 *      observations rule ("Chase Sapphire Reserve" is Chase, "iPhone 17
 *      Pro" is Apple iPhone), needed because labels name products and
 *      models the brands pass never saw;
 *   5. family containment over rejected entries - a product of a ruled-out
 *      name is ruled out with it;
 *   6. unknown - not in the dictionary.
 * Only (1) and (4) put a name in the category (B5: the top pick resolves to
 * an approved dictionary brand).
 */

export type ResolvedStatus = "active" | "rejected" | "pending" | "unknown";

export interface Resolved {
  status: ResolvedStatus;
  /** Identity for counting: the entry id, or "?" + matchKey when unknown. */
  key: string;
  /** User-facing label: the entry's display name, or the name as written. */
  name: string;
  entry: DictionaryEntry | null;
  /** How the name reached its entry. */
  via: "exact" | "family" | null;
}

export function buildResolver(entries: DictionaryEntry[]) {
  const exact = new Map<string, DictionaryEntry>();
  const rank = { active: 0, rejected: 1, pending: 2 } as const;
  for (const e of entries) {
    for (const form of [e.canonical, ...e.aliases]) {
      const k = matchKey(form);
      const prev = exact.get(k);
      if (!prev || rank[e.status] < rank[prev.status]) exact.set(k, e);
    }
  }
  const familyOf = (status: "active" | "rejected") => {
    const out: { seq: string[]; entry: DictionaryEntry }[] = [];
    for (const e of entries) {
      if (e.status !== status || e.canonical === "Other") continue;
      for (const form of [e.canonical, ...e.aliases]) out.push({ seq: famTokens(form), entry: e });
    }
    return out;
  };
  const families = [familyOf("active"), familyOf("rejected")];
  const memo = new Map<string, Resolved>();
  const label = (e: DictionaryEntry) => e.display_name ?? e.canonical;

  return function resolve(raw: string): Resolved {
    const k = matchKey(raw);
    const hit = memo.get(k);
    if (hit) return hit;
    let out: Resolved;
    const e = exact.get(k);
    if (e) {
      out = { status: e.status, key: e.id, name: label(e), entry: e, via: "exact" };
    } else {
      const hay = famTokens(raw);
      let best: { seq: string[]; entry: DictionaryEntry } | null = null;
      for (const family of families) {
        for (const f of family) {
          if (familyContains(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
        }
        if (best) break;
      }
      out = best
        ? { status: best.entry.status, key: best.entry.id, name: label(best.entry), entry: best.entry, via: "family" }
        : { status: "unknown", key: `?${k}`, name: raw.trim(), entry: null, via: null };
    }
    memo.set(k, out);
    return out;
  };
}

export type Resolver = ReturnType<typeof buildResolver>;
