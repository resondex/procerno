import { NextResponse } from "next/server";
import { ModeratorsShape } from "@/lib/engine/instrument_shapes";
import { z } from "zod";
import { store } from "@/lib/store";
import {
  getPlanFor,
  isStaff,
  PLAN_SCENARIO_CAPS,
  PLAN_TRACKER_LIMITS,
  requireAuth,
} from "@/lib/auth";
import { tagCosts } from "@/lib/cost_log";
import { generatePromptBattery } from "@/lib/engine/prompts";
import { questionTypeOf } from "@/lib/engine/battery_checks";
import { seedDictionary } from "@/lib/engine/suggest";
import { humanize, namesAnyBrand } from "@/lib/engine/instrument";
import { apiKeyConfigured, availableEngines, currentEngineIds, ENGINES, getEngine } from "@/lib/engine/providers";

const createSchema = z.object({
  name: z.string().trim().min(1).optional(),
  setupId: z.string().uuid().optional(),
  brand: z.string().trim().min(1),
  competitors: z.array(z.string().trim().min(1)).max(12).default([]),
  category: z.string().trim().min(1),
  audience: z.string().trim().optional(),
  /** The tracker's core engine panel — scheduled runs and headline metrics
   * use exactly this set. Defaults to the default-tier engine per vendor.
   * The cap tracks the registry (retired ids included, they resolve to
   * successors) - a hardcoded 8 rejected every full-panel Confirm with a
   * 400, the same defect the PATCH route had. */
  engines: z.array(z.string().trim().min(1)).max(ENGINES.length).optional(),
  // User-reviewed battery from /api/prompts/generate; templates when absent.
  prompts: z
    .array(
      z.object({
        text: z.string().trim().min(1),
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
  /** Grid-built battery from /api/setup/grid, as reviewed in the setup UI.
   * Mutually exclusive with `prompts`; the classic path is untouched. */
  grid: z
    .object({
      moderators: z.record(z.string(), z.unknown()),
      /** The worries gate's recommended-vs-decided record - stored on the
       * project (worry_decision) as the recommender's training data. */
      worryDecision: z
        .object({
          recommended: z
            .array(z.object({ concern: z.string().trim().min(1).max(80), stage: z.string().trim().min(1).max(40) }))
            .max(40),
          decided: z
            .array(z.object({ concern: z.string().trim().min(1).max(80), stage: z.string().trim().min(1).max(40) }))
            .max(40),
        })
        .optional(),
      /** The setup's offered-vs-accepted record (2026-10-06, Tyler): stored
       * on the project as setup_decision, opaque to this route. */
      setupDecision: z.record(z.string(), z.unknown()).optional(),
      journeys: z
        .record(
          z.string(),
          z
            .object({
              involvement: z.enum(["considered", "habitual"]),
              verifiability: z.enum(["spec", "taste", "trust"]),
              think_feel: z.enum(["think", "feel"]),
              decision_unit: z.enum(["solo", "household", "committee"]),
            })
            .nullable()
        )
        .optional(),
      cells: z
        .array(
          z.object({
            stage: z.string().trim().min(1),
            layer: z.string().trim().min(1),
            situation: z.string().trim().nullable(),
            angle: z.string().trim().min(1),
            mode: z.string().trim().nullable().optional(),
            qtype: z.string().trim().max(40).nullable().optional(),
            concern: z.string().trim().max(80).nullable().optional(),
            text: z.string().trim().min(1),
            /** The confirmed paraphrase set for this cell; each becomes its
             * own prompt under the same intent, carrying its buyer voice. */
            phrasings: z
              .array(
                z.object({
                  text: z.string().trim().min(1),
                  asker: z.string().trim().optional(),
                })
              )
              .max(20)
              .optional(),
          })
        )
        .min(4)
        .max(80),
    })
    .optional(),
});

export async function GET() {
  const auth = await requireAuth();
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
  const withRuns = await Promise.all(
    projects.map(async (p) => ({
      ...p,
      latestRun: (await store.listRuns(p.id))[0] ?? null,
    }))
  );
  return NextResponse.json({ projects: withRuns });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
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
    if (parsed.data.grid) {
      const scenarios = new Set(
        parsed.data.grid.cells.map((c) => c.situation).filter(Boolean)
      ).size;
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

  const { brand, competitors, category } = parsed.data;
  const audience = parsed.data.audience || null;
  // No seed taxonomy at creation: the reason taxonomy is discovered from the
  // collected answers (open-coded discovery pass -> clustering -> ratified),
  // never guessed up front. Measured 2026-09-22: generated seeds anticipate
  // ~50-80% of the real argument space and, when shown to the labeler,
  // suppress discovery of the rest (absorption into nearby listed codes).
  const reasonTaxonomy: string[] = [];
  const requestedEngines = currentEngineIds(
    (parsed.data.engines ?? []).filter((m) => getEngine(m))
  );
  const engineSet =
    requestedEngines.length > 0
      ? requestedEngines
      : availableEngines()
          .slice(0, 1)
          .map((e) => e.id);
  const grid = parsed.data.grid;
  const project = await store.createProject({
    name: parsed.data.name ?? brand,
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
  if (parsed.data.setupId) {
    // Transfer setup-phase ledger rows onto the project the moment it
    // exists - the tracker's costs are one series from wizard open.
    // Both instrument modes: classic batteries spend through the wizard
    // too, not only the grid.
    await store.attachSetupCosts(project.id, parsed.data.setupId).catch(() => 0);
  }
  if (grid) {
    // Grid path: intents carry the stage identity; prompts carry the stage
    // as their theme UNLESS the text names the brand or a rival, in which
    // case the prompt stores "branded" so the unbranded funnel stays blind.
    // Each cell's seed prompt and its paraphrases all hang off one intent;
    // the theme is decided per prompt, so a paraphrase that names a brand is
    // fenced off individually even if its seed is blind.
    const intents = await store.insertIntents(
      project.id,
      grid.cells.map((c) => ({
        stage: c.stage, layer: c.layer, situation: c.situation, angle: c.angle,
        // House punctuation on the way in - covers text frozen in drafts
        // that predate the humanize coverage.
        mode: c.mode ?? null,
        qtype: c.qtype ?? questionTypeOf({ stage: c.stage, angle: c.angle, text: c.text }, project.brand, category),
        concern: c.concern ?? null,
        text: humanize(c.text),
      }))
    );
    await store.insertPrompts(
      project.id,
      grid.cells.flatMap((c, i) =>
        [{ text: c.text, asker: null as string | null }, ...(c.phrasings ?? []).map((p) => ({ text: p.text, asker: (p.asker || null) as string | null }))].map(
          ({ text, asker }) => ({
            text: humanize(text),
            theme: namesAnyBrand(text, brand, competitors) ? "branded" : c.stage,
            intentId: intents[i]?.id ?? null,
            asker,
          })
        )
      )
    );
    if (grid.worryDecision) {
      await store.setWorryDecision(project.id, JSON.stringify(grid.worryDecision));
    }
    if (grid.setupDecision) {
      await store.setSetupDecision(project.id, JSON.stringify(grid.setupDecision));
    }
  } else {
    await store.insertPrompts(
      project.id,
      parsed.data.prompts ?? generatePromptBattery({ brand, category, audience })
    );
  }
  // The seed's model spend belongs to the project that now exists - without
  // the tag it landed in the ledger unattributed.
  tagCosts({ projectId: project.id });
  await seedDictionary(project.id, [brand, ...competitors]);
  return NextResponse.json({ project }, { status: 201 });
}
