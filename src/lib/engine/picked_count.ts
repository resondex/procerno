import { buildResolver } from "./brand_resolve";
import type { AnswerPickRow, DictionaryEntry } from "../types";

/**
 * Ignored names the AI keeps picking (2026-11-13). A direct model ignore
 * folds behind the board's receipt unless the name is in 10% of answers, so
 * a name the suggestion model misjudged can stay hidden while the coded
 * answers pick it or send buyers to it (a phone OS that runs only on the
 * tracked brand's phones sat ignored while 50 answers named it as the exit).
 * No string rule or co-occurrence number sees that; the coded answers do.
 *
 * Counted per ignored or unreviewed entry: coded answers whose top pick,
 * leave destination or redirect resolves to it through the CURRENT
 * dictionary (exact, or family containment over ignored entries - the
 * resolver the views read, without context-judge verdicts). The shared
 * ignoreSurfaces rule turns a count at or above PICKED_FLAG_MIN into a
 * flagged pill. No model calls; it never decides, it only asks for a look.
 */
export function countPickedIgnores(
  rows: AnswerPickRow[],
  entries: DictionaryEntry[]
): Map<string, number> {
  const resolve = buildResolver(entries);
  const out = new Map<string, number>();
  for (const r of rows) {
    const hit = new Set<string>();
    for (const name of [r.top_pick, ...(r.destinations ?? []), ...(r.redirect_to ?? [])]) {
      if (!name || !name.trim()) continue;
      const res = resolve(name);
      if (res.entry && (res.status === "rejected" || res.status === "pending")) hit.add(res.entry.id);
    }
    for (const id of hit) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}
