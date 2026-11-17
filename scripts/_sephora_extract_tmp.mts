/**
 * THROWAWAY (do not commit): build a LOCAL sqlite replica of the active
 * Sephora tracker's coded wave so scripts/_findings_dump_tmp.mts can run on it
 * keyless and offline.
 *
 *   npx tsx scripts/_sephora_extract_tmp.mts [outDb]
 *
 * Prod is READ-ONLY: every query runs in its own READ ONLY transaction
 * (dict_luna6_eval.mts pattern - never a session SET). No response bodies are
 * read from prod (text stored as ''); only DATABASE_URL is taken from
 * .env.local, every API key is blanked. Writes go only to the local file.
 */
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const OUT_DB =
  process.argv[2] ??
  "/private/tmp/claude-501/-Users-tylersolloway-Documents-GitHub-procerno/4240dd23-9cae-44fd-bdfd-aa5e046d322c/scratchpad/findings_dump/sephora_local.db";

let DB_URL = "";
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && m[1] === "DATABASE_URL") DB_URL = m[2].replace(/^"|"$/g, "");
}
if (!DB_URL) throw new Error("no DATABASE_URL in .env.local");
delete process.env.DATABASE_URL;
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
process.env.RUN_COLLECT_ONLY = "1";
if (fs.existsSync(OUT_DB)) for (const f of [OUT_DB, OUT_DB + "-wal", OUT_DB + "-shm"]) if (fs.existsSync(f)) fs.unlinkSync(f);
process.env.SQLITE_PATH = OUT_DB;

// Bootstrap the local schema through the real sqlite store.
const { store } = await import(REPO + "/src/lib/store/index.ts");
await store.listProjects(undefined as unknown as string);
const db = (globalThis as unknown as { __procerno_db: import("better-sqlite3").Database }).__procerno_db;
if (!db || !db.name.endsWith(path.basename(OUT_DB))) throw new Error("local sqlite not bootstrapped at " + OUT_DB);

const postgres = (await import(`${REPO}/node_modules/postgres/src/index.js`)).default;
const ro = postgres(DB_URL, { max: 1, prepare: false });
const q = (text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> =>
  ro.begin("read only", (t: any) => t.unsafe(text, params as any[]));

const fmt = (v: unknown): unknown => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object") return JSON.stringify(v);
  return v;
};
const localCols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const prodCols = async (table: string) =>
  (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`, [table])).map(
    (r) => r.column_name as string
  );
function insert(table: string, rows: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  if (rows.length === 0) return 0;
  const cols = localCols(table).filter((c) => c in rows[0] || c in overrides);
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  db.transaction(() => {
    for (const r of rows) stmt.run(...cols.map((c) => (c in overrides ? overrides[c] : fmt(r[c]))));
  })();
  return rows.length;
}
/** SELECT the prod columns the local table also has (minus `skip`). */
async function pull(table: string, where: string, params: unknown[], skip: string[] = []) {
  const local = new Set(localCols(table));
  const cols = (await prodCols(table)).filter((c) => local.has(c) && !skip.includes(c));
  return q(`SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM ${table} WHERE ${where}`, params);
}

try {
  const projects = await q(`SELECT id, brand FROM projects WHERE brand = 'Sephora' AND archived_at IS NULL`);
  if (projects.length !== 1) throw new Error(`expected 1 active Sephora project, got ${projects.length}`);
  const pid = projects[0].id as string;
  const runs = await q(`SELECT id FROM runs WHERE project_id = $1 AND id LIKE 'bd11a221%'`, [pid]);
  if (runs.length !== 1) throw new Error(`expected run bd11a221, got ${runs.length}`);
  const rid = runs[0].id as string;
  console.log("project", pid, "run", rid);

  const proj = await pull("projects", "id = $1", [pid]);
  const source = proj[0].codes_source as string;
  console.log("codes_source", source);
  console.log("projects", insert("projects", proj));
  console.log("runs", insert("runs", await pull("runs", "id = $1", [rid])));
  console.log("prompts", insert("prompts", await pull("prompts", "project_id = $1", [pid])));
  console.log("intents", insert("intents", await pull("intents", "project_id = $1", [pid])));
  console.log("dictionary_entries", insert("dictionary_entries", await pull("dictionary_entries", "project_id = $1", [pid])));
  // Response META only: never the body (stored ''), never the discovery JSON.
  const resp = await pull("responses", "run_id = $1", [rid], ["text", "discovery_codes", "discovery_brands", "coder_usage"]);
  console.log("responses", insert("responses", resp, { text: "" }));
  console.log("answer_codes", insert("answer_codes", await pull("answer_codes", "run_id = $1 AND source = $2", [rid, source])));
  const cache = await q(`SELECT key, value, created_at, brand, category, source, project_id FROM llm_cache WHERE key LIKE $1`, [
    `ctx_judge:%:${pid}:%`,
  ]);
  console.log("llm_cache ctx_judge", insert("llm_cache", cache));
} finally {
  await ro.end();
  db.pragma("wal_checkpoint(TRUNCATE)");
}
