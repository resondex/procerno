import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { viewRequestParams } from "@/lib/engine/view_data";
import { computePortfolioCached } from "@/lib/engine/portfolio";

/** The company rollup of the headline pool (open-choice answers only), read
 * from answer_codes under the project's codes_source and grouped by the
 * dictionary's parent labels. { view: null } = no codes source yet.
 * ?engines= narrows the core panel; ?room= keeps one room's cells. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computePortfolioCached(loaded.run, loaded.project, viewRequestParams(req));
  return NextResponse.json({ view });
}
