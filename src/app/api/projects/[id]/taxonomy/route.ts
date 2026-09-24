import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";

/** The taxonomy confirmation endpoint - the one human judgment in the
 * discovery pipeline. GET returns the proposal and status; POST ratifies a
 * full decision record: per-code include/exclude, cosmetic renames, merges
 * (members fold into a new canonical), and user-added codes. The record is
 * stored verbatim alongside the machine's recommendation so
 * recommended-vs-decided is analyzable across brands. Never touches answers. */

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
    decision: project.taxonomy_decision ? JSON.parse(project.taxonomy_decision) : null,
  });
}

const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const decisionSchema = z.object({
  decisions: z
    .array(
      z.object({
        /** Proposal code this row decides, or the new name of an added code. */
        canonical: z.string().trim().min(1).max(80),
        recommended: z.enum(["include", "review"]),
        decided: z.enum(["include", "exclude"]),
        /** Cosmetic rename; canonical stays the coding key. */
        display_name: z.string().trim().min(1).max(80).optional(),
        /** Set when this code was folded into a merge group. */
        merged_into: z.string().trim().min(1).max(80).optional(),
        /** True for codes the user typed in themselves. */
        added: z.boolean().optional(),
      })
    )
    .min(3)
    .max(120),
  /** Merge groups: new canonical -> member proposal codes. */
  merges: z.record(z.string(), z.array(z.string()).min(2)).default({}),
  /** Micro reassignments: phrase -> the code it now belongs to. Recorded in
   * the decision and applied when the relabel/coding prompts are built. */
  phrase_moves: z.record(z.string().max(120), z.string().max(80)).default({}),
  /** Display names of merge groups (target -> name), so a reopened review
   * shows the name the user gave the merged dimension. */
  merge_names: z.record(z.string(), z.string().trim().min(1).max(80)).default({}),
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
  const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
  }
  const { decisions, merges, phrase_moves, merge_names } = parsed.data;

  // The ratified list: every included, un-merged canonical, plus each merge
  // group's target once, deduped. Merged members ride under their target.
  const codes: string[] = [];
  for (const d of decisions) {
    if (d.decided !== "include" || d.merged_into) continue;
    codes.push(slug(d.canonical));
  }
  for (const target of Object.keys(merges)) {
    const t = slug(target);
    if (!codes.includes(t)) codes.push(t);
  }
  const finalCodes = [...new Set(codes.filter(Boolean))];
  if (finalCodes.length < 3 || finalCodes.length > 60) {
    return NextResponse.json(
      { error: `ratified list must be 3-60 codes (got ${finalCodes.length})` },
      { status: 400 }
    );
  }

  const record = JSON.stringify({
    decided_at: new Date().toISOString(),
    decisions,
    merges,
    phrase_moves,
    merge_names,
    ratified: finalCodes,
  });
  await store.ratifyTaxonomy(id, finalCodes, record);
  return NextResponse.json({ ok: true, reason_taxonomy: finalCodes, status: "ratified" });
}

/** Back from the brands gate to the codebook: un-ratify so the review can be
 * revised. Only allowed before the brand dictionary is confirmed - after
 * that, coding has been released against this list. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  if (project.dictionary_status === "confirmed") {
    return NextResponse.json(
      { error: "brands are already confirmed - coding has started on this codebook" },
      { status: 409 }
    );
  }
  await store.reopenTaxonomy(id);
  return NextResponse.json({ ok: true, status: "proposed" });
}
