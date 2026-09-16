/**
 * Diagnostic: which Sephora comparison cell keeps ~nothing, and which
 * filter gate is discarding its candidates? Runs one forced pass per
 * comparison cell with the raw model output captured, then re-applies
 * the filter's gates one by one and prints the verdict per candidate.
 *
 *   npx tsx --env-file=.env.local scripts/probe_comparison_cell.ts
 */
import {
  composeInstrument,
  generateGrid,
  generatePhrasings,
  brandSignature,
} from "../src/lib/engine/instrument";

const ENTRY = {
  brand: "Sephora",
  category: "beauty retailers",
  audience: "makeup and skincare shoppers",
  competitors: ["Ulta Beauty", "Amazon (beauty)", "Target (beauty)", "Macy's (beauty)", "Nordstrom (beauty)"],
};

async function main() {
  const composed = await composeInstrument({
    category: ENTRY.category,
    audience: ENTRY.audience,
    meta: { brand: ENTRY.brand, source: "probe" },
  });
  if (!composed) throw new Error("read empty");
  const cells = await generateGrid({
    brand: ENTRY.brand,
    category: ENTRY.category,
    competitors: ENTRY.competitors,
    audience: ENTRY.audience,
    base: composed.base,
    scenarios: composed.scenarios,
    stages: composed.stages.filter((s) => s.recommended),
    meta: { source: "probe" },
  });
  if (!cells) throw new Error("cells empty");
  const comparison = cells.filter((c) => c.stage === "comparison");
  const rivals = ENTRY.competitors.slice(0, 4);
  for (const c of comparison) {
    console.log(`\n=== [${c.angle}] seed sig="${brandSignature(c.text, ENTRY.brand, rivals)}"`);
    console.log(`    seed: ${c.text.slice(0, 110)}`);
    let raw: unknown = null;
    const sets = await generatePhrasings({
      brand: ENTRY.brand,
      category: ENTRY.category,
      competitors: ENTRY.competitors,
      audience: ENTRY.audience,
      base: composed.base,
      scenarios: composed.scenarios,
      cells: [{ stage: c.stage, situation: c.situation, angle: c.angle, mode: c.mode ?? null, text: c.text }],
      count: 10,
      force: true,
      onRaw: (r) => { raw = r; },
      meta: { source: "probe" },
    });
    console.log(`    kept: ${sets[0]?.length ?? 0}`);
    const sig = brandSignature(c.text, ENTRY.brand, rivals);
    const parsed = raw as { cells?: { index: number; phrasings: { text: string }[] }[] } | null;
    for (const p of parsed?.cells?.[0]?.phrasings ?? []) {
      const csig = brandSignature(p.text, ENTRY.brand, rivals);
      const verdict = csig !== sig ? `SIG MISMATCH ("${csig}")` : "sig ok";
      console.log(`    - ${verdict} :: ${p.text.slice(0, 90)}`);
    }
  }
  process.exit(0);
}

void main();
