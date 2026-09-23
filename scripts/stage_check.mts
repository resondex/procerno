import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const rows = await sql`SELECT brand, taxonomy_status, dictionary_status, jsonb_array_length(reason_taxonomy::jsonb) as codes FROM projects WHERE brand IN ('jira','American Express','Netflix','Google Pixel')`;
for (const r of rows) console.log(`${r.brand}: taxonomy=${r.taxonomy_status} dict=${r.dictionary_status} ratified_codes=${r.codes}`);
await sql.end(); process.exit(0);
