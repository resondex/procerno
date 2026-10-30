/**
 * Record a tracker's coder prompt inputs (projects.coder_inputs) and,
 * optionally, its reasons adapter (projects.reasons_adapter) - the two
 * per-tracker settings the coding wave reads besides the confirmed codebook.
 *
 *   npx tsx scripts/coder_inputs.mts <project id> --slug <labeling slug>
 *       [--flag-vocab <file>] [--stages <file>]
 *       [--adapter <fireworks model id> | --clear-adapter] [--write]
 *
 * Inputs come from the FROZEN labeling files, never re-derived:
 *   --flag-vocab  default ~/Documents/procerno_eval/labeling/exports_2026-10-12/flag_vocab_<slug>.json
 *                 (Sephora: finetune/warm_sephora/inputs/flag_vocab_sephora.json)
 *   --stages      default ~/Documents/procerno_eval/labeling/g3/stages_<slug>.json
 *                 (the hand-reviewed advocacy critic line per prompt id)
 *
 * DRY RUN by default (prod read-only, per-query read-only transactions):
 * prints the inputs and validates them end to end - the codebook resolves
 * (every confirmed code has its scope sentence), every cell of the battery
 * builds its trained prompt prefix (no advocacy cell without a criticism),
 * and an adapter, if given, was warm-started from the configured coder.
 * --write stores them (one UPDATE, terminal + typed project id required).
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { buildCoderInputsFromFiles } from "./lib/coder_inputs_files.mts";
import { buildCoderRequest, parseCoderInputs, resolveCodebook, type CoderPromptContext } from "../src/lib/engine/coder_prompts";
import { adapterMismatch, coderSource, CODER_MODEL } from "../src/lib/engine/coder";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EV = `${process.env.HOME}/Documents/procerno_eval`;
const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const projectId = argv[0];
const slug = opt("slug");
if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId) || !slug) {
  console.error("usage: coder_inputs.mts <project id> --slug <slug> [--flag-vocab f] [--stages f] [--adapter id | --clear-adapter] [--write]");
  process.exit(2);
}
const flagVocabPath = opt("flag-vocab") ??
  (slug === "sephora" ? `${EV}/finetune/warm_sephora/inputs/flag_vocab_sephora.json` : `${EV}/labeling/exports_2026-10-12/flag_vocab_${slug}.json`);
const stagesPath = opt("stages") ?? `${EV}/labeling/g3/stages_${slug}.json`;
const adapter = argv.includes("--clear-adapter") ? null : opt("adapter");
const WRITE = argv.includes("--write");

let url = process.env.DATABASE_URL;
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^DATABASE_URL=(.*)$/);
  if (m && !url) url = m[1].replace(/^"|"$/g, "");
}
const sql = postgres(url!, { ssl: "require", max: 1, prepare: false });
const ro = <T,>(f: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin("read only", f) as Promise<T>;

const project = (await ro((tx) => tx`select id, brand, archived_at, reason_taxonomy, taxonomy_proposal, taxonomy_decision, taxonomy_status from projects where id = ${projectId}`))[0];
if (!project) throw new Error(`no project ${projectId}`);
if (project.archived_at) throw new Error(`project ${projectId} is archived`);
const intents = (await ro((tx) => tx`select id, stage, angle, concern from intents where project_id = ${projectId}`)) as unknown as { id: string; stage: string; angle: string | null; concern: string | null }[];
const prompts = (await ro((tx) => tx`select id, intent_id from prompts where project_id = ${projectId}`)) as unknown as { id: string; intent_id: string | null }[];

const built = buildCoderInputsFromFiles({ slug, brand: project.brand, flagVocabPath, stagesPath, prompts, intents });
const inputs = parseCoderInputs(JSON.stringify(built.inputs));
const book = resolveCodebook({
  reason_taxonomy: typeof project.reason_taxonomy === "string" ? JSON.parse(project.reason_taxonomy) : project.reason_taxonomy,
  taxonomy_proposal: project.taxonomy_proposal, taxonomy_decision: project.taxonomy_decision, taxonomy_status: project.taxonomy_status,
}, inputs);
const ctx: CoderPromptContext = { brand: project.brand, codes: book.codes, defs: book.defs, inputs };
const bySchema: Record<string, number> = {};
let contractless = 0;
for (const i of intents) {
  const r = buildCoderRequest(i, "", "", ctx); // throws on a missing criticism
  if (r) bySchema[r.schema] = (bySchema[r.schema] ?? 0) + 1;
  else contractless++;
}
const mismatch = adapter ? adapterMismatch(adapter) : null;
console.log(`${project.brand} (${projectId})`);
console.log(`  codebook: ${book.codes.length} codes, every scope sentence resolved`);
console.log(`  flag vocab: prices ${JSON.stringify(inputs.flag_vocab.price)}, specs ${JSON.stringify(inputs.flag_vocab.spec)}`);
console.log(`  advocacy criticisms: ${JSON.stringify(inputs.critic)}`);
console.log(`  cells by schema: ${JSON.stringify(bySchema)}${contractless ? `; ${contractless} cell(s) with no contract schema` : ""}`);
if (built.notes.length) console.log(`  notes: ${built.notes.join("; ")}`);
if (adapter !== undefined) console.log(`  reasons adapter -> ${adapter ?? "(cleared: single-pass)"}; waves would write source ${coderSource(adapter ?? null)}`);
if (mismatch) {
  console.error(`REFUSED: ${mismatch}`);
  process.exit(1);
}
if (!WRITE) {
  console.log(`\nDRY RUN - nothing written (coder ${CODER_MODEL}). Re-run with --write to store.`);
  await sql.end();
  process.exit(0);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("REFUSED: --write changes a prod tracker and must be run by hand in a terminal.");
  process.exit(4);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`Write these to prod project ${projectId}? Type the project id to confirm: `);
rl.close();
if (answer.trim() !== projectId) {
  console.log("not confirmed - nothing written");
  process.exit(4);
}
// The same additive columns the app adds on boot (idempotent).
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS coder_inputs TEXT`;
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS reasons_adapter TEXT`;
await sql`UPDATE projects SET coder_inputs = ${JSON.stringify(inputs)} WHERE id = ${projectId}`;
if (adapter !== undefined) await sql`UPDATE projects SET reasons_adapter = ${adapter} WHERE id = ${projectId}`;
console.log("written");
await sql.end();
process.exit(0);
