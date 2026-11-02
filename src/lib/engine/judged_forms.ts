import { store } from "../store";
import { cleanSurface, matchKey } from "../brand_key";
import { buildResolver } from "./brand_resolve";
import { CONTEXT_JUDGE_MODEL, cachedContextVerdicts } from "./context_judge";
import { latestCodes } from "./latest_codes";
import { DECISIVE_FLOOR, isPlaceholderName, queueableNamesOf } from "./dict_queue";
import { writeJudgedFormVerdicts } from "./dict_suggest";
import { COMMON_WORDS } from "./everyday_words";
import type { AnswerCodes, DictionaryEntry, Project, Run } from "../types";

/**
 * Judge-placed product forms go to the brand board for confirmation
 * (2026-11-02, Tyler): a name the read-time context judge places under a
 * maker that is ACTIVE on the board ("Sapphire Reserve" under Chase) is
 * queued as a PENDING dictionary name carrying a pre-set, review-flagged
 * MERGE suggestion into that maker - served exactly like a co-occurrence
 * guard "- review" merge pill: flagged under the parent, examples warm,
 * confirm commits it as an alias, a drag anywhere else overrides. Never
 * added silently.
 *
 * Admission (admitJudgedForms, pure):
 *   - the name resolves to nothing on the board WITHOUT the judge (not an
 *     entry or alias of any status, no family match);
 *   - its cached judge verdict lands on an ACTIVE entry (a pending or
 *     rejected maker: the form waits, nothing queued);
 *   - that entry is not the tracker's own brand (the target invariant -
 *     the target's forms alias through its family), and the name is not
 *     the brand itself;
 *   - named in >= DECISIVE_FLOOR coded answers (the observed-alias floor);
 *   - not a bare everyday word: a ONE-word form whose word is in the vault
 *     everyday lexicon ("Unlimited", "Premier", "Freedom") stays read-time
 *     only - confirmed as an alias it would become a family token and pull
 *     every name containing the word into the maker (the r13 lesson).
 *     Coined one-word forms ("Quicksilver", "Savor") and every multi-word
 *     form still queue.
 *
 * Idempotent: a queued form is a pending entry, so the next pass skips it.
 * No double-queue with dict_queue.ts: queueUnresolvedNames never queues a
 * judged FORM (it queues the maker when the maker is off the board, and
 * then this pass waits for that maker to be approved).
 *
 * While pending, the form keeps resolving to its maker in every view
 * (brand_resolve step 6), so queueing it for review moves no number.
 * Cached verdicts only - zero model calls.
 */

export interface JudgedFormAdmission {
  /** The form as it will be queued (surface-cleaned, as first seen). */
  form: string;
  /** The active entry the judge placed it under. */
  maker: string;
  makerEntryId: string;
  /** Distinct coded answers naming it. */
  answers: number;
}

export interface JudgedFormPlan {
  admitted: JudgedFormAdmission[];
  /** Judge-placed forms over the floor whose maker is pending, rejected or
   * off the board - they wait. */
  waiting: number;
}

/** A one-word form whose word is everyday English (vault COMMON_WORDS, the
 * same lexicon the r15 brand rules read; brand-dominated words included -
 * "Freedom" and "Flex" are everyday words a brand also uses). Pure. */
export function isBareEverydayForm(form: string): boolean {
  const words = cleanSurface(form).split(" ").filter(Boolean);
  if (words.length !== 1) return false;
  const w = words[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  return w.length > 0 && COMMON_WORDS.has(w);
}

/** The admission rule. Pure: no store, no model. */
export function admitJudgedForms(input: {
  dictionary: DictionaryEntry[];
  /** matchKey(name as written) -> the judge's maker name. */
  judged: Map<string, string>;
  targetBrand: string;
  rows: { responseId: string; names: string[] }[];
  floor?: number;
}): JudgedFormPlan {
  const floor = input.floor ?? DECISIVE_FLOOR;
  const targetKey = matchKey(input.targetBrand);
  const targetIds = new Set(
    input.dictionary
      .filter((e) => [e.canonical, ...e.aliases].some((f) => matchKey(f) === targetKey))
      .map((e) => e.id)
  );
  const plain = buildResolver(input.dictionary);
  const withJudge = buildResolver(input.dictionary, input.judged);
  const tally = new Map<
    string,
    { form: string; entry: DictionaryEntry | null; status: string; answers: Set<string> }
  >();
  for (const row of input.rows) {
    for (const raw of row.names) {
      if (typeof raw !== "string" || isPlaceholderName(raw)) continue;
      const k = matchKey(raw);
      if (!k || k === targetKey) continue;
      if (plain(raw).status !== "unknown") continue; // on the board already
      const r = withJudge(raw);
      if (r.via !== "judge") continue; // no verdict, or the judge said none
      if (r.entry && targetIds.has(r.entry.id)) continue; // the target's own form
      const t = tally.get(k) ?? {
        form: cleanSurface(raw),
        entry: r.entry,
        status: r.status,
        answers: new Set<string>(),
      };
      t.answers.add(row.responseId);
      tally.set(k, t);
    }
  }
  const admitted: JudgedFormAdmission[] = [];
  let waiting = 0;
  for (const t of tally.values()) {
    if (t.answers.size < floor || !t.form || isBareEverydayForm(t.form)) continue;
    if (t.status !== "active" || !t.entry) {
      waiting++;
      continue;
    }
    admitted.push({
      form: t.form,
      maker: t.entry.canonical,
      makerEntryId: t.entry.id,
      answers: t.answers.size,
    });
  }
  admitted.sort((a, b) => b.answers - a.answers || a.form.localeCompare(b.form));
  return { admitted, waiting };
}

export interface QueueJudgedFormsResult {
  queued: JudgedFormAdmission[];
  waiting: number;
}

/**
 * Queue the admitted judge-placed forms and write each one's flagged merge
 * verdict into the suggestion cache - verdict first, so a board open between
 * the two never finds an unjudged pending name. `codes` / `run` skip the
 * latest-coded-run lookup when the caller already has them.
 */
export async function queueJudgedForms(
  project: Project,
  opts: { run?: Run; codes?: AnswerCodes[] } = {}
): Promise<QueueJudgedFormsResult> {
  const codes = opts.codes ?? (await latestCodes(project, opts.run));
  if (codes.length === 0) return { queued: [], waiting: 0 };
  const dictionary = await store.getDictionary(project.id);
  const { judged } = await cachedContextVerdicts({
    project,
    dictionary,
    codes,
    meta: { brand: project.brand, category: project.category, projectId: project.id },
  });
  if (judged.size === 0) return { queued: [], waiting: 0 };
  const { admitted, waiting } = admitJudgedForms({
    dictionary,
    judged,
    targetBrand: project.brand,
    rows: codes.map((c) => ({ responseId: c.response_id, names: [...queueableNamesOf(c)] })),
  });
  if (admitted.length === 0) return { queued: [], waiting };
  await writeJudgedFormVerdicts(project.id, project.category, admitted, CONTEXT_JUDGE_MODEL);
  const before = dictionary.length;
  await store.queueDictionaryCandidates(
    project.id,
    admitted.map((a) => a.form)
  );
  const after = await store.getDictionary(project.id);
  if (after.length > before) await store.bumpDictionaryVersion(project.id);
  const queuedKeys = new Set(
    after.filter((e) => e.status === "pending").map((e) => matchKey(e.canonical))
  );
  return { queued: admitted.filter((a) => queuedKeys.has(matchKey(a.form))), waiting };
}
