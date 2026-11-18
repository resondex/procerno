import { STATION_LABEL, stationQuestion, viewsOf, type StationKey } from "./views";
import { cachedView, requestOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { sharedRunFacts, cardCondRows, WTB, type CardCondRow } from "./facts/overview_facts";
import { computeTypeDetail, ctxOf, type Ctx, type TypeDetailBundle } from "./facts/type_detail";
import { OVERVIEW_FLOORS as OF, seldomOf, leadsFirst } from "./facts/measure_book";
import { parseFactId, type FactCell } from "./facts/statements";
import type { QuestionType } from "./facts/answer_facts";
import type { Scope } from "./facts/fact";
import type { SelMember } from "./facts/selections";
import type { DossierTheme } from "./reason_themes";
import type { Project, Run } from "../types";

export type { RateCell, StationKey };

/**
 * The Stations home view ("Question type detail"), on the fact layer (FACT_LAYER_DESIGN_2026-11-17.md step 8). Six
 * stations of one shape: the buyer's question as the title, one number, an anchor, the number of question kinds, and
 * under it who the station routes to, the arguments behind its verdict, the reasons on each side of it, and the open
 * inventory of every question kind routed to it. Every number is a fact looked up from the run's one fact book (or a
 * section of the type-detail bundle, itself all facts): a rate is a FactCell; a number inside an anchor or an
 * inventory row's "beside" text carries its fact ids in order (`facts`, `besideFacts`).
 *
 * Stations are independent populations - separate sets of questions with their own answers, never stages one buyer
 * walks through.
 *
 * The buyer filter (?room=) reaches the question types asked in one buyer's voice (spotting the problem, which should
 * I get, price - and their arguments and reasons); everything else is shown at its every-buyer value, marked invariant.
 *
 * Reasons (j9): each question type of a station is its own block (ruling 10: a condition is counted inside one question
 * type), its rows the card's own condition rows (the run's one grouping, ruling 14) as shares of all the type's answers
 * (ruling 4) - the same facts the Map's cards draw.
 */

/** Bumped whenever the payload shape or a number's meaning changes. */
export const JOURNEY_VERSION = "j10"; // j10 (2026-11-18, the floor rulings): station arguments on the one lift rule (10 answers a side, no incidence gate, each row marked seldom, each side led by a row not seldom raised). // j9 (2026-11-18, fact layer step 8): every number a fact; reasons per question type on the cards' condition rows; ruling 7 (which should I get = discovery + use case), 2, 3, 8, 12, 13 apply; the view is cached. // j8 (2026-11-17, fact layer step 6): Value's "who is recommended instead" is a fact per rival. // j7 (2026-11-16): the two settled rows carry the Map names. // j6 (2026-11-10): the tightened wall test

export interface JourneyMetric {
  key: string;
  label: string;
  cell: RateCell;
  /** Measured across all buyers by design - the room filter does not reach it. */
  invariant: boolean;
}

export interface JourneyAnchor {
  kind: "rival" | "range" | "named_instead" | "leave";
  text: string;
  cell: RateCell | null;
  /** The facts the text prints, in order. */
  facts?: string[];
}

export interface InventoryRow {
  /** The view key, or view key + ":" + the rival / worry / room for per-item rows. */
  key: string;
  label: string;
  asked: boolean;
  answers: number;
  answersFact?: string;
  /** What the row's number reads as ("picked", "you win", "told to stay"). */
  readsAs: string;
  you: RateCell | null;
  beside: string;
  /** The facts `beside` prints, in order. */
  besideFacts?: string[];
  /** Shown at its all-buyers value under a room filter. */
  invariant: boolean;
}

/** One stated reason at a station, on one side: a card's condition row. Shares are of the question type's answers. */
export interface StationReasonRow {
  label: string;
  /** Formatted share ("12%", "<1%"). */
  share: string;
  /** Answers stating it (tooltips only). */
  answers: number;
  /** Lose side: dictionary brands it routes to, at most 3; [] on the win side. */
  routes: string[];
  wall?: boolean;
  /** Up to RECEIPT_IDS sample response ids - the receipts. */
  ids: string[];
  /** The fact the share is. */
  fact?: string;
}

/** Kept for the reason list's shape; the fact-layer rows carry no situation buckets. */
export interface StationReasonTheme extends DossierTheme {
  answers: number;
  ids: string[];
}

export interface StationReasonSide {
  /** The question type's answers - every share's denominator (ruling 4; tooltips only). */
  base: number;
  themes: StationReasonTheme[];
  /** The condition rows on this side, largest first, with routes. */
  flat: StationReasonRow[];
}

export interface StationReasons {
  win: StationReasonSide;
  lose: StationReasonSide;
}

export interface JourneyPick {
  name: string;
  role: "target" | "rival" | "other";
  cell: RateCell;
  /** The fact the cell is. */
  fact?: string;
}

export interface JourneyArgument {
  code: string;
  forYou: boolean;
  inYourPicks: RateCell;
  inRivalPicks: RateCell;
  /** Raised in under FLOORS.seldomShare of the two sides' answers together (measure_book seldomOf). */
  seldom: boolean;
}

export type StationPart = "picks" | "arguments" | "reasons";

export interface JourneyStation {
  key: StationKey;
  label: string;
  question: string;
  lead: JourneyMetric | null;
  sub: JourneyMetric[];
  anchor: JourneyAnchor | null;
  kinds: number;
  inventory: InventoryRow[];
  picks: JourneyPick[];
  picksLabel: string;
  picksNote: string;
  arguments: JourneyArgument[];
  argumentLabels: [string, string];
  argumentsNote: string | null;
  /** The first question type's reasons (the summary sentence reads these). */
  reasons: StationReasons;
  /** The reasons, one block per question type of the station (ruling 10). */
  reasonsByType: { key: string; label: string; reasons: StationReasons }[];
  invariant: boolean;
  unfiltered: StationPart[];
}

export interface JourneyView {
  version: string;
  runId: string;
  source: string;
  brand: string;
  category: string;
  room: string | null;
  rooms: string[];
  stations: JourneyStation[];
}

const m = (key: string, label: string, c: RateCell, invariant: boolean): JourneyMetric => ({ key, label, cell: c, invariant });
const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const PICKS_MAX = 12;
const RECEIPT_IDS = 5;

const EMPTY_SIDE: StationReasonSide = { base: 0, themes: [], flat: [] };
const EMPTY_REASONS: StationReasons = { win: EMPTY_SIDE, lose: EMPTY_SIDE };

/** The fact's own printed text (the measure's print rule). */
function tx(c: Ctx, cell: FactCell): string {
  const p = parseFactId(cell.id);
  return c.rf.book.fact(p.measure, p.subject, p.scope).text;
}

/** A line with numbers: string parts and facts, printed in order; returns the text and the facts' ids. */
function line(c: Ctx, parts: (string | FactCell)[]): { text: string; ids: string[] } {
  const ids: string[] = [];
  const text = parts
    .map((p) => {
      if (typeof p === "string") return p;
      ids.push(p.id);
      return tx(c, p);
    })
    .join("");
  return { text, ids };
}

function row(c: Ctx, key: string, label: string, readsAs: string, a: { answers: number; answersFact?: string }, you: FactCell | null, beside: (string | FactCell)[], invariant: boolean): InventoryRow {
  const b = line(c, beside);
  return { key, label, asked: a.answers > 0, answers: a.answers, ...(a.answersFact ? { answersFact: a.answersFact } : {}), readsAs, you, beside: b.text, besideFacts: b.ids, invariant };
}

const notAsked = (key: string, label: string, readsAs: string, invariant: boolean): InventoryRow => ({
  key,
  label,
  asked: false,
  answers: 0,
  readsAs,
  you: null,
  beside: "not asked on this tracker",
  invariant,
});

/** Distinct rooms in setup order, from cells that route to a view. */
function roomsOf(data: ViewData): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of [...data.intents].sort((a, b) => a.seq - b.seq)) {
    if (!it.situation || seen.has(it.situation) || viewsOf(it.stage, it.angle).length === 0) continue;
    seen.add(it.situation);
    out.push(it.situation);
  }
  return out;
}

/**
 * Top 2 for / top 2 against: an argument's share among a scope's answers on the favorable side of its verdict against
 * the other side (each a fact: measure "argues" on the scope narrowed to the side's slice). Both sides must hold
 * liftMinAnswers answers carrying arguments - the one lift rule (FLOORS.liftMinSide, no incidence gate); a row raised in
 * under FLOORS.seldomShare of the two sides' answers is kept and marked seldom. Each side's top 2: common rows first in
 * strength order, seldom rows only in a free slot (leadsFirst).
 */
function argumentsOf(c: Ctx, types: QuestionType[], fav: string, other: string, pinned: boolean): JourneyArgument[] {
  const sc: Scope = { types, ...(pinned && c.room !== undefined ? { situation: c.room } : {}), when: "args" };
  if (!c.has(sc)) return [];
  const side = (w: string): Scope => ({ ...sc, when: `args&${w}` });
  if (c.A(side(fav)).answers < OF.liftMinAnswers || c.A(side(other)).answers < OF.liftMinAnswers) return [];
  const codes = new Set<string>();
  for (const f of c.rows(sc)) for (const a of f.args ?? []) codes.add(a);
  const lift = [...codes]
    .sort()
    .flatMap((code) => {
      const w = c.F("argues", `ai/arg:${code}`, side(fav));
      const o = c.F("argues", `ai/arg:${code}`, side(other));
      if (w.k + o.k === 0) return [];
      return [{ code, w, o, lift: rate(w) - rate(o), seldom: seldomOf(w, o) }];
    })
    .sort((a, b) => b.lift - a.lift || a.code.localeCompare(b.code));
  // A capped list: common rows first, seldom rows only in free slots (leadsFirst).
  const top2 = <T extends { seldom: boolean }>(xs: T[]): T[] => leadsFirst(xs).slice(0, 2);
  const forYou = top2(lift.filter((r) => r.lift > 0));
  const against = top2(lift.filter((r) => r.lift < 0).reverse());
  return [...forYou, ...against].map((r) => ({ code: r.code, forYou: r.lift > 0, inYourPicks: r.w, inRivalPicks: r.o, seldom: r.seldom }));
}

/** One side of a question type's reasons: the card's condition rows, shares of all the type's answers. */
function side(c: Ctx, scope: Scope, rows: CardCondRow[]): StationReasonSide {
  const base = c.rows(scope).length;
  if (rows.length === 0) return { base: 0, themes: [], flat: [] };
  const flat: StationReasonRow[] = rows.map((r) => {
    const p = parseFactId(r.share.id);
    const hit = c.rf.book.answers(p.measure, p.subject, p.scope).hit;
    return {
      label: r.label,
      share: tx(c, r.share),
      answers: r.share.k,
      routes: r.routes.map((x) => x.name).slice(0, 3),
      ...(r.wall ? { wall: true } : {}),
      ids: hit.slice(0, RECEIPT_IDS).map((f) => f.responseId),
      fact: r.share.id,
    };
  });
  return { base, themes: [], flat };
}

function reasonsOf(c: Ctx, scope: Scope): StationReasons {
  if (!c.has(scope) || !c.rows(scope).some((f) => f.conds !== null)) return EMPTY_REASONS;
  return { win: side(c, scope, cardCondRows(c.rf, c.data, scope, "toward")), lose: side(c, scope, cardCondRows(c.rf, c.data, scope, "away")) };
}

function station(
  c: Ctx,
  key: StationKey,
  parts: {
    lead: JourneyMetric | null;
    sub?: JourneyMetric[];
    anchor?: JourneyAnchor | null;
    inventory: InventoryRow[];
    picks?: JourneyPick[];
    picksLabel: string;
    picksNote: string;
    arguments?: JourneyArgument[];
    argumentLabels: [string, string];
    argumentsNote?: string | null;
    reasonTypes?: { key: string; label: string; scope: Scope }[];
    unfiltered?: StationPart[];
  }
): JourneyStation {
  const sub = (parts.sub ?? []).slice(0, 2);
  const nums = [...(parts.lead ? [parts.lead] : []), ...sub];
  const byType = (parts.reasonTypes ?? [])
    .map((t) => ({ key: t.key, label: t.label, reasons: reasonsOf(c, t.scope) }))
    .filter((t) => t.reasons.win.base > 0 || t.reasons.lose.base > 0);
  return {
    key,
    label: STATION_LABEL[key],
    question: stationQuestion(key, c.data.project.brand, c.data.project.category),
    lead: parts.lead,
    sub,
    anchor: parts.anchor ?? null,
    kinds: parts.inventory.filter((r) => r.asked).length,
    inventory: parts.inventory,
    picks: parts.picks ?? [],
    picksLabel: parts.picksLabel,
    picksNote: parts.picksNote,
    arguments: parts.arguments ?? [],
    argumentLabels: parts.argumentLabels,
    argumentsNote: parts.argumentsNote ?? null,
    reasons: byType[0]?.reasons ?? EMPTY_REASONS,
    reasonsByType: byType,
    invariant: nums.length > 0 && nums.every((x) => x.invariant),
    unfiltered: parts.unfiltered ?? [],
  };
}

const roleOfBrand = (r: string): JourneyPick["role"] => (r === "target" ? "target" : r === "competitor" ? "rival" : "other");
const pick = (c: Ctx, key: string, name: string, cell: FactCell): JourneyPick => ({ name: key === c.T ? c.set.target.name : name, role: roleOfBrand(c.role(key)), cell, fact: cell.id });
const byRate = (a: JourneyPick, b: JourneyPick) => rate(b.cell) - rate(a.cell) || a.name.localeCompare(b.name);
/** Margin from an even two-way split - the closest and widest rivals. */
const margin = (r: { winOfDecided: RateCell }) => Math.abs(rate(r.winOfDecided) - 0.5);

/** The journey for one request, from the run's one fact book and the type-detail bundle (all facts). */
export async function computeJourneyFromData(data: ViewData, request: ViewRequest = {}): Promise<JourneyView | null> {
  const room = request.room;
  const filtered = room !== undefined;
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  const rf = await sharedRunFacts(data, eng);
  const c = ctxOf(data, rf, request);
  const cAll = ctxOf(data, rf, eng);
  const pinned: TypeDetailBundle = await computeTypeDetail(data, request);
  const all: TypeDetailBundle = filtered ? await computeTypeDetail(data, eng) : pinned;
  if (rf.set.facts.length === 0) return null;
  const invariantParts: StationPart[] = filtered ? ["picks", "arguments", "reasons"] : [];
  const category = data.project.category;
  const pinS = (sc: Scope): Scope => (filtered ? { ...sc, situation: room } : sc);

  // ---------- Awareness ----------
  const pr = pinned.awareness?.routing && pinned.awareness.routing.answers > 0 ? pinned.awareness.routing : null;
  const ce = all.awareness?.explainer && all.awareness.explainer.answers > 0 ? all.awareness.explainer : null;
  const PR = pinS({ types: ["problem_recognition"] });
  const hasRouting = cAll.has({ types: ["problem_recognition"] });
  const prRival = pr ? c.sel("named_brands", "you", PR, { top: 1 }) : null;
  const prRivalM = prRival ? (prRival.members as SelMember[])[0] : undefined;
  const awarenessPicks: JourneyPick[] = (() => {
    if (hasRouting) {
      if (!pr) return [];
      // The same set under every buyer: every brand named when the problem is described, across all buyers, plus you.
      const set = cAll.sel("named_brands", "you", { types: ["problem_recognition"] }, { rankYou: true, top: PICKS_MAX }).members as SelMember[];
      const keys = [...new Set([...set.map((b) => b.key), c.T])];
      return keys.map((k) => pick(c, k, set.find((b) => b.key === k)?.name ?? c.set.nameOf(k), c.F("named", c.subj(k), PR))).sort(byRate);
    }
    if (!ce) return [];
    const CE: Scope = { types: ["category_education"] };
    const set = cAll.sel("named_brands", "you", CE, { rankYou: true, top: PICKS_MAX }).members as SelMember[];
    return set.map((b) => pick(c, b.key, b.name, c.F("named", c.subj(b.key), CE))).sort(byRate);
  })();
  const prAnchor = prRivalM ? c.F("named", prRivalM.key, PR) : null;
  const awarenessStation = station(c, "awareness", {
    lead: pr ? m("pr_names", "Names you when the problem is described", pr.namesYou, false) : ce ? m("ce_names", "Names you when the category is explained", ce.namesYou, true) : null,
    sub: [...(pr ? [m("pr_category", `Points them to ${category}`, pr.routed.category, false)] : []), ...(pr && ce ? [m("ce_names", "Names you when the category is explained", ce.namesYou, true)] : [])],
    anchor: prRivalM && prAnchor ? { kind: "rival", text: `best rival ${prRivalM.name} ${tx(c, prAnchor)}`, cell: prAnchor, facts: [prAnchor.id] } : null,
    inventory: [
      pr
        ? row(c, "awareness_routing", "Problem recognition", "names you", pr, pr.namesYou as FactCell, [`points them to ${category} `, pr.routed.category as FactCell, ", to products ", pr.pointsToProducts as FactCell], false)
        : notAsked("awareness_routing", "Problem recognition", "names you", false),
      ce ? row(c, "awareness_explainer", "Category education", "names you", ce, ce.namesYou as FactCell, ["points to products ", ce.pointsToProducts as FactCell], true) : notAsked("awareness_explainer", "Category education", "names you", true),
    ],
    picks: awarenessPicks,
    picksLabel: "Who it names",
    picksNote: hasRouting ? "Share of answers to a described problem that name each brand." : "Share of answers explaining the category that name each brand.",
    arguments: [],
    argumentLabels: ["when you are named", "when you are not"],
    argumentsNote: "Awareness answers are coded for the topics they raise, not for arguments for or against a brand.",
    unfiltered: filtered && !hasRouting && awarenessPicks.length > 0 ? ["picks"] : [],
  });

  // ---------- Consideration ----------
  const hv = pinned.headline && pinned.headline.answers > 0 ? pinned.headline : null;
  const target = hv?.brands.find((b) => b.role === "target");
  const rivalTop = hv ? hv.brands.filter((b) => b.role !== "target" && b.chosen.k > 0).sort((a, b) => rate(b.shareOfDecided) - rate(a.shareOfDecided) || a.name.localeCompare(b.name))[0] : undefined;
  const stageRow = (stage: string, label: string, invariant: boolean): InventoryRow => {
    const src = invariant ? all.headline : pinned.headline;
    const s = src?.byStage.find((x) => x.key === stage);
    if (!s || s.answers === 0) return notAsked(`headline:${stage}`, label, "picked", invariant);
    return row(invariant ? cAll : c, `headline:${stage}`, label, "picked", s, s.chosen as FactCell, ["named ", s.mentioned as FactCell, ", one brand picked in ", s.firmPickInCategory as FactCell], invariant);
  };
  const premium = all.premium && all.premium.answers > 0 ? all.premium : null;
  const criteria = pinned.reasons?.types.find((t) => t.key === "criteria_taught");
  const criteriaTop = criteria && pinned.reasons ? [...pinned.reasons.codes].filter((x) => (x.byType.criteria_taught?.k ?? 0) > 0).sort((a, b) => b.byType.criteria_taught!.k - a.byType.criteria_taught!.k || a.label.localeCompare(b.label)).slice(0, 3).map((x) => x.label) : [];
  const WTBp = pinS(WTB);
  const considerationPicks: JourneyPick[] = (() => {
    if (!hv) return [];
    // The same set under every buyer: every brand picked across all buyers, plus you.
    const base = (all.headline?.brands ?? []).filter((b) => b.chosen.k > 0 || b.role === "target");
    const keys = [...new Set([...base.map((b) => b.key), c.T])];
    return keys.map((k) => pick(c, k, base.find((b) => b.key === k)?.name ?? c.set.nameOf(k), c.F("share_of_picks", c.subj(k), WTBp))).sort(byRate);
  })();
  const considerationStation = station(c, "consideration", {
    lead: target ? m("share_of_decided", "Win rate when one is picked", target.shareOfDecided, false) : null,
    sub: target ? [m("chosen", "Picked in all answers", target.chosen, false), m("mentioned", "Named", target.mentioned, false)] : [],
    anchor: rivalTop ? { kind: "rival", text: `best rival ${rivalTop.name} ${tx(c, rivalTop.shareOfDecided as FactCell)}`, cell: rivalTop.shareOfDecided, facts: [(rivalTop.shareOfDecided as FactCell).id] } : null,
    inventory: [
      stageRow("discovery", "Discovery", false),
      stageRow("use_case", "Use-case fit", false),
      stageRow("social_validation", "Social validation", true),
      premium
        ? row(cAll, "premium_tier", "Premium vs basic", "picked", premium, premium.picksYou as FactCell, ["backs the premium end ", premium.stance.premium as FactCell, ", the basic end ", premium.stance.basic as FactCell], true)
        : notAsked("premium_tier", "Premium vs basic", "picked", true),
      criteria && criteria.answers > 0
        ? row(c, "criteria_taught", "Criteria", "criteria taught", criteria, null, [criteriaTop.length > 0 ? `most taught: ${criteriaTop.join(", ")}` : "no criteria taught"], false)
        : notAsked("criteria_taught", "Criteria", "criteria taught", false),
    ],
    picks: considerationPicks,
    picksLabel: "Who gets picked",
    picksNote: "Each brand's share of the answers that pick one brand in the category.",
    arguments: argumentsOf(c, ["discovery", "use_case"], "pick:you", "pick:other", true),
    argumentLabels: ["when you are picked", "when another brand is picked"],
    reasonTypes: [
      { key: "headline", label: "Which should I get", scope: WTBp },
      ...(filtered ? [] : [{ key: "premium_worth", label: "Premium vs basic", scope: { types: ["premium_worth"] } as Scope }]),
    ],
  });

  // ---------- Comparison ----------
  const entity = all.head_to_head?.entity && all.head_to_head.entity.answers > 0 ? all.head_to_head.entity : null;
  const klass = all.head_to_head?.class && all.head_to_head.class.answers > 0 ? all.head_to_head.class : null;
  const offensive = all.alternatives?.offensive && all.alternatives.offensive.answers > 0 ? all.alternatives.offensive : null;
  const decidedRows = entity ? entity.rows.filter((r) => r.winOfDecided.n > 0) : [];
  const closest = [...decidedRows].sort((a, b) => margin(a) - margin(b) || a.rival.localeCompare(b.rival))[0];
  const widest = [...decidedRows].sort((a, b) => margin(b) - margin(a) || a.rival.localeCompare(b.rival))[0];
  const h2hRow = (prefix: string, r: (typeof decidedRows)[number]) =>
    row(cAll, `${prefix}:${r.key}`, `Against ${r.rival}`, "you win", r, r.won as FactCell, ["two-way ", r.winOfDecided as FactCell, `, ${r.rival} wins `, r.lost as FactCell], true);
  const rangeLine = closest && widest ? line(cAll, [`closest ${closest.rival} `, closest.winOfDecided as FactCell, `, widest ${widest.rival} `, widest.winOfDecided as FactCell]) : null;
  const comparisonStation = station(cAll, "comparison", {
    lead: entity ? m("h2h_won", "You win against a named rival", entity.overall.won, true) : klass ? m("h2h_class_won", "You win against a class", klass.overall.won, true) : null,
    sub: [...(entity && klass ? [m("h2h_class_won", "You win against a class", klass.overall.won, true)] : []), ...(offensive ? [m("leavers_captured", "A rival's leavers pick you", offensive.overall.captured, true)] : [])],
    anchor: rangeLine && closest ? { kind: "range", text: rangeLine.text, cell: closest.winOfDecided, facts: rangeLine.ids } : null,
    inventory: [
      ...(entity ? entity.rows.map((r) => h2hRow("head_to_head_entity", r)) : [notAsked("head_to_head_entity", "Against a named rival", "you win", true)]),
      ...(klass ? klass.rows.map((r) => h2hRow("head_to_head_class", r)) : [notAsked("head_to_head_class", "Against a class", "you win", true)]),
      ...(offensive
        ? offensive.rows.map((r) => row(cAll, `offensive_capture:${r.key}`, `Leaving ${r.rival}`, "picks you", r, r.captured as FactCell, ["named ", r.named as FactCell, r.captors[0] ? `, most picked ${r.captors[0].name}` : ""], true))
        : [notAsked("offensive_capture", "A rival's leavers", "picks you", true)]),
    ],
    picks: entity ? entity.rows.map((r) => ({ name: r.rival, role: "rival" as const, cell: r.winOfDecided, fact: (r.winOfDecided as FactCell).id })) : [],
    picksLabel: "Who wins each head-to-head",
    picksNote: "Your win rate against each named rival, when one of the two is picked.",
    arguments: argumentsOf(cAll, ["comparison_entity", "comparison_class"], "pick:you", "pick:other", false),
    argumentLabels: ["when you win", "when the rival wins"],
    reasonTypes: [
      { key: "head_to_head_entity", label: "Head to head", scope: { types: ["comparison_entity"] } },
      { key: "head_to_head_class", label: "Head to head against a class", scope: { types: ["comparison_class"] } },
      { key: "offensive_capture", label: "Rivals' customers switching", scope: { types: ["switching"] } },
    ],
    unfiltered: invariantParts,
  });

  // ---------- Doubts (buyers' worries) ----------
  const obj = all.doubt?.objections && all.doubt.objections.answers > 0 ? all.doubt.objections : null;
  const worryRows = obj ? obj.rows.filter((r) => r.answers > 0) : [];
  const minW = [...worryRows].sort((a, b) => rate(a.verdicts.proceed) - rate(b.verdicts.proceed) || a.concern.localeCompare(b.concern))[0];
  const maxW = [...worryRows].sort((a, b) => rate(b.verdicts.proceed) - rate(a.verdicts.proceed) || a.concern.localeCompare(b.concern))[0];
  const wl = minW && maxW && minW !== maxW ? line(cAll, ["from ", minW.verdicts.proceed as FactCell, ` on "${minW.concern || "a worry"}" to `, maxW.verdicts.proceed as FactCell, ` on "${maxW.concern || "a worry"}"`]) : null;
  const doubtsStation = station(cAll, "doubts", {
    lead: obj ? m("go_ahead", "Told to go ahead", obj.verdicts.proceed, true) : null,
    sub: obj ? [m("agrees", "Agrees with the worry", obj.premise.confirms, true)] : [],
    anchor: wl && minW ? { kind: "range", text: wl.text, cell: minW.verdicts.proceed, facts: wl.ids } : null,
    inventory: worryRows.length
      ? worryRows.map((r) => row(cAll, `doubt:${r.key}`, r.concern || "A buyer's worry", "go ahead", r, r.verdicts.proceed as FactCell, ["agrees with the worry ", r.premise.confirms as FactCell, ", points them to another brand ", r.offersExit as FactCell], true))
      : [notAsked("doubt", "A buyer's worry", "go ahead", true)],
    picks: obj ? obj.exits.slice(0, PICKS_MAX).map((x) => ({ name: x.name, role: roleOfBrand(x.role), cell: x.offered, fact: (x.offered as FactCell).id })) : [],
    picksLabel: "Where it sends them instead",
    picksNote: "Share of answers to a buyer's worry that offer each brand as another option.",
    // Favorable side = the AI rebuts the worry (a confirmed worry is the argument against you).
    arguments: argumentsOf(cAll, ["objections"], "v:premise_verdict:rebuts", "v:premise_verdict:confirms", false),
    argumentLabels: ["when it rebuts the worry", "when it agrees the worry is warranted"],
    reasonTypes: [{ key: "doubt", label: "Buyers' worries", scope: { types: ["objections"] } }],
    unfiltered: invariantParts,
  });

  // ---------- Value ----------
  const val = pinned.value && pinned.value.answers > 0 ? pinned.value : null;
  const PRICE = pinS({ types: ["pricing"] });
  const valuePicks: JourneyPick[] = (() => {
    if (!val) return [];
    // The rivals recommended instead across all buyers (the same set under every buyer), each a fact in the room.
    const set = cAll.sel("instead_brands", "ai", { types: ["pricing"] }).members as SelMember[];
    return set.map((b) => pick(c, b.key, b.name, c.F("named_instead", b.key, PRICE))).sort(byRate);
  })();
  const topInstead = val ? (c.sel("instead_brands", "ai", PRICE).members as SelMember[])[0] : undefined;
  const topCell = topInstead ? c.F("named_instead", topInstead.key, PRICE) : null;
  const valueStation = station(c, "value", {
    lead: val ? m("worth_it", "Worth it", val.worth.yes, false) : null,
    sub: val ? [m("not_worth_it", "Not worth it", val.worth.no, false)] : [],
    anchor: topInstead && topCell ? { kind: "named_instead", text: `${topInstead.name} recommended instead`, cell: topCell, facts: [] } : null,
    inventory: val
      ? val.rooms.map((r) => row(c, `value:${r.key}`, r.label, "worth it", r, r.worth.yes as FactCell, [`${r.line ? `${r.line}, ` : ""}not worth it `, r.worth.no as FactCell, r.instead.find((x) => !x.own) ? `, ${r.instead.find((x) => !x.own)!.name} recommended instead` : ""], false))
      : [notAsked("value", "Worth it over a cheaper option", "worth it", false)],
    picks: valuePicks,
    picksLabel: "Who is recommended instead",
    picksNote: "Share of value answers that recommend each brand instead of you.",
    arguments: argumentsOf(c, ["pricing"], "v:worth_it:yes", "v:worth_it:no", true),
    argumentLabels: ["when worth it", "when not worth it"],
    reasonTypes: [{ key: "value", label: "Value", scope: PRICE }],
  });

  // ---------- Customers ----------
  const keep = all.doubt?.keepOrLeave && all.doubt.keepOrLeave.answers > 0 ? all.doubt.keepOrLeave : null;
  const defensive = all.alternatives?.defensive && all.alternatives.defensive.answers > 0 ? all.alternatives.defensive : null;
  const rep = all.repertoire && all.repertoire.answers > 0 ? all.repertoire : null;
  const st = all.settled;
  const keepStage = (stage: string, label: string): InventoryRow => {
    const s = keep?.byStage.find((x) => x.key === stage);
    return s && s.answers > 0
      ? row(cAll, `keep_or_leave:${stage}`, label, "told to stay", s, s.verdicts.keep as FactCell, ["told to leave ", s.verdicts.leave as FactCell, ", agrees with the worry ", s.confirms as FactCell], true)
      : notAsked(`keep_or_leave:${stage}`, label, "told to stay", true);
  };
  const CUST: Scope = { types: ["churn_triggers", "renewal", "looking_around"] };
  const customerPicks: JourneyPick[] = cAll.has(CUST)
    ? (cAll.sel("sent_all", "ai", CUST, { top: PICKS_MAX }).members as SelMember[]).map((b) => pick(cAll, b.key, b.name, cAll.F("sent_to", b.key, CUST))).sort(byRate)
    : [];
  const settledRow = (key: string, label: string, readsAs: string, v: { answers: number; answersFact?: string } | null | undefined, you: () => FactCell, beside: () => (string | FactCell)[]): InventoryRow =>
    v && v.answers > 0 ? row(cAll, key, label, readsAs, v, you(), beside(), true) : notAsked(key, label, readsAs, true);
  const customersStation = station(cAll, "customer_base", {
    lead: keep ? m("worries_stay", "Told to stay", keep.verdicts.keep, true) : null,
    sub: keep ? [m("agrees", "Agrees with the worry", keep.premise.confirms, true)] : [],
    anchor: keep ? { kind: "leave", text: `told to leave ${tx(cAll, keep.verdicts.leave as FactCell)}`, cell: keep.verdicts.leave, facts: [(keep.verdicts.leave as FactCell).id] } : null,
    inventory: [
      keepStage("churn_triggers", "Thinking of leaving"),
      keepStage("renewal", "Up for renewal"),
      defensive
        ? row(cAll, "defensive_hold", "Weighing a move", "told to stay", defensive, defensive.verdicts.keep as FactCell, ["told to leave ", defensive.verdicts.leave as FactCell, ", points them to another brand ", defensive.offersExit as FactCell], true)
        : notAsked("defensive_hold", "Weighing a move", "told to stay", true),
      rep ? row(cAll, "repertoire", "Habit check", "stick with you", rep, rep.verdict.stick as FactCell, ["switch ", rep.verdict.switch as FactCell], true) : notAsked("repertoire", "Habit check", "stick with you", true),
      settledRow("settled_business_case", "Business case", "confident case", st?.businessCase, () => st!.businessCase!.caseStrength.strong as FactCell, () => ["hedged ", st!.businessCase!.caseStrength.hedged as FactCell, ", undermined ", st!.businessCase!.caseStrength.undermined as FactCell]),
      settledRow("settled_expansion", "Doing more with you", "backs the step", st?.expansion, () => st!.expansion!.growth.backs as FactCell, () => ["points them to another brand ", st!.expansion!.growth.redirects as FactCell]),
      settledRow("settled_ecosystem", "What to use alongside you", "strengthens the relationship", st?.ecosystem, () => st!.ecosystem!.verdicts.strengthens as FactCell, () => [st!.ecosystem!.pairings.length ? `most paired: ${st!.ecosystem!.pairings.slice(0, 3).map((p) => p.name).join(", ")}` : "no pairings named"]),
      settledRow("settled_advocacy", "Answering a critic", "pushes back on the critic", st?.advocacy, () => st!.advocacy!.premise.rebuts as FactCell, () => ["confident case ", st!.advocacy!.caseStrength.strong as FactCell]),
    ],
    picks: customerPicks,
    picksLabel: "Where it sends your customers",
    picksNote: "Share of answers to a customer's worry or a customer weighing a move that offer each brand as somewhere to go.",
    arguments: argumentsOf(cAll, ["churn_triggers", "renewal", "looking_around"], "v:keep_or_leave:keep", "v:keep_or_leave:leave", false),
    argumentLabels: ["when told to stay", "when told to leave"],
    reasonTypes: [
      { key: "keep_or_leave", label: "Customers' worries", scope: { types: ["churn_triggers", "renewal"] } },
      { key: "defensive_hold", label: "Your customers looking around", scope: { types: ["looking_around"] } },
      { key: "settled_expansion", label: "Doing more with you", scope: { types: ["expansion"] } },
      { key: "settled_ecosystem", label: "What to use alongside you", scope: { types: ["ecosystem"] } },
    ],
    unfiltered: invariantParts,
  });

  return {
    version: JOURNEY_VERSION,
    runId: data.run.id,
    source: data.source,
    brand: data.project.brand,
    category,
    room: room ?? null,
    rooms: roomsOf(data),
    stations: [awarenessStation, considerationStation, comparisonStation, doubtsStation, valueStation, customersStation],
  };
}

/** The journey through the view cache (it embeds the type-detail bundle's facts and the run's condition grouping). */
export function computeJourneyCached(run: Run, project: Project, request: ViewRequest = {}): Promise<JourneyView | null> {
  const r = requestOf(request, true);
  return cachedView("journey", JOURNEY_VERSION, run, project, (d) => computeJourneyFromData(d, r), { setupDecision: true, codeGroups: true, judge: true }, r);
}

/** Kept name for callers (the route, warm_views): the cached journey. */
export const computeJourney = computeJourneyCached;
