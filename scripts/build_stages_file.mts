/**
 * Build the labeler's stages file for a project: prompt id -> {stage, qtype,
 * situation, concern, line?} from the project's intents and prompts, the
 * input `labeling/build_batch.mts --design` reads (the v0.2 doubt line and
 * the settled-customer mode's stage). Prod read-only; zero spend.
 *
 *   npx tsx scripts/build_stages_file.mts <brand | project id> [out.json]
 *
 * Doubt lines are derived mechanically from the cell: a worry cell (stage
 * objections / churn_triggers / renewal with a concern) gets the v0.2
 * wording with the stored concern. Advocacy cells quote a critic in the
 * seed itself, which no stored field isolates, so each advocacy cell is
 * written with line null and needs_review: true plus its seed text - fill
 * the quoted criticism by hand (one cell per tracker) before labeling.
 */
import postgres from "postgres"; import fs from "node:fs"; import path from "node:path";
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const key = process.argv[2];
if (!key) { console.error("usage: npx tsx scripts/build_stages_file.mts <brand | project id> [out.json]"); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });
const ro = <T,>(f: (tx: any) => Promise<T>) => sql.begin("read only", f) as Promise<T>;
const isId = /^[0-9a-f-]{36}$/i.test(key);
const project = (await ro((tx) => isId ? tx`select id, brand from projects where id = ${key}` : tx`select id, brand from projects where brand ilike ${key} order by created_at desc limit 1`) as any[])[0];
if (!project) { console.error(`no project for ${key}`); process.exit(1); }
const rows = await ro((tx) => tx`select p.id prompt_id, p.text, p.retired, i.id intent_id, i.stage, i.qtype, i.situation, i.concern, i.angle, i.text seed from prompts p join intents i on i.id = p.intent_id where p.project_id = ${project.id} order by i.seq, p.seq`) as any[];
const DOUBT = new Set(["objections", "churn_triggers", "renewal"]);
const out: Record<string, any> = {};
const stages: Record<string, number> = {};
let advocacy = 0;
for (const r of rows) {
  const e: any = { stage: r.stage, qtype: r.qtype, situation: r.situation ?? null, concern: r.concern ?? null, retired: !!r.retired };
  if (DOUBT.has(r.stage) && r.concern) {
    e.type = "doubt";
    e.line = `Question design (doubt): the question voices a concern about ${project.brand}. Doubt: "${r.concern}"`;
  } else if (r.stage === "advocacy") {
    e.type = "doubt"; e.line = null; e.needs_review = true; e.seed = r.seed; advocacy++;
  } else e.type = null;
  out[r.prompt_id] = e;
  stages[r.stage] = (stages[r.stage] ?? 0) + 1;
}
const slug = String(project.brand).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const dest = process.argv[3] ?? `${process.env.HOME}/Documents/procerno_eval/labeling/g3/stages_${slug}.json`;
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`${project.brand} (${project.id}): ${rows.length} prompts -> ${dest}`);
console.log("per stage:", Object.entries(stages).map(([s, n]) => `${s} ${n}`).join(", "));
console.log(`doubt lines: ${Object.values(out).filter((e: any) => e.line).length}; advocacy prompts needing a hand-filled critic line: ${advocacy}`);
await sql.end(); process.exit(0);
