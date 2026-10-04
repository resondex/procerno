/**
 * ROOMS DRAW (2026-10-03): one independent draw of the wizard's default
 * room pipeline - the category read, then contest repair against the
 * tracker's roster - per brand, from NOTHING (own temp sqlite), on FIXED
 * inputs (category, audience, roster from a cold-walk context). Run it
 * several times in parallel to see run-to-run variance.
 * Usage: DRAW=a CTX_DIR=<dir> OUT=<dir> npx tsx scripts/rooms_draw.mts "Jira" ...
 * Spends API money (reads + room checks) - run with Tyler's go.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(new URL(".", import.meta.url).pathname, "..");
const DRAW = process.env.DRAW ?? "a";
const CTX_DIR = process.env.CTX_DIR!;
const OUT = process.env.OUT!;
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.DATABASE_URL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), `procerno-rooms-draw-${DRAW}-`)));
const inst = await import(`${REPO}/src/lib/engine/instrument.ts`);

const out: Record<string, unknown> = {};
for (const brand of process.argv.slice(2)) {
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const ctx = JSON.parse(fs.readFileSync(path.join(CTX_DIR, `cold_context_${slug}.json`), "utf8"));
  const { category, audience } = ctx.profile;
  const roles: Record<string, string> = ctx.rosterRoles;
  const rivals = Object.entries(roles).filter(([, r]) => r === "same_seat" || r === "bench").map(([n]) => n);
  const picks = Object.entries(roles).filter(([, r]) => r === "same_seat").map(([n]) => n);
  const read = await inst.readScenarios({ category, audience });
  if (!read) { console.error(`${brand}: read null`); continue; }
  const rep = await inst.contestRoomSet({ brand, category, rivals, picks, scenarios: read.scenarios, reserve: read.reserve ?? [] });
  const by = new Map(rep.checks.map((c: { label: string }) => [c.label, c]));
  out[brand] = {
    category, audience, picks, rivals,
    drawn: read.scenarios.map((s: { label: string; description: string }) => ({ label: s.label, description: s.description })),
    swaps: rep.swaps,
    final: rep.scenarios.map((s: { label: string; description: string }) => ({ label: s.label, description: s.description, check: by.get(s.label) ?? null })),
    reserve: rep.reserve.map((s: { label: string; description: string }) => ({ label: s.label, description: s.description, check: by.get(s.label) ?? null })),
  };
  void 0;
  console.log(`${DRAW} ${brand}: ${rep.scenarios.map((s: { label: string }) => s.label).join(" | ")}${rep.swaps.length ? `  (swapped: ${rep.swaps.map((x: { out: string; in: string }) => `${x.out} -> ${x.in}`).join("; ")})` : ""}`);
}
fs.writeFileSync(path.join(OUT, `draw_${DRAW}.json`), JSON.stringify(out, null, 2));
process.exit(0);
