/**
 * One-off probe: regenerate Sephora's paraphrase sets fresh (cache rows
 * deleted beforehand) and report per-cell counts, to verify the blind
 * first-pass margin (PHRASINGS_EXTRA_BLIND) removed the init shortfalls
 * that Discovery/Comparison showed at 31/40 under the old margin.
 *
 *   npx tsx --env-file=.env.local scripts/probe_blind_margin.ts
 */
import {
  composeInstrument,
  generateGrid,
  generatePhrasings,
  namesAnyBrand,
} from "../src/lib/engine/instrument";

const ENTRY = {
  brand: "Sephora",
  category: "beauty retailers",
  audience: "makeup and skincare shoppers",
  competitors: ["Ulta Beauty", "Amazon (beauty)", "Target (beauty)", "Macy's (beauty)", "Nordstrom (beauty)"],
};
const COUNT = 10;
const BATCH = 8; // mirror the UI's batching

async function main() {
  const composed = await composeInstrument({
    category: ENTRY.category,
    audience: ENTRY.audience,
    meta: { brand: ENTRY.brand, source: "probe" },
  });
  if (!composed) throw new Error("read empty");
  const stages = composed.stages.filter((s) => s.recommended);
  const cells = await generateGrid({
    brand: ENTRY.brand,
    category: ENTRY.category,
    competitors: ENTRY.competitors,
    audience: ENTRY.audience,
    base: composed.base,
    scenarios: composed.scenarios,
    stages,
    meta: { source: "probe" },
  });
  if (!cells) throw new Error("cells empty");
  console.log(`cells: ${cells.length} (cached read+grid; phrasings fresh)`);
  const byStage: Record<string, { cells: number; kept: number; shorts: string[] }> = {};
  for (let i = 0; i < cells.length; i += BATCH) {
    const slice = cells.slice(i, i + BATCH);
    const sets = await generatePhrasings({
      brand: ENTRY.brand,
      category: ENTRY.category,
      competitors: ENTRY.competitors,
      audience: ENTRY.audience,
      base: composed.base,
      scenarios: composed.scenarios,
      cells: slice.map((c) => ({
        stage: c.stage, situation: c.situation, angle: c.angle, mode: c.mode ?? null, text: c.text,
      })),
      count: COUNT,
      meta: { source: "probe" },
    });
    slice.forEach((c, j) => {
      const total = 1 + (sets[j]?.length ?? 0);
      const st = (byStage[c.stage] ??= { cells: 0, kept: 0, shorts: [] });
      st.cells++;
      st.kept += total;
      if (total < COUNT) {
        const blind = !namesAnyBrand(c.text, ENTRY.brand, ENTRY.competitors);
        st.shorts.push(`${total}/${COUNT}${blind ? " (blind)" : ""}`);
      }
    });
    process.stdout.write(`batch ${1 + i / BATCH}: done\n`);
  }
  console.log("\nper-stage:");
  let shortCells = 0;
  for (const [stage, s] of Object.entries(byStage)) {
    const flag = s.shorts.length > 0 ? `  SHORT: ${s.shorts.join(", ")}` : "";
    shortCells += s.shorts.length;
    console.log(`  ${stage}: ${s.kept}/${s.cells * COUNT}${flag}`);
  }
  console.log(shortCells === 0 ? "\nPASS: every cell full on init." : `\n${shortCells} cell(s) short on init.`);
  process.exit(0);
}

void main();
