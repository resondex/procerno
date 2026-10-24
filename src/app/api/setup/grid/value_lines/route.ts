import { NextResponse } from "next/server";
import { setupIdFromRequest, tagCosts } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireMemberOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { planValueLinesFull } from "@/lib/engine/instrument";
import { engineFailed } from "../../engine_error";

// 300, not 120: planValueLinesFull waits up to COALESCE_PENDING_TTL_MS
// (180s) on another request's in-flight read - a 120s budget turned that
// wait into a 504. Fluid Compute allows 300.
export const maxDuration = 300;

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
  const auth = await requireMemberOrDemo();
  if (auth instanceof NextResponse) return auth;
  tagCosts({ setupId: await setupIdFromRequest(req, auth) });
  if (!apiKeyConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  // A failed read is a 502, never 200 + empty: the client reads a missing
  // room as "No Value cell", so an empty success silently removed every
  // Value cell from the battery (2026-10-24 audit).
  let full: Awaited<ReturnType<typeof planValueLinesFull>>;
  try {
    full = await planValueLinesFull({
      brand: parsed.data.brand,
      category: parsed.data.category,
      audience: parsed.data.audience || null,
      rooms: parsed.data.scenarios,
      meta: { source: cacheSource(auth) },
    });
  } catch (err) {
    return engineFailed("value_lines", err, "the Value lines are still being read - try again in a moment");
  }
  if (!full) {
    return NextResponse.json(
      { error: "the Value lines are still being read - try again in a moment" },
      { status: 502 }
    );
  }
  return NextResponse.json({ valueLines: full.rooms, valueCatalog: full.catalog });
}
