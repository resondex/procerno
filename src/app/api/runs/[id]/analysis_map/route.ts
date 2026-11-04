import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { viewRequestParams } from "@/lib/engine/view_data";
import { computeAnalysisMapCached } from "@/lib/engine/analysis_map";

/** The analysis map (verdict, banded coverage map, positions) read from
 * answer_codes under the project's codes_source. { view: null } = no codes
 * source yet. ?engines= narrows the engine panel; the map embeds every room,
 * so it takes no room filter. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeAnalysisMapCached(loaded.run, loaded.project, viewRequestParams(req));
  return NextResponse.json({ view });
}
