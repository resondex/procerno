import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { requireAuth, requireProject } from "@/lib/auth";
import { dashboardRun, readHealthRecord } from "@/lib/engine/prompt_health";

/**
 * Whether the prompt health check ran on a wave (2026-11-11). ?run=<id> asks
 * about that run (it must belong to the project); absent = the run the
 * dashboard shows (latest complete, else the coded run held at collected).
 * { run: null } = nothing measured yet; { record: null } = never checked on
 * that wave. Read-only, no model call.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  const asked = new URL(req.url).searchParams.get("run");
  let run = asked ? await store.getRun(asked) : await dashboardRun(project.id);
  if (run && run.project_id !== project.id) run = null;
  if (!run) return NextResponse.json({ run: null, record: null });
  const record = await readHealthRecord(run.id);
  return NextResponse.json({ run: { id: run.id, status: run.status }, record });
}
