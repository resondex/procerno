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
import { slicePred } from "./slices";

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

function competitorsRatified(set: AnswerFactSet, rows: Fact[], scope: Scope): { members: SelMember[]; extras: CompetitorExtras } {
  for (const t of scope.types) if (!PICK_TYPES.includes(t)) throw new Error(`selection "competitors" (ratified): ranks by picks, and question type "${t}" takes no picks - refused (use mode "as_cards" for today's card)`);
  const T = set.target.key;
  const cls = classKeysOf(set);
  const inPick = rows.filter((f) => f.pick.state === "in_analysis");
  const picks = new Map<string, number>();
  for (const f of inPick) picks.set(f.pick.key!, (picks.get(f.pick.key!) ?? 0) + 1);
  const named = new Map<string, number>();
  const names = new Map<string, string>();
  for (const f of rows)
    for (const b of f.brands)
      if (b.bucket === "in_analysis") {
        named.set(b.key, (named.get(b.key) ?? 0) + 1);
        names.set(b.key, b.name);
      }
  const pk = (k: string) => picks.get(k) ?? 0;
  const byPicks = (a: { key: string; name: string }, b: { key: string; name: string }) => pk(b.key) - pk(a.key) || a.name.localeCompare(b.name);
  // A rival being left (a switching cell) is the question's own brand, never one of its competitors.
  const leaving = scope.types.length === 1 && scope.types[0] === "switching" ? scope.rival : undefined;
  const rivals = [...names.entries()].map(([key, name]) => ({ key, name })).filter((b) => b.key !== T && !cls.has(b.key) && b.key !== leaving && pk(b.key) > 0);
  const top = rivals.sort(byPicks).slice(0, SEL_FLOORS.ratifiedTop);
  const listed: SelMember[] = top.map((b) => ({ key: b.key, name: b.name, count: pk(b.key) }));
  const h2h = headToHeadKeysOf(set)
    .filter((b) => !listed.some((x) => x.key === b.key) && b.key !== leaving && !cls.has(b.key))
    .map((b) => ({ key: b.key, name: names.get(b.key) ?? set.nameOf(b.key) }))
    .sort(byPicks);
  for (const b of h2h) listed.push({ key: b.key, name: b.name, count: pk(b.key), headToHead: true });
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
  /** Every form in the row. */
  forms: string[];
  answers: Set<string>;
}

const PRODUCT_STOP = new Set(["the", "from", "by", "of", "a", "an", "and", "with", "for"]);
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
  return [...by.values()]
    .map((g) => ({ name: [...g.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0], key: g.key, forms: [...g.forms.keys()].sort(), answers: g.answers }))
    .sort((a, b) => b.answers.size - a.answers.size || a.name.localeCompare(b.name));
}

/* ------------------------------- conditions ------------------------------- */

/** Which saved grouping a card's condition rows read (conditions.ts): the run's themes (with the "elsewhere" groups
 * beside the away themes), the Map's grouping when the run has no themes, or the Premium vs basic card's tier rows. */
export type CondFlavor = "themed" | "map" | "tier";

export interface CondRow {
  /** The row's label (sentence case, as the cards print it). */
  label: string;
  /** The condition units the row counts (conditions.ts). */
  units: string[];
  /** Answers stating it (after the row's own filter). */
  count: number;
  /** The answers, for a proof. */
  answers: Set<string>;
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
function condSources(rows: Fact[], side: "toward" | "away", flavor: CondFlavor): Src[] {
  const ok = (u: string) => (flavor === "themed" ? u.startsWith(`t:${side}:`) || (side === "away" && u.startsWith("g:elsewhere:")) : u.startsWith(`${flavor === "map" ? "m" : "p"}:${side}:`));
  const label = new Map<string, string>();
  const said = new Map<string, Map<string, number>>();
  const ids = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const f of rows)
    for (const c of f.conds ?? []) {
      if (!ok(c.unit)) continue;
      if (!ids.has(c.unit)) {
        ids.set(c.unit, new Set());
        order.push(c.unit);
      }
      ids.get(c.unit)!.add(f.responseId);
      if (flavor === "themed") label.set(c.unit, c.label);
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
}

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
      name === "competitors" ? `~${opts.mode ?? "ratified"}${opts.mode === "as_cards" ? `:${opts.card}` : ""}` : name === "conditions_shown" ? `~${opts.side}:${opts.flavor}${opts.towardOnly ? `@${opts.towardOnly}` : ""}` : name === "weighs_shown" ? `~${JSON.stringify(opts.sides ?? [{}])}:${opts.top ?? 3}:${opts.list ?? "weighs"}` : "";
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
          const r = competitorsRatified(set, rows, scope);
          out = { id, name: fullName, subject, scope, rule: RATIFIED_COMPETITORS_RULE, members: r.members, extras: r.extras };
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
        let t = condSources(rows, "toward", flavor);
        let a = condSources(rows, "away", flavor);
        // The same condition on both sides under near-identical names: one label, the larger side's.
        const tBy = new Map<string, Src>();
        for (const x of t) if (condCore(x.label)) tBy.set(condCore(x.label), x);
        t = t.map((x) => ({ ...x }));
        const tCopy = new Map(t.map((x) => [condCore(x.label), x]));
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
          .map(({ label, units, count, answers }) => ({ label, units, count, answers }));
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
