import { store } from "../store";
import { matchKey } from "../brand_key";
import { containsSeq, famTokens } from "./dict_suggest";

/**
 * Brand observations, recomputable: per observed name, the number of answers
 * naming it, attributed to a dictionary entry by matchKey OR by family
 * containment (a name extending a tracked brand's name/alias counts toward
 * that brand - "Samsung Galaxy S24 Ultra" is Samsung Galaxy reach, not an
 * emerged stranger). Reads discovery_brands with a mentions-table fallback,
 * so it works for bootstrap and coded runs alike, and it is cheap enough to
 * re-run whenever the dictionary changes - entry attribution can never go
 * stale the way the frozen aggregation snapshot did (the Wells Fargo
 * NOT SEEN bug). Emerged names below 1% of answers are dropped as noise.
 */
export async function computeBrandObservations(projectId: string): Promise<{
  rows: number;
  observed: { name: string; entry_id: string | null; answers: number }[];
}> {
  const [brandRows, dict] = await Promise.all([
    store.listProjectBrandRows(projectId),
    store.getDictionary(projectId),
  ]);
  const keyToEntry = new Map<string, string>();
  const activeSeqs: { seq: string[]; entryId: string }[] = [];
  for (const e of dict) {
    keyToEntry.set(matchKey(e.canonical), e.id);
    for (const a of e.aliases) keyToEntry.set(matchKey(a), e.id);
    if (e.status === "active" && e.canonical !== "Other") {
      activeSeqs.push({ seq: famTokens(e.canonical), entryId: e.id });
      for (const a of e.aliases) {
        activeSeqs.push({ seq: famTokens(a), entryId: e.id });
      }
    }
  }
  const familyEntry = (name: string): string | null => {
    const hay = famTokens(name);
    let best: { entryId: string; len: number } | null = null;
    for (const { seq, entryId } of activeSeqs) {
      if (containsSeq(hay, seq) && (!best || seq.length > best.len)) {
        best = { entryId, len: seq.length };
      }
    }
    return best?.entryId ?? null;
  };

  const byKey = new Map<
    string,
    { answers: number; forms: Map<string, number>; entryId: string | null }
  >();
  let rows = 0;
  for (const r of brandRows) {
    rows++;
    const seen = new Set<string>();
    for (const b of r.brands) {
      const k = matchKey(b);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const g =
        byKey.get(k) ??
        {
          answers: 0,
          forms: new Map<string, number>(),
          entryId: keyToEntry.get(k) ?? familyEntry(b),
        };
      g.answers++;
      g.forms.set(b, (g.forms.get(b) ?? 0) + 1);
      byKey.set(k, g);
    }
  }
  const observed = [...byKey.values()]
    .map((g) => ({
      name: [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0],
      entry_id: g.entryId,
      answers: g.answers,
    }))
    .sort((a, b) => b.answers - a.answers)
    // attributed names always kept; emerged names only above 1% of answers
    .filter((o) => o.entry_id !== null || o.answers >= rows * 0.01)
    .slice(0, 120);
  return { rows, observed };
}

/** Recompute, persist, and queue the emerged names. Safe to call after any
 * dictionary change; answers are never touched. */
export async function refreshBrandObservations(projectId: string): Promise<void> {
  const { rows, observed } = await computeBrandObservations(projectId);
  if (rows === 0) return; // nothing detected yet - keep whatever exists
  await store.setBrandObservations(
    projectId,
    JSON.stringify({ rows, generated_at: new Date().toISOString(), observed })
  );
  await store.queueDictionaryCandidates(
    projectId,
    observed.filter((o) => !o.entry_id).map((o) => o.name)
  );
}
