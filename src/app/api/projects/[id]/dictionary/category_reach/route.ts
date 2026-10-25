import { NextResponse } from "next/server";
import { getAuth, requireProject } from "@/lib/auth";
import { checkCategoryReach } from "@/lib/engine/category_reach";
import { store } from "@/lib/store";
import { matchKey } from "@/lib/brand_key";

export const maxDuration = 60;

/**
 * Category-reach advisory (2026-10-23): do the APPROVED competitors on the
 * board fall outside the category label's wording? Cached per (label,
 * brand, approved set) in engine/category_reach, so the gate and Analysis
 * settings read it as a cache hit after the first look. Advisory only -
 * accepting the suggestion is a plain PATCH { category } the user clicks.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const brandKey = matchKey(project.brand);
  const legacy = new Set(project.competitors.map((c) => c.trim().toLowerCase()));
  const competitors = (await store.getDictionary(id))
    .filter(
      (e) =>
        e.status === "active" &&
        e.canonical !== "Other" &&
        matchKey(e.canonical) !== brandKey &&
        !e.aliases.some((a) => matchKey(a) === brandKey) &&
        (e.role ? e.role === "competitor" : legacy.has(e.canonical.trim().toLowerCase()))
    )
    .map((e) => e.display_name ?? e.canonical);
  const reach = await checkCategoryReach({
    brand: project.brand,
    category: project.category,
    competitors,
    meta: { projectId: id },
  });
  return NextResponse.json({ category: project.category, reach });
}
