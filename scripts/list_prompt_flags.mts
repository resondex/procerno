/**
 * Print the question check's flag log (prompt_flags) across every tracker -
 * for reviewing problems the check raised, how they were resolved, and what
 * was suggested. Hand-run from the repo root:
 *
 *   npx tsx scripts/list_prompt_flags.mts            # every row
 *   npx tsx scripts/list_prompt_flags.mts --open     # open rows only
 *   npx tsx scripts/list_prompt_flags.mts Pixel      # brand substring filter
 *
 * Prod (DATABASE_URL in .env.local) is read READ ONLY: every query runs in
 * its own read-only transaction (never a session-level SET - behind the
 * Supabase transaction pooler it sticks to a shared server connection and
 * leaks to the live app, the 2026-09-26 incident). With SQLITE_PATH set and
 * DATABASE_URL blank it reads that sqlite file instead. No model calls, no
 * writes.
 */
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();
let DB_URL = process.env.DATABASE_URL ?? "";
const envFile = path.join(REPO, ".env.local");
if (fs.existsSync(envFile) && process.env.DATABASE_URL === undefined) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] === "DATABASE_URL") DB_URL = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const openOnly = args.includes("--open");
const filters = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());

interface Row {
  id: string;
  brand: string;
  run_id: string;
  prompt_id: string;
  stage: string | null;
  kind: string;
  prompt_text: string;
  rate: number | null;
  siblings_rate: number | null;
  answers: number | null;
  reason: string | null;
  suggested_text: string | null;
  staged_prompt_id: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_text: string | null;
}

let rows: Row[];
if (DB_URL) {
  const postgres = (await import(`${REPO}/node_modules/postgres/src/index.js`)).default;
  const ro = postgres(DB_URL, { max: 1, prepare: false }); // transaction pooler: no prepared statements
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (s: TemplateStringsArray, ...v: unknown[]) => ro.begin("read only", (t: any) => t(s, ...v));
  const got = (await q`SELECT f.id, p.brand, f.run_id, f.prompt_id, f.stage, f.kind, f.prompt_text, f.rate,
      f.siblings_rate, f.answers, f.reason, f.suggested_text, f.staged_prompt_id, f.status,
      f.created_at::text AS created_at, f.resolved_at::text AS resolved_at, f.resolved_text
    FROM prompt_flags f LEFT JOIN projects p ON p.id = f.project_id
    ORDER BY p.brand, f.created_at`) as Row[];
  rows = got;
  await ro.end();
  console.log(`store: POSTGRES (read only) · ${rows.length} rows`);
} else {
  const { store } = await import(`${REPO}/src/lib/store/index.ts`);
  const projects = new Map((await store.listProjects()).map((p: { id: string; brand: string }) => [p.id, p.brand]));
  rows = (await store.listPromptFlags()).map((f: Row & { project_id: string }) => ({ ...f, brand: projects.get(f.project_id) ?? "?" }));
  console.log(`store: sqlite ${process.env.SQLITE_PATH ?? "(default)"} · ${rows.length} rows`);
}

const pct = (x: number | null) => (x == null ? "-" : `${Math.round(Number(x) * 100)}%`);
let shown = 0;
for (const r of rows) {
  if (openOnly && r.status !== "open") continue;
  if (filters.length > 0 && !filters.some((f) => (r.brand ?? "").toLowerCase().includes(f))) continue;
  shown++;
  console.log(
    `\n${r.brand} · ${r.kind}${r.stage ? ` [${r.stage}]` : ""} · ${r.status.toUpperCase()} · run ${r.run_id.slice(0, 8)} · ${r.created_at.slice(0, 16)}`
  );
  console.log(`  asked:     ${r.prompt_text}`);
  console.log(`  on topic:  ${pct(r.rate)} vs siblings ${pct(r.siblings_rate)} (${r.answers ?? "-"} answers)`);
  if (r.suggested_text) console.log(`  suggested: ${r.suggested_text}${r.staged_prompt_id ? " (staged)" : ""}`);
  if (r.resolved_at) console.log(`  resolved:  ${r.resolved_at.slice(0, 16)}${r.resolved_text ? ` -> ${r.resolved_text}` : ""}`);
}
console.log(`\n${shown} shown`);
process.exit(0);
