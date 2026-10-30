/**
 * Build a tracker's projects.coder_inputs from the frozen labeling files
 * (shared by scripts/coder_inputs.mts and scripts/coder_prompt_proof.mts, so
 * the proof exercises exactly what the admin script would store).
 *
 * - flag_vocab: the tracker's frozen flag vocabulary file
 *   (labeling/v2_build/flag_vocab derivation; price_forms / spec_forms
 *   .display, in file order) - what build_batch.mts --mode v2 read.
 * - critic: the advocacy cells' quoted criticism, from the tracker's stages
 *   file (labeling/g3/stages_<slug>.json, hand-reviewed critic line per
 *   prompt id), re-keyed by intent id through the tracker's prompts.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import type { CoderInputs } from "../../src/lib/engine/coder_prompts";

const CRITIC_RE = /^Question design \(doubt\): the customer quotes a criticism someone raised about (.+)\. Criticism: "(.*)"$/;

export function buildCoderInputsFromFiles(opts: {
  slug: string;
  brand: string;
  flagVocabPath: string;
  stagesPath: string;
  prompts: { id: string; intent_id: string | null }[];
  intents: { id: string; stage: string }[];
}): { inputs: CoderInputs; notes: string[] } {
  const notes: string[] = [];
  const fvRaw = fs.readFileSync(opts.flagVocabPath);
  const fv = JSON.parse(fvRaw.toString("utf8")) as { brand?: string; price_forms?: { display: string }[]; spec_forms?: { display: string }[] };
  if (fv.brand !== opts.slug) throw new Error(`${opts.flagVocabPath} is for tracker ${JSON.stringify(fv.brand)}, not ${opts.slug}`);
  if (!Array.isArray(fv.price_forms) || !Array.isArray(fv.spec_forms)) throw new Error(`${opts.flagVocabPath} has no price_forms / spec_forms lists`);
  const stagesRaw = fs.readFileSync(opts.stagesPath);
  const stages = JSON.parse(stagesRaw.toString("utf8")) as Record<string, { stage?: string; line?: string | null }>;
  const intentOf = new Map(opts.prompts.map((p) => [p.id, p.intent_id]));
  const advocacy = new Set(opts.intents.filter((i) => i.stage === "advocacy").map((i) => i.id));
  const critic: Record<string, string> = {};
  for (const [pid, d] of Object.entries(stages)) {
    if (d.stage !== "advocacy") continue;
    const iid = intentOf.get(pid);
    if (!iid) {
      notes.push(`stages prompt ${pid} is not a prompt of this tracker`);
      continue;
    }
    if (!d.line) throw new Error(`advocacy prompt ${pid} has no critic line in ${opts.stagesPath} (fill it first)`);
    const m = d.line.match(CRITIC_RE);
    if (!m) throw new Error(`advocacy prompt ${pid}: critic line is not in the builder's format: ${d.line}`);
    if (m[1] !== opts.brand) throw new Error(`advocacy prompt ${pid}: critic line names ${m[1]}, not ${opts.brand}`);
    if (critic[iid] !== undefined && critic[iid] !== m[2]) throw new Error(`advocacy cell ${iid}: prompts carry different criticisms`);
    critic[iid] = m[2];
  }
  for (const iid of advocacy) if (!critic[iid]) notes.push(`advocacy cell ${iid} has no criticism in ${opts.stagesPath}`);
  const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
  return {
    inputs: {
      version: 1,
      flag_vocab: { price: fv.price_forms.map((x) => x.display), spec: fv.spec_forms.map((x) => x.display) },
      critic,
      provenance: {
        flag_vocab: { file: opts.flagVocabPath, sha256: sha(fvRaw) },
        stages: { file: opts.stagesPath, sha256: sha(stagesRaw) },
        built_at: new Date().toISOString(),
      },
    },
    notes,
  };
}
