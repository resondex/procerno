"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RateCell } from "@/lib/engine/view_data";
import type { AnalysisDecision, AnalysisMapView, MapBand, MapCell, MapRow, Triage } from "@/lib/engine/analysis_types";
import type { Dossier, DossiersView } from "@/lib/engine/dossiers";
import type { HeadToHeadViews } from "@/lib/engine/head_to_head";
import { useEngineSet, viewQuery } from "./view_parts";
import {
  BodiesProvider,
  catPhrase,
  normName,
  notesOf,
  whyLines,
  SlideOver,
  VCOLOR,
  VWORD,
  type PanelCtx,
  type PanelView,
} from "./analysis_panel";

/**
 * The analysis hub (2026-11-10, the ratified redesign - scratchpad
 * template.html + BUILD_SPEC.md): the Overview and the Map over ONE
 * /analysis_map payload, the rival cards over ONE /dossiers payload, and the
 * one slide-over (analysis_panel.tsx) every contest, finding and rival opens.
 * Mounted once by the results shell and never hidden as a whole - only its
 * pages are - so the slide-over can open over the Data and Brief pages too,
 * and a page switch never refetches.
 *
 * The Overview replaces The Verdict and The Portfolio: the casting, three
 * headline numbers, the share-of-picks board, the findings each with its own
 * move, and the playbook. The Map keeps today's banded layouts with a switch
 * to the rival cards (today's Rivals dossiers); its cells show color and note
 * only - the badges' meaning moved into the panel as sentences.
 */

export type HubPage = "overview" | "map";
export type HubGo = "map" | "brief" | "build";
/** A request from another page to open the slide-over; `n` makes a repeat click a new request. */
export type PanelReq = { view: PanelView; n: number };

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
@keyframes pa-slide{ from{ transform:translateX(24px); opacity:.6 } to{ transform:none; opacity:1 } }
@keyframes pa-fade{ from{ opacity:0 } to{ opacity:1 } }
.pa-panel{ animation: pa-slide .16s ease-out; }
.pa-scrim{ animation: pa-fade .2s ease; }
@media (prefers-reduced-motion: reduce){ .pa-panel, .pa-scrim{ animation:none; } }
@media print{ .pa-panel, .pa-scrim{ display:none !important; } }
`;

const pctOf = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = c.k / c.n;
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
const tipOf = (c: RateCell) => `${c.k.toLocaleString("en-US")} of ${c.n.toLocaleString("en-US")} answers`;

/** Playbook marks on the map cells: the in-playbook ids and whether to dim the rest. */
const MarkCtx = createContext<{ mine: Set<string>; mineOnly: boolean }>({ mine: new Set(), mineOnly: false });

// ---------- the hub ----------

export default function AnalysisHub({
  runId,
  projectId,
  page,
  category,
  onGo,
  panelReq,
}: {
  runId: string;
  /** Keys the decision record; absent on share links (read-only). */
  projectId?: string;
  /** The page on screen, or null while the Data or Brief page shows (the slide-over still opens). */
  page: HubPage | null;
  category?: string | null;
  onGo: (to: HubGo) => void;
  panelReq?: PanelReq | null;
}) {
  const engines = useEngineSet();
  const q = viewQuery({ engines });
  const [map, setMap] = useState<AnalysisMapView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<AnalysisDecision | null>(null);
  const [dossiers, setDossiers] = useState<DossiersView | null | undefined>(undefined);
  const [h2h, setH2h] = useState<HeadToHeadViews | null>(null);
  const [panel, setPanel] = useState<PanelView | null>(null);
  const [mapView, setMapView] = useState<"contest" | "rival">("contest");
  const [mineOnly, setMineOnly] = useState(false);
  // The last outside request applied - adjusted during render (React's
  // derive-from-props pattern) so a request waits for the map without an effect.
  const [reqSeen, setReqSeen] = useState<number | null>(null);
  if (panelReq && panelReq.n !== reqSeen && map) {
    setReqSeen(panelReq.n);
    if (panelReq.view.kind === "rival" || map.positions[panelReq.view.id]) setPanel(panelReq.view);
  }

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/analysis_map${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`The analysis could not load (${r.status}).`);
        const d = (await r.json()) as { view: AnalysisMapView | null };
        if (live) setMap(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    fetch(`/api/runs/${runId}/dossiers${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { view: DossiersView | null } | null) => live && setDossiers(d?.view ?? null))
      .catch(() => live && setDossiers(null));
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

  // The matchup boundaries load the first time a rival panel opens.
  const h2hAsked = useRef(false);
  const wantH2h = panel?.kind === "rival";
  useEffect(() => {
    if (!wantH2h || h2hAsked.current) return;
    h2hAsked.current = true;
    fetch(`/api/runs/${runId}/head_to_head${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { views: HeadToHeadViews | null } | null) => setH2h(d?.views ?? null))
      .catch(() => {});
  }, [wantH2h, runId, q]);

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
  const onClose = useCallback(() => setPanel(null), []);

  const cells = useMemo(() => {
    const m = new Map<string, MapCell>();
    for (const b of map?.bands ?? []) for (const r of b.rows) for (const c of r.cells) m.set(c.id, c);
    return m;
  }, [map]);
  const list = useMemo(() => (dossiers?.dossiers ?? []) as unknown as Dossier[], [dossiers]);
  const findDossier = useCallback(
    (name: string) => {
      const n = normName(name);
      return list.find((d) => normName(d.name) === n || d.key === name);
    },
    [list]
  );
  const cat = catPhrase(category);
  const mine = useMemo(
    () => new Set(Object.entries(decision?.positions ?? {}).filter(([, e]) => e.inPlaybook).map(([id]) => id)),
    [decision]
  );

  if (error) return page ? <div className="card px-5 py-4 text-[13px] text-danger">{error}</div> : null;
  if (map === undefined) return page ? <div className="card px-5 py-4 text-[13px] text-ink-3">Reading the coded answers...</div> : null;
  if (map === null) return null;

  const you = map.shareOfDecided.find((s) => s.you);
  const ctx: PanelCtx = {
    runId,
    map,
    cells,
    dossiers: dossiers === undefined ? null : list,
    findDossier,
    cat,
    decision,
    editable: !!projectId,
    save,
    open: setPanel,
    onClose,
    onBuildTable: () => onGo("build"),
    h2hRow: (d) => [...(h2h?.entity?.rows ?? []), ...(h2h?.class?.rows ?? [])].find((r) => r.key === d.key && r.conditions) ?? null,
    brand: you?.brand ?? dossiers?.brand ?? "You",
  };
  const goRivals = () => {
    setMapView("rival");
    onGo("map");
  };

  return (
    <BodiesProvider runId={runId}>
      <div className="pa-root">
        <style>{TIER_CSS}</style>
        {page === "overview" && <Overview map={map} ctx={ctx} mine={mine} onGo={onGo} onRivals={goRivals} />}
        {page === "map" && (
          <MarkCtx.Provider value={{ mine, mineOnly: mineOnly && mine.size > 0 }}>
            <MapPage
              map={map}
              ctx={ctx}
              view={mapView}
              setView={setMapView}
              mineOnly={mineOnly}
              setMineOnly={setMineOnly}
              mineCount={mine.size}
              prefScope={projectId ?? "shared"}
              dossiers={list}
              dossiersLoading={dossiers === undefined}
            />
          </MarkCtx.Provider>
        )}
        {panel && <SlideOver view={panel} ctx={ctx} />}
      </div>
    </BodiesProvider>
  );
}

// ---------- the Overview ----------

function Overview({
  map,
  ctx,
  mine,
  onGo,
  onRivals,
}: {
  map: AnalysisMapView;
  ctx: PanelCtx;
  mine: Set<string>;
  onGo: (to: HubGo) => void;
  onRivals: () => void;
}) {
  const you = map.shareOfDecided.find((s) => s.you);
  const named = map.dots.named;
  const commit: RateCell | null = you && map.dots.picked.n > 0 ? { k: you.share.n, n: map.dots.picked.n, low: 0, high: 0 } : null;
  const shareX = (s: RateCell) => (s.n > 0 ? s.k / s.n : 0);
  const max = Math.max(0.0001, ...map.shareOfDecided.map((s) => shareX(s.share)));
  const playbook = Object.values(map.positions).filter((p) => mine.has(p.cellId));
  const sec = "mt-11";
  return (
    <div className="pb-10">
      <section className="grid items-start gap-9 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">How AI assistants cast you</p>
          <h1 className="font-serif text-[clamp(34px,5vw,46px)] font-normal leading-[1.05] text-ink [text-wrap:balance]">{map.casting.heading}</h1>
          <p className="mt-3.5 max-w-[68ch] text-[17px] leading-[1.65] text-ink">
            {map.casting.casting} {map.casting.detail}
          </p>
          <p className="mt-3.5 text-[14px]">
            <button type="button" onClick={() => onGo("brief")} className="text-primary underline underline-offset-2 hover:opacity-80">
              Read the full brief {"→"}
            </button>
          </p>
          <div className="mt-5 flex flex-wrap gap-7">
            <div title={tipOf(named)}>
              <b className="block font-serif text-[44px] font-normal leading-none tabular-nums text-ink">{pctOf(named)}</b>
              <span className="text-[13px] text-ink-3">named when buyers ask what to buy</span>
            </div>
            {you && (
              <div title={`${you.share.k.toLocaleString("en-US")} of ${you.share.n.toLocaleString("en-US")} picks`}>
                <b className="block font-serif text-[44px] font-normal leading-none tabular-nums text-primary">{pctOf(you.share)}</b>
                <span className="text-[13px] text-ink-3">share of picks</span>
              </div>
            )}
            {commit && (
              <div title={tipOf(commit)}>
                <b className="block font-serif text-[44px] font-normal leading-none tabular-nums text-ink">{pctOf(commit)}</b>
                <span className="text-[13px] text-ink-3">of answers commit to one {ctx.cat.singular}</span>
              </div>
            )}
          </div>
        </div>
        {map.shareOfDecided.length > 0 && (
          <div className="card min-w-0 p-[18px]">
            <h3 className="mb-3 text-[13px] font-semibold text-ink">Share of picks, when the AI commits</h3>
            {map.shareOfDecided.map((s) => {
              const d = !s.you ? ctx.findDossier(s.brand) : undefined;
              const inner = (
                <>
                  <span className="truncate">{s.brand}</span>
                  <span className="h-2.5 overflow-hidden rounded-[5px] bg-line/60">
                    <i className={`block h-full rounded-[5px] ${s.you ? "bg-primary" : "bg-neutral-bar"}`} style={{ width: `${(100 * shareX(s.share)) / max}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{pctOf(s.share)}</span>
                </>
              );
              const cls = `grid w-full grid-cols-[minmax(0,132px)_minmax(0,1fr)_40px] items-center gap-2.5 rounded-md py-1 text-left text-[13px] ${s.you ? "font-semibold text-ink" : "text-ink-2"}`;
              return d ? (
                <button
                  key={s.brand}
                  type="button"
                  title={`Open ${s.brand}`}
                  onClick={() => ctx.open({ kind: "rival", name: d.name })}
                  className={`${cls} hover:bg-primary-soft`}
                >
                  {inner}
                </button>
              ) : (
                <div key={s.brand} className={cls}>
                  {inner}
                </div>
              );
            })}
            <p className="mt-2.5 text-[12.5px] text-ink-3">
              Open a rival for its full view, or{" "}
              <button type="button" onClick={onRivals} className="text-primary underline underline-offset-2 hover:opacity-80">
                see all rivals
              </button>
              .
            </p>
          </div>
        )}
      </section>

      {playbook.length > 0 && (
        <section className={sec}>
          <div className="card px-[18px] py-4">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Your playbook</h3>
            {playbook.map((p) => (
              <button
                key={p.cellId}
                type="button"
                onClick={() => ctx.open({ kind: "cell", id: p.cellId })}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-t border-line py-2 text-left text-[14.5px] first:border-t-0 hover:text-primary"
              >
                <span>
                  <b className="font-semibold">{p.where}</b> - {p.family}
                </span>
                <span className="text-[13px] text-ink-3">Open {"→"}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={sec}>
        <h2 className="mb-1 font-serif text-[27px] font-normal leading-[1.15] text-ink">What matters this wave</h2>
        <p className="mb-4 max-w-[70ch] text-[14px] text-ink-3">
          Each finding comes with its move. Add one to your playbook and it is marked on the Map.
        </p>
        <div>
          {map.tensions.map((t) => {
            const p = map.positions[t.cellId];
            const on = mine.has(t.cellId);
            return (
              <div key={t.cellId + t.title} className="border-t border-line last:border-b">
                <button
                  type="button"
                  disabled={!p}
                  onClick={() => p && ctx.open({ kind: "cell", id: t.cellId })}
                  className="group grid w-full gap-3 pb-3 pt-5 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6"
                >
                  <span>
                    <span className="mb-1 block text-[17px] font-semibold leading-snug text-ink">{t.title}</span>
                    <span className="block text-[14px] leading-relaxed text-ink-2">{t.body}</span>
                  </span>
                  {p && <span className="whitespace-nowrap text-[13px] text-ink-3 group-hover:text-primary">See why {"→"}</span>}
                </button>
                {p?.lever && (
                  <div className="mb-5 grid items-center gap-x-4 gap-y-1.5 rounded-xl bg-primary-soft px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-primary sm:col-span-2">What to do - {p.family}</span>
                    <div>
                      {whyLines(notesOf(p), ctx.cat.plural).map((w) => (
                        <p key={w} className="mb-1.5 text-[13.5px] leading-relaxed text-ink-2">{w}</p>
                      ))}
                      <p className="text-[14.5px] leading-relaxed text-ink">{p.lever}</p>
                    </div>
                    {ctx.editable && (
                      <PlayButton on={on} onClick={() => void ctx.save({ cellId: p.cellId, suggested: p.triageSuggested, inPlaybook: !on })} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {map.uncoded > 0 && (
        <p className="mt-8 border-t border-line pt-3 text-[12px] text-ink-3">
          A few answers in these pools are not coded yet and sit outside every number here.
        </p>
      )}
    </div>
  );
}

function PlayButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      className={`justify-self-start whitespace-nowrap rounded-lg px-3 py-1 text-[13px] font-medium disabled:opacity-60 ${
        on ? "border border-line bg-surface text-ink" : "bg-primary text-primary-ink hover:opacity-90"
      }`}
    >
      {on ? "In your playbook" : "Add to playbook"}
    </button>
  );
}

// ---------- the Map: by contest ----------

function CellButton({ cell, onOpen, hasPosition }: { cell: MapCell; onOpen: (id: string) => void; hasPosition: boolean }) {
  const c = VCOLOR[cell.verdict];
  const m = useContext(MarkCtx);
  const mine = m.mine.has(cell.id);
  return (
    <button
      type="button"
      onClick={() => hasPosition && onOpen(cell.id)}
      disabled={!hasPosition}
      title={`${cell.n.toLocaleString("en-US")} answers`}
      className={`flex min-w-0 flex-col items-start gap-1 rounded-[9px] border-[1.5px] px-2.5 py-1.5 text-left transition-[colors,opacity] enabled:hover:border-ink disabled:cursor-default ${
        mine ? "border-[var(--color-primary)]" : "border-transparent"
      } ${m.mineOnly && !mine ? "opacity-30" : ""}`}
      style={{ background: c.bg }}
    >
      {cell.label && <span className="text-[12.5px] font-semibold text-ink">{cell.label}</span>}
      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: c.fg }}>
        <i className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: c.fg }} />
        {VWORD[cell.verdict]}
      </span>
      {cell.note && <span className="text-[12px] leading-snug text-ink-2">{cell.note}</span>}
    </button>
  );
}

// ---------- Map layout + order preferences (per project, this browser only) ----------

type MapLayout = "aligned" | "dossier";
interface MapPrefs {
  layout: MapLayout;
  /** Buying-situation keys (normalized rooms) in display order. */
  rooms: string[];
  /** The chooses band's row slugs (open / social / awareness / ...) in display order. */
  reads: string[];
  /** Fixed cells/cards per row (2-6); absent = auto-fit to the width. */
  perRow?: number;
}

const mapPrefsKey = (scope: string) => `pa-map-prefs:${scope}`;
function loadMapPrefs(scope: string): MapPrefs {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(mapPrefsKey(scope));
    if (raw) {
      const p = JSON.parse(raw) as Partial<MapPrefs>;
      const list = (x: unknown) => (Array.isArray(x) ? x.filter((k): k is string => typeof k === "string") : []);
      const perRow = typeof p.perRow === "number" && p.perRow >= 2 && p.perRow <= 6 ? Math.round(p.perRow) : undefined;
      // A stored "matrix" (the retired layout) falls back to aligned.
      return { layout: p.layout === "dossier" ? "dossier" : "aligned", rooms: list(p.rooms), reads: list(p.reads), perRow };
    }
  } catch {
    /* private window / blocked storage - defaults */
  }
  return { layout: "aligned", rooms: [], reads: [] };
}
function saveMapPrefs(scope: string, p: MapPrefs) {
  try {
    window.localStorage.setItem(mapPrefsKey(scope), JSON.stringify(p));
  } catch {
    /* fine - the choice lasts the session */
  }
}

const cellKeyOf = (id: string) => id.split(":").slice(2).join(":");
const rowSlugOf = (row: MapRow) => row.cells[0]?.id.split(":")[1] ?? "";
/** A key that names a thing (room / rival / worry / question) - not the row's
 * pooled "all" cell and not the "general" (no particular buyer) cell. */
const isThingKey = (k: string) => k !== "all" && k !== "general";
const isChoosesBand = (band: MapBand) => band.rows.some((r) => r.cells.some((c) => c.id.startsWith("chooses:")));

/** Sort by a stored key order; keys the list does not know keep their natural
 * order after the known ones (a new room appears at the end, never lost). */
function orderByPref<T>(items: T[], keyOf: (t: T) => string, pref: string[]): T[] {
  const nat = new Map(items.map((t, i) => [t, i]));
  const rank = (t: T) => {
    const i = pref.indexOf(keyOf(t));
    return i >= 0 ? i : pref.length + (nat.get(t) ?? 0);
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** The room's display name: a non-Value cell's label; a Value label is "room - line". */
const roomLabelOf = (c: MapCell) => (c.id.startsWith("chooses:value:") ? c.label.split(" - ")[0] : c.label);
/** Inside a labelled column or row the room name is redundant; a Value cell keeps its line name. */
const innerLabelOf = (c: MapCell) =>
  c.id.startsWith("chooses:value:") && c.label.includes(" - ") ? c.label.split(" - ").slice(1).join(" - ") : "";

// ---------- The Map: two layouts ----------

/** Aligned (option A + the pinned All column): every row is
 * [stage label | the row's All cell | the split cells on a fixed column grid],
 * so the pooled cells line up down the whole map and a wrapped orphan keeps
 * its size. A row with only an every-buyer cell (social validation, learning
 * the category, premium) puts it in the All column - that cell IS the row,
 * everything pooled. */
function AlignedRow({ row, chooses, rooms, perRow, positions, onOpen }: { row: MapRow; chooses: boolean; rooms: string[]; perRow?: number; positions: AnalysisMapView["positions"]; onOpen: (id: string) => void }) {
  const allCell = row.cells.find((c) => cellKeyOf(c.id) === "all");
  const rest0 = row.cells.filter((c) => c !== allCell);
  const rest = chooses
    ? [...orderByPref(rest0.filter((c) => isThingKey(cellKeyOf(c.id))), (c) => cellKeyOf(c.id), rooms), ...rest0.filter((c) => !isThingKey(cellKeyOf(c.id)))]
    : rest0;
  return (
    <div className="grid grid-cols-1 border-b border-line/60 last:border-b-0 sm:grid-cols-[150px_200px_1fr]">
      <div className="border-b border-dashed border-line/60 px-2.5 pb-1.5 pt-3 text-[13px] font-medium text-ink sm:border-b-0 sm:border-r sm:border-solid sm:pb-3">
        {row.stage}
      </div>
      <div className="p-2 sm:border-r sm:border-line/60 [&>button]:h-full [&>button]:w-full">
        {allCell && <CellButton cell={{ ...allCell, wide: false, all: false }} onOpen={onOpen} hasPosition={!!positions[allCell.id]} />}
      </div>
      <div
        className="grid content-start gap-2 p-2"
        style={{ gridTemplateColumns: perRow ? `repeat(${perRow}, minmax(0, 1fr))` : "repeat(auto-fill, minmax(165px, 1fr))" }}
      >
        {rest.map((c) => (
          <CellButton key={c.id} cell={{ ...c, wide: false, all: false }} onOpen={onOpen} hasPosition={!!positions[c.id]} />
        ))}
      </div>
    </div>
  );
}

/** One line inside a dossier card: the question row's name, then the cell's
 * verdict and note. Clicking it opens the cell's position, like any map cell. */
function DossierLine({ stage, cell, onOpen, hasPosition }: { stage: string; cell: MapCell; onOpen: (id: string) => void; hasPosition: boolean }) {
  const c = VCOLOR[cell.verdict];
  const line = innerLabelOf(cell);
  const m = useContext(MarkCtx);
  const mine = m.mine.has(cell.id);
  return (
    <button
      type="button"
      onClick={() => hasPosition && onOpen(cell.id)}
      disabled={!hasPosition}
      className={`flex w-full items-baseline gap-2 rounded-[6px] border px-2.5 py-1.5 text-left transition-[colors,opacity] enabled:hover:bg-line/25 disabled:cursor-default ${
        mine ? "border-[var(--color-primary)]" : "border-transparent"
      } ${m.mineOnly && !mine ? "opacity-30" : ""}`}
    >
      <span className="w-[96px] flex-none text-[11px] leading-tight text-ink-3">
        {stage}
        {line ? ` · ${line}` : ""}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: c.fg }}>
          <i className="inline-block h-1.5 w-1.5 flex-none rounded-full" style={{ background: c.fg }} />
          {VWORD[cell.verdict]}
        </span>
        {cell.note && <span className="block text-[11.5px] leading-snug text-ink-2">{cell.note}</span>}
      </span>
    </button>
  );
}

/** Dossier cards (the round-2 mock's G): the card IS the thing the band varies
 * by - a buyer, a rival, a worry, a settled question - and the band's question
 * rows become lines inside it. Every card shares one width whatever the band,
 * so no band's cells ever read bigger than another's. An All card opens each
 * band with the pooled lines; rows that exist only pooled (social validation,
 * learning the category, holding your own) live on it. */
function DossierBand({ rows, chooses, rooms, perRow, positions, onOpen }: { rows: MapRow[]; chooses: boolean; rooms: string[]; perRow?: number; positions: AnalysisMapView["positions"]; onOpen: (id: string) => void }) {
  const byRow = rows.map((row) => ({ row, byKey: new Map(row.cells.map((c): [string, MapCell] => [cellKeyOf(c.id), c])) }));
  const thingKeys: string[] = [];
  for (const r of byRow) for (const k of r.byKey.keys()) if (isThingKey(k) && !thingKeys.includes(k)) thingKeys.push(k);
  const things = chooses ? orderByPref(thingKeys, (k) => k, rooms) : thingKeys;
  const hasGeneral = byRow.some((r) => r.byKey.has("general"));
  const cards = ["all", ...things, ...(hasGeneral ? ["general"] : [])];
  const headerOf = (key: string) => {
    if (key === "general") return "No particular buyer";
    for (const r of byRow) {
      const hit = r.byKey.get(key);
      if (hit?.label) return chooses || key === "all" ? roomLabelOf(hit) : hit.label;
    }
    return key === "all" ? "All" : key;
  };
  return (
    <div
      className="grid items-start gap-2.5"
      style={{ gridTemplateColumns: perRow ? `repeat(${perRow}, minmax(0, 1fr))` : "repeat(auto-fill, minmax(240px, 1fr))" }}
    >
      {cards.map((key) => {
        const lines = byRow
          .map(({ row, byKey }) => ({ stage: row.stage, cell: byKey.get(key) }))
          .filter((l): l is { stage: string; cell: MapCell } => !!l.cell);
        if (lines.length === 0) return null;
        return (
          <div key={key} className={`overflow-hidden rounded-[10px] border bg-surface ${key === "all" ? "border-ink-3/50" : "border-line"}`}>
            <div className="border-b border-line/70 bg-line/15 px-2.5 py-1.5 text-[12.5px] font-semibold text-ink">{headerOf(key)}</div>
            <div className="grid gap-0.5 p-1">
              {lines.map((l) => (
                <DossierLine key={l.cell.id} stage={l.stage} cell={l.cell} onOpen={onOpen} hasPosition={!!positions[l.cell.id]} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Map settings (layout + order) ----------

/** A drag-to-reorder list. Dragging an item over a sibling reorders live
 * (sortable style); the parent persists on every move, so dropping anywhere -
 * or dragging out and letting go - keeps the last order shown. */
function OrderList({ title, note, items, onReorder }: { title: string; note?: string; items: { key: string; label: string }[]; onReorder: (from: number, to: number) => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  return (
    <div>
      <h4 className="text-[12px] font-semibold text-ink">{title}</h4>
      {note && <p className="mb-1 text-[11.5px] text-ink-3">{note}</p>}
      <ul className="mt-1 grid gap-1">
        {items.map((it, i) => (
          <li
            key={it.key}
            draggable
            onDragStart={(e) => {
              setDragIdx(i);
              e.dataTransfer.effectAllowed = "move";
              try {
                e.dataTransfer.setData("text/plain", it.label);
              } catch {
                /* some browsers refuse setData mid-render - drag still works */
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIdx !== null && dragIdx !== i) {
                onReorder(dragIdx, i);
                setDragIdx(i);
              }
            }}
            onDrop={(e) => e.preventDefault()}
            onDragEnd={() => setDragIdx(null)}
            className={`flex cursor-grab items-center gap-2 rounded-[6px] border bg-surface px-2 py-1 text-[13px] text-ink active:cursor-grabbing ${
              dragIdx === i ? "border-primary opacity-60" : "border-line/70"
            }`}
          >
            <span aria-hidden className="flex-none select-none text-[11px] leading-none tracking-[0.12em] text-ink-3">
              ⠿
            </span>
            <span className="min-w-0 truncate">{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MapPage({
  map,
  ctx,
  view,
  setView,
  mineOnly,
  setMineOnly,
  mineCount,
  prefScope,
  dossiers,
  dossiersLoading,
}: {
  map: AnalysisMapView;
  ctx: PanelCtx;
  view: "contest" | "rival";
  setView: (v: "contest" | "rival") => void;
  mineOnly: boolean;
  setMineOnly: (v: boolean) => void;
  mineCount: number;
  prefScope: string;
  dossiers: Dossier[];
  dossiersLoading: boolean;
}) {
  const rv = view === "rival";
  const seg = (on: boolean) => `rounded-full px-4 py-1 text-[13.5px] ${on ? "bg-primary-soft font-semibold text-ink" : "text-ink-3 hover:text-ink-2"}`;
  return (
    <section className="pb-10">
      <h2 className="mb-1 font-serif text-[27px] font-normal leading-[1.15] text-ink">The Map</h2>
      <p className="mb-4 max-w-[70ch] text-[14px] text-ink-3">
        {rv
          ? "Every brand the AI names beside you, biggest taker first. Open one for its numbers, what the AI says about it, what sends buyers to it, and the answers behind each."
          : `Every contest the AI decides, colored by who holds it. Open any one for what to do, then the evidence: the numbers, what the AI says about the ${ctx.cat.plural} and about the buyer, and the answers behind each.`}
      </p>
      <div className="mb-5 inline-flex rounded-full border border-line bg-surface p-[3px]" role="tablist">
        <button type="button" role="tab" aria-selected={!rv} className={seg(!rv)} onClick={() => setView("contest")}>
          By contest
        </button>
        <button type="button" role="tab" aria-selected={rv} className={seg(rv)} onClick={() => setView("rival")}>
          By rival
        </button>
      </div>
      {rv ? (
        <RivalGrid dossiers={dossiers} loading={dossiersLoading} ctx={ctx} />
      ) : (
        <ContestMap map={map} ctx={ctx} mineOnly={mineOnly} setMineOnly={setMineOnly} mineCount={mineCount} prefScope={prefScope} />
      )}
    </section>
  );
}

function ContestMap({
  map,
  ctx,
  mineOnly,
  setMineOnly,
  mineCount,
  prefScope,
}: {
  map: AnalysisMapView;
  ctx: PanelCtx;
  mineOnly: boolean;
  setMineOnly: (v: boolean) => void;
  mineCount: number;
  prefScope: string;
}) {
  const [prefs, setPrefs] = useState<MapPrefs>(() => loadMapPrefs(prefScope));
  const [arrange, setArrange] = useState(false);
  const [hint, setHint] = useState(false);
  const update = (p: MapPrefs) => {
    setPrefs(p);
    saveMapPrefs(prefScope, p);
  };
  const onOpen = (id: string) => ctx.open({ kind: "cell", id });

  const chooses = map.bands.find(isChoosesBand);
  const roomCatalog = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    for (const row of chooses?.rows ?? [])
      for (const c of row.cells) {
        const k = cellKeyOf(c.id);
        if (isThingKey(k) && !out.some((x) => x.key === k)) out.push({ key: k, label: roomLabelOf(c) });
      }
    return out;
  }, [chooses]);
  const readCatalog = useMemo(() => (chooses?.rows ?? []).map((r) => ({ key: rowSlugOf(r), label: r.stage })), [chooses]);
  const orderedRooms = orderByPref(roomCatalog, (x) => x.key, prefs.rooms);
  const orderedReads = orderByPref(readCatalog, (x) => x.key, prefs.reads);
  const reorder = (list: "rooms" | "reads", from: number, to: number) => {
    const keys = (list === "rooms" ? orderedRooms : orderedReads).map((x) => x.key);
    if (from < 0 || from >= keys.length || to < 0 || to >= keys.length) return;
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k);
    update({ ...prefs, [list]: keys });
  };

  const seg = (on: boolean) =>
    `rounded-full border px-3 py-0.5 text-[12px] ${on ? "border-primary font-semibold text-primary" : "border-line text-ink-2 hover:border-ink-3"}`;
  const on = mineOnly && mineCount > 0;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-3">
        {(["yours", "contested", "theirs", "nocall"] as const).map((v) => (
          <span key={v} className="flex items-center gap-1.5">
            <i className="inline-block h-[9px] w-[9px] rounded-full" style={{ background: VCOLOR[v].fg }} />
            {VWORD[v]}
          </span>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (mineCount === 0) {
                setHint(true);
                return;
              }
              setMineOnly(!mineOnly);
            }}
            className={`rounded-full border px-3 py-1 text-[13px] ${on ? "border-[var(--color-primary)] bg-primary-soft text-ink" : "border-line text-ink-2 hover:border-ink-3"}`}
          >
            Show my moves
          </button>
          {hint && mineCount === 0 && <span className="text-[12px] text-ink-3">Add a move to your playbook first.</span>}
        </span>
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-ink-3">Layout:</span>
          <button type="button" className={seg(prefs.layout === "aligned")} onClick={() => update({ ...prefs, layout: "aligned" })}>
            Aligned
          </button>
          <button type="button" className={seg(prefs.layout === "dossier")} onClick={() => update({ ...prefs, layout: "dossier" })}>
            Cards
          </button>
          <button type="button" className={seg(arrange)} onClick={() => setArrange(!arrange)}>
            Arrange order {arrange ? "▴" : "▾"}
          </button>
        </div>
        {arrange && (
          <div className="grid gap-4 rounded-[10px] border border-line bg-surface p-3 sm:grid-cols-2">
            <OrderList title="Buying situations" note="Drag to reorder - card order (cards) or the order within each row (aligned)." items={orderedRooms} onReorder={(f, t) => reorder("rooms", f, t)} />
            <OrderList title="Question rows" note="Drag to reorder - the first band's rows, and the line order inside each card." items={orderedReads} onReorder={(f, t) => reorder("reads", f, t)} />
            <div className="flex flex-wrap items-center gap-2 text-[12px] sm:col-span-2">
              <span className="text-ink-3">Cards per row:</span>
              <button type="button" className={seg(!prefs.perRow)} onClick={() => update({ ...prefs, perRow: undefined })}>
                Auto
              </button>
              {[2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={seg(prefs.perRow === n)} onClick={() => update({ ...prefs, perRow: n })}>
                  {n}
                </button>
              ))}
            </div>
            <div className="sm:col-span-2">
              <button type="button" className="text-[12px] text-primary underline decoration-dotted underline-offset-2" onClick={() => update({ ...prefs, rooms: [], reads: [], perRow: undefined })}>
                Reset to setup order
              </button>
            </div>
          </div>
        )}
      </div>

      {map.bands.map((band) => {
        const isCh = isChoosesBand(band);
        const rows = isCh ? orderByPref(band.rows, rowSlugOf, prefs.reads) : band.rows;
        return (
          <section key={band.title} className="mt-2">
            <h3 className="mb-0.5 font-serif text-[22px] font-normal text-ink">{band.title}</h3>
            {band.sub && <p className="mb-3 max-w-[72ch] text-[13px] text-ink-3">{band.sub}</p>}
            {prefs.layout === "dossier" ? (
              <DossierBand rows={rows} chooses={isCh} rooms={prefs.rooms} perRow={prefs.perRow} positions={map.positions} onOpen={onOpen} />
            ) : (
              <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
                {rows.map((row) => (
                  <AlignedRow key={row.stage} row={row} chooses={isCh} rooms={prefs.rooms} perRow={prefs.perRow} positions={map.positions} onOpen={onOpen} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- the Map: by rival ----------

function RivalCard({ d, ctx }: { d: Dossier; ctx: PanelCtx }) {
  const up = d.args.find((a) => a.value > 0);
  const down = d.args.find((a) => a.value < 0);
  const share = d.tiles[1];
  const named = d.tiles[0];
  return (
    <button
      type="button"
      onClick={() => ctx.open({ kind: "rival", name: d.name })}
      className="flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-4 text-left transition-colors hover:border-[var(--color-primary)]"
    >
      <h3 className="text-[17px] font-semibold text-ink">{d.name}</h3>
      {share && (
        <div className="flex flex-wrap items-baseline gap-2 text-[13px] text-ink-3">
          <b className="text-[30px] font-semibold tabular-nums text-ink">{share.value}</b>
          share of picks{named ? ` - named in ${named.value}` : ""}
        </div>
      )}
      {d.h2h.kind === "record" ? (
        <div className="text-[13px] text-ink-3">
          Head-to-head{d.h2h.asClass ? ` (as a kind of ${ctx.cat.singular})` : ""}: you <b className="font-semibold text-ink">{d.h2h.you}</b> - them{" "}
          <b className="font-semibold text-ink">{d.h2h.them}</b>
          <span className="mt-1.5 flex h-2 overflow-hidden rounded bg-line/60" aria-hidden>
            <i className="block h-full" style={{ width: d.h2h.you, background: "var(--pa-yours)" }} />
            <i className="block h-full" style={{ width: d.h2h.them, background: "var(--pa-theirs)" }} />
          </span>
        </div>
      ) : (
        <div
          className={`text-[13px] ${d.h2h.alert ? "border-l-[3px] pl-2 text-ink" : "text-ink-3"}`}
          style={d.h2h.alert ? { borderColor: "var(--pa-contested)" } : undefined}
        >
          Never asked head-to-head{d.h2h.alert ? " - yet it takes picks from you" : ""}
        </div>
      )}
      {up && (
        <div className="text-[13px] text-ink-3">
          Wins on <b className="font-semibold text-ink">{up.label}</b>
          {down && (
            <>
              , loses on <b className="font-semibold text-ink">{down.label}</b>
            </>
          )}
        </div>
      )}
      <span className="mt-auto text-[13px] text-primary">
        Open {d.name} {"→"}
      </span>
    </button>
  );
}

function RivalGrid({ dossiers, loading, ctx }: { dossiers: Dossier[]; loading: boolean; ctx: PanelCtx }) {
  if (loading) return <p className="text-[13px] text-ink-3">Loading the rivals...</p>;
  if (dossiers.length === 0) return <p className="text-[13.5px] text-ink-3">The AI names no other brand often enough to read on its own.</p>;
  const pc = (d: Dossier) => parseFloat((d.tiles[1]?.value ?? "0").replace(/[^0-9.]/g, "")) || 0;
  const sorted = [...dossiers].sort((a, b) => pc(b) - pc(a));
  const lead = sorted.filter((d) => d.prominent);
  const rest = sorted.filter((d) => !d.prominent);
  return (
    <>
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(250px,100%),1fr))]">
        {(lead.length ? lead : sorted).map((d) => (
          <RivalCard key={d.key} d={d} ctx={ctx} />
        ))}
      </div>
      {lead.length > 0 && rest.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-1.5 text-[13px] font-semibold text-ink-3">More brands the AI names</h3>
          {rest.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => ctx.open({ kind: "rival", name: d.name })}
              className="flex w-full flex-wrap justify-between gap-x-3 border-b border-line py-2.5 text-left text-[14px] text-ink hover:text-primary"
            >
              <span>{d.name}</span>
              <span className="text-ink-3">
                {d.tiles[1]?.value ?? "-"} of picks{d.tiles[0] ? ` - named in ${d.tiles[0].value}` : ""} {"→"}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
