import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/store";
import { requireAuth, requireRun } from "@/lib/auth";
import { ENGINES, engineDisplayLabel } from "@/lib/engine/providers";

/** A pivot cell opens at most this many of its answers. */
const MAX_IDS = 50;

const Body = z.object({ ids: z.array(z.string().min(1)).min(1).max(MAX_IDS) });

/**
 * The evidence drill (2026-10-30): answer bodies by id for one run, behind
 * any analysis-lens cell (the Metrics pivot first). POST, since a cell's ids
 * outgrow a query string. Same read-level guard as the view routes and the
 * same switch as the evidence drawer: a tracker with the drawer off serves
 * no answer bodies. Every id must belong to this run - membership is checked
 * against the run's meta rows (no bodies), and only the requested bodies are
 * fetched. No model calls.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const loaded = await requireRun(id, auth);
  if (loaded instanceof NextResponse) return loaded;
  const { run, project } = loaded;
  if (!project.evidence_drawer) {
    return NextResponse.json(
      { error: "The evidence drawer is switched off for this tracker" },
      { status: 403 }
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `ids required (1 to ${MAX_IDS})` }, { status: 400 });
  }
  const ids = [...new Set(parsed.data.ids)];

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
  const engineLabel = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));

  const answers = ids.map((x) => {
    const r = byId.get(x)!;
    const model = r.model || run.model;
    return {
      id: x,
      engine: engineLabel.get(model) ?? model,
      promptText: promptText.get(r.prompt_id) ?? "",
      text: textById.get(x) ?? "",
    };
  });
  return NextResponse.json({ answers });
}
