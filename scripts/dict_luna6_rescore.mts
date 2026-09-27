import fs from "node:fs";
let url="";
for (const line of fs.readFileSync("/Users/tylersolloway/Documents/GitHub/procerno/.env.local","utf8").split("\n")) { const m=line.match(/^DATABASE_URL=(.*)$/); if(m) url=m[1].replace(/^"|"$/g,""); }
const postgres=(await import("/Users/tylersolloway/Documents/GitHub/procerno/node_modules/postgres/src/index.js")).default;
// Every query runs in its own READ ONLY transaction. A session-level
// "SET SESSION CHARACTERISTICS ... READ ONLY" must never be used here:
// behind the Supabase transaction pooler it sticks to a shared server
// connection and leaks to the live app (2026-09-26 incident).
const ro=postgres(url,{max:1});
const sql=Object.assign((s:TemplateStringsArray,...v:unknown[])=>ro.begin("read only",(t:any)=>t(s,...v)),{end:()=>ro.end()});
// Re-scores luna6/results.json with merged names counted as merges (no model calls; prod read only).
const D=`${process.env.HOME}/Documents/procerno_eval/dict_bakeoff/luna6`;
const d=JSON.parse(fs.readFileSync(`${D}/results.json`,"utf8"));
const norm=(s:string)=>s.trim().toLowerCase();
const act=(v?:string)=>(v??"missing").split(":")[0];
const maj=(vs:(string|undefined)[])=>{const c=new Map<string,number>();for(const v of vs)if(v)c.set(v,(c.get(v)??0)+1);return [...c].sort((a,b)=>b[1]-a[1])[0]?.[0];};
const fixed:Record<string,Record<string,string>>={};
let rejectedAndAliased=0;
for (const c of d.cases){
  const rows=await sql`SELECT canonical, aliases, status FROM dictionary_entries WHERE project_id=${c.pid}`;
  const t:Record<string,string>={};
  for(const r of rows){ if(r.status==="rejected") t[norm(r.canonical)]="ignore"; }
  for(const r of rows){ if(r.status==="active") t[norm(r.canonical)]="approve"; }
  for(const r of rows){ const al=(typeof r.aliases==="string"?JSON.parse(r.aliases):r.aliases) as string[];
    for(const a of al){ const n=norm(a); if(r.status==="active"){ if(t[n]==="ignore") rejectedAndAliased++; if(t[n]!=="approve") t[n]=`merge:${norm(r.canonical)}`; } else if(!(n in t)) t[n]="ignore"; } }
  fixed[c.brand]=t;
}
await sql.end();
console.log(`names that are BOTH a rejected entry and an alias of an active entry: ${rejectedAndAliased} (merged names - the bug)`);
console.log("| arm | brand | roots | action = board | action + merge target = board | excl. guard-flipped |\n| --- | --- | --- | --- | --- | --- |");
const refRow:any={};
for (const arm of ["prod-served (cached)","gpt-5-mini","gpt-6-luna"]){
  let T={n:0,a:0,at:0,x:0,xn:0};
  const conf=new Map<string,number>();
  for (const c of d.cases){
    let n=0,a=0,at=0,x=0,xn=0;
    for(const r of c.roots){
      const k=norm(r); const t=fixed[c.brand][k];
      let m:string|undefined;
      if(arm==="prod-served (cached)"){ const v=c.cached[k]||{}; m=v.action==="merge"?`merge:${norm(v.merge_into??"")}`:v.action; }
      else m=maj(d.results[arm][c.brand].map((x:any)=>x[k]));
      n++; const okA=act(m)===act(t); a+=+okA;
      const okT= m===t || (act(m)==="merge"&&act(t)==="merge"&&fixed[c.brand][m!.slice(6)]===t);
      at+=+okT; if(!c.guardFlipped.includes(k)){xn++; x+=+okT;}
      if(!okT){ const key=`${act(m)}->${act(t)}${okA?" (wrong target)":""}`; conf.set(key,(conf.get(key)??0)+1); }
    }
    const p=(u:number,v:number)=>`${Math.round(100*u/v)}%`;
    console.log(`| ${arm} | ${c.brand} | ${n} | ${p(a,n)} | ${p(at,n)} | ${p(x,xn)} |`);
    T.n+=n;T.a+=a;T.at+=at;T.x+=x;T.xn+=xn;
  }
  const p=(u:number,v:number)=>`**${Math.round(100*u/v)}%**`;
  console.log(`| ${arm} | all | ${T.n} | ${p(T.a,T.n)} | ${p(T.at,T.n)} | ${p(T.x,T.xn)} |`);
  refRow[arm]=Object.fromEntries(conf);
}
console.log(JSON.stringify(refRow,null,1));
// stability, recomputed for clarity
for (const arm of ["gpt-5-mini","gpt-6-luna"]){ let u=0,n=0; for(const c of d.cases) for(const r of c.roots){ const vs=d.results[arm][c.brand].map((x:any)=>x[norm(r)]); n++; if(vs.every((v:any)=>v&&v===vs[0])) u++; } console.log(arm,"unanimous across 3 runs", `${u}/${n}`, Math.round(100*u/n)+"%"); }
