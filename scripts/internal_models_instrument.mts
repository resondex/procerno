/**
 * Test G - setup instrument: the market read (READ_MODEL), grid cells
 * (CELLS_MODEL) and the helper jobs (INSTRUMENT_HELPER_MODEL: scenario
 * review / fit / suggest / near, journey fit, cell review, phrasings), the
 * real functions, on jira, Netflix and AG1 (a not-yet-collected fleet
 * brand). Local store only (fresh caches per arm directory).
 *
 * The Opus base journey is classified ONCE per project (ARM=journey) and
 * handed to both arms via readScenarios({ base }), so the arms differ only
 * in the models under test.
 *   ARM=journey                        -> internal_models/instrument/journeys.json
 *   ARM=<name> READ_MODEL=.. CELLS_MODEL=.. INSTRUMENT_HELPER_MODEL=..
 *                                      -> internal_models/instrument/<ARM>.json
 */
import fs from "node:fs";
import { ARM, closeProd, errors, localUsage, outDir, trackers, REPO } from "./internal_models_common.mts";

const inst = await import(`${REPO}/src/lib/engine/instrument`);
const OUT = outDir("instrument");
const projects = await trackers(["jira", "Netflix", "AG1"]);
const meta = { source: "eval:internal_models" };

if (ARM === "journey") {
  const journeys: Record<string, unknown> = {};
  for (const p of projects) {
    journeys[p.brand] = await inst.classifyJourney({ category: p.category, audience: p.audience });
    console.log(`journey ${p.brand}: done`);
  }
  fs.writeFileSync(`${OUT}/journeys.json`, JSON.stringify({ journeys, usage: await localUsage(), errors }, null, 1));
} else {
  const journeys = JSON.parse(fs.readFileSync(`${OUT}/journeys.json`, "utf8")).journeys;
  const out: Record<string, unknown> = {
    arm: ARM,
    models: { read: process.env.READ_MODEL, cells: process.env.CELLS_MODEL, helper: process.env.INSTRUMENT_HELPER_MODEL },
    projects: {},
  };
  for (const p of projects) {
    const t0 = Date.now();
    const base = journeys[p.brand];
    const step = async <T,>(name: string, f: () => Promise<T>): Promise<T | { error: string }> => {
      const s = Date.now();
      try { const r = await f(); console.log(`${ARM} ${p.brand} ${name}: ${((Date.now() - s) / 1000).toFixed(0)}s`); return r; }
      catch (e) { console.log(`${ARM} ${p.brand} ${name}: FAILED ${(e as Error).message.slice(0, 200)}`); return { error: (e as Error).message.slice(0, 300) }; }
    };
    const read: any = await step("read", () => inst.readScenarios({ category: p.category, audience: p.audience, base, meta }));
    if (!read || "error" in read) { (out.projects as Record<string, unknown>)[p.brand] = { read }; continue; }
    const stages = inst.participationMask(read.base, read.scenarios);
    const recommended = stages.filter((s: { recommended: boolean }) => s.recommended);
    const common = { brand: p.brand, category: p.category, competitors: p.competitors, audience: p.audience, meta };
    const cells = await step("cells", () => inst.generateGrid({ ...common, base: read.base, scenarios: read.scenarios, stages: recommended }));
    const cellList = Array.isArray(cells) ? cells : [];
    const stageOf = (key: string) => stages.find((s: { key: string; label: string }) => s.key === key || s.label === key);
    const reviewSample = cellList.filter((_: unknown, i: number) => i % Math.max(1, Math.floor(cellList.length / 20)) === 0).slice(0, 20);
    const situations = read.scenarios.map((s: { label: string; description: string }) => ({ label: s.label, description: s.description }));
    const [cellReview, scenarioReview, scenarioFit, journeyFit, suggested, near, phrasings] = await Promise.all([
      step("cell_review", () => inst.reviewCells({
        ...common,
        candidates: reviewSample.map((c: { text: string; stage: string; situation: string | null; angle: string; mode: string | null }) => {
          const st = stageOf(c.stage);
          const sit = read.scenarios.find((s: { label: string }) => s.label === c.situation);
          return { text: c.text, original: null, stage: st?.label ?? c.stage, hint: st?.hint ?? null, tag: st?.tag ?? null,
            situation: c.situation, situationDescription: sit?.description ?? null, angle: c.angle, mode: c.mode };
        }),
      })),
      step("scenario_review", () => inst.reviewScenarios({ category: p.category, audience: p.audience, candidates: situations, others: [], meta })),
      step("scenario_fit", () => inst.reviewScenarioFit({ brand: p.brand, category: p.category, scenarios: situations, meta })),
      step("journey_fit", () => inst.reviewJourneyFit({ brand: p.brand, category: p.category, base: read.base, meta })),
      step("scenario_suggest", () => inst.suggestScenario({ category: p.category, audience: p.audience, decisionUnit: read.base.decision_unit, exclude: situations, meta })),
      step("scenario_near", () => inst.nearScenarios({ category: p.category, audience: p.audience, of: situations[0], exclude: situations, meta })),
      step("phrasings", () => inst.generatePhrasings({ ...common, base: read.base, scenarios: read.scenarios, cells: cellList.slice(0, 12), count: 10 })),
    ]);
    (out.projects as Record<string, unknown>)[p.brand] = {
      secs: Math.round((Date.now() - t0) / 1000),
      read, stages: stages.map((s: { key: string; label: string; recommended: boolean }) => ({ key: s.key, label: s.label, recommended: s.recommended })),
      cells, reviewSample, cellReview, scenarioReview, scenarioFit, journeyFit, suggested, near, phrasings,
    };
  }
  out.usage = await localUsage();
  out.errors = errors;
  fs.writeFileSync(`${OUT}/${ARM}.json`, JSON.stringify(out, null, 1));
}
await closeProd();
process.exit(0);
