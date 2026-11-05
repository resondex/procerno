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
.pb-memo{ font-family: Georgia, ui-serif, "Times New Roman", serif; }
.pb-sans{ font-family: var(--font-inter), system-ui, -apple-system, sans-serif; }
.pb-quad{ display:grid; grid-template-columns:1fr; gap:1.25rem 2rem; }
@media (min-width: 640px){ .pb-quad{ grid-template-columns:1fr 1fr; } }
@keyframes pb-pulse{ 0%,100%{ opacity:.55 } 50%{ opacity:1 } }
.pb-skel{ animation: pb-pulse 1.4s ease-in-out infinite; background: var(--color-line, #e5e7eb); border-radius: 4px; }
@media (prefers-reduced-motion: reduce){ .pb-skel{ animation:none; } }
#pb-print-root{ display:none; }
@media print{
  html.pb-printing body > *:not(#pb-print-root){ display:none !important; }
  html.pb-printing, html.pb-printing body{ background:#fff !important; }
  html.pb-printing #pb-print-root{ display:block !important; padding:0.35in 0.4in; }
  html.pb-printing #pb-print-root, html.pb-printing #pb-print-root *{
    color:#111 !important; background:transparent !important; border-color:#bbb !important;
    box-shadow:none !important;
  }
  html.pb-printing #pb-print-root .pb-memo{ max-width:none !important; font-size:11.5pt; }
  html.pb-printing #pb-print-root .pb-noprint{ display:none !important; }
  html.pb-printing #pb-print-root .pb-quad{ grid-template-columns:1fr 1fr; }
  html.pb-printing #pb-print-root .pb-section{ break-inside:avoid; page-break-inside:avoid; }
  html.pb-printing #pb-print-root .pb-hl, html.pb-printing #pb-print-root .pb-hl *{
    background:#eef1f5 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  html.pb-printing #pb-print-root .pb-overflow{ overflow:visible !important; }
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

function Para({ p }: { p: BriefPara }) {
  return (
    <p className="leading-relaxed text-ink">
      <Tip tip={p.tip}>
        {p.lead && <b className="font-semibold">{p.lead} </b>}
        {p.text}
      </Tip>
    </p>
  );
}

function Section({ s }: { s: BriefSectionT }) {
  return (
    <section className="pb-section mt-7">
      {s.heading && <h3 className="mb-2.5 text-[1.18rem] font-semibold leading-snug text-ink">{s.heading}</h3>}

      {s.paras && (
        <div className="grid gap-3">
          {s.paras.map((p, i) => (
            <Para key={i} p={p} />
          ))}
        </div>
      )}

      {s.rows && (
        <dl className="border-t border-line">
          {s.rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-line py-2">
              <dt className="text-ink-2">
                <Tip tip={r.tip}>{r.label}</Tip>
              </dt>
              <dd className="text-right text-[1.15rem] font-semibold tabular-nums text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {s.quads && (
        <div className="grid gap-6">
          {s.quads.map((q, qi) => (
            <div key={qi} className="pb-quad">
              {[0, 1].map((ci) => (
                <div key={ci} className="pb-section border-t-2 border-line pt-2.5">
                  <h4 className="pb-sans mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                    {q.headers[ci]}
                  </h4>
                  <div className="grid gap-2.5">
                    {q.cells[ci].map((p, i) => (
                      <Para key={i} p={p} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {s.table && (
        <div className="pb-overflow overflow-x-auto">
          <table className="w-full border-collapse text-[0.95rem]">
            <thead>
              <tr className="border-b-2 border-line">
                {s.table.headers.map((h, i) => (
                  <th
                    key={i}
                    className={`pb-sans px-2 py-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-2 ${
                      i === 0 ? "text-left" : "text-right"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.table.rows.map((row, ri) => {
                const hl = ri === s.table?.highlightRow;
                return (
                  <tr key={ri} className={`border-b border-line ${hl ? "pb-hl bg-primary-soft font-semibold" : ""}`}>
                    {row.map((c, ci) => (
                      <td
                        key={ci}
                        className={`px-2 py-1.5 text-ink ${ci === 0 ? "text-left" : "text-right tabular-nums"} ${
                          hl && ci === 0 ? "text-primary" : ""
                        }`}
                      >
                        {c}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Memo({ memo }: { memo: BriefMemo }) {
  return (
    <article className="pb-memo max-w-[88ch]">
      <h2 className="text-[1.65rem] font-semibold leading-tight text-ink [text-wrap:balance]">{memo.title}</h2>
      {memo.sections.map((s) => (
        <Section key={s.key} s={s} />
      ))}
      {memo.footer && (
        <p className="pb-sans pb-section mt-8 border-t border-line pt-3 text-[12px] text-ink-3">{memo.footer}</p>
      )}
    </article>
  );
}

function Skeleton() {
  return (
    <div className="max-w-[88ch] grid gap-3" aria-busy="true" aria-label="Loading the brief">
      <div className="pb-skel h-8 w-3/4" />
      <div className="pb-skel mt-3 h-4 w-full" />
      <div className="pb-skel h-4 w-11/12" />
      <div className="pb-skel h-4 w-5/6" />
      <div className="pb-skel mt-5 h-5 w-1/3" />
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
        {memo ? <Memo memo={memo} /> : <p className="text-[13px] text-ink-3">This frame has nothing to say yet.</p>}
      </div>
    </div>
  );
}
