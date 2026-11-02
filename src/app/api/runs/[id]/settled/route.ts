import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeSettledCached } from "@/lib/engine/settled";

/** The settled-customer verdict cards (business case, expansion, ecosystem,
 * advocacy). { view: null } = no codes source yet. Asked across all buyers,
 * so no room filter. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeSettledCached(loaded.run, loaded.project);
  return NextResponse.json({ view });
}
