import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { roomParam } from "@/lib/engine/view_data";
import { computeReasonsCached } from "@/lib/engine/reasons";

/** The reasons view (per-code incidence by question type and verdict) reads from answer_codes under
 * the project's codes_source. { view: null } = no codes source yet. ?room=<situation>
 * (Journey's buyer filter) keeps that room's cells only; absent = every buyer. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeReasonsCached(loaded.run, loaded.project, roomParam(req));
  return NextResponse.json({ view });
}
