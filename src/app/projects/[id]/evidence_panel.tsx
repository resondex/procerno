"use client";

import { useEffect, useState } from "react";
import { InlineSpinner } from "../../components/spinner";
import AnswerText from "./answer_text";

/**
 * The evidence drill (2026-10-30): the answers behind one number in an
 * analysis lens, fetched by id when opened (never eagerly) from
 * /api/runs/[id]/answer_bodies. An overlay rather than an in-flow panel, so
 * opening it never pushes the figures being read off screen. The route
 * serves at most 50 ids; a caller with more passes the first 50 and the
 * full count as `total`.
 */

export interface EvidenceRequest {
  title: string;
  subtitle?: string;
  ids: string[];
  /** How many answers the number counts, when more than `ids` carries. */
  total?: number;
  /** Literal phrases to mark in the answers (case-insensitive). */
  highlight?: string[];
}

interface Body {
  id: string;
  text: string;
  engine: string;
  promptText: string;
}

export const EVIDENCE_CAP = 50;

export default function EvidencePanel({
  runId,
  request,
  onClose,
}: {
  runId: string;
  request: EvidenceRequest;
  onClose: () => void;
}) {
  const ids = request.ids.slice(0, EVIDENCE_CAP);
  const key = ids.join(",");
  // One state slot per request, so a new cell never shows the last cell's
  // answers while its own load.
  const [state, setState] = useState<{ key: string; answers?: Body[]; error?: string }>({ key });
  const current = state.key === key ? state : { key };

  useEffect(() => {
    let live = true;
    const list = key ? key.split(",") : [];
    if (list.length === 0) return;
    fetch(`/api/runs/${runId}/answer_bodies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: list }),
    })
      .then(async (r) => {
        if (r.status === 403) throw new Error("The evidence drawer is switched off for this tracker.");
        if (!r.ok) throw new Error(`Could not load these answers (${r.status}).`);
        const d = (await r.json()) as { answers: Body[] };
        if (live) setState({ key, answers: d.answers });
      })
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => {
      live = false;
    };
  }, [runId, key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = Math.max(request.total ?? ids.length, ids.length);
  const answers = ids.length === 0 ? [] : current.answers;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="grid w-full max-w-2xl content-start overflow-hidden rounded-xl border border-line bg-[var(--color-surface)] shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{request.title}</h3>
            {request.subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{request.subtitle}</p>}
            {total > ids.length && (
              <p className="mt-0.5 text-[12px] text-ink-3">
                Showing {ids.length} of the {total} answers behind this number.
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none text-ink-3 hover:text-ink">
            ×
          </button>
        </div>
        <div className="grid max-h-[75vh] content-start gap-4 overflow-y-auto p-4">
          {current.error && <p className="text-[13px] text-danger">{current.error}</p>}
          {!current.error && !answers && (
            <p className="text-[13px] text-ink-3">
              <InlineSpinner className="mr-1.5" />
              Loading the answers...
            </p>
          )}
          {answers?.length === 0 && <p className="text-[13px] text-ink-3">No answers to show.</p>}
          {answers?.map((a, i) => (
            <div key={a.id} className={`grid gap-1.5 ${i > 0 ? "border-t border-line/60 pt-4" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                <span className="rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-primary">{a.engine}</span>
                <span>
                  answer {i + 1} of {answers.length}
                </span>
              </div>
              {a.promptText && <p className="text-[12px] font-medium text-ink-2">&ldquo;{a.promptText}&rdquo;</p>}
              <div className="max-h-72 overflow-y-auto border-l-2 border-line pl-3">
                <AnswerText text={a.text} highlight={request.highlight ?? []} />
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
