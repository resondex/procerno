/* eslint-disable @typescript-eslint/no-explicit-any -- a test over the engine's payloads */
/**
 * The site owner check and the owner rules end to end, zero spend (site_owner.ts, facts/sources.ts,
 * lib/site_owners.ts). Runs on a COPY of the test db in a temporary folder - the test copy itself is never written -
 * with every model key blank and a fake model function injected:
 *
 *  1. keyless: prewarmSiteOwners without a judge is a no-op (no row written);
 *  2. a flaky fake judge: every call carries at most SITE_CHUNK sites; a site the reply leaves out once is sent again
 *     and lands; a site left out twice gets no verdict (nothing saved); a chunk whose call throws is skipped, logged,
 *     never thrown; names not on the board are dropped from the saved verdict;
 *  3. a second run judges only what is still missing; a third makes no call (every site a cache hit) and leaves the
 *     run's snapshot - and so the workbench key - unchanged;
 *  4. a person-entered record (and the verdicts) move the workbench cache key; two views that do not read sources
 *     keep their exact keys;
 *  5. the Data page's source tables on the loaded owners: every cell recomputes from its fact id on a fresh fact
 *     book, and "Cites the brand's own site" moves (a verdict giving the client a site the name match misses, a
 *     verdict with two owners, a person's "nobody's" taking a site away from a brand).
 *
 *   npx tsx scripts/site_owner_test.mts       (in scripts/check_all.sh as "sites")
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "procerno-sites-"));
const db = path.join(tmp, "copy.db");
fs.copyFileSync(ROOT + "/data/dashboard_fixture.db", db, fs.constants.COPYFILE_FICLONE);
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = db;
delete process.env.VIEW_CACHE;
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";

const { store } = await import(ROOT + "/src/lib/store/index.ts");
const site = await import(ROOT + "/src/lib/engine/site_owner.ts");
const { dashboardRun } = await import(ROOT + "/src/lib/engine/prompt_health.ts");
const { loadViewData } = await import(ROOT + "/src/lib/engine/view_data.ts");
const { computeWorkbench, computeWorkbenchCached } = await import(ROOT + "/src/lib/engine/workbench.ts");
const { computeBrandSummaryCached } = await import(ROOT + "/src/lib/engine/brand_summary.ts");
const { computeJourneyCached } = await import(ROOT + "/src/lib/engine/journey.ts");
const { buildAnswerFacts } = await import(ROOT + "/src/lib/engine/facts/answer_facts.ts");
const { factBook, WHAT_TO_BUY_ALL } = await import(ROOT + "/src/lib/engine/facts/fact.ts");
const { parseFactId } = await import(ROOT + "/src/lib/engine/facts/statements.ts");
const { DATA_MEASURES, DATA_POOLS } = await import(ROOT + "/src/lib/engine/facts/measure_book.ts");
const { withSiteOwners } = await import(ROOT + "/src/lib/site_owners.ts");
const lib = await import(ROOT + "/src/app/projects/[id]/table_library.ts");
const pc = await import(ROOT + "/src/app/projects/[id]/pivot_compute.ts");

const failures: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (!cond) failures.push(`${label}${detail ? ` - ${detail}` : ""}`);
};

const project = (await store.listProjects()).find((p: any) => !p.archived_at && p.brand === "Jira");
if (!project) throw new Error("the test copy has no Jira tracker");
const run = await dashboardRun(project.id);
const snapKey = site.siteSnapshotKey(project.id, run.id);

// 1. Keyless: nothing judged, nothing written.
const before = await site.planSiteOwnerCheck(run, project);
ok("plan has sites", !!before && before.sites.length > 0);
const k0 = await site.prewarmSiteOwners(run, project, { deadlineMs: Date.now() + 60_000 });
ok("keyless prewarm is a no-op", JSON.stringify(k0) === JSON.stringify({ sites: 0, cached: 0, judged: 0, failed: 0 }), JSON.stringify(k0));
ok("keyless prewarm writes no snapshot", (await store.cacheGet(snapKey, 1e15)) === null);
ok("keyless prewarm writes no verdict", (await site.readSiteVerdicts(project, before!.sites.map((s: any) => s.site))).size === 0);

// The fake model: the client owns the most cited site the name match leaves to nobody (and a second brand shares
// it), a parent-company site; every other site goes by its name, plus an off-board name the guard must drop.
const board = before!.board;
const client = board.find((b: any) => b.client)!;
const second = board.find((b: any) => !b.client && b.name !== "Other")!;
const data0: any = await loadViewData(run, project, { setupDecision: true, judge: true });
const wb0: any = computeWorkbench(data0, {});
const nameOwned = new Set(wb0.sources.filter((_: string, i: number) => wb0.sourceOwner[i].length > 0));
const shared = before!.sites.find((s: any) => !nameOwned.has(s.site))!.site;
const onceMissing = before!.sites[before!.sites.length - 1].site;
const alwaysMissing = before!.sites[before!.sites.length - 2].site;
const throwing = before!.sites[2 * site.SITE_CHUNK + 1].site; // a site in the third chunk: that chunk's call throws on the first run
const owned = wb0.sources.find((s: string, i: number) => wb0.sourceOwner[i].length > 0 && before!.sites.some((x: any) => x.site === s));
const ownedBy = wb0.brands[wb0.sourceOwner[wb0.sources.indexOf(owned)][0]];
const calls: string[][] = [];
let flaky = true;
const seenOnce = new Set<string>();
const judge = async ({ board: b, sites }: any) => {
  calls.push(sites.map((s: any) => s.site));
  ok("every call carries at most SITE_CHUNK sites", sites.length <= site.SITE_CHUNK, String(sites.length));
  ok("the board reaches the judge", b.length === board.length);
  if (flaky && sites.some((s: any) => s.site === throwing)) throw new Error("fake: this chunk fails");
  const out = new Map<string, string[]>();
  for (const s of sites) {
    if (flaky && s.site === alwaysMissing) continue;
    if (flaky && s.site === onceMissing && !seenOnce.has(s.site)) {
      seenOnce.add(s.site);
      continue;
    }
    if (s.site === shared) out.set(s.site, [client.name, second.name, "Not A Brand On The Board"]);
    else if (s.site === owned) out.set(s.site, [ownedBy.name]);
    else out.set(s.site, []);
  }
  return out;
};

// 2. The flaky run.
const stamp0 = await site.siteOwnerStamp(project.id, run.id);
const w1 = await site.prewarmSiteOwners(run, project, { judge, deadlineMs: Date.now() + 60_000 });
const chunks = Math.ceil(before!.misses.length / site.SITE_CHUNK);
const chunkOfThrowing = Math.floor(before!.sites.findIndex((s: any) => s.site === throwing) / site.SITE_CHUNK);
const thrownSize = calls.find((c) => c.includes(throwing))!.length;
ok("first run: one call per chunk plus the retries", calls.length === chunks + 1, `${calls.length} calls for ${chunks} chunks`);
ok("first run: the retry carries only the omitted sites", calls.some((c) => c.length === 2 && c.includes(onceMissing) && c.includes(alwaysMissing)));
ok("first run: the throwing chunk is the third", chunkOfThrowing === 2);
ok("first run: counts", w1.sites === before!.sites.length && w1.cached === 0 && w1.failed === thrownSize + 1 && w1.judged === before!.sites.length - thrownSize - 1, JSON.stringify(w1));
const v1 = await site.readSiteVerdicts(project, before!.sites.map((s: any) => s.site));
ok("omitted once, sent again: saved", v1.has(onceMissing));
ok("omitted twice: nothing saved", !v1.has(alwaysMissing));
ok("failed chunk: nothing saved", !v1.has(throwing));
ok("off-board names dropped from the saved verdict", JSON.stringify(v1.get(shared)) === JSON.stringify([client.name, second.name]), JSON.stringify(v1.get(shared)));
const stamp1 = await site.siteOwnerStamp(project.id, run.id);
ok("the snapshot moves the stamp", stamp1 !== stamp0);

// 3. The second run judges only what is missing; the third makes no call and leaves the snapshot as it is.
flaky = false;
calls.length = 0;
const w2 = await site.prewarmSiteOwners(run, project, { judge, deadlineMs: Date.now() + 60_000 });
ok("second run: only the missing sites", w2.judged === thrownSize + 1 && w2.cached === before!.sites.length - thrownSize - 1 && w2.failed === 0, JSON.stringify(w2));
ok("second run: calls", calls.flat().length === thrownSize + 1, `${calls.flat().length} sites sent`);
const stamp2 = await site.siteOwnerStamp(project.id, run.id);
calls.length = 0;
const w3 = await site.prewarmSiteOwners(run, project, { judge, deadlineMs: Date.now() + 60_000 });
ok("third run: no call", calls.length === 0 && w3.judged === 0 && w3.cached === before!.sites.length, JSON.stringify(w3));
ok("third run: the stamp holds", (await site.siteOwnerStamp(project.id, run.id)) === stamp2);

// 4. Keys: capture the cache keys three views look up (a spy answering "null" for them; the copy's revision is pinned).
const orig = store.cacheGet.bind(store);
async function keysNow(): Promise<Record<string, string>> {
  const got: Record<string, string> = {};
  (store as any).cacheGet = async (key: string, age: number) => {
    const m = key.match(/^(workbench|brand_summary|journey):/);
    if (m) {
      got[m[1]] = key;
      return "null";
    }
    return orig(key, age);
  };
  await computeWorkbenchCached(run, project);
  await computeBrandSummaryCached(run, project);
  await computeJourneyCached(run, project);
  (store as any).cacheGet = orig;
  return got;
}
const keysBefore = await keysNow();
// A person's records: the name-matched site is nobody's; the shared site goes to the second brand alone.
const at = new Date().toISOString();
let map = withSiteOwners({}, owned, [], at);
await store.setSiteOwners(project.id, JSON.stringify(map));
const keysEntered = await keysNow();
ok("an entered record moves the workbench key", keysEntered.workbench !== keysBefore.workbench);
ok("brand_summary keeps its key", keysEntered.brand_summary === keysBefore.brand_summary);
ok("journey keeps its key", keysEntered.journey === keysBefore.journey);

// 5. The source tables on the loaded owners.
const data: any = await loadViewData(run, project, { setupDecision: true, judge: true, siteOwners: true });
const wb: any = computeWorkbench(data, {});
const book = factBook(buildAnswerFacts({ ...data }, {}));
const i = (s: string) => wb.sources.indexOf(s);
const keysOf = (s: string) => (wb.sourceOwner[i(s)] ?? []).map((j: number) => wb.brands[j].key);
ok("the check gives the shared site two owners", JSON.stringify(keysOf(shared)) === JSON.stringify([client.key, second.key]), JSON.stringify(keysOf(shared)));
ok("a person's nobody's wins over the check", keysOf(owned).length === 0, JSON.stringify(keysOf(owned)));
const own = (d: any, key: string) => factBook(buildAnswerFacts(d, {})).fact("cites_site_of", key, WHAT_TO_BUY_ALL);
const clientBefore = own(data0, client.key);
const clientAfter = own(data, client.key);
const lostBefore = own(data0, ownedBy.key);
const lostAfter = own(data, ownedBy.key);
ok("cites_site_of moves up for the client", clientAfter.k > clientBefore.k, `${clientBefore.k} -> ${clientAfter.k}`);
ok("cites_site_of moves down for the brand that lost its site", lostAfter.k < lostBefore.k, `${lostBefore.k} -> ${lostAfter.k}`);
ok("the base stays the answers that cite a source", clientAfter.n === clientBefore.n);
let cells = 0;
const tables: any[] = [];
for (const e of lib.LIBRARY) if (e.kind === "pivot" && e.group === "Sources" && lib.entryAvailable(e, wb)) tables.push(lib.entrySettings(e));
for (const m of DATA_MEASURES.filter((m: any) => m.id.startsWith("cites")))
  for (const pool of DATA_POOLS.map((p: any) => p.key)) tables.push({ pool, measures: [m.id], row: m.src ? "source" : m.subject === "brand" ? "brand" : "engine", col: "none", brand: null, arg: null, src: null, where: null });
tables.push({ pool: "what_to_buy", measures: ["cites_site_of"], row: "brand", col: "vendor", brand: null, arg: null, src: null, where: null });
for (const t of tables) {
  const res = pc.resolveSettings(t, wb);
  if (!res) continue;
  for (const [key, a] of pc.computePivot(res, wb).cells as Map<string, any>) {
    cells++;
    const { measure, subject, scope } = parseFactId(a.fact);
    const f = book.fact(measure, subject, scope);
    if (f.id !== a.fact || f.k !== a.k || f.n !== a.n || f.text !== a.text) failures.push(`cell ${key} ${a.fact}: ${a.k}/${a.n} ${a.text} vs ${f.k}/${f.n} ${f.text}`);
  }
}
ok("source tables computed", cells > 100, String(cells));

// And a second edit re-keys again; adding the record back as it was keys as before.
map = withSiteOwners(map, shared, [second.key], at);
await store.setSiteOwners(project.id, JSON.stringify(map));
const keysEdit2 = await keysNow();
ok("a second edit moves the workbench key", keysEdit2.workbench !== keysEntered.workbench);
await store.setSiteOwners(project.id, null);
ok("no record keys as before the edits", (await keysNow()).workbench === keysBefore.workbench);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`site owner check on ${project.brand}: ${before!.sites.length} sites, ${chunks} chunks; ${cells} source-table cells recomputed from their fact ids`);
console.log(`  shared site ${shared} -> ${client.name} + ${second.name}; ${owned} made nobody's (was ${ownedBy.name}'s)`);
console.log(`  cites_site_of ${client.name} ${clientBefore.k}/${clientBefore.n} -> ${clientAfter.k}/${clientAfter.n}; ${ownedBy.name} ${lostBefore.k} -> ${lostAfter.k}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `FAIL: ${failures.length} failures` : "PASS");
process.exit(failures.length ? 1 : 0);
