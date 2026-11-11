"use client";

import { useState } from "react";
import type { Intent, Prompt, Run } from "@/lib/types";
import { STATION_OF, STATION_ORDER, viewsOf } from "@/lib/engine/views";

/** Stage labels, copied from instrument.ts stageLibrary (pricing shows as
 * "Value", the stage's customer-facing name since the contract rename). */
const STAGE_LABEL: Record<string, string> = {
  problem_recognition: "Problem recognition",
  category_education: "Category education",
  discovery: "Discovery",
  criteria: "Criteria formation",
  use_case: "Use-case fit",
  social_validation: "Social validation",
  premium_worth: "Premium vs. basic brands",
  comparison: "Comparison",
  alternatives: "Alternatives",
  objections: "Objections / risk",
  pricing: "Value",
  churn_triggers: "Churn triggers",
  renewal: "Renewal",
  repertoire: "Repertoire",
  business_case: "Business case",
  expansion: "Expansion",
  ecosystem: "Ecosystem",
  advocacy: "Advocacy",
};

/** Within-station order (stations come from views.ts). */
const STAGE_ORDER = [
  "problem_recognition",
  "category_education",
  "discovery",
  "criteria",
  "use_case",
  "social_validation",
  "premium_worth",
  "comparison",
  "alternatives",
  "objections",
  "pricing",
  "churn_triggers",
  "renewal",
  "repertoire",
  "business_case",
  "expansion",
  "ecosystem",
  "advocacy",
];

export interface HealthCell {
  key: string;
  /** Design identity: situation · angle · concern, else the seed. */
  title: string;
  /** The seed text, shown muted under the title (null when the title IS the
   * seed, or for the theme-keyed "Other prompts" cells). */
  seed: string | null;
  prompts: Prompt[];
  flagged: number;
}

export interface HealthStage {
  key: string;
  label: string;
  cells: HealthCell[];
  live: number;
  flagged: number;
}

function angleLabel(angle: string | null | undefined): string {
  if (!angle || angle === "generic" || angle === "class") return "";
  if (angle === "defensive") return "Your customers";
  return angle;
}

function cellTitle(it: Intent): string {
  const parts = [it.situation ?? "", angleLabel(it.angle), it.concern ?? ""]
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.join(" · ");
}

function stationRank(stage: string, angle: string | null | undefined): number {
  const v = viewsOf(stage, angle)[0];
  return v ? STATION_ORDER.indexOf(STATION_OF[v]) : STATION_ORDER.length;
}

/**
 * Live prompts grouped stage -> cell. Stages order by station (views.ts)
 * then STAGE_ORDER; a stage spanning stations (alternatives: offensive vs
 * defensive) sits at its earliest. Cells order by intent seq. Prompts with
 * no intent land in a final "Other prompts" stage, one cell per theme.
 */
export function groupPromptsForHealth(
  prompts: Prompt[],
  intents: Intent[]
): HealthStage[] {
  const intentById = new Map(intents.map((i) => [i.id, i]));
  const stages = new Map<
    string,
    { rank: number; cells: Map<string, HealthCell & { seq: number }> }
  >();
  const other = new Map<string, HealthCell & { seq: number }>();

  for (const p of prompts) {
    if (p.retired !== 0) continue;
    const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
    let cell: HealthCell & { seq: number };
    if (!it) {
      const theme = p.theme as string;
      cell = other.get(theme) ?? {
        key: `theme:${theme}`,
        title: theme.replace(/_/g, " "),
        seed: null,
        prompts: [],
        flagged: 0,
        seq: other.size,
      };
      other.set(theme, cell);
    } else {
      const rank = stationRank(it.stage, it.angle);
      const st = stages.get(it.stage) ?? { rank, cells: new Map() };
      st.rank = Math.min(st.rank, rank);
      stages.set(it.stage, st);
      const composed = cellTitle(it);
      cell = st.cells.get(it.id) ?? {
        key: it.id,
        title: composed || it.text,
        seed: composed ? it.text : null,
        prompts: [],
        flagged: 0,
        seq: it.seq,
      };
      st.cells.set(it.id, cell);
    }
    cell.prompts.push(p);
    if (p.flagged === 1) cell.flagged++;
  }

  const finish = (key: string, label: string, cells: Iterable<HealthCell & { seq: number }>): HealthStage => {
    const list = [...cells].sort((a, b) => a.seq - b.seq);
    return {
      key,
      label,
      cells: list,
      live: list.reduce((n, c) => n + c.prompts.length, 0),
      flagged: list.reduce((n, c) => n + c.flagged, 0),
    };
  };

  const ordered = [...stages.entries()]
    .sort(([a, sa], [b, sb]) => {
      if (sa.rank !== sb.rank) return sa.rank - sb.rank;
      const ia = STAGE_ORDER.indexOf(a);
      const ib = STAGE_ORDER.indexOf(b);
      return (ia < 0 ? STAGE_ORDER.length : ia) - (ib < 0 ? STAGE_ORDER.length : ib);
    })
    .map(([key, st]) => finish(key, STAGE_LABEL[key] ?? key, st.cells.values()));
  if (other.size > 0) ordered.push(finish("other", "Other prompts", other.values()));
  return ordered;
}

function Caret() {
  return (
    <span className="text-ink-3 transition-transform group-open:rotate-90">
      ▸
    </span>
  );
}

export function PromptHealthBody({
  id,
  prompts,
  intents,
  shownRun,
  refresh,
}: {
  id: string;
  prompts: Prompt[];
  intents: Intent[];
  shownRun: Run | null;
  refresh: () => void;
}) {
  // Example answers revealed per flagged prompt.
  const [examples, setExamples] = useState<
    Record<string, string[] | "loading">
  >({});
  const stages = groupPromptsForHealth(prompts, intents);
  const flaggedCount = prompts.filter(
    (p) => p.retired === 0 && p.flagged === 1
  ).length;

  const flagBlock = (p: Prompt) => (
    <div className="mt-2 border-l-2 border-warning/40 pl-3 grid gap-1.5">
      {p.flag_reason && (
        <p className="text-[13px] text-ink-3">{p.flag_reason}</p>
      )}
      {p.suggested_alternatives.map((alt, i) => (
        <div key={i} className="flex items-baseline gap-2 text-[13px]">
          <span className="text-ink-2 flex-1">“{alt}”</span>
          <button
            type="button"
            onClick={async () => {
              await fetch(`/api/projects/${id}/prompts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "replace",
                  promptId: p.id,
                  text: alt,
                }),
              });
              refresh();
            }}
            className="shrink-0 font-medium text-primary hover:opacity-80"
          >
            Refield with this →
          </button>
        </div>
      ))}
      {shownRun && (
        <div>
          {examples[p.id] === undefined && (
            <button
              type="button"
              onClick={async () => {
                setExamples((x) => ({ ...x, [p.id]: "loading" }));
                const res = await fetch(
                  `/api/runs/${shownRun.id}/responses?promptId=${p.id}`
                );
                const d = res.ok ? await res.json() : { responses: [] };
                setExamples((x) => ({
                  ...x,
                  [p.id]: d.responses
                    .slice(0, 3)
                    .map((r: { text: string }) => r.text),
                }));
              }}
              className="text-[13px] font-medium text-primary hover:opacity-80"
            >
              Show example answers
            </button>
          )}
          {examples[p.id] === "loading" && (
            <span className="text-[13px] text-ink-3">loading…</span>
          )}
          {Array.isArray(examples[p.id]) && (
            <div className="grid gap-2 mt-1">
              {(examples[p.id] as string[]).map((t, i) => (
                <p
                  key={i}
                  className="text-[13px] leading-relaxed text-ink-2 whitespace-pre-wrap border-l-2 border-line pl-3 max-h-40 overflow-y-auto"
                >
                  {t}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const flagChip = (n: number) => (
    <span className="ml-1 rounded-full bg-warning/15 text-warning px-2 py-0.5 text-[11px] font-medium">
      {n} flagged
    </span>
  );

  return (
    <>
      <p className="text-[13px] text-ink-3 mb-4 -mt-1">
        {flaggedCount > 0
          ? `The health check flagged ${flaggedCount} prompt${flaggedCount === 1 ? "" : "s"} whose answers drifted off-category. Refield with a suggested alternative — history is preserved, and the replacement fields on the next run.`
          : shownRun && shownRun.status !== "complete"
            ? // The check runs when a wave is finalized; a wave still held has
              // never been checked, so do not claim a pass (2026-11-11).
              "The health check has not run on this wave yet. Below is every question this tracker asks."
            : "All prompts passed the health check."}
      </p>
      <div className="grid gap-1">
        {stages.map((st) => (
          <details key={st.key} open={st.flagged > 0} className="group">
            <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-semibold py-1 select-none">
              <Caret />
              {st.label}
              <span className="font-normal text-ink-3">{st.live}</span>
              {st.flagged > 0 && flagChip(st.flagged)}
            </summary>
            <div className="ml-5 mt-1 mb-2 grid gap-1">
              {st.cells.map((c) => (
                <details key={c.key} open={c.flagged > 0} className="group">
                  <summary className="cursor-pointer list-none flex items-start gap-2 text-[13px] font-semibold py-1 select-none">
                    <Caret />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span>{c.title}</span>
                        <span className="font-normal text-ink-3">
                          {c.prompts.length}
                        </span>
                        {c.flagged > 0 && flagChip(c.flagged)}
                      </span>
                      {c.seed && (
                        <span className="block font-normal text-ink-3 mt-0.5">
                          {c.seed}
                        </span>
                      )}
                    </span>
                  </summary>
                  <div className="card divide-y divide-line mt-1 mb-2 ml-5">
                    {c.prompts.map((p) => (
                      <div key={p.id} className="px-5 py-2.5">
                        <div className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span className="text-ink-2">{p.text}</span>
                          {p.asker && (
                            <span className="rounded-full bg-line/60 text-ink-3 px-2 py-0.5 text-[11px]">
                              {p.asker}
                            </span>
                          )}
                          {p.flagged === 1 && (
                            <span className="rounded-full bg-warning/15 text-warning px-2 py-0.5 text-[11px] font-medium">
                              flagged
                            </span>
                          )}
                        </div>
                        {p.flagged === 1 && flagBlock(p)}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>
      <p className="text-[13px] text-ink-3 mt-3">
        The headline numbers come only from questions that do not name your brand. Questions that name it
        (matchups, worries, value) are reported on their own, since naming the brand guarantees a mention.
      </p>
    </>
  );
}
