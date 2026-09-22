/** One-time data correction (Tyler's go, 2026-09-23): jira's run carried
 * status 'complete' from the pre-hold pipeline despite zero coded mentions.
 * Reset to 'collected' so it sits on the codebook gate like the other
 * collected-not-coded runs. Reversible: SET status='complete'. */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const res = await sql`
  UPDATE runs SET status = 'collected', completed_at = NULL
  WHERE project_id = '2d52f699-30f6-40d3-a3ba-4fd26bdde29b' AND status = 'complete'
  RETURNING id, status`;
console.log("updated:", JSON.stringify(res));
await sql.end(); process.exit(0);
