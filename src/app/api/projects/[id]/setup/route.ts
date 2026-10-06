import { NextResponse } from "next/server";
import { ModeratorsShape } from "@/lib/engine/instrument_shapes";
import { z } from "zod";
import { requireAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { tagCosts } from "@/lib/cost_log";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { questionTypeOf } from "@/lib/engine/battery_checks";
import { seedDictionary } from "@/lib/engine/suggest";
import { humanize, namesAnyBrand } from "@/lib/engine/instrument";
import { buildEditSetupDraft } from "@/lib/server/edit_setup";

/**
 * Edit-setup for a ZERO-RUN tracker - the escape hatch for regretful
 * clicks. GET renders the tracker's frozen instrument back into the
 * wizard-draft shape so the setup wizard can resume on it; PUT replaces
 * the instrument wholesale (intents, prompts, dictionary, setup fields).
 * Both refuse once any run exists: from the first run onward the
 * instrument is locked, or the trend would compare different questions.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
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

const JourneyShape = z.object({
  involvement: z.enum(["considered", "habitual"]),
  verifiability: z.enum(["spec", "taste", "trust"]),
  think_feel: z.enum(["think", "feel"]),
  decision_unit: z.enum(["solo", "household", "committee"]),
});

const putSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  competitors: z.array(z.string().trim().min(1)).max(12),
  engines: z.array(z.string()).optional(),
  grid: z.object({
    moderators: ModeratorsShape,
    /** The setup's offered-vs-accepted record (2026-10-06): replaces the
     * project's setup_decision on an edit-setup. */
    setupDecision: z.record(z.string(), z.unknown()).optional(),
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
          phrasings: z
            .array(
              z.object({
                text: z.string().trim().min(1),
                asker: z.string().trim().optional(),
              })
            )
            .max(20)
            .default([]),
        })
      )
      .min(4)
      // Same ceiling as create - the client's custom-question allowance is
      // advisory; the route is the enforcement (edit-setup skipped it).
      .max(80),
    /** Scenario label -> journey delta (null = inherits base). Part of
     * the frozen instrument: without it a later edit flattens the mask. */
    journeys: z.record(z.string(), JourneyShape.nullable()).optional(),
  }),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const runs = await store.listRuns(id);
  if (runs.length > 0) {
    return NextResponse.json(
      { error: "setup is locked once a run exists" },
      { status: 409 }
    );
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
  }
  const { category, competitors, grid } = parsed.data;
  const audience = parsed.data.audience || null;
  const brand = project.brand;
  // The reason taxonomy is discovery-derived (never generated), so an edited
  // frame keeps whatever the project has: an empty list pre-discovery, or the
  // ratified list - a frame change big enough to invalidate it warrants a
  // fresh discovery pass, not a regenerated guess.
  const reasonTaxonomy: string[] = project.reason_taxonomy;
  const engineSet =
    parsed.data.engines && parsed.data.engines.length > 0
      ? parsed.data.engines
      : project.engine_set;
  await store.resetInstrument(id, {
    name: parsed.data.name ?? project.name,
    category,
    audience,
    competitors,
    moderators: JSON.stringify(grid.moderators),
    scenarioJourneys: grid.journeys ? JSON.stringify(grid.journeys) : null,
    engineSet,
    reasonTaxonomy,
  });
  const intents = await store.insertIntents(
    id,
    grid.cells.map((c) => ({
      stage: c.stage, layer: c.layer, situation: c.situation, angle: c.angle,
      mode: c.mode ?? null,
        qtype: c.qtype ?? questionTypeOf({ stage: c.stage, angle: c.angle, text: c.text }, project.brand, category),
        concern: c.concern ?? null,
        text: humanize(c.text),
    }))
  );
  await store.insertPrompts(
    id,
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
  if (grid.setupDecision) {
    await store.setSetupDecision(id, JSON.stringify(grid.setupDecision));
  }
  // Attribute the re-seed's model spend to the project being edited.
  tagCosts({ projectId: id });
  await seedDictionary(id, [brand, ...competitors]);
  return NextResponse.json({ ok: true });
}
