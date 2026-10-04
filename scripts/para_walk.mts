/**
 * PARAPHRASE WALK (2026-10-04): run the real paraphrase engine
 * (generatePhrasings, count 10) over a cold walk's seeds for one brand,
 * from an empty temp store - no prod reads or writes. Specs are re-derived
 * from each seed exactly as generateGrid derives them.
 * Usage: SEEDS_DIR=<cold walk dir> OUT=<dir> npx tsx scripts/para_walk.mts "Jira"
 * Spends API money (paraphrase writer + per-paraphrase checks) - Tyler's go.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const REPO = path.resolve(new URL(".", import.meta.url).pathname, "..");
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.DATABASE_URL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "procerno-para-")));
const inst = await import(`${REPO}/src/lib/engine/instrument.ts`);
const { deriveCheckSpec, sameSeatOf } = await import(`${REPO}/src/lib/engine/battery_checks.ts`);
const { brandAliasForms } = await import(`${REPO}/src/lib/engine/brand_aliases.ts`);
const brand = process.argv[2];
const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const ctx = JSON.parse(fs.readFileSync(path.join(process.env.SEEDS_DIR!, `cold_context_${slug}.json`), "utf8"));
const seeds = JSON.parse(fs.readFileSync(path.join(process.env.SEEDS_DIR!, `cold_seeds_${slug}.json`), "utf8"));
const competitors: string[] = sameSeatOf(ctx.profile.competitors, ctx.rosterRoles);
const aliasForms = await brandAliasForms([brand, ...competitors]);
const cells = seeds.map((c: Record<string, unknown>) => {
  // Older walk files lack classBrand: recover it from the roster's class
  // phrases (the class cell's upstream brand), as the wizard carries it.
  const classBrand = c.classBrand ?? (c.classPhrase ? Object.entries(ctx.rosterClasses ?? {}).find(([, v]) => v === c.classPhrase)?.[0] ?? null : null);
  const cell = { stage: c.stage, situation: c.situation ?? null, angle: c.angle, mode: c.scope ?? null, text: c.text, concern: c.concern ?? null, classPhrase: c.classPhrase ?? null, classBrand, valueLine: c.valueLine ?? null };
  return { ...cell, spec: deriveCheckSpec(cell as never, brand, competitors, ctx.profile.category, aliasForms) };
});
const avoidConcerns = [...new Set(cells.map((c: { concern: string | null }) => c.concern).filter(Boolean))] as string[];
const phr: unknown[][] = [];
for (let i = 0; i < cells.length; i += 12) {
  const chunk = cells.slice(i, i + 12);
  const got = await inst.generatePhrasings({ brand, category: ctx.profile.category, competitors, audience: ctx.profile.audience, base: ctx.base, scenarios: ctx.scenarios, cells: chunk, count: 10, avoidConcerns, rosterRoles: ctx.rosterRoles });
  phr.push(...(Array.isArray(got) ? got : chunk.map(() => [])));
  console.log(`${brand}: ${Math.min(i + 12, cells.length)}/${cells.length}`);
}
fs.mkdirSync(process.env.OUT!, { recursive: true });
fs.writeFileSync(path.join(process.env.OUT!, `para_${slug}.json`), JSON.stringify({ brand, cells: cells.map((c: { stage: string; situation: string | null; angle: string; text: string }) => ({ stage: c.stage, situation: c.situation, angle: c.angle, text: c.text })), phrasings: phr }, null, 1));
process.exit(0);
