"use client";

import { useEffect, useState } from "react";
import type { HeadlineBrand, HeadlineSlice, HeadlineView, NamedCount, RateCell } from "@/lib/engine/headline";
import { SortTable, Tip, type Col } from "./table";

/**
 * The headline view (2026-10-27): win / pick / visibility over open-choice
 * answers only, read from answer_codes under the project's codes source.
 * Renders nothing until the run has a codes source.
 */

const STAGE_LABEL: Record<string, string> = {
  discovery: "Discovery",
  use_case: "Use-case fit",
  social_validation: "Social validation",
  premium_worth: "Premium vs basic",
};

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pct = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = rate(c);
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
const range = (c: RateCell) =>
  c.n === 0 ? "no answers" : `${c.k} of ${c.n} - 95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%`;

const TIPS = {
  mentioned: "Headline answers that name the brand in any framing.",
  recommended: "Headline answers that endorse the brand. The brand an answer picks always counts as recommended.",
  chosen: "Headline answers whose pick is the brand. Product picks count for their brand through the dictionary.",
  shareOfDecided: "Of the headline answers that picked a brand in the category, the share that picked this one.",
  negative: "Answers that criticize the brand or advise against it, as a share of the answers that name it.",
  firmPick: "Headline answers that commit to one pick, whatever it is.",
  inCategory: "Firm picks whose pick is an approved brand in the confirmed dictionary.",
};

function Tile({ label, cell, tip }: { label: string; cell: RateCell; tip: string }) {
  return (
    <div className="card p-5" title={tip}>
      <div className="section-label">{label}</div>
      <div className="text-[2rem] leading-tight font-semibold tabular-nums mt-1.5">{pct(cell)}</div>
      <div className="text-[13px] text-ink-2 mt-1">{range(cell)}</div>
    </div>
  );
}

function RateText({ cell }: { cell: RateCell }) {
  return (
    <Tip tip={range(cell)}>
      <span className="cursor-help">{pct(cell)}</span>
    </Tip>
  );
}

function NameList({ title, items, total }: { title: string; items: NamedCount[]; total: number }) {
  if (total === 0) return null;
  return (
    <div className="text-[13px] text-ink-2">
      <span className="font-medium text-ink">{title}: {total}</span>
      {items.length > 0 && (
        <span className="text-ink-3"> - {items.map((x) => `${x.name} (${x.n})`).join(", ")}</span>
      )}
    </div>
  );
}

const OUTCOME_PARTS = [
  { key: "pick", label: "Picks one", color: "bg-primary" },
  { key: "conditional", label: "Depends on the buyer", color: "bg-primary/45" },
  { key: "no_pick", label: "No pick", color: "bg-neutral-bar" },
  { key: "clarification", label: "Asks a question back", color: "bg-warning/60" },
] as const;

function OutcomeBar({ view }: { view: HeadlineView }) {
  const n = Math.max(1, view.answers);
  return (
    <div className="grid gap-2">
      <div className="flex h-4 w-full overflow-hidden rounded-[4px]">
        {OUTCOME_PARTS.map((p) => (
          <div
            key={p.key}
            className={p.color}
            style={{ width: `${(view.outcomes[p.key] / n) * 100}%` }}
            title={`${p.label}: ${view.outcomes[p.key]} of ${view.answers}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        {OUTCOME_PARTS.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-[3px] ${p.color}`} />
            {p.label} {Math.round((view.outcomes[p.key] / n) * 100)}%
          </span>
        ))}
      </div>
    </div>
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

const ROLE_LABEL: Record<HeadlineBrand["role"], string> = {
  target: "your brand",
  competitor: "tracked rival",
  emerged: "emerged",
};

const brandCols: Col<HeadlineBrand>[] = [
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
  rateCol("mentioned", "Mentioned", TIPS.mentioned, (b) => b.mentioned),
  rateCol("recommended", "Recommended", TIPS.recommended, (b) => b.recommended),
  rateCol("chosen", "Chosen", TIPS.chosen, (b) => b.chosen),
  rateCol("sod", "Share of decided", TIPS.shareOfDecided, (b) => b.shareOfDecided),
  rateCol("negative", "Negative", TIPS.negative, (b) => b.negative),
];

const sliceCols = (first: string): Col<HeadlineSlice>[] => [
  { id: "label", label: first, val: (s) => s.label },
  { id: "answers", label: "Answers", num: true, val: (s) => s.answers },
  rateCol("mentioned", "Mentioned", TIPS.mentioned, (s) => s.mentioned),
  rateCol("recommended", "Recommended", TIPS.recommended, (s) => s.recommended),
  rateCol("chosen", "Chosen", TIPS.chosen, (s) => s.chosen),
  rateCol("firm", "Firm pick in category", TIPS.inCategory, (s) => s.firmPickInCategory),
];

export default function HeadlineSection({ runId }: { runId: string }) {
  const [view, setView] = useState<HeadlineView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [allBrands, setAllBrands] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/headline`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`headline view failed (${r.status})`);
        const d = (await r.json()) as { view: HeadlineView | null };
        if (live) setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) {
    return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  }
  if (view === undefined) {
    return <div className="card px-5 py-4 text-[13px] text-ink-3">Loading the headline view...</div>;
  }
  if (view === null || view.answers === 0) return null;

  const target = view.brands.find((b) => b.role === "target");
  const brands = allBrands
    ? view.brands
    : view.brands.filter((b) => b.role !== "emerged" || rate(b.mentioned) >= 0.05);
  const outside = view.picks.ruledOut + view.picks.pending + view.picks.notInDictionary;
  const stages = view.byStage.map((s) => ({ ...s, label: STAGE_LABEL[s.key] ?? s.key }));

  return (
    <div className="grid gap-5">
      <section className="card p-6">
        <h2 className="section-label mb-1">Headline - questions that name no brand</h2>
        <p className="text-[13px] text-ink-3">
          {view.answers} answers to open-choice questions ({stages.map((s) => s.label).join(", ")}) on the
          core engine panel. Questions that name a brand are reported in their own views, never here.
          {view.uncoded > 0 && ` ${view.uncoded} more answers are not coded yet.`}
        </p>
      </section>

      {target && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile label="Mentioned" cell={target.mentioned} tip={TIPS.mentioned} />
          <Tile label="Recommended" cell={target.recommended} tip={TIPS.recommended} />
          <Tile label="Chosen" cell={target.chosen} tip={TIPS.chosen} />
          <Tile label="Share of decided" cell={target.shareOfDecided} tip={TIPS.shareOfDecided} />
        </div>
      )}

      <section className="card p-6 grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-label">How often the AI commits to one pick</h2>
          <span className="text-[13px] text-ink-2">
            <Tip tip={`${TIPS.firmPick} ${range(view.firmPick)}`}>
              <span className="cursor-help">Firm pick {pct(view.firmPick)}</span>
            </Tip>
            {" · "}
            <Tip tip={`${TIPS.inCategory} ${range(view.firmPickInCategory)}`}>
              <span className="cursor-help">in your category {pct(view.firmPickInCategory)}</span>
            </Tip>
          </span>
        </div>
        <OutcomeBar view={view} />
        {outside > 0 && (
          <div className="grid gap-1 border-t border-line pt-3">
            <div className="text-[13px] text-ink-3">
              {outside} of {view.outcomes.pick} picks are not an approved brand in your dictionary:
            </div>
            <NameList title="Ruled out on your brand board" items={view.ruledOutPicks} total={view.picks.ruledOut} />
            <NameList title="Not in your dictionary" items={view.notInDictionaryPicks} total={view.picks.notInDictionary} />
            <NameList title="Awaiting review" items={view.pendingPicks} total={view.picks.pending} />
          </div>
        )}
      </section>

      <section className="card p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="section-label">Brands in the headline answers</h2>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={allBrands} onChange={(e) => setAllBrands(e.target.checked)} />
            Show every emerged brand
          </label>
        </div>
        {!allBrands && brands.length < view.brands.length && (
          <p className="text-[12px] text-ink-3 mt-1">
            Emerged brands named in under 5% of answers are hidden ({view.brands.length - brands.length}).
          </p>
        )}
        <SortTable
          cols={brandCols}
          rows={brands}
          filename="headline_brands.csv"
          defaultSort={{ id: "mentioned", dir: -1 }}
        />
      </section>

      <section className="card p-6">
        <h2 className="section-label">{view.brand} by stage</h2>
        <SortTable cols={sliceCols("Stage")} rows={stages} filename="headline_by_stage.csv" defaultSort={{ id: "answers", dir: -1 }} />
      </section>

      <section className="card p-6">
        <h2 className="section-label">{view.brand} by engine</h2>
        <SortTable cols={sliceCols("Engine")} rows={view.byEngine} filename="headline_by_engine.csv" defaultSort={{ id: "mentioned", dir: -1 }} />
      </section>
    </div>
  );
}
