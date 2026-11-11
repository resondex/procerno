"use client";

import { useCallback, useMemo, useState } from "react";
import type { AnalysisMapView, CellVerdict, MapCell, Position } from "@/lib/engine/analysis_types";
import type { DossierTheme } from "@/lib/engine/reason_themes";
import JourneySection from "./journey_view";
import { MetricsSection } from "./metrics_view";
import { catPhrase, VCOLOR, VWORD } from "./analysis_panel";
import { Download } from "./table";
import { T } from "./type_scale";

/**
 * The Data page (2026-11-10, the analysis redesign; rebuilt the same day as
 * the prototype's typeTable): the quiet analyst tier. Three tabs:
 *
 * - By question type: every question type down the left, grouped by the Map's
 *   bands; the selected type as a table, one row per contest, switchable
 *   columns, each row opening the same slide-over. Built entirely from the
 *   /analysis_map payload the hub already loaded - no request of its own, so
 *   it renders instantly.
 * - Build a table: the metrics pivot (its own fetch, on first open).
 * - Station detail: the old Stations read with its buyer filter (its own
 *   fetches, on first open). The brief's "journey" links land here.
 *
 * The slow tabs mount on first visit and stay mounted, so switching never
 * refetches.
 */

export type DataTab = "types" | "build" | "stations";

export default function DataPage({
  runId,
  map,
  category,
  onOpen,
  tab,
  onTab,
  jump,
}: {
  runId: string;
  /** The hub's map payload: undefined while it loads, null when there is none. */
  map: AnalysisMapView | null | undefined;
  category?: string | null;
  /** Opens a contest in the slide-over. */
  onOpen: (cellId: string) => void;
  tab: DataTab;
  onTab: (t: DataTab) => void;
  /** The brief's request to open a station (its by-assistant table); `n` makes a repeat click a new request. */
  jump?: { station: "consideration"; n: number };
}) {
  const [room, setRoom] = useState("");
  const [rooms, setRooms] = useState<string[]>([]);
  const onRooms = useCallback(
    (rs: string[]) => setRooms((prev) => (prev.length === rs.length && prev.every((r, i) => r === rs[i]) ? prev : rs)),
    []
  );
  const [seen, setSeen] = useState<Set<DataTab>>(() => new Set([tab]));
  if (!seen.has(tab)) setSeen(new Set(seen).add(tab));
  const seg = (on: boolean, quiet = false) =>
    `rounded-full px-4 py-1 text-[13px] ${on ? "bg-primary-soft font-semibold text-ink" : `${quiet ? "text-ink-3/80" : "text-ink-3"} hover:text-ink-2`}`;
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 ${T.ctl} transition-colors ${
      on ? "border-[var(--color-primary)] bg-primary-soft text-primary" : "border-line text-ink-2 hover:border-ink-3"
    }`;
  return (
    <section className="grid gap-5 pb-10">
      <div>
        <h2 className={`${T.h2} mb-1`}>Data</h2>
        <p className={`${T.sec} max-w-[70ch]`}>
          For analysts. Every question type as a table, and a builder for your own. Nothing here is needed to read the wave.
        </p>
      </div>
      <div className="inline-flex max-w-full flex-wrap justify-self-start rounded-full border border-line bg-surface p-[3px]" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "types"} className={seg(tab === "types")} onClick={() => onTab("types")}>
          By question type
        </button>
        <button type="button" role="tab" aria-selected={tab === "build"} className={seg(tab === "build")} onClick={() => onTab("build")}>
          Build a table
        </button>
        <button type="button" role="tab" aria-selected={tab === "stations"} className={seg(tab === "stations", true)} onClick={() => onTab("stations")}>
          Station detail
        </button>
      </div>
      {tab === "types" &&
        (map === undefined ? (
          <p className={T.sec}>Reading the coded answers...</p>
        ) : map === null ? (
          <p className={T.sec}>Nothing is measured here yet.</p>
        ) : (
          <TypeTable map={map} category={category} onOpen={onOpen} />
        ))}
      {seen.has("build") && (
        <div className={tab === "build" ? "grid gap-5" : "hidden"}>
          <MetricsSection runId={runId} />
        </div>
      )}
      {seen.has("stations") && (
        <div className={tab === "stations" ? "grid gap-5" : "hidden"}>
          <p className={`${T.sec} max-w-[70ch]`}>The journey station by station, with every table behind it. Filter to one buyer below.</p>
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
    </section>
  );
}

// ---------- By question type ----------

type ColKey = "stand" | "num" | "leader" | "about" | "to" | "away";
interface Facts {
  id: string;
  label: string;
  verdict: CellVerdict;
  num: string;
  numLabel: string;
  numTip?: string;
  leader: string;
  about: string;
  to: string;
  away: string;
  open: boolean;
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
    num: f?.value ?? "",
    numLabel: f?.label ?? "",
    numTip: f?.tip,
    // A contest you hold has no taker: the engine says "Nobody", which under
    // "Who leads" read as if no one led. You lead it.
    leader: lead ? `${lead.name} ${lead.share}` : c.verdict === "yours" && (!p?.taker || p.taker === "Nobody") ? "You" : p?.taker ?? "",
    about,
    to: p ? sideLine(p.towardThemes, p.toward) : "",
    away: p ? sideLine(p.awayThemes, p.away) : "",
    open: !!p,
  };
}

function TypeTable({ map, category, onOpen }: { map: AnalysisMapView; category?: string | null; onOpen: (id: string) => void }) {
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
  const text = (r: Facts, k: ColKey): string => (k === "stand" ? VWORD[r.verdict] : (r[k] as string));
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
                <th className="px-3 py-2.5" aria-label="Open" />
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
                          {VWORD[r.verdict]}
                        </span>
                      ) : k === "num" ? (
                        <b className="whitespace-nowrap font-semibold tabular-nums text-ink">{r.num || "-"}</b>
                      ) : (
                        text(r, k) || <span className="text-ink-3">-</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right">
                    {r.open && (
                      <button type="button" onClick={() => onOpen(r.id)} className="whitespace-nowrap text-primary underline underline-offset-2 hover:opacity-80">
                        Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={`${T.cap} mt-2.5 text-ink-3`}>Each row is one contest on the Map. Open shows what to do and the answers behind it.</p>
      </div>
    </div>
  );
}
