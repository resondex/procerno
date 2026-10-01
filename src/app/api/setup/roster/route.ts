import { NextResponse } from "next/server";
import { tagSetupFromRequest } from "@/lib/cost_log";
import { z } from "zod";
import { requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { classifyRoster } from "@/lib/engine/roster";

export const maxDuration = 120;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  competitors: z.array(z.string().trim().min(1).max(80)).max(12),
});

/** Market step: type each competitor by who it sells to and derive its
 * role for this tracker's audience (same_seat | upstream). Cache-first;
 * fails open to all same_seat. The wizard's chip toggle is the gate. */
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
  const roster = await classifyRoster({
    brand: parsed.data.brand,
    category: parsed.data.category,
    audience: parsed.data.audience || null,
    competitors: parsed.data.competitors,
  });
  return NextResponse.json({ roster });
}
