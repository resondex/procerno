import { NextResponse } from "next/server";
import { tagSetupFromRequest } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { judgeStageRooms } from "@/lib/engine/instrument";

export const maxDuration = 30;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  stageKey: z.string().trim().min(1).max(40),
  stageLabel: z.string().trim().min(1).max(60),
  hint: z.string().trim().min(1).max(600),
  rooms: z.array(z.object({ label: z.string().trim().min(1).max(60), description: z.string().trim().max(240) })).min(1).max(8),
});

/**
 * Coverage map (2026-10-06): the per-room default for a kept situational
 * stage the mask reaches nowhere - which rooms' buyers are the stage's
 * asker. Advisory: the dots stay editable; null = no judgment (the map
 * keeps every room lit).
 */
export async function POST(req: Request) {
  tagSetupFromRequest(req);
  const auth = await requireAuthOrDemo();
  if (auth instanceof NextResponse) return auth;
  if (!apiKeyConfigured()) return NextResponse.json({ rooms: null });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const rooms = await judgeStageRooms({ ...parsed.data, meta: { brand: parsed.data.brand, source: cacheSource(auth) } });
  return NextResponse.json({ rooms });
}
