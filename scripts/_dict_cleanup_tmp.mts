/** One-off (2026-11-13, Tyler's go): dictionary cleanups from the audit.
 * Dry by default; `--write` applies. No model calls (keys blanked). */
import fs from "node:fs";
for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "PERPLEXITY_API_KEY", "FIREWORKS_API_KEY"]) process.env[k] = "";
process.env.RUN_COLLECT_ONLY = "1";
const WRITE = process.argv.includes("--write");
const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { refreshBrandObservations } = await import(process.cwd() + "/src/lib/engine/observations.ts");
const { queueJudgedForms } = await import(process.cwd() + "/src/lib/engine/judged_forms.ts");

const PLAN: { brand: string; remove: [string, string[]][]; add: [string, string][] }[] = [
  { brand: "Netflix", remove: [["Hulu", ["fargo"]], ["Paramount+", ["ncis"]], ["Max (HBO)", ["hbo films"]]], add: [] },
];
const key = (s: string) => s.trim().toLowerCase();
const projects = (await store.listProjects()).filter((p: { archived_at?: string | null }) => !p.archived_at);
for (const plan of PLAN) {
  const project = projects.find((p: { brand: string }) => p.brand === plan.brand);
  if (!project) throw new Error(`no live tracker ${plan.brand}`);
  const entries = await store.getDictionary(project.id);
  const find = (name: string) => entries.find((e: { canonical: string }) => key(e.canonical) === key(name));
  console.log(`\n== ${plan.brand} (${project.id})`);
  for (const [canon, aliases] of plan.remove) {
    const e = find(canon);
    if (!e || e.status !== "active") throw new Error(`no active ${canon}`);
    const drop = aliases.filter((a) => e.aliases.includes(a));
    console.log(`  ${canon}: remove ${JSON.stringify(drop)}${drop.length < aliases.length ? ` (not found: ${JSON.stringify(aliases.filter((a) => !drop.includes(a)))})` : ""}`);
    if (WRITE && drop.length) await store.upsertDictionaryEntry({ id: e.id, projectId: project.id, canonical: e.canonical, aliases: e.aliases.filter((x: string) => !drop.includes(x)), status: e.status });
    for (const a of drop) {
      const own = find(a);
      console.log(`    "${a}": ${own ? `already its own ${own.status} entry` : "becomes its own ignored entry"}`);
      if (WRITE && !own) await store.upsertDictionaryEntry({ id: null, projectId: project.id, canonical: a, aliases: [], status: "rejected" });
    }
  }
  for (const [canon, name] of plan.add) {
    const into = find(canon);
    const from = find(name);
    if (!into || into.status !== "active") throw new Error(`no active ${canon}`);
    console.log(`  ${canon}: add alias "${key(name)}" (${from ? `its ${from.status} entry stays, aliases ${JSON.stringify(from.aliases)}` : "no entry of its own"})`);
    if (WRITE) await store.upsertDictionaryEntry({ id: into.id, projectId: project.id, canonical: into.canonical, aliases: [...new Set([...into.aliases, key(name), ...(from?.aliases ?? [])])], status: "active" });
    if (WRITE && from && from.aliases.length) await store.upsertDictionaryEntry({ id: from.id, projectId: project.id, canonical: from.canonical, aliases: [], status: from.status });
  }
  if (WRITE) {
    const v = await store.bumpDictionaryVersion(project.id);
    await refreshBrandObservations(project.id);
    await queueJudgedForms(project).catch((err: unknown) => console.error("  judged-form queue failed:", err));
    console.log(`  written; dictionary version ${v}`);
  }
}
console.log(WRITE ? "\ndone" : "\ndry run - nothing written");
process.exit(0);
