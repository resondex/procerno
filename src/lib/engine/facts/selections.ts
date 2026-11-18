/**
 * Layer 3 of the fact layer (FACT_LAYER_DESIGN_2026-11-17.md): SELECTIONS - every list the product shows, as a
 * named list with ONE rule. A selection has an id built from (selection name, subject, scope) and depends on no
 * screen; its members are fact subjects (brand entry ids, argument codes, condition units) in order. A screen shows
 * a selection; it never rebuilds one.
 *
 *   selectionBook(set, book, data).selection("competitors", "you", WHAT_TO_BUY_ALL)
 *     -> { id, name, rule, members: [...], extras }
 *
 * Built beside the existing code: nothing on screen reads it yet. Where today's cards use a different rule from the
 * ratified one, today's rule is a named MODE ("as_cards") so the proof can show it reproduces the cards exactly, and
 * the ratified rule is the default. Every mode states its rule in one plain sentence (`rule`).
 *
 * The selections:
 *  - competitors        the competitor group on a card (ratified 2026-11-17; mode "as_cards" = today's per-card rules)
 *  - takers             "Who takes the picks" on the What to buy and switching cards
 *  - takers_after_rec   who takes the pick when the AI recommends you and picks another brand (the step explanation)
 *  - leader             the leader in one buying situation, and its tie-break
 *  - checklist          the AI's "what to look for" list
 *  - conditions_shown   the condition rows a card lists on one side, in order
 *  - weighs_shown       the topics a "What the answer weighs" column lists
 *  - visibility_brands  the brands on the visibility chart, and the ones folded into its note
 *  - sent_brands / instead_brands   the brands a worry or looking-around answer sends the buyer to; the rivals a price
 *                       answer recommends instead (the doubt cards' competitor lists - nothing is picked there)
 *  - first_sent         who an answer shows first among the brands it sends the buyer to
 *  - sent_products / sent_own_products / instead_products / own_options   the products named as where to go, the
 *                       tracker's own products named there, the rival products recommended instead of a price line, the
 *                       tracker's own cheaper options (the run's one product grouping, ruling 15)
 *  - worries / price_lines   the worries a scope holds; the price lines its answers were asked about
 *  - price_worries      the worries about the price (their wording names money), in the cards' order
 *  - converts_better    the brands whose recommendations end as the pick more often than the subject's
 * plus two functions that are rules over a selection's members, stated once:
 *  - averageCompetitor  the average competitor of a competitor group, per measure (modes "as_cards" / "ruled")
 *  - productGroups      written product names grouped into rows, in the three ways the cards do it today (modes)
 *
 * Pure: reads AnswerFact records (and, for the two lists the cards filter by the question's own wording, the
 * question wordings from ViewData). No model calls.
 */
import { famTokens } from "../brand_family";
import { isDefaultCondition } from "../condition_groups";
import { filterObvious, wordingIndex, type OmissionList } from "../panel_filter";
import { condRowLabel, pluralNoun, productNoun } from "../panel_text";
import type { ViewData } from "../view_data";
import type { AnswerFact, AnswerFactSet, QuestionType } from "./answer_facts";
import { scopeKey, WHAT_TO_BUY_ALL, type FactBook, type Scope } from "./fact";
import { MEASURE_BY_ID, PICK_TYPES } from "./measure_book";
import { cleanQuote, endItems, firstProductOf, pairingCounts, pairingProduct, firstSentOf, insteadProductsOf, ownOptionProductsOf, productsOf, sentProductsOf, slicePred } from "./slices";

/* ------------------------------- the shape ------------------------------- */

export interface Selection<M = SelMember, X = Record<string, unknown>> {
  id: string;
  /** The selection's name with its mode and parameters ("competitors~as_cards:buy"). */
  name: string;
  subject: string;
  scope: Scope;
  /** The one rule, as one plain sentence. */
  rule: string;
  members: M[];
  extras: X;
}

/** A brand member: its entry id, display name, and the counts the rule ranked it by. */
export interface SelMember {
  key: string;
  name: string;
  /** What the rule ranked by (picks, recommendations, answers naming it, ...). */
  count: number;
  /** Ratified competitor group: a head-to-head rival listed beyond the top three by picks. */
  headToHead?: true;
}

/** The id: the name (with its mode and parameters), the subject, the scope. Never a screen. */
export function selectionId(name: string, subject: string, scope: Scope): string {
  return `sel:${name}|${subject}|${scopeKey(scope)}`;
}

/* ------------------------------- floors ------------------------------- */

/** The floors the selections use - today's card values (panel_build.ts), each named once. */
export const SEL_FLOORS = {
  /** A brand is listed among a pick card's competitors with this many picks (BRAND_FLOOR). */
  brandFloor: 5,
  /** A drawn row (ROW_MIN). */
  rowMin: 3,
  /** Competitors listed today (COMP_TOP). */
  compTop: 5,
  /** Ratified group: rivals by picks before the head-to-head rivals. */
  ratifiedTop: 3,
  /** Ratified "Other": a brand is shown by name when named in this share of the scope's answers ... */
  otherNamedShare: 0.1,
  /** ... or picked this many times. */
  otherPicks: 5,
  /** Condition rows a card lists per side (COND_ROWS). */
  condRows: 6,
  /** A side of "What the answer weighs" needs this many answers carrying arguments (ARGS_MIN). */
  argsMin: 10,
  /** A topic belongs to a weighs column only when its share there is this far above the other side's (WEIGHS_GAP). */
  weighsGap: 0.05,
  /** The checklist: the topics raised most, after the too-obvious rule. */
  checklistTop: 5,
  /** Visibility chart: a brand registers when named in this share of answers ... */
  visNamed: 0.1,
  /** ... or holds this share of the picks; */
  visShare: 0.01,
  /** it is placed when recommended in this many answers (MIN) ... */
  visReadableRec: 20,
  /** ... unless it is small: under this share of the picks AND under this named rate. */
  visSmallShare: 0.02,
  visSmallNamed: 0.3,
} as const;

/** A worry about the price: its wording names money (generic words, never a category's) - the Brief's "about price". */
export const PRICE_WORRY = /\b(fees?|prices?|pricey|pricing|costs?|costly|expensive|pay|paying|money|afford(?:able)?|overpriced|cheap(?:er)?|budget|subscription)\b/i;
export const PRICE_WORRY_RULE =
  "The worries whose wording names money (fee, price, pricey, pricing, cost, costly, expensive, pay, paying, money, afford, affordable, overpriced, cheap, cheaper, budget, subscription), in the worries cards' order: buyers' worries, then customers' worries, then the renewal; then most answers first; then by wording.";
const WORRY_STAGES: readonly string[] = ["objections", "churn_triggers", "renewal"];

/* ------------------------------- helpers ------------------------------- */

type Fact = AnswerFact;

/** Ranked list from a per-brand answer count: most first, ties by name (the cards' order). */
function rank(by: Map<string, { name: string; ids: Set<string> }>): SelMember[] {
  return [...by.entries()].map(([key, x]) => ({ key, name: x.name, count: x.ids.size })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function tally(rows: Fact[], keysOf: (f: Fact) => { key: string; name: string }[]): Map<string, { name: string; ids: Set<string> }> {
  const by = new Map<string, { name: string; ids: Set<string> }>();
  for (const f of rows)
    for (const b of keysOf(f)) {
      const t = by.get(b.key) ?? { name: b.name, ids: new Set<string>() };
      t.ids.add(f.responseId);
      by.set(b.key, t);
    }
  return by;
}

/** Brands the tracker asks about as a class ("a <brand> card"): never a competitor. */
export function classKeysOf(set: AnswerFactSet): Set<string> {
  return new Set(set.facts.filter((f) => f.type === "comparison_class" && f.rival && !f.rival.key.startsWith("?")).map((f) => f.rival!.key));
}

/** The tracker's own head-to-head rivals: its named head-to-head cells' rivals, resolved through the dictionary
 * (an unplaced rival is never a member). In first-asked order. */
export function headToHeadKeysOf(set: AnswerFactSet): { key: string; name: string }[] {
  const out = new Map<string, string>();
  for (const f of set.facts) if (f.type === "comparison_entity" && f.rival && !f.rival.key.startsWith("?") && set.bucketOf(f.rival.key) === "in_analysis") out.set(f.rival.key, f.rival.name);
  return [...out.entries()].map(([key, name]) => ({ key, name }));
}

/** An answer's pick when it is an active brand (in analysis or outside of analysis - today's cards' brandSplit). */
const activePick = (f: Fact) => (f.pick.state === "in_analysis" || f.pick.state === "outside_analysis") && !!f.pick.key;

/** The active brands an answer sends the buyer to (destinations), in or outside of analysis, never the tracker. */
function activeDests(f: Fact, set: AnswerFactSet): { key: string; name: string }[] {
  if (!f.sent) return [];
  const out = new Map<string, string>(f.sent.brands.map((b) => [b.key, b.name]));
  for (const w of f.sent.outside) {
    const r = set.resolve(w);
    if (r.status === "active" && r.key !== set.target.key && !out.has(r.key)) out.set(r.key, r.name);
  }
  return [...out.entries()].map(([key, name]) => ({ key, name }));
}

/* ------------------------------- competitors ------------------------------- */

/** The card kinds whose competitor group "as_cards" reproduces (panel_build.ts). */
export type CompetitorCard = "buy" | "switching" | "problem" | "popular" | "premium" | "learning" | "worry" | "value";

const AS_CARDS_RULE: Record<CompetitorCard, string> = {
  buy: "The five brands with the most picks of an active brand (5 picks at least), the tracker and class brands left out; most picks first, ties by name.",
  switching: "The five brands with the most picks of an active brand (5 picks at least), the tracker, class brands and the brand being left left out; most picks first, ties by name.",
  problem: "The five brands most often framed as recommended in the text (5 answers at least), the tracker and class brands left out; most first, ties by name.",
  popular: "The five brands in analysis most often recommended or picked (5 answers at least), the tracker and class brands left out; most first, ties by name.",
  premium: "The five brands in analysis most often recommended or picked (5 answers at least), the tracker and class brands left out; most first, ties by name.",
  learning: "The five brands in analysis most often named or picked (3 answers at least), the tracker and class brands left out; most first, ties by name.",
  worry: "The five active brands most often named as where to go (3 answers at least), the tracker left out; most first, ties by name.",
  value: "The five brands in analysis most often recommended instead on a price question (3 answers at least), the tracker left out; most first, ties by name.",
};

export const RATIFIED_COMPETITORS_RULE =
  "The three rivals with the most picks of a brand in analysis, then the tracker's head-to-head rivals not among them (tagged head-to-head); class brands stay out; listed rivals keep picks order. Other: every remaining brand in analysis - by name when named in at least 10% of the answers or picked at least 5 times, the rest as a count.";
export const RATIFIED_COMPETITORS_REC_RULE =
  "The ratified shape ranked by recommendations (cards that take few picks): the three rivals recommended in the most answers (a pick counts as recommended), then the tracker's head-to-head rivals not among them (tagged head-to-head); class brands stay out; listed rivals keep that order. Other: every remaining brand in analysis - by name when named in at least 10% of the answers or picked at least 5 times, the rest as a count.";

export const RATIFIED_COMPETITORS_NAMED_RULE =
  "The ratified shape ranked by answers naming the brand (a card that takes no picks): the three rivals named in the most answers (the card's own floor), then the tracker's head-to-head rivals not among them (tagged head-to-head); class brands stay out; listed rivals keep that order. Other: every remaining brand in analysis - by name when named in at least 10% of the answers, the rest as a count.";

export interface CompetitorExtras {
  mode: "ratified" | "as_cards";
  card?: CompetitorCard;
  /** Ratified only. */
  other?: {
    /** Picks of every remaining brand in analysis: listed + you + other = every pick of a brand in analysis. */
    picks: number;
    /** On named / recommended blocks the Other row has no total (no bar). */
    shown: { key: string; name: string; picks: number; named: number }[];
    rest: number;
  };
  /** Ratified only: every pick of a brand in analysis in the scope (the identity's total). */
  totalPicks?: number;
  youPicks?: number;
}

function competitorsAsCards(set: AnswerFactSet, rows: Fact[], scope: Scope, card: CompetitorCard): SelMember[] {
  const T = set.target.key;
  const cls = classKeysOf(set);
  const F = SEL_FLOORS;
  let list: SelMember[];
  let floor: number = F.brandFloor;
  let dropClass = true;
  switch (card) {
    case "buy":
    case "switching":
      list = rank(tally(rows.filter(activePick), (f) => [{ key: f.pick.key!, name: f.pick.name! }]));
      break;
    case "problem":
      list = rank(tally(rows, (f) => f.brands.filter((b) => b.framedRecommended && b.bucket !== "outside_category").map((b) => ({ key: b.key, name: b.name }))));
      break;
    case "popular":
    case "premium":
      list = rank(tally(rows, (f) => f.brands.filter((b) => b.recommended && b.bucket === "in_analysis").map((b) => ({ key: b.key, name: b.name }))));
      break;
    case "learning":
      list = rank(tally(rows, (f) => f.brands.filter((b) => b.bucket === "in_analysis").map((b) => ({ key: b.key, name: b.name }))));
      floor = F.rowMin;
      break;
    case "worry":
      list = rank(tally(rows, (f) => activeDests(f, set)));
      floor = F.rowMin;
      dropClass = false;
      break;
    case "value":
      list = rank(tally(rows, (f) => f.price?.rivals ?? []));
      floor = F.rowMin;
      dropClass = false;
      break;
  }
  const leaving = card === "switching" ? scope.rival : undefined;
  return list.filter((b) => b.key !== T && b.count >= floor && !(dropClass && cls.has(b.key)) && b.key !== leaving).slice(0, F.compTop);
}

function competitorsRatified(set: AnswerFactSet, rows: Fact[], scope: Scope, rankBy: "picks" | "recommended" | "named" = "picks", floor = 0): { members: SelMember[]; extras: CompetitorExtras } {
  if (rankBy === "picks") for (const t of scope.types) if (!PICK_TYPES.includes(t)) throw new Error(`selection "competitors" (ratified): ranks by picks, and question type "${t}" takes no picks - refused (use mode "as_cards" for today's card)`);
  const T = set.target.key;
  const cls = classKeysOf(set);
  const inPick = rows.filter((f) => f.pick.state === "in_analysis");
  const picks = new Map<string, number>();
  for (const f of inPick) picks.set(f.pick.key!, (picks.get(f.pick.key!) ?? 0) + 1);
  const named = new Map<string, number>();
  const recs = new Map<string, number>();
  const names = new Map<string, string>();
  for (const f of rows)
    for (const b of f.brands)
      if (b.bucket === "in_analysis") {
        named.set(b.key, (named.get(b.key) ?? 0) + 1);
        if (b.recommended) recs.set(b.key, (recs.get(b.key) ?? 0) + 1);
        names.set(b.key, b.name);
      }
  const pk = (k: string) => picks.get(k) ?? 0;
  // The ranking measure: picks (the pick cards), or recommendations (What's popular and Premium vs basic, which take
  // few picks) - the card's own measure, the ratified shape either way.
  const rk = (k: string) => (rankBy === "recommended" ? recs.get(k) ?? 0 : rankBy === "named" ? named.get(k) ?? 0 : pk(k));
  const byRank = (a: { key: string; name: string }, b: { key: string; name: string }) => rk(b.key) - rk(a.key) || a.name.localeCompare(b.name);
  // A rival being left (a switching cell) is the question's own brand, never one of its competitors.
  const leaving = scope.types.length === 1 && scope.types[0] === "switching" ? scope.rival : undefined;
  // The card's own floor (Spotting the problem: 5 recommendations; Learning the category: 3 answers naming it) holds
  // for the top three; the head-to-head rivals are listed whatever their count (the ratified shape).
  const rivals = [...names.entries()].map(([key, name]) => ({ key, name })).filter((b) => b.key !== T && !cls.has(b.key) && b.key !== leaving && rk(b.key) > 0 && rk(b.key) >= floor);
  const top = rivals.sort(byRank).slice(0, SEL_FLOORS.ratifiedTop);
  const listed: SelMember[] = top.map((b) => ({ key: b.key, name: b.name, count: rk(b.key) }));
  const h2h = headToHeadKeysOf(set)
    .filter((b) => !listed.some((x) => x.key === b.key) && b.key !== leaving && !cls.has(b.key))
    .map((b) => ({ key: b.key, name: names.get(b.key) ?? set.nameOf(b.key) }))
    .sort(byRank);
  for (const b of h2h) listed.push({ key: b.key, name: b.name, count: rk(b.key), headToHead: true });
  const inListed = new Set(listed.map((b) => b.key));
  const others = [...names.keys()].filter((k) => k !== T && !inListed.has(k));
  for (const k of picks.keys()) if (k !== T && !inListed.has(k) && !others.includes(k)) others.push(k);
  const n = rows.length;
  const shown = others
    .filter((k) => (named.get(k) ?? 0) >= SEL_FLOORS.otherNamedShare * n || pk(k) >= SEL_FLOORS.otherPicks)
    .map((k) => ({ key: k, name: names.get(k) ?? set.nameOf(k), picks: pk(k), named: named.get(k) ?? 0 }))
    .sort((a, b) => b.picks - a.picks || a.name.localeCompare(b.name));
  return {
    members: listed,
    extras: {
      mode: "ratified",
      other: { picks: others.reduce((a, k) => a + pk(k), 0), shown, rest: others.length - shown.length },
      totalPicks: inPick.length,
      youPicks: pk(T),
    },
  };
}

/* ------------------------------- average competitor ------------------------------- */

/**
 * The average competitor, stated once: the listed competitors only (never a brand under Other), and for every
 * measure their numerators added up over their bases added up.
 *
 *  - "ruled":    pooled k over pooled n, every measure.
 *  - "as_cards": today's card arithmetic, per measure (read from panel_build.ts): named, recommended, conversion,
 *                named-but-not-recommended, of-those-avoid and the recommendation outcomes are pooled exactly as
 *                "ruled"; share of picks and picked are the members' picks added up over (the shared base x the
 *                number of members) - the MEAN of the members' rates, which equals the pooled figure because every
 *                member's base is the same (the scope's picks, or its answers).
 *  - "mean":     the unweighted mean of the members' percentages (no card uses it; reported so the owner can see
 *                what "average" would mean read literally on measures whose bases differ per brand).
 */
export const AVERAGE_COMPETITOR_RULE = "The listed competitors only; their numerators added up over their bases added up.";
export type AvgMode = "ruled" | "as_cards" | "mean";

export function averageCompetitor(perMember: { k: number; n: number }[], measureId: string, mode: AvgMode): { k: number; n: number; rate: number } {
  if (!perMember.length) return { k: 0, n: 0, rate: 0 };
  const K = perMember.reduce((a, x) => a + x.k, 0);
  const N = perMember.reduce((a, x) => a + x.n, 0);
  if (mode === "ruled") return { k: K, n: N, rate: N ? K / N : 0 };
  if (mode === "mean") {
    const rate = perMember.reduce((a, x) => a + (x.n ? x.k / x.n : 0), 0) / perMember.length;
    return { k: K, n: N, rate };
  }
  if (measureId === "share_of_picks" || measureId === "picked") {
    const n0 = perMember[0].n;
    if (perMember.some((x) => x.n !== n0)) throw new Error(`average competitor (as_cards): ${measureId} members do not share one base`);
    return { k: K, n: n0 * perMember.length, rate: n0 ? K / (n0 * perMember.length) : 0 };
  }
  return { k: K, n: N, rate: N ? K / N : 0 };
}

/* ------------------------------- product names ------------------------------- */

/**
 * Written product names grouped into rows. Today's cards do it three ways (panel_build.ts); each is a mode here so
 * today's numbers can be reproduced - which one is THE rule is an owner ruling, not made here.
 *
 *  - "split" (productSplit; "Which of your <products> it picks", "Which <products> it picks" lines): ONE name per
 *    answer (its pick). Key = the name's words minus the category's nouns, small words and the maker's own name
 *    words; a group whose words sit inside exactly ONE larger group joins it (the small group is absorbed upward);
 *    an answer whose pick names no product falls in a "no specific product" row. Its grouping is "merge"'s; it
 *    differs only in its input (the caller passes one item per answer: the pick) and that row, which is the caller's.
 *  - "merge" (mergeProducts, writtenProducts; the step explanations' product lists, a rival's products): SEVERAL
 *    names per answer. Same key and the same join-the-one-larger-group step; a row holds every answer naming any
 *    of its forms. (yourProducts - the "Which of your <products> it names" table - keys the same way but never joins
 *    groups; it is recorded as "merge" with join off.)
 *  - "value_fold" (the Value card's own cheaper options; value.ts foldOwn): key = the name's words minus the
 *    maker's name words and plan words (tier, plan, version, ...), digits stripped, a trailing "s" dropped, the
 *    category's nouns dropped; descriptions ("a cheaper ...", "any ...") are never options; then a group whose
 *    words name no confirmed price line's word absorbs EVERY larger group containing its words (downward: the small
 *    group keeps the rows of all its supersets).
 *
 * Names that leave nothing but the maker's name are not products in any mode.
 */
export type ProductMode = "split" | "merge" | "merge_nojoin" | "value_fold";

export interface ProductItem {
  answer: string;
  /** The brand the name resolves to. */
  key: string;
  written: string;
}

export interface ProductRow {
  /** The row's shown name: its most written form. */
  name: string;
  key: string;
  /** A stable id for the row: the brand and the surviving group's distinctive words ("<key>~<word>_<word>"). */
  id: string;
  /** Every form in the row. */
  forms: string[];
  answers: Set<string>;
}

/** Small words that never tell two products apart. Not the single letter "a": in a product name it is a model letter
 * ("Galaxy A-series", "Pixel 10a" as written "Pixel a"), and the product test already keys it (products.ts). */
const PRODUCT_STOP = new Set(["the", "from", "by", "of", "an", "and", "with", "for"]);
const OWN_STOP = new Set(["with", "tier", "tiers", "plan", "plans", "supported", "version", "option", "the", "its", "their", "edition", "model", "line"]);
const cleanProduct = (x: string) => x.replace(/[®™]/g, "").replace(/\s+from\s+.+$/i, "").replace(/\s+/g, " ").trim();
const isSubsequence = (short: string, long: string) => {
  let i = 0;
  for (const ch of long) if (ch === short[i]) i++;
  return i === short.length;
};

/** A brand's own name words (canonical, display name, and one-word aliases that shorten the name). */
export function brandNameTokens(set: AnswerFactSet, key: string): Set<string> {
  const name = key === set.target.key ? set.target.name : set.nameOf(key);
  const e = set.resolve(name).entry;
  const out = new Set<string>(famTokens(name));
  if (e) {
    for (const f of [e.canonical, e.display_name ?? ""]) for (const t of famTokens(f)) out.add(t);
    const compact = [e.canonical, e.display_name ?? ""].map((f) => famTokens(f).join(""));
    for (const a of e.aliases) {
      const t = famTokens(a);
      if (t.length === 1 && t[0].length >= 2 && compact.some((c) => c.length > t[0].length && isSubsequence(t[0], c))) out.add(t[0]);
    }
  }
  return out;
}

export function productGroups(items: ProductItem[], set: AnswerFactSet, mode: ProductMode, opts: { category: string; lineWords?: Set<string> }): ProductRow[] {
  const nouns = new Set([...famTokens(productNoun(opts.category)), ...famTokens(pluralNoun(opts.category))]);
  const own = new Map<string, Set<string>>();
  const ownOf = (k: string) => {
    let x = own.get(k);
    if (!x) own.set(k, (x = brandNameTokens(set, k)));
    return x;
  };
  type G = { key: string; forms: Map<string, number>; answers: Set<string>; toks: Set<string> };
  const by = new Map<string, G>();
  const sing = (w: string) => w.replace(/s$/, "");
  for (const it of items) {
    const name = cleanProduct(it.written) || it.written.trim();
    const o = ownOf(it.key);
    let toks: string[];
    if (mode === "value_fold") {
      if (/^(any|a|an|the|another|some)\s/i.test(name) || !/^[A-Za-z0-9]/.test(name)) continue;
      toks = [...new Set(famTokens(name).filter((t) => !o.has(t)).map((t) => t.replace(/[0-9]/g, "")).filter((t) => t && !OWN_STOP.has(t)).map(sing))].filter((w) => !nouns.has(w) && !nouns.has(`${w}s`)).sort();
    } else toks = famTokens(name).filter((t) => !nouns.has(t) && !PRODUCT_STOP.has(t) && !o.has(t));
    if (!toks.length) continue;
    const gk = `${it.key}|${toks.join(" ")}`;
    const g = by.get(gk) ?? { key: it.key, forms: new Map<string, number>(), answers: new Set<string>(), toks: new Set(toks) };
    g.forms.set(name, (g.forms.get(name) ?? 0) + 1);
    g.answers.add(it.answer);
    by.set(gk, g);
  }
  const sizeAsc = () => [...by.keys()].sort((a, b) => by.get(a)!.toks.size - by.get(b)!.toks.size);
  const absorb = (into: G, g: G) => {
    for (const [f, n] of g.forms) into.forms.set(f, (into.forms.get(f) ?? 0) + n);
    for (const a of g.answers) into.answers.add(a);
  };
  if (mode === "split" || mode === "merge") {
    for (const k of sizeAsc()) {
      const g = by.get(k);
      if (!g) continue;
      const sup = [...by.entries()].filter(([k2, g2]) => k2 !== k && g2.key === g.key && g2.toks.size > g.toks.size && [...g.toks].every((t) => g2.toks.has(t)));
      if (sup.length !== 1) continue;
      absorb(sup[0][1], g);
      by.delete(k);
    }
  } else if (mode === "value_fold") {
    const lw = opts.lineWords ?? new Set<string>();
    for (const k of sizeAsc()) {
      const g = by.get(k);
      if (!g || [...g.toks].some((w) => lw.has(w))) continue;
      for (const [k2, g2] of [...by.entries()]) {
        if (k2 === k || g2.key !== g.key || ![...g.toks].every((t) => g2.toks.has(t))) continue;
        absorb(g, g2);
        by.delete(k2);
      }
    }
  }
  return [...by.entries()]
    .map(([gk, g]) => ({ name: [...g.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0], key: g.key, id: `${g.key}~${gk.slice(gk.indexOf("|") + 1).replace(/\s+/g, "_")}`, forms: [...g.forms.keys()].sort(), answers: g.answers }))
    .sort((a, b) => b.answers.size - a.answers.size || a.name.localeCompare(b.name));
}

/** A product name's distinctive words, as productGroups (modes "merge" / "split") keys it: its words minus the
 * category's nouns, small words and the brand's own name words. */
export function productTokens(written: string, key: string, set: AnswerFactSet, category: string): string[] {
  const nouns = new Set([...famTokens(productNoun(category)), ...famTokens(pluralNoun(category))]);
  const o = brandNameTokens(set, key);
  return famTokens(cleanProduct(written) || written.trim()).filter((t) => !nouns.has(t) && !PRODUCT_STOP.has(t) && !o.has(t));
}

/** The form a product name is grouped under (productGroups' own cleaning). */
export const productForm = (written: string) => cleanProduct(written) || written.trim();

/**
 * A product's short name (ruling 15): its full name with the brand's own leading name words dropped ("<Brand> Gold
 * Card" -> "Gold Card"). A one-word or numeric rest, or a rest that runs on in lower case, keeps the full name
 * ("Pixel 11 Pro", "Amex Platinum").
 */
export function shortProductName(full: string, own: Set<string>): string {
  const words = full.trim().split(/\s+/);
  let i = 0;
  while (i < words.length && famTokens(words[i]).length > 0 && famTokens(words[i]).every((t) => own.has(t))) i++;
  const rest = words.slice(i).join(" ").replace(/^[^A-Za-z0-9]+/, "").trim();
  if (!rest || !famTokens(rest).some((t) => !own.has(t))) return full;
  if (i > 0 && (/^[a-z]/.test(rest) || /^\d/.test(rest) || rest.split(/\s+/).length === 1)) return full;
  return rest;
}

/* ------------------------------- conditions ------------------------------- */

/** Which saved grouping a card's condition rows read (conditions.ts): the run's themes (with the "elsewhere" groups
 * beside the away themes), the Map's grouping when the run has no themes, or the Premium vs basic card's tier rows. */
export type CondFlavor = "themed" | "map" | "tier" | "group" | "tierwide";

export interface CondRow {
  /** The row's label (sentence case, as the cards print it). */
  label: string;
  /** The condition units the row counts (conditions.ts). */
  units: string[];
  /** Answers stating it (after the row's own filter). */
  count: number;
  /** The answers, for a proof. */
  answers: Set<string>;
  /** The label as the grouping names it (before the row's sentence-case normalising). */
  raw?: string;
}

const condKey = (label: string) => condRowLabel(label).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const COND_SOFT = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "with", "is", "are", "be", "they", "their", "them", "theirs", "often", "frequently", "frequent", "regularly", "regular", "usually", "always", "mostly", "really", "very", "lot", "lots", "much", "many", "more", "most", "heavily", "heavy", "plenty", "want", "wants", "prefer", "prefers", "need", "needs", "like", "likes", "if", "when"]);
const condCore = (label: string) => [...new Set(condKey(label).split(" ").filter((w) => w && !COND_SOFT.has(w)).map((w) => w.slice(0, 5)))].sort().join(" ");

interface Src {
  label: string;
  units: Set<string>;
  ids: Set<string>;
}

/** A side's sources in a scope: one per unit, named as the cards name it (a theme or group by its name; a Map or
 * tier unit by its most stated wording among the scope's answers), rows stating the same thing in other case or
 * punctuation merged (the larger one's name kept). */
function condSources(rows: Fact[], side: "toward" | "away", flavor: CondFlavor, to?: string): Src[] {
  // "group": the run-wide groups themselves (ruling 14), when the run has no themes.
  const ok = (u: string, c?: { grouping: string; side: string }) =>
    flavor === "themed" ? u.startsWith(`t:${side}:`) || (side === "away" && u.startsWith("g:elsewhere:")) : flavor === "group" ? !!c && c.grouping === "group" && c.side === side : u.startsWith(`${flavor === "map" ? "m" : flavor === "tierwide" ? "q" : "p"}:${side}:`);
  const label = new Map<string, string>();
  const said = new Map<string, Map<string, number>>();
  const ids = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const f of rows)
    for (const c of f.conds ?? []) {
      if (!ok(c.unit, c)) continue;
      // A rival's own card: only the statements that send the buyer to that rival.
      if (to && !c.toKeys.includes(to)) continue;
      if (!ids.has(c.unit)) {
        ids.set(c.unit, new Set());
        order.push(c.unit);
      }
      ids.get(c.unit)!.add(f.responseId);
      if (flavor === "themed" || flavor === "group") label.set(c.unit, c.label);
      else {
        const m = said.get(c.unit) ?? new Map<string, number>();
        m.set(c.said, (m.get(c.said) ?? 0) + 1);
        said.set(c.unit, m);
      }
    }
  for (const [u, m] of said) label.set(u, [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || (x[0] < y[0] ? -1 : 1))[0][0]);
  // Merge rows that say the same in other case or punctuation.
  const out = new Map<string, Src>();
  for (const u of order) {
    const l = label.get(u)!;
    const k = condKey(l);
    const t = out.get(k);
    if (!t) {
      out.set(k, { label: l, units: new Set([u]), ids: new Set(ids.get(u)) });
      continue;
    }
    t.units.add(u);
    for (const id of ids.get(u)!) t.ids.add(id);
    if (ids.get(u)!.size > t.ids.size) t.label = l;
  }
  return [...out.values()];
}



/* ------------------------------- the book ------------------------------- */

export interface SelectionOpts {
  /** competitors / averageCompetitor: "ratified" (default) or "as_cards" (with `card`). */
  mode?: "ratified" | "as_cards";
  /** competitors (ratified): the card's own ranking measure - picks (default), recommendations or answers naming it;
   * and the card's own floor for the top three (default none). */
  rankBy?: "picks" | "recommended" | "named";
  floor?: number;
  /** ends: the end a rule chooses ("premium" / "basic"). */
  choice?: string;
  /** vendors: the fewest answers an AI company needs in the scope. */
  min?: number;
  card?: CompetitorCard;
  /** conditions_shown: the side, the grouping, and an answer filter on the toward side (a lost-with-an-exception
   * card counts its toward rows only in the answers that pick the rival - a slice). */
  side?: "toward" | "away";
  flavor?: CondFlavor;
  towardOnly?: string;
  /** weighs_shown: each column's answers as a slice (undefined = every answer in the scope), its lead topic (the
   * code shown first when no other side is sized against it), and how many topics. */
  sides?: { slice?: string; lead?: string }[];
  top?: number;
  /** The too-obvious list the topics are filtered for (panel_filter.ts). */
  list?: OmissionList;
  /** leader / visibility_brands: whose list (the subject is never its own leader). */
  /** cond_destinations / cond_products / cond_pairs: the row's condition units; cond_destinations: count only the
   * statements that send the buyer to this brand (a rival's own card). */
  units?: string[];
  to?: string;
  /** product_picks: the brand whose picks are listed (entry id) and how many products. */
  brand?: string;
  /** pick_brands: the tracker first, then the others (Habit's "who gets it"). */
  youFirst?: boolean;
  /** named_brands / rec_brands: the tracker kept in its place in the ranking. */
  rankYou?: boolean;
  /** quote_groups: the grouping's context (type_detail.ts). */
  ctx?: string;
  /** cond_products: count products named and never picked too (the run's named products - nameProductOf). */
  named?: boolean;
  /** conditions_shown: move an away row whose products are mostly the tracker's own to the toward side (alongside). */
  ownSplit?: boolean;
  /** pick_brands: brands left out (a rival's own page leaves the rival out). */
  exclude?: string[];
  /** named_brands / redirect_dests / pairings / first_pairing / first_named: the slice of the scope's answers counted. */
  slice?: string;
  /** case_args: the strong answers' slice, the slice they are set against, the fewest strong answers a topic needs, and
   * whether the question's quoted criticism counts as its wording (answering a critic). */
  strong?: string;
  rest?: string;
  minK?: number;
  critic?: boolean;
  /** arg_lift: the floors - "summary" (the brand summary's: 20 answers a side, 2% incidence) or "local" (none). */
  lift?: "summary" | "local";
}

/** The selections whose parameters ride in their id as JSON ("~j{...}"): parseSelectionId reads them back. */
const JSON_SELECTIONS = new Set(["sent_all", "sent_outside", "rec_brands", "arg_rank", "out_names", "quote_groups", "topics_shown", "arg_lift", "named_brands", "first_named", "situations", "redirect_dests", "pairings", "first_pairing", "cond_cards", "case_args", "adjacent_names", "pick_args_diff", "question_types"]);

/** A selection id read back into its name, subject, scope and parameters (for a proof that recomputes it from the id
 * alone). Covers the JSON-parameter selections and the competitor group. */
export function parseSelectionId(id: string): { name: string; subject: string; scope: Scope; opts: SelectionOpts } | null {
  if (!id.startsWith("sel:")) return null;
  const body = id.slice(4);
  const bar = body.indexOf("|");
  const full = body.slice(0, bar);
  const rest = body.slice(bar + 1);
  const t0 = rest.indexOf("|t=");
  const subject = rest.slice(0, t0);
  const scope = scopeFromKey(rest.slice(t0 + 1));
  const tilde = full.indexOf("~");
  const name = tilde >= 0 ? full.slice(0, tilde) : full;
  const param = tilde >= 0 ? full.slice(tilde + 1) : "";
  if (JSON_SELECTIONS.has(name)) return { name, subject, scope, opts: JSON.parse(param.slice(1)) as SelectionOpts };
  if (name === "competitors") {
    const parts = param.split(":");
    const opts: SelectionOpts = { mode: parts[0] as "ratified" | "as_cards" };
    for (const x of parts.slice(1)) {
      if (x === "rec") opts.rankBy = "recommended";
      else if (x === "named") opts.rankBy = "named";
      else if (/^f\d+$/.test(x)) opts.floor = Number(x.slice(1));
      else opts.card = x as CompetitorCard;
    }
    return { name, subject, scope, opts };
  }
  return null;
}

/** A scope from its key (scopeKey's inverse). */
export function scopeFromKey(key: string): Scope {
  const parts = key.split("|");
  const sc: { types?: string[]; situation?: string | null; worry?: string; rival?: string; line?: string; engines?: string[]; vendor?: string; when?: string } = {};
  for (let i = 0; i < parts.length; i++) {
    const pt = parts[i];
    const k = pt.slice(0, 2);
    const v = pt.slice(2);
    if (k === "t=") sc.types = v.split("+");
    else if (k === "s=") sc.situation = v === "~none" ? null : v;
    else if (k === "w=") sc.worry = v;
    else if (k === "r=") sc.rival = v;
    else if (k === "l=") sc.line = v;
    else if (k === "e=") sc.engines = v.split("+");
    else if (k === "v=") sc.vendor = v;
    else if (k === "h=") {
      sc.when = parts.slice(i).join("|").slice(2);
      break;
    }
  }
  return sc as Scope;
}

/** A written name's key for grouping names as written (case and punctuation set aside). */
const writtenKey = (name: string) => famTokens(name).join(" ") || name.trim().toLowerCase();
/** A member key for a group of names as written: its forms, URI-encoded (so it can sit in a slice). */
export const formsKey = (forms: string[]) => `~w:${[...forms].sort().map((f) => encodeURIComponent(f)).join(",")}`;

/** A weighs column: its topics in drawn order (code and the side's count), or too few answers to size. */
export interface WeighsColumn {
  codes: { code: string; k: number }[];
  few: boolean;
}

/** Any selection's member (a brand, a condition row or a weighs column), and the extras the selections carry (each
 * selection fills only its own). */
export type AnySelMember = SelMember | CondRow | WeighsColumn;
export interface AnySelExtras extends Partial<CompetitorExtras> {
  base?: number;
  ranked?: SelMember[];
  side?: "toward" | "away";
  flavor?: CondFlavor;
  versus?: boolean;
  folded?: { key: string; name: string }[];
}
export type AnySelection = Selection<AnySelMember, AnySelExtras>;

export function selectionBook(set: AnswerFactSet, book: FactBook, data?: ViewData) {
  const memo = new Map<string, AnySelection>();
  const T = set.target.key;
  const subjKey = (s: string) => (s === "you" ? T : s);

  /** The question wordings of the scope's cells (prompts asked, not staged or retired, and the cells' own text):
   * what the too-obvious rule reads. */
  const wordingsOf = (rows: Fact[]) => {
    if (!data) throw new Error("selection: the too-obvious rule needs the question wordings (pass ViewData)");
    const ci = new Set(rows.map((f) => f.intentId));
    const intentText = new Map(data.intents.map((i) => [i.id, i.text]));
    return wordingIndex([...data.prompts.filter((p) => p.intent_id && ci.has(p.intent_id) && !p.staged && !p.retired).map((p) => p.text), ...[...ci].map((i) => intentText.get(i) ?? "")]);
  };

  /** Members and extras are typed as the union of every selection's; each selection fills only its own fields. */
  function selection(name: string, subject: string, scope: Scope, opts: SelectionOpts = {}): AnySelection {
    const params =
      name === "cond_destinations" || name === "cond_products"
        ? `~${(opts.units ?? []).join("+")}${opts.to ? `>to:${opts.to}` : ""}${opts.named ? ":named" : ""}`
        : name === "product_picks"
          ? `~${opts.brand ?? "you"}:${opts.top ?? 2}`
          : name === "product_names" || name === "product_first" || name === "product_suggested"
            ? `~${opts.brand ?? "you"}:${opts.top ?? 0}`
            : name === "pick_brands"
              ? `~${opts.youFirst ? "you" : "all"}:${opts.top ?? 0}${opts.exclude?.length ? `:x${[...opts.exclude].sort().join(",")}` : ""}`
              : name === "vendors"
                ? `~${opts.min ?? 3}`
                : name === "ends"
                  ? `~${opts.choice}`
                  : name === "first_rec" || name === "first_sent" || name === "sent_products" || name === "sent_own_products" || name === "instead_products" || name === "own_options"
                    ? `~${opts.top ?? 4}`
                    : name === "worries"
                      ? `~${opts.min ?? SEL_FLOORS.argsMin}`
                    : name === "converts_better"
                      ? `~${opts.min ?? SEL_FLOORS.visReadableRec}:${opts.top ?? 3}`
                    : name === "competitors" ? `~${opts.mode ?? "ratified"}${opts.mode === "as_cards" ? `:${opts.card}` : ""}${opts.rankBy === "recommended" ? ":rec" : opts.rankBy === "named" ? ":named" : ""}${opts.floor ? `:f${opts.floor}` : ""}` : JSON_SELECTIONS.has(name) ? `~j${JSON.stringify(opts)}` : name === "conditions_shown" ? `~${opts.side}:${opts.flavor}${opts.towardOnly ? `@${opts.towardOnly}` : ""}${opts.to ? `>to:${opts.to}` : ""}${opts.ownSplit ? ":own" : ""}` : name === "weighs_shown" ? `~${JSON.stringify(opts.sides ?? [{}])}:${opts.top ?? 3}:${opts.list ?? "weighs"}` : "";
    const fullName = `${name}${params}`;
    const id = selectionId(fullName, subject, scope);
    const hit = memo.get(id);
    if (hit) return hit;
    const rows = book.rows(scope);
    let out: Selection<unknown, unknown>;
    switch (name) {
      case "competitors": {
        if (subject !== "you") throw new Error(`selection "competitors": the group is the tracker's competitors (subject "you")`);
        if ((opts.mode ?? "ratified") === "as_cards") {
          if (!opts.card) throw new Error(`selection "competitors" (as_cards): name the card kind`);
          out = { id, name: fullName, subject, scope, rule: AS_CARDS_RULE[opts.card], members: competitorsAsCards(set, rows, scope, opts.card), extras: { mode: "as_cards", card: opts.card } };
        } else {
          const r = competitorsRatified(set, rows, scope, opts.rankBy, opts.floor ?? 0);
          out = { id, name: fullName, subject, scope, rule: opts.rankBy === "recommended" ? RATIFIED_COMPETITORS_REC_RULE : opts.rankBy === "named" ? RATIFIED_COMPETITORS_NAMED_RULE : RATIFIED_COMPETITORS_RULE, members: r.members, extras: r.extras };
        }
        break;
      }
      case "takers": {
        // "Who takes the picks": the five brands with the most picks of an active brand (5 at least) besides the
        // tracker - no brand left out for being a class brand or the brand being left - then the tracker; all in
        // picks order, ties by name. Shown only when at least two brands clear the floor.
        const list = rank(tally(rows.filter(activePick), (f) => [{ key: f.pick.key!, name: f.pick.key === T ? set.target.name : f.pick.name! }]));
        const clear = list.filter((b) => b.count >= SEL_FLOORS.brandFloor);
        const you = list.find((b) => b.key === T) ?? { key: T, name: set.target.name, count: 0 };
        const members = clear.length >= 2 ? [...clear.filter((b) => b.key !== T).slice(0, SEL_FLOORS.compTop), you].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) : [];
        out = { id, name: fullName, subject, scope, rule: "The five brands with the most picks of an active brand (5 at least) besides the tracker, then the tracker, in picks order (ties by name); shown when two brands clear the floor.", members, extras: { base: rows.filter(activePick).length } };
        break;
      }
      case "takers_after_rec": {
        const key = subjKey(subject);
        const lost = rows.filter((f) => f.brands.some((b) => b.key === key && b.recommended) && activePick(f) && f.pick.key !== key);
        const members = lost.length >= 5 ? rank(tally(lost, (f) => [{ key: f.pick.key!, name: f.pick.name! }])).filter((b) => b.key !== T && b.count >= SEL_FLOORS.rowMin).slice(0, 3) : [];
        out = { id, name: fullName, subject, scope, rule: "Of the answers that recommend the brand and pick another active brand (5 at least), the three brands picked most (3 answers at least), the tracker left out.", members, extras: { base: lost.length } };
        break;
      }
      case "leader": {
        const key = subjKey(subject);
        for (const t of scope.types) if (!PICK_TYPES.includes(t)) throw new Error(`selection "leader": ranks by picks, and question type "${t}" takes no picks - refused`);
        const picks = tally(rows.filter((f) => f.pick.state === "in_analysis"), (f) => [{ key: f.pick.key!, name: f.pick.name! }]);
        const named = tally(rows, (f) => f.brands.filter((b) => b.bucket === "in_analysis").map((b) => ({ key: b.key, name: b.name })));
        // The tie-break past times named: the brand's order across all buyers (what to buy: picks, then named, then name).
        const allRows = book.rows({ ...WHAT_TO_BUY_ALL, engines: scope.engines });
        const aP = tally(allRows.filter((f) => f.pick.state === "in_analysis"), (f) => [{ key: f.pick.key!, name: f.pick.name! }]);
        const aN = tally(allRows, (f) => f.brands.filter((b) => b.bucket === "in_analysis").map((b) => ({ key: b.key, name: b.name })));
        const c = (m: Map<string, { ids: Set<string> }>, k: string) => m.get(k)?.ids.size ?? 0;
        const ranked = [...picks.entries()]
          .filter(([k]) => k !== key)
          .map(([k, x]) => ({ key: k, name: x.name, count: x.ids.size }))
          .sort((a, b) => b.count - a.count || c(named, b.key) - c(named, a.key) || c(aP, b.key) - c(aP, a.key) || c(aN, b.key) - c(aN, a.key) || a.name.localeCompare(b.name));
        out = { id, name: fullName, subject, scope, rule: "The brand in analysis other than the subject with the most picks; ties by times named in the scope, then by its standing across all buyers (picks, then named), then by name.", members: ranked.slice(0, 1), extras: { ranked } };
        break;
      }
      case "checklist": {
        if (scope.types.some((t) => t !== "criteria")) throw new Error(`selection "checklist": the what-to-look-for list is read on "criteria" questions only`);
        const by = new Map<string, number>();
        for (const f of rows) for (const a of new Set(f.args ?? [])) by.set(a, (by.get(a) ?? 0) + 1);
        const ranked = [...by.entries()].map(([code, k]) => ({ code, k, share: rows.length ? k / rows.length : 0 })).sort((a, b) => b.k - a.k || a.code.localeCompare(b.code));
        const kept = filterObvious(ranked, id, "checklist", wordingsOf(rows), new Map(), "", undefined).slice(0, SEL_FLOORS.checklistTop);
        out = { id, name: fullName, subject, scope, rule: "The five topics the answers raise most (ties by name), a topic in 90% or more of the answers whose name the question itself says left out.", members: kept.map((x) => ({ key: x.code, name: x.code, count: x.k })), extras: {} };
        break;
      }
      case "conditions_shown": {
        const side = opts.side ?? "toward";
        const flavor = opts.flavor ?? "themed";
        let t = condSources(rows, "toward", flavor, side === "toward" ? undefined : opts.to);
        let a = condSources(rows, "away", flavor, opts.to);
        if (opts.ownSplit) {
          // What to use alongside you: an away row whose products are mostly the tracker's own sits with "something of
          // yours" - over its answers naming a product, more than half name only the tracker's own (a name resolving to
          // the tracker, or one the answer pairs as its own).
          const byId0 = new Map(rows.map((f) => [f.responseId, f]));
          const ownCard = (f: Fact, c: string) => set.resolve(c).key === T || (f.pairings ?? []).some((p) => p.relation === "own" && writtenKey(p.name) === writtenKey(c));
          const mostlyOwn = (x: Src) => {
            let own = 0;
            let named = 0;
            for (const id0 of x.ids) {
              const f = byId0.get(id0)!;
              const cs = [...new Set((f.conds ?? []).filter((c) => x.units.has(c.unit)).flatMap((c) => c.cards))].filter((c) => c.trim());
              if (!cs.length) continue;
              named++;
              if (cs.every((c) => ownCard(f, c))) own++;
            }
            return named > 0 && own * 2 > named;
          };
          const moved = a.filter(mostlyOwn);
          if (moved.length) {
            a = a.filter((x) => !moved.includes(x));
            const merged = new Map<string, Src>(t.map((x) => [condKey(x.label), { ...x, units: new Set(x.units), ids: new Set(x.ids) }]));
            for (const x of moved) {
              const k = condKey(x.label);
              const m0 = merged.get(k);
              if (!m0) merged.set(k, { ...x, units: new Set(x.units), ids: new Set(x.ids) });
              else {
                for (const u0 of x.units) m0.units.add(u0);
                for (const id0 of x.ids) m0.ids.add(id0);
                if (x.ids.size > m0.ids.size) m0.label = x.label;
              }
            }
            t = [...merged.values()];
          }
        }
        // The same condition on both sides under near-identical names: one label, the larger side's (not on a rival's
        // own card, whose toward rows are the cell's own).
        const tBy = new Map<string, Src>();
        if (!opts.to)
        for (const x of t) if (condCore(x.label)) tBy.set(condCore(x.label), x);
        t = t.map((x) => ({ ...x }));
        const tCopy = new Map(t.map((x) => [condCore(x.label), x]));
        if (!opts.to)
          a = a.map((x) => {
          const k = condCore(x.label);
          const tt = k ? tBy.get(k) : undefined;
          if (!tt) return x;
          const label = tt.ids.size >= x.ids.size ? tt.label : x.label;
          tCopy.get(k)!.label = label;
          return { ...x, label };
        });
        const keep = side === "toward" && opts.towardOnly ? slicePred(opts.towardOnly, set) : null;
        const byId = new Map(rows.map((f) => [f.responseId, f]));
        const members: CondRow[] = (side === "toward" ? t : a)
          .filter((s) => !isDefaultCondition(s.label))
          .map((s) => {
            const ids = new Set([...s.ids].filter((x) => !keep || keep(byId.get(x)!)));
            return { label: condRowLabel(s.label), units: [...s.units].sort(), count: ids.size, answers: ids, raw: s.label };
          })
          .filter((x) => x.count >= SEL_FLOORS.rowMin)
          .sort((x, y) => y.count - x.count || x.raw.localeCompare(y.raw))
          .slice(0, SEL_FLOORS.condRows)
          .map(({ label, units, count, answers, raw }) => ({ label, units, count, answers, raw }));
        out = {
          id,
          name: fullName,
          subject,
          scope,
          rule: "The six conditions stated in the most answers on the side (3 at least), the default clause left out, rows saying the same thing merged; ties by name. (A card also drops an away row whose every answer it already shows as a toward example.)",
          members,
          extras: { side, flavor },
        };
        break;
      }
      case "weighs_shown": {
        const sides = opts.sides ?? [{}];
        const top = opts.top ?? 3;
        const list = opts.list ?? "weighs";
        const cellCount = new Map<string, number>();
        for (const f of rows) for (const c of new Set(f.args ?? [])) cellCount.set(c, (cellCount.get(c) ?? 0) + 1);
        const wording = wordingsOf(rows);
        const sideRows = sides.map((s) => (s.slice ? rows.filter(slicePred(s.slice, set)) : rows));
        const sh = sideRows.map((rs) => {
          const withR = rs.filter((f) => f.args !== null);
          const m = new Map<string, number>();
          for (const f of withR) for (const c of new Set(f.args!)) m.set(c, (m.get(c) ?? 0) + 1);
          return { n: withR.length, m };
        });
        const versus = sides.length === 2 && sh.every((x) => x.n >= SEL_FLOORS.argsMin);
        const columns = sides.map((sd, si) => {
          if (sh[si].n < SEL_FLOORS.argsMin) return { codes: [] as { code: string; k: number }[], few: true };
          const other = versus ? sh[1 - si] : null;
          const gap = (code: string, k: number) => (other ? k / sh[si].n - (other.m.get(code) ?? 0) / other.n : 0);
          const ranked = [...sh[si].m.entries()]
            .filter(([code, k]) => k >= SEL_FLOORS.rowMin && (!other || gap(code, k) >= SEL_FLOORS.weighsGap))
            .sort((x, y) => (other ? gap(y[0], y[1]) - gap(x[0], x[1]) : x[0] === sd.lead ? -1 : y[0] === sd.lead ? 1 : 0) || y[1] - x[1] || x[0].localeCompare(y[0]))
            .map(([code, k]) => ({ code, k, share: (cellCount.get(code) ?? k) / Math.max(1, rows.length) }));
          const kept = filterObvious(ranked, id, list, wording, new Map(), "", undefined).slice(0, top);
          if (other) kept.sort((x, y) => y.k - x.k || x.code.localeCompare(y.code));
          return { codes: kept.map((x) => ({ code: x.code, k: x.k })), few: false };
        });
        out = {
          id,
          name: fullName,
          subject,
          scope,
          rule: "Per column, up to three topics raised in 3+ of its answers; with two columns of 10+ answers each, only topics at least 5 points more common on that side, chosen by the gap and drawn largest first; else the lead topic first, then the most raised; a topic in 90% of the answers whose name the question says left out.",
          members: columns,
          extras: { versus },
        };
        break;
      }
      case "cond_destinations": {
        // Where a condition row sends the buyer: the active brands its statements name, among the row's answers that
        // name a destination (2 at least, and 15% of them), most first, top 3 (the cards' routeShares rule).
        const units = new Set(opts.units ?? []);
        const by = new Map<string, { name: string; ids: Set<string> }>();
        let routed = 0;
        for (const f of rows) {
          const st = (f.conds ?? []).filter((c) => units.has(c.unit) && (!opts.to || c.toKeys.includes(opts.to)));
          if (!st.length) continue;
          const to = new Map<string, string>();
          for (const c of st) c.toKeys.forEach((k, i) => to.set(k, c.to[i] ?? set.nameOf(k)));
          if (!to.size) continue;
          routed++;
          for (const [k, name] of to) {
            const t = by.get(k) ?? { name, ids: new Set<string>() };
            t.ids.add(f.responseId);
            by.set(k, t);
          }
        }
        const members = rank(by).filter((m) => m.count >= 2 && m.count / Math.max(1, routed) >= 0.15).slice(0, 3);
        out = { id, name: fullName, subject, scope, rule: "The active brands a condition row's statements send the buyer to, among the row's answers that name a destination: 2 answers and 15% of them at least, most first (ties by name), top 3.", members, extras: { base: routed } };
        break;
      }
      case "cond_products": {
        // The tracker's own products a toward row's statements name (the run's product grouping, short names): the two
        // named in the most answers (ties by name).
        const units = new Set(opts.units ?? []);
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rows)
          for (const c of f.conds ?? []) {
            if (!units.has(c.unit)) continue;
            for (const card of c.cards) {
              const of = opts.named ? set.nameProductOf ?? set.productOf : set.productOf;
              const pid = card.trim() && of ? of(T, card) : null;
              if (!pid) continue;
              const t = by.get(pid) ?? { name: set.products!.get(pid)!.short, ids: new Set<string>() };
              t.ids.add(f.responseId);
              by.set(pid, t);
            }
          }
        out = { id, name: fullName, subject, scope, rule: "The tracker's products (the run's one product grouping) a toward row's statements name: the two named in the most answers, ties by name.", members: rank(by).slice(0, 2), extras: {} };
        break;
      }
      case "product_picks": {
        // Which of a brand's products the AI picks, out of every pick of the brand: the run's products by the answers
        // picking each, plus one "~none" member for the picks naming no specific product; most first (ties by name),
        // top `top` (default 2). Members are product ids ("~none" for that row); names are the short names.
        const key = opts.brand ?? T;
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rows) {
          if (f.pick.state !== "in_analysis" || f.pick.key !== key) continue;
          const pid = f.pick.product ?? "~none";
          const t = by.get(pid) ?? { name: pid === "~none" ? "~none" : set.products!.get(pid)!.short, ids: new Set<string>() };
          t.ids.add(f.responseId);
          by.set(pid, t);
        }
        out = { id, name: fullName, subject, scope, rule: "Of every pick of the brand: its products (the run's one product grouping) and the picks naming no specific product, by the answers picking each, most first, ties by name.", members: rank(by).slice(0, opts.top ?? 2), extras: { base: rows.filter((f) => f.pick.state === "in_analysis" && f.pick.key === key).length } };
        break;
      }
      case "cond_pairs": {
        // Ruling 14: the same condition stated on both sides, under the run's ONE condition grouping - a condition key
        // stated toward in some answers and away in others, each side at least 3 answers and 5% of the answers that
        // state conditions, the smaller side at least half the larger, never a reason paired with its negation (the
        // both-ways rule). Members: one per key, with the two sides' group units.
        const bearing = rows.filter((f) => f.conds !== null).length;
        const sides = { toward: new Map<string, { units: Set<string>; ids: Set<string>; said: Map<string, number> }>(), away: new Map<string, { units: Set<string>; ids: Set<string>; said: Map<string, number> }>() };
        for (const f of rows)
          for (const c of f.conds ?? []) {
            if (c.grouping !== "group") continue;
            for (const k of c.keys) {
              const m = sides[c.side];
              const t = m.get(k) ?? { units: new Set<string>(), ids: new Set<string>(), said: new Map<string, number>() };
              t.units.add(c.unit);
              t.ids.add(f.responseId);
              t.said.set(c.said, (t.said.get(c.said) ?? 0) + 1);
              m.set(k, t);
            }
          }
        const NEG = /\b(?:not|no|never|without|rarely|seldom|hardly|hate|avoid|lack|won't|can't|cannot)\b|n't\b|n’t\b/i;
        const top = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || (x[0] < y[0] ? -1 : 1))[0][0];
        const members: { key: string; name: string; count: number; toward: string[]; away: string[] }[] = [];
        for (const [k, t] of sides.toward) {
          const a = sides.away.get(k);
          if (!a) continue;
          const lt = top(t.said);
          const la = top(a.said);
          if (isDefaultCondition(lt) || isDefaultCondition(la)) continue;
          const lo = Math.min(t.ids.size, a.ids.size);
          if (lo < Math.max(3, 0.05 * bearing) || lo < 0.5 * Math.max(t.ids.size, a.ids.size)) continue;
          if (NEG.test(lt) !== NEG.test(la)) continue;
          members.push({ key: k, name: t.ids.size >= a.ids.size ? lt : la, count: t.ids.size + a.ids.size, toward: [...t.units].sort(), away: [...a.units].sort() });
        }
        members.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
        out = { id, name: fullName, subject, scope, rule: "Conditions stated on both sides under the run's one condition grouping: each side 3 answers and 5% of the answers stating conditions at least, the smaller side half the larger, never a reason paired with its negation; most stated first.", members: members as unknown as SelMember[], extras: { base: bearing } };
        break;
      }
      case "h2h_rivals": {
        // The named rivals of the scope's head-to-heads that the AI picks over you, by the answers picking each in its
        // own matchup (1 at least), most first, ties by name, top five (the all-rivals card's bars).
        const by = tally(rows.filter((f) => !!f.rival && f.pick.state !== "none" && f.pick.key === f.rival.key && f.pick.key !== T), (f) => [{ key: f.rival!.key, name: f.rival!.name }]);
        out = { id, name: fullName, subject, scope, rule: "The named rivals the AI picks in their own head-to-head (1 answer at least), most picks first, ties by name, top five.", members: rank(by).slice(0, SEL_FLOORS.compTop), extras: {} };
        break;
      }
      case "product_names":
      case "product_suggested": {
        // A brand's products (the run's one product grouping, short names) the scope's answers name: product_names any
        // written form of the brand naming the product; product_suggested a form framed recommended, or a rule's choice
        // or product resolving to the brand. Counted by answers, 3 at least, most first (ties by name), top `top`.
        const key = subjKey(opts.brand ?? "you");
        const term = name === "product_names" ? "nameprod" : "suggprod";
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rows)
          for (const pid of productsOf(f, key, term === "suggprod", set)) {
            const t = by.get(pid) ?? { name: set.products!.get(pid)!.short, ids: new Set<string>() };
            t.ids.add(f.responseId);
            by.set(pid, t);
          }
        // No floor here: a card draws the rows of 3+ answers (sorted by count, the top `top` then the floor is the
        // floor then the top) and says so in a sentence when none clears it.
        out = { id, name: fullName, subject, scope, rule: `The brand's products (the run's one product grouping) ${term === "nameprod" ? "the answers name" : "the answers suggest (recommended, or a rule's choice or product)"}: most answers first, ties by name (a card draws those with 3 answers at least).`, members: rank(by).slice(0, opts.top ?? 5), extras: { base: rows.length } };
        break;
      }
      case "product_first": {
        // Per answer, the brand's product its first written form that names one (the run's product grouping); "~none"
        // for an answer naming no specific product of it. Members by answers, most first, ties by name, top `top`.
        const key = subjKey(opts.brand ?? "you");
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rows) {
          const pid = firstProductOf(f, key, set) ?? "~none";
          // A product the grouping holds no row for is no row here (and never "no specific product").
          if (pid === "~unplaced") continue;
          const t = by.get(pid) ?? { name: pid === "~none" ? "~none" : set.products!.get(pid)!.short, ids: new Set<string>() };
          t.ids.add(f.responseId);
          by.set(pid, t);
        }
        out = { id, name: fullName, subject, scope, rule: "Per answer, the product the brand's first written form names (the run's one product grouping), or no specific product (a form naming no product); a product with no row in the grouping is no row; most answers first, ties by name.", members: rank(by).slice(0, opts.top ?? 2), extras: { base: rows.length } };
        break;
      }
      case "pick_brands": {
        // The brands in analysis the scope's answers pick, by picks: every one with 3 at least, most first (ties by
        // name); or (youFirst) the tracker, then the `top` others with the most picks.
        const by = tally(rows.filter((f) => f.pick.state === "in_analysis"), (f) => [{ key: f.pick.key!, name: f.pick.key === T ? set.target.name : f.pick.name! }]);
        const list = rank(by);
        const ex = new Set(opts.exclude ?? []);
        const members = opts.youFirst
          ? [list.find((b) => b.key === T) ?? { key: T, name: set.target.name, count: 0 }, ...list.filter((b) => b.key !== T && !ex.has(b.key)).slice(0, opts.top ?? 3)]
          : list.filter((b) => b.count >= SEL_FLOORS.rowMin);
        out = { id, name: fullName, subject, scope, rule: opts.youFirst ? "The tracker, then the three other brands in analysis picked most (a card draws those with 3 picks at least)." : "Every brand in analysis picked in 3 answers at least, most picks first, ties by name.", members, extras: { base: rows.filter((f) => f.pick.state === "in_analysis").length } };
        break;
      }
      case "vendors": {
        // The AI companies with `min` answers in the scope, by name.
        const by = new Map<string, number>();
        for (const f of rows) by.set(f.engine.vendor, (by.get(f.engine.vendor) ?? 0) + 1);
        const members = [...by.entries()].filter(([, n]) => n >= (opts.min ?? 3)).map(([v, n]) => ({ key: v, name: v, count: n })).sort((a, b) => a.name.localeCompare(b.name));
        out = { id, name: fullName, subject, scope, rule: `The AI companies with ${opts.min ?? 3} answers at least in the scope, by name.`, members, extras: {} };
        break;
      }
      case "first_rec": {
        // Of the answers suggesting another brand (rec:anyother), the brand each suggests first; most first, ties by
        // name, top `top`.
        const pr = slicePred("rec:anyother", set);
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rows) {
          if (!pr(f)) continue;
          const xs = f.brands.filter((b) => b.key !== T && b.recommended && b.bucket !== "outside_category").map((b) => ({ b, o: b.mentioned ? b.order : 1000 + b.order })).sort((a, b) => a.o - b.o);
          const b = xs[0]?.b;
          if (!b) continue;
          const t = by.get(b.key) ?? { name: b.name, ids: new Set<string>() };
          t.ids.add(f.responseId);
          by.set(b.key, t);
        }
        out = { id, name: fullName, subject, scope, rule: "Of the answers that suggest another brand, the brand each suggests first; most first, ties by name.", members: rank(by).slice(0, opts.top ?? 4), extras: { base: rows.filter(pr).length } };
        break;
      }
      case "suggested": {
        // The other brands the answers suggest (recommended, a pick counting - ruling 6; in the category), 3 answers at
        // least, most first, ties by name, top five (the Habit card's "Which brands it suggests instead").
        const by = tally(rows, (f) => f.brands.filter((b) => b.key !== T && b.recommended && b.bucket !== "outside_category").map((b) => ({ key: b.key, name: b.name })));
        out = { id, name: fullName, subject, scope, rule: "The other brands the answers suggest (recommended, a pick counting), 3 answers at least, most first, ties by name, top five.", members: rank(by).filter((m) => m.count >= SEL_FLOORS.rowMin).slice(0, SEL_FLOORS.compTop), extras: {} };
        break;
      }
      case "ends": {
        // Who a Premium vs basic answer gives as the example of one end: the products its rules choosing that end name -
        // a brand in the category by its entry (the tracker as "You"), any other name as written (descriptions of an
        // end left out; plural endings and name variants one row). 3 answers at least, most first, ties by name, top 5.
        const choice = opts.choice ?? "premium";
        const items = endItems(rows, choice, set, data?.project.category ?? "");
        out = { id, name: fullName, subject, scope, rule: `The names a rule choosing ${choice} gives as its product: brands in the category by entry, other names as written (variants one row); 3 answers at least, most first, top five.`, members: items.filter((m) => m.count >= SEL_FLOORS.rowMin).slice(0, 5), extras: {} };
        break;
      }
      case "sent_brands":
      case "instead_brands": {
        // The doubt cards' competitor lists (nothing is picked there, so the ratified group does not apply): the brands
        // in analysis the answers send the buyer to (destinations) or, on a price question, the rivals it recommends
        // instead (ruling 3) - ruling 8: a brand outside of analysis is never listed; class brands are kept (a worry
        // can send the buyer to one). 3 answers at least, most first, ties by name, top five.
        const by = tally(rows, (f) => (name === "sent_brands" ? (f.sent?.brands ?? []) : (f.price?.rivals ?? [])).filter((b) => b.key !== T).map((b) => ({ key: b.key, name: b.name })));
        const members = rank(by).filter((m) => m.count >= SEL_FLOORS.rowMin).slice(0, SEL_FLOORS.compTop);
        out = {
          id,
          name: fullName,
          subject,
          scope,
          rule: name === "sent_brands" ? "The brands in analysis the answers send the buyer to, 3 answers at least, most first, ties by name, top five." : "The brands in analysis a price answer recommends instead, 3 answers at least, most first, ties by name, top five.",
          members,
          extras: {},
        };
        break;
      }
      case "first_sent": {
        // Of the answers that send the buyer to a brand in analysis, the one each names first; most first, ties by name.
        const by = new Map<string, { name: string; ids: Set<string> }>();
        let base = 0;
        for (const f of rows) {
          const x = firstSentOf(f);
          if (!x) continue;
          base++;
          const t = by.get(x.key) ?? { name: x.name, ids: new Set<string>() };
          t.ids.add(f.responseId);
          by.set(x.key, t);
        }
        out = { id, name: fullName, subject, scope, rule: "Of the answers that send the buyer to a brand in analysis, the brand each names first; most first, ties by name.", members: rank(by).slice(0, opts.top ?? 4), extras: { base } };
        break;
      }
      case "sent_products":
      case "sent_own_products":
      case "instead_products":
      case "own_options": {
        // Product lists of the doubt cards, on the run's one product grouping (ruling 15): the rivals' products the
        // answers send the buyer to (full names - the list crosses brands), the tracker's own products named there, the
        // rival products a price answer recommends instead (full names), the tracker's own cheaper options (short
        // names). Counted by answers, most first, ties by name (a card draws those with 3 answers at least).
        const own = name === "sent_own_products" || name === "own_options";
        const of = name === "instead_products" ? insteadProductsOf : name === "own_options" ? ownOptionProductsOf : sentProductsOf;
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rows)
          for (const pid of of(f, set)) {
            const p = set.products!.get(pid)!;
            if ((p.key === T) !== own) continue;
            const t = by.get(pid) ?? { name: own ? p.short : p.full, ids: new Set<string>() };
            t.ids.add(f.responseId);
            by.set(pid, t);
          }
        out = { id, name: fullName, subject, scope, rule: `${own ? "The tracker's" : "Rival"} products (the run's one product grouping) ${name === "own_options" ? "a price answer points to as its own cheaper option" : name === "instead_products" ? "a price answer recommends instead" : "the answers send the buyer to"}: most answers first, ties by name (a card draws those with 3 answers at least).`, members: rank(by).slice(0, opts.top ?? 4), extras: { base: rows.length } };
        break;
      }
      case "worries": {
        // The worries the scope's answers are about, each with `min` answers in the scope at least, by name.
        const by = new Map<string, number>();
        for (const f of rows) if (f.worry) by.set(f.worry, (by.get(f.worry) ?? 0) + 1);
        const members = [...by.entries()].filter(([, n]) => n >= (opts.min ?? SEL_FLOORS.argsMin)).map(([w, n]) => ({ key: w, name: w, count: n })).sort((a, b) => a.name.localeCompare(b.name));
        out = { id, name: fullName, subject, scope, rule: `The worries the answers are about, each with ${opts.min ?? SEL_FLOORS.argsMin} answers at least in the scope, by name.`, members, extras: {} };
        break;
      }
      case "price_lines": {
        // The price lines the scope's answers were asked about (the bare brand when no line), most answers first, ties
        // by name.
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rows) {
          const l = f.line ?? set.target.name;
          const t = by.get(l) ?? { name: l, ids: new Set<string>() };
          t.ids.add(f.responseId);
          by.set(l, t);
        }
        out = { id, name: fullName, subject, scope, rule: "The price lines the answers were asked about (the bare brand when none), most answers first, ties by name.", members: rank(by), extras: {} };
        break;
      }
      case "visibility_brands": {
        // Every brand in analysis named or picked in the scope (class brands out); the subject and the tracker always.
        const key = subjKey(subject);
        const cls = classKeysOf(set);
        const names = new Map<string, string>();
        for (const f of rows) for (const b of f.brands) if (b.bucket === "in_analysis") names.set(b.key, b.key === T ? set.target.name : b.name);
        const n = rows.length;
        const fk = (m: string, k: string) => book.fact(m, k === T ? "you" : k, scope);
        const named = (k: string) => fk("named", k).k / Math.max(1, n);
        const share = (k: string) => {
          const x = fk("share_of_picks", k);
          return x.n ? x.k / x.n : 0;
        };
        const recK = (k: string) => fk("recommended", k).k;
        const keepAlways = (k: string) => k === key || k === T;
        const regs = [...names.keys()].filter((k) => !cls.has(k) && (keepAlways(k) || named(k) >= SEL_FLOORS.visNamed || share(k) >= SEL_FLOORS.visShare));
        const small = (k: string) => share(k) < SEL_FLOORS.visSmallShare && named(k) < SEL_FLOORS.visSmallNamed;
        const placed = regs.filter((k) => recK(k) >= SEL_FLOORS.visReadableRec && (keepAlways(k) || !small(k)));
        const folded = regs.filter((k) => !placed.includes(k));
        const byNamed = (xs: string[]) => [...xs].sort((a, b) => fk("named", b).k - fk("named", a).k || names.get(a)!.localeCompare(names.get(b)!));
        out = {
          id,
          name: fullName,
          subject,
          scope,
          rule: "Brands in analysis named in 10%+ of answers or holding 1%+ of the picks (class brands out; the subject and the tracker always); placed when recommended in 20+ answers and not small (under 2% of the picks and under 30% named) - the rest folded into one note; most named first.",
          members: byNamed(placed).map((k) => ({ key: k, name: names.get(k)!, count: fk("named", k).k })),
          extras: { folded: byNamed(folded).map((k) => ({ key: k, name: names.get(k)! })) },
        };
        break;
      }
      case "topics_shown": {
        // The topics a card lists (Spotting the problem, Learning the category): raised in `floor` answers at least,
        // most raised first (ties by name), a topic in 90% of the answers whose name the question says left out, top
        // `top`.
        const by = new Map<string, number>();
        for (const f of rows) for (const a of new Set(f.args ?? [])) by.set(a, (by.get(a) ?? 0) + 1);
        const ranked = [...by.entries()]
          .filter(([, k]) => k >= (opts.floor ?? 0))
          .map(([code, k]) => ({ code, k, share: rows.length ? k / rows.length : 0 }))
          .sort((a, b) => b.k - a.k || a.code.localeCompare(b.code));
        const kept = filterObvious(ranked, id, opts.list ?? "topics", wordingsOf(rows), new Map(), "", undefined).slice(0, opts.top ?? 6);
        out = { id, name: fullName, subject, scope, rule: `The topics the answers raise most (${opts.floor ?? 0} answers at least, ties by name), a topic in 90% or more of the answers whose name the question says left out; top ${opts.top ?? 6}.`, members: kept.map((x) => ({ key: x.code, name: x.code, count: x.k })), extras: {} };
        break;
      }
      case "arg_lift": {
        // The arguments that come up more when the subject is the pick than when another brand in analysis is
        // (ruling 2), with both sides' counts. "summary": both sides 20 answers carrying arguments at least, and an
        // argument raised in 2% of them (the brand summary's floors); "local": no floor (the card checks its sides).
        const key = subjKey(subject);
        const withA = rows.filter((f) => f.args !== null);
        const wins = withA.filter((f) => f.pick.state === "in_analysis" && f.pick.key === key);
        const others = withA.filter((f) => f.pick.state === "in_analysis" && f.pick.key !== key);
        const count = (rs: Fact[], code: string) => rs.filter((f) => f.args!.includes(code)).length;
        let codes: string[] = [];
        if (opts.lift === "summary") {
          if (wins.length >= 20 && others.length >= 20) {
            const by = new Map<string, number>();
            for (const f of withA) for (const a of f.args!) by.set(a, (by.get(a) ?? 0) + 1);
            codes = [...by.entries()].filter(([, k]) => k / withA.length >= 0.02).map(([c]) => c);
          }
        } else codes = [...new Set([...wins, ...others].flatMap((f) => f.args!))];
        const members = codes
          .map((code) => {
            const w = { k: count(wins, code), n: wins.length };
            const o = { k: count(others, code), n: others.length };
            return { key: code, name: code, count: w.k, wins: w, others: o, lift: (w.n ? w.k / w.n : 0) - (o.n ? o.k / o.n : 0) };
          })
          .sort((a, b) => b.lift - a.lift || a.key.localeCompare(b.key));
        out = { id, name: fullName, subject, scope, rule: `Every argument, with how often it comes up when the brand is the pick and when another brand in analysis is (ruling 2)${opts.lift === "summary" ? "; both sides 20 answers at least, and an argument in 2% of the answers" : ""}; largest lift first.`, members, extras: { base: wins.length } };
        break;
      }
      case "sent_all":
      case "sent_outside": {
        // Question type detail: where the answers send the buyer - every brand in analysis (sent_all, by entry) or every
        // name outside of analysis or the category (sent_outside, as written); most first (ties by name), top `top`
        // (0 = every one).
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rows) {
          // Outside names by the dictionary's name where it places them (an entry outside of analysis, ruled out or
          // pending), else as written.
          const xs = name === "sent_all" ? (f.sent?.brands ?? []).map((b) => ({ key: b.key, name: b.name })) : (f.sent?.outside ?? []).map((w) => set.resolve(w)).map((r) => ({ key: r.key, name: r.name.trim() }));
          for (const x of xs) {
            if (!x.name) continue;
            const t0 = by.get(x.key) ?? { name: x.name, ids: new Set<string>() };
            t0.ids.add(f.responseId);
            by.set(x.key, t0);
          }
        }
        const list = rank(by);
        out = { id, name: fullName, subject, scope, rule: name === "sent_all" ? "Every brand in analysis the answers send the buyer to, most first, ties by name." : "Every name outside of analysis or the category the answers send the buyer to (the dictionary's name where it places one, else as written), most first, ties by name.", members: opts.top ? list.slice(0, opts.top) : list, extras: { base: rows.length } };
        break;
      }
      case "rec_brands": {
        // Question type detail: the brands in analysis the scope's answers (or a slice of them) recommend (a pick
        // counting - ruling 6): `floor` answers at least, most first (ties by name); the tracker left out, or (youFirst)
        // first; top `top` (0 = every one).
        const rs = opts.slice ? rows.filter(slicePred(opts.slice, set)) : rows;
        const list = rank(tally(rs, (f) => f.brands.filter((b) => b.bucket === "in_analysis" && b.recommended).map((b) => ({ key: b.key, name: b.key === T ? set.target.name : b.name })))).filter((m) => m.count >= (opts.floor ?? 0));
        const you = list.filter((m) => m.key === T);
        const all0 = opts.rankYou ? list : [...(opts.youFirst ? you : []), ...list.filter((m) => m.key !== T)];
        const members = opts.top ? all0.slice(0, opts.top) : all0;
        out = { id, name: fullName, subject, scope, rule: `The brands in analysis the answers recommend, a pick counting (${opts.floor ?? 0} answers at least), ${opts.youFirst ? "the tracker first, then " : "the tracker left out, "}most first, ties by name${opts.top ? `; top ${opts.top}` : ""}.`, members, extras: { base: rs.length } };
        break;
      }
      case "arg_rank": {
        // Question type detail: the arguments or topics the scope's answers (or a slice of them) raise, most first (ties by
        // code), `floor` answers at least, top `top` (0 = every one). No code is left out for being obvious.
        const rs = opts.slice ? rows.filter(slicePred(opts.slice, set)) : rows;
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rs)
          for (const a of new Set(f.args ?? [])) {
            const t0 = by.get(a) ?? { name: a, ids: new Set<string>() };
            t0.ids.add(f.responseId);
            by.set(a, t0);
          }
        const list = [...by.entries()].map(([key, x]) => ({ key, name: x.name, count: x.ids.size })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).filter((m) => m.count >= (opts.floor ?? 0));
        out = { id, name: fullName, subject, scope, rule: `The arguments or topics the answers raise, ${opts.floor ?? 0} answers at least, most first (ties by code)${opts.top ? `; top ${opts.top}` : ""}.`, members: opts.top ? list.slice(0, opts.top) : list, extras: { base: rs.length } };
        break;
      }
      case "out_names": {
        // Question type detail: the names, as written, of the picks outside the category (or, with `slice`, of the picks
        // in that slice), most first (ties by name), top `top` (0 = every one).
        const rs = rows.filter(slicePred(opts.slice ?? "pick:outside_category", set));
        const by = new Map<string, { name: string; ids: Set<string> }>();
        for (const f of rs) {
          // The dictionary's name where it places the pick (a ruled-out or pending entry), else as written.
          const nm = f.pick.name ?? f.pick.written ?? "";
          if (!nm) continue;
          const t0 = by.get(nm) ?? { name: nm, ids: new Set<string>() };
          t0.ids.add(f.responseId);
          by.set(nm, t0);
        }
        const list = rank(by);
        out = { id, name: fullName, subject, scope, rule: `The names of the picks outside the category (the dictionary's name where it places one, else as written), most first (ties by name)${opts.top ? `; top ${opts.top}` : ""}.`, members: opts.top ? list.slice(0, opts.top) : list, extras: { base: rs.length } };
        break;
      }
      case "quote_groups": {
        // Question type detail's "how they solve it": the groups the adjacent-routed answers' quotes fall in (the run's
        // saved grouping, attached by type_detail.ts), each named by its most quoted wording (ties: the shorter); groups
        // of two answers or more, most first (ties by name), top `top` (8).
        const ctx = opts.ctx ?? "";
        const rs = rows.filter((f) => f.verdicts.category_routed === "adjacent" && !!f.qgroups?.[ctx]);
        const by = new Map<string, { ids: Set<string>; said: Map<string, number> }>();
        for (const f of rs) {
          const gk = f.qgroups![ctx]!;
          const g = by.get(gk) ?? { ids: new Set<string>(), said: new Map<string, number>() };
          g.ids.add(f.responseId);
          const q = cleanQuote(f.quote ?? "");
          g.said.set(q, (g.said.get(q) ?? 0) + 1);
          by.set(gk, g);
        }
        const list = [...by.entries()]
          .map(([key, g]) => ({ key, name: [...g.said.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0], count: g.ids.size }))
          .filter((m) => m.count > 1)
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        out = { id, name: fullName, subject, scope, rule: "The groups the adjacent-routed answers' quotes fall in, named by their most quoted wording; two answers at least, most first, top eight.", members: list.slice(0, opts.top ?? 8), extras: { base: rs.length } };
        break;
      }
      case "named_brands": {
        // The brands in analysis the scope's answers (or a slice of them) name: `floor` answers at least, most first
        // (ties by name); the tracker left out, or (youFirst) first; top `top`.
        const rs = opts.slice ? rows.filter(slicePred(opts.slice, set)) : rows;
        const list = rank(tally(rs, (f) => f.brands.filter((b) => b.bucket === "in_analysis").map((b) => ({ key: b.key, name: b.key === T ? set.target.name : b.name })))).filter((m) => m.count >= (opts.floor ?? 0));
        const you = list.filter((m) => m.key === T);
        const members = (opts.rankYou ? list : [...(opts.youFirst ? you : []), ...list.filter((m) => m.key !== T)]).slice(0, opts.top ?? 5);
        out = { id, name: fullName, subject, scope, rule: `The brands in analysis the answers name (${opts.floor ?? 0} answers at least), ${opts.youFirst ? "the tracker first, then " : "the tracker left out, "}most first, ties by name; top ${opts.top ?? 5}.`, members, extras: { base: rs.length } };
        break;
      }
      case "first_named": {
        // Per answer naming a brand in analysis, the one it names first; the tracker first (youFirst), then the others
        // most first (ties by name), top `top`.
        const by = new Map<string, { name: string; ids: Set<string> }>();
        let base = 0;
        for (const f of rows) {
          const b = f.brands.filter((x) => x.bucket === "in_analysis").sort((x, y) => x.order - y.order)[0];
          if (!b) continue;
          base++;
          const t = by.get(b.key) ?? { name: b.key === T ? set.target.name : b.name, ids: new Set<string>() };
          t.ids.add(f.responseId);
          by.set(b.key, t);
        }
        const list = rank(by);
        const members = [...(opts.youFirst ? list.filter((m) => m.key === T) : []), ...list.filter((m) => m.key !== T).slice(0, opts.top ?? 3)];
        out = { id, name: fullName, subject, scope, rule: "Of the answers naming a brand in analysis, the brand each names first: the tracker first, then the others most first, ties by name.", members, extras: { base } };
        break;
      }
      case "situations": {
        // The buying situations the scope's answers are asked for, each with `min` answers at least, by name.
        const by = new Map<string, number>();
        for (const f of rows) if (f.situation) by.set(f.situation, (by.get(f.situation) ?? 0) + 1);
        const members = [...by.entries()].filter(([, n]) => n >= (opts.min ?? 1)).map(([w, n]) => ({ key: w, name: w, count: n })).sort((a, b) => a.name.localeCompare(b.name));
        out = { id, name: fullName, subject, scope, rule: `The buying situations the answers are asked for, each with ${opts.min ?? 1} answers at least, by name.`, members, extras: {} };
        break;
      }
      case "question_types": {
        // The question types in the scope with `min` answers at least.
        const by = new Map<string, number>();
        for (const f of rows) by.set(f.type, (by.get(f.type) ?? 0) + 1);
        const members = [...by.entries()].filter(([, n]) => n >= (opts.min ?? 1)).map(([w, n]) => ({ key: w, name: w, count: n })).sort((a, b) => a.name.localeCompare(b.name));
        out = { id, name: fullName, subject, scope, rule: `The question types in the scope with ${opts.min ?? 1} answers at least, by name.`, members, extras: {} };
        break;
      }
      case "redirect_dests": {
        // Where the answers in a slice send the customer instead: brands in analysis by their entry (ruling 8: never one
        // outside of analysis), any other name as written (case set aside); the tracker's own products left out; most
        // first, ties by name; top `top`.
        const rs = opts.slice ? rows.filter(slicePred(opts.slice, set)) : rows;
        const by = new Map<string, { name: string; ids: Set<string> }>();
        const put = (k: string, name: string, f: Fact) => {
          const t = by.get(k) ?? { name, ids: new Set<string>() };
          t.ids.add(f.responseId);
          by.set(k, t);
        };
        for (const f of rs) {
          for (const b of f.sent?.brands ?? []) put(b.key, b.name, f);
          for (const w of f.sent?.outside ?? []) {
            if (set.resolve(w).status === "active") continue;
            const name = w.trim();
            if (name) put(`~s:${encodeURIComponent(name.toLowerCase())}`, name, f);
          }
        }
        out = { id, name: fullName, subject, scope, rule: "Where the answers send the customer instead: brands in analysis by entry, other names as written (case set aside), the tracker's own products left out; most first, ties by name.", members: rank(by).slice(0, opts.top ?? 4), extras: { base: rs.length } };
        break;
      }
      case "pairings":
      case "first_pairing": {
        // What the AI names to use alongside (an ecosystem answer's pairings): a brand in analysis by its entry, any other
        // name grouped as written (case and punctuation set aside; a name whose words sit inside exactly one larger
        // written group joins it); never the tracker's bare name, never a generic word written all in lower case, never a
        // brand outside of analysis (ruling 8). "pairings": every pairing an answer names; "first_pairing": the first
        // one it names. Most answers first, ties by name; `floor` answers at least; top `top`.
        const first = name === "first_pairing";
        type G = { forms: Map<string, number>; ids: Set<string>; toks: Set<string>; key: string | null };
        const groups = new Map<string, G>();
        let base = 0;
        for (const f of rows) {
          const ps = (f.pairings ?? []).filter((p) => p.name.trim());
          if (!ps.length) continue;
          base++;
          for (const p of first ? ps.slice(0, 1) : ps) {
            const nm = p.name.trim();
            if (!pairingCounts(p, set)) continue;
            // The first-named list is product names: a brand in analysis's product by the run's one grouping (ruling 15).
            const pid = first ? pairingProduct(p, set) : null;
            const k = pid ? `p:${pid}` : !first && p.bucket === "in_analysis" && p.key ? `d:${p.key}` : `w:${writtenKey(nm)}`;
            const g = groups.get(k) ?? { forms: new Map<string, number>(), ids: new Set<string>(), toks: new Set(famTokens(nm)), key: pid ?? (p.bucket === "in_analysis" ? p.key : null) };
            g.forms.set(nm, (g.forms.get(nm) ?? 0) + 1);
            g.ids.add(f.responseId);
            groups.set(k, g);
          }
        }
        const small = [...groups.keys()].filter((k) => k.startsWith("w:")).sort((a, b) => groups.get(a)!.toks.size - groups.get(b)!.toks.size);
        for (const k of small) {
          const g = groups.get(k)!;
          if (!g.toks.size) continue;
          const sup = [...groups.entries()].filter(([k2, g2]) => k2 !== k && k2.startsWith("w:") && g2.toks.size > g.toks.size && [...g.toks].every((t) => g2.toks.has(t)));
          if (sup.length !== 1) continue;
          const into = sup[0][1];
          for (const [fm, n] of g.forms) into.forms.set(fm, (into.forms.get(fm) ?? 0) + n);
          for (const id2 of g.ids) into.ids.add(id2);
          groups.delete(k);
        }
        const members = [...groups.entries()]
          .map(([k, g]) => ({
            key: k.startsWith("d:") ? `d:${g.key}` : k.startsWith("p:") ? k : formsKey([...g.forms.keys()]),
            name: k.startsWith("d:") ? set.nameOf(g.key!) : k.startsWith("p:") ? set.products!.get(g.key!)!.full : [...g.forms.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0][0],
            count: g.ids.size,
          }))
          .filter((m) => m.count >= (opts.floor ?? 0))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
          .slice(0, opts.top ?? 6);
        out = { id, name: fullName, subject, scope, rule: `${first ? "The first product each answer names to use alongside" : "The products the answers name to use alongside"}: a brand in analysis by entry, other names grouped as written (a name inside exactly one larger name joins it); never the tracker's bare name, a generic word in lower case or a brand outside of analysis; most first, ties by name.`, members, extras: { base } };
        break;
      }
      case "cond_cards": {
        // The products a condition row's statements name (the alongside card's destinations), grouped by their words:
        // among the row's answers naming a product, 2 answers and 15% of them at least, most first (ties by the words),
        // top 3; each shown in the form most written.
        const units = new Set(opts.units ?? []);
        const by = new Map<string, { ids: Set<string>; forms: Map<string, number> }>();
        let routed = 0;
        for (const f of rows) {
          const cs = [...new Set((f.conds ?? []).filter((c) => units.has(c.unit)).flatMap((c) => c.cards.filter((x) => x.trim())))];
          if (!cs.length) continue;
          routed++;
          const seen = new Set<string>();
          for (const c of cs) {
            const k = writtenKey(c);
            const t = by.get(k) ?? { ids: new Set<string>(), forms: new Map<string, number>() };
            t.forms.set(c.trim(), (t.forms.get(c.trim()) ?? 0) + 1);
            if (!seen.has(k)) t.ids.add(f.responseId);
            seen.add(k);
            by.set(k, t);
          }
        }
        const members = [...by.entries()]
          .filter(([, t]) => t.ids.size >= 2 && t.ids.size / Math.max(1, routed) >= 0.15)
          .sort((a, b) => b[1].ids.size - a[1].ids.size || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([k, t]) => ({ key: k, name: [...t.forms.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0], count: t.ids.size }));
        out = { id, name: fullName, subject, scope, rule: "The products a condition row's statements name, among the row's answers naming one: 2 answers and 15% of them at least, most first, top 3, each in its most written form.", members, extras: { base: routed } };
        break;
      }
      case "case_args": {
        // What a strong answer argues (business case, answering a critic): arguments raised in at least 10% of the strong
        // answers (and in `minK` of them); with 10+ answers to set them against, only those at least 10 points more common
        // in the strong answers; most raised in the strong answers first (ties by name); a topic in 90% of all the
        // answers whose name the question (or its quoted criticism) says left out; top 5.
        const S = rows.filter(slicePred(opts.strong ?? "v:case_strength:strong", set));
        const O = rows.filter(slicePred(opts.rest ?? "!v:case_strength:strong", set));
        const gapOn = O.length >= 10;
        const hit = (rs: Fact[], code: string) => rs.filter((f) => (f.args ?? []).includes(code)).length;
        const codes = new Set<string>();
        for (const f of S) for (const c of f.args ?? []) codes.add(c);
        const ranked = [...codes]
          .map((code) => ({ code, s: S.length ? hit(S, code) / S.length : 0, hd: gapOn ? hit(O, code) / O.length : 0, share: rows.length ? hit(rows, code) / rows.length : 0, k: hit(S, code) }))
          .filter((x) => x.k >= (opts.minK ?? 0) && x.s >= 0.1 && (!gapOn || x.s - x.hd >= 0.1))
          .sort((a, b) => b.s - a.s || a.code.localeCompare(b.code));
        let wording = wordingsOf(rows);
        if (opts.critic && data) {
          const ci = new Set(rows.map((f) => f.intentId));
          const extra = data.intents.filter((i) => ci.has(i.id) && i.stage === "advocacy" && i.concern?.trim()).map((i) => i.concern!.trim());
          if (extra.length) wording = wordingIndex([...data.prompts.filter((p) => p.intent_id && ci.has(p.intent_id) && !p.staged && !p.retired).map((p) => p.text), ...data.intents.filter((i) => ci.has(i.id)).map((i) => i.text), ...extra]);
        }
        const all = filterObvious(ranked, id, "case", wording, new Map(), "", undefined);
        const kept = all.slice(0, 5);
        out = { id, name: fullName, subject, scope, rule: "Arguments raised in 10%+ of the strong answers (and in the fewest strong answers a topic needs), 10+ points more common there than in the answers they are set against (when 10+), most raised first; a topic in 90% of the answers whose name the question says left out; top 5.", members: kept.map((x) => ({ key: x.code, name: x.code, count: x.k })), extras: { base: S.length, versus: gapOn, folded: all.length < ranked.length ? [{ key: "~removed", name: "~removed" }] : [] } };
        break;
      }
      case "adjacent_names": {
        // The names an answer that points the buyer outside the category recommends there: names framed recommended that
        // are no brand in the category, most first (ties by name), top 5.
        const rs = rows.filter((f) => f.verdicts.category_routed === "adjacent");
        const by = tally(rs, (f) => f.brands.filter((b) => b.framedRecommended && b.bucket === "outside_category").map((b) => ({ key: b.key, name: b.name })));
        out = { id, name: fullName, subject, scope, rule: "Of the answers pointing the buyer to something adjacent, the names framed recommended that are no brand in the category; most first, ties by name; top 5.", members: rank(by).slice(0, 5), extras: { base: rs.length } };
        break;
      }
      case "pick_args_diff": {
        // A rival's own page: the arguments that come up more when the AI picks the rival than when it picks you (two),
        // and more when it picks you (two) - each raised in 3+ answers picking one of you; both of you picked 5+ times.
        const key = subjKey(subject);
        const t = rows.filter((f) => f.args !== null && f.pick.state === "in_analysis" && f.pick.key === key);
        const m = rows.filter((f) => f.args !== null && f.pick.state === "in_analysis" && f.pick.key === T);
        let members: SelMember[] = [];
        if (t.length >= 5 && m.length >= 5) {
          const codes = new Set<string>([...t, ...m].flatMap((f) => f.args!));
          const of = (rs: Fact[], c: string) => rs.filter((f) => f.args!.includes(c)).length;
          const scored = [...codes].map((c) => ({ c, a: of(t, c), b: of(m, c) })).filter((x) => x.a >= 3 || x.b >= 3).map((x) => ({ ...x, d: x.a / t.length - x.b / m.length }));
          const pick = [...scored.filter((x) => x.d > 0).sort((a, b) => b.d - a.d || a.c.localeCompare(b.c)).slice(0, 2), ...scored.filter((x) => x.d < 0).sort((a, b) => a.d - b.d || a.c.localeCompare(b.c)).slice(0, 2)];
          members = pick.map((x) => ({ key: x.c, name: x.c, count: x.a }));
        }
        out = { id, name: fullName, subject, scope, rule: "The two arguments most more common when the AI picks the brand than when it picks the tracker, then the two most more common the other way; each in 3+ answers; both picked 5+ times.", members, extras: {} };
        break;
      }
      case "price_worries": {
        // The worries about the price: a worry whose wording names money (PRICE_WORRY - generic words, never a
        // category's), in the worries cards' order - the question type (buyers' worries, then customers' worries, then
        // the renewal), then the worry's answers (most first), then its wording.
        for (const t of scope.types) if (!["objections", "churn_triggers", "renewal"].includes(t)) throw new Error(`selection "price_worries": worries are asked on worry questions only, not "${t}"`);
        const by = new Map<string, { n: number; stage: number }>();
        for (const f of rows) {
          if (!f.worry) continue;
          const st = WORRY_STAGES.indexOf(f.type);
          const t = by.get(f.worry) ?? { n: 0, stage: st };
          t.n++;
          t.stage = Math.min(t.stage, st);
          by.set(f.worry, t);
        }
        const members = [...by.entries()]
          .filter(([w]) => PRICE_WORRY.test(w))
          .map(([w, x]) => ({ key: w, name: w, count: x.n, stage: x.stage }))
          .sort((a, b) => a.stage - b.stage || b.count - a.count || a.name.localeCompare(b.name))
          .map(({ stage: _s, ...m }) => (void _s, m));
        out = { id, name: fullName, subject, scope, rule: PRICE_WORRY_RULE, members, extras: {} };
        break;
      }
      case "converts_better": {
        // The brands in analysis (the subject out) recommended in `min` answers at least whose recommendations end as the
        // pick more often than the subject's; the best converter first (ties by name); top `top`.
        const key = subjKey(subject);
        const names = new Map<string, string>();
        for (const f of rows) for (const b of f.brands) if (b.bucket === "in_analysis" && b.key !== key) names.set(b.key, b.key === T ? set.target.name : b.name);
        const fk = (m: string, k: string) => book.fact(m, k === T ? "you" : k, scope);
        const conv = (k: string) => {
          const x = fk("converts", k);
          return x.n ? x.k / x.n : 0;
        };
        const mine = conv(key);
        const min = opts.min ?? SEL_FLOORS.visReadableRec;
        const members = [...names.keys()]
          .filter((k) => fk("recommended", k).k >= min && conv(k) > mine)
          .map((k) => ({ key: k, name: names.get(k)!, count: fk("converts", k).k, rate: conv(k) }))
          .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name))
          .slice(0, opts.top ?? 3)
          .map(({ rate: _r, ...m }) => (void _r, m));
        out = { id, name: fullName, subject, scope, rule: `The brands in analysis other than the subject recommended in ${min} answers at least whose recommendations end as the pick more often than the subject's; the best converter first, ties by name; top ${opts.top ?? 3}.`, members, extras: {} };
        break;
      }
      default:
        throw new Error(`fact layer: no selection "${name}"`);
    }
    const typed = out as AnySelection;
    memo.set(id, typed);
    return typed;
  }
  return { selection };
}

export type SelectionBook = ReturnType<typeof selectionBook>;

/** The measure a pooled average is legal for (the measure book's own check, for callers). */
export const averageMeasure = (id: string, types: readonly QuestionType[]) => {
  const m = MEASURE_BY_ID.get(id);
  if (!m) throw new Error(`fact layer: no measure "${id}"`);
  for (const t of types) if (!m.legal.includes(t)) throw new Error(`average competitor: measure "${id}" is not legal on "${t}"`);
  return m;
};

/**
 * A selection recomputed from its id alone (for a proof): the name, its parameters, the subject and the scope are read
 * back from the id and the selection is computed afresh from the book. Throws when the id is not one this reads.
 */
export function selectionFromId(sb: SelectionBook, id: string): AnySelection {
  const q = parseSelectionId(id);
  if (q) return sb.selection(q.name, q.subject, q.scope, q.opts);
  if (!id.startsWith("sel:")) throw new Error(`not a selection id: ${id}`);
  const body = id.slice(4);
  const bar = body.indexOf("|");
  const full = body.slice(0, bar);
  const rest = body.slice(bar + 1);
  const t0 = rest.indexOf("|t=");
  const subject = rest.slice(0, t0);
  const scope = scopeFromKey(rest.slice(t0 + 1));
  const tilde = full.indexOf("~");
  const name = tilde >= 0 ? full.slice(0, tilde) : full;
  const param = tilde >= 0 ? full.slice(tilde + 1) : "";
  const opts: SelectionOpts = {};
  switch (name) {
    case "worries":
    case "vendors":
      opts.min = Number(param);
      break;
    case "converts_better": {
      const [min, top] = param.split(":");
      opts.min = Number(min);
      opts.top = Number(top);
      break;
    }
    case "first_rec":
    case "first_sent":
    case "sent_products":
    case "sent_own_products":
    case "instead_products":
    case "own_options":
      opts.top = Number(param);
      break;
    case "product_picks":
    case "product_names":
    case "product_first":
    case "product_suggested": {
      const [b, t] = param.split(":");
      opts.brand = b;
      opts.top = Number(t);
      break;
    }
    case "pick_brands": {
      const [who, top, x] = param.split(":");
      opts.youFirst = who === "you";
      opts.top = Number(top);
      if (x?.startsWith("x")) opts.exclude = x.slice(1).split(",");
      break;
    }
    case "ends":
      opts.choice = param;
      break;
    case "cond_destinations":
    case "cond_products": {
      let r = param;
      if (r.endsWith(":named")) {
        opts.named = true;
        r = r.slice(0, -6);
      }
      const ti = r.indexOf(">to:");
      if (ti >= 0) {
        opts.to = r.slice(ti + 4);
        r = r.slice(0, ti);
      }
      opts.units = r ? r.split("+") : [];
      break;
    }
    case "conditions_shown": {
      const m = param.match(/^(toward|away):([a-z]+)(.*)$/);
      if (!m) throw new Error(`selection ${id} cannot be read back`);
      opts.side = m[1] as "toward" | "away";
      opts.flavor = m[2] as CondFlavor;
      let r = m[3];
      if (r.endsWith(":own")) {
        opts.ownSplit = true;
        r = r.slice(0, -4);
      }
      const ti = r.indexOf(">to:");
      if (ti >= 0) {
        opts.to = r.slice(ti + 4);
        r = r.slice(0, ti);
      }
      if (r.startsWith("@")) opts.towardOnly = r.slice(1);
      break;
    }
    case "weighs_shown": {
      const last = param.lastIndexOf(":");
      const mid = param.lastIndexOf(":", last - 1);
      opts.sides = JSON.parse(param.slice(0, mid));
      opts.top = Number(param.slice(mid + 1, last));
      opts.list = param.slice(last + 1) as OmissionList;
      break;
    }
  }
  const sel = sb.selection(name, subject, scope, opts);
  if (sel.id !== id) throw new Error(`selection ${id} recomputes under ${sel.id}`);
  return sel;
}
