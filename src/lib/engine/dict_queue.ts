import { store } from "../store";
import { cleanSurface, matchKey } from "../brand_key";
import { buildResolver } from "./brand_resolve";
import { brandStringsOf, cachedContextVerdicts } from "./context_judge";
import { coderSource } from "./coder";
import { ENUM_TOWARD, GENERIC_AWAY } from "./rules_explorer";
import { classifyNonBrands } from "./suggest";
import { getDictionarySuggestions } from "./dict_suggest";
import { prewarmDictionaryExamples } from "./dict_examples";
import type { AnswerCodes, Project, Run } from "../types";

/**
 * The dictionary's new-name queue (2026-11-01, Tyler): a brand name the
 * dictionary cannot place is DICTIONARY work, not an analysis finding - it
 * goes onto the brand board's pending queue, where the user approves /
 * merges / ignores it with examples, not into a list on a results card.
 *
 * Names come from every brand-valued field of the run's codes (mentions,
 * top pick, destinations, redirects, pairings, brand-valued decision-rule
 * choices). Each resolves through the SAME resolver the views use, with the
 * context judge's CACHED verdicts (never a judge call here): a name that
 * lands on any dictionary entry (active, rejected, pending), that the judge
 * placed under a board entry, or that the judge ruled is no product is not
 * queued; a name the judge placed under a maker the board does not list
 * queues the MAKER instead. The rest are queued once per matchKey.
 * The tracker's own brand is never queued (the target invariant).
 *
 * Idempotent: a queued name is a pending entry, so the next pass resolves it.
 * Zero model calls.
 */

/** Schemas whose decision-rule choices are brand names (the rules
 * explorer's reading); every other schema's choices are verdict words. */
const BRAND_CHOICE_SCHEMAS = new Set(["choice", "expansion", "ecosystem"]);

/** A name-shaped string that names no brand: an enum verdict word, a
 * generic "none named" placeholder, or nothing at all. Pure. */
export function isPlaceholderName(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  if (!s || !matchKey(s).match(/[a-z0-9]/)) return true;
  if (ENUM_TOWARD.has(s) || s in GENERIC_AWAY) return true;
  if (Object.values(GENERIC_AWAY).some((g) => g.toLowerCase() === s)) return true;
  return /\((none|no [a-z]+) named\)/.test(s) || ["none", "n/a", "other", "unknown"].includes(s);
}

/** Every brand-shaped string a code row carries. brandStringsOf (the judge's
 * reading) plus the two Set C rule stages whose choices are brand names. */
export function* queueableNamesOf(c: AnswerCodes): Generator<string> {
  yield* brandStringsOf(c);
  if (BRAND_CHOICE_SCHEMAS.has(c.schema) && c.schema !== "choice") {
    for (const r of c.decision_rules ?? []) yield r.choice;
  }
}

/** The DECISIVE strings only - a pick, a destination, a redirect, a pairing
 * or a rule choice. A name that appears only as a passing mention is scenery
 * unless it clears the board's incidence floor. */
export function* decisiveNamesOf(c: AnswerCodes): Generator<string> {
  if (c.top_pick) yield c.top_pick;
  for (const d of c.destinations ?? []) yield d;
  for (const r of c.redirect_to ?? []) yield r;
  // Pairings are deliberately NOT decisive: an ecosystem answer's companion
  // (a transfer partner, an airline program) is named alongside the brand,
  // not chosen instead of it, so it never pulls its maker onto the board.
  if (BRAND_CHOICE_SCHEMAS.has(c.schema)) for (const r of c.decision_rules ?? []) yield r.choice;
}

/** Admission floors (2026-11-02, after a keyless run queued every passing
 * mention - 704 names on one tracker): the same bar the emerged-name board
 * uses. A name named only in passing needs MENTION_FLOOR of the run's coded
 * answers (the observations aggregation floor); a name that is ever a pick,
 * destination, redirect, pairing or rule choice needs DECISIVE_FLOOR answers
 * (the observed-alias floor). */
export const MENTION_FLOOR = 0.01;
export const DECISIVE_FLOOR = 3;

export interface QueueResult {
  /** Distinct names (by matchKey) the run's codes carry, placeholders and
   * the tracker's own brand excluded. */
  candidates: number;
  /** New pending entries written. */
  queued: number;
  /** New pending entries that are a judged MAKER the board did not list
   * (included in `queued`). */
  makerQueued: number;
  /** Names the context judge placed (under a maker) or ruled no product. */
  judgedAway: number;
}

export async function queueUnresolvedNames(
  project: Project,
  run: Run,
  opts: { deadline?: number } = {}
): Promise<QueueResult> {
  void opts.deadline; // cache-only today; reserved for a bounded future step
  // The tracker's codes source first, then the coder's (a run coded by the
  // wave before the dashboard reads the coder source).
  const codesSource = await store.getCodesSource(project.id);
  const coder = coderSource(await store.getReasonsAdapter(project.id));
  let codes: AnswerCodes[] = codesSource ? await store.listAnswerCodes(run.id, codesSource) : [];
  if (codes.length === 0 && coder !== codesSource) codes = await store.listAnswerCodes(run.id, coder);

  const targetKey = matchKey(project.brand);
  const before = (await store.getDictionary(project.id)).length;

  if (codes.length === 0) {
    // Legacy runs: the mentions table + responses top picks, queued as the
    // old finalize did (no resolution step - queueDictionaryCandidates skips
    // names already on the board by canonical or alias).
    const [runMentions, runResponses] = await Promise.all([
      store.listMentionsForRun(run.id),
      store.listResponseMeta(run.id),
    ]);
    const names = [
      ...runMentions.map((m) => m.brand),
      ...runResponses.map((r) => r.top_pick_brand).filter((b): b is string => Boolean(b)),
    ];
    // cleanSurface, same as the observations queue path - a mention's "®"
    // or doubled spaces must not become part of a pill's name.
    const clean = [...new Set(names.map(cleanSurface))].filter((n) => n && matchKey(n) !== targetKey);
    await store.queueDictionaryCandidates(project.id, clean);
    const queued = (await store.getDictionary(project.id)).length - before;
    if (queued > 0) await store.bumpDictionaryVersion(project.id);
    return { candidates: new Set(clean.map(matchKey)).size, queued, makerQueued: 0, judgedAway: 0 };
  }

  const dictionary = await store.getDictionary(project.id);
  const { judged, nulls } = await cachedContextVerdicts({
    project,
    dictionary,
    codes,
    meta: { brand: project.brand, category: project.category, projectId: project.id },
  });
  const resolve = buildResolver(dictionary, judged);

  // Pass 1: how many answers carry each name, and whether any carries it
  // decisively. The floors are judged per name, over the whole run.
  const tally = new Map<string, { name: string; answers: Set<string>; decisive: boolean }>();
  for (const c of codes) {
    const decisive = new Set<string>();
    for (const raw of decisiveNamesOf(c)) if (typeof raw === "string") decisive.add(matchKey(cleanSurface(raw)));
    for (const raw of queueableNamesOf(c)) {
      if (typeof raw !== "string" || isPlaceholderName(raw)) continue;
      const name = cleanSurface(raw);
      const k = matchKey(name);
      if (k === targetKey) continue;
      const t = tally.get(k) ?? { name, answers: new Set<string>(), decisive: false };
      t.answers.add(c.response_id);
      if (decisive.has(k)) t.decisive = true;
      tally.set(k, t);
    }
  }
  const mentionFloor = Math.max(DECISIVE_FLOOR, Math.ceil(codes.length * MENTION_FLOOR));
  const admitted = [...tally.entries()].filter(
    ([, t]) => t.answers.size >= (t.decisive ? DECISIVE_FLOOR : mentionFloor)
  );

  // Pass 2: resolve the admitted names; queue what nothing can place.
  const seen = new Set<string>();
  const planned = new Set<string>(); // matchKeys already headed for the queue
  const toQueue: string[] = [];
  const makers: string[] = [];
  let judgedAway = 0;
  {
    for (const [k, { name, decisive }] of admitted) {
      if (seen.has(k)) continue;
      seen.add(k);
      const r = resolve(name);
      if (r.via === "judge") {
        // Placed by the judge's cached verdict. A maker on the board takes
        // the name with it; a maker the board does not list is the
        // brand-grain entry the user would approve, so IT is queued - but
        // only when its product was DECISIVE somewhere (picked, recommended,
        // pointed to, chosen in a rule). A maker whose only trace is a
        // passing mention of a perk or partner (a merchant, a delivery app)
        // is scenery, not the board's to-do (Tyler, 2026-11-02).
        judgedAway++;
        if (r.status === "unknown" && decisive) {
          const maker = cleanSurface(r.name);
          const mk = matchKey(maker);
          if (mk !== targetKey && !planned.has(mk) && maker && !isPlaceholderName(maker) && resolve(maker).status === "unknown") {
            planned.add(mk);
            makers.push(maker);
          }
        }
        continue;
      }
      if (r.status !== "unknown") continue; // on the board already
      if (nulls.has(k)) {
        // The judge ruled it is no product (a content title, an
        // out-of-category product): not the board's to-do.
        judgedAway++;
        continue;
      }
      if (planned.has(k)) continue;
      planned.add(k);
      toQueue.push(name);
    }
  }
  if (toQueue.length > 0) await store.queueDictionaryCandidates(project.id, toQueue);
  const afterNames = (await store.getDictionary(project.id)).length;
  if (makers.length > 0) await store.queueDictionaryCandidates(project.id, makers);
  const after = (await store.getDictionary(project.id)).length;
  // New pending entries change how names resolve (unknown -> pending), so
  // the views' dictionary-versioned caches must recompute.
  if (after > before) await store.bumpDictionaryVersion(project.id);
  return { candidates: seen.size, queued: after - before, makerQueued: after - afterNames, judgedAway };
}

/**
 * The post-queue steps finalize runs, shared with the queue_unresolved route
 * so a coded-held run's new names are filtered and warmed before review
 * (the review-phase contract: nothing judged live while the user reviews).
 * Junk filter over every pending name, then the suggestions warm, then the
 * flagged pills' examples warm. `suggestDeadline` bounds the suggestions
 * warm (absent = unbounded, finalize's behavior); the examples warm takes a
 * fixed `examplesDeadline` or `examplesBudgetMs` from its own start (default
 * 60s). A timed-out suggestions warm leaves
 * its per-name cache partly filled and skips the examples.
 */
export async function runPostQueueSteps(
  project: Project,
  opts: { suggestDeadline?: number; examplesDeadline?: number; examplesBudgetMs?: number }
): Promise<void> {
  const dict = await store.getDictionary(project.id);
  const pendingEntries = dict.filter((e) => e.status === "pending");
  if (pendingEntries.length > 0) {
    const nonBrands = await classifyNonBrands(pendingEntries.map((e) => e.canonical));
    let excluded = 0;
    for (const e of pendingEntries) {
      if (nonBrands.has(e.canonical.trim().toLowerCase())) {
        await store.upsertDictionaryEntry({
          id: e.id,
          projectId: project.id,
          canonical: e.canonical,
          aliases: e.aliases,
          status: "rejected",
        });
        excluded++;
      }
    }
    if (excluded > 0) {
      await store.bumpDictionaryVersion(project.id);
      console.log(`dictionary junk filter: pre-excluded ${excluded} non-brand name(s)`);
    }
  }
  const warm = getDictionarySuggestions(project.id, project.category);
  const suggestions =
    opts.suggestDeadline === undefined
      ? await warm
      : await Promise.race([
          warm,
          new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, opts.suggestDeadline! - Date.now())).unref?.()),
        ]);
  if (!suggestions) {
    console.log("dictionary suggestions warm: deadline reached, examples skipped");
    return;
  }
  // Same review-phase contract as the bootstrap: every flagged pill's
  // examples are warm before review. Cache-first.
  // A fixed deadline, or a budget counted from when this step starts.
  const deadline = opts.examplesDeadline ?? Date.now() + (opts.examplesBudgetMs ?? 60_000);
  await prewarmDictionaryExamples(project.id, suggestions, deadline);
}
