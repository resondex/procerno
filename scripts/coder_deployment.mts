/**
 * Admin lifecycle for the coder's STANDING scale-to-zero Fireworks
 * deployment (2026-10-29). HAND-RUN ONLY for anything that bills: the app
 * never creates, binds or deletes - a wave against a missing or unbound
 * deployment fails loudly (src/lib/engine/coder_deployment.ts explains the
 * standing-deployment choice).
 *
 *   npx tsx scripts/coder_deployment.mts <subcommand> [model]
 *
 * READ-ONLY (safe anywhere):
 *   status            deployment state (from the LIST - the authority) + bound models
 *   probe <model>     one 5-token request (reasoning_effort none) until routable;
 *                     wakes a scaled-to-zero replica (bills while it is up)
 *   verify-deleted    exit 0 only when the deployment is ABSENT from the list
 * MUTATING (terminal + typed confirmation of the deployment id):
 *   create            1x H100 80GB, BF16, enableAddons, minReplicaCount 0,
 *                     maxReplicaCount 1 - idles to zero after ~1h with no traffic
 *   bind <model>      bind a LoRA (the coder, or a tracker's reasons adapter);
 *                     re-POSTs until the deployedModels list shows DEPLOYED
 *   unbind <model>    remove one bound model
 *   teardown          unbind everything + delete, repeated until the deployment
 *                     is ABSENT from the list (DELETING is not terminal - the
 *                     2026-10-26 zombie incident)
 *
 * Env: FIREWORKS_API_KEY (or .env.local), FIREWORKS_ACCOUNT, CODER_DEPLOYMENT
 * (default procerno-prod-coder). minReplicaCount > 0 is refused unless
 * TYLER_APPROVED_KEEP_WARM=1 MIN_REPLICAS=<n>.
 *
 * NOTE: the daily fireworks-deployment-watchdog alerts on ANY listed
 * deployment; with a standing deployment it will report this one every day
 * (expected - its line should show scale 0 when idle).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^(FIREWORKS_API_KEY|FIREWORKS_ACCOUNT|CODER_DEPLOYMENT)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { FIREWORKS_ACCOUNT, CODER_DEPLOYMENT, deploymentState, boundModels, probeOnce } = await import("../src/lib/engine/coder_deployment");

const KEY = process.env.FIREWORKS_API_KEY;
if (!KEY) {
  console.error("FIREWORKS_API_KEY not set");
  process.exit(1);
}
const DEP = CODER_DEPLOYMENT;
const API = `https://api.fireworks.ai/v1/accounts/${FIREWORKS_ACCOUNT}`;
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [cmd = "status", model] = process.argv.slice(2);

async function confirm(action: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`REFUSED: '${action}' changes billed Fireworks resources and must be run by hand in a terminal.`);
    process.exit(4);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${action} deployment '${DEP}' (billed). Type the deployment id to confirm: `);
  rl.close();
  if (answer.trim() !== DEP) {
    console.log("not confirmed - nothing done");
    process.exit(4);
  }
}
async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 600) };
}
async function bindingIds(): Promise<{ id: string; model: string }[]> {
  const res = await fetch(`${API}/deployedModels?pageSize=200`, { headers: H });
  const d = (await res.json()) as { deployedModels?: { name: string; model?: string; deployment?: string }[] };
  return (d.deployedModels ?? [])
    .filter((m) => (m.deployment ?? "").endsWith(`/deployments/${DEP}`))
    .map((m) => ({ id: m.name.split("/").pop()!, model: (m.model ?? "").split("/").pop()! }));
}

switch (cmd) {
  case "status": {
    const st = await deploymentState(KEY, DEP);
    console.log(`deployment ${DEP} (account ${FIREWORKS_ACCOUNT}): ${st ?? "ABSENT from the deployments list"}`);
    if (st) for (const [m, s] of await boundModels(KEY, DEP)) console.log(`  bound: ${m} ${s}`);
    break;
  }
  case "probe": {
    if (!model) throw new Error("usage: probe <model>");
    for (let i = 1; i <= 30; i++) {
      const p = await probeOnce(KEY, model, DEP);
      if (p.ok) {
        console.log(`${model} routable on ${DEP} (probe ${i})`);
        process.exit(0);
      }
      console.log(`probe ${i}/30: HTTP ${p.status} ${p.detail}`);
      if (p.status === 401 || p.status === 403) process.exit(1);
      await sleep(20_000);
    }
    console.error(`${model} never became routable on ${DEP}`);
    process.exit(1);
  }
  case "verify-deleted": {
    const st = await deploymentState(KEY, DEP);
    console.log(`deployment ${DEP}: ${st ?? "ABSENT"}`);
    process.exit(st === null ? 0 : 1);
  }
  case "create": {
    const minReplicas = Number(process.env.MIN_REPLICAS ?? 0);
    if (minReplicas !== 0 && process.env.TYLER_APPROVED_KEEP_WARM !== "1") {
      console.error("REFUSED: minReplicaCount > 0 bills the GPU while idle. Scale-to-zero is the default; keep-warm needs TYLER_APPROVED_KEEP_WARM=1.");
      process.exit(1);
    }
    if ((await deploymentState(KEY, DEP)) !== null) {
      console.error(`${DEP} already exists - nothing done`);
      process.exit(2);
    }
    await confirm("create");
    const r = await call("POST", `${API}/deployments?deploymentId=${DEP}&acceptShapelessRisk=true`, {
      displayName: "procerno production coder (standing, scale-to-zero)",
      baseModel: "accounts/fireworks/models/qwen3p5-9b",
      acceleratorType: "NVIDIA_H100_80GB",
      acceleratorCount: 1,
      minReplicaCount: minReplicas,
      maxReplicaCount: 1,
      precision: "BF16",
      enableAddons: true,
    });
    console.log(`HTTP ${r.status} ${r.text}`);
    for (let i = 0; i < 60; i++) {
      const st = await deploymentState(KEY, DEP);
      console.log(`state ${st}`);
      if (st === "READY") break;
      await sleep(20_000);
    }
    console.log(`Next: bind ${"procerno-reason-coder-v0-5"} (and any tracker's reasons adapter), then probe.`);
    break;
  }
  case "bind": {
    if (!model) throw new Error("usage: bind <model>");
    await confirm(`bind ${model} to`);
    for (let i = 1; i <= 20; i++) {
      const state = (await boundModels(KEY, DEP)).get(model);
      console.log(`bind check ${i}: ${state ?? "not bound"}`);
      if (state === "DEPLOYED") {
        console.log(`${model} DEPLOYED on ${DEP}. Next: probe ${model}`);
        process.exit(0);
      }
      if (!state) {
        const r = await call("POST", `${API}/deployedModels`, {
          model: `accounts/${FIREWORKS_ACCOUNT}/models/${model}`,
          deployment: `accounts/${FIREWORKS_ACCOUNT}/deployments/${DEP}`,
          displayName: `${model} on ${DEP}`,
          serverless: false,
        });
        console.log(`  POST HTTP ${r.status} ${r.text.slice(0, 200)}`);
      }
      await sleep(20_000);
    }
    console.error(`BIND FAILED: ${model} never reached DEPLOYED on ${DEP}`);
    process.exit(1);
  }
  case "unbind": {
    if (!model) throw new Error("usage: unbind <model>");
    await confirm(`unbind ${model} from`);
    for (const b of (await bindingIds()).filter((x) => x.model === model)) {
      const r = await call("DELETE", `${API}/deployedModels/${b.id}`);
      console.log(`DELETE ${b.id}: HTTP ${r.status}`);
    }
    break;
  }
  case "teardown": {
    await confirm("teardown");
    for (let i = 1; i <= 40; i++) {
      for (const b of await bindingIds()) await call("DELETE", `${API}/deployedModels/${b.id}`);
      await call("DELETE", `${API}/deployments/${DEP}?ignoreChecks=true`);
      await sleep(20_000);
      const st = await deploymentState(KEY, DEP);
      console.log(`teardown attempt ${i}: ${st ?? "ABSENT"}`);
      if (st === null) {
        console.log(`OK - ${DEP} is absent from the deployments list`);
        process.exit(0);
      }
    }
    console.error(`TEARDOWN FAILED: ${DEP} is still listed - delete it in the Fireworks console and watch the list until it is gone.`);
    process.exit(1);
  }
  default:
    console.error("usage: coder_deployment.mts status|probe <model>|verify-deleted|create|bind <model>|unbind <model>|teardown");
    process.exit(2);
}
process.exit(0);
