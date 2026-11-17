/**
 * Re-read the coder's SAVED failed replies with today's reader (2026-11-16).
 *
 * When the coder's reply breaks the contract the wave records it in llm_cache
 * (coder_fail:<source>:<response id>, with the raw reply) and never re-sends
 * it. When the reader is made more tolerant, those saved replies can be read
 * again WITHOUT calling the coder: this script parses each one with
 * parseCoderReply, validates it with toAnswerCodes exactly as the wave does,
 * and - with --write - stores the row, drops the failure record and clears the
 * run's memoized revision so the views recompute.
 *
 *   npx tsx scripts/recode_saved_failures.mts            # dry run: what would be stored
 *   npx tsx scripts/recode_saved_failures.mts --write    # store the rows (PROD WRITE)
 *
 * No model calls (only DATABASE_URL is loaded). A two-pass tracker's row keeps
 * the base coder's reasons (the adapter's reply was not saved) and is marked
 * ";reasons:base" like any degraded row.
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^(DATABASE_URL)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const WRITE = process.argv.includes("--write");

const { store } = await import("../src/lib/store");
const { parseCoderReply, toAnswerCodes, coderSource } = await import("../src/lib/engine/coder");
const { coderFailKey } = await import("../src/lib/engine/coding_wave");
const { buildCoderRequest, parseCoderInputs, resolveCodebook } = await import("../src/lib/engine/coder_prompts");
const { purgeRunRevision } = await import("../src/lib/engine/run_revision");
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1, prepare: false });
const ro = <T,>(f: (tx: typeof sql) => Promise<T>) => sql.begin("read only", f) as Promise<T>;

const projects = (await ro((tx) => tx`select id, brand, codes_source from projects where archived_at is null and codes_source is not null order by brand`)) as { id: string; brand: string; codes_source: string }[];
let stored = 0;
for (const p of projects) {
  const project = (await store.getProject(p.id))!;
  const adapter = await store.getReasonsAdapter(p.id);
  const source = coderSource(adapter);
  if (source !== p.codes_source) {
    console.log(`${p.brand}: reads ${p.codes_source}, the coder writes ${source} - skipped`);
    continue;
  }
  const rows = (await ro((tx) => tx`
    select r.id, r.run_id, r.prompt_id, r.text from responses r join runs u on u.id = r.run_id
    where u.project_id = ${p.id} and not exists (select 1 from answer_codes c where c.response_id = r.id and c.source = ${source})`)) as { id: string; run_id: string; prompt_id: string; text: string }[];
  if (!rows.length) continue;
  const [prompts, intents] = await Promise.all([store.listPrompts(p.id), store.listIntents(p.id)]);
  const promptById = new Map(prompts.map((x) => [x.id, x]));
  const intentById = new Map(intents.map((x) => [x.id, x]));
  const inputs = parseCoderInputs(await store.getCoderInputs(p.id));
  const book = resolveCodebook(project, inputs);
  const ctx = { brand: project.brand, codes: book.codes, defs: book.defs, inputs };
  for (const r of rows) {
    const failKey = coderFailKey(source, r.id);
    const saved = await store.cacheGet(failKey, 10 * 365 * 24 * 3600_000);
    if (!saved) {
      console.log(`${p.brand} ${r.id.slice(0, 8)}: no saved reply - needs a coder run`);
      continue;
    }
    const prompt = promptById.get(r.prompt_id);
    const cell = prompt?.intent_id ? intentById.get(prompt.intent_id) ?? null : null;
    const req = buildCoderRequest(cell, prompt?.text ?? "", r.text, ctx);
    if (!req) {
      console.log(`${p.brand} ${r.id.slice(0, 8)}: no contract schema for its question - left`);
      continue;
    }
    const raw = (JSON.parse(saved) as { raw: string; why: string }).raw;
    const parsed = parseCoderReply(raw);
    if (!parsed.ok) {
      console.log(`${p.brand} ${r.id.slice(0, 8)}: still unreadable`);
      continue;
    }
    const v = toAnswerCodes(req.schema, parsed.obj, { response_id: r.id, source, run_id: r.run_id, project_id: p.id }, r.text, ctx.codes);
    if (!v.ok) {
      console.log(`${p.brand} ${r.id.slice(0, 8)}: read (${parsed.mode}) but fails the contract: ${v.why}`);
      continue;
    }
    const twoPass = !!adapter && req.schema !== "awareness_pr" && req.schema !== "awareness_ce";
    if (twoPass) v.row.contract = `${v.row.contract};reasons:base`;
    console.log(`${p.brand} ${r.id.slice(0, 8)}: ${req.schema}, read as ${parsed.mode}${v.notes.length ? `; notes: ${v.notes.join("; ")}` : ""}`);
    console.log(`   ${JSON.stringify({ outcome: v.row.outcome, top_pick: v.row.top_pick, verdict: v.row.relationship_verdict, reasons: v.row.reasons, mentions: v.row.mentions?.length, rules: v.row.decision_rules?.length, pairings: v.row.pairings, quote: v.row.quote })}`);
    if (WRITE) {
      await store.upsertAnswerCodes([v.row]);
      await store.cacheDelete(failKey);
      await purgeRunRevision(r.run_id);
      stored++;
    }
  }
}
console.log(WRITE ? `stored ${stored} row(s)` : "dry run - nothing written (pass --write to store)");
await sql.end();
process.exit(0);
