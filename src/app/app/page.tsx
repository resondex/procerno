import { redirect } from "next/navigation";
import { getAuth, isStaff } from "@/lib/auth";
import { store } from "@/lib/store";
import { ENGINES } from "@/lib/engine/providers";
import AppHome from "./home";

/**
 * Server-rendered entry for the trackers list - same treatment as the
 * tracker page: everything the first paint needs loads here, in
 * process, and arrives with the HTML. No mount fetches, no flicker.
 */
export default async function AppHomePage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
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
  const wire = JSON.parse(JSON.stringify({ withRuns, drafts }));
  return (
    <AppHome
      initialProjects={wire.withRuns}
      initialDrafts={wire.drafts}
      initialIsAdmin={isAdmin}
      initialEngines={engines}
    />
  );
}
