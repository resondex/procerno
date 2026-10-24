import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { requireMember } from "@/lib/auth";

/** One draft in full (wizard state included) - read when a draft is
 * resumed; the list (GET /api/drafts) carries only the summary. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const draft = await store.getSetupDraft(id);
  if (!draft || (auth.userId !== null && draft.user_id !== auth.userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ draft });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const draft = await store.getSetupDraftOwner(id);
  if (!draft || (auth.userId !== null && draft.user_id !== auth.userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await store.deleteSetupDraft(id);
  return NextResponse.json({ ok: true });
}
