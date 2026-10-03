/**
 * Record brand-judge verdicts for the checker fixture's ambiguous hits
 * (r15). The fixture replays them (no model calls at test time), so its
 * negative controls exercise the REAL judge's answers, not a stub. Rerun
 * when the fixture corpus, the judge prompt or BRAND_JUDGE_MODEL changes.
 * Spends a few cents (one haiku call per ambiguous hit).
 * Usage: npx tsx scripts/record_judge_verdicts.mts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const REPO = path.resolve(new URL(".", import.meta.url).pathname, "..");
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.DATABASE_URL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "procerno-judge-rec-")));
const bc = await import(`${REPO}/src/lib/engine/battery_checks.ts`);
const J = await import(`${REPO}/src/lib/engine/brand_judge.ts`);
const V02 = `${process.env.HOME}/Documents/procerno_eval/labeling/v02_relabel`;
const COMP: Record<string, string[]> = {
  jira: ["Asana", "monday.com", "Linear", "ClickUp"], "American Express": ["Chase", "Capital One", "Citi", "Discover"],
  Netflix: ["Hulu", "Disney+", "Amazon Prime Video", "Max (HBO)"], "Google Pixel": ["Apple iPhone", "Samsung Galaxy", "OnePlus", "Xiaomi"],
};
const FORMS = { "American Express": ["amex"] };
const CAT: Record<string, string> = { jira: "project management software", "American Express": "credit cards", Netflix: "streaming services", "Google Pixel": "smartphones" };
const live = JSON.parse(fs.readFileSync(`${V02}/prompt_stages.json`, "utf8"));
const items: { text: string; brand: string; form: string; category: string }[] = [];
for (const p of live) {
  const comp = COMP[p.project]; if (!comp) continue;
  const spec = bc.deriveCheckSpec({ stage: p.stage, angle: p.angle ?? "generic", text: p.text }, p.project, comp, CAT[p.project]);
  // both fixture paths: the spec's forbidden brands and (legacy) every rival
  const brands = [...new Set([...spec.forbiddenBrands, ...comp, p.project])];
  for (const x of J.pendingJudgments([p.text], brands, FORMS, CAT[p.project], [p.project, ...comp])) items.push({ ...x, category: CAT[p.project] });
}
const out: { text: string; brand: string; form: string; refers: boolean }[] = [];
for (const it of items) {
  const v = await J.judgeBrandMention(it, it.category);
  if (v !== null) out.push({ text: it.text, brand: it.brand, form: it.form, refers: v });
}
fs.writeFileSync(path.join(REPO, "scripts/fixtures/brand_judge_verdicts.json"), JSON.stringify(out, null, 1));
console.log(`${items.length} ambiguous hits, ${out.length} recorded (${out.filter((x) => x.refers).length} refer to the brand) with ${J.BRAND_JUDGE_MODEL}`);
for (const x of out) console.log(`${x.refers ? "YES" : "no "} ${x.brand}:"${x.form}" :: ${x.text.slice(0, 100)}`);
process.exit(0);
