/**
 * Build the test copy as a SNAPSHOT OF LIVE (2026-11-17, Tyler): every tracker the live site shows, with the
 * codes the dashboards read, and the saved model results the views depend on - so a check run before a push sees
 * what the live site will show.
 *
 *   npx tsx scripts/build_live_snapshot.mts [out.db]     (default data/dashboard_fixture.db)
 *
 * Reads live through per-query read-only transactions; writes nothing there and calls no model. Copied, for each
 * un-archived tracker with a codes source and each of its collected / complete runs:
 *   - projects, runs, intents, prompts (staged and replaced wordings included), dictionary_entries, prompt_flags
 *   - responses (every column) and the answer_codes rows of the tracker's own codes source
 *   - llm_cache rows the views read: condition groupings (cond_keys, per run), reason themes (dossier_themes, all -
 *     they are keyed by content), context-judge verdicts, question labels, written memos, parent and dictionary
 *     suggestions, examples, the question check. View payloads themselves are NOT copied: the snapshot computes them.
 *   - each run's live data revision, pinned as `snapshot_revision:<run>` (the local store reports it, so the
 *     condition groupings saved under that revision are found).
 * The app and the checks run on it with no model keys: a saved result is read, a missing one falls back exactly
 * as a keyless environment does. Run the dev server with VIEW_CACHE=off so views are computed from the code as it
 * stands. Builds into a temp file and moves it into place only when every check passes.
 *
 * The previous builder (build_dashboard_fixture.mts: five trackers on the Opus reference labels) is kept for the
 * reference-label view of the data.
 */
import postgres from "postgres"; import fs from "node:fs"; import path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, "data", "dashboard_fixture.db"));
const TMP = `${OUT}.building`;

let prodUrl = "";
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^DATABASE_URL=(.*)$/); if (m) prodUrl = m[1].trim().replace(/^["']|["']$/g, "");
}
if (!prodUrl) { console.error("no DATABASE_URL in .env.local"); process.exit(1); }
// From here the store module can only bind to the snapshot file.
delete process.env.DATABASE_URL;
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) fs.rmSync(f, { force: true });
process.env.SQLITE_PATH = TMP;
const { sqliteStore } = await import("../src/lib/store/sqlite");

const sql = postgres(prodUrl, { ssl: "require", max: 1 });
type Row = Record<string, unknown>;
const ro = <T,>(f: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin("read only", f) as Promise<T>;

await sqliteStore.listAnswerCodes("", ""); // opens the file and creates the schema
const Better = (await import("better-sqlite3")).default;
const db = new Better(TMP);
db.pragma("journal_mode = WAL");

const dropped = new Map<string, Set<string>>();
/** Insert live rows into a local table, keeping the columns both have (columns live has and the local schema lacks are reported). */
function copy(table: string, rows: Row[]) {
  if (!rows.length) return;
  const local = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const c of Object.keys(rows[0])) if (!local.has(c)) { if (!dropped.has(table)) dropped.set(table, new Set()); dropped.get(table)!.add(c); }
  const cols = Object.keys(rows[0]).filter((c) => local.has(c));
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
  const val = (v: unknown) => v instanceof Date ? v.toISOString()
    : typeof v === "boolean" ? (v ? 1 : 0)
    : typeof v === "bigint" ? Number(v)
    : v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  db.transaction(() => { for (const r of rows) stmt.run(cols.map((c) => val(r[c]))); })();
}
/**
 * Every row of a run-scoped table, in pages, IN LIVE'S PHYSICAL ORDER (ctid). The app reads coded answers with no
 * ORDER BY, so on live they arrive in stored order, and that order reaches the output (which sample wordings a
 * reason group shows a model, tie-breaks). The local store returns rows in insertion order, so inserting in live's
 * order reproduces it.
 */
async function pages(table: "responses" | "answer_codes", runId: string, source?: string): Promise<number> {
  // Answers have a defined order on live (seq); coded answers do not, so they come in physical order.
  let last = "(0,0)";
  let seqLast = -1;
  let n = 0;
  for (;;) {
    const rows = await ro((tx) =>
      table === "responses"
        ? tx<Row[]>`select *, seq::text as _ctid from responses where run_id = ${runId} and seq > ${seqLast} order by seq limit 2000`
        : tx<Row[]>`select *, ctid::text as _ctid from answer_codes where run_id = ${runId} and source = ${source!} and ctid > ${last}::tid order by ctid limit 2000`);
    if (!rows.length) break;
    last = String(rows[rows.length - 1]._ctid);
    if (table === "responses") seqLast = Number(last);
    copy(table, rows.map(({ _ctid, ...r }) => { void _ctid; return r; }));
    n += rows.length;
  }
  return n;
}

const failures: string[] = [];
const summary: string[] = [];
const projects = await ro((tx) => tx<Row[]>`select * from projects where archived_at is null and codes_source is not null order by brand`);
if (!projects.length) failures.push("no un-archived tracker with a codes source on live");
const projectIds = projects.map((p) => String(p.id));
const runIds: string[] = [];
for (const project of projects) {
  const pid = String(project.id);
  const source = String(project.codes_source);
  const runs = await ro((tx) => tx<Row[]>`select * from runs where project_id = ${pid} and status in ('collected', 'complete') order by created_at`);
  if (!runs.length) { failures.push(`${project.brand}: no collected or complete run`); continue; }
  copy("projects", [project]);
  copy("runs", runs);
  copy("intents", await ro((tx) => tx<Row[]>`select * from intents where project_id = ${pid} order by seq`));
  copy("prompts", await ro((tx) => tx<Row[]>`select * from prompts where project_id = ${pid} order by seq`));
  copy("dictionary_entries", await ro((tx) => tx<Row[]>`select * from dictionary_entries where project_id = ${pid}`));
  copy("prompt_flags", await ro((tx) => tx<Row[]>`select * from prompt_flags where project_id = ${pid}`).catch(() => [] as Row[]));
  for (const run of runs) {
    const rid = String(run.id);
    runIds.push(rid);
    const answers = await pages("responses", rid);
    const codes = await pages("answer_codes", rid, source);
    const live = (await ro((tx) => tx<{ a: number; c: number }[]>`
      select (select count(*)::int from responses where run_id = ${rid}) a,
             (select count(*)::int from answer_codes where run_id = ${rid} and source = ${source}) c`))[0];
    if (answers !== live.a) failures.push(`${project.brand}: copied ${answers} answers, live has ${live.a}`);
    if (codes !== live.c) failures.push(`${project.brand}: copied ${codes} code rows, live has ${live.c}`);
    // The run's live revision, pinned (run_revision.ts stores { rev, sig, ... } under run_rev:<run>).
    const revRow = (await ro((tx) => tx<{ value: string }[]>`select value from llm_cache where key = ${`run_rev:${rid}`}`))[0];
    let rev: string | null = null;
    try { rev = revRow ? (JSON.parse(revRow.value) as { rev?: string }).rev ?? null : null; } catch { rev = null; }
    if (!rev) failures.push(`${project.brand}: no saved revision for run ${rid.slice(0, 8)} on live (open its dashboard or run warm_views first)`);
    else db.prepare("INSERT OR REPLACE INTO llm_cache (key, value, created_at) VALUES (?, ?, ?)").run(`snapshot_revision:${rid}`, rev, new Date().toISOString());
    summary.push(`${String(project.brand).padEnd(18)} ${source.padEnd(20)} run ${rid.slice(0, 8)} ${String(run.status).padEnd(9)} answers ${answers}  codes ${codes}  revision ${rev ? rev.slice(0, 10) : "-"}`);
  }
}

// Saved model results the views read. Keyed rows carry a project or run id in the key; reason themes are keyed by
// content alone, so all of them come (under 1 MB).
const PREFIXES = ["cond_keys", "ctx_judge", "question_label", "brief_write", "dict_parents", "dict_suggest", "dict_examples", "prompt_health"];
const ids = [...projectIds, ...runIds];
let cacheRows = 0;
for (const prefix of [...PREFIXES, "dossier_themes"]) {
  let last = "";
  let n = 0;
  for (;;) {
    const rows = await ro((tx) => tx<Row[]>`
      select key, value, created_at, brand, category, source, project_id from llm_cache
      where key like ${prefix + ":%"} and key > ${last} order by key limit 500`);
    if (!rows.length) break;
    last = String(rows[rows.length - 1].key);
    const keep = prefix === "dossier_themes" ? rows : rows.filter((r) => ids.some((id) => String(r.key).includes(id)));
    copy("llm_cache", keep);
    n += keep.length;
  }
  cacheRows += n;
  summary.push(`saved results ${prefix.padEnd(16)} ${n}`);
}
await sql.end();

// Round trip through the store: every run reads back its answers and codes, and its pinned revision.
for (const project of projects) {
  const source = String(project.codes_source);
  const runs = db.prepare("select id from runs where project_id = ?").all(String(project.id)) as { id: string }[];
  for (const r of runs) {
    const back = await sqliteStore.listAnswerCodes(r.id, source);
    const coded = (db.prepare("select count(*) n from answer_codes where run_id = ? and source = ?").get(r.id, source) as { n: number }).n;
    // The store leaves out the answers of staged and replaced question wordings, so it reads back at most the rows copied.
    const hidden = (db.prepare(
      "select count(*) n from answer_codes c join responses r on r.id = c.response_id join prompts p on p.id = r.prompt_id where c.run_id = ? and c.source = ? and (p.staged = 1 or p.replaced_by is not null)"
    ).get(r.id, source) as { n: number }).n;
    if (back.length !== coded - hidden) failures.push(`${project.brand}: ${back.length} codes read back through the store for ${coded} rows (${hidden} on hidden wordings)`);
    if (!(await sqliteStore.runDataRevision(r.id))) failures.push(`${project.brand}: no pinned revision reads back`);
    const cond = (db.prepare("select count(*) n from llm_cache where key like ?").get(`cond_keys:%:${r.id}:%`) as { n: number }).n;
    if (!cond) failures.push(`${project.brand}: no saved condition grouping came with run ${r.id.slice(0, 8)}`);
  }
}
for (const [t, cols] of dropped) summary.push(`columns live has that the local ${t} table lacks (not copied): ${[...cols].join(", ")}`);
db.close();
(globalThis as { __procerno_db?: { close(): void } }).__procerno_db?.close();

if (failures.length) {
  console.error(`FAILED - ${failures.length} problems (first 25):\n${failures.slice(0, 25).join("\n")}`);
  console.error(`partial build left at ${TMP} for inspection`);
  process.exit(1);
}
// Keep the previous test copy beside the new one.
if (fs.existsSync(OUT)) fs.renameSync(OUT, `${OUT}.previous`);
for (const f of [`${OUT}-wal`, `${OUT}-shm`]) fs.rmSync(f, { force: true });
const fin = new Better(TMP); fin.pragma("wal_checkpoint(TRUNCATE)"); fin.close();
fs.renameSync(TMP, OUT);
for (const f of [`${TMP}-wal`, `${TMP}-shm`]) fs.rmSync(f, { force: true });
console.log(summary.join("\n"));
console.log(`\n${projects.length} trackers, ${cacheRows} saved results; all checks passed -> ${OUT}`);
process.exit(0);
