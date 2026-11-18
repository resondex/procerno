import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { viewRequestParams } from "@/lib/engine/view_data";
import { computeJourney } from "@/lib/engine/journey";

/** The Stations view (Question type detail): six stations, every number a fact
 * from the run's one fact book, cached per (buyer filter, engine set). { view: null } = no codes source yet.
 * ?room=<situation> filters the room-pinned stations to that buyer; the
 * all-buyers measurements come back unfiltered and flagged invariant. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeJourney(loaded.run, loaded.project, viewRequestParams(req));
  return NextResponse.json({ view });
}
