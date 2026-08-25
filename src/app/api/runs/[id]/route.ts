import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { store } from "@/lib/store";
import { requireAuth, requireRun } from "@/lib/auth";
import { hasOpenBatches, pollRunBatches } from "@/lib/engine/batch";
import { driveAndChain } from "@/lib/engine/runner";

/** Per-run throttle for the opportunistic batch poll below (Hobby-plan
 * crons are daily, so the dashboard's own progress polling stands in as
 * the fast path). In-memory per instance is fine: worst case a second
 * instance polls too, and ingest skips already-stored answers. */
const lastPoll = new Map<string, number>();
const POLL_EVERY_MS = 60_000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const { run } = loaded;
  // A batch-pipeline run being watched from the dashboard: check its
  // vendor batches opportunistically so ingestion tracks completion time
  // rather than the daily cron.
  if (run.status === "running" && run.pipeline === "batch") {
    const last = lastPoll.get(run.id) ?? 0;
    if (Date.now() - last > POLL_EVERY_MS && (await hasOpenBatches(run.id))) {
      lastPoll.set(run.id, Date.now());
      const origin = new URL(_req.url).origin;
      waitUntil(pollRunBatches(run.id).then(() => driveAndChain(run.id, origin)));
    }
  }
  const [prompts, completed, byModel] = await Promise.all([
    store.listPrompts(run.project_id),
    store.countResponses(id),
    store.countResponsesByModel(id),
  ]);
  const liveCount = prompts.filter((p) => !p.retired).length;
  const models = run.models.length > 0 ? run.models : [run.model];
  // Each engine answers every live prompt once per repeat, so they share one
  // per-engine target. Progress is honest only against that denominator.
  const perEngineTotal = liveCount * run.repeats;
  return NextResponse.json({
    run,
    completed,
    total: perEngineTotal * Math.max(models.length, 1),
    promptCount: liveCount,
    perEngineTotal,
    perEngine: models.map((m) => ({
      model: m,
      completed: byModel[m] ?? 0,
    })),
  });
}

/** Delete a run and its data. Prompts, dictionary, and other runs stay. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth, { write: true });
  if (loaded instanceof NextResponse) return loaded;
  if (loaded.run.status === "running" || loaded.run.status === "pending") {
    return NextResponse.json(
      { error: "stop is not supported — wait for the run to finish first" },
      { status: 409 }
    );
  }
  await store.deleteRun(id);
  return NextResponse.json({ ok: true });
}
