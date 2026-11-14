/**
 * Brand-family token arithmetic - pure, no store or model imports, so the
 * setup checks (also bundled client-side), the dictionary engine and the
 * brand resolver share ONE semantics for "does this name refer to that
 * brand". Moved here from dict_suggest.ts / observations.ts (2026-10-02),
 * which re-export it unchanged.
 */

const norm = (s: string) => s.trim().toLowerCase();

export const famTokens = (s: string) => norm(s).split(/[^a-z0-9+]+/).filter(Boolean);

export function containsSeq(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Family membership for attribution: token containment, but a SINGLE-token
 * brand name only claims a form that leads with it (or a two-token form) -
 * "galaxy ai" belongs to Samsung Galaxy, "fire tv stick 4k max" does not
 * belong to Max just because "max" trails a device name. */
export function familyContains(hay: string[], seq: string[]): boolean {
  if (!containsSeq(hay, seq)) return false;
  if (seq.length >= 2) return true;
  return hay[0] === seq[0] || hay.length <= 2;
}

/** A hyphenated word is ONE word: a brand form that covers only part of it
 * is a different name that merely shares letters (a parent company whose
 * hyphenated name starts with one of its brands' short forms, a
 * "<brand>-style" descriptor). True when `seq` occurs in `raw` only by
 * splitting a hyphenated word - every occurrence touches a hyphenated word
 * it does not cover whole. A form that is itself the whole hyphenated word,
 * or that sits on plain words, is unaffected. Pure. */
export function splitsCompound(raw: string, seq: string[]): boolean {
  if (seq.length === 0) return false;
  const toks: string[] = [];
  const word: number[] = [];
  const size: number[] = [];
  const hyphenated: boolean[] = [];
  norm(raw)
    .split(/\s+/)
    .filter(Boolean)
    .forEach((w, wi) => {
      const ts = famTokens(w);
      size[wi] = ts.length;
      hyphenated[wi] = /[a-z0-9+][-\u2010\u2011\u2013][a-z0-9+]/.test(w);
      for (const t of ts) {
        toks.push(t);
        word.push(wi);
      }
    });
  let found = false;
  outer: for (let i = 0; i + seq.length <= toks.length; i++) {
    for (let j = 0; j < seq.length; j++) if (toks[i + j] !== seq[j]) continue outer;
    found = true;
    const covered = new Map<number, number>();
    for (let j = 0; j < seq.length; j++) covered.set(word[i + j], (covered.get(word[i + j]) ?? 0) + 1);
    let whole = true;
    for (const [wi, n] of covered) if (hyphenated[wi] && n !== size[wi]) whole = false;
    if (whole) return false;
  }
  return found;
}

/** Family membership of a name AS WRITTEN: familyContains over its tokens,
 * and the form must sit on whole words (splitsCompound). The one test the
 * observations, the observed-alias step, the board's family layer and the
 * read-time resolver share. */
export function familyHit(raw: string, seq: string[]): boolean {
  return familyContains(famTokens(raw), seq) && !splitsCompound(raw, seq);
}

/** Evidence attribution, shared by the co-occurrence guard and the
 * examples view so their numbers can never disagree: a detected name is
 * evidence for a form only under LEAD-PRESERVING containment (one name
 * begins with the other - "Prime Video" extends Prime, "Amazon Prime"
 * truncates Amazon Prime Video, but "Sonic Prime" and "MGM+" are their own
 * names), and it belongs to whichever of satellite/parent it matches most
 * specifically; an exact satellite match always wins. */
export function evidenceOwner(
  det: string[],
  satSeq: string[],
  parentSeqs: string[][]
): "sat" | "parent" | null {
  const eq = (a: string[], b: string[]) =>
    a.length === b.length && a.every((t, i) => t === b[i]);
  const score = (seq: string[]) => {
    if (eq(det, seq)) return seq.length + 0.5;
    if (containsSeq(det, seq) && det[0] === seq[0]) return seq.length;
    if (containsSeq(seq, det) && seq[0] === det[0]) return det.length;
    return 0;
  };
  if (eq(det, satSeq)) return "sat";
  const ps = parentSeqs.reduce((m, seq) => Math.max(m, score(seq)), 0);
  const ss = score(satSeq);
  if (ss === 0 && ps === 0) return null;
  return ss > ps ? "sat" : "parent";
}

/** Does a detected name refer to the same offering as any of the parent's
 * name-forms? Token-contiguous containment in EITHER direction: the
 * detected name may extend a parent form ("Amazon Prime Video 4K") or
 * truncate it ("Amazon Prime", "Prime") - one-directional substring
 * matching classified truncations as not-the-parent. Truncations go
 * through familyContains so a stray trailing token can't claim a name. */
export function coRefers(detectedTokens: string[], parentSeqs: string[][]): boolean {
  for (const seq of parentSeqs) {
    if (containsSeq(detectedTokens, seq)) return true;
    if (familyContains(seq, detectedTokens)) return true;
  }
  return false;
}
