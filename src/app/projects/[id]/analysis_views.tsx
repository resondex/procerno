"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RateCell } from "@/lib/engine/view_data";
import {
  DEFICIT_TRIAGES,
  SURPLUS_TRIAGES,
  TRIAGE_LABEL,
  type AnalysisDecision,
  type AnalysisMapView,
  type CellBadge,
  type CellVerdict,
  type MapCell,
  type Position,
  type PositionStatus,
  type Triage,
} from "@/lib/engine/analysis_types";
import { DotTrack, useEngineSet, viewQuery } from "./view_parts";
import EvidencePanel, { EVIDENCE_CAP, type EvidenceRequest } from "./evidence_panel";

/**
 * The analysis tier (2026-11-03, ANALYSIS_REDESIGN_2026-11-03.md): three
 * layers over ONE payload. The Verdict reads as a memo (casting, known vs
 * picked, who wins instead, the ranked tensions); the Map places every
 * contest, banded by what it varies by (rooms / rivals / worries / settled
 * questions); a cell opens its Position (claim, taker, triage, arguments,
 * conditions, receipts, lever); the Portfolio joins the positions with the
 * decision record. Mounted once by the results shell - the three pills only
 * switch which subview shows, so a pill switch or a cell click never
 * refetches.
 */

export type TierView = "verdict" | "map" | "portfolio";

/** Receipts are verbatim slices of LLM answers, so they arrive with raw
 * markdown in them. Strip the formatting for display only - the verbatim
 * form stays in the payload, since the evidence drill matches it against
 * the answer body for highlighting. */
function plainQuote(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)([^*_]+)\1/g, "$2") // italics
    .replace(/`+([^`]*)`+/g, "$1") // inline code
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "") // heads, blockquotes, bullets
    .replace(/\s*\n\s*/g, " ") // a quote renders as one line
    .trim();
}

// ---------- styling: the four verdict colors (colorblind-validated) ----------

const TIER_CSS = `
.pa-root{
  --pa-yours:#0d9488; --pa-contested:#a16207; --pa-theirs:#be185d; --pa-nocall:#8a8f94;
}
@media (prefers-color-scheme: dark){
  .pa-root{ --pa-yours:#14a08f; --pa-contested:#c08a1b; --pa-theirs:#d2497e; --pa-nocall:#9aa0a6; }
}
.pa-root{
  --pa-yours-bg:color-mix(in srgb, var(--pa-yours) 11%, var(--surface));
  --pa-contested-bg:color-mix(in srgb, var(--pa-contested) 11%, var(--surface));
  --pa-theirs-bg:color-mix(in srgb, var(--pa-theirs) 10%, var(--surface));
  --pa-nocall-bg:color-mix(in srgb, var(--pa-nocall) 10%, var(--surface));
}
.pa-memo{ font-family: Georgia, ui-serif, "Times New Roman", serif; }
.pa-sans{ font-family: var(--font-inter), system-ui, -apple-system, sans-serif; }
@keyframes pa-slide{ from{ transform:translateX(100%) } to{ transform:none } }
@keyframes pa-fade{ from{ opacity:0 } to{ opacity:1 } }
.pa-panel{ animation: pa-slide .22s ease; }
.pa-scrim{ animation: pa-fade .2s ease; }
@media (prefers-reduced-motion: reduce){ .pa-panel, .pa-scrim{ animation:none; } }
`;

const VWORD: Record<CellVerdict, string> = { yours: "Yours", contested: "Contested", theirs: "Lost", nocall: "No call" };
const VCOLOR: Record<CellVerdict, { fg: string; bg: string }> = {
  yours: { fg: "var(--pa-yours)", bg: "var(--pa-yours-bg)" },
  contested: { fg: "var(--pa-contested)", bg: "var(--pa-contested-bg)" },
  theirs: { fg: "var(--pa-theirs)", bg: "var(--pa-theirs-bg)" },
  nocall: { fg: "var(--pa-nocall)", bg: "var(--pa-nocall-bg)" },
};
const BWORD: Record<CellBadge, string> = { wall: "wall", leak: "leak", inhouse: "in-house", watch: "watch" };
const BCOLOR: Record<CellBadge, string> = {
  wall: "var(--pa-theirs)",
  leak: "var(--pa-contested)",
  inhouse: "var(--pa-yours)",
  watch: "var(--ink-3)",
};
const BTIP: Record<CellBadge, string> = {
  wall: "Lost to something the buyer already has, not to an argument",
  leak: "Picks leave the category",
  inhouse: "Caught by your own cheaper option",
  watch: "The number reads better than the standing",
};
const STATUS: Record<PositionStatus, { word: string; v: CellVerdict }> = {
  deficit: { word: "Deficit", v: "theirs" },
  surplus: { word: "Surplus", v: "yours" },
  watch: { word: "Watch", v: "contested" },
};

const pctOf = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = c.k / c.n;
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
const rangeOf = (c: RateCell) =>
  c.n === 0 ? "no answers" : `${c.k} of ${c.n} - 95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%`;
const answersTip = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "answer" : "answers"} behind this cell`;

function Badge({ b }: { b: CellBadge }) {
  return (
    <span
      title={BTIP[b]}
      className={`rounded-[4px] border bg-surface px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${
        b === "watch" ? "border-dashed" : ""
      }`}
      style={{ borderColor: BCOLOR[b], color: BCOLOR[b] }}
    >
      {BWORD[b]}
    </span>
  );
}

function StatusChip({ status }: { status: PositionStatus }) {
  const s = STATUS[status];
  return (
    <span
      className="rounded-[5px] px-2 py-0.5 text-[12px] font-semibold"
      style={{ background: VCOLOR[s.v].bg, color: VCOLOR[s.v].fg }}
    >
      {s.word}
    </span>
  );
}

// ---------- the tier ----------

export default function AnalysisTier({
  runId,
  projectId,
  view,
  onView,
}: {
  runId: string;
  /** Keys the decision record; absent on share links (read-only). */
  projectId?: string;
  view: TierView;
  /** Switch the shell's pill (a tension's "Open the position" goes to the Map). */
  onView?: (v: TierView) => void;
}) {
  const engines = useEngineSet();
  const q = viewQuery({ engines });
  const [map, setMap] = useState<AnalysisMapView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<AnalysisDecision | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/analysis_map${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`The analysis could not load (${r.status}).`);
        const d = (await r.json()) as { view: AnalysisMapView | null };
        if (live) setMap(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId, q]);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetch(`/api/projects/${projectId}/analysis_decision`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { decision: AnalysisDecision | null } | null) => {
        if (live && d) setDecision(d.decision);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [projectId]);

  const save = useCallback(
    async (body: { cellId: string; suggested: Triage; decided?: Triage | null; inPlaybook?: boolean }) => {
      if (!projectId) throw new Error("Read-only view.");
      const r = await fetch(`/api/projects/${projectId}/analysis_decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`Could not save (${r.status}).`);
      const d = (await r.json()) as { decision: AnalysisDecision | null };
      setDecision(d.decision);
    },
    [projectId]
  );

  const openPosition = (id: string) => setOpenId(id);
  const openFromVerdict = (id: string) => {
    onView?.("map");
    setOpenId(id);
  };

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (map === undefined)
    return <div className="card px-5 py-4 text-[13px] text-ink-3">Reading the coded answers...</div>;
  if (map === null) return null;

  const position = openId ? map.positions[openId] : undefined;
  return (
    <div className="pa-root grid gap-8">
      <style>{TIER_CSS}</style>
      {view === "verdict" && <VerdictView map={map} onOpen={openFromVerdict} />}
      {view === "map" && <MapView map={map} onOpen={openPosition} />}
      {view === "portfolio" && <PortfolioView map={map} decision={decision} onOpen={openPosition} />}
      {position && (
        <PositionPanel
          key={position.cellId}
          runId={runId}
          position={position}
          entry={decision?.positions[position.cellId]}
          editable={!!projectId}
          save={save}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

// ---------- The Verdict ----------

function VerdictView({ map, onOpen }: { map: AnalysisMapView; onOpen: (cellId: string) => void }) {
  const you = map.shareOfDecided.find((s) => s.you);
  const brand = you?.brand;
  const named = map.dots.named;
  const picked = map.dots.picked;
  const maxShare = Math.max(0.0001, ...map.shareOfDecided.map((s) => (s.share.n > 0 ? s.share.k / s.share.n : 0)));
  return (
    <article className="pa-memo max-w-[72ch]">
      <div className="pa-sans mb-2.5 text-[11px] uppercase tracking-[0.09em] text-ink-3">
        The verdict{brand ? ` - ${brand}` : ""}
      </div>
      <h2 className="text-[1.65rem] font-semibold leading-tight text-ink [text-wrap:balance]">{map.casting.heading}</h2>
      <p className="mt-2.5 text-[1.12rem] italic leading-relaxed text-ink">{map.casting.casting}</p>
      <p className="mt-3.5 leading-relaxed text-ink-2">{map.casting.detail}</p>

      <div className="pa-sans card my-6 px-5 py-4">
        <h3 className="text-[15px] font-semibold text-ink">Known vs picked</h3>
        <p className="mb-3 text-[12px] text-ink-3">
          Open-choice answers only. Grey: named in the answer. Blue: the one the AI says to buy.
        </p>
        <div
          className="grid grid-cols-[7rem_1fr_6.5rem] items-center gap-3 sm:grid-cols-[9rem_1fr_8rem]"
          title={`Named in ${rangeOf(named)}; picked in ${rangeOf(picked)}`}
        >
          <span className="truncate text-right text-sm font-semibold text-primary">{brand ?? "You"}</span>
          <DotTrack a={named.n > 0 ? named.k / named.n : 0} b={picked.n > 0 ? picked.k / picked.n : 0} emphasis />
          <span className="text-sm tabular-nums text-ink-2">
            {pctOf(named)} named · {pctOf(picked)} picked
          </span>
        </div>
        <p className="mt-3 text-[12px] text-ink-3">
          The distance between the two dots is the conversion problem every position below explains.
        </p>

        {map.shareOfDecided.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <h4 className="text-[13px] font-semibold text-ink">Who wins instead</h4>
            <p className="mb-2 text-[12px] text-ink-3">
              Share of decided open-choice picks - answers with a firm pick in the category.
            </p>
            <div className="grid gap-1.5">
              {map.shareOfDecided.map((s) => {
                const x = s.share.n > 0 ? s.share.k / s.share.n : 0;
                return (
                  <div
                    key={s.brand}
                    className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 sm:grid-cols-[9rem_1fr_3rem]"
                    title={rangeOf(s.share)}
                  >
                    <span className={`truncate text-right text-[13px] ${s.you ? "font-semibold text-primary" : "text-ink-2"}`}>
                      {s.brand}
                    </span>
                    <div className="relative h-2.5">
                      <div
                        className={`absolute inset-y-0 left-0 rounded-r-[3px] ${s.you ? "bg-primary" : "bg-neutral-bar"}`}
                        style={{ width: `${(x / maxShare) * 100}%` }}
                      />
                    </div>
                    <span className="text-[12px] tabular-nums text-ink-2">{pctOf(s.share)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {map.tensions.map((t) => (
        <div key={t.cellId + t.title} className="my-5 border-l-[3px] border-line pl-4 leading-relaxed text-ink">
          <b className="font-semibold">{t.title}</b> {t.body}
          <div>
            {map.positions[t.cellId] && (
              <button
                type="button"
                onClick={() => onOpen(t.cellId)}
                className="pa-sans mt-1.5 rounded-full border border-line bg-surface px-3 py-0.5 text-[12px] font-medium text-primary hover:border-ink-3"
              >
                Open the position →
              </button>
            )}
          </div>
        </div>
      ))}

      {map.uncoded > 0 && (
        <p className="pa-sans mt-6 border-t border-line pt-3 text-[12px] text-ink-3">
          A few answers in these pools are not coded yet and sit outside every number here.
        </p>
      )}
    </article>
  );
}

// ---------- The Map ----------

function CellButton({ cell, onOpen, hasPosition }: { cell: MapCell; onOpen: (id: string) => void; hasPosition: boolean }) {
  const c = VCOLOR[cell.verdict];
  return (
    <button
      type="button"
      onClick={() => hasPosition && onOpen(cell.id)}
      disabled={!hasPosition}
      title={answersTip(cell.n)}
      className={`flex min-w-[150px] flex-col items-start gap-1 rounded-[7px] border border-transparent px-2.5 py-1.5 text-left transition-colors enabled:hover:border-line disabled:cursor-default ${
        cell.wide ? "basis-full" : "flex-[1_1_160px]"
      }`}
      style={{ background: c.bg }}
    >
      {cell.label && <span className="text-[12px] font-semibold text-ink">{cell.label}</span>}
      <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: c.fg }}>
        <i className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: c.fg }} />
        {VWORD[cell.verdict]}
      </span>
      {cell.note && <span className="text-[12px] leading-snug text-ink-2">{cell.note}</span>}
      {cell.badges.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {cell.badges.map((b) => (
            <Badge key={b} b={b} />
          ))}
        </span>
      )}
    </button>
  );
}

function MapView({ map, onOpen }: { map: AnalysisMapView; onOpen: (id: string) => void }) {
  return (
    <div className="grid gap-5">
      <div className="max-w-[72ch]">
        <h2 className="text-lg font-semibold text-ink">The coverage map, measured</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Every contest the tracker runs, one cell each. Each band varies by what that contest actually varies by -
          your buyers, your named rivals, the worries you confirmed, the settled-customer questions. Click any cell to
          open its position.
        </p>
      </div>
      {map.bands.map((band) => (
        <section key={band.title}>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{band.title}</h3>
          {band.sub && <p className="mb-2 text-[12px] text-ink-2">{band.sub}</p>}
          <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
            {band.rows.map((row) => (
              <div
                key={row.stage}
                className="grid grid-cols-1 border-b border-line/60 last:border-b-0 sm:grid-cols-[150px_1fr]"
              >
                <div className="border-b border-dashed border-line/60 px-2.5 pb-1.5 pt-3 text-[13px] font-medium text-ink sm:border-b-0 sm:border-r sm:border-solid sm:pb-3">
                  {row.stage}
                </div>
                <div className="flex flex-wrap gap-2 p-2">
                  {row.cells.map((cell) => (
                    <CellButton key={cell.id} cell={cell} onOpen={onOpen} hasPosition={!!map.positions[cell.id]} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-2">
        {(["yours", "contested", "theirs", "nocall"] as const).map((v) => (
          <span key={v} className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: VCOLOR[v].fg }} />
            {VWORD[v]}
          </span>
        ))}
        {(["wall", "leak", "inhouse", "watch"] as const).map((b) => (
          <span key={b} className="flex items-center gap-1.5">
            <Badge b={b} /> {BTIP[b].toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- The Position ----------

function PositionPanel({
  runId,
  position: p,
  entry,
  editable,
  save,
  onClose,
}: {
  runId: string;
  position: Position;
  entry?: AnalysisDecision["positions"][string];
  editable: boolean;
  save: (body: { cellId: string; suggested: Triage; decided?: Triage | null; inPlaybook?: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [evidence, setEvidence] = useState<EvidenceRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const evidenceOpen = evidence !== null;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    // The evidence drill handles its own Escape; this panel stays open under it.
    if (evidenceOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, evidenceOpen]);

  const options = p.status === "deficit" ? DEFICIT_TRIAGES : SURPLUS_TRIAGES;
  const active: Triage = entry?.decided ?? p.triageSuggested;
  const inPlaybook = !!entry?.inPlaybook;

  const run = async (body: Parameters<typeof save>[0]) => {
    setBusy(true);
    setErr(null);
    try {
      await save(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pickTriage = (t: Triage) => {
    if (t === active) return;
    void run({ cellId: p.cellId, suggested: p.triageSuggested, decided: t === p.triageSuggested ? null : t });
  };
  const setPlaybook = (on: boolean) => void run({ cellId: p.cellId, suggested: p.triageSuggested, inPlaybook: on });

  const quotes = p.receipts.filter((r) => r.quote).slice(0, 3);
  const ids = p.receipts.map((r) => r.responseId);
  const liftMax = Math.max(10, ...p.lifts.map((l) => Math.abs(l.value)));

  const h3 = "mt-6 mb-2 border-t border-line pt-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3";
  return (
    <>
      <div className="pa-scrim fixed inset-0 z-40 bg-black/35" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Position detail"
        className="pa-panel fixed inset-y-0 right-0 z-[45] w-full max-w-[600px] overflow-y-auto border-l border-line bg-surface px-5 pb-10 pt-5 shadow-2xl sm:px-6"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="float-right ml-3 grid h-8 w-8 place-items-center rounded-full border border-line text-ink-3 hover:text-ink"
        >
          ×
        </button>
        <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-ink-3">{p.where}</div>
        <h2 className="mb-2.5 max-w-[48ch] text-[1.15rem] font-semibold leading-snug text-ink [text-wrap:balance]">
          {p.claim}
        </h2>

        <dl className="my-3.5 grid grid-cols-[6rem_1fr] items-baseline gap-x-3.5 gap-y-1.5 text-[13px]">
          <dt className="text-[11px] uppercase tracking-[0.07em] text-ink-3">Taken by</dt>
          <dd className="text-ink">
            {p.taker} <span className="text-ink-3">· {p.takerKind}</span>
          </dd>
          <dt className="text-[11px] uppercase tracking-[0.07em] text-ink-3">Status</dt>
          <dd>
            <StatusChip status={p.status} />
          </dd>
        </dl>

        <div className="text-[13px]">
          <span className="text-ink-2">Triage - engine suggests, you decide:</span>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {options.map((t) => {
              const on = t === active;
              return editable ? (
                <button
                  key={t}
                  type="button"
                  disabled={busy}
                  onClick={() => pickTriage(t)}
                  aria-pressed={on}
                  title={t === p.triageSuggested ? "The engine's suggestion" : undefined}
                  className={`rounded-md border px-2.5 py-0.5 text-[12px] transition-colors disabled:opacity-60 ${
                    on ? "border-[var(--color-primary)] font-semibold text-primary" : "border-line text-ink hover:border-ink-3"
                  }`}
                >
                  {TRIAGE_LABEL[t]}
                </button>
              ) : (
                on && (
                  <span key={t} className="rounded-md border border-[var(--color-primary)] px-2.5 py-0.5 text-[12px] font-semibold text-primary">
                    {TRIAGE_LABEL[t]}
                  </span>
                )
              );
            })}
          </span>
          {entry?.decided && entry.decided !== p.triageSuggested && (
            <p className="mt-1.5 text-[12px] text-ink-3">
              Your call - the engine suggested {TRIAGE_LABEL[p.triageSuggested]}.
            </p>
          )}
          <p className="mt-2 leading-relaxed text-ink-2">{p.triageWhy}</p>
          {err && <p className="mt-1.5 text-[12px] text-danger">{err}</p>}
        </div>

        {p.lifts.length > 0 && (
          <>
            <h3 className={h3}>The arguments</h3>
            <div className="grid gap-1">
              {p.lifts.map((l) => {
                const w = (Math.min(Math.abs(l.value), liftMax) / liftMax) * 50;
                const v = Math.round(l.value);
                return (
                  <div key={l.label} className="grid grid-cols-[minmax(7.5rem,1fr)_1fr_3rem] items-center gap-2.5 text-[13px]">
                    <span className="text-ink-2">{l.label}</span>
                    <div className="relative h-2.5">
                      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-line" />
                      <span
                        className="absolute top-px h-2 rounded-[3px]"
                        style={
                          l.value >= 0
                            ? { left: "50%", width: `${w}%`, background: "var(--pa-yours)" }
                            : { right: "50%", width: `${w}%`, background: "var(--pa-theirs)" }
                        }
                      />
                    </div>
                    <span className="text-right text-[12px] tabular-nums text-ink-2">
                      {v > 0 ? "+" : ""}
                      {v}
                    </span>
                  </div>
                );
              })}
            </div>
            {p.liftNote && <p className="mt-2 text-[12px] text-ink-3">{p.liftNote}</p>}
          </>
        )}

        {(p.toward.length > 0 || p.away.length > 0) && (
          <>
            <h3 className={h3}>The conditions</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["Route to you", p.toward, "var(--pa-yours)"],
                  ["Route away", p.away, "var(--pa-theirs)"],
                ] as const
              ).map(([title, list, color]) => (
                <div key={title}>
                  <h4 className="mb-1.5 text-[13px] font-semibold" style={{ color }}>
                    {title}
                  </h4>
                  <ul className="text-[13px]">
                    {list.length === 0 && <li className="py-1 text-ink-3">None measured</li>}
                    {list.map((c, i) => (
                      <li
                        key={c.text + i}
                        className="border-b border-dashed border-line/70 py-1 text-ink"
                        title={`About ${c.n.toLocaleString("en-US")} answers`}
                      >
                        {c.text}
                        {c.wall && (
                          <span
                            className="ml-1.5 rounded-[4px] border px-1 text-[10px] uppercase tracking-wide"
                            style={{ borderColor: "var(--pa-theirs)", color: "var(--pa-theirs)" }}
                            title={BTIP.wall}
                          >
                            wall
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}

        {ids.length > 0 && (
          <>
            <h3 className={h3}>The receipts</h3>
            {quotes.map((r) => (
              <blockquote
                key={r.responseId}
                className="my-2.5 rounded-r-md border-l-[3px] border-line bg-canvas px-3.5 py-2.5 text-[13px] leading-relaxed text-ink"
              >
                &ldquo;{plainQuote(r.quote as string)}&rdquo;
              </blockquote>
            ))}
            <button
              type="button"
              onClick={() =>
                setEvidence({
                  title: p.claim,
                  subtitle: p.where,
                  ids: ids.slice(0, EVIDENCE_CAP),
                  total: ids.length,
                  highlight: quotes.map((r) => r.quote as string),
                })
              }
              className="mt-1 rounded-full border border-line px-3 py-1 text-[12px] font-medium text-primary hover:border-ink-3"
            >
              Open the answers
            </button>
          </>
        )}

        <h3 className={h3}>The lever</h3>
        <div className="rounded-lg border border-line bg-canvas px-3.5 py-3 text-[14px] leading-relaxed text-ink">
          {p.lever}
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            {editable &&
              (inPlaybook ? (
                <>
                  <button
                    type="button"
                    disabled
                    className="rounded-md border border-[var(--color-primary)] bg-surface px-3 py-1 text-[13px] font-semibold text-primary opacity-60"
                  >
                    In the playbook
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPlaybook(false)}
                    className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPlaybook(true)}
                  className="rounded-md border border-[var(--color-primary)] bg-surface px-3 py-1 text-[13px] font-semibold text-primary hover:bg-primary-soft disabled:opacity-60"
                >
                  Add to playbook
                </button>
              ))}
            <span className="text-[12px] text-ink-2">Treatment family: {p.family}</span>
          </div>
        </div>
      </aside>
      {evidence && <EvidencePanel runId={runId} request={evidence} onClose={() => setEvidence(null)} />}
    </>
  );
}

// ---------- The Portfolio ----------

function PortfolioView({
  map,
  decision,
  onOpen,
}: {
  map: AnalysisMapView;
  decision: AnalysisDecision | null;
  onOpen: (id: string) => void;
}) {
  // Map order (band, then row, then cell) is the base order; in-playbook first.
  const order = new Map<string, number>();
  let i = 0;
  for (const band of map.bands) for (const row of band.rows) for (const cell of row.cells) order.set(cell.id, i++);
  const all = Object.values(map.positions).sort((a, b) => {
    const pa = decision?.positions[a.cellId]?.inPlaybook ? 0 : 1;
    const pb = decision?.positions[b.cellId]?.inPlaybook ? 0 : 1;
    return pa - pb || (order.get(a.cellId) ?? 1e9) - (order.get(b.cellId) ?? 1e9);
  });
  const treat = all.filter((p) => p.status === "deficit");
  const manage = all.filter((p) => p.status !== "deficit");

  const card = (p: Position) => {
    const e = decision?.positions[p.cellId];
    const triage = e?.decided ?? p.triageSuggested;
    return (
      <button
        key={p.cellId}
        type="button"
        onClick={() => onOpen(p.cellId)}
        className="mb-2.5 w-full rounded-[9px] border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:border-[var(--color-primary)]"
      >
        <div className="text-[14px] font-semibold leading-snug text-ink">{p.claim}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusChip status={p.status} />
          <span className="rounded-[4px] border border-line px-1.5 py-px text-[12px] text-ink">
            {TRIAGE_LABEL[triage]}
            {!e?.decided && <span className="ml-1 text-ink-3">suggested</span>}
          </span>
          <span className="rounded-[4px] border border-line px-1.5 py-px text-[12px] text-ink-2">{p.family}</span>
          {e?.inPlaybook && (
            <span className="rounded-[4px] bg-primary-soft px-1.5 py-px text-[12px] font-semibold text-primary">In playbook</span>
          )}
          <span className="text-[11px] text-ink-3">wave 1 - baseline</span>
        </div>
      </button>
    );
  };

  return (
    <div className="grid gap-5">
      <div className="max-w-[72ch]">
        <h2 className="text-lg font-semibold text-ink">The portfolio</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Every position, two-sided: deficits get treated, standing gets managed. The engine suggests a triage for each;
          confirm or change it in the position, and add the ones you will act on to the playbook.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {(
          [
            ["Treat - deficits", treat],
            ["Manage - standing", manage],
          ] as const
        ).map(([title, list]) => (
          <div key={title}>
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</h3>
            {list.length === 0 ? <p className="text-[13px] text-ink-3">None this wave.</p> : list.map(card)}
          </div>
        ))}
      </div>
      <p className="max-w-[72ch] text-[12px] leading-relaxed text-ink-3">
        Treatment families come from the service ladder. The economical tier - GEO playbook, Evidence audit, Strategy
        pulse, Reality audit - discovers whether the premium tier is needed: Proof studies, Full studies, Authority
        study, Opportunity sizing. Next wave every position re-measures and shows whether it moved, held or slipped.
      </p>
    </div>
  );
}
