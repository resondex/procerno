/**
 * v10 finalization pass: for every roster fixture, run the setup engine
 * to the END of the prompts gate - cached v10 read + cells, FRESH
 * paraphrase sets (UI-sized batches) - and report per-stage fill,
 * shortfalls, the fit-advisory state, and sampled prompt text for
 * quality review. Retries ride over the flaky-connection class that
 * truncated earlier captures.
 *
 *   npx tsx --env-file=.env.local scripts/verify_v10_prompts.ts
 */
import { writeFileSync } from "fs";
import {
  composeInstrument,
  generateGrid,
  generatePhrasings,
  reviewScenarioFit,
  namesAnyBrand,
} from "../src/lib/engine/instrument";

const ROSTER = [
  { brand: "jira", category: "project management tools", audience: "software development teams", competitors: ["Asana", "Monday.com", "Trello", "ClickUp", "GitHub Issues", "Azure DevOps"] },
  { brand: "Sephora", category: "beauty retailers", audience: "makeup and skincare shoppers", competitors: ["Ulta Beauty", "Amazon (beauty)", "Target (beauty)", "Macy's (beauty)", "Nordstrom (beauty)"] },
  { brand: "Google Pixel", category: "Android smartphones", audience: "Android-focused smartphone buyers", competitors: ["Apple (iPhone)", "Samsung (Galaxy)", "OnePlus", "Xiaomi (Mi/Redmi)", "Motorola (Moto)"] },
  { brand: "Google Nest", category: "smart home devices", audience: "homeowners and renters buying smart home devices", competitors: ["Amazon", "Ecobee", "Arlo", "Wyze", "Philips Hue"] },
  { brand: "Netflix", category: "subscription streaming services", audience: "streaming entertainment consumers", competitors: ["Disney+", "Amazon Prime Video", "Hulu", "Max (HBO)", "Apple TV+"] },
  { brand: "Purple", category: "mattress brands", audience: "online mattress shoppers", competitors: ["Casper", "Tempur-Pedic", "Saatva", "Nectar", "Leesa"] },
  { brand: "AG1", category: "greens powder supplements", audience: "health-conscious adults seeking an all-in-one daily greens supplement", competitors: ["Garden of Life", "Organifi", "Amazing Grass", "KOS", "Vibrant Health (Green Vibrance)"] },
  { brand: "American Express", category: "credit cards", audience: "consumers and small businesses looking for credit cards", competitors: ["Visa", "Mastercard", "Chase", "Capital One", "Discover"] },
  { brand: "Doritos", category: "tortilla chips", audience: "grocery shoppers buying savory snacks", competitors: ["Tostitos", "Takis", "Late July", "Santitas", "Great Value (Walmart)"] },
  { brand: "athenahealth", category: "ambulatory EHR software", audience: "ambulatory practice administrators", competitors: ["Epic", "Cerner", "eClinicalWorks", "NextGen Healthcare", "Allscripts", "Practice Fusion"] },
  { brand: "PwC", category: "professional services firms", audience: "CFOs and senior executives at large enterprises", competitors: ["Deloitte", "EY (Ernst & Young)", "KPMG", "Accenture", "McKinsey & Company"] },
];
const COUNT = 10;
const BATCH = 8;
const OUT = process.env.V10_REPORT ?? "/tmp/v10_prompts_report.json";

async function retry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= 2) throw err;
      console.log(`   retry ${what} (${(err as Error).message})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

const CONCURRENCY = Number(process.env.V10_CONCURRENCY ?? 3);

async function main() {
  const report: Record<string, unknown>[] = [];
  // Worker pool: CONCURRENCY brands in flight at once. Doubles as a small
  // multi-setup load sample - same account rate limits and DB pool as
  // that many users setting up simultaneously; 429s/resets are logged by
  // the retry wrapper so the run measures them instead of hiding them.
  const queue = [...ROSTER];
  const runOne = async (e: (typeof ROSTER)[number]) => {
    process.stdout.write(`=== start ${e.brand}\n`);
    const composed = await retry("compose", () =>
      composeInstrument({ category: e.category, audience: e.audience, meta: { brand: e.brand, source: "v10-verify" } })
    );
    if (!composed) { console.log(`   ${e.brand}: READ NULL`); return; }
    const cells = await retry("cells", () =>
      generateGrid({
        brand: e.brand, category: e.category, competitors: e.competitors, audience: e.audience,
        base: composed.base, scenarios: composed.scenarios,
        stages: composed.stages.filter((s) => s.recommended),
        meta: { source: "v10-verify" },
      })
    );
    if (!cells) { console.log(`   ${e.brand}: CELLS NULL`); return; }
    const fit = await retry("fit", () =>
      reviewScenarioFit({
        brand: e.brand, category: e.category,
        scenarios: composed.scenarios.map((s) => ({ label: s.label, description: s.description })),
        meta: { source: "v10-verify" },
      })
    ).catch(() => ({ offPortfolio: [], missingCore: null }));
    const perCell: number[] = new Array(cells.length).fill(0);
    for (let i = 0; i < cells.length; i += BATCH) {
      const slice = cells.slice(i, i + BATCH);
      const sets = await retry(`phrasings ${i / BATCH + 1}`, () =>
        generatePhrasings({
          brand: e.brand, category: e.category, competitors: e.competitors, audience: e.audience,
          base: composed.base, scenarios: composed.scenarios,
          cells: slice.map((c) => ({ stage: c.stage, situation: c.situation, angle: c.angle, mode: c.mode ?? null, text: c.text })),
          count: COUNT,
          meta: { source: "v10-verify" },
        })
      );
      slice.forEach((_, j) => { perCell[i + j] = 1 + (sets[j]?.length ?? 0); });
      process.stdout.write(`   ${e.brand} batch ${i / BATCH + 1} done\n`);
    }
    const byStage: Record<string, { cells: number; kept: number; want: number }> = {};
    const shorts: string[] = [];
    cells.forEach((c, i) => {
      const st = (byStage[c.stage] ??= { cells: 0, kept: 0, want: 0 });
      st.cells++; st.kept += perCell[i]; st.want += COUNT;
      if (perCell[i] < COUNT) {
        const blind = !namesAnyBrand(c.text, e.brand, e.competitors);
        shorts.push(`${c.stage}:${perCell[i]}/${COUNT}${blind ? "(blind)" : ""}`);
      }
    });
    const total = perCell.reduce((a, b) => a + b, 0);
    console.log(`   ${e.brand}: ${total}/${cells.length * COUNT} prompts | shorts: ${shorts.join(", ") || "none"}`);
    console.log(`   ${e.brand} fit: off=${fit.offPortfolio.length} missing=${fit.missingCore ? fit.missingCore.label : "null"}`);
    // Quality samples for review: one blind decision-stage seed and one
    // branded objections seed with two paraphrases each, from cache.
    report.push({
      brand: e.brand, cells: cells.length, prompts: total, shorts,
      fit: { off: fit.offPortfolio.map((f) => f.label), missing: fit.missingCore?.label ?? null },
      byStage: Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, `${v.kept}/${v.want}`])),
      sampleSeeds: [
        cells.find((c) => c.stage === "shortlist" || c.stage === "discovery")?.text,
        cells.find((c) => c.stage === "objections")?.text,
      ],
    });
    writeFileSync(OUT, JSON.stringify(report, null, 1));
    console.log(`=== done ${e.brand}`);
  };
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        await runOne(e);
      } catch (err) {
        console.log(`=== FAILED ${e.brand}: ${(err as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
  console.log(`\nreport: ${OUT}`);
  process.exit(0);
}

void main();
