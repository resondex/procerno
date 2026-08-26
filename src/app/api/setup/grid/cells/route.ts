import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import {
  generateGrid,
  participationMask,
  type Journey,
  type Moderators,
  type ScenarioSpec,
} from "@/lib/engine/instrument";

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
  competitors: z.array(z.string().trim().min(1).max(80)).max(8),
  audience: z.string().trim().max(160).optional(),
  base: z.record(z.string(), z.unknown()),
  /** The ACTIVE scenarios as confirmed at gate 1, with their journeys. */
  scenarios: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        description: z.string().trim().max(240),
        journey: JourneyShape.nullable(),
      })
    )
    .min(1)
    .max(4),
  /** Stage keys the user kept at gate 1; the mask is recomputed server
   * side from the journeys so stage hints never leave the engine. */
  stageKeys: z.array(z.string().trim().min(1)).min(1).max(30),
  /** Background warm: fill the cache but never wait on another request's
   * in-flight write - the confirm that needs results does the waiting. */
  warm: z.boolean().optional(),
});

/** Gate 2: write one seed prompt per masked cell for the confirmed read. */
export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (auth instanceof NextResponse) return auth;
  if (!apiKeyConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { brand, category, competitors, audience, stageKeys } = parsed.data;
  const base = parsed.data.base as unknown as Moderators;
  const scenarios = parsed.data.scenarios as unknown as (ScenarioSpec & { journey: Journey | null })[];
  const kept = new Set(stageKeys);
  const stages = participationMask(base, scenarios).filter((s) => kept.has(s.key));
  if (stages.length === 0) {
    return NextResponse.json({ error: "keep at least one stage" }, { status: 400 });
  }
  const cells = await generateGrid({
    brand,
    category,
    competitors,
    audience: audience || null,
    base,
    scenarios,
    stages,
    noWait: parsed.data.warm,
  });
  if (!cells) {
    return parsed.data.warm
      ? NextResponse.json({ pending: true })
      : NextResponse.json(
          { error: "the prompts are still being written - try again in a moment" },
          { status: 502 }
        );
  }
  return NextResponse.json({ cells });
}
