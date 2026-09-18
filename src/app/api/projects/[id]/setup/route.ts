import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { getReasonTaxonomy, seedDictionary } from "@/lib/engine/suggest";
import {
  composeInstrument,
  humanize,
  namesAnyBrand,
  participationMask,
  reviewJourneyFit,
  reviewScenarioFit,
  type Moderators,
  type ScenarioSpec,
} from "@/lib/engine/instrument";

/**
 * Edit-setup for a ZERO-RUN tracker - the escape hatch for regretful
 * clicks. GET renders the tracker's frozen instrument back into the
 * wizard-draft shape so the setup wizard can resume on it; PUT replaces
 * the instrument wholesale (intents, prompts, dictionary, setup fields).
 * Both refuse once any run exists: from the first run onward the
 * instrument is locked, or the trend would compare different questions.
 */

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

export async function GET(
  _req: Request,
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
  const intents = await store.listIntents(id);
  const moderators = (project as unknown as { moderators?: string | null }).moderators;
  if (!moderators || intents.length === 0) {
    return NextResponse.json(
      { error: "this tracker was not built with the Landscape setup" },
      { status: 400 }
    );
  }
  const base = JSON.parse(moderators) as Moderators;
  const prompts = await store.listPrompts(id);
  // Scenario labels live on the intents; descriptions were not frozen
  // into the tracker, so recover them from the warm market read when one
  // exists (noWait: an edit must never trigger a fresh read).
  const situations = [...new Set(intents.map((i) => i.situation).filter(Boolean))] as string[];
  const desc = new Map<string, string>();
  try {
    const composed = await composeInstrument({
      category: project.category,
      audience: project.audience,
      noWait: true,
      meta: { brand: project.brand, source: "edit_setup" },
    });
    if (composed) {
      for (const s of [...composed.scenarios, ...composed.reserve]) {
        desc.set(s.label, s.description);
      }
    }
  } catch {
    // cold read: descriptions stay blank, all editable
  }
  // Journey deltas are not frozen into the tracker; scenarios come back
  // with the base journey and the confirm re-clamps as usual (A4).
  const scenarios: ScenarioSpec[] = situations.map((label) => ({
    label,
    description: desc.get(label) ?? "",
    journey: null,
  }));
  const stages = participationMask(base, scenarios);
  const keptStages = [...new Set(intents.map((i) => i.stage))];
  const byIntent = new Map<string, { text: string; asker?: string }[]>();
  for (const p of prompts) {
    const key = (p as unknown as { intent_id: string | null }).intent_id;
    if (!key) continue;
    const list = byIntent.get(key) ?? [];
    list.push({ text: p.text, asker: (p as unknown as { asker?: string | null }).asker ?? undefined });
    byIntent.set(key, list);
  }
  const cells = intents.map((i) => ({
    stage: i.stage,
    layer: i.layer,
    situation: i.situation,
    angle: i.angle,
    mode: i.mode,
    text: i.text,
    phrasings: (byIntent.get(i.id) ?? []).filter((p) => norm(p.text) !== norm(i.text)),
  }));
  // The advisories ship WITH the draft render, exactly as compose ships
  // them - the edit flow never composes, so without this the scenarios
  // gate reopened with no "generally decide" or "worth a look" banners.
  // Both are cached from setup; a failure ships null advice, never an
  // error.
  const [fit, journeyFit] = await Promise.all([
    reviewScenarioFit({
      brand: project.brand,
      category: project.category,
      scenarios: scenarios.map((s) => ({ label: s.label, description: s.description })),
      meta: { brand: project.brand, source: "edit_setup" },
    }).catch(() => null),
    reviewJourneyFit({
      brand: project.brand,
      category: project.category,
      base,
      meta: { brand: project.brand, source: "edit_setup" },
    }).catch(() => null),
  ]);
  const rows = scenarios.map((s) => ({
    label: s.label,
    description: s.description,
    journey: null,
    suggested: true,
    on: true,
    original: { label: s.label, description: s.description },
    first: { label: s.label, description: s.description },
  }));
  return NextResponse.json({
    draft: {
      id: null,
      brand: project.brand,
      category: project.category,
      audience: project.audience,
      competitors: project.competitors,
      prompts: null,
      wizard: {
        mode: "grid",
        step: "prompts",
        studyName: project.name,
        engineSet: project.engine_set,
        grid: {
          step: "phrasings",
          fit,
          journeyFit,
          moderators: base,
          stages: stages.map((s) => ({
            key: s.key, label: s.label, layer: s.layer, situational: s.situational,
            rivals: s.rivals, tag: s.tag, recommended: s.recommended,
            columns: s.columns, hint: s.hint, why: s.why,
          })),
          keptStages,
          scenarios: scenarios.map((s) => ({ label: s.label, description: s.description, journey: null })),
          scenarioRows: rows,
          reserve: [],
          baselineCellCount: cells.length,
          cells,
        },
      },
    },
  });
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
    moderators: z.record(z.string(), z.unknown()),
    cells: z
      .array(
        z.object({
          stage: z.string().trim().min(1),
          layer: z.string().trim().min(1),
          situation: z.string().trim().nullable(),
          angle: z.string().trim().min(1),
          mode: z.string().trim().nullable().optional(),
          text: z.string().trim().min(1),
          phrasings: z
            .array(
              z.object({
                text: z.string().trim().min(1),
                asker: z.string().trim().optional(),
              })
            )
            .default([]),
        })
      )
      .min(4),
    journeys: z.array(JourneyShape).optional(),
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
  let reasonTaxonomy: string[] = project.reason_taxonomy;
  // The taxonomy is category-derived; regenerate only when the frame moved.
  if (
    apiKeyConfigured() &&
    (category !== project.category ||
      competitors.join("|") !== project.competitors.join("|"))
  ) {
    try {
      reasonTaxonomy = await getReasonTaxonomy({ category, competitors });
    } catch (err) {
      console.error("taxonomy regeneration failed:", err);
    }
  }
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
    engineSet,
    reasonTaxonomy,
  });
  const intents = await store.insertIntents(
    id,
    grid.cells.map((c) => ({
      stage: c.stage, layer: c.layer, situation: c.situation, angle: c.angle,
      mode: c.mode ?? null, text: humanize(c.text),
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
  await seedDictionary(id, [brand, ...competitors]);
  return NextResponse.json({ ok: true });
}
