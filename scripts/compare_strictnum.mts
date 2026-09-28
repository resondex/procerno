/** Strictnum A/B: head.json (current writer rule) vs strictnum.json
 * (tightened NEVER-repeat-seed-numbers rule), both unchecked generation.
 * Judged by checkBattery plus side-effect metrics: overall number usage,
 * tech-token retention (4K-class vocabulary must survive), and yield. */
import fs from "node:fs";
const REPO = "/Users/tylersolloway/Documents/GitHub/procerno";
const CONF = `${process.env.HOME}/Documents/procerno_eval/internal_models/conformance`;
const bc = await import(`${REPO}/src/lib/engine/battery_checks`);
const CAT: Record<string, string> = { Doritos: "tortilla chips", Sephora: "beauty retailers" };
const TECH = /\b(4k|5g|1080p|720p)\b/i;

for (const arm of ["head", "strictnum"]) {
  const d = JSON.parse(fs.readFileSync(`${CONF}/${arm}.json`, "utf8"));
  console.log(`\n===== ${arm}`);
  for (const [brand, P] of Object.entries<any>(d.projects)) {
    const cells = P.cells.map((c: any, i: number) => ({
      stage: c.stage, angle: c.angle, text: c.text,
      phrasings: (P.phrasings[i] ?? []).map((x: any) => (typeof x === "string" ? x : x.text)),
    }));
    const f = bc.checkBattery({ brand, competitors: P.competitors, category: CAT[brand], cells });
    const prop = f.filter((x: any) => x.check === "seed_number_propagation");
    const other = f.filter((x: any) => x.check !== "seed_number_propagation");
    let nPhr = 0, withDigit = 0, techSeed = 0, techKept = 0, short = 0;
    for (const c of cells) {
      nPhr += c.phrasings.length;
      if (c.phrasings.length < 9) short++;
      withDigit += c.phrasings.filter((t: string) => /\d/.test(t)).length;
      if (TECH.test(c.text)) {
        techSeed++;
        if (c.phrasings.some((t: string) => TECH.test(t))) techKept++;
      }
    }
    console.log(`${brand}: cells ${cells.length}, paraphrases ${nPhr} (${short} cells short of 9), ` +
      `propagation cells ${prop.length}, other findings ${other.length}, ` +
      `paraphrases w/ any digit ${(100 * withDigit / nPhr).toFixed(0)}%, ` +
      `tech-token cells kept ${techKept}/${techSeed}`);
    for (const x of prop) console.log(`   prop: ${x.detail} | ${x.text.slice(0, 70)}`);
    for (const x of other.slice(0, 4)) console.log(`   other: ${x.check} | ${x.text.slice(0, 70)}`);
  }
}
