import { BRAND_DOMINATED, COMMON_WORDS } from "./everyday_words";

/**
 * The wall detector (moved out of analysis_map.ts 2026-11-03 so the summary
 * insights can reuse it without importing the map compute): a condition
 * group is a wall when its wording is possession/state-shaped - the buyer
 * already has, uses or is inside something - rather than a want. Shared by
 * the analysis map's wall badge and the summary's away-condition insight.
 */

/**
 * Possession / state wording: the buyer already has, uses or is inside
 * something. Calibrated on the five fixture trackers' away groups (the
 * harness prints the table): "already owns Apple devices" flags, "craving
 * bold flavor" does not.
 *
 * Tightened 2026-11-10 after the redesign turned the badge into a sentence
 * ("a situation you cannot argue against"), calibrated on the six live
 * trackers' grouped wordings: (1) "already" alone is not possession - it
 * needs a holding verb after it ("already know exactly what you want" and
 * "teams already work around X" are not walls); (2) "own" as something the
 * buyer will or must do is not possession; (3) the test reads the wording
 * that is SHOWN, never a group's other member wordings; (4) a state about
 * the tracker's own brand on the away side is a complaint to contest, not a
 * wall - callers pass the brand's name as `own` for away-side wordings.
 */
const HOLD = "(?:ha(?:ve|s|d)|hold(?:s|ing)?|own(?:s|ed|ing)?|us(?:e|es|ed|ing)|pay(?:s|ing)?|paid|subscrib\\w*|bank(?:s|ing)?|shop(?:s|ping)?|buy(?:s|ing)?|live[sd]?|run(?:s|ning)?|work(?:s|ing)? (?:in|on|with|inside)|invest\\w*|commit\\w*|standardi[sz]\\w*|in|on|with|inside|a (?:customer|member|subscriber|user)|deep(?:ly)?|heavily|locked|tied)";
const WALL_PATTERN = new RegExp(
  "\\b(?:already (?:" + HOLD + ")\\b|existing (?:customer|member|subscriber|user|account|contract|plan|card|device|phone|stack|setup|investment|relationship)s?|current(?:ly)? (?:" + HOLD + "|user|customer|subscriber|member|owner)s?\\b|invested in|investment in|entrenched|locked[- ]in(?:to)?|tied into|committed to|loyal(?:ty)? to|(?<!\\b(?:will|to|would|could|should|must|can|nobody|who|not) )own(?:s|ing)? (?:an?|the|one|two|three|several|multiple|other|older|their|your|its)\\b|\\bowners? of|ha(?:s|ve) an? (?!say|choice|chance|need|preference|problem|question|budget|lot|few|reason|hard)|on an? \\w+ (?:plan|account|phone|device)|in(?:side)? the [\\w+'-]+ (?:ecosystem|world)|ecosystem user|subscribed to|subscribers? (?:to|of)|member of)",
  "i"
);
/** Possession of a NAMED thing (case-sensitive, so the object must be a
 * proper name): "parents use iPhones", "a Microsoft shop", "GitHub-centric
 * teams". A bare "using" is not a wall ("team using 20% of features"), and
 * neither is something the buyer must or should use. */
const WALL_NAMED = /(?<!\b(?:must|should|to|will|would|could|can|or|older|a|an|the|nobody|not|you'll|we'll|they'll) )\b(?:uses?|using|owns?|owning)\s+(?:an?\s+|the\s+|other\s+)?(?:[A-Z][\w+&'-]*|i[A-Z]\w*)|\b([A-Z][\w+&'-]+)\s+(?:shop|house|household|stack)s?\b|\b([A-Z][\w+&']+)-(?:centric|native)\b/g;
/** Want wording: a preference or a desire, never a state. A want verb
 * without "already" keeps the group out of the walls. */
const WANT_PATTERN = /\b(crav\w*|love[sd]?|prefer\w*|wants?|wanting|looking for|wish\w*|desire\w*|enjoy\w*|seek\w*|after (?:a|the) |hates?|dislikes?)\b/i;

/** No wall where the wording denies the state ("not locked into X", "don't use Y much"). */
const NEGATED = /\b(?:not|no|never|without|nobody|none)\b|n't\b|n’t\b/i;

/** A capitalised word counts as a name unless it is an everyday word that
 * merely opens the wording ("Mixed-taste household", "Online-first"). */
function namedHit(shown: string): boolean {
  WALL_NAMED.lastIndex = 0;
  for (let m = WALL_NAMED.exec(shown); m; m = WALL_NAMED.exec(shown)) {
    const name = m[1] ?? m[2];
    if (!name) return true; // the use/own + proper-name branch
    const opens = m.index === 0 || /^[\s"'(]*$/.test(shown.slice(0, m.index));
    const first = name.split(/[-']/)[0];
    const everyday = COMMON_WORDS.has(first.toLowerCase()) && !BRAND_DOMINATED.has(first.toLowerCase()) && !/[a-z][A-Z]/.test(first);
    if (!opens || !everyday) return true;
  }
  return false;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `own`: the tracker's own brand name, passed for AWAY-side wordings only -
 * a wording that names it describes the buyer's experience of the brand
 * itself, which is contestable. */
export function isWallWording(texts: string[], own?: string | null): boolean {
  const shown = (texts[0] ?? "").trim();
  if (!shown) return false;
  if (NEGATED.test(shown)) return false;
  if (!WALL_PATTERN.test(shown) && !namedHit(shown)) return false;
  // A want verb outweighs a stray state word unless the state is explicit.
  if (WANT_PATTERN.test(shown) && !/\balready\b/i.test(shown)) return false;
  if (own) {
    const words = own.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length && new RegExp("\\b(?:" + words.map(esc).join("|") + ")", "i").test(shown)) return false;
  }
  return true;
}
