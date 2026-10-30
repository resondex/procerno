import { matchKey } from "../brand_key";
import { ENGINES, engineDisplayLabel } from "./providers";
import { buildResolver } from "./brand_resolve";
import { roleOf } from "./headline";
import { cachedView, corePanel, type ViewData } from "./view_data";
import { viewsOf } from "./views";
import type { Intent, Project, Run } from "../types";

/**
 * The Workbench view (2026-10-30): the analyst's slicing surface, read from
 * answer_codes under the project's codes_source. Unlike the other per-type
 * views this one does not pre-aggregate: it ships ONE compact fact table -
 * per coded answer, its engine, prompt, outcome, resolved pick, resolved
 * mentions with framing in order of first appearance, and reason codes - so
 * every filter (brand set, grain, engine scope, split) slices in the
 * browser. One load per open, no per-slice refetch (the legacy slices route
 * recomputed server-side per brand x engine-subset request).
 *
 * Pools follow the presentation rule (CODING_DECISIONS sections 8 and 12):
 * `rows` is the HEADLINE pool (open-choice answers on the core panel) and
 * carries outcome / pick / reasons - the funnel, Why and Battleground read
 * only it. `extra` is every other coded answer on the core panel with its
 * mention framings alone - Risk's framing table reads rows + extra, since a
 * negative mention is a negative wherever the question came from. `doubt`
 * is the per-engine rollup of the doubt verdicts (objections and
 * churn/renewal), target-only by construction.
 *
 * Dropped from the legacy Workbench, not faked: Sources (citations are
 * responses metadata, not answer_codes - waits for its own round), Style
 * (same), Answers (reads answer bodies through the legacy coder columns),
 * and negative verbatim quotes (the labels' quote field is the row's
 * verdict receipt, not per-brand evidence - the read-time evidence layer is
 * the successor). Position metrics stay: mentions carry first-appearance
 * rank, so order among tracked brands is real measurement, encoded here as
 * the mention array's order.
 */

export interface WorkbenchBrand {
  name: string;
  role: "target" | "competitor" | "emerged";
  /** Parent-company label for the parents grain; null = its own parent. */
  parent: string | null;
  /** False = active but un-analyzed: counted in denominators (a pick of it
   * is still in-category) but hidden from pickers and tables. */
  listed: boolean;
}

export interface WorkbenchEngine {
  id: string;
  label: string;
  mode: "instinct" | "search";
}

export interface WorkbenchPrompt {
  text: string;
  stage: string;
  /** True = headline (open-choice) pool - the Battleground's rows. */
  open: boolean;
}

/** [brand index, framing bits (1 = recommended, 2 = negative)] - the array
 * is ordered by first appearance in the answer, so position is the index. */
export type WbMention = [number, number];

/** Open-pool answer: [engine, prompt, outcome, pick, mentions, reasons].
 * outcome: 0 pick / 1 conditional / 2 no_pick / 3 clarification / -1 other.
 * pick: brand index; -2 = firm pick outside the category; -1 = none. */
export type WbOpenRow = [number, number, number, number, WbMention[], number[]];

/** Any other coded answer: [engine, prompt, mentions]. */
export type WbExtraRow = [number, number, WbMention[]];

/** Per-engine doubt verdicts. buyers = objections (stay = proceed, go =
 * avoid); customers = churn/renewal (stay = keep, go = leave). */
export interface WorkbenchDoubt {
  engine: number;
  kind: "buyers" | "customers";
  answers: number;
  stay: number;
  go: number;
  judged: number;
  confirms: number;
}

export interface WorkbenchView {
  runId: string;
  projectId: string;
  source: string;
  brand: string;
  /** Index of the target in `brands`. */
  target: number;
  /** Open-pool answers on the core panel, and those with no code row. */
  answers: number;
  uncoded: number;
  /** Most-named first; index-addressed by rows/extra. */
  brands: WorkbenchBrand[];
  engines: WorkbenchEngine[];
  prompts: WorkbenchPrompt[];
  /** Reason vocabulary, most argued first; index-addressed by rows. */
  codes: string[];
  rows: WbOpenRow[];
  extra: WbExtraRow[];
  doubt: WorkbenchDoubt[];
}

const OUTCOMES = ["pick", "conditional", "no_pick", "clarification"];

export function computeWorkbench(data: ViewData): WorkbenchView {
  const { run, project, source, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const legacy = new Set(project.competitors.map(matchKey));
  const entryByKey = new Map(dictionary.map((e) => [e.id, e]));

  // The pool: every answer whose cell routes to any view, open flagged.
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const promptMeta = new Map<string, { intent: Intent; open: boolean; doubt: "buyers" | "customers" | null }>();
  for (const p of data.prompts) {
    const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
    if (!it) continue;
    const views = viewsOf(it.stage, it.angle);
    if (views.length === 0) continue;
    promptMeta.set(p.id, {
      intent: it,
      open: views.includes("headline"),
      doubt: views.includes("doubt") ? "buyers" : views.includes("keep_or_leave") ? "customers" : null,
    });
  }
  const core = corePanel(data);
  const pool = new Map<string, { promptId: string; model: string; open: boolean; doubt: "buyers" | "customers" | null }>();
  for (const r of data.responses) {
    const meta = promptMeta.get(r.prompt_id);
    const model = r.model ?? run.model;
    if (meta && core.has(model)) pool.set(r.id, { promptId: r.prompt_id, model, ...meta });
  }

  // Pass 1: resolve every answer's facts against brand/prompt/code KEYS;
  // indices are assigned after the tallies so the lists sort by volume.
  interface Fact {
    model: string;
    promptId: string;
    open: boolean;
    doubt: "buyers" | "customers" | null;
    outcome: number;
    pickKey: string | null; // brand key, "" = out-of-category firm pick
    mentions: { key: string; bits: number }[];
    reasons: string[];
    stayGo: "stay" | "go" | null;
    premise: "confirms" | "other" | null;
  }
  const facts: Fact[] = [];
  const named = new Map<string, number>();
  let openAnswers = 0;
  let openCoded = 0;
  for (const at of pool.values()) if (at.open) openAnswers++;
  for (const c of data.codes) {
    const at = pool.get(c.response_id);
    if (!at) continue;
    if (at.open) openCoded++;
    // Mentions: active entries only, min rank per brand, framings OR'd.
    const byBrand = new Map<string, { bits: number; rank: number }>();
    for (const m of c.mentions ?? []) {
      const r = resolve(m.brand);
      if (r.status !== "active") continue;
      const prev = byBrand.get(r.key);
      const bits = (m.framing === "recommended" ? 1 : 0) | (m.framing === "negative" ? 2 : 0);
      if (prev) {
        prev.bits |= bits;
        prev.rank = Math.min(prev.rank, m.rank);
      } else {
        byBrand.set(r.key, { bits, rank: m.rank });
      }
    }
    let pickKey: string | null = null;
    if (c.outcome === "pick" && c.top_pick) {
      const r = resolve(c.top_pick);
      if (r.status === "active") {
        pickKey = r.key;
        // The crowned brand always counts as named and recommended
        // (headline.ts factsOf); an unranked pick sits after the mentions.
        const prev = byBrand.get(r.key);
        if (prev) prev.bits |= 1;
        else byBrand.set(r.key, { bits: 1, rank: Number.MAX_SAFE_INTEGER });
      } else {
        pickKey = "";
      }
    }
    const mentions = [...byBrand.entries()]
      .sort((a, b) => a[1].rank - b[1].rank)
      .map(([key, v]) => ({ key, bits: v.bits }));
    for (const m of mentions) named.set(m.key, (named.get(m.key) ?? 0) + 1);
    const stayGo =
      at.doubt === "buyers"
        ? c.proceed_or_avoid === "proceed" ? ("stay" as const) : c.proceed_or_avoid === "avoid" ? ("go" as const) : null
        : at.doubt === "customers"
          ? c.keep_or_leave === "keep" ? ("stay" as const) : c.keep_or_leave === "leave" ? ("go" as const) : null
          : null;
    facts.push({
      model: at.model,
      promptId: at.promptId,
      open: at.open,
      doubt: at.doubt,
      outcome: c.outcome ? OUTCOMES.indexOf(c.outcome) : -1,
      pickKey,
      mentions,
      reasons: at.open ? (c.reasons ?? []) : [],
      stayGo,
      premise: c.premise_verdict === null ? null : c.premise_verdict === "confirms" ? "confirms" : "other",
    });
  }

  // Brand list: every active brand the pool names plus the target, most
  // named first; un-analyzed actives stay as unlisted denominators.
  if (!named.has(targetKey)) named.set(targetKey, 0);
  const brandKeys = [...named.keys()].sort(
    (a, b) => (named.get(b) ?? 0) - (named.get(a) ?? 0) || a.localeCompare(b)
  );
  const brandIdx = new Map(brandKeys.map((k, i) => [k, i]));
  const brands: WorkbenchBrand[] = brandKeys.map((key) => {
    const entry = entryByKey.get(key) ?? null;
    return {
      name: entry ? entry.display_name ?? entry.canonical : project.brand,
      role: roleOf(key, targetKey, entry, legacy),
      parent: entry?.parent ?? null,
      listed: key === targetKey || !entry || entry.analyzed,
    };
  });

  // Engine, prompt and code indices, by volume where it reads better.
  const engineMeta = new Map(ENGINES.map((e) => [e.id, { label: engineDisplayLabel(e), mode: e.mode }]));
  const engineIds = [...core].filter((m) => facts.some((f) => f.model === m));
  const engineIdx = new Map(engineIds.map((m, i) => [m, i]));
  const engines: WorkbenchEngine[] = engineIds.map((id) => {
    const meta = engineMeta.get(id);
    return { id, label: meta?.label ?? id, mode: meta?.mode ?? "instinct" };
  });
  const promptIds = [...new Set(facts.map((f) => f.promptId))];
  const promptIdx = new Map(promptIds.map((p, i) => [p, i]));
  const promptText = new Map(data.prompts.map((p) => [p.id, p.text]));
  const prompts: WorkbenchPrompt[] = promptIds.map((id) => {
    const meta = promptMeta.get(id)!;
    return { text: promptText.get(id) ?? "", stage: meta.intent.stage, open: meta.open };
  });
  const codeCount = new Map<string, number>();
  for (const f of facts) for (const r of f.reasons) codeCount.set(r, (codeCount.get(r) ?? 0) + 1);
  const codes = [...codeCount.keys()].sort(
    (a, b) => (codeCount.get(b) ?? 0) - (codeCount.get(a) ?? 0) || a.localeCompare(b)
  );
  const codeIdx = new Map(codes.map((c, i) => [c, i]));

  // Pass 2: encode.
  const rows: WbOpenRow[] = [];
  const extra: WbExtraRow[] = [];
  const doubtAgg = new Map<string, WorkbenchDoubt>();
  for (const f of facts) {
    const e = engineIdx.get(f.model)!;
    const p = promptIdx.get(f.promptId)!;
    const mentions: WbMention[] = f.mentions.map((m) => [brandIdx.get(m.key)!, m.bits]);
    if (f.open) {
      const pick = f.pickKey === null ? -1 : f.pickKey === "" ? -2 : brandIdx.get(f.pickKey)!;
      rows.push([e, p, f.outcome, pick, mentions, f.reasons.map((r) => codeIdx.get(r)!)]);
    } else {
      extra.push([e, p, mentions]);
    }
    if (f.doubt) {
      const k = `${e}:${f.doubt}`;
      const d = doubtAgg.get(k) ?? { engine: e, kind: f.doubt, answers: 0, stay: 0, go: 0, judged: 0, confirms: 0 };
      d.answers++;
      if (f.stayGo === "stay") d.stay++;
      if (f.stayGo === "go") d.go++;
      if (f.premise !== null) d.judged++;
      if (f.premise === "confirms") d.confirms++;
      doubtAgg.set(k, d);
    }
  }

  return {
    runId: run.id,
    projectId: project.id,
    source,
    brand: project.brand,
    target: brandIdx.get(targetKey)!,
    answers: openCoded,
    uncoded: openAnswers - openCoded,
    brands,
    engines,
    prompts,
    codes,
    rows,
    extra,
    doubt: [...doubtAgg.values()],
  };
}

const WORKBENCH_VERSION = "wb1";
export function computeWorkbenchCached(run: Run, project: Project): Promise<WorkbenchView | null> {
  return cachedView("workbench", WORKBENCH_VERSION, run, project, computeWorkbench, { judge: true });
}
