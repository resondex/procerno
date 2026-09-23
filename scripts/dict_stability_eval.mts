/** Batch-effect-free stability eval: every Pixel pending name judged ALONE
 * (single-name batches, so no batchmate context at all) under the v5 prompt
 * (deployed) and the v6 draft, 5 independent runs each. gpt-5-mini, no
 * sampling params (rejects temp 0). Outputs to ~/Downloads. Local only;
 * ledger purpose eval:dict_stability, rnd.
 */
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { suggestSystemPrompt: v6Prompt } = await import("../src/lib/engine/dict_suggest");
// v5 prompt module: recreate with `git show 8d5b571:src/lib/engine/dict_suggest.ts > src/lib/engine/dict_suggest_v5_tmp.ts`
const { suggestSystemPrompt: v5Prompt } = await import("../src/lib/engine/dict_suggest_v5_tmp" as string);
const { openaiClient } = await import("../src/lib/engine/providers");
const { withCostContext } = await import("../src/lib/cost_log");
const postgres = (await import("postgres")).default;

const PID = "1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0";
const CATEGORY = "smartphones";
const RUNS = 5;
const DOWNLOADS = path.join(process.env.HOME!, "Downloads");

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

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const pend = (await sql`SELECT canonical FROM dictionary_entries WHERE project_id=${PID} AND status='pending' ORDER BY canonical`).map((r) => r.canonical as string);
const active = (await sql`SELECT canonical FROM dictionary_entries WHERE project_id=${PID} AND status='active'`).map((r) => r.canonical as string);
await sql.end();
console.log(`${pend.length} pending, actives: ${active.join(", ")}`);

async function judgeOne(system: string, name: string): Promise<string> {
  const res = await openaiClient().chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify([name]) },
    ],
    max_completion_tokens: 24000,
    response_format: {
      type: "json_schema",
      json_schema: { name: "dispositions", strict: true, schema: SCHEMA },
    },
  });
  const s = (JSON.parse(res.choices[0]?.message?.content ?? '{"suggestions":[]}') as {
    suggestions: { action: string; merge_into: string | null }[];
  }).suggestions[0];
  if (!s) return "-";
  return s.action === "merge" ? `merge->${s.merge_into}` : s.action;
}

interface Cell { name: string; runs: string[] }
async function runVersion(label: string, system: string): Promise<Cell[]> {
  const cells: Cell[] = pend.map((name) => ({ name, runs: [] }));
  for (let r = 0; r < RUNS; r++) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < cells.length) {
        const c = cells[cursor++];
        try {
          c.runs[r] = await judgeOne(system, c.name);
        } catch {
          try {
            c.runs[r] = await judgeOne(system, c.name);
          } catch {
            c.runs[r] = "ERROR";
          }
        }
      }
    };
    await Promise.all(Array.from({ length: 24 }, worker));
    console.log(`${label} run ${r + 1}/${RUNS} done`);
  }
  return cells;
}

const csvEsc = (s: string) => (s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);
function modal(runs: string[]): { v: string; n: number } {
  const c = new Map<string, number>();
  for (const r of runs) c.set(r, (c.get(r) ?? 0) + 1);
  const [v, n] = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
  return { v, n };
}
function writeCsv(file: string, cells: Cell[]) {
  const lines = ["name,run1,run2,run3,run4,run5,modal_verdict,agreement"];
  for (const c of cells) {
    const m = modal(c.runs);
    lines.push([c.name, ...c.runs, m.v, `${m.n}/5`].map(csvEsc).join(","));
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

const [v5cells, v6cells] = await withCostContext(
  { projectId: PID, purpose: "eval:dict_stability", rnd: true },
  async () => [
    await runVersion("v5", v5Prompt(CATEGORY, active)),
    await runVersion("v6", v6Prompt(CATEGORY, active)),
  ]
);
writeCsv(path.join(DOWNLOADS, "pixel_suggest_v5_5runs.csv"), v5cells);
writeCsv(path.join(DOWNLOADS, "pixel_suggest_v6_5runs.csv"), v6cells);

// Summary: stability per version + v5-vs-v6 modal verdicts side by side.
const stab = (cells: Cell[]) => {
  const unanimous = cells.filter((c) => new Set(c.runs).size === 1).length;
  const majority = cells.filter((c) => modal(c.runs).n >= 4).length;
  return { unanimous, majority };
};
const s5 = stab(v5cells);
const s6 = stab(v6cells);
const md: string[] = [
  "# Pixel dictionary suggestions - batch-free stability eval (5 runs each)",
  "",
  `Every name judged ALONE (no batchmates), actives fixed: ${active.join(", ")}. gpt-5-mini, default sampling (temp 0 rejected).`,
  "",
  `| version | unanimous 5/5 | majority >=4/5 | of |`,
  `| --- | --- | --- | --- |`,
  `| v5 (deployed) | ${s5.unanimous} | ${s5.majority} | ${pend.length} |`,
  `| v6 (draft rules) | ${s6.unanimous} | ${s6.majority} | ${pend.length} |`,
  "",
  "## Modal verdicts side by side (* = not unanimous across its 5 runs)",
  "",
  "| name | v5 | v6 |",
  "| --- | --- | --- |",
];
for (let i = 0; i < pend.length; i++) {
  const m5 = modal(v5cells[i].runs);
  const m6 = modal(v6cells[i].runs);
  md.push(
    `| ${pend[i]} | ${m5.v}${m5.n < 5 ? ` *(${m5.n}/5)*` : ""} | ${m6.v}${m6.n < 5 ? ` *(${m6.n}/5)*` : ""} |`
  );
}
fs.writeFileSync(path.join(DOWNLOADS, "pixel_suggest_v5_vs_v6.md"), md.join("\n") + "\n");
console.log("wrote pixel_suggest_v5_5runs.csv, pixel_suggest_v6_5runs.csv, pixel_suggest_v5_vs_v6.md to ~/Downloads");
await new Promise((r) => setTimeout(r, 5000));
process.exit(0);
