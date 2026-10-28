"use client";

import { useEffect, useState } from "react";
import type { RepertoireSlice, RepertoireView, Verdict } from "@/lib/engine/repertoire";
import { SortTable, Tip, type Col } from "./table";
import { Legend, pct, range, rate, rateCol, StackBar, type Part } from "./view_parts";

/**
 * The repertoire view (2026-10-28): a habitual buyer of the client asks
 * whether to stick with it or try something else - does the AI keep them?
 * The question names the brand, so being named is never reported. Renders
 * nothing until the run has a codes source.
 */

const VERDICT_PARTS = (brand: string): readonly Part<Verdict>[] => [
  { key: "stick", label: `Sticks with ${brand}`, color: "bg-primary" },
  { key: "switch", label: "Switches brand", color: "bg-danger/55" },
  { key: "open", label: "No single answer", color: "bg-neutral-bar" },
];

const tips = (brand: string): Record<Verdict, string> => ({
  stick: `Answers whose single pick is ${brand} - keep buying it.`,
  switch: "Answers whose single pick is another brand.",
  open: "Answers that make no single pick: it depends, a list to try, or a question back.",
});

const names = (xs: { name: string; n: number }[]) => xs.map((x) => `${x.name} (${x.n})`).join(", ");

const engineCols = (brand: string): Col<RepertoireSlice>[] => {
  const parts = VERDICT_PARTS(brand);
  const t = tips(brand);
  return [
    { id: "label", label: "Engine", val: (s) => s.label },
    { id: "answers", label: "Answers", num: true, val: (s) => s.answers },
    {
      id: "bar",
      label: "Verdict",
      val: (s) => Math.round(rate(s.verdict.stick) * 1000) / 10,
      render: (s) => <StackBar parts={parts} cells={s.verdict} />,
    },
    ...parts.map((p) => rateCol<RepertoireSlice>(p.key, p.label, t[p.key], (s) => s.verdict[p.key])),
    rateCol("rec", `Recommends ${brand}`, `Answers that recommend ${brand}, picked or not.`, (s) => s.recommendsYou),
    rateCol("other", "Recommends another brand", "Answers that recommend at least one other brand.", (s) => s.recommendsOther),
  ];
};

export default function RepertoireSection({ runId }: { runId: string }) {
  const [view, setView] = useState<RepertoireView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/repertoire`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`repertoire view failed (${r.status})`);
        const d = (await r.json()) as { view: RepertoireView | null };
        if (live) setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (!view || view.answers === 0) return null;
  const parts = VERDICT_PARTS(view.brand);
  const t = tips(view.brand);
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">Repertoire - does the AI keep a regular buyer</h2>
        <p className="text-[13px] text-ink-3">
          Questions from someone who usually buys {view.brand}, asking whether to stick with it or try something else.{" "}
          {view.answers} answers on the core engine panel, reported apart from the headline.
          {view.uncoded > 0 && ` ${view.uncoded} more answers are not coded yet.`}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Tip tip={`${t.stick} ${range(view.verdict.stick)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.verdict.stick)}</span> stick with{" "}
            {view.brand}
          </span>
        </Tip>
        <Tip tip={`${t.switch} ${range(view.verdict.switch)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.verdict.switch)}</span> switch
          </span>
        </Tip>
        <Tip tip={`Answers that recommend ${view.brand}, picked or not. ${range(view.recommendsYou)}`}>
          <span className="cursor-help">{pct(view.recommendsYou)} recommend {view.brand}</span>
        </Tip>
        <Tip tip={`Answers that recommend at least one other brand. ${range(view.recommendsOther)}`}>
          <span className="cursor-help">{pct(view.recommendsOther)} recommend another brand</span>
        </Tip>
      </div>
      <div className="grid gap-2">
        <div className="h-4">
          <StackBar parts={parts} cells={view.verdict} />
        </div>
        <Legend parts={parts} cells={view.verdict} />
      </div>
      <div className="grid gap-1 text-[13px] text-ink-2">
        {view.switchTo.length > 0 && <p>Picked instead: {names(view.switchTo)}.</p>}
        {view.alsoRecommended.length > 0 && (
          <p>
            Other brands recommended:{" "}
            {view.alsoRecommended.map((x, i) => (
              <span key={x.name}>
                {i > 0 && ", "}
                <Tip tip={range(x.share)}>
                  <span className="cursor-help">
                    {x.name} {pct(x.share)}
                  </span>
                </Tip>
              </span>
            ))}
            .
          </p>
        )}
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">By engine</summary>
        <SortTable cols={engineCols(view.brand)} rows={view.byEngine} filename="repertoire_by_engine.csv" defaultSort={{ id: "stick", dir: -1 }} />
      </details>
    </section>
  );
}
