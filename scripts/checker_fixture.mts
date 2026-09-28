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

// --- 2. The 30-45W cell (old texts) must flag propagation ---
const watt = read(`${V02}/wattage_fix.json`);
const wattCell = { stage: "ecosystem", angle: "generic", text: watt[0].text, phrasings: watt.slice(1).map((r: any) => r.text) };
const wf = bc.checkBattery({ brand: "Google Pixel", competitors: COMP["Google Pixel"], category: CAT["Google Pixel"], cells: [wattCell] });
console.log(`2. old wattage cell: ${wf.filter((f: any) => f.check === "seed_number_propagation").length > 0 ? "FLAGGED (propagation)" : "MISSED"}`,
  wf.filter((f: any) => f.check === "seed_number_propagation").map((f: any) => f.detail));

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

// --- 4. Negative control: harness-generated batteries ---
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
