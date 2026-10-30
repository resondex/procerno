"use client";

import { useEffect, useState } from "react";
import type { BrandSummaryView, RateCell, SummaryBrand } from "@/lib/engine/brand_summary";

/**
 * The Boardroom and Five-questions views, answer_codes era (2026-10-30):
 * both render from the brand summary (engine/brand_summary.ts) - the
 * headline pool's funnel, outcome split and brand table, plus the doubt and
 * head-to-head rollups. Every figure here also appears in the brief's own
 * sections with its full table; these views are the executive cut.
 */

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pct = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = rate(c);
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
const range = (c: RateCell) =>
  c.n === 0 ? "no answers" : `${c.k} of ${c.n} - 95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)} pts`;

function useBrandSummary(runId: string) {
  const [view, setView] = useState<BrandSummaryView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/brand_summary`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`brand summary failed (${r.status})`);
        const d = (await r.json()) as { view: BrandSummaryView | null };
        if (live) setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);
  return { view, error };
}

function Shell({ view, error, children }: {
  view: BrandSummaryView | null | undefined;
  error: string | null;
  children: (v: BrandSummaryView) => React.ReactNode;
}) {
  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (view === undefined)
    return <div className="card px-5 py-4 text-[13px] text-ink-3">Reading the coded answers...</div>;
  if (view === null || view.answers === 0)
    return (
      <div className="card px-5 py-4 text-[13px] text-ink-3">
        No coded open-choice answers yet - this view fills in once the run is measured.
      </div>
    );
  return <>{children(view)}</>;
}

function BarRow({ name, share, max, isTarget, right }: {
  name: string;
  share: number;
  max: number;
  isTarget?: boolean;
  right: string;
}) {
  return (
    <div className="grid grid-cols-[11rem_1fr_9rem] items-center gap-3">
      <span className={`truncate text-sm text-right ${isTarget ? "font-semibold text-primary" : "text-ink-2"}`}>
        {name}
      </span>
      <div className="h-4 relative">
        <div
          className={`absolute inset-y-0 left-0 rounded-r-[4px] ${isTarget ? "bg-primary" : "bg-neutral-bar"}`}
          style={{ width: `${(share / (max || 1)) * 100}%` }}
        />
      </div>
      <span className="text-sm tabular-nums text-ink-2">{right}</span>
    </div>
  );
}

/** Top rivals by share of decided, the target always on the board. */
function pickBoard(view: BrandSummaryView, limit: number): SummaryBrand[] {
  const rivals = view.brands.filter((b) => b.role !== "target" && b.chosen.k > 0).slice(0, limit);
  return [view.target, ...rivals].sort((a, b) => rate(b.shareOfDecided) - rate(a.shareOfDecided));
}

/* ================================================================== */
/* The Boardroom: the 90-second screen                                 */
/* ================================================================== */

export function BoardroomSection({ runId }: { runId: string }) {
  const { view, error } = useBrandSummary(runId);
  return (
    <Shell view={view} error={error}>
      {(v) => <Boardroom v={v} />}
    </Shell>
  );
}

function Boardroom({ v }: { v: BrandSummaryView }) {
  const rivals = v.brands.filter((b) => b.role !== "target");
  const topRival = rivals.find((b) => b.chosen.k > 0) ?? null;
  const bestLift = v.reasonLift[0];
  const worstLift = v.reasonLift.length > 1 ? v.reasonLift[v.reasonLift.length - 1] : undefined;
  const signals = [
    topRival && {
      label: "Who takes the room",
      title: topRival.name,
      body: `wins ${pct(topRival.shareOfDecided)} of the answers that picked a brand in your category - you win ${pct(v.target.shareOfDecided)}.`,
      foot: `${topRival.chosen.k} picks to your ${v.target.chosen.k}, of ${v.firmPickInCategory.k} decided answers.`,
    },
    bestLift &&
      worstLift && {
        label: "The arguments",
        title: bestLift.code,
        body: `travels with your wins (${pts(bestLift.lift)} vs answers that pick a rival). The conversations you lose argue ${worstLift.code} (${pts(worstLift.lift)}).`,
        foot: `Measured over ${v.reasonLift[0].wins.n} wins and ${v.reasonLift[0].others.n} rival picks.`,
      },
    (v.buyersDoubt || v.customersDoubt) && {
      label: "The doubts",
      title: [
        v.buyersDoubt && `buyers told to go ahead ${pct(v.buyersDoubt.proceed)}`,
        v.customersDoubt && `customers told to stay ${pct(v.customersDoubt.keep)}`,
      ]
        .filter(Boolean)
        .join(" - "),
      body: [
        v.buyersDoubt && `When a buyer voices a worry about ${v.brand}, the AI agrees it is warranted ${pct(v.buyersDoubt.agree)} of the time.`,
        v.customersDoubt && `Customers weighing the worry are told to leave ${pct(v.customersDoubt.leave)}.`,
      ]
        .filter(Boolean)
        .join(" "),
      foot: `${(v.buyersDoubt?.answers ?? 0) + (v.customersDoubt?.answers ?? 0)} worry answers, reported apart from the headline.`,
    },
  ].filter(Boolean) as { label: string; title: string; body: string; foot: string }[];

  return (
    <div className="grid gap-5">
      <section className="card p-8 border-l-4 border-l-[var(--color-primary)]">
        <div className="section-label mb-3">The verdict</div>
        <p className="text-xl leading-snug text-ink-2 max-w-[62ch]">
          When {v.answers} AI answers field open buying questions about{" "}
          {v.category},{" "}
          <span className="font-semibold text-ink">
            {v.brand} is in the room {pct(v.target.mentioned)} of the time - and wins it{" "}
            {pct(v.target.shareOfDecided)} when a brand is picked
          </span>
          . The gap between those two numbers is the whole assignment.
        </p>
        <p className="text-[13px] text-ink-3 mt-3">
          Open-choice questions only - questions that name a brand are measured in their own views.
          {v.uncoded > 0 && ` ${v.uncoded} answers are not coded yet.`}
        </p>
      </section>

      <section className="card p-8">
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { label: "Mentioned", cell: v.target.mentioned },
            { label: "Recommended", cell: v.target.recommended },
            { label: "Chosen", cell: v.target.chosen },
          ].map((s, i) => (
            <div key={s.label} className="relative" title={range(s.cell)}>
              {i > 0 && (
                <span className="absolute -left-2 top-1/2 -translate-y-1/2 text-ink-3">›</span>
              )}
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{s.label}</div>
              <div className="text-4xl font-semibold tabular-nums text-primary mt-1.5">{pct(s.cell)}</div>
              <div className="text-[12px] text-ink-3 mt-1">{s.cell.k} of {s.cell.n} answers</div>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-ink-3 text-center mt-5">
          Mentioned › recommended › chosen, all of the same {v.answers} answers. The drop between
          stages says what kind of problem you have. Of the {v.firmPick.k} answers that committed to
          a pick, {v.firmPickInCategory.k} picked a brand in your category.
        </p>
      </section>

      {signals.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-3">
          {signals.map((s, i) => (
            <div key={s.label} className="card p-5 grid gap-1.5 content-start">
              <div className="section-label">Signal {i + 1} - {s.label}</div>
              <div className="text-[15px] font-semibold">{s.title}</div>
              <p className="text-[13px] text-ink-2">{s.body}</p>
              <p className="text-[12px] text-ink-3">{s.foot}</p>
            </div>
          ))}
        </section>
      )}

      <p className="card p-5 text-center text-[13px] text-ink-3">
        Every figure reads from the coded answers - the brief carries the full table behind each one.
      </p>
    </div>
  );
}

/* ================================================================== */
/* The Five Questions                                                  */
/* ================================================================== */

export function QuestionsSection({ runId }: { runId: string }) {
  const { view, error } = useBrandSummary(runId);
  return (
    <Shell view={view} error={error}>
      {(v) => <Questions v={v} />}
    </Shell>
  );
}

function Q({ n, q, children }: { n: number; q: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <div className="grid md:grid-cols-[13rem_1fr] gap-4 items-start">
        <div>
          <div className="section-label">Question {n}</div>
          <h2 className="text-lg font-semibold leading-snug mt-1">{q}</h2>
        </div>
        <div className="grid gap-2 min-w-0">{children}</div>
      </div>
    </section>
  );
}

function Big({ cell, sub }: { cell: RateCell; sub: string }) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <span className="text-4xl font-semibold tabular-nums text-primary" title={range(cell)}>
        {pct(cell)}
      </span>
      <span className="text-[13px] text-ink-3">{sub}</span>
    </div>
  );
}

function Questions({ v }: { v: BrandSummaryView }) {
  const engines = [...v.byEngine].sort((a, b) => rate(a.mentioned) - rate(b.mentioned));
  const low = engines[0];
  const high = engines[engines.length - 1];
  const instinct = v.byMode.find((m) => m.mode === "instinct");
  const search = v.byMode.find((m) => m.mode === "search");
  const board = pickBoard(v, 4);
  const maxPick = Math.max(...board.map((b) => rate(b.shareOfDecided)), 0.01);
  const bestLift = v.reasonLift[0];
  const worstLift = v.reasonLift.length > 1 ? v.reasonLift[v.reasonLift.length - 1] : undefined;
  const h2h = v.headToHead.slice(0, 6);
  const maxWin = Math.max(...h2h.map((r) => rate(r.winOfDecided)), 0.01);

  return (
    <div className="grid gap-4">
      <Q n={1} q="Do the AIs know you?">
        <Big
          cell={v.target.mentioned}
          sub={`of ${v.answers} open-choice answers name ${v.brand}`}
        />
        {low && high && low.key !== high.key && (
          <p className="text-[13px] text-ink-2">
            The spread across engines runs from {pct(low.mentioned)} ({low.label}) to{" "}
            {pct(high.mentioned)} ({high.label}).
          </p>
        )}
      </Q>

      <Q n={2} q="Do they choose you?">
        <Big
          cell={v.target.chosen}
          sub={`of answers crown ${v.brand}${
            instinct && search
              ? ` - instinct ${pct(instinct.chosen)} / search ${pct(search.chosen)}`
              : ""
          }`}
        />
        <p className="text-[13px] text-ink-2">
          {v.firmPick.k} of {v.answers} answers committed to one pick, {v.firmPickInCategory.k} of
          them to a brand in your category - of those, {v.brand} takes{" "}
          {pct(v.target.shareOfDecided)}.
        </p>
      </Q>

      <Q n={3} q="Who wins instead, and why?">
        <p className="text-[13px] text-ink-3">
          Shares below are of the{" "}
          <span className="font-medium text-ink-2">
            {v.firmPickInCategory.k} answers that picked a brand in your category
          </span>{" "}
          - the rest hedged or picked outside it, so nobody here won them.
        </p>
        <div className="grid gap-2">
          {board.map((b) => (
            <BarRow
              key={b.key}
              name={b.name}
              isTarget={b.role === "target"}
              share={rate(b.shareOfDecided)}
              max={maxPick}
              right={`${b.chosen.k} picks - ${pct(b.shareOfDecided)}`}
            />
          ))}
        </div>
        {bestLift && worstLift && (
          <p className="text-[13px] text-ink-2">
            Arguments that travel with your wins:{" "}
            <span className="font-medium">
              {v.reasonLift.slice(0, 2).map((r) => `${r.code} (${pts(r.lift)})`).join(", ")}
            </span>
            {" - "}working against you:{" "}
            <span className="font-medium">
              {worstLift.code} ({pts(worstLift.lift)})
            </span>
            , measured against the answers that picked a rival.
          </p>
        )}
      </Q>

      <Q n={4} q="Do you survive the doubts?">
        {v.buyersDoubt || v.customersDoubt ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {v.buyersDoubt && (
              <div className="rounded-xl border border-line p-4 grid gap-1">
                <span className="text-sm font-semibold">Buyers&apos; worries</span>
                <span className="text-[11px] text-ink-3">{v.buyersDoubt.answers} answers</span>
                <p className="text-[13px] text-ink-2">
                  Told to go ahead {pct(v.buyersDoubt.proceed)} - told to avoid{" "}
                  {pct(v.buyersDoubt.avoid)}. The AI agrees the worry is warranted{" "}
                  {pct(v.buyersDoubt.agree)} of the time it takes a side on it.
                </p>
              </div>
            )}
            {v.customersDoubt && (
              <div className="rounded-xl border border-line p-4 grid gap-1">
                <span className="text-sm font-semibold">Customers&apos; worries</span>
                <span className="text-[11px] text-ink-3">{v.customersDoubt.answers} answers</span>
                <p className="text-[13px] text-ink-2">
                  Told to stay {pct(v.customersDoubt.keep)} - told to leave{" "}
                  {pct(v.customersDoubt.leave)}. The AI agrees the worry is warranted{" "}
                  {pct(v.customersDoubt.agree)} of the time it takes a side on it.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-3">
            This battery carries no worry questions on this wave - worries collect monthly, so the
            read appears on the next wave that asks them.
          </p>
        )}
      </Q>

      <Q n={5} q="Do you win when named head-to-head?">
        {h2h.length > 0 ? (
          <>
            <p className="text-[13px] text-ink-3">
              Prompted contests - the question itself names you and the rival. Bars show your share
              of the answers either of you won; never pooled with the open-choice numbers above.
            </p>
            <div className="grid gap-2">
              {h2h.map((r) => (
                <BarRow
                  key={r.key}
                  name={`vs ${r.rival}`}
                  isTarget={rate(r.winOfDecided) >= 0.5}
                  share={rate(r.winOfDecided)}
                  max={maxWin}
                  right={`${r.won.k} - ${r.lost.k} of ${r.answers} · win ${pct(r.winOfDecided)}`}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-3">This battery carries no head-to-head questions.</p>
        )}
      </Q>
    </div>
  );
}
