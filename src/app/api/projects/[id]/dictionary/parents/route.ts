import { NextResponse } from "next/server";
import { canWrite, isShareContext, projectAccess, requireAuth, requireProject } from "@/lib/auth";
import { suggestParents } from "@/lib/engine/parent_suggest";

export const maxDuration = 120;

/**
 * Suggested parent-company groups for the Parents tab (parent_suggest.ts).
 * Cache-first; only a member with write-level access may send never-seen
 * names to the model (pennies, ledger purpose dict:parents). Share-link
 * viewers and read-only members get cached and setup verdicts only.
 * Nothing is applied here - Accept posts set_parent to the dictionary.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  const allowModel = !isShareContext(auth) && canWrite(await projectAccess(project, auth));
  const out = await suggestParents(project, { allowModel, deadlineMs: Date.now() + 100_000 });
  return NextResponse.json(out);
}
