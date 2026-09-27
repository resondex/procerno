/**
 * Test F - negative-verbatim explanations (explainNegativeVerbatim, the
 * real request). 60 answers the v4 reference labels mark target_framing =
 * negative, 15 per tracker (seeded), texts from the response vault. Scored
 * mechanically (quote present, verbatim in the answer, <= 200 chars) plus
 * a blind side-by-side for Tyler.
 * Env: VERBATIM_MODEL + ARM. Output internal_models/verbatims/<ARM>.json
 */
import fs from "node:fs";
import { ARM, RUNS, closeProd, errors, localUsage, outDir, seeded, vaultAnswers, REPO } from "./internal_models_common.mts";

const { explainNegativeVerbatim } = await import(`${REPO}/src/lib/engine/verbatims`);
const { VERBATIM_MODEL } = await import(`${REPO}/src/lib/engine/models`);

const BRANDS: [string, string, string][] = [
  ["jira", "jira", "jira"],
  ["amex", "american_express", "American Express"],
  ["netflix", "netflix", "Netflix"],
  ["pixel", "google_pixel", "Google Pixel"],
];
const rows: { brand: string; id: string; text: string }[] = [];
for (const [dir, vault, display] of BRANDS) {
  const truth = fs.readFileSync(`${process.env.HOME}/Documents/procerno_eval/${dir}/v4_truth_${dir}.jsonl`, "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.target_framing === "negative");
  const answers = vaultAnswers(vault);
  for (const r of seeded(truth, 20260926).slice(0, 15)) {
    const a = answers.get(r.id);
    if (a) rows.push({ brand: display, id: r.id, text: a.text });
  }
}
const results: unknown[] = [];
await Promise.all(rows.map(async (r) => {
  const runs: unknown[] = [];
  for (let i = 0; i < Math.min(RUNS, 2); i++) {
    try { runs.push(await explainNegativeVerbatim(r.brand, r.text)); }
    catch (e) { runs.push({ error: (e as Error).message.slice(0, 200) }); }
  }
  results.push({ brand: r.brand, id: r.id, runs });
}));
console.log(`${ARM}: ${rows.length} answers x ${Math.min(RUNS, 2)} runs`);
fs.writeFileSync(`${outDir("verbatims")}/${ARM}.json`, JSON.stringify({ arm: ARM, model: VERBATIM_MODEL, results, usage: await localUsage(), errors }, null, 1));
await closeProd();
process.exit(0);
