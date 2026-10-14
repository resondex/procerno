/**
 * Test E - post-run prompt health (analyzePromptHealth, the real function)
 * on the four trackers' held runs. Prod has no coded mentions yet, so the
 * brands each answer recalled come from the discovery brands pass
 * (responses.discovery_brands) - the same per-answer brand sets the
 * dictionary guard uses. Store reads are served read-only from prod;
 * setPromptFlag is captured in memory (nothing is written anywhere).
 * Env: PROMPT_HEALTH_MODEL + ARM. Output internal_models/health/<ARM>.json
 */
import fs from "node:fs";
import { ARM, RUNS, closeProd, errors, localUsage, outDir, prod, REPO } from "./internal_models_common.mts";

const { analyzePromptHealth } = await import(`${REPO}/src/lib/engine/prompt_health`);
const { store } = await import(`${REPO}/src/lib/store`);
const { PROMPT_HEALTH_MODEL } = await import(`${REPO}/src/lib/engine/models`);

let flags: Record<string, { reason: string; alternatives: string[] } | null> = {};
const runOf = new Map<string, string>();
Object.assign(store as object, {
  getProject: async (id: string) => (await prod`SELECT id, brand, category FROM projects WHERE id=${id}`)[0] ?? null,
  listPrompts: async (pid: string) =>
    (await prod`SELECT id, text, theme, intent_id, coalesce(retired, 0) retired FROM prompts WHERE project_id=${pid}`).map((r) => ({ ...r, retired: Number(r.retired) })),
  // analyzePromptHealth scopes to the prompts the run carried (promptsForRun).
  getRun: async (id: string) => {
    const r = (await prod`SELECT id, project_id, surfaces FROM runs WHERE id=${id}`)[0];
    return r ? { ...r, surfaces: r.surfaces ? JSON.parse(r.surfaces) : null } : null;
  },
  listIntents: async (pid: string) => prod`SELECT id, stage, concern FROM intents WHERE project_id=${pid}`,
  listResponseMeta: async (runId: string) => prod`SELECT id, prompt_id FROM responses WHERE run_id=${runId}`,
  listMentionsForRun: async (runId: string) => {
    const rows = await prod`SELECT id, discovery_brands FROM responses WHERE run_id=${runId} AND discovery_brands IS NOT NULL`;
    return rows.flatMap((r) => (JSON.parse(r.discovery_brands) as string[]).map((brand) => ({ response_id: r.id, brand })));
  },
  getDictionary: async (pid: string) =>
    (await prod`SELECT id, canonical, aliases, status, display_name FROM dictionary_entries WHERE project_id=${pid}`).map((r) => ({ ...r, aliases: JSON.parse(r.aliases) })),
  setPromptFlag: async (promptId: string, flag: { reason: string; alternatives: string[] } | null) => { flags[promptId] = flag; },
});

const out: Record<string, unknown> = { arm: ARM, model: PROMPT_HEALTH_MODEL, brands: {} };
// Pinned to the four September held runs test E used (2026-09-26), so arms
// stay comparable now that the brands also have newer trackers.
const PINNED_RUNS = (process.env.RUN_IDS ??
  "34d46b95-2110-4fc9-859c-5a6bc75579c3,78704e8f-8f15-4e98-b3f1-39da57a4a5aa,a2b37945-7f3e-46fe-b9b7-da324be772a7,3edb9206-e677-4eee-a960-9a9043b943b9").split(",");
const pinned = await prod`SELECT r.id, r.project_id, p.brand FROM runs r JOIN projects p ON p.id = r.project_id WHERE r.id = ANY(${PINNED_RUNS}) ORDER BY p.brand`;
for (const row of pinned) {
  const t = { id: row.project_id as string, brand: row.brand as string };
  const run = { id: row.id as string };
  runOf.set(t.id, run.id);
  const runs: unknown[] = [];
  for (let i = 0; i < RUNS; i++) {
    flags = {};
    await analyzePromptHealth(t.id, run.id);
    runs.push(flags);
    console.log(`${ARM} ${t.brand} run ${i}: ${Object.values(flags).filter(Boolean).length} flagged of ${Object.keys(flags).length} prompts written`);
  }
  (out.brands as Record<string, unknown>)[t.brand] = { runId: run.id, runs };
}
out.usage = await localUsage();
out.errors = errors;
fs.writeFileSync(`${outDir("health")}/${ARM}.json`, JSON.stringify(out, null, 1));
await closeProd();
process.exit(0);
