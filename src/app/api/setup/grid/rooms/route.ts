import { NextResponse } from "next/server";
import { tagSetupFromRequest } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { checkRooms } from "@/lib/engine/instrument";

export const maxDuration = 60;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  /** Direct rivals only (same_seat + bench). */
  rivals: z.array(z.string().trim().min(1).max(80)).max(12),
  /** The head-to-head picks - the contest bar reads them. */
  picks: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  rooms: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        description: z.string().trim().max(240),
      })
    )
    .min(1)
    // Eight suggested rooms + custom rows + the advisory's suggestion can
    // pass ten; rooms past the cap silently showed no chip.
    .max(16),
});

/**
 * Scenarios gate contest check (init decision 4): which direct rivals
 * compete in each room, any one-brand pitch wording, and any tracked brand
 * a room names. Advisory - the gate never blocks on it, and a failure
 * returns no verdicts.
 */
export async function POST(req: Request) {
  tagSetupFromRequest(req);
  const auth = await requireAuthOrDemo();
  if (auth instanceof NextResponse) return auth;
  if (!apiKeyConfigured()) {
    return NextResponse.json({ checks: [] });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    const checks = await checkRooms({
      brand: parsed.data.brand,
      category: parsed.data.category,
      rivals: parsed.data.rivals,
      picks: parsed.data.picks,
      rooms: parsed.data.rooms,
      meta: { brand: parsed.data.brand, source: cacheSource(auth) },
    });
    return NextResponse.json({ checks });
  } catch {
    return NextResponse.json({ checks: [] });
  }
}
