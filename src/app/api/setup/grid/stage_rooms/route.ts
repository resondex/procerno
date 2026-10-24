import { NextResponse } from "next/server";
import { setupIdFromRequest, tagCosts } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireMemberOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { judgeStageRooms } from "@/lib/engine/instrument";

export const maxDuration = 30;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  stageKey: z.string().trim().min(1).max(40),
  stageLabel: z.string().trim().min(1).max(60),
  /** The stage's hint as the wizard holds it - the longest real one
   * (problem_recognition) runs 861 chars; the old 600 cap 400'd it and
   * the map fell back to every room lit. */
  hint: z.string().trim().min(1).max(2000),
  rooms: z.array(z.object({ label: z.string().trim().min(1).max(60), description: z.string().trim().max(240) })).min(1).max(8),
});

/**
 * Coverage map (2026-10-06): the per-room default for a kept situational
 * stage the mask reaches nowhere - which rooms' buyers are the stage's
 * asker. Advisory: the dots stay editable; null = no judgment (the map
 * keeps every room lit).
 */
export async function POST(req: Request) {
  const auth = await requireMemberOrDemo();
  if (auth instanceof NextResponse) return auth;
  tagCosts({ setupId: await setupIdFromRequest(req, auth) });
  if (!apiKeyConfigured()) return NextResponse.json({ rooms: null });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  // Advisory: a thrown judgment is "no judgment" (every room lit), the
  // same answer as no key - never a bare 500 the map cannot read.
  const rooms = await judgeStageRooms({ ...parsed.data, meta: { brand: parsed.data.brand, source: cacheSource(auth) } })
    .catch((err) => {
      console.error("stage_rooms: judgment failed - every room stays lit:", err);
      return null;
    });
  return NextResponse.json({ rooms });
}
