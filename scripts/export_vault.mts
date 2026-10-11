/**
 * Export a collected run to the immutable response vault.
 *
 *   npx tsx scripts/export_vault.mts <run id | brand>
 *
 * Prod is read through per-query read-only transactions (AGENTS.md pooler
 * rule); nothing is written to the database. Output mirrors the 2026-09-19
 * exports exactly: one gzip JSONL per run - first row {kind:"run_meta",
 * run:{id,status,brand,name}, prompts:[{id,text,theme,retired}]}, then every
 * responses row as stored (SELECT *) - named
 * <brand_slug>_<run id first 8>_<rows>rows_<YYYY-MM-DDTHHMM>.jsonl.gz,
 * sha256 appended to MANIFEST_<stamp>.txt, both files chflags uchg. Refuses
 * a run that is not collected/complete, and refuses to overwrite.
 * By brand, the newest run of the newest project with that brand is taken.
 */
import postgres from "postgres"; import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import crypto from "node:crypto"; import { execFileSync } from "node:child_process";
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const VAULT = `${process.env.HOME}/Documents/procerno_response_vault`;
const key = process.argv[2];
if (!key) { console.error("usage: npx tsx scripts/export_vault.mts <run id | brand>"); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
const ro = <T,>(f: (tx: any) => Promise<T>) => sql.begin("read only", f) as Promise<T>;
const isId = /^[0-9a-f-]{36}$/i.test(key);
const run = (await ro((tx) => isId
  ? tx`select r.*, p.brand, p.name from runs r join projects p on p.id = r.project_id where r.id = ${key}`
  : tx`select r.*, p.brand, p.name from runs r join projects p on p.id = r.project_id where p.brand ilike ${key} order by p.created_at desc, r.created_at desc limit 1`) as any[])[0];
if (!run) { console.error(`no run for ${key}`); process.exit(1); }
if (!["collected", "complete"].includes(run.status)) { console.error(`run ${run.id} is ${run.status}, not collected/complete - refusing`); process.exit(1); }
const prompts = await ro((tx) => tx`select id, text, theme, retired from prompts where project_id = ${run.project_id} order by seq`) as any[];
const rows = await ro((tx) => tx`select * from responses where run_id = ${run.id} order by seq`) as any[];
const stamp = new Date().toISOString().replace(/[-:]/g, (c, i, s) => (i < 10 ? c : "")).slice(0, 15).replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/, "$1-$2-$3T$4$5");
const slug = String(run.brand).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const file = `${slug}_${run.id.slice(0, 8)}_${rows.length}rows_${stamp}.jsonl.gz`;
const out = path.join(VAULT, file);
if (fs.existsSync(out)) { console.error(`${out} exists - refusing to overwrite`); process.exit(1); }
const meta = { kind: "run_meta", run: { id: run.id, status: run.status, brand: run.brand, name: run.name }, prompts: prompts.map((p) => ({ id: p.id, text: p.text, theme: p.theme, retired: p.retired })) };
const body = [JSON.stringify(meta), ...rows.map((r) => JSON.stringify(r))].join("\n") + "\n";
const gz = zlib.gzipSync(Buffer.from(body, "utf8"), { level: 9 });
fs.writeFileSync(out, gz);
const sha = crypto.createHash("sha256").update(gz).digest("hex");
const manifest = path.join(VAULT, `MANIFEST_${stamp}.txt`);
fs.appendFileSync(manifest, `${sha}  ${file}  rows=${rows.length}  status=${run.status}\n`);
execFileSync("chflags", ["uchg", out, manifest]);
console.log(`${file}  rows=${rows.length}  prompts=${prompts.length}  sha256=${sha}\nmanifest ${path.basename(manifest)}; both chflags uchg`);
await sql.end(); process.exit(0);
