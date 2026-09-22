import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const rows = await sql`
  SELECT p.brand, r.status, r.completed_at, r.created_at,
         (SELECT COUNT(*)::int FROM responses x WHERE x.run_id = r.id) AS responses,
         (SELECT COUNT(*)::int FROM mentions m JOIN responses x ON m.response_id = x.id WHERE x.run_id = r.id) AS mentions
  FROM runs r JOIN projects p ON p.id = r.project_id
  ORDER BY r.created_at DESC LIMIT 8`;
for (const r of rows) console.log(`${r.brand}\t${r.status}\tcreated ${String(r.created_at).slice(0,21)}\tresponses ${r.responses}\tmentions ${r.mentions}`);
await sql.end(); process.exit(0);
