import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import {
  composeInstrument,
  generateSituations,
  mergedStageLibrary,
  type MarketMode,
  type Moderators,
} from "@/lib/engine/instrument";

export const maxDuration = 120;

const ModeShape = z.object({
  label: z.string().trim().max(40),
  moderators: z.record(z.string(), z.unknown()),
});

const Body = z.object({
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  /** Edited market read: recompose from these modes instead of classifying. */
  modes: z.array(ModeShape).min(1).max(2).optional(),
  /** Legacy single-read override, kept for older clients. */
  moderators: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Gate 1 of Landscape setup: read the market (1-2 buyer modes), merge the
 * stage library across them, propose the scenarios. The user confirms or
 * edits all of it before a single prompt is written.
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
  const audience = parsed.data.audience || null;

  let modes: MarketMode[];
  let stages;
  let situations;
  const override: MarketMode[] | null = parsed.data.modes
    ? (parsed.data.modes as unknown as MarketMode[])
    : parsed.data.moderators
      ? [{ label: "Buyers", moderators: parsed.data.moderators as unknown as Moderators }]
      : null;
  if (override) {
    modes = override;
    stages = mergedStageLibrary(modes);
    situations = await generateSituations({
      category: parsed.data.category,
      audience,
      decisionUnit: modes[0].moderators.decision_unit,
    });
  } else {
    ({ modes, stages, situations } = await composeInstrument({
      category: parsed.data.category,
      audience,
    }));
  }
  return NextResponse.json({
    modes,
    moderators: modes[0].moderators,
    stages: stages.map((s) => ({
      key: s.key,
      label: s.label,
      layer: s.layer,
      situational: s.situational,
      rivals: s.rivals,
      recommended: s.recommended,
      mode: s.mode,
    })),
    scenarios: situations,
  });
}
