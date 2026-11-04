/**
 * Zero-spend validation harness for the analysis map (analysis_map.ts).
 *
 *   npx tsx scripts/analysis_map_harness.mts [brand substring]
 *
 * Runs against the dashboard fixture ONLY: DATABASE_URL is blanked, SQLITE_PATH
 * points at data/dashboard_fixture.db and every API key is blanked BEFORE the
 * store loads (the procerno-fixture launch config), so no model call and no
 * prod read is possible. Keyless condition grouping falls back to the
 * deterministic stem keys.
 *
 * Prints per tracker: the casting (archetype + facts), every band / row /
 * cell, the tensions, and the wall calibration table; then checks the
 * invariants (no empty cells, a position per cell, receipts are real response
 * ids of the run, unique ids) and the archetype ground truth.
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
process.env.RUN_COLLECT_ONLY = "1";

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { loadViewData } = await import(process.cwd() + "/src/lib/engine/view_data.ts");
const { computeAnalysisMap } = await import(process.cwd() + "/src/lib/engine/analysis_map.ts");
const { computeBrandSummary } = await import(process.cwd() + "/src/lib/engine/brand_summary.ts");
const { insightInputs, rankedInsights } = await import(process.cwd() + "/src/lib/engine/summary_insights.ts");

// bs8 detectors: every one that fires (ranked, uncapped) must place onto its own map cell.
const BS8_KEYS = new Set(["neutralized_differentiator", "conversion_vs_rival", "leak_picks", "leak_problem", "worst_worry", "leave_no_exit"]);

const EXPECTED: Record<string, string> = {
  "american express": "specialist",
  jira: "reference",
  "google pixel": "challenger",
  netflix: "default",
  doritos: "companion",
};

const want = (process.argv[2] ?? "").toLowerCase();
const projects = (await store.listProjects()).filter((p: { brand: string; archived_at?: string | null }) => !p.archived_at && p.brand.toLowerCase().includes(want));
const failures: string[] = [];
const wallTable: string[] = [];

for (const project of projects) {
  const runs = await store.listRuns(project.id);
  const run = runs[0];
  if (!run) continue;
  const data = await loadViewData(run, project, { setupDecision: true, judge: true });
  if (!data) continue;
  const debug = { walls: [], casting: {} } as unknown as Parameters<typeof computeAnalysisMap>[2] & object;
  {
    // rankedInsights reads the summary without its own insights / verdict.
    const summary = await computeBrandSummary(data, {});
    const ranked = rankedInsights(summary, await insightInputs(data, {}));
    (debug as { probeInsights?: unknown }).probeInsights = ranked.filter((i: { key: string }) => BS8_KEYS.has(i.key));
  }
  const view = await computeAnalysisMap(data, {}, debug);
  const ids = new Set(data.responses.map((r: { id: string }) => r.id));

  console.log(`\n=================== ${project.brand} ===================`);
  console.log(`ARCHETYPE: ${view.casting.archetype} - ${view.casting.heading}`);
  console.log(`  ${view.casting.casting}`);
  console.log(`  ${view.casting.detail}`);
  console.log(`  facts: ${JSON.stringify(debug!.casting, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v))}`);
  console.log(`DOTS: named ${view.dots.named.k}/${view.dots.named.n}  picked ${view.dots.picked.k}/${view.dots.picked.n}`);
  console.log(`SHARE OF DECIDED: ${view.shareOfDecided.map((s: { brand: string; share: { k: number; n: number } }) => `${s.brand} ${Math.round((s.share.k / Math.max(1, s.share.n)) * 100)}%`).join(", ")}`);
  console.log(`UNCODED: ${view.uncoded}`);

  const seen = new Set<string>();
  const tally: Record<string, number> = { yours: 0, contested: 0, theirs: 0, nocall: 0 };
  for (const band of view.bands) {
    console.log(`\n# ${band.title}`);
    for (const row of band.rows) {
      console.log(`  ${row.stage}`);
      if (row.cells.length === 0) failures.push(`${project.brand}: empty row ${row.stage}`);
      for (const c of row.cells) {
        tally[c.verdict]++;
        if (seen.has(c.id)) failures.push(`${project.brand}: duplicate id ${c.id}`);
        seen.add(c.id);
        if (c.n === 0) failures.push(`${project.brand}: empty cell ${c.id}`);
        const p = view.positions[c.id];
        if (!p) failures.push(`${project.brand}: no position for ${c.id}`);
        else for (const r of p.receipts) if (!ids.has(r.responseId)) failures.push(`${project.brand}: receipt ${r.responseId} not in run (${c.id})`);
        const badges = c.badges.length ? ` [${c.badges.join(",")}]` : "";
        console.log(`    ${c.verdict.padEnd(9)} ${(c.wide ? "(wide)" : c.label).padEnd(40)} n=${String(c.n).padEnd(4)} ${c.note}${badges}`);
        if (p)
          console.log(
            `              -> ${p.status}/${p.triageSuggested} | taker: ${p.taker} (${p.takerKind}) | lifts ${p.lifts.length} toward ${p.toward.length} away ${p.away.length} receipts ${p.receipts.length} | ${p.claim}`
          );
      }
    }
  }
  // One full position, the anatomy check: the first open-choice cell (else the first cell).
  const showId = [...seen].find((id) => id.startsWith("chooses:open:")) ?? [...seen][0];
  if (showId) {
    const p = view.positions[showId];
    console.log(`\nPOSITION ${showId}\n  where: ${p.where}\n  claim: ${p.claim}\n  taker: ${p.taker} (${p.takerKind}) | status ${p.status} | triage ${p.triageSuggested}\n  why: ${p.triageWhy}`);
    console.log(`  lifts: ${p.lifts.map((l: { label: string; value: number }) => `${l.label} ${l.value > 0 ? "+" : ""}${l.value}`).join("; ")}`);
    console.log(`  toward: ${p.toward.map((c: { text: string; n: number }) => `${c.text} (~${c.n})`).join("; ")}`);
    console.log(`  away: ${p.away.map((c: { text: string; n: number; wall?: boolean }) => `${c.text} (~${c.n})${c.wall ? " WALL" : ""}`).join("; ")}`);
    console.log(`  receipts: ${p.receipts.map((r: { responseId: string; quote?: string }) => `${r.responseId.slice(0, 8)}${r.quote ? ` "${r.quote.slice(0, 70)}"` : ""}`).join(" | ")}`);
    console.log(`  lever: ${p.lever} [${p.family}]`);
  }
  if (Object.keys(view.positions).length !== seen.size) failures.push(`${project.brand}: positions ${Object.keys(view.positions).length} != cells ${seen.size}`);
  console.log(`\nVERDICTS: ${JSON.stringify(tally)}`);

  console.log(`\nTENSIONS:`);
  for (const t of view.tensions) {
    if (!seen.has(t.cellId)) failures.push(`${project.brand}: tension points at unknown cell ${t.cellId}`);
    console.log(`  * ${t.title}  [-> ${t.cellId}]\n    ${t.body}`);
  }
  if (view.tensions.length < 3 || view.tensions.length > 5) failures.push(`${project.brand}: ${view.tensions.length} tensions`);

  console.log(`\nBS8 PLACEMENTS:`);
  for (const pl of (debug as { placements?: { key: string; kind: string; cellId: string | null; how: string }[] }).placements ?? []) {
    console.log(`  ${pl.key.padEnd(28)} ${pl.kind.padEnd(9)} -> ${pl.cellId} (${pl.how})`);
    if (pl.how !== "match") failures.push(`${project.brand}: ${pl.key} fell back to a generic cell (${pl.cellId})`);
    if (!pl.cellId || !seen.has(pl.cellId)) failures.push(`${project.brand}: ${pl.key} places on an unknown cell ${pl.cellId}`);
  }

  for (const w of debug!.walls as { cellId: string; label: string; n: number; rank: number; wall: boolean; samples: string[] }[])
    wallTable.push(`${project.brand.padEnd(17)} | ${w.wall ? "WALL" : "    "} | #${w.rank} n=${String(w.n).padEnd(4)} | ${w.cellId.padEnd(48)} | ${w.label}${w.samples.length > 1 ? `  {${w.samples.slice(1).join(" / ")}}` : ""}`);

  // The Panel lens: a narrowed engine set still yields a map with no empty
  // cells, and no cell counts more answers than on the whole panel.
  const subset = [...new Set(data.responses.map((r: { model: string | null }) => r.model ?? run.model))].sort().slice(0, 4) as string[];
  const narrow = await computeAnalysisMap(data, { engines: subset });
  const fullN = new Map<string, number>();
  for (const b of view.bands) for (const r of b.rows) for (const c of r.cells) fullN.set(c.id, c.n);
  let narrowCells = 0;
  for (const b of narrow.bands)
    for (const r of b.rows)
      for (const c of r.cells) {
        narrowCells++;
        if (c.n === 0) failures.push(`${project.brand}: empty cell under engine subset ${c.id}`);
        if (c.n > (fullN.get(c.id) ?? Infinity)) failures.push(`${project.brand}: ${c.id} counts more answers on a narrower panel`);
        if (!narrow.positions[c.id]) failures.push(`${project.brand}: no position under engine subset ${c.id}`);
      }
  console.log(`\nENGINE SUBSET (${subset.length} engines): ${narrowCells} cells, archetype ${narrow.casting.archetype}`);

  const exp = EXPECTED[project.brand.toLowerCase()];
  if (exp && exp !== view.casting.archetype) failures.push(`${project.brand}: archetype ${view.casting.archetype}, expected ${exp}`);
}

console.log(`\n=================== WALL CALIBRATION (top-3 away groups per cell, n >= 5) ===================`);
for (const l of wallTable) console.log(l);

console.log(`\n=================== INVARIANTS ===================`);
if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exitCode = 1;
} else console.log("ALL PASS");
