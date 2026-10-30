import { ENGINES, engineDisplayLabel } from "./providers";
import { buildResolver, type Resolver } from "./brand_resolve";
import { cachedView, cell, poolOf, type PoolRow, type RateCell, type ViewData } from "./view_data";
import type { Project, Run } from "../types";

/**
 * The Value view (2026-10-27), never pooled into the headline (CODING_DECISIONS
 * section 8 / section 12: "within-brand view per room"). Every Value cell
 * names one of the client's lines and asks, for one room's buyer, whether it
 * is worth it over a generic cheaper option. Read: worth_it yes / depends /
 * no per room, and per designed line (rooms that share a line pool into it).
 *
 * The line each room asked about is the confirmed one in
 * projects.setup_decision (valueLines.decided[room].line); cells without a
 * record show no line. Alongside the verdict: the brands an answer
 * recommends instead, read from the answer's mentions - an active brand
 * other than the client framed recommended, on answers that say "no" or
 * "depends". Value cells name no rival, so these are the cheaper options the
 * AI puts forward on its own.
 */

export type { RateCell };

export type Worth = "yes" | "depends" | "no";
export const WORTH: readonly Worth[] = ["yes", "depends", "no"];

export interface ValueRow {
  key: string;
  label: string;
  /** Rooms in this row (one for a room row, every room sharing the line for a line row). */
  rooms: string[];
  line: string | null;
  counterpart: string | null;
  answers: number;
  worth: Record<Worth, RateCell>;
  /** Of the "no" and "depends" answers, how many recommend another brand. */
  recommendsInstead: RateCell;
  instead: { name: string; n: number }[];
}

export interface ValueSlice {
  key: string;
  label: string;
  answers: number;
  worth: Record<Worth, RateCell>;
}

export interface ValueView {
  runId: string;
  source: string;
  brand: string;
  answers: number;
  uncoded: number;
  worth: Record<Worth, RateCell>;
  recommendsInstead: RateCell;
  instead: { name: string; n: number }[];
  rooms: ValueRow[];
  lines: ValueRow[];
  byEngine: ValueSlice[];
}

interface Facts {
  row: PoolRow;
  room: string;
  worth: Worth;
  /** Active brands other than the client the answer recommends. */
  instead: Map<string, string>;
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

function worthCells(list: Facts[]): Record<Worth, RateCell> {
  return Object.fromEntries(WORTH.map((w) => [w, cell(count(list, (f) => f.worth === w), list.length)])) as Record<Worth, RateCell>;
}

function insteadOf(list: Facts[], limit: number) {
  const doubting = list.filter((f) => f.worth !== "yes");
  const m = new Map<string, number>();
  for (const f of doubting) for (const name of f.instead.values()) m.set(name, (m.get(name) ?? 0) + 1);
  return {
    recommendsInstead: cell(count(doubting, (f) => f.instead.size > 0), doubting.length),
    instead: [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, n]) => ({ name, n })),
  };
}

/** Room -> the confirmed line and counterpart, from the setup decision. */
function decidedLines(json: string | null | undefined): Map<string, { line: string; counterpart: string | null }> {
  const out = new Map<string, { line: string; counterpart: string | null }>();
  if (!json) return out;
  try {
    const decided = (JSON.parse(json) as { valueLines?: { decided?: Record<string, unknown> } }).valueLines?.decided ?? {};
    for (const [room, v] of Object.entries(decided)) {
      if (typeof v === "string") out.set(room, { line: v, counterpart: null });
      else if (v && typeof v === "object" && typeof (v as { line?: unknown }).line === "string") {
        const c = (v as { counterpart?: unknown }).counterpart;
        out.set(room, { line: (v as { line: string }).line, counterpart: typeof c === "string" ? c : null });
      }
    }
  } catch {
    // An unreadable record shows no lines; the verdicts still read.
  }
  return out;
}

function factsOf(row: PoolRow, resolve: Resolver, targetKey: string): Facts {
  const instead = new Map<string, string>();
  for (const m of row.code.mentions ?? []) {
    if (m.framing !== "recommended") continue;
    const r = resolve(m.brand);
    if (r.status === "active" && r.key !== targetKey) instead.set(r.key, r.name);
  }
  const w = row.code.worth_it;
  return {
    row,
    room: row.intent.situation ?? "",
    worth: w === "yes" || w === "no" ? w : "depends",
    instead,
  };
}

export function computeValue(data: ViewData): ValueView | null {
  const { project, dictionary } = data;
  const { rows: pool, uncoded, core } = poolOf(data, "value");
  if (pool.length === 0 && uncoded === 0) return null;
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const lines = decidedLines(data.setupDecision);
  const facts = pool.map((r) => factsOf(r, resolve, targetKey));

  const rowOf = (key: string, label: string, list: Facts[]): ValueRow => {
    const rooms = [...new Set(list.map((f) => f.room))];
    const ls = [...new Set(rooms.map((r) => lines.get(r)?.line ?? null))];
    const cs = [...new Set(rooms.map((r) => lines.get(r)?.counterpart ?? null))];
    return {
      key,
      label,
      rooms,
      line: ls.length === 1 ? ls[0] : null,
      counterpart: cs.length === 1 ? cs[0] : null,
      answers: list.length,
      worth: worthCells(list),
      ...insteadOf(list, 4),
    };
  };

  const byRoom = new Map<string, Facts[]>();
  for (const f of facts) byRoom.set(f.room, [...(byRoom.get(f.room) ?? []), f]);
  const rooms = [...byRoom.entries()]
    .map(([room, list]) => rowOf(room, room || "No room", list))
    .sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));

  const byLine = new Map<string, Facts[]>();
  for (const f of facts) {
    const line = lines.get(f.room)?.line;
    if (line) byLine.set(line, [...(byLine.get(line) ?? []), f]);
  }
  const lineRows = [...byLine.entries()]
    .map(([line, list]) => rowOf(line, line, list))
    .sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));

  const labels = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));
  return {
    runId: data.run.id,
    source: data.source,
    brand: project.brand,
    answers: facts.length,
    uncoded,
    worth: worthCells(facts),
    ...insteadOf(facts, 10),
    rooms,
    lines: lineRows,
    byEngine: [...core]
      .map((m) => {
        const list = facts.filter((f) => f.row.model === m);
        return { key: m, label: labels.get(m) ?? m, answers: list.length, worth: worthCells(list) };
      })
      .filter((s) => s.answers > 0),
  };
}

// v2 (2026-10-28): names resolve through the context judge (context_judge.ts).
const VALUE_VERSION = "v3";
export function computeValueCached(run: Run, project: Project): Promise<ValueView | null> {
  return cachedView("value", VALUE_VERSION, run, project, computeValue, { setupDecision: true, judge: true });
}
