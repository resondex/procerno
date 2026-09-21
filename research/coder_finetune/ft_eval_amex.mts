/**
 * Evaluate a fine-tuned judgment coder (Fireworks, OpenAI-compatible) over
 * the 5,390 American Express answers - a TRANSFER test: the adapter was
 * trained only on jira, so the brand and its 22 reason codes are unseen.
 * Prompts are built EXACTLY as in training
 * (question + answer + target brand + allowed codes); output is the
 * four-field judgment JSON. Results to local JSONL only.
 *
 * Usage: npx tsx ft_eval.mts <model-id> [out.jsonl]
 *   model-id e.g. accounts/<acct>/models/procerno-coder-v1
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const MODEL = process.argv[2];
if (!MODEL) {
  console.error("usage: tsx ft_eval.mts <model-id> [out.jsonl]");
  process.exit(1);
}
const REPO = "/Users/tylersolloway/Documents/GitHub/procerno";
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
if (!process.env.FIREWORKS_API_KEY) {
  console.error("FIREWORKS_API_KEY not in .env.local");
  process.exit(1);
}

const HOME = process.env.HOME!;
const J = `${HOME}/Documents/procerno_eval/amex`;
const tax = JSON.parse(fs.readFileSync(`${HOME}/Documents/procerno_eval/amex/amex_taxonomy.json`, "utf8"));
const OUT = process.argv[3] ?? `${HOME}/Documents/procerno_eval/finetune/ft_amex_eval.jsonl`;

const SYSTEM =
  "You code one AI assistant answer for a brand-visibility study. Be literal: code only " +
  "what the text says. Reply with ONLY a JSON object: " +
  '{"outcome": "pick"|"conditional"|"no_pick"|"clarification", ' +
  '"top_pick": <brand or null - only when outcome is pick, exactly as the answer writes it>, ' +
  '"target_framing": "recommended"|"mentioned"|"negative"|"absent" - how the answer treats the target brand, ' +
  '"reasons": [codes the answer argues FROM, drawn only from the allowed list]}';

const rows = zlib
  .gunzipSync(fs.readFileSync(`${HOME}/Documents/procerno_response_vault/american_express_34d46b95_5390rows_2026-09-19T0840.jsonl.gz`))
  .toString("utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const prompts: Record<string, string> = {};
for (const p of rows[0].prompts) prompts[p.id] = p.text;
const answers = rows.slice(1) as { id: string; prompt_id: string; model: string; text: string }[];

const done = new Set<string>();
if (fs.existsSync(OUT)) {
  for (const l of fs.readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean)) {
    done.add(JSON.parse(l).responseId);
  }
}
const todo = answers
  .filter((r) => !done.has(r.id))
  .slice(0, Number(process.env.EVAL_LIMIT ?? Infinity));
console.log(`amex total ${answers.length}, done ${done.size}, todo ${todo.length}, model ${MODEL}`);

let cursor = 0,
  ok = 0,
  failed = 0,
  inTok = 0,
  outTok = 0;
const outStream = fs.createWriteStream(OUT, { flags: "a" });
async function callOnce(r: (typeof todo)[number]) {
  const user =
    `Question: ${prompts[r.prompt_id] ?? ""}\n\nAnswer:\n${r.text}\n\n` +
    `Target brand: ${tax.brand}\nAllowed reason codes: ${tax.reason_taxonomy.join(", ")}`;
  const res = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as any;
  inTok += j.usage?.prompt_tokens ?? 0;
  outTok += j.usage?.completion_tokens ?? 0;
  const raw = (j.choices?.[0]?.message?.content ?? "").trim();
  const jsonText = raw.replace(/^```(?:json)?|```$/g, "").trim();
  const parsed = JSON.parse(jsonText);
  return parsed as { outcome: string; top_pick: string | null; target_framing: string; reasons: string[] };
}
async function worker() {
  while (cursor < todo.length) {
    const r = todo[cursor++];
    try {
      let coded;
      try {
        coded = await callOnce(r);
      } catch {
        await new Promise((res) => setTimeout(res, 2000));
        coded = await callOnce(r);
      }
      outStream.write(
        JSON.stringify({
          responseId: r.id,
          engine: r.model,
          outcome: coded.outcome,
          top_pick: coded.top_pick ?? null,
          target_framing: coded.target_framing,
          reasons: coded.reasons ?? [],
        }) + "\n"
      );
      ok++;
      if (ok % 250 === 0) console.log(`  ${ok} coded, ${failed} failed`);
    } catch (err) {
      failed++;
      if (failed <= 5) console.error(`  FAIL ${r.id}: ${String(err).slice(0, 160)}`);
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.EVAL_CONCURRENCY ?? 16) }, worker));
outStream.end();
console.log(`done: ${ok} coded, ${failed} failed; tokens in ${inTok} out ${outTok}`);
process.exit(failed > 50 ? 2 : 0);
