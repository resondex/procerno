import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeReasonsCached } from "@/lib/engine/reasons";

/** The reasons view (per-code incidence by question type and verdict) reads from answer_codes under
 * the project's codes_source. { view: null } = no codes source yet. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeReasonsCached(loaded.run, loaded.project);
  return NextResponse.json({ view });
}
