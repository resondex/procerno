"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { JourneyMetric, JourneyStation, JourneyView, StationKey } from "@/lib/engine/journey";
import { Tip } from "./table";
import { pct, range } from "./view_parts";
import HeadlineSection from "./headline_view";
import PremiumSection from "./premium_view";
import AwarenessSections from "./awareness_view";
import HeadToHeadSection from "./head_to_head_view";
import AlternativesSection from "./alternatives_view";
import DoubtSections from "./doubt_view";
import RepertoireSection from "./repertoire_view";
import ValueSection from "./value_view";
import ReasonsSection from "./reasons_view";

/**
 * The Journey (2026-10-30, WORKBENCH_REDESIGN_2026-10-30.md item 1): the
 * six-station map with each station's leak number, a buyer filter, and each
 * station opening into the existing per-type sections it groups.
 *
 * Stations are independent populations - separate sets of questions with
 * their own answers. The copy never reads them as one buyer's sequence.
 *
 * The buyer filter reaches only the room-pinned sections (headline,
 * awareness problem recognition, value, criteria via reasons). Everything
 * asked across all buyers keeps its all-buyers numbers and, under a filter,
 * carries a "measured across all buyers by design" marker - never hidden,
 * never shown as the room's.
 *
 * Layout (Tyler's pick, 2026-10-30): the funnel strip - six compact
 * station cards across the top as the persistent map, ONE selected at a
 * time, the selected station's full read filling the page below.
 *
 * Mounting: a station's sections mount the first time it is selected and
 * stay mounted (hidden with CSS) when another is picked, so returning
 * never refetches. Room-aware sections mount once per (station, room)
 * visited; the all-buyers sections mount once per station.
 *
 * Two shared components draw two stations' cards at once and are not split
 * here: DoubtSections renders buyers' worries AND customers' worries (shown
 * in Doubts), AlternativesSection renders rival leavers AND holding your own
 * (shown in Comparison). Customer base points to both rather than drawing
 * them twice. The engine filter is deferred.
 */

/** Cells under this many answers are muted, never printed as confident numbers. */
const THIN = 20;

const ALL = "";

const QUESTION: Record<StationKey, string> = {
  awareness: "Someone with a problem, or new to the category - does the AI point them to it, and to you?",
  consideration: "Asked which to get, with no brand named - are you named, and picked?",
  comparison: "Put head to head with a rival, or asked by a rival's leavers - who gets the pick?",
  doubts: "A buyer voices a worry about you - does the AI say go ahead?",
  value: "Is your line worth it over a cheaper option, for this buyer?",
  customer_base: "A customer voices a worry or weighs a move - does the AI tell them to stay?",
};

const thin = (m: JourneyMetric) => m.cell.n > 0 && m.cell.n < THIN;

function ByDesign({ children }: { children?: ReactNode }) {
  return (
    <span className="inline-block rounded bg-neutral-bar/40 px-1.5 py-0.5 text-[11px] font-normal text-ink-3">
      {children ?? "all buyers by design"}
    </span>
  );
}

function MetricLine({ m, filtered }: { m: JourneyMetric; filtered: boolean }) {
  return (
    <li className={`flex items-baseline justify-between gap-2 text-[12px] ${thin(m) ? "text-ink-3/70" : "text-ink-2"}`}>
      <span>
        {m.label}
        {filtered && m.invariant && (
          <span className="ml-1.5">
            <ByDesign>all buyers</ByDesign>
          </span>
        )}
      </span>
      <Tip tip={`${range(m.cell)}${thin(m) ? " - too few answers to read" : ""}`}>
        <span className="cursor-help tabular-nums">{pct(m.cell)}</span>
      </Tip>
    </li>
  );
}

/** One cell of the funnel strip: the persistent map across the top. */
function StationCard({
  s,
  filtered,
  selected,
  onSelect,
}: {
  s: JourneyStation;
  filtered: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const lead = s.lead;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`card p-3.5 text-left grid gap-1.5 content-start transition-colors ${
        selected ? "border-[var(--color-primary)] bg-primary-soft/30" : "hover:border-ink-3"
      }`}
    >
      <span className={`section-label ${selected ? "text-primary" : ""}`}>{s.label}</span>
      {lead ? (
        <div className={thin(lead) ? "opacity-60" : ""}>
          <Tip tip={`${range(lead.cell)}${thin(lead) ? " - too few answers to read" : ""}`}>
            <span className="cursor-help text-[1.6rem] leading-tight font-semibold tabular-nums">{pct(lead.cell)}</span>
          </Tip>
          <div className="text-[11px] leading-snug text-ink-2">
            {lead.label}
            {filtered && lead.invariant && (
              <span className="ml-1">
                <ByDesign>all buyers</ByDesign>
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-ink-3">
          {filtered ? "Not asked as this buyer." : "No questions of this kind here."}
        </div>
      )}
      {s.metrics.length > 0 && (
        <ul className="grid gap-0.5 border-t border-line pt-1.5">
          {s.metrics.slice(0, 2).map((m) => (
            <MetricLine key={m.key} m={m} filtered={filtered} />
          ))}
          {s.metrics.length > 2 && (
            <li className="text-[11px] text-ink-3">+ {s.metrics.length - 2} more in the read below</li>
          )}
        </ul>
      )}
      <span className="text-[11px] text-ink-3">
        {lead ? (thin(lead) ? `Thin - ${lead.cell.n} answers` : `${lead.cell.n} answers`) : ""}
      </span>
    </button>
  );
}

/** The sections a room filter reaches, for one (station, room). */
function roomAware(key: StationKey, runId: string, roomKey: string): ReactNode {
  const room = roomKey === ALL ? undefined : roomKey;
  switch (key) {
    case "awareness":
      return <AwarenessSections runId={runId} room={room} only="routing" />;
    case "consideration":
      return (
        <>
          <HeadlineSection runId={runId} room={room} />
          {/* Criteria is depth with no leak number: the arguments table opens on criteria taught. */}
          <ReasonsSection runId={runId} room={room} initialType="criteria_taught" />
        </>
      );
    case "value":
      return <ValueSection runId={runId} room={room} />;
    default:
      return null;
  }
}

/** The sections asked across all buyers, mounted once per station. */
function invariantBody(key: StationKey, runId: string, jump: (to: StationKey) => void): ReactNode {
  const pointer = (to: StationKey, text: string) => (
    <button
      type="button"
      onClick={() => jump(to)}
      className="text-left text-primary underline decoration-primary/40 decoration-dotted underline-offset-2 hover:decoration-primary"
    >
      {text}
    </button>
  );
  switch (key) {
    case "awareness":
      return <AwarenessSections runId={runId} only="explainer" />;
    case "consideration":
      return <PremiumSection runId={runId} />;
    case "comparison":
      return (
        <>
          <HeadToHeadSection runId={runId} />
          <p className="text-[12px] text-ink-3">
            The rival leavers card below belongs here. The card after it - your own customers weighing a move - is a
            Customer base measurement, drawn here because one section reads both.
          </p>
          <AlternativesSection runId={runId} />
        </>
      );
    case "doubts":
      return (
        <>
          <p className="text-[12px] text-ink-3">
            Buyers&apos; worries come first. The customers&apos; worries card after it is the Customer base station&apos;s
            number, drawn here because one section reads both.
          </p>
          <DoubtSections runId={runId} />
        </>
      );
    case "customer_base":
      return (
        <>
          <div className="card px-5 py-4 grid gap-1 text-[13px] text-ink-2">
            <span>{pointer("doubts", "Customers' worries - stay or leave, per worry - open in the Doubts drill")}</span>
            <span>{pointer("comparison", "Your customers weighing a move - open in the Comparison drill")}</span>
            <span className="text-[12px] text-ink-3">
              Business case, expansion, ecosystem and advocacy have no view of their own yet; their arguments are in the
              reasons table under Consideration (pick the question type).
            </span>
          </div>
          <RepertoireSection runId={runId} />
        </>
      );
    default:
      return null;
  }
}

const ROOM_AWARE: ReadonlySet<StationKey> = new Set(["awareness", "consideration", "value"]);

export default function JourneySection({ runId }: { runId: string }) {
  const [roomKey, setRoomKey] = useState<string>(ALL);
  const [views, setViews] = useState<Record<string, JourneyView | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** The one station whose full read fills the page (the funnel-strip rule). */
  const [selected, setSelected] = useState<StationKey | null>(null);
  /** Stations ever selected -> rooms their room-aware sections were mounted for. */
  const [mounted, setMounted] = useState<Map<StationKey, string[]>>(() => new Map());

  const loaded = roomKey in views;
  useEffect(() => {
    if (loaded) return;
    let live = true;
    const q = roomKey === ALL ? "" : `?room=${encodeURIComponent(roomKey)}`;
    fetch(`/api/runs/${runId}/journey${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`journey view failed (${r.status})`);
        const d = (await r.json()) as { view: JourneyView | null };
        if (live) setViews((v) => ({ ...v, [roomKey]: d.view }));
      })
      .catch((e: Error) => live && setErrors((x) => ({ ...x, [roomKey]: e.message })));
    return () => {
      live = false;
    };
  }, [runId, roomKey, loaded]);

  const mountFor = (stations: Iterable<StationKey>, rk: string) =>
    setMounted((prev) => {
      const next = new Map(prev);
      for (const s of stations) {
        const rooms = next.get(s) ?? [];
        if (!rooms.includes(rk)) next.set(s, [...rooms, rk]);
      }
      return next;
    });

  const select = (s: StationKey) => {
    setSelected(s);
    mountFor([s], roomKey);
  };

  const jump = (s: StationKey) => {
    select(s);
    requestAnimationFrame(() => document.getElementById(`journey-${s}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // The rooms list rides every payload; fall back to the all-buyers one while a room loads.
  const view = views[roomKey];
  const rooms = (view ?? views[ALL])?.rooms ?? [];
  const error = errors[roomKey];
  const filtered = roomKey !== ALL;

  // The strip always has one station open. Until the user picks one, the
  // selection is DERIVED - Consideration (the headline read), else the
  // first station with questions - so no state is set from an effect; its
  // sections mount through the same derivation below.
  const stations = (view ?? views[ALL])?.stations;
  const effSelected =
    selected ??
    (stations
      ? (stations.find((s) => s.key === "consideration" && s.lead) ?? stations.find((s) => s.lead) ?? stations[0])?.key ?? null
      : null);

  const pickRoom = (rk: string) => {
    setRoomKey(rk);
    // The open station mounts the new room's sections now; the rest wait
    // until they are selected under it.
    if (effSelected) mountFor([effSelected], rk);
  };

  if (view === null) return null;

  return (
    <div className="grid gap-5">
      <section className="card p-6 grid gap-3">
        <div>
          <h2 className="section-label mb-1">Journey - where the answers lose your buyers</h2>
          <p className="text-[13px] text-ink-3">
            Six stations, each its own set of questions asked of its own answers. The numbers sit side by side - they are
            not steps one buyer takes, and none is a share of another. Open a station for its full read.
          </p>
        </div>
        {rooms.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-ink-3 mr-1">Buyer:</span>
            {[ALL, ...rooms].map((rk) => (
              <button
                key={rk || "__all"}
                type="button"
                onClick={() => pickRoom(rk)}
                className={`rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
                  roomKey === rk
                    ? "border-[var(--color-primary)] bg-primary-soft text-primary"
                    : "border-line text-ink-2 hover:border-ink-3"
                }`}
              >
                {rk === ALL ? "All buyers" : rk}
              </button>
            ))}
          </div>
        )}
        {filtered && (
          <p className="text-[12px] text-ink-3">
            Filtered to one buyer: awareness problem recognition, consideration (discovery and use-case fit, criteria) and
            value. The rest is never asked in one buyer&apos;s voice, so it shows the all-buyers numbers, marked as such. One
            buyer on one engine is about ten answers - read thin cells as direction only.
          </p>
        )}
      </section>

      {error && <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>}
      {!view && !error && <div className="card px-5 py-4 text-[13px] text-ink-3">Loading the journey...</div>}
      {view && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {view.stations.map((s) => (
            <StationCard key={s.key} s={s} filtered={filtered} selected={effSelected === s.key} onSelect={() => select(s.key)} />
          ))}
        </div>
      )}

      {(view ?? views[ALL])?.stations
        .filter((s) => mounted.has(s.key) || s.key === effSelected)
        .map((s) => {
          // The derived default mounts for the current room without a click.
          const roomsMounted = [
            ...new Set([...(mounted.get(s.key) ?? []), ...(s.key === effSelected ? [roomKey] : [])]),
          ];
          const aware = ROOM_AWARE.has(s.key);
          return (
            <section key={s.key} id={`journey-${s.key}`} className={effSelected === s.key ? "grid gap-5 scroll-mt-4" : "hidden"}>
              <div className="border-b border-line pb-2">
                <h2 className="text-[15px] font-semibold">{s.label} - the full read</h2>
                <p className="text-[12px] text-ink-3">{QUESTION[s.key]}</p>
              </div>
              {aware &&
                roomsMounted.map((rk) => (
                  <div key={rk || "__all"} className={rk === roomKey ? "grid gap-5" : "hidden"}>
                    {roomAware(s.key, runId, rk)}
                  </div>
                ))}
              {filtered && s.key !== "value" && (
                <div>
                  <ByDesign>
                    {aware
                      ? "Below: measured across all buyers by design - the buyer filter does not apply"
                      : "Measured across all buyers by design - the buyer filter does not apply"}
                  </ByDesign>
                </div>
              )}
              {invariantBody(s.key, runId, jump)}
            </section>
          );
        })}
    </div>
  );
}
