import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { store } from "@/lib/store";
import { driveAndChain, runInBackground } from "@/lib/engine/runner";
import { hasOpenBatches, pollRunBatches } from "@/lib/engine/batch";

export const maxDuration = 300;

/**
 * Hourly batch poller (see vercel.json): every running batch-pipeline run
 * with vendor batches outstanding gets polled - finished batches ingest,
 * then the ordinary driver mops up anything the batches missed and
 * finalizes. Keeps batch-run latency near the vendors' actual completion
 * time instead of the daily cron's.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const polled: string[] = [];
  for (const project of await store.listProjects()) {
    for (const run of await store.listRuns(project.id)) {
      if (run.status !== "running" || run.pipeline !== "batch") continue;
      if (!(await hasOpenBatches(run.id))) continue;
      polled.push(run.id);
      if (process.env.VERCEL) {
        waitUntil(pollRunBatches(run.id).then(() => driveAndChain(run.id, origin)));
      } else {
        void pollRunBatches(run.id).then(() => runInBackground(run.id));
      }
    }
  }
  return NextResponse.json({ ok: true, polled });
}
