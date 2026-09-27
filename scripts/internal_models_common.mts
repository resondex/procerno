/**
 * Shared plumbing for the internal-model tests (2026-09-26): env from
 * .env.local WITHOUT DATABASE_URL (the local store + ledger take over, under
 * process.cwd()/data, so run each arm from its own directory), and prod
 * reads through per-query READ ONLY transactions - never a session-level
 * SET, which leaks through the Supabase transaction pooler (AGENTS.md).
 *
 * Model choice is import-time (src/lib/engine/models.ts), so one process =
 * one arm: set the job's env var before running, e.g.
 *   JUNK_FILTER_MODEL=gpt-6-luna ARM=gpt-6-luna npx tsx scripts/internal_models_junk.mts
 */
import fs from "node:fs";
import zlib from "node:zlib";

export const REPO = "/Users/tylersolloway/Documents/GitHub/procerno";
export const OUT_ROOT = `${process.env.HOME}/Documents/procerno_eval/internal_models`;

let dbUrl = "";
for (const line of fs.readFileSync(`${REPO}/.env.local`, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) continue;
  const v = m[2].replace(/^"|"$/g, "");
  if (m[1] === "DATABASE_URL") dbUrl = v;
  else if (process.env[m[1]] === undefined) process.env[m[1]] = v;
}
delete process.env.DATABASE_URL;

export const ARM = process.env.ARM ?? "unnamed";
export const RUNS = Number(process.env.RUNS ?? 3);

const postgres = (await import(`${REPO}/node_modules/postgres/src/index.js`)).default;
const ro = postgres(dbUrl, { max: 1, prepare: false });
/** Prod read: every query in its own READ ONLY transaction. */
export const prod = (s: TemplateStringsArray, ...v: unknown[]): Promise<any[]> =>
  ro.begin("read only", (t: any) => t(s, ...v));
export const closeProd = () => ro.end();

export const norm = (s: string) => s.trim().toLowerCase();

export function outDir(test: string): string {
  const d = `${OUT_ROOT}/${test}`;
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export async function trackers(brands = ["jira", "American Express", "Netflix", "Google Pixel"]) {
  const rows = await prod`SELECT id, brand, category, audience, competitors FROM projects WHERE brand = ANY(${brands}) ORDER BY brand`;
  return rows.map((r) => ({
    id: r.id as string,
    brand: r.brand as string,
    category: r.category as string,
    audience: (r.audience as string | null) ?? null,
    competitors: JSON.parse(r.competitors as string) as string[],
  }));
}

/** Vault rows (answers) for one tracker's original run, keyed by id. */
export function vaultAnswers(prefix: string): Map<string, { text: string; prompt_id: string; model: string }> {
  const dir = `${process.env.HOME}/Documents/procerno_response_vault`;
  const file = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && !f.includes("gpt56") && f.endsWith(".jsonl.gz")).sort().pop();
  if (!file) throw new Error(`no vault file for ${prefix}`);
  const out = new Map<string, { text: string; prompt_id: string; model: string }>();
  for (const line of zlib.gunzipSync(fs.readFileSync(`${dir}/${file}`)).toString("utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (r.kind) continue;
    out.set(r.id, { text: r.text, prompt_id: r.prompt_id, model: r.model });
  }
  return out;
}

/** Deterministic shuffle (mulberry32). */
export function seeded<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Token usage of this arm's calls, read back from the LOCAL ledger. */
export async function localUsage(): Promise<{ model: string; purpose: string; calls: number; inTok: number; outTok: number }[]> {
  const { default: Database } = await import(`${REPO}/node_modules/better-sqlite3/lib/index.js`);
  const path = `${process.cwd()}/data/answerpoll.db`;
  if (!fs.existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  const rows = db.prepare(
    "SELECT model, purpose, count(*) calls, sum(input_tokens) inTok, sum(output_tokens) outTok FROM cost_log GROUP BY model, purpose"
  ).all();
  db.close();
  return rows;
}

/** The jobs under test swallow their own failures (console.error + a
 * neutral fallback), so a failure would score as "nothing flagged". Every
 * console.error is recorded here and written out with the results. */
export const errors: string[] = [];
const origError = console.error;
console.error = (...args: unknown[]) => {
  errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ").slice(0, 300));
  origError(...args);
};
