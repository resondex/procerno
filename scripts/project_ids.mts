import fs from "node:fs";
for (const line of fs.readFileSync("/Users/tylersolloway/Documents/GitHub/procerno/.env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const rows = await sql`SELECT id, brand FROM projects WHERE brand IN ('jira','American Express','Netflix','Google Pixel')`;
for (const r of rows) console.log(`${r.brand}\t${r.id}`);
await sql.end(); process.exit(0);
