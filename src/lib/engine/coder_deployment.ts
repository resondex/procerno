/**
 * The coder's Fireworks deployment, as the APP sees it (2026-10-29):
 * read-only REST checks and a routability probe - nothing here creates,
 * binds, scales or deletes anything. Billed lifecycle actions live only in
 * the hand-run admin script (scripts/coder_deployment.mts).
 *
 * LIFECYCLE CHOICE: one STANDING scale-to-zero deployment (default id
 * procerno-prod-coder: 1x H100 80GB, BF16, enableAddons, minReplicaCount 0,
 * maxReplicaCount 1), created once by hand, with the v0.5 coder and every
 * live tracker's reasons adapter bound to it as addons. Why standing, not
 * per-wave create/teardown:
 *   - the app must never provision billed GPUs on its own (the 2026-10-26
 *     zombie incident: a teardown that silently failed idled ~63h, ~$505);
 *     a wave that cannot find its deployment fails loudly instead;
 *   - scale-to-zero makes idle free: replicas drop to zero after ~1h with no
 *     traffic, so a standing deployment costs only while (and shortly after)
 *     waves run - the same bill as per-wave create, minus the create/bind
 *     latency and the teardown risk on every wave;
 *   - LoRA addons share the one base GPU, so the base and any number of
 *     reasons adapters serve from one deployment (two-pass routing costs
 *     time, not a second GPU).
 * A scaled-to-zero deployment wakes on its first request; the probe below
 * treats 404 / 429 / 5xx as "still waking" and the wave retries it across
 * chunks for a bounded window before declaring an outage.
 */

export const FIREWORKS_ACCOUNT = process.env.FIREWORKS_ACCOUNT ?? "tsolloway-ekhu67i4gj";
export const CODER_DEPLOYMENT = process.env.CODER_DEPLOYMENT ?? "procerno-prod-coder";
const API = () => `https://api.fireworks.ai/v1/accounts/${FIREWORKS_ACCOUNT}`;

/** The inference endpoint. CODER_BASE_URL overrides it for local mocks only
 * (https, or a localhost/127.0.0.1 http URL). */
export function inferenceBaseUrl(): string {
  const raw = (process.env.CODER_BASE_URL ?? "https://api.fireworks.ai/inference/v1").replace(/\/$/, "");
  if (!raw.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(raw)) {
    throw new Error(`CODER_BASE_URL must be https (or a localhost mock): ${raw}`);
  }
  return raw;
}
/** A mock endpoint skips the management API (it has no deployments). */
export const isMockEndpoint = () => inferenceBaseUrl().startsWith("http://");

/** Fully qualified model id the deployment routes: <model>#<deployment>. */
export function routedModelId(model: string, deployment = CODER_DEPLOYMENT): string {
  const m = model.includes("/") ? model : `accounts/${FIREWORKS_ACCOUNT}/models/${model}`;
  const d = deployment.includes("/") ? deployment : `accounts/${FIREWORKS_ACCOUNT}/deployments/${deployment}`;
  return `${m}#${d}`;
}

/** Hard deployment problems: retrying will not fix them. */
export class CoderDeploymentError extends Error {}

async function getJson(url: string, key: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401 || res.status === 403) {
    throw new CoderDeploymentError(`Fireworks rejected the API key (HTTP ${res.status}) reading ${url.replace(/\?.*$/, "")}`);
  }
  if (!res.ok) throw new Error(`Fireworks API HTTP ${res.status} reading ${url.replace(/\?.*$/, "")}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Deployment state, read from the deployments LIST - the authority on
 * presence (a deleted id's GET can keep answering a DELETED tombstone). */
export async function deploymentState(key: string, deployment = CODER_DEPLOYMENT): Promise<string | null> {
  const d = (await getJson(`${API()}/deployments?pageSize=200`, key)) as { deployments?: { name?: string; state?: string }[] };
  const hit = (d.deployments ?? []).find((x) => (x.name ?? "").endsWith(`/deployments/${deployment}`));
  return hit ? hit.state ?? "UNKNOWN" : null;
}

/** model id (short) -> bound state, for the models bound to the deployment. */
export async function boundModels(key: string, deployment = CODER_DEPLOYMENT): Promise<Map<string, string>> {
  const d = (await getJson(`${API()}/deployedModels?pageSize=200`, key)) as {
    deployedModels?: { model?: string; deployment?: string; state?: string }[];
  };
  const out = new Map<string, string>();
  for (const m of d.deployedModels ?? []) {
    if (!(m.deployment ?? "").endsWith(`/deployments/${deployment}`)) continue;
    out.set((m.model ?? "").split("/").pop() ?? "", m.state ?? "UNKNOWN");
  }
  return out;
}

/** One 5-token request in the trained contract's params (reasoning_effort
 * "none": Qwen3.5 thinks by default and would burn even this budget). */
export async function probeOnce(
  key: string,
  model: string,
  deployment = CODER_DEPLOYMENT,
  timeoutMs = 60_000
): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const res = await fetch(`${inferenceBaseUrl()}/chat/completions`, {
      method: "POST",
      // A waking replica can hold the request open; bound it so a chunk's
      // budget is never spent inside one probe.
      signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: routedModelId(model, deployment),
        max_tokens: 5,
        temperature: 0,
        reasoning_effort: "none",
        messages: [{ role: "user", content: "ok" }],
      }),
    });
    const text = res.ok ? "" : (await res.text()).slice(0, 200);
    return { ok: res.ok, status: res.status, detail: text };
  } catch (err) {
    return { ok: false, status: 0, detail: String(err).slice(0, 200) };
  }
}

const READY_MEMO_MS = 5 * 60_000;
const readyUntil = new Map<string, number>();

export type Readiness =
  | { ready: true }
  /** Still waking (scale-from-zero) or transiently unreachable. */
  | { ready: false; waking: true; detail: string };

/**
 * Preflight before any wave call: the deployment exists and is not being
 * deleted, every needed model is bound and DEPLOYED, and each answers a
 * probe. Hard problems throw CoderDeploymentError with the admin command
 * that fixes them; a deployment that is still scaling up returns
 * {ready:false, waking:true} once `deadline` passes. Never provisions.
 */
export async function checkCoderReady(key: string, models: string[], deadline: number, deployment = CODER_DEPLOYMENT): Promise<Readiness> {
  const need = models.filter((m) => (readyUntil.get(`${deployment}|${m}`) ?? 0) < Date.now());
  if (!need.length) return { ready: true };
  if (!isMockEndpoint()) {
    const state = await deploymentState(key, deployment);
    if (state === null) {
      throw new CoderDeploymentError(
        `coder deployment ${deployment} does not exist on Fireworks account ${FIREWORKS_ACCOUNT}. ` +
          `The app never provisions GPUs: create it by hand with scripts/coder_deployment.mts create, then bind the models.`
      );
    }
    if (/DELET/.test(state)) throw new CoderDeploymentError(`coder deployment ${deployment} is ${state}`);
    const bound = await boundModels(key, deployment);
    const unbound = need.filter((m) => bound.get(m) !== "DEPLOYED");
    if (unbound.length) {
      throw new CoderDeploymentError(
        `model(s) not DEPLOYED on ${deployment}: ${unbound.map((m) => `${m} (${bound.get(m) ?? "not bound"})`).join(", ")}. ` +
          `Bind with scripts/coder_deployment.mts bind <model>.`
      );
    }
  }
  let last = "";
  for (const m of need) {
    for (let attempt = 1; ; attempt++) {
      const p = await probeOnce(key, m, deployment, Math.min(60_000, deadline - Date.now()));
      if (p.ok) {
        readyUntil.set(`${deployment}|${m}`, Date.now() + READY_MEMO_MS);
        break;
      }
      if (p.status === 401 || p.status === 403) throw new CoderDeploymentError(`Fireworks rejected the API key probing ${m} (HTTP ${p.status})`);
      if (p.status === 400) throw new CoderDeploymentError(`probe of ${m} on ${deployment} was refused (HTTP 400): ${p.detail}`);
      // 404 right after a bind (DEPLOYED can precede routability), 429 / 5xx
      // while a scaled-to-zero replica comes up, 0 = network.
      last = `${m}: HTTP ${p.status} ${p.detail}`;
      if (Date.now() + 15_000 >= deadline) return { ready: false, waking: true, detail: last };
      await new Promise((r) => setTimeout(r, Math.min(15_000, 2_000 * attempt)));
    }
  }
  return { ready: true };
}

/** Forget memoized readiness (tests; a wave that hit a transport outage). */
export function forgetCoderReadiness(): void {
  readyUntil.clear();
}
