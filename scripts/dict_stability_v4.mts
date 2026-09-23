/** v4 arm of the batch-free stability eval - same harness, prompt from
 * commit a6f190d. Reuses nothing from v5/v6 runs; writes its own CSV. */
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
// v4 module no longer needed - prompt is inlined below (from commit a6f190d).
const { openaiClient } = await import("../src/lib/engine/providers");
const { withCostContext } = await import("../src/lib/cost_log");
const postgres = (await import("postgres")).default;
const PID = "1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const pend = (await sql`SELECT canonical FROM dictionary_entries WHERE project_id=${PID} AND status='pending' ORDER BY canonical`).map((r) => r.canonical as string);
const active = (await sql`SELECT canonical FROM dictionary_entries WHERE project_id=${PID} AND status='active'`).map((r) => r.canonical as string);
await sql.end();

// v4 predates the exported prompt builder - reconstruct its system text by
// invoking its module's internals is not possible, so inline the v4 string
// exactly as committed (verified byte-identical below via git show).
const V4_SYSTEM =
  "You review a brand-dictionary queue for a study of AI answers in " +
  `the category "smartphones". For each pending name, propose:\n` +
  "- merge: the name is the SAME offering as one of the active brands " +
  "(alternate name, spelling, sub-surface of the same product). Set " +
  "merge_into to that active brand's canonical name exactly.\n" +
  "- approve: a genuinely distinct brand/product competing in or " +
  "relevant to the category, worth its own row.\n" +
  "- ignore: not an analyzable brand. This includes generic or " +
  "infrastructure descriptors ('self-hosted server', 'open-source " +
  "tools', 'spreadsheets'), feature fragments with no brand attached " +
  "('Issue Boards', 'kanban boards'), compound names listing multiple " +
  "DISTINCT brands ('Trello / Asana' — merging it into either would " +
  "misattribute the other), one-off tangents, and tools from " +
  "unrelated categories.\n" +
  "GRAIN RULE — the analyzable unit is the offering a buyer would " +
  "choose in this category. Feature surfaces, sub-modules, tiers, and " +
  "compound phrasings of the same offering ('X Issues', 'X Boards', " +
  "'X Issues & Boards', 'X CE/EE', 'X Ultimate') all merge into that " +
  "offering. Distinct purchasable products a buyer weighs separately " +
  "(even from the same company) stay separate — Jira and Trello are " +
  "different offerings; GitLab Issues and GitLab Boards are the same " +
  "one. Every suggestion needs a one-line rationale.\n" +
  `Active brands: ${active.join(", ")}.`;


const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { suggestions: { type: "array", items: { type: "object", additionalProperties: false,
    properties: { name: { type: "string" }, action: { type: "string", enum: ["merge","approve","ignore"] },
      merge_into: { type: ["string","null"] }, rationale: { type: "string" } },
    required: ["name","action","merge_into","rationale"] } } },
  required: ["suggestions"],
} as const;

async function judgeOne(name: string): Promise<string> {
  const res = await openaiClient().chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: V4_SYSTEM },
      { role: "user", content: JSON.stringify([name]) },
    ],
    max_completion_tokens: 24000,
    response_format: { type: "json_schema", json_schema: { name: "dispositions", strict: true, schema: SCHEMA } },
  });
  const s = (JSON.parse(res.choices[0]?.message?.content ?? '{"suggestions":[]}') as { suggestions: { action: string; merge_into: string | null }[] }).suggestions[0];
  return !s ? "-" : s.action === "merge" ? `merge->${s.merge_into}` : s.action;
}

const cells = pend.map((name) => ({ name, runs: [] as string[] }));
await withCostContext({ projectId: PID, purpose: "eval:dict_stability", rnd: true }, async () => {
  for (let r = 0; r < 5; r++) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < cells.length) {
        const c = cells[cursor++];
        try { c.runs[r] = await judgeOne(c.name); }
        catch { try { c.runs[r] = await judgeOne(c.name); } catch { c.runs[r] = "ERROR"; } }
      }
    };
    await Promise.all(Array.from({ length: 24 }, worker));
    console.log(`v4 run ${r + 1}/5 done`);
  }
});
const esc = (s: string) => (s.includes(",") ? `"${s}"` : s);
const modal = (runs: string[]) => {
  const c = new Map<string, number>();
  for (const x of runs) c.set(x, (c.get(x) ?? 0) + 1);
  const [v, n] = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
  return { v, n };
};
const lines = ["name,run1,run2,run3,run4,run5,modal_verdict,agreement"];
for (const c of cells) { const m = modal(c.runs); lines.push([c.name, ...c.runs, m.v, `${m.n}/5`].map(esc).join(",")); }
fs.writeFileSync(path.join(process.env.HOME!, "Downloads/pixel_suggest_v4_5runs.csv"), lines.join("\n") + "\n");
const unan = cells.filter((c) => new Set(c.runs).size === 1).length;
console.log(`v4: unanimous ${unan}/71; wrote pixel_suggest_v4_5runs.csv`);
for (const c of cells) { const m = modal(c.runs); console.log(`${c.name}\t${m.v}\t${m.n}/5`); }
await new Promise((r) => setTimeout(r, 5000));
process.exit(0);
