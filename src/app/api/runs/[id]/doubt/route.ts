import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeDoubtCached } from "@/lib/engine/doubt";

/** The doubt views (objections, churn and renewal keep-or-leave) read from answer_codes under
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
  const views = await computeDoubtCached(loaded.run, loaded.project);
  return NextResponse.json({ views });
}
