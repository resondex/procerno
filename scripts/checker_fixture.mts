/**
 * Checker fixture (2026-09-28): validate battery_checks against ground
 * truth - the rejected-prompt corpus (pre-rewrite originals of every
 * hand-fixed prompt this week) must FLAG; the fixed live battery and the
 * harness-generated batteries are the negative controls.
 */
import fs from "node:fs";
const REPO = "/Users/tylersolloway/Documents/GitHub/procerno";
const V02 = `${process.env.HOME}/Documents/procerno_eval/labeling/v02_relabel`;
const CONF = `${process.env.HOME}/Documents/procerno_eval/internal_models/conformance`;
const bc = await import(`${REPO}/src/lib/engine/battery_checks`);
// r15: replay the REAL brand judge's recorded verdicts for the corpus's
// ambiguous one-word hits (scripts/record_judge_verdicts.mts) - the fixture
// makes no model calls.
for (const v of JSON.parse(fs.readFileSync(`${REPO}/scripts/fixtures/brand_judge_verdicts.json`, "utf8")))
  bc.setBrandVerdict(v.text, v.brand, v.form, v.refers);

const COMP: Record<string, string[]> = {
  jira: ["Asana", "monday.com", "Linear", "ClickUp"],
  "American Express": ["Chase", "Capital One", "Citi", "Discover"],
  Netflix: ["Hulu", "Disney+", "Amazon Prime Video", "Max (HBO)"],
  "Google Pixel": ["Apple iPhone", "Samsung Galaxy", "OnePlus", "Xiaomi"],
};
const FORMS = { "American Express": ["amex"] };
const CAT: Record<string, string> = { jira: "project management software", "American Express": "credit cards",
  Netflix: "streaming services", "Google Pixel": "smartphones", Doritos: "tortilla chips", Sephora: "beauty retailers" };
const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));

// --- 1. Rejected corpus: brand-free must-name originals must flag ---
const rejected = [...read(`${V02}/rewrite_worksheet.json`), ...read(`${V02}/g3_worksheet.json`)]
  .filter((r: any) => r.brand_free !== false && r.class !== "off_design" || r.brand_free === true);
let caught = 0, missed: any[] = [];
for (const r of rejected) {
  const v = bc.checkPromptBrandRule({ text: r.text, stage: r.stage, angle: "generic", brand: r.project, competitors: COMP[r.project], category: CAT[r.project], extraForms: FORMS });
  if (v.some((x: any) => x.check === "must_name_missing_target")) caught++;
  else missed.push([r.id?.slice(0, 8), r.stage, r.text?.slice(0, 70)]);
}
console.log(`1. rejected brand-free corpus: ${caught}/${rejected.length} flagged`);
for (const m of missed.slice(0, 6)) console.log("   MISSED:", m);

// --- 2. Number rule (inverted 2026-09-29: seed numbers are FACTS) ---
// (a) A paraphrase substituting a seed number must flag (the Pixel
//     "0% for 24 months" -> "about 18 months" mutation class).
const mut = bc.checkBattery({
  brand: "Google Pixel", competitors: COMP["Google Pixel"], category: CAT["Google Pixel"],
  cells: [{ stage: "pricing", angle: "generic", text: "any 0% financing for 24 months on a flagship phone?",
    phrasings: ["is 0% over 18 months a thing for flagship phones?", "any interest-free flagship financing right now?"] }],
});
const mutFlags = mut.filter((f: any) => f.check === "seed_number_changed");
console.log(`2a. substituted seed number: ${mutFlags.length === 1 ? "FLAGGED (1, correct)" : `WRONG (${mutFlags.length})`}`, mutFlags.map((f: any) => f.detail));
// (b) Paraphrases PRESERVING seed numbers are now clean - the old wattage
//     cell (seed quantities repeated verbatim) is the negative control.
const watt = read(`${V02}/wattage_fix.json`);
const wattCell = { stage: "ecosystem", angle: "generic", text: watt[0].text, phrasings: watt.slice(1).map((r: any) => r.text) };
const wf = bc.checkBattery({ brand: "Google Pixel", competitors: COMP["Google Pixel"], category: CAT["Google Pixel"], cells: [wattCell] })
  .filter((f: any) => f.check === "seed_number_changed");
console.log(`2b. wattage cell (numbers preserved): ${wf.length === 0 ? "CLEAN (correct)" : `${wf.length} flags`}`,
  wf.slice(0, 3).map((f: any) => f.detail));

// --- 3. Negative control: the fixed live battery ---
const types = read(`${V02}/question_types.json`);
const live = read(`${V02}/prompt_stages.json`);
let flags: any[] = [];
for (const p of live) {
  // pricing/alternatives/comparison rules need per-cell angle/type; approximate:
  const t = types[p.id];
  const angle = p.angle ?? "generic";
  if (p.stage === "pricing") continue; // mixed by design, typed per cell
  const v = bc.checkPromptBrandRule({ text: p.text, stage: p.stage, angle, brand: p.project, competitors: COMP[p.project], category: CAT[p.project], extraForms: FORMS });
  for (const x of v) flags.push([p.project, p.stage, x.check, p.text.slice(0, 70)]);
}
console.log(`3. fixed live battery (${live.length} prompts, pricing excluded as per-cell): ${flags.length} flags`);
for (const f of flags) console.log("   ", JSON.stringify(f));

// --- 4. Harness-generated batteries (note: these were generated under the
// OLD number instruction, which told the writer to VARY seed numbers -
// seed_number_changed findings here are the old contract showing, not
// checker false positives; brand-rule findings are the signal) ---
const head = read(`${CONF}/head.json`);
for (const [brand, P] of Object.entries<any>(head.projects)) {
  const cells = P.cells.map((c: any, i: number) => ({
    stage: c.stage, angle: c.angle, text: c.text,
    phrasings: (P.phrasings[i] ?? []).map((x: any) => (typeof x === "string" ? x : x.text)),
  }));
  const f = bc.checkBattery({ brand, competitors: P.competitors, category: CAT[brand], cells });
  const byCheck: Record<string, number> = {};
  for (const x of f) byCheck[x.check] = (byCheck[x.check] ?? 0) + 1;
  console.log(`4. generated ${brand}: ${f.length} findings`, byCheck);
  for (const x of f.slice(0, 5)) console.log("   ", x.check, "|", x.detail, "|", x.text.slice(0, 60));
}

// =====================================================================
// 5. SPEC ERA (s7, 2026-09-29): every cell carries a typed check-spec
// derived once from its design; checks verify candidates AGAINST it.
// (a) the spec-driven checks must reproduce the string-driven verdicts on
//     the same corpora (99/99 rejected flagged, 0 FP on the fixed battery);
// (b) regression cases for the whole surface-form patch chain.
// =====================================================================
let fails = 0;
const expect = (label: string, ok: boolean, extra?: unknown) => {
  if (!ok) fails++;
  console.log(`   ${ok ? "ok  " : "FAIL"} ${label}`, extra === undefined ? "" : JSON.stringify(extra));
};
const specOf = (cell: { stage: string; angle: string; text: string }, brand: string, comp: string[], cat?: string) =>
  bc.deriveCheckSpec(cell, brand, comp, cat);

// 5a. Rejected corpus under the spec path.
let sCaught = 0;
for (const r of rejected) {
  const spec = specOf({ stage: r.stage, angle: "generic", text: r.text }, r.project, COMP[r.project], CAT[r.project]);
  const v = bc.checkPromptAgainstSpec({ text: r.text, spec, category: CAT[r.project], extraForms: FORMS });
  if (v.some((x: any) => x.check === "must_name_missing_target")) sCaught++;
}
console.log(`5a. rejected brand-free corpus, spec path: ${sCaught}/${rejected.length} flagged`);
expect("spec path flags the whole rejected corpus", sCaught === rejected.length && rejected.length === 99);

// 5b. Fixed live battery under the spec path (each prompt as its own seed).
// Pricing is INCLUDED here: the spec types each pricing cell (within-brand
// vs open choice) from its own seed, so the string era's per-cell excuse
// no longer applies. Every prompt must also pass its own signature - the
// tolerant required detector and the strict forbidden detector agree.
let sFlags: any[] = [];
let partitionBad = 0;
let selfSigBad: any[] = [];
// Init decision 1 (2026-10-03): every pricing cell must name the client.
// The fixed battery predates it - its generic pricing prompts are now
// legitimate must-name misses, asserted as such instead of as clean.
const legacyGenericPricing = (stage: string, text: string, brand: string, cat: string) =>
  stage === "pricing" && !bc.textNamesBrand(text, brand, { extraForms: FORMS[brand], excludeTokens: new Set(cat.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) });
let legacyPricing = 0;
let legacyPricingCaught = 0;
for (const p of live) {
  const angle = p.angle ?? "generic";
  const spec = specOf({ stage: p.stage, angle, text: p.text }, p.project, COMP[p.project], CAT[p.project]);
  if (legacyGenericPricing(p.stage, p.text, p.project, CAT[p.project])) {
    legacyPricing++;
    const v = bc.checkPromptAgainstSpec({ text: p.text, spec, category: CAT[p.project], extraForms: FORMS });
    if (v.some((x: any) => x.check === "must_name_missing_target")) legacyPricingCaught++;
    continue;
  }
  const all = [p.project, ...COMP[p.project]].sort().join("|");
  const part = [...spec.requiredBrands, ...spec.forbiddenBrands].filter((b: string) => all.includes(b)).sort().join("|");
  if (part !== all) partitionBad++;
  const v = bc.checkPromptAgainstSpec({ text: p.text, spec, category: CAT[p.project], extraForms: FORMS });
  for (const x of v) sFlags.push([p.project, p.stage, x.check, p.text.slice(0, 70)]);
  const sig = bc.checkCandidateSignature(p.text, spec, { category: CAT[p.project], extraForms: FORMS });
  if (!sig.ok) selfSigBad.push([p.project, p.stage, sig, p.text.slice(0, 70)]);
}
console.log(`5b. fixed live battery, spec path (${live.length} prompts incl. pricing): ${sFlags.length} flags, ${selfSigBad.length} self-signature misses`);
for (const f of selfSigBad.slice(0, 8)) console.log("   ", JSON.stringify(f));
expect("every fixed-battery prompt passes its own spec signature", selfSigBad.length === 0);
for (const f of sFlags.slice(0, 8)) console.log("   ", JSON.stringify(f));
expect("spec path: 0 false positives on the fixed battery", sFlags.length === 0);
expect("required + forbidden partition the roster on every fixed-battery cell", partitionBad === 0, { partitionBad });
expect("decision 1: every legacy generic pricing prompt is flagged must-name", legacyPricingCaught === legacyPricing && legacyPricing > 0, { legacyPricing, legacyPricingCaught });

// 5c. Harness batteries: spec-driven checkBattery vs string-driven, per finding.
for (const [brand, P] of Object.entries<any>(head.projects)) {
  const cells = P.cells.map((c: any, i: number) => ({
    stage: c.stage, angle: c.angle, text: c.text,
    phrasings: (P.phrasings[i] ?? []).map((x: any) => (typeof x === "string" ? x : x.text)),
  }));
  const fp = (x: any) => `${x.cell}|${x.check}|${x.text}`;
  const legacy = new Set(bc.checkBattery({ brand, competitors: P.competitors, category: CAT[brand], cells }).map(fp));
  const spec = new Set(bc.checkBattery({
    brand, competitors: P.competitors, category: CAT[brand],
    cells: cells.map((c: any) => ({ ...c, spec: specOf(c, brand, P.competitors, CAT[brand]) })),
  }).map(fp));
  const onlyLegacy = [...legacy].filter((k) => !spec.has(k));
  const onlySpec = [...spec].filter((k) => !legacy.has(k));
  console.log(`5c. generated ${brand}: string ${legacy.size} / spec ${spec.size} findings; string-only ${onlyLegacy.length}, spec-only ${onlySpec.length}`);
  for (const k of [...onlyLegacy.map((x) => `string-only ${x}`), ...onlySpec.map((x) => `spec-only   ${x}`)].slice(0, 8))
    console.log("    ", k.slice(0, 150));
  // These paraphrases already survived the string-era signature filter:
  // the spec signature must keep them (it is the same design, read right).
  let n = 0;
  const lost: string[] = [];
  cells.forEach((c: any) => {
    // Legacy generic pricing cells are now must-name misses (decision 1).
    if (legacyGenericPricing(c.stage, c.text, brand, CAT[brand])) return;
    const sp = specOf(c, brand, P.competitors, CAT[brand]);
    for (const t of c.phrasings) {
      n++;
      const v = bc.checkCandidateSignature(t, sp, { category: CAT[brand] });
      if (!v.ok) lost.push(`${c.stage}/${c.angle} ${JSON.stringify(v)} | ${t.slice(0, 70)}`);
    }
  });
  expect(`${brand}: spec signature keeps all ${n} string-era survivors`, lost.length === 0, lost.slice(0, 4));
}

// 5d. Regression cases - the surface-form patch chain.
console.log("5d. regression cases");
const AMEX_V = ["Chase", "Capital One", "Visa", "Discover"];
{
  // (1) lowercase "visa" in a comparison seed: the design names Visa, so
  //     candidates writing "Visa" properly must survive (1ef69ee). "Amex"
  //     is a dictionary alias (extraForms), not a derivable form.
  const spec = specOf({ stage: "comparison", angle: "Visa", text: "american express vs visa for someone who travels 3 times a year?" },
    "American Express", AMEX_V, "credit cards");
  expect("lowercase-visa seed: Visa is a required brand", spec.requiredBrands.includes("Visa") && spec.requiredBrands.includes("American Express"), spec.requiredBrands);
  const good = bc.checkCandidateSignature("Is Amex or Visa the smarter pick if I fly 3 times a year?", spec, { category: "credit cards", extraForms: FORMS });
  expect("lowercase-visa seed: 'Visa' candidate passes the signature", good.ok, good);
  const lower = bc.checkCandidateSignature("amex vs visa, which is better for 3 trips a year", spec, { category: "credit cards", extraForms: FORMS });
  expect("lowercase-visa seed: lowercase candidate passes too", lower.ok, lower);
  const leak = bc.checkCandidateSignature("Amex vs Visa vs Chase Sapphire for 3 trips a year?", spec, { category: "credit cards", extraForms: FORMS });
  expect("comparison: a third tracked brand is a leak", !leak.ok && leak.missing.length === 0 && leak.leaked.includes("Chase"), leak);
  const blind = specOf({ stage: "discovery", angle: "generic", text: "best travel card if I need a visa for most trips?" },
    "American Express", AMEX_V, "credit cards");
  // r15: the brand judge decides this ambiguous one-word hit; unjudged it counts as named (safe default).
  bc.setBrandVerdict("which card is best when I also need a visa for trips?", "Visa", "visa", false);
  const bv = bc.checkPromptAgainstSpec({ text: "which card is best when I also need a visa for trips?", spec: blind, category: "credit cards" });
  expect("blind cell: lowercase 'visa' (travel document) is not the brand", bv.length === 0, bv);
  const bv2 = bc.checkPromptAgainstSpec({ text: "is a Visa card better than Discover for trips?", spec: blind, category: "credit cards" });
  expect("blind cell: capitalized 'Visa' IS the brand", bv2.some((x: any) => x.check === "blind_names_brand"), bv2);
}
{
  // (2) 60k vs 60,000 and (3) "under a second" vs "under 1 second" (930d693, 27bbf6a)
  const cell = { stage: "objections", angle: "generic", text: "Is jira too slow for a founder with 60k issues who wants search under a second?" };
  const spec = specOf(cell, "jira", COMP.jira, CAT.jira);
  expect("60k normalizes to the fact 60000", spec.quantities.includes("60000"), spec.quantities);
  const f = bc.checkBattery({ brand: "jira", competitors: COMP.jira, category: CAT.jira, cells: [{ ...cell, spec,
    phrasings: ["We're at 60,000 issues in jira - will search stay under 1 second?", "jira with 60000 tickets: still snappy or not?"] }] });
  expect("60,000 / 60000 / 'under 1 second' paraphrases are clean", f.length === 0, f.map((x: any) => x.detail));
  const mut = bc.checkBattery({ brand: "jira", competitors: COMP.jira, category: CAT.jira, cells: [{ ...cell, spec,
    phrasings: ["jira at 80k issues - is search still fast?"] }] });
  expect("a changed quantity (80k) still flags", mut.some((x: any) => x.check === "seed_number_changed"), mut.map((x: any) => x.detail));
}
{
  // "family of four" vs "2 kids" / "4 of us" - spelled seed numbers are facts.
  const cell = { stage: "use_case", angle: "generic", text: "Which card works for a family of four that travels twice a year?" };
  const spec = specOf(cell, "American Express", COMP["American Express"], "credit cards");
  const cands = ["best card for us - 2 adults, 2 kids, two trips a year?", "there are 4 of us and we fly twice a year, which card?"];
  const s = bc.checkBattery({ brand: "American Express", competitors: COMP["American Express"], category: "credit cards", cells: [{ ...cell, spec, phrasings: cands }] });
  expect("family of four: '2 kids' and '4 of us' are clean under the spec", s.length === 0, s.map((x: any) => x.detail));
  const l = bc.checkBattery({ brand: "American Express", competitors: COMP["American Express"], category: "credit cards", cells: [{ ...cell, phrasings: cands }] });
  console.log(`   info legacy string path on the same cell: ${l.length} finding(s)`, l.map((x: any) => x.detail));
}
{
  // (4) Apple iPhone token shorthand (a571ad1) + target shorthand (ee871d8)
  const off = specOf({ stage: "alternatives", angle: "Apple iPhone", text: "What should I look at instead of an Apple iPhone this year?" },
    "Google Pixel", COMP["Google Pixel"], CAT["Google Pixel"]);
  const ok1 = bc.checkCandidateSignature("tired of my iPhone, what else is worth it?", off, { category: CAT["Google Pixel"] });
  expect("offensive alt: bare 'iPhone' names the angle rival", ok1.ok, ok1);
  const bad1 = bc.checkCandidateSignature("tired of my iPhone, is a Pixel worth it?", off, { category: CAT["Google Pixel"] });
  expect("offensive alt: naming the target is a leak", !bad1.ok && bad1.leaked.includes("Google Pixel"), bad1);
  const churn = specOf({ stage: "churn_triggers", angle: "generic", text: "My Google Pixel battery is dying by 3pm - is it time to leave?" },
    "Google Pixel", COMP["Google Pixel"], CAT["Google Pixel"]);
  const ok2 = bc.checkCandidateSignature("pixel dying by 3pm every day, should I bail?", churn, { category: CAT["Google Pixel"] });
  expect("must-name: lowercase bare 'pixel' names the target", ok2.ok, ok2);
  const col = bc.checkCandidateSignature("phones with a bigger pixel size sensor that last past 3pm?", churn, { category: CAT["Google Pixel"] });
  expect("must-name: 'pixel size' is a sensor term, not the target", !col.ok && col.missing.includes("Google Pixel"), col);
  // (5) roster-leak rival in a single-brand cell (524696a)
  const leak = bc.checkPromptAgainstSpec({ text: "Pixel dying by 3pm - should I just get a Samsung Galaxy?", spec: churn, category: CAT["Google Pixel"] });
  expect("must-name: a roster rival leaking in is flagged", leak.some((x: any) => x.check === "must_name_names_rival"), leak);
}
{
  // Netflix: Max (HBO) - stopword name, parenthetical alias, sub-phrase rival.
  const cmp = specOf({ stage: "comparison", angle: "Amazon Prime Video", text: "netflix or amazon prime video for a family of 5?" },
    "Netflix", COMP.Netflix, CAT.Netflix);
  const pv = bc.checkCandidateSignature("Netflix vs Prime Video for 5 of us?", cmp, { category: CAT.Netflix });
  expect("comparison: 'Prime Video' sub-phrase names Amazon Prime Video", pv.ok, pv);
  const blind = specOf({ stage: "discovery", angle: "generic", text: "cheapest way to stream 2-3 services max?" }, "Netflix", COMP.Netflix, CAT.Netflix);
  const unjudged = bc.checkCandidateSignature("I want 2-3 services max, which ones?", blind, { category: CAT.Netflix });
  expect("r15: unjudged '2-3 services max' counts as Max (safe default)", !unjudged.ok, unjudged);
  bc.setBrandVerdict("I want 2-3 services max, which ones?", "Max (HBO)", "max", false);
  const m1 = bc.checkCandidateSignature("I want 2-3 services max, which ones?", blind, { category: CAT.Netflix });
  expect("blind: '2-3 services max' is not Max", m1.ok, m1);
  const m2 = bc.checkCandidateSignature("is HBO worth it or should I pick something cheaper?", blind, { category: CAT.Netflix });
  expect("blind: 'HBO' is Max (HBO)", !m2.ok && m2.leaked.includes("Max (HBO)"), m2);
}
{
  // (6) meta-text (d1a0ef4)
  const spec = specOf({ stage: "objections", angle: "generic", text: "Is jira overkill for a 15-person squad?" }, "jira", COMP.jira, CAT.jira);
  const v = bc.checkPromptAgainstSpec({ text: "Sorry, small correction: is jira overkill for our squad?", spec, category: CAT.jira });
  expect("meta-text is flagged under the spec", v.some((x: any) => x.check === "meta_text"), v);
  expect("doubt cells store their same-concern design line", typeof spec.designLine === "string" && spec.designLine.includes("SAME concern") && spec.designLine.includes(spec.seed));
  expect("design line equals the legacy synthesized line (design-check cache reuse)", spec.designLine === bc.seedDesignLine("objections", "jira", spec.seed));
}
{
  // Writer note rendered from the design.
  const legacyBlind = specOf({ stage: "renewal", angle: "generic", text: "Is my streaming plan still worth renewing?" }, "Netflix", COMP.Netflix, CAT.Netflix);
  expect("must-name cell with a blind seed: writer note names the target", (bc.specWriterNote(legacyBlind) ?? "").includes("must name Netflix"));
  const okSeed = specOf({ stage: "renewal", angle: "generic", text: "Is Netflix still worth renewing?" }, "Netflix", COMP.Netflix, CAT.Netflix);
  expect("seed already carrying its design: no writer note", bc.specWriterNote(okSeed) === null);
  const stale = { ...okSeed, requiredBrands: [] };
  const re = bc.resolveCellSpec({ stage: "renewal", angle: "generic", text: "Is Netflix still worth renewing?", spec: stale }, "Netflix", COMP.Netflix, CAT.Netflix);
  expect("a stale carried spec is re-derived, never trusted", re?.requiredBrands.includes("Netflix"));
  expect("no carried spec = legacy path (null)", bc.resolveCellSpec({ stage: "renewal", angle: "generic", text: "x" }, "Netflix", COMP.Netflix) === null);
}
{
  // (r13, 2026-10-02 cold-walk audit) category-word roster tokens are
  // case-guarded: "import issues" does not name "GitHub Issues / Projects"
  // (one Jira seed was flagged and another rewritten to drop "issues"),
  // "my bank" does not name Bank of America - capitalized they still do.
  const JR = ["ClickUp", "Asana", "GitHub Issues / Projects", "Azure DevOps", "Linear"];
  const blindJ = specOf({ stage: "feature_screening", angle: "generic", text: "Which project management software can import issues with full history? Name a few." },
    "Jira", JR, CAT.jira);
  bc.setBrandVerdict(blindJ.seed, "GitHub Issues / Projects", "issues", false);
  const jb = bc.checkPromptAgainstSpec({ text: blindJ.seed, spec: blindJ, category: CAT.jira });
  expect("r13: 'import issues' in a blind Jira seed names no rival", jb.length === 0, jb);
  const jb2 = bc.checkPromptAgainstSpec({ text: "Is GitHub Issues enough, or which project management software would you pick?", spec: blindJ, category: CAT.jira });
  expect("r13: 'GitHub Issues' still names the rival", jb2.some((x: any) => x.check === "blind_names_brand"), jb2);
  // Review 2026-10-02: "linear" (6% lowercase in the vault) and "devops"
  // (too rare to call) are not everyday, so lowercase they DO count - the
  // accepted cost of catching lowercase leaks; a false hit costs a regen.
  const jb3 = bc.checkCandidateSignature("Our devops team needs a linear flow from backlog to release - which project management software fits?", blindJ, { category: CAT.jira });
  expect("r13: lowercase 'devops' / 'linear' count (not everyday by vault share)", jb3.leaked.includes("Azure DevOps") && jb3.leaked.includes("Linear"), jb3);
  const jb4 = bc.checkPromptAgainstSpec({ text: "Is Linear better than the rest of the project management software out there?", spec: blindJ, category: CAT.jira });
  expect("r13: capitalized 'Linear' is the rival", jb4.some((x: any) => x.check === "blind_names_brand"), jb4);
  const AX = ["Chase", "Capital One", "Discover", "Citi", "Bank of America"];
  const blindA = specOf({ stage: "discovery", angle: "generic", text: "Which credit cards should I look at for groceries?" }, "American Express", AX, CAT["American Express"]);
  // r15: the brand judge decides this ambiguous one-word hit; unjudged it counts as named (safe default).
  bc.setBrandVerdict("My bank keeps pushing its own credit cards. Which should I look at?", "Bank of America", "bank", false);
  const ab = bc.checkPromptAgainstSpec({ text: "My bank keeps pushing its own credit cards. Which should I look at?", spec: blindA, category: CAT["American Express"] });
  expect("r13: 'my bank' names no issuer", ab.length === 0, ab);
  // "chase" / "discover" are brand-dominated in the vault (5% / 17%
  // lowercase), so lowercase they count - "chase or amex?" is the bank.
  const abc = bc.checkCandidateSignature("chase or discover for groceries - which credit cards should I look at?", blindA, { category: CAT["American Express"] });
  expect("r13: lowercase 'chase' / 'discover' count (brand-dominated)", abc.leaked.includes("Chase") && abc.leaked.includes("Discover"), abc);
  const ab2 = bc.checkPromptAgainstSpec({ text: "As an American who travels abroad, which credit cards should I look at?", spec: blindA, category: CAT["American Express"] });
  expect("r13: 'American' alone does not name American Express", ab2.length === 0, ab2);
  // Alias forms: "Amex" names American Express in a must-name seed and
  // leaks in a blind one, once the dictionary's alias forms reach the check.
  const mustA = specOf({ stage: "renewal", angle: "generic", text: "My Amex annual fee just hit. Keep it another year or cancel?" }, "American Express", AX, CAT["American Express"]);
  const ma = bc.checkPromptAgainstSpec({ text: mustA.seed, spec: mustA, category: CAT["American Express"], extraForms: FORMS });
  expect("r13: 'Amex' satisfies must-name with alias forms", ma.length === 0, ma);
  const ab3 = bc.checkPromptAgainstSpec({ text: "Is Amex or something else the best credit card for groceries?", spec: blindA, category: CAT["American Express"], extraForms: FORMS });
  expect("r13: 'Amex' in a blind seed is a leak with alias forms", ab3.some((x: any) => x.check === "blind_names_brand"), ab3);
  const pr = bc.deriveCheckSpec({ stage: "pricing", angle: "generic", text: "Is my Amex Gold worth it at my grocery spend, or a no-fee card?" }, "American Express", AX, CAT["American Express"], FORMS);
  expect("r13: a pricing seed about 'my Amex' types within_brand with alias forms", pr.qtype === "within_brand", pr.qtype);
  // A word of one rival's name inside another's full name never names it:
  // "Bank of America" is not "U.S. Bank" (round-2 cold walk).
  const AX2 = ["Chase", "Bank of America", "U.S. Bank", "Wells Fargo"];
  const cmp = specOf({ stage: "comparison", angle: "Bank of America", text: "American Express or Bank of America for credit cards: what's your pick, and why?" }, "American Express", AX2, CAT["American Express"]);
  const cb = bc.checkPromptAgainstSpec({ text: cmp.seed, spec: cmp, category: CAT["American Express"] });
  expect("r13: 'Bank of America' does not also name 'U.S. Bank'", cb.length === 0, cb);
  const cb2 = bc.checkPromptAgainstSpec({ text: "American Express, Bank of America or U.S. Bank: what's your pick?", spec: cmp, category: CAT["American Express"] });
  expect("r13: 'U.S. Bank' named outright is still a leak", cb2.some((x: any) => x.check === "comparison_names_extra_rival"), cb2);
  const usa = bc.checkCandidateSignature("We spend mostly in the U.S. with a few trips abroad. Which cards would fit?", cmp, { category: CAT["American Express"] });
  expect("r15: 'in the U.S.' does not name U.S. Bank", !usa.leaked.includes("U.S. Bank"), usa);
  // Everyday-word names (round-3 cold walk): "Nothing Phone" on a
  // smartphones study - "phone" is category vocabulary, "Nothing" counts
  // only in the label's casing and never as a sentence's first word.
  const PX = ["Apple iPhone", "Samsung Galaxy", "OnePlus", "Nothing Phone"];
  const blindP = specOf({ stage: "use_case", angle: "generic", text: "My old phone is laggy. Which phones would you pick?" }, "Google Pixel", PX, CAT["Google Pixel"]);
  // r15: the brand judge decides this ambiguous one-word hit; unjudged it counts as named (safe default).
  bc.setBrandVerdict("My old phone is laggy and nothing feels smooth. Which phones would you pick?", "Nothing Phone", "nothing", false);
  const p1 = bc.checkPromptAgainstSpec({ text: "My old phone is laggy and nothing feels smooth. Which phones would you pick?", spec: blindP, category: CAT["Google Pixel"] });
  expect("r13: 'phone' / lowercase 'nothing' name no rival", p1.length === 0, p1);
  // r15: the brand judge decides this ambiguous one-word hit; unjudged it counts as named (safe default).
  bc.setBrandVerdict("Nothing beats a long battery. Which phones would you pick?", "Nothing Phone", "nothing", false);
  const p2 = bc.checkPromptAgainstSpec({ text: "Nothing beats a long battery. Which phones would you pick?", spec: blindP, category: CAT["Google Pixel"] });
  expect("r13: sentence-initial 'Nothing' is not the brand", p2.length === 0, p2);
  const p3 = bc.checkPromptAgainstSpec({ text: "Is the Nothing Phone any good, or which phones would you pick?", spec: blindP, category: CAT["Google Pixel"] });
  expect("r13: 'Nothing Phone' named outright is a leak", p3.some((x: any) => x.check === "blind_names_brand"), p3);
  const p4 = bc.checkPromptAgainstSpec({ text: "Thinking about a Galaxy or something from Nothing. Which phones would you pick?", spec: blindP, category: CAT["Google Pixel"] });
  expect("r13: mid-sentence 'Nothing' and 'Galaxy' are leaks", p4.some((x: any) => x.check === "blind_names_brand" && /Nothing Phone/.test(x.detail) || /Samsung/.test(x.detail)), p4);
  const p5 = bc.checkPromptAgainstSpec({ text: "been on my iphone forever, which phones would you pick?", spec: blindP, category: CAT["Google Pixel"] });
  expect("r13: lowercase 'iphone' (alias) still leaks", p5.some((x: any) => x.check === "blind_names_brand"), p5);
  const PX1 = ["Apple iPhone", "Samsung Galaxy", "Nothing"];
  const blindP1 = specOf({ stage: "use_case", angle: "generic", text: "My old phone is laggy. Which phones would you pick?" }, "Google Pixel", PX1, CAT["Google Pixel"]);
  const p6 = bc.checkPromptAgainstSpec({ text: "Nothing fancy, my old phone just lags. Which phones would you pick?", spec: blindP1, category: CAT["Google Pixel"] });
  // r15: the brand judge decides this ambiguous one-word hit; unjudged it counts as named (safe default).
  bc.setBrandVerdict("I need nothing fancy. Which phones would you pick?", "Nothing", "nothing", false);
  const p7 = bc.checkPromptAgainstSpec({ text: "I need nothing fancy. Which phones would you pick?", spec: blindP1, category: CAT["Google Pixel"] });
  expect("r13: one-word rival 'Nothing' - lowercase 'nothing' is not the brand", p7.length === 0, p7);
  const p8 = bc.checkPromptAgainstSpec({ text: "Is a phone from Nothing worth it, or which phones would you pick?", spec: blindP1, category: CAT["Google Pixel"] });
  expect("r13: one-word rival 'Nothing' - capitalized mid-sentence is a leak", p8.some((x: any) => x.check === "blind_names_brand"), p8);
  console.log("   note r13 residual: sentence-initial 'Nothing fancy' reads as the one-word rival:", JSON.stringify(p6));
  // r13 review: everyday-word names are decided by the vault lexicon, not
  // a roster-fitted list - the fleet's Ring (rival) and Purple (target).
  const NEST = ["Ring", "Ecobee", "Honeywell Home"];
  const blindN = specOf({ stage: "discovery", angle: "generic", text: "Which smart thermostats should I look at?" }, "Google Nest", NEST, "smart home devices");
  // r15: the brand judge decides this ambiguous one-word hit; unjudged it counts as named (safe default).
  bc.setBrandVerdict("I barely hear the doorbell ring upstairs. Which smart home devices should I look at?", "Ring", "ring", false);
  const n1 = bc.checkPromptAgainstSpec({ text: "I barely hear the doorbell ring upstairs. Which smart home devices should I look at?", spec: blindN, category: "smart home devices" });
  expect("lexicon: 'the doorbell ring' is not Ring", n1.length === 0, n1);
  const n2 = bc.checkPromptAgainstSpec({ text: "Ring or something else - which smart home devices should I look at?", spec: blindN, category: "smart home devices" });
  expect("lexicon: 'Ring' (even sentence-initial) is the rival", n2.some((x: any) => x.check === "blind_names_brand"), n2);
  const MATT = ["Casper", "Tempur-Pedic", "Saatva"];
  const blindM = specOf({ stage: "discovery", angle: "generic", text: "Which mattresses are best for back pain?" }, "Purple", MATT, "mattresses");
  // The TARGET's own one-word name is never case-guarded (review
  // 2026-10-02): a leaked target is the costlier miss, a false hit costs a
  // regeneration. Rivals keep the guard (the Ring cases above).
  const m1 = bc.checkPromptAgainstSpec({ text: "is purple any good for back pain, or which mattresses would you pick?", spec: blindM, category: "mattresses" });
  expect("lexicon: lowercase target 'purple' in a blind cell is a leak", m1.some((x: any) => x.check === "blind_names_brand"), m1);
  const m2 = bc.checkPromptAgainstSpec({ text: "Is a Purple better than the rest of the mattresses for back pain?", spec: blindM, category: "mattresses" });
  expect("lexicon: capitalized 'Purple' is the target", m2.some((x: any) => x.check === "blind_names_brand"), m2);
  const mustM = specOf({ stage: "renewal", angle: "generic", text: "My Purple mattress is sagging. Keep it or replace it?" }, "Purple", MATT, "mattresses");
  const m3 = bc.checkPromptAgainstSpec({ text: mustM.seed, spec: mustM, category: "mattresses" });
  expect("lexicon: must-name 'Purple' passes", m3.length === 0, m3);
  // Coined names stay case-blind: the casual all-lowercase register.
  const JA = ["Asana", "Trello", "Linear"];
  const blindJa = specOf({ stage: "discovery", angle: "generic", text: "Which project management software should a small dev team use?" }, "Jira", JA, CAT.jira);
  const ja = bc.checkPromptAgainstSpec({ text: "is asana or something like it the right project management software for a small dev team?", spec: blindJa, category: CAT.jira });
  expect("lexicon: lowercase coined 'asana' still leaks", ja.some((x: any) => x.check === "blind_names_brand"), ja);
  // Lowercase blind mentions of every example target and its main rivals
  // (review 2026-10-02: an absolute-count lexicon held "jira", "netflix",
  // "apple", "pixel", and split-word label casing hid "samsung" - the
  // writer's lowercase register made all of these invisible leaks).
  const LOWER: [string, string[], string, string, string][] = [
    ["Jira", ["Asana", "Trello", "Linear"], CAT.jira, "is jira any good for a small dev team, or which project management software would you pick?", "Jira"],
    ["Jira", ["Asana", "Trello", "Linear"], CAT.jira, "jira or asana for project management - which would you pick?", "Asana"],
    ["Netflix", ["Hulu", "Disney+", "Amazon Prime Video"], CAT.Netflix, "thinking about netflix vs the rest of the streaming services for the kids", "Netflix"],
    ["Netflix", ["Hulu", "Disney+", "Amazon Prime Video"], CAT.Netflix, "is hulu the best of the streaming services for kids?", "Hulu"],
    ["Google Pixel", ["Apple iPhone", "Samsung Galaxy", "OnePlus"], CAT["Google Pixel"], "my pixel keeps dropping calls - which phones hold signal better?", "Google Pixel"],
    ["Google Pixel", ["Apple iPhone", "Samsung Galaxy", "OnePlus"], CAT["Google Pixel"], "apple or samsung for a teenager - which phones would you pick?", "Apple iPhone"],
    ["Google Pixel", ["Apple iPhone", "Samsung Galaxy", "OnePlus"], CAT["Google Pixel"], "apple or samsung for a teenager - which phones would you pick?", "Samsung Galaxy"],
    ["American Express", ["Chase", "Citi", "Capital One"], CAT["American Express"], "is american express worth it, or which credit cards would you pick?", "American Express"],
    ["American Express", ["Chase", "Citi", "Capital One"], CAT["American Express"], "citi or something else - which credit cards would you pick?", "Citi"],
  ];
  for (const [tgt, rv, cat, text, leak] of LOWER) {
    const sp = specOf({ stage: "discovery", angle: "generic", text: `Which ${cat} would you pick?` }, tgt, rv, cat);
    const f = bc.checkCandidateSignature(text, sp, { category: cat });
    expect(`lowercase blind leak: "${text.slice(0, 40)}..." names ${leak}`, !f.ok && f.leaked.includes(leak), f);
  }
  // Alias forms run through the same filters (r13 review): an everyday
  // alias is case-guarded; a stopword or category alias is dropped.
  const XF = { "American Express": ["amex", "gold", "max", "cards"] };
  // r15: the brand judge decides this ambiguous one-word hit; unjudged it counts as named (safe default).
  bc.setBrandVerdict("Which credit cards are the gold standard for groceries?", "American Express", "gold", false);
  const ax1 = bc.checkPromptAgainstSpec({ text: "Which credit cards are the gold standard for groceries?", spec: blindA, category: CAT["American Express"], extraForms: XF });
  expect("aliases: lowercase everyday alias 'gold' is not the brand", ax1.length === 0, ax1);
  const ax2 = bc.checkPromptAgainstSpec({ text: "Which credit cards should I look at - max rewards, no fee?", spec: blindA, category: CAT["American Express"], extraForms: XF });
  expect("aliases: stopword alias 'max' and category alias 'cards' are dropped", ax2.length === 0, ax2);
  const ax3 = bc.checkPromptAgainstSpec({ text: "Is the Gold the best of the credit cards for groceries?", spec: blindA, category: CAT["American Express"], extraForms: XF });
  expect("aliases: capitalized 'Gold' names the brand", ax3.some((x: any) => x.check === "blind_names_brand"), ax3);
  const mx = bc.checkPromptAgainstSpec({ text: "My Gold annual fee hits next month. Keep it another year or cancel?", spec: mustA, category: CAT["American Express"], extraForms: XF });
  expect("aliases: must-name satisfied by a capitalized everyday alias", mx.length === 0, mx);
  // r15: the must-name side is tolerant by design (any name form or alias
  // satisfies it); only the forbidden side consults the judge.
  const mx2 = bc.checkPromptAgainstSpec({ text: "Is the gold standard card's annual fee worth it another year, or cancel?", spec: mustA, category: CAT["American Express"], extraForms: XF });
  expect("aliases: must-name side stays tolerant (an alias satisfies it)", mx2.length === 0, mx2);
}
console.log(`5. spec era: ${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}`);

// =====================================================================
// 6. TYPED ROSTER (2026-09-30): competitors are typed by who they sell to;
// upstream brands (sold to the trade, not this audience) hold no cells and
// are free vocabulary. Absent roles must reproduce today's behavior exactly.
// =====================================================================
const fails5 = fails;
console.log("6. typed roster");
const AMEX_ROSTER = ["Chase", "Visa", "Capital One", "Mastercard", "Citi", "Discover"];
const AMEX_ROLES = { Visa: "upstream", Mastercard: "upstream" } as const;
{
  // (a) blind cell on the AmEx config: an upstream network is vocabulary
  //     BY TYPE; a same-seat issuer is still a leak.
  const seated = bc.sameSeatOf(AMEX_ROSTER, AMEX_ROLES);
  expect("sameSeatOf drops upstream, keeps order", JSON.stringify(seated) === JSON.stringify(["Chase", "Capital One", "Citi", "Discover"]), seated);
  expect("upstreamOf lists the weather in order", JSON.stringify(bc.upstreamOf(AMEX_ROSTER, AMEX_ROLES)) === JSON.stringify(["Visa", "Mastercard"]));
  const cell = { stage: "discovery", angle: "generic", text: "which credit cards have no foreign transaction fees?" };
  const typed = specOf(cell, "American Express", seated, "credit cards");
  expect("typed spec: Visa / Mastercard are in neither brand set",
    !typed.forbiddenBrands.includes("Visa") && !typed.forbiddenBrands.includes("Mastercard") && typed.requiredBrands.length === 0, typed.forbiddenBrands);
  const visa = bc.checkPromptAgainstSpec({ text: "any Visa card with no foreign fees?", spec: typed, category: "credit cards", extraForms: FORMS });
  expect("typed: 'any Visa card with no foreign fees' is NOT blind_names_brand", !visa.some((x: any) => x.check === "blind_names_brand"), visa);
  const chase = bc.checkPromptAgainstSpec({ text: "is a Chase card good with no foreign fees?", spec: typed, category: "credit cards", extraForms: FORMS });
  expect("typed: 'a Chase card' still IS blind_names_brand", chase.some((x: any) => x.check === "blind_names_brand"), chase);
  const untyped = specOf(cell, "American Express", AMEX_ROSTER, "credit cards");
  const visaUntyped = bc.checkPromptAgainstSpec({ text: "any Visa card with no foreign fees?", spec: untyped, category: "credit cards", extraForms: FORMS });
  expect("control: untyped roster still flags the Visa prompt (the change is by type)", visaUntyped.some((x: any) => x.check === "blind_names_brand"), visaUntyped);
  // The legacy string path and the battery sweep scope the same way.
  const sweep = bc.checkBattery({ brand: "American Express", competitors: seated, category: "credit cards", extraForms: FORMS,
    cells: [{ ...cell, phrasings: ["any Visa card with no foreign fees?", "is a Chase card good abroad, no foreign fees?"] }] });
  expect("typed sweep (legacy path): only the Chase paraphrase flags",
    sweep.filter((x: any) => x.check === "blind_names_brand").map((x: any) => x.text).join("|") === "is a Chase card good abroad, no foreign fees?", sweep);
  // Must-name stage: an upstream network named in a doubt is not a rival leak.
  const doubt = specOf({ stage: "objections", angle: "generic", text: "does American Express still get turned down at small shops?" },
    "American Express", seated, "credit cards");
  const acc = bc.checkPromptAgainstSpec({ text: "Amex gets declined where Visa works - still worth carrying?", spec: doubt, category: "credit cards", extraForms: FORMS });
  expect("typed must-name: naming upstream Visa is not must_name_names_rival", acc.length === 0, acc);
}
{
  // (b) angle slots skip upstream entries - list position no longer
  //     denies a same-seat rival its comparison / alternatives cells.
  const mixed = ["Visa", "Chase", "Mastercard", "Capital One", "Citi", "Discover"];
  const slots = bc.angleRivals(mixed, AMEX_ROLES);
  expect("angle slots = first 4 same-seat rivals", JSON.stringify(slots) === JSON.stringify(["Chase", "Capital One", "Citi", "Discover"]), slots);
  expect("untyped angle slots = roster.slice(0, 4) (today)", JSON.stringify(bc.angleRivals(mixed)) === JSON.stringify(mixed.slice(0, 4)));
  expect("a hand-added / unlisted name defaults same_seat", bc.rosterRoleOf("Wells Fargo", AMEX_ROLES) === "same_seat");
  expect("role lookup is case/punctuation-blind", bc.rosterRoleOf("visa", AMEX_ROLES) === "upstream");
  const comp = specOf({ stage: "comparison", angle: "Discover", text: "amex or discover for cash back?" }, "American Express", bc.sameSeatOf(mixed, AMEX_ROLES), "credit cards");
  const viaVisa = bc.checkCandidateSignature("Amex vs Discover - and does Visa acceptance matter for cash back?", comp, { category: "credit cards", extraForms: FORMS });
  expect("typed comparison: an upstream mention is no extra-rival leak", viaVisa.ok, viaVisa);
}
{
  // (c) absent / empty / all-same-seat roles reproduce today's findings
  //     byte-for-byte on the existing corpora.
  const identity = (comp: string[]) =>
    bc.sameSeatOf(comp, undefined) === comp && bc.sameSeatOf(comp, {}) === comp &&
    bc.sameSeatOf(comp, Object.fromEntries(comp.map((c) => [c, "same_seat"]))) === comp;
  let bad = 0;
  for (const [brand, P] of Object.entries<any>(head.projects)) {
    if (!identity(P.competitors)) bad++;
    const cells = P.cells.map((c: any, i: number) => ({
      stage: c.stage, angle: c.angle, text: c.text,
      phrasings: (P.phrasings[i] ?? []).map((x: any) => (typeof x === "string" ? x : x.text)),
    }));
    for (const roles of [undefined, {}, Object.fromEntries(P.competitors.map((c: string) => [c, "same_seat"]))]) {
      const comp = bc.sameSeatOf(P.competitors, roles);
      const a = JSON.stringify(bc.checkBattery({ brand, competitors: P.competitors, category: CAT[brand], cells }));
      const b = JSON.stringify(bc.checkBattery({ brand, competitors: comp, category: CAT[brand], cells }));
      const sa = JSON.stringify(bc.checkBattery({ brand, competitors: P.competitors, category: CAT[brand],
        cells: cells.map((c: any) => ({ ...c, spec: specOf(c, brand, P.competitors, CAT[brand]) })) }));
      const sb = JSON.stringify(bc.checkBattery({ brand, competitors: comp, category: CAT[brand],
        cells: cells.map((c: any) => ({ ...c, spec: specOf(c, brand, comp, CAT[brand]) })) }));
      if (a !== b || sa !== sb) bad++;
    }
  }
  for (const p of live) {
    const comp = bc.sameSeatOf(COMP[p.project], {});
    if (!identity(COMP[p.project])) bad++;
    const angle = p.angle ?? "generic";
    const x = JSON.stringify(specOf({ stage: p.stage, angle, text: p.text }, p.project, COMP[p.project], CAT[p.project]));
    const y = JSON.stringify(specOf({ stage: p.stage, angle, text: p.text }, p.project, comp, CAT[p.project]));
    if (x !== y) bad++;
  }
  expect("untyped / empty / all-same-seat roles: harness + fixed-battery findings and specs byte-identical", bad === 0, { bad });
  // Cache keys: an untouched roster keys exactly as before (no STYLE_VERSION
  // bump); only a tracker whose same-seat list differs re-keys.
  delete process.env.DATABASE_URL;
  const inst = await import(`${REPO}/src/lib/engine/instrument`);
  const base = { involvement: "considered", verifiability: "spec", think_feel: "think", decision_unit: "solo" };
  const args = (comp: string[]) => ({ brand: "American Express", category: "credit cards", competitors: comp, audience: "US consumers", base, scenarios: [], count: 10 });
  const row = { stage: "comparison", situation: null, angle: "Discover", scope: null };
  const cellK = { situation: null, mode: null, text: "amex or discover for cash back?" };
  const k0 = inst.gridCellCacheKey(args(COMP["American Express"]), row);
  const k1 = inst.gridCellCacheKey(args(bc.sameSeatOf(COMP["American Express"], { Chase: "same_seat" })), row);
  expect("untouched roster: grid cell cache key unchanged", k0 === k1);
  expect("untouched roster: phrasing cache key unchanged",
    inst.phrasingCacheKey(args(COMP["American Express"]), cellK) === inst.phrasingCacheKey(args(bc.sameSeatOf(COMP["American Express"], {})), cellK));
  const kTyped = inst.gridCellCacheKey(args(bc.sameSeatOf(AMEX_ROSTER, AMEX_ROLES)), row);
  const kUntyped = inst.gridCellCacheKey(args(AMEX_ROSTER), row);
  expect("a roster whose same-seat list differs re-keys", kTyped !== kUntyped);
  // Decision 3 (2026-10-03): head-to-head picks ride rosterRoles as
  // same_seat (picked) / bench / adjacent. A pick-free roster keeps the old
  // slots and keys; picks decide the slots with no backfill; bench and
  // adjacent brands stay in the brand-check scope.
  const JIRA7 = ["Asana", "Trello", "Monday.com", "ClickUp", "GitHub Issues", "Azure DevOps", "Linear"];
  expect("pick-free roster: slots are the first 4 in order",
    JSON.stringify(bc.angleRivals(JIRA7, { Asana: "same_seat" })) === JSON.stringify(["Asana", "Trello", "Monday.com", "ClickUp"]));
  const picks = { Asana: "same_seat", Trello: "bench", "Monday.com": "same_seat", ClickUp: "bench", "GitHub Issues": "same_seat", "Azure DevOps": "bench", Linear: "same_seat" } as const;
  expect("picks decide the slots, in roster order",
    JSON.stringify(bc.angleRivals(JIRA7, picks)) === JSON.stringify(["Asana", "Monday.com", "GitHub Issues", "Linear"]), bc.angleRivals(JIRA7, picks));
  const three = { ...picks, Linear: "bench" } as const;
  expect("three picks = three slots, never a backfill", bc.angleRivals(JIRA7, three).length === 3, bc.angleRivals(JIRA7, three));
  expect("bench rivals stay in the brand-check scope", bc.sameSeatOf(JIRA7, picks).length === 7);
  const DOR = ["Tostitos", "Takis", "Cheetos", "Lay's", "Pringles", "Mission"];
  const dorRoles = { Tostitos: "same_seat", Takis: "same_seat", Cheetos: "adjacent", "Lay's": "adjacent", Pringles: "adjacent", Mission: "same_seat" } as const;
  expect("adjacent brands never hold a slot",
    JSON.stringify(bc.angleRivals(DOR, dorRoles)) === JSON.stringify(["Tostitos", "Takis", "Mission"]), bc.angleRivals(DOR, dorRoles));
  expect("adjacent brands stay forbidden in blind cells",
    specOf({ stage: "discovery", angle: "generic", text: "best tortilla chips for game day?" }, "Doritos", bc.sameSeatOf(DOR, dorRoles), "tortilla chips").forbiddenBrands.includes("Cheetos"));
  const jargs = (roles?: Record<string, string>) => ({ brand: "Jira", category: "project management software", competitors: JIRA7, audience: "software teams", base, scenarios: [], count: 10, rosterRoles: roles });
  const jrow = { stage: "discovery", situation: null, angle: "generic", scope: null };
  expect("pick-free roles key byte-identically to no roles",
    inst.gridCellCacheKey(jargs(undefined), jrow) === inst.gridCellCacheKey(jargs({ Asana: "same_seat" }), jrow)
    && inst.phrasingCacheKey(jargs(undefined), cellK) === inst.phrasingCacheKey(jargs({ Asana: "same_seat" }), cellK));
  expect("a changed pick re-keys (the writer's Rivals line changes)",
    inst.gridCellCacheKey(jargs(undefined), jrow) !== inst.gridCellCacheKey(jargs(picks), jrow));
}
console.log(`6. typed roster: ${fails === fails5 ? "ALL PASS" : `${fails - fails5} FAILURE(S)`}`);

// =====================================================================
// 7. CLASS-ANGLE CELLS (2026-10-01): a consumer-salient upstream brand
// earns a head-to-head against its CLASS ("a Visa card"), never against a
// named rival entity. Additive plan rows, comparison_class specs, and no
// class fields = byte-identical behavior (self-versioning through request
// data - no STYLE_VERSION bump).
// =====================================================================
const fails6 = fails;
console.log("7. class-angle cells");
const AMEX_SEATED = bc.sameSeatOf(AMEX_ROSTER, AMEX_ROLES);
const VISA_CLASS = { classPhrase: "a Visa card", classBrand: "Visa" };
const classSeed = "worth paying for American Express over just getting a Visa card?";
{
  // (a) the comparison_class contract on the AmEx config.
  const cell = { stage: "comparison", angle: "class", text: classSeed, ...VISA_CLASS };
  const spec = specOf(cell as any, "American Express", AMEX_SEATED, "credit cards");
  expect("class spec: brandMode comparison_class, qtype head_to_head",
    spec.brandMode === "comparison_class" && spec.qtype === "head_to_head", { mode: spec.brandMode, qtype: spec.qtype });
  expect("class spec: required = [target] only; class carried separately",
    JSON.stringify(spec.requiredBrands) === JSON.stringify(["American Express"]) && spec.classBrand === "Visa" && spec.classPhrase === "a Visa card", spec);
  expect("class spec: every same-seat rival forbidden",
    JSON.stringify(spec.forbiddenBrands) === JSON.stringify(["Chase", "Capital One", "Citi", "Discover"]), spec.forbiddenBrands);
  const untypedSpec = specOf(cell as any, "American Express", AMEX_ROSTER, "credit cards");
  expect("untyped roster: the class's own brand is never forbidden, other tracked brands are",
    !untypedSpec.forbiddenBrands.includes("Visa") && untypedSpec.forbiddenBrands.includes("Mastercard") && untypedSpec.forbiddenBrands.includes("Chase"),
    untypedSpec.forbiddenBrands);
  const chk = (t: string) => bc.checkPromptAgainstSpec({ text: t, spec, category: "credit cards", extraForms: FORMS });
  expect("seed passes", chk(classSeed).length === 0, chk(classSeed));
  expect("seed passes its own signature (target + classBrand)",
    bc.checkCandidateSignature(classSeed, spec, { category: "credit cards", extraForms: FORMS }).ok);
  const chase = chk("worth paying for American Express over a Chase card or just a Visa card?");
  expect("same text naming Chase fails (extra rival)", chase.some((x: any) => x.check === "comparison_names_extra_rival"), chase);
  const swapped = "is American Express worth it over a Chase Sapphire?";
  const sw = chk(swapped);
  expect("class swapped for 'Chase Sapphire' fails: class not evoked AND rival named",
    sw.some((x: any) => x.check === "comparison_class_missing_class") && sw.some((x: any) => x.check === "comparison_names_extra_rival"), sw);
  const swSig = bc.checkCandidateSignature(swapped, spec, { category: "credit cards", extraForms: FORMS });
  expect("swap: signature reports Visa missing and Chase leaked",
    !swSig.ok && swSig.missing.includes("Visa") && swSig.leaked.includes("Chase"), swSig);
  const dl = spec.designLine ?? "";
  expect("design line has the head-to-head-vs-a-class contract shape",
    dl.startsWith("Question design (head-to-head vs a class):") && dl.includes("American Express against a Visa card as a CLASS of products") &&
    dl.includes("a specific rival product or company name in place of the class does not satisfy the design") && dl.includes(`Designed as: "${classSeed}"`), dl);
  expect("design line equals seedDesignLine with the class (the paraphrase design check derives the same line)",
    dl === bc.seedDesignLine("comparison", "American Express", classSeed, null, { classPhrase: "a Visa card" }));
  const lower = chk("amex or just a visa card - which one is actually worth it?");
  expect("lowercase 'visa' passes (case-blind class brand)", lower.length === 0, lower);
  const noClass = chk("is American Express worth paying for?");
  expect("a prompt that never evokes the class fails", noClass.some((x: any) => x.check === "comparison_class_missing_class"), noClass);
  const noTarget = chk("is a Visa card good enough for most people?");
  expect("a prompt that drops the target fails", noTarget.some((x: any) => x.check === "comparison_missing_target"), noTarget);
  const mc = chk("American Express or just a Visa or Mastercard card?");
  expect("another upstream brand is free vocabulary under the typed roster (design check owns class framing)", mc.length === 0, mc);
  const note = bc.specWriterNote(spec) ?? "";
  expect("writer note renders the class contract", note.includes("vs a CLASS") && note.includes("a Visa card") && note.includes("never a specific rival company or product"), note);
  // Class cells are spec-era by construction: no carried spec still resolves.
  const re = bc.resolveCellSpec({ ...cell }, "American Express", AMEX_SEATED, "credit cards");
  expect("resolveCellSpec derives a class cell with no carried spec", re?.brandMode === "comparison_class");
  // Sweep: the battery drops only the Chase paraphrase.
  const sweep = bc.checkBattery({ brand: "American Express", competitors: AMEX_SEATED, category: "credit cards", extraForms: FORMS,
    cells: [{ ...cell, spec, phrasings: ["amex vs just getting a visa card - is the fee worth it?", "Amex or a Chase card, or just a Visa card?"] }] });
  expect("battery sweep: only the Chase paraphrase flags",
    sweep.length === 1 && sweep[0].text === "Amex or a Chase card, or just a Visa card?", sweep);
  expect("a class field on a non-comparison stage is ignored",
    bc.deriveCheckSpec({ stage: "discovery", angle: "generic", text: "best credit cards for travel?", ...VISA_CLASS } as any,
      "American Express", AMEX_SEATED, "credit cards").brandMode === "blind");
}
{
  // (b) untouched path: absent / undefined / null class fields reproduce
  //     today's specs, findings, design lines and cache keys byte-for-byte.
  let bad = 0;
  const variants = (c: any) => [c, { ...c, classPhrase: undefined, classBrand: undefined }, { ...c, classPhrase: null, classBrand: null }];
  for (const [brand, P] of Object.entries<any>(head.projects)) {
    const cells = P.cells.map((c: any, i: number) => ({
      stage: c.stage, angle: c.angle, text: c.text,
      phrasings: (P.phrasings[i] ?? []).map((x: any) => (typeof x === "string" ? x : x.text)),
    }));
    const ref = JSON.stringify(bc.checkBattery({ brand, competitors: P.competitors, category: CAT[brand],
      cells: cells.map((c: any) => ({ ...c, spec: specOf(c, brand, P.competitors, CAT[brand]) })) }));
    for (const k of [1, 2]) {
      const alt = JSON.stringify(bc.checkBattery({ brand, competitors: P.competitors, category: CAT[brand],
        cells: cells.map((c: any) => ({ ...c, spec: specOf(variants(c)[k], brand, P.competitors, CAT[brand]) })) }));
      if (alt !== ref) bad++;
    }
    for (const c of cells) {
      const specs = variants(c).map((v: any) => JSON.stringify(specOf(v, brand, P.competitors, CAT[brand])));
      if (specs[0] !== specs[1] || specs[0] !== specs[2] || specs[0].includes("classPhrase") || specs[0].includes("comparison_class")) bad++;
      if (bc.seedDesignLine(c.stage, brand, c.text) !== bc.seedDesignLine(c.stage, brand, c.text, null, null)) bad++;
    }
  }
  for (const p of live) {
    const angle = p.angle ?? "generic";
    const c = { stage: p.stage, angle, text: p.text };
    const specs = variants(c).map((v: any) => JSON.stringify(specOf(v, p.project, COMP[p.project], CAT[p.project])));
    if (specs[0] !== specs[1] || specs[0] !== specs[2]) bad++;
    if (bc.resolveCellSpec({ ...c, classPhrase: null }, p.project, COMP[p.project]) !== null) bad++;
  }
  expect("absent / undefined / null class fields: harness + fixed-battery specs, findings and design lines byte-identical", bad === 0, { bad });
  expect("classAnglesOf: no classes / no roles = none",
    bc.classAnglesOf(AMEX_ROSTER, AMEX_ROLES).length === 0 && bc.classAnglesOf(AMEX_ROSTER, undefined, { Visa: "a Visa card" }).length === 0 &&
    bc.classAnglesOf(AMEX_ROSTER, AMEX_ROLES, {}).length === 0);
  const inst = await import(`${REPO}/src/lib/engine/instrument`);
  const base = { involvement: "considered", verifiability: "spec", think_feel: "think", decision_unit: "solo" };
  const args = { brand: "American Express", category: "credit cards", competitors: AMEX_SEATED, audience: "US consumers", base, scenarios: [], count: 10 };
  let kbad = 0;
  for (const row of [
    { stage: "comparison", situation: null, angle: "Discover", scope: null },
    { stage: "objections", situation: null, angle: "generic", scope: null, concern: "acceptance at small shops" },
    { stage: "discovery", situation: null, angle: "generic", scope: "A, B" },
  ]) {
    const k0 = inst.gridCellCacheKey(args, row);
    if (k0 !== inst.gridCellCacheKey(args, { ...row, classPhrase: undefined, classBrand: undefined })) kbad++;
    if (k0 !== inst.gridCellCacheKey(args, { ...row, classPhrase: null, classBrand: null })) kbad++;
  }
  for (const cellK of [{ situation: null, mode: null, text: "amex or discover for cash back?" }, { situation: null, mode: null, text: "x", spec: {}, concern: "fees" }]) {
    const k0 = inst.phrasingCacheKey(args, cellK, ["fees"]);
    if (k0 !== inst.phrasingCacheKey(args, { ...cellK, classPhrase: undefined, classBrand: undefined }, ["fees"])) kbad++;
    if (k0 !== inst.phrasingCacheKey(args, { ...cellK, classPhrase: null, classBrand: null }, ["fees"])) kbad++;
  }
  expect("untouched rows/cells: grid-cell and phrasing cache keys unchanged", kbad === 0, { kbad });
  const classRow = { stage: "comparison", situation: null, angle: "class", scope: null, ...VISA_CLASS };
  const mcRow = { ...classRow, classPhrase: "a Mastercard card", classBrand: "Mastercard" };
  const kv = inst.gridCellCacheKey(args, classRow);
  expect("class rows self-version: Visa / Mastercard / bare-'class' keys all distinct",
    new Set([kv, inst.gridCellCacheKey(args, mcRow), inst.gridCellCacheKey(args, { ...classRow, classPhrase: undefined, classBrand: undefined })]).size === 3);
  const kp = inst.phrasingCacheKey(args, { situation: null, mode: null, text: classSeed, spec: {}, ...VISA_CLASS });
  expect("class cells' paraphrase sets key apart from the same text without the class",
    kp !== inst.phrasingCacheKey(args, { situation: null, mode: null, text: classSeed, spec: {} }));

  // (c) plan construction: a mixed roster with 2 salient upstreams yields
  //     exactly 2 ADDITIVE class rows; the entity slots are unchanged.
  const MIXED = ["Visa", "Chase", "Mastercard", "Capital One", "UnionPay", "Citi", "Discover"];
  const ROLES3 = { Visa: "upstream", Mastercard: "upstream", UnionPay: "upstream" } as const;
  const CLASSES = { Visa: "a Visa card", Mastercard: "a Mastercard card", Chase: "a Chase card" };
  const angles = bc.classAnglesOf(MIXED, ROLES3, CLASSES);
  // "a Mastercard card" collapses to "a Mastercard" at read time (audit J9:
  // the brand token already ends with the class head noun).
  expect("classAnglesOf: upstream entries with a phrase, roster order (UnionPay has none; same-seat Chase never; doubled head noun collapsed)",
    JSON.stringify(angles) === JSON.stringify([{ classBrand: "Visa", classPhrase: "a Visa card" }, { classBrand: "Mastercard", classPhrase: "a Mastercard" }]), angles);
  const capped = bc.classAnglesOf(MIXED, ROLES3, { ...CLASSES, UnionPay: "a UnionPay card" });
  expect(`classAnglesOf caps at CLASS_SLOTS (${bc.CLASS_SLOTS})`, capped.length === bc.CLASS_SLOTS && capped[1].classBrand === "Mastercard", capped);
  const stages = [
    { key: "discovery", columns: ["A", "B"], situational: true, rivals: "none" },
    { key: "comparison", columns: ["A", "B"], situational: true, rivals: "each" },
    { key: "alternatives", columns: [], situational: false, rivals: "defensive_offensive" },
  ] as any[];
  const rivals = bc.angleRivals(bc.sameSeatOf(MIXED, ROLES3), ROLES3);
  const plain = inst.planGridCells(stages, ["A", "B"], rivals);
  const none = inst.planGridCells(stages, ["A", "B"], rivals, []);
  const withCls = inst.planGridCells(stages, ["A", "B"], rivals, angles);
  const classRows = withCls.filter((r: any) => r.classPhrase);
  const strip = (rows: any[]) => JSON.stringify(rows.map((r) => ({ ...r, stage: r.stage.key })));
  expect("no class angles = identical plan (default and [])", strip(plain) === strip(none));
  expect("exactly 2 class rows, both comparison, angle 'class', roster order",
    classRows.length === 2 && classRows.every((r: any) => r.stage.key === "comparison" && r.angle === "class") &&
    classRows.map((r: any) => r.classBrand).join(",") === "Visa,Mastercard", classRows.map((r: any) => [r.stage.key, r.angle, r.classPhrase, r.situation]));
  expect("entity rows unchanged (class rows are additive)", strip(withCls.filter((r: any) => !r.classPhrase)) === strip(plain));
  expect("entity comparison slots are the 4 same-seat rivals",
    withCls.filter((r: any) => r.stage.key === "comparison" && !r.classPhrase).map((r: any) => r.angle).join(",") === "Chase,Capital One,Citi,Discover");
  expect("class rows follow the entity rows within the comparison stage",
    withCls.findIndex((r: any) => r.classPhrase) === withCls.map((r: any) => r.stage.key === "comparison" && !r.classPhrase).lastIndexOf(true) + 1);
  // s10: comparisons are scenario-invariant - every comparison row (entity
  // and class) carries no situation; the old build cycled scenarios
  // through them, confounding rival with circumstance.
  expect("comparison rows are scenario-invariant (situation null on entity and class rows)",
    withCls.filter((r: any) => r.stage.key === "comparison").every((r: any) => r.situation === null));
  expect("a battery without the comparison stage gets no class rows",
    inst.planGridCells(stages.filter((s) => s.key !== "comparison"), ["A", "B"], rivals, angles).every((r: any) => !r.classPhrase));
}
console.log(`7. class-angle cells: ${fails === fails6 ? "ALL PASS" : `${fails - fails6} FAILURE(S)`}`);

// --- 8. Worries module: confirmed picks replace the concern zip for doubt stages ---
console.log("8. worries module");
const fails7 = fails;
{
  const inst = await import(`${REPO}/src/lib/engine/instrument`);
  const stages = [
    { key: "discovery", columns: ["A", "B"], situational: true, rivals: "none" },
    { key: "objections", columns: ["A", "B"], situational: true, rivals: "none" },
    { key: "churn_triggers", columns: [], situational: false, rivals: "none" },
    { key: "renewal", columns: [], situational: false, rivals: "none" },
    { key: "comparison", columns: ["A", "B"], situational: true, rivals: "each" },
  ] as any[];
  const rivals = ["R1", "R2"];
  const strip = (rows: any[]) => JSON.stringify(rows.map((r) => ({ ...r, stage: r.stage.key })));
  const legacy = inst.planGridCells(stages, ["A", "B"], rivals);
  const omitted = inst.planGridCells(stages, ["A", "B"], rivals, [], undefined);
  expect("worries omitted = legacy plan byte-identical (untouched path)", strip(legacy) === strip(omitted));
  expect("legacy shape holds: objections one per scenario, churn/renewal single invariant",
    legacy.filter((r: any) => r.stage.key === "objections").map((r: any) => r.situation).join(",") === "A,B" &&
    legacy.filter((r: any) => r.stage.key === "churn_triggers").length === 1 &&
    legacy.filter((r: any) => r.stage.key === "renewal").length === 1);
  const picks = [
    { concern: "high fees", stage: "objections" },
    { concern: "slow support", stage: "objections" },
    { concern: "points lock-in", stage: "churn_triggers" },
  ];
  const planned = inst.planGridCells(stages, ["A", "B"], rivals, [], picks);
  const doubt = (k: string) => planned.filter((r: any) => r.stage.key === k);
  expect("one invariant row per worry-stance, concern riding the row",
    doubt("objections").length === 2 &&
    doubt("objections").every((r: any) => r.situation === null && r.angle === "generic") &&
    doubt("objections").map((r: any) => r.concern).join("|") === "high fees|slow support" &&
    doubt("churn_triggers").length === 1 && doubt("churn_triggers")[0].concern === "points lock-in",
    planned.filter((r: any) => ["objections", "churn_triggers"].includes(r.stage.key)));
  expect("a doubt stage with no assigned worries mints ZERO rows (deliberate pick, not a gap)",
    doubt("renewal").length === 0);
  expect("non-doubt stages are byte-identical with and without worries",
    strip(planned.filter((r: any) => !["objections", "churn_triggers", "renewal"].includes(r.stage.key))) ===
    strip(legacy.filter((r: any) => !["objections", "churn_triggers", "renewal"].includes(r.stage.key))));
  const keyArgs = {
    brand: "Acme", category: "widgets", competitors: [], audience: null,
    base: {} as any, scenarios: [{ label: "A", description: "a", journey: null }, { label: "B", description: "b", journey: null }],
  };
  const k = (concern: string) => inst.gridCellCacheKey(keyArgs as any, {
    stage: "objections", situation: null, angle: "generic", scope: null, concern,
  });
  expect("worry rows key apart per concern", k("high fees") !== k("slow support"));
}
console.log(`8. worries module: ${fails === fails7 ? "ALL PASS" : `${fails - fails7} FAILURE(S)`}`);

console.log("9. r25 nets");
const fails8 = fails;
{
  // Label stems: a vault-everyday nominalization is the buyer's word; a
  // planning-register one still leaks by stem.
  expect("everyday label word does not leak by stem (collaboration -> collaborate)",
    bc.scenarioLabelLeak("We manage client projects and clients ask for status. How do we let them collaborate?", ["Client delivery collaboration"], "project management software") === null);
  expect("planning-register label word still leaks by stem (unification -> unificat...)",
    bc.scenarioLabelLeak("We're pushing unification of how we track work after the merger.", ["Post-acquisition unification"], "project management software") === "Post-acquisition unification");
  expect("full-label copy still leaks",
    bc.scenarioLabelLeak("Client delivery collaboration is our thing - what should we use?", ["Client delivery collaboration"], "project management software") === "Client delivery collaboration");
  // Criteria dependency connector.
  const instr = await import(`${REPO}/src/lib/engine/instrument`);
  const dep = (t: string) => instr.CRITERIA_DEPENDENCY.test(t);
  expect("criteria with 'given that' passes", dep("I'm picking a main card. What should I look at, and given that, what should I consider?"));
  expect("criteria with 'then' passes", dep("I need a new card. What should I look at, and then what should I consider?"));
  expect("criteria with two unconnected asks fails", !dep("I'm choosing a card for travel. What should I look at, and what should I consider?"));
  expect("criteria 'focus on, and how should I choose' fails", !dep("My phone's paid off. What should I focus on, and how should I choose?"));
  // Feature screening in a scenario carries the no-channel clause; use case keeps its own.
  const fsIntent = bc.stageDesignIntent("feature_screening", "Acme", undefined, "generic", "Carrier switch :: a buyer changing networks during a promotion");
  expect("feature-screening design intent in a scenario rejects a buying channel", /buying channel or moment/.test(fsIntent ?? ""));
  const fsBare = bc.stageDesignIntent("feature_screening", "Acme", undefined, "generic", null);
  expect("feature-screening design intent without a scenario is unchanged", !/buying channel or moment/.test(fsBare ?? ""));
}
console.log(`9. r25 nets: ${fails === fails8 ? "ALL PASS" : `${fails - fails8} FAILURE(S)`}`);

console.log("10. p15 paraphrase guards");
const fails9 = fails;
{
  const instr = await import(`${REPO}/src/lib/engine/instrument`);
  expect("count frequency kept at level passes", instr.keepsFrequency("I travel several times a year; is X worth it?", "I make a handful of trips each year; is X worth it?"));
  expect("count frequency vagued up fails", !instr.keepsFrequency("I travel several times a year; is X worth it?", "I travel for work a lot - is X worth it?"));
  expect("count frequency scaled down fails", !instr.keepsFrequency("I travel several times a year; is X worth it?", "I travel a couple times annually; is X worth it?"));
  expect("count frequency dropped fails", !instr.keepsFrequency("I travel several times a year; is X worth it?", "Leisure traveler here, is X worth it?"));
  expect("cadence-only seed constrains nothing", instr.keepsFrequency("I pay in full every month and want one card.", "I always pay off my statement and want one card."));
  expect("seed without a frequency constrains nothing", instr.keepsFrequency("I want one card for everything.", "I travel a lot and want one card."));
  expect("hearsay opener detected", instr.HEARSAY_OPENER.test("I heard X is rough if you carry a balance - is that the case?"));
  expect("own claim is not hearsay", !instr.HEARSAY_OPENER.test("I'm worried X is a bad pick if I carry a balance. Is that fair?"));
  expect("longest shared run", instr.longestSharedRunWords("i'm moving my card off x what should i get".split(" "), "i'm moving my card off x which one next".split(" ")).join(" ") === "i'm moving my card off x");
  expect("criteria connector widened (afterward, because of that, once i do)",
    ["What should I check, and what should I consider afterward?", "What should I look at, and because of that, what should I consider?", "What should I evaluate, and once I do, what should I weigh?"].every((t) => instr.CRITERIA_DEPENDENCY.test(t)));
  expect("criteria second ask asking for products is caught",
    instr.criteriaAsksForProducts("I pay in full monthly. What should I look at, and given that, what credit cards should I consider?", "credit cards") &&
    instr.criteriaAsksForProducts("What should I check, and then which brands should I look at?", "credit cards"));
  expect("criteria two-part ask without a product ask passes",
    !instr.criteriaAsksForProducts("I pay in full monthly. What should I look at, and given that, what should I consider?", "credit cards") &&
    !instr.criteriaAsksForProducts("What matters when comparing credit cards, and given that, what trade-offs should I accept?", "credit cards"));
  expect("'keep hearing' is hearsay", instr.HEARSAY_OPENER.test("I keep hearing X isn't accepted much - is that true?"));
}
console.log(`10. p15 paraphrase guards: ${fails === fails9 ? "ALL PASS" : `${fails - fails9} FAILURE(S)`}`);

console.log("11. p17 paraphrase guards");
const fails10 = fails;
{
  const instr = await import(`${REPO}/src/lib/engine/instrument`);
  expect("'in full' kept by substance", instr.keepsQualifiers("I pay my statement in full each month; is X worth it?", "I clear my statement balance each month; is X worth it?"));
  expect("'in full' lost fails", !instr.keepsQualifiers("I pay my statement in full each month; is X worth it?", "Because I always pay monthly, is X worth it?"));
  expect("'over time' kept as spread payments", instr.keepsQualifiers("I need to pay it down over time.", "I want to spread the payments across months."));
  expect("seed without a qualifier constrains nothing", instr.keepsQualifiers("I want one card for everything.", "I pay monthly and want one card."));
  expect("purpose added is caught", instr.addsPurposeOrDestination("I take several trips a year and want one card.", "I fly for work several times a year and want one card.") === "for work");
  expect("purpose already in the seed passes", instr.addsPurposeOrDestination("I travel abroad a few times a year.", "I go overseas a few times a year.") === null);
  expect("criteria 'consider getting' is caught", instr.criteriaAsksForProducts("What should I look at, and then what should I consider getting?", "credit cards"));
  expect("'I've been told' is hearsay", instr.HEARSAY_OPENER.test("I've been told X is painful if you carry a balance."));
  expect("head-to-head keeps the category noun",
    bc.keepsCategoryNoun("If you're choosing a credit card, X or Y, which one and why?", "X or Y, which card would you pick and why?", "credit cards") &&
    !bc.keepsCategoryNoun("If you're choosing a credit card, X or Y, which one and why?", "X or Y - which would you pick and why?", "credit cards"));
}
console.log(`11. p17 paraphrase guards: ${fails === fails10 ? "ALL PASS" : `${fails - fails10} FAILURE(S)`}`);
if (fails > 0) process.exitCode = 1;


// 12. p18 paraphrase guards (2026-10-07): relation shift and plural slot.
{
  const ok = (label: string, cond: boolean, extra = "") => { if (!cond) { console.error(`   FAIL ${label} ${extra}`); process.exitCode = 1; } else console.log(`   ok   ${label} ${extra}`); };
  const teen = "First phone for our teen. We need to cut distractions during school and bedtime. Which smartphone does that best?";
  ok("teen -> niece is a relation shift", bc.relationShift(teen, "Our niece is getting her first smartphone; which smartphone is best for that?") === "niece");
  ok("teen -> grandkid is a relation shift", bc.relationShift(teen, "Shopping for my grandkid's first smartphone - which is best?") === "grandkid");
  ok("teen -> my 13-year-old is not", bc.relationShift(teen, "My 13-year-old is getting a first phone - which smartphone handles limits best?") === null);
  ok("teen -> kid stays in the family", bc.relationShift(teen, "Our kid's first phone - which smartphone keeps school hours quiet?") === null);
  ok("no relation in the seed constrains nothing", bc.relationShift("Just moved in and setting up the TV. Which services should we start with?", "My roommate and I just moved in - which services should we try?") === null);
  const card = "Annual fee just posted on my American Express card and it feels high. Should I keep it or cancel?";
  ok("possessive + brand + plural term against a singular seed", bc.pluralSlot(card, "The annual fee posted on my American Express credit cards and it feels high - keep or cancel?", "credit cards") === "my american express credit cards");
  ok("bare generic plural passes", bc.pluralSlot("I keep phones four years. Which smartphone lasts?", "I hang on to my smartphones for four years - which one lasts?", "smartphones") === null);
  ok("article + plural term at the phrase head", bc.pluralSlot("I need a new tool. What should I pick?", "Need a new project management tools - which should I pick?", "project management tools") === "a new project management tools");
  ok("term as a modifier passes", bc.pluralSlot("Doritos or Takis for bagged chips?", "If you had to pick one bagged chips brand, Doritos or Takis, which wins?", "bagged chips") === null);
  ok("quantity phrase passes", bc.pluralSlot("Grabbing a few bags for the house; what bagged chips should I look at?", "I need a few bags of bagged chips for the house - which should I check out?", "bagged chips") === null);
  ok("clause boundary passes", bc.pluralSlot("I go out several times a week. What credit cards should I look at?", "I'm out several times a week - what credit cards make sense for that?", "credit cards") === null);
  ok("plural term with a singular verb is a slot", bc.pluralSlot("Which streaming service makes picking easiest?", "Which video streaming services makes it simple to pick something?", "video streaming services") === "which video streaming services makes");
  ok("plural term with a plural verb passes", bc.pluralSlot("Which streaming services should we look at?", "Which video streaming services are worth a look?", "video streaming services") === null);
  // p22: a head-to-head / offensive-alternatives paraphrase keeps SOME category word when the seed has one.
  ok("alternatives dropping the category word is culled", bc.keepsCategoryWord("I'm moving off Disney+ for video streaming. What should I switch to instead?", "I've decided to stop using Disney+. What should I replace it with?", "video streaming services") === false);
  ok("'service' meets 'services'", bc.keepsCategoryWord("For a streaming service, would you pick Netflix or Max, and why?", "Moving away from Max. What service should I switch over to?", "video streaming services") === true);
  ok("'stream' meets 'streaming'", bc.keepsCategoryWord("I'm leaving Max for streaming; what should I get instead?", "Dropping Max - what should I stream on instead?", "video streaming services") === true);
  ok("one-word category is exempt (p17 scope)", bc.keepsCategoryWord("Google Pixel or Samsung Galaxy for a smartphone, which would you pick and why?", "Between Google Pixel and Samsung Galaxy, which would you pick and why?", "smartphones") === true);
  ok("seed without a category word constrains nothing", bc.keepsCategoryWord("Netflix or Disney+, which would you pick and why?", "Netflix vs Disney+ - which and why?", "video streaming services") === true);
  ok("p17 noun keep: 'services' now meets 'service'", bc.keepsCategoryNoun("Which streaming services should we look at?", "Which streaming service should we start with?", "video streaming services") === true);
  console.log("12. p18 paraphrase guards: " + (process.exitCode ? "FAILED" : "ALL PASS"));
}


// 13. Stage structure (p28, 2026-10-09): the table covers every live stage, and the four string readings fire on their shapes only.
{
  const ok = (label: string, cond: boolean, extra = "") => { if (!cond) { console.error(`   FAIL ${label} ${extra}`); process.exitCode = 1; } else console.log(`   ok   ${label} ${extra}`); };
  const ss = await import("../src/lib/engine/stage_structure.ts");
  const live = ["problem_recognition", "category_education", "discovery", "criteria", "use_case", "social_validation", "premium_worth", "comparison", "objections", "churn_triggers", "renewal", "repertoire", "pricing", "business_case", "expansion", "ecosystem", "advocacy"];
  ok("every live stage has a shape", live.every((st) => ss.stageStructure({ stage: st, angle: "generic", situation: "room" }, "Brand") !== null));
  ok("offensive and defensive alternatives have different shapes", ss.stageStructure({ stage: "alternatives", angle: "Rival" }, "Brand")?.shape !== ss.stageStructure({ stage: "alternatives", angle: "defensive" }, "Brand")?.shape);
  ok("generic alternatives and retired stages have none", ss.stageStructure({ stage: "alternatives", angle: "generic" }, "Brand") === null && ss.stageStructure({ stage: "feature_screening", angle: "generic" }, "Brand") === null);
  ok("a class head-to-head names the class", (ss.stageStructure({ stage: "comparison", angle: "class", classPhrase: "a Visa card" }, "Brand")?.properties[0] ?? "").includes("a Visa card"));
  ok("a Value cell names its line and counterpart", (ss.stageStructure({ stage: "pricing", angle: "generic", situation: "r", valueLine: { line: "Brand Plus", counterpart: "a cheaper mid-tier option" } }, "Brand")?.properties[1] ?? "").includes("Brand Plus"));
  const h2h = { stage: "comparison", angle: "Rival" }; const alt = { stage: "alternatives", angle: "Rival" }; const def = { stage: "alternatives", angle: "defensive" }; const val = { stage: "pricing", angle: "generic" }; const crit = { stage: "criteria", angle: "generic" };
  ok("either-way head-to-head", ss.structureStringFail(h2h, "Why would you choose Brand over Rival, or Rival over Brand, for a widget?")?.property === 2);
  ok("'or the other way around'", ss.structureStringFail(h2h, "Would you pick Brand over Rival, or the other way around? Why?")?.property === 2);
  ok("a plain pick passes", ss.structureStringFail(h2h, "Brand or Rival for a widget: which would you choose, and why?") === null);
  ok("conditional move", ss.structureStringFail(alt, "If I leave Rival, what should I get instead?")?.property === 2);
  ok("'once I'm off' is conditional", ss.structureStringFail(alt, "Once I'm off Rival, where should I go instead?")?.property === 2);
  ok("trailing 'if I'm leaving' is conditional", ss.structureStringFail(alt, "Which widget should I get next if I'm leaving Rival?")?.property === 2);
  ok("a decided move passes", ss.structureStringFail(alt, "I'm leaving Rival for widgets. What should I get instead?") === null);
  ok("defensive alternatives are not read for the move", ss.structureStringFail(def, "If I leave Brand, which widgets should I consider next?") === null);
  ok("worth considering", ss.structureStringFail(val, "Is Brand Plus worth considering over cheaper widgets?")?.property === 3);
  ok("worth it passes", ss.structureStringFail(val, "Is Brand Plus worth it over cheaper widgets?") === null);
  ok("one-half criteria", ss.structureStringFail(crit, "What should I consider after figuring out what to look for? I'm buying a widget.")?.property === 3);
  ok("two-part criteria passes", ss.structureStringFail(crit, "I'm buying a widget. What should I look at, and given that, what should I consider?") === null);
  ok("folded criteria (before weighing the rest, no second ask)", ss.structureStringFail(crit, "We're picking a widget for the kids. What should we inspect before deciding what else matters?")?.property === 3);
  ok("'before deciding, and what should I consider' is two asks", ss.structureStringFail(crit, "I'm choosing a widget. What should I assess before deciding, and what should I consider from there?") === null);
  ok("social validation keeps the seed's audience as a property", (ss.stageStructure({ stage: "social_validation", angle: "generic" }, "Brand")?.properties[0] ?? "").includes("audience"));
  console.log("13. stage structure: " + (process.exitCode ? "FAILED" : "ALL PASS"));
}
