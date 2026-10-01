import { NextResponse } from "next/server";
import { tagSetupFromRequest } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import {
  generateWorries,
  participationMask,
  WORRY_STANCE_STAGES,
  type Journey,
  type Moderators,
  type ScenarioSpec,
} from "@/lib/engine/instrument";

export const maxDuration = 120;

const JourneyShape = z.object({
  involvement: z.enum(["considered", "habitual"]),
  verifiability: z.enum(["spec", "taste", "trust"]),
  think_feel: z.enum(["think", "feel"]),
  decision_unit: z.enum(["solo", "household", "committee"]),
});

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
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
  /** Background warm: fill the cache, never wait on in-flight work. */
  warm: z.boolean().optional(),
});

/** The worries gate's candidate pool: the brand's doubt-space, stance-
 * tagged, offered only at the stances the participation mask recommends.
 * The user's PICKS are decision data stored on the draft - this route
 * only serves the menu. */
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
  const base = parsed.data.base as unknown as Moderators;
  const scenarios = parsed.data.scenarios as unknown as (ScenarioSpec & { journey: Journey | null })[];
  const offered = participationMask(base, scenarios)
    .filter((s) => s.recommended && (WORRY_STANCE_STAGES as readonly string[]).includes(s.key))
    .map((s) => s.key);
  const worries = await generateWorries({
    brand: parsed.data.brand,
    category: parsed.data.category,
    audience: parsed.data.audience || null,
    scenarios,
    offered,
    noWait: parsed.data.warm,
    meta: { source: cacheSource(auth) },
  });
  if (!worries) {
    return parsed.data.warm
      ? NextResponse.json({ pending: true })
      : NextResponse.json(
          { error: "the worries are still being read - try again in a moment" },
          { status: 502 }
        );
  }
  return NextResponse.json({ worries, offered });
}
