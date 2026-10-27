import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeHeadToHeadCached } from "@/lib/engine/head_to_head";

/** The head-to-head views (entity and class) read from answer_codes under
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
  const views = await computeHeadToHeadCached(loaded.run, loaded.project);
  return NextResponse.json({ views });
}
