import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { viewRequestParams } from "@/lib/engine/view_data";
import { cellPanelOf, computeAnalysisMapCached } from "@/lib/engine/analysis_map";

/** One map cell's panel (am31), its rival panels included, with its usual
 * cell's steps - read off the SAME cached map compute the /analysis_map route
 * serves (that route leaves the panel bodies out). ?cell= is the position id;
 * ?engines= must match the map's. Read-only; shared dashboards read it like
 * the map itself. { panel: null } = no codes source, no such cell, or a cell
 * that draws the older panel. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const cell = new URL(req.url).searchParams.get("cell");
  if (!cell) return NextResponse.json({ error: "cell is required" }, { status: 400 });
  const view = await computeAnalysisMapCached(loaded.run, loaded.project, viewRequestParams(req));
  return NextResponse.json(view ? cellPanelOf(view, cell) : { panel: null });
}
