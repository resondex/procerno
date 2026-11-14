"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Dossier } from "@/lib/engine/dossiers";
import type { CurrentMatchup, MatchupEntry } from "@/lib/engine/matchups";
import { T } from "./type_scale";

/**
 * "Ask this matchup" (2026-11-13, the ratified prototype's gapBox /
 * addH2hHtml / queued state): a rival that takes picks but was never put
 * beside the brand head to head can be queued for the next collection -
 * swapped in for a matchup the tracker already asks (included), or added
 * on top (a per-wave fee). The queue is fetched here, separately from the
 * cached views, and never baked into one. Share links (no projectId) and
 * read-only members see the flag but no buttons.
 */

interface State {
  queue: MatchupEntry[];
  current: CurrentMatchup[];
  slots: number;
  feePerWave: number;
  canWrite: boolean;
}

interface Ctx {
  state: State | null;
  queuedFor: (rivalKey: string) => MatchupEntry | undefined;
  choose: (rival: { key: string; name: string }) => void;
  undo: (entry: MatchupEntry) => Promise<void>;
}

const MatchupCtx = createContext<Ctx | null>(null);

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const pctNum = (s?: string | null) => (s ? parseFloat(s.replace(/[^0-9.]/g, "")) || 0 : 0);

export function MatchupProvider({ projectId, dossiers, children }: { projectId?: string; dossiers: Dossier[]; children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [chooser, setChooser] = useState<{ key: string; name: string } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetch(`/api/projects/${projectId}/matchups`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: State | null) => live && d && setState(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [projectId]);
  const queuedFor = useCallback((key: string) => state?.queue.find((e) => e.status === "queued" && e.rival.id === key), [state]);
  const undo = useCallback(
    async (entry: MatchupEntry) => {
      if (!projectId) return;
      const r = await fetch(`/api/projects/${projectId}/matchups`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry: entry.id }),
      });
      const d = (await r.json().catch(() => null)) as (State & { error?: string }) | null;
      if (!r.ok || !d) throw new Error(d?.error ?? `Could not undo (${r.status}).`);
      setState(d);
    },
    [projectId]
  );
  const value = useMemo<Ctx>(() => ({ state, queuedFor, choose: setChooser, undo }), [state, queuedFor, undo]);
  return (
    <MatchupCtx.Provider value={value}>
      {children}
      {chooser && state && projectId && (
        <Chooser
          projectId={projectId}
          rival={chooser}
          state={state}
          dossiers={dossiers}
          onClose={() => setChooser(null)}
          onQueued={(s) => {
            setState(s);
            setChooser(null);
          }}
        />
      )}
    </MatchupCtx.Provider>
  );
}

export function useMatchups(): Ctx | null {
  return useContext(MatchupCtx);
}

/** The queued line, with the questions behind a fold and Undo when allowed. */
function QueuedLine({ entry, ctx }: { entry: MatchupEntry; ctx: Ctx }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const how = entry.drop ? `, in place of ${entry.drop.name}` : entry.fee_usd > 0 ? `, as an added matchup (${usd(entry.fee_usd)} per wave)` : ", as an added matchup";
  return (
    <div className="mt-3.5 border-l-[3px] py-0.5 pl-2.5" style={{ borderColor: "var(--pa-yours)" }}>
      <p className={`${T.body} text-ink`}>
        Queued for the next collection: the AI will be asked to pick between you and {entry.rival.name}
        {how}.{" "}
        {ctx.state?.canWrite && (
          <button
            type="button"
            disabled={busy}
            className="text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-60"
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await ctx.undo(entry);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Undoing..." : "Undo"}
          </button>
        )}
      </p>
      {err && <p className={`${T.cap} mt-1 text-danger`}>{err}</p>}
      <button type="button" className={`${T.sec} mt-1.5 text-primary underline underline-offset-2 hover:opacity-80`} onClick={() => setOpen(!open)}>
        {open ? "Hide the questions" : "See the questions"}
      </button>
      {open && (
        <ol className={`${T.sec} mt-1.5 list-decimal space-y-1 pl-5 text-ink-2`}>
          {entry.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The rival panel's gap box (prototype gapBox): only for a rival the dossier
 * flags - it takes picks and was never asked head to head.
 */
export function MatchupGap({ d }: { d: Dossier }) {
  const ctx = useMatchups();
  if (d.h2h.kind !== "missing" || !d.h2h.alert) return null;
  const q = ctx?.queuedFor(d.key);
  if (q && ctx) return <QueuedLine entry={q} ctx={ctx} />;
  const share = d.tiles[1]?.value;
  return (
    <div className="mt-4 rounded-xl bg-primary-soft px-4 py-3.5">
      <div className={`${T.labelAccent} mb-1`}>What to do - Close the gap</div>
      <p className={`${T.lede} mb-2.5`}>
        {d.name} takes {share ?? "a share"} of the picks, but the AI has never been asked to choose between you and {d.name} directly. You cannot see how
        you would do against it.
      </p>
      {ctx?.state?.canWrite && <AskButton onClick={() => ctx.choose({ key: d.key, name: d.name })} />}
    </div>
  );
}

/** The Overview finding card's move for an unasked rival. */
export function MatchupMove({ rival }: { rival: { key: string; name: string } }) {
  const ctx = useMatchups();
  const q = ctx?.queuedFor(rival.key);
  return (
    <div className="mb-5 rounded-xl bg-primary-soft px-4 py-3">
      <span className={`${T.labelAccent} mb-1 block`}>What to do - Close the gap</span>
      {q && ctx ? (
        <QueuedLine entry={q} ctx={ctx} />
      ) : (
        <div className="grid items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <p className={`${T.body} text-ink`}>Ask the AI to pick between you and {rival.name} at the next collection, so you can see how you would do against it.</p>
          {ctx?.state?.canWrite && <AskButton onClick={() => ctx.choose(rival)} />}
        </div>
      )}
    </div>
  );
}

/** The Map's rival card line: queued, or the plain flag. */
export function useMatchupQueued(rivalKey: string): boolean {
  const ctx = useMatchups();
  return !!ctx?.queuedFor(rivalKey);
}

/** Both store drivers emit UTC; sqlite omits the T and Z. */
function utcMs(ts: string): number {
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z").getTime();
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The swapped-out rival's note (2026-11-13). While a swap is queued, the
 * rival it drops says its head-to-head questions stop after this wave; once
 * the swap has gone live, it says from which wave they stopped - unless the
 * rival has since come back (a live matchup again, or queued again). Matched
 * by dictionary key, or by name / angle where a surface has only the name
 * (the Map's head-to-head contest).
 */
export function useMatchupDropNote(rival: { key?: string | null; name?: string | null }): string | null {
  const ctx = useMatchups();
  const state = ctx?.state;
  if (!state) return null;
  const matches = (drop: NonNullable<MatchupEntry["drop"]>) =>
    (!!rival.key && drop.id === rival.key) ||
    (!!rival.name && (norm(drop.name) === norm(rival.name) || drop.angles.some((a) => norm(a) === norm(rival.name!))));
  const queued = state.queue.find((e) => e.status === "queued" && e.drop && matches(e.drop));
  if (queued) return `Its head-to-head questions stop after this wave - swapped for ${queued.rival.name}.`;
  const dropKey = (e: MatchupEntry) => e.drop!.id;
  const past = state.queue
    .filter((e) => e.status === "live" && e.mode === "swap" && e.drop && e.wentLiveAt && matches(e.drop))
    .sort((a, b) => utcMs(b.wentLiveAt!) - utcMs(a.wentLiveAt!))[0];
  if (!past) return null;
  // Back on the instrument since: no note.
  const back =
    state.current.some((m) => m.key === dropKey(past) || norm(m.name) === norm(past.drop!.name)) ||
    state.queue.some((e) => e.status === "queued" && e.rival.id === dropKey(past));
  if (back) return null;
  const when = new Date(utcMs(past.wentLiveAt!)).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return `Head-to-head questions stopped from the wave of ${when} - swapped for ${past.rival.name}.`;
}

/** The note as a quiet line; renders nothing when there is none. */
export function MatchupDropNote({ rivalKey, name, className = "" }: { rivalKey?: string | null; name?: string | null; className?: string }) {
  const note = useMatchupDropNote({ key: rivalKey, name });
  if (!note) return null;
  return (
    <div className={`${T.cap} border-l-[3px] border-line pl-2 text-ink-3 ${className}`}>
      {note}
    </div>
  );
}

function AskButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="justify-self-start whitespace-nowrap rounded-lg bg-primary px-3 py-1 text-[13px] font-medium text-primary-ink hover:opacity-90">
      Ask this matchup
    </button>
  );
}

/** The chooser (prototype addH2hHtml): swap one you have, or add one for the per-wave fee. */
function Chooser({
  projectId,
  rival,
  state,
  dossiers,
  onClose,
  onQueued,
}: {
  projectId: string;
  rival: { key: string; name: string };
  state: State;
  dossiers: Dossier[];
  onClose: () => void;
  onQueued: (s: State) => void;
}) {
  // The matchups that will still be asked: live ones not already being swapped out, plus queued adds.
  const dropping = new Set(state.queue.filter((e) => e.status === "queued" && e.drop).map((e) => e.drop!.id));
  const queuedAdds = state.queue.filter((e) => e.status === "queued" && e.mode === "add").length;
  const swappable = state.current.filter((m) => !dropping.has(m.key));
  const inUse = swappable.length + queuedAdds;
  const free = inUse < state.slots;
  const stats = (m: CurrentMatchup) => {
    const d = dossiers.find((x) => x.key === m.key);
    return { you: d && d.h2h.kind === "record" ? d.h2h.you : null, share: d?.tiles[1]?.value ?? null };
  };
  const suggested = [...swappable].sort((a, b) => pctNum(stats(b).you) - pctNum(stats(a).you))[0];
  const [drop, setDrop] = useState<string | null>(suggested?.key ?? null);
  const [busy, setBusy] = useState<null | "swap" | "add">(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmFee, setConfirmFee] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const dropName = swappable.find((m) => m.key === drop)?.name;

  const submit = async (mode: "add" | "swap") => {
    setBusy(mode);
    setErr(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/matchups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rival: rival.key, mode, drop: mode === "swap" ? drop : null, fee: mode === "add" && !free ? state.feePerWave : null }),
      });
      const d = (await r.json().catch(() => null)) as (State & { error?: string }) | null;
      if (!r.ok || !d) throw new Error(d?.error ?? `Could not queue the matchup (${r.status}).`);
      onQueued(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const opt = "mt-4 rounded-xl border border-line p-4";
  const tag = (paid: boolean) => `ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${paid ? "bg-[var(--pa-contested-bg)] text-ink" : "bg-primary-soft text-primary"}`;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-label={`Ask the AI to pick between you and ${rival.name}`}>
      <aside onClick={(e) => e.stopPropagation()} className="w-full max-w-xl rounded-xl border border-line bg-[var(--color-surface)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className={T.label}>Rival - {rival.name} - add a matchup</div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" className="text-lg leading-none text-ink-3 hover:text-ink disabled:opacity-50">
            ×
          </button>
        </div>
        <h2 className={`${T.h2} mt-2`}>Ask the AI to pick between you and {rival.name}.</h2>
        <p className={`${T.body} mt-2 text-ink-2`}>
          {free
            ? `Your plan includes ${state.slots} direct matchups and ${inUse} ${inUse === 1 ? "is" : "are"} in use, so this one is included.`
            : `Your plan includes ${state.slots} direct matchups and all ${state.slots} are in use.`}{" "}
          The new questions are written now and asked at the next collection; nothing on this wave changes.
        </p>

        {free ? (
          <div className={opt}>
            <h3 className={T.title}>
              Add it as a matchup<span className={tag(false)}>Included in your plan</span>
            </h3>
            <button type="button" disabled={!!busy} onClick={() => void submit("add")} className="btn-primary mt-3 px-4 py-1.5 text-sm disabled:opacity-60">
              {busy === "add" ? "Writing the questions..." : `Ask about ${rival.name}`}
            </button>
          </div>
        ) : (
          <>
            {swappable.length > 0 && (
              <div className={opt}>
                <h3 className={T.title}>
                  Swap it for one you have<span className={tag(false)}>Included in your plan</span>
                </h3>
                <p className={`${T.sec} mt-1`}>Pick the matchup to stop asking. Its history stays on the dashboard; it just gets no new answers.</p>
                <div className="mt-2 grid gap-1.5">
                  {swappable.map((m) => {
                    const s = stats(m);
                    const sel = m.key === drop;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        disabled={!!busy}
                        onClick={() => setDrop(m.key)}
                        className={`flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg border px-3 py-2 text-left text-[14px] ${sel ? "border-[var(--color-primary)] bg-primary-soft" : "border-line hover:border-[var(--color-primary)]"}`}
                      >
                        <span className="text-ink">
                          <i className={`mr-2 inline-block h-2.5 w-2.5 rounded-full border ${sel ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-line"}`} aria-hidden />
                          {m.name}
                          {suggested && m.key === suggested.key ? " - suggested" : ""}
                        </span>
                        <span className={T.sec}>
                          {s.you ? `you win ${s.you}` : "no clear record"}
                          {s.share ? ` - it takes ${s.share} of picks` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button type="button" disabled={!!busy || !drop} onClick={() => void submit("swap")} className="btn-primary mt-3 px-4 py-1.5 text-sm disabled:opacity-60">
                  {busy === "swap" ? "Writing the questions..." : `Swap in ${rival.name} for ${dropName ?? "..."}`}
                </button>
              </div>
            )}
            <div className={opt}>
              <h3 className={T.title}>
                Add it as an extra matchup<span className={tag(true)}>{usd(state.feePerWave)} per wave</span>
              </h3>
              <p className={`${T.sec} mt-1`}>
                Keep all {swappable.length} and add {rival.name}. {usd(state.feePerWave)} is added for every collection that asks it.
              </p>
              <label className={`${T.sec} mt-2 flex items-start gap-2 text-ink-2`}>
                <input type="checkbox" className="mt-0.5" checked={confirmFee} disabled={!!busy} onChange={(e) => setConfirmFee(e.target.checked)} />
                <span>I agree to {usd(state.feePerWave)} per wave for this added matchup.</span>
              </label>
              <button
                type="button"
                disabled={!!busy || !confirmFee}
                onClick={() => void submit("add")}
                className="mt-3 rounded-lg border border-line bg-surface px-4 py-1.5 text-sm font-medium text-ink hover:border-[var(--color-primary)] disabled:opacity-60"
              >
                {busy === "add" ? "Writing the questions..." : `Add ${rival.name} for ${usd(state.feePerWave)} per wave`}
              </button>
            </div>
          </>
        )}
        {busy && <p className={`${T.sec} mt-3`}>Writing and checking the ten questions takes a few minutes. Keep this open.</p>}
        {err && <p className={`${T.body} mt-3 text-danger`}>{err}</p>}
      </aside>
    </div>
  );
}
