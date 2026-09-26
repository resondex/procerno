import { NextResponse } from "next/server";
import { requireAuth, requireProject } from "@/lib/auth";
import { getDictionarySuggestions } from "@/lib/engine/dict_suggest";

export const maxDuration = 120;

/**
 * AI pre-review of the pending dictionary queue. Returns proposed
 * dispositions only — nothing is applied without the batch confirm.
 * Cache-first: the expensive pass runs at run completion, so this is
 * normally an instant cache read.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const project = await requireProject(id, auth);
  if (project instanceof NextResponse) return project;
  // A missing OPENAI_API_KEY no longer 503s here: cached verdicts and the
  // mechanical family layer still serve (dict_suggest skips only the model
  // pass), so a pre-warmed board renders instead of a hard error.
  const suggestions = await getDictionarySuggestions(id, project.category);
  return NextResponse.json({ suggestions });
}
