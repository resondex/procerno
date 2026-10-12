/**
 * Offline pilot of the brands pass's per-name framing mode (CODING_DECISIONS
 * section 12 Set A, Tyler 2026-10-12): vault answers filtered to an ids file
 * -> runBrandDiscovery({ framing: true }) -> local JSONL
 * {id, brands: [{name, framing}]}. Score with scripts/score_brands_framing.py
 * against the labeler's per-mention framings on the same rows.
 *
 * SPENDS API MONEY: every answer is one model call. Per Tyler's standing rule
 * each run needs his explicit go, so this refuses unless RUN=1 is set. Without
 * RUN=1 it reads the inputs locally, reports what it WOULD run, and exits.
 *
 * Nothing touches prod: DATABASE_URL is never loaded (and is deleted from the
 * environment), so the ledger logger writes through `store` to local SQLite.
 * Nothing is written to responses.discovery_brands - output is the JSONL only.
 * Resumable: ids already in the output file are skipped.
 *
 * Usage:
 *   RUN=1 [MODEL=<model id>] [CONCURRENCY=16] npx tsx scripts/pilot_brands_framing.mts \
 *     --ids <ids.txt> --out <out.jsonl> <vault.jsonl.gz> [<vault.jsonl.gz> ...]
 * MODEL defaults to the discovery model (DISCOVERY_MODEL, else gpt-6-luna).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v ?? null;
};
const idsPath = flag("ids");
const outPath = flag("out");
const vaults = argv;
if (!idsPath || !outPath || vaults.length === 0) {
  console.error("usage: RUN=1 [MODEL=..] npx tsx scripts/pilot_brands_framing.mts --ids <ids.txt> --out <out.jsonl> <vault.jsonl.gz>...");
  process.exit(2);
}

// Inputs are local and free to read; resolve them before the spend gate so a
// dry run shows exactly what a real run would code.
const wanted = new Set(
  fs.readFileSync(idsPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
);
const done = new Set<string>(
  fs.existsSync(outPath)
    ? fs.readFileSync(outPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id)
    : []
);
type Ans = { id: string; engine: string; prompt: string; text: string };
const answers: Ans[] = [];
const found = new Set<string>();
for (const v of vaults) {
  const rows = zlib.gunzipSync(fs.readFileSync(v)).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
  const meta = rows[0];
  if (meta?.kind !== "run_meta") throw new Error(`${v}: first row is not run_meta`);
  const prompts = new Map<string, string>(meta.prompts.map((p: { id: string; text: string }) => [p.id, p.text]));
  for (const r of rows.slice(1) as { id: string; prompt_id: string; model: string; text: string }[]) {
    if (!wanted.has(r.id) || found.has(r.id)) continue;
    found.add(r.id);
    if (done.has(r.id)) continue;
    answers.push({ id: r.id, engine: r.model, prompt: prompts.get(r.prompt_id) ?? "", text: r.text ?? "" });
  }
}
const missing = [...wanted].filter((id) => !found.has(id));
const model = process.env.MODEL || process.env.DISCOVERY_MODEL || "gpt-6-luna";
console.log(
  `ids ${wanted.size}; found in vaults ${found.size}; missing ${missing.length}; ` +
    `already in output ${done.size}; to code ${answers.length}; model ${model}`
);
if (missing.length) console.log(`  missing ids (first 5): ${missing.slice(0, 5).join(", ")}`);

if (process.env.RUN !== "1") {
  console.error(
    "REFUSING: this run spends API money (one model call per answer) and needs " +
      "Tyler's explicit go per run. Re-run with RUN=1 once he has given it."
  );
  process.exit(1);
}

// Keys from .env.local, never the database - the ledger falls back to local SQLite.
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && m[1] !== "DATABASE_URL" && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.DATABASE_URL;
// The discovery module reads its model at load; set it before importing.
process.env.DISCOVERY_MODEL = model;

const { runBrandDiscovery } = await import(`${REPO}/src/lib/engine/discovery`);
const { withCostContext } = await import(`${REPO}/src/lib/cost_log`);

const out = fs.createWriteStream(outPath, { flags: "a" });
const results = await withCostContext({ purpose: "discovery:brands_framing", rnd: true }, () =>
  runBrandDiscovery(answers, {
    framing: true,
    concurrency: Number(process.env.CONCURRENCY ?? 16),
    onProgress: (d: number, f: number, t: number) => console.log(`  ${d}/${t}, ${f} failed`),
    onResult: async (row: { responseId: string; framings?: { name: string; framing: string | null }[] }) => {
      out.write(JSON.stringify({ id: row.responseId, brands: row.framings ?? [] }) + "\n");
    },
  })
);
await new Promise<void>((res) => out.end(() => res()));
console.log(`done: ${results.length} coded, ${answers.length - results.length} failed -> ${outPath}`);
// Let the ledger's async writes land before exiting.
await new Promise((r) => setTimeout(r, 3000));
process.exit(0);
