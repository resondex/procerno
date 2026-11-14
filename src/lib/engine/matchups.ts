import { store } from "../store";
import { buildResolver } from "./brand_resolve";
import { ANGLE_SLOTS } from "./battery_checks";
import type { DictionaryEntry, Intent, Prompt } from "../types";

/**
 * "Ask this matchup" (2026-11-13): the customer asks for a direct matchup
 * against a rival the run never put beside them. The questions are written
 * at the click and stored HIDDEN (prompts.staged = 1 with no `replaces` -
 * see Store.insertHiddenPrompts) until the next run's creation, where
 * activateQueuedMatchups (called from surfaces.planRunSurfaces, THE
 * run-creation choke point) makes them live and, for a swap, retires the
 * dropped rival's head-to-head questions. The intent row is inserted only
 * at go-live (its fields ride the queue entry), so no reader of
 * store.listIntents ever sees a queued matchup either.
 *
 * The queue lives on projects.matchup_queue (JSON). Every write happens
 * under the tracker's edit-setup lease, the same lease run creation holds
 * around createRun, so a queue edit can never cross a run being created.
 */

export interface MatchupIntent {
  id: string;
  stage: string;
  layer: string;
  situation: string | null;
  angle: string;
  mode: string | null;
  qtype: string | null;
  concern: string | null;
  text: string;
}

export interface MatchupEntry {
  id: string;
  /** The rival: its dictionary entry id and display name. */
  rival: { id: string; name: string };
  mode: "add" | "swap";
  /** A swap's dropped matchup: its rival and the intent angles carrying it. */
  drop?: { id: string; name: string; angles: string[] };
  /** Recorded at confirm; nothing is charged (no billing system exists). */
  fee_usd: number;
  queuedAt: string;
  queuedBy: string | null;
  promptIds: string[];
  /** The written questions, seed first (the queued state's "See the questions"). */
  questions: string[];
  /** The head-to-head intent, inserted at go-live with this id. */
  intent: MatchupIntent;
  status: "queued" | "live";
  wentLiveAt?: string;
  wentLiveRunId?: string | null;
}

export interface MatchupQueue {
  version: 1;
  entries: MatchupEntry[];
}

export function parseMatchupQueue(json: string | null | undefined): MatchupQueue {
  if (!json) return { version: 1, entries: [] };
  try {
    const q = JSON.parse(json) as Partial<MatchupQueue>;
    return { version: 1, entries: Array.isArray(q.entries) ? q.entries.filter((e) => e && typeof e.id === "string") : [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

/** One live head-to-head matchup of the instrument. */
export interface CurrentMatchup {
  /** The rival's dictionary entry id, or "?" + angle when it resolves to none. */
  key: string;
  name: string;
  angles: string[];
}

/**
 * The tracker's live ENTITY matchups: comparison intents (class cells left
 * out) with at least one live, non-retired prompt, grouped by the rival
 * the angle resolves to. `prompts` is store.listPrompts (hidden ones are
 * never in it).
 */
export function currentMatchups(intents: Intent[], prompts: Prompt[], dictionary: DictionaryEntry[]): CurrentMatchup[] {
  const live = new Set(prompts.filter((p) => !p.retired && p.intent_id).map((p) => p.intent_id!));
  const resolve = buildResolver(dictionary);
  const out = new Map<string, CurrentMatchup>();
  for (const i of intents) {
    if (i.stage !== "comparison" || i.angle === "class" || !live.has(i.id)) continue;
    const r = resolve(i.angle);
    const key = r.status === "active" ? r.key : `?${i.angle.trim().toLowerCase()}`;
    const m = out.get(key) ?? { key, name: r.status === "active" ? r.name : i.angle, angles: [] };
    if (!m.angles.includes(i.angle)) m.angles.push(i.angle);
    out.set(key, m);
  }
  return [...out.values()];
}

export type PlanResult =
  | { ok: true; rival: { id: string; name: string }; mode: "add" | "swap"; drop?: { id: string; name: string; angles: string[] }; fee: number }
  | { ok: false; status: number; error: string };

/**
 * Validate a request against the instrument and the queue. Under
 * ANGLE_SLOTS live-or-queued matchups an add is included (fee 0); at the
 * cap an add carries `feePerWave` and a swap names a current matchup to
 * stop asking.
 */
export function planMatchup(input: {
  project: { brand: string };
  dictionary: DictionaryEntry[];
  current: CurrentMatchup[];
  queue: MatchupQueue;
  rivalId: string;
  mode: "add" | "swap";
  dropId?: string | null;
  feePerWave: number;
}): PlanResult {
  const resolve = buildResolver(input.dictionary);
  const target = resolve(input.project.brand);
  const entry = input.dictionary.find((e) => e.id === input.rivalId);
  if (!entry || entry.status !== "active") return { ok: false, status: 404, error: "That brand is not on your board." };
  if (target.status === "active" && target.key === entry.id) return { ok: false, status: 400, error: "That is your own brand." };
  const name = entry.display_name ?? entry.canonical;
  if (input.current.some((m) => m.key === entry.id)) return { ok: false, status: 409, error: `${name} already has a matchup.` };
  const queued = input.queue.entries.filter((e) => e.status === "queued");
  if (queued.some((e) => e.rival.id === entry.id)) return { ok: false, status: 409, error: `${name} is already queued for the next collection.` };
  const dropping = new Set(queued.flatMap((e) => (e.drop ? [e.drop.id] : [])));
  const inUse = input.current.filter((m) => !dropping.has(m.key)).length + queued.filter((e) => e.mode === "add").length;
  const free = inUse < ANGLE_SLOTS;
  if (input.mode === "add") return { ok: true, rival: { id: entry.id, name }, mode: "add", fee: free ? 0 : input.feePerWave };
  const drop = input.current.find((m) => m.key === input.dropId);
  if (!drop) return { ok: false, status: 400, error: "Choose the matchup to stop asking." };
  if (dropping.has(drop.key)) return { ok: false, status: 409, error: `${drop.name} is already being swapped out.` };
  return { ok: true, rival: { id: entry.id, name }, mode: "swap", drop: { id: drop.key, name: drop.name, angles: drop.angles }, fee: 0 };
}

/**
 * Run creation: every queued matchup goes live - its intent inserted, its
 * hidden prompts made live, a swap's dropped questions retired - in one
 * store transaction guarded by the queue it read (a concurrent activation
 * finds the queue changed and does nothing). Idempotent: a second call
 * finds no queued entries. Returns how many went live.
 */
export async function activateQueuedMatchups(projectId: string): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await store.getMatchupQueue(projectId);
    const queue = parseMatchupQueue(raw);
    const queued = queue.entries.filter((e) => e.status === "queued");
    if (queued.length === 0) return 0;
    const [intents, prompts] = await Promise.all([store.listIntents(projectId), store.listPrompts(projectId)]);
    const retire = new Set<string>();
    for (const e of queued) {
      if (!e.drop) continue;
      const angles = new Set(e.drop.angles);
      const ids = new Set(intents.filter((i) => i.stage === "comparison" && angles.has(i.angle)).map((i) => i.id));
      for (const p of prompts) if (!p.retired && p.intent_id && ids.has(p.intent_id)) retire.add(p.id);
    }
    const now = new Date().toISOString();
    const next: MatchupQueue = {
      version: 1,
      entries: queue.entries.map((e) => (e.status === "queued" ? { ...e, status: "live", wentLiveAt: now, wentLiveRunId: null } : e)),
    };
    const ok = await store.activateMatchups(projectId, {
      expectQueue: raw,
      nextQueue: JSON.stringify(next),
      intents: queued.map((e) => e.intent),
      livePromptIds: queued.flatMap((e) => e.promptIds),
      retirePromptIds: [...retire],
    });
    if (ok) return queued.length;
  }
  return 0;
}

/** Both store drivers emit UTC; sqlite omits the T and Z ("YYYY-MM-DD
 * HH:MM:SS"), postgres has them. Lives here (not surfaces.ts) so both
 * modules can use it without a circular import. */
export function utcMs(ts: string): number {
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z").getTime();
}

/** How far before a matchup's go-live stamp a run may be created and still
 * count as the go-live run: wentLiveAt is app time with milliseconds, a
 * run's created_at is the database clock (whole seconds on sqlite), and
 * createRun follows activation under the same lease. Runs are one open wave
 * at a time, so no earlier wave sits inside this window in practice. */
export const GO_LIVE_SLACK_MS = 60_000;

/**
 * The live matchup prompts a run did NOT ask: a queued matchup's ten prompts
 * become ordinary live prompts at go-live, so every reader of
 * surfaces.promptsForRun would otherwise count them for waves created before
 * it (progress denominators, Run history, the question check) - and an
 * older run still collecting would start asking them. A run asks an entry's
 * prompts iff it is the stamped go-live run, or it was created at or after
 * the go-live (less GO_LIVE_SLACK_MS). Empty when nothing has gone live, so
 * every caller is unchanged on a tracker with no matchups.
 */
export function matchupPromptsNotAsked(run: { id: string; created_at: string }, queue: MatchupQueue): Set<string> {
  const out = new Set<string>();
  const runMs = utcMs(run.created_at);
  for (const e of queue.entries) {
    if (e.status !== "live" || !e.wentLiveAt) continue;
    if (e.wentLiveRunId && e.wentLiveRunId === run.id) continue;
    if (Number.isFinite(runMs) && runMs >= utcMs(e.wentLiveAt) - GO_LIVE_SLACK_MS) continue;
    for (const id of e.promptIds) out.add(id);
  }
  return out;
}

/** Same, reading the tracker's queue (one store read). */
export async function loadMatchupPromptsNotAsked(run: { id: string; project_id: string; created_at: string }): Promise<Set<string>> {
  return matchupPromptsNotAsked(run, parseMatchupQueue(await store.getMatchupQueue(run.project_id)));
}

/** After createRun: stamp the run on matchups that went live with no run
 * yet (a createRun that failed after activation is stamped by the next). */
export async function noteMatchupRun(projectId: string, runId: string): Promise<void> {
  const raw = await store.getMatchupQueue(projectId);
  const queue = parseMatchupQueue(raw);
  if (!queue.entries.some((e) => e.status === "live" && !e.wentLiveRunId)) return;
  queue.entries = queue.entries.map((e) => (e.status === "live" && !e.wentLiveRunId ? { ...e, wentLiveRunId: runId } : e));
  await store.setMatchupQueue(projectId, JSON.stringify(queue));
}
