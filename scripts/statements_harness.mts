/* eslint-disable @typescript-eslint/no-explicit-any -- a harness over the served payloads */
/**
 * Statements (fact layer, layer 4 - FACT_LAYER_DESIGN_2026-11-17.md step 5, part 1): the Map and the Overview are
 * statements over the run's facts. On every tracker of the test copy this checks, from a fact book built afresh
 * (buildAnswerFacts + conditions + products + factBook - nothing shared with the compute):
 *
 *  1. every number in every Map cell's line, claim, figures and triage reason, in the casting, the picks board, every
 *     tension, every Overview insight (the uncapped ranked list, served list included: title, body, bars) and every
 *     verdict sentence is recomputed from its fact id (or its derived ref) alone and prints the same text - and no
 *     percentage in those texts is printed without an id;
 *  2. every statement's decision is recomputed from its facts: each logged gate of every detector (fired or not)
 *     recomputes to the value it was logged with, and every Map cell's verdict recomputes from its two side facts;
 *  3. for every Map cell, each of its numbers whose measure and subject also appear on the card it opens carries the
 *     SAME fact id as the card's (no Map number counts the same thing on another scope than its card).
 *
 * Fixture only, keyless:  SQLITE_PATH=data/dashboard_fixture.db VIEW_CACHE=off npx tsx scripts/statements_harness.mts
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
process.env.VIEW_CACHE = "off";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { loadViewData, cell } = await import(process.cwd() + "/src/lib/engine/view_data.ts");
const { cachedRunRevision } = await import(process.cwd() + "/src/lib/engine/run_revision.ts");
const { sharedAnalysisMap } = await import(process.cwd() + "/src/lib/engine/analysis_map.ts");
const { sharedBrandSummary } = await import(process.cwd() + "/src/lib/engine/brand_summary.ts");
const { rankedInsights, composeVerdict } = await import(process.cwd() + "/src/lib/engine/summary_insights.ts");
const { buildAnswerFacts } = await import(process.cwd() + "/src/lib/engine/facts/answer_facts.ts");
const { attachConditions } = await import(process.cwd() + "/src/lib/engine/facts/conditions.ts");
const { attachProducts } = await import(process.cwd() + "/src/lib/engine/facts/products.ts");
const { factBook } = await import(process.cwd() + "/src/lib/engine/facts/fact.ts");
const { EXTREME_ALL, EXTREME_ZERO, evalRef, evalGate, parseDerived, parseFactId } = await import(process.cwd() + "/src/lib/engine/facts/statements.ts");

const PCT = /<?\d+(?:\.\d+)?%|[+-]?\d+ points/g;
const failures: string[] = [];
const fail = (s: string) => {
  if (failures.length < 400) failures.push(s);
};
const tally = { nums: 0, statements: 0, uncovered: 0, gates: 0, decisions: 0, fired: 0, verdicts: 0, overrides: 0, cardShared: 0, cardDiffer: 0, excChecked: 0, words: 0 };

/** Every fact id string under a card object (PanelNum.fact and friends). */
function cardFacts(x: any, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((y) => cardFacts(y, out));
  else if (x && typeof x === "object")
    for (const [k, v] of Object.entries(x)) {
      if (k === "fact" && typeof v === "string") out.add(v);
      else cardFacts(v, out);
    }
  return out;
}

for (const project of (await store.listProjects()).filter((p: any) => !p.archived_at)) {
  const run = (await store.listRuns(project.id))[0];
  const data: any = await loadViewData(run, project, { setupDecision: true, judge: true });
  data.revision = await cachedRunRevision(run.id);
  const { view: map, debug } = await sharedAnalysisMap(data, {});
  const { view: summary, inputs } = await sharedBrandSummary(data, {});

  // The fresh book: nothing shared with the compute above.
  const set = buildAnswerFacts({ ...data }, {});
  attachProducts(set, project.category);
  await attachConditions(set, data, { map: false });
  const book = factBook(set);
  const scopeAnswers = new Map<string, string>();
  const answersKey = (sc: any) => {
    const k = JSON.stringify(sc);
    let v = scopeAnswers.get(k);
    if (v === undefined) scopeAnswers.set(k, (v = book.rows(sc).map((f: any) => f.responseId).sort().join(",")));
    return v;
  };

  /** One statement: its plain text and nums - every num recomputes, every percentage is covered. */
  const check = (where: string, text: string, nums: [number, number, string][] | undefined) => {
    tally.statements++;
    const covered: [number, number][] = [];
    for (const [at, len, ref] of nums ?? []) {
      tally.nums++;
      const shown = text.slice(at, at + len);
      let got: string;
      try {
        got = evalRef(book, ref).text;
      } catch (e: any) {
        fail(`${project.brand} ${where}: ref does not recompute (${e.message}) - ${ref}`);
        continue;
      }
      if (EXTREME_ZERO.has(shown) || EXTREME_ALL.has(shown)) {
        // A share printed as a word at its extreme: "never" / "none" is exactly zero, "every" / "always" exactly all.
        const x = evalRef(book, ref);
        tally.words++;
        const ok = EXTREME_ZERO.has(shown) ? x.n !== undefined && x.k === 0 : x.n !== undefined && x.n > 0 && x.k === x.n;
        if (!ok) fail(`${project.brand} ${where}: "${shown}" but ${ref} is ${x.k} of ${x.n}`);
      } else if (got !== shown) fail(`${project.brand} ${where}: "${shown}" but ${ref} recomputes to "${got}"`);
      covered.push([at, at + len]);
    }
    for (const m of text.matchAll(PCT)) {
      const a = m.index!;
      if (!covered.some(([x, y]) => a >= x && a < y)) {
        tally.uncovered++;
        fail(`${project.brand} ${where}: "${m[0]}" printed with no fact id - ${text.slice(Math.max(0, a - 60), a + 20)}`);
      }
    }
  };

  // 0. No marker leaves the layer: the served map and summary carry plain text only.
  for (const [what, obj] of [["map", map], ["summary", summary]] as [string, any][]) {
    const j = JSON.stringify(obj);
    const i = j.search(/\u2064|\u2062|⁤|⁢/);
    if (i >= 0) fail(`${project.brand} ${what}: a statement marker leaked - ${j.slice(Math.max(0, i - 80), i + 40)}`);
  }

  // 1a. The Map.
  for (const band of map.bands)
    for (const row of band.rows)
      for (const c of row.cells) {
        check(`${c.id} note`, c.note, c.facts?.note);
        const p: any = map.positions[c.id];
        if (!p) continue;
        check(`${c.id} claim`, p.claim, p.facts?.claim);
        check(`${c.id} why`, p.triageWhy, p.facts?.triageWhy);
        (p.figures ?? []).forEach((f: any, i: number) => check(`${c.id} figure "${f.label}"`, f.value, p.facts?.[`figures.${i}`]));
        if (p.exception) {
          check(`${c.id} exception share`, p.exception.lostShare, p.facts?.["exception.lostShare"]);
          p.exception.rows.forEach((r: any, i: number) => check(`${c.id} exception row "${r.text}"`, r.share, p.facts?.[`exception.rows.${i}`]));
        }
      }
  check("casting", map.casting.casting, map.casting.facts?.casting);
  check("casting detail", map.casting.detail, map.casting.facts?.detail);
  for (const b of map.shareOfDecided) {
    tally.nums++;
    if (!b.share.id) fail(`${project.brand} picks board ${b.brand}: no fact id`);
    else {
      const got = evalRef(book, b.share.id);
      if (got.k !== b.share.k || got.n !== b.share.n) fail(`${project.brand} picks board ${b.brand}: ${b.share.k}/${b.share.n} but ${b.share.id} recomputes ${got.k}/${got.n}`);
    }
  }
  for (const t of map.tensions) {
    check(`tension ${t.key} title`, t.title, t.facts?.title);
    check(`tension ${t.key} body`, t.body, t.facts?.body);
    for (const b of t.viz ?? []) {
      if (!b.fact) continue;
      tally.nums++;
      const got = evalRef(book, b.fact).text;
      if (got !== b.text) fail(`${project.brand} tension ${t.key} bar "${b.label}": "${b.text}" but ${b.fact} recomputes "${got}"`);
    }
  }

  // 1b. The Overview: every detector's insight (uncapped), the served list, the verdict.
  const decisions: any[] = [];
  const ranked = rankedInsights(summary, inputs, undefined, decisions);
  const verdictAgain = composeVerdict(summary, inputs, decisions);
  if (JSON.stringify(verdictAgain) !== JSON.stringify(summary.verdict)) fail(`${project.brand}: the verdict does not recompute to the served verdict`);
  for (const ins of [...ranked, ...summary.insights]) {
    check(`insight ${ins.key} title`, ins.title, ins.facts?.title);
    check(`insight ${ins.key} body`, ins.body, ins.facts?.body);
    (ins.viz ?? []).forEach((b: any, i: number) => {
      check(`insight ${ins.key} bar "${b.label}"`, b.text, ins.facts?.[`viz.${i}`]);
      if (b.fact && ins.facts?.[`viz.${i}`]?.[0]?.[2] !== b.fact) fail(`${project.brand} insight ${ins.key} bar "${b.label}": bar fact is not the bar's printed ref`);
    });
  }
  for (const v of summary.verdict) check(`verdict ${v.key}`, v.text, v.facts?.text);

  // 2. Decisions: every logged gate recomputes to its logged value.
  const kn = (ref: string) => {
    const r = evalRef(book, ref);
    return { k: r.k ?? 0, n: r.n ?? 0 };
  };
  for (const d of decisions) {
    tally.decisions++;
    if (d.fired) tally.fired++;
    for (const g of d.gates) {
      tally.gates++;
      const again = evalGate(g.rule, g.refs.map(kn), g.arg);
      if (again !== g.pass) fail(`${project.brand} ${d.key}: gate ${g.rule}(${g.refs.join(", ")}) logged ${g.pass}, recomputes ${again}`);
    }
  }
  // Map verdicts from the two side facts.
  const classify = (b: number, t: number, dd: number) => {
    if (dd < 20 || b + t === 0) return "nocall";
    const B = cell(b, dd);
    const T = cell(t, dd);
    if (B.low > T.high) return "yours";
    if (T.low > B.high) return "theirs";
    const bs = b / dd;
    const ts = t / dd;
    if ((bs >= 0.15 && ts >= 0.15) || (bs < 0.15 && ts < 0.15)) return "contested";
    return b > t ? "yours" : "theirs";
  };
  for (const [id, st] of Object.entries(debug.cells) as [string, any][]) {
    if (st.override) {
      tally.overrides++;
      continue;
    }
    tally.verdicts++;
    const y = kn(st.youFact);
    const t = kn(st.themFact);
    if (y.n !== t.n) fail(`${project.brand} ${id}: the two side facts have different bases (${y.n} vs ${t.n})`);
    const v = classify(y.k, t.k, y.n);
    if (v !== st.verdict) fail(`${project.brand} ${id}: verdict ${st.verdict} but its side facts recompute to ${v}`);
  }

  // 3a. The lost-with-an-exception figures read the card's own exception step: the Map's share is the step's "still"
  // segment and each Map row is the card's "Who it still sends to you" row of the same name, under the same fact id
  // (base: the answers that pick the rival in that matchup).
  for (const [id, p] of Object.entries(map.positions) as [string, any][]) {
    if (!p.exception) continue;
    const step = p.panel?.steps?.find((x: any) => x.key === "exception");
    const still = step?.segments?.find((x: any) => x.key === "still");
    const lost = (p.facts?.["exception.lostShare"] ?? [])[0]?.[2];
    tally.excChecked++;
    if (!still || !lost || still.num?.fact !== lost) fail(`${project.brand} ${id}: the Map's exception share ${lost} is not the card's step fact ${still?.num?.fact}`);
    const sec = p.panel?.details?.exception?.sections?.[0];
    const cardRows = new Map<string, string>((sec?.rows ?? []).map((r: any) => [r.label, r.num?.fact]));
    p.exception.rows.forEach((r: any, i: number) => {
      tally.excChecked++;
      const mine = (p.facts?.[`exception.rows.${i}`] ?? [])[0]?.[2];
      const theirs = cardRows.get(r.text);
      if (!theirs || mine !== theirs) fail(`${project.brand} ${id}: exception row "${r.text}" ${mine} is not the card's row ${theirs}`);
    });
  }

  // 3. A Map cell and its card: the same measure and subject carry the same fact id.
  for (const [id, p] of Object.entries(map.positions) as [string, any][]) {
    if (!p.panel) continue;
    const card = [...cardFacts(p.panel)].filter((f) => !f.startsWith("avg(") && !parseDerived(f));
    const cardByMS = new Map<string, Set<string>>();
    for (const f of card) {
      try {
        const q = parseFactId(f);
        const k = `${q.measure}|${q.subject}`;
        const s = cardByMS.get(k) ?? new Set<string>();
        s.add(f);
        cardByMS.set(k, s);
      } catch {
        /* not a fact id */
      }
    }
    const cellRefs = new Set<string>();
    const cellOf = map.bands.flatMap((b: any) => b.rows.flatMap((r: any) => r.cells)).find((c: any) => c.id === id);
    for (const nums of [...Object.values(p.facts ?? {}), ...Object.values(cellOf?.facts ?? {})] as any[]) for (const [, , ref] of nums) if (!parseDerived(ref)) cellRefs.add(ref);
    for (const ref of cellRefs) {
      const q = parseFactId(ref);
      const same = cardByMS.get(`${q.measure}|${q.subject}`);
      if (!same) continue;
      tally.cardShared++;
      if (!same.has(ref)) {
        // The card draws this measure about this subject on another scope: a different number unless the two scopes
        // hold the same answers - then the Map and its card count one thing under two ids.
        const mine = answersKey(q.scope);
        const twin = [...same].find((f) => answersKey(parseFactId(f).scope) === mine);
        if (twin) {
          tally.cardDiffer++;
          fail(`${project.brand} ${id}: the Map prints ${ref} where its card prints ${twin} (the same answers)`);
        }
      }
    }
  }
  console.log(`${project.brand}: ${tally.nums} numbers so far, ${tally.gates} gates, ${tally.verdicts} verdicts`);
}

console.log(`\nstatements ${tally.statements}, numbers recomputed ${tally.nums}, percentages with no id ${tally.uncovered}`);
console.log(`decisions ${tally.decisions} (fired ${tally.fired}), gates recomputed ${tally.gates}, Map verdicts recomputed ${tally.verdicts} (+${tally.overrides} computed criteria verdicts)`);
console.log(`Shares printed as never / none / every / always, each checked exact: ${tally.words}`);
console.log(`Lost-with-an-exception figures matched to the card's exception step: ${tally.excChecked}`);
console.log(`Map numbers sharing a measure and subject with their card: ${tally.cardShared}; counted on the same answers under another id: ${tally.cardDiffer}`);
if (failures.length) {
  console.log(`\nFAIL (${failures.length}${failures.length >= 400 ? "+" : ""}):`);
  for (const f of failures.slice(0, 120)) console.log("  " + f);
  process.exit(1);
}
console.log("\nPASS");
