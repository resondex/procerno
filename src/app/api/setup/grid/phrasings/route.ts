import { NextResponse } from "next/server";
import { tagSetupFromRequest } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import {
  generatePhrasings,
  type Journey,
  type Moderators,
  type ScenarioSpec,
} from "@/lib/engine/instrument";
import { ModeratorsShape } from "@/lib/engine/instrument_shapes";
import type { CellCheckSpec } from "@/lib/engine/battery_checks";
import { ROSTER_ROLE_VALUES } from "@/lib/engine/battery_checks";

// 300, not 120: a hard category's market read alone runs 90-120s of
// gpt-5 reasoning - the old budget killed first reads at the wall and
// greeted fresh categories with an error. Fluid Compute allows 300.
export const maxDuration = 300;

const JourneyShape = z.object({
  involvement: z.enum(["considered", "habitual"]),
  verifiability: z.enum(["spec", "taste", "trust"]),
  think_feel: z.enum(["think", "feel"]),
  decision_unit: z.enum(["solo", "household", "committee"]),
});

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  competitors: z.array(z.string().trim().min(1).max(80)).max(12),
  /** Typed roster (2026-09-30): competitor -> same_seat | upstream.
   * Absent = every competitor same_seat (the untyped behavior). */
  rosterRoles: z.record(z.string().max(80), z.enum(ROSTER_ROLE_VALUES)).optional(),
  audience: z.string().trim().max(160).optional(),
  base: ModeratorsShape,
  scenarios: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        description: z.string().trim().max(240),
        /** journeys30: the want-free restatement the writer reads; absent = derived server side. */
        circumstance: z.string().trim().max(240).optional(),
        journey: JourneyShape.nullable(),
      })
    )
    .min(1)
    .max(4),
  /** One small batch of confirmed cells - the UI calls this repeatedly so
   * no request runs near the platform limit. */
  cells: z
    .array(
      z.object({
        stage: z.string().trim().min(1),
        situation: z.string().trim().nullable(),
        angle: z.string().trim().min(1),
        mode: z.string().trim().nullable().optional(),
        text: z.string().trim().min(1),
        /** The cell's carried check-spec (s7+). Its presence selects the
         * spec path; the engine re-derives the design from the cell and
         * roster and prefers that over the carried copy, so the shape is
         * not trusted beyond being an object. Absent = legacy path. */
        spec: z.record(z.string(), z.unknown()).nullable().optional(),
        /** The cell's planned concern (s9+): rides into the re-derived
         * spec's design line. */
        concern: z.string().trim().max(120).nullable().optional(),
        /** Class-angle comparison cells (2026-10-01): the class phrase
         * and the upstream brand it evokes. Absent on every other cell. */
        classPhrase: z.string().trim().max(60).nullable().optional(),
        classBrand: z.string().trim().max(80).nullable().optional(),
      })
    )
    .min(1)
    .max(30),
  count: z.number().int().min(2).max(20).default(10),
  /** All planned concerns in the battery - sibling-bleed guard. */
  avoidConcerns: z.array(z.string().trim().max(120)).max(36).optional(),
  force: z.boolean().optional(),
  /** Background warm: fill the cache but never wait on another request's
   * in-flight work - the confirm that needs results does the waiting. */
  warm: z.boolean().optional(),
});

/** Gate 3: the paraphrase set for each confirmed seed prompt. */
export async function POST(req: Request) {
  tagSetupFromRequest(req);
  const auth = await requireAuthOrDemo();
  if (auth instanceof NextResponse) return auth;
  if (!apiKeyConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { brand, category, competitors, audience, cells, count, force, avoidConcerns } = parsed.data;
  const phrasings = await generatePhrasings({
    brand,
    category,
    competitors,
    audience: audience || null,
    base: parsed.data.base,
    scenarios: parsed.data.scenarios as unknown as (ScenarioSpec & { journey: Journey | null })[],
    cells: cells.map((c) => ({ ...c, spec: (c.spec ?? null) as CellCheckSpec | null })),
    count,
    avoidConcerns,
    rosterRoles: parsed.data.rosterRoles,
    force,
    noWait: parsed.data.warm,
    meta: { source: cacheSource(auth) },
  });
  return NextResponse.json({ phrasings });
}
