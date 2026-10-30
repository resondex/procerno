/**
 * Hand-run coding driver (2026-10-29, Tyler: "go code it with opus and our
 * coder so the data is full"): codes HELD collected runs in-process against
 * prod through the real wave path (runner.codeCollectedChunk ->
 * coding_wave.codeWaveChunk), so every guard, ledger row and answer_codes
 * write is the app's own. What it does NOT do: finalize. A run whose wave
 * returns "finalize" stops there and stays at status "collected" - no
 * "complete" flip, no finalize warms.
 *
 *   npx tsx scripts/code_runs.mts <run id> <expected project id> [<run id> <project id> ...]
 *
 * Hard-pinned: each run must belong to its expected project, the project
 * must be live (not archived) with a ratified codebook, and the run must be
 * "collected". Only DATABASE_URL and FIREWORKS_API_KEY are loaded from
 * .env.local - no answer-engine key, so nothing here can collect.
 * RUN_COLLECT_ONLY is cleared in this process only. Each chunk holds the
 * run's drive lease (run_drive:<id>), like driveAndChain. The scale-to-zero
 * idle tail is ledgered once, on the last run's last chunk
 * (CODER_IDLE_TAIL_HOURS=0 for the others). Aborts when the ledgered GPU
 * estimate since start exceeds MAX_GPU_USD (default 30).
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^(DATABASE_URL|FIREWORKS_API_KEY)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.RUN_COLLECT_ONLY;
const MAX_GPU_USD = Number(process.env.MAX_GPU_USD ?? 30);
const CHUNK_MS = Number(process.env.CHUNK_MS ?? 220_000);

const args = process.argv.slice(2);
if (!args.length || args.length % 2) {
  console.error("usage: code_runs.mts <run id> <project id> [...]");
  process.exit(2);
}
const pairs: [string, string][] = [];
for (let i = 0; i < args.length; i += 2) pairs.push([args[i], args[i + 1]]);

const { store } = await import("../src/lib/store");
const { codeCollectedChunk, claimRunLease, releaseRunLease } = await import("../src/lib/engine/runner");
const { withCostContext } = await import("../src/lib/cost_log");
const { coderBlockKey } = await import("../src/lib/engine/coding_wave");
const { coderSource } = await import("../src/lib/engine/coder");
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1, prepare: false });
const startedAt = new Date();
const gpuSpent = async () =>
  Number(((await sql.begin("read only", (tx) =>
    tx`select coalesce(sum(vendor_cost_usd),0)::float8 usd from cost_log where engine = 'fireworks:gpu' and created_at >= ${startedAt}`)) as unknown as { usd: number }[])[0].usd);
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

// Pin everything before any spend.
for (const [runId, pid] of pairs) {
  const run = await store.getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.project_id !== pid) throw new Error(`run ${runId} belongs to ${run.project_id}, not ${pid}`);
  if (run.status !== "collected") throw new Error(`run ${runId} is ${run.status}, not collected`);
  const project = await store.getProject(pid);
  if (!project || project.archived_at) throw new Error(`project ${pid} missing or archived`);
  if (project.taxonomy_status !== "ratified") throw new Error(`project ${pid} codebook is ${project.taxonomy_status}`);
}

let aborted = false;
for (let k = 0; k < pairs.length && !aborted; k++) {
  const [runId, pid] = pairs[k];
  process.env.CODER_IDLE_TAIL_HOURS = k === pairs.length - 1 ? "1" : "0";
  const project = (await store.getProject(pid))!;
  const source = coderSource(await store.getReasonsAdapter(pid));
  const expected = (await store.listResponseMeta(runId)).length;
  const t0 = Date.now();
  log(`== ${project.brand} run ${runId.slice(0, 8)} -> ${source} (${expected} answers)`);
  for (let chunk = 1; chunk <= 200; chunk++) {
    const leaseKey = `run_drive:${runId}`;
    let token: string | null = null;
    for (let w = 0; w < 40 && !token; w++) {
      token = await claimRunLease(leaseKey);
      if (!token) {
        log(`lease ${leaseKey} held elsewhere - waiting`);
        await new Promise((r) => setTimeout(r, 15_000));
      }
    }
    if (!token) throw new Error(`could not claim ${leaseKey}`);
    let outcome: string;
    try {
      const run = (await store.getRun(runId))!;
      if (run.status !== "collected") throw new Error(`run ${runId} moved to ${run.status} - stopping`);
      outcome = await withCostContext({ projectId: pid, runId }, () =>
        codeCollectedChunk(runId, run.status, project, Date.now() + CHUNK_MS, { expected })
      );
    } finally {
      await releaseRunLease(leaseKey, token);
    }
    const done = (await store.listAnswerCodeIds(runId, source)).length;
    await new Promise((r) => setTimeout(r, 2_000)); // let fire-and-forget ledger rows land
    const usd = await gpuSpent();
    log(`chunk ${chunk}: ${outcome}; coded ${done}/${expected}; GPU estimate since start $${usd.toFixed(2)}`);
    if (usd > MAX_GPU_USD) {
      log(`ABORT: GPU estimate $${usd.toFixed(2)} over the $${MAX_GPU_USD} cap`);
      aborted = true;
      break;
    }
    if (outcome === "continue") continue;
    if (outcome === "coding_blocked") {
      log(`BLOCKED: ${(await store.cacheGet(coderBlockKey(runId), 3600_000)) ?? "(no block note)"}`);
      aborted = true;
    }
    break; // "finalize" (done - NOT finalized here) or blocked
  }
  log(`== ${project.brand} done in ${Math.round((Date.now() - t0) / 60_000)} min`);
}
await new Promise((r) => setTimeout(r, 5_000));
log(`total GPU estimate since start $${(await gpuSpent()).toFixed(2)}${aborted ? " (ABORTED)" : ""}`);
await sql.end();
process.exit(aborted ? 1 : 0);
