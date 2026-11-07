/**
 * Zero-spend citation harness for the brief (brief.ts) against the analysis
 * map (analysis_map.ts) - the owner's ruling of 2026-11-06: every percentage
 * and signed point value visible in a brief must have a citation, a pin whose
 * card visibly states that number. bf14 (2026-11-07): the receipt is the pin's
 * ANSWER CARD (view.cards - cell, brand, engines or condition; cardText:
 * crumb, headline, row labels and values, never tips), not the map panel.
 *
 *   npx tsx scripts/brief_citation_harness.mts [brand substring] [--verbose] [--all-subjects]
 *
 * Runs against the dashboard fixture ONLY (the procerno-fixture launch
 * config's env, set BEFORE the store loads): DATABASE_URL blanked,
 * SQLITE_PATH at data/dashboard_fixture.db, every API key blanked,
 * RUN_COLLECT_ONLY=1 - no model call and no prod read is possible.
 *
 * For every tracker: the target subject and the first rival subject (every
 * selectable subject with --all-subjects), all
 * seven frames, composed memos. Units are paragraphs (section paras and
 * quadrant cells) and rows (label + value); tips, tables and charts are not
 * units (tips carry counts; tables and charts carry no pins). Asserts:
 *   (a) RULE 1 - no surviving pin on a numbered unit shares zero numbers
 *       with its card (and every pin has a card in view.cards);
 *   (b) RULE 2 - every number token in a unit's visible text appears in at
 *       least one of that unit's surviving pins' cards.
 * Prints every violation (tracker / subject / frame / section / unit /
 * number) and exits non-zero on any.
 */
const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = REPO + "/data/dashboard_fixture.db";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
process.env.RUN_COLLECT_ONLY = "1";

const { store } = await import(REPO + "/src/lib/store/index.ts");
const { loadViewData } = await import(REPO + "/src/lib/engine/view_data.ts");
const { computeBrief, briefNumberTokens } = await import(REPO + "/src/lib/engine/brief.ts");
const { cardText } = await import(REPO + "/src/lib/engine/answer_cards.ts");

type Anchor = { id: string; label: string };
type Para = { lead?: string; text: string; cells?: Anchor[] };
type Row = { label: string; value: string; cell?: Anchor };

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const allSubjects = args.includes("--all-subjects");
const want = (args.find((a) => !a.startsWith("--")) ?? "").toLowerCase();
const projects = (await store.listProjects()).filter((p: { brand: string; archived_at?: string | null }) => !p.archived_at && p.brand.toLowerCase().includes(want));

let units = 0;
let numbered = 0;
let tokens = 0;
let pins = 0;
const rule1: string[] = [];
const rule2: string[] = [];
const missing: string[] = [];

for (const project of projects) {
  const run = (await store.listRuns(project.id))[0];
  if (!run) continue;
  const data = await loadViewData(run, project, { setupDecision: true, judge: true });
  if (!data) continue;
  const first = await computeBrief(data, {});
  const subjects = (allSubjects ? [undefined, ...first.subjects.slice(1)] : [undefined, first.subjects[1]]).filter((x, i) => i === 0 || !!x) as (string | undefined)[];
  for (const subject of subjects) {
    const view = subject ? await computeBrief(data, { subject }) : first;
    const cardTokens = new Map<string, Set<string>>();
    const tokOf = (id: string) => {
      let t = cardTokens.get(id);
      if (!t) {
        const card = view.cards?.[id];
        if (!card) missing.push(`${project.brand}${subject ? ` [rival ${subject}]` : ""} pin=${id} has no card`);
        t = card ? briefNumberTokens(cardText(card)) : new Set<string>();
        cardTokens.set(id, t);
      }
      return t;
    };
    const who = `${project.brand}${subject ? ` [rival ${subject}]` : ""}`;
    for (const [frame, memo] of Object.entries(view.memos) as [string, { sections: { key: string; paras?: Para[]; rows?: Row[]; quads?: { headers: [string, string]; cells: [Para[], Para[]] }[] }[] }][]) {
      for (const s of memo.sections) {
        const list: { where: string; visible: string; ids: string[] }[] = [];
        for (const p of s.paras ?? []) list.push({ where: s.key, visible: `${p.lead ?? ""} ${p.text}`, ids: (p.cells ?? []).map((c) => c.id) });
        for (const q of s.quads ?? [])
          q.cells.forEach((col, i) => {
            for (const p of col) list.push({ where: `${s.key}/${q.headers[i]}`, visible: `${p.lead ?? ""} ${p.text}`, ids: (p.cells ?? []).map((c) => c.id) });
          });
        for (const r of s.rows ?? []) list.push({ where: `${s.key}/row`, visible: `${r.label} ${r.value}`, ids: r.cell ? [r.cell.id] : [] });
        for (const u of list) {
          units++;
          pins += u.ids.length;
          for (const id of u.ids) tokOf(id); // every pin, numbered or not, must have its card
          const nums = briefNumberTokens(u.visible);
          if (nums.size === 0) continue;
          numbered++;
          tokens += nums.size;
          const head = `${who} [${frame}/${u.where}]`;
          const said = u.visible.trim().replace(/\s+/g, " ").slice(0, 160);
          for (const id of u.ids) {
            const t = tokOf(id);
            if (![...nums].some((n) => t.has(n))) rule1.push(`${head} pin=${id} shares none of ${[...nums].join(" ")}\n     "${said}"`);
          }
          for (const n of nums) {
            const by = u.ids.filter((id) => tokOf(id).has(n));
            if (!by.length) rule2.push(`${head} ${n} uncited (pins: ${u.ids.join(", ") || "none"})\n     "${said}"`);
            else if (verbose) console.log(`ok ${head} ${n} <- ${by.join(", ")}`);
          }
        }
      }
    }
  }
}

console.log(`\nunits ${units}, numbered ${numbered}, number tokens ${tokens}, pins ${pins}`);
if (rule1.length) {
  console.log(`\nRULE 1 - pins sharing no number with their unit: ${rule1.length}`);
  for (const l of rule1) console.log("  " + l);
}
if (rule2.length) {
  console.log(`\nRULE 2 - number tokens with no citing pin: ${rule2.length}`);
  for (const l of rule2) console.log("  " + l);
}
if (missing.length) {
  console.log(`\nPins with no card in view.cards: ${missing.length}`);
  for (const l of [...new Set(missing)]) console.log("  " + l);
}
const bad = rule1.length + rule2.length + missing.length;
console.log(bad ? `\nFAIL: rule 1 ${rule1.length}, rule 2 ${rule2.length}, cardless pins ${missing.length}` : "\nALL PASS - every visible number is cited by a card");
process.exit(bad ? 1 : 0);
