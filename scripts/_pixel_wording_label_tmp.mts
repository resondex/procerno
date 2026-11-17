// One-off (2026-11-12): Opus reference labels for the 13 answers to the Pixel replacement wording.
// Request = the stored v2 criteria request for this cell, with only the question and answer swapped.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.RUN_COLLECT_ONLY = "1";
const PROJECT = "87ccf81c-5b0e-4765-a969-19b9c4dc4d5d";
const OLD = "3e68b42b-bd32-4fd0-85e1-402b1ee0dc15";
const T = `${process.env.HOME}/Documents/procerno_eval/labeling/v2_build/training`;
const OUT = `${process.env.HOME}/Documents/procerno_eval/labeling/v2_build/pixel_wording_fix_2026-11-12`;
fs.mkdirSync(OUT, { recursive: true });
const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { dashboardRun } = await import(process.cwd() + "/src/lib/engine/prompt_health.ts");
const { purgeRunRevision } = await import(process.cwd() + "/src/lib/engine/run_revision.ts");
const project = await store.getProject(PROJECT);
const run = await dashboardRun(PROJECT);
const staged = (await store.listStagedPrompts(PROJECT)).find((p: any) => p.replaces === OLD);
const meta = await store.listResponseMetaForPrompts(run.id, [staged.id]);
const texts = new Map((await store.getResponseTexts(meta.map((r: any) => r.id))).map((t: any) => [t.id, t.text]));
const manifest = fs.readFileSync(`${T}/google_pixel_v2_all.manifest.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const tid = manifest.find((x) => x.prompt_id === OLD).id;
let tpl: any;
for (const l of fs.readFileSync(`${T}/google_pixel_v2_all.jsonl`, "utf8").split("\n")) if (l.includes(tid)) { const d = JSON.parse(l); if (d.custom_id === tid) tpl = d.params; }
const content: string = tpl.messages[0].content;
const cut = content.indexOf("Question: ");
if (cut < 0) throw new Error("template");
const prefix = content.slice(0, cut);
const allowed = new Set(project.reason_taxonomy as string[]);
const client = new Anthropic();
const rows: any[] = []; let cost = 0;
const lower = (s: string) => s.toLowerCase();
for (const r of meta) {
  const text = texts.get(r.id)!;
  const msg = await client.messages.create({ ...tpl, messages: [{ role: "user", content: `${prefix}Question: ${staged.text}\n\nAnswer:\n${text}` }] });
  const u = msg.usage as any;
  cost += (u.input_tokens * 5 + (u.cache_creation_input_tokens ?? 0) * 6.25 + (u.cache_read_input_tokens ?? 0) * 0.5 + u.output_tokens * 25) / 1e6;
  const out = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  fs.appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ id: r.id, model: r.model, ...j }) + "\n");
  const off = (j.reasons ?? []).filter((c: string) => !allowed.has(c));
  if (off.length) throw new Error(`off-list ${off}`);
  const pos = (j.mentions ?? []).map((m: any, i: number) => ({ m, i, at: lower(text).indexOf(lower(m.brand)) }));
  pos.sort((a: any, b: any) => (a.at < 0 ? 1e9 + a.i : a.at) - (b.at < 0 ? 1e9 + b.i : b.at));
  rows.push({
    response_id: r.id, source: "ref:opus-5-5", run_id: run.id, project_id: PROJECT, contract: "v2_2026-10-22", schema: "criteria",
    outcome: null, top_pick: null, tier_stance: null, worth_it: null, proceed_or_avoid: null, keep_or_leave: null, premise_verdict: null,
    category_routed: null, relationship_verdict: null, case_strength: null, growth_stance: null,
    clarification_requested: j.clarification_requested, includes_prices: j.includes_prices, includes_specs: j.includes_specs,
    quote: j.quote ?? null, premise_quote: null, reasons: j.reasons ?? [], topics: null, uncoded: j.uncoded_reason ?? "",
    destinations: null, redirect_to: null, pairings: null,
    mentions: pos.map((p: any, k: number) => ({ brand: p.m.brand, framing: p.m.framing, rank: k + 1 })), decision_rules: null,
  });
  console.log(r.model, (j.reasons ?? []).length, "codes", (j.mentions ?? []).length, "mentions");
}
if (process.argv.includes("--write")) { await store.upsertAnswerCodes(rows); await purgeRunRevision(run.id); console.log("written", rows.length); }
fs.writeFileSync(`${OUT}/cost.json`, JSON.stringify({ usd: cost, rows: rows.length }));
console.log("cost", cost.toFixed(3));
process.exit(0);
