/**
 * Setup-engine model round, steps 1-3 (SETUP_ENGINE_MODEL_PLAN_2026-10-22,
 * Tyler's go): roster, market read and worry planner on the four arms -
 * gpt-5 (baseline), gpt-5.6-sol (OpenAI's named replacement), gpt-6-sol,
 * gpt-6-luna. The cell writer (step 4) runs separately via cold_walk
 * FIXED_CTX_DIR + FIXED_ROOMS, where the gpt-5 baseline already exists
 * (internal_models/helpers/cold_luna).
 *
 * Per October tracker (prod read-only), RUNS times each:
 *   - classifyRoster on the project's brand/category/audience/competitors;
 *   - readScenarios with the tracker's DECIDED base journey passed in (the
 *     Opus journey classify is skipped, so the arm varies ONLY the read);
 *     each draw's rooms judged once by the gate's checkRooms (sonnet,
 *     identical across arms; rivals = the full competitor list, no picks);
 *   - generateWorries against the tracker's DECIDED rooms and the mask's
 *     offered doubt stances - the decided worries in setup_decision are the
 *     answer key.
 * No per-job effort is sent, same as prod (the four jobs run their vendor
 * default) - effort is a second lever to sweep on the winner, not here.
 *
 * One process = one arm (models are import-time):
 *   ARM=gpt-5 READ_MODEL=gpt-5 CONCERNS_MODEL=gpt-5 ROSTER_MODEL=gpt-5 \
 *     npx tsx scripts/setup_engine_round.mts
 * Output internal_models/setup_engine/<ARM>.json.
 */
import fs from "node:fs";
import { ARM, RUNS, REPO, closeProd, errors, outDir, prod } from "./internal_models_common.mts";

const inst = await import(`${REPO}/src/lib/engine/instrument`);
const { classifyRoster } = await import(`${REPO}/src/lib/engine/roster.ts`);
const { store } = await import(`${REPO}/src/lib/store`);

// Cache bypass: every read misses, nothing is written.
Object.assign(store as object, {
  cacheGet: async () => null,
  cacheGetMany: async () => new Map(),
  cacheSet: async () => {},
  cacheClaim: async () => true,
});

const TRACKERS: Record<string, string> = {
  "American Express": "da86924c-8cc8-4a9c-a03e-a139f1f0854f",
  Jira: "a3fd8d2c-2076-4f50-9e85-ad6b9902b448",
  "Google Pixel": "87ccf81c-5b0e-4765-a969-19b9c4dc4d5d",
  Netflix: "a361b767-182c-4229-9e3c-a62457c30c5b",
  Doritos: "aabb35e0-dc07-4366-bc3b-a1058f0a3e79",
};
const JOBS = (process.env.JOBS ?? "roster,read,worries").split(",");

const ids = Object.values(TRACKERS);
const rows = await prod`SELECT id, brand, category, audience, competitors, setup_decision FROM projects WHERE id = ANY(${ids})`;

const out: Record<string, any> = {
  arm: ARM,
  models: { read: process.env.READ_MODEL ?? "gpt-5", concerns: process.env.CONCERNS_MODEL ?? "gpt-5", roster: process.env.ROSTER_MODEL ?? "gpt-5" },
  runs: RUNS,
  trackers: {},
};

for (const r of rows) {
  const brand = r.brand as string;
  const category = r.category as string;
  const audience = (r.audience as string | null) ?? null;
  const competitors = JSON.parse(r.competitors) as string[];
  const sd = JSON.parse(r.setup_decision);
  const base = sd.base.decided ?? sd.base.offered;
  const decidedRooms = (sd.rooms.decided as { label: string; description: string }[]).map(
    ({ label, description }) => ({ label, description, journey: null })
  );
  const res: any = { brand, category, audience, competitors, roster: [], read: [], worries: [] };
  const t0 = Date.now();

  if (JOBS.includes("roster")) {
    for (let k = 0; k < RUNS; k++) {
      try {
        const v = await classifyRoster({ brand, category, audience, competitors });
        res.roster.push({
          clientParent: v.clientParent ?? null,
          competitors: v.competitors.map((c: any) => ({
            name: c.name, role: c.role, h2hRank: c.h2hRank ?? null, h2hReason: c.h2hReason ?? null,
            parent: c.parent ?? null, inCategory: c.inCategory ?? null,
            consumerSalient: c.consumerSalient ?? null, classPhrase: c.classPhrase ?? null,
          })),
        });
      } catch (err) {
        res.roster.push({ error: (err as Error).message.slice(0, 200) });
      }
    }
    console.log(`${ARM} ${brand}: roster done`);
  }

  if (JOBS.includes("read")) {
    const directRivals = competitors;
    for (let k = 0; k < RUNS; k++) {
      try {
        const v = await inst.readScenarios({ category, audience, base });
        if (!v) { res.read.push({ error: "null read" }); continue; }
        const rooms = v.scenarios.map((s: any) => ({ label: s.label, description: s.description, journey: s.journey ?? null, journeyWhy: s.journeyWhy ?? null }));
        let checks: any[] = [];
        try {
          checks = await inst.checkRooms({ brand, category, rivals: directRivals, picks: [], rooms: rooms.map((x: any) => ({ label: x.label, description: x.description })) });
        } catch (err) {
          console.error("room check failed:", (err as Error).message.slice(0, 120));
        }
        res.read.push({
          rooms,
          reserve: (v.reserve ?? []).map((s: any) => ({ label: s.label, description: s.description })),
          checks: (checks ?? []).map((c: any) => ({ label: c.label ?? null, contested: c.contested ?? null, flags: ["pitch", "capability", "platformSwitch", "noChoice", "clientLead"].filter((f) => c[f]), names: c.names ?? [] })),
        });
      } catch (err) {
        res.read.push({ error: (err as Error).message.slice(0, 200) });
      }
    }
    console.log(`${ARM} ${brand}: read done`);
  }

  if (JOBS.includes("worries")) {
    const offered = inst.participationMask(base, decidedRooms)
      .filter((st: any) => st.recommended && ["objections", "churn_triggers", "renewal"].includes(st.key))
      .map((st: any) => st.key);
    res.offeredStances = offered;
    res.decidedWorries = sd.worries.decided ?? [];
    for (let k = 0; k < RUNS; k++) {
      try {
        const pool = await inst.generateWorries({ brand, category, audience, scenarios: decidedRooms, offered });
        res.worries.push({
          pool: (pool ?? []).map((w: any) => ({ worry: w.worry, subject: w.subject ?? null, recommended: w.recommended ?? null, recommend: w.recommend ?? null, overlaps: w.overlaps ?? null })),
        });
      } catch (err) {
        res.worries.push({ error: (err as Error).message.slice(0, 200) });
      }
    }
    console.log(`${ARM} ${brand}: worries done`);
  }

  res.ms = Date.now() - t0;
  out.trackers[brand] = res;
}

out.errors = errors;
const dir = outDir("setup_engine");
fs.writeFileSync(`${dir}/${ARM}.json`, JSON.stringify(out, null, 1));
console.log(`wrote ${dir}/${ARM}.json`);
await closeProd();
process.exit(0);
