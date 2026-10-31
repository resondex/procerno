import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { computeRulesCached } from "@/lib/engine/rules_explorer";

// A whole run's conditions are embedded and grouped in one pass on a cold
// cache (plus the context judge's slab) - well over the default budget.
export const maxDuration = 300;

/** The decision-rules explorer reads from answer_codes under the project's
 * codes_source. { view: null } = no codes source yet. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeRulesCached(loaded.run, loaded.project);
  return NextResponse.json({ view });
}
