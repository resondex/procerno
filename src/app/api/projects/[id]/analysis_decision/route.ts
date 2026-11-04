import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth, requireMember, requireProject } from "@/lib/auth";
import { store } from "@/lib/store";
import {
  MAX_POSITIONS,
  TRIAGES,
  mergeAnalysisDecision,
  parseAnalysisDecision,
} from "@/lib/analysis_decision";
import type { Triage } from "@/lib/engine/analysis_types";

/** The analysis tier's Portfolio record (2026-11-03): per position, the
 * engine's suggested triage vs the customer's decided one, and whether it is
 * in the playbook. GET reads the record; POST merges ONE position into it
 * (never replaces the record). Writes are member + write-role only - a
 * share-link viewer can read the dashboard but never triage it. */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  const decision = parseAnalysisDecision(await store.getAnalysisDecision(id));
  return NextResponse.json({ decision });
}

const triage = z.enum(TRIAGES as [Triage, ...Triage[]]);

const patchSchema = z.object({
  cellId: z.string().trim().min(1).max(200),
  suggested: triage,
  /** null clears the override back to the suggestion. */
  decided: triage.nullable().optional(),
  /** false removes the position from the playbook. */
  inPlaybook: z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireMember();
  if (auth instanceof NextResponse) return auth;
  const project = await requireProject(id, auth, { write: true });
  if (project instanceof NextResponse) return project;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
  }
  const prev = parseAnalysisDecision(await store.getAnalysisDecision(id));
  if (
    prev &&
    !(parsed.data.cellId in prev.positions) &&
    Object.keys(prev.positions).length >= MAX_POSITIONS
  ) {
    return NextResponse.json({ error: "too many positions recorded" }, { status: 400 });
  }
  const decision = mergeAnalysisDecision(prev, parsed.data);
  await store.setAnalysisDecision(id, JSON.stringify(decision));
  return NextResponse.json({ decision });
}
