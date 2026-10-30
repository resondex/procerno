/**
 * Prompt proof for the Fireworks coder integration (2026-10-29) - the gate
 * the production prompt builder must pass. ZERO SPEND: no model is called,
 * no prod row is written.
 *
 *   npx tsx scripts/coder_prompt_proof.mts [--sample N]
 *
 * For each of the six trackers the coder was trained or evaluated on, it
 * assembles the coder request the app would send - from PROD config read
 * through per-query read-only transactions (projects.brand,
 * reason_taxonomy, taxonomy_proposal, taxonomy_decision, intents, prompts)
 * plus the tracker's coder inputs built by the same code
 * scripts/coder_inputs.mts stores (frozen flag vocabulary + stages-file
 * critic line), and the answer text from the response vault - and diffs
 * system and user BYTE FOR BYTE against the stored request bodies:
 *
 *   trained five  every v2 label request (labeling/v2_build/training, with
 *                 the drc3 recode system swapped in on choice + premium as
 *                 finetune/ft_eval_v02.mts does) and every Set C request
 *                 (labeling/g3/setc user + the tracker's rules-bearing
 *                 labeling/v04_dr/setc_recode system)
 *   Sephora       the 400 ratified-book requests
 *                 (finetune/warm_sephora/requests_sephora_ratified.jsonl) the
 *                 seph-sd2 reasons adapter was built from
 *
 * Every row is compared (--sample N limits to N per tracker x schema). Any
 * difference is a FAIL (exit 1). It also reports how many rebuilt prompts
 * appear verbatim in the models' actual inputs (train_v04 + val_v04 +
 * eval_holdout_v04 + anchors_v04 for the trained five; seph-sd2's train_prod for Sephora) -
 * informational: some label rows never entered a training file.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import readline from "node:readline";
import { buildCoderRequest, resolveCodebook, parseCoderInputs, type CoderPromptContext, type CoderCell } from "../src/lib/engine/coder_prompts";
import { buildCoderInputsFromFiles } from "./lib/coder_inputs_files.mts";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EV = `${process.env.HOME}/Documents/procerno_eval`;
const VAULT = `${process.env.HOME}/Documents/procerno_response_vault`;
const sampleArg = process.argv.indexOf("--sample");
const SAMPLE = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : Infinity;

let url = process.env.DATABASE_URL;
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^DATABASE_URL=(.*)$/);
  if (m && !url) url = m[1].replace(/^"|"$/g, "");
}
if (!url) throw new Error("no DATABASE_URL");
const sql = postgres(url, { ssl: "require", max: 1, prepare: false });
// Per-query read-only TRANSACTION (never a session SET - the pooler incident).
const ro = <T,>(f: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin("read only", f) as Promise<T>;

const TRACKERS = [
  { slug: "american_express", run: "00dab505", trained: true },
  { slug: "jira", run: "182ef571", trained: true },
  { slug: "google_pixel", run: "ce6df829", trained: true },
  { slug: "netflix", run: "1948d2ed", trained: true },
  { slug: "doritos", run: "2a0ff686", trained: true },
  { slug: "sephora", run: "bd11a221", trained: false },
];
const flagVocabPath = (slug: string) =>
  slug === "sephora" ? `${EV}/finetune/warm_sephora/inputs/flag_vocab_sephora.json` : `${EV}/labeling/exports_2026-10-12/flag_vocab_${slug}.json`;

const jl = (p: string) => fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const pairKey = (s: string, u: string) => sha(s + "\u0000" + u);

/** sha(system \0 user) of every line of the given chat-format training files. */
async function modelInputs(files: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.log(`  (model-input file missing, skipped: ${path.relative(EV, f)})`);
      continue;
    }
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const d = JSON.parse(line) as { messages: { role: string; content: string }[] };
      const s = d.messages.find((m) => m.role === "system")?.content ?? "";
      const u = d.messages.find((m) => m.role === "user")?.content ?? "";
      out.add(pairKey(s, u));
    }
  }
  return out;
}

type Target = { id: string; system: string; user: string; source: string };
function targetsFor(slug: string): Target[] {
  const out: Target[] = [];
  if (slug === "sephora") {
    for (const r of jl(`${EV}/finetune/warm_sephora/requests_sephora_ratified.jsonl`)) {
      out.push({ id: r.custom_id, system: r.params.system[0].text, user: r.params.messages[0].content, source: "sephora_ratified" });
    }
    return out;
  }
  const reqs = jl(`${EV}/labeling/v2_build/training/${slug}_v2_all.jsonl`);
  const man = jl(`${EV}/labeling/v2_build/training/${slug}_v2_all.manifest.jsonl`);
  const drf = new Map(jl(`${EV}/labeling/v04_dr/recode/requests_${slug}_drf.jsonl`).map((r) => [String(r.custom_id).replace(/^drf_/, ""), r]));
  reqs.forEach((r, i) => {
    const m = man[i];
    if (m.id !== r.custom_id) throw new Error(`${slug}: v2 manifest order differs at ${i}`);
    let system = r.params.system[0].text as string;
    if (m.schema === "choice" || m.schema === "premium") {
      const d = drf.get(m.id);
      if (!d || d.params.messages[0].content !== r.params.messages[0].content) throw new Error(`${slug}: ${m.id} drc3 request missing or user differs`);
      system = d.params.system[0].text;
    }
    out.push({ id: m.id, system, user: r.params.messages[0].content, source: "v2+drc3" });
  });
  const drs = jl(`${EV}/labeling/v04_dr/setc_recode/requests_${slug}_drs.jsonl`);
  const systems = new Set(drs.map((r) => r.params.system[0].text as string));
  if (systems.size !== 1) throw new Error(`${slug}: ${systems.size} drs systems`);
  const rulesSystem = [...systems][0];
  const drsUser = new Map(drs.map((r) => [String(r.custom_id).replace(/^drs_/, ""), r.params.messages[0].content as string]));
  for (const r of jl(`${EV}/labeling/g3/setc/requests_${slug}_setc.jsonl`)) {
    const u = r.params.messages[0].content as string;
    const du = drsUser.get(r.custom_id);
    if (du !== undefined && du !== u) throw new Error(`${slug}: ${r.custom_id} drs user differs from the settled request`);
    out.push({ id: r.custom_id, system: rulesSystem, user: u, source: "setc+drs" });
  }
  return out;
}

/** First differing position, with context. */
function where(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 60));
  return `at char ${i} (lengths ${a.length} vs ${b.length})\n      built : ${ctx(a)}\n      stored: ${ctx(b)}`;
}

console.log("loading the models' input files (train_v04 + val_v04 + eval_holdout_v04 + anchors_v04; seph-sd2 train_prod) ...");
const trainedInputs = await modelInputs([
  `${EV}/finetune/train_v04.jsonl`, `${EV}/finetune/val_v04.jsonl`, `${EV}/finetune/eval_holdout_v04.jsonl`, `${EV}/finetune/anchors_v04.jsonl`,
]);
const sephInputs = await modelInputs([`${EV}/finetune/warm_sephora/sd2/train_prod.jsonl`]);

let failures = 0;
const table: string[] = [];
for (const t of TRACKERS) {
  const run = (await ro((tx) => tx`select id, project_id from runs where id::text like ${t.run + "%"}`))[0];
  if (!run) throw new Error(`${t.slug}: run ${t.run} not in prod`);
  const project = (await ro((tx) => tx`select id, brand, reason_taxonomy, taxonomy_proposal, taxonomy_decision, taxonomy_status, archived_at from projects where id = ${run.project_id}`))[0];
  if (project.archived_at) throw new Error(`${t.slug}: project ${project.id} is archived`);
  const intents = (await ro((tx) => tx`select id, stage, angle, concern from intents where project_id = ${project.id}`)) as unknown as (CoderCell & { id: string })[];
  const prompts = (await ro((tx) => tx`select id, text, intent_id from prompts where project_id = ${project.id}`)) as unknown as { id: string; text: string; intent_id: string | null }[];
  const brand = project.brand as string;

  const built = buildCoderInputsFromFiles({
    slug: t.slug, brand, flagVocabPath: flagVocabPath(t.slug), stagesPath: `${EV}/labeling/g3/stages_${t.slug}.json`, prompts, intents,
  });
  // Round-trip through the stored form, exactly as the wave reads it.
  const inputs = parseCoderInputs(JSON.stringify(built.inputs));
  const book = resolveCodebook({
    reason_taxonomy: typeof project.reason_taxonomy === "string" ? JSON.parse(project.reason_taxonomy) : project.reason_taxonomy,
    taxonomy_proposal: project.taxonomy_proposal, taxonomy_decision: project.taxonomy_decision, taxonomy_status: project.taxonomy_status,
  }, inputs);
  const ctx: CoderPromptContext = { brand, codes: book.codes, defs: book.defs, inputs };

  const vf = fs.readdirSync(VAULT).filter((f) => f.startsWith(`${t.slug}_${t.run}_`) && f.endsWith(".jsonl.gz"));
  if (vf.length !== 1) throw new Error(`${t.slug}: expected one vault file, found ${vf.length}`);
  const vault = zlib.gunzipSync(fs.readFileSync(path.join(VAULT, vf[0]))).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const meta = vault.find((r) => r.kind === "run_meta");
  const answers = new Map<string, { prompt_id: string; text: string }>(
    vault.filter((r) => r.kind !== "run_meta").map((r) => [r.id, { prompt_id: r.prompt_id, text: r.text }])
  );
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  const intentById = new Map(intents.map((i) => [i.id, i]));
  // The app reads prompt text from prod; the stored requests read the vault's
  // copy. They must agree for every prompt the vault carries.
  let promptDrift = 0;
  for (const vp of meta?.prompts ?? []) if (promptById.get(vp.id)?.text !== vp.text) promptDrift++;

  const targets = targetsFor(t.slug);
  const perSchema = new Map<string, { n: number; same: number; inModel: number }>();
  let shown = 0;
  for (const tg of targets) {
    const a = answers.get(tg.id);
    if (!a) {
      failures++;
      if (shown++ < 5) console.log(`  FAIL ${t.slug} ${tg.id}: stored request has no vault answer`);
      continue;
    }
    const p = promptById.get(a.prompt_id);
    const cell = p?.intent_id ? intentById.get(p.intent_id) : undefined;
    const req = buildCoderRequest(cell ?? null, p?.text ?? "", a.text, ctx);
    if (!req) {
      failures++;
      if (shown++ < 5) console.log(`  FAIL ${t.slug} ${tg.id}: no contract schema (cell ${cell?.stage ?? "none"})`);
      continue;
    }
    const e = perSchema.get(req.schema) ?? perSchema.set(req.schema, { n: 0, same: 0, inModel: 0 }).get(req.schema)!;
    if (e.n >= SAMPLE) continue;
    e.n++;
    const ok = req.system === tg.system && req.user === tg.user;
    if (ok) e.same++;
    else {
      failures++;
      if (shown++ < 8) {
        console.log(`  DIFF ${t.slug} ${tg.id} (${req.schema}, ${tg.source}):`);
        if (req.system !== tg.system) console.log(`    system ${where(req.system, tg.system)}`);
        if (req.user !== tg.user) console.log(`    user ${where(req.user, tg.user)}`);
      }
    }
    if ((t.trained ? trainedInputs : sephInputs).has(pairKey(req.system, req.user))) e.inModel++;
  }
  const schemas = [...perSchema.entries()].sort((x, y) => y[1].n - x[1].n);
  const total = schemas.reduce((s, [, e]) => s + e.n, 0);
  const same = schemas.reduce((s, [, e]) => s + e.same, 0);
  const inModel = schemas.reduce((s, [, e]) => s + e.inModel, 0);
  table.push(
    `${t.slug.padEnd(17)} ${brand.padEnd(17)} codes ${String(book.codes.length).padStart(2)}  critic cells ${Object.keys(inputs.critic).length}  prompt-text drift ${promptDrift}` +
    `\n  compared ${total}  identical ${same}  in the model's inputs ${inModel}${built.notes.length ? `\n  notes: ${built.notes.join("; ")}` : ""}` +
    `\n  ` + schemas.map(([k, e]) => `${k} ${e.same}/${e.n} (model ${e.inModel})`).join(", ")
  );
  if (promptDrift) failures++;
}
await sql.end();
console.log("\n" + table.join("\n"));
if (failures) {
  console.error(`\nPROOF FAILED: ${failures} problem(s)`);
  process.exit(1);
}
console.log("\nPROOF PASSED: every compared request is byte-identical to its stored body");
process.exit(0);
