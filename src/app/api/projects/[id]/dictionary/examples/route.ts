import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { extractSnippetExcluding } from "@/lib/engine/mention_filter";
import { familyContains } from "@/lib/engine/observations";
import { containsSeq, famTokens } from "@/lib/engine/dict_suggest";

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
    `dict_examples:v4:${id}:` +
    createHash("sha256").update(`${name.toLowerCase()}|${parent.toLowerCase()}`).digest("hex");
  const hit = await store.cacheGet(cacheKey, 30 * 24 * 3600 * 1000);
  if (hit) return NextResponse.json(JSON.parse(hit));

  const norm = (s: string) => s.trim().toLowerCase();
  const dict = await store.getDictionary(id);
  const parentEntry = dict.find((e) => norm(e.canonical) === norm(parent));
  const parentForms = parent ? [parent, ...(parentEntry?.aliases ?? [])] : [];
  const parentSeqs = parentForms.map(famTokens);
  const satSeq = famTokens(name);
  // Best-owner attribution: each detected name belongs to whichever form it
  // matches most specifically. "Amazon Prime Video" scores 3 for the parent
  // and 1 for satellite "Prime", so it is parent evidence ONLY - a name
  // that is a token of its parent's name no longer counts every parent
  // mention as its own.
  const matchScore = (det: string[], seq: string[]) => {
    if (containsSeq(det, seq)) return seq.length;
    if (familyContains(seq, det)) return det.length;
    return 0;
  };
  const ownerOf = (det: string[]): "sat" | "parent" | null => {
    const ps = parentSeqs.reduce((m, seq) => Math.max(m, matchScore(det, seq)), 0);
    const ss = matchScore(det, satSeq);
    if (ss === 0 && ps === 0) return null;
    return ss > ps ? "sat" : "parent";
  };

  const rows = await store.listProjectBrandRows(id);
  const withParent: string[] = [];
  const alone: string[] = [];
  for (const r of rows) {
    let hasSat = false;
    let hasParent = false;
    for (const b of r.brands) {
      const owner = ownerOf(famTokens(b));
      if (owner === "sat") hasSat = true;
      else if (owner === "parent") hasParent = true;
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
  // Longer parent forms that embed the satellite's tokens: occurrences
  // inside them are the parent's name, not a bare use of this one.
  const embedding = parentForms.filter((f) => {
    const ft = famTokens(f);
    return ft.length > satSeq.length && containsSeq(ft, satSeq);
  });
  const quotes = (ids: string[]) =>
    sample(ids, 3)
      .map((rid) => extractSnippetExcluding(texts.get(rid) ?? "", name, embedding))
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
