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

/** Extract a readable verbatim around the first token-bounded occurrence of
 * `name` in `text`: roughly one sentence each side, trimmed to sentence or
 * line boundaries, ellipsized. Empty string when the name never appears
 * bounded (a canonicalized detection with no literal surface form). */
export function extractSnippet(text: string, name: string, radius = 160): string {
  const n = name.trim().toLowerCase();
  const tokens = n.split(/[^a-z0-9+]+/).filter((x) => x.length > 2);
  const m =
    boundedRegex(n).exec(text) ??
    (tokens.length > 0 ? boundedRegex(tokens[0]).exec(text) : null);
  if (!m) return "";
  const hit = m.index + (m[1]?.length ?? 0);
  let start = Math.max(0, hit - radius);
  let end = Math.min(text.length, hit + n.length + radius);
  // Snap outward-cut edges to sentence/line boundaries where one is near.
  const before = text.slice(start, hit);
  const cut = Math.max(
    before.lastIndexOf(". "),
    before.lastIndexOf("\n"),
    before.lastIndexOf("• ")
  );
  if (cut > 0) start += cut + 1;
  const after = text.slice(hit, end);
  const stop = after.search(/[.!?]\s|\n/);
  if (stop > n.length) end = hit + stop + 1;
  const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (
    (start > 0 ? "…" : "") + snippet + (end < text.length ? "…" : "")
  );
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
