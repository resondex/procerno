/**
 * GPT-6 ChatGPT engine verification (2026-10-22, Tyler's go with the re-map
 * build). The "ChatGPT" engines re-point gpt-5.6-luna/sol -> gpt-6-luna/sol
 * (OpenAI's ChatGPT release notes, 2026-10-07: Free/Go on GPT-6 Luna,
 * Plus/Pro/Business/Enterprise on GPT-6 Sol). This runs a handful of real
 * tracker prompts through the PROD answer path (completeWithEngine) on the
 * four new engine ids and checks what the September refresh checked: no
 * empty answers (GPT-6 thinks by default - an answer eaten by reasoning
 * would come back empty), finish=stop, search count <= cap, citations on
 * search answers, usage recorded. Local only: DATABASE_URL is stripped
 * (internal_models_common), so the ledger lands in ./data; prompts are read
 * from prod in read-only transactions. SPENDS MONEY (~$0.50-1): per-run go
 * required, like all API spend.
 *
 *   mkdir -p /tmp/x && cd /tmp/x && npx tsx $REPO/scripts/gpt6_engine_check.mts
 */
import { REPO, closeProd, localUsage, prod, seeded } from "./internal_models_common.mts";

const { completeWithEngine, getEngine, currentEngineId } = await import(`${REPO}/src/lib/engine/providers`);

// Successor resolution sanity: a tracker configured with the retired ids
// (5.6 pair, or the Aug 2025 pair) must land on the GPT-6 pair.
for (const [from, to] of [
  ["gpt-5.6-luna", "gpt-6-luna"], ["gpt-5.6-sol", "gpt-6-sol"],
  ["gpt-5.6-luna-search", "gpt-6-luna-search"], ["gpt-5.6-sol-search", "gpt-6-sol-search"],
  ["gpt-5-mini", "gpt-6-luna"], ["gpt-5-search", "gpt-6-sol-search"],
]) {
  const got = currentEngineId(from);
  if (got !== to) throw new Error(`successor chain: ${from} -> ${got}, expected ${to}`);
}
console.log("successor chains resolve: 5.6 pair and Aug-2025 pair -> GPT-6 pair");
for (const id of ["gpt-6-luna", "gpt-6-sol", "gpt-6-luna-search", "gpt-6-sol-search"]) {
  if (!getEngine(id)) throw new Error(`engine missing from registry: ${id}`);
}

// Eight live prompts from the Netflix tracker, deterministic draw.
const rows = await prod`SELECT p.text FROM prompts p JOIN projects j ON j.id = p.project_id
  WHERE j.brand = 'Netflix' AND p.retired = 0 ORDER BY p.id`;
const prompts = seeded(rows.map((r: any) => r.text as string), 20261022).slice(0, 8);
if (prompts.length < 8) throw new Error(`only ${prompts.length} prompts`);

const PLAN: [string, number][] = [
  ["gpt-6-luna", 8],
  ["gpt-6-luna-search", 8],
  ["gpt-6-sol", 4],
  ["gpt-6-sol-search", 4],
];

let bad = 0;
for (const [engine, n] of PLAN) {
  const stats = { empty: 0, short: 0, notStop: 0, overCap: 0, noCites: 0, words: [] as number[], searches: [] as number[] };
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    try {
      const a = await completeWithEngine(engine, prompts[i]);
      const w = a.text.trim().split(/\s+/).filter(Boolean).length;
      stats.words.push(w);
      if (!a.text.trim()) stats.empty++;
      else if (w < 30) stats.short++;
      if (a.finishReason !== "stop" && a.finishReason !== "end_turn") stats.notStop++;
      if (a.searchCount != null) {
        stats.searches.push(a.searchCount);
        if (a.searchCount > 3) stats.overCap++;
        if (engine.endsWith("-search") && !a.citations?.length && a.searchCount > 0) stats.noCites++;
      }
      console.log(`${engine} [${i}] ${Date.now() - t0}ms words=${w} finish=${a.finishReason} searches=${a.searchCount ?? "-"} cites=${a.citations?.length ?? 0} in=${a.usage.input} out=${a.usage.output}`);
    } catch (err) {
      bad++;
      console.log(`${engine} [${i}] FAILED: ${(err as Error).message.slice(0, 150)}`);
    }
  }
  bad += stats.empty + stats.notStop + stats.overCap + stats.noCites;
  console.log(
    `== ${engine}: ${n} answers, empty ${stats.empty}, short(<30w) ${stats.short}, non-stop ${stats.notStop}, ` +
      `searches>${3} ${stats.overCap}, search-no-cites ${stats.noCites}, median words ${stats.words.sort((a, b) => a - b)[Math.floor(stats.words.length / 2)] ?? "-"}` +
      (stats.searches.length ? `, mean searches ${(stats.searches.reduce((a, b) => a + b, 0) / stats.searches.length).toFixed(2)}` : "")
  );
}

console.log("\nLocal ledger (per model/purpose):");
for (const u of await localUsage()) console.log(` ${u.model} ${u.purpose}: ${u.calls} calls, in ${u.inTok}, out ${u.outTok}`);
console.log(bad === 0 ? "\nVERDICT: all checks pass" : `\nVERDICT: ${bad} problem(s) - see lines above`);
await closeProd();
process.exit(bad === 0 ? 0 : 1);
