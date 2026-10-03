/**
 * RESOLVER VALIDATION (2026-10-02, Tyler's plan step 2): does the extended
 * design-check verdict (DESIGN_CHECK_SYSTEM_V2) + brand_resolver do the
 * jobs the string checks do - brand naming, stated prices, money remarks,
 * client eligibility - at least as well, with zero missed target leaks?
 *
 * Phases (each writes JSONL to OUT and resumes from it; local sqlite store
 * under OUT, so no prod reads or writes):
 *   dry   - assemble the corpus, run the OLD (string) path, print counts and
 *           the cost estimate. No API calls.
 *   run   - arm A: V2 sonnet-5 low on every selected text; V1 on a 600-text
 *           subset (does the extended prompt keep the voices_design
 *           judgment?); arm B: V2 sonnet-5 at default effort on 500 seeds
 *           (seed-tier question). Dictionary aliases per roster (gpt-6-luna).
 *   adjudicate - Opus 5.5 (medium) truth on every old/new disagreement, a
 *           seeded random 300 of the agreements (shared misses), and every
 *           fleet case. Scored on the RESOLVED output, never the raw list.
 *   report - metrics + the shadow-exit numbers.
 * Spends money in run/adjudicate - Tyler's go per run.
 *
 * Usage: OUT=<dir> npx tsx scripts/resolver_validation.mts dry|run|adjudicate|report
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(new URL(".", import.meta.url).pathname, "..");
const OUT = process.env.OUT ?? path.join(REPO, ".resolver_validation");
const PHASE = process.argv[2] ?? "dry";
fs.mkdirSync(OUT, { recursive: true });
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.DATABASE_URL; // local sqlite under OUT
process.chdir(OUT);

const bc = await import(`${REPO}/src/lib/engine/battery_checks.ts`);
const inst = await import(`${REPO}/src/lib/engine/instrument.ts`);
const { resolveNamedBrands } = await import(`${REPO}/src/lib/engine/brand_resolver.ts`);
const { brandAliasForms } = await import(`${REPO}/src/lib/engine/brand_aliases.ts`);
const { anthropicClient } = await import(`${REPO}/src/lib/engine/providers.ts`);
const { firstJsonObject } = inst;

const HOME = process.env.HOME!;
const SCRATCH_ROOT = "/private/tmp/claude-501/-Users-tylersolloway-Documents-GitHub-procerno";
const V02 = `${HOME}/Documents/procerno_eval/labeling/v02_relabel`;
const key = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const readJ = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeL = (f: string, rows: unknown[]) => fs.writeFileSync(path.join(OUT, f), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const readL = (f: string) => fs.existsSync(path.join(OUT, f)) ? fs.readFileSync(path.join(OUT, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

// ------------------------------------------------------------- corpus
interface Item {
  id: string; source: "walk" | "walk_old" | "live" | "rejected" | "fleet";
  tracker: string; category: string; competitors: string[];
  stage: string; angle: string; concern: string | null; situation: string | null;
  text: string; truth?: { brands: string[]; statesPrice: boolean; moneyRemark: boolean; excludesClient: boolean };
}
const TRACKERS: Record<string, { name: string; category: string; base: string[] }> = {
  jira: { name: "Jira", category: "project management software", base: ["Asana", "monday.com", "Linear", "ClickUp"] },
  american_express: { name: "American Express", category: "credit cards", base: ["Chase", "Capital One", "Citi", "Discover"] },
  netflix: { name: "Netflix", category: "streaming video services", base: ["Hulu", "Disney+", "Amazon Prime Video", "Max (HBO)"] },
  google_pixel: { name: "Google Pixel", category: "smartphones", base: ["Apple iPhone", "Samsung Galaxy", "OnePlus", "Xiaomi"] },
};
const SLUG: Record<string, string> = { jira: "jira", Jira: "jira", "American Express": "american_express", Netflix: "netflix", "Google Pixel": "google_pixel" };

function assemble(): Item[] {
  const items: Item[] = [];
  const seen = new Set<string>();
  const push = (it: Item) => { const k = `${it.tracker}|${it.text.trim()}`; if (seen.has(k) || !it.text.trim()) return; seen.add(k); items.push(it); };
  // fleet (out-of-sample rosters) first
  for (const c of readJ(`${REPO}/scripts/fixtures/resolver_fleet_cases.json`))
    push({ id: c.id, source: "fleet", tracker: c.tracker, category: c.category, competitors: c.competitors, stage: c.stage,
      angle: c.stage === "comparison" ? (c.truth.brands.find((b: string) => b !== c.tracker) ?? "generic") : c.stage === "alternatives" ? (c.truth.brands[0] ?? "generic") : "generic",
      concern: c.concern, situation: null, text: c.text, truth: c.truth });
  // walk seeds with their own context (this session + earlier sessions)
  const dirs: string[] = [];
  for (const sess of fs.readdirSync(SCRATCH_ROOT)) {
    const sp = path.join(SCRATCH_ROOT, sess, "scratchpad");
    if (!fs.existsSync(sp)) continue;
    const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.isDirectory()) walk(path.join(d, f.name)); else if (/seeds_.*\.json$/.test(f.name)) dirs.push(path.join(d, f.name)); } };
    walk(sp);
  }
  for (const f of dirs) {
    const slug = Object.keys(TRACKERS).find((s) => f.includes(s));
    if (!slug) continue;
    const ctxF = f.replace(/cold_seeds_/, "cold_context_").replace(/(^|\/)seeds_/, "$1context_");
    const ctx = fs.existsSync(ctxF) ? readJ(ctxF) : null;
    const T = TRACKERS[slug];
    const roles: Record<string, string> = ctx?.rosterRoles ?? {};
    const comps: string[] = ctx ? ctx.profile.competitors.filter((c: string) => roles[c] !== "upstream") : T.base;
    let rows: any[];
    try { rows = readJ(f); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const s of rows) if (s && typeof s.text === "string" && s.stage)
      push({ id: `${path.basename(path.dirname(f))}/${path.basename(f)}#${s.i ?? 0}`, source: ctx ? "walk" : "walk_old", tracker: T.name,
        category: ctx?.profile?.category ?? T.category, competitors: comps, stage: s.stage, angle: s.angle ?? "generic",
        concern: s.concern ?? null, situation: s.situation ?? null, text: s.text });
  }
  // the fixed live battery
  for (const p of readJ(`${V02}/prompt_stages.json`)) {
    const slug = SLUG[p.brand]; if (!slug || !p.stage) continue;
    const T = TRACKERS[slug];
    push({ id: `live/${p.id}`, source: "live", tracker: T.name, category: T.category, competitors: T.base, stage: p.stage,
      angle: p.angle ?? "generic", concern: null, situation: null, text: p.text });
  }
  // the rejected corpus
  for (const p of [...readJ(`${V02}/rewrite_worksheet.json`), ...readJ(`${V02}/g3_worksheet.json`)]) {
    const slug = SLUG[p.project]; if (!slug || !p.stage) continue;
    const T = TRACKERS[slug];
    push({ id: `rejected/${p.id}`, source: "rejected", tracker: T.name, category: T.category, competitors: T.base, stage: p.stage,
      angle: "generic", concern: null, situation: null, text: p.text });
  }
  return items;
}

// seeded RNG (mulberry32) so the selection and samples are reproducible
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = <T,>(a: T[], seed: number) => { const r = rng(seed); const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/** "Informative" texts: any lowercase or capitalized occurrence of a roster
 * word, a currency/price-like figure, or a money word - where the two
 * paths can actually differ. Everything informative is kept; the rest is
 * sampled. */
function informative(it: Item): boolean {
  const words = [it.tracker, ...it.competitors].flatMap((b) => key(b.replace(/\s*\([^)]*\)/g, "")).split(" ").filter((w) => w.length >= 3));
  const t = key(it.text);
  if (words.some((w) => new RegExp(`\\b${w}s?\\b`).test(t))) return true;
  return /\$|\d+\s*(?:a month|\/mo|per month)|\b(?:cheap|money|pay|paying|price|cost|fee|worth|financial)/i.test(it.text);
}

function select(all: Item[]): Item[] {
  const keep = (src: Item["source"]) => all.filter((x) => x.source === src);
  const sample = (xs: Item[], n: number, seed: number) => shuffle(xs, seed).slice(0, n);
  const live = keep("live"), old = keep("walk_old");
  return [
    ...keep("fleet"), ...keep("rejected"), ...keep("walk"),
    ...live.filter(informative), ...sample(live.filter((x) => !informative(x)), 150, 1),
    ...old.filter(informative).slice(0, 600), ...sample(old.filter((x) => !informative(x)), 150, 2),
  ];
}

// ------------------------------------------------------------- the two paths
const designLine = (it: Item) =>
  bc.stageDesignIntent(it.stage, it.tracker, it.concern, it.angle, it.situation) ??
  bc.seedDesignLine(it.stage, it.tracker, it.text, it.concern) ?? `Question design: a ${it.category} question.`;

interface Facts { leaked: string[]; missing: string[]; named: string[]; statesPrice: boolean; moneyBoltOn: boolean; excludesClient: boolean | null }

function oldPath(it: Item, aliases: Record<string, string[]>): Facts {
  const spec = bc.deriveCheckSpec({ stage: it.stage, angle: it.angle, text: it.text, concern: it.concern }, it.tracker, it.competitors, it.category, aliases);
  const sig = bc.checkCandidateSignature(it.text, spec, { category: it.category, extraForms: aliases });
  const excl = new Set(key(it.category).split(" ").filter(Boolean));
  const named = [it.tracker, ...it.competitors].filter((b) =>
    spec.requiredBrands.includes(b) ? bc.namesRequiredBrand(it.text, b, { extraForms: aliases[b], excludeTokens: excl })
      : bc.namesForbiddenBrand(bc.withoutOtherBrands(it.text, b, [it.tracker, ...it.competitors]), b, { extraForms: aliases[b], excludeTokens: excl, isTarget: b === it.tracker }));
  return { leaked: sig.leaked, missing: sig.missing, named, statesPrice: !!bc.statedPriceFinding(it.text), moneyBoltOn: bc.moneyBoltOn(it.text, it.concern), excludesClient: null };
}

function newPath(it: Item, v: any, aliases: Record<string, string[]>): Facts {
  const spec = bc.deriveCheckSpec({ stage: it.stage, angle: it.angle, text: it.text, concern: it.concern }, it.tracker, it.competitors, it.category, aliases);
  const roster = [it.tracker, ...it.competitors];
  const r = resolveNamedBrands(it.text, v.brandsNamed ?? [], roster, aliases);
  const nonPrice = !!it.concern && !bc.isPriceConcern(it.concern);
  return {
    leaked: spec.forbiddenBrands.filter((b: string) => r.brands.includes(b)),
    missing: spec.requiredBrands.filter((b: string) => !r.brands.includes(b)),
    named: r.brands, statesPrice: !!v.statesPrice, moneyBoltOn: nonPrice && !!v.moneyRemark, excludesClient: !!v.excludesClient,
  };
}

// ------------------------------------------------------------- phases
const all = assemble();
const sel = select(all);
const bySrc = (xs: Item[]) => Object.entries(xs.reduce((m: Record<string, number>, x) => ((m[x.source] = (m[x.source] ?? 0) + 1), m), {}));
const rosterKey = (it: Item) => [it.tracker, ...it.competitors].join("|");
const PER_CALL = { v2low: 0.008, v1low: 0.007, v2default: 0.016, opus: 0.012 };

async function aliasMap(items: Item[]): Promise<Map<string, Record<string, string[]>>> {
  const m = new Map<string, Record<string, string[]>>();
  for (const rk of new Set(items.map(rosterKey))) m.set(rk, PHASE === "dry" ? {} : await brandAliasForms(rk.split("|")));
  return m;
}

async function pool<T, R>(xs: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let k = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (k < xs.length) { const i = k++; out[i] = await f(xs[i], i); } }));
  return out;
}

if (PHASE === "dry") {
  const al = await aliasMap(sel);
  const old = sel.map((it) => oldPath(it, al.get(rosterKey(it))!));
  console.log("corpus (all):", JSON.stringify(bySrc(all)));
  console.log("selected:", sel.length, JSON.stringify(bySrc(sel)), "rosters:", al.size);
  console.log("old path (no aliases in dry): leaks", old.filter((o) => o.leaked.length).length, "missing", old.filter((o) => o.missing.length).length,
    "statesPrice", old.filter((o) => o.statesPrice).length, "moneyBoltOn", old.filter((o) => o.moneyBoltOn).length);
  const seeds = sel.filter((x) => x.source === "walk").length;
  const est = sel.length * PER_CALL.v2low + 600 * PER_CALL.v1low + Math.min(500, seeds) * PER_CALL.v2default + (300 + 400 + 80) * PER_CALL.opus;
  console.log(`estimate: arm A ${sel.length} x V2 low ~$${(sel.length * PER_CALL.v2low).toFixed(0)}, V1 subset 600 ~$${(600 * PER_CALL.v1low).toFixed(0)}, arm B ${Math.min(500, seeds)} x V2 default ~$${(Math.min(500, seeds) * PER_CALL.v2default).toFixed(0)}, adjudication ~780 x Opus ~$${(780 * PER_CALL.opus).toFixed(0)} => ~$${est.toFixed(0)}`);
  writeL("selected.jsonl", sel);
  process.exit(0);
}

if (PHASE === "run") {
  const al = await aliasMap(sel);
  writeL("aliases.jsonl", [...al.entries()].map(([k, v]) => ({ roster: k, aliases: v })));
  const verdict = async (it: Item, opts: { v2: boolean; effort?: string; model?: string }) =>
    (await inst.checkDesignFidelity({ candidates: [{ text: it.text, design: designLine(it), client: it.tracker }], v2: opts.v2, effort: opts.effort, model: opts.model }))[0];
  console.log(`arm A: V2 sonnet-5 low on ${sel.length}`);
  const a = await pool(sel, 16, async (it) => ({ id: it.id, v: await verdict(it, { v2: true }) }));
  writeL("armA_v2_low.jsonl", a);
  const sub = shuffle(sel, 3).slice(0, 600);
  console.log(`V1 subset: ${sub.length}`);
  writeL("v1_subset.jsonl", await pool(sub, 16, async (it) => ({ id: it.id, v: await verdict(it, { v2: false }) })));
  const seeds = shuffle(sel.filter((x) => x.source === "walk"), 4).slice(0, 500);
  console.log(`arm B: V2 sonnet-5 default effort on ${seeds.length} seeds`);
  writeL("armB_v2_default.jsonl", await pool(seeds, 12, async (it) => ({ id: it.id, v: await verdict(it, { v2: true, effort: "default" }) })));
  console.log("unchecked (failed) verdicts in arm A:", a.filter((x) => x.v.unchecked).length);
  process.exit(0);
}

const ADJ_SYSTEM = `You establish ground truth for survey-question checks. Judge only the question's own words, never what an answer might say. Given the tracked brands of one study and one question, report:
- named: which of the TRACKED brands the question names. A brand is named when the question refers to it - any spelling or case, nicknames, short forms ("amex"), or one of its product lines/models ("Galaxy S24" names Samsung Galaxy). An ordinary word that only looks like a brand in context ("the doorbell ring", "nothing fancy", "my bank", a color "purple") does NOT name it.
- states_price: the question itself states what a specific product, plan, tier or fee costs - or a price gap between products - as a fact. The asker's own spending, budget or bill, or a price/deal the asker says they were offered or quoted, does not count.
- money_remark: the question remarks on money at all - cost, price, paying, fees, wasting money, being cheaper, value for money.
- excludes_client: the question requires something the CLIENT brand clearly cannot offer (a hardware feature its products lack, a platform it does not run on, a service it does not provide), so the client could not be a valid answer. False when unsure.
Reply with ONLY: {"named": ["<tracked brand names exactly as listed>"], "states_price": true|false, "money_remark": true|false, "excludes_client": true|false}`;

if (PHASE === "adjudicate") {
  const al = new Map<string, Record<string, string[]>>(readL("aliases.jsonl").map((r: any) => [r.roster, r.aliases]));
  const A = new Map(readL("armA_v2_low.jsonl").map((r: any) => [r.id, r.v]));
  const differs = (o: Facts, n: Facts) =>
    o.named.slice().sort().join("|") !== n.named.slice().sort().join("|") || o.statesPrice !== n.statesPrice || o.moneyBoltOn !== n.moneyBoltOn;
  const dis: Item[] = [], agree: Item[] = [];
  for (const it of sel) {
    const v = A.get(it.id); if (!v || v.unchecked) continue;
    const a = al.get(rosterKey(it)) ?? {};
    (differs(oldPath(it, a), newPath(it, v, a)) ? dis : agree).push(it);
  }
  const fleet = sel.filter((x) => x.source === "fleet");
  const sample = shuffle(agree.filter((x) => x.source !== "fleet"), 5).slice(0, 300);
  const todo = [...new Map([...dis, ...sample, ...fleet].map((x) => [x.id, x])).values()];
  console.log(`adjudicating: ${dis.length} disagreements, ${sample.length} sampled agreements (of ${agree.length}), ${fleet.length} fleet -> ${todo.length} unique`);
  const done = new Map(readL("truth.jsonl").map((r: any) => [r.id, r]));
  const a = await anthropicClient();
  const rows = await pool(todo, 10, async (it) => {
    if (done.has(it.id)) return done.get(it.id);
    const res = await a.messages.create({
      model: "claude-opus-5-5", max_tokens: 3000, output_config: { effort: "medium" }, system: ADJ_SYSTEM,
      messages: [{ role: "user", content: `Category: ${it.category}\nClient brand: ${it.tracker}\nTracked brands: ${[it.tracker, ...it.competitors].join("; ")}\n${it.concern ? `The question's designed worry: ${it.concern}\n` : ""}\nQuestion: ${it.text}` }],
    } as never);
    const text = (res as any).content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let j: any = {};
    try { j = JSON.parse(firstJsonObject(text) ?? text); } catch { j = { error: text.slice(0, 200) }; }
    const row = { id: it.id, kind: dis.includes(it) ? "disagree" : sample.includes(it) ? "agree_sample" : "fleet", truth: j };
    fs.appendFileSync(path.join(OUT, "truth.jsonl"), JSON.stringify(row) + "\n");
    return row;
  });
  console.log("adjudicated:", rows.length, "parse errors:", rows.filter((r: any) => r.truth.error).length);
  process.exit(0);
}

if (PHASE === "report") {
  const al = new Map<string, Record<string, string[]>>(readL("aliases.jsonl").map((r: any) => [r.roster, r.aliases]));
  const A = new Map(readL("armA_v2_low.jsonl").map((r: any) => [r.id, r.v]));
  const B = new Map(readL("armB_v2_default.jsonl").map((r: any) => [r.id, r.v]));
  const V1 = new Map(readL("v1_subset.jsonl").map((r: any) => [r.id, r.v]));
  const T = new Map(readL("truth.jsonl").map((r: any) => [r.id, r]));
  const byId = new Map(sel.map((x) => [x.id, x]));
  // per-field scoring on adjudicated items, split by stratum
  const fields = ["named", "statesPrice", "moneyBoltOn"] as const;
  const out: string[] = [];
  const nAgreeTotal = sel.filter((it) => { const v = A.get(it.id); return v && !v.unchecked; }).length - [...T.values()].filter((r: any) => r.kind === "disagree").length;
  for (const stratum of ["disagree", "agree_sample", "fleet"]) {
    const rows = [...T.values()].filter((r: any) => r.kind === stratum && !r.truth.error);
    const score = { old: { named: 0, statesPrice: 0, moneyBoltOn: 0, targetLeakMiss: 0 }, new: { named: 0, statesPrice: 0, moneyBoltOn: 0, targetLeakMiss: 0, excl: 0 } };
    let exclN = 0;
    for (const r of rows) {
      const it = byId.get(r.id)!; const a = al.get(rosterKey(it)) ?? {}; const v = A.get(it.id);
      const tNamed = new Set((r.truth.named ?? []) as string[]);
      const nonPrice = !!it.concern && !bc.isPriceConcern(it.concern);
      const truthF = { named: [...tNamed].sort().join("|"), statesPrice: !!r.truth.states_price, moneyBoltOn: nonPrice && !!r.truth.money_remark };
      const spec = bc.deriveCheckSpec({ stage: it.stage, angle: it.angle, text: it.text, concern: it.concern }, it.tracker, it.competitors, it.category, a);
      for (const [label, f] of [["old", oldPath(it, a)], ["new", newPath(it, v, a)]] as const) {
        const s = (score as any)[label];
        if (f.named.slice().sort().join("|") === truthF.named) s.named++;
        if (f.statesPrice === truthF.statesPrice) s.statesPrice++;
        if (f.moneyBoltOn === truthF.moneyBoltOn) s.moneyBoltOn++;
        // a target leak: truth says the target is named where the design forbids it, and the path did not flag it
        if (spec.forbiddenBrands.includes(it.tracker) && tNamed.has(it.tracker) && !f.leaked.includes(it.tracker)) s.targetLeakMiss++;
      }
      if (it.stage === "feature_screening" || it.source === "fleet") { exclN++; if (!!v.excludesClient === !!r.truth.excludes_client) score.new.excl++; }
    }
    out.push(`### ${stratum} (n=${rows.length}${stratum === "agree_sample" ? `, of ${nAgreeTotal} agreements` : ""})`,
      `| path | brands named (exact set) | states price | money bolt-on | target-leak misses |`, `| --- | --- | --- | --- | --- |`,
      ...(["old", "new"] as const).map((p) => { const s = (score as any)[p]; return `| ${p} | ${s.named}/${rows.length} | ${s.statesPrice}/${rows.length} | ${s.moneyBoltOn}/${rows.length} | ${s.targetLeakMiss} |`; }),
      `excludes_client (new only, feature screens + fleet): ${score.new.excl}/${exclN}`, "");
  }
  // V1 vs V2 voices agreement; arm B vs arm A on seeds
  const v1 = [...V1.entries()].filter(([id, v]: any) => !v.unchecked && A.get(id) && !A.get(id).unchecked);
  out.push(`voices_design V1 vs V2 (same texts): ${v1.filter(([id, v]: any) => v.voices === A.get(id).voices).length}/${v1.length} agree`);
  const b = [...B.entries()].filter(([id, v]: any) => !v.unchecked && T.has(id));
  out.push(`arm B (default effort) on adjudicated seeds: ${b.length} - brands exact vs truth: ${b.filter(([id, v]: any) => {
    const it = byId.get(id)!; const a = al.get(rosterKey(it)) ?? {};
    return newPath(it, v, a).named.slice().sort().join("|") === [...(T.get(id).truth.named ?? [])].sort().join("|"); }).length}/${b.length}`);
  fs.writeFileSync(path.join(OUT, "report.md"), out.join("\n"));
  console.log(out.join("\n"));
  process.exit(0);
}
