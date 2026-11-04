"use client";

import { useEffect, useState } from "react";
import type { BrandSummaryView, Insight, RateCell, SummaryBrand, VerdictFact } from "@/lib/engine/brand_summary";
import { SortTable, Tip } from "./table";
import { BaseNote, DotTrack, RateText, fmtN, useEngineSet, viewQuery, EngineTable } from "./view_parts";

/**
 * The Boardroom and Five-questions views, answer_codes era (2026-10-30):
 * both render from the brand summary (engine/brand_summary.ts) - the
 * headline pool's funnel, outcome split and brand table, plus the doubt and
 * head-to-head rollups. Every figure here also appears in the brief's own
 * sections with its full table; these views are the executive cut.
 *
 * Insights (bs5, 2026-11-03) are detected server-side (engine/summary_insights.ts)
 * and rendered as served: the Boardroom's signal cards, the brief's top three
 * and question 3's room sentence all read the same list. The brief opens on
 * the verdict (bs6): template sentences served in fixed order, run together
 * as one paragraph.
 */

/** Where an insight's full table lives; the results block wires it. */
export type OnLook = (look: Insight["look"]) => void;

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
  const q = viewQuery({ engines: useEngineSet() });
  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/brand_summary${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`brand summary failed (${r.status})`);
        const d = (await r.json()) as { view: BrandSummaryView | null };
        if (live) setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId, q]);
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
        No coded &ldquo;which should I get&rdquo; answers yet - this view fills in once the run is measured.
      </div>
    );
  return <>{children(view)}</>;
}

function BarRow({ name, share, max, isTarget, right, tip }: {
  name: string;
  share: number;
  max: number;
  isTarget?: boolean;
  right: string;
  /** Hover text for the row - where the counts behind it live. */
  tip?: string;
}) {
  return (
    <div className="grid grid-cols-[11rem_1fr_9rem] items-center gap-3" title={tip}>
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

/** One leaderboard row: named (grey) and picked (blue) on one 0-100% track. */
function DotRow({ name, isTarget, named, picked }: {
  name: string;
  isTarget?: boolean;
  named: RateCell;
  picked: RateCell;
}) {
  return (
    <div
      className={`grid grid-cols-[6.5rem_1fr_5.5rem] sm:grid-cols-[11rem_1fr_9rem] items-center gap-3 ${
        isTarget ? "-mx-2 rounded-md bg-primary-soft/60 px-2 py-0.5" : ""
      }`}
      title={`Named in ${range(named)}; picked in ${range(picked)}`}
    >
      <span className={`truncate text-sm text-right ${isTarget ? "font-semibold text-primary" : "text-ink-2"}`}>
        {name}
      </span>
      <DotTrack a={rate(named)} b={rate(picked)} emphasis={isTarget} />
      <span className={`text-sm tabular-nums ${isTarget ? "font-semibold text-ink" : "text-ink-2"}`}>
        {pct(named)} · {pct(picked)}
      </span>
    </div>
  );
}

/** Top rivals by share of decided, the target always on the board. */
function pickBoard(view: BrandSummaryView, limit: number): SummaryBrand[] {
  const rivals = view.brands.filter((b) => b.role !== "target" && b.chosen.k > 0).slice(0, limit);
  return [view.target, ...rivals].sort((a, b) => rate(b.shareOfDecided) - rate(a.shareOfDecided));
}

/* ================================================================== */
/* The brief: the one-screen synthesis                                 */
/* ================================================================== */

export function BriefSection({ runId, onLook }: { runId: string; onLook?: OnLook }) {
  const { view, error } = useBrandSummary(runId);
  return (
    <Shell view={view} error={error}>
      {(v) => <Brief v={v} onLook={onLook} />}
    </Shell>
  );
}

/** The "where to look" pointer: a link-style button when wired, plain text otherwise. */
function LookLink({ look, onLook }: { look: Insight["look"]; onLook?: OnLook }) {
  if (!onLook) return <span className="text-[12px] text-ink-3">See {look.label}</span>;
  return (
    <button
      type="button"
      onClick={() => onLook(look)}
      className="justify-self-start text-[12px] font-medium text-primary hover:underline"
    >
      See {look.label} ›
    </button>
  );
}

function InsightCard({ insight, label, onLook }: { insight: Insight; label?: string; onLook?: OnLook }) {
  return (
    <div className="card p-5 grid gap-1.5 content-start" title={insight.foot}>
      {label && <div className="section-label">{label}</div>}
      <div className="text-[15px] font-semibold">{insight.title}</div>
      <p className="text-[13px] text-ink-2">{insight.body}</p>
      <LookLink look={insight.look} onLook={onLook} />
    </div>
  );
}

const KIND_LABEL: Record<Insight["kind"], string> = {
  engine: "Engines",
  room: "Buyers",
  rival: "Rivals",
  argument: "The arguments",
  doubt: "The doubts",
  funnel: "The funnel",
  question: "One question",
  value: "Value",
  switching: "Switching",
  condition: "The conditions",
  leak: "Leaving the category",
};

/** An inline hover note for a sentence inside running prose - Tip's popup,
 * but an inline box so the sentence wraps with the paragraph. */
function InlineTip({ tip, children }: { tip: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className="inline"
      onMouseEnter={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.top });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <span
          style={{
            position: "fixed",
            left: Math.min(
              Math.max(pos.x, Math.min(176, window.innerWidth / 2)),
              window.innerWidth - Math.min(176, window.innerWidth / 2)
            ),
            top: pos.y - 8,
            transform: "translate(-50%, -100%)",
            zIndex: 50,
            maxWidth: Math.min(336, window.innerWidth - 16),
          }}
          className="pointer-events-none w-max rounded-lg border border-line bg-surface px-3 py-2 text-left text-[12px] font-normal text-ink-2 shadow-lg"
        >
          {tip}
        </span>
      )}
    </span>
  );
}

/** The verdict: the served sentences run together as one paragraph; a
 * sentence with somewhere to look opens it on click. */
function Verdict({ facts, onLook }: { facts: VerdictFact[]; onLook?: OnLook }) {
  return (
    <p className="text-[17px] leading-relaxed text-ink max-w-[68ch]">
      {facts.map((f, i) => {
        const look = f.look;
        const body =
          look && onLook ? (
            // A span, not a <button>: buttons lay out as atomic boxes and would
            // break each sentence onto its own line instead of running as prose.
            <span
              role="button"
              tabIndex={0}
              onClick={() => onLook(look)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onLook(look);
                }
              }}
              className="cursor-pointer underline decoration-dotted decoration-line underline-offset-4 hover:text-primary hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              {f.text}
            </span>
          ) : (
            <span className="cursor-help">{f.text}</span>
          );
        return (
          <span key={f.key}>
            {i > 0 && " "}
            <InlineTip tip={look && onLook ? `${f.foot} - click for ${look.label}` : f.foot}>{body}</InlineTip>
          </span>
        );
      })}
    </p>
  );
}

/** The top insights as a compact list under the verdict. */
function InsightList({ insights, onLook }: { insights: Insight[]; onLook?: OnLook }) {
  return (
    <ul className="grid gap-3 border-t border-line pt-4">
      {insights.map((i) => (
        <li key={i.key} className="grid gap-0.5" title={i.foot}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{KIND_LABEL[i.kind]}</span>
            <span className="text-[14px] font-semibold">{i.title}</span>
          </div>
          <p className="text-[13px] text-ink-2">{i.body}</p>
          <LookLink look={i.look} onLook={onLook} />
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, cell, hint }: { label: string; cell: RateCell; hint: string }) {
  return (
    <Tip tip={`${hint} - ${range(cell)}`}>
      <div className="card p-5 cursor-help">
        <div className="section-label">{label}</div>
        <div className="text-[2rem] leading-tight font-semibold tabular-nums mt-1.5">{pct(cell)}</div>
      </div>
    </Tip>
  );
}

const FIRM_TIP = "Firm pick: answers that commit to one pick, whatever it is.";
const IN_CAT_TIP = "Firm pick in category: firm picks whose pick is an approved brand in the confirmed dictionary.";
const SOD_TIP = "Share of decided: your picks over every in-category pick.";

function Brief({ v, onLook }: { v: BrandSummaryView; onLook?: OnLook }) {
  const byMentioned = [...v.brands].sort((a, b) => rate(b.mentioned) - rate(a.mentioned));
  const leaderboard = byMentioned.slice(0, 10);
  if (!leaderboard.some((b) => b.key === v.target.key) && leaderboard.length > 0) {
    leaderboard[leaderboard.length - 1] = v.target;
  }
  const board = pickBoard(v, 8);
  const maxPick = Math.max(...board.map((b) => rate(b.shareOfDecided)), 0.01);
  const h2h = v.headToHead.slice(0, 6);
  const standouts = v.insights.slice(0, 3);
  return (
    <div className="grid gap-8">
      {(v.verdict ?? []).length > 0 ? (
        <section className="card p-6 grid gap-4 border-l-4 border-l-[var(--color-primary)]">
          <h2 className="section-label">The verdict</h2>
          <Verdict facts={v.verdict ?? []} onLook={onLook} />
          {standouts.length > 0 && <InsightList insights={standouts} onLook={onLook} />}
        </section>
      ) : standouts.length > 0 && (
        <section className="grid gap-2">
          <h2 className="section-label">What stands out</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {standouts.map((i) => (
              <InsightCard key={i.key} insight={i} label={KIND_LABEL[i.kind]} onLook={onLook} />
            ))}
          </div>
        </section>
      )}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Named" cell={v.target.mentioned} hint="Open-choice answers that name you at all" />
        <Tile label="Recommended" cell={v.target.recommended} hint="Answers that put you forward, by framing or as the pick" />
        <Tile label="Picked" cell={v.target.chosen} hint="Chosen: answers that crown you as THE pick" />
        <Tile label="Win rate when one is picked" cell={v.target.shareOfDecided} hint={SOD_TIP} />
      </section>
      <p className="text-[13px] text-ink-3 -mt-5">
        <Tip tip={`${FIRM_TIP} ${range(v.firmPick)}`}>
          <span className="cursor-help">The AI picks one in {pct(v.firmPick)} of answers</span>
        </Tip>
        ,{" "}
        <Tip tip={`${IN_CAT_TIP} ${range(v.firmPickInCategory)}`}>
          <span className="cursor-help">one in your category in {pct(v.firmPickInCategory)}</span>
        </Tip>
        . Questions that name a brand are measured apart, in the Analysis views.
        {v.uncoded > 0 && ` ${v.uncoded} answers are not coded yet.`}
      </p>

      <section className="card p-6">
        <h2 className="section-label mb-1">Brand leaderboard</h2>
        <p className="text-[13px] text-ink-3 mb-5">
          Grey is how often the brand is named; blue is how often it is the one the AI says to buy.
          The distance between them is the conversion gap.
        </p>
        <div className="grid gap-2.5">
          {leaderboard.map((b) => (
            <DotRow
              key={b.key}
              name={b.name}
              isTarget={b.key === v.target.key}
              named={b.mentioned}
              picked={b.chosen}
            />
          ))}
          <div className="grid grid-cols-[6.5rem_1fr_5.5rem] sm:grid-cols-[11rem_1fr_9rem] gap-3 text-[11px] text-ink-3">
            <span />
            <div className="flex justify-between tabular-nums">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
            <span>named · picked</span>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="section-label mb-1">Who wins instead</h2>
        <p className="text-[13px] text-ink-3 mb-5">
          The brand each answer actually picked - win rate when a brand in your category is picked.
        </p>
        <div className="grid gap-2.5">
          {board.map((b) => (
            <BarRow
              key={b.key}
              name={b.name}
              isTarget={b.key === v.target.key}
              share={rate(b.shareOfDecided)}
              max={maxPick}
              right={pct(b.shareOfDecided)}
              tip={range(b.shareOfDecided)}
            />
          ))}
        </div>
      </section>

      {v.reasonLift.length > 0 && (
        <section className="card p-6">
          <h2 className="section-label mb-1">The arguments that decide it</h2>
          <p className="text-[13px] text-ink-3 mb-4">
            How often each argument rides along when you win vs when a rival is picked. Positive
            lift = arguments to feed; negative = the conversations you&apos;re losing.
          </p>
          <SortTable
            filename="arguments.csv"
            defaultSort={{ id: "lift", dir: -1 }}
            cols={[
              { id: "code", label: "Argument",
                val: (r: BrandSummaryView["reasonLift"][number]) => r.code,
                render: (r) => <span className="font-medium">{r.code}</span> },
              { id: "wins", label: "With your wins", num: true,
                val: (r) => Math.round(rate(r.wins) * 100),
                render: (r) => pct(r.wins) },
              { id: "others", label: "With rival picks", num: true,
                val: (r) => Math.round(rate(r.others) * 100),
                render: (r) => pct(r.others) },
              { id: "lift", label: "Lift", num: true,
                val: (r) => Math.round(r.lift * 100),
                render: (r) => (
                  <span className={r.lift > 0.02 ? "text-success font-semibold" : r.lift < -0.02 ? "text-danger font-semibold" : ""}>
                    {pts(r.lift)}
                  </span>
                ) },
            ]}
            rows={v.reasonLift}
          />
        </section>
      )}

      {v.byEngine.length > 1 && (
        <section className="card p-6">
          <h2 className="section-label mb-1">By engine</h2>
          <p className="text-[13px] text-ink-3 mb-4">
            The same which-should-I-get questions answered by each assistant, through the same coding.
          </p>
          <EngineTable
            filename="by_engine.csv"
            defaultSort={{ id: "mentioned", dir: -1 }}
            cols={[
              { id: "engine", label: "Engine",
                val: (e: BrandSummaryView["byEngine"][number]) => e.label,
                render: (e) => (
                  <span className="font-medium whitespace-nowrap">
                    {e.label}
                    {e.mode === "search" && (
                      <span className="ml-1.5 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        search
                      </span>
                    )}
                  </span>
                ) },
              { id: "answers", label: "Answers", num: true, csvOnly: true, val: (e) => e.answers },
              { id: "mentioned", label: "Named", num: true,
                val: (e) => Math.round(rate(e.mentioned) * 100),
                render: (e) => <RateText cell={e.mentioned} /> },
              { id: "chosen", label: "Picked", num: true,
                val: (e) => Math.round(rate(e.chosen) * 100),
                render: (e) => <RateText cell={e.chosen} /> },
            ]}
            rows={v.byEngine}
          />
        </section>
      )}

      {(v.buyersDoubt || v.customersDoubt || h2h.length > 0) && (
        <section className="grid gap-3 sm:grid-cols-3">
          {v.buyersDoubt && (
            <div className="card p-5 grid gap-1.5 content-start">
              <div className="section-label">Buyers&apos; worries</div>
              <div className="text-[15px] font-semibold">told to go ahead {pct(v.buyersDoubt.proceed)}</div>
              <p className="text-[13px] text-ink-2">
                The AI agrees the worry is warranted {pct(v.buyersDoubt.agree)} of the time it
                takes a side on it.
              </p>
            </div>
          )}
          {v.customersDoubt && (
            <div className="card p-5 grid gap-1.5 content-start">
              <div className="section-label">Customers&apos; worries</div>
              <div className="text-[15px] font-semibold">
                stay {pct(v.customersDoubt.keep)} - leave {pct(v.customersDoubt.leave)}
              </div>
              <p className="text-[13px] text-ink-2">
                The AI agrees the worry is warranted {pct(v.customersDoubt.agree)} of the time it
                takes a side on it.
              </p>
            </div>
          )}
          {h2h.length > 0 && (
            <div className="card p-5 grid gap-1.5 content-start">
              <div className="section-label">Head-to-head record</div>
              <div className="grid gap-1">
                {h2h.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-baseline justify-between gap-3 text-[13px]"
                    title={`${r.won.k} wins to ${r.lost.k} of ${r.answers} answers`}
                  >
                    <span className="text-ink-2 truncate">vs {r.rival}</span>
                    <span className="tabular-nums whitespace-nowrap">win {pct(r.winOfDecided)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[12px] text-ink-3">Prompted contests, never pooled with the open numbers.</p>
            </div>
          )}
        </section>
      )}

      <p className="text-center text-[13px] text-ink-3">
        Every question type&apos;s full tables - doubts, value, alternatives, awareness, reasons -
        live in the Analysis views.
      </p>
      <BaseNote>
        Based on {fmtN(v.answers)} &ldquo;which should I get&rdquo; answers across {v.byEngine.length} engines.
      </BaseNote>
    </div>
  );
}

/* ================================================================== */
/* The Boardroom: the 90-second screen                                 */
/* ================================================================== */

export function BoardroomSection({ runId, onLook }: { runId: string; onLook?: OnLook }) {
  const { view, error } = useBrandSummary(runId);
  return (
    <Shell view={view} error={error}>
      {(v) => <Boardroom v={v} onLook={onLook} />}
    </Shell>
  );
}

function Boardroom({ v, onLook }: { v: BrandSummaryView; onLook?: OnLook }) {
  const signals = v.insights;
  return (
    <div className="grid gap-5">
      <section className="card p-8 border-l-4 border-l-[var(--color-primary)]">
        <div className="section-label mb-3">The verdict</div>
        <p className="text-xl leading-snug text-ink-2 max-w-[62ch]">
          When AI answers field open buying questions about {v.category},{" "}
          <span className="font-semibold text-ink">
            {v.brand} is in the room {pct(v.target.mentioned)} of the time - and wins it{" "}
            {pct(v.target.shareOfDecided)} when a brand is picked
          </span>
          . The gap between those two numbers is the whole assignment.
        </p>
        <p className="text-[13px] text-ink-3 mt-3">
          &ldquo;Which should I get&rdquo; questions only - questions that name a brand are measured in their own views.
          {v.uncoded > 0 && ` ${v.uncoded} answers are not coded yet.`}
        </p>
      </section>

      <section className="card p-8">
        <div className="grid grid-cols-3 gap-4 text-center">
          {[
            { label: "Named", cell: v.target.mentioned },
            { label: "Recommended", cell: v.target.recommended },
            { label: "Picked", cell: v.target.chosen },
          ].map((s, i) => (
            <div key={s.label} className="relative cursor-help" title={range(s.cell)}>
              {i > 0 && (
                <span className="absolute -left-2 top-1/2 -translate-y-1/2 text-ink-3">›</span>
              )}
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{s.label}</div>
              <div className="text-4xl font-semibold tabular-nums text-primary mt-1.5">{pct(s.cell)}</div>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-ink-3 text-center mt-5">
          Named › recommended › picked, all over the same answers. The drop between stages says what
          kind of problem you have.{" "}
          <Tip tip={`${FIRM_TIP} ${range(v.firmPick)}. ${IN_CAT_TIP} ${range(v.firmPickInCategory)}`}>
            <span className="cursor-help">
              The AI picks one in {pct(v.firmPick)} of answers, one in your category in{" "}
              {pct(v.firmPickInCategory)}.
            </span>
          </Tip>
        </p>
      </section>

      {signals.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {signals.map((s, i) => (
            <InsightCard key={s.key} insight={s} label={`Signal ${i + 1} - ${KIND_LABEL[s.kind]}`} onLook={onLook} />
          ))}
        </section>
      )}

      <p className="card p-5 text-center text-[13px] text-ink-3">
        Every figure reads from the coded answers - the brief carries the full table behind each one.
      </p>
      <BaseNote>
        Based on {fmtN(v.answers)} &ldquo;which should I get&rdquo; answers across {v.byEngine.length} engines.
      </BaseNote>
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
  const roomSpread = v.insights.find((i) => i.key === "room_win");

  return (
    <div className="grid gap-4">
      <Q n={1} q="Do the AIs know you?">
        <Big
          cell={v.target.mentioned}
          sub={`of "which should I get" answers name ${v.brand}`}
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
          sub={`of answers pick ${v.brand}${
            instinct && search
              ? ` - instinct ${pct(instinct.chosen)} / search ${pct(search.chosen)}`
              : ""
          }`}
        />
        <p className="text-[13px] text-ink-2">
          <Tip tip={`${FIRM_TIP} ${range(v.firmPick)}. ${IN_CAT_TIP} ${range(v.firmPickInCategory)}`}>
            <span className="cursor-help">
              The AI picks one in {pct(v.firmPick)} of answers, a brand in your category in{" "}
              {pct(v.firmPickInCategory)}
            </span>
          </Tip>{" "}
          - <Tip tip={`${SOD_TIP} ${range(v.target.shareOfDecided)}`}>
            <span className="cursor-help">
              when one is picked, {v.brand} wins {pct(v.target.shareOfDecided)}
            </span>
          </Tip>
          .
        </p>
      </Q>

      <Q n={3} q="Who wins instead, and why?">
        <p className="text-[13px] text-ink-3">
          Shares below are of the{" "}
          <span className="font-medium text-ink-2">answers that picked a brand in your category</span>{" "}
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
              right={pct(b.shareOfDecided)}
              tip={range(b.shareOfDecided)}
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
        {roomSpread && (
          <p className="text-[13px] text-ink-2" title={roomSpread.foot}>
            By buyer: {roomSpread.body}
          </p>
        )}
      </Q>

      <Q n={4} q="Do you survive the doubts?">
        {v.buyersDoubt || v.customersDoubt ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {v.buyersDoubt && (
              <div className="rounded-xl border border-line p-4 grid gap-1">
                <span className="text-sm font-semibold">Buyers&apos; worries</span>
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
              of the answers either of you won; never pooled with the which-should-I-get numbers above.
            </p>
            <div className="grid gap-2">
              {h2h.map((r) => (
                <BarRow
                  key={r.key}
                  name={`vs ${r.rival}`}
                  isTarget={rate(r.winOfDecided) >= 0.5}
                  share={rate(r.winOfDecided)}
                  max={maxWin}
                  right={`win ${pct(r.winOfDecided)}`}
                  tip={`${r.won.k} wins to ${r.lost.k} of ${r.answers} answers`}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-3">This battery carries no head-to-head questions.</p>
        )}
      </Q>
      <BaseNote>
        Questions 1-3 are based on {fmtN(v.answers)} &ldquo;which should I get&rdquo; answers across{" "}
        {v.byEngine.length} engines.
      </BaseNote>
    </div>
  );
}
