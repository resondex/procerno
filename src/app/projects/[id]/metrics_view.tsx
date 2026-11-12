"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ViewKey } from "@/lib/engine/views";
import type { WorkbenchView } from "@/lib/engine/workbench";
import { MEASURES, illegalReason, type MeasureDef } from "@/lib/engine/measures";
import EvidencePanel, { type EvidenceRequest } from "./evidence_panel";
import { SortTable, downloadCsv, downloadXlsx, sortRows, type Col, type SortState } from "./table";
import { QUESTION_TYPE_LABEL } from "./question_types";
import {
  DIMS,
  DIM_LABEL,
  MAX_MEASURES,
  THIN,
  changePts,
  computePivot,
  dimReason,
  matchPrev,
  mLabel,
  mTip,
  pct,
  resolveSettings,
  settingsOf,
  shortText,
  wilson,
  type Acc,
  type DimKey,
  type DimValue,
  type PivotCol,
  type PivotSettings,
} from "./pivot_compute";
import { BarsChart, DotsChart, MAX_SERIES, downloadChart, seriesColor, type ChartRow, type ChartSeries } from "./table_charts";
import { T } from "./type_scale";

/**
 * The Data page's pivot (2026-11-11 rebuild; the 2026-10-30 Metrics chassis,
 * WORKBENCH_REDESIGN_2026-10-30.md): CONTROLLED by the Data page, which owns
 * the settings (a library entry sets them; any change here hands them back
 * and the page highlights "Build your own table") and the workbench payload
 * (one fetch per open, plus the previous wave's on first use).
 *
 * - Questions (the pool), one measure - or up to four side by side when
 *   Columns is None - Rows, Columns, and the brand / argument a measure
 *   reads. Legality lives in engine/measures.ts alone (pivot_compute.ts
 *   resolves): measures and dimensions the pool does not ask are hidden.
 * - Show as: Table | Bars | Dots (Lines waits for three waves).
 * - Waves: This wave | Wave over wave - the same table computed on the
 *   previous coded wave (computePivot on its payload), matched by label;
 *   the table gains a Change column in points after each number, the charts
 *   draw the previous wave quiet beside this one, one column at a time.
 *
 * Cells print the rate only; "k of n - 95% range" is on hover; cells under
 * 20 answers are muted and starred and get no change. Clicking a cell opens
 * the answers it counts (the numerator) in the evidence panel.
 */

export type ShowAs = "table" | "bars" | "dots";
export type Waves = "this" | "prev";

const POOL_LABEL = QUESTION_TYPE_LABEL;
/** Charts draw at most this many rows; the table lists every row. */
const CHART_ROWS = 30;

type PivotRow = { v: DimValue };

const rateOf = (a: Acc | undefined) => (a && a.n > 0 ? Math.round((a.k / a.n) * 1000) / 10 : null);
const rangeTip = (a: Acc) => {
  const w = wilson(a.k, a.n);
  return `${a.k} of ${a.n} - 95% range ${pct(w.low)}-${pct(w.high)}${a.n < THIN ? " - too few answers to read, take with care" : ""}`;
};

export function PivotTable({
  runId,
  data,
  settings,
  onSettings,
  show,
  onShow,
  waves,
  onWaves,
  hasPrev,
  prevData,
  name,
  evidence = true,
}: {
  runId: string;
  data: WorkbenchView;
  settings: PivotSettings;
  /** A control changed by hand. */
  onSettings: (s: PivotSettings) => void;
  show: ShowAs;
  onShow: (s: ShowAs) => void;
  waves: Waves;
  onWaves: (w: Waves) => void;
  /** A previous coded wave exists. */
  hasPrev: boolean;
  /** The previous wave's payload: undefined while it loads, null when it failed. */
  prevData: WorkbenchView | null | undefined;
  /** The table's name (the library entry, or "your own table"), for downloads. */
  name: string;
  evidence?: boolean;
}) {
  const [drill, setDrill] = useState<EvidenceRequest | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);
  // The table's sort, kept per table signature so the charts follow it.
  const [sortPick, setSortPick] = useState<(SortState & { sig: string }) | null>(null);
  // Wave over wave charts draw one column at a time (matched by `match`).
  const [chartColPick, setChartCol] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const res = useMemo(() => resolveSettings(settings, data), [settings, data]);
  const pivot = useMemo(() => (res ? computePivot(res, data) : null), [res, data]);
  const comparing = waves === "prev" && hasPrev;
  const prevPivot = useMemo(() => {
    if (!comparing || !res || !prevData?.facts) return null;
    const pr = resolveSettings(settingsOf(res, data), prevData);
    return pr && pr.pool === res.pool ? computePivot(pr, prevData) : null;
  }, [comparing, res, data, prevData]);
  const prevOf = useMemo(() => matchPrev(prevPivot), [prevPivot]);

  if (!res || !pivot) {
    return (
      <div className="card px-6 py-10">
        <p className="text-sm text-ink-3">No coded answers to build a table from yet.</p>
      </div>
    );
  }
  const { pool, measures, rowDim, colDim, brand, arg, present, poolRows } = res;
  const lead = measures[0];
  const base = settingsOf(res, data);
  const change = (patch: Partial<PivotSettings>) => onSettings({ ...base, ...patch });
  const legalMeasures = MEASURES.filter((m) => !illegalReason(m, pool));
  const groups = [...new Set(legalMeasures.map((m) => m.group))];
  // A dimension is offered when legal for every measure on the table.
  const dimOk = (k: DimKey) => measures.every((m) => !dimReason(data, pool, m, poolRows, k));
  const chosenBrand = data.brands[brand];

  // ---- the table columns ----
  const byQuestion = rowDim === "question";
  const cellOf = (r: PivotRow, c: PivotCol) => pivot.cells.get(`${r.v.key}|${c.key}`);
  const colHead = (c: PivotCol) => (colDim === "none" ? mLabel(c.measure) : c.full ? shortText(c.full, 40) : c.label);
  const valueCol = (c: PivotCol): Col<PivotRow> => ({
    id: `c:${c.key}`,
    label: colHead(c),
    tip: colDim === "none" ? mTip(c.measure) : c.full ? `${c.group} - ${c.full} (answers pool across its rewordings)` : undefined,
    num: true,
    val: (r) => rateOf(cellOf(r, c)),
    render: (r) => {
      const a = cellOf(r, c);
      if (!a || a.n === 0) return <span className="text-ink-3/50">-</span>;
      const thin = a.n < THIN;
      const body = (
        <span className={`inline-flex items-center leading-tight ${thin ? "opacity-50" : ""}`} title={rangeTip(a)}>
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
              title: `${mLabel(c.measure)} - ${[r.v.label, colDim === "none" ? null : c.label].filter(Boolean).join(" x ")}`,
              subtitle: `${POOL_LABEL[pool]}${c.measure.brand && !r.v.brands && !c.brands ? ` - ${chosenBrand.name}` : ""}`,
              ids: a.ids,
              total: a.k,
              highlight: c.measure.brand ? [...(r.v.brands ?? c.brands ?? new Set([brand]))].map((i) => data.brands[i].name) : [],
            })
          }
        >
          {body}
        </button>
      );
    },
  });
  const changeCol = (c: PivotCol): Col<PivotRow> => ({
    id: `d:${c.key}`,
    label: "Change",
    tip: `${colHead(c)}: points since the previous wave. Blank where either wave has under 20 answers or no such cell.`,
    num: true,
    val: (r) => (prevOf ? changePts(cellOf(r, c), prevOf(r.v, c)) : null),
    render: (r) => {
      const before = prevOf?.(r.v, c);
      const d = prevOf ? changePts(cellOf(r, c), before) : null;
      if (d === null) return <span className="text-ink-3/50"> </span>;
      const tip = before ? `Previous wave ${pct(before.k / before.n)} - ${before.k} of ${before.n}` : undefined;
      return (
        <span
          className="tabular-nums"
          title={tip}
          style={{ color: d > 0 ? "var(--success)" : d < 0 ? "var(--danger)" : "var(--ink-3)", fontWeight: d === 0 ? 400 : 600 }}
        >
          {d > 0 ? `+${d}` : d}
        </span>
      );
    },
  });
  const cols: Col<PivotRow>[] = [
    ...(byQuestion
      ? [
          {
            id: "stage",
            label: "Question type",
            val: (r: PivotRow) => r.v.group ?? "",
            render: (r: PivotRow) => <span className="text-[11px] uppercase tracking-wide text-ink-3">{r.v.group}</span>,
          },
        ]
      : []),
    {
      id: "label",
      label: DIM_LABEL[rowDim] === "None" ? "" : DIM_LABEL[rowDim],
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
    ...pivot.cols.flatMap((c) => (comparing ? [valueCol(c), changeCol(c)] : [valueCol(c)])),
  ];
  const rows: PivotRow[] = pivot.rows.map((v) => ({ v }));
  const sig = `${pool}|${measures.map((m) => m.id).join(",")}|${rowDim}|${colDim}|${comparing ? 1 : 0}`;
  const defaultSort: SortState = byQuestion ? { id: "stage", dir: 1 } : { id: cols[1]?.id ?? "label", dir: -1 };
  const sort: SortState = sortPick && sortPick.sig === sig && cols.some((c) => c.id === sortPick.id) ? sortPick : defaultSort;
  const ordered = sortRows(cols, rows, sort);
  const filename = name.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "_").toLowerCase() || "table";

  // ---- the chart ----
  const tooMany = !comparing && pivot.cols.length > MAX_SERIES;
  const chartCol = comparing ? (pivot.cols.find((c) => c.match === chartColPick) ?? pivot.cols[0]) : null;
  const chartValue = (a: Acc | undefined) => (a && a.n > 0 ? { v: a.k / a.n, thin: a.n < THIN, tip: rangeTip(a) } : null);
  const series: ChartSeries[] = chartCol
    ? [
        { key: "prev", label: `Previous wave - ${colHead(chartCol)}`, color: "var(--ink-3)", muted: true },
        { key: "now", label: `This wave - ${colHead(chartCol)}`, color: seriesColor(0) },
      ]
    : pivot.cols.map((c, i) => ({ key: c.key, label: colHead(c), color: seriesColor(i) }));
  const chartRows: ChartRow[] = ordered.slice(0, CHART_ROWS).map((r) => ({
    key: r.v.key,
    label: r.v.label,
    full: r.v.full,
    values: chartCol ? [chartValue(prevOf?.(r.v, chartCol)), chartValue(cellOf(r, chartCol))] : pivot.cols.map((c) => chartValue(cellOf(r, c))),
  }));
  const charted = show !== "table" && !tooMany;

  // ---- controls ----
  const label = (text: string) => <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{text}</span>;
  const select = "input w-auto py-0.5 text-[12px]";
  const measureOptions = (keep: string) =>
    groups.map((g) => (
      <optgroup key={g} label={g}>
        {legalMeasures
          .filter((m) => m.group === g && (m.id === keep || !measures.some((x) => x.id === m.id)))
          .map((m) => (
            <option key={m.id} value={m.id}>
              {mLabel(m)}
            </option>
          ))}
      </optgroup>
    ));
  const setMeasureAt = (i: number, id: string) => {
    const ids = measures.map((m) => m.id);
    ids[i] = id;
    change({ measures: ids });
  };
  const addMeasure = () => {
    const next = legalMeasures.find((m) => !measures.some((x) => x.id === m.id));
    if (next) change({ measures: [...measures.map((m) => m.id), next.id] });
  };
  const dimSelect = (text: string, value: DimKey, set: (k: DimKey) => void, other: DimKey | null) => (
    <label className="flex items-center gap-1.5">
      {label(text)}
      <select value={value} onChange={(e) => set(e.target.value as DimKey)} className={select}>
        {DIMS.filter((d) => d.key === "none" || (d.key !== other && dimOk(d.key))).map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
  const seg = (on: boolean) => `rounded-full px-3 py-0.5 ${T.cap} ${on ? "bg-primary-soft font-semibold text-ink" : "text-ink-3 hover:text-ink-2"}`;
  const segGroup = "inline-flex rounded-full border border-line bg-surface p-[2px]";
  const disabledSeg = `rounded-full px-3 py-0.5 ${T.cap} cursor-not-allowed text-ink-3/50`;

  const downloadTable = () =>
    downloadCsv(
      `${filename}.csv`,
      cols.map((c) => c.label),
      ordered.map((r) => cols.map((c) => c.val(r)))
    );

  return (
    <div className="card overflow-hidden">
      <div className="grid gap-2.5 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5">
            {label("Questions")}
            <select value={pool} onChange={(e) => change({ pool: e.target.value as ViewKey })} className={select}>
              {present.map((k) => (
                <option key={k} value={k}>
                  {POOL_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            {label("Measure")}
            <select value={lead.id} onChange={(e) => setMeasureAt(0, e.target.value)} className={`${select} max-w-[16rem]`} title={mTip(lead)}>
              {measureOptions(lead.id)}
            </select>
          </label>
          {colDim === "none" &&
            measures.slice(1).map((m: MeasureDef, j) => (
              <span key={m.id} className="flex items-center gap-1">
                <select value={m.id} onChange={(e) => setMeasureAt(j + 1, e.target.value)} className={`${select} max-w-[14rem]`} title={mTip(m)}>
                  {measureOptions(m.id)}
                </select>
                <button
                  type="button"
                  onClick={() => change({ measures: measures.filter((x) => x.id !== m.id).map((x) => x.id) })}
                  aria-label={`Remove ${mLabel(m)}`}
                  title="Remove this measure"
                  className="rounded px-1 text-[13px] text-ink-3 hover:text-ink"
                >
                  ×
                </button>
              </span>
            ))}
          {colDim === "none" && measures.length < MAX_MEASURES && legalMeasures.length > measures.length && (
            <button type="button" onClick={addMeasure} className={`${T.cap} font-medium text-primary hover:opacity-80`}>
              + Add a measure
            </button>
          )}
          {dimSelect("Rows", rowDim, (k) => change({ row: k }), null)}
          {dimSelect(
            "Columns",
            colDim,
            // A real column dimension keeps only the first measure.
            (k) => change({ col: k, measures: k === "none" ? measures.map((m) => m.id) : [lead.id] }),
            rowDim
          )}
          {res.needsBrand && (
            <label className="flex items-center gap-1.5">
              {label("Brand")}
              <select
                value={brand}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  change({ brand: i === data.target ? null : data.brands[i].name });
                }}
                className={select}
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
          {res.needsArg && data.args.length > 0 && (
            <label className="flex items-center gap-1.5">
              {label("Argument")}
              <select value={arg} onChange={(e) => change({ arg: data.args[Number(e.target.value)] ?? null })} className={`${select} max-w-[16rem]`}>
                {data.args.map((a, i) => (
                  <option key={i} value={i}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-1.5">
            {label("Show as")}
            <span className={segGroup} role="group" aria-label="Show as">
              {(["table", "bars", "dots"] as ShowAs[]).map((s) => (
                <button key={s} type="button" aria-pressed={show === s} className={seg(show === s)} onClick={() => onShow(s)}>
                  {s === "table" ? "Table" : s === "bars" ? "Bars" : "Dots"}
                </button>
              ))}
              <button type="button" disabled title="Needs three waves" className={disabledSeg}>
                Lines
              </button>
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {label("Waves")}
            <span className={segGroup} role="group" aria-label="Waves">
              <button type="button" aria-pressed={!comparing} className={seg(!comparing)} onClick={() => onWaves("this")}>
                This wave
              </button>
              {hasPrev ? (
                <button type="button" aria-pressed={comparing} className={seg(comparing)} onClick={() => onWaves("prev")}>
                  Wave over wave
                </button>
              ) : (
                <button type="button" disabled title="Needs a second measured wave" className={disabledSeg}>
                  Wave over wave
                </button>
              )}
            </span>
          </span>
          {comparing && show !== "table" && pivot.cols.length > 1 && chartCol && (
            <label className="flex items-center gap-1.5">
              {label("Compare")}
              <select value={chartCol.match} onChange={(e) => setChartCol(e.target.value)} className={`${select} max-w-[16rem]`}>
                {pivot.cols.map((c) => (
                  <option key={c.key} value={c.match}>
                    {colHead(c)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <p className="max-w-[70ch] text-[12px] text-ink-3" title={`Based on ${pivot.answers.toLocaleString("en-US")} answers`}>
            {measures.length === 1 ? `${mTip(lead)} ` : ""}
            {POOL_LABEL[pool]} questions. Hover a number for its range; numbers under 20 answers are muted and starred.
          </p>
          {pivot.rows.length > 0 && pivot.cols.length > 0 && (
            <span className="flex gap-3">
              {charted ? (
                <button
                  type="button"
                  onClick={() => svgRef.current && downloadChart(svgRef.current, filename)}
                  className="text-[12px] font-medium text-primary hover:opacity-80"
                >
                  Download this chart
                </button>
              ) : (
                <>
                  <button type="button" onClick={downloadTable} className="text-[12px] font-medium text-primary hover:opacity-80">
                    Download this table
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadXlsx(
                        filename,
                        cols.map((c) => c.label),
                        ordered.map((r) => cols.map((c) => c.val(r)))
                      )
                    }
                    className="text-[12px] font-medium text-primary hover:opacity-80"
                  >
                    Excel
                  </button>
                </>
              )}
            </span>
          )}
        </div>
        {comparing && prevData === undefined && <p className="mt-2 text-[12px] text-ink-3">Reading the previous wave...</p>}
        {comparing && prevData === null && <p className="mt-2 text-[12px] text-ink-3">The previous wave could not be read.</p>}
        {pivot.rows.length === 0 || pivot.cols.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-3">No answers count toward this measure here.</p>
        ) : charted ? (
          <div className="mt-3 grid gap-2">
            {show === "bars" ? (
              <BarsChart series={series} rows={chartRows} svgRef={svgRef} />
            ) : (
              <DotsChart series={series} rows={chartRows} svgRef={svgRef} />
            )}
            {ordered.length > CHART_ROWS && (
              <p className="text-[12px] text-ink-3">The chart shows the first rows in the table&apos;s order; the table lists every row.</p>
            )}
          </div>
        ) : (
          <>
            {show !== "table" && tooMany && (
              <p className="mt-3 text-[12px] text-ink-3">This table has too many columns to chart, so it is shown as a table.</p>
            )}
            <SortTable
              key={sig}
              cols={cols}
              rows={rows}
              filename={`${filename}.csv`}
              defaultSort={sort}
              onSort={(s) => setSortPick({ ...s, sig })}
              noDownload
            />
          </>
        )}
      </div>
      {drill && <EvidencePanel runId={runId} request={drill} onClose={closeDrill} />}
    </div>
  );
}
