/**
 * reviewScenarios "mixed" prompt round (2026-10-21, Tyler's go). The helpers
 * bakeoff left reviewScenarios on gpt-5-mini: gpt-6-luna flags 32% of
 * Tyler-confirmed rooms, mostly "mixed" on rooms whose ONE buyer carries two
 * details. Candidate fix: one sentence (SCENARIO_MIXED_RULE=1 in
 * instrument.ts) drawing the mixed line at two DIFFERENT buyers.
 *
 * Per tracker (the five October trackers' setup_decision, prod read-only):
 *   - decided rooms as candidates, RUNS times (same inputs as the bakeoff's
 *     section 3 - every decided room is Tyler-confirmed, so a flag is a
 *     likely false alarm);
 *   - two PLANTED probes (two decided rooms' descriptions fused = a genuine
 *     two-buyer room), RUNS times, decided rooms as others - the
 *     sensitivity floor: the rule must not stop the checker catching these.
 *
 * One process = one arm (SCENARIO_REVIEW_MODEL is import-time):
 *   ARM=mini      SCENARIO_REVIEW_MODEL=gpt-5-mini  npx tsx scripts/scenario_review_round.mts
 *   ARM=luna      SCENARIO_REVIEW_MODEL=gpt-6-luna  npx tsx scripts/scenario_review_round.mts
 *   ARM=luna-rule SCENARIO_REVIEW_MODEL=gpt-6-luna SCENARIO_MIXED_RULE=1 npx tsx scripts/scenario_review_round.mts
 * Output internal_models/helpers/mixed_round/<ARM>.json; score with
 * scenario_review_round_score.mts.
 */
import fs from "node:fs";
import { ARM, RUNS, REPO, closeProd, errors, outDir, prod } from "./internal_models_common.mts";

const inst = await import(`${REPO}/src/lib/engine/instrument`);
const { store } = await import(`${REPO}/src/lib/store`);
const models = await import(`${REPO}/src/lib/engine/models`);

// Cache bypass: every read misses, nothing is written.
Object.assign(store as object, {
  cacheGet: async () => null,
  cacheGetMany: async () => new Map(),
  cacheSet: async () => {},
  cacheClaim: async () => true,
});

type Room = { label: string; description: string };
const TRACKERS: Record<string, string> = {
  "American Express": "da86924c-8cc8-4a9c-a03e-a139f1f0854f",
  Jira: "a3fd8d2c-2076-4f50-9e85-ad6b9902b448",
  "Google Pixel": "87ccf81c-5b0e-4765-a969-19b9c4dc4d5d",
  Netflix: "a361b767-182c-4229-9e3c-a62457c30c5b",
  Doritos: "aabb35e0-dc07-4366-bc3b-a1058f0a3e79",
};

const words = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 2));
const jac = (a: Set<string>, b: Set<string>) => {
  const i = [...a].filter((x) => b.has(x)).length;
  return i / Math.max(1, a.size + b.size - i);
};

const ids = Object.values(TRACKERS);
const rows = await prod`SELECT id, brand, category, audience, setup_decision FROM projects WHERE id = ANY(${ids})`;

const out: Record<string, any> = { arm: ARM, model: models.SCENARIO_REVIEW_MODEL, mixedRule: process.env.SCENARIO_MIXED_RULE === "1", runs: RUNS, trackers: {} };

for (const r of rows) {
  const brand = r.brand as string;
  const d = JSON.parse(r.setup_decision);
  const category = r.category as string;
  const audience = (r.audience as string | null) ?? null;
  const decidedRooms: (Room & { how: string })[] = d.rooms.decided;
  const offeredRooms: Room[] = d.rooms.offered;

  // `original` mapping copied from the bakeoff runner (section 3): same
  // label, else the unmatched offered room with the most word overlap.
  const unmatched = [...offeredRooms];
  const take = (o: Room) => unmatched.splice(unmatched.indexOf(o), 1);
  const origOf = new Map<string, Room | null>();
  for (const x of decidedRooms) {
    const same = unmatched.find((o) => o.label.trim() === x.label.trim());
    if (same) { take(same); origOf.set(x.label, x.how === "offered" ? null : same); }
  }
  for (const x of decidedRooms) {
    if (origOf.has(x.label)) continue;
    if (x.how === "own") { origOf.set(x.label, null); continue; }
    const w = words(`${x.label} ${x.description}`);
    const best = [...unmatched].sort((a, b) => jac(words(`${b.label} ${b.description}`), w) - jac(words(`${a.label} ${a.description}`), w))[0] ?? null;
    if (best) take(best);
    origOf.set(x.label, best);
  }
  const roomCands = decidedRooms.map((x) => ({ label: x.label, description: x.description, original: origOf.get(x.label) ?? null }));

  // Planted two-buyer probes: fuse two decided rooms' descriptions. The
  // label stays neutral so only the description carries the defect.
  const probePairs = [[0, 1], [decidedRooms.length - 2, decidedRooms.length - 1]].filter(
    ([a, b], i, all) => a >= 0 && b > a && (i === 0 || String(all[0]) !== String([a, b]))
  );
  const probes = probePairs.map(([a, b], i) => ({
    label: `Combined situation ${i + 1}`,
    description: `${decidedRooms[a].description.replace(/\.$/, "")}. ${decidedRooms[b].description}`,
    original: null,
    fusedFrom: [decidedRooms[a].label, decidedRooms[b].label],
  }));

  const res: any = {
    brand, category, audience,
    decidedRooms: roomCands.map((c, i) => ({ label: c.label, how: decidedRooms[i].how })),
    probes: probes.map((p) => ({ label: p.label, fusedFrom: p.fusedFrom, description: p.description })),
    confirmed: [], planted: [],
  };

  for (let k = 0; k < RUNS; k++) {
    try {
      const v = await inst.reviewScenarios({ category, audience, candidates: roomCands, others: [] });
      res.confirmed.push({ verdicts: v });
    } catch (err) {
      res.confirmed.push({ error: (err as Error).message.slice(0, 200) });
    }
  }
  for (let k = 0; k < RUNS; k++) {
    try {
      const v = await inst.reviewScenarios({
        category, audience,
        candidates: probes.map(({ label, description, original }) => ({ label, description, original })),
        others: roomCands.map(({ label, description }) => ({ label, description })),
      });
      res.planted.push({ verdicts: v });
    } catch (err) {
      res.planted.push({ error: (err as Error).message.slice(0, 200) });
    }
  }
  out.trackers[brand] = res;
  console.log(`${ARM} ${brand}: done`);
}

out.errors = errors;
const dir = outDir("helpers/mixed_round");
fs.writeFileSync(`${dir}/${ARM}.json`, JSON.stringify(out, null, 1));
console.log(`wrote ${dir}/${ARM}.json`);
await closeProd();
process.exit(0);
