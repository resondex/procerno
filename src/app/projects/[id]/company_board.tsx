"use client";

import { Fragment, useEffect, useState } from "react";
import type { PortfolioCompany, PortfolioView, RateCell } from "@/lib/engine/portfolio";
import { viewQuery } from "./view_parts";
import { T } from "./type_scale";

/**
 * The company board (2026-11-11): the Overview's "Share of picks, when the
 * AI commits" card, rolled up by parent company - sister brands read as one
 * portfolio. Same row grammar as that card (label / bar / percent, the
 * client's row in primary); a company with more than one brand expands to
 * its members. Renders null until the view loads and whenever the tracker
 * has no parent companies on its dictionary (hasParents false). Counts live
 * in tooltips only.
 */

/** Companies shown besides the client's, before the "Others" row. */
const SHOWN = 5;

const pctOf = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = c.k / c.n;
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
const shareX = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const picksTip = (c: RateCell) => `${c.k.toLocaleString("en-US")} of ${c.n.toLocaleString("en-US")} picks`;

export function CompanyBoard({
  runId,
  engines,
  share,
  bare,
  onHasParents,
}: {
  runId: string;
  /** The Panel's engine set (null / empty = the whole core panel). */
  engines?: readonly string[] | null;
  /** Share-link view: read-only. The board has no write controls, so this
   * only documents the context; the route serves cached data either way. */
  share?: boolean;
  /** Rows only - for mounting inside an existing card behind a toggle. */
  bare?: boolean;
  /** Told once the view loads: false = nothing to show (hide the toggle). */
  onHasParents?: (has: boolean) => void;
}) {
  void share;
  const [view, setView] = useState<PortfolioView | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = viewQuery({ engines });

  useEffect(() => {
    let alive = true;
    fetch(`/api/runs/${runId}/portfolio${q}`)
      .then((r) => (r.ok ? r.json() : { view: null }))
      .then((d: { view: PortfolioView | null }) => {
        if (!alive) return;
        setView(d.view);
        onHasParents?.(!!d.view?.hasParents);
      })
      .catch(() => {
        if (alive) onHasParents?.(false);
      });
    return () => {
      alive = false;
    };
    // onHasParents is a notification; refetch only when the data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, q]);

  if (!view || !view.hasParents) return null;

  const withPicks = view.companies.filter((c) => c.shareOfPicks.k > 0 || c.you);
  const you = withPicks.find((c) => c.you);
  const others = withPicks.filter((c) => !c.you);
  const shown = others.slice(0, SHOWN);
  const rest = others.slice(SHOWN).reduce((a, c) => a + c.shareOfPicks.k, 0);
  const rows: PortfolioCompany[] = [...shown, ...(you ? [you] : [])].sort(
    (a, b) => b.shareOfPicks.k - a.shareOfPicks.k || a.name.localeCompare(b.name)
  );
  const base = view.inCategoryPicks;
  const restCell: RateCell | null = base > 0 && rest / base >= 0.05 ? { k: rest, n: base, low: 0, high: 0 } : null;
  const max = Math.max(0.0001, ...rows.map((c) => shareX(c.shareOfPicks)), restCell ? shareX(restCell) : 0);

  const grid = "grid w-full grid-cols-[minmax(0,132px)_minmax(0,1fr)_40px] items-center gap-2.5 rounded-md px-1 py-1 text-left text-[13px]";
  const bar = (c: RateCell, strong: boolean, thin?: boolean) => (
    <span className={`${thin ? "h-1.5" : "h-2.5"} overflow-hidden rounded-[5px] bg-line/60`}>
      <i className={`block h-full rounded-[5px] ${strong ? "bg-primary" : "bg-neutral-bar"}`} style={{ width: `${(100 * shareX(c)) / max}%` }} />
    </span>
  );
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const body = (
    <>
      {rows.map((c) => {
        const expandable = c.members.length > 1;
        const isOpen = open.has(c.key);
        const tone = c.you ? "font-semibold text-ink" : "text-ink-2";
        const label = (
          <span className="flex min-w-0 items-center gap-1">
            {expandable && (
              <span aria-hidden className={`inline-block w-3 shrink-0 text-ink-3 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                {"›"}
              </span>
            )}
            <span className="truncate">{c.name}</span>
          </span>
        );
        const inner = (
          <>
            {label}
            {bar(c.shareOfPicks, c.you)}
            <span className="text-right tabular-nums">{pctOf(c.shareOfPicks)}</span>
          </>
        );
        return (
          <Fragment key={c.key}>
            {expandable ? (
              <button
                type="button"
                aria-expanded={isOpen}
                title={`${picksTip(c.shareOfPicks)} - ${isOpen ? "hide" : "show"} its brands`}
                onClick={() => toggle(c.key)}
                className={`${grid} ${tone} hover:bg-primary-soft`}
              >
                {inner}
              </button>
            ) : (
              <div title={picksTip(c.shareOfPicks)} className={`${grid} ${tone}`}>
                {inner}
              </div>
            )}
            {expandable && isOpen &&
              c.members.map((m) => (
                <div
                  key={m.key}
                  title={picksTip(m.shareOfPicks)}
                  className={`${grid} ${m.you ? "font-semibold text-ink" : "text-ink-3"} pl-5`}
                >
                  <span className="truncate">{m.name}</span>
                  {bar(m.shareOfPicks, m.you, true)}
                  <span className="text-right tabular-nums">{pctOf(m.shareOfPicks)}</span>
                </div>
              ))}
          </Fragment>
        );
      })}
      {restCell && (
        <div title={picksTip(restCell)} className={`${grid} text-ink-2`}>
          <span className="truncate">Others</span>
          {bar(restCell, false)}
          <span className="text-right tabular-nums">{pctOf(restCell)}</span>
        </div>
      )}
      <p className={`${T.cap} mt-2.5 text-ink-3`}>
        Brands with the same parent company count together. Open a company to see its brands.
      </p>
    </>
  );

  if (bare) return body;
  return (
    <div className="card min-w-0 p-[18px]">
      <h3 className={`${T.title} mb-3`}>Share of picks by company, when the AI commits</h3>
      {body}
    </div>
  );
}

export default CompanyBoard;
