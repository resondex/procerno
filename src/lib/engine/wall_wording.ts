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
 */
const WALL_PATTERN =
  /\b(already|existing|currently|current (?:user|customer|subscriber|member|owner)s?|invested|investment|entrenched|locked[- ]in|tied (?:in)?to|committed to|loyal(?:ty)?|own(?:s|ing)?|owner|has an?|have an?|on an? \w+ (?:plan|account|phone|device)|in(?:side)? the [\w+'-]+ (?:ecosystem|world)|ecosystem user|subscribed|subscriber|member of|pays? for)\b/i;
/** Possession of a NAMED thing (case-sensitive, so the object must be a
 * proper name): "parents use iPhones", "a Microsoft shop", "GitHub-centric
 * teams". A bare "using" is not a wall ("team using 20% of features"). */
const WALL_NAMED = /\b(?:use[sd]?|using)\s+(?:an?\s+|the\s+|other\s+)?(?:[A-Z][\w+&'-]*|i[A-Z]\w*)|\b[A-Z][\w+&'-]*\s+(?:shop|house|stack)\b|\b[A-Z][\w+&'-]*-(?:centric|native|based|first)\b/;
/** Want wording: a preference or a desire, never a state. A want verb
 * without "already" keeps the group out of the walls. */
const WANT_PATTERN = /\b(crav\w*|love[sd]?|prefer\w*|wants?|wanting|looking for|wish\w*|desire\w*|enjoy\w*|seek\w*|after (?:a|the) )\b/i;

export function isWallWording(texts: string[]): boolean {
  const joined = texts.join(" | ");
  if (!WALL_PATTERN.test(joined) && !WALL_NAMED.test(joined)) return false;
  // A want verb outweighs a stray state word unless the state is explicit.
  if (WANT_PATTERN.test(joined) && !/\balready\b/i.test(joined)) return false;
  return true;
}
