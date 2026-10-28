"use client";

import type { RateCell } from "@/lib/engine/view_data";
import { Tip, type Col } from "./table";

/** Shared pieces of the per-type views (alternatives, doubt): rate text with
 * its 95% range, rate columns, stacked bars and their legends. */

export const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
export const pct = (c: RateCell) => {
  if (c.n === 0) return "-";
  const x = rate(c);
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
export const range = (c: RateCell) =>
  c.n === 0 ? "no answers" : `${c.k} of ${c.n} - 95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%`;

export function RateText({ cell }: { cell: RateCell }) {
  return (
    <Tip tip={range(cell)}>
      <span className="cursor-help">{pct(cell)}</span>
    </Tip>
  );
}

export const rateCol = <T,>(id: string, label: string, tip: string, get: (r: T) => RateCell): Col<T> => ({
  id,
  label,
  tip,
  num: true,
  val: (r) => (get(r).n > 0 ? Math.round(rate(get(r)) * 1000) / 10 : null),
  render: (r) => <RateText cell={get(r)} />,
});

export interface Part<K extends string> {
  key: K;
  label: string;
  color: string;
}

export function StackBar<K extends string>({ parts, cells }: { parts: readonly Part<K>[]; cells: Record<K, RateCell> }) {
  return (
    <div className="flex h-3 w-full min-w-[8rem] overflow-hidden rounded-[3px]">
      {parts.map((p) => (
        <div
          key={p.key}
          className={p.color}
          style={{ width: `${rate(cells[p.key]) * 100}%` }}
          title={`${p.label}: ${cells[p.key].k} of ${cells[p.key].n}`}
        />
      ))}
    </div>
  );
}

export function Legend<K extends string>({ parts, cells }: { parts: readonly Part<K>[]; cells?: Record<K, RateCell> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {parts.map((p) => (
        <span key={p.key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-[3px] ${p.color}`} />
          {p.label}
          {cells && ` ${pct(cells[p.key])}`}
        </span>
      ))}
    </div>
  );
}
