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
 *   6. a context-judge verdict (context_judge.ts): the judged MAKER resolves
 *      through steps 1-5 and the name takes its entry and status (via
 *      "judge"); a maker the dictionary does not know rolls the name up to
 *      the maker's own name for counting;
 *   7. unknown - not in the dictionary.
 * (1), (4) and a judged maker landing on an active entry put a name in the
 * category (B5: the top pick resolves to an approved dictionary brand).
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
  via: "exact" | "family" | "judge" | null;
}

/** `judged` maps matchKey(name as written) -> the judge's maker name; the
 * maker resolves through the CURRENT dictionary here, never at judge time,
 * so board edits re-resolve judged names for free. */
export function buildResolver(entries: DictionaryEntry[], judged?: Map<string, string>) {
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

  const base = (raw: string, k: string): Resolved => {
    const e = exact.get(k);
    if (e) return { status: e.status, key: e.id, name: label(e), entry: e, via: "exact" };
    const hay = famTokens(raw);
    let best: { seq: string[]; entry: DictionaryEntry } | null = null;
    for (const family of families) {
      for (const f of family) {
        if (familyContains(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
      }
      if (best) break;
    }
    return best
      ? { status: best.entry.status, key: best.entry.id, name: label(best.entry), entry: best.entry, via: "family" }
      : { status: "unknown", key: `?${k}`, name: raw.trim(), entry: null, via: null };
  };

  return function resolve(raw: string): Resolved {
    const k = matchKey(raw);
    const hit = memo.get(k);
    if (hit) return hit;
    let out = base(raw, k);
    if (out.status === "unknown") {
      const maker = judged?.get(k);
      if (maker) {
        // A judged maker is a company name, so it lands on EXACT board
        // vocabulary only - the family hop is for product names and
        // mis-files company names that merely share a leading word. And it
        // never lands through a MAKER-WORD alias (the first word of a
        // multi-word canonical, aliased in for raw mentions): a bare parent
        // answer means the judge decided the product is NOT a form of the
        // tracked brand, so the parent's portfolio must not roll into it
        // (the r15 maker-word principle). A true product-form verdict
        // carries the tracked name exactly as listed and still lands.
        const mk = matchKey(maker);
        const e = exact.get(mk);
        const seq = e ? famTokens(e.canonical) : [];
        const makerWord = e ? seq.length > 1 && mk !== matchKey(e.canonical) && mk === matchKey(seq[0]) : false;
        out =
          e && !makerWord
            ? { status: e.status, key: e.id, name: label(e), entry: e, via: "judge" }
            : { status: "unknown", key: `?${mk}`, name: maker.trim(), entry: null, via: "judge" };
      }
    }
    memo.set(k, out);
    return out;
  };
}

export type Resolver = ReturnType<typeof buildResolver>;
