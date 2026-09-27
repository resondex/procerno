/**
 * Scores test C. Dictionary seed, on the four trackers with discovery data:
 * each seeded alias is checked against the brand forms the discovery pass
 * actually saw (matchKey, like prod matching) - observed share, answers the
 * seed alone reaches, and conflicts (an alias that matchKeys a DIFFERENT
 * entry on Tyler's confirmed board). Brand profile, all 11 projects:
 * suggested competitors vs the configured ones (matchKey overlap).
 */
import fs from "node:fs";
import { OUT_ROOT, closeProd, prod, trackers, REPO } from "./internal_models_common.mts";

const { matchKey } = await import(`${REPO}/src/lib/brand_key`);
const ARMS = ["gpt-5-mini", "gpt-6-luna"];
const data = Object.fromEntries(ARMS.map((a) => [a, JSON.parse(fs.readFileSync(`${OUT_ROOT}/seed/${a}.json`, "utf8"))]));
const lines: string[] = [];

lines.push("## Dictionary seed (4 trackers, 3 runs each; per-run means)", "",
  "| arm | brand | aliases / run | observed in answers | answers reached by seed | conflicts with board | runs identical |",
  "| --- | --- | --- | --- | --- | --- | --- |");
for (const t of await trackers()) {
  const rows = await prod`SELECT discovery_brands FROM responses r JOIN runs ru ON ru.id=r.run_id WHERE ru.project_id=${t.id} AND r.discovery_brands IS NOT NULL`;
  const answerKeys = rows.map((r) => new Set((JSON.parse(r.discovery_brands) as string[]).map((b) => matchKey(b))));
  const observed = new Map<string, number>();
  for (const s of answerKeys) for (const k of s) observed.set(k, (observed.get(k) ?? 0) + 1);
  const board = await prod`SELECT canonical, aliases, status FROM dictionary_entries WHERE project_id=${t.id}`;
  const ownerOf = new Map<string, string>();
  for (const e of board) for (const n of [e.canonical, ...JSON.parse(e.aliases)]) if (!ownerOf.has(matchKey(n))) ownerOf.set(matchKey(n), matchKey(e.canonical));
  for (const arm of ARMS) {
    const seeds: { canonical: string; aliases: string[] }[][] = data[arm].projects[t.brand].seeds;
    let al = 0, obs = 0, reach = 0, conf = 0;
    const confl: string[] = [];
    for (const run of seeds) {
      const keys = new Set<string>();
      for (const e of run) {
        keys.add(matchKey(e.canonical));
        for (const a of e.aliases) {
          al++; keys.add(matchKey(a));
          if ((observed.get(matchKey(a)) ?? 0) > 0) obs++;
          const owner = ownerOf.get(matchKey(a));
          if (owner && owner !== matchKey(e.canonical)) { conf++; confl.push(`${a} (on ${e.canonical})`); }
        }
      }
      reach += answerKeys.filter((s) => [...s].some((k) => keys.has(k))).length;
    }
    const n = seeds.length;
    const same = new Set(seeds.map((r) => JSON.stringify(r))).size === 1;
    lines.push(`| ${arm} | ${t.brand} | ${(al / n).toFixed(1)} | ${Math.round((100 * obs) / Math.max(al, 1))}% | ${Math.round(reach / n)} of ${answerKeys.length} | ${(conf / n).toFixed(1)}${confl.length ? ` (${[...new Set(confl)].slice(0, 4).join("; ")})` : ""} | ${same ? "yes" : "no"} |`);
  }
}

lines.push("", "## Brand profile (11 projects, 3 runs each)", "",
  "| project | configured category | gpt-5-mini category (run 1) | gpt-6-luna category (run 1) | configured rivals found: gpt-5-mini / gpt-6-luna |",
  "| --- | --- | --- | --- | --- |");
const tot: Record<string, [number, number]> = { "gpt-5-mini": [0, 0], "gpt-6-luna": [0, 0] };
for (const brand of Object.keys(data["gpt-5-mini"].projects).sort()) {
  const conf = data["gpt-5-mini"].projects[brand].configured;
  const cells = ARMS.map((arm) => {
    const profs = data[arm].projects[brand].profiles as { competitors?: string[]; category?: string }[];
    const want = new Set((conf.competitors as string[]).map((c) => matchKey(c.replace(/\s*\(.*\)$/, ""))));
    let hit = 0, n = 0;
    for (const p of profs) {
      const got = new Set((p.competitors ?? []).map((c) => matchKey(c.replace(/\s*\(.*\)$/, ""))));
      for (const w of want) { n++; if (got.has(w)) hit++; }
    }
    tot[arm][0] += hit; tot[arm][1] += n;
    return { cat: profs[0]?.category ?? "(error)", rec: `${hit}/${n}` };
  });
  lines.push(`| ${brand} | ${conf.category} | ${cells[0].cat} | ${cells[1].cat} | ${cells[0].rec} / ${cells[1].rec} |`);
}
lines.push(`| **all** | | | | **${tot["gpt-5-mini"][0]}/${tot["gpt-5-mini"][1]} / ${tot["gpt-6-luna"][0]}/${tot["gpt-6-luna"][1]}** |`);
const P: Record<string, [number, number]> = { "gpt-5-mini": [0.25, 2], "gpt-6-luna": [0.1, 0.5] };
for (const arm of ARMS) {
  const u = data[arm].usage as { model: string; purpose: string; calls: number; inTok: number; outTok: number }[];
  lines.push("", `${arm}: ${u.map((r) => `${r.purpose} ${r.calls} calls ${r.inTok}/${r.outTok} tok $${((r.inTok * P[r.model][0] + r.outTok * P[r.model][1]) / 1e6).toFixed(3)}`).join("; ")}; errors ${data[arm].errors.length}`);
}
fs.writeFileSync(`${OUT_ROOT}/seed/score.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
await closeProd();
process.exit(0);
