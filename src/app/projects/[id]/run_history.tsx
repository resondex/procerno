"use client";

import { useEffect, useState } from "react";
import type { RunSchedule } from "@/lib/types";
import type { QueuedMatchupLine, WaveRow } from "@/app/api/projects/[id]/run_history/route";
import { T } from "./type_scale";

/**
 * The Run history dialog's body (2026-11-12, rebuilt): one card per wave,
 * newest first, in customer words - when it ran, what it asked and on which
 * assistants, whether it is measured and on the dashboard, whether the
 * monthly buyer-worry questions rode it, wording changes made after it, and
 * what went wrong. Reads /api/projects/[id]/run_history (read-only); nothing
 * here touches the empty legacy coder tables.
 */

const STATE: Record<WaveRow["state"], { label: string; tone: "live" | "ok" | "wait" | "bad" }> = {
  starting: { label: "Starting", tone: "live" },
  collecting: { label: "Collecting answers", tone: "live" },
  review: { label: "Waiting for your review", tone: "wait" },
  measuring: { label: "Being measured", tone: "live" },
  measured: { label: "Measured", tone: "ok" },
  stopped: { label: "Stopped", tone: "bad" },
};

const TONE: Record<"live" | "ok" | "wait" | "bad", string> = {
  live: "bg-primary-soft text-primary",
  ok: "bg-success/12 text-success",
  wait: "bg-warning/12 text-warning",
  bad: "bg-danger/12 text-danger",
};

/** Both store drivers emit UTC; sqlite omits the T and Z. */
function utcMs(ts: string): number {
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z").getTime();
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "a", "a and b", "a, b and c". */
function names(list: string[]): string {
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** The line above the wave list while "Ask this matchup" changes wait for
 * the next wave. */
function queuedMatchupLine(q: QueuedMatchupLine[]): string | null {
  if (q.length === 0) return null;
  const replaced = q.flatMap((x) => (x.replaces ? [x.replaces] : []));
  return `From the next wave: head to head against ${names(q.map((x) => x.name))}${replaced.length ? `, in place of ${names(replaced)}` : ""}.`;
}

/** The cron (api/cron) launches a scheduled wave at its daily 06:00 UTC check
 * once the interval has passed since the latest wave, and never while a wave
 * is still open. */
function nextWaveLine(input: {
  schedule: RunSchedule;
  latest: WaveRow | null;
  openWave: boolean;
  canSchedule: boolean;
}): string {
  const { schedule, latest, openWave, canSchedule } = input;
  if (schedule === "none") {
    return canSchedule
      ? "No more waves are scheduled. Start one, or set a weekly or monthly schedule, from Schedule above."
      : "No more waves are scheduled. Scheduling opens once this wave is finalized.";
  }
  if (openWave) return `Your ${schedule} waves are on. The next one starts after this wave is finalized.`;
  if (!latest) return `Your ${schedule} waves are on.`;
  const days = schedule === "weekly" ? 6.5 : 27;
  const due = utcMs(latest.created_at) + days * 24 * 3600 * 1000;
  const next = new Date(due);
  next.setUTCHours(6, 0, 0, 0);
  if (next.getTime() < due) next.setUTCDate(next.getUTCDate() + 1);
  const when = next.getTime() <= Date.now() ? "at the next daily check" : `around ${day(next.getTime())}`;
  return `Your ${schedule} waves are on. The next one starts ${when}.`;
}

export default function RunHistory({
  projectId,
  schedule,
  shownRunId,
  progress,
  canSchedule,
  canDelete,
  onView,
  onChanged,
}: {
  projectId: string;
  schedule: RunSchedule;
  /** The wave the dashboard is showing now (complete, or the measured-but-held one). */
  shownRunId: string | null;
  /** Live counter for a wave still collecting. */
  progress: { completed: number; total: number } | null;
  /** Whether the Schedule dialog can be opened in this state. */
  canSchedule: boolean;
  /** Members who can edit (never a share-link viewer). Deleting also needs
   * a Procerno admin - the route says who (2026-11-12). */
  canDelete: boolean;
  /** Show this (complete) wave's results on the dashboard. */
  onView: (runId: string) => void;
  /** A wave was deleted - refresh the page's data. */
  onChanged: () => void;
}) {
  const [waves, setWaves] = useState<WaveRow[] | null>(null);
  const [queuedNext, setQueuedNext] = useState<QueuedMatchupLine[]>([]);
  const [staff, setStaff] = useState(false);
  const [adminDelete, setAdminDelete] = useState(false);
  const [deleting, setDeleting] = useState<WaveRow | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/run_history`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { waves: WaveRow[]; staff: boolean; canDelete?: boolean; queuedNext?: QueuedMatchupLine[] }) => {
        if (cancelled) return;
        setWaves(d.waves);
        setQueuedNext(d.queuedNext ?? []);
        setStaff(d.staff);
        setAdminDelete(!!d.canDelete);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reload]);

  if (failed) return <p className={T.sec}>The waves could not be loaded. Close this and try again.</p>;
  if (!waves) return <p className={T.sec}>Loading your waves...</p>;
  if (waves.length === 0) {
    return <p className={T.sec}>No waves yet. The first one starts when setup is finished.</p>;
  }

  if (deleting) {
    const ok = deleteText.trim().toLowerCase() === "delete";
    const close = () => {
      setDeleting(null);
      setDeleteText("");
      setDeleteError(false);
    };
    return (
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok || deleteBusy) return;
          setDeleteBusy(true);
          setDeleteError(false);
          const res = await fetch(`/api/runs/${deleting.id}`, { method: "DELETE" });
          setDeleteBusy(false);
          if (res.ok) {
            close();
            setReload((n) => n + 1);
            onChanged();
          } else setDeleteError(true);
        }}
      >
        <p className={T.sec}>
          Wave {deleting.number} and every answer it collected will be deleted. This cannot be undone. Your questions,
          brand dictionary and other waves stay.
        </p>
        <label className={`${T.sec} grid gap-1.5 font-medium text-ink`}>
          Type &quot;delete&quot; to confirm
          <input
            autoFocus
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            className="input max-w-56"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {deleteError && <p className={`${T.cap} text-danger`}>This wave could not be deleted.</p>}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={!ok || deleteBusy} className="btn-primary px-4 py-1.5 text-sm">
            {deleteBusy ? "Deleting..." : "Delete wave"}
          </button>
          <button type="button" onClick={close} className="text-sm text-ink-3 hover:text-ink">
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const openWave = waves.some((w) => w.status === "pending" || w.status === "running" || w.status === "collected");
  const measuredComplete = waves.filter((w) => w.status === "complete").length;
  const nextMatchups = queuedMatchupLine(queuedNext);

  return (
    <div className="grid gap-4">
      <p className={T.sec}>
        Each wave asks your questions to the AI assistants again and measures the answers.
        {waves.length === 1 ? " This tracker has one wave so far." : ""}
      </p>
      {nextMatchups && <p className={`${T.sec} text-ink`}>{nextMatchups}</p>}
      <ul className="grid gap-3">
        {waves.map((w) => (
          <WaveCard
            key={w.id}
            w={w}
            staff={staff}
            shown={w.id === shownRunId}
            progress={w.state === "collecting" || w.state === "starting" ? progress : null}
            canView={w.status === "complete" && measuredComplete > 1 && w.id !== shownRunId}
            canDelete={canDelete && adminDelete && (w.status === "complete" || w.status === "failed")}
            onView={() => onView(w.id)}
            onDelete={() => setDeleting(w)}
          />
        ))}
      </ul>
      <p className={`${T.sec} border-t border-line pt-3`}>
        {nextWaveLine({ schedule, latest: waves[0] ?? null, openWave, canSchedule })}
      </p>
    </div>
  );
}

function WaveCard({
  w,
  staff,
  shown,
  progress,
  canView,
  canDelete,
  onView,
  onDelete,
}: {
  w: WaveRow;
  staff: boolean;
  shown: boolean;
  progress: { completed: number; total: number } | null;
  canView: boolean;
  canDelete: boolean;
  onView: () => void;
  onDelete: () => void;
}) {
  const [showAssistants, setShowAssistants] = useState(false);
  const state = STATE[w.state];
  const started = utcMs(w.created_at);
  const finished = w.completed_at ? utcMs(w.completed_at) : null;
  const when =
    finished && day(finished) !== day(started) ? `${day(started)} - ${day(finished)}` : day(started);
  const measured = w.state === "measured";
  const asked =
    `${plural(w.questions, "question")}` +
    (w.repeats > 1 ? `, each asked ${w.repeats} times,` : "") +
    ` on ${plural(w.assistantCount, "AI assistant")}`;
  const notes: string[] = [];
  if (w.worries === true) notes.push("Included the monthly buyer-worry questions.");
  if (w.worries === false) notes.push("Buyer-worry questions were not part of this wave - they are asked once a month.");
  for (const n of w.matchups?.added ?? []) notes.push(`Started asking you head to head against ${n}.`);
  for (const n of w.matchups?.dropped ?? []) notes.push(`Stopped asking you head to head against ${n}.`);
  if (w.flags.replaced > 0) notes.push(`${plural(w.flags.replaced, "wording")} replaced after this wave.`);
  if (w.flags.kept > 0) notes.push(`${plural(w.flags.kept, "flagged wording")} kept as asked.`);
  if (w.flags.open > 0) notes.push(`${plural(w.flags.open, "wording")} waiting for your review.`);
  const problems: string[] = [];
  if (w.failed) problems.push("This wave stopped before it finished collecting answers.");
  for (const s of w.shortfalls) {
    problems.push(
      s.answered === 0
        ? `${s.name} did not answer.`
        : `${s.name} answered ${s.answered.toLocaleString()} of the ${w.questions.toLocaleString()} questions.`
    );
  }

  return (
    <li className={`card px-5 py-4 ${shown ? "border-primary/50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className={T.title}>Wave {w.number}</div>
          <div className={T.sec}>{when}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {shown && (
            <span className={`${T.cap} rounded-full border border-primary/40 px-2.5 py-1 font-semibold text-primary`}>
              On your dashboard
            </span>
          )}
          <span className={`${T.cap} inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${TONE[state.tone]}`}>
            {state.tone === "live" && <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-primary" />}
            {state.label}
          </span>
        </div>
      </div>

      <p className={`${T.body} mt-3 text-ink`}>
        Asked {asked}.{" "}
        <button
          type="button"
          onClick={() => setShowAssistants((v) => !v)}
          className={`${T.ctl} text-primary hover:opacity-80`}
          aria-expanded={showAssistants}
        >
          {showAssistants ? "Hide assistants" : "See assistants"}
        </button>
      </p>
      {showAssistants && (
        <ul className={`${T.cap} mt-2 grid gap-1 text-ink-2`}>
          {w.assistants.map((g) => (
            <li key={g.company}>
              <span className="font-semibold text-ink">{g.company}:</span> {g.names.join(", ")}
            </li>
          ))}
        </ul>
      )}

      {progress && progress.total > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 w-44 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700"
              style={{ width: `${Math.min(100, (progress.completed / progress.total) * 100)}%` }}
            />
          </div>
          <span className={`${T.cap} tabular-nums text-ink-3`}>
            {Math.round((progress.completed / progress.total) * 100)}% collected
          </span>
        </div>
      )}

      {measured && (
        <p className={`${T.sec} mt-2`}>
          {shown
            ? "These are the results on your dashboard now."
            : canView
              ? "Measured - open it to see its results."
              : "Measured."}
        </p>
      )}
      {w.state === "review" && (
        <p className={`${T.sec} mt-2`}>Answers are in. Confirm the codebook and brand list on the dashboard to measure them.</p>
      )}
      {w.state === "measuring" && <p className={`${T.sec} mt-2`}>Answers are in and being measured.</p>}

      {notes.length > 0 && (
        <ul className={`${T.cap} mt-2 grid gap-0.5 text-ink-3`}>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <ul className={`${T.cap} mt-2 grid gap-0.5 text-danger`}>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {(canView || measured || canDelete) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3">
          {canView && (
            <button type="button" onClick={onView} className={`${T.ctl} text-primary hover:opacity-80`}>
              Show this wave on the dashboard
            </button>
          )}
          {measured && (
            <a
              href={`/api/runs/${w.id}/export?format=csv&table=responses`}
              className={`${T.ctl} text-primary hover:opacity-80`}
            >
              Download its answers (CSV)
            </a>
          )}
          {canDelete && (
            <button type="button" onClick={onDelete} className={`${T.ctl} ml-auto text-ink-3 hover:text-danger`}>
              Delete this wave
            </button>
          )}
        </div>
      )}

      {staff && (
        <p className={`${T.cap} mt-3 text-ink-3`}>
          Staff: {w.id} - status {w.status} - {w.pipeline} pipeline - {w.answers.toLocaleString()} answers
          {w.error ? ` - error: ${w.error}` : ""}
        </p>
      )}
    </li>
  );
}
