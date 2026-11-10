"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useParams } from "next/navigation";
import type {
  InventoryRow,
  JourneyArgument,
  JourneyMetric,
  JourneyPick,
  JourneyStation,
  JourneyView,
  RateCell,
  StationKey,
  StationReasonSide,
} from "@/lib/engine/journey";
import { SortTable, Tip, type Col } from "./table";
import { pct, range, rate, ReasonList, useEngineSet, viewQuery } from "./view_parts";
import EvidencePanel, { EVIDENCE_CAP, type EvidenceRequest } from "./evidence_panel";
import { argumentsSentence, capFirst, REASON_COPY, reasonsSentence } from "./station_copy";
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
 * time, the selected station's full read below - the same three blocks on
 * every station in its own terms (who it routes to, the arguments behind its
 * verdict, the reasons on each side of it; StationBlocks), the open inventory of
 * every question kind routed to the station (a kind the tracker did not ask
 * is a greyed row), then the per-type sections as the full tables.
 *
 * Stations are independent populations - separate sets of questions with
 * their own answers. The copy never reads them as one buyer's sequence.
 *
 * Surface rule (2026-11-01): no answer counts on cards, headline lines or
 * cells. Counts live in hover ranges, the inventory rows' hover and
 * thin-cell warnings.
 *
 * j5 (2026-11-10, Stations option B + A's sweep): the arguments and reasons
 * blocks speak the Map panel's grammar - the lift line (bar from the center,
 * the point gap, the two shares beneath), and ReasonList over the run's dt4
 * themes scoped to the station, answer-grain shares with their one base note,
 * the "See every reason" fold to every stated reason with where it sends the
 * buyer, and receipts on the shares (the evidence drawer). A Summary/Detail
 * view control (saved per project) folds those two blocks to one sentence
 * each; a folded block opens in place on a click.
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

/** Who the station routes to, in its own terms (the station names the block). */
function PicksBlock({ s, filtered }: { s: JourneyStation; filtered: boolean }) {
  const comparison = s.key === "comparison";
  const picks = [...s.picks].sort((a, b) => rate(b.cell) - rate(a.cell));
  const max = Math.max(...picks.map((p) => rate(p.cell)), 0.0001);
  return (
    <div className="card p-5">
      <BlockTitle allBuyers={filtered && s.unfiltered.includes("picks")}>{s.picksLabel}</BlockTitle>
      <p className="text-[12px] text-ink-3 mb-3">{s.picksNote}</p>
      {picks.length === 0 ? (
        <p className="text-[12px] text-ink-3">No brands to show here.</p>
      ) : (
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
      )}
    </div>
  );
}

// ---------- the reasons and the arguments (j5, 2026-11-10: Stations option B) ----------

/** Summary or detail for the two blocks, saved per project. */
type BlockMode = "summary" | "detail";
const MODE_EVENT = "procerno-station-mode";
const memMode = new Map<string, BlockMode>();
const modeKey = (scope: string) => `procerno_station_mode:${scope}`;
function readMode(scope: string): BlockMode {
  try {
    return window.localStorage.getItem(modeKey(scope)) === "summary" ? "summary" : "detail";
  } catch {
    return memMode.get(scope) ?? "detail";
  }
}
function subscribeMode(cb: () => void) {
  window.addEventListener(MODE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(MODE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function useBlockMode(scope: string): [BlockMode, (m: BlockMode) => void] {
  const mode = useSyncExternalStore(
    subscribeMode,
    () => readMode(scope),
    () => "detail" as BlockMode
  );
  const set = (m: BlockMode) => {
    memMode.set(scope, m);
    try {
      if (m === "detail") window.localStorage.removeItem(modeKey(scope));
      else window.localStorage.setItem(modeKey(scope), m);
    } catch {
      // storage blocked: memMode carries the choice for this page view
    }
    window.dispatchEvent(new Event(MODE_EVENT));
  };
  return [mode, set];
}

function ModeToggle({ mode, onMode }: { mode: BlockMode; onMode: (m: BlockMode) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[12px]">
      <span className="mr-0.5 text-ink-3">Reasons and arguments:</span>
      {(["summary", "detail"] as BlockMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onMode(m)}
          aria-pressed={mode === m}
          className={`rounded-full border px-2 py-0.5 transition-colors ${
            mode === m ? "border-[var(--color-primary)] bg-primary-soft text-primary" : "border-line text-ink-2 hover:border-ink-3"
          }`}
        >
          {m === "summary" ? "Summary" : "Detail"}
        </button>
      ))}
    </div>
  );
}

/** A block in summary mode: its sentence, expanding in place on a click. */
function Folded({ sentence, onExpand }: { sentence: string; onExpand: () => void }) {
  return (
    <button type="button" onClick={onExpand} className="block w-full text-left">
      <span className="text-[13.5px] leading-relaxed text-ink">{sentence}</span>{" "}
      <span className="whitespace-nowrap text-[11.5px] text-ink-3 hover:text-ink-2">Show the detail ▸</span>
    </button>
  );
}

const FOR_COLOR = "var(--color-success)";
const AGAINST_COLOR = "var(--color-danger)";

/** The Map panel's lift line: a bar from the center (for you right, against
 * left), the point gap, and the two shares beneath; counts in the tip. */
function LiftLines({ args, sides }: { args: JourneyArgument[]; sides: [string, string] }) {
  const rows = args.map((a) => ({ a, value: Math.round((rate(a.inYourPicks) - rate(a.inRivalPicks)) * 100) }));
  const max = Math.max(10, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="grid gap-0.5">
      {rows.map(({ a, value }) => {
        const w = (Math.min(Math.abs(value), max) / max) * 50;
        const thin = isThin(a.inYourPicks) || isThin(a.inRivalPicks);
        return (
          <div
            key={a.code}
            className={`grid grid-cols-[minmax(7.5rem,1fr)_1fr_2.75rem] items-center gap-x-2.5 gap-y-0.5 text-[13px] ${thin ? "opacity-60" : ""}`}
          >
            <span className="text-ink">{a.code}</span>
            <div className="relative h-2.5" aria-hidden>
              <span className="absolute inset-y-[-2px] left-1/2 w-px bg-line" />
              <span
                className="absolute top-px h-2 rounded-[3px]"
                style={
                  value >= 0
                    ? { left: "50%", width: `${w}%`, background: FOR_COLOR }
                    : { right: "50%", width: `${w}%`, background: AGAINST_COLOR }
                }
              />
            </div>
            <span className="text-right text-[12px] tabular-nums" style={{ color: a.forYou ? FOR_COLOR : AGAINST_COLOR }}>
              {value > 0 ? "+" : ""}
              {value}
            </span>
            <Tip tip={`${sides[0]}: ${range(a.inYourPicks)}. ${capFirst(sides[1])}: ${range(a.inRivalPicks)}.${thinTip(a.inYourPicks) || thinTip(a.inRivalPicks)}`}>
              <span className="col-span-full mb-1 cursor-help text-[11.5px] text-ink-3">
                {pct(a.inYourPicks)} {sides[0]} · {pct(a.inRivalPicks)} {sides[1]}
              </span>
            </Tip>
          </div>
        );
      })}
    </div>
  );
}

/** The arguments behind the station's verdict, in the Map panel's lift format. */
function ArgumentsBlock({ s, filtered, mode }: { s: JourneyStation; filtered: boolean; mode: BlockMode }) {
  const [open, setOpen] = useState(false);
  const lines = s.arguments.slice(0, 4);
  return (
    <div className="card p-5">
      <BlockTitle allBuyers={filtered && s.unfiltered.includes("arguments")}>The arguments</BlockTitle>
      {lines.length === 0 ? (
        <p className="text-[12px] text-ink-3">{s.argumentsNote ?? "Too few answers on either side to compare the arguments."}</p>
      ) : mode === "summary" && !open ? (
        <Folded sentence={argumentsSentence(s)} onExpand={() => setOpen(true)} />
      ) : (
        <>
          <LiftLines args={lines} sides={s.argumentLabels} />
          <p className="mt-2 text-[11px] italic text-ink-3">
            Each share is of this station&apos;s answers on that side of the verdict - the full table below splits them by question type.
          </p>
        </>
      )}
    </div>
  );
}

/** One side of the reasons: the themed rows (or the flat fallback), receipts on the shares. */
function ReasonSide({
  title,
  color,
  side,
  onOpen,
}: {
  title: string;
  color: string;
  side: StationReasonSide;
  onOpen: (title: string, label: string, ids: string[]) => void;
}) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1.5 text-[13px] font-semibold" style={{ color }}>
        {title}
      </h4>
      {side.base === 0 ? (
        <p className="py-1 text-[13px] text-ink-3">None measured</p>
      ) : (
        <ReasonList
          flat={side.flat}
          themes={side.themes}
          every={side.flat}
          wallColor={AGAINST_COLOR}
          onOpen={(label, ids) => onOpen(title, label, ids)}
        />
      )}
    </div>
  );
}

/** The reasons behind the station's verdict - the Map panel's ReasonList, both sides. */
function ReasonsBlock({
  s,
  filtered,
  mode,
  onOpen,
}: {
  s: JourneyStation;
  filtered: boolean;
  mode: BlockMode;
  onOpen: (title: string, label: string, ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const allBuyers = filtered && s.unfiltered.includes("reasons");
  if (s.key === "awareness")
    return (
      <div className="card p-5">
        <BlockTitle>The reasons</BlockTitle>
        <p className="text-[12px] text-ink-3">Awareness answers are coded for the topics they raise, not for reasons behind a pick.</p>
      </div>
    );
  const copy = REASON_COPY[s.key];
  const r = s.reasons;
  if (r.win.base === 0 && r.lose.base === 0)
    return (
      <div className="card p-5">
        <BlockTitle allBuyers={allBuyers}>The reasons</BlockTitle>
        <p className="text-[12px] text-ink-3">No reasons are stated at this station.</p>
      </div>
    );
  return (
    <div className="card p-5">
      <BlockTitle allBuyers={allBuyers}>The reasons</BlockTitle>
      {mode === "summary" && !open ? (
        <Folded sentence={reasonsSentence(s.key, r)} onExpand={() => setOpen(true)} />
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <ReasonSide title={copy.win} color={FOR_COLOR} side={r.win} onOpen={onOpen} />
            <ReasonSide title={copy.lose} color={AGAINST_COLOR} side={r.lose} onOpen={onOpen} />
          </div>
          <p className="mt-3 text-[11px] italic text-ink-3">{copy.note}</p>
        </>
      )}
    </div>
  );
}

/** The three blocks every station carries, in its own terms: who it routes
 * to, the arguments behind its verdict, the reasons. One component for all.
 * Keyed by the mode, so switching Summary/Detail resets each block's own
 * in-place expansion. */
function StationBlocks({
  s,
  filtered,
  mode,
  onOpen,
}: {
  s: JourneyStation;
  filtered: boolean;
  mode: BlockMode;
  onOpen: (title: string, label: string, ids: string[]) => void;
}) {
  return (
    <>
      <PicksBlock s={s} filtered={filtered} />
      <ArgumentsBlock key={`args:${mode}`} s={s} filtered={filtered} mode={mode} />
      <ReasonsBlock key={`reasons:${mode}`} s={s} filtered={filtered} mode={mode} onOpen={onOpen} />
    </>
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
  jump,
}: {
  runId: string;
  room: string;
  onRoom: (room: string) => void;
  onRooms?: (rooms: string[]) => void;
  /** A station the Summary's "where to look" pointer asks to open; `n` makes
   * each pointer click distinct so the same station can be asked twice. */
  jump?: { station: StationKey; n: number };
}) {
  const roomKey = room;
  const [views, setViews] = useState<Record<string, JourneyView | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** The one station whose full read fills the page (the funnel-strip rule). */
  const [selected, setSelected] = useState<StationKey | null>(null);
  /** Stations ever selected -> rooms their room-aware sections were mounted for. */
  const [mounted, setMounted] = useState<Map<StationKey, string[]>>(() => new Map());

  const engines = useEngineSet();
  // Summary/Detail for the reasons and arguments blocks, saved per project
  // (the run when no project is in the route, e.g. a share link).
  const params = useParams<{ id?: string }>();
  const [mode, setMode] = useBlockMode(typeof params?.id === "string" && params.id ? params.id : runId);
  const [evidence, setEvidence] = useState<EvidenceRequest | null>(null);
  const closeEvidence = useCallback(() => setEvidence(null), []);
  const loaded = roomKey in views;
  useEffect(() => {
    if (loaded) return;
    let live = true;
    const q = viewQuery({ room: roomKey === ALL ? null : roomKey, engines });
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
  }, [runId, roomKey, loaded, onRooms, engines]);

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
  // A pointer from the Summary selects its station the same way.
  const [seenJump, setSeenJump] = useState(0);
  if (jump && jump.n !== seenJump) {
    setSeenJump(jump.n);
    setSelected(jump.station);
    mountFor([jump.station], roomKey);
  }
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
          return (
            <section key={s.key} id={`journey-${s.key}`} className={effSelected === s.key ? "grid gap-5 scroll-mt-4" : "hidden"}>
              <StationHeading s={s} filtered={filtered} onAll={() => onRoom(ALL)} />
              <ModeToggle mode={mode} onMode={setMode} />
              <StationBlocks
                s={s}
                filtered={filtered}
                mode={mode}
                onOpen={(title, label, ids) =>
                  setEvidence({ title: `${title}: "${label}"`, subtitle: `${s.label} - ${s.question}`, ids: ids.slice(0, EVIDENCE_CAP) })
                }
              />
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
      {evidence && <EvidencePanel runId={runId} request={evidence} onClose={closeEvidence} />}
    </div>
  );
}
