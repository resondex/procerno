import { NextResponse } from "next/server";
import { tagSetupFromRequest } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { planValueLines } from "@/lib/engine/instrument";

export const maxDuration = 120;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  scenarios: z
    .array(z.object({ label: z.string().trim().min(1).max(60), description: z.string().trim().max(240) }))
    .min(1)
    .max(4),
});

/** The Value lines the gate proposes (2026-10-04): per room, the brand's
 * most premium line a buyer there could buy and the generic option one
 * tier below it (null = no fitting line, no Value cell). The user's edits
 * are decision data stored on the draft and sent with the cells request -
 * this route only serves the default. */
export async function POST(req: Request) {
  tagSetupFromRequest(req);
  const auth = await requireAuthOrDemo();
  if (auth instanceof NextResponse) return auth;
  if (!apiKeyConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const lines = await planValueLines({
    brand: parsed.data.brand,
    category: parsed.data.category,
    audience: parsed.data.audience || null,
    rooms: parsed.data.scenarios,
    meta: { source: cacheSource(auth) },
  }).catch(() => null);
  return NextResponse.json({ valueLines: lines ?? {} });
}
