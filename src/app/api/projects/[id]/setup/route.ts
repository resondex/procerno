import { NextResponse } from "next/server";
import { ModeratorsShape } from "@/lib/engine/instrument_shapes";
import { z } from "zod";
import { getPlanFor, PLAN_SCENARIO_CAPS, requireMember, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { tagCosts } from "@/lib/cost_log";
import { currentEngineIds, ENGINES, getEngine } from "@/lib/engine/providers";
import { seedDictionary } from "@/lib/engine/suggest";
import { buildEditSetupDraft, mergeSetupDecision } from "@/lib/server/edit_setup";
import {
  CellShape,
  claimWriteLease,
  instrumentRows,
  JourneysShape,
  releaseWriteLease,
  scenarioCount,
  SetupDecisionShape,
  WorryDecisionShape,
} from "../../instrument_write";

/**
 * Edit-setup for a ZERO-RUN tracker - the escape hatch for regretful
 * clicks. GET renders the tracker's frozen instrument back into the
 * wizard-draft shape so the setup wizard can resume on it; PUT replaces
 * the instrument wholesale (intents, prompts, dictionary, setup fields).
 * Both refuse once any run exists: from the first run onward the
 * instrument is locked, or the trend would compare different questions.
 */

// The PUT writes the whole instrument and re-seeds the dictionary; the
// per-project lease (instrument_write.ts) is sized above this.
export const maxDuration = 120;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const draft = await buildEditSetupDraft(project);
  if (!draft) {
    return NextResponse.json(
      { error: "setup is locked once a run exists" },
      { status: 409 }
    );
  }
  return NextResponse.json({ draft });
}

const putSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  competitors: z.array(z.string().trim().min(1).max(80)).max(12),
  /** Same contract as create: capped to the registry, unknown ids
   * dropped, retired ids resolved to their successors. */
  engines: z.array(z.string().trim().min(1).max(80)).max(ENGINES.length).optional(),
  grid: z.object({
    moderators: ModeratorsShape,
    /** The setup's offered-vs-accepted record (2026-10-06): MERGED over
     * the project's stored setup_decision on an edit-setup (the stored
     * record keeps the offered history; the edit owns the decided side). */
    setupDecision: SetupDecisionShape.optional(),
    /** The worries gate's recommended-vs-decided record, as at create. */
    worryDecision: WorryDecisionShape.optional(),
    cells: z
      .array(CellShape)
      .min(4)
      // Same ceiling as create - the client's custom-question allowance is
      // advisory; the route is the enforcement (edit-setup skipped it).
      .max(80),
    /** Scenario label -> journey delta (null = inherits base). Part of
     * the frozen instrument: without it a later edit flattens the mask. */
    journeys: JourneysShape.optional(),
  }),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
  }
  // One save at a time per tracker: the client gives up at 120s and
  // invites a retry, and two in-flight saves used to interleave reset and
  // inserts (a doubled battery doubles collection cost).
  const leaseKey = `edit_setup:${id}`;
  const lease = await claimWriteLease(leaseKey);
  if (!lease) {
    return NextResponse.json(
      { error: "this tracker's setup is still being saved - try again in a moment" },
      { status: 409 }
    );
  }
  try {
    // The run check sits INSIDE the lease: nothing can start a run on a
    // tracker mid-save without this check seeing it on the next save.
    const latest = await store.latestRuns([id]);
    if (latest[id]) {
      return NextResponse.json(
        { error: "setup is locked once a run exists" },
        { status: 409 }
      );
    }
    const { category, competitors, grid } = parsed.data;
    const audience = parsed.data.audience || null;
    const brand = project.brand;
    // Create's scenario cap, enforced on the edit too.
    if (auth.userId !== null) {
      const plan = await getPlanFor(auth);
      const scenarios = scenarioCount(grid.cells);
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
    // The reason taxonomy is discovery-derived (never generated), so an edited
    // frame keeps whatever the project has: an empty list pre-discovery, or the
    // ratified list - a frame change big enough to invalidate it warrants a
    // fresh discovery pass, not a regenerated guess.
    const reasonTaxonomy: string[] = project.reason_taxonomy;
    const requestedEngines = currentEngineIds(
      (parsed.data.engines ?? []).filter((m) => getEngine(m))
    );
    const engineSet = requestedEngines.length > 0 ? requestedEngines : project.engine_set;
    const rows = await instrumentRows(grid.cells, brand, competitors, category);
    // Reset and re-insert in ONE transaction: a failure part-way never
    // leaves the tracker without an instrument.
    await store.replaceInstrument(id, {
      reset: {
        name: parsed.data.name ?? project.name,
        category,
        audience,
        competitors,
        moderators: JSON.stringify(grid.moderators),
        scenarioJourneys: grid.journeys ? JSON.stringify(grid.journeys) : null,
        engineSet,
        reasonTaxonomy,
      },
      cells: rows,
    });
    if (grid.setupDecision) {
      const stored = await store.getSetupDecision(id).catch(() => null);
      await store.setSetupDecision(id, JSON.stringify(mergeSetupDecision(stored, grid.setupDecision)));
    }
    if (grid.worryDecision) {
      await store.setWorryDecision(id, JSON.stringify(grid.worryDecision));
    }
    // Attribute the re-seed's model spend to the project being edited.
    tagCosts({ projectId: id });
    await seedDictionary(id, [brand, ...competitors]);
    return NextResponse.json({ ok: true });
  } finally {
    await releaseWriteLease(leaseKey, lease);
  }
}
