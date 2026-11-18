import { famTokens } from "./brand_family";
import { pickRefs, spreadRefs } from "./reason_themes";
import { isWallWording } from "./wall_wording";
import type { Resolver } from "./brand_resolve";
import { cell, type PoolRow, type RateCell } from "./view_data";
import type { ValueFact } from "./value";
import type { Omission } from "./panel_filter";
import { NOWHERE_CLEAR, AVG_COMP, CLOSE_PTS, GAP_TAKEAWAY, TAKEAWAY_TAGS, TAG_FURTHEST, TAG_GAP_OPENS, agreesTakeaway, alongsideTakeaway, avgTag, caseTakeaway, criticStrengthTakeaway, duelTag, insteadTakeaway, keepTakeaway, leanOf, offersTakeaway, oftenOf, premiseTakeaway, tierTakeaway, habitTakeaway, suggestTakeaway, relationshipTakeaway, proceedTakeaway, stanceTakeaway, taughtTakeaway, usualDir, duelTone, focusOf, neutralUsualTag, otherTag, rankTag, segTag, toneOfTag, usualTag, usualTone, worthTakeaway, type KN, type Takeaway } from "./panel_tags";
import { ROW_NAME } from "./question_names";
import type { AnswerFact, AnswerFactSet, QuestionType } from "./facts/answer_facts";
import { scopeKey, WHAT_TO_BUY_ALL, type Fact, type FactBook, type Scope } from "./facts/fact";
import { MEASURE_BY_ID, cardKey, printOf } from "./facts/measure_book";
import { averageCompetitor, type AnySelection, type CondFlavor, type CondRow, type SelMember, type SelectionBook, type WeighsColumn } from "./facts/selections";
import {
  F,
  N,
  NO_CONDITION_ROWS,
  T,
  BY_PRODUCT,
  VALUE_SECTIONS,
  VALUE_VERDICT_ROW,
  WEIGHS_NONE,
  WEIGHS_SUB_ALL,
  WEIGHS_SUB_NAMING,
  WEIGHS_SUB_SIDES,
  WEIGHS_SUB_VERSUS,
  WEIGHS_TITLE,
  valueInsteadDetail,
  valueStepLabel,
  valueVerdictFold,
  valueWorthDetail,
  weighsFewNote,
  alongsideDetail,
  buyerWorryDetail,
  caseDetail,
  criteriaDetail,
  criticDetail,
  customerWorryDetail,
  expansionDetail,
  h2hDetail,
  lookingAroundDetail,
  type BuyerSide,
  type CaseSide,
  type InsteadSide,
  type CommitsSide,
  COMMITS_TEXT,
  CRITERIA_HELP,
  EXCEPTION_TEXT,
  CRITERIA_STEP_TEXT,
  CRITIC_TEXT,
  criticPremiseDetail,
  ALONGSIDE_TEXT,
  CASE_TEXT,
  EXPANSION_TEXT,
  LOOKING_TEXT,
  lookingOffersDetail,
  WORRY_AGREES_TEXT,
  worryAgreesDetail,
  type WorryAfter,
  checklistMarkNote,
  offChecklist,
  commitsDetail,
  ROUTED_TEXT,
  routedDetail,
  ANYBRAND_TEXT,
  anyBrandDetail,
  NAMEDWHEN_TEXT,
  namedWhenDetail,
  PREMIUM_TEXT,
  premiumClaim,
  HABIT_TEXT,
  habitClaim,
  SETTLED_ALL_TEXT,
  settledAllClaim,
  settledAllDetail,
  habitDetail,
  habitOffersDetail,
  type HabitSide,
  tierDetail,
  type TierWhere,
  type InsteadHalf,
  type KeepSide,
  type ValueSide,
  THIN,
  THIN_RIVAL,
  article,
  attachedLead,
  codeName,
  condRowLabel,
  listNameSpans,
  poss as possOf,
  shownPct,
  convertsLine,
  countWord,
  decidedLine,
  funnelDetail,
  join,
  NK,
  listWords,
  namedLine,
  rankDetail,
  recommendedLine,
  takersTitle,
  upperFirst,
  wonLine,
  type StepDir,
} from "./panel_text";
import type {
  AnswerRef,
  LiftItem,
  PanelBlock,
  PanelBrandRow,
  PanelCondition,
  PanelConditions,
  PanelDetail,
  PanelKind,
  PanelLine,
  PanelNum,
  PanelOther,
  PanelRival,
  PanelSegment,
  PanelSpan,
  PanelStep,
  PanelStepKey,
  PanelTable,
  PanelText,
  PanelTone,
  PositionBrand,
  RivalAcross,
  RivalAcrossBar,
  RivalAcrossStep,
  PositionException,
  PositionPanel,
  PanelStepDetail,
  PanelDetailSection,
  PanelWeighs,
  RivalStepDetail,
} from "./analysis_types";

/**
 * The per-question-type panels (am31, PANEL_BUILD_SPEC sections 2-4, E7): one PositionPanel per map cell of every
 * panel kind, and the By rival pages (buildRivalAcross), with zero model calls. Since FACT_LAYER_DESIGN_2026-11-17.md
 * step 4 (am77-am80) every card and every By rival page is a LAYOUT over the run's fact layer (facts/): every drawn
 * number is looked up from the fact book and carries its fact id, every list is a selection and carries its selection
 * id - nothing here counts answers (a number's example answers come from the fact's own answers). Tags compare a step
 * with the row's All cell ("your usual"), with the competitors (rank) or with one rival (duel) - panel_tags.ts.
 *
 * The map (analysis_map.ts) hands each panel cell a PanelCellInput during its cell loop and the run's facts
 * (PanelHelpers.facts), and calls buildPanels once after it; without the fact layer no card is built (the Map draws
 * its cells with the generic panel). Nothing here reads the store or any model, and no existing Position field is
 * touched.
 */

export const PANEL_REFS = 3;
export const PANEL_MIN = 20;
export const ROW_MIN = 3;
export const PICKED_MIN = 5;
export const COMP_TOP = 5;
export const GAP_MIN = 0.1;
const BRAND_FLOOR = 5;
const ARGS_MIN = 10;
const CASE_MIN = 10;

/* ------------------------------- inputs ------------------------------- */

export interface PanelCellInput {
  id: string;
  kind: PanelKind;
  row: string;
  key: string;
  label: string;
  pooled: boolean;
  rows: PoolRow[];
  /** The map's brand side / taker side (head-to-head: won / lost). */
  you: PoolRow[];
  them: PoolRow[];
  cellIntents: Set<string>;
  /** Head-to-head: the rival. Rivals' customers switching: the brand being left. */
  rivalKey?: string;
  rivalName?: string;
  exception?: PositionException;
  lifts: LiftItem[];
  /** The pick contests' listed rivals (Position.brands), for panel 11. */
  brands?: PositionBrand[];
  /** Value: the confirmed line asked about. */
  line?: string | null;
  concern?: string;
  /** The single-question kinds: what was asked - the question label clause,
   * or the quoted seed question (question_labels.ts). */
  asked?: string;
  /** Advocacy: the quoted criticism stored on the intent, when present. */
  criticism?: string;
}

export interface PanelHelpers {
  brand: string;
  targetKey: string;
  category: string;
  noun: string;
  plural: string;
  resolve: Resolver;
  pickOf: (r: PoolRow) => { status: string; key: string | null; name: string | null };
  recommendsOf: (r: PoolRow) => Map<string, string>;
  namesTarget: (r: PoolRow) => boolean;
  quoteOf: (r: PoolRow) => string;
  brandSplit: (rows: PoolRow[]) => { n: number; list: { key: string; name: string; rows: PoolRow[] }[] };
  /** A destination list resolved to the active rival brands it names (key -> name). */
  activeDests: (list: string[] | null) => Map<string, string>;
  /** One of your products as written; null for the bare brand or anything not yours. */
  productOf: (card: string) => string | null;
  valueFacts: Map<string, ValueFact>;
  /** The headline pool (criteria's when-picked figures). */
  headline: PoolRow[];
  reasonLift: { code: string; wins: RateCell; others: RateCell; lift: number }[];
  /** Brands the tracker asks about as a class ("a <brand> card"), not as a direct rival: never among a card's competitors or in its average competitor. */
  classKeys: Set<string>;
  /** The cell's question wordings, indexed for ruling 5. */
  wordings: (cellIntents: Set<string>, extra?: string[]) => { text: string; stems: Map<string, string> };
  scopes: Map<string, string>;
  omissions?: Omission[];
  /** The run's fact layer: the What to buy and switching cards are built from it (factPickPanel). */
  facts?: PickFacts;
}

const WALL_ROW_MIN = 5;

/* ------------------------------- numbers ------------------------------- */

const TAKEAWAY_TAG_SET = new Set(TAKEAWAY_TAGS);
const KNS = new WeakMap<PanelNum, KN>();
/** The counts behind a panel number (tags and harness only). */
export const knOf = (n: PanelNum | undefined): KN | undefined => (n ? KNS.get(n) : undefined);

const pctOf = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

export function num(k: number, n: number, unit: string, refs?: AnswerRef[]): PanelNum {
  const x = n > 0 ? k / n : 0;
  const out: PanelNum = {
    value: pctOf(x),
    pct: k > 0 ? Math.max(0.1, Math.round(x * 1000) / 10) : 0,
    tip: `${k} of ${n} ${unit}`,
    ...(k > 0 && refs && refs.length ? { refs } : {}),
  };
  KNS.set(out, { k, n });
  return out;
}

/* ------------------------------- the build ------------------------------- */

interface Ctx {
  h: PanelHelpers;
  inputs: Map<string, PanelCellInput>;
  /** am37: the brand sells a ladder of its own lines (a confirmed Value line
   * other than the bare brand) - else it is one product (a retailer, a single
   * service): no "your own cheaper" option and no "which of your <noun>" line. */
  ladder: boolean;
}

/** A codebook name as shown (its scope sentence's capitals kept). */
const cname = (code: string, h: PanelHelpers) => codeName(code, h.scopes.get(code));
/** A codebook name as a row label (sentence case). */
const clabel = (code: string, h: PanelHelpers) => upperFirst(cname(code, h));
const lowerFirst = (x: string) => (x ? x.charAt(0).toLowerCase() + x.slice(1) : x);

/** The row's All cell (same band and row, key "all", pooled), when this cell is a split sibling. */
function usualOf(inp: PanelCellInput, inputs: Map<string, PanelCellInput>): PanelCellInput | undefined {
  if (inp.pooled) return undefined;
  const [band, row] = inp.id.split(":");
  const u = inputs.get(`${band}:${row}:all`);
  // am61: the settled customers' All questions card is an index, never the four questions' usual (their panels stay as they were).
  return u && u.pooled && u.kind !== "settled_all" ? u : undefined;
}

/** Sibling split cells of a row (never its All cell). */
function siblingsOf(inp: PanelCellInput, inputs: Map<string, PanelCellInput>): PanelCellInput[] {
  const [band, row] = inp.id.split(":");
  return [...inputs.values()].filter((x) => !x.pooled && x.id.startsWith(`${band}:${row}:`));
}

export function buildPanels(inputs: Map<string, PanelCellInput>, h: PanelHelpers): Map<string, PositionPanel> {
  const panels = new Map<string, PositionPanel>();
  // Every card is a layout over the run's facts: no fact layer, no cards (the Map draws its cells with the generic panel).
  if (!h.facts) return panels;
  const ctx: Ctx = { h, inputs, ladder: h.facts.set.ladder };
  for (const inp of inputs.values()) {
    const p = buildPanel(inp, ctx);
    if (p) panels.set(inp.id, p);
  }
  // Tags, focus and details, against the row's All cell (same-key steps).
  for (const inp of inputs.values()) {
    const p = panels.get(inp.id);
    if (!p) continue;
    const u = usualOf(inp, inputs);
    const up = u ? panels.get(u.id) : undefined;
    finishPanel(inp, p, up, u, ctx);
  }
  // Panel 11's "Where it takes its picks" across the row's split cells.
  for (const inp of inputs.values()) {
    const p = panels.get(inp.id);
    if (!p?.rivals?.length || !(inp.kind === "buy" || inp.kind === "switching") || !FACT_CARD.has(inp)) continue;
    factByCell(inp, p, ctx);
  }
  // Tag sentiments the UI draws (set explicitly above where the direction is
  // not in the words), and the rival panels' own block labels.
  const tone = (steps: PanelStep[]) => {
    for (const s of steps) {
      if (s.tagUsual && !s.tagUsualTone) s.tagUsualTone = toneOfTag(s.tagUsual);
      if (s.tagRank && !s.tagRankTone) s.tagRankTone = toneOfTag(s.tagRank);
    }
  };
  for (const p of panels.values()) {
    tone(p.steps);
    for (const r of p.rivals ?? []) {
      tone(r.steps);
      r.stackLabel = r.focus ? "Where the gap opens" : "How the two compare";
      if (r.byCell?.length) r.byCellTitle = "Where it takes its picks";
    }
  }
  return panels;
}

const refsOf = (rows: PoolRow[], find: (r: PoolRow) => string, k = PANEL_REFS): AnswerRef[] =>
  spreadRefs(rows.map((r) => ({ id: r.code.response_id, find: find(r), model: r.model })), k);

/** Every card is built from the run's facts (FACT_LAYER_DESIGN_2026-11-17.md step 4); a card the fact layer refuses
 * (its answers are not exactly a scope's - a coding fault) is logged and left out: the Map draws its cell with the
 * generic panel. */
function buildPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel | undefined {
  try {
    return buildFactPanel(inp, ctx);
  } catch (e) {
    FACT_CARD.delete(inp);
    console.error(`[panel_build] ${inp.id}: not built from facts, left without a panel:`, e);
    return undefined;
  }
}

function buildFactPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel | undefined {
  switch (inp.kind) {
    case "buy":
    case "switching":
      return factPickPanel(inp, ctx);
    case "h2h":
      return factH2hPanel(inp, ctx);
    case "buyer_worry":
    case "customer_worry":
      return factWorryPanel(inp, ctx);
    case "looking_around":
      return factHoldPanel(inp, ctx);
    case "value":
      return factValuePanel(inp, ctx);
    case "problem":
      return factProblemPanel(inp, ctx);
    case "criteria":
      return factCriteriaPanel(inp, ctx);
    case "expansion":
      return factExpansionPanel(inp, ctx);
    case "business_case":
      return factCasePanel(inp, ctx);
    case "popular":
      return factPopularPanel(inp, ctx);
    case "learning":
      return factLearningPanel(inp, ctx);
    case "alongside":
      return factAlongsidePanel(inp, ctx);
    case "critic":
      return factCriticPanel(inp, ctx);
    case "premium":
      return factPremiumPanel(inp, ctx);
    case "habit":
      return factHabitPanel(inp, ctx);
    case "settled_all":
      return factSettledAllPanel(inp, ctx);
  }
}

/* ------------------------------ shared pieces ------------------------------ */

/** An answer's verdict quote, else a mention of the brand, else the brand. */
const verdictFind = (r: PoolRow, h: PanelHelpers) =>
  (r.code.quote ?? "").trim() || (r.code.premise_quote ?? "").trim() || (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === h.targetKey)?.brand || h.brand;

/** A product name as written, cleaned for display: no trade marks, no "from <maker>" tail. */
const cleanProduct = (x: string) => x.replace(/[®™]/g, "").replace(/\s+from\s+.+$/i, "").replace(/\s+/g, " ").trim();

/** The bucket for a pick that names no product of the brand. */
const noneName = (ctx: Ctx) => (ctx.ladder ? `No specific ${ctx.h.noun} named` : "No specific product named");

/** A product split worth a line: at least one named product, not only the no-product bucket. */
const namesAProduct = (items: { name: string }[]) => items.some((x) => !/^No specific /.test(x.name));

/** Letters of `short` appear in order inside `long` ("amex" in "americanexpress"). */
const isSubsequence = (short: string, long: string) => {
  let i = 0;
  for (const ch of long) if (ch === short[i]) i++;
  return i === short.length;
};

/** A brand's own name tokens: its canonical and display name, plus one-word
 * aliases that are a short form of that name ("amex"). A one-word alias that
 * is a product line ("sapphire" for a bank) is part of the product's name and
 * is never dropped from it. */
function nameTokens(name: string, ctx: Ctx): Set<string> {
  const e = ctx.h.resolve(name).entry;
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

/** The old product test's index (am43 / am44). No card reads it any more - the run's one product grouping
 * (facts/products.ts) carries the test; it is kept only for the fact layer harness's proof that products.ts reproduces
 * it (legacyProductIndex). */
const PICKED = new WeakMap<Map<string, PanelCellInput>, Map<string, { named: number; chosen: number; sent: number }>>();
function productIndex(ctx: Ctx): Map<string, { named: number; chosen: number; sent: number }> {
  const hit = PICKED.get(ctx.inputs);
  if (hit) return hit;
  const idx = new Map<string, { named: number; chosen: number; sent: number }>();
  PICKED.set(ctx.inputs, idx);
  const { h } = ctx;
  const nouns = nounToks(ctx);
  const ownOf = new Map<string, Set<string>>();
  const keyOf = (written: string): string | null => {
    const res = h.resolve(written);
    if (!res.key) return null;
    let own = ownOf.get(res.key);
    if (!own) ownOf.set(res.key, (own = nameTokens(res.key === h.targetKey ? h.brand : res.name ?? written, ctx)));
    const toks = [...new Set(famTokens(cleanProduct(written) || written).filter((t) => !own!.has(t) && !nouns.has(t)))].sort();
    return toks.length ? `${res.key}|${toks.join(" ")}` : null;
  };
  const seen = new Set<string>();
  for (const inp of ctx.inputs.values()) {
    // am59: the Premium vs basic cell's answers stay out (built after every other kind's index existed - no other panel's product list moves).
    // am60: the Habit cell's too.
    if (inp.kind === "premium" || inp.kind === "habit" || inp.kind === "settled_all") continue;
    for (const r of inp.rows) {
      const rules = r.code.decision_rules ?? [];
      if (!rules.length || seen.has(r.code.response_id)) continue;
      seen.add(r.code.response_id);
      const chosen = new Set<string>();
      const named = new Set<string>();
      // am44: a rule's `product` (where a stay / leave / worth-it verdict sends the buyer) counts for the tracker's own
      // brand only - its own rungs appear nowhere else; for a rival it also names programmes buyers are sent to
      // ("move the points to ..."), so a rival's product must be the pick or the choice of a rule.
      // A rival's product on such a rule is weaker evidence (`sent`, a higher bar below).
      const sent = new Set<string>();
      for (const d of rules)
        if ((d.product ?? "").trim()) {
          const k = keyOf(d.product!);
          if (k) (h.resolve(d.product!).key === h.targetKey ? chosen : sent).add(k);
        }
      for (const w of [r.code.top_pick ?? "", ...rules.map((d) => d.choice ?? "")]) {
        const k = w.trim() ? keyOf(w) : null;
        if (k) chosen.add(k);
      }
      for (const m of r.code.mentions ?? []) {
        const k = keyOf(m.brand);
        if (k) named.add(k);
      }
      for (const k of new Set([...named, ...chosen, ...sent])) {
        const t = idx.get(k) ?? { named: 0, chosen: 0, sent: 0 };
        t.named++;
        if (chosen.has(k)) t.chosen++;
        else if (sent.has(k)) t.sent++;
        idx.set(k, t);
      }
    }
  }
  return idx;
}
/** The old product test's index (am43 / am44), for the fact layer's proof that products.ts reproduces it. */
export function legacyProductIndex(inputs: Map<string, PanelCellInput>, h: PanelHelpers): Map<string, { named: number; chosen: number; sent: number }> {
  return productIndex({ h, inputs, ladder: true });
}

/** The category's own nouns, singular and plural ("card", "cards"). */
const nounToks = (ctx: Ctx) => new Set([...famTokens(ctx.h.noun), ...famTokens(ctx.h.plural)]);

const splitLine = (items: { name: string; num: PanelNum }[]): PanelText =>
  join(...items.flatMap((x, i) => [i > 0 ? " · " : null, { t: x.name, name: true as const }, " ", N(x.num)]));

/* ---------------------------- condition rows ---------------------------- */

interface CondWords {
  title: string;
  sub: string;
  subComp?: string;
  towardTitle: string;
  awayTitle: string;
  alsoToward: string;
  alsoAway: string;
  toWord: "To" | "Shown" | "Names";
  towardScope?: "rival_picked";
}

/** am37: a condition label's identity for merging - case, punctuation and the asker's "you" / "they" set aside. */
const condKey = (label: string) => condRowLabel(label).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Generic words that do not change what a condition says ("travel often" = "travel frequently"). */
const COND_SOFT = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "with", "is", "are", "be", "they", "their", "them", "theirs", "often", "frequently", "frequent", "regularly", "regular", "usually", "always", "mostly", "really", "very", "lot", "lots", "much", "many", "more", "most", "heavily", "heavy", "plenty", "want", "wants", "prefer", "prefers", "need", "needs", "like", "likes", "if", "when"]);
/** Content stems of a condition label (first five letters of each word that carries meaning). */
const condCore = (label: string) => [...new Set(condKey(label).split(" ").filter((w) => w && !COND_SOFT.has(w)).map((w) => w.slice(0, 5)))].sort().join(" ");

/** The line in a condition column with no row. */
const NO_SIDE_ROWS = "No condition stated often enough to list.";

/* ------------------------------- the kinds ------------------------------- */

const LOOK_BLOCK = new WeakMap<PositionPanel, PanelBlock>();

/** am38: what valuePanel hands its own step explanations (built in finishPanel, after the tags). */
const VALUE_EXTRA = new WeakMap<PositionPanel, { sections: PanelDetailSection[]; topRival?: string; byProduct: boolean }>();

const upperFirstIf = (on: boolean, x: string) => (on ? upperFirst(x) : x);
/** "seldom taught, in 26% of these answers" / "never taught". */
const offSpan = (tn: PanelNum): (string | PanelText[number])[] => (tn.pct > 0 ? [`${offChecklist(tn.pct)}, in `, N(tn), " of these answers"] : [offChecklist(0)]);

const checklistMark = (last: PanelNum, n: number) => ({ pct: last.pct, note: checklistMarkNote(last.value, n) });

const CRIT_GAP = new WeakMap<PositionPanel, string[]>();

/* ------------------- am31 round 2: the single-question kinds ------------------- */

/** "When a buyer asks <label>" - the label, else the quoted seed (question_labels.ts). */
const whenAsks = (inp: PanelCellInput, who: "buyer" | "customer", fallback: string) => `When ${who === "buyer" ? "a buyer" : "a customer"} asks ${inp.asked ?? fallback}, `;

/** An active brand the tracker analyzes (the brand table's set: analyzed entries only). */
function counted(name: string, h: PanelHelpers): boolean {
  const x = h.resolve(name);
  return x.status === "active" && (x.key === h.targetKey || x.entry?.analyzed !== false);
}

/** am60, Habit: a customer who buys you out of habit asks whether to stick with you or try something else (the
 * choice schema - a pick, it depends, no pick). One step on what the answer does, one on how often it suggests
 * another brand; the conditions split by the brand each rule chooses (toward = you); the brands suggested instead
 * and your own other products move into the second step's explanation (the looking-around pattern). */
const HABIT_SUGGESTED = new WeakMap<PositionPanel, PanelBlock>();

/* ================= the fact-built pick cards (FACT_LAYER_DESIGN_2026-11-17.md, step 4, first slice) =================
 *
 * The What to buy card (every buyer's cell and the all-buyers cell) and the Rivals' customers switching card are
 * LAYOUTS: every number on them is looked up from the run's fact book (facts/fact.ts) and carries its fact id; every
 * list is a selection (facts/selections.ts) and carries its selection id. Nothing below counts answers: a number's
 * example answers come from the fact's own answers (FactBook.answers), the only thing read off them.
 *
 * Rulings that land here: 7 (the all-buyers What to buy card is the buyer cards' question types, discovery + use
 * case), 8 (share of picks and the commit rate are out of picks of brands in analysis), 12 (a pick outside the
 * category is its own share, never "no single pick"), 14 (conditions come from the run's one grouping; the both-sides
 * pairs too), 15 (one product grouping, short names on the card), and the ratified competitor group (top three by
 * picks, then the head-to-head rivals, class brands out, an "Other" row; the average competitor = every listed
 * rival pooled).
 */

/** The run's fact layer, as the map hands it to the panel builder (analysis_map.ts). */
export interface PickFacts {
  set: AnswerFactSet;
  book: FactBook;
  sel: SelectionBook;
  /** The run has reason themes (the condition rows are themes; else the run's groups themselves). */
  themed: boolean;
}

interface FactCard {
  F: PickFacts;
  scope: Scope;
  /** The row's All card's scope (a buyer's card, one rival's customers). */
  usual?: Scope;
  comp: AnySelection;
  members: SelMember[];
  /** Another brand takes more picks here than you (the leader selection). */
  behind: boolean;
  /** The average competitor per step (the listed rivals pooled). */
  avg: Partial<Record<PanelStepKey, PanelNum>>;
  rowById: Map<string, PoolRow>;
  n: number;
}
const FACT_CARD = new WeakMap<PanelCellInput, FactCard>();
const ROWS_BY_ID = new WeakMap<Map<string, PanelCellInput>, Map<string, PoolRow>>();

const isFactKind = (k: PanelKind) => k === "buy" || k === "switching";

function rowsById(ctx: Ctx): Map<string, PoolRow> {
  let m = ROWS_BY_ID.get(ctx.inputs);
  if (!m) {
    m = new Map();
    for (const inp of ctx.inputs.values()) for (const r of inp.rows) m.set(r.code.response_id, r);
    for (const r of ctx.h.headline) m.set(r.code.response_id, r);
    ROWS_BY_ID.set(ctx.inputs, m);
  }
  return m;
}

/** A pick card's scope: the cell's question types (ruling 7 on the all-buyers What to buy card), its buying situation
 * or the brand being left; and the row's All card's scope. */
function pickScope(inp: PanelCellInput, F: PickFacts): { scope: Scope; usual?: Scope } {
  const f0 = F.set.facts.find((f) => f.responseId === inp.rows[0]?.code.response_id);
  if (inp.kind === "buy") {
    const types: QuestionType[] = ["discovery", "use_case"];
    if (inp.pooled) return { scope: { types } };
    return { scope: { types, situation: f0?.situation ?? null }, usual: { types } };
  }
  const types: QuestionType[] = ["switching"];
  if (inp.pooled) return { scope: { types } };
  return { scope: { types, rival: inp.key === "generic" ? "generic" : f0?.rival?.key ?? "__none__" }, usual: { types } };
}

const subj = (fc: FactCard, key: string) => (key === fc.F.set.target.key ? "you" : key);
const toRows = (fc: FactCard, fs: AnswerFact[]) => fs.map((a) => fc.rowById.get(a.responseId)).filter((r): r is PoolRow => !!r);

/** A number that IS a fact: its counts, its printed text and its id from the fact book; its example answers from the
 * fact's own answers. */
function fx(fc: FactCard, m: string, s: string, scope: Scope, unit: string, find: (r: PoolRow) => string, refs?: AnswerRef[]): PanelNum {
  const f = fc.F.book.fact(m, s, scope);
  const out = num(f.k, f.n, unit, refs ?? (f.k ? refsOf(toRows(fc, fc.F.book.answers(m, s, scope).hit), find) : undefined));
  out.value = f.text;
  out.fact = f.id;
  return out;
}

/** The average competitor on one measure: every listed rival's own fact, numerators over bases (ruling: "All listed
 * rivals"); its examples one from each rival in turn. */
function fxAvg(fc: FactCard, m: string, scope: Scope, unit: string, find: (key: string) => (r: PoolRow) => string): PanelNum {
  const keys = fc.members.map((x) => x.key);
  const per = keys.map((k) => fc.F.book.fact(m, subj(fc, k), scope));
  const a = averageCompetitor(per, m, "ruled");
  const hits = keys.map((k) => ({ k, rs: toRows(fc, fc.F.book.answers(m, subj(fc, k), scope).hit) }));
  const items: { id: string; find: string; model: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(0, ...hits.map((x) => x.rs.length)); i++)
    for (const h of hits) {
      const r = h.rs[i];
      if (!r || seen.has(r.code.response_id)) continue;
      seen.add(r.code.response_id);
      items.push({ id: r.code.response_id, find: find(h.k)(r), model: r.model });
    }
  const out = num(a.k, a.n, unit, spreadRefs(items, PANEL_REFS));
  out.value = printOf(MEASURE_BY_ID.get(m)!, a.k, a.n);
  out.fact = `avg(${m})|${fc.comp.id}${scopeKey(scope) === scopeKey(fc.scope) ? "" : `|${scopeKey(scope)}`}`;
  return out;
}

/** A condition subject (measure_book: "<head>/cond:<units>[>to:<key>]"). */
const condSub = (head: string, units: string[], to?: string, only?: string) => `${head}/cond:${[...units].sort().join("+")}${to ? `>to:${to}` : ""}${only ? `@${only}` : ""}`;

/** The pick card. */
function factPickPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { book, sel, set } = PF;
  const T = set.target.key;
  const { scope, usual } = pickScope(inp, PF);
  const all = book.rows(scope).length;
  const switching = inp.kind === "switching";
  const generic = switching && inp.key === "generic";
  const rival = inp.rivalName ?? inp.label;
  const comp = sel.selection("competitors", "you", scope);
  const members = comp.members as SelMember[];
  const leader = sel.selection("leader", "you", scope).members[0] as SelMember | undefined;
  const fc: FactCard = { F: PF, scope, usual, comp, members, behind: false, avg: {}, rowById: rowsById(ctx), n: all };
  FACT_CARD.set(inp, fc);
  const pf = (name: string) => (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || name;
  const youPicks = book.fact("share_of_picks", "you", scope);
  fc.behind = !!leader && leader.count > youPicks.k;
  const share = fx(fc, "share_of_picks", "you", scope, "picks", pf(h.brand));
  const commit = fx(fc, "commit_rate", "ai", scope, "answers", (r) => h.quoteOf(r) || r.code.top_pick || "");
  const named = fx(fc, "named", "you", scope, "answers", (r) => surfOf(r, T, h, false) ?? r.code.top_pick ?? h.brand);
  const recommended = fx(fc, "recommended", "you", scope, "answers", (r) => surfOf(r, T, h, true) ?? r.code.top_pick ?? h.brand);
  const converts = fx(fc, "converts", "you", scope, "recommending answers", pf(h.brand));
  const takers = sel.selection("takers", "you", scope);
  const showsList = takers.members.length > 0;
  const takingRest = members.filter((m) => m.count > 0);
  const other = comp.extras.other!;

  let claim: PanelText;
  if (switching) {
    const whose = inp.pooled ? "a rival's customer" : generic ? `a customer of another ${h.noun}` : `${article(rival)} ${rival} customer`;
    const picked = fx(fc, "picked", "you", scope, "answers", pf(h.brand));
    claim = join(`When ${whose} asks where to move, the AI recommends you in `, N(recommended), " of answers and picks you in ", youPicks.k === 0 ? "none" : N({ ...picked, value: pctOfWhole(picked) }), ".");
  } else if (knOf(commit)!.k < BRAND_FLOOR) {
    claim = join(`The AI commits to one ${h.noun} in `, N(commit), " of these answers.");
  } else {
    const rest = youPicks.k === youPicks.n ? "" : showsList && takingRest.length ? ` ${countWord(takingRest.length)} other ${takingRest.length === 1 ? "brand takes" : "brands take"} ${other.picks > 0 ? "most of " : ""}the rest.` : " Other brands take the rest.";
    claim = join(inp.pooled ? "Across all buyers you take " : "With this buyer you take ", N(share), " of the picks.", rest);
  }

  const conditions = factConditions(inp, fc, ctx, PICK_COND_WORDS(h.noun), {});
  const top = conditions?.toward[0];
  const lead = top
    ? join(
        attachedLead("choosing you", [top]),
        top.youPicked
          ? top.youPicked.pct === 0
            ? " It never makes you the pick in those answers."
            : top.youPicked.pct < 5
              ? F(" It almost never makes you the pick in those answers.", top.youPicked)
              : join(" About ", N(top.youPicked), " of those answers end with you as the pick.")
          : ""
      )
    : undefined;

  // The competitor group (ratified): steps carry each listed rival; named and recommended carry the Other row.
  const memberNum = (m: string, unit: string, rec: boolean) => (x: SelMember) => ({ name: x.name, num: fx(fc, m, subj(fc, x.key), scope, unit, (r) => surfOf(r, x.key, h, rec) ?? r.code.top_pick ?? x.name) });
  const otherRows = (m: string, rec: boolean): PanelOther | undefined => {
    if (!other.shown.length && !other.rest) return undefined;
    const rows = other.shown.map((x) => ({ name: x.name, num: fx(fc, m, subj(fc, x.key), scope, "answers", (r) => surfOf(r, x.key, h, rec) ?? r.code.top_pick ?? x.name) }));
    rows.sort((a, b) => knOf(b.num)!.k - knOf(a.num)!.k || a.name.localeCompare(b.name));
    return { rows, ...(other.rest ? { rest: moreBrands(other.rest) } : {}), selection: comp.id };
  };
  const steps: PanelStep[] = [
    { key: "named", label: "Named", here: named, ...(members.length ? { rivals: members.map(memberNum("named", "answers", false)) } : {}), ...(members.length ? optOther(otherRows("named", false)) : {}) },
    { key: "recommended", label: "Recommended", here: recommended, ...(members.length ? { rivals: members.map(memberNum("recommended", "answers", true)) } : {}), ...(members.length ? optOther(otherRows("recommended", true)) : {}) },
    { key: "converts", label: "Recommendations that end as the pick", here: converts, ...(members.length ? { rivals: members.map((x) => ({ name: x.name, num: fx(fc, "converts", subj(fc, x.key), scope, "recommending answers", pf(x.name)) })) } : {}) },
  ];
  if (members.length) {
    fc.avg.named = fxAvg(fc, "named", scope, "answers, the competitors shown added up", (k) => (r) => surfOf(r, k, h, false) ?? r.code.top_pick ?? "");
    fc.avg.recommended = fxAvg(fc, "recommended", scope, "answers, the competitors shown added up", (k) => (r) => surfOf(r, k, h, true) ?? r.code.top_pick ?? "");
    fc.avg.converts = fxAvg(fc, "converts", scope, "recommending answers, the competitors shown added up", () => (r) => h.quoteOf(r) || r.code.top_pick || "");
  }

  const rivals = members.map((m) => factRival(inp, fc, ctx, m, { named, recommended, converts }, conditions));
  const hasRival = new Set(rivals.map((r) => r.name));
  const competitors: PanelBlock | undefined = showsList
    ? {
        title: "Who takes the picks",
        sub: `Share of the picks ${switching ? "from these customers" : "here"}. Open a rival to see how it gets them.`,
        selection: comp.id,
        rows: [
          ...[...members.map((x) => ({ key: x.key, name: x.name, h2h: !!x.headToHead })), { key: T, name: h.brand, h2h: false }]
            .map((b) => ({ b, n: fx(fc, "share_of_picks", subj(fc, b.key), scope, "picks", pf(b.name)) }))
            .sort((x, y) => knOf(y.n)!.k - knOf(x.n)!.k || x.b.name.localeCompare(y.b.name))
            .map(({ b, n }): PanelBrandRow => {
              const isYou = b.key === T;
              return { name: isYou ? h.brand : b.name, ...(isYou ? { you: true as const } : {}), num: n, ...(!isYou && hasRival.has(b.name) ? { open: true as const } : {}), ...(b.h2h ? { tag: "head-to-head" } : {}) };
            }),
          ...(other.shown.length || other.rest || other.picks
            ? [
                {
                  name: "Other",
                  num: fx(fc, "slice_share_of_picks", `ai/slice:pick:in_analysis&!pick:you${members.map((x) => `&!pick:${x.key}`).join("")}`, scope, "picks", (r) => h.quoteOf(r) || r.code.top_pick || ""),
                  other: {
                    rows: other.shown
                      .map((x) => ({ name: x.name, num: fx(fc, "share_of_picks", subj(fc, x.key), scope, "picks", pf(x.name)) }))
                      .sort((a, b) => knOf(b.num)!.k - knOf(a.num)!.k || a.name.localeCompare(b.name)),
                    ...(other.rest ? { rest: moreBrands(other.rest) } : {}),
                    selection: comp.id,
                  },
                } as PanelBrandRow,
              ]
            : []),
        ],
      }
    : undefined;

  // Lines.
  const lines: PanelLine[] = [];
  const shareLine: PanelLine = { key: "share", label: "Your share of the picks", value: join(NK("you", share), " here") };
  if (usual) shareLine.value = join(NK("you", share), " here · ", NK("usual", fx(fc, "share_of_picks", "you", usual, "picks", pf(h.brand))), switching ? " across all rivals' customers" : " across all buyers");
  const avgShare = members.length >= 2 ? fxAvg(fc, "share_of_picks", scope, "picks, per listed competitor", (k) => pf(set.nameOf(k))) : undefined;
  const youPicked = fx(fc, "picked", "you", scope, "answers", pf(h.brand));
  const avgPicked = members.length >= 2 ? fxAvg(fc, "picked", scope, "answers, per listed competitor", (k) => pf(set.nameOf(k))) : undefined;
  if (avgShare) shareLine.value = join(shareLine.value, " · the average competitor ", NK("avg", avgShare));
  const pickedLine: PanelLine = { key: "picked", label: "Picked, of all answers", value: avgPicked ? join(NK("you", youPicked), " · the average competitor ", NK("avg", avgPicked)) : join(NK("you", youPicked)) };
  const commitLine: PanelLine = { key: "commit", label: `The AI commits to one ${h.noun}`, value: join("In ", NK("rate", commit), " of answers") };
  lines.push(commitLine, shareLine, pickedLine);
  if (youPicks.k >= 5 && set.ladder) {
    // Out of every pick of you: the products, and the picks naming no specific one, as rows of their own.
    const prods = sel.selection("product_picks", "you", scope, { brand: T, top: 2 });
    if ((prods.members as SelMember[]).some((x) => x.key !== "~none")) {
      const items = (prods.members as SelMember[]).map((x) => ({ name: x.key === "~none" ? noneName(ctx) : x.name, num: fx(fc, "pick_product_share", `ai/slice:pickprod:${x.key === "~none" ? "none" : x.key}`, { ...scope, when: "pick:you" }, "of your picks", (r) => r.code.top_pick || x.name) }));
      lines.push({ key: "products", label: `Which of your ${h.plural} it picks`, value: splitLine(items), selection: prods.id });
    }
  }
  const linesComp: PanelLine[] = [commitLine, shareLine, pickedLine];

  // What the answer weighs.
  const weighs = factWeighs(inp, fc, ctx, [{ say: "come up here", unit: "answers", tone: "neutral" }], WEIGHS_SUB_ALL);
  const negs = inp.lifts.filter((l) => l.value < 0).sort((a, b) => a.value - b.value).slice(0, 1);
  const poss = inp.lifts.filter((l) => l.value > 0).sort((a, b) => b.value - a.value).slice(0, 1);
  const weighsComp =
    negs.length || poss.length
      ? factWeighs(
          inp,
          fc,
          ctx,
          [
            { title: "When it picks you", say: "pick you", tone: "good", slice: "pick:you", brand: T, ...(poss.length ? { lead: poss[0].label } : {}) },
            { title: `When it picks another ${h.noun}`, say: `pick another ${h.noun}`, tone: "bad", slice: "pick:other", other: true, ...(negs.length ? { lead: negs[0].label } : {}) },
          ],
          WEIGHS_SUB_SIDES
        ) ?? weighs
      : weighs;

  const hereKey = inp.pooled ? "You" : switching ? (generic ? `You, with customers of another ${h.noun}` : `You, with ${possOf(rival)} customers`) : "You, with this buyer";
  const usualInp = usualOf(inp, ctx.inputs);
  return {
    kind: inp.kind,
    claim,
    ...(lead ? { lead } : {}),
    ...(usualInp ? { usualCellId: usualInp.id, usualKey: switching ? "You, across all rivals' customers" : "You, across all buyers" } : {}),
    hereKey,
    stackLabel: fc.behind ? (switching ? "Where you lose these buyers" : inp.pooled ? "Where you lose buyers" : "Where you lose this buyer") : switching ? "Where you hold these buyers" : inp.pooled ? "Where you hold buyers" : "Where you hold this buyer",
    steps,
    ...(members.length ? { compare: true as const, competitorOrder: members.map((x) => x.name), competitorSelection: comp.id } : {}),
    ...(competitors ? { competitors } : {}),
    ...(conditions ? { conditions } : {}),
    lines,
    linesComp,
    ...(avgShare && avgPicked ? { avgShare, avgPicked } : {}),
    ...(weighs ? { weighs } : {}),
    ...(weighsComp ? { weighsComp } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
}

const optOther = (o: PanelOther | undefined) => (o ? { other: o } : {});
const moreBrands = (n: number) => `${n} more brand${n === 1 ? "" : "s"}`;
const pctOfWhole = (n: PanelNum) => {
  const kn = knOf(n)!;
  return pctOf(kn.n > 0 ? kn.k / kn.n : 0);
};
/** A brand's surface as the answer names it (recommended only, when asked), for the example answers' highlight. */
function surfOf(r: PoolRow, key: string, h: PanelHelpers, rec: boolean): string | undefined {
  return (r.code.mentions ?? []).find((m) => (!rec || m.framing === "recommended") && h.resolve(m.brand).key === key)?.brand;
}

const PICK_COND_WORDS = (noun: string): CondWords => ({
  title: `When the AI says to choose you, and when another ${noun}`,
  sub: `Share of these answers that say "choose this ${noun} if the buyer...". The grey bar shows how often it comes up where the AI says it both ways.`,
  subComp: `Share of these answers that say "choose this ${noun} if the buyer...". The names after each row are the ones it says to choose instead.`,
  towardTitle: "Choose you if",
  awayTitle: `Choose another ${noun} if`,
  alsoToward: `Also said for another ${noun}`,
  alsoAway: "Also said for you",
  toWord: "To",
});

/** "What the answer weighs" from facts: the topics are the weighs_shown selection, each row an "argues" fact on the
 * column's answers (a slice); the other column's share of the same topic beside it. */
function factWeighs(
  inp: PanelCellInput,
  fc: FactCard,
  ctx: Ctx,
  sides: { title?: string; say: string; tone: PanelTone; unit?: string; slice?: string; lead?: string; brand?: string; other?: boolean }[],
  sub: string
): PanelWeighs | undefined {
  const { h } = ctx;
  const { sel } = fc.F;
  const s = sel.selection("weighs_shown", "ai", fc.scope, { sides: sides.map((x) => ({ ...(x.slice ? { slice: x.slice } : {}), ...(x.lead ? { lead: x.lead } : {}) })) });
  const cols = s.members as WeighsColumn[];
  const versus = !!s.extras.versus;
  const factOf = (si: number, code: string) => {
    const sd = sides[si];
    // A side that is the tracker's picks / another brand's picks reads the "argues when (another brand is) picked"
    // measures (ruling 2); a plain side reads "argues" on the column's slice.
    if (sd.brand) return { m: "argues_when_picked", s: `${subj(fc, sd.brand)}/arg:${code}`, scope: fc.scope };
    if (sd.other) return { m: "argues_when_other_picked", s: `you/arg:${code}`, scope: fc.scope };
    return { m: "argues", s: `ai/arg:${code}`, scope: sd.slice ? { ...fc.scope, when: sd.slice } : fc.scope };
  };
  let any = false;
  const columns: PanelWeighs["columns"] = cols.map((c, si) => {
    const sd = sides[si];
    const col = { ...(sd.title ? { title: sd.title } : {}), tone: sd.tone };
    if (c.few) return { ...col, rows: [], note: weighsFewNote(sd.say) };
    if (!c.codes.length) return { ...col, rows: [], note: WEIGHS_NONE };
    any = true;
    return {
      ...col,
      rows: c.codes.map(({ code }) => {
        const a = factOf(si, code);
        const os = versus ? sides[1 - si] : null;
        const o = os ? factOf(1 - si, code) : null;
        return {
          name: clabel(code, h),
          num: fx(fc, a.m, a.s, a.scope, sd.unit ?? `answers that ${sd.say}`, () => code),
          ...(os && o && os.title ? { other: { label: lowerFirst(os.title), num: fx(fc, o.m, o.s, o.scope, os.unit ?? `answers that ${os.say}`, () => code) } } : {}),
        };
      }),
    };
  });
  if (!any) return undefined;
  return { title: WEIGHS_TITLE, sub: versus ? WEIGHS_SUB_VERSUS : sub, columns, selection: s.id };
}

/** The condition rows from facts (rulings 4 and 14): the rows are the conditions_shown selection of each side, each
 * number a condition fact; "Also said for ..." is the other side's own row (same reason under near-identical names)
 * or, under the run's one grouping, the same condition stated for the other side (the cond_pairs selection). */
function factConditions(
  inp: PanelCellInput,
  fc: FactCard,
  ctx: Ctx,
  words: CondWords,
  o: {
    onlyTo?: string;
    towardRows?: PanelCondition[];
    /** "Of these answers, you are the pick" on rows of 5+ answers (default on: the pick cards). */
    pickKind?: boolean;
    /** The toward rows count only the answers in this slice (a lost-with-an-exception card: the answers that pick the
     * rival); their base stays every answer of the card. */
    towardOnly?: string;
    /** The toward rows' examples carry the rival they pick. */
    pickedStamp?: string;
    /** The grouping the rows read (default: the run's themes, else its groups). */
    flavor?: CondFlavor;
    /** Both-ways pairs ("Also said for ..." from the run's one grouping): on by default; off where the card never
     * drew them (am24: the pick contests only - Habit is not one). */
    pairs?: boolean;
    /** What to use alongside you: an away row's destinations are the products its rules name (cond_cards), and an away
     * row whose products are mostly the tracker's own sits with "something of yours" (the conditions_shown ownSplit). */
    toCards?: boolean;
    ownSplit?: boolean;
    /** The toward rows' products count products the AI names and never picks (the settled cards: nothing is picked). */
    namedProducts?: boolean;
  }
): PanelConditions | undefined {
  const { h } = ctx;
  const { book, sel, set, themed } = fc.F;
  const scope = fc.scope;
  const rows = book.rows(scope);
  if (!rows.some((f) => f.conds !== null)) return undefined;
  const flavor: CondFlavor = o.flavor ?? (themed ? "themed" : "group");
  const grouping = flavor === "themed" ? "theme" : flavor === "tierwide" ? "tier" : "group";
  const pickKind = o.pickKind ?? true;
  // The both-sides pairs are conditions stated for both brands-sides; the tier rows (premium / basic) have none.
  const pairs = flavor === "tierwide" || o.pairs === false ? [] : (sel.selection("cond_pairs", "ai", scope).members as unknown as { key: string; toward: string[]; away: string[] }[]);
  /** The theme a pair's half falls in (most of its statements; ties lowest) - a themed row carries the pair when the row
   * is that theme. */
  const halfTheme = (units: string[]) => {
    const tally = new Map<string, number>();
    const us = new Set(units);
    for (const f of rows) for (const c of f.conds ?? []) if (us.has(c.unit) && c.theme) tally.set(c.theme, (tally.get(c.theme) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  };
  const pairOther = (side: "toward" | "away", units: string[]): string[] => {
    const us = new Set(units);
    const out = new Set<string>();
    for (const p of pairs) {
      const mine = side === "toward" ? p.toward : p.away;
      const hit = themed ? us.has(halfTheme(mine) ?? "") : mine.some((u) => us.has(u));
      if (hit) for (const u of side === "toward" ? p.away : p.toward) out.add(u);
    }
    return [...out];
  };
  const skip = new Set<string>();
  /** The answer's statement of the row (its units merged), with how strongly it also points the other way (am21). */
  const stOf = (f: AnswerFact, units: Set<string>, side: "toward" | "away") => {
    const st = (f.conds ?? []).filter((c) => units.has(c.unit));
    const keys = new Set(st.flatMap((c) => c.keys));
    const otherSide = (f.conds ?? []).filter((c) => c.side !== side && c.grouping === grouping);
    const mixed = otherSide.some((c) => c.keys.some((k) => keys.has(k))) ? 2 : otherSide.length ? 1 : 0;
    return { said: st[0]?.said ?? "", cards: [...new Set(st.flatMap((c) => c.cards))], cardTo: st.flatMap((c) => c.cardTo), toKeys: [...new Set(st.flatMap((c) => c.toKeys))], mixed };
  };
  const build = (side: "toward" | "away"): { rows: PanelCondition[]; selection: string } => {
    const only = side === "toward" ? o.towardOnly : undefined;
    const s = sel.selection("conditions_shown", "ai", scope, { side, flavor, ...(o.onlyTo && side === "away" ? { to: o.onlyTo } : {}), ...(only ? { towardOnly: only } : {}), ...(o.ownSplit ? { ownSplit: true } : {}) });
    const out: PanelCondition[] = [];
    for (const m of s.members as CondRow[]) {
      const units = new Set(m.units);
      const sub = condSub("ai", m.units, side === "away" ? o.onlyTo : undefined, only);
      const f = book.fact("cond_share", sub, scope);
      const cands = book.answers("cond_share", sub, scope).hit.map((a) => {
        const st = stOf(a, units, side);
        const r = fc.rowById.get(a.responseId);
        const cards = o.onlyTo ? st.cards.filter((_, i) => st.cardTo[i] === set.nameOf(o.onlyTo!)) : st.cards;
        return { id: a.responseId, find: st.said, model: r?.model ?? a.engine.id, cards, mixed: st.mixed };
      });
      // Toward rows go first and record their examples; an away row never reuses one (am23). An away row whose every
      // answer is already shown toward is not drawn.
      let refs = pickRefs(cands, m.label, PANEL_REFS, side === "away" ? skip : undefined);
      if (!refs.length) continue;
      if (side === "toward" && o.pickedStamp) refs = refs.map((r) => ({ ...r, picked: o.pickedStamp }));
      if (side === "toward") for (const r of refs) skip.add(r.responseId);
      const share = num(f.k, f.n, "answers", refs);
      share.value = f.text;
      share.fact = f.id;
      const row: PanelCondition = { text: m.label, share };
      if (side === "away") {
        const wallUnit = m.units.some((u) => u.startsWith("t:"));
        if ((wallUnit || m.count >= WALL_ROW_MIN) && isWallWording([m.raw ?? m.label], h.brand)) row.wall = true;
      }
      if (side === "toward") {
        const prods = sel.selection("cond_products", "ai", scope, { units: m.units, ...(o.namedProducts ? { named: true } : {}) });
        if (prods.members.length) row.products = (prods.members as SelMember[]).map((x) => x.name);
      } else if (o.toCards) {
        const dest = sel.selection("cond_cards", "ai", scope, { units: m.units });
        const to = (dest.members as SelMember[]).map((x) => {
          const dsub = `ai/cond:${[...m.units].sort().join("+")}>card:${x.key}`;
          const d = book.fact("cond_card", dsub, scope);
          const hits = book.answers("cond_card", dsub, scope).hit;
          const n = num(d.k, d.n, "answers naming a destination", pickRefs(hits.map((a) => { const st = stOf(a, units, side); return { id: a.responseId, find: st.said, model: fc.rowById.get(a.responseId)?.model ?? a.engine.id, cards: st.cards.filter((c) => cardKey(c) === x.key) }; }), m.label, PANEL_REFS));
          n.value = d.text;
          n.fact = d.id;
          return { name: x.name, num: n };
        });
        if (to.length) row.to = to;
      } else if (!o.onlyTo) {
        const dest = sel.selection("cond_destinations", "ai", scope, { units: m.units });
        const to = (dest.members as SelMember[]).map((x) => {
          const dsub = condSub(x.key, m.units);
          const d = book.fact("cond_dest", dsub, scope);
          const hits = book.answers("cond_dest", dsub, scope).hit;
          const n = num(d.k, d.n, "answers naming a destination", pickRefs(hits.map((a) => { const st = stOf(a, units, side); return { id: a.responseId, find: st.said, model: fc.rowById.get(a.responseId)?.model ?? a.engine.id, cards: st.cards.filter((_, i) => st.cardTo[i] === x.name) }; }), m.label, PANEL_REFS));
          n.value = d.text;
          n.fact = d.id;
          return { name: x.name, num: n };
        });
        if (to.length) row.to = to;
      }
      if (pickKind && f.k >= PICKED_MIN) {
        const ysub = condSub("ai", m.units, side === "away" ? o.onlyTo : undefined, only);
        const y = book.fact("cond_you_picked", ysub, scope);
        const hits = book.answers("cond_you_picked", ysub, scope).hit;
        const n = num(y.k, y.n, "answers", pickRefs(hits.map((a) => ({ id: a.responseId, find: stOf(a, units, side).said, model: fc.rowById.get(a.responseId)?.model ?? a.engine.id })), m.label, PANEL_REFS));
        n.value = y.text;
        n.fact = y.id;
        row.youPicked = n;
      }
      // The same condition stated for the other side, under the run's one grouping (a twin row below overrides it).
      const ou = pairOther(side, m.units);
      if (ou.length) {
        // The other side's own share: an away row's other side is the toward rows, under their own filter.
        const osub = condSub("ai", ou, undefined, side === "away" ? o.towardOnly : undefined);
        const a = book.fact("cond_share", osub, scope);
        if (a.k) {
          const n = num(a.k, a.n, "answers", pickRefs(book.answers("cond_share", osub, scope).hit.map((x) => ({ id: x.responseId, find: (x.conds ?? []).find((c) => ou.includes(c.unit))?.said ?? "", model: fc.rowById.get(x.responseId)?.model ?? x.engine.id })), m.label, PANEL_REFS));
          n.value = a.text;
          n.fact = a.id;
          row.both = { either: n };
        }
      }
      out.push(row);
    }
    return { rows: out, selection: s.id };
  };
  const towardB = o.towardRows ? null : build("toward");
  const toward = o.towardRows ?? towardB!.rows;
  if (o.towardRows) for (const r of o.towardRows) for (const x of r.share.refs ?? []) skip.add(x.responseId);
  const awayB = build("away");
  const away = awayB.rows;
  // A reason listed on both sides shows the other side's own row share, exactly.
  const tRow = new Map(toward.map((r) => [condCore(r.text), r]));
  for (const a of away) {
    const t = condCore(a.text) ? tRow.get(condCore(a.text)) : undefined;
    if (!t) continue;
    a.both = { either: t.share };
    if (!o.towardRows) t.both = { either: a.share };
  }
  return {
    ...words,
    grouped: themed,
    toward,
    away,
    selections: { ...(towardB ? { toward: towardB.selection } : {}), away: awayB.selection },
    ...(toward.length + away.length === 0 ? { note: NO_CONDITION_ROWS } : {}),
    ...(toward.length === 0 && away.length > 0 ? { towardNote: NO_SIDE_ROWS } : {}),
    ...(away.length === 0 && toward.length > 0 ? { awayNote: NO_SIDE_ROWS } : {}),
  };
}

/** One listed rival's own card inside a pick card, from facts. */
function factRival(inp: PanelCellInput, fc: FactCard, ctx: Ctx, m: SelMember, you: { named: PanelNum; recommended: PanelNum; converts: PanelNum }, cellConds: PanelConditions | undefined): PanelRival {
  const { h } = ctx;
  const { book, sel, set } = fc.F;
  const scope = fc.scope;
  const key = m.key;
  const R = m.name;
  const T = set.target.key;
  const pf = (name: string) => (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || name;
  const theirShare = fx(fc, "share_of_picks", key, scope, "picks", pf(R));
  const myShare = fx(fc, "share_of_picks", "you", scope, "picks", pf(h.brand));
  const claim = join(`${R} takes `, N(theirShare), " of the picks here. You take ", N(myShare), ".");
  const them = {
    named: fx(fc, "named", key, scope, "answers", (r) => surfOf(r, key, h, false) ?? R),
    recommended: fx(fc, "recommended", key, scope, "answers", (r) => surfOf(r, key, h, true) ?? r.code.top_pick ?? R),
    converts: fx(fc, "converts", key, scope, "recommending answers", pf(R)),
  };
  const recR = knOf(them.recommended)!.k;
  const recY = knOf(you.recommended)!.k;
  const missing: string[] = [];
  const steps: PanelStep[] = [];
  const stepOf = (k: PanelStepKey, label: string, y: PanelNum, r: PanelNum): PanelStep => ({ key: k, label, here: y, rivals: [{ name: R, num: r }], tagRank: duelTag(knOf(y)!, knOf(r)!, R).tag });
  steps.push(stepOf("named", "Named", you.named, them.named));
  steps.push(stepOf("recommended", "Recommended", you.recommended, them.recommended));
  if (recR >= 10) steps.push(stepOf("converts", "Recommendations that end as the pick", you.converts, them.converts));
  else missing.push("how its recommendations end");
  let focus: PanelStepKey | undefined;
  for (const s of steps) {
    if (duelTag(knOf(s.here!)!, knOf(s.rivals![0].num)!, R).rivalLeads) {
      s.tagRank = TAG_GAP_OPENS;
      focus = s.key;
      break;
    }
  }
  const details: PanelRival["details"] = {};
  const duelDir = (y: PanelNum, r: PanelNum): StepDir => {
    const d = duelTag(knOf(y)!, knOf(r)!, R);
    return d.rivalLeads ? -1 : d.tag === "Even" ? 0 : 1;
  };
  const nnrR = book.fact("named_not_recommended", key, scope);
  const nnrY = book.fact("named_not_recommended", "you", scope);
  if (nnrR.k + nnrY.k >= 5) {
    const rowsD: RivalStepDetail["rows"] = [
      { label: "Named but not recommended", rival: fx(fc, "named_not_recommended", key, scope, "answers", (r) => surfOf(r, key, h, false) ?? R), you: fx(fc, "named_not_recommended", "you", scope, "answers", (r) => surfOf(r, T, h, false) ?? h.brand) },
    ];
    if (nnrR.k >= 5 && nnrY.k >= 5)
      rowsD.push({
        label: `Of those, named as ${article(h.noun)} ${h.noun} to avoid`,
        rival: fx(fc, "negative_when_named_not_recommended", key, scope, "answers", (r) => surfOf(r, key, h, false) ?? R),
        you: fx(fc, "negative_when_named_not_recommended", "you", scope, "answers", (r) => surfOf(r, T, h, false) ?? h.brand),
      });
    const t = steps[0].tagRank ?? "Even";
    details.named = { heading: t === "Even" ? "No gap at this step" : t === TAG_GAP_OPENS || t === `${R} leads` ? `${R} is named more often than you` : `You are named more often than ${R}`, body: namedLine(duelDir(you.named, them.named), R), rows: rowsD };
  } else missing.push("who is named without a recommendation");
  if (recR >= 5 && recY >= 5) {
    const both = book.fact("slice_share", `ai/slice:rec:${key}&rec:you`, scope);
    const t = steps[1].tagRank ?? "Even";
    details.recommended = {
      heading: t === "Even" ? "No gap at this step, but this is where you part" : t === TAG_GAP_OPENS || t === `${R} leads` ? `${R} is recommended more often than you` : `You are recommended more often than ${R}`,
      body: recommendedLine(duelDir(you.recommended, them.recommended), R),
      ...(both.k >= 5
        ? {
            both: join(
              "The AI recommends both of you in ",
              N(fx(fc, "slice_share", `ai/slice:rec:${key}&rec:you`, scope, "answers", pf(R))),
              ` of answers. In those it picks ${R} `,
              N(fx(fc, "slice_share", `ai/slice:pick:${key}`, { ...scope, when: `rec:${key}&rec:you` }, "answers recommending both", pf(R))),
              " of the time and you ",
              N(fx(fc, "slice_share", "ai/slice:pick:you", { ...scope, when: `rec:${key}&rec:you` }, "answers recommending both", pf(h.brand))),
              "."
            ),
          }
        : {}),
    };
  } else missing.push("what happens to its recommendations");
  if (recR >= 10 && recY >= 5) {
    const rc = knOf(them.converts)!;
    const yc = knOf(you.converts)!;
    const rr = rc.n ? rc.k / rc.n : 0;
    const yr = yc.n ? yc.k / yc.n : 0;
    const ratio = yr > 0 ? rr / yr : 0;
    details.converts = {
      heading:
        rr > yr && ratio >= 1.5
          ? `When it has to name one ${h.noun}, it names ${R} ${ratio >= 2.5 ? `${Math.round(ratio)} times` : ratio >= 1.8 ? "twice" : "more"} as often`
          : yr > rr && rr > 0 && yr / rr >= 1.5
            ? `When it has to name one ${h.noun}, it names you more often`
            : "The two convert their recommendations at a similar rate",
      body: convertsLine(duelDir(you.converts, them.converts), `${possOf(R)} do`),
      outcomes: [factOutcome(fc, ctx, key, R, false), factOutcome(fc, ctx, T, h.brand, true)],
      outcomeLabels: OUTCOME_LABELS(h.noun),
    };
  }
  const conditions = cellConds ? factConditions(inp, fc, ctx, { title: `When the AI says to choose ${R}, and when you`, sub: `Share of these answers that say "choose this ${h.noun} if the buyer...". The rows for ${R} count only the answers that send the buyer to it.`, towardTitle: "Choose you if", awayTitle: `Choose ${R} if`, alsoToward: `Also said for ${R}`, alsoAway: "Also said for you", toWord: "To" }, { onlyTo: key, towardRows: cellConds.toward }) : undefined;
  const a = conditions?.away ?? [];
  const t = conditions?.toward ?? [];
  const lead = a.length || t.length ? join(a.length ? attachedLead(`choosing ${R}`, a.slice(0, 2), "answers") : null, a.length && t.length ? " " : null, t.length ? attachedLead("choosing you", t.slice(0, 2), "answers") : null) : undefined;
  const lines: PanelLine[] = [];
  if (set.ladder) {
    // The brand's most picked product, out of every pick of it (a pick naming no specific product counts in the base).
    const one = (k: string, of: string) => {
      const p = sel.selection("product_picks", "you", scope, { brand: k, top: 3 });
      const x = (p.members as SelMember[]).find((m) => m.key !== "~none");
      return x ? { name: x.name, num: fx(fc, "pick_product_share", `ai/slice:pickprod:${x.key}`, { ...scope, when: k === T ? "pick:you" : `pick:${k}` }, of, (r) => r.code.top_pick || x.name), selection: p.id } : undefined;
    };
    const rp = one(key, `picks of ${R}`);
    const yp = book.fact("share_of_picks", "you", scope).k ? one(T, "of your picks") : undefined;
    if (rp || yp) lines.push({ label: `Which ${h.plural} it picks`, value: join(rp ? join(`${R}: ${rp.name} `, N(rp.num)) : null, rp && yp ? " · " : null, yp ? join(`You: ${yp.name} `, N(yp.num)) : null), selection: [rp?.selection, yp?.selection].filter(Boolean).join(" ; ") });
  }
  // What the answer weighs when it picks you and when it picks R. Whether the block is drawn, and the topic leading a
  // column too thin to size against the other, still come from the Map's own argument list for this rival
  // (Position.brands[].here - the Map moves onto the fact layer in step 5); the topics and every number are facts.
  const here = inp.brands?.find((b) => b.name === R)?.here;
  const args = here?.args ?? [];
  const posA = args.filter((l) => l.value > 0).sort((x, y) => y.value - x.value)[0];
  const negA = args.filter((l) => l.value < 0).sort((x, y) => x.value - y.value)[0];
  const weighs =
    posA || negA || here?.argsRows?.length
      ? factWeighs(inp, fc, ctx, [
          { title: "When it picks you", say: "pick you", tone: "good", slice: "pick:you", brand: T, ...(negA ? { lead: negA.label } : {}) },
          { title: `When it picks ${R}`, say: `pick ${R}`, tone: "bad", slice: `pick:${key}`, brand: key, ...(posA ? { lead: posA.label } : here?.argsRows?.length ? { lead: here.argsRows[0].label } : {}) },
        ], WEIGHS_SUB_SIDES)
      : undefined;
  return {
    name: R,
    full: true,
    claim,
    ...(lead ? { lead } : {}),
    steps,
    ...(focus ? { focus } : {}),
    ...(Object.keys(details).length ? { details } : {}),
    ...(conditions ? { conditions } : {}),
    lines,
    ...(weighs ? { weighs } : {}),
    ...(missing.length ? { thin: THIN_RIVAL(R, missing.join(" or ")) } : {}),
  };
}

const OUTCOME_LABELS = (noun: string) => ({ lost: `lose to another ${noun}`, none: "no single pick", outside: "a pick outside the category" });

/** What happens to one brand's recommendations that do not end as its pick (rulings 8 and 12): another brand in
 * analysis is the pick, there is no pick, the pick is outside the category. */
function factOutcome(fc: FactCard, ctx: Ctx, key: string, name: string, isYou: boolean, scope: Scope = fc.scope) {
  const { h } = ctx;
  const s = subj(fc, key);
  return {
    name,
    ...(isYou ? { you: true as const } : {}),
    lost: fx(fc, "recommended_lost", s, scope, "recommending answers", (r) => r.code.top_pick || name),
    none: fx(fc, "recommended_no_pick", s, scope, "recommending answers", (r) => verdictFind(r, h)),
    outside: fx(fc, "recommended_outside_category", s, scope, "recommending answers", (r) => r.code.top_pick || name),
  };
}

/** The pooled outcome of the listed rivals (the average competitor), each a fact of its own measure pooled. */
function factOutcomeAvg(fc: FactCard, ctx: Ctx, name: string, extra: { you?: true; usual?: true }) {
  const { h } = ctx;
  return {
    name,
    ...extra,
    lost: fxAvg(fc, "recommended_lost", fc.scope, "recommending answers", (k) => (r) => r.code.top_pick || fc.F.set.nameOf(k)),
    none: fxAvg(fc, "recommended_no_pick", fc.scope, "recommending answers", () => (r) => verdictFind(r, h)),
    outside: fxAvg(fc, "recommended_outside_category", fc.scope, "recommending answers", (k) => (r) => r.code.top_pick || fc.F.set.nameOf(k)),
  };
}

/** The step explanations of a pick card, from facts (the shapes stepDetailsOf builds for these cards). */
function factStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const fc = FACT_CARD.get(inp)!;
  if (fc.n < DETAIL_MIN) return;
  const { h } = ctx;
  const { book, sel, set } = fc.F;
  const T = set.target.key;
  const scope = fc.scope;
  const step = (k: PanelStepKey) => p.steps.find((s) => s.key === k && !!s.here);
  const rate = (x: KN) => (x.n > 0 ? x.k / x.n : 0);
  const dirOf = (a: KN, b: KN): StepDir => (rate(a) === 0 && rate(b) > 0 ? -1 : usualDir(a, b));
  const kn = (f: Fact) => ({ k: f.k, n: f.n });
  const behindPicks = fc.behind;
  const namedHead = (dir: StepDir, than: string) =>
    behindPicks ? (dir < 0 ? "Being left out is part of why you lose here" : "Being left out is not why you lose here") : dir < 0 ? `You are named less often here than ${than}` : dir > 0 ? `You are named more often here than ${than}` : `You are named about as often here as ${than}`;
  const surf = (k: string) => (r: PoolRow) => surfOf(r, k, h, false) ?? r.code.top_pick ?? set.nameOf(k);
  const youNnr = book.fact("named_not_recommended", "you", scope);
  /** Named but not recommended, and of those named as one to avoid: you against a side (one brand's facts, the listed
   * rivals pooled, or you on the usual scope). */
  const namedRows = (side: { nnr: () => PanelNum; neg: () => PanelNum; nnrK: number }) => {
    if (youNnr.k + side.nnrK < DETAIL_MIN) return undefined;
    const out: { label: string; rival: PanelNum; you: PanelNum }[] = [{ label: "Named but not recommended", rival: side.nnr(), you: fx(fc, "named_not_recommended", "you", scope, "answers", surf(T)) }];
    if (youNnr.k >= DETAIL_MIN && side.nnrK >= DETAIL_MIN)
      out.push({ label: `Of those, named as ${article(h.noun)} ${h.noun} to avoid`, rival: side.neg(), you: fx(fc, "negative_when_named_not_recommended", "you", scope, "answers named but not recommended", surf(T)) });
    return out;
  };
  const takersList = (): PanelStepDetail["list"] => {
    const s = sel.selection("takers_after_rec", "you", scope);
    if (!s.members.length) return undefined;
    return { title: takersTitle(h.noun), selection: s.id, rows: (s.members as SelMember[]).map((b) => ({ label: b.name, num: fx(fc, "slice_share", `ai/slice:pick:${b.key}`, { ...scope, when: "rec:you&pick:other" }, "answers that recommend you and pick another", (r) => h.quoteOf(r) || r.code.top_pick || b.name) })) };
  };
  const youNamed = book.fact("named", "you", scope);
  const youRec = book.fact("recommended", "you", scope);
  const youConv = () => book.fact("converts", "you", scope);
  const outcomeLabels = OUTCOME_LABELS(h.noun);
  // How a sentence names the card's usual (What's popular and Premium vs basic: What to buy, all buyers).
  const uw =
    inp.kind === "switching"
      ? { than: "across all rivals' customers", col: "All rivals' customers" }
      : inp.kind === "popular" || inp.kind === "premium"
        ? { than: `when buyers ask ${ROW_NAME.open.toLowerCase()}`, col: ROW_NAME.open }
        : inp.kind === "learning"
          ? { than: "when buyers describe a problem", col: ROW_NAME.awareness }
          : { than: "across all buyers", col: "All buyers" };
  const details: Partial<Record<PanelStepKey, PanelStepDetail>> = {};
  const usualN = fc.usual ? book.rows(fc.usual).length : 0;
  const avg = !!p.avgComp && fc.members.length > 0;
  const keys = fc.members.map((x) => x.key);
  const pooled = (m: string, sc: Scope = scope): KN => {
    const per = keys.map((k) => book.fact(m, subj(fc, k), sc));
    const a = averageCompetitor(per, m, "ruled");
    return { k: a.k, n: a.n };
  };
  const side = avg
    ? {
        than: "the average competitor",
        thanDo: "the average competitor's do",
        columns: { you: "You", rival: AVG_COMP, rivalIsUsual: true as const },
        named: pooled("named"),
        rec: pooled("recommended"),
        conv: () => pooled("converts"),
        recN: pooled("recommended").k,
        nnr: { nnr: () => fxAvg(fc, "named_not_recommended", scope, "answers", (k) => surf(k)), neg: () => fxAvg(fc, "negative_when_named_not_recommended", scope, "answers named but not recommended", (k) => surf(k)), nnrK: pooled("named_not_recommended").k },
        outcome: () => factOutcomeAvg(fc, ctx, AVG_COMP, {}),
      }
    : fc.usual && usualN >= PANEL_MIN
      ? {
          than: uw.than,
          thanDo: `they do ${uw.than}`,
          columns: { you: "Here", rival: uw.col, rivalIsUsual: true as const },
          named: kn(book.fact("named", "you", fc.usual)),
          rec: kn(book.fact("recommended", "you", fc.usual)),
          conv: () => kn(book.fact("converts", "you", fc.usual!)),
          recN: book.fact("recommended", "you", fc.usual).k,
          nnr: { nnr: () => fx(fc, "named_not_recommended", "you", fc.usual!, "answers", surf(T)), neg: () => fx(fc, "negative_when_named_not_recommended", "you", fc.usual!, "answers named but not recommended", surf(T)), nnrK: book.fact("named_not_recommended", "you", fc.usual).k },
          outcome: () => ({ ...factOutcome(fc, ctx, T, uw.col, false, fc.usual!), you: true as const, usual: true as const }),
        }
      : null;
  if (side) {
    if (step("named")) {
      const dir = dirOf(kn(youNamed), side.named);
      const r = namedRows(side.nnr);
      details.named = { heading: namedHead(dir, side.than), body: namedLine(dir, side.than, behindPicks), ...(r ? { columns: side.columns, rows: r } : {}) };
    }
    if (step("recommended") && inp.kind !== "learning") {
      const dir = dirOf(kn(youRec), side.rec);
      const list = takersList();
      details.recommended = {
        heading: dir < 0 ? `You are recommended less often here than ${side.than}` : dir > 0 ? `You are recommended more often here than ${side.than}` : `You are recommended about as often here as ${side.than}`,
        body: recommendedLine(dir, side.than, behindPicks),
        ...(list ? { list } : {}),
      };
    }
    if (step("converts") && youRec.k >= DETAIL_MIN) {
      const dir = side.recN >= DETAIL_MIN ? dirOf(kn(youConv()), side.conv()) : 0;
      const outcomes = [{ ...factOutcome(fc, ctx, T, avg ? "You" : "Here", true) }, ...(side.recN >= DETAIL_MIN ? [side.outcome()] : [])];
      details.converts = {
        heading: dir < 0 ? "Fewer of your recommendations end as the pick here" : dir > 0 ? "More of your recommendations end as the pick here" : "Your recommendations end as the pick about as often here",
        body: convertsLine(dir, side.thanDo, behindPicks),
        ...(outcomes.length > 1 ? { outcomes, outcomeLabels } : {}),
      };
    }
  }
  const detailsComp: Partial<Record<PanelStepKey, PanelStepDetail>> = {};
  if (p.compare && fc.members.length) {
    const nm = step("named");
    if (nm?.rivals?.length) {
      const lead = [...nm.rivals].sort((a, b) => b.num.pct - a.num.pct)[0];
      const lk = fc.members.find((x) => x.name === lead.name)!.key;
      const ahead = shownPct(lead.num) > shownPct(nm.here!);
      const dir = dirOf(knOf(nm.here!)!, knOf(lead.num)!);
      const r = namedRows({ nnr: () => fx(fc, "named_not_recommended", lk, scope, "answers", surf(lk)), neg: () => fx(fc, "negative_when_named_not_recommended", lk, scope, "answers named but not recommended", surf(lk)), nnrK: book.fact("named_not_recommended", lk, scope).k });
      detailsComp.named = {
        heading: dir < 0 ? namedHead(dir, lead.name) : ahead && behindPicks ? `${lead.name} is named a little more often, but being left out is not mainly why you lose here` : ahead ? `${lead.name} is named a little more often than you here` : dir > 0 ? "You are named more often than any competitor shown" : `You and ${lead.name} are named about as often here`,
        body: namedLine(dir, lead.name, behindPicks),
        ...(r ? { columns: { you: "You", rival: lead.name }, rows: r } : {}),
      };
    }
    const rc = step("recommended");
    if (rc?.rivals?.length) {
      const lead = [...rc.rivals].sort((a, b) => b.num.pct - a.num.pct)[0];
      const ahead = shownPct(lead.num) > shownPct(rc.here!);
      const dir = dirOf(knOf(rc.here!)!, knOf(lead.num)!);
      const list = takersList();
      detailsComp.recommended = {
        heading: dir < 0 ? `${lead.name} is recommended more often than you here` : dir > 0 && !ahead ? "You are recommended more often than any competitor shown" : `You and ${lead.name} are recommended about as often here`,
        body: recommendedLine(dir, lead.name, behindPicks),
        ...(list ? { list } : {}),
      };
    }
    const cv = step("converts");
    if (cv?.rivals?.length && youRec.k >= DETAIL_MIN) {
      const ok = cv.rivals.filter((x) => (knOf(x.num)?.n ?? 0) >= DETAIL_MIN);
      const best = [...ok].sort((a, b) => b.num.pct - a.num.pct)[0];
      if (best) {
        const ahead = shownPct(best.num) > shownPct(cv.here!);
        const dir = dirOf(knOf(cv.here!)!, knOf(best.num)!);
        const recOk = fc.members
          .map((x) => ({ x, c: book.fact("converts", subj(fc, x.key), scope) }))
          .filter((y) => y.c.n >= DETAIL_MIN)
          .sort((a, b) => rate(kn(b.c)) - rate(kn(a.c)) || a.x.name.localeCompare(b.x.name));
        const outcomes = [factOutcome(fc, ctx, T, "You", true), ...recOk.map((y) => factOutcome(fc, ctx, y.x.key, y.x.name, false))];
        detailsComp.converts = {
          heading: dir < 0 ? `${best.name} turns more of its recommendations into the pick` : dir > 0 && !ahead ? "You turn more of your recommendations into the pick than any competitor shown" : `You and ${best.name} turn about as many recommendations into the pick`,
          body: convertsLine(dir, `${possOf(best.name)} do`, behindPicks),
          ...(outcomes.length > 1 ? { outcomes, outcomeLabels } : {}),
        };
      }
    }
  }
  if (Object.keys(details).length) p.details = details;
  if (Object.keys(detailsComp).length) p.detailsComp = detailsComp;
}

/** Panel 11's "Where it takes its picks" across a row's buyer cards, from facts. */
function factByCell(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const fc = FACT_CARD.get(inp)!;
  const sibs = siblingsOf(inp, ctx.inputs).filter((s) => isFactKind(s.kind));
  if (sibs.length < 2) return;
  const { h } = ctx;
  for (const r of p.rivals ?? []) {
    if (!r.full) continue;
    const key = fc.members.find((x) => x.name === r.name)?.key ?? h.resolve(r.name).key;
    r.byCell = sibs.map((s) => {
      const sc = pickScope(s, fc.F).scope;
      return {
        cellId: s.id,
        label: s.label,
        rival: fx(fc, "share_of_picks", subj(fc, key), sc, "picks", (x) => h.quoteOf(x) || x.code.top_pick || r.name),
        you: fx(fc, "share_of_picks", "you", sc, "picks", (x) => h.quoteOf(x) || x.code.top_pick || h.brand),
      };
    });
  }
}

/* ------------- fact layer, cards step 2: head-to-heads, What's popular, Premium vs basic, Habit ------------- */

/**
 * Four more card kinds read the fact layer (FACT_LAYER_DESIGN_2026-11-17.md step 4, second slice): every head-to-head
 * card (a named rival, a class, all your named rivals - the lost-with-an-exception step included), What's popular,
 * Premium vs basic and Habit, and the rival cards inside them. Every drawn number is a fact (measure | subject | scope,
 * or the average competitor of a selection), every list a selection; this builder counts nothing itself. Rulings
 * that land here: 2, 6, 8 (a pick outside of analysis is its own bucket), 12 (a pick outside the category is its own
 * share, never "no single pick" or "lists several without choosing"), 13 (a premium answer with no stance is its own
 * share, never "balanced"), 14 (one condition grouping - the Premium vs basic rows group its rules on the run's
 * condition keys), 15 (one product grouping), and the ratified competitor shape on What's popular and Premium vs basic
 * (ranked by recommendations - the card's own measure; head-to-head rivals tagged; class brands out; an Other row with
 * no bar, since recommendation shares do not add to 100%; the average competitor = every listed rival pooled).
 */

/** A card's fact card (its scope, its usual scope, the selection behind its bars). */
function mkFactCard(inp: PanelCellInput, ctx: Ctx, scope: Scope, usual: Scope | undefined, comp: AnySelection, members: SelMember[]): FactCard {
  const PF = ctx.h.facts!;
  const fc: FactCard = { F: PF, scope, usual, comp, members, behind: false, avg: {}, rowById: rowsById(ctx), n: PF.book.rows(scope).length };
  FACT_CARD.set(inp, fc);
  return fc;
}

/** A head-to-head card's scope: one named rival or one class (the question's own rival), or every named rival. */
function h2hScope(inp: PanelCellInput, F: PickFacts): Scope {
  if (inp.pooled) return { types: ["comparison_entity"] };
  const f0 = F.set.facts.find((f) => f.responseId === inp.rows[0]?.code.response_id);
  const type: QuestionType = f0?.type === "comparison_class" ? "comparison_class" : "comparison_entity";
  return { types: [type], rival: f0?.rival?.key ?? "__none__" };
}

/** A split-bar segment that is a fact. */
function segFx(fc: FactCard, key: string, label: string, tone: PanelSegment["tone"], m: string, s: string, scope: Scope, unit: string, find: (r: PoolRow) => string): PanelSegment {
  return { key, label, tone, num: fx(fc, m, s, scope, unit, find) };
}

/** A section of an explanation: rows of 3+ answers (sorted by their share unless kept in order); a sentence when none
 * clears the floor but some answers exist; nothing when no answer does. */
function factSec(title: string, sub: string | undefined, tone: PanelTone, items: { label: string; num: PanelNum }[], few: string, keepOrder = false): PanelDetailSection | null {
  const rate = (x: PanelNum) => {
    const kn = knOf(x)!;
    return kn.n ? kn.k / kn.n : 0;
  };
  const ok = items.filter((x) => (knOf(x.num)?.k ?? 0) >= ROW_MIN);
  if (!keepOrder) ok.sort((a, b) => rate(b.num) - rate(a.num) || a.label.localeCompare(b.label));
  if (!ok.length && !items.some((x) => (knOf(x.num)?.k ?? 0) > 0)) return null;
  return { title, ...(sub !== undefined ? { sub } : {}), tone, rows: ok.map((x) => ({ label: x.label, num: x.num })), ...(ok.length ? {} : { note: join(few) }) };
}

/** The head-to-head card. */
function factH2hPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { sel, set, themed } = PF;
  const scope = h2hScope(inp, PF);
  const usualInp = usualOf(inp, ctx.inputs);
  const rivalsSel = sel.selection("h2h_rivals", "you", scope);
  const fc = mkFactCard(inp, ctx, scope, usualInp ? { types: ["comparison_entity"] } : undefined, rivalsSel, []);
  const rival = inp.pooled ? "your named rivals" : inp.rivalName ?? inp.label;
  const pf = (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || h.brand;
  const UNIT2 = "answers that pick one of the two";
  const decided = fx(fc, "h2h_decided", "ai", scope, "answers", pf);
  const d = knOf(decided)!.k;
  const wonN = fx(fc, "h2h_two_way", "you", scope, UNIT2, pf);
  const lostN = fx(fc, "h2h_two_way", "rival", scope, UNIT2, pf);
  const wonK = knOf(wonN)!.k;
  const lostK = knOf(lostN)!.k;
  // The all-rivals card: each rival's share of the answers that pick one of the two (the switch's bars).
  const byRival = inp.pooled ? (rivalsSel.members as SelMember[]).map((m) => ({ name: m.name, num: fx(fc, "h2h_two_way", m.key, scope, UNIT2, pf) })) : [];
  const vsName = inp.pooled ? "Your named rivals" : rival;
  const steps: PanelStep[] = [
    { key: "decided", label: "The AI picks one of the two", here: decided, hereLabel: inp.pooled ? "All your head-to-heads" : "This matchup", usualLabel: "All your head-to-heads", compHereLabel: "All your head-to-heads" },
    ...(d > 0
      ? [
          {
            key: "won" as const,
            label: "When it picks, who it picks",
            here: wonN,
            vs: { name: vsName, num: lostN },
            rivals: byRival.length >= 2 ? byRival : [{ name: vsName, num: lostN }],
            ...(inp.pooled && byRival.length >= 2 ? { note: join("Each share is of all the head-to-head answers that pick one of the two; each rival is asked about only in its own matchup, so yours spans every matchup.") } : {}),
          },
        ]
      : []),
  ];
  // Lost with an exception (the Map's verdict decides the card has the step): of the answers that pick the rival, how
  // many still state a condition for you (a condition row in the card's grouping, the default clause left out).
  const exc = inp.exception;
  const stated = `cond:toward:${themed ? "theme" : "group"}`;
  if (exc && !inp.pooled && lostK) {
    const at: Scope = { ...scope, when: "pick:rival" };
    const unit = `answers that pick ${rival}`;
    const vf = (r: PoolRow) => verdictFind(r, h);
    steps.push({
      key: "exception",
      label: EXCEPTION_TEXT.label(rival),
      tagUsual: EXCEPTION_TEXT.callout,
      tagRank: EXCEPTION_TEXT.callout,
      tagUsualTone: "good",
      tagRankTone: "good",
      segments: [segFx(fc, "still", EXCEPTION_TEXT.still, "you", "slice_share", `ai/slice:${stated}`, at, unit, vf), segFx(fc, "none", EXCEPTION_TEXT.none, "neutral", "slice_share", `ai/slice:!${stated}`, at, unit, vf)],
    });
  }
  let claim: PanelText;
  if (d === 0) claim = join(`Asked to choose between you and ${rival}, the AI picks neither in every answer.`);
  else if (inp.pooled) claim = join("Asked to choose between you and one of your named rivals, the AI picks you in ", N(wonN), " of the answers that pick one of you.");
  else if (wonK === 0 || lostK === 0) claim = join(`Asked to choose between you and ${rival}, the AI picks ${wonK === 0 ? rival : "you"} every time it picks one of you.`);
  else {
    const leadYou = wonK >= lostK;
    claim = join(`Asked to choose between you and ${rival}, the AI picks ${leadYou ? "you" : rival} in `, N(leadYou ? wonN : lostN), " of the answers that pick one of you.");
  }
  const withExc = !!(exc && inp.rivalKey);
  const conditions = factConditions(
    inp,
    fc,
    ctx,
    {
      title: inp.pooled ? "When the AI says to choose a rival, and when you" : `When the AI says to choose ${rival}, and when you`,
      sub: exc
        ? `Share of these answers that say "choose this ${h.noun} if the buyer...". Your rows come from answers that pick ${rival}: what it concedes to you while you lose.`
        : `Share of these answers that say "choose this ${h.noun} if the buyer...".`,
      towardTitle: "Choose you if",
      awayTitle: inp.pooled ? "Choose the rival if" : `Choose ${rival} if`,
      alsoToward: inp.pooled ? "Also said for the rival" : `Also said for ${rival}`,
      alsoAway: "Also said for you",
      toWord: "To",
      ...(exc ? { towardScope: "rival_picked" as const } : {}),
    },
    { pickKind: true, ...(withExc ? { towardOnly: "pick:rival", pickedStamp: exc!.rival } : {}) }
  );
  let lead: PanelText | undefined;
  const t = conditions?.toward ?? [];
  const a = conditions?.away ?? [];
  if (exc && t.length) lead = attachedLead("choosing you", t.slice(0, 2), "answers", `Even while picking ${rival}, `);
  else if (a.length || t.length)
    lead = join(a.length ? attachedLead(inp.pooled ? "choosing the rival" : `choosing ${rival}`, [a[0]], "answers") : null, a.length && t.length ? " " : null, t.length ? attachedLead("choosing you", [t[0]], "answers") : null);
  // Which of the rival's products it picks, out of every pick of the rival (ruling 15).
  const lines: PanelLine[] = [];
  if (!inp.pooled && lostK && set.ladder && scope.rival) {
    const rk = scope.rival;
    const prods = sel.selection("product_picks", "you", scope, { brand: rk, top: 2 });
    const items = (prods.members as SelMember[]).map((x) => ({ name: x.key === "~none" ? noneName(ctx) : x.name, num: fx(fc, "pick_product_share", `ai/slice:pickprod:${x.key === "~none" ? "none" : x.key}`, { ...scope, when: `pick:${rk}` }, `picks of ${rival}`, (r) => r.code.top_pick || x.name) }));
    if (namesAProduct(items)) lines.push({ label: `Which ${rival} ${h.plural} it picks`, value: splitLine(items), selection: prods.id });
  }
  const weighs = factWeighs(inp, fc, ctx, [{ say: "come up here", unit: "answers", tone: "neutral" }], WEIGHS_SUB_ALL);
  return {
    kind: "h2h",
    claim,
    ...(lead ? { lead } : {}),
    ...(usualInp ? { usualCellId: usualInp.id, usualKey: "You, across all your head-to-heads" } : {}),
    hereKey: "You",
    stackLabel: "Where it is decided",
    steps,
    ...(byRival.length >= 2 ? { compare: true as const, competitorOrder: byRival.map((x) => x.name), competitorSelection: rivalsSel.id } : {}),
    ...(conditions ? { conditions } : {}),
    lines,
    ...(weighs ? { weighs } : {}),
  };
}

/** The head-to-head card's step explanations: when it picks neither (another brand in analysis, a pick outside the
 * category - ruling 12, no single pick), the exception's conditions, who it picks. */
function factH2hStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const fc = FACT_CARD.get(inp)!;
  if (fc.n < DETAIL_MIN) return;
  const { h } = ctx;
  const { sel, themed } = fc.F;
  const scope = fc.scope;
  const R = inp.pooled ? "your named rivals" : inp.rivalName ?? inp.label;
  const details: Partial<Record<PanelStepKey, PanelStepDetail>> = {};
  const dec = p.steps.find((s) => s.key === "decided" && !!s.here);
  const won = p.steps.find((s) => s.key === "won");
  if (dec?.here) {
    const top = (r: PoolRow) => r.code.top_pick || h.brand;
    const restRows = [
      { label: `Picks another ${h.noun}`, num: fx(fc, "slice_share", "ai/slice:pick:other&!pick:rival", scope, "answers", top) },
      { label: "Picks a brand outside of analysis", num: fx(fc, "slice_share", "ai/slice:pick:outside_analysis", scope, "answers", top) },
      { label: "Picks something outside the category", num: fx(fc, "slice_share", "ai/slice:pick:outside_category", scope, "answers", top) },
      { label: "No single pick", num: fx(fc, "h2h_no_pick", "ai", scope, "answers", (r) => verdictFind(r, h)) },
    ].filter((x) => (knOf(x.num)?.k ?? 0) >= 3);
    details.decided = {
      heading: dec.here.pct >= 50 ? "The AI mostly picks one of the two" : "The AI mostly declines to pick one of the two",
      body: decidedLine(dec.here.pct >= 50),
      ...(restRows.length ? { list: { title: "When it picks neither of the two", rows: restRows } } : {}),
    };
  }
  // The exception names the buyers still sent to you, as shares of the answers that pick the rival - the card's own
  // toward condition rows (one selection).
  const ex = p.steps.find((s) => s.key === "exception");
  if (ex) {
    const at: Scope = { ...scope, when: "pick:rival" };
    const rowsSel = sel.selection("conditions_shown", "ai", scope, { side: "toward", flavor: themed ? "themed" : "group", towardOnly: "pick:rival" });
    const items = (rowsSel.members as CondRow[]).slice(0, 4).map((m) => ({ label: m.label, num: fx(fc, "cond_share", condSub("ai", m.units), at, `answers that pick ${R}`, () => m.raw ?? m.label) }));
    const who = factSec(EXCEPTION_TEXT.who.title, EXCEPTION_TEXT.who.sub(R), "good", items, EXCEPTION_TEXT.who.few);
    details.exception = { heading: EXCEPTION_TEXT.heading(R), body: join(EXCEPTION_TEXT.body(R)), callout: EXCEPTION_TEXT.callout, ...(who ? { sections: [who] } : {}) };
  }
  if (won?.here && won.vs && (knOf(p.steps.find((s) => s.key === "decided")!.here!)?.k ?? 0) >= DETAIL_MIN) {
    const w = won.here.pct;
    details.won = {
      heading: w >= 60 ? "When it picks one of the two, it mostly picks you" : w <= 40 ? `When it picks one of the two, it mostly picks ${inp.pooled ? "the rival" : R}` : "When it picks one of the two, it is close",
      body: wonLine(w >= 60 ? "you" : w <= 40 ? "rival" : "close"),
    };
  }
  if (Object.keys(details).length) {
    p.details = details;
    if (p.compare) p.detailsComp = { ...details };
  }
}

/** What's popular (and the funnel under Premium vs basic): named, recommended, names one pick - against What to buy,
 * all buyers (ruling 7) and the competitor group ranked by recommendations. */
function factPopularPanel(inp: PanelCellInput, ctx: Ctx, type: QuestionType = "social_validation"): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { book, sel, set } = PF;
  const T = set.target.key;
  const scope: Scope = { types: [type] };
  const hasU = !!ctx.inputs.get("chooses:open:all");
  const uScope: Scope | undefined = hasU ? WHAT_TO_BUY_ALL : undefined;
  const uName = ROW_NAME.open.toLowerCase();
  const comp = sel.selection("competitors", "you", scope, { rankBy: "recommended" });
  const members = comp.members as SelMember[];
  const fc = mkFactCard(inp, ctx, scope, uScope, comp, members);
  const leader = sel.selection("leader", "you", scope).members[0] as SelMember | undefined;
  fc.behind = !!leader && leader.count > book.fact("share_of_picks", "you", scope).k;
  const all = fc.n;
  const pf = (name: string) => (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || name;
  const surfF = (k: string, rec: boolean, name: string) => (r: PoolRow) => surfOf(r, k, h, rec) ?? r.code.top_pick ?? name;
  const named = fx(fc, "named", "you", scope, "answers", surfF(T, false, h.brand));
  const rec = fx(fc, "recommended", "you", scope, "answers", surfF(T, true, h.brand));
  const uNamed = uScope ? fx(fc, "named", "you", uScope, "answers", surfF(T, false, h.brand)) : undefined;
  const uRec = uScope ? fx(fc, "recommended", "you", uScope, "answers", surfF(T, true, h.brand)) : undefined;
  const commits = fx(fc, "commit_rate", "ai", scope, "answers", pf(h.brand));
  const uCommits = uScope ? fx(fc, "commit_rate", "ai", uScope, "answers", pf(h.brand)) : undefined;
  const every = knOf(named)!.k === all && all > 0;
  const claim = join(
    whenAsks(inp, "buyer", `which ${h.plural} people choose most`),
    "the AI names you in ",
    every ? F("every answer", named) : join(N(named), " of answers"),
    knOf(rec)!.k ? join(", and recommends you in ", N(rec), ".") : ", and never recommends you."
  );
  const conditions = factConditions(
    inp,
    fc,
    ctx,
    {
      title: `When the AI says to choose you, and when another ${h.noun}`,
      sub: `Share of these answers that say "choose this ${h.noun} if the buyer...". The grey bar shows how often it comes up where the AI says it both ways.`,
      subComp: `Share of these answers that say "choose this ${h.noun} if the buyer...". The names after each row are the ones it says to choose instead.`,
      towardTitle: "Choose you if",
      awayTitle: `Choose another ${h.noun} if`,
      alsoToward: `Also said for another ${h.noun}`,
      alsoAway: "Also said for you",
      toWord: "To",
    },
    { pickKind: false }
  );
  const t = conditions?.toward ?? [];
  const a = conditions?.away ?? [];
  const lead = t.length || a.length ? join(t.length ? attachedLead("choosing you", [t[0]]) : null, t.length && a.length ? " " : null, a.length ? attachedLead(`choosing another ${h.noun}`, [a[0]]) : null) : undefined;
  // The competitor group's steps and its Other row (no bar on named / recommended).
  const other = comp.extras.other!;
  const memberNum = (m: string, rec2: boolean) => (x: SelMember) => ({ name: x.name, num: fx(fc, m, subj(fc, x.key), scope, "answers", surfF(x.key, rec2, x.name)) });
  const otherRows = (m: string, rec2: boolean): PanelOther | undefined => {
    if (!other.shown.length && !other.rest) return undefined;
    const rows = other.shown.map((x) => ({ name: x.name, num: fx(fc, m, subj(fc, x.key), scope, "answers", surfF(x.key, rec2, x.name)) }));
    rows.sort((p, q) => knOf(q.num)!.k - knOf(p.num)!.k || p.name.localeCompare(q.name));
    return { rows, ...(other.rest ? { rest: moreBrands(other.rest) } : {}), selection: comp.id };
  };
  const steps: PanelStep[] = [
    { key: "named", label: "Named", here: named, ...(uNamed ? { usual: uNamed } : {}), ...(members.length ? { rivals: members.map(memberNum("named", false)), ...optOther(otherRows("named", false)) } : {}) },
    { key: "recommended", label: "Recommended", here: rec, ...(uRec ? { usual: uRec } : {}), ...(members.length ? { rivals: members.map(memberNum("recommended", true)), ...optOther(otherRows("recommended", true)) } : {}) },
    { key: "commits", label: `The answer names one ${h.noun} as the pick`, here: commits, ...(uCommits ? { usual: uCommits } : {}), compHereLabel: `Any ${h.noun}`, ...(members.length ? { tagRank: "Same for every brand" } : {}) },
  ];
  if (members.length) {
    fc.avg.named = fxAvg(fc, "named", scope, "answers, the competitors shown added up", (k) => (r) => surfOf(r, k, h, false) ?? r.code.top_pick ?? "");
    fc.avg.recommended = fxAvg(fc, "recommended", scope, "answers, the competitors shown added up", (k) => (r) => surfOf(r, k, h, true) ?? r.code.top_pick ?? "");
  }
  // Tables: your products named (the run's one product grouping), and what the answer weighs - this question beside
  // What to buy, all buyers.
  const tables: PanelTable[] = [];
  const cols = uScope ? ["This question", `${upperFirst(uName)}, all buyers`] : ["This question"];
  if (set.ladder) {
    const at: Scope = { ...scope, when: "named:you" };
    const ps = sel.selection("product_names", "you", at, { brand: T, top: 4 });
    const prods = (ps.members as SelMember[]).filter((x) => x.count >= ROW_MIN);
    if (prods.length)
      tables.push({
        title: `Which of your ${h.plural} it names`,
        sub: "Share of the answers that name you.",
        columns: cols,
        style: "compare",
        rows: prods.map((x) => ({
          label: x.name,
          cells: [fx(fc, "slice_share", `ai/slice:nameprod:${x.key}`, at, "answers that name you", () => x.name), ...(uScope ? [fx(fc, "slice_share", `ai/slice:nameprod:${x.key}`, { ...uScope, when: "named:you" }, "answers that name you", () => x.name)] : [])],
        })),
        selection: ps.id,
      });
  }
  const ws = sel.selection("weighs_shown", "ai", scope, { sides: [{}], top: 4 });
  const codes = (ws.members as WeighsColumn[])[0]?.codes ?? [];
  if (codes.length)
    tables.push({
      title: "What the answer weighs",
      sub: "Share of the answers that raise each argument.",
      columns: cols,
      style: "compare",
      rows: codes.map(({ code }) => ({
        label: clabel(code, h),
        cells: [fx(fc, "argues", `ai/arg:${code}`, scope, "answers", () => code), ...(uScope ? [fx(fc, "argues", `ai/arg:${code}`, uScope, "answers", () => code)] : [])],
      })),
      selection: ws.id,
    });
  // The rival cards: the full card for a brand among those taking picks here, else the smaller one.
  const takers = new Set((sel.selection("takers", "you", scope).members as SelMember[]).map((m) => m.key));
  const converts = fx(fc, "converts", "you", scope, "recommending answers", pf(h.brand));
  const rivals = members.map((m) => (takers.has(m.key) ? factRival(inp, fc, ctx, m, { named, recommended: rec, converts }, conditions) : factRivalSmall(inp, fc, ctx, m, "Recommended", { measure: "recommended" })));
  const competitors: PanelBlock | undefined = members.length
    ? {
        title: "Which brands it recommends",
        sub: "Share of these answers that recommend the brand. Open a rival to see how it gets them.",
        selection: comp.id,
        rows: [...members.map((x) => ({ name: x.name, num: fx(fc, "recommended", subj(fc, x.key), scope, "answers", surfF(x.key, true, x.name)), open: true as const, ...(x.headToHead ? { tag: "head-to-head" } : {}) })), { name: h.brand, you: true as const, num: rec }].sort(
          (x, y) => knOf(y.num)!.k - knOf(x.num)!.k || x.name.localeCompare(y.name)
        ),
        ...(otherRows("recommended", true) ? { other: otherRows("recommended", true)! } : {}),
      }
    : undefined;
  return {
    kind: "popular",
    claim,
    ...(lead && lead.length ? { lead } : {}),
    hereKey: "This question",
    ...(uScope ? { usualKey: `${upperFirst(uName)}, all buyers` } : {}),
    stackLabel: "How the answer goes",
    steps,
    ...(members.length ? { compare: true as const, competitorOrder: members.map((x) => x.name), competitorSelection: comp.id } : {}),
    ...(competitors ? { competitors } : {}),
    ...(conditions ? { conditions } : {}),
    lines: [],
    ...(tables.length ? { tables } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
}

/** "The answer names one <noun> as the pick" explains itself (What's popular, Premium vs basic): what the answer does
 * instead (it depends, lists several, a pick outside of analysis or the category - rulings 8 and 12), who gets the
 * pick, which AI companies name one. The same in both views. */
function factCommitsDetail(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const fc = FACT_CARD.get(inp)!;
  const cm = p.steps.find((s) => s.key === "commits" && !!s.here);
  if (!cm || fc.n < DETAIL_MIN) return;
  const { h } = ctx;
  const { sel } = fc.F;
  const scope = fc.scope;
  const all = fc.n;
  const vf = (r: PoolRow) => verdictFind(r, h);
  const pf = (name: string) => (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || name;
  const sl = (expr: string) => fx(fc, "slice_share", `ai/slice:${expr}`, scope, "answers", vf);
  const depends = sl("pick:none&v:outcome:conditional");
  const lists = sl("pick:none&!v:outcome:conditional");
  const instead = factSec(
    COMMITS_TEXT.instead.title,
    COMMITS_TEXT.instead.sub,
    "neutral",
    [
      { label: COMMITS_TEXT.depends, num: depends },
      { label: COMMITS_TEXT.lists, num: lists },
      { label: COMMITS_TEXT.outsideAnalysis, num: fx(fc, "picks_outside_analysis", "ai", scope, "answers", pf("")) },
      { label: COMMITS_TEXT.outside, num: fx(fc, "picks_outside_category", "ai", scope, "answers", pf("")) },
    ],
    COMMITS_TEXT.instead.few
  );
  const pb = sel.selection("pick_brands", "you", scope);
  const who = factSec(COMMITS_TEXT.who.title, COMMITS_TEXT.who.sub, "neutral", (pb.members as SelMember[]).map((b) => ({ label: b.name, num: fx(fc, "share_of_picks", subj(fc, b.key), scope, "answers that name one pick", pf(b.name)) })), COMMITS_TEXT.who.few);
  const picked = knOf(cm.here!)!.k;
  const vs = sel.selection("vendors", "ai", scope, { min: ROW_MIN });
  const vendor = picked < ROW_MIN ? null : factSec(COMMITS_TEXT.vendor.title, COMMITS_TEXT.vendor.sub, "neutral", (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "commit_rate", "ai", { ...scope, vendor: v.name }, `${v.name} answers`, pf(h.brand)) })), COMMITS_TEXT.vendor.few);
  const sections = [instead, who, vendor].filter((x): x is PanelDetailSection => !!x);
  const dk = knOf(depends)!.k;
  const lk = knOf(lists)!.k;
  const side: CommitsSide = picked * 2 >= all ? "picks" : dk * 2 >= all ? "depends" : lk * 2 >= all ? "lists" : dk > lk ? "leans_depends" : lk > dk ? "leans_lists" : "split";
  const d: PanelStepDetail = { ...commitsDetail(side, h.noun), ...(sections.length ? { sections } : {}) };
  p.details = { ...(p.details ?? {}), commits: d };
  if (p.compare) p.detailsComp = { ...(p.detailsComp ?? {}), commits: d };
}

/** Premium vs basic: which end the AI sides with (an answer with no stance its own share - ruling 13), then the funnel
 * exactly as What's popular builds it; the conditions by the end they choose (ruling 14: the run's condition keys), who
 * it names at each end, what each side weighs. */
function factPremiumPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const T9 = PREMIUM_TEXT;
  const base = factPopularPanel(inp, ctx, "premium_worth");
  const fc = FACT_CARD.get(inp)!;
  const { book, sel, set } = fc.F;
  const scope = fc.scope;
  const all = fc.n;
  const T = set.target.key;
  const vf = (r: PoolRow) => verdictFind(r, h);
  const prem = fx(fc, "tier_premium", "ai", scope, "answers", vf);
  const bas = fx(fc, "tier_basic", "ai", scope, "answers", vf);
  const bal = fx(fc, "tier_balanced", "ai", scope, "answers", vf);
  const none = book.fact("tier_none", "ai", scope);
  const tier: PanelStep = {
    key: "tier",
    label: T9.stepLabel,
    segments: [
      { key: "premium", label: T9.premium, tone: "you", num: prem },
      { key: "basic", label: T9.basic, tone: "away", num: bas },
      { key: "balanced", label: T9.balanced, tone: "neutral", num: bal },
      ...(none.k > 0 ? [{ key: "none", label: T9.none, tone: "neutral" as const, num: fx(fc, "tier_none", "ai", scope, "answers", vf) }] : []),
    ],
  };
  const pk = knOf(prem)!.k;
  const bk = knOf(bas)!.k;
  const claim = premiumClaim(h.plural, bas, prem, all > 0 && bk === all, pk === 0, bk === 0);
  const conditions = factConditions(inp, fc, ctx, { ...T9.conditions, subComp: T9.conditions.sub, toWord: "Names" }, { pickKind: false, flavor: "tierwide" });
  const t = conditions?.toward ?? [];
  const a = conditions?.away ?? [];
  const lead = t.length || a.length ? join(t.length ? attachedLead("choosing premium", [t[0]]) : null, t.length && a.length ? " " : null, a.length ? attachedLead("choosing basic", [a[0]]) : null) : undefined;
  // Who it names at each end (the ends selection): a brand by its entry, any other name as written.
  const findIn = (r: PoolRow, choice: string, name: string) => {
    const ws = (r.code.decision_rules ?? []).filter((d) => d.choice?.trim() === choice && (d.product ?? "").trim()).map((d) => d.product!.trim());
    const toks = new Set(famTokens(name));
    return ws.find((w) => famTokens(w).some((x) => toks.has(x))) ?? ws[0] ?? name;
  };
  const endCol = (choice: "premium" | "basic", title: string) => {
    const s = sel.selection("ends", "ai", scope, { choice });
    const rows = (s.members as SelMember[]).map((m) => {
      const isYou = m.key === T;
      const sub = m.key.startsWith("~n:") ? `ai/slice:rulename:${choice}:${m.key.slice(3)}` : `ai/slice:ruleprod:${choice}:${isYou ? "you" : m.key}`;
      return { name: m.name, num: fx(fc, "slice_share", sub, scope, "answers", (r) => findIn(r, choice, isYou ? h.brand : m.name)), ...(isYou ? { you: true as const } : {}) };
    });
    return { col: { title, tone: "neutral" as PanelTone, rows, ...(rows.length ? {} : { note: T9.ends.none(choice) }) }, id: s.id };
  };
  const premCol = endCol("premium", T9.ends.premium);
  const basCol = endCol("basic", T9.ends.basic);
  const ends: PanelWeighs | undefined = premCol.col.rows.length || basCol.col.rows.length ? { title: T9.ends.title, sub: T9.ends.sub, columns: [premCol.col, basCol.col], selection: `${premCol.id} ; ${basCol.id}` } : undefined;
  const weighs =
    factWeighs(inp, fc, ctx, [
      { title: T9.weighs.premium, say: T9.weighs.sayPremium, tone: "good", slice: "v:tier_stance:premium" },
      { title: T9.weighs.basic, say: T9.weighs.sayBasic, tone: "bad", slice: "v:tier_stance:basic" },
    ], WEIGHS_SUB_SIDES) ?? factWeighs(inp, fc, ctx, [{ say: "come up here", unit: "answers", tone: "neutral" }], WEIGHS_SUB_ALL);
  const out: PositionPanel = { ...base, kind: "premium", claim, steps: [tier, ...base.steps] };
  delete out.lead;
  delete out.conditions;
  delete out.tables;
  delete out.weighs;
  delete out.weighsComp;
  if (lead && lead.length) out.lead = lead;
  if (conditions) out.conditions = conditions;
  if (ends) out.ends = ends;
  if (weighs) out.weighs = weighs;
  return out;
}

/** The "which end" step's takeaway and explanation, from facts; it starts selected. */
function factPremiumFinish(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const { h } = ctx;
  const T9 = PREMIUM_TEXT;
  const fc = FACT_CARD.get(inp)!;
  const { book, sel } = fc.F;
  const scope = fc.scope;
  const s = p.steps.find((x) => x.key === "tier");
  if (!s?.segments) return;
  const tk = tierTakeaway(segPct(s, "premium"), segPct(s, "basic"), segPct(s, "balanced"));
  s.tagUsual = tk.tag;
  s.tagUsualTone = tk.tone;
  s.tagRank = tk.tag;
  s.tagRankTone = tk.tone;
  const all = fc.n || 1;
  const yp = book.fact("slice_share", "ai/slice:ruleprod:premium:you", scope).k;
  const yb = book.fact("slice_share", "ai/slice:ruleprod:basic:you", scope).k;
  const l = leanOf((100 * yp) / all, (100 * yb) / all);
  const where: TierWhere = yp < ROW_MIN && yb < ROW_MIN ? "neither" : l > 0 ? "premium" : l < 0 ? "basic" : "both";
  const vs = sel.selection("vendors", "ai", scope, { min: ARGS_MIN });
  const items = (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "tier_basic", "ai", { ...scope, vendor: v.name }, `${v.name} answers`, (r) => verdictFind(r, h)) }));
  const sec = items.some((x) => (knOf(x.num)?.k ?? 0) > 0) ? factSec(T9.vendor.title, T9.vendor.sub, "bad", items, T9.vendor.few) : null;
  const d: PanelStepDetail = { ...tierDetail(tk.tag, where), ...(sec ? { sections: [sec] } : {}) };
  p.details = { tier: d, ...(p.details ?? {}) };
  p.focus = "tier";
  if (p.compare) {
    p.detailsComp = { tier: d, ...(p.detailsComp ?? {}) };
    p.focusComp = "tier";
  }
}

/** Habit: stick with you, another brand in analysis as the pick (a pick outside of analysis or the category its own
 * share - rulings 8 and 12), it depends, no pick; how often it suggests another brand; the brands suggested instead. */
function factHabitPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const T9 = HABIT_TEXT;
  const PF = h.facts!;
  const { book, sel, set } = PF;
  const T = set.target.key;
  const scope: Scope = { types: ["repertoire"] };
  const sugg = sel.selection("suggested", "you", scope);
  const fc = mkFactCard(inp, ctx, scope, undefined, sugg, []);
  const all = fc.n;
  const pf = (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || h.brand;
  const vf = (r: PoolRow) => verdictFind(r, h);
  const sl = (key: string, label: string, tone: PanelSegment["tone"], expr: string, find: (r: PoolRow) => string) => segFx(fc, key, label, tone, "slice_share", `ai/slice:${expr}`, scope, "answers", find);
  const has = (expr: string) => book.fact("slice_share", `ai/slice:${expr}`, scope).k > 0;
  const segs = [
    sl("stick", T9.stick, "you", "pick:you", pf),
    sl("other", T9.other, "away", "pick:other", pf),
    ...(has("pick:outside_analysis") ? [sl("outside_analysis", T9.outsideAnalysis, "neutral", "pick:outside_analysis", pf)] : []),
    ...(has("pick:outside_category") ? [sl("outside", T9.outside, "neutral", "pick:outside_category", pf)] : []),
    sl("depends", T9.depends, "neutral", "pick:none&v:outcome:conditional", vf),
    sl("nopick", T9.nopick, "neutral", "pick:none&!v:outcome:conditional", vf),
  ];
  const suggFind = (r: PoolRow) =>
    (r.code.mentions ?? []).find((m) => m.framing === "recommended" && h.resolve(m.brand).key !== T && h.resolve(m.brand).status === "active")?.brand ??
    (h.pickOf(r).status === "active" && h.pickOf(r).key !== T ? r.code.top_pick ?? undefined : undefined) ??
    vf(r);
  const offers = fx(fc, "slice_share", "ai/slice:rec:anyother", scope, "answers", suggFind);
  const sk = knOf(segs[0].num)!.k;
  const ok2 = knOf(segs[1].num)!.k;
  const claim = habitClaim(segs[0].num, segs[1].num, all > 0 && sk === all, sk === 0, ok2 === 0);
  const conditions = factConditions(inp, fc, ctx, { ...T9.conditions, subComp: T9.conditions.sub, toWord: "To" }, { pickKind: false, pairs: false });
  const a = conditions?.away ?? [];
  const t = conditions?.toward ?? [];
  const lead =
    a.length || t.length
      ? join(t.length ? attachedLead("sticking with you", t.slice(0, 1).map((c) => ({ text: c.text })), "answers") : null, a.length && t.length ? " " : null, a.length ? attachedLead("trying something else", a.slice(0, 1).map((c) => ({ text: c.text })), "answers") : null)
      : undefined;
  const members = sugg.members as SelMember[];
  const recFind = (k: string, name: string) => (r: PoolRow) => surfOf(r, k, h, true) ?? r.code.top_pick ?? name;
  const block: PanelBlock | undefined = members.length
    ? { title: T9.suggested.title, sub: T9.suggested.sub, selection: sugg.id, rows: members.map((m) => ({ name: m.name, num: fx(fc, "slice_share", `ai/slice:rec:${m.key}`, scope, "answers", recFind(m.key, m.name)), open: true as const })) }
    : undefined;
  const rivals = members.map((m) => factRivalSmall(inp, fc, ctx, m, "Suggested instead", { when: "as something to try", alt: `rec:${m.key}` }));
  // What each side weighs, led by the cell's top lift each way (the Map's lift list decides the leads and whether
  // the block is two-sided); too few answers either way, the unsided version.
  const pos = inp.lifts.filter((l) => l.value > 0).sort((x, y) => y.value - x.value)[0];
  const neg = inp.lifts.filter((l) => l.value < 0).sort((x, y) => x.value - y.value)[0];
  const enough = (when: string) => book.rows({ ...scope, when }).filter((f) => f.args !== null).length >= ARGS_MIN;
  const unsided = () => factWeighs(inp, fc, ctx, [{ say: "come up here", unit: "answers", tone: "neutral" }], WEIGHS_SUB_ALL);
  const weighs =
    (!pos && !neg) || (!enough("pick:you") && !enough("pick:other"))
      ? unsided()
      : factWeighs(inp, fc, ctx, [
          { title: T9.weighs.stick, say: T9.weighs.sayStick, tone: "good", slice: "pick:you", ...(pos ? { lead: pos.label } : {}) },
          { title: T9.weighs.other, say: T9.weighs.sayOther, tone: "bad", slice: "pick:other", ...(neg ? { lead: neg.label } : {}) },
        ], WEIGHS_SUB_SIDES) ?? unsided();
  const out: PositionPanel = {
    kind: "habit",
    claim,
    ...(lead && lead.length ? { lead } : {}),
    stackLabel: "How the answer goes",
    steps: [
      { key: "habit", label: T9.stepLabel, segments: segs },
      { key: "offers", label: T9.offersLabel, here: offers, hereLabel: "All answers" },
    ],
    ...(conditions ? { conditions } : {}),
    lines: [],
    ...(weighs ? { weighs } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
  if (block) HABIT_SUGGESTED.set(out, block);
  return out;
}

/** The Habit card's two steps explained, from facts: which AI companies say try something else, who gets the pick;
 * the brands suggested instead, who first, your own it suggests (the run's one product grouping). */
function factHabitStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  if (!p.detail) return;
  const { h } = ctx;
  const T9 = HABIT_TEXT;
  const fc = FACT_CARD.get(inp)!;
  const { book, sel, set } = fc.F;
  const T = set.target.key;
  const scope = fc.scope;
  const all = fc.n;
  const pf = (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || h.brand;
  const vs = sel.selection("vendors", "ai", scope, { min: ARGS_MIN });
  const vendor = factSec(T9.vendor.title, T9.vendor.sub, "bad", (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "slice_share", "ai/slice:pick:other", { ...scope, vendor: v.name }, `${v.name} answers`, pf) })), T9.vendor.few);
  const inPicks = book.fact("commit_rate", "ai", scope).k;
  const pb = sel.selection("pick_brands", "you", scope, { youFirst: true, top: 3 });
  const picks =
    inPicks >= ARGS_MIN
      ? factSec(T9.picks.title, T9.picks.sub, "neutral", (pb.members as SelMember[]).map((b) => ({ label: b.key === T ? "You" : b.name, num: fx(fc, "share_of_picks", subj(fc, b.key), scope, "answers that name a pick", b.key === T ? pf : (r: PoolRow) => r.code.top_pick || b.name) })), T9.picks.few, true)
      : null;
  const habitSections = [vendor, picks].filter((x): x is PanelDetailSection => !!x);
  // Of the answers that suggest another brand: who it suggests first.
  const some = book.fact("slice_share", "ai/slice:rec:anyother", scope).k;
  const fr = sel.selection("first_rec", "you", scope, { top: 4 });
  const firstTop = fr.members as SelMember[];
  const lead = firstTop[0] && some >= ARGS_MIN && firstTop[0].count / some >= 0.3 ? firstTop[0].name : undefined;
  const own = sel.selection("product_suggested", "you", scope, { brand: T, top: 5 });
  const shown = HABIT_SUGGESTED.get(p);
  const offersSections = [
    shown ? { title: shown.title, sub: shown.sub, tone: "bad" as const, rows: shown.rows.map((r) => ({ label: r.name, num: r.num, ...(r.open ? { open: true as const } : {}) })) } : null,
    some >= ARGS_MIN ? factSec(T9.first.title, T9.first.sub, "bad", firstTop.map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:firstrec:${x.key}`, { ...scope, when: "rec:anyother" }, "answers that suggest another brand", () => x.name) })), T9.first.few) : null,
    own.members.length ? factSec(T9.own.title(h.plural), T9.own.sub, "good", (own.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:suggprod:${x.key}`, scope, "answers", () => x.name) })), T9.own.few) : null,
  ].filter((x): x is PanelDetailSection => !!x);
  const share = all ? some / all : 0;
  const offersDetail: PanelStepDetail = { ...habitOffersDetail(share >= 0.5 ? "most" : share >= 0.2 ? "some" : "rarely", lead), ...(offersSections.length ? { sections: offersSections } : {}) };
  p.details = { habit: { ...p.detail, ...(habitSections.length ? { sections: habitSections } : {}) }, offers: offersDetail };
  p.focus = "habit";
  delete p.detail;
  delete p.detailComp;
}

/* ------------- fact layer, third slice: Value, the worries, your customers looking around ------------- */

/** A doubt card's scope: its question types, and its worry or buying situation (the All card: the row's types). The
 * card's own answers must be exactly the scope's - else the card is not built from facts (buildPanel falls back). */
function doubtScope(inp: PanelCellInput, F: PickFacts): Scope {
  const ids = new Set(inp.rows.map((r) => r.code.response_id));
  const fs = F.set.facts.filter((f) => ids.has(f.responseId));
  const f0 = fs[0];
  const typesOf = (dflt: QuestionType[]) => {
    const t = [...new Set(fs.map((f) => f.type))].sort() as QuestionType[];
    return t.length ? t : dflt;
  };
  let scope: Scope;
  switch (inp.kind) {
    case "buyer_worry":
      scope = inp.pooled ? { types: ["objections"] } : { types: ["objections"], worry: f0?.worry ?? "__none__" };
      break;
    case "customer_worry":
      // A worry's card holds both stages unless its cell is one stage's (the worry asked at both stages, one cell each).
      scope = { types: ["churn_triggers", "renewal"], ...(inp.pooled ? {} : { worry: f0?.worry ?? "__none__" }) };
      if (!inp.pooled && F.book.rows(scope).length !== ids.size) scope = { types: typesOf(["churn_triggers"]), worry: f0?.worry ?? "__none__" };
      break;
    case "looking_around":
      scope = inp.pooled ? { types: ["looking_around"] } : { types: ["looking_around"], situation: f0?.situation ?? null };
      break;
    default:
      scope = inp.pooled ? { types: ["pricing"] } : { types: ["pricing"], situation: f0?.situation ?? null };
  }
  const got = F.book.rows(scope);
  if (got.length !== ids.size || got.some((f) => !ids.has(f.responseId))) throw new Error(`fact layer: card ${inp.id}: its ${ids.size} answers are not the scope's ${got.length} (${scopeKey(scope)})`);
  return scope;
}

/** A section of an explanation whose rows are a selection's members (its id carried). */
const selSec = (s: PanelDetailSection | null, id: string): PanelDetailSection | null => (s ? { ...s, selection: id } : null);

/** The worries cards (a buyer's worry and a customer's worry, each worry and all of them). */
function factWorryPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { sel } = PF;
  const buyer = inp.kind === "buyer_worry";
  const scope = doubtScope(inp, PF);
  const comp = sel.selection("sent_brands", "you", scope);
  const members = comp.members as SelMember[];
  const fc = mkFactCard(inp, ctx, scope, undefined, comp, members);
  const vf = (r: PoolRow) => verdictFind(r, h);
  const quote = (r: PoolRow) => (r.code.premise_quote ?? "").trim() || vf(r);
  const agrees = fx(fc, "agrees", "ai", scope, "answers that judge the worry", quote);
  const judged = knOf(agrees)!.n;
  const segs: PanelSegment[] = buyer
    ? [
        segFx(fc, "proceed", "go ahead", "you", "go_ahead", "ai", scope, "answers", vf),
        segFx(fc, "avoid", "steer clear", "away", "steer_clear", "ai", scope, "answers", vf),
        segFx(fc, "none", "no side", "neutral", "buyer_no_side", "ai", scope, "answers", vf),
      ]
    : [
        segFx(fc, "keep", "stay", "you", "stay", "ai", scope, "answers", vf),
        segFx(fc, "leave", "leave", "away", "leave", "ai", scope, "answers", vf),
        segFx(fc, "none", "no side", "neutral", "customer_no_side", "ai", scope, "answers", vf),
      ];
  const fav = segs[0].num;
  const claim = buyer
    ? join(
        inp.pooled ? "Across your buyers' worries, the AI agrees in " : `When a buyer worries "${inp.concern ?? inp.label}", the AI agrees in `,
        N(agrees),
        " of the answers that judge it, and tells them to go ahead in ",
        N(fav),
        "."
      )
    : fav.pct > segs[1].num.pct
      ? join(
          inp.pooled ? "Across your customers' worries, the AI " : `When a customer worries "${inp.concern ?? inp.label}", the AI `,
          "tells them to stay in ",
          N(fav),
          " of answers",
          segs[1].num.pct === 0 ? ", and never to leave." : join(" and to leave in ", N(segs[1].num), ".")
        )
      : join(
          inp.pooled ? "Across your customers' worries, the AI " : `When a customer worries "${inp.concern ?? inp.label}", the AI `,
          segs[1].num.pct === 0 ? "never tells them to leave" : join("tells them to leave in ", N(segs[1].num), " of answers"),
          fav.pct === 0 ? ", and never to stay." : join(segs[1].num.pct === 0 ? ", and tells them to stay in " : " and to stay in ", N(fav), segs[1].num.pct === 0 ? " of answers." : ".")
        );
  const nd = buyer ? { leave: 0, noDest: 0 } : leaveNoDest(inp);
  const destFind = (k: string, name: string) => (r: PoolRow) => (r.code.destinations ?? []).find((x) => h.resolve(x).key === k) ?? name;
  const block: PanelBlock | undefined = members.length
    ? {
        title: buyer ? `Which ${h.plural} it names instead` : `Which ${h.plural} it names to move to`,
        sub: `Share of these answers that name it as the alternative. Open a rival to see how it gets its picks.${!buyer && nd.leave && nd.noDest > nd.leave / 2 ? ` Most answers that say leave name no ${h.noun} at all.` : ""}`,
        selection: comp.id,
        rows: members.map((m) => ({ name: m.name, num: fx(fc, "sent_to", m.key, scope, "answers", destFind(m.key, m.name)), open: true as const })),
      }
    : undefined;
  // What each side weighs, led by the cell's top lift each way (the Map's lift list decides the leads and whether the
  // block is two-sided); too few answers either way, the unsided version.
  const favSlice = buyer ? "v:proceed_or_avoid:proceed" : "v:keep_or_leave:keep";
  const unfavSlice = buyer ? "v:proceed_or_avoid:avoid|v:premise_verdict:confirms&!v:proceed_or_avoid:proceed" : "v:keep_or_leave:leave";
  const weighs = doubtWeighs(
    inp,
    fc,
    ctx,
    buyer ? { title: "When it says go ahead", say: "say go ahead", slice: favSlice } : { title: "When it says stay", say: "say stay", slice: favSlice },
    buyer ? { title: "When it concedes", say: "concede the worry", slice: unfavSlice } : { title: "When it says leave", say: "say leave", slice: unfavSlice }
  );
  const rivals = members.map((m) => factRivalSmall(inp, fc, ctx, m, "Named as the alternative", { when: "as the alternative", alt: `sent:${m.key}`, altMeasure: "sent_to" }));
  const usual = usualOf(inp, ctx.inputs);
  return {
    kind: inp.kind,
    claim,
    ...(usual ? { usualCellId: usual.id, usualKey: buyer ? "All your buyers' worries" : "All your customers' worries" } : {}),
    hereKey: "This worry",
    stackLabel: "How the answer goes",
    steps: [
      ...(judged >= 5 ? [{ key: "agrees" as const, label: "Agrees the worry is fair", here: agrees, hereLabel: "Answers that judge it" }] : []),
      { key: "verdict", label: buyer ? "What it tells the buyer to do" : "What it tells the customer to do", segments: segs },
    ],
    ...(block ? { compare: true as const, competitors: block } : {}),
    lines: [],
    ...(weighs ? { weighs } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
}

/** Customers told to leave, and of them the ones named no brand to move to (facts on a fact card, else the rows). */
function leaveNoDest(inp: PanelCellInput): { leave: number; noDest: number } {
  const fc = FACT_CARD.get(inp)!;
  const { book } = fc.F;
  return { leave: book.fact("leave", "ai", fc.scope).k, noDest: book.fact("slice_share", "ai/slice:v:keep_or_leave:leave&!sent:any", fc.scope).k };
}

/** "What the answer weighs" on a doubt card: two sides led by the cell's top lift each way; no lift either way, or too
 * few answers on both sides, the unsided version (the old weighsSides rule, on facts). */
function doubtWeighs(inp: PanelCellInput, fc: FactCard, ctx: Ctx, fav: { title: string; say: string; slice: string }, unfav: { title: string; say: string; slice: string }): PanelWeighs | undefined {
  const { book } = fc.F;
  const pos = inp.lifts.filter((l) => l.value > 0).sort((a, b) => b.value - a.value)[0];
  const neg = inp.lifts.filter((l) => l.value < 0).sort((a, b) => a.value - b.value)[0];
  const enough = (when: string) => book.rows({ ...fc.scope, when }).filter((f) => f.args !== null).length >= ARGS_MIN;
  const unsided = () => factWeighs(inp, fc, ctx, [{ say: "come up here", unit: "answers", tone: "neutral" }], WEIGHS_SUB_ALL);
  if ((!pos && !neg) || (!enough(fav.slice) && !enough(unfav.slice))) return unsided();
  return (
    factWeighs(
      inp,
      fc,
      ctx,
      [
        { ...fav, tone: "good", ...(pos ? { lead: pos.label } : {}) },
        { ...unfav, tone: "bad", ...(neg ? { lead: neg.label } : {}) },
      ],
      WEIGHS_SUB_SIDES
    ) ?? unsided()
  );
}

/** The worries cards' two steps explained, from facts: the other judgements, what it advises after agreeing (and after
 * saying the worry is wrong), which worries it agrees with most (all-worries card), which AI companies agree most. */
function factWorryStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const ag = p.steps.find((s) => s.key === "agrees");
  if (!p.detail || !ag?.here) return;
  const { h } = ctx;
  const fc = FACT_CARD.get(inp)!;
  const { book, sel } = fc.F;
  const scope = fc.scope;
  const buyer = inp.kind === "buyer_worry";
  const T9 = WORRY_AGREES_TEXT;
  const vf = (r: PoolRow) => verdictFind(r, h);
  const quote = (r: PoolRow) => (r.code.premise_quote ?? "").trim() || vf(r);
  const CONF = "v:premise_verdict:confirms";
  const REB = "v:premise_verdict:rebuts";
  const JUDGED = "v:premise_verdict:confirms,mixed,rebuts";
  const [favM, badM, noneM] = buyer ? ["go_ahead", "steer_clear", "buyer_no_side"] : ["stay", "leave", "customer_no_side"];
  const at = (when: string): Scope => ({ ...scope, when });
  const advice = (when: string, unit: string) => [
    { label: buyer ? T9.go : T9.stay, num: fx(fc, favM, "ai", at(when), unit, vf) },
    { label: buyer ? T9.avoid : T9.leave, num: fx(fc, badM, "ai", at(when), unit, vf) },
    { label: T9.none, num: fx(fc, noneM, "ai", at(when), unit, vf) },
  ];
  const conf = book.fact("agrees", "ai", scope).k;
  const reb = book.fact("disagrees", "ai", scope).k;
  // The all-worries card: when it holds two worries or more, a row for each worry with enough answers that judge it.
  const severalWorries = inp.pooled && (sel.selection("worries", "ai", scope, { min: 1 }).members as SelMember[]).length >= 2;
  const worries = severalWorries ? sel.selection("worries", "ai", at(JUDGED), { min: ARGS_MIN }) : null;
  const vendors = sel.selection("vendors", "ai", at(JUDGED), { min: ARGS_MIN });
  const sections = [
    factSec(T9.judges.title, T9.judges.sub, "neutral", [
      { label: T9.partly, num: fx(fc, "partly_agrees", "ai", scope, "answers that judge the worry", quote) },
      { label: T9.wrong, num: fx(fc, "disagrees", "ai", scope, "answers that judge the worry", quote) },
    ], T9.judges.few, true),
    conf >= ARGS_MIN ? factSec(T9.after.title, T9.after.sub, "neutral", advice(CONF, "answers that agree"), T9.after.few, true) : null,
    reb >= ARGS_MIN ? factSec(T9.afterWrong.title, T9.afterWrong.sub, "neutral", advice(REB, "answers that say the worry is wrong"), T9.afterWrong.few, true) : null,
    worries
      ? selSec(factSec(T9.which.title, T9.which.sub, "bad", (worries.members as SelMember[]).map((w) => ({ label: w.name, num: fx(fc, "agrees", "ai", { ...scope, worry: w.key }, "answers that judge that worry", quote) })), T9.which.few), worries.id)
      : null,
    selSec(factSec(T9.vendor.title, T9.vendor.sub, "neutral", (vendors.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "agrees", "ai", { ...scope, vendor: v.name }, `${v.name} answers that judge the worry`, quote) })), T9.vendor.few), vendors.id),
  ].filter((x): x is PanelDetailSection & { selection?: string } => !!x);
  const share = (m: string) => {
    const f = book.fact(m, "ai", at(CONF));
    return f.n ? f.k / f.n : 0;
  };
  const after: WorryAfter = conf < ARGS_MIN ? "few" : share(badM) >= 0.5 ? "bad" : share(favM) >= 0.5 ? "fav" : share(noneM) >= 0.5 ? "none" : "split";
  const agreesDetail: PanelStepDetail = { ...worryAgreesDetail(agreesTakeaway(ag.here.pct).tag, after, buyer), ...(sections.length ? { sections } : {}) };
  const details = { verdict: p.detail, agrees: agreesDetail };
  p.details = details;
  if (p.compare) p.detailsComp = details;
  delete p.detail;
  delete p.detailComp;
}

/** "Your customers looking around". */
function factHoldPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { sel } = PF;
  const scope = doubtScope(inp, PF);
  const comp = sel.selection("sent_brands", "you", scope);
  const members = comp.members as SelMember[];
  const fc = mkFactCard(inp, ctx, scope, undefined, comp, members);
  const vf = (r: PoolRow) => verdictFind(r, h);
  const segs = [
    segFx(fc, "keep", "stay", "you", "stay", "ai", scope, "answers", vf),
    segFx(fc, "leave", "leave", "away", "leave", "ai", scope, "answers", vf),
    segFx(fc, "none", "no side", "neutral", "customer_no_side", "ai", scope, "answers", vf),
  ];
  const offers = fx(fc, "sent_to_any", "ai", scope, "answers", (r) => (r.code.destinations ?? []).find((x) => h.activeDests([x]).size > 0) ?? vf(r));
  const claim = join(
    "When your own customer asks what else to look at, the AI ",
    segs[0].num.pct === 0 && segs[1].num.pct === 0
      ? "never says stay or leave"
      : segs[0].num.pct === 0
        ? join("never says stay, and says leave in ", N(segs[1].num), " of answers")
        : segs[1].num.pct === 0
          ? join("says stay in ", N(segs[0].num), " of answers and never says leave")
          : join("says stay in ", N(segs[0].num), " of answers and leave in ", N(segs[1].num)),
    `. It shows them another ${h.noun} in `,
    N(offers),
    offers.pct === 100 ? " of answers." : "."
  );
  const words: CondWords = {
    title: `When the AI says stay, and when to look at another ${h.noun}`,
    sub: `Share of these answers that say "stay if the customer..." or "look at another ${h.noun} if...".`,
    towardTitle: "Stay if",
    awayTitle: `Look at another ${h.noun} if`,
    alsoToward: `Also said for another ${h.noun}`,
    alsoAway: "Also said for staying",
    toWord: "Shown",
  };
  const conditions = factConditions(inp, fc, ctx, words, { pickKind: false, pairs: false });
  let lead: PanelText | undefined;
  const a = conditions?.away ?? [];
  if (a.length) {
    const towardSum = (conditions?.toward ?? []).reduce((x, c) => x + c.share.pct, 0);
    // The lead quotes the conditions without their shares (the block below carries them), so it never repeats a bar number.
    lead = join(attachedLead(`looking at another ${h.noun}`, a.slice(0, 2).map((c) => ({ text: c.text })), "answers"), towardSum < 15 ? " It gives few conditions for staying." : "");
  }
  const destFind = (k: string, name: string) => (r: PoolRow) => (r.code.destinations ?? []).find((x) => h.resolve(x).key === k) ?? name;
  const block: PanelBlock | undefined = members.length
    ? {
        title: `Which ${h.plural} it shows`,
        sub: `Share of these answers that name it as an alternative. Open a rival to see how it gets its picks.`,
        selection: comp.id,
        rows: members.map((m) => ({ name: m.name, num: fx(fc, "sent_to", m.key, scope, "answers", destFind(m.key, m.name)), open: true as const })),
      }
    : undefined;
  const rivals = members.map((m) => factRivalSmall(inp, fc, ctx, m, "Shown as an alternative", { when: "as an alternative", alt: `sent:${m.key}`, altMeasure: "sent_to" }));
  const weighs = factWeighs(inp, fc, ctx, [{ say: "come up here", unit: "answers", tone: "neutral" }], WEIGHS_SUB_ALL);
  const out: PositionPanel = {
    kind: "looking_around",
    claim,
    ...(lead ? { lead } : {}),
    stackLabel: "How the answer goes",
    steps: [
      { key: "verdict", label: "What it tells the customer to do", segments: segs },
      { key: "offers", label: `Shows another ${h.noun}`, here: offers, hereLabel: "All answers" },
    ],
    ...(conditions ? { conditions } : {}),
    lines: [],
    ...(weighs ? { weighs } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
  // The list of rivals shown sits in the "shows another" step's explanation (factLookingStepDetails).
  if (block) LOOK_BLOCK.set(out, block);
  return out;
}

/** The looking-around card's "shows another" step explained, from facts: how long the list is, the rivals shown, who
 * first, which of their products and your own other products (the run's one product grouping). */
function factLookingStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx, shown: PanelBlock | undefined) {
  if (!p.detail || !p.steps.some((s) => s.key === "offers" && s.here)) return;
  const { h } = ctx;
  const T9 = LOOKING_TEXT;
  const fc = FACT_CARD.get(inp)!;
  const { book, sel, set } = fc.F;
  const scope = fc.scope;
  const vf = (r: PoolRow) => verdictFind(r, h);
  const at = (when: string): Scope => ({ ...scope, when });
  const sl = (expr: string, sc: Scope, unit: string, find: (r: PoolRow) => string) => fx(fc, "slice_share", `ai/slice:${expr}`, sc, unit, find);
  const some = book.fact("sent_to_any", "ai", scope).k;
  const fs = sel.selection("first_sent", "ai", scope, { top: 4 });
  const firstTop = fs.members as SelMember[];
  const lead = firstTop[0] && some >= ARGS_MIN && firstTop[0].count / some >= 0.3 ? firstTop[0].name : undefined;
  const prods = set.ladder ? sel.selection("sent_products", "ai", scope, { top: 5 }) : null;
  const own = set.ladder ? sel.selection("sent_own_products", "ai", scope, { top: 3 }) : null;
  const sections = [
    factSec(T9.size.title, T9.size.sub(h.plural), "neutral", [
      { label: T9.size.few, num: sl("nsent:1-2", scope, "answers", vf) },
      { label: T9.size.mid, num: sl("nsent:3-5", scope, "answers", vf) },
      { label: T9.size.many, num: sl("nsent:6-999", scope, "answers", vf) },
    ], T9.size.none, true),
    shown ? { title: shown.title, sub: shown.sub, tone: "bad" as const, rows: shown.rows.map((r) => ({ label: r.name, num: r.num, ...(r.open ? { open: true as const } : {}) })), ...(shown.selection ? { selection: shown.selection } : {}) } : null,
    some >= ARGS_MIN ? selSec(factSec(T9.first.title, T9.first.sub, "bad", firstTop.map((x) => ({ label: x.name, num: sl(`firstsent:${x.key}`, at("sent:any"), "answers that show a rival", () => x.name) })), T9.first.few), fs.id) : null,
    prods && prods.members.length >= 2 ? selSec(factSec(T9.products.title(h.plural), T9.products.sub, "bad", (prods.members as SelMember[]).map((x) => ({ label: x.name, num: sl(`sentprod:${x.key}`, scope, "answers", () => x.name) })), T9.products.few), prods.id) : null,
    own && own.members.length ? selSec(factSec(T9.own.title(h.plural), T9.own.sub, "good", (own.members as SelMember[]).map((x) => ({ label: x.name, num: sl(`sentprod:${x.key}`, scope, "answers", () => x.name) })), T9.own.few), own.id) : null,
  ].filter((x): x is PanelDetailSection => !!x);
  // The usual length of the list (the lower median of how many rivals an answer that shows one shows), from facts:
  // the median is at least t when the answers showing fewer than t are no more than the median's place.
  const place = Math.floor((some - 1) / 2);
  const under = (hi: number) => book.fact("slice_share", `ai/slice:nsent:1-${hi}`, at("sent:any")).k;
  const size = some === 0 ? "none" : under(5) <= place ? "long" : under(2) <= place ? "short" : "few";
  const offersDetail: PanelStepDetail = { ...lookingOffersDetail(size, h.noun, h.plural, lead), ...(sections.length ? { sections } : {}) };
  p.details = { verdict: p.detail, offers: offersDetail };
  delete p.detail;
  delete p.detailComp;
}

/** The Value card (each buyer and all buyers). */
function factValuePanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { sel, set } = PF;
  const scope = doubtScope(inp, PF);
  const comp = sel.selection("instead_brands", "you", scope);
  const members = comp.members as SelMember[];
  const fc = mkFactCard(inp, ctx, scope, undefined, comp, members);
  const ladder = set.ladder;
  const vf = (r: PoolRow) => verdictFind(r, h);
  const factById = new Map(PF.book.rows(scope).map((f) => [f.responseId, f]));
  const instead = (r: PoolRow) => factById.get(r.code.response_id)?.price ?? null;
  const rivalFind = (r: PoolRow) => {
    const pf = instead(r);
    const keys = new Set((pf?.rivals ?? []).map((x) => x.key));
    return (r.code.mentions ?? []).find((m) => m.framing === "recommended" && keys.has(h.resolve(m.brand).key ?? ""))?.brand ?? pf?.rivals[0]?.name ?? h.brand;
  };
  const ownFind = (r: PoolRow) => instead(r)?.own[0]?.written ?? h.brand;
  const segs = [
    segFx(fc, "yes", "worth it", "you", "worth_yes", "ai", scope, "answers", vf),
    segFx(fc, "depends", "depends", "neutral", "worth_depends", "ai", scope, "answers", vf),
    segFx(fc, "no", "not worth it", "away", "worth_no", "ai", scope, "answers", vf),
  ];
  // Where it points the buyer instead - ruling 3: every answer in one bucket (a rival, else your own, else nowhere); a
  // brand with no ladder of its own lines has no own-cheaper option at all.
  const insteadSegs: PanelSegment[] = [
    ...(ladder ? [segFx(fc, "own", "only your own cheaper option", "neutral", "instead_own", "ai", scope, "answers", ownFind)] : []),
    segFx(fc, "rival", ladder ? `a rival's ${h.noun}` : "a rival", "away", "instead_rival", "ai", scope, "answers", rivalFind),
    segFx(fc, "nowhere", ladder ? "nowhere" : "no rival", "neutral", "instead_nowhere", "ai", scope, "answers", vf),
  ];
  // The product asked about (the setup's confirmed lines - configuration, not a count): the cell's line; on the
  // all-buyers card, the lines its buyers were asked about.
  const sibs = inp.pooled ? siblingsOf(inp, ctx.inputs).filter((x) => x.kind === "value") : [];
  const sibLines = [...new Set(sibs.filter((x) => x.line).map((x) => x.line!))];
  const subject = inp.pooled ? (sibLines.length === 1 ? sibLines[0] : h.brand) : inp.line ?? h.brand;
  const lineOfSib = (x: PanelCellInput) => x.line || h.brand;
  const configured = [...new Set(sibs.map(lineOfSib))];
  const pl = inp.pooled ? sel.selection("price_lines", "ai", scope) : null;
  // Several products asked about: the setup's configured lines (the table's rows are the price_lines selection).
  const several = inp.pooled && configured.length >= 2;
  const product = several ? listWords(configured) : inp.pooled ? sibLines[0] : inp.line ?? undefined;
  const yes = segs[0].num;
  const no = segs[2].num;
  const claim = join(
    `Asked whether ${subject} is worth it over a cheaper ${h.noun}${inp.pooled ? ", across all buyers" : " for this buyer"}, the AI says no in `,
    N(no),
    " of answers and ",
    yes.pct === 0 ? "never says yes" : join("yes in ", N(yes)),
    "."
  );
  // By product asked about (the all-buyers card when its buyers were asked about 2+ products): the price_lines
  // selection, each cell a verdict fact on that line's answers.
  let byProduct: PanelTable | undefined;
  if (several && pl) {
    byProduct = {
      title: BY_PRODUCT.title,
      sub: BY_PRODUCT.sub,
      columns: BY_PRODUCT.columns,
      style: "compare",
      selection: pl.id,
      rows: (pl.members as SelMember[]).map((l) => ({
        label: l.name,
        cells: [
          ...(["worth_yes", "worth_depends", "worth_no"] as const).map((m) => fx(fc, m, "ai", { ...scope, line: l.name }, "answers about it", vf)),
          // The buyers asked about it (the setup's cells; a buyer's cell label may carry its line after " - ").
          T(listWords(sibs.filter((x) => lineOfSib(x) === l.name).map((x) => (x.label.endsWith(` - ${l.name}`) ? x.label.slice(0, -(l.name.length + 3)) : x.label)))),
        ],
      })),
    };
  }
  const rivals = members.map((m) => factRivalSmall(inp, fc, ctx, m, "Named as the better option", { when: "as the better option", alt: `instead:${m.key}`, altMeasure: "named_instead", youAlt: { m: "worth_yes", find: vf } }));
  // The explanation's lists of new facts, in order.
  const sections: PanelDetailSection[] = [];
  {
    const vrows: PanelDetailSection["rows"] = [];
    const folds: string[] = [];
    for (const v of ["no", "depends", "yes"] as const) {
      const f = fx(fc, "instead_rival", "ai", { ...scope, when: `v:worth_it:${v}` }, `answers that say ${segs.find((g) => g.key === v)!.label}`, rivalFind);
      const kn = knOf(f)!;
      if (kn.n < ARGS_MIN) continue;
      if (kn.k >= ROW_MIN) vrows.push({ label: VALUE_VERDICT_ROW[v], num: f });
      else folds.push(valueVerdictFold(v, kn.k === 0));
    }
    if (vrows.length || folds.length) sections.push({ ...VALUE_SECTIONS.byVerdict, tone: "bad", rows: vrows, ...(folds.length ? { note: join(folds.join(" ")) } : {}) });
  }
  if (members.length)
    sections.push({
      ...VALUE_SECTIONS.rivals,
      tone: "bad",
      selection: comp.id,
      rows: members.map((c) => ({ label: c.name, num: fx(fc, "named_instead", c.key, scope, "answers", (r) => (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === c.key)?.brand ?? c.name), open: true as const })),
    });
  {
    const ps = sel.selection("instead_products", "ai", scope, { top: 5 });
    const items = (ps.members as SelMember[]).filter((x) => x.count >= ROW_MIN).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:insteadprod:${x.key}`, scope, "answers", () => x.name) }));
    if (items.length >= 2) sections.push({ ...VALUE_SECTIONS.products(h.plural), tone: "bad", rows: items, selection: ps.id });
  }
  if (ladder && knOf(insteadSegs[0].num)!.k > 0) {
    const os = sel.selection("own_options", "ai", scope, { top: 3 });
    const items = (os.members as SelMember[]).filter((x) => x.count >= ROW_MIN).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:ownopt:${x.key}`, scope, "answers", () => x.name) }));
    if (items.length) sections.push({ ...VALUE_SECTIONS.own, tone: "good", rows: items, selection: os.id });
  }
  const weighs = doubtWeighs(inp, fc, ctx, { title: "When it says worth it", say: "say worth it", slice: "v:worth_it:yes" }, { title: "When it says not worth it", say: "say not worth it", slice: "v:worth_it:no" });
  const usual = usualOf(inp, ctx.inputs);
  const panel: PositionPanel = {
    kind: "value",
    claim,
    ...(usual ? { usualCellId: usual.id, usualKey: "All buyers" } : {}),
    hereKey: inp.pooled ? "All buyers" : "This buyer",
    stackLabel: "How the answer goes",
    steps: [
      { key: "worth", label: valueStepLabel(product, several), segments: segs },
      { key: "instead", label: "Where it points the buyer instead", segments: insteadSegs },
    ],
    ...(product ? { product } : {}),
    ...(byProduct ? { byProduct } : {}),
    lines: [],
    ...(weighs ? { weighs } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
  VALUE_EXTRA.set(panel, { sections, topRival: members[0]?.name, byProduct: !!byProduct });
  return panel;
}

/* ------------- fact layer, cards step 4 (last slice): the remaining seven kinds and the settled index ------------- */

/**
 * Spotting the problem, Learning the category, What to look for, the business case, expansion, What to use alongside
 * you, Answering a critic and the settled customers' All questions card read the fact layer
 * (FACT_LAYER_DESIGN_2026-11-17.md step 4, last slice): every drawn number is a fact (measure | subject | scope, or the
 * average competitor of a selection), every list a selection; these builders count nothing themselves. Rulings that
 * land here: 5 (a problem answer pointed somewhere adjacent is its own share, "none" its own), 6, 8 (a brand outside of
 * analysis is never listed or counted), 14 (one condition grouping), 15 (one product grouping - the pairings named
 * alongside too), and the ratified competitor shape on Spotting the problem (ranked by recommendations, floor 5) and
 * Learning the category (ranked by answers naming it, floor 3).
 */

/** A card's scope from its own answers: their question types, and their buying situation when the types alone hold
 * more answers. The card's answers must be exactly the scope's - else the card is not built (the Map logs it). */
function factScope(inp: PanelCellInput, F: PickFacts): Scope {
  const ids = new Set(inp.rows.map((r) => r.code.response_id));
  const fs = F.set.facts.filter((f) => ids.has(f.responseId));
  const types = [...new Set(fs.map((f) => f.type))].sort() as QuestionType[];
  let scope: Scope = { types };
  if (F.book.rows(scope).length !== ids.size && !inp.pooled) scope = { types, situation: fs[0]?.situation ?? null };
  const got = F.book.rows(scope);
  if (got.length !== ids.size || got.some((f) => !ids.has(f.responseId))) throw new Error(`fact layer: card ${inp.id}: its ${ids.size} answers are not the scope's ${got.length} (${scopeKey(scope)})`);
  return scope;
}

/** A section of rows of 3+ answers (sorted by share unless kept in order); nothing when none clears the floor. */
function secPlain(title: string, sub: string, tone: PanelTone, items: { label: string; num: PanelNum }[], keepOrder = false): PanelDetailSection | null {
  const rate = (x: PanelNum) => {
    const kn = knOf(x)!;
    return kn.n ? kn.k / kn.n : 0;
  };
  const ok = items.filter((x) => (knOf(x.num)?.k ?? 0) >= ROW_MIN && (knOf(x.num)?.n ?? 0) > 0);
  if (!keepOrder) ok.sort((a, b) => rate(b.num) - rate(a.num) || a.label.localeCompare(b.label));
  return ok.length ? { title, sub, tone, rows: ok.map((x) => ({ label: x.label, num: x.num })) } : null;
}

/** secPlain, but a section with a "few" sentence whenever no row clears the floor. */
function secFew(title: string, sub: string, tone: PanelTone, items: { label: string; num: PanelNum }[], few: string): PanelDetailSection | null {
  const s = secPlain(title, sub, tone, items);
  return s ?? (few ? { title, sub, tone, rows: [], note: join(few) } : null);
}

/** A section where a 0% row is the fact (What to look for): every row with a base, sorted by share unless kept in order. */
function secAll(title: string, sub: string, tone: PanelTone, items: { label: string; num: PanelNum }[], keepOrder = false): PanelDetailSection | null {
  const rate = (x: PanelNum) => {
    const kn = knOf(x)!;
    return kn.n ? kn.k / kn.n : 0;
  };
  const shown = items.filter((x) => (knOf(x.num)?.n ?? 0) > 0);
  if (!keepOrder) shown.sort((a, b) => rate(b.num) - rate(a.num) || a.label.localeCompare(b.label));
  return shown.length ? { title, sub, tone, rows: shown.map((x) => ({ label: x.label, num: x.num })) } : null;
}

/** Spotting the problem (each buyer and all buyers). */
function factProblemPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { sel, set } = PF;
  const T = set.target.key;
  const scope = factScope(inp, PF);
  const usualInp = usualOf(inp, ctx.inputs);
  const uScope = usualInp ? factScope(usualInp, PF) : undefined;
  const comp = sel.selection("competitors", "you", scope, { rankBy: "recommended", floor: BRAND_FLOOR });
  const members = comp.members as SelMember[];
  const fc = mkFactCard(inp, ctx, scope, uScope, comp, members);
  const vf = (r: PoolRow) => verdictFind(r, h);
  const surfF = (k: string, rec: boolean, name: string) => (r: PoolRow) => surfOf(r, k, h, rec) ?? r.code.top_pick ?? name;
  const category = fx(fc, "routed_category", "ai", scope, "answers", vf);
  const named = fx(fc, "named", "you", scope, "answers", surfF(T, false, h.brand));
  const rec = fx(fc, "recommended", "you", scope, "answers", surfF(T, true, h.brand));
  const claim = join(
    inp.pooled ? `When buyers describe their problem without asking for ${article(h.noun)} ${h.noun}, the AI recommends you in ` : `When this buyer describes their problem without asking for ${article(h.noun)} ${h.noun}, the AI recommends you in `,
    N(rec),
    " of answers."
  );
  const other = comp.extras.other!;
  const memberNum = (m: string, rec2: boolean) => (x: SelMember) => ({ name: x.name, num: fx(fc, m, subj(fc, x.key), scope, "answers", surfF(x.key, rec2, x.name)) });
  const otherRows = (m: string, rec2: boolean): PanelOther | undefined => {
    if (!other.shown.length && !other.rest) return undefined;
    const rows = other.shown.map((x) => ({ name: x.name, num: fx(fc, m, subj(fc, x.key), scope, "answers", surfF(x.key, rec2, x.name)) }));
    rows.sort((p, q) => knOf(q.num)!.k - knOf(p.num)!.k || p.name.localeCompare(q.name));
    return { rows, ...(other.rest ? { rest: moreBrands(other.rest) } : {}), selection: comp.id };
  };
  const steps: PanelStep[] = [
    {
      key: "category",
      label: `The answer points the buyer to ${h.plural}`,
      here: category,
      hereLabel: "All answers",
      ...(members.length ? { tagRank: "Same for every brand" } : {}),
      // am37: being named can outrun this step - an answer can mention you while it mainly sends the buyer outside the category.
      ...(knOf(category)!.k < knOf(named)!.k ? { note: join(`You can be named in an answer that mainly points the buyer away from ${h.plural}.`) } : {}),
    },
    { key: "named", label: "Named", here: named, ...(members.length ? { rivals: members.map(memberNum("named", false)), ...optOther(otherRows("named", false)) } : {}) },
    { key: "recommended", label: "Recommended", here: rec, ...(members.length ? { rivals: members.map(memberNum("recommended", true)), ...optOther(otherRows("recommended", true)) } : {}) },
  ];
  if (members.length) {
    fc.avg.named = fxAvg(fc, "named", scope, "answers, the competitors shown added up", (k) => (r) => surfOf(r, k, h, false) ?? r.code.top_pick ?? "");
    fc.avg.recommended = fxAvg(fc, "recommended", scope, "answers, the competitors shown added up", (k) => (r) => surfOf(r, k, h, true) ?? r.code.top_pick ?? "");
  }
  // Table: the topics these answers cover (ruling 5's too-obvious rule), this buyer beside all buyers.
  const ts = sel.selection("topics_shown", "ai", scope, { top: 6, floor: 0, list: "topics" });
  const topics = ts.members as SelMember[];
  const table: PanelTable | undefined = topics.length
    ? {
        title: "What these answers cover",
        sub: "Share of the answers that raise each topic. These questions take no picks, so there is no case for or against one brand.",
        columns: uScope ? ["This buyer", "All buyers"] : [inp.pooled ? "All buyers" : "This buyer"],
        style: "compare",
        rows: topics.map((x) => ({ label: clabel(x.key, h), cells: [fx(fc, "argues", `ai/arg:${x.key}`, scope, "answers", () => x.key), ...(uScope ? [fx(fc, "argues", `ai/arg:${x.key}`, uScope, "answers", () => x.key)] : [])] })),
        selection: ts.id,
      }
    : undefined;
  const rivals = members.map((m) => factRivalSmall(inp, fc, ctx, m, "Recommended", { measure: "recommended", noWeighs: true }));
  return {
    kind: "problem",
    claim,
    ...(usualInp ? { usualCellId: usualInp.id, usualKey: "Across all buyers" } : {}),
    hereKey: inp.pooled ? "Across all buyers" : "With this buyer",
    stackLabel: "How the answer goes",
    steps,
    ...(members.length
      ? {
          compare: true as const,
          competitorOrder: members.map((x) => x.name),
          competitorSelection: comp.id,
          competitors: {
            title: "Which brands it recommends",
            sub: "Share of these answers that recommend it. Open a rival to see how it gets them.",
            selection: comp.id,
            rows: members.map((x) => ({ name: x.name, num: fx(fc, "recommended", subj(fc, x.key), scope, "answers", surfF(x.key, true, x.name)), open: true as const, ...(x.headToHead ? { tag: "head-to-head" } : {}) })),
            ...(otherRows("recommended", true) ? { other: otherRows("recommended", true)! } : {}),
          },
        }
      : {}),
    ...(table ? { table } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
}

/** Learning the category. */
function factLearningPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { sel, set } = PF;
  const T = set.target.key;
  const scope = factScope(inp, PF);
  const u = ctx.inputs.get("chooses:awareness:all");
  const uScope = u ? factScope(u, PF) : undefined;
  const uName = ROW_NAME.awareness.toLowerCase();
  const comp = sel.selection("competitors", "you", scope, { rankBy: "named", floor: ROW_MIN });
  const members = comp.members as SelMember[];
  const fc = mkFactCard(inp, ctx, scope, uScope, comp, members);
  const anyFind = (r: PoolRow) => (r.code.mentions ?? []).find((m) => counted(m.brand, h))?.brand ?? r.code.top_pick ?? h.brand;
  const surfF = (k: string, name: string) => (r: PoolRow) => surfOf(r, k, h, false) ?? r.code.top_pick ?? name;
  const read = (sc: Scope) => ({
    any: fx(fc, "names_any_brand", "ai", sc, "answers", anyFind),
    named: fx(fc, "named", "you", sc, "answers", surfF(T, h.brand)),
    namedWhen: fx(fc, "named_when_any", "you", sc, "answers that name a brand", surfF(T, h.brand)),
  });
  const me = read(scope);
  const us = uScope ? read(uScope) : undefined;
  const compNums = members.map((x) => ({ x, named: fx(fc, "named", subj(fc, x.key), scope, "answers", surfF(x.key, x.name)) }));
  const myK = knOf(me.named)!.k;
  const leads = compNums.length > 0 && compNums.every((c) => knOf(c.named)!.k < myK);
  const claim = join(
    whenAsks(inp, "buyer", `how ${h.plural} work`),
    "the AI names you in ",
    N(me.named),
    " of answers",
    leads ? ", more than any other brand." : ".",
    knOf(me.any)!.k * 2 < fc.n ? " Most of these answers name no brand at all. When one does, it names you in " : " When the answer names a brand, it names you in ",
    N(me.namedWhen),
    " of them."
  );
  const other = comp.extras.other!;
  const otherNamed: PanelOther | undefined =
    other.shown.length || other.rest
      ? {
          rows: other.shown.map((x) => ({ name: x.name, num: fx(fc, "named", subj(fc, x.key), scope, "answers", surfF(x.key, x.name)) })).sort((p, q) => knOf(q.num)!.k - knOf(p.num)!.k || p.name.localeCompare(q.name)),
          ...(other.rest ? { rest: moreBrands(other.rest) } : {}),
          selection: comp.id,
        }
      : undefined;
  const steps: PanelStep[] = [
    { key: "anybrand", label: "The answer names any brand", here: me.any, ...(us ? { usual: us.any } : {}), compHereLabel: "Any brand", ...(compNums.length ? { tagRank: "Same for every brand" } : {}) },
    { key: "named", label: "Named", here: me.named, ...(us ? { usual: us.named } : {}), ...(compNums.length ? { rivals: compNums.map((c) => ({ name: c.x.name, num: c.named })), ...optOther(otherNamed) } : {}) },
    { key: "namedwhen", label: "Named, when the answer names a brand", here: me.namedWhen, ...(us ? { usual: us.namedWhen } : {}) },
  ];
  if (members.length) fc.avg.named = fxAvg(fc, "named", scope, "answers, the competitors shown added up", (k) => (r) => surfOf(r, k, h, false) ?? r.code.top_pick ?? "");
  // Table: the topics, this question beside spotting the problem (ruling 5's too-obvious rule).
  const ts = sel.selection("topics_shown", "ai", scope, { top: 6, floor: ROW_MIN, list: "topics" });
  const topics = ts.members as SelMember[];
  const mk = (withU: boolean): PanelTable => ({
    title: "What these answers cover",
    sub: withU
      ? "Share of the answers that raise each topic. These questions take no picks, so there is no case for or against one brand."
      : "Share of the answers that raise each topic. The topics are the same whichever brand is named, so this block does not split by competitor.",
    columns: withU ? ["This question", upperFirst(uName)] : ["This question"],
    style: "compare",
    rows: topics.map((x) => ({ label: clabel(x.key, h), cells: [fx(fc, "argues", `ai/arg:${x.key}`, scope, "answers", () => x.key), ...(withU && uScope ? [fx(fc, "argues", `ai/arg:${x.key}`, uScope, "answers", () => x.key)] : [])] })),
    selection: ts.id,
  });
  return {
    kind: "learning",
    claim,
    hereKey: "This question",
    ...(u ? { usualKey: `${upperFirst(uName)}, all buyers` } : {}),
    stackLabel: "How the answer goes",
    steps,
    ...(compNums.length ? { compare: true as const, competitorOrder: compNums.map((c) => c.x.name), competitorSelection: comp.id } : {}),
    ...(topics.length ? { table: mk(!!u), ...(u ? { tableComp: mk(false) } : {}) } : {}),
    lines: [],
  };
}

/** Spotting the problem's and Learning the category's own steps explained, from facts: where the rest of the answers go
 * (ruling 5: adjacent and nowhere, each its own share), what they recommend there, which AI companies stay in the
 * category; which AI companies name a brand at all; who is named when you are not, who first, which of your products,
 * which AI companies name you. */
function factAwarenessDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const fc = FACT_CARD.get(inp)!;
  if (fc.n < DETAIL_MIN) return;
  const { h } = ctx;
  const { book, sel, set } = fc.F;
  const T = set.target.key;
  const scope = fc.scope;
  const all = fc.n;
  const vf = (r: PoolRow) => verdictFind(r, h);
  const step = (k: PanelStepKey) => p.steps.find((s) => s.key === k && !!s.here);
  const details: Partial<Record<PanelStepKey, PanelStepDetail>> = { ...(p.details ?? {}) };
  const detailsComp: Partial<Record<PanelStepKey, PanelStepDetail>> = { ...(p.detailsComp ?? {}) };
  const vendors = (min: number, sc: Scope) => sel.selection("vendors", "ai", sc, { min });
  if (p.kind === "problem" && step("category")) {
    const adjacent = fx(fc, "routed_adjacent", "ai", scope, "answers", vf);
    const nowhere = fx(fc, "routed_none", "ai", scope, "answers", vf);
    const adjK = knOf(adjacent)!.k;
    const names = sel.selection("adjacent_names", "ai", scope);
    const vs = vendors(ROW_MIN, scope);
    const sections = [
      factSec(ROUTED_TEXT.rest.title, ROUTED_TEXT.rest.sub, "neutral", [
        { label: ROUTED_TEXT.adjacent(h.plural), num: adjacent },
        { label: ROUTED_TEXT.nowhere, num: nowhere },
      ], ROUTED_TEXT.rest.few),
      selSec(factSec(ROUTED_TEXT.names.title, ROUTED_TEXT.names.sub(h.plural), "bad", (names.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:frec:${x.key}`, { ...scope, when: "v:category_routed:adjacent" }, "answers that point elsewhere", () => x.name) })), ROUTED_TEXT.names.few), names.id),
      selSec(factSec(ROUTED_TEXT.vendor.title(h.plural), ROUTED_TEXT.vendor.sub, "neutral", (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "routed_category", "ai", { ...scope, vendor: v.name }, `${v.name} answers`, vf) })), ROUTED_TEXT.vendor.few), vs.id),
    ].filter((x): x is PanelDetailSection => !!x);
    const share = all ? knOf(step("category")!.here!)!.k / all : 0;
    const d: PanelStepDetail = { ...routedDetail(share >= 0.9 ? "nearly" : share >= 0.5 ? "usually" : adjK >= knOf(nowhere)!.k ? "elsewhere" : "nowhere", h.plural), ...(sections.length ? { sections } : {}) };
    details.category = d;
    if (p.compare) detailsComp.category = d;
  }
  if (p.kind === "learning" && step("anybrand")) {
    const vs = vendors(ROW_MIN, scope);
    const anyFind = (r: PoolRow) => (r.code.mentions ?? []).find((m) => counted(m.brand, h))?.brand ?? h.brand;
    const sections = [selSec(factSec(ANYBRAND_TEXT.vendor.title, ANYBRAND_TEXT.vendor.sub, "neutral", (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "names_any_brand", "ai", { ...scope, vendor: v.name }, `${v.name} answers`, anyFind) })), ANYBRAND_TEXT.vendor.few), vs.id)].filter((x): x is PanelDetailSection => !!x);
    const share = all ? knOf(step("anybrand")!.here!)!.k / all : 0;
    const d: PanelStepDetail = { ...anyBrandDetail(share >= 0.5 ? "usually" : share >= 0.2 ? "sometimes" : "rarely", h.plural), ...(sections.length ? { sections } : {}) };
    details.anybrand = d;
    if (p.compare) detailsComp.anybrand = d;
  }
  if (p.kind === "learning" && step("namedwhen")) {
    const ANY = "anybrand";
    const WITHOUT = "anybrand&!named:you";
    const base = book.fact("names_any_brand", "ai", scope).k;
    const withYou = book.fact("named", "you", { ...scope, when: ANY }).k;
    const surfF = (k: string, name: string) => (r: PoolRow) => surfOf(r, k, h, false) ?? name;
    const others = sel.selection("named_brands", "you", scope, { slice: WITHOUT, top: 5 });
    const first = sel.selection("first_named", "you", { ...scope, when: ANY }, { youFirst: true, top: 3 });
    const prods = ctx.ladder ? sel.selection("product_names", "you", { ...scope, when: "named:you" }, { brand: T, top: 5 }) : null;
    const vs = vendors(ROW_MIN, { ...scope, when: ANY });
    const sections = [
      selSec(factSec(NAMEDWHEN_TEXT.others.title, NAMEDWHEN_TEXT.others.sub, "bad", (others.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "named", x.key, { ...scope, when: WITHOUT }, "answers that name a brand but not you", surfF(x.key, x.name)) })), NAMEDWHEN_TEXT.others.few), others.id),
      selSec(factSec(NAMEDWHEN_TEXT.first.title, NAMEDWHEN_TEXT.first.sub, "neutral", (first.members as SelMember[]).map((x) => ({ label: x.key === T ? "You" : x.name, num: fx(fc, "slice_share", `ai/slice:first:${x.key}`, { ...scope, when: ANY }, "answers that name a brand", () => x.name) })), NAMEDWHEN_TEXT.first.few), first.id),
      prods && prods.members.length >= 2
        ? selSec(factSec(NAMEDWHEN_TEXT.products.title(h.plural), NAMEDWHEN_TEXT.products.sub, "good", (prods.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:nameprod:${x.key}`, { ...scope, when: "named:you" }, "answers that name you", () => x.name) })), NAMEDWHEN_TEXT.products.few), prods.id)
        : null,
      selSec(factSec(NAMEDWHEN_TEXT.vendor.title, NAMEDWHEN_TEXT.vendor.sub, "good", (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "named_when_any", "you", { ...scope, vendor: v.name }, `${v.name} answers that name a brand`, surfF(T, h.brand)) })), NAMEDWHEN_TEXT.vendor.few), vs.id),
    ].filter((x): x is PanelDetailSection => !!x);
    const share = base ? withYou / base : 0;
    const d: PanelStepDetail = { ...namedWhenDetail(share >= 0.5 ? "usually" : share >= 0.2 ? "sometimes" : "rarely"), ...(sections.length ? { sections } : {}) };
    details.namedwhen = d;
    if (p.compare) detailsComp.namedwhen = d;
  }
  if (Object.keys(details).length) p.details = details;
  if (Object.keys(detailsComp).length) p.detailsComp = detailsComp;
}

/** What to look for (each buyer and all buyers). */
function factCriteriaPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { book, sel } = PF;
  const scope = factScope(inp, PF);
  const cl = sel.selection("checklist", "ai", scope);
  const top5 = (cl.members as SelMember[]).map((x) => x.key);
  const fc = mkFactCard(inp, ctx, scope, undefined, cl, []);
  const taughtSet = new Set(top5);
  const taughtNum = (code: string) => fx(fc, "argues", `ai/arg:${code}`, scope, "answers", () => code);
  // am37: a buyer's own what-to-buy answers say what wins when it picks you, when there are enough of them; else the
  // all-buyers figures (ruling 7: What to buy, all buyers = discovery + use case), said so.
  const room = !inp.pooled ? ctx.inputs.get(`chooses:open:${inp.key}`) : undefined;
  const roomScope = room ? pickScope(room, PF).scope : undefined;
  const sides = (sc: Scope) => {
    const you = book.fact("share_of_picks", "you", sc).k;
    return { you, other: book.fact("commit_rate", "ai", sc).k - you };
  };
  const roomSides = roomScope ? sides(roomScope) : null;
  const local = !!roomSides && roomSides.you >= ARGS_MIN && roomSides.other >= ARGS_MIN;
  const S: Scope = local ? roomScope! : WHAT_TO_BUY_ALL;
  const liftSel = local ? sel.selection("arg_lift", "you", S, { lift: "local" }) : roomScope ? null : sel.selection("arg_lift", "you", S, { lift: "summary" });
  type L = { key: string; wins: { k: number; n: number }; others: { k: number; n: number }; lift: number };
  const lift = (liftSel?.members ?? []) as unknown as L[];
  const noRead = !!roomScope && !local;
  const winners = lift
    .filter((l) => l.lift > 0 && cell(l.wins.k, l.wins.n).low > cell(l.others.k, l.others.n).high && !taughtSet.has(l.key))
    .sort((a, b) => b.wins.k / Math.max(1, b.wins.n) - a.wins.k / Math.max(1, a.wins.n) || a.key.localeCompare(b.key));
  const pickNum = (code: string, you: boolean) => fx(fc, you ? "argues_when_picked" : "argues_when_other_picked", `you/arg:${code}`, S, "answers that pick", () => code);
  const untaught = winners.slice(0, 2);
  const when = local || inp.pooled ? "when it picks you" : "when it picks you, across all buyers";
  const opener = inp.pooled ? "When buyers ask" : `When the buyer in "${inp.label}" asks`;
  const gapSpans = untaught.map((w, i) => F(i === 0 ? upperFirst(cname(w.key, h)) : cname(w.key, h), pickNum(w.key, true)));
  const claim = join(
    `${opener} what to look for in ${article(h.noun)} ${h.noun}, the AI teaches `,
    listNameSpans(top5.slice(0, 3).map((c) => F(cname(c, h), taughtNum(c)))),
    ".",
    untaught.length
      ? join(" ", listNameSpans(gapSpans), untaught.length > 1 ? `, which come up most ${when}, are seldom on its list.` : `, which comes up most ${when}, is seldom on its list.`)
      : noRead
        ? " It picks you for this buyer too seldom to say what wins here."
        : top5.length
          ? ` Everything that comes up most ${when} is on its list.`
          : ""
  );
  const steps: PanelStep[] = [
    {
      key: "taught",
      label: "What it tells buyers to look at",
      items: top5.slice(0, 4).map((c) => ({ label: clabel(c, h), num: taughtNum(c) })),
      itemsSelection: cl.id,
      help: `${CRITERIA_HELP.checklist} ${CRITERIA_HELP.taught}`,
      ...(untaught.length
        ? {
            note: join(
              listNameSpans(gapSpans),
              untaught.length > 1 ? ` come up most ${when}. ` : ` comes up most ${when}, and it is `,
              ...(untaught.length > 1
                ? untaught.flatMap((w, i) => [i > 0 ? " and " : "", `${upperFirstIf(i === 0, cname(w.key, h))} is `, ...offSpan(taughtNum(w.key))])
                : offSpan(taughtNum(untaught[0].key))),
              "."
            ),
          }
        : {}),
    },
  ];
  const liftBy = new Map(lift.map((l) => [l.key, l]));
  const tableCodes = [...new Set([...winners.slice(0, 4).map((w) => w.key), ...top5.filter((c) => liftBy.has(c))])]
    .map((c) => ({ c, taught: taughtSet.has(c), lift: liftBy.get(c)?.lift ?? 0 }))
    .sort((a, b) => Number(a.taught) - Number(b.taught) || b.lift - a.lift || a.c.localeCompare(b.c))
    .slice(0, 6);
  const table: PanelTable | undefined =
    tableCodes.length && lift.length
      ? {
          title: "What the answer weighs, against the checklist",
          help: `${CRITERIA_HELP.checklist} ${CRITERIA_HELP.taught}`,
          sub: `How often each topic comes up in answers that pick you and in answers that pick another brand, and whether the AI teaches buyers to look for it. The when-picked figures come from the What to buy answers${local ? " of this buyer" : inp.pooled ? "" : " of all buyers"}, because these questions take no picks.`,
          columns: [`When it picks another ${h.noun}`, "When it picks you", "Taught in"],
          ...(top5.length ? { mark: { col: 2, ...checklistMark(taughtNum(top5[top5.length - 1]), top5.length) } } : {}),
          style: "compare",
          rows: tableCodes.map(({ c }) => ({ label: clabel(c, h), cells: [pickNum(c, false), pickNum(c, true), taughtNum(c)] })),
          ...(liftSel ? { selection: liftSel.id } : {}),
        }
      : undefined;
  const out: PositionPanel = {
    kind: "criteria",
    claim,
    stackLabel: "How the answer goes",
    steps,
    ...(table ? { table } : {}),
    // am76: the list itself, so the Brief names the same topics the card does (never drawn).
    checklist: top5,
  };
  CRIT_GAP.set(out, untaught.map((w) => w.key));
  return out;
}

/** What to look for's step explained, from facts: which buyers are taught each winning topic off the checklist (a 0%
 * row is the fact), which AI companies teach it (only when they differ), how long the AI's list is, which brands it
 * names while teaching. */
function factCriteriaStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  if (!p.detail) return;
  const { h } = ctx;
  const T9 = CRITERIA_STEP_TEXT;
  const fc = FACT_CARD.get(inp)!;
  const { sel, set } = fc.F;
  const scope = fc.scope;
  const gap = CRIT_GAP.get(p) ?? [];
  const sections: (PanelDetailSection | null)[] = [];
  let one: { topic: string; buyer: string } | undefined;
  const sits = inp.pooled ? sel.selection("situations", "ai", scope, { min: ARGS_MIN }) : null;
  const sitM = (sits?.members ?? []) as SelMember[];
  if (sitM.length >= 2)
    for (const code of gap) {
      const items = sitM.map((x) => ({ label: x.name, num: fx(fc, "argues", `ai/arg:${code}`, { ...scope, situation: x.key }, "answers for that buyer", () => code) }));
      const rate = (n: PanelNum) => {
        const kn = knOf(n)!;
        return kn.n ? kn.k / kn.n : 0;
      };
      const hi = items.filter((x) => rate(x.num) >= 0.5);
      const lo = items.filter((x) => rate(x.num) < 0.1);
      if (!one && hi.length === 1 && lo.length === items.length - 1) one = { topic: cname(code, h), buyer: hi[0].label };
      sections.push(selSec(secAll(T9.buyers.title(cname(code, h)), T9.buyers.sub, "good", items), sits!.id));
    }
  if (gap.length) {
    const code = gap[0];
    const vs = sel.selection("vendors", "ai", scope, { min: ARGS_MIN });
    const items = (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "argues", `ai/arg:${code}`, { ...scope, vendor: v.name }, `${v.name} answers`, () => code) }));
    const shares = items.map((x) => {
      const kn = knOf(x.num)!;
      return kn.n ? kn.k / kn.n : 0;
    });
    if (items.length >= 2 && Math.max(...shares) - Math.min(...shares) >= 0.15) sections.push(selSec(secAll(T9.vendor.title(cname(code, h)), T9.vendor.sub, "neutral", items), vs.id));
  }
  const vf = (r: PoolRow) => verdictFind(r, h);
  const sizeItems = [
    { label: T9.size.few, num: fx(fc, "slice_share", "ai/slice:nargs:1-6", scope, "answers", vf) },
    { label: T9.size.mid, num: fx(fc, "slice_share", "ai/slice:nargs:7-12", scope, "answers", vf) },
    { label: T9.size.many, num: fx(fc, "slice_share", "ai/slice:nargs:13-999", scope, "answers", vf) },
  ].filter((x) => knOf(x.num)!.k >= ROW_MIN);
  sections.push(secAll(T9.size.title, T9.size.sub, "neutral", sizeItems, true));
  const nb = sel.selection("named_brands", "you", scope, { youFirst: true, floor: ROW_MIN, top: 5 });
  const T = set.target.key;
  if (nb.members.length) sections.push(selSec(secAll(T9.brands.title, T9.brands.sub, "neutral", (nb.members as SelMember[]).map((x) => ({ label: x.key === T ? "You" : x.name, num: fx(fc, "named", subj(fc, x.key), scope, "answers", () => (x.key === T ? h.brand : x.name)) })), true), nb.id));
  const kept = sections.filter((x): x is PanelDetailSection => !!x);
  if (!kept.length) return;
  const text = one ? { heading: T9.oneBuyer.heading, body: join(T9.oneBuyer.body(upperFirst(one.topic), one.buyer)) } : p.detail;
  p.details = { taught: { ...text, sections: kept } };
  delete p.detail;
  delete p.detailComp;
}

/** The expansion card. */
function factExpansionPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const scope = factScope(inp, PF);
  const fc = mkFactCard(inp, ctx, scope, undefined, PF.sel.selection("vendors", "ai", scope, { min: ARGS_MIN }), []);
  const vf = (r: PoolRow) => verdictFind(r, h);
  const segs = [
    segFx(fc, "backs", "backs it", "you", "growth_backs", "ai", scope, "answers", vf),
    segFx(fc, "neutral", "neither backs nor discourages", "neutral", "growth_neutral", "ai", scope, "answers", vf),
    segFx(fc, "redirects", "points them elsewhere", "away", "growth_redirects", "ai", scope, "answers", vf),
  ];
  const claim = join(inp.asked ? `When a customer asks ${inp.asked}, the AI backs it in ` : `Asked by your customers about growing their use of ${h.brand}, the AI backs it in `, N(segs[0].num), " of answers and points them elsewhere in ", N(segs[2].num), ".");
  const conditions = factConditions(
    inp,
    fc,
    ctx,
    {
      title: "When the AI says go ahead, and when to hold back",
      sub: "The conditions the AI attaches. Each share is of all the answers to this question; an answer can state several.",
      towardTitle: "Go ahead if",
      awayTitle: "Hold back if",
      alsoToward: "Also said for holding back",
      alsoAway: "Also said for going ahead",
      toWord: "To",
    },
    { pickKind: false, pairs: false, namedProducts: true }
  );
  return {
    kind: "expansion",
    claim,
    stackLabel: "How the answer goes",
    steps: [{ key: "stance", label: "Does the answer back it?", segments: segs }],
    ...(conditions ? { conditions } : {}),
    lines: [],
  };
}

/** The expansion card's step explained, from facts: which of your products it backs growing into (the run's one
 * product grouping), which AI companies back it most, where it points customers instead (ruling 8). */
function factExpansionStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  if (!p.detail) return;
  const { h } = ctx;
  const T9 = EXPANSION_TEXT;
  const fc = FACT_CARD.get(inp)!;
  const { book, sel, set } = fc.F;
  const scope = fc.scope;
  const T = set.target.key;
  const BACKS = "v:growth_stance:backs";
  const RED = "v:growth_stance:redirects";
  const backs = book.fact("growth_backs", "ai", scope).k;
  const red = book.fact("growth_redirects", "ai", scope).k;
  const prods = ctx.ladder ? sel.selection("product_names", "you", { ...scope, when: BACKS }, { brand: T, top: 5 }) : null;
  const vs = sel.selection("vendors", "ai", scope, { min: ARGS_MIN });
  const dests = sel.selection("redirect_dests", "ai", scope, { slice: RED, top: 4 });
  const vf = (r: PoolRow) => verdictFind(r, h);
  const destSlice = (k: string) => (k.startsWith("~s:") ? `sentw:${k.slice(3)}` : `sent:${k}`);
  const sections = [
    backs >= ARGS_MIN && prods && prods.members.length
      ? selSec(secFew(T9.products.title(h.plural), T9.products.sub, "good", (prods.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:nameprod:${x.key}`, { ...scope, when: BACKS }, "answers that back it", () => x.name) })), T9.products.few), prods.id)
      : null,
    selSec(secPlain(T9.vendor.title, T9.vendor.sub, "neutral", (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "growth_backs", "ai", { ...scope, vendor: v.name }, `${v.name} answers`, vf) }))), vs.id),
    red >= ROW_MIN ? selSec(secFew(T9.where.title, T9.where.sub, "bad", (dests.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:${destSlice(x.key)}`, { ...scope, when: RED }, "answers that point elsewhere", () => x.name) })), T9.where.few), dests.id) : null,
  ].filter((x): x is PanelDetailSection => !!x);
  if (!sections.length) return;
  p.details = { stance: { ...p.detail, sections } };
  delete p.detail;
  delete p.detailComp;
}

/** The business case card. */
function factCasePanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { book, sel } = PF;
  const scope = factScope(inp, PF);
  const STRONG = "v:case_strength:strong";
  const HEDGED = "v:case_strength:hedged";
  const args = sel.selection("case_args", "ai", scope, { strong: STRONG, rest: HEDGED, minK: 0 });
  const fc = mkFactCard(inp, ctx, scope, undefined, args, []);
  const vf = (r: PoolRow) => verdictFind(r, h);
  const underK = book.fact("case_undermined", "ai", scope).k;
  const segs = [
    segFx(fc, "strong", "a confident case", "you", "case_strong", "ai", scope, "answers", vf),
    segFx(fc, "hedged", "a hedged case", "neutral", "case_hedged", "ai", scope, "answers", vf),
    ...(underK ? [segFx(fc, "undermined", "argues against you", "away", "case_undermined", "ai", scope, "answers", vf)] : []),
  ];
  const claim = join(
    `When a customer asks ${inp.asked ?? "how to win approval for you"}, the AI hands over a confident case in `,
    N(segs[0].num),
    " of answers and a hedged one in ",
    N(segs[1].num),
    underK ? join(", and argues against you in ", N(segs[2].num)) : "",
    "."
  );
  let table: PanelTable | undefined;
  const strongK = book.fact("case_strong", "ai", scope).k;
  if (strongK >= CASE_MIN && args.members.length) {
    const gapOn = !!args.extras.versus;
    table = {
      title: "What a confident case argues",
      sub: gapOn
        ? "The topics that set a confident case apart. Each share is of the confident cases. Topics the question itself names, and topics that come up about equally in both kinds of case, are left out."
        : "The topics a confident case argues. Each share is of the confident cases; too few hedged cases to set beside them.",
      columns: gapOn ? ["Confident cases", "Hedged cases"] : ["Confident cases"],
      style: "bars",
      rows: (args.members as SelMember[]).map((x) => {
        const hn = fx(fc, "argues", `ai/arg:${x.key}`, { ...scope, when: HEDGED }, "hedged cases", () => x.key);
        return {
          label: clabel(x.key, h),
          cells: [fx(fc, "argues", `ai/arg:${x.key}`, { ...scope, when: STRONG }, "confident cases", () => x.key), ...(gapOn ? [{ t: `${hn.value} in hedged cases`, ...(hn.refs ? { refs: hn.refs } : {}), tip: hn.tip, ...(hn.fact ? { fact: hn.fact } : {}) }] : [])],
        };
      }),
      selection: args.id,
    };
  }
  return {
    kind: "business_case",
    claim,
    stackLabel: "How the answer goes",
    steps: [{ key: "strength", label: "How strong a case does the AI give the customer?", segments: segs }],
    lines: [],
    ...(table ? { table } : {}),
  };
}

/** The business case card's step explained, from facts: which AI companies give a confident case most, which of your
 * products it is built on (the run's one product grouping), which rivals come up (brands in analysis - ruling 8). */
function factCaseStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  if (!p.detail) return;
  const { h } = ctx;
  const T9 = CASE_TEXT;
  const fc = FACT_CARD.get(inp)!;
  const { book, sel, set } = fc.F;
  const scope = fc.scope;
  const T = set.target.key;
  const STRONG = "v:case_strength:strong";
  const vf = (r: PoolRow) => verdictFind(r, h);
  const strongK = book.fact("case_strong", "ai", scope).k;
  const vs = sel.selection("vendors", "ai", scope, { min: ARGS_MIN });
  const prods = ctx.ladder && strongK >= ARGS_MIN ? sel.selection("product_names", "you", { ...scope, when: STRONG }, { brand: T, top: 5 }) : null;
  const rivals = sel.selection("named_brands", "you", scope, { floor: ROW_MIN, top: 5 });
  const sections = [
    selSec(secPlain(T9.vendor.title, T9.vendor.sub, "neutral", (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "case_strong", "ai", { ...scope, vendor: v.name }, `${v.name} answers`, vf) }))), vs.id),
    prods ? selSec(secPlain(T9.products.title(h.plural), T9.products.sub, "good", (prods.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:nameprod:${x.key}`, { ...scope, when: STRONG }, "answers that give a confident case", () => x.name) }))), prods.id) : null,
    selSec(secPlain(T9.rivals.title, T9.rivals.sub, "bad", (rivals.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "named", x.key, scope, "answers", () => x.name) }))), rivals.id),
  ].filter((x): x is PanelDetailSection => !!x);
  if (!sections.length) return;
  p.details = { strength: { ...p.detail, sections } };
  delete p.detail;
  delete p.detailComp;
}

/** Answering a critic. */
function factCriticPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { sel } = PF;
  const scope = factScope(inp, PF);
  const STRONG = "v:case_strength:strong";
  const REST = "!v:case_strength:strong";
  const args = sel.selection("case_args", "ai", scope, { strong: STRONG, rest: REST, minK: ROW_MIN, critic: true });
  const fc = mkFactCard(inp, ctx, scope, undefined, args, []);
  const all = fc.n;
  const pf = (r: PoolRow) => verdictFind(r, h);
  const pq = (r: PoolRow) => (r.code.premise_quote ?? "").trim() || pf(r);
  /** Segments of one verdict: those with 3+ answers drawn, the rest folded into a sentence. */
  const fold = (defs: { key: string; label: string; tone: PanelSegment["tone"]; num: PanelNum; phrase: string }[]) => {
    const kOf = (d: { num: PanelNum }) => knOf(d.num)!.k;
    const segs: PanelSegment[] = defs.filter((d) => kOf(d) >= ROW_MIN).map((d) => ({ key: d.key, label: d.label, tone: d.tone, num: d.num }));
    const small = defs.filter((d) => kOf(d) > 0 && kOf(d) < ROW_MIN);
    const none = defs.filter((d) => kOf(d) === 0 && segs.length > 0);
    const parts: (PanelText | string)[] = [];
    small.forEach((d, i) => {
      if (i > 0) parts.push(i === small.length - 1 ? ", and " : ", ");
      parts.push(join(F(i === 0 ? "In a few answers" : "in a few answers", d.num), ` it ${d.phrase}`));
    });
    if (small.length) parts.push(".");
    if (none.length) parts.push(`${small.length ? " " : ""}No answer ${listWords(none.map((d) => d.phrase), "or")}.`);
    return { segs, note: parts.length ? join(...parts) : undefined };
  };
  const strongN = fx(fc, "case_strong", "ai", scope, "answers", pf);
  const st = fold([
    { key: "strong", label: "a strong answer", tone: "you", num: strongN, phrase: "gives a strong answer" },
    { key: "partial", label: "a partial answer", tone: "neutral", num: fx(fc, "case_partial", "ai", scope, "answers", pf), phrase: "gives a partial answer" },
    { key: "concedes", label: "drops your side", tone: "away", num: fx(fc, "case_concedes", "ai", scope, "answers", pf), phrase: "drops the customer's side" },
  ]);
  const rebutN = fx(fc, "disagrees", "ai", scope, "answers that judge the criticism", pq);
  const mixedN = fx(fc, "partly_agrees", "ai", scope, "answers that judge the criticism", pq);
  const confN = fx(fc, "agrees", "ai", scope, "answers that judge the criticism", pq);
  const judged = knOf(confN)!.n;
  const pr = fold([
    { key: "rebuts", label: "the critic is wrong", tone: "you", num: rebutN, phrase: "says the critic is wrong" },
    { key: "mixed", label: "partly right", tone: "neutral", num: mixedN, phrase: "says the critic is partly right" },
    { key: "confirms", label: "the critic is right", tone: "away", num: confN, phrase: "says the critic is right" },
  ]);
  const seed = inp.criticism ? `how to answer the criticism "${inp.criticism}"` : "how to answer someone who doubts you";
  // am37: when the answers that judge the criticism mostly say the critic is right, the claim leads with that.
  const ck = knOf(confN)!.k;
  const criticRight = judged >= ROW_MIN && ck > Math.max(knOf(rebutN)!.k, knOf(mixedN)!.k);
  const claim = criticRight
    ? join(whenAsks(inp, "customer", seed), "the AI says the critic is right in ", N(confN), " of the answers that judge it, though it gives a strong answer in ", N(strongN), " of answers.")
    : join(
        whenAsks(inp, "customer", seed),
        "the AI gives a strong answer in ",
        knOf(strongN)!.k === all && all > 0 ? F("all of them", strongN) : join(N(strongN), " of answers"),
        judged ? join(" and says the critic is wrong in ", N(rebutN), " of the answers that judge it.") : "."
      );
  const steps: PanelStep[] = [{ key: "strength", label: "How strong an answer does the AI give the customer?", segments: st.segs, ...(st.note ? { note: st.note } : {}) }];
  if (judged) steps.push({ key: "premise", label: "Does it say the critic is right?", segments: pr.segs, ...(pr.note ? { note: pr.note } : {}) });
  const lines: PanelLine[] = [];
  const red = fx(fc, "slice_share", "ai/slice:sent:any", scope, "answers", (r) => (r.code.redirect_to ?? [])[0] ?? h.brand);
  if (knOf(red)!.k) lines.push({ label: `Also points to another ${h.noun}`, value: join(N(red), ` of answers also point to another ${h.noun}`) });
  let table: PanelTable | undefined;
  if (knOf(strongN)!.k >= CASE_MIN && args.members.length) {
    const gapOn = !!args.extras.versus;
    const left = (args.extras.folded ?? []).length > 0;
    table = {
      title: "What a strong answer argues",
      sub: gapOn
        ? `The topics that set a strong answer apart. Each share is of the strong answers.${left ? " Topics the question or the criticism already names are left out." : ""}`
        : `There are too few other answers to set them against, so these are the topics strong answers argue most. Each share is of the strong answers.${left ? " Topics the question or the criticism already names are left out." : ""}`,
      columns: gapOn ? ["Strong answers", "Other answers"] : ["Strong answers"],
      style: "bars",
      rows: (args.members as SelMember[]).map((x) => {
        const on = fx(fc, "argues", `ai/arg:${x.key}`, { ...scope, when: REST }, "other answers", () => x.key);
        return { label: clabel(x.key, h), cells: [fx(fc, "argues", `ai/arg:${x.key}`, { ...scope, when: STRONG }, "strong answers", () => x.key), ...(gapOn ? [{ t: `${on.value} in other answers`, ...(on.refs ? { refs: on.refs } : {}), tip: on.tip, ...(on.fact ? { fact: on.fact } : {}) }] : [])] };
      }),
      selection: args.id,
    };
  }
  return { kind: "critic", claim, stackLabel: "How the answer goes", steps, lines, ...(table ? { table } : {}) };
}

/** Answering a critic's two steps explained, from facts. */
function factCriticStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx, premiseTag: string) {
  if (!p.detail) return;
  const { h } = ctx;
  const T9 = CRITIC_TEXT;
  const fc = FACT_CARD.get(inp)!;
  const { book, sel } = fc.F;
  const scope = fc.scope;
  const vf = (r: PoolRow) => verdictFind(r, h);
  const quote = (r: PoolRow) => (r.code.premise_quote ?? "").trim() || vf(r);
  const CONF = "v:premise_verdict:confirms";
  const MIXED = "v:premise_verdict:mixed";
  const JUDGED = "v:premise_verdict:confirms,mixed,rebuts";
  const STRONG = "v:case_strength:strong";
  const vs = sel.selection("vendors", "ai", scope, { min: ARGS_MIN });
  const rivals = sel.selection("named_brands", "you", scope, { floor: ROW_MIN, top: 5 });
  const strength = (when: string, unit: string) => [
    { label: T9.strong, num: fx(fc, "slice_share", `ai/slice:${STRONG}`, { ...scope, when }, unit, vf) },
    { label: T9.partial, num: fx(fc, "slice_share", `ai/slice:!${STRONG}`, { ...scope, when }, unit, vf) },
  ];
  const strengthSections = [
    selSec(secPlain(T9.vendorStrong.title, T9.vendorStrong.sub, "neutral", (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "case_strong", "ai", { ...scope, vendor: v.name }, `${v.name} answers`, vf) }))), vs.id),
    selSec(secPlain(T9.rivals.title, T9.rivals.sub, "bad", (rivals.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "named", x.key, scope, "answers", () => x.name) }))), rivals.id),
  ].filter((x): x is PanelDetailSection => !!x);
  const details: Partial<Record<PanelStepKey, PanelStepDetail>> = { strength: { ...p.detail, ...(strengthSections.length ? { sections: strengthSections } : {}) } };
  if (p.steps.some((x) => x.key === "premise")) {
    const conf = book.fact("agrees", "ai", scope).k;
    const mixed = book.fact("partly_agrees", "ai", scope).k;
    const vj = sel.selection("vendors", "ai", { ...scope, when: JUDGED }, { min: ARGS_MIN });
    const premiseSections = [
      conf >= ARGS_MIN ? secPlain(T9.whenRight.title, T9.whenRight.sub, "neutral", strength(CONF, "answers that say the critic is right"), true) : null,
      mixed >= ARGS_MIN ? secPlain(T9.whenPartly.title, T9.whenPartly.sub, "neutral", strength(MIXED, "answers that say the critic is partly right"), true) : null,
      selSec(secPlain(T9.vendorRight.title, T9.vendorRight.sub, "bad", (vj.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "agrees", "ai", { ...scope, vendor: v.name }, `${v.name} answers that judge the criticism`, quote) }))), vj.id),
    ].filter((x): x is PanelDetailSection => !!x);
    const granted = conf + mixed;
    const grantedStrong = book.fact("case_strong", "ai", { ...scope, when: "v:premise_verdict:confirms,mixed" }).k;
    const after = granted < ARGS_MIN ? "few" : grantedStrong * 2 >= granted ? "strong" : "weak";
    details.premise = { ...criticPremiseDetail(premiseTag, after), ...(premiseSections.length ? { sections: premiseSections } : {}) };
  }
  p.details = details;
  delete p.detail;
  delete p.detailComp;
}

/** What to use alongside you. */
function factAlongsidePanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const { sel, set } = PF;
  const scope = factScope(inp, PF);
  const ps = sel.selection("pairings", "ai", scope, { floor: ROW_MIN, top: 6 });
  const fc = mkFactCard(inp, ctx, scope, undefined, ps, []);
  const all = fc.n;
  const pairFind = (key: string, name: string) => (r: PoolRow) => {
    const forms = key.startsWith("~w:") ? new Set(key.slice(3).split(",").map((x) => decodeURIComponent(x))) : null;
    const d = key.startsWith("d:") ? key.slice(2) : null;
    return (r.code.pairings ?? []).find((q) => (d ? set.resolve(q.name).key === d : forms!.has(q.name.trim())))?.name ?? name;
  };
  const items = (ps.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:pairin:${x.key}`, scope, "answers", pairFind(x.key, x.name)) }));
  const kNum = (rel: string) => fx(fc, "slice_share", `ai/slice:pairrel:${rel}`, scope, "answers", (r) => (r.code.pairings ?? []).find((q) => q.maker_relation === rel)?.name ?? h.brand);
  const own = kNum("own");
  const third = kNum("third_party");
  const sub = kNum("substitute");
  const part = (n: PanelNum, what: string) => (n.pct === 0 ? `none ${what}` : join(N(n), ` ${what}`));
  const note = join("Of these answers, ", part(third, "name another company's"), ", ", part(own, "name something of yours"), " and ", part(sub, "name one to use in place of yours"), ".");
  const top = items[0];
  const claim = join(
    whenAsks(inp, "customer", `what to use alongside you`),
    top ? join("the AI names ", F(top.label, top.num), " in ", knOf(top.num)!.k === all ? F("every answer", top.num) : join(N(top.num), " of answers"), ".") : `the AI names nothing alongside you often enough to list.`
  );
  const conditions = factConditions(
    inp,
    fc,
    ctx,
    {
      // am56: this card is not a pick between two sides - it is which product the AI names for which customer.
      title: "Which one it names, for which customer",
      sub: "What the customer wants, and what the AI names for it. Each share is of all the answers to this question; an answer can state several.",
      towardTitle: "One of yours, if the customer wants",
      awayTitle: "If the customer wants",
      alsoToward: "Also said for another company's",
      alsoAway: "Also said for yours",
      toWord: "Names",
    },
    { pickKind: false, pairs: false, toCards: true, ownSplit: true, namedProducts: true }
  );
  if (conditions) {
    conditions.neutralAway = true;
    // One list when nothing of yours is named: no empty "yours" column.
    if (!conditions.toward.length) delete conditions.towardNote;
  }
  const steps: PanelStep[] = [{ key: "alongside", label: "Which ones it names alongside you", items, itemsSelection: ps.id, note }];
  return { kind: "alongside", claim, stackLabel: "How the answer goes", steps, ...(conditions ? { conditions } : {}), lines: [] };
}

/** What to use alongside you's step explained, from facts: how many it names, which it names first (the same grouping
 * of pairings), which AI companies name your own. */
function factAlongsideStepDetails(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const st = p.steps.find((s) => s.key === "alongside");
  if (!p.detail || !st) return;
  const { h } = ctx;
  const T9 = ALONGSIDE_TEXT;
  const fc = FACT_CARD.get(inp)!;
  const { book, sel } = fc.F;
  const scope = fc.scope;
  const ANY = "npair:1-999";
  const first = (r: PoolRow) => (r.code.pairings ?? []).find((x) => (x.name ?? "").trim())?.name ?? h.brand;
  const anyK = book.fact("slice_share", `ai/slice:${ANY}`, scope).k;
  const ownK = book.fact("slice_share", "ai/slice:pairrel:own", scope).k;
  const fp = sel.selection("first_pairing", "ai", scope, { top: 4 });
  const vs = sel.selection("vendors", "ai", scope, { min: ARGS_MIN });
  const sections = [
    secPlain(T9.size.title, T9.size.sub, "neutral", [
      { label: T9.size.one, num: fx(fc, "slice_share", "ai/slice:npair:1-1", scope, "answers", first) },
      { label: T9.size.some, num: fx(fc, "slice_share", "ai/slice:npair:2-3", scope, "answers", first) },
      { label: T9.size.many, num: fx(fc, "slice_share", "ai/slice:npair:4-999", scope, "answers", first) },
    ], true),
    anyK >= ARGS_MIN ? selSec(secPlain(T9.first.title, T9.first.sub, "neutral", (fp.members as SelMember[]).map((x) => ({ label: x.name, num: fx(fc, "slice_share", `ai/slice:firstpair:${x.key}`, { ...scope, when: ANY }, "answers that name one", () => x.name) }))), fp.id) : null,
    ownK >= ARGS_MIN ? selSec(secPlain(T9.vendor.title, T9.vendor.sub, "good", (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "slice_share", "ai/slice:pairrel:own", { ...scope, vendor: v.name }, `${v.name} answers`, (r) => (r.code.pairings ?? []).find((x) => x.maker_relation === "own")?.name ?? verdictFind(r, h)) }))), vs.id) : null,
  ].filter((x): x is PanelDetailSection => !!x);
  if (!sections.length) return;
  p.details = { alongside: { ...p.detail, sections } };
  delete p.detail;
  delete p.detailComp;
}

/** The settled customers' All questions card - an index to the four questions under it. */
function factSettledAllPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const PF = h.facts!;
  const T9 = SETTLED_ALL_TEXT;
  const scope = factScope(inp, PF);
  const fc = mkFactCard(inp, ctx, scope, undefined, PF.sel.selection("question_types", "ai", scope, { min: ARGS_MIN }), []);
  const vf = (r: PoolRow) => verdictFind(r, h);
  const segs = [
    segFx(fc, "strengthens", T9.strengthens, "you", "relationship_strengthens", "ai", scope, "answers", vf),
    segFx(fc, "steady", T9.neutral, "neutral", "relationship_neutral", "ai", scope, "answers", vf),
    segFx(fc, "weakens", T9.weakens, "away", "relationship_weakens", "ai", scope, "answers", vf),
  ];
  const sk = knOf(segs[0].num)!.k;
  const wk = knOf(segs[2].num)!.k;
  return {
    kind: "settled_all",
    claim: settledAllClaim(segs[0].num, segs[2].num, fc.n > 0 && sk === fc.n, sk === 0, wk === 0),
    stackLabel: "How the answer goes",
    steps: [{ key: "relationship", label: T9.stepLabel, segments: segs }],
    lines: [],
  };
}

/** The settled index's step: its takeaway and its explanation (it starts selected), from facts. */
function factSettledAllFinish(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const { h } = ctx;
  const T9 = SETTLED_ALL_TEXT;
  const s = p.steps.find((x) => x.key === "relationship");
  if (!s?.segments) return;
  const t = relationshipTakeaway(segPct(s, "strengthens"), segPct(s, "steady"), segPct(s, "weakens"));
  s.tagUsual = t.tag;
  s.tagUsualTone = t.tone;
  s.tagRank = t.tag;
  s.tagRankTone = t.tone;
  const fc = FACT_CARD.get(inp)!;
  const { book, sel } = fc.F;
  const scope = fc.scope;
  const vf = (r: PoolRow) => verdictFind(r, h);
  const rate = (n: PanelNum) => {
    const kn = knOf(n)!;
    return kn.n ? kn.k / kn.n : 0;
  };
  // The four questions' own cards (each with 10+ answers): the question_types selection, each type's card on the Map.
  const qt = sel.selection("question_types", "ai", scope, { min: ARGS_MIN });
  const cards = settledCards(inp, ctx);
  const kids = (qt.members as SelMember[])
    .map((m) => {
      const c = cards.get(m.key);
      if (!c) return null;
      const sc: Scope = { types: [m.key as QuestionType] };
      return { c, sc, str: fx(fc, "relationship_strengthens", "ai", sc, "answers", vf), weak: fx(fc, "relationship_weakens", "ai", sc, "answers", vf) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => rate(a.str) - rate(b.str) || a.c.label.localeCompare(b.c.label));
  // The weakest questions: those within 10 points of the lowest strengthens share, named only when they stand apart.
  const lowRate = kids.length ? rate(kids[0].str) : 0;
  const low = kids.filter((k) => rate(k.str) - lowRate < GAP_MIN);
  const weakest = kids.length >= 2 && low.length < kids.length ? low.map((k) => k.c.label) : undefined;
  const sections: PanelDetailSection[] = [];
  // 0% rows stay (a question that never strengthens it is the fact); every row rests on a question of 10+ answers.
  if (kids.length) sections.push({ title: T9.byQuestion.title, sub: T9.byQuestion.sub, tone: "good", rows: kids.map((k) => ({ label: k.c.label, num: k.str, cell: k.c.id })), selection: qt.id });
  const vs = sel.selection("vendors", "ai", scope, { min: ARGS_MIN });
  const vend = (vs.members as SelMember[]).map((v) => ({ label: v.name, num: fx(fc, "relationship_strengthens", "ai", { ...scope, vendor: v.name }, `${v.name} answers`, vf) })).sort((a, b) => rate(a.num) - rate(b.num) || a.label.localeCompare(b.label));
  // Only when the companies differ by 15 points or more (the What to look for rule).
  if (vend.length >= 2 && rate(vend[vend.length - 1].num) - rate(vend[0].num) >= 0.15) sections.push({ title: T9.vendor.title, sub: T9.vendor.sub, tone: "good", rows: vend, selection: vs.id });
  if (book.fact("relationship_weakens", "ai", scope).k >= ROW_MIN && kids.length)
    sections.push({ title: T9.weak.title, sub: T9.weak.sub, tone: "bad", rows: [...kids].sort((a, b) => rate(b.weak) - rate(a.weak) || a.c.label.localeCompare(b.c.label)).map((k) => ({ label: k.c.label, num: k.weak, cell: k.c.id })), selection: qt.id });
  p.details = { relationship: { ...settledAllDetail(t.tag, weakest), ...(sections.length ? { sections } : {}) } };
  p.focus = "relationship";
}

/** The settled questions' own Map cards by question type. */
function settledCards(inp: PanelCellInput, ctx: Ctx): Map<string, PanelCellInput> {
  const out = new Map<string, PanelCellInput>();
  const F = ctx.h.facts!;
  for (const x of ctx.inputs.values()) {
    if (x.id === inp.id || x.pooled || !x.id.startsWith("settled:settled:")) continue;
    const f0 = F.set.facts.find((f) => f.responseId === x.rows[0]?.code.response_id);
    if (f0) out.set(f0.type, x);
  }
  return out;
}

/** The smaller rival card inside What's popular, Premium vs basic and Habit, from facts: named, and named the card's
 * way (recommended - ruling 6 - or suggested instead). */
function factRivalSmall(
  inp: PanelCellInput,
  fc: FactCard,
  ctx: Ctx,
  m: SelMember,
  altLabel: string,
  o: {
    when?: string;
    alt?: string;
    measure?: "recommended";
    /** The step's number as a named measure on the rival (the doubt cards: "sent_to", "named_instead") - the same
     * answers as the `alt` slice. */
    altMeasure?: string;
    /** Your own number on that step (Value: the answers that say you are worth it), its examples' highlight. */
    youAlt?: { m: string; find: (r: PoolRow) => string };
    /** No "What the answer weighs" block (Spotting the problem: its answers carry topics, never arguments for a side). */
    noWeighs?: boolean;
  }
): PanelRival {
  const { h } = ctx;
  const { sel, set } = fc.F;
  const scope = fc.scope;
  const T = set.target.key;
  const R = m.name;
  const key = m.key;
  const alt = o.alt ?? `rec:${key}`;
  const surf = (k: string, rec: boolean, name: string) => (r: PoolRow) => surfOf(r, k, h, rec) ?? r.code.top_pick ?? name;
  const problem = o.measure === "recommended";
  const named = fx(fc, "named", key, scope, "answers", o.altMeasure ? (r: PoolRow) => surfOf(r, key, h, false) ?? R : surf(key, false, R));
  // The doubt cards' highlight: the rival as the answer names it, else as a destination names it.
  const destFind = (r: PoolRow) => (r.code.mentions ?? []).find((x) => h.resolve(x.brand).key === key)?.brand ?? (r.code.destinations ?? []).find((d) => h.resolve(d).key === key) ?? R;
  const altNum = problem
    ? fx(fc, "recommended", key, scope, "answers", surf(key, true, R))
    : o.altMeasure
      ? fx(fc, o.altMeasure, key, scope, "answers", destFind)
      : fx(fc, "slice_share", `ai/slice:${alt}`, scope, "answers", surf(key, true, R));
  const altK = knOf(altNum)!.k;
  const yNamed = problem ? fx(fc, "named", "you", scope, "answers", surf(T, false, h.brand)) : undefined;
  const yAlt = problem ? fx(fc, "recommended", "you", scope, "answers", surf(T, true, h.brand)) : o.youAlt ? fx(fc, o.youAlt.m, "ai", scope, "answers", o.youAlt.find) : undefined;
  const claim = problem ? join(`The AI recommends ${R} in `, N(altNum), " of these answers.") : join(`The AI names ${R} ${o.youAlt ? o.when : "as the alternative"} in `, N(altNum), " of these answers.");
  const steps: PanelStep[] = [
    yNamed ? { key: "named", label: "Named", here: yNamed, rivals: [{ name: R, num: named }], tagRank: duelTag(knOf(yNamed)!, knOf(named)!, R).tag } : { key: "named", label: "Named", rivals: [{ name: R, num: named }] },
    { key: "recommended", label: altLabel, ...(yAlt ? { here: yAlt, tagRank: duelTag(knOf(yAlt)!, knOf(altNum)!, R).tag } : {}), rivals: [{ name: R, num: altNum }] },
  ];
  // Which of its products it names (the run's one product grouping): per answer, its first written form.
  const lines: PanelLine[] = [];
  if (altK >= 5 && set.ladder) {
    const at: Scope = { ...scope, when: problem ? `rec:${key}` : alt };
    const ps = sel.selection("product_first", "you", at, { brand: key, top: 2 });
    const items = (ps.members as SelMember[]).map((x) => ({ name: x.key === "~none" ? noneName(ctx) : x.name, num: fx(fc, "slice_share", `ai/slice:firstprod:${key}:${x.key === "~none" ? "none" : x.key}`, at, "answers naming it", () => x.name) }));
    if (namesAProduct(items)) lines.push({ label: `Which of its ${h.plural} it names`, value: splitLine(items), selection: ps.id });
  }
  const side = problem ? `rec:${key}` : alt;
  const weighs = o.noWeighs
    ? undefined
    : o.when
    ? factWeighs(inp, fc, ctx, [
        { title: `When it names ${R} ${o.when}`, say: `name ${R}`, tone: "bad", slice: side },
        { title: "When it does not", say: "leave it out", tone: "neutral", slice: `!${side}` },
      ], WEIGHS_SUB_NAMING)
    : factWeighs(inp, fc, ctx, [{ say: "name it", tone: "neutral", slice: side }], WEIGHS_SUB_NAMING);
  return {
    name: R,
    full: false,
    claim,
    steps,
    lines,
    ...(weighs ? { weighs } : {}),
    ...(altK < 5 ? { thin: THIN_RIVAL(R, "more than its numbers") } : {}),
  };
}

/* ------------------------------ tags and details ------------------------------ */

const FUNNEL_KINDS = new Set<PanelKind>(["buy", "switching", "problem"]);
const VERDICT_STEP: Partial<Record<PanelKind, PanelStepKey>> = {
  buyer_worry: "verdict",
  customer_worry: "verdict",
  looking_around: "verdict",
  value: "worth",
  expansion: "stance",
  business_case: "strength",
  critic: "strength",
  h2h: "won",
  habit: "habit",
};
/** The segment a verdict step compares with the usual, and its noun. */
const SEG_CMP: Partial<Record<PanelKind, Partial<Record<PanelStepKey, [string, string, boolean]>>>> = {
  buyer_worry: { verdict: ["proceed", "go-aheads", true] },
  customer_worry: { verdict: ["leave", "leave answers", false] },
  value: { worth: ["yes", "worth-it answers", true], instead: ["rival", "answers pointing to rivals", false] },
};

function finishPanel(inp: PanelCellInput, p: PositionPanel, up: PositionPanel | undefined, u: PanelCellInput | undefined, ctx: Ctx) {
  const thin = (FACT_CARD.get(inp)?.n ?? inp.rows.length) < PANEL_MIN;
  if (thin) p.thin = THIN;
  const canTag = !thin && !!up && !!u && u.rows.length >= PANEL_MIN;
  const usualStep = (k: PanelStepKey) => up?.steps.find((s) => s.key === k);
  const cmp: { key: PanelStepKey; here: KN; usual: KN }[] = [];
  if (canTag) {
    for (const s of p.steps) {
      const us = usualStep(s.key);
      if (!us) continue;
      if (s.here && us.here) {
        const a = knOf(s.here)!;
        const b = knOf(us.here)!;
        if (s.key === "decided") {
          // How often the AI decides at all is a neutral fact, not good or bad for you.
          s.tagUsual = neutralUsualTag(a, b, "decided");
          s.tagUsualTone = "neutral";
          continue;
        }
        s.tagUsual = usualTag(a, b);
        s.tagUsualTone = usualTone(a, b);
        cmp.push({ key: s.key, here: a, usual: b });
      } else if (s.segments && us.segments) {
        const pair = SEG_CMP[p.kind]?.[s.key];
        if (!pair) continue;
        const a = s.segments.find((x) => x.key === pair[0]);
        const b = us.segments.find((x) => x.key === pair[0]);
        if (a && b) {
          s.tagUsual = segTag(knOf(a.num)!, knOf(b.num)!, pair[1]);
          s.tagUsualTone = usualTone(knOf(a.num)!, knOf(b.num)!, pair[2]);
        }
      }
    }
  }
  // Popular / learning: each step against another question type's all-buyers row (the step's inline `usual`).
  const OTHER: Partial<Record<PanelKind, [string, "about" | "close"]>> = { popular: ["chooses:open:all", "about"], premium: ["chooses:open:all", "about"], learning: ["chooses:awareness:all", "close"] };
  const other = OTHER[p.kind];
  if (other && !thin) {
    const o = ctx.inputs.get(other[0]);
    const name = (p.kind === "learning" ? ROW_NAME.awareness : ROW_NAME.open).toLowerCase();
    const FAV = new Set<PanelStepKey>(["named", "recommended", "namedwhen"]);
    const cmpO: { key: PanelStepKey; here: KN; usual: KN }[] = [];
    if (o && o.rows.length >= PANEL_MIN)
      for (const s of p.steps) {
        if (!s.here || !s.usual) continue;
        const a = knOf(s.here)!;
        const b = knOf(s.usual)!;
        s.tagUsual = otherTag(a, b, name, other[1]);
        s.tagUsualTone = FAV.has(s.key) ? usualTone(a, b) : "neutral";
        if (FAV.has(s.key)) cmpO.push({ key: s.key, here: a, usual: b });
      }
    const f = focusOf(cmpO);
    if (f) p.focus = f.key;
  }
  if (!thin) {
    if (FUNNEL_KINDS.has(p.kind) && canTag) {
      const f = focusOf(cmp);
      if (f) {
        p.focus = f.key;
        if (f.below) {
          const s = p.steps.find((x) => x.key === f.key);
          if (s) {
            s.tagUsual = TAG_FURTHEST;
            s.tagUsualTone = "bad";
          }
        }
      }
    } else if (VERDICT_STEP[p.kind] && p.steps.some((s) => s.key === VERDICT_STEP[p.kind])) p.focus = VERDICT_STEP[p.kind];
  // am35: every panel whose steps carry competitor numbers sets you against the
  // listed competitors taken together with the switch off (the same brands as
  // the bars with the switch on, in THIS cell): their numerators over their
  // denominators, added up. The here-against-your-usual bars and tags are not
  // drawn on these panels; a step with no competitor numbers (any brand, the
  // category) keeps the comparison it had, named on the step itself.
  if (p.kind !== "h2h" && p.compare && p.competitorOrder?.length && p.steps.some((s) => !!s.here && !!s.rivals?.length)) {
    const oldUsualKey = p.usualKey;
    p.avgComp = true;
    p.hereKey = "You";
    p.usualKey = AVG_COMP;
    const cmpA: { key: PanelStepKey; here: KN; usual: KN }[] = [];
    for (const s of p.steps) {
      if (!s.here) continue;
      if (!s.rivals?.length) {
        // A step not about you alone (the answer is about the category at all, names any brand).
        // am37: a rate of every answer, not of you, is never labelled "You".
        if (s.key === "category" || s.key === "commits" || s.key === "anybrand") s.hereLabel = "All answers";
        if (oldUsualKey && !s.usualLabel) s.usualLabel = oldUsualKey;
        if (s.tagUsual && (/your usual$/i.test(s.tagUsual) || s.tagUsual === TAG_FURTHEST || /^None/.test(s.tagUsual))) {
          delete s.tagUsual;
          delete s.tagUsualTone;
        }
        continue;
      }
      const pre = FACT_CARD.get(inp)?.avg[s.key];
      if (pre) s.usual = pre;
      else {
      const ks = s.rivals.map((r) => knOf(r.num)!);
      const k = ks.reduce((a, x) => a + x.k, 0);
      const n = ks.reduce((a, x) => a + x.n, 0);
      const unit = (s.rivals[0].num.tip.replace(/^\d+ of \d+ /, "") || "answers") + ", the competitors shown added up";
      // Example answers spread across the competitors: one from each in turn.
      const refs: AnswerRef[] = [];
      const seen = new Set<string>();
      for (let i = 0; refs.length < PANEL_REFS && i < PANEL_REFS; i++)
        for (const r of s.rivals) {
          const x = r.num.refs?.[i];
          if (x && !seen.has(x.responseId) && refs.length < PANEL_REFS) {
            seen.add(x.responseId);
            refs.push(x);
          }
        }
      s.usual = num(k, n, unit, refs);
      }
      s.usualLabel = AVG_COMP;
      delete s.tagUsual;
      delete s.tagUsualTone;
      if (thin) continue;
      const a = knOf(s.here)!;
      const b = knOf(s.usual)!;
      s.tagUsual = avgTag(a, b);
      s.tagUsualTone = usualTone(a, b);
      cmpA.push({ key: s.key, here: a, usual: b });
    }
    delete p.focus;
    if (!thin) {
      const f = focusOf(cmpA);
      if (f) p.focus = f.key;
    }
  }
  // Head-to-heads: the rival beside you on the step that says who it picks.
  for (const s of p.steps)
    if (s.vs && s.here && !thin) {
      // "Your named rivals" read mid-tag in lower case and take a plural verb.
      const pooledVs = /rivals$/.test(s.vs.name);
      const d = duelTag(knOf(s.here)!, knOf(s.vs.num)!, pooledVs ? s.vs.name.charAt(0).toLowerCase() + s.vs.name.slice(1) : s.vs.name);
      s.tagUsual = upperFirst(pooledVs ? d.tag.replace(/ leads$/, " lead") : d.tag);
      s.tagUsualTone = duelTone(d.tag, d.rivalLeads);
    }
    // Comparison view: rank among the competitors.
    let worst: { key: PanelStepKey; gap: number } | null = null;
    for (const s of p.steps) {
      if (!s.here || !s.rivals?.length || s.tagRank) continue;
      const r = rankTag(knOf(s.here)!, s.rivals.map((x) => knOf(x.num)!));
      s.tagRank = r.tag;
      // am37: "furthest behind" only when you are behind by a meaningful margin.
      if (r.gap >= CLOSE_PTS && (!worst || r.gap > worst.gap)) worst = { key: s.key, gap: r.gap };
    }
    if (worst) {
      const s = p.steps.find((x) => x.key === worst!.key)!;
      s.tagRank = `${s.tagRank} · furthest behind`;
      p.focusComp = worst.key;
    }
    verdictTakeaways(inp, p);
    // am37: a head-to-head's "picks one of the two" step always carries a plain tag (the all-rivals cell has no usual).
    for (const s of p.steps)
      if (s.key === "decided" && s.here && !s.tagUsual) {
        const t = s.here.pct >= 50 ? "Usually picks one of the two" : "Usually picks neither";
        s.tagUsual = t;
        s.tagUsualTone = "neutral";
      }
    for (const s of p.steps) if (s.key === "decided" && s.tagUsual && !s.tagRank) { s.tagRank = s.tagUsual; s.tagRankTone = s.tagUsualTone; }
    detailOf(inp, p, up, ctx);
    stepDetailsOf(inp, p, ctx);
    extremeFacts(inp, p, ctx);
    // am37: the highlighted step is one that explains itself (a step a reader can select has an explanation).
    if (p.details && p.focus && !p.details[p.focus]) p.focus = p.steps.find((s) => !!p.details![s.key])?.key;
    if (p.detailsComp && p.focusComp && !p.detailsComp[p.focusComp]) p.focusComp = p.steps.find((s) => !!p.detailsComp![s.key])?.key;
    if (p.kind === "premium") factPremiumFinish(inp, p, ctx);
    if (p.kind === "settled_all") factSettledAllFinish(inp, p, ctx);
  }
}

/** am37: you are behind on the picks in this cell (the pick kinds); "lose" and "gap" are said only then. */
function behindOf(inp: PanelCellInput): boolean {
  if (inp.kind !== "buy" && inp.kind !== "switching" && inp.kind !== "popular" && inp.kind !== "premium") return false;
  return !!FACT_CARD.get(inp)?.behind;
}

/** am37: a panel whose every bar is 0% or 100% says the plain fact in its heading and carries no comparison tags. */
function extremeFacts(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  const nums: PanelNum[] = [];
  for (const s of p.steps) {
    if (s.here) nums.push(s.here);
    for (const r of s.rivals ?? []) nums.push(r.num);
    if (s.vs) nums.push(s.vs.num);
    for (const g of s.segments ?? []) nums.push(g.num);
  }
  if (!nums.length || !nums.every((n) => n.pct === 0 || n.pct === 100)) return;
  for (const s of p.steps) {
    if (s.tagUsual && !TAKEAWAY_TAG_SET.has(s.tagUsual) && !/^Usually picks /.test(s.tagUsual)) {
      delete s.tagUsual;
      delete s.tagUsualTone;
    }
    if (s.tagRank && !TAKEAWAY_TAG_SET.has(s.tagRank) && !/^Usually picks /.test(s.tagRank)) {
      delete s.tagRank;
      delete s.tagRankTone;
    }
  }
  const v = p.steps.find((s) => s.segments?.length);
  const all100 = v?.segments?.find((g) => g.num.pct === 100);
  const noun = ctx.h.noun;
  let heading: string | undefined;
  if (all100) {
    const SAY: Record<string, string> = {
      keep: "Every answer tells the customer to stay",
      leave: "Every answer tells the customer to leave",
      none: p.kind === "buyer_worry" ? "Every answer leaves the decision to the buyer" : "Every answer leaves the decision to the customer",
      proceed: "Every answer tells the buyer to go ahead",
      avoid: "Every answer tells the buyer to steer clear",
      yes: "Every answer says it is worth paying more for",
      no: "Every answer says it is not worth paying more for",
      depends: "Every answer says it depends",
    };
    heading = SAY[all100.key];
    const offers = p.steps.find((s) => s.key === "offers")?.here;
    if (heading && offers?.pct === 100) heading += `, and shows another ${noun}`;
  }
  if (p.kind === "h2h") {
    const won = p.steps.find((s) => s.key === "won");
    if (won?.here) heading = won.here.pct === 100 ? "Every answer that picks one of the two picks you" : `Every answer that picks one of the two picks ${inp.pooled ? "the rival" : inp.rivalName ?? inp.label}`;
  }
  if (heading && p.detail) p.detail = { ...p.detail, heading };
  if (heading && p.detailComp) p.detailComp = { ...p.detailComp, heading };
  // am38: Value explains its verdict step itself.
  if (heading && v && p.details?.[v.key]) p.details = { ...p.details, [v.key]: { ...p.details[v.key]!, heading } };
}

/** am36: the verdict panels' steps carry a one-line takeaway read off this
 * cell's own numbers (panel_tags.ts, thresholds there), the same in both
 * views; the usual stays the small figure beside each bar. */
const TAKEAWAY_KINDS = new Set<PanelKind>(["value", "buyer_worry", "customer_worry", "looking_around", "expansion", "business_case", "critic", "alongside", "criteria", "habit"]);
const segPct = (s: PanelStep | undefined, key: string) => s?.segments?.find((x) => x.key === key)?.num.pct ?? 0;
/** A segment here against the same segment of the row's All cell, in words (absent without a usual). */
function segOften(s: PanelStep | undefined, us: PanelStep | undefined, key: string) {
  const a = s?.segments?.find((x) => x.key === key)?.num;
  const b = us?.segments?.find((x) => x.key === key)?.num;
  const ka = a ? knOf(a) : null;
  const kb = b ? knOf(b) : null;
  if (!ka || !kb || ka.n < PANEL_MIN || kb.n < PANEL_MIN) return undefined;
  return oftenOf(ka, kb);
}
/** The rival the panel's competitors block lists first (never your own row). */
const topRivalOf = (p: PositionPanel) => [...(p.competitors?.rows ?? [])].filter((r) => !r.you).sort((a, b) => b.num.pct - a.num.pct)[0]?.name;
/** A keep-or-leave step read as one side (keepTakeaway's rule). */
function keepSideOf(v: PanelStep): KeepSide {
  const t = keepTakeaway(segPct(v, "keep"), segPct(v, "leave"), segPct(v, "none")).tag;
  const SIDE: Record<string, KeepSide> = {
    "Tells customers to stay": "stay",
    "More told to stay than to leave": "stay",
    "Tells customers to leave": "leave",
    "More told to leave than to stay": "leave",
    "Mostly takes no side": "none",
    "Always takes no side": "none",
  };
  return SIDE[t] ?? "split";
}
function verdictTakeaways(inp: PanelCellInput, p: PositionPanel) {
  if (!TAKEAWAY_KINDS.has(p.kind)) return;
  const set = (s: PanelStep, t: Takeaway) => {
    s.tagUsual = t.tag;
    s.tagUsualTone = t.tone;
    s.tagRank = t.tag;
    s.tagRankTone = t.tone;
  };
  const agrees = p.steps.find((s) => s.key === "agrees")?.here?.pct ?? null;
  for (const s of p.steps) {
    let t: Takeaway | null = null;
    if (p.kind === "value" && s.key === "worth") t = worthTakeaway(segPct(s, "yes"), segPct(s, "depends"), segPct(s, "no"), !!inp.pooled);
    else if (p.kind === "value" && s.key === "instead") t = insteadTakeaway(segPct(s, "own"), segPct(s, "rival"), segPct(s, "nowhere"));
    else if (s.key === "agrees" && s.here) t = agreesTakeaway(s.here.pct);
    else if (p.kind === "buyer_worry" && s.key === "verdict") t = proceedTakeaway(segPct(s, "proceed"), segPct(s, "avoid"), segPct(s, "none"), agrees);
    else if ((p.kind === "customer_worry" || p.kind === "looking_around") && s.key === "verdict") t = keepTakeaway(segPct(s, "keep"), segPct(s, "leave"), segPct(s, "none"));
    else if (p.kind === "looking_around" && s.key === "offers" && s.here) t = offersTakeaway(s.here.pct);
    else if (p.kind === "habit" && s.key === "habit") t = habitTakeaway(segPct(s, "stick"), segPct(s, "other"), segPct(s, "depends"), segPct(s, "nopick"));
    else if (p.kind === "habit" && s.key === "offers" && s.here) t = suggestTakeaway(s.here.pct);
    else if (p.kind === "expansion" && s.key === "stance") t = stanceTakeaway(segPct(s, "backs"), segPct(s, "neutral"), segPct(s, "redirects"));
    else if (p.kind === "business_case" && s.key === "strength") t = caseTakeaway(segPct(s, "strong"), segPct(s, "hedged"), segPct(s, "undermined"));
    else if (p.kind === "critic" && s.key === "strength") t = criticStrengthTakeaway(segPct(s, "strong"), segPct(s, "partial"), segPct(s, "concedes"));
    else if (p.kind === "critic" && s.key === "premise") t = premiseTakeaway(segPct(s, "rebuts"), segPct(s, "mixed"), segPct(s, "confirms"));
    else if (p.kind === "alongside" && s.key === "alongside") {
      const fc = FACT_CARD.get(inp)!;
      const rel = (x: string) => {
        const f = fc.F.book.fact("slice_share", `ai/slice:pairrel:${x}`, fc.scope);
        return (100 * f.k) / (f.n || 1);
      };
      t = alongsideTakeaway(rel("own"), rel("third_party"), rel("substitute"));
    } else if (p.kind === "criteria" && s.key === "taught") t = taughtTakeaway(!!s.note?.length);
    else if (p.kind === "criteria" && s.key === "gap") t = GAP_TAKEAWAY;
    if (t) set(s, t);
    else {
      delete s.tagUsual;
      delete s.tagUsualTone;
      delete s.tagRank;
      delete s.tagRankTone;
    }
  }
}

function detailOf(inp: PanelCellInput, p: PositionPanel, up: PositionPanel | undefined, ctx: Ctx) {
  const { h } = ctx;
  const stepPair = (k: PanelStepKey) => {
    const s = p.steps.find((x) => x.key === k);
    const u = up?.steps.find((x) => x.key === k);
    return s?.here && u?.here ? { here: s.here, usual: u.here } : undefined;
  };
  if (FUNNEL_KINDS.has(p.kind)) {
    // am37: a panel set against the average competitor draws no usual, so it carries no usual-comparison default
    // explanation (its steps explain themselves); one that still draws the usual reads its direction off the
    // same closeness rule as its tags, in words.
    if (up && !p.avgComp) {
      const who = p.kind === "switching" ? { here: "with these customers", usual: "across all rivals' customers" } : { here: "with this buyer", usual: "across all buyers" };
      const pr = p.focus ? stepPair(p.focus) : undefined;
      const f = p.focus && pr ? { key: p.focus, dir: usualDir(knOf(pr.here)!, knOf(pr.usual)!) } : null;
      p.detail = funnelDetail(f, who, behindOf(inp));
    }
    const fs = p.focusComp ? p.steps.find((s) => s.key === p.focusComp) : undefined;
    const d = rankDetail(p.focusComp ?? null, fs && fs.here && fs.rivals ? { label: fs.label, here: fs.here, rivals: fs.rivals } : null);
    if (d) p.detailComp = d;
    return;
  }
  const det = (heading: string, body: PanelText): PanelDetail => ({ heading, body });
  if (p.kind === "popular" || p.kind === "premium" || p.kind === "learning") {
    const fs = p.focusComp ? p.steps.find((x) => x.key === p.focusComp) : undefined;
    const d = rankDetail(p.focusComp ?? null, fs && fs.here && fs.rivals ? { label: fs.label, here: fs.here, rivals: fs.rivals } : null);
    if (d) p.detailComp = d;
  }
  // A panel set against the average competitor explains itself step by step (details).
  if (p.avgComp && (p.kind === "popular" || p.kind === "premium" || p.kind === "learning")) return;
  switch (p.kind) {
    case "popular":
    case "premium": {
      const rec = p.steps.find((x) => x.key === "recommended");
      const com = p.steps.find((x) => x.key === "commits");
      const what = ROW_NAME.open.toLowerCase();
      if (!rec?.here || !rec.usual || !com?.here || !com.usual) return;
      const rk = knOf(rec.here)!;
      const ru = knOf(rec.usual)!;
      const ck = knOf(com.here)!;
      const cu = knOf(com.usual)!;
      const rate = (x: KN) => (x.n ? x.k / x.n : 0);
      const rd = usualDir(rk, ru);
      const rDir = rd < 0 ? "less" : rd > 0 ? "more" : "about as";
      const listy = rate(cu) > 0 && rate(ck) / rate(cu) <= 0.6;
      const heading = listy
        ? `The AI answers this with a list, and rarely names one ${h.noun} as the pick`
        : rDir === "about as"
          ? `You are recommended about as often here as when buyers ask ${what}`
          : `You are recommended ${rDir} often here than when buyers ask ${what}`;
      // am37: the explanation says what the bars mean, never their numbers again.
      const cd = usualDir(ck, cu);
      p.detail = det(
        heading,
        join(`The AI names one ${h.noun} as the pick ${cd < 0 ? "less" : cd > 0 ? "more" : "about as"} often here ${cd === 0 ? "as" : "than"} when buyers ask ${what}, so ${listy ? "being recommended matters more than being picked" : "a recommendation here can still end as the pick"}.`)
      );
      return;
    }
    case "learning": {
      const any = p.steps.find((x) => x.key === "anybrand");
      const nw = p.steps.find((x) => x.key === "namedwhen");
      if (!any?.here || !nw?.here) return;
      const fewBrands = any.here.pct < 50;
      const reaches = nw.here.pct >= 50;
      const heading = `The AI explains the category ${fewBrands ? "mostly without brands" : "with brands"}, and ${reaches ? "reaches for you when it uses one" : "rarely reaches for you when it does"}`;
      p.detail = det(heading, join(fewBrands ? "A buyer who learns the category here mostly hears no brand at all, so the answers that do name one carry the weight." : "A buyer who learns the category here hears brands along the way, so being among them is the first step."));
      return;
    }
    case "alongside": {
      const fc = FACT_CARD.get(inp)!;
      const str = fc.F.book.fact("relationship_strengthens", "ai", fc.scope).k;
      const weak = fc.F.book.fact("relationship_weakens", "ai", fc.scope).k;
      const heading = weak === 0 ? "The AI builds on what the customer already has with you" : weak > str ? "The AI more often works against what the customer has with you" : "The AI mostly builds on what the customer has with you";
      p.detail = alongsideDetail(heading);
      factAlongsideStepDetails(inp, p, ctx);
      return;
    }
    case "critic": {
      const sg = p.steps.find((x) => x.key === "strength");
      const pm = p.steps.find((x) => x.key === "premise");
      const strong = segPct(sg, "strong");
      const rebuts = segPct(pm, "rebuts");
      const confirms = segPct(pm, "confirms");
      const mixed = segPct(pm, "mixed");
      // am37: the heading reads both bars - how strong the answer is AND whether it grants the criticism.
      const heading =
        confirms > Math.max(rebuts, mixed) && confirms > 0
          ? "Most answers that judge it say the critic is right"
          : strong >= 50
            ? rebuts >= 50
              ? "The AI arms the customer against the critic"
              : "The AI gives a strong answer, and grants part of the criticism"
            : "The AI gives the customer only part of a defense";
      const red = !!p.lines?.some((l) => l.label.startsWith("Also points to"));
      p.detail = criticDetail(heading, red, h.noun);
      factCriticStepDetails(inp, p, ctx, premiseTakeaway(rebuts, mixed, confirms).tag);
      return;
    }
    case "h2h": {
      const won = p.steps.find((s) => s.key === "won");
      const decided = p.steps.find((s) => s.key === "decided");
      const R = inp.pooled ? "your named rivals" : inp.rivalName ?? inp.label;
      if (!won?.here && !(inp.exception && decided?.here && won?.vs)) return;
      const w = won?.here?.pct ?? 50;
      const side = w >= 60 ? "you" : w <= 40 ? "rival" : "close";
      const topRival = inp.pooled ? [...(won?.rivals ?? [])].sort((a, b) => b.num.pct - a.num.pct)[0]?.name : undefined;
      p.detail = h2hDetail({
        exception: !!(inp.exception && decided?.here && won?.vs),
        ...(inp.exception?.lostRate !== undefined ? { exceptionShare: inp.exception.lostRate } : {}),
        rival: R,
        pooled: !!inp.pooled,
        side,
        always: (w >= 99.95 || (won?.here?.pct ?? 1) === 0) && !!won?.here,
        rivalCond: p.conditions?.away[0]?.text,
        youCond: p.conditions?.toward[0]?.text,
        ...(topRival && topRival !== "Your named rivals" ? { topRival } : {}),
      });
      return;
    }
    case "buyer_worry": {
      const v = p.steps.find((s) => s.key === "verdict");
      if (!v?.segments) return;
      const go = segPct(v, "proceed");
      const av = segPct(v, "avoid");
      const none = segPct(v, "none");
      const ag = p.steps.find((s) => s.key === "agrees")?.here?.pct ?? null;
      const l = leanOf(go, av);
      const side: BuyerSide = go >= 50 ? "go" : av >= 50 ? "avoid" : none >= 50 ? (ag !== null && ag >= 50 ? "grant" : "none") : l > 0 ? "go" : l < 0 ? "avoid" : "split";
      const key = side === "go" || side === "split" ? "proceed" : side === "avoid" ? "avoid" : "none";
      const often = segOften(v, up?.steps.find((s) => s.key === "verdict"), key);
      p.detail = buyerWorryDetail({ side, often, topRival: topRivalOf(p) });
      factWorryStepDetails(inp, p, ctx);
      return;
    }
    case "customer_worry": {
      const v = p.steps.find((s) => s.key === "verdict");
      if (!v?.segments) return;
      const side = keepSideOf(v);
      const key = side === "stay" ? "keep" : side === "none" ? "none" : "leave";
      const often = segOften(v, up?.steps.find((s) => s.key === "verdict"), key);
      const nd = leaveNoDest(inp);
      const agreesPct = p.steps.find((s) => s.key === "agrees")?.here?.pct ?? 0;
      p.detail = customerWorryDetail({
        side,
        stayMajority: segPct(v, "keep") >= 50,
        granted: agreesPct >= 50,
        often,
        topRival: topRivalOf(p),
        // am37: no leave clause when almost no answer says leave.
        leaveRare: segPct(v, "leave") < 5,
        leaveNoDest: side !== "stay" && nd.leave > 0 && nd.noDest > nd.leave / 2,
        noun: h.noun,
      });
      factWorryStepDetails(inp, p, ctx);
      return;
    }
    case "looking_around": {
      const v = p.steps.find((s) => s.key === "verdict");
      const offers = p.steps.find((s) => s.key === "offers")?.here;
      if (!v?.segments || !offers) return;
      const side = keepSideOf(v);
      const shown = LOOK_BLOCK.get(p);
      const topShown = shown ? [...shown.rows].sort((a, b) => b.num.pct - a.num.pct)[0]?.name : undefined;
      p.detail = lookingAroundDetail({ side: segPct(v, "leave") >= 30 ? "leave" : side, showsMost: offers.pct >= 50, topRival: topShown });
      factLookingStepDetails(inp, p, ctx, shown);
      return;
    }
    case "value": {
      const w = p.steps.find((s) => s.key === "worth");
      const ins = p.steps.find((s) => s.key === "instead");
      if (!w?.segments) return;
      const yes = segPct(w, "yes");
      const no = segPct(w, "no");
      const dep = segPct(w, "depends");
      const l = leanOf(yes, no);
      const side: ValueSide = no >= 50 ? "no" : yes >= 50 ? "yes" : dep >= 50 ? "depends" : l > 0 ? "yes" : l < 0 ? "no" : "split";
      const key = side === "yes" ? "yes" : side === "depends" ? "depends" : "no";
      const often = segOften(w, up?.steps.find((s) => s.key === "worth"), key);
      const own = segPct(ins, "own");
      const rival = segPct(ins, "rival");
      const nowhere = segPct(ins, "nowhere");
      const li = leanOf(rival, own);
      const instead: InsteadSide = rival >= 50 ? "rival" : own >= 50 ? "own" : nowhere >= 50 ? "nowhere" : li > 0 ? "rival" : li < 0 ? "own" : "even";
      // am38: each step explains itself - the verdict in words, then where it points the buyer with the lists of new facts.
      const extra = VALUE_EXTRA.get(p);
      const order = (["yes", "depends", "no"] as const).filter((k) => k !== key).sort((a, b) => segPct(w, b) - segPct(w, a));
      const next = segPct(w, order[0]) > segPct(w, order[1]) ? order[0] : undefined;
      p.details = {
        worth: valueWorthDetail({ side, pooled: !!inp.pooled, often, next, byProduct: !!extra?.byProduct }),
        ...(ins
          ? {
              instead: {
                ...valueInsteadDetail({ instead, ...(instead === "nowhere" && nowhere < NOWHERE_CLEAR ? { half: (li > 0 ? "rival" : li < 0 ? "own" : "even") as InsteadHalf } : {}), ladder: ctx.ladder, topRival: extra?.topRival, noun: h.noun }),
                ...(extra?.sections.length ? { sections: extra.sections } : {}),
              },
            }
          : {}),
      };
      return;
    }
    case "habit": {
      const tag = p.steps.find((x) => x.key === "habit")?.tagUsual ?? "No clear side";
      const side: HabitSide = /sticks with you|^Leans stick/.test(tag) ? "keeps" : /try something else|^Leans switch/.test(tag) ? "moves" : "leaves";
      p.detail = habitDetail(tag, side);
      factHabitStepDetails(inp, p, ctx);
      return;
    }
    case "criteria": {
      p.detail = criteriaDetail(!!p.steps.find((s) => s.key === "taught")?.note?.length, h.plural);
      factCriteriaStepDetails(inp, p, ctx);
      return;
    }
    case "expansion": {
      const s = p.steps.find((x) => x.key === "stance");
      const top = [...(s?.segments ?? [])].sort((a, b) => b.num.pct - a.num.pct)[0];
      p.detail = expansionDetail(top?.key === "backs" ? "backs" : top?.key === "redirects" ? "redirects" : "neutral");
      factExpansionStepDetails(inp, p, ctx);
      return;
    }
    case "business_case": {
      const s = p.steps.find((x) => x.key === "strength");
      const strong = segPct(s, "strong");
      const hedged = segPct(s, "hedged");
      const against = segPct(s, "undermined");
      const l = leanOf(strong, hedged);
      const side: CaseSide = against >= 50 ? "against" : strong >= 50 ? "strong" : hedged >= 50 ? "hedged" : against >= 20 ? "against" : l > 0 ? "strong" : l < 0 ? "hedged" : "even";
      const top = side === "strong" ? p.table?.rows.slice(0, 2).map((r) => r.label) ?? [] : [];
      p.detail = caseDetail(side, top);
      factCaseStepDetails(inp, p, ctx);
      return;
    }
  }
}

/* ------------- am34: what explains each step (the clicked step card) ------------- */

/** The kinds whose stack is a funnel of `here` steps; their steps carry details. */
const STEP_DETAIL_KINDS = new Set<PanelKind>(["buy", "switching", "problem", "popular", "premium", "learning", "h2h"]);
/** A detail never rests on fewer answers than this. */
const DETAIL_MIN = 5;

function stepDetailsOf(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
  if (!FACT_CARD.has(inp)) return;
  if (p.kind === "h2h") return factH2hStepDetails(inp, p, ctx);
  if (!STEP_DETAIL_KINDS.has(p.kind)) return;
  factStepDetails(inp, p, ctx);
  if (p.kind === "popular" || p.kind === "premium") factCommitsDetail(inp, p, ctx);
  if (p.kind === "problem" || p.kind === "learning") factAwarenessDetails(inp, p, ctx);
}

/* ------------- am31 round 2: one rival across every question type ------------- */

/** The all-buyers input of a row (its pooled All cell, else the row's only cell). */
function rowAll(inputs: Map<string, PanelCellInput>, band: string, row: string): PanelCellInput | undefined {
  const a = inputs.get(`${band}:${row}:all`);
  if (a) return a;
  const inRow = [...inputs.values()].filter((x) => x.id.startsWith(`${band}:${row}:`));
  return inRow.length === 1 ? inRow[0] : undefined;
}

/** A row's split cells (never the pooled All cell). */
const splitCells = (inputs: Map<string, PanelCellInput>, band: string, row: string) => [...inputs.values()].filter((x) => !x.pooled && x.id.startsWith(`${band}:${row}:`) && x.key !== "all");

/**
 * Panel 15 (the By rival tab): one rival across every question type it
 * appears in, composed from the map's own per-cell inputs and panels - no new
 * pass, no new grouping. Each step is one question type's all-buyers read
 * (the rival's own head-to-head and switching cells for those two), with the
 * block that explains it. Every bar is a share of all answers of that
 * question type except the two labelled "share of the picks".
 */
export function buildRivalAcross(inputs: Map<string, PanelCellInput>, panels: Map<string, PositionPanel>, h: PanelHelpers, rivals: { key: string; name: string }[]): RivalAcross[] {
  if (!h.facts) return [];
  const ctx: Ctx = { h, inputs, ladder: h.facts.set.ladder };
  return rivals.map((r) => rivalAcrossOne(ctx, panels, r)).filter((x): x is RivalAcross => !!x);
}

function rivalAcrossOne(ctx: Ctx, panels: Map<string, PositionPanel>, rv: { key: string; name: string }): RivalAcross | null {
  const { h, inputs } = ctx;
  const PF = h.facts!;
  const { book, sel, set } = PF;
  const T = set.target.key;
  const R = rv.name;
  const key = rv.key;
  const steps: RivalAcrossStep[] = [];
  // A rival's own page is a layout over the run's facts: every number below is a fact on the question type's own scope,
  // every list a selection; each step's conditions and claims are the card's own (the card is built from the same facts).
  const W = { F: PF, rowById: rowsById(ctx) } as unknown as FactCard;
  const wf = (m: string, sub: string, scope: Scope, unit: string, find: (r: PoolRow) => string) => fx(W, m, sub, scope, unit, find);
  const sk = (k: string) => (k === T ? "you" : k);
  const pf = (name: string) => (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || name;
  const surfF = (k: string, rec: boolean, name: string) => (r: PoolRow) => surfOf(r, k, h, rec) ?? r.code.top_pick ?? name;
  const bar = (name: string, who: RivalAcrossBar["who"], n: PanelNum): RivalAcrossBar => ({ name: who === "you" ? "You" : name, who, num: n });
  const duel = (y: PanelNum, x: PanelNum): { tag: string; tagTone: PanelTone } => {
    const d = duelTag(knOf(y)!, knOf(x)!, R);
    return { tag: d.tag, tagTone: duelTone(d.tag, d.rivalLeads) };
  };
  const lead2 = (cond: PanelConditions | undefined): PanelText | undefined => {
    const a = cond?.away ?? [];
    const t = cond?.toward ?? [];
    if (!a.length && !t.length) return undefined;
    return join(a.length ? attachedLead(`choosing ${R}`, a.slice(0, 2), "answers") : null, a.length && t.length ? " " : null, t.length ? attachedLead("choosing you", t.slice(0, 2), "answers") : null);
  };
  const rivalWords: CondWords = {
    title: `When the AI says to choose ${R}, and when you`,
    sub: `Share of these answers that say "choose this ${h.noun} if the buyer...". The rows for ${R} count only the answers that send the buyer to it.`,
    towardTitle: "Choose you if",
    awayTitle: `Choose ${R} if`,
    alsoToward: `Also said for ${R}`,
    alsoAway: "Also said for you",
    toWord: "To",
  };
  /** A card's own condition rows sending the buyer to this rival, beside the card's own toward rows. */
  const condsOn = (inp: PanelCellInput | undefined, words: CondWords, o: { pickKind?: boolean; pairs?: boolean; towardRows?: PanelCondition[] }) => {
    const fc = inp ? FACT_CARD.get(inp) : undefined;
    if (!inp || !fc) return undefined;
    return factConditions(inp, fc, ctx, words, { onlyTo: key, ...o });
  };
  /** What the answer weighs when it picks the rival vs when it picks you (two arguments each way): a selection. */
  const weighTable = (scope: Scope): PanelTable | undefined => {
    const s = sel.selection("pick_args_diff", key, scope);
    if (!s.members.length) return undefined;
    return {
      title: "What the answer weighs",
      sub: "Share of the answers that pick each brand that raise each argument.",
      columns: [`Picks ${R}`, "Picks you"],
      style: "compare",
      rows: (s.members as SelMember[]).map((x) => ({ label: clabel(x.key, h), cells: [wf("argues_when_picked", `${key}/arg:${x.key}`, scope, "answers that pick", () => x.key), wf("argues_when_picked", `you/arg:${x.key}`, scope, "answers that pick", () => x.key)] })),
      selection: s.id,
    };
  };
  /** Rows of a by-cell list over a row's cards: 3+ answers drawn, fewer folded into one sentence. */
  const byCellRows = (cells: PanelCellInput[], numOf: (sc: Scope) => PanelNum, extra?: (sc: Scope) => PanelSpan | null): { table?: PanelTable; fold?: PanelText } | null => {
    const rows: { label: string; cells: (PanelNum | PanelSpan | null)[]; k: number }[] = [];
    const few: { label: string; n: PanelNum }[] = [];
    const never: string[] = [];
    for (const c of cells) {
      const fc = FACT_CARD.get(c);
      if (!fc) continue;
      const n = numOf(fc.scope);
      const kn = knOf(n)!;
      const label = c.label || ROW_NAME.open;
      if (kn.k >= ROW_MIN) rows.push({ label, cells: [n, ...(extra ? [extra(fc.scope)] : [])], k: kn.k / Math.max(1, kn.n) });
      else if (kn.k > 0) few.push({ label, n });
      else never.push(label);
    }
    if (!rows.length && !few.length) return null;
    rows.sort((a, b) => b.k - a.k || a.label.localeCompare(b.label));
    const parts: (PanelText | string)[] = [];
    if (few.length) parts.push(join("It comes up in ", ...few.flatMap((f, i) => [i ? (i === few.length - 1 ? " and " : ", ") : "", F("a few answers", f.n), ` on ${f.label}`]), "."));
    if (never.length) parts.push(`${few.length ? " " : ""}It never comes up on ${listWords(never)}.`);
    return {
      ...(rows.length ? { table: { title: "", sub: "", columns: extra ? ["Share", ""] : ["Share"], style: "bars" as const, rows: rows.map(({ label, cells }) => ({ label, cells })) } } : {}),
      ...(parts.length ? { fold: join(...parts) } : {}),
    };
  };

  // 1. Spotting the problem - recommended.
  const aw = rowAll(inputs, "chooses", "awareness");
  if (aw) {
    const sc: Scope = { types: ["problem_recognition"] };
    const nR = wf("recommended", key, sc, "answers", surfF(key, true, R));
    if (knOf(nR)!.k) {
      const nY = wf("recommended", "you", sc, "answers", surfF(T, true, h.brand));
      const sits = sel.selection("situations", "ai", sc, { min: 1 });
      const sitM = (sits.members as SelMember[]).filter((x) => x.count >= ROW_MIN);
      const table: PanelTable | undefined =
        sits.members.length >= 2
          ? {
              title: "By buyer",
              sub: "Share of each buyer's answers that recommend the brand.",
              columns: [R, "You"],
              style: "compare",
              rows: sitM
                .map((x) => {
                  const s2: Scope = { ...sc, situation: x.key };
                  return { label: x.name, a: wf("recommended", key, s2, "answers", () => R), b: wf("recommended", "you", s2, "answers", () => h.brand) };
                })
                .sort((x, y) => {
                  const r = (n: PanelNum) => knOf(n)!.k / Math.max(1, knOf(n)!.n);
                  return r(y.a) - r(x.a) || x.label.localeCompare(y.label);
                })
                .map((x) => ({ label: x.label, cells: [x.a, x.b] })),
              selection: sits.id,
            }
          : undefined;
      steps.push({
        key: "awareness",
        label: `${ROW_NAME.awareness} - recommended`,
        cellId: aw.id,
        bars: [bar(R, "rival", nR), bar(h.brand, "you", nY)],
        ...duel(nY, nR),
        heading: `Where buyers describing a problem hear ${R}, and where they hear you`,
        body: join(`When buyers describe a problem without asking for ${article(h.noun)} ${h.noun}, the AI recommends ${R} in `, N(nR), " of answers and you in ", N(nY), "."),
        ...(table && table.rows.length ? { table } : {}),
      });
    }
  }

  // 2. What to buy - named, share of the picks, picked (ruling 7: the all-buyers What to buy card's own scope).
  const op = rowAll(inputs, "chooses", "open");
  let openR: PanelNum | undefined;
  let openY: PanelNum | undefined;
  let namedR: PanelNum | undefined;
  const WS = WHAT_TO_BUY_ALL;
  if (op && (book.fact("named", sk(key), WS).k > 0 || book.fact("share_of_picks", sk(key), WS).k > 0)) {
    openR = wf("share_of_picks", sk(key), WS, "picks", pf(R));
    openY = wf("share_of_picks", "you", WS, "picks", pf(h.brand));
    const conditions = condsOn(op, rivalWords, { pickKind: true, towardRows: panels.get(op.id)?.conditions?.toward });
    const table = weighTable(WS);
    // am73: how often the brand is named here - the figure the Brief's visibility table states for every brand it lists.
    if (book.fact("named", sk(key), WS).k > 0) {
      namedR = wf("named", sk(key), WS, "answers", surfF(key, false, R));
      const namedY = wf("named", "you", WS, "answers", surfF(T, false, h.brand));
      const recR = wf("recommended", sk(key), WS, "answers", surfF(key, true, R));
      const recY = wf("recommended", "you", WS, "answers", surfF(T, true, h.brand));
      const convR = book.fact("recommended", sk(key), WS).k ? wf("converts", sk(key), WS, "recommendations", pf(R)) : null;
      steps.push({
        key: "named",
        label: `${ROW_NAME.open} - named`,
        cellId: op.id,
        bars: [bar(R, "rival", namedR), bar(h.brand, "you", namedY)],
        ...duel(namedY, namedR),
        heading: `How often the AI names ${R} when buyers ask what to buy, and how often you`,
        body: join(
          `When buyers ask what to buy, the AI names ${R} in `, NK("named", namedR), " of answers and recommends it in ", NK("recommended", recR), ". It names you in ", NK("youNamed", namedY), " and recommends you in ", NK("youRecommended", recY), ".",
          ...(convR ? [" ", NK("converts", convR), ` of the answers that recommend ${R} end with it as the pick.`] : [])
        ),
      });
    }
    steps.push({
      key: "open",
      label: `${ROW_NAME.open} - share of the picks`,
      cellId: op.id,
      bars: [bar(R, "rival", openR), bar(h.brand, "you", openY)],
      ...duel(openY, openR),
      heading: `When the AI says to choose ${R} when buyers ask what to buy, and when you`,
      ...(lead2(conditions) ? { body: lead2(conditions) } : {}),
      ...(conditions ? { conditions } : {}),
      ...(table ? { table } : {}),
    });
    // am75: how often the brand is the pick out of ALL these answers - the figure beside the share of picks on the card.
    const pickedR = wf("picked", sk(key), WS, "answers", pf(R));
    const pickedY = wf("picked", "you", WS, "answers", pf(h.brand));
    const commit = { ...wf("commit_rate", "ai", WS, "answers", () => ""), refs: undefined };
    steps.push({
      key: "picked",
      label: `${ROW_NAME.open} - picked, of all answers`,
      cellId: op.id,
      bars: [bar(R, "rival", pickedR), bar(h.brand, "you", pickedY)],
      ...duel(pickedY, pickedR),
      heading: `How often ${R} is the pick out of all the answers, and how often you are`,
      body: join("The AI commits to one ", h.noun, " in ", N(commit), ` of answers when buyers ask what to buy. ${R} is the pick in `, N(pickedR), " of all answers and you are in ", N(pickedY), "."),
    });
  }

  // 3. What's popular - recommended.
  const so = rowAll(inputs, "chooses", "social");
  if (so) {
    const sc: Scope = { types: ["social_validation"] };
    const nR = wf("recommended", key, sc, "answers", surfF(key, true, R));
    if (knOf(nR)!.k) {
      const nY = wf("recommended", "you", sc, "answers", surfF(T, true, h.brand));
      const conditions = condsOn(so, rivalWords, { pickKind: true, towardRows: panels.get(so.id)?.conditions?.toward });
      steps.push({
        key: "social",
        label: `${ROW_NAME.social} - recommended`,
        cellId: so.id,
        bars: [bar(R, "rival", nR), bar(h.brand, "you", nY)],
        ...duel(nY, nR),
        heading: `When buyers ask what most people choose, where ${R} comes up and where you do`,
        body: lead2(conditions) ?? join(`The AI recommends ${R} in `, N(nR), " of these answers and you in ", N(nY), "."),
        ...(conditions ? { conditions } : {}),
      });
    }
  }

  // 4. Head to head with you - the pick (the rival's own matchup): its card's claim, explanation and condition rows.
  const hh = [...inputs.values()].find((x) => x.kind === "h2h" && !x.pooled && x.rivalKey === key);
  let hhR: PanelNum | undefined;
  const hfc = hh ? FACT_CARD.get(hh) : undefined;
  if (hh && hfc) {
    const sc = hfc.scope;
    hhR = wf("h2h_win", key, sc, "answers", pf(R));
    const nY = wf("h2h_win", "you", sc, "answers", pf(h.brand));
    const nN = wf("h2h_neither", "ai", sc, "answers", (r) => verdictFind(r, h));
    const third = book.fact("h2h_another", "ai", sc).k - book.fact("picks_outside_category", "ai", sc).k > 0;
    const hp = panels.get(hh.id);
    const table = weighTable(sc);
    steps.push({
      key: "h2h",
      label: "Head to head with you - the pick",
      cellId: hh.id,
      bars: [bar(R, "rival", hhR), bar(h.brand, "you", nY), bar(third ? "Neither of you" : "No single pick", "other", nN)],
      ...duel(nY, hhR),
      heading: hp?.detail?.heading ?? `Asked to choose between you and ${R}`,
      body: hp?.claim ?? join(`Asked to choose between you and ${R}, the AI picks ${R} in `, N(hhR), " of answers."),
      ...(hp?.conditions ? { conditions: hp.conditions } : {}),
      ...(table ? { table } : {}),
    });
  }

  // 5. Its customers switching - share of the picks: its card's claim and condition rows.
  const lv = [...inputs.values()].find((x) => x.kind === "switching" && !x.pooled && x.rivalKey === key);
  const lfc = lv ? FACT_CARD.get(lv) : undefined;
  if (lv && lfc) {
    const sc = lfc.scope;
    const pb = sel.selection("pick_brands", "you", sc, { youFirst: true, top: 3, exclude: [key] });
    const mine = wf("share_of_picks", "you", sc, "picks", pf(h.brand));
    const others = (pb.members as SelMember[]).filter((b) => b.key !== T && b.count > 0);
    const lp = panels.get(lv.id);
    steps.push({
      key: "leavers",
      label: "Its customers switching - share of the picks",
      cellId: lv.id,
      bars: [bar(h.brand, "you", mine), ...others.map((b) => bar(b.name, "other", wf("share_of_picks", b.key, sc, "picks", pf(b.name))))],
      heading: `Where ${possOf(R)} customers are sent`,
      body: lp?.claim ?? join(`When ${possOf(R)} customers ask where to move, the AI picks you in `, N(mine), " of its picks."),
      ...(lp?.conditions ? { conditions: lp.conditions } : {}),
    });
  }

  /** A doubt step: the rival named as the alternative, beside the top others, with a list by the row's cards. */
  const doubtStep = (k: string, label: string, inp: PanelCellInput | undefined, sibs: PanelCellInput[], measure: "sent_to" | "named_instead", heading: string, body: (n: PanelNum) => PanelText, extra?: (sc: Scope) => PanelSpan | null) => {
    const fc = inp ? FACT_CARD.get(inp) : undefined;
    if (!inp || !fc) return;
    const sc = fc.scope;
    const find = (r: PoolRow) => (r.code.destinations ?? []).find((d) => h.resolve(d).key === key) ?? (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === key)?.brand ?? R;
    const nR = wf(measure, key, sc, "answers", find);
    if (!knOf(nR)!.k) return;
    const comp = sel.selection(measure === "sent_to" ? "sent_brands" : "instead_brands", "you", sc);
    const top = (comp.members as SelMember[]).filter((x) => x.key !== key).slice(0, 2);
    const list = sibs.length >= 2 ? byCellRows(sibs, (s2) => wf(measure, key, s2, "answers", find), extra) : null;
    steps.push({
      key: k,
      label,
      cellId: inp.id,
      bars: [bar(R, "rival", nR), ...top.map((x) => bar(x.name, "other", wf(measure, x.key, sc, "answers", () => x.name)))],
      heading,
      body: body(nR),
      ...(list?.table ? { table: { ...list.table, title: "", sub: "" } } : {}),
      ...(list?.fold ? { fold: list.fold } : {}),
    });
  };
  // 6. Buyers' worries - named as the one to get instead.
  doubtStep(
    "buyers",
    `${ROW_NAME.buyers} - named as the ${h.noun} to get instead`,
    rowAll(inputs, "doubts", "buyers"),
    splitCells(inputs, "doubts", "buyers"),
    "sent_to",
    `Which worries bring up ${R}`,
    (n) => join(`When buyers voice a worry about you, the AI names ${R} as the ${h.noun} to get instead in `, N(n), " of answers. Each share below is of that worry's answers.")
  );
  // 7. Value - recommended instead (ruling 3's rival list), and the rival's product it names most (ruling 15).
  doubtStep(
    "value",
    `${ROW_NAME.value} - recommended instead of your ${h.noun}`,
    rowAll(inputs, "chooses", "value"),
    splitCells(inputs, "chooses", "value"),
    "named_instead",
    `Where ${R} is offered in place of yours`,
    (n) => join(`Asked whether your ${h.noun} is worth paying more for, the AI recommends ${R} instead in `, N(n), " of answers. Each share below is of that buyer's answers."),
    (sc) => {
      const at: Scope = { ...sc, when: `instead:${key}` };
      const ps = sel.selection("instead_products", "ai", at, { top: 50 });
      const prods = (ps.members as SelMember[]).filter((x) => set.products?.get(x.key)?.key === key);
      if (!prods.length) return null;
      const top = prods[0];
      const nTop = wf("slice_share", `ai/slice:insteadprod:${top.key}`, at, "answers", () => top.name);
      const none = book.fact("slice_share", `ai/slice:!insteadbrandprod:${key}`, at).k;
      const shortName = set.products!.get(top.key)!.short;
      if (none > top.count || (none === top.count && noneName(ctx).localeCompare(shortName) < 0)) return null;
      return { t: `Names ${shortName} most`, ...(nTop.refs ? { refs: nTop.refs } : {}), tip: nTop.tip };
    }
  );
  // 8. Your customers' worries - named as where to go.
  doubtStep(
    "customers",
    `Your ${ROW_NAME.customers.toLowerCase()} - named as where to go`,
    rowAll(inputs, "doubts", "customers"),
    splitCells(inputs, "doubts", "customers"),
    "sent_to",
    `Which worries bring up ${R}`,
    (n) => join(`When your customers voice a worry, the AI names ${R} as where to go in `, N(n), " of answers. Each share below is of that worry's answers.")
  );
  // 9. Your customers looking around - shown.
  const ho = rowAll(inputs, "doubts", "hold");
  const hofc = ho ? FACT_CARD.get(ho) : undefined;
  if (ho && hofc) {
    const sc = hofc.scope;
    const nR = wf("sent_to", key, sc, "answers", (r) => (r.code.destinations ?? []).find((d) => h.resolve(d).key === key) ?? R);
    if (knOf(nR)!.k) {
      const comp = sel.selection("sent_brands", "you", sc);
      const top = (comp.members as SelMember[]).filter((x) => x.key !== key).slice(0, 2);
      const conditions = condsOn(
        ho,
        {
          title: `When the AI shows ${R}`,
          sub: `Share of these answers that say "look at another ${h.noun} if...". The rows count only the answers that show ${R}.`,
          towardTitle: "Stay if",
          awayTitle: `Look at another ${h.noun} if`,
          alsoToward: `Also said for another ${h.noun}`,
          alsoAway: "Also said for staying",
          toWord: "Shown",
        },
        { pickKind: false, pairs: false, towardRows: [] }
      );
      steps.push({
        key: "hold",
        label: `${ROW_NAME.hold} - shown`,
        cellId: ho.id,
        bars: [bar(R, "rival", nR), ...top.map((x) => bar(x.name, "other", wf("sent_to", x.key, sc, "answers", () => x.name)))],
        heading: `When the AI shows ${R} to your customers`,
        body: lead2(conditions) ?? join(`Asked what else to look at, the AI shows ${R} in `, N(nR), " of answers."),
        ...(conditions && conditions.away.length ? { conditions } : {}),
      });
    }
  }
  if (!steps.length) return null;

  // Where it takes its picks (what to buy, by buyer) and which of its products it picks (the run's one product grouping).
  let byBuyer: PanelTable | undefined;
  let products: PanelTable | undefined;
  if (op) {
    const sibs = splitCells(inputs, "chooses", "open").filter((c) => FACT_CARD.has(c));
    const rowsB = sibs
      .map((c) => {
        const sc = FACT_CARD.get(c)!.scope;
        const a = wf("share_of_picks", sk(key), sc, "picks", pf(R));
        const b = wf("share_of_picks", "you", sc, "picks", pf(h.brand));
        return { c, a, b };
      })
      .filter((x) => knOf(x.a)!.n >= ROW_MIN && (knOf(x.a)!.k || knOf(x.b)!.k));
    if (rowsB.length >= 2) {
      const r = (n: PanelNum) => knOf(n)!.k / Math.max(1, knOf(n)!.n);
      byBuyer = {
        title: "Where it takes its picks",
        sub: `Share of the picks when buyers ask ${ROW_NAME.open.toLowerCase()}, by buyer.`,
        columns: [R, "You"],
        style: "compare",
        rows: rowsB.sort((x, y) => r(y.a) - r(x.a) || x.c.label.localeCompare(y.c.label)).map((x) => ({ label: x.c.label, cells: [x.a, x.b] })),
      };
    }
    if (ctx.ladder) {
      const at: Scope = { ...WS, when: `pick:${key}` };
      const ps = sel.selection("product_picks", "you", WS, { brand: key, top: 4 });
      const items = (ps.members as SelMember[]).filter((x) => x.key !== "~none" && x.count >= ROW_MIN).slice(0, 3);
      if (items.length)
        products = {
          title: `Which of its ${h.plural} it picks`,
          sub: `Share of the answers to ${ROW_NAME.open.toLowerCase()} that pick ${R}.`,
          columns: ["Share"],
          style: "bars",
          rows: items.map((x) => ({ label: x.name, cells: [wf("pick_product_share", `ai/slice:pickprod:${x.key}`, at, `picks of ${R}`, (r) => r.code.top_pick || x.name)] })),
          selection: ps.id,
        };
    }
  }

  const hs = steps.find((s) => s.key === "h2h");
  const claim = join(
    openR && openY
      ? namedR
        ? join(`${R} is named in `, N(namedR), ` of answers when buyers ask ${ROW_NAME.open.toLowerCase()}, and takes `, N(openR), " of the picks. You take ", N(openY), ".")
        : join(`${R} takes `, N(openR), ` of the picks when buyers ask ${ROW_NAME.open.toLowerCase()}. You take `, N(openY), ".")
      : `${R} across every question where it comes up.`,
    hs && hhR ? join(` Asked to choose between the two of you, the AI picks ${R} in `, N(hhR), " of answers.") : ""
  );
  return {
    name: R,
    claim,
    steps,
    focus: steps.find((s) => s.key === "open")?.key ?? steps[0].key,
    ...(byBuyer ? { byBuyer } : {}),
    ...(products ? { products } : {}),
  };
}

/** Every span tree of a panel, for the harness's walks. */
export function panelTexts(p: PositionPanel): PanelText[] {
  const out: PanelText[] = [p.claim];
  if (p.lead) out.push(p.lead);
  if (p.detail) out.push(p.detail.body);
  if (p.detailComp) out.push(p.detailComp.body);
  for (const d of [...Object.values(p.details ?? {}), ...Object.values(p.detailsComp ?? {})]) if (d) {
    out.push(d.body);
    if (d.both) out.push(d.both);
  }
  for (const l of [...(p.lines ?? []), ...(p.linesComp ?? [])]) out.push(l.value);
  for (const s of p.steps) if (s.note) out.push(s.note);
  return out;
}

export { T };
