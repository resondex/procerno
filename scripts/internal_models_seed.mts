/**
 * Test C - setup pre-fill jobs on all 11 projects: suggestBrandProfile
 * (category / competitors / audience from the brand name alone) and
 * seedDictionary (starting aliases for [brand, ...competitors]), both the
 * real functions. seedDictionary's cache is bypassed and its dictionary
 * insert captured in memory - nothing reaches any store.
 * Env: BRAND_PROFILE_MODEL + DICT_SEED_MODEL + ARM. Output internal_models/seed/<ARM>.json
 */
import fs from "node:fs";
import { ARM, RUNS, closeProd, errors, localUsage, outDir, prod, REPO } from "./internal_models_common.mts";

const { suggestBrandProfile, seedDictionary } = await import(`${REPO}/src/lib/engine/suggest`);
const { store } = await import(`${REPO}/src/lib/store`);
const models = await import(`${REPO}/src/lib/engine/models`);

let captured: { canonical: string; aliases: string[] }[] = [];
Object.assign(store as object, {
  cacheGet: async () => null,
  cacheSet: async () => {},
  insertDictionaryEntries: async (_pid: string, entries: { canonical: string; aliases: string[] }[]) => {
    captured = entries.map((e) => ({ canonical: e.canonical, aliases: e.aliases }));
  },
});

// PROFILE_ONLY=1 (2026-10-14 rerun): brand profile only, the 11 test-C brands
// (the profile reads the brand name alone, so one row per name - the October
// trackers reuse five of these names).
const PROFILE_ONLY = process.env.PROFILE_ONLY === "1";
const TEST_C_BRANDS = ["AG1", "American Express", "athenahealth", "Doritos", "Google Nest", "Google Pixel", "jira", "Netflix", "Purple", "PwC", "Sephora"];
const projects = PROFILE_ONLY
  ? await prod`SELECT DISTINCT ON (brand) id, brand, category, audience, competitors FROM projects WHERE brand = ANY(${TEST_C_BRANDS}) ORDER BY brand, created_at`
  : await prod`SELECT id, brand, category, audience, competitors FROM projects ORDER BY brand`;
const out: Record<string, unknown> = { arm: ARM, profileModel: models.BRAND_PROFILE_MODEL, seedModel: models.DICT_SEED_MODEL, projects: {} };
for (const p of projects) {
  const competitors = JSON.parse(p.competitors) as string[];
  const res = { configured: { category: p.category, audience: p.audience, competitors }, profiles: [] as unknown[], seeds: [] as unknown[] };
  for (let i = 0; i < RUNS; i++) {
    const [profile] = await Promise.all([
      suggestBrandProfile(p.brand).catch((e: Error) => ({ error: e.message })),
      PROFILE_ONLY ? Promise.resolve() : (async () => { captured = []; await seedDictionary(`eval-${p.id}`, [p.brand, ...competitors]); res.seeds.push(captured); })(),
    ]);
    res.profiles.push(profile);
  }
  (out.projects as Record<string, unknown>)[p.brand] = res;
  console.log(`${ARM} ${p.brand}: done`);
}
out.usage = await localUsage();
out.errors = errors;
fs.writeFileSync(`${outDir("seed")}/${ARM}.json`, JSON.stringify(out, null, 1));
await closeProd();
process.exit(0);
