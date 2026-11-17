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

/** am37: two shares read as "about the same" when the comparison falls inside
 * this share's 95% range OR the two are under CLOSE_PTS points apart - one
 * closeness rule for every tag, direction word and heading (a 1-point gap is
 * never "above", "below", "furthest behind" or "part of why you lose"). */
export const CLOSE_PTS = 3;
export function isClose(here: KN, other: KN): boolean {
  const p = rateOf(here);
  const q = rateOf(other);
  if (Math.abs(p - q) * 100 < CLOSE_PTS) return true;
  const r = range(here);
  return q >= r.low && q <= r.high;
}

/** Normal view: this cell's rate p = here.k/here.n against the All cell's q. */
export function usualTag(here: KN, usual: KN): string {
  const p = rateOf(here);
  const q = rateOf(usual);
  if (p === 0 && q === 0) return "None, as usual";
  if (p === 0 && q > 0 && !isClose(here, usual)) return "None here";
  if (isClose(here, usual)) return "About your usual";
  if (p < q) return q > 0 && p / q <= 0.6 ? "Well below your usual" : "Below your usual";
  return q > 0 && p / q >= 1.6 ? "Well above your usual" : "Above your usual";
}

/** am35, a panel with no usual (switch off): you against the listed
 * competitors taken together, same thresholds as usualTag. */
export const AVG_COMP = "Average competitor";
export function avgTag(here: KN, avg: KN): string {
  const p = rateOf(here);
  const q = rateOf(avg);
  if (p === 0 && q === 0) return "About the average competitor";
  if (isClose(here, avg)) return "About the average competitor";
  if (p === 0 && q > 0) return "Well below the average competitor";
  if (p < q) return q > 0 && p / q <= 0.6 ? "Well below the average competitor" : "Below the average competitor";
  return q > 0 && p / q >= 1.6 ? "Well above the average competitor" : "Above the average competitor";
}

/** A segmented step: the compared segment, spoken with its noun ("go-aheads",
 * "leave", "worth-it answers", "to rivals"). */
export function segTag(here: KN, usual: KN, noun: string): string {
  const p = rateOf(here);
  const q = rateOf(usual);
  // am35: a verdict step names what is missing ("No worth-it answers here"), never a bare "None".
  if (p === 0 && q === 0) return `No ${noun}, as usual`;
  if (p === 0 && q > 0 && !isClose(here, usual)) return `No ${noun} here`;
  if (isClose(here, usual)) return "About your usual";
  if (p < q) return q > 0 && p / q <= 0.6 ? `Far fewer ${noun} than usual` : `Fewer ${noun} than usual`;
  return q > 0 && p / q >= 1.6 ? `Far more ${noun} than usual` : `More ${noun} than usual`;
}

/** Direction of a usual comparison: -1 below (outside the range), 1 above, 0 about / none. */
export function usualDir(here: KN, usual: KN): -1 | 0 | 1 {
  const p = rateOf(here);
  const q = rateOf(usual);
  if (p === q || isClose(here, usual)) return 0;
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
  const spread = Math.max(...all) - Math.min(...all);
  // am37: every brand at the same whole point is "Level", never "Joint last".
  if (spread === 0) return { tag: "Level", gap: 0 };
  const head = ties > 1 ? (last ? "Joint last" : `Joint ${ORD(place)}`) : last ? "Last" : ORD(place);
  return { tag: `${head} of ${n}${spread < CLOSE_PTS ? ", all close" : ""}`, gap: Math.max(...all) - mine };
}

/** Panel 11: you against one rival on one step. */
export function duelTag(you: KN, rival: KN, rivalName: string): { tag: string; rivalLeads: boolean } {
  const a = range(you);
  const b = range(rival);
  if (Math.abs(rateOf(you) - rateOf(rival)) * 100 < CLOSE_PTS) return { tag: "Even", rivalLeads: false };
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
  if (p === q || isClose(here, other)) return same === "about" ? `About the same as in ${name}` : `Close to ${name}`;
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
  if (t === "Even" || t === "Level" || /^Usually picks /.test(t) || t === "Same for every brand" || /^About (your|the) usual$/.test(t) || /^None, as usual$/.test(t) || t === "About the average competitor" || /decided than usual$/.test(t)) return "neutral";
  if (/^(Joint )?(1st|2nd|3rd|\d+th|last) of \d+/i.test(t)) return rankTone(t);
  if (/ leads$/.test(t) || t === "Your named rivals lead") return "bad";
  if (t === TAG_FURTHEST || /below your usual$/i.test(t) || t === "None here") return "bad";
  if (/above your usual$/i.test(t)) return "good";
  if (/below the average competitor$/i.test(t)) return "bad";
  if (/above the average competitor$/i.test(t)) return "good";
  return "neutral";
}

/** The sentiment of a duel tag. */
export const duelTone = (tag: string, rivalLeads: boolean): PanelTone =>
  tag === TAG_GAP_OPENS || rivalLeads ? "bad" : tag === "Even" ? "neutral" : "good";

/** Every tag shape a panel may carry (the harness checks against it). */
export const TAG_ALLOW: RegExp[] = [
  /^None, as usual$/,
  /^None here$/,
  /^No .+ here$/,
  /^No .+, as usual$/,
  /^About your usual$/,
  /^(Well )?(below|above) your usual$/i,
  /^Furthest below your usual$/,
  /^(Well )?(below|above) the average competitor$/i,
  /^About the average competitor$/,
  /^(Far )?(fewer|more) .+ than usual$/i,
  /^(Joint )?(1st|2nd|3rd|\d+th|last) of \d+(, all close)?( · furthest behind)?$/i,
  /^Last of \d+(, all close)?( · furthest behind)?$/,
  /^Level$/,
  /^Usually picks (one of the two|neither)$/,
  /^.+ leads$/,
  /^Your named rivals lead$/,
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

export const isAllowedTag = (t: string) => (TAG_ALLOW.some((re) => re.test(t)) || TAKEAWAY_TAGS.includes(t)) && !TAG_BANNED.test(t);

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

/* ---------------- am36: the verdict panels' one-line takeaways ----------------
 * On the verdict panels (Value, both worry panels, looking around, the four
 * making-your-case kinds, what to use alongside you, what to look for) each
 * step's tag says what the step means for the reader, read off THIS cell's
 * own numbers - never a comparison with the usual (that comparison is the
 * small "usual X%" figure beside each bar, and the explanation below says it
 * in words). The same tag is drawn in both views. Thresholds, all on shares
 * of the step's own base (0-100):
 *   MAJORITY  a side said in at least half the answers is the takeaway
 *             ("Tells buyers to go ahead", "Not worth it for this buyer").
 *   LEAN      no majority: the larger of the two sides that take a position
 *             leads when it is at least 1.5 times the smaller AND at least 5
 *             points ahead, or at least 8 points ahead whatever the ratio
 *             ("Leans go ahead", "More told to leave than to stay").
 *   ALWAYS    a "Mostly ..." side said in every answer reads "Always ...".
 *   SPLIT     two sides at half each read "Split".
 *   NO SIDE   on keep-or-leave steps, "no side" at 70% or more is the
 *             takeaway before any lean is read ("Mostly takes no side").
 *   otherwise "No clear answer" (or "... about even").
 * Step-specific cut-offs: agreeing the worry is fair - 60 mostly, 35 often,
 * 15 sometimes, below that rarely; a buyers' worry no-side majority with
 * agreement at 50%+ reads "Agrees, then leaves it to the buyer"; looking
 * around's "shows another option" - 50 most answers, 20 some, below rarely;
 * a business case arguing against you in 20%+ (no majority) reads "Often
 * argues against you"; alongside, naming one to replace you in 25%+ reads
 * "Often names one to replace you". Tones: good / bad / neutral for you. */

export interface Takeaway {
  tag: string;
  tone: PanelTone;
}
const MAJORITY = 50;
const LEAN_RATIO = 1.5;
const LEAN_PTS = 5;
/** am37: a gap this many points wide leads whatever the ratio (25 vs 34 and
 * 14 vs 23 read the same way; 32 vs 24 leans too). */
const LEAN_GAP = 8;
const NO_SIDE_FIRST = 70;
/** 1 when a leads b, -1 when b leads a, 0 when neither leads (LEAN rule). */
export function leanOf(a: number, b: number): 1 | -1 | 0 {
  if ((a >= b * LEAN_RATIO && a - b >= LEAN_PTS) || a - b >= LEAN_GAP) return 1;
  if ((b >= a * LEAN_RATIO && b - a >= LEAN_PTS) || b - a >= LEAN_GAP) return -1;
  return 0;
}
/** am37: "Mostly ..." said of every answer (100%) reads "Always ...". */
const ALWAYS: Record<string, string> = { "Mostly it depends": "It always depends" };
function tk(tag: string, tone: PanelTone, share?: number): Takeaway {
  if (share !== undefined && share >= 99.95 && /^Mostly /.test(tag)) return { tag: ALWAYS[tag] ?? tag.replace(/^Mostly /, "Always "), tone };
  return { tag, tone };
}
/** am37: two sides at exactly half each are "Split", never "Mostly" one of them. */
const SPLIT: Takeaway = { tag: "Split", tone: "neutral" };
const isSplit = (...xs: number[]) => {
  const s = [...xs].sort((a, b) => b - a);
  return s.length >= 2 && s[0] >= MAJORITY - 1 && Math.abs(s[0] - s[1]) < 1;
};

/** Value, "Is it worth paying more for?" (yes / depends / no, of all answers). */
export function worthTakeaway(yes: number, depends: number, no: number, pooled: boolean): Takeaway {
  const who = pooled ? "most buyers" : "this buyer";
  if (isSplit(yes, depends, no)) return SPLIT;
  if (no >= MAJORITY) return tk(no >= 99.95 ? `Never worth it for ${who}` : `Not worth it for ${who}`, "bad");
  if (yes >= MAJORITY) return tk(yes >= 99.95 ? `Always worth it for ${who}` : `Worth it for ${who}`, "good");
  if (depends >= MAJORITY) return tk("Mostly it depends", "neutral", depends);
  const l = leanOf(yes, no);
  if (l > 0) return tk("Leans worth it", "good");
  if (l < 0) return tk("Leans not worth it", "bad");
  return tk("No clear answer", "neutral");
}

/** Value, "Where it points the buyer instead" (own cheaper / a rival's / nowhere, of all answers). */
/** Share of answers naming no cheaper option from which "mostly" is fair. */
export const NOWHERE_CLEAR = 60;

export function insteadTakeaway(own: number, rival: number, nowhere: number): Takeaway {
  if (isSplit(own, rival, nowhere)) return SPLIT;
  if (rival >= MAJORITY) return tk("Mostly points to a rival", "bad", rival);
  if (own >= MAJORITY) return tk("Mostly points to your own cheaper option", "neutral", own);
  // am39: "mostly" needs a clear majority here - at about half, with the rest naming an option, the tag says half.
  if (nowhere >= NOWHERE_CLEAR) return tk("Mostly names no cheaper option", "neutral", nowhere);
  if (nowhere >= MAJORITY) return tk("Names a cheaper option about half the time", rival > own ? "bad" : "neutral");
  const l = leanOf(rival, own);
  if (l > 0) return tk("More to rivals than to your own", "bad");
  if (l < 0) return tk("More to your own than to rivals", "neutral");
  return tk("Rivals and your own about even", "neutral");
}

/** Both worry panels, "Agrees the worry is fair" (of the answers that judge it). */
export function agreesTakeaway(agrees: number): Takeaway {
  if (agrees >= 60) return tk("Mostly agrees the worry is fair", "bad", agrees);
  if (agrees >= 35) return tk("Often agrees the worry is fair", "bad");
  if (agrees >= 15) return tk("Sometimes agrees the worry is fair", "neutral");
  if (agrees <= 0.05) return tk("Never agrees the worry is fair", "good");
  return tk("Rarely agrees the worry is fair", "good");
}

/** Buyers' worry, "What it tells the buyer to do" (go ahead / steer clear / no side). */
export function proceedTakeaway(go: number, avoid: number, none: number, agrees: number | null): Takeaway {
  if (isSplit(go, avoid, none)) return SPLIT;
  if (go >= MAJORITY) return tk("Tells buyers to go ahead", "good");
  if (avoid >= MAJORITY) return tk("Tells buyers to steer clear", "bad");
  if (none >= MAJORITY) return agrees !== null && agrees >= MAJORITY ? tk("Agrees, then leaves it to the buyer", "bad") : tk("Mostly leaves it to the buyer", "neutral", none);
  const l = leanOf(go, avoid);
  if (l > 0) return tk("Leans go ahead", "good");
  if (l < 0) return tk("Leans steer clear", "bad");
  return tk("No clear answer", "neutral");
}

/** Customers' worry and looking around, "What it tells the customer to do" (stay / leave / no side). */
export function keepTakeaway(keep: number, leave: number, none: number): Takeaway {
  if (isSplit(keep, leave, none)) return SPLIT;
  if (keep >= MAJORITY) return tk("Tells customers to stay", "good");
  if (leave >= MAJORITY) return tk("Tells customers to leave", "bad");
  if (none >= NO_SIDE_FIRST) return tk("Mostly takes no side", "neutral", none);
  const l = leanOf(leave, keep);
  if (l > 0) return tk("More told to leave than to stay", "bad");
  if (l < 0) return tk("More told to stay than to leave", "good");
  if (none >= MAJORITY) return tk("Mostly takes no side", "neutral", none);
  return tk("Stay and leave about even", "neutral");
}

/** Looking around, "Shows another option" (of all answers). The customer asked for alternatives, so showing them is not in itself bad. */
export function offersTakeaway(offers: number): Takeaway {
  if (offers >= 99.95) return tk("Shows another option in every answer", "neutral");
  if (offers >= MAJORITY) return tk("Shows another option in most answers", "neutral");
  if (offers >= 20) return tk("Shows another option in some answers", "neutral");
  return tk("Rarely shows another option", "good");
}

/** Expansion, "Does the answer back it?" (backs / neither / points elsewhere). */
export function stanceTakeaway(backs: number, neither: number, redirects: number): Takeaway {
  if (isSplit(backs, neither, redirects)) return SPLIT;
  if (backs >= MAJORITY) return tk("Mostly backs their plan", "good", backs);
  if (redirects >= MAJORITY) return tk("Mostly points them elsewhere", "bad", redirects);
  if (neither >= MAJORITY) return tk("Mostly leaves it to the customer", "neutral", neither);
  const l = leanOf(backs, redirects);
  if (l > 0) return tk("Leans backing their plan", "good");
  if (l < 0) return tk("Leans pointing them elsewhere", "bad");
  return tk("No clear answer", "neutral");
}

/** Business case, "How strong a case..." (confident / hedged / against you). */
export function caseTakeaway(strong: number, hedged: number, against: number): Takeaway {
  if (isSplit(strong, hedged, against)) return SPLIT;
  if (against >= MAJORITY) return tk("Mostly argues against you", "bad", against);
  if (strong >= MAJORITY) return tk("Mostly a confident case", "good", strong);
  if (hedged >= MAJORITY) return tk("Mostly a hedged case", "neutral", hedged);
  if (against >= 20) return tk("Often argues against you", "bad");
  const l = leanOf(strong, hedged);
  if (l > 0) return tk("Leans confident", "good");
  if (l < 0) return tk("Leans hedged", "neutral");
  return tk("Confident and hedged about even", "neutral");
}

/** Answering a critic, "How strong an answer..." (strong / partial / drops your side). */
export function criticStrengthTakeaway(strong: number, partial: number, concedes: number): Takeaway {
  if (isSplit(strong, partial, concedes)) return SPLIT;
  if (concedes >= MAJORITY) return tk("Mostly drops your side", "bad", concedes);
  if (strong >= MAJORITY) return tk("Mostly a strong answer", "good", strong);
  if (partial >= MAJORITY) return tk("Mostly a partial answer", "neutral", partial);
  const l = leanOf(strong, partial);
  if (l > 0) return tk("Leans strong", "good");
  if (l < 0) return tk("Leans partial", "neutral");
  return tk("Strong and partial about even", "neutral");
}

/** Answering a critic, "Does it say the critic is right?" (wrong / partly / right, of the answers that judge it). */
export function premiseTakeaway(rebuts: number, mixed: number, confirms: number): Takeaway {
  if (isSplit(rebuts, mixed, confirms)) return SPLIT;
  if (rebuts >= MAJORITY) return tk("Mostly says the critic is wrong", "good", rebuts);
  if (confirms >= MAJORITY) return tk("Mostly says the critic is right", "bad", confirms);
  if (mixed >= MAJORITY) return tk("Mostly says the critic is partly right", "neutral", mixed);
  const l = leanOf(rebuts, confirms);
  if (l > 0) return tk("Sides against the critic more often", "good");
  if (l < 0) return tk("Sides with the critic more often", "bad");
  return tk("No clear answer", "neutral");
}

/** What to use alongside you (own / another company's / one to replace you, of all answers; not exclusive). */
export function alongsideTakeaway(own: number, third: number, substitute: number): Takeaway {
  if (substitute >= 25) return tk("Often names one to replace you", "bad");
  // am37: both kinds can pass half (an answer names several) - the larger one leads, so the tag never contradicts the note.
  if (own >= MAJORITY && own > third) return tk("Mostly names your own", "good", own);
  if (third >= MAJORITY && third > own) return tk("Mostly names another company's", "neutral", third);
  return tk("A mix of your own and others'", "neutral");
}

/** am59, Premium vs basic: "Which end it sides with" (premium / basic / balanced, of all answers; "none" counts as
 * balanced). The tracked brand sits at the premium end, so premium reads good for you and basic bad. */
export function tierTakeaway(premium: number, basic: number, balanced: number): Takeaway {
  if (isSplit(premium, basic, balanced)) return SPLIT;
  if (basic >= MAJORITY) return tk("Mostly sides with basic", "bad", basic);
  if (premium >= MAJORITY) return tk("Mostly sides with premium", "good", premium);
  if (balanced >= MAJORITY) return tk("Mostly balanced", "neutral", balanced);
  const l = leanOf(premium, basic);
  if (l > 0) return tk("Leans premium", "good");
  if (l < 0) return tk("Leans basic", "bad");
  return tk("No clear side", "neutral");
}

/** am60, Habit: "Stick with you, or try something else" (sticks with you / picks another brand / says it depends /
 * names no pick, of all answers). */
export function habitTakeaway(stick: number, other: number, depends: number, nopick: number): Takeaway {
  if (isSplit(stick, other, depends, nopick)) return SPLIT;
  if (stick >= MAJORITY) return tk("Mostly sticks with you", "good", stick);
  if (other >= MAJORITY) return tk("Mostly says try something else", "bad", other);
  if (depends >= MAJORITY) return tk("Mostly says it depends", "neutral", depends);
  if (nopick >= MAJORITY) return tk("Mostly names no pick", "neutral", nopick);
  const l = leanOf(stick, other);
  if (l > 0) return tk("Leans stick", "good");
  if (l < 0) return tk("Leans switch", "bad");
  return tk("No clear side", "neutral");
}
/** am60, Habit: "Suggests another brand" (of all answers). The customer asked whether to try something else, so suggesting one is not in itself bad. */
export function suggestTakeaway(share: number): Takeaway {
  if (share >= 99.95) return tk("Suggests another brand in every answer", "neutral");
  if (share >= MAJORITY) return tk("Suggests another brand in most answers", "neutral");
  if (share >= 20) return tk("Suggests another brand in some answers", "neutral");
  return tk("Rarely suggests another brand", "good");
}

/** am61, the settled customers' All questions card: "What the answer does for the relationship" (strengthens /
 * neutral / weakens, of all the pooled answers). */
export function relationshipTakeaway(strengthens: number, neutral: number, weakens: number): Takeaway {
  if (isSplit(strengthens, neutral, weakens)) return SPLIT;
  if (strengthens >= MAJORITY) return tk("Mostly strengthens it", "good", strengthens);
  if (weakens >= MAJORITY) return tk("Mostly weakens it", "bad", weakens);
  if (neutral >= MAJORITY) return tk("Mostly neutral", "neutral", neutral);
  const l = leanOf(strengthens, weakens);
  if (l > 0) return tk("Leans strengthens", "good");
  if (l < 0) return tk("Leans weakens", "bad");
  return tk("No clear side", "neutral");
}

/** What to look for: the checklist step, and the gap step when it is drawn. */
export const taughtTakeaway = (gap: boolean): Takeaway => (gap ? tk("Misses your strongest points", "bad") : tk("Covers your strongest points", "good"));
export const GAP_TAKEAWAY: Takeaway = tk("Not on the checklist", "bad");

const BASE_TAKEAWAYS: string[] = [
  "The exception",
  "Not worth it for most buyers", "Not worth it for this buyer", "Worth it for most buyers", "Worth it for this buyer", "Never worth it for most buyers", "Never worth it for this buyer", "Always worth it for most buyers", "Always worth it for this buyer", "Mostly it depends", "Leans worth it", "Leans not worth it", "No clear answer",
  "Mostly points to a rival", "Mostly points to your own cheaper option", "Mostly names no cheaper option", "Names a cheaper option about half the time", "More to rivals than to your own", "More to your own than to rivals", "Rivals and your own about even",
  "Mostly agrees the worry is fair", "Often agrees the worry is fair", "Sometimes agrees the worry is fair", "Rarely agrees the worry is fair", "Never agrees the worry is fair",
  "Tells buyers to go ahead", "Tells buyers to steer clear", "Agrees, then leaves it to the buyer", "Mostly leaves it to the buyer", "Leans go ahead", "Leans steer clear",
  "Tells customers to stay", "Tells customers to leave", "Mostly takes no side", "More told to leave than to stay", "More told to stay than to leave", "Stay and leave about even",
  "Shows another option in every answer", "Shows another option in most answers", "Shows another option in some answers", "Rarely shows another option",
  "Mostly backs their plan", "Mostly points them elsewhere", "Mostly leaves it to the customer", "Leans backing their plan", "Leans pointing them elsewhere",
  "Mostly argues against you", "Mostly a confident case", "Mostly a hedged case", "Often argues against you", "Leans confident", "Leans hedged", "Confident and hedged about even",
  "Mostly drops your side", "Mostly a strong answer", "Mostly a partial answer", "Leans strong", "Leans partial", "Strong and partial about even",
  "Mostly says the critic is wrong", "Mostly says the critic is right", "Mostly says the critic is partly right", "Sides against the critic more often", "Sides with the critic more often",
  "Often names one to replace you", "Mostly names your own", "Mostly names another company's", "A mix of your own and others'",
  "Misses your strongest points", "Covers your strongest points", "Not on the checklist",
  "Mostly sides with basic", "Mostly sides with premium", "Mostly balanced", "Leans premium", "Leans basic", "No clear side",
  "Mostly strengthens it", "Mostly weakens it", "Mostly neutral", "Leans strengthens", "Leans weakens",
  "Mostly sticks with you", "Mostly says try something else", "Mostly says it depends", "Mostly names no pick", "Leans stick", "Leans switch",
  "Suggests another brand in every answer", "Suggests another brand in most answers", "Suggests another brand in some answers", "Rarely suggests another brand",
  "Split",
];
/** Every takeaway tag (TAG_ALLOW reads it), with each "Mostly" tag's "Always" form. */
export const TAKEAWAY_TAGS: string[] = [...BASE_TAKEAWAYS, ...BASE_TAKEAWAYS.filter((t) => /^Mostly /.test(t)).map((t) => ALWAYS[t] ?? t.replace(/^Mostly /, "Always "))];

/** A comparison with the usual, in words: how a share here sits against the
 * same share across the row (same range rule and 0.6 / 1.6 ratios as segTag). */
export type OftenWord = "far more" | "more" | "about as" | "less" | "far less";
export function oftenOf(here: KN, usual: KN): OftenWord {
  const p = rateOf(here);
  const q = rateOf(usual);
  const d = p === 0 && q > 0 ? -1 : usualDir(here, usual);
  if (d === 0) return "about as";
  if (d < 0) return q > 0 && p / q <= 0.6 ? "far less" : "less";
  return q > 0 && p / q >= 1.6 ? "far more" : "more";
}
