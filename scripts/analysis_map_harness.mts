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
import type { AnalysisMapView, Position } from "../src/lib/engine/analysis_types";
import type { DossierTheme } from "../src/lib/engine/reason_themes";
import type { Dossier } from "../src/lib/engine/dossiers";
import type { ViewData } from "../src/lib/engine/view_data";
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
process.env.RUN_COLLECT_ONLY = "1";

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { loadViewData } = await import(process.cwd() + "/src/lib/engine/view_data.ts");
const { computeAnalysisMap } = await import(process.cwd() + "/src/lib/engine/analysis_map.ts");
const { computeBrandSummary } = await import(process.cwd() + "/src/lib/engine/brand_summary.ts");
const { insightInputs, rankedInsights } = await import(process.cwd() + "/src/lib/engine/summary_insights.ts");
const { computeBrief } = await import(process.cwd() + "/src/lib/engine/brief.ts");
const { computeDossiers } = await import(process.cwd() + "/src/lib/engine/dossiers.ts");

/* am15 (2026-11-10): the plain-wording pass. Template text on the customer
 * surfaces (the map, the summary's insights and the composed brief) never
 * uses these words; data quoted from answers and the codebook is subtracted
 * first (it is the buyers' and the customer's own wording). */
const BANNED: [string, RegExp][] = [
  ["wall", /\bwalls?\b/i],
  ["routes", /\brout(e|es|ed|ing)\b/i],
  ["leavers", /\bleavers?\b/i],
  ["reason", /\breasons?\b/i],
  ["travels with", /\btravels? with\b/i],
  ["closest contest", /\bclosest contest\b/i],
];
/* am17: a finding card's bar labels - no method vocabulary, no counts. */
const VIZ_BANNED: [string, RegExp][] = [
  ...BANNED,
  ["open-choice", /\bopen[- ]choice\b/i],
  ["cell", /\bcells?\b/i],
  ["decided", /\bdecided\b/i],
  ["lift", /\blifts?\b/i],
  ["count", /\b\d+ of \d+\b/],
];
const phraseMemo = new Map<unknown, string[]>();
function phrasesFor(data: ViewData): string[] {
  const hit = phraseMemo.get(data);
  if (hit) return hit;
  const out = new Set<string>();
  const add = (x: unknown) => { if (typeof x === "string" && x.trim().length >= 3) out.add(x.trim().toLowerCase()); };
  for (const it of data.intents) { add(it.concern); add(it.situation); add(it.angle); }
  for (const e of data.dictionary) { add(e.canonical); add(e.display_name); }
  for (const c of data.codes) { for (const x of c.reasons ?? []) add(x); for (const r of c.decision_rules ?? []) add(r.condition.trim()); }
  const list = [...out].sort((a, b) => b.length - a.length);
  phraseMemo.set(data, list);
  return list;
}
/** A bar label with its quoted data (rooms, worries, brands, conditions - whole or truncated with "...") removed. */
function vizLabelTemplate(label: string, phrases: string[]): string {
  let x = label.toLowerCase();
  const stem = x.replace(/\.\.\.$/, "").trim();
  for (const d of phrases) {
    if (x.includes(d)) x = x.split(d).join(" ");
    else if (stem.length >= 8 && d.startsWith(stem)) x = x.replace(stem, " ");
    else {
      // "Your picks from <room...>": the data is the label's tail.
      const i = stem.length >= 8 ? [...Array(stem.length).keys()].find((k) => k > 0 && stem[k - 1] === " " && stem.length - k >= 8 && d.startsWith(stem.slice(k))) : undefined;
      if (i !== undefined) x = x.replace(stem.slice(i), " ");
    }
  }
  return x;
}
/** Keys whose values are data or plumbing, never template text. */
const SKIP_KEYS = new Set(["responseId", "find", "quote", "cellId", "id", "key", "cell", "cells", "anchors", "at", "subject", "subjects"]);
function bannedIn(root: unknown, data: string[], where: string, out: string[]) {
  const strip = (t: string) => {
    let x = t.replace(/"[^"]*"/g, '""').replace(/“[^”]*”/g, "");
    for (const d of data) if (d.length >= 3 && x.includes(d)) x = x.split(d).join(" ");
    return x;
  };
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      const t = strip(v);
      for (const [name, re] of BANNED) if (re.test(t)) out.push(`${where}${path}: "${name}" in ${JSON.stringify(v.slice(0, 160))}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) walk(x, `${path}.${k}`);
  };
  walk(root, "");
}
/** Every data string a view may quote: condition / theme / code labels, answers' wordings, brands, the setup's own words. */
function dataPhrases(view: AnalysisMapView, data: ViewData): string[] {
  const out = new Set<string>();
  const add = (s: unknown) => { if (typeof s === "string" && s.trim().length >= 3) out.add(s.trim()); };
  const theme = (t: DossierTheme) => { add(t.label); for (const b of t.buckets ?? []) { add(b.label); add(b.scenario); for (const m of b.members ?? []) add(m.label); } };
  for (const p of Object.values(view.positions)) {
    for (const c of [...p.toward, ...p.away]) add(c.text);
    for (const t of [...(p.towardThemes ?? []), ...(p.awayThemes ?? [])]) theme(t);
    for (const l of p.lifts) add(l.label);
    for (const r of p.argsRows ?? []) add(r.label);
    add(p.notes?.wall);
  }
  for (const it of data.intents) { add(it.text); add(it.concern); add(it.situation); add(it.angle); }
  for (const e of data.dictionary) { add(e.canonical); add(e.display_name); for (const a of e.aliases ?? []) add(a); }
  for (const c of data.codes) { for (const x of c.reasons ?? []) add(x); for (const x of c.topics ?? []) add(x); for (const r of c.decision_rules ?? []) add(r.condition.trim()); }
  return [...out].sort((a, b) => b.length - a.length);
}

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
    /* am17: the finding card's small chart. */
    if (t.viz) {
      const v = t.viz;
      if (v.length < 2 || v.length > 4) failures.push(`${project.brand}: tension "${t.title}" viz has ${v.length} rows`);
      if (v.filter((r) => r.hi).length > 1) failures.push(`${project.brand}: tension "${t.title}" viz has more than one hi`);
      for (const r of v) {
        if (!(r.value >= 0 && r.value <= 100)) failures.push(`${project.brand}: tension "${t.title}" viz value ${r.value} outside 0-100`);
        const plain = /^<?\d+(\.\d)?%$/.test(r.text);
        if (!plain && !t.title.includes(r.text) && !t.body.includes(r.text)) failures.push(`${project.brand}: tension "${t.title}" viz text ${r.text} is neither in the sentence nor a percentage`);
        if (!r.label.trim()) failures.push(`${project.brand}: tension "${t.title}" viz row with an empty label`);
        const lab = vizLabelTemplate(r.label, phrasesFor(data));
        for (const [name, re] of VIZ_BANNED) if (re.test(lab)) failures.push(`${project.brand}: tension "${t.title}" viz label "${r.label}" uses "${name}"`);
      }
      for (const r of v) console.log(`      ${r.hi ? ">" : " "} ${r.label.padEnd(46)} ${String(r.value).padStart(5)}  ${r.text}`);
    } else console.log(`      (no viz)`);
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

  /* -- am15: the one-panel fields -- */
  const valid = new Set(data.codes.map((c: { response_id: string }) => c.response_id));
  const realRef = (r: { responseId: string; find?: string }, at: string) => {
    if (!ids.has(r.responseId) || !valid.has(r.responseId)) failures.push(`${project.brand}: ${at} receipt ${r.responseId} is not a coded answer of the run`);
    if (r.find !== undefined && !r.find.trim()) failures.push(`${project.brand}: ${at} receipt with an empty find`);
  };
  let withBrands = 0, refs = 0;
  for (const [id, p] of Object.entries(view.positions as Record<string, Position>)) {
    if (p.brands) {
      withBrands++;
      const fig = (p.figures ?? []).find((f: { label: string }) => f.label.startsWith("Share of the picks here, by brand"));
      if (fig) {
        const want = new Map<string, string>((fig.value as string).split(" · ").map((x: string) => { const m = /^(.+) (\S+%)$/.exec(x.trim()); return [m?.[1] ?? x, m?.[2] ?? ""]; }));
        for (const b of p.brands) if (want.get(b.name) !== b.share) failures.push(`${project.brand}: ${id} brands ${b.name} ${b.share} != figure ${want.get(b.name)}`);
        if (want.get(project.brand) !== undefined && want.get(project.brand) !== p.youShare) failures.push(`${project.brand}: ${id} youShare ${p.youShare} != figure ${want.get(project.brand)}`);
      }
      if (p.brands.length > 5) failures.push(`${project.brand}: ${id} lists ${p.brands.length} brands`);
      for (const b of p.brands) for (const r of b.proof) { realRef(r, `${id} brands`); refs++; if (!r.quote) failures.push(`${project.brand}: ${id} brand proof without a quote`); }
      if (p.youShare === undefined) failures.push(`${project.brand}: ${id} brands without youShare`);
    }
    if (p.argsMode && p.argsMode !== "compare" && !(p.argsRows ?? []).length) failures.push(`${project.brand}: ${id} argsMode ${p.argsMode} without argsRows`);
    if (p.argsMode === "compare" && (!p.lifts.length || p.argsRows)) failures.push(`${project.brand}: ${id} compare mode must carry lifts and no argsRows`);
    if (p.lifts.length && p.argsMode !== "compare") failures.push(`${project.brand}: ${id} has lifts but argsMode ${p.argsMode}`);
    for (const r of p.argsRows ?? []) for (const x of r.receipts) { realRef(x, `${id} argsRows`); refs++; }
    for (const l of p.lifts) for (const x of l.receipts ?? []) { realRef(x, `${id} lifts`); refs++; }
    for (const c of [...p.toward, ...p.away]) for (const x of c.receipts ?? []) { realRef(x, `${id} conditions`); refs++; }
    for (const c of p.toward) if (c.routes) failures.push(`${project.brand}: ${id} toward condition carries routes`);
    for (const t of [...(p.towardThemes ?? []), ...(p.awayThemes ?? [])]) for (const x of t.receipts ?? []) { realRef(x, `${id} themes`); refs++; }
    if (p.notes?.wall && !p.away.some((c: { text: string; wall?: boolean }) => c.wall && c.text === p.notes.wall)) failures.push(`${project.brand}: ${id} notes.wall is not its flat wall item`);
  }
  const dossiers = await computeDossiers(data, {});
  for (const d of dossiers.dossiers as Dossier[]) {
    for (const a of d.argsAll) for (const x of a.receipts ?? []) { realRef(x, `dossier ${d.name} args`); refs++; }
    for (const t of [...d.routesThemes, ...d.routesBackThemes]) for (const x of t.receipts ?? []) { realRef(x, `dossier ${d.name} themes`); refs++; }
    for (const r of d.rooms ?? []) {
      const p = view.positions[r.cellId];
      const b = p?.brands?.find((x: { name: string }) => x.name === d.name);
      if (!b || b.share !== r.them || p.youShare !== r.you) failures.push(`${project.brand}: dossier ${d.name} room ${r.cellId} ${r.them}/${r.you} != the position's split`);
    }
  }
  console.log(`\nONE-PANEL FIELDS: ${withBrands} positions with brands, ${refs} answer refs checked`);

  /* -- am15: the plain-wording pass -- */
  const summaryFull = await computeBrandSummary(data, {});
  const brief = await computeBrief(data, {});
  const phrases = dataPhrases(view, data);
  const banned: string[] = [];
  const mapText = { casting: view.casting, tensions: view.tensions, bands: view.bands, positions: Object.fromEntries(Object.entries(view.positions as Record<string, Position>).map(([k, p]) => [k, { ...p, toward: undefined, away: undefined, towardThemes: undefined, awayThemes: undefined, notes: undefined }])) };
  bannedIn(mapText, phrases, "map", banned);
  bannedIn({ insights: summaryFull.insights, verdict: summaryFull.verdict }, phrases, "summary", banned);
  bannedIn(brief, phrases, "brief", banned);
  for (const b of banned) failures.push(`${project.brand}: banned word - ${b}`);
  console.log(`PLAIN WORDING: ${banned.length} banned-word hits`);

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
