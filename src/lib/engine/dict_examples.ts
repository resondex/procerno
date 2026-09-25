import { createHash } from "crypto";
import { store } from "../store";
import { extractSnippet, extractSnippetExcluding } from "./mention_filter";
import { containsSeq, famTokens } from "./dict_suggest";
import { evidenceOwner } from "./observations";

export interface DictionaryExamples {
  name: string;
  parent: string | null;
  counts: { withParent: number; alone: number };
  withParent: string[];
  alone: string[];
  /** Longer phrases embedding this name - the client skips bolding
   * occurrences inside them. */
  embedding: string[];
}

const cacheKeyFor = (projectId: string, name: string, parent: string) =>
  `dict_examples:v7:${projectId}:` +
  createHash("sha256")
    .update(`${name.toLowerCase()}|${parent.toLowerCase()}`)
    .digest("hex");

const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;

/**
 * Verbatim evidence for a dictionary name: real answer snippets showing how
 * the answers actually use it, split into "named alongside <parent>" and
 * "named alone" so the co-occurrence number becomes something the user can
 * read with their own eyes. Fully mechanical - detection rows pick the
 * answers, a boundary regex extracts the sentence. Cached per (name,
 * parent); answers are never modified. Shared by the examples endpoint and
 * the bootstrap pre-warm, so a flagged pill's click is a cache hit.
 */
export async function buildDictionaryExamples(
  projectId: string,
  name: string,
  parent: string
): Promise<DictionaryExamples> {
  const cacheKey = cacheKeyFor(projectId, name, parent);
  const hit = await store.cacheGet(cacheKey, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as DictionaryExamples;

  const norm = (s: string) => s.trim().toLowerCase();
  const dict = await store.getDictionary(projectId);
  const parentEntry = dict.find((e) => norm(e.canonical) === norm(parent));
  const parentForms = parent ? [parent, ...(parentEntry?.aliases ?? [])] : [];
  const parentSeqs = parentForms.map(famTokens);
  const satSeq = famTokens(name);
  const ownerOf = (det: string[]): "sat" | "parent" | null =>
    evidenceOwner(det, satSeq, parentSeqs);

  const rows = await store.listProjectBrandRows(projectId);
  const withParent: string[] = [];
  const alone: string[] = [];
  const brandsOf = new Map<string, string[]>();
  for (const r of rows) {
    brandsOf.set(r.responseId, r.brands);
    let hasSat = false;
    let hasParent = false;
    for (const b of r.brands) {
      const owner = ownerOf(famTokens(b));
      if (owner === "sat") hasSat = true;
      else if (owner === "parent") hasParent = true;
      if (hasSat && hasParent) break;
    }
    if (!hasSat) continue;
    (hasParent ? withParent : alone).push(r.responseId);
  }
  // Spread the sample across the run instead of taking neighbors.
  const sample = (ids: string[], n: number) => {
    if (ids.length <= n) return ids;
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(ids[Math.floor((i * ids.length) / n)]);
    return out;
  };
  const wanted = [...sample(withParent, 3), ...sample(alone, 3)];
  const texts = new Map(
    (await store.getResponseTexts(wanted)).map((t) => [t.id, t.text])
  );
  // Phrases whose occurrences must not be quoted as this name: longer
  // parent forms, plus any OTHER detected name in that answer that embeds
  // the satellite's tokens without co-referring ("Sonic Prime").
  const parentEmbedding = parentForms.filter((f) => {
    const ft = famTokens(f);
    return ft.length > satSeq.length && containsSeq(ft, satSeq);
  });
  const quotes = (ids: string[], showParent: boolean) =>
    sample(ids, 3)
      .map((rid) => {
        const text = texts.get(rid) ?? "";
        const strangers = (brandsOf.get(rid) ?? []).filter((b) => {
          const bt = famTokens(b);
          return (
            bt.length > satSeq.length &&
            containsSeq(bt, satSeq) &&
            ownerOf(bt) !== "sat"
          );
        });
        const satSnip = extractSnippetExcluding(text, name, [
          ...parentEmbedding,
          ...strangers,
        ]);
        if (!showParent || !satSnip) return satSnip;
        // The column claims co-occurrence - the quote must show it. If the
        // window doesn't already contain a parent form, append the parent's
        // own line from the same answer.
        const low = satSnip.toLowerCase();
        if (parentForms.some((f) => low.includes(f.toLowerCase()))) return satSnip;
        for (const f of parentForms) {
          const ps = extractSnippet(text, f, 90);
          if (ps) return `${satSnip} — same answer: ${ps}`;
        }
        return satSnip;
      })
      .filter((s): s is string => Boolean(s));
  const payload: DictionaryExamples = {
    name,
    parent: parent || null,
    counts: { withParent: withParent.length, alone: alone.length },
    withParent: parent ? quotes(withParent, true) : [],
    alone: quotes(alone, false),
    embedding: parentEmbedding,
  };
  await store.cacheSet(cacheKey, JSON.stringify(payload), { projectId });
  return payload;
}

/**
 * Pre-warm the examples cache for every suggestion likely to be clicked:
 * review-flagged pills carry a "click for real answer examples" invitation,
 * so the click should be a cache hit, not a multi-second scan. Server
 * compute only - no model calls. Deadline-aware: warming is a nicety and
 * must never run the bootstrap chunk out of budget.
 */
export async function prewarmDictionaryExamples(
  projectId: string,
  targets: { name: string; parent: string | null }[],
  deadline: number
): Promise<number> {
  let warmed = 0;
  for (const t of targets) {
    if (Date.now() > deadline - 15_000) break;
    try {
      await buildDictionaryExamples(projectId, t.name, t.parent ?? "");
      warmed++;
    } catch (err) {
      console.error(`examples pre-warm failed for "${t.name}":`, err);
    }
  }
  return warmed;
}
