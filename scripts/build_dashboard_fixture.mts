/**
 * Build the dashboard fixture (2026-10-27, Tyler; design
 * DASHBOARD_STORAGE_DESIGN_2026-10-27.md section 2): a separate local
 * sqlite holding the five October trackers with every answer coded by the
 * Opus reference labels, so the per-type views can be built against real
 * distributions before any coder flip.
 *
 *   npx tsx scripts/build_dashboard_fixture.mts [out.db]   (default data/dashboard_fixture.db)
 *
 * Sources: project config (projects, intents, prompts, runs, dictionary)
 * from prod through per-query read-only transactions; answers from the
 * response vault; codes from ~/Documents/procerno_eval/labeling (v2 training
 * + holdout labels, Set C v1.3; decision_rules from the drc3 recode, landed
 * 2026-10-27, overlaid onto the v2 rows - Set C stages carry none). Nothing
 * is written to prod and no model is called. Builds into a temp file and
 * moves it into place only when every check passes: one code row per answer,
 * every label id a vault answer, the router's schema equal to the labeler's
 * on every row, per-schema field presence as SCHEMA_FIELDS states, and
 * contract-shaped decision_rules on every row of the six recoded schemas.
 */
import postgres from "postgres"; import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
import type { AnswerCodes } from "../src/lib/types";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, "data", "dashboard_fixture.db"));
const TMP = `${OUT}.building`;
const VAULT = `${process.env.HOME}/Documents/procerno_response_vault`;
const LAB = `${process.env.HOME}/Documents/procerno_eval/labeling`;
const DR = `${LAB}/v04_dr/recode`;
const SOURCE = "ref:opus-5-5";
/** The confirmed code_groups maps (reasons view), one file per tracker; a tracker without one gets none. */
const GROUPS = `${process.env.HOME}/Documents/procerno_eval/code_groups_2026-10-27`;

// drc3 rule vocabulary: the choice schema's rules route to a brand (free
// text, never a product key); the enum schemas take the listed pair and may
// carry the routed product.
const DR_ENUM: Record<string, Set<string> | null> = {
  choice: null,
  premium: new Set(["premium", "basic"]),
  value: new Set(["worth", "cheaper"]),
  churn_renewal: new Set(["keep", "leave"]),
  objections: new Set(["proceed", "avoid"]),
  alt_defensive: new Set(["keep", "leave"]),
};

// The prod URL is read for the config pull only, then removed from the env
// so the store module below can only ever bind to the fixture sqlite.
let prodUrl = process.env.DATABASE_URL;
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^DATABASE_URL=(.*)$/); if (m && !prodUrl) prodUrl = m[1].replace(/^"|"$/g, "");
}
if (!prodUrl) { console.error("no DATABASE_URL for the config pull"); process.exit(1); }
delete process.env.DATABASE_URL;
for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) fs.rmSync(f, { force: true });
process.env.SQLITE_PATH = TMP;
const { sqliteStore } = await import("../src/lib/store/sqlite");
const { schemaOf, viewsOf, SCHEMA_FIELDS } = await import("../src/lib/engine/views");
type CodeSchema = import("../src/lib/engine/views").CodeSchema;

const TRACKERS = [
  { slug: "american_express", run: "00dab505" },
  { slug: "jira", run: "182ef571" },
  { slug: "google_pixel", run: "ce6df829" },
  { slug: "netflix", run: "1948d2ed" },
  { slug: "doritos", run: "2a0ff686" },
];

const sql = postgres(prodUrl, { ssl: "require", max: 1 });
const ro = <T,>(f: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin("read only", f) as Promise<T>;

await sqliteStore.listAnswerCodes("", ""); // opens the file and creates the schema
const Better = (await import("better-sqlite3")).default;
const db = new Better(TMP);
db.pragma("journal_mode = WAL");

/** Insert prod rows into a local table, keeping the columns both have. */
function copy(table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const local = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  const cols = Object.keys(rows[0]).filter((c) => local.has(c));
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
  const val = (v: unknown) => v instanceof Date ? v.toISOString()
    : typeof v === "boolean" ? (v ? 1 : 0)
    : v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  db.transaction(() => { for (const r of rows) stmt.run(cols.map((c) => val(r[c]))); })();
}

const failures: string[] = [];
const fail = (msg: string) => { failures.push(msg); };
const readJsonl = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** Order of first appearance in the answer, 1-based; unfound names follow in label order. */
function ranked(mentions: { brand: string; framing: string }[], text: string) {
  const lower = text.toLowerCase();
  const pos = mentions.map((m, i) => ({ m, i, at: lower.indexOf(m.brand.toLowerCase()) }));
  pos.sort((a, b) => (a.at < 0 ? 1e9 + a.i : a.at) - (b.at < 0 ? 1e9 + b.i : b.at));
  return pos.map((p, k) => ({ brand: p.m.brand, framing: p.m.framing, rank: k + 1 }));
}

/** Label field -> answer_codes field name. */
const FIELD_OF: Record<string, string> = { uncoded_reason: "uncoded", uncoded_topic: "uncoded" };
const IGNORE = new Set(["id", "stage"]);

const summary: string[] = [];
for (const t of TRACKERS) {
  const run = (await ro((tx) => tx`select * from runs where id::text like ${t.run + "%"}`))[0] as Record<string, unknown> | undefined;
  if (!run) { fail(`${t.slug}: run ${t.run} not in prod`); continue; }
  const pid = run.project_id as string;
  const project = (await ro((tx) => tx`select * from projects where id = ${pid}`))[0] as Record<string, unknown>;
  const intents = await ro((tx) => tx`select * from intents where project_id = ${pid}`) as Record<string, unknown>[];
  const prompts = await ro((tx) => tx`select * from prompts where project_id = ${pid}`) as Record<string, unknown>[];
  const dict = await ro((tx) => tx`select * from dictionary_entries where project_id = ${pid}`) as Record<string, unknown>[];
  const groupsFile = `${GROUPS}/code_groups_${t.slug}.json`;
  const codeGroups = fs.existsSync(groupsFile)
    ? JSON.stringify(JSON.parse(fs.readFileSync(groupsFile, "utf8")))
    : null;
  copy("projects", [{ ...project, codes_source: SOURCE, code_groups: codeGroups }]);
  copy("intents", intents);
  copy("prompts", prompts);
  copy("dictionary_entries", dict);
  copy("runs", [run]);

  const vf = fs.readdirSync(VAULT).filter((f) => f.startsWith(`${t.slug}_${t.run}_`) && f.endsWith(".jsonl.gz"));
  if (vf.length !== 1) { fail(`${t.slug}: expected one vault file for ${t.run}, found ${vf.length}`); continue; }
  const answers = zlib.gunzipSync(fs.readFileSync(path.join(VAULT, vf[0]))).toString("utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind !== "run_meta") as Record<string, unknown>[];
  copy("responses", answers);
  const answerById = new Map(answers.map((a) => [a.id as string, a]));
  const intentById = new Map(intents.map((i) => [i.id as string, i]));
  const promptById = new Map(prompts.map((p) => [p.id as string, p]));

  // Labels: v2 (schema from the builder's manifest) + Set C (schema = stage).
  const labels: { row: Record<string, unknown>; schema: string; contract: string }[] = [];
  const man = new Map(readJsonl(`${LAB}/v2_build/training/${t.slug}_v2_all.manifest.jsonl`).map((m) => [m.id, m]));
  for (const r of readJsonl(`${LAB}/v2_build/training/results/${t.slug}_v2_all.results.jsonl`)) {
    const m = man.get(r.id);
    if (!m) { fail(`${t.slug}: v2 label ${r.id} has no manifest row`); continue; }
    labels.push({ row: r, schema: m.schema, contract: "v2_2026-10-22" });
  }
  for (const r of readJsonl(`${LAB}/g3/setc/results/requests_${t.slug}_setc.results.jsonl`))
    labels.push({ row: r, schema: r.stage, contract: "setc_v1.3" });

  // The drc3 recode's decision_rules, keyed by answer id (drf_ prefix off).
  const drRules = new Map<string, unknown>();
  for (const r of readJsonl(`${DR}/results/${t.slug}_drf.results.jsonl`)) {
    const id = (r.id as string).replace(/^drf_/, "");
    if (drRules.has(id)) { fail(`${t.slug}: recode labels ${id} twice`); continue; }
    drRules.set(id, r.decision_rules);
  }

  const seen = new Set<string>();
  const codes: AnswerCodes[] = [];
  const viewCount: Record<string, number> = {};
  for (const { row, schema, contract } of labels) {
    const id = row.id as string;
    const ans = answerById.get(id);
    if (!ans) { fail(`${t.slug}: label ${id} is not an answer of run ${t.run}`); continue; }
    if (seen.has(id)) { fail(`${t.slug}: answer ${id} labeled twice`); continue; }
    seen.add(id);
    const prompt = promptById.get(ans.prompt_id as string);
    const intent = prompt?.intent_id ? intentById.get(prompt.intent_id as string) : undefined;
    if (!intent) { fail(`${t.slug}: answer ${id} has no intent`); continue; }
    const routed = schemaOf(intent.stage as string, intent.angle as string);
    if (routed !== schema) { fail(`${t.slug}: ${id} stage=${intent.stage} angle=${intent.angle}: router ${routed}, labeler ${schema}`); continue; }
    const views = viewsOf(intent.stage as string, intent.angle as string);
    if (!views.length) { fail(`${t.slug}: ${id} stage ${intent.stage} routes to no view`); continue; }
    for (const v of views) viewCount[v] = (viewCount[v] ?? 0) + 1;

    const asked = new Set(SCHEMA_FIELDS[schema as CodeSchema]);
    const c: Record<string, unknown> = {
      response_id: id, source: SOURCE, run_id: run.id, project_id: pid, contract, schema,
    };
    for (const [k, v] of Object.entries(row)) {
      if (IGNORE.has(k)) continue;
      const f = FIELD_OF[k] ?? k;
      if (!asked.has(f)) {
        // Set C carries every field on every row; unasked ones come back null or "n/a".
        if (v !== null && v !== "n/a") fail(`${t.slug}: ${id} (${schema}) has unasked field ${k}=${JSON.stringify(v).slice(0, 60)}`);
        continue;
      }
      c[f] = f === "mentions" ? ranked(v as { brand: string; framing: string }[], ans.text as string) : v;
    }
    for (const f of asked) if (!(f in c)) fail(`${t.slug}: ${id} (${schema}) is missing asked field ${f}`);

    // decision_rules ride every v2 row of the six recoded schemas (the
    // awareness and criteria schemas were outside the recode's scope);
    // each rule is checked against the drc3 shape and vocabulary.
    if (contract === "v2_2026-10-22" && DR_ENUM[schema] !== undefined) {
      const rules = drRules.get(id);
      if (!Array.isArray(rules)) fail(`${t.slug}: ${id} (${schema}) has no recode decision_rules`);
      else {
        const en = DR_ENUM[schema];
        for (const rule of rules as Record<string, unknown>[]) {
          const bad =
            Object.keys(rule).some((k) => !["condition", "choice", "product"].includes(k)) ||
            typeof rule.condition !== "string" || !rule.condition ||
            typeof rule.choice !== "string" || !rule.choice ||
            (en === null && "product" in rule) ||
            (en != null && !en.has(rule.choice)) ||
            ("product" in rule && (typeof rule.product !== "string" || !rule.product));
          if (bad) { fail(`${t.slug}: ${id} (${schema}) bad rule ${JSON.stringify(rule).slice(0, 80)}`); break; }
        }
        c.decision_rules = rules;
        c.contract = `${contract}+drc3`;
        drRules.delete(id);
      }
    }
    codes.push(c as unknown as AnswerCodes);
  }
  for (const id of answerById.keys()) if (!seen.has(id)) fail(`${t.slug}: answer ${id} has no label`);
  for (const id of drRules.keys()) fail(`${t.slug}: recode rules for ${id} matched no v2 row`);
  // Fill every unasked column with null so the row shape is complete.
  const full = codes.map((c) => {
    const o: Record<string, unknown> = { ...c };
    for (const k of ["outcome", "top_pick", "tier_stance", "worth_it", "proceed_or_avoid", "keep_or_leave",
      "premise_verdict", "category_routed", "relationship_verdict", "case_strength", "growth_stance",
      "clarification_requested", "includes_prices", "includes_specs", "quote", "premise_quote", "reasons",
      "topics", "uncoded", "destinations", "redirect_to", "pairings", "mentions", "decision_rules"]) if (!(k in o)) o[k] = null;
    return o as unknown as AnswerCodes;
  });
  await sqliteStore.upsertAnswerCodes(full);
  summary.push(`${String(project.brand).padEnd(18)} run ${t.run}  answers ${answers.length}  coded ${full.length}  views ${
    Object.entries(viewCount).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n}`).join(", ")}`);
}
await sql.end();

// Round-trip: every run reads back through the store with the same count.
for (const t of TRACKERS) {
  const run = db.prepare("select id from runs where id like ?").get(`${t.run}%`) as { id: string } | undefined;
  if (!run) continue;
  const back = await sqliteStore.listAnswerCodes(run.id, SOURCE);
  const n = (db.prepare("select count(*) n from responses where run_id = ?").get(run.id) as { n: number }).n;
  if (back.length !== n) fail(`${t.slug}: ${back.length} codes read back for ${n} answers`);
}
db.close();
(globalThis as { __procerno_db?: { close(): void } }).__procerno_db?.close();

if (failures.length) {
  console.error(`FAILED - ${failures.length} problems (first 25):\n${failures.slice(0, 25).join("\n")}`);
  console.error(`partial build left at ${TMP} for inspection`);
  process.exit(1);
}
for (const f of [OUT, `${OUT}-wal`, `${OUT}-shm`]) fs.rmSync(f, { force: true });
// Checkpoint the WAL into the main file before moving it.
const fin = new Better(TMP); fin.pragma("wal_checkpoint(TRUNCATE)"); fin.close();
fs.renameSync(TMP, OUT);
for (const f of [`${TMP}-wal`, `${TMP}-shm`]) fs.rmSync(f, { force: true });
console.log(summary.join("\n"));
console.log(`\nall checks passed -> ${OUT}`);
process.exit(0);
