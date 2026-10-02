/**
 * Zero-spend verification of the terminal-state + heartbeat serve logic
 * in generateGrid (2026-09-30). No DATABASE_URL (local sqlite under this
 * scratchpad's cwd), no API keys - ANY model call throws, so a case that
 * returns cells proves no generation ran.
 *
 * Cases:
 *  1 terminal-flagged unit serves as-is (the init-stall loop is dead)
 *  2 legacy bare-array unit that passes today's rules upgrades in place,
 *    no model call, entry rewritten as {cells, rules}
 *  3 old-era unit failing today's rules regenerates once (generation
 *    attempted -> key error -> markers released, null returned fast)
 *  4 a 60s-old pending marker is orphaned immediately (old code trusted
 *    it for 180s) - takeover attempted, fast null, markers released
 *  5 a fresh pending marker with noWait returns pending without claiming
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = "/Users/tylersolloway/Documents/GitHub/procerno";
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
// The sqlite store writes to <cwd>/data - run in a temp dir so the
// harness never touches the repo's dev database.
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "procerno-serve-harness-")));

const inst = await import(`${REPO}/src/lib/engine/instrument.ts`);
const bc = await import(`${REPO}/src/lib/engine/battery_checks.ts`);
const { store } = await import(`${REPO}/src/lib/store/index.ts`);

const base = {
  verifiability: "spec", involvement: "considered", think_feel: "think",
  decision_unit: "solo", rhythm: "one_shot", risk: "performance",
  channel_retail: false, rationale: "harness",
};
const scenarios = [{ label: "Small team lead", description: "Leads a small team of five", journey: null }];
const masked = inst.participationMask(base, scenarios as never);
const stages = masked.filter((s: { recommended: boolean; key: string }) =>
  s.recommended && !bc.DOUBT_CHECK_STAGES.has(s.key)).slice(0, 2);
const plan = inst.planGridCells(stages, scenarios.map((s: { label: string }) => s.label), bc.angleRivals([]), []);
const keyArgs = {
  brand: "Acme", category: "project management software", competitors: [],
  audience: null, base, scenarios,
};
const keys: string[] = plan.map((r: {
  stage: { key: string }; situation: string | null; angle: string; scope: string | null;
  concern?: string | null; classPhrase?: string | null; classBrand?: string | null;
}) => inst.gridCellCacheKey(keyArgs, {
  stage: r.stage.key, situation: r.situation, angle: r.angle, scope: r.scope,
  concern: r.concern ?? null, classPhrase: r.classPhrase ?? null, classBrand: r.classBrand ?? null,
}));
if (keys.length !== 2) throw new Error(`expected 2 plan rows, got ${keys.length}`);

const prRow = plan.find((r: { stage: { key: string } }) => r.stage.key === "problem_recognition");
const ceRow = plan.find((r: { stage: { key: string } }) => r.stage.key === "category_education");
const keyOf = (r: unknown) => keys[plan.indexOf(r)];

const cellOf = (r: { stage: { key: string; layer: string }; situation: string | null; angle: string; scope: string | null }, text: string, flags?: string[]) => ({
  stage: r.stage.key, layer: r.stage.layer, situation: r.situation,
  angle: r.angle, mode: r.scope ?? null, text,
  ...(flags ? { seedFlags: flags } : {}),
});

// Passing texts: blind (never name Acme), CE speaks the category noun,
// PR is pre-category exempt; neither copies the scenario label.
const PR_PASS = "My team keeps missing deadlines and nobody knows who owns what. How do people get a handle on this?";
const CE_PASS = "What should I know before choosing project management software for the first time?";
// Failing texts: PR names the forbidden target brand; CE never speaks the category.
const PR_FAIL = "Is Acme the reason my team keeps missing deadlines?";
const CE_FAIL = "What should I know before choosing one of these tools for the first time?";

const gridInput = () => ({
  brand: "Acme", category: "project management software", competitors: [],
  audience: null, base, scenarios, stages, meta: { source: "harness" },
});

const RULES = inst.SEED_RULES_VERSION;
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

// --- case 1: terminal-flagged unit serves as-is, no model call ---
await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_FAIL, ["names the target brand"])], rules: RULES }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_FAIL, ["blind seed never speaks the category"])], rules: RULES }), {});
let t0 = Date.now();
let out = await inst.generateGrid(gridInput());
let ms = Date.now() - t0;
check("1 terminal-flagged serves as-is", Array.isArray(out) && out.length === 2 &&
  out.some((c: { text: string }) => c.text === PR_FAIL) && out.some((c: { text: string }) => c.text === CE_FAIL),
  `(${ms}ms, cells=${out?.length ?? "null"})`);
check("1 flags survive the serve", Array.isArray(out) && out.every((c: { seedFlags?: string[] }) => (c.seedFlags?.length ?? 0) > 0));
check("1 no wait, no generation", ms < 5_000, `(${ms}ms)`);

// --- case 2: legacy bare array, passing -> upgraded in place ---
await store.cacheSet(keyOf(prRow), JSON.stringify([cellOf(prRow, PR_PASS)]), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify([cellOf(ceRow, CE_PASS)]), {});
t0 = Date.now();
out = await inst.generateGrid(gridInput());
ms = Date.now() - t0;
check("2 legacy passing serves without regeneration", Array.isArray(out) && out.length === 2 &&
  out.some((c: { text: string }) => c.text === PR_PASS) && out.some((c: { text: string }) => c.text === CE_PASS),
  `(${ms}ms, cells=${out?.length ?? "null"})`);
const raw2 = await Promise.all(keys.map((k) => store.cacheGet(k, 365 * 24 * 3600 * 1000)));
check("2 entries upgraded to {cells, rules}", raw2.every((r) => {
  try { const v = JSON.parse(r ?? ""); return !Array.isArray(v) && v.rules === RULES && Array.isArray(v.cells); } catch { return false; }
}));

// --- case 3: old-era failing -> one regeneration attempt (throws on key), markers released ---
await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_FAIL)], rules: "r0" }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_PASS)], rules: "r0" }), {});
t0 = Date.now();
out = await inst.generateGrid(gridInput());
ms = Date.now() - t0;
const raw3 = await store.cacheGet(keyOf(prRow), 365 * 24 * 3600 * 1000);
let released3 = false;
try { released3 = JSON.parse(raw3 ?? "").__pending === 0; } catch { /* not a marker */ }
check("3 old-era failing regenerates once (null on key error, fast)", out === null && ms < 10_000, `(${ms}ms)`);
check("3 failed attempt released its marker (__pending: 0)", released3, `raw=${(raw3 ?? "").slice(0, 60)}`);
const raw3b = await store.cacheGet(keyOf(ceRow), 365 * 24 * 3600 * 1000);
let ceUpgraded = false;
try { const v = JSON.parse(raw3b ?? ""); ceUpgraded = v.rules === RULES && v.cells?.[0]?.text === CE_PASS; } catch { /* leave false */ }
check("3 the passing old-era sibling upgraded instead of regenerating", ceUpgraded);

// --- case 3b: a PROVISIONAL unit (deadline cut / checker outage) re-enters
// generation WITH its cells - no writer redraw, the judgment pipeline runs,
// and with the checker unreachable it ships provisional again (never
// stamped, never flagged, response answers retry). 2026-10-02 review #1/#2.
await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_PASS)], rules: RULES }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_PASS)], provisional: true }), {});
t0 = Date.now();
out = await inst.generateGrid(gridInput());
ms = Date.now() - t0;
const raw3c = await store.cacheGet(keyOf(ceRow), 365 * 24 * 3600 * 1000);
let prov3c = "";
let text3c = "";
try { const v = JSON.parse(raw3c ?? ""); prov3c = v.__pending === 0 ? "retryable" : v.provisional ? "provisional" : v.rules === RULES ? "stamped" : "other"; text3c = v.cells?.[0]?.text ?? ""; } catch { prov3c = "parse"; }
check("3b provisional re-judges in place: text preserved, still provisional, response retries",
  out === null && prov3c === "provisional" && text3c === CE_PASS && ms < 10_000, `(${ms}ms, ${prov3c})`);

// --- case 3c: a unit that failed 3 attempts is EXHAUSTED - the battery ships
// without it (logged hole) instead of blocking the wizard forever on the
// retry response (2026-10-02 review: the stall-loop shape, bounded).
await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_PASS)], rules: RULES }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ __pending: 0, tries: 3, at: Date.now() }), {});
t0 = Date.now();
const report3c: { missing: { stage: string }[] } = { missing: [] };
out = await inst.generateGrid({ ...gridInput(), report: report3c });
ms = Date.now() - t0;
check("3c exhausted unit ships the battery short instead of blocking",
  Array.isArray(out) && out.length === 1 && out[0].text === PR_PASS && report3c.missing.length === 1 && ms < 10_000,
  `(${ms}ms, cells=${Array.isArray(out) ? out.length : "null"}, missing=${report3c.missing.length})`);

// --- case 3d: an exhaustion marker older than an hour EXPIRES - the unit is
// claimed again with a reset count (an outage must not ship a short battery
// that sticks; 2026-10-02 review round 3, item 1).
await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_PASS)], rules: RULES }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ __pending: 0, tries: 3, at: Date.now() - 61 * 60 * 1000 }), {});
t0 = Date.now();
out = await inst.generateGrid(gridInput());
ms = Date.now() - t0;
let tries3d = -1;
try { tries3d = (JSON.parse((await store.cacheGet(keyOf(ceRow), 365 * 24 * 3600 * 1000)) ?? "") as { tries?: number }).tries ?? -1; } catch { /* keep -1 */ }
check("3d hour-old exhaustion expires: claimed again, count reset (thrown call does not increment)",
  out === null && tries3d === 0 && ms < 10_000, `(${ms}ms, tries=${tries3d})`);

// --- case 3e: cacheClaim is a real compare-and-set (2026-10-02 round 3,
// item 7): wins when the stored value matches the expectation or the key is
// absent, loses when another writer got there first.
const ckey = "harness:claim";
let w = await store.cacheClaim(ckey, null, "M0", 3600_000, {});
check("3e claim wins on absent key", w === true);
w = await store.cacheClaim(ckey, "M0", "M1", 3600_000, {});
check("3e claim wins on matching expectation", w === true && (await store.cacheGet(ckey, 3600_000)) === "M1");
w = await store.cacheClaim(ckey, "M0", "M2", 3600_000, {});
check("3e claim loses on stale expectation", w === false && (await store.cacheGet(ckey, 3600_000)) === "M1");
w = await store.cacheClaim(ckey, null, "M3", 3600_000, {});
check("3e claim loses on absent expectation vs fresh row", w === false);

// --- case 3f: a KILLED re-judge left its provisional cells riding the stale
// claim marker - the takeover recovers them and re-judges in place instead
// of redrawing (2026-10-02 round 4, minor b).
await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_PASS)], rules: RULES }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ __pending: Date.now() - 60_000, cells: [cellOf(ceRow, CE_PASS)] }), {});
t0 = Date.now();
out = await inst.generateGrid(gridInput());
ms = Date.now() - t0;
let rec3f = "";
let recText = "";
try { const v = JSON.parse((await store.cacheGet(keyOf(ceRow), 365 * 24 * 3600 * 1000)) ?? "") as { provisional?: boolean; cells?: { text: string }[] }; rec3f = v.provisional ? "provisional" : "other"; recText = v.cells?.[0]?.text ?? ""; } catch { rec3f = "parse"; }
check("3f killed re-judge: cells recovered from the stale marker, text preserved, still provisional",
  out === null && rec3f === "provisional" && recText === CE_PASS && ms < 10_000, `(${ms}ms, ${rec3f})`);

// --- case 4: 60s-old marker is orphaned immediately (old code waited 180s) ---
await store.cacheSet(keyOf(prRow), JSON.stringify({ __pending: Date.now() - 60_000 }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ __pending: Date.now() - 60_000 }), {});
t0 = Date.now();
out = await inst.generateGrid(gridInput());
ms = Date.now() - t0;
check("4 stale (60s) markers taken over immediately, not waited out", out === null && ms < 10_000, `(${ms}ms)`);

// --- case 5: fresh marker + noWait -> pending, unclaimed ---
const freshAt = Date.now();
await store.cacheSet(keyOf(prRow), JSON.stringify({ __pending: freshAt }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ __pending: freshAt }), {});
t0 = Date.now();
out = await inst.generateGrid({ ...gridInput(), noWait: true });
ms = Date.now() - t0;
const raw5 = await store.cacheGet(keyOf(prRow), 365 * 24 * 3600 * 1000);
let untouched5 = false;
try { untouched5 = JSON.parse(raw5 ?? "").__pending === freshAt; } catch { /* leave false */ }
check("5 fresh marker + noWait returns pending fast", out === null && ms < 5_000, `(${ms}ms)`);
check("5 the fresh claim was not stolen", untouched5);

console.log(results.join("\n"));
console.log(process.exitCode ? "SOME CHECKS FAILED" : "ALL PASS");
process.exit(process.exitCode ?? 0);
