"use client";

import { useEffect, useState } from "react";
import type { AwarenessBlock, AwarenessSlice, AwarenessView, Route, WithoutGroup } from "@/lib/engine/awareness";
import { SortTable, Tip, type Col } from "./table";
import { AnswersModal, Legend, pct, range, rate, rateCol, StackBar, type AnswersTarget, type Part } from "./view_parts";

/**
 * The awareness views (2026-10-28): problem recognition (where the AI sends
 * a buyer who has a problem and does not yet know the category) and
 * category education (what the AI says when it explains the category).
 * Visibility only - no win or pick rate. Renders nothing until the run has
 * a codes source.
 */

const routeParts = (category: string): readonly Part<Route>[] => [
  { key: "category", label: `Told to get ${category}`, color: "bg-primary" },
  { key: "adjacent", label: "Solved without getting one", color: "bg-warning/60" },
  { key: "none", label: "No direction", color: "bg-neutral-bar" },
];

const routeTips = (category: string, kind: AwarenessBlock["view"]): Record<Route, string> => ({
  category: `Answers that tell the asker to get ${category} as the way to solve it.`,
  adjacent:
    kind === "routing"
      ? `Answers that solve it without the asker getting ${category}: fixing or using what they already have, a habit or routine, or another kind of product.`
      : `Answers that steer the newcomer away from ${category} to a different kind of solution.`,
  none:
    kind === "routing"
      ? "Answers that give advice without pointing to any kind of solution."
      : "Plain explainers that point nowhere - the normal answer to this kind of question.",
});

const namesTip = (brand: string) => `Answers that name ${brand} at all.`;
const recTip = (brand: string) => `Answers that recommend ${brand}.`;
const POINTS_TIP = "Answers that recommend at least one product by name, any brand.";

const sliceCols = (first: string, category: string, brand: string, kind: AwarenessBlock["view"]): Col<AwarenessSlice>[] => {
  const parts = routeParts(category);
  const tips = routeTips(category, kind);
  return [
    { id: "label", label: first, val: (s) => s.label },
    { id: "answers", label: "Answers", num: true, val: (s) => s.answers },
    {
      id: "bar",
      label: "What it tells them",
      val: (s) => Math.round(rate(s.routed.category) * 1000) / 10,
      render: (s) => <StackBar parts={parts} cells={s.routed} />,
    },
    ...parts.map((p) => rateCol<AwarenessSlice>(p.key, p.label, tips[p.key], (s) => s.routed[p.key])),
    rateCol("names", `Names ${brand}`, namesTip(brand), (s) => s.namesYou),
    rateCol("rec", `Recommends ${brand}`, recTip(brand), (s) => s.recommendsYou),
    rateCol("points", "Recommends a product", POINTS_TIP, (s) => s.pointsToProducts),
  ];
};

function Stat({ value, label, tip }: { value: string; label: string; tip: string }) {
  return (
    <Tip tip={tip}>
      <span className="cursor-help">
        <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{value}</span> {label}
      </span>
    </Tip>
  );
}

function Lists({ b }: { b: AwarenessBlock }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 text-[13px]">
      <div>
        <h3 className="text-[12px] font-medium text-ink-2 mb-1.5">Brands named</h3>
        {b.brands.length === 0 ? (
          <p className="text-ink-3">No brand is named.</p>
        ) : (
          <ul className="grid gap-1">
            {b.brands.map((x) => (
              <li key={x.name} className="flex items-baseline justify-between gap-3">
                <span className={x.you ? "font-medium text-ink" : "text-ink-2"}>{x.name}</span>
                <Tip tip={`${range(x.named)}; recommended in ${x.recommended}`}>
                  <span className="cursor-help tabular-nums text-ink-3">
                    {pct(x.named)}
                    {x.recommended > 0 && ` - recommended ${x.recommended}`}
                  </span>
                </Tip>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-[12px] font-medium text-ink-2 mb-1.5">What the answers talk about</h3>
        {b.topics.length === 0 ? (
          <p className="text-ink-3">No topics coded.</p>
        ) : (
          <ul className="grid gap-1">
            {b.topics.map((t) => (
              <li key={t.code} className="flex items-baseline justify-between gap-3">
                <span className="text-ink-2">{t.code}</span>
                <Tip tip={range(t.cell)}>
                  <span className="cursor-help tabular-nums text-ink-3">{pct(t.cell)}</span>
                </Tip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** How the "solved without getting one" answers solve it: their routing
 * quotes grouped at read time, each group opening its sample answers. */
function Without({ b, runId, title }: { b: AwarenessBlock; runId: string; title: string }) {
  const [opened, setOpened] = useState<AnswersTarget | null>(null);
  const w = b.without;
  const adjacent = b.routed.adjacent.k;
  if (adjacent === 0) return null;
  const open = (g: WithoutGroup) =>
    setOpened({
      title: g.label,
      subtitle: `${g.ids.length < g.cell.k ? `A sample of ${g.ids.length} of the ${g.cell.k} answers` : g.cell.k === 1 ? "The one answer" : `The ${g.cell.k} answers`} in this group.`,
      ids: g.ids,
      highlight: [g.label],
    });
  return (
    <div className="text-[13px]">
      <h3 className="text-[12px] font-medium text-ink-2 mb-1">{title}</h3>
      <p className="text-[12px] text-ink-3 mb-1.5">
        The {adjacent} answers grouped by the phrase that points the asker their way. Shares are of those {adjacent} answers.
      </p>
      {w.groups.length === 0 ? (
        <p className="text-ink-3">No two answers point the same way.</p>
      ) : (
        <ul className="grid gap-1">
          {w.groups.map((g) => (
            <li key={g.label} className="flex items-baseline justify-between gap-3">
              <button
                type="button"
                onClick={() => open(g)}
                className="text-left text-ink-2 underline decoration-ink-3/40 decoration-dotted underline-offset-2 hover:decoration-ink-3"
              >
                {g.label}
              </button>
              <Tip tip={range(g.cell)}>
                <span className="cursor-help shrink-0 tabular-nums text-ink-3">{pct(g.cell)}</span>
              </Tip>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[12px] text-ink-3">
        {w.rest > 0 && `${w.rest} more answers point their own way. `}
        {w.noQuote > 0 && `${w.noQuote} have no routing phrase. `}
        {w.grouping === "stems" && "Grouped by shared words only, so most answers stay ungrouped."}
      </p>
      {opened && <AnswersModal key={opened.ids.join(",")} runId={runId} target={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}

function RoutingCard({ b, brand, category, runId }: { b: AwarenessBlock; brand: string; category: string; runId: string }) {
  const parts = routeParts(category);
  const tips = routeTips(category, "routing");
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">Problem recognition - does the AI tell someone with a problem to get one</h2>
        <p className="text-[13px] text-ink-3">
          Questions from people describing a problem without naming {category}. {b.answers} answers on the
          core engine panel. Visibility only - these questions have no win or pick rate.
          {b.uncoded > 0 && ` ${b.uncoded} more answers are not coded yet.`}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Stat value={pct(b.routed.category)} label={`told to get ${category}`} tip={`${tips.category} ${range(b.routed.category)}`} />
        <Stat value={pct(b.routed.adjacent)} label="solved without getting one" tip={`${tips.adjacent} ${range(b.routed.adjacent)}`} />
        <Stat value={pct(b.namesYou)} label={`name ${brand}`} tip={`${namesTip(brand)} ${range(b.namesYou)}`} />
        <Stat value={pct(b.pointsToProducts)} label="recommend a product" tip={`${POINTS_TIP} ${range(b.pointsToProducts)}`} />
      </div>
      <div className="grid gap-2">
        <div className="h-4">
          <StackBar parts={parts} cells={b.routed} />
        </div>
        <Legend parts={parts} cells={b.routed} />
      </div>
      {b.rooms.length > 0 && (
        <SortTable
          cols={sliceCols("Room", category, brand, "routing")}
          rows={b.rooms}
          filename="problem_recognition_by_room.csv"
          defaultSort={{ id: "category", dir: -1 }}
        />
      )}
      <Without b={b} runId={runId} title="Solved without getting one - how" />
      <Lists b={b} />
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">By engine</summary>
        <SortTable
          cols={sliceCols("Engine", category, brand, "routing")}
          rows={b.byEngine}
          filename="problem_recognition_by_engine.csv"
          defaultSort={{ id: "category", dir: -1 }}
        />
      </details>
    </section>
  );
}

function ExplainerCard({ b, brand, category, runId }: { b: AwarenessBlock; brand: string; category: string; runId: string }) {
  const tips = routeTips(category, "explainer");
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">Category education - explaining {category} to a newcomer</h2>
        <p className="text-[13px] text-ink-3">
          Questions from people learning what {category} are. {b.answers} answers on the core engine panel. Visibility
          only - these questions have no win or pick rate.
          {b.uncoded > 0 && ` ${b.uncoded} more answers are not coded yet.`}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Stat value={pct(b.namesYou)} label={`name ${brand}`} tip={`${namesTip(brand)} ${range(b.namesYou)}`} />
        <Stat value={pct(b.recommendsYou)} label={`recommend ${brand}`} tip={`${recTip(brand)} ${range(b.recommendsYou)}`} />
        <Stat
          value={pct(b.pointsToProducts)}
          label="recommend a product"
          tip={`${POINTS_TIP} An explainer usually recommends nothing, so this is the AI selling to newcomers. ${range(b.pointsToProducts)}`}
        />
        <Stat value={pct(b.routed.adjacent)} label="steer away" tip={`${tips.adjacent} ${range(b.routed.adjacent)}`} />
      </div>
      <Without b={b} runId={runId} title="Steered away - to what" />
      <Lists b={b} />
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">By engine</summary>
        <SortTable
          cols={sliceCols("Engine", category, brand, "explainer")}
          rows={b.byEngine}
          filename="category_education_by_engine.csv"
          defaultSort={{ id: "names", dir: -1 }}
        />
      </details>
    </section>
  );
}

export default function AwarenessSections({ runId }: { runId: string }) {
  const [view, setView] = useState<AwarenessView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/awareness`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`awareness view failed (${r.status})`);
        const d = (await r.json()) as { view: AwarenessView | null };
        if (live) setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (!view) return null;
  return (
    <>
      {view.routing && view.routing.answers > 0 && <RoutingCard b={view.routing} brand={view.brand} category={view.category} runId={runId} />}
      {view.explainer && view.explainer.answers > 0 && (
        <ExplainerCard b={view.explainer} brand={view.brand} category={view.category} runId={runId} />
      )}
    </>
  );
}
