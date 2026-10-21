/**
 * Scores the 2026-10-14 brand-profile rerun (internal_models/seed/<model>-oct14.json).
 *
 * Key 1 (unbiased, the five October trackers): the competitors the collected
 * answers actually name most. Every answer's discovery_brands are resolved
 * through Tyler's confirmed board (active entries' canonical + aliases, by
 * matchKey); the target entry is left out; the top 8 by share of answers are
 * the key. No model wrote this list, so it does not favor the model that
 * pre-filled the rosters.
 * Key 2 (all 11 brands): the configured competitor lists - these descend
 * from earlier gpt-5-mini pre-fills plus Tyler's edits, so read with that bias.
 * Prod is read through read-only transactions.
 */
import fs from "node:fs";
import { OUT_ROOT, closeProd, prod, REPO } from "./internal_models_common.mts";

const { matchKey } = await import(`${REPO}/src/lib/brand_key`);
const ARMS = ["gpt-5-mini", "gpt-6-luna", "gpt-6-sol"];
const data = Object.fromEntries(
  ARMS.map((a) => [a, JSON.parse(fs.readFileSync(`${OUT_ROOT}/seed/${a}-oct14.json`, "utf8"))])
);
const OCT = {
  "American Express": "da86924c-8cc8-4a9c-a03e-a139f1f0854f",
  jira: "a3fd8d2c-2076-4f50-9e85-ad6b9902b448",
  "Google Pixel": "87ccf81c-5b0e-4765-a969-19b9c4dc4d5d",
  Netflix: "a361b767-182c-4229-9e3c-a62457c30c5b",
  Doritos: "aabb35e0-dc07-4366-bc3b-a1058f0a3e79",
} as Record<string, string>;
const clean = (s: string) => matchKey(s.replace(/\s*\(.*\)\s*$/, ""));
const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(b, 1))}%`;
type Prof = { competitors?: string[]; category?: string; error?: string };
const lines: string[] = [];

lines.push(
  "## Key 1 - competitors the answers name most (October trackers, top 8 by share)",
  "",
  "Per run: how many of the top 8 the suggestion lists, and how many suggested names are an approved competitor on the board.",
  "",
  "| tracker | top 8 named in answers (share) | " + ARMS.map((a) => `${a} top-8 found / on board`).join(" | ") + " |",
  "| --- | --- | " + ARMS.map(() => "---").join(" | ") + " |"
);
const k1: Record<string, [number, number, number, number]> = Object.fromEntries(ARMS.map((a) => [a, [0, 0, 0, 0]]));
for (const [brand, pid] of Object.entries(OCT)) {
  const [proj] = await prod`SELECT brand FROM projects WHERE id=${pid}`;
  const ents = (await prod`SELECT canonical, aliases, status FROM dictionary_entries WHERE project_id=${pid} AND status='active'`).map(
    (e) => ({ canonical: e.canonical as string, forms: [e.canonical, ...JSON.parse(e.aliases)].map(clean) })
  );
  const owner = new Map<string, string>();
  for (const e of ents) for (const f of e.forms) if (!owner.has(f)) owner.set(f, e.canonical);
  const target = owner.get(clean(proj.brand));
  const rows = await prod`SELECT r.discovery_brands FROM responses r JOIN runs ru ON ru.id=r.run_id WHERE ru.project_id=${pid} AND r.discovery_brands IS NOT NULL`;
  const count = new Map<string, number>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const b of JSON.parse(r.discovery_brands) as string[]) {
      const o = owner.get(clean(b));
      if (o && o !== target) seen.add(o);
    }
    for (const o of seen) count.set(o, (count.get(o) ?? 0) + 1);
  }
  const top = [...count].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topSet = new Set(top.map(([c]) => c));
  const cells = ARMS.map((arm) => {
    const profs = data[arm].projects[brand].profiles as Prof[];
    let found = 0, onBoard = 0, listed = 0;
    for (const p of profs) {
      const got = new Set((p.competitors ?? []).map((c) => owner.get(clean(c))).filter(Boolean) as string[]);
      for (const c of topSet) if (got.has(c)) found++;
      onBoard += (p.competitors ?? []).filter((c) => { const o = owner.get(clean(c)); return o && o !== target; }).length;
      listed += (p.competitors ?? []).length;
    }
    k1[arm][0] += found; k1[arm][1] += topSet.size * profs.length; k1[arm][2] += onBoard; k1[arm][3] += listed;
    return `${pct(found, topSet.size * profs.length)} / ${pct(onBoard, listed)}`;
  });
  lines.push(`| ${brand} | ${top.map(([c, n]) => `${c} ${pct(n, rows.length)}`).join(", ")} | ${cells.join(" | ")} |`);
}
lines.push(`| **all** | | ${ARMS.map((a) => `**${pct(k1[a][0], k1[a][1])} / ${pct(k1[a][2], k1[a][3])}**`).join(" | ")} |`);

lines.push(
  "",
  "## Key 2 - configured competitors (all 11 brands; biased toward earlier gpt-5-mini pre-fills)",
  "",
  "| brand | configured category | " + ARMS.map((a) => `${a} category (run 1) / rivals found`).join(" | ") + " |",
  "| --- | --- | " + ARMS.map(() => "---").join(" | ") + " |"
);
const k2: Record<string, [number, number]> = Object.fromEntries(ARMS.map((a) => [a, [0, 0]]));
const stab: Record<string, [number, number]> = Object.fromEntries(ARMS.map((a) => [a, [0, 0]]));
for (const brand of Object.keys(data["gpt-5-mini"].projects).sort()) {
  const conf = data["gpt-5-mini"].projects[brand].configured;
  const want = new Set((conf.competitors as string[]).map(clean));
  const cells = ARMS.map((arm) => {
    const profs = data[arm].projects[brand].profiles as Prof[];
    let hit = 0, n = 0;
    for (const p of profs) {
      const got = new Set((p.competitors ?? []).map(clean));
      for (const w of want) { n++; if (got.has(w)) hit++; }
    }
    k2[arm][0] += hit; k2[arm][1] += n;
    const cats = new Set(profs.map((p) => (p.category ?? "").toLowerCase()));
    stab[arm][0] += cats.size === 1 ? 1 : 0; stab[arm][1]++;
    return `${profs[0]?.category ?? profs[0]?.error ?? "(none)"} / ${hit}/${n}`;
  });
  lines.push(`| ${brand} | ${conf.category} | ${cells.join(" | ")} |`);
}
lines.push(`| **all** | | ${ARMS.map((a) => `**${k2[a][0]}/${k2[a][1]} (${pct(k2[a][0], k2[a][1])})**`).join(" | ")} |`);
lines.push("", `Same category in all 3 runs: ${ARMS.map((a) => `${a} ${stab[a][0]}/${stab[a][1]}`).join(", ")}`);

const P: Record<string, [number, number]> = { "gpt-5-mini": [0.25, 2], "gpt-6-luna": [0.1, 0.5], "gpt-6-sol": [2, 10] };
lines.push("", "| model | calls | tokens in / out | cost | errors |", "| --- | --- | --- | --- | --- |");
for (const arm of ARMS) {
  const u = (data[arm].usage as { model: string; calls: number; inTok: number; outTok: number }[]).filter((r) => r.model === arm);
  const c = u.reduce((s, r) => s + (r.inTok * P[arm][0] + r.outTok * P[arm][1]) / 1e6, 0);
  lines.push(`| ${arm} | ${u.reduce((s, r) => s + r.calls, 0)} | ${u.reduce((s, r) => s + r.inTok, 0)} / ${u.reduce((s, r) => s + r.outTok, 0)} | $${c.toFixed(3)} | ${data[arm].errors.length} |`);
}
fs.writeFileSync(`${OUT_ROOT}/seed/profile_score_oct14.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
await closeProd();
process.exit(0);
