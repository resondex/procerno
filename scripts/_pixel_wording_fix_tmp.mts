// One-off (2026-11-12, Tyler's go): fix the Pixel teen-phone criteria wording's data.
import fs from "node:fs";
import postgres from "postgres";
for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const step = process.argv[2];
const PROJECT = "87ccf81c-5b0e-4765-a969-19b9c4dc4d5d";
const PROMPT = "3e68b42b-bd32-4fd0-85e1-402b1ee0dc15";
const ORIGINAL = "Some rules will come with my teen's first phone. What should I look for to start, and what should I consider afterward?";
const REWRITE = "Some rules will come with my teen's first phone. What should I look for in the phone to start, and what should I consider afterward?";
if (step !== "code") process.env.RUN_COLLECT_ONLY = "1";
else delete process.env.RUN_COLLECT_ONLY;

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { analyzePromptHealth, dashboardRun } = await import(process.cwd() + "/src/lib/engine/prompt_health.ts");
const wr = await import(process.cwd() + "/src/lib/engine/wording_review.ts");
const { purgeRunRevision } = await import(process.cwd() + "/src/lib/engine/run_revision.ts");
const project = await store.getProject(PROJECT);
if (!project || project.archived_at) throw new Error("project");
const run = await dashboardRun(PROJECT);
console.log("run", run.id, run.status, "models", run.models.length);
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1, prepare: false });

if (step === "check") {
  const [p] = await sql`SELECT text FROM prompts WHERE id = ${PROMPT}`;
  console.log("current text:", p.text);
  if (p.text === REWRITE) { await sql`UPDATE prompts SET text = ${ORIGINAL} WHERE id = ${PROMPT}`; console.log("restored original text"); }
  await purgeRunRevision(run.id);
  const res = await analyzePromptHealth(PROJECT, run.id);
  console.log(JSON.stringify(res, null, 1).slice(0, 1500));
  console.log("flagged prompts:", await sql`SELECT id, left(text,70) t, flag_reason FROM prompts WHERE project_id=${PROJECT} AND flagged=1`);
  console.log("log:", (await store.listPromptFlags({ projectId: PROJECT })).map((f: any) => [f.id, f.status, f.prompt_text.slice(0, 60), f.rate, f.siblings_rate]));
}
const flag = (await store.listPromptFlags({ projectId: PROJECT, runId: run.id })).find((f: any) => f.prompt_id === PROMPT);
async function staged() {
  let s = (await store.listStagedPrompts(PROJECT)).find((p: any) => p.replaces === PROMPT);
  if (!s) {
    const old = (await store.listPrompts(PROJECT)).find((p: any) => p.id === PROMPT);
    s = await store.insertStagedPrompt(PROJECT, { text: REWRITE, theme: old.theme, intentId: old.intent_id, asker: old.asker, replaces: PROMPT });
    await store.updatePromptFlag(flag.id, { staged_prompt_id: s.id, suggested_text: REWRITE, suggestion_meta: JSON.stringify({ by: "owner rewrite 2026-10-29" }) });
  }
  return s;
}
if (step === "collect") {
  const s = await staged();
  console.log("staged", s.id, await wr.collectStaged(run, s, Date.now() + 240_000));
  const meta = await store.listResponseMetaForPrompts(run.id, [s.id]);
  console.log(meta.map((r: any) => [r.model, r.finish_reason, r.search_count, r.output_tokens]));
}
if (step === "code") {
  const s = await staged();
  console.log(await wr.codeStaged(project, run, s, Date.now() + 280_000));
}
if (step === "ready") console.log(await wr.stagedReady(project, run, flag), flag);
if (step === "swap") {
  const s = await staged();
  console.log("ready", await wr.stagedReady(project, run, flag));
  await store.acceptStagedPrompt({ stagedId: s.id, oldId: PROMPT, flagId: flag.id, resolvedText: s.text });
  await purgeRunRevision(run.id);
  const res = await analyzePromptHealth(PROJECT, run.id);
  console.log("recheck flagged:", await sql`SELECT id FROM prompts WHERE project_id=${PROJECT} AND flagged=1`);
  console.log("prompts:", await sql`SELECT id, left(text,60) t, retired, staged, replaced_by FROM prompts WHERE id IN (${PROMPT}, ${s.id})`);
  console.log("log:", (await store.listPromptFlags({ projectId: PROJECT })).map((f: any) => [f.status, f.resolved_text?.slice(0, 70)]));
  console.log("answers visible:", await store.countResponses(run.id), "ref codes:", await store.countAnswerCodes(run.id, "ref:opus-5-5"));
}
await sql.end();
process.exit(0);
