/**
 * Structure-check measurement (2026-10-08): run checkStructure over the
 * p26 SERVED paraphrase sets of the five example drafts (206 cells) and
 * write design_ss_p26.json in the same shape as the design_b/b2/b3 runs,
 * so score_design.py can score recall on the known shapes, false flags
 * and overlap. Temp sqlite store, no prod reads, spends ~206 sonnet-low
 * calls. Needs Tyler's go.
 *
 *   npx tsx scripts/_structure_check_tmp.mts
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const REPO = "/Users/tylersolloway/Documents/GitHub/procerno";
const S = "/private/tmp/claude-501/-Users-tylersolloway-Documents-GitHub-procerno/2c4b8744-7aa2-4991-aa7b-1964750e5a1a/scratchpad";
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
delete process.env.DATABASE_URL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "procerno-ss-")));
const { checkStructure, stageStructure } = await import(`${REPO}/src/lib/engine/stage_structure.ts`);
const ctx = JSON.parse(fs.readFileSync(`${S}/drafts_ctx_p22.json`, "utf8"));
const brands: Record<string, string> = { "Jira": "jira", "American Express": "american_express", "Netflix": "netflix", "Google Pixel": "google_pixel", "Doritos": "doritos" };
const out: unknown[] = [];
let calls = 0, flagged = 0, uncovered = 0;
for (const [brand, slug] of Object.entries(brands)) {
  const served = JSON.parse(fs.readFileSync(`${S}/p26_${slug}.json`, "utf8")).cells as { stage: string; situation: string | null; angle: string; concern: string | null; seed: string; phrasings: string[] }[];
  const bySeed = new Map<string, { valueLine?: unknown; classPhrase?: string | null }>();
  for (const c of ctx[brand].cells) bySeed.set(c.text, c);
  const cells = served.map((c) => {
    const d = bySeed.get(c.seed) ?? {};
    return { cell: { stage: c.stage, angle: c.angle, situation: c.situation, concern: c.concern, valueLine: (d.valueLine as never) ?? null, classPhrase: d.classPhrase ?? null }, seed: c.seed, texts: c.phrasings };
  });
  const t0 = Date.now();
  const verdicts = await checkStructure({ brand, cells });
  verdicts.forEach((v: { fails: { property: number; reason: string; clear: boolean }[][]; unchecked?: boolean } | null, i: number) => {
    const c = served[i];
    const s = stageStructure(cells[i].cell, brand);
    if (!s) { uncovered++; out.push({ brand: slug, stage: c.stage, situation: c.situation, seed: c.seed, phrasings: c.phrasings, fails: [], uncovered: true }); return; }
    calls++;
    const fails = v && !v.unchecked
      ? v.fails.flatMap((fs, k) => { const c = fs.filter((f) => f.clear); return c.length ? [{ index: k + 1, property: c[0].property, text: s.properties[c[0].property - 1], reason: c.map((f) => `${f.property}: ${f.reason}`).join(" | "), borderline: fs.length - c.length }] : []; })
      : [];
    flagged += fails.length;
    const borderline = v && !v.unchecked ? v.fails.flatMap((fs, k) => fs.length && !fs.some((f) => f.clear) ? [{ index: k + 1, property: fs[0].property, reason: fs[0].reason }] : []) : [];
    out.push({ brand: slug, stage: c.stage, situation: c.situation, seed: c.seed, phrasings: c.phrasings, fails, borderline, error: v?.unchecked ? "unchecked" : undefined });
  });
  console.log(`${brand}: ${served.length} cells in ${Math.round((Date.now() - t0) / 1000)}s`);
}
fs.writeFileSync(`${S}/design_ss_p26.json`, JSON.stringify(out, null, 1));
console.log(`=== DONE cells ${out.length} checked ${calls} uncovered ${uncovered} flagged paraphrases ${flagged} -> design_ss_p26.json`);
process.exit(0);
