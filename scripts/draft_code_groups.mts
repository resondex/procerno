/**
 * Draft a reason-group map (projects.code_groups) for one tracker, for human
 * review. One claude-opus-5-5 call (effort medium) over the tracker's
 * confirmed codes, their scope sentences and pooled incidence from the local
 * dashboard fixture. Writes a JSON draft and a review page; stores nothing.
 *
 *   npx tsx scripts/draft_code_groups.mts <brand substring> [out dir]
 *
 * VARIANT=b1 adds a split-by-meaning rule (a group's codes argue in one
 * direction). VARIANT=b2 also shows each code's open-choice lean (argued when
 * the brand is picked vs when another is) and forbids grouping codes that lean
 * opposite ways. Variants write to <out dir>/<variant>/.
 *
 * Reads the fixture only (DATABASE_URL is removed before the store loads).
 * SPENDS MONEY - one call per run, Tyler's go required.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

delete process.env.DATABASE_URL;
process.env.SQLITE_PATH = process.cwd() + "/data/dashboard_fixture.db";
for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^ANTHROPIC_API_KEY=(.+)$/);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim().replace(/^"|"$/g, "");
}

const { store } = await import(process.cwd() + "/src/lib/store/index.ts");
const { loadViewData } = await import(process.cwd() + "/src/lib/engine/view_data.ts");
const { computeReasons } = await import(process.cwd() + "/src/lib/engine/reasons.ts");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

const MODEL = "claude-opus-5-5";
const PRICE = { in: 4, out: 20 };
const want = (process.argv[2] ?? "").toLowerCase();
const VARIANT = process.env.VARIANT ?? "";
if (VARIANT && !["b1", "b2"].includes(VARIANT)) throw new Error("VARIANT must be b1 or b2");
const baseDir = process.argv[3] ?? path.join(os.homedir(), "Documents/procerno_eval/code_groups_2026-10-27");
const outDir = VARIANT ? path.join(baseDir, VARIANT) : baseDir;
/** Points by which a code must lean each way before B2 keeps it apart. */
const LEAN_PTS = 5;
if (!want) throw new Error("usage: draft_code_groups.mts <brand substring> [out dir]");

const project = (await store.listProjects()).find((p) => p.brand.toLowerCase().includes(want));
if (!project) throw new Error(`no tracker matches ${want}`);
const full = (await store.getProject(project.id))!;
const run = (await store.listRuns(project.id))[0];
const data = (await loadViewData(run, project))!;
const view = computeReasons(data);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const proposal = JSON.parse(full.taxonomy_proposal ?? "{}") as { codes?: { code: string; why?: string }[] };
const scopeOf = new Map((proposal.codes ?? []).map((c) => [norm(c.code), c.why ?? ""]));
const confirmed: string[] = [...full.reason_taxonomy];
const pooledOf = new Map(view.codes.map((r) => [r.key, r.pooled]));
const pct = (k: number, n: number) => (n ? Math.round((k / n) * 1000) / 10 : 0);

const headlineOf = new Map(view.codes.map((r) => [r.key, r.byVerdict.headline]));
const lines = confirmed.map((c) => {
  const p = pooledOf.get(c);
  const scope = scopeOf.get(norm(c)) || "(no description)";
  const h = headlineOf.get(c);
  const lean = VARIANT === "b2" && h ? ` | argued in ${pct(h.you.k, h.you.n)}% of answers that pick the brand vs ${pct(h.other.k, h.other.n)}% that pick another brand` : "";
  return `- ${c} | argued in ${p ? pct(p.k, p.n) : 0}% of answers${lean} | ${scope}`;
});

const SPLIT_RULES: Record<string, string[]> = {
  b1: [
    "- Every code in a group must argue in the same direction. A code that names a drawback, cost or risk is a different argument from the codes that name the benefit it is weighed against, and goes in a different group or stays ungrouped. Codes that would send a buyer toward different kinds of product also go in different groups.",
  ],
  b2: [
    `- Each code also shows how often it is argued in answers that pick the tracked brand and in answers that pick another brand. Never put a code argued at least ${LEAN_PTS} points more often when the tracked brand is picked in the same group as a code argued at least ${LEAN_PTS} points more often when another brand is picked. Codes argued in under 2% of answers are exempt.`,
  ],
};

const SYSTEM = [
  "You group a market's confirmed reason codes into display groups for an executive dashboard.",
  "Each code is an argument that AI answers make when a buyer chooses a product in this category. The dashboard shows each group as one row, counting an answer once if it argues from any of the group's codes, and lets the reader open a group to see its codes.",
  "",
  "Rules:",
  "- Make about 8 to 14 groups. A group gathers codes a reader would treat as one topic of argument.",
  "- Name each group in one to four plain words, in the buyer's own vocabulary, lowercase.",
  "- Every code appears exactly once: in one group, or in \"ungrouped\" when it fits no group. Copy code names exactly as written.",
  "- A group must hold at least two codes. A code that would be alone stays ungrouped.",
  "- Group by what is being argued, never by which brand or which buyer it suits.",
  "- No catch-all groups. If a group's name could describe the whole category, or its codes share no more than being about the product, split it or leave codes ungrouped. A group that most answers would hit tells the reader nothing.",
  "- Keep codes apart when buyers weigh them against each other.",
  ...(SPLIT_RULES[VARIANT] ?? []),
  "",
  'Reply with JSON only: {"groups":[{"name":"...","codes":["..."],"why":"one sentence on what ties these codes together"}],"ungrouped":["..."]}',
].join("\n");

const USER = [
  `Category: ${full.category ?? project.category ?? ""}`,
  `Answers counted: ${view.pooledAnswers}`,
  "",
  VARIANT === "b2" ? "Confirmed codes (code | how often argued | when the brand is picked vs another | what it covers):" : "Confirmed codes (code | how often argued | what it covers):",
  ...lines,
].join("\n");

const anthropic = new Anthropic();
const t0 = Date.now();
const stream = anthropic.messages.stream({
  model: MODEL,
  max_tokens: 16000,
  output_config: { effort: "medium" },
  system: SYSTEM,
  messages: [{ role: "user", content: USER }],
} as never);
const res = await stream.finalMessage();
const text = res.content.filter((b: { type: string }) => b.type === "text").map((b: { text?: string }) => b.text ?? "").join("");
const usage = res.usage as { input_tokens: number; output_tokens: number };
const cost = (usage.input_tokens * PRICE.in + usage.output_tokens * PRICE.out) / 1e6;

const slug = project.brand.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `raw_${slug}.txt`), text);

const start = text.indexOf("{");
const end = text.lastIndexOf("}");
const draft = JSON.parse(text.slice(start, end + 1)) as { groups: { name: string; codes: string[]; why?: string }[]; ungrouped?: string[] };

// Mechanical check: every confirmed code placed exactly once, nothing invented.
const placed = new Map<string, number>();
for (const g of draft.groups) for (const c of g.codes) placed.set(c, (placed.get(c) ?? 0) + 1);
for (const c of draft.ungrouped ?? []) placed.set(c, (placed.get(c) ?? 0) + 1);
const confirmedSet = new Set(confirmed);
const invented = [...placed.keys()].filter((c) => !confirmedSet.has(c));
const missing = confirmed.filter((c) => !placed.has(c));
const twice = [...placed.entries()].filter(([, n]) => n > 1).map(([c]) => c);
const singles = draft.groups.filter((g) => g.codes.length < 2).map((g) => g.name);
const ok = invented.length + missing.length + twice.length + singles.length === 0;

// Group incidence through the real rollup.
const groupsJson = JSON.stringify({ groups: draft.groups.map((g) => ({ name: g.name, codes: g.codes })) });
const rolled = computeReasons({ ...data, codeGroups: groupsJson });
const groupRow = new Map((rolled.groups ?? []).filter((r) => r.isGroup).map((r) => [r.label, r]));
const open = rolled.types.find((t) => t.key === "headline");

const fmt = (c?: { k: number; n: number }) => (c ? `${pct(c.k, c.n)}%` : "-");
const out: string[] = [
  `# Reason groups draft - ${project.brand}${VARIANT ? ` (${VARIANT})` : ""}`,
  "",
  `Draft only - nothing is stored. ${MODEL}, effort medium, ${usage.input_tokens} in / ${usage.output_tokens} out tokens, $${cost.toFixed(2)}, ${Math.round((Date.now() - t0) / 1000)}s.`,
  "",
  `Check: ${ok ? "pass - every confirmed code placed exactly once, none invented, no one-code groups" : "FAIL"}.`,
  ...(invented.length ? [`- Codes not in the codebook: ${invented.join(", ")}`] : []),
  ...(missing.length ? [`- Codes left out: ${missing.join(", ")}`] : []),
  ...(twice.length ? [`- Codes placed twice: ${twice.join(", ")}`] : []),
  ...(singles.length ? [`- One-code groups: ${singles.join(", ")}`] : []),
  "",
  `${draft.groups.length} groups, ${(draft.ungrouped ?? []).length} codes left on their own. "Argued in" is over ${view.pooledAnswers} answers (all question types except criteria). "Picks you / picks another" is over open-choice answers${open ? ` (${open.verdicts.map((v) => `${v.label.toLowerCase()} ${v.answers}`).join(", ")})` : ""}.`,
  "",
];
const sorted = [...draft.groups].sort((a, b) => (groupRow.get(b.name)?.pooled.k ?? 0) - (groupRow.get(a.name)?.pooled.k ?? 0));
for (const g of sorted) {
  const r = groupRow.get(g.name);
  const ov = r?.byVerdict.headline;
  out.push(`## ${g.name} - argued in ${fmt(r?.pooled)}${ov ? ` (picks you ${fmt(ov.you)} / picks another ${fmt(ov.other)})` : ""}`);
  out.push("", g.why ?? "", "");
  out.push("| code | argued in | picks you | picks another | what it covers |", "| --- | --- | --- | --- | --- |");
  for (const c of [...g.codes].sort((a, b) => (pooledOf.get(b)?.k ?? 0) - (pooledOf.get(a)?.k ?? 0))) {
    const cr = rolled.codes.find((x) => x.key === c)?.byVerdict.headline;
    out.push(`| ${c} | ${fmt(pooledOf.get(c))} | ${fmt(cr?.you)} | ${fmt(cr?.other)} | ${scopeOf.get(norm(c)) ?? ""} |`);
  }
  out.push("");
}
if ((draft.ungrouped ?? []).length) {
  out.push("## Left on their own", "", "| code | argued in | what it covers |", "| --- | --- | --- |");
  for (const c of draft.ungrouped!) out.push(`| ${c} | ${fmt(pooledOf.get(c))} | ${scopeOf.get(norm(c)) ?? ""} |`);
  out.push("");
}

fs.writeFileSync(path.join(outDir, `draft_${slug}.json`), JSON.stringify({ brand: project.brand, variant: VARIANT || "base", model: MODEL, effort: "medium", usage, cost_usd: cost, check: { ok, invented, missing, twice, singles }, ...draft }, null, 2));
fs.writeFileSync(path.join(outDir, `review_${slug}.md`), out.join("\n"));
fs.writeFileSync(path.join(outDir, `prompt_${slug}.txt`), `SYSTEM\n${SYSTEM}\n\nUSER\n${USER}\n`);
console.log(JSON.stringify({ brand: project.brand, variant: VARIANT || "base", groups: draft.groups.length, ungrouped: (draft.ungrouped ?? []).length, ok, cost_usd: Number(cost.toFixed(3)), outDir }));
