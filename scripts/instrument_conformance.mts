/**
 * Instrument conformance harness (Tyler's go, 2026-09-28): generate FULL
 * batteries for the two held-out trackers (Doritos, Sephora) through the
 * engine code prod now deploys - journey, scenarios, grid, and 10
 * paraphrases for EVERY cell - then dump them for the conformance audit
 * (audit_generated_battery.py) and the design-fidelity check.
 *
 * Same plumbing as the internal-model tests: local store + ledger (run from
 * a scratch directory), prod configs read-only, prod models (no *_MODEL env
 * overrides). Usage:
 *   ARM=journey npx tsx scripts/instrument_conformance.mts
 *   ARM=head    npx tsx scripts/instrument_conformance.mts
 */
import fs from "node:fs";
import { ARM, closeProd, errors, localUsage, outDir, trackers, REPO } from "./internal_models_common.mts";

const inst = await import(`${REPO}/src/lib/engine/instrument`);
const OUT = outDir("conformance");
const projects = await trackers(["Doritos", "Sephora"]);
const meta = { source: "eval:conformance" };

if (ARM === "checkedgen") {
  // Wiring validation: regenerate ONLY doubt/plan cells through the checked
  // generation path (PHRASINGS_CHECKS on); drifters must be dropped/refilled.
  const DP = new Set(["objections", "churn_triggers", "renewal", "repertoire", "problem_resolution", "expansion", "ecosystem", "advocacy"]);
  const head = JSON.parse(fs.readFileSync(`${OUT}/head.json`, "utf8"));
  const out: Record<string, unknown> = { arm: ARM, projects: {} };
  for (const p of projects) {
    const H = head.projects[p.brand];
    const keep = H.cells.map((c: any, i: number) => ({ c, i })).filter((x: any) => DP.has(x.c.stage));
    const common = { brand: p.brand, category: p.category, competitors: p.competitors, audience: p.audience, meta };
    const got: any = await inst.generatePhrasings({ ...common, base: H.base, scenarios: H.scenarios, cells: keep.map((x: any) => x.c), count: 10 });
    (out.projects as Record<string, unknown>)[p.brand] = {
      competitors: p.competitors,
      cells: keep.map((x: any) => x.c),
      phrasings: got,
    };
    console.log(`${p.brand}: ${keep.length} doubt/plan cells regenerated through checks`);
  }
  out.usage = await localUsage();
  fs.writeFileSync(`${OUT}/${ARM}.json`, JSON.stringify(out, null, 1));
  console.log(`wrote ${OUT}/${ARM}.json`);
} else if (ARM === "strictnum") {
  // Tightened seed-number A/B: same cells as head.json, fresh phrasings only.
  const head = JSON.parse(fs.readFileSync(`${OUT}/head.json`, "utf8"));
  const out: Record<string, unknown> = { arm: ARM, projects: {} };
  for (const p of projects) {
    const H = head.projects[p.brand];
    const common = { brand: p.brand, category: p.category, competitors: p.competitors, audience: p.audience, meta };
    const phr: unknown[][] = [];
    for (let i = 0; i < H.cells.length; i += 12) {
      const chunk = H.cells.slice(i, i + 12);
      const got: any = await inst.generatePhrasings({ ...common, base: H.base, scenarios: H.scenarios, cells: chunk, count: 10 });
      phr.push(...(Array.isArray(got) ? got : chunk.map(() => [])));
      console.log(`${p.brand}: ${Math.min(i + 12, H.cells.length)}/${H.cells.length}`);
    }
    (out.projects as Record<string, unknown>)[p.brand] = { competitors: p.competitors, base: H.base, scenarios: H.scenarios, stages: H.stages, cells: H.cells, phrasings: phr };
  }
  out.usage = await localUsage();
  fs.writeFileSync(`${OUT}/${ARM}.json`, JSON.stringify(out, null, 1));
  console.log(`wrote ${OUT}/${ARM}.json`);
} else if (ARM === "journey") {
  const journeys: Record<string, unknown> = {};
  for (const p of projects) {
    journeys[p.brand] = await inst.classifyJourney({ category: p.category, audience: p.audience });
    console.log(`journey ${p.brand}: done`);
  }
  fs.writeFileSync(`${OUT}/journeys.json`, JSON.stringify({ journeys, usage: await localUsage(), errors }, null, 1));
} else {
  const journeys = JSON.parse(fs.readFileSync(`${OUT}/journeys.json`, "utf8")).journeys;
  const out: Record<string, unknown> = { arm: ARM, projects: {} };
  for (const p of projects) {
    const t0 = Date.now();
    const base = journeys[p.brand];
    const read: any = await inst.readScenarios({ category: p.category, audience: p.audience, base, meta });
    console.log(`${p.brand} read: ${read.scenarios.length} scenarios`);
    const stages = inst.participationMask(read.base, read.scenarios);
    const recommended = stages.filter((s: { recommended: boolean }) => s.recommended);
    const common = { brand: p.brand, category: p.category, competitors: p.competitors, audience: p.audience, meta };
    const cells = await inst.generateGrid({ ...common, base: read.base, scenarios: read.scenarios, stages: recommended });
    const cellList = Array.isArray(cells) ? cells : [];
    console.log(`${p.brand} cells: ${cellList.length}`);
    // Full battery: 10 paraphrases per cell, in chunks to stay inside timeouts.
    const phr: unknown[][] = [];
    for (let i = 0; i < cellList.length; i += 12) {
      const chunk = cellList.slice(i, i + 12);
      const got: any = await inst.generatePhrasings({ ...common, base: read.base, scenarios: read.scenarios, cells: chunk, count: 10 });
      phr.push(...(Array.isArray(got) ? got : chunk.map(() => [])));
      console.log(`${p.brand} phrasings: ${Math.min(i + 12, cellList.length)}/${cellList.length}`);
    }
    (out.projects as Record<string, unknown>)[p.brand] = {
      secs: Math.round((Date.now() - t0) / 1000),
      competitors: p.competitors,
      base: read.base,
      scenarios: read.scenarios,
      stages: stages.map((s: any) => ({ key: s.key, label: s.label, recommended: s.recommended, tag: s.tag, hint: s.hint, rivals: s.rivals })),
      cells: cellList,
      phrasings: phr,
    };
  }
  out.usage = await localUsage();
  out.errors = errors;
  fs.writeFileSync(`${OUT}/${ARM}.json`, JSON.stringify(out, null, 1));
  console.log(`wrote ${OUT}/${ARM}.json`);
}
await closeProd();
process.exit(0);
