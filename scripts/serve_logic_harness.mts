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

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

// --- case 1: terminal-flagged unit serves as-is, no model call ---
await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_FAIL, ["names the target brand"])], rules: "r1" }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_FAIL, ["blind seed never speaks the category"])], rules: "r1" }), {});
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
  try { const v = JSON.parse(r ?? ""); return !Array.isArray(v) && v.rules === "r1" && Array.isArray(v.cells); } catch { return false; }
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
try { const v = JSON.parse(raw3b ?? ""); ceUpgraded = v.rules === "r1" && v.cells?.[0]?.text === CE_PASS; } catch { /* leave false */ }
check("3 the passing old-era sibling upgraded instead of regenerating", ceUpgraded);

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
