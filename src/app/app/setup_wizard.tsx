"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PromptTheme, SetupDraft } from "@/lib/types";
import { EnginePicker, currentEngineSet, defaultEnginesFor, type EngineOption } from "@/app/components/engine_picker";
import {
  CellReviewModal,
  CellsGate,
  WorriesGate,
  PHRASING_COUNT,
  phrasingTarget,
  cellSubMeta,
  CoverageGate,
  ScenarioReviewModal,
  ScenariosGate,
  CELLS_BUSY,
  gridCellCount,
  gridCellPlan,
  recommendedWorryPairs,
  buildSetupDecision,
  gridPromptCount,
  namesAny,
  normalizeGrid,
  rebindRooms,
  scenarioRows,
  swapPhrasings,
  useGridSetup,
  type CellReviewItem,
  type GridCellUi,
  type GridState,
  type ScenarioReviewItem,
  type ScenarioRow,
} from "./grid_setup";
import { ANGLE_SLOTS, angleRivals, classAnglesOf, deriveCheckSpec, rosterRoleOf, sameSeatOf, type RosterClasses, type RosterRole, type RosterRoles } from "@/lib/engine/battery_checks";
import { Spinner, InlineSpinner } from "../components/spinner";

/**
 * The setup wizard: a rail of steps, one gate at a time, a fixed footer that
 * says what the next button spends. Container-agnostic - the page decides
 * whether this sits in a sheet or on a route; the wizard only needs
 * onClose/onCreated. Every gate persists as a draft, so closing, refreshing,
 * or tabbing away never loses work.
 */

export type SetupMode = "classic" | "grid";
type StepKey = "market" | "scenarios" | "worries" | "stages" | "prompts" | "engines";

const STEPS: Record<SetupMode, { key: StepKey; label: string }[]> = {
  grid: [
    { key: "market", label: "Your market" },
    { key: "scenarios", label: "Buying scenarios" },
    { key: "worries", label: "Buyer worries" },
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
  worries: "at buyer worries",
  stages: "at the coverage map",
  prompts: "at prompts",
  paraphrases: "prompts written",
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
 * under - cell identity plus the exact wording (a paraphrase fingerprints
 * with its own text under the same cell identity). */
function cellFp(
  c: { stage: string; situation: string | null; angle: string },
  text: string
): string {
  return [c.stage, c.situation ?? "", c.angle, text.trim()].join("|");
}

/** The cells the Prompts-gate quality check must judge - live, edited away
 * from their machine baseline, not already passed - and the request body
 * the reviewer takes. Shared by the confirm and its blur-time warm. */
function cellReviewRequest(
  g: GridState,
  brand: string,
  competitors: string[],
  category: string,
  audience: string,
  rosterRoles?: RosterRoles
) {
  const done = new Set(g.reviewedCells ?? []);
  const stageBy = new Map(g.stages.map((s) => [s.key, s]));
  const scDesc = new Map(g.scenarios.map((s) => [s.label, s.description]));
  // Seeds and edited paraphrases alike - each entry is one prompt text
  // judged against its cell's design.
  const all: { c: (typeof g.cells)[number]; i: number; phr?: number; text: string; original: string | null }[] = [];
  g.cells.forEach((c, i) => {
    if (!c.text.trim()) return;
    if (c.text.trim() !== (c.original ?? "").trim() && !done.has(cellFp(c, c.text))) {
      all.push({ c, i, text: c.text, original: c.original ?? null });
    }
    c.phrasings.forEach((ph, k) => {
      if (!ph.text.trim()) return;
      if (ph.text.trim() !== (ph.original ?? "").trim() && !done.has(cellFp(c, ph.text))) {
        all.push({ c, i, phr: k, text: ph.text, original: ph.original ?? null });
      }
    });
  });
  // The reviewer takes at most 24 per request: larger edit sets go as
  // sequential chunks of 24 (they used to be cut at 24, the rest shipping
  // unreviewed).
  const authored = all;
  const candidate = ({ c, phr, text, original }: (typeof all)[number]) => {
    const st = stageBy.get(c.stage);
    return {
      // s7: a spec-era cell is checked against its typed design - the
      // server re-derives it from the seed (the edited text itself when
      // this IS the seed) and returns the seed's new spec.
      ...(c.spec ? { spec: c.spec, seedEdit: phr == null, seed: c.text } : {}),
      text,
      original,
      stage: st?.label ?? c.stage,
      stageKey: c.stage,
      hint: st?.hint ?? null,
      tag: st?.tag ?? null,
      situation: c.situation,
      situationDescription: c.situation ? scDesc.get(c.situation) ?? null : null,
      angle: c.angle,
      mode: c.mode ?? null,
      // The cell's design, so an edit is checked against what its cell
      // measures (a head-to-head's rival, a worry's concern, a Value
      // cell's line), not the stage at large.
      concern: c.concern ?? null,
      valueLine: c.valueLine ?? null,
      // Class-angle cells carry their class into the review (spec + rule).
      ...(c.classPhrase ? { classPhrase: c.classPhrase, classBrand: c.classBrand ?? undefined } : {}),
    };
  };
  const bodies: { brand: string; category: string; competitors: string[]; rosterRoles?: RosterRoles; audience?: string; candidates: ReturnType<typeof candidate>[] }[] = [];
  for (let k = 0; k < authored.length; k += CELL_REVIEW_BATCH) {
    bodies.push({
      brand,
      category,
      competitors,
      rosterRoles,
      audience: audience || undefined,
      candidates: authored.slice(k, k + CELL_REVIEW_BATCH).map(candidate),
    });
  }
  return { authored, bodies };
}

/** The cell_review route's per-request cap. */
const CELL_REVIEW_BATCH = 24;

/** The market read narrated: elapsed-driven captions matching the order
 * the model actually works in, so a two-minute read on a hard market
 * reads as deliberate progress instead of a stuck spinner. */
const READ_STAGES: [number, string][] = [
  [0, "Reading how this market buys…"],
  [8, "Classifying the decision - involvement, proof, who decides…"],
  [22, "Finding the buyers…"],
  [45, "Examining the buyers…"],
  [75, "Finalizing your market…"],
  [105, "Still thinking - a hard market can take about two minutes…"],
];

/** The cell write narrated - option B, the buyer's-eye captions (Tyler,
 * 2026-10-02), elapsed-driven like the other narrated waits. */
const CELLS_STAGES: [number, string][] = [
  [0, CELLS_BUSY],
  [30, "Putting each buyer's situation into words…"],
  [70, "Asking the way a real person would type it…"],
  [110, "Keeping every question to one clear ask…"],
  [150, "Nearly there - finalizing the details…"],
];

/** The worries pool draw narrated: one model call, so the captions walk
 * its internal order - enumerate the worry-space, tag the stances, write
 * the buyer wording, draft the recommended plan. */
const WORRIES_STAGES: [number, string][] = [
  [0, "Listening to your market…"],
  [25, "Gathering the worries buyers voice…"],
  [55, "Putting them in buyers' own words…"],
  [85, "Nearly there…"],
  [115, "Still listening…"],
];

/** Wall-clock stamp for the in-flight marker (kept out of the component so
 * the compiler lint does not read it as an impure call during render). */
const nowStamp = (): number => Date.now();

function StagedProgress({ stages, startedAt }: { stages: readonly [number, string][]; startedAt?: number | null }) {
  // A resumed write narrates from when it actually started.
  const [secs, setSecs] = useState(() => (startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0));
  useEffect(() => {
    // Elapsed from the clock, not tick-counting: background tabs throttle
    // timers, and the narration must not fall behind the actual work.
    const started = startedAt ?? Date.now();
    const iv = setInterval(() => setSecs(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [startedAt]);
  const msg = [...stages].reverse().find(([at]) => secs >= at)?.[1] ?? stages[0][1];
  return (
    <div className="grid gap-4 py-16 text-center justify-items-center">
      <Spinner />
      <p className="m-0 text-sm font-medium">{msg}</p>
    </div>
  );
}

interface DraftPrompt {
  text: string;
  theme: PromptTheme;
}

const THEMES: PromptTheme[] = ["discovery", "recommendation", "comparison", "use_case", "branded"];

/** What each classic theme asks - the reviewer's drift test needs to know
 * what territory a prompt belongs to. Classic prompts have no per-cell
 * brand design, so they review under the open brand rule. */
const THEME_HINTS: Record<PromptTheme, string> = {
  discovery: "an open look at what's out there in the category",
  recommendation: "asks what to pick for a need",
  comparison: "weighs named options against each other",
  use_case: "asks whether or how the category serves a specific job",
  branded: "asks directly about the brand by name",
};

interface WizardDraft {
  mode: SetupMode;
  step: StepKey;
  studyName: string;
  grid: GridState | null;
  engineSet: string[];
  /** Classic mode's machine baselines: prompts whose text is in this list
   * were drafted by the model; anything else is user-written and gets the
   * quality check at confirm. */
  machinePrompts?: string[];
  /** Classic-mode fingerprints (theme|text) that PASSED the check. */
  reviewedPrompts?: string[];
  /** The cell write was started (ms since epoch) and has not landed
   * (2026-10-07, Tyler): a draft reopened with this set resumes on the
   * writing progress and re-requests the cells - the server's coalesced
   * generation keeps running after the modal closes, so the re-request
   * waits on it or hits cache - instead of showing the coverage map again. */
  cellsInFlight?: number;
  /** Same for the paraphrase write (saved at prompts, dropped once any
   * paraphrase exists) and the market read (saved at market, dropped once
   * a grid exists). */
  phrasingsInFlight?: number;
  readInFlight?: number;
  /** Typed roster (2026-09-30): competitor -> same_seat | upstream, as
   * classified and then confirmed by the chip toggle. Absent = untyped
   * (every competitor same_seat). */
  rosterRoles?: RosterRoles;
  /** The classifier's one-line note per competitor (chip tooltip). */
  rosterNotes?: Record<string, string>;
  /** Class-angle cells (2026-10-01): upstream competitor -> the buyer's
   * class phrase ("a Visa card"), for the upstream brands buyers still
   * choose BY. Each earns one class-angle comparison cell. */
  rosterClasses?: RosterClasses;
  /** Who the client brand sells to - stored only (future second-seat
   * signal). */
  clientSellsTo?: string[];
  /** Init decision 3 (2026-10-03): the classifier's one-line reason per
   * recommended head-to-head rival (toggle tooltip). */
  rosterReasons?: Record<string, string>;
  /** Parent company per competitor, and the client's - a competitor that
   * shares the client's parent wears a "same parent" tag (sister brand:
   * its head-to-heads report as portfolio routing). */
  rosterParents?: Record<string, string>;
  clientParent?: string;
}

/** The roster classifier's reply (/api/setup/roster). */
interface RosterVerdict {
  competitors: {
    name: string; role: RosterRole; note: string; consumerSalient?: boolean; classPhrase?: string;
    parent?: string; h2hRank?: number; h2hReason?: string;
  }[];
  clientSellsTo: string[]; clientParent?: string; failedOpen?: boolean;
}

/** Roles after a classify (pure). Decision 3: the classifier's same_seat
 * verdicts become head-to-head pre-picks - the top ANGLE_SLOTS by its rank
 * are same_seat (picked), the rest bench. A name filled later (hand-added)
 * is picked only while a slot is free. A role the user set is never
 * overwritten. */
function rolesAfterClassify(prev: RosterRoles | undefined, roster: RosterVerdict, fresh: boolean): RosterRoles {
  const next: RosterRoles = fresh ? {} : { ...(prev ?? {}) };
  const incoming = roster.competitors
    .filter((v) => fresh || !(v.name in next))
    .sort((a, b) => (a.h2hRank || 1e9) - (b.h2hRank || 1e9));
  // Decision 3c follow-through (2026-10-04 seed review K): slots go to
  // different owners first - a rival sharing a parent with a higher
  // pick, or with the client, is demoted below the first other-parent
  // rival, then fills any slot still free. Same-parent picks report as
  // portfolio routing, so they are a deliberate choice, never a default.
  const norm = (t: string | undefined) => (t ?? "").trim().toLowerCase();
  const pickedParents = new Set<string>();
  if (roster.clientParent) pickedParents.add(norm(roster.clientParent));
  for (const [name, role] of Object.entries(next)) {
    if (role !== "same_seat") continue;
    const p = norm(roster.competitors.find((v) => v.name === name)?.parent);
    if (p) pickedParents.add(p);
  }
  const direct = incoming.filter((v) => v.role === "same_seat");
  for (const v of incoming) if (v.role !== "same_seat") next[v.name] = v.role;
  const deferred: typeof direct = [];
  for (const v of direct) {
    const picked = Object.values(next).filter((r) => r === "same_seat").length;
    const p = norm(v.parent);
    if (picked < ANGLE_SLOTS && !(p && pickedParents.has(p))) {
      next[v.name] = "same_seat";
      if (p) pickedParents.add(p);
    } else {
      deferred.push(v);
    }
  }
  for (const v of deferred) {
    const picked = Object.values(next).filter((r) => r === "same_seat").length;
    next[v.name] = picked < ANGLE_SLOTS ? "same_seat" : "bench";
  }
  return next;
}

/** Class phrases after a classify (pure): the upstream brands buyers still
 * choose BY. Same fill semantics as notes; a name the classifier calls
 * non-salient carries no entry (no class cell). */
function classesAfterClassify(prev: RosterClasses | undefined, roster: RosterVerdict, fresh: boolean): RosterClasses | undefined {
  const next: RosterClasses = fresh ? {} : { ...(prev ?? {}) };
  for (const v of roster.competitors) {
    if (!fresh && v.name in next) continue;
    if (v.consumerSalient && v.classPhrase?.trim()) next[v.name] = v.classPhrase.trim();
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

interface Props {
  mode: SetupMode;
  brand: string;
  draft: SetupDraft | null;
  engineOptions: EngineOption[];
  onClose: () => void;
  /** `starting`: a first run is being launched in the background - the
   * dashboard opens on its "Setting up" phase instead of waiting here. */
  onCreated: (projectId: string, opts?: { starting?: boolean }) => void;
  /** Create clicked (info) / create failed (null): the host shows the
   * tracker's "Setting up" card on the page while the tracker is written,
   * and hides this modal - kept mounted so a failure returns to it with
   * its error. */
  onCreating?: (info: { name: string; promptCount: number } | null) => void;
  /** Called after every draft save with the saved row, so the host can
   * merge it into its list synchronously (a reopen before the list
   * re-fetched used to hydrate from the stale row - the engine panel
   * "didn't save", 2026-10-09). */
  onDraftsChanged: (saved?: SetupDraft) => void;
  /** The close-time save, so the host can wait on it before reopening
   * the same draft. */
  onCloseSave?: (draftId: string | null, done: Promise<void>) => void;
  /** Demo mode: the full setup experience, but nothing persists - no
   * drafts saved, no tracker created, no run started. */
  demo?: boolean;
  /** Edit-setup for a ZERO-RUN tracker: the wizard resumes on the
   * tracker's instrument and Save replaces it in place - no draft chips,
   * no new tracker, never a run. Locked out once any run exists. */
  editProjectId?: string;
}

export function SetupWizard({ mode, brand, draft, engineOptions, onClose, onCreated, onCreating, onDraftsChanged, onCloseSave, demo = false, editProjectId }: Props) {
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
  const [cellsInFlight, setCellsInFlight] = useState<number | null>(saved?.cellsInFlight ?? null);
  const [phrasingsInFlight, setPhrasingsInFlight] = useState<number | null>(saved?.phrasingsInFlight ?? null);
  const [readInFlight, setReadInFlight] = useState<number | null>(saved?.readInFlight ?? null);
  const resumePhrasings =
    savedStep === "prompts" && !!saved?.phrasingsInFlight && !!saved?.grid && saved.grid.step !== "phrasings" &&
    !saved.grid.cells.some((c) => c.phrasings.some((ph) => ph.text.trim()));
  const resumeRead = savedStep === "market" && !!saved?.readInFlight && !saved?.grid;
  // Resume a cell write the previous session started (see WizardDraft.cellsInFlight).
  // The marker alone decides (2026-10-24): it rides only saves made while
  // the write runs, and recomposes now carry cells, so "no cells yet" no
  // longer tells an unfinished write apart.
  const resumeWrite = savedStep === "stages" && !!saved?.cellsInFlight && !!saved?.grid;
  const resumedRef = useRef(false);
  const [category, setCategory] = useState(draft?.category ?? "");
  const [competitors, setCompetitors] = useState<string[]>(draft?.competitors ?? []);
  const [compDraft, setCompDraft] = useState("");
  const [rosterRoles, setRosterRoles] = useState<RosterRoles | undefined>(saved?.rosterRoles);
  const [rosterNotes, setRosterNotes] = useState<Record<string, string>>(saved?.rosterNotes ?? {});
  const [rosterClasses, setRosterClasses] = useState<RosterClasses | undefined>(saved?.rosterClasses);
  const [clientSellsTo, setClientSellsTo] = useState<string[] | undefined>(saved?.clientSellsTo);
  const [rosterReasons, setRosterReasons] = useState<Record<string, string>>(saved?.rosterReasons ?? {});
  const [rosterParents, setRosterParents] = useState<Record<string, string>>(saved?.rosterParents ?? {});
  const [clientParent, setClientParent] = useState<string | undefined>(saved?.clientParent);
  /** Transient note when a 5th head-to-head is attempted. */
  const [h2hNote, setH2hNote] = useState<string | null>(null);
  const [audience, setAudience] = useState(draft?.audience ?? "");
  const [prompts, setPrompts] = useState<DraftPrompt[] | null>(draft?.prompts ?? null);
  const [editing, setEditing] = useState(false);
  const [grid, setGrid] = useState<GridState | null>(() => normalizeGrid(saved?.grid ?? null));
  /** The grid as of the last update, rendered or not (2026-10-24): every
   * grid write goes through updateGrid, which applies it here first, so a
   * result landing after an await merges into the grid as it is NOW -
   * edits made during the wait survive - and a step change persists what
   * the user actually sees. */
  const gridRef = useRef<GridState | null>(grid);
  function updateGrid(u: GridState | null | ((prev: GridState | null) => GridState | null)): GridState | null {
    const next = typeof u === "function" ? u(gridRef.current) : u;
    gridRef.current = next;
    setGrid(next);
    return next;
  }
  /** Flagged user-authored scenarios awaiting a keep/suggestion choice. */
  const [review, setReview] = useState<ScenarioReviewItem[] | null>(null);
  /** Flagged user-edited prompts awaiting a keep/suggestion choice. */
  const [cellReview, setCellReview] = useState<CellReviewItem[] | null>(null);
  /** Demo mode's end state: the walk is complete, nothing was created. */
  const [demoDone, setDemoDone] = useState(false);
  // Classic-mode review baselines. Same-turn saves pass fresh values to
  // goTo explicitly, since a setter hasn't landed yet when persist runs.
  // Legacy drafts without baselines treat their saved battery as
  // machine-written, so nothing is retroactively flagged.
  const [machinePrompts, setMachinePrompts] = useState<string[]>(
    saved?.machinePrompts ?? (draft?.prompts?.map((p) => p.text) ?? [])
  );
  const [reviewedPrompts, setReviewedPrompts] = useState<string[]>(saved?.reviewedPrompts ?? []);
  /** What the last "Your market buys" edit changed downstream. */
  const [readDelta, setReadDelta] = useState<string | null>(null);
  // Saved panels resolve retired ids to their successors on load; the
  // next autosave writes the cleaned list back.
  const [chosenEngines, setChosenEngines] = useState<string[] | null>(
    saved?.engineSet ? currentEngineSet(saved.engineSet, engineOptions) : null
  );
  // Until the user touches the panel, it is the default for what this
  // deployment can reach - derived, so it tracks the options as they load.
  const engineSet = chosenEngines ?? defaultEnginesFor("both", engineOptions);
  const setEngineSet = (update: (prev: string[]) => string[]) =>
    setChosenEngines((prev) => update(prev ?? defaultEnginesFor("both", engineOptions)));
  // The tracker's unique id exists the moment setup STARTS (Tyler,
  // 2026-09-28): generated client-side, upserted as the draft id, sent as
  // x-setup-id on every spend call, transferred to the project at create.
  const [draftId, setDraftId] = useState<string | null>(
    draft?.id ?? (demo || editProjectId ? null : crypto.randomUUID())
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** One-line explanation for why a confirm re-landed on the Prompts
   * gate (it wrote prompts for new questions) - cleared on the next
   * confirm or when leaving the gate. */
  const [promptsNotice, setPromptsNotice] = useState<string | null>(null);
  // The market the current battery was composed from; a changed market
  // means a deliberate trip back, and a recompose on re-confirm.
  const [servedRead, setServedRead] = useState<string | null>(
    draft ? readKey(draft.category, draft.audience ?? "") : null
  );
  const [servedRivals, setServedRivals] = useState<string | null>(
    draft ? rivalsKey(draft.competitors ?? [], saved?.rosterRoles, saved?.rosterClasses) : null
  );

  /** The plan's buying-scenario cap (PLAN_SCENARIO_CAPS); 4 until the
   * plan loads, then Starter/Growth tighten to 3. */
  const [scenarioCap, setScenarioCap] = useState(4);
  /** The caller's plan tier - gates enterprise-only affordances (the
   * whole-battery rewrite). Null until loaded = hidden. */
  const [plan, setPlan] = useState<string | null>(null);
  /** Custom questions the plan may add net of deletions (provisional
   * allotment - the per-tier numbers are still to be decided). Defaults
   * to the most generous tier so the moment before the plan loads can
   * never falsely block; it only tightens downward. */
  const [customAllowance, setCustomAllowance] = useState(12);
  /** Worry picks the plan includes (PLAN_WORRY_ALLOWANCE); null = no cap
   * (every tier today - worries ride the monthly cadence, so the
   * recommendation layer steers volume, not a hard limit). */
  const [worryCap, setWorryCap] = useState<number | null>(null);

  const gridApi = useGridSetup({
    setNotice: setPromptsNotice,
    setupId: draftId,
    brand, category, competitors: allCompetitors(), audience, rosterRoles, rosterClasses,
    maxScenarios: scenarioCap,
    state: grid, setState: updateGrid, getState: () => gridRef.current, setBusy, setError,
  });

  /** Landing on the worries gate: make sure the pool exists (usually a
   * cache hit - it warms during the scenarios review), then pre-pick the
   * top worries at their recommended stance the FIRST time only - the
   * user's picks are never overwritten. */
  async function landOnWorries(from?: GridState | null) {
    const st = await gridApi.fetchWorries(from === undefined ? gridRef.current : from);
    if (!st) return;
    // Warm what the coverage map needs while the worries are reviewed
    // (Tyler 2026-10-06): the Value lines and catalog, and the per-room
    // defaults for stages the mask reaches nowhere. enterCoverage awaits
    // both, so the map never opens before they have landed.
    void gridApi.loadValueLines(st);
    void gridApi.loadStageRooms(st);
    // Pre-pick = the pool's recommended measurement plan, the FIRST time
    // only, on the grid as it is now; the user's deviation from it is
    // recorded at create (worry_decision).
    updateGrid((cur) =>
      cur && cur.worries === undefined && (cur.worryPool?.length ?? 0) > 0
        ? { ...cur, worries: recommendedWorryPairs(cur.worryPool ?? []).slice(0, worryCap ?? Infinity) }
        : cur
    );
  }

  /** The coverage map opens only once its recommendations have landed:
   * the Value lines per room and the per-room stage defaults. Both are
   * warmed on the worries gate, so this is normally a cache hit. */
  async function enterCoverage(from?: GridState | null) {
    const g = from === undefined ? gridRef.current : from;
    if (!g) return;
    setBusy("Preparing your coverage map…");
    setError(null);
    try {
      // Each loader merges into the live grid; a failed one lands nothing
      // (no Value line is ever set to "none" by a failure).
      await gridApi.loadValueLines(g);
      await gridApi.loadStageRooms();
      goTo("stages", gridRef.current);
    } finally {
      setBusy(null);
    }
  }

  const estimated = useRef(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/plan", { signal: AbortSignal.timeout(15_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && typeof d?.scenarioCap === "number") setScenarioCap(d.scenarioCap);
        if (alive && typeof d?.plan === "string") setPlan(d.plan);
        if (alive && typeof d?.customCellAllowance === "number") setCustomAllowance(d.customCellAllowance);
        if (alive && typeof d?.worryCap === "number") setWorryCap(d.worryCap);
      })
      .catch(() => {});
    // A draft resumed directly onto the scenarios gate never passes goTo;
    // warm its near-variant pools here.
    if (step === "scenarios") gridApi.warmWorries();
    // Resumed on the market step with a known category: warm the read.
    if (step === "market" && category.trim()) gridApi.warmRead();
    // Resumed mid-flow: warm whatever the NEXT gate will ask for.
    // (Deferred a tick: landOnWorries sets busy state, which an effect
    // body must not do synchronously.)
    if (step === "worries") void Promise.resolve().then(() => landOnWorries());
    if (step === "stages" && !resumeWrite) { gridApi.warmCells(); void gridApi.loadValueLines(); }
    if (step === "prompts" && mode === "grid" && !resumePhrasings) gridApi.warmPhrasings();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  /** What the market read depends on - competitors deliberately excluded:
   * they shape only the rival cells, never the scenarios or the mask. */
  function readKey(c: string, a: string): string {
    return `${c.trim()}|${a.trim()}`;
  }

  function allCompetitors(): string[] {
    const d = compDraft.trim().replace(/,+$/, "");
    // 12 is the create route's cap; the setup routes match it. Capping at
    // entry beats an opaque "bad request" at the Prompts gate.
    return [...new Set(d ? [...competitors, d] : competitors)].slice(0, 12);
  }

  function addCompetitor() {
    const comps = allCompetitors();
    setCompetitors(comps);
    setCompDraft("");
    // A hand-added rival is same_seat until the next classify, which runs
    // shortly after the typing stops and only fills names it has no role
    // for yet - a role the user toggled is never overwritten.
    if (classifyTimer.current) clearTimeout(classifyTimer.current);
    classifyTimer.current = setTimeout(() => {
      classifyTimer.current = null;
      void classifyRoster(category, audience, comps, false);
    }, 1500);
  }

  /** The roster as the written cells depend on it (2026-10-24): the
   * head-to-head slot rivals (the at-most-ANGLE_SLOTS picks that ride
   * every cell key and the writer's rivals line) and the class angles.
   * A bench or adjacent toggle that moves neither leaves the cells as they
   * are - it used to read as stale and wipe the battery. */
  function rivalsKey(comps: string[], roles: RosterRoles | undefined, classes?: RosterClasses): string {
    return JSON.stringify([
      angleRivals(comps, roles),
      classAnglesOf(comps, roles, classes).map((c) => [c.classBrand, c.classPhrase]),
    ]);
  }

  const classifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The roster classifier's verdicts (/api/setup/roster); null on any
   * failure (fail-open: no roles = untyped). */
  async function fetchRoster(cat: string, aud: string, comps: string[]): Promise<RosterVerdict | null> {
    if (!cat.trim() || comps.length === 0) return null;
    const res = await fetch("/api/setup/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
      body: JSON.stringify({ brand, category: cat, audience: aud || undefined, competitors: comps }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    if (!res?.ok) return null;
    const data = await res.json().catch(() => null);
    const roster = data?.roster as RosterVerdict | undefined;
    return roster && !roster.failedOpen ? roster : null;
  }

  /** Type each competitor by who it sells to. fresh = replace every role
   * (a new estimate); otherwise only names without a role yet are filled.
   * Returns the roles and classes it lands (computed from `base`, the
   * values the caller holds), or null when the classifier failed open. */
  async function classifyRoster(
    cat: string, aud: string, comps: string[], fresh: boolean,
    base: { roles: RosterRoles | undefined; classes: RosterClasses | undefined } = { roles: rosterRoles, classes: rosterClasses }
  ): Promise<{ roles: RosterRoles; classes: RosterClasses | undefined } | null> {
    const roster = await fetchRoster(cat, aud, comps);
    if (!roster) return null;
    setRosterRoles((prev) => rolesAfterClassify(prev, roster, fresh));
    setRosterReasons((prev) => {
      const next = fresh ? {} : { ...prev };
      for (const v of roster.competitors) if ((fresh || !(v.name in next)) && v.h2hReason) next[v.name] = v.h2hReason;
      return next;
    });
    setRosterParents((prev) => {
      const next = fresh ? {} : { ...prev };
      for (const v of roster.competitors) if ((fresh || !(v.name in next)) && v.parent) next[v.name] = v.parent;
      return next;
    });
    if (roster.clientParent) setClientParent(roster.clientParent);
    setRosterNotes((prev) => {
      const next = fresh ? {} : { ...prev };
      for (const v of roster.competitors) if (fresh || !(v.name in next)) next[v.name] = v.note;
      return next;
    });
    setRosterClasses((prev) => classesAfterClassify(prev, roster, fresh));
    setClientSellsTo(roster.clientSellsTo);
    return {
      roles: rolesAfterClassify(base.roles, roster, fresh),
      classes: classesAfterClassify(base.classes, roster, fresh),
    };
  }

  /** The role pill - the human gate on the classifier's facts. Cycles
   * rival -> upstream -> adjacent -> rival; a brand coming back as a rival
   * lands on the bench (its head-to-head is the separate toggle). */
  function toggleRole(c: string) {
    setRosterRoles((prev) => {
      const r = rosterRoleOf(c, prev);
      const nextRole: RosterRole = r === "upstream" ? "adjacent" : r === "adjacent" ? "bench" : "upstream";
      return { ...materializePicks(prev), [c]: nextRole };
    });
  }

  /** A pre-decision-3 roster (no bench/adjacent entries) means "the first
   * ANGLE_SLOTS rivals in list order". Before the first explicit pick,
   * write that out as picks + bench so the toggle edits what the battery
   * actually uses. */
  function materializePicks(prev: RosterRoles | undefined): RosterRoles {
    const comps = allCompetitors();
    const roles: RosterRoles = { ...(prev ?? {}) };
    const hasPicks = comps.some((c) => { const r = rosterRoleOf(c, roles); return r === "bench" || r === "adjacent"; });
    if (hasPicks) return roles;
    const slots = new Set(angleRivals(comps, roles));
    for (const c of comps) {
      if (rosterRoleOf(c, roles) === "upstream") continue;
      roles[c] = slots.has(c) ? "same_seat" : "bench";
    }
    return roles;
  }

  /** The head-to-head toggle: at most ANGLE_SLOTS rivals hold a
   * Comparison + Alternatives cell; every rival stays measured. */
  function toggleH2H(c: string) {
    // Reads the current roles directly (not inside a setState updater) so
    // the note and the roles move together - updaters run on React's
    // schedule and must stay pure.
    const roles = materializePicks(rosterRoles);
    if (rosterRoleOf(c, roles) === "same_seat") {
      setRosterRoles({ ...roles, [c]: "bench" });
      setH2hNote(null);
      return;
    }
    const picked = allCompetitors().filter((x) => rosterRoleOf(x, roles) === "same_seat").length;
    if (picked >= ANGLE_SLOTS) {
      setH2hNote(`${ANGLE_SLOTS} is the max - turn one off first.`);
      return;
    }
    setRosterRoles({ ...roles, [c]: "same_seat" });
    setH2hNote(null);
  }

  async function estimate() {
    setSuggesting(true);
    setError(null);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
      body: JSON.stringify({ brand, skipBattery: true }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    if (!res) {
      setSuggesting(false);
      setError("estimation timed out - fill in the details manually");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSuggesting(false);
      setError((data.error ?? "estimation failed") + " - fill in the details manually");
      return;
    }
    // Warm the ~45s market read while the roster is typed and the user
    // reviews the form - by confirm time it is cached.
    gridApi.warmRead(data.profile.category, data.profile.audience);
    // The market read lands WHOLE (Tyler 2026-10-04): the roster typing
    // (head-to-head picks, same-parent tags, roles) finishes before the
    // form shows, so nobody moves on with untyped pills and the list-order
    // fallback. classifyRoster fails open; the form still lands then.
    await classifyRoster(data.profile.category, data.profile.audience, data.profile.competitors, true);
    setCategory(data.profile.category);
    setCompetitors(data.profile.competitors);
    setCompDraft("");
    setAudience(data.profile.audience);
    setSuggesting(false);
  }

  /* ------------------------------ persistence ----------------------------- */

  /** Saves run strictly in call order (2026-10-24): a close-time save of
   * the grid in hand can never land after the save a finishing write makes
   * later, and create's draft DELETE waits behind every queued save. */
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  /** Set once the tracker exists: no draft save may land after create
   * deleted the draft (it would resurrect it as a chip). */
  const created = useRef(false);

  function persist(
    at: StepKey,
    gIn?: GridState | null,
    p: DraftPrompt[] | null = prompts,
    mp: string[] = machinePrompts,
    rp: string[] = reviewedPrompts,
    inFlight: number | null = cellsInFlight,
    marks: { phrasings?: number | null; read?: number | null } = {}
  ) {
    const g = gIn === undefined ? gridRef.current : gIn;
    const phrasingsMark = marks.phrasings === undefined ? phrasingsInFlight : marks.phrasings;
    const readMark = marks.read === undefined ? readInFlight : marks.read;
    if (demo || editProjectId || created.current) return Promise.resolve();
    const wizard: WizardDraft = {
      mode, step: at, studyName, grid: g, engineSet,
      machinePrompts: mp,
      reviewedPrompts: rp,
      // The in-flight marker only ever rides a save AT the coverage step:
      // landing on prompts (the write landed) drops it by construction.
      ...(at === "stages" && inFlight ? { cellsInFlight: inFlight } : {}),
      // Paraphrase marker: only while NO paraphrase exists yet, so the save
      // that lands the written set drops it by construction (same step).
      ...(at === "prompts" && phrasingsMark && !(g?.cells ?? []).some((c) => c.phrasings.some((ph) => ph.text.trim())) ? { phrasingsInFlight: phrasingsMark } : {}),
      // Read marker: only while no grid exists (the read lands a grid).
      ...(at === "market" && readMark && !g ? { readInFlight: readMark } : {}),
      ...(rosterRoles ? { rosterRoles, rosterNotes } : {}),
      ...(rosterClasses ? { rosterClasses } : {}),
      ...(clientSellsTo ? { clientSellsTo } : {}),
      ...(Object.keys(rosterReasons).length > 0 ? { rosterReasons } : {}),
      ...(Object.keys(rosterParents).length > 0 ? { rosterParents } : {}),
      ...(clientParent ? { clientParent } : {}),
    };
    // The body is fixed NOW (the state at the call); only the send queues.
    const body = JSON.stringify({
      id: draftId ?? undefined,
      brand,
      category,
      audience: audience || undefined,
      competitors: allCompetitors(),
      prompts: p,
      wizard,
    });
    pendingSaves.current += 1;
    setSaving(true);
    const send = async () => {
      if (created.current) return;
      // Bounded, never-throwing: a stalled save must not wedge the
      // "Saving" label or hang requestClose - the next step transition
      // saves again.
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null);
      if (res?.ok) {
        // The response carries a draft SUMMARY (wizard = mode/step/name
        // only) - only its id is read here; the host merges the summary.
        const data = await res.json().catch(() => ({}));
        if (data.draft?.id) setDraftId(data.draft.id);
        onDraftsChanged(data.draft ?? undefined);
      }
    };
    const done = saveChain.current.then(send, send).finally(() => {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) setSaving(false);
    });
    saveChain.current = done.catch(() => {});
    return done;
  }

  function goTo(
    k: StepKey,
    gIn?: GridState | null,
    p: DraftPrompt[] | null = prompts,
    mp: string[] = machinePrompts,
    rp: string[] = reviewedPrompts
  ) {
    const g = gIn === undefined ? gridRef.current : gIn;
    setReadDelta(null);
    if (k !== "prompts") setPromptsNotice(null);
    setStep(k);
    setReached((r) => Math.max(r, steps.findIndex((s) => s.key === k)));
    setError(null);
    void persist(k, g, p, mp, rp);
    // Landing on a gate warms the NEXT gate's work in the background -
    // pools for scenario draws, the worry pool while the scenarios are
    // reviewed, cells while the map is reviewed, paraphrases while the
    // seeds are reviewed. Silent; failures cost nothing.
    if (k === "scenarios") gridApi.warmWorries(g);
    if (k === "worries") void landOnWorries(g);
    if (k === "stages") { gridApi.warmCells(g); void gridApi.loadValueLines(g); }
    if (k === "prompts" && mode === "grid") gridApi.warmPhrasings(g);
  }


  /** Close is OPTIMISTIC (Tyler, 2026-10-05): the modal goes on the click
   * and the draft save completes behind it - the x used to wait on the
   * save, which on a slow store read as an ignored click. persist never
   * throws and the drafts list revalidates on its own. */
  function requestClose() {
    // Hidden while create runs (the host shows the tracker's card instead):
    // a close from there must not save a draft create is about to delete.
    if (submitting || created.current) return;
    const dirty = step !== "market" || prompts !== null || gridRef.current !== null;
    // Saved even mid-work (2026-10-24): the save queues ahead of whatever
    // the finishing write saves, so the newer result still lands last - and
    // a quality check that ends flagged (no save of its own) no longer
    // loses every edit since the last step change.
    if (dirty) {
      const done = persist(step, gridRef.current);
      onCloseSave?.(draftId, done);
    }
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
      // Hidden while create runs (the host has swapped the modal for the
      // tracker's card): Escape must not reach a modal nobody can see.
      if (submitting) return;
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
      // Closing mid-write is safe: nothing aborts on unmount, and the
      // completion handler persists the finished result to the draft.
      requestClose();
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
    // A name still waiting on its classify (the 1.5s timer, or one folded
    // in from the text field just now) is typed BEFORE the staleness key:
    // its role decides whether it takes a head-to-head slot, and a classify
    // landing after the cells were written would leave them on old picks.
    const pending = classifyTimer.current !== null || compDraft.trim() !== "";
    if (classifyTimer.current) {
      clearTimeout(classifyTimer.current);
      classifyTimer.current = null;
    }
    let roles = rosterRoles;
    let classes = rosterClasses;
    const untyped = comps.filter((c) => !rosterRoles || !(c in rosterRoles));
    if (pending && untyped.length > 0) {
      setBusy("Checking your competitors…");
      const typed = await classifyRoster(category, audience, comps, false, { roles, classes });
      setBusy(null);
      if (typed) {
        roles = typed.roles;
        classes = typed.classes;
      }
    }
    const readChanged = servedRead !== readKey(category, audience);
    const rivalsChanged = servedRivals !== rivalsKey(comps, roles, classes);
    setServedRead(readKey(category, audience));
    setServedRivals(rivalsKey(comps, roles, classes));
    const g0 = gridRef.current;
    if (mode === "grid") {
      if (!readChanged && g0) {
        if (!rivalsChanged) {
          goTo(g0.step === "compose" ? "scenarios" : "prompts");
          return;
        }
        // Rivals changed: the scenarios and the mask hold - only the
        // head-to-head cells go stale (they name the slot rivals). Keep the
        // table AND every cell, back to the coverage map with the new rival
        // count: the next cells write keeps each cell whose engine text is
        // unchanged, custom questions included (mergeWrittenCells).
        const kept = updateGrid((g) => (g ? { ...g, step: "compose" } : g));
        void enterCoverage(kept);
        return;
      }
      // A new market: nothing of the old grid applies. Cleared here (the
      // ref too, synchronously), so the fresh compose can't fall back to
      // the old market's advice.
      updateGrid(null);
      const started = readInFlight ?? nowStamp();
      setReadInFlight(started);
      void persist("market", null, prompts, machinePrompts, reviewedPrompts, cellsInFlight, { read: started });
      const next = await gridApi.compose();
      setReadInFlight(null);
      if (next) goTo("scenarios", next);
      else void persist("market", null, prompts, machinePrompts, reviewedPrompts, cellsInFlight, { read: null });
      return;
    }
    if (!readChanged && !rivalsChanged && prompts) {
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
      headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
      body: JSON.stringify({
        name: studyName.trim() || undefined,
        brand, category,
        audience: audience || undefined,
        competitors: allCompetitors(),
        force,
      }),
      signal: AbortSignal.timeout(180_000),
    }).catch(() => null);
    setBusy(null);
    if (!res) {
      setError("that took too long - try again");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "prompt generation failed");
      return;
    }
    setPrompts(data.prompts);
    const machine = (data.prompts as DraftPrompt[]).map((p) => p.text);
    setMachinePrompts(machine);
    setReviewedPrompts([]);
    setEditing(false);
    goTo("prompts", grid, data.prompts, machine, []);
  }

  /** Confirm the scenarios gate: user-written or user-edited rows get one
   * quality check first; anything flagged goes to the review overlay with
   * a suggested edit. Passed fingerprints persist with the draft so
   * unchanged rows are never rechecked; a declined suggestion ("keep
   * mine") is deliberately NOT recorded, so it pops up again on the next
   * confirm. A reviewer failure never blocks the gate. */
  async function confirmScenarios() {
    const g = gridRef.current;
    if (!g) return;
    // The footer button keeps focus in the field (see onMouseDown), so a
    // pending label-blur recompose never ran. If any active label is
    // missing from the composed mask, recompose first - pure code, fast.
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
      await recomposing;
      setBusy(null);
      goTo("worries", gridRef.current);
      return;
    }
    setBusy("Checking your scenarios…");
    setError(null);
    // Bounded and null-safe: a stalled or aborted check must never strand
    // the gate in busy - the reviewer is a safety net, not a gatekeeper.
    const resP = fetch("/api/setup/grid/scenario_review", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    const [, res] = await Promise.all([recomposing, resP]);
    setBusy(null);
    if (!res || !res.ok) {
      goTo("worries", gridRef.current);
      return;
    }
    const data = await res.json().catch(() => ({}));
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
    // Only what the check produced lands, on the grid as it is NOW: an
    // edit made while "Checking your scenarios…" ran stays (its new wording
    // simply has no passed fingerprint and is checked next confirm).
    if (passed.length > 0) {
      updateGrid((cur) => (cur ? { ...cur, reviewedScenarios: [...(cur.reviewedScenarios ?? []), ...passed] } : cur));
    }
    if (flagged.length === 0) goTo("worries", gridRef.current);
    else setReview(flagged);
  }

  /** Apply the review choices, recompose if any wording changed, advance.
   * An accepted suggestion becomes the row's `original`, so it won't be
   * rechecked; a kept-mine row is left as-is on purpose - it gets flagged
   * again the next time the gate is confirmed. */
  async function resolveReview() {
    const g = gridRef.current;
    if (!g || !review) return;
    const byIndex = new Map(review.map((it) => [it.index, it]));
    let changed = false;
    const renames: [string, string][] = [];
    const rows = scenarioRows(g).map((r, i) => {
      const it = byIndex.get(i);
      // The suggestion replaces the wording it was offered for - a row
      // edited since keeps the user's edit.
      if (!it || it.choice !== "suggestion") return r;
      if (r.label !== it.current.label || r.description !== it.current.description) return r;
      changed = true;
      if (it.suggestion.label.trim() !== r.label.trim()) renames.push([r.label, it.suggestion.label]);
      return {
        ...r,
        label: it.suggestion.label,
        description: it.suggestion.description,
        circumstance: undefined,
        original: { ...it.suggestion },
      };
    });
    // Log what the user chose - visibility only, fire and forget.
    void fetch("/api/setup/grid/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
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
      // Cells and room-keyed entries follow the renamed rooms; the
      // recompose then carries the whole battery.
      updateGrid((cur) => (cur ? rebindRooms(cur, renames) : cur));
      const next = await gridApi.compose({ base: g.moderators, rows });
      if (next) goTo("worries", next);
    } else {
      goTo("worries");
    }
  }

  /** The last payload each warm sent - blur fires on every field exit,
   * but an unchanged payload has nothing new to warm. */
  const lastWarm = useRef<{ scenario: string | null; cell: string | null }>({
    scenario: null,
    cell: null,
  });

  /** Silent warm of the confirm-time scenario check: same request the
   * confirm will make, fired on field blur, cached server-side. */
  function warmScenarioReview() {
    if (!grid) return;
    const { authored, body } = reviewRequest(grid, category, audience);
    if (authored.length === 0) return;
    const payload = JSON.stringify(body);
    if (lastWarm.current.scenario === payload) return;
    lastWarm.current.scenario = payload;
    void fetch("/api/setup/grid/scenario_review", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  /** A base-read edit: recompose, then narrate what actually changed - a
   * silent recompose reads as broken even when it works. */
  async function recomposeBase(base: GridState["moderators"], rows: ScenarioRow[]) {
    const prev = gridRef.current;
    const next = await gridApi.compose({ base, rows });
    if (!next || !prev) return;
    const label = (g: GridState, key: string) =>
      g.stages.find((s) => s.key === key)?.label ?? key;
    const prevKept = new Set(prev.keptStages);
    const nextKept = new Set(next.keptStages);
    const added = next.keptStages.filter((k) => !prevKept.has(k)).map((k) => label(next, k));
    const removed = prev.keptStages.filter((k) => !nextKept.has(k)).map((k) => label(prev, k));
    const prevCells = gridCellCount(prev, slotCount, classCount);
    const nextCells = gridCellCount(next, slotCount, classCount);
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
    // Mark the write in flight on the draft BEFORE the call, so a close
    // mid-write reopens on the progress view (the server keeps generating).
    const started = cellsInFlight ?? nowStamp();
    setCellsInFlight(started);
    void persist("stages", gridRef.current, prompts, machinePrompts, reviewedPrompts, started);
    const next = await gridApi.writeCells();
    setCellsInFlight(null);
    if (next) goTo("prompts", next);
    else void persist("stages", gridRef.current, prompts, machinePrompts, reviewedPrompts, null);
  }

  // Resumed onto an in-flight write: straight to the progress view and the
  // (coalesced, cache-first) cells request, instead of the coverage map.
  useEffect(() => {
    if (!resumeWrite || resumedRef.current) return;
    resumedRef.current = true;
    void writeCells();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once on resume
  }, [resumeWrite]);


  async function writePhrasings(force = false, onlyMissing = false, from?: GridState) {
    const src = from ?? gridRef.current;
    const live = (src?.cells ?? []).filter((c) => c.text.trim());
    const missingBefore = live.filter((c) => !c.phrasings.some((p) => p.text.trim())).length;
    // A full first write is marked in flight on the draft (resume on reopen).
    const fullWrite = !onlyMissing && missingBefore === live.length;
    const started = fullWrite ? (phrasingsInFlight ?? nowStamp()) : null;
    if (fullWrite) {
      setPhrasingsInFlight(started);
      void persist("prompts", src, prompts, machinePrompts, reviewedPrompts, cellsInFlight, { phrasings: started });
    }
    let next = await gridApi.writePhrasings(force, onlyMissing, from);
    if (fullWrite) setPhrasingsInFlight(null);
    // Self-heal before serving (2026-09-28): a cell whose paraphrase set
    // came back empty or short gets ONE automatic top-up pass - the same
    // courtesy the demo path always had. A cell that starves through the
    // retry too still renders with its gap and the footer's
    // "write the missing prompts" fallback.
    if (next && !onlyMissing) {
      const gap = next.cells.some(
        (c) =>
          c.text.trim() &&
          1 + c.phrasings.filter((p) => p.text.trim()).length < phrasingTarget(c.stage)
      );
      if (gap) next = (await gridApi.topUpPhrasings(next)) ?? next;
    }
    if (!next && fullWrite) void persist("prompts", gridRef.current, prompts, machinePrompts, reviewedPrompts, cellsInFlight, { phrasings: null });
    if (next) {
      goTo("prompts", next);
      // A partial write means a confirm re-landed here: say why, or the
      // gate looks stuck (a full first write is the expected flow and
      // needs no note).
      if (missingBefore > 0 && missingBefore < live.length) {
        setPromptsNotice(
          `Wrote prompts for ${missingBefore} new question${missingBefore === 1 ? "" : "s"} - review them below, then confirm again.`
        );
      }
    }
  }

  const resumedPhrasingsRef = useRef(false);
  useEffect(() => {
    if (!resumePhrasings || resumedPhrasingsRef.current) return;
    resumedPhrasingsRef.current = true;
    void writePhrasings(false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once on resume
  }, [resumePhrasings]);
  const resumedReadRef = useRef(false);
  useEffect(() => {
    if (!resumeRead || resumedReadRef.current) return;
    resumedReadRef.current = true;
    void confirmMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once on resume
  }, [resumeRead]);

  /** What the Prompts footer does once the battery is clean - recomputed
   * from the state at hand, so the review can run before ANY of the three
   * confirms without each carrying its own continuation. */
  function proceedPrompts(g: GridState) {
    const live = g.cells.filter((c) => c.text.trim());
    const written = g.step === "phrasings";
    const missing = written && live.some((c) => !c.phrasings.some((p) => p.text.trim()));
    // Demo guests never see a short set: the write chains straight into a
    // top-up, and the hop to engines tops up first when anything is short.
    const short = (cells: GridState["cells"]) =>
      cells.some(
        (c) =>
          c.text.trim() &&
          c.phrasings.some((p) => p.text.trim()) &&
          1 + c.phrasings.filter((p) => p.text.trim()).length < phrasingTarget(c.stage)
      );
    if (!written) {
      if (demo) {
        void (async () => {
          const w = await gridApi.writePhrasings(false, false, g);
          const t = await gridApi.topUpPhrasings(w ?? g);
          goTo("prompts", t ?? w ?? g);
        })();
      } else {
        void writePhrasings(false, false, g);
      }
    } else if (missing) {
      void fillParaphrases(g);
    } else if (demo && short(g.cells)) {
      void (async () => {
        const t = await gridApi.topUpPhrasings(g);
        goTo("engines", t ?? g);
      })();
    } else {
      goTo("engines", g);
    }
  }

  /** The missing-fill also tops up below-quota sets: empty cells get full
   * sets, short cells get just their shortfall - nothing kept is touched. */
  async function fillParaphrases(g: GridState) {
    const live = g.cells.filter((c) => c.text.trim());
    const missingBefore = live.filter((c) => !c.phrasings.some((p) => p.text.trim())).length;
    const filled = await gridApi.writePhrasings(false, true, g);
    const topped = await gridApi.topUpPhrasings(filled ?? g);
    goTo("prompts", topped ?? filled ?? g);
    if (missingBefore > 0) {
      setPromptsNotice(
        `Wrote prompts for ${missingBefore} new question${missingBefore === 1 ? "" : "s"} - review them below, then confirm again.`
      );
    }
  }

  /** The standalone top-up, for short-but-nonzero sets (they never block
   * the gate, so they need their own affordance). */
  async function topUpShortSets() {
    const topped = await gridApi.topUpPhrasings();
    if (topped) goTo("prompts", topped);
  }

  /** Confirm the Prompts gate: edited prompts get one quality check first
   * (same contract as scenarios - passed fingerprints persist, "keep
   * mine" is never recorded, a reviewer failure never blocks). */
  async function confirmPrompts() {
    const g = gridRef.current;
    if (!g) return;
    setPromptsNotice(null);
    const { authored, bodies } = cellReviewRequest(g, brand, allCompetitors(), category, audience, rosterRoles);
    if (authored.length === 0) {
      proceedPrompts(g);
      return;
    }
    setBusy("Checking your prompts…");
    setError(null);
    // One request per chunk of 24, in order. A failed chunk leaves its
    // prompts unjudged - neither passed nor flagged, so the next confirm
    // checks them; a check that fails outright never blocks the gate.
    type Verdict = { ok?: boolean; flags?: CellReviewItem["flags"]; reason?: string; suggestion?: string };
    const verdicts: (Verdict | "unjudged" | undefined)[] = [];
    const specs: (GridCellUi["spec"] | undefined)[] = [];
    let anyJudged = false;
    for (const body of bodies) {
      const res = await fetch("/api/setup/grid/cell_review", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      }).catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      for (let k = 0; k < body.candidates.length; k++) {
        verdicts.push(data ? data.verdicts?.[k] : "unjudged");
        specs.push(data ? data.specs?.[k] ?? undefined : undefined);
      }
      if (data) anyJudged = true;
    }
    setBusy(null);
    if (!anyJudged) {
      proceedPrompts(gridRef.current ?? g);
      return;
    }
    const flagged: CellReviewItem[] = [];
    const passed: string[] = [];
    authored.forEach(({ c, i, phr, text }, k) => {
      const v = verdicts[k];
      if (v === "unjudged") return;
      if (!v || v.ok) {
        passed.push(cellFp(c, text));
      } else {
        const stage = g.stages.find((s) => s.key === c.stage);
        const sug = (v.suggestion || "").trim();
        flagged.push({
          index: i,
          uid: c.uid,
          phr,
          meta:
            `${stage?.label ?? c.stage} · ${cellSubMeta(c)}` +
            (phr != null ? ` · prompt ${phr + 2}` : ""),
          current: text,
          flags: Array.isArray(v.flags) && v.flags.length > 0 ? v.flags : ["unclear"],
          reason: v.reason || "This one may not ask what its cell measures.",
          // A missing suggestion, or one identical to the flagged text
          // (the mechanical/design flags ride on the model's "ok" echo),
          // is no repair: offer nothing and default to "mine" so one
          // click can't turn the violation into the machine baseline.
          suggestion: sug === text.trim() ? "" : sug,
          choice: sug === "" || sug === text.trim() ? "mine" : "suggestion",
        });
      }
    });
    // A reviewed seed edit's re-derived spec lands on its cell whatever the
    // verdict - the spec records the design of the text the cell now holds.
    // By uid, and only while the cell still holds the reviewed text: an
    // edit made during the check keeps its own (unchecked) state.
    const specByUid = new Map<string, { spec: GridCellUi["spec"]; text: string }>();
    authored.forEach(({ c, phr, text }, k) => {
      const sp = specs[k];
      if (phr == null && sp && c.uid) specByUid.set(c.uid, { spec: sp, text });
    });
    if (passed.length > 0 || specByUid.size > 0) {
      updateGrid((cur) =>
        cur
          ? {
              ...cur,
              reviewedCells: [...(cur.reviewedCells ?? []), ...passed],
              cells: cur.cells.map((c) => {
                const s = c.uid ? specByUid.get(c.uid) : undefined;
                return s && c.text.trim() === s.text.trim() ? { ...c, spec: s.spec } : c;
              }),
            }
          : cur
      );
    }
    const next = gridRef.current ?? g;
    if (flagged.length === 0) proceedPrompts(next);
    else setCellReview(flagged);
  }

  /** Apply the prompt-review choices and continue. An accepted suggestion
   * becomes the cell's machine baseline (`original` - the engine seed is
   * untouched) and clears its paraphrases, so the missing-fill regenerates
   * them for the new wording; a kept-mine cell is left as-is on purpose -
   * it gets flagged again next confirm. */
  function resolveCellReview() {
    if (!cellReview) return;
    // Paraphrase fixes land before their cell's seed fix: a seed change
    // banks the (now corrected) set under the old wording.
    const ordered = [...cellReview].sort((a, b) => (a.phr == null ? 1 : 0) - (b.phr == null ? 1 : 0));
    const next = updateGrid((g) => {
      if (!g) return g;
      const cells = [...g.cells];
      for (const it of ordered) {
        if (it.choice !== "suggestion" || !it.suggestion.trim()) continue;
        const at = it.uid ? cells.findIndex((q) => q.uid === it.uid) : it.index;
        const c = cells[at];
        if (!c) continue;
        if (it.phr == null) {
          // Only over the wording it was offered for.
          if (c.text.trim() !== it.current.trim()) continue;
          // The old wording's set is banked, not thrown away - cycling back
          // to it later restores its paraphrases for free.
          cells[at] = {
            ...c, text: it.suggestion, original: it.suggestion, ...swapPhrasings(c, it.suggestion),
            spec: c.spec ? deriveCheckSpec({ ...c, text: it.suggestion }, brand, sameSeatOf(allCompetitors(), rosterRoles), category) : c.spec,
          };
        } else {
          if ((c.phrasings[it.phr]?.text ?? "").trim() !== it.current.trim()) continue;
          cells[at] = {
            ...c,
            phrasings: c.phrasings.map((ph, m) =>
              m === it.phr ? { ...ph, text: it.suggestion, original: it.suggestion } : ph
            ),
          };
        }
      }
      return { ...g, cells };
    });
    // Log what the user chose - visibility only, fire and forget.
    void fetch("/api/setup/grid/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
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
    if (next) proceedPrompts(next);
  }

  /** Classic-mode confirm: user-written prompts get the same quality
   * check under the open brand rule (the classic battery has no per-cell
   * brand design) - drift and incoherence still get caught. */
  async function confirmClassicPrompts() {
    if (!prompts) return;
    const machine = new Set(machinePrompts.map((t) => t.trim()));
    const done = new Set(reviewedPrompts);
    const fpOf = (q: DraftPrompt) => `${q.theme}|${q.text.trim()}`;
    const authored = prompts
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => q.text.trim() && !machine.has(q.text.trim()) && !done.has(fpOf(q)))
      .slice(0, 24);
    if (authored.length === 0) {
      goTo("engines");
      return;
    }
    setBusy("Checking your prompts…");
    setError(null);
    const res = await fetch("/api/setup/grid/cell_review", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
      body: JSON.stringify({
        brand,
        category,
        competitors: allCompetitors(),
        rosterRoles,
        audience: audience || undefined,
        candidates: authored.map(({ q }) => ({
          text: q.text,
          original: null,
          stage: q.theme.replace("_", " "),
          stageKey: q.theme,
          hint: THEME_HINTS[q.theme],
          tag: null,
          situation: null,
          situationDescription: null,
          angle: "open",
          mode: null,
          concern: null,
          valueLine: null,
        })),
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      goTo("engines");
      return;
    }
    const data = await res.json().catch(() => ({}));
    const flagged: CellReviewItem[] = [];
    const passed: string[] = [];
    authored.forEach(({ q, i }, k) => {
      const v = data.verdicts?.[k];
      if (!v || v.ok) {
        passed.push(fpOf(q));
      } else {
        const sug = (v.suggestion || "").trim();
        flagged.push({
          index: i,
          meta: q.theme.replace("_", " "),
          current: q.text,
          flags: Array.isArray(v.flags) && v.flags.length > 0 ? v.flags : ["unclear"],
          reason: v.reason || "This one may not ask what its theme covers.",
          // Same echo rule as the grid path: an echoed suggestion is no
          // repair, so nothing is offered and "mine" stays under review.
          suggestion: sug === q.text.trim() ? "" : sug,
          choice: sug === "" || sug === q.text.trim() ? "mine" : "suggestion",
        });
      }
    });
    const nextReviewed = [...reviewedPrompts, ...passed];
    if (passed.length > 0) setReviewedPrompts(nextReviewed);
    if (flagged.length === 0) goTo("engines", grid, prompts, machinePrompts, nextReviewed);
    else setCellReview(flagged);
  }

  /** Apply the classic review choices; accepted suggestions join the
   * machine baseline, keep-mine re-flags next confirm. */
  function resolveClassicReview() {
    if (!prompts || !cellReview) return;
    const byIndex = new Map(
      cellReview
        .filter((it) => it.choice === "suggestion" && it.suggestion.trim())
        .map((it) => [it.index, it])
    );
    const next = prompts.map((q, i) => {
      const it = byIndex.get(i);
      return it ? { ...q, text: it.suggestion } : q;
    });
    const nextMachine = [
      ...machinePrompts,
      ...[...byIndex.values()].map((it) => it.suggestion),
    ];
    setMachinePrompts(nextMachine);
    void fetch("/api/setup/grid/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
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
    setPrompts(next);
    goTo("engines", grid, next, nextMachine, reviewedPrompts);
  }

  /** Silent warm of the confirm-time prompt check: same request the
   * confirm will make, fired on field blur, cached server-side. */
  function warmCellReview() {
    const g = gridRef.current;
    if (!g) return;
    const { authored, bodies } = cellReviewRequest(g, brand, allCompetitors(), category, audience, rosterRoles);
    if (authored.length === 0) return;
    const payload = JSON.stringify(bodies);
    if (lastWarm.current.cell === payload) return;
    lastWarm.current.cell = payload;
    for (const body of bodies) {
      void fetch("/api/setup/grid/cell_review", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(draftId ? { "x-setup-id": draftId } : {}) },
        body: JSON.stringify(body),
      }).catch(() => {});
    }
  }

  async function create() {
    setSubmitting(true);
    setError(null);
    const usingGrid = mode === "grid";
    // Edit-setup replaces the zero-run tracker's instrument in place.
    if (editProjectId && usingGrid) {
      const res = await fetch(`/api/projects/${editProjectId}/setup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          name: studyName.trim() || undefined,
          category,
          audience: audience || undefined,
          competitors: allCompetitors(),
          rosterRoles,
          engines: engineSet,
          grid: {
            moderators: grid!.moderators,
            // Recommended-vs-decided: the worry recommender's training data.
            ...(grid!.worries && grid!.worryPool
              ? {
                  worryDecision: {
                    recommended: recommendedWorryPairs(grid!.worryPool),
                    decided: grid!.worries,
                  },
                }
              : {}),
            journeys: Object.fromEntries(
              grid!.scenarios.map((sc) => [sc.label, sc.journey])
            ),
            setupDecision: buildSetupDecision(grid!),
            cells: grid!.cells
              .filter((c) => c.text.trim())
              .map((c) => ({
                stage: c.stage, layer: c.layer, situation: c.situation, angle: c.angle,
                mode: c.mode ?? null, qtype: c.qtype ?? null, concern: c.concern ?? null, text: c.text,
                phrasings: c.phrasings
                  .filter((p) => p.text.trim())
                  .map((p) => ({ text: p.text, asker: p.asker || undefined })),
              })),
          },
        }),
      }).catch(() => null);
      setSubmitting(false);
      if (!res) { setError("that took too long - try again"); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // 409: the previous save of this setup is still being written -
        // the server's message already says to retry.
        setError(data.error ?? (res.status === 409 ? "this tracker's setup is still being saved - try again in a moment" : "something went wrong"));
        return;
      }
      onCreated(editProjectId);
      return;
    }
    onCreating?.({ name: studyName.trim() || brand, promptCount });
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        name: studyName.trim() || undefined,
        setupId: draftId ?? undefined,
        brand, category,
        audience: audience || undefined,
        competitors: allCompetitors(),
        rosterRoles,
        engines: engineSet,
        ...(usingGrid
          ? {
              grid: {
                moderators: grid!.moderators,
                // Recommended-vs-decided: the worry recommender's training
                // data - same shape as the edit-setup save.
                ...(grid!.worries && grid!.worryPool
                  ? {
                      worryDecision: {
                        recommended: recommendedWorryPairs(grid!.worryPool),
                        decided: grid!.worries,
                      },
                    }
                  : {}),
                journeys: Object.fromEntries(
                  grid!.scenarios.map((sc) => [sc.label, sc.journey])
                ),
                setupDecision: buildSetupDecision(grid!),
                cells: grid!.cells
                  .filter((c) => c.text.trim())
                  .map((c) => ({
                    stage: c.stage, layer: c.layer, situation: c.situation, angle: c.angle,
                    mode: c.mode ?? null, qtype: c.qtype ?? null, concern: c.concern ?? null, text: c.text,
                    phrasings: c.phrasings
                      .filter((p) => p.text.trim())
                      .map((p) => ({ text: p.text, asker: p.asker || undefined })),
                  })),
              },
            }
          : { prompts: prompts!.filter((p) => p.text.trim()) }),
      }),
    }).catch(() => null);
    if (!res) {
      setSubmitting(false);
      onCreating?.(null);
      setError("that took too long - check your trackers before retrying (it may have been created)");
      return;
    }
    const data = await res.json().catch(() => ({}));
    // Any 2xx carrying a project is the tracker: a re-submitted setup id
    // that already became one comes back 200 with the existing project.
    if (!res.ok || !data.project?.id) {
      setSubmitting(false);
      onCreating?.(null);
      // 409: another create of this setup is in flight - retryable, and the
      // server's message says so.
      setError(data.error ?? (res.status === 409 ? "a tracker is already being created - try again in a moment" : "something went wrong"));
      return;
    }
    // No draft save may land from here on (a queued one would resurrect
    // the draft after the DELETE below).
    created.current = true;
    // The tracker exists: hand over to its dashboard NOW, on its "Setting
    // up" phase. The run launch (engine checks + batch submission, several
    // seconds) and the draft cleanup continue in the background - client
    // navigation keeps them alive. Awaiting them here left the button
    // reverted to "Create tracker & run" for ~5s after a successful create.
    if (draftId) {
      // Best effort - a stale draft chip beats a hung create. Queued behind
      // any save still in flight, so no save lands after the delete.
      const id = draftId;
      void saveChain.current
        .then(() => fetch(`/api/drafts/${id}`, { method: "DELETE", signal: AbortSignal.timeout(15_000) }))
        .catch(() => {})
        .finally(() => onDraftsChanged());
    }
    const panel: string[] = data.project.engine_set?.length ? data.project.engine_set : engineSet;
    void fetch(`/api/projects/${data.project.id}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: panel[0] ?? "gpt-6-luna",
        ...(panel.length > 0 ? { models: panel } : {}),
        // The Landscape samples by paraphrase, not by repeating a wording.
        repeats: usingGrid ? 1 : FIRST_RUN_REPEATS,
      }),
    }).catch(() => {
      // The tracker exists either way; the dashboard's Run control reports.
    });
    onCreated(data.project.id, { starting: true });
  }

  /* --------------------------------- counts -------------------------------- */

  // Upstream brands hold no cells and are free vocabulary: the custom-cell
  // rival picker and the branded/blind pill read same-seat only. Memoized:
  // a stable list lets the Prompts gate cache its branded/blind reads
  // instead of recomputing them for every cell on every keystroke.
  const rosterNow = compDraft.trim().replace(/,+$/, "");
  const brandNames = useMemo(() => {
    const comps = [...new Set(rosterNow ? [...competitors, rosterNow] : competitors)].slice(0, 12);
    return [brand, ...sameSeatOf(comps, rosterRoles)];
  }, [brand, competitors, rosterNow, rosterRoles]);
  /** What the cells write plans per roster (mirrors the engine): the
   * head-to-head slot rivals and the class-angle cells. */
  const slotCount = angleRivals(allCompetitors(), rosterRoles).length;
  const classCount = classAnglesOf(allCompetitors(), rosterRoles, rosterClasses).length;
  const promptCount =
    mode === "grid" ? gridPromptCount(grid) : (prompts ?? []).filter((p) => p.text.trim()).length;
  const passes = mode === "grid" ? 1 : FIRST_RUN_REPEATS;
  const answers = promptCount * passes * (engineSet.length || 1);
  const stepIndex = steps.findIndex((s) => s.key === step);
  /** Net additions over the composed grid - deleting ANY question frees
   * a slot, so a swap (delete composed, add custom) costs nothing. */
  const customUsed = grid
    ? Math.max(0, grid.cells.length - (grid.baselineCellCount ?? grid.cells.length))
    : 0;
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
  // The footer's action is named, not a closure: the handlers read the
  // live grid (a ref), and a ref-reading function held in a render value
  // trips the compiler's refs rule. onFooterClick dispatches.
  type FooterRun = "market" | "scenarios" | "worries" | "stages" | "prompts" | "classic" | "demoClose" | "demoFinish" | "create";
  let footerAction: { label: string; run: FooterRun; disabled: boolean } | null = null;
  if (step === "market") {
    footerLeft = suggesting ? "Estimating your market…" : "";
    footerAction = {
      label: busy ?? "This is my market",
      run: "market",
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
      run: "scenarios",
      disabled:
        busy !== null || active === 0 || active > scenarioCap ||
        grid.scenarios.some((s) => !s.label.trim()),
    };
  } else if (step === "worries" && grid) {
    const picked = grid.worries?.length ?? 0;
    const planCount = grid.worryPool ? recommendedWorryPairs(grid.worryPool).length : 0;
    footerLeft = grid.worryPool
      ? worryCap === null
        ? `${picked} picked · ${planCount} recommended - worries collect on monthly waves`
        : `${picked} of ${worryCap} worries picked`
      : "";
    footerAction = {
      label: busy ?? "These are my worries",
      run: "worries",
      disabled:
        busy !== null || !grid.worryPool || picked === 0 ||
        (worryCap !== null && picked > worryCap),
    };
  } else if (step === "stages" && grid) {
    const plan = gridCellPlan(grid, slotCount, classCount);
    const cells = plan.reduce((n, s) => n + s.cells, 0);
    // Per stage at its own depth (Social validation fills to 5).
    const promptsPlanned = plan.reduce((n, s) => n + s.cells * phrasingTarget(s.stage), 0);
    footerLeft = `${grid.keptStages.length} stages · ${grid.scenarios.length} scenarios → ${cells} questions → ~${promptsPlanned} prompts`;
    footerAction = {
      label: busy ?? "This is my coverage",
      run: "stages",
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
      footerLeft = `${live.length} questions · ${live.length - branded} blind · ${branded} branded${
        customUsed > 0 ? ` · ${customUsed}/${customAllowance} custom` : ""
      }`;
      footerAction = {
        label: busy ?? "These are my questions - write the prompts",
        run: "prompts",
        disabled: busy !== null || live.length < 4,
      };
    } else if (missing) {
      footerLeft = `${promptCount} prompts across ${live.length} questions${
        customUsed > 0 ? ` · ${customUsed}/${customAllowance} custom` : ""
      } - some questions still need prompts`;
      footerAction = {
        label: busy ?? "These are my questions - write the missing prompts",
        run: "prompts",
        disabled: busy !== null || live.length < 4,
      };
    } else {
      footerLeft = `${promptCount} prompts across ${live.length} questions${
        customUsed > 0 ? ` · ${customUsed}/${customAllowance} custom` : ""
      }`;
      footerAction = {
        label: busy ?? "These are my prompts",
        run: "prompts",
        disabled: busy !== null || promptCount < 4,
      };
    }
  } else if (step === "prompts" && mode === "classic") {
    footerLeft = `${promptCount} prompts`;
    footerAction = {
      label: busy ?? "These are my prompts",
      run: "classic",
      disabled: busy !== null || promptCount < 4,
    };
  } else if (step === "engines") {
    footerLeft = `First run: ${promptCount.toLocaleString()} prompts × ${
      passes > 1 ? `${passes} repeats × ` : ""
    }${engineSet.length || 1} engine${engineSet.length === 1 ? "" : "s"} = ${answers.toLocaleString()} answers`;
    footerAction = demo
      ? demoDone
        ? { label: "Close demo", run: "demoClose", disabled: false }
        : {
            label: "Finish demo",
            run: "demoFinish",
            disabled: engineSet.length === 0 || promptCount < 4,
          }
      : editProjectId
      ? {
          label: submitting ? "Saving setup…" : "Save setup - no run starts",
          run: "create",
          disabled: submitting || engineSet.length === 0 || promptCount < 4,
        }
      : {
          label: submitting ? "Setting up…" : "Create tracker & run",
          run: "create",
          disabled: submitting || engineSet.length === 0 || promptCount < 4,
        };
  }

  function onFooterClick(run: FooterRun) {
    if (run === "market") void confirmMarket();
    else if (run === "scenarios") void confirmScenarios();
    else if (run === "worries") void enterCoverage();
    else if (run === "stages") void writeCells();
    else if (run === "prompts") void confirmPrompts();
    else if (run === "classic") void confirmClassicPrompts();
    else if (run === "demoClose") onClose();
    else if (run === "demoFinish") setDemoDone(true);
    else void create();
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
            !(s.key === "engines" && !promptsReady) &&
            // A recomposed grid has no written battery for its new mask: the
            // coverage map's confirm writes it (the carried cells there are
            // the merge's input, not a battery to show as current).
            !(s.key === "prompts" && mode === "grid" && grid?.step === "compose");
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
          onClick={() => requestClose()}
          disabled={submitting}
          className="text-left text-[13px] font-medium text-primary hover:opacity-80 disabled:opacity-50 px-2"
        >
          {demo || editProjectId ? "Close" : saving ? "Saving…" : busy !== null ? "Close" : "Save & close"}
        </button>
        <span className="px-2 text-[11px] text-ink-3">
          {demo
            ? "Demo - nothing is saved or created."
            : editProjectId
              ? "Edits apply only when you Save setup on the last step - closing discards them."
              : busy !== null
                ? "Safe to close - the writing continues and saves itself."
                : "Progress saves at every step."}
        </span>
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
            onClick={() => requestClose()}
            disabled={submitting}
            className="text-ink-3 hover:text-ink text-xl leading-none disabled:opacity-40"
          >
            ×
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {step === "market" && (
            suggesting ? (
              <div className="grid gap-4 py-16 text-center justify-items-center">
                <Spinner />
                <p className="text-sm font-medium">Estimating your market…</p>
                <p className="text-[13px] text-ink-3">category · competitors · head-to-head rivals · audience</p>
              </div>
            ) : busy?.startsWith("Reading") ? (
              <StagedProgress stages={READ_STAGES} />
            ) : busy ? (
              <div className="grid gap-4 py-16 text-center justify-items-center">
                <Spinner />
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
                  <input className="input w-full" maxLength={120} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. market research firms" />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Competitors
                  {competitors.length > 0 && rosterRoles && (
                    <span className="text-[13px] font-normal normal-case tracking-normal text-ink-3">
                      {competitors.filter((c) => rosterRoleOf(c, rosterRoles) === "same_seat").length > ANGLE_SLOTS &&
                      !competitors.some((c) => ["bench", "adjacent"].includes(rosterRoleOf(c, rosterRoles)))
                        ? `The first ${ANGLE_SLOTS} rivals get a head-to-head and a switching question - toggle to choose. Every rival is still measured.`
                        : `${Math.min(ANGLE_SLOTS, angleRivals(competitors, rosterRoles).length)} of ${ANGLE_SLOTS} head-to-heads - these rivals get a head-to-head and a switching question. Every rival is still measured.`}
                      {h2hNote && <span className="ml-2 text-danger">{h2hNote}</span>}
                    </span>
                  )}
                  {competitors.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 normal-case tracking-normal">
                      {competitors.map((c) => {
                        const role = rosterRoleOf(c, rosterRoles);
                        const direct = role === "same_seat" || role === "bench";
                        const h2h = rosterRoles ? angleRivals(competitors, rosterRoles).includes(c) : false;
                        const parent = rosterParents[c]?.trim();
                        const sister = !!parent && !!clientParent && parent.toLowerCase() === clientParent.trim().toLowerCase()
                          && parent.toLowerCase() !== c.trim().toLowerCase();
                        return (
                          <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-[13px] font-medium text-primary">
                            {c}
                            {rosterRoles && direct && (
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); toggleH2H(c); }}
                                title={`${rosterReasons[c] ? `${rosterReasons[c]}. ` : ""}${
                                  h2h ? "Gets a head-to-head and a switching question. Click to remove." : "Measured in open questions. Click to give it a head-to-head."
                                }`}
                                className={`rounded-full px-1.5 text-[11px] font-medium leading-5 ${
                                  h2h ? "bg-primary text-primary-ink" : "border border-primary/30 text-primary/80"
                                }`}
                              >
                                {h2h ? "head-to-head" : "+ head-to-head"}
                              </button>
                            )}
                            {sister && (
                              <span
                                title={`Same parent company as ${brand}. Its head-to-heads report as portfolio routing, separate from your competitive win rate.`}
                                className="rounded-full bg-warning/10 px-1.5 text-[11px] font-medium leading-5 text-warning"
                              >
                                same parent: {parent}
                              </span>
                            )}
                            {rosterRoles && (
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); toggleRole(c); }}
                                title={`${rosterNotes[c] ? `${rosterNotes[c]}. ` : ""}${
                                  role === "upstream" && rosterClasses?.[c]
                                    ? `Buyers still choose by it as a class - one question weighs ${brand} against ${rosterClasses[c]}. `
                                    : ""
                                }${
                                  role === "adjacent"
                                    ? `Not ${category || "in this category"} - measured, but never a head-to-head. `
                                    : role === "upstream"
                                      ? "An upstream brand gets no rival questions of its own. "
                                      : ""
                                }Click to change its role.`}
                                className={`rounded-full px-1.5 text-[11px] font-medium leading-5 ${
                                  role === "upstream"
                                    ? "bg-warning/10 text-warning"
                                    : role === "adjacent"
                                      ? "bg-ink-3/10 text-ink-3"
                                      : "bg-primary/10 text-primary/80"
                                }`}
                              >
                                {role === "upstream" ? "upstream - sells to the trade" : role === "adjacent" ? `adjacent - not ${category || "this category"}` : "rival"}
                              </button>
                            )}
                            <button type="button" aria-label={`remove ${c}`} onClick={() => setCompetitors(competitors.filter((x) => x !== c))} className="text-primary/70 hover:text-danger leading-none">×</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <input
                    className="input w-full"
                    maxLength={80}
                    value={compDraft}
                    onChange={(e) => setCompDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addCompetitor(); }
                    }}
                    // No commit on blur: clicking a chip's × blurs this input
                    // first, so a half-typed name was being added as a rival by
                    // the removal click (Tyler, 2026-10-04). Enter and comma add;
                    // confirmMarket folds in anything still typed.
                    placeholder={competitors.length === 0 ? "e.g. Qualtrics - press Enter after each" : "add another…"}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Audience <span className="font-normal normal-case tracking-normal text-ink-3">(optional)</span>
                  <input className="input w-full" maxLength={160} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. mid-market CPG brands" />
                </label>
              </div>
            )
          )}

          {step === "scenarios" && grid && (
            <ScenariosGate
              state={grid}
              setState={updateGrid}
              busy={busy !== null}
              readDelta={readDelta}
              onRecomposeBase={(base, rows) => void recomposeBase(base, rows)}
              onRecompose={(base, rows) => {
                setReadDelta(null);
                void gridApi.compose({ base, rows });
              }}
              onSuggestScenario={() => void gridApi.suggestScenario()}
              onAddReserve={(label) => void gridApi.suggestScenario(label)}
              onNearScenario={(i) => void gridApi.nearScenario(i)}
              onRewordScenario={(i, avoid) => void gridApi.rewordScenario(i, avoid)}
              onWarmReview={warmScenarioReview}
              maxScenarios={scenarioCap}
              fitBrand={brand}
              fitCategory={category}
              rivals={allCompetitors().filter((c) => { const r = rosterRoleOf(c, rosterRoles); return r === "same_seat" || r === "bench"; })}
              picks={angleRivals(allCompetitors(), rosterRoles)}
              setupId={draftId ?? undefined}
              onRebuildForBrand={() => gridApi.rebuildForBrand()}
              onBackToCategory={() => gridApi.restoreCategoryView()}
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

          {step === "worries" && grid && (
            !grid.worryPool ? (
              <StagedProgress stages={WORRIES_STAGES} />
            ) : (
              <WorriesGate
                state={grid}
                setState={updateGrid}
                cap={worryCap}
                busy={busy !== null}
              />
            )
          )}

          {step === "stages" && grid && (
            // The cell write gets the same narrated treatment as the
            // market read - the coverage map gives way to elapsed-driven
            // captions instead of a frozen page behind a disabled button.
            busy === CELLS_BUSY ? (
              <StagedProgress stages={CELLS_STAGES} startedAt={cellsInFlight} />
            ) : (
              <CoverageGate
                state={grid}
                setState={updateGrid}
                busy={busy !== null}
                onEditWorries={() => goTo("worries")}
                brand={brand}
                category={category}
                setupId={draftId ?? undefined}
              />
            )
          )}

          {step === "prompts" && mode === "grid" && grid && (
            <div className="grid gap-3">
              {promptsNotice && (
                <div className="rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-[13px] text-primary flex items-start justify-between gap-3">
                  <span>{promptsNotice}</span>
                  <button
                    type="button"
                    onClick={() => setPromptsNotice(null)}
                    aria-label="Dismiss"
                    className="leading-none opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              )}
              {/* Busy stays inline so the gate never unmounts - open stages
                  and folds survive a paraphrase write. */}
              {(busy !== null || grid.step === "phrasings") && (
                <div className="flex justify-end gap-4">
                  {busy !== null ? (
                    <span className="flex items-center gap-2 text-[13px] font-medium text-primary">
                      <InlineSpinner />
                      {busy}
                    </span>
                  ) : (
                    <>
                      {grid.cells.some(
                        (c) =>
                          c.text.trim() &&
                          c.phrasings.some((p) => p.text.trim()) &&
                          1 + c.phrasings.filter((p) => p.text.trim()).length < phrasingTarget(c.stage)
                      ) && (
                        <button
                          type="button"
                          onClick={() => void topUpShortSets()}
                          title="Fill each short set back to quota - what's there stays"
                          className="text-[13px] font-medium text-primary hover:opacity-80"
                        >
                          Top up short sets
                        </button>
                      )}
                      {/* Enterprise-only, and never in the demo (a demo
                       * force-rewrite would redraw the SHARED cached
                       * sets). Destructive to review work, not wallets:
                       * ~$0.25 of model time, but it replaces every
                       * reviewed prompt and any hand edits with fresh
                       * unreviewed drafts - so it confirms first. */}
                      {!demo && plan === "enterprise" && (
                        <button
                          type="button"
                          onClick={() => {
                            const live = grid.cells.filter((c) => c.text.trim()).length;
                            if (
                              !confirm(
                                `Rewrite ALL prompts? This replaces the full set (~${live * PHRASING_COUNT}) with fresh drafts - including any you have edited or already reviewed.`
                              )
                            )
                              return;
                            void writePhrasings(true);
                          }}
                          className="text-[13px] font-medium text-primary hover:opacity-80"
                        >
                          Rewrite all prompts
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              <CellsGate
                state={grid}
                setState={updateGrid}
                brandNames={brandNames}
                busy={busy !== null}
                onRegenerate={(i) => gridApi.regenerateCell(i)}
                onNearCell={(i) => gridApi.regenerateCell(i, true)}
                onSuggestCell={(k, sit, angle) => gridApi.suggestCell(k, sit, angle)}
                onAddOwn={(k, sit, angle) => updateGrid((g) => (g ? gridApi.addOwnCell(g, k, sit, angle) : g))}
                customUsed={customUsed}
                customAllowance={customAllowance}
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
              onContinue={() => (mode === "classic" ? resolveClassicReview() : resolveCellReview())}
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

          {step === "engines" && demo && demoDone && (
            <div className="mb-4 grid gap-2 max-w-2xl rounded-xl border border-primary bg-primary-soft/30 p-5">
              <span className="text-sm font-semibold uppercase tracking-wide text-primary">
                That&apos;s the whole setup
              </span>
              <p className="m-0 text-sm text-ink-2">
                In the live product this last click creates the tracker and
                launches the first run - {promptCount.toLocaleString()} prompts ×{" "}
                {engineSet.length || 1} engine{engineSet.length === 1 ? "" : "s"} ={" "}
                {answers.toLocaleString()} answers - and every scheduled run after
                it builds the trend.
              </p>
              <p className="m-0 text-[13px] text-ink-3">
                Nothing was created or run in this demo.
              </p>
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
              onClick={() => footerAction && onFooterClick(footerAction.run)}
              disabled={footerAction.disabled}
              className="btn-primary shrink-0 inline-flex items-center gap-2"
            >
              {(busy !== null || submitting) && (
                <InlineSpinner tone="on-primary" />
              )}
              {footerAction.label}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
