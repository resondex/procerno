import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { viewRequestParams } from "@/lib/engine/view_data";
import { computeBriefCached } from "@/lib/engine/brief";

/** The Brief pill (bf1): all seven memo frames for one subject brand,
 * composed as finished sentences. ?subject=<brand> (absent = the tracker's
 * own brand) and ?engines=a,b,c (the Panel lens). { view: null } = no codes
 * source yet. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const { engines } = viewRequestParams(req);
  const subject = new URL(req.url).searchParams.get("subject") ?? undefined;
  const view = await computeBriefCached(loaded.run, loaded.project, { ...(engines ? { engines } : {}), ...(subject ? { subject } : {}) });
  return NextResponse.json({ view });
}
