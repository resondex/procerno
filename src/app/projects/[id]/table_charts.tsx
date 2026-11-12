"use client";

import type { Ref } from "react";
import { pct } from "./pivot_compute";

/**
 * The Data page's charts (2026-11-11): any pivot table shown as Bars or Dots.
 * Plain inline SVG, colors from the theme tokens only (the --series-N
 * comparison palette, validated for both themes in globals.css), no chart
 * library. Visible text carries rates only - "k of n" and ranges ride each
 * mark's <title> tooltip. Thin cells (under 20 answers) draw muted with a
 * star, as in the table.
 *
 * The SVG is laid out in a fixed 720-wide viewBox and scales to its column.
 * `downloadChart` resolves the CSS variables to the current theme's values
 * and saves a PNG (an SVG file when the canvas route fails).
 */

/** More series than this and the page shows the table with a note. */
export const MAX_SERIES = 6;

export interface ChartSeries {
  key: string;
  label: string;
  /** A CSS color, normally var(--series-N). */
  color: string;
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
  /** Aligned with the series; null = no answers in that cell. */
  values: (ChartValue | null)[];
}

export const seriesColor = (i: number) => `var(--series-${(i % MAX_SERIES) + 1})`;
const MUTED = "var(--ink-3)";

const W = 720;
const LABEL_W = 210;
const FONT = "Inter, ui-sans-serif, system-ui, sans-serif";
const CHAR = 6.6; // average glyph width at 12px
const clip = (s: string, chars: number) => (s.length > chars ? `${s.slice(0, chars - 1).trimEnd()}…` : s);
const LABEL_CHARS = Math.floor((LABEL_W - 14) / CHAR);

/** The legend, laid out inside the SVG so a download carries it. */
function legendLayout(series: ChartSeries[]): { items: { s: ChartSeries; x: number; y: number }[]; height: number } {
  if (series.length < 2) return { items: [], height: 0 };
  const items: { s: ChartSeries; x: number; y: number }[] = [];
  let x = 0;
  let y = 10;
  for (const s of series) {
    const w = 18 + clip(s.label, 40).length * CHAR + 18;
    if (x > 0 && x + w > W) {
      x = 0;
      y += 20;
    }
    items.push({ s, x, y });
    x += w;
  }
  return { items, height: y + 16 };
}

function Legend({ series }: { series: ChartSeries[] }) {
  const { items } = legendLayout(series);
  return (
    <g>
      {items.map(({ s, x, y }) => (
        <g key={s.key} transform={`translate(${x},${y})`}>
          <rect x={0} y={-5} width={10} height={10} rx={2} style={{ fill: s.muted ? MUTED : s.color, opacity: s.muted ? 0.55 : 1 }} />
          <text x={16} y={4} style={{ fill: "var(--ink-2)", fontSize: 12 }}>
            {clip(s.label, 40)}
          </text>
        </g>
      ))}
    </g>
  );
}

function RowLabel({ row, y }: { row: ChartRow; y: number }) {
  return (
    <text x={0} y={y} dominantBaseline="middle" style={{ fill: "var(--ink)", fontSize: 12.5, fontWeight: 500 }}>
      <title>{row.full ?? row.label}</title>
      {clip(row.label, LABEL_CHARS)}
    </text>
  );
}

const valueText = (c: ChartValue) => `${pct(c.v)}${c.thin ? "*" : ""}`;

export function BarsChart({ series, rows, svgRef }: { series: ChartSeries[]; rows: ChartRow[]; svgRef?: Ref<SVGSVGElement> }) {
  const legend = legendLayout(series);
  const top = legend.height + (legend.height ? 10 : 4);
  const barH = 12;
  const gap = 3;
  const pad = 14;
  const groupH = series.length * barH + (series.length - 1) * gap;
  const x0 = LABEL_W;
  const x1 = W - 48;
  const maxV = Math.max(0, ...rows.flatMap((r) => r.values.map((c) => c?.v ?? 0)));
  // Bars scale to the largest value, rounded up to the next 10 points.
  const dom = Math.min(1, Math.max(0.1, Math.ceil(maxV * 10) / 10));
  const H = top + rows.length * (groupH + pad) + 4;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Bar chart of the table" style={{ fontFamily: FONT, display: "block" }}>
      <Legend series={series} />
      {rows.map((r, ri) => {
        const gy = top + ri * (groupH + pad);
        return (
          <g key={r.key}>
            <RowLabel row={r} y={gy + groupH / 2} />
            {series.map((s, si) => {
              const c = r.values[si];
              const y = gy + si * (barH + gap);
              if (!c) {
                return (
                  <text key={s.key} x={x0 + 4} y={y + barH / 2} dominantBaseline="middle" style={{ fill: "var(--ink-3)", fontSize: 11 }}>
                    -
                  </text>
                );
              }
              const w = Math.max(c.v > 0 ? 1.5 : 0, ((x1 - x0) * c.v) / dom);
              const fill = s.muted ? MUTED : s.color;
              const op = (s.muted ? 0.5 : 1) * (c.thin ? 0.4 : 1);
              return (
                <g key={s.key}>
                  <title>{`${s.label}: ${c.tip}`}</title>
                  <rect x={x0} y={y} width={w} height={barH} rx={2} style={{ fill, opacity: op }} />
                  <text
                    x={x0 + w + 6}
                    y={y + barH / 2}
                    dominantBaseline="middle"
                    style={{ fill: s.muted ? "var(--ink-3)" : "var(--ink-2)", fontSize: 11.5, opacity: c.thin ? 0.6 : 1 }}
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
  );
}

export function DotsChart({ series, rows, svgRef }: { series: ChartSeries[]; rows: ChartRow[]; svgRef?: Ref<SVGSVGElement> }) {
  const legend = legendLayout(series);
  const top = legend.height + (legend.height ? 14 : 8);
  const rowH = 30;
  const valW = 46;
  const x0 = LABEL_W;
  const x1 = W - valW * series.length - 14;
  const X = (v: number) => x0 + (x1 - x0) * Math.max(0, Math.min(1, v));
  const scaleY = top + rows.length * rowH + 4;
  const H = scaleY + 18;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Dot chart of the table" style={{ fontFamily: FONT, display: "block" }}>
      <Legend series={series} />
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
            <RowLabel row={r} y={y} />
            <line x1={x0} x2={x1} y1={y} y2={y} style={{ stroke: "var(--line)", strokeWidth: 1 }} />
            {present.length > 1 && <line x1={X(lo)} x2={X(hi)} y1={y} y2={y} style={{ stroke: "var(--neutral-bar)", strokeWidth: 3, strokeLinecap: "round" }} />}
            {series.map((s, si) => {
              const c = r.values[si];
              if (!c) return null;
              return (
                <circle
                  key={s.key}
                  cx={X(c.v)}
                  cy={y}
                  r={5.5}
                  style={{ fill: s.muted ? MUTED : s.color, opacity: (s.muted ? 0.55 : 1) * (c.thin ? 0.4 : 1), stroke: "var(--surface)", strokeWidth: 2 }}
                >
                  <title>{`${s.label}: ${c.tip}`}</title>
                </circle>
              );
            })}
            {series.map((s, si) => {
              const c = r.values[si];
              return (
                <text
                  key={`v:${s.key}`}
                  x={x1 + 14 + si * valW}
                  y={y}
                  dominantBaseline="middle"
                  style={{ fill: c ? (s.muted ? MUTED : s.color) : "var(--ink-3)", fontSize: 11.5, fontWeight: 600, opacity: c?.thin ? 0.6 : 1 }}
                >
                  {c ? valueText(c) : "-"}
                </text>
              );
            })}
          </g>
        );
      })}
      {[0, 0.5, 1].map((t) => (
        <text key={`s${t}`} x={X(t)} y={scaleY + 12} textAnchor="middle" style={{ fill: "var(--ink-3)", fontSize: 11 }}>
          {`${t * 100}%`}
        </text>
      ))}
    </svg>
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
  const w = vb?.width || W;
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
