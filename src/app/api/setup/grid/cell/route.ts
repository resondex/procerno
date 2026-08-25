import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import {
  regenerateCell,
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
  cell: z.object({
    stage: z.string().trim().min(1).max(60),
    situation: z.string().trim().max(60).nullable(),
    angle: z.string().trim().min(1).max(80),
    mode: z.string().trim().max(300).nullable(),
  }),
  /** Every text already offered for this cell. */
  avoid: z.array(z.string().trim().min(1).max(2000)).min(1).max(8),
});

/** Gate 2 helper: one fresh prompt for a single cell, different from every
 * previous offer - the "New prompt" button. */
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
  const text = await regenerateCell({
    brand: parsed.data.brand,
    category: parsed.data.category,
    competitors: parsed.data.competitors,
    audience: parsed.data.audience || null,
    base: parsed.data.base as unknown as Moderators,
    scenarios: parsed.data.scenarios as ScenarioSpec[],
    cell: parsed.data.cell,
    avoid: parsed.data.avoid,
  });
  if (!text) {
    return NextResponse.json({ error: "no new prompt came back - try again" }, { status: 502 });
  }
  return NextResponse.json({ text });
}
