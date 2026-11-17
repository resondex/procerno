/**
 * bf29: the retired customer-vocabulary words - the one list the map harness's plain-wording scan and the
 * written Brief's guard both read (scripts/analysis_map_harness.mts, brief_writer.ts). Words only: a phrase a
 * view quotes from the data (a condition, a theme, a code) is stripped before the scan by its caller.
 */
export const PLAIN_BANNED: [string, RegExp][] = [
  ["wall", /\bwalls?\b/i],
  ["routes", /\brout(e|es|ed|ing)\b/i],
  ["leavers", /\bleavers?\b/i],
  ["reason", /\breasons?\b/i],
  ["travels with", /\btravels? with\b/i],
  ["closest contest", /\bclosest contest\b/i],
];

/** The method words a reader never sees on top of PLAIN_BANNED (the finding cards' bars and the written Brief). */
export const METHOD_BANNED: [string, RegExp][] = [
  ["open-choice", /\bopen[- ]choice\b/i],
  ["cell", /\bcells?\b/i],
  ["pooled", /\bpooled\b/i],
  ["settlement", /\bsettlements?\b/i],
  ["decided", /\bdecided\b/i],
  ["lift", /\blifts?\b/i],
];
