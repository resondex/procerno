"use client";

import { useEffect, useState, type ReactNode } from "react";
import type {
  ConditionLine,
  InventoryRow,
  JourneyArgument,
  JourneyMetric,
  JourneyPick,
  JourneyStation,
  JourneyView,
  RateCell,
  StationKey,
} from "@/lib/engine/journey";
import { SortTable, Tip, type Col } from "./table";
import { pct, range, rate } from "./view_parts";
import HeadlineSection from "./headline_view";
import PremiumSection from "./premium_view";
import AwarenessSections from "./awareness_view";
import HeadToHeadSection from "./head_to_head_view";
import AlternativesSection from "./alternatives_view";
import DoubtSections from "./doubt_view";
import RepertoireSection from "./repertoire_view";
import ValueSection from "./value_view";
import ReasonsSection from "./reasons_view";
import SettledSections from "./settled_view";

/**
 * Stations - the Analysis home view (RATIFIED 2026-11-01,
 * WORKBENCH_REDESIGN_2026-10-30.md top section). Analysis is COMPLETE: every
 * collected cell has a home here; the other analysis views are lenses.
 *
 * The funnel strip: six station cards of one shape (the buyer's question,
 * one number, the anchor, the number of question kinds), ONE selected at a
 * time, the selected station's full read below - who gets picked, the
 * arguments behind it, you win when / you lose when, the open inventory of
 * every question kind routed to the station (a kind the tracker did not ask
 * is a greyed row), then the per-type sections as the full tables.
 *
 * Stations are independent populations - separate sets of questions with
 * their own answers. The copy never reads them as one buyer's sequence.
 *
 * Surface rule (2026-11-01): no answer counts on cards, headline lines or
 * cells. Counts live in hover ranges, the inventory rows' hover, condition
 * lines (the only honest unit for a condition) and thin-cell warnings.
 *
 * The buyer filter reaches only the room-pinned stations (awareness,
 * consideration, value). Everything asked across all buyers keeps its
 * all-buyers numbers and, under a filter, carries an "all buyers" marker -
 * never hidden, never shown as the room's.
 *
 * Mounting: a station's sections mount the first time it is selected and
 * stay mounted (hidden with CSS), so returning never refetches. Room-aware
 * sections mount once per (station, room) visited.
 */

/** Cells under this many answers are muted, never printed as confident numbers. */
const THIN = 20;

const ALL = "";

const ROOM_AWARE: ReadonlySet<StationKey> = new Set(["awareness", "consideration", "value"]);

const isThin = (c: RateCell) => c.n > 0 && c.n < THIN;
const thinTip = (c: RateCell) => (isThin(c) ? ` - too few answers to read (${c.n})` : "");
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

function ByDesign({ children }: { children?: ReactNode }) {
  return (
    <Tip tip="Measured across all buyers by design - these questions are never asked in one buyer's voice, so the buyer filter does not apply.">
      <span className="inline-block cursor-help rounded bg-neutral-bar/40 px-1.5 py-0.5 text-[11px] font-normal text-ink-3">
        {children ?? "all buyers"}
      </span>
    </Tip>
  );
}

/** A rate with its range on hover; muted when thin. */
function Rate({ c, label, className = "" }: { c: RateCell; label?: string; className?: string }) {
  return (
    <Tip tip={`${label ? `${label}: ` : ""}${range(c)}${thinTip(c)}`}>
      <span className={`cursor-help tabular-nums ${isThin(c) ? "text-ink-3/70" : ""} ${className}`}>{pct(c)}</span>
    </Tip>
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
  const anchor = s.anchor;
  const anchorBody = (() => {
    if (!anchor) return null;
    const c = anchor.cell;
    if (!c) return <>{anchor.text}</>;
    // Wrap the anchor's own number in its range when the text carries it.
    const p = pct(c);
    const at = anchor.text.lastIndexOf(p);
    if (at < 0)
      return (
        <Tip tip={range(c)}>
          <span className="cursor-help">{anchor.text}</span>
        </Tip>
      );
    return (
      <>
        {anchor.text.slice(0, at)}
        <Tip tip={range(c)}>
          <span className="cursor-help tabular-nums">{p}</span>
        </Tip>
        {anchor.text.slice(at + p.length)}
      </>
    );
  })();
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
      <span className="text-[12px] leading-snug text-ink-2">{s.question}</span>
      {lead ? (
        <div className={isThin(lead.cell) ? "opacity-60" : ""}>
          <Tip tip={`${lead.label}: ${range(lead.cell)}${thinTip(lead.cell)}`}>
            <span className="cursor-help text-[1.6rem] leading-tight font-semibold tabular-nums">{pct(lead.cell)}</span>
          </Tip>
          {filtered && lead.invariant && (
            <span className="ml-1.5 align-middle">
              <ByDesign />
            </span>
          )}
        </div>
      ) : (
        <div className="text-[12px] text-ink-3">
          {filtered && ROOM_AWARE.has(s.key) ? "Not asked as this buyer" : "No questions of this kind on this tracker"}
        </div>
      )}
      {anchorBody && <span className="text-[12px] leading-snug text-ink-2">{anchorBody}</span>}
      <span className="text-[11px] text-ink-3">
        {s.kinds} question {s.kinds === 1 ? "kind" : "kinds"}
      </span>
    </button>
  );
}

/** "Picked when one is 16% - picked in 7% of all answers, named in 89%". */
function StationHeading({ s, filtered, onAll }: { s: JourneyStation; filtered: boolean; onAll: () => void }) {
  const lead = s.lead;
  const subs = s.sub;
  return (
    <div className="border-b border-line pb-2 grid gap-1">
      <h2 className="text-[15px] font-semibold">
        {s.label} - {s.question}
      </h2>
      {lead ? (
        <p className="text-[13px] text-ink-2">
          {lead.label} <Rate c={lead.cell} label={lead.label} className="font-semibold text-ink" />
          {filtered && lead.invariant && (
            <span className="ml-1.5">
              <ByDesign />
            </span>
          )}
          {subs.length > 0 && (
            <span className="text-ink-3">
              {" - "}
              {subs.map((m: JourneyMetric, i) => (
                <span key={m.key}>
                  {i > 0 && ", "}
                  {lowerFirst(m.label)} <Rate c={m.cell} label={m.label} />
                  {filtered && m.invariant && !lead.invariant && (
                    <span className="ml-1">
                      <ByDesign />
                    </span>
                  )}
                </span>
              ))}
            </span>
          )}
        </p>
      ) : (
        <p className="text-[13px] text-ink-3">
          {filtered && ROOM_AWARE.has(s.key) ? (
            <>
              Not asked as this buyer.{" "}
              <button type="button" onClick={onAll} className="font-medium text-primary hover:opacity-80">
                See all buyers
              </button>
            </>
          ) : (
            "No questions of this kind on this tracker."
          )}
        </p>
      )}
    </div>
  );
}

function BlockTitle({ children, allBuyers }: { children: ReactNode; allBuyers?: boolean }) {
  return (
    <h3 className="section-label mb-3 flex items-center gap-2">
      <span>{children}</span>
      {allBuyers && <ByDesign />}
    </h3>
  );
}

/** Who gets picked (or, at Comparison, who wins each head-to-head). */
function PicksBlock({ s }: { s: JourneyStation }) {
  const comparison = s.key === "comparison";
  const picks = [...s.picks].sort((a, b) => rate(b.cell) - rate(a.cell));
  const max = Math.max(...picks.map((p) => rate(p.cell)), 0.0001);
  return (
    <div className="card p-5">
      <BlockTitle>{comparison ? "Who wins each head-to-head" : "Who gets picked"}</BlockTitle>
      {comparison && (
        <p className="text-[12px] text-ink-3 mb-3">Your win rate against each named rival, when one of the two is picked.</p>
      )}
      <div className="grid gap-1.5">
        {picks.map((p: JourneyPick) => {
          const you = p.role === "target";
          return (
            <div
              key={`${p.role}:${p.name}`}
              className={`grid grid-cols-[11rem_1fr_3.5rem] items-center gap-3 ${isThin(p.cell) ? "opacity-60" : ""}`}
            >
              <span className={`truncate text-sm text-right ${you ? "font-semibold text-primary" : "text-ink-2"}`}>
                {comparison ? `vs ${p.name}` : p.name}
              </span>
              <div className="h-4 relative">
                <div
                  className={`absolute inset-y-0 left-0 rounded-r-[4px] ${you ? "bg-primary" : "bg-neutral-bar"}`}
                  style={{ width: `${(rate(p.cell) / max) * 100}%` }}
                />
              </div>
              <span className="text-sm text-ink-2">
                <Rate c={p.cell} label={comparison ? `You win vs ${p.name}` : p.name} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The arguments behind it: up to 4 lines, "for you" / "against". */
function ArgumentsBlock({ s, filtered }: { s: JourneyStation; filtered: boolean }) {
  const lines = s.arguments.slice(0, 4);
  return (
    <div className="card p-5">
      <BlockTitle allBuyers={filtered && s.unfiltered.includes("arguments")}>The arguments behind it</BlockTitle>
      <ul className="grid gap-2">
        {lines.map((a: JourneyArgument) => (
          <li key={a.code} className="flex flex-wrap items-baseline gap-2 text-[13px]">
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                a.forYou ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
              }`}
            >
              {a.forYou ? "for you" : "against"}
            </span>
            <span className="font-medium text-ink">{a.code}</span>
            <span className="text-ink-3">
              in <Rate c={a.inYourPicks} label="Answers that pick you arguing it" /> of your picks,{" "}
              <Rate c={a.inRivalPicks} label="Answers that pick a rival arguing it" /> of rivals&apos;
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConditionList({ title, lines, lose }: { title: string; lines: ConditionLine[]; lose: boolean }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-ink mb-2">{title}</div>
      {lines.length === 0 ? (
        <p className="text-[12px] text-ink-3">No conditions stated here.</p>
      ) : (
        <ul className="grid gap-1.5">
          {lines.slice(0, 3).map((c) => (
            <li key={c.label} className="text-[13px] text-ink-2">
              {c.label} <span className="text-[11px] text-ink-3 tabular-nums">{c.answers}</span>
              {lose && c.routes.length > 0 && (
                <span className="text-[12px] text-ink-3"> {"->"} {c.routes.join(", ")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConditionsBlock({ s, filtered }: { s: JourneyStation; filtered: boolean }) {
  return (
    <div className="card p-5">
      <BlockTitle allBuyers={filtered && s.unfiltered.includes("conditions")}>When the pick goes your way</BlockTitle>
      <div className="grid md:grid-cols-2 gap-5">
        <ConditionList title="You win when the buyer" lines={s.conditions.win} lose={false} />
        <ConditionList title="You lose when the buyer" lines={s.conditions.lose} lose />
      </div>
      <p className="mt-3 text-[11px] text-ink-3">The small number is how many answers state the condition.</p>
    </div>
  );
}

/** Everything measured at this station - the open inventory (decision 1: LISTED). */
function InventoryBlock({ s, filtered }: { s: JourneyStation; filtered: boolean }) {
  const muted = (r: InventoryRow) => !r.asked || r.answers < THIN;
  const cols: Col<InventoryRow>[] = [
    {
      id: "kind",
      label: "Question kind",
      val: (r) => r.label,
      render: (r) => (
        <span className={muted(r) ? "text-ink-3" : ""}>
          <Tip tip={r.asked ? `${r.answers} answers${r.answers < THIN ? " - too few to read" : ""}` : "Not asked on this tracker"}>
            <span className="cursor-help">{r.label}</span>
          </Tip>
          {filtered && r.invariant && r.asked && (
            <span className="ml-1.5">
              <ByDesign />
            </span>
          )}
        </span>
      ),
    },
    {
      id: "reads",
      label: "Reads as",
      val: (r) => r.readsAs,
      render: (r) => <span className={muted(r) ? "text-ink-3" : "text-ink-2"}>{r.readsAs}</span>,
    },
    {
      id: "you",
      label: "You",
      num: true,
      val: (r) => (r.you && r.you.n > 0 ? Math.round(rate(r.you) * 100) : null),
      render: (r) =>
        r.you && r.you.n > 0 ? (
          <Rate c={r.you} label={r.label} className={muted(r) ? "text-ink-3" : ""} />
        ) : (
          <span className="text-ink-3">-</span>
        ),
    },
    {
      id: "beside",
      label: "Beside it",
      val: (r) => r.beside,
      render: (r) => <span className={muted(r) ? "text-ink-3" : "text-ink-2"}>{r.beside}</span>,
    },
    { id: "answers", label: "Answers", csvOnly: true, num: true, val: (r) => r.answers },
  ];
  return (
    <div className="card p-5">
      <BlockTitle>Everything measured at this station</BlockTitle>
      {s.inventory.length === 0 ? (
        <p className="text-[12px] text-ink-3">No question kinds route here.</p>
      ) : (
        <SortTable
          cols={cols}
          rows={s.inventory}
          filename={`station_${s.key}.csv`}
          // Engine order (asked kinds first as the engine lists them) until a header is clicked.
          defaultSort={{ id: "__none", dir: 1 }}
        />
      )}
    </div>
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
          <ReasonsSection runId={runId} room={room} types={["headline", "headline:discovery", "headline:use_case", "headline:social_validation", "criteria_taught"]} initialType="criteria_taught" />
        </>
      );
    case "value":
      return (
        <>
          <ValueSection runId={runId} room={room} />
          <ReasonsSection runId={runId} room={room} types={["value"]} />
        </>
      );
    default:
      return null;
  }
}

/** The sections asked across all buyers, mounted once per station. */
function invariantBody(key: StationKey, runId: string): ReactNode {
  switch (key) {
    case "awareness":
      return <AwarenessSections runId={runId} only="explainer" />;
    case "consideration":
      return <PremiumSection runId={runId} />;
    case "comparison":
      return (
        <>
          <HeadToHeadSection runId={runId} />
          <AlternativesSection runId={runId} only="offensive" />
          <ReasonsSection runId={runId} types={["head_to_head_entity", "head_to_head_class", "offensive_capture"]} />
        </>
      );
    case "doubts":
      return (
        <>
          <DoubtSections runId={runId} only="objections" />
          <ReasonsSection runId={runId} types={["doubt"]} />
        </>
      );
    case "customer_base":
      return (
        <>
          <DoubtSections runId={runId} only="customers" />
          <AlternativesSection runId={runId} only="defensive" />
          <RepertoireSection runId={runId} />
          <SettledSections runId={runId} />
          <ReasonsSection runId={runId} types={["keep_or_leave", "defensive_hold", "repertoire"]} />
        </>
      );
    default:
      return null;
  }
}

/**
 * Controlled by the Analysis navigation: the buyer bar lives in run_results
 * (global to the lenses), so `room` comes in as a prop ("" = all buyers) and
 * the rooms list goes back up through `onRooms` once a payload lands.
 */
export default function JourneySection({
  runId,
  room,
  onRoom,
  onRooms,
}: {
  runId: string;
  room: string;
  onRoom: (room: string) => void;
  onRooms?: (rooms: string[]) => void;
}) {
  const roomKey = room;
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
        if (!r.ok) throw new Error(`stations view failed (${r.status})`);
        const d = (await r.json()) as { view: JourneyView | null };
        if (!live) return;
        setViews((v) => ({ ...v, [roomKey]: d.view }));
        if (d.view) onRooms?.(d.view.rooms);
      })
      .catch((e: Error) => live && setErrors((x) => ({ ...x, [roomKey]: e.message })));
    return () => {
      live = false;
    };
  }, [runId, roomKey, loaded, onRooms]);

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
    requestAnimationFrame(() => document.getElementById(`journey-${s}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  // Fall back to the all-buyers payload while a room loads.
  const view = views[roomKey];
  const error = errors[roomKey];
  const filtered = roomKey !== ALL;

  // The strip always has one station open. Until the user picks one, the
  // selection is DERIVED - Consideration (the headline read), else the
  // first station with questions - so no state is set from an effect.
  const stations = (view ?? views[ALL])?.stations;
  const effSelected =
    selected ??
    (stations
      ? (stations.find((s) => s.key === "consideration" && s.lead) ?? stations.find((s) => s.lead) ?? stations[0])?.key ?? null
      : null);

  // A buyer picked from the global bar keeps the open station's sections for
  // the room it leaves mounted (returning never refetches). Adjusted during
  // render - React's pattern for state derived from a changed prop - so no
  // effect sets state.
  const [seenRoom, setSeenRoom] = useState(roomKey);
  if (seenRoom !== roomKey) {
    setSeenRoom(roomKey);
    if (effSelected) mountFor([effSelected], seenRoom);
  }

  if (view === null) return null;

  return (
    <div className="grid gap-5">
      <section className="card p-6 grid gap-3">
        <div>
          <h2 className="section-label mb-1">
            <Tip tip="Each station is its own set of questions asked of its own answers. The numbers sit side by side - they are not steps one buyer takes, and none is a share of another.">
              <span className="cursor-help">Stations - where you stand with buyers</span>
            </Tip>
          </h2>
          <p className="text-[13px] text-ink-3">
            Six kinds of buying moment, each with one number - pick a station for everything measured there.
          </p>
        </div>
      </section>

      {error && <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>}
      {!view && !error && <div className="card px-5 py-4 text-[13px] text-ink-3">Loading the stations...</div>}
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
          const hasConditions = s.conditions.win.length > 0 || s.conditions.lose.length > 0;
          return (
            <section key={s.key} id={`journey-${s.key}`} className={effSelected === s.key ? "grid gap-5 scroll-mt-4" : "hidden"}>
              <StationHeading s={s} filtered={filtered} onAll={() => onRoom(ALL)} />
              {s.picks.length > 0 && <PicksBlock s={s} />}
              {s.arguments.length > 0 && <ArgumentsBlock s={s} filtered={filtered} />}
              {hasConditions && <ConditionsBlock s={s} filtered={filtered} />}
              <InventoryBlock s={s} filtered={filtered} />

              <div className="section-label text-ink-3 pt-2">Full tables</div>
              {aware &&
                roomsMounted.map((rk) => (
                  <div key={rk || "__all"} className={rk === roomKey ? "grid gap-5" : "hidden"}>
                    {roomAware(s.key, runId, rk)}
                  </div>
                ))}
              {filtered && s.key !== "value" && (
                <div>
                  <ByDesign>{aware ? "below: all buyers" : "all buyers"}</ByDesign>
                </div>
              )}
              {invariantBody(s.key, runId)}
            </section>
          );
        })}
    </div>
  );
}
