import { ENGINES, engineDisplayLabel } from "./providers";
import { buildResolver } from "./brand_resolve";
import { cachedView, cell, poolOf, type PoolRow, type RateCell, type ViewData } from "./view_data";
import type { Project, Run } from "../types";

/**
 * The repertoire view (2026-10-28). A habitual buyer of the client names it
 * and asks whether to stick with it or try something else (STAGE_CONTRACT
 * row 19: "does the AI keep them with us?"). The question names the brand,
 * so being named is by construction and never reported; the read is stick
 * vs switch, from the choice schema:
 *
 * - sticks with you: the top pick resolves to the client;
 * - switches: the top pick resolves to another brand (where to, listed);
 * - no single answer: conditional, no pick or clarification.
 *
 * Alongside: how often the answer still recommends the client, and the
 * other brands it recommends (mentions framed recommended), on every
 * answer - "try something else" usually arrives as a list beside a keep.
 */

export type { RateCell };

export type Verdict = "stick" | "switch" | "open";
export const VERDICTS: readonly Verdict[] = ["stick", "switch", "open"];

export interface RepertoireSlice {
  key: string;
  label: string;
  answers: number;
  verdict: Record<Verdict, RateCell>;
  recommendsYou: RateCell;
  recommendsOther: RateCell;
}

export interface RepertoireView extends RepertoireSlice {
  runId: string;
  source: string;
  brand: string;
  uncoded: number;
  /** Brands picked instead of the client. */
  switchTo: { name: string; n: number }[];
  /** Other brands recommended, on any answer. */
  alsoRecommended: { name: string; n: number; share: RateCell }[];
  byEngine: RepertoireSlice[];
}

interface Facts {
  row: PoolRow;
  verdict: Verdict;
  pickName: string | null;
  recommendsYou: boolean;
  others: Map<string, string>;
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

function sliceOf(key: string, label: string, list: Facts[]): RepertoireSlice {
  const n = list.length;
  return {
    key,
    label,
    answers: n,
    verdict: Object.fromEntries(VERDICTS.map((v) => [v, cell(count(list, (f) => f.verdict === v), n)])) as Record<Verdict, RateCell>,
    recommendsYou: cell(count(list, (f) => f.recommendsYou), n),
    recommendsOther: cell(count(list, (f) => f.others.size > 0), n),
  };
}

export function computeRepertoire(data: ViewData): RepertoireView | null {
  const { project } = data;
  const { rows: pool, uncoded, core } = poolOf(data, "repertoire");
  if (pool.length === 0 && uncoded === 0) return null;
  const resolve = buildResolver(data.dictionary, data.judged);
  const targetKey = resolve(project.brand).key;

  const facts: Facts[] = pool.map((row) => {
    const others = new Map<string, string>();
    let recommendsYou = false;
    for (const m of row.code.mentions ?? []) {
      if (m.framing !== "recommended") continue;
      const r = resolve(m.brand);
      if (r.key === targetKey) recommendsYou = true;
      else if (r.status === "active") others.set(r.key, r.name);
    }
    let verdict: Verdict = "open";
    let pickName: string | null = null;
    if (row.code.outcome === "pick" && row.code.top_pick) {
      const r = resolve(row.code.top_pick);
      if (r.key === targetKey) {
        verdict = "stick";
        recommendsYou = true;
      } else {
        // Any other pick is a switch, in the dictionary or not.
        verdict = "switch";
        pickName = r.name;
      }
    }
    return { row, verdict, pickName, recommendsYou, others };
  });
  const n = facts.length;

  const tally = (pairs: string[]) => {
    const m = new Map<string, number>();
    for (const p of pairs) m.set(p, (m.get(p) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const labels = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));
  return {
    ...sliceOf("all", "All", facts),
    runId: data.run.id,
    source: data.source,
    brand: project.brand,
    uncoded,
    switchTo: tally(facts.flatMap((f) => (f.pickName ? [f.pickName] : []))).map(([name, k]) => ({ name, n: k })),
    alsoRecommended: tally(facts.flatMap((f) => [...f.others.values()]))
      .slice(0, 10)
      .map(([name, k]) => ({ name, n: k, share: cell(k, n) })),
    byEngine: [...core]
      .map((m) => sliceOf(m, labels.get(m) ?? m, facts.filter((f) => f.row.model === m)))
      .filter((s) => s.answers > 0),
  };
}

const REPERTOIRE_VERSION = "rp2";
export function computeRepertoireCached(run: Run, project: Project): Promise<RepertoireView | null> {
  return cachedView("repertoire", REPERTOIRE_VERSION, run, project, computeRepertoire, { judge: true });
}
