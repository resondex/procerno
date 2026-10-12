/**
 * Consolidation stability harness (2026-10-11). Draws a tracker's codebook
 * proposal N extra times from the SAME stored discovery phrases and reports,
 * per code in the prod proposal, how many draws reproduce it - so the gate
 * can confirm codes that are reproducible and chip the ones that are one
 * roll's luck. Why: discovery itself is a noisy sample per answer (grok 0.26,
 * luna 0.43 self-agreement) and consolidation is one Opus call at medium
 * effort; neither had ever been run twice on the same census.
 *
 *   npx tsx scripts/consolidation_stability.mts "<brand>" [draws=2] [--run]
 *
 * Prod is read through read-only transactions (phrases from
 * responses.discovery_codes, the prod proposal from projects.taxonomy_proposal
 * when it exists); nothing is written to prod. DATABASE_URL is removed before
 * the engine loads so the consolidation ledger rows land in a local store.
 * SPENDS ~$1 per draw (one Opus call + embeddings) - needs Tyler's go; without
 * --run it only reports what it would do. Output:
 * ~/Documents/procerno_eval/consolidation_stability/<slug>/draw_<k>.json,
 * stability.json, REPORT.md.
 *
 * Matching: a code in draw A matches a code in draw B when their member
 * phrase sets (the proposal's top-30 micros) overlap at Jaccard >= 0.4, taken
 * greedily by best overlap. Names are not used for matching (the same code is
 * named differently roll to roll).
 */
import postgres from "postgres"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
for (const l of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const brand = process.argv[2]; const draws = Number((process.argv[3] ?? "2").replace(/\D/g, "") || 2); const RUN = process.argv.includes("--run");
if (!brand) { console.error("usage: npx tsx scripts/consolidation_stability.mts \"<brand>\" [draws] [--run]"); process.exit(1); }
const DB = process.env.DATABASE_URL!; delete process.env.DATABASE_URL;
const sql = postgres(DB, { ssl: "require", max: 1 });
const ro = <T,>(f: (tx: any) => Promise<T>) => sql.begin("read only", f) as Promise<T>;
const project = (await ro((tx) => tx`select id, brand, category, taxonomy_proposal, taxonomy_status from projects where brand ilike ${brand} and archived_at is null order by created_at desc limit 1`) as any[])[0];
if (!project) { console.error(`no live project for ${brand}`); process.exit(1); }
const run = (await ro((tx) => tx`select id from runs where project_id = ${project.id} order by created_at desc limit 1`) as any[])[0];
const rows = await ro((tx) => tx`select id, discovery_codes from responses where run_id = ${run.id} and discovery_codes is not null`) as any[];
const total = (await ro((tx) => tx`select count(*)::int n from responses where run_id = ${run.id}`) as any[])[0].n;
await sql.end();
const slug = String(project.brand).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const OUT = `${process.env.HOME}/Documents/procerno_eval/consolidation_stability/${slug}`; fs.mkdirSync(OUT, { recursive: true });
const discoveryRows = rows.map((r: any) => ({ responseId: r.id, phrases: JSON.parse(r.discovery_codes) as string[] }));
console.log(`${project.brand}: ${rows.length}/${total} answers carry discovery phrases; prod proposal ${project.taxonomy_proposal ? "present" : "absent"} (taxonomy ${project.taxonomy_status})`);
if (rows.length < total) console.log(`NOTE: census incomplete (${total - rows.length} answers without phrases) - draws would use the partial census`);
if (!RUN) { console.log(`dry run: would draw ${draws} proposals (~$1 each) into ${OUT}`); process.exit(0); }
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "procerno-stab-")));
const { consolidateTaxonomy } = await import(`${REPO}/src/lib/engine/consolidate.ts`);
type Proposal = { codes: { code: string; rows: number; incidence: number; scope: string; why: string }[]; micros: Record<string, { p: string; n: number }[]>; overlaps?: { a: string; b: string; terms: string[] }[] };
const proposals: { name: string; p: Proposal }[] = [];
if (project.taxonomy_proposal) proposals.push({ name: "prod", p: JSON.parse(project.taxonomy_proposal) });
for (let k = 1; k <= draws; k++) {
  const t0 = Date.now();
  const p = (await consolidateTaxonomy(project.brand, discoveryRows, { category: project.category })) as Proposal;
  fs.writeFileSync(`${OUT}/draw_${k}.json`, JSON.stringify(p, null, 1));
  proposals.push({ name: `draw_${k}`, p });
  console.log(`draw ${k}: ${p.codes.length} codes, ${p.overlaps?.length ?? 0} overlapping pairs, ${Math.round((Date.now() - t0) / 1000)}s`);
}
const phr = (p: Proposal, code: string) => new Set((p.micros[code] ?? []).map((m) => m.p));
const jac = (a: Set<string>, b: Set<string>) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
function matchCodes(A: Proposal, B: Proposal): Map<string, { code: string; j: number }> {
  const pairs: { a: string; b: string; j: number }[] = [];
  for (const a of A.codes) for (const b of B.codes) { const j = jac(phr(A, a.code), phr(B, b.code)); if (j >= 0.4) pairs.push({ a: a.code, b: b.code, j }); }
  pairs.sort((x, y) => y.j - x.j); const usedA = new Set<string>(), usedB = new Set<string>(); const out = new Map<string, { code: string; j: number }>();
  for (const p of pairs) { if (usedA.has(p.a) || usedB.has(p.b)) continue; usedA.add(p.a); usedB.add(p.b); out.set(p.a, { code: p.b, j: p.j }); }
  return out;
}
const base = proposals[0]; const others = proposals.slice(1);
const perCode = base.p.codes.map((c) => {
  const hits = others.map((o) => { const m = matchCodes(base.p, o.p).get(c.code); const oc = m ? o.p.codes.find((x) => x.code === m.code)! : null; return { draw: o.name, code: m?.code ?? null, j: m?.j ?? 0, incidence: oc?.incidence ?? null }; });
  const found = hits.filter((h) => h.code).length;
  const incs = [c.incidence, ...hits.filter((h) => h.incidence !== null).map((h) => h.incidence!)];
  return { code: c.code, incidence: c.incidence, scope: c.scope, found, of: others.length, incidence_min: Math.min(...incs), incidence_max: Math.max(...incs), matches: hits };
});
const unmatchedInDraws = others.map((o) => { const m = matchCodes(base.p, o.p); const matched = new Set([...m.values()].map((v) => v.code)); return { draw: o.name, codes: o.p.codes.filter((c) => !matched.has(c.code)).map((c) => `${c.code} (${(100 * c.incidence).toFixed(1)}%)`) }; });
const stable = perCode.filter((c) => c.found === others.length).length, partial = perCode.filter((c) => c.found > 0 && c.found < others.length).length, unstable = perCode.filter((c) => c.found === 0).length;
const report = [
  `# Consolidation stability - ${project.brand} (${new Date().toISOString().slice(0, 10)})`,
  `Base: ${base.name} (${base.p.codes.length} codes). Compared against ${others.map((o) => `${o.name} (${o.p.codes.length})`).join(", ")}. Phrases from ${rows.length} answers. Match = member-phrase Jaccard >= 0.4, greedy best.`,
  `Stable in every draw: ${stable} | partial: ${partial} | in no other draw: ${unstable}`,
  ``, `| code | incidence | scope | reproduced | incidence range | matched as |`, `| --- | --- | --- | --- | --- | --- |`,
  ...perCode.sort((a, b) => a.found - b.found || b.incidence - a.incidence).map((c) => `| ${c.code} | ${(100 * c.incidence).toFixed(1)}% | ${c.scope} | ${c.found}/${c.of} | ${(100 * c.incidence_min).toFixed(1)}-${(100 * c.incidence_max).toFixed(1)}% | ${c.matches.map((m) => (m.code ? `${m.code} (${m.j.toFixed(2)})` : "-")).join("; ")} |`),
  ``, ...unmatchedInDraws.map((u) => `Codes in ${u.draw} with no counterpart in ${base.name}: ${u.codes.join("; ") || "none"}`),
  ``, `Overlapping definition pairs per proposal: ${proposals.map((p) => `${p.name} ${p.p.overlaps?.length ?? "n/a"}`).join(", ")}`,
].join("\n");
fs.writeFileSync(`${OUT}/stability.json`, JSON.stringify({ brand: project.brand, base: base.name, draws: others.map((o) => o.name), perCode, unmatchedInDraws }, null, 1));
fs.writeFileSync(`${OUT}/REPORT.md`, report); console.log(report);
process.exit(0);
