import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { store } from "@/lib/store";
import { getAuth, isShareContext, requireProject } from "@/lib/auth";
import { claimRunLease, driveAndChain, releaseRunLease, runInBackground } from "@/lib/engine/runner";
import { hasOpenBatches, pollRunBatches } from "@/lib/engine/batch";

/** How long a waiting batch run sleeps between checks on its vendor
 * batches - inside one invocation, well under maxDuration, and the drive
 * that follows runs in a fresh invocation of its own. */
const WAIT_MS = 150_000;

export const maxDuration = 800;

/**
 * Process the next chunk of an unfinished run. Reached two ways: the chunk
 * chain calls it server-to-server bearing CRON_SECRET (no cookies exist on
 * that path), and a member with write access can call it to resume a stuck
 * run (never a share link or a read-only member).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await store.getRun(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const secret = process.env.CRON_SECRET;
  const chainAuthorized =
    Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!chainAuthorized) {
    const auth = await getAuth();
    if (!auth) {
      return NextResponse.json({ error: "sign in required" }, { status: 401 });
    }
    // Driving or finalizing a run spends (collection, junk filter,
    // suggestions) and can mark a held run complete: write-level access
    // only. A share link is read-only and never reaches this; a read-only
    // org member gets requireProject's 403.
    if (isShareContext(auth)) {
      return NextResponse.json({ error: "read-only link" }, { status: 403 });
    }
    const project = await requireProject(run.project_id, auth, { write: true });
    if (project instanceof NextResponse) return project;
  }

  if (run.status === "complete" || run.status === "failed") {
    return NextResponse.json({ run });
  }
  const origin = new URL(req.url).origin;
  // Wait hop (chain-only): a batch run with vendor batches out sleeps,
  // polls them, then hands back to a fresh drive invocation. The loop ends
  // by itself: once no batch is open the drive never returns "waiting"
  // again, and the vendors close every batch within 24h.
  // One waiter per run: every trigger that ends in "waiting" (the
  // dashboard's poll included) asks for a wait hop; extra ones exit here.
  if (chainAuthorized && new URL(req.url).searchParams.get("wait") === "1") {
    const leaseKey = `run_wait:${id}`;
    const token = await claimRunLease(leaseKey).catch(() => null);
    if (!token) return NextResponse.json({ waiting: "already" }, { status: 202 });
    const work = (async () => {
      try {
        await new Promise((r) => setTimeout(r, WAIT_MS));
        const current = await store.getRun(id);
        if (!current || current.status !== "running") return;
        if (await hasOpenBatches(id)) await pollRunBatches(id);
      } finally {
        await releaseRunLease(leaseKey, token);
      }
      await fetch(`${origin}/api/runs/${id}/continue`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
    })().catch((err) => console.error(`wait hop failed for run ${id}:`, err));
    if (process.env.VERCEL) waitUntil(work);
    return NextResponse.json({ waiting: true }, { status: 202 });
  }
  if (process.env.VERCEL) {
    waitUntil(driveAndChain(id, origin));
  } else {
    void runInBackground(id);
  }
  return NextResponse.json({ resumed: true }, { status: 202 });
}
