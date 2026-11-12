import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { store } from "@/lib/store";
import { computeWorkbenchCached } from "@/lib/engine/workbench";
import { viewRequestParams } from "@/lib/engine/view_data";

/** How many older runs to look through for the previous coded wave. */
const PREV_LOOKBACK = 6;

/** The Workbench fact table read from answer_codes under the project's
 * codes_source: one load per open, every filter slices in the browser.
 * { view: null } = no codes source yet.
 *
 * `prev` (2026-11-11, the Data page's Wave over wave): the id of the
 * previous run of the same project with coded answers under the project's
 * codes_source - the wave a table is compared against - or null. It rides
 * BESIDE the cached view, never inside it, so it is no part of the view's
 * key. The client fetches that run's payload through this same route, so
 * the same access guards apply to it. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const view = await computeWorkbenchCached(loaded.run, loaded.project, viewRequestParams(req));
  let prev: string | null = null;
  const source = loaded.project.codes_source;
  if (view && source) {
    // listRuns is newest first: the runs after this one are older.
    const runs = await store.listRuns(loaded.project.id);
    const at = runs.findIndex((r) => r.id === loaded.run.id);
    if (at >= 0) {
      for (const r of runs.slice(at + 1, at + 1 + PREV_LOOKBACK)) {
        if (r.status === "failed") continue;
        if ((await store.countAnswerCodes(r.id, source)) > 0) {
          prev = r.id;
          break;
        }
      }
    }
  }
  return NextResponse.json({ view, prev });
}
