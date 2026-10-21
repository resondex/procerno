/**
 * Instrument helper jobs: gpt-5-mini vs gpt-6-luna (2026-10-21, Tyler's go).
 * INSTRUMENT_HELPER_MODEL drives seven setup-wizard jobs in instrument.ts;
 * gpt-5-mini shuts down on the API 2026-12-11. Each job is run on the five
 * October trackers' stored setup_decision (prod read only, per-query read-only
 * transactions), its cache bypassed (store stubbed: every read misses, every
 * write is dropped), every OpenAI call logged with its latency.
 *
 *   1. reviewCells on the offered seeds (answer key: seeds Tyler changed)
 *   2. reviewJourneyFit on the offered base read
 *   3. reviewScenarios on the decided rooms (original = the offered room)
 *   4. reviewScenarioFit on the offered rooms (raw advice + its own pre-check)
 *   5. suggestScenario / nearScenarios / rewordScenario, each generated room
 *      then checked once by the gate's room check (checkRooms - its own model,
 *      identical across arms)
 *
 * One process = one arm (model is import-time):
 *   mkdir -p /tmp/x && cd /tmp/x && INSTRUMENT_HELPER_MODEL=gpt-6-luna ARM=gpt-6-luna \
 *     npx tsx $REPO/scripts/internal_models_helpers.mts
 * Output internal_models/helpers/<ARM>.json; score with internal_models_helpers_score.mts.
 */
import fs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { ARM, RUNS, REPO, closeProd, errors, localUsage, outDir, prod } from "./internal_models_common.mts";

const inst = await import(`${REPO}/src/lib/engine/instrument`);
const { store } = await import(`${REPO}/src/lib/store`);
const models = await import(`${REPO}/src/lib/engine/models`);
const { openaiClient } = await import(`${REPO}/src/lib/engine/providers`);

// Cache bypass: every read misses, nothing is written.
Object.assign(store as object, {
  cacheGet: async () => null,
  cacheGetMany: async () => new Map(),
  cacheSet: async () => {},
  cacheClaim: async () => true,
});

// Every OpenAI call (the helper model) is logged under the job that made it.
type CallLog = { job: string; tracker: string; system: string; ms: number; ok: boolean; content: string | null };
const calls: CallLog[] = [];
const ctx = new AsyncLocalStorage<{ job: string; tracker: string }>();
const client = openaiClient();
const origCreate = client.chat.completions.create.bind(client.chat.completions);
(client.chat.completions as { create: unknown }).create = async (body: { messages?: { role: string; content: unknown }[] }, opts?: unknown) => {
  const c = ctx.getStore() ?? { job: "?", tracker: "?" };
  const sys = String(body.messages?.find((m) => m.role === "system")?.content ?? "").slice(0, 60);
  const t0 = Date.now();
  try {
    const res = await origCreate(body as never, opts as never);
    calls.push({ job: c.job, tracker: c.tracker, system: sys, ms: Date.now() - t0, ok: true, content: (res as any).choices?.[0]?.message?.content ?? null });
    return res;
  } catch (err) {
    calls.push({ job: c.job, tracker: c.tracker, system: sys, ms: Date.now() - t0, ok: false, content: String((err as Error).message).slice(0, 200) });
    throw err;
  }
};

type Room = { label: string; description: string };
const TRACKERS: Record<string, string> = {
  "American Express": "da86924c-8cc8-4a9c-a03e-a139f1f0854f",
  Jira: "a3fd8d2c-2076-4f50-9e85-ad6b9902b448",
  "Google Pixel": "87ccf81c-5b0e-4765-a969-19b9c4dc4d5d",
  Netflix: "a361b767-182c-4229-9e3c-a62457c30c5b",
  Doritos: "aabb35e0-dc07-4366-bc3b-a1058f0a3e79",
};
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;

const words = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 2));
const jac = (a: Set<string>, b: Set<string>) => {
  const i = [...a].filter((x) => b.has(x)).length;
  return i / Math.max(1, a.size + b.size - i);
};

async function run<T>(job: string, tracker: string, fn: () => Promise<T>): Promise<{ ms: number; value: T | null; error?: string }> {
  return ctx.run({ job, tracker }, async () => {
    const t0 = Date.now();
    try {
      const value = await fn();
      return { ms: Date.now() - t0, value };
    } catch (err) {
      return { ms: Date.now() - t0, value: null, error: (err as Error).message.slice(0, 200) };
    }
  });
}

const ids = Object.values(TRACKERS);
const rows = await prod`SELECT id, brand, category, audience, competitors, setup_decision FROM projects WHERE id = ANY(${ids})`;

const out: Record<string, any> = { arm: ARM, helperModel: models.INSTRUMENT_HELPER_MODEL, runs: RUNS, trackers: {} };

async function oneTracker(r: any) {
  const brand = r.brand as string;
  if (ONLY && !ONLY.includes(brand)) return;
  const d = JSON.parse(r.setup_decision);
  const category = r.category as string;
  const audience = (r.audience as string | null) ?? null;
  const competitors = JSON.parse(r.competitors) as string[];
  const base = d.base.offered ?? d.base.decided;
  const stages = new Map((inst.stageLibrary(d.base.decided) as any[]).map((s) => [s.key, s]));
  const decidedRooms: (Room & { how: string })[] = d.rooms.decided;
  const offeredRooms: Room[] = d.rooms.offered;
  const reserve: Room[] = d.rooms.reserve ?? [];
  const roomDesc = new Map(decidedRooms.map((x) => [x.label, x.description]));
  const res: any = { brand, category, audience, competitors, jobs: {} };

  // ---- 1. reviewCells on the offered seeds (class cells skipped: the
  // decision record does not keep their class phrase).
  const cells = (d.cells as any[]).filter((c) => c.angle !== "class" && c.seed?.offered);
  const candidates = cells.map((c) => {
    const st = stages.get(c.stage);
    return {
      text: c.seed.offered, original: null, stage: st?.label ?? c.stage, stageKey: c.stage,
      hint: st?.hint ?? null, tag: st?.tag ?? null, situation: c.situation ?? null,
      situationDescription: c.situation ? roomDesc.get(c.situation) ?? null : null,
      angle: c.angle, mode: null,
    };
  });
  res.cells = cells.map((c) => ({
    stage: c.stage, situation: c.situation, angle: c.angle, offered: c.seed.offered, decided: c.seed.decided, how: c.seed.how,
    changed: c.seed.how !== "offered" || c.seed.offered.trim() !== c.seed.decided.trim(),
  }));
  res.skippedClassCells = (d.cells as any[]).filter((c) => c.angle === "class").length;
  res.jobs.reviewCells = [];
  for (let k = 0; k < RUNS; k++) {
    const verdicts: any[] = [];
    let ms = 0; const errs: string[] = [];
    for (let i = 0; i < candidates.length; i += 24) {
      const batch = candidates.slice(i, i + 24);
      const x = await run("reviewCells", brand, () => inst.reviewCells({ brand, category, competitors, audience, candidates: batch }));
      ms += x.ms;
      if (x.error) errs.push(x.error);
      verdicts.push(...((x.value as any[]) ?? batch.map(() => null)));
    }
    res.jobs.reviewCells.push({ ms, errors: errs, verdicts: verdicts.map((v) => v && { flags: v.flags, reason: v.reason, suggestion: v.suggestion }) });
  }
  console.log(`${ARM} ${brand}: reviewCells done`);

  // ---- 2. reviewJourneyFit on the offered base.
  res.stages = { recommended: d.stages.recommended, kept: d.stages.kept };
  res.base = { offered: d.base.offered, decided: d.base.decided };
  res.jobs.reviewJourneyFit = [];
  for (let k = 0; k < RUNS; k++) {
    const x = await run("reviewJourneyFit", brand, () => inst.reviewJourneyFit({ brand, category, base }));
    res.jobs.reviewJourneyFit.push({ ms: x.ms, error: x.error, fit: x.value });
  }
  console.log(`${ARM} ${brand}: journey fit done`);

  // ---- 3. reviewScenarios on the decided rooms. `original` = the offered
  // room each came from: same label, else (edited / reworded / near rooms)
  // the unmatched offered room with the most word overlap.
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
  res.decidedRooms = roomCands.map((c, i) => ({ ...c, how: decidedRooms[i].how }));
  res.jobs.reviewScenarios = [];
  for (let k = 0; k < RUNS; k++) {
    // All decided rooms as candidates (more data than the gate's
    // edited-only call; each candidate still sees the others in the list).
    const x = await run("reviewScenarios", brand, () => inst.reviewScenarios({ category, audience, candidates: roomCands, others: [] }));
    res.jobs.reviewScenarios.push({ ms: x.ms, error: x.error, verdicts: x.value });
  }
  // The gate's own shape: only edited / own rooms, the rest as others.
  const authored = roomCands.filter((_, i) => decidedRooms[i].how !== "offered");
  res.jobs.reviewScenariosGate = [];
  if (authored.length > 0) {
    const others = roomCands.filter((_, i) => decidedRooms[i].how === "offered").map(({ label, description }) => ({ label, description }));
    for (let k = 0; k < RUNS; k++) {
      const x = await run("reviewScenarios", brand, () => inst.reviewScenarios({ category, audience, candidates: authored, others }));
      res.jobs.reviewScenariosGate.push({ ms: x.ms, error: x.error, candidates: authored.map((a) => a.label), verdicts: x.value });
    }
  }
  console.log(`${ARM} ${brand}: scenario review done`);

  // ---- 4. reviewScenarioFit on the offered rooms; the raw model advice and
  // its internal reviewScenarios pre-check are read from the call log.
  res.offeredRooms = offeredRooms;
  res.jobs.reviewScenarioFit = [];
  for (let k = 0; k < RUNS; k++) {
    const before = calls.length;
    const x = await run("reviewScenarioFit", brand, () => inst.reviewScenarioFit({ brand, category, audience, scenarios: offeredRooms }));
    const mine = calls.slice(before).filter((c) => c.job === "reviewScenarioFit" && c.tracker === brand);
    const raw = mine.find((c) => c.system.startsWith("You check whether buying scenarios fit"));
    const pre = mine.find((c) => c.system.startsWith("Quality-check buying scenarios"));
    let rawParsed: any = null; let preParsed: any = null;
    try { rawParsed = raw?.content ? JSON.parse(raw.content) : null; } catch { /* keep null */ }
    try { preParsed = pre?.content ? JSON.parse(pre.content) : null; } catch { /* keep null */ }
    res.jobs.reviewScenarioFit.push({ ms: x.ms, error: x.error, fit: x.value, raw: rawParsed, precheck: preParsed });
  }
  console.log(`${ARM} ${brand}: scenario fit done`);

  // ---- 5. generative jobs on the decided rooms.
  const table: Room[] = [];
  for (const s of [...decidedRooms, ...offeredRooms, ...reserve]) if (!table.some((t) => t.label === s.label)) table.push({ label: s.label, description: s.description });
  const gen: { job: string; of: string | null; room: Room; ms: number }[] = [];
  res.jobs.suggestScenario = [];
  const SUGGEST_N = Number(process.env.SUGGEST_N ?? 3);
  for (let k = 0; k < SUGGEST_N; k++) {
    const x = await run("suggestScenario", brand, () => inst.suggestScenario({ category, audience, decisionUnit: base.decision_unit, exclude: table }));
    res.jobs.suggestScenario.push({ ms: x.ms, error: x.error, room: x.value });
    if (x.value) gen.push({ job: "suggestScenario", of: null, room: x.value as Room, ms: x.ms });
  }
  res.jobs.nearScenarios = [];
  res.jobs.rewordScenario = [];
  for (const of of decidedRooms) {
    const ofRoom = { label: of.label, description: of.description };
    const x = await run("nearScenarios", brand, () => inst.nearScenarios({ category, audience, of: ofRoom, exclude: table }));
    res.jobs.nearScenarios.push({ ms: x.ms, error: x.error, of: of.label, rooms: x.value });
    for (const v of ((x.value as Room[]) ?? [])) gen.push({ job: "nearScenarios", of: of.label, room: v, ms: x.ms });
    const y = await run("rewordScenario", brand, () => inst.rewordScenario({ category, audience, of: ofRoom, avoid: [] }));
    res.jobs.rewordScenario.push({ ms: y.ms, error: y.error, of: of.label, room: y.value });
    if (y.value) gen.push({ job: "rewordScenario", of: of.label, room: y.value as Room, ms: y.ms });
  }
  console.log(`${ARM} ${brand}: generated ${gen.length} rooms`);

  // Gate room check, once per generated room (batches of 8; labels made
  // unique so verdicts map back). Rivals = the tracker's competitors (the
  // roster roles and head-to-head picks are not stored on the project).
  const checked: any[] = [];
  for (let i = 0; i < gen.length; i += 8) {
    const batch = gen.slice(i, i + 8).map((g, j) => ({ ...g, key: `${g.room.label} [${i + j + 1}]` }));
    const x = await run("checkRooms", brand, () => inst.checkRooms({
      brand, category, rivals: competitors,
      rooms: batch.map((b) => ({ label: b.key, description: b.room.description })),
    }));
    const by = new Map(((x.value as any[]) ?? []).map((c) => [c.label, c]));
    for (const b of batch) checked.push({ job: b.job, of: b.of, room: b.room, check: by.get(b.key) ?? null });
  }
  res.generated = checked;
  out.trackers[brand] = res;
  console.log(`${ARM} ${brand}: done`);
}

await Promise.all(rows.map((r) => oneTracker(r).catch((e) => { errors.push(`${r.brand}: ${(e as Error).message}`); console.error(r.brand, e); })));

out.calls = calls.map(({ content, ...c }) => ({ ...c, contentChars: content?.length ?? 0 }));
out.usage = await localUsage();
try {
  const { default: Database } = await import(`${REPO}/node_modules/better-sqlite3/lib/index.js`);
  const db = new Database(`${process.cwd()}/data/answerpoll.db`, { readonly: true });
  out.costByModel = db.prepare("SELECT model, purpose, count(*) calls, sum(cost_usd) cost FROM cost_log GROUP BY model, purpose").all();
  db.close();
} catch (e) { out.costByModel = String(e); }
out.errors = errors;
fs.writeFileSync(`${outDir("helpers")}/${ARM}.json`, JSON.stringify(out, null, 1));
await closeProd();
process.exit(0);
