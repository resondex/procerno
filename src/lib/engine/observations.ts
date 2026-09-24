import { store } from "../store";
import { cleanSurface, matchKey } from "../brand_key";
import { containsSeq, famTokens } from "./dict_suggest";

/** Family membership for attribution: token containment, but a SINGLE-token
 * brand name only claims a form that leads with it (or a two-token form) -
 * "galaxy ai" belongs to Samsung Galaxy, "fire tv stick 4k max" does not
 * belong to Max just because "max" trails a device name. */
export function familyContains(hay: string[], seq: string[]): boolean {
  if (!containsSeq(hay, seq)) return false;
  if (seq.length >= 2) return true;
  return hay[0] === seq[0] || hay.length <= 2;
}

/** Evidence attribution, shared by the co-occurrence guard and the
 * examples view so their numbers can never disagree: a detected name is
 * evidence for a form only under LEAD-PRESERVING containment (one name
 * begins with the other - "Prime Video" extends Prime, "Amazon Prime"
 * truncates Amazon Prime Video, but "Sonic Prime" and "MGM+" are their own
 * names), and it belongs to whichever of satellite/parent it matches most
 * specifically; an exact satellite match always wins. */
export function evidenceOwner(
  det: string[],
  satSeq: string[],
  parentSeqs: string[][]
): "sat" | "parent" | null {
  const eq = (a: string[], b: string[]) =>
    a.length === b.length && a.every((t, i) => t === b[i]);
  const score = (seq: string[]) => {
    if (eq(det, seq)) return seq.length + 0.5;
    if (containsSeq(det, seq) && det[0] === seq[0]) return seq.length;
    if (containsSeq(seq, det) && seq[0] === det[0]) return det.length;
    return 0;
  };
  if (eq(det, satSeq)) return "sat";
  const ps = parentSeqs.reduce((m, seq) => Math.max(m, score(seq)), 0);
  const ss = score(satSeq);
  if (ss === 0 && ps === 0) return null;
  return ss > ps ? "sat" : "parent";
}

/** Does a detected name refer to the same offering as any of the parent's
 * name-forms? Token-contiguous containment in EITHER direction: the
 * detected name may extend a parent form ("Amazon Prime Video 4K") or
 * truncate it ("Amazon Prime", "Prime") - one-directional substring
 * matching classified truncations as not-the-parent. Truncations go
 * through familyContains so a stray trailing token can't claim a name. */
export function coRefers(detectedTokens: string[], parentSeqs: string[][]): boolean {
  for (const seq of parentSeqs) {
    if (containsSeq(detectedTokens, seq)) return true;
    if (familyContains(seq, detectedTokens)) return true;
  }
  return false;
}

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
      if (familyContains(hay, seq) && (!best || seq.length > best.len)) {
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
  // Trivial-plural fold: "Delta Sky Clubs" and "Delta Sky Club" are one
  // name. When a key is another key plus a trailing s/es, its counts fold
  // into the shorter form (matchKey strips spacing, so this works on the
  // concatenated key). Only observed identities fold - dictionary entries
  // are never touched here.
  for (const k of [...byKey.keys()]) {
    const base = k.endsWith("es") && byKey.has(k.slice(0, -2))
      ? k.slice(0, -2)
      : k.endsWith("s") && byKey.has(k.slice(0, -1))
        ? k.slice(0, -1)
        : null;
    if (!base || base === k) continue;
    const from = byKey.get(k)!;
    const into = byKey.get(base)!;
    into.answers += from.answers;
    for (const [f, c] of from.forms) into.forms.set(f, (into.forms.get(f) ?? 0) + c);
    into.entryId = into.entryId ?? from.entryId;
    byKey.delete(k);
  }
  const observed = [...byKey.values()]
    .map((g) => ({
      name: cleanSurface([...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0]),
      entry_id: g.entryId,
      answers: g.answers,
    }))
    .sort((a, b) => b.answers - a.answers)
    // attributed names always kept; emerged names only above 1% of answers
    .filter((o) => o.entry_id !== null || o.answers >= rows * 0.01)
    .slice(0, 120);
  return { rows, observed };
}

/**
 * Observed-form aliases: surface forms the answers actually use, promoted to
 * aliases of the entry their family resolves to - but only forms too small
 * to ever reach the tray (below the 1% pending floor), so nothing a human
 * would adjudicate is decided here. This is what makes read-time matching
 * (metrics roll-ups run on matchKey over aliases) keep up with the data:
 * "Galaxy S24 FE" named in 12 answers counts toward Samsung Galaxy without
 * anyone dragging a pill. Returns what it added, plus the seeded aliases
 * never observed in any answer (prune candidates - reported, not removed).
 */
export async function refreshObservedAliases(projectId: string): Promise<{
  added: { entry: string; alias: string; answers: number }[];
  unusedSeeded: { entry: string; alias: string }[];
}> {
  const [brandRows, dict] = await Promise.all([
    store.listProjectBrandRows(projectId),
    store.getDictionary(projectId),
  ]);
  const known = new Map<string, string>(); // matchKey -> entry id (any status)
  for (const e of dict) {
    known.set(matchKey(e.canonical), e.id);
    for (const a of e.aliases) known.set(matchKey(a), e.id);
  }
  const active = dict.filter((e) => e.status === "active" && e.canonical !== "Other");
  const activeSeqs = active.flatMap((e) => [
    { seq: famTokens(e.canonical), entryId: e.id },
    ...e.aliases.map((a) => ({ seq: famTokens(a), entryId: e.id })),
  ]);
  const counts = new Map<string, { answers: number; form: string }>();
  const observedKeys = new Set<string>();
  let rows = 0;
  for (const r of brandRows) {
    rows++;
    const seen = new Set<string>();
    for (const b of r.brands) {
      const k = matchKey(b);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      observedKeys.add(k);
      const g = counts.get(k) ?? { answers: 0, form: b };
      g.answers++;
      counts.set(k, g);
    }
  }
  const added: { entry: string; alias: string; answers: number }[] = [];
  const floor = rows * 0.01;
  for (const [k, g] of counts) {
    if (known.has(k)) continue; // already matches something
    if (g.answers < 3 || g.answers >= floor) continue; // noise, or tray-sized
    const hay = famTokens(g.form);
    let best: { entryId: string; len: number } | null = null;
    for (const { seq, entryId } of activeSeqs) {
      if (familyContains(hay, seq) && (!best || seq.length > best.len)) {
        best = { entryId, len: seq.length };
      }
    }
    if (!best) continue;
    const entry = dict.find((e) => e.id === best!.entryId)!;
    const alias = cleanSurface(g.form).toLowerCase();
    await store.upsertDictionaryEntry({
      id: entry.id,
      projectId,
      canonical: entry.canonical,
      aliases: [...new Set([...entry.aliases, alias])],
      status: "active",
    });
    entry.aliases.push(alias);
    added.push({ entry: entry.canonical, alias, answers: g.answers });
  }
  const unusedSeeded = active.flatMap((e) =>
    e.aliases
      .filter((a) => !observedKeys.has(matchKey(a)))
      .map((a) => ({ entry: e.canonical, alias: a }))
  );
  if (added.length > 0) await store.bumpDictionaryVersion(projectId);
  return { added, unusedSeeded };
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
