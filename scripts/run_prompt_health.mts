/**
 * Run the prompt health check on the wave each tracker's dashboard shows -
 * for a coded run still held at "collected", where finalizeRun (the check's
 * normal caller) has not run. Hand-run from the repo root:
 *
 *   npx tsx scripts/run_prompt_health.mts --dry Netflix   # input summary only
 *   npx tsx scripts/run_prompt_health.mts Netflix Sephora # SPENDS
 *
 * A tracker reading coded answers is COUNTED (question_fit.ts): no model
 * call, no spend - a live run only writes the flags and the record.
 * A legacy tracker SPENDS: one gpt-6-luna call per tracker (PROMPT_HEALTH_MODEL, about two
 * cents a tracker), writes the prompts' flags and the "check ran" record
 * (llm_cache prompt_health:ph2:<run>). Needs Tyler's per-run go, like all API
 * spend. With no brand argument it does nothing - name the trackers.
 *
 * --dry builds the exact input the model would see and prints a summary: how
 * many questions are sent, and the questions with the
 * highest out-of-category share. No model call, no writes.
 *
 * Env: .env.local fills only variables not already set, so a fixture run
 * blanks DATABASE_URL and the keys on the command line, e.g.
 *   DATABASE_URL= OPENAI_API_KEY= SQLITE_PATH=<copy of the fixture> \
 *     npx tsx scripts/run_prompt_health.mts --dry Jira
 * Only un-archived trackers are read.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.RUN_COLLECT_ONLY = "1"; // belt and braces: this script codes nothing

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const top = Number(args.find((a) => a.startsWith("--top="))?.slice(6) ?? 10);
const filters = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());
if (filters.length === 0) {
  console.error("Name the trackers to check (brand substrings). Add --dry for the input only.");
  process.exit(1);
}

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { analyzePromptHealth, dashboardRun } = await import(process.cwd() + "/src/lib/engine/prompt_health.ts");
type Item = { id: string; prompt: string; answers: number; recalled_brands: { brand: string; answers: number; status?: string }[] };

console.log(`store: ${process.env.DATABASE_URL ? "POSTGRES (prod)" : `sqlite ${process.env.SQLITE_PATH ?? "(default)"}`} · ${dry ? "DRY - no model call, no writes" : "LIVE - spends and writes"}`);

const projects = (await store.listProjects()).filter(
  (p: { brand: string; archived_at?: string | null }) =>
    !p.archived_at && filters.some((f) => p.brand.toLowerCase().includes(f))
);
for (const project of projects) {
  const run = await dashboardRun(project.id);
  if (!run) {
    console.log(`\n${project.brand}: no measured run - skipped`);
    continue;
  }
  const res = await analyzePromptHealth(project.id, run.id, { dry });
  console.log(`\n${project.brand} (run ${String(run.id).slice(0, 8)}, ${run.status})`);
  if (res.fit) {
    // Coded tracker: counted, no model call (question_fit.ts).
    const fit = res.fit;
    const prompts = await store.listPrompts(project.id);
    const intents = await store.listIntents(project.id);
    const textOf = new Map(prompts.map((p: { id: string; text: string }) => [p.id, p.text]));
    const seedOf = new Map(intents.map((i: { id: string; text: string; stage: string }) => [i.id, `[${i.stage}] ${i.text}`]));
    console.log(`  ${dry ? "would flag" : res.ran ? "flagged" : `did not run (${res.reason}):`} ${fit.cells.length} questions and ${fit.wordings.length} of ${fit.checked.length} wordings (${fit.unjudged} not judged)`);
    for (const c of fit.cells) console.log(`    QUESTION ${String(seedOf.get(c.intent)).slice(0, 110)}\n        ${c.reason}`);
    for (const w of fit.wordings) console.log(`    WORDING  ${String(textOf.get(w.prompt)).slice(0, 110)}\n        ${w.reason}`);
    if (!dry && !res.ran) process.exitCode = 1;
    continue;
  }
  if (!dry) {
    console.log(res.ran ? `  checked: ${res.flagged} of ${res.sent} questions flagged` : `  did not run: ${res.reason}`);
    if (!res.ran) process.exitCode = 1;
    continue;
  }
  const input = res.input!;
  console.log(`  input from ${input.mode}: ${input.items.length} questions sent, ${input.skipped} left out by the rule`);
  console.log(`  user message ${JSON.stringify(input.items).length.toLocaleString("en-US")} chars`);
  // Out-of-category share: answers naming at least one non-in-category brand
  // cannot be recovered from per-brand counts, so the summary uses the
  // per-brand weight - the largest non-in-category brand's share of answers,
  // and the summed non-in-category mentions over all mentions.
  const rows = input.items.map((it: Item) => {
    const out = it.recalled_brands.filter((b) => b.status !== "in_category");
    const all = it.recalled_brands.reduce((n, b) => n + b.answers, 0);
    const outN = out.reduce((n, b) => n + b.answers, 0);
    return { it, share: all > 0 ? outN / all : 0, out, all };
  });
  rows.sort((a: { share: number; all: number }, b: { share: number; all: number }) => b.share - a.share || b.all - a.all);
  console.log(`  top ${top} by out-of-category share of recalled mentions:`);
  for (const r of rows.slice(0, top)) {
    const names = r.out.slice(0, 5).map((b: { brand: string; answers: number; status?: string }) => `${b.brand} ${b.answers}${b.status === "not_competitor" ? "" : "?"}`).join(", ");
    console.log(`   ${(r.share * 100).toFixed(0).padStart(3)}% (${r.it.answers} ans) ${r.it.prompt.slice(0, 90)}`);
    console.log(`        ${names || "-"}`);
  }
}
process.exit(process.exitCode ?? 0);
