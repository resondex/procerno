import { matchKey } from "../brand_key";
import { famTokens, familyHit, familySpans } from "./brand_family";
import type { AnswerCodes } from "../types";
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
 *      the maker's own name for counting. A PENDING entry with a verdict
 *      whose maker lands on an active or rejected entry also resolves via
 *      the judge (a judged form awaiting review, judged_forms.ts);
 *   7. unknown - not in the dictionary.
 * (1), (4) and a judged maker landing on an active entry put a name in the
 * category (B5: the top pick resolves to an approved dictionary brand).
 */

/** Bump when resolution changes for identical inputs (same names, same
 * dictionary): it rides every view cache key, so cached views recompute
 * once. rs2 (2026-11-13): family containment needs whole words - a form
 * that only splits a hyphenated word no longer claims the name. rs3
 * (2026-11-14): a name carrying two tracked brands counts as naming both
 * (expandCoNamed). rs4 (2026-11-17, fact layer step 6): resolution no longer depends on the order names
 * are met - the memo was keyed by the match key, so two spellings sharing one ("Hulu + Live TV" / "Hulu+Live TV")
 * both took whichever the resolver met first; each spelling now resolves on its own, and every spelling of one match
 * key among the names the resolver is given (the run's written names) resolves as the best of them. */
export const RESOLVE_VERSION = "rs4";

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
export function buildResolver(entries: DictionaryEntry[], judged?: Map<string, string>, names?: Iterable<string>) {
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
  // Memoized by the name AS WRITTEN: two spellings that share a match key can differ in their words ("Hulu + Live
  // TV" carries the word "hulu", "Hulu+Live TV" does not), so a match-key memo made the second spelling inherit
  // whatever the first resolved to - the order names were met decided the count (ENGINE_INVENTORY section 5 #1).
  const memo = new Map<string, Resolved>();
  const label = (e: DictionaryEntry) => e.display_name ?? e.canonical;

  const base = (raw: string, k: string): Resolved => {
    const e = exact.get(k);
    if (e) return { status: e.status, key: e.id, name: label(e), entry: e, via: "exact" };
    let best: { seq: string[]; entry: DictionaryEntry } | null = null;
    for (const family of families) {
      for (const f of family) {
        if (familyHit(raw, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
      }
      if (best) break;
    }
    return best
      ? { status: best.entry.status, key: best.entry.id, name: label(best.entry), entry: best.entry, via: "family" }
      : { status: "unknown", key: `?${k}`, name: raw.trim(), entry: null, via: null };
  };

  /** Where a judged maker lands: EXACT board vocabulary only, never a
   * maker-word alias. Null when the name has no verdict. */
  const viaJudge = (k: string): Resolved | null => {
    const maker = judged?.get(k);
    if (!maker) return null;
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
    return e && !makerWord
      ? { status: e.status, key: e.id, name: label(e), entry: e, via: "judge" }
      : { status: "unknown", key: `?${mk}`, name: maker.trim(), entry: null, via: "judge" };
  };

  const resolveRaw = (raw: string): Resolved => {
    const hit = memo.get(raw);
    if (hit) return hit;
    const k = matchKey(raw);
    let out = base(raw, k);
    if (out.status === "unknown") {
      out = viaJudge(k) ?? out;
    } else if (out.status === "pending") {
      // A judged form queued for review (judged_forms.ts, 2026-11-02): until
      // the user confirms or overrides it, it keeps counting where the judge
      // placed it, so queueing it for review never moves a view's numbers.
      // Only a REVIEWED landing (active or rejected maker) outranks the
      // unreviewed pending entry.
      const j = viaJudge(k);
      if (j?.entry && j.entry.status !== "pending") out = j;
    }
    memo.set(raw, out);
    return out;
  };

  // One result per match key among the names given: every spelling of a key resolves as its BEST spelling, chosen
  // by a rule that depends only on the set of spellings, never on their order - a placed entry over a ruled-out one
  // over one awaiting review over unknown; then exact over family over the judge; then the spelling written most;
  // then the spelling's own sort order. Names never given resolve on their own spelling.
  const canon = new Map<string, string>();
  if (names) {
    const byKey = new Map<string, Map<string, number>>();
    for (const n of names) {
      if (!n) continue;
      const k = matchKey(n);
      const m = byKey.get(k) ?? new Map<string, number>();
      m.set(n, (m.get(n) ?? 0) + 1);
      byKey.set(k, m);
    }
    const statusRank = { active: 0, rejected: 1, pending: 2, unknown: 3 } as const;
    const viaRank = (v: Resolved["via"]) => (v === "exact" ? 0 : v === "family" ? 1 : v === "judge" ? 2 : 3);
    for (const [k, spellings] of byKey) {
      if (spellings.size < 2) continue;
      const best = [...spellings.entries()]
        .map(([raw, count]) => ({ raw, count, r: resolveRaw(raw) }))
        .sort((a, b) => statusRank[a.r.status] - statusRank[b.r.status] || viaRank(a.r.via) - viaRank(b.r.via) || b.count - a.count || (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0))[0];
      canon.set(k, best.raw);
    }
  }
  /** The spelling a name resolves as (itself unless another spelling of its match key was given and ranks first). */
  const spelling = (raw: string) => (canon.size ? canon.get(matchKey(raw)) ?? raw : raw);
  return Object.assign((raw: string): Resolved => resolveRaw(spelling(raw)), { spelling });
}

/** Every name as written in a set of coded answers (mentions, picks, destinations, redirects, pairings, rule
 * choices and products) - the spellings a resolver is given (buildResolver's `names`). */
export function writtenNames(codes: AnswerCodes[]): string[] {
  const out: string[] = [];
  for (const c of codes) {
    for (const m of c.mentions ?? []) if (m?.brand) out.push(m.brand);
    if (c.top_pick) out.push(c.top_pick);
    for (const d of c.destinations ?? []) if (d) out.push(d);
    for (const d of c.redirect_to ?? []) if (d) out.push(d);
    for (const p of c.pairings ?? []) if (p?.name) out.push(p.name);
    for (const r of c.decision_rules ?? []) {
      if (r?.choice) out.push(r.choice);
      if (r?.product) out.push(r.product);
    }
  }
  return out;
}

export type Resolver = ReturnType<typeof buildResolver>;

/**
 * A name that carries TWO tracked brands counts for both (Tyler,
 * 2026-11-14): a card named with its bank and its network, a bundle named
 * with both services. The resolver gives a name ONE entry (the longest
 * form), so the other brand was never counted as named.
 *
 * `coNamed(raw)` lists the OTHER active entries a name carries: only for a
 * name that is nobody's exact canonical or alias (those are decisions), and
 * only when the other brand's form sits on different words than the entry
 * the resolver picks - two forms reading the same words are one brand.
 */
export function buildCoNamed(entries: DictionaryEntry[], spelling: (raw: string) => string = (raw) => raw) {
  const exact = new Set<string>();
  for (const e of entries) for (const f of [e.canonical, ...e.aliases]) exact.add(matchKey(f));
  const forms: { seq: string[]; entry: DictionaryEntry }[] = [];
  for (const e of entries) {
    if (e.status !== "active" || e.canonical === "Other") continue;
    for (const f of [e.canonical, ...e.aliases]) forms.push({ seq: famTokens(f), entry: e });
  }
  // Memoized by the spelling a name resolves as (rs4): never by match key, which made the result depend on the
  // spelling met first.
  const memo = new Map<string, DictionaryEntry[]>();
  return function coNamed(written: string): DictionaryEntry[] {
    const raw = spelling(written);
    const k = matchKey(raw);
    const hit = memo.get(raw);
    if (hit) return hit;
    let out: DictionaryEntry[] = [];
    if (!exact.has(k)) {
      // Per entry, its longest form in the name and where that form sits.
      const best = new Map<string, { entry: DictionaryEntry; len: number; spans: [number, number][] }>();
      let primary: { entry: DictionaryEntry; len: number; spans: [number, number][] } | null = null;
      for (const f of forms) {
        const spans = familySpans(raw, f.seq);
        if (spans.length === 0) continue;
        const cur = best.get(f.entry.id);
        const row = { entry: f.entry, len: f.seq.length, spans };
        if (!cur || f.seq.length > cur.len) best.set(f.entry.id, row);
        // The resolver's own choice: the longest form, first listed on a tie.
        if (!primary || f.seq.length > primary.len) primary = row;
      }
      if (primary && best.size > 1) {
        const p = best.get(primary.entry.id)!;
        const apart = (a: [number, number], b: [number, number]) => a[1] <= b[0] || b[1] <= a[0];
        out = [...best.values()]
          .filter((b) => b.entry.id !== p.entry.id && b.spans.some((s) => p.spans.some((ps) => apart(s, ps))))
          .map((b) => b.entry);
      }
    }
    memo.set(raw, out);
    return out;
  };
}

/** The coded rows with every two-brand name counted for both brands: where
 * a mention carries a second tracked brand the answer does not otherwise
 * name, a mention of that brand is added right after it, with the same
 * framing and rank. Picks, exits and redirects are untouched - a pick stays
 * with the one entry the resolver gives it. Rows without such a name are
 * returned as they are (same object). Pure. */
export function expandCoNamed(codes: AnswerCodes[], entries: DictionaryEntry[]): AnswerCodes[] {
  const resolve = buildResolver(entries, undefined, writtenNames(codes));
  const coNamed = buildCoNamed(entries, resolve.spelling);
  return codes.map((c) => {
    const ms = c.mentions;
    if (!ms || ms.length === 0) return c;
    let named: Set<string> | null = null;
    let out: typeof ms | null = null;
    ms.forEach((m, i) => {
      const extra = m?.brand ? coNamed(m.brand) : [];
      if (extra.length === 0) {
        out?.push(m);
        return;
      }
      named ??= new Set(ms.map((x) => (x?.brand ? resolve(x.brand).key : "")));
      out ??= ms.slice(0, i);
      out.push(m);
      for (const e of extra) {
        if (named.has(e.id)) continue;
        named.add(e.id);
        out.push({ ...m, brand: e.canonical });
      }
    });
    return out && (out as typeof ms).length !== ms.length ? { ...c, mentions: out } : c;
  });
}
