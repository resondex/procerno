/** Read-back check against prod: the four proposals parse, statuses are
 * 'proposed', and the page's data path (project -> proposal JSON -> codes)
 * holds. Read-only. */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const { store } = await import("../src/lib/store");
for (const id of ["2d52f699-30f6-40d3-a3ba-4fd26bdde29b","7354bce6-6c22-432e-a531-99ce3118dc7a","8b9f8453-c9b5-42fc-b0c2-f2af06a16b57","1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0"]) {
  const p = await store.getProject(id);
  if (!p) { console.log(id, "MISSING"); continue; }
  const prop = p.taxonomy_proposal ? JSON.parse(p.taxonomy_proposal) : null;
  console.log(`${p.brand}: status=${p.taxonomy_status}, proposal codes=${prop?.codes?.length ?? "none"}, boundary=${prop?.codes?.filter((c:any)=>c.scope==="boundary").length ?? 0}, ratified_list=${p.reason_taxonomy.length}`);
}
process.exit(0);
