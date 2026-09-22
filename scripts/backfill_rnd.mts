/** One-time: add rnd to prod cost_log and backfill per Tyler's rule
 * (2026-09-22): production spend = collection (run:*, setup:*) + the
 * project-tagged discovery census; everything else to date is R&D.
 * Additive tag - project/run/purpose untouched. */
import fs from "node:fs";
for (const line of fs.readFileSync("/Users/tylersolloway/Documents/GitHub/procerno/.env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
await sql`ALTER TABLE cost_log ADD COLUMN IF NOT EXISTS rnd BOOLEAN NOT NULL DEFAULT FALSE`;
const res = await sql`
  UPDATE cost_log SET rnd = TRUE
  WHERE NOT (purpose LIKE 'run:%' OR purpose LIKE 'setup:%'
             OR (purpose = 'discovery:open' AND project_id IS NOT NULL))`;
console.log(`flagged ${res.count} rows as R&D`);
const check = await sql`
  SELECT rnd, count(*) as calls, sum(input_tokens) as tin, sum(output_tokens) as tout
  FROM cost_log GROUP BY rnd ORDER BY rnd`;
for (const r of check) console.log(`rnd=${r.rnd}: ${r.calls} calls, in ${r.tin}, out ${r.tout}`);
await sql.end(); process.exit(0);
