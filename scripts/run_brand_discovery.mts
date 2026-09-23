/** Brand-mention pass driver: vault -> runBrandDiscovery (grok, temp 0) ->
 * local JSONL. Metered to the ledger as discovery:brands per project.
 * Usage: npx tsx scripts/run_brand_discovery.mts <brand> <vault.gz> <out.jsonl> --project <id>
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
const projectId = arg("project", "") || null;
const { runBrandDiscovery } = await import("../src/lib/engine/discovery");
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
console.log(`${brand}: ${answers.length} answers (done ${done.size})`);
const out = fs.createWriteStream(outPath, { flags: "a" });
const results = await withCostContext({ projectId, purpose: "discovery:brands" }, () =>
  runBrandDiscovery(answers, {
    concurrency: 24,
    onProgress: (d, f, t) => console.log(`  ${d}/${t}, ${f} failed`),
  })
);
for (const r of results) out.write(JSON.stringify(r) + "\n");
await new Promise<void>((res) => out.end(() => res()));
console.log(`${brand} done: ${results.length}`);
await new Promise((r) => setTimeout(r, 5000));
process.exit(0);
