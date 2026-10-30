"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  WbOpenRow,
  WorkbenchView,
} from "@/lib/engine/workbench";
import { METRICS, metricTip } from "@/lib/metrics_dictionary";
import { HeadLabel, SortTable, Tip, downloadCsv } from "./table";

/**
 * The Workbench, answer_codes era (2026-10-30). One fetch per open: the
 * engine ships a compact per-answer fact table (engine, prompt, outcome,
 * resolved pick, mentions with framing in order of appearance, reasons) and
 * every filter - brand set, grain, engine scope, split - slices it here in
 * the browser. Changing a filter never refetches.
 *
 * Pools follow the presentation rule: Brands / Why / Battleground read the
 * open-choice (headline) pool; Risk's framing table reads every coded
 * answer, with the doubt verdicts rolled up beside it. Sources, Style and
 * the Answers reader are not here - their data is responses metadata or
 * answer bodies, not answer_codes, and each waits for its own round.
 */

const pct = (x: number) => {
  if (x > 0 && x < 0.005) return "<1%";
  return `${Math.round(x * 100)}%`;
};
const frac = (k: number, n: number) => `${k}/${n}`;

/** Wilson 95% interval - the same math as engine/metrics.ts wilson(). */
const wilson = (k: number, n: number) => {
  if (n === 0) return { low: 0, high: 0 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, center - m), high: Math.min(1, center + m) };
};
const ci = (k: number, n: number) => {
  const w = wilson(k, n);
  return `${pct(w.low)}–${pct(w.high)}`;
};

const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];

type WbView = "brands" | "why" | "battleground" | "risk";
const VIEWS: { id: WbView; label: string; sub: string }[] = [
  { id: "brands", label: "Brands", sub: "mentioned → chosen" },
  { id: "why", label: "Why", sub: "the arguments" },
  { id: "battleground", label: "Battleground", sub: "by prompt" },
  { id: "risk", label: "Risk", sub: "negatives & doubts" },
];

interface WbState {
  brandMode: "solo" | "comparative";
  soloBrand: string;
  compBrands: string[];
  grain: "brands" | "parents";
  split: "none" | "engine" | "mode";
  engines: string[];
  measure: "named" | "recommended" | "chosen" | "share" | "position";
  showCI: boolean;
  showCounts: boolean;
}

/** A row's grain-level identity: at brand grain each listed brand is its
 * own entity; at parent grain brands group by their parent label. */
interface Entity {
  name: string;
  members: Set<number>;
  isClient: boolean;
}

/** One entity's counts inside one facet of the open pool. */
interface EntityStats {
  named: number;
  rec: number;
  chosen: number;
  neg: number;
  first: number;
  posSum: number;
  posN: number;
  sov: number;
}
const emptyStats = (): EntityStats => ({
  named: 0, rec: 0, chosen: 0, neg: 0, first: 0, posSum: 0, posN: 0, sov: 0,
});

interface FacetData {
  label: string | null;
  engineSet: Set<number>;
  rows: WbOpenRow[];
  n: number;
  outcomes: [number, number, number, number];
  decided: number;
  /** All grain-entities' mention pairs - share-of-voice denominator. */
  sovDen: number;
  stats: EntityStats[];
}

export default function WorkbenchCodes({ runId }: { runId: string }) {
  const [data, setData] = useState<WorkbenchView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<WbView>("brands");
  const [st, setSt] = useState<WbState>({
    brandMode: "comparative",
    soloBrand: "",
    compBrands: [],
    grain: "brands",
    split: "none",
    engines: [],
    measure: "named",
    showCI: false,
    showCounts: false,
  });
  const storageKey = data ? `procerno_wbc_${data.projectId}` : null;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/${runId}/workbench`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const v: WorkbenchView | null = d?.view ?? null;
        // Saved filter preferences ride in with the data (one state pass, no
        // hydration effect); anything stale simply fails the option checks.
        if (v) {
          try {
            const saved = JSON.parse(
              window.localStorage.getItem(`procerno_wbc_${v.projectId}`) ?? "{}"
            );
            setSt((prev) => ({ ...prev, ...saved }));
          } catch {}
        }
        setData(v);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(st));
  }, [st, storageKey]);

  const set = (patch: Partial<WbState>) => setSt((p) => ({ ...p, ...patch }));

  // ---- entities at the chosen grain ----
  const clientBrandName = data ? data.brands[data.target].name : "";
  const hasParents = useMemo(
    () => (data ? data.brands.some((b) => b.listed && b.parent) : false),
    [data]
  );
  const grain = hasParents ? st.grain : "brands";
  const entities: Entity[] = useMemo(() => {
    if (!data) return [];
    if (grain === "brands") {
      return data.brands.flatMap((b, i) =>
        b.listed ? [{ name: b.name, members: new Set([i]), isClient: i === data.target }] : []
      );
    }
    const groups = new Map<string, Entity>();
    data.brands.forEach((b, i) => {
      if (!b.listed) return;
      const name = b.parent ?? b.name;
      const g = groups.get(name) ?? { name, members: new Set<number>(), isClient: false };
      g.members.add(i);
      if (i === data.target) g.isClient = true;
      groups.set(name, g);
    });
    return [...groups.values()];
  }, [data, grain]);
  const clientName = entities.find((e) => e.isClient)?.name ?? clientBrandName;
  const options = useMemo(() => entities.slice(0, 30).map((e) => e.name), [entities]);

  const selectedNames = useMemo(() => {
    if (st.brandMode === "solo") {
      const solo = options.includes(st.soloBrand) ? st.soloBrand : clientName;
      return [solo];
    }
    const list = st.compBrands.filter((b) => options.includes(b));
    if (list.length > 0) return list;
    const top5 = options.slice(0, 5);
    return top5.includes(clientName) ? top5 : [clientName, ...top5.slice(0, 4)];
  }, [st.brandMode, st.soloBrand, st.compBrands, options, clientName]);
  const selected = useMemo(
    () => selectedNames.flatMap((n) => entities.find((e) => e.name === n) ?? []),
    [selectedNames, entities]
  );
  const colorOf = (name: string) =>
    name === clientName
      ? SERIES[0]
      : SERIES[1 + (selectedNames.indexOf(name) % (SERIES.length - 1))];

  // ---- engine scope and facets ----
  const scopedEngineIdx = useMemo(() => {
    if (!data) return new Set<number>();
    const live = st.engines.length > 0
      ? data.engines.flatMap((e, i) => (st.engines.includes(e.id) ? [i] : []))
      : data.engines.map((_, i) => i);
    return new Set(live.length > 0 ? live : data.engines.map((_, i) => i));
  }, [data, st.engines]);

  const facets: FacetData[] = useMemo(() => {
    if (!data) return [];
    const defs: { label: string | null; set: Set<number> }[] =
      st.split === "engine"
        ? [...scopedEngineIdx].map((i) => ({ label: data.engines[i].label, set: new Set([i]) }))
        : st.split === "mode"
          ? (["instinct", "search"] as const)
              .map((m) => ({
                label: m === "search" ? "Search-enabled" : "Instinct",
                set: new Set([...scopedEngineIdx].filter((i) => data.engines[i].mode === m)),
              }))
              .filter((f) => f.set.size > 0)
          : [{ label: null, set: scopedEngineIdx }];

    // Grain map over ALL listed brands (share-of-voice needs every entity,
    // not only the selected ones).
    const groupOf = data.brands.map((b, i) =>
      !b.listed ? -1 : grain === "parents" ? 0 : i
    );
    if (grain === "parents") {
      const names = new Map<string, number>();
      data.brands.forEach((b, i) => {
        if (!b.listed) return;
        const g = b.parent ?? b.name;
        if (!names.has(g)) names.set(g, names.size);
        groupOf[i] = names.get(g)!;
      });
    }
    const memberOf = data.brands.map((_, i) =>
      selected.findIndex((e) => e.members.has(i))
    );

    return defs.map(({ label, set }) => {
      const rows = data.rows.filter((r) => set.has(r[0]));
      const outcomes: [number, number, number, number] = [0, 0, 0, 0];
      let decided = 0;
      let sovDen = 0;
      const stats = selected.map(emptyStats);
      for (const r of rows) {
        const [, , outcome, pick, mentions] = r;
        if (outcome >= 0) outcomes[outcome]++;
        if (pick >= 0) decided++;
        const seenGroups = new Set<number>();
        const seenSel = new Set<number>();
        mentions.forEach(([b], pos) => {
          const g = groupOf[b];
          if (g >= 0 && !seenGroups.has(g)) {
            seenGroups.add(g);
            sovDen++;
          }
          const s = memberOf[b];
          if (s < 0) return;
          const eStats = stats[s];
          if (!seenSel.has(s)) {
            seenSel.add(s);
            eStats.named++;
            eStats.sov++;
            if (pos === 0) eStats.first++;
            eStats.posSum += pos + 1;
            eStats.posN++;
          }
        });
        // Framing and pick per entity (OR across the entity's members).
        selected.forEach((e, s) => {
          let rec = false;
          let neg = false;
          for (const [b, bits] of mentions) {
            if (!e.members.has(b)) continue;
            if (bits & 1) rec = true;
            if (bits & 2) neg = true;
          }
          if (rec) stats[s].rec++;
          if (neg) stats[s].neg++;
          if (pick >= 0 && e.members.has(pick)) stats[s].chosen++;
        });
      }
      return { label, engineSet: set, rows, n: rows.length, outcomes, decided, sovDen, stats };
    });
  }, [data, st.split, scopedEngineIdx, selected, grain]);

  if (!loaded) {
    return (
      <div className="card px-6 py-10">
        <p className="text-sm text-ink-3">Loading the workbench…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card px-6 py-10">
        <p className="text-sm text-ink-3">No coded answers to slice yet.</p>
      </div>
    );
  }

  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${
      on
        ? "border-[var(--color-primary)] bg-primary-soft text-primary"
        : "border-line text-ink-3 hover:border-ink-3"
    }`;

  return (
    <div className="card overflow-hidden">
      {/* ---------- control bar ---------- */}
      <div className="grid gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 w-16">
            Compare
          </span>
          <button type="button" className={chip(st.brandMode === "solo")}
            onClick={() => set({ brandMode: "solo" })}>
            Solo
          </button>
          <button type="button" className={chip(st.brandMode === "comparative")}
            onClick={() => set({ brandMode: "comparative" })}>
            Multiple
          </button>
          {st.brandMode === "solo" ? (
            <select
              value={selectedNames[0]}
              onChange={(e) => set({ soloBrand: e.target.value })}
              className="input w-auto py-0.5 text-[12px] ml-1"
            >
              {[clientName, ...options.filter((o) => o !== clientName)].map((o) => (
                <option key={o} value={o}>
                  {o === clientName ? `${o} (client)` : o}
                </option>
              ))}
            </select>
          ) : (
            <>
              {selectedNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => set({ compBrands: selectedNames.filter((b) => b !== name) })}
                  className="rounded-full border px-2.5 py-0.5 text-[12px] font-semibold"
                  style={{ borderColor: colorOf(name), color: colorOf(name) }}
                  title="Remove from comparison"
                >
                  {name} ✕
                </button>
              ))}
              <AddBrand
                options={options.filter((o) => !selectedNames.includes(o))}
                onAdd={(b) => set({ compBrands: [...selectedNames, b] })}
              />
              <select
                value=""
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!n) return;
                  const top = options.filter((o) => o !== clientName).slice(0, n);
                  set({ compBrands: [clientName, ...top] });
                }}
                className="input w-auto py-0.5 text-[12px]"
                title="Replace the comparison with the most-mentioned brands, plus you"
              >
                <option value="">Top…</option>
                {[3, 5, 10, 15].map((n) => (
                  <option key={n} value={n}>
                    Top {n} + you
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasParents && (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 w-16">
                Grain
              </span>
              <button type="button" className={chip(grain === "brands")}
                onClick={() => set({ grain: "brands", compBrands: [], soloBrand: "" })}>
                Brands
              </button>
              <button type="button" className={chip(grain === "parents")}
                onClick={() => set({ grain: "parents", compBrands: [], soloBrand: "" })}>
                Parents
              </button>
            </>
          )}
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 w-16">
            Answers
          </span>
          <ScopeControl
            all={data.engines}
            selected={st.engines}
            split={st.split}
            onChange={(engines, split) => set({ engines, split })}
          />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 ml-2">
            Show
          </span>
          <button type="button" className={chip(st.showCI)}
            onClick={() => set({ showCI: !st.showCI })}
            title="Add 95% confidence-interval columns to every table">
            CI
          </button>
          <button type="button" className={chip(st.showCounts)}
            onClick={() => set({ showCounts: !st.showCounts })}
            title="Add the counts behind the rates to every table">
            Counts
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-[9.5rem_minmax(0,1fr)]">
        <nav className="border-b md:border-b-0 md:border-r border-line py-2 flex md:grid content-start overflow-x-auto">
          {VIEWS.map((v) => (
            <button key={v.id} type="button"
              onClick={() => setView(v.id)}
              className={`px-3 py-2 text-left whitespace-nowrap ${
                view === v.id
                  ? "font-semibold text-primary md:border-r-2 border-[var(--color-primary)] bg-primary-soft/40"
                  : "text-ink-2 hover:text-ink"
              }`}>
              <span className="text-sm">{v.label}</span>
              <span className="block text-[10px] text-ink-3 font-normal">{v.sub}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 grid gap-4 content-start min-h-[24rem]">
          <p className="text-[12px] text-ink-3 -mb-2">
            {view === "risk"
              ? `Framing over every coded answer (${data.rows.length + data.extra.length} on the core panel); the doubt verdicts beside it come from the worry questions.`
              : `Open buying questions only - ${data.answers} coded answers${data.uncoded > 0 ? ` (${data.uncoded} uncoded)` : ""}. Head-to-heads, doubts, value and the rest are measured in their own views.`}
          </p>
          {view === "brands" && (
            <Brands data={data} facets={facets} selected={selected} st={st} set={set}
              solo={st.brandMode === "solo"} colorOf={colorOf} />
          )}
          {view === "why" && (
            <Why data={data} facets={facets} selected={selected} counts={st.showCounts}
              colorOf={colorOf} />
          )}
          {view === "battleground" && (
            <Battleground data={data} facets={facets} selected={selected} colorOf={colorOf} />
          )}
          {view === "risk" && (
            <Risk data={data} facets={facets} selected={selected} st={st}
              clientName={clientName} colorOf={colorOf} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- shared bits ---------------- */

function AddBrand({ options, onAdd }: { options: string[]; onAdd: (brand: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  if (options.length === 0) return null;
  const shown = options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-[12px] font-medium text-ink-3 hover:border-ink-3 hover:text-ink-2">
        + add
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <span className="absolute left-0 top-full z-40 mt-1 block w-56 rounded-xl border border-line bg-surface p-2 shadow-lg">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Find a brand"
              className="input mb-1 w-full py-1 text-[12px]" />
            <span className="block max-h-56 overflow-y-auto">
              {shown.map((o) => (
                <button key={o} type="button"
                  onClick={() => {
                    onAdd(o);
                    setQ("");
                    setOpen(false);
                  }}
                  className="block w-full rounded-md px-2 py-1 text-left text-[13px] text-ink-2 hover:bg-primary-soft/40 hover:text-primary">
                  {o}
                </button>
              ))}
              {shown.length === 0 && (
                <span className="block px-2 py-1 text-[12px] text-ink-3">Nothing matches</span>
              )}
            </span>
          </span>
        </>
      )}
    </span>
  );
}

function ScopeControl({
  all, selected, split, onChange,
}: {
  all: { id: string; label: string; mode: "instinct" | "search" }[];
  selected: string[];
  split: "none" | "engine" | "mode";
  onChange: (engines: string[], split: "none" | "engine" | "mode") => void;
}) {
  const [open, setOpen] = useState(false);
  const live = selected.length > 0 ? selected : all.map((e) => e.id);
  const liveModes = new Set(all.filter((e) => live.includes(e.id)).map((e) => e.mode));
  const allOn = selected.length === 0 || selected.length === all.length;
  const onlyInstinct = liveModes.size === 1 && liveModes.has("instinct");
  const onlySearch = liveModes.size === 1 && liveModes.has("search");

  const summary = `${
    allOn
      ? `all ${all.length} engines`
      : `${live.length} ${onlySearch ? "search " : onlyInstinct ? "instinct " : ""}engine${live.length === 1 ? "" : "s"}`
  } · ${split === "none" ? "combined" : split === "engine" ? "by engine" : "by instrument"}`;

  const commit = (engines: string[], nextSplit = split) => {
    const nextLive = engines.length > 0 ? engines : all.map((e) => e.id);
    const modes = new Set(all.filter((e) => nextLive.includes(e.id)).map((e) => e.mode));
    let resolved = nextSplit;
    if (resolved === "engine" && nextLive.length < 2) resolved = "none";
    if (resolved === "mode" && modes.size < 2) resolved = "none";
    onChange(engines, resolved);
  };
  const pick = (mode: "all" | "instinct" | "search") =>
    commit(mode === "all" ? [] : all.filter((e) => e.mode === mode).map((e) => e.id));

  const splitOpts = [
    ["none", "Nothing"],
    ["engine", "Engine"],
    ["mode", "Instrument"],
  ] as const;

  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:border-ink-3">
        {summary} <span className="text-ink-3">▾</span>
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <span className="absolute left-0 top-full z-40 mt-1 block w-72 rounded-xl border border-line bg-surface p-4 shadow-lg">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Break out by
            </span>
            <span className="mb-1 flex flex-wrap gap-1.5">
              {splitOpts.map(([id, label]) => {
                const disabled =
                  (id === "engine" && live.length < 2) ||
                  (id === "mode" && liveModes.size < 2);
                return (
                  <button key={id} type="button" disabled={disabled}
                    onClick={() => commit(selected, id)}
                    className={`rounded-full border px-2.5 py-0.5 text-[12px] font-medium disabled:opacity-40 ${
                      split === id
                        ? "border-[var(--color-primary)] bg-primary-soft text-primary"
                        : "border-line text-ink-3 hover:border-ink-3"
                    }`}>
                    {label}
                  </button>
                );
              })}
            </span>
            <span className="mt-3 mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Include
              </span>
              <span className="flex gap-1.5">
                {(["all", "instinct", "search"] as const).map((m) => {
                  const active = m === "all" ? allOn : m === "instinct" ? onlyInstinct : onlySearch;
                  if (m !== "all" && !all.some((e) => e.mode === m)) return null;
                  return (
                    <button key={m} type="button" onClick={() => pick(m)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        active
                          ? "border-[var(--color-primary)] bg-primary-soft text-primary"
                          : "border-line text-ink-3 hover:border-ink-3"
                      }`}>
                      {m === "all" ? "All" : m === "instinct" ? "Instinct" : "Search"}
                    </button>
                  );
                })}
              </span>
            </span>
            <span className="grid gap-1">
              {all.map((e) => {
                const on = live.includes(e.id);
                return (
                  <label key={e.id}
                    className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                    <input type="checkbox" checked={on}
                      onChange={() => {
                        const next = on ? live.filter((x) => x !== e.id) : [...live, e.id];
                        if (next.length === 0) return;
                        commit(next.length === all.length ? [] : next);
                      }}
                      className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
                    {e.label}
                    {e.mode === "search" && (
                      <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                        search
                      </span>
                    )}
                  </label>
                );
              })}
            </span>
          </span>
        </>
      )}
    </span>
  );
}

function GroupLabel({ label }: { label: string | null }) {
  if (!label) return null;
  return <div className="section-label -mb-1">{label}</div>;
}

function Bar({ w, color }: { w: number; color: string }) {
  return (
    <div className="h-4 relative">
      <div className="absolute inset-y-0 left-0 rounded-r-[4px]"
        style={{ width: `${Math.min(w, 1) * 100}%`, background: color }} />
    </div>
  );
}

function SeriesBars({
  rows,
}: {
  rows: { label: string; color: string; value: number | null; right: string }[];
}) {
  const max = Math.max(...rows.map((r) => r.value ?? 0), 0.01);
  return (
    <div className="grid gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[10rem_1fr_11rem] items-center gap-3">
          <span className="truncate text-sm text-right font-medium" style={{ color: r.color }}>
            {r.label}
          </span>
          <Bar w={(r.value ?? 0) / max} color={r.color} />
          <span className="text-[13px] tabular-nums text-ink-2">{r.right}</span>
        </div>
      ))}
    </div>
  );
}

const slugify = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "_");

/* ---------------- Brands ---------------- */

function Brands({
  data, facets, selected, st, set, solo, colorOf,
}: {
  data: WorkbenchView;
  facets: FacetData[];
  selected: Entity[];
  st: WbState;
  set: (p: Partial<WbState>) => void;
  solo: boolean;
  colorOf: (name: string) => string;
}) {
  const measures = [
    ["named", METRICS.mentionedRate.label],
    ["recommended", METRICS.recommended.label],
    ["chosen", METRICS.chosen.label],
    ["share", METRICS.shareOfDecided.label],
    ["position", METRICS.avgPosition.label],
  ] as const;
  return (
    <>
      {!solo && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Chart
          </span>
          {measures.map(([id, label]) => (
            <button key={id} type="button" onClick={() => set({ measure: id })}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${
                st.measure === id
                  ? "border-[var(--color-primary)] bg-primary-soft text-primary"
                  : "border-line text-ink-3 hover:border-ink-3"
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-8">
        {facets.map((f) => (
          <BrandsGroup key={f.label ?? "all"} data={data} f={f} selected={selected}
            st={st} solo={solo} colorOf={colorOf} />
        ))}
      </div>
    </>
  );
}

type BrandRow = { e: Entity; s: EntityStats; n: number; decided: number; sovDen: number };

function BrandsGroup({
  data, f, selected, st, solo, colorOf,
}: {
  data: WorkbenchView;
  f: FacetData;
  selected: Entity[];
  st: WbState;
  solo: boolean;
  colorOf: (name: string) => string;
}) {
  const rows: BrandRow[] = selected.map((e, i) => ({
    e, s: f.stats[i], n: f.n, decided: f.decided, sovDen: f.sovDen,
  }));
  const [pick, cond, noPick, clar] = f.outcomes;
  const total = pick + cond + noPick + clar || 1;
  if (f.n === 0) {
    return (
      <div className="grid gap-2">
        <GroupLabel label={f.label} />
        <p className="text-sm text-ink-3">No answers in this slice.</p>
      </div>
    );
  }
  if (solo) {
    const r = rows[0];
    if (!r) return null;
    const engineRows = data.engines.flatMap((eng, i) => {
      if (!f.engineSet.has(i)) return [];
      let named = 0;
      let n = 0;
      for (const row of f.rows) {
        if (row[0] !== i) continue;
        n++;
        if (row[4].some(([b]) => r.e.members.has(b))) named++;
      }
      return n > 0
        ? [{ label: eng.label, color: colorOf(r.e.name), value: named / n, right: st.showCounts ? frac(named, n) : pct(named / n) }]
        : [];
    });
    return (
      <div className="grid gap-4">
        <GroupLabel label={f.label} />
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {[
            [pct(r.s.named / r.n), "named"],
            [pct(r.s.first / r.n), "first-named"],
            [pct(r.s.rec / r.n), "recommended"],
            [pct(r.s.chosen / r.n), "chosen"],
            [r.sovDen > 0 ? pct(r.s.sov / r.sovDen) : "—", "share of voice"],
            [r.s.posN > 0 ? `#${(r.s.posSum / r.s.posN).toFixed(1)}` : "—", "avg position"],
          ].map(([v, l]) => (
            <div key={l}>
              <div className="text-2xl font-semibold tabular-nums">{v}</div>
              <div className="text-[11px] text-ink-3">{l}</div>
            </div>
          ))}
        </div>
        {engineRows.length > 1 && (
          <div>
            <div className="section-label mb-2">Named rate by engine</div>
            <SeriesBars rows={engineRows} />
          </div>
        )}
      </div>
    );
  }
  const valOf = (r: BrandRow): number | null =>
    st.measure === "recommended" ? r.s.rec / r.n
    : st.measure === "chosen" ? r.s.chosen / r.n
    : st.measure === "share" ? (r.decided > 0 ? r.s.chosen / r.decided : 0)
    : st.measure === "position" ? (r.s.posN > 0 ? r.s.posSum / r.s.posN : null)
    : r.s.named / r.n;
  const fmt = (v: number | null) =>
    v === null ? "—" : st.measure === "position" ? `#${v.toFixed(1)}` : pct(v);
  const chartRows = rows.map((r) => ({ label: r.e.name, color: colorOf(r.e.name), raw: valOf(r) }));
  const best =
    st.measure === "position"
      ? Math.min(...chartRows.map((r) => r.raw ?? Infinity))
      : null;
  return (
    <div className="grid gap-4">
      <GroupLabel label={f.label} />
      <div className="rounded-xl border border-line p-4">
        <div className="section-label mb-2">
          Decisiveness — committed = the answer crowned ONE product as its pick
        </div>
        <Tip tip={`${pct(cond / total)} recommended different options for different situations · ${pct(noPick / total)} explained the options without recommending · ${pct(clar / total)} asked the user a question instead`}>
          <div className="flex items-baseline gap-2 cursor-help">
            <span className="text-xl font-semibold tabular-nums">{pct(pick / total)}</span>
            <span className="text-[12px] text-ink-3">of answers committed to a pick</span>
          </div>
        </Tip>
        <div className="flex h-4 overflow-hidden rounded-md mt-1">
          <div style={{ width: `${(pick / total) * 100}%` }} className="bg-primary" />
          <div style={{ width: `${(cond / total) * 100}%` }} className="bg-primary/40" />
          <div style={{ width: `${(noPick / total) * 100}%` }} className="bg-neutral-bar" />
          <div style={{ width: `${(clar / total) * 100}%` }} className="bg-warning/60" />
        </div>
      </div>
      <SeriesBars rows={chartRows.map((r) => ({
        label: r.label,
        color: r.color,
        value:
          st.measure === "position"
            ? r.raw !== null && best !== null ? best / r.raw : null
            : r.raw,
        right: fmt(r.raw),
      }))} />
      <SortTable
        filename={`brands${f.label ? `_${slugify(f.label)}` : ""}.csv`}
        defaultSort={{ id: "named", dir: -1 }}
        cols={[
          { id: "brand", label: "Brand", val: (r: BrandRow) => r.e.name,
            color: (r) => colorOf(r.e.name),
            render: (r) => <span className="font-medium">{r.e.name}</span> },
          { id: "named", label: METRICS.mentioned.label, num: true,
            tip: metricTip("mentionedRate"),
            val: (r) => Math.round((r.s.named / r.n) * 100),
            render: (r) => (st.showCounts ? frac(r.s.named, r.n) : pct(r.s.named / r.n)) },
          ...(st.showCI
            ? [{ id: "namedci", label: "Mentioned 95% CI", num: true,
                val: (r: BrandRow) => Math.round(wilson(r.s.named, r.n).low * 100),
                render: (r: BrandRow) => ci(r.s.named, r.n) }]
            : []),
          { id: "recommended", label: METRICS.recommended.label, num: true,
            tip: metricTip("recommended"),
            val: (r) => Math.round((r.s.rec / r.n) * 100),
            render: (r) => (st.showCounts ? frac(r.s.rec, r.n) : pct(r.s.rec / r.n)) },
          { id: "chosen", label: METRICS.chosen.label, num: true,
            tip: metricTip("chosen"),
            val: (r) => Math.round((r.s.chosen / r.n) * 100),
            render: (r) => (st.showCounts ? frac(r.s.chosen, r.n) : pct(r.s.chosen / r.n)) },
          ...(st.showCI
            ? [{ id: "chosenci", label: "Chosen 95% CI", num: true,
                val: (r: BrandRow) => Math.round(wilson(r.s.chosen, r.n).low * 100),
                render: (r: BrandRow) => ci(r.s.chosen, r.n) }]
            : []),
          { id: "share", label: METRICS.shareOfDecided.label, num: true,
            tip: metricTip("shareOfDecided"),
            val: (r) => (r.decided > 0 ? Math.round((r.s.chosen / r.decided) * 100) : null),
            render: (r) =>
              r.decided > 0
                ? st.showCounts ? frac(r.s.chosen, r.decided) : pct(r.s.chosen / r.decided)
                : "—" },
          { id: "fn", label: METRICS.firstNamed.label, num: true,
            tip: metricTip("firstNamed"),
            val: (r) => Math.round((r.s.first / r.n) * 100),
            render: (r) => (st.showCounts ? frac(r.s.first, r.n) : pct(r.s.first / r.n)) },
          { id: "sov", label: METRICS.shareOfVoice.label, num: true,
            tip: metricTip("shareOfVoice"),
            val: (r) => (r.sovDen > 0 ? Math.round((r.s.sov / r.sovDen) * 100) : null),
            render: (r) => (r.sovDen > 0 ? pct(r.s.sov / r.sovDen) : "—") },
          { id: "pos", label: METRICS.avgPosition.label, num: true,
            tip: metricTip("avgPosition"),
            val: (r) => (r.s.posN > 0 ? Number((r.s.posSum / r.s.posN).toFixed(1)) : null),
            render: (r) => (r.s.posN > 0 ? `#${(r.s.posSum / r.s.posN).toFixed(1)}` : "—") },
          { id: "neg", label: METRICS.negative.label, num: true,
            tip: metricTip("negative"),
            val: (r) => (r.s.named > 0 ? Math.round((r.s.neg / r.s.named) * 100) : null),
            render: (r) =>
              r.s.named > 0 ? (
                <span className={r.s.neg > 0 ? "text-danger" : ""}>
                  {st.showCounts ? frac(r.s.neg, r.s.named) : pct(r.s.neg / r.s.named)}
                </span>
              ) : ("—") },
        ]}
        rows={rows}
      />
    </div>
  );
}

/* ---------------- Why ---------------- */

type WhyCell = { wins: [number, number]; all: [number, number]; absent: [number, number] };

function whyOf(f: FacetData, selected: Entity[], codeCount: number): WhyCell[][] {
  // per entity, per code: [k, n] for wins / all / absent.
  const out = selected.map(() =>
    Array.from({ length: codeCount }, (): WhyCell => ({ wins: [0, 0], all: [0, 0], absent: [0, 0] }))
  );
  for (const [, , , pick, mentions, reasons] of f.rows) {
    selected.forEach((e, s) => {
      const isWin = pick >= 0 && e.members.has(pick);
      const isNamed = mentions.some(([b]) => e.members.has(b));
      const cells = out[s];
      for (let c = 0; c < codeCount; c++) {
        cells[c].all[1]++;
        if (isWin) cells[c].wins[1]++;
        if (!isNamed) cells[c].absent[1]++;
      }
      for (const c of reasons) {
        cells[c].all[0]++;
        if (isWin) cells[c].wins[0]++;
        if (!isNamed) cells[c].absent[0]++;
      }
    });
  }
  return out;
}

function Why({
  data, facets, selected, counts, colorOf,
}: {
  data: WorkbenchView;
  facets: FacetData[];
  selected: Entity[];
  counts: boolean;
  colorOf: (name: string) => string;
}) {
  const [metric, setMetric] = useState<"lift" | "wins" | "all" | "absent">("lift");
  const [sortBy, setSortBy] = useState<{ name: string; dir: 1 | -1 } | null>(null);
  const metricDefs = [
    ["lift", "Lift", "How much more often the argument shows up in answers the brand wins than in answers overall. Positive = it travels with their wins."],
    ["wins", "In their wins", "Of the answers that crown the brand, the share that use this argument — their winning story."],
    ["all", "Overall", "The share of all answers that use this argument, whoever wins — the category's background conversation."],
    ["absent", "Where they're missing", "Of the answers that never mention the brand, the share using this argument — the talking points of conversations they're excluded from."],
  ] as const;
  const activeDef = metricDefs.find(([id]) => id === metric)!;
  return (
    <>
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Metric
          </span>
          {metricDefs.map(([id, label, tip]) => (
            <Tip key={id} tip={tip}>
              <button type="button" onClick={() => setMetric(id)}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${
                  metric === id
                    ? "border-[var(--color-primary)] bg-primary-soft text-primary"
                    : "border-line text-ink-3 hover:border-ink-3"
                }`}>
                {label}
              </button>
            </Tip>
          ))}
        </div>
        <p className="text-[12px] text-ink-3">{activeDef[2]}</p>
      </div>
      <div className="grid gap-8">
        {facets.map((f) => (
          <WhyGroup key={f.label ?? "all"} data={data} f={f} selected={selected}
            metric={metric} counts={counts} sortBy={sortBy} setSortBy={setSortBy}
            colorOf={colorOf} />
        ))}
      </div>
    </>
  );
}

function WhyGroup({
  data, f, selected, metric, counts, sortBy, setSortBy, colorOf,
}: {
  data: WorkbenchView;
  f: FacetData;
  selected: Entity[];
  metric: "lift" | "wins" | "all" | "absent";
  counts: boolean;
  sortBy: { name: string; dir: 1 | -1 } | null;
  setSortBy: (v: { name: string; dir: 1 | -1 } | null) => void;
  colorOf: (name: string) => string;
}) {
  const cells = useMemo(() => whyOf(f, selected, data.codes.length), [f, selected, data.codes.length]);
  if (data.codes.length === 0 || f.n === 0) {
    return (
      <div className="grid gap-2">
        <GroupLabel label={f.label} />
        <p className="text-sm text-ink-3">No argument coding in this slice.</p>
      </div>
    );
  }
  const share = ([k, n]: [number, number]) => (n > 0 ? k / n : null);
  const valOf = (s: number, c: number): number | null => {
    const cell = cells[s][c];
    if (metric === "wins") return share(cell.wins);
    if (metric === "all") return share(cell.all);
    if (metric === "absent") return share(cell.absent);
    const w = share(cell.wins);
    const a = share(cell.all);
    return w === null || a === null ? null : w - a;
  };
  const sortIdx = Math.max(selected.findIndex((e) => e.name === sortBy?.name), 0);
  const codes = data.codes
    .map((_, c) => c)
    .sort((a, b) => {
      const va = valOf(sortIdx, a) ?? -Infinity;
      const vb = valOf(sortIdx, b) ?? -Infinity;
      return (vb - va) * (sortBy?.dir === 1 ? -1 : 1);
    });
  const tipOf = (s: number, c: number) => {
    const cell = cells[s][c];
    const w = share(cell.wins) ?? 0;
    const a = share(cell.all) ?? 0;
    const ab = share(cell.absent) ?? 0;
    const lift = w - a;
    return `in wins ${pct(w)} (${cell.wins[0]} of ${cell.wins[1]}) · overall ${pct(a)} (${cell.all[0]} of ${cell.all[1]}) · where missing ${pct(ab)} (${cell.absent[0]} of ${cell.absent[1]}) · lift ${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(0)}`;
  };
  const fmt = (s: number, c: number) => {
    const v = valOf(s, c);
    if (v === null) return "—";
    if (metric === "lift") return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}`;
    if (counts) {
      const cell = cells[s][c];
      const pair = metric === "wins" ? cell.wins : metric === "all" ? cell.all : cell.absent;
      return frac(pair[0], pair[1]);
    }
    return pct(v);
  };
  return (
    <div className="grid gap-3">
      <GroupLabel label={f.label} />
      <div className="flex justify-end">
        <button type="button"
          onClick={() =>
            downloadCsv(
              `arguments${f.label ? `_${slugify(f.label)}` : ""}.csv`,
              ["argument", ...selected.flatMap((e) => [
                `${e.name} lift`, `${e.name} in wins`, `${e.name} overall`, `${e.name} where missing`,
              ])],
              data.codes.map((code, c) => [
                code,
                ...selected.flatMap((_, s) => {
                  const cell = cells[s][c];
                  const w = share(cell.wins) ?? 0;
                  const a = share(cell.all) ?? 0;
                  return [
                    Math.round((w - a) * 100),
                    Math.round(w * 100),
                    Math.round(a * 100),
                    Math.round((share(cell.absent) ?? 0) * 100),
                  ];
                }),
              ])
            )
          }
          className="text-[12px] font-medium text-primary hover:opacity-80">
          ↓ csv
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3 border-b border-line">
              <th className="py-2 pr-4 font-semibold">Argument</th>
              {selected.map((e) => (
                <th key={e.name}
                  className="py-2 pr-3 font-semibold text-center cursor-pointer select-none hover:opacity-70"
                  style={{ color: colorOf(e.name) }}
                  onClick={() =>
                    setSortBy(
                      sortBy?.name === e.name
                        ? { name: e.name, dir: sortBy.dir === 1 ? -1 : 1 }
                        : { name: e.name, dir: -1 }
                    )
                  }>
                  <HeadLabel
                    label={e.name}
                    arrow={sortBy?.name === e.name ? (sortBy.dir === -1 ? "↓" : "↑") : ""}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c} className="border-b border-line/60">
                <td className="py-2 pr-4 font-medium">{data.codes[c]}</td>
                {selected.map((e, s) => {
                  const v = valOf(s, c);
                  return (
                    <td key={e.name}
                      className={`py-2 pr-3 text-center tabular-nums ${
                        metric !== "lift" ? "text-ink-2"
                        : v === null ? "text-ink-3"
                        : v > 0.02 ? "text-success font-semibold"
                        : v < -0.02 ? "text-danger font-semibold"
                        : "text-ink-2"
                      }`}>
                      <Tip tip={tipOf(s, c)}>
                        <span className="cursor-help">{fmt(s, c)}</span>
                      </Tip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Battleground ---------------- */

interface PromptAgg {
  prompt: number;
  answers: number;
  decided: number;
  /** picks per selected entity / named per selected entity. */
  picks: number[];
  named: number[];
  /** The prompt's most-picked brand (any brand, not only selected). */
  modalPick: string | null;
  modalCount: number;
  modalTied: boolean;
}

function Battleground({
  data, facets, selected, colorOf,
}: {
  data: WorkbenchView;
  facets: FacetData[];
  selected: Entity[];
  colorOf: (name: string) => string;
}) {
  const [sort, setSort] = useState<"contested" | "owned" | "stage">("contested");
  const firstName = selected[0]?.name ?? "";
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Sort</span>
        {(
          [
            ["contested", "most contested"],
            ["owned", `most owned by ${firstName}`],
            ["stage", "by question type"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setSort(id)}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${
              sort === id
                ? "border-[var(--color-primary)] bg-primary-soft text-primary"
                : "border-line text-ink-3 hover:border-ink-3"
            }`}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-8">
        {facets.map((f) => (
          <BattlegroundGroup key={f.label ?? "all"} data={data} f={f}
            selected={selected} sort={sort} colorOf={colorOf} />
        ))}
      </div>
      <div className="grid gap-1 text-[12px] text-ink-3">
        <div className="flex gap-4">
          <span><Dot badge="win" /> wins it</span>
          <span><Dot badge="contested" /> contested</span>
          <span><Dot badge={null} /> not mentioned</span>
        </div>
        <p>
          Win = the brand is the prompt&apos;s most common pick AND takes a
          majority (50%+) of its decided answers, with no tie. Contested =
          mentioned in the answers but nobody holds a majority (or someone
          else does). Not mentioned = absent from this prompt&apos;s answers
          entirely. Decided = answers whose pick is a brand in the category.
        </p>
      </div>
    </>
  );
}

function Dot({ badge }: { badge: "win" | "contested" | null }) {
  return (
    <span className="inline-block h-2.5 w-2.5 rounded-full"
      style={{
        background: badge === "win" ? "var(--color-success, #2e7d4f)"
          : badge === "contested" ? "var(--color-warning, #b3822a)"
          : "var(--color-line, #d8dfe2)",
      }} />
  );
}

function BattlegroundGroup({
  data, f, selected, sort, colorOf,
}: {
  data: WorkbenchView;
  f: FacetData;
  selected: Entity[];
  sort: "contested" | "owned" | "stage";
  colorOf: (name: string) => string;
}) {
  const aggs = useMemo(() => {
    const byPrompt = new Map<number, PromptAgg & { pickCounts: Map<number, number> }>();
    for (const [, p, , pick, mentions] of f.rows) {
      const a = byPrompt.get(p) ?? {
        prompt: p, answers: 0, decided: 0,
        picks: selected.map(() => 0), named: selected.map(() => 0),
        modalPick: null, modalCount: 0, modalTied: false,
        pickCounts: new Map<number, number>(),
      };
      a.answers++;
      if (pick >= 0) {
        a.decided++;
        a.pickCounts.set(pick, (a.pickCounts.get(pick) ?? 0) + 1);
      }
      selected.forEach((e, s) => {
        if (mentions.some(([b]) => e.members.has(b))) a.named[s]++;
        if (pick >= 0 && e.members.has(pick)) a.picks[s]++;
      });
      byPrompt.set(p, a);
    }
    for (const a of byPrompt.values()) {
      let top: number | null = null;
      let topCount = 0;
      let tied = false;
      for (const [b, k] of a.pickCounts) {
        if (k > topCount) {
          top = b;
          topCount = k;
          tied = false;
        } else if (k === topCount) tied = true;
      }
      a.modalPick = top !== null ? data.brands[top].name : null;
      a.modalCount = topCount;
      a.modalTied = tied;
    }
    return [...byPrompt.values()];
  }, [f, selected, data.brands]);

  const badgeOf = (a: PromptAgg, s: number): "win" | "contested" | null => {
    if (a.named[s] === 0) return null;
    const e = selected[s];
    const isModal = a.modalPick !== null && !a.modalTied &&
      [...e.members].some((b) => data.brands[b].name === a.modalPick);
    if (isModal && a.decided > 0 && a.picks[s] > a.decided / 2) return "win";
    return "contested";
  };
  const contestScore = (a: PromptAgg) =>
    selected.filter((_, s) => badgeOf(a, s) === "contested").length * 2 +
    selected.filter((_, s) => badgeOf(a, s) === "win").length;
  const ownedScore = (a: PromptAgg) =>
    (badgeOf(a, 0) === "win" ? 100 : 0) +
    selected.filter((_, s) => badgeOf(a, s) === "win").length;
  const rows =
    sort === "contested"
      ? [...aggs].sort((a, b) => contestScore(b) - contestScore(a))
      : sort === "owned"
        ? [...aggs].sort((a, b) => ownedScore(b) - ownedScore(a))
        : [...aggs].sort((a, b) =>
            data.prompts[a.prompt].stage.localeCompare(data.prompts[b.prompt].stage)
          );
  if (rows.length === 0) {
    return (
      <div className="grid gap-2">
        <GroupLabel label={f.label} />
        <p className="text-sm text-ink-3">No prompts in this slice.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <GroupLabel label={f.label} />
      <div className="flex justify-end">
        <button type="button"
          onClick={() =>
            downloadCsv(
              `battleground${f.label ? `_${slugify(f.label)}` : ""}.csv`,
              ["prompt", "question_type", "brand", "answers", "named", "decided", "picked", "status", "consensus_pick"],
              rows.flatMap((a) =>
                selected.map((e, s) => [
                  data.prompts[a.prompt].text,
                  data.prompts[a.prompt].stage,
                  e.name,
                  a.answers,
                  a.named[s],
                  a.decided,
                  a.picks[s],
                  badgeOf(a, s) ?? "absent",
                  a.modalPick,
                ])
              )
            )
          }
          className="text-[12px] font-medium text-primary hover:opacity-80">
          ↓ csv
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3 border-b border-line">
              <th className="py-2 pr-4 font-semibold">Prompt</th>
              <th className="py-2 pr-4 font-semibold">Type</th>
              <th className="py-2 pr-4 font-semibold">Consensus</th>
              {selected.map((e) => (
                <th key={e.name} className="py-2 pr-3 font-semibold text-center"
                  style={{ color: colorOf(e.name) }}>
                  {e.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.prompt} className="border-b border-line/60">
                <td className="py-2 pr-4 text-ink-2 max-w-[24rem]">
                  <span className="line-clamp-2" title={data.prompts[a.prompt].text}>
                    {data.prompts[a.prompt].text}
                  </span>
                </td>
                <td className="py-2 pr-4 text-[12px] text-ink-3 whitespace-nowrap">
                  {data.prompts[a.prompt].stage.replace(/_/g, " ")}
                </td>
                <td className="py-2 pr-4 text-[12px] text-ink-2 whitespace-nowrap">
                  {a.modalPick && !a.modalTied
                    ? `${a.modalPick} (${frac(a.modalCount, a.decided)})`
                    : a.decided > 0 ? "split" : "no picks"}
                </td>
                {selected.map((e, s) => (
                  <td key={e.name} className="py-2 pr-3 text-center">
                    <Tip tip={`mentioned in ${a.named[s]}/${a.answers} · chosen in ${a.picks[s]}/${a.decided} decided`}>
                      <span className="cursor-help"><Dot badge={badgeOf(a, s)} /></span>
                    </Tip>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Risk ---------------- */

interface RiskStats {
  named: number;
  rec: number;
  neg: number;
}

function Risk({
  data, facets, selected, st, clientName, colorOf,
}: {
  data: WorkbenchView;
  facets: FacetData[];
  selected: Entity[];
  st: WbState;
  clientName: string;
  colorOf: (name: string) => string;
}) {
  const [focus, setFocus] = useState<string>(clientName);
  const focusEntity = selected.find((e) => e.name === focus) ?? selected.find((e) => e.isClient) ?? selected[0];

  // Framing over EVERY coded answer (open rows + extra), per facet.
  const riskFacets = useMemo(
    () =>
      facets.map((f) => {
        const stats: RiskStats[] = selected.map(() => ({ named: 0, rec: 0, neg: 0 }));
        const scan = (mentions: [number, number][]) => {
          selected.forEach((e, s) => {
            let named = false;
            let rec = false;
            let neg = false;
            for (const [b, bits] of mentions) {
              if (!e.members.has(b)) continue;
              named = true;
              if (bits & 1) rec = true;
              if (bits & 2) neg = true;
            }
            if (named) stats[s].named++;
            if (rec) stats[s].rec++;
            if (neg) stats[s].neg++;
          });
        };
        for (const r of f.rows) scan(r[4]);
        for (const [e0, , mentions] of data.extra) if (f.engineSet.has(e0)) scan(mentions);
        return { label: f.label, engineSet: f.engineSet, stats };
      }),
    [facets, selected, data.extra]
  );

  // Where the focus brand is framed negatively, by prompt (all pools).
  const negPrompts = useMemo(() => {
    if (!focusEntity) return [];
    const scoped = new Set(facets.flatMap((f) => [...f.engineSet]));
    const counts = new Map<number, number>();
    const hit = (e0: number, p: number, mentions: [number, number][]) => {
      if (!scoped.has(e0)) return;
      if (mentions.some(([b, bits]) => focusEntity.members.has(b) && bits & 2)) {
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
    };
    for (const [e0, p, , , mentions] of data.rows) hit(e0, p, mentions);
    for (const [e0, p, mentions] of data.extra) hit(e0, p, mentions);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([p, k]) => ({ prompt: data.prompts[p], k }));
  }, [data, facets, focusEntity]);

  // Doubt verdicts (target-only by construction), over the scoped engines.
  const doubtStrip = useMemo(() => {
    const scoped = new Set(facets.flatMap((f) => [...f.engineSet]));
    const agg = (kind: "buyers" | "customers") => {
      const rows = data.doubt.filter((d) => d.kind === kind && scoped.has(d.engine));
      const sum = (f: (d: (typeof rows)[number]) => number) => rows.reduce((a, d) => a + f(d), 0);
      const answers = sum((d) => d.answers);
      return answers === 0
        ? null
        : { answers, stay: sum((d) => d.stay), go: sum((d) => d.go), judged: sum((d) => d.judged), confirms: sum((d) => d.confirms) };
    };
    return { buyers: agg("buyers"), customers: agg("customers") };
  }, [data.doubt, facets]);

  return (
    <>
      <div className="grid gap-8">
        {riskFacets.map((f) => (
          <div key={f.label ?? "all"} className="grid gap-2">
            <GroupLabel label={f.label} />
            <SortTable
              filename={`risk${f.label ? `_${slugify(f.label)}` : ""}.csv`}
              defaultSort={{ id: "negpct", dir: -1 }}
              onRowClick={(r) => setFocus(r.e.name)}
              activeRow={(r) => r.e.name === focus}
              cols={[
                { id: "brand", label: "Brand",
                  val: (r: { e: Entity; s: RiskStats }) => r.e.name,
                  color: (r) => colorOf(r.e.name),
                  render: (r) => <span className="font-medium">{r.e.name}</span> },
                { id: "named", label: "Mentioned answers", num: true,
                  val: (r) => r.s.named },
                { id: "rec", label: "Recommended", num: true,
                  val: (r) => (r.s.named > 0 ? Math.round((r.s.rec / r.s.named) * 100) : null),
                  render: (r) =>
                    r.s.named > 0
                      ? st.showCounts ? frac(r.s.rec, r.s.named) : pct(r.s.rec / r.s.named)
                      : "—" },
                { id: "neutral", label: METRICS.neutral.label, num: true,
                  tip: metricTip("neutral"),
                  val: (r) =>
                    r.s.named > 0
                      ? Math.round(((r.s.named - r.s.rec - r.s.neg) / r.s.named) * 100)
                      : null,
                  render: (r) =>
                    r.s.named > 0
                      ? st.showCounts
                        ? frac(Math.max(r.s.named - r.s.rec - r.s.neg, 0), r.s.named)
                        : pct(Math.max(r.s.named - r.s.rec - r.s.neg, 0) / r.s.named)
                      : "—" },
                { id: "negpct", label: METRICS.negative.label, num: true,
                  tip: metricTip("negative"),
                  val: (r) => (r.s.named > 0 ? Math.round((r.s.neg / r.s.named) * 100) : null),
                  render: (r) =>
                    r.s.named > 0 ? (
                      <span className={r.s.neg > 0 ? "text-danger font-semibold" : ""}>
                        {st.showCounts ? frac(r.s.neg, r.s.named) : pct(r.s.neg / r.s.named)}
                      </span>
                    ) : ("—") },
              ]}
              rows={selected.map((e, s) => ({ e, s: f.stats[s] }))}
            />
          </div>
        ))}
      </div>

      {(doubtStrip.buyers || doubtStrip.customers) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {doubtStrip.buyers && (
            <div className="rounded-xl border border-line p-4">
              <div className="section-label mb-2">Buyers&apos; worries — {data.brand}</div>
              <p className="text-[13px] text-ink-2">
                Over {doubtStrip.buyers.answers} objection answers: the AI says
                go ahead in {pct(doubtStrip.buyers.stay / doubtStrip.buyers.answers)},
                avoid in {pct(doubtStrip.buyers.go / doubtStrip.buyers.answers)}
                {doubtStrip.buyers.judged > 0 && (
                  <> — and agrees the worry is warranted in {pct(doubtStrip.buyers.confirms / doubtStrip.buyers.judged)} of the {doubtStrip.buyers.judged} it judges</>
                )}
                . The per-worry detail lives in the doubt views.
              </p>
            </div>
          )}
          {doubtStrip.customers && (
            <div className="rounded-xl border border-line p-4">
              <div className="section-label mb-2">Customers&apos; worries — {data.brand}</div>
              <p className="text-[13px] text-ink-2">
                Over {doubtStrip.customers.answers} churn and renewal answers: stay{" "}
                {pct(doubtStrip.customers.stay / doubtStrip.customers.answers)}, leave{" "}
                {pct(doubtStrip.customers.go / doubtStrip.customers.answers)}
                {doubtStrip.customers.judged > 0 && (
                  <> — the worry confirmed in {pct(doubtStrip.customers.confirms / doubtStrip.customers.judged)} of the {doubtStrip.customers.judged} it judges</>
                )}
                . The per-worry detail lives in the doubt views.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-2">
        <div className="section-label mb-2">
          Where {focus} gets framed negatively — by question
        </div>
        {negPrompts.length === 0 ? (
          <p className="text-sm text-ink-3">
            No answers framed {focus} negatively in this scope.
          </p>
        ) : (
          <div className="grid gap-2">
            {negPrompts.map(({ prompt, k }) => (
              <div key={prompt.text} className="border-l-2 border-danger/50 pl-4">
                <p className="text-[13px] text-ink-2">“{prompt.text}”</p>
                <p className="text-[12px] text-ink-3">
                  framed negative in {k} answer{k === 1 ? "" : "s"} · {prompt.stage.replace(/_/g, " ")}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-3 mt-3">
          Verbatim quotes return with the read-time evidence layer — the coded
          labels record the framing, not a per-brand excerpt.
        </p>
      </div>
    </>
  );
}
