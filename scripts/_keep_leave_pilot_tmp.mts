// One-off (2026-11-13, Tyler's go, ~$5): pilot of the four-value keep_or_leave label. Batch API.
// Steps: submit | poll. Requests are built by ~/Documents/procerno_eval/labeling/keep_leave_4way_2026-11-13/build.py.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
for (const line of fs.readFileSync(process.cwd() + "/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const step = process.argv[2];
const OUT = `${process.env.HOME}/Documents/procerno_eval/labeling/keep_leave_4way_2026-11-13`;
const readJsonl = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const client = new Anthropic();
if (step === "submit") {
  if (fs.existsSync(`${OUT}/batch_id`)) throw new Error("already submitted " + fs.readFileSync(`${OUT}/batch_id`, "utf8"));
  const b = await client.messages.batches.create({ requests: readJsonl(`${OUT}/requests.jsonl`) });
  fs.writeFileSync(`${OUT}/batch_id`, b.id);
  console.log("submitted", b.id, b.processing_status);
}
if (step === "poll") {
  const id = fs.readFileSync(`${OUT}/batch_id`, "utf8").trim();
  const b = await client.messages.batches.retrieve(id);
  console.log(b.processing_status, JSON.stringify(b.request_counts));
  if (b.processing_status === "ended") {
    const lines: string[] = []; let cost = 0;
    for await (const r of await client.messages.batches.results(id)) {
      lines.push(JSON.stringify(r));
      const u = (r as any).result?.message?.usage;
      if (u) cost += (u.input_tokens * 5 + (u.cache_creation_input_tokens ?? 0) * 6.25 + (u.cache_read_input_tokens ?? 0) * 0.5 + u.output_tokens * 25) / 1e6 / 2;
    }
    fs.writeFileSync(`${OUT}/raw_results.jsonl`, lines.join("\n") + "\n");
    fs.writeFileSync(`${OUT}/cost.json`, JSON.stringify({ usd: cost, results: lines.length, batch: id }));
    console.log("downloaded", lines.length, "cost", cost.toFixed(2));
  }
}
