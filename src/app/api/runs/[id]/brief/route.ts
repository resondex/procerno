import { NextResponse } from "next/server";
import { requireAuth, requireRun } from "@/lib/auth";
import { store } from "@/lib/store";
import { matchKey } from "@/lib/brand_key";
import { viewRequestParams } from "@/lib/engine/view_data";
import { computeBriefCached } from "@/lib/engine/brief";
import { BRIEF_FRAMES, type BriefFrame } from "@/lib/engine/brief_types";
import { writeBrief } from "@/lib/engine/brief_writer";
import { productNoun } from "@/lib/engine/summary_insights";

/** A written memo is one streamed Opus call, plus one steered retry when a
 * guard fails. */
export const maxDuration = 300;

/** The Brief pill (bf1): all seven memo frames for one subject brand,
 * composed as finished sentences. ?subject=<brand> (absent = the tracker's
 * own brand) and ?engines=a,b,c (the Panel lens). { view: null } = no codes
 * source yet.
 *
 * ?written=1&frame=<frame> (option B, 2026-11-05): the same payload, then
 * that frame's memo through the fact-guarded writer (brief_writer.ts) -
 * returns { memo, written, reason? } instead of the payload. written:false
 * carries the composed memo. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const { engines } = viewRequestParams(req);
  const sp = new URL(req.url).searchParams;
  const subject = sp.get("subject") ?? undefined;
  const written = sp.get("written") === "1";
  const frame = sp.get("frame");
  if (written && !(BRIEF_FRAMES as string[]).includes(frame ?? "")) {
    return NextResponse.json({ error: "unknown frame" }, { status: 400 });
  }
  const view = await computeBriefCached(loaded.run, loaded.project, { ...(engines ? { engines } : {}), ...(subject ? { subject } : {}) });
  if (!written) return NextResponse.json({ view });
  const memo = view?.memos[frame as BriefFrame];
  if (!view || !memo) return NextResponse.json({ memo: null, written: false, reason: "unavailable" });
  const source = (await store.getCodesSource(loaded.project.id)) ?? "";
  const out = await writeBrief(memo, {
    runId: loaded.run.id,
    source,
    subjectKey: matchKey(view.subject),
    brand: view.subject,
    product: productNoun(loaded.project.category),
    projectId: loaded.project.id,
  });
  return NextResponse.json(out);
}
