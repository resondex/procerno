/**
 * Warm the Parents tab's suggested groups (parent_suggest.ts) for named
 * trackers and print what each board would be offered.
 *
 *   npx tsx scripts/warm_parent_suggestions.mts Netflix "American Express"
 *
 * SPENDS: never-seen active brand names go to PARENT_SUGGEST_MODEL (default
 * gpt-6-luna) in one batched call per 60 names - pennies per tracker, ledger
 * purpose dict:parents. Needs a per-run go like every API spend. Cached
 * names cost nothing; a rerun on a warm tracker makes zero model calls.
 *
 * Hand-run from the repo root with the prod env in .env.local. At least one
 * brand argument is required (no all-trackers default). Archived trackers
 * are skipped (archived_at IS NULL - duplicate brand rows exist by design).
 * Nothing is applied: groups are suggestions until a user clicks Accept.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.RUN_COLLECT_ONLY = "1"; // belt and braces: this script codes nothing

const filters = process.argv.slice(2).map((s) => s.toLowerCase());
if (filters.length === 0) {
  console.error("name at least one brand (substring match) - this script spends");
  process.exit(1);
}

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { suggestParents } = await import(process.cwd() + "/src/lib/engine/parent_suggest.ts");
const { tagCosts } = await import(process.cwd() + "/src/lib/cost_log.ts");

const projects = (await store.listProjects()).filter(
  (p: { brand: string; archived_at?: string | null }) =>
    !p.archived_at && filters.some((f) => p.brand.toLowerCase().includes(f))
);
if (projects.length === 0) console.log("no un-archived tracker matches");

for (const project of projects) {
  tagCosts({ projectId: project.id, purpose: "dict:parents" });
  const t0 = Date.now();
  const out = await suggestParents(project, { allowModel: true, deadlineMs: Date.now() + 240_000 });
  console.log(`\n${project.brand} (${project.id}) - ${out.groups.length} group(s), ${out.unjudged} unjudged, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const g of out.groups) {
    const members = g.members
      .map((m: { name: string; self?: boolean; you?: boolean; current: string | null }) =>
        `${m.name}${m.self ? " [the company]" : ""}${m.you ? " [your brand]" : ""}${m.current ? ` (now under ${m.current})` : ""}`)
      .join(", ");
    console.log(`  ${g.parent}: ${members}`);
  }
}
process.exit(0);
