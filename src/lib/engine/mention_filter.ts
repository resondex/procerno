/**
 * Word-boundary validation for detected brand names: a name only counts if
 * the answer text actually contains it as a token-bounded match. Kills the
 * substring false-positive class ("Marvel" extracted from "The Marvelous
 * Mrs. Maisel") mechanically, before a phantom name can inflate observation
 * counts (discovery) or credit a brand's dashboard metrics (coding).
 *
 * Calibrated on the four-brand census (2026-09-23): the naive version
 * over-rejected plurals ("iPhones" vs "iPhone") and canonicalizations
 * ("Amex" in text, "American Express" detected), so a name passes when:
 *   (a) it is a known dictionary name - canonicalizing TO a tracked brand
 *       is correct behavior, not fabrication;
 *   (b) the full phrase appears bounded, plural-tolerant; or
 *   (c) at least one distinctive token (>2 chars) appears bounded -
 *       "Google Pixel" survives an answer that only says "Pixel 9".
 * "Marvel" still dies inside "Marvelous": no boundary, no distinctive token.
 */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function boundedRegex(term: string): RegExp {
  // Plural-tolerant: "iphone" matches "iPhones", "pixel" matches "Pixels".
  return new RegExp(
    `(^|[^a-z0-9])${esc(term.toLowerCase())}(s|es)?($|[^a-z0-9])`,
    "i"
  );
}

export function nameAppearsBounded(
  text: string,
  name: string,
  known?: Set<string>
): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (known?.has(n)) return true;
  const t = text.toLowerCase();
  if (boundedRegex(n).test(t)) return true;
  const tokens = n.split(/[^a-z0-9+]+/).filter((x) => x.length > 2);
  return tokens.some((tok) => boundedRegex(tok).test(t));
}

/** Filter a detected-name list against the answer it came from. `known`
 * holds normalized dictionary names (canonicals + aliases) that are always
 * accepted. */
export function boundedNames(
  text: string,
  names: string[],
  known?: Set<string>
): string[] {
  return names.filter((n) => nameAppearsBounded(text, n, known));
}
