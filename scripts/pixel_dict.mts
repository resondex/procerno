import fs from "node:fs";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const { store } = await import("../src/lib/store");
const d = await store.getDictionary("1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0");
for (const e of d) console.log(`${e.canonical} | role=${e.role ?? "target"} | status=${e.status} | aliases=${e.aliases.join(",")}`);
process.exit(0);
