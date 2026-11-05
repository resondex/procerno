/**
 * Warm the written Briefs (option B) of named trackers - the client brand's
 * seven frames only, never rivals.
 *
 * SPENDS MONEY: one Opus writing call per frame not already cached (~6 cents
 * a frame, ~42 cents a tracker), plus context-judge and condition-embedding
 * pennies if the composed brief itself is not cached yet. Per-run go
 * required (AGENTS.md).
 *
 *   npx tsx scripts/warm_written_briefs.mts "American Express" [Jira ...]
 *
 * Env comes from .env.local (DATABASE_URL, ANTHROPIC_API_KEY, ...); values
 * already in the environment win. Each brand resolves to its UN-ARCHIVED
 * project (archived September trackers share brand names by design) and its
 * newest complete run, else its newest collected run - the run the dashboard
 * shows. Writes go only through the store's llm_cache and cost_log, via
 * writeBrief. 10-minute deadline per tracker.
 */
import fs from "node:fs";

const brands = process.argv.slice(2);
if (!brands.length) {
  console.error('usage: npx tsx scripts/warm_written_briefs.mts "<brand>" ["<brand>" ...]');
  process.exit(1);
}

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const { store } = await import("../src/lib/store");
const { prewarmWrittenBriefs } = await import("../src/lib/engine/brief_writer");

const projects = (await store.listProjects()).filter((p) => p.archived_at === null);
for (const brand of brands) {
  const matches = projects.filter((p) => p.brand.toLowerCase() === brand.toLowerCase());
  if (matches.length !== 1) {
    console.log(`${brand}: ${matches.length === 0 ? "no un-archived project" : `${matches.length} un-archived projects - refusing to guess`}`);
    continue;
  }
  const project = matches[0];
  const source = await store.getCodesSource(project.id);
  const runs = await store.listRuns(project.id);
  const run = runs.find((r) => r.status === "complete") ?? runs.find((r) => r.status === "collected");
  if (!source || !run) {
    console.log(`${brand}: ${!source ? "no codes source" : "no complete or collected run"} - nothing to warm`);
    continue;
  }
  const t0 = Date.now();
  const r = await prewarmWrittenBriefs(run, project, Date.now() + 10 * 60_000);
  console.log(
    `${brand} (run ${run.id}, ${source}): ${r.written} written, ${r.cached} cached, ${r.skipped} skipped - ${Math.round((Date.now() - t0) / 1000)}s`
  );
}
process.exit(0);
