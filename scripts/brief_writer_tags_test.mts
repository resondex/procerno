/* eslint-disable @typescript-eslint/no-explicit-any -- a test over the served payloads */
/**
 * Written memos carry fact ids (FACT_LAYER_DESIGN_2026-11-17.md step 7, bw6). No model is called anywhere here: the
 * writer is a stub that returns a hand-made or echoed reply.
 *
 *  1. UNIT: the tag syntax, the guards and the strip-and-link step on a hand-made memo - a correct reply passes and
 *     links every number to its tag's fact; a missing tag, an altered figure, an unknown tag, a broken tag and a tag in
 *     a heading each fail guard (h); a figure moved to another subject fails guard (i) (subjectViolations, called
 *     directly - see SUBJECT_GUARD); the name allowances ("Pixel 9", "S26") pass; "<1%" links as "1%".
 *  2. ECHO: every composed memo of the six trackers' own Briefs, every frame, is sent through writeWith with a fake
 *     writer that echoes the sheet with its tags (each quadrant lead gets two words so it is not the sheet's label).
 *     Each must pass every guard and come back with every number linked exactly as the composed memo links it (same
 *     token, occurrence, fact, card location and reveal) - 100%.
 *  3. MEASURE: the subject guard (i) over the same echoed memos (correct prose by construction): sentences carrying a
 *     tag, and how many it would reject. Printed, not enforced (SUBJECT_GUARD is off).
 *
 * Exits non-zero on any failure of 1 or 2. Fixture only, keyless, writes nothing:
 *   npx tsx scripts/brief_writer_tags_test.mts
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
process.env.VIEW_CACHE = "off";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";

const ROOT = process.cwd();
const W = await import(ROOT + "/src/lib/engine/brief_writer.ts");

const failures: string[] = [];
const expect = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures.push(`${name}${detail === undefined ? "" : `: ${JSON.stringify(detail).slice(0, 400)}`}`);
};

/* ------------------------------- 1. unit ------------------------------- */
{
  const A = "brand-a";
  const B = "brand-b";
  const link = (token: string, occurrence: number, fact: string, cell: string) => ({ token, occurrence, dest: { kind: "cell" as const, id: cell }, stat: `cell:${cell}::x`, fact });
  const memo: any = {
    frame: "now_what",
    title: "Alpha - Now what? - wave 1",
    footer: "Alpha - wave 1.",
    sections: [
      {
        key: "verdict",
        heading: "The verdict",
        paras: [
          {
            text: "Alpha is picked in 16% of answers; Beta takes 53%. Below that, the Pixel 9 and the S26 sit at <1%.",
            links: [
              link("16%", 0, `share_of_picks|${A}|t=discovery+use_case`, "c1"),
              link("53%", 0, `share_of_picks|${B}|t=discovery+use_case`, "c1"),
              link("1%", 0, `share_of_picks|${B}|t=discovery+use_case|s=Small business owner`, "c2"),
            ],
          },
        ],
      },
    ],
  };
  const forms = { [A]: ["Alpha"], [B]: ["Beta"] };
  const sheet = W.factSheet(memo, forms);
  expect("unit: three figures tagged", sheet.figs.length === 3, sheet.figs);
  const t = (n: number) => W.figTag(sheet.figs[n]);
  expect("unit: tag syntax", t(0) === "[[fa|16%]]" && t(2) === "[[fc|<1%]]", [t(0), t(2)]);
  expect("unit: sheet carries the tags", sheet.text.includes("[[fa|16%]]") && sheet.text.includes("[[fc|<1%]]"), sheet.text);
  expect("unit: subjects from the fact id", sheet.figs[2].subjects.brands[0]?.name === "Beta" && sheet.figs[2].subjects.situation === "Small business owner", sheet.figs[2].subjects);
  const reply = (text: string, heading = "Where it stands") => ({ sections: [{ heading, paras: [{ text }] }] });
  const good = `Alpha holds ${t(0)} of the picks while Beta takes ${t(1)}. The Pixel 9 and the S26 trail at ${t(2)} with the small business owner, where Beta is named.`;
  const judge = (r: any) => W.checkReply(r, memo, sheet);
  expect("unit: a correct reply passes", judge(reply(good)).length === 0, judge(reply(good)));
  const out = W.reassemble(reply(good), memo, sheet.anchors, sheet.figs);
  const p = out.sections[0].paras![0];
  expect("unit: tags stripped", !p.text.includes("[[") && p.text.includes("16%") && p.text.includes("<1%"), p.text);
  expect(
    "unit: every number linked to its tag's fact",
    JSON.stringify(p.links!.map((l: any) => [l.token, l.occurrence, l.fact])) ===
      JSON.stringify([["16%", 0, sheet.figs[0].link.fact], ["53%", 0, sheet.figs[1].link.fact], ["1%", 0, sheet.figs[2].link.fact]]),
    p.links
  );
  const kinds = (r: any) => judge(r).map((v: any) => v.kind);
  expect("unit: missing tag fails (h)", kinds(reply(`Alpha holds 16% of the picks while Beta takes ${t(1)}.`)).includes("figures"));
  expect("unit: altered figure fails (h)", kinds(reply(`Alpha holds [[fa|17%]] of the picks.`)).includes("figures"));
  expect("unit: unknown tag fails (h)", kinds(reply(`Alpha holds [[fz|16%]] of the picks.`)).includes("figures"));
  expect("unit: broken tag fails (h)", kinds(reply(`Alpha holds [[fa 16%]] of the picks.`)).includes("figures"));
  expect("unit: tag in a heading fails (h)", kinds(reply(`Alpha holds ${t(0)} of the picks.`, `Alpha at ${t(0)}`)).includes("figures"));
  expect("unit: a bare count fails (h)", kinds(reply(`Alpha holds ${t(0)} of the picks across 12 assistants.`)).includes("figures"));
  expect("unit: a name's number passes (h)", !kinds(reply(`The Pixel 9 and the S26 trail at ${t(2)} with the small business owner, where Beta is named.`)).includes("figures"));
  expect("unit: an invented name number fails (h)", kinds(reply(`The Pixel 10 trails at ${t(2)}.`)).includes("figures"));
  // A figure moved to another subject: Beta's share stated as Alpha's.
  const moved = W.subjectViolations(reply(`Alpha takes ${t(1)} of the picks.`), sheet);
  expect("unit: a figure moved to another subject fails (i)", moved.length > 0, moved);
  const back = W.subjectViolations(reply(`Beta leads. It takes ${t(1)} of the picks.`), sheet);
  expect("unit: a pronoun pointing back passes (i)", back.length === 0, back);
  const competing = W.subjectViolations(reply(`Beta leads. Alpha trails while it takes ${t(1)} of the picks.`), sheet);
  expect("unit: a back-reference with another brand in the sentence fails (i)", competing.length > 0, competing);
  // writeWith end to end with a stub writer: a bad first reply is steered, the second passes.
  let calls = 0;
  const steered: string[] = [];
  const r = await W.writeWith(memo, { brand: "Alpha", product: "product", forms }, async (_sys: string, user: string) => {
    calls++;
    if (calls === 2) steered.push(user);
    return JSON.stringify(calls === 1 ? reply(`Alpha holds 16% of the picks.`) : reply(good));
  });
  expect("unit: writeWith steers once, then writes", r.written && calls === 2 && steered[0]?.includes("without their tag"), { written: r.written, calls });
  const r2 = await W.writeWith(memo, { brand: "Alpha", product: "product" }, async () => JSON.stringify(reply(`Alpha holds 16% of the picks.`)));
  expect("unit: still failing falls back to composed", !r2.written && r2.reason === "figures" && r2.memo === memo, r2.reason);
  expect("unit: the prompt names no brand or category", !/Alpha|Beta|credit card|phone|snack/i.test(W.BRIEF_WRITER_SYSTEM));
}

/* ------------------------------- 2. echo + 3. measure ------------------------------- */
const { store } = await import(ROOT + "/src/lib/store/index.ts");
const { loadViewData } = await import(ROOT + "/src/lib/engine/view_data.ts");
const { cachedRunRevision } = await import(ROOT + "/src/lib/engine/run_revision.ts");
const { computeBrief } = await import(ROOT + "/src/lib/engine/brief.ts");

/** The fake writer: the sheet echoed back with its tags (and anchor tags in sheet order). */
function echo(memo: any, sheet: any): any {
  let anchorAt = 0;
  const unit = (p: any, quad = false) => {
    const t = W.taggedUnit(sheet, p);
    let text = t.text;
    const ids = new Set<string>();
    for (const c of p.cells ?? []) {
      if (ids.has(c.id)) continue;
      ids.add(c.id);
      text += ` ${sheet.anchors[anchorAt++].token}`;
    }
    const lead = t.lead === undefined ? undefined : quad ? `${t.lead} in short` : t.lead;
    return lead === undefined ? { text } : { lead, text };
  };
  const sections: any[] = [];
  for (const s of memo.sections) {
    if (W.isKeepSection(s)) {
      sections.push({ keep: s.key });
      continue;
    }
    if (s.quads?.length) {
      for (const q of s.quads) for (let i = 0; i < 2; i++) sections.push({ heading: q.headers[i], paras: q.cells[i].map((p: any) => unit(p, true)) });
      continue;
    }
    sections.push({ ...(s.heading ? { heading: s.heading } : {}), paras: (s.paras ?? []).map((p: any) => unit(p)) });
  }
  return { sections };
}

const sortKeys = (o: any): any => (Array.isArray(o) ? o.map(sortKeys) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o);
const tot = { memos: 0, passed: 0, numbers: 0, linkedSame: 0, sentences: 0, subjectRejected: 0 };
const rejectedEx: string[] = [];
for (const project of (await store.listProjects()).filter((p: any) => !p.archived_at)) {
  const run = (await store.listRuns(project.id))[0];
  const data: any = await loadViewData(run, project, { setupDecision: true, codeGroups: true, judge: true });
  data.revision = await cachedRunRevision(run.id);
  const forms = W.brandFormsOf(data.dictionary);
  const view: any = await computeBrief(data, {});
  for (const [frame, memo] of Object.entries<any>(view.memos)) {
    tot.memos++;
    const sheet = W.factSheet(memo, forms);
    const reply = echo(memo, sheet);
    const r = await W.writeWith(memo, { brand: view.subject, product: "product", forms }, async () => JSON.stringify(reply));
    if (!r.written) {
      expect(`echo ${project.brand} ${frame}: passes every guard`, false, W.checkReply(W.parseReply(reply)!, memo, sheet));
      continue;
    }
    tot.passed++;
    // Every number linked exactly as the composed memo links it.
    const composedUnits: any[] = [];
    const writtenUnits: any[] = [];
    for (const s of memo.sections) if (!W.isKeepSection(s)) for (const p of [...(s.paras ?? []), ...(s.quads ?? []).flatMap((q: any) => [...q.cells[0], ...q.cells[1]])]) composedUnits.push(p);
    for (const s of r.memo.sections) if (!W.isKeepSection(s)) for (const p of [...(s.paras ?? []), ...(s.quads ?? []).flatMap((q: any) => [...q.cells[0], ...q.cells[1]])]) writtenUnits.push(p);
    expect(`echo ${project.brand} ${frame}: same units`, composedUnits.length === writtenUnits.length, [composedUnits.length, writtenUnits.length]);
    composedUnits.forEach((c, i) => {
      const w = writtenUnits[i];
      const n = (`${c.lead ?? ""} ${c.text}`.match(/\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g) ?? []).length;
      tot.numbers += n;
      const same = (c.links ?? []).filter((l: any) => (w?.links ?? []).some((x: any) => JSON.stringify(sortKeys(x)) === JSON.stringify(sortKeys(l)))).length;
      tot.linkedSame += same;
      expect(`echo ${project.brand} ${frame} unit ${i}: every number linked as composed`, same === n && (w?.links ?? []).length === n, { text: c.text.slice(0, 120), composed: c.links, written: w?.links });
      expect(`echo ${project.brand} ${frame} unit ${i}: text unchanged`, w?.text === c.text, [c.text.slice(0, 80), w?.text?.slice(0, 80)]);
    });
    // 3. The subject guard over correct prose.
    for (const s of reply.sections) {
      if ("keep" in s) continue;
      for (const p of s.paras) for (const sent of W.sentencesOf(`${p.lead ? `${p.lead}. ` : ""}${p.text}`)) if (sent.match(W.FIG_TAG)) tot.sentences++;
    }
    const sv = W.subjectViolations(reply, sheet);
    tot.subjectRejected += sv.length;
    if (rejectedEx.length < 8) rejectedEx.push(...sv.slice(0, 2).map((x: string) => `${project.brand} ${frame}: ${x}`));
  }
}

console.log(`unit checks: ${failures.filter((f) => f.startsWith("unit")).length} failed`);
console.log(`echo: ${tot.passed} of ${tot.memos} composed memos (six trackers' own Briefs, every frame) passed every guard through the fake writer;`);
console.log(`      ${tot.linkedSame} of ${tot.numbers} numbers in their written paragraphs linked exactly as composed (fact, location, reveal, token, occurrence).`);
console.log(`subject guard (i), measured on the echoed memos (correct prose): ${tot.subjectRejected} figure-subject findings over ${tot.sentences} sentences carrying a tag (enforced: ${W.SUBJECT_GUARD}).`);
for (const x of rejectedEx.slice(0, 8)) console.log(`  e.g. ${x}`);
if (failures.length) {
  console.log(`FAIL - ${failures.length} failure(s):`);
  for (const f of failures.slice(0, 40)) console.log(`  ${f}`);
  process.exit(1);
}
console.log("PASS");
process.exit(0);
