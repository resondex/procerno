// One-off (2026-11-12, Tyler's go): rebalance name order in the lopsided head-to-head
// cells of the live trackers' first wave. Steps: plan | stage | collect | code | status | swap.
// Each flipped wording is the SAME wording with the two names swapped.
import fs from "node:fs";
for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const step = process.argv[2];
const only = process.argv[3];
if (step !== "code") process.env.RUN_COLLECT_ONLY = "1";
else delete process.env.RUN_COLLECT_ONLY;
const PLAN = `${process.env.HOME}/Documents/procerno_eval/order_fix_2026-11-12/plan.json`;
fs.mkdirSync(PLAN.replace(/\/[^/]+$/, ""), { recursive: true });

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { nameOrder } = await import(process.cwd() + "/src/lib/engine/battery_checks.ts");
const { dashboardRun } = await import(process.cwd() + "/src/lib/engine/prompt_health.ts");
const wr = await import(process.cwd() + "/src/lib/engine/wording_review.ts");
const { purgeRunRevision } = await import(process.cwd() + "/src/lib/engine/run_revision.ts");

type Flip = { project: string; brand: string; rival: string; oldId: string; oldText: string; newText: string; intentId: string; stagedId?: string };
const swap = (t: string, a: string, b: string) => t.split(a).join("\u0000").split(b).join(a).split("\u0000").join(b);

if (step === "plan") {
  const flips: Flip[] = [];
  for (const project of (await store.listProjects()).filter((p: any) => !p.archived_at)) {
    const run = await dashboardRun(project.id).catch(() => null);
    if (!run) continue;
    const intents = (await store.listIntents(project.id)).filter((i: any) => i.stage === "comparison" && i.angle !== "class");
    const prompts = await store.listPrompts(project.id);
    for (const it of intents) {
      const ws = prompts.filter((p: any) => p.intent_id === it.id && !p.retired).sort((x: any, y: any) => x.id.localeCompare(y.id));
      const tag = ws.map((p: any) => ({ p, o: nameOrder(p.text, [project.brand], [it.angle], { category: project.category }) }));
      const a = tag.filter((t: any) => t.o === "a"), b = tag.filter((t: any) => t.o === "b");
      if (a.length + b.length !== ws.length || a.length - b.length <= 2) continue;
      const n = Math.floor((a.length - b.length) / 2);
      const pick = a.filter((t: any) => t.p.text.trim() !== it.text.trim()).slice(0, n);
      for (const t of pick) {
        const newText = swap(t.p.text, project.brand, it.angle);
        if (nameOrder(newText, [project.brand], [it.angle], { category: project.category }) !== "b") throw new Error("swap did not flip: " + newText);
        flips.push({ project: project.id, brand: project.brand, rival: it.angle, oldId: t.p.id, oldText: t.p.text, newText, intentId: it.id });
      }
      console.log(`${project.brand} vs ${it.angle}: ${a.length}/${b.length} -> flip ${pick.length}`);
      for (const t of pick) console.log(`   ${t.p.id.slice(0, 8)}  ${t.p.text}\n          -> ${swap(t.p.text, project.brand, it.angle)}`);
    }
  }
  fs.writeFileSync(PLAN, JSON.stringify(flips, null, 1));
  console.log(flips.length, "flips written to", PLAN);
  process.exit(0);
}

const flips: Flip[] = JSON.parse(fs.readFileSync(PLAN, "utf8")).filter((f: Flip) => !only || f.brand === only);
const byProject = new Map<string, Flip[]>();
for (const f of flips) (byProject.get(f.project) ?? byProject.set(f.project, []).get(f.project)!).push(f);

for (const [pid, list] of byProject) {
  const project = await store.getProject(pid);
  if (!project || project.archived_at) throw new Error("project " + pid);
  const run = await dashboardRun(pid);
  console.log(`== ${project.brand} run ${run.id.slice(0, 8)} ${run.status} panel ${run.models.length}`);
  const prompts = await store.listPrompts(pid);
  const stagedAll = await store.listStagedPrompts(pid);
  const stagedOf = async (f: Flip, create: boolean) => {
    let s = stagedAll.find((p: any) => p.replaces === f.oldId);
    if (!s && create) {
      const old = prompts.find((p: any) => p.id === f.oldId);
      if (!old || old.text !== f.oldText) throw new Error("old wording changed " + f.oldId);
      s = await store.insertStagedPrompt(pid, { text: f.newText, theme: old.theme, intentId: old.intent_id, asker: old.asker, replaces: f.oldId });
      stagedAll.push(s);
    }
    return s;
  };
  if (step === "stage") for (const f of list) console.log("staged", (await stagedOf(f, true)).id, f.newText.slice(0, 70));
  if (step === "collect") {
    await Promise.all(list.map(async (f) => {
      const s = await stagedOf(f, false);
      if (!s) throw new Error("not staged " + f.oldId);
      const r = await wr.collectStaged(run, s, Date.now() + 270_000);
      console.log("collected", s.id.slice(0, 8), r.stored, "/", r.expected);
    }));
  }
  if (step === "code") {
    for (const f of list) {
      const s = await stagedOf(f, false);
      console.log("coded", s.id.slice(0, 8), JSON.stringify(await wr.codeStaged(project, run, s, Date.now() + 280_000)));
    }
  }
  if (step === "status") {
    const src = (project as any).codes_source;
    const coder = new Set(await store.listAnswerCodeIds(run.id, src?.startsWith("coder:") ? src : "coder:v0-5"));
    const ref = new Set(await store.listAnswerCodeIds(run.id, "ref:opus-5-5"));
    for (const f of list) {
      const s = await stagedOf(f, false);
      const meta = s ? await store.listResponseMetaForPrompts(run.id, [s.id]) : [];
      console.log(f.rival.padEnd(20), f.oldId.slice(0, 8), "staged", s?.id.slice(0, 8) ?? "-", "answers", meta.length, "coder", meta.filter((r: any) => coder.has(r.id)).length, "ref", meta.filter((r: any) => ref.has(r.id)).length, "| reads", src);
    }
  }
  if (step === "swap") {
    const src = (project as any).codes_source as string;
    const have = new Set(await store.listAnswerCodeIds(run.id, src));
    for (const f of list) {
      const s = await stagedOf(f, false);
      const meta = s ? await store.listResponseMetaForPrompts(run.id, [s.id]) : [];
      if (!s || meta.length < run.models.length * run.repeats || !meta.every((r: any) => have.has(r.id))) throw new Error(`not ready ${f.oldId}: answers ${meta.length}, coded under ${src} ${meta.filter((r: any) => have.has(r.id)).length}`);
    }
    for (const f of list) {
      const s = await stagedOf(f, false);
      await store.acceptStagedPrompt({ stagedId: s.id, oldId: f.oldId, resolvedText: s.text });
      console.log("swapped", f.oldId.slice(0, 8), "->", s.id.slice(0, 8));
    }
    await purgeRunRevision(run.id);
    console.log("answers visible:", await store.countResponses(run.id), "codes:", await store.countAnswerCodes(run.id, src));
  }
}
process.exit(0);
