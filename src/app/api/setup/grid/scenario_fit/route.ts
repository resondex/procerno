import { NextResponse } from "next/server";
import { z } from "zod";
import { cacheSource, requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { reviewScenarioFit } from "@/lib/engine/instrument";

export const maxDuration = 60;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  scenarios: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        description: z.string().trim().max(240),
      })
    )
    .min(1)
    .max(8),
});

/**
 * Portfolio-fit advisory: does each scenario fall within what THIS brand
 * sells, and does a flagship line lack a scenario? Advisory only - the
 * scenarios gate never blocks on it, and a failure returns empty advice.
 */
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
  try {
    const fit = await reviewScenarioFit({
      brand: parsed.data.brand,
      category: parsed.data.category,
      scenarios: parsed.data.scenarios,
      meta: { source: cacheSource(auth) },
    });
    return NextResponse.json({ fit });
  } catch {
    // Advice, not measurement: silence beats an error banner here.
    return NextResponse.json({ fit: { offPortfolio: [], missingCore: null } });
  }
}
