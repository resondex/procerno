/** One-off (2026-11-14, Tyler: "do the manual edits to the queued names
 * yourself"): dispositions for the names queued on the Doritos, Google Pixel
 * and Netflix boards. Mirrors the dictionary route's batch (served snapshot,
 * actions, version bump, decision record, observations, judged forms, name
 * sign-off). Dry by default; `--write` applies. No model calls (keys blanked). */
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
const { snapshotServed, recordDictionaryLayout, recordDictionaryConfirm } = await import(process.cwd() + "/src/lib/engine/dict_decision.ts");

type Plan = { merge: Record<string, string[]>; approve: string[]; leave: string[] }; // every other pending name is ignored
const PLANS: Record<string, Plan> = {
  Doritos: {
    merge: { "Kettle Brand": ["Kettle Jalapeño", "Kettle Krinkle Cut", "Kettle Salt & Vinegar", "Kettle Sea Salt"], "Pirate's Booty": ["Veggie Booty"], "Lay's": ["Stax"] },
    approve: [], leave: [],
  },
  "Google Pixel": {
    merge: {
      "Apple iPhone": ["iPhones", "App Store", "Ceramic Shield", "MagSafe", "Memoji", "ProRes", "SharePlay", "Siri", "Universal Clipboard", "A20 Pro", "Live Photos"],
      "Samsung Galaxy": ["A54", "A55", "S23 Ultra", "S24 FE", "S24 Ultra", "S24+", "S25 FE", "S25 Ultra", "S25+", "S26", "S26 FE", "S26 Ultra", "Samsungs", "Z Flip", "Z Flip 8", "Z Fold", "Z Fold 6", "Bixby", "Good Lock", "Knox", "Secure Folder", "Smart Switch", "SmartTag", "Gorilla Armor", "Gorilla Glass Armor"],
      Xiaomi: ["Poco", "POCO F8 Ultra", "Poco X8 Pro", "POCO X8 Pro Max", "X8 Pro Max", "Redmi", "Redmi Note 15 Pro"],
      Nothing: ["CMF", "CMF Phone", "CMF Phone 2", "CMF Phone 2 Pro"],
      Oppo: ["ColorOS"],
      Motorola: ["Motorolas"],
    },
    approve: ["Sony Xperia", "Vivo"],
    // Bare model suffixes other makers also use: as aliases they would claim
    // those makers' phones by family containment. Left as judge-placed forms.
    leave: ["Pro Max", "17 Pro", "17 Pro Max", "15 Pro Max", "18 Pro Max"],
  },
  Netflix: {
    merge: { "ESPN+": ["ESPN Select"], Fubo: ["fuboTV"], Netflix: ["Standard with Ads"] },
    approve: ["AMC+", "Starz"], leave: [],
  },
};
const key = (s: string) => s.trim().toLowerCase();
const projects = (await store.listProjects()).filter((p: { archived_at?: string | null }) => !p.archived_at);
for (const [brand, plan] of Object.entries(PLANS)) {
  const project = projects.find((p: { brand: string }) => p.brand === brand);
  if (!project) throw new Error(`no live tracker ${brand}`);
  let entries = await store.getDictionary(project.id);
  const pending = entries.filter((e: any) => e.status === "pending");
  const byName = new Map(pending.map((e: any) => [key(e.canonical), e]));
  const mergeOf = new Map<string, string>();
  for (const [into, names] of Object.entries(plan.merge)) {
    const t = entries.find((e: any) => e.status === "active" && key(e.canonical) === key(into));
    if (!t) throw new Error(`${brand}: no active target ${into}`);
    for (const n of names) { if (!byName.has(key(n))) throw new Error(`${brand}: not pending: ${n}`); mergeOf.set(key(n), into); }
  }
  for (const n of [...plan.approve, ...plan.leave]) if (!byName.has(key(n))) throw new Error(`${brand}: not pending: ${n}`);
  const approve = new Set(plan.approve.map(key)), leave = new Set(plan.leave.map(key));
  const ignore = pending.filter((e: any) => !mergeOf.has(key(e.canonical)) && !approve.has(key(e.canonical)) && !leave.has(key(e.canonical)));
  console.log(`\n== ${brand} (${project.id}): ${pending.length} queued -> merge ${mergeOf.size}, approve ${approve.size}, ignore ${ignore.length}, left ${leave.size}`);
  for (const [into, names] of Object.entries(plan.merge)) console.log(`  into ${into}: ${names.join(", ")}`);
  console.log(`  approve: ${plan.approve.join(", ") || "-"}`);
  console.log(`  ignore: ${ignore.map((e: any) => e.canonical).join(", ")}`);
  console.log(`  left queued: ${plan.leave.join(", ") || "-"}`);
  if (!WRITE) continue;
  const servedBefore = await snapshotServed(project).catch(() => null);
  for (const n of approve) { const e: any = byName.get(n); await store.upsertDictionaryEntry({ id: e.id, projectId: project.id, canonical: e.canonical, aliases: e.aliases, status: "active" }); }
  for (const e of ignore as any[]) await store.upsertDictionaryEntry({ id: e.id, projectId: project.id, canonical: e.canonical, aliases: e.aliases, status: "rejected" });
  for (const [n, intoName] of mergeOf) {
    entries = await store.getDictionary(project.id);
    const e: any = byName.get(n);
    const into: any = entries.find((x: any) => x.status === "active" && key(x.canonical) === key(intoName));
    await store.upsertDictionaryEntry({ id: into.id, projectId: project.id, canonical: into.canonical, aliases: [...new Set([...into.aliases, key(e.canonical), ...e.aliases])], status: "active" });
    await store.upsertDictionaryEntry({ id: e.id, projectId: project.id, canonical: e.canonical, aliases: [], status: "rejected" });
  }
  await store.confirmDictionaryNames(project.id, pending.filter((e: any) => !leave.has(key(e.canonical))).map((e: any) => e.canonical));
  const v = await store.bumpDictionaryVersion(project.id);
  if (servedBefore) await recordDictionaryLayout(project, servedBefore).catch((err: unknown) => console.error("  layout record failed:", err));
  await refreshBrandObservations(project.id);
  const q = await queueJudgedForms(project).catch((err: unknown) => { console.error("  judged-form queue failed:", err); return null; });
  await recordDictionaryConfirm(project).catch((err: unknown) => console.error("  confirm record failed:", err));
  const after = (await store.getDictionary(project.id)).filter((e: any) => e.status === "pending").map((e: any) => e.canonical);
  console.log(`  written; dictionary version ${v}; judged forms queued: ${JSON.stringify(q)?.slice(0, 200)}; still queued (${after.length}): ${after.join(", ")}`);
}
console.log(WRITE ? "\ndone" : "\ndry run - nothing written");
process.exit(0);
