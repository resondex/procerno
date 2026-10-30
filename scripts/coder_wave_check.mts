/**
 * Zero-spend checks of the coding wave on procerno_reason_coder
 * (2026-10-29). No DATABASE_URL (a temp sqlite), no real API key, and
 * globalThis.fetch replaced by a recorder: the Fireworks inference endpoint
 * is a mock (CODER_BASE_URL=http://127.0.0.1:9/v1) and ANY other network
 * call is recorded as a violation and refused - so nothing here can reach a
 * vendor, and every assertion about "no coder call" is counted, not assumed.
 *
 *   npx tsx scripts/coder_wave_check.mts
 *
 * Cases (each through the real entry point, runner.driveRunChunk):
 *  A RUN_COLLECT_ONLY parks the run at "collected" before any coder call
 *  B no FIREWORKS_API_KEY: coding_blocked with a clear message, zero calls
 *  C no coder inputs recorded: coding_blocked before any call
 *  D the deployment is absent from the Fireworks list: coding_blocked, the
 *    app never creates it, zero inference calls
 *  E a single-pass wave: the trained request params, byte-exact design
 *    lines, split-JSON merge, off-list codes moved to uncoded, a terminal
 *    contract failure recorded and never re-sent, contractless cells left
 *    uncoded, ledger rows (tokens at cost 0 + GPU estimates), and the
 *    finalize new-name queue reading the coder's mentions
 *  F two-pass routing: adapter reasons merged, awareness rows skip pass 2,
 *    an adapter failure degrades to pass 1's reasons with the contract flag
 *  G a reasons adapter trained from another base is refused
 *  H a scaled-to-zero deployment still waking: the chunk returns "continue"
 *    (no coding, no failure); past the wake window the wave is blocked
 *  I replies breaking the contract on most rows: the wave is blocked as an
 *    outage and those rows are NOT recorded as terminal failures
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = "/Users/tylersolloway/Documents/GitHub/procerno";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "procerno-coder-wave-"));
delete process.env.DATABASE_URL;
for (const k of Object.keys(process.env)) if (/_API_KEY$/.test(k)) delete process.env[k];
delete process.env.RUN_COLLECT_ONLY;
delete process.env.CODER_BASE_URL;
// Engine availability only (run.models must be "available"); never used -
// the fetch recorder refuses every non-mock URL.
process.env.OPENAI_API_KEY = "sk-unused-by-this-check";
process.env.SQLITE_PATH = path.join(TMP, "check.db");
process.env.CODER_DEPLOYMENT = "procerno-prod-coder";
process.env.FIREWORKS_ACCOUNT = "acct-check";
process.chdir(TMP);

// ---------------------------------------------------------------- fetch recorder
type Call = { url: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
const violations: string[] = [];
const MOCK = "http://127.0.0.1:9/v1";
let mgmtDeployments: unknown = { deployments: [] };
let adapterFails = new Set<string>();
let mockMode: "normal" | "waking" | "garbage" = "normal";
const realFetch = globalThis.fetch;
void realFetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ url, body });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://api.fireworks.ai/v1/accounts/acct-check/deployments")) return json(mgmtDeployments);
  if (url.startsWith("https://api.fireworks.ai/v1/accounts/acct-check/deployedModels")) return json({ deployedModels: [] });
  if (url === `${MOCK}/chat/completions`) return mockCoder(body as { model: string; messages: { role: string; content: string }[]; max_tokens: number });
  violations.push(url);
  throw new Error(`coder_wave_check: refused network call to ${url}`);
}) as typeof fetch;

/** Replies shaped like the trained coder's, keyed on markers in the answer. */
function mockCoder(b: { model: string; messages: { role: string; content: string }[]; max_tokens: number }): Response {
  const system = b.messages[0].content;
  const user = b.messages[1]?.content ?? "";
  const isAdapter = /-sd2#/.test(b.model);
  const ok = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 3000, completion_tokens: 120, total_tokens: 3120 } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  if (mockMode === "waking") return new Response("deployment scaling up", { status: 503 });
  if (b.max_tokens === 5) return ok("ok"); // probe
  if (mockMode === "garbage") return ok("not json at all");
  if (isAdapter) {
    if ([...adapterFails].some((m) => user.includes(m))) return new Response("upstream error", { status: 500 });
    return ok(JSON.stringify({ outcome: "pick", reasons: ["price", "battery life"], uncoded_reason: "adapter-only attribute" }));
  }
  const flags = { clarification_requested: false, includes_prices: true, includes_specs: false };
  const mentions = [{ brand: "Beta Corp", framing: "mentioned" }, { brand: "Acme", framing: "recommended" }];
  if (user.includes("[[BAD]]")) return ok("Sorry, I can't code this answer.");
  if (system.includes('"category_routed"')) {
    return ok(JSON.stringify({ category_routed: "category", topics: ["battery life"], uncoded_topic: "", quote: null, mentions, ...flags }));
  }
  if (system.includes('"relationship_verdict"')) {
    return ok(JSON.stringify({ stage: "advocacy", relationship_verdict: "strengthens", redirect_to: [], case_strength: "strong", growth_stance: null, pairings: null, decision_rules: null, premise_verdict: "rebuts", premise_quote: "it lasts", mentions, ...flags, reasons: ["battery life"], uncoded_reason: "", quote: "it lasts" }));
  }
  if (system.includes('"keep_or_leave"')) {
    return ok(JSON.stringify({ keep_or_leave: "keep", destinations: [], premise_verdict: "mixed", premise_quote: "sometimes", reasons: ["price"], uncoded_reason: "", quote: "stay", mentions, ...flags }));
  }
  const full = { outcome: "pick", top_pick: "Acme", reasons: ["battery life", "durability"], uncoded_reason: "", quote: "get Acme", decision_rules: [{ condition: "if you travel", choice: "Beta Corp" }], mentions, ...flags };
  if (user.includes("[[SPLIT]]")) {
    return ok(JSON.stringify({ ...full, reasons: [] }) + "\n" + JSON.stringify({ reasons: ["price"], uncoded_reason: "" }));
  }
  return ok(JSON.stringify(full));
}

// ---------------------------------------------------------------- app modules
const { store } = await import(`${REPO}/src/lib/store/index.ts`);
const { driveRunChunk, finalizeRun } = await import(`${REPO}/src/lib/engine/runner.ts`);
const { coderFailKey, coderBlockKey } = await import(`${REPO}/src/lib/engine/coding_wave.ts`);
const { forgetCoderReadiness } = await import(`${REPO}/src/lib/engine/coder_deployment.ts`);
const { systemFor, parseCoderInputs, resolveCodebook } = await import(`${REPO}/src/lib/engine/coder_prompts.ts`);
const Better = (await import("better-sqlite3")).default;

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && detail ? ` - ${detail}` : ""}`);
  if (!cond) failures++;
};
const inferenceCalls = () => calls.filter((c) => c.url === `${MOCK}/chat/completions` && (c.body as { max_tokens?: number })?.max_tokens !== 5);
/** The recorded block reason (runs.error is not written on "collected"). */
const blockMsg = async (runId: string) => {
  const raw = await store.cacheGet(coderBlockKey(runId), 1e12);
  return raw ? (JSON.parse(raw) as { message: string }).message : "";
};
const settle = () => new Promise((r) => setTimeout(r, 150)); // fire-and-forget ledger writes

const PROPOSAL = JSON.stringify({ codes: [
  { code: "battery life", why: "How long a charge lasts between plug-ins." },
  { code: "price", why: "What the buyer pays up front and over time." },
] });
async function tracker(name: string, opts: { inputs?: boolean; adapter?: string | null } = {}) {
  const p = await store.createProject({ name, brand: "Acme", competitors: ["Beta Corp"], category: "widgets", audience: null, userId: null, reasonTaxonomy: [], engineSet: ["gpt-6-luna"] });
  await store.setTaxonomyProposal(p.id, PROPOSAL);
  await store.ratifyTaxonomy(p.id, ["battery life", "price"], JSON.stringify({ decisions: [], merges: {}, phrase_moves: {} }));
  const intents = await store.insertIntents(p.id, [
    { stage: "discovery", layer: "consideration", situation: null, angle: "generic", text: "seed" },
    { stage: "discovery", layer: "consideration", situation: null, angle: "generic", text: "seed split" },
    { stage: "discovery", layer: "consideration", situation: null, angle: "generic", text: "seed bad" },
    { stage: "problem_recognition", layer: "awareness", situation: null, angle: "generic", text: "seed aware" },
    { stage: "churn_triggers", layer: "retention", situation: null, angle: "generic", concern: "Battery fades fast", text: "seed churn" },
    { stage: "advocacy", layer: "loyalty", situation: null, angle: "generic", text: "seed advocacy" },
    { stage: "shortlist", layer: "consideration", situation: null, angle: "generic", text: "retired stage" },
  ]);
  const prompts = await store.insertPrompts(p.id, intents.map((i: { id: string; text: string }, k: number) => ({ text: `Question ${k} about widgets?`, theme: "branded", intentId: i.id })));
  const run = await store.createRun({ projectId: p.id, model: "gpt-6-luna", models: ["gpt-6-luna"], repeats: 1 });
  const markers = ["Acme lasts all day.", "[[SPLIT]] Acme is cheaper.", "[[BAD]] nothing", "Widgets explained. [[AWARE]]", "Keep Acme. [[ADAPTERFAIL]]", "Defend Acme.", "Shortlist answer."];
  for (let k = 0; k < prompts.length; k++) {
    await store.insertResponse({ runId: run.id, promptId: prompts[k].id, repeatIdx: 0, model: "gpt-6-luna", finishReason: "stop", text: markers[k], mentions: [], coding: null });
  }
  await store.updateRunStatus(run.id, "collected");
  const adv = intents.find((i: { stage: string }) => i.stage === "advocacy")!;
  if (opts.inputs !== false) {
    await store.setCoderInputs(p.id, JSON.stringify({ version: 1, flag_vocab: { price: ["$10"], spec: ["10 hours"] }, critic: { [adv.id]: "it never lasts" } }));
  }
  if (opts.adapter) await store.setReasonsAdapter(p.id, opts.adapter);
  const resp = await store.listResponseMeta(run.id);
  const byText = new Map<string, string>();
  for (const t of await store.getResponseTexts(resp.map((r: { id: string }) => r.id))) byText.set(t.text, t.id);
  return { project: p, run, ids: markers.map((m) => byText.get(m)!) };
}
const sqlite = () => new Better(process.env.SQLITE_PATH!, { readonly: true });

// ---------------------------------------------------------------- A: the hold
{
  const t = await tracker("A");
  process.env.RUN_COLLECT_ONLY = "1";
  process.env.FIREWORKS_API_KEY = "fw-mock-key";
  process.env.CODER_BASE_URL = MOCK;
  const n0 = calls.length;
  const out = await driveRunChunk(t.run.id, 60_000);
  const run = await store.getRun(t.run.id);
  check("A RUN_COLLECT_ONLY: chunk parks (coding_blocked)", out === "coding_blocked", out);
  check("A RUN_COLLECT_ONLY: zero network calls (no coder call, no probe)", calls.length === n0, `${calls.length - n0} calls`);
  check("A RUN_COLLECT_ONLY: run stays collected", run?.status === "collected", `${run?.status}`);
  check("A RUN_COLLECT_ONLY: no answer_codes written", (await store.listAnswerCodes(t.run.id, "coder:v0-5")).length === 0);
  delete process.env.RUN_COLLECT_ONLY;
}
// ---------------------------------------------------------------- B: no key
{
  const t = await tracker("B");
  delete process.env.FIREWORKS_API_KEY;
  const n0 = calls.length;
  const out = await driveRunChunk(t.run.id, 60_000);
  const run = await store.getRun(t.run.id);
  check("B no FIREWORKS_API_KEY: coding_blocked", out === "coding_blocked", out);
  check("B no FIREWORKS_API_KEY: zero network calls", calls.length === n0);
  check("B no FIREWORKS_API_KEY: run stays collected; the recorded reason says so", run?.status === "collected" && /FIREWORKS_API_KEY is not set/.test(await blockMsg(t.run.id)), await blockMsg(t.run.id));
  check("B no FIREWORKS_API_KEY: nothing written", (await store.listAnswerCodes(t.run.id, "coder:v0-5")).length === 0);
}
// ---------------------------------------------------------------- C: no inputs
{
  const t = await tracker("C", { inputs: false });
  process.env.FIREWORKS_API_KEY = "fw-mock-key";
  const n0 = calls.length;
  const out = await driveRunChunk(t.run.id, 60_000);
  const run = await store.getRun(t.run.id);
  check("C no coder inputs: coding_blocked before any call", out === "coding_blocked" && calls.length === n0, `${out} calls ${calls.length - n0}`);
  check("C no coder inputs: the recorded reason names coder_inputs", run?.status === "collected" && /coder_inputs/.test(await blockMsg(t.run.id)), await blockMsg(t.run.id));
}
// ---------------------------------------------------------------- D: no deployment
{
  const t = await tracker("D");
  delete process.env.CODER_BASE_URL; // the real https endpoint shape; management API answered by the recorder
  mgmtDeployments = { deployments: [] };
  const n0 = calls.length;
  const out = await driveRunChunk(t.run.id, 60_000);
  const run = await store.getRun(t.run.id);
  const made = calls.slice(n0);
  check("D absent deployment: coding_blocked", out === "coding_blocked", out);
  check("D absent deployment: the recorded reason says the app never provisions", run?.status === "collected" && /does not exist[\s\S]*never provisions/.test(await blockMsg(t.run.id)), await blockMsg(t.run.id));
  check("D absent deployment: only read-only management GETs, no inference, no create", made.every((c) => c.body === null && c.url.includes("/v1/accounts/")) && made.length >= 1, JSON.stringify(made.map((c) => c.url)));
  process.env.CODER_BASE_URL = MOCK;
}
// ---------------------------------------------------------------- E: single-pass wave
let eTracker: Awaited<ReturnType<typeof tracker>>;
{
  const t = (eTracker = await tracker("E"));
  adapterFails = new Set();
  const n0 = calls.length;
  const out = await driveRunChunk(t.run.id, 120_000);
  await settle();
  const made = calls.slice(n0).filter((c) => c.url === `${MOCK}/chat/completions`);
  const probes = made.filter((c) => (c.body as { max_tokens: number }).max_tokens === 5);
  const coderCalls = made.filter((c) => (c.body as { max_tokens: number }).max_tokens !== 5);
  check("E wave: chunk outcome finalize", out === "finalize", out);
  check("E wave: probed before coding (reasoning_effort none)", probes.length === 1 && (probes[0].body as { reasoning_effort?: string }).reasoning_effort === "none");
  check("E wave: 6 coder calls (contractless shortlist never sent)", coderCalls.length === 6, `${coderCalls.length}`);
  const b0 = coderCalls[0].body as Record<string, unknown>;
  check("E wave: trained params (temperature 0, reasoning none, max_tokens 2048, 2 messages)",
    b0.temperature === 0 && b0.reasoning_effort === "none" && b0.max_tokens === 2048 && (b0.messages as unknown[]).length === 2);
  check("E wave: routed model id <coder>#<deployment>", b0.model === "accounts/acct-check/models/procerno-reason-coder-v0-5#accounts/acct-check/deployments/procerno-prod-coder", String(b0.model));
  const project = await store.getProject(t.project.id);
  const inputs = parseCoderInputs(await store.getCoderInputs(t.project.id));
  const book = resolveCodebook(project!, inputs);
  const ctx = { brand: "Acme", codes: book.codes, defs: book.defs, inputs };
  const advCall = coderCalls.find((c) => String((c.body as { messages: { content: string }[] }).messages[1].content).includes("Defend Acme."))!;
  const advUser = (advCall.body as { messages: { content: string }[] }).messages[1].content;
  check("E wave: advocacy user message = settled line + critic line + question",
    advUser.startsWith('Question design (settled customer, advocacy): a customer recommending or defending Acme to someone else.\nQuestion design (doubt): the customer quotes a criticism someone raised about Acme. Criticism: "it never lasts"\n\nQuestion: '), advUser.slice(0, 260));
  check("E wave: advocacy system = the settled template filled", (advCall.body as { messages: { content: string }[] }).messages[0].content === systemFor("advocacy", ctx));
  const churnCall = coderCalls.find((c) => String((c.body as { messages: { content: string }[] }).messages[1].content).includes("Keep Acme."))!;
  const churnUser = (churnCall.body as { messages: { content: string }[] }).messages[1].content;
  check("E wave: churn user message = stance line (with worry) + doubt line",
    churnUser.startsWith('Question design (keep or leave, churn_triggers): the asker is a current Acme customer with a worry, deciding whether to keep Acme or leave. Worry: "Battery fades fast"\nQuestion design (doubt): the question voices a concern about Acme. Doubt: "Battery fades fast"\n\nQuestion: '), churnUser.slice(0, 300));
  const rows = await store.listAnswerCodes(t.run.id, "coder:v0-5");
  const byId = new Map(rows.map((r: { response_id: string }) => [r.response_id, r]));
  check("E wave: 5 rows written under coder:v0-5", rows.length === 5, `${rows.length}`);
  const r1 = byId.get(t.ids[0]) as Record<string, unknown> | undefined;
  check("E wave: off-list code moved to uncoded", JSON.stringify(r1?.reasons) === '["battery life"]' && r1?.uncoded === "durability", JSON.stringify([r1?.reasons, r1?.uncoded]));
  check("E wave: decision_rules + ranked mentions stored", JSON.stringify(r1?.decision_rules) === '[{"condition":"if you travel","choice":"Beta Corp"}]' &&
    JSON.stringify(r1?.mentions) === '[{"brand":"Acme","framing":"recommended","rank":1},{"brand":"Beta Corp","framing":"mentioned","rank":2}]', JSON.stringify([r1?.decision_rules, r1?.mentions]));
  const r2 = byId.get(t.ids[1]) as Record<string, unknown> | undefined;
  check("E wave: split JSON merged (later object wins reasons)", JSON.stringify(r2?.reasons) === '["price"]' && r2?.outcome === "pick", JSON.stringify(r2));
  check("E wave: contract failure not written", !byId.has(t.ids[2]));
  check("E wave: contract failure recorded terminal", (await store.cacheGet(coderFailKey("coder:v0-5", t.ids[2]), 1e12)) !== null);
  const r4 = byId.get(t.ids[3]) as Record<string, unknown> | undefined;
  check("E wave: awareness row carries topics, no reasons/outcome", JSON.stringify(r4?.topics) === '["battery life"]' && r4?.reasons === null && r4?.outcome === null, JSON.stringify(r4));
  const r6 = byId.get(t.ids[5]) as Record<string, unknown> | undefined;
  check("E wave: Set C advocacy row (premise kept, unasked fields null)", r6?.case_strength === "strong" && r6?.premise_verdict === "rebuts" && r6?.growth_stance === null && r6?.decision_rules === null, JSON.stringify(r6));
  check("E wave: contract id on rows", rows.every((r: { contract: string }) => r.contract === "v04_prompts_2026-10-29"));
  check("E wave: contractless row left uncoded", !byId.has(t.ids[6]));
  const db = sqlite();
  const ledger = db.prepare("select purpose, model, engine, input_tokens, output_tokens, cost_usd, vendor_cost_usd, usage_raw from cost_log where run_id = ?").all(t.run.id) as Record<string, unknown>[];
  db.close();
  const perCall = ledger.filter((l) => l.engine === "fireworks:procerno-reason-coder-v0-5");
  const gpu = ledger.filter((l) => l.engine === "fireworks:gpu");
  check("E ledger: one run:coding row per coder call, tokens kept, cost 0", perCall.length === 6 && perCall.every((l) => l.purpose === "run:coding" && l.input_tokens === 3000 && l.output_tokens === 120 && l.cost_usd === 0), JSON.stringify(perCall.slice(0, 1)));
  check("E ledger: GPU estimate rows (chunk + idle tail), purpose run:coding", gpu.length === 2 && gpu.every((l) => l.purpose === "run:coding" && Number(l.cost_usd) > 0) &&
    gpu.some((l) => /"idle_tail"/.test(String(l.usage_raw))) && gpu.some((l) => /"chunk"/.test(String(l.usage_raw))), JSON.stringify(gpu.map((l) => [l.cost_usd, String(l.usage_raw).slice(0, 80)])));
  check("E ledger: no non-coder spend rows", ledger.every((l) => l.purpose === "run:coding"), JSON.stringify(ledger.map((l) => l.purpose)));
  // Re-drive: nothing left to send (the failure is terminal, the shortlist contractless).
  const n1 = inferenceCalls().length;
  const again = await driveRunChunk(t.run.id, 60_000);
  check("E re-drive: finalize with zero new coder calls", again === "finalize" && inferenceCalls().length === n1, `${again} ${inferenceCalls().length - n1}`);
}
// ---------------------------------------------------------------- F: two-pass
{
  const t = await tracker("F", { adapter: "procerno-reason-coder-v0-5-test-sd2" });
  adapterFails = new Set(["[[ADAPTERFAIL]]"]);
  const n0 = calls.length;
  const out = await driveRunChunk(t.run.id, 120_000);
  await settle();
  const made = calls.slice(n0).filter((c) => c.url === `${MOCK}/chat/completions` && (c.body as { max_tokens: number }).max_tokens !== 5);
  const adapterCalls = made.filter((c) => /-sd2#/.test(String((c.body as { model: string }).model)));
  const source = "coder:v0-5+test-sd2";
  const rows = await store.listAnswerCodes(t.run.id, source);
  const byId = new Map(rows.map((r: { response_id: string }) => [r.response_id, r]));
  check("F two-pass: finalize, rows under coder:v0-5+test-sd2", out === "finalize" && rows.length === 5, `${out} ${rows.length}`);
  const r1 = byId.get(t.ids[0]) as Record<string, unknown> | undefined;
  check("F two-pass: reasons + uncoded from the adapter, judgment from the base",
    JSON.stringify(r1?.reasons) === '["price","battery life"]' && r1?.uncoded === "adapter-only attribute" && r1?.outcome === "pick" && r1?.top_pick === "Acme", JSON.stringify(r1));
  const sentToAdapter = adapterCalls.map((c) => String((c.body as { messages: { content: string }[] }).messages[1].content));
  check("F two-pass: awareness row never sent to the adapter", !sentToAdapter.some((u) => u.includes("[[AWARE]]")));
  check("F two-pass: adapter gets the identical request (system + user)", adapterCalls.every((a) => made.some((b) => b !== a &&
    JSON.stringify((b.body as { messages: unknown }).messages) === JSON.stringify((a.body as { messages: unknown }).messages))));
  const r5 = byId.get(t.ids[4]) as Record<string, unknown> | undefined;
  check("F two-pass: adapter failure degrades to pass-1 reasons, flagged", JSON.stringify(r5?.reasons) === '["price"]' && r5?.contract === "v04_prompts_2026-10-29;reasons:base", JSON.stringify(r5));
  check("F two-pass: failed adapter call retried once (2 attempts)", sentToAdapter.filter((u) => u.includes("[[ADAPTERFAIL]]")).length === 2);
}
// ---------------------------------------------------------------- G: base mismatch
{
  const t = await tracker("G", { adapter: "procerno-reason-coder-v0-4-old-sd2" });
  const n0 = calls.length;
  const out = await driveRunChunk(t.run.id, 60_000);
  const run = await store.getRun(t.run.id);
  check("G foreign-base adapter: refused before any call", out === "coding_blocked" && run?.status === "collected" && calls.length === n0 && /not trained from the configured coder/.test(await blockMsg(t.run.id)), `${out} ${await blockMsg(t.run.id)}`);
}
// ---------------------------------------------------------------- H: waking
{
  const t = await tracker("H");
  forgetCoderReadiness();
  mockMode = "waking";
  const n0 = calls.length;
  const out = await driveRunChunk(t.run.id, 20_000);
  const madeH = calls.slice(n0).filter((c) => c.url === `${MOCK}/chat/completions`);
  const rows = await store.listAnswerCodes(t.run.id, "coder:v0-5");
  const run = await store.getRun(t.run.id);
  check("H waking deployment: chunk continues, codes nothing, run not blocked", out === "continue" && rows.length === 0 && run?.status === "collected" && !(await blockMsg(t.run.id)), `${out} ${rows.length} ${await blockMsg(t.run.id)}`);
  check("H waking deployment: probes only, no coder call", madeH.length >= 1 && madeH.every((c) => (c.body as { max_tokens: number }).max_tokens === 5), `${madeH.length}`);
  await store.cacheSet(`coder_wake:${t.run.id}`, String(Date.now() - 25 * 60_000));
  const out2 = await driveRunChunk(t.run.id, 20_000);
  check("H waking past the window: blocked with the deployment named", out2 === "coding_blocked" && /did not become routable/.test(await blockMsg(t.run.id)), `${out2} ${await blockMsg(t.run.id)}`);
  mockMode = "normal";
}
// ---------------------------------------------------------------- I: contract outage
{
  const t = await tracker("I");
  const extra = await store.insertIntents(t.project.id, Array.from({ length: 34 }, (_, k) => ({ stage: "discovery", layer: "consideration", situation: null, angle: "generic", text: `extra ${k}` })));
  const ps = await store.insertPrompts(t.project.id, extra.map((i: { id: string }, k: number) => ({ text: `Extra question ${k}?`, theme: "branded", intentId: i.id })));
  for (const p of ps) await store.insertResponse({ runId: t.run.id, promptId: p.id, repeatIdx: 0, model: "gpt-6-luna", finishReason: "stop", text: "Some answer.", mentions: [], coding: null });
  forgetCoderReadiness();
  mockMode = "garbage";
  const out = await driveRunChunk(t.run.id, 60_000);
  const resp = await store.listResponseMeta(t.run.id);
  const recorded = await store.cacheGetMany(resp.map((r: { id: string }) => coderFailKey("coder:v0-5", r.id)), 1e12);
  check("I contract outage: blocked as an outage", out === "coding_blocked" && /break the trained contract/.test(await blockMsg(t.run.id)), `${out} ${await blockMsg(t.run.id)}`);
  check("I contract outage: no row recorded terminal (retried once fixed)", recorded.size === 0, `${recorded.size}`);
  mockMode = "normal";
}
// ---------------------------------------------------------------- finalize queue
{
  delete process.env.OPENAI_API_KEY; // finalize's model steps fail fast and are guarded
  await store.updateRunStatus(eTracker!.run.id, "running");
  await finalizeRun(eTracker!.run.id).catch(() => {});
  const dict = await store.getDictionary(eTracker!.project.id);
  check("finalize: new names queued from the coder's answer_codes mentions", dict.some((e: { canonical: string }) => e.canonical === "Beta Corp"), JSON.stringify(dict.map((e: { canonical: string; status: string }) => [e.canonical, e.status])));
}

check("no network call escaped the recorder", violations.length === 0, violations.join(", "));
(globalThis as { __procerno_db?: { close(): void } }).__procerno_db?.close();
fs.rmSync(TMP, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nall coding-wave checks passed (zero spend: every network call was the mock or refused)");
process.exit(0);
