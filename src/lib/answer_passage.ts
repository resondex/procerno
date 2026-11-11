/**
 * The panel's inline answer passages (2026-11-10, the one-panel redesign):
 * given an answer's body and the text an AnswerRef points at (the answer's own
 * wording of a condition, a code label, or the code row's quote), the passage
 * to show with the relevant sentence highlighted. Pure and client-safe - no
 * imports - ported from the prototype's passage() (scratchpad dump_scoped.mts).
 *
 * Exact match first (case-insensitive, after markdown markers are stripped
 * from both sides): the hit is the matched span with ~110 characters of
 * context either side. Otherwise the best-matching sentence by distinctive
 * word stems, scored down for length, with a short tail of its neighbours.
 */

export interface Passage {
  before: string;
  hit: string;
  after: string;
}

const CONTEXT = 110;
const NEIGHBOUR = 90;
const HIT_CAP = 230;
const MIN_EXACT = 12;

const STOP = new Set(
  "the a an and or of to in on for with you your if are is want who that at as it be have has need prefer value already this they them their not but".split(" ")
);

/** Markdown markers out, whitespace collapsed: headings, emphasis, list and quote markers, link brackets. */
export function plainText(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/[®™]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The passage of `text` that `find` points at (see the module note). */
export function passageOf(text: string, find: string): Passage {
  const body = plainText(text ?? "");
  const f = plainText(find ?? "");
  if (!body) return { before: "", hit: "", after: "" };
  if (f) {
    let at = body.indexOf(f);
    if (at < 0) at = body.toLowerCase().indexOf(f.toLowerCase());
    if (at >= 0 && (f.length >= MIN_EXACT || body.length <= f.length + 2 * CONTEXT)) {
      const a = Math.max(0, at - CONTEXT);
      const b = Math.min(body.length, at + f.length + CONTEXT);
      return {
        before: (a > 0 ? "..." : "") + body.slice(a, at),
        hit: body.slice(at, at + f.length),
        after: body.slice(at + f.length, b) + (b < body.length ? "..." : ""),
      };
    }
  }
  const sents = body.split(/(?<=[.!?:])\s+/).filter((x) => x.length > 0);
  const words = f
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  let best = -1;
  let bi = 0;
  sents.forEach((s, i) => {
    const l = s.toLowerCase();
    const score = words.filter((w) => l.includes(w.slice(0, 5))).length / Math.sqrt(1 + s.length / 200);
    if (score > best) {
      best = score;
      bi = i;
    }
  });
  const hit = sents[bi] ?? body;
  return {
    before: bi > 0 ? "..." + sents[bi - 1].slice(-NEIGHBOUR) + " " : "",
    hit: hit.length > HIT_CAP ? hit.slice(0, HIT_CAP) + "..." : hit,
    after: bi < sents.length - 1 ? " " + sents[bi + 1].slice(0, NEIGHBOUR) + "..." : "",
  };
}
