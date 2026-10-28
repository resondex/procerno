"use client";

import { useEffect, useState } from "react";
import type { PremiumSlice, PremiumView, Stance, StanceRow } from "@/lib/engine/premium";
import { SortTable, Tip, type Col } from "./table";
import { Legend, pct, range, rate, rateCol, StackBar, type Part } from "./view_parts";

/**
 * The premium tier view (2026-10-28): on the "premium vs basic - which
 * would you get?" questions, which end of the category the AI advocates,
 * and which brands it recommends when it does. These answers also count in
 * the headline; this card adds the tier read. Renders nothing until the run
 * has a codes source.
 */

const STANCE_PARTS: readonly Part<Stance>[] = [
  { key: "premium", label: "Go premium", color: "bg-primary" },
  { key: "balanced", label: "It depends", color: "bg-warning/60" },
  { key: "basic", label: "Go basic", color: "bg-danger/55" },
  { key: "none", label: "Takes no side", color: "bg-neutral-bar" },
];

const TIPS: Record<Stance, string> = {
  premium: "Answers that advocate the premium end of the category for this asker.",
  balanced: "Answers that say it depends, or back each end under stated conditions.",
  basic: "Answers that advocate the cheaper end - the basic options are good enough.",
  none: "Answers that lay out both ends without advocating either.",
};

const stanceCols = (brand: string): Col<StanceRow>[] => [
  {
    id: "label",
    label: "What the AI advocates",
    val: (r) => STANCE_PARTS.find((p) => p.key === r.key)?.label ?? r.key,
  },
  { id: "answers", label: "Answers", num: true, val: (r) => r.answers },
  rateCol("rec", `Recommends ${brand}`, `Answers advocating this end that recommend ${brand}.`, (r) => r.recommendsYou),
  rateCol("picks", `Picks ${brand}`, `Answers advocating this end whose single pick is ${brand}.`, (r) => r.picksYou),
  rateCol("firm", "Makes a pick", "Answers advocating this end that commit to one product.", (r) => r.firmPick),
  {
    id: "brands",
    label: "Brands it recommends",
    val: (r) => r.recommended[0]?.name ?? "",
    render: (r) => (
      <span className="text-[12px] text-ink-2">
        {r.recommended.length === 0
          ? "-"
          : r.recommended.map((b, i) => (
              <span key={b.name} className={b.you ? "font-medium text-ink" : undefined}>
                {i > 0 && ", "}
                {b.name} ({b.n})
              </span>
            ))}
      </span>
    ),
  },
];

const engineCols = (brand: string): Col<PremiumSlice>[] => [
  { id: "label", label: "Engine", val: (s) => s.label },
  { id: "answers", label: "Answers", num: true, val: (s) => s.answers },
  {
    id: "bar",
    label: "What it advocates",
    val: (s) => Math.round(rate(s.stance.premium) * 1000) / 10,
    render: (s) => <StackBar parts={STANCE_PARTS} cells={s.stance} />,
  },
  ...STANCE_PARTS.map((p) => rateCol<PremiumSlice>(p.key, p.label, TIPS[p.key], (s) => s.stance[p.key])),
  rateCol("picks", `Picks ${brand}`, `Answers whose single pick is ${brand}.`, (s) => s.picksYou),
];

export default function PremiumSection({ runId }: { runId: string }) {
  const [view, setView] = useState<PremiumView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/premium`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`premium tier view failed (${r.status})`);
        const d = (await r.json()) as { view: PremiumView | null };
        if (live) setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (!view || view.answers === 0) return null;
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">Premium vs basic - which end the AI backs</h2>
        <p className="text-[13px] text-ink-3">
          Questions asking whether premium {view.category} beat the cheaper ones, and which to get. {view.answers}{" "}
          answers on the core engine panel. They also count in the headline; this card reads which end they back.
          {view.uncoded > 0 && ` ${view.uncoded} more answers are not coded yet.`}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Tip tip={`${TIPS.premium} ${range(view.stance.premium)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.stance.premium)}</span> go premium
          </span>
        </Tip>
        <Tip tip={`${TIPS.basic} ${range(view.stance.basic)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.stance.basic)}</span> go basic
          </span>
        </Tip>
        <Tip tip={`Answers that recommend ${view.brand}. ${range(view.recommendsYou)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.recommendsYou)}</span> recommend{" "}
            {view.brand}
          </span>
        </Tip>
        <Tip tip={`Answers whose single pick is ${view.brand}. ${range(view.picksYou)}`}>
          <span className="cursor-help">{pct(view.picksYou)} pick {view.brand}</span>
        </Tip>
      </div>
      <div className="grid gap-2">
        <div className="h-4">
          <StackBar parts={STANCE_PARTS} cells={view.stance} />
        </div>
        <Legend parts={STANCE_PARTS} cells={view.stance} />
      </div>
      <SortTable
        cols={stanceCols(view.brand)}
        rows={view.byStance.filter((r) => r.answers > 0)}
        filename="premium_by_stance.csv"
        defaultSort={{ id: "answers", dir: -1 }}
      />
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">By engine</summary>
        <SortTable cols={engineCols(view.brand)} rows={view.byEngine} filename="premium_by_engine.csv" defaultSort={{ id: "premium", dir: -1 }} />
      </details>
    </section>
  );
}
