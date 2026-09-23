/** v7 draft rules through the batch-free 5-run harness, all four brands.
 * Single-name judging, gpt-5-mini, default sampling. Local only; ledger
 * eval:dict_stability rnd. Gate: Pixel modal verdicts vs the pinned board. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { openaiClient } = await import("../src/lib/engine/providers");
const { withCostContext } = await import("../src/lib/cost_log");
const postgres = (await import("postgres")).default;

function v7System(category: string, active: string[]): string {
  return (
    "You review a brand-dictionary queue for a study of AI answers in " +
    `the category "${category}". For each pending name, propose:\n` +
    "- merge: the name is the SAME offering as one of the active brands " +
    "(alternate name, spelling, sub-surface of the same product). Set " +
    "merge_into to that active brand's canonical name exactly.\n" +
    "- approve: a competing brand or product line from a DIFFERENT maker " +
    "than the active brands - a genuinely new player in this category, " +
    "worth its own row.\n" +
    "- ignore: not an analyzable offering in this category. This includes " +
    "generic or infrastructure descriptors ('a self-hosted server', " +
    "'open-source tools', 'a spreadsheet'), feature fragments with no brand " +
    "attached, compound names listing multiple DISTINCT brands (merging " +
    "such a name into either would misattribute the other), one-off " +
    "tangents - AND real companies that do not sell this category's " +
    "offering: component suppliers, carriers, platform owners, retailers, " +
    "marketplaces, publications, review sites, and apps the products " +
    "merely run. Appearing in answers is not the same as being a choice.\n" +
    "PREFER MERGE OVER IGNORE: when a name is a surface, module, " +
    "add-on, edition, or tier of an offering that appears among the " +
    "active brands or elsewhere in this batch, merge it into that " +
    "offering. Reserve ignore for names with no parent to merge into.\n" +
    "GRAIN RULE — the analyzable unit is the offering a buyer would " +
    "choose in this category. Feature surfaces, sub-modules, editions, " +
    "tiers, and compound phrasings of one offering all merge into that " +
    "offering. Two products a company sells separately, which a buyer " +
    "would weigh against each other, stay separate even under one " +
    "corporate parent; one product's several views or editions do not. " +
    "A named model, generation, or trim of an active brand's product line " +
    "(a numbered or suffixed variant of its name) merges into that line - " +
    "it is never approve.\n" +
    "ECOSYSTEM RULE — a product, service, app, store, or accessory " +
    "belonging to an active brand's ecosystem (a companion device, " +
    "first-party service, migration tool, accessory line) and a partner " +
    "brand named as part of an active brand's product (a co-engineered " +
    "camera, a licensed feature) are NEVER their own row and never " +
    "ignored: merge them into that brand.\n" +
    "Every suggestion needs a one-line rationale.\n" +
    `Active brands: ${active.join(", ")}.\n` +
    "Also treat pending names as potential merge targets for OTHER " +
    "pending names by proposing approve for the best-named variant and " +
    "merge for the rest, with merge_into set to the approved variant. " +
    "The approved variant must be the plainest buyer-facing brand " +
    "name — the bare product name rather than any feature-phrased or " +
    "edition-phrased form of it, which are always the ones merged. If " +
    "several pending names are surfaces of one product that is not " +
    "itself listed, approve the plainest name as the parent and merge " +
    "the others into it."
  );
}

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { suggestions: { type: "array", items: { type: "object", additionalProperties: false,
    properties: { name: { type: "string" }, action: { type: "string", enum: ["merge","approve","ignore"] },
      merge_into: { type: ["string","null"] }, rationale: { type: "string" } },
    required: ["name","action","merge_into","rationale"] } } },
  required: ["suggestions"],
} as const;

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const BRANDS: [string, string][] = [
  ["pixel", "1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0"],
  ["amex", "7354bce6-6c22-432e-a531-99ce3118dc7a"],
];

async function judgeOne(system: string, name: string): Promise<string> {
  const res = await openaiClient().chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify([name]) },
    ],
    max_completion_tokens: 24000,
    response_format: { type: "json_schema", json_schema: { name: "dispositions", strict: true, schema: SCHEMA } },
  });
  const s = (JSON.parse(res.choices[0]?.message?.content ?? '{"suggestions":[]}') as { suggestions: { action: string; merge_into: string | null }[] }).suggestions[0];
  return !s ? "-" : s.action === "merge" ? `merge->${s.merge_into}` : s.action;
}
const modal = (runs: string[]) => {
  const c = new Map<string, number>();
  for (const x of runs) c.set(x, (c.get(x) ?? 0) + 1);
  const [v, n] = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
  return { v, n };
};

for (const [brand, pid] of BRANDS) {
  const [proj] = await sql`SELECT category FROM projects WHERE id=${pid}`;
  const pend = (await sql`SELECT canonical FROM dictionary_entries WHERE project_id=${pid} AND status='pending' ORDER BY canonical`).map((r) => r.canonical as string);
  const active = (await sql`SELECT canonical FROM dictionary_entries WHERE project_id=${pid} AND status='active'`).map((r) => r.canonical as string);
  const system = v7System(proj.category as string, active);
  const cells = pend.map((name) => ({ name, runs: [] as string[] }));
  await withCostContext({ projectId: pid, purpose: "eval:dict_stability", rnd: true }, async () => {
    for (let r = 0; r < 5; r++) {
      let cursor = 0;
      const worker = async () => {
        while (cursor < cells.length) {
          const c = cells[cursor++];
          try { c.runs[r] = await judgeOne(system, c.name); }
          catch { try { c.runs[r] = await judgeOne(system, c.name); } catch { c.runs[r] = "ERROR"; } }
        }
      };
      await Promise.all(Array.from({ length: 24 }, worker));
    }
  });
  const esc = (s: string) => (s.includes(",") ? `"${s}"` : s);
  const lines = ["name,run1,run2,run3,run4,run5,modal_verdict,agreement"];
  for (const c of cells) { const m = modal(c.runs); lines.push([c.name, ...c.runs, m.v, `${m.n}/5`].map(esc).join(",")); }
  fs.writeFileSync(path.join(process.env.HOME!, `Downloads/${brand}_suggest_v7_1_5runs.csv`), lines.join("\n") + "\n");
  const unan = cells.filter((c) => new Set(c.runs).size === 1).length;
  const mix = new Map<string, number>();
  for (const c of cells) { const a = modal(c.runs).v.split("->")[0]; mix.set(a, (mix.get(a) ?? 0) + 1); }
  console.log(`${brand}: unanimous ${unan}/${cells.length}, mix ${JSON.stringify([...mix])}`);

  if (brand === "pixel") {
    // Gate: modal verdicts vs the pinned board.
    let match = 0; const misses: string[] = [];
    for (const c of cells) {
      const key = `dict_suggest:v5:${pid}:` + createHash("sha256").update(c.name.trim().toLowerCase()).digest("hex");
      const row = await sql`SELECT value FROM llm_cache WHERE key=${key}`;
      if (!row[0]) continue;
      const pin = JSON.parse(row[0].value);
      const pinV = pin.action === "merge" ? `merge->${pin.merge_into}` : pin.action;
      const m = modal(c.runs).v;
      if (m === pinV) match++;
      else misses.push(`${c.name}: pinned=${pinV} v7=${m}`);
    }
    console.log(`pixel gate: ${match}/${cells.length} match the pinned board`);
    for (const x of misses) console.log("  MISS " + x);
  }
}
await sql.end();
await new Promise((r) => setTimeout(r, 5000));
process.exit(0);
