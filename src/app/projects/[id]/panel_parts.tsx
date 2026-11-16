"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type {
  AnswerRef,
  PanelBlock,
  PanelCondition,
  PanelConditions,
  PanelLine,
  PanelNum,
  PanelSegment,
  PanelSpan,
  PanelStep,
  PanelStepKey,
  PanelTable,
  PanelText,
  PanelTone,
  PanelWeighs,
  PanelDetailSection,
} from "@/lib/engine/analysis_types";
import { useShowExamples, useWhere } from "./analysis_panel";
import { T } from "./type_scale";

/**
 * The building blocks of the per-question-type panels (am31, the panel build).
 * Every sentence and label comes from the engine payload; the only words here
 * are the UI chrome (the switch, "Open", "of answers say this", "fixed", the
 * click hint, "See all" / "Show less"). Every number with answers behind it
 * opens them in the one examples modal; a number with none is plain text.
 * Counts never print - they live in the hover tips.
 */

// ---------- colours ----------

export const C_YOU = "var(--pa-yours)";
/** "You" in your usual place (all buyers): the mockups' lighter blue. */
export const C_YOU_SOFT = "var(--pa-yours-soft)";
export const C_AWAY = "var(--pa-theirs)";
export const C_USUAL = "var(--pa-usual)";
export const C_NONE = "var(--pa-none)";
const toneColor = (t: PanelSegment["tone"]) => (t === "you" ? C_YOU : t === "away" ? C_AWAY : C_USUAL);

/** The steps at the top of a panel never open answers; everything below them does. */
export const CLICK_HINT = "Below the steps, click any row or number to read the answers behind it.";
/** The hint on panels whose step cards select their explanation: the step bars open no answers there. */
export const STEP_HINT = "Click a step to see what explains it. Below it, click any row or number to read the answers behind it.";

// ---------- the "Show competitors" switch: one state per slide-over host, kept for the session ----------

const COMP_KEY = "procerno:panelComp";
const CompCtx = createContext<{ on: boolean; set: (v: boolean) => void } | null>(null);

function readComp(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(COMP_KEY) === "1";
  } catch {
    return false;
  }
}

export function CompProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(readComp);
  const set = useCallback((v: boolean) => {
    setOn(v);
    try {
      window.sessionStorage.setItem(COMP_KEY, v ? "1" : "0");
    } catch {
      // private window: the switch still works for this panel
    }
  }, []);
  return <CompCtx.Provider value={{ on, set }}>{children}</CompCtx.Provider>;
}

export function useComp(): [boolean, (v: boolean) => void] {
  const c = useContext(CompCtx);
  const [local, setLocal] = useState(false);
  return c ? [c.on, c.set] : [local, setLocal];
}

/** The competitors switch. `own` gives a panel its own state (the all-buyers panels, on by default) in place of the remembered one. */
export function CompSwitch({ own }: { own?: [boolean, (v: boolean) => void] }) {
  const shared = useComp();
  const [on, set] = own ?? shared;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => set(!on)}
      className={`inline-flex min-h-[2.25rem] items-center gap-2 whitespace-nowrap ${T.ctl} text-ink-2 hover:text-ink`}
    >
      Show competitors
      <span className={`relative inline-block h-5 w-[34px] rounded-full transition-colors ${on ? "bg-ink" : "bg-ink-3/70"}`} aria-hidden>
        <span className={`absolute top-[2px] h-4 w-4 rounded-full bg-surface transition-[left] ${on ? "left-4" : "left-[2px]"}`} />
      </span>
    </button>
  );
}

// ---------- examples ----------

/** Opens a set of example answers, or returns null when there is nothing to open. */
export function useOpener() {
  const show = useShowExamples();
  const where = useWhere();
  return (refs: AnswerRef[] | undefined, title: string, note?: string) =>
    show && refs && refs.length > 0 ? () => show({ title, subtitle: where, note, refs }) : null;
}

const linkish = "cursor-pointer underline decoration-dotted underline-offset-[3px] hover:decoration-solid hover:text-ink";

/** A sentence from the engine: spans with answers behind them are buttons. */
export function TextView({ text, className, title, plain }: { text: PanelText | undefined; className?: string; title?: string; plain?: boolean }) {
  const opener = useOpener();
  if (!text || text.length === 0) return null;
  return (
    <span className={className}>
      {text.map((s, i) => {
        const go = plain ? null : opener(s.refs, title ?? s.t);
        return go ? (
          <button key={i} type="button" onClick={go} title={s.tip} className={`inline p-0 text-left ${linkish}`}>
            {s.t}
          </button>
        ) : (
          <span key={i} title={s.tip}>
            {s.t}
          </span>
        );
      })}
    </span>
  );
}

/** A number: a button when it has answers, plain text otherwise; the count lives in the tip. */
export function NumView({ n, title, className, note }: { n: PanelNum; title: string; className?: string; note?: string }) {
  const opener = useOpener();
  const go = opener(n.refs, title, note);
  return go ? (
    <button type="button" onClick={go} title={n.tip} className={`tabular-nums ${linkish} ${className ?? ""}`}>
      {n.value}
    </button>
  ) : (
    <span title={n.tip} className={`tabular-nums ${className ?? ""}`}>
      {n.value}
    </span>
  );
}

const isSpan = (c: PanelNum | PanelSpan): c is PanelSpan => "t" in c;

// ---------- bars ----------

/** Half-width columns (the two-sided weighs block): a narrower label so the bar keeps its length. */
const barGridTight = "grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[minmax(0,6.25rem)_minmax(0,1fr)_2.5rem]";
const barGrid = "grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2.75rem]";
/** The same row with a small figure after the number (a usual, on verdict rows). */
const barGridAside = "grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.75rem_4.25rem] items-center gap-2 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2.75rem_4.75rem]";

/** One labelled bar; the whole row opens its answers (`plain`: inside a step card that is itself a button - the tip stays, nothing opens). */
export function NumBar({ label, n, color, bold, dim, title, plain, aside, tight }: { label: string; n: PanelNum; color: string; bold?: boolean; dim?: boolean; title?: string; plain?: boolean; aside?: ReactNode; tight?: boolean }) {
  const opener = useOpener();
  const go = plain ? null : opener(n.refs, title ?? label);
  const inner = (
    <>
      <span className={`min-w-0 ${bold ? "font-semibold text-ink" : "text-ink-2"}`}>{label}</span>
      <span className="h-2 overflow-hidden rounded bg-line/60">
        <i className={`block h-full rounded ${dim ? "opacity-40" : ""}`} style={{ width: `${Math.max(n.pct > 0 ? 1 : 0, Math.min(100, n.pct))}%`, background: color }} />
      </span>
      <b className="text-right font-semibold tabular-nums text-ink">{n.value}</b>
      {aside && <span className="text-right">{aside}</span>}
    </>
  );
  const cls = `${aside ? barGridAside : tight ? barGridTight : barGrid} ${T.cap} w-full rounded py-[3px] text-left`;
  return go ? (
    <button type="button" onClick={go} title={n.tip} className={`${cls} hover:bg-line/30 [&:hover_b]:underline`}>
      {inner}
    </button>
  ) : (
    <span className={cls} title={n.tip}>
      {inner}
    </span>
  );
}

/** A verdict step (go ahead / steer clear / no side ...): one plain bar per
 * outcome, never one bar split into parts. The outcomes that take a side come
 * first (in the engine's order) and the first is drawn strongest; "no side"
 * rows are grey and last. A usual, when compared, is a small figure on the
 * same row. In the step stack these never open answers (the block below does). */
export function SegRows({ segs, usual, usualLabel, dim }: { segs: PanelSegment[]; usual?: PanelSegment[]; usualLabel?: string; dim?: boolean }) {
  const ordered = [...segs.filter((x) => x.tone !== "neutral"), ...segs.filter((x) => x.tone === "neutral")];
  return (
    <span className="mt-0.5 block">
      {ordered.map((x, i) => {
        const u = usual?.find((y) => y.key === x.key);
        return (
          <NumBar
            key={x.key}
            label={cap(x.label)}
            n={x.num}
            color={x.tone === "neutral" ? C_USUAL : toneColor(x.tone)}
            bold={i === 0 && x.tone !== "neutral" ? true : undefined}
            dim={dim}
            plain
            aside={
              u ? (
                <span className="text-ink-3 tabular-nums" title={`${usualLabel ?? "Usual"}: ${u.num.tip}`}>
                  usual {u.num.value}
                </span>
              ) : undefined
            }
          />
        );
      })}
    </span>
  );
}

const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

// ---------- tags ----------

/** A tag pill, coloured by the sentiment the engine gives it (neutral when absent). */
export function Tag({ text, tone = "neutral" }: { text?: string; tone?: PanelTone }) {
  if (!text) return null;
  const style =
    tone === "bad"
      ? { background: "var(--pa-bad-bg)", color: "var(--pa-bad-ink)" }
      : tone === "good"
        ? { background: "var(--pa-good-bg)", color: "var(--pa-good-ink)" }
        : { background: "var(--pa-neutral-bg)", color: "var(--pa-neutral-ink)" };
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold`} style={style}>
      {text}
    </span>
  );
}

// ---------- the step stack ----------

/** One step card: its label and tag, then its bars (or split bars, checklist, sentence). */
export function StepCard({
  step,
  usual,
  comp,
  focus,
  dim: dimProp,
  hereLabel,
  usualLabel,
  rivalLabel,
  onSelect,
  rivalFirst,
  plain: plainProp,
}: {
  step: PanelStep;
  usual?: PanelStep;
  comp: boolean;
  focus: boolean;
  /** Fade the bars. Default: every card but the highlighted one. A stack with no highlighted step fades none. */
  dim?: boolean;
  hereLabel: string;
  usualLabel: string;
  /** Panel 11: the rival's own name beside "You". */
  rivalLabel?: string;
  /** A step card that selects its explanation: the whole card is one button. */
  onSelect?: () => void;
  rivalFirst?: boolean;
  /** The bars open no answers (a stack whose cards select their explanation). Default: when the card selects. */
  plain?: boolean;
}) {
  // The step stack never opens answers (the blocks below it do): a selectable card selects, a plain one is text.
  const plain = plainProp ?? true;
  const ranked = comp || !!rivalLabel;
  const tag = ranked ? step.tagRank : step.tagUsual;
  const tone = ranked ? step.tagRankTone : step.tagUsualTone;
  // A step that is not about you alone names its own bars (the engine's words).
  const hereL = step.hereLabel ?? hereLabel;
  const usualL = step.usualLabel ?? usualLabel;
  const dim = dimProp ?? !focus;
  const body: ReactNode[] = [];
  if (step.here) {
    // A step not about you alone (any brand) keeps its own bar label beside the competitors.
    // am37: a step not about you alone keeps its own label in the comparison view too (never "You").
    const youL = comp && !step.rivals?.length && (step.compHereLabel || step.hereLabel) ? (step.compHereLabel ?? step.hereLabel!) : comp || rivalLabel ? "You" : hereL;
    const you = <NumBar key="you" label={youL} n={step.here} color={C_YOU} bold={comp || !!rivalLabel} dim={dim} title={`${step.label} - ${youL}`} plain={plain} />;
    const rivals = (comp || rivalLabel ? step.rivals ?? [] : []).map((r) => (
      <NumBar key={`r:${r.name}`} label={r.name} n={r.num} color={C_AWAY} dim={dim} title={`${step.label} - ${r.name}`} plain={plain} />
    ));
    // Head-to-heads: the rival beside you in the default view (no sum to work out).
    const vs = !comp && !rivalLabel && step.vs ? <NumBar key="vs" label={step.vs.name} n={step.vs.num} color={C_AWAY} dim={dim} title={`${step.label} - ${step.vs.name}`} plain={plain} /> : null;
    if (rivalFirst) body.push(...rivals, you);
    else body.push(you, ...rivals);
    if (vs) body.push(vs);
    // The step's own comparison (the average competitor) before a usual from the row's All cell.
    const u = step.usual ?? usual?.here;
    if (!comp && !rivalLabel && !vs && u) body.push(<NumBar key="usual" label={usualL} n={u} color={C_USUAL} dim={dim} title={`${step.label} - ${usualL}`} plain={plain} />);
  } else if ((comp || rivalLabel) && step.rivals?.length) {
    // A step only the rival has a number for (a rival's card: how often it is named as the alternative to you).
    for (const r of step.rivals) body.push(<NumBar key={`r:${r.name}`} label={r.name} n={r.num} color={C_AWAY} dim={dim} title={`${step.label} - ${r.name}`} plain={plain} />);
  }
  if (step.segments && step.segments.length > 0) {
    const showUsual = !comp && !rivalLabel && !!usual?.segments?.length;
    body.push(<SegRows key="seg" segs={step.segments} usual={showUsual ? usual!.segments : undefined} usualLabel={usualLabel} dim={dim} />);
  }
  if (step.items && step.items.length > 0)
    body.push(
      <span key="items" className="block">
        {step.items.map((it) => (
          <NumBar key={it.label} label={it.label} n={it.num} color={C_USUAL} dim={dim} plain={plain} />
        ))}
      </span>
    );
  if (step.note && step.note.length > 0)
    body.push(
      <span key="note" className={`block ${T.body} text-ink-2`}>
        <TextView text={step.note} plain={plain} />
      </span>
    );
  const cls = `block w-full rounded-[10px] border bg-surface px-3 pb-3 pt-2.5 text-left ${focus ? "border-ink ring-1 ring-ink" : "border-line"}`;
  const head = (
    <span className="mb-1 flex items-center justify-between gap-2">
      <em className={`not-italic ${T.sec} ${focus ? "font-semibold text-ink" : "text-ink-2"}`}>{step.label}</em>
      <Tag text={tag} tone={tone} />
    </span>
  );
  // A selectable card is one button: its header, bars and numbers all select it.
  if (onSelect)
    return (
      <button type="button" onClick={onSelect} aria-pressed={focus} className={`${cls} cursor-pointer hover:border-ink-3`}>
        {head}
        {body}
      </button>
    );
  return (
    <div className={cls}>
      {head}
      {body}
    </div>
  );
}

export function KeyLine({ items }: { items: { label: string; color: string }[] }) {
  if (items.length === 0) return null;
  return (
    <p className={`mb-2.5 flex flex-wrap gap-x-4 gap-y-1 ${T.cap} text-ink-2`}>
      {items.map((k) => (
        <span key={k.label}>
          <i className="mr-1.5 inline-block h-[9px] w-[9px] rounded-full align-[0px]" style={{ background: k.color }} />
          {k.label}
        </span>
      ))}
    </p>
  );
}

export function StepStack({
  label,
  steps,
  usualSteps,
  comp,
  focus,
  hereLabel,
  usualLabel,
  keyItems,
  onSelect,
  canSelect,
}: {
  label: string;
  steps: PanelStep[];
  usualSteps?: PanelStep[];
  comp: boolean;
  focus?: PanelStepKey;
  hereLabel: string;
  usualLabel: string;
  keyItems: { label: string; color: string }[];
  /** Steps that explain themselves: clicking one selects it (one at a time). */
  onSelect?: (k: PanelStepKey) => void;
  canSelect?: (k: PanelStepKey) => boolean;
}) {
  return (
    <div className="clear-both mt-4">
      <p className={`${T.label} mb-1.5`}>{label}</p>
      <KeyLine items={keyItems} />
      <div className="grid gap-1.5">
        {steps.map((s) => (
          <StepCard
            key={s.key}
            step={s}
            usual={usualSteps?.find((u) => u.key === s.key)}
            comp={comp}
            focus={s.key === focus}
            dim={!!focus && s.key !== focus}
            hereLabel={hereLabel}
            usualLabel={usualLabel}
            onSelect={onSelect && (!canSelect || canSelect(s.key)) ? () => onSelect(s.key) : undefined}
            plain={!!onSelect}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- blocks ----------

export function Blk({ title, sub, children, flush }: { title?: string; sub?: string; children: ReactNode; flush?: boolean }) {
  return (
    <div className={`border-t border-line/70 ${flush ? "pt-1" : "pt-4"} mt-4`}>
      {title && <h4 className={T.title}>{title}</h4>}
      {sub && <p className={`${T.sec} mb-2.5 mt-0.5`}>{sub}</p>}
      {children}
    </div>
  );
}

export function DetailView({ heading, body, children }: { heading: string; body?: PanelText; children?: ReactNode }) {
  return (
    <div className="mt-4 border-t border-line pt-3.5">
      <h3 className={`${T.title} mb-1.5`}>{heading}</h3>
      {body && body.length > 0 && (
        <p className={`${T.body} text-ink-2`}>
          <TextView text={body} title={heading} />
        </p>
      )}
      {children}
    </div>
  );
}

// ---------- conditions ----------

const PREVIEW_ROWS = 4;

/** "A", "A or B", "A, B or C". */
const orList = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

function CondCard({ c, side, cond, comp }: { c: PanelCondition; side: "toward" | "away"; cond: PanelConditions; comp: boolean }) {
  const opener = useOpener();
  const go = opener(c.share.refs, c.text);
  const color = side === "toward" ? C_YOU : cond.neutralAway ? C_USUAL : C_AWAY;
  const also = side === "toward" ? cond.alsoToward : cond.alsoAway;
  const top = (
    <>
      <span className="mb-1 block text-[13px] font-semibold leading-snug text-ink">
        {c.text}
        {c.wall && (
          <span
            title="A fact about the buyer, not a preference - it cannot be argued away"
            className="ml-1.5 rounded-full border border-line px-1.5 align-[1px] text-[11px] font-normal text-ink-2"
          >
            fixed
          </span>
        )}
      </span>
      <span className="block text-xl font-semibold leading-tight tabular-nums text-ink" title={c.share.tip}>
        {c.share.value}
      </span>
      <span className={`block ${T.cap} text-ink-3`}>of answers say this</span>
    </>
  );
  const pickedLine = c.youPicked ? (
    <span className={`${T.cap} text-ink-2`}>
      {c.youPicked.pct === 0 ? (
        <>
          You are <b className="font-semibold text-ink">never</b> the pick.
        </>
      ) : (
        <>
          You are the pick in about <NumView n={c.youPicked} title={`${c.text} - you are the pick`} className="font-semibold text-ink" /> of these.
        </>
      )}
    </span>
  ) : null;
  const destLine =
    side === "toward" && !comp && c.products && c.products.length > 0 ? (
      <span className={`${T.cap} text-ink-2`}>Names {orList(c.products)}.</span>
    ) : (c.to?.length ?? 0) > 0 ? (
      <span className={`${T.cap} text-ink-2`}>
        {cond.toWord}{" "}
        {comp
          ? c.to!.map((x, i) => (
              <span key={x.name}>
                {i > 0 && " · "}
                {x.name} <NumView n={x.num} title={`${c.text} - ${x.name}`} />
              </span>
            ))
          : orList(c.to!.slice(0, 2).map((x) => x.name))}
        .
      </span>
    ) : null;
  return (
    <div className="mb-1.5 rounded-[10px] border border-line px-3 py-2.5" style={{ borderLeft: `3px solid ${color}` }}>
      {go ? (
        <button type="button" onClick={go} title={c.share.tip} className="block w-full text-left hover:[&_.tabular-nums]:underline">
          {top}
        </button>
      ) : (
        <div>{top}</div>
      )}
      {c.both && (
        <span className={`mt-1.5 grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-1.5 ${T.cap} text-ink-3`} title={c.both.either.tip}>
          <span>
            {also}
            <span className="mt-0.5 block h-1.5 overflow-hidden rounded-[3px] bg-line/60">
              <i className="block h-full rounded-[3px]" style={{ width: `${Math.min(100, c.both.either.pct)}%`, background: C_USUAL }} />
            </span>
          </span>
          <NumView n={c.both.either} title={`${c.text} - ${also}`} className="text-right" />
        </span>
      )}
      {(destLine || pickedLine) && (
        <span className="mt-1.5 flex flex-wrap gap-x-1">
          {destLine}
          {pickedLine}
        </span>
      )}
    </div>
  );
}

function CondColumn({ title, rows, side, cond, comp, color, all }: { title: string; rows: PanelCondition[]; side: "toward" | "away"; cond: PanelConditions; comp: boolean; color: string; all: boolean }) {
  const shown = all ? rows : rows.slice(0, PREVIEW_ROWS);
  return (
    <div className="min-w-0">
      <h5 className="mb-1.5 text-[12px] font-semibold" style={{ color }}>
        {title}
      </h5>
      {shown.map((c, i) => (
        <CondCard key={`${i}:${c.text}`} c={c} side={side} cond={cond} comp={comp} />
      ))}
    </div>
  );
}

/** "When the AI says to choose you, and when another ..." - two columns of condition cards. */
export function CondColumns({ cond, comp, awayFirst }: { cond: PanelConditions; comp: boolean; awayFirst?: boolean }) {
  const [all, setAll] = useState(false);
  const more = cond.toward.length > PREVIEW_ROWS || cond.away.length > PREVIEW_ROWS;
  const cols = [
    <CondColumn key="t" title={cond.towardTitle} rows={cond.toward} side="toward" cond={cond} comp={comp} color={C_YOU} all={all} />,
    <CondColumn key="a" title={cond.awayTitle} rows={cond.away} side="away" cond={cond} comp={comp} color={cond.neutralAway ? "var(--ink-2)" : C_AWAY} all={all} />,
  ];
  const empty = cond.toward.length === 0 && cond.away.length === 0;
  // am37: one side empty beside a full one keeps its column with a one-line note (the engine's words), never a blank;
  // with no note (an older payload) only the side with rows is drawn.
  const sideNote = (side: "toward" | "away") => (side === "toward" ? cond.towardNote : cond.awayNote);
  const withNote = (i: 0 | 1, side: "toward" | "away") => (
    <div key={side}>
      {cols[i]}
      {cond[side].length === 0 && sideNote(side) && <p className={`${T.body} text-ink-3`}>{sideNote(side)}</p>}
    </div>
  );
  const keepT = cond.toward.length > 0 || !!cond.towardNote;
  const keepA = cond.away.length > 0 || !!cond.awayNote;
  const pair = awayFirst ? [withNote(1, "away"), withNote(0, "toward")] : [withNote(0, "toward"), withNote(1, "away")];
  const shownCols = !keepT ? [withNote(1, "away")] : !keepA ? [withNote(0, "toward")] : pair;
  return (
    <Blk title={cond.title} sub={comp && cond.subComp ? cond.subComp : cond.sub}>
      {empty ? (
        cond.note && <p className={`${T.body} text-ink-3`}>{cond.note}</p>
      ) : (
        <>
          <div className={`grid items-start gap-3 ${shownCols.length > 1 ? "sm:grid-cols-2" : ""}`}>{shownCols}</div>
          {cond.note && <p className={`${T.sec} mt-1`}>{cond.note}</p>}
          {more && (
            <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className={`mt-1 ${T.ctl} text-primary underline underline-offset-2 hover:opacity-80`}>
              {all ? "Show less" : "See all"}
            </button>
          )}
        </>
      )}
    </Blk>
  );
}

// ---------- brands, lines, tables ----------

export function BrandRows({ block, onOpen }: { block: PanelBlock; onOpen?: (name: string) => void }) {
  return (
    <Blk title={block.title} sub={block.sub}>
      {block.rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2">
          <BrandBar name={r.shown ?? (r.you ? "You" : r.name)} n={r.num} color={r.you ? C_YOU : C_AWAY} bold={!!r.you} />
          {r.open && onOpen ? (
            <button type="button" onClick={() => onOpen(r.name)} className={`text-right ${T.ctl} text-primary hover:opacity-80`}>
              Open
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </Blk>
  );
}

function BrandBar({ name, n, color, bold }: { name: string; n: PanelNum; color: string; bold?: boolean }) {
  const opener = useOpener();
  const go = opener(n.refs, name);
  const inner = (
    <>
      <span className={`min-w-0 truncate ${bold ? "font-semibold" : ""}`}>{name}</span>
      <span className="h-2 overflow-hidden rounded bg-line/60">
        <i className="block h-full rounded" style={{ width: `${Math.max(n.pct > 0 ? 1 : 0, Math.min(100, n.pct))}%`, background: color }} />
      </span>
      <b className="text-right font-semibold tabular-nums">{n.value}</b>
    </>
  );
  const cls = `grid w-full grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2.5 py-1.5 text-left ${T.body} text-ink`;
  return go ? (
    <button type="button" onClick={go} title={n.tip} className={`${cls} [&:hover_b]:underline`}>
      {inner}
    </button>
  ) : (
    <div className={cls} title={n.tip}>
      {inner}
    </div>
  );
}

const toneBar = (t: PanelTone) => (t === "good" ? C_YOU : t === "bad" ? C_AWAY : C_USUAL);

/** am38: "What the answer weighs", sized - one column per side (blue for the
 * side good for you, pink for the other, grey unsided), one bar per topic. */
export function WeighsView({ w }: { w: PanelWeighs }) {
  return (
    <Blk title={w.title} sub={w.sub}>
      <div className={`grid items-start gap-x-6 gap-y-3 ${w.columns.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {w.columns.map((c, i) => (
          <div key={`${i}:${c.title ?? ""}`} className="min-w-0">
            {c.title && (
              <h5 className="mb-1.5 text-[12px] font-semibold" style={{ color: c.tone === "neutral" ? "var(--ink-2)" : toneBar(c.tone) }}>
                {c.title}
              </h5>
            )}
            {c.rows.map((r) => (
              <NumBar key={r.name} label={r.name} n={r.num} color={toneBar(c.tone)} title={`${c.title ?? w.title} - ${r.name}`} tight={w.columns.length > 1} />
            ))}
            {c.note && <p className={`${T.body} text-ink-3`}>{c.note}</p>}
          </div>
        ))}
      </div>
    </Blk>
  );
}

/** am38: a list inside a step explanation - one bar per row, "Open" on rows with a rival panel, then a note. */
export function DetailSection({ s, onOpen }: { s: PanelDetailSection; onOpen?: (name: string) => void }) {
  return (
    <div className="mt-3.5">
      <p className={`${T.cap} font-semibold text-ink`}>{s.title}</p>
      {s.sub && <p className={`${T.cap} mb-1 text-ink-3`}>{s.sub}</p>}
      {s.rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2">
          <NumBar label={r.label} n={r.num} color={toneBar(s.tone)} title={`${s.title} - ${r.label}`} />
          {r.open && onOpen ? (
            <button type="button" onClick={() => onOpen(r.label)} className={`text-right ${T.ctl} text-primary hover:opacity-80`}>
              Open
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {s.note && s.note.length > 0 && (
        <p className={`${T.body} mt-1 text-ink-2`}>
          <TextView text={s.note} title={s.title} />
        </p>
      )}
    </div>
  );
}

export function LineRows({ lines }: { lines?: PanelLine[] }) {
  if (!lines || lines.length === 0) return null;
  return (
    <div className="mt-3">
      {lines.map((l, i) => (
        <div key={`${i}:${l.label}`} className={`flex justify-between gap-3 py-2 ${T.body} ${i > 0 ? "border-t border-line/70" : ""}`}>
          <span className="text-ink">{l.label}</span>
          <TextView text={l.value} title={l.label} className="text-right text-ink-2" />
        </div>
      ))}
    </div>
  );
}

function Cell({ c, title }: { c: PanelNum | PanelSpan | null; title: string }) {
  if (!c) return <span className="text-ink-3">-</span>;
  if (isSpan(c)) return <TextView text={[c]} title={title} />;
  return <NumView n={c} title={title} />;
}

export function TableView({ table }: { table: PanelTable }) {
  if (table.style === "bars")
    return (
      <Blk title={table.title} sub={table.sub}>
        {table.rows.map((r) => {
          const first = r.cells[0];
          const rest = r.cells.slice(1).filter((c): c is PanelNum | PanelSpan => !!c);
          return (
            <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,40%)_2.75rem] items-center gap-2.5 py-1.5">
              <span className={`${T.body} text-ink`}>
                {r.label}
                {rest.map((c, i) => (
                  <span key={i} className={`block ${T.cap} text-ink-3`}>
                    <Cell c={c} title={r.label} />
                  </span>
                ))}
              </span>
              <span className="h-2 overflow-hidden rounded bg-line/60">
                {first && !isSpan(first) && <i className="block h-full rounded" style={{ width: `${Math.min(100, first.pct)}%`, background: C_YOU }} />}
              </span>
              <b className={`text-right ${T.body} font-semibold text-ink`}>{first ? <Cell c={first} title={r.label} /> : null}</b>
            </div>
          );
        })}
      </Blk>
    );
  return (
    <Blk title={table.title} sub={table.sub}>
      <div className="overflow-x-auto">
        <table className={`w-full ${T.body}`}>
          <thead>
            <tr className={`${T.cap} text-ink-3`}>
              <th className="py-1 pr-2 text-left font-normal" />
              {table.columns.map((c) => (
                <th key={c} className="py-1 pl-2 text-right font-normal">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.label} className="border-t border-line/70">
                <td className="py-1.5 pr-2 text-ink">{r.label}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className="py-1.5 pl-2 text-right text-ink">
                    <Cell c={c} title={`${r.label} - ${table.columns[i] ?? ""}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Blk>
  );
}
