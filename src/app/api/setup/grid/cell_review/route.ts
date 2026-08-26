import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { reviewCells } from "@/lib/engine/instrument";
import { store } from "@/lib/store";

export const maxDuration = 60;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  competitors: z.array(z.string().trim().min(1).max(80)).max(8),
  audience: z.string().trim().max(160).optional(),
  /** The user-edited or user-written prompts to check, each with its
   * cell's design context; `original` is the last machine wording. */
  candidates: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(2000),
        original: z.string().trim().max(2000).nullable().optional(),
        stage: z.string().trim().min(1).max(80),
        hint: z.string().trim().max(300).nullable().optional(),
        tag: z.string().trim().max(20).nullable().optional(),
        situation: z.string().trim().max(60).nullable(),
        situationDescription: z.string().trim().max(240).nullable().optional(),
        angle: z.string().trim().min(1).max(80),
        mode: z.string().trim().max(300).nullable().optional(),
      })
    )
    .min(1)
    .max(24),
});

/** Gate 2 helper: quality check on user-edited prompts at the gate
 * confirm - verdicts in candidate order, each with a minimal suggested
 * edit when not ok. */
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
  const verdicts = await reviewCells({
    brand: parsed.data.brand,
    category: parsed.data.category,
    competitors: parsed.data.competitors,
    audience: parsed.data.audience || null,
    candidates: parsed.data.candidates.map((c) => ({
      text: c.text,
      original: c.original ?? null,
      stage: c.stage,
      hint: c.hint ?? null,
      tag: c.tag ?? null,
      situation: c.situation,
      situationDescription: c.situationDescription ?? null,
      angle: c.angle,
      mode: c.mode ?? null,
    })),
  });
  const flagged = verdicts
    .map((v, i) => ({ candidate: parsed.data.candidates[i], verdict: v }))
    .filter((x) => !x.verdict.ok);
  if (flagged.length > 0) {
    // Visibility only - never read back into generation.
    await store
      .feedbackAdd({
        email: auth.email,
        category: parsed.data.category,
        audience: parsed.data.audience || null,
        kind: "cell_review_flagged",
        payload: { items: flagged },
      })
      .catch(() => {});
  }
  return NextResponse.json({ verdicts });
}
