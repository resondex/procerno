"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { RateCell, SettledNamed, SettledViews } from "@/lib/engine/settled";
import { Tip } from "./table";
import { pct, range } from "./view_parts";

/**
 * The settled-customer verdict cards (RATIFIED 2026-11-01, decision 2):
 * business case, expansion, ecosystem and advocacy, drawn under Customers.
 * The fields are in the labels today; the dedicated scorer later replaces
 * the numbers, not the cards. Asked across all buyers - no room filter.
 * Surface rule: no counts on the cards; ranges ride the hover.
 */

const THIN = 20;
const isThin = (c: RateCell) => c.n > 0 && c.n < THIN;

function R({ c, label }: { c: RateCell; label: string }) {
  return (
    <Tip tip={`${label}: ${range(c)}${isThin(c) ? " - too few answers to read" : ""}`}>
      <span className="cursor-help tabular-nums">{pct(c)}</span>
    </Tip>
  );
}

const top3 = (xs: SettledNamed[]) =>
  xs.slice(0, 3).map((x, i) => (
    <span key={x.name}>
      {i > 0 && ", "}
      <span title={`${x.n} answers`}>{x.name}</span>
    </span>
  ));

function VerdictCard({
  label,
  question,
  big,
  bigLabel,
  anchor,
  detail,
  redirects,
}: {
  label: string;
  question: string;
  big: RateCell;
  bigLabel: string;
  anchor: ReactNode;
  detail?: ReactNode;
  redirects: SettledNamed[];
}) {
  return (
    <div className={`card p-4 grid gap-1.5 content-start ${isThin(big) ? "opacity-60" : ""}`}>
      <span className="section-label">{label}</span>
      <span className="text-[12px] leading-snug text-ink-2">{question}</span>
      <div className="flex items-baseline gap-2">
        <Tip tip={`${bigLabel}: ${range(big)}${isThin(big) ? " - too few answers to read" : ""}`}>
          <span className="cursor-help text-[1.6rem] leading-tight font-semibold tabular-nums">{pct(big)}</span>
        </Tip>
        <span className="text-[12px] text-ink-2">{bigLabel}</span>
      </div>
      {anchor && <span className="text-[12px] text-ink-2">{anchor}</span>}
      {detail && <span className="text-[11px] text-ink-3">{detail}</span>}
      {redirects.length > 0 && <span className="text-[11px] text-ink-3">Redirects to {top3(redirects)}</span>}
    </div>
  );
}

export default function SettledSections({ runId }: { runId: string }) {
  const [view, setView] = useState<SettledViews | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/settled`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`settled view failed (${r.status})`);
        const d = (await r.json()) as { view: SettledViews | null };
        if (live) setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (!view) return null;
  const { businessCase: bc, expansion: ex, ecosystem: eco, advocacy: adv } = view;
  if (!bc && !ex && !eco && !adv) return null;

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="section-label mb-1">Settled customers</h3>
        <p className="text-[12px] text-ink-3">
          Customers justifying, growing, equipping and defending you. Asked across all buyers.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {bc && (
          <VerdictCard
            label="Business case"
            question="A buyer has to justify you to an approver"
            big={bc.caseStrength.strong}
            bigLabel="confident case"
            anchor={<>hedged <R c={bc.caseStrength.hedged} label="Hedged case" /></>}
            detail={<>relationship strengthens <R c={bc.verdicts.strengthens} label="Relationship strengthens" /></>}
            redirects={bc.redirects}
          />
        )}
        {ex && (
          <VerdictCard
            label="Expansion"
            question="A customer wants to do more with you"
            big={ex.growth.backs}
            bigLabel="backs the growth"
            anchor={<>redirects <R c={ex.growth.redirects} label="Points the growth elsewhere" /></>}
            detail={<>strengthens <R c={ex.verdicts.strengthens} label="Relationship strengthens" /></>}
            redirects={ex.redirects}
          />
        )}
        {eco && (
          <VerdictCard
            label="Ecosystem"
            question="What to use around you"
            big={eco.verdicts.strengthens}
            bigLabel="strengthens the relationship"
            anchor={eco.pairings.length > 0 ? <>partners named: {top3(eco.pairings)}</> : null}
            detail={
              eco.pairsAny.n > 0 ? (
                <>names something to pair with you <R c={eco.pairsAny} label="Names at least one pairing" /></>
              ) : undefined
            }
            redirects={eco.redirects}
          />
        )}
        {adv && (
          <VerdictCard
            label="Advocacy"
            question="A customer defends you against a critic"
            big={adv.premise.rebuts}
            bigLabel="pushes back on the critic"
            anchor={<>case strong <R c={adv.caseStrength.strong} label="Strong case" /></>}
            detail={
              adv.caseStrength.concedes.k > 0 ? (
                <>concedes <R c={adv.caseStrength.concedes} label="Concedes to the critic" /></>
              ) : undefined
            }
            redirects={adv.redirects}
          />
        )}
      </div>
    </section>
  );
}
