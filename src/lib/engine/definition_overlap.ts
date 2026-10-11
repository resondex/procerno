/**
 * Cross-code overlap check for the codebook's scope sentences.
 *
 * The confirmed scope sentence IS the measurement (v4: labeler, training and
 * inference all read it), and the v5 test (2026-09-26) showed what per-code
 * definitions written in isolation do: a term claimed by two definitions
 * ("tiers ... pricing" in both plan tiers and monthly price) moved a code's
 * share threefold. The per-code contract check (definitions_prompt.py) could
 * not see that - it reads one sentence at a time. This check reads pairs.
 *
 * Rule: two definitions overlap when they share at least two DISTINCTIVE
 * stems - content words after stop words, the category's and brand's own
 * words, and a short list of generic scope vocabulary ("features",
 * "quality", "options") are removed; a stem is a word's first five letters
 * so "pricing" and "price" meet. Calibrated on the four confirmed v4 sheets
 * (0 / 3 / 1 / 1 pairs on Netflix / Jira / AmEx / Pixel, each defensible)
 * against the v5 sheets that produced the swings (74 / 104 / 43 / 46 pairs):
 * a one-stem rule flags 29-51 pairs on the clean sheets, so two is the floor.
 * Mirrored in ~/Documents/procerno_eval/labeling/definitions_prompt.py
 * (check_overlaps) for offline sheets. Zero model calls.
 */

const STOP = new Set(
  "a an and or of the to for in on with without by from as at vs versus its their it is are be that this these those which who whose how what when where other others own any all each per not no non into over under up out about across between within than then also both either very more most less plus such like e.g i.e etc".split(" ")
);
// Scope-sentence vocabulary that names no attribute of its own.
const GENERIC = new Set(
  "options option features feature general overall specific including includes include related issues issue quality level levels experience experiences value values use using used user users customer customers service services product products card cards plan plans phone phones tool tools brand brands company companies thing things way ways kind kinds type types aspect aspects".split(" ")
);

export interface DefinitionOverlap {
  a: string;
  b: string;
  /** The shared distinctive stems, as they appear in a's sentence. */
  terms: string[];
}

export function definitionStems(text: string, exclude: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of (text ?? "").toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []) {
    const w = raw.replace(/^['-]+|['-]+$/g, "");
    if (w.length <= 2 || STOP.has(w) || GENERIC.has(w) || exclude.has(w)) continue;
    const stem = w.slice(0, 5);
    if (exclude.has(stem)) continue;
    if (!out.has(stem)) out.set(stem, w);
  }
  return out;
}

/** Words of the category and brand names, which every scope sentence may
 * legitimately use ("streaming" in a streaming study). Stems included. */
export function excludedWords(parts: (string | null | undefined)[]): Set<string> {
  const ex = new Set<string>();
  for (const p of parts) {
    for (const w of (p ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (w.length <= 2) continue;
      ex.add(w);
      ex.add(w.slice(0, 5));
      if (w.endsWith("s")) { ex.add(w.slice(0, -1)); ex.add(w.slice(0, -1).slice(0, 5)); }
    }
  }
  return ex;
}

export function definitionOverlaps(
  defs: { code: string; text: string }[],
  opts: { category?: string | null; brand?: string | null; minShared?: number } = {}
): DefinitionOverlap[] {
  const minShared = opts.minShared ?? 2;
  const exclude = excludedWords([opts.category, opts.brand]);
  const stems = defs.map((d) => ({ code: d.code, s: definitionStems(d.text, exclude) }));
  const out: DefinitionOverlap[] = [];
  for (let i = 0; i < stems.length; i++) {
    for (let j = i + 1; j < stems.length; j++) {
      const shared: string[] = [];
      for (const [st, word] of stems[i].s) if (stems[j].s.has(st)) shared.push(word);
      if (shared.length >= minShared) out.push({ a: stems[i].code, b: stems[j].code, terms: shared.sort() });
    }
  }
  return out;
}

/** Per code: the codes it overlaps with and the shared terms - the review
 * card's chip. */
export function overlapsByCode(overlaps: DefinitionOverlap[]): Record<string, { code: string; terms: string[] }[]> {
  const by: Record<string, { code: string; terms: string[] }[]> = {};
  for (const o of overlaps) {
    (by[o.a] ??= []).push({ code: o.b, terms: o.terms });
    (by[o.b] ??= []).push({ code: o.a, terms: o.terms });
  }
  return by;
}
