/**
 * Warm the executive-tier view caches after a deploy whose version bumps
 * invalidated them, so no customer's first click pays the recompute.
 * Hand-run from the repo root with the prod env in .env.local:
 *
 *   npx tsx scripts/warm_views.mts            # every un-archived tracker with a codes source
 *   npx tsx scripts/warm_views.mts Sephora    # only trackers whose brand contains an argument
 *
 * Per tracker it computes brand_summary, analysis_map, dossiers and the
 * composed brief through the same cached entry points the routes use, on the
 * run the dashboard shows (latest complete, else the latest coded run). A
 * warm cache answers in milliseconds; a miss computes and writes the cache
 * prod then serves. SPENDS pennies on a miss (views:themes and any unjudged
 * context-judge names), and on pass 2 it also warms each tracker's WRITTEN
 * brief frames (prewarmWrittenBriefs, the client brand only): a frame whose
 * fact sheet is unchanged is a cache hit and free, a re-keyed one costs one
 * Opus write (~6 cents) - so a deploy that changed no brief wording warms
 * written for $0, and a wording deploy pays what the first click would
 * have. Pass --no-written to skip that part.
 */
import fs from "node:fs";

// The routes run under Next with .env.local loaded; a bare tsx run must load
// it itself, before any engine import reads a key.
for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.RUN_COLLECT_ONLY = "1"; // belt and braces: this script codes nothing

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { computeBrandSummaryCached } = await import(process.cwd() + "/src/lib/engine/brand_summary.ts");
const { computeAnalysisMapCached } = await import(process.cwd() + "/src/lib/engine/analysis_map.ts");
const { computeDossiersCached } = await import(process.cwd() + "/src/lib/engine/dossiers.ts");
const { computeBriefCached } = await import(process.cwd() + "/src/lib/engine/brief.ts");
const { computeStationReasonsCached } = await import(process.cwd() + "/src/lib/engine/journey.ts");
const { prewarmWrittenBriefs, writtenBriefsEntitled } = await import(process.cwd() + "/src/lib/engine/brief_writer.ts");

const args = process.argv.slice(2);
const noWritten = args.includes("--no-written");
const filters = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());
const projects = (await store.listProjects()).filter(
  (p: { brand: string; archived_at?: string | null }) =>
    !p.archived_at && (filters.length === 0 || filters.some((f) => p.brand.toLowerCase().includes(f)))
);

// Two passes: a view computed while the context judge is still working its
// name tail is served but deliberately NOT cached (judgeIncomplete), so the
// first pass may leave it warm-but-uncached. By pass 2 the tail is judged
// and every view writes its cache; a pass-2 time over ~2s means a view is
// still not caching and deserves a look.
let warmed = 0;
for (const pass of [1, 2] as const) {
  for (const project of projects) {
    const source = await store.getCodesSource(project.id);
    if (!source) continue;
    const runs = await store.listRuns(project.id);
    let run = runs.find((r: { status: string }) => r.status === "complete") ?? null;
    if (!run) for (const r of runs) if ((await store.countAnswerCodes(r.id, source)) > 0) { run = r; break; }
    if (!run) continue;
    process.stdout.write(`[pass ${pass}] ${project.brand} (run ${String(run.id).slice(0, 8)}): `);
    for (const [label, go] of [
      ["summary", () => computeBrandSummaryCached(run, project)],
      ["map", () => computeAnalysisMapCached(run, project)],
      ["dossiers", () => computeDossiersCached(run, project)],
      ["brief", () => computeBriefCached(run, project)],
      // The Stations reasons blocks (j5, 2026-11-10) - all-buyers request; a
      // room-filtered open computes its own suffix-keyed entry on first use.
      ["stations", () => computeStationReasonsCached(run, project)],
    ] as const) {
      const t0 = Date.now();
      try {
        const view = await go();
        process.stdout.write(`${label} ${view ? ((Date.now() - t0) / 1000).toFixed(1) + "s" : "null"} · `);
      } catch (e) {
        process.stdout.write(`${label} FAILED (${e instanceof Error ? e.message.slice(0, 60) : e}) · `);
        process.exitCode = 1;
      }
    }
    if (pass === 2 && !noWritten) {
      // Written frames warm only for trackers whose owner is on a written
      // tier (2026-11-09, Tyler: "only do it for clients") - staff and
      // composed tiers generate lazily, or hand-run warm_written_briefs.mts.
      if (!(await writtenBriefsEntitled(project))) {
        process.stdout.write("written: owner is not a written-tier client - not warmed");
      } else {
        const t0 = Date.now();
        // The third argument is an ABSOLUTE deadline (Date.now() + budget), not a duration.
        const w = await prewarmWrittenBriefs(run, project, Date.now() + 10 * 60 * 1000);
        process.stdout.write(`written ${w.written} new / ${w.cached} cached / ${w.skipped} skipped ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        if (w.skipped > 0) process.exitCode = 1;
      }
    }
    process.stdout.write("\n");
    if (pass === 2) warmed++;
  }
}
console.log(`${warmed} tracker(s) warmed.`);
process.exit(process.exitCode ?? 0);
