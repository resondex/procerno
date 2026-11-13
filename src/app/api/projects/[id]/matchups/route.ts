import { NextResponse } from "next/server";
import { z } from "zod";
import { ADDED_MATCHUP_FEE_USD, canWrite, getAuth, projectAccess, requireMember, requireProject } from "@/lib/auth";
import { MatchupError, matchupState, queueMatchup, realMatchupWriter, undoMatchup } from "@/lib/server/matchups";

/**
 * "Ask this matchup" (2026-11-13). GET (read-level) returns the queue, the
 * tracker's live direct matchups, the included slots and the per-wave fee
 * for an added matchup, plus whether the caller may change it. POST queues
 * one (member + write access; it writes the questions now - model spend at
 * the customer's click, ledger purpose matchup:write). DELETE undoes a
 * queued one. Share-link viewers read, never write.
 */

/** Writing the seed, its checks and nine checked paraphrases takes minutes. */
export const maxDuration = 300;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  const state = await matchupState(id, ADDED_MATCHUP_FEE_USD);
  const access = await projectAccess(project, auth);
  return NextResponse.json({ ...state, canWrite: !auth.shareProjectId && canWrite(access) });
}

const postSchema = z.object({
  /** The rival's dictionary entry id. */
  rival: z.string().trim().min(1).max(200),
  mode: z.enum(["add", "swap"]),
  /** A swap's matchup to stop asking (its rival key from GET's `current`). */
  drop: z.string().trim().min(1).max(200).nullable().optional(),
  /** The per-wave fee the user saw and confirmed (an added matchup past the included slots). */
  fee: z.number().min(0).max(100000).nullable().optional(),
});

function failed(err: unknown) {
  if (err instanceof MatchupError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("matchups route failed:", err);
  return NextResponse.json({ error: "Something went wrong - nothing was changed." }, { status: 500 });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  try {
    const out = await queueMatchup(
      { write: realMatchupWriter },
      {
        project,
        rivalId: parsed.data.rival,
        mode: parsed.data.mode,
        dropId: parsed.data.drop ?? null,
        feePerWave: ADDED_MATCHUP_FEE_USD,
        feeConfirmed: parsed.data.fee ?? null,
        userId: auth.userId,
      }
    );
    return NextResponse.json({ ...out.state, entry: out.entry, canWrite: true });
  } catch (err) {
    return failed(err);
  }
}

const deleteSchema = z.object({ entry: z.string().trim().min(1).max(200) });

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  try {
    const state = await undoMatchup(project.id, parsed.data.entry, ADDED_MATCHUP_FEE_USD);
    return NextResponse.json({ ...state, canWrite: true });
  } catch (err) {
    return failed(err);
  }
}
