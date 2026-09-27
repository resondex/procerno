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
import { ARM, RUNS, closeProd, errors, localUsage, outDir, prod, trackers, REPO } from "./internal_models_common.mts";

const { analyzePromptHealth } = await import(`${REPO}/src/lib/engine/prompt_health`);
const { store } = await import(`${REPO}/src/lib/store`);
const { PROMPT_HEALTH_MODEL } = await import(`${REPO}/src/lib/engine/models`);

let flags: Record<string, { reason: string; alternatives: string[] } | null> = {};
const runOf = new Map<string, string>();
Object.assign(store as object, {
  getProject: async (id: string) => (await prod`SELECT id, brand, category FROM projects WHERE id=${id}`)[0] ?? null,
  listPrompts: async (pid: string) =>
    (await prod`SELECT id, text, theme, coalesce(retired, 0) retired FROM prompts WHERE project_id=${pid}`).map((r) => ({ ...r, retired: Number(r.retired) })),
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
for (const t of await trackers()) {
  const [run] = await prod`SELECT id FROM runs WHERE project_id=${t.id} ORDER BY created_at DESC LIMIT 1`;
  runOf.set(t.id, run.id);
  const runs: unknown[] = [];
  for (let i = 0; i < RUNS; i++) {
    flags = {};
    await analyzePromptHealth(t.id, run.id);
    runs.push(flags);
    console.log(`${ARM} ${t.brand} run ${i}: ${Object.values(flags).filter(Boolean).length} flagged of ${Object.keys(flags).length} judged`);
  }
  (out.brands as Record<string, unknown>)[t.brand] = { runId: run.id, runs };
}
out.usage = await localUsage();
out.errors = errors;
fs.writeFileSync(`${outDir("health")}/${ARM}.json`, JSON.stringify(out, null, 1));
await closeProd();
process.exit(0);
