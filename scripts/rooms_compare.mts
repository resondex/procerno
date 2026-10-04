/**
 * ROOMS COMPARE (2026-10-03): generate the scenario rooms for a brand set
 * with one engine arm, from NOTHING (fresh temp sqlite, no prod, no cache
 * reuse), on fixed inputs (category + audience + roster from a cold-walk
 * context file), and score them with the CURRENT contest check.
 *
 * Arms (one process each - each engine gets its own store):
 *   old      - the first-generation read (git worktree at eef7864, 2026-08-26)
 *   category - today's category read (the wizard default)
 *   brand    - today's brand-aware read (forBrand - what cold_walk uses)
 *
 * Usage: ARM=old OLD_REPO=<worktree> CTX_DIR=<cold_v2> OUT=<dir> npx tsx scripts/rooms_compare.mts "Google Pixel" ...
 * Spends API money (scenario reads + room checks) - run with Tyler's go.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(new URL(".", import.meta.url).pathname, "..");
const ARM = process.env.ARM ?? "category";
const CTX_DIR = process.env.CTX_DIR!;
const OUT = process.env.OUT!;
const BRANDS = process.argv.slice(2);
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.DATABASE_URL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), `procerno-rooms-${ARM}-`)));

const engineRoot = ARM === "old" ? process.env.OLD_REPO! : REPO;
const eng = await import(`${engineRoot}/src/lib/engine/instrument.ts`);
const cur = ARM === "old" ? null : eng;

const out: Record<string, unknown> = {};
for (const brand of BRANDS) {
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const ctx = JSON.parse(fs.readFileSync(path.join(CTX_DIR, `cold_context_${slug}.json`), "utf8"));
  const { category, audience } = ctx.profile;
  const t0 = Date.now();
  const read = ARM === "old"
    ? await eng.readScenarios({ category, audience })
    : await eng.readScenarios({ category, audience, ...(ARM === "brand" ? { forBrand: brand } : {}) });
  if (!read) { console.error(`${brand}: read returned null`); continue; }
  out[brand] = {
    category, audience,
    scenarios: read.scenarios.map((s: { label: string; description: string }) => ({ label: s.label, description: s.description })),
    reserve: (read.reserve ?? []).map((s: { label: string; description: string }) => ({ label: s.label, description: s.description })),
    roster: ctx.rosterRoles,
    secs: Math.round((Date.now() - t0) / 1000),
  };
  console.log(`${ARM} ${brand}: ${read.scenarios.map((s: { label: string }) => s.label).join(" | ")}`);
}
fs.writeFileSync(path.join(OUT, `rooms_${ARM}.json`), JSON.stringify(out, null, 2));
void cur;
process.exit(0);
