"use client";

import { useEffect, useState } from "react";
import type { RateCell } from "@/lib/engine/view_data";
import type { JourneyView } from "@/lib/engine/journey";
import type { HeadlineView } from "@/lib/engine/headline";
import type { ValueView } from "@/lib/engine/value";
import type { RulesView, SliceRules } from "@/lib/engine/rules_explorer";
import { SortTable, type Col } from "./table";
import { BaseNote, RateText, fmtN, rate, useEngineSet, viewQuery } from "./view_parts";

/**
 * Buyers - a lens of the Analysis tier (RATIFIED 2026-11-01,
 * WORKBENCH_REDESIGN_2026-10-30.md top section). One matrix, a row per buyer
 * room the instrument asks in: named, picked when one is, worth it, the line
 * the value question asked about, the condition the room most often wins on
 * and loses on. A row click applies the buyer filter and opens Stations.
 *
 * Reads only cached view engines (journey for the rooms list, headline per
 * room, value, rules) - no engine of its own. Partial by design: only
 * room-pinned questions fill it; everything asked across all buyers lives
 * under Stations.
 *
 * Surface rule: no answer counts in cells - each rate's count and range sit
 * in its hover, the section carries one muted base line.
 */

interface BuyerRow {
  room: string;
  named: RateCell | null;
  picked: RateCell | null;
  worth: RateCell | null;
  line: string | null;
  winsOn: string | null;
  losesOn: string | null;
  /** Answers behind the row (headline + value), for the csv and the base line. */
  answers: number;
}

/** Wilson 95% interval, for a 0-of-n cell the headline omits (the brand was never named). */
function wilson(k: number, n: number): RateCell {
  const z = 1.96;
  if (n === 0) return { k, n, low: 0, high: 0 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, low: Math.max(0, c - h), high: Math.min(1, c + h) };
}

async function getView<T>(url: string): Promise<T | null> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return ((await r.json()) as { view: T | null }).view;
}

/** A view that failed to load leaves its columns blank rather than sinking the table. */
const soft = <T,>(p: Promise<T | null>) => p.catch(() => null);

function buildRows(
  rooms: string[],
  heads: (HeadlineView | null)[],
  value: ValueView | null,
  rules: RulesView | null
): BuyerRow[] {
  return rooms.map((room, i) => {
    const h = heads[i];
    let named: RateCell | null = null;
    let picked: RateCell | null = null;
    if (h && h.answers > 0) {
      const t = h.brands.find((b) => b.role === "target");
      named = t ? t.mentioned : wilson(0, h.answers);
      picked = t && t.shareOfDecided.n > 0 ? t.shareOfDecided : null;
    }
    const v = value?.rooms.find((r) => r.rooms.includes(room) || r.key === room) ?? null;
    const s: SliceRules | null = rules?.rooms.find((r) => r.key === room) ?? null;
    return {
      room,
      named,
      picked,
      worth: v && v.answers > 0 ? v.worth.yes : null,
      line: v?.line ?? null,
      winsOn: s?.win[0]?.label ?? null,
      losesOn: s?.lose[0]?.label ?? null,
      answers: (h?.answers ?? 0) + (v?.answers ?? 0),
    };
  });
}

const dash = <span className="text-ink-3">-</span>;
const rateVal = (c: RateCell | null) => (c && c.n > 0 ? Math.round(rate(c) * 1000) / 10 : null);

export default function BuyersSection({
  runId,
  onPick,
  onRooms,
}: {
  runId: string;
  /** A row click: apply the buyer filter and open Stations. */
  onPick: (room: string) => void;
  /** Reports the rooms list up (the global buyer bar), from the fetch callback. */
  onRooms?: (rooms: string[]) => void;
}) {
  const [rows, setRows] = useState<BuyerRow[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const engines = useEngineSet();
  useEffect(() => {
    let live = true;
    const base = `/api/runs/${runId}`;
    const eq = viewQuery({ engines });
    getView<JourneyView>(`${base}/journey${eq}`)
      .then(async (j) => {
        const rooms = j?.rooms ?? [];
        if (live) onRooms?.(rooms);
        if (rooms.length === 0) {
          if (live) setRows(null);
          return;
        }
        const [value, rules, ...heads] = await Promise.all([
          soft(getView<ValueView>(`${base}/value${eq}`)),
          soft(getView<RulesView>(`${base}/rules${eq}`)),
          ...rooms.map((rm) => soft(getView<HeadlineView>(`${base}/headline${viewQuery({ room: rm, engines })}`))),
        ]);
        if (live) setRows(buildRows(rooms, heads as (HeadlineView | null)[], value as ValueView | null, rules as RulesView | null));
      })
      .catch((e: Error) => live && setError(`The buyers view failed to load (${e.message}).`));
    return () => {
      live = false;
    };
  }, [runId, onRooms, engines]);

  if (rows === null) return null;

  const cols: Col<BuyerRow>[] = [
    {
      id: "room",
      label: "Buyer",
      val: (r) => r.room,
      render: (r) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPick(r.room);
          }}
          title={`See every station as ${r.room}`}
          className="text-left font-medium text-primary hover:opacity-80"
        >
          {r.room}
        </button>
      ),
    },
    {
      id: "named",
      label: "Named",
      tip: "How often the answers name you, in the \"which should I get\" questions asked as this buyer.",
      num: true,
      val: (r) => rateVal(r.named),
      render: (r) => (r.named ? <RateText cell={r.named} /> : dash),
    },
    {
      id: "picked",
      label: "Picked, when one is",
      tip: "Your win rate when the answer picks one brand in your category, in the \"which should I get\" questions asked as this buyer.",
      num: true,
      val: (r) => rateVal(r.picked),
      render: (r) => (r.picked ? <RateText cell={r.picked} /> : dash),
    },
    {
      id: "worth",
      label: "Worth it",
      tip: "How often the value question - is the line worth it over a cheaper option, for this buyer - comes back worth it.",
      num: true,
      val: (r) => rateVal(r.worth),
      render: (r) => (r.worth ? <RateText cell={r.worth} /> : dash),
    },
    {
      id: "line",
      label: "Line asked about",
      val: (r) => r.line,
      render: (r) => (r.line ? <span className="text-ink-2">{r.line}</span> : dash),
    },
    {
      id: "wins",
      label: "Wins on",
      tip: "The condition this buyer's answers most often state for picking you.",
      val: (r) => r.winsOn,
      render: (r) => (r.winsOn ? <span className="text-ink-2">{r.winsOn}</span> : dash),
    },
    {
      id: "loses",
      label: "Loses on",
      tip: "The condition this buyer's answers most often state for picking another brand.",
      val: (r) => r.losesOn,
      render: (r) => (r.losesOn ? <span className="text-ink-2">{r.losesOn}</span> : dash),
    },
    { id: "answers", label: "Answers", csvOnly: true, num: true, val: (r) => r.answers },
  ];

  const total = rows?.reduce((s, r) => s + r.answers, 0) ?? 0;

  return (
    <section className="card p-6 grid gap-3">
      <div>
        <h2 className="section-label mb-1">Each buyer you asked for, side by side</h2>
        <p className="text-[13px] text-ink-3">Pick a buyer to see every station through their eyes.</p>
      </div>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {!rows && !error && <p className="text-[13px] text-ink-3">Loading the buyers...</p>}
      {rows && (
        <>
          <SortTable
            cols={cols}
            rows={rows}
            filename="buyers.csv"
            // Setup order until a header is clicked.
            defaultSort={{ id: "__none", dir: 1 }}
            onRowClick={(r) => onPick(r.room)}
          />
          <p className="text-[12px] text-ink-3">
            Only questions asked in one buyer&apos;s voice fill this table: discovery, use-case fit, criteria and value.
            Head-to-heads, worries and the customer questions are asked across all buyers and sit under Stations.
          </p>
          <BaseNote>
            {fmtN(total)} answers asked in a buyer&apos;s voice. Hover a number for its range.
          </BaseNote>
        </>
      )}
    </section>
  );
}
