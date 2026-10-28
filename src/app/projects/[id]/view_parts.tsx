"use client";

import { useEffect, useState } from "react";
import type { RateCell } from "@/lib/engine/view_data";
import { InlineSpinner } from "../../components/spinner";
import AnswerText from "./answer_text";
import { Tip, type Col } from "./table";

/** Shared pieces of the per-type views (alternatives, doubt): rate text with
 * its 95% range, rate columns, stacked bars and their legends. */

export const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
export const pct = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = rate(c);
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
export const range = (c: RateCell) =>
  c.n === 0 ? "no answers" : `${c.k} of ${c.n} - 95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%`;

export function RateText({ cell }: { cell: RateCell }) {
  return (
    <Tip tip={range(cell)}>
      <span className="cursor-help">{pct(cell)}</span>
    </Tip>
  );
}

export const rateCol = <T,>(id: string, label: string, tip: string, get: (r: T) => RateCell): Col<T> => ({
  id,
  label,
  tip,
  num: true,
  val: (r) => (get(r).n > 0 ? Math.round(rate(get(r)) * 1000) / 10 : null),
  render: (r) => <RateText cell={get(r)} />,
});

export interface Part<K extends string> {
  key: K;
  label: string;
  color: string;
}

export function StackBar<K extends string>({ parts, cells }: { parts: readonly Part<K>[]; cells: Record<K, RateCell> }) {
  return (
    <div className="flex h-3 w-full min-w-[8rem] overflow-hidden rounded-[3px]">
      {parts.map((p) => (
        <div
          key={p.key}
          className={p.color}
          style={{ width: `${rate(cells[p.key]) * 100}%` }}
          title={`${p.label}: ${cells[p.key].k} of ${cells[p.key].n}`}
        />
      ))}
    </div>
  );
}

export function Legend<K extends string>({ parts, cells }: { parts: readonly Part<K>[]; cells?: Record<K, RateCell> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {parts.map((p) => (
        <span key={p.key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-[3px] ${p.color}`} />
          {p.label}
          {cells && ` ${pct(cells[p.key])}`}
        </span>
      ))}
    </div>
  );
}

/** One answer behind a view's sample ids, as /api/runs/[id]/answer_texts
 * returns it. */
export interface SampleAnswer {
  id: string;
  engine: string;
  engineLabel: string;
  question: string;
  text: string;
}

/** What opens the answers modal: the sample ids a view payload carries, plus
 * how to title them and what to mark in the prose. */
export interface AnswersTarget {
  title: string;
  subtitle?: string;
  ids: string[];
  /** Literal phrases to mark in the answers (case-insensitive). */
  highlight?: string[];
}

/**
 * The answers behind a view figure, fetched by id when opened (never
 * eagerly). Overlay rather than an in-flow panel, like the evidence drawer:
 * opening it must not push the figures being read off screen.
 */
export function AnswersModal({ runId, target, onClose }: { runId: string; target: AnswersTarget; onClose: () => void }) {
  const [answers, setAnswers] = useState<SampleAnswer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = target.ids.join(",");

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/answer_texts?ids=${encodeURIComponent(key)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Could not load these answers (${r.status})`);
        const d = (await r.json()) as { answers: SampleAnswer[] };
        if (live) setAnswers(d.answers);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId, key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={target.title}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="grid w-full max-w-2xl content-start overflow-hidden rounded-xl border border-line bg-[var(--color-surface)] shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{target.title}</h3>
            {target.subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{target.subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none text-ink-3 hover:text-ink">
            ×
          </button>
        </div>
        <div className="grid max-h-[75vh] content-start gap-4 overflow-y-auto p-4">
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {!error && !answers && (
            <p className="text-[13px] text-ink-3">
              <InlineSpinner className="mr-1.5" />
              Loading the answers...
            </p>
          )}
          {answers?.length === 0 && <p className="text-[13px] text-ink-3">No answers to show.</p>}
          {answers?.map((a, i) => (
            <div key={a.id} className={`grid gap-1.5 ${i > 0 ? "border-t border-line/60 pt-4" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                <span className="rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-primary">{a.engineLabel}</span>
                <span>
                  answer {i + 1} of {answers.length}
                </span>
              </div>
              {a.question && <p className="text-[12px] font-medium text-ink-2">&ldquo;{a.question}&rdquo;</p>}
              <div className="max-h-72 overflow-y-auto border-l-2 border-line pl-3">
                <AnswerText text={a.text} highlight={target.highlight ?? []} />
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
