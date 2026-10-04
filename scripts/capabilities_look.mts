/**
 * CAPABILITIES LOOK (2026-10-04, item 2): run only planCapabilities on a
 * walk's fixed rooms per brand, from an empty temp store, and print the
 * brand-blind list, per-room ranking, client-lacks and the assignment.
 * Usage: CTX_DIR=<dir> OUT=<file.json> npx tsx scripts/capabilities_look.mts "Jira" ...
 * Spends API money (two sonnet-low calls per brand) - run with Tyler's go.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const REPO = path.resolve(new URL(".", import.meta.url).pathname, "..");
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.DATABASE_URL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "procerno-caps-")));
const inst = await import(`${REPO}/src/lib/engine/instrument.ts`);
const { store } = await import(`${REPO}/src/lib/engine/store.ts`).catch(() => ({ store: null }));
const out: Record<string, unknown> = {};
for (const brand of process.argv.slice(2)) {
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const ctx = JSON.parse(fs.readFileSync(path.join(process.env.CTX_DIR!, `cold_context_${slug}.json`), "utf8"));
  const rooms = ctx.scenarios.map((s: { label: string; description: string }) => ({ label: s.label, description: s.description }));
  const assign = await inst.planCapabilities({ brand, category: ctx.profile.category, audience: ctx.profile.audience, rooms });
  out[brand] = { category: ctx.profile.category, rooms: rooms.map((r: { label: string }) => r.label), assignment: assign ? Object.fromEntries(assign) : null };
}
fs.writeFileSync(process.env.OUT!, JSON.stringify(out, null, 2));
void store;
process.exit(0);
