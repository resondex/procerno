import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getAuth, isStaff, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { planNextRun } from "@/lib/engine/surfaces";
import ProjectDashboard, { type Detail } from "./dashboard";

/**
 * Server-rendered entry: the tracker's data loads here, straight from
 * the store - no HTTP hop, no extra auth handshake - and arrives WITH
 * the HTML, so there is no skeleton and no flicker. The client
 * dashboard revalidates on mount in the background (its refresh()), so
 * what you see is never stale for more than one roundtrip.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string; starting?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) redirect("/app");
  const [prompts, runs, staff, dictionary, intents] = await Promise.all([
    store.listPrompts(id),
    store.listRuns(id),
    isStaff(auth),
    store.getDictionary(id),
    store.listIntents(id),
  ]);
  const codesSource = project.codes_source;
  const nextRun = planNextRun({ prompts, intents, runs });
  // Measured-but-held: a collected run whose answers already carry codes
  // (finalize held) - the first paint must read as measured, not "coding".
  const activeRun = runs.find(
    (r) =>
      r.status === "pending" || r.status === "running" || r.status === "collected"
  );
  const [activeAnswers, activeCoded] = activeRun
    ? await Promise.all([
        store.countResponses(activeRun.id),
        codesSource
          ? store.countAnswerCodes(activeRun.id, codesSource)
          : Promise.resolve(0),
      ])
    : [0, 0];
  // Mirror the API's wire format (dates serialize to strings) so the
  // client-side types hold across both load paths.
  const initialDetail = JSON.parse(
    JSON.stringify({
      project,
      prompts,
      runs,
      staff,
      dictionary,
      nextRun,
      activeAnswers,
      activeCoded,
    })
  ) as Detail;
  // The dictionary gate's saved step rides in a cookie so THIS render can
  // open on it - a localStorage-only restore flashed step 1/3 until
  // hydration caught up.
  const gateStepRaw = Number(
    (await cookies()).get(`dict_gate_step_${id}`)?.value ?? ""
  );
  const initialGateStep =
    gateStepRaw === 2 || gateStepRaw === 3 ? (gateStepRaw as 2 | 3) : null;
  return (
    <ProjectDashboard
      id={id}
      initialDetail={initialDetail}
      initialRunId={sp.run ?? null}
      starting={sp.starting === "1"}
      initialGateStep={initialGateStep}
    />
  );
}
