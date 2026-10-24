import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { ModeratorsShape } from "@/lib/engine/instrument_shapes";
import { z } from "zod";
import { store } from "@/lib/store";
import {
  getPlanFor,
  isStaff,
  PLAN_SCENARIO_CAPS,
  PLAN_TRACKER_LIMITS,
  requireMember,
} from "@/lib/auth";
import { ownsSetup, tagCosts } from "@/lib/cost_log";
import { generatePromptBattery } from "@/lib/engine/prompts";
import { seedDictionary } from "@/lib/engine/suggest";
import { availableEngines, currentEngineIds, ENGINES, getEngine } from "@/lib/engine/providers";
import {
  CellShape,
  claimWriteLease,
  instrumentRows,
  JourneysShape,
  releaseWriteLease,
  scenarioCount,
  SetupDecisionShape,
  WorryDecisionShape,
} from "./instrument_write";

// Create writes the project and its whole instrument in one request; the
// per-user lease (instrument_write.ts) is sized above this.
export const maxDuration = 120;

const createSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  setupId: z.string().uuid().optional(),
  brand: z.string().trim().min(1).max(80),
  competitors: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  /** The tracker's core engine panel — scheduled runs and headline metrics
   * use exactly this set. Defaults to the default-tier engine per vendor.
   * The cap tracks the registry (retired ids included, they resolve to
   * successors) - a hardcoded 8 rejected every full-panel Confirm with a
   * 400, the same defect the PATCH route had. */
  engines: z.array(z.string().trim().min(1).max(80)).max(ENGINES.length).optional(),
  // User-reviewed battery from /api/prompts/generate; templates when absent.
  prompts: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(2000),
        theme: z.enum([
          "discovery",
          "recommendation",
          "comparison",
          "use_case",
          "branded",
        ]),
      })
    )
    .min(4)
    .max(30)
    .optional(),
  /** Grid-built battery from the setup wizard's /api/setup/grid/* gates.
   * Mutually exclusive with `prompts`; the classic path is untouched. */
  grid: z
    .object({
      /** Validated like every setup route validates it: a read this route
       * stored unchecked (a >600-char rationale) 400'd every later call. */
      moderators: ModeratorsShape,
      /** The worries gate's recommended-vs-decided record - stored on the
       * project (worry_decision) as the recommender's training data. */
      worryDecision: WorryDecisionShape.optional(),
      /** The setup's offered-vs-accepted record (2026-10-06, Tyler): stored
       * on the project as setup_decision, opaque to this route. */
      setupDecision: SetupDecisionShape.optional(),
      journeys: JourneysShape.optional(),
      cells: z.array(CellShape).min(4).max(80),
    })
    .optional(),
});

export async function GET() {
  // Members only: every share-link viewer is the same "share" user, so a
  // share context listing by userId would see the others' trackers.
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  // Staff see every tracker; members also see their orgs' trackers.
  let projects;
  if (auth.userId !== null && (await isStaff(auth))) {
    projects = await store.listProjects();
  } else {
    projects = await store.listProjects(auth.userId ?? undefined);
    if (auth.email) {
      const memberships = await store.listMembershipsForEmail(auth.email);
      const orgProjects = await store.listProjectsByOrgIds(
        memberships.map((m) => m.org_id)
      );
      const seen = new Set(projects.map((p) => p.id));
      projects = [...projects, ...orgProjects.filter((p) => !seen.has(p.id))];
    }
  }
  // One roundtrip for every tracker's newest run (was listRuns per
  // project, every run row shipped to read [0]).
  const latest = await store.latestRuns(projects.map((p) => p.id));
  const withRuns = projects.map((p) => ({ ...p, latestRun: latest[p.id] ?? null }));
  return NextResponse.json({ projects: withRuns });
}

export async function POST(req: Request) {
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
  }
  // One create at a time per user: a double-submit (or a retry while the
  // first is still writing) gets a 409 instead of a second tracker, and
  // the plan-limit check below runs inside the lease, so two creates can
  // no longer both pass it.
  const leaseKey = `create_project:${auth.userId ?? "dev"}`;
  const lease = await claimWriteLease(leaseKey);
  if (!lease) {
    return NextResponse.json(
      { error: "a tracker is already being created - try again in a moment" },
      { status: 409 }
    );
  }
  try {
    return await create(auth, parsed.data);
  } finally {
    await releaseWriteLease(leaseKey, lease);
  }
}

async function create(
  auth: { userId: string | null; email: string | null },
  data: z.infer<typeof createSchema>
): Promise<NextResponse> {
  // Idempotent per setup: a re-submit of a setup that already became a
  // tracker returns that tracker instead of a duplicate.
  const createdKey = data.setupId ? `setup_created:${data.setupId}` : null;
  if (createdKey) {
    const prior = await store.cacheGet(createdKey, 7 * 24 * 3600 * 1000).catch(() => null);
    const existing = prior ? await store.getProject(prior).catch(() => null) : null;
    if (existing && existing.user_id === auth.userId && !existing.archived_at) {
      return NextResponse.json({ project: existing }, { status: 200 });
    }
  }

  if (auth.userId !== null) {
    const plan = await getPlanFor(auth);
    // Archived trackers don't count against the plan; unarchiving
    // re-checks the limit instead.
    const existing = (await store.listProjects(auth.userId)).filter(
      (p) => !p.archived_at
    );
    if (existing.length >= PLAN_TRACKER_LIMITS[plan]) {
      return NextResponse.json(
        {
          error: `The ${plan} plan includes ${PLAN_TRACKER_LIMITS[plan]} tracker${PLAN_TRACKER_LIMITS[plan] === 1 ? "" : "s"} - upgrade for more`,
        },
        { status: 403 }
      );
    }
    // The wizard enforces the scenario cap too; this is the authority.
    if (data.grid) {
      const scenarios = scenarioCount(data.grid.cells);
      const cap = PLAN_SCENARIO_CAPS[plan];
      if (scenarios > cap) {
        return NextResponse.json(
          {
            error: `The ${plan} plan includes ${cap} buying scenarios - this Landscape has ${scenarios}; untick ${scenarios - cap} and try again`,
          },
          { status: 403 }
        );
      }
    }
  }

  const { brand, competitors, category } = data;
  const audience = data.audience || null;
  // No seed taxonomy at creation: the reason taxonomy is discovered from the
  // collected answers (open-coded discovery pass -> clustering -> ratified),
  // never guessed up front. Measured 2026-09-22: generated seeds anticipate
  // ~50-80% of the real argument space and, when shown to the labeler,
  // suppress discovery of the rest (absorption into nearby listed codes).
  const reasonTaxonomy: string[] = [];
  const requestedEngines = currentEngineIds(
    (data.engines ?? []).filter((m) => getEngine(m))
  );
  const engineSet =
    requestedEngines.length > 0
      ? requestedEngines
      : availableEngines()
          .slice(0, 1)
          .map((e) => e.id);
  const grid = data.grid;
  // Rows are built (aliases read) BEFORE the project exists, so nothing
  // between createProject and the instrument write can fail slowly.
  const rows = grid ? await instrumentRows(grid.cells, brand, competitors, category) : null;
  const project = await store.createProject({
    name: data.name ?? brand,
    brand,
    competitors,
    category,
    audience,
    userId: auth.userId,
    reasonTaxonomy,
    engineSet,
    moderators: grid ? JSON.stringify(grid.moderators) : null,
    scenarioJourneys: grid?.journeys ? JSON.stringify(grid.journeys) : null,
    instrumentVersion: grid ? 1 : 0,
  });
  try {
    if (rows && grid) {
      // Intents and prompts in ONE transaction: a failure leaves no
      // half-written battery.
      await store.replaceInstrument(project.id, { reset: null, cells: rows });
      if (grid.worryDecision) {
        await store.setWorryDecision(project.id, JSON.stringify(grid.worryDecision));
      }
      if (grid.setupDecision) {
        await store.setSetupDecision(project.id, JSON.stringify(grid.setupDecision));
      }
    } else {
      await store.insertPrompts(
        project.id,
        data.prompts ?? generatePromptBattery({ brand, category, audience })
      );
    }
  } catch (err) {
    // The tracker never existed for the user: remove the shell so a retry
    // starts clean (and it never counts against the plan).
    console.error(`create: instrument write failed for ${project.id}:`, err);
    await store.deleteProject(project.id).catch(() => {});
    return NextResponse.json(
      { error: "the tracker could not be saved - try again" },
      { status: 500 }
    );
  }
  if (data.setupId && (await ownsSetup(data.setupId, auth.userId))) {
    // Transfer setup-phase ledger rows onto the project the moment it
    // exists - the tracker's costs are one series from wizard open. Only
    // a setup id that names the caller's own draft: the id is client-
    // chosen, and attaching someone else's setup would move their spend
    // onto this tracker. Both instrument modes: classic batteries spend
    // through the wizard too, not only the grid.
    await store.attachSetupCosts(project.id, data.setupId).catch(() => 0);
  }
  if (createdKey) {
    await store.cacheSet(createdKey, project.id, { brand, category, source: "create", projectId: project.id }).catch(() => {});
  }
  // The seed's model spend belongs to the project that now exists - without
  // the tag it landed in the ledger unattributed.
  tagCosts({ projectId: project.id });
  // Off the response path: nothing reads the dictionary until discovery,
  // hours into the first run, and the alias call can take seconds - the
  // Create click waited on it before the dashboard could open.
  const seeding = seedDictionary(project.id, [brand, ...competitors]).catch((err) =>
    console.error(`dictionary seed failed for ${project.id}:`, err)
  );
  if (process.env.VERCEL) waitUntil(seeding);
  else await seeding;
  return NextResponse.json({ project }, { status: 201 });
}
