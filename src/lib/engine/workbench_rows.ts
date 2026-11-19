/**
 * The Data page's payload and its decoder (fact layer step 6, 2026-11-17) - pure, so the browser reads it. The
 * server (workbench.ts) writes the run's answer facts in a compact form; `decodeFacts` reads them back into the
 * AnswerFact shape the measure book's numerators and bases read (facts/measure_book.ts), so a Data page cell is
 * counted by the very rule every other screen counts with.
 *
 * Only the fields the measures read are carried. Left out on purpose: brands outside of analysis among the brands
 * an answer names (ruling 8 - never a subject; the measures that read the bucket read only brands in analysis), the
 * written forms, conditions, pairings, decision rules and products (no Data page number reads them). The sites an
 * answer cites ride as indexes into `sources` (null = the assistant does not search), each site with its owners.
 */
import type { AnswerFact, Bucket, NamedBrand, QuestionType } from "./facts/answer_facts";
import { VERDICT_FIELDS, VERDICT_VALUES } from "./facts/basics";
import type { DataPoolKey } from "./facts/measure_book";
import type { EngineMode, EngineTier } from "./providers";

export interface WbBrand {
  /** The dictionary entry id ("?<...>" for a name the dictionary cannot place). */
  key: string;
  name: string;
  role: "target" | "competitor" | "emerged";
  /** Parent company (the company rows); null = its own company. */
  parent: string | null;
  /** Ruling 8: in analysis, outside of analysis, or outside the category. */
  bucket: Bucket;
  /** In analysis - a brand the page lists (rows, pickers). */
  listed: boolean;
  /** The dictionary's other names for it (the Data page's search). */
  aliases?: string[];
}

export interface WbEngine {
  id: string;
  label: string;
  vendor: string;
  tier: EngineTier;
  mode: EngineMode;
}

export interface WbPrompt {
  text: string;
  stage: string;
  type: QuestionType;
  /** The Data page group it sits in (measure_book.ts DATA_POOLS). */
  pool: DataPoolKey;
  /** Index into `rooms`; -1 = asked of no particular buyer. */
  room: number;
  /** Index into `worries`; -1 = carries no worry. */
  worry: number;
  /** Index into `angles` on head-to-heads and switching; -1 elsewhere. */
  angle: number;
  /** Index into `brands` of the rival or class brand the question names; -1 = none. */
  rival: number;
  /** Index into `cells` / `cellIds`: the question (a seed and its rewordings). */
  cell: number;
}

/** [engine, prompt, response, pick, brands, args, verdicts, sent, price, sources] - see workbench.ts. */
export type WbFact = [
  number,
  number,
  number,
  number,
  [number, number][],
  number[],
  number[],
  [number[], number] | null,
  [number, number[]] | null,
  number[] | null,
];
export const R = { engine: 0, prompt: 1, response: 2, pick: 3, brands: 4, args: 5, verdicts: 6, sent: 7, price: 8, sources: 9 } as const;

export interface WorkbenchView {
  runId: string;
  projectId: string;
  source: string;
  brand: string;
  /** Index of the tracker in `brands`. */
  target: number;
  /** What to buy answers coded on the panel, and those with no code row. */
  answers: number;
  uncoded: number;
  /** The assistants the payload was cut to (the Panel lens); null = the whole core panel. Every cell's fact scope
   * carries it. */
  engineScope: string[] | null;
  brands: WbBrand[];
  engines: WbEngine[];
  prompts: WbPrompt[];
  rooms: string[];
  worries: string[];
  angles: string[];
  /** Each question's seed wording, index-addressed by prompts' `cell`. */
  cells: string[];
  /** Each question's id (its intent), index-addressed by prompts' `cell` - a fact scope's `intent`. */
  cellIds: string[];
  /** Arguments and topics, most carried first. */
  args: string[];
  /** The sites the answers cite (facts/sources.ts), most cited first. */
  sources: string[];
  /** Whose own site each source is: indexes into `brands`, [] = nobody's (aligned with `sources`). */
  sourceOwner: number[][];
  /** Answer ids, index-addressed by facts (the evidence drill). */
  responseIds: string[];
  facts: WbFact[];
}

const PRICE = ["rival", "own", "nowhere"] as const;

const memo = new WeakMap<WorkbenchView, AnswerFact[]>();

/** The payload's rows as answer facts (aligned with `view.facts`), memoized per payload. */
export function decodeFacts(view: WorkbenchView): AnswerFact[] {
  const hit = memo.get(view);
  if (hit) return hit;
  const B = view.brands;
  const brand = (i: number) => ({ key: B[i].key, name: B[i].name });
  const out = view.facts.map((r): AnswerFact => {
    const p = view.prompts[r[R.prompt]];
    const e = view.engines[r[R.engine]];
    const pickIdx = r[R.pick];
    const verdicts: AnswerFact["verdicts"] = {};
    VERDICT_FIELDS.forEach((f, i) => {
      const v = r[R.verdicts][i];
      if (v >= 0) verdicts[f] = VERDICT_VALUES[f][v];
    });
    const sent = r[R.sent];
    const price = r[R.price];
    const srcs = r[R.sources];
    return {
      responseId: view.responseIds[r[R.response]],
      promptId: String(r[R.prompt]),
      intentId: view.cellIds[p.cell],
      stage: p.stage,
      type: p.type,
      schema: "choice",
      situation: p.room >= 0 ? view.rooms[p.room] : null,
      worry: p.worry >= 0 ? view.worries[p.worry] : null,
      angle: p.angle >= 0 ? view.angles[p.angle] : null,
      rival: p.rival >= 0 ? brand(p.rival) : null,
      line: null,
      engine: { id: e.id, vendor: e.vendor, tier: e.tier, mode: e.mode },
      pick: pickIdx < 0 ? { state: "none", key: null, name: null, written: null } : { state: B[pickIdx].bucket, ...brand(pickIdx), written: null },
      brands: r[R.brands].map(
        ([i, bits], order): NamedBrand => ({ ...brand(i), bucket: "in_analysis", recommended: (bits & 1) === 1, framedRecommended: false, negative: (bits & 2) === 2, order, mentioned: true, written: "", forms: [], recForms: [] })
      ),
      verdicts,
      args: r[R.args].map((a) => view.args[a]),
      argsKind: null,
      sent: sent ? { brands: sent[0].map((i) => ({ ...brand(i), forms: [] })), own: Array<string>(sent[1]).fill(""), outside: [] } : null,
      price: price ? { bucket: PRICE[price[0]], rivals: price[1].map(brand), own: [] } : null,
      pairings: null,
      rules: null,
      conds: null,
      sources: srcs ? srcs.map((i) => ({ site: view.sources[i], owners: (view.sourceOwner[i] ?? []).map((j) => B[j].key) })) : null,
    };
  });
  memo.set(view, out);
  return out;
}
