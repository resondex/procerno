/**
 * The site owner check (site_owner.ts) on the run each tracker's dashboard shows: which of the sites the AI cites
 * are a tracked brand's own site. Hand-run from the repo root:
 *
 *   npx tsx scripts/warm_site_owners.mts --dry            # every un-archived tracker with a codes source: counts only
 *   npx tsx scripts/warm_site_owners.mts --dry Jira       # trackers whose brand contains an argument
 *   npx tsx scripts/warm_site_owners.mts Jira Netflix     # SPENDS
 *
 * SPENDS: sites cited by at least three answers with no saved verdict go to SITE_OWNER_MODEL (default gpt-6-luna),
 * about 40 sites per call - pennies a tracker, ledger purpose views:site_owner. Needs a per-run go like every API
 * spend; a live run needs at least one brand argument. A rerun on a checked tracker makes no call. A live run also
 * writes the run's verdict snapshot, which re-keys the Data page's workbench view once.
 *
 * --dry makes no call and writes nothing: per tracker, how many sites would be checked, how many already have a
 * verdict, the calls the rest would take, and - for the first tracker with anything to send - the full prompt of the
 * first call.
 *
 * Env: .env.local fills only variables not already set, so a fixture run blanks DATABASE_URL and the keys on the
 * command line, e.g.
 *   DATABASE_URL= OPENAI_API_KEY= SQLITE_PATH=data/dashboard_fixture.db npx tsx scripts/warm_site_owners.mts --dry
 * Only un-archived trackers are read.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.RUN_COLLECT_ONLY = "1"; // belt and braces: this script codes nothing

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const filters = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());
if (!dry && filters.length === 0) {
  console.error("name at least one brand (substring match) - a live run spends. Add --dry for the counts only.");
  process.exit(1);
}

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { dashboardRun } = await import(process.cwd() + "/src/lib/engine/prompt_health.ts");
const site = await import(process.cwd() + "/src/lib/engine/site_owner.ts");
const { SITE_OWNER_MODEL } = await import(process.cwd() + "/src/lib/engine/models.ts");

console.log(
  `store: ${process.env.DATABASE_URL ? "POSTGRES (prod)" : `sqlite ${process.env.SQLITE_PATH ?? "(default)"}`} · model ${SITE_OWNER_MODEL} · ` +
    `${dry ? "DRY - no model call, no writes" : `LIVE - spends and writes (key ${process.env.OPENAI_API_KEY ? "set" : "MISSING - nothing will be judged"})`}`
);

const projects = (await store.listProjects()).filter(
  (p: { brand: string; archived_at?: string | null }) => !p.archived_at && (filters.length === 0 || filters.some((f) => p.brand.toLowerCase().includes(f)))
);
if (projects.length === 0) console.log("no un-archived tracker matches");

let shownPrompt = false;
const tot = { sites: 0, cached: 0, misses: 0, calls: 0 };
for (const project of projects) {
  if (!(await store.getCodesSource(project.id))) continue;
  const run = await dashboardRun(project.id);
  if (!run) {
    console.log(`${project.brand}: no coded run`);
    continue;
  }
  if (dry) {
    const plan = await site.planSiteOwnerCheck(run, project);
    if (!plan) continue;
    const calls = Math.ceil(plan.misses.length / site.SITE_CHUNK);
    tot.sites += plan.sites.length;
    tot.cached += plan.cached.size;
    tot.misses += plan.misses.length;
    tot.calls += calls;
    console.log(
      `${project.brand} (run ${String(run.id).slice(0, 8)}): ${plan.sites.length} sites cited by ${site.SITE_MIN_ANSWERS}+ answers, ` +
        `${plan.cached.size} already checked, ${plan.misses.length} to check in ${calls} call(s); board of ${plan.board.length} brands. ` +
        `Most cited: ${plan.sites.slice(0, 6).map((s: { site: string; answers: number }) => `${s.site} ${s.answers}`).join(", ")}`
    );
    if (!shownPrompt && plan.misses.length > 0) {
      shownPrompt = true;
      const first = plan.misses.slice(0, site.SITE_CHUNK);
      console.log(`\n--- the first call's prompt (${project.brand}, ${first.length} sites) ---`);
      console.log(`[system]\n${site.siteOwnerSystemPrompt(project.category)}\n`);
      console.log(`[user]\n${site.siteOwnerUserMessage(plan.board, first)}`);
      console.log(`--- end of prompt ---\n`);
    }
    continue;
  }
  const t0 = Date.now();
  const w = await site.prewarmSiteOwners(run, project, { deadlineMs: Date.now() + 5 * 60 * 1000 });
  console.log(`${project.brand}: ${w.judged} judged, ${w.cached} already checked, ${w.failed} left, of ${w.sites} sites (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
if (dry) console.log(`\nTotal: ${tot.sites} sites, ${tot.cached} already checked, ${tot.misses} to check in ${tot.calls} call(s).`);
process.exit(0);
