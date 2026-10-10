/**
 * Collection accounting: exact spend per tracker x engine for a run (or every
 * run of the named brands), from the cost ledger's write-time cost_usd.
 * Prod is read through a read-only TRANSACTION (never a session SET - see
 * AGENTS.md, pooler incident).
 *
 *   npx tsx scripts/collection_accounting.mts "American Express" [Jira ...]
 *   RUN_ID=<run id> npx tsx scripts/collection_accounting.mts
 *
 * Per engine: answers stored, ledger calls by purpose (preflight, live
 * answers, batch answers incl. billed-but-empty lines), tokens, billed
 * searches, exact USD, and rows still lacking cost_usd (pre-2026-10-10).
 */
import fs from "node:fs";
import postgres from "postgres";

let DB = "";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && m[1] === "DATABASE_URL") DB = m[2].replace(/^"|"$/g, "");
}
const sql = postgres(DB, { max: 1 });

const brands = process.argv.slice(2);
const runFilter = process.env.RUN_ID ?? null;

const out = await sql.begin("read only", async (tx) => {
  const runs = runFilter
    ? await tx`SELECT r.id, r.status, r.pipeline, r.created_at, p.brand, p.id AS project_id
        FROM runs r JOIN projects p ON p.id = r.project_id WHERE r.id = ${runFilter}`
    : await tx`SELECT r.id, r.status, r.pipeline, r.created_at, p.brand, p.id AS project_id
        FROM runs r JOIN projects p ON p.id = r.project_id
        WHERE p.brand = ANY(${brands}) ORDER BY r.created_at`;
  const result = [];
  for (const run of runs) {
    const answers = await tx`SELECT model AS engine, count(*)::int AS n,
        count(*) FILTER (WHERE finish_reason NOT IN ('stop','end_turn'))::int AS not_clean,
        coalesce(sum(search_count),0)::int AS searches
      FROM responses WHERE run_id = ${run.id} GROUP BY model ORDER BY model`;
    const ledger = await tx`SELECT coalesce(engine, model) AS engine, purpose, batch,
        count(*)::int AS calls,
        sum(input_tokens)::bigint AS input, sum(cached_input_tokens)::bigint AS cached,
        sum(cache_write_tokens)::bigint AS cache_write, sum(output_tokens)::bigint AS output,
        sum(searches)::int AS searches,
        coalesce(sum(cost_usd),0)::float8 AS usd,
        count(*) FILTER (WHERE vendor_cost_usd IS NOT NULL)::int AS vendor_priced,
        count(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced
      FROM cost_log WHERE run_id = ${run.id}
      GROUP BY 1, 2, 3 ORDER BY 1, 2`;
    const batches = await tx`SELECT vendor, endpoint, status, provider_batch_id,
        jsonb_array_length(manifest::jsonb) AS tasks, created_at
      FROM run_batches WHERE run_id = ${run.id} ORDER BY created_at`;
    result.push({ run, answers, ledger, batches });
  }
  return result;
});

for (const { run, answers, ledger, batches } of out) {
  console.log(`\n## ${run.brand} - run ${run.id} (${run.pipeline}, ${run.status}, ${run.created_at})`);
  console.log("\nVendor batches:");
  for (const b of batches) console.log(`  ${b.vendor} ${b.endpoint} ${b.status} tasks=${b.tasks} ${b.provider_batch_id}`);
  const byEngine = new Map<string, { usd: number; rows: typeof ledger }>();
  for (const l of ledger) {
    const e = byEngine.get(l.engine) ?? { usd: 0, rows: [] as unknown as typeof ledger };
    e.usd += l.usd;
    (e.rows as unknown as unknown[]).push(l);
    byEngine.set(l.engine, e);
  }
  console.log("\n| engine | answers | not clean | searches (answers) | ledger calls | in | cached | out | billed searches | USD | $/answer |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  let total = 0;
  let totalAnswers = 0;
  const engines = new Set([...answers.map((a) => a.engine as string), ...byEngine.keys()]);
  for (const engine of [...engines].sort()) {
    const a = answers.find((x) => x.engine === engine);
    const e = byEngine.get(engine);
    const rows = (e?.rows ?? []) as unknown as {
      calls: number; input: string; cached: string; output: string; searches: number; unpriced: number; purpose: string;
    }[];
    const sum = (k: "input" | "cached" | "output") => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const calls = rows.map((r) => `${r.purpose}:${r.calls}`).join(" ");
    const usd = e?.usd ?? 0;
    total += usd;
    totalAnswers += a?.n ?? 0;
    const unpriced = rows.reduce((s, r) => s + r.unpriced, 0);
    console.log(
      `| ${engine} | ${a?.n ?? 0} | ${a?.not_clean ?? 0} | ${a?.searches ?? 0} | ${calls} | ${sum("input")} | ${sum("cached")} | ${sum("output")} | ${rows.reduce((s, r) => s + (r.searches ?? 0), 0)} | ${usd.toFixed(2)}${unpriced ? ` (+${unpriced} unpriced)` : ""} | ${a?.n ? (usd / a.n).toFixed(4) : "-"} |`
    );
  }
  console.log(`\nTotal: $${total.toFixed(2)} over ${totalAnswers} answers`);
}
await sql.end();
