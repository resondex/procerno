/* eslint-disable @typescript-eslint/no-explicit-any -- a harness over the served payloads */
/**
 * The Brief's pins and answer cards on the fact layer (FACT_LAYER_DESIGN_2026-11-17.md step 5, part 2). A number links
 * by its fact id (scripts/brief_links_harness.mts checks every link), so a pin is only a phrase link on a unit with no
 * number. For every Brief of the test copy (each tracker's own and every rival subject's), every frame, this asserts:
 *
 *  (a) every pin sits on a unit with NO number token, is a Map-cell pin, and carries an `at` phrase present in that
 *      unit's visible text (the phrase the reader clicks - bf15);
 *  (b) no row carries a pin (a row's numbers link by fact id);
 *  (c) every pin's card is in view.cards, and every card is a Map-cell card (the brand, assistants and condition answer
 *      cards are retired);
 *  (d) every answer card is a statement: every number token in its headline and rows sits under `facts` with a fact id,
 *      and that fact recomputes from its id alone to the number printed.
 *
 *   npx tsx scripts/brief_citation_harness.mts [brand substring]
 *
 * Fixture only, keyless (DATABASE_URL blanked, SQLITE_PATH at data/dashboard_fixture.db, every API key blanked).
 */
const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = REPO + "/data/dashboard_fixture.db";
process.env.VIEW_CACHE = "off";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
process.env.RUN_COLLECT_ONLY = "1";

const { store } = await import(REPO + "/src/lib/store/index.ts");
const { loadViewData } = await import(REPO + "/src/lib/engine/view_data.ts");
const { cachedRunRevision } = await import(REPO + "/src/lib/engine/run_revision.ts");
const { computeBrief, briefNumberTokens } = await import(REPO + "/src/lib/engine/brief.ts");
const { buildAnswerFacts } = await import(REPO + "/src/lib/engine/facts/answer_facts.ts");
const { attachConditions } = await import(REPO + "/src/lib/engine/facts/conditions.ts");
const { attachProducts } = await import(REPO + "/src/lib/engine/facts/products.ts");
const { factBook } = await import(REPO + "/src/lib/engine/facts/fact.ts");
const { evalRef } = await import(REPO + "/src/lib/engine/facts/statements.ts");
const { printWhole, printFine } = await import(REPO + "/src/lib/engine/facts/measure_book.ts");

const want = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "").toLowerCase();
const projects = (await store.listProjects()).filter((p: any) => !p.archived_at && p.brand.toLowerCase().includes(want));
const NUM = /\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g;
const bad: string[] = [];
const t = { briefs: 0, units: 0, numberless: 0, pins: 0, cards: 0, cardNumbers: 0 };

for (const project of projects) {
  const run = (await store.listRuns(project.id))[0];
  if (!run) continue;
  const data: any = await loadViewData(run, project, { setupDecision: true, judge: true });
  if (!data) continue;
  data.revision = await cachedRunRevision(run.id);
  const set = buildAnswerFacts({ ...data }, {});
  attachProducts(set, project.category);
  await attachConditions(set, data, { map: false });
  const book = factBook(set);
  const first: any = await computeBrief(data, {});
  for (const subject of [undefined, ...first.subjects.slice(1)]) {
    const view: any = subject ? await computeBrief(data, { subject }) : first;
    t.briefs++;
    const who = `${project.brand}${subject ? ` [rival ${subject}]` : ""}`;
    const used = new Set<string>();
    for (const [frame, memo] of Object.entries(view.memos) as any[]) {
      for (const s of memo.sections) {
        const paras: any[] = [...(s.paras ?? []), ...(s.quads ?? []).flatMap((q: any) => q.cells.flat())];
        for (const p of paras) {
          t.units++;
          const visible = `${p.lead ?? ""} ${p.text}`;
          const hasNum = briefNumberTokens(visible).size > 0;
          if (!hasNum) t.numberless++;
          for (const a of p.cells ?? []) {
            t.pins++;
            used.add(a.id);
            if (hasNum) bad.push(`(a) ${who} [${frame}/${s.key}] pin ${a.id} on a unit with numbers: "${visible.slice(0, 120)}"`);
            if ((a.kind ?? "cell") !== "cell") bad.push(`(a) ${who} [${frame}/${s.key}] pin ${a.id} is a ${a.kind} pin`);
            if (!a.at || !visible.includes(a.at)) bad.push(`(a) ${who} [${frame}/${s.key}] pin ${a.id} ${a.at ? `at "${a.at}" not in its text` : "has no at"}`);
          }
        }
        for (const r of s.rows ?? []) if (r.cell) bad.push(`(b) ${who} [${frame}/${s.key}] row "${r.label}" carries a pin`);
      }
    }
    for (const id of used) if (!view.cards?.[id]) bad.push(`(c) ${who} pin ${id} has no card`);
    for (const [id, card] of Object.entries(view.cards ?? {}) as any[]) {
      t.cards++;
      if (card.kind !== "cell") bad.push(`(c) ${who} card ${id} is a ${card.kind} card`);
      const fields: [string, string][] = [["headline", card.headline], ...card.rows.map((r: any, i: number) => [`rows.${i}`, r.value] as [string, string])];
      for (const [f, text] of fields) {
        const nums = (card.facts?.[f] ?? []) as [number, number, string][];
        for (const m of text.matchAll(NUM)) {
          t.cardNumbers++;
          const n = nums.find(([at, len]) => m.index! >= at && m.index! < at + len);
          if (!n) {
            bad.push(`(d) ${who} card ${id} ${f}: ${m[0]} carries no fact: "${text.slice(0, 120)}"`);
            continue;
          }
          const shown = text.slice(n[0], n[0] + n[1]);
          let r: any;
          try {
            r = evalRef(book, n[2]);
          } catch (e: any) {
            bad.push(`(d) ${who} card ${id} ${f}: ${shown} - its fact ${n[2]} cannot be recomputed: ${e.message}`);
            continue;
          }
          const ok = [r.text, r.k !== undefined ? printWhole(r.k, r.n) : "", r.k !== undefined ? printFine(r.k, r.n) : ""].some((x) => (x.match(NUM) ?? []).join(" ") === (shown.match(NUM) ?? []).join(" "));
          if (!ok) bad.push(`(d) ${who} card ${id} ${f}: ${shown} is not its fact ${n[2]} = ${r.text}`);
        }
      }
    }
  }
}

console.log(`Briefs ${t.briefs}; paragraphs ${t.units} (${t.numberless} with no number); pins ${t.pins}; answer cards ${t.cards} with ${t.cardNumbers} numbers`);
for (const l of bad.slice(0, 200)) console.log("  " + l);
console.log(bad.length ? `\nFAIL: ${bad.length}` : "\nALL PASS - pins only on numberless units (Map-cell phrase links), every answer card a statement whose numbers recompute from their fact ids");
process.exit(bad.length ? 1 : 0);
