import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { extractSnippet } from "@/lib/engine/mention_filter";

export const maxDuration = 60;

/**
 * Verbatim evidence for a dictionary name: real answer snippets showing how
 * the answers actually use it, split into "named alongside <parent>" and
 * "named alone" so the co-occurrence number becomes something the user can
 * read with their own eyes. Fully mechanical - detection rows pick the
 * answers, a boundary regex extracts the sentence. Cached per (name,
 * parent); answers are never modified.
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

  const cacheKey =
    `dict_examples:v2:${id}:` +
    createHash("sha256").update(`${name.toLowerCase()}|${parent.toLowerCase()}`).digest("hex");
  const hit = await store.cacheGet(cacheKey, 30 * 24 * 3600 * 1000);
  if (hit) return NextResponse.json(JSON.parse(hit));

  const norm = (s: string) => s.trim().toLowerCase();
  const dict = await store.getDictionary(id);
  const parentEntry = dict.find((e) => norm(e.canonical) === norm(parent));
  const parentTerms = parent
    ? [norm(parent), ...(parentEntry?.aliases.map(norm) ?? [])]
    : [];
  const satTerm = norm(name);

  const rows = await store.listProjectBrandRows(id);
  const withParent: string[] = [];
  const alone: string[] = [];
  for (const r of rows) {
    let hasSat = false;
    let hasParent = false;
    for (const b of r.brands) {
      const nb = norm(b);
      if (!hasSat && nb.includes(satTerm)) hasSat = true;
      if (!hasParent && parentTerms.some((t) => nb.includes(t))) hasParent = true;
      if (hasSat && hasParent) break;
    }
    if (!hasSat) continue;
    (hasParent ? withParent : alone).push(r.responseId);
  }
  // Spread the sample across the run instead of taking neighbors.
  const sample = (ids: string[], n: number) => {
    if (ids.length <= n) return ids;
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(ids[Math.floor((i * ids.length) / n)]);
    return out;
  };
  const wanted = [...sample(withParent, 3), ...sample(alone, 3)];
  const texts = new Map(
    (await store.getResponseTexts(wanted)).map((t) => [t.id, t.text])
  );
  const quotes = (ids: string[]) =>
    sample(ids, 3)
      .map((rid) => extractSnippet(texts.get(rid) ?? "", name))
      .filter(Boolean);
  const payload = {
    name,
    parent: parent || null,
    counts: { withParent: withParent.length, alone: alone.length },
    withParent: parent ? quotes(withParent) : [],
    alone: quotes(alone),
  };
  await store.cacheSet(cacheKey, JSON.stringify(payload), { projectId: id });
  return NextResponse.json(payload);
}
