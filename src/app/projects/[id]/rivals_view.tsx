"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dossier, DossierArg, DossiersView } from "@/lib/engine/dossiers";
import type { HeadToHeadViews } from "@/lib/engine/head_to_head";
import { Boundaries } from "./head_to_head_view";
import { AnswersModal, type AnswersTarget, useEngineSet, viewQuery } from "./view_parts";

/**
 * Rivals as BRAND DOSSIERS (2026-11-08, the owner's ratified shape -
 * public/_position_panel_options.html tab 6): one standing page per rival
 * brand - the brief's brand card promoted to a page, with the brand's own map
 * cells folded in. One /dossiers fetch (engine/dossiers.ts, do1) carries every
 * brand; picking a chip switches client-side.
 *
 * Below the dossier, the selected brand's head-to-head boundaries ("When does
 * each side win?" - the head-to-head view's per-matchup conditions, counts
 * stripped) stay reachable for brands with a matchup.
 *
 * No counts anywhere: values are percentages and template sentences; no
 * count tooltips (the 2026-11-08 standing rule).
 */

const brandKey = (projectId: string) => `procerno_dossier_brand:${projectId}`;
function readPref(key: string | null): string | null {
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string | null, value: string) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice holds for this page view only
  }
}

const DOSS_CSS = `
.dz-root{ --dz-pos:#0d9488; --dz-neg:#be185d; --dz-amber:#a16207; }
@media (prefers-color-scheme: dark){ .dz-root{ --dz-pos:#14a08f; --dz-neg:#d2497e; --dz-amber:#d0a03a; } }
.dz-root{ --dz-amber-bg:color-mix(in srgb, var(--dz-amber) 10%, var(--surface)); }
.dz-more > summary{ list-style:none; }
.dz-more > summary::-webkit-details-marker{ display:none; }
.dz-more > summary .dz-caret::after{ content:" \\25B8"; }
.dz-more[open] > summary .dz-caret::after{ content:" \\25BE"; }
`;

const h3 = "mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 pt-3.5">
      <div className={h3}>{title}</div>
      {children}
    </div>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-line py-1.5 text-[13px]">
      <span className="min-w-0 text-ink-2">{label}</span>
      <span className="max-w-[60%] text-right tabular-nums text-ink">{value}</span>
    </div>
  );
}

const Line = ({ children }: { children: React.ReactNode }) => <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{children}</p>;

function More({ children }: { children: React.ReactNode }) {
  return (
    <details className="dz-more mt-1.5">
      <summary className="cursor-pointer select-none text-[12px] font-medium text-ink-3 hover:text-ink-2">
        <span className="dz-caret">See more</span>
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

/** The map panel's argument treatment: diverging bars + the shares beneath. */
function ArgBars({ args, sides }: { args: DossierArg[]; sides: [string, string] }) {
  const max = Math.max(10, ...args.map((a) => Math.abs(a.value)));
  return (
    <div className="grid gap-0.5">
      {args.map((a) => {
        const w = (Math.min(Math.abs(a.value), max) / max) * 50;
        return (
          <div key={a.label} className="grid grid-cols-[minmax(7.5rem,1fr)_1fr_2.75rem] items-center gap-x-2.5 gap-y-0.5 text-[13px]">
            <span className="text-ink">{a.label}</span>
            <div className="relative h-2.5" aria-hidden>
              <span className="absolute inset-y-[-2px] left-1/2 w-px bg-line" />
              <span
                className="absolute top-px h-2 rounded-[3px]"
                style={a.value >= 0 ? { left: "50%", width: `${w}%`, background: "var(--dz-pos)" } : { right: "50%", width: `${w}%`, background: "var(--dz-neg)" }}
              />
            </div>
            <span className="text-right text-[12px] tabular-nums text-ink-2">
              {a.value > 0 ? "+" : ""}
              {a.value}
            </span>
            <span className="col-span-full mb-1 text-[11.5px] text-ink-3">
              {a.wins} of {sides[0]} · {a.others} of {sides[1]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DossierPage({
  d,
  onOpenCell,
  onOpenView,
}: {
  d: Dossier;
  onOpenCell?: (cellId: string) => void;
  onOpenView?: (v: "metrics") => void;
}) {
  const links: { label: string; go: () => void }[] = [];
  if (d.cells.h2h && onOpenCell) links.push({ label: "Head-to-head on the map", go: () => onOpenCell(d.cells.h2h!) });
  if (d.cells.leaver && onOpenCell) links.push({ label: "Its leaver cell", go: () => onOpenCell(d.cells.leaver!) });
  if (onOpenView) links.push({ label: "Build a table", go: () => onOpenView("metrics") });
  const more = d.argsAll.length > d.args.length;
  return (
    <section className="card px-6 pb-5 pt-5">
      <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-ink-3">
        <span className="mr-1.5 inline-block rounded-[5px] bg-primary-soft px-1.5 py-px text-[10px] font-bold tracking-[0.07em] text-primary">BRAND</span>
        {d.name} · open buying questions
      </div>
      <p className="mb-3.5 mt-1 max-w-[68ch] text-[17px] font-semibold leading-snug text-ink [text-wrap:pretty]">{d.headline}</p>
      <div className="mb-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {d.tiles.map((t) => (
          <div key={t.label} className="rounded-[10px] border border-line px-3 py-2.5">
            <div className="text-[20px] font-semibold tabular-nums text-ink">{t.value}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-ink-3">{t.label}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
        {(d.picksFrom.byType || d.picksFrom.topQuestion) && (
          <Section title="Where its picks come from">
            {d.picksFrom.byType && <Fig label="By question type" value={d.picksFrom.byType} />}
            {d.picksFrom.topQuestion && <Fig label="Picks from its top question" value={d.picksFrom.topQuestion} />}
          </Section>
        )}
        <Section title="Against you, head to head">
          {d.h2h.kind === "record" ? (
            <>
              <Fig label={d.h2h.youLabel} value={d.h2h.you} />
              <Fig label={d.h2h.themLabel} value={d.h2h.them} />
              {d.h2h.asClass && <p className="mt-1 text-[12px] text-ink-3">Asked against the {d.name} class of product, not one brand.</p>}
            </>
          ) : d.h2h.alert ? (
            <div className="mt-1 rounded-lg px-2.5 py-2 text-[12.5px] leading-snug" style={{ background: "var(--dz-amber-bg)", color: "var(--dz-amber)" }}>
              {d.h2h.note}
            </div>
          ) : (
            <Line>{d.h2h.note}</Line>
          )}
        </Section>
        {d.switching && (
          <Section title="Switching">
            <Line>{d.switching}</Line>
            {d.switchingNoPick && <Line>{d.switchingNoPick}</Line>}
          </Section>
        )}
        {d.args.length > 0 && (
          <Section title="The arguments">
            <ArgBars args={d.args} sides={d.argSides} />
            {more && (
              <More>
                <ArgBars args={d.argsAll} sides={d.argSides} />
              </More>
            )}
          </Section>
        )}
        {d.routes && (
          <Section title="What routes buyers to it">
            <Line>{d.routes}</Line>
            {d.routesAll.length > 1 && (
              <More>
                <p className="mb-1 text-[12px] text-ink-3">Every condition that routes buyers to it, most often stated first, with its share of the questions where any condition routes away from you:</p>
                {d.routesAll.map((r) => (
                  <Fig key={r.label} label={`"${r.label}"`} value={r.share} />
                ))}
              </More>
            )}
          </Section>
        )}
        {d.supply && (
          <Section title="Who supplies its picks">
            <Line>{d.supply}</Line>
            {d.supplyAll.assistants.length > 0 && (
              <More>
                <p className="mb-1 text-[12px] text-ink-3">Share of its picks, beside the share of the questions each answers.</p>
                {d.supplyAll.vendors.length > 0 && (
                  <>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">By company</div>
                    {d.supplyAll.vendors.map((r) => (
                      <Fig key={r.label} label={r.label} value={`${r.picks} of its picks · answers ${r.answers}`} />
                    ))}
                  </>
                )}
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">By assistant</div>
                {d.supplyAll.assistants.map((r) => (
                  <Fig key={r.label} label={r.label} value={`${r.picks} of its picks · answers ${r.answers}`} />
                ))}
              </More>
            )}
          </Section>
        )}
      </div>
      {links.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1">
          {links.map((l) => (
            <button key={l.label} type="button" onClick={l.go} className="text-[12.5px] font-semibold text-primary hover:opacity-80">
              {l.label} {"→"}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function RivalsSection({
  runId,
  projectId,
  onOpenCell,
  onOpenView,
}: {
  runId: string;
  projectId?: string;
  onOpenCell?: (cellId: string) => void;
  onOpenView?: (v: "metrics") => void;
}) {
  const [view, setView] = useState<DossiersView | null | undefined>(undefined);
  const [h2h, setH2h] = useState<HeadToHeadViews | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [opened, setOpened] = useState<AnswersTarget | null>(null);
  const close = useCallback(() => setOpened(null), []);
  const pKey = projectId ? brandKey(projectId) : null;

  const engines = useEngineSet();
  useEffect(() => {
    let live = true;
    const q = viewQuery({ engines });
    fetch(`/api/runs/${runId}/dossiers${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Rivals failed (${r.status})`);
        const d = (await r.json()) as { view: DossiersView | null };
        if (!live) return;
        const saved = readPref(pKey);
        if (saved && d.view?.dossiers.some((x) => x.key === saved)) setPicked(saved);
        setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    fetch(`/api/runs/${runId}/head_to_head${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { views: HeadToHeadViews | null } | null) => live && setH2h(d?.views ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runId, engines, pKey]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (view === undefined) return <div className="card px-5 py-4 text-[13px] text-ink-3">Loading rivals...</div>;
  if (!view || view.dossiers.length === 0) return null;

  const sel = view.dossiers.find((d) => d.key === picked) ?? view.dossiers[0];
  const lead = view.dossiers.filter((d) => d.prominent);
  const rest = view.dossiers.filter((d) => !d.prominent);
  const chips = showAll || rest.some((d) => d.key === sel.key) ? view.dossiers : lead.length ? lead : view.dossiers;
  const choose = (k: string) => {
    setPicked(k);
    writePref(pKey, k);
  };
  const matchup = h2h ? [...(h2h.entity?.rows ?? []), ...(h2h.class?.rows ?? [])].find((r) => r.key === sel.key && r.conditions) ?? null : null;

  return (
    <div className="dz-root grid gap-5">
      <style>{DOSS_CSS}</style>
      <section className="card grid gap-3 p-6">
        <div>
          <h2 className="section-label mb-1">Rivals</h2>
          <h3 className="text-[15px] font-semibold">One page per brand</h3>
          <p className="mt-1 text-[13px] text-ink-3">
            How the AI treats each brand in open buying questions, where it stands against {view.brand}, and what sends buyers to it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => choose(d.key)}
              aria-pressed={sel.key === d.key}
              className={`rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
                sel.key === d.key ? "border-[var(--color-primary)] bg-primary-soft text-primary" : "border-line text-ink-2 hover:border-ink-3"
              }`}
            >
              {d.name}
            </button>
          ))}
          {rest.length > 0 && chips.length < view.dossiers.length && (
            <button type="button" onClick={() => setShowAll(true)} className="px-2 py-1 text-[12.5px] font-medium text-ink-3 hover:text-ink-2">
              More brands {"▸"}
            </button>
          )}
        </div>
      </section>

      <DossierPage key={sel.key} d={sel} onOpenCell={onOpenCell} onOpenView={onOpenView} />

      {matchup && (
        <section className="card grid gap-2 p-6">
          <h3 className="section-label">When does each side win?</h3>
          <p className="text-[12px] text-ink-3">The boundaries the AI states when asked to pick between the two. Click a condition to read the answers that state it.</p>
          <Boundaries row={matchup} brand={view.brand} onOpen={setOpened} bare />
        </section>
      )}
      {opened && <AnswersModal key={opened.ids.join(",")} runId={runId} target={opened} onClose={close} />}
    </div>
  );
}
