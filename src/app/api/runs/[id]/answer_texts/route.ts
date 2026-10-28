import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { requireAuth, requireRun } from "@/lib/auth";
import { ENGINES } from "@/lib/engine/providers";

/** The view payloads carry small id samples (8 per condition group). */
const MAX_IDS = 20;

/**
 * Answer bodies by id for one run - opens the answers behind a view's
 * sample ids (the head-to-head conditions panel). Same read-level guard as
 * the view routes. Every id must belong to this run: membership is checked
 * against the run's meta rows (no bodies), and only the requested bodies are
 * fetched. No model calls.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const { run, project } = loaded;
  // Same switch as the evidence route: both serve the answer bodies behind a
  // figure, so turning the drawer off closes this door too.
  if (!project.evidence_drawer) {
    return NextResponse.json(
      { error: "The evidence drawer is switched off for this tracker" },
      { status: 403 }
    );
  }

  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `at most ${MAX_IDS} ids` }, { status: 400 });
  }

  const meta = await store.listResponseMeta(id);
  const byId = new Map(meta.map((r) => [r.id, r]));
  if (ids.some((x) => !byId.has(x))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [texts, prompts] = await Promise.all([
    store.getResponseTexts(ids),
    store.listPrompts(project.id),
  ]);
  const textById = new Map(texts.map((t) => [t.id, t.text]));
  const promptText = new Map(prompts.map((p) => [p.id, p.text]));
  const engineLabel = new Map(ENGINES.map((e) => [e.id, e.label]));

  const answers = ids.map((x) => {
    const r = byId.get(x)!;
    const model = r.model || run.model;
    return {
      id: x,
      engine: model,
      engineLabel: engineLabel.get(model) ?? model,
      question: promptText.get(r.prompt_id) ?? "",
      text: textById.get(x) ?? "",
    };
  });
  return NextResponse.json({ answers });
}
