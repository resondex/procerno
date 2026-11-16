import { cell } from "./view_data";
import type { PanelTone } from "./analysis_types";

/**
 * The panel tags (am31, PANEL_BUILD_SPEC section 3, E4) - pure. A tag is a
 * short plain comparison on one step of a panel: against "your usual" (the
 * row's All cell, normal view), against the competitors (rank, comparison
 * view) or against one rival (duel, panel 11). The Map's own verdict words
 * (You hold it, Contested, Theirs, ...) are never tags; TAG_ALLOW is the
 * complete list of shapes the harness accepts.
 */

/** A count over its base. */
export interface KN {
  k: number;
  n: number;
}

const rateOf = (x: KN) => (x.n > 0 ? x.k / x.n : 0);
/** Wilson 95% range of k/n. */
const range = (x: KN) => {
  const c = cell(x.k, x.n);
  return { low: c.low, high: c.high };
};

export const TAG_FURTHEST = "Furthest below your usual";

/** Normal view: this cell's rate p = here.k/here.n against the All cell's q. */
export function usualTag(here: KN, usual: KN): string {
  const p = rateOf(here);
  const q = rateOf(usual);
  if (p === 0 && q === 0) return "None, as usual";
  if (p === 0 && q > 0) return "None here";
  const r = range(here);
  if (q >= r.low && q <= r.high) return "About your usual";
  if (p < q) return q > 0 && p / q <= 0.6 ? "Well below your usual" : "Below your usual";
  return q > 0 && p / q >= 1.6 ? "Well above your usual" : "Above your usual";
}

/** A segmented step: the compared segment, spoken with its noun ("go-aheads",
 * "leave", "worth-it answers", "to rivals"). */
export function segTag(here: KN, usual: KN, noun: string): string {
  const p = rateOf(here);
  const q = rateOf(usual);
  if (p === 0 && q === 0) return "None, as usual";
  if (p === 0 && q > 0) return "None here";
  const r = range(here);
  if (q >= r.low && q <= r.high) return "About your usual";
  if (p < q) return q > 0 && p / q <= 0.6 ? `Far fewer ${noun} than usual` : `Fewer ${noun} than usual`;
  return q > 0 && p / q >= 1.6 ? `Far more ${noun} than usual` : `More ${noun} than usual`;
}

/** Direction of a usual comparison: -1 below (outside the range), 1 above, 0 about / none. */
export function usualDir(here: KN, usual: KN): -1 | 0 | 1 {
  const p = rateOf(here);
  const q = rateOf(usual);
  if (p === q) return 0;
  const r = range(here);
  if (q >= r.low && q <= r.high) return 0;
  return p < q ? -1 : 1;
}

/** Relative gap to the usual (0 = equal, 1 = none here). */
export function usualGap(here: KN, usual: KN): number {
  const p = rateOf(here);
  const q = rateOf(usual);
  if (q === 0) return p > 0 ? 1 : 0;
  return Math.abs(q - p) / q;
}

const ORD = (i: number) => (i === 1 ? "1st" : i === 2 ? "2nd" : i === 3 ? "3rd" : `${i}th`);

/** Comparison view: rank you among you plus the competitors by p, whole points. */
export function rankTag(you: KN, others: KN[]): { tag: string; gap: number } {
  const pts = (x: KN) => Math.round(rateOf(x) * 100);
  const all = [pts(you), ...others.map(pts)];
  const n = all.length;
  const mine = all[0];
  const above = all.filter((x) => x > mine).length;
  const ties = all.filter((x) => x === mine).length;
  const place = above + 1;
  const last = place + ties - 1 === n;
  const head = ties > 1 ? (last ? "Joint last" : `Joint ${ORD(place)}`) : last ? "Last" : ORD(place);
  const spread = Math.max(...all) - Math.min(...all);
  return { tag: `${head} of ${n}${spread <= 5 ? ", all close" : ""}`, gap: Math.max(...all) - mine };
}

/** Panel 11: you against one rival on one step. */
export function duelTag(you: KN, rival: KN, rivalName: string): { tag: string; rivalLeads: boolean } {
  const a = range(you);
  const b = range(rival);
  if (b.low > a.high) return { tag: `${rivalName} leads`, rivalLeads: true };
  if (a.low > b.high) return { tag: `You lead ${rivalName}`, rivalLeads: false };
  return { tag: "Even", rivalLeads: false };
}

export const TAG_GAP_OPENS = "The gap opens here";

/** Against another question type's all-buyers row (popular vs what to buy,
 * learning vs spotting the problem): "Higher than in <name>", "Far lower than
 * in <name>", and inside the range `same` ("About the same as in <name>" /
 * "Close to <name>"). */
export function otherTag(here: KN, other: KN, name: string, same: "about" | "close"): string {
  const p = rateOf(here);
  const q = rateOf(other);
  const r = range(here);
  if ((p === q) || (q >= r.low && q <= r.high)) return same === "about" ? `About the same as in ${name}` : `Close to ${name}`;
  if (p < q) return q > 0 && p / q <= 0.6 ? `Far lower than in ${name}` : `Lower than in ${name}`;
  return q > 0 && p / q >= 1.6 ? `Far higher than in ${name}` : `Higher than in ${name}`;
}

/** A neutral fact against the usual (how often the AI decides at all): no
 * good-or-bad word, since deciding more is not in itself good for you. */
export function neutralUsualTag(here: KN, usual: KN, adj: string): string {
  const d = usualDir(here, usual);
  if (d === 0) return "About the usual";
  return `${d < 0 ? "Less" : "More"} ${adj} than usual`;
}

/** The sentiment of a usual comparison: higher is good when `favourable`. */
export function usualTone(here: KN, usual: KN, favourable = true): PanelTone {
  const p = rateOf(here);
  const q = rateOf(usual);
  if (p === 0 && q === 0) return "neutral";
  const d = p === 0 && q > 0 ? -1 : usualDir(here, usual);
  if (d === 0) return "neutral";
  return (d > 0) === favourable ? "good" : "bad";
}

/** The sentiment of a rank: 1st good, last bad, the middle or all close neutral. */
export function rankTone(tag: string): PanelTone {
  if (/furthest behind/.test(tag)) return "bad";
  if (/all close/.test(tag)) return "neutral";
  if (/^(Joint )?1st\b/.test(tag)) return "good";
  if (/^(Joint )?last\b/i.test(tag)) return "bad";
  return "neutral";
}

/** A tag's sentiment read off its own shape (tags whose direction is not in
 * their words - the segment tags - are toned where they are made). */
export function toneOfTag(t: string): PanelTone {
  if (t === TAG_GAP_OPENS) return "bad";
  if (/^You lead /.test(t)) return "good";
  if (t === "Even" || t === "Same for every brand" || /^About (your|the) usual$/.test(t) || /^None, as usual$/.test(t) || /decided than usual$/.test(t)) return "neutral";
  if (/^(Joint )?(1st|2nd|3rd|\d+th|last) of \d+/i.test(t)) return rankTone(t);
  if (/ leads$/.test(t)) return "bad";
  if (t === TAG_FURTHEST || /below your usual$/i.test(t) || t === "None here") return "bad";
  if (/above your usual$/i.test(t)) return "good";
  return "neutral";
}

/** The sentiment of a duel tag. */
export const duelTone = (tag: string, rivalLeads: boolean): PanelTone =>
  tag === TAG_GAP_OPENS || rivalLeads ? "bad" : tag === "Even" ? "neutral" : "good";

/** Every tag shape a panel may carry (the harness checks against it). */
export const TAG_ALLOW: RegExp[] = [
  /^None, as usual$/,
  /^None here$/,
  /^About your usual$/,
  /^(Well )?(below|above) your usual$/i,
  /^Furthest below your usual$/,
  /^(Far )?(fewer|more) .+ than usual$/i,
  /^(Joint )?(1st|2nd|3rd|\d+th|last) of \d+(, all close)?( · furthest behind)?$/i,
  /^Last of \d+(, all close)?( · furthest behind)?$/,
  /^.+ leads$/,
  /^You lead .+$/,
  /^Even$/,
  /^The gap opens here$/,
  /^(More|Less) decided than usual$/,
  /^About the usual$/,
  /^Same for every brand$/,
  /^(Far (higher|lower)|Higher|Lower) than in .+$/,
  /^About the same as in .+$/,
  /^Close to .+$/,
];

/** The Map's verdict words - never a tag. */
export const TAG_BANNED = /\b(you hold|contested|a rival holds|no side taken|lost|yours|theirs|nearly always|almost always)\b/i;

export const isAllowedTag = (t: string) => TAG_ALLOW.some((re) => re.test(t)) && !TAG_BANNED.test(t);

/** Pick the focus among steps compared with the usual: the below-tagged step
 * with the largest relative gap, else the furthest above. */
export function focusOf<K extends string>(steps: { key: K; here: KN; usual: KN }[]): { key: K; below: boolean } | null {
  let best: { key: K; gap: number; below: boolean } | null = null;
  for (const s of steps) {
    const d = usualDir(s.here, s.usual);
    if (d !== -1) continue;
    const g = usualGap(s.here, s.usual);
    if (!best || g > best.gap) best = { key: s.key, gap: g, below: true };
  }
  if (best) return { key: best.key, below: true };
  for (const s of steps) {
    const d = usualDir(s.here, s.usual);
    if (d !== 1) continue;
    const g = usualGap(s.here, s.usual);
    if (!best || g > best.gap) best = { key: s.key, gap: g, below: false };
  }
  return best ? { key: best.key, below: false } : null;
}
