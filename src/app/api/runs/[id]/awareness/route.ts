import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeAwarenessCached } from "@/lib/engine/awareness";

/** The awareness views (problem recognition routing, category education explainer) read from answer_codes under
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
  const view = await computeAwarenessCached(loaded.run, loaded.project);
  return NextResponse.json({ view });
}
