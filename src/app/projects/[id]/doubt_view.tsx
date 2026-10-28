"use client";

import { useEffect, useState } from "react";
import type { ExitRow } from "@/lib/engine/exits";
import type { DoubtSlice, DoubtView, DoubtViews, Premise, WorryRow } from "@/lib/engine/doubt";
import { SortTable, Tip, type Col } from "./table";
import { Legend, pct, range, rate, rateCol, StackBar, type Part } from "./view_parts";

/**
 * The doubt views (2026-10-27): objections (a buyer's worry before buying)
 * and churn / renewal (a customer's worry about staying), read per worry and
 * reported apart from the headline. Renders nothing until the run has a
 * codes source.
 */

const STAGE_LABEL: Record<string, string> = {
  objections: "Objection",
  churn_triggers: "Churn",
  renewal: "Renewal",
};

const PREMISE_PARTS: readonly Part<Premise>[] = [
  { key: "confirms", label: "Agrees with the worry", color: "bg-danger/55" },
  { key: "mixed", label: "Partly agrees", color: "bg-warning/60" },
  { key: "rebuts", label: "Rebuts it", color: "bg-primary" },
];

const PREMISE_TIPS: Record<Premise, string> = {
  confirms: "Answers that tell the asker the worry is warranted.",
  mixed: "Answers that grant part of the worry and push back on part.",
  rebuts: "Answers that tell the asker the worry is not warranted.",
};

interface Kind<V extends string> {
  title: string;
  blurb: (brand: string) => string;
  parts: readonly Part<V>[];
  tips: Record<V, string>;
  /** The verdict the brand wants (the headline figure). */
  good: V;
  exitTip: string;
  exitNote: string;
  csv: string;
}

const OBJECTIONS: Kind<"proceed" | "avoid" | "undecided"> = {
  title: "Doubts - buyers' worries before buying",
  blurb: (b) => `Questions from someone who does not have ${b} yet and voices one worry about it.`,
  parts: [
    { key: "proceed", label: "Go ahead", color: "bg-primary" },
    { key: "avoid", label: "Avoid it", color: "bg-danger/55" },
    { key: "undecided", label: "Takes no side", color: "bg-neutral-bar" },
  ],
  tips: {
    proceed: "Answers that advise going ahead with your brand despite the worry.",
    avoid: "Answers that advise against your brand. Listing alternatives because the asker asked for them is not advice to avoid.",
    undecided: "Answers that take no side between going ahead and avoiding.",
  },
  good: "proceed",
  exitTip: "Answers that name at least one other brand to consider instead, whatever they advise.",
  exitNote:
    "Exits are counted whatever the answer advises: a rival named beside advice to go ahead is a way out shown to the buyer, not a sale lost.",
  csv: "doubts_objections",
};

const STAY: Kind<"keep" | "leave" | "undecided"> = {
  title: "Doubts - customers' worries about staying",
  blurb: (b) => `Questions from someone already on ${b} who voices one worry and asks whether to stay (churn) or renew when the bill comes due (renewal).`,
  parts: [
    { key: "keep", label: "Advises staying", color: "bg-primary" },
    { key: "leave", label: "Advises leaving", color: "bg-danger/55" },
    { key: "undecided", label: "Takes no side", color: "bg-neutral-bar" },
  ],
  tips: {
    keep: "Answers that advise staying. A move to another of your own plans or products counts as staying.",
    leave: "Answers that advise leaving: cancel, pause, stop or switch.",
    undecided: "Answers that take no side between staying and leaving.",
  },
  good: "keep",
  exitTip: "Answers that name at least one other brand to move to. On these questions only leavers are sent anywhere.",
  exitNote: "Brands are named only on answers that advise leaving; a leaver with no brand named is told to cancel outright.",
  csv: "doubts_keep_or_leave",
};

const names = (xs: { name: string; n: number }[]) => xs.map((x) => `${x.name} (${x.n})`).join(", ");

function verdictCols<V extends string>(kind: Kind<V>): Col<WorryRow<V>>[] {
  return kind.parts.map((p) => rateCol<WorryRow<V>>(p.key, p.label, kind.tips[p.key], (r) => r.verdicts[p.key]));
}

function WorryTable<V extends string>({ view, kind, stages }: { view: DoubtView<V>; kind: Kind<V>; stages: boolean }) {
  const cols: Col<WorryRow<V>>[] = [
    {
      id: "concern",
      label: "Worry",
      val: (r) => r.concern,
      render: (r) => (
        <span>
          {r.concern || <span className="text-ink-3">No worry recorded</span>}
          {stages && <span className="ml-2 text-[11px] text-ink-3">{STAGE_LABEL[r.stage] ?? r.stage}</span>}
        </span>
      ),
    },
    { id: "answers", label: "Answers", num: true, val: (r) => r.answers },
    {
      id: "bar",
      label: "Advice",
      val: (r) => Math.round(rate(r.verdicts[kind.good]) * 1000) / 10,
      render: (r) => <StackBar parts={kind.parts} cells={r.verdicts} />,
    },
    ...verdictCols(kind),
    rateCol("confirms", "Agrees with the worry", PREMISE_TIPS.confirms, (r) => r.premise.confirms),
    rateCol("rebuts", "Rebuts it", PREMISE_TIPS.rebuts, (r) => r.premise.rebuts),
    rateCol("exit", "Names an exit", kind.exitTip, (r) => r.offersExit),
    {
      id: "top",
      label: "Exits named",
      val: (r) => r.topExits[0]?.name ?? "",
      render: (r) => <span className="text-[12px] text-ink-2">{names(r.topExits) || "-"}</span>,
    },
  ];
  return <SortTable cols={cols} rows={view.rows} filename={`${kind.csv}_by_worry.csv`} defaultSort={{ id: "answers", dir: -1 }} />;
}

/** When the AI agrees with the worry, how often does it still advise the brand? */
function Matrix<V extends string>({ view, kind }: { view: DoubtView<V>; kind: Kind<V> }) {
  const premises = PREMISE_PARTS.filter((p) => view.matrix[p.key][kind.good].n > 0);
  return (
    <table className="text-[13px]">
      <thead>
        <tr className="text-ink-3 text-[12px]">
          <th className="text-left font-medium pr-6 pb-1">When the answer...</th>
          <th className="text-right font-medium pr-4 pb-1">Answers</th>
          {kind.parts.map((p) => (
            <th key={p.key} className="text-right font-medium pr-4 pb-1">
              {p.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {premises.map((p) => {
          const row = view.matrix[p.key];
          return (
            <tr key={p.key} className="border-t border-line">
              <td className="pr-6 py-1.5">{p.label.toLowerCase()}</td>
              <td className="text-right pr-4 tabular-nums">{row[kind.good].n}</td>
              {kind.parts.map((v) => (
                <td key={v.key} className="text-right pr-4 tabular-nums">
                  <Tip tip={range(row[v.key])}>
                    <span className="cursor-help">{pct(row[v.key])}</span>
                  </Tip>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ExitTable<V extends string>({ view, kind }: { view: DoubtView<V>; kind: Kind<V> }) {
  const [all, setAll] = useState(false);
  const rows = all ? view.exits : view.exits.filter((d) => d.role === "competitor" || rate(d.offered) >= 0.05);
  const cols: Col<ExitRow<V>>[] = [
    {
      id: "name",
      label: "Exit named",
      val: (d) => d.name,
      render: (d) => (
        <span>
          {d.name}
          <span className="ml-2 text-[11px] text-ink-3">{d.role === "competitor" ? "tracked rival" : "emerged"}</span>
        </span>
      ),
    },
    rateCol("offered", "Named", "Answers that name this brand as somewhere to go, over every answer in the view.", (d) => d.offered),
    ...kind.parts.map((p): Col<ExitRow<V>> => {
      const n = view.verdicts[p.key].k;
      return {
        id: p.key,
        label: `On "${p.label.toLowerCase()}"`,
        tip: `Of the answers that ${p.label.toLowerCase()}, how many name this brand.`,
        num: true,
        val: (d) => (n > 0 ? d.by[p.key] / n : null),
        render: (d) => (n > 0 ? <span>{d.by[p.key]} of {n}</span> : <span className="text-ink-3">-</span>),
      };
    }),
  ];
  if (view.exits.length === 0) return null;
  return (
    <div className="grid gap-2">
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Show every exit named
      </label>
      {!all && rows.length < view.exits.length && (
        <p className="text-[12px] text-ink-3">
          Emerged brands named in under 5% of answers are hidden ({view.exits.length - rows.length}).
        </p>
      )}
      <SortTable cols={cols} rows={rows} filename={`${kind.csv}_exits.csv`} defaultSort={{ id: "offered", dir: -1 }} />
    </div>
  );
}

function sliceCols<V extends string>(kind: Kind<V>, first: string): Col<DoubtSlice<V>>[] {
  return [
    { id: "label", label: first, val: (s) => s.label },
    { id: "answers", label: "Answers", num: true, val: (s) => s.answers },
    ...kind.parts.map((p) => rateCol<DoubtSlice<V>>(p.key, p.label, kind.tips[p.key], (s) => s.verdicts[p.key])),
    rateCol("confirms", "Agrees with the worry", PREMISE_TIPS.confirms, (s) => s.confirms),
    rateCol("exit", "Names an exit", kind.exitTip, (s) => s.offersExit),
  ];
}

function DoubtSection<V extends string>({ view, kind }: { view: DoubtView<V>; kind: Kind<V> }) {
  const multiStage = view.stages.length > 1;
  const goodPart = kind.parts.find((p) => p.key === kind.good)!;
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">{kind.title}</h2>
        <p className="text-[13px] text-ink-3">
          {kind.blurb(view.brand)} {view.answers} answers on the core engine panel, reported apart from the headline.
          {view.uncoded > 0 && ` ${view.uncoded} more answers are not coded yet.`}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Tip tip={`${kind.tips[kind.good]} ${range(view.verdicts[kind.good])}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(view.verdicts[kind.good])}</span>{" "}
            {goodPart.label.toLowerCase()}
          </span>
        </Tip>
        <Tip tip={`${PREMISE_TIPS.confirms} ${range(view.premise.confirms)}`}>
          <span className="cursor-help">{pct(view.premise.confirms)} agree with the worry</span>
        </Tip>
        <Tip tip={`${kind.exitTip} ${range(view.offersExit)}`}>
          <span className="cursor-help">{pct(view.offersExit)} name an exit</span>
        </Tip>
      </div>
      <div className="grid gap-2">
        <div className="h-4">
          <StackBar parts={kind.parts} cells={view.verdicts} />
        </div>
        <Legend parts={kind.parts} cells={view.verdicts} />
      </div>
      <WorryTable view={view} kind={kind} stages={multiStage} />
      <details className="text-[13px]" open>
        <summary className="cursor-pointer text-ink-2">Does agreeing with the worry change the advice?</summary>
        <div className="mt-2">
          <Matrix view={view} kind={kind} />
        </div>
      </details>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">Exits named</summary>
        <div className="grid gap-2 mt-2">
          <p className="text-[12px] text-ink-3">{kind.exitNote}</p>
          <ExitTable view={view} kind={kind} />
          {view.outsideExits.length > 0 && (
            <p className="text-[12px] text-ink-3">Exits outside your dictionary: {names(view.outsideExits)}.</p>
          )}
        </div>
      </details>
      {multiStage && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-ink-2">By stage</summary>
          <SortTable
            cols={sliceCols(kind, "Stage")}
            rows={view.byStage.map((s) => ({ ...s, label: STAGE_LABEL[s.key] ?? s.key }))}
            filename={`${kind.csv}_by_stage.csv`}
            defaultSort={{ id: "answers", dir: -1 }}
          />
        </details>
      )}
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">By engine</summary>
        <SortTable cols={sliceCols(kind, "Engine")} rows={view.byEngine} filename={`${kind.csv}_by_engine.csv`} defaultSort={{ id: kind.good, dir: -1 }} />
      </details>
    </section>
  );
}

export default function DoubtSections({ runId }: { runId: string }) {
  const [views, setViews] = useState<DoubtViews | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/doubt`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`doubt view failed (${r.status})`);
        const d = (await r.json()) as { views: DoubtViews | null };
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
      {views.objections && views.objections.answers > 0 && <DoubtSection view={views.objections} kind={OBJECTIONS} />}
      {views.keepOrLeave && views.keepOrLeave.answers > 0 && <DoubtSection view={views.keepOrLeave} kind={STAY} />}
    </>
  );
}
