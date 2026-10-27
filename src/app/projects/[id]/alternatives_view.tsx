"use client";

import { useEffect, useState } from "react";
import type {
  AlternativesViews,
  CaptorBrand,
  CaptureRow,
  CaptureSlice,
  DefensiveView,
  DestinationRow,
  HoldSlice,
  NamedCount,
  OffensiveView,
  RateCell,
} from "@/lib/engine/alternatives";
import { SortTable, Tip, type Col } from "./table";

/**
 * The alternatives views (2026-10-27): offensive capture (a rival's leaver
 * asks what to get instead) and defensive hold (your own customer weighs
 * leaving), each reported apart from the headline. Renders nothing until
 * the run has a codes source.
 */

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pct = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = rate(c);
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
const range = (c: RateCell) =>
  c.n === 0 ? "no answers" : `${c.k} of ${c.n} - 95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%`;

function RateText({ cell }: { cell: RateCell }) {
  return (
    <Tip tip={range(cell)}>
      <span className="cursor-help">{pct(cell)}</span>
    </Tip>
  );
}

const rateCol = <T,>(id: string, label: string, tip: string, get: (r: T) => RateCell): Col<T> => ({
  id,
  label,
  tip,
  num: true,
  val: (r) => (get(r).n > 0 ? Math.round(rate(get(r)) * 1000) / 10 : null),
  render: (r) => <RateText cell={get(r)} />,
});

interface Part<K extends string> {
  key: K;
  label: string;
  color: string;
}

function StackBar<K extends string>({ parts, cells }: { parts: readonly Part<K>[]; cells: Record<K, RateCell> }) {
  return (
    <div className="flex h-3 w-full min-w-[8rem] overflow-hidden rounded-[3px]">
      {parts.map((p) => (
        <div
          key={p.key}
          className={p.color}
          style={{ width: `${rate(cells[p.key]) * 100}%` }}
          title={`${p.label}: ${cells[p.key].k} of ${cells[p.key].n}`}
        />
      ))}
    </div>
  );
}

function Legend<K extends string>({ parts, cells }: { parts: readonly Part<K>[]; cells?: Record<K, RateCell> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {parts.map((p) => (
        <span key={p.key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-[3px] ${p.color}`} />
          {p.label}
          {cells && ` ${pct(cells[p.key])}`}
        </span>
      ))}
    </div>
  );
}

const names = (xs: NamedCount[]) => xs.map((x) => `${x.name} (${x.n})`).join(", ");

// ---------- offensive capture ----------

const CAPTURE_PARTS = [
  { key: "captured", label: "Picks you", color: "bg-primary" },
  { key: "anotherBrand", label: "Picks another brand", color: "bg-danger/55" },
  { key: "sameBrand", label: "Back to the same brand", color: "bg-danger/25" },
  { key: "outside", label: "Pick outside your dictionary", color: "bg-warning/60" },
  { key: "undecided", label: "No single pick", color: "bg-neutral-bar" },
] as const;

const CAPTURE_TIPS = {
  named: "Answers that name your brand in any framing.",
  recommended: "Answers that endorse your brand. The brand an answer picks always counts as recommended.",
  captured: "Answers whose pick is your brand - the leaver is sent to you.",
  anotherBrand: "Answers whose pick is another approved brand in your dictionary.",
  sameBrand: "Answers whose pick is another product of the brand the asker said they were leaving.",
  outside: "Answers whose pick is not an approved brand in your dictionary.",
  undecided: "Answers that make no single pick: it depends on the buyer, no pick, or a question back.",
  chosen: "Answers whose pick is this brand.",
  shareOfDecided: "Of the answers that picked an approved brand, the share that picked this one.",
};

const captureCols: Col<CaptureRow>[] = [
  {
    id: "rival",
    label: "Leaving",
    val: (r) => r.rival,
    render: (r) => (
      <span>
        {r.rival}
        {!r.resolved && <span className="ml-2 text-[11px] text-warning">not in your dictionary</span>}
      </span>
    ),
  },
  { id: "answers", label: "Answers", num: true, val: (r) => r.answers },
  rateCol("named", "Named", CAPTURE_TIPS.named, (r) => r.named),
  rateCol("recommended", "Recommended", CAPTURE_TIPS.recommended, (r) => r.recommended),
  {
    id: "bar",
    label: "Where the leaver is sent",
    val: (r) => Math.round(rate(r.captured) * 1000) / 10,
    render: (r) => <StackBar parts={CAPTURE_PARTS} cells={r} />,
  },
  rateCol("captured", "Picks you", CAPTURE_TIPS.captured, (r) => r.captured),
  rateCol("undecided", "No single pick", CAPTURE_TIPS.undecided, (r) => r.undecided),
  {
    id: "captors",
    label: "Top picks",
    val: (r) => r.captors[0]?.name ?? "",
    render: (r) => <span className="text-[12px] text-ink-2">{names(r.captors) || "-"}</span>,
  },
];

const ROLE_LABEL: Record<CaptorBrand["role"], string> = {
  target: "your brand",
  competitor: "tracked rival",
  emerged: "emerged",
};

const captorCols: Col<CaptorBrand>[] = [
  {
    id: "name",
    label: "Brand",
    val: (b) => b.name,
    render: (b) => (
      <span className={b.role === "target" ? "font-semibold text-primary" : ""}>
        {b.name}
        <span className="ml-2 text-[11px] text-ink-3">{ROLE_LABEL[b.role]}</span>
      </span>
    ),
  },
  rateCol("named", "Named", CAPTURE_TIPS.named.replace("your brand", "the brand"), (b) => b.named),
  rateCol("chosen", "Picked", CAPTURE_TIPS.chosen, (b) => b.chosen),
  rateCol("sod", "Share of decided", CAPTURE_TIPS.shareOfDecided, (b) => b.shareOfDecided),
];

const captureEngineCols: Col<CaptureSlice>[] = [
  { id: "label", label: "Engine", val: (s) => s.label },
  { id: "answers", label: "Answers", num: true, val: (s) => s.answers },
  rateCol("named", "Named", CAPTURE_TIPS.named, (s) => s.named),
  rateCol("captured", "Picks you", CAPTURE_TIPS.captured, (s) => s.captured),
  rateCol("undecided", "No single pick", CAPTURE_TIPS.undecided, (s) => s.undecided),
];

function OffensiveSection({ view }: { view: OffensiveView }) {
  const [allBrands, setAllBrands] = useState(false);
  const captors = allBrands
    ? view.captors
    : view.captors.filter((b) => b.role === "target" || b.chosen.k > 0 || rate(b.named) >= 0.05);
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">Alternatives - capturing a rival&apos;s leavers</h2>
        <p className="text-[13px] text-ink-3">
          Questions from someone leaving a rival who asks what to get instead. {view.answers} answers on the core
          engine panel, reported apart from the headline.
          {view.uncoded > 0 && ` ${view.uncoded} more answers are not coded yet.`}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Tip tip={`${CAPTURE_TIPS.named} ${range(view.overall.named)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.overall.named)}</span> name{" "}
            {view.brand}
          </span>
        </Tip>
        <Tip tip={`${CAPTURE_TIPS.recommended} ${range(view.overall.recommended)}`}>
          <span className="cursor-help">{pct(view.overall.recommended)} recommend it</span>
        </Tip>
        <Tip tip={`${CAPTURE_TIPS.captured} ${range(view.overall.captured)}`}>
          <span className="cursor-help">{pct(view.overall.captured)} pick it</span>
        </Tip>
      </div>
      <Legend parts={CAPTURE_PARTS} cells={view.overall} />
      <SortTable cols={captureCols} rows={view.rows} filename="alternatives_capture.csv" defaultSort={{ id: "captured", dir: 1 }} />
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">Who captures the leavers, across every rival</summary>
        <div className="grid gap-2 mt-2">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={allBrands} onChange={(e) => setAllBrands(e.target.checked)} />
            Show every brand named
          </label>
          <SortTable cols={captorCols} rows={captors} filename="alternatives_captors.csv" defaultSort={{ id: "chosen", dir: -1 }} />
          {view.outsidePicks.length > 0 && (
            <p className="text-[12px] text-ink-3">Picks outside your dictionary: {names(view.outsidePicks)}.</p>
          )}
        </div>
      </details>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">By engine, across every rival</summary>
        <SortTable cols={captureEngineCols} rows={view.byEngine} filename="alternatives_capture_by_engine.csv" defaultSort={{ id: "captured", dir: -1 }} />
      </details>
    </section>
  );
}

// ---------- defensive hold ----------

const VERDICT_PARTS = [
  { key: "keep", label: "Advises staying", color: "bg-primary" },
  { key: "leave", label: "Advises leaving", color: "bg-danger/55" },
  { key: "undecided", label: "Takes no side", color: "bg-neutral-bar" },
] as const;

const HOLD_TIPS = {
  keep: "Answers that push your customer to stay. A move to another of your own products counts as staying.",
  leave: "Answers that push your customer to leave. Listing alternatives because the asker asked for them is not a push either way.",
  undecided: "Answers that take no side between staying and leaving.",
  offersExit: "Answers that name at least one other brand to move to, whatever they advise.",
  offered: "Answers that name this brand as somewhere to go, whatever they advise.",
};

function DestinationTable({ view }: { view: DefensiveView }) {
  const [all, setAll] = useState(false);
  const rows = all ? view.destinations : view.destinations.filter((d) => d.role === "competitor" || rate(d.offered) >= 0.05);
  const n = { keep: view.verdicts.keep.k, leave: view.verdicts.leave.k, undecided: view.verdicts.undecided.k };
  const byVerdict = (id: "keep" | "leave" | "undecided", label: string, get: (d: DestinationRow) => number): Col<DestinationRow> => ({
    id,
    label,
    tip: `Of the answers that ${label.toLowerCase()}, how many name this brand as somewhere to go.`,
    num: true,
    val: (d) => (n[id] > 0 ? get(d) / n[id] : null),
    render: (d) => (n[id] > 0 ? <span>{get(d)} of {n[id]}</span> : <span className="text-ink-3">-</span>),
  });
  const cols: Col<DestinationRow>[] = [
    {
      id: "name",
      label: "Offered exit",
      val: (d) => d.name,
      render: (d) => (
        <span>
          {d.name}
          <span className="ml-2 text-[11px] text-ink-3">{d.role === "competitor" ? "tracked rival" : "emerged"}</span>
        </span>
      ),
    },
    rateCol("offered", "Offered", HOLD_TIPS.offered, (d) => d.offered),
    byVerdict("keep", "Advise staying", (d) => d.onKeep),
    byVerdict("leave", "Advise leaving", (d) => d.onLeave),
    byVerdict("undecided", "Take no side", (d) => d.onUndecided),
  ];
  return (
    <div className="grid gap-2">
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Show every exit offered
      </label>
      {!all && rows.length < view.destinations.length && (
        <p className="text-[12px] text-ink-3">
          Emerged brands offered in under 5% of answers are hidden ({view.destinations.length - rows.length}).
        </p>
      )}
      <SortTable cols={cols} rows={rows} filename="alternatives_exits.csv" defaultSort={{ id: "offered", dir: -1 }} />
    </div>
  );
}

const holdEngineCols: Col<HoldSlice>[] = [
  { id: "label", label: "Engine", val: (s) => s.label },
  { id: "answers", label: "Answers", num: true, val: (s) => s.answers },
  rateCol("keep", "Advises staying", HOLD_TIPS.keep, (s) => s.verdicts.keep),
  rateCol("leave", "Advises leaving", HOLD_TIPS.leave, (s) => s.verdicts.leave),
  rateCol("undecided", "Takes no side", HOLD_TIPS.undecided, (s) => s.verdicts.undecided),
  rateCol("exit", "Offers an exit", HOLD_TIPS.offersExit, (s) => s.offersExit),
];

function DefensiveSection({ view }: { view: DefensiveView }) {
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">Alternatives - holding your own customers</h2>
        <p className="text-[13px] text-ink-3">
          Questions from someone already on {view.brand} who is weighing a move and asks what to look at instead.{" "}
          {view.answers} answers on the core engine panel, reported apart from the headline.
          {view.uncoded > 0 && ` ${view.uncoded} more answers are not coded yet.`}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Tip tip={`${HOLD_TIPS.keep} ${range(view.verdicts.keep)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.verdicts.keep)}</span> advise
            staying
          </span>
        </Tip>
        <Tip tip={`${HOLD_TIPS.leave} ${range(view.verdicts.leave)}`}>
          <span className="cursor-help">{pct(view.verdicts.leave)} advise leaving</span>
        </Tip>
        <Tip tip={`${HOLD_TIPS.offersExit} ${range(view.offersExit)}`}>
          <span className="cursor-help">
            {pct(view.offersExit)} offer an exit ({view.exitsPerAnswer.toFixed(1)} brands on average)
          </span>
        </Tip>
      </div>
      <div className="grid gap-2">
        <div className="h-4">
          <StackBar parts={VERDICT_PARTS} cells={view.verdicts} />
        </div>
        <Legend parts={VERDICT_PARTS} cells={view.verdicts} />
      </div>
      <p className="text-[12px] text-ink-3">
        Exits are counted whatever the answer advises: an exit named beside advice to stay is an option shown, not a
        customer lost.
        {view.ownProduct.k > 0 && ` ${view.ownProduct.k} answers also offer another ${view.brand} product.`}
      </p>
      <DestinationTable view={view} />
      {view.outsideDestinations.length > 0 && (
        <p className="text-[12px] text-ink-3">Exits outside your dictionary: {names(view.outsideDestinations)}.</p>
      )}
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">By engine</summary>
        <SortTable cols={holdEngineCols} rows={view.byEngine} filename="alternatives_hold_by_engine.csv" defaultSort={{ id: "keep", dir: -1 }} />
      </details>
    </section>
  );
}

export default function AlternativesSection({ runId }: { runId: string }) {
  const [views, setViews] = useState<AlternativesViews | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/alternatives`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`alternatives view failed (${r.status})`);
        const d = (await r.json()) as { views: AlternativesViews | null };
        if (live) setViews(d.views);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (!views) return null;
  return (
    <>
      {views.offensive && views.offensive.answers > 0 && <OffensiveSection view={views.offensive} />}
      {views.defensive && views.defensive.answers > 0 && <DefensiveSection view={views.defensive} />}
    </>
  );
}
