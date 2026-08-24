"use client";

import { useState } from "react";

/**
 * Buyer Landscape setup pieces: the state shape, the three API calls, and
 * one view per gate. The wizard decides where these live (rail, footer,
 * container); these know nothing about that.
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
  situation: string | null;
  angle: string;
  /** Buyer mode this cell serves; null = every mode. */
  mode?: string | null;
  text: string;
  /** Paraphrases beyond the seed text; empty until gate 3. */
  phrasings: GridPhrasing[];
}

export interface GridStage {
  key: string;
  label: string;
  layer: string;
  situational: boolean;
  rivals: "none" | "each" | "defensive_offensive";
  /** The composer's verdict; the user can keep a stage it skipped. */
  recommended?: boolean;
  /** The one buyer mode that reaches this stage; null = every mode. */
  mode?: string | null;
}

export interface GridModeUi {
  label: string;
  moderators: Record<string, unknown> & { rationale?: string };
}

export interface ScenarioRow {
  label: string;
  description: string;
  /** Came from the model (initial set or "suggest another") - never
   * deletable, only unticked, so it can always come back. */
  suggested: boolean;
  /** Whether this row is in the grid. */
  on: boolean;
  /** The suggestion as generated, for "reset to suggested". */
  original?: { label: string; description: string };
}

export const MAX_SCENARIOS = 4;

export interface GridState {
  step: "compose" | "cells" | "phrasings";
  /** The market's buyer modes (1-2); moderators mirrors the dominant one. */
  modes?: GridModeUi[];
  moderators: Record<string, unknown> & { rationale?: string };
  stages: GridStage[];
  keptStages: string[];
  /** The active scenarios - what the cell planner multiplies by. Kept in
   * sync with scenarioRows (the editable table) by withScenarioRows(). */
  scenarios: { label: string; description: string }[];
  scenarioRows?: ScenarioRow[];
  cells: GridCellUi[];
}

/** The market's modes; older drafts only carry the single dominant read. */
export function gridModes(g: GridState): GridModeUi[] {
  return g.modes ?? [{ label: "", moderators: g.moderators }];
}

/** Older drafts saved phrasings as bare strings and no modes; normalize so
 * everything downstream sees one shape. */
export function normalizeGrid(g: GridState | null): GridState | null {
  if (!g) return null;
  return {
    ...g,
    modes: gridModes(g),
    cells: (g.cells ?? []).map((c) => ({
      ...c,
      mode: c.mode ?? null,
      phrasings: (c.phrasings ?? []).map((ph) =>
        typeof ph === "string" ? { text: ph, asker: "" } : ph
      ),
    })),
  };
}

/** The editable scenario table; older drafts only carry the active list. */
export function scenarioRows(g: GridState): ScenarioRow[] {
  return (
    g.scenarioRows ??
    g.scenarios.map((s) => ({ ...s, suggested: true, on: true, original: { ...s } }))
  );
}

export function withScenarioRows(g: GridState, rows: ScenarioRow[]): GridState {
  return {
    ...g,
    scenarioRows: rows,
    scenarios: rows.filter((r) => r.on).map(({ label, description }) => ({ label, description })),
  };
}

function rowsFromSuggested(list: { label: string; description: string }[]): ScenarioRow[] {
  return list.map((s, i) => ({
    ...s, suggested: true, on: i < MAX_SCENARIOS, original: { ...s },
  }));
}

/** Prompts the tracker will hold: every kept seed plus its paraphrases. */
export function gridPromptCount(g: GridState | null): number {
  if (!g) return 0;
  return g.cells
    .filter((c) => c.text.trim())
    .reduce((n, c) => n + 1 + c.phrasings.filter((p) => p.text.trim()).length, 0);
}

/** Cells the kept stages and scenarios will produce - the same expansion
 * rules the engine's planner applies, so the count is exact before anything
 * is written. */
export function gridCellCount(g: GridState | null, rivalCount: number): number {
  if (!g) return 0;
  const r = Math.min(rivalCount, 4);
  const kept = new Set(g.keptStages);
  return g.stages
    .filter((s) => kept.has(s.key))
    .reduce((n, s) => {
      if (s.rivals === "each") return n + r;
      if (s.rivals === "defensive_offensive") return n + 1 + r;
      if (s.situational) return n + Math.max(g.scenarios.length, 1);
      return n + 1;
    }, 0);
}

export function namesAny(text: string, names: string[]): boolean {
  const t = text.toLowerCase();
  return names.some((n) => n.trim() && t.includes(n.trim().toLowerCase()));
}

/** The category read, as editable dimensions. Changing one recomposes the
 * stage list - the composer is pure code, so that is instant. */
export const MODERATOR_FIELDS: { key: string; options: [string, string][] }[] = [
  { key: "verifiability", options: [["spec", "spec-driven"], ["taste", "taste-driven"], ["trust", "trust-driven"]] },
  { key: "involvement", options: [["considered", "considered"], ["habitual", "habitual"]] },
  { key: "think_feel", options: [["think", "rational"], ["feel", "identity-led"]] },
  { key: "decision_unit", options: [["solo", "solo buyer"], ["household", "household"], ["committee", "committee-bought"]] },
  { key: "rhythm", options: [["one_shot", "one-shot"], ["replenishment", "replenishment"], ["subscription", "subscription"]] },
  { key: "risk", options: [["performance", "performance risk"], ["financial", "financial risk"], ["social", "social risk"], ["physical", "physical risk"]] },
];

/** The chips the classification banner shows, in reading order. */
export function moderatorChips(m: GridState["moderators"]): string[] {
  return MODERATOR_FIELDS.map((f) => {
    const v = String(m[f.key] ?? "");
    return f.options.find(([k]) => k === v)?.[1] ?? null;
  }).filter((v): v is string => v !== null);
}

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

  /** Gate 1. With `modes`, recompose from an edited market read. */
  async function compose(modes?: GridModeUi[]): Promise<GridState | null> {
    a.setBusy(modes ? "Recomposing…" : "Reading your market…");
    a.setError(null);
    const data = await post<{
      modes: GridModeUi[];
      moderators: GridState["moderators"];
      stages: GridStage[];
      scenarios: GridState["scenarios"];
    }>("/api/setup/grid/compose", {
      category: a.category,
      audience: a.audience || undefined,
      modes,
    });
    a.setBusy(null);
    if (!data) return null;
    // An edited read keeps the user's scenario table unless the dominant
    // decision unit changed, which changes what a scenario even is.
    const keepRows =
      modes && a.state && a.state.moderators.decision_unit === data.moderators.decision_unit;
    const next: GridState = withScenarioRows(
      {
        step: "compose",
        modes: data.modes,
        moderators: data.moderators,
        stages: data.stages,
        keptStages: data.stages.filter((s) => s.recommended !== false).map((s) => s.key),
        scenarios: [],
        cells: [],
      },
      keepRows && a.state ? scenarioRows(a.state) : rowsFromSuggested(data.scenarios)
    );
    a.setState(next);
    return next;
  }

  /** Gate 1 helper: one more scenario, distinct from everything listed. */
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
    a.setState(
      withScenarioRows(a.state, [
        ...rows,
        { ...data.scenario, suggested: true, on: active < MAX_SCENARIOS, original: { ...data.scenario } },
      ])
    );
  }

  /** Gate 2: one seed prompt per cell. */
  async function writeCells(): Promise<GridState | null> {
    if (!a.state) return null;
    a.setBusy("Writing your prompts…");
    a.setError(null);
    const data = await post<{ cells: Omit<GridCellUi, "phrasings">[] }>(
      "/api/setup/grid/cells",
      {
        brand: a.brand, category: a.category, competitors: a.competitors,
        audience: a.audience || undefined,
        moderators: a.state.moderators,
        modes: gridModes(a.state),
        stageKeys: a.state.keptStages,
        scenarios: a.state.scenarios,
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
          moderators: a.state.moderators,
          modes: gridModes(a.state),
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

function stageLabel(state: GridState, key: string): string {
  return state.stages.find((s) => s.key === key)?.label ?? key;
}

export function cellMeta(state: GridState, c: GridCellUi): string {
  return (
    stageLabel(state, c.stage) +
    (c.situation ? ` · ${c.situation}` : "") +
    (c.angle !== "generic"
      ? ` · ${c.angle === "defensive" ? "your churn moment" : `vs ${c.angle}`}`
      : "") +
    (c.mode ? ` · ${c.mode}` : "")
  );
}

/** Gate 1: the category read (editable), the stages (keep/drop), the scenarios. */
export function StagesGate({
  state, setState, onRecompose, onSuggestScenario, busy,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  onRecompose: (modes: GridModeUi[]) => void;
  onSuggestScenario: () => void;
  busy: boolean;
}) {
  const rows = scenarioRows(state);
  const active = rows.filter((r) => r.on).length;
  const setRows = (next: ScenarioRow[]) => setState(withScenarioRows(state, next));
  const updateRow = (i: number, patch: Partial<ScenarioRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const modes = gridModes(state);
  const recomposeMode = (mi: number, key: string, value: string) =>
    onRecompose(
      modes.map((m, j) => (j === mi ? { ...m, moderators: { ...m.moderators, [key]: value } } : m))
    );
  return (
    <div className="grid gap-5">
      {modes.length > 1 && (
        <p className="text-[12px] text-ink-2 max-w-3xl">
          Your market has two kinds of buyers with genuinely different
          journeys. Stages they share are measured once; stages only one of
          them reaches are tagged with that buyer below.
        </p>
      )}
      <div className={`grid gap-3 ${modes.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {modes.map((m, mi) => (
          <div key={mi} className="rounded-lg border border-line bg-surface-1 px-4 py-3 grid gap-2 content-start">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 mr-1">
                {modes.length > 1
                  ? `${m.label || `Mode ${mi + 1}`}${mi === 0 ? " · dominant" : ""}`
                  : "We read your market as"}
              </span>
              {MODERATOR_FIELDS.map((f) => (
                <select
                  key={f.key}
                  aria-label={`${m.label || "mode"} ${f.key.replace("_", " ")}`}
                  value={String(m.moderators[f.key] ?? "")}
                  disabled={busy}
                  onChange={(e) => recomposeMode(mi, f.key, e.target.value)}
                  className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary border-0 cursor-pointer"
                >
                  {f.options.map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              ))}
            </div>
            {typeof m.moderators.rationale === "string" && (
              <p className="text-[12px] text-ink-3">
                {m.moderators.rationale} Change any read and the stages
                recompose.
              </p>
            )}
            {modes.length > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRecompose([{ ...modes[mi] }])}
                className="text-[12px] font-medium text-ink-3 hover:text-ink text-left w-fit disabled:opacity-50"
              >
                These are our only buyers - use just this mode
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          All stages - the recommended set is ticked
        </span>
        <div className="rounded-lg border border-line bg-surface-1 px-3.5 py-2.5 grid gap-1.5 text-[12px] text-ink-2 leading-relaxed max-w-3xl">
          <p>
            The ticked stages are the decision moments your category&apos;s buyers
            actually reach. You can keep a stage the rules skipped if your own
            judgement says buyers get there - the rules are a starting point, not a
            limit.
          </p>
          <p>
            Ticking everything is not free, even when cost isn&apos;t the concern. A
            stage that doesn&apos;t exist for your buyers still gets answered by every
            engine, and the result looks like measurement without being one: it
            dilutes your layer scores and funnel, buries real gaps under rows nobody
            asks about, and adds noise to your trend. Comparison and &quot;Is premium
            worth it&quot; are two versions of the same moment - keep one.
          </p>
          <p className="text-ink-3">
            If a skipped stage looks wrong, the category read above is usually what&apos;s
            off - change the read and the whole set recomposes consistently.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {LAYERS.map((layer) => {
            const stages = state.stages.filter((s) => s.layer === layer);
            if (stages.length === 0) return null;
            return (
              <div key={layer} className="grid gap-1 content-start">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {layer}
                </span>
                {stages.map((s) => {
                  const kept = state.keptStages.includes(s.key);
                  const rec = s.recommended !== false;
                  return (
                    <label
                      key={s.key}
                      className="flex items-center gap-2 text-[13px]"
                      title={rec ? undefined : "Skipped by the rules for this category - keep it only if your buyers really reach this moment"}
                    >
                      <input
                        type="checkbox"
                        checked={kept}
                        onChange={(e) =>
                          setState({
                            ...state,
                            keptStages: e.target.checked
                              ? [...state.keptStages, s.key]
                              : state.keptStages.filter((k) => k !== s.key),
                          })
                        }
                      />
                      <span className={kept ? "text-ink" : rec ? "text-ink-3 line-through" : "text-ink-3"}>
                        {s.label}
                      </span>
                      {rec && (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-primary/70">
                          recommended
                        </span>
                      )}
                      {modes.length > 1 && rec && (
                        <span className="rounded-full bg-primary-soft px-1.5 text-[10px] font-medium text-primary">
                          {s.mode ?? "both"}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Buying scenarios - the circumstances that change the right answer
          </span>
          <span className="text-[11px] text-ink-3">
            {active} of {MAX_SCENARIOS} in the grid - each one multiplies the scenario stages
          </span>
        </div>
        {rows.map((sc, i) => (
          <div key={i} className={`flex items-start gap-2 ${sc.on ? "" : "opacity-60"}`}>
            <input
              type="checkbox"
              aria-label={sc.on ? "remove from grid" : "add to grid"}
              className="mt-2.5"
              checked={sc.on}
              disabled={!sc.on && active >= MAX_SCENARIOS}
              onChange={(e) => updateRow(i, { on: e.target.checked })}
            />
            <input
              className="input w-48 shrink-0 text-sm"
              value={sc.label}
              placeholder="label"
              onChange={(e) => updateRow(i, { label: e.target.value })}
            />
            <textarea
              className="input w-full resize-none field-sizing-content text-sm"
              rows={1}
              value={sc.description}
              placeholder="one sentence describing the circumstance"
              onChange={(e) => updateRow(i, { description: e.target.value })}
            />
            {sc.suggested ? (
              <span className="w-6 shrink-0 pt-2 text-center text-[10px] font-medium uppercase tracking-wide text-primary/70" title="suggested - untick to leave it out">
                ✓
              </span>
            ) : (
              <button
                type="button"
                aria-label="delete scenario"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="w-6 shrink-0 text-ink-3 hover:text-danger text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() =>
              setRows([...rows, { label: "", description: "", suggested: false, on: active < MAX_SCENARIOS }])
            }
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
                  .map((r, i) => ({ ...r, ...(r.original ?? {}), on: i < MAX_SCENARIOS }))
              )
            }
            className="text-[13px] font-medium text-ink-3 hover:text-ink"
          >
            Reset to suggested
          </button>
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
                <span className="w-44 shrink-0 pt-1.5 text-[11px] leading-tight text-ink-3">
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
                <span className="w-44 shrink-0 text-[11px] leading-tight text-ink-3 pt-0.5">
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
