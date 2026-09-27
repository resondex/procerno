/**
 * Dictionary-suggestion model test: gpt-6-luna vs gpt-5-mini (prod) on the four
 * confirmed trackers (jira, AmEx, Netflix, Pixel), byte-identical production
 * prompt (suggestSystemPrompt) and request shape (strict json_schema, 24K cap,
 * CHUNK 40), family roots only - the names the model actually judges in prod
 * after the mechanical family layer, against the seed actives (gates-open state).
 *
 * Truth = Tyler's confirmed boards: a name that is an active canonical =
 * approve, a rejected canonical (or an alias of one) = ignore, an alias of an
 * active entry = merge into it. Roots whose cached prod verdict was flipped by
 * the co-occurrence guard are scored separately (the human saw guard output).
 *
 * Prod is READ ONLY (separate connection, read-only session); DATABASE_URL is
 * removed before providers load, so ledger rows fall back to local SQLite.
 * Output: ~/Documents/procerno_eval/dict_bakeoff/luna6/.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const REPO = "/Users/tylersolloway/Documents/GitHub/procerno";
let DB_URL = "";
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) continue;
  const v = m[2].replace(/^"|"$/g, "");
  if (m[1] === "DATABASE_URL") DB_URL = v;
  else process.env[m[1]] = v;
}
delete process.env.DATABASE_URL;

const { suggestSystemPrompt, buildFamilyPlan } = await import(`${REPO}/src/lib/engine/dict_suggest`);
const { openaiClient } = await import(`${REPO}/src/lib/engine/providers`);
const postgres = (await import(`${REPO}/node_modules/postgres/src/index.js`)).default;

const OUT = process.env.OUT_DIR ?? `${process.env.HOME}/Documents/procerno_eval/dict_bakeoff/luna6`;
// Candidate rule (test A, 2026-09-26): co-brand partners are affiliated, so
// the co-occurrence guard measures them instead of product_of waving them
// through. COBRAND_RULE=1 inserts it after the relationship definitions.
const COBRAND_RULE =
  "A co-brand partner - an airline, hotel, retailer, or other company whose " +
  "name appears on a card, plan, or product the target's company sells - " +
  "is affiliated, never product_of or same_offering: it is its own company, " +
  "and its name alone does not mean the target's product was chosen.\n";
// Candidate rule (test A2, 2026-09-27): third-party marketplace apps are
// affiliated, so the guard measures them instead of product_of merging them
// into the target. ADDON_RULE=1 inserts it after the co-brand rule.
const ADDON_RULE =
  "A third-party app, plugin, add-on, or integration that ANOTHER company " +
  "builds for an active brand's platform or marketplace is affiliated, never " +
  "product_of: its maker is a different company, and naming it does not mean " +
  "the target's product was chosen.\n";
const systemPrompt = (category: string, seeds: string[]) => {
  const base = suggestSystemPrompt(category, seeds);
  if (process.env.COBRAND_RULE !== "1") return base;
  const i = base.indexOf("ignore.\nEvery suggestion needs");
  if (i < 0) throw new Error("co-brand rule anchor not found in the prod prompt");
  const rules = COBRAND_RULE + (process.env.ADDON_RULE === "1" ? ADDON_RULE : "");
  return base.slice(0, i + "ignore.\n".length) + rules + base.slice(i + "ignore.\n".length);
};
fs.mkdirSync(OUT, { recursive: true });
const RUNS = Number(process.env.RUNS ?? 3);
const CHUNK = 40;
const norm = (s: string) => s.trim().toLowerCase();
const key = (pid: string, name: string) =>
  `dict_suggest:v8:${pid}:` + createHash("sha256").update(norm(name)).digest("hex");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          action: { type: "string", enum: ["merge", "approve", "ignore"] },
          merge_into: { type: ["string", "null"] },
          relationship: { type: "string", enum: ["same_offering", "product_of", "affiliated", "content_of", "none"] },
          rationale: { type: "string" },
        },
        required: ["name", "action", "merge_into", "relationship", "rationale"],
      },
    },
  },
  required: ["suggestions"],
} as const;

// ---- read the four confirmed boards (read only) ----
// Every query runs in its own READ ONLY transaction. A session-level
// "SET SESSION CHARACTERISTICS ... READ ONLY" must never be used here:
// behind the Supabase transaction pooler it sticks to a shared server
// connection and leaks to the live app (2026-09-26 incident).
const ro = postgres(DB_URL, { max: 1 });
const sql = Object.assign(
  (s: TemplateStringsArray, ...v: unknown[]) => ro.begin("read only", (t: any) => t(s, ...v)),
  { end: () => ro.end() }
);
const projects = await sql`SELECT id, brand, category, competitors FROM projects
  WHERE brand IN ('jira','American Express','Netflix','Google Pixel') ORDER BY brand`;
type Case = { pid: string; brand: string; category: string; seeds: string[]; roots: string[];
  truth: Record<string, string>; cached: Record<string, any>; guardFlipped: Set<string> };
const cases: Case[] = [];
for (const p of projects) {
  const comps: string[] = typeof p.competitors === "string" ? JSON.parse(p.competitors) : p.competitors;
  const seeds = [p.brand as string, ...comps];
  const rows = await sql`SELECT id, canonical, aliases, status FROM dictionary_entries WHERE project_id=${p.id}`;
  const entries = rows.map((r: any) => ({ id: r.id, canonical: r.canonical as string,
    aliases: (typeof r.aliases === "string" ? JSON.parse(r.aliases) : r.aliases) as string[], status: r.status as string }));
  // every name the board knows, with Tyler's final disposition
  const truth: Record<string, string> = {};
  const display: Record<string, string> = {};
  // A merge leaves the merged name as a REJECTED entry AND an alias of its
  // target, so precedence matters: alias of an active entry > active
  // canonical > rejected. (The first scoring pass read rejected first and
  // scored all 109 merged names as ignores - see dict_luna6_rescore.mts.)
  for (const e of entries) if (e.status === "rejected") { truth[norm(e.canonical)] = "ignore"; display[norm(e.canonical)] = e.canonical; }
  for (const e of entries) if (e.status === "active") { truth[norm(e.canonical)] = "approve"; display[norm(e.canonical)] = e.canonical; }
  for (const e of entries) {
    for (const a of e.aliases) {
      const n = norm(a);
      if (e.status === "active") { if (truth[n] !== "approve") truth[n] = `merge:${norm(e.canonical)}`; }
      else if (!(n in truth)) truth[n] = "ignore";
      if (!(n in display)) display[n] = a;
    }
  }
  // names with an engine verdict = names that went through the suggestion pass
  const names = Object.keys(truth);
  const hits = await sql`SELECT key, value FROM llm_cache WHERE key = ANY(${names.map((n) => key(p.id, n))})`;
  const byKey = new Map(hits.map((h: any) => [h.key, JSON.parse(h.value)]));
  const judged = names.filter((n) => byKey.has(key(p.id, n)));
  const seedSet = new Set(seeds.map(norm));
  const seedEntries = entries.filter((e) => seedSet.has(norm(e.canonical))).map((e) => ({
    ...e, status: "active",
    // seeded aliases only: merge-earned aliases carry an engine verdict
    aliases: e.aliases.filter((a) => !byKey.has(key(p.id, a))),
  }));
  const pending = judged.filter((n) => !seedSet.has(n)).map((n, i) => ({ id: `p${i}`, canonical: display[n], aliases: [], status: "pending" }));
  const plan = buildFamilyPlan(pending as any, seedEntries as any);
  const roots = pending.filter((q) => !plan.activeMerge.has(q.id) && !plan.rootOf.has(q.id)).map((q) => q.canonical).sort();
  const cached: Record<string, any> = {};
  const guardFlipped = new Set<string>();
  for (const r of roots) {
    const v = byKey.get(key(p.id, r));
    cached[norm(r)] = v;
    if (v?.action === "ignore" && /^(vocabulary of|own-context brand)/.test(v.rationale ?? "")) guardFlipped.add(norm(r));
  }
  cases.push({ pid: p.id, brand: p.brand, category: p.category, seeds, roots, truth, cached, guardFlipped });
  console.log(`${p.brand}: ${names.length} names on board, ${judged.length} with engine verdicts, ${roots.length} family roots (${guardFlipped.size} guard-flipped in prod)`);
}
await sql.end();

// ---- model runs ----
async function judge(model: string, c: Case, batch: string[], temp0: boolean) {
  const t0 = Date.now();
  const res = await openaiClient().chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt(c.category, c.seeds) },
      { role: "user", content: JSON.stringify(batch) },
    ],
    max_completion_tokens: 24000,
    ...(temp0 ? { temperature: 0 } : {}),
    response_format: { type: "json_schema", json_schema: { name: "dispositions", strict: true, schema: SCHEMA } },
  } as any);
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{"suggestions":[]}');
  return { parsed: parsed.suggestions as any[], finish: res.choices[0]?.finish_reason,
    usage: res.usage, secs: (Date.now() - t0) / 1000 };
}

async function probeTemp0(model: string) {
  try {
    await openaiClient().chat.completions.create({ model, messages: [{ role: "user", content: "ok" }], max_completion_tokens: 50, temperature: 0 } as any);
    return true;
  } catch (e) {
    console.log(`${model} rejects temperature 0: ${(e as Error).message.slice(0, 160)}`);
    return false;
  }
}

const arms: { label: string; model: string; temp0: boolean }[] = [
  { label: "gpt-5-mini", model: "gpt-5-mini", temp0: false },
  { label: "gpt-6-luna", model: "gpt-6-luna", temp0: false },
];
if (await probeTemp0("gpt-6-luna")) arms.push({ label: "gpt-6-luna-t0", model: "gpt-6-luna", temp0: true });

const results: Record<string, Record<string, Record<string, string>[]>> = {}; // arm -> brand -> runs[] of name->verdict
const meta: Record<string, { calls: number; fails: number; truncated: number; secs: number[]; inTok: number; outTok: number }> = {};
for (const arm of arms) {
  meta[arm.label] = { calls: 0, fails: 0, truncated: 0, secs: [], inTok: 0, outTok: 0 };
  results[arm.label] = {};
  for (const c of cases) {
    results[arm.label][c.brand] = [];
    for (let run = 0; run < RUNS; run++) {
      const verdicts: Record<string, string> = {};
      const batches: string[][] = [];
      for (let i = 0; i < c.roots.length; i += CHUNK) batches.push(c.roots.slice(i, i + CHUNK));
      await Promise.all(batches.map(async (b) => {
        try {
          const r = await judge(arm.model, c, b, arm.temp0);
          const m = meta[arm.label];
          m.calls++; m.secs.push(r.secs);
          m.inTok += r.usage?.prompt_tokens ?? 0; m.outTok += r.usage?.completion_tokens ?? 0;
          if (r.finish === "length") m.truncated++;
          for (const s of r.parsed) {
            verdicts[norm(s.name)] = s.action === "merge" ? `merge:${norm(s.merge_into ?? "")}` : s.action;
            fs.appendFileSync(`${OUT}/raw.jsonl`, JSON.stringify({ arm: arm.label, brand: c.brand, run, ...s }) + "\n");
          }
        } catch (e) {
          meta[arm.label].fails++;
          console.log(`FAIL ${arm.label} ${c.brand} run ${run}: ${(e as Error).message.slice(0, 200)}`);
        }
      }));
      results[arm.label][c.brand].push(verdicts);
      console.log(`${arm.label} ${c.brand} run ${run}: ${Object.keys(verdicts).length}/${c.roots.length} judged`);
    }
  }
}
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ cases: cases.map((c) => ({ ...c, guardFlipped: [...c.guardFlipped] })), results, meta }, null, 1));

// ---- scoring ----
const act = (v?: string) => (v ?? "missing").split(":")[0];
const majority = (vs: (string | undefined)[]) => {
  const cnt = new Map<string, number>();
  for (const v of vs) if (v) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
// merge targets: a merge into the right entry counts under any spelling of it
const sameTarget = (c: Case, v: string | undefined, t: string) => {
  if (!v) return false;
  if (v === t) return true;
  if (v.startsWith("merge:") && t.startsWith("merge:")) {
    const vt = v.slice(6), tt = t.slice(6);
    return vt === tt || c.truth[vt] === t || (c.truth[vt] === "approve" && vt === tt);
  }
  return false;
};
console.log("\n| arm | brand | roots | unanimous across runs | action = board | action+target = board | action = board (excl. guard-flipped) |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
const PRICE: Record<string, [number, number]> = { "gpt-5-mini": [0.25, 2], "gpt-6-luna": [0.1, 0.5] };
for (const arm of arms) {
  let tot = { roots: 0, unan: 0, a: 0, at: 0, ax: 0, nx: 0 };
  for (const c of cases) {
    const runs = results[arm.label][c.brand];
    let unan = 0, a = 0, at = 0, ax = 0, nx = 0;
    for (const r of c.roots) {
      const n = norm(r);
      const vs = runs.map((x) => x[n]);
      if (vs.every((v) => v && v === vs[0])) unan++;
      const m = majority(vs);
      const t = c.truth[n];
      if (act(m) === act(t)) a++;
      if (sameTarget(c, m, t)) at++;
      if (!c.guardFlipped.has(n)) { nx++; if (act(m) === act(t)) ax++; }
    }
    const pct = (x: number, d: number) => `${Math.round((100 * x) / Math.max(d, 1))}%`;
    console.log(`| ${arm.label} | ${c.brand} | ${c.roots.length} | ${pct(unan, c.roots.length)} | ${pct(a, c.roots.length)} | ${pct(at, c.roots.length)} | ${pct(ax, nx)} |`);
    tot.roots += c.roots.length; tot.unan += unan; tot.a += a; tot.at += at; tot.ax += ax; tot.nx += nx;
  }
  const pct = (x: number, d: number) => `**${Math.round((100 * x) / Math.max(d, 1))}%**`;
  console.log(`| ${arm.label} | all | ${tot.roots} | ${pct(tot.unan, tot.roots)} | ${pct(tot.a, tot.roots)} | ${pct(tot.at, tot.roots)} | ${pct(tot.ax, tot.nx)} |`);
}
console.log("\n| arm | calls | failed | truncated | median secs/batch | cost |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const arm of arms) {
  const m = meta[arm.label];
  const [pi, po] = PRICE[arm.model];
  const s = [...m.secs].sort((a, b) => a - b);
  console.log(`| ${arm.label} | ${m.calls} | ${m.fails} | ${m.truncated} | ${s[Math.floor(s.length / 2)]?.toFixed(1)} | $${((m.inTok * pi + m.outTok * po) / 1e6).toFixed(3)} |`);
}
process.exit(0);
