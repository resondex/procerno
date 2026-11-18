/* eslint-disable @typescript-eslint/no-explicit-any -- a harness over the served payloads */
/**
 * The Brief as statements over the fact layer (FACT_LAYER_DESIGN_2026-11-17.md step 5, part 2). For EVERY Brief of the
 * test copy - each tracker's own and every rival subject's - every frame, this checks, from a fact book and selection
 * book built afresh (buildAnswerFacts + conditions + products + factBook + selectionBook - nothing shared with the
 * compute):
 *
 *  1. NUMBERS: every number token in every field of every memo and answer card (paragraph leads and text, quadrant
 *     cells, scoreboard and stage rows with their competitor columns and notes, tables, chart titles, labels and values,
 *     headings, titles, footers) is covered by a figure that carries a fact id (or a derived ref) - zero bare numbers;
 *     and every figure recomputes from its id alone to the very text printed (the measure's print, or the same counts
 *     printed whole or to one decimal as the card it came from draws them).
 *  2. LINKS: every link carries the fact of its number; it opens a card location (stat_registry.ts) that draws that same
 *     fact, with exactly that location's reveal; the link's number recomputes from the fact. No link without a fact.
 *  3. NAMES AND LISTS: every name the Brief states in a role a card or selection gives it (brief.ts nameOn) is a member
 *     of the selection whose id it carries - recomputed from the id alone (selections.ts selectionFromId) - or the
 *     subject of the fact it carries (a destination's brand, a cell's own rival / worry / buying situation).
 *  4. SOURCE: brief.ts has no matching path (no resolver, no number read out of text, no answer cards built from the old
 *     summary) and counts nothing itself (no read of the coded answers, the answer facts' rows or a fact book count
 *     outside the one helper that prints a fact no card draws).
 *
 * Prints the counts, saying what each counts and over how many Briefs; lists every number whose fact no card draws
 * (needs a card home, or the chart reference line no card is to draw by design).
 *
 * Fixture only, keyless:  SQLITE_PATH=data/dashboard_fixture.db VIEW_CACHE=off npx tsx scripts/brief_links_harness.mts
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
process.env.VIEW_CACHE = "off";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
process.env.BRIEF_FIG_LOG = "1";
process.env.BRIEF_NAME_LOG = "1";
process.env.BRIEF_TRIM_LOG = "1";
process.env.BRIEF_STRICT_FUNNEL = "1";

const ROOT = process.cwd();
const fs = await import("node:fs");
const { store } = await import(ROOT + "/src/lib/store/index.ts");
const { loadViewData } = await import(ROOT + "/src/lib/engine/view_data.ts");
const { cachedRunRevision } = await import(ROOT + "/src/lib/engine/run_revision.ts");
const { computeBrief, FIG_LOG, FIELD_LOG, NAME_LOG, TRIMMED_CLAIMS, stripFunnel } = await import(ROOT + "/src/lib/engine/brief.ts");
const { sharedAnalysisMap } = await import(ROOT + "/src/lib/engine/analysis_map.ts");
const { sharedBrandSummary } = await import(ROOT + "/src/lib/engine/brand_summary.ts");
const { buildStatRegistry } = await import(ROOT + "/src/lib/engine/stat_registry.ts");
const { buildAnswerFacts } = await import(ROOT + "/src/lib/engine/facts/answer_facts.ts");
const { attachConditions } = await import(ROOT + "/src/lib/engine/facts/conditions.ts");
const { attachProducts } = await import(ROOT + "/src/lib/engine/facts/products.ts");
const { factBook } = await import(ROOT + "/src/lib/engine/facts/fact.ts");
const { selectionBook, selectionFromId, averageCompetitor, scopeFromKey } = await import(ROOT + "/src/lib/engine/facts/selections.ts");
const { parseDerived, parseFactId, derivedValue, printDerived } = await import(ROOT + "/src/lib/engine/facts/statements.ts");
const { MEASURE_BY_ID, printOf, printWhole, printFine } = await import(ROOT + "/src/lib/engine/facts/measure_book.ts");

const NUM = /\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g;
const failures: string[] = [];
const fail = (s: string) => {
  if (failures.length < 300) failures.push(s);
};

/* ------------------------------- 4. the source ------------------------------- */
{
  const src = fs.readFileSync(ROOT + "/src/lib/engine/brief.ts", "utf8");
  const lines = src.split("\n");
  const rules: [RegExp, string, RegExp?][] = [
    [/\blinkResolver\b|\bnumberContext\b|\bR\.find\(|\bR\.shows\(|brief_links/, "a matching resolver"],
    [/\blegacyFig\b|\bnoHome\(|\blegacyV\b|\bc\.legacy\b|brief_legacy_inputs|\bliftForBrand\b|\blegacyRoomCodes\b|\blegacyArgs\b/, "an old-source fallback"],
    [/cardText\(|indexPanel\(|indexAcross\(|numberTokens\(/, "a number read off a card's text"],
    [/\.match\(\/<1%\|\\d|parseFloat\(|Number\([a-z]+\.value/, "a number parsed out of text"],
    [/\bdata\.(codes|responses|prompts)\b|\bpoolOf\(|\bbook\.rows\(|\.answers\(|\.countUnchecked\(/, "a count made over the answers"],
    [/rf\.book\.fact\(/, "a fact counted outside factFig", /^const factFig = |^\s*const f = c\.rf\.book\.fact\(measure, subject, scope\);/],
    [/rf\.set\.facts/, "the answer facts read outside the codebook's names", /const argCodes = \[\.\.\.new Set\(rf\.set\.facts\.flatMap\(\(f\) => f\.args \?\? \[\]\)\)\]\.sort\(\);/],
    [/\.(mentioned|chosen|shareOfDecided|firmPickInCategory|firmPick|byMode|byEngine|headToHead|buyersDoubt|customersDoubt)\b/, "an old summary figure", /^type BriefSummary|h2h: summary\.headToHead\.map|const \{ target: _t,|FUNNEL_FIELDS = |SUMMARY_FUNNEL_FIELDS = |SUMMARY_VERDICT_FIELDS = /],
  ];
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*\*)/.test(l) || /^const BRIEF_VERSION = /.test(l)) return;
    for (const [re, what, ok] of rules) if (re.test(l) && !(ok && ok.test(l))) fail(`brief.ts:${i + 1} ${what}: ${l.trim().slice(0, 150)}`);
  });
  for (const f of ["brief_links.ts", "brief_legacy_inputs.ts"]) if (fs.existsSync(`${ROOT}/src/lib/engine/${f}`)) fail(`src/lib/engine/${f} still exists`);
}

/* ------------------------------- the briefs ------------------------------- */
const tally = {
  briefs: 0,
  fields: 0,
  numbers: 0,
  bare: 0,
  figures: 0,
  recomputed: 0,
  printWhole: 0,
  printFine: 0,
  links: 0,
  linksNoFact: 0,
  linksOk: 0,
  linkOnView: 0,
  linkOneReveal: 0,
  numbersUnlinked: 0,
  unlinkedDrawn: 0,
  unlinkedNoCard: 0,
  cardNumbers: 0,
  names: 0,
  namesBySel: 0,
  namesByFact: 0,
};
const nameKinds = new Map<string, number>();
const noCard = new Map<string, string[]>();
const unlinkedKinds = new Map<string, number>();
const perTracker: string[] = [];

for (const project of (await store.listProjects()).filter((p: any) => !p.archived_at)) {
  const run = (await store.listRuns(project.id))[0];
  const data: any = await loadViewData(run, project, { setupDecision: true, judge: true });
  data.revision = await cachedRunRevision(run.id);
  const { view: map } = await sharedAnalysisMap(data, {});
  const { view: summary } = await sharedBrandSummary(data, {});
  const reg = buildStatRegistry(map);
  const drawn = new Set(reg.all().map((s: any) => s.fact).filter(Boolean));

  // The fresh book: nothing shared with the compute.
  const set = buildAnswerFacts({ ...data }, {});
  attachProducts(set, project.category);
  await attachConditions(set, data, { map: false });
  const book = factBook(set);
  const sb = selectionBook(set, book, data);
  const T = set.target.key;

  /** A ref recomputed from its id alone: a fact, the average competitor of a selection, or a derived ref. */
  const recompute = (ref: string): { k: number; n: number; texts: string[] } => {
    const d = parseDerived(ref);
    if (d) {
      const xs = d.refs.map((r: string) => recompute(r));
      const v = derivedValue(d.op, xs, d.arg);
      return { k: NaN, n: NaN, texts: [printDerived(d.op, v)] };
    }
    if (ref.startsWith("avg(")) {
      // "avg(<measure>)|<competitor selection id>[|<the measure's own scope when it differs>]"
      const m = ref.slice(4, ref.indexOf(")"));
      const rest = ref.slice(ref.indexOf(")|") + 2);
      const i1 = rest.indexOf("|t=");
      const i2 = rest.indexOf("|t=", i1 + 1);
      const sel = selectionFromId(sb, i2 > 0 ? rest.slice(0, i2) : rest);
      const scope = i2 > 0 ? scopeFromKey(rest.slice(i2 + 1)) : sel.scope;
      const per = sel.members.map((x: any) => book.fact(m, x.key === T ? "you" : x.key, scope));
      const a = averageCompetitor(per, m, "ruled");
      return { k: a.k, n: a.n, texts: [printOf(MEASURE_BY_ID.get(m)!, a.k, a.n)] };
    }
    const { measure, subject, scope } = parseFactId(ref);
    const f = book.fact(measure, subject, scope);
    if (f.id !== ref) throw new Error(`recomputes under ${f.id}`);
    return { k: f.k, n: f.n, texts: [f.text] };
  };
  const recomputeMemo = new Map<string, ReturnType<typeof recompute> | Error>();
  const rc = (ref: string) => {
    if (!recomputeMemo.has(ref)) {
      try {
        recomputeMemo.set(ref, recompute(ref));
      } catch (e: any) {
        recomputeMemo.set(ref, e);
      }
    }
    return recomputeMemo.get(ref)!;
  };
  const tokens = (v: string) => (v.match(NUM) ?? []) as string[];
  /** Whether a printed value is the fact's own print, or its counts printed whole / to one decimal. */
  const printOk = (ref: string, value: string): "fact" | "whole" | "fine" | null => {
    const r = rc(ref);
    if (r instanceof Error) return null;
    const v = tokens(value).join(" ");
    if (r.texts.some((t) => tokens(t).join(" ") === v)) return "fact";
    if (!Number.isNaN(r.k) && tokens(printWhole(r.k, r.n)).join(" ") === v) return "whole";
    if (!Number.isNaN(r.k) && tokens(printFine(r.k, r.n)).join(" ") === v) return "fine";
    return null;
  };

  const before = { fig: FIG_LOG.length, field: FIELD_LOG.length, name: NAME_LOG.length };
  const first: any = await computeBrief(data, {});
  const briefs: [string | undefined, any][] = [[undefined, first]];
  for (const s of first.subjects.slice(1)) briefs.push([s, await computeBrief(data, { subject: s })]);
  tally.briefs += briefs.length;

  // 1. Every field: no bare number; every figure recomputes.
  for (const e of FIELD_LOG.slice(before.field) as any[]) {
    tally.fields++;
    const n = tokens(e.text).length;
    tally.numbers += n;
    if (e.section.startsWith("card ")) tally.cardNumbers += n;
    tally.bare += e.bare.length;
    for (const b of e.bare) fail(`${e.brand}${e.subject ? ` [rival ${e.subject}]` : ""} [${e.frame}/${e.section} ${e.field}] ${b} printed with no fact: "${e.text.slice(0, 160)}"`);
  }
  for (const e of FIG_LOG.slice(before.fig) as any[]) {
    tally.figures++;
    const where = `${e.brand}${e.subject ? ` [rival ${e.subject}]` : ""} [${e.frame}/${e.section} ${e.field}]`;
    const ok = printOk(e.ref, e.value);
    const r = rc(e.ref);
    if (r instanceof Error) fail(`${where} ${e.token}: its fact ${e.ref} cannot be recomputed: ${r.message}`);
    else if (!ok) fail(`${where} ${e.token} (printed "${e.value}") is not its fact ${e.ref} = ${r.texts.join(" / ")} (${r.k}/${r.n})`);
    else {
      tally.recomputed++;
      if (ok === "whole") tally.printWhole++;
      if (ok === "fine") tally.printFine++;
    }
    if (e.stat) {
      const st = reg.get(e.stat);
      if (!st || st.fact !== e.ref) fail(`${where} ${e.token} was printed from card stat ${e.stat}, which draws ${st?.fact ?? "(no stat)"} - not ${e.ref}`);
    }
    // Every figure in a field with no links, or a sentence figure not linked: is its fact drawn on some card?
    if (!drawn.has(e.ref)) {
      const kind = parseDerived(e.ref) ? `a derived figure (${parseDerived(e.ref)!.op})` : parseFactId(e.ref).measure;
      const xs = noCard.get(kind) ?? [];
      xs.push(`${where} ${e.value} = ${e.ref.slice(0, 120)}  in "${e.text.slice(0, 140)}"`);
      noCard.set(kind, xs);
    }
  }

  // 2. Links.
  const figsOf = (subj: string | undefined) => (FIG_LOG.slice(before.fig) as any[]).filter((e) => (e.subject ?? undefined) === subj);
  for (const [subj, brief] of briefs) {
    const figs = figsOf(subj);
    for (const [frame, memo] of Object.entries(brief.memos) as any[]) {
      for (const sec of memo.sections) {
        const units: { text: string; links?: any[] }[] = [];
        for (const p of sec.paras ?? []) units.push({ text: `${p.lead ?? ""} ${p.text}`, links: p.links });
        for (const q of sec.quads ?? []) for (const col of q.cells) for (const p of col) units.push({ text: `${p.lead ?? ""} ${p.text}`, links: p.links });
        for (const r of sec.rows ?? []) units.push({ text: r.kind === "note" ? r.label : r.value, links: r.links });
        for (const u of units) {
          const nums = tokens(u.text).length;
          const lk = u.links ?? [];
          tally.numbersUnlinked += nums - lk.length;
          for (const l of lk) {
            tally.links++;
            const where = `${project.brand}${subj ? ` [rival ${subj}]` : ""} [${frame}/${sec.key}] ${l.token}`;
            if (!l.fact) {
              tally.linksNoFact++;
              fail(`${where} is linked with no fact (matched)`);
              continue;
            }
            const st = reg.get(l.stat);
            const destOk = st && (st.dest.kind === "cell" ? l.dest.kind === "cell" && l.dest.id === st.dest.id : l.dest.kind === "rival" && l.dest.name === st.dest.name);
            if (!st) fail(`${where} opens ${l.stat}, no card location`);
            else if (st.fact !== l.fact) fail(`${where} opens ${l.stat}, which draws ${st.fact} - not its fact ${l.fact}`);
            else if (!destOk || JSON.stringify(st.reveal ?? null) !== JSON.stringify(l.reveal ?? null)) fail(`${where} -> ${JSON.stringify(l.dest)} ${JSON.stringify(l.reveal ?? null)} is not where ${l.stat} is drawn`);
            else if (!printOk(l.fact, l.token)) fail(`${where} does not recompute from its fact ${l.fact}`);
            else if (!figs.some((e) => e.frame === frame && e.section === sec.key && e.ref === l.fact && e.token === l.token)) fail(`${where}: no figure of its unit carries its fact ${l.fact}`);
            else {
              tally.linksOk++;
              if (st.at === "default") tally.linkOnView++;
              else tally.linkOneReveal++;
            }
          }
        }
      }
    }
  }
  // Numbers that carry a fact and no link: drawn somewhere (a field that never links - tables, charts, competitor
  // columns, headings) or on no card at all.
  for (const e of FIG_LOG.slice(before.fig) as any[]) {
    const linkField = / (lead|text)$|^row \d+ (value|note)$/.test(e.field) && !e.section.startsWith("card ");
    if (linkField) continue;
    const kind = e.section.startsWith("card ") ? "answer card" : e.field.replace(/\d+/g, "#");
    unlinkedKinds.set(kind, (unlinkedKinds.get(kind) ?? 0) + 1);
    if (drawn.has(e.ref)) tally.unlinkedDrawn++;
    else tally.unlinkedNoCard++;
  }

  // 3. Names.
  const nameOfKey = (k: string) => (k === T ? set.target.name : set.nameOf(k));
  const seenName = new Set<string>();
  for (const e of NAME_LOG.slice(before.name) as any[]) {
    const nk = `${e.subject ?? ""}|${e.kind}|${e.name}|${e.sel ?? e.key ?? ""}|${e.cellId}`;
    if (seenName.has(nk)) continue;
    seenName.add(nk);
    tally.names++;
    nameKinds.set(e.kind, (nameKinds.get(e.kind) ?? 0) + 1);
    const where = `${e.brand}${e.subject ? ` [rival ${e.subject}]` : ""} ${e.kind} "${e.name}" (${e.cellId || "-"})`;
    if (e.sel) {
      let sel: any;
      try {
        sel = selectionFromId(sb, e.sel);
      } catch (x: any) {
        fail(`${where}: its selection ${e.sel} cannot be recomputed: ${x.message}`);
        continue;
      }
      const lc = (x: string) => String(x ?? "").trim().toLowerCase();
      const hit = (sel.members as any[]).some((m) =>
        Array.isArray(m.codes)
          ? m.codes.some((x: any) => lc(x.code) === lc(e.key ?? e.name))
          : lc(m.key) === lc(e.key ?? "\u0000") || lc(m.name) === lc(e.name) || lc(m.label) === lc(e.name) || lc(m.key) === lc(e.name) || (m.key && lc(nameOfKey(m.key)) === lc(e.name))
      ) || (e.kind === "visibility-folded" && (sel.extras?.folded ?? []).some((m: any) => m.key === e.key));
      if (!hit) fail(`${where} is not a member of its selection ${e.sel} [${(sel.members as any[]).slice(0, 8).map((m: any) => m.name ?? m.label ?? (m.codes ?? []).map((x: any) => x.code).join("+")).join(", ")}]`);
      else tally.namesBySel++;
      continue;
    }
    if (e.key && e.kind === "away-to") {
      if (lc0(nameOfKey(e.key)) !== lc0(e.name) && lc0(summary.brands.find((b: any) => b.key === e.key)?.name ?? "") !== lc0(e.name)) fail(`${where}: its fact names ${nameOfKey(e.key)}`);
      else tally.namesByFact++;
      continue;
    }
    if (e.key && e.kind === "cell-label") {
      const { scope } = parseFactId(e.key);
      const names = [scope.worry, scope.situation, scope.rival ? nameOfKey(scope.rival) : undefined, scope.rival ? summary.brands.find((b: any) => b.key === scope.rival)?.name : undefined].filter(Boolean).map(lc0);
      if (!names.includes(lc0(e.name))) fail(`${where}: the cell's own scope names ${names.join(" / ") || "(no subject)"}`);
      else tally.namesByFact++;
      continue;
    }
    fail(`${where} carries no selection and no fact`);
  }
  perTracker.push(`${project.brand}: ${briefs.length} Briefs`);
  // The strict guard's negative control: a read of a stripped funnel field throws (so the strict run proves no funnel
  // path read the old summary).
  try {
    void (stripFunnel(summary).target as any).chosen.k;
    fail(`${project.brand}: the strict funnel guard did not throw on a stripped field`);
  } catch (e: any) {
    if (!/BRIEF_STRICT_FUNNEL/.test(e?.message ?? "")) fail(`${project.brand}: the strict funnel guard threw the wrong error: ${e?.message}`);
  }
}
function lc0(x: string) {
  return String(x ?? "").trim().toLowerCase();
}

console.log(`BRIEFS: ${tally.briefs} (${perTracker.join("; ")}), six frames each, own and every rival subject`);
console.log("");
console.log(`1. NUMBERS - number tokens in every field of every memo and answer card: ${tally.numbers} (${tally.cardNumbers} of them in answer cards), over ${tally.fields} fields`);
console.log(`   printed with no fact: ${tally.bare}`);
console.log(`   figures (a number with its fact id): ${tally.figures}; recomputed from the id alone to the text printed: ${tally.recomputed} (${tally.printWhole} printed whole and ${tally.printFine} to one decimal as their card draws them, the rest the measure's own print)`);
console.log(`2. LINKS - linked numbers: ${tally.links}; linked with no fact (matching): ${tally.linksNoFact}; open a card location that draws the same fact: ${tally.linksOk} (${tally.linkOnView} on view, ${tally.linkOneReveal} behind the one reveal the link carries)`);
console.log(`   numbers in linkable sentences and rows left unlinked: ${tally.numbersUnlinked}`);
console.log(`   figures in fields that never link (tables, charts, competitor columns, headings, answer cards): ${tally.unlinkedDrawn + tally.unlinkedNoCard} - drawn on some card ${tally.unlinkedDrawn}, on no card ${tally.unlinkedNoCard}`);
for (const [k, n] of [...unlinkedKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${k}: ${n}`);
console.log(`3. NAMES - names the Brief states in a card's or selection's role: ${tally.names}; members of their recomputed selection: ${tally.namesBySel}; the subject of their own fact: ${tally.namesByFact}`);
console.log(`   by kind: ${[...nameKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
console.log(`\nFIGURES WHOSE FACT NO CARD DRAWS (printed from the fact, never linked), by measure: ${[...noCard.values()].reduce((a, x) => a + x.length, 0)}`);
for (const [k, xs] of [...noCard.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k}: ${xs.length}`);
  for (const x of xs.slice(0, process.env.SHOW_ALL ? 999 : 4)) console.log(`    - ${x}`);
}
const trimmed = new Map<string, any>();
for (const t of TRIMMED_CLAIMS as any[]) trimmed.set(`${t.brand}|${t.claim}`, t);
console.log(`\nMAP CLAIMS A MOVE QUOTES THAT LOST A CLAUSE (a number whose fact no card draws): ${trimmed.size}`);
for (const t of trimmed.values()) console.log(`  - ${t.brand} [${t.cellId}]\n      was:  ${t.claim}\n      now:  ${t.kept || "(dropped whole)"}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `\n${failures.length} FAIL` : "\nALL PASS - every Brief number is a fact recomputed from its id, every link opens a card that draws that fact, every name is a member of its selection");
process.exit(failures.length ? 1 : 0);
