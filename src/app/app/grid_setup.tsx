"use client";

import { useState } from "react";

/**
 * Buyer Landscape setup pieces: the state shape, the gate API calls, and
 * one view per gate. The wizard decides where these live (rail, footer,
 * container); these know nothing about that.
 *
 * The model: rows are stages, columns are scenarios, and each scenario
 * walks the stages its buyer actually walks - the participation mask.
 * Gate 1 renders the mask as the coverage map.
 */

export const PHRASING_COUNT = 10;
/** Cells per paraphrase request - keeps each call well inside the function limit. */
const PHRASING_BATCH = 8;

export const LAYERS = [
  "awareness",
  "consideration",
  "decision",
  "retention",
  "loyalty",
] as const;

export interface GridPhrasing {
  text: string;
  /** The buyer voice this phrasing is written in. */
  asker: string;
}

export interface GridCellUi {
  stage: string;
  layer: string;
  /** Scenario label, or null for invariant single cells. */
  situation: string | null;
  angle: string;
  /** Invariant cells only: comma-joined scenario labels whose journeys
   * reach this stage, when not universal. */
  mode?: string | null;
  text: string;
  /** Paraphrases beyond the seed text; empty until gate 3. */
  phrasings: GridPhrasing[];
}

export interface Journey {
  involvement: string;
  verifiability: string;
  think_feel: string;
  decision_unit: string;
}

export interface GridStage {
  key: string;
  label: string;
  layer: string;
  situational: boolean;
  rivals: "none" | "each" | "defensive_offensive";
  tag: "picks" | "rules" | "judges" | "steers";
  /** Whether any scenario's journey reaches this stage. */
  recommended: boolean;
  /** Labels of the scenarios (as last composed) whose journeys reach it. */
  columns: string[];
  /** What the stage asks - shown on hover. Absent on older drafts. */
  hint?: string;
  /** Why the rules recommend or skip it for this market - shown on hover. */
  why?: string;
}

export interface ScenarioRow {
  label: string;
  description: string;
  /** Structural journey delta; null = inherits the base read. */
  journey: Journey | null;
  /** Came from the model - never deletable, only unticked. */
  suggested: boolean;
  /** Whether this column is in the grid. */
  on: boolean;
  /** The wording as last machine-generated (suggestion or drawn variant) -
   * an edited row is one whose text differs from this. */
  original?: { label: string; description: string };
  /** The compose-time original, immutable - "Reset to suggested" returns
   * here and re-opens the variant walk. */
  first?: { label: string; description: string };
  /** The precomputed near-variant pool for this card (3 alternates of
   * `first`), prefetched at gate landing and kept through resets. */
  pool?: { label: string; description: string }[];
  /** Near-neighbor draws used on this card (capped at MAX_VARIANTS). */
  variants?: number;
}

/** Absolute scenario-column maximum; a plan's cap can be lower
 * (PLAN_SCENARIO_CAPS - Starter and Growth include 3, Pro the 4th). */
export const MAX_SCENARIOS = 4;
/** Near-neighbor draws per card before we ask the user to write their own. */
export const MAX_VARIANTS = 3;

export interface GridState {
  step: "compose" | "cells" | "phrasings";
  /** The market's base read; scenarios inherit it unless they deviate. */
  moderators: Record<string, unknown> & { rationale?: string };
  stages: GridStage[];
  keptStages: string[];
  /** The ACTIVE scenarios with their journeys - what the planner uses.
   * Kept in sync with scenarioRows by withScenarioRows(). */
  scenarios: { label: string; description: string; journey: Journey | null }[];
  scenarioRows?: ScenarioRow[];
  /** Alternates from the market read, not yet shown - "Suggest another"
   * draws from here first (instant); the model is only asked once the pool
   * runs dry. Reserve scenarios inherit the base journey. */
  reserve?: { label: string; description: string }[];
  /** Fingerprints (label|description) of user-authored scenarios that
   * PASSED the quality check, persisted with the draft so unchanged rows
   * are never rechecked. Deliberately excludes "keep mine" choices - a
   * declined suggestion pops up again on the next confirm. */
  reviewedScenarios?: string[];
  cells: GridCellUi[];
}

/** House punctuation for prompt text - mirror of the engine's humanize().
 * Applied on draft load so text frozen in old drafts complies too. */
function scrubPrompt(t: string): string {
  return t
    .replace(/\s*[\u2014\u2013]\s*/g, " - ")
    .replace(/~\s*(?=\d)/g, "about ")
    .replace(/~/g, "")
    .replace(/  +/g, " ");
}

/** Drafts from before the participation mask (mode-era or phrasing-string
 * era) don't carry mask columns; they restart at compose rather than risk
 * a half-translated grid. Prompt text is scrubbed to house punctuation on
 * the way in. */
export function normalizeGrid(g: GridState | null): GridState | null {
  if (!g) return null;
  const legacy =
    (g as unknown as { modes?: unknown }).modes !== undefined ||
    g.stages.length === 0 ||
    (g.stages[0] as { columns?: unknown }).columns === undefined;
  if (legacy) return null;
  return {
    ...g,
    cells: g.cells.map((c) => ({
      ...c,
      text: scrubPrompt(c.text),
      phrasings: c.phrasings.map((ph) => ({ ...ph, text: scrubPrompt(ph.text) })),
    })),
  };
}

/** The editable scenario table; derived from the active list when absent. */
export function scenarioRows(g: GridState): ScenarioRow[] {
  return (
    g.scenarioRows ??
    g.scenarios.map((s) => ({ ...s, suggested: true, on: true, original: { label: s.label, description: s.description } }))
  );
}

export function withScenarioRows(g: GridState, rows: ScenarioRow[]): GridState {
  return {
    ...g,
    scenarioRows: rows,
    scenarios: rows
      .filter((r) => r.on)
      .map(({ label, description, journey }) => ({ label, description, journey })),
  };
}

function rowsFromSuggested(
  list: { label: string; description: string; journey: Journey | null }[],
  cap: number
): ScenarioRow[] {
  return list.map((s, i) => ({
    ...s, suggested: true, on: i < cap,
    original: { label: s.label, description: s.description },
    first: { label: s.label, description: s.description },
  }));
}

/** Prompts the tracker will hold: every kept seed plus its paraphrases. */
export function gridPromptCount(g: GridState | null): number {
  if (!g) return 0;
  return g.cells
    .filter((c) => c.text.trim())
    .reduce((n, c) => n + 1 + c.phrasings.filter((p) => p.text.trim()).length, 0);
}

/** The columns a kept stage runs in, given the active scenario set. A kept
 * stage no journey reaches was forced in by the user: it runs everywhere
 * (mirrors the engine's override semantics). */
export function stageColumns(st: GridStage, activeLabels: string[]): string[] {
  const cols = st.columns.filter((c) => activeLabels.includes(c));
  return cols.length > 0 ? cols : st.recommended ? [] : activeLabels;
}

/** Cells the kept stages and active scenarios will produce - the same mask
 * rules the engine's planner applies, so the count is exact before anything
 * is written. */
export function gridCellCount(g: GridState | null, rivalCount: number): number {
  if (!g) return 0;
  const r = Math.min(rivalCount, 4);
  const kept = new Set(g.keptStages);
  const active = g.scenarios.map((s) => s.label);
  return g.stages
    .filter((s) => kept.has(s.key))
    .reduce((n, s) => {
      const cols = stageColumns(s, active);
      const effective = cols.length > 0 ? cols : active;
      if (s.rivals === "each") return n + r;
      if (s.rivals === "defensive_offensive") return n + 1 + r;
      if (s.situational) return n + Math.max(effective.length, 1);
      return n + 1;
    }, 0);
}

export function namesAny(text: string, names: string[]): boolean {
  const t = text.toLowerCase();
  return names.some((n) => n.trim() && t.includes(n.trim().toLowerCase()));
}

/** The base read, as editable dimensions. Changing one recomposes the mask
 * - pure code on the server, so it is instant. */
export const MODERATOR_FIELDS: { key: string; options: [string, string][] }[] = [
  { key: "verifiability", options: [["spec", "spec-driven"], ["taste", "taste-driven"], ["trust", "trust-driven"]] },
  { key: "involvement", options: [["considered", "considered"], ["habitual", "habitual"]] },
  { key: "think_feel", options: [["think", "rational"], ["feel", "identity-led"]] },
  { key: "decision_unit", options: [["solo", "solo buyer"], ["household", "household"], ["committee", "committee-bought"]] },
  { key: "rhythm", options: [["one_shot", "one-shot"], ["replenishment", "replenishment"], ["subscription", "subscription"]] },
  { key: "risk", options: [["performance", "performance risk"], ["financial", "financial risk"], ["social", "social risk"], ["physical", "physical risk"]] },
];

/** The four structural dimensions a scenario's journey can override. */
export const JOURNEY_FIELDS = MODERATOR_FIELDS.slice(0, 4);

/** What an AI answer at each stage does to the market - the chip on every
 * library row and cell header. */
export const TAG_INFO: Record<GridStage["tag"], { label: string; cls: string; blurb: string }> = {
  picks: {
    label: "picks a brand",
    cls: "bg-primary-soft text-primary",
    blurb: "answers name winners among competitors - these feed the funnel",
  },
  rules: {
    label: "shapes the rules",
    cls: "bg-surface-1 text-ink-3 border border-line",
    blurb: "answers teach the buyer how to decide; nobody is named, influence happens anyway",
  },
  judges: {
    label: "judges your brand",
    cls: "bg-warning/10 text-warning",
    blurb: "verdicts on you by name - standing, not selection; within-brand tier questions live in Pricing",
  },
  steers: {
    label: "steers your customers",
    cls: "bg-success/10 text-success",
    blurb: "answers reaching people you already won - where assistant-induced churn lives",
  },
};

/* ------------------------------- API calls ------------------------------ */

export interface GridSetupArgs {
  brand: string;
  category: string;
  competitors: string[];
  audience: string;
  /** The plan's scenario cap; defaults to the absolute maximum. */
  maxScenarios?: number;
  state: GridState | null;
  setState: (s: GridState | null | ((prev: GridState | null) => GridState | null)) => void;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
}

export function useGridSetup(a: GridSetupArgs) {
  const cap = a.maxScenarios ?? MAX_SCENARIOS;
  async function post<T>(path: string, body: unknown): Promise<T | null> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      a.setError(data.error ?? "something went wrong");
      return null;
    }
    return data as T;
  }

  /** Gate 1. With an edited read supplied, recomposition is pure code on
   * the server - no model call, effectively instant. */
  async function compose(edit?: {
    base: GridState["moderators"];
    rows: ScenarioRow[];
  }): Promise<GridState | null> {
    a.setBusy(edit ? "Recomposing…" : "Reading your market…");
    a.setError(null);
    const activeRows = edit?.rows.filter((r) => r.on && r.label.trim()) ?? [];
    const data = await post<{
      base: GridState["moderators"];
      scenarios: { label: string; description: string; journey: Journey | null }[];
      reserve?: { label: string; description: string }[];
      stages: GridStage[];
    }>("/api/setup/grid/compose", {
      category: a.category,
      audience: a.audience || undefined,
      ...(edit && activeRows.length > 0
        ? {
            base: edit.base,
            scenarios: activeRows.map(({ label, description, journey }) => ({ label, description, journey })),
          }
        : {}),
    });
    a.setBusy(null);
    if (!data) return null;
    let rows: ScenarioRow[];
    if (edit) {
      // Keep the user's table (ticks, custom rows, off rows); take the
      // server's clamped journeys for the rows it saw (A4 enforcement).
      const byLabel = new Map(data.scenarios.map((s) => [s.label, s.journey] as const));
      rows = edit.rows.map((r) =>
        r.on && byLabel.has(r.label) ? { ...r, journey: byLabel.get(r.label) ?? null } : r
      );
    } else {
      rows = rowsFromSuggested(data.scenarios, cap);
    }
    const next: GridState = withScenarioRows(
      {
        step: "compose",
        moderators: data.base,
        stages: data.stages,
        keptStages: data.stages.filter((s) => s.recommended).map((s) => s.key),
        scenarios: [],
        // An edited recompose returns no reserve; the pool carries over,
        // as do the already-checked scenario fingerprints.
        reserve: data.reserve ?? a.state?.reserve,
        reviewedScenarios: a.state?.reviewedScenarios,
        cells: [],
      },
      rows
    );
    // An edited recompose keeps the user's OVERRIDES (ticks that disagreed
    // with the old recommendation); everything else follows the new
    // recommendations, so a read change moves the defaults with it.
    if (edit && a.state) {
      const prevByKey = new Map(a.state.stages.map((s) => [s.key, s]));
      const prevKept = new Set(a.state.keptStages);
      next.keptStages = data.stages
        .filter((s) => {
          const prev = prevByKey.get(s.key);
          if (!prev) return s.recommended;
          const wasKept = prevKept.has(s.key);
          const overridden = wasKept !== prev.recommended;
          return overridden ? wasKept : s.recommended;
        })
        .map((s) => s.key);
    }
    a.setState(next);
    return next;
  }

  /** Gate 1 helper: one more scenario, distinct from everything listed.
   * Drawn from the market read's cached reserve pool when one remains
   * (instant); the model is only asked once the pool runs dry.
   * Suggestions always inherit the base journey. */
  async function suggestScenario(): Promise<void> {
    if (!a.state) return;
    const rows = scenarioRows(a.state);
    const listed = new Set(rows.map((r) => r.label.trim().toLowerCase()));
    const pool = (a.state.reserve ?? []).filter((s) => !listed.has(s.label.trim().toLowerCase()));
    let scenario: { label: string; description: string };
    let reserve = a.state.reserve;
    if (pool.length > 0) {
      scenario = pool[0];
      reserve = (a.state.reserve ?? []).filter((s) => s.label !== scenario.label);
    } else {
      a.setBusy("Thinking of another scenario…");
      a.setError(null);
      const data = await post<{ scenario: { label: string; description: string } }>(
        "/api/setup/grid/scenario",
        {
          category: a.category,
          audience: a.audience || undefined,
          decisionUnit: a.state.moderators.decision_unit,
          exclude: rows.map(({ label, description }) => ({ label, description })),
        }
      );
      a.setBusy(null);
      if (!data) return;
      scenario = data.scenario;
    }
    const active = rows.filter((r) => r.on).length;
    const nextRows: ScenarioRow[] = [
      ...rows,
      {
        ...scenario, journey: null, suggested: true, on: active < cap,
        original: { ...scenario }, first: { ...scenario },
      },
    ];
    const drawn: GridState = { ...a.state, reserve };
    if (active < cap) {
      a.setState(drawn);
      await compose({ base: drawn.moderators, rows: nextRows });
    } else {
      a.setState(withScenarioRows(drawn, nextRows));
    }
  }

  /** The identity a card's variant pool is keyed on: the compose-time
   * original when there is one. */
  function poolAnchor(r: ScenarioRow): { label: string; description: string } {
    return r.first ?? r.original ?? { label: r.label, description: r.description };
  }

  async function fetchPool(
    anchor: { label: string; description: string },
    exclude: { label: string; description: string }[],
    decisionUnit: string,
    silent: boolean
  ): Promise<{ label: string; description: string }[] | null> {
    try {
      const res = await fetch("/api/setup/grid/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: a.category,
          audience: a.audience || undefined,
          decisionUnit,
          exclude: exclude.filter((s) => s.label.trim()).slice(-24),
          nearTo: anchor,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A background warm-up must never paint the gate red.
        if (!silent) a.setError(data.error ?? "something went wrong");
        return null;
      }
      return (data.variants as { label: string; description: string }[]) ?? null;
    } catch {
      return null;
    }
  }

  /** Prefetch the near-variant pool for every suggested card that lacks
   * one - fired when the scenarios gate lands, silent, in parallel, so
   * every draw afterwards is instant. Merges into the freshest state.
   * `fresh` covers callers holding a newer state than this closure. */
  async function prefetchNearPools(fresh?: GridState | null): Promise<void> {
    const st = fresh ?? a.state;
    if (!st) return;
    const rows = scenarioRows(st);
    const targets = rows.filter((r) => r.suggested && r.label.trim() && !r.pool);
    if (targets.length === 0) return;
    const exclude = rows.map(({ label, description }) => ({ label, description }));
    const du = String(st.moderators.decision_unit ?? "committee");
    const results = await Promise.all(
      targets.map(async (r) => ({
        key: poolAnchor(r).label,
        pool: await fetchPool(poolAnchor(r), exclude, du, true).catch(() => null),
      }))
    );
    const byKey = new Map(results.filter((x) => x.pool?.length).map((x) => [x.key, x.pool!]));
    if (byKey.size === 0) return;
    a.setState((prev) => {
      if (!prev) return prev;
      return withScenarioRows(
        prev,
        scenarioRows(prev).map((r) =>
          !r.pool && byKey.has(poolAnchor(r).label)
            ? { ...r, pool: byKey.get(poolAnchor(r).label) }
            : r
        )
      );
    });
  }

  /** Gate 1 helper: a near variant of one card - same circumstance, one
   * detail moved. Draws walk the card's precomputed pool (instant); the
   * pool is fetched on demand only if the prefetch hasn't landed yet. */
  async function nearScenario(i: number): Promise<void> {
    if (!a.state) return;
    const rows = scenarioRows(a.state);
    const row = rows[i];
    if (!row?.label.trim()) return;
    const used = row.variants ?? 0;
    if (used >= MAX_VARIANTS) return;
    let pool = row.pool;
    if (!pool || pool.length === 0) {
      a.setBusy("Finding a near neighbor…");
      a.setError(null);
      pool = (await fetchPool(
        poolAnchor(row),
        rows.map(({ label, description }) => ({ label, description })),
        String(a.state.moderators.decision_unit ?? "committee"),
        false
      )) ?? undefined;
      a.setBusy(null);
      if (!pool || pool.length === 0) return;
    }
    const variant = pool[Math.min(used, pool.length - 1)];
    // The draw is the rejection signal for the current wording - logged
    // for OUR visibility only, never read back into generation.
    void fetch("/api/setup/grid/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: a.category,
        audience: a.audience || undefined,
        kind: "near_draw",
        rejected: { label: row.label, description: row.description },
        drawn: variant,
      }),
    }).catch(() => {});
    const nextRows = rows.map((r, j) =>
      j === i
        ? {
            ...r,
            label: variant.label,
            description: variant.description,
            original: { ...variant },
            variants: used + 1,
            pool,
          }
        : r
    );
    if (row.on) {
      await compose({ base: a.state.moderators, rows: nextRows });
    } else {
      a.setState(withScenarioRows(a.state, nextRows));
    }
  }

  /** Gate 2: one seed prompt per masked cell. */
  async function writeCells(): Promise<GridState | null> {
    if (!a.state) return null;
    a.setBusy("Writing your prompts…");
    a.setError(null);
    const data = await post<{ cells: Omit<GridCellUi, "phrasings">[] }>(
      "/api/setup/grid/cells",
      {
        brand: a.brand, category: a.category, competitors: a.competitors,
        audience: a.audience || undefined,
        base: a.state.moderators,
        scenarios: a.state.scenarios,
        stageKeys: a.state.keptStages,
      }
    );
    a.setBusy(null);
    if (!data) return null;
    const next: GridState = {
      ...a.state,
      step: "cells",
      cells: data.cells.map((c) => ({ ...c, phrasings: [] })),
    };
    a.setState(next);
    return next;
  }

  /** Gate 3: paraphrase sets, in small batches so no request runs long. */
  async function writePhrasings(force = false): Promise<GridState | null> {
    if (!a.state) return null;
    a.setError(null);
    const cells = a.state.cells.filter((c) => c.text.trim());
    const merged: GridCellUi[] = cells.map((c) => ({ ...c, phrasings: [] }));
    const batches: { layer: string; idx: number[] }[] = [];
    for (const layer of LAYERS) {
      const idx = merged.map((c, i) => (c.layer === layer ? i : -1)).filter((i) => i >= 0);
      for (let k = 0; k < idx.length; k += PHRASING_BATCH) {
        batches.push({ layer, idx: idx.slice(k, k + PHRASING_BATCH) });
      }
    }
    let done = 0;
    for (const { layer, idx } of batches) {
      a.setBusy(`Writing paraphrases… ${layer} (${done}/${cells.length})`);
      const data = await post<{ phrasings: GridPhrasing[][] }>(
        "/api/setup/grid/phrasings",
        {
          brand: a.brand, category: a.category, competitors: a.competitors,
          audience: a.audience || undefined,
          base: a.state.moderators,
          scenarios: a.state.scenarios,
          cells: idx.map((i) => ({
            stage: merged[i].stage,
            situation: merged[i].situation,
            angle: merged[i].angle,
            mode: merged[i].mode ?? null,
            text: merged[i].text,
          })),
          count: PHRASING_COUNT,
          force,
        }
      );
      if (!data) {
        a.setBusy(null);
        return null;
      }
      idx.forEach((i, k) => {
        merged[i] = { ...merged[i], phrasings: data.phrasings[k] ?? [] };
      });
      done += idx.length;
    }
    a.setBusy(null);
    const next: GridState = { ...a.state, step: "phrasings", cells: merged };
    a.setState(next);
    return next;
  }

  return { compose, writeCells, writePhrasings, suggestScenario, nearScenario, prefetchNearPools };
}

/* -------------------------------- views --------------------------------- */

function stageOf(state: GridState, key: string): GridStage | undefined {
  return state.stages.find((s) => s.key === key);
}

export function cellMeta(state: GridState, c: GridCellUi): string {
  return (
    (stageOf(state, c.stage)?.label ?? c.stage) +
    (c.situation ? ` · ${c.situation}` : "") +
    (c.angle !== "generic"
      ? ` · ${c.angle === "defensive" ? "your churn moment" : `vs ${c.angle}`}`
      : "") +
    (c.mode ? ` · asked by: ${c.mode}` : "")
  );
}

function TagChip({ tag }: { tag: GridStage["tag"] }) {
  const info = TAG_INFO[tag];
  return (
    <span
      title={info.blurb}
      className={`rounded-full px-1.5 py-px text-[9px] font-medium whitespace-nowrap ${info.cls}`}
    >
      {info.label}
    </span>
  );
}

/** Step "Buying scenarios": one card per scenario - tick, label,
 * description, and the journey. Nothing else competes for the screen. */
export function ScenariosGate({
  state, setState, onRecompose, onSuggestScenario, onNearScenario, busy,
  maxScenarios = MAX_SCENARIOS,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  onRecompose: (base: GridState["moderators"], rows: ScenarioRow[]) => void;
  onSuggestScenario: () => void;
  /** Draw a near variant of card i - same circumstance, one detail moved. */
  onNearScenario: (i: number) => void;
  busy: boolean;
  /** The plan's scenario cap (PLAN_SCENARIO_CAPS). */
  maxScenarios?: number;
}) {
  const [editRead, setEditRead] = useState(false);
  const cap = maxScenarios;
  const rows = scenarioRows(state);
  const active = rows.filter((r) => r.on);
  const deviatingLabel = active.find((r) => r.journey !== null)?.label ?? null;
  const displayOf = (key: string, value: unknown) =>
    JOURNEY_FIELDS.find((f) => f.key === key)?.options.find(([k]) => k === String(value))?.[1] ??
    String(value ?? "");
  const marketStyle = JOURNEY_FIELDS
    .map((f) => displayOf(f.key, state.moderators[f.key]))
    .join(" · ");
  const readSentence = MODERATOR_FIELDS.map((f) => {
    const v = String(state.moderators[f.key] ?? "");
    return f.options.find(([k]) => k === v)?.[1];
  }).filter(Boolean).join(" · ");
  const setRows = (next: ScenarioRow[], recompose = false) => {
    if (recompose) onRecompose(state.moderators, next);
    else setState(withScenarioRows(state, next));
  };
  const updateRow = (i: number, patch: Partial<ScenarioRow>, recompose = false) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)), recompose);

  return (
    <div className="grid gap-3 max-w-4xl">
      <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Your market buys:
        </span>
        {!editRead ? (
          <>
            <span className="text-ink-2">{readSentence}</span>
            <button
              type="button"
              onClick={() => setEditRead(true)}
              className="text-[13px] font-medium text-primary hover:opacity-80"
            >
              change
            </button>
          </>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            {MODERATOR_FIELDS.map((f) => (
              <select
                key={f.key}
                aria-label={f.key.replace("_", " ")}
                value={String(state.moderators[f.key] ?? "")}
                disabled={busy}
                onChange={(e) =>
                  onRecompose({ ...state.moderators, [f.key]: e.target.value }, rows)
                }
                className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary border-0 cursor-pointer"
              >
                {f.options.map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            ))}
            <button
              type="button"
              onClick={() => setEditRead(false)}
              className="text-[13px] font-medium text-ink-3 hover:text-ink"
            >
              done
            </button>
          </span>
        )}
      </div>
      <p className="text-[12px] text-ink-3">
        The circumstances that change the right answer. Each one becomes a
        column of your Landscape - the coverage map on the next step shows
        exactly what each will be asked. Every scenario is asked in the
        buying style above unless it is marked as buying differently - a
        different style means that buyer goes through different stages, so
        its column gets its own set of questions. One scenario per
        Landscape can buy differently: a second buyer with its own style
        isn&apos;t an exception, it&apos;s a second market - and gets its
        own Landscape, so each grid stays readable and every result traces
        to one kind of buyer.
      </p>
      {cap < MAX_SCENARIOS && (
        <p className="text-[12px] text-ink-3">
          Your plan runs <span className="font-medium text-ink">{cap} buying
          scenarios</span> - the {cap + 1}th column unlocks on the Pro plan.
        </p>
      )}
      {rows.map((sc, i) => (
        <div
          key={i}
          className={`rounded-lg border border-line bg-surface px-4 py-3 grid gap-2 ${sc.on ? "" : "opacity-60"}`}
        >
          <div className="flex items-start gap-2.5">
            <input
              type="checkbox"
              aria-label={sc.on ? "remove from grid" : "add to grid"}
              className="mt-2.5"
              checked={sc.on}
              disabled={busy || (!sc.on && active.length >= cap)}
              onChange={(e) => updateRow(i, { on: e.target.checked }, true)}
            />
            <div className="grid gap-1.5 w-full">
              <div className="flex items-center gap-2">
                <input
                  className="input w-56 shrink-0 text-sm font-medium"
                  value={sc.label}
                  placeholder="label"
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                  onBlur={() => sc.on && onRecompose(state.moderators, rows)}
                />
                <span className="flex-1" />
                <label
                  className="flex items-center gap-1.5 text-[11px] text-ink-3 whitespace-nowrap"
                  title={
                    deviatingLabel && deviatingLabel !== sc.label
                      ? `Only one scenario per grid can buy differently (currently: ${deviatingLabel})`
                      : `This scenario's buyer decides by a different process than the rest of your market (${marketStyle})`
                  }
                >
                  <input
                    type="checkbox"
                    checked={sc.journey !== null}
                    disabled={busy || !sc.on || (deviatingLabel !== null && deviatingLabel !== sc.label)}
                    onChange={(e) =>
                      updateRow(
                        i,
                        {
                          journey: e.target.checked
                            ? {
                                involvement: String(state.moderators.involvement ?? "considered"),
                                verifiability: String(state.moderators.verifiability ?? "spec"),
                                think_feel: String(state.moderators.think_feel ?? "think"),
                                decision_unit: String(state.moderators.decision_unit ?? "solo"),
                              }
                            : null,
                        },
                        true
                      )
                    }
                  />
                  {deviatingLabel !== null && deviatingLabel !== sc.label ? (
                    <span className="opacity-60">buys differently · one per Landscape</span>
                  ) : (
                    "buys differently"
                  )}
                </label>
                {sc.suggested ? (
                  <span className="w-5 text-center text-[10px] font-medium uppercase tracking-wide text-primary/70" title="suggested - untick to leave it out">
                    ✓
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label="delete scenario"
                    onClick={() => setRows(rows.filter((_, j) => j !== i), true)}
                    className="w-5 text-ink-3 hover:text-danger text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
              <textarea
                className="input w-full resize-none field-sizing-content text-sm"
                rows={1}
                value={sc.description}
                placeholder="one sentence describing the circumstance"
                onChange={(e) => updateRow(i, { description: e.target.value })}
              />
              {sc.label.trim() !== "" &&
                ((sc.variants ?? 0) < MAX_VARIANTS ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onNearScenario(i)}
                      title="Right idea, wrong details? Draw a close variant of this scenario"
                      className="text-[11px] font-medium text-primary hover:opacity-80 disabled:opacity-50"
                    >
                      ≈ Near neighbor
                    </button>
                    {(sc.variants ?? 0) > 0 && (
                      <span className="text-[10px] text-ink-3">
                        {MAX_VARIANTS - (sc.variants ?? 0)} left
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-[10px] text-ink-3">
                    {MAX_VARIANTS} variations tried - edit the text above to make it yours
                  </span>
                ))}
              {sc.journey && sc.on && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-warning font-semibold">this buyer:</span>
                  {JOURNEY_FIELDS.map((f) => {
                    const value = String(sc.journey?.[f.key as keyof Journey] ?? "");
                    const differs = value !== String(state.moderators[f.key] ?? "");
                    return (
                      <select
                        key={f.key}
                        aria-label={`${sc.label} ${f.key.replace("_", " ")}`}
                        title={
                          differs
                            ? `Differs from your market (${displayOf(f.key, state.moderators[f.key])})`
                            : "Same as your market"
                        }
                        value={value}
                        disabled={busy}
                        onChange={(e) =>
                          updateRow(i, { journey: { ...sc.journey!, [f.key]: e.target.value } }, true)
                        }
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium border-0 cursor-pointer ${
                          differs
                            ? "bg-warning/10 text-warning"
                            : "bg-surface-1 text-ink-3"
                        }`}
                      >
                        {f.options.map(([k, label]) => (
                          <option key={k} value={k}>{label}</option>
                        ))}
                      </select>
                    );
                  })}
                  <span className="text-[10px] text-ink-3">
                    highlighted = differs from your market
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setRows([...rows, { label: "", description: "", journey: null, suggested: false, on: active.length < cap }])}
          className="text-[13px] font-medium text-primary hover:opacity-80"
        >
          + Add your own
        </button>
        <button
          type="button"
          onClick={onSuggestScenario}
          disabled={busy}
          className="text-[13px] font-medium text-primary hover:opacity-80 disabled:opacity-50"
        >
          Suggest another
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() =>
            setRows(
              // Back to the compose-time originals; pools survive so the
              // three near-neighbor draws are available again, instantly.
              rows
                .filter((r) => r.suggested)
                .map((r, i) => {
                  const home = r.first ?? r.original ?? { label: r.label, description: r.description };
                  return {
                    ...r, ...home,
                    original: { ...home },
                    journey: null, on: i < cap, variants: 0,
                  };
                }),
              true
            )
          }
          className="text-[13px] font-medium text-ink-3 hover:text-ink"
        >
          Reset to suggested
        </button>
      </div>
    </div>
  );
}

/** One flagged scenario in the pre-advance quality check. */
export interface ScenarioReviewItem {
  /** Row index in the scenario table. */
  index: number;
  current: { label: string; description: string };
  /** Every problem the reviewer saw, most serious first. */
  flags: ("typo" | "phrasing" | "mixed")[];
  reason: string;
  suggestion: { label: string; description: string };
  choice: "suggestion" | "mine";
}

const FLAG_INFO: Record<ScenarioReviewItem["flags"][number], { label: string; cls: string }> = {
  typo: { label: "typo", cls: "bg-surface-1 text-ink-3 border border-line" },
  phrasing: { label: "clearer phrasing", cls: "bg-primary-soft text-primary" },
  mixed: { label: "mixed decision factors", cls: "bg-warning/10 text-warning" },
};

/** Overlay shown when the gate-confirm quality check flags user-authored
 * scenarios: each gets the reviewer's reason and a side-by-side choice
 * between the suggested edit (default) and the user's own wording. */
export function ScenarioReviewModal({
  items, onChoice, onBack, onContinue, busy,
}: {
  items: ScenarioReviewItem[];
  onChoice: (k: number, choice: ScenarioReviewItem["choice"]) => void;
  onBack: () => void;
  onContinue: () => void;
  busy: boolean;
}) {
  const option = (
    k: number, it: ScenarioReviewItem,
    choice: ScenarioReviewItem["choice"], title: string,
    s: { label: string; description: string }
  ) => (
    <button
      type="button"
      onClick={() => onChoice(k, choice)}
      className={`w-full rounded-lg border px-3 py-2 text-left grid gap-1 ${
        it.choice === choice ? "border-primary bg-primary-soft/40" : "border-line bg-surface hover:border-ink-3"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{title}</span>
      <span className="text-[13px] font-medium">{s.label}</span>
      <span className="text-[12px] text-ink-3">{s.description}</span>
    </button>
  );
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/30 p-6">
      <div className="w-full max-w-2xl max-h-full overflow-y-auto rounded-xl border border-line bg-surface p-5 grid gap-4 shadow-lg">
        <div className="grid gap-1">
          <h3 className="text-[15px] font-semibold">A quick check on your scenarios</h3>
          <p className="text-[12px] text-ink-3">
            These are yours to call - pick either and continue.
          </p>
        </div>
        {items.map((it, k) => (
          <div key={it.index} className={`grid gap-2 ${k > 0 ? "border-t border-line pt-4" : ""}`}>
            {items.length > 1 && (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                {it.current.label}
              </span>
            )}
            <div className="flex items-start gap-2">
              <span className="flex shrink-0 gap-1.5">
                {it.flags.map((f) => (
                  <span key={f} className={`rounded-full px-2 py-px text-[10px] font-medium whitespace-nowrap ${FLAG_INFO[f].cls}`}>
                    {FLAG_INFO[f].label}
                  </span>
                ))}
              </span>
              <p className="text-[12px] text-ink-2">{it.reason}</p>
            </div>
            <div className="grid gap-2">
              {option(k, it, "suggestion", "Suggested edit", it.suggestion)}
              {option(k, it, "mine", "Keep mine", it.current)}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="text-[13px] font-medium text-ink-3 hover:text-ink disabled:opacity-50"
          >
            Back to editing
          </button>
          <button type="button" onClick={onContinue} disabled={busy} className="btn-primary">
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/** Step "Coverage map": the stage × scenario matrix. The base read lives
 * on the scenarios step; columns are read-only here - scenarios are the
 * previous step; stage ticks are the only control (A8: no dot painting,
 * participation stays derived). */
export function CoverageGate({
  state, setState, busy,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  busy: boolean;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const folds = useFolds();
  /** Instant hover card for stage explanations - the native title tooltip
   * sits behind a ~1s OS delay, too slow for scanning a map. */
  const [tip, setTip] = useState<{ x: number; y: number; hint: string; verdict: string } | null>(null);
  const rows = scenarioRows(state);
  const active = rows.filter((r) => r.on);
  const activeLabels = active.map((r) => r.label);
  const kept = new Set(state.keptStages);
  const hidden = state.stages.filter((s) => !s.recommended && !kept.has(s.key));

  const renderRow = (s: GridStage) => {
    const isKept = kept.has(s.key);
    const cols = stageColumns(s, activeLabels);
    const effective = cols.length > 0 ? cols : activeLabels;
    return (
      <tr key={s.key} className={isKept ? "" : "opacity-50"}>
        <td className="px-3 py-1 whitespace-nowrap">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isKept}
              disabled={busy}
              onChange={(e) =>
                setState({
                  ...state,
                  keptStages: e.target.checked
                    ? [...state.keptStages, s.key]
                    : state.keptStages.filter((k) => k !== s.key),
                })
              }
            />
            <span
              className={`${isKept ? "text-ink" : "text-ink-3"}${s.hint || s.why ? " cursor-help underline decoration-dotted decoration-line underline-offset-2" : ""}`}
              onMouseEnter={(e) => {
                if (!s.hint && !s.why) return;
                const r = e.currentTarget.getBoundingClientRect();
                setTip({
                  x: Math.min(r.left, window.innerWidth - 340),
                  y: r.bottom + 6,
                  hint: s.hint ?? "",
                  verdict: s.why
                    ? `${s.recommended ? "Recommended" : "Not recommended"}: ${s.why}`
                    : "",
                });
              }}
              onMouseLeave={() => setTip(null)}
            >
              {s.label}
            </span>
            <TagChip tag={s.tag} />
            {!s.recommended && (
              <span className="text-[9px] uppercase tracking-wide text-ink-3" title="No journey reaches this stage - keep it only if your buyers really do">
                not recommended
              </span>
            )}
          </label>
        </td>
        {s.situational || s.rivals !== "none" ? (
          active.map((sc) => {
            const inCol = isKept && effective.includes(sc.label);
            return (
              <td key={sc.label} className="px-2 py-1 text-center">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    inCol ? "bg-primary" : "border border-dashed border-line"
                  }`}
                  title={inCol ? `${s.label} runs in ${sc.label}` : `${sc.label}'s buyer doesn't reach ${s.label}`}
                />
              </td>
            );
          })
        ) : (
          <td colSpan={active.length} className="px-2 py-1 text-center">
            <span className={`text-[10px] ${isKept ? "text-primary" : "text-ink-3"}`}>
              {isKept
                ? cols.length > 0 && cols.length < activeLabels.length
                  ? `1 cell · asked by: ${cols.join(", ")}`
                  : "1 cell · every scenario"
                : "-"}
            </span>
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-surface-1">
              <th className="px-3 py-2 text-left font-medium text-ink-3 whitespace-nowrap">stage</th>
              {active.map((sc) => (
                <th key={sc.label} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                  <span className={sc.journey ? "text-warning" : "text-ink"}>{sc.label}</span>
                  <span className="block text-[9px] font-normal text-ink-3">
                    {sc.journey ? "buys differently" : "buys like the market"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LAYERS.map((layer) => {
              // Skipped stages render inside their own layer group, in
              // library order - lumping them after the last section made
              // decision-layer stages look like loyalty stages.
              const stages = state.stages.filter(
                (s) =>
                  s.layer === layer &&
                  (s.recommended || kept.has(s.key) || showSkipped)
              );
              if (stages.length === 0) return null;
              const open = folds.open(layer);
              return [
                <tr key={`${layer}-head`}>
                  <td colSpan={1 + active.length} className="border-t border-line">
                    <button
                      type="button"
                      onClick={() => folds.toggle(layer)}
                      className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-primary w-full text-left"
                    >
                      <span aria-hidden="true" className="text-ink-3">{open ? "▾" : "▸"}</span>
                      {layer}
                      {!open && (
                        <span className="font-normal normal-case tracking-normal text-ink-3">
                          · {stages.length} stage{stages.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </button>
                  </td>
                </tr>,
                ...(open ? stages.map(renderRow) : []),
              ];
            })}
          </tbody>
        </table>
      </div>
      {hidden.length > 0 && (
        <button
          type="button"
          onClick={() => setShowSkipped((v) => !v)}
          className="text-[13px] font-medium text-primary hover:opacity-80 w-fit"
        >
          {showSkipped
            ? "Hide not-recommended stages"
            : `+ ${hidden.length} not-recommended stage${hidden.length === 1 ? "" : "s"} available (${hidden.map((s) => s.label).join(", ")})`}
        </button>
      )}
      <p className="text-[12px] text-ink-3">
        Each scenario walks the stages its buyer actually walks - a missing
        dot is a question that buyer never asks, and a cell that never costs
        anything. Keep a not-recommended stage only if your judgement says
        buyers reach it; if the map looks wrong, the reads are usually
        what&apos;s off.
      </p>
      {tip && (
        <div
          data-stage-tip
          className="fixed z-50 w-80 rounded-lg border border-line bg-surface p-3 shadow-lg text-[12px] grid gap-1.5 pointer-events-none"
          style={{ left: tip.x, top: Math.min(tip.y, window.innerHeight - 150) }}
        >
          {tip.hint && <p className="text-ink-2">{tip.hint}</p>}
          {tip.verdict && <p className="text-ink font-medium">{tip.verdict}</p>}
        </div>
      )}
    </div>
  );
}

/** A cell's meta without its stage - for rows already sitting under a
 * stage header. */
function cellSubMeta(c: GridCellUi): string {
  return (
    [
      c.situation,
      c.angle !== "generic"
        ? c.angle === "defensive" ? "your churn moment" : `vs ${c.angle}`
        : null,
      c.mode ? `asked by: ${c.mode}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "all buyers"
  );
}

/** Collapsible section header - a chevron, a title, and a count that shows
 * while collapsed. */
function FoldHeader({
  open, onToggle, title, count, kind,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  count: string;
  kind: "layer" | "stage";
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1.5 text-left w-fit ${
        kind === "layer"
          ? "text-[11px] font-semibold uppercase tracking-wide text-primary"
          : "text-[12px] font-medium text-ink"
      }`}
    >
      <span aria-hidden="true" className="text-ink-3">{open ? "▾" : "▸"}</span>
      {title}
      {!open && (
        <span className="text-[11px] font-normal normal-case tracking-normal text-ink-3">
          · {count}
        </span>
      )}
    </button>
  );
}

function useFolds() {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  return {
    open: (k: string) => !closed.has(k),
    toggle: (k: string) =>
      setClosed((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      }),
  };
}

/** Gate 2: one seed prompt per cell - layers and stages both fold. */
export function CellsGate({
  state, setState, brandNames,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  brandNames: string[];
}) {
  const folds = useFolds();
  return (
    <div className="grid gap-4">
      {LAYERS.map((layer) => {
        const cells = state.cells.map((c, i) => ({ ...c, i })).filter((c) => c.layer === layer);
        if (cells.length === 0) return null;
        const lk = `l:${layer}`;
        const stages = [...new Set(cells.map((c) => c.stage))];
        return (
          <div key={layer} className="grid gap-1.5">
            <FoldHeader
              open={folds.open(lk)} onToggle={() => folds.toggle(lk)} kind="layer"
              title={layer} count={`${cells.length} cell${cells.length === 1 ? "" : "s"}`}
            />
            {folds.open(lk) &&
              stages.map((stage) => {
                const scells = cells.filter((c) => c.stage === stage);
                const sk = `s:${layer}|${stage}`;
                return (
                  <div key={stage} className="grid gap-1.5 pl-4">
                    <FoldHeader
                      open={folds.open(sk)} onToggle={() => folds.toggle(sk)} kind="stage"
                      title={stageOf(state, stage)?.label ?? stage}
                      count={`${scells.length} cell${scells.length === 1 ? "" : "s"}`}
                    />
                    {folds.open(sk) && scells.map((c) => (
              <div key={c.i} className="flex items-start gap-2">
                <span className="w-44 shrink-0 pt-1.5 text-[11px] leading-tight text-ink-3">
                  {cellSubMeta(c)}
                  <span className={`ml-1 ${namesAny(c.text, brandNames) ? "text-warning" : "text-primary"}`}>
                    · {namesAny(c.text, brandNames) ? "branded" : "blind"}
                  </span>
                </span>
                <textarea
                  className="input w-full resize-none field-sizing-content text-sm"
                  rows={1}
                  value={c.text}
                  onChange={(e) =>
                    setState({
                      ...state,
                      cells: state.cells.map((q, j) =>
                        j === c.i ? { ...q, text: e.target.value } : q
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label="remove cell"
                  onClick={() =>
                    setState({ ...state, cells: state.cells.filter((_, j) => j !== c.i) })
                  }
                  className="text-ink-3 hover:text-danger text-lg leading-none px-1"
                >
                  ×
                </button>
              </div>
                    ))}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

/** Gate 3: every cell's paraphrase set, expandable. */
export function PhrasingsGate({
  state, setState,
}: {
  state: GridState;
  setState: (s: GridState) => void;
}) {
  const [openCell, setOpenCell] = useState<number | null>(null);
  const folds = useFolds();
  const indexed = state.cells.map((c, i) => ({ c, i }));
  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-ink-3">
        Each prompt is asked {PHRASING_COUNT} ways - the same question in the
        wordings real buyers use. Open a cell to edit or remove any of them.
      </p>
      {LAYERS.map((layer) => {
        const lcells = indexed.filter(({ c }) => c.layer === layer);
        if (lcells.length === 0) return null;
        const lk = `l:${layer}`;
        const stages = [...new Set(lcells.map(({ c }) => c.stage))];
        return (
          <div key={layer} className="grid gap-1.5">
            <FoldHeader
              open={folds.open(lk)} onToggle={() => folds.toggle(lk)} kind="layer"
              title={layer} count={`${lcells.length} cell${lcells.length === 1 ? "" : "s"}`}
            />
            {folds.open(lk) &&
              stages.map((stage) => {
                const scells = lcells.filter(({ c }) => c.stage === stage);
                const sk = `s:${layer}|${stage}`;
                return (
                  <div key={stage} className="grid gap-1.5 pl-4">
                    <FoldHeader
                      open={folds.open(sk)} onToggle={() => folds.toggle(sk)} kind="stage"
                      title={stageOf(state, stage)?.label ?? stage}
                      count={`${scells.length} cell${scells.length === 1 ? "" : "s"}`}
                    />
                    {folds.open(sk) && (
                      <div className="grid gap-1.5">
                        {scells.map(({ c, i }) => {
                          const open = openCell === i;
                          const n = 1 + c.phrasings.filter((p) => p.text.trim()).length;
                          return (
            <div key={i} className="rounded-lg border border-line">
              <button
                type="button"
                onClick={() => setOpenCell(open ? null : i)}
                className="w-full flex items-start gap-3 px-3 py-2 text-left"
              >
                <span className="w-44 shrink-0 text-[11px] leading-tight text-ink-3 pt-0.5">
                  {cellSubMeta(c)}
                </span>
                <span className="flex-1 text-sm text-ink-2">{c.text}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    n >= PHRASING_COUNT ? "bg-primary-soft text-primary" : "bg-warning/10 text-warning"
                  }`}
                >
                  {n} phrasings
                </span>
              </button>
              {open && (
                <div className="grid gap-1.5 border-t border-line px-3 py-2">
                  {c.phrasings.map((p, k) => (
                    <div key={k} className="flex items-start gap-2">
                      <span className="w-5 shrink-0 pt-1.5 text-[11px] text-ink-3">{k + 2}.</span>
                      <textarea
                        className="input w-full resize-none field-sizing-content text-sm"
                        rows={1}
                        value={p.text}
                        onChange={(e) =>
                          setState({
                            ...state,
                            cells: state.cells.map((q, j) =>
                              j === i
                                ? { ...q, phrasings: q.phrasings.map((x, m) => (m === k ? { ...x, text: e.target.value } : x)) }
                                : q
                            ),
                          })
                        }
                      />
                      {p.asker && (
                        <span className="w-24 shrink-0 pt-1.5 text-[10px] leading-tight text-ink-3 truncate" title={p.asker}>
                          {p.asker}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label="remove paraphrase"
                        onClick={() =>
                          setState({
                            ...state,
                            cells: state.cells.map((q, j) =>
                              j === i ? { ...q, phrasings: q.phrasings.filter((_, m) => m !== k) } : q
                            ),
                          })
                        }
                        className="text-ink-3 hover:text-danger text-lg leading-none px-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setState({
                        ...state,
                        cells: state.cells.map((q, j) =>
                          j === i ? { ...q, phrasings: [...q.phrasings, { text: "", asker: "" }] } : q
                        ),
                      })
                    }
                    className="text-[13px] font-medium text-primary hover:opacity-80 w-fit"
                  >
                    + Add paraphrase
                  </button>
                </div>
              )}
            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
