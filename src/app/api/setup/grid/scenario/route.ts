import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { nearScenario, suggestScenario, type Moderators } from "@/lib/engine/instrument";

export const maxDuration = 60;

const Body = z.object({
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  decisionUnit: z.enum(["solo", "household", "committee"]),
  exclude: z
    .array(z.object({ label: z.string().trim().max(60), description: z.string().trim().max(240) }))
    .max(24),
  /** With nearTo, propose a near variant of that scenario instead of a new axis. */
  nearTo: z
    .object({ label: z.string().trim().min(1).max(60), description: z.string().trim().max(240) })
    .optional(),
});

/** Gate 1 helper: "suggest another" buying scenario, or with `nearTo` a
 * near variant of one already on the table. */
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
  const scenario = parsed.data.nearTo
    ? await nearScenario({
        category: parsed.data.category,
        audience: parsed.data.audience || null,
        of: parsed.data.nearTo,
        exclude: parsed.data.exclude.filter((s) => s.label),
      })
    : await suggestScenario({
        category: parsed.data.category,
        audience: parsed.data.audience || null,
        decisionUnit: parsed.data.decisionUnit as Moderators["decision_unit"],
        exclude: parsed.data.exclude.filter((s) => s.label),
      });
  if (!scenario) {
    return NextResponse.json({ error: "no new scenario came back - try again" }, { status: 502 });
  }
  return NextResponse.json({ scenario });
}
