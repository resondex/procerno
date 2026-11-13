"use client";

import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFICIT_TRIAGES,
  SURPLUS_TRIAGES,
  TRIAGE_LABEL,
  type AnalysisDecision,
  type AnalysisMapView,
  type AnswerRef,
  type ArgsMode,
  type BrandRead,
  type CellVerdict,
  type BothWaysItem,
  type ConditionItem,
  type LiftItem,
  type MapCell,
  type Position,
  type PositionException,
  type PositionNotes,
  type PositionReceipt,
  type RivalHere,
  type RouteShare,
  type Triage,
} from "@/lib/engine/analysis_types";
import type { DossierTheme } from "@/lib/engine/reason_themes";
import type { Dossier, DossierArg } from "@/lib/engine/dossiers";
import type { HeadToHeadRow } from "@/lib/engine/head_to_head";
import { Boundaries } from "./head_to_head_view";
import EvidencePanel, { EVIDENCE_CAP, type EvidenceRequest } from "./evidence_panel";
import RulesSection from "./rules_view";
import { AnswersModal, Fig, type AnswersTarget } from "./view_parts";
import AnswerText from "./answer_text";
import { passageOf } from "@/lib/answer_passage";
import { T } from "./type_scale";
import { MatchupGap } from "./matchup_action";

/**
 * The one slide-over (2026-11-10, the ratified analysis redesign -
 * scratchpad template.html): every contest, finding and rival opens here,
 * decision-first. A contest reads crumb -> claim -> soft caveat -> one answer
 * quote -> What to do (the move, Add to playbook, the quiet "Change it"
 * disclosure) -> the evidence, folded, each fold with a one-line teaser. A
 * rival opens scoped to one contest (from "Who takes the picks here") or
 * across all buyers. Every "See answers" opens the answer passages inline,
 * fetched lazily by id and cached for the panel's life.
 *
 * The engine contract's newer fields are all OPTIONAL (analysis_types.ts);
 * every feature degrades to the older payload when a field is absent - flat
 * lists with relative bars, lifts only, the receipts' quotes as the proof -
 * and a section with nothing to show says so in a sentence rather than
 * vanishing.
 */

// ---------- small shared words and helpers ----------

export const VWORD: Record<CellVerdict, string> = { yours: "Yours", contested: "Contested", theirs: "Theirs", nocall: "No side taken" };
export const VCOLOR: Record<CellVerdict, { fg: string; bg: string }> = {
  yours: { fg: "var(--pa-yours)", bg: "var(--pa-yours-bg)" },
  contested: { fg: "var(--pa-contested)", bg: "var(--pa-contested-bg)" },
  theirs: { fg: "var(--pa-theirs)", bg: "var(--pa-theirs-bg)" },
  nocall: { fg: "var(--pa-nocall)", bg: "var(--pa-nocall-bg)" },
};

/** "What the AI says about the <category>" - the products when the category is missing or long. */
export function catPhrase(category?: string | null): { plural: string; singular: string } {
  const c = (category ?? "").trim();
  if (!c || c.split(/\s+/).length > 4) return { plural: "products", singular: "product" };
  return { plural: c, singular: c.replace(/(ies)$/i, "y").replace(/(?<!s)s$/i, "") };
}

export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pctNum = (s?: string) => {
  const m = /(\d+(?:\.\d+)?)/.exec(s ?? "");
  return m ? parseFloat(m[1]) : 0;
};

// ---------- answer bodies: fetched lazily by id, cached per panel host ----------

interface Body {
  id: string;
  text: string;
  engine: string;
  promptText: string;
}
interface Bodies {
  get: (id: string) => Body | undefined;
  load: (ids: string[]) => Promise<void>;
  blocked: boolean;
}
const BodiesCtx = createContext<Bodies | null>(null);

/** The host's body cache: one Map for every panel it opens, so reopening a panel never refetches. */
export function BodiesProvider({ runId, children }: { runId: string; children: ReactNode }) {
  const cache = useRef(new Map<string, Body>());
  const asked = useRef(new Set<string>());
  const [blocked, setBlocked] = useState(false);
  const [, setTick] = useState(0);
  const load = useCallback(
    async (ids: string[]) => {
      const want = [...new Set(ids)].filter((id) => !asked.current.has(id)).slice(0, EVIDENCE_CAP);
      if (want.length === 0) return;
      for (const id of want) asked.current.add(id);
      try {
        const r = await fetch(`/api/runs/${runId}/answer_bodies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: want }),
        });
        if (r.status === 403) {
          setBlocked(true);
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { answers: Body[] };
        for (const a of d.answers) cache.current.set(a.id, a);
        setTick((t) => t + 1);
      } catch {
        // let a later open try again
        for (const id of want) asked.current.delete(id);
        setTick((t) => t + 1);
      }
    },
    [runId]
  );
  const get = useCallback((id: string) => cache.current.get(id), []);
  return <BodiesCtx.Provider value={{ get, load, blocked }}>{children}</BodiesCtx.Provider>;
}

function useBodies(ids: string[]): Bodies | null {
  const b = useContext(BodiesCtx);
  const key = ids.join(",");
  useEffect(() => {
    if (b && key) void b.load(key.split(","));
  }, [b, key]);
  return b;
}

/** What "See examples" opens: the answers behind one row or claim. */
export interface ExamplesTarget {
  title: string;
  subtitle?: string;
  note?: string;
  refs: AnswerRef[];
}
const ExamplesCtx = createContext<((t: ExamplesTarget) => void) | null>(null);

/** Opens the examples modal from anywhere under an ExamplesHost (null outside one). */
export const useShowExamples = () => useContext(ExamplesCtx);

/** Hosts the one examples modal for everything beneath it (the slide-over,
 * and the Overview's numbers, board rows and finding bars). Needs a
 * BodiesProvider above it. */
export function ExamplesHost({ children }: { children: ReactNode }) {
  const [examples, setExamples] = useState<ExamplesTarget | null>(null);
  const close = useCallback(() => setExamples(null), []);
  return (
    <ExamplesCtx.Provider value={setExamples}>
      {children}
      {examples && <ExamplesModal key={examples.refs.map((r) => r.responseId).join(",")} target={examples} onClose={close} />}
    </ExamplesCtx.Provider>
  );
}

/**
 * The examples modal: for each answer, the question the buyer asked, the
 * passage that matters with its sentence marked, and which assistant answered.
 * Everything appears together once the answers have loaded - nothing trickles
 * in - and each example can open to the whole answer.
 */
function ExamplesModal({ target, onClose }: { target: ExamplesTarget; onClose: () => void }) {
  const b = useBodies(target.refs.map((r) => r.responseId));
  const [full, setFull] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const ready = target.refs.filter((r) => b?.get(r.responseId));
  const loading = !b?.blocked && ready.length === 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={target.title}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="grid w-full max-w-2xl content-start overflow-hidden rounded-xl border border-line bg-[var(--color-surface)] shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <div className={T.label}>Examples from the answers</div>
            <h3 className={`${T.title} mt-1`}>{target.title}</h3>
            {target.subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{target.subtitle}</p>}
            {target.note && <p className="mt-1 text-[12px] text-ink-3">{target.note}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none text-ink-3 hover:text-ink">
            ×
          </button>
        </div>
        <div className="grid max-h-[75vh] content-start gap-5 overflow-y-auto p-4">
          {b?.blocked && <p className="text-[13px] text-ink-3">The answers behind this are switched off for this tracker.</p>}
          {loading && <p className="text-[13px] text-ink-3">Loading the examples...</p>}
          {ready.map((r, i) => {
            const body = b!.get(r.responseId)!;
            const ps = passageOf(body.text, r.find);
            const open = full.has(i);
            return (
              <div key={`${r.responseId}${i}`} className={`grid gap-2 ${i > 0 ? "border-t border-line/60 pt-5" : ""}`}>
                {body.promptText && (
                  <p className="text-[13px] text-ink-2">
                    <span className="text-ink-3">A buyer asked: </span>
                    {body.promptText}
                  </p>
                )}
                {open ? (
                  <div className="max-h-80 overflow-y-auto border-l-2 border-line pl-3">
                    <AnswerText text={body.text} />
                  </div>
                ) : (
                  <p className="border-l-2 border-line pl-3 text-[14px] leading-relaxed text-ink-2">
                    {ps.before}
                    <mark className="rounded-[3px] bg-primary-soft px-0.5 text-ink">{ps.hit}</mark>
                    {ps.after}
                  </p>
                )}
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] text-ink-3">
                  <span>
                    Answered by {body.engine}
                    {r.picked && (
                      <>
                        {" - "}picked <span className="font-medium text-ink-2">{r.picked}</span>
                      </>
                    )}
                    {r.to && (
                      <>
                        {" - "}sent to <span className="font-medium text-ink-2">{r.to}</span>
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    className="text-primary hover:opacity-80"
                    onClick={() => {
                      const n = new Set(full);
                      if (open) n.delete(i);
                      else n.add(i);
                      setFull(n);
                    }}
                  >
                    {open ? "Show the passage only" : "Read the whole answer"}
                  </button>
                </p>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

/** The link under a claim: a few of the answers the claim counts. */
function ExampleLink({ receipts, title, subtitle }: { receipts: PositionReceipt[]; title: string; subtitle?: string }) {
  const show = useContext(ExamplesCtx);
  const quoted = receipts.filter((r) => r.quote);
  const use = quoted.length > 0 ? quoted : receipts;
  if (!show || use.length === 0) return null;
  return (
    <p className="clear-both mt-3">
      <button
        type="button"
        className="text-[13px] font-medium text-primary underline underline-offset-2 hover:opacity-80"
        onClick={() => show({ title, subtitle, refs: use.map((r) => ({ responseId: r.responseId, find: r.quote ?? "" })) })}
      >
        See examples
      </button>
    </p>
  );
}

// ---------- evidence sections: a short preview, "See all" opens the rest ----------

/**
 * One evidence section (2026-11-13, "option 3 - short preview", every panel):
 * the title, then a short preview of real rows; "See all ..." swaps in the
 * full content in place and "Show less" swaps it back. A section whose full
 * content adds nothing to the preview passes no `full` and draws no link. A
 * section opened from a deep link (its `id` in the address, or `defaultOpen`)
 * starts in its full state.
 */
function Sec({
  title,
  preview,
  full,
  more,
  id,
  defaultOpen,
}: {
  title: ReactNode;
  preview: ReactNode;
  /** The whole section; omitted when the preview already shows everything. */
  full?: ReactNode;
  /** The link under the preview: "See all 9 numbers". */
  more?: string;
  id?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => !!defaultOpen || (!!id && typeof window !== "undefined" && window.location.hash === `#${id}`));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && id && typeof window !== "undefined" && window.location.hash === `#${id}`) ref.current?.scrollIntoView({ block: "start" });
    // Only on mount: a deep link scrolls once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const can = full !== undefined && full !== null && full !== false;
  return (
    <div id={id} ref={ref} className="scroll-mt-4 border-t border-line pb-4 pt-3">
      <h3 className={`${T.title} mb-1.5`}>{title}</h3>
      {open && can ? full : preview}
      {can && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-2 text-[13px] font-medium text-primary underline underline-offset-2 hover:opacity-80"
        >
          {open ? "Show less" : more ?? "See all"}
        </button>
      )}
    </div>
  );
}

const seeAll = (n: number, noun: string) => `See all ${n} ${noun}`;

/** The numbers' preview: the rows the tests name, in that order, when every
 * test finds one; otherwise the first three as served (contest types with
 * other numbers - a doubt, a value verdict, a head-to-head). */
function previewNums<R extends { label: string }>(rows: R[], tests: RegExp[]): R[] {
  const hit = tests.map((t) => rows.find((r) => t.test(r.label)));
  return hit.every(Boolean) ? (hit as R[]) : rows.slice(0, 3);
}
const CONTEST_NUM_PREVIEW = [/^(Your share of the picks here|Share of picks)$/, /^Named\b/, /^Recommendations that end as the pick$/];
const RIVAL_NUM_PREVIEW = [/^Share of picks$/, /^Named\b/, /^Recommendations that end as the pick$/];

const Hint = ({ children }: { children: ReactNode }) => <p className={`${T.cap} mb-2 text-ink-3`}>{children}</p>;
const None = ({ children }: { children: ReactNode }) => <p className={`${T.body} text-ink-3`}>{children}</p>;

/** A row that opens its example answers in the modal (when it carries any). */
function Openable({ refs, head, title, note }: { refs?: AnswerRef[]; head: () => ReactNode; title: string; note?: string }) {
  const show = useContext(ExamplesCtx);
  const sub = useContext(WhereCtx);
  const can = !!show && (refs?.length ?? 0) > 0;
  return (
    <div className="border-b border-line/70">
      {can ? (
        <button type="button" onClick={() => show!({ title, subtitle: sub, note, refs: refs! })} className="block w-full py-2 text-left">
          {head()}
        </button>
      ) : (
        <div className="py-2">{head()}</div>
      )}
    </div>
  );
}

/** Where the open panel is looking (the examples modal's second line). */
const WhereCtx = createContext<string | undefined>(undefined);

const SeeWord = () => <span className="mt-0.5 block text-[12px] text-primary">See examples</span>;

/** am27: a head-to-head lost on balance where the AI still says to choose
 * you in some cases - the cases, each with its share of the lost answers, the
 * fixed tag when it is a situation the buyer is already in, and the answers
 * (each picked the rival and still states the case). */
function ExceptionBlock({ e, brand }: { e: PositionException; brand: string }) {
  const show = useContext(ExamplesCtx);
  const sub = useContext(WhereCtx);
  const max = Math.max(1, ...e.rows.map((r) => pctNum(r.share)));
  return (
    <div className="clear-both mt-4 rounded-xl border border-line p-3.5" style={{ background: "var(--pa-theirs-bg)" }}>
      <div className={`${T.label} mb-1`} style={{ color: "var(--pa-theirs)" }}>
        You lose this one - with an exception
      </div>
      <p className={`${T.body} text-ink`} title={e.tip}>
        When the AI picks {e.rival} here, it still says to choose {brand} in these cases:
      </p>
      <div className="mt-2">
        {e.rows.map((r, i) => {
          const can = !!show && (r.refs?.length ?? 0) > 0;
          return (
            <div key={`${i}:${r.text}`} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-baseline gap-x-2 gap-y-1 border-b border-line/70 py-2 text-[14px] last:border-b-0" title={r.tip}>
              <span className="min-w-0 text-ink">
                {r.text}
                {r.wall && (
                  <span
                    title="A fact about the buyer, not a preference - it cannot be argued away"
                    className="ml-1.5 rounded-[4px] border border-ink-3 px-1 align-[1px] text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3"
                  >
                    fixed
                  </span>
                )}
              </span>
              <span className="text-right text-[13px] font-semibold tabular-nums text-ink">{r.share}</span>
              <span className="col-span-full block h-[5px] rounded-[3px] bg-line/60">
                <i className="block h-full min-w-[3px] rounded-[3px]" style={{ width: `${Math.round((100 * pctNum(r.share)) / max)}%`, background: "var(--pa-yours)" }} />
              </span>
              {can && (
                <button
                  type="button"
                  className="col-span-full justify-self-start text-[12px] text-primary hover:opacity-80"
                  onClick={() => show!({ title: r.text, subtitle: sub, note: `Each answer picked ${e.rival} and still says to choose ${brand} in this case.`, refs: r.refs! })}
                >
                  See examples
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One condition the AI states about the buyer: label, fixed tag, rivals, share, bar, answers. */
interface CondRowData {
  label: string;
  share?: string;
  weight: number;
  wall?: boolean;
  routes?: RouteShare[];
  members?: string[];
  receipts?: AnswerRef[];
  tip?: string;
}
const ROW_TOP = 8;
function CondRows({ rows, color }: { rows: CondRowData[]; color: string }) {
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.weight));
  const shown = all ? rows : rows.slice(0, ROW_TOP);
  return (
    <>
      {shown.map((r, i) => (
        <Openable
          key={`${i}:${r.label}`}
          refs={r.receipts}
          title={r.label}
          note={r.members && r.members.length > 1 ? `Includes: ${r.members.join(" - ")}` : undefined}
          head={() => (
            <span className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-baseline gap-x-2 gap-y-1 text-[14px]" title={r.tip}>
              <span className="min-w-0 text-ink">
                {r.label}
                {r.wall && (
                  <span
                    title="A fact about the buyer, not a preference - it cannot be argued away"
                    className="ml-1.5 rounded-[4px] border border-ink-3 px-1 align-[1px] text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3"
                  >
                    fixed
                  </span>
                )}
                {r.routes && r.routes.length > 0 && (
                  <span className="ml-1.5 whitespace-nowrap text-[12px] text-ink-3">{"→ "}{r.routes.slice(0, 2).map((x) => x.name).join(", ")}</span>
                )}
              </span>
              <span className="text-right text-[13px] font-semibold tabular-nums text-ink">{r.share ?? ""}</span>
              <span className="col-span-full block h-[5px] rounded-[3px] bg-line/60">
                <i className="block h-full min-w-[3px] rounded-[3px]" style={{ width: `${Math.round((100 * r.weight) / max)}%`, background: color }} />
              </span>
              {(r.receipts?.length ?? 0) > 0 && <span className="col-span-full"><SeeWord /></span>}
            </span>
          )}
        />
      ))}
      {rows.length > ROW_TOP && (
        <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className="mt-1.5 text-[12px] text-ink-3 hover:text-ink-2">
          {all ? "Show the biggest only ▴" : "Show every one ▾"}
        </button>
      )}
    </>
  );
}

function themeMembers(t: DossierTheme): string[] {
  const out: string[] = [];
  for (const b of t.buckets ?? []) {
    if ((b.members ?? []).length === 0) {
      if (!out.includes(b.label)) out.push(b.label);
    } else for (const m of b.members) if (!out.includes(m.label)) out.push(m.label);
  }
  return out.slice(0, 4);
}
// A grouped reason is tagged fixed only by its own name (the engine's tag on the
// wording shown). A fixed wording inside a broad group never tags the whole group
// (2026-11-13: "Earn more by optimizing spend" was tagged for a 2% member); member
// rows keep their own tags.
const themeWall = (t: DossierTheme) => !!t.wall;

const themeRows = (ts: DossierTheme[]): CondRowData[] =>
  ts.slice(0, 8).map((t) => ({ label: t.label, share: t.share, weight: pctNum(t.share), wall: themeWall(t), routes: t.routes, members: themeMembers(t), receipts: t.receipts }));
const flatRows = (cs: ConditionItem[]): CondRowData[] =>
  // The count drives the bar (shares on one base round alike); the share prints when the payload carries one.
  cs.map((c) => ({ label: c.text, share: c.share, weight: c.n, wall: c.wall, routes: c.routes, receipts: c.receipts, tip: `About ${c.n} answers` }));
const shareRows = (cs: { label: string; share: string }[]): CondRowData[] => cs.map((c) => ({ label: c.label, share: c.share, weight: pctNum(c.share) }));

/** "What it says about the buyer": two columns, toward you then away from you. */
function BuyerColumns({ toward, away, towardTitle, awayTitle }: { toward: CondRowData[]; away: CondRowData[]; towardTitle: string; awayTitle: string }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {(
        [
          [towardTitle, toward, "var(--pa-yours)"],
          [awayTitle, away, "var(--pa-theirs)"],
        ] as const
      ).map(([title, rows, color]) => (
        <div key={title} className="min-w-0">
          <h5 className="mb-1 text-[13px] font-semibold text-ink">{title}</h5>
          {rows.length > 0 ? <CondRows rows={rows} color={color} /> : <None>None stated</None>}
        </div>
      ))}
    </div>
  );
}

/** am21: conditions the AI gives on both sides at similar rates - the same
 * reason sending some buyers to you and others away. Drawn above the two
 * columns so a split reason never hides behind two differently named rows. */
function BothWays({ items }: { items: BothWaysItem[] }) {
  return (
    <div className="mb-4 rounded-lg border border-line p-3">
      <h5 className="text-[13px] font-semibold text-ink">Comes up on both sides</h5>
      <p className="mt-0.5 text-[12px] text-ink-3">The AI gives these reasons for sending buyers to you and for sending them away - the reason alone does not decide it.</p>
      <div className="mt-1.5">
        {items.map((b) => (
          <Openable
            key={b.text}
            refs={[...(b.towardRefs ?? []), ...(b.awayRefs ?? [])]}
            title={b.text}
            note="Some of these answers send the buyer to you, some send them away - each says where."
            head={() => (
              <span className="block text-[14px]">
                <span className="text-ink">{b.text}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] tabular-nums">
                  <span style={{ color: "var(--pa-yours)" }}>Toward you {b.towardShare}</span>
                  <span style={{ color: "var(--pa-theirs)" }}>
                    Away {b.awayShare}
                    {b.routes && b.routes.length > 0 && <span className="text-ink-3">{" → "}{b.routes.slice(0, 2).map((x) => x.name).join(", ")}</span>}
                  </span>
                </span>
                {(b.towardRefs?.length ?? 0) + (b.awayRefs?.length ?? 0) > 0 && <SeeWord />}
              </span>
            )}
          />
        ))}
      </div>
    </div>
  );
}

const BUYER_HINT =
  "What the AI says about the buyer when it sends them each way. The number is how often it comes up, among the answers here where the AI says anything like it. Open one to see examples.";

/** Lift rows: the code, its signed points, the two shares as bars, answers. */
function LiftRows({ lifts, sides }: { lifts: (LiftItem | DossierArg)[]; sides: [string, string] }) {
  return (
    <>
      {lifts.map((l) => (
        <Openable
          key={l.label}
          refs={l.receipts}
          title={l.label}
          head={() => (
            <span className="block text-[14px]" title={"tip" in l ? l.tip : undefined}>
              <span className="flex justify-between gap-3">
                <b className="font-semibold text-ink">{l.label}</b>
                <span className="tabular-nums text-ink-2">
                  {l.value > 0 ? "+" : ""}
                  {Math.round(l.value)} points
                </span>
              </span>
              {l.wins && l.others && (
                <span className="mt-1 grid grid-cols-2 gap-2.5 text-[12px] text-ink-3">
                  {(
                    [
                      [l.wins, sides[0], "var(--primary)"],
                      [l.others, sides[1], "var(--neutral-bar)"],
                    ] as const
                  ).map(([v, side, c]) => (
                    <span key={side}>
                      {v} of {side}
                      <span className="mt-0.5 block h-1.5 rounded-[3px] bg-line/60">
                        <i className="block h-full min-w-[2px] rounded-[3px]" style={{ width: `${Math.min(100, pctNum(v))}%`, background: c }} />
                      </span>
                    </span>
                  ))}
                </span>
              )}
              {(l.receipts?.length ?? 0) > 0 && <SeeWord />}
            </span>
          )}
        />
      ))}
    </>
  );
}

// ---------- the panel chrome ----------

function PanelShell({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    asideRef.current?.scrollTo({ top: 0 });
  }, [label]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A drill opened over the panel (the full answers) closes first, on its own.
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="pa-scrim fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="pa-panel fixed inset-y-0 right-0 z-[45] w-full max-w-[580px] overflow-y-auto overflow-x-hidden border-l border-line bg-surface px-5 pb-10 pt-5 shadow-2xl sm:px-6"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="sticky top-0 float-right ml-3 rounded-lg border border-line bg-surface px-2.5 py-0.5 text-[13px] text-ink-2 hover:text-ink"
        >
          Close
        </button>
        {children}
      </aside>
    </>
  );
}

const crumbCls = `flex flex-wrap items-center gap-2 ${T.label}`;
const h2Cls = `clear-both mt-2.5 ${T.h2} [text-wrap:balance]`;
const evh = `mb-2 mt-7 ${T.label}`;
const linkCls = "text-primary underline underline-offset-2 hover:opacity-80";
const rowLink = "flex w-full justify-between gap-3 border-b border-line py-2.5 text-left text-[14px] text-ink hover:text-primary";

// ---------- the contest panel ----------

export type PanelView =
  | { kind: "cell"; id: string }
  | { kind: "rival"; name: string; cell?: string | null; from?: string | null };

interface Ctx {
  runId: string;
  map: AnalysisMapView;
  cells: Map<string, MapCell>;
  dossiers: Dossier[] | null;
  findDossier: (name: string) => Dossier | undefined;
  cat: { plural: string; singular: string };
  decision: AnalysisDecision | null;
  editable: boolean;
  save: (body: { cellId: string; suggested: Triage; decided?: Triage | null; inPlaybook?: boolean }) => Promise<void>;
  open: (v: PanelView) => void;
  onClose: () => void;
  onBuildTable?: () => void;
  h2hRow: (d: Dossier) => HeadToHeadRow | null;
  brand: string;
}

/** The badge meanings as sentences: a fixed situation, your own cheaper option, picks leaving the category. */
export function notesOf(p: Position, cell?: MapCell): PositionNotes {
  if (p.notes) return p.notes;
  const b = cell?.badges ?? [];
  const out: PositionNotes = {};
  if (b.includes("wall")) out.wall = p.away.find((x) => x.wall)?.text ?? "";
  if (b.includes("inhouse")) out.inHouse = true;
  if (b.includes("leak")) out.leak = true;
  if (b.includes("watch")) out.soft = p.cellId.startsWith("settled:") ? "asked_for" : "one_assistant";
  return out;
}

export function whyLines(n: PositionNotes, cat: string): string[] {
  const out: string[] = [];
  if (n.wall !== undefined)
    out.push(
      n.wall
        ? `Many of the buyers sent away here are in a situation you cannot argue against: "${n.wall}". Go around it, not through it.`
        : "Many of the buyers sent away here are in a situation you cannot argue against. Go around it, not through it."
    );
  if (n.inHouse) out.push("Much of the doubt about price here points to your own cheaper option, not to a rival.");
  if (n.leak) out.push(`Some of the picks here go to products outside ${cat}, so part of this loss is not to a rival on your board.`);
  return out;
}

const softLine = (n: PositionNotes) =>
  n.soft === "asked_for"
    ? "Read this as a ceiling: it comes from questions where customers ask the AI to make your case. Unprompted, the AI is less favorable."
    : n.soft === "one_assistant"
      ? "This number is softer than it looks: most of the answers on your side come from one assistant."
      : null;

function MoveBox({ p, ctx, why }: { p: Position; ctx: Ctx; why: string[] }) {
  const entry = ctx.decision?.positions[p.cellId];
  const active: Triage = entry?.decided ?? p.triageSuggested;
  const inPlaybook = !!entry?.inPlaybook;
  const options = p.status === "deficit" ? DEFICIT_TRIAGES : SURPLUS_TRIAGES;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [change, setChange] = useState(false);
  const run = async (body: Parameters<Ctx["save"]>[0]) => {
    setBusy(true);
    setErr(null);
    try {
      await ctx.save(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (t: Triage) => {
    if (t === active) return;
    void run({ cellId: p.cellId, suggested: p.triageSuggested, decided: t === p.triageSuggested ? null : t });
  };
  return (
    <div className="mt-4 rounded-xl bg-primary-soft px-4 py-3.5">
      <div className={`${T.labelAccent} mb-1`}>What to do - {p.family}</div>
      {why.map((s) => (
        <p key={s} className="mb-2 text-[13px] leading-relaxed text-ink-2">
          {s}
        </p>
      ))}
      <p className={`${T.lede} mb-2.5`}>{p.lever}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {ctx.editable &&
          (inPlaybook ? (
            <>
              <span className="rounded-lg border border-line bg-surface px-3 py-1 text-[13px] font-medium text-ink">In your playbook</span>
              <button type="button" disabled={busy} onClick={() => void run({ cellId: p.cellId, suggested: p.triageSuggested, inPlaybook: false })} className="text-[12px] text-ink-3 hover:text-ink disabled:opacity-60">
                Remove
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run({ cellId: p.cellId, suggested: p.triageSuggested, inPlaybook: true })}
              className="rounded-lg bg-primary px-3 py-1 text-[13px] font-medium text-primary-ink hover:opacity-90 disabled:opacity-60"
            >
              Add to playbook
            </button>
          ))}
        <button type="button" onClick={() => setChange((c) => !c)} aria-expanded={change} className="text-[12px] text-ink-3 hover:text-ink-2">
          {ctx.editable ? "Not the right move? Change it" : "Why this move"} {change ? "▴" : "▾"}
        </button>
      </div>
      {change && (
        <div className="mt-3 border-t border-line pt-3 text-[13px]">
          <p className="mb-1.5 text-ink-2">{ctx.editable ? "What is going on here, as you read it:" : "The call behind this move:"}</p>
          <div className="flex flex-wrap gap-1.5">
            {options.map((t) =>
              ctx.editable ? (
                <button
                  key={t}
                  type="button"
                  disabled={busy}
                  onClick={() => pick(t)}
                  aria-pressed={t === active}
                  title={t === p.triageSuggested ? "The suggested call" : undefined}
                  className={`rounded-md border bg-surface px-2.5 py-0.5 text-[12px] transition-colors disabled:opacity-60 ${
                    t === active ? "border-[var(--color-primary)] font-semibold text-primary" : "border-line text-ink hover:border-ink-3"
                  }`}
                >
                  {TRIAGE_LABEL[t]}
                </button>
              ) : (
                t === active && (
                  <span key={t} className="rounded-md border border-[var(--color-primary)] bg-surface px-2.5 py-0.5 text-[12px] font-semibold text-primary">
                    {TRIAGE_LABEL[t]}
                  </span>
                )
              )
            )}
          </div>
          {entry?.decided && entry.decided !== p.triageSuggested && (
            <p className="mt-1.5 text-[12px] text-ink-3">Your call - the suggested one was {TRIAGE_LABEL[p.triageSuggested]}.</p>
          )}
          <p className="mt-2 leading-relaxed text-ink-2">{p.triageWhy}</p>
        </div>
      )}
      {err && <p className="mt-1.5 text-[12px] text-danger">{err}</p>}
    </div>
  );
}

function ContestPanel({ p, ctx }: { p: Position; ctx: Ctx }) {
  const cell = ctx.cells.get(p.cellId);
  const notes = notesOf(p, cell);
  const soft = softLine(notes);
  const [evidence, setEvidence] = useState<EvidenceRequest | null>(null);
  const cat = ctx.cat;
  const brands = p.brands ?? [];
  // The numbers list never repeats what another section draws: the by-brand
  // split is the next section, and "Share of picks" is "Your share of the
  // picks here" under another name.
  const figLabels = new Set((p.figures ?? []).map((f) => f.label));
  const figs = (p.figures ?? []).filter(
    (f) =>
      !(brands.length > 0 && f.label === "Share of the picks here, by brand") &&
      !(f.label === "Share of picks" && figLabels.has("Your share of the picks here")) &&
      !f.label.startsWith("Picks outside the category, by")
  );
  const you = p.youShare ?? "0%";
  const maxW = Math.max(1, ...brands.map((b) => pctNum(b.share)), pctNum(you));
  const sides = p.liftSides ?? ["your picks", "rivals' picks"];
  const up = p.lifts.find((l) => l.value > 0);
  const down = p.lifts.find((l) => l.value < 0);
  const mode: ArgsMode | null = p.argsMode ?? (p.lifts.length > 0 ? "compare" : null);
  const argsRows = p.argsRows ?? [];
  const toward = (p.towardThemes?.length ?? 0) > 0 ? themeRows(p.towardThemes!) : flatRows(p.toward);
  const away = (p.awayThemes?.length ?? 0) > 0 ? themeRows(p.awayThemes!) : flatRows(p.away);
  const pt = `What the AI says about the ${cat.plural}`;

  let argsPreview: ReactNode = null;
  let argsCount = 0;
  let argsBody: ReactNode = (
    <None>
      Too few answers here pick a side to compare what the AI says about the {cat.plural} when it picks you with when it picks a rival.
    </None>
  );
  if (mode === "compare" && p.lifts.length > 0) {
    // Preview: the strongest argument for you and the strongest against.
    const pv = up || down ? ([up, down].filter(Boolean) as LiftItem[]) : p.lifts.slice(0, 2);
    argsPreview = <LiftRows lifts={pv} sides={sides} />;
    argsCount = p.lifts.length > pv.length ? p.lifts.length : 0;
    argsBody = (
      <>
        <Hint>
          What the AI brings up more in {sides[0]} than in {sides[1]}. Open one to see examples.
        </Hint>
        <LiftRows lifts={p.lifts} sides={sides} />
      </>
    );
  } else if ((mode === "rival" || mode === "all" || mode === "topics") && argsRows.length > 0) {
    const hint = (
      <Hint>
        {mode === "rival"
          ? `Too few answers pick you here to compare your wins with theirs${p.youShare ? ` (you take ${p.youShare} of the picks)` : ""}. This is what the AI brings up when it picks a rival here.`
          : mode === "topics"
            ? "These questions come before the buyer is choosing, so there are no picks to compare. This is what the AI covers most when it answers them."
            : "The AI rarely picks a side here, so there are no wins and losses to compare. This is what it brings up most across all of these answers."}
      </Hint>
    );
    const rows = argsRows.map((r) => ({ label: r.label, share: r.share, weight: pctNum(r.share), receipts: r.receipts }));
    // The hint says what these rows are, so the preview keeps it.
    argsPreview = (
      <>
        {hint}
        <CondRows rows={rows.slice(0, 2)} color="var(--neutral-bar)" />
      </>
    );
    argsCount = rows.length > 2 ? rows.length : 0;
    argsBody = (
      <>
        {hint}
        <CondRows rows={rows} color="var(--neutral-bar)" />
      </>
    );
  } else if (mode === "topics" || mode === "all" || mode === "rival") {
    argsBody = (
      <None>
        These questions come before the buyer is choosing a {cat.singular}, so the answers are read for whether the AI brings you up, not for what it says about the {cat.plural}.
      </None>
    );
  }

  if (argsPreview === null) argsPreview = argsBody;

  // The numbers: the taker line, then every figure; the preview is your share
  // of the picks, named, and recommendations that end as the pick - or the
  // first three as served where a contest type has other numbers.
  const numRows: { label: string; value: string; tip?: string }[] = [
    ...(p.taker ? [{ label: "Who holds it", value: `${p.taker}${p.takerKind ? ` - ${p.takerKind}` : ""}` }] : []),
    ...figs,
  ];
  const numPreview = previewNums(numRows, CONTEST_NUM_PREVIEW);
  const numList = (rows: typeof numRows) =>
    rows.length > 0 ? (
      rows.map((f, i) => (
        <div key={`${f.label}${i}`} title={f.tip}>
          <Fig label={f.label} value={f.value} />
        </div>
      ))
    ) : (
      <None>No other numbers are tracked for this contest.</None>
    );

  // Who takes the picks: the top taker and you in the preview.
  const brandRow = (b: { name: string; share: string }) => (
    <button
      key={b.name}
      type="button"
      onClick={() => ctx.open({ kind: "rival", name: b.name, cell: p.cellId })}
      className="grid w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2.5 border-b border-line py-1.5 text-left text-[13px] text-ink hover:text-primary"
    >
      <span className="truncate">{b.name}</span>
      <span className="h-2 overflow-hidden rounded bg-line/60">
        <i className="block h-full rounded" style={{ width: `${(100 * pctNum(b.share)) / maxW}%`, background: "var(--pa-theirs)" }} />
      </span>
      <span className="text-right tabular-nums">{b.share}</span>
    </button>
  );
  const youRow = (
    <div key="__you" className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2.5 border-b border-line/70 py-1.5 text-[13px] font-semibold text-ink">
      <span>You</span>
      <span className="h-2 overflow-hidden rounded bg-line/60">
        <i className="block h-full rounded" style={{ width: `${(100 * pctNum(you)) / maxW}%`, background: "var(--pa-yours)" }} />
      </span>
      <span className="text-right tabular-nums">{you}</span>
    </div>
  );
  const topBrand = brands.length > 0 ? [...brands].sort((a, b) => pctNum(b.share) - pctNum(a.share))[0] : undefined;
  const brandsPreview = topBrand && pctNum(you) > pctNum(topBrand.share) ? [youRow, brandRow(topBrand)] : [topBrand && brandRow(topBrand), youRow];

  // What it says about the buyer: the top two each way, with their bars.
  const openAll = p.cellId === "chooses:open:all";
  const hasBuyer = toward.length > 0 || away.length > 0;
  const buyerMore = hasBuyer && (toward.length > 2 || away.length > 2 || (p.bothWays?.length ?? 0) > 0 || openAll);
  const buyerNone = <None>The AI says nothing about the buyer in this contest - its answer does not change with who is asking.</None>;
  const buyerFull = (
    <>
      {hasBuyer ? (
        <>
          <Hint>{BUYER_HINT}</Hint>
          {(p.bothWays?.length ?? 0) > 0 && <BothWays items={p.bothWays!} />}
          <BuyerColumns toward={toward} away={away} towardTitle="Toward you when the buyer..." awayTitle="Away from you when the buyer..." />
        </>
      ) : (
        buyerNone
      )}
      {openAll && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-medium text-primary underline decoration-dotted underline-offset-2">
            See everything the AI says about the buyer, every question type
          </summary>
          <div className="mt-3 grid gap-5">
            <RulesSection runId={ctx.runId} onEvidence={(ids, title) => setEvidence({ ids: ids.slice(0, EVIDENCE_CAP), title, total: ids.length })} />
          </div>
        </details>
      )}
    </>
  );
  return (
    <>
      <div className={crumbCls}>
        {cell && (
          <span className="flex items-center gap-1.5 normal-case tracking-normal" style={{ color: VCOLOR[cell.verdict].fg }}>
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: VCOLOR[cell.verdict].fg }} />
            {VWORD[cell.verdict]}
          </span>
        )}
        <span>{p.where}</span>
      </div>
      <h2 className={h2Cls}>{p.claim}</h2>
      {soft && <p className="clear-both mt-3 border-l-[3px] pl-2.5 text-[13px] text-ink" style={{ borderColor: "var(--pa-contested)" }}>{soft}</p>}
      <ExampleLink receipts={p.receipts} title={p.where} subtitle="A few of the answers behind this" />
      {p.exception && <ExceptionBlock e={p.exception} brand={ctx.brand} />}
      {p.lever && <MoveBox p={p} ctx={ctx} why={whyLines(notes, cat.plural)} />}

      <div className={evh}>The evidence</div>
      <Sec
        title="The numbers"
        preview={numList(numPreview)}
        full={numRows.length > numPreview.length ? numList(numRows) : undefined}
        more={seeAll(numRows.length, "numbers")}
      />
      {brands.length > 0 && (
        <Sec
          title="Who takes the picks here"
          preview={<>{brandsPreview}</>}
          full={
            brands.length > 1 ? (
              <>
                <Hint>Open a rival to see it in this contest only.</Hint>
                {brands.map(brandRow)}
                {youRow}
              </>
            ) : undefined
          }
          more={seeAll(brands.length + 1, "brands")}
        />
      )}
      <Sec title={pt} preview={argsPreview} full={argsCount > 0 ? argsBody : undefined} more={seeAll(argsCount, "arguments")} />
      <Sec
        title="What it says about the buyer"
        preview={
          hasBuyer ? (
            <BuyerColumns toward={toward.slice(0, 2)} away={away.slice(0, 2)} towardTitle="Toward you when the buyer..." awayTitle="Away from you when the buyer..." />
          ) : (
            buyerNone
          )
        }
        full={buyerMore || (!hasBuyer && openAll) ? buyerFull : undefined}
        more={hasBuyer ? seeAll(toward.length + away.length, "reasons") : "See everything the AI says about the buyer"}
      />
      {evidence && <EvidencePanel runId={ctx.runId} request={evidence} onClose={() => setEvidence(null)} />}
    </>
  );
}

// ---------- the rival panel ----------

/** The two scopes of a rival: this one contest, or every contest it appears in (its dossier). */
function ScopeChips({ name, cellId, scoped, ctx }: { name: string; cellId: string; scoped: boolean; ctx: Ctx }) {
  const p = ctx.map.positions[cellId];
  const seg = (on: boolean) => `rounded-full px-3 py-1 ${T.cap} ${on ? "bg-primary-soft font-semibold text-ink" : "text-ink-3 hover:text-ink-2"}`;
  return (
    <div className="clear-both mt-3 inline-flex max-w-full flex-wrap rounded-full border border-line p-[3px]">
      <button type="button" className={seg(scoped)} onClick={() => ctx.open({ kind: "rival", name, cell: cellId })}>
        Here: {p?.where ?? "this contest"}
      </button>
      <button type="button" className={seg(!scoped)} onClick={() => ctx.open({ kind: "rival", name, from: cellId })}>
        Everywhere {name} appears
      </button>
    </div>
  );
}

/** "Who takes the picks here": every listed brand and you, the focus brand
 * marked. The preview keeps the top taker, the focus brand and you. */
function PicksBars({ p, focus, ctx, preview }: { p: Position; focus: string; ctx: Ctx; preview?: boolean }) {
  const show = useShowExamples();
  const all = [
    ...(p.brands ?? []).map((b) => ({ name: b.name, share: b.share, you: false, proof: b.proof })),
    { name: "You", share: p.youShare ?? "0%", you: true, proof: [] as PositionReceipt[] },
  ].sort((a, b) => pctNum(b.share) - pctNum(a.share));
  const rows = preview ? all.filter((r, i) => i === 0 || r.you || normName(r.name) === normName(focus)) : all;
  const max = Math.max(1, ...all.map((r) => pctNum(r.share)));
  return (
    <div>
      {rows.map((r) => {
        const isFocus = !r.you && normName(r.name) === normName(focus);
        const color = r.you ? "var(--pa-yours)" : isFocus ? "var(--pa-theirs)" : "var(--neutral-bar)";
        const proof = r.proof.filter((x) => x.quote);
        const onClick = r.you
          ? undefined
          : isFocus
            ? proof.length && show
              ? () => show({ title: `Answers that pick ${r.name}`, subtitle: p.where, refs: proof.map((x) => ({ responseId: x.responseId, find: x.quote ?? "" })) })
              : undefined
            : () => ctx.open({ kind: "rival", name: r.name, cell: p.cellId });
        const inner = (
          <>
            <span className={`truncate ${isFocus || r.you ? "font-semibold" : ""}`}>{r.name}</span>
            <span className="h-2 overflow-hidden rounded bg-line/60">
              <i className="block h-full rounded" style={{ width: `${(100 * pctNum(r.share)) / max}%`, background: color }} />
            </span>
            <span className={`text-right tabular-nums ${isFocus || r.you ? "font-semibold" : ""}`}>{r.share}</span>
          </>
        );
        const cls = `grid w-full grid-cols-[minmax(0,8rem)_minmax(0,1fr)_2.75rem] items-center gap-2.5 border-b border-line/70 py-1.5 text-left ${T.body} text-ink`;
        return onClick ? (
          <button
            key={r.name}
            type="button"
            onClick={onClick}
            title={isFocus ? "See answers that pick it" : `Open ${r.name} in this contest`}
            className={`${cls} hover:text-primary`}
          >
            {inner}
          </button>
        ) : (
          <div key={r.name} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/** The funnel inside one contest: the rival beside you, each number opening its answers. */
function HowTable({
  name,
  them,
  you,
  share,
  preview,
}: {
  name: string;
  them: BrandRead;
  you?: BrandRead;
  /** Share of the picks here (the headline's number), so "picked in" - a share of every answer - connects to it. */
  share?: { them: string; you: string };
  /** The short preview: share of the picks, named, recommendations that end as the pick. */
  preview?: boolean;
}) {
  const show = useShowExamples();
  const where = useContext(WhereCtx);
  type K = "named" | "recommended" | "picked" | "converts";
  const allRows: [K, string][] = [
    ["named", "Named in"],
    ["recommended", "Recommended in"],
    ["picked", "Picked in"],
    ["converts", "Recommendations that end as the pick"],
  ];
  const rows = preview ? allRows.filter(([k]) => k === "named" || k === "converts") : allRows;
  const shareTip = "Of the answers here where the AI commits to one product";
  const cellOf = (r: BrandRead | undefined, k: K, who: string, label: string) => {
    if (!r) return <span className="text-ink-3">-</span>;
    const refs = k === "converts" ? undefined : r.refs[k];
    const val = r[k];
    if (refs?.length && show)
      return (
        <button
          type="button"
          title={`${r.tips[k]} - see examples`}
          onClick={() => show({ title: `${label.replace(/ in$/, "")} - ${who}`, subtitle: where, refs })}
          className="tabular-nums text-primary underline decoration-dotted underline-offset-2 hover:opacity-80"
        >
          {val}
        </button>
      );
    return (
      <span title={r.tips[k]} className="tabular-nums">
        {val}
      </span>
    );
  };
  const shareRow = share ? (
    <tr className="border-t border-line/70">
      <td className="py-1.5 pr-2 text-ink-2" title={shareTip}>
        Share of the picks
        <span className={`${T.cap} block text-ink-3`}>when the AI commits to one</span>
      </td>
      <td className="py-1.5 text-right align-top font-semibold tabular-nums text-ink" title={shareTip}>
        {share.them}
      </td>
      {you && (
        <td className="py-1.5 pl-3 text-right align-top font-semibold tabular-nums text-ink" title={shareTip}>
          {share.you}
        </td>
      )}
    </tr>
  ) : null;
  return (
    <table className={`w-full ${T.body}`}>
      <thead>
        <tr className={`${T.cap} text-ink-3`}>
          <th className="py-1 text-left font-normal">Of the answers here</th>
          <th className="py-1 text-right font-semibold" style={{ color: "var(--pa-theirs)" }}>
            {name}
          </th>
          {you && (
            <th className="py-1 pl-3 text-right font-semibold" style={{ color: "var(--pa-yours)" }}>
              You
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {preview && shareRow}
        {rows.map(([k, label]) => (
          <Fragment key={k}>
            <tr className="border-t border-line/70">
              <td className="py-1.5 pr-2 text-ink-2">{label}</td>
              <td className="py-1.5 text-right text-ink">{cellOf(them, k, name, label)}</td>
              {you && <td className="py-1.5 pl-3 text-right text-ink">{cellOf(you, k, "you", label)}</td>}
            </tr>
            {k === "picked" && shareRow}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** One sentence on how the rival gets its picks here: presence or conversion. */
function howSentence(name: string, them: BrandRead, you: BrandRead | undefined, behind: boolean): string | null {
  if (!you) return null;
  const tn = pctNum(them.named);
  const yn = pctNum(you.named);
  const tc = pctNum(them.converts);
  const yc = pctNum(you.converts);
  if (!behind)
    return `You lead ${name} here: you are named in ${you.named} of the answers to its ${them.named}, and ${you.converts} of your recommendations end as the pick to its ${them.converts}.`;
  const converts = tc > yc + 3;
  if (tn > yn + 5)
    return converts
      ? `${name} is named more often than you here (${them.named} to ${you.named}) and turns more of its recommendations into picks (${them.converts} to ${you.converts}).`
      : `${name} wins here on presence: it is named in ${them.named} of the answers to your ${you.named}.`;
  if (tn < yn - 5)
    return converts
      ? `You are named more often here (${you.named} to ${them.named}), but ${name} turns ${them.converts} of its recommendations into picks to your ${you.converts}.`
      : `You are named more often here (${you.named} to ${them.named}) and still trail it on picks.`;
  return converts
    ? `Named about as often as you here, ${name} turns ${them.converts} of its recommendations into picks to your ${you.converts}.`
    : `Named about as often as you here, ${name} converts about as well - its lead comes from a few more picks spread across the answers.`;
}

const flip = (l: LiftItem): LiftItem => ({ ...l, value: -l.value, wins: l.others, others: l.wins, receipts: l.receipts ? [...l.receipts].reverse() : undefined });

/** How many argument rows RivalArgs draws in full (the "See all N" count). */
function rivalArgsCount(here: RivalHere): number {
  if (here.argsMode === "compare" && here.args?.length)
    return Math.min(3, here.args.filter((l) => l.value > 0).length) + Math.min(3, here.args.filter((l) => l.value < 0).length);
  if (here.argsMode === "alone" && here.argsRows?.length) return Math.min(3, here.argsRows.length);
  return 0;
}

/** What the AI says about the category when it picks the rival here, beside
 * when it picks you. The preview keeps the strongest one each way (two rows
 * when the rival stands alone). */
function RivalArgs({ name, here, preview }: { name: string; here: RivalHere; preview?: boolean }) {
  const top = preview ? 1 : 3;
  if (here.argsMode === "compare" && here.args?.length) {
    const forIt = here.args.filter((l) => l.value > 0).slice(0, top);
    const forYou = here.args.filter((l) => l.value < 0).slice(0, top).map(flip);
    return (
      <div className="grid gap-4">
        {forIt.length > 0 && (
          <div>
            <h5 className={`${T.cap} mb-0.5 font-semibold text-ink`}>Comes up more when it picks {name}</h5>
            <LiftRows lifts={forIt} sides={["its picks", "your picks"]} />
          </div>
        )}
        {forYou.length > 0 && (
          <div>
            <h5 className={`${T.cap} mb-0.5 font-semibold text-ink`}>Comes up more when it picks you</h5>
            <LiftRows lifts={forYou} sides={["your picks", "its picks"]} />
          </div>
        )}
      </div>
    );
  }
  if (here.argsMode === "alone" && here.argsRows?.length)
    return (
      <>
        <Hint>You are picked too rarely here to set the two side by side. This is what comes up most when it picks {name}.</Hint>
        <CondRows rows={here.argsRows.slice(0, preview ? 2 : 3).map((r) => ({ label: r.label, share: r.share, weight: pctNum(r.share), receipts: r.receipts }))} color="var(--neutral-bar)" />
      </>
    );
  return null;
}

/** The rival inside one contest (the owner's ask, 2026-11-12): how big its lead
 * is, how it gets there, what the AI argues when it picks it, and which buyers
 * it sends there - drawn open. Where the contest is too thin for a part, ONE
 * note says so and that part reads the rival everywhere it appears instead.
 * On the pooled open-choice contest the two scopes are the same answers, so
 * there is no switch and the dossier's own sections fold in below. */
function RivalScoped({ name, p, ctx }: { name: string; p: Position; ctx: Ctx }) {
  const b = (p.brands ?? []).find((x) => normName(x.name) === normName(name))!;
  const d = ctx.findDossier(name);
  const here = b.here;
  const pooled = p.cellId === "chooses:open:all";
  const cat = ctx.cat;
  const you = p.youRead;

  const hasArgs = !!here && ((here.argsMode === "compare" && (here.args?.length ?? 0) > 0) || (here.argsMode === "alone" && (here.argsRows?.length ?? 0) > 0));
  // Which buyers it is sent: the run's reason themes scoped to this contest and
  // to the answers that send buyers to it (am22 `sendsThemes`, present whenever
  // the theme map exists); an older payload reads the cell's themes that route
  // to it; the flat list only when there are no themes at all.
  const scopedThemes = here?.sendsThemes;
  const awayThemes = scopedThemes ?? (p.awayThemes ?? []).filter((t) => (t.routes ?? []).some((r) => normName(r.name) === normName(name)));
  const themed = scopedThemes !== undefined || awayThemes.length > 0;
  const flatSends: CondRowData[] = (here?.sends ?? []).map((c) => ({ label: c.text, share: c.share, weight: c.n, wall: c.wall, receipts: c.receipts, tip: `About ${c.n} answers` }));
  const sendRows: CondRowData[] = themed ? themeRows(awayThemes).map((r) => ({ ...r, routes: [] })) : flatSends;
  const hasSends = sendRows.length > 0;

  // The fallbacks: the rival everywhere it appears (its dossier).
  const fbArgs = d
    ? d.argsAll
        .filter((a) => Math.abs(a.value) >= 5)
        .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
        .slice(0, 4)
    : [];
  const fbSends = d ? (d.routesThemes.length > 0 ? themeRows(d.routesThemes) : shareRows(d.routesAll ?? [])).slice(0, 3) : [];
  const useFbArgs = !hasArgs && !pooled && fbArgs.length > 0;
  const useFbSends = !hasSends && !pooled && fbSends.length > 0;
  const thin = [!hasArgs && `what the AI says about the ${cat.plural} when it picks ${name}`, !hasSends && `which buyers it sends to ${name}`].filter(Boolean) as string[];
  const fbAny = useFbArgs || useFbSends;

  // Every reason, both ways (the long tail): themes in prod, the flat lists otherwise.
  const toIt = sendRows;
  const back = (p.towardThemes?.length ?? 0) > 0 ? themeRows(p.towardThemes!) : flatRows(p.toward);

  const how = here ? howSentence(name, here.read, you, pctNum(b.share) > pctNum(p.youShare ?? "0%")) : null;

  // Preview counts, so a section whose preview already shows everything draws no link.
  const picksN = (p.brands ?? []).length + 1;
  const picksSorted = [...(p.brands ?? []).map((x) => ({ name: x.name, share: x.share, you: false })), { name: "You", share: p.youShare ?? "0%", you: true }].sort(
    (x, y) => pctNum(y.share) - pctNum(x.share)
  );
  const picksPreviewN = picksSorted.filter((r, i) => i === 0 || r.you || normName(r.name) === normName(name)).length;
  const argsN = here ? rivalArgsCount(here) : 0;
  const argsPreviewN = !here
    ? 0
    : here.argsMode === "compare"
      ? (here.args?.some((l) => l.value > 0) ? 1 : 0) + (here.args?.some((l) => l.value < 0) ? 1 : 0)
      : Math.min(2, here.argsRows?.length ?? 0);
  const fbUp = fbArgs.find((l) => l.value > 0);
  const fbDown = fbArgs.find((l) => l.value < 0);
  const fbPreview = fbUp || fbDown ? ([fbUp, fbDown].filter(Boolean) as DossierArg[]) : fbArgs.slice(0, 2);
  const sendsShown: CondRowData[] = hasSends ? sendRows : useFbSends ? fbSends.map((r) => ({ ...r, routes: [] })) : [];
  const bothWaysAny = toIt.length > 0 || back.length > 0;
  const sendsHint = scopedThemes
    ? `What the AI says about the buyer when it sends them to ${name} here. Each share is of the answers here that send buyers to ${name} with a stated condition.`
    : awayThemes.length
      ? `What the AI says about the buyer when it sends them away from you and on to ${name}. The share is of the answers here that send buyers away from you with a stated condition.`
      : here?.sendsShare
        ? `In ${here.sendsShare} of the answers here the AI names a condition on the buyer that sends them to ${name}. Each share is of those answers.`
        : `What the AI says about the buyer when it sends them to ${name}.`;

  // Next steps: the head-to-head, its own customers, its strongest buying situation, everywhere.
  const rooms = d ? roomsOf(d, ctx).filter((r) => r.cellId !== p.cellId) : [];
  const best = [...rooms].sort((x, y) => pctNum(y.them) - pctNum(x.them))[0];
  const next: { label: string; right: string; go: () => void }[] = [];
  if (d?.cells.h2h)
    next.push({
      label: `You and ${name}, asked head to head`,
      right: d.h2h.kind === "record" ? `you ${d.h2h.you} - ${name} ${d.h2h.them}` : "the matchup",
      go: () => ctx.open({ kind: "cell", id: d.cells.h2h! }),
    });
  if (d?.cells.leaver) next.push({ label: `Where ${name}'s customers go when they switch`, right: "its customers switching", go: () => ctx.open({ kind: "cell", id: d.cells.leaver! }) });
  if (best && pctNum(best.them) > pctNum(b.share)) next.push({ label: `Where ${name} is strongest: ${best.label}`, right: `${best.them} of the picks`, go: () => ctx.open({ kind: "rival", name, cell: best.cellId }) });
  if (!pooled && d) next.push({ label: `${name} everywhere it appears`, right: "by buyer, head to head, assistants", go: () => ctx.open({ kind: "rival", name, from: p.cellId }) });

  return (
    <>
      <div className={crumbCls}>
        <button type="button" className={linkCls} onClick={() => ctx.open({ kind: "cell", id: p.cellId })}>
          {p.where}
        </button>
        <span>- {name}</span>
      </div>
      <h2 className={h2Cls}>
        {name} takes {b.share} of the picks in this contest. You take {p.youShare ?? "0%"}.
      </h2>
      {how && <p className={`${T.lede} mt-2 text-ink-2`}>{how}</p>}
      {!pooled && d && <ScopeChips name={name} cellId={p.cellId} scoped ctx={ctx} />}

      <div className={evh}>The evidence</div>
      {thin.length > 0 && (
        <p className={`clear-both mb-3 border-l-[3px] border-line pl-2.5 ${T.sec} text-ink-2`}>
          Too few answers here to read {thin.join(" or ")}
          {fbAny ? `. ${useFbArgs && useFbSends ? "Both read" : "That part reads"} ${name} across every open buying question instead.` : "."}
        </p>
      )}

      {here && (
        <Sec
          title="The numbers"
          preview={<HowTable name={name} them={here.read} you={you} share={{ them: b.share, you: p.youShare ?? "0%" }} preview />}
          full={<HowTable name={name} them={here.read} you={you} share={{ them: b.share, you: p.youShare ?? "0%" }} />}
          more={seeAll(5, "numbers")}
        />
      )}

      <Sec
        title="Who takes the picks here"
        preview={<PicksBars p={p} focus={name} ctx={ctx} preview />}
        full={picksN > picksPreviewN ? <PicksBars p={p} focus={name} ctx={ctx} /> : undefined}
        more={seeAll(picksN, "brands")}
      />

      {hasArgs && here && (
        <Sec
          title={`What the AI says about the ${cat.plural}`}
          preview={<RivalArgs name={name} here={here} preview />}
          full={argsN > argsPreviewN ? <RivalArgs name={name} here={here} /> : undefined}
          more={seeAll(argsN, "arguments")}
        />
      )}
      {useFbArgs && d && (
        <Sec
          title={`What the AI says about the ${cat.plural} - across every open buying question`}
          preview={
            <>
              <Hint>What the AI brings up more when it picks {name} than when it picks another brand.</Hint>
              <LiftRows lifts={fbPreview} sides={d.argSides} />
            </>
          }
          full={
            fbArgs.length > fbPreview.length ? (
              <>
                <Hint>What the AI brings up more when it picks {name} than when it picks another brand.</Hint>
                <LiftRows lifts={fbArgs} sides={d.argSides} />
              </>
            ) : undefined
          }
          more={seeAll(fbArgs.length, "arguments")}
        />
      )}

      {(sendsShown.length > 0 || back.length > 0) && (
        <Sec
          title={useFbSends && !hasSends ? `Which buyers it sends to ${name} - across every open buying question` : `Which buyers it sends to ${name}`}
          preview={
            sendsShown.length > 0 ? (
              <CondRows rows={sendsShown.slice(0, 2)} color="var(--pa-theirs)" />
            ) : (
              <None>No condition on the buyer sends them to {name} here.</None>
            )
          }
          full={
            bothWaysAny || sendsShown.length > 2 ? (
              <>
                {hasSends && <Hint>{sendsHint}</Hint>}
                {useFbSends && <CondRows rows={sendsShown} color="var(--pa-theirs)" />}
                {bothWaysAny ? (
                  <div className={useFbSends ? "mt-4" : undefined}>
                    {!hasSends && <Hint>{BUYER_HINT}</Hint>}
                    <BuyerColumns toward={back} away={toIt} towardTitle="To you when the buyer..." awayTitle={`To ${name} when the buyer...`} />
                  </div>
                ) : (
                  !useFbSends && <CondRows rows={sendsShown} color="var(--pa-theirs)" />
                )}
              </>
            ) : undefined
          }
          more={bothWaysAny ? "See every reason, both ways" : seeAll(sendsShown.length, "reasons")}
        />
      )}
      {pooled && d && <DossierFolds d={d} ctx={ctx} />}

      {next.length > 0 && (
        <>
          <div className={evh}>Next</div>
          {next.map((x) => (
            <button key={x.label} type="button" className={rowLink} onClick={x.go}>
              <span>{x.label}</span>
              <span className="text-ink-3">
                {x.right} {"→"}
              </span>
            </button>
          ))}
        </>
      )}
    </>
  );
}

function TwoBar({ you, them }: { you: string; them: string }) {
  return (
    <span className="mt-1.5 flex h-2 overflow-hidden rounded bg-line/60" aria-hidden>
      <i className="block h-full" style={{ width: `${pctNum(you)}%`, background: "var(--pa-yours)" }} />
      <i className="block h-full" style={{ width: `${pctNum(them)}%`, background: "var(--pa-theirs)" }} />
    </span>
  );
}

/** A rival's share beside yours per buying situation: the dossier's rooms, or the open-choice room cells' pick splits. */
export function roomsOf(d: Dossier, ctx: { map: AnalysisMapView }): { cellId: string; label: string; them: string; you: string }[] {
  if (d.rooms && d.rooms.length > 0) return d.rooms;
  const out: { cellId: string; label: string; them: string; you: string }[] = [];
  for (const band of ctx.map.bands)
    for (const row of band.rows)
      for (const c of row.cells) {
        if (!c.id.startsWith("chooses:open:") || c.id === "chooses:open:all") continue;
        const p = ctx.map.positions[c.id];
        const b = p?.brands?.find((x) => normName(x.name) === normName(d.name));
        if (b) out.push({ cellId: c.id, label: c.label, them: b.share, you: p!.youShare ?? "0%" });
      }
  return out;
}

/** The dossier's standing sections, folded: by buyer, against you, who supplies its picks.
 * Shared by the rival-everywhere panel and the pooled open-choice contest (same answers). */
function DossierFolds({ d, ctx }: { d: Dossier; ctx: Ctx }) {
  const [answers, setAnswers] = useState<AnswersTarget | null>(null);
  const closeAnswers = useCallback(() => setAnswers(null), []);
  const rooms = roomsOf(d, ctx);
  const h2hRow = ctx.h2hRow(d);
  const supply = d.supplyAll ?? { vendors: [], assistants: [] };
  // Strongest buying situations first, so the preview's two rows are its best ground.
  const roomsSorted = [...rooms].sort((x, y) => pctNum(y.them) - pctNum(x.them));
  const roomList = (rs: typeof rooms) =>
    rs.map((r) => (
      <button key={r.cellId} type="button" className={rowLink} onClick={() => ctx.open({ kind: "rival", name: d.name, cell: r.cellId })}>
        <span>{r.label}</span>
        <span className="whitespace-nowrap text-ink-2">
          {d.name} <b className="font-semibold text-ink">{r.them}</b> - you <b className="font-semibold text-ink">{r.you}</b> {"→"}
        </span>
      </button>
    ));
  const record =
    d.h2h.kind === "record" ? (
      <div className="border-b border-line py-2 text-[14px]">
        <div className="flex justify-between gap-4">
          <span className="text-ink-2">Asked to pick between you{d.h2h.asClass ? ` and this kind of ${ctx.cat.singular}` : ""}</span>
          <b className="whitespace-nowrap font-semibold text-ink">
            you {d.h2h.you} - {d.name} {d.h2h.them}
          </b>
        </div>
        <TwoBar you={d.h2h.you} them={d.h2h.them} />
      </div>
    ) : null;
  const h2hMore = d.h2h.kind !== "record" || !!d.switching || !!d.cells.h2h || !!d.cells.leaver || !!h2hRow;
  const supplyRead = d.supply ? (
    <p className="mb-2 text-[14px] text-ink">{d.supply}</p>
  ) : (
    <p className={`${T.body} mb-2 text-ink-2`}>Its picks are spread across the assistants roughly in line with how many questions each answers.</p>
  );
  return (
    <>
      {rooms.length > 0 && (
        <Sec
          title="By buying situation"
          preview={roomList(roomsSorted.slice(0, 2))}
          full={
            rooms.length > 2 ? (
              <>
                <Hint>Its share of the picks in each buying situation, beside yours. Open one to see it there.</Hint>
                {roomList(roomsSorted)}
              </>
            ) : undefined
          }
          more={seeAll(rooms.length, "buying situations")}
        />
      )}
      <Sec
        title="Asked head to head"
        preview={record ?? <p className={`${T.body} text-ink-3`}>Never asked head to head.</p>}
        more={d.switching ? "See what its switching customers are told" : h2hRow ? "See when each side wins" : "See more"}
        full={h2hMore ? (
      <>
        <Hint>A different question from the open ones above: the AI is asked to choose between the two of you.</Hint>
        {d.h2h.kind === "record" ? (
          record
        ) : (
          <p
            className={`mb-2 text-[14px] ${d.h2h.alert ? "border-l-[3px] pl-2.5 text-ink" : "text-ink-3"}`}
            style={d.h2h.alert ? { borderColor: "var(--pa-contested)" } : undefined}
          >
            {d.h2h.note}
          </p>
        )}
        {d.switching && (
          <p className="mt-2.5 text-[14px] leading-relaxed text-ink">
            {d.switching}
            {d.switchingNoPick ? ` ${d.switchingNoPick}` : ""}
          </p>
        )}
        {(d.cells.h2h || d.cells.leaver) && (
          <p className="mt-2.5 flex flex-wrap gap-x-3 text-[13px]">
            {d.cells.h2h && (
              <button type="button" className={linkCls} onClick={() => ctx.open({ kind: "cell", id: d.cells.h2h! })}>
                Open the matchup
              </button>
            )}
            {d.cells.leaver && (
              <button type="button" className={linkCls} onClick={() => ctx.open({ kind: "cell", id: d.cells.leaver! })}>
                Open its customers switching
              </button>
            )}
          </p>
        )}
        {h2hRow && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-medium text-primary">When does each side win?</summary>
            <p className="mb-1 mt-2 text-[12px] text-ink-3">What the AI says when asked to pick between the two. Open one to see examples.</p>
            {h2hRow.conditions?.themes ? (
              // Grouped reasons in the panel's own bars (2026-11-12), so this
              // fold reads like "What it says about the buyer" above it.
              <>
                <BuyerColumns
                  toward={themeRows(h2hRow.conditions.themes.you)}
                  away={themeRows(h2hRow.conditions.themes.rival)}
                  towardTitle={`${ctx.brand} wins when the buyer...`}
                  awayTitle={`${d.name} wins when the buyer...`}
                />
                {h2hRow.conditions.themes.elsewhere.length > 0 && (
                  <div className="mt-4">
                    <h5 className="mb-1 text-[13px] font-semibold text-ink">Another brand gets the pick when the buyer...</h5>
                    <CondRows rows={themeRows(h2hRow.conditions.themes.elsewhere)} color="var(--neutral-bar)" />
                  </div>
                )}
              </>
            ) : (
              <Boundaries row={h2hRow} brand={ctx.brand} onOpen={setAnswers} bare />
            )}
          </details>
        )}
      </>
        ) : undefined}
      />
      <Sec
        title="Who supplies its picks"
        preview={supplyRead}
        more="See by assistant"
        full={supply.assistants.length > 0 ? (
      <>
        {supplyRead}
        {supply.assistants.length > 0 && (
          <>
            <Hint>Share of its picks, beside the share of the questions each answers.</Hint>
            {supply.vendors.length > 0 && (
              <>
                <div className="mb-1 mt-2 text-[12px] font-semibold text-ink-2">By company</div>
                {supply.vendors.map((r) => (
                  <Fig key={r.label} label={r.label} value={`${r.picks} of its picks - answers ${r.answers}`} />
                ))}
              </>
            )}
            <div className="mb-1 mt-3 text-[12px] font-semibold text-ink-2">By assistant</div>
            {supply.assistants.map((r) => (
              <Fig key={r.label} label={r.label} value={`${r.picks} of its picks - answers ${r.answers}`} />
            ))}
          </>
        )}
      </>
        ) : undefined}
      />
      {answers && <AnswersModal key={answers.ids.join(",")} runId={ctx.runId} target={answers} onClose={closeAnswers} />}
    </>
  );
}

function RivalAll({ d, from, ctx }: { d: Dossier; from?: string | null; ctx: Ctx }) {
  const fromP = from ? ctx.map.positions[from] : undefined;
  const showScope = !!fromP && from !== "chooses:open:all" && (fromP.brands ?? []).some((x) => normName(x.name) === normName(d.name));
  const args = d.argsAll
    .filter((a) => Math.abs(a.value) >= 5)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const forIt = args.filter((a) => a.value > 0).slice(0, 3);
  const against = args.filter((a) => a.value < 0).slice(0, 3);
  const to = d.routesThemes.length > 0 ? themeRows(d.routesThemes) : shareRows(d.routesAll ?? []);
  const back = d.routesBackThemes.length > 0 ? themeRows(d.routesBackThemes) : shareRows(d.routesBack ?? []);
  // The numbers: the tiles, then where its picks come from; the preview is its
  // share of the picks, named, recommendations that end as the pick.
  const numRows: { label: string; value: string }[] = [
    ...d.tiles,
    ...(d.picksFrom.byType ? [{ label: "Where its picks come from", value: d.picksFrom.byType }] : []),
    ...(d.picksFrom.topQuestion ? [{ label: "Picks from its top question", value: d.picksFrom.topQuestion }] : []),
  ];
  const numPreview = previewNums(numRows, RIVAL_NUM_PREVIEW);
  const argsAll = [...forIt, ...against];
  const argsPreview = [forIt[0], against[0]].filter((x): x is DossierArg => !!x);
  const argHint = (
    <Hint>
      What the AI brings up more in {d.argSides[0]} than in {d.argSides[1]}, and less. Open one to see examples.
    </Hint>
  );
  const toRows = to.map((r) => ({ ...r, routes: [] }));
  const anyReasons = to.length > 0 || back.length > 0 || !!d.routesDefault || !!d.routesBackDefault;
  return (
    <>
      <div className={crumbCls}>Rival - {d.name} - everywhere it appears</div>
      <h2 className={h2Cls}>{d.headline}</h2>
      {showScope && <ScopeChips name={d.name} cellId={from!} scoped={false} ctx={ctx} />}
      <ExampleLink receipts={d.receipts ?? []} title={`Answers that pick ${d.name}`} subtitle="When buyers ask what to buy" />
      <MatchupGap d={d} />

      <div className={evh}>The evidence</div>
      <Sec
        title="The numbers, when buyers ask what to buy"
        preview={numPreview.map((t) => <Fig key={t.label} label={t.label} value={t.value} />)}
        full={numRows.length > numPreview.length ? numRows.map((t) => <Fig key={t.label} label={t.label} value={t.value} />) : undefined}
        more={seeAll(numRows.length, "numbers")}
      />
      {argsAll.length > 0 && (
        <Sec
          title={`What the AI says about the ${ctx.cat.plural}`}
          preview={<LiftRows lifts={argsPreview} sides={d.argSides} />}
          full={
            argsAll.length > argsPreview.length ? (
              <>
                {argHint}
                <LiftRows lifts={argsAll} sides={d.argSides} />
              </>
            ) : undefined
          }
          more={seeAll(argsAll.length, "arguments")}
        />
      )}
      {anyReasons && (
        <Sec
          title={`Which buyers it sends to ${d.name}`}
          preview={
            toRows.length > 0 ? <CondRows rows={toRows.slice(0, 2)} color="var(--pa-theirs)" /> : <None>No condition on the buyer sends them to {d.name}.</None>
          }
          full={
            <>
              <Hint>{BUYER_HINT}</Hint>
              <BuyerColumns toward={back} away={to} towardTitle="To you when the buyer..." awayTitle={`To ${d.name} when the buyer...`} />
              {(d.routesBackDefault || d.routesDefault) && (
                <div className="mt-2 grid gap-1 text-[12px] italic leading-snug text-ink-2">
                  {d.routesBackDefault && <p>{d.routesBackDefault}</p>}
                  {d.routesDefault && <p>{d.routesDefault}</p>}
                </div>
              )}
            </>
          }
          more="See every reason, both ways"
        />
      )}
      <DossierFolds d={d} ctx={ctx} />
      {ctx.onBuildTable && (
        <p className="mt-5 text-[13px]">
          <button type="button" className={linkCls} onClick={() => { ctx.onClose(); ctx.onBuildTable!(); }}>
            Build your own table {"→"}
          </button>
        </p>
      )}
    </>
  );
}

// ---------- the host ----------

export function SlideOver({ view, ctx }: { view: PanelView; ctx: Ctx }) {
  let body: ReactNode;
  let label: string;
  let where: string | undefined;
  if (view.kind === "cell") {
    const p = ctx.map.positions[view.id];
    if (!p) return null;
    label = p.where;
    where = p.where;
    body = <ContestPanel key={p.cellId} p={p} ctx={ctx} />;
  } else {
    const scopedP = view.cell ? ctx.map.positions[view.cell] : undefined;
    const inScope = !!scopedP && (scopedP.brands ?? []).some((x) => normName(x.name) === normName(view.name));
    const d = ctx.findDossier(view.name);
    label = `${view.name}${inScope ? ` - ${scopedP!.where}` : " - everywhere it appears"}`;
    where = label;
    if (inScope) body = <RivalScoped key={`${view.name}|${view.cell}`} name={view.name} p={scopedP!} ctx={ctx} />;
    else if (d) body = <RivalAll key={`${d.key}|${view.from ?? ""}`} d={d} from={view.from} ctx={ctx} />;
    else
      body =
        ctx.dossiers === null ? (
          <p className="clear-both pt-6 text-[13px] text-ink-3">Loading {view.name}...</p>
        ) : (
          <>
            <div className={crumbCls}>Rival</div>
            <h2 className={h2Cls}>{view.name}</h2>
            <None>The AI does not name this brand often enough to read on its own.</None>
          </>
        );
  }
  return <Host label={label} where={where} onClose={ctx.onClose}>{body}</Host>;
}

function Host({ label, where, onClose, children }: { label: string; where?: string; onClose: () => void; children: ReactNode }) {
  return (
    <ExamplesHost>
      <WhereCtx.Provider value={where}>
        <PanelShell label={label} onClose={onClose}>
          {children}
        </PanelShell>
      </WhereCtx.Provider>
    </ExamplesHost>
  );
}

export type PanelCtx = Ctx;
