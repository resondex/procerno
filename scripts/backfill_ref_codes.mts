/**
 * Backfill the Opus reference labels into PROD answer_codes as source
 * `ref:opus-5-5` (2026-10-29, Tyler: "go code it with opus and our coder so
 * the data is full"). A data load - no model calls.
 *
 *   npx tsx scripts/backfill_ref_codes.mts            DRY RUN: build + check, write nothing
 *   npx tsx scripts/backfill_ref_codes.mts --write    replace this source's rows per run
 *
 * The five October trackers use EXACTLY scripts/build_dashboard_fixture.mts's
 * mapping and checks (v2 training/holdout labels + Set C v1.3, drc3
 * decision_rules overlaid on the six recoded schemas): one row per answer,
 * every label id an answer of the run, the router's schema equal to the
 * labeler's, per-schema field presence as SCHEMA_FIELDS states, contract-shaped
 * rules. Sephora loads its 400 calibration rows (finetune/sephora_truth_v04r:
 * v04 judgment + rules, reasons relabeled under the confirmed book) - a
 * PARTIAL source (400 of 5,525 answers), validation use only. One recorded
 * deviation there: Sephora's awareness rows were never labeled for topics
 * (the relabel applied argued-from reasons), so their topics/uncoded are
 * stored NULL and their reasons are dropped as unasked.
 *
 * Projects are resolved by run id and checked against the expected project id
 * (archived duplicates share brand names). Prod reads go through per-query
 * read-only transactions; each run's write is one transaction (delete this
 * source's rows for the run, insert the new set), so re-running is idempotent.
 */
import postgres from "postgres"; import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
import type { AnswerCodes } from "../src/lib/types";
import { ANSWER_CODE_COLUMNS, answerCodesToRow } from "../src/lib/answer_codes";
import { schemaOf, viewsOf, SCHEMA_FIELDS, type CodeSchema } from "../src/lib/engine/views";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VAULT = `${process.env.HOME}/Documents/procerno_response_vault`;
const EV = `${process.env.HOME}/Documents/procerno_eval`;
const LAB = `${EV}/labeling`;
const DR = `${LAB}/v04_dr/recode`;
const SOURCE = "ref:opus-5-5";
const WRITE = process.argv.includes("--write");

const DR_ENUM: Record<string, Set<string> | null> = {
  choice: null,
  premium: new Set(["premium", "basic"]),
  value: new Set(["worth", "cheaper"]),
  churn_renewal: new Set(["keep", "leave"]),
  objections: new Set(["proceed", "avoid"]),
  alt_defensive: new Set(["keep", "leave"]),
};

const TRACKERS = [
  { slug: "american_express", run: "00dab505", project: "da86924c-8cc8-4a9c-a03e-a139f1f0854f", kind: "october" },
  { slug: "jira", run: "182ef571", project: "a3fd8d2c-2076-4f50-9e85-ad6b9902b448", kind: "october" },
  { slug: "google_pixel", run: "ce6df829", project: "87ccf81c-5b0e-4765-a969-19b9c4dc4d5d", kind: "october" },
  { slug: "netflix", run: "1948d2ed", project: "a361b767-182c-4229-9e3c-a62457c30c5b", kind: "october" },
  { slug: "doritos", run: "2a0ff686", project: "aabb35e0-dc07-4366-bc3b-a1058f0a3e79", kind: "october" },
  { slug: "sephora", run: "bd11a221", project: "40ecc013-628c-4074-b975-af3c8d119f65", kind: "sephora" },
] as const;

let url = process.env.DATABASE_URL;
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^DATABASE_URL=(.*)$/); if (m && !url) url = m[1].replace(/^"|"$/g, "");
}
const sql = postgres(url!, { ssl: "require", max: 1, prepare: false });
const ro = <T,>(f: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin("read only", f) as Promise<T>;

const readJsonl = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
function ranked(mentions: { brand: string; framing: string }[], text: string) {
  const lower = text.toLowerCase();
  const pos = mentions.map((m, i) => ({ m, i, at: lower.indexOf(m.brand.toLowerCase()) }));
  pos.sort((a, b) => (a.at < 0 ? 1e9 + a.i : a.at) - (b.at < 0 ? 1e9 + b.i : b.at));
  return pos.map((p, k) => ({ brand: p.m.brand, framing: p.m.framing, rank: k + 1 }));
}
const FIELD_OF: Record<string, string> = { uncoded_reason: "uncoded", uncoded_topic: "uncoded" };
const IGNORE = new Set(["id", "stage", "schema"]);
const ALL = ["outcome", "top_pick", "tier_stance", "worth_it", "proceed_or_avoid", "keep_or_leave",
  "premise_verdict", "category_routed", "relationship_verdict", "case_strength", "growth_stance",
  "clarification_requested", "includes_prices", "includes_specs", "quote", "premise_quote", "reasons",
  "topics", "uncoded", "destinations", "redirect_to", "pairings", "mentions", "decision_rules"];
/** Schemas whose v0.4+ contract carries decision_rules (coder.ts RULES_SCHEMAS). */
const SEPH_RULES = new Set(["choice", "premium", "expansion", "ecosystem"]);

const failures: string[] = [];
const fail = (m: string) => failures.push(m);

function ruleBad(schema: string, rule: Record<string, unknown>, sephora: boolean): boolean {
  const en = sephora && (schema === "expansion" || schema === "ecosystem") ? undefined : DR_ENUM[schema];
  return Object.keys(rule).some((k) => !["condition", "choice", "product"].includes(k)) ||
    typeof rule.condition !== "string" || !rule.condition ||
    typeof rule.choice !== "string" || !rule.choice ||
    (en === null && "product" in rule) ||
    (en != null && !en.has(rule.choice)) ||
    ("product" in rule && (typeof rule.product !== "string" || !rule.product));
}

const plan: { slug: string; runId: string; pid: string; rows: AnswerCodes[]; answers: number; views: Record<string, number> }[] = [];
for (const t of TRACKERS) {
  const runs = (await ro((tx) => tx`select id, project_id, status from runs where id::text like ${t.run + "%"}`)) as unknown as { id: string; project_id: string; status: string }[];
  if (runs.length !== 1) { fail(`${t.slug}: run ${t.run} matches ${runs.length} runs`); continue; }
  const run = runs[0];
  if (run.project_id !== t.project) { fail(`${t.slug}: run ${run.id} belongs to ${run.project_id}, expected ${t.project}`); continue; }
  const project = (await ro((tx) => tx`select id, brand, archived_at from projects where id = ${t.project}`))[0];
  if (!project || project.archived_at) { fail(`${t.slug}: project ${t.project} missing or archived`); continue; }
  const intents = (await ro((tx) => tx`select id, stage, angle from intents where project_id = ${t.project}`)) as unknown as { id: string; stage: string; angle: string | null }[];
  const prompts = (await ro((tx) => tx`select id, intent_id from prompts where project_id = ${t.project}`)) as unknown as { id: string; intent_id: string | null }[];
  const prodIds = new Set(((await ro((tx) => tx`select id from responses where run_id = ${run.id}`)) as unknown as { id: string }[]).map((r) => r.id));

  const vf = fs.readdirSync(VAULT).filter((f) => f.startsWith(`${t.slug}_${t.run}_`) && f.endsWith(".jsonl.gz"));
  if (vf.length !== 1) { fail(`${t.slug}: expected one vault file for ${t.run}, found ${vf.length}`); continue; }
  const answers = zlib.gunzipSync(fs.readFileSync(path.join(VAULT, vf[0]))).toString("utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind !== "run_meta") as Record<string, unknown>[];
  const answerById = new Map(answers.map((a) => [a.id as string, a]));
  if (answerById.size !== prodIds.size || [...prodIds].some((id) => !answerById.has(id))) {
    fail(`${t.slug}: vault (${answerById.size}) and prod responses (${prodIds.size}) differ`); continue;
  }
  const intentById = new Map(intents.map((i) => [i.id, i]));
  const promptById = new Map(prompts.map((p) => [p.id, p]));

  const labels: { row: Record<string, unknown>; schema: string; contract: string }[] = [];
  const drRules = new Map<string, unknown>();
  if (t.kind === "october") {
    const man = new Map(readJsonl(`${LAB}/v2_build/training/${t.slug}_v2_all.manifest.jsonl`).map((m) => [m.id, m]));
    for (const r of readJsonl(`${LAB}/v2_build/training/results/${t.slug}_v2_all.results.jsonl`)) {
      const m = man.get(r.id);
      if (!m) { fail(`${t.slug}: v2 label ${r.id} has no manifest row`); continue; }
      labels.push({ row: r, schema: m.schema, contract: "v2_2026-10-22" });
    }
    for (const r of readJsonl(`${LAB}/g3/setc/results/requests_${t.slug}_setc.results.jsonl`))
      labels.push({ row: r, schema: r.stage, contract: "setc_v1.3" });
    for (const r of readJsonl(`${DR}/results/${t.slug}_drf.results.jsonl`)) {
      const id = (r.id as string).replace(/^drf_/, "");
      if (drRules.has(id)) { fail(`${t.slug}: recode labels ${id} twice`); continue; }
      drRules.set(id, r.decision_rules);
    }
  } else {
    for (const r of readJsonl(`${EV}/finetune/sephora_truth_v04r.jsonl`))
      labels.push({ row: r, schema: r.schema, contract: "sephora_v04r_2026-10-29" });
  }

  const seen = new Set<string>();
  const rows: AnswerCodes[] = [];
  const views: Record<string, number> = {};
  for (const { row, schema, contract } of labels) {
    const id = row.id as string;
    const ans = answerById.get(id);
    if (!ans) { fail(`${t.slug}: label ${id} is not an answer of run ${t.run}`); continue; }
    if (seen.has(id)) { fail(`${t.slug}: answer ${id} labeled twice`); continue; }
    seen.add(id);
    const prompt = promptById.get(ans.prompt_id as string);
    const intent = prompt?.intent_id ? intentById.get(prompt.intent_id) : undefined;
    if (!intent) { fail(`${t.slug}: answer ${id} has no intent`); continue; }
    const routed = schemaOf(intent.stage, intent.angle as string);
    if (routed !== schema) { fail(`${t.slug}: ${id} stage=${intent.stage} angle=${intent.angle}: router ${routed}, labeler ${schema}`); continue; }
    const vs = viewsOf(intent.stage, intent.angle as string);
    if (!vs.length) { fail(`${t.slug}: ${id} stage ${intent.stage} routes to no view`); continue; }
    for (const v of vs) views[v] = (views[v] ?? 0) + 1;

    const asked = new Set(SCHEMA_FIELDS[schema as CodeSchema]);
    const sephAware = t.kind === "sephora" && schema.startsWith("awareness");
    const c: Record<string, unknown> = { response_id: id, source: SOURCE, run_id: run.id, project_id: t.project, contract, schema };
    for (const [k, v] of Object.entries(row)) {
      if (IGNORE.has(k)) continue;
      const f = FIELD_OF[k] ?? k;
      if (t.kind === "sephora" && f === "decision_rules") {
        if (SEPH_RULES.has(schema)) {
          if (!Array.isArray(v)) { fail(`${t.slug}: ${id} (${schema}) decision_rules is not a list`); continue; }
          for (const rule of v as Record<string, unknown>[]) if (ruleBad(schema, rule, true)) { fail(`${t.slug}: ${id} (${schema}) bad rule ${JSON.stringify(rule).slice(0, 80)}`); break; }
          c.decision_rules = v;
        } else if (v !== null) fail(`${t.slug}: ${id} (${schema}) carries decision_rules outside the rules schemas`);
        continue;
      }
      if (sephAware && (f === "reasons" || f === "uncoded")) continue; // the recorded deviation
      if (!asked.has(f)) {
        if (v !== null && v !== "n/a") fail(`${t.slug}: ${id} (${schema}) has unasked field ${k}=${JSON.stringify(v).slice(0, 60)}`);
        continue;
      }
      c[f] = f === "mentions" ? ranked(v as { brand: string; framing: string }[], ans.text as string) : v;
    }
    for (const f of asked) {
      if (f in c) continue;
      if (sephAware && (f === "topics" || f === "uncoded")) continue;
      fail(`${t.slug}: ${id} (${schema}) is missing asked field ${f}`);
    }
    if (contract === "v2_2026-10-22" && DR_ENUM[schema] !== undefined) {
      const rules = drRules.get(id);
      if (!Array.isArray(rules)) fail(`${t.slug}: ${id} (${schema}) has no recode decision_rules`);
      else {
        for (const rule of rules as Record<string, unknown>[]) if (ruleBad(schema, rule, false)) { fail(`${t.slug}: ${id} (${schema}) bad rule ${JSON.stringify(rule).slice(0, 80)}`); break; }
        c.decision_rules = rules;
        c.contract = `${contract}+drc3`;
        drRules.delete(id);
      }
    }
    for (const k of ALL) if (!(k in c)) c[k] = null;
    rows.push(c as unknown as AnswerCodes);
  }
  if (t.kind === "october") {
    for (const id of answerById.keys()) if (!seen.has(id)) fail(`${t.slug}: answer ${id} has no label`);
    for (const id of drRules.keys()) fail(`${t.slug}: recode rules for ${id} matched no v2 row`);
  }
  plan.push({ slug: t.slug, runId: run.id, pid: t.project, rows, answers: answers.length, views });
}

if (failures.length) {
  console.error(`FAILED - ${failures.length} problems (first 25):\n${failures.slice(0, 25).join("\n")}`);
  await sql.end();
  process.exit(1);
}
for (const p of plan) console.log(`${p.slug.padEnd(17)} run ${p.runId.slice(0, 8)}  answers ${p.answers}  rows ${p.rows.length}  views ${JSON.stringify(p.views)}`);
if (!WRITE) {
  console.log("\nall checks passed - DRY RUN, nothing written (re-run with --write)");
  await sql.end();
  process.exit(0);
}

for (const p of plan) {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM answer_codes WHERE run_id = ${p.runId} AND source = ${SOURCE}`;
    for (let i = 0; i < p.rows.length; i += 500) {
      const rows = p.rows.slice(i, i + 500).map(answerCodesToRow);
      await tx`INSERT INTO answer_codes ${tx(rows, ...ANSWER_CODE_COLUMNS)}`;
    }
  });
  console.log(`${p.slug}: wrote ${p.rows.length}`);
}

// Verification against prod (read-only): counts, one row per answer, and per
// schema every unasked column NULL / every non-nullable asked column filled.
const NULLABLE = new Set(["top_pick", "quote", "premise_quote", "decision_rules"]);
let bad = 0;
for (const p of plan) {
  const n = (await ro((tx) => tx`select count(*)::int n, count(distinct response_id)::int d from answer_codes where run_id = ${p.runId} and source = ${SOURCE}`))[0];
  const ok = n.n === p.rows.length && n.d === p.rows.length;
  if (!ok) bad++;
  const bySchema = (await ro((tx) => tx`select schema, count(*)::int n from answer_codes where run_id = ${p.runId} and source = ${SOURCE} group by schema order by schema`)) as unknown as { schema: string; n: number }[];
  const issues: string[] = [];
  for (const { schema } of bySchema) {
    const asked = new Set(SCHEMA_FIELDS[schema as CodeSchema]);
    for (const col of ALL) {
      if (col === "decision_rules") continue;
      const nn = (await ro((tx) => tx`select count(*)::int n from answer_codes where run_id = ${p.runId} and source = ${SOURCE} and schema = ${schema} and ${tx(col)} is not null`))[0].n as number;
      const total = bySchema.find((b) => b.schema === schema)!.n;
      const sephAware = p.slug === "sephora" && schema.startsWith("awareness") && (col === "topics" || col === "uncoded");
      if (!asked.has(col) && nn > 0) issues.push(`${schema}.${col} unasked but ${nn} filled`);
      if (asked.has(col) && !NULLABLE.has(col) && !sephAware && nn !== total) issues.push(`${schema}.${col} asked but ${total - nn} null`);
    }
  }
  if (issues.length) bad++;
  console.log(`verify ${p.slug.padEnd(17)} rows ${n.n} distinct ${n.d} expected ${p.rows.length} ${ok ? "OK" : "MISMATCH"}  schemas ${bySchema.map((b) => `${b.schema}:${b.n}`).join(" ")}${issues.length ? `\n  ISSUES: ${issues.join("; ")}` : ""}`);
}
await sql.end();
process.exit(bad ? 1 : 0);
