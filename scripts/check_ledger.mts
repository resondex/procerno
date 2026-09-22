import fs from "node:fs";
for (const line of fs.readFileSync("/Users/tylersolloway/Documents/GitHub/procerno/.env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const rows = await sql`
  SELECT p.brand, c.purpose, c.model, count(*) as calls,
         sum(c.input_tokens) as tin, sum(c.output_tokens) as tout
  FROM cost_log c LEFT JOIN projects p ON p.id = c.project_id
  WHERE c.purpose = 'discovery:open'
  GROUP BY p.brand, c.purpose, c.model ORDER BY p.brand`;
console.log(rows.map(r=>`${r.brand ?? "(untagged)"}: ${r.calls} calls, in ${r.tin}, out ${r.tout}`).join("\n"));
await sql.end(); process.exit(0);
