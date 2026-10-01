import { NextResponse } from "next/server";
import { tagSetupFromRequest } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireAuth } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { buildInstrument } from "@/lib/engine/instrument";

export const maxDuration = 120;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  competitors: z.array(z.string().trim().min(1).max(80)).max(12),
  /** Typed roster (2026-09-30): competitor -> same_seat | upstream.
   * Absent = every competitor same_seat (the untyped behavior). */
  rosterRoles: z.record(z.string().max(80), z.enum(["same_seat", "upstream"])).optional(),
  /** Class-angle cells (2026-10-01): upstream brand -> buyer class phrase
   * ("a Visa card"). Only upstream entries with a phrase earn a class
   * cell. Absent = no class cells (byte-identical behavior). */
  rosterClasses: z.record(z.string().max(80), z.string().trim().max(60)).optional(),
  audience: z.string().trim().max(160).optional(),
});

/**
 * The instrument designer's setup call: classified category → composed
 * stages → situations → a grid of prompts. The classic path (/api/setup +
 * /api/prompts/generate) is untouched; this is the alternative battery
 * builder, chosen in the setup UI.
 */
export async function POST(req: Request) {
  tagSetupFromRequest(req);
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (!apiKeyConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 503 }
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { brand, category, competitors, audience } = parsed.data;
  const instrument = await buildInstrument({
    brand,
    category,
    competitors,
    audience: audience || null,
    rosterRoles: parsed.data.rosterRoles,
    rosterClasses: parsed.data.rosterClasses,
    meta: { source: cacheSource(auth) },
  });
  return NextResponse.json({ instrument });
}
