import { NextResponse } from "next/server";
import { getAuth, requireProject } from "@/lib/auth";
import { buildDictionaryExamples } from "@/lib/engine/dict_examples";

export const maxDuration = 60;

/**
 * Verbatim evidence for a dictionary name. The computation (and its
 * per-(name, parent) cache) lives in engine/dict_examples so the bootstrap
 * can pre-warm exactly what this endpoint serves - a flagged pill's click
 * is normally an instant cache hit.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim();
  const parent = (url.searchParams.get("parent") ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const payload = await buildDictionaryExamples(id, name, parent);
  return NextResponse.json(payload);
}
