import { matchKey } from "../brand_key";
import { ENGINES, engineDisplayLabel } from "./providers";
import { buildResolver, type Resolver } from "./brand_resolve";
import { cachedView, cell, poolOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import type { AnswerCodes, DictionaryEntry, Project, Run } from "../types";

export type { RateCell };

/**
 * The headline view (2026-10-27): win / pick / visibility over open-choice
 * answers only - the presentation rule (CODING_DECISIONS section 8) made
 * mechanical by the view router. The pool is every answer whose cell routes
 * to "headline" (discovery, use_case, social_validation, premium_worth),
 * on the tracker's core engine panel, read from answer_codes under the
 * project's codes_source. Brands resolve through the CURRENT dictionary at
 * read time (brand_resolve.ts); the B5 in-category flag is "the top pick
 * resolves to an active entry".
 *
 * Rates (all over headline answers unless named otherwise):
 * - mentioned: the answer names the brand in any framing;
 * - recommended: a mention of the brand is framed recommended, or the brand
 *   is the top pick (the crowned brand always counts as recommended);
 * - chosen: the top pick resolves to the brand (top_pick only exists on
 *   outcome = pick);
 * - share of decided: chosen over in-category picks;
 * - negative: a mention framed negative, over answers naming the brand.
 */

export interface HeadlineBrand {
  key: string;
  name: string;
  role: "target" | "competitor" | "emerged";
  mentioned: RateCell;
  recommended: RateCell;
  chosen: RateCell;
  shareOfDecided: RateCell;
  negative: RateCell;
}

/** The target's rates inside one stage or one engine. */
export interface HeadlineSlice {
  key: string;
  label: string;
  answers: number;
  mentioned: RateCell;
  recommended: RateCell;
  chosen: RateCell;
  firmPickInCategory: RateCell;
}

export interface NamedCount {
  name: string;
  n: number;
}

export interface HeadlineView {
  runId: string;
  source: string;
  brand: string;
  /** Coded headline answers on the core panel - every rate's base. */
  answers: number;
  /** Headline answers on the core panel with no code row under the source. */
  uncoded: number;
  outcomes: { pick: number; conditional: number; no_pick: number; clarification: number };
  firmPick: RateCell;
  /** B5: picks whose top pick resolves to an active dictionary brand. */
  firmPickInCategory: RateCell;
  picks: {
    inCategory: number;
    /** Resolved to a rejected entry - the board ruled the name out. */
    ruledOut: number;
    pending: number;
    notInDictionary: number;
  };
  ruledOutPicks: NamedCount[];
  pendingPicks: NamedCount[];
  notInDictionaryPicks: NamedCount[];
  /** Active, analyzed brands named at least once, most-mentioned first. */
  brands: HeadlineBrand[];
  byStage: HeadlineSlice[];
  byEngine: HeadlineSlice[];
}

const STAGE_ORDER = ["discovery", "use_case", "social_validation", "premium_worth"];

function topCounts(m: Map<string, number>, limit = 12): NamedCount[] {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, n]) => ({ name, n }));
}

export function roleOf(
  key: string,
  targetKey: string,
  entry: DictionaryEntry | null,
  legacyCompetitors: Set<string>
): HeadlineBrand["role"] {
  if (key === targetKey) return "target";
  if (entry?.role) return entry.role;
  return entry && legacyCompetitors.has(matchKey(entry.canonical)) ? "competitor" : "emerged";
}

/** Per-answer brand facts, resolved once. */
interface AnswerFacts {
  stage: string;
  model: string;
  outcome: string | null;
  pickKey: string | null;
  pickInCategory: boolean;
  named: Set<string>;
  recommended: Set<string>;
  negative: Set<string>;
}

function factsOf(c: AnswerCodes, stage: string, model: string, resolve: Resolver): AnswerFacts {
  const named = new Set<string>();
  const recommended = new Set<string>();
  const negative = new Set<string>();
  for (const m of c.mentions ?? []) {
    const r = resolve(m.brand);
    if (r.status !== "active") continue;
    named.add(r.key);
    if (m.framing === "recommended") recommended.add(r.key);
    if (m.framing === "negative") negative.add(r.key);
  }
  let pickKey: string | null = null;
  let pickInCategory = false;
  if (c.outcome === "pick" && c.top_pick) {
    const r = resolve(c.top_pick);
    if (r.status === "active") {
      pickKey = r.key;
      pickInCategory = true;
      named.add(r.key);
      recommended.add(r.key);
    }
  }
  return { stage, model, outcome: c.outcome, pickKey, pickInCategory, named, recommended, negative };
}

function sliceOf(key: string, label: string, rows: AnswerFacts[], targetKey: string): HeadlineSlice {
  const n = rows.length;
  return {
    key,
    label,
    answers: n,
    mentioned: cell(rows.filter((f) => f.named.has(targetKey)).length, n),
    recommended: cell(rows.filter((f) => f.recommended.has(targetKey)).length, n),
    chosen: cell(rows.filter((f) => f.pickKey === targetKey).length, n),
    firmPickInCategory: cell(rows.filter((f) => f.pickInCategory).length, n),
  };
}

/** `request.room` (Journey's buyer filter) keeps that room's cells only -
 * discovery and use-case; social validation and premium vs basic are asked
 * across all buyers and drop out of a filtered pool. */
export function computeHeadline(data: ViewData, request: ViewRequest = {}): HeadlineView {
  const { run, project, source, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const legacy = new Set(project.competitors.map(matchKey));
  const { rows, uncoded, core } = poolOf(data, "headline", request);

  const facts: AnswerFacts[] = [];
  const ruledOut = new Map<string, number>();
  const pending = new Map<string, number>();
  const unknown = new Map<string, number>();
  const outcomes = { pick: 0, conditional: 0, no_pick: 0, clarification: 0 };
  for (const { code: c, intent, model } of rows) {
    const f = factsOf(c, intent.stage, model, resolve);
    facts.push(f);
    if (c.outcome && c.outcome in outcomes) outcomes[c.outcome as keyof typeof outcomes]++;
    if (c.outcome === "pick" && c.top_pick && !f.pickInCategory) {
      const r = resolve(c.top_pick);
      const bucket = r.status === "rejected" ? ruledOut : r.status === "pending" ? pending : unknown;
      bucket.set(r.name, (bucket.get(r.name) ?? 0) + 1);
    }
  }
  const n = facts.length;
  const inCategoryPicks = facts.filter((f) => f.pickInCategory).length;

  // Brand rows: every active, analyzed brand the pool names.
  const entryByKey = new Map(dictionary.map((e) => [e.id, e]));
  const tally = new Map<string, { named: number; rec: number; chosen: number; neg: number }>();
  const bump = (key: string, field: "named" | "rec" | "chosen" | "neg") => {
    const t = tally.get(key) ?? { named: 0, rec: 0, chosen: 0, neg: 0 };
    t[field]++;
    tally.set(key, t);
  };
  for (const f of facts) {
    for (const k of f.named) bump(k, "named");
    for (const k of f.recommended) bump(k, "rec");
    for (const k of f.negative) bump(k, "neg");
    if (f.pickKey) bump(f.pickKey, "chosen");
  }
  if (!tally.has(targetKey)) tally.set(targetKey, { named: 0, rec: 0, chosen: 0, neg: 0 });
  const brands: HeadlineBrand[] = [];
  for (const [key, t] of tally) {
    const entry = entryByKey.get(key) ?? null;
    if (entry && !entry.analyzed && key !== targetKey) continue;
    brands.push({
      key,
      name: entry ? entry.display_name ?? entry.canonical : project.brand,
      role: roleOf(key, targetKey, entry, legacy),
      mentioned: cell(t.named, n),
      recommended: cell(t.rec, n),
      chosen: cell(t.chosen, n),
      shareOfDecided: cell(t.chosen, inCategoryPicks),
      negative: cell(t.neg, t.named),
    });
  }
  brands.sort((a, b) => b.mentioned.k - a.mentioned.k || a.name.localeCompare(b.name));

  const engineLabel = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));
  const stages = STAGE_ORDER.filter((s) => facts.some((f) => f.stage === s));
  const models = [...core].filter((m) => facts.some((f) => f.model === m));

  return {
    runId: run.id,
    source,
    brand: project.brand,
    answers: n,
    uncoded,
    outcomes,
    firmPick: cell(outcomes.pick, n),
    firmPickInCategory: cell(inCategoryPicks, n),
    picks: {
      inCategory: inCategoryPicks,
      ruledOut: [...ruledOut.values()].reduce((a, b) => a + b, 0),
      pending: [...pending.values()].reduce((a, b) => a + b, 0),
      notInDictionary: [...unknown.values()].reduce((a, b) => a + b, 0),
    },
    ruledOutPicks: topCounts(ruledOut),
    pendingPicks: topCounts(pending),
    notInDictionaryPicks: topCounts(unknown),
    brands,
    byStage: stages.map((s) => sliceOf(s, s, facts.filter((f) => f.stage === s), targetKey)),
    byEngine: models.map((m) =>
      sliceOf(m, engineLabel.get(m) ?? m, facts.filter((f) => f.model === m), targetKey)
    ),
  };
}

// h2 (2026-10-28): names resolve through the context judge (context_judge.ts).
const HEADLINE_VERSION = "h3";
export function computeHeadlineCached(run: Run, project: Project, room?: string): Promise<HeadlineView | null> {
  if (room === undefined) return cachedView("headline", HEADLINE_VERSION, run, project, computeHeadline, { judge: true });
  return cachedView("headline", HEADLINE_VERSION, run, project, (d) => computeHeadline(d, { room }), { judge: true }, { room });
}
