import { openaiClient } from "./providers";
import { logCost } from "../cost_log";
import { definitionStems } from "./definition_overlap";

/**
 * Condition grouping for the decision-rules panels (2026-10-28, Tyler's go;
 * CONDITIONS_PANEL_PLAN_2026-10-27.md). The drc3 conditions are verbatim-
 * anchored free text, so the same circumstance arrives in many wordings
 * ("Deep Atlassian investment" / "already deeply invested in Atlassian
 * tools"). The stem grouping fragmented by an order of magnitude on the
 * fixture (Jira-Linear: 945 rules -> ~556 groups), so grouping is
 * embeddings-first - the consolidate.ts core: text-embedding-3-large +
 * leader clustering in descending count order - with the deterministic stem
 * key as the fallback whenever no OpenAI key is present (the fixture runs
 * keyless by construction) or the embeddings call fails.
 *
 * The map is condition -> stable group key; label selection stays with the
 * caller (most frequent surface form in the accumulated group). Embeddings
 * are not cached per condition - a full run's conditions are ~$0.002 and the
 * computed view rides cachedView's revision key, so prod pays once per
 * recode. Spend is ledgered like consolidation's embedding row. The
 * awareness view groups its adjacent routing quotes through the same core
 * (purpose views:awareness).
 */

const EMBED_MODEL = "text-embedding-3-large";
/** Calibrated on the fixture's Jira-Linear and AmEx-Chase matchups
 * (2026-10-28, sweep 0.45 / 0.55 / 0.65; record in
 * CONDITIONS_PANEL_PLAN_2026-10-27.md): 0.55 collapses wording variance
 * (Jira-Linear 556 stem groups -> 54) while keeping genuinely distinct
 * conditions apart - 0.45 merged frequent international travel into luxury
 * perks, 0.65 re-split one customization idea four ways. */
export const CONDITION_TAU = Number(process.env.CONDITION_TAU ?? 0.55);

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

/** The deterministic fallback key - the stem set, or the lowercased text
 * when no distinctive stem survives. Identical to the hh2 grouping. */
export function conditionStemKey(condition: string, exclude: Set<string>): string {
  const stems = [...definitionStems(condition, exclude).keys()].sort();
  return stems.length > 0 ? stems.join("|") : condition.toLowerCase();
}

/**
 * Group keys for a set of conditions. `counts` maps each TRIMMED condition
 * to its occurrence count; the returned map covers every input key. Case
 * variants of one wording share a vector and a group. Deterministic given
 * the same input set (count-desc, then lexicographic order).
 */
export async function conditionKeyMap(
  counts: Map<string, number>,
  exclude: Set<string>,
  purpose = "views:conditions"
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (counts.size === 0) return out;
  const stems = () => {
    for (const c of counts.keys()) out.set(c, conditionStemKey(c, exclude));
    return out;
  };
  if (!process.env.OPENAI_API_KEY) return stems();

  // Distinct lowercased wordings, high-volume first so they found clusters.
  const byLower = new Map<string, number>();
  for (const [c, n] of counts) {
    const k = c.toLowerCase();
    byLower.set(k, (byLower.get(k) ?? 0) + n);
  }
  const phrases = [...byLower.keys()].sort(
    (a, b) => byLower.get(b)! - byLower.get(a)! || (a < b ? -1 : 1)
  );

  try {
    const vecs: Float32Array[] = new Array(phrases.length);
    let embedTokens = 0;
    for (let k = 0; k < phrases.length; k += 2000) {
      const chunk = phrases.slice(k, k + 2000);
      const res = await openaiClient().embeddings.create({ model: EMBED_MODEL, input: chunk });
      embedTokens += res.usage?.total_tokens ?? 0;
      for (const d of res.data) vecs[k + d.index] = normalize(Float32Array.from(d.embedding));
    }
    logCost({ model: EMBED_MODEL, inputTokens: embedTokens, outputTokens: 0, purpose });

    // Leader clustering, consolidate.ts style: join the nearest centroid
    // within tau, else found a cluster; centroids track the running mean.
    const leaders: number[] = [];
    const centroidSums: Float32Array[] = [];
    const centroids: Float32Array[] = [];
    const groupOf = new Map<string, string>();
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
      if (best >= 0 && bestSim >= CONDITION_TAU) {
        const sum = centroidSums[best];
        for (let d = 0; d < sum.length; d++) sum[d] += vecs[i][d];
        centroids[best] = normalize(sum);
        groupOf.set(phrases[i], `e:${phrases[leaders[best]]}`);
      } else {
        leaders.push(i);
        centroidSums.push(Float32Array.from(vecs[i]));
        centroids.push(vecs[i]);
        groupOf.set(phrases[i], `e:${phrases[i]}`);
      }
    }
    for (const c of counts.keys()) out.set(c, groupOf.get(c.toLowerCase())!);
    return out;
  } catch (e) {
    console.warn(`condition embeddings failed, stem fallback: ${e instanceof Error ? e.message : e}`);
    out.clear();
    return stems();
  }
}

/** Above this many distinct wordings the run-wide grouping takes the
 * shortlist path below; at or under it, conditionKeyMap runs unchanged. */
export const CONDITION_LARGE_AT = 3000;
/** Matryoshka prefix width for the shortlist (text-embedding-3 vectors keep
 * most of their similarity structure in a truncated, renormalized prefix -
 * the same truncation the API's `dimensions` parameter applies). */
const SHORTLIST_DIMS = 256;
/** Centroids per wording scored at full width. */
const SHORTLIST = 24;
/** Bound on clusters founded: the shortlist scan is O(wordings x clusters),
 * so a run with no structure (every wording its own cluster) would
 * otherwise scale quadratically. Real runs sit far under it (tau 0.55 took
 * the fixture's Jira-Linear 556 stem groups to 54). */
export const CONDITION_MAX_CLUSTERS = 6000;

/**
 * conditionKeyMap at run scale (2026-10-30, the rules explorer: ONE
 * grouping over a whole run's conditions - ~10K-25K distinct wordings per
 * tracker on the fixture). The exact leader pass is O(wordings x clusters)
 * at 3072 dims: a synthetic benchmark at 6,000 wordings / 600 clusters took
 * 9s, which puts a Jira-sized run at minutes. Same clustering, two changes:
 * each wording is scored against every centroid on a 256-dim prefix, and
 * only the SHORTLIST best are scored at full width against tau - the join
 * decision is still the full-width similarity, so the result differs from
 * the exact pass only when the true nearest centroid falls outside the
 * prefix shortlist; and vectors stream through in count order a chunk at a
 * time (only centroid sums are kept), so memory is clusters x 3072, not
 * wordings x 3072. Past CONDITION_MAX_CLUSTERS, an unjoined wording keeps
 * its stem key. At or under CONDITION_LARGE_AT wordings, and with no OpenAI
 * key, this IS conditionKeyMap (byte-identical stem fallback).
 */
export async function conditionKeyMapLarge(
  counts: Map<string, number>,
  exclude: Set<string>,
  purpose = "views:conditions"
): Promise<Map<string, string>> {
  const byLower = new Map<string, number>();
  for (const [c, n] of counts) {
    const k = c.toLowerCase();
    byLower.set(k, (byLower.get(k) ?? 0) + n);
  }
  if (!process.env.OPENAI_API_KEY || byLower.size <= CONDITION_LARGE_AT) {
    return conditionKeyMap(counts, exclude, purpose);
  }
  const phrases = [...byLower.keys()].sort(
    (a, b) => byLower.get(b)! - byLower.get(a)! || (a < b ? -1 : 1)
  );
  const out = new Map<string, string>();
  try {
    const CHUNK = 2000;
    const chunks: string[][] = [];
    for (let k = 0; k < phrases.length; k += CHUNK) chunks.push(phrases.slice(k, k + CHUNK));
    // A few chunks in flight, consumed strictly in count order.
    const fetchChunk = (chunk: string[]) => {
      const p = openaiClient().embeddings.create({ model: EMBED_MODEL, input: chunk });
      // A chunk that fails while an earlier one is awaited must not surface
      // as an unhandled rejection; awaiting it below still throws.
      p.catch(() => {});
      return p;
    };
    const inflight: ReturnType<typeof fetchChunk>[] = [];
    const AHEAD = 3;
    for (let i = 0; i < Math.min(AHEAD, chunks.length); i++) inflight.push(fetchChunk(chunks[i]));

    // Cluster state: each centroid is its running sum (cosine against a sum
    // is the dot over the sum's norm - the same as against the normalized
    // mean, without re-allocating a centroid per join), plus its normalized
    // prefix in one contiguous matrix for the shortlist scan.
    const leaders: string[] = [];
    const sums: Float32Array[] = [];
    const norms: number[] = [];
    let pre = new Float32Array(1024 * SHORTLIST_DIMS);
    const setPrefix = (j: number, sum: Float32Array) => {
      if ((j + 1) * SHORTLIST_DIMS > pre.length) {
        const grown = new Float32Array(pre.length * 2);
        grown.set(pre);
        pre = grown;
      }
      let n = 0;
      for (let d = 0; d < SHORTLIST_DIMS; d++) n += sum[d] * sum[d];
      n = Math.sqrt(n) || 1;
      const o = j * SHORTLIST_DIMS;
      for (let d = 0; d < SHORTLIST_DIMS; d++) pre[o + d] = sum[d] / n;
    };
    const groupOf = new Map<string, string>();
    let embedTokens = 0;
    const topIdx = new Int32Array(SHORTLIST);
    const topSim = new Float64Array(SHORTLIST);

    for (let c = 0; c < chunks.length; c++) {
      const res = await inflight[c];
      if (c + AHEAD < chunks.length) inflight.push(fetchChunk(chunks[c + AHEAD]));
      embedTokens += res.usage?.total_tokens ?? 0;
      const vecs: Float32Array[] = new Array(chunks[c].length);
      for (const d of res.data) vecs[d.index] = normalize(Float32Array.from(d.embedding));
      for (let i = 0; i < vecs.length; i++) {
        const v = vecs[i];
        const q = normalize(v.subarray(0, SHORTLIST_DIMS));
        // Prefix pass: keep the SHORTLIST highest prefix similarities.
        let filled = 0;
        for (let j = 0; j < leaders.length; j++) {
          const o = j * SHORTLIST_DIMS;
          let s = 0;
          for (let d = 0; d < SHORTLIST_DIMS; d++) s += pre[o + d] * q[d];
          if (filled < SHORTLIST || s > topSim[SHORTLIST - 1]) {
            let p = filled < SHORTLIST ? filled++ : SHORTLIST - 1;
            while (p > 0 && topSim[p - 1] < s) { topSim[p] = topSim[p - 1]; topIdx[p] = topIdx[p - 1]; p--; }
            topSim[p] = s; topIdx[p] = j;
          }
        }
        // Full-width decision over the shortlist, against tau.
        let best = -1;
        let bestSim = -1;
        for (let t = 0; t < filled; t++) {
          const j = topIdx[t];
          const s = dot(sums[j], v) / norms[j];
          if (s > bestSim) { bestSim = s; best = j; }
        }
        const phrase = chunks[c][i];
        if (best >= 0 && bestSim >= CONDITION_TAU) {
          const sum = sums[best];
          let n = 0;
          for (let d = 0; d < sum.length; d++) { sum[d] += v[d]; n += sum[d] * sum[d]; }
          norms[best] = Math.sqrt(n) || 1;
          setPrefix(best, sum);
          groupOf.set(phrase, `e:${leaders[best]}`);
        } else if (leaders.length < CONDITION_MAX_CLUSTERS) {
          const j = leaders.length;
          leaders.push(phrase);
          sums.push(Float32Array.from(v));
          norms.push(1);
          setPrefix(j, v);
          groupOf.set(phrase, `e:${phrase}`);
        } else {
          // Past the cluster cap a wording that joins nothing keeps its stem
          // key - the tail (lowest counts come last), never a new cluster.
          groupOf.set(phrase, conditionStemKey(phrase, exclude));
        }
      }
    }
    logCost({ model: EMBED_MODEL, inputTokens: embedTokens, outputTokens: 0, purpose });
    for (const c of counts.keys()) out.set(c, groupOf.get(c.toLowerCase())!);
    return out;
  } catch (e) {
    console.warn(`condition embeddings failed, stem fallback: ${e instanceof Error ? e.message : e}`);
    out.clear();
    for (const c of counts.keys()) out.set(c, conditionStemKey(c, exclude));
    return out;
  }
}
