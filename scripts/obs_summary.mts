import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const rows = await sql`SELECT brand, brand_observations FROM projects WHERE brand_observations IS NOT NULL`;
for (const r of rows) {
  const o = JSON.parse(r.brand_observations as string);
  const top = o.observed.slice(0, 6).map((x: any) => `${x.name}${x.entry_id ? "" : "*"} ${Math.round(x.answers / o.rows * 100)}%`).join(", ");
  console.log(`${r.brand}: ${top}  (*=emerged)`);
}
await sql.end(); process.exit(0);
