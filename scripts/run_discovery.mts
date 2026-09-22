/**
 * Discovery driver: open-code a collected brand from its vault export using
 * the engine discovery module (grok-4-fast, temp 0). Costs land in the prod
 * ledger via the metered client, tagged discovery:open with the project id -
 * visible in the admin financials like every other vendor call. Output is
 * local JSONL only; prod answer tables untouched.
 *
 * Usage: npx tsx scripts/run_discovery.mts <brand-key> <vault.jsonl.gz> <out.jsonl>
 *          [--coverage 1.0] [--project <prod project id>]
 * coverage < 1 samples equally per engine (deterministic, seed 20260922).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const [brand, vaultPath, outPath] = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const coverage = Number(arg("coverage", "1"));
const projectId = arg("project", "") || null;
if (!brand || !vaultPath || !outPath) {
  console.error("usage: tsx scripts/run_discovery.mts <brand> <vault.jsonl.gz> <out.jsonl> [--coverage 1.0] [--project id]");
  process.exit(1);
}

const { runOpenDiscovery } = await import("../src/lib/engine/discovery");
const { withCostContext } = await import("../src/lib/cost_log");

const rows = zlib.gunzipSync(fs.readFileSync(vaultPath)).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
const prompts: Record<string, string> = {};
for (const p of rows[0].prompts) prompts[p.id] = p.text;
const done = new Set<string>(
  fs.existsSync(outPath)
    ? fs.readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).responseId)
    : []
);
const answers = (rows.slice(1) as { id: string; prompt_id: string; model: string; text: string }[])
  .filter((r) => !done.has(r.id))
  .map((r) => ({ id: r.id, engine: r.model, prompt: prompts[r.prompt_id] ?? "", text: r.text }));
console.log(`${brand}: ${answers.length} answers to code (coverage ${coverage}, done ${done.size})`);

const out = fs.createWriteStream(outPath, { flags: "a" });
const results = await withCostContext({ projectId, purpose: "discovery:open" }, () =>
  runOpenDiscovery(answers, {
    coverage,
    concurrency: 24,
    onProgress: (d, f, t) => console.log(`  ${d}/${t} coded, ${f} failed`),
  })
);
for (const r of results) out.write(JSON.stringify(r) + "\n");
await new Promise<void>((res) => out.end(() => res()));
console.log(`${brand} done: ${results.length} coded -> ${outPath}`);
// The store's postgres pool (opened for ledger writes) holds the event loop;
// give fire-and-forget logCost inserts a beat to land, then exit explicitly.
await new Promise((r) => setTimeout(r, 5000));
process.exit(0);
