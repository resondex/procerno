/** Load the four discovery-derived taxonomy proposals into prod projects
 * (taxonomy_proposal + status 'proposed'). Runs the column migrations
 * idempotently first so this works ahead of the next deploy. Writes only
 * proposal metadata - never touches answers or reason_taxonomy. */
import fs from "node:fs";
for (const line of fs.readFileSync("/Users/tylersolloway/Documents/GitHub/procerno/.env.local","utf8").split("\n")) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL!, {max:1});
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS taxonomy_proposal TEXT`;
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS taxonomy_status TEXT NOT NULL DEFAULT 'pending'`;
const L = `${process.env.HOME}/Documents/procerno_eval/labeling`;
const IDS: Record<string,string> = {
  jira: "2d52f699-30f6-40d3-a3ba-4fd26bdde29b",
  amex: "7354bce6-6c22-432e-a531-99ce3118dc7a",
  netflix: "8b9f8453-c9b5-42fc-b0c2-f2af06a16b57",
  pixel: "1f7f59f5-a3c6-4f90-b7d3-961e99b4fbe0",
};
for (const [brand, id] of Object.entries(IDS)) {
  const p = JSON.parse(fs.readFileSync(`${L}/ratified_${brand}_embed.json`, "utf8"));
  // Micros: the phrase membership behind each code, capped to the top 30 by
  // census mention count - enough for the review screen's reassignment UI
  // without shipping the multi-thousand-phrase tail.
  const counts: Record<string, number> = {};
  for (const line of fs.readFileSync(`${L}/grok_census_${brand}.jsonl`, "utf8").trim().split("\n")) {
    for (const ph of (JSON.parse(line).reasons_open ?? []) as string[]) {
      const k = ph.trim().toLowerCase();
      if (k) counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  const micros: Record<string, { p: string; n: number }[]> = {};
  for (const [phrase, code] of Object.entries(p.phrase_map as Record<string, string>)) {
    (micros[code] ??= []).push({ p: phrase, n: counts[phrase] ?? 0 });
  }
  for (const code of Object.keys(micros)) {
    micros[code] = micros[code].sort((a, b) => b.n - a.n).slice(0, 30);
  }
  const proposal = { brand: p.brand, rows: p.rows, source: p.source, codes: p.codes, micros };
  await sql`UPDATE projects SET taxonomy_proposal = ${JSON.stringify(proposal)}, taxonomy_status = 'proposed' WHERE id = ${id}`;
  console.log(`${brand}: ${proposal.codes.length} codes -> proposed`);
}
await sql.end(); process.exit(0);
