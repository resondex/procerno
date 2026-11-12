"use client";

import { useEffect, useState } from "react";
import type { Intent, Prompt, Run } from "@/lib/types";
import type { ViewKey } from "@/lib/engine/views";
import { healthChecks } from "@/lib/engine/prompt_health_rule";
import { QUESTION_TYPE_LABEL, QUESTION_TYPE_ORDER, questionTypeOf } from "./question_types";

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
  /** Whether the health check reads this question type at all
   * (prompt_health_rule.ts) - only questions that name no brand by design. */
  checked: boolean;
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

/**
 * Live prompts grouped question type -> cell, using the dashboard's names
 * for question types (question_types.ts) in journey order. Cells order by
 * intent seq. Prompts with no intent land in a final "Other questions"
 * group, one cell per theme.
 */
export function groupPromptsForHealth(
  prompts: Prompt[],
  intents: Intent[]
): HealthStage[] {
  const intentById = new Map(intents.map((i) => [i.id, i]));
  const groups = new Map<
    string,
    { checked: boolean; cells: Map<string, HealthCell & { seq: number }> }
  >();
  const other = new Map<string, HealthCell & { seq: number }>();
  let otherChecked = false;

  for (const p of prompts) {
    if (p.retired !== 0) continue;
    const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
    const checked = healthChecks(p, it);
    let cell: HealthCell & { seq: number };
    const type: ViewKey | null = it ? questionTypeOf(it.stage, it.angle) : null;
    if (!it || !type) {
      const theme = it ? `stage:${it.stage}` : (p.theme as string);
      otherChecked ||= checked;
      cell = other.get(theme) ?? {
        key: `theme:${theme}`,
        title: it ? cellTitle(it) || it.text : theme.replace(/_/g, " "),
        seed: null,
        prompts: [],
        flagged: 0,
        seq: other.size,
      };
      other.set(theme, cell);
    } else {
      const g = groups.get(type) ?? { checked: false, cells: new Map() };
      g.checked ||= checked;
      groups.set(type, g);
      const composed = cellTitle(it);
      cell = g.cells.get(it.id) ?? {
        key: it.id,
        title: composed || it.text,
        seed: composed ? it.text : null,
        prompts: [],
        flagged: 0,
        seq: it.seq,
      };
      g.cells.set(it.id, cell);
    }
    cell.prompts.push(p);
    if (p.flagged === 1) cell.flagged++;
  }

  const finish = (
    key: string,
    label: string,
    checked: boolean,
    cells: Iterable<HealthCell & { seq: number }>
  ): HealthStage => {
    const list = [...cells].sort((a, b) => a.seq - b.seq);
    return {
      key,
      label,
      cells: list,
      live: list.reduce((n, c) => n + c.prompts.length, 0),
      flagged: list.reduce((n, c) => n + c.flagged, 0),
      checked,
    };
  };

  const ordered = QUESTION_TYPE_ORDER.filter((k) => groups.has(k)).map((k) => {
    const g = groups.get(k)!;
    return finish(k, QUESTION_TYPE_LABEL[k], g.checked, g.cells.values());
  });
  if (other.size > 0) ordered.push(finish("other", "Other questions", otherChecked, other.values()));
  return ordered;
}

/** What the health check recorded for a wave (GET /api/projects/[id]/prompt_health). */
interface HealthState {
  run: { id: string; status: string } | null;
  record: {
    at: string;
    sent: number;
    flagged: number;
    /** Coded trackers: questions not producing what their type is meant to. */
    cells?: { intent: string; reason: string }[];
  } | null;
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
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
  coded = false,
}: {
  id: string;
  prompts: Prompt[];
  intents: Intent[];
  shownRun: Run | null;
  refresh: () => void;
  /** The tracker reads coded answers: every question type is checked, by
   * counting (engine/question_fit.ts). */
  coded?: boolean;
}) {
  // Example answers revealed per flagged prompt.
  const [examples, setExamples] = useState<
    Record<string, string[] | "loading">
  >({});
  // Whether the check ran on this wave - read from the server, never assumed
  // from the run's status (a coded wave can sit at "collected", and a
  // complete wave from before 2026-11-11 was never checked on its codes).
  const [health, setHealth] = useState<HealthState | "loading" | "error">("loading");
  const askRun = shownRun?.id ?? null;
  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${id}/prompt_health${askRun ? `?run=${askRun}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: HealthState) => {
        if (live) setHealth(d);
      })
      .catch(() => {
        if (live) setHealth("error");
      });
    return () => {
      live = false;
    };
  }, [id, askRun]);
  const exampleRun =
    shownRun?.id ?? (typeof health === "object" ? health.run?.id ?? null : null);

  const stages = groupPromptsForHealth(prompts, intents);
  const flaggedCount = prompts.filter(
    (p) => p.retired === 0 && p.flagged === 1
  ).length;
  const plural = (n: number) => (n === 1 ? "" : "s");
  const cellFlags = new Map(
    (typeof health === "object" ? health.record?.cells ?? [] : []).map((c) => [c.intent, c.reason])
  );
  const flagLine = coded
    ? [
        cellFlags.size > 0
          ? `${cellFlags.size} question${plural(cellFlags.size)} ${cellFlags.size === 1 ? "is" : "are"} not drawing the kind of answer ${cellFlags.size === 1 ? "it was" : "they were"} written for.`
          : "",
        flaggedCount > 0
          ? `${flaggedCount} wording${plural(flaggedCount)} drew answers well off the topic next to the other wordings of the same question.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : `It flagged ${flaggedCount} question${plural(flaggedCount)} whose answers wandered off the topic. Swap in a suggested rewording - past answers stay as they were, and the new wording is asked from the next wave on.`;
  const status: string =
    health === "loading"
      ? ""
      : health === "error"
        ? "Could not tell whether the health check has run on this wave."
        : !health.run
          ? "Nothing has been measured yet. The health check reads a wave's answers once it is measured."
          : !health.record
            ? `The health check has not run on this wave yet.${flaggedCount > 0 ? " The flags below are from an earlier wave." : ""}`
            : `Checked on this wave${dayOf(health.record.at) ? ` (${dayOf(health.record.at)})` : ""}. ` +
              (flaggedCount > 0 || cellFlags.size > 0 ? flagLine : "Every question it reads stayed on topic.");

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
      {exampleRun && (
        <div>
          {examples[p.id] === undefined && (
            <button
              type="button"
              onClick={async () => {
                setExamples((x) => ({ ...x, [p.id]: "loading" }));
                const res = await fetch(
                  `/api/runs/${exampleRun}/responses?promptId=${p.id}`
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
      <p className="text-[13px] text-ink-3 mb-4 -mt-1 min-h-[1.25rem]">{status}</p>
      <div className="grid gap-1">
        {stages.map((st) => (
          <details key={st.key} open={st.flagged > 0 || st.cells.some((c) => cellFlags.has(c.key))} className="group">
            <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-semibold py-1 select-none">
              <Caret />
              {st.label}
              <span className="font-normal text-ink-3">{st.live}</span>
              {st.flagged > 0 && flagChip(st.flagged)}
              {st.cells.some((c) => cellFlags.has(c.key)) && (
                <span className="ml-1 rounded-full bg-warning/15 text-warning px-2 py-0.5 text-[11px] font-medium">
                  question flagged
                </span>
              )}
              {!coded && !st.checked && (
                <span
                  className="ml-1 rounded-full bg-line/60 text-ink-3 px-2 py-0.5 text-[11px] font-normal"
                  title="The health check reads only questions that name no brand and point at no other category. Here the question itself sets the topic, or reaching beyond the category is what is measured."
                >
                  not checked
                </span>
              )}
            </summary>
            <div className="ml-5 mt-1 mb-2 grid gap-1">
              {st.cells.map((c) => (
                <details key={c.key} open={c.flagged > 0 || cellFlags.has(c.key)} className="group">
                  <summary className="cursor-pointer list-none flex items-start gap-2 text-[13px] font-semibold py-1 select-none">
                    <Caret />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span>{c.title}</span>
                        <span className="font-normal text-ink-3">
                          {c.prompts.length}
                        </span>
                        {c.flagged > 0 && flagChip(c.flagged)}
                        {cellFlags.has(c.key) && (
                          <span className="rounded-full bg-warning/15 text-warning px-2 py-0.5 text-[11px] font-medium">
                            question flagged
                          </span>
                        )}
                      </span>
                      {cellFlags.has(c.key) && (
                        <span className="block font-normal text-warning mt-0.5">{cellFlags.get(c.key)}</span>
                      )}
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
        {coded
          ? "The check counts two things from the coded answers. For each question: do its answers do what that kind of question is for - name products, use the category's arguments, or discuss your brand. For each wording: are its answers about the category as often as the other wordings of the same question."
          : "The health check reads the questions that do not name a brand and asks whether their answers stayed on topic. Questions that name a brand are anchored by that name, so those are not checked."}
      </p>
    </>
  );
}
