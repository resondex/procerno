/**
 * Seed-generator test driver (read-only against prod; suggest-model spend only).
 *
 * For each of the four labeled brands: pull category, competitors, and the
 * grid's distinct buying scenarios from prod (SELECT only), then generate TWO
 * independent seed taxonomies with the fixed scenario-aware prompt (verbatim
 * from src/lib/engine/suggest.ts getReasonTaxonomy; replicated here so the
 * test never writes to the prod cache table). Two draws because the suggest
 * model runs at its default temperature (gpt-5 family rejects temp 0), so
 * draw variance IS the ambiguity under test.
 *
 * Output: ~/Documents/procerno_eval/labeling/seed_test_<brand>.json
 *         {category, competitors, scenarios, seed_a, seed_b}
 *
 * Usage: npx tsx scripts/seed_test_generate.mts
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const HOME = process.env.HOME!;
const OUT = `${HOME}/Documents/procerno_eval/labeling`;
const SUGGEST_MODEL = process.env.SUGGEST_MODEL ?? "gpt-5-mini";

const BRANDS: Record<string, string> = {
  jira: "jira",
  amex: "American Express",
  netflix: "Netflix",
  pixel: "Google Pixel",
};

const TAXONOMY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { codes: { type: "array", items: { type: "string" } } },
  required: ["codes"],
} as const;

// verbatim from suggest.ts getReasonTaxonomy (scenario-aware version)
const SYSTEM =
  "Produce a closed taxonomy of reason codes: the arguments an AI " +
  "assistant uses to justify or compare recommendations in the given " +
  "category (the credit-card equivalents are 'annual fee', " +
  "'lounge access', 'cash back'). Ground every code in the buying " +
  "scenarios provided: include a code only if an answer to one of " +
  "those scenarios would plausibly argue FROM it; scenario-specific " +
  "dimensions (e.g. migration or switching concerns when scenarios " +
  "describe replacing an incumbent) matter as much as generic ones. " +
  "Rules: short lowercase noun phrases (1-3 words), mutually " +
  "distinct, never an umbrella term alongside its own specifics " +
  "(one of 'travel perks' or 'lounge access', not both). As many " +
  "codes as the scenarios justify and no more - do not pad to a " +
  "count. No brand names.";

async function generate(category: string, competitors: string[], scenarios: string[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SUGGEST_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            category,
            competitor_context: competitors,
            buying_scenarios: scenarios,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "taxonomy", strict: true, schema: TAXONOMY_SCHEMA },
      },
    }),
  });
  if (!res.ok) throw new Error(`suggest HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as any;
  return [
    ...new Set(
      (JSON.parse(j.choices[0]?.message?.content ?? '{"codes":[]}').codes as string[])
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean)
    ),
  ].slice(0, 40);
}

for (const [key, brand] of Object.entries(BRANDS)) {
  const proj = await sql`SELECT id, category, competitors FROM projects WHERE brand = ${brand} LIMIT 1`;
  if (!proj.length) {
    console.error(`no project for ${brand}`);
    continue;
  }
  const { id, category, competitors } = proj[0];
  const comp = typeof competitors === "string" ? JSON.parse(competitors) : competitors;
  const intents = await sql`SELECT DISTINCT situation FROM intents WHERE project_id = ${id} AND situation IS NOT NULL`;
  const scenarios = intents.map((r: any) => r.situation).filter(Boolean);
  console.log(`${key}: category "${category}", ${comp.length} competitors, ${scenarios.length} scenarios`);
  const seed_a = await generate(category, comp, scenarios);
  const seed_b = await generate(category, comp, scenarios);
  fs.writeFileSync(
    `${OUT}/seed_test_${key}.json`,
    JSON.stringify({ brand, category, competitors: comp, scenarios, seed_a, seed_b }, null, 1)
  );
  console.log(`  seed_a ${seed_a.length} codes | seed_b ${seed_b.length} codes | overlap ${seed_a.filter((c) => seed_b.includes(c)).length}`);
}
await sql.end();
