/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Dictionary root-cause replay (2026-11-13). Zero spend, zero prod contact:
 * reads the local snapshot written by dict_rootcause_fetch.mts and a COPY of
 * the dashboard fixture, and compares the engine before and after the fix.
 *
 *   boards  - every board in the snapshot, old code vs new code:
 *             where each observed name resolves, which stored aliases the
 *             automatic alias step would no longer add, which cached
 *             verdicts the content rule and the short-form rule change.
 *     OLD=<path to a checkout of the previous code> SNAP=<snapshot.json> \
 *       npx tsx scripts/dict_rootcause_replay.mts boards
 *
 *   cases   - the four patched cases end to end on a fixture copy, through
 *             the real engine functions, with a local stub standing in for
 *             the suggestion model (it replays the verdicts the real model
 *             gave, read from the snapshot). Run once per code tree:
 *     ROOT=<repo or old checkout> SNAP=<snapshot.json> FIXTURE=<copy.db> \
 *       npx tsx scripts/dict_rootcause_replay.mts cases
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const mode = process.argv[2];
const SNAP = process.env.SNAP;
if (!SNAP || !["boards", "cases"].includes(mode)) throw new Error("usage: see the header");
for (const k of ["DATABASE_URL", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) delete process.env[k];

type Entry = { id: string; canonical: string; aliases: string[]; status: "active" | "rejected" | "pending"; confirmed_aliases: string[]; display_name?: string | null };
type Board = { id: string; brand: string; category: string; era: string; entries: Entry[]; cache: { key: string; value: any }[]; names: { name: string; answers: number }[]; rows: number };
const snap = JSON.parse(fs.readFileSync(SNAP, "utf8")) as { boards: Board[] };
const label = (b: Board) => `${b.brand} (${b.era})`;
const key = (s: string) => s.trim().toLowerCase();

if (mode === "boards") {
  const OLD = process.env.OLD;
  if (!OLD) throw new Error("OLD=<previous code checkout> required");
  delete process.env.OPENAI_API_KEY;
  const nw = {
    resolve: await import(`${REPO}/src/lib/engine/brand_resolve.ts`),
    fam: await import(`${REPO}/src/lib/engine/brand_family.ts`),
    sug: await import(`${REPO}/src/lib/engine/dict_suggest.ts`),
  };
  const old = {
    resolve: await import(`${OLD}/src/lib/engine/brand_resolve.ts`),
    fam: await import(`${OLD}/src/lib/engine/brand_family.ts`),
    sug: await import(`${OLD}/src/lib/engine/dict_suggest.ts`),
  };
  const { famTokens, familyContains, familyHit, splitsCompound } = nw.fam;
  const { matchKey } = await import(`${REPO}/src/lib/brand_key.ts`);

  let totalChanged = 0;
  for (const b of snap.boards) {
    console.log(`\n================ ${label(b)} - ${b.entries.length} entries, ${b.names.length} observed names, ${b.rows} answers`);
    const byId = new Map(b.entries.map((e) => [e.id, e]));

    // 1. Read-time resolution of every observed name, old vs new.
    const rOld = old.resolve.buildResolver(b.entries);
    const rNew = nw.resolve.buildResolver(b.entries);
    const moved: { name: string; answers: number; from: string; to: string }[] = [];
    for (const n of b.names) {
      const a = rOld(n.name);
      const c = rNew(n.name);
      if (a.key !== c.key || a.status !== c.status) {
        moved.push({ name: n.name, answers: n.answers, from: `${a.name} [${a.status}]`, to: c.status === "unknown" ? "not in the dictionary" : `${c.name} [${c.status}]` });
      }
    }
    moved.sort((x, y) => y.answers - x.answers);
    totalChanged += moved.length;
    console.log(`  1. observed names that resolve differently: ${moved.length} of ${b.names.length}`);
    for (const m of moved) console.log(`       ${String(m.answers).padStart(5)}  "${m.name}": ${m.from} -> ${m.to}`);

    // 2. Stored aliases the automatic alias step would no longer add: the
    // alias is held up only by another form of its entry under the OLD
    // family test, and the new test refuses it (or it names two entries).
    const active = b.entries.filter((e) => e.status === "active" && e.canonical !== "Other");
    const refused: string[] = [];
    for (const e of active) {
      for (const al of e.aliases) {
        const others = [e.canonical, ...e.aliases].filter((f) => matchKey(f) !== matchKey(al)).map((f) => famTokens(f));
        const hay = famTokens(al);
        const oldHit = others.some((s) => s.length < hay.length && familyContains(hay, s));
        if (!oldHit) continue; // not a family extension: a seeded or hand-merged alias
        const newHit = others.some((s) => s.length < hay.length && familyHit(al, s));
        if (!newHit) refused.push(`"${al}" under ${e.canonical} (only splits a hyphenated word)`);
      }
    }
    console.log(`  2. stored aliases the automatic alias step would no longer add: ${refused.length}`);
    for (const r of refused) console.log(`       ${r}`);

    // 3. Cached verdicts. One verdict per name: the newest rules + model key wins as the board reads it.
    const hashOf = (k: string) => k.split(":").pop()!;
    const { createHash } = await import("node:crypto");
    const verdictOf = new Map<string, any>();
    const rank = (k: string) => (k.includes(":v10:") ? 0 : k.split(":").length > 4 ? 1 : 2);
    const byHash = new Map<string, { key: string; value: any }>();
    for (const c of b.cache) {
      const h = hashOf(c.key);
      const prev = byHash.get(h);
      if (!prev || rank(c.key) < rank(prev.key)) byHash.set(h, c);
    }
    for (const e of b.entries) {
      const h = createHash("sha256").update(key(e.canonical)).digest("hex");
      const hit = byHash.get(h);
      if (hit) verdictOf.set(e.canonical, hit.value);
    }
    const decided = (name: string): string => {
      const k = matchKey(name);
      const holder = b.entries.find((e) => e.status === "active" && [e.canonical, ...e.aliases].some((f) => matchKey(f) === k));
      if (holder) return matchKey(holder.canonical) === k ? "approved" : `merged into ${holder.canonical}`;
      const own = b.entries.find((e) => matchKey(e.canonical) === k);
      return own ? (own.status === "rejected" ? "ignored" : own.status) : "gone";
    };
    const content: string[] = [];
    const shortForms: string[] = [];
    const familyLost: string[] = [];
    for (const [name, v] of verdictOf) {
      if (nw.sug.contentVerdict(v)) content.push(`"${name}": served merge into ${v.merge_into} -> now served ignore; the board today: ${decided(name)}`);
      if (v.action === "merge" && v.merge_into) {
        const sat = famTokens(name);
        const tgt = famTokens(v.merge_into);
        const leading = sat.length < tgt.length && sat.every((t: string, i: number) => tgt[i] === t);
        const declared = nw.sug.declaredForms(v.merge_into).some((s: string[]) => s.length === sat.length && s.every((t, i) => t === sat[i]));
        const layer = nw.sug.verdictLayer(v).layer;
        if (leading && !declared && (layer === "guard_short_form" || layer === "model") && !/- review\)/.test(v.rationale ?? "")) {
          shortForms.push(`"${name}" -> ${v.merge_into}: was silent, would now carry a review flag; the board today: ${decided(name)}`);
        }
        if (layer === "family_active") {
          const target = b.entries.find((e) => key(e.canonical) === key(v.merge_into));
          const forms = target ? [target.canonical, ...target.aliases].filter((f) => matchKey(f) !== matchKey(name)) : [v.merge_into];
          const hay = famTokens(name);
          const holds = forms.some((f: string) => { const s = famTokens(f); return s.length < hay.length && old.sug.containsSeq(hay, s) && !splitsCompound(name, s); });
          const held = forms.some((f: string) => { const s = famTokens(f); return s.length < hay.length && old.sug.containsSeq(hay, s); });
          if (held && !holds) familyLost.push(`"${name}" no longer extends ${v.merge_into} mechanically (would reach the model as its own name); the board today: ${decided(name)}`);
        }
      }
    }
    console.log(`  3. cached verdicts read: ${verdictOf.size}`);
    console.log(`     content merges now served as ignore: ${content.length}`);
    for (const c of content) console.log(`       ${c}`);
    console.log(`     leading short forms that were silent merges: ${shortForms.length}`);
    for (const c of shortForms) console.log(`       ${c}`);
    console.log(`     mechanical family merges that no longer hold: ${familyLost.length}`);
    for (const c of familyLost) console.log(`       ${c}`);
    void byId;
  }
  console.log(`\nTOTAL observed names resolving differently across all boards: ${totalChanged}`);
  process.exit(0);
}

// ---------------------------------------------------------------- cases
const ROOT = process.env.ROOT ?? REPO;
const FIXTURE = process.env.FIXTURE;
if (!FIXTURE || path.resolve(FIXTURE) === path.resolve(REPO, "data/dashboard_fixture.db")) throw new Error("FIXTURE must be a COPY of the fixture db");
process.env.SQLITE_PATH = FIXTURE;
process.env.RUN_COLLECT_ONLY = "1";

// The stub model: answers a suggestion batch with the verdicts the real
// model gave these names (from the snapshot's cache), guard notes stripped.
const live = (brand: string) => snap.boards.find((b) => b.brand === brand && b.era === "live")!;
const { createHash } = await import("node:crypto");
const recorded = new Map<string, any>();
const record = (brand: string, names: string[]) => {
  const b = live(brand);
  for (const n of names) {
    const h = createHash("sha256").update(key(n)).digest("hex");
    const c = b.cache.find((x) => x.key.endsWith(h));
    if (!c) throw new Error(`no recorded verdict for ${brand} / ${n}`);
    const raw = c.value.raw ?? c.value;
    recorded.set(key(n), {
      name: n,
      action: raw.action,
      merge_into: raw.merge_into ?? null,
      relationship: raw.relationship ?? c.value.relationship ?? "none",
      rationale: String(c.value.rationale ?? "").replace(/\s*\((named without|short form of|form of the brand)[^)]*\)\s*$/, ""),
    });
  }
};
const CASES: Record<string, string[]> = {
  Netflix: ["Fargo", "NCIS", "Amazon", "Apple"],
  "Google Pixel": ["Apple", "Google", "Samsung", "GrapheneOS"],
};
let calls = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    calls++;
    const parsed = JSON.parse(body);
    const names = JSON.parse(parsed.messages[parsed.messages.length - 1].content) as string[];
    const suggestions = names.map((n) => recorded.get(key(n))).filter(Boolean);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "stub", object: "chat.completion", model: parsed.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ suggestions }) } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`;
process.env.OPENAI_API_KEY = "stub-no-spend";

const { store } = await import(`${ROOT}/src/lib/store/index.ts`);
const obs = await import(`${ROOT}/src/lib/engine/observations.ts`);
const sug = await import(`${ROOT}/src/lib/engine/dict_suggest.ts`);
const { matchKey } = await import(`${ROOT}/src/lib/brand_key.ts`);
const projects = await store.listProjects();
const project = (brand: string) => projects.find((p: any) => p.brand === brand && !p.archived_at)!;
console.log(`code: ${ROOT}\nfixture copy: ${FIXTURE}`);

// Case 1 - Doritos: put Fritos back to its state before the automatic alias
// step ran (the seeded alias "frito" stays), then run the step.
{
  const p = project("Doritos");
  const dict = await store.getDictionary(p.id);
  const fritos = dict.find((e: Entry) => e.canonical === "Fritos")!;
  const kept = fritos.aliases.filter((a: string) => !a.startsWith("frito-lay"));
  await store.upsertDictionaryEntry({ id: fritos.id, projectId: p.id, canonical: fritos.canonical, aliases: kept, status: "active" });
  const { added } = await obs.refreshObservedAliases(p.id);
  const toFritos = added.filter((a: any) => a.entry === "Fritos");
  console.log(`\nCASE 1 Doritos - automatic alias step added ${added.length} aliases; under Fritos: ${toFritos.length}`);
  for (const a of toFritos) console.log(`    "${a.alias}" (${a.answers} answers)`);
  const { observed } = await obs.computeBrandObservations(p.id);
  const after = await store.getDictionary(p.id);
  for (const o of observed.filter((x: any) => /^frito-lay/i.test(x.name)).slice(0, 8)) {
    const e = after.find((x: Entry) => x.id === o.entry_id);
    console.log(`    observed "${o.name}" (${o.answers} answers) counts for: ${e ? e.canonical : "nobody - a new name for the board"}`);
  }
}

// Cases 2-4 - the board's suggestion pass on names put back in the queue.
for (const [brand, names] of Object.entries(CASES)) {
  record(brand, names);
  const p = project(brand);
  const want = new Set(names.map(matchKey));
  for (const e of (await store.getDictionary(p.id)) as Entry[]) {
    if (want.has(matchKey(e.canonical)) && e.status !== "active") await store.deleteDictionaryEntry?.(e.id);
  }
  for (const e of (await store.getDictionary(p.id)) as Entry[]) {
    const kept = e.aliases.filter((a) => !want.has(matchKey(a)));
    if (kept.length !== e.aliases.length) await store.upsertDictionaryEntry({ id: e.id, projectId: p.id, canonical: e.canonical, aliases: kept, status: e.status });
  }
  const still = ((await store.getDictionary(p.id)) as Entry[]).filter((e) => want.has(matchKey(e.canonical)));
  for (const e of still) await store.upsertDictionaryEntry({ id: e.id, projectId: p.id, canonical: e.canonical, aliases: e.aliases, status: "pending" });
  await store.queueDictionaryCandidates(p.id, names);
  const out = await sug.getDictionarySuggestions(p.id, p.category);
  console.log(`\nCASES ${brand} - served by the board's suggestion pass:`);
  for (const n of names) {
    const s = out.find((x: any) => key(x.name) === key(n));
    console.log(`    "${n}": ${s ? `${s.action}${s.mergeIntoName ? ` into ${s.mergeIntoName}` : ""} - ${s.rationale}` : "NOT SERVED"}`);
  }
}
console.log(`\nstub model calls: ${calls} (local, no spend)`);
server.close();
process.exit(0);
