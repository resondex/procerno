import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeBrandSummaryCached } from "@/lib/engine/brand_summary";
import { viewRequestParams } from "@/lib/engine/view_data";

/** The brand summary feeding the Boardroom and Five-questions views, read
 * from answer_codes under the project's codes_source. { view: null } = no
 * codes source yet. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeBrandSummaryCached(loaded.run, loaded.project, viewRequestParams(req));
  return NextResponse.json({ view });
}
