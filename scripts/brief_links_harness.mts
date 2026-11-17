/* eslint-disable @typescript-eslint/no-explicit-any -- a harness over the served payloads */
/**
 * The Brief's number links (bf33): every linked number in every frame (own subject, every fixture tracker)
 * opens a card whose index (panel_index.ts) shows that number beside its subject - by default, or with exactly
 * the reveal the link carries - or is an explicit fallback to the Brief's own answer card. Unlinked numbers
 * (scoreboard competitor columns, the visibility table, chart labels, rows with no card) must exist on some card
 * or By rival card. Prints the fallback list by kind and the unlinked figures with no home.
 *
 * Fixture only, no model calls:  npx tsx scripts/brief_links_harness.mts
 */
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { loadViewData } = await import(process.cwd() + "/src/lib/engine/view_data.ts");
const { computeBrief } = await import(process.cwd() + "/src/lib/engine/brief.ts");
const { sharedAnalysisMap } = await import(process.cwd() + "/src/lib/engine/analysis_map.ts");
const { sharedBrandSummary } = await import(process.cwd() + "/src/lib/engine/brand_summary.ts");
const { linkResolver, numberContext } = await import(process.cwd() + "/src/lib/engine/brief_links.ts");

const NUMBER_TOKEN = /\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g;

function kindOf(s: string, row?: string): string {
  if (row) return row;
  if (/assistants (carry|pick|supply)|supply .* of (its|their) picks/i.test(s)) return "AI-company concentration";
  if (/argued in|argues .* in|comes up in .* answers that pick|bring up|comes up more|shows up when/i.test(s)) return "argument share by who is picked";
  if (/Buyers who say|sends? buyers away|that say when to choose|sent away/i.test(s)) return "condition shares";
  if (/worth (it|paying)|cheaper option|doubt(s)? (it|the price)/i.test(s)) return "value verdict shares";
  if (/worr|told to (stay|leave|go ahead)|agrees .* fair/i.test(s)) return "worry verdicts";
  if (/switch|customers ask what|customers looking/i.test(s)) return "switching";
  if (/directly|compare|matchup|straight choice/i.test(s)) return "matchup records";
  if (/recommendations (end|into)|end with it as the pick|turns .* recommendations/i.test(s)) return "conversion";
  if (/buying situation|the buyer in/i.test(s) && /pick/.test(s)) return "share of picks by buying situation";
  if (/named|recommended|commits|settles|share of picks|of the picks|pick in|is the pick/i.test(s)) return "funnel / share of picks";
  return "other";
}

const failures: string[] = [];
const counts = { linked: 0, def: 0, one: 0, card: 0, unlinked: 0, unlinkedHome: 0 };
const fallbacks = new Map<string, string[]>();
const homeless: string[] = [];

for (const project of (await store.listProjects()).filter((p: any) => !p.archived_at)) {
  const run = (await store.listRuns(project.id))[0];
  const data = await loadViewData(run, project, { setupDecision: true, judge: true });
  const brief: any = await computeBrief(data, {});
  const { view: map } = await sharedAnalysisMap(data, {});
  const { view: summary, inputs } = await sharedBrandSummary(data, {});
  const terms = [
    ...summary.brands.filter((b: any) => b.key !== summary.target.key).map((b: any) => b.name),
    ...(summary.reasonLift ?? []).map((l: any) => l.code),
    ...(inputs.taught ?? []).map((t: any) => t.code),
    ...data.intents.flatMap((i: any) => [i.situation, i.concern]).filter(Boolean),
    ...(map.rivalPanels ?? []).map((r: any) => r.name),
  ];
  const R = linkResolver(map, terms, [...(summary.reasonLift ?? []).map((l: any) => l.code), ...(inputs.taught ?? []).map((t: any) => t.code)]);
  const allCells = Object.keys(map.positions);
  for (const [frame, memo] of Object.entries(brief.memos) as any[]) {
    for (const sec of memo.sections) {
      const units: { text: string; links?: any[]; row?: string; label?: string }[] = [];
      const rooms = new Set(data.intents.map((i: any) => (i.situation ?? "").trim().toLowerCase()).filter(Boolean));
      const ctxOf = (p: any) => (p.lead && rooms.has(p.lead.replace(/[.]$/, "").trim().toLowerCase()) ? p.lead.replace(/[.]$/, "") : "");
      for (const p of sec.paras ?? []) units.push({ text: `${p.lead ?? ""} ${p.text}`, links: p.links, label: ctxOf(p) });
      for (const q of sec.quads ?? []) for (const col of q.cells) for (const p of col) units.push({ text: `${p.lead ?? ""} ${p.text}`, links: p.links, label: ctxOf(p) });
      for (const r of sec.rows ?? []) {
        if (r.kind === "note") units.push({ text: r.label, row: "scoreboard note" });
        else {
          units.push({ text: r.value, links: r.links, row: "scoreboard / stages row", label: r.label });
          for (const x of [r.avg, r.top]) if (x) units.push({ text: x, row: "scoreboard competitor column", label: r.label });
        }
      }
      for (const r of sec.table?.rows ?? []) units.push({ text: r.slice(1).join(" | "), row: "visibility table", label: r[0] });
      if (sec.viz) for (const it of sec.viz.items) units.push({ text: `${it.value ?? ""} ${it.bValue ?? ""}`, row: "chart label", label: `${it.label}${it.who ? ` ${it.who}` : ""}` });
      for (const u of units) {
        const seen = new Map<string, number>();
        for (const m of u.text.matchAll(NUMBER_TOKEN)) {
          const token = m[0];
          const occ = seen.get(token) ?? 0;
          seen.set(token, occ + 1);
          const { local, sentence } = numberContext(R, u.text, m.index!, m.index! + token.length, u.label ?? "");
          const link = (u.links ?? []).find((l: any) => l.token === token && l.occurrence === occ);
          const kind = kindOf(sentence, u.row);
          const where = `${project.brand} [${frame}/${sec.key}]`;
          if (link) {
            counts.linked++;
            if (link.dest.kind === "card") {
              counts.card++;
              const list = fallbacks.get(kind) ?? [];
              list.push(`${where} ${token} in "${sentence.slice(0, 220)}"`);
              fallbacks.set(kind, list);
              continue;
            }
            const dest = link.dest.kind === "cell" ? { kind: "cell" as const, id: link.dest.id } : { kind: "rival" as const, id: link.dest.name };
            if (!R.shows(dest, token, local, sentence, link.reveal)) failures.push(`${where} ${token} -> ${dest.kind} ${dest.id}${link.reveal ? ` ${JSON.stringify(link.reveal)}` : ""} does not show it beside its subject: "${sentence.slice(0, 160)}"`);
            else if (link.reveal) counts.one++;
            else counts.def++;
          } else {
            counts.unlinked++;
            const found = R.find(token, local, sentence, { cells: allCells, rivals: [] }, "anywhere");
            if (found) counts.unlinkedHome++;
            else homeless.push(`${where} ${kind}: ${token} in "${sentence.slice(0, 200)}"`);
          }
        }
      }
    }
  }
}

console.log(`LINKED ${counts.linked}: on view where the link lands ${counts.def}, behind the one interaction the link opens ${counts.one}, Brief answer card (no home) ${counts.card}`);
console.log(`UNLINKED ${counts.unlinked}: on some card or By rival card ${counts.unlinkedHome}, nowhere ${homeless.length}`);
console.log("\nFALLBACKS TO THE BRIEF'S ANSWER CARD, by kind:");
for (const [k, xs] of [...fallbacks.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k}: ${xs.length}`);
  for (const x of xs) console.log(`    - ${x}`);
}
console.log(`\nUNLINKED FIGURES ON NO CARD: ${homeless.length}`);
for (const x of homeless) console.log(`  - ${x}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `\n${failures.length} FAIL` : "\nALL PASS - every linked number opens a card that shows it beside its subject, or the Brief's own card");
process.exit(failures.length ? 1 : 0);
