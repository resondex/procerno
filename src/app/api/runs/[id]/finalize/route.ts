import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { store } from "@/lib/store";
import { getAuth, isShareContext, requireProject } from "@/lib/auth";
import { finalizeRun } from "@/lib/engine/runner";

export const maxDuration = 300;

/**
 * Close out a run whose answers have all landed: dictionary queue, junk
 * filter, Identify suggestions, prompt health, then mark it complete. Runs in
 * its own invocation so this work gets a full budget instead of whatever the
 * last collection chunk had left. Reached by the chunk chain bearing
 * CRON_SECRET, or by a member with write access resuming a run stuck in
 * finalizing (never a share link or a read-only member).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await store.getRun(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const secret = process.env.CRON_SECRET;
  const chainAuthorized =
    Boolean(secret) &&
    _req.headers.get("authorization") === `Bearer ${secret}`;
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

  if (process.env.VERCEL) {
    waitUntil(finalizeRun(id));
  } else {
    await finalizeRun(id);
  }
  return NextResponse.json({ ok: true });
}
