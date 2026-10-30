"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ViewKey } from "@/lib/engine/views";
import type { WorkbenchView } from "@/lib/engine/workbench";
import {
  MEASURES,
  MEASURE_BY_ID,
  POOLS,
  POOL_LABEL,
  R,
  illegalReason,
  legalPools,
  poolAsks,
  type MeasureCtx,
  type MeasureDef,
  type WbRow,
} from "@/lib/engine/measures";
import EvidencePanel, { EVIDENCE_CAP, type EvidenceRequest } from "./evidence_panel";
import { SortTable, type Col } from "./table";

/**
 * The Metrics pivot (2026-10-30, WORKBENCH_REDESIGN_2026-10-30.md): any
 * dimension on rows and columns, any LEGAL measure, computed in the browser
 * over the wb2 fact table (one fetch per open). Legality lives in
 * engine/measures.ts alone: a measure is always read inside one pool (the
 * views never pool with each other), measures the pool does not ask are
 * greyed with the reason, and choosing one moves to a pool that asks it.
 *
 * Cells are k of n with the 95% Wilson range on hover; cells under 20
 * answers are muted and starred rather than printed as confident numbers;
 * rows and columns with no answers drop. Clicking a cell opens the answers
 * it counts (the numerator) in the evidence panel.
 */

type DimKey = "none" | "room" | "worry" | "rival" | "stage" | "engine" | "mode" | "brand" | "parent" | "argument";

const DIMS: { key: DimKey; label: string }[] = [
  { key: "none", label: "None" },
  { key: "room", label: "Buyer room" },
  { key: "worry", label: "Worry" },
  { key: "rival", label: "Rival or class" },
  { key: "stage", label: "Stage" },
  { key: "engine", label: "Engine" },
  { key: "mode", label: "Mode" },
  { key: "brand", label: "Brand" },
  { key: "parent", label: "Brand (parent)" },
  { key: "argument", label: "Argument" },
];

/** The measure a pool opens on. */
const POOL_DEFAULT: Partial<Record<ViewKey, string>> = {
  headline: "chosen",
  premium_tier: "tier_premium",
  repertoire: "rep_stick",
  head_to_head_entity: "h2h_you",
  head_to_head_class: "h2h_you",
  offensive_capture: "chosen",
  defensive_hold: "keep",
  value: "worth_yes",
  criteria_taught: "argues",
  awareness_routing: "routed_category",
  awareness_explainer: "routed_category",
  doubt: "proceed",
  keep_or_leave: "keep",
  settled_business_case: "rel_strengthens",
  settled_expansion: "rel_strengthens",
  settled_ecosystem: "rel_strengthens",
  settled_advocacy: "rel_strengthens",
};

const THIN = 20;
/** Brand and argument dimensions list at most this many values. */
const DIM_CAP = 20;

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
const pct = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

interface Acc {
  k: number;
  n: number;
  ids: string[];
}
/** One dimension value: its key, label and (for brand / argument context)
 * what it sets on the measure. */
interface DimValue {
  key: string;
  label: string;
  brands?: Set<number>;
  arg?: number;
}

const chip = (on: boolean, off = false) =>
  `rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${
    on
      ? "border-[var(--color-primary)] bg-primary-soft text-primary"
      : off
        ? "border-line/60 text-ink-3/50 hover:border-ink-3/40"
        : "border-line text-ink-3 hover:border-ink-3"
  }`;

export function MetricsSection({ runId, evidence = true }: { runId: string; evidence?: boolean }) {
  const [data, setData] = useState<WorkbenchView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [poolPick, setPool] = useState<ViewKey | null>(null);
  const [measurePick, setMeasure] = useState<string | null>(null);
  const [rowPick, setRow] = useState<DimKey>("engine");
  const [colPick, setCol] = useState<DimKey>("none");
  const [brandPick, setBrand] = useState<number | null>(null);
  const [argPick, setArg] = useState<number>(0);
  const [drill, setDrill] = useState<EvidenceRequest | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/workbench`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setData((d?.view as WorkbenchView | null) ?? null))
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [runId]);

  // ---- pools present in this run ----
  const poolCounts = useMemo(() => {
    const m = new Map<ViewKey, number>();
    if (!data?.facts) return m;
    for (const row of data.facts) for (const v of data.prompts[row[R.prompt]].views) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  }, [data]);
  const present = useMemo(
    () => POOLS.filter((p) => (poolCounts.get(p.key) ?? 0) > 0).map((p) => p.key),
    [poolCounts]
  );
  const pool = useMemo<ViewKey | null>(
    () =>
      poolPick && present.includes(poolPick) ? poolPick : present.includes("headline") ? "headline" : (present[0] ?? null),
    [poolPick, present]
  );
  const measure: MeasureDef | null = useMemo(() => {
    if (!pool) return null;
    const picked = measurePick ? MEASURE_BY_ID.get(measurePick) : undefined;
    if (picked && !illegalReason(picked, pool)) return picked;
    const d = POOL_DEFAULT[pool];
    const fallback = d ? MEASURE_BY_ID.get(d) : undefined;
    return fallback && !illegalReason(fallback, pool) ? fallback : (MEASURES.find((m) => !illegalReason(m, pool)) ?? null);
  }, [pool, measurePick]);

  const poolRows: WbRow[] = useMemo(
    () => (data?.facts && pool ? data.facts.filter((r) => data.prompts[r[R.prompt]].views.includes(pool)) : []),
    [data, pool]
  );

  // ---- dimension legality, per measure and pool ----
  const dimReason = useCallback(
    (k: DimKey): string | null => {
      if (!data || !pool || !measure) return "no data";
      const anyPrompt = (f: (p: WorkbenchView["prompts"][number]) => boolean) =>
        poolRows.some((r) => f(data.prompts[r[R.prompt]]));
      switch (k) {
        case "room":
          return anyPrompt((p) => p.room >= 0) ? null : "no buyer rooms on this pool";
        case "worry":
          return anyPrompt((p) => p.worry >= 0) ? null : "no worries on this pool";
        case "rival":
          return anyPrompt((p) => p.rival >= 0 || p.angle >= 0) ? null : "no named rival on this pool";
        case "brand":
          return measure.brand ? null : "this measure is not per brand";
        case "parent":
          if (!measure.brand) return "this measure is not per brand";
          return data.brands.some((b) => b.listed && b.parent) ? null : "no parent companies set";
        case "argument":
          return poolAsks(pool, "arguments") ? null : "no arguments coded on this pool";
        default:
          return null;
      }
    },
    [data, pool, measure, poolRows]
  );
  const rowDim: DimKey = dimReason(rowPick) ? "none" : rowPick;
  const colDim: DimKey = dimReason(colPick) || colPick === rowDim ? "none" : colPick;

  const target = data?.target ?? 0;
  const brand = brandPick !== null && data?.brands[brandPick] ? brandPick : target;
  const arg = data && argPick < data.args.length ? argPick : 0;
  const needsBrand = !!measure?.brand && !["brand", "parent"].includes(rowDim) && !["brand", "parent"].includes(colDim);
  const needsArg = !!measure?.arg && rowDim !== "argument" && colDim !== "argument";

  // ---- the pivot ----
  const pivot = useMemo(() => {
    if (!data?.facts || !pool || !measure) return null;
    const P = data.prompts;
    const engineOf = (r: WbRow) => data.engines[r[R.engine]];

    // Brand / argument dimensions are CONTEXT for a measure that reads them
    // (every answer sits in every brand's cell, the measure evaluated for
    // that brand); argument is a FILTER otherwise (answers carrying it).
    const brandValues = (grain: "brand" | "parent"): DimValue[] => {
      if (grain === "brand") {
        return data.brands.flatMap((b, i) =>
          b.listed ? [{ key: `b${i}`, label: b.name, brands: new Set([i]) }] : []
        );
      }
      const groups = new Map<string, DimValue>();
      data.brands.forEach((b, i) => {
        if (!b.listed) return;
        const name = b.parent ?? b.name;
        const g = groups.get(name) ?? { key: `p${name}`, label: name, brands: new Set<number>() };
        g.brands!.add(i);
        groups.set(name, g);
      });
      return [...groups.values()];
    };
    const argValues: DimValue[] = data.args.map((a, i) => ({ key: `a${i}`, label: a, arg: i }));

    const valuesOf = (dim: DimKey): ((r: WbRow) => DimValue[]) | DimValue[] => {
      switch (dim) {
        case "none":
          return [{ key: "all", label: "All answers" }];
        case "room":
          return (r) => {
            const i = P[r[R.prompt]].room;
            return [i >= 0 ? { key: `r${i}`, label: data.rooms[i] } : { key: "r-", label: "Every buyer (not room-pinned)" }];
          };
        case "worry":
          return (r) => {
            const i = P[r[R.prompt]].worry;
            return [i >= 0 ? { key: `w${i}`, label: data.worries[i] } : { key: "w-", label: "No worry" }];
          };
        case "rival":
          return (r) => {
            const p = P[r[R.prompt]];
            if (p.rival >= 0) return [{ key: `b${p.rival}`, label: data.brands[p.rival].name }];
            if (p.angle >= 0) return [{ key: `g${p.angle}`, label: titleCase(data.angles[p.angle]) }];
            return [{ key: "-", label: "No rival named" }];
          };
        case "stage":
          return (r) => {
            const s = P[r[R.prompt]].stage;
            return [{ key: s, label: titleCase(s) }];
          };
        case "engine":
          return (r) => [{ key: `e${r[R.engine]}`, label: engineOf(r).label }];
        case "mode":
          return (r) => {
            const m = engineOf(r).mode;
            return [{ key: m, label: titleCase(m) }];
          };
        case "brand":
        case "parent":
          return brandValues(dim);
        case "argument":
          if (measure.arg) return argValues;
          return (r) => r[R.args].map((a) => argValues[a]);
      }
    };
    const rowVals = valuesOf(rowDim);
    const colVals = valuesOf(colDim);
    const at = (v: ((r: WbRow) => DimValue[]) | DimValue[], r: WbRow) => (typeof v === "function" ? v(r) : v);

    const cells = new Map<string, Acc>();
    const rowOrder = new Map<string, DimValue>();
    const colOrder = new Map<string, DimValue>();
    const fixedBrands = new Set([brand]);
    for (const r of poolRows) {
      const prompt = P[r[R.prompt]];
      for (const rv of at(rowVals, r)) {
        for (const cv of at(colVals, r)) {
          const ctx: MeasureCtx = {
            target: data.target,
            brands: rv.brands ?? cv.brands ?? fixedBrands,
            arg: rv.arg ?? cv.arg ?? arg,
            prompt,
          };
          const hit = measure.calc(r, ctx);
          if (hit === null) continue;
          if (!rowOrder.has(rv.key)) rowOrder.set(rv.key, rv);
          if (!colOrder.has(cv.key)) colOrder.set(cv.key, cv);
          const key = `${rv.key}|${cv.key}`;
          const acc = cells.get(key) ?? { k: 0, n: 0, ids: [] };
          acc.n++;
          if (hit === 1) {
            acc.k++;
            if (acc.ids.length < EVIDENCE_CAP) acc.ids.push(data.responseIds[r[R.response]]);
          }
          cells.set(key, acc);
        }
      }
    }

    // Order: context lists (brands, arguments) by numerator volume, capped;
    // everything else in first-seen order of its own index.
    const ordered = (m: Map<string, DimValue>, dim: DimKey, side: "row" | "col") => {
      let list = [...m.values()];
      const total = (v: DimValue) => {
        let k = 0;
        for (const [key, acc] of cells) {
          const [rk, ck] = key.split("|");
          if ((side === "row" ? rk : ck) === v.key) k += acc.k;
        }
        return k;
      };
      if (dim === "brand" || dim === "parent" || (dim === "argument" && measure.arg)) {
        const scored = list.map((v) => ({ v, k: total(v) }));
        list = scored
          .filter((s) => s.k > 0 || s.v.brands?.has(data.target))
          .sort((a, b) => b.k - a.k || a.v.label.localeCompare(b.v.label))
          .slice(0, DIM_CAP)
          .map((s) => s.v);
      } else if (dim === "engine") {
        list.sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
      } else {
        // Alphabetical, with the catch-all bucket ("not room-pinned", "no
        // worry", "no rival") last.
        const last = (v: DimValue) => (v.key.endsWith("-") ? 1 : 0);
        list.sort((a, b) => last(a) - last(b) || a.label.localeCompare(b.label));
      }
      return list;
    };
    return {
      rows: ordered(rowOrder, rowDim, "row"),
      cols: ordered(colOrder, colDim, "col"),
      cells,
      answers: poolRows.length,
    };
  }, [data, pool, measure, poolRows, rowDim, colDim, brand, arg]);

  if (!loaded) {
    return (
      <div className="card px-6 py-10">
        <p className="text-sm text-ink-3">Loading the metrics…</p>
      </div>
    );
  }
  if (!data?.facts || !pool || !measure || !pivot) {
    return (
      <div className="card px-6 py-10">
        <p className="text-sm text-ink-3">No coded answers to pivot yet.</p>
      </div>
    );
  }

  const groups = [...new Set(MEASURES.map((m) => m.group))];
  const chooseMeasure = (m: MeasureDef) => {
    setMeasure(m.id);
    if (illegalReason(m, pool)) {
      // A measure implies its pool: move to the first pool that asks it.
      const next = legalPools(m).find((k) => present.includes(k));
      if (next) setPool(next);
    }
  };
  const chosenBrand = data.brands[brand];

  type PivotRow = { v: DimValue };
  const cellOf = (r: PivotRow, c: DimValue) => pivot.cells.get(`${r.v.key}|${c.key}`);
  const cols: Col<PivotRow>[] = [
    {
      id: "label",
      label: DIMS.find((d) => d.key === rowDim)?.label ?? "",
      val: (r) => r.v.label,
      render: (r) => <span className="font-medium text-ink">{r.v.label}</span>,
    },
    ...pivot.cols.map(
      (c): Col<PivotRow> => ({
        id: `c:${c.key}`,
        label: colDim === "none" ? measure.label : c.label,
        num: true,
        val: (r) => {
          const a = cellOf(r, c);
          return a && a.n > 0 ? Math.round((a.k / a.n) * 1000) / 10 : null;
        },
        render: (r) => {
          const a = cellOf(r, c);
          if (!a || a.n === 0) return <span className="text-ink-3/50">-</span>;
          const w = wilson(a.k, a.n);
          const thin = a.n < THIN;
          const tip = `${a.k} of ${a.n} - 95% range ${pct(w.low)}-${pct(w.high)}${thin ? " - fewer than 20 answers, read with care" : ""}`;
          const body = (
            <span className={`inline-flex flex-col items-center leading-tight ${thin ? "opacity-50" : ""}`} title={tip}>
              <span>
                {pct(a.k / a.n)}
                {thin && <span className="ml-0.5 align-super text-[10px] text-ink-3">*</span>}
              </span>
              <span className="text-[10px] text-ink-3">
                {a.k}/{a.n}
              </span>
            </span>
          );
          if (!evidence || a.k === 0) return body;
          return (
            <button
              type="button"
              className="rounded px-1 hover:bg-primary-soft/40"
              onClick={() =>
                setDrill({
                  title: `${measure.label} - ${[r.v.label, colDim === "none" ? null : c.label].filter(Boolean).join(" x ")}`,
                  subtitle: `${POOL_LABEL[pool]}${measure.brand && !r.v.brands && !c.brands ? ` - ${chosenBrand.name}` : ""}`,
                  ids: a.ids,
                  total: a.k,
                  highlight: measure.brand
                    ? [...(r.v.brands ?? c.brands ?? new Set([brand]))].map((i) => data.brands[i].name)
                    : [],
                })
              }
            >
              {body}
            </button>
          );
        },
      })
    ),
  ];

  const dimPicker = (label: string, value: DimKey, set: (k: DimKey) => void, other: DimKey) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</span>
      {DIMS.map((d) => {
        const reason = d.key !== "none" && d.key === other ? "already on the other axis" : dimReason(d.key);
        return (
          <button
            key={d.key}
            type="button"
            className={chip(value === d.key, !!reason)}
            title={reason ?? undefined}
            disabled={!!reason}
            onClick={() => set(d.key)}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="card overflow-hidden">
      <div className="grid gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Pool</span>
          <select
            value={pool}
            onChange={(e) => setPool(e.target.value as ViewKey)}
            className="input w-auto py-0.5 text-[12px]"
          >
            {present.map((k) => (
              <option key={k} value={k}>
                {POOL_LABEL[k]} ({poolCounts.get(k)} answers)
              </option>
            ))}
          </select>
          {needsBrand && (
            <select
              value={brand}
              onChange={(e) => setBrand(Number(e.target.value))}
              className="input ml-1 w-auto py-0.5 text-[12px]"
              aria-label="Brand"
            >
              {data.brands.map((b, i) =>
                b.listed ? (
                  <option key={i} value={i}>
                    {b.name}
                  </option>
                ) : null
              )}
            </select>
          )}
          {needsArg && data.args.length > 0 && (
            <select
              value={arg}
              onChange={(e) => setArg(Number(e.target.value))}
              className="input ml-1 w-auto max-w-[16rem] py-0.5 text-[12px]"
              aria-label="Argument"
            >
              {data.args.map((a, i) => (
                <option key={i} value={i}>
                  {a}
                </option>
              ))}
            </select>
          )}
        </div>
        {dimPicker("Rows", rowDim, setRow, colDim)}
        {dimPicker("Columns", colDim, setCol, rowDim)}
        <div className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Measure</span>
          <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-lg border border-line/60 p-2">
            {groups.map((g) => (
              <div key={g} className="flex flex-wrap items-center gap-1.5">
                <span className="w-28 shrink-0 text-[11px] text-ink-3">{g}</span>
                {MEASURES.filter((m) => m.group === g).map((m) => {
                  const reason = illegalReason(m, pool);
                  const reachable = !reason || legalPools(m).some((k) => present.includes(k));
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={chip(measure.id === m.id, !!reason)}
                      title={reason ? `${reason}${reachable ? " - choosing it moves to a pool that asks it" : " - no pool in this run asks it"}` : m.tip}
                      disabled={!reachable}
                      onClick={() => chooseMeasure(m)}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-[12px] text-ink-3">
          {measure.tip} {POOL_LABEL[pool]}: {pivot.answers} coded answers on the core panel.
          {needsBrand && ` Brand: ${chosenBrand.name}.`} Cells under {THIN} answers are muted and starred.
        </p>
        {pivot.rows.length === 0 || pivot.cols.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-3">No answers count toward this measure here.</p>
        ) : (
          <SortTable
            cols={cols}
            rows={pivot.rows.map((v) => ({ v }))}
            filename={`metrics_${pool}_${measure.id}.csv`}
            defaultSort={{ id: cols[1].id, dir: -1 }}
          />
        )}
      </div>
      {drill && <EvidencePanel runId={runId} request={drill} onClose={closeDrill} />}
    </div>
  );
}
