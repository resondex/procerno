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
