import { ENGINES } from "./providers";
import { buildResolver } from "./brand_resolve";
import { exitResolver, exitRows, outsideCounts, type ExitRow } from "./exits";
import { cachedView, cell, poolOf, type PoolRow, type RateCell, type ViewData } from "./view_data";
import type { Project, Run } from "../types";

/**
 * The doubt views (2026-10-27), never pooled into the headline
 * (CODING_DECISIONS section 8 / section 12 routing). Both are read per
 * worry: a cell's `concern` is the doubt it voices, so answers group by
 * stage + concern (cells without one group under their stage).
 *
 * Objections (the "doubt" view): a buyer who does not own the brand voices
 * a worry about it. Reads: proceed / avoid / undecided (proceed_or_avoid),
 * whether the AI confirms, rebuts or splits the worry (premise_verdict,
 * judged against the cell's doubt line), and the exits offered. Destinations
 * fill under ANY verdict on this schema (Tyler 2026-10-13), so exits are
 * always reported paired with the verdict - the exit-ramp rate is how often
 * a named rival rides along even when the AI says go ahead.
 *
 * Churn and renewal (the "keep_or_leave" view): a current customer voices
 * the worry. Reads: keep / leave / undecided (native keep_or_leave),
 * confirms / rebuts / mixed, and where leavers are sent. Destinations on
 * these stages are leave-only by the sealed rule, so a leave answer with no
 * destination is a plain cancel.
 *
 * The premise x verdict matrix is the read neither field gives alone: how
 * often the AI agrees the worry is warranted and still advises the brand.
 */

export type { RateCell };

export type Premise = "confirms" | "mixed" | "rebuts";
export const PREMISES: readonly Premise[] = ["confirms", "mixed", "rebuts"];
export type ObjectionVerdict = "proceed" | "avoid" | "undecided";
export const OBJECTION_VERDICTS: readonly ObjectionVerdict[] = ["proceed", "avoid", "undecided"];
export type StayVerdict = "keep" | "leave" | "undecided";
export const STAY_VERDICTS: readonly StayVerdict[] = ["keep", "leave", "undecided"];

export interface WorryRow<V extends string> {
  key: string;
  stage: string;
  concern: string;
  answers: number;
  verdicts: Record<V, RateCell>;
  /** Over answers with a premise verdict. */
  premise: Record<Premise, RateCell>;
  /** Answers naming at least one exit (a destination that is not the client). */
  offersExit: RateCell;
  /** Exit names, most offered first. */
  topExits: { name: string; n: number }[];
}

export interface DoubtSlice<V extends string> {
  key: string;
  label: string;
  answers: number;
  verdicts: Record<V, RateCell>;
  confirms: RateCell;
  offersExit: RateCell;
}

export interface DoubtView<V extends string> {
  kind: "objections" | "keep_or_leave";
  brand: string;
  answers: number;
  uncoded: number;
  stages: string[];
  verdicts: Record<V, RateCell>;
  premise: Record<Premise, RateCell>;
  /** Rows = premise verdict, cells = share of that premise's answers per verdict. */
  matrix: Record<Premise, Record<V, RateCell>>;
  offersExit: RateCell;
  offersExitBy: Record<V, RateCell>;
  ownProduct: RateCell;
  rows: WorryRow<V>[];
  exits: ExitRow<V>[];
  outsideExits: { name: string; n: number }[];
  byEngine: DoubtSlice<V>[];
  byStage: DoubtSlice<V>[];
}

export interface DoubtViews {
  runId: string;
  source: string;
  brand: string;
  objections: DoubtView<ObjectionVerdict> | null;
  keepOrLeave: DoubtView<StayVerdict> | null;
}

interface Facts<V extends string> {
  row: PoolRow;
  verdict: V;
  premise: Premise | null;
  exits: Map<string, { name: string }>;
  ownProduct: boolean;
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

function verdictCells<V extends string>(list: Facts<V>[], verdicts: readonly V[]): Record<V, RateCell> {
  return Object.fromEntries(verdicts.map((v) => [v, cell(count(list, (f) => f.verdict === v), list.length)])) as Record<V, RateCell>;
}

function premiseCells(list: { premise: Premise | null }[]): Record<Premise, RateCell> {
  const judged = list.filter((f) => f.premise !== null);
  return Object.fromEntries(
    PREMISES.map((p) => [p, cell(count(judged, (f) => f.premise === p), judged.length)])
  ) as Record<Premise, RateCell>;
}

const exitCell = <V extends string>(list: Facts<V>[]) => cell(count(list, (f) => f.exits.size > 0), list.length);

function sliceOf<V extends string>(key: string, label: string, list: Facts<V>[], verdicts: readonly V[]): DoubtSlice<V> {
  return {
    key,
    label,
    answers: list.length,
    verdicts: verdictCells(list, verdicts),
    confirms: premiseCells(list).confirms,
    offersExit: exitCell(list),
  };
}

const STAGE_ORDER = ["objections", "churn_triggers", "renewal"];

function computeKind<V extends string>(
  data: ViewData,
  kind: "objections" | "keep_or_leave",
  verdicts: readonly V[],
  verdictOf: (row: PoolRow) => V
): DoubtView<V> | null {
  const { project, dictionary } = data;
  const resolve = buildResolver(dictionary);
  const targetKey = resolve(project.brand).key;
  const { rows: pool, uncoded, core } = poolOf(data, kind === "objections" ? "doubt" : "keep_or_leave");
  if (pool.length === 0 && uncoded === 0) return null;

  const answerExits = exitResolver(project, dictionary, resolve, targetKey);
  const resolved = pool.map((r) => answerExits(r.code.destinations));
  const facts: Facts<V>[] = pool.map((row, i) => {
    const p = row.code.premise_verdict;
    return {
      row,
      verdict: verdictOf(row),
      premise: p === "confirms" || p === "mixed" || p === "rebuts" ? p : null,
      exits: resolved[i].exits,
      ownProduct: resolved[i].ownProduct,
    };
  });

  // Per worry: stage + concern.
  const groups = new Map<string, Facts<V>[]>();
  for (const f of facts) {
    const key = `${f.row.intent.stage}|${f.row.intent.concern ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const rows: WorryRow<V>[] = [...groups.entries()].map(([key, list]) => {
    const names = new Map<string, number>();
    for (const f of list) for (const x of f.exits.values()) names.set(x.name, (names.get(x.name) ?? 0) + 1);
    return {
      key,
      stage: list[0].row.intent.stage,
      concern: list[0].row.intent.concern ?? "",
      answers: list.length,
      verdicts: verdictCells(list, verdicts),
      premise: premiseCells(list),
      offersExit: exitCell(list),
      topExits: [...names.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4)
        .map(([name, n]) => ({ name, n })),
    };
  });
  rows.sort(
    (a, b) =>
      STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || b.answers - a.answers || a.concern.localeCompare(b.concern)
  );

  const matrix = Object.fromEntries(
    PREMISES.map((p) => [p, verdictCells(facts.filter((f) => f.premise === p), verdicts)])
  ) as Record<Premise, Record<V, RateCell>>;
  const offersExitBy = Object.fromEntries(
    verdicts.map((v) => [v, exitCell(facts.filter((f) => f.verdict === v))])
  ) as Record<V, RateCell>;

  const labels = new Map(ENGINES.map((e) => [e.id, e.label]));
  const stages = STAGE_ORDER.filter((s) => facts.some((f) => f.row.intent.stage === s));

  return {
    kind,
    brand: project.brand,
    answers: facts.length,
    uncoded,
    stages,
    verdicts: verdictCells(facts, verdicts),
    premise: premiseCells(facts),
    matrix,
    offersExit: exitCell(facts),
    offersExitBy,
    ownProduct: cell(count(facts, (f) => f.ownProduct), facts.length),
    rows,
    exits: exitRows(
      facts.map((f, i) => ({ verdict: f.verdict, exits: resolved[i].exits })),
      verdicts
    ),
    outsideExits: outsideCounts(resolved),
    byEngine: [...core]
      .map((m) => sliceOf(m, labels.get(m) ?? m, facts.filter((f) => f.row.model === m), verdicts))
      .filter((s) => s.answers > 0),
    byStage: stages.map((s) => sliceOf(s, s, facts.filter((f) => f.row.intent.stage === s), verdicts)),
  };
}

export function computeDoubt(data: ViewData): DoubtViews {
  return {
    runId: data.run.id,
    source: data.source,
    brand: data.project.brand,
    objections: computeKind(data, "objections", OBJECTION_VERDICTS, (r) => {
      const v = r.code.proceed_or_avoid;
      return v === "proceed" || v === "avoid" ? v : "undecided";
    }),
    keepOrLeave: computeKind(data, "keep_or_leave", STAY_VERDICTS, (r) => {
      const v = r.code.keep_or_leave;
      return v === "keep" || v === "leave" ? v : "undecided";
    }),
  };
}

const DOUBT_VERSION = "d1";
export function computeDoubtCached(run: Run, project: Project): Promise<DoubtViews | null> {
  return cachedView("doubt", DOUBT_VERSION, run, project, computeDoubt);
}
