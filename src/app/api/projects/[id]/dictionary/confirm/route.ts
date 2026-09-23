import { NextResponse } from "next/server";
import { getAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";

/** The brand-dictionary gate: the second confirmation after the codebook.
 * Marks the dictionary reviewed; coding waits on both gates. Edits to the
 * dictionary itself go through the existing dictionary endpoints. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  if (project.taxonomy_status !== "ratified") {
    return NextResponse.json(
      { error: "confirm the codebook first" },
      { status: 409 }
    );
  }
  await store.confirmDictionary(id);
  return NextResponse.json({ ok: true, dictionary_status: "confirmed" });
}
