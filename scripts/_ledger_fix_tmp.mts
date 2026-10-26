/** Ledger correction (Tyler's go, 2026-10-11): grok-4-fast rows were priced from a
 * stale table ($0.20/$0.50) and omit reasoning tokens; xAI's console (Pacific days)
 * gives the true daily text spend. Each day's total is apportioned across that
 * day's grok-4-fast rows in proportion to their table-priced cost at the real
 * grok-4.3 rates, written to vendor_cost_usd and cost_usd, usage_raw marked
 * reconstructed. Days without a console figure are left untouched. */
import postgres from "postgres"; import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z_]+)=(.*)$/); if (m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const sql=postgres(process.env.DATABASE_URL!,{ssl:"require",max:1});
const APPLY = process.argv.includes("--apply");
const DAYS: Record<string, number> = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); // {"2026-09-22": 130.41, ...}
for (const [day, total] of Object.entries(DAYS)) {
  const rows = await sql.begin("read only", tx => tx`select id, input_tokens, output_tokens, purpose from cost_log where model='grok-4-fast' and (created_at at time zone 'America/Los_Angeles')::date = ${day}::date and vendor_cost_usd is null`) as any[];
  if (!rows.length) { console.log(`${day}: no unpriced grok-4-fast rows - skipped`); continue; }
  const w = rows.map((r:any)=> (Number(r.input_tokens)||0) * 1.25e-6 + (Number(r.output_tokens)||0) * 2.5e-6);
  const W = w.reduce((a,b)=>a+b,0);
  const by: Record<string,[number,number]> = {}; rows.forEach((r:any,i:number)=>{ const c = total * w[i]/W; const b = by[r.purpose] ??= [0,0]; b[0]++; b[1]+=c; });
  console.log(`${day}: $${total} over ${rows.length} rows (table-priced at 4.3 rates: $${W.toFixed(2)}, scale ${(total/W).toFixed(2)}x): ` + Object.entries(by).map(([p,[n,c]])=>`${p} ${n} rows $${c.toFixed(2)}`).join("; "));
  if (!APPLY) continue;
  await sql.begin(async tx => {
    for (let i = 0; i < rows.length; i++) {
      const c = total * w[i] / W;
      await tx`update cost_log set vendor_cost_usd = ${c}, cost_usd = ${c}, usage_raw = ${sql.json({ reconstructed_from: "xai_console_daily_total", day, day_total_usd: total, model_served: "grok-4.3", note: "grok-4-fast alias; reasoning tokens not recorded; apportioned by table-priced tokens" })} where id = ${rows[i].id}`;
    }
  });
  console.log(`${day}: written`);
}
await sql.end(); process.exit(0);
