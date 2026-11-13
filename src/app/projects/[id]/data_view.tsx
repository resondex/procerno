"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalysisMapView, CellVerdict, MapCell, Position } from "@/lib/engine/analysis_types";
import type { WorkbenchView } from "@/lib/engine/workbench";
import type { DossierTheme } from "@/lib/engine/reason_themes";
import JourneySection from "./journey_view";
import { PivotTable, type ShowAs, type Waves } from "./metrics_view";
import { catPhrase, VCOLOR, VWORD } from "./analysis_panel";
import { Download } from "./table";
import { T } from "./type_scale";
import { useEngineSet, viewQuery } from "./view_parts";
import { sanitizeSettings, type PivotSettings } from "./pivot_compute";
import DataSearchBox from "./data_search_box";
import type { Focus, SearchHit } from "./data_search";
import {
  CONTESTS_ID,
  DEFAULT_ID,
  DETAIL_ID,
  LIBRARY,
  LIB_BY_ID,
  OWN_ID,
  entryAvailable,
  entrySettings,
  type LibEntry,
  type LibKind,
} from "./table_library";

/**
 * The Data page (2026-11-11 rebuild, ratified from the clickable prototype):
 * ONE screen, no tabs - a table library on the left (stacking above on
 * narrow screens) and the table area on the right.
 *
 * - The library (table_library.ts): ready-made tables grouped and named for
 *   the question each answers, a search box, and "Build your own table" at
 *   the bottom. It opens on "Share of picks by brand". A pivot entry whose
 *   question type the run does not carry, or whose measure or dimension is
 *   not legal here, is hidden; an empty group is hidden.
 * - A pivot entry sets the builder (metrics_view.tsx PivotTable, controlled
 *   by this page); changing any control highlights "Build your own table".
 *   This page owns the one workbench fetch (it decides which entries show)
 *   and, for Wave over wave, the previous wave's payload, fetched on first
 *   use. The route names the previous coded wave beside the view (`prev`).
 * - "Every contest" is the Map's contests as a table (TypeTable below, built
 *   from the hub's already-loaded map payload - no request of its own; no
 *   Open link, the Map is where a contest opens). "Question type detail" is
 *   the station read with its buyer filter (its own fetches).
 *
 * The three kinds of content mount on first visit and stay mounted (hidden
 * with CSS), so switching never refetches. The selected entry, Show as and
 * Waves are saved per project. Callers steer the page with a `request`
 * ("types" -> Every contest, "build" -> the builder's current table,
 * "stations" -> Question type detail); the brief's `jump` still lands in
 * the station read.
 */

export type DataTab = "types" | "build" | "stations";
/** A request to show part of the page; `n` makes a repeat a new request. */
export interface DataRequest {
  tab: DataTab;
  n: number;
}

// The last request each run's page applied: a remount (a new assistant set)
// must not re-apply an old request over the reader's own choice.
const appliedReqs = new Map<string, number>();

interface Prefs {
  entry?: string;
  show?: ShowAs;
  waves?: Waves;
  /** "Build your own table": the reader's own settings, kept per project. */
  own?: PivotSettings;
}
/** A table search opened (not in the library, not yet the reader's own). */
const SEARCH_ID = "search";
const prefsKey = (scope: string) => `procerno_data_prefs:${scope}`;
const memPrefs = new Map<string, Prefs>();
function readPrefs(scope: string): Prefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(prefsKey(scope));
    const p = raw ? (JSON.parse(raw) as Prefs) : {};
    return p && typeof p === "object" ? p : {};
  } catch {
    return memPrefs.get(scope) ?? {};
  }
}
function writePrefs(scope: string, patch: Prefs) {
  const next = { ...readPrefs(scope), ...patch };
  memPrefs.set(scope, next);
  try {
    window.localStorage.setItem(prefsKey(scope), JSON.stringify(next));
  } catch {
    // storage blocked: memPrefs carries the choice for this page view
  }
}

const SHOWS: ShowAs[] = ["table", "bars", "dots"];
const ownOf = (p: Prefs): PivotSettings | null => sanitizeSettings(p.own);

export default function DataPage({
  runId,
  projectId,
  map,
  category,
  brand,
  request,
  jump,
}: {
  runId: string;
  projectId?: string;
  /** The hub's map payload: undefined while it loads, null when there is none. */
  map: AnalysisMapView | null | undefined;
  category?: string | null;
  /** The tracker's brand (search names it in head-to-heads); defaults to the payload's. */
  brand?: string;
  request?: DataRequest;
  /** The brief's request to open a station (its by-assistant table); `n` makes a repeat click a new request. */
  jump?: { station: "consideration"; n: number };
}) {
  const scope = projectId ?? runId;
  const [prefs] = useState<Prefs>(() => readPrefs(scope));
  const [sel, setSel] = useState<string>(() => (prefs.entry && (prefs.entry === OWN_ID || LIB_BY_ID.has(prefs.entry)) ? prefs.entry : DEFAULT_ID));
  // The builder's last table (an entry or "own"): where "build" lands.
  const [pivotSel, setPivotSel] = useState<string>(() => (sel === OWN_ID || LIB_BY_ID.get(sel)?.kind === "pivot" ? sel : DEFAULT_ID));
  const [settings, setSettings] = useState<PivotSettings>(() => {
    if (pivotSel === OWN_ID) {
      const own = ownOf(prefs);
      if (own) return own;
    }
    const e = LIB_BY_ID.get(pivotSel);
    return entrySettings(e && e.kind === "pivot" ? e : LIB_BY_ID.get(DEFAULT_ID)!);
  });
  // The table the reader last opened (a library entry or a search result):
  // where Reset goes back to.
  const [origin, setOrigin] = useState<string | SearchHit>(() => (LIB_BY_ID.get(sel)?.kind === "pivot" ? sel : DEFAULT_ID));
  // A row search pointed at, and the name of a table search opened.
  const [focus, setFocus] = useState<Focus | null>(null);
  const [searchTitle, setSearchTitle] = useState("");
  // The library list beside a wide table (Every contest, Question type detail).
  const [libOpen, setLibOpen] = useState(false);
  const [show, setShow] = useState<ShowAs>(() => (prefs.show && SHOWS.includes(prefs.show) ? prefs.show : "table"));
  const [waves, setWaves] = useState<Waves>(() => (prefs.waves === "prev" ? "prev" : "this"));
  const [room, setRoom] = useState("");
  const [rooms, setRooms] = useState<string[]>([]);
  const onRooms = useCallback(
    (rs: string[]) => setRooms((prev) => (prev.length === rs.length && prev.every((r, i) => r === rs[i]) ? prev : rs)),
    []
  );

  // A caller's request, applied once, during render (no effect).
  const [applied, setApplied] = useState(() => appliedReqs.get(runId) ?? 0);
  if (request && request.n !== applied) {
    setApplied(request.n);
    appliedReqs.set(runId, request.n);
    setSel(request.tab === "types" ? CONTESTS_ID : request.tab === "stations" ? DETAIL_ID : pivotSel);
  }

  // ---- the workbench payload (decides which library entries show) ----
  const q = viewQuery({ engines: useEngineSet() });
  const [wb, setWb] = useState<{ loaded: boolean; view: WorkbenchView | null; prev: string | null }>({ loaded: false, view: null, prev: null });
  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/workbench${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        // DEV-ONLY OVERRIDE: ?prevwave=<runId> in the page URL treats that
        // run as the previous wave, so Wave over wave can be walked before a
        // tracker has a second coded wave (the same run id yields all-zero
        // changes). The run is still fetched through the guarded route.
        const forced = new URLSearchParams(window.location.search).get("prevwave");
        setWb({ loaded: true, view: (d?.view as WorkbenchView | null) ?? null, prev: forced || ((d?.prev as string | null) ?? null) });
      })
      .catch(() => live && setWb({ loaded: true, view: null, prev: null }));
    return () => {
      live = false;
    };
  }, [runId, q]);

  // ---- the previous wave, fetched on first use and kept ----
  const prevId = wb.prev;
  const [prevView, setPrevView] = useState<{ id: string; view: WorkbenchView | null } | null>(null);
  const fetchPrev = prevId && (waves === "prev" || prevView?.id === prevId) ? prevId : null;
  useEffect(() => {
    if (!fetchPrev) return;
    let live = true;
    fetch(`/api/runs/${fetchPrev}/workbench${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setPrevView({ id: fetchPrev, view: (d?.view as WorkbenchView | null) ?? null }))
      .catch(() => live && setPrevView({ id: fetchPrev, view: null }));
    return () => {
      live = false;
    };
  }, [fetchPrev, q]);
  const prevData = prevId && prevView?.id === prevId ? prevView.view : undefined;

  // ---- which entries show, and what is shown ----
  const available = useCallback((e: LibEntry) => e.kind !== "pivot" || (wb.loaded && entryAvailable(e, wb.view)), [wb]);
  const firstPivot = useMemo(() => LIBRARY.find((e) => e.kind === "pivot" && wb.loaded && entryAvailable(e, wb.view)) ?? null, [wb]);
  const fallbackEntry = (): LibEntry => {
    const d = LIB_BY_ID.get(DEFAULT_ID)!;
    if (available(d)) return d;
    return firstPivot ?? LIB_BY_ID.get(CONTESTS_ID)!;
  };
  // The shown entry: the selection, unless the run does not carry it.
  let shown: { id: string; kind: LibKind; entry: LibEntry | null };
  if (sel === OWN_ID || sel === SEARCH_ID) {
    shown = wb.loaded && !wb.view?.facts ? { id: CONTESTS_ID, kind: "contests", entry: LIB_BY_ID.get(CONTESTS_ID)! } : { id: sel, kind: "pivot", entry: null };
  } else {
    const e = LIB_BY_ID.get(sel) ?? fallbackEntry();
    const ok = e.kind !== "pivot" || !wb.loaded || available(e);
    const use = ok ? e : fallbackEntry();
    shown = { id: use.id, kind: use.kind, entry: use };
  }
  const shownSettings: PivotSettings = shown.id === sel || shown.id === OWN_ID || shown.id === SEARCH_ID ? settings : entrySettings(shown.entry!);
  const [seen, setSeen] = useState<Set<LibKind>>(() => new Set([shown.kind]));
  if (!seen.has(shown.kind)) setSeen(new Set(seen).add(shown.kind));

  const pick = (e: LibEntry | null, f: Focus | null = null) => {
    setFocus(f);
    setLibOpen(false);
    if (!e) {
      // "Build your own table": the reader's own table as last left (kept
      // per project), else the builder as it stands.
      setSel(OWN_ID);
      setPivotSel(OWN_ID);
      setSettings(ownOf(readPrefs(scope)) ?? shownSettings);
      writePrefs(scope, { entry: OWN_ID });
      return;
    }
    setSel(e.id);
    if (e.kind === "pivot") {
      setPivotSel(e.id);
      setOrigin(e.id);
      setSettings(entrySettings(e));
    }
    writePrefs(scope, { entry: e.id });
  };
  const onSettings = (s: PivotSettings) => {
    setSettings(s);
    setSel(OWN_ID);
    setPivotSel(OWN_ID);
    writePrefs(scope, { entry: OWN_ID, own: s });
  };
  const onSearch = (h: SearchHit) => {
    if ("entry" in h.open) {
      const e = LIB_BY_ID.get(h.open.entry);
      if (e) pick(e, h.open.focus ?? null);
      return;
    }
    // A table of its own: shown under its search name until a control is
    // changed, which makes it the reader's own table.
    setOrigin(h);
    setFocus(h.open.focus ?? null);
    setLibOpen(false);
    setSearchTitle(h.open.title);
    setSel(SEARCH_ID);
    setPivotSel(SEARCH_ID);
    setSettings(h.open.settings);
  };
  const reset = () => {
    if (typeof origin !== "string") return onSearch(origin);
    const e = LIB_BY_ID.get(origin);
    pick(e && e.kind === "pivot" ? e : LIB_BY_ID.get(DEFAULT_ID)!);
  };

  const visible = LIBRARY.filter((e) => available(e));
  const groups = [...new Set(visible.map((e) => e.group))];
  const title = shown.id === SEARCH_ID ? searchTitle : (shown.entry?.label ?? "Your own table");
  const originName = typeof origin === "string" ? (LIB_BY_ID.get(origin)?.label ?? LIB_BY_ID.get(DEFAULT_ID)!.label) : origin.title;
  const resetTo = shown.id === OWN_ID ? originName : null;
  const wide = shown.kind !== "pivot";
  const showLib = !wide || libOpen;
  const item = (on: boolean) => `w-full rounded-lg px-2.5 py-1.5 text-left ${T.body} ${on ? "bg-primary-soft font-semibold text-ink" : "text-ink-2 hover:text-ink"}`;
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 ${T.ctl} transition-colors ${
      on ? "border-[var(--color-primary)] bg-primary-soft text-primary" : "border-line text-ink-2 hover:border-ink-3"
    }`;

  return (
    <section className="grid gap-5 pb-10">
      <div>
        <h2 className={`${T.h2} mb-1`}>Data</h2>
        <p className={`${T.sec} max-w-[70ch]`}>Ready-made tables for the common questions, and a builder for your own. Any table can be shown as a chart.</p>
      </div>
      <DataSearchBox data={wb.view} brand={brand ?? wb.view?.brand ?? "You"} category={category} onOpen={onSearch} />
      <div className={`grid items-start gap-6 ${showLib && !wide ? "md:grid-cols-[260px_minmax(0,1fr)]" : ""}`}>
        {showLib && (
        <nav
          aria-label="Tables"
          // On a phone the list folds away (it would push the table a screen down).
          className={wide ? "grid gap-1 rounded-xl border border-line p-3 sm:grid-cols-2 lg:grid-cols-3" : libOpen ? "grid gap-1" : "hidden gap-1 md:grid"}
        >
          {!wb.loaded && <p className={`${T.cap} px-2.5 text-ink-3`}>Loading the tables...</p>}
          {groups.map((g, gi) => (
            <div key={g} className="grid content-start gap-0.5">
              <h5 className={`${T.label} px-2.5 ${gi === 0 || wide ? "mt-1" : "mt-3"} mb-0.5`}>{g}</h5>
              {visible
                .filter((e) => e.group === g)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => pick(e)}
                    title={e.desc}
                    aria-current={shown.id === e.id ? "true" : undefined}
                    className={item(shown.id === e.id)}
                  >
                    {e.label}
                  </button>
                ))}
            </div>
          ))}
          {wb.view?.facts && (
            <div className={wide ? "grid content-start gap-0.5" : "mt-3 border-t border-line pt-2"}>
              {wide && <h5 className={`${T.label} mt-1 mb-0.5 px-2.5`}>Your own</h5>}
              <button
                type="button"
                onClick={() => pick(null)}
                title="Choose the questions, rows, columns and numbers yourself. Your last table is kept."
                aria-current={shown.id === OWN_ID ? "true" : undefined}
                className={item(shown.id === OWN_ID)}
              >
                Build your own table
              </button>
            </div>
          )}
        </nav>
        )}
        <div className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className={T.title}>{title}</h3>
            <button
              type="button"
              onClick={() => setLibOpen(!libOpen)}
              aria-expanded={libOpen}
              className={`${T.ctl} text-primary hover:opacity-80 ${wide ? "" : "md:hidden"}`}
            >
              {libOpen ? "Hide the other tables" : "Show the other tables"}
            </button>
          </div>
          {seen.has("pivot") && (
            <div className={shown.kind === "pivot" ? "grid gap-3" : "hidden"}>
              {!wb.loaded ? (
                <div className="card px-6 py-10">
                  <p className="text-sm text-ink-3">Reading the coded answers...</p>
                </div>
              ) : !wb.view?.facts ? (
                <div className="card px-6 py-10">
                  <p className="text-sm text-ink-3">No coded answers to build a table from yet.</p>
                </div>
              ) : (
                <PivotTable
                  runId={runId}
                  data={wb.view}
                  settings={shownSettings}
                  onSettings={onSettings}
                  show={show}
                  onShow={(s) => {
                    setShow(s);
                    writePrefs(scope, { show: s });
                  }}
                  waves={waves}
                  onWaves={(w) => {
                    setWaves(w);
                    writePrefs(scope, { waves: w });
                  }}
                  hasPrev={!!prevId}
                  prevData={prevData}
                  name={title}
                  focus={focus}
                  onClearFocus={() => setFocus(null)}
                  onReset={reset}
                  resetTo={resetTo}
                />
              )}
            </div>
          )}
          {seen.has("contests") && (
            <div className={shown.kind === "contests" ? "grid gap-3" : "hidden"}>
              {map === undefined ? (
                <p className={T.sec}>Reading the coded answers...</p>
              ) : map === null ? (
                <p className={T.sec}>Nothing is measured here yet.</p>
              ) : (
                <TypeTable map={map} category={category} />
              )}
            </div>
          )}
          {seen.has("detail") && (
            <div className={shown.kind === "detail" ? "grid gap-5" : "hidden"}>
              <p className={`${T.sec} max-w-[70ch]`}>The journey question type by question type, with every table behind it. Filter to one buyer below.</p>
              {rooms.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`${T.cap} mr-1 text-ink-3`}>Buyer:</span>
                  {["", ...rooms].map((rk) => (
                    <button key={rk || "__all"} type="button" onClick={() => setRoom(rk)} aria-pressed={room === rk} className={chip(room === rk)}>
                      {rk === "" ? "All buyers" : rk}
                    </button>
                  ))}
                </div>
              )}
              <JourneySection runId={runId} room={room} onRoom={setRoom} onRooms={onRooms} jump={jump} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- By question type ----------

type ColKey = "stand" | "num" | "leader" | "about" | "to" | "away";
interface Facts {
  id: string;
  label: string;
  verdict: CellVerdict;
  /** am27: lost, with an exception. */
  exception?: boolean;
  num: string;
  numLabel: string;
  numTip?: string;
  leader: string;
  about: string;
  to: string;
  away: string;
}

const ROW_NAME: Record<string, string> = { chooses: "Buyer", fights: "Rival", doubts: "Worry", settled: "Question" };
const bandKind = (id: string) => id.split(":")[0];

const themeLine = (ts?: DossierTheme[]) => (ts && ts[0] ? `${ts[0].label} ${ts[0].share}` : "");
function sideLine(themes: DossierTheme[] | undefined, flat: Position["toward"]): string {
  const t = themeLine(themes);
  if (t) return t;
  // "otherwise ..." is the AI's default branch, not a reason: skip it.
  const c = flat.find((x) => !/^otherwise\b/i.test(x.text));
  return c ? `${c.text}${c.share ? ` ${c.share}` : ""}` : "";
}

function factsOf(c: MapCell, p: Position | undefined): Facts {
  const f = p?.figures?.[0];
  const up = p?.lifts.find((l) => l.value > 0);
  const args = p?.argsRows ?? [];
  const about = up
    ? `For you: ${up.label}`
    : p?.argsMode === "rival" && args[0]
      ? `For rivals: ${args[0].label}`
      : args[0]
        ? args[0].label
        : "";
  const lead = p?.brands?.[0];
  return {
    id: c.id,
    label: c.label || "All",
    verdict: c.verdict,
    ...(c.exception ? { exception: true } : {}),
    num: f?.value ?? "",
    numLabel: f?.label ?? "",
    numTip: f?.tip,
    // A contest you hold has no taker: the engine says "Nobody", which under
    // "Who leads" read as if no one led. You lead it.
    leader: lead ? `${lead.name} ${lead.share}` : c.verdict === "yours" && (!p?.taker || p.taker === "Nobody") ? "You" : p?.taker ?? "",
    about,
    to: p ? sideLine(p.towardThemes, p.toward) : "",
    away: p ? sideLine(p.awayThemes, p.away) : "",
  };
}

function TypeTable({ map, category }: { map: AnalysisMapView; category?: string | null }) {
  const cat = catPhrase(category);
  const types = useMemo(
    () =>
      map.bands.flatMap((b) =>
        b.rows
          .filter((r) => r.cells.length > 0)
          .map((r, i) => ({ key: `${b.title}|${r.stage}`, band: b.title, first: i === 0, stage: r.stage, cells: r.cells }))
      ),
    [map]
  );
  const [sel, setSel] = useState<string>(() => types[0]?.key ?? "");
  const st = types.find((t) => t.key === sel) ?? types[0];
  if (!st) return <p className={T.sec}>Nothing is measured here yet.</p>;
  const rows = st.cells.map((c) => factsOf(c, map.positions[c.id]));
  const numHead = rows.find((r) => r.numLabel)?.numLabel || "Your number";
  const COLS: [ColKey, string][] = [
    ["stand", "Standing"],
    ["num", "Your number"],
    ["leader", "Who leads"],
    ["about", `About the ${cat.plural}`],
    ["to", "Sends buyers to you"],
    ["away", "Sends buyers away"],
  ];
  const cols = COLS;
  const head = (k: ColKey, l: string) => (k === "num" ? numHead : l);
  const rowName = ROW_NAME[bandKind(st.cells[0].id)] ?? "Contest";
  const stand = (r: Facts) => (r.exception ? `${VWORD[r.verdict]} - with an exception` : VWORD[r.verdict]);
  const text = (r: Facts, k: ColKey): string => (k === "stand" ? stand(r) : (r[k] as string));
  return (
    // pa-root carries the four verdict colors (the hub's style block).
    <div className="pa-root grid items-start gap-6 md:grid-cols-[190px_minmax(0,1fr)]">
      <nav aria-label="Question types" className="flex flex-wrap gap-0.5 md:flex-col md:flex-nowrap">
        {types.map((t, i) => {
          return (
            <div key={t.key} className="contents">
              {t.first && <h5 className={`${T.label} mb-1 w-full ${i === 0 ? "" : "mt-3"}`}>{t.band}</h5>}
              <button
                type="button"
                onClick={() => setSel(t.key)}
                aria-current={t.key === st.key ? "true" : undefined}
                className={`rounded-lg px-2.5 py-1.5 text-left ${T.body} ${t.key === st.key ? "bg-primary-soft font-semibold text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {t.stage}
              </button>
            </div>
          );
        })}
      </nav>
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className={T.title}>{st.stage}</h3>
          <span className="ml-auto">
            <Download
              name={`${st.stage} - by ${rowName.toLowerCase()}`}
              header={[rowName, ...cols.map(([k, l]) => head(k, l))]}
              rows={() => rows.map((r) => [r.label, ...cols.map(([k]) => text(r, k) || null)])}
            />
          </span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className={`w-full ${T.body}`}>
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-3 py-2.5 font-semibold">{rowName}</th>
                {cols.map(([k, l]) => (
                  <th key={k} className={`px-3 py-2.5 font-semibold ${k === "num" ? "min-w-[9.5rem]" : ""}`}>
                    {head(k, l)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60 align-top last:border-b-0">
                  <td className="min-w-[8rem] px-3 py-2.5 font-semibold text-ink">{r.label}</td>
                  {cols.map(([k]) => (
                    <td key={k} className={`px-3 py-2.5 text-ink-2 ${k === "leader" ? "min-w-[7.5rem]" : k === "about" || k === "to" || k === "away" ? "min-w-[8.5rem]" : ""}`} title={k === "num" ? r.numTip : undefined}>
                      {k === "stand" ? (
                        <span className="flex items-center gap-1.5 whitespace-nowrap font-semibold" style={{ color: VCOLOR[r.verdict].fg }}>
                          <i className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: VCOLOR[r.verdict].fg }} />
                          {stand(r)}
                        </span>
                      ) : k === "num" ? (
                        <b className="whitespace-nowrap font-semibold tabular-nums text-ink">{r.num || "-"}</b>
                      ) : (
                        text(r, k) || <span className="text-ink-3">-</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={`${T.cap} mt-2.5 text-ink-3`}>Each row is one contest on the Map. Open it on the Map for what to do and the answers behind it.</p>
      </div>
    </div>
  );
}
