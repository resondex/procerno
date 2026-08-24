import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import {
  composeInstrument,
  participationMask,
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

const ScenarioShape = z.object({
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240),
  journey: JourneyShape.nullable(),
});

const Body = z.object({
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  /** Edited read: recompute the mask from these - pure code, no model. */
  base: z.record(z.string(), z.unknown()).optional(),
  scenarios: z.array(ScenarioShape).min(1).max(4).optional(),
});

/**
 * Gate 1 of Landscape setup: read the market (base journey + scenarios with
 * their journeys) and derive the participation mask. With base+scenarios
 * supplied (an edited read), recomposition is pure code and instant.
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (!apiKeyConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  let base: Moderators;
  let scenarios: ScenarioSpec[];
  /** Cached alternates for instant "Suggest another"; only the fresh read
   * produces them - an edited recompose leaves the client's pool alone. */
  let reserve: ScenarioSpec[] | undefined;
  let stages;
  if (parsed.data.base && parsed.data.scenarios) {
    base = parsed.data.base as unknown as Moderators;
    // A4 in code on the edited path too: one deviating journey per grid.
    let deltaGranted = false;
    scenarios = parsed.data.scenarios.map((s) => {
      const wants = s.journey !== null;
      const granted = wants && !deltaGranted;
      if (granted) deltaGranted = true;
      return { ...s, journey: granted ? (s.journey as Journey) : null };
    });
    stages = participationMask(base, scenarios);
  } else {
    ({ base, scenarios, reserve, stages } = await composeInstrument({
      category: parsed.data.category,
      audience: parsed.data.audience || null,
    }));
  }
  return NextResponse.json({
    base,
    moderators: base,
    scenarios,
    reserve: reserve?.map(({ label, description }) => ({ label, description })),
    stages: stages.map((s) => ({
      key: s.key,
      label: s.label,
      layer: s.layer,
      situational: s.situational,
      rivals: s.rivals,
      tag: s.tag,
      recommended: s.recommended,
      columns: s.columns,
    })),
  });
}
