import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";

/** The taxonomy confirmation endpoint. GET returns the discovery-derived
 * proposal and status; POST ratifies the confirmed code list - the one
 * human/customer judgment in the discovery pipeline. Ratification writes
 * reason_taxonomy and flips taxonomy_status; it never touches answers. */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  return NextResponse.json({
    status: project.taxonomy_status,
    reason_taxonomy: project.reason_taxonomy,
    proposal: project.taxonomy_proposal ? JSON.parse(project.taxonomy_proposal) : null,
  });
}

const confirmSchema = z.object({
  codes: z.array(z.string().trim().min(1).max(80)).min(3).max(60),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  const parsed = confirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
  }
  const codes = [...new Set(parsed.data.codes.map((c) => c.toLowerCase()))];
  await store.ratifyTaxonomy(id, codes);
  return NextResponse.json({ ok: true, reason_taxonomy: codes, status: "ratified" });
}
