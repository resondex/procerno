/** Dictionary-disposition bakeoff: run the byte-identical v5 suggest prompt
 * against gpt-5-mini (prod), grok-4-fast, claude-haiku-4-5 and claude-sonnet-5
 * on the four bootstrap brands' real pending queues. Local JSONL only; ledger
 * purpose eval:dict_bakeoff, rnd. Read-only against prod.
 * Usage: npx tsx scripts/dict_bakeoff.mts
 */
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { suggestSystemPrompt } = await import("../src/lib/engine/dict_suggest");
const { openaiClient, coderCompatClient, anthropicClient } = await import(
  "../src/lib/engine/providers"
);
const { withCostContext } = await import("../src/lib/cost_log");
const postgres = (await import("postgres")).default;

const OUT_DIR = path.join(
  process.env.HOME!,
  "Documents/procerno_eval/dict_bakeoff"
);
fs.mkdirSync(OUT_DIR, { recursive: true });
const BRANDS = ["jira", "American Express", "Netflix", "Google Pixel"];
const CHUNK = 40;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          action: { type: "string", enum: ["merge", "approve", "ignore"] },
          merge_into: { type: ["string", "null"] },
          rationale: { type: "string" },
        },
        required: ["name", "action", "merge_into", "rationale"],
      },
    },
  },
  required: ["suggestions"],
} as const;

interface Verdict {
  name: string;
  action: string;
  merge_into: string | null;
  rationale: string;
}

function parseJson(text: string): { suggestions: Verdict[] } {
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");
  const start = cleaned.indexOf("{");
  return JSON.parse(cleaned.slice(start));
}

const JSON_TAIL =
  '\nReply ONLY with JSON: {"suggestions":[{"name":...,"action":"merge"|"approve"|"ignore","merge_into":<active canonical or null>,"rationale":...}]} - one entry per pending name, no other text.';

async function callModel(
  model: string,
  system: string,
  names: string[]
): Promise<{ verdicts: Verdict[]; ms: number }> {
  const t0 = Date.now();
  const user = JSON.stringify(names);
  let text: string;
  if (model === "gpt-5-mini") {
    const res = await openaiClient().chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: 8000,
      response_format: {
        type: "json_schema",
        json_schema: { name: "dispositions", strict: true, schema: SCHEMA },
      },
    });
    if (res.choices[0]?.finish_reason === "length") throw new Error("truncated");
    text = res.choices[0]?.message?.content ?? "";
  } else if (model === "grok-4-fast") {
    const res = await coderCompatClient(model).chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 8000,
      response_format: {
        type: "json_schema",
        json_schema: { name: "dispositions", strict: true, schema: SCHEMA },
      },
    });
    if (res.choices[0]?.finish_reason === "length") throw new Error("truncated");
    text = res.choices[0]?.message?.content ?? "";
  } else {
    // Anthropic. sonnet-5 rejects sampling params; haiku takes temperature 0.
    const client = await anthropicClient();
    const res = await client.messages.create({
      model,
      max_tokens: 8000,
      ...(model.startsWith("claude-haiku") ? { temperature: 0 } : {}),
      system: system + JSON_TAIL,
      messages: [{ role: "user", content: user }],
    });
    text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
  }
  return { verdicts: parseJson(text).suggestions, ms: Date.now() - t0 };
}

const MODELS = [
  "gpt-5-mini",
  "grok-4-fast",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-5",
];

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const out = fs.createWriteStream(path.join(OUT_DIR, "verdicts.jsonl"), {
  flags: "w",
});
const timings: Record<string, number[]> = {};

for (const brand of BRANDS) {
  const [proj] = await sql`SELECT id, category FROM projects WHERE brand = ${brand} ORDER BY created_at LIMIT 1`;
  const entries = await sql`SELECT canonical, status FROM dictionary_entries WHERE project_id = ${proj.id}`;
  const pending = entries.filter((e) => e.status === "pending").map((e) => e.canonical as string);
  const active = entries.filter((e) => e.status === "active").map((e) => e.canonical as string);
  console.log(`${brand}: ${pending.length} pending vs ${active.length} active`);
  const system = suggestSystemPrompt(proj.category as string, active);

  const batches: string[][] = [];
  for (let i = 0; i < pending.length; i += CHUNK) batches.push(pending.slice(i, i + CHUNK));

  for (const model of MODELS) {
    const results = await withCostContext(
      { projectId: proj.id as string, purpose: "eval:dict_bakeoff", rnd: true },
      () =>
        Promise.all(
          batches.map((b) =>
            callModel(model, system, b).catch((err) => {
              console.error(`  ${model} batch failed:`, String(err).slice(0, 200));
              return { verdicts: [] as Verdict[], ms: 0 };
            })
          )
        )
    );
    for (const r of results) {
      if (r.ms > 0) (timings[model] ??= []).push(r.ms);
      for (const v of r.verdicts) {
        out.write(
          JSON.stringify({ brand, model, name: v.name, action: v.action, merge_into: v.merge_into, rationale: v.rationale }) + "\n"
        );
      }
    }
    const n = results.reduce((s, r) => s + r.verdicts.length, 0);
    console.log(`  ${model}: ${n}/${pending.length} verdicts, batches ${results.map((r) => (r.ms / 1000).toFixed(1) + "s").join(" ")}`);
  }
}
await new Promise<void>((res) => out.end(() => res()));
console.log("\nMedian batch latency:");
for (const [m, ts] of Object.entries(timings)) {
  const s = [...ts].sort((a, b) => a - b);
  console.log(`  ${m}: ${(s[Math.floor(s.length / 2)] / 1000).toFixed(1)}s`);
}
await sql.end();
await new Promise((r) => setTimeout(r, 5000));
process.exit(0);
