// One-off (2026-11-12, Tyler's go): Opus reference labels for the name-order replacement wordings on
// the trackers whose dashboards read ref:opus-5-5 (Doritos, Netflix, Google Pixel). Two stored request
// templates per old wording, with only the question and answer swapped: the v2 choice label and the
// drc3 decision-rules recode. Batch API. Steps: build | submit | poll | write [--write].
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.RUN_COLLECT_ONLY = "1";
const step = process.argv[2];
const LAB = `${process.env.HOME}/Documents/procerno_eval/labeling`;
const OUT = `${process.env.HOME}/Documents/procerno_eval/order_fix_2026-11-12`;
const SLUG: Record<string, string> = { Doritos: "doritos", Netflix: "netflix", "Google Pixel": "google_pixel" };
const readJsonl = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { dashboardRun } = await import(process.cwd() + "/src/lib/engine/prompt_health.ts");
const { purgeRunRevision } = await import(process.cwd() + "/src/lib/engine/run_revision.ts");
const { SCHEMA_FIELDS } = await import(process.cwd() + "/src/lib/engine/views.ts");
const flips = JSON.parse(fs.readFileSync(`${OUT}/plan.json`, "utf8")).filter((f: any) => SLUG[f.brand]);
const client = new Anthropic();

if (step === "build") {
  const reqs: any[] = []; const man: any[] = [];
  const tplCache = new Map<string, { v2: Map<string, any>; drf: Map<string, any>; v2man: any[]; drfman: any[] }>();
  for (const f of flips) {
    const slug = SLUG[f.brand];
    if (!tplCache.has(slug)) {
      const v2man = readJsonl(`${LAB}/v2_build/training/${slug}_v2_all.manifest.jsonl`);
      const drfman = readJsonl(`${LAB}/v04_dr/recode/manifest_drf.jsonl`).filter((m) => m.brand === slug);
      const want2 = new Set(flips.filter((x: any) => SLUG[x.brand] === slug).map((x: any) => v2man.find((m) => m.prompt_id === x.oldId)?.id));
      const wantd = new Set(flips.filter((x: any) => SLUG[x.brand] === slug).map((x: any) => "drf_" + drfman.find((m) => m.prompt_id === x.oldId)?.id));
      const v2 = new Map<string, any>(), drf = new Map<string, any>();
      for (const l of fs.readFileSync(`${LAB}/v2_build/training/${slug}_v2_all.jsonl`, "utf8").split("\n")) { if (!l) continue; const id = l.slice(0, 80).match(/"custom_id":\s*"([^"]+)"/)?.[1]; if (id && want2.has(id)) v2.set(id, JSON.parse(l).params); }
      for (const file of fs.readdirSync(`${LAB}/v04_dr/recode`).filter((x) => x.startsWith(`requests_${slug}_drf`) && x.endsWith(".jsonl")))
        for (const l of fs.readFileSync(`${LAB}/v04_dr/recode/${file}`, "utf8").split("\n")) { if (!l) continue; const id = l.slice(0, 80).match(/"custom_id":\s*"([^"]+)"/)?.[1]; if (id && wantd.has(id)) drf.set(id, JSON.parse(l).params); }
      tplCache.set(slug, { v2, drf, v2man, drfman });
    }
    const t = tplCache.get(slug)!;
    const m2 = t.v2man.find((m) => m.prompt_id === f.oldId), md = t.drfman.find((m) => m.prompt_id === f.oldId);
    if (!m2 || m2.schema !== "choice" || !md || md.schema !== "choice") throw new Error("no choice template for " + f.oldId);
    const p2 = t.v2.get(m2.id), pd = t.drf.get("drf_" + md.id);
    if (!p2 || !pd) throw new Error("template request missing " + f.oldId);
    const c2: string = p2.messages[0].content, cd: string = pd.messages[0].content;
    const cut2 = c2.indexOf("Question: "), cutd = cd.indexOf("Question: ");
    if (cut2 < 0 || cutd < 0 || !c2.includes(`Question: ${f.oldText}`) || !cd.includes(`Question: ${f.oldText}`)) throw new Error("template shape " + f.oldId);
    const run = await dashboardRun(f.project);
    const staged = (await store.listStagedPrompts(f.project)).find((p: any) => p.replaces === f.oldId);
    if (!staged) throw new Error("not staged " + f.oldId);
    const meta = await store.listResponseMetaForPrompts(run.id, [staged.id]);
    const texts = new Map((await store.getResponseTexts(meta.map((r: any) => r.id))).map((x: any) => [x.id, x.text]));
    for (const r of meta) {
      const tail = `Question: ${staged.text}\n\nAnswer:\n${texts.get(r.id)}`;
      reqs.push({ custom_id: `v2_${r.id}`, params: { ...p2, messages: [{ role: "user", content: c2.slice(0, cut2) + tail }] } });
      reqs.push({ custom_id: `drf_${r.id}`, params: { ...pd, messages: [{ role: "user", content: cd.slice(0, cutd) + tail }] } });
      man.push({ id: r.id, model: r.model, project: f.project, run: run.id, brand: f.brand, staged: staged.id, old: f.oldId });
    }
  }
  fs.writeFileSync(`${OUT}/requests.jsonl`, reqs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(`${OUT}/manifest.jsonl`, man.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log("requests", reqs.length, "answers", man.length, "models", [...new Set(reqs.map((r) => r.params.model))], "prefix lens ok");
}
if (step === "submit") {
  if (fs.existsSync(`${OUT}/batch_id`)) throw new Error("already submitted " + fs.readFileSync(`${OUT}/batch_id`, "utf8"));
  const b = await client.messages.batches.create({ requests: readJsonl(`${OUT}/requests.jsonl`) });
  fs.writeFileSync(`${OUT}/batch_id`, b.id);
  console.log("submitted", b.id, b.processing_status);
}
if (step === "poll") {
  const id = fs.readFileSync(`${OUT}/batch_id`, "utf8").trim();
  const b = await client.messages.batches.retrieve(id);
  console.log(b.processing_status, JSON.stringify(b.request_counts));
  if (b.processing_status === "ended") {
    const lines: string[] = []; let cost = 0;
    for await (const r of await client.messages.batches.results(id)) {
      lines.push(JSON.stringify(r));
      const u = (r as any).result?.message?.usage;
      if (u) cost += (u.input_tokens * 5 + (u.cache_creation_input_tokens ?? 0) * 6.25 + (u.cache_read_input_tokens ?? 0) * 0.5 + u.output_tokens * 25) / 1e6 / 2;
    }
    fs.writeFileSync(`${OUT}/raw_results.jsonl`, lines.join("\n") + "\n");
    fs.writeFileSync(`${OUT}/cost.json`, JSON.stringify({ usd: cost, results: lines.length }));
    console.log("downloaded", lines.length, "cost", cost.toFixed(2));
  }
}
if (step === "write") {
  const man = readJsonl(`${OUT}/manifest.jsonl`);
  const res = new Map<string, any>();
  for (const r of readJsonl(`${OUT}/raw_results.jsonl`)) {
    if (r.result?.type !== "succeeded") { console.log("FAILED", r.custom_id, r.result?.type); continue; }
    const out = r.result.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    try { res.set(r.custom_id, JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1))); } catch { console.log("UNPARSED", r.custom_id, r.result.message.stop_reason); }
  }
  const asked: string[] = SCHEMA_FIELDS.choice;
  const ALL = ["outcome", "top_pick", "tier_stance", "worth_it", "proceed_or_avoid", "keep_or_leave", "premise_verdict", "category_routed", "relationship_verdict", "case_strength", "growth_stance", "clarification_requested", "includes_prices", "includes_specs", "quote", "premise_quote", "reasons", "topics", "uncoded", "destinations", "redirect_to", "pairings", "mentions", "decision_rules"];
  const texts = new Map((await store.getResponseTexts(man.map((m: any) => m.id))).map((x: any) => [x.id, x.text as string]));
  const taxo = new Map<string, Set<string>>();
  const rows: any[] = []; const bad: string[] = [];
  for (const m of man) {
    const j = res.get(`v2_${m.id}`), d = res.get(`drf_${m.id}`);
    if (!j || !d) { bad.push(`${m.id} missing ${!j ? "v2" : ""} ${!d ? "drf" : ""}`); continue; }
    if (!taxo.has(m.project)) taxo.set(m.project, new Set((await store.getProject(m.project)).reason_taxonomy as string[]));
    const off = (j.reasons ?? []).filter((c: string) => !taxo.get(m.project)!.has(c));
    if (off.length) { bad.push(`${m.id} off-list ${off}`); continue; }
    const rules = d.decision_rules;
    if (!Array.isArray(rules) || rules.some((r: any) => Object.keys(r).some((k) => !["condition", "choice", "product"].includes(k)) || typeof r.condition !== "string" || typeof r.choice !== "string" || !r.choice)) { bad.push(`${m.id} bad rules`); continue; }
    const text = texts.get(m.id)!; const lower = text.toLowerCase();
    const c: any = { response_id: m.id, source: "ref:opus-5-5", run_id: m.run, project_id: m.project, contract: "v2_2026-10-22+drc3", schema: "choice" };
    for (const [k, v] of Object.entries(j)) {
      if (["id", "stage", "schema"].includes(k)) continue;
      const f = k === "uncoded_reason" || k === "uncoded_topic" ? "uncoded" : k;
      if (!asked.includes(f)) { if (v !== null && v !== "n/a") bad.push(`${m.id} unasked ${k}`); continue; }
      if (f === "mentions") {
        const pos = (v as any[]).map((x, i) => ({ x, i, at: lower.indexOf(String(x.brand).toLowerCase()) }));
        pos.sort((a, b) => (a.at < 0 ? 1e9 + a.i : a.at) - (b.at < 0 ? 1e9 + b.i : b.at));
        c[f] = pos.map((p, k2) => ({ brand: p.x.brand, framing: p.x.framing, rank: k2 + 1 }));
      } else c[f] = v;
    }
    c.decision_rules = rules;
    for (const f of asked) if (!(f in c)) bad.push(`${m.id} missing asked ${f}`);
    for (const k of ALL) if (!(k in c)) c[k] = null;
    rows.push(c);
  }
  console.log("rows", rows.length, "of", man.length, "problems", bad.length); for (const b of bad.slice(0, 20)) console.log("  ", b);
  const tally: Record<string, number> = {}; for (const r of rows) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1; console.log("outcomes", tally);
  if (process.argv.includes("--write")) {
    if (bad.length) throw new Error("problems - not writing");
    await store.upsertAnswerCodes(rows);
    for (const run of new Set(man.map((m: any) => m.run))) await purgeRunRevision(run as string);
    console.log("written", rows.length);
  }
}
process.exit(0);
