import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthOrDemo } from "@/lib/auth";
import { store } from "@/lib/store";

const Situation = z.object({
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(240),
});

const Base = z.object({
  category: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(160).optional(),
});

const Body = z.discriminatedUnion("kind", [
  Base.extend({
    kind: z.literal("review_choice"),
    items: z
      .array(
        z.object({
          current: Situation,
          suggestion: Situation,
          flags: z.array(z.enum(["typo", "phrasing", "mixed"])).min(1).max(3),
          reason: z.string().max(400),
          choice: z.enum(["suggestion", "mine"]),
        })
      )
      .min(1)
      .max(8),
  }),
  // A near-neighbor draw: the user swapped `rejected` for `drawn`.
  Base.extend({
    kind: z.literal("near_draw"),
    rejected: Situation,
    drawn: Situation,
  }),
  // What the user chose in the prompt review overlay.
  Base.extend({
    kind: z.literal("cell_review_choice"),
    items: z
      .array(
        z.object({
          current: z.string().max(2000),
          suggestion: z.string().max(2000),
          flags: z.array(z.enum(["target", "branding", "unclear"])).min(1).max(3),
          reason: z.string().max(400),
          choice: z.enum(["suggestion", "mine"]),
        })
      )
      .min(1)
      .max(24),
  }),
]);

/** Append-only setup feedback from the client (what the user chose in the
 * scenario review overlay). For OUR visibility only - nothing here is ever
 * read back into generation: one user's rejections say nothing about
 * quality. */
export async function POST(req: Request) {
  const auth = await requireAuthOrDemo();
  if (auth instanceof NextResponse) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const d = parsed.data;
  await store
    .feedbackAdd({
      email: auth.email,
      category: d.category,
      audience: d.audience || null,
      kind: d.kind,
      payload:
        d.kind === "near_draw"
          ? { rejected: d.rejected, drawn: d.drawn }
          : { items: d.items },
    })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
