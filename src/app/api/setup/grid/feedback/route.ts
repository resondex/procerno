import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { store } from "@/lib/store";

const Situation = z.object({
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240),
});

const Body = z.object({
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
  kind: z.literal("review_choice"),
  items: z
    .array(
      z.object({
        current: Situation,
        suggestion: Situation,
        flag: z.enum(["typo", "phrasing", "mixed"]),
        reason: z.string().max(400),
        choice: z.enum(["suggestion", "mine"]),
      })
    )
    .min(1)
    .max(8),
});

/** Append-only setup feedback from the client (what the user chose in the
 * scenario review overlay). For OUR visibility only - nothing here is ever
 * read back into generation: one user's rejections say nothing about
 * quality. */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  await store
    .feedbackAdd({
      email: auth.email,
      category: parsed.data.category,
      audience: parsed.data.audience || null,
      kind: parsed.data.kind,
      payload: { items: parsed.data.items },
    })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
