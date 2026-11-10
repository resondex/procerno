"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dossier, DossierArg, DossiersView } from "@/lib/engine/dossiers";
import type { HeadToHeadViews } from "@/lib/engine/head_to_head";
import { Boundaries } from "./head_to_head_view";
import { AnswersModal, type AnswersTarget, Fig, plainQuote, ReasonList, useEngineSet, viewQuery } from "./view_parts";

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
/* These mirror the map's pa-yours / pa-theirs verdict colors (light and dark). */
.dz-root{ --dz-yours:#0d9488; --dz-theirs:#be185d; }
@media (prefers-color-scheme: dark){ .dz-root{ --dz-yours:#14a08f; --dz-theirs:#d2497e; } }
.dz-root{ --dz-amber-bg:color-mix(in srgb, var(--dz-amber) 10%, var(--surface)); }
@keyframes dz-slide{ from{ transform:translateX(100%) } to{ transform:none } }
@keyframes dz-fade{ from{ opacity:0 } to{ opacity:1 } }
.dz-panel{ animation: dz-slide .22s ease; }
.dz-scrim{ animation: dz-fade .2s ease; }
@media (prefers-reduced-motion: reduce){ .dz-panel, .dz-scrim{ animation:none; } }
@media print{ .dz-panel, .dz-scrim{ display:none !important; } }
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

const Line = ({ children }: { children: React.ReactNode }) => <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{children}</p>;

function SeeMore({ onClick, label = "See more" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="mt-1.5 select-none text-[12px] font-medium text-ink-3 hover:text-ink-2">
      {label} {"▸"}
    </button>
  );
}

type PanelSection = "args" | "routes" | "supply";
/** The one panel's section ids, stable so a See-more can scroll to its section. */
const sectionId = (key: string, sec: PanelSection) => `dz-${sec}-${key.replace(/[^a-z0-9]+/gi, "-")}`;

type PanelLink = { label: string; go: () => void };

/**
 * The rival's one panel (option D, 2026-11-09): the map's position-panel
 * grammar - crumb, claim, "The numbers", "The arguments", "The reasons"
 * (themed, both ways), "The receipts", who supplies its picks, links. The
 * card's three See-mores all open it, scrolled to their section. Chrome as
 * the map's panel (scrim, right-side card, Escape / x / backdrop to close);
 * never printed; no counts.
 */
function DossierPanel({
  d,
  section,
  onClose,
  onOpen,
  links,
}: {
  d: Dossier;
  section: PanelSection | null;
  onClose: () => void;
  onOpen?: (t: AnswersTarget) => void;
  links: PanelLink[];
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    if (section) document.getElementById(sectionId(d.key, section))?.scrollIntoView({ block: "start" });
    else asideRef.current?.scrollTo({ top: 0 });
  }, [d.key, section]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const ph3 = "mt-6 mb-2 border-t border-line pt-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3";
  const receipts = d.receipts ?? [];
  const openReceipt = (id: string, quote?: string) => {
    if (!onOpen) return;
    onClose();
    onOpen({ title: `${d.name} picked`, subtitle: "Open buying questions", ids: [id], ...(quote ? { highlight: [quote] } : {}) });
  };
  return (
    <>
      <div className="dz-scrim fixed inset-0 z-40 bg-black/35" onClick={onClose} aria-hidden />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${d.name} - the rival panel`}
        className="dz-panel fixed inset-y-0 right-0 z-[45] w-full max-w-[600px] overflow-y-auto border-l border-line bg-surface px-5 pb-10 pt-5 shadow-2xl sm:px-6"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="float-right ml-3 grid h-8 w-8 place-items-center rounded-full border border-line text-ink-3 hover:text-ink"
        >
          ×
        </button>
        <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-ink-3">Rival · {d.name} · All buyers</div>
        <h2 className="mb-2.5 max-w-[48ch] text-[1.15rem] font-semibold leading-snug text-ink [text-wrap:balance]">{d.headline}</h2>
        {d.switching && (
          <p className="text-[13px] leading-relaxed text-ink-2">
            {d.switching}
            {d.switchingNoPick && ` ${d.switchingNoPick}`}
          </p>
        )}

        <div className={ph3}>The numbers</div>
        {d.tiles.map((t) => (
          <Fig key={t.label} label={t.label} value={t.value} />
        ))}
        {d.h2h.kind === "record" ? (
          <>
            <Fig label={d.h2h.youLabel} value={d.h2h.you} />
            <Fig label={d.h2h.themLabel} value={d.h2h.them} />
            {d.h2h.asClass && <p className="mt-1 text-[12px] text-ink-3">Asked against the {d.name} class of product, not one brand.</p>}
          </>
        ) : d.h2h.alert ? (
          <div className="mt-2 rounded-lg px-2.5 py-2 text-[12.5px] leading-snug" style={{ background: "var(--dz-amber-bg)", color: "var(--dz-amber)" }}>
            {d.h2h.note}
          </div>
        ) : (
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{d.h2h.note}</p>
        )}

        {d.argsAll.length > 0 && (
          <div id={sectionId(d.key, "args")} className="scroll-mt-4">
            <div className={ph3}>The arguments</div>
            <ArgBars args={d.argsAll} sides={d.argSides} />
          </div>
        )}

        <div id={sectionId(d.key, "routes")} className="scroll-mt-4">
          <div className={ph3}>The reasons</div>
          <p className="text-[13px] leading-relaxed text-ink-2">Most often stated first. The two lists are read on different questions, so their shares never add up across them.</p>
          {/* Same two-column shape as the map's position panel (you on the
              left, the rival on the right); a side with nothing reads "None
              measured" so the grid never collapses to one column. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(
              [
                [
                  "Reasons to pick you",
                  "var(--dz-yours)",
                  "Each share is of the questions where the AI gives buyers any reason to pick you.",
                  d.routesBack ?? [],
                  d.routesBackThemes ?? [],
                  d.routesBackDefault,
                ],
                [
                  "Reasons to leave you",
                  "var(--dz-theirs)",
                  "Each share is of the questions where the AI gives buyers any reason to leave you.",
                  d.routesAll ?? [],
                  d.routesThemes ?? [],
                  d.routesDefault,
                ],
              ] as const
            ).map(([title, color, note, flat, themes, dflt]) => (
              <div key={title} className="min-w-0">
                <h4 className="mb-1.5 text-[13px] font-semibold" style={{ color }}>
                  {title}
                </h4>
                {flat.length === 0 && !dflt ? (
                  <p className="py-1 text-[13px] text-ink-3">None measured</p>
                ) : (
                  <>
                    <p className="mb-1 text-[12px] leading-snug text-ink-3">{note}</p>
                    <ReasonList flat={flat} themes={themes} wallColor="var(--dz-theirs)" />
                    {dflt && <p className="mt-2 text-[12.5px] italic leading-snug text-ink-2">{dflt}</p>}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {receipts.length > 0 && (
          <>
            <div className={ph3}>The receipts</div>
            {receipts.map((r) =>
              r.quote ? (
                <button
                  key={r.responseId}
                  type="button"
                  onClick={() => openReceipt(r.responseId, r.quote)}
                  disabled={!onOpen}
                  className="block w-full text-left disabled:cursor-default"
                >
                  <blockquote className="my-2.5 rounded-r-md border-l-[3px] border-line bg-canvas px-3.5 py-2.5 text-[13px] leading-relaxed text-ink hover:border-ink-3">
                    &ldquo;{plainQuote(r.quote)}&rdquo;
                  </blockquote>
                </button>
              ) : (
                <button
                  key={r.responseId}
                  type="button"
                  onClick={() => openReceipt(r.responseId)}
                  disabled={!onOpen}
                  className="my-1 block text-[12.5px] font-medium text-primary hover:opacity-80 disabled:cursor-default"
                >
                  Read the answer {"→"}
                </button>
              )
            )}
          </>
        )}

        {d.supplyAll.assistants.length > 0 && (
          <div id={sectionId(d.key, "supply")} className="scroll-mt-4">
            <div className={ph3}>Who supplies its picks</div>
            <p className="text-[13px] leading-relaxed text-ink-2">Share of its picks, beside the share of the questions each answers.</p>
            {d.supplyAll.vendors.length > 0 && (
              <>
                <div className="mt-3 mb-1 text-[12px] font-semibold text-ink-2">By company</div>
                {d.supplyAll.vendors.map((r) => (
                  <Fig key={r.label} label={r.label} value={`${r.picks} of its picks · answers ${r.answers}`} />
                ))}
              </>
            )}
            <div className="mt-3 mb-1 text-[12px] font-semibold text-ink-2">By assistant</div>
            {d.supplyAll.assistants.map((r) => (
              <Fig key={r.label} label={r.label} value={`${r.picks} of its picks · answers ${r.answers}`} />
            ))}
          </div>
        )}

        {links.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3.5">
            {links.map((l) => (
              <button
                key={l.label}
                type="button"
                onClick={() => {
                  onClose();
                  l.go();
                }}
                className="text-[12.5px] font-semibold text-primary hover:opacity-80"
              >
                {l.label} {"→"}
              </button>
            ))}
          </div>
        )}
      </aside>
    </>
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
  onOpen,
}: {
  d: Dossier;
  onOpenCell?: (cellId: string) => void;
  onOpenView?: (v: "metrics") => void;
  onOpen?: (t: AnswersTarget) => void;
}) {
  const links: { label: string; go: () => void }[] = [];
  if (d.cells.h2h && onOpenCell) links.push({ label: "Head-to-head on the map", go: () => onOpenCell(d.cells.h2h!) });
  if (d.cells.leaver && onOpenCell) links.push({ label: "Its leaver cell", go: () => onOpenCell(d.cells.leaver!) });
  if (onOpenView) links.push({ label: "Build a table", go: () => onOpenView("metrics") });
  const more = d.argsAll.length > d.args.length;
  // The one panel: open (with the section to scroll to, or null for the top) or closed.
  const [panel, setPanel] = useState<{ section: PanelSection | null } | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);
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
            {more && <SeeMore onClick={() => setPanel({ section: "args" })} />}
          </Section>
        )}
        {(d.routes || d.routesDefault) && (
          <Section title="The reasons, both ways">
            {d.routes && <Line>{d.routes}</Line>}
            {d.routesDefault && <Line>{d.routesDefault}</Line>}
            {((d.routesAll ?? []).length > 1 || (d.routesBack ?? []).length > 0 || d.routesBackDefault) && (
              <SeeMore onClick={() => setPanel({ section: "routes" })} label={(d.routesBack ?? []).length > 0 || d.routesBackDefault ? "Reasons point back to you too - see both sides" : undefined} />
            )}
          </Section>
        )}
        {d.supply && (
          <Section title="Who supplies its picks">
            <Line>{d.supply}</Line>
            {d.supplyAll.assistants.length > 0 && <SeeMore onClick={() => setPanel({ section: "supply" })} />}
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
      {panel && <DossierPanel d={d} section={panel.section} onClose={closePanel} onOpen={onOpen} links={links} />}
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

      <DossierPage key={sel.key} d={sel} onOpenCell={onOpenCell} onOpenView={onOpenView} onOpen={setOpened} />

      {matchup && (
        <section className="card grid gap-2 p-6">
          <h3 className="section-label">When does each side win?</h3>
          <p className="text-[12px] text-ink-3">The boundaries the AI states when asked to pick between the two. Click a reason to read the answers that state it.</p>
          <Boundaries row={matchup} brand={view.brand} onOpen={setOpened} bare />
        </section>
      )}
      {opened && <AnswersModal key={opened.ids.join(",")} runId={runId} target={opened} onClose={close} />}
    </div>
  );
}
