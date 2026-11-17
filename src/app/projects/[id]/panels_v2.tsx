"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CellPanelPayload, PanelKind, PanelRival, PanelStep, PanelStepKey, Position, PositionPanel, RivalAcross, RivalAcrossStep, RivalStepDetail, PanelStepDetail, PanelTone } from "@/lib/engine/analysis_types";
import { MoveBox, None, VCOLOR, VWORD, crumbCls, h2Cls, linkCls, notesOf, softLine, whyLines, type Ctx } from "./analysis_panel";
import { MatchupDropNote } from "./matchup_action";
import {
  Blk,
  BrandRows,
  C_AWAY,
  C_NONE,
  C_USUAL,
  C_YOU,
  CLICK_HINT,
  CompSwitch,
  STEP_HINT,
  CondColumns,
  DetailView,
  KeyLine,
  LineRows,
  NumView,
  StepCard,
  StepStack,
  TableView,
  Tag,
  NumBar,
  TextView,
  DetailSection,
  WeighsView,
  useComp,
} from "./panel_parts";
import { T } from "./type_scale";

/**
 * The per-question-type panels (am31): one layout per kind, blocks in the
 * mockups' order, then the move. A position without `panel` never reaches
 * here - the slide-over draws today's panel for it. All sentences are the
 * engine's; this file only decides order and which view (normal or with the
 * competitors shown) a block belongs to.
 */

type Block = "stack" | "byproduct" | "detail" | "conditions" | "ends" | "competitors" | "lines" | "weighs" | "table" | "tables";

// am38: "weighs" (what the answer weighs, sized) sits where its line sat - after the lines.
const ORDER: Record<PanelKind, Block[]> = {
  buy: ["stack", "detail", "conditions", "competitors", "lines", "weighs"],
  switching: ["stack", "detail", "conditions", "competitors", "lines", "weighs"],
  h2h: ["stack", "detail", "conditions", "lines", "weighs"],
  buyer_worry: ["stack", "detail", "competitors", "lines", "weighs"],
  customer_worry: ["stack", "detail", "competitors", "lines", "weighs"],
  // am38: Value's rivals moved into the "where it points" explanation; the by-product table sits right under the steps.
  value: ["stack", "byproduct", "detail", "competitors", "lines", "weighs"],
  looking_around: ["stack", "detail", "competitors", "conditions", "lines", "weighs"],
  problem: ["stack", "detail", "competitors", "lines", "table"],
  criteria: ["stack", "detail", "table", "lines"],
  expansion: ["stack", "detail", "conditions", "lines"],
  business_case: ["stack", "lines", "detail", "table"],
  popular: ["stack", "detail", "conditions", "competitors", "tables"],
  learning: ["stack", "detail", "table"],
  alongside: ["stack", "detail", "conditions"],
  critic: ["stack", "lines", "detail", "table"],
  // am59: Premium vs basic - which end, the funnel, the conditions by end, who it names at each end, what each side weighs.
  premium: ["stack", "detail", "conditions", "ends", "competitors", "weighs"],
  // am60: Habit - the brands suggested instead live in the "suggests another brand" explanation (the looking-around pattern).
  habit: ["stack", "detail", "conditions", "lines", "weighs"],
  // am61: the settled customers' All questions card - the step and its explanation (an index to the four questions).
  settled_all: ["stack", "detail"],
};

/** Head-to-head panels read the rival's side first, as the matchup is asked. */
const hasRival = (pp: PositionPanel, name: string) => (pp.rivals ?? []).some((r) => r.name.toLowerCase() === name.toLowerCase());

// ---------- the lazy load: the served map carries a stub per cell, the body comes from /cell_panel ----------

const panelLoads = new Map<string, Promise<CellPanelPayload>>();
const panelDone = new Map<string, CellPanelPayload>();
const panelKey = (runId: string, mapQuery: string, cellId: string) => `${runId}|${mapQuery}|${cellId}`;

function loadCellPanel(runId: string, mapQuery: string, cellId: string): Promise<CellPanelPayload> {
  const key = panelKey(runId, mapQuery, cellId);
  let p = panelLoads.get(key);
  if (!p) {
    const q = new URLSearchParams(mapQuery.replace(/^\?/, ""));
    q.set("cell", cellId);
    p = fetch(`/api/runs/${runId}/cell_panel?${q.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`This panel could not load (${r.status}).`);
        const d = (await r.json()) as CellPanelPayload;
        panelDone.set(key, d);
        return d;
      })
      .catch((e: Error) => {
        panelLoads.delete(key);
        throw e;
      });
    panelLoads.set(key, p);
  }
  return p;
}

/** One cell's panel: from the position when the map carries it, else loaded once per run, engine set and cell. */
function useCellPanel(p: Position, ctx: Ctx): { data?: CellPanelPayload; error?: string } {
  const runId = ctx.runId;
  const mapQuery = ctx.mapQuery ?? "";
  const cellId = p.cellId;
  const key = panelKey(runId, mapQuery, cellId);
  const hasInline = !!p.panel;
  const inline: CellPanelPayload | undefined = p.panel
    ? { panel: p.panel, usualSteps: p.panel.usualCellId ? ctx.map.positions[p.panel.usualCellId]?.panel?.steps : undefined }
    : undefined;
  const [state, setState] = useState<{ key: string; data?: CellPanelPayload; error?: string }>({ key });
  useEffect(() => {
    if (hasInline || panelDone.has(key)) return;
    let live = true;
    loadCellPanel(runId, mapQuery, cellId).then(
      (d) => live && setState({ key, data: d }),
      (e: Error) => live && setState({ key, error: e.message })
    );
    return () => {
      live = false;
    };
  }, [key, hasInline, runId, mapQuery, cellId]);
  if (inline) return { data: inline };
  const done = panelDone.get(key);
  if (done) return { data: done };
  return state.key === key ? state : {};
}

const Loading = () => <p className={`clear-both pt-6 ${T.sec} text-ink-3`}>Loading...</p>;

/** A cell whose panel is not in the served map: loads it, then draws it. */
export function LazyCellPanel({ p, ctx }: { p: Position; ctx: Ctx }) {
  const { data, error } = useCellPanel(p, ctx);
  if (error) return <None>{error}</None>;
  if (!data) return <Loading />;
  if (!data.panel) return <None>This panel could not load.</None>;
  return <PositionPanelView p={p} pp={data.panel} usualSteps={data.usualSteps} ctx={ctx} />;
}

/** A rival opened from a cell (panel 11): loads the cell's panel, then draws the rival's. */
export function LazyRival({ p, name, ctx }: { p: Position; name: string; ctx: Ctx }) {
  const { data, error } = useCellPanel(p, ctx);
  if (error) return <None>{error}</None>;
  if (!data) return <Loading />;
  const r = data.panel?.rivals?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!r) return <None>This panel could not load.</None>;
  return <RivalInCell r={r} p={p} ctx={ctx} />;
}

/** Whether the cell's panel (served or stubbed) carries a panel for this rival. */
export function hasRivalPanel(p: Position | undefined, name: string): boolean {
  const n = name.toLowerCase();
  return !!(p?.panel?.rivals?.some((r) => r.name.toLowerCase() === n) || p?.panelStub?.rivals.some((r) => r.name.toLowerCase() === n));
}

export function PositionPanelView({ p, pp, usualSteps, ctx }: { p: Position; pp: PositionPanel; usualSteps?: PanelStep[]; ctx: Ctx }) {
  const [compOn] = useComp();
  // am35: every panel opens on its default view (the switch off): you against
  // the average competitor where the steps carry competitor numbers, against
  // your usual on the verdict panels. The switch is the one remembered state.
  const comp = !!pp.compare && compOn;
  // Clickable steps: the steps the engine explains in this view. The default
  // selection is the engine's focus; switching panel or view starts over.
  const stepDetails = (comp ? pp.detailsComp : pp.details) ?? {};
  const selectable = pp.steps.some((s) => !!stepDetails[s.key]);
  // am37: only a step that explains itself can be selected (or start selected).
  const focusKey = comp ? pp.focusComp : pp.focus;
  const firstExplained = pp.steps.find((s) => !!stepDetails[s.key])?.key;
  const defaultSel = selectable ? (focusKey && stepDetails[focusKey] ? focusKey : firstExplained) : focusKey;
  const selKey = `${p.cellId}|${comp ? 1 : 0}`;
  const [picked, setPicked] = useState<{ key: string; step: PanelStepKey } | null>(null);
  const sel = picked && picked.key === selKey ? picked.step : defaultSel;
  const selDetail = sel ? stepDetails[sel] : undefined;
  const cell = ctx.cells.get(p.cellId);
  const notes = notesOf(p, cell);
  const soft = softLine(notes);
  const hereLabel = pp.hereKey ?? "You";
  const usualLabel = pp.usualKey ?? "";
  const anyHere = pp.steps.some((s) => !!s.here);
  const keyItems =
    comp || !anyHere
      ? []
      : [{ label: hereLabel, color: C_YOU }, ...(usualLabel && (usualSteps || pp.steps.some((s) => !!s.usual)) ? [{ label: usualLabel, color: C_USUAL }] : [])];
  const detail = comp ? pp.detailComp ?? pp.detail : pp.detail;
  const lines = comp ? pp.linesComp ?? pp.lines : pp.lines;
  const weighs = comp ? pp.weighsComp ?? pp.weighs : pp.weighs;
  const openRival = (name: string) => ctx.open({ kind: "rival", name, cell: p.cellId });
  const openIfRival = (n: string) => (hasRival(pp, n) ? openRival(n) : undefined);

  const blocks: Record<Block, ReactNode> = {
    stack:
      pp.steps.length > 0 ? (
        <>
        {pp.product && <p className={`clear-both mt-4 -mb-2 ${T.cap} text-ink-2`}>Asked about: <span className="font-semibold text-ink">{pp.product}</span></p>}
        <StepStack
          label={pp.stackLabel}
          steps={pp.steps}
          usualSteps={usualSteps}
          comp={comp}
          focus={selectable ? sel : comp ? pp.focusComp : pp.focus}
          hereLabel={hereLabel}
          usualLabel={usualLabel}
          keyItems={keyItems}
          onSelect={selectable ? (k) => setPicked({ key: selKey, step: k }) : undefined}
          canSelect={selectable ? (k) => !!stepDetails[k] : undefined}
        />
        </>
      ) : null,
    byproduct: pp.byProduct && pp.byProduct.rows.length > 0 ? <TableView table={pp.byProduct} /> : null,
    detail: selDetail ? (
      <RivalDetail d={selDetail} name="" onOpen={openIfRival} onOpenCell={(id) => ctx.open({ kind: "cell", id })} />
    ) : detail && (!selectable || sel === defaultSel) ? (
      <DetailView heading={detail.heading} body={detail.body} />
    ) : null,
    conditions: pp.conditions ? <CondColumns cond={pp.conditions} comp={comp} /> : null,
    competitors:
      pp.competitors && pp.competitors.rows.length > 0 && (!pp.compare || comp) ? (
        <BrandRows block={pp.competitors} onOpen={openIfRival} />
      ) : null,
    lines: lines && lines.length > 0 ? <LineRows lines={lines} /> : null,
    weighs: weighs && weighs.columns.length > 0 ? <WeighsView w={weighs} /> : null,
    ends: pp.ends && pp.ends.columns.some((c) => c.rows.length > 0) ? <WeighsView w={pp.ends} /> : null,
    table: (() => {
      const t = comp ? pp.tableComp ?? pp.table : pp.table;
      return t && t.rows.length > 0 ? <TableView table={t} /> : null;
    })(),
    tables:
      pp.tables && pp.tables.length > 0 ? (
        <>
          {pp.tables.map((t) => (t.rows.length > 0 ? <TableView key={t.title} table={t} /> : null))}
        </>
      ) : null,
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pr-16">
        <div className={crumbCls}>
          {cell && (
            <span className="flex items-center gap-1.5 normal-case tracking-normal" style={{ color: VCOLOR[cell.verdict].ink }}>
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: VCOLOR[cell.verdict].fg }} />
              {VWORD[cell.verdict]}
            </span>
          )}
          <span>{p.where}</span>
        </div>
        {pp.compare && <CompSwitch />}
      </div>
      <h2 className={h2Cls}>
        <TextView text={pp.claim} title={p.where} />
      </h2>
      {pp.lead && pp.lead.length > 0 && (
        <p className={`${T.body} mt-1.5 text-ink-2`}>
          <TextView text={pp.lead} title={p.where} />
        </p>
      )}
      {pp.thin && <p className={`mt-2 border-l-[3px] border-line pl-2.5 ${T.sec} text-ink-2`}>{pp.thin}</p>}
      {soft && (
        <p className="mt-2 border-l-[3px] pl-2.5 text-[13px] text-ink" style={{ borderColor: "var(--pa-contested)" }}>
          {soft}
        </p>
      )}
      <p className={`${T.sec} mt-1.5`}>{selectable ? STEP_HINT : CLICK_HINT}</p>
      {pp.kind === "h2h" && p.cellId !== "fights:h2h:all" && cell?.label && <MatchupDropNote name={cell.label} className="mt-3" />}
      {ORDER[pp.kind].map((b) => (blocks[b] ? <div key={b}>{blocks[b]}</div> : null))}
      {p.lever && <MoveBox p={p} ctx={ctx} why={whyLines(notes, ctx.cat.plural)} />}
    </>
  );
}

// ---------- panel 11: one rival inside this question type ----------

type FunnelKey = "named" | "recommended" | "converts";
const isFunnel = (k: PanelStepKey): k is FunnelKey => k === "named" || k === "recommended" || k === "converts";

const cap1 = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

function RivalDetail({ d, name, onOpen, onOpenCell }: { d: RivalStepDetail | PanelStepDetail; name: string; onOpen?: (name: string) => void; onOpenCell?: (id: string) => void }) {
  const ol = d.outcomeLabels;
  const cols = "columns" in d ? d.columns : undefined;
  const rivalHead = cols?.rival ?? name;
  const youHead = cols?.you ?? "You";
  const rivalColor = cols?.rivalIsUsual ? C_USUAL : C_AWAY;
  // The outcome table opens on two rows - you and the one brand to read it
  // against (the first listed) - so the comparison is the point; the other
  // brands sit behind "Show all".
  const [allRows, setAllRows] = useState(false);
  const outcomesAll = d.outcomes ?? [];
  const mineOf = (o: (typeof outcomesAll)[number]) => !!o.you || ("usual" in o && !!o.usual);
  const firstOther = outcomesAll.find((o) => !mineOf(o));
  const outcomes = allRows ? outcomesAll : outcomesAll.filter((o) => mineOf(o) || o === firstOther);
  const hiddenRows = outcomesAll.length - outcomes.length;
  // The outcome columns this detail carries (am35: never the pick itself - the step bars show it).
  const cols3 = ol ? ([["picked", C_YOU], ["lost", C_USUAL], ["none", C_NONE]] as const).filter(([k]) => !!ol[k]) : [];
  return (
    <DetailView heading={d.heading} body={d.body} callout={"callout" in d ? d.callout : undefined}>
      {d.rows && d.rows.length > 0 && (
        <table className={`mt-2.5 w-full ${T.body}`}>
          <thead>
            <tr className={`${T.cap} text-ink-3`}>
              <th className="py-1 text-left font-normal" />
              <th className="py-1 pl-2 text-right font-semibold" style={{ color: rivalColor }}>
                {rivalHead}
              </th>
              <th className="py-1 pl-2 text-right font-semibold" style={{ color: C_YOU }}>
                {youHead}
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.label} className="border-t border-line/70">
                <td className="py-1.5 pr-2 text-ink">{r.label}</td>
                <td className="py-1.5 pl-2 text-right text-ink-2">
                  <NumView n={r.rival} title={`${r.label} - ${rivalHead}`} />
                </td>
                <td className="py-1.5 pl-2 text-right font-semibold text-ink">
                  <NumView n={r.you} title={`${r.label} - ${youHead}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {"list" in d && d.list && d.list.rows.length > 0 && (
        <div className="mt-2.5">
          <p className={`${T.cap} text-ink-3`}>{d.list.title}</p>
          <table className={`mt-1 w-full ${T.body}`}>
            <tbody>
              {d.list.rows.map((r) => (
                <tr key={r.label} className="border-t border-line/70">
                  <td className="py-1.5 pr-2 text-ink">{r.label}</td>
                  <td className="py-1.5 pl-2 text-right font-semibold text-ink">
                    <NumView n={r.num} title={`${d.list!.title} ${r.label}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.outcomes && d.outcomes.length > 0 && ol && (
        // One row per brand and one column per outcome the step bars do not
        // show (lose to another, no single pick), under a single header.
        <table className={`mt-2.5 w-full ${T.body}`}>
          <thead>
            <tr className={`${T.cap} text-ink-3`}>
              <th className="py-1 text-left font-normal" />
              {cols3.map(([k, color]) => (
                <th key={k} className="py-1 pl-2 text-right font-normal leading-tight">
                  <i className="mr-1 inline-block h-2 w-2 rounded-full align-[0px]" style={{ background: color }} aria-hidden />
                  {cap1(ol[k] ?? "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outcomes.map((o) => {
              const own = "usual" in o && !!o.usual;
              // A step detail names its own outcome lines ("Here", "All buyers"); a rival's says "You".
              const who = cols || own ? o.name : o.you ? "You" : o.name;
              const mine = o.you || own;
              return (
                <tr key={who} className="border-t border-line/70">
                  <td className={`py-1.5 pr-2 ${mine ? "font-semibold text-ink" : "text-ink-2"}`}>{who}</td>
                  {cols3.map(([k]) => {
                    const n = o[k];
                    return (
                      <td key={k} className={`py-1.5 pl-2 text-right ${mine ? "font-semibold text-ink" : "text-ink-2"}`}>
                        {n ? <NumView n={n} title={`${who} - ${ol[k]}`} /> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {d.outcomes && ol && (hiddenRows > 0 || allRows) && outcomesAll.length > outcomesAll.filter((o) => mineOf(o) || o === firstOther).length && (
        <button type="button" className={`${linkCls} mt-2 ${T.cap}`} onClick={() => setAllRows(!allRows)}>
          {allRows ? "Show fewer" : `Show all ${outcomesAll.length - 1} competitors`}
        </button>
      )}
      {d.both && d.both.length > 0 && (
        <p className={`${T.body} mt-2.5 text-ink-2`}>
          <TextView text={d.both} title={d.heading} />
        </p>
      )}
      {"sections" in d && d.sections?.map((s) => <DetailSection key={s.title} s={s} onOpen={onOpen} onOpenCell={onOpenCell} />)}
    </DetailView>
  );
}

export function RivalInCell({ r, p, ctx }: { r: PanelRival; p: Position; ctx: Ctx }) {
  const details = r.details ?? {};
  const firstWithDetail = r.steps.find((s) => isFunnel(s.key) && details[s.key])?.key;
  const [sel, setSel] = useState<PanelStepKey | undefined>(r.focus ?? firstWithDetail);
  const d = sel && isFunnel(sel) ? details[sel] : undefined;
  const canSelect = Object.keys(details).length > 0;
  return (
    <>
      <div className={crumbCls}>
        <button type="button" className={linkCls} onClick={() => ctx.open({ kind: "cell", id: p.cellId })}>
          {p.where}
        </button>
        <span>- {r.name}</span>
      </div>
      <h2 className={h2Cls}>
        <TextView text={r.claim} title={`${r.name} - ${p.where}`} />
      </h2>
      {r.lead && r.lead.length > 0 && (
        <p className={`${T.body} mt-1.5 text-ink-2`}>
          <TextView text={r.lead} title={r.name} />
        </p>
      )}
      {r.thin && <p className={`mt-2 border-l-[3px] border-line pl-2.5 ${T.sec} text-ink-2`}>{r.thin}</p>}
      <p className={`${T.sec} mt-1.5`}>{canSelect ? STEP_HINT : CLICK_HINT}</p>

      {r.steps.length > 0 && (
        <div className="mt-4">
          {r.stackLabel && <p className={`${T.label} mb-1.5`}>{r.stackLabel}</p>}
          <KeyLine
            items={[
              { label: r.name, color: C_AWAY },
              { label: "You", color: C_YOU },
            ]}
          />
          <div className="grid gap-1.5">
            {r.steps.map((s) => (
              <StepCard
                key={s.key}
                step={s}
                comp={false}
                focus={!sel || s.key === sel}
                hereLabel="You"
                usualLabel=""
                rivalLabel={r.name}
                rivalFirst
                onSelect={isFunnel(s.key) && details[s.key] ? () => setSel(s.key) : undefined}
                plain={canSelect}
              />
            ))}
          </div>
        </div>
      )}
      {d && <RivalDetail d={d} name={r.name} />}
      {r.conditions && <CondColumns cond={r.conditions} comp={false} />}
      <LineRows lines={r.lines} />
      {r.weighs && <WeighsView w={r.weighs} />}
      {r.byCell && r.byCell.length > 0 && (
        <Blk title={r.byCellTitle}>
          <table className={`w-full ${T.body}`}>
            <thead>
              <tr className={`${T.cap} text-ink-3`}>
                <th className="py-1 text-left font-normal" />
                <th className="py-1 pl-2 text-right font-semibold" style={{ color: C_AWAY }}>
                  {r.name}
                </th>
                <th className="py-1 pl-2 text-right font-semibold" style={{ color: C_YOU }}>
                  You
                </th>
              </tr>
            </thead>
            <tbody>
              {r.byCell.map((c) => {
                const there = ctx.map.positions[c.cellId];
                return (
                  <tr key={c.cellId} className={`border-t border-line/70 ${c.cellId === p.cellId ? "font-semibold" : ""}`}>
                    <td className="py-1.5 pr-2 text-ink">
                      {there && c.cellId !== p.cellId ? (
                        <button type="button" className="text-left hover:text-primary" onClick={() => ctx.open({ kind: "rival", name: r.name, cell: c.cellId })}>
                          {c.label}
                        </button>
                      ) : (
                        c.label
                      )}
                    </td>
                    <td className="py-1.5 pl-2 text-right text-ink-2">
                      <NumView n={c.rival} title={`${c.label} - ${r.name}`} />
                    </td>
                    <td className="py-1.5 pl-2 text-right text-ink">
                      <NumView n={c.you} title={`${c.label} - you`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Blk>
      )}
    </>
  );
}


// ---------- panel 15: one rival across every question type (the By rival tab) ----------

const acrossLoads = new Map<string, Promise<RivalAcross | null>>();
const acrossDone = new Map<string, RivalAcross | null>();

function loadAcross(runId: string, mapQuery: string, name: string): Promise<RivalAcross | null> {
  const key = `${runId}|${mapQuery}|${name.toLowerCase()}`;
  let p = acrossLoads.get(key);
  if (!p) {
    const q = new URLSearchParams(mapQuery.replace(/^\?/, ""));
    q.set("name", name);
    p = fetch(`/api/runs/${runId}/rival_panel?${q.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`This panel could not load (${r.status}).`);
        const d = ((await r.json()) as { rival: RivalAcross | null }).rival;
        acrossDone.set(key, d);
        return d;
      })
      .catch((e: Error) => {
        acrossLoads.delete(key);
        throw e;
      });
    acrossLoads.set(key, p);
  }
  return p;
}

/** Whether the served map says this rival carries a panel 15. */
export const hasRivalAcross = (ctx: Ctx, name: string) => (ctx.map.rivalStubs ?? []).some((n) => n.toLowerCase() === name.toLowerCase());

/** The By rival panel: loads the rival's question-by-question read; draws `fallback` when there is none. */
export function LazyRivalAcross({ name, ctx, fallback }: { name: string; ctx: Ctx; fallback: ReactNode }) {
  const mapQuery = ctx.mapQuery ?? "";
  const key = `${ctx.runId}|${mapQuery}|${name.toLowerCase()}`;
  const [state, setState] = useState<{ key: string; data?: RivalAcross | null; error?: string }>({ key });
  useEffect(() => {
    if (acrossDone.has(key)) return;
    let live = true;
    loadAcross(ctx.runId, mapQuery, name).then(
      (d) => live && setState({ key, data: d }),
      (e: Error) => live && setState({ key, error: e.message })
    );
    return () => {
      live = false;
    };
  }, [key, ctx.runId, mapQuery, name]);
  const data = acrossDone.has(key) ? acrossDone.get(key) : state.key === key ? state.data : undefined;
  if (state.key === key && state.error) return <>{fallback}</>;
  if (data === undefined) return <Loading />;
  if (!data) return <>{fallback}</>;
  return <RivalAcrossView r={data} ctx={ctx} />;
}

// The tokens are written out here, not read from panel_parts: this module can be evaluated first (the two import each other).
const WHO_COLOR: Record<RivalAcrossStep["bars"][number]["who"], string> = { rival: "var(--pa-theirs)", you: "var(--pa-yours)", other: "var(--pa-usual)" };

/** One question's card: the whole card selects it (its bars open no answers - the block below does). */
/** By rival, as one table (2026-11-16): a row per question - the rival's number, yours, a short verdict. */
const ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
function acrossRow(s: RivalAcrossStep) {
  const rival = s.bars.find((b) => b.who === "rival");
  const you = s.bars.find((b) => b.who === "you");
  // The rival's place among the brands the question names (where it has no number against you).
  const rank = rival ? 1 + s.bars.filter((b) => b.who !== "rival" && b.num.pct > rival.num.pct).length : 0;
  const lead = s.bars.filter((b) => b.who === "other").sort((a, b) => b.num.pct - a.num.pct)[0];
  const chip: { text: string; tone: PanelTone } | null = s.tag
    ? { text: s.tag, tone: s.tagTone ?? "neutral" }
    : rival && !you
      ? rank === 1
        ? { text: "Named most", tone: "bad" }
        : { text: `${ORD[rank] ?? `${rank}th`} named`, tone: "neutral" }
      : !rival && you && lead
        ? { text: `Goes to ${lead.name}`, tone: "neutral" }
        : null;
  // Where it beats you by the most first; then the questions only it has a number for, largest first.
  const order = rival && you ? 1000 + (rival.num.pct - you.num.pct) : rival ? rival.num.pct : -1;
  return { s, rival, you, chip, order };
}

function AcrossTable({ r, sel, onSelect }: { r: RivalAcross; sel?: string; onSelect: (k: string) => void }) {
  const rows = r.steps.map(acrossRow).sort((a, b) => b.order - a.order);
  return (
    <table className={`w-full ${T.body}`}>
      <thead>
        <tr className={`${T.cap} text-ink-3`}>
          <th className="py-1 pr-2 text-left font-normal" />
          <th className="py-1 pl-2 text-right font-normal">{r.name}</th>
          <th className="py-1 pl-2 text-right font-normal">You</th>
          <th className="py-1 pl-2 text-right font-normal" />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ s, rival, you, chip }) => {
          const on = s.key === sel;
          return (
            <tr
              key={s.key}
              onClick={() => onSelect(s.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(s.key);
                }
              }}
              tabIndex={0}
              role="button"
              aria-pressed={on}
              className={`cursor-pointer border-t border-line/70 hover:bg-line/30 ${on ? "bg-line/40" : ""}`}
            >
              <td className={`py-2 pr-2 ${on ? "font-semibold text-ink" : "text-ink"}`}>{s.label}</td>
              <td className="whitespace-nowrap py-2 pl-2 text-right font-semibold tabular-nums" style={{ color: C_AWAY }}>
                {rival ? rival.num.value : "-"}
              </td>
              <td className="whitespace-nowrap py-2 pl-2 text-right font-semibold tabular-nums" style={{ color: C_YOU }}>
                {you ? you.num.value : "-"}
              </td>
              <td className="whitespace-nowrap py-2 pl-2 text-right">{chip && <Tag text={chip.text} tone={chip.tone} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function RivalAcrossView({ r, ctx }: { r: RivalAcross; ctx: Ctx }) {
  const [sel, setSel] = useState<string | undefined>(r.focus ?? r.steps[0]?.key);
  const s = r.steps.find((x) => x.key === sel) ?? r.steps[0];
  const cellP = s ? ctx.map.positions[s.cellId] : undefined;
  return (
    <>
      <div className={crumbCls}>
        <span>{r.name}</span>
        <span>- every question</span>
      </div>
      <h2 className={h2Cls}>
        <TextView text={r.claim} title={r.name} />
      </h2>
      <p className={`${T.sec} mt-1.5`}>Click a question to see what explains it. Below it, click any row or number to read the answers behind it.</p>
      <div className="mt-4">
        <p className={`${T.label} mb-1.5`}>How it goes, where it beats you most first</p>
        <AcrossTable r={r} sel={s?.key} onSelect={setSel} />
      </div>
      {s && (
        <div className="mt-4 border-t border-line pt-3.5">
          <h3 className={`${T.title} mb-1.5`}>{s.heading}</h3>
          {s.body && s.body.length > 0 && (
            <p className={`${T.body} text-ink-2`}>
              <TextView text={s.body} title={`${r.name} - ${s.label}`} />
            </p>
          )}
          {/* The table shows two numbers a question; the question's own bars (every brand on it) sit with its explanation. */}
          <div className="mt-3">
            <p className={`${T.cap} mb-1 font-semibold text-ink`}>{s.label}</p>
            {s.bars.map((bar) => (
              <NumBar key={`${bar.who}:${bar.name}`} label={bar.name} n={bar.num} color={WHO_COLOR[bar.who]} bold={bar.who !== "other"} title={`${s.label} - ${bar.name}`} />
            ))}
          </div>
          {s.conditions && <CondColumns cond={s.conditions} comp={false} />}
          {s.table && s.table.rows.length > 0 && <TableView table={s.table} />}
          {s.fold && s.fold.length > 0 && (
            <p className={`${T.body} mt-2 text-ink-2`}>
              <TextView text={s.fold} title={`${r.name} - ${s.label}`} />
            </p>
          )}
          {cellP && (
            <button type="button" className={`mt-3 ${T.ctl} ${linkCls}`} onClick={() => ctx.open({ kind: "cell", id: s.cellId })}>
              Open this question
            </button>
          )}
        </div>
      )}
      {r.byBuyer && r.byBuyer.rows.length > 0 && <TableView table={r.byBuyer} />}
      {r.products && r.products.rows.length > 0 && <TableView table={r.products} />}
    </>
  );
}
