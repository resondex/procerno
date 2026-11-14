import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { authEnabled, isStaff, requireAuth, requireProject } from "@/lib/auth";
import { engineDisplayLabel, getEngine, vendorDisplay } from "@/lib/engine/providers";
import { promptsForRun, runCarries, worryPromptIds } from "@/lib/engine/surfaces";
import { matchupPromptsNotAsked, parseMatchupQueue } from "@/lib/engine/matchups";
import type { Run } from "@/lib/types";

/** One wave as the Run history dialog shows it (2026-11-12). Everything is
 * customer-facing inventory: no model ids, no legacy coder tables. */
export interface WaveRow {
  id: string;
  /** Oldest wave = 1. */
  number: number;
  status: Run["status"];
  /** Customer-words state, decided server-side so the dialog never reads
   * internal status words. */
  state: "starting" | "collecting" | "review" | "measuring" | "measured" | "stopped";
  created_at: string;
  completed_at: string | null;
  /** Questions this wave asked (answers on the busiest assistant / repeats -
   * what was actually asked, not today's battery). */
  questions: number;
  repeats: number;
  /** Assistants grouped by company, display labels only. */
  assistants: { company: string; names: string[] }[];
  assistantCount: number;
  /** Assistants that answered fewer than every question, in plain words. */
  shortfalls: { name: string; answered: number }[];
  answers: number;
  /** Whether the monthly buyer-worry questions rode this wave (null = the
   * tracker has none). */
  worries: boolean | null;
  /** Wording changes logged against this wave (prompt_flags). */
  flags: { replaced: number; kept: number; open: number };
  /** "Ask this matchup" changes that started with this wave: rivals added
   * (a swap's new rival included) and rivals whose head-to-head questions
   * this wave stopped asking. Absent when none. */
  matchups?: { added: string[]; dropped: string[] };
  /** Staff only: the raw error and pipeline. */
  error?: string | null;
  pipeline?: Run["pipeline"];
  failed: boolean;
}

/** A matchup queued for the next wave (the dialog's "From the next wave" line). */
export interface QueuedMatchupLine {
  name: string;
  /** A swap: the rival whose head-to-head questions it replaces. */
  replaces?: string;
}

/** Read-only: the tracker's waves for the Run history dialog. Same access as
 * the project detail (read-level). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  const [runs, prompts, intents, flags, staff, rawQueue] = await Promise.all([
    store.listRuns(id),
    store.listPrompts(id),
    store.listIntents(id),
    store.listPromptFlags({ projectId: id }),
    isStaff(auth),
    store.getMatchupQueue(id),
  ]);
  const queue = parseMatchupQueue(rawQueue);
  // Queued for the next wave: one line above the list.
  const queuedNext = queue.entries
    .filter((e) => e.status === "queued")
    .map((e): QueuedMatchupLine => ({ name: e.rival.name, ...(e.drop ? { replaces: e.drop.name } : {}) }));
  const worryIds = worryPromptIds(prompts, intents);
  const source = project.codes_source;
  const gateOpen =
    project.taxonomy_status === "proposed" ||
    (project.taxonomy_status === "ratified" && project.dictionary_status !== "confirmed");
  // Oldest first for numbering; listRuns order is not assumed.
  const ordered = [...runs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const waves: WaveRow[] = await Promise.all(
    ordered.map(async (run, i) => {
      const [byModel, coded] = await Promise.all([
        store.countResponsesByModel(run.id),
        source && run.status === "collected"
          ? store.countAnswerCodes(run.id, source)
          : Promise.resolve(0),
      ]);
      const models = run.models.length > 0 ? run.models : [run.model];
      const repeats = Math.max(run.repeats, 1);
      const answers = Object.values(byModel).reduce((s, n) => s + n, 0);
      const finished = run.status === "collected" || run.status === "complete" || run.status === "failed";
      // While collecting, the wave's own question set; once collected, what
      // was actually asked (a later battery edit must not rewrite history).
      // A matchup that went live after this wave was created is not counted.
      const planned = promptsForRun(run, prompts, intents, matchupPromptsNotAsked(run, queue)).length;
      const asked = Math.round(Math.max(0, ...Object.values(byModel)) / repeats);
      const questions = finished && asked > 0 ? asked : planned;
      const byCompany = new Map<string, string[]>();
      const shortfalls: WaveRow["shortfalls"] = [];
      for (const m of models) {
        const e = getEngine(m);
        const name = e ? engineDisplayLabel(e) : m;
        const company = e ? vendorDisplay(e) : "Other";
        // Listed under its company, so "ChatGPT (free tier) + search" reads
        // "free tier + search" beside the "ChatGPT:" heading.
        const short = name.startsWith(company) ? name.slice(company.length).replace(/[()]/g, "").trim() : "";
        byCompany.set(company, [...(byCompany.get(company) ?? []), short || name]);
        const got = Math.round((byModel[m] ?? 0) / repeats);
        if (finished && questions > 0 && got < questions) shortfalls.push({ name, answered: got });
      }
      const state: WaveRow["state"] =
        run.status === "pending"
          ? "starting"
          : run.status === "running"
            ? "collecting"
            : run.status === "failed"
              ? "stopped"
              : run.status === "complete"
                ? "measured"
                : coded > 0
                  ? "measured"
                  : gateOpen
                    ? "review"
                    : "measuring";
      const mine = flags.filter((f) => f.run_id === run.id);
      const started = queue.entries.filter((e) => e.status === "live" && e.wentLiveRunId === run.id);
      const matchups = started.length
        ? {
            added: started.map((e) => e.rival.name),
            dropped: started.flatMap((e) => (e.mode === "swap" && e.drop ? [e.drop.name] : [])),
          }
        : null;
      return {
        id: run.id,
        number: i + 1,
        status: run.status,
        state,
        created_at: run.created_at,
        completed_at: run.completed_at,
        questions,
        repeats: run.repeats,
        assistants: [...byCompany].map(([company, names]) => ({ company, names })),
        assistantCount: models.length,
        shortfalls,
        answers,
        worries: worryIds.size === 0 ? null : runCarries(run, "worries"),
        flags: {
          replaced: mine.filter((f) => f.status === "replaced").length,
          kept: mine.filter((f) => f.status === "kept").length,
          open: mine.filter((f) => f.status === "open").length,
        },
        failed: run.status === "failed",
        ...(matchups ? { matchups } : {}),
        ...(staff ? { error: run.error, pipeline: run.pipeline } : {}),
      };
    })
  );
  return NextResponse.json({ waves: waves.reverse(), staff, canDelete: staff || !authEnabled(), queuedNext });
}
