"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { pct } from "./pivot_compute";

/**
 * The Data page's charts (2026-11-11): any pivot table shown as Bars or Dots.
 * Plain inline SVG, no chart library. Visible text carries rates only - the
 * 95% range rides each mark's <title> tooltip. Thin cells (under 20 answers)
 * draw muted with a star, as in the table.
 *
 * Colours (2026-11-16, the Data page clean-up): the dashboard's --pa-*
 * tokens, the same ones panel_parts.tsx names C_YOU / C_AWAY / C_USUAL. The
 * tracker's own brand is blue, a rival pink, everything else the neutral
 * grey; series sharing one colour are told apart by shade (`shade`), and a
 * row may carry its own colour (a brand row) that overrides the series'.
 *
 * Size (2026-11-16): the SVG is laid out at the width it is drawn at (a
 * ResizeObserver on its box), so one viewBox unit is one pixel and the 12px
 * labels render at the page's caption size. `downloadChart` resolves the CSS
 * variables to the current theme's values and saves a PNG (an SVG file when
 * the canvas route fails).
 */

/** More series than this and the page shows the table with a note. */
export const MAX_SERIES = 6;

/** The dashboard's colour roles (globals.css --pa-*; panel_parts C_YOU / C_AWAY / C_USUAL). */
export const CHART_YOU = "var(--pa-yours)";
export const CHART_AWAY = "var(--pa-theirs)";
export const CHART_OTHER = "var(--pa-usual)";

export interface ChartSeries {
  key: string;
  label: string;
  /** A CSS color: CHART_YOU, CHART_AWAY or CHART_OTHER. */
  color: string;
  /** Opacity 0-1 telling apart series of one colour (1 = full). */
  shade?: number;
  /** The previous wave: drawn quiet beside this wave. */
  muted?: boolean;
}

export interface ChartValue {
  v: number;
  thin: boolean;
  tip: string;
}

export interface ChartRow {
  key: string;
  label: string;
  full?: string;
  /** A row's own colour (a brand row: you blue, other brands grey); overrides the series colour. */
  color?: string;
  /** The tracker's own brand: label in blue, semibold. */
  you?: boolean;
  /** Aligned with the series; null = no answers in that cell. */
  values: (ChartValue | null)[];
}

/** Shades for series sharing one colour, strongest first. */
const SHADES = [1, 0.7, 0.5, 0.36, 0.26, 0.18];
export const shadeAt = (i: number) => SHADES[Math.min(i, SHADES.length - 1)];

const MUTED = "var(--ink-3)";
const FONT = "Inter, ui-sans-serif, system-ui, sans-serif";
/** Every label in the chart: the page's caption size. */
const FS = 12;
const CHAR = 6.9; // a generous average glyph width at 12px Inter
const clip = (s: string, chars: number) => (s.length > chars ? `${s.slice(0, Math.max(1, chars - 1)).trimEnd()}…` : s);
const DEFAULT_W = 720;
const MIN_W = 320;

/** The chart's drawn width (one viewBox unit = one pixel). */
function useBoxWidth(): [Ref<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(DEFAULT_W);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (cw > 0) setW((prev) => (Math.abs(prev - cw) < 2 ? prev : Math.max(MIN_W, cw)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** The row-label column: about 30% of the width, within limits. */
const labelW = (W: number) => Math.round(Math.max(110, Math.min(230, W * 0.3)));

const fillOf = (row: ChartRow, s: ChartSeries) => (s.muted ? MUTED : (row.color ?? s.color));
const opacityOf = (s: ChartSeries, c: ChartValue) => (s.muted ? 0.5 : (s.shade ?? 1)) * (c.thin ? 0.4 : 1);
/** A value label: blue / pink when the mark is, else the quiet ink. */
const textFill = (fill: string) => (fill === CHART_YOU || fill === CHART_AWAY ? fill : "var(--ink-2)");

/** The legend, laid out inside the SVG so a download carries it. */
function legendLayout(series: ChartSeries[], W: number): { items: { s: ChartSeries; x: number; y: number; text: string }[]; height: number } {
  if (series.length < 2) return { items: [], height: 0 };
  const items: { s: ChartSeries; x: number; y: number; text: string }[] = [];
  const maxChars = Math.max(12, Math.floor((W - 40) / CHAR));
  let x = 0;
  let y = 10;
  for (const s of series) {
    const text = clip(s.label, Math.min(40, maxChars));
    const w = 18 + text.length * CHAR + 18;
    if (x > 0 && x + w > W) {
      x = 0;
      y += 20;
    }
    items.push({ s, x, y, text });
    x += w;
  }
  return { items, height: y + 16 };
}

function Legend({ items }: { items: { s: ChartSeries; x: number; y: number; text: string }[] }) {
  return (
    <g>
      {items.map(({ s, x, y, text }) => (
        <g key={s.key} transform={`translate(${x},${y})`}>
          <title>{s.label}</title>
          <rect x={0} y={-5} width={10} height={10} rx={2} style={{ fill: s.muted ? MUTED : s.color, opacity: s.muted ? 0.5 : (s.shade ?? 1) }} />
          <text x={16} y={4} style={{ fill: "var(--ink-2)", fontSize: FS }}>
            {text}
          </text>
        </g>
      ))}
    </g>
  );
}

/** The highlighted row's band (search pointed the table at it). */
function RowBand({ y, h, W }: { y: number; h: number; W: number }) {
  return <rect data-focus="1" x={-4} y={y} width={W + 4} height={h} rx={4} style={{ fill: "var(--primary-soft)", opacity: 0.6 }} />;
}

function RowLabel({ row, y, chars, strong }: { row: ChartRow; y: number; chars: number; strong?: boolean }) {
  const text = clip(row.label, chars);
  const cut = text !== row.label;
  return (
    <text
      x={0}
      y={y}
      dominantBaseline="middle"
      style={{ fill: row.you ? CHART_YOU : "var(--ink)", fontSize: FS, fontWeight: row.you || strong ? 600 : 500 }}
    >
      {/* The full label text only - never a count. */}
      {(cut || row.full) && <title>{row.full ?? row.label}</title>}
      {text}
    </text>
  );
}

const valueText = (c: ChartValue) => `${pct(c.v)}${c.thin ? "*" : ""}`;

export function BarsChart({
  series,
  rows,
  svgRef,
  highlight,
}: {
  series: ChartSeries[];
  rows: ChartRow[];
  svgRef?: Ref<SVGSVGElement>;
  /** A row key to mark. */
  highlight?: string;
}) {
  const [box, W] = useBoxWidth();
  const legend = legendLayout(series, W);
  const top = legend.height + (legend.height ? 10 : 4);
  const barH = 14;
  const gap = 4;
  const pad = 14;
  const groupH = series.length * barH + (series.length - 1) * gap;
  const LW = labelW(W);
  const x0 = LW;
  const x1 = W - 48;
  const chars = Math.floor((LW - 12) / CHAR);
  const maxV = Math.max(0, ...rows.flatMap((r) => r.values.map((c) => c?.v ?? 0)));
  // Bars scale to the largest value, rounded up to the next 10 points.
  const dom = Math.min(1, Math.max(0.1, Math.ceil(maxV * 10) / 10));
  const H = top + rows.length * (groupH + pad) + 4;
  return (
    <div ref={box}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Bar chart of the table" style={{ fontFamily: FONT, display: "block" }}>
        <Legend items={legend.items} />
        {rows.map((r, ri) => {
          const gy = top + ri * (groupH + pad);
          return (
            <g key={r.key}>
              {r.key === highlight && <RowBand y={gy - pad / 2 + 1} h={groupH + pad - 2} W={W} />}
              <RowLabel row={r} y={gy + groupH / 2} chars={chars} strong={r.key === highlight} />
              {series.map((s, si) => {
                const c = r.values[si];
                const y = gy + si * (barH + gap);
                if (!c) {
                  return (
                    <text key={s.key} x={x0 + 4} y={y + barH / 2} dominantBaseline="middle" style={{ fill: "var(--ink-3)", fontSize: FS }}>
                      -
                    </text>
                  );
                }
                const w = Math.max(c.v > 0 ? 1.5 : 0, ((x1 - x0) * c.v) / dom);
                const fill = fillOf(r, s);
                return (
                  <g key={s.key}>
                    <title>{`${s.label}: ${c.tip}`}</title>
                    <rect x={x0} y={y} width={w} height={barH} rx={2} style={{ fill, opacity: opacityOf(s, c) }} />
                    <text
                      x={x0 + w + 6}
                      y={y + barH / 2}
                      dominantBaseline="middle"
                      style={{ fill: s.muted ? "var(--ink-3)" : textFill(fill), fontSize: FS, fontWeight: r.you && !s.muted ? 600 : 400, opacity: c.thin ? 0.6 : 1 }}
                    >
                      {valueText(c)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function DotsChart({
  series,
  rows,
  svgRef,
  highlight,
}: {
  series: ChartSeries[];
  rows: ChartRow[];
  svgRef?: Ref<SVGSVGElement>;
  /** A row key to mark. */
  highlight?: string;
}) {
  const [box, W] = useBoxWidth();
  const legend = legendLayout(series, W);
  const top = legend.height + (legend.height ? 14 : 8);
  const rowH = 30;
  const valW = 44;
  const LW = labelW(W);
  const x0 = LW;
  const x1 = Math.max(x0 + 80, W - valW * series.length - 14);
  const chars = Math.floor((LW - 12) / CHAR);
  const X = (v: number) => x0 + (x1 - x0) * Math.max(0, Math.min(1, v));
  const scaleY = top + rows.length * rowH + 4;
  const H = scaleY + 20;
  return (
    <div ref={box}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Dot chart of the table" style={{ fontFamily: FONT, display: "block" }}>
        <Legend items={legend.items} />
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={X(t)} x2={X(t)} y1={top - 4} y2={scaleY} style={{ stroke: "var(--line)", strokeWidth: 1 }} />
        ))}
        {rows.map((r, ri) => {
          const y = top + ri * rowH + rowH / 2;
          const present = r.values.filter((c): c is ChartValue => !!c);
          const lo = present.length ? Math.min(...present.map((c) => c.v)) : 0;
          const hi = present.length ? Math.max(...present.map((c) => c.v)) : 0;
          return (
            <g key={r.key}>
              {r.key === highlight && <RowBand y={y - rowH / 2 + 1} h={rowH - 2} W={W} />}
              <RowLabel row={r} y={y} chars={chars} strong={r.key === highlight} />
              <line x1={x0} x2={x1} y1={y} y2={y} style={{ stroke: "var(--line)", strokeWidth: 1 }} />
              {present.length > 1 && <line x1={X(lo)} x2={X(hi)} y1={y} y2={y} style={{ stroke: "var(--neutral-bar)", strokeWidth: 3, strokeLinecap: "round" }} />}
              {series.map((s, si) => {
                const c = r.values[si];
                if (!c) return null;
                return (
                  <circle key={s.key} cx={X(c.v)} cy={y} r={5.5} style={{ fill: fillOf(r, s), opacity: opacityOf(s, c), stroke: "var(--surface)", strokeWidth: 2 }}>
                    <title>{`${s.label}: ${c.tip}`}</title>
                  </circle>
                );
              })}
              {series.map((s, si) => {
                const c = r.values[si];
                const fill = fillOf(r, s);
                return (
                  <text
                    key={`v:${s.key}`}
                    x={x1 + 14 + si * valW}
                    y={y}
                    dominantBaseline="middle"
                    style={{ fill: c ? (s.muted ? MUTED : textFill(fill)) : "var(--ink-3)", fontSize: FS, fontWeight: 600, opacity: c?.thin ? 0.6 : 1 }}
                  >
                    {c ? valueText(c) : "-"}
                  </text>
                );
              })}
            </g>
          );
        })}
        {[0, 0.5, 1].map((t) => (
          <text key={`s${t}`} x={X(t)} y={scaleY + 14} textAnchor="middle" style={{ fill: "var(--ink-3)", fontSize: FS }}>
            {`${t * 100}%`}
          </text>
        ))}
      </svg>
    </div>
  );
}

function save(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Save the chart as a PNG in the current theme's colors (SVG on failure). */
export function downloadChart(svg: SVGSVGElement, name: string) {
  const vb = svg.viewBox.baseVal;
  const w = vb?.width || DEFAULT_W;
  const h = vb?.height || 400;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const css = getComputedStyle(document.documentElement);
  const src = new XMLSerializer()
    .serializeToString(clone)
    .replace(/var\((--[a-z0-9-]+)\)/gi, (_, v: string) => css.getPropertyValue(v).trim() || "#888888");
  const svgBlob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  const fallback = () => {
    URL.revokeObjectURL(url);
    save(svgBlob, `${name}.svg`);
  };
  img.onload = () => {
    try {
      const scale = 2;
      const pad = 24;
      const canvas = document.createElement("canvas");
      canvas.width = (w + pad * 2) * scale;
      canvas.height = (h + pad * 2) * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return fallback();
      ctx.scale(scale, scale);
      ctx.fillStyle = css.getPropertyValue("--surface").trim() || "#ffffff";
      ctx.fillRect(0, 0, w + pad * 2, h + pad * 2);
      ctx.drawImage(img, pad, pad, w, h);
      canvas.toBlob((png) => {
        URL.revokeObjectURL(url);
        if (png) save(png, `${name}.png`);
        else save(svgBlob, `${name}.svg`);
      }, "image/png");
    } catch {
      fallback();
    }
  };
  img.onerror = fallback;
  img.src = url;
}
