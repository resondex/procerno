import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const runs = await sql`SELECT id, status, models, repeats FROM runs WHERE project_id = '1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0' ORDER BY created_at DESC LIMIT 3`;
for (const r of runs) {
  const n = await sql`SELECT COUNT(*)::int AS n FROM responses WHERE run_id = ${r.id}`;
  const prompts = await sql`SELECT COUNT(*)::int AS n FROM prompts WHERE project_id = '1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0' AND COALESCE(retired, 0) = 0`;
  console.log(`run ${r.id.slice(0,8)} status=${r.status} models=${JSON.parse(r.models as string).length} repeats=${r.repeats} responses=${n[0].n} livePrompts~${prompts[0].n}`);
}
await sql.end(); process.exit(0);
