import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { reviewScenarios } from "@/lib/engine/instrument";
import { store } from "@/lib/store";

export const maxDuration = 60;

const Situation = z.object({
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240),
});

const Body = z.object({
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  /** The user-written or user-edited scenarios to check. */
  candidates: z.array(Situation).min(1).max(8),
  /** The rest of the table, for the distinctness test. */
  others: z.array(Situation).max(12),
});

/** Gate 1 helper: quality check on user-authored scenarios at the gate
 * confirm - verdicts in candidate order, each with a minimal suggested
 * edit when not ok. */
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
  const verdicts = await reviewScenarios({
    category: parsed.data.category,
    audience: parsed.data.audience || null,
    candidates: parsed.data.candidates,
    others: parsed.data.others,
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
        kind: "review_flagged",
        payload: { items: flagged },
      })
      .catch(() => {});
  }
  return NextResponse.json({ verdicts });
}
