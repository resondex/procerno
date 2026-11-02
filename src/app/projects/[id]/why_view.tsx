"use client";

import { useEffect, useState } from "react";
import type { BrandSummaryView, ReasonLift } from "@/lib/engine/brand_summary";
import type { RuleGroup, RulesView } from "@/lib/engine/rules_explorer";
import type { DoubtViews, ObjectionVerdict, WorryRow } from "@/lib/engine/doubt";
import { SortTable, Tip, type Col } from "./table";
import { BaseNote, Names, rateCol } from "./view_parts";
import RulesSection from "./rules_view";
import ReasonsSection from "./reasons_view";

/**
 * Why - an Analysis LENS (RATIFIED 2026-11-01, WORKBENCH_REDESIGN_2026-10-30.md
 * top section): why the AI picks you, and why it doesn't. Two kinds of cause
 * kept apart - arguments (what an answer argues from, as lift: share when
 * you are picked minus when a rival is) and conditions (the circumstances an
 * answer states before routing the pick) - then the doubts table.
 *
 * A lens, so partial by design: it reads only the cells that carry
 * arguments, conditions or a worry. Everything here also has a home under
 * Stations. It composes three EXISTING cached views client-side
 * (brand_summary, rules, doubt) - no engine of its own.
 *
 * Surface rule (2026-11-01): no answer counts on bars or cells - ranges on
 * hover, counts in the csv only; condition lines carry their muted count,
 * the one honest unit for a condition.
 */

const TOP_LIFT = 3;
const TOP_CONDITIONS = 5;
const MAX_ROUTES = 3;

/** The rules engine's placeholder destinations ("A cheaper option (none
 * named)") - not brands, so never listed as where a lost pick goes. */
const GENERIC_ROUTE = /\((none|no [a-z]+) named\)$/i;

interface Loaded {
  summary: BrandSummaryView | null;
  rules: RulesView | null;
  doubt: DoubtViews | null;
}

async function getJson<T>(url: string, field: "view" | "views"): Promise<T | null> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.split("/").pop()} failed (${r.status})`);
  const d = (await r.json()) as Record<string, T | null>;
  return d[field] ?? null;
}

const points = (x: number) => {
  const p = Math.round(x * 100);
  return p > 0 ? `+${p}` : `${p}`;
};

function LiftBars({ lift }: { lift: ReasonLift[] }) {
  const up = lift.filter((l) => l.lift > 0).sort((a, b) => b.lift - a.lift).slice(0, TOP_LIFT);
  const down = lift.filter((l) => l.lift < 0).sort((a, b) => a.lift - b.lift).slice(0, TOP_LIFT);
  const shown = [...up, ...down];
  const max = Math.max(...shown.map((l) => Math.abs(l.lift)), 0.0001);
  if (shown.length === 0) return <p className="text-[12px] text-ink-3">No argument separates your picks from rivals&apos;.</p>;
  return (
    <div className="grid gap-1.5">
      {shown.map((l) => {
        const good = l.lift > 0;
        return (
          <div key={l.code} className="grid grid-cols-[minmax(0,1fr)_6rem_2.75rem] items-center gap-3">
            <span className="truncate text-[13px] text-ink-2">{l.code}</span>
            <div className="h-2 rounded-full bg-neutral-bar/40 overflow-hidden">
              <div
                className={`h-full rounded-full ${good ? "bg-success" : "bg-danger"}`}
                style={{ width: `${(Math.abs(l.lift) / max) * 100}%` }}
              />
            </div>
            <Tip
              tip={`Argued in ${Math.round((l.wins.n ? l.wins.k / l.wins.n : 0) * 100)}% of answers that pick you, ${Math.round(
                (l.others.n ? l.others.k / l.others.n : 0) * 100
              )}% of answers that pick a rival - a difference of ${points(l.lift)} points`}
            >
              <span className={`cursor-help text-right text-[13px] tabular-nums ${good ? "text-success" : "text-danger"}`}>
                {points(l.lift)}
              </span>
            </Tip>
          </div>
        );
      })}
    </div>
  );
}

const liftCols: Col<ReasonLift>[] = [
  { id: "code", label: "Argument", val: (r) => r.code },
  rateCol<ReasonLift>("wins", "In your picks", "Share of answers that pick you arguing it", (r) => r.wins),
  rateCol<ReasonLift>("others", "In rivals' picks", "Share of answers that pick another brand in your category arguing it", (r) => r.others),
  {
    id: "lift",
    label: "Lift",
    tip: "Share in your picks minus share in rivals' picks, in points",
    num: true,
    val: (r) => Math.round(r.lift * 1000) / 10,
    render: (r) => <span className={r.lift > 0 ? "text-success" : r.lift < 0 ? "text-danger" : ""}>{points(r.lift)}</span>,
  },
  { id: "winsN", label: "Answers picking you", csvOnly: true, val: (r) => r.wins.n },
  { id: "othersN", label: "Answers picking a rival", csvOnly: true, val: (r) => r.others.n },
];

function topSide(groups: RuleGroup[], side: "you" | "away") {
  return groups
    .filter((g) => g.side === side)
    .sort((a, b) => b.answers - a.answers)
    .slice(0, TOP_CONDITIONS);
}

function ConditionLines({ title, groups, routes }: { title: string; groups: RuleGroup[]; routes: boolean }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-ink mb-2">{title}</div>
      {groups.length === 0 ? (
        <p className="text-[12px] text-ink-3">No conditions stated here.</p>
      ) : (
        <ul className="grid gap-1.5">
          {groups.map((g) => {
            const to = routes
              ? g.routes.filter((r) => !GENERIC_ROUTE.test(r.name)).slice(0, MAX_ROUTES)
              : [];
            return (
              <li key={g.id} className="text-[13px] text-ink-2">
                {g.label} <span className="text-[11px] text-ink-3 tabular-nums">{g.answers}</span>
                {to.length > 0 && (
                  <span className="text-[12px] text-ink-3">
                    {" -> "}
                    <Names items={to} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type Worry = WorryRow<ObjectionVerdict>;
const doubtCols: Col<Worry>[] = [
  { id: "concern", label: "Worry", val: (r) => r.concern },
  rateCol<Worry>("confirms", "Agrees with it", "The answer tells the buyer the worry is warranted (of answers that judge it)", (r) => r.premise.confirms),
  rateCol<Worry>("rebuts", "Pushes back", "The answer tells the buyer the worry is not warranted (rebuts, of answers that judge it)", (r) => r.premise.rebuts),
  rateCol<Worry>("proceed", "Go ahead anyway", "The answer tells the buyer to go ahead with you", (r) => r.verdicts.proceed),
  {
    id: "exits",
    label: "Sends them to",
    tip: "Other brands the answers point the buyer to (names an exit), most often first",
    val: (r) => r.topExits.slice(0, 3).map((x) => x.name).join(", "),
    render: (r) => (
      <span className="text-[12px] text-ink-2">
        <Names items={r.topExits.slice(0, 3)} />
      </span>
    ),
  },
  { id: "answers", label: "Answers", csvOnly: true, val: (r) => r.answers },
];

export default function WhySection({ runId }: { runId: string }) {
  const [data, setData] = useState<Loaded | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const base = `/api/runs/${runId}`;
    const soft = <T,>(p: Promise<T | null>) => p.catch(() => null);
    Promise.all([
      soft(getJson<BrandSummaryView>(`${base}/brand_summary`, "view")),
      soft(getJson<RulesView>(`${base}/rules`, "view")),
      soft(getJson<DoubtViews>(`${base}/doubt`, "views")),
    ])
      .then(([summary, rules, doubt]) => live && setData({ summary, rules, doubt }))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (data === undefined) return <div className="card px-5 py-4 text-[13px] text-ink-3">Loading why...</div>;

  const lift = data.summary?.reasonLift ?? [];
  const rules = data.rules && data.rules.answers > 0 ? data.rules : null;
  const win = rules ? topSide(rules.groups, "you") : [];
  const lose = rules ? topSide(rules.groups, "away") : [];
  const worries = data.doubt?.objections?.rows ?? [];
  const hasArgs = lift.length > 0;
  const hasConds = win.length > 0 || lose.length > 0;
  if (!hasArgs && !hasConds && worries.length === 0) return null;

  return (
    <div className="grid gap-5">
      <section className="card p-6 grid gap-5">
        <div>
          <h2 className="section-label mb-1">Why</h2>
          <h3 className="text-[15px] font-semibold">Why the AI picks you, and why it doesn&apos;t</h3>
          <p className="text-[13px] text-ink-3 mt-1">
            Arguments are what an answer argues from; conditions are the circumstances it states before routing the
            pick.
          </p>
        </div>

        {(hasArgs || hasConds) && (
          <div className="grid md:grid-cols-2 gap-6">
            {hasArgs && (
              <div className="grid gap-3 content-start">
                <h4 className="section-label">
                  <Tip tip="Only answers to which-should-I-get questions that pick one brand in your category.">
                    <span className="cursor-help">Arguments - share when you are picked minus when a rival is</span>
                  </Tip>
                </h4>
                <LiftBars lift={lift} />
                <details>
                  <summary className="cursor-pointer text-[12px] text-primary underline decoration-dotted underline-offset-2">
                    All arguments
                  </summary>
                  <div className="grid gap-4 pt-3">
                    <SortTable
                      cols={liftCols}
                      rows={lift}
                      filename="why_arguments.csv"
                      defaultSort={{ id: "lift", dir: -1 }}
                    />
                    {/* The full reasons table with every question kind - the
                        one place the all-types picker lives; each station
                        shows only its own kinds. */}
                    <ReasonsSection runId={runId} />
                  </div>
                </details>
              </div>
            )}
            {hasConds && (
              <div className="grid gap-4 content-start">
                <h4 className="section-label">
                  <Tip tip="Every answer that states a condition before routing its pick, across every kind of question that carries them. The small number is how many answers state it.">
                    <span className="cursor-help">Conditions - stated by the answer</span>
                  </Tip>
                </h4>
                <ConditionLines title="You win when the buyer" groups={win} routes={false} />
                <ConditionLines title="You lose when the buyer" groups={lose} routes />
                <details>
                  <summary className="cursor-pointer text-[12px] text-primary underline decoration-dotted underline-offset-2">
                    All conditions
                  </summary>
                  <div className="mt-3 grid gap-5">
                    <RulesSection runId={runId} />
                  </div>
                </details>
              </div>
            )}
          </div>
        )}
      </section>

      {worries.length > 0 && (
        <section className="card p-6 grid gap-2">
          <h4 className="section-label">The doubts, and whether the AI grants them</h4>
          <SortTable cols={doubtCols} rows={worries} filename="why_doubts.csv" defaultSort={{ id: "confirms", dir: -1 }} />
          <p className="text-[12px] text-ink-3">
            Your customers&apos; worries - whether the AI tells them to stay - live under Stations, in Customers.
          </p>
        </section>
      )}

      <BaseNote>Based on every answer that argues or states a condition, across all buyers.</BaseNote>
    </div>
  );
}
