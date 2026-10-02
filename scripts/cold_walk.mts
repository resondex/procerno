/**
 * COLD WALK TO SEED: the full setup chain for one or more brands from
 * NOTHING - suggestBrandProfile -> classifyRoster -> composeInstrument ->
 * generateWorries -> recommended picks -> recommended coverage -> cells.
 * Store = sqlite in a fresh temp dir: no prod reads, no prod writes, no
 * cache reuse between runs. Defaults accepted everywhere a user would click
 * through (scenarios as proposed, worry picks = the planner's plan,
 * coverage = recommended stages). Spends API money (gpt-5 writer + market
 * read + sonnet checks, roughly $2-4 and 5-10 minutes per brand) - run only
 * with Tyler's go, per the standing rules.
 *
 * Usage: COLD_OUT=<dir> npx tsx scripts/cold_walk.mts "Jira" "American Express" ...
 * Output per brand: <dir>/cold_seeds_<brand>.json (one object per cell:
 * i/stage/situation/angle/concern/classPhrase/scope/qtype/seedFlags/text)
 * and <dir>/cold_context_<brand>.json (profile, roster, scenarios, picks).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(new URL(".", import.meta.url).pathname, "..");
const OUT = process.env.COLD_OUT ?? os.tmpdir();
const BRANDS = process.argv.slice(2);
if (BRANDS.length === 0) {
  console.error('usage: COLD_OUT=<dir> npx tsx scripts/cold_walk.mts "Brand One" "Brand Two"');
  process.exit(1);
}
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.DATABASE_URL; // store -> sqlite in the temp cwd below
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "procerno-cold-walk-")));
console.log("cold store at:", process.cwd());

const inst = await import(`${REPO}/src/lib/engine/instrument.ts`);
const { classifyRoster } = await import(`${REPO}/src/lib/engine/roster.ts`);
const { suggestBrandProfile } = await import(`${REPO}/src/lib/engine/suggest.ts`);

for (const brand of BRANDS) {
  const t0 = Date.now();
  const profile = await suggestBrandProfile(brand);
  console.log(`\n=== ${brand}\n[1 profile] category="${profile.category}" audience="${profile.audience}"`);
  console.log(`  competitors (${profile.competitors.length}):`, profile.competitors.join(", "));

  const roster = await classifyRoster({ brand, category: profile.category, audience: profile.audience, competitors: profile.competitors });
  const rosterRoles = Object.fromEntries(roster.competitors.map((v) => [v.name, v.role]));
  const rosterClasses = Object.fromEntries(roster.competitors.filter((v) => v.consumerSalient && v.classPhrase).map((v) => [v.name, v.classPhrase!]));
  console.log(`[2 roster] roles:`, JSON.stringify(rosterRoles), "classes:", JSON.stringify(rosterClasses));

  const compose = await inst.composeInstrument({ category: profile.category, audience: profile.audience, forBrand: brand });
  if (!compose) { console.error(`${brand}: compose returned null`); continue; }
  console.log(`[3 market read] scenarios:`, compose.scenarios.map((s: { label: string }) => s.label).join(" | "));

  const offered = compose.stages
    .filter((s: { key: string; recommended: boolean }) => s.recommended && (inst.WORRY_STANCE_STAGES as readonly string[]).includes(s.key))
    .map((s: { key: string }) => s.key);
  const pool = await inst.generateWorries({ brand, category: profile.category, audience: profile.audience, scenarios: compose.scenarios, offered });
  if (!pool) { console.error(`${brand}: worries returned null`); continue; }
  const planned = pool.flatMap((w: { worry: string; recommend?: string[] }) => (w.recommend ?? []).map((st) => ({ concern: w.worry, stage: st })));
  const picks = planned.length > 0 ? planned : pool.map((w: { worry: string; recommended: string }) => ({ concern: w.worry, stage: w.recommended }));
  console.log(`[4 worries] pool ${pool.length}, picks ${picks.length}`);

  const kept = new Set<string>(compose.stages.filter((s: { recommended: boolean }) => s.recommended).map((s: { key: string }) => s.key));
  for (const p of picks) kept.add(p.stage);
  const stages = compose.stages.filter((s: { key: string }) => kept.has(s.key));
  console.log(`[5 cells] ${stages.length} stages kept - generating COLD`);

  const report: { missing: { stage: string; situation: string | null; angle: string }[]; reason?: string } = { missing: [] };
  let cells = null;
  for (let drive = 0; drive < 4; drive++) {
    const td = Date.now();
    cells = await inst.generateGrid({
      brand, category: profile.category, competitors: profile.competitors,
      audience: profile.audience || null, base: compose.base, scenarios: compose.scenarios,
      stages, rosterRoles, rosterClasses, worries: picks, report,
      meta: { source: "script:cold-walk" },
    } as never);
    console.log(`drive ${drive + 1}: ${cells ? cells.length + " cells" : `null (${report.reason ?? "holes"})`} in ${((Date.now() - td) / 1000).toFixed(1)}s, flagged: ${cells?.filter((c: { seedFlags?: string[] }) => c.seedFlags?.length).length ?? "-"}`);
    if (cells && drive > 0) break;
  }
  if (!cells) { console.error(`${brand}: generation incomplete after 4 drives`); continue; }
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const seeds = cells.map((c: Record<string, unknown>, i: number) => ({
    i: i + 1, stage: c.stage, situation: c.situation, angle: c.angle,
    concern: c.concern ?? null, classPhrase: c.classPhrase ?? null,
    scope: c.scope ?? null, qtype: c.qtype, seedFlags: c.seedFlags ?? null, text: c.text,
  }));
  fs.writeFileSync(path.join(OUT, `cold_seeds_${slug}.json`), JSON.stringify(seeds, null, 2));
  fs.writeFileSync(path.join(OUT, `cold_context_${slug}.json`), JSON.stringify({ profile, rosterRoles, rosterClasses, scenarios: compose.scenarios, picks, keptStages: [...kept], missing: report.missing }, null, 2));
  console.log(`${brand}: ${seeds.length} seeds in ${((Date.now() - t0) / 1000).toFixed(0)}s -> cold_seeds_${slug}.json${report.missing.length ? ` (MISSING ${report.missing.length} rows)` : ""}`);
}
process.exit(0);
