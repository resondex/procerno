import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { viewRequestParams } from "@/lib/engine/view_data";
import { computeAnalysisMapCached, rivalPanelOf } from "@/lib/engine/analysis_map";

/** One rival across every question type (am31, panel 15 - the By rival
 * tab), read off the SAME cached map compute the /analysis_map route serves
 * (that route leaves these out). ?name= is the rival's name; ?engines= must
 * match the map's. Read-only; shared dashboards read it like the map.
 * { rival: null } = no codes source, or no such rival. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const view = await computeAnalysisMapCached(loaded.run, loaded.project, viewRequestParams(req));
  return NextResponse.json({ rival: view ? rivalPanelOf(view, name) : null });
}
