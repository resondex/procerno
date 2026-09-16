/**
 * Golden-fixture capture + regression diff for the instrument designer.
 *
 * The 11-brand roster below was walked end to end through the setup demo
 * on 2026-09-15 and the outputs REVIEWED BY CLAUDE (not by Tyler) - reads,
 * scenarios, coverage maps, and cell quality were judged good against each
 * market. These fixtures freeze that baseline so any generation-rule
 * change (composer rules, prompts, INSTRUMENT/STYLE/PHRASINGS version
 * bumps) can be diffed instead of re-walked by hand.
 *
 *   npx tsx --env-file=.env.local scripts/golden_fixtures.ts capture
 *   npx tsx --env-file=.env.local scripts/golden_fixtures.ts diff
 *
 * capture: generate (cache-first - a warm cache costs nothing) and write
 *          fixtures/golden/<slug>.json.
 * diff:    regenerate and print a per-brand change report against the
 *          files. Text is stochastic, so the diff is STRUCTURAL: journey
 *          reads, scenario labels, stage lists, cell counts and the
 *          blind/branded split. Cell texts are stored for reference but
 *          only their counts are compared.
 *
 * Estimate fields are FROZEN here on purpose: the fixtures test the
 * instrument pipeline, not the estimate. Estimate-prompt changes are
 * reviewed separately.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  composeInstrument,
  generateGrid,
  namesAnyBrand,
} from "../src/lib/engine/instrument";
import { getBrandProfile } from "../src/lib/engine/suggest";

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

const DIR = join(__dirname, "..", "fixtures", "golden");

interface Fixture {
  brand: string;
  category: string;
  audience: string;
  competitors: string[];
  capturedAt: string;
  reviewedBy: string;
  base: Record<string, unknown>;
  scenarios: { label: string; description: string; deviates: boolean }[];
  stages: { key: string; label: string; recommended: boolean }[];
  cells: {
    count: number;
    blind: number;
    branded: number;
    byStage: Record<string, number>;
  };
  /** Reference only - stochastic; never structurally diffed. */
  cellTexts: string[];
}

const slug = (b: string) => b.toLowerCase().replace(/[^a-z0-9]+/g, "_");

async function build(entry: (typeof ROSTER)[number]): Promise<Fixture> {
  const composed = await composeInstrument({
    category: entry.category,
    audience: entry.audience,
    meta: { brand: entry.brand, source: "fixture" },
  });
  if (!composed) throw new Error(`${entry.brand}: read came back empty`);
  const kept = composed.stages.filter((s) => s.recommended);
  const cells = await generateGrid({
    brand: entry.brand,
    category: entry.category,
    competitors: entry.competitors,
    audience: entry.audience,
    base: composed.base,
    scenarios: composed.scenarios,
    stages: kept,
    meta: { source: "fixture" },
  });
  if (!cells) throw new Error(`${entry.brand}: cell write came back empty`);
  const byStage: Record<string, number> = {};
  let blind = 0;
  for (const c of cells) {
    byStage[c.stage] = (byStage[c.stage] ?? 0) + 1;
    if (!namesAnyBrand(c.text, entry.brand, entry.competitors)) blind++;
  }
  return {
    brand: entry.brand,
    category: entry.category,
    audience: entry.audience,
    competitors: entry.competitors,
    capturedAt: new Date().toISOString().slice(0, 10),
    reviewedBy:
      "Claude via the v8/v9/v10 three-way diff, presented to Tyler 2026-09-16; not independently reviewed by Tyler",
    base: composed.base as unknown as Record<string, unknown>,
    scenarios: composed.scenarios.map((s) => ({
      label: s.label,
      description: s.description,
      deviates: s.journey !== null,
    })),
    stages: composed.stages.map((s) => ({ key: s.key, label: s.label, recommended: s.recommended })),
    cells: { count: cells.length, blind, branded: cells.length - blind, byStage },
    cellTexts: cells.map((c) => `[${c.stage}|${c.situation ?? "-"}|${c.angle}] ${c.text}`),
  };
}

function diffFixture(oldF: Fixture, newF: Fixture): string[] {
  const out: string[] = [];
  for (const k of Object.keys({ ...oldF.base, ...newF.base })) {
    if (JSON.stringify(oldF.base[k]) !== JSON.stringify(newF.base[k])) {
      out.push(`base.${k}: ${JSON.stringify(oldF.base[k])} -> ${JSON.stringify(newF.base[k])}`);
    }
  }
  const oldSc = oldF.scenarios.map((s) => s.label);
  const newSc = newF.scenarios.map((s) => s.label);
  if (JSON.stringify(oldSc) !== JSON.stringify(newSc)) {
    out.push(`scenarios: [${oldSc.join(", ")}] -> [${newSc.join(", ")}]`);
  }
  const stageSet = (f: Fixture) => f.stages.filter((s) => s.recommended).map((s) => s.key).sort().join(",");
  if (stageSet(oldF) !== stageSet(newF)) {
    out.push(`recommended stages: ${stageSet(oldF)} -> ${stageSet(newF)}`);
  }
  if (oldF.cells.count !== newF.cells.count || oldF.cells.blind !== newF.cells.blind) {
    out.push(
      `cells: ${oldF.cells.count} (${oldF.cells.blind} blind) -> ${newF.cells.count} (${newF.cells.blind} blind)`
    );
  }
  for (const st of new Set([...Object.keys(oldF.cells.byStage), ...Object.keys(newF.cells.byStage)])) {
    const a = oldF.cells.byStage[st] ?? 0;
    const b = newF.cells.byStage[st] ?? 0;
    if (a !== b) out.push(`cells in ${st}: ${a} -> ${b}`);
  }
  return out;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "capture" && mode !== "diff") {
    console.error("usage: golden_fixtures.ts capture|diff");
    process.exit(1);
  }
  mkdirSync(DIR, { recursive: true });
  // CONSISTENCY GATE: the roster freezes each brand's estimate inputs, but
  // the PRODUCT derives them from the live estimate cache. If the two
  // diverge (an estimate-prompt change, a cleared profile), every fixture
  // downstream describes inputs no user can reach - which is exactly how
  // three "warm" brands turned out cold in the demo on 2026-09-16. Refuse
  // to run on drift; reconcile the roster first (GOLDEN_ALLOW_DRIFT=1
  // overrides, for intentional migrations only).
  let drift = 0;
  for (const entry of ROSTER) {
    const live = await getBrandProfile(entry.brand);
    const mismatches: string[] = [];
    if (live.category.trim() !== entry.category) {
      mismatches.push(`category: roster "${entry.category}" vs live "${live.category}"`);
    }
    if ((live.audience ?? "").trim() !== entry.audience) {
      mismatches.push(`audience: roster "${entry.audience}" vs live "${live.audience}"`);
    }
    if (live.competitors.join("|") !== entry.competitors.join("|")) {
      mismatches.push(`rivals: roster [${entry.competitors.join(", ")}] vs live [${live.competitors.join(", ")}]`);
    }
    if (mismatches.length > 0) {
      drift++;
      console.log(`DRIFT ${entry.brand}:`);
      for (const m of mismatches) console.log(`   ${m}`);
    }
  }
  if (drift > 0 && process.env.GOLDEN_ALLOW_DRIFT !== "1") {
    console.log(`\n${drift} brand(s) drifted from the live estimate - reconcile the roster before running.`);
    process.exit(4);
  }
  let drifted = 0;
  let failed = 0;
  for (const entry of ROSTER) {
    const file = join(DIR, `${slug(entry.brand)}.json`);
    process.stdout.write(`${entry.brand} … `);
    // The shared Postgres connection can reset (ECONNRESET) while a slow
    // OpenAI call holds it idle; postgres.js reopens on the next query,
    // so one retry recovers - and one brand's failure must not kill the
    // remaining roster (it silently truncated two runs).
    let fresh: Fixture;
    try {
      fresh = await build(entry);
    } catch (err) {
      console.log(`retrying (${(err as Error).message}) … `);
      try {
        fresh = await build(entry);
      } catch (err2) {
        console.log(`FAILED: ${(err2 as Error).message}`);
        failed++;
        continue;
      }
    }
    if (mode === "capture") {
      writeFileSync(file, JSON.stringify(fresh, null, 1));
      console.log(`captured (${fresh.cells.count} cells, ${fresh.cells.blind} blind)`);
    } else {
      if (!existsSync(file)) {
        console.log("NO FIXTURE - run capture first");
        drifted++;
        continue;
      }
      const old = JSON.parse(readFileSync(file, "utf8")) as Fixture;
      const changes = diffFixture(old, fresh);
      if (changes.length === 0) console.log("unchanged");
      else {
        drifted++;
        console.log("CHANGED:");
        for (const c of changes) console.log(`   ${c}`);
      }
    }
  }
  if (failed > 0) console.log(`\n${failed} brand(s) FAILED - rerun capture.`);
  if (mode === "diff") {
    console.log(drifted === 0 ? "\nAll fixtures unchanged." : `\n${drifted} brand(s) drifted - review above.`);
    process.exit(failed > 0 ? 3 : drifted === 0 ? 0 : 2);
  }
  process.exit(failed > 0 ? 3 : 0);
}

void main();
