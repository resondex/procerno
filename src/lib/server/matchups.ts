import { store } from "@/lib/store";
import { tagCosts, withCostContext } from "@/lib/cost_log";
import { generatePhrasings, regenerateCell, type Moderators } from "@/lib/engine/instrument";
import { ModeratorsShape } from "@/lib/engine/instrument_shapes";
import { instrumentRows, claimWriteLease, releaseWriteLease, editSetupLeaseKey } from "@/app/api/projects/instrument_write";
import {
  currentMatchups,
  parseMatchupQueue,
  planMatchup,
  type CurrentMatchup,
  type MatchupEntry,
  type MatchupQueue,
} from "@/lib/engine/matchups";
import { ANGLE_SLOTS } from "@/lib/engine/battery_checks";
import type { Project, PromptTheme } from "@/lib/types";

/**
 * The "Ask this matchup" route core (2026-11-13), written as functions
 * taking their writer as a dependency so the lifecycle can be exercised with
 * a stub (the real writer spends: regenerateCell + generatePhrasings, ledger
 * purpose matchup:write, production, project-attributed).
 *
 * Confirm writes the questions NOW - one comparison cell (brand vs rival),
 * a seed plus nine order-balanced paraphrases, through the same writer and
 * checks setup uses - and stores them hidden (Store.insertHiddenPrompts)
 * beside the stored instrument: nothing existing is redrawn or re-keyed.
 * The queue entry carries the intent row, inserted only when the next run's
 * creation makes the matchup live (engine/matchups.ts).
 */

export const MATCHUP_PROMPTS = 10;

export class MatchupError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface WrittenMatchup {
  seed: string;
  /** Exactly MATCHUP_PROMPTS - 1 paraphrases. */
  phrasings: { text: string; asker: string | null }[];
}

export type MatchupWriter = (input: { project: Project; rival: { id: string; name: string }; competitors: string[] }) => Promise<WrittenMatchup>;

export interface MatchupState {
  queue: MatchupEntry[];
  current: CurrentMatchup[];
  slots: number;
  feePerWave: number;
}

async function loadInstrument(projectId: string) {
  const [intents, prompts, dictionary, raw] = await Promise.all([
    store.listIntents(projectId),
    store.listPrompts(projectId),
    store.getDictionary(projectId),
    store.getMatchupQueue(projectId),
  ]);
  return { intents, prompts, dictionary, raw, queue: parseMatchupQueue(raw), current: currentMatchups(intents, prompts, dictionary) };
}

export async function matchupState(projectId: string, feePerWave: number): Promise<MatchupState> {
  const { queue, current } = await loadInstrument(projectId);
  return { queue: queue.entries, current, slots: ANGLE_SLOTS, feePerWave };
}

/**
 * Queue one matchup. Validates, writes the questions (outside any lease -
 * it takes minutes), then re-validates and commits under the tracker's
 * edit-setup lease (the lease run creation holds), so a concurrent queue
 * edit or run creation can never interleave with the write. On any refusal
 * after writing, the hidden prompts are deleted again.
 */
export async function queueMatchup(
  deps: { write: MatchupWriter },
  input: { project: Project; rivalId: string; mode: "add" | "swap"; dropId?: string | null; feePerWave: number; feeConfirmed?: number | null; userId: string | null }
): Promise<{ entry: MatchupEntry; state: MatchupState }> {
  const { project } = input;
  const plan = (inst: Awaited<ReturnType<typeof loadInstrument>>) =>
    planMatchup({ project, dictionary: inst.dictionary, current: inst.current, queue: inst.queue, rivalId: input.rivalId, mode: input.mode, dropId: input.dropId, feePerWave: input.feePerWave });
  const first = plan(await loadInstrument(project.id));
  if (!first.ok) throw new MatchupError(first.status, first.error);
  // The fee the user confirmed must be the fee we record.
  if (first.fee > 0 && input.feeConfirmed !== first.fee) throw new MatchupError(409, `Adding this matchup costs $${first.fee} per wave - confirm the fee to queue it.`);
  const competitors = project.competitors.some((c) => c.trim().toLowerCase() === first.rival.name.trim().toLowerCase())
    ? project.competitors
    : [...project.competitors, first.rival.name];
  let written: WrittenMatchup;
  try {
    written = await deps.write({ project, rival: first.rival, competitors });
  } catch (err) {
    if (err instanceof MatchupError) throw err;
    console.error(`matchup write failed (${project.brand} vs ${first.rival.name}):`, err);
    throw new MatchupError(502, "The questions could not be written - nothing was queued. Try again in a moment.");
  }
  const texts = [written.seed, ...written.phrasings.map((p) => p.text)].map((t) => t.trim());
  if (written.phrasings.length !== MATCHUP_PROMPTS - 1 || texts.some((t) => !t) || new Set(texts.map((t) => t.toLowerCase())).size !== MATCHUP_PROMPTS)
    throw new MatchupError(502, "The questions could not be written in full - nothing was queued. Try again in a moment.");

  const intentId = crypto.randomUUID();
  // Its alias read is the cache entry the writer just made; ledgered with it.
  const [row] = await withCostContext({ projectId: project.id, purpose: "matchup:write", rnd: false }, () =>
    instrumentRows(
      [{ stage: "comparison", layer: "decision", situation: null, angle: first.rival.name, mode: null, text: written.seed, phrasings: written.phrasings.map((p) => ({ text: p.text, ...(p.asker ? { asker: p.asker } : {}) })) }],
      project.brand,
      competitors,
      project.category
    )
  );
  const promptIds = await store.insertHiddenPrompts(
    project.id,
    row.prompts.map((p) => ({ text: p.text, theme: p.theme as PromptTheme, intentId, asker: p.asker }))
  );
  const leaseKey = editSetupLeaseKey(project.id);
  const lease = await claimWriteLease(leaseKey);
  if (!lease) {
    await store.deleteHiddenPrompts(project.id, promptIds);
    throw new MatchupError(409, "This tracker is busy (a run is starting or its setup is being saved) - nothing was queued. Try again in a moment.");
  }
  try {
    const inst = await loadInstrument(project.id);
    const again = plan(inst);
    if (!again.ok || again.fee !== first.fee || again.mode !== first.mode) {
      await store.deleteHiddenPrompts(project.id, promptIds);
      throw new MatchupError(again.ok ? 409 : again.status, again.ok ? "The matchups changed while the questions were written - nothing was queued. Try again." : again.error);
    }
    const entry: MatchupEntry = {
      id: crypto.randomUUID(),
      rival: again.rival,
      mode: again.mode,
      ...(again.drop ? { drop: again.drop } : {}),
      fee_usd: again.fee,
      queuedAt: new Date().toISOString(),
      queuedBy: input.userId,
      promptIds,
      questions: row.prompts.map((p) => p.text),
      intent: { id: intentId, ...row.intent, mode: row.intent.mode ?? null, qtype: row.intent.qtype ?? null, concern: row.intent.concern ?? null },
      status: "queued",
    };
    const next: MatchupQueue = { version: 1, entries: [...inst.queue.entries, entry] };
    await store.setMatchupQueue(project.id, JSON.stringify(next));
    return { entry, state: { queue: next.entries, current: inst.current, slots: ANGLE_SLOTS, feePerWave: input.feePerWave } };
  } finally {
    await releaseWriteLease(leaseKey, lease);
  }
}

/** Undo a QUEUED matchup: its hidden prompts and the entry go. A live one stays. */
export async function undoMatchup(projectId: string, entryId: string, feePerWave: number): Promise<MatchupState> {
  const leaseKey = editSetupLeaseKey(projectId);
  const lease = await claimWriteLease(leaseKey);
  if (!lease) throw new MatchupError(409, "This tracker is busy (a run is starting or its setup is being saved). Try again in a moment.");
  try {
    const inst = await loadInstrument(projectId);
    const entry = inst.queue.entries.find((e) => e.id === entryId);
    if (!entry) throw new MatchupError(404, "That matchup is not queued.");
    if (entry.status !== "queued") throw new MatchupError(409, "That matchup is already being asked - it can no longer be undone here.");
    await store.deleteHiddenPrompts(projectId, entry.promptIds);
    const entries = inst.queue.entries.filter((e) => e.id !== entryId);
    await store.setMatchupQueue(projectId, entries.length ? JSON.stringify({ version: 1, entries }) : null);
    return { queue: entries, current: inst.current, slots: ANGLE_SLOTS, feePerWave };
  } finally {
    await releaseWriteLease(leaseKey, lease);
  }
}

/**
 * The real writer: the setup's own cell writer and paraphrase writer for one
 * comparison entity cell (invariant - no buying situation), with the
 * tracker's stored market read. Every model call is ledgered as
 * matchup:write against the project (production spend: the customer's
 * click). No key, a null draw, a flagged seed or a short paraphrase set is
 * an error and nothing is queued.
 */
export const realMatchupWriter: MatchupWriter = async ({ project, rival, competitors }) => {
  if (!process.env.OPENAI_API_KEY || !process.env.ANTHROPIC_API_KEY)
    throw new MatchupError(503, "The questions cannot be written right now (the writer is not configured here) - nothing was queued.");
  let base: Moderators;
  try {
    const parsed = ModeratorsShape.safeParse(JSON.parse(project.moderators ?? "null"));
    if (!parsed.success) throw new Error("invalid");
    base = parsed.data as Moderators;
  } catch {
    throw new MatchupError(409, "This tracker's setup cannot be read, so the questions cannot be written here.");
  }
  return withCostContext({ projectId: project.id, purpose: "matchup:write", rnd: false }, async () => {
    tagCosts({ projectId: project.id, purpose: "matchup:write", rnd: false });
    const common = {
      brand: project.brand,
      category: project.category,
      competitors,
      audience: project.audience ?? null,
      base,
      // A head-to-head is invariant (no buying situation): no rooms needed.
      scenarios: [],
      meta: { brand: project.brand, source: "matchup" },
      purpose: "matchup:write",
    };
    const cell = { stage: "comparison", situation: null, angle: rival.name, mode: null };
    const seed = await regenerateCell({ ...common, cell, avoid: [] });
    if (!seed || seed.flags?.length)
      throw new MatchupError(502, "No question passed the checks for this matchup - nothing was queued. Try again in a moment.");
    const [set] = await generatePhrasings({
      ...common,
      cells: [{ ...cell, text: seed.text, spec: seed.spec }],
      count: MATCHUP_PROMPTS,
    });
    const phrasings = (set ?? []).map((p) => ({ text: p.text, asker: p.asker || null }));
    if (phrasings.length !== MATCHUP_PROMPTS - 1)
      throw new MatchupError(502, "The full set of questions could not be written for this matchup - nothing was queued. Try again in a moment.");
    return { seed: seed.text, phrasings };
  });
};
