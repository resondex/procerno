/**
 * Zero-spend test of the panels' grouped-reasons path (am31, PANEL_BUILD_SPEC
 * section 8, E10): the fixture is keyless, so the map never builds the run's
 * reason themes and every panel there reads flat condition groups. This test
 * drives the themed path in memory:
 *
 *   npx tsx scripts/panel_synthetic_test.mts
 *
 * Loads the American Express fixture ViewData (sqlite, keys blanked), deep-
 * copies three cells' answers (expansion, a what-to-buy buying situation, your
 * customers looking around), injects decision rules made from each answer's
 * own coded arguments (toward, away to an active rival, and an "elsewhere"
 * destination), builds the rules capture and a synthetic two-level ThemeMap
 * over those groups, then runs themedConds + buildPanels and asserts: grouped
 * rows, every share over ALL the cell's answers, every example answer states
 * the row's rule, the "elsewhere" rows are present, toward and away never share
 * an example, and nothing was written to the database (no model call is
 * possible: every key is blank).
 */
import type { PanelCondition, PositionPanel } from "../src/lib/engine/analysis_types";
import type { PoolRow } from "../src/lib/engine/view_data";
import type { RuleGroup } from "../src/lib/engine/rules_explorer";
import type { AnswerRules, ThemeMap } from "../src/lib/engine/reason_themes";
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
process.env.RUN_COLLECT_ONLY = "1";

const fs = await import("node:fs");
const { createHash } = await import("node:crypto");
const dbPath = process.env.SQLITE_PATH!;
const hashDb = () => createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex");
const before = hashDb();

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { loadViewData, poolOf } = await import(process.cwd() + "/src/lib/engine/view_data.ts");
const { buildResolver } = await import(process.cwd() + "/src/lib/engine/brand_resolve.ts");
const { famTokens } = await import(process.cwd() + "/src/lib/engine/brand_family.ts");
const { EVERY_BUYER, slKey } = await import(process.cwd() + "/src/lib/engine/reason_themes.ts");
const { buildPanels, themedConds, knOf } = await import(process.cwd() + "/src/lib/engine/panel_build.ts");
const { productNoun, pluralNoun } = await import(process.cwd() + "/src/lib/engine/panel_text.ts");
const { wordingIndex } = await import(process.cwd() + "/src/lib/engine/panel_filter.ts");

const failures: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) failures.push(msg);
};

const project = (await store.listProjects()).find((p: { brand: string; archived_at?: string | null }) => !p.archived_at && p.brand === "American Express");
if (!project) throw new Error("fixture: American Express not found");
const run = (await store.listRuns(project.id))[0];
const data = await loadViewData(run, project, { setupDecision: true, judge: true });
if (!data) throw new Error("fixture: no view data");
const resolve = buildResolver(data.dictionary, data.judged);
const targetKey = resolve(project.brand).key;
const rival = "Chase";
if (resolve(rival).status !== "active") throw new Error(`fixture: ${rival} is not an active brand`);
const ELSEWHERE = "a separate card in their own name";

/* -- the panel helpers, as the map hands them over (a test-local copy of the definitions) -- */
const pickOf = (r: PoolRow) => {
  const c = r.code;
  if (c.outcome === "pick" && c.top_pick) {
    const x = resolve(c.top_pick);
    return { status: x.status, key: x.key, name: x.name };
  }
  return { status: "none", key: null, name: null };
};
const recommendsOf = (r: PoolRow) => {
  const out = new Map<string, string>();
  for (const m of r.code.mentions ?? []) {
    if (m.framing !== "recommended") continue;
    const x = resolve(m.brand);
    if (x.status === "active") out.set(x.key, x.name);
  }
  return out;
};
const brandTokens = new Set<string>(famTokens(project.brand));
const helpers = {
  brand: project.brand,
  targetKey,
  category: project.category,
  noun: productNoun(project.category),
  plural: pluralNoun(project.category),
  resolve,
  pickOf,
  recommendsOf,
  namesTarget: (r: PoolRow) => (r.code.mentions ?? []).some((m) => resolve(m.brand).key === targetKey) || pickOf(r).key === targetKey,
  quoteOf: (r: PoolRow) => (r.code.quote ?? r.code.premise_quote ?? "").trim(),
  brandSplit: (rows: PoolRow[]) => {
    const inCat = rows.filter((r) => pickOf(r).status === "active");
    const by = new Map<string, { key: string; name: string; rows: PoolRow[] }>();
    for (const r of inCat) {
      const p = pickOf(r);
      const t = by.get(p.key!) ?? { key: p.key!, name: p.key === targetKey ? project.brand : p.name!, rows: [] };
      t.rows.push(r);
      by.set(p.key!, t);
    }
    return { n: inCat.length, list: [...by.values()].sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)) };
  },
  activeDests: (list: string[] | null) => {
    const out = new Map<string, string>();
    for (const d of list ?? []) {
      const x = resolve(d);
      if (x.status === "active" && x.key !== targetKey) out.set(x.key, x.name);
    }
    return out;
  },
  productOf: (card: string) => (resolve(card).key === targetKey && famTokens(card).some((t: string) => !brandTokens.has(t)) ? card : null),
  valueFacts: new Map(),
  headline: [] as PoolRow[],
  reasonLift: [],
  wordings: () => wordingIndex([]),
  scopes: new Map<string, string>(),
};

/**
 * One cell, themed: deep-copied answers with injected rules. Each answer
 * states one toward rule, one away rule (to the rival) and, every third
 * answer, one "elsewhere" rule - the conditions are worded from the answer's
 * own coded arguments, so every rule is the answer's own.
 */
function themedCell(id: string, kind: string, rows0: PoolRow[], towardChoice: string) {
  const rows: PoolRow[] = rows0.map((r) => ({ ...r, code: JSON.parse(JSON.stringify(r.code)) }));
  const groups = new Map<string, { label: string; side: "you" | "away" | "elsewhere"; theme: number }>();
  const cellAnswers = new Map<string, Map<string, Set<string>>>();
  const answerRules: AnswerRules = new Map();
  const ruled = new Map<string, Set<string>>();
  const add = (side: "you" | "away" | "elsewhere", label: string, theme: number, r: PoolRow, to: string[], card: string, cardTo: string | null) => {
    const gid = `${side}:${label}`;
    if (!groups.has(gid)) groups.set(gid, { label, side, theme });
    const per = cellAnswers.get(gid) ?? new Map<string, Set<string>>();
    const set = per.get(r.intent.id) ?? new Set<string>();
    set.add(r.code.response_id);
    per.set(r.intent.id, set);
    cellAnswers.set(gid, per);
    const ar = answerRules.get(gid) ?? new Map();
    ar.set(r.code.response_id, { said: label, to, model: r.model, intent: r.intent.id, cards: card ? [card] : [], cardTo: card ? [cardTo] : [], mixed: 1 });
    answerRules.set(gid, ar);
    ruled.set(r.code.response_id, new Set([...(ruled.get(r.code.response_id) ?? []), label]));
  };
  rows.forEach((r, i) => {
    const codes = r.code.reasons?.length ? r.code.reasons : ["the basics"];
    const tLabel = `values ${codes[0]}`;
    const aLabel = `cares most about ${codes[codes.length - 1]}`;
    add("you", tLabel, i % 2, r, [], towardChoice, null);
    add("away", aLabel, i % 2, r, [rival], `${rival} card`, rival);
    if (i % 3 === 0) add("elsewhere", `would rather keep things ${i % 2 ? "simple" : "separate"}`, 0, r, [], ELSEWHERE, null);
    r.code.decision_rules = [
      { condition: tLabel, choice: towardChoice },
      { condition: aLabel, choice: rival },
      ...(i % 3 === 0 ? [{ condition: `would rather keep things ${i % 2 ? "simple" : "separate"}`, choice: ELSEWHERE }] : []),
    ];
  });
  const poolOfSide = (side: string) => [...groups.entries()].filter(([, g]) => g.side === side).map(([gid, g]) => ({ id: gid, label: g.label }) as unknown as RuleGroup);
  // The synthetic two-level map: each label its own situation theme; totals by parity.
  const mapOf = (side: string): ThemeMap => {
    const stOf = new Map<string, number>();
    const stName: string[] = [];
    const stSit: string[] = [];
    const totOf: number[] = [];
    for (const [, g] of [...groups.entries()].filter(([, x]) => x.side === side)) {
      const sit = EVERY_BUYER;
      for (const r of rows) stOf.set(slKey(r.intent.situation || sit, g.label), stName.length);
      stName.push(g.label);
      stSit.push(sit);
      totOf.push(g.theme);
    }
    return { stOf, stName, stSit, totOf, totName: side === "you" ? ["Grouped toward one", "Grouped toward two"] : ["Grouped away one", "Grouped away two"] };
  };
  const sitOf = new Map(rows.map((r) => [r.intent.id, r.intent.situation || EVERY_BUYER]));
  const cellIntents = new Set(rows.map((r) => r.intent.id));
  const conds = themedConds({
    towardPool: poolOfSide("you"),
    awayPool: poolOfSide("away"),
    elsewherePool: poolOfSide("elsewhere"),
    toward: mapOf("you"),
    away: mapOf("away"),
    cellAnswers,
    answerRules,
    sitOf,
    cellIntents,
    inCell: new Set(rows.map((r) => r.code.response_id)),
    pairs: [],
    bearing: rows.length,
    own: project.brand,
  });
  const input = {
    id,
    kind,
    row: id.split(":")[1],
    key: id.split(":").slice(2).join(":"),
    label: rows[0]?.intent.situation ?? "",
    pooled: false,
    rows,
    you: [],
    them: [],
    cellIntents,
    conds,
    lifts: [],
  };
  const panel = buildPanels(new Map([[id, input]]), helpers).get(id) as PositionPanel | undefined;
  return { rows, panel, ruled, elsewhere: [...groups.values()].filter((g) => g.side === "elsewhere").map((g) => g.label) };
}

function check(name: string, t: ReturnType<typeof themedCell>) {
  const { rows, panel, ruled, elsewhere } = t;
  ok(!!panel, `${name}: no panel`);
  const c = panel?.conditions;
  ok(!!c, `${name}: no conditions block`);
  if (!panel || !c) return;
  ok(c.grouped === true, `${name}: grouped is not true`);
  ok(c.toward.length > 0 && c.away.length > 0, `${name}: a side has no rows`);
  const all = rows.length;
  const rowsOf = (list: PanelCondition[]) => list;
  for (const side of ["toward", "away"] as const)
    for (const row of rowsOf(c[side])) {
      const kn = knOf(row.share);
      ok(!!kn && kn.n === all, `${name}: ${side} "${row.text}" share is over ${kn?.n}, not all ${all} answers`);
      ok(row.share.tip === `${kn?.k} of ${all} answers`, `${name}: ${side} "${row.text}" tip ${row.share.tip}`);
      ok((row.share.refs?.length ?? 0) > 0, `${name}: ${side} "${row.text}" has no example answers`);
      for (const r of row.share.refs ?? []) ok(!!ruled.get(r.responseId)?.has(r.find), `${name}: ${side} "${row.text}" example ${r.responseId.slice(0, 8)} does not state "${r.find}"`);
    }
  const towardIds = new Set(c.toward.flatMap((x) => (x.share.refs ?? []).map((r) => r.responseId)));
  for (const x of c.away) for (const r of x.share.refs ?? []) ok(!towardIds.has(r.responseId), `${name}: answer ${r.responseId.slice(0, 8)} shown on both sides`);
  // am37: rows are shown in sentence case; the group labels are matched case-blind.
  const awayTexts = new Set(c.away.map((x) => x.text.toLowerCase()));
  ok(elsewhere.some((e) => awayTexts.has(e.toLowerCase())), `${name}: no "elsewhere" row among the away rows (${[...awayTexts].join(" | ")})`);
  ok(c.away.some((x) => x.text.startsWith("Grouped away")), `${name}: no themed away row`);
  const themedAway = c.away.find((x) => x.text.startsWith("Grouped away"));
  ok(!!themedAway?.to?.some((x) => x.name === rival), `${name}: the themed away row does not name ${rival} as its destination`);
  // am38: "What the answer weighs" is a sized block, never a line; unsided rows are shares of all the cell's answers.
  ok(!(panel.lines ?? []).some((l) => /what the answer weighs/i.test(l.label)), `${name}: a "What the answer weighs" line is still drawn`);
  for (const w of [panel.weighs, panel.weighsComp]) {
    if (!w) continue;
    for (const col of w.columns) {
      ok(col.rows.length <= 3, `${name}: weighs column lists ${col.rows.length} topics`);
      ok(col.rows.length > 0 || !!col.note, `${name}: weighs column has no rows and no note`);
      for (const r of col.rows) {
        const kn = knOf(r.num);
        ok(!!kn && kn.k >= 3, `${name}: weighs row "${r.name}" rests on ${kn?.k} answers`);
        if (w.columns.length === 1) ok(kn?.n === all, `${name}: weighs row "${r.name}" is over ${kn?.n}, not all ${all} answers`);
      }
    }
  }
  if ((panel.kind === "buy" || panel.kind === "looking_around") && rows.filter((r) => r.code.reasons !== null).length >= 10) ok(!!panel.weighs, `${name}: answers carry topics but no weighs block`);
  console.log(`${name}: ${all} answers | toward ${c.toward.map((x) => `${x.text} ${x.share.value}`).join(", ")} | away ${c.away.map((x) => `${x.text} ${x.share.value}`).join(", ")}`);
}

const pool = (v: string) => poolOf(data, v).rows as PoolRow[];
const expansion = pool("settled_expansion");
const buy = pool("headline").filter((r) => r.intent.situation === "Everyday spender" && (r.intent.stage === "discovery" || r.intent.stage === "use_case"));
const hold = pool("defensive_hold");
ok(expansion.length > 0 && buy.length > 0 && hold.length > 0, "fixture: a pool is empty");

const exp = themedCell("settled:settled:expansion", "expansion", expansion, project.brand);
check("expansion", exp);
ok(exp.panel?.conditions?.towardTitle === "Go ahead if" && exp.panel?.conditions?.awayTitle === "Hold back if", "expansion: titles");
const b = themedCell("chooses:open:everyday spender", "buy", buy, project.brand);
check("buy", b);
const hl = themedCell("doubts:hold:all", "looking_around", hold, "keep");
check("looking_around", hl);
ok(hl.panel?.conditions?.toWord === "Shown", "looking_around: destinations read Shown");

// What to use alongside you (ecosystem): grouped, the away side neutral, destinations read off the products the rules name.
const eco = pool("settled_ecosystem");
ok(eco.length > 0, "fixture: no ecosystem answers");
const al = themedCell("settled:settled:ecosystem", "alongside", eco, project.brand);
{
  const c = al.panel?.conditions;
  ok(!!c, "alongside: no conditions block");
  if (c) {
    ok(c.grouped === true, "alongside: grouped is not true");
    ok(c.neutralAway === true, "alongside: the away column is not neutral");
    ok(c.title === "Which one it picks, and when", "alongside: title");
    for (const side of ["toward", "away"] as const)
      for (const row of c[side]) {
        const kn = knOf(row.share);
        ok(!!kn && kn.n === eco.length, `alongside: ${side} "${row.text}" share is not over all answers`);
        for (const r of row.share.refs ?? []) ok(!!al.ruled.get(r.responseId)?.has(r.find), `alongside: ${side} "${row.text}" example does not state its rule`);
      }
    const ew = c.away.find((x) => al.elsewhere.some((e) => e.toLowerCase() === x.text.toLowerCase()));
    ok(!!ew?.to?.some((x) => x.name === ELSEWHERE), `alongside: the elsewhere row does not lead to "${ELSEWHERE}" (${JSON.stringify(ew?.to?.map((x) => x.name))})`);
    console.log(`alongside: toward ${c.toward.map((x) => `${x.text} ${x.share.value}`).join(", ")} | away ${c.away.map((x) => `${x.text} ${x.share.value} -> ${(x.to ?? []).map((t) => t.name).join("/")}`).join(", ")}`);
  }
}

// Question labels (zero spend): a stubbed model - a valid label lands in the claim; an invalid one falls back to the quoted seed.
{
  const { questionLabels, validateLabel } = await import(process.cwd() + "/src/lib/engine/question_labels.ts");
  const seed = eco[0].intent.text;
  const lctx = { projectId: project.id, brand: project.brand, category: project.category, noun: helpers.noun, brandForms: [project.brand, "amex"], otherBrands: [rival] };
  const ask = [{ id: "settled:settled:ecosystem", seed, who: "customer" as const }];
  const good = "what to use alongside your card when booking trips";
  const calls: string[] = [];
  const stubGood = async (_s: string, u: string) => (calls.push(u), JSON.stringify({ label: good }));
  const r1 = await questionLabels(ask, lctx, { call: stubGood, keyed: true, noCache: true });
  ok(r1.asked.get(ask[0].id) === good && !r1.fallback.size && !r1.incomplete, `labels: a valid label did not land (${r1.asked.get(ask[0].id)})`);
  const stubBad = async () => JSON.stringify({ label: `Which ${project.brand} card to use - 2 options` });
  const r2 = await questionLabels(ask, lctx, { call: stubBad, keyed: true, noCache: true });
  ok(r2.asked.get(ask[0].id) === `"${seed.trim()}"` && r2.fallback.has(ask[0].id) && r2.incomplete, `labels: an invalid label did not fall back (${r2.asked.get(ask[0].id)})`);
  let n = 0;
  const stubRetry = async (_s: string, u: string) => (n++ === 0 ? JSON.stringify({ label: "Tell me which card" }) : (calls.push(u), JSON.stringify({ label: good })));
  const r3 = await questionLabels(ask, lctx, { call: stubRetry, keyed: true, noCache: true });
  ok(r3.asked.get(ask[0].id) === good && calls.some((u) => u.includes("Your last label broke this rule")), "labels: the retry did not name the failed rule or did not land");
  const r4 = await questionLabels(ask, lctx, { call: stubGood, keyed: false, noCache: true });
  ok(r4.asked.get(ask[0].id) === `"${seed.trim()}"` && !r4.incomplete, "labels: keyless is the quoted form and complete");
  ok(validateLabel(good, lctx) === null, "labels: the good label fails the validator");
  // The label lands in the claim.
  const rows = eco.map((r) => ({ ...r, code: JSON.parse(JSON.stringify(r.code)) }));
  const inp = { id: "settled:settled:ecosystem", kind: "alongside", row: "settled", key: "ecosystem", label: "Ecosystem", pooled: false, rows, you: [], them: [], cellIntents: new Set(rows.map((r) => r.intent.id)), conds: { toward: [], away: [], bearing: 0, grouped: false }, lifts: [], asked: r1.asked.get(ask[0].id) };
  const pnl = buildPanels(new Map([[inp.id, inp]]), helpers).get(inp.id) as PositionPanel | undefined;
  const claimText = (pnl?.claim ?? []).map((x) => x.t).join("");
  ok(claimText.startsWith(`When a customer asks ${good}, the AI`), `labels: the claim does not carry the label (${claimText})`);
  const inp2 = { ...inp, asked: r2.asked.get(ask[0].id) };
  const p2 = buildPanels(new Map([[inp2.id, inp2]]), helpers).get(inp2.id) as PositionPanel | undefined;
  ok((p2?.claim ?? []).map((x) => x.t).join("").includes(`"${seed.trim()}"`), "labels: the fallback claim does not quote the seed");
  console.log(`labels: valid -> "${claimText.slice(0, 110)}" | invalid -> quoted seed`);
}

// Nothing written, nothing called.
ok(hashDb() === before, "the fixture database changed");

if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exitCode = 1;
} else console.log("ALL PASS");
