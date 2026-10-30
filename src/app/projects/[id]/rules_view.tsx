"use client";

import { useEffect, useState } from "react";
import type {
  NamedCount,
  RateCell,
  RuleGroup,
  RulePool,
  RulesView,
  SliceGroup,
  SliceRules,
} from "@/lib/engine/rules_explorer";
import { SortTable, Tip, type Col } from "./table";
import { RateText, pct, range, rateCol } from "./view_parts";

/**
 * The decision-rules explorer (2026-10-30, WORKBENCH_REDESIGN item 2):
 * across every answer that states when the AI's pick changes, which
 * conditions route it to the client and which route it away - with the
 * rules x rooms join as the strategy read. The per-matchup detail stays in
 * the head-to-head section's conditions panel. Renders nothing until the run
 * has a codes source.
 */

/** Evidence hand-off: the sample answer ids behind a figure and a title.
 * Absent = counts render as plain text. */
export type OnEvidence = (ids: string[], title: string) => void;

const THIN = 20;
/** A condition stated by fewer answers than this is direction only. */
const FEW = 3;
const TOP = 10;

/** The view_data cell, client-side (a pool filter rescopes the shares). */
function wilsonCell(k: number, n: number): RateCell {
  if (n === 0) return { k, n, low: 0, high: 0 };
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { k, n, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

const SIDE_TIP = {
  you: "Answers stating at least one condition under which the AI routes the pick to you, over every answer here that states its rules (an answer with no conditions counts in the denominator).",
  away: "Answers stating at least one condition under which the AI routes the pick to another brand in your dictionary.",
  elsewhere:
    "Answers stating a condition that routes somewhere outside your dictionary - a ruled-out or unknown name, or a generic destination like a cheaper option.",
};

function Evidence({
  ids,
  title,
  onEvidence,
  children,
}: {
  ids: string[];
  title: string;
  onEvidence?: OnEvidence;
  children: React.ReactNode;
}) {
  if (!onEvidence || ids.length === 0) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => onEvidence(ids, title)}
      className="underline decoration-ink-3/40 decoration-dotted underline-offset-2 hover:decoration-ink-3"
    >
      {children}
    </button>
  );
}

const answersText = (n: number) => (n === 1 ? "1 answer" : `${n} answers`);
const routesText = (routes: NamedCount[]) => routes.map((r) => `${r.name} (${r.n})`).join(", ");

/** A group as the current scope sees it (all question types, or one). */
interface Scoped {
  g: RuleGroup;
  answers: number;
  share: RateCell;
  ids: string[];
}

function scopeGroup(g: RuleGroup, pool: RulePool | null, denom: number): Scoped | null {
  if (!pool) return { g, answers: g.answers, share: g.share, ids: g.ids };
  const p = g.pools.find((x) => x.pool === pool);
  if (!p) return null;
  return { g, answers: p.answers, share: wilsonCell(p.answers, denom), ids: p.ids };
}

function GroupList({
  title,
  items,
  routesLabel,
  contested,
  otherSide,
  onEvidence,
}: {
  title: string;
  items: Scoped[];
  routesLabel: string;
  contested: Map<string, number>;
  otherSide: string;
  onEvidence?: OnEvidence;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] font-medium text-ink-2">{title}</div>
      {items.length === 0 ? (
        <p className="mt-1 text-[12px] text-ink-3">No condition stated by more than one answer.</p>
      ) : (
        <ol className="mt-1.5 grid gap-2">
          {items.map(({ g, answers, share, ids }) => {
            const few = answers < FEW;
            const other = contested.get(g.cond) ?? 0;
            return (
              <li key={g.id} className={`text-[12px] leading-snug ${few ? "text-ink-3/70" : ""}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className={few ? "" : "text-ink"}>{g.label}</span>
                  <span className="shrink-0 tabular-nums text-ink-3">
                    <Evidence ids={ids} title={`${title}: ${g.label}`} onEvidence={onEvidence}>
                      {answersText(answers)}
                    </Evidence>
                    {" - "}
                    <RateText cell={share} />
                  </span>
                </div>
                <div className="text-[11px] text-ink-3">
                  {routesLabel} {routesText(g.routes)}
                  {other > 0 && ` - also ${otherSide} in ${answersText(other)}`}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function SliceGroups({
  label,
  groups,
  slice,
  onEvidence,
}: {
  label: string;
  groups: SliceGroup[];
  slice: string;
  onEvidence?: OnEvidence;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
      {groups.length === 0 ? (
        <p className="mt-0.5 text-[12px] text-ink-3">None stated.</p>
      ) : (
        <ul className="mt-0.5 grid gap-1">
          {groups.map((g) => {
            const few = g.answers < FEW;
            return (
              <li key={g.id} className={`text-[12px] leading-snug ${few ? "text-ink-3/70" : "text-ink-2"}`}>
                <span className={few ? "" : "text-ink"}>{g.label}</span>{" "}
                <span className="text-ink-3">
                  (
                  <Evidence ids={g.ids} title={`${slice} - ${label.toLowerCase()}: ${g.label}`} onEvidence={onEvidence}>
                    {g.answers}
                  </Evidence>
                  {g.lift !== null && g.lift >= 1.5 && !few && (
                    <Tip tip={`Stated ${g.lift}x as often here as across every answer that states its rules.`}>
                      <span className="cursor-help">, {g.lift}x the overall rate</span>
                    </Tip>
                  )}
                  )
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RoomCard({ room, onEvidence }: { room: SliceRules; onEvidence?: OnEvidence }) {
  const thin = room.answers < THIN;
  return (
    <div className={`rounded-md border border-line/60 p-3 ${thin ? "opacity-60" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[13px] font-medium text-ink">{room.label}</div>
        <div className="shrink-0 text-[11px] text-ink-3">
          {thin ? `Thin - ${answersText(room.answers)}` : answersText(room.answers)}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-[12px] text-ink-2">
        <Tip tip={`${SIDE_TIP.you} ${range(room.toYou)}`}>
          <span className="cursor-help">{pct(room.toYou)} route to you</span>
        </Tip>
        <Tip tip={`${SIDE_TIP.away} ${range(room.away)}`}>
          <span className="cursor-help">{pct(room.away)} route away</span>
        </Tip>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <SliceGroups label="You win when" groups={room.win} slice={room.label} onEvidence={onEvidence} />
        <SliceGroups label="You lose when" groups={room.lose} slice={room.label} onEvidence={onEvidence} />
      </div>
      <div className="mt-2 text-[11px] text-ink-3">
        {room.pools.map((p) => `${POOL_LABEL[p.pool]} ${p.answers}`).join(", ")}
      </div>
    </div>
  );
}

/** Kept in step with RULE_POOL_LABEL (rules_explorer.ts is server-only). */
const POOL_LABEL: Record<RulePool, string> = {
  open_choice: "Open choice",
  premium: "Premium vs basic",
  head_to_head: "Head-to-head",
  rival_leavers: "Rival leavers",
  repertoire: "Repertoire",
  value: "Value",
  holding: "Holding your own",
  buyer_worries: "Buyers' worries",
  customer_worries: "Customers' worries",
  expansion: "Expansion",
  ecosystem: "Ecosystem",
};

const topCondition = (groups: SliceGroup[]) => (groups[0] ? `${groups[0].label} (${groups[0].answers})` : "-");

const rivalCols = (onEvidence?: OnEvidence): Col<SliceRules>[] => [
  {
    id: "rival",
    label: "Rival",
    val: (r) => r.label,
    render: (r) => (
      <span>
        {r.label}
        {r.kind === "class" && <span className="ml-2 text-[11px] text-ink-3">class</span>}
        {r.resolved === false && <span className="ml-2 text-[11px] text-warning">not in your dictionary</span>}
      </span>
    ),
  },
  { id: "answers", label: "Answers", num: true, val: (r) => r.answers },
  rateCol("toYou", "Route to you", SIDE_TIP.you, (r) => r.toYou),
  rateCol("away", "Route away", SIDE_TIP.away, (r) => r.away),
  {
    id: "win",
    label: "Top condition for you",
    val: (r) => topCondition(r.win),
    render: (r) =>
      r.win[0] ? (
        <span className="text-[12px]">
          {r.win[0].label}{" "}
          <span className="text-ink-3">
            (
            <Evidence ids={r.win[0].ids} title={`vs ${r.label} - routes to you: ${r.win[0].label}`} onEvidence={onEvidence}>
              {r.win[0].answers}
            </Evidence>
            )
          </span>
        </span>
      ) : (
        "-"
      ),
  },
  {
    id: "lose",
    label: "Top condition away",
    val: (r) => topCondition(r.lose),
    render: (r) =>
      r.lose[0] ? (
        <span className="text-[12px]">
          {r.lose[0].label}{" "}
          <span className="text-ink-3">
            (
            <Evidence ids={r.lose[0].ids} title={`vs ${r.label} - routes away: ${r.lose[0].label}`} onEvidence={onEvidence}>
              {r.lose[0].answers}
            </Evidence>
            )
          </span>
        </span>
      ) : (
        "-"
      ),
  },
];

function Explorer({ view, onEvidence }: { view: RulesView; onEvidence?: OnEvidence }) {
  const [pool, setPool] = useState<RulePool | null>(null);
  const scope = pool ? view.pools.find((p) => p.pool === pool) ?? null : null;
  const denom = scope ? scope.answers : view.answers;
  const rates = scope ?? view.overall;

  // A few hundred groups at most - recomputed per render, no memo needed.
  const pick = (side: RuleGroup["side"]) =>
    view.groups
      .filter((g) => g.side === side)
      .map((g) => scopeGroup(g, pool, denom))
      .filter((s): s is Scoped => !!s && s.answers > 0)
      .sort((a, b) => b.answers - a.answers || b.g.rules - a.g.rules);
  // A condition that routes both ways: the answers on the other side.
  const sideCount = (side: RuleGroup["side"]) => {
    const m = new Map<string, number>();
    for (const s of pick(side)) m.set(s.g.cond, s.answers);
    return m;
  };
  const you = pick("you").slice(0, TOP);
  const away = pick("away").slice(0, TOP);
  const elsewhere = pick("elsewhere").slice(0, 8);
  const contestedYou = sideCount("away");
  const contestedAway = sideCount("you");

  const once = view.more.you.groups + view.more.away.groups + view.more.elsewhere.groups;
  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">Decision rules</h2>
        <p className="text-[13px] text-ink-3">
          The conditions the AI states for where a buyer should go - &ldquo;if you already use X, pick Y&rdquo; - across{" "}
          {view.answers} answers on the core engine panel that state their rules ({view.rules} stated rules;{" "}
          {view.unconditional} answers state none). Conditions are grouped{" "}
          {view.grouping === "embeddings" ? "by meaning" : "by their shared words"} across every question type, so the
          same circumstance groups the same way wherever it was said.
          {view.uncoded > 0 && ` ${view.uncoded} more answers are not coded yet.`}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[{ pool: null as RulePool | null, label: "All question types", answers: view.answers }, ...view.pools].map((p) => (
          <button
            key={p.pool ?? "all"}
            type="button"
            onClick={() => setPool(p.pool)}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
              pool === p.pool ? "border-primary bg-primary-soft text-primary" : "border-line text-ink-2 hover:bg-primary-soft/20"
            }`}
          >
            {p.label} <span className="tabular-nums text-ink-3">{p.answers}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <Tip tip={`${SIDE_TIP.you} ${range(rates.toYou)}`}>
          <span className="cursor-help">
            <span className="text-[1.5rem] font-semibold tabular-nums text-ink">{pct(rates.toYou)}</span> state a
            condition that routes to {view.brand}
          </span>
        </Tip>
        <Tip tip={`${SIDE_TIP.away} ${range(rates.away)}`}>
          <span className="cursor-help">{pct(rates.away)} one that routes to a rival</span>
        </Tip>
        <Tip tip={`${SIDE_TIP.elsewhere} ${range(rates.elsewhere)}`}>
          <span className="cursor-help">{pct(rates.elsewhere)} one that routes elsewhere</span>
        </Tip>
      </div>
      {scope && scope.answers < THIN && (
        <p className="text-[12px] text-ink-3">Thin - {answersText(scope.answers)} in this question type; read as direction only.</p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <GroupList
          title={`What routes the pick to ${view.brand}`}
          items={you}
          routesLabel="As:"
          contested={contestedYou}
          otherSide="routes away"
          onEvidence={onEvidence}
        />
        <GroupList
          title={`What routes it away from ${view.brand}`}
          items={away}
          routesLabel="To:"
          contested={contestedAway}
          otherSide="routes to you"
          onEvidence={onEvidence}
        />
      </div>

      {elsewhere.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-ink-2">Routes elsewhere - outside your dictionary or no brand named</summary>
          <div className="mt-3">
            <GroupList
              title="Routes elsewhere"
              items={elsewhere}
              routesLabel="To:"
              contested={new Map()}
              otherSide=""
              onEvidence={onEvidence}
            />
          </div>
        </details>
      )}
      <p className="text-[11px] text-ink-3">
        Percentages are shares of the answers that state their rules{pool ? ` in ${POOL_LABEL[pool]}` : ""}. {once} more
        conditions are stated by a single answer or sit past the top of the list.
      </p>
    </section>
  );
}

export default function RulesSection({ runId, onEvidence }: { runId: string; onEvidence?: OnEvidence }) {
  const [view, setView] = useState<RulesView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/rules`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`decision rules view failed (${r.status})`);
        const d = (await r.json()) as { view: RulesView | null };
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
    <>
      <Explorer view={view} onEvidence={onEvidence} />

      {view.rooms.length > 0 && (
        <section className="card p-6 grid gap-4">
          <div>
            <h2 className="section-label mb-1">Where your winning conditions live</h2>
            <p className="text-[13px] text-ink-3">
              Each buyer&apos;s answers, and the conditions that dominate them: which buyer&apos;s circumstance matches
              the conditions you win on, and which matches the ones you lose on. Only questions asked in one
              buyer&apos;s voice carry a buyer - open choice and value; head-to-heads, worries and the customer questions
              are asked across all buyers by design and sit in the explorer above. A multiple marks a condition stated far more often for
              this buyer than overall.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {view.rooms.map((r) => (
              <RoomCard key={r.key} room={r} onEvidence={onEvidence} />
            ))}
          </div>
        </section>
      )}

      {view.rivals.length > 0 && (
        <section className="card p-6 grid gap-3">
          <div>
            <h2 className="section-label mb-1">Decision rules by rival</h2>
            <p className="text-[13px] text-ink-3">
              The head-to-head answers only, per rival named in the question. &ldquo;Route away&rdquo; counts any rival
              in your dictionary, not only the one named; the head-to-head section lists each matchup&apos;s full stated
              boundaries.
            </p>
          </div>
          <SortTable
            cols={rivalCols(onEvidence)}
            rows={view.rivals}
            filename="decision_rules_by_rival.csv"
            defaultSort={{ id: "answers", dir: -1 }}
          />
        </section>
      )}
    </>
  );
}
