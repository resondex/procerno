import { NextResponse } from "next/server";
import { getAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { queueUnresolvedNames, runPostQueueSteps } from "@/lib/engine/dict_queue";
import { tagCosts } from "@/lib/cost_log";

// Junk filter + up to 60s suggestions warm + up to 60s examples warm.
export const maxDuration = 300;

/** Queue the brand names a coded run carries that the dictionary cannot
 * place onto the brand board's pending queue (dict_queue.ts). For runs
 * coded outside finalize (a coded-held run, finalize never ran); finalize
 * does the same itself. Idempotent; the queue itself makes no model call,
 * and the post-queue steps (junk filter, suggestions + examples warm) run
 * only when this call queued new names. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const body = (await req.json().catch(() => null)) as { runId?: unknown } | null;
  const runId = typeof body?.runId === "string" ? body.runId : "";
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
  const run = await store.getRun(runId);
  if (!run || run.project_id !== id) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  const source = await store.getCodesSource(id);
  if (!source || (await store.countAnswerCodes(runId, source)) === 0) {
    return NextResponse.json({ error: "run has no codes under this tracker's codes source" }, { status: 409 });
  }
  const result = await queueUnresolvedNames(project, run);
  // Finalize's post-queue steps, so a coded-held run never judges live
  // during review. Only when this call queued something: a repeat call
  // queues nothing and spends nothing (idempotent). Never fails the call.
  if (result.queued > 0) {
    tagCosts({ projectId: id, runId, purpose: "run:dictionary" });
    try {
      await runPostQueueSteps(project, {
        suggestDeadline: Date.now() + 60_000,
        examplesBudgetMs: 60_000,
      });
    } catch (err) {
      console.error("queue_unresolved post-queue steps failed:", err);
    }
  }
  return NextResponse.json({ ok: true, ...result });
}
