import { wilson } from "./metrics";
import { buildResolver } from "./brand_resolve";
import { promptsForRun } from "./surfaces";
import type { AnswerCodes, DictionaryEntry, Intent, Prompt, Run } from "../types";

/**
 * The question check for coded trackers (2026-11-11, Tyler). Counted from
 * the coded answers - no model call.
 *
 * THE WORDING - is one wording widely off topic next to the other wordings
 * of the same question? Different answers are what wordings are for, so this
 * reads only whether an answer is about the category at all (names a
 * category brand OR uses a category argument or topic), and flags a wording
 * only when its share sits clearly below its siblings'.
 *
 * The question-level check (does a cell draw what its type exists to draw)
 * was removed the same day (ph4): a whole question drawing little of its
 * designed signal is a design question for the setup, not a wording to swap,
 * and it had no fix the review could offer.
 *
 * Why not the model verdict it replaces: asked to judge lists of recalled
 * brands, the model flagged 115 questions, then 37 different ones after a
 * rewording, on the same answers - including questions whose answers named
 * the category leaders 13 times in 13.
 */

/** A wording fails when its on-topic share is at least this far under its
 * siblings' AND the two 95% ranges do not touch. */
export const WORDING_GAP = 0.3;
export const WORDING_MIN_ANSWERS = 8;
/** Example answers kept per side of a flag ("See examples"). */
export const FLAG_EXAMPLES = 3;

export interface WordingFlag {
  prompt: string;
  intent: string;
  stage: string;
  rate: number;
  siblings: number;
  answers: number;
  reason: string;
  /** Response ids: the flagged wording's off-topic answers, and the sibling
   * wordings' on-topic answers (for contrast) - up to FLAG_EXAMPLES each. */
  examples: { off: string[]; siblingsOn: string[] };
}

export interface FitResult {
  /** Wordings judged (asked this run, with coded answers and an intent). */
  checked: string[];
  /** Asked wordings the check could not judge (no intent or no coded
   * answers) - their flags are left alone. */
  unjudged: number;
  wordings: WordingFlag[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function computeQuestionFit(args: {
  /** Kept for callers; the wording check reads no brand-specific signal. */
  brand: string;
  run: Pick<Run, "surfaces">;
  prompts: Prompt[];
  intents: Intent[];
  /** response id -> prompt id. */
  responses: { id: string; prompt_id: string }[];
  codes: AnswerCodes[];
  dictionary: DictionaryEntry[];
  judged?: Map<string, string>;
  /** Live prompts this run never asked (a matchup that went live after it -
   * matchups.matchupPromptsNotAsked). Absent = none. */
  notAsked?: Set<string>;
}): FitResult {
  const resolve = buildResolver(args.dictionary, args.judged);
  const intentById = new Map(args.intents.map((i) => [i.id, i]));
  const codeById = new Map(args.codes.map((c) => [c.response_id, c]));
  const idsByPrompt = new Map<string, string[]>();
  for (const r of args.responses) {
    const list = idsByPrompt.get(r.prompt_id) ?? [];
    list.push(r.id);
    idsByPrompt.set(r.prompt_id, list);
  }

  interface Tally {
    prompt: Prompt;
    n: number;
    on: number;
    onIds: string[];
    offIds: string[];
  }
  const byCell = new Map<string, { intent: Intent; rows: Tally[] }>();
  let unjudged = 0;
  for (const prompt of promptsForRun(args.run, args.prompts, args.intents, args.notAsked)) {
    const intent = prompt.intent_id ? intentById.get(prompt.intent_id) : undefined;
    const t: Tally = { prompt, n: 0, on: 0, onIds: [], offIds: [] };
    for (const id of idsByPrompt.get(prompt.id) ?? []) {
      const c = codeById.get(id);
      if (!c) continue;
      t.n++;
      const names = [...(c.mentions ?? []).map((m) => m?.brand), c.top_pick].filter(
        (x): x is string => !!x && !!x.trim()
      );
      let inCategory = false;
      for (const name of names) {
        if (resolve(name).status === "active") {
          inCategory = true;
          break;
        }
      }
      const argued = (c.reasons?.length ?? 0) + (c.topics?.length ?? 0) > 0;
      if (inCategory || argued) {
        t.on++;
        t.onIds.push(id);
      } else t.offIds.push(id);
    }
    if (!intent || t.n === 0) {
      unjudged++;
      continue;
    }
    const cell = byCell.get(intent.id) ?? { intent, rows: [] };
    cell.rows.push(t);
    byCell.set(intent.id, cell);
  }

  const out: FitResult = { checked: [], unjudged, wordings: [] };
  for (const { intent, rows } of byCell.values()) {
    for (const r of rows) out.checked.push(r.prompt.id);
    const n = rows.reduce((s, r) => s + r.n, 0);

    if (rows.length < 2) continue;
    const on = rows.reduce((s, r) => s + r.on, 0);
    for (const r of rows) {
      if (r.n < WORDING_MIN_ANSWERS) continue;
      const sibN = n - r.n;
      if (sibN < WORDING_MIN_ANSWERS) continue;
      const rate = r.on / r.n;
      const sib = (on - r.on) / sibN;
      if (sib - rate < WORDING_GAP) continue;
      if (wilson(r.on, r.n).high >= wilson(on - r.on, sibN).low) continue;
      out.wordings.push({
        prompt: r.prompt.id,
        intent: intent.id,
        stage: intent.stage,
        rate,
        siblings: sib,
        answers: r.n,
        reason: `${pct(rate)} of this wording's answers are about the category, against ${pct(sib)} for the other wordings of the same question.`,
        examples: {
          off: r.offIds.slice(0, FLAG_EXAMPLES),
          // Spread across siblings: one on-topic answer from each in turn.
          siblingsOn: interleave(rows.filter((o) => o !== r).map((o) => o.onIds)).slice(0, FLAG_EXAMPLES),
        },
      });
    }
  }
  return out;
}

/** Round-robin across lists: [a1, b1, c1, a2, b2, ...]. */
function interleave(lists: string[][]): string[] {
  const out: string[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
