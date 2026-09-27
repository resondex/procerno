import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getPlanFor, requireAuth, requireRun } from "@/lib/auth";
import { buildCanonicalizer } from "@/lib/engine/metrics";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { tagCosts } from "@/lib/cost_log";
import { explainNegativeVerbatim } from "@/lib/engine/verbatims";

export const maxDuration = 120;
const CACHE_MS = 365 * 24 * 3600 * 1000;

/**
 * On-demand negative-verbatim extraction for any brand: a second read of the
 * stored answers, asking only for quotes about the requested brand. Cached
 * per (run, brand, dictionary version); the frozen coder stays frozen.
 * Plan-gated: free has no Risk view; pro reads the client's verbatims (which
 * ship in metrics already); all-brand extraction is the top tiers' feature.
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
  const brand = new URL(req.url).searchParams.get("brand")?.trim().slice(0, 120);
  if (!brand) return NextResponse.json({ error: "brand required" }, { status: 400 });
  const plan = await getPlanFor(auth);
  if (plan === "free") {
    return NextResponse.json({ error: "upgrade required" }, { status: 402 });
  }
  const dictionary = await store.getDictionary(project.id);
  const canon = buildCanonicalizer(dictionary);
  const norm = canon.norm(brand);
  if (plan !== "enterprise" && norm !== canon.norm(project.brand)) {
    return NextResponse.json(
      { error: "competitor verbatims require a higher tier" },
      { status: 402 }
    );
  }
  if (!apiKeyConfigured()) {
    return NextResponse.json({ error: "extraction unavailable" }, { status: 503 });
  }
  // v2: gpt-6-luna - gpt-4o-mini's "verbatim" quotes were absent from the
  // answer 28% of the time (internal-model test F).
  const cacheKey = `verbatims:v2:${id}:${norm}:${project.dictionary_version}`;
  const hit = await store.cacheGet(cacheKey, CACHE_MS);
  if (hit) return NextResponse.json({ verbatims: JSON.parse(hit) });

  const [responses, mentions, prompts] = await Promise.all([
    store.listResponses(id),
    store.listMentionsForRun(id),
    store.listPrompts(project.id),
  ]);
  const promptText = new Map(prompts.map((p) => [p.id, p.text]));
  const negativeIds = new Set(
    mentions
      .filter((m) => m.framing === "negative" && canon.norm(m.brand) === norm)
      .map((m) => m.response_id)
  );
  const rows = responses.filter((r) => negativeIds.has(r.id)).slice(0, 12);
  const display = canon.canonical(brand);
  tagCosts({ purpose: "run:verbatims" });
  const out = await Promise.all(
    rows.map(async (r) => {
      try {
        const parsed = await explainNegativeVerbatim(display, r.text);
        return {
          promptText: promptText.get(r.prompt_id) ?? "",
          quote: parsed.quote,
          interpretation: parsed.interpretation,
        };
      } catch {
        return { promptText: promptText.get(r.prompt_id) ?? "", quote: null, interpretation: null };
      }
    })
  );
  await store.cacheSet(cacheKey, JSON.stringify(out));
  return NextResponse.json({ verbatims: out, model: run.model });
}
