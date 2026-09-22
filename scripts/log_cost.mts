/** Append one cost_log row from a non-repo script (research pipelines that
 * call vendors over raw HTTP). Usage:
 *   npx tsx scripts/log_cost.mts <model> <inputTokens> <outputTokens> <purpose> [projectId] [rnd]
 */
import fs from "node:fs";
for (const line of fs.readFileSync("/Users/tylersolloway/Documents/GitHub/procerno/.env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const [model, tin, tout, purpose, projectId, rnd] = process.argv.slice(2);
await sql`INSERT INTO cost_log ${sql({
  id: crypto.randomUUID(), project_id: projectId || null, run_id: null,
  purpose, model, input_tokens: Number(tin), output_tokens: Number(tout),
  searches: 0, rnd: rnd === "true",
})}`;
console.log(`logged: ${purpose} ${model} in=${tin} out=${tout} project=${projectId||"-"} rnd=${rnd==="true"}`);
await sql.end(); process.exit(0);
