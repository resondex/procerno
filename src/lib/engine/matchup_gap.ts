import { containsSeq, famTokens } from "./brand_family";
import type { RateCell } from "./view_data";
import type { DictionaryEntry, Intent } from "../types";

/**
 * The "never asked head to head" rule (2026-11-13), in ONE place: the rival
 * dossier's amber callout and the Overview's unasked_rival finding both read
 * it, so the flag and the finding can never disagree. Map-free on purpose -
 * summary_insights must not import dossiers (dossiers imports the map).
 *
 * A rival is a matchup gap when it takes at least NO_H2H_ALERT of the picks
 * (its share of decided open-choice answers) and the run asked no direct
 * matchup against it - neither an entity cell (angle = the rival) nor a
 * class cell naming it.
 */

/** A brand taking at least this share of the picks with no matchup asked gets the amber callout. */
export const NO_H2H_ALERT = 0.1;

/** The share clears the callout threshold. */
export function clearsMatchupGap(share: RateCell): boolean {
  return share.n > 0 && share.k / share.n >= NO_H2H_ALERT;
}

/**
 * The rival keys (active dictionary entry ids) the run asked a direct
 * matchup against, from the head-to-head pools' intents: an entity cell's
 * angle resolved through the dictionary, a class cell's class brand (the
 * longest active entry form in its text, the client excluded - the same
 * rule as the map and head_to_head.ts).
 */
export function askedMatchupKeys(
  intents: Pick<Intent, "angle" | "text">[],
  resolve: (name: string) => { key: string | null; status: string },
  dictionary: DictionaryEntry[],
  targetKey: string
): Set<string> {
  const out = new Set<string>();
  let forms: { seq: string[]; entry: DictionaryEntry }[] | null = null;
  for (const i of intents) {
    if (i.angle === "class") {
      if (!forms) {
        forms = [];
        for (const e of dictionary) {
          if (e.status !== "active") continue;
          for (const f of [e.canonical, ...e.aliases]) forms.push({ seq: famTokens(f), entry: e });
        }
      }
      const hay = famTokens(i.text);
      let best: { seq: string[]; entry: DictionaryEntry } | null = null;
      for (const f of forms) {
        if (f.entry.id === targetKey) continue;
        if (containsSeq(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
      }
      if (best) out.add(best.entry.id);
      continue;
    }
    const r = resolve(i.angle);
    if (r.status === "active" && r.key) out.add(r.key);
  }
  return out;
}
