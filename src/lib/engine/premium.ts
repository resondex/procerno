import { ENGINES } from "./providers";
import { buildResolver } from "./brand_resolve";
import { cachedView, cell, poolOf, type PoolRow, type RateCell, type ViewData } from "./view_data";
import type { Project, Run } from "../types";

/**
 * The premium tier view (2026-10-28). premium_worth cells are the
 * category-tier open-choice question ("do premium <category> beat basic
 * ones, and which would you get?"); their answers also count in the
 * headline (views.ts), and this view adds the tier read the headline cannot
 * give (CODING_DECISIONS section 12: "tier advocacy + who gets named").
 *
 * - Which end the AI advocates for this asker, from tier_stance: premium /
 *   basic / balanced (it depends, or both ends on stated conditions) / none
 *   (lays the ends out without advocating either).
 * - Who gets named at each end: no field ties a brand to an end, so the
 *   brands an answer recommends (mentions framed recommended, plus its top
 *   pick) are read by the end that answer advocates - "when the AI says go
 *   basic, it recommends X".
 * - The client's own rates: named, recommended, picked - overall and per end.
 */

export type { RateCell };

export type Stance = "premium" | "basic" | "balanced" | "none";
export const STANCES: readonly Stance[] = ["premium", "basic", "balanced", "none"];

export interface StanceRow {
  key: Stance;
  answers: number;
  share: RateCell;
  namesYou: RateCell;
  recommendsYou: RateCell;
  picksYou: RateCell;
  firmPick: RateCell;
  /** Active brands recommended in answers advocating this end. */
  recommended: { name: string; you: boolean; n: number }[];
}

export interface PremiumSlice {
  key: string;
  label: string;
  answers: number;
  stance: Record<Stance, RateCell>;
  picksYou: RateCell;
}

export interface PremiumView {
  runId: string;
  source: string;
  brand: string;
  category: string;
  answers: number;
  uncoded: number;
  stance: Record<Stance, RateCell>;
  namesYou: RateCell;
  recommendsYou: RateCell;
  picksYou: RateCell;
  firmPick: RateCell;
  byStance: StanceRow[];
  byEngine: PremiumSlice[];
}

interface Facts {
  row: PoolRow;
  stance: Stance;
  firm: boolean;
  pickKey: string | null;
  /** Active brand key -> name, recommended by this answer. */
  recommended: Map<string, string>;
  named: Set<string>;
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

function stanceCells(list: Facts[]): Record<Stance, RateCell> {
  return Object.fromEntries(STANCES.map((s) => [s, cell(count(list, (f) => f.stance === s), list.length)])) as Record<Stance, RateCell>;
}

export function computePremium(data: ViewData): PremiumView | null {
  const { project } = data;
  const { rows: pool, uncoded, core } = poolOf(data, "premium_tier");
  if (pool.length === 0 && uncoded === 0) return null;
  const resolve = buildResolver(data.dictionary, data.judged);
  const targetKey = resolve(project.brand).key;

  const facts: Facts[] = pool.map((row) => {
    const recommended = new Map<string, string>();
    const named = new Set<string>();
    for (const m of row.code.mentions ?? []) {
      const r = resolve(m.brand);
      if (r.status !== "active") continue;
      named.add(r.key);
      if (m.framing === "recommended") recommended.set(r.key, r.name);
    }
    let pickKey: string | null = null;
    const firm = row.code.outcome === "pick";
    if (firm && row.code.top_pick) {
      const r = resolve(row.code.top_pick);
      if (r.status === "active") {
        pickKey = r.key;
        named.add(r.key);
        recommended.set(r.key, r.name);
      }
    }
    const t = row.code.tier_stance;
    return {
      row,
      stance: t === "premium" || t === "basic" || t === "balanced" ? t : "none",
      firm,
      pickKey,
      recommended,
      named,
    };
  });
  const n = facts.length;

  const byStance: StanceRow[] = STANCES.map((s) => {
    const list = facts.filter((f) => f.stance === s);
    const m = new Map<string, { name: string; n: number }>();
    for (const f of list) for (const [key, name] of f.recommended) m.set(key, { name, n: (m.get(key)?.n ?? 0) + 1 });
    return {
      key: s,
      answers: list.length,
      share: cell(list.length, n),
      namesYou: cell(count(list, (f) => f.named.has(targetKey)), list.length),
      recommendsYou: cell(count(list, (f) => f.recommended.has(targetKey)), list.length),
      picksYou: cell(count(list, (f) => f.pickKey === targetKey), list.length),
      firmPick: cell(count(list, (f) => f.firm), list.length),
      recommended: [...m.entries()]
        .sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name))
        .slice(0, 8)
        .map(([key, v]) => ({ name: v.name, you: key === targetKey, n: v.n })),
    };
  });

  const labels = new Map(ENGINES.map((e) => [e.id, e.label]));
  return {
    runId: data.run.id,
    source: data.source,
    brand: project.brand,
    category: project.category,
    answers: n,
    uncoded,
    stance: stanceCells(facts),
    namesYou: cell(count(facts, (f) => f.named.has(targetKey)), n),
    recommendsYou: cell(count(facts, (f) => f.recommended.has(targetKey)), n),
    picksYou: cell(count(facts, (f) => f.pickKey === targetKey), n),
    firmPick: cell(count(facts, (f) => f.firm), n),
    byStance,
    byEngine: [...core]
      .map((m) => {
        const list = facts.filter((f) => f.row.model === m);
        return {
          key: m,
          label: labels.get(m) ?? m,
          answers: list.length,
          stance: stanceCells(list),
          picksYou: cell(count(list, (f) => f.pickKey === targetKey), list.length),
        };
      })
      .filter((s) => s.answers > 0),
  };
}

const PREMIUM_VERSION = "p1";
export function computePremiumCached(run: Run, project: Project): Promise<PremiumView | null> {
  return cachedView("premium_tier", PREMIUM_VERSION, run, project, computePremium, { judge: true });
}
