import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeAlternativesCached } from "@/lib/engine/alternatives";

/** The alternatives views (offensive capture, defensive hold) read from answer_codes under
 * the project's codes_source. { views: null } = no codes source yet. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const views = await computeAlternativesCached(loaded.run, loaded.project);
  return NextResponse.json({ views });
}
