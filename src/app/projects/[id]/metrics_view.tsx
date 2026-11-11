"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ViewKey } from "@/lib/engine/views";
import type { WorkbenchView } from "@/lib/engine/workbench";
import {
  MEASURES,
  MEASURE_BY_ID,
  POOLS,
  POOL_LABEL as ENGINE_POOL_LABEL,
  R,
  illegalReason,
  poolAsks,
  type MeasureCtx,
  type MeasureDef,
  type WbRow,
} from "@/lib/engine/measures";
import EvidencePanel, { EVIDENCE_CAP, type EvidenceRequest } from "./evidence_panel";
import { SortTable, type Col } from "./table";
import { TIER_LABEL, useEngineSet, viewQuery } from "./view_parts";

/**
 * Build a table (the Metrics pivot renamed; 2026-10-30 chassis, 2026-11-01
 * ratification in WORKBENCH_REDESIGN_2026-10-30.md): RAW - any dimension on
 * rows and columns, any LEGAL measure, computed in the browser over the wb2
 * fact table (one fetch per open). It opens on a "Start from" preset; the
 * controls (Answers / Measure / Rows / Columns) sit on one line. Legality
 * lives in engine/measures.ts alone: a measure is always read inside one pool
 * (the views never pool with each other), and measures or dimensions the
 * pool does not ask are HIDDEN from the pickers, not greyed.
 *
 * Cells print the rate only; "k of n - 95% range" is on hover; cells under
 * 20 answers are muted and starred rather than printed as confident numbers;
 * rows and columns with no answers drop. Clicking a cell opens the answers
 * it counts (the numerator) in the evidence panel.
 */

type DimKey = "none" | "room" | "worry" | "rival" | "stage" | "question" | "engine" | "vendor" | "tier" | "mode" | "brand" | "parent" | "argument";

const DIMS: { key: DimKey; label: string }[] = [
  { key: "none", label: "None" },
  { key: "room", label: "Buyer room" },
  { key: "worry", label: "Worry" },
  { key: "rival", label: "Rival or class" },
  { key: "stage", label: "Stage" },
  { key: "question", label: "Question" },
  { key: "engine", label: "Engine" },
  { key: "vendor", label: "Vendor" },
  { key: "tier", label: "Tier" },
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

/** Buyer-language names for the surface (2026-11-01 vocabulary); the engine's
 * contract names stay in measures.ts and in each chip's hover. */
const POOL_LABEL: Record<ViewKey, string> = {
  ...ENGINE_POOL_LABEL,
  headline: "Which should I get",
  offensive_capture: "Rivals' leavers",
  defensive_hold: "Your customers weighing a move",
  repertoire: "Habit - stick with you",
};
const MEASURE_LABEL: Record<string, string> = {
  chosen: "Picked",
  share_of_decided: "Win rate when one is picked",
  negative: "Named negatively",
  firm_pick: "Picks one",
  premise_rebuts: "Pushes back",
  exit_named: "Points to another brand",
};
const mLabel = (m: MeasureDef) => MEASURE_LABEL[m.id] ?? m.label;
const mTip = (m: MeasureDef) => (MEASURE_LABEL[m.id] ? `${m.label}: ${m.tip}` : m.tip);

/** "Start from" presets (2026-11-01). Each sets pool, measure, rows and
 * columns, and resets the brand to the tracker's own; a preset whose pool the
 * run does not carry is hidden. The view opens on the first present one. */
interface Preset {
  id: string;
  label: string;
  pool: ViewKey;
  measure: string;
  row: DimKey;
  col: DimKey;
}
const PRESETS: Preset[] = [
  { id: "picked_engine", label: "How often you are picked, by assistant", pool: "headline", measure: "chosen", row: "engine", col: "none" },
  { id: "named_brand", label: "How often each brand is named", pool: "headline", measure: "mentioned", row: "brand", col: "none" },
  { id: "h2h_rival", label: "Direct matchups won, by rival", pool: "head_to_head_entity", measure: "h2h_you", row: "rival", col: "none" },
  { id: "proceed_worry", label: "Buyers told to go ahead, by worry", pool: "doubt", measure: "proceed", row: "worry", col: "none" },
  { id: "worth_room", label: "Called worth it, by buyer", pool: "value", measure: "worth_yes", row: "room", col: "none" },
  { id: "keep_worry", label: "Customers told to stay, by worry", pool: "keep_or_leave", measure: "keep", row: "worry", col: "none" },
  { id: "picked_engine_brand", label: "Picks by assistant and brand", pool: "headline", measure: "chosen", row: "engine", col: "brand" },
];

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
/** A prompt's text shortened for a row (~90 chars) or a column header. */
const shortText = (t: string, cap: number) => (t.length > cap ? `${t.slice(0, cap - 1).trimEnd()}…` : t);

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
  /** Question values: the full prompt text (tooltip, csv) and its stage. */
  full?: string;
  group?: string;
  brands?: Set<number>;
  arg?: number;
}

export function MetricsSection({ runId, evidence = true }: { runId: string; evidence?: boolean }) {
  const [data, setData] = useState<WorkbenchView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [poolPick, setPool] = useState<ViewKey | null>(null);
  const [measurePick, setMeasure] = useState<string | null>(null);
  const [rowPick, setRow] = useState<DimKey | null>(null);
  const [colPick, setCol] = useState<DimKey | null>(null);
  // The highlighted preset chip: undefined = the opening preset (derived, so
  // no state is set in an effect), null = a manual change un-highlighted all.
  const [presetPick, setPresetPick] = useState<string | null | undefined>(undefined);
  const [brandPick, setBrand] = useState<number | null>(null);
  const [argPick, setArg] = useState<number>(0);
  const [drill, setDrill] = useState<EvidenceRequest | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);

  const q = viewQuery({ engines: useEngineSet() });
  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/workbench${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setData((d?.view as WorkbenchView | null) ?? null))
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [runId, q]);

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
  const presets = useMemo(() => PRESETS.filter((p) => present.includes(p.pool)), [present]);
  const opening: Preset | null = presets[0] ?? null;
  const pool = useMemo<ViewKey | null>(
    () =>
      poolPick && present.includes(poolPick)
        ? poolPick
        : opening
          ? opening.pool
          : present.includes("headline")
            ? "headline"
            : (present[0] ?? null),
    [poolPick, present, opening]
  );
  const measure: MeasureDef | null = useMemo(() => {
    if (!pool) return null;
    const pickId = measurePick ?? (poolPick === null && opening ? opening.measure : null);
    const picked = pickId ? MEASURE_BY_ID.get(pickId) : undefined;
    if (picked && !illegalReason(picked, pool)) return picked;
    const d = POOL_DEFAULT[pool];
    const fallback = d ? MEASURE_BY_ID.get(d) : undefined;
    return fallback && !illegalReason(fallback, pool) ? fallback : (MEASURES.find((m) => !illegalReason(m, pool)) ?? null);
  }, [pool, measurePick, poolPick, opening]);

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
  const rowWant: DimKey = rowPick ?? opening?.row ?? "engine";
  const colWant: DimKey = colPick ?? opening?.col ?? "none";
  const rowDim: DimKey = dimReason(rowWant) ? "none" : rowWant;
  const colDim: DimKey = dimReason(colWant) || colWant === rowDim ? "none" : colWant;
  const activePreset = presetPick === undefined ? (opening?.id ?? null) : presetPick;

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
        case "question":
          // One value per question (cell): its seed and paraphrases pool, the
          // seed wording names it. Legal wherever stage is - every row
          // carries its prompt. Pre-wb5 payloads fall back to one per prompt.
          return (r) => {
            const i = r[R.prompt];
            const p = P[i];
            const cell = p.cell ?? -1;
            const text = cell >= 0 && data.cells?.[cell] ? data.cells[cell] : p.text;
            return [{ key: cell >= 0 ? `q${cell}` : `p${i}`, label: shortText(text, 90), full: text, group: titleCase(p.stage) }];
          };
        case "engine":
          return (r) => [{ key: `e${r[R.engine]}`, label: engineOf(r).label }];
        case "vendor":
          // Engines pooled by vendor (older payloads carry no vendor: the label).
          return (r) => {
            const v = engineOf(r).vendor ?? engineOf(r).label;
            return [{ key: `v:${v}`, label: v }];
          };
        case "tier":
          return (r) => {
            const t = engineOf(r).tier ?? "both";
            return [{ key: `t:${t}`, label: TIER_LABEL[t] }];
          };
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
      } else if (dim === "question") {
        // Grouped under the stage, then the questions carrying most of the
        // numerator first - one question can own a tracker's number.
        const scored = list.map((v) => ({ v, k: total(v) }));
        list = scored
          .sort((a, b) => (a.v.group ?? "").localeCompare(b.v.group ?? "") || b.k - a.k || a.v.label.localeCompare(b.v.label))
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

  // Only the measures this pool asks, grouped; illegal ones are hidden.
  const legalMeasures = MEASURES.filter((m) => !illegalReason(m, pool));
  const groups = [...new Set(legalMeasures.map((m) => m.group))];
  const manual = () => setPresetPick(null);
  const applyPreset = (p: Preset) => {
    setPool(p.pool);
    setMeasure(p.measure);
    setRow(p.row);
    setCol(p.col);
    setBrand(null);
    setPresetPick(p.id);
  };
  const chosenBrand = data.brands[brand];

  type PivotRow = { v: DimValue };
  const cellOf = (r: PivotRow, c: DimValue) => pivot.cells.get(`${r.v.key}|${c.key}`);
  const byQuestion = rowDim === "question";
  const cols: Col<PivotRow>[] = [
    ...(byQuestion
      ? [
          {
            id: "stage",
            label: "Stage",
            val: (r: PivotRow) => r.v.group ?? "",
            render: (r: PivotRow) => <span className="text-[11px] uppercase tracking-wide text-ink-3">{r.v.group}</span>,
          },
        ]
      : []),
    {
      id: "label",
      label: DIMS.find((d) => d.key === rowDim)?.label ?? "",
      val: (r) => r.v.full ?? r.v.label,
      render: (r) =>
        r.v.full ? (
          <span className="block max-w-[34rem] font-medium text-ink" title={`${r.v.full}\n(the seed wording; answers pool across its rewordings)`}>
            {r.v.label}
          </span>
        ) : (
          <span className="font-medium text-ink">{r.v.label}</span>
        ),
    },
    ...pivot.cols.map(
      (c): Col<PivotRow> => ({
        id: `c:${c.key}`,
        label: colDim === "none" ? mLabel(measure) : c.full ? shortText(c.full, 40) : c.label,
        ...(c.full && { tip: `${c.group} - ${c.full} (answers pool across its rewordings)` }),
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
          const tip = `${a.k} of ${a.n} - 95% range ${pct(w.low)}-${pct(w.high)}${thin ? " - too few answers to read, take with care" : ""}`;
          const body = (
            <span className={`inline-flex items-center leading-tight ${thin ? "opacity-50" : ""}`} title={tip}>
              {pct(a.k / a.n)}
              {thin && <span className="ml-0.5 align-super text-[10px] text-ink-3">*</span>}
            </span>
          );
          if (!evidence || a.k === 0) return body;
          return (
            <button
              type="button"
              className="rounded px-1 hover:bg-primary-soft/40"
              onClick={() =>
                setDrill({
                  title: `${mLabel(measure)} - ${[r.v.label, colDim === "none" ? null : c.label].filter(Boolean).join(" x ")}`,
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

  const label = (text: string) => (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{text}</span>
  );
  const dimSelect = (text: string, value: DimKey, set: (k: DimKey) => void, other: DimKey | null) => (
    <label className="flex items-center gap-1.5">
      {label(text)}
      <select
        value={value}
        onChange={(e) => {
          set(e.target.value as DimKey);
          manual();
        }}
        className="input w-auto py-0.5 text-[12px]"
      >
        {DIMS.filter((d) => d.key === "none" || (d.key !== other && !dimReason(d.key))).map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card overflow-hidden">
      <div className="grid gap-2.5 border-b border-line px-4 py-3">
        {presets.length > 0 && (
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink">Open a ready-made table</span>
            <select
              value={activePreset ?? ""}
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                if (p) applyPreset(p);
              }}
              className="input w-auto py-0.5 text-[13px]"
            >
              <option value="">Your own table</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="text-[12px] text-ink-3">or change any setting below to build your own.</span>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5">
            {label("Questions")}
            <select
              value={pool}
              onChange={(e) => {
                setPool(e.target.value as ViewKey);
                manual();
              }}
              className="input w-auto py-0.5 text-[12px]"
            >
              {present.map((k) => (
                <option key={k} value={k}>
                  {POOL_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            {label("Measure")}
            <select
              value={measure.id}
              onChange={(e) => {
                setMeasure(e.target.value);
                manual();
              }}
              className="input w-auto max-w-[16rem] py-0.5 text-[12px]"
            >
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {legalMeasures
                    .filter((m) => m.group === g)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {mLabel(m)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          {dimSelect("Rows", rowDim, setRow, null)}
          {dimSelect("Columns", colDim, setCol, rowDim)}
          {needsBrand && (
            <label className="flex items-center gap-1.5">
              {label("Brand")}
              <select
                value={brand}
                onChange={(e) => {
                  setBrand(Number(e.target.value));
                  manual();
                }}
                className="input w-auto py-0.5 text-[12px]"
              >
                {data.brands.map((b, i) =>
                  b.listed ? (
                    <option key={i} value={i}>
                      {b.name}
                    </option>
                  ) : null
                )}
              </select>
            </label>
          )}
          {needsArg && data.args.length > 0 && (
            <label className="flex items-center gap-1.5">
              {label("Argument")}
              <select
                value={arg}
                onChange={(e) => {
                  setArg(Number(e.target.value));
                  manual();
                }}
                className="input w-auto max-w-[16rem] py-0.5 text-[12px]"
              >
                {data.args.map((a, i) => (
                  <option key={i} value={i}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-[12px] text-ink-3">
          {mTip(measure)} {POOL_LABEL[pool]}. Hover a cell for its range; cells under 20 answers are muted and starred.
        </p>
        {pivot.rows.length === 0 || pivot.cols.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-3">No answers count toward this measure here.</p>
        ) : (
          <SortTable
            key={`${rowDim}|${colDim}`}
            cols={cols}
            rows={pivot.rows.map((v) => ({ v }))}
            filename={`table_${pool}_${measure.id}.csv`}
            defaultSort={byQuestion ? { id: "stage", dir: 1 } : { id: cols[1].id, dir: -1 }}
          />
        )}
        <p className="mt-2 text-[11px] text-ink-3">
          Based on {pivot.answers.toLocaleString("en-US")} answers to {POOL_LABEL[pool].toLowerCase()} questions.
        </p>
      </div>
      {drill && <EvidencePanel runId={runId} request={drill} onClose={closeDrill} />}
    </div>
  );
}
