/**
 * Export the four labeled trackers' CONFIRMED brand dictionaries (active
 * entries + aliases, target marked) for the v0.2 B1 isolated test (Tyler's go,
 * 2026-09-27). Prod is read through a per-query read-only transaction (never a
 * session SET - see AGENTS.md pooler incident). Output: one JSON per tracker in
 * ~/Documents/procerno_eval/labeling/v02_relabel/isolated/dict_<brand>.json.
 *
 * Usage: npx tsx scripts/export_confirmed_dictionaries.mts
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
let DB_URL = "";
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^DATABASE_URL=(.*)$/);
  if (m) DB_URL = m[1].replace(/^"|"$/g, "");
}
const postgres = (await import(`${REPO}/node_modules/postgres/src/index.js`)).default;
const { matchKey } = await import(`${REPO}/src/lib/brand_key`);
const ro = postgres(DB_URL, { max: 1 });
const sql = (s: TemplateStringsArray, ...v: unknown[]) => ro.begin("read only", (t: any) => t(s, ...v));

const OUT = `${process.env.HOME}/Documents/procerno_eval/labeling/v02_relabel/isolated`;
fs.mkdirSync(OUT, { recursive: true });
const SLUG: Record<string, string> = { jira: "jira", "American Express": "amex", Netflix: "netflix", "Google Pixel": "pixel" };
const norm = (s: string) => matchKey(s);

const projects = await sql`SELECT id, brand, dictionary_status FROM projects
  WHERE brand IN ('jira','American Express','Netflix','Google Pixel') ORDER BY brand`;
for (const p of projects) {
  const rows = await sql`SELECT canonical, aliases, status FROM dictionary_entries
    WHERE project_id=${p.id} AND status='active' ORDER BY canonical`;
  const entries = rows.map((r: any) => ({
    name: r.canonical as string,
    aliases: ((typeof r.aliases === "string" ? JSON.parse(r.aliases) : r.aliases) ?? []) as string[],
  }));
  const t = norm(p.brand);
  for (const e of entries) (e as any).target = norm(e.name) === t || e.aliases.some((a) => norm(a) === t);
  const nTarget = entries.filter((e: any) => e.target).length;
  if (nTarget !== 1) throw new Error(`${p.brand}: ${nTarget} target entries`);
  const file = `${OUT}/dict_${SLUG[p.brand]}.json`;
  fs.writeFileSync(file, JSON.stringify({ brand: p.brand, dictionary_status: p.dictionary_status, entries }, null, 1));
  console.log(`${p.brand}: ${entries.length} active entries, ${entries.reduce((n, e) => n + e.aliases.length, 0)} aliases, status ${p.dictionary_status} -> ${file}`);
}
await ro.end();
