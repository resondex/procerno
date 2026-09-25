import { createHash } from "crypto";
import { store } from "../store";
import { matchKey } from "../brand_key";
import { ignoreSurfaces } from "../ignore_rules";
import { extractSnippet, extractSnippetExcluding } from "./mention_filter";
import { containsSeq, famTokens, type DictSuggestion } from "./dict_suggest";
import { evidenceOwner } from "./observations";
import type { DictionaryEntry } from "../types";

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
  parent: string,
  /** Preloaded shared context, so a warm of many names loads the project's
   * brand rows and dictionary once instead of once per name. */
  ctx?: {
    dict: DictionaryEntry[];
    rows: Awaited<ReturnType<typeof store.listProjectBrandRows>>;
  }
): Promise<DictionaryExamples> {
  const cacheKey = cacheKeyFor(projectId, name, parent);
  const hit = await store.cacheGet(cacheKey, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as DictionaryExamples;

  const norm = (s: string) => s.trim().toLowerCase();
  const dict = ctx?.dict ?? (await store.getDictionary(projectId));
  const parentEntry = dict.find((e) => norm(e.canonical) === norm(parent));
  const parentForms = parent ? [parent, ...(parentEntry?.aliases ?? [])] : [];
  const parentSeqs = parentForms.map(famTokens);
  const satSeq = famTokens(name);
  const ownerOf = (det: string[]): "sat" | "parent" | null =>
    evidenceOwner(det, satSeq, parentSeqs);

  const rows = ctx?.rows ?? (await store.listProjectBrandRows(projectId));
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
 * Pre-warm the examples cache for EVERY pill that invites "click for real
 * answer examples", so the review phase runs entirely on cache - the same
 * three classes the board flags:
 *   (a) review-flagged merge suggestions (guard-annotated rationale);
 *   (b) volume-escalated ignores - an ignore verdict on a name observed in
 *       >=10% of answers renders as a flagged pill (identify_tab uses the
 *       same 0.1 threshold);
 *   (c) engine-rejected names that will surface as flagged pills in Ignore
 *       (unconfirmed rejects that aren't merge remnants).
 * Server compute only - no model calls. Cache-checked in one batch first,
 * and the misses share ONE load of the project's brand rows. Deadline-
 * aware: warming is a nicety and must never run the chunk out of budget.
 */
export async function prewarmDictionaryExamples(
  projectId: string,
  suggestions: DictSuggestion[],
  deadline: number
): Promise<number> {
  const norm = (s: string) => s.trim().toLowerCase();
  const [dict, project] = await Promise.all([
    store.getDictionary(projectId),
    store.getProject(projectId),
  ]);
  // Observed share per name, for the volume-escalation threshold.
  const obsByName = new Map<string, number>();
  let obsRows = 0;
  try {
    if (project?.brand_observations) {
      const obs = JSON.parse(project.brand_observations) as {
        rows: number;
        observed: { name: string; answers: number }[];
      };
      obsRows = obs.rows;
      for (const o of obs.observed) obsByName.set(norm(o.name), o.answers);
    }
  } catch {}
  const share = (name: string) =>
    obsRows > 0 ? (obsByName.get(norm(name)) ?? 0) / obsRows : 0;

  const targets: { name: string; parent: string | null }[] = [];
  for (const s of suggestions) {
    if (/- review\)/.test(s.rationale ?? "")) {
      targets.push({ name: s.name, parent: s.mergeIntoName });
    } else if (
      s.action === "ignore" &&
      ignoreSurfaces(s.rationale, share(s.name)) === "flag"
    ) {
      // Every ignore the shared rule surfaces as a flagged pill (own-context
      // flips, inherited ignores above the floor, high-volume names) invites
      // an examples click - warm it.
      targets.push({ name: s.name, parent: null });
    }
  }
  // Rejected names that render as flagged pills: unconfirmed, not the Other
  // bucket, and not a merge remnant living on as someone's alias.
  const aliasOwners = new Set(
    dict
      .filter((e) => e.status !== "rejected")
      .flatMap((e) => e.aliases.map((a) => matchKey(a)))
  );
  for (const e of dict) {
    if (e.status !== "rejected" || e.canonical === "Other") continue;
    if (e.confirmed.includes(norm(e.canonical))) continue;
    if (aliasOwners.has(matchKey(e.canonical))) continue;
    targets.push({ name: e.canonical, parent: null });
  }

  // One batch cache check - the normal re-drive finds everything warm and
  // never touches the brand rows at all.
  const keys = targets.map((t) =>
    cacheKeyFor(projectId, t.name, t.parent ?? "")
  );
  const hits = await store.cacheGetMany(keys, CACHE_TTL_MS);
  const misses = targets.filter((_, i) => !hits.has(keys[i]));
  if (misses.length === 0) return 0;

  const rows = await store.listProjectBrandRows(projectId);
  let warmed = 0;
  for (const t of misses) {
    if (Date.now() > deadline - 15_000) break;
    try {
      await buildDictionaryExamples(projectId, t.name, t.parent ?? "", {
        dict,
        rows,
      });
      warmed++;
    } catch (err) {
      console.error(`examples pre-warm failed for "${t.name}":`, err);
    }
  }
  return warmed;
}
