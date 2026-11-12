"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BodiesProvider, ExamplesHost, useShowExamples, catPhrase } from "./analysis_panel";
import { T } from "./type_scale";

/**
 * The first-wave wording review (2026-11-11, Tyler): when a tracker's first
 * measured wave has wordings the question check flagged, this warning shows
 * BEFORE any analysis - the dashboard holds the results back until every
 * flag is resolved or the user picks "Decide later" (then a small banner
 * reopens it). Per flag: the wording as asked, why it is flagged, examples
 * behind it, and one suggested wording (editable) - "Use this wording" or
 * "Keep my wording". Only members who can act on it ever see it (the GET
 * refuses share links and read-only members).
 */

interface ReviewFlag {
  id: string;
  promptId: string;
  text: string;
  rate: number | null;
  siblingsRate: number | null;
  answers: number | null;
  siblingCount: number;
  examples: { off: string[]; siblingsOn: string[] };
  suggestion: string | null;
  ready: boolean;
}
interface Review {
  runId: string;
  category: string;
  brand: string;
  flags: ReviewFlag[];
}

const laterKey = (id: string) => `wording_review_later_${id}`;
const LATER_EVENT = "wording-review-later";

function readLater(id: string): boolean {
  try {
    return window.localStorage.getItem(laterKey(id)) === "1";
  } catch {
    return false;
  }
}
function writeLater(id: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(laterKey(id), "1");
    else window.localStorage.removeItem(laterKey(id));
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  window.dispatchEvent(new Event(LATER_EVENT));
}

/** Whether the user deferred the review on this tracker (per browser). */
export function useReviewDeferred(id: string): [boolean, (on: boolean) => void] {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("storage", cb);
    window.addEventListener(LATER_EVENT, cb);
    return () => {
      window.removeEventListener("storage", cb);
      window.removeEventListener(LATER_EVENT, cb);
    };
  }, []);
  const later = useSyncExternalStore(
    subscribe,
    () => readLater(id),
    () => false
  );
  return [later, (on: boolean) => writeLater(id, on)];
}

const pct = (x: number | null) => (x == null ? "" : `${Math.round(x * 100)}%`);

/** The small banner shown over the results while the review is deferred. */
export function WordingReviewBanner({ open, onReopen }: { open: number; onReopen: () => void }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 border-warning/40 px-4 py-3">
      <p className={T.sec}>
        {open === 1
          ? "One question's wording drew answers off the topic. The numbers below include it until you decide."
          : "Some questions' wordings drew answers off the topic. The numbers below include them until you decide."}
      </p>
      <button type="button" onClick={onReopen} className={`${T.ctl} text-primary hover:opacity-80`}>
        Review the wordings
      </button>
    </div>
  );
}

export default function WordingReview({
  projectId,
  runId,
  onLater,
  onResolved,
}: {
  projectId: string;
  /** The run the dashboard shows - the examples' answers live on it. */
  runId: string;
  onLater: () => void;
  /** Every flag resolved (or none left): the analysis may land. */
  onResolved: () => void;
}) {
  const [review, setReview] = useState<Review | null | "loading" | "error">("loading");
  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${projectId}/prompt_flags`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { review: Review | null }) => {
        if (!live) return;
        if (!d.review || d.review.flags.length === 0) onResolved();
        else setReview(d.review);
      })
      .catch(() => live && setReview("error"));
    return () => {
      live = false;
    };
  }, [projectId, onResolved]);

  const remove = (flagId: string) => {
    if (typeof review !== "object" || !review) return;
    const left = review.flags.filter((f) => f.id !== flagId);
    if (left.length === 0) onResolved();
    else setReview({ ...review, flags: left });
  };

  return (
    <BodiesProvider runId={runId}>
      <ExamplesHost>
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Before your results"
        >
          <div className="grid w-full max-w-2xl content-start gap-4 rounded-xl border border-line bg-[var(--color-surface)] p-5 shadow-xl">
            <div>
              <div className={T.label}>Before your results</div>
              <h2 className={`${T.h2} mt-1`}>
                {typeof review === "object" && review && review.flags.length === 1
                  ? "One question was asked in a way that drew answers off the topic"
                  : "Some questions were asked in a way that drew answers off the topic"}
              </h2>
              <p className={`${T.sec} mt-1`}>
                Each question is asked in several wordings. The wordings below drew answers that were mostly about something
                else, so they would pull your numbers off. Swap in a new wording, or keep the one you have.
              </p>
            </div>
            {review === "loading" && <p className={T.sec}>Loading...</p>}
            {review === "error" && <p className={T.sec}>The flagged wordings could not be loaded. Try again in a moment, or decide later.</p>}
            {typeof review === "object" &&
              review &&
              review.flags.map((f, i) => (
                <FlagCard
                  key={f.id}
                  projectId={projectId}
                  flag={f}
                  index={i}
                  total={review.flags.length}
                  category={review.category}
                  onDone={() => remove(f.id)}
                />
              ))}
            <div className="flex justify-end border-t border-line pt-3">
              <button type="button" onClick={onLater} className={`${T.ctl} text-ink-3 hover:text-ink`}>
                Decide later
              </button>
            </div>
          </div>
        </div>
      </ExamplesHost>
    </BodiesProvider>
  );
}

function FlagCard({
  projectId,
  flag,
  index,
  total,
  category,
  onDone,
}: {
  projectId: string;
  flag: ReviewFlag;
  index: number;
  total: number;
  category: string;
  onDone: () => void;
}) {
  const show = useShowExamples();
  const [text, setText] = useState(flag.suggestion ?? "");
  const [busy, setBusy] = useState<null | "replace" | "keep">(null);
  const [error, setError] = useState<string | null>(null);
  const cat = catPhrase(category).plural;
  const unchanged = flag.suggestion != null && text.trim() === flag.suggestion.trim();
  const instant = flag.ready && unchanged;

  const act = async (action: "replace" | "keep") => {
    setBusy(action);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/prompt_flags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagId: flag.id, action, ...(action === "replace" ? { text: text.trim() } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Something went wrong - try again.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong - try again.");
    } finally {
      setBusy(null);
    }
  };

  const countTip =
    flag.answers != null
      ? `${flag.answers} answers to this wording; ${flag.siblingCount} other wording${flag.siblingCount === 1 ? "" : "s"} of the same question`
      : undefined;

  return (
    <div className="grid gap-3 rounded-lg border border-line p-4">
      {total > 1 && <div className={T.label}>Wording {index + 1}</div>}
      <div>
        <div className={T.cap + " text-ink-3"}>As asked</div>
        <p className={`${T.body} mt-0.5 text-ink`}>&ldquo;{flag.text}&rdquo;</p>
      </div>
      <p className={`${T.body} text-ink-2`} title={countTip}>
        Only {pct(flag.rate)} of the answers to this wording were about {cat}, against {pct(flag.siblingsRate)} for the other
        wordings of the same question. The AI read it as a question about something else.
      </p>
      {show && (flag.examples.off.length > 0 || flag.examples.siblingsOn.length > 0) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {flag.examples.off.length > 0 && (
            <button
              type="button"
              className={`${T.ctl} text-primary underline underline-offset-2 hover:opacity-80`}
              onClick={() =>
                show({
                  title: "Answers to this wording",
                  note: `Answers that were not about ${cat}.`,
                  refs: flag.examples.off.map((responseId) => ({ responseId, find: "" })),
                })
              }
            >
              See examples
            </button>
          )}
          {flag.examples.siblingsOn.length > 0 && (
            <button
              type="button"
              className={`${T.ctl} text-primary underline underline-offset-2 hover:opacity-80`}
              onClick={() =>
                show({
                  title: "Answers to the other wordings",
                  note: "For contrast: the same question, worded differently.",
                  refs: flag.examples.siblingsOn.map((responseId) => ({ responseId, find: "" })),
                })
              }
            >
              Compare the other wordings
            </button>
          )}
        </p>
      )}
      <label className="grid gap-1">
        <span className={T.cap + " text-ink-3"}>{flag.suggestion ? "Suggested wording" : "Your wording"}</span>
        <textarea
          className="input min-h-[4.5rem] text-sm"
          value={text}
          placeholder="Write a new wording for this question"
          onChange={(e) => setText(e.target.value)}
        />
        {!flag.suggestion && (
          <span className={T.cap + " text-ink-3"}>
            We could not write a new wording that passes our checks. Write your own, or keep the one you have.
          </span>
        )}
        {text.trim().length >= 4 && (
          <span className={T.cap + " text-ink-3"}>
            {instant
              ? "Its answers are already in - the switch is instant."
              : "Switching asks the assistants the new wording and reads their answers first - it takes about a minute."}
          </span>
        )}
      </label>
      {error && <p className={`${T.cap} text-warning`}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || text.trim().length < 4}
          onClick={() => act("replace")}
          className="btn-primary px-3 py-1.5 text-[13px] disabled:opacity-50"
        >
          {busy === "replace" ? (instant ? "Switching..." : "Asking the assistants...") : "Use this wording"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => act("keep")}
          className={`${T.ctl} rounded-md border border-line px-3 py-1.5 text-ink-2 hover:text-ink disabled:opacity-50`}
        >
          {busy === "keep" ? "Keeping..." : "Keep my wording"}
        </button>
      </div>
    </div>
  );
}
