import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import { extractSnippet, extractSnippetExcluding } from "@/lib/engine/mention_filter";
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
    `dict_examples:v6:${id}:` +
    createHash("sha256").update(`${name.toLowerCase()}|${parent.toLowerCase()}`).digest("hex");
  const hit = await store.cacheGet(cacheKey, 30 * 24 * 3600 * 1000);
  if (hit) return NextResponse.json(JSON.parse(hit));

  const norm = (s: string) => s.trim().toLowerCase();
  const dict = await store.getDictionary(id);
  const parentEntry = dict.find((e) => norm(e.canonical) === norm(parent));
  const parentForms = parent ? [parent, ...(parentEntry?.aliases ?? [])] : [];
  const parentSeqs = parentForms.map(famTokens);
  const satSeq = famTokens(name);
  // Best-owner attribution, lead-preserving: a detected name refers to a
  // form only when one leads the other ("Prime Video" extends Prime;
  // "Amazon Prime" truncates Amazon Prime Video) - a trailing token match
  // ("Sonic Prime", "Optimus Prime") refers to neither. Each detection then
  // belongs to whichever form it matches most specifically; an exact match
  // of the satellite's own name is always the satellite.
  const eq = (a: string[], b: string[]) =>
    a.length === b.length && a.every((t, i) => t === b[i]);
  const matchScore = (det: string[], seq: string[]) => {
    if (eq(det, seq)) return seq.length + 0.5;
    if (containsSeq(det, seq) && det[0] === seq[0]) return seq.length;
    if (containsSeq(seq, det) && seq[0] === det[0]) return det.length;
    return 0;
  };
  const ownerOf = (det: string[]): "sat" | "parent" | null => {
    if (eq(det, satSeq)) return "sat";
    const ps = parentSeqs.reduce((m, seq) => Math.max(m, matchScore(det, seq)), 0);
    const ss = matchScore(det, satSeq);
    if (ss === 0 && ps === 0) return null;
    return ss > ps ? "sat" : "parent";
  };

  const rows = await store.listProjectBrandRows(id);
  const withParent: string[] = [];
  const alone: string[] = [];
  const brandsOf = new Map<string, string[]>();
  for (const r of rows) {
    brandsOf.set(r.responseId, r.brands);
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
  // Phrases whose occurrences must not be quoted as this name: longer
  // parent forms, plus any OTHER detected name in that answer that embeds
  // the satellite's tokens without co-referring ("Sonic Prime").
  const parentEmbedding = parentForms.filter((f) => {
    const ft = famTokens(f);
    return ft.length > satSeq.length && containsSeq(ft, satSeq);
  });
  const quotes = (ids: string[], showParent: boolean) =>
    sample(ids, 3)
      .map((rid) => {
        const text = texts.get(rid) ?? "";
        const strangers = (brandsOf.get(rid) ?? []).filter((b) => {
          const bt = famTokens(b);
          return (
            bt.length > satSeq.length &&
            containsSeq(bt, satSeq) &&
            ownerOf(bt) !== "sat"
          );
        });
        const satSnip = extractSnippetExcluding(text, name, [
          ...parentEmbedding,
          ...strangers,
        ]);
        if (!showParent || !satSnip) return satSnip;
        // The column claims co-occurrence - the quote must show it. If the
        // window doesn't already contain a parent form, append the parent's
        // own line from the same answer.
        const low = satSnip.toLowerCase();
        if (parentForms.some((f) => low.includes(f.toLowerCase()))) return satSnip;
        for (const f of parentForms) {
          const ps = extractSnippet(text, f, 90);
          if (ps) return `${satSnip} — same answer: ${ps}`;
        }
        return satSnip;
      })
      .filter(Boolean);
  const payload = {
    name,
    parent: parent || null,
    counts: { withParent: withParent.length, alone: alone.length },
    withParent: parent ? quotes(withParent, true) : [],
    alone: quotes(alone, false),
    /** Longer phrases embedding this name - the client skips bolding
     * occurrences inside them. */
    embedding: parentEmbedding,
  };
  await store.cacheSet(cacheKey, JSON.stringify(payload), { projectId: id });
  return NextResponse.json(payload);
}
