import fs from "node:fs";
import { createHash } from "node:crypto";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const { buildFamilyPlan, suggestSystemPrompt } = await import("../src/lib/engine/dict_suggest");
const { openaiClient } = await import("../src/lib/engine/providers");
const { withCostContext } = await import("../src/lib/cost_log");
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const PID = "1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0";
const pendRows = await sql`SELECT id, canonical, aliases FROM dictionary_entries WHERE project_id=${PID} AND status='pending' ORDER BY canonical`;
const actRows = await sql`SELECT id, canonical, aliases FROM dictionary_entries WHERE project_id=${PID} AND status='active'`;
const mk = (r: any) => ({ ...r, aliases: JSON.parse(r.aliases), status: "x", confirmed: [] });
const pending = pendRows.map(mk), active = actRows.map(mk);
const plan = buildFamilyPlan(pending as never, active as never);
const byId = new Map(pending.map((p:any)=>[p.id, p.canonical]));
console.log("=== family plan");
console.log("mechanical active merges:", [...plan.activeMerge].map(([id,t])=>`${byId.get(id)}->${t}`).join(" | "));
console.log("children:", [...plan.rootOf].map(([id,r])=>`${byId.get(id)}->${byId.get(r)}`).join(" | "));
const roots = pending.filter((p:any)=>!plan.activeMerge.has(p.id)&&!plan.rootOf.has(p.id));
console.log("roots to model:", roots.length, "-", roots.map((r:any)=>r.canonical).join(", "));

const pinned = new Map<string,string>();
for (const p of pending as any[]) {
  const key = `dict_suggest:v7:${PID}:` + createHash("sha256").update(p.canonical.trim().toLowerCase()).digest("hex");
  const row = await sql`SELECT value FROM llm_cache WHERE key=${key}`;
  const v = JSON.parse(row[0].value);
  pinned.set(p.canonical, v.action === "merge" ? `merge->${(v.merge_into??"").toLowerCase()}` : v.action);
}
const SCHEMA = { type:"object", additionalProperties:false, properties:{ suggestions:{ type:"array", items:{ type:"object", additionalProperties:false, properties:{ name:{type:"string"}, action:{type:"string",enum:["merge","approve","ignore"]}, merge_into:{type:["string","null"]}, rationale:{type:"string"} }, required:["name","action","merge_into","rationale"] } } }, required:["suggestions"] } as const;
const system = suggestSystemPrompt("smartphones", active.map((a:any)=>a.canonical));
async function judgeRoots(): Promise<Map<string,{action:string; into:string|null}>> {
  const out = new Map();
  const names = roots.map((r:any)=>r.canonical);
  const batches: string[][] = [];
  for (let i=0;i<names.length;i+=40) batches.push(names.slice(i,i+40));
  await Promise.all(batches.map(async (b)=>{
    const res = await openaiClient().chat.completions.create({
      model:"gpt-5-mini",
      messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(b)}],
      max_completion_tokens:24000,
      response_format:{type:"json_schema",json_schema:{name:"dispositions",strict:true,schema:SCHEMA}},
    });
    for (const s of JSON.parse(res.choices[0]?.message?.content ?? '{"suggestions":[]}').suggestions)
      out.set(s.name, {action:s.action, into:s.merge_into});
  }));
  return out;
}
await withCostContext({ projectId: PID, purpose: "eval:dict_stability", rnd: true }, async () => {
  for (let run=1; run<=2; run++) {
    const rv = await judgeRoots();
    const final = new Map<string,string>();
    for (const p of pending as any[]) {
      const am = plan.activeMerge.get(p.id);
      if (am) { final.set(p.canonical, `merge->${am.toLowerCase()}`); continue; }
      const rootId = plan.rootOf.get(p.id);
      if (rootId) {
        const rootName = byId.get(rootId)!;
        const r = rv.get(rootName);
        if (!r) { final.set(p.canonical, "-"); continue; }
        final.set(p.canonical,
          r.action === "approve" ? `merge->${rootName.toLowerCase()}`
          : r.action === "merge" ? `merge->${(r.into??"").toLowerCase()}`
          : "ignore");
        continue;
      }
      const r = rv.get(p.canonical);
      final.set(p.canonical, !r ? "-" : r.action === "merge" ? `merge->${(r.into??"").toLowerCase()}` : r.action);
    }
    let match=0; const diffs:string[]=[];
    for (const [n,v] of final) {
      if (v === pinned.get(n)) match++;
      else diffs.push(`${n}: board=${pinned.get(n)} v8=${v}`);
    }
    console.log(`v8 fresh run ${run}: ${match}/${pending.length} identical to your board`);
    for (const d of diffs) console.log("  " + d);
  }
});
await sql.end();
await new Promise((r)=>setTimeout(r,4000));
process.exit(0);
