import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/store";
import {
  isStaff,
  getPlanFor,
  requireAuth,
  requireProject,
  PLAN_TRACKER_LIMITS,
} from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  // Dictionary rides along: the page needs it on every load, and a
  // separate fetch pays a second function invocation and auth handshake
  // in series - the visible lag between layout and live buttons.
  const [prompts, runs, staff, dictionary] = await Promise.all([
    store.listPrompts(id),
    store.listRuns(id),
    isStaff(auth),
    store.getDictionary(id),
  ]);
  // Drives whether staff-only switches are rendered at all. The PATCH route
  // enforces the same check, so a hidden control is a courtesy, not the gate.
  return NextResponse.json({
    project,
    prompts,
    runs,
    staff,
    dictionary,
  });
}

const patchSchema = z.object({
  schedule: z.enum(["none", "weekly", "monthly"]).optional(),
  /** Editing the core engine panel is an epoch change for the trend. */
  engines: z.array(z.string().trim().min(1)).min(1).max(8).optional(),
  /** Per-project availability of the evidence drawer. */
  evidenceDrawer: z.boolean().optional(),
  /** Staff-only: let human labels override the coder. */
  humanOverride: z.boolean().optional(),
  /** Archive (true) or unarchive (false). Trackers are never deleted from
   * the app - archiving hides them and stops runs, all data kept. */
  archived: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid schedule" }, { status: 400 });
  }
  if (parsed.data.archived === false && project.archived_at && auth.userId !== null) {
    // Unarchiving brings the tracker back under the plan's tracker limit.
    const plan = await getPlanFor(auth);
    const active = (await store.listProjects(auth.userId)).filter(
      (p) => !p.archived_at && p.id !== id
    );
    if (active.length >= PLAN_TRACKER_LIMITS[plan]) {
      return NextResponse.json(
        {
          error: `The ${plan} plan includes ${PLAN_TRACKER_LIMITS[plan]} active tracker${PLAN_TRACKER_LIMITS[plan] === 1 ? "" : "s"} - archive another or upgrade to unarchive this one`,
        },
        { status: 403 }
      );
    }
  }
  if (parsed.data.schedule && parsed.data.schedule !== "none") {
    const plan = await getPlanFor(auth);
    if (plan === "free") {
      return NextResponse.json(
        { error: "Scheduled runs are a Pro feature — upgrade to automate" },
        { status: 403 }
      );
    }
  }
  if (parsed.data.schedule) {
    await store.updateProjectSchedule(id, parsed.data.schedule);
  }
  if (parsed.data.engines) {
    await store.updateProjectEngineSet(id, parsed.data.engines);
  }
  if (parsed.data.evidenceDrawer !== undefined) {
    await store.updateProjectFlags(id, {
      evidenceDrawer: parsed.data.evidenceDrawer,
    });
  }
  // Human override changes what every reported figure means, so it is not a
  // customer-facing switch: staff only, regardless of project ownership.
  if (parsed.data.humanOverride !== undefined) {
    if (!(await isStaff(auth))) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    await store.updateProjectFlags(id, {
      humanOverride: parsed.data.humanOverride,
    });
  }
  if (parsed.data.archived !== undefined) {
    await store.setProjectArchived(id, parsed.data.archived);
  }
  return NextResponse.json({ ok: true });
}
