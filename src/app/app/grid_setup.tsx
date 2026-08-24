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
  /** The suggestion as generated, for "reset to suggested". */
  original?: { label: string; description: string };
}

export const MAX_SCENARIOS = 4;

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
  cells: GridCellUi[];
}

/** Drafts from before the participation mask (mode-era or phrasing-string
 * era) don't carry mask columns; they restart at compose rather than risk
 * a half-translated grid. */
export function normalizeGrid(g: GridState | null): GridState | null {
  if (!g) return null;
  const legacy =
    (g as unknown as { modes?: unknown }).modes !== undefined ||
    g.stages.length === 0 ||
    (g.stages[0] as { columns?: unknown }).columns === undefined;
  if (legacy) return null;
  return g;
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

function rowsFromSuggested(list: { label: string; description: string; journey: Journey | null }[]): ScenarioRow[] {
  return list.map((s, i) => ({
    ...s, suggested: true, on: i < MAX_SCENARIOS,
    original: { label: s.label, description: s.description },
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
  state: GridState | null;
  setState: (s: GridState | null) => void;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
}

export function useGridSetup(a: GridSetupArgs) {
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
      rows = rowsFromSuggested(data.scenarios);
    }
    const next: GridState = withScenarioRows(
      {
        step: "compose",
        moderators: data.base,
        stages: data.stages,
        keptStages: data.stages.filter((s) => s.recommended).map((s) => s.key),
        scenarios: [],
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
   * Suggestions always inherit the base journey. */
  async function suggestScenario(): Promise<void> {
    if (!a.state) return;
    const rows = scenarioRows(a.state);
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
    const active = rows.filter((r) => r.on).length;
    const nextRows: ScenarioRow[] = [
      ...rows,
      {
        ...data.scenario, journey: null, suggested: true, on: active < MAX_SCENARIOS,
        original: { ...data.scenario },
      },
    ];
    if (active < MAX_SCENARIOS) {
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

  return { compose, writeCells, writePhrasings, suggestScenario };
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

/** Gate 1: the coverage map - base read, scenario table with journeys, and
 * the stage × scenario mask. */
export function CoverageMap({
  state, setState, onRecompose, onSuggestScenario, busy,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  onRecompose: (base: GridState["moderators"], rows: ScenarioRow[]) => void;
  onSuggestScenario: () => void;
  busy: boolean;
}) {
  const rows = scenarioRows(state);
  const active = rows.filter((r) => r.on);
  const activeLabels = active.map((r) => r.label);
  const deviatingLabel = active.find((r) => r.journey !== null)?.label ?? null;
  const setRows = (next: ScenarioRow[], recompose = false) => {
    if (recompose) onRecompose(state.moderators, next);
    else setState(withScenarioRows(state, next));
  };
  const updateRow = (i: number, patch: Partial<ScenarioRow>, recompose = false) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)), recompose);

  return (
    <div className="grid gap-5">
      {/* explainer */}
      <div className="rounded-lg border border-line bg-surface-1 px-3.5 py-2.5 grid gap-1.5 text-[12px] text-ink-2 leading-relaxed max-w-3xl">
        <p>
          Rows are the stages of your buyer&apos;s decision; columns are their
          buying scenarios; each scenario walks the stages its buyer actually
          walks. The ticked stages are the recommended set - keep any the
          rules skipped if your judgement says buyers reach them, but a stage
          that doesn&apos;t exist for your buyers still gets answered by every
          engine, and the result looks like measurement without being one.
        </p>
        <p className="text-ink-3">
          If something looks wrong, the reads below are usually what&apos;s off -
          change them and the whole map recomposes instantly.
        </p>
      </div>

      {/* base read */}
      <div className="rounded-lg border border-line bg-surface-1 px-4 py-3 grid gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 mr-1">
            Your market decides
          </span>
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
        </div>
        {typeof state.moderators.rationale === "string" && (
          <p className="text-[12px] text-ink-3">{state.moderators.rationale}</p>
        )}
      </div>

      {/* scenario table */}
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Buying scenarios - the circumstances that change the right answer
          </span>
          <span className="text-[11px] text-ink-3">
            {active.length} of {MAX_SCENARIOS} in the grid
          </span>
        </div>
        {rows.map((sc, i) => (
          <div key={i} className={`grid gap-1.5 ${sc.on ? "" : "opacity-60"}`}>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={sc.on ? "remove from grid" : "add to grid"}
                className="mt-2.5"
                checked={sc.on}
                disabled={busy || (!sc.on && active.length >= MAX_SCENARIOS)}
                onChange={(e) => updateRow(i, { on: e.target.checked }, true)}
              />
              <input
                className="input w-48 shrink-0 text-sm"
                value={sc.label}
                placeholder="label"
                onChange={(e) => updateRow(i, { label: e.target.value })}
                onBlur={() => sc.on && onRecompose(state.moderators, rows)}
              />
              <textarea
                className="input w-full resize-none field-sizing-content text-sm"
                rows={1}
                value={sc.description}
                placeholder="one sentence describing the circumstance"
                onChange={(e) => updateRow(i, { description: e.target.value })}
              />
              <label
                className="flex items-center gap-1.5 shrink-0 pt-2 text-[11px] text-ink-3"
                title={
                  deviatingLabel && deviatingLabel !== sc.label
                    ? `Only one scenario per grid can buy differently (currently: ${deviatingLabel})`
                    : "This scenario's buyer decides by a different process than the market"
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
                buys differently
              </label>
              {sc.suggested ? (
                <span className="w-6 shrink-0 pt-2 text-center text-[10px] font-medium uppercase tracking-wide text-primary/70" title="suggested - untick to leave it out">
                  ✓
                </span>
              ) : (
                <button
                  type="button"
                  aria-label="delete scenario"
                  onClick={() => setRows(rows.filter((_, j) => j !== i), true)}
                  className="w-6 shrink-0 text-ink-3 hover:text-danger text-lg leading-none"
                >
                  ×
                </button>
              )}
            </div>
            {sc.journey && sc.on && (
              <div className="flex flex-wrap items-center gap-1.5 pl-7">
                <span className="text-[10px] uppercase tracking-wide text-warning font-semibold">this buyer:</span>
                {JOURNEY_FIELDS.map((f) => (
                  <select
                    key={f.key}
                    aria-label={`${sc.label} ${f.key.replace("_", " ")}`}
                    value={String(sc.journey?.[f.key as keyof Journey] ?? "")}
                    disabled={busy}
                    onChange={(e) =>
                      updateRow(i, { journey: { ...sc.journey!, [f.key]: e.target.value } }, true)
                    }
                    className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning border-0 cursor-pointer"
                  >
                    {f.options.map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => setRows([...rows, { label: "", description: "", journey: null, suggested: false, on: active.length < MAX_SCENARIOS }])}
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
                rows
                  .filter((r) => r.suggested)
                  .map((r, i) => ({ ...r, ...(r.original ?? {}), journey: null, on: i < MAX_SCENARIOS })),
                true
              )
            }
            className="text-[13px] font-medium text-ink-3 hover:text-ink"
          >
            Reset to suggested
          </button>
        </div>
      </div>

      {/* coverage map */}
      <div className="grid gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          The coverage map - every stage, and who walks it
        </span>
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
                const stages = state.stages.filter((s) => s.layer === layer);
                if (stages.length === 0) return null;
                return [
                  <tr key={`${layer}-head`}>
                    <td colSpan={1 + active.length} className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-primary border-t border-line">
                      {layer}
                    </td>
                  </tr>,
                  ...stages.map((s) => {
                    const kept = state.keptStages.includes(s.key);
                    const cols = stageColumns(s, activeLabels);
                    const effective = cols.length > 0 ? cols : activeLabels;
                    return (
                      <tr key={s.key} className={kept ? "" : "opacity-50"}>
                        <td className="px-3 py-1 whitespace-nowrap">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={kept}
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
                            <span className={kept ? "text-ink" : "text-ink-3"}>{s.label}</span>
                            <TagChip tag={s.tag} />
                            {!s.recommended && (
                              <span className="text-[9px] uppercase tracking-wide text-ink-3" title="No journey reaches this stage - keep it only if your buyers really do">
                                skipped
                              </span>
                            )}
                          </label>
                        </td>
                        {s.situational || s.rivals !== "none" ? (
                          active.map((sc) => {
                            const inCol = kept && effective.includes(sc.label);
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
                            <span className={`text-[10px] ${kept ? "text-primary" : "text-ink-3"}`}>
                              {kept
                                ? cols.length > 0 && cols.length < activeLabels.length
                                  ? `1 cell · asked by: ${cols.join(", ")}`
                                  : "1 cell · every scenario"
                                : "-"}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Gate 2: one seed prompt per cell, grouped by layer. */
export function CellsGate({
  state, setState, brandNames,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  brandNames: string[];
}) {
  return (
    <div className="grid gap-4">
      {LAYERS.map((layer) => {
        const cells = state.cells.map((c, i) => ({ ...c, i })).filter((c) => c.layer === layer);
        if (cells.length === 0) return null;
        return (
          <div key={layer} className="grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              {layer}
            </span>
            {cells.map((c) => (
              <div key={c.i} className="flex items-start gap-2">
                <span className="w-48 shrink-0 pt-1.5 text-[11px] leading-tight text-ink-3">
                  {cellMeta(state, c)}
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
}

/** Gate 3: every cell's paraphrase set, expandable. */
export function PhrasingsGate({
  state, setState,
}: {
  state: GridState;
  setState: (s: GridState) => void;
}) {
  const [openCell, setOpenCell] = useState<number | null>(null);
  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-ink-3">
        Each prompt is asked {PHRASING_COUNT} ways - the same question in the
        wordings real buyers use. Open a cell to edit or remove any of them.
      </p>
      <div className="grid gap-1.5">
        {state.cells.map((c, i) => {
          const open = openCell === i;
          const n = 1 + c.phrasings.filter((p) => p.text.trim()).length;
          return (
            <div key={i} className="rounded-lg border border-line">
              <button
                type="button"
                onClick={() => setOpenCell(open ? null : i)}
                className="w-full flex items-start gap-3 px-3 py-2 text-left"
              >
                <span className="w-48 shrink-0 text-[11px] leading-tight text-ink-3 pt-0.5">
                  {cellMeta(state, c)}
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
    </div>
  );
}
