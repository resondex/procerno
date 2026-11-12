import { wilson } from "./metrics";
import { buildResolver } from "./brand_resolve";
import { promptsForRun } from "./surfaces";
import type { AnswerCodes, DictionaryEntry, Intent, Prompt, Run } from "../types";

/**
 * The question check for coded trackers (2026-11-11, Tyler). Counted from
 * the coded answers - no model call. Two checks, two grains:
 *
 * 1. THE QUESTION (a cell: seed + wordings pooled) - is it producing what
 *    its type exists to produce? Each type has one designed signal an answer
 *    either carries or does not:
 *      brand     - the answer names a product in the category (open choice,
 *                  habit, head-to-head, rivals' customers switching)
 *      argument  - the answer uses one of the category's arguments or topics
 *                  (criteria, learning the category, premium vs basic)
 *      target    - the answer discusses the tracker's own brand (every
 *                  question that names it: value, worries, holding your own,
 *                  business case, expansion, ecosystem, advocacy)
 *    Problem recognition has none: whether the answer reaches the category
 *    at all is that question's measurement.
 *
 * 2. THE WORDING - is one wording widely off topic next to the other
 *    wordings of the same question? Different answers are what wordings are
 *    for, so this reads only whether an answer is about the category at all
 *    (names a category brand OR uses a category argument or topic), and
 *    flags a wording only when its share sits clearly below its siblings'.
 *
 * Why not the model verdict it replaces: asked to judge lists of recalled
 * brands, the model flagged 115 questions, then 37 different ones after a
 * rewording, on the same answers - including questions whose answers named
 * the category leaders 13 times in 13.
 */

export type FitSignal = "brand" | "argument" | "target";

/** The designed signal of a question type; null = no question-level check. */
export function signalOf(stage: string, angle: string | null | undefined): FitSignal | null {
  switch (stage) {
    case "discovery":
    case "use_case":
    case "social_validation":
    case "repertoire":
    case "comparison":
      return "brand";
    case "alternatives":
      return angle === "defensive" ? "target" : "brand";
    case "criteria":
    case "category_education":
    case "premium_worth":
      return "argument";
    case "pricing":
    case "objections":
    case "churn_triggers":
    case "renewal":
    case "business_case":
    case "expansion":
    case "ecosystem":
    case "advocacy":
      return "target";
    default:
      return null;
  }
}

/** A question fails when fewer than this share of its answers carry its
 * designed signal. Measured on the six trackers 2026-11-11: 244 of 246
 * questions sit at 78% or above; the two below are at 52% and lower. */
export const CELL_MIN = 2 / 3;
export const CELL_MIN_ANSWERS = 20;
/** A wording fails when its on-topic share is at least this far under its
 * siblings' AND the two 95% ranges do not touch. */
export const WORDING_GAP = 0.3;
export const WORDING_MIN_ANSWERS = 8;

export interface CellFlag {
  intent: string;
  stage: string;
  signal: FitSignal;
  rate: number;
  answers: number;
  reason: string;
}

export interface WordingFlag {
  prompt: string;
  intent: string;
  rate: number;
  siblings: number;
  answers: number;
  reason: string;
}

export interface FitResult {
  /** Wordings judged (asked this run, with coded answers and an intent). */
  checked: string[];
  /** Asked wordings the check could not judge (no intent or no coded
   * answers) - their flags are left alone. */
  unjudged: number;
  cells: CellFlag[];
  wordings: WordingFlag[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function cellReason(signal: FitSignal, rate: number, brand: string): string {
  if (signal === "brand")
    return `Only ${pct(rate)} of the answers to this question name a product. It is meant to draw named picks.`;
  if (signal === "argument")
    return `Only ${pct(rate)} of the answers to this question use any of the category's arguments.`;
  return `Only ${pct(rate)} of the answers to this question discuss ${brand}.`;
}

export function computeQuestionFit(args: {
  brand: string;
  run: Pick<Run, "surfaces">;
  prompts: Prompt[];
  intents: Intent[];
  /** response id -> prompt id. */
  responses: { id: string; prompt_id: string }[];
  codes: AnswerCodes[];
  dictionary: DictionaryEntry[];
  judged?: Map<string, string>;
}): FitResult {
  const resolve = buildResolver(args.dictionary, args.judged);
  const target = resolve(args.brand);
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
    brand: number;
    argument: number;
    target: number;
    on: number;
  }
  const byCell = new Map<string, { intent: Intent; rows: Tally[] }>();
  let unjudged = 0;
  for (const prompt of promptsForRun(args.run, args.prompts, args.intents)) {
    const intent = prompt.intent_id ? intentById.get(prompt.intent_id) : undefined;
    const t: Tally = { prompt, n: 0, brand: 0, argument: 0, target: 0, on: 0 };
    for (const id of idsByPrompt.get(prompt.id) ?? []) {
      const c = codeById.get(id);
      if (!c) continue;
      t.n++;
      const names = [...(c.mentions ?? []).map((m) => m?.brand), c.top_pick].filter(
        (x): x is string => !!x && !!x.trim()
      );
      let inCategory = false;
      let isTarget = false;
      for (const name of names) {
        const r = resolve(name);
        if (r.status !== "active") continue;
        inCategory = true;
        if (target.status === "active" && r.key === target.key) isTarget = true;
      }
      const argued = (c.reasons?.length ?? 0) + (c.topics?.length ?? 0) > 0;
      if (inCategory) t.brand++;
      if (isTarget) t.target++;
      if (argued) t.argument++;
      if (inCategory || argued) t.on++;
    }
    if (!intent || t.n === 0) {
      unjudged++;
      continue;
    }
    const cell = byCell.get(intent.id) ?? { intent, rows: [] };
    cell.rows.push(t);
    byCell.set(intent.id, cell);
  }

  const out: FitResult = { checked: [], unjudged, cells: [], wordings: [] };
  for (const { intent, rows } of byCell.values()) {
    for (const r of rows) out.checked.push(r.prompt.id);
    const n = rows.reduce((s, r) => s + r.n, 0);

    const signal = signalOf(intent.stage, intent.angle);
    if (signal && n >= CELL_MIN_ANSWERS) {
      const rate = rows.reduce((s, r) => s + r[signal], 0) / n;
      if (rate < CELL_MIN)
        out.cells.push({
          intent: intent.id,
          stage: intent.stage,
          signal,
          rate,
          answers: n,
          reason: cellReason(signal, rate, args.brand),
        });
    }

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
        rate,
        siblings: sib,
        answers: r.n,
        reason: `${pct(rate)} of this wording's answers are about the category, against ${pct(sib)} for the other wordings of the same question.`,
      });
    }
  }
  return out;
}
