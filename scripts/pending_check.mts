import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const rows = await sql`SELECT p.brand, d.status, count(*)::int as n FROM dictionary_entries d JOIN projects p ON p.id=d.project_id WHERE p.brand IN ('jira','American Express','Netflix','Google Pixel') GROUP BY p.brand, d.status ORDER BY p.brand, d.status`;
for (const r of rows) console.log(`${r.brand}: ${r.status}=${r.n}`);
await sql.end(); process.exit(0);
