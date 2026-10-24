import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/store";
import { requireMember } from "@/lib/auth";
import type { SetupDraft } from "@/lib/types";

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().max(120).default(""),
  competitors: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  audience: z.string().trim().max(160).optional(),
  prompts: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(2000),
        theme: z.enum([
          "discovery",
          "recommendation",
          "comparison",
          "use_case",
          "branded",
        ]),
      })
    )
    .nullable()
    .default(null),
  wizard: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** The list row the trackers page renders: the wizard blob reduced to
 * its summary, exactly as store.listSetupDraftMeta projects it. Resuming
 * a draft reads the full row from GET /api/drafts/[id]. */
function draftMeta(d: SetupDraft): SetupDraft {
  const w = d.wizard;
  return {
    ...d,
    wizard: w ? { mode: w.mode ?? null, step: w.step ?? null, studyName: w.studyName ?? null } : null,
  };
}

/** Members only (never a share link: every share viewer is the same
 * "share" user). Meta rows - the wizard blobs stay in the database
 * (2026-10-24 egress fix; the list refetches after every step save). */
export async function GET() {
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const drafts = await store.listSetupDraftMeta(auth.userId);
  return NextResponse.json({ drafts });
}

export async function POST(req: Request) {
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
  }
  if (parsed.data.id) {
    // Ownership probe only - the stored blob is never read back here.
    const existing = await store.getSetupDraftOwner(parsed.data.id);
    if (existing && existing.user_id !== auth.userId && auth.userId !== null) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }
  const draft = await store.saveSetupDraft({
    id: parsed.data.id ?? null,
    userId: auth.userId,
    brand: parsed.data.brand,
    category: parsed.data.category,
    competitors: parsed.data.competitors,
    audience: parsed.data.audience || null,
    prompts: parsed.data.prompts,
    wizard: parsed.data.wizard ?? null,
  });
  // The client already holds what it just sent; echo the list row only.
  return NextResponse.json({ draft: draftMeta(draft) }, { status: 201 });
}
