/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only prod snapshot for the dictionary root-cause replay (2026-11-13):
 * the ten boards' entries, their cached suggestion verdicts and the observed
 * brand names with answer counts. Every query is its own READ ONLY
 * transaction; no model calls; writes one local JSON file.
 *   npx tsx scripts/dict_rootcause_fetch.mts <out.json> */
import fs from "node:fs";
import postgres from "postgres";
let DB = "";
for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = /^DATABASE_URL=(.*)$/.exec(line.trim());
  if (m) DB = m[1].trim().replace(/^["']|["']$/g, "");
}
const out = process.argv[2];
if (!out) throw new Error("usage: dict_rootcause_fetch.mts <out.json>");
const ro = postgres(DB, { max: 1, prepare: false });
const q = (s: TemplateStringsArray, ...v: unknown[]) => ro.begin("read only", (t: any) => t(s, ...v));
// The four September boards Tyler confirmed (archived, pinned by id) and
// every live tracker.
const SEPT = ["7354bce6-6c22-432e-a531-99ce3118dc7a", "1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0", "2d52f699-30f6-40d3-a3ba-4fd26bdde29b", "8b9f8453-c9b5-42fc-b0c2-f2af06a16b57"];
const projects = await q`SELECT id, brand, category, competitors, archived_at, dictionary_status FROM projects
  WHERE archived_at IS NULL OR id = ANY(${SEPT}) ORDER BY created_at`;
const boards = [];
for (const p of projects) {
  const entries = await q`SELECT id, canonical, aliases, status, confirmed_aliases, parent FROM dictionary_entries WHERE project_id = ${p.id}`;
  const cache = await q`SELECT key, value FROM llm_cache WHERE key LIKE ${"dict_suggest:%:" + p.id + ":%"}`;
  const names = await q`SELECT b.name, count(DISTINCT r.id)::int AS answers
    FROM responses r JOIN runs u ON u.id = r.run_id,
    LATERAL json_array_elements_text(r.discovery_brands::json) AS b(name)
    WHERE u.project_id = ${p.id} AND r.discovery_brands IS NOT NULL GROUP BY 1`;
  const rows = await q`SELECT count(*)::int AS n FROM responses r JOIN runs u ON u.id = r.run_id WHERE u.project_id = ${p.id} AND r.discovery_brands IS NOT NULL`;
  boards.push({
    id: p.id, brand: p.brand, category: p.category, archived: Boolean(p.archived_at), status: p.dictionary_status,
    era: p.archived_at ? "sept" : "live",
    entries: entries.map((e: any) => ({ ...e, aliases: JSON.parse(e.aliases), confirmed_aliases: JSON.parse(e.confirmed_aliases ?? "[]") })),
    cache: cache.map((c: any) => ({ key: c.key, value: JSON.parse(c.value) })),
    names, rows: rows[0].n,
  });
  console.log(`${p.brand} (${p.archived_at ? "sept" : "live"}) entries ${entries.length} verdicts ${cache.length} names ${names.length} answers ${rows[0].n}`);
}
fs.writeFileSync(out, JSON.stringify({ fetched_at: new Date().toISOString(), boards }));
await ro.end();
