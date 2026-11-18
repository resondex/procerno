import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { viewRequestParams } from "@/lib/engine/view_data";
import { computeTypeDetailCached, SECTIONS, type SectionKey } from "@/lib/engine/facts/type_detail";

/** Question type detail's sections, all from the run's one fact book (facts/type_detail.ts), one cached bundle per
 * (buyer filter, engine set). ?section=<name> returns that section: { view: ... }; { view: null } = no codes source
 * yet, or the tracker asks no question of that type. ?room=<situation> keeps the buyer's own cells in the sections
 * asked in one buyer's voice. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const section = new URL(req.url).searchParams.get("section") as SectionKey | null;
  if (!section || !(SECTIONS as readonly string[]).includes(section)) return NextResponse.json({ error: "unknown section" }, { status: 400 });
  const bundle = await computeTypeDetailCached(loaded.run, loaded.project, viewRequestParams(req));
  return NextResponse.json({ view: bundle?.[section] ?? null });
}
