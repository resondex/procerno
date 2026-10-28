import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computePremiumCached } from "@/lib/engine/premium";

/** The premium tier view (which end of the category the AI advocates, and who it recommends there) reads from answer_codes under
 * the project's codes_source. { view: null } = no codes source yet. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computePremiumCached(loaded.run, loaded.project);
  return NextResponse.json({ view });
}
