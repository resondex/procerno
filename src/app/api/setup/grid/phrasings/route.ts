import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import {
  generatePhrasings,
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
      })
    )
    .min(1)
    .max(30),
  count: z.number().int().min(2).max(20).default(10),
  force: z.boolean().optional(),
  /** Background warm: fill the cache but never wait on another request's
   * in-flight work - the confirm that needs results does the waiting. */
  warm: z.boolean().optional(),
});

/** Gate 3: the paraphrase set for each confirmed seed prompt. */
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
  const { brand, category, competitors, audience, cells, count, force } = parsed.data;
  const phrasings = await generatePhrasings({
    brand,
    category,
    competitors,
    audience: audience || null,
    base: parsed.data.base as unknown as Moderators,
    scenarios: parsed.data.scenarios as unknown as (ScenarioSpec & { journey: Journey | null })[],
    cells,
    count,
    force,
    noWait: parsed.data.warm,
  });
  return NextResponse.json({ phrasings });
}
