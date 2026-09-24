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
export function extractSnippet(
  text: string,
  name: string,
  radius = 160,
  hitAt?: number
): string {
  const n = name.trim().toLowerCase();
  let hit: number;
  if (hitAt !== undefined) {
    hit = hitAt;
  } else {
    const tokens = n.split(/[^a-z0-9+]+/).filter((x) => x.length > 2);
    const m =
      boundedRegex(n).exec(text) ??
      (tokens.length > 0 ? boundedRegex(tokens[0]).exec(text) : null);
    if (!m) return "";
    hit = m.index + (m[1]?.length ?? 0);
  }
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
  else if (start > 0) {
    // No sentence boundary in reach: at least never cut mid-word.
    const sp = text.indexOf(" ", start);
    if (sp > -1 && sp < hit) start = sp + 1;
  }
  const after = text.slice(hit, end);
  const stop = after.search(/[.!?]\s|\n/);
  if (stop > n.length) end = hit + stop + 1;
  else if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > hit + n.length) end = sp;
  }
  // Answers are markdown; a raw slice of a table row or bold run is
  // unreadable. Flatten to prose: emphasis markers and backticks go, links
  // keep their text, table pipes become soft separators.
  const snippet = text
    .slice(start, end)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*+|`/g, "")
    .replace(/(^|\s)_(\S[^_]*\S)_(?=\s|$)/g, "$1$2")
    .replace(/(^|\s)[#>-]+\s/g, "$1")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s+/g, " ")
    .replace(/^[·\s]+|[·\s]+$/g, "")
    .trim();
  return (
    (start > 0 ? "…" : "") + snippet + (end < text.length ? "…" : "")
  );
}

/** Like extractSnippet, but skip occurrences of `name` that sit inside a
 * longer phrase from `excludePhrases` ("Prime" inside "Amazon Prime Video"
 * is the parent's name, not a bare use of the satellite). Falls back to the
 * plain extraction when no standalone occurrence exists. */
export function extractSnippetExcluding(
  text: string,
  name: string,
  excludePhrases: string[],
  radius = 160
): string {
  const n = name.trim().toLowerCase();
  const re = new RegExp(
    `(^|[^a-z0-9])(${esc(n)})(s|es)?($|[^a-z0-9])`,
    "ig"
  );
  const covers: [number, number][] = [];
  for (const ph of excludePhrases) {
    const pre = new RegExp(`(^|[^a-z0-9])${esc(ph.toLowerCase())}(s|es)?($|[^a-z0-9])`, "ig");
    let pm: RegExpExecArray | null;
    while ((pm = pre.exec(text)) !== null) {
      covers.push([pm.index, pm.index + pm[0].length]);
      pre.lastIndex = pm.index + 1;
    }
  }
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const at = m.index + (m[1]?.length ?? 0);
    if (!covers.some(([a, b]) => at >= a && at < b)) {
      // Standalone occurrence: extract the window around exactly this hit.
      return extractSnippet(text, name, radius, at);
    }
    re.lastIndex = m.index + 1;
  }
  return extractSnippet(text, name, radius);
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
