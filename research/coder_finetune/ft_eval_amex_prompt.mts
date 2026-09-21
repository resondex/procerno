/**
 * Prompt-variant test for the jira-trained coder on American Express.
 *
 * Targets the two measured failure modes from the baseline transfer run:
 *   - reward-family collapse (89% of 'rewards rate' false positives sat on
 *     rows whose truth used a more specific reward code)  -> VARIANT defs
 *   - emitting ~1 code per row too few at every complexity -> VARIANT count
 *
 * Everything else (system preamble, question/answer layout, temperature 0)
 * is byte-identical to the baseline so the comparison is paired.
 *
 * Usage: VARIANT=defs|count|both npx tsx ft_eval_amex_prompt.mts <model-id> <out.jsonl>
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const MODEL = process.argv[2];
const VARIANT = process.env.VARIANT ?? "defs";
if (!MODEL || !["defs", "count", "both"].includes(VARIANT)) {
  console.error("usage: VARIANT=defs|count|both tsx ft_eval_amex_prompt.mts <model-id> [out.jsonl]");
  process.exit(1);
}
const REPO = "/Users/tylersolloway/Documents/GitHub/procerno";
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const HOME = process.env.HOME!;
const F = `${HOME}/Documents/procerno_eval/finetune`;
const tax = JSON.parse(fs.readFileSync(`${HOME}/Documents/procerno_eval/amex/amex_taxonomy.json`, "utf8"));
const defs = JSON.parse(fs.readFileSync(`${F}/amex_code_defs.json`, "utf8")) as Record<string, string>;
const sample = new Set<string>(JSON.parse(fs.readFileSync(`${F}/amex_prompt_sample.json`, "utf8")));
const OUT = process.argv[3] ?? `${F}/ft_amex_${VARIANT}.jsonl`;

const BASE_SYSTEM =
  "You code one AI assistant answer for a brand-visibility study. Be literal: code only " +
  "what the text says. Reply with ONLY a JSON object: " +
  '{"outcome": "pick"|"conditional"|"no_pick"|"clarification", ' +
  '"top_pick": <brand or null - only when outcome is pick, exactly as the answer writes it>, ' +
  '"target_framing": "recommended"|"mentioned"|"negative"|"absent" - how the answer treats the target brand, ' +
  '"reasons": [codes the answer argues FROM, drawn only from the allowed list]}';

const COUNT_RULE =
  " List EVERY attribute the answer argues from, not only the primary one - most answers " +
  "argue from two or three. Include a code for each distinct attribute that carries a " +
  "justification, and leave reasons empty only when the answer argues from none.";

const SYSTEM = VARIANT === "count" || VARIANT === "both" ? BASE_SYSTEM + COUNT_RULE : BASE_SYSTEM;

const codeBlock =
  VARIANT === "defs" || VARIANT === "both"
    ? "Allowed reason codes - use the most specific code that applies:\n" +
      tax.reason_taxonomy.map((c: string) => `- ${c}: ${defs[c]}`).join("\n")
    : `Allowed reason codes: ${tax.reason_taxonomy.join(", ")}`;

const rows = zlib
  .gunzipSync(fs.readFileSync(`${HOME}/Documents/procerno_response_vault/american_express_34d46b95_5390rows_2026-09-19T0840.jsonl.gz`))
  .toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
const prompts: Record<string, string> = {};
for (const p of rows[0].prompts) prompts[p.id] = p.text;
const answers = (rows.slice(1) as { id: string; prompt_id: string; model: string; text: string }[])
  .filter((r) => sample.has(r.id));

const done = new Set<string>();
if (fs.existsSync(OUT)) {
  for (const l of fs.readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean)) done.add(JSON.parse(l).responseId);
}
const todo = answers.filter((r) => !done.has(r.id));
console.log(`variant ${VARIANT}: sample ${answers.length}, done ${done.size}, todo ${todo.length}`);

let cursor = 0, ok = 0, failed = 0, inTok = 0, outTok = 0;
const outStream = fs.createWriteStream(OUT, { flags: "a" });
async function callOnce(r: (typeof todo)[number]) {
  const user =
    `Question: ${prompts[r.prompt_id] ?? ""}\n\nAnswer:\n${r.text}\n\n` +
    `Target brand: ${tax.brand}\n${codeBlock}`;
  const res = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, temperature: 0, max_tokens: 400,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as any;
  inTok += j.usage?.prompt_tokens ?? 0;
  outTok += j.usage?.completion_tokens ?? 0;
  const raw = (j.choices?.[0]?.message?.content ?? "").trim();
  return JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
}
async function worker() {
  while (cursor < todo.length) {
    const r = todo[cursor++];
    try {
      let coded;
      try { coded = await callOnce(r); } catch { await new Promise((s) => setTimeout(s, 2000)); coded = await callOnce(r); }
      outStream.write(JSON.stringify({
        responseId: r.id, engine: r.model, outcome: coded.outcome,
        top_pick: coded.top_pick ?? null, target_framing: coded.target_framing,
        reasons: coded.reasons ?? [],
      }) + "\n");
      ok++;
      if (ok % 200 === 0) console.log(`  ${ok} coded, ${failed} failed`);
    } catch (err) {
      failed++;
      if (failed <= 3) console.error(`  FAIL ${r.id}: ${String(err).slice(0, 140)}`);
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.EVAL_CONCURRENCY ?? 24) }, worker));
outStream.end();
console.log(`variant ${VARIANT} done: ${ok} coded, ${failed} failed; tokens in ${inTok} out ${outTok}`);
process.exit(failed > 20 ? 2 : 0);
