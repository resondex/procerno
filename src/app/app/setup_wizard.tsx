"use client";

import { useEffect, useRef, useState } from "react";
import type { PromptTheme, SetupDraft } from "@/lib/types";
import { EnginePicker, defaultEnginesFor, type EngineOption } from "@/app/components/engine_picker";
import {
  CellReviewModal,
  CellsGate,
  cellSubMeta,
  CoverageGate,
  ScenarioReviewModal,
  ScenariosGate,
  gridCellCount,
  gridPromptCount,
  namesAny,
  normalizeGrid,
  scenarioRows,
  swapPhrasings,
  useGridSetup,
  type CellReviewItem,
  type GridState,
  type ScenarioReviewItem,
  type ScenarioRow,
} from "./grid_setup";

/**
 * The setup wizard: a rail of steps, one gate at a time, a fixed footer that
 * says what the next button spends. Container-agnostic - the page decides
 * whether this sits in a sheet or on a route; the wizard only needs
 * onClose/onCreated. Every gate persists as a draft, so closing, refreshing,
 * or tabbing away never loses work.
 */

export type SetupMode = "classic" | "grid";
type StepKey = "market" | "scenarios" | "stages" | "prompts" | "engines";

const STEPS: Record<SetupMode, { key: StepKey; label: string }[]> = {
  grid: [
    { key: "market", label: "Your market" },
    { key: "scenarios", label: "Buying scenarios" },
    { key: "stages", label: "Coverage map" },
    { key: "prompts", label: "Prompts" },
    { key: "engines", label: "Engines & first run" },
  ],
  classic: [
    { key: "market", label: "Your market" },
    { key: "prompts", label: "Prompts" },
    { key: "engines", label: "Engines & first run" },
  ],
};

/** Includes "paraphrases" for drafts saved before that step merged into
 * Prompts - old drafts still carry it. */
export const STEP_LABEL: Record<StepKey | "paraphrases", string> = {
  market: "at your market",
  scenarios: "at buying scenarios",
  stages: "at the coverage map",
  prompts: "at prompts",
  paraphrases: "paraphrases written",
  engines: "choosing engines",
};

/** Repeats for the scan's first run - matches the dashboard's default. */
const FIRST_RUN_REPEATS = 5;

/** The fingerprint the scenario quality check caches passes under. */
function scenarioFp(s: { label: string; description: string }): string {
  return `${s.label.trim()}|${s.description.trim()}`;
}

/** The rows the quality check must judge - active, authored or edited, not
 * already passed - and the request body the reviewer takes. Shared by the
 * confirm and its blur-time warm so the two can never drift. */
function reviewRequest(g: GridState, category: string, audience: string) {
  const rows = scenarioRows(g);
  const done = new Set(g.reviewedScenarios ?? []);
  const authored = rows
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        r.on &&
        r.label.trim() &&
        (!r.original ||
          r.label.trim() !== r.original.label.trim() ||
          r.description.trim() !== r.original.description.trim()) &&
        !done.has(scenarioFp(r))
    );
  const body = {
    category,
    audience: audience || undefined,
    // The pre-edit version rides along so the reviewer can tell an
    // accidental slip from a deliberate change.
    candidates: authored.map(({ r }) => ({
      label: r.label,
      description: r.description,
      original: r.original ?? null,
    })),
    others: rows
      .filter((r, i) => r.on && r.label.trim() && !authored.some((c) => c.i === i))
      .map(({ label, description }) => ({ label, description })),
  };
  return { rows, authored, body };
}

/** The prompt fingerprint the Prompts-gate quality check caches passes
 * under - cell identity plus the exact wording. */
function cellFp(c: { stage: string; situation: string | null; angle: string; text: string }): string {
  return [c.stage, c.situation ?? "", c.angle, c.text.trim()].join("|");
}

/** The cells the Prompts-gate quality check must judge - live, edited away
 * from their machine baseline, not already passed - and the request body
 * the reviewer takes. Shared by the confirm and its blur-time warm. */
function cellReviewRequest(
  g: GridState,
  brand: string,
  competitors: string[],
  category: string,
  audience: string
) {
  const done = new Set(g.reviewedCells ?? []);
  const stageBy = new Map(g.stages.map((s) => [s.key, s]));
  const scDesc = new Map(g.scenarios.map((s) => [s.label, s.description]));
  const authored = g.cells
    .map((c, i) => ({ c, i }))
    .filter(
      ({ c }) =>
        c.text.trim() &&
        c.text.trim() !== (c.original ?? "").trim() &&
        !done.has(cellFp(c))
    )
    // The reviewer takes at most 24 - more edits than that between
    // confirms would be extraordinary; the rest pass this round and get
    // caught on the next confirm.
    .slice(0, 24);
  const body = {
    brand,
    category,
    competitors,
    audience: audience || undefined,
    candidates: authored.map(({ c }) => {
      const st = stageBy.get(c.stage);
      return {
        text: c.text,
        original: c.original ?? null,
        stage: st?.label ?? c.stage,
        hint: st?.hint ?? null,
        tag: st?.tag ?? null,
        situation: c.situation,
        situationDescription: c.situation ? scDesc.get(c.situation) ?? null : null,
        angle: c.angle,
        mode: c.mode ?? null,
      };
    }),
  };
  return { authored, body };
}

interface DraftPrompt {
  text: string;
  theme: PromptTheme;
}

const THEMES: PromptTheme[] = ["discovery", "recommendation", "comparison", "use_case", "branded"];

interface WizardDraft {
  mode: SetupMode;
  step: StepKey;
  studyName: string;
  grid: GridState | null;
  engineSet: string[];
}

interface Props {
  mode: SetupMode;
  brand: string;
  draft: SetupDraft | null;
  engineOptions: EngineOption[];
  onClose: () => void;
  onCreated: (projectId: string) => void;
  onDraftsChanged: () => void;
}

export function SetupWizard({ mode, brand, draft, engineOptions, onClose, onCreated, onDraftsChanged }: Props) {
  const steps = STEPS[mode];
  const saved = (draft?.wizard ?? null) as WizardDraft | null;

  // Drafts saved before the paraphrases step merged into Prompts resume there.
  const savedStep: StepKey =
    (saved?.step as string) === "paraphrases" ? "prompts" : (saved?.step ?? "market");
  const [step, setStep] = useState<StepKey>(savedStep);
  const [reached, setReached] = useState<number>(
    Math.max(0, steps.findIndex((s) => s.key === savedStep))
  );
  const [studyName, setStudyName] = useState(saved?.studyName ?? "");
  const [category, setCategory] = useState(draft?.category ?? "");
  const [competitors, setCompetitors] = useState<string[]>(draft?.competitors ?? []);
  const [compDraft, setCompDraft] = useState("");
  const [audience, setAudience] = useState(draft?.audience ?? "");
  const [prompts, setPrompts] = useState<DraftPrompt[] | null>(draft?.prompts ?? null);
  const [editing, setEditing] = useState(false);
  const [grid, setGrid] = useState<GridState | null>(normalizeGrid(saved?.grid ?? null));
  /** Flagged user-authored scenarios awaiting a keep/suggestion choice. */
  const [review, setReview] = useState<ScenarioReviewItem[] | null>(null);
  /** Flagged user-edited prompts awaiting a keep/suggestion choice. */
  const [cellReview, setCellReview] = useState<CellReviewItem[] | null>(null);
  /** What the last "Your market buys" edit changed downstream. */
  const [readDelta, setReadDelta] = useState<string | null>(null);
  const [chosenEngines, setChosenEngines] = useState<string[] | null>(saved?.engineSet ?? null);
  // Until the user touches the panel, it is the default for what this
  // deployment can reach - derived, so it tracks the options as they load.
  const engineSet = chosenEngines ?? defaultEnginesFor("both", engineOptions);
  const setEngineSet = (update: (prev: string[]) => string[]) =>
    setChosenEngines((prev) => update(prev ?? defaultEnginesFor("both", engineOptions)));
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The market the current battery was composed from; a changed market
  // means a deliberate trip back, and a recompose on re-confirm.
  const [servedMarket, setServedMarket] = useState<string | null>(
    draft ? marketKey(draft.category, draft.competitors, draft.audience ?? "") : null
  );

  /** The plan's buying-scenario cap (PLAN_SCENARIO_CAPS); 4 until the
   * plan loads, then Starter/Growth tighten to 3. */
  const [scenarioCap, setScenarioCap] = useState(4);

  const gridApi = useGridSetup({
    brand, category, competitors: allCompetitors(), audience,
    maxScenarios: scenarioCap,
    state: grid, setState: setGrid, setBusy, setError,
  });

  const estimated = useRef(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/plan")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && typeof d?.scenarioCap === "number") setScenarioCap(d.scenarioCap);
      })
      .catch(() => {});
    // A draft resumed directly onto the scenarios gate never passes goTo;
    // warm its near-variant pools here.
    if (step === "scenarios") void gridApi.prefetchNearPools();
    // Resumed on the market step with a known category: warm the read.
    if (step === "market" && category.trim()) gridApi.warmRead();
    // Resumed mid-flow: warm whatever the NEXT gate will ask for.
    if (step === "stages") gridApi.warmCells();
    if (step === "prompts" && mode === "grid") gridApi.warmPhrasings();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  function marketKey(c: string, comps: string[], a: string): string {
    return [c.trim(), comps.join("|"), a.trim()].join(" ");
  }

  function allCompetitors(): string[] {
    const d = compDraft.trim().replace(/,+$/, "");
    return [...new Set(d ? [...competitors, d] : competitors)];
  }

  function addCompetitor() {
    setCompetitors(allCompetitors());
    setCompDraft("");
  }

  async function estimate() {
    setSuggesting(true);
    setError(null);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, skipBattery: true }),
    });
    const data = await res.json().catch(() => ({}));
    setSuggesting(false);
    if (!res.ok) {
      setError((data.error ?? "estimation failed") + " - fill in the details manually");
      return;
    }
    setCategory(data.profile.category);
    setCompetitors(data.profile.competitors);
    setCompDraft("");
    setAudience(data.profile.audience);
    // Warm the ~45s market read while the user reviews the form - by
    // confirm time it is cached and the scenarios gate opens instantly.
    gridApi.warmRead(data.profile.category, data.profile.audience);
  }

  /* ------------------------------ persistence ----------------------------- */

  async function persist(at: StepKey, g: GridState | null = grid, p: DraftPrompt[] | null = prompts) {
    setSaving(true);
    const wizard: WizardDraft = { mode, step: at, studyName, grid: g, engineSet };
    const res = await fetch("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: draftId ?? undefined,
        brand,
        category,
        audience: audience || undefined,
        competitors: allCompetitors(),
        prompts: p,
        wizard,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.draft?.id) setDraftId(data.draft.id);
      onDraftsChanged();
    }
  }

  function goTo(k: StepKey, g: GridState | null = grid, p: DraftPrompt[] | null = prompts) {
    setReadDelta(null);
    setStep(k);
    setReached((r) => Math.max(r, steps.findIndex((s) => s.key === k)));
    setError(null);
    void persist(k, g, p);
    // Landing on a gate warms the NEXT gate's work in the background -
    // pools for scenario draws, cells while the map is reviewed,
    // paraphrases while the seeds are reviewed. Silent; failures cost
    // nothing.
    if (k === "scenarios") void gridApi.prefetchNearPools(g);
    if (k === "stages") gridApi.warmCells(g);
    if (k === "prompts" && mode === "grid") gridApi.warmPhrasings(g);
  }

  async function requestClose() {
    const dirty = step !== "market" || prompts !== null || grid !== null;
    if (dirty && busy === null) await persist(step);
    onClose();
  }

  // Fresh setup: estimate the market from the brand alone.
  useEffect(() => {
    if (draft || estimated.current) return;
    estimated.current = true;
    void estimate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe once; the ref keeps the handler seeing the latest state.
  const escapeRef = useRef<() => void>(() => {});
  useEffect(() => {
    escapeRef.current = () => {
      // A review overlay is the top layer - Escape dismisses it first;
      // the next Escape closes the wizard.
      if (cellReview) {
        setCellReview(null);
        return;
      }
      if (review) {
        setReview(null);
        return;
      }
      // Mid-write, closing would lose the write - ignore, matching the
      // disabled Save & close.
      if (busy !== null) return;
      void requestClose();
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") escapeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ------------------------------- transitions ---------------------------- */

  async function confirmMarket() {
    if (!category.trim()) return;
    const comps = allCompetitors();
    setCompetitors(comps);
    setCompDraft("");
    const key = marketKey(category, comps, audience);
    const unchanged = servedMarket === key;
    setServedMarket(key);
    if (mode === "grid") {
      if (unchanged && grid) {
        goTo(grid.step === "compose" ? "scenarios" : "prompts");
        return;
      }
      setGrid(null);
      const next = await gridApi.compose();
      if (next) goTo("scenarios", next);
      return;
    }
    if (unchanged && prompts) {
      goTo("prompts");
      return;
    }
    await draftBattery(false);
  }

  async function draftBattery(force: boolean) {
    setBusy(force ? "Rewriting your prompts…" : "Drafting your prompts…");
    setError(null);
    const res = await fetch("/api/prompts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: studyName.trim() || undefined,
        brand, category,
        audience: audience || undefined,
        competitors: allCompetitors(),
        force,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? "prompt generation failed");
      return;
    }
    setPrompts(data.prompts);
    setEditing(false);
    goTo("prompts", grid, data.prompts);
  }

  /** Confirm the scenarios gate: user-written or user-edited rows get one
   * quality check first; anything flagged goes to the review overlay with
   * a suggested edit. Passed fingerprints persist with the draft so
   * unchanged rows are never rechecked; a declined suggestion ("keep
   * mine") is deliberately NOT recorded, so it pops up again on the next
   * confirm. A reviewer failure never blocks the gate. */
  async function confirmScenarios() {
    if (!grid) return;
    // The footer button keeps focus in the field (see onMouseDown), so a
    // pending label-blur recompose never ran. If any active label is
    // missing from the composed mask, recompose first - pure code, fast.
    let g = grid;
    const colLabels = new Set(g.stages.flatMap((s) => s.columns));
    const stale = scenarioRows(g).some(
      (r) => r.on && r.label.trim() && !colLabels.has(r.label.trim())
    );
    // Recompose (pure code) runs CONCURRENTLY with the review below - the
    // review judges text, the mask doesn't change text, so neither waits.
    const recomposing: Promise<GridState | null> = stale
      ? gridApi.compose({ base: g.moderators, rows: scenarioRows(g), silent: true })
      : Promise.resolve(null);
    const { authored, body } = reviewRequest(g, category, audience);
    if (authored.length === 0) {
      setBusy("Recomposing…");
      const composed = await recomposing;
      setBusy(null);
      goTo("stages", composed ?? g);
      return;
    }
    setBusy("Checking your scenarios…");
    setError(null);
    const resP = fetch("/api/setup/grid/scenario_review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const [composed, res] = await Promise.all([recomposing, resP]);
    if (composed) g = composed;
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      goTo("stages", g);
      return;
    }
    const flagged: ScenarioReviewItem[] = [];
    const passed: string[] = [];
    authored.forEach(({ r, i }, k) => {
      const v = data.verdicts?.[k];
      if (!v || v.ok) {
        passed.push(scenarioFp(r));
      } else {
        flagged.push({
          index: i,
          current: { label: r.label, description: r.description },
          flags: Array.isArray(v.flags) && v.flags.length > 0 ? v.flags : ["phrasing"],
          reason: v.reason || "This one may not read as a buying circumstance.",
          suggestion: v.suggestion,
          choice: "suggestion",
        });
      }
    });
    let next = g;
    if (passed.length > 0) {
      next = { ...g, reviewedScenarios: [...(g.reviewedScenarios ?? []), ...passed] };
      setGrid(next);
    }
    if (flagged.length === 0) goTo("stages", next);
    else setReview(flagged);
  }

  /** Apply the review choices, recompose if any wording changed, advance.
   * An accepted suggestion becomes the row's `original`, so it won't be
   * rechecked; a kept-mine row is left as-is on purpose - it gets flagged
   * again the next time the gate is confirmed. */
  async function resolveReview() {
    if (!grid || !review) return;
    const byIndex = new Map(review.map((it) => [it.index, it]));
    let changed = false;
    const rows = scenarioRows(grid).map((r, i) => {
      const it = byIndex.get(i);
      if (!it || it.choice !== "suggestion") return r;
      changed = true;
      return {
        ...r,
        label: it.suggestion.label,
        description: it.suggestion.description,
        original: { ...it.suggestion },
      };
    });
    // Log what the user chose - visibility only, fire and forget.
    void fetch("/api/setup/grid/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        audience: audience || undefined,
        kind: "review_choice",
        items: review.map(({ current, suggestion, flags, reason, choice }) => ({
          current, suggestion, flags, reason, choice,
        })),
      }),
    }).catch(() => {});
    setReview(null);
    if (changed) {
      const next = await gridApi.compose({ base: grid.moderators, rows });
      if (next) goTo("stages", next);
    } else {
      goTo("stages");
    }
  }

  /** Silent warm of the confirm-time scenario check: same request the
   * confirm will make, fired on field blur, cached server-side. */
  function warmScenarioReview() {
    if (!grid) return;
    const { authored, body } = reviewRequest(grid, category, audience);
    if (authored.length === 0) return;
    void fetch("/api/setup/grid/scenario_review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  /** A base-read edit: recompose, then narrate what actually changed - a
   * silent recompose reads as broken even when it works. */
  async function recomposeBase(base: GridState["moderators"], rows: ScenarioRow[]) {
    const prev = grid;
    const next = await gridApi.compose({ base, rows });
    if (!next || !prev) return;
    const label = (g: GridState, key: string) =>
      g.stages.find((s) => s.key === key)?.label ?? key;
    const prevKept = new Set(prev.keptStages);
    const nextKept = new Set(next.keptStages);
    const added = next.keptStages.filter((k) => !prevKept.has(k)).map((k) => label(next, k));
    const removed = prev.keptStages.filter((k) => !nextKept.has(k)).map((k) => label(prev, k));
    const prevCells = gridCellCount(prev, rivalCount);
    const nextCells = gridCellCount(next, rivalCount);
    if (added.length === 0 && removed.length === 0 && prevCells === nextCells) {
      setReadDelta(
        "Recomposed - no stage changes: this dimension shapes prompt wording, not the map."
      );
      return;
    }
    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.join(", ")} in`);
    if (removed.length > 0) parts.push(`${removed.join(", ")} out`);
    parts.push(
      `${nextCells} cells${prevCells !== nextCells ? ` (was ${prevCells})` : ""}`
    );
    setReadDelta(`Recomposed: ${parts.join(" · ")}`);
  }

  async function writeCells() {
    const next = await gridApi.writeCells();
    if (next) goTo("prompts", next);
  }

  async function writePhrasings(force = false, onlyMissing = false, from?: GridState) {
    const next = await gridApi.writePhrasings(force, onlyMissing, from);
    if (next) goTo("prompts", next);
  }

  /** What the Prompts footer does once the battery is clean - recomputed
   * from the state at hand, so the review can run before ANY of the three
   * confirms without each carrying its own continuation. */
  function proceedPrompts(g: GridState) {
    const live = g.cells.filter((c) => c.text.trim());
    const written = g.step === "phrasings";
    const missing = written && live.some((c) => !c.phrasings.some((p) => p.text.trim()));
    if (!written) void writePhrasings(false, false, g);
    else if (missing) void writePhrasings(false, true, g);
    else goTo("engines", g);
  }

  /** Confirm the Prompts gate: edited prompts get one quality check first
   * (same contract as scenarios - passed fingerprints persist, "keep
   * mine" is never recorded, a reviewer failure never blocks). */
  async function confirmPrompts() {
    if (!grid) return;
    const { authored, body } = cellReviewRequest(grid, brand, allCompetitors(), category, audience);
    if (authored.length === 0) {
      proceedPrompts(grid);
      return;
    }
    setBusy("Checking your prompts…");
    setError(null);
    const res = await fetch("/api/setup/grid/cell_review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      proceedPrompts(grid);
      return;
    }
    const flagged: CellReviewItem[] = [];
    const passed: string[] = [];
    authored.forEach(({ c, i }, k) => {
      const v = data.verdicts?.[k];
      if (!v || v.ok) {
        passed.push(cellFp(c));
      } else {
        const stage = grid.stages.find((s) => s.key === c.stage);
        flagged.push({
          index: i,
          meta: `${stage?.label ?? c.stage} · ${cellSubMeta(c)}`,
          current: c.text,
          flags: Array.isArray(v.flags) && v.flags.length > 0 ? v.flags : ["unclear"],
          reason: v.reason || "This one may not ask what its cell measures.",
          suggestion: v.suggestion || c.text,
          choice: "suggestion",
        });
      }
    });
    let next = grid;
    if (passed.length > 0) {
      next = { ...grid, reviewedCells: [...(grid.reviewedCells ?? []), ...passed] };
      setGrid(next);
    }
    if (flagged.length === 0) proceedPrompts(next);
    else setCellReview(flagged);
  }

  /** Apply the prompt-review choices and continue. An accepted suggestion
   * becomes the cell's machine baseline (and clears its paraphrases, so
   * the missing-fill regenerates them for the new wording); a kept-mine
   * cell is left as-is on purpose - it gets flagged again next confirm. */
  function resolveCellReview() {
    if (!grid || !cellReview) return;
    const byIndex = new Map(cellReview.map((it) => [it.index, it]));
    const cells = grid.cells.map((c, i) => {
      const it = byIndex.get(i);
      if (!it || it.choice !== "suggestion") return c;
      // The old wording's set is banked, not thrown away - cycling back
      // to it later restores its paraphrases for free.
      return { ...c, text: it.suggestion, original: it.suggestion, ...swapPhrasings(c, it.suggestion) };
    });
    const next: GridState = { ...grid, cells };
    // Log what the user chose - visibility only, fire and forget.
    void fetch("/api/setup/grid/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        audience: audience || undefined,
        kind: "cell_review_choice",
        items: cellReview.map(({ current, suggestion, flags, reason, choice }) => ({
          current, suggestion, flags, reason, choice,
        })),
      }),
    }).catch(() => {});
    setCellReview(null);
    setGrid(next);
    proceedPrompts(next);
  }

  /** Silent warm of the confirm-time prompt check: same request the
   * confirm will make, fired on field blur, cached server-side. */
  function warmCellReview() {
    if (!grid) return;
    const { authored, body } = cellReviewRequest(grid, brand, allCompetitors(), category, audience);
    if (authored.length === 0) return;
    void fetch("/api/setup/grid/cell_review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  async function create() {
    setSubmitting(true);
    setError(null);
    const usingGrid = mode === "grid";
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: studyName.trim() || undefined,
        brand, category,
        audience: audience || undefined,
        competitors: allCompetitors(),
        engines: engineSet,
        ...(usingGrid
          ? {
              grid: {
                moderators: grid!.moderators,
                cells: grid!.cells
                  .filter((c) => c.text.trim())
                  .map((c) => ({
                    stage: c.stage, layer: c.layer, situation: c.situation, angle: c.angle,
                    mode: c.mode ?? null, text: c.text,
                    phrasings: c.phrasings
                      .filter((p) => p.text.trim())
                      .map((p) => ({ text: p.text, asker: p.asker || undefined })),
                  })),
              },
            }
          : { prompts: prompts!.filter((p) => p.text.trim()) }),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? "something went wrong");
      return;
    }
    if (draftId) {
      await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
      onDraftsChanged();
    }
    const panel: string[] = data.project.engine_set?.length ? data.project.engine_set : engineSet;
    try {
      await fetch(`/api/projects/${data.project.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: panel[0] ?? "gpt-5-mini",
          ...(panel.length > 0 ? { models: panel } : {}),
          // The Landscape samples by paraphrase, not by repeating a wording.
          repeats: usingGrid ? 1 : FIRST_RUN_REPEATS,
        }),
      });
    } catch {
      // The tracker exists either way; the dashboard's Run control reports.
    }
    onCreated(data.project.id);
  }

  /* --------------------------------- counts -------------------------------- */

  const rivalCount = allCompetitors().length;
  const brandNames = [brand, ...allCompetitors()];
  const promptCount =
    mode === "grid" ? gridPromptCount(grid) : (prompts ?? []).filter((p) => p.text.trim()).length;
  const passes = mode === "grid" ? 1 : FIRST_RUN_REPEATS;
  const answers = promptCount * passes * (engineSet.length || 1);
  const stepIndex = steps.findIndex((s) => s.key === step);
  /** Whether the battery is complete enough to pick engines - the same
   * conditions the Prompts footer enforces, so the rail can't jump past
   * a question left without its paraphrases. */
  const promptsReady =
    promptCount >= 4 &&
    (mode !== "grid" ||
      (grid !== null &&
        grid.step === "phrasings" &&
        grid.cells
          .filter((c) => c.text.trim())
          .every((c) => c.phrasings.some((p) => p.text.trim()))));

  /* --------------------------------- footer -------------------------------- */

  let footerLeft: string = "";
  let footerAction: { label: string; onClick: () => void; disabled: boolean } | null = null;
  if (step === "market") {
    footerLeft = suggesting ? "Estimating your market…" : "";
    footerAction = {
      label: busy ?? "This is my market",
      onClick: () => void confirmMarket(),
      disabled: suggesting || busy !== null || !category.trim(),
    };
  } else if (step === "scenarios" && grid) {
    const active = grid.scenarios.length;
    footerLeft =
      active > scenarioCap
        ? `${active} scenarios active - your plan includes ${scenarioCap}; untick ${active - scenarioCap}`
        : `${active} of ${scenarioCap} scenarios`;
    footerAction = {
      label: busy ?? "These are my buyers",
      onClick: () => void confirmScenarios(),
      disabled:
        busy !== null || active === 0 || active > scenarioCap ||
        grid.scenarios.some((s) => !s.label.trim()),
    };
  } else if (step === "stages" && grid) {
    const cells = gridCellCount(grid, rivalCount);
    footerLeft = `${grid.keptStages.length} stages · ${grid.scenarios.length} scenarios → ${cells} questions → ~${cells * 10} prompts`;
    footerAction = {
      label: busy ?? "This is my coverage",
      onClick: () => void writeCells(),
      disabled: busy !== null || grid.keptStages.length === 0 || grid.scenarios.some((s) => !s.label.trim()),
    };
  } else if (step === "prompts" && mode === "grid" && grid) {
    const live = grid.cells.filter((c) => c.text.trim());
    const written = grid.step === "phrasings";
    // A question loses its set when its prompt is rewritten or cycled
    // after the first write - fill those gaps before moving on.
    const missing = written && live.some((c) => !c.phrasings.some((p) => p.text.trim()));
    // All three confirms run the edited-prompt quality check first;
    // proceedPrompts then picks the same action each label promises.
    if (!written) {
      const branded = live.filter((c) => namesAny(c.text, brandNames)).length;
      footerLeft = `${live.length} questions · ${live.length - branded} blind · ${branded} branded`;
      footerAction = {
        label: busy ?? "These are my questions",
        onClick: () => void confirmPrompts(),
        disabled: busy !== null || live.length < 4,
      };
    } else if (missing) {
      footerLeft = `${promptCount} prompts across ${live.length} questions - some questions still need paraphrases`;
      footerAction = {
        label: busy ?? "Write the missing paraphrases",
        onClick: () => void confirmPrompts(),
        disabled: busy !== null || live.length < 4,
      };
    } else {
      footerLeft = `${promptCount} prompts across ${live.length} questions`;
      footerAction = {
        label: busy ?? "These are my prompts",
        onClick: () => void confirmPrompts(),
        disabled: busy !== null || promptCount < 4,
      };
    }
  } else if (step === "prompts" && mode === "classic") {
    footerLeft = `${promptCount} prompts`;
    footerAction = {
      label: "These are my prompts",
      onClick: () => goTo("engines"),
      disabled: busy !== null || promptCount < 4,
    };
  } else if (step === "engines") {
    footerLeft = `First run: ${promptCount.toLocaleString()} prompts × ${
      passes > 1 ? `${passes} repeats × ` : ""
    }${engineSet.length || 1} engine${engineSet.length === 1 ? "" : "s"} = ${answers.toLocaleString()} answers`;
    footerAction = {
      label: submitting ? "Starting your first run…" : "Create tracker & run",
      onClick: () => void create(),
      disabled: submitting || engineSet.length === 0 || promptCount < 4,
    };
  }

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="flex h-full min-h-0">
      {/* rail */}
      <nav className="w-56 shrink-0 border-r border-line px-5 py-5 flex flex-col gap-1 bg-surface-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 mb-2">
          {mode === "grid" ? "Buyer Landscape" : "Visibility scan"}
        </span>
        {steps.map((s, i) => {
          const state = i < stepIndex ? "done" : i === stepIndex ? "current" : i <= reached ? "reached" : "ahead";
          const clickable =
            (state === "done" || state === "reached") && busy === null && !submitting &&
            !(s.key === "engines" && !promptsReady);
          return (
            <button
              key={s.key}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && goTo(s.key)}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] ${
                state === "current" ? "bg-primary-soft text-primary font-semibold" :
                state === "ahead" ? "text-ink-3" : "text-ink hover:bg-primary-soft/60"
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full border ${
                  state === "done" ? "bg-primary border-primary" :
                  state === "current" ? "border-primary" : "border-line"
                }`}
              />
              {s.label}
            </button>
          );
        })}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void requestClose()}
          disabled={busy !== null || submitting}
          className="text-left text-[13px] font-medium text-primary hover:opacity-80 disabled:opacity-50 px-2"
        >
          {saving ? "Saving…" : "Save & close"}
        </button>
        <span className="px-2 text-[11px] text-ink-3">Progress saves at every step.</span>
      </nav>

      {/* stage */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-[17px] tracking-tight truncate">
              {steps[stepIndex]?.label} <span className="text-ink-3 font-normal">· {brand}</span>
            </h2>
          </div>
          <button
            type="button"
            aria-label="close"
            onClick={() => void requestClose()}
            className="text-ink-3 hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {step === "market" && (
            suggesting ? (
              <div className="grid gap-4 py-16 text-center justify-items-center">
                <span aria-hidden="true" className="h-7 w-7 rounded-full border-[3px] border-line border-t-primary animate-spin" />
                <p className="text-sm font-medium">Estimating your market…</p>
                <p className="text-[13px] text-ink-3">category · competitors · audience</p>
              </div>
            ) : busy ? (
              <div className="grid gap-4 py-16 text-center justify-items-center">
                <span aria-hidden="true" className="h-7 w-7 rounded-full border-[3px] border-line border-t-primary animate-spin" />
                <p className="text-sm font-medium">{busy}</p>
              </div>
            ) : (
              <div className="grid gap-4 max-w-xl">
                <p className="text-[13px] text-ink-3">
                  Deduced from the brand. Everything that follows is composed from
                  these three, so make them right before moving on.
                </p>
                <label className="grid gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Study name <span className="font-normal normal-case tracking-normal text-ink-3">(optional)</span>
                  <input className="input w-full" value={studyName} onChange={(e) => setStudyName(e.target.value)} placeholder={`e.g. ${brand} AI visibility - Q3`} />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Category
                  <input className="input w-full" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. market research firms" />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Competitors
                  {competitors.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 normal-case tracking-normal">
                      {competitors.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-[13px] font-medium text-primary">
                          {c}
                          <button type="button" aria-label={`remove ${c}`} onClick={() => setCompetitors(competitors.filter((x) => x !== c))} className="text-primary/70 hover:text-danger leading-none">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    className="input w-full"
                    value={compDraft}
                    onChange={(e) => setCompDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addCompetitor(); }
                    }}
                    onBlur={() => { if (compDraft.trim()) addCompetitor(); }}
                    placeholder={competitors.length === 0 ? "e.g. Qualtrics - press Enter after each" : "add another…"}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Audience <span className="font-normal normal-case tracking-normal text-ink-3">(optional)</span>
                  <input className="input w-full" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. mid-market CPG brands" />
                </label>
              </div>
            )
          )}

          {step === "scenarios" && grid && (
            <ScenariosGate
              state={grid}
              setState={setGrid}
              busy={busy !== null}
              readDelta={readDelta}
              onRecomposeBase={(base, rows) => void recomposeBase(base, rows)}
              onRecompose={(base, rows) => {
                setReadDelta(null);
                void gridApi.compose({ base, rows });
              }}
              onSuggestScenario={() => void gridApi.suggestScenario()}
              onNearScenario={(i) => void gridApi.nearScenario(i)}
              onWarmReview={warmScenarioReview}
              maxScenarios={scenarioCap}
            />
          )}
          {step === "scenarios" && review && (
            <ScenarioReviewModal
              items={review}
              busy={busy !== null}
              onChoice={(k, choice) =>
                setReview((r) => r && r.map((it, j) => (j === k ? { ...it, choice } : it)))
              }
              onBack={() => setReview(null)}
              onContinue={() => void resolveReview()}
            />
          )}

          {step === "stages" && grid && (
            <CoverageGate
              state={grid}
              setState={setGrid}
              busy={busy !== null}
            />
          )}

          {step === "prompts" && mode === "grid" && grid && (
            <div className="grid gap-3">
              {/* Busy stays inline so the gate never unmounts - open stages
                  and folds survive a paraphrase write. */}
              {(busy !== null || grid.step === "phrasings") && (
                <div className="flex justify-end">
                  {busy !== null ? (
                    <span className="flex items-center gap-2 text-[13px] font-medium text-primary">
                      <span aria-hidden="true" className="h-3.5 w-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                      {busy}
                    </span>
                  ) : (
                    <button type="button" onClick={() => void writePhrasings(true)} className="text-[13px] font-medium text-primary hover:opacity-80">
                      Rewrite all paraphrases
                    </button>
                  )}
                </div>
              )}
              <CellsGate
                state={grid}
                setState={setGrid}
                brandNames={brandNames}
                busy={busy !== null}
                onRegenerate={(i) => gridApi.regenerateCell(i)}
                onCycle={(i, dir) => gridApi.cycleCell(i, dir)}
                onWarmReview={warmCellReview}
              />
            </div>
          )}
          {step === "prompts" && cellReview && (
            <CellReviewModal
              items={cellReview}
              busy={busy !== null}
              onChoice={(k, choice) =>
                setCellReview((r) => r && r.map((it, j) => (j === k ? { ...it, choice } : it)))
              }
              onBack={() => setCellReview(null)}
              onContinue={resolveCellReview}
            />
          )}

          {step === "prompts" && mode === "classic" && prompts && (
            <div className="grid gap-3 max-w-2xl">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold uppercase tracking-wide text-primary">
                  Prompt battery <span className="font-normal normal-case tracking-normal text-ink-3">· drafted for you</span>
                </span>
                <div className="flex gap-4">
                  {!editing && (
                    <button type="button" onClick={() => setEditing(true)} className="text-[13px] font-medium text-primary hover:opacity-80">Edit</button>
                  )}
                  <button type="button" onClick={() => void draftBattery(true)} disabled={busy !== null} className="text-[13px] font-medium text-primary hover:opacity-80 disabled:opacity-50">
                    {busy ?? "Regenerate"}
                  </button>
                </div>
              </div>
              {!editing ? (
                <div className="rounded-lg border border-line divide-y divide-line">
                  {prompts.map((p, i) => (
                    <div key={i} className="flex items-baseline gap-3 px-3.5 py-2 text-sm">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3 w-28 shrink-0">{p.theme.replace("_", " ")}</span>
                      <span className="text-ink-2">{p.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-2">
                  {prompts.map((p, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <select
                        value={p.theme}
                        onChange={(e) => setPrompts(prompts.map((q, j) => (j === i ? { ...q, theme: e.target.value as PromptTheme } : q)))}
                        className="input w-36 shrink-0 text-xs"
                      >
                        {THEMES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                      </select>
                      <textarea className="input w-full resize-none field-sizing-content" rows={2} value={p.text} onChange={(e) => setPrompts(prompts.map((q, j) => (j === i ? { ...q, text: e.target.value } : q)))} />
                      <button type="button" aria-label="remove prompt" onClick={() => setPrompts(prompts.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger text-lg leading-none px-1">×</button>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between">
                    <button type="button" onClick={() => setPrompts([...prompts, { text: "", theme: "discovery" }])} className="text-[13px] font-medium text-primary hover:opacity-80">+ Add prompt</button>
                    <button type="button" onClick={() => { setPrompts(prompts.filter((p) => p.text.trim())); setEditing(false); }} className="text-[13px] font-medium text-primary hover:opacity-80">Done editing</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "engines" && (
            <div className="grid gap-3 max-w-2xl">
              <span className="text-sm font-semibold uppercase tracking-wide text-primary">
                AI engines <span className="font-normal normal-case tracking-normal text-ink-3">(the tracker&apos;s core panel - every run and the trend measure these)</span>
              </span>
              <EnginePicker
                options={engineOptions}
                selected={engineSet}
                onToggle={(id, checked) => setEngineSet((prev) => (checked ? [...prev, id] : prev.filter((m) => m !== id)))}
                onPreset={(list) => setEngineSet(() => list)}
              />
              <p className="text-[13px] text-ink-3">
                This is the last decision because it multiplies everything above.
                The first run starts when you create the tracker and lands in the background.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-danger mt-4">{error}</p>}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-line px-6 py-3 bg-surface">
          <span className="text-[13px] text-ink-3 truncate">{footerLeft}</span>
          {footerAction && (
            <button
              type="button"
              // Keep focus where it is: otherwise a focused field's blur
              // fires first, starts a recompose, and the busy state
              // swallows this click - the button "does nothing" once.
              onMouseDown={(e) => e.preventDefault()}
              onClick={footerAction.onClick}
              disabled={footerAction.disabled}
              className="btn-primary shrink-0 inline-flex items-center gap-2"
            >
              {(busy !== null || submitting) && (
                <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              )}
              {footerAction.label}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
