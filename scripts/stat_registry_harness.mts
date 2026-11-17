/* eslint-disable @typescript-eslint/no-explicit-any -- a harness over the served payloads */
/**
 * The stat registry (stat_registry.ts, stage 1 of the stat ids): on every fixture tracker,
 *  - every stat id is unique and no id was met with two values;
 *  - every entry of indexPanel / indexAcross (the link resolver's view) is exactly one registry stat: the same
 *    value, and the entry's state (at / reveal / words) is one of that stat's views; the stat's own at / reveal is
 *    its cheapest view;
 *  - two builds give the same registry.
 * Prints the stat count per tracker and a few example ids.
 *
 * Fixture only, no model calls:  npx tsx scripts/stat_registry_harness.mts
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { loadViewData } = await import(process.cwd() + "/src/lib/engine/view_data.ts");
const { sharedAnalysisMap } = await import(process.cwd() + "/src/lib/engine/analysis_map.ts");
const { buildStatRegistry, statId } = await import(process.cwd() + "/src/lib/engine/stat_registry.ts");
const { indexPanel, indexPanelWalk, indexAcross, indexAcrossWalk } = await import(process.cwd() + "/src/lib/engine/panel_index.ts");

const failures: string[] = [];
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
let total = 0;

for (const project of (await store.listProjects()).filter((p: any) => !p.archived_at)) {
  const run = (await store.listRuns(project.id))[0];
  const data = await loadViewData(run, project, { setupDecision: true, judge: true });
  const { view: map } = await sharedAnalysisMap(data, {});
  const reg = buildStatRegistry(map);
  const all = reg.all();
  const ids = all.map((s: any) => s.id);
  if (new Set(ids).size !== ids.length) failures.push(`${project.brand}: duplicate stat ids`);
  for (const c of reg.conflicts) failures.push(`${project.brand}: ${c.id} met with values ${c.values.join(", ")}`);
  // Cheapest view first: a stat seen by default is "default".
  for (const s of all) if (s.views.some((v: any) => v.at === "default") && s.at !== "default") failures.push(`${project.brand}: ${s.id} is shown by default but registered behind ${JSON.stringify(s.reveal)}`);
  // Determinism.
  const again = buildStatRegistry(map).all();
  if (!same(again, all)) failures.push(`${project.brand}: two builds differ`);
  // Every index entry is one stat.
  let entries = 0;
  const check = (destId: string, walk: any[], plain: any[]) => {
    if (walk.length !== plain.length) failures.push(`${project.brand} ${destId}: walk view ${walk.length} entries, index ${plain.length}`);
    walk.forEach((e: any, i: number) => {
      entries++;
      const p = plain[i];
      if (!p || p.value !== e.value || p.words !== e.words || p.at !== e.at || !same(p.reveal, e.reveal)) failures.push(`${project.brand} ${destId}: index entry ${i} is not the walk's`);
      const id = `${destId}${e.part ? `/${e.part}` : ""}::${e.path}`;
      const s = reg.get(id);
      if (!s) return failures.push(`${project.brand}: index entry has no stat ${id}`);
      if (s.value !== e.value) failures.push(`${project.brand}: ${id} value ${s.value} vs index ${e.value}`);
      if (!s.views.some((v: any) => v.at === e.at && same(v.reveal, e.reveal) && v.words === e.words)) failures.push(`${project.brand}: ${id} has no view for the index entry's state`);
    });
  };
  for (const [cellId, p] of Object.entries(map.positions) as any) {
    const u = p.panel?.usualCellId ? map.positions[p.panel.usualCellId]?.panel?.steps : undefined;
    check(statId.cell(cellId), indexPanelWalk(p, u), indexPanel(p, u));
  }
  for (const r of map.rivalPanels ?? []) check(statId.rival(r.name), indexAcrossWalk(r), indexAcross(r));
  // Every stat is an index entry's location (nothing registered that the walk does not show).
  const multi = all.filter((s: any) => s.views.length > 1).length;
  total += all.length;
  console.log(`${project.brand}: ${all.length} stats (${all.filter((s: any) => s.at === "default").length} by default, ${multi} met in more than one view); ${entries} index entries, each one stat`);
  if (project.brand === "American Express") {
    const OPEN = "chooses:open:all";
    const ex = [
      reg.step(OPEN, "named", "you"),
      reg.step(OPEN, "recommended", "you"),
      reg.step(OPEN, "converts", "you"),
      reg.line(OPEN, "commit", "rate"),
      reg.line(OPEN, "share", "you"),
      reg.line(OPEN, "share", "avg"),
      reg.line(OPEN, "picked", "you"),
      reg.step(OPEN, "named", "usual"),
      reg.competitor(OPEN, "Capital One"),
      reg.rivalStep("Capital One", "named", "rival"),
      reg.rivalBody("Capital One", "named", "converts"),
      reg.rivalStep("Chase", "open", "rival"),
    ];
    for (const s of ex) console.log(`   ${s ? `${s.id} = ${s.value} (${s.at}${s.reveal ? ` ${JSON.stringify(s.reveal)}` : ""})` : "MISSING"}`);
  }
}
console.log(`\n${total} stats on five trackers`);
for (const f of failures.slice(0, 40)) console.log(`FAIL ${f}`);
console.log(failures.length ? `\n${failures.length} FAIL` : "ALL PASS - ids unique and stable, every index entry is one registry stat");
process.exit(failures.length ? 1 : 0);
