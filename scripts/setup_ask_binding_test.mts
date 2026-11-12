/**
 * One-off measurement (2026-11-11, spend-authorized, cap $2): could one added
 * criteria structure property have caught the Pixel teen-phone wording whose
 * first ask bound to the circumstance ("rules") instead of the product?
 *
 * Replicates checkStructure's request byte-for-byte in shape (same system
 * text, model, effort, tool schema, user layout, max_tokens) with the cell's
 * criteria properties PLUS one candidate property, no llm_cache. Reads the
 * local fixture only (data/dashboard_fixture.db, read-only); zero prod
 * contact. Usage:
 *   DATABASE_URL= SQLITE_PATH=<scratch.db> npx tsx scripts/setup_ask_binding_test.mts
 */
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { stageStructure, STRUCTURE_CHECK_SYSTEM, STRUCTURE_CHECK_MODEL, STRUCTURE_CHECK_EFFORT } from "../src/lib/engine/stage_structure";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(os.homedir(), "Documents/procerno_eval/setup_ask_binding_2026-11-11");
fs.mkdirSync(OUT, { recursive: true });
const CAP = 1.9;
const RUNS = 3;

const ORIGINAL = "Some rules will come with my teen's first phone. What should I look for to start, and what should I consider afterward?";
const MISREAD_ID = "3e68b42b";

const CANDIDATES: Record<string, string> = {
  A: "Keeps the product being chosen as what the first ask is about: read on its own by someone who has not seen the seed, it fails only if its first ask could plainly be taken as asking what to look at about something else its circumstance mentions, rather than about the product being chosen.",
  B: "Both asks are about the product being chosen: the thing to look at, and the thing to consider, is the product.",
};

// Mirror of the module's private STRUCTURE_SCHEMA.
const STRUCTURE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { verdicts: { type: "array", items: { type: "object", additionalProperties: false, properties: {
    index: { type: "integer", description: "The paraphrase's number as given." },
    fails: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      property: { type: "integer", description: "The failed property's number." },
      reason: { type: "string", description: "One short sentence." },
      clear: { type: "boolean", description: "true only when the property is clearly failed; false for a borderline or arguable call." },
    }, required: ["property", "reason", "clear"] } },
  }, required: ["index", "fails"] } } },
  required: ["verdicts"],
};

const db = new Database(path.join(REPO, "data/dashboard_fixture.db"), { readonly: true, fileMustExist: true });
type Cell = { id: string; brand: string; situation: string | null; angle: string | null; seed: string; wordings: { id: string; text: string; n: number; argued: number }[] };
const intents = db.prepare(`select i.id, i.situation, i.angle, i.text seed, p.brand from intents i join projects p on p.id=i.project_id where i.stage='criteria' order by p.brand, i.id`).all() as { id: string; situation: string | null; angle: string | null; seed: string; brand: string }[];
const wq = db.prepare(`select pr.id, pr.text,
  (select count(*) from responses r join answer_codes ac on ac.response_id=r.id where r.prompt_id=pr.id) n,
  (select count(*) from responses r join answer_codes ac on ac.response_id=r.id where r.prompt_id=pr.id and ((ac.reasons is not null and ac.reasons not in ('[]','')) or (ac.topics is not null and ac.topics not in ('[]','')))) argued
  from prompts pr where pr.intent_id=? order by pr.id`);
const cells: Cell[] = intents.map((i) => ({ ...i, wordings: wq.all(i.id) as Cell["wordings"] }));
const misreadCell = cells.find((c) => c.wordings.some((w) => w.id.startsWith(MISREAD_ID)))!;
const rewritten = misreadCell.wordings.find((w) => w.id.startsWith(MISREAD_ID))!.text;

const anthropic = new Anthropic({ timeout: 180_000, maxRetries: 2 });
let spend = 0;
let inTok = 0, outTok = 0, calls = 0;

type Job = { cellId: string; brand: string; variant: "main" | "rewritten"; texts: { id: string; text: string }[]; seed: string; situation: string | null; angle: string | null };
function jobsFor(variant: "main" | "rewritten"): Job[] {
  const list = variant === "main" ? cells : [misreadCell];
  return list.map((c) => ({
    cellId: c.id, brand: c.brand, variant, seed: c.seed, situation: c.situation, angle: c.angle,
    // Production checks paraphrases, never the seed itself.
    texts: c.wordings.filter((w) => w.text.trim() !== c.seed.trim()).map((w) => ({
      id: w.id,
      text: w.id.startsWith(MISREAD_ID) ? (variant === "main" ? ORIGINAL : rewritten) : w.text,
    })),
  }));
}

async function runJob(job: Job, cand: string) {
  const s = stageStructure({ stage: "criteria", angle: job.angle ?? "generic", situation: job.situation }, job.brand)!;
  const props = [...s.properties, CANDIDATES[cand]];
  const user =
    `Stage shape: ${s.shape}\nSeed: ${job.seed}\n\nProperties every paraphrase must satisfy:\n` +
    props.map((p, i) => `${i + 1}. ${p}`).join("\n") +
    `\n\nParaphrases:\n` + job.texts.map((t, i) => `${i + 1}. ${t.text}`).join("\n");
  if (spend > CAP) throw new Error(`spend cap reached at $${spend.toFixed(3)}`);
  const res = await anthropic.messages.create({
    model: STRUCTURE_CHECK_MODEL,
    max_tokens: 3000,
    ...(STRUCTURE_CHECK_EFFORT === "default" ? {} : { output_config: { effort: STRUCTURE_CHECK_EFFORT } }),
    system: STRUCTURE_CHECK_SYSTEM,
    tools: [{ name: "structure_verdict", description: "Return each paraphrase's failed properties.", input_schema: STRUCTURE_SCHEMA as never }],
    tool_choice: { type: "tool", name: "structure_verdict" },
    messages: [{ role: "user", content: user }],
  } as never) as unknown as { content: { type: string; input?: unknown }[]; usage: { input_tokens: number; output_tokens: number } };
  calls++; inTok += res.usage.input_tokens; outTok += res.usage.output_tokens;
  spend += (res.usage.input_tokens * 2 + res.usage.output_tokens * 10) / 1e6;
  const tool = res.content.find((b) => b.type === "tool_use");
  let raw = tool?.input as Record<string, unknown> | string | undefined;
  if (typeof raw === "string") raw = JSON.parse(raw);
  let verdicts = (raw as Record<string, unknown>)?.verdicts as unknown;
  if (typeof verdicts === "string") verdicts = JSON.parse(verdicts);
  const fails: { property: number; reason: string; clear: boolean }[][] = job.texts.map(() => []);
  for (const v of (verdicts as Record<string, unknown>[]) ?? []) {
    const idx = Number(v.index) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= job.texts.length) continue;
    let fs_ = v.fails as unknown; if (typeof fs_ === "string") fs_ = JSON.parse(fs_);
    for (const f of (fs_ as Record<string, unknown>[]) ?? []) fails[idx].push({ property: Number(f.property), reason: String(f.reason ?? ""), clear: f.clear !== false });
  }
  return { cellId: job.cellId, brand: job.brand, variant: job.variant, candidate: cand, newProperty: props.length,
    items: job.texts.map((t, i) => ({ id: t.id, text: t.text, fails: fails[i] })), usage: res.usage };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let k = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i]); } }));
  return out;
}

const all: unknown[] = [];
for (let run = 1; run <= RUNS; run++) {
  for (const cand of Object.keys(CANDIDATES)) {
    const jobs = [...jobsFor("main"), ...jobsFor("rewritten")];
    const res = await pool(jobs, 6, (j) => runJob(j, cand));
    const tagged = res.map((r) => ({ run, ...r }));
    all.push(...tagged);
    fs.writeFileSync(path.join(OUT, `raw_${cand}_run${run}.json`), JSON.stringify(tagged, null, 1));
    console.log(`run ${run} cand ${cand}: calls ${calls}, spend $${spend.toFixed(3)}`);
  }
}

// Ground truth for every wording (incl. seed).
const truth = cells.flatMap((c) => c.wordings.map((w) => ({ cellId: c.id, brand: c.brand, situation: c.situation, isSeed: w.text.trim() === c.seed.trim(), id: w.id, text: w.id.startsWith(MISREAD_ID) ? ORIGINAL : w.text, n: w.n, argued: w.argued })));
fs.writeFileSync(path.join(OUT, "ground_truth.json"), JSON.stringify(truth, null, 1));
fs.writeFileSync(path.join(OUT, "spend.json"), JSON.stringify({ calls, inTok, outTok, usd: spend, model: STRUCTURE_CHECK_MODEL, effort: STRUCTURE_CHECK_EFFORT, candidates: CANDIDATES }, null, 1));
console.log(`done: ${calls} calls, ${inTok} in / ${outTok} out, $${spend.toFixed(3)}`);
