"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewKey } from "@/lib/engine/views";
import type { WorkbenchView } from "@/lib/engine/workbench";
import { MEASURES, illegalReason, legalPools, type MeasureDef } from "@/lib/engine/measures";
import { STATION_LABEL, STATION_OF } from "@/lib/engine/views";
import EvidencePanel, { type EvidenceRequest } from "./evidence_panel";
import { SortTable, downloadCsv, downloadXlsx, sortRows, type Col, type SortState } from "./table";
import { QUESTION_TYPE_LABEL, QUESTION_TYPE_ORDER } from "./question_types";
import type { Focus } from "./data_search";
import { Choice, Segments } from "./pivot_controls";
import {
  DIMS,
  DIM_LABEL,
  DIM_NOUN,
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

export type ShowAs = "table" | "bars" | "dots" | "lines";
export type Waves = "this" | "prev";

const POOL_LABEL = QUESTION_TYPE_LABEL;
/** Charts draw at most this many rows; the table lists every row. */
const CHART_ROWS = 30;

type PivotRow = { v: DimValue };

/** Row / column choices in the dashboard's words, with a one-line hint. */
const DIM_CHOICE_LABEL: Partial<Record<DimKey, string>> = {};
const DIM_HINT: Partial<Record<DimKey, string>> = {
  room: "The kinds of buyer the questions were asked for",
  worry: "Each worry buyers or customers raised",
  rival: "Each rival you were asked about against",
  stage: "How the question was set up",
  question: "Each question, its rewordings pooled",
  engine: "Each AI assistant",
  vendor: "Each AI company, its assistants added together",
  tier: "Free assistants beside paid ones",
  mode: "Searching the web, or answering from memory",
  brand: "Every brand on your board",
  parent: "Brands added up by the company that owns them",
  argument: "Each argument the AI makes",
};
/** Why a number is greyed: which question types do ask for it. */
const askedIn = (m: MeasureDef) => {
  const where = legalPools(m).map((k) => QUESTION_TYPE_LABEL[k]);
  return where.length ? `these questions do not ask for it. Asked in: ${where.join(", ")}` : "these questions do not ask for it";
};
/** A measure's explanation, kept to one short line for the list. */
/** A measure's explanation without its denominator clause. */
const plainTip = (m: MeasureDef) => mTip(m).replace(/,? over (every answer|answers)[^.]*\./i, ".");
const shortTip = (m: MeasureDef) => {
  const t = plainTip(m);
  return t.length > 110 ? `${t.slice(0, 107).trimEnd()}...` : t;
};

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
  focus = null,
  onClearFocus,
  onReset,
  resetTo = null,
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
  /** A row to highlight (search opened the table pointed at it). */
  focus?: Focus | null;
  onClearFocus?: () => void;
  /** Back to the table the reader started from. */
  onReset?: () => void;
  /** That table's name; null = nothing to reset. */
  resetTo?: string | null;
}) {
  const [drill, setDrill] = useState<EvidenceRequest | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);
  // The table's sort, kept per table signature so the charts follow it.
  const [sortPick, setSortPick] = useState<(SortState & { sig: string }) | null>(null);
  // Wave over wave charts draw one column at a time (matched by `match`).
  const [chartColPick, setChartCol] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Bring a highlighted row into view once (a DOM read, no state).
  const focusKey = focus ? `${focus.dim}|${focus.match}` : "";
  useEffect(() => {
    if (!focusKey) return;
    const t = window.setTimeout(() => {
      const row = boxRef.current?.querySelector("tr.bg-primary-soft\\/25, g[data-focus]");
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [focusKey]);

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
              subtitle: `${POOL_LABEL[pool]}${c.measure.brand && !r.v.brands && !c.brands ? ` - ${chosenBrand.name}` : ""}${res.where ? ` - only ${res.where.label}` : ""}`,
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
  const others = (i: number) => measures.filter((_, j) => j !== i).map((m) => m.id);
  const measureChoices = (i: number) =>
    MEASURES.map((m) => {
      const bad = illegalReason(m, pool);
      const taken = !bad && others(i).includes(m.id);
      return {
        value: m.id,
        label: mLabel(m),
        group: bad ? "Not asked by these questions" : m.group,
        hint: bad || taken ? undefined : shortTip(m),
        disabled: bad ? askedIn(m) : taken ? "already on the table" : null,
      };
    }).sort((x, y) => Number(!!x.disabled) - Number(!!y.disabled));
  const setMeasureAt = (i: number, id: string) => {
    const ids = measures.map((m) => m.id);
    ids[i] = id;
    change({ measures: ids });
  };
  const addMeasure = () => {
    const next = legalMeasures.find((m) => !measures.some((x) => x.id === m.id));
    if (next) change({ measures: [...measures.map((m) => m.id), next.id] });
  };
  const dimWhy = (k: DimKey, other: DimKey | null): string | null => {
    if (k === "none") return null;
    if (k === other) return "it is already the other way of splitting the table";
    for (const m of measures) {
      const r = dimReason(data, pool, m, poolRows, k);
      if (r) return r;
    }
    return null;
  };
  const dimChoices = (other: DimKey | null, noneLabel: string, noneHint: string) =>
    DIMS.map((d) => ({
      value: d.key,
      label: d.key === "none" ? noneLabel : DIM_CHOICE_LABEL[d.key] ?? d.label,
      hint: d.key === "none" ? noneHint : DIM_HINT[d.key],
      disabled: dimWhy(d.key, other),
    })).sort((x, y) => Number(!!x.disabled) - Number(!!y.disabled));
  const poolChoices = QUESTION_TYPE_ORDER.map((k) => ({
    value: k,
    label: POOL_LABEL[k],
    group: STATION_LABEL[STATION_OF[k]],
    disabled: present.includes(k) ? null : "this tracker does not ask these questions",
  }));
  const where = res.where;

  const downloadTable = () =>
    downloadCsv(
      `${filename}.csv`,
      cols.map((c) => c.label),
      ordered.map((r) => cols.map((c) => c.val(r)))
    );

  // The table in one sentence.
  const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const mList = measures.map((m, i) => (i === 0 ? mLabel(m) : lcFirst(mLabel(m))));
  const mPhrase = mList.length > 1 ? `${mList.slice(0, -1).join(", ")} and ${mList[mList.length - 1]}` : mList[0];
  const sentence = [
    res.needsBrand ? `${chosenBrand.name} - ${lcFirst(mPhrase)}` : mPhrase,
    res.needsArg && data.args[arg] ? ` for the argument "${data.args[arg]}"` : "",
    rowDim === "none" ? " across all answers" : ` for each ${DIM_NOUN[rowDim]}`,
    colDim === "none" ? "" : `, split by ${DIM_NOUN[colDim]}`,
    `. ${POOL_LABEL[pool]} questions`,
    where ? `, only where the ${DIM_NOUN[where.dim]} is "${where.label}"` : "",
    ".",
  ].join("");
  const focusRow = focus && focus.dim === rowDim ? pivot.rows.find((r) => r.match === focus.match) : undefined;

  return (
    <div className="card" ref={boxRef}>
      <div className="grid gap-3 border-b border-line px-4 py-3.5">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <Choice
            label="1. Which questions"
            tip="Each kind of question the AI was asked. Numbers are only ever read inside one kind."
            value={pool}
            options={poolChoices}
            onChange={(v) => change({ pool: v as ViewKey })}
            width="min-w-[12rem]"
          />
          <Choice
            label="2. One row for each"
            tip="What the table's rows are."
            value={rowDim}
            options={dimChoices(null, "Nothing - one row", "All the answers together")}
            onChange={(v) => change({ row: v as DimKey })}
          />
          <Choice
            label="3. Split columns by"
            tip="Split each number into columns. With nothing here you can show up to four numbers side by side."
            value={colDim}
            options={dimChoices(rowDim, "Nothing - numbers side by side", "Show up to four numbers next to each other")}
            // A real column dimension keeps only the first measure.
            onChange={(v) => change({ col: v as DimKey, measures: v === "none" ? measures.map((m) => m.id) : [lead.id] })}
          />
          <div className="flex flex-wrap items-end gap-2">
            {measures.map((m, i) => (
              <div key={m.id} className="flex items-end gap-0.5">
                <Choice
                  label={i === 0 ? (measures.length > 1 ? "4. Numbers" : "4. Number") : " "}
                  tip={i === 0 ? "What each cell counts. Hover a number in the table for how many answers it rests on." : undefined}
                  value={m.id}
                  options={measureChoices(i)}
                  onChange={(v) => setMeasureAt(i, v)}
                  width="min-w-[9rem]"
                />
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => change({ measures: measures.filter((x) => x.id !== m.id).map((x) => x.id) })}
                    aria-label={`Remove ${mLabel(m)}`}
                    title="Remove this number"
                    className="mb-1.5 rounded px-1 text-[13px] text-ink-3 hover:text-ink"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {measures.length < MAX_MEASURES && legalMeasures.length > measures.length && (
              <button
                type="button"
                onClick={colDim === "none" ? addMeasure : undefined}
                disabled={colDim !== "none"}
                title={colDim !== "none" ? "Numbers side by side need the columns set to Nothing" : "Show another number beside this one"}
                className={`mb-1.5 ${T.ctl} ${colDim === "none" ? "text-primary hover:opacity-80" : "cursor-not-allowed text-ink-3/60"}`}
              >
                + Add a number
              </button>
            )}
          </div>
          {res.needsBrand && (
            <Choice
              label="For brand"
              tip="These numbers are read for one brand."
              value={String(brand)}
              options={data.brands.flatMap((b, i) => (b.listed ? [{ value: String(i), label: i === data.target ? `${b.name} (you)` : b.name }] : []))}
              onChange={(v) => {
                const i = Number(v);
                change({ brand: i === data.target ? null : data.brands[i].name });
              }}
            />
          )}
          {res.needsArg && data.args.length > 0 && (
            <Choice
              label="For argument"
              value={String(arg)}
              options={data.args.map((a, i) => ({ value: String(i), label: a }))}
              onChange={(v) => change({ arg: data.args[Number(v)] ?? null })}
              width="min-w-[12rem]"
            />
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <Segments<ShowAs>
            label="5. Show as"
            value={show}
            options={[
              { value: "table", label: "Table" },
              { value: "bars", label: "Bars" },
              { value: "dots", label: "Dots" },
              { value: "lines" as ShowAs, label: "Lines", disabled: "Lines need three measured waves" },
            ]}
            onChange={onShow}
          />
          <Segments<Waves>
            label="Waves"
            value={comparing ? "prev" : "this"}
            options={[
              { value: "this", label: "This wave" },
              { value: "prev", label: "Wave over wave", disabled: hasPrev ? null : "Needs a second measured wave" },
            ]}
            onChange={onWaves}
          />
          {comparing && show !== "table" && pivot.cols.length > 1 && chartCol && (
            <Choice
              label="Chart the column"
              value={chartCol.match}
              options={pivot.cols.map((c) => ({ value: c.match, label: colHead(c) }))}
              onChange={setChartCol}
            />
          )}
          {where && (
            <div className="grid gap-1">
              <span className={T.label}>Only</span>
              <span className={`inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)] bg-primary-soft py-1 pl-3 pr-1.5 ${T.cap} text-primary`}>
                {where.label}
                <button
                  type="button"
                  onClick={() => change({ where: null })}
                  aria-label={`Show every ${DIM_NOUN[where.dim]} again`}
                  title={`Show every ${DIM_NOUN[where.dim]} again`}
                  className="rounded-full px-1 hover:bg-surface"
                >
                  ×
                </button>
              </span>
            </div>
          )}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={!resetTo}
              title={resetTo ? `Back to "${resetTo}"` : "Nothing changed yet"}
              className={`ml-auto mb-1 rounded-lg border px-3 py-1 ${T.ctl} ${resetTo ? "border-line text-ink-2 hover:border-ink-3 hover:text-ink" : "cursor-not-allowed border-line/60 text-ink-3/50"}`}
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="grid max-w-[75ch] gap-1">
            <p className={`${T.body} font-medium text-ink`} title={`Based on ${pivot.answers.toLocaleString("en-US")} answers`}>
              {sentence}
            </p>
            <p className={`${T.cap} text-ink-3`}>
              {measures.length === 1 ? `${plainTip(lead)} ` : ""}
              Hover a number for its range; click it for the answers behind it. Numbers resting on too few answers are muted and starred.
            </p>
            {focus && (
              <p className={`${T.cap} text-ink-2`}>
                {focusRow ? (
                  <>
                    Highlighted: <b className="font-semibold text-ink">{focusRow.label}</b>
                  </>
                ) : (
                  <>&ldquo;{focus.match}&rdquo; is not a row of this table.</>
                )}{" "}
                {onClearFocus && (
                  <button type="button" onClick={onClearFocus} className="font-medium text-primary hover:opacity-80">
                    Clear
                  </button>
                )}
              </p>
            )}
          </div>
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
              <BarsChart series={series} rows={chartRows} svgRef={svgRef} highlight={focusRow?.key} />
            ) : (
              <DotsChart series={series} rows={chartRows} svgRef={svgRef} highlight={focusRow?.key} />
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
              activeRow={focusRow ? (r) => r.v.key === focusRow.key : undefined}
              noDownload
            />
          </>
        )}
      </div>
      {drill && <EvidencePanel runId={runId} request={drill} onClose={closeDrill} />}
    </div>
  );
}
