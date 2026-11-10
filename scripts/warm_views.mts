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
 * context-judge names, both cached 183 days); written-tier briefs are NOT
 * warmed here - that is scripts/warm_written_briefs.mts, with its own go.
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

const filters = process.argv.slice(2).map((s) => s.toLowerCase());
const projects = (await store.listProjects()).filter(
  (p: { brand: string; archived_at?: string | null }) =>
    !p.archived_at && (filters.length === 0 || filters.some((f) => p.brand.toLowerCase().includes(f)))
);

let warmed = 0;
for (const project of projects) {
  const source = await store.getCodesSource(project.id);
  if (!source) continue;
  const runs = await store.listRuns(project.id);
  let run = runs.find((r: { status: string }) => r.status === "complete") ?? null;
  if (!run) for (const r of runs) if ((await store.countAnswerCodes(r.id, source)) > 0) { run = r; break; }
  if (!run) continue;
  process.stdout.write(`${project.brand} (run ${String(run.id).slice(0, 8)}): `);
  for (const [label, go] of [
    ["summary", () => computeBrandSummaryCached(run, project)],
    ["map", () => computeAnalysisMapCached(run, project)],
    ["dossiers", () => computeDossiersCached(run, project)],
    ["brief", () => computeBriefCached(run, project)],
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
  process.stdout.write("\n");
  warmed++;
}
console.log(`${warmed} tracker(s) warmed.`);
process.exit(process.exitCode ?? 0);
