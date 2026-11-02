/**
 * Product-line grouping for the brand board (2026-11-02, Tyler).
 *
 * Inside one bucket, flagged pills that are the same product line ("Ink
 * Cash", "Ink Preferred", "Ink Business Unlimited" under Chase) collapse
 * into one chip, like the family "+N grouped names" collapse. Pure: no
 * store, no model - display grouping only; every member still commits as
 * its own merge on confirm.
 *
 * Rule: a name's line key is its first DISTINCTIVE word - lowercased,
 * skipping the bucket's own name tokens, everyday English (the vault
 * lexicon's two-tier rule: common and not brand-dominated, so "ink" and
 * "freedom" stay distinctive), digits, and a short list of generic card /
 * plan words. A word that extends a shorter key of 4+ letters joins it
 * ("savorone" -> "savor", "quicksilverone" -> "quicksilver"). Groups of 2+
 * collapse; a group of 1 stays a plain pill.
 */
import { BRAND_DOMINATED, COMMON_WORDS } from "./everyday_words";

/** Generic card / plan words that never name a line. Keep it small. */
const LINE_STOP = new Set([
  "card",
  "cards",
  "credit",
  "business",
  "rewards",
  "reward",
  "cash",
  "plus",
  "preferred",
  "unlimited",
  "elite",
  "premier",
]);

/** A shorter key extends to a longer word only at this length or more. */
const PREFIX_MIN = 4;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function everyday(w: string): boolean {
  return COMMON_WORDS.has(w) && !BRAND_DOMINATED.has(w);
}

/** First distinctive word of a name, or null when it has none. */
export function lineWord(name: string, bucketNames: string[]): string | null {
  // "U.S. Bank" also yields "us": initials written with dots are one token.
  const own = new Set(
    bucketNames.flatMap((n) => [...tokens(n), ...tokens(n.replace(/\./g, ""))])
  );
  for (const w of tokens(name)) {
    if (own.has(w) || LINE_STOP.has(w) || /^\d+$/.test(w) || everyday(w)) continue;
    return w;
  }
  return null;
}

export interface LineGroup<T> {
  key: string;
  members: T[];
  /** Shortest member name - the chip's visible label. */
  label: string;
}

/**
 * Group items by line key. Returns only groups of 2+, in order of each
 * group's first member; members keep their input order.
 */
export function groupLines<T>(
  items: T[],
  nameOf: (t: T) => string,
  bucketNames: string[]
): LineGroup<T>[] {
  const words = items.map((t) => lineWord(nameOf(t), bucketNames));
  // Keys: the distinct words, shortest first; a longer word folds into the
  // shortest key it equals or extends (deterministic, order-independent).
  const distinct = [...new Set(words.filter((w): w is string => !!w))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b)
  );
  const keyOf = new Map<string, string>();
  const keys: string[] = [];
  for (const w of distinct) {
    const k = keys.find((x) => x.length >= PREFIX_MIN && w.startsWith(x));
    if (k) keyOf.set(w, k);
    else {
      keys.push(w);
      keyOf.set(w, w);
    }
  }
  const byKey = new Map<string, T[]>();
  const order: string[] = [];
  items.forEach((t, i) => {
    const w = words[i];
    if (!w) return;
    const k = keyOf.get(w)!;
    if (!byKey.has(k)) {
      byKey.set(k, []);
      order.push(k);
    }
    byKey.get(k)!.push(t);
  });
  return order
    .filter((k) => byKey.get(k)!.length >= 2)
    .map((k) => {
      const members = byKey.get(k)!;
      const label = members
        .map(nameOf)
        .reduce((a, b) => (b.length < a.length ? b : a));
      return { key: k, members, label };
    });
}
