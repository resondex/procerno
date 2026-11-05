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
} from "@/lib/engine/brief_types";
import { useEngineSet } from "./view_parts";

// ---------- per-project preferences (frame + brand) ----------

const frameKey = (p: string) => `procerno_brief_frame:${p}`;
const subjectKey = (p: string) => `procerno_brief_subject:${p}`;

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
.pb-table-wrap{ overflow-x: auto; margin-top: .25em; }
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

function Memo({ memo, subject, tracker }: { memo: BriefMemo; subject: string; tracker: string }) {
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

  // The brand the reader asked for; null = the saved one (or the server's
  // default, the tracker's own brand). Changing it refetches.
  const [requested, setRequested] = useState<string | null>(null);
  const [frame, setFrame] = useState<BriefFrame | null>(null);
  const [view, setView] = useState<BriefView | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  }, [runId, engineKey, requested, sKey, fKey]);

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
  const memo = view.memos[current];

  const pickFrame = (f: BriefFrame) => {
    setFrame(f);
    writePref(fKey, f);
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
          disabled={!memo || loading}
          onClick={() => memoRef.current && memo && printMemo(memoRef.current, memo.title)}
          className="rounded-full border border-line px-3 py-1 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-3 disabled:opacity-50"
        >
          Download PDF
        </button>
        {loading && <span className="text-[12px] text-ink-3">Updating...</span>}
        {error && view && <span className="text-[12px] text-danger">{error}</span>}
      </div>

      <div ref={memoRef} className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
        {memo ? <Memo memo={memo} subject={view.subject} tracker={view.subjects[0] ?? view.subject} /> : <p className="text-[13px] text-ink-3">This frame has nothing to say yet.</p>}
      </div>
    </div>
  );
}
