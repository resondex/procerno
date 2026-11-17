import { createHash } from "node:crypto";
import { matchKey } from "../brand_key";
import { store } from "../store";
import { cachedRunRevision } from "./run_revision";
import { RESOLVE_VERSION, buildResolver } from "./brand_resolve";
import { BRAND_SUMMARY_VERSION, sharedBrandSummary, type BrandSummaryView, type SummaryBrand } from "./brand_summary";
import { ANALYSIS_MAP_VERSION, sharedAnalysisMap, type MapCellStat } from "./analysis_map";
import { computeHeadline } from "./headline";
import { CONTEXT_JUDGE_MODEL, CONTEXT_JUDGE_VERSION } from "./context_judge";
import { awaySpecifics, destOf, destPhrase, pctFine, rankedInsights, type Insight, type InsightInputs } from "./summary_insights";
import { findingMove } from "./finding_moves";
import { buyerPhrase, theProduct } from "./brief_words";
import { linkResolver, numberContext, type LinkResolver } from "./brief_links";
import { COMMON_WORDS } from "./everyday_words";
import { condLabel } from "./panel_text";
import { isDefaultCondition } from "./condition_groups";
import { cell, loadViewData, requestOf, VIEW_CACHE_MS, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { viewsOf } from "./views";
import type { AnalysisMapView, PanelNum, Position } from "./analysis_types";
import { hasDossier } from "./dossiers";
import { BRAND_CARD, BUILD_A_TABLE, CONDITION_CARD, ENGINES_CARD, brandCard, cardSourcesOf, cardText, cellCard, conditionCard, enginesCard, type CardSources } from "./answer_cards";
import {
  BRIEF_FRAME_LABELS,
  type AnswerCard,
  type BriefAnchor,
  type BriefLink,
  type BriefFrame,
  type BriefMemo,
  type BriefPara,
  type BriefQuad,
  type BriefRow,
  type BriefSection,
  type BriefView,
  type BriefViz,
  type BriefVizItem,
  BRIEF_SCATTER_GEOM,
  scatterPx,
} from "./brief_types";
import type { Project, Run } from "../types";

/**
 * The Brief pill (2026-11-04, BRIEF_PILL_DESIGN_2026-11-04.md): all six (bf29: TOWS and Situation - complication - resolution retired; The diagnosis added)
 * memo frames for one subject brand on one engine set, composed server-side
 * as finished lay sentences. Every number is mechanical - it comes from the
 * brand summary, the analysis map (positions, casting, cell sides), the
 * per-buying-situation headline reads and the sibling views the summary's
 * detectors already read. No model call: the context judge's cached verdicts
 * ride the data load as for every other view, and a keyless environment
 * computes the same memo.
 *
 * The two pick numbers follow the convention: Picked = share of ALL answers
 * (the subject's own funnel), share of picks = of the answers where the AI
 * commits to one product (every brand-vs-brand comparison); whenever both
 * appear, the commit rate sits between them (commitSentence). Visible text
 * carries percentages only; counts live in `tip` fields.
 *
 * Moves are the analysis map's DEFICIT positions - their lever and
 * treatment family are the map's own templates; this file adds only the
 * "where", the "today" number and the watch metric, each a fixed template
 * per map row. A rival subject has no moves (positions are the client's),
 * and the client-only pools (worries, value, leavers, advocacy, the Kept
 * stage) are simply absent from its memos.
 *
 * Per-situation shares come from computeHeadline per room (the same pool and
 * resolution as the workbench facts table, without its client-side
 * encoding); a rival's winning arguments are the summary's lift computed for
 * that brand over the same headline pool.
 */

/* --------------------------------- format --------------------------------- */

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pctN = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const P = (c: RateCell) => pctN(rate(c));
const tipOf = (c: RateCell) => `${c.k} of ${c.n}`;
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const low1 = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const sentence = (t: string) => {
  const x = t.trim();
  return x === "" || /[.!?"]$/.test(x) ? x : `${x}.`;
};
const norm = (s: string) => s.trim().toLowerCase();
// Always 's, even after s ("American Express's") - the house style of the authored briefs.
const poss = (name: string) => `${name}'s`;
const MIN = 20;

/* --------------------------------- anchors -------------------------------- */

type Anchor = BriefAnchor;

/** bf14 (2026-11-07, the answer cards): an anchor id is either a map cell id
 * (a cell card built from its position) or a card key (BRAND_CARD(key),
 * ENGINES_CARD, CONDITION_CARD). Cards build lazily, once, into ctx.cards. */
function cardFor(c: Ctx, id: string): AnswerCard | null {
  if (c.cards.has(id)) return c.cards.get(id) ?? null;
  let card: AnswerCard | null = null;
  if (id.startsWith("card:brand:")) card = brandCard(c.src, id.slice("card:brand:".length), brandGo(c, id.slice("card:brand:".length)));
  else if (id === ENGINES_CARD) card = enginesCard(c.src);
  else if (id === CONDITION_CARD) card = conditionCard(c.src, c.map.positions[OPEN_ALL] ? OPEN_ALL : undefined);
  else {
    const p = c.map.positions[id];
    if (p) card = cellCard(p);
  }
  c.cards.set(id, card);
  return card;
}

/** bf20 (the owner's ruling: cite a non-Build-a-table surface whenever one
 * exists): a brand card's go-deeper link. The target's opens the map's pooled
 * open-questions contest; a rival's opens its dossier under Rivals (gated on
 * the dossiers' own membership rule, same summary); Build a table only when
 * neither exists. */
function brandGo(c: Ctx, key: string): NonNullable<AnswerCard["go"]> {
  if (key === c.summary.target.key) {
    return c.map.positions[OPEN_ALL] ? { label: "Open the open-questions contest on the map", target: "map", cellId: OPEN_ALL } : BUILD_A_TABLE;
  }
  const b = c.summary.brands.find((x) => x.key === key);
  // bf33: the rival's NAME - the panel opener and the By rival card match names (a key opened the old dossier).
  return b && hasDossier(c.summary, key) ? { label: `Open the ${b.name} dossier`, target: "rivals", brand: b.name } : BUILD_A_TABLE;
}

/** A pin for the cell or card, or nothing when neither exists. `label` is the
 * pin's tooltip (a cell's map "where"; a card's question). */
function anchor(c: Ctx, id: string | null | undefined): Anchor | undefined {
  if (!id) return undefined;
  const card = cardFor(c, id);
  if (!card) return undefined;
  if (card.kind === "cell") return { id, label: c.map.positions[id].where, kind: "cell" };
  const label = card.kind === "brand" ? `${card.crumb.split(" · ")[0]} - how it does in open questions` : card.kind === "engines" ? "The assistants" : "The conditions - what sends buyers away";
  return { id, label, kind: card.kind };
}

function cellsOf(c: Ctx, ...ids: (string | null | undefined)[]): Anchor[] | undefined {
  const out: Anchor[] = [];
  for (const id of ids) {
    const a = anchor(c, id);
    if (a && !out.some((x) => x.id === a.id)) out.push(a);
  }
  return out.length ? out : undefined;
}

/** A row's single pin: the first candidate whose card states every number in
 * the row, else the first that states any, else none. */
function rowPin(c: Ctx, row: BriefRow, ...ids: (string | null | undefined)[]): BriefRow {
  const nums = [...briefNumberTokens(`${row.label} ${row.value}`)];
  const as = ids.map((id) => anchor(c, id)).filter((a): a is Anchor => !!a);
  const toks = (a: Anchor) => briefNumberTokens(cardText(c.cards.get(a.id)!));
  const pick = as.find((a) => nums.every((n) => toks(a).has(n))) ?? as.find((a) => nums.some((n) => toks(a).has(n))) ?? as[0];
  return pick ? { ...row, cell: pick } : row;
}

const withCells = <T extends object>(x: T, cells: Anchor[] | undefined): T => (cells ? { ...x, cells } : x);

/** bf15: anchors for a unit whose visible text may carry no number - each
 * carries `at`, the exact phrase of the unit it attaches to (the fact link
 * when there is no number to click). `at` must be a substring of the unit's
 * visible text; citePins drops it on numbered units and drops an anchor
 * without a present `at` on numberless ones. */
function cellsAt(c: Ctx, ...pairs: [string | null | undefined, string][]): Anchor[] | undefined {
  const out: Anchor[] = [];
  for (const [id, at] of pairs) {
    const a = anchor(c, id);
    if (a && !out.some((x) => x.id === a.id)) out.push({ ...a, at });
  }
  return out.length ? out : undefined;
}

/** A row's pooled cell: its All cell, else the row's only cell (which is the whole pool). */
function pooledOf(c: Ctx, prefix: string): string | undefined {
  if (c.map.positions[`${prefix}all`]) return `${prefix}all`;
  const ids = Object.keys(c.map.positions).filter((id) => id.startsWith(prefix));
  return ids.length === 1 ? ids[0] : undefined;
}

const OPEN_ALL = "chooses:open:all";

/**
 * bf34: an argument's figures as the What to buy card shows them ("What the answer weighs", competitors view),
 * only when the card lists it in that side's top three. side "subject": the answers that pick the Brief's
 * subject; "other": those that pick another. The tracker reads the card's own two columns; a rival reads its
 * card inside What to buy (when it picks the tracker / when it picks the rival).
 */
function cardArgOf(map: AnalysisMapView, isTarget: boolean, name: string, code: string, side: "subject" | "other"): { name: string; here: string; there: string } | null {
  const pp = map.positions[OPEN_ALL]?.panel;
  const w = isTarget ? pp?.weighsComp : pp?.rivals?.find((r) => r.name.toLowerCase() === name.toLowerCase())?.weighs;
  if (!w || w.columns.length < 2) return null;
  const subjectCol = isTarget ? 0 : 1;
  const col = w.columns[side === "subject" ? subjectCol : 1 - subjectCol];
  const r = col.rows.find((x) => x.name.toLowerCase() === code.toLowerCase());
  // Never "0%" in a running sentence: "argued in none of those".
  const z = (v: string) => (v === "0%" ? "none" : v);
  return r && r.other ? { name: r.name, here: z(r.num.value), there: z(r.other.num.value) } : null;
}

/** The direct-matchup cell against one rival, by the rival's dictionary key. */
function rivalCell(c: Ctx, key: string): string | undefined {
  for (const [id, st] of Object.entries(c.stats)) if (st.row === "h2h" && !st.pooled && st.rivalKey === key) return id;
  return undefined;
}

/** A brand's open-question numbers: the target's live on the pooled open
 * cell, every other brand's on its brand card. */
const brandPin = (c: Ctx, key: string) => (key === c.target.key ? OPEN_ALL : BRAND_CARD(key));
/** The subject's own funnel: the pooled open cell, plus the brand card for a rival subject. */
const subjectPins = (c: Ctx): string[] => (c.isTarget ? [OPEN_ALL] : [OPEN_ALL, BRAND_CARD(c.subject.key)]);

/* ------------------------------ citation rule ------------------------------ */

/** bf13 (2026-11-06, the owner's citation ruling): every percentage and
 * signed point value in visible memo text must be stated by a pin's card.
 * A number token is exactly as rendered - "15%", "6.7%", "+30 points". */
const NUMBER_TOKEN = /\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g;
export function briefNumberTokens(text: string): Set<string> {
  return new Set(text.match(NUMBER_TOKEN) ?? []);
}

/** RULE 1 (pin validity), applied to every composed memo: a pin on a unit
 * whose visible text carries number tokens survives only if its CARD states
 * at least one of them (bf14: the card is the receipt - cardText). A unit
 * with no numbers keeps its pins (navigational). A brand, engines or
 * condition card is also dropped when every number it shares with the unit
 * is already stated by an earlier surviving pin - those cards exist for the
 * numbers a cell does not state; cell pins keep bf12's denominator-first
 * order untouched. */
function citePins(memo: BriefMemo, cards: Map<string, AnswerCard | null>): BriefMemo {
  const memoTok = new Map<string, Set<string>>();
  const tokensOf = (id: string) => {
    let t = memoTok.get(id);
    if (!t) {
      const card = cards.get(id);
      t = card ? briefNumberTokens(cardText(card)) : new Set<string>();
      memoTok.set(id, t);
    }
    return t;
  };
  const prune = (visible: string, as: Anchor[]): Anchor[] => {
    const nums = [...briefNumberTokens(visible)];
    // bf15: a numberless unit's anchor links its `at` phrase; one with no
    // present phrase could never render, so it does not ship.
    if (nums.length === 0) return as.filter((a) => !!a.at && visible.includes(a.at));
    const kept: Anchor[] = [];
    const covered = new Set<string>();
    for (const a of as) {
      const t = tokensOf(a.id);
      const shared = nums.filter((n) => t.has(n));
      if (!shared.length) continue;
      if (cards.get(a.id)?.kind !== "cell" && shared.every((n) => covered.has(n))) continue;
      // A numbered unit's anchor links its numbers; `at` is for numberless units only.
      if (a.at !== undefined) {
        const { at: _at, ...bare } = a;
        void _at;
        kept.push(bare);
      } else kept.push(a);
      for (const n of shared) covered.add(n);
    }
    return kept;
  };
  const para = (p: BriefPara): BriefPara => {
    if (!p.cells?.length) return p;
    const kept = prune(`${p.lead ?? ""} ${p.text}`, p.cells);
    if (kept.length === p.cells.length && kept.every((a, i) => a === p.cells![i])) return p;
    const { cells: _drop, ...rest } = p;
    void _drop;
    return kept.length ? { ...rest, cells: kept } : rest;
  };
  const row = (r: BriefRow): BriefRow => {
    if (!r.cell || prune(`${r.label} ${r.value}`, [r.cell]).length) return r;
    const { cell: _drop, ...rest } = r;
    void _drop;
    return rest;
  };
  return {
    ...memo,
    sections: memo.sections.map((s) => ({
      ...s,
      ...(s.paras ? { paras: s.paras.map(para) } : {}),
      ...(s.rows ? { rows: s.rows.map(row) } : {}),
      ...(s.quads ? { quads: s.quads.map((q) => ({ ...q, cells: [q.cells[0].map(para), q.cells[1].map(para)] as [BriefPara[], BriefPara[]] })) } : {}),
    })),
  };
}

/** Every anchor id a memo's paragraphs and rows still carry. */
function anchorIds(memo: BriefMemo): Set<string> {
  const out = new Set<string>();
  const para = (p: BriefPara) => p.cells?.forEach((a) => out.add(a.id));
  for (const s of memo.sections) {
    s.paras?.forEach(para);
    s.rows?.forEach((r) => r.cell && out.add(r.cell.id));
    s.quads?.forEach((q) => q.cells.forEach((col) => col.forEach(para)));
  }
  return out;
}

const placementKey = (key: string, title: string) => `${key}\u0000${title}`;

/** The cell the map placed an insight on (the ranked probe, else the payload's served list). */
function insightCell(c: Ctx, i: { key: string; title: string }): string | undefined {
  const k = placementKey(i.key, i.title);
  return c.placements.get(k) ?? c.map.insightCells?.find((x) => x.key === i.key && x.title === i.title)?.cellId;
}

/** bf12: a brief pin promises "the numbers behind this sentence live here",
 * so each detector pins the cell whose answer pool is its denominator. The
 * map tensions' matcher answers a different question ("where should this
 * point you to look") and prefers the most specific cell named in the text -
 * a pooled finding that names its top captor would pin that rival's split
 * cell, whose pool is not the sentence's. Pools are row prefixes resolved
 * through pooledOf (the All cell, else the row's only cell) or literal cell
 * ids; `match: true` appends the matcher's cell where the named cell carries
 * part of the story (the captor's own leaver pool, the hardest matchup);
 * `matchFirst` leads with it where the headline number is the specific
 * cell's (the backed worry) and the pool is the baseline. Keys absent here
 * are split-scoped: the matcher's cell IS the denominator (rooms, rivals,
 * leak_problem's room). */
type PinRule = { pools: string[] | ((i: { title: string; body: string }, c: Ctx) => string[]); match?: boolean; matchFirst?: boolean };

/** The open choice's top rival (the detectors' `rival`: the most-picked non-target brand). */
const topRival = (c: Ctx) => c.summary.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
/** The brand a "carries <whose> picks" title names (the target for "your"). */
function brandInTitle(c: Ctx, title: string): string {
  const b = c.summary.brands.filter((x) => x.key !== c.target.key).find((x) => title.includes(`${x.name}'s `) || title.includes(`${x.name}' `));
  return b ? b.key : c.target.key;
}
const PIN_RULES: Record<string, PinRule> = {
  leaver_capture: { pools: ["fights:leavers:"], match: true },
  own_defense: { pools: ["doubts:hold:"] },
  prompted_vs_open: { pools: ["fights:h2h:", OPEN_ALL], match: true },
  rival_open: { pools: (_i, c) => [OPEN_ALL, ...(topRival(c) ? [BRAND_CARD(topRival(c)!.key)] : [])] },
  neutralized_differentiator: { pools: ["fights:h2h:"], match: true },
  argument: { pools: [OPEN_ALL] },
  taught_vs_winning: { pools: ["chooses:criteria:", OPEN_ALL] },
  doubt_rollup: { pools: ["doubts:buyers:", "doubts:customers:"] },
  doubt_worry: { pools: (i) => (i.body.includes("a customer raises") ? ["doubts:customers:"] : ["doubts:buyers:"]), matchFirst: true },
  worst_worry: { pools: ["doubts:customers:"], matchFirst: true },
  agreed_yet_stay: { pools: (i) => (i.title.endsWith("stay") ? ["doubts:customers:"] : ["doubts:buyers:"]) },
  funnel: { pools: [OPEN_ALL] },
  value_in_house: { pools: ["chooses:value:"] },
  advocacy_vs_objection: { pools: ["settled:settled:", "doubts:buyers:"] },
  // bf14: the target's brand card carries its picks by buying situation and by question.
  pick_concentration_room: { pools: (_i, c) => [BRAND_CARD(c.target.key)], match: true },
  pick_concentration_question: { pools: (i, c) => [BRAND_CARD(i.title.includes("your") ? c.target.key : topRival(c)?.key ?? c.target.key)], match: true },
  away_condition: { pools: [CONDITION_CARD], match: true },
  leak_picks: { pools: [OPEN_ALL], match: true },
  leave_no_exit: { pools: ["doubts:customers:"] },
  conversion_vs_rival: { pools: (_i, c) => [OPEN_ALL, ...(topRival(c) ? [BRAND_CARD(topRival(c)!.key)] : [])], match: true },
  // bf13: the citation fixes - every number in the finding is stated by a pinned panel.
  // Both buying situations a spread names (stable title templates).
  room_win: { pools: (i) => roomPair(i.title, /^Strongest with (.+), weakest with (.+)$/, "chooses:open:") },
  room_value: { pools: (i) => roomPair(i.title, /^Worth it most for (.+), least for (.+)$/, "chooses:value:") },
  // The hardest matchup first, the record against every rival (the closest contest) second.
  rival_h2h: { pools: ["fights:h2h:"], matchFirst: true },
  // The room's problem cell first; the category-wide rate lives on the pooled cell.
  leak_problem: { pools: ["chooses:awareness:"], matchFirst: true },
  // bf14: the assistants live on the engines card; one brand's supplier on its brand card.
  engine_spread: { pools: [ENGINES_CARD] },
  engine_mode: { pools: [ENGINES_CARD] },
  engine_vendor: { pools: [ENGINES_CARD] },
  engine_decisiveness: { pools: [ENGINES_CARD] },
  engine_h2h_flip: { pools: [ENGINES_CARD, "fights:h2h:"] },
  engine_pick_concentration: { pools: (i, c) => [BRAND_CARD(brandInTitle(c, i.title))] },
};

/** The two cells a "most X, least Y" title names, by its stable template. */
function roomPair(title: string, re: RegExp, prefix: string): string[] {
  const m = re.exec(title);
  return m ? [`${prefix}${norm(m[1])}`, `${prefix}${norm(m[2])}`] : [];
}

/** Every pin for an insight, denominator cells first (see PIN_RULES). */
function insightCells(c: Ctx, i: { key: string; title: string; body?: string }): string[] {
  const matched = insightCell(c, i);
  const rule = PIN_RULES[i.key];
  if (!rule) return matched ? [matched] : [];
  const srcs = typeof rule.pools === "function" ? rule.pools({ title: i.title, body: i.body ?? "" }, c) : rule.pools;
  const pools = srcs.map((s) => (s.endsWith(":") ? pooledOf(c, s) : s)).filter((x): x is string => !!x && !!cardFor(c, x));
  const m = (rule.match || rule.matchFirst) && matched ? [matched] : [];
  const ids = rule.matchFirst ? [...m, ...pools] : [...pools, ...m];
  return [...new Set(ids.length ? ids : matched ? [matched] : [])];
}

/* --------------------------------- context -------------------------------- */

interface RoomRead {
  room: string;
  description: string | null;
  firm: RateCell;
  answers: number;
  brands: { key: string; name: string; chosen: number; share: RateCell }[];
}

interface Move {
  cellId: string;
  row: string;
  label: string;
  lead: string;
  claim: string;
  lever: string;
  /** The lever's first clause, lower-cased, with the cell's "where" appended. */
  act: string;
  /** The act without the cell's "where" - the dedupe key when one lever family repeats across moves. */
  actStem: string;
  family: string;
  watch: string;
  today: string;
  tip: string;
}

/** One SWOT entry: a one-sentence `text`. */
interface Item {
  text: string;
  tip?: string;
  kind: string;
  row?: string;
  effect: number;
  /** The map cell the entry was read from, when the engine holds one. */
  cellId?: string;
  /** All of the entry's pins, denominator cells first (insight-sourced entries). */
  cellIds?: string[];
}

interface Ctx {
  data: ViewData;
  summary: BrandSummaryView;
  inputs: InsightInputs;
  map: AnalysisMapView;
  stats: Record<string, MapCellStat>;
  ranked: Insight[];
  isTarget: boolean;
  target: SummaryBrand;
  subject: SummaryBrand;
  brand: string;
  name: string;
  product: string;
  rooms: RoomRead[];
  lift: { code: string; wins: RateCell; others: RateCell; lift: number }[];
  /** The subject's direct-matchup record against the target (rival subjects only). */
  vsTarget: { won: RateCell; n: number } | null;
  moves: Move[];
  /** now_what's numbered findings (served insights; rival: composed facts) - the other frames skip them. */
  findings: { lead: string; text: string; tip?: string; key: string; cellIds?: string[] }[];
  /** Ranked insights placed on map cells by the map's own matcher (key + title -> cell id). */
  placements: Map<string, string>;
  /** The subject's headline picks by stage (discovery / use_case / ...). */
  stagePicks: Map<string, number>;
  /** The closing-sentence archetype (the map's casting for the target; leads/else for a rival). */
  archetype: string;
  footer: string;
  wave: number;
  /** bf14: the answer cards built so far, by anchor id (null = nothing to show there). */
  cards: Map<string, AnswerCard | null>;
  /** The objects the brand / engines / condition cards read. */
  src: CardSources;
  /** bf26: the same detectors in the Brief's style (third person, buyers as words), by key - target only. */
  voiced: Map<string, Insight>;
  /** bf29: the map's per-buyer lift (any subject) and one side's argued codes. */
  roomLift?: NonNullable<import("./analysis_map").AnalysisMapDebug["roomLift"]>;
  roomCodes?: NonNullable<import("./analysis_map").AnalysisMapDebug["roomCodes"]>;
}

function roomDescriptions(json: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!json) return out;
  try {
    const d = JSON.parse(json) as { rooms?: { decided?: { label?: string; description?: string }[] } };
    for (const r of d.rooms?.decided ?? []) if (r.label && r.description?.trim()) out.set(r.label.trim(), r.description.trim());
  } catch {
    /* unreadable record: no descriptions */
  }
  return out;
}

/** A Map cell name written to "you" ("What to use alongside you") in the Brief's third person. */
const cellNameAbout = (label: string, brand: string) => label.replace(/\byou\b/g, brand).replace(/\byour\b/g, poss(brand));

/** The lay "where" of a map cell, its act preposition and its watch metric (bf26: third person, buyers as words;
 * a lead that is just the buyer's name keeps the label). */
function cellWords(row: string, label: string, brand: string): { lead: string; prep: string; watch: string } {
  const B = (l: string) => buyerPhrase(l);
  switch (row) {
    case "open":
      return { lead: label, prep: `for ${B(label)}`, watch: `${poss(brand)} share of picks for ${B(label)}` };
    case "social":
      return { lead: "What most buyers pick", prep: "when buyers ask what most people pick", watch: `${poss(brand)} share of picks when buyers ask what most people pick` };
    case "awareness":
      return label
        ? { lead: `${label} - before they know what to buy`, prep: `in the problem questions of ${B(label)}`, watch: `how often the AI recommends ${brand} in the problem questions of ${B(label)}` }
        : { lead: "Before buyers know what to buy", prep: "in problem questions", watch: `how often the AI recommends ${brand} in problem questions` };
    case "explainer":
      return { lead: "Learning the category", prep: "when buyers learn the category", watch: `how often the AI recommends ${brand} when buyers learn the category` };
    case "value": {
      // The map labels a Value cell "<room> - <line>" (either part may be absent).
      const [room, line] = label.includes(" - ") ? label.split(" - ") : [label, ""];
      const what = line || brand;
      return {
        lead: label ? `Worth the price - ${label}` : "Worth the price",
        prep: room ? `for ${B(room)}` : "on price",
        watch: `how often the AI calls ${what} worth it${room ? ` for ${B(room)}` : ""}`,
      };
    }
    case "premium":
      return { lead: "Premium versus basic", prep: "when buyers weigh premium against basic", watch: `${poss(brand)} share of picks when buyers weigh premium against basic` };
    case "criteria":
      return {
        lead: label ? `What the AI tells ${B(label)} to look for` : "What the AI tells buyers to look for",
        prep: label ? `in the answers to ${B(label)}` : "",
        watch: `how often the AI tells buyers to look for the points that win for ${brand}`,
      };
    case "h2h":
      return { lead: `Against ${label}`, prep: `against ${label}`, watch: `how often the AI picks ${brand} over ${label} when asked to compare them` };
    case "leavers":
      return label
        ? { lead: `${poss(label)} customers looking to switch`, prep: `with ${poss(label)} customers`, watch: `how often ${poss(label)} customers are told to pick ${brand}` }
        : { lead: "Rival customers looking to switch", prep: "with rival customers", watch: `how often rival customers are told to pick ${brand}` };
    case "buyers":
      return { lead: `The worry "${label}"`, prep: `on the worry "${label}"`, watch: `how often buyers who worry "${label}" are told to go ahead` };
    case "customers":
      return { lead: `Customers who worry "${label}"`, prep: `on the worry "${label}"`, watch: `how often customers who worry "${label}" are told to stay` };
    case "hold":
      return { lead: `${poss(brand)} customers looking around`, prep: `with ${poss(brand)} own customers`, watch: `how often ${poss(brand)} customers are told to stay when they look around` };
    case "repertoire":
      return { lead: "Habit buyers", prep: "with habit buyers", watch: `how often habit buyers are told to stick with ${brand}` };
    case "settled": {
      const q = cellNameAbout(label, brand);
      return { lead: `${poss(brand)} customers - ${q}`, prep: `with ${poss(brand)} customers on ${low1(q)}`, watch: `how often the AI strengthens the relationship on ${low1(q)}` };
    }
    default:
      return { lead: label || "This contest", prep: "", watch: `${poss(brand)} share of picks` };
  }
}

/** "Today" in the cell's own unit (bf26: the brand by name, "none" / "every" at the extremes). */
function todayOf(st: MapCellStat, brand: string): string {
  const youD = pctN(st.d > 0 ? st.you / st.d : 0);
  const themD = pctN(st.d > 0 ? st.them / st.d : 0);
  const youN = pctN(st.n > 0 ? st.you / st.n : 0);
  const noneN = st.you === 0;
  switch (st.row) {
    case "open":
    case "social":
    case "premium":
    case "leavers":
    case "h2h":
      if (st.d > 0 && st.you === 0 && st.them === st.d) return `today ${st.taker} takes every pick between the two`;
      return st.you === 0 ? `today ${brand} takes none of the picks, against ${themD} for ${st.taker}` : `today ${brand} takes ${youD} of the picks against ${themD} for ${st.taker}`;
    case "value":
      return noneN ? "today no answer calls it worth it" : `today ${youN} of the answers call it worth it`;
    case "buyers":
      return noneN ? "today none of these buyers is told to go ahead" : `today ${youN} of these buyers are told to go ahead`;
    case "customers":
    case "hold":
      return noneN ? "today none is told to stay" : `today ${youN} are told to stay`;
    case "awareness":
    case "explainer":
      return noneN ? `today the AI never recommends ${brand} in these answers` : `today the AI recommends ${brand} in ${youN} of these answers`;
    case "criteria":
      return noneN ? `today none of these answers tells buyers to look for a point that wins for ${brand}` : `today ${youN} of these answers tell buyers to look for a point that wins for ${brand}`;
    case "repertoire":
      return noneN ? `today none is told to stick with ${brand}` : `today ${youN} are told to stick with ${brand}`;
    case "settled":
      return noneN ? "today the AI never strengthens the relationship" : `today the AI strengthens the relationship in ${youN}`;
    default:
      return `today ${brand} holds ${youD}`;
  }
}

/** The map's lever (analysis_map.ts LEVER) as a short verb phrase, for the
 * sentences that carry a move inside another sentence (SWOT, the diagnosis).
 * One template per triage and lever variant - the same variants the map
 * chooses between, never new strategy. */
function actOf(p: Position, st: MapCellStat, brand: string): string {
  // bf21: the am15 plain-wording pass - each phrase restates its lever sentence.
  switch (p.triageSuggested) {
    case "record_wrong":
      return "correct the out-of-date facts in the sources the AI draws on";
    case "proof_missing":
      return st.row === "criteria" && st.criteriaWinner
        ? `get ${st.criteriaWinner} into the guides the AI draws on when it tells buyers what to look for`
        : st.row === "buyers"
          ? "publish the evidence that answers this worry where the AI looks for it"
          : `publish the evidence for ${poss(brand)} side where the AI looks for it`;
    case "strategy_misfit":
      return st.wall
        ? `stop arguing against buyers who say "${condLabel(st.wall)}" and aim at the buyers it does not apply to`
        : st.badges.includes("leak")
          ? "cover everything this buyer needs, or decide to leave this buyer to others"
          : "build a case that works for the typical buyer, or accept being the specialist";
    case "product_truth":
      return `check what the AI says against ${poss(brand)} own data before writing anything`;
    case "earned":
      return "keep the proof behind this current and easy for the AI to find";
    case "overclaimed":
      return "build the proof where buyers ask without being prompted";
    case "windfall":
      return `find out how much of this demand moves to ${poss(brand)} own cheaper option and how much leaves`;
  }
}

/** bf26: the map's lever sentences in the Brief's third person (the seven families' fixed wordings, analysis_map.ts LEVER). */
function leverAbout(lever: string, brand: string, wall?: string | null): string {
  const b = poss(brand);
  return lever
    // bf31: the fixed-situation lever names the situation.
    .replace("Don't spend on arguing against this.", wall ? `Don't spend on arguing against buyers who say "${condLabel(wall)}".` : "Don't spend on arguing against this.")
    .replace(/^When the AI teaches buyers what to look for, (.+?) - an argument that comes up more when you win - is missing\./, `When the AI tells buyers what to look for, $1 - an argument that comes up more when ${brand} wins - is missing.`)
    .replace("so there is nothing to push into these answers yet. Keep the facts behind your winning arguments current.", `so there is nothing to push into these answers yet. Keep the facts behind ${b} winning arguments current.`)
    .replace("make the rival's case and not yours. Publish the evidence for your side", `make the rival's case and not ${b}. Publish the evidence for ${b} side`)
    .replace("than what brings them to you.", `than what brings them to ${brand}.`)
    .replace("compare what it says with your own data.", `compare what it says with ${b} own data.`)
    .replace("You hold this. Keep the proof", `${brand} holds this. Keep the proof`)
    .replace("not your standing.", `not ${b} standing.`)
    .replace("moves to your own cheaper option", `moves to ${b} own cheaper option`);
}

/** bf26: a finding's move as a verb phrase for the sentences that carry a move inside another (SWOT, the diagnosis):
 * its first clause when it opens with an instruction, else null (the cell's act is used). */
const IMPERATIVE = /^(Read|Check|Publish|Get|Put|Keep|Decide|Defend|Build|Lead|Ask|Find|See|Answer|Aim|Don't|Give)\b/;
export function actFromMove(text: string): string | null {
  // Only a move that opens with its instruction: a later clause ("...; decide whether to contest that question")
  // leans on the clause before it and reads wrong inside another sentence.
  if (!IMPERATIVE.test(text)) return null;
  // bw4: a colon introduces the action's object ("Build on the exception: aim at the buyers ...") - keep it;
  // only a semicolon's later clause is dropped.
  return low1(text.split(";")[0].trim().replace(/:\s+/, " - ").replace(/[.\s]+$/, ""));
}

/** Rows whose cell is a contest for the pick or a verdict on the brand - where a generic fact check is a real move. */
const CONTEST_ROWS = new Set(["open", "h2h", "leavers", "value", "buyers", "customers", "hold", "criteria"]);

function movesOf(map: AnalysisMapView, stats: Record<string, MapCellStat>, brand: string, findingAt: (cellId: string) => Insight | undefined): Move[] {
  const deficits = Object.values(map.positions)
    // Pooled All cells are the verdict paragraph's ground, not a move - a
    // move names the specific contest to act on.
    .filter((p) => p.status === "deficit" && stats[p.cellId] && !stats[p.cellId].pooled)
    // bf31: a bare "check what the AI says against its own data" is too vague to print on a row that is not a
    // contest for the pick or a verdict on the brand (learning the category, what's popular, spotting the problem,
    // premium vs basic, habit, the customer questions) - no move there unless a finding gives it one.
    .filter((p) => p.triageSuggested !== "product_truth" || CONTEST_ROWS.has(stats[p.cellId].row) || !!findingAt(p.cellId))
    .sort((a, b) => {
      const sa = stats[a.cellId];
      const sb = stats[b.cellId];
      return Number(sb.verdict === "theirs") - Number(sa.verdict === "theirs") || sb.d - sa.d || a.cellId.localeCompare(b.cellId);
    });
  // One move per kind of contest first, then the rest by rank.
  const picked: Position[] = [];
  const rows = new Set<string>();
  for (const p of deficits) {
    if (picked.length >= 5) break;
    const row = stats[p.cellId].row;
    if (rows.has(row)) continue;
    rows.add(row);
    picked.push(p);
  }
  for (const p of deficits) {
    if (picked.length >= 5) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked.map((p) => {
    const st = stats[p.cellId];
    const w = cellWords(st.row, st.label, brand);
    // bf26: a move on the cell a served finding sits on is that finding's move (finding_moves.ts, third person);
    // otherwise the cell's lever.
    const f = findingAt(p.cellId);
    const fm = f ? findingMove(f.key, f.names, brand) : null;
    const fromFinding = fm ? actFromMove(fm.text) : null;
    const stem = fromFinding ?? actOf(p, st, brand);
    const act = fromFinding ? stem : `${stem}${w.prep ? ` ${w.prep}` : ""}`;
    return {
      cellId: p.cellId,
      row: st.row,
      label: st.label,
      lead: w.lead,
      claim: p.claim,
      lever: fm ? sentence(fm.text) : sentence(leverAbout(p.lever, brand, st.wall)),
      act,
      actStem: stem,
      family: fm ? fm.family : p.family,
      watch: w.watch,
      today: todayOf(st, brand),
      tip: `${st.you} answers on ${poss(brand)} side, ${st.them} on ${st.taker}'s, of ${st.d} that take a side; ${st.n} answers in all. The move: ${fm ? fm.family : p.family}.`,
    };
  });
}

async function waveOf(run: Run): Promise<number> {
  try {
    const runs = (await store.listRuns(run.project_id)).filter((r) => r.status !== "failed");
    const sorted = [...runs].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const i = sorted.findIndex((r) => r.id === run.id);
    return i >= 0 ? i + 1 : 1;
  } catch {
    return 1;
  }
}

function monthOf(run: Run): string {
  const iso = run.completed_at ?? run.started_at ?? run.created_at;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/* ---------------------------------- frames --------------------------------- */

const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Rooms ranked by the subject's share of picks there (enough picks to read). */
function roomsByShare(c: Ctx) {
  return c.rooms
    .filter((r) => r.firm.k >= MIN)
    .map((r) => {
      const mine = r.brands.find((b) => b.key === c.subject.key);
      const top = r.brands.filter((b) => b.key !== c.subject.key).sort((a, b) => b.chosen - a.chosen)[0];
      return { r, share: mine ? mine.share : cell(0, r.firm.k), top };
    })
    .sort((a, b) => rate(b.share) - rate(a.share) || a.r.room.localeCompare(b.r.room));
}

const leaderOf = (c: Ctx) => c.summary.brands.find((b) => b.key !== c.subject.key && b.chosen.k > 0);

/** now_what's one-paragraph verdict: casting, the funnel with the commit
 * rate, the share of picks against the top rival, and one close templated
 * from the archetype. */
function verdictPara(c: Ctx): BriefPara {
  const s = c.summary;
  const S = c.subject;
  const parts: string[] = [];
  const tips: string[] = [`Named ${tipOf(S.mentioned)}; recommended ${tipOf(S.recommended)}; picked ${tipOf(S.chosen)}; ${S.chosen.k} of ${s.firmPickInCategory.k} in-category picks.`];
  if (c.isTarget) parts.push(c.map.casting.casting);
  // bf29: the scoreboard below carries named, recommended and the leader's share; the verdict keeps the two
  // pick numbers with their bridge.
  parts.push(`The AI commits to one ${c.product} in ${P(s.firmPickInCategory)} of answers; when it does, ${c.name} is the pick ${P(S.shareOfDecided)} of the time - ${pctFine(rate(S.chosen))} of all answers.`);
  const leader = leaderOf(c);
  const ranked = roomsByShare(c);
  // A buying situation the close names (its rival share lives on that cell).
  let roomPin: string | undefined;
  switch (c.archetype) {
    case "default": {
      const weak = ranked[ranked.length - 1];
      if (weak && weak.top && weak.top.chosen > 0) roomPin = `chooses:open:${norm(weak.r.room)}`;
      parts.push(
        weak && weak.top && weak.top.chosen > 0
          ? `When nothing pulls the buyer elsewhere, the answer is ${c.name}; the contest is over the buyers something does pull - ${buyerPhrase(weak.r.room)}, where ${weak.top.name} takes ${P(weak.top.share)}.`
          : `When nothing pulls the buyer elsewhere, the answer is ${c.name}.`
      );
      break;
    }
    case "challenger":
      parts.push(`Compared directly, the AI prefers ${c.name}; asked openly, it hands the pick to ${leader?.name ?? "someone else"} - the work is getting into the open answer.`);
      break;
    case "companion":
      parts.push(`The AI keeps ${c.name} on the list beside the pick; the work is turning that second mention into the first.`);
      break;
    case "reference":
      parts.push(`The AI explains the category through ${c.name} and then recommends something else; being the reference is not being the pick.`);
      break;
    default: {
      // bf29: best ground only where the subject leads or is near the leader (nearStand - the By buying
      // situation view's own rule); else it leads none and the closest is named.
      const st = roomStands(c);
      const good = st.filter(nearStand).slice(0, 2);
      const closest = st[0];
      if (good.length) good.forEach((x) => (roomPin ??= `chooses:open:${norm(x.r.room)}`));
      else if (closest) roomPin = `chooses:open:${norm(closest.r.room)}`;
      parts.push(
        good.length
          ? `The ${c.product} the AI describes wins most where the buyer says who they are - ${listOf(good.map((x) => buyerPhrase(x.r.room)))} ${good.length > 1 ? "are" : "is"} its best ground; the buyer who doesn't say gets someone else's ${c.product}.`
          : closest && closest.leader
            ? `It leads no buying situation - it comes closest with ${buyerPhrase(closest.r.room)}, ${closest.mine.k === 0 ? "none" : P(closest.mine)} of the picks to ${P(closest.leader.share)} for ${closest.leader.name}.`
            : `The ${c.product} the AI describes is for a specific buyer; the buyer who doesn't say who they are gets someone else's ${c.product}.`
      );
    }
  }
  return withCells({ text: parts.join(" "), tip: tips.join(" ") }, cellsOf(c, ...subjectPins(c), leader ? brandPin(c, leader.key) : null, roomPin));
}

function funnelBreaks(c: Ctx): BriefPara {
  const S = c.subject;
  const conv = (b: SummaryBrand) => (b.recommended.k > 0 ? b.chosen.k / b.recommended.k : 0);
  const mine = conv(S);
  const parts = [
    // bf29: recommended and picked are the scoreboard's; this line keeps the conversion comparison.
    `Only ${pctN(mine)} of the answers that recommend ${c.name} end with it as the pick.`,
  ];
  const tips = [`${S.chosen.k} picks of ${S.recommended.k} recommending answers.`];
  const better = c.summary.brands
    .filter((b) => b.key !== S.key && b.recommended.k >= MIN && conv(b) > mine)
    .sort((a, b) => conv(b) - conv(a) || a.name.localeCompare(b.name))
    .slice(0, 3);
  if (better.length) {
    parts.push(`${listOf(better.map((b, i) => (i === 0 ? `${b.name} turns ${pctN(conv(b))} of its recommendations into picks` : `${b.name} ${pctN(conv(b))}`)))}.`);
    tips.push(better.map((b) => `${b.name} ${b.chosen.k} of ${b.recommended.k}`).join("; ") + ".");
  } else parts.push(`No rival turns its recommendations into picks more often.`);
  // bf34: the picks' split by kind of question is gone (Tyler: it analyses the method, not the market).
  // The pooled open cell states the target's funnel; the subject's card its stage split; each better converter's card its rate.
  return withCells({ lead: "How the funnel breaks.", text: parts.join(" "), tip: tips.join(" ") }, cellsOf(c, OPEN_ALL, BRAND_CARD(S.key), ...better.map((b) => brandPin(c, b.key))));
}

/** bf29: "The conditions that decide it" in three short parts - who the AI sends to the subject, who it sends
 * away and to whom, and the buyers no message moves. The one counting rule holds (a themed side counts its themes
 * at answer grain over its own base; a raw side counts questions). */
/** bf34: a condition as a card shows it - the row whose name matches, in the first of `cells` that lists it on that side. */
const condKey = (t: string) => condLabel(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function cardCond(c: Ctx, cells: string[], label: string, side: "toward" | "away"): { id: string; share: PanelNum } | null {
  for (const id of cells) {
    const r = c.map.positions[id]?.panel?.conditions?.[side].find((x) => condKey(x.text) === condKey(label));
    if (r) return { id, share: r.share };
  }
  return null;
}

/** bf34: "The conditions that decide it", read off the What to buy card - its own rows and shares (shares of all the
 * card's answers); a rival reads its card there (the rows sending buyers to it, and the card's rows for the tracker). */
function conditionsFromCard(c: Ctx): BriefPara[] | null {
  const pp = c.map.positions[OPEN_ALL]?.panel;
  const own = c.isTarget ? pp?.conditions : pp?.rivals?.find((r) => r.name.toLowerCase() === c.name.toLowerCase())?.conditions;
  if (!own || (!own.toward.length && !own.away.length)) return null;
  // The card's "choose you" side is the tracker's: a rival's own side is its card's away column.
  const toR = (c.isTarget ? own.toward : own.away).slice(0, 3);
  const awayR = (c.isTarget ? own.away : own.toward).slice(0, 3);
  const q = (t: string) => `"${condLabel(t)}"`;
  const pin = cellsOf(c, OPEN_ALL, CONDITION_CARD);
  const out: BriefPara[] = [];
  if (toR.length)
    out.push(
      withCells(
        {
          lead: `Who it sends to ${c.name}.`,
          text: `When buyers ask what to buy, the AI says to choose ${c.name} for buyers who say ${listOf(toR.map((r) => q(r.text)))}. The most common comes up in ${toR[0].share.value} of those answers.`,
          tip: toR.map((r) => `${r.text}: ${r.share.tip}`).join("; "),
        },
        pin
      )
    );
  if (awayR.length) {
    const named = awayR.map((r) => (c.isTarget && r.to?.[0] ? `${q(r.text)} (to ${r.to[0].name})` : q(r.text)));
    out.push(
      withCells(
        {
          lead: "Who it sends away.",
          text: `It says to choose ${c.isTarget ? `another ${c.product}` : c.brand} for buyers who say ${listOf(named)}. The most common comes up in ${awayR[0].share.value} of those answers.`,
          tip: awayR.map((r) => `${r.text}: ${r.share.tip}`).join("; "),
        },
        pin
      )
    );
  }
  return out;
}

/** bf34: a finding's "it comes up in N% of the questions/answers where the AI gives any condition ..." clause, quoted
 * from the card that shows that condition (the finding's own cell, else What to buy) - the clause is dropped when no
 * card shows it. */
function quoteCardCondition(c: Ctx, i: { key: string; title: string; body?: string }, text: string): string {
  if (i.key !== "away_condition") return text;
  const m = text.match(/"([^"]+)"[^;]*; it comes up in \S+ of the (?:questions|answers) where the AI gives any condition that sends buyers away/);
  if (!m) return text;
  const clause = /; it comes up in \S+ of the (?:questions|answers) where the AI gives any condition that sends buyers away/;
  const hit = cardCond(c, [...insightCells(c, i), OPEN_ALL], m[1], "away");
  if (!hit) return text.replace(clause, "");
  const st = c.stats[hit.id];
  const where = hit.id === OPEN_ALL ? "when buyers ask what to buy" : st?.row === "h2h" && !st.pooled ? `when the AI compares ${c.name} with ${st.label} directly` : "on that question";
  return text.replace(clause, `; it comes up in ${hit.share.value} of the answers ${where}`);
}

function conditionsParas(c: Ctx): BriefPara[] {
  const k = c.inputs.conditions;
  if (!k) return [];
  // bf34: the card's rows when the What to buy card shows conditions; the walls line below either way.
  const fromCard = conditionsFromCard(c);
  const q = (g: { label: string }) => `"${condLabel(g.label)}"`;
  let toward = k.toward;
  let away = k.away;
  let towardCells = k.towardCells;
  let awayCells = k.awayCells;
  let towardBase = k.towardThemed ? k.towardBase ?? 0 : null;
  let awayBase = k.awayThemed ? k.awayBase ?? 0 : null;
  if (!c.isTarget) {
    // A rival's sides: the client's away side that sends buyers to it, and the client's own side.
    toward = k.away.filter((g) => g.routes[0]?.name === c.name);
    away = k.toward;
    towardCells = k.awayCells;
    awayCells = k.towardCells;
    [towardBase, awayBase] = [awayBase, towardBase];
  }
  const out: BriefPara[] = fromCard ?? [];
  const pin = cellsOf(c, CONDITION_CARD);
  const share = (g: { answers?: number; cells: number }, base: number | null, cells: number) =>
    base !== null ? pctN(base ? (g.answers ?? 0) / base : 0) : pctN(cells ? g.cells / cells : 0);
  const unit = (base: number | null) => (base !== null ? "answers" : "questions");
  const t = fromCard ? [] : toward.slice(0, 3);
  if (t.length)
    out.push(
      withCells(
        {
          lead: `Who it sends to ${c.name}.`,
          text: `Buyers who say ${listOf(t.map(q))} - the most common comes up in ${share(t[0], towardBase, towardCells ?? 0)} of the ${unit(towardBase)} that say when to choose it.`,
          tip: towardBase !== null ? t.map((g) => `${g.label}: ${g.answers ?? 0} of ${towardBase} answers`).join("; ") : t.map((g) => `${g.label}: ${g.rules} rules in ${g.cells} questions`).join("; "),
        },
        pin
      )
    );
  const a = fromCard ? [] : away.slice(0, 3);
  if (a.length) {
    const named = a.map((g) => {
      if (awayBase !== null && c.isTarget) {
        const d = destOf(g.routes, g.answers ?? 0);
        return d ? `${q(g)} (${destPhrase(d)})` : q(g);
      }
      return g.routes[0] ? `${q(g)} (to ${g.routes[0].name})` : q(g);
    });
    out.push(
      withCells(
        {
          lead: "Who it sends away.",
          text: `Buyers who say ${listOf(named)} - the most common comes up in ${share(a[0], awayBase, awayCells ?? 0)} of the ${unit(awayBase)} that say when to choose something else.`,
          tip: awayBase !== null ? a.map((g) => `${g.label}: ${g.answers ?? 0} of ${awayBase} answers`).join("; ") : a.map((g) => `${g.label}: ${g.rules} rules in ${g.cells} questions`).join("; "),
        },
        pin
      )
    );
  }
  if (c.isTarget) {
    const walls: string[] = [];
    // The finding's own fixed situation (the run-wide one) first, then each buying situation's.
    const fx = k.awayThemed && c.inputs.away ? awaySpecifics(c.summary, c.inputs.away).fixed : null;
    if (fx) walls.push(fx.label);
    for (const st of Object.values(c.stats)) if (st.wall && !walls.some((w) => norm(w) === norm(st.wall!))) walls.push(st.wall);
    if (walls.length)
      out.push(withCells({ lead: "Buyers no message moves.", text: `Buyers who say ${listOf(walls.slice(0, 3).map((w) => `"${condLabel(w)}"`))} are already where they are; no case for ${c.name} changes that.` }, pin));
  }
  return out;
}

/** Keys whose fact the verdict or the funnel paragraph already carries. */
const VERDICT_CARRIED = new Set(["funnel", "rival_open", "conversion_vs_rival"]);

/** now_what's numbered findings. Target: the served insights by effect,
 * engine kinds and verdict-carried facts skipped. Rival: composed facts. */
function findingsOf(c: Ctx): Ctx["findings"] {
  if (c.isTarget)
    return [...c.summary.insights]
      // A concentration in a rival's picks is not this brand's finding.
      .filter((i) => i.kind !== "engine" && !VERDICT_CARRIED.has(i.key) && !(i.key === "pick_concentration_question" && !i.title.includes("your")))
      // bf34: a finding whose figures no card shows is left out of the Brief.
      .filter((i) => c.voiced.get(i.key)?.body !== "")
      .sort((a, b) => b.effect - a.effect)
      .slice(0, 5)
      // bf26: the Brief's own rendering of the same finding (third person, buyers as words).
      .map((i) => {
        const v = c.voiced.get(i.key) ?? i;
        return { lead: leadOf(cap(v.title)), text: cap(quoteCardCondition(c, i, v.body)), tip: i.foot, key: i.key, cellIds: insightCells(c, i) };
      })
      // bf29: the hardest direct matchup and the lost-with-an-exception finding are one subject - one finding,
      // the matchup first, then the exception.
      .reduce<Ctx["findings"]>((acc, f) => {
        const pair = f.key === "assigned_exception" ? acc.find((x) => x.key === "rival_h2h") : f.key === "rival_h2h" ? acc.find((x) => x.key === "assigned_exception") : undefined;
        if (!pair) return [...acc, f];
        const [h, e] = f.key === "rival_h2h" ? [f, pair] : [pair, f];
        const merged = { lead: h.lead, text: `${h.text} ${e.text}`, tip: [h.tip, e.tip].filter(Boolean).join(" "), key: "rival_h2h", cellIds: [...new Set([...(h.cellIds ?? []), ...(e.cellIds ?? [])])] };
        return acc.map((x) => (x === pair ? merged : x));
      }, []);
  const out: Ctx["findings"] = [];
  const ranked = roomsByShare(c);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  if (best && best.share.k > 0)
    out.push({ key: "best_room", cellIds: [`chooses:open:${norm(best.r.room)}`], lead: "Its strongest situation.", text: `${c.name} does best with ${buyerPhrase(best.r.room)}: ${P(best.share)} of the picks there.`, tip: tipOf(best.share) });
  if (worst && worst.top)
    out.push({
      key: "worst_room",
      cellIds: [`chooses:open:${norm(worst.r.room)}`],
      lead: "Its weakest situation.",
      text: `Its weakest is ${buyerPhrase(worst.r.room)} - ${worst.share.k === 0 ? "none" : P(worst.share)} of the picks there, with ${worst.top.name} taking ${P(worst.top.share)}.`,
      tip: `${tipOf(worst.share)}; ${worst.top.name} ${worst.top.chosen}.`,
    });
  // bf34: the arguments as the What to buy card shows them (the rival's card there: when it picks the rival / the tracker).
  const { bestC, worstC } = argsOnCard(c);
  if (bestC)
    out.push({ key: "lift", cellIds: [OPEN_ALL], lead: "The argument it wins on.", text: `${bestC.f.name} is argued in ${bestC.f.here} of the answers that pick ${c.name}, against ${bestC.f.there} when ${c.brand} is picked.`, tip: `${tipOf(bestC.l.wins)}; ${tipOf(bestC.l.others)}.` });
  if (c.vsTarget && c.vsTarget.won.n >= MIN)
    out.push({
      key: "vs_target",
      cellIds: [rivalCell(c, c.subject.key)].filter((x): x is string => !!x),
      lead: `Against ${c.brand}.`,
      text:
        c.vsTarget.won.k === 0
          ? `Compared directly with ${c.brand}, the AI never sides with ${c.name} when it takes a side.`
          : c.vsTarget.won.k === c.vsTarget.won.n
            ? `Compared directly with ${c.brand}, the AI sides with ${c.name} every time it takes a side.`
            : `Compared directly with ${c.brand}, the AI sides with ${c.name} ${P(c.vsTarget.won)} of the time it takes a side.`,
      tip: tipOf(c.vsTarget.won),
    });
  if (worstC && (!bestC || worstC.l.code !== bestC.l.code))
    out.push({ key: "loss_arg", cellIds: [OPEN_ALL], lead: "The argument it loses on.", text: `${worstC.f.name} comes up in ${worstC.f.here} of the answers that pick ${c.brand} and ${worstC.f.there} of those that pick ${c.name}.`, tip: `${tipOf(worstC.l.wins)}; ${tipOf(worstC.l.others)}.` });
  return out.slice(0, 5);
}

/** bf27-bf29: the competitor columns of the tracker's own tables (the Now what scoreboard and the
 * funnel's stages) - ONE source, so the two tables can never disagree. The competitors are the ones the
 * what-to-buy card lists (class brands left out); named / recommended are the card's own average-competitor
 * steps, share of picks and picked the listed competitors' rows averaged; the most-picked competitor is the
 * listed one with the largest share. Null on a rival subject or when the card has no average competitor. */
interface CompCol {
  avg?: string;
  top?: string;
}
function competitorColumns(c: Ctx): { topName?: string; named: CompCol; rec: CompCol; share: CompCol; picked: CompCol } | null {
  if (!c.isTarget) return null;
  const pos = c.map.positions[OPEN_ALL];
  const listed = new Set(pos?.panel?.competitorOrder ?? []);
  if (!pos?.panel?.avgComp || listed.size < 2) return null;
  const step = (k: string) => pos.panel!.steps.find((x) => x.key === k)?.usual?.value;
  const comp = (pos.brands ?? []).filter((b) => listed.has(b.name));
  const num = (x?: string) => parseFloat((x ?? "").replace(/[^0-9.]/g, "")) || 0;
  const out: { topName?: string; named: CompCol; rec: CompCol; share: CompCol; picked: CompCol } = {
    named: { avg: step("named") },
    rec: { avg: step("recommended") },
    share: {},
    picked: {},
  };
  // bf32: the card's own figures (panel avgShare / avgPicked), so the scoreboard and the card can never disagree.
  out.share.avg = pos.panel.avgShare?.value;
  out.picked.avg = pos.panel.avgPicked?.value;
  const top = [...comp].sort((a, b) => num(b.share) - num(a.share))[0];
  const tr = top?.here?.read;
  if (top && tr) {
    out.topName = top.name;
    out.named.top = tr.named;
    out.rec.top = tr.recommended;
    out.share.top = top.share;
    out.picked.top = tr.picked;
  }
  return out;
}

function scoreboard(c: Ctx): BriefRow[] {
  const s = c.summary;
  const S = c.subject;
  // Each row pins the cell or card that states it (rowPin: the first candidate stating every number).
  const at = (row: BriefRow, ...ids: (string | null | undefined)[]): BriefRow => rowPin(c, row, ...ids);
  const own = subjectPins(c);
  const rows: BriefRow[] = [
    at({ label: "Named when buyers ask what to buy", value: P(S.mentioned), tip: tipOf(S.mentioned) }, ...own),
    at({ label: "Recommended", value: P(S.recommended), tip: tipOf(S.recommended) }, ...own),
    at({ label: `The AI commits to one ${c.product}`, value: P(s.firmPickInCategory), tip: tipOf(s.firmPickInCategory) }, OPEN_ALL),
    at({ label: "Share of picks", value: P(S.shareOfDecided), tip: tipOf(S.shareOfDecided) }, ...own),
    at({ label: "Picked, of all answers", value: pctFine(rate(S.chosen)), tip: tipOf(S.chosen) }, ...own),
  ];
  let vs = false;
  // bf27 / bf28: the average and the most-picked competitor beside the subject's four numbers
  // (competitorColumns - one source with the funnel's stage table); the commit rate is a sentence.
  const cc = competitorColumns(c);
  if (cc) {
    const put = (r: BriefRow, x: { avg?: string; top?: string }) => {
      if (x.avg !== undefined) r.avg = x.avg;
      if (x.top !== undefined) r.top = x.top;
    };
    put(rows[0], cc.named);
    put(rows[1], cc.rec);
    put(rows[3], cc.share);
    put(rows[4], cc.picked);
    for (const i of [0, 1, 3, 4]) rows[i].kind = "vs";
    rows[0].label = "Named";
    rows[0].heads = { subject: c.name, ...(cc.topName ? { top: cc.topName } : {}) };
    rows[2] = { ...rows[2], kind: "note", label: `The AI commits to one ${c.product} in ${rows[2].value} of answers.` };
    vs = true;
  }
  const leader = s.brands.find((b) => b.key !== S.key && b.chosen.k > 0);
  if (leader && !vs) rows.push(at({ label: `Share of picks - ${leader.name}`, value: P(leader.shareOfDecided), tip: tipOf(leader.shareOfDecided) }, OPEN_ALL, brandPin(c, leader.key)));
  if (c.isTarget) {
    const won = s.headToHead.reduce((a, r) => a + r.won.k, 0);
    const lost = s.headToHead.reduce((a, r) => a + r.lost.k, 0);
    if (won + lost >= MIN) {
      const pooled = cell(won, won + lost);
      rows.push(at({ label: "Direct matchups won", value: P(pooled), tip: `${tipOf(pooled)} matchups that pick one of the two` }, pooledOf(c, "fights:h2h:")));
    }
    if (s.buyersDoubt && s.buyersDoubt.answers >= MIN)
      rows.push(at({ label: "Buyers with a worry told to go ahead", value: P(s.buyersDoubt.proceed), tip: tipOf(s.buyersDoubt.proceed) }, pooledOf(c, "doubts:buyers:")));
    if (s.customersDoubt && s.customersDoubt.answers >= MIN)
      rows.push(at({ label: "Customers with a worry told to stay", value: P(s.customersDoubt.keep), tip: tipOf(s.customersDoubt.keep) }, pooledOf(c, "doubts:customers:")));
    const v = c.inputs.value;
    if (v && v.answers >= MIN) rows.push(at({ label: "Judged worth the price", value: P(v.worth.yes), tip: tipOf(v.worth.yes) }, pooledOf(c, "chooses:value:")));
  } else if (c.vsTarget && c.vsTarget.won.n >= MIN) {
    rows.push(at({ label: `Direct matchups won against ${c.brand}`, value: P(c.vsTarget.won), tip: tipOf(c.vsTarget.won) }, rivalCell(c, c.subject.key)));
  }
  return rows;
}

const leadOf = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** bf29 (Tyler): moves that share one action are ONE move - its lead names every place it applies to
 * (three named, then "and N more"), the action is said once, and one "Watch:" line (the first place's). A move
 * is never reduced to a back-reference. Groups keep the order of their first move. */
interface MoveGroup {
  moves: Move[];
  /** The places, as one lead ("Dining and going out, against Chase and 2 more"). */
  lead: string;
  first: Move;
}
function groupMoves(c: Ctx, moves: Move[]): MoveGroup[] {
  const byAct = new Map<string, Move[]>();
  for (const m of moves) {
    const k = m.actStem;
    byAct.set(k, [...(byAct.get(k) ?? []), m]);
  }
  return [...byAct.values()].map((ms) => {
    if (ms.length === 1) return { moves: ms, first: ms[0], lead: cap(placeOf(c, ms[0])) };
    // Several places: a plain list in the cards' words, never cell labels joined by dashes.
    const names = ms.map((m) => placeOf(c, m));
    const shown = names.slice(0, 3);
    const more = names.length - shown.length;
    return { moves: ms, first: ms[0], lead: cap(more > 0 ? `${shown.join(", ")} and ${more} more` : listOf(shown)) };
  });
}

/** A move's place in the cards' words, for a merged lead ("the buyer in "X"", "the worry "Y"", "the Gold Card for
 * the everyday spender", "the matchup against Z"). */
function placeOf(c: Ctx, m: Move): string {
  const B = buyerPhrase;
  switch (m.row) {
    case "open":
      return m.label ? B(m.label) : "buyers asking what to buy";
    case "value": {
      const [room, line] = m.label.includes(" - ") ? m.label.split(" - ") : [m.label, ""];
      const what = line ? theProduct(line, c.brand, COMMON_WORDS) : c.brand;
      return room ? `${what} for ${B(room)}` : what;
    }
    case "buyers":
      return `the buyer worry "${m.label}"`;
    case "customers":
      return `the customer worry "${m.label}"`;
    case "h2h":
      return `the matchup against ${m.label}`;
    case "leavers":
      return m.label ? `${poss(m.label)} customers looking to switch` : "rival customers looking to switch";
    case "criteria":
      return m.label ? `what ${B(m.label)} is told to look for` : "what buyers are told to look for";
    case "awareness":
      return m.label ? `the problem questions of ${B(m.label)}` : "problem questions";
    case "hold":
      return `${poss(c.brand)} own customers looking around`;
    case "social":
      return "buyers asking what most people pick";
    case "explainer":
      return "buyers learning the category";
    case "premium":
      return "buyers weighing premium against basic";
    case "repertoire":
      return "habit buyers";
    case "settled":
      return `${poss(c.brand)} customers on "${cellNameAbout(m.label, c.brand)}"`;
    default:
      return low1(m.lead);
  }
}

function movePara(c: Ctx, g: MoveGroup): BriefPara {
  const m = g.first;
  const claims = g.moves.slice(0, 3).map((x) => sentence(x.claim)).join(" ");
  // One place: its own move sentence. Several: the shared action once (a finding's sentence on one of them would
  // speak about that place only).
  // bf29: a move always carries an action - a single move without a lever sentence states its own act.
  const act = g.moves.length === 1 ? m.lever || sentence(cap(m.act)) : `${cap(m.actStem)} in each of these.`;
  return withCells({ lead: leadOf(g.lead), text: `${claims}${act ? ` ${act}` : ""} Watch: ${m.watch}.`, tip: g.moves.map((x) => x.tip).join(" ") }, cellsOf(c, ...g.moves.map((x) => x.cellId)));
}

function nowWhat(c: Ctx): BriefSection[] {
  const out: BriefSection[] = [
    { key: "verdict", heading: "The verdict", paras: [verdictPara(c)] },
    { key: "scoreboard", heading: "The scoreboard", rows: scoreboard(c) },
    { key: "funnel_breaks", paras: [funnelBreaks(c)] },
  ];
  if (c.findings.length)
    out.push({ key: "findings", heading: "What matters this wave", paras: c.findings.map((f, i) => withCells({ lead: `${i + 1}. ${f.lead}`, text: f.text, ...(f.tip ? { tip: f.tip } : {}) }, cellsOf(c, ...(f.cellIds ?? [])))) });
  const cond = conditionsParas(c);
  if (cond.length) out.push({ key: "conditions", heading: "The conditions that decide it", paras: cond });
  if (c.isTarget)
    out.push({
      key: "moves",
      heading: "What to do",
      paras: c.moves.length
        ? groupMoves(c, c.moves).map((g) => movePara(c, g))
        : [{ text: `No buying situation, matchup or worry is lost by a clear margin in this wave - the job is to keep the standing current.` }],
    });
  return out;
}

/* ----------------------------------- SWOT ---------------------------------- */

/** An insight's direction for the keys that fire both ways (strength or threat). */
function insightIsStrength(i: Insight): boolean {
  if (i.key === "conversion_vs_rival") return i.title.startsWith("You turn");
  if (i.key === "leaver_capture") return i.title === "Rivals' customers come to you";
  if (i.key === "rival_open") return i.title.startsWith("You lead");
  return false;
}

/** bf34: the Value card's "Where it points the buyer instead" figures (shares of all the card's answers):
 * a rival, only the brand's own cheaper option (a brand with a ladder of lines), nowhere. */
function valueInstead(c: Ctx, cellId: string | undefined): { rival: PanelNum; own?: PanelNum; nowhere?: PanelNum } | null {
  const st = cellId ? c.map.positions[cellId]?.panel?.steps.find((x) => x.key === "instead") : undefined;
  const seg = (k: string) => st?.segments?.find((x) => x.key === k)?.num;
  const rival = seg("rival");
  return rival ? { rival, own: seg("own"), nowhere: seg("nowhere") } : null;
}
/** The Value card's instead figures as one sentence: "It points the buyer to a rival instead in X% of answers and
 * to only <brand>'s own cheaper option in Y%." (never at zero). */
function valueInsteadText(c: Ctx, vi: NonNullable<ReturnType<typeof valueInstead>>): string {
  const riv = vi.rival.pct === 0 ? "never points the buyer to a rival instead" : `points the buyer to a rival instead in ${vi.rival.value} of answers`;
  const own = vi.own ? (vi.own.pct === 0 ? ` and never to only ${poss(c.brand)} own cheaper option` : ` and to only ${poss(c.brand)} own cheaper option in ${vi.own.value}`) : "";
  return `The AI ${riv}${own}.`;
}

/** bf34: the strongest winning and losing arguments (lift test passed) that the What to buy card shows,
 * with the card's figures (cardArgOf). */
function argsOnCard(c: Ctx) {
  const argOf = (code: string, side: "subject" | "other") => cardArgOf(c.map, c.isTarget, c.name, code, side);
  const bestC = c.lift.filter((l) => l.lift > 0 && l.wins.low > l.others.high).map((l) => ({ l, f: argOf(l.code, "subject")! })).find((x) => x.f);
  const worstC = [...c.lift].reverse().filter((l) => l.lift < 0 && l.others.low > l.wins.high).map((l) => ({ l, f: argOf(l.code, "other")! })).find((x) => x.f);
  return { bestC, worstC };
}

/** bf29: a SWOT item - a short lead (a template per kind, no numbers), one sentence, and the fact it states
 * (`fact`: one fact, one quadrant - the check in swotOf). */
interface SwotItem extends Item {
  lead: string;
  fact: string;
}

function fromInsight(c: Ctx, i: Insight, lead: string): SwotItem | null {
  // bf34: a finding whose figures no card shows is left out of the Brief.
  if (c.voiced.get(i.key)?.body === "") return null;
  const ids = insightCells(c, i);
  const v = c.voiced.get(i.key) ?? i;
  return { lead, text: quoteCardCondition(c, i, v.body), tip: i.foot, kind: i.kind, effect: i.effect, cellId: ids[0], cellIds: ids, fact: `insight:${i.key}` };
}

/** The recommended-to-picked step (the funnel's break), in the scoreboard's share-of-picks words. */
function funnelBreak(c: Ctx): SwotItem | null {
  const S = c.subject;
  if (S.recommended.k < MIN) return null;
  const conv = S.chosen.k / S.recommended.k;
  const drop = rate(S.recommended) - rate(S.chosen);
  // A weakness only when some rival turns more of its recommendations into picks.
  const better = c.summary.brands.some((b) => b.key !== S.key && b.recommended.k >= MIN && b.chosen.k / b.recommended.k > conv);
  if (drop <= 0 || !better) return null;
  return {
    lead: "Recommendations that do not close",
    text: `${c.name} is recommended in ${P(S.recommended)} of answers and takes ${P(S.shareOfDecided)} of the picks; ${conv === 0 ? "none" : pctN(conv)} of the answers that recommend it end with it as the pick.`,
    tip: `${S.chosen.k} picks of ${S.recommended.k} recommendations.`,
    kind: "funnel",
    effect: drop,
    cellId: OPEN_ALL,
    cellIds: subjectPins(c),
    fact: "funnel",
  };
}

function capList<T extends SwotItem>(items: T[], n = 4): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const i of [...items].sort((a, b) => b.effect - a.effect)) {
    if (out.length >= n) break;
    // One item per lead (kind) in a quadrant, so one kind never fills it.
    if (seen.has(i.text) || seen.has(i.fact) || seen.has(`lead:${i.lead}`)) continue;
    seen.add(i.text);
    seen.add(i.fact);
    seen.add(`lead:${i.lead}`);
    out.push(i);
  }
  return out;
}

interface Swot {
  s: SwotItem[];
  w: SwotItem[];
  o: SwotItem[];
  t: SwotItem[];
}

/** The customers-looking-around item is a threat only when the AI tells at least this share of them to leave. */
const HOLD_LEAVE_BAR = 0.2;

/**
 * bf29 (Tyler): the SWOT fills each quadrant by the KIND of fact -
 *  Strengths: what the AI already does for the subject (a matchup it wins, an argument that comes up more
 *    when it is picked, a buyer it is judged worth it for, a situation it leads, rivals' customers it takes);
 *    a worry the AI defends it on is never a strength (the standing ruling);
 *  Weaknesses: where the AI goes against it today (the recommended-to-picked step, the price verdict,
 *    matchups it loses, an argument that comes up more when a rival is picked, a worry it agrees with);
 *  Opportunities: openings not yet taken, stated with their numbers and no instruction (a winning argument
 *    the AI seldom tells buyers to look for, the nearest buying situation, switchers who hear its name, a lost
 *    matchup that still carries a case for it);
 *  Threats: what could take more (the leading rival, what sends buyers away and to whom, fixed situations,
 *    price doubts that name a rival, a rival carried by one AI company, more).
 * One fact, one quadrant (the winning argument may sit under Strengths and, when it is seldom taught, under
 * Opportunities - never under Weaknesses); four items a quadrant, strongest first. The moves go to "What to do".
 */
function swotOf(c: Ctx): Swot {
  const S = c.subject;
  const s: SwotItem[] = [];
  const w: SwotItem[] = [];
  const o: SwotItem[] = [];
  const t: SwotItem[] = [];
  const argPin = c.isTarget ? OPEN_ALL : BRAND_CARD(S.key);
  // bf34: the arguments the What to buy card shows on each side, with the card's own figures (the strongest
  // that clears the lift test and is on the card; one outside the card's rows is never cited).
  const otherWho = c.isTarget ? "a rival" : c.brand;
  const { bestC, worstC } = argsOnCard(c);
  const best = bestC?.l as (typeof c.lift)[number];
  const worst = worstC?.l;
  const bestWins = !!bestC;
  if (bestC)
    s.push({
      lead: "An argument that wins for it",
      text: `${bestC.f!.name} comes up more when ${c.name} wins - argued in ${bestC.f!.here} of the answers that pick ${c.name} and ${bestC.f!.there} of those that pick ${otherWho}.`,
      tip: `${tipOf(best.wins)} wins; ${tipOf(best.others)} other picks.`,
      kind: "argument",
      effect: best.lift,
      cellId: argPin,
      fact: `arg:${best.code}`,
    });
  if (worstC && worst && (!bestWins || worst.code !== best.code))
    w.push({
      lead: c.isTarget ? "An argument that favors rivals" : `An argument that favors ${c.brand}`,
      text: `${worstC.f!.name} shows up when ${c.isTarget ? "another brand" : c.brand} is picked - argued in ${worstC.f!.here} of those answers and ${worstC.f!.there} of the answers that pick ${c.name}.`,
      tip: `${tipOf(worst.wins)} wins; ${tipOf(worst.others)} other picks.`,
      kind: "argument",
      effect: -worst.lift,
      cellId: argPin,
      fact: `arg:${worst.code}`,
    });
  const fb = funnelBreak(c);
  if (fb) w.push(fb);
  // The winning argument as an opening, when the AI seldom tells buyers to look for it (a second fact about it).
  if (bestWins && c.inputs.taught.length >= 5 && !c.inputs.taught.slice(0, 5).some((x) => norm(x.code) === norm(best.code)))
    o.push({
      lead: "An untaught winning argument",
      text: `When buyers ask what to look for, ${bestC!.f!.name.toLowerCase()} is not among the five points the AI raises most - though it is argued in ${bestC!.f!.here} of the answers that pick ${c.name}.`,
      tip: `${tipOf(best.wins)} wins.`,
      kind: "argument",
      effect: best.lift,
      cellId: argPin,
      cellIds: [argPin, ...(pooledOf(c, "chooses:criteria:") ? [pooledOf(c, "chooses:criteria:")!] : [])],
      fact: `arg-untaught:${best.code}`,
    });
  // Buying situations: the ones it leads (strength), the nearest one it does not (opening).
  const stands = roomStands(c);
  for (const x of stands.filter((y) => y.owns).slice(0, 2))
    s.push({
      lead: "A buying situation it leads",
      text: `For ${buyerPhrase(x.r.room)}, ${c.name} takes ${P(x.mine)} of the picks - more than any other brand.`,
      tip: `${tipOf(x.mine)} picks.`,
      kind: "room",
      effect: -x.gap,
      cellId: `chooses:open:${norm(x.r.room)}`,
      fact: `room:${x.r.room}`,
    });
  // An opening only where the subject trails within the near bar (nearStand) and it is not its worst situation;
  // the worst one, trailing badly, is a lost situation (a weakness).
  const worstStand = stands.length >= 2 ? stands[stands.length - 1] : undefined;
  const near = stands.find((y) => !y.owns && y.leader && nearStand(y) && y !== worstStand);
  if (worstStand && !worstStand.owns && worstStand.leader && !nearStand(worstStand))
    w.push({
      lead: "A buying situation it loses",
      text: `For ${buyerPhrase(worstStand.r.room)}, ${worstStand.leader.name} takes ${P(worstStand.leader.share)} of the picks and ${c.name} ${worstStand.mine.k === 0 ? "none" : P(worstStand.mine)}.`,
      tip: `${tipOf(worstStand.mine)} picks; ${worstStand.leader.name} ${worstStand.leader.chosen}.`,
      kind: "room",
      effect: worstStand.gap,
      cellId: `chooses:open:${norm(worstStand.r.room)}`,
      fact: `room:${worstStand.r.room}`,
    });
  if (near)
    o.push({
      lead: "The nearest buying situation",
      text: `${cap(buyerPhrase(near.r.room))} is the buying situation where ${c.name} comes closest to the leader: ${near.mine.k === 0 ? "none" : P(near.mine)} of the picks there against ${P(near.leader!.share)} for ${near.leader!.name}.`,
      tip: `${tipOf(near.mine)} picks; ${near.leader!.name} ${near.leader!.chosen}.`,
      kind: "room",
      effect: 0.5 - near.gap,
      cellId: `chooses:open:${norm(near.r.room)}`,
      fact: `room:${near.r.room}`,
    });

  if (c.isTarget) {
    const sm = c.summary;
    // Matchups: won (strength), lost (weakness), lost with a case still stated (opening).
    for (const r of sm.headToHead) {
      if (r.winOfDecided.n < MIN) continue;
      const id = rivalCell(c, r.key);
      if (r.winOfDecided.low > 0.5)
        s.push({
          lead: "A matchup it wins",
          text: `Asked to compare ${c.brand} with ${r.rival} directly, the AI picks ${c.brand} ${r.winOfDecided.k === r.winOfDecided.n ? "every time it picks one of them" : `${P(r.winOfDecided)} of the time it picks one of them`}.`,
          tip: `Won ${r.won.k}, lost ${r.lost.k}.`,
          kind: "rival",
          row: "h2h",
          effect: rate(r.winOfDecided) - 0.5,
          cellId: id,
          fact: `h2h:${r.key}`,
        });
      else if (r.winOfDecided.high < 0.5) {
        const ex = id ? c.map.positions[id]?.exception : undefined;
        if (ex && ex.rows.length)
          o.push({
            lead: "A lost matchup with a case left",
            text: `${r.rival} wins the direct comparison with ${c.brand}, yet most of the answers that pick ${r.rival} still say when to choose ${c.brand} - most often "${condLabel(ex.rows[0].text)}".`,
            tip: ex.tip,
            kind: "rival",
            row: "h2h",
            effect: 0.5 - rate(r.winOfDecided),
            cellId: id,
            fact: `h2h:${r.key}`,
          });
        else
          w.push({
            lead: "A matchup it loses",
            text: `Asked to compare ${c.brand} with ${r.rival} directly, the AI ${r.winOfDecided.k === 0 ? `never picks ${c.brand} when it picks one of the two` : `picks ${c.brand} ${P(r.winOfDecided)} of the time it picks one of them`}.`,
            tip: `Won ${r.won.k}, lost ${r.lost.k}.`,
            kind: "rival",
            row: "h2h",
            effect: 0.5 - rate(r.winOfDecided),
            cellId: id,
            fact: `h2h:${r.key}`,
          });
      }
    }
    // Value: the overall verdict (weakness), a buyer it is judged worth it for (strength, the worth-it side only),
    // the doubts that name a rival (threat).
    const v = c.inputs.value;
    if (v && v.answers >= MIN) {
      const what = v.lines.length === 1 ? theProduct(v.lines[0].label, c.brand, COMMON_WORDS) : c.brand;
      if (rate(v.worth.no) >= rate(v.worth.yes) && v.worth.no.k > 0)
        w.push({
          lead: "The price verdict",
          text: v.worth.yes.k === 0 ? `${cap(what)} is judged not worth it over a cheaper option in ${P(v.worth.no)} of answers and never worth it.` : `${cap(what)} is judged not worth it over a cheaper option in ${P(v.worth.no)} of answers and worth it in ${P(v.worth.yes)}.`,
          tip: `No ${tipOf(v.worth.no)}; yes ${tipOf(v.worth.yes)}.`,
          kind: "value",
          effect: rate(v.worth.no) - rate(v.worth.yes),
          cellId: pooledOf(c, "chooses:value:"),
          fact: "value",
        });
      const good = v.rooms.filter((r) => r.answers >= MIN && r.rooms.length === 1 && rate(r.worth.yes) > rate(r.worth.no) && rate(r.worth.yes) >= 0.25).sort((a, b) => rate(b.worth.yes) - rate(a.worth.yes))[0];
      if (good)
        s.push({
          lead: "A buyer it is worth it for",
          text: `For ${buyerPhrase(good.rooms[0])}, the AI calls ${good.line ? theProduct(good.line, c.brand, COMMON_WORDS) : c.brand} worth paying more for in ${good.worth.yes.k === good.worth.yes.n ? "every answer" : `${P(good.worth.yes)} of answers`}.`,
          tip: tipOf(good.worth.yes),
          kind: "value",
          effect: rate(good.worth.yes) - rate(good.worth.no),
          cellId: `chooses:value:${norm(good.rooms[0])}`,
          fact: `value-room:${good.rooms[0]}`,
        });
      const rival = v.instead.find((x) => !x.own);
      // bf34: the Value card's own figure (a share of all its answers), not a share of the doubts.
      const vi = valueInstead(c, pooledOf(c, "chooses:value:"));
      if (vi && vi.rival.pct >= 20 && rival)
        t.push({
          lead: "Price answers that name a rival",
          text: `Asked whether ${c.brand} is worth paying more for, the AI points the buyer to a rival instead in ${vi.rival.value} of answers. The rival it names most often is ${rival.name}.`,
          tip: vi.rival.tip,
          kind: "value",
          effect: vi.rival.pct / 100,
          cellId: pooledOf(c, "chooses:value:"),
          fact: "value-instead",
        });
    }
    // Switchers: rivals' customers it takes (strength), switchers who hear its name but pick elsewhere (opening).
    const off = c.inputs.alternatives?.offensive;
    for (const r of off?.rows ?? []) {
      if (r.key === "generic" || r.answers < MIN) continue;
      const id = Object.entries(c.stats).find(([, st]) => st.row === "leavers" && st.rivalKey === r.key)?.[0];
      if (rate(r.captured) >= 0.3)
        s.push({
          lead: "Rivals' customers it takes",
          text: `When ${poss(r.rival)} customers ask what to switch to, the AI picks ${c.brand} in ${P(r.captured)} of answers.`,
          tip: tipOf(r.captured),
          kind: "leavers",
          effect: rate(r.captured),
          cellId: id,
          fact: `leavers:${r.key}`,
        });
      else if (rate(r.named) >= 0.5 && rate(r.captured) < 0.1)
        o.push({
          lead: "Switchers who hear its name",
          text: `${poss(r.rival)} customers looking to switch hear ${c.brand} named in ${r.named.k === r.named.n ? "every answer" : `${P(r.named)} of answers`}, yet it is the pick in ${r.captured.k === 0 ? "none of them" : P(r.captured)}.`,
          tip: `${tipOf(r.named)} named; ${tipOf(r.captured)} picked.`,
          kind: "leavers",
          effect: rate(r.named) - rate(r.captured),
          cellId: id,
          fact: `leavers:${r.key}`,
        });
    }
    // Threats: the leading rival.
    const leader = sm.brands.find((b) => b.key !== c.subject.key && b.chosen.k > 0);
    if (leader && sm.firmPickInCategory.k >= MIN && rate(leader.shareOfDecided) > rate(S.shareOfDecided))
      t.push({
        lead: "The leading rival",
        text: `${leader.name} takes ${P(leader.shareOfDecided)} of the picks when buyers ask what to buy, against ${P(S.shareOfDecided)} for ${c.brand}.`,
        tip: `${leader.chosen.k} picks to ${S.chosen.k}.`,
        kind: "rival",
        effect: rate(leader.shareOfDecided) - rate(S.shareOfDecided),
        cellId: OPEN_ALL,
        cellIds: [OPEN_ALL, BRAND_CARD(leader.key)],
        fact: "leader",
      });
    // Fixed situations on the pick-shaped cells (a Value or worry cell's sides are not picks), one per wording.
    const wallSeen = new Set<string>();
    for (const [cellId, st] of Object.entries(c.stats))
      if (st.wall && st.d >= MIN && ["open", "social", "premium", "h2h", "leavers"].includes(st.row) && !wallSeen.has(norm(st.wall)) && wallSeen.add(norm(st.wall)))
        t.push({
          lead: "A fixed situation",
          text: `${st.row === "h2h" ? `Against ${st.label}` : st.label && !st.pooled ? `For ${buyerPhrase(st.label)}` : "Across every buying situation"}, buyers who say "${condLabel(st.wall)}" are sent elsewhere while ${st.taker} ${st.them === st.d ? "takes every pick there" : `takes ${pctN(st.them / st.d)} of the picks there`}.`,
          tip: `${st.them} of ${st.d} answers that take a side go to ${st.taker}.`,
          kind: "wall",
          effect: st.them / st.d - st.you / st.d,
          cellId,
          fact: `wall:${norm(st.wall)}`,
        });
    // A rival carried by one AI company: a threat wherever buyers use that company's assistants.
    const conc = c.ranked.find((i) => i.key === "engine_pick_concentration" && i.names?.rival && i.names?.vendor && i.names.rival !== c.brand);
    if (conc) {
      const nums = (c.voiced.get(conc.key)?.body ?? conc.body).match(/<1%|\d+(?:\.\d+)?%/g) ?? [];
      if (nums.length >= 2) {
        const ids = insightCells(c, conc);
        t.push({
          lead: "A rival one AI company carries",
          text: `${conc.names!.vendor}'s assistants pick ${conc.names!.rival} far more often than the others do - they supply ${nums[0]} of its picks while answering ${nums[1]} of the questions - so ${conc.names!.rival} is picked more wherever buyers use them.`,
          tip: conc.foot,
          kind: "engine",
          effect: conc.effect,
          cellId: ids[0],
          cellIds: ids,
          fact: "insight:engine_pick_concentration",
        });
      }
    }
    // Customers looking around: a threat only when the AI tells enough of them to leave.
    const dfn = c.inputs.alternatives?.defensive;
    if (dfn && dfn.answers >= MIN && rate(dfn.verdicts.leave) >= HOLD_LEAVE_BAR)
      t.push({
        lead: "Its own customers told to leave",
        text: `When ${poss(c.brand)} own customers ask what else to consider, the AI tells them to leave in ${P(dfn.verdicts.leave)} of answers.`,
        tip: tipOf(dfn.verdicts.leave),
        kind: "hold",
        effect: rate(dfn.verdicts.leave),
        cellId: pooledOf(c, "doubts:hold:"),
        fact: "hold",
      });
    // The ranked detectors, by kind: what sends buyers away and the others that could take more (threats);
    // a worry the AI agrees with (weakness).
    const used = new Set(c.findings.map((f) => f.key));
    // What sends buyers away, in this frame's own sentence (the finding's sentence may be quoted elsewhere).
    const away = c.inputs.away;
    const alead = away?.lead && !isDefaultCondition(away.lead.label) ? away.lead : null;
    const ag = alead ?? away?.groups.find((x) => !isDefaultCondition(x.label));
    const awayIns = c.ranked.find((i) => i.key === "away_condition");
    if (ag && awayIns) {
      const d = destOf(ag.routes, alead ? alead.answers : (ag as { answers: number }).answers);
      t.push({
        lead: "What sends buyers away",
        text: `The AI most often sends buyers away from ${c.brand} when they say "${condLabel(alead ? alead.wording : ag.label)}"${d ? `, ${destPhrase(d)}` : ""}.`,
        kind: "condition",
        effect: awayIns.effect,
        cellId: CONDITION_CARD,
        fact: "insight:away_condition",
      });
    }
    const THREAT_LEADS: Record<string, string> = {
      leak_picks: "Picks leaving the category",
      leak_problem: "Problem questions answered elsewhere",
      worst_worry: "The worry that loses customers",
      leave_no_exit: "Customers told to leave",
      neutralized_differentiator: "A differentiator rivals share",
    };
    const WEAK_LEADS: Record<string, string> = { doubt_worry: "A worry it agrees with", agreed_yet_stay: "Worries it agrees with" };
    for (const i of c.ranked) {
      if (used.has(i.key)) continue;
      const it = THREAT_LEADS[i.key] ? fromInsight(c, i, THREAT_LEADS[i.key]) : WEAK_LEADS[i.key] ? fromInsight(c, i, WEAK_LEADS[i.key]) : i.key === "conversion_vs_rival" && !insightIsStrength(i) ? fromInsight(c, i, "A rival that closes better") : null;
      if (it) (WEAK_LEADS[i.key] ? w : t).push(it);
    }
  } else {
    // Rival subject: its matchup with the target, the leading brand.
    if (c.vsTarget && c.vsTarget.won.n >= MIN) {
      const v = c.vsTarget.won;
      const item: SwotItem = {
        lead: v.low > 0.5 ? "It wins against the tracker" : `${c.brand} wins between the two`,
        text: `Asked to compare ${c.name} with ${c.brand} directly, the AI picks ${c.name} ${v.k === 0 ? "none of the time" : v.k === v.n ? "every time it picks one of them" : `${P(v)} of the time it picks one of them`}.`,
        tip: tipOf(v),
        kind: "rival",
        effect: Math.abs(rate(v) - 0.5),
        cellId: rivalCell(c, S.key),
        fact: "vs-target",
      };
      if (v.low > 0.5) s.push({ ...item, lead: `A matchup it wins` });
      else if (v.high < 0.5) t.push({ ...item, lead: `${poss(c.brand)} edge` });
    }
    const leader = c.summary.brands.find((b) => b.key !== S.key && b.chosen.k > 0);
    if (leader && rate(leader.shareOfDecided) > rate(S.shareOfDecided))
      t.push({
        lead: "The leading brand",
        text: `${leader.name} takes ${P(leader.shareOfDecided)} of the picks when buyers ask what to buy, against ${P(S.shareOfDecided)} for ${c.name}.`,
        tip: `${leader.chosen.k} picks to ${S.chosen.k}.`,
        kind: "rival",
        effect: rate(leader.shareOfDecided) - rate(S.shareOfDecided),
        cellId: OPEN_ALL,
        cellIds: [OPEN_ALL, brandPin(c, leader.key), BRAND_CARD(S.key)],
        fact: "leader",
      });
    // Its weakest buying situation against the leader there.
    const weak = stands.filter((y) => !y.owns && y.leader).slice(-1)[0];
    if (weak && weak !== near)
      w.push({
        lead: "Its weakest buying situation",
        text: `For ${buyerPhrase(weak.r.room)}, ${c.name} takes ${weak.mine.k === 0 ? "none" : `only ${P(weak.mine)}`} of the picks - ${weak.leader!.name} takes ${P(weak.leader!.share)}.`,
        tip: `${tipOf(weak.mine)} picks.`,
        kind: "room",
        effect: weak.gap,
        cellId: `chooses:open:${norm(weak.r.room)}`,
        fact: `room:${weak.r.room}`,
      });
  }
  // One fact, one quadrant: a fact already placed in an earlier quadrant (Strengths, then Weaknesses,
  // Opportunities, Threats) never repeats in a later one.
  const S1 = capList(s);
  const taken = new Set(S1.map((x) => x.fact));
  const W1 = capList(w.filter((x) => !taken.has(x.fact)));
  W1.forEach((x) => taken.add(x.fact));
  const O1 = capList(o.filter((x) => !taken.has(x.fact)));
  O1.forEach((x) => taken.add(x.fact));
  const T1 = capList(t.filter((x) => !taken.has(x.fact)));
  return { s: S1, w: W1, o: O1, t: T1 };
}

const asParas = (c: Ctx, items: SwotItem[], empty: string): BriefPara[] =>
  items.length ? items.map((i) => withCells({ lead: leadOf(i.lead), text: i.text, ...(i.tip ? { tip: i.tip } : {}) }, cellsOf(c, ...(i.cellIds ?? [i.cellId])))) : [{ text: empty }];

function swotFrame(c: Ctx, sw: Swot): BriefSection[] {
  const quads: BriefQuad[] = [
    {
      headers: ["Strengths", "Weaknesses"],
      cells: [asParas(c, sw.s, "Nothing stands out as a strength outside the noise in this wave."), asParas(c, sw.w, "Nothing stands out as a weakness outside the noise in this wave.")],
    },
    {
      headers: ["Opportunities", "Threats"],
      cells: [asParas(c, sw.o, "No opening clears the noise in this wave."), asParas(c, sw.t, "No threat clears the noise in this wave.")],
    },
  ];
  const out: BriefSection[] = [
    {
      key: "standing",
      paras: [withCells({ text: `Where ${c.name} stands on this wave: named in ${P(c.subject.mentioned)} of answers, and ${P(c.subject.shareOfDecided)} of the picks when the AI commits to one ${c.product}.`, tip: `${tipOf(c.subject.mentioned)}; ${tipOf(c.subject.shareOfDecided)}.` }, cellsOf(c, ...subjectPins(c)))],
    },
    { key: "swot", quads },
  ];
  // What to do: at most three moves, one per action (groupMoves).
  if (c.isTarget && c.moves.length)
    out.push({
      key: "swot_do",
      heading: "What to do",
      paras: groupMoves(c, c.moves)
        .slice(0, 3)
        .map((g) => withCells({ lead: leadOf(g.lead), text: g.moves.length === 1 ? `${cap(g.first.act)}; watch ${g.first.watch}.` : `${cap(g.first.actStem)} in each of these; watch ${g.first.watch} first.` }, cellsAt(c, [g.first.cellId, g.first.watch]))),
    });
  return out;
}

/* ---------------------------------- Funnel --------------------------------- */

function funnelFrame(c: Ctx): BriefSection[] {
  const S = c.subject;
  const s = c.summary;
  const named = rate(S.mentioned);
  const rec = rate(S.recommended);
  const picked = rate(S.chosen);
  const d1 = named - rec;
  const d2 = rec - picked;
  // One word for the middle stage everywhere: "Recommended" (the scoreboard's
  // and the views' term) - a second name reads as a second metric.
  const L = { named: "In the conversation", rec: "Recommended", pick: `The ${c.product} to get`, kept: "Customers with a worry told to stay" };
  // Share of picks is the lead pick number everywhere; the all-answers rate exists only inside
  // this ladder (the stages must share a denominator) and never without the bridge beside it.
  const ofPicks = s.firmPickInCategory.k >= MIN ? `${P(S.shareOfDecided)} of picks` : "";
  const stagesText = `named in ${P(S.mentioned)}, recommended in ${P(S.recommended)}, picked in ${pctFine(picked)} of answers${ofPicks ? ` (${ofPicks})` : ""}`;
  const oneStage = d1 > 0 && d2 > 0 && Math.max(d1, d2) >= 2 * Math.min(d1, d2);
  let thesis: string;
  if (oneStage)
    thesis = d1 > d2 ? `${c.name} loses exactly one stage - between named and recommended: ${stagesText}.` : `${c.name} loses exactly one stage - between recommended and picked: ${stagesText}.`;
  else if (d1 > 0 && d2 > 0) thesis = `${c.name} loses ground at both steps: ${stagesText}.`;
  else thesis = `${c.name} holds its ground through the funnel: ${stagesText}.`;

  // The recommended stage's conversion (the library funnel's stage-3 line):
  // how many recommendations end as the pick, against the rival that converts best.
  const conv = (b: SummaryBrand) => (b.recommended.k > 0 ? b.chosen.k / b.recommended.k : 0);
  const better = s.brands
    .filter((b) => b.key !== S.key && b.recommended.k >= MIN && conv(b) > conv(S))
    .sort((a, b) => conv(b) - conv(a) || a.name.localeCompare(b.name))[0];
  const recToPick =
    S.recommended.k >= MIN
      ? ` Only ${pctN(conv(S))} of its recommendations end as the pick${better ? `; ${better.name} turns ${pctN(conv(better))} of its own into picks` : ""}.`
      : "";
  // The named, recommended and pick stages read the pooled open-choice cell; the kept stage the pooled customers' worries.
  // A rival subject's stages read its brand card (rowPin picks the card stating them).
  const own = subjectPins(c);
  const openCells = cellsOf(c, ...own);
  const keptA = anchor(c, pooledOf(c, "doubts:customers:"));
  const rowAt = (row: BriefRow, a: Anchor | undefined): BriefRow => (a ? { ...row, cell: a } : row);
  const rows: BriefRow[] = [
    rowPin(c, { label: L.named, value: P(S.mentioned), tip: tipOf(S.mentioned) }, ...own),
    rowPin(c, { label: L.rec, value: P(S.recommended), tip: tipOf(S.recommended) }, ...own),
    rowPin(c, { label: L.pick, value: ofPicks ? `${pctFine(picked)} (${ofPicks})` : pctFine(picked), tip: tipOf(S.chosen) }, ...own),
  ];
  // bf29: the scoreboard's layout - the three buyer stages against the average and the most-picked
  // competitor (competitorColumns, the scoreboard's own source); the customers stage has no competitor
  // number and sits in the second table. A rival subject, or no average competitor: one table.
  const cc = competitorColumns(c);
  if (cc) {
    const pick = (which: "avg" | "top") => {
      const p = cc.picked[which];
      const sh = cc.share[which];
      return p && sh && ofPicks ? `${p} (${sh} of picks)` : (p ?? sh);
    };
    const cols: CompCol[] = [cc.named, cc.rec, { avg: pick("avg"), top: pick("top") }];
    rows.forEach((r, i) => {
      r.kind = "vs";
      if (cols[i].avg !== undefined) r.avg = cols[i].avg;
      if (cols[i].top !== undefined) r.top = cols[i].top;
    });
    rows[0].heads = { subject: c.name, ...(cc.topName ? { top: cc.topName } : {}) };
  }
  const paras: BriefPara[] = [
    withCells({ lead: `${L.named}.`, text: `When buyers ask what to buy, the AI names ${c.name} in ${P(S.mentioned)} of answers.`, tip: tipOf(S.mentioned) }, openCells),
    {
      lead: `${L.rec}.`,
      // bf34: no card states recommended as a share of the answers that name it - the first figure only.
      text: `It recommends ${c.name} in ${P(S.recommended)} of answers.`,
      tip: `${S.recommended.k} recommending of ${S.mentioned.k} naming.`,
      ...(openCells ? { cells: openCells } : {}),
    },
    {
      lead: `${L.pick}.`,
      text:
        (s.firmPickInCategory.k >= MIN
          ? `Only ${P(s.firmPickInCategory)} of answers name a single ${c.product}; ${c.name} is the pick ${P(S.shareOfDecided)} of the time one is named, which leaves it the pick in ${pctFine(picked)} of every answer.`
          : `${c.name} is the pick in ${pctFine(picked)} of all answers.`) + recToPick,
      tip: `${tipOf(S.chosen)} answers; ${S.chosen.k} of ${s.firmPickInCategory.k} in-category picks; ${S.chosen.k} picks of ${S.recommended.k} recommendations.`,
      ...((): { cells?: Anchor[] } => {
        const cs = cellsOf(c, ...own, better ? brandPin(c, better.key) : null);
        return cs ? { cells: cs } : {};
      })(),
    },
  ];
  // The hourglass: one band per stage, the stage where the funnel breaks accented.
  const accent = d1 > d2 ? "rec" : "pick";
  const items: BriefVizItem[] = [
    { label: L.named, a: named * 100, value: P(S.mentioned) },
    { label: L.rec, a: rec * 100, value: P(S.recommended), ...(accent === "rec" ? { accent: true } : {}) },
    { label: L.pick, a: picked * 100, value: ofPicks ? `${pctFine(picked)} (${ofPicks})` : pctFine(picked), ...(accent === "pick" ? { accent: true } : {}) },
  ];
  if (c.isTarget) {
    const k = s.customersDoubt;
    if (k && k.answers >= MIN) {
      rows.push(rowAt({ label: L.kept, value: P(k.keep), tip: tipOf(k.keep) }, keptA));
      // The chart's label column is 214 viewBox px at 13.5px: the stage's full name does not fit, so the band reads short.
      items.push({ label: "With a worry, told to stay", a: rate(k.keep) * 100, value: P(k.keep) });
      paras.push({
        lead: `${L.kept}.`,
        text: `When ${poss(c.name)} customers raise a worry, the AI tells them to stay in ${P(k.keep)} of answers and to leave in ${P(k.leave)}; the other ${pctN(Math.max(0, 1 - rate(k.keep) - rate(k.leave)))} take no side either way.`,
        tip: `Stay ${tipOf(k.keep)}; leave ${tipOf(k.leave)}.`,
        ...(keptA ? { cells: [keptA] } : {}),
      });
    }
  }
  const acc = items.find((i) => i.accent)!;
  const title = oneStage
    ? `The funnel pinches at one stage - ${low1(acc.label)}, ${acc.value}`
    : d1 > 0 && d2 > 0
      ? `The funnel narrows most at ${low1(acc.label)}, ${acc.value}`
      : `The funnel holds through every stage - ${low1(acc.label)}, ${acc.value}`;
  const viz: BriefViz = { kind: "funnel", title, subtitle: "How many answers reach each stage - the wider the band, the more answers", items };
  return [
    { key: "thesis", paras: [withCells({ text: thesis, tip: `Named ${tipOf(S.mentioned)}; recommended ${tipOf(S.recommended)}; picked ${tipOf(S.chosen)}.` }, openCells)] },
    { key: "funnel_viz", viz },
    { key: "stages", heading: "The stages", rows },
    { key: "readings", paras },
  ];
}

/* ---------------------------------- Matrix --------------------------------- */

type Quadrant = "The Closers" | "The Showroom" | "The Quiet Closer" | "The Background";

/** "<brand> is <phrase>" for each quadrant (its name carries its own article). */
const QUAD_PHRASE: Record<Quadrant, string> = {
  "The Closers": "one of the Closers",
  "The Showroom": "in the Showroom",
  "The Quiet Closer": "a Quiet Closer",
  "The Background": "in the Background",
};

/* Scatter label placement, in the UI's own viewBox space (BRIEF_SCATTER_GEOM).
 * Text width is estimated from character count at the UI's label sizes. */
type Box = [number, number, number, number]; // x0, y0, x1, y1
const textW = (t: string, fs: number, bold = false) => t.length * fs * (bold ? 0.6 : 0.555);
const boxOf = (x: number, y: number, t: string, fs: number, bold = false): Box => [x, y - fs * 0.78, x + textW(t, fs, bold), y + fs * 0.24];
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

interface ScatterPlan {
  items: BriefVizItem[];
  hlinePx: { x: number; y: number };
  notePx?: { x: number; y: number };
  noteLines?: string[];
}

/** Words broken onto lines of at most `max` characters. */
function wrapWords(t: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of t.split(" ")) {
    if (cur && `${cur} ${w}`.length > max) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

/** bf29: labels for the visibility-vs-conversion scatter - a vertical line (visible) and a HORIZONTAL line
 * (the conversion rate of the charted brands together); every label, the two line labels and the folded
 * note placed clear of the dots, the lines and each other. */
function placeScatter(pts: { label: string; x: number; y: number; accent: boolean }[], xMax: number, yMax: number, vline: number, vlineLabel: string, hline: number, hlineLabel: string, note: string | null): ScatterPlan {
  const g = BRIEF_SCATTER_GEOM;
  const px = (x: number, y: number) => scatterPx(x, y, xMax, yMax);
  const FS = 12.5;
  const FS_ACC = 13.5;
  const FS_REF = 11.5;
  const obstacles: Box[] = [];
  // Dots.
  for (const p of pts) {
    const q = px(p.x, p.y);
    const r = (p.accent ? 7 : 5) + 2;
    obstacles.push([q.x - r, q.y - r, q.x + r, q.y + r]);
  }
  const dotBoxes = [...obstacles];
  // The visibility line (a thin strip) and its label at the top.
  const v = px(vline, 0);
  const vStrip: Box = [v.x - 3, g.top, v.x + 3, g.h - g.bottom];
  const vLabel = boxOf(v.x + 6, g.top + 11, vlineLabel, FS_REF);
  obstacles.push(vLabel);
  // The conversion line: a horizontal strip; its label end-anchored just above it, at the rightmost spot
  // along it that clears every dot and the visibility label (the UI draws it there).
  const hy = px(0, hline).y;
  const hStrip: Box = [g.left, hy - 3, g.w - g.right, hy + 3];
  const hl = textW(hlineLabel, FS_REF);
  let hlinePx = { x: g.w - g.right, y: Math.round(hy - 6) };
  let hBox: Box = [0, 0, 0, 0];
  let hBest = Infinity;
  for (const above of [true, false])
    for (let i = 0; i <= 16; i++) {
      const xe = g.w - g.right - i * 30;
      if (xe - hl < g.left + 4) break;
      const yb = above ? hy - 6 : hy + 6 + FS_REF * 0.78;
      const bx: Box = [xe - hl, yb - FS_REF * 0.78, xe, yb + FS_REF * 0.24];
      const k = [...dotBoxes, vLabel].reduce((a, o) => a + overlap(bx, o), 0) * 10 + overlap(bx, vStrip) * 40 + i + (above ? 0 : 3) + (bx[1] < g.top ? 1000 : 0);
      if (k < hBest) {
        hBest = k;
        hlinePx = { x: Math.round(xe), y: Math.round(yb) };
        hBox = bx;
      }
    }
  obstacles.push(hBox);
  const inside = (b: Box) => {
    const over = Math.max(0, g.left - 4 - b[0]) + Math.max(0, b[2] - (g.w - 2)) + Math.max(0, g.top - 2 - b[1]) + Math.max(0, b[3] - (g.h - g.bottom + 2));
    return over * 400;
  };
  // The x axis too: a label sitting on it reads as an axis label (a dot at the bottom puts its label above).
  const axis: Box = [g.left, g.h - g.bottom - 1.5, g.w - g.right, g.h - g.bottom + 30];
  const lines = (b: Box) => overlap(b, vStrip) * 40 + overlap(b, hStrip) * 40 + overlap(b, axis) * 40;
  const placed: Box[] = [];
  const cost = (b: Box) => obstacles.reduce((a, o) => a + overlap(b, o), 0) + lines(b) + placed.reduce((a, o) => a + overlap(b, o) * 3, 0) + inside(b);
  const out = new Map<string, { dx: number; dy: number }>();
  const candsOf = new Map<string, [number, number][]>();
  // Subject first, then by visibility.
  const order = [...pts].sort((a, b) => Number(b.accent) - Number(a.accent) || b.x - a.x);
  for (const p of order) {
    const q = px(p.x, p.y);
    const fs = p.accent ? FS_ACC : FS;
    const w = textW(p.label, fs, p.accent);
    const r = p.accent ? 7 : 5;
    const cands: [number, number][] = [
      [r + 5, 4.5],
      [-(r + 5) - w, 4.5],
      [r + 3, -(r + 3)],
      [-w / 2, -(r + 6)],
      [r + 3, r + 13],
      [-w / 2, r + 15],
      [-(r + 3) - w, -(r + 3)],
      [-(r + 3) - w, r + 13],
      [r + 6, -(r + 14)],
      [r + 6, r + 24],
      [-w / 2, -(r + 20)],
      [-w / 2, r + 29],
    ];
    // Stacked tiers above and below the dot for a crowded strip (the UI draws a quiet
    // leader to any label set this far off its dot).
    for (let k = 1; k <= 7; k++) for (const ox of [-w / 2, -3, -w + 3]) cands.push([ox, -(r + 6) - k * 15], [ox, r + 15 + k * 15]);
    let best = cands[0];
    let bestCost = Infinity;
    for (const [i, cnd] of cands.entries()) {
      const bx = boxOf(q.x + cnd[0], q.y + cnd[1], p.label, fs, p.accent);
      const k = cost(bx) + i * 0.5; // a slight preference for the natural order
      if (k < bestCost) {
        bestCost = k;
        best = cnd;
      }
    }
    placed.push(boxOf(q.x + best[0], q.y + best[1], p.label, fs, p.accent));
    out.set(p.label, { dx: Math.round(best[0] - g.labelDx), dy: Math.round(best[1] - g.labelDy) });
    candsOf.set(p.label, cands);
  }
  // Two refinement passes: each label re-chooses with every other label in place.
  for (let pass = 0; pass < 2; pass++)
    for (const [j, p] of order.entries()) {
      const q = px(p.x, p.y);
      const fs = p.accent ? FS_ACC : FS;
      const others = placed.filter((_, i) => i !== j);
      const costJ = (b: Box) => obstacles.reduce((a, o) => a + overlap(b, o), 0) + lines(b) + others.reduce((a, o) => a + overlap(b, o) * 3, 0) + inside(b);
      let bestB = placed[j];
      let bestK = costJ(bestB);
      let bestC: [number, number] | null = null;
      for (const [i, cnd] of candsOf.get(p.label)!.entries()) {
        const bx = boxOf(q.x + cnd[0], q.y + cnd[1], p.label, fs, p.accent);
        const k = costJ(bx) + i * 0.5;
        if (k + 1 < bestK) {
          bestK = k;
          bestB = bx;
          bestC = cnd;
        }
      }
      if (bestC) {
        placed[j] = bestB;
        out.set(p.label, { dx: Math.round(bestC[0] - g.labelDx), dy: Math.round(bestC[1] - g.labelDy) });
      }
    }
  // The folded note (brands with too few recommendations to place - no dots of their own): broken onto
  // lines and set in the clearest open stretch of the plot.
  let notePx: ScatterPlan["notePx"];
  let noteLines: string[] | undefined;
  if (note) {
    const LINE = 14;
    const plotW = g.w - g.left - g.right;
    let bestCost = Infinity;
    for (const max of [70, 56, 44]) {
      const ls = wrapWords(note, max);
      const w = Math.max(...ls.map((l) => textW(l, FS_REF)));
      for (let yi = 0; yi <= 24; yi++) {
        const y = g.h - g.bottom - 8 - (ls.length - 1) * LINE - yi * 14;
        for (const fx of [0.02, 0.15, 0.3, 0.45, 0.6, 0.75])
          for (const x of [g.left + 8 + fx * plotW, g.w - g.right - 8 - w - fx * plotW]) {
            const bs = ls.map((l, i) => boxOf(x, y + i * LINE, l, FS_REF));
            const k = bs.reduce((a, bx) => a + cost(bx), 0) + yi * 0.3 + (ls.length - 1) * 2;
            if (k < bestCost) {
              bestCost = k;
              notePx = { x: Math.round(x), y: Math.round(y) };
              noteLines = ls;
            }
          }
      }
    }
  }
  const items = pts.map((p) => {
    const it: BriefVizItem = { label: p.label, a: Math.round(p.x * 10) / 10, b: Math.round(p.y * 10) / 10 };
    if (p.accent) it.accent = true;
    const n = out.get(p.label);
    if (n && (n.dx || n.dy)) {
      it.dx = n.dx;
      it.dy = n.dy;
    }
    return it;
  });
  return { items, hlinePx, notePx, ...(noteLines && noteLines.length > 1 ? { noteLines } : {}) };
}

/** "most" / "2nd most" ... for a rank among brands. */
const ordinal = (n: number) => (n === 1 ? "" : n === 2 ? "2nd " : n === 3 ? "3rd " : `${n}th `);

/** The class head-to-heads on the map (brands the tracker asks about as a class): key -> cell id. */
function classCells(c: Ctx): Map<string, { cellId: string; name: string }> {
  const out = new Map<string, { cellId: string; name: string }>();
  for (const [id, st] of Object.entries(c.stats)) if (id.startsWith("fights:h2h:class-") && st.rivalKey) out.set(st.rivalKey, { cellId: id, name: st.label });
  return out;
}

function matrixFrame(c: Ctx): BriefSection[] {
  const s = c.summary;
  const classes = classCells(c);
  // The selectable brands that register (named in >= 10% of answers or >= 1% of the picks; the subject and
  // the target always) - brands asked about as a class left out (bf29).
  const set = s.brands.filter((b) => !classes.has(b.key) && (b.key === c.subject.key || b.key === c.target.key || rate(b.mentioned) >= 0.1 || rate(b.shareOfDecided) >= 0.01));
  // bf29: one meaning of converting across the Brief - the recommendations that end as the pick.
  const readable = (b: SummaryBrand) => b.recommended.k >= MIN;
  const conv = (b: SummaryBrand) => (b.recommended.k > 0 ? b.chosen.k / b.recommended.k : 0);
  // Folded (one note on the chart, one line in the table): too few recommendations to read a conversion, or
  // rarely named and rarely picked (the chart's old cluster rule) - never the subject or the tracker's brand.
  const small = (b: SummaryBrand) => rate(b.shareOfDecided) < 0.02 && rate(b.mentioned) < 0.3;
  const keep = (b: SummaryBrand) => b.key === c.subject.key || b.key === c.target.key;
  const placedSet = set.filter((b) => readable(b) && (keep(b) || !small(b)));
  const folded = set.filter((b) => !placedSet.includes(b));
  const recAll = placedSet.reduce((a, b) => a + b.recommended.k, 0);
  const line = recAll > 0 ? placedSet.reduce((a, b) => a + b.chosen.k, 0) / recAll : 0;
  const visible = (b: SummaryBrand) => rate(b.mentioned) > 0.5;
  const converting = (b: SummaryBrand) => readable(b) && conv(b) >= line;
  const quad = (b: SummaryBrand): Quadrant => (visible(b) && converting(b) ? "The Closers" : visible(b) ? "The Showroom" : converting(b) ? "The Quiet Closer" : "The Background");
  const byNamed = (xs: SummaryBrand[]) => [...xs].sort((a, b) => b.mentioned.k - a.mentioned.k || a.name.localeCompare(b.name));
  const sorted = byNamed(placedSet);
  const S = c.subject;
  const subjReadable = readable(S) && !classes.has(S.key);
  const rows = sorted.map((b) => [b.name, P(b.mentioned), pctN(conv(b)), P(b.shareOfDecided), quad(b)]);
  const foldNames = byNamed(folded).map((b) => b.name);
  if (foldNames.length)
    rows.push([`${foldNames.length === 1 ? "One more brand" : `${foldNames.length} more brands`}, rarely named or picked: ${listOf(foldNames)}`, "", "", "", ""]);
  const hi = sorted.findIndex((b) => b.key === S.key);

  // The scatter.
  const pts = sorted.map((b) => ({ label: b.name, x: rate(b.mentioned) * 100, y: conv(b) * 100, accent: b.key === S.key }));
  const yMax = Math.min(100, Math.max(20, Math.ceil((Math.max(...pts.map((p) => p.y), line * 100) + 4) / 10) * 10));
  const VL = "visible: named over 50%";
  const HL = `all these brands together: ${pctN(line)}`;
  const note = foldNames.length ? `Rarely named or picked, not placed: ${listOf(foldNames)}` : null;
  const plan = placeScatter(pts, 100, yMax, 50, VL, line * 100, HL, note);
  const vis = sorted.filter(visible);
  const headline = `${pctN(conv(S))} of recommendations become picks, named in ${P(S.mentioned)}`;
  let title: string;
  if (!subjReadable) title = `${c.name} is recommended too rarely to read how often it converts - named in ${P(S.mentioned)}`;
  else if (visible(S)) {
    const rn = vis.findIndex((b) => b.key === S.key) + 1;
    const byConv = [...vis].sort((a, b) => conv(b) - conv(a));
    const rc = byConv.findIndex((b) => b.key === S.key) + 1;
    if (vis.length >= 2 && rc === vis.length) title = rn === 1 ? `The most visible brand converts least - ${headline}` : `${c.name} converts least of the visible brands - ${headline}`;
    else if (vis.length >= 2) title = `${c.name} is named ${ordinal(rn)}most and converts ${ordinal(rc)}best of the visible brands - ${headline}`;
    else title = `${c.name} is the only visible brand${converting(S) ? " and converts above the line" : " and converts below the line"} - ${headline}`;
  } else title = converting(S) ? `${c.name} converts but is not visible - ${headline}` : `${c.name} is neither visible nor converting - ${headline}`;
  const viz: BriefViz = {
    kind: "scatter",
    title,
    subtitle: "Every brand by how often the AI names it and how many of its recommendations end as the pick",
    items: plan.items,
    xLabel: "named in answers",
    yLabel: "recommendations that end as the pick",
    vline: 50,
    vlineLabel: VL,
    hline: Math.round(line * 1000) / 10,
    hlineLabel: HL,
    hlineLabelPx: plan.hlinePx,
    xMax: 100,
    yMax,
    ...(note ? { clusterNote: note, ...(plan.notePx ? { notePx: plan.notePx } : {}), ...(plan.noteLines ? { noteLines: plan.noteLines } : {}) } : {}),
  };

  // Directly under the chart: what the axes and the four names mean.
  const defs: BriefPara[] = [
    {
      text: "Across: how often the AI names the brand when buyers ask what to buy - past the upright line, named in more than half the answers, it is visible. Up: how many of the AI's recommendations of the brand end with it as the pick - at or above the level line, the rate for all these brands together, it converts.",
    },
    { lead: "The Closers.", text: "Visible and converting." },
    { lead: "The Showroom.", text: "Visible, but its recommendations seldom become the pick." },
    { lead: "The Quiet Closer.", text: "Seldom named, but its recommendations often become the pick." },
    { lead: "The Background.", text: "Neither visible nor converting." },
  ];
  const out: BriefSection[] = [{ key: "matrix_viz", viz }, { key: "matrix_key", paras: defs }];
  if (classes.size) {
    const cl = [...classes.values()];
    out.push({
      key: "matrix_classes",
      paras: [
        withCells(
          { text: `${listOf(cl.map((x) => x.name))} ${cl.length > 1 ? "are" : "is"} asked about as a class, not as a single brand, so ${cl.length > 1 ? "they are" : "it is"} left out here; ${cl.length > 1 ? "their" : "its"} head-to-head questions are on the Map.` },
          cellsAt(c, ...cl.map((x): [string, string] => [x.cellId, x.name]))
        ),
      ],
    });
  }
  out.push({ key: "matrix", table: { headers: ["Brand", "Named", "Recommendations that end as the pick", "Share of picks", "Position"], rows, ...(hi >= 0 ? { highlightRow: hi } : {}) } });

  // The reading: where the subject sits, the outliers, then the so-what.
  const paras: BriefPara[] = [];
  const subjPins = cellsOf(c, ...subjectPins(c));
  if (subjReadable)
    paras.push(
      withCells(
        {
          lead: `${c.name} is ${QUAD_PHRASE[quad(S)]}.`,
          text: `The AI names it in ${P(S.mentioned)} of answers, and ${pctN(conv(S))} of the answers that recommend it end with it as the pick - ${conv(S) >= line ? "at or above" : "below"} the rate for all these brands together.`,
        },
        subjPins
      )
    );
  const showroom = sorted.find((b) => b.key !== S.key && quad(b) === "The Showroom");
  const quiet = [...sorted].filter((b) => b.key !== S.key && quad(b) === "The Quiet Closer").sort((a, b) => conv(b) - conv(a))[0];
  const outl: string[] = [];
  if (showroom) outl.push(`${showroom.name} is ${quad(S) === "The Showroom" ? "also in the Showroom" : "the most visible brand in the Showroom"} - named in ${P(showroom.mentioned)} of answers, with ${pctN(conv(showroom))} of its recommendations ending as the pick.`);
  if (quiet) outl.push(`${quiet.name} is ${quad(S) === "The Quiet Closer" ? "another" : "the strongest"} Quiet Closer - named in ${P(quiet.mentioned)} of answers, yet ${pctN(conv(quiet))} of its recommendations end as the pick.`);
  if (outl.length) paras.push(withCells({ text: outl.join(" ") }, cellsOf(c, showroom ? brandPin(c, showroom.key) : null, quiet ? brandPin(c, quiet.key) : null)));
  // The so-what.
  const closers = sorted.filter((b) => b.key !== S.key && quad(b) === "The Closers").slice(0, 3);
  if (c.isTarget && subjReadable) {
    const where =
      quad(S) === "The Closers"
        ? closers.length
          ? `${c.name} already sits where it wants to be, beside ${listOf(closers.map((b) => `${b.name} (${pctN(conv(b))})`))}.`
          : `${c.name} is the only brand that is both visible and converting.`
        : closers.length
          ? `Where ${c.name} wants to be, ${listOf(closers.map((b, i) => `${b.name} (${pctN(conv(b))}${i === 0 ? " of its recommendations ending as the pick" : ""})`))} ${closers.length > 1 ? "already sit" : "already sits"}, against ${pctN(conv(S))} for ${c.name}.`
          : `No brand is both visible and converting yet - the place ${c.name} wants is open.`;
    const mv = findingMove("funnel", {}, c.brand);
    const moveCell = c.map.tensions.find((t) => t.key === "known_vs_picked")?.cellId ?? OPEN_ALL;
    paras.push(withCells({ lead: "So what.", text: `${where}${mv && quad(S) !== "The Closers" ? ` ${mv.text}` : ""}` }, cellsOf(c, ...closers.map((b) => brandPin(c, b.key)), ...subjectPins(c), moveCell)));
  } else if (!c.isTarget && subjReadable && readable(c.target) && !classes.has(c.target.key)) {
    const T = c.target;
    paras.push(
      withCells(
        {
          lead: `Against ${c.brand}.`,
          text: `${c.brand} is ${QUAD_PHRASE[quad(T)]}, named in ${P(T.mentioned)} of answers with ${pctN(conv(T))} of its recommendations ending as the pick; ${c.name} is ${quad(S) === quad(T) ? "in the same place" : QUAD_PHRASE[quad(S)]}, at ${P(S.mentioned)} and ${pctN(conv(S))}.`,
        },
        cellsOf(c, OPEN_ALL, BRAND_CARD(S.key))
      )
    );
  }
  if (paras.length) out.push({ key: "reading", paras });
  return out;
}

/* ----------------------------------- Jobs ---------------------------------- */

interface RoomStand {
  r: RoomRead;
  /** Setup order. */
  seq: number;
  mine: RateCell;
  mineChosen: number;
  leader?: RoomRead["brands"][number];
  owns: boolean;
  /** The leader's share minus the subject's (negative where the subject leads by that much). */
  gap: number;
}

/** bf29: every buying situation with enough picks to read, in ONE order for the chart and the paragraphs -
 * the situations the subject leads first (largest lead first), then by how close it is to the leader
 * (smallest gap first), ties by the setup order. */
function roomStands(c: Ctx): RoomStand[] {
  const out: RoomStand[] = [];
  c.rooms.forEach((r, seq) => {
    if (r.answers === 0 || r.firm.k < MIN) return;
    const me = r.brands.find((b) => b.key === c.subject.key);
    const others = r.brands.filter((b) => b.key !== c.subject.key).sort((a, b) => b.chosen - a.chosen);
    const leader = others[0];
    const mine = me ? me.share : cell(0, r.firm.k);
    const owns = !!me && me.chosen > 0 && (!leader || me.chosen >= leader.chosen);
    out.push({ r, seq, mine, mineChosen: me?.chosen ?? 0, leader, owns, gap: (leader ? rate(leader.share) : 0) - rate(mine) });
  });
  return out.sort((a, b) => Number(b.owns) - Number(a.owns) || a.gap - b.gap || a.seq - b.seq);
}

/** bf29 (one bar for the Now what verdict, the SWOT opening and the By buying situation close): a buying
 * situation is near when the subject leads it, or trails with at least half the leader's share of the picks. */
const NEAR_RATIO = 0.5;
function nearStand(x: RoomStand): boolean {
  return x.owns || (!!x.leader && rate(x.mine) > 0 && rate(x.mine) >= rate(x.leader.share) * NEAR_RATIO);
}

/** bf29: the three Value sides in one clause - worth it, not worth it, and "it depends" as the rest; a zero side
 * collapses to "never", a whole side to "every answer". */
function worthWords(w: { yes: RateCell; no: RateCell; depends: RateCell }): string {
  const rest = w.depends.k > 0;
  if (w.yes.k > 0 && w.yes.k === w.yes.n) return "says it is worth it in every answer";
  if (w.no.k > 0 && w.no.k === w.no.n) return "says it is not worth it in every answer";
  if (w.yes.k === 0 && w.no.k === 0) return "never says it is worth it or not - every answer says it depends";
  if (w.yes.k === 0) return `never says it is worth it - it says it is not worth it in ${P(w.no)}${rest ? ` and that it depends in ${P(w.depends)}` : ""}`;
  if (w.no.k === 0) return `says it is worth it in ${P(w.yes)} and never that it is not${rest ? `, and that it depends in ${P(w.depends)}` : ""}`;
  return `says it is worth it in ${P(w.yes)}, not worth it in ${P(w.no)}${rest ? `, and that it depends in ${P(w.depends)}` : ""}`;
}

const LIFT_SIDE = 10; // the map's roomLift floor (picks a side)
const ONE_SIDE = MIN; // bf29: a one-sided read needs 20 picks of the leader, and a code argued in at least a quarter of them

function jobsFrame(c: Ctx): BriefSection[] {
  const paras: BriefPara[] = [];
  const valueRooms = new Map((c.inputs.value?.rooms ?? []).map((r) => [r.key, r]));
  const stands = roomStands(c);
  const thin = c.rooms.filter((r) => r.answers > 0 && r.firm.k < MIN);
  for (const r of [...stands.map((x) => x.r), ...thin]) {
    const st = stands.find((x) => x.r === r);
    const parts: string[] = [];
    if (r.description) parts.push(sentence(r.description));
    let tip = `${r.answers} answers`;
    if (!st) parts.push(`Too few answers here commit to a pick to call who takes this buying situation.`);
    else {
      tip += `; ${tipOf(st.mine)} picks`;
      if (!st.owns && st.leader) {
        parts.push(`${c.name} takes ${st.mine.k === 0 ? "none" : P(st.mine)} of the picks here; ${st.leader.name} leads with ${P(st.leader.share)} of the picks.`);
        tip += `; ${st.leader.name} ${st.leader.chosen}`;
      } else parts.push(`${c.name} leads here with ${P(st.mine)} of the picks${st.leader && st.leader.chosen > 0 ? `, ahead of ${st.leader.name} at ${P(st.leader.share)}` : ""}.`);
      // Why, from this buyer's own answers (the map's roomLift - never the all-buyers argument).
      const lift = c.roomLift?.(r.room, c.subject.key);
      if (lift && lift.length) {
        const win = lift.filter((l) => l.lift > 0 && l.wins.low > l.others.high).slice(0, 2).map((l) => l.code);
        const lose = [...lift].reverse().filter((l) => l.lift < 0 && l.others.low > l.wins.high).slice(0, 2).map((l) => l.code);
        if (win.length || lose.length)
          parts.push(
            `${win.length ? `When the AI picks ${c.name} for this buyer, ${listOf(win)} ${win.length > 1 ? "come" : "comes"} up more` : `Nothing comes up clearly more when the AI picks ${c.name} for this buyer`}${lose.length ? `; when it picks another brand, ${listOf(lose)} ${lose.length > 1 ? "come" : "comes"} up more` : ""}.`
          );
        else parts.push(`No argument in this buyer's answers comes up clearly more on either side.`);
      } else if (lift) {
        // Too few picks a side for the two-sided read: say which side is too thin, and read the leader alone when it can be.
        const mineN = c.roomCodes?.(r.room, c.subject.key).n ?? 0;
        const lead = st.leader && !st.owns ? c.roomCodes?.(r.room, st.leader.key) : undefined;
        const top = lead && lead.n >= ONE_SIDE ? lead.codes.filter((x) => rate(x.rate) >= 0.25).slice(0, 2).map((x) => x.code) : [];
        if (mineN < LIFT_SIDE)
          parts.push(`The AI picks ${c.name} here too seldom to say what wins it${top.length ? `; when it picks ${st.leader!.name}, the answers most often argue ${listOf(top)}` : ""}.`);
        else parts.push(`Too few of these answers pick another brand to say what wins against ${c.name} here.`);
      }
    }
    if (c.isTarget) {
      const v = valueRooms.get(r.room);
      if (v && v.answers >= MIN) {
        const what = v.line ? theProduct(v.line, c.brand, COMMON_WORDS) : c.brand;
        parts.push(`Asked whether ${what} is worth paying more for than a cheaper option, the AI ${worthWords(v.worth)}.`);
        tip += `; worth it ${tipOf(v.worth.yes)}`;
      }
      const cs = c.stats[`chooses:open:${norm(r.room)}`];
      if (cs?.wall) parts.push(`Buyers who say "${condLabel(cs.wall)}" are sent elsewhere here - that is where they already are, not something a message can change.`);
    }
    const hasValue = c.isTarget && (valueRooms.get(r.room)?.answers ?? 0) >= MIN;
    paras.push(withCells({ lead: r.room, text: parts.join(" "), tip: `${tip}.` }, cellsAt(c, [`chooses:open:${norm(r.room)}`, r.room], [hasValue ? `chooses:value:${norm(r.room)}` : null, r.room])));
  }
  if (!paras.length) paras.push({ text: "This tracker asks every buyer the same questions - there are no separate buying situations to read." });
  const out: BriefSection[] = [];
  const viz = pairsViz(c, stands);
  if (viz) out.push({ key: "situations_viz", viz });
  out.push({ key: "situations", paras });

  // The close: nearest and furthest, then one move (the tracker); strongest and weakest against the tracker (a rival).
  if (stands.length >= 2) {
    const close: string[] = [];
    let pins: (string | undefined)[] = [];
    if (c.isTarget) {
      // bf29: one bar for all three surfaces (nearStand) - the situations it leads, the nearest it trails within
      // the bar, the furthest behind; the move is the NEAREST situation's own move, anchored to that one cell.
      const owned = stands.filter((x) => x.owns);
      const trail = stands.filter((x) => !x.owns && x.leader);
      const far = trail.length ? trail[trail.length - 1] : undefined;
      const nearT = trail.find((x) => nearStand(x) && x !== far);
      if (!trail.length) close.push(`${c.name} leads every buying situation here, most firmly with ${buyerPhrase(owned[0].r.room)} at ${P(owned[0].mine)} of the picks.`);
      else {
        close.push(owned.length ? `${c.name} leads with ${listOf(owned.map((x) => buyerPhrase(x.r.room)))}.` : `${c.name} leads no buying situation here.`);
        if (nearT) close.push(`It comes nearest to the leader with ${buyerPhrase(nearT.r.room)} - ${P(nearT.mine)} of the picks to ${P(nearT.leader!.share)} for ${nearT.leader!.name}.`);
        else if (!owned.length && trail[0] !== far) close.push(`Its closest is ${buyerPhrase(trail[0].r.room)} - ${trail[0].mine.k === 0 ? "none" : P(trail[0].mine)} of the picks to ${P(trail[0].leader!.share)} for ${trail[0].leader!.name}.`);
        if (far) close.push(`It is furthest behind with ${buyerPhrase(far.r.room)} - ${far.mine.k === 0 ? "none" : P(far.mine)} of the picks to ${P(far.leader!.share)} for ${far.leader!.name}.`);
      }
      const anchorStand = nearT ?? stands[0];
      const cellId = `chooses:open:${norm(anchorStand.r.room)}`;
      const own = c.moves.find((m) => m.cellId === cellId);
      const pos = c.map.positions[cellId];
      const st0 = c.stats[cellId];
      const act = own ? own.actStem : pos && st0 && pos.status === "deficit" ? actOf(pos, st0, c.brand) : null;
      if (act) close.push(`The move for ${buyerPhrase(anchorStand.r.room)}: ${act}.`);
      pins = [...new Set([cellId, ...(far ? [`chooses:open:${norm(far.r.room)}`] : []), ...owned.slice(0, 1).map((x) => `chooses:open:${norm(x.r.room)}`)])];
    } else {
      const T = c.target.key;
      const vs = stands
        .map((x) => {
          const t = x.r.brands.find((b) => b.key === T);
          return { x, t: t ? t.share : cell(0, x.r.firm.k) };
        })
        .map((y) => ({ ...y, d: rate(y.x.mine) - rate(y.t) }))
        .sort((a, b) => b.d - a.d);
      const hi = vs[0];
      const lo = vs[vs.length - 1];
      close.push(
        `Against ${c.brand}, ${c.name} is strongest with ${buyerPhrase(hi.x.r.room)} - ${hi.x.mine.k === 0 ? "none" : P(hi.x.mine)} of the picks to ${hi.t.k === 0 ? "none" : P(hi.t)} for ${c.brand} - and weakest with ${buyerPhrase(lo.x.r.room)}, ${lo.x.mine.k === 0 ? "none" : P(lo.x.mine)} to ${lo.t.k === 0 ? "none" : P(lo.t)}.`
      );
      pins = [`chooses:open:${norm(hi.x.r.room)}`, `chooses:open:${norm(lo.x.r.room)}`];
    }
    out.push({ key: "situations_close", paras: [withCells({ lead: "Where it stands.", text: close.join(" ") }, cellsOf(c, ...pins))] });
  }
  return out;
}

/** The by-situation pairs: the subject's share of picks over the situation's leader's (the leading rival's
 * where the subject leads), in the paragraphs' order (roomStands). */
function pairsViz(c: Ctx, stands: RoomStand[]): BriefViz | null {
  const groups = stands.filter((x) => x.leader);
  if (!groups.length) return null;
  const owned = groups.filter((g) => g.owns).map((g) => g.r.room);
  const title = !owned.length
    ? `Every situation has an owner - and it is never ${c.name}`
    : owned.length === groups.length
      ? `${c.name} owns every buying situation`
      : `${c.name} owns ${listOf(owned.map((r) => buyerPhrase(r)))}; the rest have other owners`;
  return {
    kind: "pairs",
    title,
    subtitle: `Share of picks by buying situation, nearest first: ${c.name} against the situation's leader${owned.length ? ", or its closest rival where it leads" : ""}`,
    legend: [c.name, owned.length ? "the leading rival" : "the situation's leader"],
    items: groups.map((g) => ({
      label: g.r.room,
      a: rate(g.mine) * 100,
      value: g.mine.k === 0 ? "0%" : P(g.mine),
      b: rate(g.leader!.share) * 100,
      bValue: P(g.leader!.share),
      who: g.leader!.name,
      ...(g.owns ? { accent: true } : {}),
    })),
  };
}

/* -------------------------------- Diagnosis -------------------------------- */

/** A worry about the price: its wording names money (generic words, never a category's). */
const PRICE_WORRY = /\b(fees?|prices?|pricey|pricing|costs?|costly|expensive|pay|paying|money|afford(?:able)?|overpriced|cheap(?:er)?|budget|subscription)\b/i;

/** "<a> in N% of answers" with "never" / "every" at the extremes. */
const shareWords = (x: RateCell, verb: string, never: string) =>
  x.k === 0 ? never : x.k === x.n ? `${verb} in every answer` : `${verb} in ${P(x)} of answers`;

/**
 * bf29 (2026-11-16, Tyler): "The diagnosis" - the shape the writer gave the
 * SWOT when it was free to argue (the saved written memo): one argument in
 * four findings and the moves. Every sentence is this frame's own template
 * (facts are shared with the other frames, sentences never are); a section
 * whose facts are absent or under the floors is left out. A rival subject
 * reads its funnel, its arguments and its record against the tracker.
 */
function diagnosisFrame(c: Ctx): BriefSection[] {
  const out: BriefSection[] = [];
  const S = c.subject;
  const sm = c.summary;
  const leader = leaderOf(c);
  const behind = !!leader && rate(leader.shareOfDecided) > rate(S.shareOfDecided);

  // 1. Visibility against conversion (the matrix's lines: visible = named over half the answers,
  // converting = share of picks at least a quarter of the named rate).
  if (S.mentioned.n >= MIN && sm.firmPickInCategory.k >= MIN) {
    const named = rate(S.mentioned);
    const share = rate(S.shareOfDecided);
    const visible = named > 0.5;
    const converts = share >= named / 4;
    const heading = visible
      ? converts
        ? behind
          ? `Known and chosen - and still behind ${leader!.name}`
          : `Named and chosen more than any rival`
        : "Present everywhere, chosen rarely"
      : converts
        ? "Chosen when named, but not named enough"
        : "Rarely named and rarely chosen";
    const conv = S.recommended.k > 0 ? S.chosen.k / S.recommended.k : 0;
    const parts = [
      `When buyers ask the AI what to buy, ${c.name} comes up in ${P(S.mentioned)} of the answers and is recommended in ${P(S.recommended)}.`,
      `The AI settles on one ${c.product} in ${P(sm.firmPickInCategory)} of answers, and ${c.name} is that ${c.product} ${S.shareOfDecided.k === 0 ? "none of the time" : `${P(S.shareOfDecided)} of the time`} - ${pctFine(rate(S.chosen))} of all answers.`,
    ];
    if (S.recommended.k >= MIN) parts.push(visible && !converts ? `The problem is conversion, not visibility: ${pctN(conv)} of the answers that recommend ${c.name} end with it as the pick.` : `Of the answers that recommend ${c.name}, ${pctN(conv)} end with it as the pick.`);
    if (leader && behind) {
      const lc = leader.recommended.k >= MIN ? leader.chosen.k / leader.recommended.k : null;
      parts.push(`Buyers are steered to ${leader.name} instead, which takes ${P(leader.shareOfDecided)} of the picks${lc !== null && lc > conv ? ` and turns ${pctN(lc)} of its recommendations into the pick` : ""}.`);
    } else if (leader) parts.push(`No rival takes more of the picks; the nearest is ${leader.name} at ${P(leader.shareOfDecided)}.`);
    out.push({ key: "diag_conversion", heading, paras: [withCells({ text: parts.join(" ") }, cellsOf(c, ...subjectPins(c), BRAND_CARD(S.key), leader ? brandPin(c, leader.key) : null))] });
  }

  // 2. The price (the tracker's own brand only: Value and the worries are its questions).
  const v = c.inputs.value;
  if (c.isTarget && v && v.answers >= MIN) {
    const yes = rate(v.worth.yes);
    const no = rate(v.worth.no);
    // Headed by what the verdict is: for a brand that leads, a price doubt is where the lead is exposed.
    const heading = no > yes ? (behind ? "Price is where the case breaks down" : "Price is where the lead is exposed") : yes > no ? "The price holds up" : "Price splits the answer";
    const what = v.lines.length === 1 ? theProduct(v.lines[0].label, c.brand, COMMON_WORDS) : c.brand;
    const parts = [
      `Asked whether ${what} is worth paying more for than a cheaper option, the AI ${shareWords(v.worth.yes, "says yes", "never says yes")}, says no in ${P(v.worth.no)} and says it depends in ${P(v.worth.depends)}.`,
    ];
    const pins: (string | undefined)[] = [pooledOf(c, "chooses:value:")];
    // bf34: where it points the buyer instead, as the Value card states it (shares of all its answers).
    const vi = valueInstead(c, pooledOf(c, "chooses:value:"));
    if (vi) {
      const rival = v.instead.find((x) => !x.own);
      parts.push(valueInsteadText(c, vi));
      if (rival && vi.rival.pct > 0) parts.push(`${rival.name} is the rival it names most.`);
    }
    // The worry about the price: the buyers' worry first, then the customers' with the same wording.
    const ob = c.inputs.doubt.objections?.rows.find((r) => PRICE_WORRY.test(r.concern) && r.answers >= MIN);
    if (ob) {
      parts.push(`A buyer who worries "${ob.concern}" is ${ob.verdicts.proceed.k === 0 ? "never told to go ahead" : ob.verdicts.proceed.k === ob.answers ? "told to go ahead every time" : `told to go ahead in ${P(ob.verdicts.proceed)} of answers`}.`);
      pins.push(Object.entries(c.stats).find(([, st]) => st.row === "buyers" && norm(st.label) === norm(ob.concern))?.[0]);
    }
    const klRows = (c.inputs.doubt.keepOrLeave?.rows ?? []).filter((r) => PRICE_WORRY.test(r.concern) && r.answers >= MIN);
    const kl = klRows.find((r) => ob && norm(r.concern) === norm(ob.concern)) ?? klRows[0];
    if (kl) {
      // bf34: the worry is named, so the figure reads with the card it is on.
      parts.push(`${ob && norm(kl.concern) === norm(ob.concern) ? `A customer with the same worry ("${kl.concern}")` : `A customer who worries "${kl.concern}"`} is ${kl.verdicts.keep.k === 0 ? "never told to stay" : `told to stay in ${P(kl.verdicts.keep)}`} and ${kl.verdicts.leave.k === 0 ? "never told to leave" : `told to leave in ${P(kl.verdicts.leave)}`}.`);
      pins.push(Object.entries(c.stats).find(([, st]) => st.row === "customers" && norm(st.label) === norm(kl.concern))?.[0]);
    }
    // The buyer who is the exception: the room furthest from the overall verdict, the other way.
    const rooms = v.rooms.filter((r) => r.answers >= MIN && r.rooms.length === 1);
    const ex = [...rooms].sort((a, b) => (no > yes ? rate(b.worth.yes) - rate(a.worth.yes) : rate(a.worth.yes) - rate(b.worth.yes)))[0];
    if (ex && rooms.length >= 2 && Math.abs(rate(ex.worth.yes) - yes) >= 0.15) {
      const asked = ex.line && norm(ex.line) !== norm(what) ? `, asked about ${theProduct(ex.line, c.brand, COMMON_WORDS)}` : "";
      parts.push(
        no > yes
          ? `The exception is ${buyerPhrase(ex.rooms[0])}${asked}: there the AI calls it worth it in ${P(ex.worth.yes)} of answers.`
          : `The exception is ${buyerPhrase(ex.rooms[0])}${asked}: there the AI calls it worth it in only ${ex.worth.yes.k === 0 ? "none" : P(ex.worth.yes)} of answers.`
      );
      pins.push(`chooses:value:${norm(ex.rooms[0])}`);
    }
    out.push({ key: "diag_price", heading, paras: [withCells({ text: parts.join(" ") }, cellsOf(c, ...pins))] });
  }

  // 3. The argument that wins, against what the AI tells buyers to look for.
  const { bestC: bestArg } = argsOnCard(c);
  const best = bestArg?.l;
  if (bestArg && best && c.inputs.taught.length >= 5) {
    const top = c.inputs.taught.slice(0, 5);
    const taughtAs = c.inputs.taught.find((t) => norm(t.code) === norm(best.code));
    const onList = top.some((t) => norm(t.code) === norm(best.code));
    const heading = onList
      ? `${poss(c.name)} winning argument is one buyers are told to look for`
      : behind
        ? `${poss(c.name)} winning argument is not what buyers are told to look for`
        : `The lead rests on an argument buyers are not told to look for`;
    const parts = [`When the AI picks ${c.name}, it argues ${bestArg.f.name.toLowerCase()} in ${bestArg.f.here} of those answers; when it picks ${c.isTarget ? "another brand" : c.brand}, in ${bestArg.f.there}.`];
    if (!onList) {
      parts.push(`${cap(best.code)} is not among the five things the AI most often tells buyers to look for.`);
      const lead3 = top.slice(0, 3).map((t) => t.code);
      parts.push(`It leads instead with ${listOf(lead3)}.`);
      const against = top.map((t) => c.lift.find((l) => norm(l.code) === norm(t.code))).find((l) => l && l.lift < 0 && l.others.low > l.wins.high);
      if (against) parts.push(`Of the points it raises most, ${against.code} comes up more often when another brand is picked.`);
    } else if (taughtAs) parts.push(`It is also among the five points the AI raises most when buyers ask what to look for.`);
    out.push({ key: "diag_argument", heading, paras: [withCells({ text: parts.join(" ") }, cellsOf(c, c.isTarget ? OPEN_ALL : BRAND_CARD(S.key), pooledOf(c, "chooses:criteria:")))] });
  }

  // 4. The threat (the tracker) or the record against the tracker (a rival).
  if (c.isTarget && leader) {
    const heading = behind ? `${leader.name} is the main threat` : `${leader.name} is the nearest challenger`;
    const parts: string[] = [];
    const pins: (string | undefined)[] = [];
    // bf31: the section is about the rival its heading names - first what sends buyers to it, then where the gap
    // to it is widest; the condition that sends buyers elsewhere follows as "Others who take buyers".
    const away = c.inputs.away;
    const alead = away?.lead && !isDefaultCondition(away.lead.label) ? away.lead : null;
    type Cond = { label: string; answers: number; routes: { name: string; n: number }[] };
    const conds: Cond[] = [
      ...(alead ? [{ label: alead.wording, answers: alead.answers, routes: alead.routes }] : []),
      ...(away?.groups ?? []).filter((x) => !isDefaultCondition(x.label)).map((x) => ({ label: x.label, answers: x.answers, routes: x.routes })),
    ];
    const sentTo = (g: Cond) => {
      const d = destOf(g.routes, g.answers);
      return `Buyers who say "${condLabel(g.label)}" are most often sent away${d ? `, ${destPhrase(d)}` : ""}.`;
    };
    const toLeader = conds.find((g) => g.routes[0]?.name === leader.name);
    if (toLeader) {
      parts.push(sentTo(toLeader));
      pins.push(CONDITION_CARD);
    }
    const gap = c.rooms
      .filter((r) => r.firm.k >= MIN)
      .map((r) => {
        const mine = r.brands.find((b) => b.key === S.key);
        const them = r.brands.find((b) => b.key === leader.key);
        return { r, mine: mine ? mine.share : cell(0, r.firm.k), them: them ? them.share : cell(0, r.firm.k) };
      })
      .filter((x) => rate(x.them) > rate(x.mine))
      .sort((a, b) => rate(b.them) - rate(b.mine) - (rate(a.them) - rate(a.mine)))[0];
    if (gap && c.rooms.filter((r) => r.firm.k >= MIN).length >= 2) {
      parts.push(`The gap to ${leader.name} is widest for ${buyerPhrase(gap.r.room)}: ${leader.name} takes ${P(gap.them)} of the picks there and ${c.name} ${gap.mine.k === 0 ? "none" : P(gap.mine)}.`);
      pins.push(`chooses:open:${norm(gap.r.room)}`);
    }
    // A rival one AI company carries (a threat, the SWOT's sense), only on real concentration: the detector's own bar
    // (>= 40% of the rival's picks, the range clearing that unit's share of the questions) and at least 1.5 times
    // that share.
    const conc = c.ranked.find((i) => i.key === "engine_pick_concentration" && i.names?.variant === "rival" && i.names?.rival && i.names?.vendor);
    let concLine: { rival: string; text: string; ids: string[] } | null = null;
    if (conc) {
      const nums = (c.voiced.get(conc.key)?.body ?? conc.body).match(/<1%|\d+(?:\.\d+)?%/g) ?? [];
      const num = (t: string) => (t === "<1%" ? 0.5 : parseFloat(t));
      if (nums.length >= 2 && num(nums[0]!) >= 1.5 * num(nums[1]!))
        concLine = {
          rival: conc.names!.rival!,
          text: `${conc.names!.vendor}'s assistants carry ${conc.names!.rival}: ${nums[0]} of its picks come from them, though they answer ${nums[1]} of the questions, so ${conc.names!.rival} is picked more wherever buyers use them.`,
          ids: insightCells(c, conc),
        };
    }
    if (concLine && concLine.rival === leader.name) {
      parts.push(concLine.text);
      pins.push(...concLine.ids);
    }
    // Customers looking around asked for alternatives, so being shown rivals is by design; only stay / leave, and
    // only when it says something (told to leave at the SWOT's bar, or almost never told to stay).
    const dfn = c.inputs.alternatives?.defensive;
    if (dfn && dfn.answers >= MIN && (rate(dfn.verdicts.leave) >= HOLD_LEAVE_BAR || (rate(dfn.verdicts.keep) <= 0.1 && dfn.verdicts.leave.k > 0))) {
      const stay = dfn.verdicts.keep.k === 0 ? "never told to stay" : `told to stay in ${P(dfn.verdicts.keep)} of answers`;
      const leave = dfn.verdicts.leave.k === 0 ? "never told to leave" : `told to leave in ${P(dfn.verdicts.leave)}`;
      parts.push(`${poss(c.name)} own customers who ask what else to consider are ${stay} and ${leave}.`);
      pins.push(pooledOf(c, "doubts:hold:"));
    }
    const paras: BriefPara[] = [];
    if (parts.length) paras.push(withCells({ text: parts.join(" ") }, cellsOf(c, ...pins)));
    const others: string[] = [];
    const otherPins: (string | undefined)[] = [];
    const top = conds[0];
    if (top && top !== toLeader && top.routes[0]?.name !== leader.name) {
      others.push(sentTo(top));
      otherPins.push(CONDITION_CARD);
    }
    if (concLine && concLine.rival !== leader.name) {
      others.push(concLine.text);
      otherPins.push(...concLine.ids);
    }
    if (others.length) paras.push(withCells({ lead: "Others who take buyers.", text: others.join(" ") }, cellsOf(c, ...otherPins)));
    if (paras.length) out.push({ key: "diag_threat", heading, paras });
  } else if (!c.isTarget && c.vsTarget && c.vsTarget.won.n >= MIN) {
    const w = c.vsTarget.won;
    const heading = w.low > 0.5 ? `${c.name} wins the straight choice against ${c.brand}` : w.high < 0.5 ? `${c.brand} wins the straight choice against ${c.name}` : `${c.name} and ${c.brand} split the straight choice`;
    const text = `When the AI must choose between ${c.name} and ${c.brand}, it settles on ${c.name} ${w.k === 0 ? "none of the time" : w.k === w.n ? "every time" : `${P(w)} of the time`}.`;
    out.push({ key: "diag_matchup", heading, paras: [withCells({ text }, cellsOf(c, rivalCell(c, S.key)))] });
  }

  // 5. Where to act: three moves, one per action (groupMoves).
  if (c.isTarget) {
    const picked = groupMoves(c, c.moves).slice(0, 3);
    out.push({
      key: "diag_act",
      heading: "Where to act",
      paras: picked.length
        ? picked.map((g) =>
            withCells(
              { lead: leadOf(g.lead), text: g.moves.length === 1 ? `${cap(g.first.act)}, and measure it by ${g.first.watch}.` : `${cap(g.first.actStem)} in each of these, and measure it first by ${g.first.watch}.` },
              cellsAt(c, ...g.moves.map((m): [string, string] => [m.cellId, m === g.first ? g.first.watch : m.lead]))
            )
          )
        : [{ text: `Nothing in this wave is lost by enough to call for a new move; the work is keeping what wins current.` }],
    });
  }
  return out;
}

/* ------------------------- bf26: the Brief's one voice ------------------------- */

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is offset `at` of `t` inside a quoted span (an odd number of straight quotes before it)? */
const inQuotes = (t: string, at: number) => ((t.slice(0, at).match(/"/g) ?? []).length % 2) === 1;

/**
 * bf26: the last pass over every running sentence the Brief composes (paragraph text, quadrant cells, chart titles
 * - never headings, leads that are just a buyer's name, tables or scoreboard figures):
 *  - text quoted from the map's positions and levers, written to "you", about the tracker's brand by name;
 *  - a buying situation's label as words (buyerPhrase), never inside quotes;
 *  - "never" / "every" for 0% / 100% in the sentence shapes the Brief uses;
 *  - the cards' vocabulary ("agrees the worry is fair", "what the AI tells buyers to look for").
 */
function voiceText(t: string, c: Ctx): string {
  if (!t) return t;
  const B = c.brand;
  const Bs = poss(B);
  let x = t
    // The map's sentences written to the client.
    .replace(/\ban argument that comes up more when you win\b/g, `an argument that comes up more when ${B} wins`)
    .replace(/\bwhen you win\b/g, `when ${B} wins`)
    .replace(/\bwhen you lose\b/g, `when ${B} loses`)
    .replace(/\banswers that pick you\b/g, `answers that pick ${B}`)
    .replace(/\bWhen your own customer\b/g, `When ${Bs} own customer`)
    .replace(/\byour own customers\b/g, `${Bs} own customers`)
    .replace(/\bYour customers\b/g, `${Bs} customers`)
    .replace(/\byour customers\b/g, `${Bs} customers`)
    .replace(/\bAsked by your customers\b/g, `Asked by ${Bs} customers`)
    .replace(/\balongside you\b/g, `alongside ${B}`)
    .replace(/\bagainst your (\d+%|<1%)/g, `against ${Bs} $1`)
    .replace(/\bthe matchups you win \/ lose\b/g, `the matchups ${B} wins / loses`)
    .replace(/\bagainst you\b/g, `against ${B}`)
    .replace(/\bwins for you\b/g, `wins for ${B}`)
    .replace(/\brecommending you\b/g, `recommending ${B}`)
    .replace(/\bhelps you\b/g, `helps ${B}`)
    .replace(/\bin your category\b/g, "in the category")
    .replace(/\byour wins\b/g, `${Bs} wins`)
    // The cards' vocabulary.
    .replace(/\bwarranted\b/g, "fair")
    .replace(/\bthe criteria the AI teaches lead with\b/g, "what the AI tells buyers to look for leads with")
    .replace(/\bthe criteria the AI teaches\b/g, "what the AI tells buyers to look for")
    .replace(/\bteaches buyers to weigh\b/g, "tells buyers to look for")
    .replace(/\bThe worry it backs most\b/g, "The worry it agrees with most")
    // "Never" and "every" at the extremes.
    .replace(/\b(the AI) picks (.+?) in 0% of the answers that pick one of them\b/g, "$1 never picks $2 when it picks one of the two")
    .replace(/\b(the AI) picks (.+?) in 100% of the answers that pick one of them\b/g, "$1 always picks $2 when it picks one of the two")
    .replace(/\b(the AI) picks (.+?) 0% of the time it picks one of (?:them|the two)\b/g, "$1 never picks $2 when it picks one of the two")
    .replace(/\b(the AI) picks (.+?) 100% of the time it picks one of (?:them|the two)\b/g, "$1 always picks $2 when it picks one of the two")
    .replace(/\bis judged worth it over a cheaper option in 0% of answers and not worth it in\b/g, "is never judged worth it over a cheaper option and is judged not worth it in")
    .replace(/\bis judged worth it over a cheaper option in 0% of answers\b/g, "is never judged worth it over a cheaper option")
    .replace(/\bthe AI says yes in 0% of answers\b/g, "the AI never says yes")
    .replace(/\bin 100% of the answers that judge it\b/g, "in every answer that judges it")
    .replace(/\bin 0% of the answers that judge it\b/g, "in none of the answers that judge it")
    .replace(/\btells them to go ahead in 0%/g, "never tells them to go ahead")
    .replace(/\btakes 0% of the picks\b/g, "takes none of the picks")
    .replace(/\bpicked in 0%/g, "never picked")
    .replace(/\bsays (\w+) in 0% of answers and (\w+) in 0%/g, "never says $1 or $2")
    .replace(/\bsays (\w+) in 0% of answers and\b/g, "never says $1, and says")
    .replace(/\btells them to stay in 0%/g, "never tells them to stay");
  // Buying situations as words (longest label first; never inside quotes; a possessive left as written).
  const labels = [...new Set(c.rooms.map((r) => r.room.trim()))].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const L of labels) {
    // The map's possessive form ("In <label>'s problem questions").
    x = x.replace(new RegExp(`\\b(In|in) ${escRe(L)}['’]s problem questions\\b`, "g"), (_m, inW: string) => `${inW} the problem questions of ${buyerPhrase(L)}`);
    const re = new RegExp(`(?<![\\w"-])${escRe(L)}(?![\\w'’-])`, "g");
    x = x.replace(re, (m, at: number, full: string) => {
      if (inQuotes(full, at)) return m;
      const before = full.slice(0, at);
      const start = before.trim() === "" || /[.!?:]\s+$/.test(before);
      return buyerPhrase(L, { start });
    });
  }
  return x;
}

/** bf29: "every" at the top of the scale in memo sentences (the cards keep their figures - they are the receipts). */
const everyWords = (t: string) =>
  t
    .replace(/\bin 100% of the answers that pick (.+?)([,.;]| against| and)/g, (_m, who: string, end: string) => `in every answer that picks ${who}${end}`)
    .replace(/\bin 100% of those answers\b/g, "in all of those answers")
    .replace(/\bin 100% of (?:the )?answers\b/g, "in every answer");

/** bf26: the voice pass over a memo's sentences (headings, leads that name a buyer, rows and tables stay as written). */
function voiceMemo(sections: BriefSection[], c: Ctx): BriefSection[] {
  const para = (p: BriefPara): BriefPara => {
    const text = everyWords(voiceText(p.text, c));
    // A pin's `at` phrase follows the words it links (a phrase the pass rewrote keeps its link).
    const cells = p.cells?.map((a) => {
      if (!a.at || text.includes(a.at)) return a;
      const v = voiceText(a.at, c);
      return text.includes(v) ? { ...a, at: v } : a;
    }).map((a) => ({ ...a, label: voiceText(a.label, c) }));
    return { ...p, text, ...(cells ? { cells } : {}), ...(p.lead && !c.rooms.some((r) => norm(r.room) === norm(p.lead!.replace(/[.]$/, ""))) ? { lead: voiceLead(p.lead, c) } : {}) };
  };
  return sections.map((s) => ({
    ...s,
    ...(s.paras ? { paras: s.paras.map(para) } : {}),
    ...(s.quads ? { quads: s.quads.map((q) => ({ ...q, cells: [q.cells[0].map(para), q.cells[1].map(para)] as [BriefPara[], BriefPara[]] })) } : {}),
    ...(s.viz
      ? {
          viz: {
            ...s.viz,
            title: voiceText(s.viz.title, c),
            ...(s.viz.subtitle ? { subtitle: voiceText(s.viz.subtitle, c) } : {}),
          },
        }
      : {}),
  }));
}

/** A lead (bold opening) in the Brief's voice: the map's and the insights' second person only - buyer labels in a
 * lead read as the heading they are. */
function voiceLead(lead: string, c: Ctx): string {
  return lead
    .replace(/\bwhen you win\b/g, `when ${c.brand} wins`)
    .replace(/\bThe worry it backs most\b/g, "The worry it agrees with most");
}

/** bf26: an answer card in the Brief's voice - its sentences and row words (figures as stated: the number links read them). */
function voiceCard(card: AnswerCard, c: Ctx): AnswerCard {
  const B = c.brand;
  const words = (t: string) =>
    t
      .replace(/\bbrings buyers to you\b/g, `brings buyers to ${B}`)
      .replace(/\btoward you\b/g, `toward ${B}`)
      .replace(/\baway from you\b/g, `away from ${B}`)
      .replace(/\bA reason to leave you\b/g, `A reason to leave ${B}`)
      .replace(/\bto pick you\b/g, `to pick ${B}`)
      .replace(/\bto leave you\b/g, `to leave ${B}`)
      .replace(/\byour picks\b/g, `${poss(B)} picks`)
      .replace(/\bYour picks\b/g, `${poss(B)} picks`)
      .replace(/\bYour share\b/g, `${poss(B)} share`)
      .replace(/\byour share\b/g, `${poss(B)} share`)
      .replace(/\bwarranted\b/g, "fair");
  return {
    ...card,
    crumb: words(voiceText(card.crumb, c)),
    headline: words(voiceText(card.headline, c)),
    rows: card.rows.map((r) => ({ ...r, label: words(voiceText(r.label, c)), value: words(r.value) })),
    ...(card.lifts ? { lifts: card.lifts.map((l) => ({ ...l, label: words(voiceText(l.label, c)), ...(l.wins ? { wins: words(l.wins) } : {}), ...(l.others ? { others: words(l.others) } : {}) })) } : {}),
    ...(card.liftSides ? { liftSides: card.liftSides.map((x) => words(voiceText(x, c))) as [string, string] } : {}),
  };
}

/* ---------------------------------- compute -------------------------------- */

/** True when some other brand out-picks `key` (a rival subject's archetype: trailing = specialist). */
const leaderOfBrands = (s: BrandSummaryView, key: string) => {
  const me = s.brands.find((b) => b.key === key);
  return s.brands.some((b) => b.key !== key && me && b.chosen.k > me.chosen.k);
};

export interface BriefRequest extends ViewRequest {
  /** The subject brand as written (display name or alias); absent = the target. */
  subject?: string;
}

export async function computeBrief(data: ViewData, request: BriefRequest = {}): Promise<BriefView> {
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  // The summary and the map (placements of the full ranked list, cell stats)
  // from the per-load shared computes (view_data computeMemo). READ-ONLY.
  const { view: summary, inputs } = await sharedBrandSummary(data, eng);
  const { view: map, debug, ranked } = await sharedAnalysisMap(data, eng);
  // The map's own matcher places every ranked insight (the same order as probeInsights).
  const placements = new Map<string, string>();
  (debug.placements ?? []).forEach((pl, i) => {
    const ins = ranked[i];
    if (ins && pl.cellId && map.positions[pl.cellId]) placements.set(placementKey(ins.key, ins.title), pl.cellId);
  });
  const stats = debug.cells;
  const resolve = buildResolver(data.dictionary, data.judged);
  const target = summary.target;
  const brand = data.project.brand;

  // Subjects: the target, then every brand in the table.
  const subjects = [target, ...summary.brands.filter((b) => b.key !== target.key)];
  let subject = target;
  if (request.subject) {
    const want = matchKey(request.subject);
    const rk = resolve(request.subject).key;
    subject = subjects.find((b) => matchKey(b.name) === want || b.key === rk) ?? target;
  }
  const isTarget = subject.key === target.key;
  const name = isTarget ? brand : subject.name;

  // Buying situations in setup order, each read through the headline.
  const desc = roomDescriptions(data.setupDecision);
  const roomList: string[] = [];
  for (const it of [...data.intents].sort((a, b) => a.seq - b.seq))
    if (it.situation && viewsOf(it.stage, it.angle).includes("headline") && !roomList.includes(it.situation)) roomList.push(it.situation);
  const rooms: RoomRead[] = roomList.map((room) => {
    const h = computeHeadline(data, { room, ...eng });
    return {
      room,
      description: desc.get(room.trim()) ?? null,
      firm: h.firmPickInCategory,
      answers: h.answers,
      brands: h.brands.map((b) => ({ key: b.key, name: b.name, chosen: b.chosen.k, share: b.shareOfDecided })),
    };
  });

  let vsTarget: Ctx["vsTarget"] = null;
  if (!isTarget) {
    const r = summary.headToHead.find((x) => x.key === subject.key);
    if (r) vsTarget = { won: cell(r.lost.k, r.won.k + r.lost.k), n: r.answers };
  }

  // Every brand's picks by stage, over the headline pool (the subject's feeds
  // the funnel paragraph; every brand's, its answer card) and each brand's
  // argument lift - shared with the brand dossiers (answer_cards.ts).
  const { src, byStage } = cardSourcesOf(data, eng, summary, inputs);
  const stagePicks = byStage.get(subject.key) ?? new Map<string, number>();
  const liftOf = src.liftOf;
  const product = src.product;

  // bf26: the same detectors in the Brief's style, about the target by name (the served ones stay second person).
  const voiced = new Map<string, Insight>(
    isTarget
      ? rankedInsights(summary, inputs, {
          name: brand,
          cardArg: (code, side) => cardArgOf(map, true, brand, code, side === "you" ? "subject" : "other"),
          cardStep: (id, step, seg) => map.positions[id]?.panel?.steps.find((x) => x.key === step)?.segments?.find((x) => x.key === seg)?.num.value ?? null,
        }).map((i) => [i.key, i])
      : []
  );
  // The served finding the map placed on a cell (the strongest first) - a move there is that finding's move.
  const onCell = new Map<string, Insight>();
  for (const i of summary.insights) {
    const id = placements.get(placementKey(i.key, i.title));
    if (id && !onCell.has(id)) onCell.set(id, i);
  }
  const findingAt = (cellId: string) => onCell.get(cellId);
  const engineCount = summary.core.length;
  const month = monthOf(data.run);
  const wave = await waveOf(data.run);
  const ctx: Ctx = {
    data,
    summary,
    inputs,
    map,
    stats,
    ranked,
    isTarget,
    target,
    subject,
    brand,
    name,
    product,
    rooms,
    lift: liftOf(subject.key),
    vsTarget,
    moves: isTarget ? movesOf(map, stats, brand, findingAt) : [],
    findings: [],
    placements,
    stagePicks,
    archetype: isTarget ? map.casting.archetype : leaderOfBrands(summary, subject.key) ? "specialist" : "default",
    footer: `${name} - wave ${wave}${month ? ` - ${month}` : ""}.`,
    wave,
    cards: new Map(),
    src,
    voiced,
    roomLift: debug.roomLift,
    roomCodes: debug.roomCodes,
  };

  ctx.findings = findingsOf(ctx);
  const sw = swotOf(ctx);
  // bf33: every number opens the card that shows it beside its subject (brief_links.ts), resolved here.
  const resolver = linkResolver(map, linkTerms(ctx), [...(ctx.summary.reasonLift ?? []).map((l) => l.code), ...(ctx.inputs.taught ?? []).map((t) => t.code)]);
  const memo = (frame: BriefFrame, sections: BriefSection[]): BriefMemo =>
    // bf34: numbers link against the unit's full anchor list (a Map card shows figures the Brief's own answer card
    // does not), then the pins are pruned to the answer cards that state them.
    citePins(linkMemo({ frame, title: `${name} - ${BRIEF_FRAME_LABELS[frame]} - wave ${ctx.wave}`, sections: voiceMemo(sections, ctx), footer: ctx.footer }, ctx, resolver), ctx.cards);
  const memos: Record<BriefFrame, BriefMemo> = {
    now_what: memo("now_what", nowWhat(ctx)),
    diagnosis: memo("diagnosis", diagnosisFrame(ctx)),
    swot: memo("swot", swotFrame(ctx, sw)),
    funnel: memo("funnel", funnelFrame(ctx)),
    matrix: memo("matrix", matrixFrame(ctx)),
    jobs: memo("jobs", jobsFrame(ctx)),
  };
  // Only the cards a surviving pin opens ride the payload.
  const cards: Record<string, AnswerCard> = {};
  for (const m of Object.values(memos))
    for (const id of anchorIds(m)) {
      const card = ctx.cards.get(id);
      if (card) cards[id] = voiceCard(card, ctx);
    }
  return { subject: name, subjects: subjects.map((b) => (b.key === target.key ? brand : b.name)), memos, engineCount, cards };
}

/* ------------------------------ bf33: number links ------------------------------ */

/** The subjects a Brief number can be about: every rival, argument, buying situation and worry (never the tracker's own brand). */
export function linkTerms(c: Ctx): string[] {
  const out = new Set<string>();
  for (const b of c.summary.brands) if (b.key !== c.target.key) out.add(b.name);
  for (const l of c.summary.reasonLift ?? []) out.add(l.code);
  for (const t of c.inputs.taught ?? []) out.add(t.code);
  for (const r of c.rooms) out.add(r.room);
  for (const it of c.data.intents) if (it.concern) out.add(it.concern);
  for (const r of c.map.rivalPanels ?? []) out.add(r.name);
  return [...out];
}

/** bf34: figures no card shows that a Data page table does (Tyler: a buyer's figure against "the other buying
 * situations" opens the table of that measure by buying situation - each situation its own row; the pivot has no
 * "every other situation" row, so the pooled figure itself is not on it). */
const TABLE_FIGURES: { re: RegExp; dest: Extract<BriefLink["dest"], { kind: "table" }> }[] = [
  {
    re: /(\d+(?:\.\d+)?%) for the other buying situations/g,
    dest: { kind: "table", entry: "routed_room", pool: "awareness_routing", measures: ["routed_adjacent"], row: "room" },
  },
];

function linkUnit(c: Ctx, R: LinkResolver, text: string, anchors: BriefAnchor[] | undefined, context = ""): BriefLink[] {
  const out: BriefLink[] = [];
  const tableAt = new Map<number, Extract<BriefLink["dest"], { kind: "table" }>>();
  for (const f of TABLE_FIGURES) for (const m of text.matchAll(f.re)) tableAt.set(m.index!, f.dest);
  const cells: string[] = [];
  const rivals: string[] = [];
  for (const a of anchors ?? []) {
    if (c.map.positions[a.id]) cells.push(a.id);
    else if (a.id.startsWith("card:brand:")) {
      const key = a.id.slice("card:brand:".length);
      if (key === c.target.key) cells.push(OPEN_ALL);
      else {
        const b = c.summary.brands.find((x) => x.key === key);
        if (b) rivals.push(b.name);
      }
    }
  }
  const seen = new Map<string, number>();
  for (const m of text.matchAll(NUMBER_TOKEN)) {
    const token = m[0];
    const occurrence = seen.get(token) ?? 0;
    seen.set(token, occurrence + 1);
    const table = tableAt.get(m.index!);
    if (table) {
      out.push({ token, occurrence, dest: table });
      continue;
    }
    const { local, sentence } = numberContext(R, text, m.index!, m.index! + token.length, context);
    const hit = R.find(token, local, sentence, { cells, rivals });
    if (hit) {
      out.push({ token, occurrence, dest: hit.dest.kind === "cell" ? { kind: "cell", id: hit.dest.id } : { kind: "rival", name: hit.dest.id }, ...(hit.reveal ? { reveal: hit.reveal } : {}) });
      continue;
    }
    // No card shows it beside its subject: the Brief's own answer card, the first pin whose card states it.
    const card = (anchors ?? []).find((a) => {
      const cd = c.cards.get(a.id);
      return cd && briefNumberTokens(cardText(cd)).has(token);
    });
    if (card) out.push({ token, occurrence, dest: { kind: "card", id: card.id } });
  }
  return out;
}

function linkMemo(memo: BriefMemo, c: Ctx, R: LinkResolver): BriefMemo {
  // bf34: on a rival's Brief a unit that names no one ("Recommended 44%") is about the rival.
  const subjectCtx = (text: string) => (!c.isTarget && R.terms(text).length === 0 ? c.name : "");
  const para = (p: BriefPara): BriefPara => {
    // A paragraph's lead is its subject when it is a buying situation's name (By buying situation).
    const room = p.lead && c.rooms.find((r) => norm(r.room) === norm(p.lead!.replace(/[.]$/, "")));
    const text = `${p.lead ?? ""} ${p.text}`;
    const links = linkUnit(c, R, text, p.cells, [room ? room.room : "", subjectCtx(text)].filter(Boolean).join(" "));
    return links.length ? { ...p, links } : p;
  };
  return {
    ...memo,
    sections: memo.sections.map((s) => ({
      ...s,
      ...(s.paras ? { paras: s.paras.map(para) } : {}),
      ...(s.quads ? { quads: s.quads.map((q) => ({ ...q, cells: [q.cells[0].map(para), q.cells[1].map(para)] as [BriefPara[], BriefPara[]] })) } : {}),
      ...(s.rows
        ? {
            rows: s.rows.map((r) => {
              if (!r.cell || r.kind === "note") return r;
              const links = linkUnit(c, R, r.value, [r.cell], [r.label, subjectCtx(`${r.label} ${r.value}`)].filter(Boolean).join(" "));
              return links.length ? { ...r, links } : r;
            }),
          }
        : {}),
    })),
  };
}

/* ----------------------------------- cache --------------------------------- */

// bf1 (2026-11-04): first version - seven frames, subject shift, the two-pick-numbers convention.
// bf2 (2026-11-04): Tyler's review - now_what follows the exemplar memo (one-paragraph verdict, funnel break, numbered findings, conditions); the other frames drop the shared verdict block and open on their own structure.
// bf3 (2026-11-04): the library exemplars mirrored - funnel stages renamed + hourglass, matrix on the exemplar's quadrants and lines (visible > 50% named, converting = share >= named / 4) + scatter, by-situation pairs, Minto pyramid.
// bf6 (2026-11-05): the footer names the brand, wave and month, never the assistant count.
// bf7 (2026-11-05): the funnel's pick stage carries the recommended-to-pick conversion, like the library memo.
// bf8 (2026-11-05): the conversion is also drawn in the hourglass, in the narrowing under the shortlist band.
// bf9 (2026-11-05): the gap note is removed (the conversion stays in the pick reading) and the middle stage
// is "Recommended" everywhere - "On the shortlist" read as a second metric beside the scoreboard's term.
// bf10 (2026-11-05): reads the am7 map (first-of-row All cells); pooled cells are excluded from the moves
// and the SWOT strengths - the verdict paragraph already carries the market totals.
// bf11 (2026-11-06): paragraphs and scoreboard rows carry map anchors (BriefPara.cells / BriefRow.cell) - the facts link into The Map.
// bf12 (2026-11-06): insight pins are denominator-first (PIN_RULES) - a pooled finding pins the cell whose pool its numbers come from, the matcher's named cell second where it adds the story.
// bf13 (2026-11-06): the citation ruling - after composition every pin on a numbered paragraph or row must share one of its numbers with its panel (RULE 1, citePins); reads the am9 map, whose figures state every cited number (RULE 2, scripts/brief_citation_harness.mts); PIN_RULES gain room_win / room_value (both named situations), rival_h2h and leak_problem (the pooled cell second) and the engine keys (the pooled open panel); the argument findings and SWOT argument items pin the pooled open cell.
// bf14 (2026-11-07): the answer cards - every pin opens a card that answers one question (cell / brand / engines / condition, answer_cards.ts) and the payload carries them (BriefView.cards); RULE 1 checks a pin against its card's text and drops a brand / engines / condition card whose shared numbers an earlier pin already states; reads the am10 map, whose pooled open-choice panel slimmed back to its own question - every other brand's funnel, the stage / room / question splits, the assistants and the conditions now cite brand, engines and condition cards. No sentence text changed.
// bf15 (2026-11-07): the fact is the link - the trailing pins are gone; a number in the sentence opens its card. BriefAnchor gains `at` (the exact phrase a numberless unit's anchor attaches to: a TOWS play's own item, a Minto move's watch phrase, a thin situation's name); citePins strips `at` on numbered units and drops a numberless unit's anchor whose `at` is absent from its text. No sentence text changed.
// bf16 (2026-11-07): reads the am11 map - the open-choice card's argument lines now come from the position's lifts (every code the brief cites there, plus the panel's top arguments); the panel states each code once. No sentence text changed.
// bf17 (2026-11-07): reads the am12 map - a cell card carries its arguments as `lifts` (+ liftSides) and draws them like the map panel (bars + share sub-lines) instead of the verbose "argument in the lift" text rows; cardText states each lift's label, shares and signed points, so RULE 1 and the number links claim them unchanged. No sentence text changed.
// bf18 (2026-11-08): the condition card reads in the reason language (the owner's ruling) - headline "When the AI gives buyers a reason to leave <brand>, the most common is ...", rows "A reason to leave you: ...", "The biggest reason to pick you / to leave you / pointing to <rival>"; a default-shaped branch ("otherwise", isDefaultCondition) leaves the list for one "The default - when no stated reason applies" row unless a brief sentence cites it. Every number the card stated before is still stated. No sentence text changed.
// bf19 (2026-11-09): reads bs12 - the condition insight's title and body (quoted verbatim in the findings) say "reason"; the exemplar's own "The conditions that decide it" section heading is deliberately kept.
// bf20 (2026-11-09, the owner's ruling: cite a non-Build-a-table surface whenever one exists): the answer cards' go links repoint - a rival's brand card opens its Rivals dossier (hasDossier, the dossiers' own membership rule), the target's opens the map's pooled open-questions contest, the engines card opens Stations (Consideration's by-engine table); Build a table only as the fallback. Go links are not in the written layer's fact sheet, so written frames stay cached. No sentence text changed.
// bf21 (2026-11-10): the plain-wording pass - reads bs13 / am15 (new move names, lever sentences and insight wording quoted in the memos); actOf restates the new levers; the conditions paragraph, the condition card, the SWOT wall and the jobs wall lines say what sends buyers away and "a fixed situation" instead of "routes" / "wall" / "reason". The exemplar's "The conditions that decide it" heading is kept. Numbers unchanged.
// bf22 (2026-11-12): the reasons harmonization - reads bs17 / am22: the conditions paragraph, the condition card and the away-condition finding name the run's reason THEMES (dt4) where a theme map exists (raw condition groups only without one); the paragraph's tips count statements on a themed side.
// bf23 (2026-11-13, one counting rule - reads bs21): with reason themes the conditions paragraph counts each side's themes at ANSWER grain over that side's own answer base, and the condition card lists the themes at answer grain, names the lead away theme (quoting its most-stated wording) and gives the away_condition finding's blocker and fixed-situation wordings their own rows on the same base. Keyless output unchanged.
const BRIEF_VERSION = "bf34"; // bf34 (2026-11-17, Tyler: the Brief and the cards read the same figure): Value doubts quote the Value card ("points the buyer to a rival instead in X% of answers and to only <brand>'s own cheaper option in Y%", shares of all its answers); an argument is cited only when the What to buy card shows it in that side's top three, with the card's figures (the matchups won-vs-lost argument finding is not cited - no card sets it out); the conditions paragraph reads the What to buy card's own rows and shares; the away-condition finding's share is the card's (its cell's away row); one worry is set against the all-worries card's figure; a buyer's figure against the other buying situations opens a Data page table (BriefLink dest "table"); "Its picks come X% from ..." and "recommended in N% - M% of the answers that name it" are gone; numbers link before the answer-card pins are pruned. // bf33 (2026-11-17): every number carries its link (BriefPara/BriefRow.links), resolved at compose time against the index of what each card shows (panel_index.ts, brief_links.ts) - the card that shows it beside its subject, with the one interaction that shows it, else the Brief's own answer card; a rival card's onward link names the rival (it passed the dictionary key). // bf32 (2026-11-17): the scoreboard's average-competitor share of picks and picked figures are the What to buy card's own. // bf31 (2026-11-17): the diagnosis threat section is about the rival its heading names (what sends buyers to it, the widest gap), then "Others who take buyers"; a rival one AI company carries is a threat there, only at the detector bar and 1.5x the questions it answers; no "thinner than it looks"; customers looking around read stay / leave only when it says something; conditions read "Buyers who say ... are most often sent away"; the untaught argument line is plain; fixed-situation moves name the situation; every row type has a place name; a bare fact-check move on a non-contest row is dropped. // bf30 (2026-11-17): a move taken from a finding keeps the object after its colon ("build on the exception - aim at the buyers ...") in the SWOT, diagnosis and By buying situation actions. // bf29 (2026-11-16, Tyler's rulings): "The diagnosis" frame after Now what? (conversion, price, the winning argument, the threat, where to act - its own templates); TOWS and Situation - complication - resolution retired (frames, pairing helpers, the SWOT items' TOWS phrases, the pyramid); moves that share an action are one move naming every place (no back-reference stubs) in every frame; the SWOT fills each quadrant by the kind of fact, leads every item, keeps one fact in one quadrant and adds "What to do"; the funnel's stages take the scoreboard's two-table layout (competitorColumns, one source) and "Customers with a worry told to stay"; Visibility vs conversion reads conversion as recommendations that end as the pick (a level line for the charted brands together), drops class brands, folds rarely named or picked brands into one note and one table line, defines the quadrants under the chart and closes on a so-what; By buying situation sorts nearest first, says why from each buyer's own answers (the map's roomLift), states all three Value sides and closes on nearest / furthest and one move; the Brief-style insight bodies state shares in plain words. // bf28 (2026-11-16): the scoreboard is two tables on the tracker's own Brief - four rows against the average and the most-picked competitor, then the rows about the brand's own questions; the commit rate is a sentence. // bf27 (2026-11-16): the Now what scoreboard carries the average competitor beside the subject's named, recommended, share of picks and picked rows (the competitors the what-to-buy card lists; class brands left out). // bf26 (2026-11-16): one voice - the subject in the third person everywhere (the insights re-run in the Brief's style, the moves' third-person form, the map's levers and claims voiced), buyers as words, never / every at the extremes, the cards' vocabulary, a finding's move on its cell, no move sentence twice in a frame. // bf25 (2026-11-13): the conditions line reads "rarely names one winner for every buyer" (was "a rule, not a winner"). // bf24 (2026-11-13): themed conditions name one destination only when it takes half their answers; the fixed-situation line leads with the finding wording.

/**
 * The brief through the cache. cachedView's keying, with the subject as one
 * more request-data suffix: `:sub:<sha-12 of the subject's match key>` (only
 * when the subject is not the target), then `:eng:` as cachedView appends it.
 * Implemented here rather than in view_data.ts so cachedView stays
 * byte-identical for every other view; the purge keeps the unfiltered key as
 * its LIKE prefix exactly as cachedView's does.
 */
export async function computeBriefCached(run: Run, project: Project, request: BriefRequest = {}): Promise<BriefView | null> {
  const r: BriefRequest = { ...requestOf(request) };
  const sub = request.subject?.trim() ? matchKey(request.subject) : "";
  if (sub && sub !== matchKey(project.brand)) r.subject = request.subject!.trim();
  const source = await store.getCodesSource(project.id);
  if (!source) return null;
  const rev = await cachedRunRevision(run.id);
  const setupDecision = await store.getSetupDecision(project.id);
  const extras = [setupDecision, `ctx:${CONTEXT_JUDGE_VERSION}:${CONTEXT_JUDGE_MODEL}`, `resolve:${RESOLVE_VERSION}`];
  const projectHash = createHash("sha256")
    .update(JSON.stringify([project.brand, project.competitors, project.engine_set, ...extras]))
    .digest("hex")
    .slice(0, 12);
  // The fold (2026-11-09): the brief embeds summary insights and map figures,
  // so their versions ride the key; the written layer stays content-addressed
  // (the sheet hash), so a fold-triggered recompute whose text is unchanged
  // re-writes nothing.
  const prefix = `brief:${BRIEF_VERSION}.${ANALYSIS_MAP_VERSION}.${BRAND_SUMMARY_VERSION}:${run.id}:`;
  const base = `${prefix}${source}:${project.dictionary_version}:${projectHash}:${rev}`;
  let key = base;
  if (r.subject !== undefined) key += `:sub:${createHash("sha256").update(matchKey(r.subject)).digest("hex").slice(0, 12)}`;
  if (r.engines !== undefined) key += `:eng:${createHash("sha256").update(r.engines.join(",")).digest("hex").slice(0, 12)}`;
  if (rev !== null) {
    const raw = await store.cacheGet(key, VIEW_CACHE_MS);
    if (raw) return JSON.parse(raw) as BriefView;
  }
  const data = await loadViewData(run, project, { setupDecision: true, judge: true });
  if (!data) return null;
  data.revision = rev;
  const view = await computeBrief(data, r);
  if (rev !== null && !data.judgeIncomplete) {
    await store.cacheSet(key, JSON.stringify(view), { brand: project.brand, category: project.category, projectId: project.id });
    await store.cachePurge(prefix, base);
  }
  return view;
}
