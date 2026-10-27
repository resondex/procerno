import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeHeadlineCached } from "@/lib/engine/headline";

/** The headline view (open-choice answers only) read from answer_codes
 * under the project's codes_source. { view: null } = no codes source yet. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeHeadlineCached(loaded.run, loaded.project);
  return NextResponse.json({ view });
}
