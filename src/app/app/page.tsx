import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getAuth, isStaff, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { ENGINES } from "@/lib/engine/providers";
import { buildEditSetupDraft } from "@/lib/server/edit_setup";
import AppHome from "./home";

/**
 * Server-rendered entry for the trackers list - same treatment as the
 * tracker page: everything the first paint needs loads here, in
 * process, and arrives with the HTML. No mount fetches, no flicker.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ editSetup?: string }>;
}) {
  const sp = await searchParams;
  const auth = await getAuth();
  if (!auth) redirect("/login");
  // Edit setup arrives in the SAME navigation: the tracker's draft is
  // built here, so the wizard is already open on first paint - no bare
  // list, no second fetch, no seconds of waiting.
  let editSetup: { id: string; draft: unknown } | null = null;
  if (sp.editSetup) {
    const project = await requireProject(sp.editSetup, auth, { write: true });
    if (!(project instanceof NextResponse)) {
      const draft = await buildEditSetupDraft(project);
      if (draft) editSetup = { id: sp.editSetup, draft };
    }
  }
  const staff = auth.userId !== null && (await isStaff(auth));
  let projects = staff
    ? await store.listProjects()
    : await store.listProjects(auth.userId ?? undefined);
  const memberships = auth.email
    ? await store.listMembershipsForEmail(auth.email)
    : [];
  if (!staff && memberships.length > 0) {
    const orgProjects = await store.listProjectsByOrgIds(
      memberships.map((m) => m.org_id)
    );
    const seen = new Set(projects.map((p) => p.id));
    projects = [...projects, ...orgProjects.filter((p) => !seen.has(p.id))];
  }
  const [withRuns, drafts] = await Promise.all([
    Promise.all(
      projects.map(async (p) => ({
        ...p,
        latestRun: (await store.listRuns(p.id))[0] ?? null,
      }))
    ),
    store.listSetupDrafts(auth.userId),
  ]);
  const isAdmin = staff || memberships.some((m) => m.role === "admin");
  const engines = ENGINES.map((e) => ({
    id: e.id,
    label: e.label,
    vendor: e.vendor,
    available: Boolean(process.env[e.keyEnv]),
    keyEnv: e.keyEnv,
    mode: e.mode,
  }));
  // Wire format parity with the API routes (dates as strings).
  const wire = JSON.parse(JSON.stringify({ withRuns, drafts, editSetup }));
  return (
    <AppHome
      initialProjects={wire.withRuns}
      initialDrafts={wire.drafts}
      initialIsAdmin={isAdmin}
      initialEngines={engines}
      initialEditSetup={wire.editSetup}
    />
  );
}
