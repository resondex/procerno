"use client";

import { useEffect, useState, type ReactNode, useRef } from "react";
import { angleRivals, deriveCheckSpec, rosterRoleOf, sameSeatOf, type CellCheckSpec, type RosterClasses, type RosterRoles } from "@/lib/engine/battery_checks";
import { InlineSpinner } from "../components/spinner";

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
  /** The machine wording - a paraphrase whose text differs from this was
   * edited by the user, and gets the quality check at confirm. */
  original?: string;
}

/** Stable per-cell id for async completions: a 60s draw must land on
 * THIS cell whatever was edited, added, or deleted meanwhile - and cell
 * identity (stage x scenario x angle) stopped being unique the moment
 * custom questions could share one. */
function cellUid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface GridCellUi {
  /** Stable client id - see cellUid(). */
  uid?: string;
  /** User-added question (Add your own / Suggest another): survives a
   * coverage recompose and counts against the custom allowance. */
  custom?: boolean;
  stage: string;
  layer: string;
  /** Scenario label, or null for invariant single cells. */
  situation: string | null;
  angle: string;
  /** Measurement type from the generator (open_choice/head_to_head/
   * within_brand/doubt/awareness/settled_customer); absent on legacy or
   * hand-added cells (typed server-side at create as a fallback). */
  qtype?: string | null;
  /** Doubt cells (s9+): the planned concern this cell measures - part of
   * the design, sent with every generation request. */
  concern?: string | null;
  /** Value cells (2026-10-04): the line weighed and its counterpart. */
  valueLine?: ValueLineUi | null;
  /** Class-angle comparison cells (2026-10-01; angle "class"): the class
   * the client brand is weighed against ("a Visa card") and the upstream
   * brand it evokes ("Visa"). Part of the design - sent with every
   * generation and review request. Absent on every other cell. */
  classPhrase?: string | null;
  classBrand?: string | null;
  /** Invariant cells only: comma-joined scenario labels whose journeys
   * reach this stage, when not universal. */
  mode?: string | null;
  text: string;
  /** The cell's typed check-spec (s7+): written by the generator (or the
   * draw / seed-edit review that last set the text), sent with every
   * paraphrase request. Absent on legacy drafts, which keep the
   * string-derived checks. The server re-derives it before use, so a
   * stale copy is never trusted. */
  spec?: CellCheckSpec | null;
  /** Deterministic-check violations the generator could not heal: the
   * seed shipped flagged-terminal and the gate asks the human to resolve
   * it (edit, cycle, or redraw - any of which clears the flag). The
   * machine never retries these on its own. */
  seedFlags?: string[] | null;
  /** Every prompt offered for this cell, oldest first ([0] = the composed
   * seed); the user cycles through these. Absent = just the seed. */
  alts?: string[];
  /** Which entry of `alts` the card is showing. */
  altIdx?: number;
  /** "New prompt" draws used (capped at MAX_REGENS). */
  regens?: number;
  /** Near-neighbor draws used (capped at MAX_VARIANTS). */
  nears?: number;
  /** The last machine-offered wording - a cell whose text differs from
   * this was edited by the user, and gets the quality check at confirm. */
  original?: string;
  /** Wordings in `alts` that the USER wrote (captured when cycling away
   * from a manual edit). Cycling back to one keeps it subject to the
   * confirm-time quality check - edit -> cycle away -> cycle back must
   * not launder an unchecked edit into the machine baseline. */
  userAlts?: string[];
  /** Paraphrases beyond the seed text; empty until gate 3. */
  phrasings: GridPhrasing[];
  /** The engine's paraphrase set as it first landed for the CURRENT seed
   * (2026-10-06): the setup decision record's "offered" side, kept
   * through edits and deletions. Reset when a new set is written. */
  phrasingsOffered?: string[];
  /** The wording the current set was generated for. When the live text
   * drifts from this (a post-write edit), the set is stale: it gets
   * banked on blur and the missing-paraphrases gate takes over. */
  phrasedFor?: string;
  /** Paraphrase sets already written for wordings this cell has moved off
   * of, keyed by exact prompt text - cycling back to a wording restores
   * its set instead of regenerating it. */
  phrasingsByText?: Record<string, GridPhrasing[]>;
}

/** A class-angle cell's class fields for a request body; {} otherwise, so
 * every other cell's request is unchanged. */
function classFields(c: Pick<GridCellUi, "classPhrase" | "classBrand" | "valueLine">): { classPhrase?: string; classBrand?: string; valueLine?: ValueLineUi | null } {
  return {
    ...(c.classPhrase ? { classPhrase: c.classPhrase, classBrand: c.classBrand ?? undefined } : {}),
    // p14: the Value line rides to the paraphrase engine so paraphrases
    // are held to the line and a cheaper counterpart.
    ...(c.valueLine ? { valueLine: { line: c.valueLine.line, counterpart: c.valueLine.counterpart } } : {}),
  };
}

/** The angle as a reader sees it. */
function angleLabel(c: Pick<GridCellUi, "angle" | "classPhrase">): string {
  return c.angle === "defensive" ? "your churn moment" : `vs ${c.classPhrase ?? c.angle}`;
}

/** Loose word-overlap similarity, mirroring the server's dedup filter -
 * enough to keep a top-up from re-adding a near-twin of a kept line. */
function similarText(a: string, b: string): boolean {
  const words = (t: string) =>
    new Set(
      t.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter((w) => w.length > 2)
    );
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) > 0.5;
}

/** A scenario rename follows through to the cells that reference it -
 * custom questions must not be orphaned (and later silently dropped)
 * because their buyer's label changed wording. */
export function rebindSituation(cells: GridCellUi[], from: string, to: string): GridCellUi[] {
  const f = from.trim();
  const t = to.trim();
  if (!f || !t || f === t) return cells;
  return cells.map((c) => (c.situation === f ? { ...c, situation: t } : c));
}

/** Bank the cell's written paraphrases under its current wording, and pull
 * the set banked for `nextText` if there is one - the swap that makes
 * returning to a wording you already paid for free. */
export function swapPhrasings(
  c: GridCellUi,
  nextText: string
): Pick<GridCellUi, "phrasings" | "phrasingsByText" | "phrasedFor" | "phrasingsOffered"> {
  // The set is banked under the wording it was GENERATED for - the live
  // text may have drifted since (a post-write edit).
  const owner = (c.phrasedFor ?? c.text).trim();
  const bank = c.phrasings.some((p) => p.text.trim())
    ? { ...(c.phrasingsByText ?? {}), [owner]: c.phrasings }
    : c.phrasingsByText;
  const restored = bank?.[nextText.trim()] ?? [];
  return {
    phrasings: restored,
    phrasingsByText: bank,
    phrasedFor: nextText,
    // A restored set's offered side is its machine wordings; a fresh set
    // (none banked) starts with none and gets it when the set lands.
    phrasingsOffered: restored.length > 0 ? restored.map((p) => p.original ?? p.text) : undefined,
  };
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

/** Client mirror of the engine's ScenarioFit advisory. */
interface ScenarioFitUi {
  offPortfolio: { label: string; reason: string }[];
  missingCore: { label: string; description: string; reason: string } | null;
}

/** Client mirror of the engine's JourneyFit advisory - dimensions where
 * this brand's own buyer may diverge from the category-modal read.
 * Applying one is exactly a radio-pill edit. */
interface JourneyFitUi {
  suggestions: {
    dimension: string;
    current: string;
    suggested: string;
    reason: string;
    /** Stages the flip would bring in - the "keep the market view"
     * resolution ticks these on instead of changing the base. Absent on
     * advice cached before this field existed. */
    stagesIn?: { key: string; label: string }[];
  }[];
}

export interface ScenarioRow {
  label: string;
  description: string;
  /** journeys30: the room restated without what the buyer wants - the only
   * form of the room the question writer sees. Comes from the market read;
   * cleared when the description is edited (the server derives a fresh one). */
  circumstance?: string;
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

/** The cells-write busy phrase - value, not process. The wizard's
 * narrated captions trigger on this exact string. */
export const CELLS_BUSY = "Turning your market into queries…";

/** The prompts write narrated inside its inline counter chip - vague by
 * design (progression, never mechanics), elapsed-driven like the other
 * narrated waits; the caption refreshes as each batch lands. */
const PHRASING_CAPTIONS: [number, string][] = [
  [0, "Putting your questions in buyers' words…"],
  [30, "Asking each one in different voices…"],
  [70, "Wording them the way real people type…"],
  [110, "Nearly there…"],
];
function phrasingCaption(startedAt: number): string {
  const secs = (Date.now() - startedAt) / 1000;
  return [...PHRASING_CAPTIONS].reverse().find(([at]) => secs >= at)?.[1] ?? PHRASING_CAPTIONS[0][1];
}
/** "New prompt" draws per cell before we ask the user to write their own. */
export const MAX_REGENS = 3;

export interface GridState {
  step: "compose" | "cells" | "phrasings";
  /** The market's base read; scenarios inherit it unless they deviate. */
  moderators: Record<string, unknown> & { rationale?: string };
  /** The base read as first offered by the fresh compose (2026-10-06) -
   * the setup decision record diffs the confirmed read against it. */
  moderatorsOffered?: Record<string, unknown>;
  stages: GridStage[];
  keptStages: string[];
  /** The ACTIVE scenarios with their journeys - what the planner uses.
   * Kept in sync with scenarioRows by withScenarioRows(). */
  scenarios: { label: string; description: string; circumstance?: string; journey: Journey | null }[];
  scenarioRows?: ScenarioRow[];
  /** Alternates from the market read, not yet shown - "Suggest another"
   * draws from here first (instant); the model is only asked once the pool
   * runs dry. Reserve scenarios inherit the base journey. */
  reserve?: { label: string; description: string }[];
  /** Portfolio-fit advisory computed WITH the compose, so the scenarios
   * gate never renders before its advice exists (edits refetch async). */
  fit?: ScenarioFitUi | null;
  /** Journey-fit advisory, same contract - suggestions self-resolve once
   * applied (the recomposed base matches, so the server drops them). */
  journeyFit?: JourneyFitUi | null;
  /** The scenario view in hand before a forBrand rebuild - "Back to the
   * category view" restores it (rows AND reserve, so "Suggest another"
   * draws from the right pool). The base read is never part of this:
   * a rebuild changes scenarios only. */
  preRebuild?: { rows: ScenarioRow[]; reserve?: { label: string; description: string }[] } | null;
  /** The brand view as last left (2026-10-07, Tyler): rows and reserve
   * stashed on "Back to the category view", restored by "rebuild around
   * <brand>" instead of a fresh read, so edits, additions and ticks made in
   * either view survive toggling. preRebuild is the mirror slot (the
   * category view while the brand view is shown). */
  brandView?: { rows: ScenarioRow[]; reserve?: { label: string; description: string }[] } | null;
  /** Stage keys added via the journey advisory's "keep the market view"
   * action, per dimension. Powers the banner's Undo AND the coverage
   * map: these stages are a brand-level recommendation, never labeled
   * "not recommended" (the rules' skip is about the market at large). */
  journeyStageAdds?: Record<string, { key: string; label: string }[]>;
  /** Per-room scope for a kept situational stage (2026-10-06, Tyler): the
   * rooms the stage runs in, set by clicking dots on the coverage map. A
   * stage the mask reaches nowhere used to run in EVERY room when kept
   * (AmEx's Business case, added on the advisory, minted four cells where
   * only the business room has an approver). Absent = the mask's columns,
   * or every room for a stage the mask reaches nowhere. */
  stageRooms?: Record<string, string[]>;
  /** Fingerprints (label|description) of user-authored scenarios that
   * PASSED the quality check, persisted with the draft so unchanged rows
   * are never rechecked. Deliberately excludes "keep mine" choices - a
   * declined suggestion pops up again on the next confirm. */
  reviewedScenarios?: string[];
  /** Same contract for edited prompts: fingerprints that PASSED the
   * Prompts-gate quality check; "keep mine" is never recorded. */
  reviewedCells?: string[];
  /** Cell count as composed - the custom-question allowance measures NET
   * additions against this, so deleting any question frees a slot. */
  baselineCellCount?: number;
  /** The worries gate's candidate pool (the menu); null until drawn. */
  worryPool?: WorryUi[] | null;
  /** Which stances of the pool the mask offered (chips shown). */
  worryOffered?: string[];
  /** Confirmed worry picks - one invariant doubt cell each; the concern
   * rides the cell and the dashboard attributes by it. Absent = legacy
   * concern-zip battery (old drafts). */
  worries?: { concern: string; stage: string }[];
  /** Value lines per room (2026-10-04): the brand's product line each
   * column's Value cell weighs and the generic option one tier below it,
   * proposed by the engine (most premium fitting line) and editable on the
   * coverage step. null = no Value cell for that room. Absent = not yet
   * proposed (the engine default applies). */
  valueLines?: Record<string, ValueLineUi | null>;
  /** The brand's product lines from the Value read (2026-10-06): the
   * chooser's list. Absent until the coverage step first loads lines. */
  valueCatalog?: ValueCatalogLineUi[];
  /** The engine's pick per room, kept so the chooser can mark it
   * "recommended" after the user changes the line. */
  valueRecommended?: Record<string, string | null>;
  cells: GridCellUi[];
}

/** A Value cell's two ends (engine ValueLine, UI copy). */
export interface ValueLineUi { line: string; counterpart: string; fit?: "contest" | "leans_no" | "leans_yes" }
/** A brand product line the Value chooser offers (engine ValueCatalogLine). */
export interface ValueCatalogLineUi { name: string; for: string; org: boolean }

/** A worries-gate candidate (engine WorryCandidate, UI copy). */
export interface WorryUi {
  worry: string;
  detail: string;
  stances: string[];
  recommended: string;
  /** The measurement plan: stances recommended for fielding (may be
   * empty). Absent on pools drawn before the recommendation era. */
  recommend?: string[];
  /** Other worries in the pool sharing this one's subject (worries5). */
  overlaps?: string[];
}

/** The pool's recommended worry-stance pairs - the gate's pre-pick and
 * pre-lit chips. Legacy pools (no recommend arrays anywhere) fall back to
 * one pair per worry at its natural stance; a recommendation-era pool
 * that recommends nothing falls back the same way rather than opening
 * the gate empty. */
export function recommendedWorryPairs(pool: WorryUi[]): { concern: string; stage: string }[] {
  const planned = pool.flatMap((w) =>
    (w.recommend ?? []).map((s) => ({ concern: w.worry, stage: s }))
  );
  if (planned.length > 0) return planned;
  return pool.map((w) => ({ concern: w.worry, stage: w.recommended }));
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
    baselineCellCount: g.baselineCellCount ?? g.cells.length,
    cells: g.cells.map((c) => ({
      ...c,
      uid: c.uid ?? cellUid(),
      text: scrubPrompt(c.text),
      // Drafts from before the prompt review carry no machine baseline -
      // treat the saved text as it, so nothing is retroactively flagged.
      original: scrubPrompt(c.original ?? c.text),
      concern: c.concern ?? null,
      // Pre-phrasedFor drafts: assume the set belongs to the current text
      // (same assumption `original` makes), so the edit-after-write flow
      // works on legacy drafts instead of silently no-opping.
      phrasedFor: scrubPrompt(c.phrasedFor ?? c.text),
      // The cycling history and the bank keys get the same scrub as the
      // live text, so cycling to a draft-frozen wording can't reintroduce
      // banned punctuation and bank lookups keep matching.
      alts: c.alts?.map(scrubPrompt),
      phrasings: c.phrasings.map((ph) => ({
        ...ph,
        text: scrubPrompt(ph.text),
        original: scrubPrompt(ph.original ?? ph.text),
      })),
      phrasingsOffered: c.phrasingsOffered?.map(scrubPrompt),
      phrasingsByText: c.phrasingsByText
        ? Object.fromEntries(
            Object.entries(c.phrasingsByText).map(([k, set]) => [
              scrubPrompt(k).trim(),
              set.map((ph) => ({
                ...ph,
                text: scrubPrompt(ph.text),
                original: scrubPrompt(ph.original ?? ph.text),
              })),
            ])
          )
        : undefined,
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

/** The setup's offered-vs-accepted record (2026-10-06, Tyler): what the
 * engine first offered at each gate and what was sent for analysis. Built
 * from the draft's own provenance fields at create; stored on the project
 * as setup_decision. */
export function buildSetupDecision(g: GridState): Record<string, unknown> {
  const rows = scenarioRows(g);
  const sameText = (a?: { label: string; description: string } | null, b?: { label: string; description: string } | null) =>
    !!a && !!b && a.label.trim() === b.label.trim() && a.description.trim() === b.description.trim();
  const roomHow = (r: ScenarioRow): string => {
    if (!r.suggested) return "own";
    const cur = { label: r.label, description: r.description };
    if (sameText(cur, r.first)) return "offered";
    if (sameText(cur, r.original)) return (r.variants ?? 0) > 0 ? "near_variant" : "reworded";
    return "edited";
  };
  const cellHow = (c: GridCellUi): string => {
    if (c.custom) return "own";
    if (c.original && c.text.trim() !== c.original.trim()) return (c.nears ?? 0) > 0 ? "near_variant_or_edited" : (c.regens ?? 0) > 0 ? "redrawn_or_edited" : "edited";
    return (c.nears ?? 0) > 0 ? "near_variant" : (c.regens ?? 0) > 0 ? "redrawn" : "offered";
  };
  return {
    version: 1,
    base: { offered: g.moderatorsOffered ?? null, decided: g.moderators },
    rooms: {
      offered: rows.filter((r) => r.suggested).map((r) => r.first ?? r.original ?? { label: r.label, description: r.description }),
      reserve: g.reserve ?? [],
      decided: rows.filter((r) => r.on).map((r) => ({ label: r.label, description: r.description, journey: r.journey, how: roomHow(r) })),
      off: rows.filter((r) => !r.on).map((r) => r.label),
    },
    stages: {
      recommended: g.stages.filter((s) => s.recommended).map((s) => s.key),
      kept: g.keptStages,
      stageRooms: g.stageRooms ?? null,
    },
    valueLines: {
      recommended: g.valueRecommended ?? null,
      decided: Object.fromEntries(Object.entries(g.valueLines ?? {}).map(([k, v]) => [k, v ? { line: v.line, counterpart: v.counterpart } : null])),
    },
    worries: g.worryPool
      ? {
          offered: g.worryPool.map((w) => ({ worry: w.worry, detail: w.detail, recommended: w.recommended, plan: w.recommend ?? [] })),
          decided: g.worries ?? [],
        }
      : null,
    cells: g.cells.filter((c) => c.text.trim()).map((c) => {
      const offered = c.phrasingsOffered ?? c.phrasings.map((p) => p.original ?? p.text);
      const decided = c.phrasings.filter((p) => p.text.trim()).map((p) => ({ text: p.text, asker: p.asker || null, offered: p.original ?? null }));
      const decidedTexts = new Set(decided.map((d) => d.text.trim()));
      return {
        stage: c.stage, situation: c.situation, angle: c.angle, concern: c.concern ?? null,
        seed: { offered: c.original ?? null, decided: c.text, how: cellHow(c) },
        paraphrases: {
          offered,
          decided,
          dropped: offered.filter((t) => !decidedTexts.has(t.trim()) && !decided.some((d) => d.offered?.trim() === t.trim())),
          edited: decided.filter((d) => d.offered && d.text.trim() !== d.offered.trim()).length,
        },
      };
    }),
  };
}

export function withScenarioRows(g: GridState, rows: ScenarioRow[]): GridState {
  return {
    ...g,
    scenarioRows: rows,
    scenarios: rows
      .filter((r) => r.on)
      .map(({ label, description, circumstance, journey }) => ({ label, description, circumstance, journey })),
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
export function stageColumns(st: GridStage, activeLabels: string[], stageRooms?: Record<string, string[]>): string[] {
  const explicit = stageRooms?.[st.key];
  if (explicit) return explicit.filter((c) => activeLabels.includes(c));
  const cols = st.columns.filter((c) => activeLabels.includes(c));
  return cols.length > 0 ? cols : st.recommended ? [] : activeLabels;
}

/** Cells the kept stages and active scenarios will produce - the same mask
 * rules the engine's planner applies, so the count is exact before anything
 * is written. */
/** The doubt stages the worries module owns (mirror of the engine's
 * WORRY_STANCE_STAGES - a confirmed pick list replaces their counts). */
export const WORRY_STAGES = new Set(["objections", "churn_triggers", "renewal"]);

/** The stage keys a cells write should send. On a worry-era battery the
 * worries gate OWNS doubt coverage: a stage with picks is kept whatever
 * the coverage map's tick says (the map renders those rows read-only, but
 * an older draft may carry a stale untick that would otherwise silently
 * kill confirmed picks). */
export function effectiveKeptStages(g: GridState): string[] {
  if (!g.worries) return g.keptStages;
  const kept = new Set(g.keptStages);
  for (const w of g.worries) kept.add(w.stage);
  return [...kept];
}

export function gridCellCount(g: GridState | null, rivalCount: number): number {
  if (!g) return 0;
  const r = Math.min(rivalCount, 4);
  const kept = new Set(effectiveKeptStages(g));
  const active = g.scenarios.map((s) => s.label);
  return g.stages
    .filter((s) => kept.has(s.key))
    .reduce((n, s) => {
      // Worries module: a doubt stage holds one cell per worry the user
      // assigned to it - zero is a deliberate pick, not a gap.
      if (g.worries && WORRY_STAGES.has(s.key)) {
        return n + g.worries.filter((w) => w.stage === s.key).length;
      }
      const cols = stageColumns(s, active, g.stageRooms);
      const effective = g.stageRooms?.[s.key] ? cols : cols.length > 0 ? cols : active;
      if (s.rivals === "each") return n + r;
      if (s.rivals === "defensive_offensive") return n + 1 + r;
      if (s.situational) return n + Math.max(effective.length, 1);
      return n + 1;
    }, 0);
}

export function namesAny(text: string, names: string[]): boolean {
  // Word-boundary match, mirroring the engine's namesBrandWord: the pill
  // must not call a blind prompt "branded" because "purchases" contains
  // the rival Chase. A parenthetical label ("Amazon (beauty)") also
  // matches its speakable name ("Amazon") - the parenthetical is display
  // only and never occurs in natural text.
  return names.some((n) => {
    const b = n.trim();
    if (!b) return false;
    const primary = b.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    const forms = primary && primary !== b ? [b, primary] : [b];
    return forms.some((f) => {
      const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^a-z0-9])${esc}(?:$|[^a-z0-9])`, "i").test(text);
    });
  });
}

/** The base read, as editable dimensions. Changing one recomposes the mask
 * - pure code on the server, so it is instant. */
export const MODERATOR_FIELDS: { key: string; header: string; options: [string, string][] }[] = [
  { key: "verifiability", header: "How they judge", options: [["spec", "spec-driven"], ["taste", "taste-driven"], ["trust", "trust-driven"]] },
  { key: "involvement", header: "How much thought", options: [["considered", "considered"], ["habitual", "habitual"]] },
  { key: "think_feel", header: "Head or heart", options: [["think", "rational"], ["feel", "identity-led"]] },
  { key: "decision_unit", header: "Who decides", options: [["solo", "solo buyer"], ["household", "household"], ["committee", "committee-bought"]] },
  { key: "rhythm", header: "How often", options: [["one_shot", "one-shot"], ["replenishment", "replenishment"], ["subscription", "subscription"]] },
  { key: "risk", header: "Biggest worry", options: [["performance", "performance risk"], ["financial", "financial risk"], ["social", "social risk"], ["physical", "physical risk"]] },
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
  /** Typed roster (2026-09-30): competitor -> same_seat | upstream, sent
   * with every competitors list. Absent = all same_seat (untyped). */
  rosterRoles?: RosterRoles;
  /** Class-angle cells (2026-10-01): upstream brand -> buyer class phrase.
   * Sent with the cells write; absent = no class cells. */
  rosterClasses?: RosterClasses;
  /** The plan's scenario cap; defaults to the absolute maximum. */
  maxScenarios?: number;
  state: GridState | null;
  setState: (s: GridState | null | ((prev: GridState | null) => GridState | null)) => void;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
  /** Notice slot that survives the advance to the Prompts step (goTo wipes
   * setError) - the short-battery message lives here (2026-10-02 round 4). */
  setNotice?: (n: string | null) => void;
  /** The wizard's setup id - every spend request carries it so the ledger
   * books setup costs to the tracker before the project exists. */
  setupId?: string | null;
}

export function useGridSetup(a: GridSetupArgs) {
  const cap = a.maxScenarios ?? MAX_SCENARIOS;
  async function post<T>(path: string, body: unknown): Promise<T | null> {
    // A hard client-side bound: without it one stalled request freezes the
    // gate's busy state forever (Promise.all never resolves). The server
    // keeps working past this and caches its result, so a retry after the
    // timeout usually lands instantly.
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(a.setupId ? { "x-setup-id": a.setupId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    }).catch(() => null);
    if (!res) {
      a.setError("that took too long - try again (finished work is kept)");
      return null;
    }
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
    /** Cells to carry through the recompose (already rebound if a
     * scenario was renamed); defaults to the current grid's. Only the
     * CUSTOM ones survive - composed cells are the recompose's to remake. */
    cells?: GridCellUi[];
    /** Caller owns the busy indicator (it is running this alongside
     * something else); errors still surface. */
    silent?: boolean;
    /** Restore path: the reserve pool to reinstate alongside the rows. */
    reserve?: { label: string; description: string }[];
    /** undefined = carry the current view's preRebuild through the edit;
     * null = clear it (restoring the category view). */
    preRebuild?: GridState["preRebuild"];
    /** undefined = carry; null = clear; a value = stash the brand view. */
    brandView?: GridState["brandView"];
  }, forBrand = false): Promise<GridState | null> {
    if (!edit?.silent) {
      a.setBusy(
        edit ? "Recomposing…" : forBrand ? `Rebuilding scenarios for ${a.brand}…` : "Reading your market…"
      );
    }
    a.setError(null);
    const activeRows = edit?.rows.filter((r) => r.on && r.label.trim()) ?? [];
    const data = await post<{
      base: GridState["moderators"];
      scenarios: { label: string; description: string; circumstance?: string; journey: Journey | null }[];
      reserve?: { label: string; description: string }[];
      stages: GridStage[];
      fit?: ScenarioFitUi | null;
      journeyFit?: JourneyFitUi | null;
    }>("/api/setup/grid/compose", {
      brand: a.brand,
      category: a.category,
      audience: a.audience || undefined,
      ...(forBrand && !edit ? { forBrand: true } : {}),
      // Contest repair (contract audit v4): the fresh read swaps uncontested
      // core rooms for passing reserve rooms against this roster.
      ...(!edit && a.competitors.length > 0
        ? {
            rivals: a.competitors.filter((c) => { const r = rosterRoleOf(c, a.rosterRoles); return r === "same_seat" || r === "bench"; }),
            picks: angleRivals(a.competitors, a.rosterRoles),
          }
        : {}),
      ...(edit && activeRows.length > 0
        ? {
            base: edit.base,
            scenarios: activeRows.map(({ label, description, circumstance, journey }) => ({ label, description, circumstance, journey })),
          }
        : {}),
    });
    if (!data) {
      if (!edit?.silent) a.setBusy(null);
      return null;
    }
    // A brand rebuild changes SCENARIOS ONLY. "How they generally decide"
    // is the market's decision structure - and may carry the user's own
    // pill edits - so the forBrand read's re-rolled base is discarded and
    // the mask is recomposed against the base in hand (pure code,
    // instant). The view being replaced is kept for "Back to the
    // category view"; the journey advisory stays one-shot.
    if (forBrand && !edit && a.state) {
      const keptBase = a.state.moderators;
      const masked = await post<{
        scenarios: { label: string; description: string; circumstance?: string; journey: Journey | null }[];
        stages: GridStage[];
      }>("/api/setup/grid/compose", {
        brand: a.brand,
        category: a.category,
        audience: a.audience || undefined,
        base: keptBase,
        scenarios: data.scenarios.map(({ label, description, circumstance, journey }) => ({ label, description, circumstance, journey })),
      });
      a.setBusy(null);
      if (!masked) return null;
      // Stage overrides survive the rebuild exactly as they survive an
      // edited recompose: a kept-but-not-recommended stage (an advisory
      // add like Renewal) was silently dropped here - the rebuild reset
      // keptStages to rules-only, and the save then persisted the loss.
      const prevByKey = new Map(a.state.stages.map((s) => [s.key, s]));
      const prevKept = new Set(a.state.keptStages);
      const rebuildKept = masked.stages
        .filter((s) => {
          const prev = prevByKey.get(s.key);
          if (!prev) return s.recommended;
          const wasKept = prevKept.has(s.key);
          const overridden = wasKept !== prev.recommended;
          return overridden ? wasKept : s.recommended;
        })
        .map((s) => s.key);
      const next: GridState = withScenarioRows(
        {
          step: "compose",
          moderators: keptBase,
          stages: masked.stages,
          keptStages: rebuildKept,
          // Fit advises on the AWARE set (the fresh read computed it);
          // journey advice never refreshes here - the base didn't move.
          fit: data.fit ?? a.state.fit ?? null,
          journeyFit: a.state.journeyFit ?? null,
          scenarios: [],
          reserve: data.reserve,
          reviewedScenarios: a.state.reviewedScenarios,
          cells: [],
          preRebuild: a.state.preRebuild ?? {
            rows: scenarioRows(a.state),
            reserve: a.state.reserve,
          },
          brandView: null,
          journeyStageAdds: a.state.journeyStageAdds,
        },
        rowsFromSuggested(masked.scenarios, cap)
      );
      a.setState(next);
      return next;
    }
    if (!edit?.silent) a.setBusy(null);
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
        moderatorsOffered: edit ? a.state?.moderatorsOffered ?? data.base : data.base,
        stages: data.stages,
        keptStages: data.stages.filter((s) => s.recommended).map((s) => s.key),
        fit: data.fit ?? a.state?.fit ?? null,
        journeyFit: data.journeyFit ?? a.state?.journeyFit ?? null,
        scenarios: [],
        // An edited recompose returns no reserve; the pool carries over
        // (or the restore's explicit pool), as do the already-checked
        // scenario fingerprints. Custom questions survive the recompose
        // (a fresh read wipes everything).
        reserve: data.reserve ?? edit?.reserve ?? a.state?.reserve,
        // A pill edit inside the brand view keeps the way back; a fresh
        // read (or an explicit null from the restore) clears it.
        preRebuild: edit
          ? edit.preRebuild !== undefined
            ? edit.preRebuild
            : a.state?.preRebuild ?? null
          : null,
        brandView: edit
          ? edit.brandView !== undefined
            ? edit.brandView
            : a.state?.brandView ?? null
          : null,
        // Advisory stage-adds ride through edits; a fresh read resets.
        journeyStageAdds: edit ? a.state?.journeyStageAdds : undefined,
        reviewedScenarios: a.state?.reviewedScenarios,
        baselineCellCount: edit ? 0 : undefined,
        cells: edit ? (edit.cells ?? a.state?.cells ?? []).filter((c) => c.custom) : [],
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
   * `fromReserve` names one of the market read's alternates (the gate
   * shows them in a fold - 2026-10-04); without it, the model is asked for
   * a fresh room distinct from the rows AND the reserve, since the reserve
   * is already on screen. Suggestions always inherit the base journey. */
  async function suggestScenario(fromReserve?: string): Promise<void> {
    if (!a.state) return;
    const rows = scenarioRows(a.state);
    const listed = new Set(rows.map((r) => r.label.trim().toLowerCase()));
    const pool = (a.state.reserve ?? []).filter((s) => !listed.has(s.label.trim().toLowerCase()));
    let scenario: { label: string; description: string };
    let reserve = a.state.reserve;
    const picked = fromReserve
      ? pool.find((s) => s.label.trim().toLowerCase() === fromReserve.trim().toLowerCase())
      : undefined;
    if (picked) {
      scenario = picked;
      reserve = (a.state.reserve ?? []).filter((s) => s.label !== scenario.label);
    } else {
      if (fromReserve) return;
      a.setBusy("Thinking of another scenario…");
      a.setError(null);
      const data = await post<{ scenario: { label: string; description: string } }>(
        "/api/setup/grid/scenario",
        {
          category: a.category,
          audience: a.audience || undefined,
          decisionUnit: a.state.moderators.decision_unit,
          exclude: [...rows, ...pool].map(({ label, description }) => ({ label, description })),
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
        headers: { "Content-Type": "application/json", ...(a.setupId ? { "x-setup-id": a.setupId } : {}) },
        signal: AbortSignal.timeout(60_000),
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

  /** Gate 1 helper: a near variant of one card - same circumstance, one
   * detail moved. The card's pool of three is fetched on the FIRST click
   * (low effort, a few seconds) and walked on later clicks. No prefetch:
   * it spent a model call per card on every setup for a button most
   * users never press (Tyler, 2026-10-04). */
  async function nearScenario(i: number): Promise<void> {
    if (!a.state) return;
    const rows = scenarioRows(a.state);
    const row = rows[i];
    if (!row?.label.trim()) return;
    const used = row.variants ?? 0;
    if (used >= MAX_VARIANTS) return;
    let pool = row.pool ?? [];
    // 2026-10-06: a pool can come back short (the engine's addition guard
    // drops variants), and the draw used to re-serve the LAST variant once
    // past the end - a click that changed nothing. Past the end, fetch
    // more, excluding every variant already drawn; still nothing = say so.
    if (used >= pool.length) {
      a.setBusy("Finding a near neighbor…");
      a.setError(null);
      const more = await fetchPool(
        poolAnchor(row),
        [...rows.map(({ label, description }) => ({ label, description })), ...pool],
        String(a.state.moderators.decision_unit ?? "committee"),
        false
      );
      a.setBusy(null);
      const fresh = (more ?? []).filter((v) => !pool.some((p) => p.label === v.label && p.description === v.description));
      if (fresh.length === 0) {
        a.setError("No further near neighbor came back for this room - edit the text to make it yours, or try again.");
        return;
      }
      pool = [...pool, ...fresh];
    }
    const variant = pool[used];
    // The draw is the rejection signal for the current wording - logged
    // for OUR visibility only, never read back into generation.
    void fetch("/api/setup/grid/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(a.setupId ? { "x-setup-id": a.setupId } : {}) },
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
    const rebound = rebindSituation(a.state.cells, row.label, variant.label);
    if (row.on) {
      await compose({
        base: a.state.moderators,
        rows: nextRows,
        cells: rebound.filter((c) => c.custom),
      });
    } else {
      a.setState(withScenarioRows({ ...a.state, cells: rebound }, nextRows));
    }
  }

  /** "Say it differently" (2026-10-06): the same room in other words, never
   * using the phrases the user flagged. Not a near-neighbor draw - the
   * variant counter is untouched and the original is kept for Reset. The
   * room check re-runs on its own because the room text changed. */
  async function rewordScenario(i: number, avoid: string[]): Promise<void> {
    if (!a.state) return;
    const rows = scenarioRows(a.state);
    const row = rows[i];
    if (!row?.label.trim()) return;
    a.setBusy("Rewording…");
    a.setError(null);
    const data = await post<{ scenario: { label: string; description: string } }>("/api/setup/grid/scenario", {
      category: a.category,
      audience: a.audience || undefined,
      decisionUnit: String(a.state.moderators.decision_unit ?? "committee"),
      exclude: rows.filter((r) => r.label.trim()).map(({ label, description }) => ({ label, description })).slice(-24),
      reword: { of: { label: row.label, description: row.description }, avoid: avoid.map((x) => x.trim()).filter(Boolean) },
    });
    a.setBusy(null);
    if (!data?.scenario) return;
    const v = data.scenario;
    const nextRows = rows.map((r, j) => (j === i ? { ...r, label: v.label, description: v.description, circumstance: undefined } : r));
    const rebound = rebindSituation(a.state.cells, row.label, v.label);
    if (row.on) {
      await compose({ base: a.state.moderators, rows: nextRows, cells: rebound.filter((c) => c.custom) });
    } else {
      a.setState(withScenarioRows({ ...a.state, cells: rebound }, nextRows));
    }
  }

  /** The worries gate's pool: drawn once per battery (server-cached and
   * coalesced), stored on the grid state so the draft carries it. */
  async function fetchWorries(from?: GridState | null): Promise<GridState | null> {
    const st = from ?? a.state;
    if (!st) return null;
    if (st.worryPool && st.worryPool.length > 0) return st;
    a.setBusy("Reading the worries buyers raise…");
    a.setError(null);
    const data = await post<{ worries: WorryUi[]; offered: string[] }>(
      "/api/setup/grid/worries",
      {
        brand: a.brand, category: a.category,
        audience: a.audience || undefined,
        base: st.moderators,
        scenarios: st.scenarios,
        keptStages: st.keptStages,
      }
    );
    a.setBusy(null);
    if (!data) return null;
    const next: GridState = { ...st, worryPool: data.worries, worryOffered: data.offered };
    a.setState(next);
    return next;
  }

  /** Value lines (2026-10-04): propose the line and one-tier-down
   * counterpart per room when the coverage step opens. Rooms the user
   * already set keep their edits; only rooms without an entry take the
   * engine's proposal. */
  async function loadValueLines(fresh?: GridState | null): Promise<GridState | null> {
    const st = fresh ?? a.state;
    if (!st || st.scenarios.length === 0 || st.scenarios.some((s) => !s.label.trim())) return st ?? null;
    const have = st.valueLines ?? {};
    // Drafts from before the chooser have lines for every room but no
    // catalog: fetch anyway (cached server side), keep the stored lines.
    if (st.scenarios.every((s) => s.label in have) && (st.valueCatalog?.length ?? 0) > 0) return st;
    const res = await fetch("/api/setup/grid/value_lines", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(a.setupId ? { "x-setup-id": a.setupId } : {}) },
      body: JSON.stringify({
        brand: a.brand, category: a.category, audience: a.audience || undefined,
        scenarios: st.scenarios.map((s) => ({ label: s.label, description: s.description })),
      }),
    }).catch(() => null);
    const data = res && res.ok ? ((await res.json().catch(() => null)) as { valueLines?: Record<string, ValueLineUi | null>; valueCatalog?: ValueCatalogLineUi[] } | null) : null;
    if (!data?.valueLines) return null;
    // Merge into the CURRENT state, never a captured one: this runs as a
    // background warm from the worries gate, and a stale `a.state` here
    // predates the worry pool - writing it back wiped the pool and dropped
    // the gate to its spinner (2026-10-07).
    const merge = (cur: GridState): GridState => {
      const merged: Record<string, ValueLineUi | null> = {};
      const recommended: Record<string, string | null> = { ...(cur.valueRecommended ?? {}) };
      for (const sc of cur.scenarios) {
        const have = cur.valueLines?.[sc.label];
        merged[sc.label] = have !== undefined ? have : (data.valueLines![sc.label] ?? null);
        if (!(sc.label in recommended)) recommended[sc.label] = data.valueLines![sc.label]?.line ?? null;
      }
      return { ...cur, valueLines: merged, valueRecommended: recommended, ...(data.valueCatalog?.length ? { valueCatalog: data.valueCatalog } : {}) };
    };
    let next: GridState | null = null;
    a.setState((cur) => { if (!cur) return cur; next = merge(cur); return next; });
    return next ?? merge(st);
  }

  /** Per-room defaults for kept situational stages the mask reaches
   * nowhere (the Business case case), judged BEFORE the coverage map is
   * offered (Tyler 2026-10-06: warmed on the worries gate, landed before
   * the map opens). Mirrors the CoverageGate effect, which stays as the
   * fallback for stages ticked on the map itself. */
  async function loadStageRooms(fresh?: GridState | null): Promise<GridState | null> {
    const st = fresh ?? a.state;
    if (!st || st.scenarios.length === 0 || st.scenarios.some((s) => !s.label.trim())) return st ?? null;
    const labels = st.scenarios.map((s) => s.label);
    const kept = new Set(st.keptStages);
    const todo = st.stages.filter((s) =>
      s.situational && s.key !== "pricing" && kept.has(s.key) &&
      !s.columns.some((c) => labels.includes(c)) && !st.stageRooms?.[s.key]
    );
    if (todo.length === 0) return st;
    const results = await Promise.all(todo.map(async (s) => {
      const res = await fetch("/api/setup/grid/stage_rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(a.setupId ? { "x-setup-id": a.setupId } : {}) },
        body: JSON.stringify({ brand: a.brand, category: a.category, stageKey: s.key, stageLabel: s.label, hint: s.hint ?? `${s.label} - ${s.why ?? ""}`, rooms: st.scenarios.map(({ label, description }) => ({ label, description })) }),
      }).catch(() => null);
      const d = res && res.ok ? ((await res.json().catch(() => null)) as { rooms?: string[] | null } | null) : null;
      return [s.key, d?.rooms ?? null] as const;
    }));
    const merge = (cur: GridState): GridState => {
      const stageRooms = { ...(cur.stageRooms ?? {}) };
      for (const [key, rooms] of results) {
        if (rooms && rooms.length > 0 && !stageRooms[key]) stageRooms[key] = rooms.filter((l) => cur.scenarios.some((sc) => sc.label === l));
      }
      return { ...cur, stageRooms };
    };
    let next: GridState | null = null;
    a.setState((cur) => { if (!cur) return cur; next = merge(cur); return next; });
    return next ?? merge(st);
  }

  /** Silent pool warm - fired while the user reviews the scenarios, so
   * the worries gate opens on a cache hit. */
  function warmWorries(fresh?: GridState | null): void {
    const st = fresh ?? a.state;
    if (!st || st.worryPool?.length) return;
    if (st.scenarios.length === 0 || st.scenarios.some((s) => !s.label.trim())) return;
    void fetch("/api/setup/grid/worries", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(a.setupId ? { "x-setup-id": a.setupId } : {}) },
      body: JSON.stringify({
        brand: a.brand, category: a.category,
        audience: a.audience || undefined,
        base: st.moderators, scenarios: st.scenarios,
        keptStages: st.keptStages,
        warm: true,
      }),
    }).catch(() => {});
  }

  /** Gate 2: one seed prompt per masked cell. */
  async function writeCells(): Promise<GridState | null> {
    if (!a.state) return null;
    // The wizard keys its narrated progress captions on this exact string.
    a.setBusy(CELLS_BUSY);
    a.setError(null);
    const data = await post<{ cells: Omit<GridCellUi, "phrasings">[]; missing?: { stage: string }[] }>(
      "/api/setup/grid/cells",
      {
        brand: a.brand, category: a.category, competitors: a.competitors, rosterRoles: a.rosterRoles,
        rosterClasses: a.rosterClasses,
        audience: a.audience || undefined,
        base: a.state.moderators,
        scenarios: a.state.scenarios,
        stageKeys: effectiveKeptStages(a.state),
        stageRooms: a.state.stageRooms,
        worries: a.state.worries,
        valueLines: a.state.valueLines,
        retryExhausted: true,
      }
    );
    a.setBusy(null);
    if (!data) return null;
    // Exhausted plan rows (2026-10-02): the battery shipped without them -
    // say so in the slot the step change KEEPS (goTo wipes setError), with
    // an action that works: the confirm click retries exhausted units.
    if (data.missing && data.missing.length > 0)
      (a.setNotice ?? a.setError)(
        `${data.missing.length} planned question${data.missing.length === 1 ? "" : "s"} could not be written - the rest are ready. Go back to the coverage step and confirm again to retry the missing one${data.missing.length === 1 ? "" : "s"}.`
      );
    const composed: GridCellUi[] = data.cells.map((c) => ({
      ...c, uid: cellUid(), original: c.text, phrasings: [],
    }));
    // Custom questions survive the recompose: re-append each after its
    // stage's fresh cells, dropping only those whose stage was unticked
    // or whose scenario no longer exists.
    const keptStages = new Set(a.state.keptStages);
    const activeLabels = new Set(a.state.scenarios.map((sc) => sc.label));
    const customs = a.state.cells.filter(
      (c) =>
        c.custom &&
        keptStages.has(c.stage) &&
        (c.situation === null || activeLabels.has(c.situation))
    );
    const cells = [...composed];
    for (const c of customs) {
      const last = cells.map((q, j) => (q.stage === c.stage ? j : -1)).reduce((m, j) => Math.max(m, j), -1);
      cells.splice(last >= 0 ? last + 1 : cells.length, 0, c);
    }
    const next: GridState = {
      ...a.state,
      step: "cells",
      baselineCellCount: composed.length,
      cells,
    };
    a.setState(next);
    return next;
  }

  /** Gate 3: paraphrase sets, in small batches so no request runs long.
   * `from` lets a caller holding a newer state (a just-applied review)
   * write from it instead of this closure's render-time snapshot. */
  async function writePhrasings(
    force = false, onlyMissing = false, from?: GridState
  ): Promise<GridState | null> {
    const st = from ?? a.state;
    if (!st) return null;
    a.setError(null);
    // Blanked cards keep their place in the grid - the write just skips
    // them (they ship nothing either way; create() filters on text).
    const liveIdx = st.cells
      .map((c, i) => (c.text.trim() ? i : -1))
      .filter((i) => i >= 0);
    const cells = liveIdx.map((i) => st.cells[i]);
    // onlyMissing fills gaps (cells whose prompt changed after the first
    // write) without touching sets the user may have edited by hand.
    const merged: GridCellUi[] = cells.map((c) =>
      onlyMissing && c.phrasings.some((p) => p.text.trim()) ? c : { ...c, phrasings: [] }
    );
    const batches: { layer: string; idx: number[] }[] = [];
    for (const layer of LAYERS) {
      const idx = merged
        .map((c, i) => (c.layer === layer && !c.phrasings.some((p) => p.text.trim()) ? i : -1))
        .filter((i) => i >= 0);
      for (let k = 0; k < idx.length; k += PHRASING_BATCH) {
        batches.push({ layer, idx: idx.slice(k, k + PHRASING_BATCH) });
      }
    }
    // All batches in flight at once - each is its own serverless call, so
    // wall time is the slowest batch, not the sum.
    const total = batches.reduce((n, b) => n + b.idx.length, 0);
    let done = 0;
    const startedAt = Date.now();
    a.setBusy(`${phrasingCaption(startedAt)} (0/${total})`);
    const outcomes = await Promise.all(
      batches.map(async ({ idx }) => {
        const data = await post<{ phrasings: GridPhrasing[][] }>(
          "/api/setup/grid/phrasings",
          {
            brand: a.brand, category: a.category, competitors: a.competitors, rosterRoles: a.rosterRoles,
            audience: a.audience || undefined,
            base: st.moderators,
            scenarios: st.scenarios,
            cells: idx.map((i) => ({
              stage: merged[i].stage,
              situation: merged[i].situation,
              angle: merged[i].angle,
              mode: merged[i].mode ?? null,
              text: merged[i].text,
              spec: merged[i].spec ?? undefined,
              concern: merged[i].concern ?? undefined,
              ...classFields(merged[i]),
            })),
            count: PHRASING_COUNT,
            avoidConcerns: [...new Set((a.state?.cells ?? []).map((x) => x.concern).filter((x): x is string => !!x))],
            force,
          }
        );
        if (!data) return false;
        idx.forEach((i, k) => {
          merged[i] = {
            ...merged[i],
            // Each paraphrase carries its machine wording as the baseline
            // the edit-review compares against; the cell remembers which
            // seed wording this set belongs to.
            phrasings: (data.phrasings[k] ?? []).map((ph) => ({ ...ph, original: ph.text })),
            phrasingsOffered: (data.phrasings[k] ?? []).map((ph) => ph.text),
            phrasedFor: merged[i].text,
          };
        });
        done += idx.length;
        a.setBusy(`${phrasingCaption(startedAt)} (${done}/${total})`);
        return true;
      })
    );
    a.setBusy(null);
    if (outcomes.some((ok) => !ok)) return null;
    // Land ONLY what this run generated, functionally by uid: edits made
    // to other cells (or other sets) during the write survive, and a
    // set written for a since-edited cell carries phrasedFor so the
    // stale-edit machinery treats it honestly.
    const generatedIdx = new Set(batches.flatMap((b) => b.idx));
    const writtenByUid = new Map<string, { phrasings: GridPhrasing[]; text: string }>();
    for (const k of generatedIdx) {
      const m = merged[k];
      if (m.uid) writtenByUid.set(m.uid, { phrasings: m.phrasings, text: m.text });
    }
    a.setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        step: "phrasings",
        cells: prev.cells.map((q) => {
          const w = q.uid ? writtenByUid.get(q.uid) : undefined;
          return w ? { ...q, phrasings: w.phrasings, phrasedFor: w.text } : q;
        }),
      };
    });
    const nextCells = st.cells.map((c, i) => {
      const k = liveIdx.indexOf(i);
      return k >= 0 ? merged[k] : c;
    });
    return { ...st, step: "phrasings", cells: nextCells };
  }

  /** Top up cells sitting below the quota without touching what they
   * hold: a fresh force draw per short cell, merged in minus near-twins
   * of anything kept. Cells at zero are the missing-fill's job, not
   * this one's. */
  async function topUpPhrasings(from?: GridState): Promise<GridState | null> {
    const st = from ?? a.state;
    if (!st) return null;
    const countIn = (c: GridCellUi) => 1 + c.phrasings.filter((p) => p.text.trim()).length;
    // Empty cells are included: a cell with ZERO paraphrases is almost
    // always one whose write RESPONSE was lost while the server finished
    // and cached the set ("finished work is kept") - excluding them left
    // the footer's only button unable to heal exactly that cell.
    const idx = st.cells
      .map((c, i) => (c.text.trim() && countIn(c) < PHRASING_COUNT ? i : -1))
      .filter((i) => i >= 0);
    if (idx.length === 0) return st;
    a.setError(null);
    let done = 0;
    a.setBusy(`Topping up prompts… (0/${idx.length})`);
    const merged = [...st.cells];
    await Promise.all(
      idx.map(async (i) => {
        const c = st.cells[i];
        const data = await post<{ phrasings: GridPhrasing[][] }>("/api/setup/grid/phrasings", {
          brand: a.brand, category: a.category, competitors: a.competitors, rosterRoles: a.rosterRoles,
          audience: a.audience || undefined,
          base: st.moderators, scenarios: st.scenarios,
          cells: [{ stage: c.stage, situation: c.situation, angle: c.angle, mode: c.mode ?? null, text: c.text, spec: c.spec ?? undefined, concern: c.concern ?? undefined, ...classFields(c) }],
          avoidConcerns: [...new Set((a.state?.cells ?? []).map((x) => x.concern).filter((x): x is string => !!x))],
          count: PHRASING_COUNT,
          // A SHORT set must force: the cache holds the same short set that
          // created the gap. An EMPTY cell must NOT force: its completed
          // set is (almost always) already cached from the write whose
          // response was lost - the non-forced read retrieves it for free.
          force: c.phrasings.some((p) => p.text.trim()),
        });
        if (data) {
          const kept = [...c.phrasings];
          const have = () => [c.text, ...kept.filter((p) => p.text.trim()).map((p) => p.text)];
          for (const ph of data.phrasings[0] ?? []) {
            if (1 + kept.filter((p) => p.text.trim()).length >= PHRASING_COUNT) break;
            if (have().some((t) => similarText(t, ph.text))) continue;
            kept.push({ ...ph, original: ph.text });
          }
          merged[i] = {
            ...merged[i], phrasings: kept, phrasedFor: merged[i].text,
            phrasingsOffered: [...new Set([...(merged[i].phrasingsOffered ?? []), ...kept.map((p) => p.original ?? p.text)])],
          };
        }
        done++;
        a.setBusy(`Topping up prompts… (${done}/${idx.length})`);
      })
    );
    a.setBusy(null);
    // Functional by uid, so edits elsewhere during the top-up survive.
    const toppedByUid = new Map<string, GridCellUi>();
    idx.forEach((i) => {
      const m = merged[i];
      if (m !== st.cells[i] && m.uid) toppedByUid.set(m.uid, m);
    });
    a.setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cells: prev.cells.map((q) => {
          const m = q.uid ? toppedByUid.get(q.uid) : undefined;
          return m ? { ...q, phrasings: m.phrasings, phrasedFor: m.phrasedFor } : q;
        }),
      };
    });
    return { ...st, cells: merged };
  }

  /** The cell's offered-prompt history, capturing a live manual edit into
   * its current slot so cycling never loses the user's wording. */
  function cellHistory(c: GridCellUi): { alts: string[]; idx: number } {
    const alts = c.alts && c.alts.length > 0 ? [...c.alts] : [c.text];
    const idx = Math.min(c.altIdx ?? 0, alts.length - 1);
    if (c.text.trim() && c.text !== alts[idx]) alts[idx] = c.text;
    return { alts, idx };
  }

  /** Gate 2 helper: a genuinely new prompt for one cell (not a paraphrase),
   * avoiding everything already offered. On-demand only - no prefetch - but
   * each draw is cached server-side, so revisits and other users are free.
   * Once the paraphrases have been written, the draw brings its own set
   * along too - the new prompt arrives complete, no missing-fill dance. */
  async function regenerateCell(i: number, near = false): Promise<void> {
    if (!a.state) return;
    const c = a.state.cells[i];
    if (!c) return;
    if (near ? (c.nears ?? 0) >= MAX_VARIANTS : (c.regens ?? 0) >= MAX_REGENS) return;
    const { alts } = cellHistory(c);
    // No global busy: the card shows its own writing state, the rest of
    // the gate stays usable.
    a.setError(null);
    const data = await post<{ text: string; spec?: CellCheckSpec }>("/api/setup/grid/cell", {
      brand: a.brand, category: a.category, competitors: a.competitors, rosterRoles: a.rosterRoles,
      audience: a.audience || undefined,
      base: a.state.moderators,
      scenarios: a.state.scenarios,
      cell: { stage: c.stage, situation: c.situation, angle: c.angle, mode: c.mode ?? null, concern: c.concern ?? undefined, valueLine: c.valueLine ?? undefined, ...classFields(c) },
      avoid: alts,
      // Near mode keeps this prompt's ask and moves one detail.
      nearTo: near ? c.text : undefined,
      // r26: a fresh draw of a room-pinned pain or outcome must not land
      // on a neighbor room's subject - send the stage's other seeds.
      siblings: !near && c.situation && (c.stage === "problem_recognition" || c.stage === "use_case")
        ? a.state.cells.filter((x) => x.stage === c.stage && x.situation && x.situation !== c.situation && x.text.trim()).map((x) => x.text.trim()).slice(0, 8)
        : undefined,
    });
    if (!data) return;
    let generated: GridPhrasing[] = [];
    if (a.state.step === "phrasings") {
      const pd = await post<{ phrasings: GridPhrasing[][] }>("/api/setup/grid/phrasings", {
        brand: a.brand, category: a.category, competitors: a.competitors, rosterRoles: a.rosterRoles,
        audience: a.audience || undefined,
        base: a.state.moderators,
        scenarios: a.state.scenarios,
        cells: [{ stage: c.stage, situation: c.situation, angle: c.angle, mode: c.mode ?? null, text: data.text, spec: data.spec, concern: c.concern ?? undefined, ...classFields(c) }],
        avoidConcerns: [...new Set((a.state?.cells ?? []).map((x) => x.concern).filter((x): x is string => !!x))],
        count: PHRASING_COUNT,
      });
      // A failed set is not fatal - the missing-paraphrases gate catches it.
      generated = (pd?.phrasings?.[0] ?? []).map((ph) => ({ ...ph, original: ph.text }));
    }
    // Functional, keyed by uid: the draw lands on THIS cell in whatever
    // state the grid is in by now - edits, adds, and deletions made
    // during the generation survive, and a deleted cell is a no-op.
    const uid = c.uid;
    a.setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cells: prev.cells.map((q) => {
          if (q.uid !== uid) return q;
          const { alts } = cellHistory(q);
          const nextAlts = [...alts, data.text];
          // The old set is banked under the old wording, not thrown away;
          // the freshly generated set (when the write already ran) wins
          // over whatever the bank holds for the new text.
          const swap = swapPhrasings(q, data.text);
          return {
            ...q,
            text: data.text,
            original: data.text,
            // A fresh draw replaces whatever wording the flag described.
            seedFlags: undefined,
            spec: data.spec ?? q.spec,
            alts: nextAlts,
            altIdx: nextAlts.length - 1,
            regens: near ? q.regens : (q.regens ?? 0) + 1,
            nears: near ? (q.nears ?? 0) + 1 : q.nears,
            phrasingsByText: swap.phrasingsByText,
            phrasings: generated.length > 0 ? generated : swap.phrasings,
            phrasingsOffered: generated.length > 0 ? generated.map((p) => p.original ?? p.text) : swap.phrasingsOffered,
            phrasedFor: data.text,
          };
        }),
      };
    });
  }

  /** Mint one NEW question in a stage (the "Suggest another" of the
   * Prompts step): generic/blind identity, distinct from the stage's
   * existing prompts, inserted after them - and in phase 2 it arrives
   * with its paraphrase set, like every other draw. */
  async function suggestCell(
    stageKey: string,
    situation: string | null,
    angle = "generic"
  ): Promise<void> {
    if (!a.state) return;
    const stage = a.state.stages.find((x) => x.key === stageKey);
    if (!stage) return;
    const existing = a.state.cells.filter((c) => c.stage === stageKey);
    // Avoid everything this stage has ever shown - including wordings the
    // user cycled away from - so a suggestion can't re-mint a rejected ask.
    const avoid = [
      ...new Set(
        existing
          .flatMap((c) => (c.alts?.length ? c.alts : [c.text]))
          .map((t) => t.trim())
          .filter(Boolean)
      ),
    ].slice(-8);
    a.setError(null);
    const data = await post<{ text: string; spec?: CellCheckSpec }>("/api/setup/grid/cell", {
      brand: a.brand, category: a.category, competitors: a.competitors, rosterRoles: a.rosterRoles,
      audience: a.audience || undefined,
      base: a.state.moderators,
      scenarios: a.state.scenarios,
      cell: { stage: stageKey, situation, angle, mode: null },
      avoid: avoid.length > 0 ? avoid : ["(no prompts yet)"],
    });
    if (!data) return;
    // The suggestion lands SEED-ONLY (2026-09-29, Tyler): paying for its
    // full paraphrase set at click time made "Suggest another" hang for
    // the whole pipeline and billed sets for suggestions the user might
    // delete. The card shows as missing its paraphrases and the existing
    // missing-prompts flow writes them at confirm (or the write-missing
    // click) - same path as any short cell.
    const cell: GridCellUi = {
      uid: cellUid(),
      custom: true,
      stage: stageKey,
      layer: stage.layer,
      situation,
      angle,
      mode: null,
      text: data.text,
      original: data.text,
      spec: data.spec ?? null,
      phrasings: [],
    };
    // Functional insert: concurrent edits made during the generation stay.
    a.setState((prev) => {
      if (!prev) return prev;
      const cells = [...prev.cells];
      const last = cells.map((c, j) => (c.stage === stageKey ? j : -1)).reduce((m, j) => Math.max(m, j), -1);
      cells.splice(last >= 0 ? last + 1 : cells.length, 0, cell);
      return { ...prev, cells };
    });
  }

  /** Insert an empty user-written question into a stage (pure client). */
  function addOwnCell(
    state: GridState,
    stageKey: string,
    situation: string | null,
    angle = "generic"
  ): GridState {
    const stage = state.stages.find((x) => x.key === stageKey);
    if (!stage) return state;
    const cell: GridCellUi = {
      uid: cellUid(),
      custom: true,
      stage: stageKey,
      layer: stage.layer,
      situation,
      angle,
      mode: null,
      text: "",
      // A spec-era cell from birth: the server re-derives its design from
      // whatever the user types, so the empty-seed copy is only a marker.
      spec: deriveCheckSpec({ stage: stageKey, angle, text: "" }, a.brand, sameSeatOf(a.competitors, a.rosterRoles), a.category),
      phrasings: [],
    };
    const cells = [...state.cells];
    const last = cells.map((c, j) => (c.stage === stageKey ? j : -1)).reduce((m, j) => Math.max(m, j), -1);
    cells.splice(last >= 0 ? last + 1 : cells.length, 0, cell);
    return { ...state, cells };
  }

  /** Cycle a cell through its offered prompts (pure client, instant). */
  function cycleCell(i: number, dir: 1 | -1): void {
    if (!a.state) return;
    const c = a.state.cells[i];
    if (!c) return;
    const { alts, idx } = cellHistory(c);
    if (alts.length < 2) return;
    const next = (idx + dir + alts.length) % alts.length;
    // Remember which banked wordings are the user's own: cycling back to
    // one keeps it under review (original unchanged) instead of promoting
    // it to the machine baseline unchecked.
    const userAlts = new Set(c.userAlts ?? []);
    if (c.text.trim() && c.original != null && c.text !== c.original) userAlts.add(c.text);
    const cycledToUser = userAlts.has(alts[next]);
    a.setState({
      ...a.state,
      cells: a.state.cells.map((q, j) =>
        j === i
          // A cycled-to MACHINE wording becomes the accepted baseline; its
          // paraphrases come back from the bank when it has been written
          // before - cycling back is free.
          ? {
              ...q, text: alts[next],
              original: cycledToUser ? q.original : alts[next],
              // The flag described the wording being cycled away from.
              seedFlags: undefined,
              // Keep the carried spec in step with the wording it describes.
              spec: q.spec ? deriveCheckSpec({ ...q, text: alts[next] }, a.brand, sameSeatOf(a.competitors, a.rosterRoles), a.category) : q.spec,
              alts, altIdx: next, userAlts: [...userAlts],
              ...swapPhrasings(q, alts[next]),
            }
          : q
      ),
    });
  }

  /* ------------------------- cache warmers ------------------------------
   * Fire-and-forget copies of the requests the NEXT gate will make, sent
   * while the user is still reading the current one - the click then hits
   * the server cache. Silent by design: a failed warm costs nothing. */

  function warmRead(category?: string, audience?: string): void {
    const cat = (category ?? a.category).trim();
    if (!cat) return;
    void fetch("/api/setup/grid/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(a.setupId ? { "x-setup-id": a.setupId } : {}) },
      body: JSON.stringify({ brand: a.brand, category: cat, audience: (audience ?? a.audience) || undefined, warm: true }),
    }).catch(() => {});
  }

  function warmCells(fresh?: GridState | null): void {
    const st = fresh ?? a.state;
    if (!st || st.keptStages.length === 0 || st.scenarios.length === 0) return;
    if (st.scenarios.some((s) => !s.label.trim())) return;
    void fetch("/api/setup/grid/cells", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(a.setupId ? { "x-setup-id": a.setupId } : {}) },
      body: JSON.stringify({
        brand: a.brand, category: a.category, competitors: a.competitors, rosterRoles: a.rosterRoles,
        rosterClasses: a.rosterClasses,
        audience: a.audience || undefined,
        base: st.moderators, scenarios: st.scenarios, stageKeys: effectiveKeptStages(st), stageRooms: st.stageRooms,
        worries: st.worries,
        valueLines: st.valueLines,
        warm: true,
      }),
    })
      .then(async (r) => {
        if (!r.ok) return;
        // The cells exist the moment this warm returns - start their
        // paraphrases cooking too, buying the write the whole coverage-
        // review window on top of the prompts-review window.
        const data = (await r.json().catch(() => null)) as { cells?: GridCellUi[] } | null;
        if (!data?.cells?.length) return;
        warmPhrasings({ ...st, cells: data.cells.map((c) => ({ ...c, phrasings: [] })) });
      })
      .catch(() => {});
  }

  function warmPhrasings(fresh?: GridState | null): void {
    const st = fresh ?? a.state;
    if (!st) return;
    const cells = st.cells.filter((c) => c.text.trim());
    if (cells.length === 0) return;
    // Once every question has its set, there is nothing left to warm.
    if (cells.every((c) => c.phrasings.some((p) => p.text.trim()))) return;
    for (const layer of LAYERS) {
      const idx = cells.map((c, i) => (c.layer === layer ? i : -1)).filter((i) => i >= 0);
      for (let k = 0; k < idx.length; k += PHRASING_BATCH) {
        const slice = idx.slice(k, k + PHRASING_BATCH);
        void fetch("/api/setup/grid/phrasings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(a.setupId ? { "x-setup-id": a.setupId } : {}) },
          body: JSON.stringify({
            brand: a.brand, category: a.category, competitors: a.competitors, rosterRoles: a.rosterRoles,
            audience: a.audience || undefined,
            base: st.moderators, scenarios: st.scenarios,
            cells: slice.map((i) => ({
              stage: cells[i].stage, situation: cells[i].situation,
              angle: cells[i].angle, mode: cells[i].mode ?? null, text: cells[i].text,
              spec: cells[i].spec ?? undefined,
              // The warm must key exactly like the write: concern and class
              // ride in the paraphrase cache key (the concern was missing,
              // so warms filled a key the write never read).
              concern: cells[i].concern ?? undefined,
              ...classFields(cells[i]),
            })),
            count: PHRASING_COUNT,
            avoidConcerns: [...new Set((a.state?.cells ?? []).map((x) => x.concern).filter((x): x is string => !!x))],
            warm: true,
          }),
        }).catch(() => {});
      }
    }
  }

  /** Undo a forBrand rebuild: reinstate the scenario view (rows and
   * reserve pool) that was in hand before it. Pure-code recompose - the
   * base was never changed by the rebuild, so nothing else moves. */
  function restoreCategoryView(): void {
    const pr = a.state?.preRebuild;
    if (!a.state || !pr) return;
    void compose({
      base: a.state.moderators,
      rows: pr.rows,
      cells: a.state.cells,
      reserve: pr.reserve,
      preRebuild: null,
      // The brand view as left, edits and all - the way back in.
      brandView: { rows: scenarioRows(a.state), reserve: a.state.reserve },
    });
  }

  /** "Rebuild around <brand>": a stashed brand view comes back as left
   * (pure-code recompose, no read); only a first visit does the fresh
   * brand-aware read. The category view is stashed either way. */
  function rebuildForBrand(): void {
    const bv = a.state?.brandView;
    if (!a.state || !bv) { void compose(undefined, true); return; }
    void compose({
      base: a.state.moderators,
      rows: bv.rows,
      cells: a.state.cells,
      reserve: bv.reserve,
      preRebuild: { rows: scenarioRows(a.state), reserve: a.state.reserve },
      brandView: null,
    });
  }

  return {
    compose, writeCells, writePhrasings, topUpPhrasings, suggestScenario, nearScenario, rewordScenario, rebuildForBrand,
    suggestCell, addOwnCell,
    warmRead, warmCells, warmPhrasings,
    fetchWorries, warmWorries, loadValueLines, loadStageRooms,
    regenerateCell, cycleCell, restoreCategoryView,
  };
}

/* -------------------------------- views --------------------------------- */

function stageOf(state: GridState, key: string): GridStage | undefined {
  return state.stages.find((s) => s.key === key);
}

export function cellMeta(state: GridState, c: GridCellUi): string {
  return (
    (stageOf(state, c.stage)?.label ?? c.stage) +
    (c.situation ? ` · ${c.situation}` : "") +
    (c.angle !== "generic" ? ` · ${angleLabel(c)}` : "") +
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
/** The contest check's verdict for one room (/api/setup/grid/rooms). */
interface RoomCheckUi {
  label: string;
  contenders: string[];
  rivals: number;
  /** Contenders among the judged pool / the pool's size - the numbers
   * behind `contested` (head-to-head picks when picks exist). */
  inPool?: number;
  pool?: number;
  contested: boolean;
  pitch: string;
  names: string[];
  capability?: boolean;
  platformSwitch?: boolean;
  noChoice?: boolean;
  /** Other rooms in the checked set that ask this room's question. */
  sameAs?: string[];
  decides?: string;
  /** Batch 2: the client is among the room's contenders; the room is built on its strength. */
  clientIn?: boolean;
  clientLead?: boolean;
}

export function ScenariosGate({
  state, setState, onRecompose, onRecomposeBase, onSuggestScenario, onAddReserve, onNearScenario, onRewordScenario, onWarmReview, busy,
  maxScenarios = MAX_SCENARIOS, readDelta, fitBrand, fitCategory, onRebuildForBrand,
  onBackToCategory, rivals, picks, setupId,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  /** The tracker's DIRECT rivals (same_seat + bench) - the contest check
   * asks which of them compete in each room (init decision 4). Omit to
   * disable the chips. */
  rivals?: string[];
  /** The head-to-head picks - the contest bar reads them. */
  picks?: string[];
  /** Cost attribution header for the contest check. */
  setupId?: string;
  onRecompose: (base: GridState["moderators"], rows: ScenarioRow[], cells?: GridCellUi[]) => void;
  /** A "Your market buys" edit - same recompose, but the wizard narrates
   * what changed via `readDelta`. */
  onRecomposeBase: (base: GridState["moderators"], rows: ScenarioRow[]) => void;
  onSuggestScenario: () => void;
  /** Bring one of the market read's reserve rooms into the table. */
  onAddReserve?: (label: string) => void;
  /** Draw a near variant of card i - same circumstance, one detail moved. */
  onNearScenario: (i: number) => void;
  /** Same room in other words, never using the flagged phrases. */
  onRewordScenario?: (i: number, avoid: string[]) => void;
  /** Silent cache warm for the confirm-time quality check - fired on
   * field blur so the confirm usually lands on a cached verdict. */
  onWarmReview?: () => void;
  busy: boolean;
  /** The plan's scenario cap (PLAN_SCENARIO_CAPS). */
  maxScenarios?: number;
  /** What the last base-read edit changed downstream, or null. */
  readDelta?: string | null;
  /** Brand + category for the portfolio-fit advisory; omit to disable. */
  fitBrand?: string;
  fitCategory?: string;
  /** Rebuild the scenario read brand-aware - offered when the advisory
   * finds the shared category read gave this brand rooms it can't win. */
  onRebuildForBrand?: () => void;
  /** Undo a forBrand rebuild - restores the category scenario view. */
  onBackToCategory?: () => void;
}) {
  // ONE-SHOT advisory: computed with the compose, shown for the set as
  // composed, never refetched on edits - accepting its suggestion must
  // not conjure a successor (Tyler: guarding user scenario edits is out
  // of scope). Flag lines self-retire as their rows are unticked, and
  // the missing line retires once its row exists.
  const fit = state.fit ?? null;
  const [fitDismissed, setFitDismissed] = useState(false);
  const journeyFit = state.journeyFit ?? null;
  const [journeyFitDismissed, setJourneyFitDismissed] = useState(false);
  // Advisory stage-adds live in GridState (survive step changes and
  // recomposes); Undo removes exactly these and no more - a coverage-map
  // tick the user made themselves is never touched.
  const journeyStageAdds = state.journeyStageAdds ?? {};
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
  const setRows = (next: ScenarioRow[], recompose = false, cells?: GridCellUi[]) => {
    if (recompose) onRecompose(state.moderators, next, (cells ?? state.cells).filter((c) => c.custom));
    else setState(withScenarioRows(cells ? { ...state, cells } : state, next));
  };
  const updateRow = (i: number, patch: Partial<ScenarioRow>, recompose = false) => {
    // A label edit renames the scenario - custom questions bound to it
    // follow the new wording instead of being orphaned.
    const cells =
      patch.label !== undefined ? rebindSituation(state.cells, rows[i].label, patch.label) : undefined;
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)), recompose, cells);
  };

  const fitFlags = fit
    ? [
        ...fit.offPortfolio.filter((f) =>
          active.some((r) => r.label.trim().toLowerCase() === f.label.trim().toLowerCase())
        ),
      ]
    : [];
  const fitMissing =
    fit?.missingCore &&
    !rows.some((r) => r.label.trim().toLowerCase() === fit.missingCore!.label.trim().toLowerCase())
      ? fit.missingCore
      : null;
  // Contest check (init decision 4): which direct rivals compete in each
  // room, any one-brand pitch wording, any tracked brand a room names.
  // Debounced on the room text; cached server-side per room, so editing
  // one card re-checks only that card.
  const roomKey = (r: { label: string; description: string }) => `${r.label.trim()}|${r.description.trim()}`;
  const [roomChecks, setRoomChecks] = useState<Record<string, RoomCheckUi>>({});
  // Ticked rows first, then the rest, then the advisory's suggestion - the
  // route caps the list, so the rooms in the grid are never the ones cut.
  const reserveRooms = (state.reserve ?? []).filter(
    (s) => s.label.trim() && !rows.some((r) => r.label.trim().toLowerCase() === s.label.trim().toLowerCase())
  );
  const checkRooms = [
    ...rows.filter((r) => r.on && r.label.trim()),
    ...rows.filter((r) => !r.on && r.label.trim()),
    ...(fitMissing ? [{ label: fitMissing.label, description: fitMissing.description }] : []),
    ...reserveRooms,
  ].map((r) => ({ label: r.label.trim(), description: r.description.trim() })).slice(0, 16);
  const checkSig = rivals && fitBrand && fitCategory
    ? JSON.stringify([fitBrand, fitCategory, rivals, checkRooms, picks ?? []])
    : "";
  // The check fires on field BLUR, never on keystrokes: it used to debounce
  // on the room text, so every pause while typing a description was a new
  // room, a server cache miss and a model call (2026-10-04).
  const [editingRoom, setEditingRoom] = useState(false);
  // "Say it differently": which card has the phrase-to-avoid field open.
  const [rewordFor, setRewordFor] = useState<{ i: number; avoid: string } | null>(null);
  useEffect(() => {
    if (!checkSig || editingRoom) return;
    const [brand, category, rv, rooms, pk] = JSON.parse(checkSig) as [string, string, string[], { label: string; description: string }[], string[]];
    if (rooms.length === 0) return;
    const t = setTimeout(() => {
      void fetch("/api/setup/grid/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(setupId ? { "x-setup-id": setupId } : {}) },
        body: JSON.stringify({ brand, category, rivals: rv, picks: pk, rooms }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { checks?: RoomCheckUi[] } | null) => {
          if (!d?.checks) return;
          const next: Record<string, RoomCheckUi> = {};
          d.checks.forEach((c) => {
            const room = rooms.find((x) => x.label === c.label.trim());
            if (room) next[roomKey(room)] = c;
          });
          setRoomChecks((prev) => ({ ...prev, ...next }));
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [checkSig, setupId, editingRoom]);
  /** Every flag a room's check raised, worst first; empty when it passes. */
  const roomFlags = (c: RoomCheckUi): { text: string; title: string }[] => {
    const who = c.contenders.length > 0 ? c.contenders.join(", ") : "none of your rivals";
    const out: { text: string; title: string }[] = [];
    if (c.names.length > 0)
      out.push({ text: `Names ${c.names.join(", ")}`, title: "Describe the buyer's situation - a room that names a brand answers its own questions." });
    if (c.capability)
      out.push({ text: "A feature, not a situation", title: "This buyer is defined by what they value in the product, not by their situation - every question in its column would ask about that one thing." });
    if (c.noChoice)
      out.push({ text: "No real choice made here", title: "The buyer here barely chooses (a default, an auto-renew, whatever is in stock) - there is little for an answer to steer." });
    if (c.platformSwitch)
      out.push({ text: "Platform switch locks out a rival", title: "A switch between platforms forces each question to state a direction, which rules a leading brand out of the whole column." });
    if (c.clientLead)
      out.push({ text: "Built on your strength", title: "This room is built on what your brand is known for, so your brand is the obvious answer by construction - the column would measure your pitch, not a contest. Try a near neighbor." });
    if (!c.contested && c.rivals > 0) {
      const pool = c.pool ?? c.rivals;
      const n = c.inPool ?? c.contenders.length;
      const of = c.pool !== undefined && c.pool !== c.rivals ? "head-to-head rivals" : "rivals";
      out.push({ text: `Few of your rivals compete here (${n} of ${pool} ${of})`, title: `Contenders: ${who}. A room your head-to-head rivals compete in measures a real contest - try a near neighbor, or keep it if the niche is deliberate.` });
    }
    if (c.pitch)
      out.push({ text: "Worded like a pitch", title: `"${c.pitch}" reads like one brand's pitch - describe the buyer's outcome instead.` });
    return out;
  };
  /** A suggested room that fails the room rule is never offered - and it
   * is held back until its check lands (it used to show, then vanish).
   * With no check possible (no roster yet) it shows at once. */
  const missingCheck = fitMissing ? roomChecks[roomKey(fitMissing)] : undefined;
  const fitMissingShown =
    fitMissing && (checkSig ? missingCheck !== undefined && roomFlags(missingCheck).length === 0 : true)
      ? fitMissing
      : null;
  const showFit = !fitDismissed && (fitFlags.length > 0 || fitMissingShown !== null);

  return (
    <div className="grid gap-3 max-w-4xl">
      <span className="text-sm font-semibold uppercase tracking-wide text-primary">
        How they generally decide
      </span>
      {(() => {
        // Only suggestions still unresolved: applying either resolution -
        // flipping the base, or ticking the stages on while keeping the
        // market view - retires its line (the stage route to an Undo row,
        // the flip for good: the pills themselves are its undo).
        const journeyFlags = (journeyFit?.suggestions ?? []).filter(
          (s) =>
            String(state.moderators[s.dimension] ?? "") !== s.suggested &&
            !((s.stagesIn?.length ?? 0) > 0 &&
              s.stagesIn!.every((st) => state.keptStages.includes(st.key)))
        );
        const journeyApplied = (journeyFit?.suggestions ?? []).filter(
          (s) =>
            journeyStageAdds[s.dimension] &&
            (s.stagesIn?.length ?? 0) > 0 &&
            s.stagesIn!.every((st) => state.keptStages.includes(st.key))
        );
        const pill = (dim: string, value: string) =>
          MODERATOR_FIELDS.find((f) => f.key === dim)?.options.find(([k]) => k === value)?.[1] ?? value;
        if (journeyFitDismissed || (journeyFlags.length === 0 && journeyApplied.length === 0)) return null;
        return (
          <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-[12px] text-amber-900 grid gap-1.5 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-700/50">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold">
                How {fitBrand} buyers may differ
              </span>
              <button
                type="button"
                onClick={() => setJourneyFitDismissed(true)}
                aria-label="Dismiss"
                className="leading-none opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </div>
            {journeyFlags.map((s) => {
              // The market-view resolution stays targeted: offered only
              // when the flip's stage delta is one or two stages -
              // anything wider is no longer a pointed suggestion. When
              // offered, it leads as the RECOMMENDED action (it keeps the
              // shared market read and is one Undo away); the base flip
              // is the quieter alternative.
              const addable = (s.stagesIn ?? []).slice(0, 2);
              const offerStages = (s.stagesIn?.length ?? 0) >= 1 && s.stagesIn!.length <= 2;
              const stageNames =
                addable.map((st) => st.label).join(" and ") +
                (addable.length > 1 ? " stages" : " stage");
              const addStages = () => {
                // The keptStages override - the same tick the coverage
                // map offers, so it survives recomposes. No model call,
                // no read change; remembered per dimension for Undo.
                const added = addable.filter((st) => !state.keptStages.includes(st.key));
                setState({
                  ...state,
                  keptStages: [...state.keptStages, ...added.map((st) => st.key)],
                  journeyStageAdds: { ...journeyStageAdds, [s.dimension]: added },
                });
              };
              return (
                <p key={s.dimension} className="m-0 flex flex-wrap items-center gap-2">
                  <span>{s.reason}</span>
                  {offerStages && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={addStages}
                      className="rounded-full bg-amber-400/80 px-2 py-0.5 font-semibold text-amber-950 hover:bg-amber-400 dark:bg-amber-500/80 dark:hover:bg-amber-500"
                    >
                      Keep the market view and add the {stageNames}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onRecomposeBase({ ...state.moderators, [s.dimension]: s.suggested }, rows)
                    }
                    className="rounded-full border border-amber-400/70 px-2 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  >
                    {offerStages ? `or set to ${pill(s.dimension, s.suggested)}` : `Set to ${pill(s.dimension, s.suggested)}`}
                  </button>
                </p>
              );
            })}
            {journeyApplied.map((s) => {
              const added = journeyStageAdds[s.dimension] ?? [];
              const names =
                added.map((st) => st.label).join(" and ") +
                (added.length > 1 ? " stages" : " stage");
              return (
                <p key={`applied-${s.dimension}`} className="m-0 flex flex-wrap items-center gap-2">
                  <span>
                    Added the {names} - the market read stays as it was.
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const keys = new Set(added.map((st) => st.key));
                      const next = { ...journeyStageAdds };
                      delete next[s.dimension];
                      setState({
                        ...state,
                        keptStages: state.keptStages.filter((k) => !keys.has(k)),
                        journeyStageAdds: next,
                      });
                    }}
                    className="rounded-full border border-amber-400/70 px-2 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  >
                    Undo
                  </button>
                </p>
              );
            })}
          </div>
        );
      })()}
      {/* Always visible: one COLUMN per dimension, its options stacked
       * vertically as uniform pills - the unselected never hide, and the
       * read is edited in place. */}
      <div className="flex flex-wrap gap-2">
        {MODERATOR_FIELDS.map((f) => (
          <fieldset key={f.key} className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-0.5 w-32 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-3">
              {f.header}
            </legend>
            {f.options.map(([k, label]) => {
              const selected = String(state.moderators[f.key] ?? "") === k;
              return (
                <label
                  key={k}
                  className={
                    "w-32 cursor-pointer rounded-full px-2 py-1 text-center text-[11px] font-medium " +
                    (selected
                      ? "bg-primary text-white"
                      : "bg-primary-soft text-primary hover:opacity-80")
                  }
                >
                  <input
                    type="radio"
                    name={`read-${f.key}`}
                    value={k}
                    checked={selected}
                    disabled={busy}
                    onChange={() =>
                      onRecomposeBase({ ...state.moderators, [f.key]: k }, rows)
                    }
                    className="sr-only"
                  />
                  {label}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      {readDelta && (
        <p className="text-[12px] text-primary font-medium">{readDelta}</p>
      )}
      <span className="mt-3 text-sm font-semibold uppercase tracking-wide text-primary">
        Who&apos;s generally buying
      </span>
      <p className="text-[12px] text-ink-2">
        Tick the scenarios worth measuring - each becomes a column of your
        Landscape.
      </p>
      {/* The rebuild is ALWAYS on offer, not just behind two off-portfolio
       * flags - the blind-vs-aware comparison (2026-09-16) showed the
       * brand-aware read finds rooms the category read cannot (Nest's
       * thermostats, Netflix's win-back). The banner keeps its own copy
       * of the link for the case where the set is clearly off. Inside the
       * brand view the line turns into the way back, so trying the
       * rebuild is a peek, never a commitment. */}
      {state.preRebuild && onBackToCategory ? (
        <p className="m-0 text-[12px] text-ink-3">
          These scenarios are rebuilt around {fitBrand} - occasions it
          competes in.{" "}
          <button
            type="button"
            disabled={busy}
            onClick={onBackToCategory}
            className="font-semibold text-primary hover:opacity-80 disabled:opacity-40"
          >
            Back to the category view
          </button>
        </p>
      ) : onRebuildForBrand && fitBrand ? (
        <p className="m-0 text-[12px] text-ink-3">
          These scenarios describe the category at large. You can also{" "}
          <button
            type="button"
            disabled={busy}
            onClick={onRebuildForBrand}
            className="font-semibold text-primary hover:opacity-80 disabled:opacity-40"
          >
            rebuild them around {fitBrand}
          </button>{" "}
          - a fresh read focused on occasions it competes in.
        </p>
      ) : null}
      {showFit && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-[12px] text-amber-900 grid gap-1.5 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-700/50">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">
              A few things you may want to look at
            </span>
            <button
              type="button"
              onClick={() => setFitDismissed(true)}
              aria-label="Dismiss"
              className="leading-none opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
          {fitFlags.map((f) => (
            <p key={f.label} className="m-0">
              <span className="font-medium">{f.label}:</span> {f.reason} You
              may want to swap this for a scenario {fitBrand} is stronger in.
            </p>
          ))}
          {fitFlags.length >= 2 && onRebuildForBrand && (
            <p className="m-0">
              If this set feels off for {fitBrand}, you could{" "}
              <button
                type="button"
                disabled={busy}
                onClick={onRebuildForBrand}
                className="font-semibold text-primary hover:opacity-80 disabled:opacity-40"
              >
                rebuild the scenarios around {fitBrand}
              </button>{" "}
              - a fresh read focused on occasions it competes in.
            </p>
          )}
          {fitMissingShown && (
            <p className="m-0">
              <span className="font-medium">You may wish to consider a {fitMissingShown.label.toLowerCase()} scenario:</span>{" "}
              {fitMissingShown.reason}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  // At the cap the row is added UNCHECKED - it joins the
                  // table for the user to weigh, never displacing a
                  // choice they made. Under the cap it goes live.
                  setRows(
                    [
                      ...rows,
                      {
                        label: fitMissingShown.label,
                        description: fitMissingShown.description,
                        journey: null,
                        suggested: true,
                        on: active.length < cap,
                        // Like "Suggest another": the card's home wording, so
                        // near-neighbor draws anchor on it and "Reset to
                        // suggested" returns to it (without these, reset
                        // kept the last draw - Pixel walk, 2026-10-02).
                        original: { label: fitMissingShown.label, description: fitMissingShown.description },
                        first: { label: fitMissingShown.label, description: fitMissingShown.description },
                      },
                    ],
                    active.length < cap
                  )
                }
                className="font-semibold text-primary hover:opacity-80 disabled:opacity-40"
              >
                {active.length < cap ? "Add it" : "Add it unchecked"}
              </button>
            </p>
          )}
        </div>
      )}
      <HowItWorks>
        <p className="m-0">
          A scenario is a circumstance that changes the right answer. The
          coverage map on the next step shows exactly what each will be
          asked.
        </p>
        <p className="m-0">
          Every scenario is asked in the buying style above unless it is
          marked as buying differently - a different style means that buyer
          goes through different stages, so its column gets its own set of
          questions.
        </p>
        <p className="m-0">
          One scenario per Landscape can buy differently: a second buyer
          with its own style isn&apos;t an exception, it&apos;s a second
          market - and gets its own Landscape, so each grid stays readable
          and every result traces to one kind of buyer.
        </p>
      </HowItWorks>
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
          <div className="flex items-center gap-2.5">
            <input
              type="checkbox"
              aria-label={sc.on ? "remove from grid" : "add to grid"}
              checked={sc.on}
              disabled={busy || (!sc.on && active.length >= cap)}
              title={
                !sc.on && active.length >= cap
                  ? `Your plan runs ${cap} buying scenarios - untick one to make room for this one`
                  : undefined
              }
              onChange={(e) => updateRow(i, { on: e.target.checked }, true)}
            />
            <input
              className="input w-56 shrink-0 text-sm font-medium"
              maxLength={60}
              value={sc.label}
              placeholder="label"
              onChange={(e) => updateRow(i, { label: e.target.value })}
              onFocus={() => setEditingRoom(true)}
              onBlur={() => {
                setEditingRoom(false);
                if (sc.on) onRecompose(state.moderators, rows);
                onWarmReview?.();
              }}
            />
          </div>
          <textarea
            className="input w-full resize-none field-sizing-content text-sm"
            rows={1}
            maxLength={240}
            value={sc.description}
            placeholder="one sentence describing the circumstance"
            onChange={(e) => updateRow(i, { description: e.target.value, circumstance: undefined })}
            onFocus={() => setEditingRoom(true)}
            onBlur={() => { setEditingRoom(false); onWarmReview?.(); }}
          />
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
          <div className="flex items-center gap-4 border-t border-dashed border-line pt-1.5 text-[11px]">
            {sc.label.trim() !== "" &&
              ((sc.variants ?? 0) < MAX_VARIANTS ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onNearScenario(i)}
                    title="Right idea, wrong details? Draw a close variant of this scenario"
                    className="font-medium text-primary hover:opacity-80 disabled:opacity-50"
                  >
                    ≈ Near neighbor
                  </button>
                  {(sc.variants ?? 0) > 0 && (
                    <span className="text-[10px] text-ink-3">
                      {MAX_VARIANTS - (sc.variants ?? 0)} left
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[10px] text-ink-3">
                  {MAX_VARIANTS} variations tried - edit the text above to make it yours
                </span>
              ))}
            {sc.label.trim() !== "" && onRewordScenario && (
              rewordFor?.i === i ? (
                <span className="flex items-center gap-1.5">
                  <input
                    className="input h-6 w-44 text-[11px]"
                    placeholder="phrase to avoid (optional)"
                    value={rewordFor.avoid}
                    autoFocus
                    onChange={(e) => setRewordFor({ i, avoid: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { onRewordScenario(i, rewordFor.avoid.split(",")); setRewordFor(null); }
                      if (e.key === "Escape") setRewordFor(null);
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { onRewordScenario(i, rewordFor.avoid.split(",")); setRewordFor(null); }}
                    className="font-medium text-primary hover:opacity-80 disabled:opacity-50"
                  >
                    Reword
                  </button>
                  <button type="button" onClick={() => setRewordFor(null)} className="text-ink-3 hover:opacity-80">Cancel</button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRewordFor({ i, avoid: "" })}
                  title="Same room, different words - and never a phrase you name (one that reads as a program, product or industry label)"
                  className="font-medium text-primary hover:opacity-80 disabled:opacity-50"
                >
                  ✎ Say it differently
                </button>
              )
            )}
            {(() => {
              const c = roomChecks[roomKey(sc)];
              if (!c || !sc.label.trim()) return null;
              const flags = roomFlags(c);
              if (flags.length > 0)
                return (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {flags.map((f) => (
                      <span key={f.text} className="text-warning" title={f.title}>{f.text}</span>
                    ))}
                  </span>
                );
              if (c.rivals === 0) return null;
              const who = c.contenders.length > 0 ? c.contenders.join(", ") : "none of your rivals";
              const pool = c.pool ?? c.rivals;
              const n = c.inPool ?? c.contenders.length;
              return (
                <span className="text-ink-3" title={`Contenders: ${who}`}>
                  Contested: {n} of {pool} {pool !== c.rivals ? "head-to-head rivals" : "rivals"}
                </span>
              );
            })()}
            <label
              className="flex items-center gap-1.5 text-ink-3 whitespace-nowrap"
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
            {!sc.suggested && (
              <button
                type="button"
                aria-label="delete scenario"
                onClick={() => setRows(rows.filter((_, j) => j !== i), true)}
                className="ml-auto text-ink-3 hover:text-danger text-[15px] leading-none"
              >
                ×
              </button>
            )}
          </div>
        </div>
      ))}
      {reserveRooms.length > 0 && onAddReserve && (
        <ReserveFold
          rooms={reserveRooms}
          flagsOf={(r) => { const c = roomChecks[roomKey(r)]; return c ? roomFlags(c) : []; }}
          atCap={active.length >= cap}
          busy={busy}
          onAdd={onAddReserve}
        />
      )}
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
          onClick={() => {
            // Back to the compose-time originals; pools survive so the
            // three near-neighbor draws are available again, instantly.
            // Custom questions follow each reverting label.
            let cells = state.cells;
            const nextRows = rows
              .filter((r) => r.suggested)
              .map((r, i) => {
                const home = r.first ?? r.original ?? { label: r.label, description: r.description };
                if (home.label !== r.label) cells = rebindSituation(cells, r.label, home.label);
                return {
                  ...r, ...home,
                  original: { ...home },
                  journey: null, on: i < cap, variants: 0,
                };
              });
            setRows(nextRows, true, cells);
          }}
          className="text-[13px] font-medium text-ink-3 hover:text-ink"
        >
          Reset to suggested
        </button>
      </div>
    </div>
  );
}

/** The market read's alternates (2026-10-04): the rooms the read ranked
 * behind the core set, shown as a fold instead of hidden behind "Suggest
 * another" - the user sees the whole set the read produced and swaps
 * deliberately. Each card carries its contest chips like a live row. */
function ReserveFold({ rooms, flagsOf, atCap, busy, onAdd }: {
  rooms: { label: string; description: string }[];
  flagsOf: (r: { label: string; description: string }) => { text: string; title: string }[];
  atCap: boolean;
  busy: boolean;
  onAdd: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-fit text-[12px] font-medium text-ink-3 hover:text-ink"
      >
        {open ? "▾" : "▸"} {rooms.length} more {rooms.length === 1 ? "room" : "rooms"} we considered
      </button>
      {open && rooms.map((r) => {
        const flags = flagsOf(r);
        return (
          <div key={r.label} className="rounded-lg border border-dashed border-line bg-surface px-4 py-2.5 grid gap-1 opacity-80">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{r.label}</span>
              <span className="flex-1" />
              <button
                type="button"
                disabled={busy}
                onClick={() => onAdd(r.label)}
                title={atCap ? "Added unticked - untick a scenario above to bring it into the grid" : "Add to the grid"}
                className="text-[12px] font-medium text-primary hover:opacity-80 disabled:opacity-50"
              >
                {atCap ? "Add unticked" : "Add"}
              </button>
            </div>
            <span className="text-[12px] text-ink-3">{r.description}</span>
            {flags.length > 0 && (
              <span className="flex flex-wrap gap-x-3 text-[11px]">
                {flags.map((f) => (
                  <span key={f.text} className="text-warning" title={f.title}>{f.text}</span>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A one-click fold for conceptual teaching, so every gate can lead with
 * a single directive line and keep the theory out of the way. */
function HowItWorks({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-fit text-[12px] font-medium text-ink-3 hover:text-ink"
      >
        {open ? "▾" : "▸"} How this works
      </button>
      {open && <div className="grid gap-2 text-[12px] text-ink-3">{children}</div>}
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
/** One column's Value line on the coverage step: "<line> vs <counterpart>",
 * click to edit both ends, or set "none" (no Value cell for that room). */
function ValueLineEditor({ value, disabled, onChange, options, recommended, category }: {
  value: ValueLineUi | null;
  disabled: boolean;
  onChange: (v: ValueLineUi | null) => void;
  /** The brand's lines (2026-10-06, Tyler): the compact display opens, on
   * click, a fixed-width column of option buttons - the engine's pick
   * marked recommended, then Other and None. Buttons, not a select: a
   * select opened already set to the current line fired nothing when that
   * line was chosen again; and the always-visible select widened the row
   * past the modal. */
  options?: ValueCatalogLineUi[];
  recommended?: string | null;
  category?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [other, setOther] = useState(false);
  const [line, setLine] = useState("");
  const [counterpart, setCounterpart] = useState(value?.counterpart ?? "");
  const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const defaultCounterpart = `more affordable ${category ?? ""}`.trim();
  const pick = (name: string) => {
    // A changed line drops the engine's fit chip - it was judged for the
    // pick, not this choice; the same line keeps it.
    onChange(same(name, value?.line) ? { ...(value as ValueLineUi), line: name } : { line: name, counterpart: value?.counterpart ?? defaultCounterpart });
    setEditing(false); setOther(false);
  };
  if (editing) {
    return (
      <div className="grid w-44 gap-0.5 text-left">
        {!other && (options ?? []).map((o) => {
          const current = same(o.name, value?.line);
          return (
            <button key={o.name} type="button" title={o.for} onClick={() => pick(o.name)}
              className={`rounded border px-1.5 py-0.5 text-left text-[10px] leading-tight hover:bg-surface-1 ${current ? "border-primary text-primary" : "border-line text-ink"}`}>
              {o.name}{same(o.name, recommended) ? <span className="text-ink-3"> (recommended)</span> : null}{o.org ? <span className="text-ink-3"> - business</span> : null}
            </button>
          );
        })}
        {!other && (
          <button type="button" onClick={() => { setOther(true); setLine(""); setCounterpart(value?.counterpart ?? defaultCounterpart); }}
            className="rounded border border-line px-1.5 py-0.5 text-left text-[10px] leading-tight text-ink hover:bg-surface-1">Other...</button>
        )}
        {other && (
          <>
            <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="product line" maxLength={80} autoFocus
              className="w-full rounded border border-line px-1 py-0.5 text-[10px]" />
            <input value={counterpart} onChange={(e) => setCounterpart(e.target.value)} placeholder="compared with" maxLength={120}
              className="w-full rounded border border-line px-1 py-0.5 text-[10px]" />
            <button type="button" disabled={!line.trim()} onClick={() => { onChange({ line: line.trim(), counterpart: counterpart.trim() || defaultCounterpart }); setEditing(false); setOther(false); }}
              className="rounded border border-line px-1.5 py-0.5 text-left text-[10px] font-medium text-primary hover:bg-surface-1 disabled:opacity-50">done</button>
          </>
        )}
        <button type="button" onClick={() => { onChange(null); setEditing(false); setOther(false); }}
          className="rounded border border-line px-1.5 py-0.5 text-left text-[10px] leading-tight text-ink-3 hover:bg-surface-1">No Value cell</button>
        <button type="button" onClick={() => { setEditing(false); setOther(false); }}
          className="px-1.5 py-0.5 text-left text-[10px] text-ink-3 hover:opacity-80">cancel</button>
      </div>
    );
  }
  return (
    <button type="button" disabled={disabled}
      onClick={() => setEditing(true)}
      title="Value asks whether your product is worth paying more for, compared with cheaper options. This is the product line we ask about for this buyer and what it is compared with. Click to choose another of your lines, your own, or none."
      className="text-[10px] leading-tight text-primary hover:opacity-80">
      {value ? (<><span className="font-medium">{value.line}</span>{same(value.line, recommended) ? <span className="text-ink-3"> (recommended)</span> : null}<br /><span className="text-ink-3">vs {value.counterpart}</span></>) : <span className="text-ink-3">no Value cell</span>}
    </button>
  );
}

export function CoverageGate({
  state, setState, busy, onEditWorries, brand, category, setupId,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  busy: boolean;
  /** Back to the Buyer worries gate - the owner of doubt coverage. */
  onEditWorries?: () => void;
  /** For the per-room default judgment of a kept stage the mask reaches
   * nowhere; omit to skip the judgment (every room stays lit). */
  brand?: string;
  category?: string;
  setupId?: string;
}) {
  // Per-room default (2026-10-06, Tyler's option 2): a kept situational
  // stage the mask reaches in no room used to light every room. Now one
  // judgment per such stage lights only the rooms whose buyer is the
  // stage's asker; the result lands in stageRooms, so the dots start there
  // and stay editable. Judged once per stage (stageRooms set = judged);
  // an empty or failed judgment keeps every room lit.
  const judging = useRef(new Set<string>());
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    if (!brand || !category) return;
    const activeRooms = state.scenarios.filter((s) => s.label.trim());
    if (activeRooms.length === 0) return;
    const labels = activeRooms.map((s) => s.label);
    const kept = new Set(state.keptStages);
    for (const s of state.stages) {
      if (!s.situational || s.key === "pricing" || !kept.has(s.key)) continue;
      if (s.columns.some((c) => labels.includes(c))) continue;
      if (state.stageRooms?.[s.key] || judging.current.has(s.key)) continue;
      judging.current.add(s.key);
      void fetch("/api/setup/grid/stage_rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(setupId ? { "x-setup-id": setupId } : {}) },
        body: JSON.stringify({ brand, category, stageKey: s.key, stageLabel: s.label, hint: s.hint ?? `${s.label} - ${s.why ?? ""}`, rooms: activeRooms.map(({ label, description }) => ({ label, description })) }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rooms?: string[] | null } | null) => {
          const judged = d?.rooms;
          if (!judged || judged.length === 0) return;
          const cur = stateRef.current;
          if (cur.stageRooms?.[s.key]) return;
          setState({ ...cur, stageRooms: { ...(cur.stageRooms ?? {}), [s.key]: judged.filter((l) => cur.scenarios.some((sc: { label: string }) => sc.label === l)) } });
        })
        .catch(() => {})
        .finally(() => judging.current.delete(s.key));
    }
  }, [brand, category, setupId, state, setState]);
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
  // Stages the journey advisory added are a BRAND-level recommendation:
  // the rules' "not recommended" is about the market at large, so these
  // rows carry their own positive label instead.
  const advisoryKeys = new Set(
    Object.values(state.journeyStageAdds ?? {}).flat().map((a) => a.key)
  );

  // Worry-era battery: the worries gate OWNS the doubt stages - their rows
  // reflect the picks (read-only here) instead of per-scenario dots that
  // stopped being true when doubt cells went invariant-per-worry.
  const worryRow = (key: string) => state.worries !== undefined && WORRY_STAGES.has(key);
  const worriesFor = (key: string) => (state.worries ?? []).filter((w) => w.stage === key);

  const renderRow = (s: GridStage) => {
    const wr = worryRow(s.key);
    const isKept = wr ? worriesFor(s.key).length > 0 : kept.has(s.key);
    const brandAdd = advisoryKeys.has(s.key) && isKept;
    const cols = stageColumns(s, activeLabels, state.stageRooms);
    const explicitRooms = state.stageRooms?.[s.key];
    const effective = explicitRooms ? cols : cols.length > 0 ? cols : activeLabels;
    // Per-room toggle (2026-10-06): a kept situational stage's dot is a
    // switch for that room. The first click pins the stage's rooms to the
    // set shown, minus or plus the clicked one.
    const toggleRoom = (label: string) => {
      if (!isKept || !s.situational || s.key === "pricing" || wr) return;
      const cur = new Set(effective);
      if (cur.has(label)) cur.delete(label); else cur.add(label);
      setState({ ...state, stageRooms: { ...(state.stageRooms ?? {}), [s.key]: activeLabels.filter((l) => cur.has(l)) } });
    };
    return (
      <tr key={s.key} className={isKept ? "" : "opacity-50"}>
        {/* The stage column never gives way to the scenario columns: with
            long room labels it got squeezed until every chip dropped under
            its stage name and the map doubled in height (2026-10-06). */}
        <td className="px-3 py-1 whitespace-nowrap">
          <label className="flex items-center gap-x-2">
            <input
              type="checkbox"
              checked={isKept}
              disabled={busy || wr}
              title={wr ? "Owned by the Buyer worries step - pick worries there to change this stage's coverage" : undefined}
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
                  verdict: brandAdd
                    ? "Recommended for your brand: added from the buyer-difference advisory - your brand's buyers reach this stage even though the market at large decides without it."
                    : s.why
                      ? `${s.recommended ? "Recommended" : "Not recommended"}: ${s.why}`
                      : "",
                });
              }}
              onMouseLeave={() => setTip(null)}
            >
              {s.label}
            </span>
            <TagChip tag={s.tag} />
            {brandAdd ? (
              <span className="text-[9px] uppercase tracking-wide text-primary" title="Added from the buyer-difference advisory - your brand's buyers reach this stage">
                added for your brand
              </span>
            ) : !s.recommended ? (
              <span className="text-[9px] uppercase tracking-wide text-ink-3" title="No journey reaches this stage - keep it only if your buyers really do">
                not recommended
              </span>
            ) : null}
          </label>
        </td>
        {wr ? (
          // Worry summary in place of dots: one invariant cell per picked
          // worry at this stance, collecting on monthly waves.
          <td colSpan={active.length} className="px-2 py-1 text-center">
            {worriesFor(s.key).length > 0 ? (
              <span
                className="text-[10px] text-primary cursor-help underline decoration-dotted decoration-line underline-offset-2"
                onMouseEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setTip({
                    x: Math.min(r.left, window.innerWidth - 340),
                    y: r.bottom + 6,
                    hint: worriesFor(s.key).map((w) => w.concern).join(" · "),
                    verdict: "",
                  });
                }}
                onMouseLeave={() => setTip(null)}
              >
                {worriesFor(s.key).length} worr{worriesFor(s.key).length === 1 ? "y" : "ies"} · monthly
              </span>
            ) : (
              <span className="text-[10px] text-ink-3">no worries picked</span>
            )}
            {onEditWorries && (
              <button
                type="button"
                onClick={onEditWorries}
                disabled={busy}
                className="ml-2 text-[10px] font-medium text-primary hover:opacity-80"
              >
                edit
              </button>
            )}
          </td>
        ) : s.rivals === "each" ? (
          // s10: comparisons are scenario-invariant - no column owns a
          // head-to-head, so per-scenario dots would describe the old
          // pinned-cycle battery.
          <td colSpan={active.length} className="px-2 py-1 text-center">
            <span className={`text-[10px] ${isKept ? "text-primary" : "text-ink-3"}`}>
              {isKept ? "one cell per rival · every buyer" : "-"}
            </span>
          </td>
        ) : s.key === "pricing" && isKept && state.valueLines ? (
          // Value lines (2026-10-04): each column shows the line its Value
          // cell weighs and the one-tier-down counterpart - editable, or
          // "none" for a room the brand has no product for.
          active.map((sc) => (
            <td key={sc.label} className="px-1.5 py-1 text-center align-top">
              {effective.includes(sc.label) ? (
                <ValueLineEditor
                  value={state.valueLines?.[sc.label] ?? null}
                  disabled={busy}
                  onChange={(v) => setState({ ...state, valueLines: { ...(state.valueLines ?? {}), [sc.label]: v } })}
                  options={state.valueCatalog}
                  recommended={state.valueRecommended?.[sc.label] ?? null}
                  category={category}
                />
              ) : (
                <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-line" />
              )}
            </td>
          ))
        ) : s.situational || s.rivals !== "none" ? (
          active.map((sc) => {
            const inCol = isKept && effective.includes(sc.label);
            const clickable = isKept && s.situational && s.key !== "pricing" && !wr && !busy;
            return (
              <td key={sc.label} className="px-2 py-1 text-center">
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => toggleRoom(sc.label)}
                  className={`inline-block h-2.5 w-2.5 rounded-full p-0 ${
                    inCol ? "bg-primary" : "border border-dashed border-line"
                  } ${clickable ? "cursor-pointer hover:ring-2 hover:ring-primary/30" : "cursor-default"}`}
                  onMouseEnter={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setTip({
                      x: Math.min(r.left, window.innerWidth - 340),
                      y: r.bottom + 6,
                      hint: inCol
                        ? `${s.label} runs in ${sc.label}${clickable ? " - click to drop it for this buyer" : ""}`
                        : `${sc.label}'s buyer doesn't reach ${s.label}${clickable ? " - click to add it for this buyer" : ""}`,
                      verdict: "",
                    });
                  }}
                  onMouseLeave={() => setTip(null)}
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
      <p className="m-0 text-[12px] text-ink-2">
        Untick any stage your buyers skip - a missing dot is a question that
        buyer never asks, and a question that never costs anything.
      </p>
      <HowItWorks>
        <p className="m-0">
          Each scenario walks the stages its buyer actually walks - the map
          is derived from how your market buys, never hand-drawn. Keep a
          not-recommended stage only if your judgement says buyers reach it;
          if the map looks wrong, the reads are usually what&apos;s off.
        </p>
        <p className="m-0">
          Hover any stage name for what it asks and why it&apos;s in or out
          for this market.
        </p>
      </HowItWorks>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-surface-1">
              <th className="px-3 py-2 text-left font-medium text-ink-3 whitespace-nowrap w-px">stage</th>
              {active.map((sc) => (
                <th key={sc.label} className="px-2 py-2 text-center font-medium">
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
                      className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-sm font-semibold uppercase tracking-wide text-primary w-full text-left"
                    >
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
export function cellSubMeta(c: GridCellUi): string {
  return (
    [
      c.situation,
      c.angle !== "generic" ? angleLabel(c) : null,
      c.mode ? `asked by: ${c.mode}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "all buyers"
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

/** Gate 2 (option D): layers as slim separators, each stage a closed
 * accordion bar carrying its tag and blind/branded stats - the resting
 * page is a per-stage checklist. Opening a stage renders its cells as
 * cards with the prompt as the body and the New-prompt / cycle / remove
 * controls in the footer. Once the paraphrases are written the same
 * cards grow a prompt-count pill and a paraphrases fold - there is no
 * separate paraphrases step. */
/** Cells that already received their arrival autofocus - a Set outside
 * React so an accordion remount can't steal focus back to a card the
 * user has since blanked. */
const focusedOnce = new Set<string>();

/** Worry stance chips: where a picked worry is measured. */
const STANCE_LABEL: Record<string, string> = {
  objections: "prospect deciding",
  churn_triggers: "customer leaving",
  renewal: "renewal moment",
};

/** The worries gate: the brand's doubt-space as a menu. Each card is one
 * worry; its stance chips decide WHERE it is measured - one doubt cell
 * per active chip, each costing one pick of the plan's allowance. The
 * recommended stance arrives pre-set (the top worries pre-picked); zero
 * chips on a worry simply leaves it unmeasured. */
export function WorriesGate({
  state, setState, cap, busy,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  /** null = uncapped (the recommendation layer steers volume). */
  cap: number | null;
  busy: boolean;
}) {
  // A worry stage the user switched on AFTER the pool was drawn (the journey
  // advisory's "keep the market view and add Renewal", or a coverage tick)
  // gets chips on the existing pool instead of a redraw that would reword
  // the worries and orphan the picks: renewal is the existing customer's
  // pay-again moment, so every worry already offered to existing customers
  // (churn) is offered at renewal too, and vice versa (AmEx walk,
  // 2026-10-02: an added Renewal showed "no worries picked" with none
  // offered).
  const drawnFor = new Set(state.worryOffered ?? []);
  const added = ["renewal", "churn_triggers"].filter((k) => state.keptStages.includes(k) && !drawnFor.has(k));
  const pool = (state.worryPool ?? []).map((w) => {
    const extra = added.filter((k) => !w.stances.includes(k) &&
      w.stances.some((x) => x === "churn_triggers" || x === "renewal"));
    return extra.length > 0 ? { ...w, stances: [...w.stances, ...extra] } : w;
  });
  const picks = state.worries ?? [];
  const planned = new Set(
    recommendedWorryPairs(pool).map((p) => `${p.concern}|${p.stage}`)
  );
  // Recommended worries first; within each group, pool order (most
  // widely-voiced first) stands.
  const ordered = [...pool].sort(
    (a, b) =>
      Number(b.stances.some((s) => planned.has(`${b.worry}|${s}`))) -
      Number(a.stances.some((s) => planned.has(`${a.worry}|${s}`)))
  );
  const has = (worry: string, stage: string) =>
    picks.some((p) => p.concern === worry && p.stage === stage);
  const atCap = cap !== null && picks.length >= cap;
  const toggle = (worry: string, stage: string) => {
    if (busy) return;
    if (has(worry, stage)) {
      setState({ ...state, worries: picks.filter((p) => !(p.concern === worry && p.stage === stage)) });
    } else if (!atCap) {
      setState({ ...state, worries: [...picks, { concern: worry, stage }] });
    }
  };
  /** The card itself: with any chip lit it clears the whole worry; with
   * none lit it lights the recommended plan (the natural stance when the
   * pool predates plans). It used to toggle the natural stance alone, so a
   * card lit at renewal flipped customer-leaving ON instead of clearing
   * (Tyler, 2026-10-04). */
  const toggleCard = (w: WorryUi) => {
    if (busy) return;
    const lit = w.stances.filter((s) => has(w.worry, s));
    if (lit.length > 0) {
      setState({ ...state, worries: picks.filter((p) => p.concern !== w.worry) });
      return;
    }
    const plan = (w.recommend?.length ? w.recommend : [w.recommended]).filter((s) => w.stances.includes(s));
    const room = cap === null ? plan.length : Math.max(0, cap - picks.length);
    const add = plan.slice(0, room).map((stage) => ({ concern: w.worry, stage }));
    if (add.length > 0) setState({ ...state, worries: [...picks, ...add] });
  };
  return (
    <div className="grid gap-3 max-w-3xl">
      <p className="m-0 text-[12px] text-ink-2">
        The worries buyers actually voice about your brand - pick the ones worth measuring{cap !== null ? ` (up to ${cap})` : ""}.
        Each chip is one question battery: a prospect deciding, a customer
        thinking of leaving, or the renewal moment. A worry can be measured at more than
        one moment{cap !== null ? " - each costs a pick" : ""}. Worries collect on monthly
        waves, so extra picks cost little.
      </p>
      {ordered.map((w) => {
        const pickedAny = w.stances.some((s) => has(w.worry, s));
        return (
          <div
            key={w.worry}
            className={`grid gap-1.5 rounded-lg border bg-surface px-4 py-3 ${
              pickedAny ? "border-primary" : "border-line"
            }`}
          >
            <button
              type="button"
              onClick={() => toggleCard(w)}
              title={pickedAny ? "Clear this worry" : "Pick this worry at its recommended moment"}
              className="text-left"
            >
              <span className="text-[14px] font-semibold">{w.worry}</span>
              <span className="block text-[13px] text-ink-2 mt-0.5">{w.detail}</span>
            </button>
            {(w.overlaps?.length ?? 0) > 0 && (
              <span className="text-[11px] text-warning" title="These worries come down to the same doubt - picking both measures it twice. Keep one.">
                Overlaps with {w.overlaps!.join(", ")}
              </span>
            )}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {w.stances.map((s) => {
                const active = has(w.worry, s);
                const blocked = !active && (busy || atCap);
                const inPlan = planned.has(`${w.worry}|${s}`);
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={blocked}
                    onClick={() => toggle(w.worry, s)}
                    title={
                      inPlan
                        ? "In the recommended measurement plan"
                        : "Available - not in the recommended plan"
                    }
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                      active
                        ? "border-primary bg-primary-soft text-primary"
                        : `border-line text-ink-2 ${blocked ? "opacity-40" : "hover:border-primary/50"}`
                    }`}
                  >
                    {STANCE_LABEL[s] ?? s}
                    {inPlan ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CellsGate({
  state, setState, brandNames, onRegenerate, onNearCell, onSuggestCell, onAddOwn, onCycle, onWarmReview,
  customUsed, customAllowance, busy,
}: {
  state: GridState;
  setState: (s: GridState) => void;
  brandNames: string[];
  /** Draw a genuinely new prompt for cell i (max MAX_REGENS). */
  onRegenerate: (i: number) => Promise<void> | void;
  /** Draw a near variant of cell i's prompt - same ask, one detail moved
   * (max MAX_VARIANTS). */
  onNearCell: (i: number) => Promise<void> | void;
  /** Mint a machine-suggested NEW question in a stage. */
  onSuggestCell: (stageKey: string, situation: string | null, angle: string) => Promise<void> | void;
  /** Insert an empty user-written question in a stage. */
  onAddOwn: (stageKey: string, situation: string | null, angle: string) => void;
  /** Step cell i through its offered prompts. */
  onCycle: (i: number, dir: 1 | -1) => void;
  /** Silent cache warm for the confirm-time quality check - fired on
   * field blur so the confirm usually lands on a cached verdict. */
  onWarmReview?: () => void;
  /** Custom-question allowance, net of deletions. */
  customUsed: number;
  customAllowance: number;
  busy: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  /** The one cell currently writing - only its card waits. Keyed by uid
   * so deletions elsewhere can't shift the wait onto the wrong card. */
  // Per-cell (2026-10-06, Tyler): one draw used to disable every other
  // card's buttons until it finished. Each cell's draw is its own entry;
  // only that card waits.
  const [pendingMap, setPendingMap] = useState<Record<string, "new" | "near">>({});
  const pendingOf = (uid: string | undefined): "new" | "near" | null => (uid ? pendingMap[uid] ?? null : null);
  /** A stage-level add in progress: picking a rival and/or scenario. */
  const [adding, setAdding] = useState<{
    stage: string;
    kind: "own" | "suggest";
    phase: "rival" | "scenario";
  } | null>(null);
  const [stagePending, setStagePending] = useState<string | null>(null);
  const atCap = customUsed >= customAllowance;
  /** The one cell whose paraphrases fold is open (by uid). */
  const [openPhr, setOpenPhr] = useState<string | null>(null);
  const written = state.step === "phrasings";
  const countOf = (c: GridCellUi) => 1 + c.phrasings.filter((p) => p.text.trim()).length;
  const draw = async (i: number, kind: "new" | "near") => {
    const uid = state.cells[i]?.uid;
    if (!uid || pendingMap[uid]) return;
    setPendingMap((m) => ({ ...m, [uid]: kind }));
    try {
      await (kind === "near" ? onNearCell(i) : onRegenerate(i));
    } finally {
      setPendingMap((m) => { const n = { ...m }; delete n[uid]; return n; });
    }
  };
  const commitAdd = async (
    stageKey: string,
    situation: string | null,
    angle: string,
    kind: "own" | "suggest"
  ) => {
    setAdding(null);
    if (kind === "own") {
      onAddOwn(stageKey, situation, angle);
      return;
    }
    setStagePending(stageKey);
    try {
      await onSuggestCell(stageKey, situation, angle);
    } finally {
      setStagePending(null);
    }
  };
  /** Identity comes from where you click; what's left to ask is decided
   * by the stage's mechanics: brand-structured stages pick a rival (or
   * blind) first, situational stages pick the buyer. */
  const beginAdd = (stageKey: string, kind: "own" | "suggest") => {
    const st = stageOf(state, stageKey);
    if (st && st.rivals !== "none") setAdding({ stage: stageKey, kind, phase: "rival" });
    else if (st?.situational) setAdding({ stage: stageKey, kind, phase: "scenario" });
    else void commitAdd(stageKey, null, "generic", kind);
  };
  /** Rivals for the picker - the brand list minus the client brand. */
  const rivalNames = brandNames.slice(1, 7).filter((b) => b.trim());
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return (
    <div className="grid gap-4 max-w-4xl">
      <p className="m-0 text-[12px] text-ink-2">
        {written
          ? `Each question is asked ${PHRASING_COUNT} ways, in the wordings real buyers use - open a stage to spot-check or edit any of them.`
          : "Open each stage and read its questions - rewrite, cycle, or draw a new one for anything that doesn't sound like your buyers."}
      </p>
      {LAYERS.map((layer) => {
        const cells = state.cells.map((c, i) => ({ ...c, i })).filter((c) => c.layer === layer);
        if (cells.length === 0) return null;
        const stages = [...new Set(cells.map((c) => c.stage))];
        return (
          <div key={layer} className="grid gap-2">
            <span className="text-sm font-semibold uppercase tracking-wide text-primary">
              {layer}
            </span>
            {stages.map((stage) => {
              const scells = cells.filter((c) => c.stage === stage);
              // Stats count only cells with text - a blanked card still
              // shows for editing, but ships nothing (matching the footer).
              const live = scells.filter((c) => c.text.trim());
              const branded = live.filter((c) => namesAny(c.text, brandNames)).length;
              const blind = live.length - branded;
              const prompts = live.reduce((n, c) => n + countOf(c), 0);
              // Flagged seeds surface at the stage title too (Tyler
              // 2026-10-07): a folded stage gave no sign that a card inside
              // needed a call, so nobody knew to open it.
              const flagged = live.filter((c) => !!c.seedFlags?.length).length;
              const isOpen = open.has(stage);
              return (
                <div key={stage}>
                  <button
                    type="button"
                    onClick={() => toggle(stage)}
                    className={`w-full flex items-center gap-2.5 rounded-lg border bg-surface px-3.5 py-2.5 text-left ${
                      isOpen ? "border-primary rounded-b-none" : "border-line"
                    }`}
                  >
                    <span aria-hidden="true" className="text-[11px] text-ink-3">
                      {isOpen ? "▾" : "▸"}
                    </span>
                    <span className="text-[13px] font-medium">
                      {stageOf(state, stage)?.label ?? stage}
                    </span>
                    <TagChip tag={stageOf(state, stage)?.tag ?? "picks"} />
                    {flagged > 0 && (
                      <span
                        className="rounded-full bg-warning/10 px-2 py-px text-[10px] font-medium text-warning whitespace-nowrap"
                        title={`${flagged} question${flagged === 1 ? "" : "s"} in this stage need${flagged === 1 ? "s" : ""} your call - open the stage to review`}
                      >
                        {flagged === 1 ? "needs your call" : `${flagged} need your call`}
                      </span>
                    )}
                    <span className="ml-auto flex gap-3 text-[11px] text-ink-3 whitespace-nowrap">
                      <span className={live.length < scells.length ? "text-warning" : ""}>
                        {live.length}/{scells.length} questions
                      </span>
                      {written ? (
                        <span className={prompts < scells.length * PHRASING_COUNT ? "text-warning" : ""}>
                          {prompts}/{scells.length * PHRASING_COUNT} prompts
                        </span>
                      ) : (
                        <>
                          {blind > 0 && <span>{blind} blind</span>}
                          {branded > 0 && <span className="text-warning">{branded} branded</span>}
                        </>
                      )}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="grid gap-2.5 rounded-b-lg border border-t-0 border-primary bg-primary-soft/15 px-3.5 py-3">
                      {scells.map((c) => (
                        <div
                          key={c.uid ?? c.i}
                          className={`grid gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2.5 ${
                            pendingOf(c.uid) ? "opacity-50 pointer-events-none" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-medium text-ink-2">
                              {cellSubMeta(c)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-px text-[9.5px] font-medium ${
                                namesAny(c.text, brandNames)
                                  ? "bg-warning/10 text-warning"
                                  : "bg-primary-soft text-primary"
                              }`}
                            >
                              {namesAny(c.text, brandNames) ? "branded" : "blind"}
                            </span>
                            {!!c.seedFlags?.length && (
                              <span
                                className="rounded-full bg-warning/10 px-2 py-px text-[9.5px] font-medium text-warning"
                                title={c.seedFlags.join("; ")}
                              >
                                needs your call
                              </span>
                            )}
                            {written && (
                              <span
                                className={`rounded-full px-2 py-px text-[9.5px] font-medium ${
                                  countOf(c) >= PHRASING_COUNT
                                    ? "bg-primary-soft text-primary"
                                    : "bg-warning/10 text-warning"
                                }`}
                              >
                                {countOf(c)}/{PHRASING_COUNT} prompts
                              </span>
                            )}
                            <button
                              type="button"
                              aria-label="remove cell"
                              onClick={() =>
                                setState({ ...state, cells: state.cells.filter((_, j) => j !== c.i) })
                              }
                              className="ml-auto text-ink-3 hover:text-danger text-[15px] leading-none"
                            >
                              ×
                            </button>
                          </div>
                          <textarea
                            className="input w-full resize-none field-sizing-content text-sm"
                            rows={1}
                            value={c.text}
                            readOnly={pendingOf(c.uid) !== null}
                            ref={(el) => {
                              if (el && c.custom && c.text === "" && c.uid && !focusedOnce.has(c.uid)) {
                                focusedOnce.add(c.uid);
                                el.focus();
                              }
                            }}
                            onChange={(e) =>
                              setState({
                                ...state,
                                cells: state.cells.map((q, j) =>
                                  // An edit is the human attention the flag
                                  // asked for - it clears on the first touch.
                                  j === c.i ? { ...q, text: e.target.value, seedFlags: undefined } : q
                                ),
                              })
                            }
                            onBlur={() => {
                              // A post-write edit orphans the set: bank it
                              // under the wording it was written for and
                              // let the missing-paraphrases gate take over.
                              // The reverse also holds - retyping a banked
                              // wording restores its set on the spot.
                              const hasSet = c.phrasings.some((p) => p.text.trim());
                              const drifted = c.text.trim() !== (c.phrasedFor ?? c.text).trim();
                              const restorable =
                                !hasSet && (c.phrasingsByText?.[c.text.trim()]?.length ?? 0) > 0;
                              if (written && ((hasSet && drifted) || restorable)) {
                                setState({
                                  ...state,
                                  cells: state.cells.map((q, j) =>
                                    j === c.i ? { ...q, ...swapPhrasings(q, q.text) } : q
                                  ),
                                });
                              }
                              onWarmReview?.();
                            }}
                          />
                          <div className="flex items-center gap-3 border-t border-dashed border-line pt-1.5 text-[11px]">
                            {pendingOf(c.uid) ? (
                              <span className="flex items-center gap-1.5 font-medium text-primary">
                                <InlineSpinner />
                                {pendingOf(c.uid) === "near"
                                  ? written ? "Writing a near variant and its prompts…" : "Writing a near variant…"
                                  : written ? "Writing a new question and its prompts…" : "Writing a new prompt…"}
                              </span>
                            ) : (
                              <>
                                {(c.regens ?? 0) < MAX_REGENS ? (
                                  <button
                                    type="button"
                                    disabled={busy || pendingOf(c.uid) !== null}
                                    onClick={() => void draw(c.i, "new")}
                                    title="Ask this cell's question a different way - a new ask, not another wording"
                                    className="font-medium text-primary hover:opacity-80 disabled:opacity-50"
                                  >
                                    ↻ New prompt
                                    {(c.regens ?? 0) > 0 && (
                                      <span className="font-normal text-ink-3"> · {MAX_REGENS - (c.regens ?? 0)} left</span>
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-ink-3">{MAX_REGENS} rewrites used</span>
                                )}
                                {c.text.trim() !== "" &&
                                  ((c.nears ?? 0) < MAX_VARIANTS ? (
                                    <button
                                      type="button"
                                      disabled={busy || pendingOf(c.uid) !== null}
                                      onClick={() => void draw(c.i, "near")}
                                      title="Right ask, wrong details? Same question with one detail moved"
                                      className="font-medium text-primary hover:opacity-80 disabled:opacity-50"
                                    >
                                      ≈ Near neighbor
                                      {(c.nears ?? 0) > 0 && (
                                        <span className="font-normal text-ink-3"> · {MAX_VARIANTS - (c.nears ?? 0)} left</span>
                                      )}
                                    </button>
                                  ) : (
                                    <span className="text-ink-3">{MAX_VARIANTS} variants tried</span>
                                  ))}
                              </>
                            )}
                            {(c.alts?.length ?? 1) > 1 && (
                              <span className="flex items-center gap-1 text-ink-3">
                                <button
                                  type="button"
                                  aria-label="previous offered prompt"
                                  disabled={busy}
                                  onClick={() => onCycle(c.i, -1)}
                                  className="px-1 hover:text-ink disabled:opacity-50"
                                >
                                  ‹
                                </button>
                                {Math.min((c.altIdx ?? 0) + 1, c.alts!.length)}/{c.alts!.length}
                                <button
                                  type="button"
                                  aria-label="next offered prompt"
                                  disabled={busy}
                                  onClick={() => onCycle(c.i, 1)}
                                  className="px-1 hover:text-ink disabled:opacity-50"
                                >
                                  ›
                                </button>
                              </span>
                            )}
                            {written && (
                              <button
                                type="button"
                                onClick={() => setOpenPhr(openPhr === c.uid ? null : c.uid ?? null)}
                                className="font-medium text-primary hover:opacity-80"
                              >
                                {openPhr === c.uid ? "Hide prompts ▴" : "Show prompts ▾"}
                              </button>
                            )}
                          </div>
                          {written && openPhr != null && openPhr === c.uid && (
                            <div className="grid gap-1.5 pt-1">
                              {c.phrasings.map((ph, k) => (
                                <div key={k} className="flex items-start gap-2">
                                  <span className="w-5 shrink-0 pt-1.5 text-[11px] text-ink-3">{k + 2}.</span>
                                  <textarea
                                    className="input w-full resize-none field-sizing-content text-sm"
                                    rows={1}
                                    value={ph.text}
                                    onChange={(e) =>
                                      setState({
                                        ...state,
                                        cells: state.cells.map((q, j) =>
                                          j === c.i
                                            ? { ...q, phrasings: q.phrasings.map((x, m) => (m === k ? { ...x, text: e.target.value } : x)) }
                                            : q
                                        ),
                                      })
                                    }
                                    onBlur={() => onWarmReview?.()}
                                  />
                                  {/* ph.asker stays in the data (voice metadata,
                                      rides into the tracker) but is not shown -
                                      it means nothing to the user here. */}
                                  <button
                                    type="button"
                                    aria-label="remove prompt"
                                    onClick={() =>
                                      setState({
                                        ...state,
                                        cells: state.cells.map((q, j) =>
                                          j === c.i ? { ...q, phrasings: q.phrasings.filter((_, m) => m !== k) } : q
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
                                disabled={countOf(c) >= PHRASING_COUNT}
                                title={countOf(c) >= PHRASING_COUNT ? `The set is full at ${PHRASING_COUNT} - remove one to add your own` : undefined}
                                onClick={() =>
                                  setState({
                                    ...state,
                                    cells: state.cells.map((q, j) =>
                                      j === c.i ? { ...q, phrasings: [...q.phrasings, { text: "", asker: "" }] } : q
                                    ),
                                  })
                                }
                                className="text-[13px] font-medium text-primary hover:opacity-80 disabled:opacity-40 w-fit"
                              >
                                + Add paraphrase
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-4 pt-0.5 text-[13px]">
                        {stagePending === stage ? (
                          <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                            <InlineSpinner />
                            {written ? "Writing a suggested question and its prompts…" : "Writing a suggested question…"}
                          </span>
                        ) : adding?.stage === stage && adding.phase === "rival" ? (
                          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
                            About which rival:
                            {rivalNames.map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => void commitAdd(stage, null, r, adding.kind)}
                                className="rounded-full bg-warning/10 px-2.5 py-0.5 font-medium text-warning hover:opacity-80"
                              >
                                {r}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                const st = stageOf(state, stage);
                                if (st?.situational) setAdding({ stage, kind: adding.kind, phase: "scenario" });
                                else void commitAdd(stage, null, "generic", adding.kind);
                              }}
                              className="rounded-full bg-primary-soft px-2.5 py-0.5 font-medium text-primary hover:opacity-80"
                            >
                              no brand (blind)
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdding(null)}
                              className="text-ink-3 hover:text-ink"
                            >
                              cancel
                            </button>
                          </span>
                        ) : adding?.stage === stage ? (
                          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
                            Who asks it:
                            {state.scenarios.map((sc) => (
                              <button
                                key={sc.label}
                                type="button"
                                onClick={() => void commitAdd(stage, sc.label, "generic", adding.kind)}
                                className="rounded-full bg-primary-soft px-2.5 py-0.5 font-medium text-primary hover:opacity-80"
                              >
                                {sc.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setAdding(null)}
                              className="text-ink-3 hover:text-ink"
                            >
                              cancel
                            </button>
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={atCap || busy}
                              onClick={() => beginAdd(stage, "own")}
                              title={atCap ? "Custom-question allowance used - delete a question to free a slot" : "Write a question of your own for this stage"}
                              className="font-medium text-primary hover:opacity-80 disabled:opacity-40"
                            >
                              + Add your own
                            </button>
                            <button
                              type="button"
                              disabled={atCap || busy}
                              onClick={() => beginAdd(stage, "suggest")}
                              title={atCap ? "Custom-question allowance used - delete a question to free a slot" : "Have another question written for this stage"}
                              className="font-medium text-primary hover:opacity-80 disabled:opacity-40"
                            >
                              Suggest another
                            </button>
                            {atCap ? (
                              <span className="text-[11px] text-ink-3">
                                custom limit reached - deleting a question frees a slot
                              </span>
                            ) : customUsed > 0 ? (
                              <span className="text-[11px] text-ink-3">
                                {customUsed}/{customAllowance} custom questions used
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
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

/** One flagged prompt in the Prompts-gate quality check. */
export interface CellReviewItem {
  /** Cell index in the grid (prompt index, in classic mode). */
  index: number;
  /** Set when the flagged text is a paraphrase: its index in the cell's
   * set. Absent = the seed prompt itself. */
  phr?: number;
  /** Where the prompt lives - stage plus the cell's sub-meta. */
  meta: string;
  current: string;
  /** Every problem the reviewer saw, most serious first. */
  flags: ("target" | "branding" | "unclear" | "design")[];
  reason: string;
  suggestion: string;
  choice: "suggestion" | "mine";
}

const CELL_FLAG_INFO: Record<CellReviewItem["flags"][number], { label: string; cls: string }> = {
  target: { label: "asks a different question", cls: "bg-warning/10 text-warning" },
  branding: { label: "blind/branded broken", cls: "bg-warning/10 text-warning" },
  unclear: { label: "hard to follow", cls: "bg-primary-soft text-primary" },
  design: { label: "drifted off its question", cls: "bg-warning/10 text-warning" },
};

/** Overlay shown when the Prompts-gate quality check flags user-edited
 * prompts: each gets the reviewer's reason and a side-by-side choice
 * between the suggested edit (default) and the user's own wording. */
export function CellReviewModal({
  items, onChoice, onBack, onContinue, busy,
}: {
  items: CellReviewItem[];
  onChoice: (k: number, choice: CellReviewItem["choice"]) => void;
  onBack: () => void;
  onContinue: () => void;
  busy: boolean;
}) {
  const option = (
    k: number, it: CellReviewItem,
    choice: CellReviewItem["choice"], title: string, text: string
  ) => (
    <button
      type="button"
      onClick={() => onChoice(k, choice)}
      className={`w-full rounded-lg border px-3 py-2 text-left grid gap-1 ${
        it.choice === choice ? "border-primary bg-primary-soft/40" : "border-line bg-surface hover:border-ink-3"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{title}</span>
      <span className="text-[13px]">{text}</span>
    </button>
  );
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/30 p-6">
      <div className="w-full max-w-2xl max-h-full overflow-y-auto rounded-xl border border-line bg-surface p-5 grid gap-4 shadow-lg">
        <div className="grid gap-1">
          <h3 className="text-[15px] font-semibold">A quick check on your prompts</h3>
          <p className="text-[12px] text-ink-3">
            These are yours to call - pick either and continue.
          </p>
        </div>
        {items.map((it, k) => (
          <div key={it.index} className={`grid gap-2 ${k > 0 ? "border-t border-line pt-4" : ""}`}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              {it.meta}
            </span>
            <div className="flex items-start gap-2">
              <span className="flex shrink-0 gap-1.5">
                {it.flags.map((f) => {
                  // A flag name this build doesn't know renders generically
                  // instead of throwing mid-render (the "design" crash class).
                  const info = CELL_FLAG_INFO[f] ?? { label: f, cls: "bg-warning/10 text-warning" };
                  return (
                    <span key={f} className={`rounded-full px-2 py-px text-[10px] font-medium whitespace-nowrap ${info.cls}`}>
                      {info.label}
                    </span>
                  );
                })}
              </span>
              <p className="text-[12px] text-ink-2">{it.reason}</p>
            </div>
            <div className="grid gap-2">
              {/* No suggestion = the reviewer had no repair (the model's
                * echo was blanked): the user keeps their wording, edits
                * it, and it stays under review at the next confirm. */}
              {it.suggestion.trim() !== "" && option(k, it, "suggestion", "Suggested edit", it.suggestion)}
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
