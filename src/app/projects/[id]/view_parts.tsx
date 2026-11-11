"use client";

import { createContext, Fragment, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { RateCell } from "@/lib/engine/view_data";
import type { DossierTheme } from "@/lib/engine/reason_themes";
import { InlineSpinner } from "../../components/spinner";
import AnswerText from "./answer_text";
import { Download, HeadLabel, SortTable, Tip, type Col } from "./table";

/** Shared pieces of the per-type views (alternatives, doubt): rate text with
 * its 95% range, rate columns, stacked bars and their legends. */

export const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
export const pct = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = rate(c);
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
export const range = (c: RateCell) =>
  c.n === 0 ? "no answers" : `${c.k} of ${c.n} - 95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%`;

/** The one muted base line a section may carry (surface rule, 2026-11-01):
 * counts never sit on cards, strips or cells; a section states its base once. */
export function BaseNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-ink-3">{children}</p>;
}

/** Answer counts for a section's base line: "1,105". */
export const fmtN = (n: number) => n.toLocaleString("en-US");

/** A ranked list of brand names. The count behind each name is its hover,
 * never printed; `you` marks the client; `own` chips the client's own
 * cheaper line or plan (Value). */
export function Names({ items, empty = "-" }: { items: { name: string; n: number; you?: boolean; own?: boolean }[]; empty?: string }) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <>
      {items.map((x, i) => (
        <span key={x.name}>
          {i > 0 && ", "}
          <span title={`${x.n} answers`} className={x.you ? "font-medium text-ink" : undefined}>
            {x.name}
          </span>
          {x.own && (
            <span
              title="Your own cheaper line or plan"
              className="ml-1 rounded-full bg-primary-soft px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-primary"
            >
              own
            </span>
          )}
        </span>
      ))}
    </>
  );
}

/** Two shares on one 0-100% track: a muted dot (`a`), an accent dot (`b`),
 * a thin connector between them. Used for named vs picked. */
export function DotTrack({ a, b, emphasis }: { a: number; b: number; emphasis?: boolean }) {
  const pos = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const dot = "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface";
  return (
    <div className="relative h-4" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
      <div
        className={`absolute top-1/2 -translate-y-1/2 ${emphasis ? "h-[3px] bg-primary/50" : "h-[2px] bg-neutral-bar"}`}
        style={{ left: pos(lo), width: `${(Math.min(1, hi) - Math.max(0, lo)) * 100}%` }}
      />
      <span className={`${dot} h-3 w-3 bg-ink-3/60`} style={{ left: pos(a) }} />
      <span className={`${dot} bg-primary ${emphasis ? "h-3.5 w-3.5" : "h-3 w-3"}`} style={{ left: pos(b) }} />
    </div>
  );
}

export function RateText({ cell }: { cell: RateCell }) {
  return (
    <Tip tip={range(cell)}>
      <span className="cursor-help">{pct(cell)}</span>
    </Tip>
  );
}

/** A share of a sub-base drawn as a percent, its "k of n" on hover. */
export function ShareOf({ k, n }: { k: number; n: number }) {
  if (n === 0) return <span className="text-ink-3">-</span>;
  const x = k / n;
  return (
    <Tip tip={`${k} of ${n}`}>
      <span className="cursor-help">{x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`}</span>
    </Tip>
  );
}

export const rateCol = <T,>(id: string, label: string, tip: string, get: (r: T) => RateCell): Col<T> => ({
  id,
  label,
  tip,
  num: true,
  val: (r) => (get(r).n > 0 ? Math.round(rate(get(r)) * 1000) / 10 : null),
  render: (r) => <RateText cell={get(r)} />,
});

export interface Part<K extends string> {
  key: K;
  label: string;
  color: string;
}

export function StackBar<K extends string>({ parts, cells }: { parts: readonly Part<K>[]; cells: Record<K, RateCell> }) {
  return (
    <div className="flex h-3 w-full min-w-[8rem] overflow-hidden rounded-[3px]">
      {parts.map((p) => (
        <div
          key={p.key}
          className={p.color}
          style={{ width: `${rate(cells[p.key]) * 100}%` }}
          title={`${p.label}: ${cells[p.key].k} of ${cells[p.key].n}`}
        />
      ))}
    </div>
  );
}

export function Legend<K extends string>({ parts, cells }: { parts: readonly Part<K>[]; cells?: Record<K, RateCell> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {parts.map((p) => (
        <span key={p.key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-[3px] ${p.color}`} />
          {p.label}
          {cells && ` ${pct(cells[p.key])}`}
        </span>
      ))}
    </div>
  );
}

/** One answer behind a view's sample ids, as /api/runs/[id]/answer_texts
 * returns it. */
export interface SampleAnswer {
  id: string;
  engine: string;
  engineLabel: string;
  question: string;
  text: string;
}

/** What opens the answers modal: the sample ids a view payload carries, plus
 * how to title them and what to mark in the prose. */
export interface AnswersTarget {
  title: string;
  subtitle?: string;
  ids: string[];
  /** Literal phrases to mark in the answers (case-insensitive). */
  highlight?: string[];
}

/**
 * The answers behind a view figure, fetched by id when opened (never
 * eagerly). Overlay rather than an in-flow panel, like the evidence drawer:
 * opening it must not push the figures being read off screen.
 */
export function AnswersModal({ runId, target, onClose }: { runId: string; target: AnswersTarget; onClose: () => void }) {
  const [answers, setAnswers] = useState<SampleAnswer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = target.ids.join(",");

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/answer_texts?ids=${encodeURIComponent(key)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Could not load these answers (${r.status})`);
        const d = (await r.json()) as { answers: SampleAnswer[] };
        if (live) setAnswers(d.answers);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId, key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={target.title}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="grid w-full max-w-2xl content-start overflow-hidden rounded-xl border border-line bg-[var(--color-surface)] shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{target.title}</h3>
            {target.subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{target.subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none text-ink-3 hover:text-ink">
            ×
          </button>
        </div>
        <div className="grid max-h-[75vh] content-start gap-4 overflow-y-auto p-4">
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {!error && !answers && (
            <p className="text-[13px] text-ink-3">
              <InlineSpinner className="mr-1.5" />
              Loading the answers...
            </p>
          )}
          {answers?.length === 0 && <p className="text-[13px] text-ink-3">No answers to show.</p>}
          {answers?.map((a, i) => (
            <div key={a.id} className={`grid gap-1.5 ${i > 0 ? "border-t border-line/60 pt-4" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                <span className="rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-primary">{a.engineLabel}</span>
                <span>
                  answer {i + 1} of {answers.length}
                </span>
              </div>
              {a.question && <p className="text-[12px] font-medium text-ink-2">&ldquo;{a.question}&rdquo;</p>}
              <div className="max-h-72 overflow-y-auto border-l-2 border-line pl-3">
                <AnswerText text={a.text} highlight={target.highlight ?? []} />
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

// ---------- The Panel lens (2026-11-03) ----------

/** The engine set every codes-era section reads under: registry ids, sorted;
 * null = the whole core panel. Provided by the results shell. */
export const EngineSetContext = createContext<string[] | null>(null);
export const useEngineSet = () => useContext(EngineSetContext);

/** A view route's query string for the buyer filter and the engine set -
 * "" when neither is set, so an unfiltered fetch is exactly the old URL. */
export function viewQuery({ room, engines }: { room?: string | null; engines?: readonly string[] | null }): string {
  const q = new URLSearchParams();
  if (room) q.set("room", room);
  if (engines && engines.length > 0) q.set("engines", engines.join(","));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Wilson 95% interval - the same math as engine/metrics.ts wilson(). */
export function wilsonCell(k: number, n: number): RateCell {
  if (n === 0) return { k, n, low: 0, high: 0 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, low: Math.max(0, c - h), high: Math.min(1, c + h) };
}

export type EngineTier = "free" | "paid" | "both";
/** The facets every by-engine slice carries (engine/providers.ts engineFacets). */
export interface EngineRow {
  key: string;
  label: string;
  answers: number;
  vendor: string;
  tier: EngineTier;
  mode: "instinct" | "search";
}

export type EngineGroupBy = "engine" | "vendor" | "tier" | "mode";
const GROUP_BY_LABEL: Record<EngineGroupBy, string> = { engine: "Engine", vendor: "Vendor", tier: "Tier", mode: "Mode" };
export const TIER_LABEL: Record<EngineTier, string> = { free: "Free tiers", paid: "Paid tiers", both: "Free & paid" };
export const MODE_LABEL: Record<EngineRow["mode"], string> = { search: "Search on", instinct: "Instinct only" };

const isCell = (v: unknown): v is RateCell =>
  !!v && typeof v === "object" && typeof (v as RateCell).k === "number" && typeof (v as RateCell).n === "number" &&
  typeof (v as RateCell).low === "number" && typeof (v as RateCell).high === "number";

/** Pools engine slices into one row: every rate cell becomes sum k / sum n
 * with its range recomputed, numbers sum, nested records pool field by
 * field; strings come from the first member (key / label are set after). */
function poolValue(values: unknown[]): unknown {
  const first = values[0];
  if (isCell(first)) {
    const k = values.reduce<number>((a, v) => a + (v as RateCell).k, 0);
    const n = values.reduce<number>((a, v) => a + (v as RateCell).n, 0);
    return wilsonCell(k, n);
  }
  if (typeof first === "number") return values.reduce<number>((a, v) => a + (v as number), 0);
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(first)) out[key] = poolValue(values.map((v) => (v as Record<string, unknown>)[key]));
    return out;
  }
  return first;
}
export function poolSlices<T extends EngineRow>(members: T[], key: string, label: string): T {
  const pooled = poolValue(members) as T;
  const same = <K extends keyof EngineRow>(f: K) => (members.every((m) => m[f] === members[0][f]) ? members[0][f] : undefined);
  return {
    ...pooled,
    key,
    label,
    vendor: same("vendor") ?? label,
    tier: same("tier") ?? "both",
    mode: same("mode") ?? members[0].mode,
  };
}

// One Group-by preference shared by every by-engine table on the page.
const GROUP_KEY = "procerno_engine_group";
const GROUP_EVENT = "procerno-engine-group";
// Where the choice lives when storage is blocked (private windows).
let memGroup: EngineGroupBy = "engine";
function readGroup(): EngineGroupBy {
  try {
    const v = window.localStorage.getItem(GROUP_KEY);
    return v === "vendor" || v === "tier" || v === "mode" ? v : "engine";
  } catch {
    return memGroup;
  }
}
function subscribeGroup(cb: () => void) {
  window.addEventListener(GROUP_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(GROUP_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
export function useEngineGroup(): [EngineGroupBy, (g: EngineGroupBy) => void] {
  const group = useSyncExternalStore(subscribeGroup, readGroup, () => "engine" as EngineGroupBy);
  const set = (g: EngineGroupBy) => {
    memGroup = g;
    try {
      if (g === "engine") window.localStorage.removeItem(GROUP_KEY);
      else window.localStorage.setItem(GROUP_KEY, g);
    } catch {
      // storage blocked: memGroup carries the choice for this page view
    }
    window.dispatchEvent(new Event(GROUP_EVENT));
  };
  return [group, set];
}

const groupOf = (r: EngineRow, by: EngineGroupBy): { key: string; label: string } => {
  if (by === "vendor") return { key: `v:${r.vendor}`, label: r.vendor };
  if (by === "tier") return { key: `t:${r.tier}`, label: TIER_LABEL[r.tier] };
  return { key: `m:${r.mode}`, label: MODE_LABEL[r.mode] };
};

/**
 * Every by-engine table (2026-11-03): the section's own columns, with a
 * Group-by toggle - Engine (one row per engine, the plain sortable table) /
 * Vendor / Tier / Mode. A grouped row is the POOLED rate over its member
 * engines (sum k over sum n, its range recomputed), marked pooled and
 * expandable to the member engines beneath, so it is never read as one
 * engine. Rows without facets (older payloads) fall back to Engine.
 */
export function EngineTable<T extends EngineRow>({
  cols,
  rows,
  filename,
  defaultSort,
}: {
  cols: Col<T>[];
  rows: T[];
  filename: string;
  defaultSort?: { id: string; dir: 1 | -1 };
}) {
  const [stored, setGroup] = useEngineGroup();
  const hasFacets = rows.every((r) => typeof r.vendor === "string" && typeof r.tier === "string");
  const by: EngineGroupBy = hasFacets ? stored : "engine";
  const toggle = hasFacets && rows.length > 1 && (
    <div className="flex flex-wrap items-center gap-1 text-[12px]">
      <span className="text-ink-3 mr-0.5">Group by:</span>
      {(Object.keys(GROUP_BY_LABEL) as EngineGroupBy[]).map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => setGroup(g)}
          aria-pressed={by === g}
          className={`rounded-full border px-2 py-0.5 transition-colors ${
            by === g ? "border-[var(--color-primary)] bg-primary-soft text-primary" : "border-line text-ink-2 hover:border-ink-3"
          }`}
        >
          {GROUP_BY_LABEL[g]}
        </button>
      ))}
    </div>
  );
  if (by === "engine") {
    return (
      <div className="mt-2 grid gap-1">
        {toggle}
        <SortTable cols={cols} rows={rows} filename={filename} defaultSort={defaultSort} />
      </div>
    );
  }
  return (
    <div className="mt-2 grid gap-1">
      {toggle}
      <GroupedTable cols={cols} rows={rows} by={by} filename={filename} defaultSort={defaultSort} />
    </div>
  );
}

function GroupedTable<T extends EngineRow>({
  cols,
  rows,
  by,
  filename,
  defaultSort,
}: {
  cols: Col<T>[];
  rows: T[];
  by: Exclude<EngineGroupBy, "engine">;
  filename: string;
  defaultSort?: { id: string; dir: 1 | -1 };
}) {
  const shown = cols.filter((c) => !c.csvOnly);
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>(defaultSort ?? { id: shown[1]?.id ?? shown[0].id, dir: -1 });
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const buckets = new Map<string, { label: string; members: T[] }>();
  for (const r of rows) {
    const g = groupOf(r, by);
    const b = buckets.get(g.key) ?? { label: g.label, members: [] };
    b.members.push(r);
    buckets.set(g.key, b);
  }
  const groups = [...buckets.entries()].map(([key, b]) => ({ key, members: b.members, row: poolSlices(b.members, key, b.label) }));
  const col = cols.find((c) => c.id === sort.id);
  const cmp = (a: T, b: T) => {
    if (!col) return 0;
    const va = col.val(a);
    const vb = col.val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sort.dir === 1 ? c : -c;
  };
  groups.sort((a, b) => cmp(a.row, b.row));
  for (const g of groups) g.members.sort(cmp);
  const first = shown[0];
  const cellOf = (c: Col<T>, r: T) => (c.render ? c.render(r) : c.val(r) ?? "-");
  return (
    <div className="mt-1 grid gap-1">
      <Download
        name={filename.replace(/\.csv$/, "")}
        header={[GROUP_BY_LABEL[by], ...cols.map((c) => c.label)]}
        rows={() =>
          groups.flatMap((g) => [
            [`${g.row.label} (pooled)`, ...cols.map((c) => c.val(g.row))],
            ...g.members.map((m) => [g.row.label, ...cols.map((c) => c.val(m))]),
          ])
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3 border-b border-line">
              {shown.map((c, i) => {
                const label = i === 0 ? GROUP_BY_LABEL[by] : c.label;
                const arrow = sort.id === c.id ? (sort.dir === -1 ? "↓" : "↑") : "";
                return (
                  <th
                    key={c.id}
                    onClick={() => setSort((prev) => (prev.id === c.id ? { id: c.id, dir: prev.dir === 1 ? -1 : 1 } : { id: c.id, dir: -1 }))}
                    className={`py-2 ${i === shown.length - 1 ? "" : "pr-3"} font-semibold cursor-pointer select-none hover:opacity-70 ${c.num ? "text-center" : ""}`}
                  >
                    {c.tip && i > 0 ? (
                      <Tip tip={c.tip}>
                        <span className="cursor-help border-b border-dotted border-ink-3/50">
                          <HeadLabel label={label} arrow={arrow} />
                        </span>
                      </Tip>
                    ) : (
                      <HeadLabel label={label} arrow={arrow} />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = open.has(g.key);
              return (
                <Fragment key={g.key}>
                  <tr className="border-b border-line/60">
                    {shown.map((c, i) => (
                      <td key={c.id} className={`py-2 ${i === shown.length - 1 ? "" : "pr-3"} ${c.num ? "text-center tabular-nums" : ""}`}>
                        {i === 0 ? (
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() =>
                              setOpen((s) => {
                                const next = new Set(s);
                                if (next.has(g.key)) next.delete(g.key);
                                else next.add(g.key);
                                return next;
                              })
                            }
                            title={`Pooled over ${g.members.map((m) => m.label).join(", ")}`}
                            className="inline-flex items-center gap-1.5 text-left font-medium text-ink hover:text-primary"
                          >
                            <span className="inline-block w-3 text-ink-3">{isOpen ? "▾" : "▸"}</span>
                            {g.row.label}
                            <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              pooled
                            </span>
                          </button>
                        ) : (
                          cellOf(c, g.row)
                        )}
                      </td>
                    ))}
                  </tr>
                  {isOpen &&
                    g.members.map((m) => (
                      <tr key={`${g.key}:${m.key}`} className="border-b border-line/40 bg-primary-soft/10 text-ink-2">
                        {shown.map((c, i) => (
                          <td key={c.id} className={`py-1.5 ${i === shown.length - 1 ? "" : "pr-3"} ${c.num ? "text-center tabular-nums" : ""} ${i === 0 ? "pl-5" : ""}`}>
                            {i === 0 ? first && (first.render ? first.render(m) : m.label) : cellOf(c, m)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- The reasons (option D, 2026-11-09): one treatment on both surfaces ----------

/** Receipts are verbatim slices of LLM answers, so they arrive with raw
 * markdown in them. Strip the formatting for display only - the verbatim
 * form stays in the payload, since the evidence drill matches it against
 * the answer body for highlighting. */
export function plainQuote(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)([^*_]+)\1/g, "$2") // italics
    .replace(/`+([^`]*)`+/g, "$1") // inline code
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "") // heads, blockquotes, bullets
    .replace(/\s*\n\s*/g, " ") // a quote renders as one line
    .replace(/(^|\s)#{1,6}\s+(?=\S)/g, "$1") // a heading marker left mid-quote
    .trim();
}

/** A label-left, value-right row on a dashed rule (the panels' figure row).
 * `value` is text; a caller may pass a node (a receipt link) instead. */
export function Fig({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-line py-1.5 text-[13px]">
      <span className="min-w-0 text-ink-2">{label}</span>
      <span className="max-w-[60%] text-right tabular-nums text-ink">{value}</span>
    </div>
  );
}

export const WALL_TIP = "Lost to something the buyer already has, not to an argument";

/** The map's wall chip: a reason that is a state the buyer is in, not an argument. */
export function WallChip({ color }: { color: string }) {
  return (
    <span className="ml-1.5 rounded-[4px] border px-1 text-[10px] uppercase tracking-wide" style={{ borderColor: color, color }} title={WALL_TIP}>
      wall
    </span>
  );
}

/** A reason row ReasonList can carry: the label and its share, plus - for
 * the Stations blocks (2026-11-10) - the answers behind it (tooltip only),
 * receipt ids and, on the side that leaves you, where it sends the buyer. */
export interface ReasonRow {
  label: string;
  share: string;
  wall?: boolean;
  /** Answers stating it - the tooltip, never printed. */
  answers?: number;
  /** Sample response ids: with `onOpen`, the share opens them. */
  ids?: string[];
  /** Brands it sends the buyer to. */
  routes?: string[];
}

/** Receipt hand-off: the reason's label and its sample answer ids. */
export type OnOpenReason = (label: string, ids: string[]) => void;

/** The share, as a receipt link when the row carries ids and the caller can open them. */
function ShareValue({ row, onOpen }: { row: { label: string; share: string; answers?: number; ids?: string[] }; onOpen?: OnOpenReason }) {
  const counted = row.answers !== undefined ? `${row.answers} ${row.answers === 1 ? "answer" : "answers"}` : null;
  if (onOpen && row.ids && row.ids.length > 0)
    return (
      <button
        type="button"
        onClick={() => onOpen(row.label, row.ids!)}
        title={`${counted ? `${counted} - ` : ""}open the answers`}
        className="tabular-nums underline decoration-ink-3/40 decoration-dotted underline-offset-2 hover:decoration-ink-3"
      >
        {row.share}
      </button>
    );
  if (counted)
    return (
      <span title={counted} className="cursor-help">
        {row.share}
      </span>
    );
  return <>{row.share}</>;
}

/** Where a reason sends the buyer, in the panels' wording. */
function Routes({ routes }: { routes?: string[] }) {
  if (!routes || routes.length === 0) return null;
  return <div className="-mt-0.5 mb-0.5 text-[11.5px] text-ink-3">Sent to {routes.join(", ")}</div>;
}

/**
 * One side's reasons - the dossier's slide-over and the map's position panel
 * render it the same way. Themes come per buying situation and are merged
 * across situations: a theme row reads like a reason row, and its toggle
 * opens everything beneath at once - the situation buckets, each with its own
 * reasons a step further in. Themes render only when at least one has
 * buckets; otherwise (keyless, a failed theme pass, or an older payload) the
 * flat list renders. The list leads with the biggest themes (THEME_TOP) and
 * folds the tail behind one toggle, so the full fall-out stays reachable.
 * Rows flagged wall carry the wall chip in `wallColor`.
 *
 * Stations (2026-11-10) add three optional props, none of which changes the
 * map or the dossier: `every` - the flat list of every stated reason with its
 * routes, shown under the same "See every reason" fold (and, when no themes
 * render, the fallback list itself, top THEME_TOP first); `onOpen` - shares
 * become receipt links where a row carries ids.
 */
const THEME_TOP = 8;
export function ReasonList({
  flat,
  themes,
  wallColor,
  every,
  onOpen,
}: {
  flat: ReasonRow[];
  themes: (DossierTheme & { answers?: number; ids?: string[] })[];
  wallColor: string;
  every?: ReasonRow[];
  onOpen?: OnOpenReason;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const quoted = (label: string, wall?: boolean) => (
    <>
      {`"${label}"`}
      {wall && <WallChip color={wallColor} />}
    </>
  );
  const flatRows = (rows: ReasonRow[]) =>
    rows.map((r, i) => (
      <div key={`${i}:${r.label}`}>
        <Fig label={quoted(r.label, r.wall)} value={<ShareValue row={r} onOpen={onOpen} />} />
        <Routes routes={r.routes} />
      </div>
    ));
  const foldButton = (show: boolean) =>
    show && (
      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        aria-expanded={showAll}
        className="mt-1.5 select-none text-[11.5px] text-ink-3 hover:text-ink-2"
      >
        {showAll ? "Show the biggest only ▾" : "See every reason ▸"}
      </button>
    );
  if (!themes.some((t) => (t.buckets ?? []).length > 0)) {
    if (every) {
      const shown = showAll ? every : every.slice(0, THEME_TOP);
      return (
        <>
          {flatRows(shown)}
          {foldButton(every.length > THEME_TOP)}
        </>
      );
    }
    return (
      <>
        {flat.map((r) => (
          <Fig key={r.label} label={quoted(r.label, r.wall)} value={r.share} />
        ))}
      </>
    );
  }
  const toggle = (label: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const shown = showAll ? themes : themes.slice(0, THEME_TOP);
  const folded = themes.length - shown.length;
  return (
    <>
      {shown.map((t, ti) => {
        const buckets = t.buckets ?? [];
        const tk = `${ti}:${t.label}`;
        const isOpen = open.has(tk);
        const situations = new Set(buckets.map((b) => b.scenario)).size;
        const related = buckets.length === 1 ? Math.max((buckets[0].members ?? []).length, 1) : buckets.length;
        const closed = situations > 1 ? `Across ${situations} situations` : `+ ${related} related`;
        return (
          <div key={tk}>
            <Fig label={quoted(t.label, t.wall)} value={onOpen || t.answers !== undefined ? <ShareValue row={t} onOpen={onOpen} /> : t.share} />
            {buckets.length > 0 && (
              <button
                type="button"
                onClick={() => toggle(tk)}
                aria-expanded={isOpen}
                className="mt-0.5 select-none text-[11.5px] text-ink-3 hover:text-ink-2"
              >
                {isOpen ? "Hide ▾" : `${closed} ▸`}
              </button>
            )}
            {isOpen && (
              <div className="mb-1 ml-2 border-l border-line pl-2.5">
                {buckets.map((b, i) => (
                  <div key={`${i}:${b.scenario}:${b.label}`}>
                    <Fig
                      label={
                        <>
                          {`"${b.label}"`}
                          {b.wall && <WallChip color={wallColor} />}
                          <span className="text-ink-3">{` · ${b.scenario}`}</span>
                        </>
                      }
                      value={b.share}
                    />
                    {(b.members ?? []).length > 0 && (
                      <div className="ml-2 text-[12px] [&>div]:py-1 [&>div]:text-[12px] [&_span:first-child]:text-ink-3">
                        {(b.members ?? []).map((m, k) => (
                          <Fig key={`${k}:${m.label}`} label={quoted(m.label, m.wall)} value={m.share} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {showAll && every && every.length > 0 && (
        <div className="mt-3">
          <div className="mb-0.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-3">Every stated reason</div>
          {flatRows(every)}
        </div>
      )}
      {foldButton(folded > 0 || (showAll && themes.length > THEME_TOP) || (!!every && every.length > 0))}
    </>
  );
}
