"use client";

import { useEffect, useState } from "react";
import type { ValueRow, ValueSlice, ValueView, Worth } from "@/lib/engine/value";
import { SortTable, Tip, type Col } from "./table";
import { Legend, pct, range, rate, rateCol, StackBar, type Part } from "./view_parts";

/**
 * The Value view (2026-10-27): is the client's designed line worth it over a
 * generic cheaper option, for each room's buyer - per room and per line,
 * reported apart from the headline. Renders nothing until the run has a
 * codes source.
 */

const WORTH_PARTS: readonly Part<Worth>[] = [
  { key: "yes", label: "Worth it", color: "bg-primary" },
  { key: "depends", label: "Depends", color: "bg-neutral-bar" },
  { key: "no", label: "Not worth it", color: "bg-danger/55" },
];

const TIPS: Record<Worth, string> = {
  yes: "Answers that say the line is worth its price over a cheaper option for this buyer.",
  depends: "Answers that say it depends on the buyer's usage or circumstances.",
  no: "Answers that say the cheaper option is the better buy for this buyer.",
};

const INSTEAD_TIP =
  "Of the answers that say not worth it or depends, how many recommend another brand by name. The question names no rival, so these are cheaper options the AI puts forward on its own.";

const names = (xs: { name: string; n: number }[]) => xs.map((x) => `${x.name} (${x.n})`).join(", ");

const rowCols = (first: string, showLine: boolean): Col<ValueRow>[] => [
  { id: "label", label: first, val: (r) => r.label },
  ...(showLine ? [{ id: "line", label: "Line asked about", val: (r: ValueRow) => r.line ?? "" } as Col<ValueRow>] : []),
  ...(!showLine ? [{ id: "rooms", label: "Rooms", num: true, val: (r: ValueRow) => r.rooms.length } as Col<ValueRow>] : []),
  { id: "answers", label: "Answers", num: true, val: (r) => r.answers },
  {
    id: "bar",
    label: "Verdict",
    val: (r) => Math.round(rate(r.worth.yes) * 1000) / 10,
    render: (r) => <StackBar parts={WORTH_PARTS} cells={r.worth} />,
  },
  ...WORTH_PARTS.map((p) => rateCol<ValueRow>(p.key, p.label, TIPS[p.key], (r) => r.worth[p.key])),
  rateCol("instead", "Recommends another brand", INSTEAD_TIP, (r) => r.recommendsInstead),
  {
    id: "names",
    label: "Brands recommended instead",
    val: (r) => r.instead[0]?.name ?? "",
    render: (r) => <span className="text-[12px] text-ink-2">{names(r.instead) || "-"}</span>,
  },
];

const engineCols: Col<ValueSlice>[] = [
  { id: "label", label: "Engine", val: (s) => s.label },
  { id: "answers", label: "Answers", num: true, val: (s) => s.answers },
  ...WORTH_PARTS.map((p) => rateCol<ValueSlice>(p.key, p.label, TIPS[p.key], (s) => s.worth[p.key])),
];

export default function ValueSection({ runId }: { runId: string }) {
  const [view, setView] = useState<ValueView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/value`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`value view failed (${r.status})`);
        const d = (await r.json()) as { view: ValueView | null };
        if (live) setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (!view || view.answers === 0) return null;
  const counterparts = [...new Set(view.rooms.map((r) => r.counterpart).filter(Boolean))];
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">Value - worth it over a cheaper option</h2>
        <p className="text-[13px] text-ink-3">
          Questions that name one {view.brand} line and ask whether it is worth it for one kind of buyer
          {counterparts.length === 1 ? `, against ${counterparts[0]}` : " against a generic cheaper option"}.{" "}
          {view.answers} answers on the core engine panel, reported apart from the headline.
          {view.uncoded > 0 && ` ${view.uncoded} more answers are not coded yet.`}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Tip tip={`${TIPS.yes} ${range(view.worth.yes)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.worth.yes)}</span> worth it
          </span>
        </Tip>
        <Tip tip={`${TIPS.no} ${range(view.worth.no)}`}>
          <span className="cursor-help">{pct(view.worth.no)} not worth it</span>
        </Tip>
        <Tip tip={`${INSTEAD_TIP} ${range(view.recommendsInstead)}`}>
          <span className="cursor-help">{pct(view.recommendsInstead)} of the doubting answers recommend another brand</span>
        </Tip>
      </div>
      <div className="grid gap-2">
        <div className="h-4">
          <StackBar parts={WORTH_PARTS} cells={view.worth} />
        </div>
        <Legend parts={WORTH_PARTS} cells={view.worth} />
      </div>
      <SortTable cols={rowCols("Room", true)} rows={view.rooms} filename="value_by_room.csv" defaultSort={{ id: "yes", dir: -1 }} />
      {view.instead.length > 0 && (
        <p className="text-[12px] text-ink-3">Brands recommended instead, across every room: {names(view.instead)}.</p>
      )}
      {view.lines.length > 1 && (
        <details className="text-[13px]" open>
          <summary className="cursor-pointer text-ink-2">By line</summary>
          <SortTable cols={rowCols("Line", false)} rows={view.lines} filename="value_by_line.csv" defaultSort={{ id: "answers", dir: -1 }} />
        </details>
      )}
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">By engine</summary>
        <SortTable cols={engineCols} rows={view.byEngine} filename="value_by_engine.csv" defaultSort={{ id: "yes", dir: -1 }} />
      </details>
    </section>
  );
}
