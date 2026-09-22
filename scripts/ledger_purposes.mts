import fs from "node:fs";
for (const line of fs.readFileSync("/Users/tylersolloway/Documents/GitHub/procerno/.env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const rows = await sql`
  SELECT purpose, count(*) as calls, min(created_at)::date as first, max(created_at)::date as last,
         sum(input_tokens) as tin, sum(output_tokens) as tout
  FROM cost_log GROUP BY purpose ORDER BY calls DESC`;
for (const r of rows) console.log(`${r.purpose}\t${r.calls} calls\t${r.first}..${r.last}\tin ${r.tin} out ${r.tout}`);
await sql.end(); process.exit(0);
