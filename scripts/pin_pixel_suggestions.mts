/** Pin the 2026-09-23 02:45 batch-run verdicts (the board Tyler ratified by
 * eye) into the per-name suggestion cache for Pixel. Pure cache write - no
 * model calls, no dictionary changes. */
import fs from "node:fs";
import { createHash } from "node:crypto";
for (const line of fs.readFileSync(".env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const { store } = await import("../src/lib/store");
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
const PID = "1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0";
const oldRows = await sql`SELECT value FROM llm_cache WHERE key LIKE ${'dict_suggest:'+PID+':%'}`;
let n = 0;
const counts: Record<string, number> = {};
for (const r of oldRows) for (const s of JSON.parse(r.value)) {
  const key = `dict_suggest:v7:${PID}:` + createHash("sha256").update(s.name.trim().toLowerCase()).digest("hex");
  await store.cacheSet(key, JSON.stringify({ action: s.action, merge_into: s.mergeIntoName ?? null, rationale: s.rationale ?? "" }), { projectId: PID, category: "smartphones" });
  counts[s.action] = (counts[s.action] ?? 0) + 1;
  n++;
}
console.log(`pinned ${n} verdicts:`, counts);
// Read back through the real path to confirm the board.
const { getDictionarySuggestions } = await import("../src/lib/engine/dict_suggest");
const sugg = await getDictionarySuggestions(PID, "smartphones");
const merged = sugg.filter(s => s.action === "merge" && s.mergeIntoId).length;
console.log(`board now: ${merged} grouped into existing brands, ${sugg.filter(s=>s.action==="approve").length} proposed, ${sugg.filter(s=>s.action==="ignore").length} ignored (${sugg.length} total)`);
await sql.end();
await new Promise((r) => setTimeout(r, 3000));
process.exit(0);
