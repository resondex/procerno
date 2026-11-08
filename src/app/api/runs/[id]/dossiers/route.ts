import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeDossiersCached } from "@/lib/engine/dossiers";
import { viewRequestParams } from "@/lib/engine/view_data";

/** The brand dossiers (the Rivals pill, do1): one standing page per rival
 * brand, read from answer_codes under the project's codes_source.
 * ?engines=a,b,c (the Panel lens). { view: null } = no codes source yet. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeDossiersCached(loaded.run, loaded.project, viewRequestParams(req));
  return NextResponse.json({ view });
}
