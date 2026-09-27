/**
 * Test B - junk-name filter (classifyNonBrands, the real function). Input
 * per tracker = every name on the confirmed board except the seeded brands
 * (what the filter saw as pending), plus 10 planted non-brand descriptors,
 * in one call like prod. Scored: real brands wrongly flagged (the costly
 * error - a flagged name never reaches the board), planted descriptors
 * caught, stability across runs.
 * Env: JUNK_FILTER_MODEL + ARM. Output internal_models/junk/<ARM>.json
 */
import fs from "node:fs";
import { ARM, RUNS, closeProd, errors, localUsage, norm, outDir, prod, seeded, trackers, REPO } from "./internal_models_common.mts";

const { classifyNonBrands } = await import(`${REPO}/src/lib/engine/suggest`);
const { JUNK_FILTER_MODEL } = await import(`${REPO}/src/lib/engine/models`);

// Planted descriptors, written for this test (category-generic, one
// slash-compound of two tracked rivals each - the prompt names that case).
const PLANTED: Record<string, string[]> = {
  jira: ["a shared spreadsheet", "self-hosted server", "open-source tools", "the reporting module", "Asana/Trello", "a custom build", "kanban board", "email threads", "the admin console", "sticky notes"],
  "American Express": ["a debit card", "the rewards portal", "a local credit union", "Visa/Mastercard", "cash back card", "store card", "the mobile app", "a secured card", "balance transfer offer", "the issuer's website"],
  Netflix: ["cable TV", "a streaming stick", "free ad-supported channels", "Hulu/Disney+", "the kids profile", "live TV bundle", "a VPN", "DVD rental", "the recommendation algorithm", "local channels"],
  "Google Pixel": ["a flagship phone", "the camera app", "Android phones", "iPhone/Galaxy", "a budget phone", "the charger", "carrier store", "a refurbished phone", "the launcher", "a smartwatch"],
};

const out: Record<string, unknown> = { arm: ARM, model: JUNK_FILTER_MODEL, brands: {} };
for (const t of await trackers()) {
  const rows = await prod`SELECT canonical, aliases, status FROM dictionary_entries WHERE project_id=${t.id}`;
  const seeds = new Set([t.brand, ...t.competitors].map(norm));
  // board truth: active canonical or alias of an active entry = real, kept brand
  const kept = new Set<string>();
  for (const r of rows) if (r.status === "active") { kept.add(norm(r.canonical)); for (const a of JSON.parse(r.aliases)) kept.add(norm(a)); }
  const names = [...new Set(rows.map((r) => r.canonical as string).filter((n) => !seeds.has(norm(n)) && n !== "Other"))];
  const input = seeded([...names, ...PLANTED[t.brand]], 20260926);
  const runs: string[][] = [];
  for (let i = 0; i < RUNS; i++) {
    const flagged = await classifyNonBrands(input);
    runs.push([...flagged].sort());
    console.log(`${ARM} ${t.brand} run ${i}: ${flagged.size} flagged of ${input.length}`);
  }
  (out.brands as Record<string, unknown>)[t.brand] = {
    input,
    planted: PLANTED[t.brand].map(norm),
    kept: names.map(norm).filter((n) => kept.has(n)),
    ignoredOnBoard: names.map(norm).filter((n) => !kept.has(n)),
    runs,
  };
}
out.usage = await localUsage();
out.errors = errors;
fs.writeFileSync(`${outDir("junk")}/${ARM}.json`, JSON.stringify(out, null, 1));
await closeProd();
process.exit(0);
