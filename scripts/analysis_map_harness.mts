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
const { computeAnalysisMap, slimAnalysisMap, cellPanelOf } = await import(process.cwd() + "/src/lib/engine/analysis_map.ts");
const { computeBrandSummary } = await import(process.cwd() + "/src/lib/engine/brand_summary.ts");
const { insightInputs, rankedInsights } = await import(process.cwd() + "/src/lib/engine/summary_insights.ts");
const { computeBrief } = await import(process.cwd() + "/src/lib/engine/brief.ts");
const { PLAIN_BANNED } = await import(process.cwd() + "/src/lib/engine/plain_words.ts");
const { computeDossiers } = await import(process.cwd() + "/src/lib/engine/dossiers.ts");
const { buildResolver } = await import(process.cwd() + "/src/lib/engine/brand_resolve.ts");
const { isAllowedTag, TAKEAWAY_TAGS, CLOSE_PTS } = await import(process.cwd() + "/src/lib/engine/panel_tags.ts");
const { knOf: knOfH } = await import(process.cwd() + "/src/lib/engine/panel_build.ts");
const { findingMove } = await import(process.cwd() + "/src/lib/engine/finding_moves.ts");
const { cell: wilsonCell } = await import(process.cwd() + "/src/lib/engine/view_data.ts");
/* am36: the verdict panels whose steps carry takeaways and whose explanation repeats no bar number. */
const VERDICT_KINDS = new Set(["value", "buyer_worry", "customer_worry", "looking_around", "expansion", "business_case", "critic", "alongside", "criteria", "habit"]);
const fsMod = await import("node:fs");
import type { PanelNum, PositionPanel, PanelStep, PanelConditions, AnswerRef, RivalAcross } from "../src/lib/engine/analysis_types";

/* am15 (2026-11-10): the plain-wording pass. Template text on the customer
 * surfaces (the map, the summary's insights and the composed brief) never
 * uses these words; data quoted from answers and the codebook is subtracted
 * first (it is the buyers' and the customer's own wording). */
const BANNED: [string, RegExp][] = PLAIN_BANNED;
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
const SKIP_KEYS = new Set(["responseId", "find", "to", "quote", "cellId", "id", "key", "cell", "cells", "anchors", "at", "subject", "subjects", "links"]); // bf33: a number's link (card ids, reveal keys) is never shown
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
const BS8_KEYS = new Set(["neutralized_differentiator", "conversion_vs_rival", "leak_picks", "leak_problem", "worst_worry", "leave_no_exit", "vendor_outlier", "assigned_exception", "unasked_rival", "away_condition", "argument_flip"]);

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
/* am31: the panel checks' cross-tracker inputs and outputs. PANEL_BASELINE
 * (optional) = a folder of am30 map dumps (<slug>.map.json, positions without
 * `panel`) - the "old output unchanged" check runs only when it is set. */
const omissionLines: string[] = [];
const payloadLines: string[] = [];
const mockupLines: string[] = [];
const categoryWords = new Map<string, string[]>(); // brand -> its category's words (4+ letters)
for (const pr of projects) categoryWords.set(pr.brand, (pr.category as string).toLowerCase().match(/[a-z]{4,}/g) ?? []);
const PANEL_BANNED: [string, RegExp][] = [...BANNED, ["contest", /\bcontests?\b/i], ["cell", /\bcells?\b/i], ["pooled", /\bpooled\b/i], ["long dash", /[—–]/]];

/* am35 F: no stacked bars. The panels' payload keeps its segments (each a
 * share of its own); the check is on the UI: no panel or dashboard renderer
 * draws one bar split into parts (several widths side by side in one track). */
{
  const dir = process.cwd() + "/src/app/projects/[id]/";
  for (const f of ["panel_parts.tsx", "panels_v2.tsx", "analysis_panel.tsx", "analysis_views.tsx", "company_board.tsx"]) {
    const src = fsMod.readFileSync(dir + f, "utf8");
    // A stacked bar = a flex track whose children are several sized <i> segments.
    const re = /className="[^"]*\bflex\b[^"]*overflow-hidden[^"]*"[^>]*>\s*(?:\{[^}]*\.map\([^)]*\)\s*=>\s*\(?\s*)?<i[^>]*width[^>]*\/>\s*(?:<i[^>]*width|\)\)\})/g;
    const hits = src.match(re) ?? [];
    for (const hit of hits) failures.push(`${f}: a stacked bar is still drawn: ${hit.slice(0, 120)}`);
  }
}

for (const project of projects) {
  const runs = await store.listRuns(project.id);
  const run = runs[0];
  if (!run) continue;
  const data = await loadViewData(run, project, { setupDecision: true, judge: true });
  // On a snapshot of live the run carries its live revision, so the saved condition groupings are read.
  if (data) data.revision = await (await import(process.cwd() + "/src/lib/engine/run_revision.ts")).cachedRunRevision(run.id);
  if (!data) continue;
  const debug = { walls: [], casting: {} } as unknown as Parameters<typeof computeAnalysisMap>[2] & object;
  {
    // rankedInsights reads the summary without its own insights / verdict.
    const summary = await computeBrandSummary(data, {});
    const ranked = rankedInsights(summary, await insightInputs(data, {}));
    (debug as { probeInsights?: unknown }).probeInsights = ranked.filter((i: { key: string }) => BS8_KEYS.has(i.key));
    // am62: every finding that fires (served or not) has a move written for it, and every bar says whose number it is.
    for (const i of ranked as { key: string; title: string; names?: object; viz?: { label: string; who?: string }[] }[]) {
      if (!findingMove(i.key, i.names as never)) failures.push(`${project.brand}: insight ${i.key} has no move written for it`);
      for (const r of i.viz ?? []) if (!r.who) failures.push(`${project.brand}: insight ${i.key} bar "${r.label}" does not say whose it is`);
    }
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
  /* am62: every finding carries its key and a move (family + sentence); no two findings show the same sentence
   * unless the later one is flagged as a repeat; every bar says whose number it is; the opening funnel
   * paragraph is identified by its key. */
  {
    const said = new Set<string>();
    if (view.tensions[0]?.key !== "known_vs_picked") failures.push(`${project.brand}: the first tension is not the known-vs-picked paragraph`);
    for (const t of view.tensions) {
      if (!t.key) failures.push(`${project.brand}: tension "${t.title}" has no key`);
      if (!t.move?.family?.trim() || !t.move?.text?.trim()) failures.push(`${project.brand}: tension "${t.title}" has no move`);
      else if (t.key !== "known_vs_picked") {
        if (said.has(t.move.text) && !t.move.repeat) failures.push(`${project.brand}: tension "${t.title}" repeats a move sentence without the repeat flag`);
        if (!said.has(t.move.text) && t.move.repeat) failures.push(`${project.brand}: tension "${t.title}" flagged as a repeat of nothing`);
        said.add(t.move.text);
        if (/\d+%|\b\d+ of \d+\b/.test(t.move.text)) failures.push(`${project.brand}: tension "${t.title}" move states a number`);
      }
      for (const r of t.viz ?? []) if (!r.who || !["you", "rival", "other"].includes(r.who)) failures.push(`${project.brand}: tension "${t.title}" bar "${r.label}" does not say whose it is`);
      console.log(`      move: ${t.move?.family} - ${t.move?.text}${t.move?.repeat ? " [repeat]" : ""}`);
    }
  }

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
  /* -- am19: the Overview's numbers open their answers -- */
  const ovRefs = (list: { responseId: string; find: string }[] | undefined, at: string) => {
    if ((list?.length ?? 0) > 5) failures.push(`${project.brand}: ${at} carries ${list!.length} examples`);
    if (new Set((list ?? []).map((x) => x.responseId)).size !== (list?.length ?? 0)) failures.push(`${project.brand}: ${at} repeats an answer`);
    for (const x of list ?? []) { realRef(x, at); refs++; }
  };
  if (view.dots.named.k > 0 && !view.examples?.named.length) failures.push(`${project.brand}: named has no examples`);
  ovRefs(view.examples?.named, "overview named");
  ovRefs(view.examples?.commits, "overview commits");
  for (const s of view.shareOfDecided) {
    if (s.share.k > 0 && !s.refs?.length) failures.push(`${project.brand}: board row ${s.brand} has no examples`);
    ovRefs(s.refs, `board ${s.brand}`);
  }
  for (const t of view.tensions) for (const b of t.viz ?? []) ovRefs(b.refs, `finding "${t.title}" bar ${b.label}`);
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
  const mapText = { casting: view.casting, tensions: view.tensions, bands: view.bands, positions: Object.fromEntries(Object.entries(view.positions as Record<string, Position>).map(([k, p]) => [k, { ...p, toward: undefined, away: undefined, towardThemes: undefined, awayThemes: undefined, notes: undefined, panel: undefined }])) };
  bannedIn(mapText, phrases, "map", banned);
  bannedIn({ insights: summaryFull.insights, verdict: summaryFull.verdict }, phrases, "summary", banned);
  bannedIn(brief, phrases, "brief", banned);
  for (const b of banned) failures.push(`${project.brand}: banned word - ${b}`);
  console.log(`PLAIN WORDING: ${banned.length} banned-word hits`);
  /* bf26 (the Brief's one voice): no composed Brief string - every frame, its answer cards, the tracker's own
   * subject and one rival subject - says "you" / "your" / "yours", and no running sentence says " 0% of "
   * (tables and figure rows excluded; counts in `tip` are never shown). */
  {
    const rivalName = (brief.subjects as string[]).find((x) => x !== brief.subject);
    const briefs = [brief, ...(rivalName ? [await computeBrief(data, { subject: rivalName })] : [])];
    let voiceChecked = 0;
    for (const b of briefs) {
      const walk = (v: unknown, path: string, inTable: boolean): void => {
        if (typeof v === "string") {
          voiceChecked++;
          if (/\b(you|your|yours)\b/i.test(v)) failures.push(`${project.brand}: brief [${b.subject}] ${path} speaks to "you": ${JSON.stringify(v.slice(0, 160))}`);
          if (!inTable && / 0% of /.test(v)) failures.push(`${project.brand}: brief [${b.subject}] ${path} says " 0% of ": ${JSON.stringify(v.slice(0, 160))}`);
          // bf29: every at the top too, and no points shorthand in any memo sentence (cards draw signed bars).
          if (!inTable && path.startsWith("memos") && / 100% of /.test(v)) failures.push(`${project.brand}: brief [${b.subject}] ${path} says " 100% of ": ${JSON.stringify(v.slice(0, 160))}`);
          if (!inTable && path.startsWith("memos") && /points\)|points more/.test(v)) failures.push(`${project.brand}: brief [${b.subject}] ${path} carries the points shorthand: ${JSON.stringify(v.slice(0, 160))}`);
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, inTable));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "tip" && k !== "id" && k !== "stat") walk(x, `${path}.${k}`, inTable || k === "table" || k === "rows");
      };
      walk(b.memos, "memos", false);
      walk(b.cards, "cards", false);
    }
    console.log(`BRIEF VOICE: ${voiceChecked} strings checked across ${briefs.length} subjects`);
    /* bf29: no sentence of 25+ characters appears in two frames of one memo set (facts are shared, sentences never). */
    let sentChecked = 0;
    for (const b of briefs) {
      const where = new Map<string, Set<string>>();
      for (const [frame, m] of Object.entries(b.memos as Record<string, { sections: { paras?: { text: string }[]; quads?: { cells: [{ text: string }[], { text: string }[]] }[] }[] }>)) {
        const texts: string[] = [];
        for (const s of m.sections) {
          for (const p of s.paras ?? []) texts.push(p.text);
          for (const q of s.quads ?? []) for (const col of q.cells) for (const p of col) texts.push(p.text);
        }
        for (const t of texts)
          for (const sent of t.split(/(?<=[.!?])\s+(?=[A-Z"])/)) {
            if (sent.trim().length < 25) continue;
            sentChecked++;
            const set = where.get(sent.trim()) ?? new Set<string>();
            set.add(frame);
            where.set(sent.trim(), set);
          }
      }
      for (const [sent, fs] of where) if (fs.size > 1) failures.push(`${project.brand}: brief [${b.subject}] repeats a sentence across frames ${[...fs].join(", ")}: ${JSON.stringify(sent.slice(0, 140))}`);
    }
    console.log(`BRIEF REPEATS: ${sentChecked} sentences checked across frames`);
    /* bf29: a move is never only a back-reference, and no two SWOT quadrant items state the same fact (lead + pin). */
    for (const b of briefs) {
      for (const [frame, m] of Object.entries(b.memos as Record<string, { sections: { paras?: { lead?: string; text: string }[]; quads?: { cells: [{ lead?: string; text: string; cells?: { id: string }[] }[], { lead?: string; text: string; cells?: { id: string }[] }[]] }[] }[] }>)) {
        for (const sct of m.sections) {
          const ps = [...(sct.paras ?? []), ...(sct.quads ?? []).flatMap((q) => [...q.cells[0], ...q.cells[1]])];
          for (const p of ps) if (/^(As above|Same first move|The same move)\b/.test(p.text.trim())) failures.push(`${project.brand}: brief [${b.subject}] ${frame} prints a back-reference move: ${JSON.stringify(p.text.slice(0, 100))}`);
          const seen = new Set<string>();
          for (const q of sct.quads ?? [])
            for (const p of [...q.cells[0], ...q.cells[1]]) {
              if (!p.lead) continue;
              const k = `${p.lead}|${p.cells?.[0]?.id ?? ""}|${p.text}`;
              if (seen.has(k)) failures.push(`${project.brand}: brief [${b.subject}] ${frame} repeats a quadrant item: ${JSON.stringify(p.text.slice(0, 100))}`);
              seen.add(k);
            }
        }
      }
    }
  }

  /* -- am31: the per-question-type panels -- */
  {
    const resolve = buildResolver(data.dictionary, data.judged);
    const targetKey = resolve(project.brand).key;
    const codeOf = new Map(data.codes.map((c: { response_id: string }) => [c.response_id, c]));
    type Code = { response_id: string; outcome: string | null; top_pick: string | null; mentions: { brand: string; framing: string }[] | null; decision_rules: { condition: string }[] | null; [k: string]: unknown };
    const cellIds = ((debug as { panelCells?: Record<string, string[]> }).panelCells ?? {}) as Record<string, string[]>;
    const keyOfName = (name: string) => (name === project.brand ? targetKey : resolve(name).key);
    const picks = (c: Code, key: string) => c.outcome === "pick" && !!c.top_pick && resolve(c.top_pick).key === key;
    const names = (c: Code, key: string) => (c.mentions ?? []).some((m) => resolve(m.brand).key === key) || picks(c, key);
    const recs = (c: Code, key: string) => (c.mentions ?? []).some((m) => m.framing === "recommended" && resolve(m.brand).key === key) || picks(c, key);
    const isNum = (v: unknown): v is PanelNum => !!v && typeof v === "object" && "value" in (v as object) && "pct" in (v as object) && "tip" in (v as object);
    let panels = 0, nums = 0, refCount = 0, labelFallbacks = 0;
    let detailCount = 0;
    let avgCount = 0;
    let repeatChecks = 0;
    let verdictChecked = 0;
    let am37Checks = 0;
    let am38Checks = 0;
    let planted = false; // PANEL_PLANT=1: one value explanation gets a bar number, to prove 6f bites
    const SEG_FIELD: Record<string, [string, (v: unknown) => boolean]> = {
      proceed: ["proceed_or_avoid", (v) => v === "proceed"], avoid: ["proceed_or_avoid", (v) => v === "avoid"],
      keep: ["keep_or_leave", (v) => v === "keep"], leave: ["keep_or_leave", (v) => v === "leave"],
      yes: ["worth_it", (v) => v === "yes"], no: ["worth_it", (v) => v === "no"], depends: ["worth_it", (v) => v !== "yes" && v !== "no"],
      backs: ["growth_stance", (v) => v === "backs"], redirects: ["growth_stance", (v) => v === "redirects"], neutral: ["growth_stance", (v) => v !== "backs" && v !== "redirects"],
      strong: ["case_strength", (v) => v === "strong"], hedged: ["case_strength", (v) => v !== "strong"],
      partial: ["case_strength", (v) => v === "partial" || v === "hedged"], concedes: ["case_strength", (v) => v === "concedes" || v === "undermined"],
      rebuts: ["premise_verdict", (v) => v === "rebuts"], mixed: ["premise_verdict", (v) => v === "mixed"], confirms: ["premise_verdict", (v) => v === "confirms"],
      // am59: Premium vs basic ("none" folds into balanced).
      premium: ["tier_stance", (v) => v === "premium"], basic: ["tier_stance", (v) => v === "basic"], balanced: ["tier_stance", (v) => v !== "premium" && v !== "basic"],
    };
    const phrases = [...dataPhrases(view, data)];
    for (const [id, pos] of Object.entries(view.positions as Record<string, Position>)) {
      const p = pos.panel as PositionPanel | undefined;
      // am59: every Premium vs basic cell now opens the new panel. am60: every Habit cell too. am61: and the settled
      // "All questions" cell - no cell keeps the old panel.
      if (id.startsWith("chooses:premium:") && p?.kind !== "premium") failures.push(`${project.brand}: ${id} keeps the old panel`);
      if (id.startsWith("doubts:repertoire:") && p?.kind !== "habit") failures.push(`${project.brand}: ${id} keeps the old panel`);
      if (!p) failures.push(`${project.brand}: ${id} keeps the old panel`);
      if (!p) continue;
      panels++;
      // The answers a panel may show: its own, its row's (the usual and the
      // rival's other buying situations), and on criteria the what-to-buy answers.
      const [band, rowSlug] = id.split(":");
      const ids = new Set<string>();
      for (const [cid, list] of Object.entries(cellIds))
        if (cid.startsWith(`${band}:${rowSlug}:`) || ((p.kind === "criteria" || p.kind === "popular" || p.kind === "premium") && cid === "chooses:open:all") || (p.kind === "learning" && cid === "chooses:awareness:all")) for (const x of list) ids.add(x);
      const own = new Set(cellIds[id] ?? []);
      if (!own.size) failures.push(`${project.brand}: ${id} panel has no recorded answers`);
      const checkRef = (r: AnswerRef, path: string) => {
        refCount++;
        if (!ids.has(r.responseId)) failures.push(`${project.brand}: ${id}${path} answer ${r.responseId} is not in the question's answers`);
        if (!r.find?.trim()) failures.push(`${project.brand}: ${id}${path} answer with an empty find`);
      };
      // 2. every clickable number has answers (and only answers of this question).
      const walkNums = (v: unknown, path: string): void => {
        if (isNum(v)) {
          nums++;
          const refs = v.refs ?? [];
          if (v.pct > 0 && refs.length === 0) failures.push(`${project.brand}: ${id}${path} ${v.value} has no answers`);
          if (v.pct === 0 && refs.length) failures.push(`${project.brand}: ${id}${path} 0% carries answers`);
          if (refs.length > 3) failures.push(`${project.brand}: ${id}${path} carries ${refs.length} answers`);
          for (const r of refs) checkRef(r, path);
          return;
        }
        if (Array.isArray(v)) {
          v.forEach((x, i) => walkNums(x, `${path}[${i}]`));
          return;
        }
        if (v && typeof v === "object") {
          for (const [k, x] of Object.entries(v)) {
            if (k === "refs" && Array.isArray(x)) for (const r of x as AnswerRef[]) checkRef(r, `${path}.refs`);
            else walkNums(x, `${path}.${k}`);
          }
        }
      };
      walkNums(p, "");
      // 3. every example answer shows its fact.
      const stepCheck = (s: PanelStep, at: string, youName: string) => {
        const check = (n: PanelNum | undefined, key: string, who: string) => {
          for (const r of n?.refs ?? []) {
            const c = codeOf.get(r.responseId) as Code | undefined;
            if (!c) { failures.push(`${project.brand}: ${at} ${s.key} answer not coded`); continue; }
            const ok =
              s.key === "named" ? names(c, key) :
              s.key === "recommended" && (p.kind === "buy" || p.kind === "switching" || p.kind === "problem" || p.kind === "popular" || p.kind === "premium" || at.includes("rival")) && !(at.includes("rival") && who !== youName && p.kind !== "buy" && p.kind !== "switching" && p.kind !== "problem" && p.kind !== "popular" && p.kind !== "premium") ? recs(c, key) :
              s.key === "commits" ? c.outcome === "pick" && !!c.top_pick && resolve(c.top_pick).status === "active" :
              s.key === "converts" ? picks(c, key) :
              s.key === "won" ? (who === youName ? picks(c, targetKey) : c.outcome === "pick" && !picks(c, targetKey)) :
              s.key === "decided" ? c.outcome === "pick" :
              true;
            if (!ok) failures.push(`${project.brand}: ${at} step ${s.key} (${who}) answer ${r.responseId.slice(0, 8)} does not show it`);
          }
        };
        check(s.here, targetKey, youName);
        if (s.usual && s.usualLabel === "Average competitor") {
          // am35: the listed competitors added up - each example answer shows the fact for one of them.
          const keys = (p.competitorOrder ?? []).map(keyOfName);
          for (const r of s.usual.refs ?? []) {
            const c = codeOf.get(r.responseId) as Code | undefined;
            const ok = !!c && keys.some((k) => (s.key === "named" ? names(c, k) : s.key === "recommended" ? recs(c, k) : s.key === "converts" ? picks(c, k) : true));
            if (!ok) failures.push(`${project.brand}: ${at} step ${s.key} average competitor answer ${r.responseId.slice(0, 8)} shows no competitor`);
          }
        } else if (s.usual) check(s.usual, targetKey, youName);
        for (const x of s.rivals ?? []) check(x.num, keyOfName(x.name), x.name);
        if (s.vs) check(s.vs.num, keyOfName(s.vs.name), s.vs.name);
        for (const g of s.segments ?? []) {
          const f = SEG_FIELD[g.key];
          if (!f) continue;
          for (const r of g.num.refs ?? []) {
            const c = codeOf.get(r.responseId) as Code | undefined;
            if (!c || !f[1](c[f[0]])) failures.push(`${project.brand}: ${at} segment ${g.key} answer ${r.responseId.slice(0, 8)} lacks the verdict`);
          }
        }
      };
      for (const s of p.steps) stepCheck(s, `${id} panel`, project.brand);
      for (const rv of p.rivals ?? []) for (const s of rv.steps) stepCheck(s, `${id} rival ${rv.name}`, project.brand);
      const condCheck = (c: PanelConditions | undefined, at: string) => {
        if (!c) return;
        const sideIds = { toward: new Set<string>(), away: new Set<string>() };
        for (const side of ["toward", "away"] as const)
          for (const row of c[side])
            for (const r of row.share.refs ?? []) {
              sideIds[side].add(r.responseId);
              const code = codeOf.get(r.responseId) as Code | undefined;
              if (!code?.decision_rules?.some((d) => d.condition.trim() === r.find.trim())) failures.push(`${project.brand}: ${at} ${side} "${row.text}" answer ${r.responseId.slice(0, 8)} states no such condition`);
            }
        for (const x of sideIds.toward) if (sideIds.away.has(x) && !c.towardScope) failures.push(`${project.brand}: ${at} answer ${x.slice(0, 8)} shown on both sides`);
      };
      condCheck(p.conditions, `${id} panel`);
      for (const rv of p.rivals ?? []) condCheck(rv.conditions, `${id} rival ${rv.name}`);
      // 6. tags.
      const tags = [...p.steps, ...(p.rivals ?? []).flatMap((r) => r.steps)].flatMap((s) => [s.tagUsual, s.tagRank]).filter((t): t is string => !!t);
      for (const t of tags) if (!isAllowedTag(t)) failures.push(`${project.brand}: ${id} tag "${t}" is not an allowed tag`);
      // 6b. every tag carries its sentiment; every rival panel its own labels.
      const TONES = new Set(["good", "bad", "neutral"]);
      for (const st of [...p.steps, ...(p.rivals ?? []).flatMap((r) => r.steps)]) {
        if (st.tagUsual && !TONES.has(st.tagUsualTone ?? "")) failures.push(`${project.brand}: ${id} tag "${st.tagUsual}" has no tone`);
        if (st.tagRank && !TONES.has(st.tagRankTone ?? "")) failures.push(`${project.brand}: ${id} tag "${st.tagRank}" has no tone`);
      }
      for (const rv of p.rivals ?? []) {
        if (!rv.stackLabel) failures.push(`${project.brand}: ${id} rival ${rv.name} has no stack label`);
        if (rv.byCell?.length && !rv.byCellTitle) failures.push(`${project.brand}: ${id} rival ${rv.name} byCell has no title`);
        for (const d of Object.values(rv.details ?? {})) if (d?.outcomes?.length && !d.outcomeLabels) failures.push(`${project.brand}: ${id} rival ${rv.name} outcomes have no labels`);
      }
      // 6c. am34: the step details - only on the funnel kinds, only for steps the panel draws,
      // every stated number in a sentence opens its answers, outcomes carry their words, rows their columns.
      for (const [view, ds] of [["details", p.details], ["detailsComp", p.detailsComp]] as const) {
        if (!ds) continue;
        if (!["buy", "switching", "problem", "popular", "premium", "habit", "settled_all", "learning", "h2h", "value", "buyer_worry", "customer_worry", "looking_around", "expansion", "business_case", "alongside", "critic", "criteria"].includes(p.kind)) failures.push(`${project.brand}: ${id} ${p.kind} carries ${view}`);
        if (view === "detailsComp" && !p.compare) failures.push(`${project.brand}: ${id} detailsComp without a competitors view`);
        for (const [k, d] of Object.entries(ds)) {
          if (!d) continue;
          detailCount++;
          if (!p.steps.some((s) => s.key === k)) failures.push(`${project.brand}: ${id} ${view}.${k} explains a step the panel does not draw`);
          if (!d.heading.trim()) failures.push(`${project.brand}: ${id} ${view}.${k} has no heading`);
          for (const sp of [...d.body, ...(d.both ?? [])]) {
            if (/^<?\d+%$/.test(sp.t.trim()) && sp.t.trim() !== "0%" && !(sp.refs && sp.refs.length)) failures.push(`${project.brand}: ${id} ${view}.${k} number ${sp.t} opens no answers`);
            if (/\d+%/.test(sp.t) && !/^<?\d+%$/.test(sp.t.trim())) failures.push(`${project.brand}: ${id} ${view}.${k} number buried in text "${sp.t}"`);
          }
          if (d.outcomes?.length && !d.outcomeLabels) failures.push(`${project.brand}: ${id} ${view}.${k} outcomes have no labels`);
          if (d.rows?.length && !d.columns) failures.push(`${project.brand}: ${id} ${view}.${k} rows have no column names`);
        }
      }
      // 6d. am35: a panel with no usual sets you against the average competitor - every `here` step
      // with competitors carries it, with its example answers.
      // (am35 D: every panel whose steps carry competitor numbers, not only the no-usual ones; head-to-heads excepted.)
      if (p.kind !== "h2h" && p.compare && (p.competitorOrder ?? []).length && p.steps.some((s) => !!s.here && !!s.rivals?.length)) {
        if (!p.avgComp) failures.push(`${project.brand}: ${id} no usual, competitors listed, but no average competitor`);
        for (const s of p.steps) {
          if (!s.here || !s.rivals?.length) continue;
          avgCount++;
          if (!s.usual || s.usualLabel !== "Average competitor") failures.push(`${project.brand}: ${id} step ${s.key} has no average competitor`);
          else if (s.usual.pct > 0 && !(s.usual.refs ?? []).length) failures.push(`${project.brand}: ${id} step ${s.key} average competitor opens no answers`);
          if (s.tagUsual && /your usual/i.test(s.tagUsual)) failures.push(`${project.brand}: ${id} step ${s.key} still carries a your-usual tag "${s.tagUsual}"`);
        }
        if (p.usualKey !== "Average competitor" || p.hereKey !== "You") failures.push(`${project.brand}: ${id} average-competitor key line reads "${p.hereKey}" / "${p.usualKey}"`);
      }
      // 6d'. am35 E: a head-to-head's "who it picks" step carries the rival beside you.
      if (p.kind === "h2h") for (const s of p.steps) if (s.key === "won" && !s.vs) failures.push(`${project.brand}: ${id} who-it-picks step has no rival beside you`);
      // 6e. am35: an explanation never repeats a number the step bars of its view already draw.
      const valuesOf = (ns: (PanelNum | undefined)[]) => new Set(ns.filter((n): n is PanelNum => !!n).map((n) => n.value));
      const usualCellSteps = p.usualCellId ? ((view.positions as Record<string, Position>)[p.usualCellId]?.panel?.steps ?? []) : [];
      const barsNormal = valuesOf(p.steps.flatMap((s) => [s.here, s.usual, s.vs?.num, usualCellSteps.find((u) => u.key === s.key)?.here]));
      const barsComp = valuesOf(p.steps.flatMap((s) => [s.here, ...(s.rivals ?? []).map((r) => r.num)]));
      const repeats = (body: { t: string }[], bars: Set<string>, at: string) => {
        for (const sp of body) for (const m of sp.t.match(/<?\d+%/g) ?? []) if (bars.has(m)) failures.push(`${project.brand}: ${at} repeats the bar number ${m} in "${body.map((x) => x.t).join("").slice(0, 120)}"`);
      };
      for (const [k, d] of Object.entries(p.details ?? {})) if (d) { repeatChecks++; repeats(d.body, barsNormal, `${id} details.${k}`); }
      for (const [k, d] of Object.entries(p.detailsComp ?? {})) if (d) { repeatChecks++; repeats(d.body, barsComp, `${id} detailsComp.${k}`); }
      for (const rv of p.rivals ?? []) {
        const bars = valuesOf(rv.steps.flatMap((s) => [s.here, ...(s.rivals ?? []).map((r) => r.num)]));
        for (const [k, d] of Object.entries(rv.details ?? {})) if (d) { repeatChecks++; repeats(d.body, bars, `${id} rival ${rv.name} details.${k}`); }
      }
      // 6f. am36: the verdict panels - every step carries a one-line takeaway tag, the same in
      // both views; the explanation (detail, and detailComp or detail in the comparison view)
      // and the lead never repeat a number the top bars of that view draw (the bars, the
      // split bars, the checklist, the step's sentence and the small "usual X%" figures), and
      // the explanation body is one sentence.
      if (VERDICT_KINDS.has(p.kind)) {
        if (process.env.PANEL_PLANT && !planted && p.kind === "value" && p.detail && p.steps[0]?.segments?.[0]) {
          planted = true;
          p.detail = { ...p.detail, body: [...p.detail.body, { t: ` ${p.steps[0].segments[0].num.value}` }] };
        }
        if (!p.thin)
          for (const s of p.steps) {
            if (!s.tagUsual || !TAKEAWAY_TAGS.includes(s.tagUsual)) failures.push(`${project.brand}: ${id} ${p.kind} step ${s.key} has no takeaway tag ("${s.tagUsual ?? ""}")`);
            if (s.tagRank !== s.tagUsual) failures.push(`${project.brand}: ${id} ${p.kind} step ${s.key} tag differs between views`);
          }
        const usualSteps = p.usualCellId ? ((view.positions as Record<string, Position>)[p.usualCellId]?.panel?.steps ?? []) : [];
        const noteNums = (s: PanelStep) => new Set((s.note ?? []).flatMap((sp) => sp.t.match(/<?\d+%/g) ?? []));
        const stepVals = (s: PanelStep, comp: boolean) => [
          s.here, ...(comp ? (s.rivals ?? []).map((r) => r.num) : [s.usual, s.vs?.num]),
          ...(s.segments ?? []).map((g) => g.num), ...(s.items ?? []).map((it) => it.num),
          ...(comp ? [] : [usualSteps.find((u) => u.key === s.key)?.here, ...(usualSteps.find((u) => u.key === s.key)?.segments ?? []).map((g) => g.num)]),
        ];
        const barsOf = (comp: boolean) => {
          const set = valuesOf(p.steps.flatMap((s) => stepVals(s, comp)));
          for (const s of p.steps) for (const m of noteNums(s)) set.add(m);
          return set;
        };
        const nb = barsOf(false);
        const cb = barsOf(true);
        const views: [string, PositionPanel["detail"], Set<string>][] = [["detail", p.detail, nb], ...(p.compare ? [["detailComp", p.detailComp ?? p.detail, cb] as [string, PositionPanel["detail"], Set<string>]] : [])];
        for (const [v, d, bars] of views) {
          if (!d) continue;
          repeatChecks++;
          repeats(d.body, bars, `${id} ${p.kind} ${v}`);
          const txt = d.body.map((x) => x.t).join("");
          if ((txt.match(/[a-z]{2}\.\s+[A-Z]/g) ?? []).length) failures.push(`${project.brand}: ${id} ${p.kind} ${v} is more than one sentence: "${txt.slice(0, 160)}"`);
        }
        if (p.lead?.length) {
          repeatChecks += 2;
          repeats(p.lead, nb, `${id} ${p.kind} lead`);
          if (p.compare) repeats(p.lead, cb, `${id} ${p.kind} lead (comparison view)`);
        }
        verdictChecked++;
      }
      if (p.kind === "h2h" && p.detail) {
        repeatChecks++;
        repeats(p.detail.body, barsNormal, `${id} h2h detail`);
      }
      // 6g. am37: the audit's mechanical classes, so they cannot return.
      {
        am37Checks++;
        const shown = (n: PanelNum) => (n.value === "<1%" ? 0.5 : parseFloat(n.value) || 0);
        const rate = (n: PanelNum) => { const k = knOfH(n); return k && k.n > 0 ? k.k / k.n : n.pct / 100; };
        const close = (a: PanelNum, b: PanelNum) => {
          const ka = knOfH(a);
          if (Math.abs(rate(a) - rate(b)) * 100 < CLOSE_PTS) return true;
          if (!ka || ka.n === 0) return false;
          const c = wilsonCell(ka.k, ka.n);
          return rate(b) >= c.low && rate(b) <= c.high;
        };
        const usualStepsH = p.usualCellId ? ((view.positions as Record<string, Position>)[p.usualCellId]?.panel?.steps ?? []) : [];
        const allSteps: [PanelStep, string][] = [...p.steps.map((st) => [st, "panel"] as [PanelStep, string]), ...(p.rivals ?? []).flatMap((r) => r.steps.map((st) => [st, `rival ${r.name}`] as [PanelStep, string]))];
        for (const [st, at] of allSteps) {
          // Tag vs numbers: direction and ties.
          const other = st.usual ?? (at === "panel" ? usualStepsH.find((u) => u.key === st.key)?.here : undefined);
          if (st.here && other && st.tagUsual && at === "panel") {
            const t = st.tagUsual;
            if (/\b(above|higher|more)\b/i.test(t) && !/^Usually/.test(t) && (rate(st.here) <= rate(other) || close(st.here, other)) && /(usual|competitor|than in)/i.test(t)) failures.push(`${project.brand}: ${id} ${at} step ${st.key} tag "${t}" but ${st.here.value} vs ${other.value}`);
            if (/\b(below|lower|fewer|less)\b/i.test(t) && (rate(st.here) >= rate(other) || close(st.here, other)) && /(usual|competitor|than in)/i.test(t)) failures.push(`${project.brand}: ${id} ${at} step ${st.key} tag "${t}" but ${st.here.value} vs ${other.value}`);
            if (/^About /.test(t) && !close(st.here, other)) failures.push(`${project.brand}: ${id} ${at} step ${st.key} tag "${t}" on a gap that is not close (${st.here.value} vs ${other.value})`);
          }
          if (st.here && st.rivals?.length && st.tagRank) {
            const vals = [shown(st.here), ...st.rivals.map((r) => shown(r.num))];
            if (vals.every((v) => v === vals[0]) && st.tagRank !== "Level" && !TAKEAWAY_TAGS.includes(st.tagRank) && st.tagRank !== "Even") failures.push(`${project.brand}: ${id} ${at} step ${st.key} tag "${st.tagRank}" on a tie`);
            if (/furthest behind/.test(st.tagRank) && Math.max(...vals.slice(1)) - vals[0] < CLOSE_PTS - 0.5) failures.push(`${project.brand}: ${id} ${at} step ${st.key} "furthest behind" on a ${Math.max(...vals.slice(1)) - vals[0]}-point gap`);
            if (/^You lead /.test(st.tagRank) && st.rivals.some((r) => shown(r.num) >= shown(st.here!))) failures.push(`${project.brand}: ${id} ${at} step ${st.key} "${st.tagRank}" but a rival is level or ahead`);
          }
          // "Mostly" said of every answer, "Mostly" on a 50/50 split.
          for (const t of [st.tagUsual, st.tagRank]) {
            if (!t || !/^Mostly /.test(t)) continue;
            const segs = (st.segments ?? []).map((g) => g.num.pct).sort((a, b) => b - a);
            if (segs.length && segs[0] >= 99.95) failures.push(`${project.brand}: ${id} ${at} step ${st.key} "${t}" at 100%`);
            if (segs.length >= 2 && Math.abs(segs[0] - segs[1]) < 1 && segs[0] >= 49) failures.push(`${project.brand}: ${id} ${at} step ${st.key} "${t}" on a split`);
            if (!segs.length && st.here && st.here.pct >= 99.95) failures.push(`${project.brand}: ${id} ${at} step ${st.key} "${t}" at 100%`);
          }
        }
        // "lose" / "gap" wording only when behind on the share of picks (pick kinds), or behind at that step (a rival's panel, a lost head-to-head).
        const own2 = cellIds[id] ?? [];
        const pickCount = new Map<string, number>();
        for (const rid of own2) {
          const c = codeOf.get(rid) as Code | undefined;
          if (!c || c.outcome !== "pick" || !c.top_pick) continue;
          const x = resolve(c.top_pick);
          if (x.status !== "active") continue;
          pickCount.set(x.key, (pickCount.get(x.key) ?? 0) + 1);
        }
        const mineP = pickCount.get(targetKey) ?? 0;
        const behindP = [...pickCount.entries()].some(([k, v]) => k !== targetKey && v > mineP);
        const LOSE = /\b(why you lose|where you lose|part of where you lose|the gap opens|where the gap opens)\b/i;
        const panelWords = [p.stackLabel, p.detail?.heading, ...(p.detail?.body ?? []).map((x) => x.t), p.detailComp?.heading, ...(p.detailComp?.body ?? []).map((x) => x.t), ...[...Object.values(p.details ?? {}), ...Object.values(p.detailsComp ?? {})].flatMap((d) => (d ? [d.heading, ...d.body.map((x) => x.t)] : []))].filter((x): x is string => !!x);
        const pickKind = p.kind === "buy" || p.kind === "switching" || p.kind === "popular" || p.kind === "premium";
        for (const w of panelWords) if (LOSE.test(w) && !(pickKind && behindP)) failures.push(`${project.brand}: ${id} says "${w.slice(0, 90)}" but you are not behind on the picks here`);
        for (const rv of p.rivals ?? []) if (rv.stackLabel && LOSE.test(rv.stackLabel) && !rv.steps.some((st) => st.tagRank === "The gap opens here")) failures.push(`${project.brand}: ${id} rival ${rv.name} says "${rv.stackLabel}" with no step where it leads`);
        // The claim's "N other brands" equals the other brands listed, and never counts you.
        const claimText = p.claim.map((x) => x.t).join("");
        const WORDN: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
        const mN = claimText.match(/\b(\w+) other brands? takes?\b/i);
        if (mN) {
          const n = WORDN[mN[1].toLowerCase()] ?? parseInt(mN[1], 10);
          const listedN = (p.competitors?.rows ?? []).filter((r) => !r.you).length;
          if (n !== listedN) failures.push(`${project.brand}: ${id} claim says ${mN[1]} other brands, the list shows ${listedN}`);
        }
        for (const r of p.competitors?.rows ?? []) if (!r.you && keyOfName(r.name) === targetKey) failures.push(`${project.brand}: ${id} competitors list the tracker's own brand as "${r.name}"`);
        for (const nme of p.competitorOrder ?? []) if (keyOfName(nme) === targetKey) failures.push(`${project.brand}: ${id} competitorOrder carries the tracker's own brand "${nme}"`);
        // No doubled possessive.
        const walkStr = (v: unknown, path: string) => {
          if (typeof v === "string") {
            if (/['’]s['’]s\b/.test(v) || /\b[A-Za-z]+s['’]s\b/.test(v)) failures.push(`${project.brand}: ${id}${path} doubled possessive in ${JSON.stringify(v.slice(0, 120))}`);
            if (/\ban\s+One[A-Z]/.test(v) || /\b[a-z]+ Your named\b/.test(v)) failures.push(`${project.brand}: ${id}${path} article or capital in ${JSON.stringify(v.slice(0, 120))}`);
          } else if (Array.isArray(v)) v.forEach((x, i) => walkStr(x, `${path}[${i}]`));
          else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!["refs", "tip", "find"].includes(k)) walkStr(x, `${path}.${k}`);
        };
        walkStr(p, "");
        // One own-cheaper share per Value panel.
        if (p.kind === "value") {
          const ownSeg = p.steps.find((st) => st.key === "instead")?.segments?.find((g) => g.key === "own");
          const ownRow = (p.competitors?.rows ?? []).find((r) => r.you);
          if (ownRow && (!ownSeg || ownSeg.num.value !== ownRow.num.value)) failures.push(`${project.brand}: ${id} own cheaper option ${ownSeg?.num.value ?? "absent"} in the step, ${ownRow.num.value} in the list`);
        }
        // No empty condition column beside a full one.
        for (const [c, at] of [[p.conditions, "panel"], ...(p.rivals ?? []).map((r) => [r.conditions, `rival ${r.name}`])] as [PanelConditions | undefined, string][]) {
          if (!c) continue;
          // (What to use alongside you is one list when nothing of yours is named - am56 - so its empty column is by design.)
          if (c.toward.length === 0 && c.away.length > 0 && !c.towardNote && p.kind !== "alongside") failures.push(`${project.brand}: ${id} ${at} "${c.towardTitle}" column is empty with no line`);
          if (c.away.length === 0 && c.toward.length > 0 && !c.awayNote) failures.push(`${project.brand}: ${id} ${at} "${c.awayTitle}" column is empty with no line`);
          const lc = (x: string) => x.toLowerCase();
          for (const side of ["toward", "away"] as const) {
            const seen = new Set<string>();
            for (const row of c[side]) {
              if (seen.has(lc(row.text))) failures.push(`${project.brand}: ${id} ${at} ${side} lists "${row.text}" twice`);
              seen.add(lc(row.text));
              if (/^[a-z]/.test(row.text)) failures.push(`${project.brand}: ${id} ${at} ${side} row "${row.text}" is not in sentence case`);
            }
          }
        }
        // A step that starts selected has an explanation.
        if (p.details && p.focus && !p.details[p.focus]) failures.push(`${project.brand}: ${id} focus ${p.focus} has no explanation`);
        if (p.detailsComp && p.focusComp && !p.detailsComp[p.focusComp]) failures.push(`${project.brand}: ${id} comparison focus ${p.focusComp} has no explanation`);
        // Competitors said to do a step "more often than you" are ahead of you at it.
        for (const d of [p.detail, p.detailComp]) {
          const txt = (d?.body ?? []).map((x) => x.t).join("");
          const m = txt.match(/^(.+?) (?:are both|is) .+ more often than you here\./);
          if (!m) continue;
          const fs = p.focusComp ? p.steps.find((st) => st.key === p.focusComp) : undefined;
          if (!fs?.here || !fs.rivals) continue;
          for (const nme of m[1].split(/, | and /)) {
            const r = fs.rivals.find((x) => x.name === nme.trim());
            if (r && shown(r.num) <= shown(fs.here)) failures.push(`${project.brand}: ${id} names ${nme} "more often than you" at ${r.num.value} against your ${fs.here.value}`);
          }
        }
      }
      // 6h. am38: Value's steps explain themselves; "What the answer weighs" is sized, never also a line.
      {
        const am38Bars = new Set<string>(p.steps.flatMap((s) => [...(s.segments ?? []).map((g) => g.num.value), ...(s.here ? [s.here.value] : [])]));
        const usualSegs = p.usualCellId ? ((view.positions as Record<string, Position>)[p.usualCellId]?.panel?.steps ?? []).flatMap((s) => (s.segments ?? []).map((g) => g.num.value)) : [];
        for (const v of usualSegs) am38Bars.add(v);
        if (p.kind === "value" && !p.thin) {
          for (const k of ["worth", "instead"] as const) {
            const d = p.details?.[k];
            if (!d) { failures.push(`${project.brand}: ${id} value has no explanation for step ${k}`); continue; }
            am38Checks++;
            repeats(d.body, am38Bars, `${id} value details.${k}`);
            const txt = d.body.map((x) => x.t).join("");
            if ((txt.match(/[a-z]{2}\.\s+[A-Z]/g) ?? []).length) failures.push(`${project.brand}: ${id} value details.${k} is more than one sentence: "${txt.slice(0, 160)}"`);
            for (const sec of d.sections ?? []) for (const r of sec.rows) {
              if ((knOfH(r.num)?.k ?? 0) < 3) failures.push(`${project.brand}: ${id} value details.${k} "${sec.title}" row "${r.label}" rests on fewer than 3 answers`);
              if (/own cheaper option/i.test(r.label)) failures.push(`${project.brand}: ${id} value details.${k} lists the own-cheaper bar as a row`);
            }
          }
          if (p.competitors) failures.push(`${project.brand}: ${id} value still carries the competitors block`);
          if (p.byProduct) {
            const total = p.byProduct.rows.reduce((a, r) => a + (knOfH(r.cells[0] as PanelNum)?.n ?? 0), 0);
            if (total !== (cellIds[id] ?? []).length) failures.push(`${project.brand}: ${id} by-product rows add to ${total}, the cell has ${(cellIds[id] ?? []).length}`);
            for (const r of p.byProduct.rows) {
              const n0 = knOfH(r.cells[0] as PanelNum)?.n;
              const ks = r.cells.slice(0, 3).map((c) => knOfH(c as PanelNum));
              if (ks.some((x) => !x || x.n !== n0) || ks.reduce((a, x) => a + (x?.k ?? 0), 0) !== n0) failures.push(`${project.brand}: ${id} by-product row "${r.label}" verdicts do not add to its answers`);
            }
            if (p.byProduct.rows.length < 2) failures.push(`${project.brand}: ${id} by-product table with one product`);
          }
        }
        const weighLines = [...(p.lines ?? []), ...(p.linesComp ?? []), ...(p.rivals ?? []).flatMap((r) => r.lines)].filter((l) => /what the answer weighs/i.test(l.label));
        if (weighLines.length) failures.push(`${project.brand}: ${id} still carries a "What the answer weighs" line`);
        for (const w of [p.weighs, p.weighsComp, ...(p.rivals ?? []).map((r) => r.weighs)]) {
          if (!w) continue;
          am38Checks++;
          for (const c of w.columns) {
            if (!c.rows.length && !c.note) failures.push(`${project.brand}: ${id} weighs column "${c.title ?? ""}" has no rows and no note`);
            if (c.rows.length > 3) failures.push(`${project.brand}: ${id} weighs column "${c.title ?? ""}" lists ${c.rows.length} topics`);
            for (const r of c.rows) if ((knOfH(r.num)?.k ?? 0) < 3) failures.push(`${project.brand}: ${id} weighs row "${r.name}" rests on fewer than 3 answers`);
          }
        }
      }
      // 6i. am59: Premium vs basic - the which-end bars add up to the cell's answers, its explanation repeats no top-bar
      // number, it starts selected, and no row of the new blocks (each end's list, the explanation's lists) rests on
      // fewer than 3 answers; an end's "You" row is the tracker's own brand.
      if (p.kind === "premium") {
        const tierStep = p.steps.find((st) => st.key === "tier");
        const cellN = (cellIds[id] ?? []).length;
        if (!tierStep?.segments?.length) failures.push(`${project.brand}: ${id} premium has no which-end step`);
        else {
          const ks = tierStep.segments.map((g) => knOfH(g.num));
          if (ks.some((x) => !x || x.n !== cellN) || ks.reduce((a, x) => a + (x?.k ?? 0), 0) !== cellN) failures.push(`${project.brand}: ${id} premium which-end bars do not add up to the cell's ${cellN} answers`);
          if (!p.thin) {
            if (!tierStep.tagUsual || !TAKEAWAY_TAGS.includes(tierStep.tagUsual) || tierStep.tagRank !== tierStep.tagUsual) failures.push(`${project.brand}: ${id} premium which-end step has no takeaway tag ("${tierStep.tagUsual ?? ""}")`);
            if (p.focus !== "tier") failures.push(`${project.brand}: ${id} premium does not start on the which-end step`);
            const topBars = valuesOf(p.steps.flatMap((st) => [st.here, st.usual, ...(st.rivals ?? []).map((r) => r.num), ...(st.segments ?? []).map((g) => g.num)]));
            for (const [v, ds] of [["details", p.details], ["detailsComp", p.detailsComp]] as const) {
              const d = ds?.tier;
              if (!d) { if (v === "details" || p.compare) failures.push(`${project.brand}: ${id} premium ${v} has no which-end explanation`); continue; }
              repeatChecks++;
              repeats(d.body, topBars, `${id} premium ${v}.tier`);
              const txt = d.body.map((x) => x.t).join("");
              if ((txt.match(/[a-z]{2}\.\s+[A-Z]/g) ?? []).length) failures.push(`${project.brand}: ${id} premium ${v}.tier is more than one sentence`);
              for (const sec of d.sections ?? []) for (const r of sec.rows) if ((knOfH(r.num)?.k ?? 0) < 3) failures.push(`${project.brand}: ${id} premium ${v}.tier "${sec.title}" row "${r.label}" rests on fewer than 3 answers`);
            }
          }
        }
        for (const c of p.ends?.columns ?? []) {
          if (!c.rows.length && !c.note) failures.push(`${project.brand}: ${id} premium end "${c.title ?? ""}" has no rows and no note`);
          if (c.rows.length > 5) failures.push(`${project.brand}: ${id} premium end "${c.title ?? ""}" lists ${c.rows.length} names`);
          for (const r of c.rows) {
            if ((knOfH(r.num)?.k ?? 0) < 3) failures.push(`${project.brand}: ${id} premium end row "${r.name}" rests on fewer than 3 answers`);
            if (r.you && r.name !== "You") failures.push(`${project.brand}: ${id} premium end row "${r.name}" is marked yours but not named You`);
            if (!r.you && keyOfName(r.name) === targetKey) failures.push(`${project.brand}: ${id} premium end lists the tracker's own brand as "${r.name}"`);
          }
        }
        for (const side of ["toward", "away"] as const) for (const row of p.conditions?.[side] ?? []) if ((knOfH(row.share)?.k ?? 0) < 3) failures.push(`${project.brand}: ${id} premium condition "${row.text}" rests on fewer than 3 answers`);
      }
      // 6j. am60 (the habit segment keys are checked here: "depends" means worth_it on Value): Habit - the step's bars add up to the cell's answers, the pick bars show the brand they say, both
      // explanations repeat no top-bar number and are one sentence, it starts on the habit step, and no row of the
      // explanations' lists rests on fewer than 3 answers.
      if (p.kind === "habit") {
        const hs = p.steps.find((st) => st.key === "habit");
        const cellN = (cellIds[id] ?? []).length;
        if (!hs?.segments?.length) failures.push(`${project.brand}: ${id} habit has no habit step`);
        else {
          const ks = hs.segments.map((g) => knOfH(g.num));
          if (ks.some((x) => !x || x.n !== cellN) || ks.reduce((a, x) => a + (x?.k ?? 0), 0) !== cellN) failures.push(`${project.brand}: ${id} habit bars do not add up to the cell's ${cellN} answers`);
          for (const g of hs.segments)
            for (const r of g.num.refs ?? []) {
              const c = codeOf.get(r.responseId) as Code | undefined;
              if (g.key === "stick" && !(c && picks(c, targetKey))) failures.push(`${project.brand}: ${id} habit "sticks with you" answer ${r.responseId.slice(0, 8)} does not pick you`);
              if (g.key === "other" && !(c && c.outcome === "pick" && !!c.top_pick && !picks(c, targetKey))) failures.push(`${project.brand}: ${id} habit "picks another brand" answer ${r.responseId.slice(0, 8)} does not pick another brand`);
              if (g.key === "depends" && c?.outcome !== "conditional") failures.push(`${project.brand}: ${id} habit "says it depends" answer ${r.responseId.slice(0, 8)} is not conditional`);
              if (g.key === "nopick" && (c?.outcome === "pick" || c?.outcome === "conditional")) failures.push(`${project.brand}: ${id} habit "names no pick" answer ${r.responseId.slice(0, 8)} names a pick or a condition`);
            }
          if (!p.thin) {
            if (p.focus !== "habit") failures.push(`${project.brand}: ${id} habit does not start on the habit step`);
            const topBars = valuesOf(p.steps.flatMap((st) => [st.here, st.usual, ...(st.rivals ?? []).map((r) => r.num), ...(st.segments ?? []).map((g) => g.num)]));
            for (const k of ["habit", "offers"] as const) {
              const d = p.details?.[k];
              if (!d) { failures.push(`${project.brand}: ${id} habit has no explanation for step ${k}`); continue; }
              repeatChecks++;
              repeats(d.body, topBars, `${id} habit details.${k}`);
              const txt = d.body.map((x) => x.t).join("");
              if ((txt.match(/[a-z]{2}\.\s+[A-Z]/g) ?? []).length) failures.push(`${project.brand}: ${id} habit details.${k} is more than one sentence`);
              for (const sec of d.sections ?? []) for (const r of sec.rows) if ((knOfH(r.num)?.k ?? 0) < 3) failures.push(`${project.brand}: ${id} habit details.${k} "${sec.title}" row "${r.label}" rests on fewer than 3 answers`);
            }
          }
        }
        if (p.compare || p.competitors) failures.push(`${project.brand}: ${id} habit carries a competitors switch or block`);
      }
      // 6k. am61: the settled All questions card - its three bars add up to the cell's answers, each "By question" row
      // is that question's own strengthens share (and opens its cell), the explanation repeats no top-bar number and
      // is one sentence, it starts selected, and it carries no conditions, competitors or weighs.
      if (p.kind === "settled_all") {
        const rs = p.steps.find((st) => st.key === "relationship");
        const cellN = (cellIds[id] ?? []).length;
        if (!rs?.segments?.length) failures.push(`${project.brand}: ${id} settled_all has no relationship step`);
        else {
          const ks = rs.segments.map((g) => knOfH(g.num));
          if (ks.some((x) => !x || x.n !== cellN) || ks.reduce((a, x) => a + (x?.k ?? 0), 0) !== cellN) failures.push(`${project.brand}: ${id} settled_all bars do not add up to the cell's ${cellN} answers`);
          for (const g of rs.segments)
            for (const r of g.num.refs ?? []) {
              const v = (codeOf.get(r.responseId) as Code | undefined)?.relationship_verdict;
              const ok = g.key === "strengthens" ? v === "strengthens" : g.key === "weakens" ? v === "weakens" : v !== "strengthens" && v !== "weakens";
              if (!ok) failures.push(`${project.brand}: ${id} settled_all segment ${g.key} answer ${r.responseId.slice(0, 8)} lacks the verdict`);
            }
          if (!p.thin) {
            if (p.focus !== "relationship") failures.push(`${project.brand}: ${id} settled_all does not start on its step`);
            const d = p.details?.relationship;
            if (!d) failures.push(`${project.brand}: ${id} settled_all has no explanation`);
            else {
              const topBars = valuesOf(rs.segments.map((g) => g.num));
              repeatChecks++;
              repeats(d.body, topBars, `${id} settled_all details.relationship`);
              const txt = d.body.map((x) => x.t).join("");
              if ((txt.match(/[a-z]{2}\.\s+[A-Z]/g) ?? []).length) failures.push(`${project.brand}: ${id} settled_all explanation is more than one sentence`);
              const byQ = (d.sections ?? []).find((sec) => sec.title === "By question");
              const kids = Object.keys(cellIds).filter((c) => c.startsWith("settled:settled:") && c !== id && (cellIds[c] ?? []).length >= 10);
              if (!byQ || byQ.rows.length !== kids.length) failures.push(`${project.brand}: ${id} settled_all "By question" lists ${byQ?.rows.length ?? 0} questions, the Map has ${kids.length}`);
              for (const r of byQ?.rows ?? []) {
                const kid = r.cell ?? "";
                const own = cellIds[kid] ?? [];
                const k = own.filter((rid) => (codeOf.get(rid) as Code | undefined)?.relationship_verdict === "strengthens").length;
                const kn = knOfH(r.num);
                if (!kids.includes(kid)) failures.push(`${project.brand}: ${id} settled_all row "${r.label}" opens no question cell`);
                else if (!kn || kn.k !== k || kn.n !== own.length) failures.push(`${project.brand}: ${id} settled_all row "${r.label}" is not that question's own strengthens share`);
                const pos2 = (view.positions as Record<string, Position>)[kid];
                if (pos2 && !pos2.where.endsWith(r.label)) failures.push(`${project.brand}: ${id} settled_all row "${r.label}" is not the Map label of ${kid}`);
              }
            }
          }
        }
        if (p.conditions || p.competitors || p.weighs) failures.push(`${project.brand}: ${id} settled_all carries conditions, competitors or weighs`);
      }
      // 7. kinds without conditions.
      if ((p.kind === "buyer_worry" || p.kind === "customer_worry" || p.kind === "value" || p.kind === "business_case") && p.conditions) failures.push(`${project.brand}: ${id} ${p.kind} carries conditions`);
      if ((p.kind === "learning" || p.kind === "critic") && p.conditions) failures.push(`${project.brand}: ${id} ${p.kind} carries conditions`);
      // Question labels: with no saved label the claim takes the quoted fallback - the seed question verbatim. A
      // snapshot of live carries the saved labels, whose claims quote nothing; so a claim that quotes must quote the seed.
      if (p.kind === "popular" || p.kind === "learning" || p.kind === "alongside" || p.kind === "critic" || p.kind === "expansion" || p.kind === "business_case") {
        const own = new Set(cellIds[id] ?? []);
        const seeds = [...new Set(data.codes.filter((c: { response_id: string }) => own.has(c.response_id)).map((c: { response_id: string }) => data.responses.find((r: { id: string }) => r.id === c.response_id)?.prompt_id))]
          .map((pid) => data.intents.find((i: { id: string }) => i.id === data.prompts.find((q: { id: string; intent_id?: string | null }) => q.id === pid)?.intent_id))
          .filter(Boolean) as { text: string; seq: number }[];
        const seed = seeds.sort((a, b) => a.seq - b.seq)[0]?.text?.trim();
        const claimText = p.claim.map((x) => x.t).join("");
        if (claimText.includes('"') && (!seed || !claimText.includes(`"${seed}"`))) failures.push(`${project.brand}: ${id} ${p.kind} fallback claim does not quote its seed question (${claimText.slice(0, 120)})`);
        else labelFallbacks++;
      }
      // 4 + 5. plain wording and category words over the panel tree, data phrases stripped.
      const panelPhrases = new Set<string>(phrases);
      const addP = (x: unknown) => { if (typeof x === "string" && x.trim().length >= 3) panelPhrases.add(x.trim()); };
      for (const c of [p.conditions, ...(p.rivals ?? []).map((r) => r.conditions)]) for (const row of [...(c?.toward ?? []), ...(c?.away ?? [])]) { addP(row.text); for (const x of row.products ?? []) addP(x); }
      for (const r of p.competitors?.rows ?? []) addP(r.name);
      for (const t of [p.table, p.tableComp, ...(p.tables ?? [])]) for (const r of t?.rows ?? []) addP(r.label);
      for (const s of p.steps) for (const it of s.items ?? []) addP(it.label);
      for (const s of p.steps) for (const it of s.items ?? []) addP(it.label);
      for (const rv of p.rivals ?? []) addP(rv.name);
      for (const d of [...Object.values(p.details ?? {}), ...Object.values(p.detailsComp ?? {})]) for (const r of d?.list?.rows ?? []) addP(r.label);
      for (const n of p.competitorOrder ?? []) addP(n);
      for (const d of Object.values(p.details ?? {})) for (const sec of d?.sections ?? []) for (const r of sec.rows) addP(r.label);
      for (const w of [p.weighs, p.weighsComp, p.ends, ...(p.rivals ?? []).map((r) => r.weighs)]) for (const c of w?.columns ?? []) for (const r of c.rows) addP(r.name);
      for (const r of p.byProduct?.rows ?? []) { addP(r.label); for (const c of r.cells) if (c && "t" in c) addP(c.t); }
      if (p.product) addP(p.product);
      const strip = (t: string) => {
        let x = t.replace(/"[^"]*"/g, '""');
        for (const d of [...panelPhrases].sort((a, b) => b.length - a.length)) if (x.toLowerCase().includes(d.toLowerCase())) x = x.split(new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(" ");
        return x;
      };
      const SKIP = new Set([...SKIP_KEYS, "tip", "kind", "tone", "usualCellId", "competitorOrder", "name"]);
      const other = [...categoryWords.entries()].filter(([b]) => b !== project.brand).flatMap(([, ws]) => ws).filter((w) => !(categoryWords.get(project.brand) ?? []).includes(w));
      const walkText = (v: unknown, path: string) => {
        if (typeof v === "string") {
          const t = strip(v);
          for (const [name, re] of PANEL_BANNED) if (re.test(t)) failures.push(`${project.brand}: ${id}.panel${path}: "${name}" in ${JSON.stringify(v.slice(0, 140))}`);
          // (A single-question card's claim carries a model-written label of the tracker's own question, which may use any everyday word.)
          const labelClaim = /^\.claim/.test(path) && ["popular", "learning", "alongside", "critic", "expansion", "business_case"].includes(p.kind);
          if (!labelClaim) for (const w of other) if (new RegExp(`\\b${w.replace(/s$/, "")}s?\\b`, "i").test(t)) failures.push(`${project.brand}: ${id}.panel${path}: another tracker's category word "${w}" in ${JSON.stringify(v.slice(0, 140))}`);
        } else if (Array.isArray(v)) v.forEach((x, i) => walkText(x, `${path}[${i}]`));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) walkText(x, `${path}.${k}`);
      };
      walkText(p, "");
    }
    // 1. old output unchanged.
    const slug = project.brand.toLowerCase().replace(/[^a-z]+/g, "_");
    const stripped = JSON.parse(JSON.stringify(view));
    for (const pp of Object.values(stripped.positions as Record<string, { panel?: unknown }>)) delete pp.panel;
    delete (stripped as { rivalPanels?: unknown }).rivalPanels;
    // PANEL_BASELINE_WRITE=<dir> writes this run's map (panels stripped) as a fresh baseline.
    if (process.env.PANEL_BASELINE_WRITE) {
      fsMod.mkdirSync(process.env.PANEL_BASELINE_WRITE, { recursive: true });
      fsMod.writeFileSync(`${process.env.PANEL_BASELINE_WRITE}/${slug}.map.json`, JSON.stringify(stripped));
    }
    const base = process.env.PANEL_BASELINE;
    if (base) {
      const f = `${base}/${slug}.map.json`;
      if (!fsMod.existsSync(f)) failures.push(`${project.brand}: no baseline ${f}`);
      else {
        // am62: the tensions gained a key, a move and whose-bar colours, and a quoted question is no longer cut at
        // 80 characters - so everything but the tensions must match byte for byte, and each tension must match the
        // baseline's apart from those (a quoted question may only run on past the old cut).
        const old = JSON.parse(fsMod.readFileSync(f, "utf8"));
        const oldT = old.tensions as { title: string; body: string; cellId: string; viz?: object[] }[];
        const newT = stripped.tensions as { title: string; body: string; cellId: string; viz?: { who?: string }[] }[];
        delete old.tensions;
        const rest = { ...stripped };
        delete rest.tensions;
        const strip = (t: { title: string; cellId: string; viz?: object[]; matchup?: object }) => JSON.stringify({ title: t.title, cellId: t.cellId, viz: (t.viz ?? []).map((v) => { const x = { ...(v as { who?: string }) }; delete x.who; return x; }), matchup: t.matchup });
        const quoteOk = (a: string, b: string) => a === b || (/\.\.\."$/.test(a) && b.startsWith(a.replace(/\.\.\."$/, "")) && b.endsWith('"'));
        if (JSON.stringify(old) !== JSON.stringify(rest)) failures.push(`${project.brand}: positions without panel differ from the am30 baseline`);
        else if (oldT.length !== newT.length || oldT.some((t, i) => strip(t) !== strip(newT[i]) || !quoteOk(t.body, newT[i].body))) failures.push(`${project.brand}: tensions differ from the am30 baseline beyond the key, move, bar owner and question quote`);
        else console.log(`OLD OUTPUT: identical to the am30 baseline (tensions: apart from am62's key, move, bar owner and question quote)`);
      }
    }
    // 8. payload: the served map (slim: a stub per panel) and the lazily loaded cell panels.
    const withP = JSON.stringify(view).length;
    const without = JSON.stringify(stripped).length;
    const slim = slimAnalysisMap(view);
    const slimBytes = JSON.stringify(slim).length;
    let maxCell = 0;
    let maxCellId = "";
    for (const [cid, pos] of Object.entries(view.positions as Record<string, Position>)) {
      const sp = (slim.positions as Record<string, Position>)[cid];
      if (sp.panel) failures.push(`${project.brand}: ${cid} served map carries a panel body`);
      if (!!pos.panel !== !!sp.panelStub) failures.push(`${project.brand}: ${cid} served stub does not match the panel`);
      if (pos.panel && sp.panelStub) {
        if (sp.panelStub.kind !== pos.panel.kind) failures.push(`${project.brand}: ${cid} stub kind differs`);
        if (JSON.stringify(sp.panelStub.rivals) !== JSON.stringify((pos.panel.rivals ?? []).map((r) => ({ name: r.name, full: r.full })))) failures.push(`${project.brand}: ${cid} stub rival list differs`);
        const cp = cellPanelOf(view, cid);
        if (JSON.stringify(cp.panel) !== JSON.stringify(pos.panel)) failures.push(`${project.brand}: ${cid} cell_panel body differs from the computed panel`);
        if (pos.panel.usualCellId && !cp.usualSteps) failures.push(`${project.brand}: ${cid} cell_panel has no usual steps`);
        const b = JSON.stringify(cp).length;
        if (b > maxCell) { maxCell = b; maxCellId = cid; }
      }
      const rest = { ...sp };
      delete rest.panelStub;
      const rest0 = { ...pos };
      delete rest0.panel;
      if (JSON.stringify(rest) !== JSON.stringify(rest0)) failures.push(`${project.brand}: ${cid} served position differs beyond the panel`);
    }
    const grow = (slimBytes - without) / without;
    if (grow > 0.6) failures.push(`${project.brand}: served map grows ${Math.round(grow * 100)}% over the no-panel size`);
    // Panel 15 (By rival): served map carries names only; every number opens answers of the map; plain wording; tags allowed.
    const rps = ((view as { rivalPanels?: RivalAcross[] }).rivalPanels ?? []) as RivalAcross[];
    if ((slim as { rivalPanels?: unknown }).rivalPanels) failures.push(`${project.brand}: served map carries rival panel bodies`);
    if (JSON.stringify((slim as { rivalStubs?: string[] }).rivalStubs ?? []) !== JSON.stringify(rps.map((r) => r.name))) failures.push(`${project.brand}: rival stubs do not match`);
    const allIds = new Set<string>(Object.values(cellIds).flat());
    let maxRival = 0;
    let rivalNums = 0;
    for (const rp of rps) {
      maxRival = Math.max(maxRival, JSON.stringify(rp).length);
      const walk = (v: unknown, path: string): void => {
        if (isNum(v)) {
          rivalNums++;
          const refs = v.refs ?? [];
          if (v.pct > 0 && !refs.length) failures.push(`${project.brand}: rival ${rp.name}${path} ${v.value} has no answers`);
          if (v.pct === 0 && refs.length) failures.push(`${project.brand}: rival ${rp.name}${path} 0% carries answers`);
          for (const r of refs) if (!allIds.has(r.responseId)) failures.push(`${project.brand}: rival ${rp.name}${path} answer outside the map`);
          return;
        }
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "refs") walk(x, `${path}.${k}`);
      };
      walk(rp, "");
      for (const st of rp.steps) {
        if (st.tag && !isAllowedTag(st.tag)) failures.push(`${project.brand}: rival ${rp.name} tag "${st.tag}" not allowed`);
        if (!(view.positions as Record<string, Position>)[st.cellId]) failures.push(`${project.brand}: rival ${rp.name} step ${st.key} points at no map position`);
        const c = st.conditions;
        if (c) {
          const t = new Set(c.toward.flatMap((x) => (x.share.refs ?? []).map((r) => r.responseId)));
          for (const x of c.away) for (const r of x.share.refs ?? []) if (t.has(r.responseId) && !c.towardScope) failures.push(`${project.brand}: rival ${rp.name} ${st.key} answer on both sides`);
        }
      }
      const rpPhr = new Set<string>([...dataPhrases(view, data), rp.name]);
      for (const st of rp.steps) {
        for (const b of st.bars) rpPhr.add(b.name);
        for (const r of st.table?.rows ?? []) rpPhr.add(r.label);
        for (const row of [...(st.conditions?.toward ?? []), ...(st.conditions?.away ?? [])]) { rpPhr.add(row.text); for (const x of row.products ?? []) rpPhr.add(x); }
      }
      for (const t of [rp.byBuyer, rp.products]) for (const r of t?.rows ?? []) rpPhr.add(r.label);
      const strip = (t: string) => {
        let x = t.replace(/"[^"]*"/g, '""');
        for (const d of [...rpPhr].filter((d) => d.trim().length >= 3).sort((a, b) => b.length - a.length)) if (x.toLowerCase().includes(d.toLowerCase())) x = x.split(new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(" ");
        return x;
      };
      const SK = new Set([...SKIP_KEYS, "tip", "kind", "tone", "tagTone", "name", "who", "cellId", "key"]);
      const wt = (v: unknown, path: string): void => {
        if (typeof v === "string") {
          const t = strip(v);
          for (const [nm, re] of PANEL_BANNED) if (re.test(t)) failures.push(`${project.brand}: rival ${rp.name}${path}: "${nm}" in ${JSON.stringify(v.slice(0, 140))}`);
        } else if (Array.isArray(v)) v.forEach((x, i) => wt(x, `${path}[${i}]`));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SK.has(k)) wt(x, `${path}.${k}`);
      };
      wt(rp, "");
    }
    console.log(`RIVAL PANELS: ${rps.length} rivals, ${rivalNums} numbers, largest ${maxRival} bytes, all ${JSON.stringify(rps).length} bytes`);
    payloadLines.push(`${project.brand.padEnd(17)} | full ${String(withP).padStart(9)} | no panel ${String(without).padStart(9)} | served ${String(slimBytes).padStart(9)} (+${Math.round(grow * 100)}%) | largest cell panel ${maxCell} (${maxCellId}) | rival panels ${rps.length} (${JSON.stringify(rps).length} bytes, largest ${maxRival})`);
    // 9. ruling 5 omissions.
    for (const o of (debug as { panelOmissions?: { cellId: string; list: string; code: string; share: number; hit: string; via: string }[] }).panelOmissions ?? [])
      omissionLines.push(`${project.brand.padEnd(17)} | ${o.cellId.padEnd(44)} | ${o.list.padEnd(9)} | ${o.code.padEnd(28)} | ${(Math.round(o.share * 1000) / 10).toFixed(1).padStart(5)}% | ${o.hit.padEnd(16)} | ${o.via}`);
    console.log(`PANELS: ${panels} panels, ${nums} numbers, ${refCount} example answers checked, ${labelFallbacks} quoted-seed claims, ${detailCount} step details, ${avgCount} average-competitor steps, ${repeatChecks} explanations checked for repeated bar numbers, ${verdictChecked} verdict panels checked, ${am37Checks} panels through the am37 checks, ${am38Checks} through the am38 checks`);
    if (detailCount === 0) failures.push(`${project.brand}: no panel carries step details`);
    if (avgCount === 0) failures.push(`${project.brand}: no panel carries an average competitor`);
    // The mockup numbers (American Express).
    if (project.brand === "American Express") {
      const P = (id: string) => (view.positions as Record<string, Position>)[id]?.panel as PositionPanel | undefined;
      const st = (id: string, k: string) => P(id)?.steps.find((s) => s.key === k);
      const v = (n?: PanelNum) => n?.value ?? "-";
      const segs = (id: string, k: string) => (st(id, k)?.segments ?? []).map((g) => `${g.key} ${g.num.value}`).join(" / ");
      const pair = (id: string, k: string) => `${v(st(id, k)?.here)} / ${v(st(P(id)?.usualCellId ?? "", k)?.here)}`;
      const sh = (id: string) => (P(id)?.lines ?? []).find((l) => l.label === "Your share of the picks")?.value.map((x) => x.t).join("") ?? "-";
      mockupLines.push(`P01 Everyday spender | share ${sh("chooses:open:everyday spender")} | named ${pair("chooses:open:everyday spender", "named")} | recommended ${pair("chooses:open:everyday spender", "recommended")} | converts ${pair("chooses:open:everyday spender", "converts")}`);
      mockupLines.push(`P02 Chase | picks one of the two ${pair("fights:h2h:chase", "decided")} | you ${v(st("fights:h2h:chase", "won")?.here)} | all head-to-heads ${v(st("fights:h2h:all", "won")?.here)}`);
      mockupLines.push(`P03 Capital One | named ${pair("fights:leavers:capital one", "named")} | recommended ${pair("fights:leavers:capital one", "recommended")} | converts ${pair("fights:leavers:capital one", "converts")}`);
      mockupLines.push(`P04 Fee feels too high | agrees ${pair("doubts:buyers:fee feels too high", "agrees")} | ${segs("doubts:buyers:fee feels too high", "verdict")} || all: ${segs("doubts:buyers:all", "verdict")}`);
      mockupLines.push(`P05 Credits too hard to use | agrees ${pair("doubts:customers:credits too hard to use", "agrees")} | ${segs("doubts:customers:credits too hard to use", "verdict")} || all: ${segs("doubts:customers:all", "verdict")}`);
      mockupLines.push(`P06 | ${segs("doubts:hold:all", "verdict")} | shows another ${v(st("doubts:hold:all", "offers")?.here)}`);
      mockupLines.push(`P07 Everyday spender | ${segs("chooses:value:everyday spender", "worth")} || all: ${segs("chooses:value:all", "worth")} || instead: ${segs("chooses:value:everyday spender", "instead")}`);
      mockupLines.push(`P08 Everyday spender | category ${pair("chooses:awareness:everyday spender", "category")} | named ${pair("chooses:awareness:everyday spender", "named")} | recommended ${pair("chooses:awareness:everyday spender", "recommended")}`);
      mockupLines.push(`P09 All | ${(st("chooses:criteria:all", "taught")?.items ?? []).map((i) => `${i.label} ${i.num.value}`).join(", ")}`);
      mockupLines.push(`P10 | ${segs("settled:settled:expansion", "stance")}`);
      mockupLines.push(`P12 | ${segs("settled:settled:business case", "strength")} | ${(P("settled:settled:business case")?.lines ?? []).map((l) => l.value.map((x) => x.t).join("")).join(" ")}`);
      const ov = (id: string, k: string) => `${v(st(id, k)?.here)} / ${v(st(id, k)?.usual)}`;
      mockupLines.push(`P13 Popular | named ${ov("chooses:social:all", "named")} | recommended ${ov("chooses:social:all", "recommended")} | one pick ${ov("chooses:social:all", "commits")}`);
      mockupLines.push(`P14 Learning | any brand ${ov("chooses:explainer:all", "anybrand")} | named ${ov("chooses:explainer:all", "named")} | named when any ${ov("chooses:explainer:all", "namedwhen")}`);
      mockupLines.push(`P16 Alongside | ${(st("settled:settled:ecosystem", "alongside")?.items ?? []).map((i) => `${i.label} ${i.num.value}`).join(", ")} | ${(st("settled:settled:ecosystem", "alongside")?.note ?? []).map((x) => x.t).join("")}`);
      mockupLines.push(`P17 Critic | ${segs("settled:settled:advocacy", "strength")} | premise ${segs("settled:settled:advocacy", "premise")} | ${(st("settled:settled:advocacy", "premise")?.note ?? []).map((x) => x.t).join("")}`);
      const co = ((view as { rivalPanels?: RivalAcross[] }).rivalPanels ?? []).find((r) => r.name === "Capital One");
      if (co) for (const stp of co.steps) mockupLines.push(`P15 Capital One | ${stp.label} | ${stp.bars.map((b) => `${b.name} ${b.num.value}`).join(" / ")}${stp.tag ? ` [${stp.tag}]` : ""}`);
      for (const id of ["chooses:social:all", "chooses:explainer:all", "settled:settled:ecosystem", "settled:settled:advocacy", "settled:settled:expansion", "settled:settled:business case"]) mockupLines.push(`claim ${id}: ${(P(id)?.claim ?? []).map((x) => x.t).join("")}`);
    }
  }

  const exp = EXPECTED[project.brand.toLowerCase()];
  if (exp && exp !== view.casting.archetype) failures.push(`${project.brand}: archetype ${view.casting.archetype}, expected ${exp}`);
}

console.log(`\n=================== WALL CALIBRATION (top-3 away groups per cell, n >= 5) ===================`);
for (const l of wallTable) console.log(l);

console.log(`\n=================== PANEL PAYLOAD (map JSON bytes) ===================`);
for (const l of payloadLines) console.log(l);
console.log(`\n=================== MOCKUP NUMBERS (American Express; here / your usual) ===================`);
for (const l of mockupLines) console.log(l);
console.log(`\n=================== RULING 5 OMISSIONS ===================`);
console.log(`tracker           | cell                                         | list      | code                         | share  | matched word     | via`);
for (const l of omissionLines) console.log(l);

/* -- am31: the question-label validator (question_labels.ts), unit style -- */
{
  const { validateLabel } = await import(process.cwd() + "/src/lib/engine/question_labels.ts");
  const ctx = { brandForms: ["Acme Brand", "acme"], otherBrands: ["Rivalco"] };
  const cases: [string, boolean][] = [
    ["which of your products people pick most when they want something simple", true],
    ["how to answer someone who says your product is hard to use", true],
    ["which acme product to choose", false],
    ["whether Rivalco beats you", false],
    ["which plan fits 3 people", false],
    ["which one of your many products is the best one to choose for a busy family on a budget", false],
    ["tell me which product to choose", false],
    ['which "best" product to choose', false],
    ["which product - yours or another", false],
    ["Which product to choose", false],
    ["which product to choose?", false],
  ];
  for (const [label, okWant] of cases) {
    const why = validateLabel(label, ctx);
    if (!why !== okWant) failures.push(`question label validator: "${label}" ${okWant ? `rejected (${why})` : "accepted"}`);
  }
  // A buyer's question never mentions the brand: no "you" there; nobody speaks as the asker.
  const whoCases: [string, "buyer" | "customer", boolean][] = [
    ["which products people recommend most", "buyer", true],
    ["which product you recommend most", "buyer", false],
    ["what kinds of product exist and whether you need one", "buyer", false],
    ["what to pair with your product", "customer", true],
    ["what to pair with my product", "customer", false],
  ];
  for (const [label, who, okWant] of whoCases) {
    const why = validateLabel(label, ctx, who);
    if (!why !== okWant) failures.push(`question label validator (${who}): "${label}" ${okWant ? `rejected (${why})` : "accepted"}`);
  }
  console.log(`QUESTION LABEL VALIDATOR: ${cases.length} cases checked`);
}

console.log(`\n=================== INVARIANTS ===================`);
if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exitCode = 1;
} else console.log("ALL PASS");
