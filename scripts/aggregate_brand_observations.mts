/** Aggregate the discovery brands pass into per-project observations:
 * per mentioned name, the number of answers naming it, matched to the
 * dictionary via matchKey (canonical or alias). Unmatched names are the
 * emerged brands. Writes projects.brand_observations. Local JSONL in,
 * prod metadata out - answers untouched.
 * Usage: npx tsx scripts/aggregate_brand_observations.mts <brand> <mentions.jsonl> <projectId>
 */
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const [brand, mentionsPath, projectId] = process.argv.slice(2);
const { store } = await import("../src/lib/store");
const { matchKey } = await import("../src/lib/brand_key");

const dict = await store.getDictionary(projectId);
const keyToEntry = new Map<string, string>();
for (const e of dict) {
  keyToEntry.set(matchKey(e.canonical), e.id);
  for (const a of e.aliases) keyToEntry.set(matchKey(a), e.id);
}

// Per name-key: answer count and the most common surface form.
const byKey = new Map<string, { answers: number; forms: Map<string, number> }>();
let rows = 0;
for (const line of fs.readFileSync(mentionsPath, "utf8").trim().split("\n")) {
  const d = JSON.parse(line) as { brands: string[] };
  rows++;
  const seen = new Set<string>();
  for (const b of d.brands ?? []) {
    const k = matchKey(b);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const g = byKey.get(k) ?? { answers: 0, forms: new Map() };
    g.answers++;
    g.forms.set(b, (g.forms.get(b) ?? 0) + 1);
    byKey.set(k, g);
  }
}
const observed = [...byKey.entries()]
  .map(([k, g]) => ({
    name: [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0],
    entry_id: keyToEntry.get(k) ?? null,
    answers: g.answers,
  }))
  .sort((a, b) => b.answers - a.answers)
  // keep tracked entries regardless; emerged names only above 0.5% of rows
  .filter((o) => o.entry_id !== null || o.answers >= rows * 0.005)
  .slice(0, 80);
await store.setBrandObservations(
  projectId,
  JSON.stringify({ rows, generated_at: new Date().toISOString(), observed })
);
const matched = observed.filter((o) => o.entry_id).length;
console.log(`${brand}: ${rows} answers, ${observed.length} brands kept (${matched} matched to dictionary, ${observed.length - matched} emerged)`);
await new Promise((r) => setTimeout(r, 4000));
process.exit(0);
