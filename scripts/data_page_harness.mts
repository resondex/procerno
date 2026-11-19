/* eslint-disable @typescript-eslint/no-explicit-any -- a harness over the served payloads */
/**
 * The Data page on the fact layer (FACT_LAYER_DESIGN_2026-11-17.md step 6). For each of the six trackers on the test
 * copy:
 *
 *  - every ready-made table in the library (table_library.ts) the tracker can show, and a fixed set of built tables
 *    covering every dimension (as a row, and as a column) and every number the page offers (DATA_MEASURES, each once,
 *    on the first group of questions that asks it) - plus one table cut to a subset of assistants (the Panel lens);
 *  - every cell of each table is a fact: its id read back (statements.ts parseFactId) and recomputed by a FRESH fact
 *    book on the server (fact.ts, the legality checks on) must give the cell's k, n and printed text;
 *  - a cell whose fact a card or By rival page draws (the stat registry's fact ids) must print the card's number with
 *    the card's counts.
 *
 * Exits non-zero on any failure. Fixture only, no model calls, writes nothing:
 *   SQLITE_PATH=data/dashboard_fixture.db VIEW_CACHE=off npx tsx scripts/data_page_harness.mts
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
process.env.VIEW_CACHE = "off";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";

const ROOT = process.cwd();
const { store } = await import(ROOT + "/src/lib/store/index.ts");
const { loadViewData } = await import(ROOT + "/src/lib/engine/view_data.ts");
const { cachedRunRevision } = await import(ROOT + "/src/lib/engine/run_revision.ts");
const { sharedAnalysisMap } = await import(ROOT + "/src/lib/engine/analysis_map.ts");
const { buildStatRegistry } = await import(ROOT + "/src/lib/engine/stat_registry.ts");
const { computeWorkbench } = await import(ROOT + "/src/lib/engine/workbench.ts");
const { buildAnswerFacts } = await import(ROOT + "/src/lib/engine/facts/answer_facts.ts");
const { factBook } = await import(ROOT + "/src/lib/engine/facts/fact.ts");
const { parseFactId } = await import(ROOT + "/src/lib/engine/facts/statements.ts");
const { DATA_MEASURES, DATA_POOLS, printWhole } = await import(ROOT + "/src/lib/engine/facts/measure_book.ts");
const lib = await import(ROOT + "/src/app/projects/[id]/table_library.ts");
const pc = await import(ROOT + "/src/app/projects/[id]/pivot_compute.ts");

const failures: string[] = [];
const fail = (s: string) => {
  if (failures.length < 300) failures.push(s);
};
const tot = { tables: 0, library: 0, built: 0, panelCut: 0, company: 0, cells: 0, equal: 0, card: 0, cardEqual: 0, cardWhole: 0, dims: new Set<string>(), measures: new Set<string>() };

const DIMS = pc.DIMS.map((d: any) => d.key).filter((k: string) => k !== "none");

/** The fixed built tables: every dimension as a row and as a column, on the groups where it means something. */
const FIXED: any[] = [
  { pool: "what_to_buy", measures: ["named", "recommended", "picked", "share_of_picks"], row: "brand", col: "none" },
  { pool: "what_to_buy", measures: ["share_of_picks"], row: "parent", col: "none" },
  { pool: "what_to_buy", measures: ["converts"], row: "brand", col: "vendor" },
  { pool: "what_to_buy", measures: ["named_first", "negative"], row: "brand", col: "none" },
  { pool: "what_to_buy", measures: ["commit_rate", "picks_outside_analysis", "picks_outside_category", "outcome_no_pick"], row: "room", col: "none" },
  { pool: "what_to_buy", measures: ["picked"], row: "question", col: "none" },
  { pool: "what_to_buy", measures: ["picked"], row: "stage", col: "mode" },
  { pool: "what_to_buy", measures: ["picked"], row: "engine", col: "tier" },
  { pool: "what_to_buy", measures: ["argues"], row: "argument", col: "vendor" },
  { pool: "what_to_buy", measures: ["share_of_picks"], row: "argument", col: "none" },
  { pool: "what_to_buy", measures: ["argues_when_picked", "argues_when_other_picked"], row: "argument", col: "none" },
  { pool: "what_to_buy", measures: ["named"], row: "room", col: "brand" },
  { pool: "what_to_buy", measures: ["share_of_picks"], row: "tier", col: "parent" },
  { pool: "popular", measures: ["named", "recommended", "share_of_picks"], row: "brand", col: "none" },
  { pool: "premium", measures: ["tier_premium", "tier_basic", "tier_balanced", "tier_none"], row: "engine", col: "none" },
  { pool: "h2h", measures: ["h2h_you", "h2h_rival", "h2h_another", "h2h_no_pick"], row: "rival", col: "none" },
  { pool: "h2h", measures: ["h2h_two_way"], row: "rival", col: "mode" },
  { pool: "h2h_class", measures: ["h2h_you", "h2h_rival"], row: "rival", col: "none" },
  { pool: "switching", measures: ["named", "picked"], row: "rival", col: "none" },
  { pool: "switching", measures: ["picked"], row: "brand", col: "rival" },
  { pool: "value", measures: ["worth_yes", "instead_rival", "instead_own", "instead_nowhere"], row: "room", col: "none" },
  { pool: "value", measures: ["named_instead"], row: "brand", col: "none" },
  { pool: "buyers_worries", measures: ["go_ahead", "steer_clear", "agrees", "partly_agrees"], row: "worry", col: "none" },
  { pool: "customers_worries", measures: ["stay"], row: "worry", col: "stage" },
  { pool: "customers_worries", measures: ["sent_to"], row: "brand", col: "worry" },
  { pool: "looking_around", measures: ["stay", "leave", "sent_to_any", "sent_own"], row: "engine", col: "none" },
  { pool: "habit", measures: ["habit_stick", "habit_switch"], row: "vendor", col: "none" },
  { pool: "problem", measures: ["routed_category", "routed_adjacent", "routed_none"], row: "room", col: "none" },
  { pool: "learning", measures: ["named"], row: "brand", col: "none" },
  { pool: "criteria", measures: ["argues"], row: "argument", col: "room" },
  { pool: "advocacy", measures: ["case_strong", "case_partial", "case_concedes", "disagrees"], row: "mode", col: "none" },
  { pool: "business_case", measures: ["relationship_strengthens", "case_hedged", "case_undermined", "redirected_any"], row: "vendor", col: "none" },
  { pool: "expansion", measures: ["growth_backs", "growth_neutral", "growth_redirects"], row: "engine", col: "none" },
  { pool: "ecosystem", measures: ["relationship_weakens", "redirected_to"], row: "none", col: "none" },
  { pool: "what_to_buy", measures: ["picked"], row: "room", col: "none", where: { dim: "vendor" } },
  // Sources (2026-11-18): the Source dimension as a context list (a source number), as a filter (any other number),
  // as a column, a source number read for one site with no Source dimension, and the own-site numbers.
  { pool: "what_to_buy", measures: ["cites"], row: "source", col: "none" },
  { pool: "what_to_buy", measures: ["cites"], row: "source", col: "mode" },
  { pool: "what_to_buy", measures: ["cites_when_picked", "cites_when_other_picked"], row: "source", col: "none" },
  { pool: "what_to_buy", measures: ["picked", "share_of_picks"], row: "source", col: "none" },
  { pool: "what_to_buy", measures: ["named"], row: "brand", col: "source" },
  { pool: "what_to_buy", measures: ["cites"], row: "vendor", col: "none", src: "@second" },
  { pool: "what_to_buy", measures: ["cites_any", "cites_a_brand_site"], row: "engine", col: "none" },
  { pool: "what_to_buy", measures: ["cites_site_of"], row: "brand", col: "none" },
  { pool: "what_to_buy", measures: ["cites_site_of"], row: "parent", col: "none" },
  { pool: "h2h", measures: ["h2h_you"], row: "source", col: "none" },
  { pool: "customers_worries", measures: ["cites"], row: "source", col: "worry" },
  { pool: "what_to_buy", measures: ["cites"], row: "source", col: "none", where: { dim: "vendor" } },
];
if (FIXED.length < 20) throw new Error("fewer than 20 fixed built tables");

const projects = (await store.listProjects()).filter((p: any) => !p.archived_at);
for (const project of projects) {
  const run = (await store.listRuns(project.id))[0];
  const data: any = await loadViewData(run, project, { setupDecision: true, judge: true });
  data.revision = await cachedRunRevision(run.id);
  const { view: map } = await sharedAnalysisMap(data, {});
  const reg = buildStatRegistry(map);
  const drawn = new Map<string, any[]>();
  for (const st of reg.all()) if (st.fact) drawn.set(st.fact, [...(drawn.get(st.fact) ?? []), st]);

  // The fresh server book: nothing shared with the payload's build.
  const set = buildAnswerFacts({ ...data }, {});
  const book = factBook(set);
  const check = (wb: any, label: string, settings: any, kind: "library" | "built" | "panelCut" | "company", bk: any = book) => {
    const res = pc.resolveSettings(settings, wb);
    if (!res) return;
    // Only tables that resolve exactly as asked (the page hides the rest).
    const asked = settings.measures.filter((id: string) => res.measures.some((m: any) => m.id === id));
    if (res.pool !== settings.pool || res.rowDim !== settings.row || res.colDim !== settings.col || asked.length !== settings.measures.length || (settings.where && !res.where)) return;
    tot.tables++;
    tot[kind]++;
    if (res.rowDim !== "none") tot.dims.add(`row:${res.rowDim}`);
    if (res.colDim !== "none") tot.dims.add(`col:${res.colDim}`);
    for (const m of res.measures) tot.measures.add(m.id);
    const pv = pc.computePivot(res, wb);
    for (const [key, a] of pv.cells as Map<string, any>) {
      tot.cells++;
      let f: any;
      try {
        const { measure, subject, scope } = parseFactId(a.fact);
        f = bk.fact(measure, subject, scope);
      } catch (e: any) {
        fail(`${project.brand} [${label}] ${key}: ${a.fact} does not recompute: ${e.message}`);
        continue;
      }
      if (f.id !== a.fact) fail(`${project.brand} [${label}] ${key}: recomputes under another id ${f.id}`);
      else if (f.k !== a.k || f.n !== a.n || f.text !== a.text) fail(`${project.brand} [${label}] ${key}: cell ${a.k}/${a.n} "${a.text}" vs fact ${f.k}/${f.n} "${f.text}" (${a.fact})`);
      else tot.equal++;
      const cards = drawn.get(a.fact);
      if (cards) {
        tot.card++;
        // A card prints its fact by the measure's rule; a card SENTENCE (a claim) may print the same counts in whole
        // points by its own template (statements.ts pw) - counted apart, never a different number.
        const whole = printWhole(a.k, a.n);
        const bad = cards.filter((st: any) => (st.value !== a.text && !(st.k === undefined && st.value === whole)) || (st.k !== undefined && (st.k !== a.k || st.n !== a.n)));
        if (bad.length) fail(`${project.brand} [${label}] ${key}: card ${bad[0].id} prints ${bad[0].value} (${bad[0].k}/${bad[0].n}), the cell ${a.text} (${a.k}/${a.n})`);
        else if (cards.every((st: any) => st.value === a.text)) tot.cardEqual++;
        else tot.cardWhole++;
      }
    }
  };

  const wb: any = computeWorkbench(data, {});
  for (const e of lib.LIBRARY) if (e.kind === "pivot" && lib.entryAvailable(e, wb)) check(wb, `library ${e.id}`, lib.entrySettings(e), "library");
  const vendor0 = wb.engines[0]?.vendor;
  for (const [i, t] of FIXED.entries()) {
    const s = { brand: null, arg: null, ...t, src: t.src === "@second" ? (wb.sources[1] ?? null) : (t.src ?? null), where: t.where ? { ...t.where, label: vendor0 } : null };
    check(wb, `built ${i}`, s, "built");
  }
  // Every number once, on the first group of questions it is legal on and present in, by its natural row.
  const present = pc.presentPools(wb);
  for (const m of DATA_MEASURES) {
    const pool = DATA_POOLS.map((p: any) => p.key).find((k: string) => present.includes(k) && !pc.illegalReason({ ...m, brand: m.subject === "brand" }, k));
    if (!pool) continue;
    check(wb, `measure ${m.id}`, { pool, measures: [m.id], row: m.src ? "source" : m.subject === "brand" ? "brand" : m.arg ? "argument" : "engine", col: "none", brand: null, arg: null, src: null, where: null }, "built");
  }
  // The Panel lens: the payload cut to the search assistants; every cell's scope carries them.
  const search = wb.engines.filter((e: any) => e.mode === "search").map((e: any) => e.id);
  if (search.length) {
    const cut: any = computeWorkbench(data, { engines: search });
    check(cut, "panel cut, by brand", { pool: "what_to_buy", measures: ["named", "share_of_picks"], row: "brand", col: "none", brand: null, arg: null, src: null, where: null }, "panelCut");
    check(cut, "panel cut, sources", { pool: "what_to_buy", measures: ["cites"], row: "source", col: "engine", brand: null, arg: null, src: null, where: null }, "panelCut");
    check(cut, "panel cut, h2h", { pool: "h2h", measures: ["h2h_you"], row: "rival", col: "engine", brand: null, arg: null, src: null, where: null }, "panelCut");
  }
  // Companies: the test copy sets no parent company on any brand, so the company rows are checked on a copy of the
  // dictionary that puts the three most named brands in analysis other than the tracker under one made-up parent
  // (in memory only) - the "co:<company>" subject end to end.
  const top = wb.brands.filter((b: any, i: number) => b.listed && i !== wb.target).slice(0, 3).map((b: any) => b.key);
  if (top.length >= 2) {
    const cdata: any = { ...data, dictionary: data.dictionary.map((e: any) => (top.includes(e.id) ? { ...e, parent: "Test Parent Co" } : e)) };
    const cwb: any = computeWorkbench(cdata, {});
    const cbook = factBook(buildAnswerFacts({ ...cdata }, {}));
    for (const e of lib.LIBRARY) if (e.kind === "pivot" && e.row === "parent" && lib.entryAvailable(e, cwb)) check(cwb, `company ${e.id}`, lib.entrySettings(e), "company", cbook);
    check(cwb, "company, funnel", { pool: "what_to_buy", measures: ["named", "recommended", "picked", "named_first"], row: "parent", col: "none", brand: null, arg: null, src: null, where: null }, "company", cbook);
    check(cwb, "company, by room", { pool: "what_to_buy", measures: ["share_of_picks"], row: "room", col: "parent", brand: null, arg: null, src: null, where: null }, "company", cbook);
  }
  console.log(`${project.brand}: ${tot.tables} tables so far, ${tot.cells} cells`);
}

const missingDims = DIMS.filter((d: string) => !tot.dims.has(`row:${d}`) && !tot.dims.has(`col:${d}`));
const missingMeasures = DATA_MEASURES.map((m: any) => m.id).filter((id: string) => !tot.measures.has(id));
console.log(`\nTables: ${tot.tables} (${tot.library} ready-made, ${tot.built} built, ${tot.panelCut} cut to a subset of assistants, ${tot.company} by company on a dictionary copy with a parent set) on ${projects.length} trackers.`);
console.log(`Cells: ${tot.cells}; equal to their fact recomputed from its id (k, n, printed text): ${tot.equal}.`);
console.log(`Cells whose fact a card or By rival page draws: ${tot.card}; the card prints the same text with the same counts: ${tot.cardEqual}; a card sentence prints the same counts in whole points: ${tot.cardWhole}.`);
console.log(`Dimensions covered: ${[...tot.dims].sort().join(", ")}`);
console.log(`Numbers covered: ${tot.measures.size} of ${DATA_MEASURES.length}${missingMeasures.length ? ` (not asked on any tracker: ${missingMeasures.join(", ")})` : ""}`);
if (missingDims.length) fail(`dimensions never covered: ${missingDims.join(", ")}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `FAIL: ${failures.length} failures` : "PASS");
process.exit(failures.length ? 1 : 0);
