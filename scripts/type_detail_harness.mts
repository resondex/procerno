/* eslint-disable @typescript-eslint/no-explicit-any -- a harness over the served payloads */
/**
 * Question type detail on the fact layer (FACT_LAYER_DESIGN_2026-11-17.md step 8). For each of the six trackers on the
 * test copy, under three requests (every buyer; one buyer filter; an assistant subset), the Stations view and every
 * per-type section it expands into (the type_detail bundle) are walked, and against a FRESH fact book and selection
 * book (buildAnswerFacts + products + conditions + the awareness quote groups - nothing shared with the compute):
 *
 *  - every rate (an object with counts) carries a fact id, and the id read back (parseFactId) recomputes to the same
 *    counts; a rate with no id fails;
 *  - every plain count of answers carries its fact (`answersFact`), recomputed to the same count;
 *  - every number inside a sentence (an anchor's text, an inventory row's "beside") is its listed fact's printed text,
 *    in order; every reason row's share is its fact's printed text;
 *  - every list with a selection id (`sels`) recomputes from the id alone (selectionFromId) to the same names in the same
 *    order (a list joining two selections: the same names), and each listed count is the member's count.
 *
 * Exits non-zero on any failure. Fixture only, no model calls, writes nothing:
 *   npx tsx scripts/type_detail_harness.mts
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
process.env.VIEW_CACHE = "off";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";

const ROOT = process.cwd();
const { store } = await import(ROOT + "/src/lib/store/index.ts");
const { loadViewData } = await import(ROOT + "/src/lib/engine/view_data.ts");
const { cachedRunRevision } = await import(ROOT + "/src/lib/engine/run_revision.ts");
const { computeJourneyFromData } = await import(ROOT + "/src/lib/engine/journey.ts");
const { computeTypeDetail, attachQuoteGroups } = await import(ROOT + "/src/lib/engine/facts/type_detail.ts");
const { buildAnswerFacts } = await import(ROOT + "/src/lib/engine/facts/answer_facts.ts");
const { attachConditions } = await import(ROOT + "/src/lib/engine/facts/conditions.ts");
const { attachProducts } = await import(ROOT + "/src/lib/engine/facts/products.ts");
const { factBook } = await import(ROOT + "/src/lib/engine/facts/fact.ts");
const { selectionBook, selectionFromId } = await import(ROOT + "/src/lib/engine/facts/selections.ts");
const { parseFactId } = await import(ROOT + "/src/lib/engine/facts/statements.ts");

const failures: string[] = [];
const fail = (s: string) => {
  if (failures.length < 200) failures.push(s);
};
const tot = { rates: 0, answers: 0, sentenceNums: 0, reasonShares: 0, lists: 0, listCounts: 0, honesty: 0 };

const isRate = (v: any) => v && typeof v === "object" && typeof v.k === "number" && typeof v.n === "number";
/** Plain numbers that are not counts of answers drawn as a fact: the honesty count of uncoded answers, a station's
 * number of question kinds asked (a count of rows), a matchup's number of questions (not drawn), a rate's range. */
const NOT_FACTS = new Set(["uncoded", "kinds", "cells", "low", "high"]);

const projects = (await store.listProjects()).filter((p: any) => !p.archived_at);
for (const project of projects) {
  const run = (await store.listRuns(project.id))[0];
  const data: any = await loadViewData(run, project, { setupDecision: true, codeGroups: true, judge: true });
  data.revision = await cachedRunRevision(run.id);
  const j0 = await computeJourneyFromData(data, {});
  const room = j0?.rooms?.[0];
  const engines = ["claude-sonnet-5", "gemini-pro-latest", "sonar", "grok-4.6"];
  const reqs: [string, any][] = [["all", {}], ...(room ? ([["room", { room }]] as [string, any][]) : []), ["eng", { engines }]];
  for (const [label, req] of reqs) {
    const eng = req.engines ? { engines: req.engines } : {};
    // The fresh books.
    const set = buildAnswerFacts(data, eng.engines ? { engines: eng.engines } : {});
    attachProducts(set, project.category);
    await attachConditions(set, data, { map: false });
    await attachQuoteGroups(set, data, "routing", req);
    if (req.room !== undefined) await attachQuoteGroups(set, data, "routing", eng);
    await attachQuoteGroups(set, data, "explainer", eng);
    const book = factBook(set);
    const sb = selectionBook(set, book, data);
    const recompute = (id: string) => {
      const p = parseFactId(id);
      return book.fact(p.measure, p.subject, p.scope);
    };
    const where = (path: string) => `${project.brand} [${label}] ${path}`;

    const checkList = (holder: any, field: string, ids: string[], path: string) => {
      // field may be a dotted path relative to the holder; an array step is matched by its element's key.
      let arr: any = holder;
      for (const seg of field.split(".")) {
        if (Array.isArray(arr)) arr = arr.find((x: any) => x?.key === seg);
        else arr = arr?.[seg];
      }
      if (!Array.isArray(arr)) return fail(`${where(path)}: list ${field} not found`);
      tot.lists++;
      const sels = ids.map((id) => {
        try {
          return selectionFromId(sb, id);
        } catch (e: any) {
          fail(`${where(path)}: list ${field} selection ${id} does not recompute: ${e.message}`);
          return null;
        }
      });
      if (sels.some((s) => !s)) return;
      const names = (x: any) => x.name ?? x.label ?? x.code;
      const memberName = (m: any) => m.name;
      if (sels.length === 1) {
        const ms = sels[0]!.members as any[];
        // The tracker may be added to a list (always shown) or left out of it (Habit's "picked instead"): compared without it.
        const shown = arr.map(names).filter((n: string) => n !== project.brand);
        const want = ms.map(memberName).filter((n: string) => n !== project.brand);
        if (JSON.stringify(shown) !== JSON.stringify(want)) fail(`${where(path)}: list ${field} ${JSON.stringify(shown)} vs its selection ${JSON.stringify(want)}`);
        for (const x of arr) {
          if (typeof x.n !== "number") continue;
          const m = ms.find((y: any) => y.name === names(x));
          tot.listCounts++;
          if (!m || m.count !== x.n) fail(`${where(path)}: list ${field} "${names(x)}" count ${x.n} vs ${m?.count}`);
        }
      } else {
        const want = new Set(sels.flatMap((s) => (s!.members as any[]).map(memberName)).filter((n: string) => n !== project.brand));
        const shown = new Set(arr.map(names).filter((n: string) => n !== project.brand));
        if ([...shown].some((n) => !want.has(n)) || [...want].some((n) => !shown.has(n))) fail(`${where(path)}: list ${field} names differ from its selections`);
      }
    };

    const walk = (v: any, path: string, parent: any) => {
      if (v === null || v === undefined) return;
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${x?.key ?? x?.name ?? x?.code ?? x?.label ?? i}]`, v));
      if (isRate(v)) {
        tot.rates++;
        if (typeof v.id !== "string") return fail(`${where(path)}: a rate with no fact (${v.k} of ${v.n})`);
        try {
          const f = recompute(v.id);
          if (f.k !== v.k || f.n !== v.n) fail(`${where(path)}: ${v.k}/${v.n} vs its fact ${f.k}/${f.n} (${v.id})`);
        } catch (e: any) {
          fail(`${where(path)}: ${v.id} does not recompute: ${e.message}`);
        }
        return;
      }
      if (typeof v !== "object") return;
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === "number") {
          if (k === "answers" || k === "pooledAnswers") {
            const id = k === "answers" ? v.answersFact : v.pooledFact;
            if (typeof id !== "string") {
              if (x === 0 && v.asked === false) continue;
              if (path.includes(".reasons") || path.includes("reasonsByType")) continue; // a reason row's answers = its share fact's k (checked below)
              fail(`${where(path)}.${k}: a count of answers with no fact`);
              continue;
            }
            tot.answers++;
            const f = recompute(id);
            if (f.k !== x) fail(`${where(path)}.${k}: ${x} vs its fact ${f.k}`);
            continue;
          }
          if (k === "n" && parent && Array.isArray(parent)) continue; // a list member's count: checked against its selection
          if (k === "base") continue; // a reason side's base: every answer of the question type (the shares' denominator, tooltip only)
          if (NOT_FACTS.has(k)) {
            tot.honesty++;
            continue;
          }
          if (["onKeep", "onLeave", "onUndecided"].includes(k)) {
            if (v.by?.[k === "onKeep" ? "keep" : k === "onLeave" ? "leave" : "undecided"]?.k !== x) fail(`${where(path)}.${k}: ${x} is not its fact's count`);
            continue;
          }
          fail(`${where(path)}.${k}: a plain number (${x}) with no fact`);
        }
      }
      // Sentences with numbers.
      const sentence = (text: string, ids: string[] | undefined, what: string) => {
        if (!ids) return;
        let at = 0;
        for (const id of ids) {
          tot.sentenceNums++;
          const t = recompute(id).text;
          const i = text.indexOf(t, at);
          if (i < 0) fail(`${where(path)}.${what}: "${text}" does not print ${t} (${id}) in order`);
          else at = i + t.length;
        }
      };
      if (typeof v.beside === "string") sentence(v.beside, v.besideFacts, "beside");
      if (typeof v.text === "string" && Array.isArray(v.facts)) sentence(v.text, v.facts, "text");
      if (typeof v.share === "string" && typeof v.fact === "string") {
        tot.reasonShares++;
        const f = recompute(v.fact);
        if (f.text !== v.share) fail(`${where(path)}: share "${v.share}" vs its fact "${f.text}"`);
        if (typeof v.answers === "number" && v.answers !== f.k) fail(`${where(path)}: answers ${v.answers} vs its fact ${f.k}`);
      }
      if (v.sels) for (const [field, ids] of Object.entries(v.sels as Record<string, string[]>)) checkList(v, field, ids, path);
      for (const [k, x] of Object.entries(v)) if (k !== "sels" && x && typeof x === "object") walk(x, `${path}.${k}`, v);
    };

    const journey = await computeJourneyFromData(data, req);
    if (!journey) fail(`${project.brand} [${label}]: no journey`);
    walk(journey, "journey", null);
    const bundle = await computeTypeDetail(data, req);
    walk(bundle, "sections", null);
    // The sections the page mounts across all buyers under a buyer filter.
    if (req.room !== undefined) walk(await computeTypeDetail(data, eng), "sections(all buyers)", null);
  }
  console.log(`${project.brand}: checked`);
}

console.log(
  `\n${tot.rates} rates recomputed from their fact ids, ${tot.answers} counts of answers, ${tot.sentenceNums} numbers inside sentences, ${tot.reasonShares} reason shares, ${tot.lists} lists (${tot.listCounts} member counts) from their selection ids; ${tot.honesty} plain counts that are not facts (uncoded answers, kinds asked, a rate's range).`
);
if (failures.length) {
  console.log(`\nFAIL - ${failures.length} problems:`);
  for (const f of failures.slice(0, 60)) console.log("  " + f);
  process.exit(1);
}
console.log("PASS");
process.exit(0);
