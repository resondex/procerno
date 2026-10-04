/**
 * Score rooms_compare output with the CURRENT contest check (same rivals
 * and head-to-head picks for every arm) and write a side-by-side markdown.
 * Usage: OUT=<dir> npx tsx scripts/rooms_score.mts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(new URL(".", import.meta.url).pathname, "..");
const OUT = process.env.OUT!;
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.DATABASE_URL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "procerno-rooms-score-")));
const inst = await import(`${REPO}/src/lib/engine/instrument.ts`);

const ARMS = [
  ["old", "First generation (2026-08-26)"],
  ["category", "Today - category read (wizard default)"],
  ["brand", "Today - brand-aware read (cold walk)"],
] as const;
const data = Object.fromEntries(ARMS.map(([a]) => [a, JSON.parse(fs.readFileSync(path.join(OUT, `rooms_${a}.json`), "utf8"))]));
const brands = Object.keys(data.old);
let md = "# Rooms: first generation vs today (2026-10-03)\n\n" +
  "Same inputs for every arm (category, audience and roster from the decisions cold walk). Each arm generated from an empty cache. " +
  "Contest scored by today's check: contested = at least half of the head-to-head picks AND at least 2 direct rivals.\n";
const summary: string[] = [];
for (const brand of brands) {
  const roster: Record<string, string> = data.old[brand].roster;
  const rivals = Object.entries(roster).filter(([, r]) => r === "same_seat" || r === "bench").map(([n]) => n);
  const picks = Object.entries(roster).filter(([, r]) => r === "same_seat").map(([n]) => n);
  md += `\n## ${brand}\n\nCategory: ${data.old[brand].category}. Audience: ${data.old[brand].audience}.\nHead-to-head picks: ${picks.join(", ")}. Other direct rivals: ${rivals.filter((r) => !picks.includes(r)).join(", ") || "none"}.\n`;
  for (const [arm, title] of ARMS) {
    const d = data[arm][brand];
    if (!d) continue;
    const checks = await inst.checkRooms({ brand, category: d.category, rivals, picks, rooms: d.scenarios }).catch(() => []);
    const by = new Map(checks.map((c: { label: string }) => [c.label, c]));
    md += `\n### ${title}\n\n| room | description | contenders | chip |\n| --- | --- | --- | --- |\n`;
    let ok = 0;
    for (const s of d.scenarios) {
      const c = by.get(s.label) as { contenders: string[]; rivals: number; contested: boolean; pitch: string; names: string[] } | undefined;
      const chip = !c ? "-" : c.names.length ? `Names ${c.names.join(", ")}` : !c.contested ? "amber: few rivals" : c.pitch ? `pitch: "${c.pitch}"` : "contested";
      if (c && c.contested && !c.names.length && !c.pitch) ok++;
      md += `| ${s.label} | ${s.description.replace(/\|/g, "/")} | ${c ? `${c.contenders.length}/${c.rivals}: ${c.contenders.join(", ")}` : "-"} | ${chip} |\n`;
    }
    summary.push(`| ${brand} | ${title} | ${ok} of ${d.scenarios.length} clean |`);
  }
}
md += "\n## Summary\n\n| brand | arm | core rooms passing the room check |\n| --- | --- | --- |\n" + summary.join("\n") + "\n";
fs.writeFileSync(path.join(OUT, "ROOMS_COMPARE.md"), md);
console.log(summary.join("\n"));
process.exit(0);
