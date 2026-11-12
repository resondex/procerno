import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMember, requireProject } from "@/lib/auth";
import { tagCosts } from "@/lib/cost_log";
import { claimRunLease, releaseRunLease } from "@/lib/engine/runner";
import { parseExamples } from "@/lib/engine/prompt_flags";
import { actOnFlag, firstWaveReview, stagedReady } from "@/lib/engine/wording_review";

// A replace with no staged answers collects and codes the new wording on
// the whole panel before it swaps (search engines take 20-30s an answer).
export const maxDuration = 300;

/** The first-wave wording review's data (2026-11-11). Members with write
 * access only: a share link or a read-only member never sees the review -
 * they get a 401 / 403 and the dashboard renders as if there were none. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const review = await firstWaveReview(project);
  if (!review) return NextResponse.json({ review: null });
  const textOf = new Map(review.prompts.map((p) => [p.id, p.text]));
  const flags = await Promise.all(
    review.flags.map(async (f) => {
      const siblings = review.prompts.filter(
        (p) => p.intent_id === f.intent_id && p.id !== f.prompt_id && p.retired === 0
      );
      return {
        id: f.id,
        promptId: f.prompt_id,
        text: textOf.get(f.prompt_id) ?? f.prompt_text,
        rate: f.rate,
        siblingsRate: f.siblings_rate,
        answers: f.answers,
        siblingCount: siblings.length,
        examples: parseExamples(f.examples),
        suggestion: f.suggested_text,
        ready: await stagedReady(project, review.run, f),
      };
    })
  );
  return NextResponse.json({
    review: { runId: review.run.id, category: project.category, brand: project.brand, flags },
  });
}

const Body = z.object({
  flagId: z.string().min(1).max(80),
  action: z.enum(["replace", "keep"]),
  text: z.string().trim().min(4).max(2000).optional(),
});

/** Resolve one flag: "replace" swaps in the suggested (or edited) wording;
 * "keep" keeps the flagged one. Write-level members only. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  tagCosts({ projectId: project.id });
  // One action per flag at a time: a double click must not collect twice.
  const leaseKey = `prompt_flag_act:${parsed.data.flagId}`;
  const token = await claimRunLease(leaseKey).catch(() => null);
  if (!token) return NextResponse.json({ error: "this flag is already being resolved" }, { status: 409 });
  try {
    const res = await actOnFlag(project, parsed.data.flagId, parsed.data.action, parsed.data.text, Date.now() + 230_000);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.code });
    return NextResponse.json(res);
  } finally {
    await releaseRunLease(leaseKey, token);
  }
}
