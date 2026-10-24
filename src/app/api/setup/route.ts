import { NextResponse } from "next/server";
import { setupIdFromRequest, tagCosts } from "@/lib/cost_log";
import { z } from "zod";
import { requireMemberOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { getBrandProfile, getBattery } from "@/lib/engine/suggest";
import { engineFailed } from "./engine_error";

const schema = z.object({
  brand: z.string().trim().min(1).max(80),
  /** Grid-mode setup wants the profile only — the decision grid replaces the
   * classic battery, so drafting one here would waste the slowest call. */
  skipBattery: z.boolean().optional(),
});

export const maxDuration = 120;

/**
 * One-shot tracker setup: estimate the brand's market (call 1), then draft
 * the prompt battery for that estimate (call 2), both cache-first with a
 * ~6-month TTL, returned together.
 */
export async function POST(req: Request) {
  const auth = await requireMemberOrDemo();
  if (auth instanceof NextResponse) return auth;
  tagCosts({ setupId: await setupIdFromRequest(req, auth) });
  if (!apiKeyConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 503 }
    );
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "brand required" }, { status: 400 });
  }
  const brand = parsed.data.brand;
  try {
    const profile = await getBrandProfile(brand);
    if (parsed.data.skipBattery) {
      return NextResponse.json({ profile, prompts: null });
    }
    const prompts = await getBattery({
      brand,
      category: profile.category,
      competitors: profile.competitors,
      audience: profile.audience || null,
    });
    return NextResponse.json({ profile, prompts });
  } catch (err) {
    return engineFailed("setup", err, "the brand read could not be written - try again in a moment");
  }
}
