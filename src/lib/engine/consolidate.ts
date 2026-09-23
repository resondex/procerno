import { anthropicClient, openaiClient } from "./providers";
import { logCost, tagCosts } from "../cost_log";

/**
 * Embeddings-first taxonomy consolidation - the production port of the
 * winning bakeoff implementation (labeling/consolidate_embed.py, 2026-09-22:
 * 90-96% content match with the all-LLM reference at ~8min/$0.50 vs
 * 60-90min/$3-4, deterministic similarity core, one judgment call to audit).
 *
 *   A. EMBED - every distinct phrase -> text-embedding-3-large vector.
 *   B. LEADER CLUSTERING - phrases in descending mention count; each joins
 *      the cluster whose centroid is within tau, else founds one.
 *   C. LLM CONSOLIDATION - ONE Opus call merges fine clusters to
 *      buying-argument altitude with scope flags, names, rationales.
 *   D. RECOUNT - mechanical row-incidence + floor; scope-out codes dropped.
 *
 * Ledger: discovery:consolidate per project (embedding row + the Opus row).
 */

const EMBED_MODEL = "text-embedding-3-large";
const CONSOLIDATE_MODEL = process.env.CONSOLIDATE_MODEL ?? "claude-opus-5";

export interface DiscoveryRow {
  responseId: string;
  phrases: string[];
}

export interface ProposalCode {
  code: string;
  rows: number;
  incidence: number;
  scope: "in" | "boundary";
  recommendation: "include" | "flag for review";
  why: string;
  evidence_phrases: string[];
}

export interface TaxonomyProposal {
  brand: string;
  rows: number;
  source: string;
  codes: ProposalCode[];
  /** Per code: its member phrases, capped to the top 30 by mention count -
   * the review screen's reassignment UI without the multi-thousand tail. */
  micros: Record<string, { p: string; n: number }[]>;
}

const norm = (s: string) => (s ?? "").trim().toLowerCase();

/** Cosine similarity of unit vectors = dot product. Tight Float32Array loop -
 * ~P*C*3072 mults for a full brand; a few seconds, not minutes. */
function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export async function consolidateTaxonomy(
  brandName: string,
  discoveryRows: DiscoveryRow[],
  opts: { floor?: number; tau?: number } = {}
): Promise<TaxonomyProposal> {
  const floor = opts.floor ?? 0.01;
  const tau = opts.tau ?? 0.6;
  tagCosts({ purpose: "discovery:consolidate" });

  const rows = new Map<string, string[]>();
  for (const r of discoveryRows) {
    rows.set(
      r.responseId,
      (r.phrases ?? []).map(norm).filter(Boolean)
    );
  }
  const n = rows.size;
  const counts = new Map<string, number>();
  for (const ps of rows.values()) {
    for (const p of ps) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  // Descending count: high-volume phrases found clusters, the tail joins.
  const phrases = [...counts.keys()].sort(
    (a, b) => counts.get(b)! - counts.get(a)! || (a < b ? -1 : 1)
  );

  // --- A. embed ---------------------------------------------------------
  const vecs: Float32Array[] = new Array(phrases.length);
  let embedTokens = 0;
  for (let k = 0; k < phrases.length; k += 2000) {
    const chunk = phrases.slice(k, k + 2000);
    const res = await openaiClient().embeddings.create({
      model: EMBED_MODEL,
      input: chunk,
    });
    embedTokens += res.usage?.total_tokens ?? 0;
    for (const d of res.data) {
      vecs[k + d.index] = normalize(Float32Array.from(d.embedding));
    }
  }
  // Embeddings bypass the chat-level meter - log the spend explicitly.
  logCost({ model: EMBED_MODEL, inputTokens: embedTokens, outputTokens: 0 });

  // --- B. leader clustering ----------------------------------------------
  const members: number[][] = [];
  const centroidSums: Float32Array[] = [];
  const centroids: Float32Array[] = []; // normalized
  for (let i = 0; i < phrases.length; i++) {
    let best = -1;
    let bestSim = -1;
    for (let j = 0; j < centroids.length; j++) {
      const s = dot(centroids[j], vecs[i]);
      if (s > bestSim) {
        bestSim = s;
        best = j;
      }
    }
    if (best >= 0 && bestSim >= tau) {
      members[best].push(i);
      const sum = centroidSums[best];
      for (let d = 0; d < sum.length; d++) sum[d] += vecs[i][d];
      centroids[best] = normalize(sum);
    } else {
      members.push([i]);
      centroidSums.push(Float32Array.from(vecs[i]));
      centroids.push(vecs[i]);
    }
  }
  const fineNames = members.map((ms) => phrases[ms[0]]);
  const fineMentions = members.map((ms) =>
    ms.reduce((s, i) => s + counts.get(phrases[i])!, 0)
  );

  // --- C. one Opus consolidation call -------------------------------------
  const order = fineNames
    .map((_, j) => j)
    .sort((a, b) => fineMentions[b] - fineMentions[a]);
  // Singleton clusters are noise - only >=2 total mentions go to the LLM.
  const fineSig = order.filter((j) => fineMentions[j] >= 2);
  const samples = (j: number) =>
    members[j]
      .slice()
      .sort((a, b) => counts.get(phrases[b])! - counts.get(phrases[a])!)
      .slice(0, 4)
      .map((i) => phrases[i])
      .join(", ");
  const prompt =
    `You are consolidating fine-grained attribute clusters into the reason-code ` +
    `taxonomy for a brand-tracking dashboard about the market behind ${brandName}.\n` +
    "FINE CLUSTERS (numbered, with mention counts and sample phrases):\n" +
    fineSig
      .map((j, i) => `${i}. ${fineNames[j]} (${fineMentions[j]}) e.g. ${samples(j)}`)
      .join("\n") +
    "\n\nMerge these into final codes, assigning EVERY cluster number to exactly " +
    "one code. Rules:\n" +
    "- ALTITUDE: one code per distinct buying argument - the level a dashboard " +
    "user reasons at. Merge facets of the same argument.\n" +
    "- SCOPE 'in': attributes of the products/services in this category.\n" +
    "- SCOPE 'out': generic benefit language that is not a product attribute " +
    "(e.g. 'risk reduction', 'goals and outcomes', 'productivity gains').\n" +
    "- SCOPE 'boundary': real arguments about adjacent-category substitutes " +
    "(e.g. cable-TV hardware in a streaming market) - kept visible, flagged " +
    "for a human include/exclude call.\n" +
    "- No umbrella code beside its own specifics.\n" +
    "- Size prior: a usable taxonomy is typically 25-40 in-scope codes; do not " +
    "pad, do not force merges that blur genuinely distinct arguments.\n" +
    "- Names: 1-3 lowercase words drawn from the member clusters.\n" +
    'Reply ONLY JSON: {"codes": [{"name": "<name>", "scope": "in|boundary|out", ' +
    '"members": [cluster_numbers], "why": "<one-line rationale>"}]}';

  // Serverless ceiling note: this plan caps functions at maxDuration 300s
  // and this one Opus call can approach that on a large brand. A killed
  // invocation is safe - discovery is already persisted per answer, the
  // stalled-run sweep re-drives, and only this call's ~$0.50 re-spends.
  // If it recurs, set CONSOLIDATE_EFFORT=low or move the call to the
  // Batch API poller.
  const anthropic = await anthropicClient();
  const res = await anthropic.messages.create(
    {
      model: CONSOLIDATE_MODEL,
      max_tokens: 60000,
      // Opus 5 rejects sampling params; effort medium matches the bakeoff.
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
    } as never,
    { timeout: 900_000 }
  );
  const text = (res as { content: { type: string; text?: string }[] }).content
    .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
    .join("");
  // Robust parse: fences, prose around the JSON, trailing commas - every
  // failure mode the bakeoff hit, handled before it throws.
  let t = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  t = t.slice(t.indexOf("{"));
  t = t.replace(/,\s*([}\]])/g, "$1");
  const cons = JSON.parse(t) as {
    codes: { name: string; scope?: string; members: number[]; why?: string }[];
  };

  // Duplicate member assignments: first wins (observed Opus failure mode).
  const fine2code = new Map<string, string>();
  const codeMeta = new Map<string, { scope: string; why: string }>();
  for (const code of cons.codes) {
    const name = norm(code.name);
    if (!codeMeta.has(name)) {
      codeMeta.set(name, {
        scope: code.scope ?? "in",
        why: code.why ?? "",
      });
    }
    for (const i of code.members ?? []) {
      const idx = Math.trunc(i);
      if (idx >= 0 && idx < fineSig.length) {
        const fname = fineNames[fineSig[idx]];
        if (!fine2code.has(fname)) fine2code.set(fname, name);
      }
    }
  }

  // phrase -> final code via its fine cluster
  const p2code = new Map<string, string>();
  members.forEach((ms, j) => {
    const c = fine2code.get(fineNames[j]);
    if (c) for (const i of ms) p2code.set(phrases[i], c);
  });

  // --- D. recount + proposal shape ----------------------------------------
  const codeRows = new Map<string, Set<string>>();
  for (const [rid, ps] of rows) {
    for (const p of ps) {
      const c = p2code.get(p);
      if (c) (codeRows.get(c) ?? codeRows.set(c, new Set()).get(c)!).add(rid);
    }
  }
  const codes: ProposalCode[] = [];
  for (const [c, meta] of codeMeta) {
    const rct = codeRows.get(c)?.size ?? 0;
    if (meta.scope === "out" || rct / n < floor) continue;
    const ev = [...p2code.entries()]
      .filter(([, cc]) => cc === c)
      .map(([p]) => p)
      .sort((a, b) => counts.get(b)! - counts.get(a)!)
      .slice(0, 8);
    codes.push({
      code: c,
      rows: rct,
      incidence: rct / n,
      scope: meta.scope === "boundary" ? "boundary" : "in",
      recommendation: meta.scope === "boundary" ? "flag for review" : "include",
      why: meta.why,
      evidence_phrases: ev,
    });
  }
  codes.sort((a, b) => b.rows - a.rows);

  const micros: Record<string, { p: string; n: number }[]> = {};
  for (const [p, c] of p2code) {
    (micros[c] ??= []).push({ p, n: counts.get(p) ?? 0 });
  }
  for (const c of Object.keys(micros)) {
    micros[c] = micros[c].sort((a, b) => b.n - a.n).slice(0, 30);
  }
  return {
    brand: brandName,
    rows: n,
    source: "in-run discovery, embeddings-first consolidation",
    codes,
    micros,
  };
}
