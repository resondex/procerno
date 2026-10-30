"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReasonRow, ReasonsView } from "@/lib/engine/reasons";
import type { ViewKey } from "@/lib/engine/views";
import { SortTable, Tip, type Col } from "./table";
import { rate, rateCol } from "./view_parts";

/**
 * The reasons view (2026-10-27): how often each confirmed reason code is
 * argued, pooled across question types or within one type by its verdict,
 * with the code_groups rollup when the tracker has a map. Renders nothing
 * until the run has a codes source.
 */

const POOLED = "pooled";
/** Smallest verdict group the you-vs-them gap is shown for. */
const GAP_MIN = 20;

const TIP_POOLED =
  "Answers that argue from this code, over every coded answer except criteria questions (criteria answers list what to check rather than argue, so they are kept apart).";

/**
 * `room` (Journey's buyer filter) asks for one room's cells - types asked
 * across all buyers drop out. `initialType` opens on one question type (a
 * view key, e.g. criteria_taught). Both absent = exactly today's behavior.
 */
export default function ReasonsSection({ runId, room, initialType }: { runId: string; room?: string; initialType?: ViewKey }) {
  const [view, setView] = useState<ReasonsView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>(initialType ?? POOLED);
  const [grouped, setGrouped] = useState(true);

  useEffect(() => {
    let live = true;
    fetch(`/api/runs/${runId}/reasons${room ? `?room=${encodeURIComponent(room)}` : ""}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`reasons view failed (${r.status})`);
        const d = (await r.json()) as { view: ReasonsView | null };
        if (live) setView(d.view);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [runId, room]);

  const selected = view?.types.find((t) => t.key === type) ?? null;

  const cols = useMemo((): Col<ReasonRow>[] => {
    if (!view) return [];
    const first: Col<ReasonRow> = {
      id: "label",
      label: "Reason",
      val: (r) => r.label,
      render: (r) => {
        const mix = selected ? r.mixed[selected.key] : undefined;
        const [a, b] = selected?.verdicts ?? [];
        return (
          <span className={r.isGroup ? "font-medium" : ""}>
            {r.label}
            {r.isGroup && <span className="ml-2 text-[11px] text-ink-3">{r.codes.length} codes</span>}
            {!r.isGroup && r.group && <span className="ml-2 text-[11px] text-ink-3">{r.group}</span>}
            {mix && a && b && (
              <Tip
                tip={`This group's reasons pull opposite ways, so the group row can read close to even. Argued more in "${a.label}" answers: ${mix.toward.join(", ")}. Argued more in "${b.label}" answers: ${mix.away.join(", ")}. Untick "Group related reasons" to see each one.`}
              >
                <span className="ml-2 cursor-help rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-normal text-warning">
                  pulls both ways
                </span>
              </Tip>
            )}
          </span>
        );
      },
    };
    if (!selected) {
      return [
        first,
        rateCol("pooled", "All types", TIP_POOLED, (r) => r.pooled),
        ...view.types.map((t) =>
          rateCol<ReasonRow>(t.key, t.label, `Answers to ${t.label.toLowerCase()} questions that argue from this code.`, (r) => r.byType[t.key as ViewKey] ?? { k: 0, n: 0, low: 0, high: 0 })
        ),
      ];
    }
    const k = selected.key;
    const verdictCols = selected.verdicts.map((v) =>
      rateCol<ReasonRow>(
        v.key,
        `${v.label} (${v.answers})`,
        `Of the ${v.answers} ${selected.label.toLowerCase()} answers that ${v.label.toLowerCase()}, the share arguing from this code.`,
        (r) => r.byVerdict[k]?.[v.key] ?? { k: 0, n: 0, low: 0, high: 0 }
      )
    );
    const [a, b] = selected.verdicts;
    const gap: Col<ReasonRow>[] =
      b && a.answers >= GAP_MIN && b.answers >= GAP_MIN
        ? [
            {
              id: "gap",
              label: `${a.label} minus ${b.label.toLowerCase()}`,
              tip: `Points by which the code is argued more often when the answer ${a.label.toLowerCase()} than when it ${b.label.toLowerCase()}. Negative = the code comes up more on the ${b.label.toLowerCase()} side.`,
              num: true,
              val: (r) => {
                const x = r.byVerdict[k];
                return x ? Math.round((rate(x[a.key]) - rate(x[b.key])) * 1000) / 10 : null;
              },
              render: (r) => {
                const x = r.byVerdict[k];
                if (!x) return "-";
                const d = Math.round((rate(x[a.key]) - rate(x[b.key])) * 100);
                return <span className={d > 0 ? "text-primary" : d < 0 ? "text-danger" : ""}>{d > 0 ? `+${d}` : d}</span>;
              },
            },
          ]
        : [];
    return [first, rateCol("all", `All (${selected.answers})`, `${selected.label} answers that argue from this code.`, (r) => r.byType[k] ?? { k: 0, n: 0, low: 0, high: 0 }), ...verdictCols, ...gap];
  }, [view, selected]);

  if (error) return <div className="card px-5 py-4 text-[13px] text-danger">{error}</div>;
  if (!view || view.types.length === 0) return null;
  const rows = grouped && view.groups ? view.groups : view.codes;

  return (
    <section className="card p-6 grid gap-4">
      <div>
        <h2 className="section-label mb-1">Reasons - the arguments answers make</h2>
        <p className="text-[13px] text-ink-3">
          How often each reason in your confirmed codebook is argued, whichever brand it argues for. Pick a question type to
          compare the arguments behind each verdict.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-2">
        <label className="flex items-center gap-2">
          Question type
          <select className="input w-auto text-[13px]" value={selected ? type : POOLED} onChange={(e) => setType(e.target.value)}>
            <option value={POOLED}>All types ({view.pooledAnswers} answers, criteria apart)</option>
            {view.types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} ({t.answers})
              </option>
            ))}
          </select>
        </label>
        {view.groups ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
            Group related reasons
          </label>
        ) : (
          <span className="text-[12px] text-ink-3">No reason groups are set for this tracker, so every reason shows on its own.</span>
        )}
      </div>
      {selected?.key === "criteria_taught" && (
        <p className="text-[12px] text-ink-3">
          Criteria answers list what to check rather than argue for a pick, so these are the criteria the AI teaches. They stay
          out of the all-types column.
        </p>
      )}
      {selected && selected.noReason > 0 && (
        <p className="text-[12px] text-ink-3">{selected.noReason} of these answers argue from no reason in the codebook.</p>
      )}
      <SortTable
        key={type}
        cols={cols}
        rows={rows}
        filename={`reasons_${selected?.key ?? POOLED}.csv`}
        defaultSort={{ id: selected ? "all" : "pooled", dir: -1 }}
      />
      {view.unknownGroupCodes.length > 0 && (
        <p className="text-[12px] text-warning">
          The reason groups name codes your codebook does not hold: {view.unknownGroupCodes.join(", ")}.
        </p>
      )}
    </section>
  );
}
