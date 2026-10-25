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
 *
 * 2026-10-24 setup audit (r29 / p32) additions:
 *  1  the passes completion marker lives under a key carrying the rules version
 *  2b an old-era unit whose design verdict is NOT cached re-judges in place
 *     (the serve-time re-judge runs the design layer, not only the free checks)
 *  3g a PROVISIONAL unit reaching the battery passes is never stamped
 *  6  the phrasings claim is a CAS: a concurrent writer's value wins, never
 *     overwritten by our marker
 *  7  the stakes judge fails CLOSED when the model call throws
 * Seeded design verdicts (designCheckCacheKey) stand in for the checker, so
 * the old-era upgrade cases stay free.
 *
 * 2026-10-25 re-audit (r30) additions:
 *  3h a unit finished during ANOTHER request's live passes run ends up
 *     stamped (the waiter re-runs the passes once for its own units)
 *  3i a never-reviewed provisional unit takes the review path on its finish
 *     pass (review throws here, so it stays provisional + unreviewed instead
 *     of landing terminal unreviewed)
 *  3j an old-era unit whose cached design verdict FAILS re-enters generation
 *     once, lands flagged-terminal, and the next serve serves it as-is
 *  3k claim markers carry the attempt count and its time
 *  6b a provisional paraphrase set is never served as final
 *  7  the stakes judge THROWS on an outage (nothing cached), never a
 *     fail-closed refusal
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

// r29: the rules re-judge reads the design layer too. Seed the verdicts the
// checker would have cached at generation for the passing texts, under the
// same intent the engine builds (the room circumstance fails open to the
// description without a key, so the situation reads "label - description").
const sitText = (r: { situation: string | null }) =>
  r.situation ? `${r.situation} - ${scenarios.find((s) => s.label === r.situation)?.description ?? ""}` : r.situation;
const intentOf = (r: { stage: { key: string }; situation: string | null; angle: string }) =>
  bc.stageDesignIntent(r.stage.key, "Acme", undefined, r.angle, sitText(r), undefined) as string | null;
const seedVerdict = async (r: typeof prRow, text: string) => {
  const intent = intentOf(r);
  if (intent) await store.cacheSet(inst.designCheckCacheKey(intent, text), JSON.stringify({ voices: true, reason: "harness" }), {});
};
await seedVerdict(prRow, PR_PASS);
await seedVerdict(ceRow, CE_PASS);
// Passing texts with NO cached verdict (the checker would have to run).
const PR_PASS2 = "Deadlines keep slipping on my team and nobody tracks who is doing what. How do people fix that?";
const CE_PASS2 = "What should I understand before picking project management software for the very first time?";
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
// The passes ran over the all-cached battery and left their completion
// marker under the CURRENT rules' key - never one a rules bump would keep.
const marker1 = await store.cacheGet(inst.gridPassesCacheKey(keys), 365 * 24 * 3600 * 1000);
const markerOld = await store.cacheGet(inst.gridPassesCacheKey(keys, "r28"), 365 * 24 * 3600 * 1000);
check("1 passes marker keyed on the rules version", marker1 === JSON.stringify("1") && markerOld === null &&
  inst.gridPassesCacheKey(keys) !== inst.gridPassesCacheKey(keys, "r28"), `(marker=${marker1}, old=${markerOld})`);

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

// --- case 2b: old-era, mechanically passing, but its design verdict is not
// cached: the design layer cannot be read for free (no checker here), so the
// unit is NOT upgraded - it re-enters generation with its text, ships
// provisional, and the response answers retry.
await store.cacheSet(keyOf(prRow), JSON.stringify([cellOf(prRow, PR_PASS)]), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_PASS2)], rules: "r0" }), {});
t0 = Date.now();
out = await inst.generateGrid(gridInput());
ms = Date.now() - t0;
let state2b = "";
let text2b = "";
try { const v = JSON.parse((await store.cacheGet(keyOf(ceRow), 365 * 24 * 3600 * 1000)) ?? "") as { provisional?: boolean; rules?: string; cells?: { text: string }[] }; state2b = v.provisional ? "provisional" : v.rules === RULES ? "stamped" : "other"; text2b = v.cells?.[0]?.text ?? ""; } catch { state2b = "parse"; }
check("2b unverified design layer: not upgraded, re-judged in place (text kept, provisional, retry)",
  out === null && state2b === "provisional" && text2b === CE_PASS2 && ms < 10_000, `(${ms}ms, ${state2b})`);

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
// CE_PASS2 has no cached design verdict - a cached one would rightly let
// the re-judge finish and stamp the unit.
await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_PASS)], rules: RULES }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_PASS2)], provisional: true }), {});
t0 = Date.now();
out = await inst.generateGrid(gridInput());
ms = Date.now() - t0;
const raw3c = await store.cacheGet(keyOf(ceRow), 365 * 24 * 3600 * 1000);
let prov3c = "";
let text3c = "";
try { const v = JSON.parse(raw3c ?? ""); prov3c = v.__pending === 0 ? "retryable" : v.provisional ? "provisional" : v.rules === RULES ? "stamped" : "other"; text3c = v.cells?.[0]?.text ?? ""; } catch { prov3c = "parse"; }
check("3b provisional re-judges in place: text preserved, still provisional, response retries",
  out === null && prov3c === "provisional" && text3c === CE_PASS2 && ms < 10_000, `(${ms}ms, ${prov3c})`);

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
await store.cacheSet(keyOf(ceRow), JSON.stringify({ __pending: Date.now() - 60_000, cells: [cellOf(ceRow, CE_PASS2)] }), {});
t0 = Date.now();
out = await inst.generateGrid(gridInput());
ms = Date.now() - t0;
let rec3f = "";
let recText = "";
try { const v = JSON.parse((await store.cacheGet(keyOf(ceRow), 365 * 24 * 3600 * 1000)) ?? "") as { provisional?: boolean; cells?: { text: string }[] }; rec3f = v.provisional ? "provisional" : "other"; recText = v.cells?.[0]?.text ?? ""; } catch { rec3f = "parse"; }
check("3f killed re-judge: cells recovered from the stale marker, text preserved, still provisional",
  out === null && rec3f === "provisional" && recText === CE_PASS2 && ms < 10_000, `(${ms}ms, ${rec3f})`);

// --- case 3g: a PROVISIONAL unit that reaches the battery passes is never
// stamped (2026-10-24 audit S1 #2: stampPassed rewrote {cells, rules, passed}
// over the provisional marker, freezing an unchecked seed as checked). The
// problem-recognition unit is provisional with a text the checker never
// judged, so it stays provisional; its sibling is terminal; every unit is
// resolved, so the passes run - and must leave it alone.
await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_PASS2)], provisional: true }), {});
await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_PASS)], rules: RULES }), {});
await store.cacheSet(inst.gridPassesCacheKey(keys), JSON.stringify({ __pending: 0 }), {});
out = await inst.generateGrid(gridInput());
let state3g = "";
try { const v = JSON.parse((await store.cacheGet(keyOf(prRow), 365 * 24 * 3600 * 1000)) ?? "") as { provisional?: boolean; passed?: string; rules?: string }; state3g = v.passed ? "stamped-passed" : v.provisional ? "provisional" : v.rules ? "rules-only" : "other"; } catch { state3g = "parse"; }
const marker3g = await store.cacheGet(inst.gridPassesCacheKey(keys), 365 * 24 * 3600 * 1000);
check("3g provisional unit never stamped by the passes (they did run)",
  out === null && state3g === "provisional" && marker3g === JSON.stringify("1") && !!prRow.situation,
  `(${state3g}, passes=${marker3g}, situation=${prRow.situation})`);

// --- case 3h: a unit this request finishes while ANOTHER request's passes
// run is live (2026-10-25 re-audit, S2). The problem-recognition unit is
// provisional with a text whose design verdict is cached, so its re-judge
// finishes terminal here - but the passes claim is live, so this request
// waits on it; the other run "completes" (written by the hook below) without
// having seen our unit. The waiter must re-run the passes once and stamp it.
{
  await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_PASS)], provisional: true }), {});
  await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_PASS)], rules: RULES }), {});
  const pk = inst.gridPassesCacheKey(keys);
  await store.cacheSet(pk, JSON.stringify({ __pending: Date.now() }), {});
  const origGet = store.cacheGet.bind(store);
  let fired = false;
  (store as { cacheGet: typeof store.cacheGet }).cacheGet = async (k, age) => {
    const v = await origGet(k, age);
    if (k === pk && !fired) {
      fired = true;
      // The other request's run finishes shortly after we start waiting.
      setTimeout(() => { void store.cacheSet(pk, JSON.stringify("1"), {}); }, 100);
    }
    return v;
  };
  t0 = Date.now();
  try { out = await inst.generateGrid(gridInput()); }
  finally { (store as { cacheGet: typeof store.cacheGet }).cacheGet = origGet; }
  ms = Date.now() - t0;
  let st3h = "";
  try { const v = JSON.parse((await store.cacheGet(keyOf(prRow), 365 * 24 * 3600 * 1000)) ?? "") as { provisional?: boolean; passed?: string; rules?: string }; st3h = v.passed === RULES ? "stamped" : v.provisional ? "provisional" : v.rules === RULES ? "rules-only" : "other"; } catch { st3h = "parse"; }
  check("3h unit finished during another request's live passes run ends up stamped",
    fired && Array.isArray(out) && st3h === "stamped" && ms < 15_000, `(${ms}ms, ${st3h}, fired=${fired})`);
}

// --- case 3i: a provisional unit whose seed REVIEW never ran (writer past
// the deadline, or a review outage) is reviewed on its finish pass
// (2026-10-25 re-audit, S3). Its design verdict is cached, so without the
// review it would land terminal; here the review call throws (no key), so
// the path being taken shows as the unit staying provisional + unreviewed.
{
  await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_PASS)], provisional: true, unreviewed: true }), {});
  await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_PASS)], rules: RULES }), {});
  out = await inst.generateGrid(gridInput());
  let st3i = "";
  try { const v = JSON.parse((await store.cacheGet(keyOf(prRow), 365 * 24 * 3600 * 1000)) ?? "") as { provisional?: boolean; unreviewed?: boolean; rules?: string; cells?: { text: string }[] }; st3i = v.provisional && v.unreviewed && v.cells?.[0]?.text === PR_PASS ? "provisional-unreviewed" : v.rules === RULES ? "terminal" : "other"; } catch { st3i = "parse"; }
  check("3i never-reviewed provisional unit takes the review path (stays provisional + unreviewed, not terminal)",
    out === null && st3i === "provisional-unreviewed", `(${st3i})`);
}

// --- case 3j: an old-era unit whose cached design verdict FAILS re-enters
// generation once, the heal throws (no key) and it lands FLAGGED-terminal
// under today's rules; the next serve serves it as-is - never a loop.
{
  const PR_OFF = "Our deadlines keep sliding and ownership is a mess on my team. What do people usually do about it?";
  const intent = intentOf(prRow);
  if (intent) await store.cacheSet(inst.designCheckCacheKey(intent, PR_OFF), JSON.stringify({ voices: false, reason: "harness: off design" }), {});
  await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_OFF)], rules: "r0" }), {});
  await store.cacheSet(keyOf(ceRow), JSON.stringify({ cells: [cellOf(ceRow, CE_PASS)], rules: RULES }), {});
  out = await inst.generateGrid(gridInput());
  const readPr = async () => { try { return JSON.parse((await store.cacheGet(keyOf(prRow), 365 * 24 * 3600 * 1000)) ?? "") as { rules?: string; provisional?: boolean; cells?: { text: string; seedFlags?: string[] }[] }; } catch { return null; } };
  const v1 = await readPr();
  const flagged1 = !!v1 && v1.rules === RULES && !v1.provisional && (v1.cells?.[0]?.seedFlags ?? []).some((f) => f.startsWith("off-design:"));
  t0 = Date.now();
  const out2 = await inst.generateGrid(gridInput());
  ms = Date.now() - t0;
  const v2 = await readPr();
  check("3j failing design verdict on an era bump: re-entered once, landed flagged-terminal",
    !!intent && flagged1 && v1?.cells?.[0]?.text === PR_OFF, `(intent=${!!intent}, rules=${v1?.rules}, flags=${JSON.stringify(v1?.cells?.[0]?.seedFlags ?? [])})`);
  check("3j the next serve serves it as-is (no loop)",
    Array.isArray(out2) && out2.some((c: { text: string; seedFlags?: string[] }) => c.text === PR_OFF && (c.seedFlags?.length ?? 0) > 0) &&
    JSON.stringify(v2) === JSON.stringify(v1) && ms < 5_000, `(${ms}ms)`);
  void out;
}

// --- case 3k: claim markers carry the attempt count and its time
// (2026-10-25 re-audit) - a takeover of a killed claim keeps the count.
{
  const at = Date.now() - 5_000;
  await store.cacheSet(keyOf(prRow), JSON.stringify({ cells: [cellOf(prRow, PR_PASS)], rules: RULES }), {});
  await store.cacheSet(keyOf(ceRow), JSON.stringify({ __pending: 0, tries: 2, at }), {});
  const origClaim = store.cacheClaim.bind(store);
  let claimed: { tries?: number; at?: number } | null = null;
  (store as { cacheClaim: typeof store.cacheClaim }).cacheClaim = async (k, exp, marker, age, meta) => {
    if (k === keyOf(ceRow) && !claimed) { try { claimed = JSON.parse(marker); } catch { /* keep null */ } }
    return origClaim(k, exp, marker, age, meta);
  };
  try { await inst.generateGrid(gridInput()); }
  finally { (store as { cacheClaim: typeof store.cacheClaim }).cacheClaim = origClaim; }
  const c3k = claimed as { tries?: number; at?: number } | null;
  check("3k claim marker carries tries and at", c3k?.tries === 2 && c3k?.at === at, `(${JSON.stringify(c3k)})`);
}

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

// --- case 6: the phrasings claim is a CAS (2026-10-24 audit). A concurrent
// request finishes the cell between our scan and our claim: the claim must
// lose, its value must survive, and this request serves it.
{
  const pInput = {
    brand: "Acme", category: "project management software", competitors: [], audience: null,
    base, scenarios, count: 10,
  };
  const pCell = { stage: ceRow.stage.key, situation: ceRow.situation, angle: ceRow.angle, mode: null, text: CE_PASS };
  const pkey = inst.phrasingCacheKey(pInput, pCell);
  const theirs = [{ text: "What do I need to know before choosing project management software for the first time?", asker: "harness" }];
  const orig = store.cacheClaim.bind(store);
  let injected = false;
  (store as { cacheClaim: typeof store.cacheClaim }).cacheClaim = async (k, exp, marker, age, meta) => {
    if (k === pkey && !injected) { injected = true; await store.cacheSet(pkey, JSON.stringify(theirs), {}); }
    return orig(k, exp, marker, age, meta);
  };
  let got: { text: string }[][] = [];
  try { got = await inst.generatePhrasings({ ...pInput, cells: [pCell] }); }
  finally { (store as { cacheClaim: typeof store.cacheClaim }).cacheClaim = orig; }
  const after = await store.cacheGet(pkey, 365 * 24 * 3600 * 1000);
  check("6 phrasings claim lost to a concurrent writer: its value survives and is served",
    injected && after === JSON.stringify(theirs) && got[0]?.[0]?.text === theirs[0].text, `(injected=${injected}, served=${got[0]?.length ?? 0})`);
}

// --- case 6b: a PROVISIONAL paraphrase set (budget cut, or left unchecked
// by an outage) is never served as final (2026-10-25 re-audit, S2): the
// client refills only short sets, so a full-count unchecked set landed in
// the draft. It stays cached provisional; the response carries it empty.
{
  const pInput = {
    brand: "Acme", category: "project management software", competitors: [], audience: null,
    base, scenarios, count: 10,
  };
  const pCell = { stage: ceRow.stage.key, situation: ceRow.situation, angle: ceRow.angle, mode: null, text: CE_PASS2 };
  const pkey = inst.phrasingCacheKey(pInput, pCell);
  const set = [{ text: "What should I know before I pick project management software for the first time?", asker: "harness" }];
  await store.cacheSet(pkey, JSON.stringify({ provisional: true, set }), {});
  const got = await inst.generatePhrasings({ ...pInput, cells: [pCell] });
  let still = false;
  try { const v = JSON.parse((await store.cacheGet(pkey, 365 * 24 * 3600 * 1000)) ?? ""); still = v.provisional === true && Array.isArray(v.set) && v.set.length >= 1; } catch { /* leave false */ }
  check("6b provisional paraphrase set not served in out (cache keeps it provisional)",
    Array.isArray(got) && (got[0]?.length ?? -1) === 0 && still, `(served=${got[0]?.length ?? "?"}, provisional=${still})`);
}

// --- case 7: the stakes judge THROWS on an outage (2026-10-25 re-audit):
// the old fail-closed refusal was cached inside the shared market read for
// the full TTL. With no key the call fails twice and the judge throws, so
// the read's coalesced() releases its claim and caches nothing.
{
  let threw = false;
  let verdicts: unknown = null;
  try {
    verdicts = await inst.judgeStakes({
      category: "project management software", base: base as never,
      rooms: [{ label: "Solo founder", description: "Runs the company alone", journey: { involvement: "considered", verifiability: "spec", think_feel: "think", decision_unit: "committee" } }],
    });
  } catch { threw = true; }
  check("7 stakes judge throws on a model outage (no cached refusal)", threw && verdicts === null, `(threw=${threw})`);
}

console.log(results.join("\n"));
console.log(process.exitCode ? "SOME CHECKS FAILED" : "ALL PASS");
process.exit(process.exitCode ?? 0);
