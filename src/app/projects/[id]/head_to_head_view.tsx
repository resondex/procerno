"use client";

import { useEffect, useState } from "react";
import type {
  HeadToHeadRow,
  HeadToHeadSlice,
  HeadToHeadView,
  HeadToHeadViews,
  RateCell,
} from "@/lib/engine/head_to_head";
import { SortTable, Tip, type Col } from "./table";

/**
 * The head-to-head views (2026-10-27): prompted win rate per named rival,
 * reported apart from the headline. Renders nothing until the run has a
 * codes source.
 */

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pct = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = rate(c);
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
const range = (c: RateCell) =>
  c.n === 0 ? "no answers" : `${c.k} of ${c.n} - 95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%`;

const PARTS = [
  { key: "won", label: "You win", color: "bg-primary" },
  { key: "lost", label: "Rival wins", color: "bg-danger/55" },
  { key: "other", label: "Another pick", color: "bg-warning/60" },
  { key: "undecided", label: "No single pick", color: "bg-neutral-bar" },
] as const;

function RecordBar({ row }: { row: Pick<HeadToHeadRow, "won" | "lost" | "other" | "undecided"> }) {
  return (
    <div className="flex h-3 w-full min-w-[8rem] overflow-hidden rounded-[3px]">
      {PARTS.map((p) => (
        <div
          key={p.key}
          className={p.color}
          style={{ width: `${rate(row[p.key]) * 100}%` }}
          title={`${p.label}: ${row[p.key].k} of ${row[p.key].n}`}
        />
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {PARTS.map((p) => (
        <span key={p.key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-[3px] ${p.color}`} />
          {p.label}
        </span>
      ))}
    </div>
  );
}

const rateCol = <T,>(id: string, label: string, tip: string, get: (r: T) => RateCell): Col<T> => ({
  id,
  label,
  tip,
  num: true,
  val: (r) => (get(r).n > 0 ? Math.round(rate(get(r)) * 1000) / 10 : null),
  render: (r) => (
    <Tip tip={range(get(r))}>
      <span className="cursor-help">{pct(get(r))}</span>
    </Tip>
  ),
});

const TIPS = {
  won: "Answers whose pick is your brand - the prompted win rate.",
  lost: "Answers whose pick is the rival the question names.",
  other: "Answers that pick something else entirely.",
  undecided: "Answers that make no single pick: it depends on the buyer, no pick, or a question back.",
  twoWay: "Your wins over your wins plus the rival's wins - the straight two-way record.",
};

const rowCols = (first: string): Col<HeadToHeadRow>[] => [
  {
    id: "rival",
    label: first,
    val: (r) => r.rival,
    render: (r) => (
      <span>
        {r.rival}
        {!r.resolved && <span className="ml-2 text-[11px] text-warning">not in your dictionary</span>}
      </span>
    ),
  },
  { id: "answers", label: "Answers", num: true, val: (r) => r.answers },
  {
    id: "bar",
    label: "Record",
    val: (r) => Math.round(rate(r.won) * 1000) / 10,
    render: (r) => <RecordBar row={r} />,
  },
  rateCol("won", "You win", TIPS.won, (r) => r.won),
  rateCol("lost", "Rival wins", TIPS.lost, (r) => r.lost),
  rateCol("other", "Another pick", TIPS.other, (r) => r.other),
  rateCol("undecided", "No single pick", TIPS.undecided, (r) => r.undecided),
  rateCol("twoWay", "Two-way record", TIPS.twoWay, (r) => r.winOfDecided),
];

const engineCols: Col<HeadToHeadSlice>[] = [
  { id: "label", label: "Engine", val: (s) => s.label },
  { id: "answers", label: "Answers", num: true, val: (s) => s.answers },
  rateCol("won", "You win", TIPS.won, (s) => s.won),
  rateCol("lost", "Rival wins", TIPS.lost, (s) => s.lost),
  rateCol("undecided", "No single pick", TIPS.undecided, (s) => s.undecided),
];

function KindSection({ view, title, blurb, first }: { view: HeadToHeadView; title: string; blurb: string; first: string }) {
  const others = view.rows.flatMap((r) => r.otherPicks.map((o) => `${o.name} (${o.n}, vs ${r.rival})`));
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">{title}</h2>
        <p className="text-[13px] text-ink-3">
          {blurb} {view.answers} answers on the core engine panel, reported apart from the headline.
          {view.uncoded > 0 && ` ${view.uncoded} more answers are not coded yet.`}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Tip tip={`${TIPS.won} ${range(view.overall.won)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.overall.won)}</span> you win
          </span>
        </Tip>
        <Tip tip={`${TIPS.lost} ${range(view.overall.lost)}`}>
          <span className="cursor-help">{pct(view.overall.lost)} the rival wins</span>
        </Tip>
        <Tip tip={`${TIPS.twoWay} ${range(view.overall.winOfDecided)}`}>
          <span className="cursor-help">two-way record {pct(view.overall.winOfDecided)}</span>
        </Tip>
      </div>
      <Legend />
      <SortTable cols={rowCols(first)} rows={view.rows} filename={`head_to_head_${view.kind}.csv`} defaultSort={{ id: "won", dir: 1 }} />
      {others.length > 0 && (
        <p className="text-[12px] text-ink-3">Other picks: {others.join(", ")}.</p>
      )}
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">By engine, across every {first.toLowerCase()}</summary>
        <SortTable cols={engineCols} rows={view.byEngine} filename={`head_to_head_${view.kind}_by_engine.csv`} defaultSort={{ id: "won", dir: -1 }} />
      </details>
    </section>
  );
}

export default function HeadToHeadSection({ runId }: { runId: string }) {
  const [views, setViews] = useState<HeadToHeadViews | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/head_to_head`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`head-to-head view failed (${r.status})`);
        const d = (await r.json()) as { views: HeadToHeadViews | null };
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
      {views.entity && views.entity.answers > 0 && (
        <KindSection
          view={views.entity}
          title="Head-to-head - named rivals"
          blurb={`Questions that set ${views.brand} against one named rival and ask for a pick.`}
          first="Rival"
        />
      )}
      {views.class && views.class.answers > 0 && (
        <KindSection
          view={views.class}
          title="Head-to-head - against a class of product"
          blurb={`Questions that set ${views.brand} against a whole class of product rather than one rival. A pick of one specific product from that class counts as another pick, not as the class.`}
          first="Class"
        />
      )}
    </>
  );
}
