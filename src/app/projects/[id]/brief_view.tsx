"use client";

/**
 * The Brief pill (2026-11-04, BRIEF_PILL_DESIGN_2026-11-04.md).
 *
 * One fetch per (subject brand, engine set) brings all seven memo frames,
 * composed on the server as finished sentences; this file renders the chosen
 * frame VERBATIM - it never re-words or re-computes a number. Frame
 * switching is client-side; a brand or engine change refetches (the engine
 * set rides the shell's EngineSetContext and the section's key).
 *
 * Counts live only in `tip` fields: hover tooltips on screen, never in print.
 *
 * Download PDF prints ONLY the memo: the memo node is cloned into a print
 * root on <body>, <html> gets the pb-printing class, and the print CSS below
 * (scoped to html.pb-printing) hides every other child of <body>. Printing
 * from any other pill never carries the class, so it is unaffected.
 */

import { useEffect, useRef, useState } from "react";
import {
  BRIEF_FRAMES,
  BRIEF_FRAME_LABELS,
  type BriefFrame,
  type BriefMemo,
  type BriefPara,
  type BriefSection as BriefSectionT,
  type BriefView,
  type BriefViz,
  BRIEF_SCATTER_GEOM,
  scatterPx,
} from "@/lib/engine/brief_types";
import { useEngineSet } from "./view_parts";

// ---------- per-project preferences (frame + brand) ----------

const frameKey = (p: string) => `procerno_brief_frame:${p}`;
const subjectKey = (p: string) => `procerno_brief_subject:${p}`;
const versionKey = (p: string) => `procerno_brief_version:${p}`;

/** Option B (2026-11-05): the composed memo rewritten as prose by the
 * fact-guarded writer (engine/brief_writer.ts). */
type BriefVersion = "A" | "B";
type WrittenResult = { memo: BriefMemo | null; written: boolean; reason?: string } | { error: string };

function readPref(key: string | null): string | null {
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string | null, value: string) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice holds for this page view only
  }
}
const isFrame = (s: string | null): s is BriefFrame => !!s && (BRIEF_FRAMES as string[]).includes(s);

// ---------- styling ----------

const BRIEF_CSS = `
.pb-sans{ font-family: var(--font-inter), system-ui, -apple-system, sans-serif; }
.pb-paper{
  background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
  padding: 2.75rem 3.25rem 2.25rem; max-width: calc(88ch + 6.5rem);
}
@media (max-width: 639px){ .pb-paper{ padding: 1.6rem 1.15rem 1.4rem; border-radius: 8px; } }
.pb-memo{
  /* The site's own faces: Inter for text, Instrument Serif for display -
   * Georgia appeared nowhere else in the product (Tyler's catch). */
  font-family: var(--font-inter), system-ui, -apple-system, sans-serif;
  color: var(--ink); font-size: 15.5px; line-height: 1.7; max-width: 88ch;
}
@media (max-width: 639px){ .pb-memo{ font-size: 15px; line-height: 1.65; } }
.pb-memo .pb-num, .pb-memo table, .pb-memo .pb-score{ font-variant-numeric: lining-nums tabular-nums; }
.pb-title{
  font-family: var(--font-instrument-serif), Georgia, serif;
  font-size: 40px; line-height: 1.08; font-weight: 400; letter-spacing: 0; margin: 0; text-wrap: balance;
}
@media (max-width: 639px){ .pb-title{ font-size: 31px; } }
.pb-meta{ margin-top: .55rem; font-size: 12.5px; line-height: 1.5; color: var(--ink-3); }
.pb-meta span + span::before{ content: "\\00B7"; margin: 0 .5em; }
.pb-head-rule{ margin: 1.5rem 0 0; border: 0; border-top: 1px solid var(--line); }
.pb-section{ margin-top: 2em; }
.pb-section:first-of-type.pb-nohead{ margin-top: 1.6em; }
.pb-section.pb-nohead{ margin-top: 1.1em; }
.pb-h{
  font-family: var(--font-instrument-serif), Georgia, serif;
  font-size: 26px; line-height: 1.2; font-weight: 400; margin: 0 0 .45em; color: var(--ink);
}
.pb-p{ margin: 0; }
.pb-p + .pb-p{ margin-top: .9em; }
.pb-p b{ font-weight: 700; }
.pb-p.pb-beat + .pb-p.pb-beat{ margin-top: 1.15em; }
.pb-runhead{ display: block; margin-bottom: .15em; }
.pb-watch{ display: block; margin-top: .3em; font-style: italic; color: var(--ink-2); }
.pb-lede .pb-p:first-of-type{ font-size: 1.07em; line-height: 1.66; }
.pb-list{ list-style: none; margin: 0; padding: 0; }
.pb-list li{ display: grid; grid-template-columns: 2.1em 1fr; align-items: baseline; }
.pb-list li + li{ margin-top: 1.05em; }
.pb-list .pb-num{ font-weight: 700; color: var(--ink-3); }
.pb-table{ width: 100%; border-collapse: collapse; font-size: 15.5px; line-height: 1.45; }
.pb-table th{
  font-family: var(--font-inter), system-ui, sans-serif; font-size: 12.5px; font-weight: 600;
  color: var(--ink-2); text-align: left; padding: 9px 12px; border-bottom: 1.5px solid var(--ink-3);
  background: color-mix(in srgb, var(--ink) 3.5%, var(--surface)); vertical-align: bottom;
}
.pb-table td{ padding: 11px 12px; border-bottom: 1px solid var(--line); vertical-align: baseline; }
.pb-table .pb-r{ text-align: right; white-space: nowrap; }
.pb-table td.pb-r{ font-weight: 600; }
.pb-table tr:last-child td{ border-bottom: 1px solid var(--line); }
.pb-table tr.pb-hl td{ background: color-mix(in srgb, var(--primary) 13%, var(--surface)); font-weight: 600; }
.pb-table tr.pb-hl td:first-child{ box-shadow: inset 3px 0 0 var(--primary); }
.pb-table-wrap{ margin-top: .25em; }
@media (max-width: 640px){ .pb-table-wrap{ overflow-x: auto; } }
.pb-score td:first-child{ color: var(--ink); }
.pb-quads{ display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: .4em; }
@media (min-width: 640px){ .pb-quads{ grid-template-columns: 1fr 1fr; } }
.pb-card{
  border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px 19px;
  background: color-mix(in srgb, var(--ink) 2.5%, var(--surface));
}
.pb-card-h{
  font-family: var(--font-inter), system-ui, sans-serif; font-size: 13px; font-weight: 600;
  color: var(--ink-2); margin: 0 0 .7em; padding-bottom: .55em; border-bottom: 1px solid var(--line);
}
.pb-card .pb-p{ font-size: 15.5px; line-height: 1.6; }
.pb-card .pb-p + .pb-p{ margin-top: .75em; }
.pb-foot{ margin-top: 2.6em; padding-top: .8em; border-top: 1px solid var(--line); font-size: 13.5px; font-style: italic; color: var(--ink-3); }
.pb-viz{ margin-top: .7em; break-inside: avoid; page-break-inside: avoid; }
.pb-viz-t{ font-family: var(--font-inter), system-ui, sans-serif; font-size: 15px; line-height: 1.4; font-weight: 600; color: var(--ink); margin: 0; }
.pb-viz-s{ font-family: var(--font-inter), system-ui, sans-serif; font-size: 12.5px; line-height: 1.45; color: var(--ink-3); margin: .2em 0 0; }
.pb-viz svg{ display: block; width: 100%; height: auto; margin-top: .9em; overflow: visible; font-family: var(--font-inter), system-ui, -apple-system, sans-serif; font-variant-numeric: tabular-nums; }
.pb-viz-legend{ display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: .7em; font-family: var(--font-inter), system-ui, sans-serif; font-size: 12.5px; color: var(--ink-2); }
.pb-viz-legend i{ display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
@keyframes pb-pulse{ 0%,100%{ opacity:.55 } 50%{ opacity:1 } }
.pb-skel{ animation: pb-pulse 1.4s ease-in-out infinite; background: var(--line); border-radius: 4px; }
@media (prefers-reduced-motion: reduce){ .pb-skel{ animation:none; } }
#pb-print-root{ display:none; }
@media print{
  html.pb-printing body > *:not(#pb-print-root){ display:none !important; }
  html.pb-printing, html.pb-printing body{ background:#fff !important; }
  html.pb-printing #pb-print-root{ display:block !important; padding:0.3in 0.45in; }
  html.pb-printing #pb-print-root, html.pb-printing #pb-print-root *{
    color:#111 !important; box-shadow:none !important; opacity:1 !important;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  html.pb-printing #pb-print-root .pb-paper{ border:0 !important; padding:0 !important; background:#fff !important; max-width:none !important; }
  html.pb-printing #pb-print-root .pb-memo{ max-width:none !important; font-size:11pt; line-height:1.55; }
  html.pb-printing #pb-print-root .pb-title{ font-size:21pt; }
  html.pb-printing #pb-print-root .pb-meta, html.pb-printing #pb-print-root .pb-foot,
  html.pb-printing #pb-print-root .pb-list .pb-num{ color:#555 !important; }
  html.pb-printing #pb-print-root .pb-h{ font-size:14pt; break-after:avoid; page-break-after:avoid; }
  html.pb-printing #pb-print-root .pb-head-rule, html.pb-printing #pb-print-root .pb-foot,
  html.pb-printing #pb-print-root .pb-table td{ border-color:#bbb !important; }
  html.pb-printing #pb-print-root .pb-table{ font-size:10.5pt; }
  html.pb-printing #pb-print-root .pb-table th{ background:#f1f1f1 !important; border-bottom:1.5pt solid #444 !important; color:#333 !important; }
  html.pb-printing #pb-print-root .pb-table td{ padding:7px 10px; }
  html.pb-printing #pb-print-root .pb-table tr{ break-inside:avoid; page-break-inside:avoid; }
  html.pb-printing #pb-print-root .pb-table tr.pb-hl td{ background:#e9eef2 !important; }
  html.pb-printing #pb-print-root .pb-table tr.pb-hl td:first-child{ box-shadow: inset 2.5pt 0 0 #555 !important; }
  html.pb-printing #pb-print-root .pb-quads{ grid-template-columns:1fr 1fr; gap:10px; }
  html.pb-printing #pb-print-root .pb-card{ background:#fff !important; border:1pt solid #999 !important; padding:12px 14px; break-inside:avoid; page-break-inside:avoid; }
  html.pb-printing #pb-print-root .pb-card-h{ border-color:#bbb !important; color:#333 !important; }
  html.pb-printing #pb-print-root .pb-card .pb-p{ font-size:10pt; }
  html.pb-printing #pb-print-root .pb-watch{ color:#444 !important; }
  html.pb-printing #pb-print-root .pb-list li{ break-inside:avoid; page-break-inside:avoid; }
  html.pb-printing #pb-print-root .pb-noprint{ display:none !important; }
  html.pb-printing #pb-print-root .pb-table-wrap{ overflow:visible !important; }
  /* The visuals print on the light palette whatever the screen theme. */
  html.pb-printing #pb-print-root{ --surface:#fff; --ink:#111; --ink-2:#333; --ink-3:#777; --line:#bbb; --primary:#5b7e92; }
  html.pb-printing #pb-print-root .pb-viz{ break-inside:avoid; page-break-inside:avoid; }
  html.pb-printing #pb-print-root .pb-viz-s{ color:#555 !important; }
}
`;

// ---------- hover note (tooltip only; never printed) ----------

function Tip({ tip, children }: { tip?: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!tip) return <>{children}</>;
  return (
    <span
      className="inline cursor-help"
      onMouseEnter={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.top });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <span
          style={{
            position: "fixed",
            left: Math.min(
              Math.max(pos.x, Math.min(176, window.innerWidth / 2)),
              window.innerWidth - Math.min(176, window.innerWidth / 2)
            ),
            top: pos.y - 8,
            transform: "translate(-50%, -100%)",
            zIndex: 50,
            maxWidth: Math.min(336, window.innerWidth - 16),
          }}
          className="pb-sans pb-noprint pointer-events-none w-max rounded-lg border border-line bg-surface px-3 py-2 text-left text-[12px] font-normal text-ink-2 shadow-lg"
        >
          {tip}
        </span>
      )}
    </span>
  );
}


// ---------- the visuals (inline SVG from the served BriefViz spec) ----------
// Grey-first with one accent; every number printed is the served string.

const QUIET = "var(--ink-3)";
const ACC = "var(--primary)";

/** Greedy word wrap at roughly `n` characters per line. */
function wrap(t: string, n: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of t.split(/\s+/)) {
    if (line && (line + " " + w).length > n) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

function FunnelViz({ v }: { v: BriefViz }) {
  const W = 760;
  const BAND = 30;
  const STEP = 52;
  const labelX = 214;
  const plotL = 232;
  const maxW = W - plotL - 64;
  const cx = plotL + maxW / 2;
  const width = (a = 0) => Math.max(14, (Math.min(a, 100) / 100) * maxW);
  const H = v.items.length * STEP - (STEP - BAND) + 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={v.title}>
      {v.items.slice(0, -1).map((it, i) => {
        const a = width(it.a) / 2;
        const b = width(v.items[i + 1].a) / 2;
        const y0 = 2 + i * STEP + BAND;
        const y1 = 2 + (i + 1) * STEP;
        return <polygon key={`t${i}`} points={`${cx - a},${y0} ${cx + a},${y0} ${cx + b},${y1} ${cx - b},${y1}`} fill={QUIET} fillOpacity={0.14} />;
      })}
      {v.items.map((it, i) => {
        const w = width(it.a);
        const y = 2 + i * STEP;
        return (
          <g key={i}>
            <text x={labelX} y={y + BAND / 2 + 4.5} textAnchor="end" fontSize={13.5} fontWeight={it.accent ? 600 : 400} fill={it.accent ? "var(--ink)" : "var(--ink-2)"}>
              {it.label}
            </text>
            <rect x={cx - w / 2} y={y} width={w} height={BAND} rx={2} fill={it.accent ? ACC : QUIET} fillOpacity={it.accent ? 1 : 0.5} />
            <text x={cx + w / 2 + 9} y={y + BAND / 2 + 4.5} fontSize={13.5} fontWeight={it.accent ? 700 : 500} fill={it.accent ? ACC : "var(--ink-2)"}>
              {it.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ScatterViz({ v }: { v: BriefViz }) {
  const g = BRIEF_SCATTER_GEOM;
  const xMax = v.xMax ?? 100;
  const yMax = v.yMax ?? 100;
  const px = (x: number, y: number) => scatterPx(x, y, xMax, yMax);
  const o = px(0, 0);
  const xEnd = px(xMax, 0);
  const yTop = px(0, yMax);
  const vl = v.vline !== undefined ? px(v.vline, 0) : null;
  const dX = v.diag ? Math.min(xMax, yMax * v.diag) : 0;
  const dEnd = v.diag ? px(dX, dX / v.diag) : null;
  // Dots: quiet first, the accent last so it draws on top.
  const items = [...v.items].sort((a, b) => Number(!!a.accent) - Number(!!b.accent));
  return (
    <svg viewBox={`0 0 ${g.w} ${g.h}`} role="img" aria-label={v.title}>
      <line x1={o.x} y1={o.y} x2={xEnd.x} y2={o.y} stroke="var(--line)" strokeWidth={1.2} />
      <line x1={o.x} y1={o.y} x2={o.x} y2={yTop.y} stroke="var(--line)" strokeWidth={1.2} />
      <text x={o.x} y={o.y + 17} fontSize={11.5} fill={QUIET} textAnchor="middle">0%</text>
      <text x={px(50, 0).x} y={o.y + 17} fontSize={11.5} fill={QUIET} textAnchor="middle">50%</text>
      <text x={xEnd.x} y={o.y + 17} fontSize={11.5} fill={QUIET} textAnchor="end">{xMax}%</text>
      <text x={o.x - 7} y={yTop.y + 4} fontSize={11.5} fill={QUIET} textAnchor="end">{yMax}%</text>
      {v.xLabel && (
        <text x={(o.x + xEnd.x) / 2} y={g.h - 6} fontSize={12.5} fill="var(--ink-2)" textAnchor="middle">
          {v.xLabel}
        </text>
      )}
      {v.yLabel && (
        <text transform={`translate(14 ${(o.y + yTop.y) / 2}) rotate(-90)`} fontSize={12.5} fill="var(--ink-2)" textAnchor="middle">
          {v.yLabel}
        </text>
      )}
      {vl && (
        <>
          <line x1={vl.x} y1={o.y} x2={vl.x} y2={yTop.y} stroke={QUIET} strokeWidth={1} strokeDasharray="4 4" />
          {v.vlineLabel && (
            <text x={vl.x + 6} y={g.top + 11} fontSize={11.5} fill={QUIET}>
              {v.vlineLabel}
            </text>
          )}
        </>
      )}
      {dEnd && (
        <>
          <line x1={o.x} y1={o.y} x2={dEnd.x} y2={dEnd.y} stroke={QUIET} strokeWidth={1} strokeDasharray="4 4" />
          {v.diagLabel && (
            <text x={v.diagLabelPx?.x ?? dEnd.x - 4} y={v.diagLabelPx?.y ?? dEnd.y - 8} fontSize={11.5} fill={QUIET} textAnchor="end">
              {v.diagLabel}
            </text>
          )}
        </>
      )}
      {items.map((it, i) => {
        const p = px(it.a ?? 0, it.b ?? 0);
        const r = it.accent ? 7 : it.unlabeled ? 4 : 5;
        // A label the engine set well off its dot gets a quiet leader to the
        // label's nearest edge (box estimated the way the engine estimates it).
        const fs = it.accent ? 13.5 : 12.5;
        const lx = p.x + g.labelDx + (it.dx ?? 0);
        const ly = p.y + g.labelDy + (it.dy ?? 0);
        const bx0 = lx;
        const bx1 = lx + it.label.length * fs * (it.accent ? 0.6 : 0.555);
        const by0 = ly - fs * 0.78;
        const by1 = ly + fs * 0.24;
        const nx = Math.min(Math.max(p.x, bx0), bx1);
        const ny = Math.min(Math.max(p.y, by0), by1);
        const dist = Math.hypot(nx - p.x, ny - p.y);
        const leader = !it.unlabeled && dist > r + 12;
        return (
          <g key={i}>
            {leader && (
              <line
                x1={p.x + ((nx - p.x) / dist) * (r + 2)}
                y1={p.y + ((ny - p.y) / dist) * (r + 2)}
                x2={nx + ((p.x - nx) / dist) * 3}
                y2={ny + ((p.y - ny) / dist) * 3}
                stroke={QUIET}
                strokeOpacity={0.6}
                strokeWidth={0.8}
              />
            )}
            <circle cx={p.x} cy={p.y} r={r} fill={it.accent ? ACC : QUIET} fillOpacity={it.accent ? 1 : it.unlabeled ? 0.4 : 0.6} />
            {!it.unlabeled && (
              <text
                x={p.x + g.labelDx + (it.dx ?? 0)}
                y={p.y + g.labelDy + (it.dy ?? 0)}
                fontSize={it.accent ? 13.5 : 12.5}
                fontWeight={it.accent ? 700 : 400}
                fill={it.accent ? ACC : "var(--ink-2)"}
              >
                {it.label}
              </text>
            )}
          </g>
        );
      })}
      {v.clusterNote && v.notePx && (
        <text x={v.notePx.x} y={v.notePx.y} fontSize={11.5} fontStyle="italic" fill={QUIET}>
          {(v.noteLines ?? [v.clusterNote]).map((l, i) => (
            <tspan key={i} x={v.notePx!.x} dy={i === 0 ? 0 : 14}>
              {l}
            </tspan>
          ))}
        </text>
      )}
    </svg>
  );
}

function PairsViz({ v }: { v: BriefViz }) {
  const W = 760;
  const labelX = 196;
  const x0 = 210;
  const BAR = 15;
  const INNER = 4;
  const GROUP = BAR * 2 + INNER;
  const GAP = 22;
  const maxV = Math.max(1, ...v.items.flatMap((it) => [it.a ?? 0, it.b ?? 0]));
  const span = W - x0 - 150;
  const w = (x = 0) => Math.max(2, (x / maxV) * span);
  const H = v.items.length * (GROUP + GAP) - GAP + 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={v.title}>
      {v.items.map((it, i) => {
        const y = 2 + i * (GROUP + GAP);
        const lines = wrap(it.label, 26).slice(0, 2);
        const ly = y + GROUP / 2 + 4.5 - ((lines.length - 1) * 16) / 2;
        return (
          <g key={i}>
            <text x={labelX} y={ly} textAnchor="end" fontSize={13.5} fill="var(--ink)">
              {lines.map((l, j) => (
                <tspan key={j} x={labelX} dy={j === 0 ? 0 : 16}>
                  {l}
                </tspan>
              ))}
            </text>
            <rect x={x0} y={y} width={w(it.a)} height={BAR} rx={2} fill={ACC} />
            <text x={x0 + w(it.a) + 7} y={y + BAR - 3} fontSize={13} fontWeight={700} fill={ACC}>
              {it.value}
            </text>
            <rect x={x0} y={y + BAR + INNER} width={w(it.b)} height={BAR} rx={2} fill={QUIET} fillOpacity={0.5} />
            <text x={x0 + w(it.b) + 7} y={y + BAR * 2 + INNER - 3} fontSize={12.5} fill="var(--ink-2)">
              {it.who ? `${it.who} ${it.bValue ?? ""}` : it.bValue}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PyramidViz({ v }: { v: BriefViz }) {
  const W = 760;
  const n = v.items.length;
  const frac = (i: number) => (n <= 1 ? 1 : 0.5 + (0.5 * i) / (n - 1));
  const PAD = 13;
  const LH = 18;
  const blocks = v.items.map((it, i) => {
    const bw = W * frac(i);
    const lines = wrap(it.note ?? "", Math.floor((bw - 40) / 7.1)).slice(0, 2);
    return { it, bw, lines, h: PAD * 2 + LH + lines.length * LH };
  });
  const GAP = 6;
  const H = blocks.reduce((a, b) => a + b.h, 0) + GAP * (n - 1) + 2;
  const tops = blocks.map((_, i) => 1 + blocks.slice(0, i).reduce((a, b) => a + b.h + GAP, 0));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={v.title}>
      {blocks.map((b, i) => {
        const top = tops[i];
        const x = (W - b.bw) / 2;
        const fill = b.it.accent ? "color-mix(in srgb, var(--primary) 17%, var(--surface))" : "color-mix(in srgb, var(--ink) 5%, var(--surface))";
        return (
          <g key={i}>
            <rect x={x} y={top} width={b.bw} height={b.h} rx={4} style={{ fill }} stroke={b.it.accent ? ACC : "var(--line)"} strokeOpacity={b.it.accent ? 0.45 : 1} />
            <text x={W / 2} y={top + PAD + 13} textAnchor="middle" fontSize={13.5} fontWeight={700} fill={b.it.accent ? ACC : "var(--ink)"}>
              {b.it.label}
            </text>
            {b.lines.map((l, j) => (
              <text key={j} x={W / 2} y={top + PAD + 13 + LH * (j + 1)} textAnchor="middle" fontSize={13} fill="var(--ink-2)">
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function Viz({ v }: { v: BriefViz }) {
  return (
    <figure className="pb-viz" style={{ margin: 0 }}>
      <p className="pb-viz-t">{v.title}</p>
      {v.subtitle && <p className="pb-viz-s">{v.subtitle}</p>}
      {v.legend && (
        <div className="pb-viz-legend" aria-hidden="true">
          <span>
            <i style={{ background: ACC }} />
            {v.legend[0]}
          </span>
          <span>
            <i style={{ background: QUIET, opacity: 0.5 }} />
            {v.legend[1]}
          </span>
        </div>
      )}
      {v.kind === "funnel" && <FunnelViz v={v} />}
      {v.kind === "scatter" && <ScatterViz v={v} />}
      {v.kind === "pairs" && <PairsViz v={v} />}
      {v.kind === "pyramid" && <PyramidViz v={v} />}
    </figure>
  );
}

// ---------- the memo ----------

const NUMBERED = /^(\d+)\.\s+/;

function ParaBody({ p, lead }: { p: BriefPara; lead?: string }) {
  const l = lead ?? p.lead;
  // A move's closing "Watch: <metric>." sets on its own quiet line (the
  // served words, unchanged - only the line break is typesetting).
  const w = p.text.lastIndexOf(" Watch: ");
  const body = w > 0 ? p.text.slice(0, w) : p.text;
  const watch = w > 0 ? p.text.slice(w + 1) : null;
  return (
    <>
      <Tip tip={p.tip}>
        {l && (/[.?!:"')]$/.test(l.trim()) ? <b>{l} </b> : <b className="pb-runhead">{l}</b>)}
        {body}
      </Tip>
      {watch && <span className="pb-watch">{watch}</span>}
    </>
  );
}

function Paras({ paras }: { paras: BriefPara[] }) {
  // Numbered findings ("1. ...") read as their own beats: a hanging number,
  // the rest of the lead bold, the text running inline after it.
  const numbered = paras.length > 1 && paras.every((p) => p.lead && NUMBERED.test(p.lead));
  if (numbered)
    return (
      <ol className="pb-list">
        {paras.map((p, i) => {
          const m = (p.lead ?? "").match(NUMBERED);
          return (
            <li key={i}>
              <span className="pb-num">{m ? `${m[1]}.` : `${i + 1}.`}</span>
              <span>
                <ParaBody p={p} lead={(p.lead ?? "").replace(NUMBERED, "")} />
              </span>
            </li>
          );
        })}
      </ol>
    );
  const beats = paras.length > 1 && paras.every((p) => !!p.lead);
  return (
    <>
      {paras.map((p, i) => (
        <p key={i} className={beats ? "pb-p pb-beat" : "pb-p"}>
          <ParaBody p={p} />
        </p>
      ))}
    </>
  );
}

function Section({ s, lede, wave }: { s: BriefSectionT; lede: boolean; wave: string | null }) {
  return (
    <section className={`pb-section ${s.heading ? "" : "pb-nohead"} ${lede ? "pb-lede" : ""}`}>
      {s.heading && <h3 className="pb-h">{s.heading}</h3>}

      {s.viz && <Viz v={s.viz} />}

      {s.paras && <Paras paras={s.paras} />}

      {s.rows && (
        <div className="pb-table-wrap">
          <table className="pb-table pb-score">
            <thead>
              <tr>
                <th>What we measure</th>
                <th className="pb-r">{wave ? `Wave ${wave}` : "This wave"}</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <Tip tip={r.tip}>{r.label}</Tip>
                  </td>
                  <td className="pb-r">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {s.quads && (
        <div className="pb-quads">
          {s.quads.flatMap((q, qi) =>
            [0, 1].map((ci) => (
              <div key={`${qi}-${ci}`} className="pb-card">
                <h4 className="pb-card-h">{q.headers[ci]}</h4>
                <Paras paras={q.cells[ci]} />
              </div>
            ))
          )}
        </div>
      )}

      {s.table && (
        <div className="pb-table-wrap">
          <table className="pb-table">
            <thead>
              <tr>
                {s.table.headers.map((h, i) => (
                  <th key={i} className={i > 0 && i < s.table!.headers.length - 1 ? "pb-r" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.table.rows.map((row, ri) => (
                <tr key={ri} className={ri === s.table?.highlightRow ? "pb-hl" : undefined}>
                  {row.map((c, ci) => (
                    <td key={ci} className={ci > 0 && ci < row.length - 1 ? "pb-r" : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** "American Express - Now what? - wave 1" -> its subject and wave. The
 * served title stays the print title; on screen it splits into a title and
 * a quiet meta line. */
function splitTitle(title: string, frameLabel: string): { head: string; wave: string | null } {
  const wave = title.match(/\bwave\s+(\d+)\s*$/i);
  const idx = title.indexOf(` - ${frameLabel}`);
  const head = idx > 0 ? title.slice(0, idx) : title.replace(/\s+-\s+wave\s+\d+\s*$/i, "");
  return { head, wave: wave ? wave[1] : null };
}

function Memo({ memo, subject, tracker, note }: { memo: BriefMemo; subject: string; tracker: string; note?: string }) {
  const frameLabel = BRIEF_FRAME_LABELS[memo.frame];
  const { head, wave } = splitTitle(memo.title, frameLabel);
  const firstParas = memo.sections.findIndex((s) => !!s.paras);
  return (
    <div className="pb-paper">
      <article className="pb-memo">
        <header>
          <h2 className="pb-title">{head || subject}</h2>
          <div className="pb-sans pb-meta">
            <span>{frameLabel}</span>
            {wave && <span>Wave {wave}</span>}
            {subject !== tracker && <span>A rival of {tracker}</span>}
          </div>
          {note && <p className="pb-sans pb-meta italic">{note}</p>}
          <hr className="pb-head-rule" />
        </header>
        {memo.sections.map((s, i) => (
          <Section key={s.key} s={s} lede={i === firstParas && i === 0 && !s.heading} wave={wave} />
        ))}
        {memo.footer && <p className="pb-foot">{memo.footer}</p>}
      </article>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="pb-paper grid gap-3" aria-busy="true" aria-label="Loading the brief">
      <div className="pb-skel h-8 w-2/3" />
      <div className="pb-skel h-3 w-1/4" />
      <div className="pb-skel mt-6 h-4 w-full" />
      <div className="pb-skel h-4 w-11/12" />
      <div className="pb-skel h-4 w-5/6" />
      <div className="pb-skel mt-6 h-5 w-1/3" />
      <div className="pb-skel h-4 w-full" />
      <div className="pb-skel h-4 w-10/12" />
    </div>
  );
}

// ---------- print ----------

let printCleanup: (() => void) | null = null;

function printMemo(node: HTMLElement, title: string) {
  printCleanup?.();
  const root = document.createElement("div");
  root.id = "pb-print-root";
  root.appendChild(node.cloneNode(true));
  document.body.appendChild(root);
  const html = document.documentElement;
  const prevTitle = document.title;
  html.classList.add("pb-printing");
  document.title = title;
  const cleanup = () => {
    if (printCleanup !== cleanup) return;
    printCleanup = null;
    window.removeEventListener("afterprint", cleanup);
    html.classList.remove("pb-printing");
    document.title = prevTitle;
    root.remove();
  };
  printCleanup = cleanup;
  window.addEventListener("afterprint", cleanup);
  window.print();
}

// ---------- the section ----------

export default function BriefSection({ runId, projectId }: { runId: string; projectId?: string }) {
  const engines = useEngineSet();
  const fKey = projectId ? frameKey(projectId) : null;
  const sKey = projectId ? subjectKey(projectId) : null;
  const vKey = projectId ? versionKey(projectId) : null;

  // The brand the reader asked for; null = the saved one (or the server's
  // default, the tracker's own brand). Changing it refetches.
  const [requested, setRequested] = useState<string | null>(null);
  const [frame, setFrame] = useState<BriefFrame | null>(null);
  const [view, setView] = useState<BriefView | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<BriefVersion | null>(null);
  // Written memos per (frame, subject, engine set); a key absent while B is
  // on screen is still being written.
  const [writtenMemos, setWrittenMemos] = useState<Record<string, WrittenResult>>({});
  const inFlight = useRef<Set<string>>(new Set());
  const memoRef = useRef<HTMLDivElement>(null);

  const engineKey = engines?.join(",") ?? "";
  useEffect(() => {
    let live = true;
    const want = requested ?? readPref(sKey);
    const q = new URLSearchParams();
    if (want) q.set("subject", want);
    if (engineKey) q.set("engines", engineKey);
    const qs = q.toString();
    fetch(`/api/runs/${runId}/brief${qs ? `?${qs}` : ""}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`The brief could not load (${r.status}).`);
        const d = (await r.json()) as { view: BriefView | null };
        if (!live) return;
        // Hydrate the saved frame here, not in a mount effect.
        setFrame((f) => {
          if (f) return f;
          const saved = readPref(fKey);
          return isFrame(saved) ? saved : "now_what";
        });
        setVersion((v) => v ?? (readPref(vKey) === "B" ? "B" : "A"));
        setView(d.view);
        setError(null);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [runId, engineKey, requested, sKey, fKey, vKey]);

  // Option B: fetch the written memo for the frame on screen, once per
  // (frame, subject, engine set). State is set only in the fetch callback.
  const viewSubject = view?.subject ?? null;
  const wantFrame: BriefFrame = frame ?? "now_what";
  const writtenKey = viewSubject ? `${wantFrame}|${viewSubject}|${engineKey}` : null;
  useEffect(() => {
    if (version !== "B" || !writtenKey || !viewSubject) return;
    if (writtenMemos[writtenKey] || inFlight.current.has(writtenKey)) return;
    inFlight.current.add(writtenKey);
    const q = new URLSearchParams();
    q.set("subject", viewSubject);
    if (engineKey) q.set("engines", engineKey);
    q.set("written", "1");
    q.set("frame", wantFrame);
    const k = writtenKey;
    fetch(`/api/runs/${runId}/brief?${q.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`The written version could not load (${r.status}).`);
        const d = (await r.json()) as { memo: BriefMemo | null; written: boolean; reason?: string };
        setWrittenMemos((m) => ({ ...m, [k]: d }));
      })
      .catch((e: Error) => setWrittenMemos((m) => ({ ...m, [k]: { error: e.message } })))
      .finally(() => inFlight.current.delete(k));
  }, [version, writtenKey, viewSubject, wantFrame, engineKey, runId, writtenMemos]);

  useEffect(() => () => printCleanup?.(), []);

  if (error && !view) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (view === undefined)
    return (
      <div className="grid gap-6">
        <style>{BRIEF_CSS}</style>
        <Skeleton />
      </div>
    );
  if (view === null) return null;

  const current: BriefFrame = frame ?? "now_what";
  const composed = view.memos[current];
  const showB = version === "B";
  const wr = showB && writtenKey ? writtenMemos[writtenKey] : undefined;
  const writing = showB && !wr;
  let memo: BriefMemo | undefined = composed;
  let memoNote: string | undefined;
  if (showB && wr) {
    if ("error" in wr || !wr.written || !wr.memo) {
      memoNote = "The written version is not available for this frame - showing the composed memo.";
    } else {
      memo = wr.memo;
      memoNote = "Option B - model-written from the measured facts. Every number is checked against the composed memo.";
    }
  }

  const pickFrame = (f: BriefFrame) => {
    setFrame(f);
    writePref(fKey, f);
  };
  const pickVersion = (v: BriefVersion) => {
    setVersion(v);
    writePref(vKey, v);
  };
  const pickSubject = (s: string) => {
    if (s === view.subject) return;
    writePref(sKey, s);
    setLoading(true);
    setRequested(s);
  };

  const selectCls =
    "pb-sans rounded-md border border-line bg-surface px-2.5 py-1 text-[13px] font-medium text-ink hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-primary";

  return (
    <div className="grid gap-6">
      <style>{BRIEF_CSS}</style>
      <div className="pb-sans flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5">
          <span className="text-[12px] text-ink-3">Frame:</span>
          <select className={selectCls} value={current} onChange={(e) => pickFrame(e.target.value as BriefFrame)}>
            {BRIEF_FRAMES.map((f) => (
              <option key={f} value={f}>
                {BRIEF_FRAME_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Memo version" className="flex overflow-hidden rounded-md border border-line text-[13px] font-medium">
          {(["A", "B"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={(version ?? "A") === v}
              onClick={() => pickVersion(v)}
              className={`px-2.5 py-1 transition-colors ${(version ?? "A") === v ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:text-ink"} ${v === "B" ? "border-l border-line" : ""}`}
            >
              {v === "A" ? "A - Composed" : "B - Written"}
            </button>
          ))}
        </div>
        {view.subjects.length > 1 && (
          <label className="flex items-center gap-1.5">
            <span className="text-[12px] text-ink-3">Brand:</span>
            <select
              className={selectCls}
              value={view.subject}
              disabled={loading}
              onChange={(e) => pickSubject(e.target.value)}
            >
              {view.subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={!memo || loading || writing}
          onClick={() => memoRef.current && memo && printMemo(memoRef.current, memo.title)}
          className="rounded-full border border-line px-3 py-1 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-3 disabled:opacity-50"
        >
          Download PDF
        </button>
        {loading && <span className="text-[12px] text-ink-3">Updating...</span>}
        {writing && <span className="text-[12px] italic text-ink-3">Writing this memo from the measured facts...</span>}
        {error && view && <span className="text-[12px] text-danger">{error}</span>}
      </div>

      <div ref={memoRef} className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
        {writing ? (
          <Skeleton />
        ) : memo ? (
          <Memo memo={memo} subject={view.subject} tracker={view.subjects[0] ?? view.subject} note={memoNote} />
        ) : (
          <p className="text-[13px] text-ink-3">This frame has nothing to say yet.</p>
        )}
      </div>
    </div>
  );
}
