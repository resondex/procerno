import { createHash } from "node:crypto";
import { matchKey } from "../brand_key";
import { store } from "../store";
import { cachedRunRevision } from "./run_revision";
import { buildResolver } from "./brand_resolve";
import { BRAND_SUMMARY_VERSION, sharedBrandSummary, type BrandSummaryView, type SummaryBrand } from "./brand_summary";
import { ANALYSIS_MAP_VERSION, sharedAnalysisMap, type MapCellStat } from "./analysis_map";
import { computeHeadline } from "./headline";
import { CONTEXT_JUDGE_MODEL, CONTEXT_JUDGE_VERSION } from "./context_judge";
import { pctFine, type Insight, type InsightInputs } from "./summary_insights";
import { cell, loadViewData, requestOf, VIEW_CACHE_MS, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { viewsOf } from "./views";
import type { AnalysisMapView, Position } from "./analysis_types";
import { hasDossier } from "./dossiers";
import { BRAND_CARD, BUILD_A_TABLE, CONDITION_CARD, ENGINES_CARD, brandCard, cardSourcesOf, cardText, cellCard, conditionCard, enginesCard, type CardSources } from "./answer_cards";
import {
  BRIEF_FRAME_LABELS,
  type AnswerCard,
  type BriefAnchor,
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
 * The Brief pill (2026-11-04, BRIEF_PILL_DESIGN_2026-11-04.md): all seven
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
  return b && hasDossier(c.summary, key) ? { label: `Open the ${b.name} dossier`, target: "rivals", brand: key } : BUILD_A_TABLE;
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

/** One SWOT entry: a one-sentence `text`, a noun phrase for the TOWS
 * templates, and (opportunities) a verb phrase. */
interface Item {
  text: string;
  short: string;
  act?: string;
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

/** The lay "where" of a map cell, its act preposition and its watch metric. */
function cellWords(row: string, label: string, brand: string): { lead: string; prep: string; watch: string } {
  switch (row) {
    case "open":
      return { lead: label, prep: `for ${label}`, watch: `${poss(brand)} share of picks for ${label}` };
    case "social":
      return { lead: "What most buyers pick", prep: "when buyers ask what most people pick", watch: `${poss(brand)} share of picks when buyers ask what most people pick` };
    case "awareness":
      return label
        ? { lead: `${label} - before they know what to buy`, prep: `in ${poss(label)} problem questions`, watch: `how often the AI recommends ${brand} in ${poss(label)} problem questions` }
        : { lead: "Before buyers know what to buy", prep: "in problem questions", watch: `how often the AI recommends ${brand} in problem questions` };
    case "explainer":
      return { lead: "Learning the category", prep: "when buyers learn the category", watch: `how often the AI recommends ${brand} when buyers learn the category` };
    case "value": {
      // The map labels a Value cell "<room> - <line>" (either part may be absent).
      const [room, line] = label.includes(" - ") ? label.split(" - ") : [label, ""];
      const what = line || brand;
      return {
        lead: label ? `Worth the price - ${label}` : "Worth the price",
        prep: room ? `for ${room}` : "on price",
        watch: `how often the AI calls ${what} worth it${room ? ` for ${room}` : ""}`,
      };
    }
    case "premium":
      return { lead: "Premium versus basic", prep: "when buyers weigh premium against basic", watch: `${poss(brand)} share of picks when buyers weigh premium against basic` };
    case "criteria":
      return {
        lead: label ? `What the AI tells ${label} to weigh` : "What the AI tells buyers to weigh",
        prep: label ? `for ${label}` : "",
        watch: `how often the AI teaches the arguments that win for ${brand}`,
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
      return { lead: "Your customers looking around", prep: "with your own customers", watch: "how often your customers are told to stay when they look around" };
    case "repertoire":
      return { lead: "Habit buyers", prep: "with habit buyers", watch: `how often habit buyers are told to stick with ${brand}` };
    case "settled":
      return { lead: `Your customers - ${label}`, prep: `with your customers on ${label}`, watch: `how often the AI strengthens the relationship on ${label}` };
    default:
      return { lead: label || "This contest", prep: "", watch: `${poss(brand)} share of picks` };
  }
}

/** "Today" in the cell's own unit. */
function todayOf(st: MapCellStat): string {
  const youD = pctN(st.d > 0 ? st.you / st.d : 0);
  const themD = pctN(st.d > 0 ? st.them / st.d : 0);
  const youN = pctN(st.n > 0 ? st.you / st.n : 0);
  switch (st.row) {
    case "open":
    case "social":
    case "premium":
    case "leavers":
    case "h2h":
      return `today you take ${youD} of the picks against ${themD} for ${st.taker}`;
    case "value":
      return `today ${youN} of the answers call it worth it`;
    case "buyers":
      return `today ${youN} of these buyers are told to go ahead`;
    case "customers":
    case "hold":
      return `today ${youN} are told to stay`;
    case "awareness":
    case "explainer":
      return `today the AI recommends you in ${youN} of these answers`;
    case "criteria":
      return `today ${youN} of these answers teach an argument that wins for you`;
    case "repertoire":
      return `today ${youN} are told to stick with you`;
    case "settled":
      return `today the AI strengthens the relationship in ${youN}`;
    default:
      return `today you hold ${youD}`;
  }
}

/** The map's lever (analysis_map.ts LEVER) as a short verb phrase, for the
 * sentences that carry a move inside another sentence (SWOT, TOWS, Minto).
 * One template per triage and lever variant - the same variants the map
 * chooses between, never new strategy. */
function actOf(p: Position, st: MapCellStat): string {
  // bf21: the am15 plain-wording pass - each phrase restates its lever sentence.
  switch (p.triageSuggested) {
    case "record_wrong":
      return "correct the out-of-date facts in the sources the AI draws on";
    case "proof_missing":
      return st.row === "criteria"
        ? "get your strongest point into the guides the AI draws on when it teaches buyers what to look for"
        : st.row === "buyers"
          ? "publish the evidence that answers this worry where the AI looks for it"
          : "publish the evidence for your side where the AI looks for it";
    case "strategy_misfit":
      return st.wall
        ? "stop arguing against the fixed situation and aim at the buyers it does not apply to"
        : st.badges.includes("leak")
          ? "cover everything this buyer needs, or decide to leave this buyer to others"
          : "build a case that works for the typical buyer, or accept being the specialist";
    case "product_truth":
      return "check what the AI says against your own data before writing anything";
    case "earned":
      return "keep the proof behind this current and easy for the AI to find";
    case "overclaimed":
      return "build the proof where buyers ask without being prompted";
    case "windfall":
      return "find out how much of this demand moves to your own cheaper option and how much leaves";
  }
}

function movesOf(map: AnalysisMapView, stats: Record<string, MapCellStat>, brand: string): Move[] {
  const deficits = Object.values(map.positions)
    // Pooled All cells are the verdict paragraph's ground, not a move - a
    // move names the specific contest to act on.
    .filter((p) => p.status === "deficit" && stats[p.cellId] && !stats[p.cellId].pooled)
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
    const stem = actOf(p, st);
    const act = `${stem}${w.prep ? ` ${w.prep}` : ""}`;
    return {
      cellId: p.cellId,
      row: st.row,
      label: st.label,
      lead: w.lead,
      claim: p.claim,
      lever: sentence(p.lever),
      act,
      actStem: stem,
      family: p.family,
      watch: w.watch,
      today: todayOf(st),
      tip: `${st.you} answers on your side, ${st.them} on ${st.taker}'s, of ${st.d} that take a side; ${st.n} answers in all. The move: ${p.family}.`,
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
  parts.push(
    `${c.isTarget ? "It" : c.name} is named in ${P(S.mentioned)} of answers when buyers ask what to buy and recommended in ${P(S.recommended)}. The AI commits to one ${c.product} in ${P(s.firmPickInCategory)} of answers; when it does, ${c.name} is the pick ${P(S.shareOfDecided)} of the time - ${pctFine(rate(S.chosen))} of all answers.`
  );
  const leader = leaderOf(c);
  if (leader && rate(leader.shareOfDecided) > rate(S.shareOfDecided)) {
    parts.push(`${leader.name} takes ${P(leader.shareOfDecided)} of those picks.`);
    tips.push(`${leader.name}: ${tipOf(leader.shareOfDecided)}.`);
  } else if (leader) {
    parts.push(`No rival takes more; ${leader.name} follows with ${P(leader.shareOfDecided)}.`);
    tips.push(`${leader.name}: ${tipOf(leader.shareOfDecided)}.`);
  }
  const ranked = roomsByShare(c);
  // A buying situation the close names (its rival share lives on that cell).
  let roomPin: string | undefined;
  switch (c.archetype) {
    case "default": {
      const weak = ranked[ranked.length - 1];
      if (weak && weak.top && weak.top.chosen > 0) roomPin = `chooses:open:${norm(weak.r.room)}`;
      parts.push(
        weak && weak.top && weak.top.chosen > 0
          ? `When nothing pulls the buyer elsewhere, the answer is ${c.name}; the contest is over the buyers something does pull - ${weak.r.room}, where ${weak.top.name} takes ${P(weak.top.share)}.`
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
      // "Best ground", not "the right answer for" - the subject can lead its
      // best situations without winning them outright.
      const wins = ranked.filter((x) => x.share.k > 0).slice(0, 2);
      parts.push(
        wins.length
          ? `The ${c.product} the AI describes wins most where the buyer says who they are - ${listOf(wins.map((x) => x.r.room))} ${wins.length > 1 ? "are" : "is"} its best ground; the buyer who doesn't say gets someone else's ${c.product}.`
          : `The ${c.product} the AI describes is for a specific buyer; the buyer who doesn't say who they are gets someone else's ${c.product}.`
      );
    }
  }
  return withCells({ text: parts.join(" "), tip: tips.join(" ") }, cellsOf(c, ...subjectPins(c), leader ? brandPin(c, leader.key) : null, roomPin));
}

const STAGE_WORDS: Record<string, string> = {
  discovery: "general what-should-I-buy questions",
  use_case: "questions where the buyer describes the job they need done",
  social_validation: "questions about what most people pick",
  premium_worth: "questions weighing premium against basic",
};

function funnelBreaks(c: Ctx): BriefPara {
  const S = c.subject;
  const conv = (b: SummaryBrand) => (b.recommended.k > 0 ? b.chosen.k / b.recommended.k : 0);
  const mine = conv(S);
  const parts = [
    `${c.name} is recommended in ${P(S.recommended)} of answers but the pick in ${pctFine(rate(S.chosen))} - only ${pctN(mine)} of its recommendations end as the pick.`,
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
  const total = [...c.stagePicks.values()].reduce((a, b) => a + b, 0);
  if (total >= MIN) {
    const split = [...c.stagePicks.entries()]
      .filter(([st, k]) => k > 0 && STAGE_WORDS[st])
      .sort((a, b) => b[1] - a[1])
      .map(([st, k]) => `${pctN(k / total)} from ${STAGE_WORDS[st]}`);
    if (split.length) parts.push(`Its picks come ${listOf(split)}.`);
    tips.push([...c.stagePicks.entries()].map(([st, k]) => `${st} ${k}`).join(", ") + ` of ${total} picks.`);
  }
  // The pooled open cell states the target's funnel; the subject's card its stage split; each better converter's card its rate.
  return withCells({ lead: "How the funnel breaks.", text: parts.join(" "), tip: tips.join(" ") }, cellsOf(c, OPEN_ALL, BRAND_CARD(S.key), ...better.map((b) => brandPin(c, b.key))));
}

function conditionsPara(c: Ctx): BriefPara | null {
  const k = c.inputs.conditions;
  if (!k) return null;
  const q = (g: { label: string }) => `"${g.label}"`;
  const parts = ["The AI hands the buyer a rule, not a winner - and whoever owns the rule's branches owns the choice."];
  const tips: string[] = [];
  let toward = k.toward;
  let away = k.away;
  let towardCells = k.towardCells;
  let awayCells = k.awayCells;
  // bf23 (bs21, one counting rule): a themed side counts its themes at ANSWER
  // grain over that side's own answer base (distinct answers stating any
  // listed condition); a raw side keeps the question grain.
  let towardBase = k.towardThemed ? k.towardBase ?? 0 : null;
  let awayBase = k.awayThemed ? k.awayBase ?? 0 : null;
  if (!c.isTarget) {
    // A rival's branches: the client's away branch that routes to it, and the client's own branch.
    toward = k.away.filter((g) => g.routes[0]?.name === c.name);
    away = k.toward;
    towardCells = k.awayCells;
    awayCells = k.towardCells;
    [towardBase, awayBase] = [awayBase, towardBase];
  }
  const t = toward.slice(0, 3);
  if (t.length) {
    const scope = `${c.isTarget ? "" : ` from ${c.brand}`}`;
    if (towardBase !== null) {
      parts.push(`The branch toward ${c.name}: ${listOf(t.map(q))} - the largest comes up in ${pctN(towardBase ? (t[0].answers ?? 0) / towardBase : 0)} of the answers where the AI gives any condition that sends buyers to it${scope}.`);
      tips.push(t.map((g) => `${g.label}: ${g.answers ?? 0} of ${towardBase} answers`).join("; ") + ".");
    } else {
      parts.push(`The branch toward ${c.name}: ${listOf(t.map(q))} - the largest appears in ${pctN(towardCells ? t[0].cells / towardCells : 0)} of the questions where the AI gives any condition that sends buyers to it${scope}.`);
      tips.push(t.map((g) => `${g.label}: ${g.rules} rules in ${g.cells} questions`).join("; ") + ".");
    }
  }
  const a = away.slice(0, 3);
  if (a.length) {
    const named = a.map((g) => (g.routes[0] ? `${q(g)} (to ${g.routes[0].name})` : q(g)));
    if (awayBase !== null) {
      parts.push(`The branch away: ${listOf(named)} - the largest comes up in ${pctN(awayBase ? (a[0].answers ?? 0) / awayBase : 0)} of the answers where the AI gives any condition that sends buyers away.`);
      tips.push(a.map((g) => `${g.label}: ${g.answers ?? 0} of ${awayBase} answers`).join("; ") + ".");
    } else {
      parts.push(`The branch away: ${listOf(named)} - the largest appears in ${pctN(awayCells ? a[0].cells / awayCells : 0)} of the questions where the AI gives any condition that sends buyers away.`);
      tips.push(a.map((g) => `${g.label}: ${g.rules} rules in ${g.cells} questions`).join("; ") + ".");
    }
  }
  if (c.isTarget) {
    const walls: string[] = [];
    for (const st of Object.values(c.stats)) if (st.wall && !walls.some((w) => norm(w) === norm(st.wall!))) walls.push(st.wall);
    if (walls.length) parts.push(`The fixed situations - ones the buyer is already in, not arguments to answer: ${listOf(walls.slice(0, 3).map((w) => `"${w}"`))}.`);
  }
  if (parts.length === 1) return null;
  return withCells({ text: parts.join(" "), tip: tips.join(" ") || undefined }, cellsOf(c, CONDITION_CARD));
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
      .sort((a, b) => b.effect - a.effect)
      .slice(0, 5)
      .map((i) => ({ lead: leadOf(cap(i.title)), text: cap(i.body), tip: i.foot, key: i.key, cellIds: insightCells(c, i) }));
  const out: Ctx["findings"] = [];
  const ranked = roomsByShare(c);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  if (best && best.share.k > 0)
    out.push({ key: "best_room", cellIds: [`chooses:open:${norm(best.r.room)}`], lead: "Its strongest situation.", text: `${best.r.room} is where ${c.name} does best: ${P(best.share)} of the picks there.`, tip: tipOf(best.share) });
  if (worst && worst.top)
    out.push({
      key: "worst_room",
      cellIds: [`chooses:open:${norm(worst.r.room)}`],
      lead: "Its weakest situation.",
      text: `${worst.r.room} is its weakest - ${worst.share.k === 0 ? "none" : P(worst.share)} of the picks there, with ${worst.top.name} taking ${P(worst.top.share)}.`,
      tip: `${tipOf(worst.share)}; ${worst.top.name} ${worst.top.chosen}.`,
    });
  const l = c.lift[0];
  if (l && l.lift > 0 && l.wins.low > l.others.high)
    out.push({ key: "lift", cellIds: [BRAND_CARD(c.subject.key)], lead: "The argument it wins on.", text: `${cap(l.code)} is argued in ${P(l.wins)} of the answers that pick ${c.name}, against ${P(l.others)} when another brand is picked.`, tip: `${tipOf(l.wins)}; ${tipOf(l.others)}.` });
  if (c.vsTarget && c.vsTarget.won.n >= MIN)
    out.push({ key: "vs_target", cellIds: [rivalCell(c, c.subject.key)].filter((x): x is string => !!x), lead: `Against ${c.brand}.`, text: `Compared directly with ${c.brand}, the AI sides with ${c.name} ${P(c.vsTarget.won)} of the time it takes a side.`, tip: tipOf(c.vsTarget.won) });
  const lw = c.lift.length > 1 ? c.lift[c.lift.length - 1] : undefined;
  if (lw && lw.lift < 0 && lw.others.low > lw.wins.high)
    out.push({ key: "loss_arg", cellIds: [BRAND_CARD(c.subject.key)], lead: "The argument it loses on.", text: `${cap(lw.code)} comes up in ${P(lw.others)} of the answers that pick another brand and ${P(lw.wins)} of those that pick ${c.name}.`, tip: `${tipOf(lw.wins)}; ${tipOf(lw.others)}.` });
  return out.slice(0, 5);
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
  const leader = s.brands.find((b) => b.key !== S.key && b.chosen.k > 0);
  if (leader) rows.push(at({ label: `Share of picks - ${leader.name}`, value: P(leader.shareOfDecided), tip: tipOf(leader.shareOfDecided) }, OPEN_ALL, brandPin(c, leader.key)));
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

function movePara(c: Ctx, m: Move): BriefPara {
  return withCells({ lead: leadOf(m.lead), text: `${sentence(m.claim)} ${m.lever} Watch: ${m.watch}.`, tip: m.tip }, cellsOf(c, m.cellId));
}

function nowWhat(c: Ctx): BriefSection[] {
  const out: BriefSection[] = [
    { key: "verdict", heading: "The verdict", paras: [verdictPara(c)] },
    { key: "scoreboard", heading: "The scoreboard", rows: scoreboard(c) },
    { key: "funnel_breaks", paras: [funnelBreaks(c)] },
  ];
  if (c.findings.length)
    out.push({ key: "findings", heading: "What matters this wave", paras: c.findings.map((f, i) => withCells({ lead: `${i + 1}. ${f.lead}`, text: f.text, ...(f.tip ? { tip: f.tip } : {}) }, cellsOf(c, ...(f.cellIds ?? [])))) });
  const cond = conditionsPara(c);
  if (cond) out.push({ key: "conditions", heading: "The conditions that decide it", paras: [cond] });
  if (c.isTarget)
    out.push({
      key: "moves",
      heading: "Now what?",
      paras: c.moves.length
        ? (() => {
            // A lever the map repeats verbatim across moves reads canned - say it once.
            const seen = new Set<string>();
            return c.moves.map((m) => {
              const repeat = seen.has(m.lever);
              seen.add(m.lever);
              return movePara(c, repeat ? { ...m, lever: "Same first move: check it against your own data." } : m);
            });
          })()
        : [{ text: `No buying situation, matchup or worry is lost by a clear margin in this wave - the job is to keep the standing current.` }],
    });
  return out;
}

/* ----------------------------------- SWOT ---------------------------------- */

const INSIGHT_SHORT: Record<string, string> = {
  rival_open: "the leading rival's lead in picks",
  conversion_vs_rival: "the leading rival turning recommendations into picks",
  away_condition: "the condition that most often sends buyers away",
  own_defense: "the exits shown to your own customers",
  engine_pick_concentration: "dependence on one AI assistant",
  leak_picks: "picks leaving the category",
  leak_problem: "problem questions answered outside the category",
  worst_worry: "the worry that loses the most customers",
  leave_no_exit: "customers told to leave with nowhere to go",
  neutralized_differentiator: "rivals credited with your differentiator",
  leaver_capture: "rival customers who hear about you and go elsewhere",
  taught_vs_winning: "what the AI teaches buyers to weigh",
  value_in_house: "doubts about the price",
  doubt_worry: "the worry the AI backs most",
  agreed_yet_stay: "worries the AI agrees with",
  pick_concentration_room: "picks that come from one buying situation",
  pick_concentration_question: "picks that come from one question",
  prompted_vs_open: "the gap between direct matchups and open buying questions",
};

const WEAK_KEYS = ["taught_vs_winning", "value_in_house", "doubt_worry", "agreed_yet_stay", "pick_concentration_room", "pick_concentration_question", "prompted_vs_open"];
const THREAT_KEYS = ["away_condition", "own_defense", "engine_pick_concentration", "leak_picks", "leak_problem", "worst_worry", "leave_no_exit", "neutralized_differentiator", "conversion_vs_rival", "leaver_capture"];

/** An insight's direction for the keys that fire both ways (strength or threat). */
function insightIsStrength(i: Insight): boolean {
  if (i.key === "conversion_vs_rival") return i.title.startsWith("You turn");
  if (i.key === "leaver_capture") return i.title === "Rivals' customers come to you";
  if (i.key === "rival_open") return i.title.startsWith("You lead");
  if (i.key === "prompted_vs_open") return false;
  return false;
}

/** The noun phrase for a detector that fired in its strength direction. */
const STRENGTH_SHORT: Record<string, string> = {
  rival_open: "your lead in picks",
  conversion_vs_rival: "the way your recommendations turn into picks",
  leaver_capture: "the rival customers who come to you",
};

function fromInsight(c: Ctx, i: Insight, kind: string): Item {
  const short = (insightIsStrength(i) ? STRENGTH_SHORT[i.key] : INSIGHT_SHORT[i.key]) ?? low1(i.title);
  const ids = insightCells(c, i);
  return { text: i.body, short, tip: i.foot, kind, effect: i.effect, cellId: ids[0], cellIds: ids };
}

function funnelBreak(S: SummaryBrand, name: string): Item | null {
  const steps = [
    { from: "named", to: "recommended", a: S.mentioned, b: S.recommended },
    { from: "recommended", to: "picked", a: S.recommended, b: S.chosen },
  ];
  const worst = [...steps].sort((x, y) => rate(y.a) - rate(y.b) - (rate(x.a) - rate(x.b)))[0];
  const drop = rate(worst.a) - rate(worst.b);
  if (worst.a.n < MIN || drop <= 0) return null;
  return {
    text: `${name} is ${worst.from} in ${P(worst.a)} of answers but ${worst.to} in ${worst.to === "picked" ? pctFine(rate(worst.b)) : P(worst.b)} - the largest drop in its funnel.`,
    short: `the drop from ${worst.from} to ${worst.to}`,
    tip: `${worst.from}: ${tipOf(worst.a)}; ${worst.to}: ${tipOf(worst.b)}.`,
    kind: "funnel",
    effect: drop,
    cellId: OPEN_ALL,
  };
}

function capList<T extends Item>(items: T[], n = 4): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const i of [...items].sort((a, b) => b.effect - a.effect)) {
    if (out.length >= n) break;
    if (seen.has(i.text)) continue;
    seen.add(i.text);
    out.push(i);
  }
  return out;
}

interface Swot {
  s: Item[];
  w: Item[];
  o: Item[];
  t: Item[];
}

function swotOf(c: Ctx): Swot {
  const S = c.subject;
  const s: Item[] = [];
  const w: Item[] = [];
  const o: Item[] = [];
  const t: Item[] = [];
  const best = c.lift[0];
  const worst = c.lift.length > 1 ? c.lift[c.lift.length - 1] : undefined;
  if (best && best.lift > 0 && best.wins.low > best.others.high)
    s.push({
      text: `${cap(best.code)} comes up more when ${c.isTarget ? "you win" : `${c.name} wins`} - argued in ${P(best.wins)} of the answers that pick ${c.isTarget ? "you" : c.name} and ${P(best.others)} of those that pick another brand.`,
      short: `the ${best.code} argument`,
      tip: `${tipOf(best.wins)} wins; ${tipOf(best.others)} other picks.`,
      kind: "argument",
      effect: best.lift,
      cellId: c.isTarget ? OPEN_ALL : BRAND_CARD(S.key),
    });
  if (worst && worst.lift < 0 && worst.others.low > worst.wins.high)
    w.push({
      text: `${cap(worst.code)} shows up when another brand is picked - argued in ${P(worst.others)} of those answers and ${P(worst.wins)} of the answers that pick ${c.isTarget ? "you" : c.name}.`,
      short: `the ${worst.code} argument`,
      tip: `${tipOf(worst.wins)} wins; ${tipOf(worst.others)} other picks.`,
      kind: "argument",
      effect: -worst.lift,
      cellId: c.isTarget ? OPEN_ALL : BRAND_CARD(S.key),
    });
  const fb = funnelBreak(S, c.name);
  if (fb) w.push({ ...fb, cellIds: subjectPins(c) });

  if (c.isTarget) {
    const sm = c.summary;
    // Strengths: direct matchups won, surplus positions, the asked-for case.
    for (const r of sm.headToHead)
      if (r.winOfDecided.n >= MIN && r.winOfDecided.low > 0.5)
        s.push({
          text: `Asked to compare ${c.brand} with ${r.rival} directly, the AI picks ${c.brand} ${P(r.winOfDecided)} of the time it picks one of them.`,
          short: `your ${P(r.winOfDecided)} record against ${r.rival}`,
          tip: `Won ${r.won.k}, lost ${r.lost.k}.`,
          kind: "rival",
          row: "h2h",
          effect: rate(r.winOfDecided) - 0.5,
          cellId: rivalCell(c, r.key),
        });
    for (const p of Object.values(c.map.positions)) {
      const st = c.stats[p.cellId];
      // Matchups are read from the summary above. The settled band and the doubt rows are the AI
      // siding with the brand when the asker set it up that way - defensive ground, never a strength.
      if (!st || st.pooled || p.status !== "surplus" || st.row === "h2h" || st.band === "settled") continue;
      if (st.row === "buyers" || st.row === "customers" || st.row === "hold") continue;
      const wd = cellWords(st.row, st.label, c.brand);
      s.push({ text: sentence(p.claim), short: `your hold ${wd.prep || "here"}`, tip: `${st.you} of ${st.d} side-taking answers.`, kind: st.row, row: st.row, effect: st.n > 0 ? (st.you - st.them) / st.n : 0, cellId: p.cellId });
    }
    const used = new Set(c.findings.map((f) => f.key));
    for (const i of c.ranked) if (insightIsStrength(i) && !used.has(i.key)) s.push(fromInsight(c, i, i.kind));

    // Weaknesses and threats from the ranked detectors.
    for (const i of c.ranked) {
      if (insightIsStrength(i) || used.has(i.key)) continue;
      // A concentration in the leading rival's picks is not the client's weakness.
      if (i.key === "pick_concentration_question" && !i.title.includes("your")) continue;
      if (WEAK_KEYS.includes(i.key)) w.push(fromInsight(c, i, i.kind));
      else if (THREAT_KEYS.includes(i.key)) t.push(fromInsight(c, i, i.kind));
    }
    const v = c.inputs.value;
    if (v && v.answers >= MIN && rate(v.worth.no) >= rate(v.worth.yes) && v.worth.no.k > 0) {
      const subject = v.lines.length === 1 ? v.lines[0].label : c.brand;
      w.push({
        text: `${subject} is judged not worth it over a cheaper option in ${P(v.worth.no)} of answers and worth it in ${P(v.worth.yes)}.`,
        short: "the value question",
        tip: `No ${tipOf(v.worth.no)}; yes ${tipOf(v.worth.yes)}.`,
        kind: "value",
        effect: rate(v.worth.no) - rate(v.worth.yes),
        cellId: pooledOf(c, "chooses:value:"),
      });
    }
    // Threats: the leading rival, walls.
    const leader = sm.brands.find((b) => b.key !== c.subject.key && b.chosen.k > 0);
    if (leader && sm.firmPickInCategory.k >= MIN && rate(leader.shareOfDecided) > rate(S.shareOfDecided))
      t.push({
        text: `${leader.name} takes ${P(leader.shareOfDecided)} of the picks when buyers ask what to buy, against ${P(S.shareOfDecided)} for ${c.brand}.`,
        short: `${poss(leader.name)} lead in picks`,
        tip: `${leader.chosen.k} picks to ${S.chosen.k}.`,
        kind: "rival",
        effect: rate(leader.shareOfDecided) - rate(S.shareOfDecided),
        cellId: OPEN_ALL,
        cellIds: [OPEN_ALL, BRAND_CARD(leader.key)],
      });
    // Walls on the pick-shaped cells (a Value or worry cell's sides are not picks), one per wording.
    const wallSeen = new Set<string>();
    for (const [cellId, st] of Object.entries(c.stats))
      if (st.wall && st.d >= MIN && ["open", "social", "premium", "h2h", "leavers"].includes(st.row) && !wallSeen.has(norm(st.wall)) && wallSeen.add(norm(st.wall)))
        t.push({
          text: `${st.row === "h2h" ? `Against ${st.label}` : st.label ? `For ${st.label}` : "For every buyer"}, "${st.wall}" sends buyers away - a situation the buyer is already in - while ${st.taker} takes ${pctN(st.them / st.d)} of the picks there.`,
          short: `the fixed situation "${st.wall}"`,
          tip: `${st.them} of ${st.d} answers that take a side go to ${st.taker}.`,
          kind: "wall",
          effect: st.them / st.d - st.you / st.d,
          cellId,
        });
    // Opportunities: the moves. One lever family repeating verbatim reads
    // as boilerplate - repeats keep only their "where".
    const seenAct = new Set<string>();
    for (const m of c.moves) {
      const where = m.act.slice(m.actStem.length).trim();
      const text = seenAct.has(m.actStem) && where ? `The same move ${where} - ${m.today}.` : `${cap(m.act)} - ${m.today}.`;
      seenAct.add(m.actStem);
      o.push({ text, short: `the opening ${m.lead.startsWith("The worry") ? `on ${low1(m.lead)}` : `in ${m.lead}`}`, act: m.act, tip: m.tip, kind: m.row, row: m.row, effect: 1, cellId: m.cellId });
    }
  } else {
    // Rival subject: per buying situation, its matchup with the target, the leading brand.
    for (const r of c.rooms) {
      if (r.firm.k < MIN) continue;
      const mine = r.brands.find((b) => b.key === S.key);
      const others = r.brands.filter((b) => b.key !== S.key).sort((a, b) => b.chosen - a.chosen);
      const top = others[0];
      const share = mine ? mine.share : cell(0, r.firm.k);
      if (top && (!mine || mine.chosen < top.chosen)) {
        const gap = rate(top.share) - rate(share);
        if (mine && gap <= 0.15 && mine.chosen > 0)
          o.push({
            text: `For ${r.room}, ${c.name} takes ${P(share)} of the picks, ${Math.round(gap * 100)} points behind ${top.name}.`,
            short: `the ${r.room} situation`,
            act: `press its case for ${r.room}`,
            tip: `${share.k} of ${share.n} picks; ${top.name} ${top.chosen}.`,
            kind: "room",
            effect: 0.15 - gap,
            cellId: `chooses:open:${norm(r.room)}`,
          });
        else
          w.push({
            text: `For ${r.room}, ${c.name} takes ${share.k === 0 ? "none" : `only ${P(share)}`} of the picks - ${top.name} takes ${P(top.share)}.`,
            short: `its weak spot for ${r.room}`,
            tip: `${share.k} of ${share.n} picks; ${top.name} ${top.chosen}.`,
            kind: "room",
            effect: gap,
            cellId: `chooses:open:${norm(r.room)}`,
          });
      } else if (mine && mine.chosen > 0) {
        s.push({
          text: `For ${r.room}, ${c.name} takes ${P(share)} of the picks - more than any other brand.`,
          short: `its lead for ${r.room}`,
          tip: `${share.k} of ${share.n} picks.`,
          kind: "room",
          effect: rate(share) - (top ? rate(top.share) : 0),
          cellId: `chooses:open:${norm(r.room)}`,
        });
      }
    }
    if (c.vsTarget && c.vsTarget.won.n >= MIN) {
      const v = c.vsTarget.won;
      const item: Item = {
        text: `Asked to compare ${c.name} with ${c.brand} directly, the AI picks ${c.name} ${P(v)} of the time it picks one of them.`,
        short: `its record against ${c.brand}`,
        tip: tipOf(v),
        kind: "rival",
        effect: Math.abs(rate(v) - 0.5),
        cellId: rivalCell(c, S.key),
      };
      if (v.low > 0.5) s.push(item);
      else if (v.high < 0.5) t.push({ ...item, short: `${poss(c.brand)} edge when the two are compared` });
    }
    const leader = c.summary.brands.find((b) => b.key !== S.key && b.chosen.k > 0);
    if (leader && rate(leader.shareOfDecided) > rate(S.shareOfDecided))
      t.push({
        text: `${leader.name} takes ${P(leader.shareOfDecided)} of the picks when buyers ask what to buy, against ${P(S.shareOfDecided)} for ${c.name}.`,
        short: `${poss(leader.name)} lead in picks`,
        tip: `${leader.chosen.k} picks to ${S.chosen.k}.`,
        kind: "rival",
        effect: rate(leader.shareOfDecided) - rate(S.shareOfDecided),
        cellId: OPEN_ALL,
        cellIds: [OPEN_ALL, brandPin(c, leader.key), BRAND_CARD(S.key)],
      });
  }
  return { s: capList(s), w: capList(w), o: o.slice(0, 4), t: capList(t) };
}

const asParas = (c: Ctx, items: Item[], empty: string): BriefPara[] =>
  items.length ? items.map((i) => withCells({ text: i.text, ...(i.tip ? { tip: i.tip } : {}) }, cellsOf(c, ...(i.cellIds ?? [i.cellId])))) : [{ text: empty }];

function swotFrame(c: Ctx, sw: Swot): BriefSection[] {
  const quads: BriefQuad[] = [
    {
      headers: ["Strengths", "Weaknesses"],
      cells: [asParas(c, sw.s, "Nothing stands out as a strength outside the noise in this wave."), asParas(c, sw.w, "Nothing stands out as a weakness outside the noise in this wave.")],
    },
    {
      headers: ["Opportunities", "Threats"],
      cells: [asParas(c, sw.o, "No contest is lost by a clear enough margin to name an opening."), asParas(c, sw.t, "No threat clears the noise in this wave.")],
    },
  ];
  return [
    {
      key: "standing",
      paras: [withCells({ text: `Where ${c.name} stands on this wave: named in ${P(c.subject.mentioned)} of answers, and the AI's pick ${P(c.subject.shareOfDecided)} of the times it settles on one ${c.product}.`, tip: `${tipOf(c.subject.mentioned)}; ${tipOf(c.subject.shareOfDecided)}.` }, cellsOf(c, ...subjectPins(c)))],
    },
    { key: "swot", quads },
  ];
}

/* ----------------------------------- TOWS ---------------------------------- */

/** Pairs each of the first `n` of `as` with a `bs` item sharing its row or
 * kind, else the next unused one. */
function pairs(as: Item[], bs: Item[], n = 2): [Item, Item][] {
  const out: [Item, Item][] = [];
  const used = new Set<Item>();
  for (const a of as) {
    if (out.length >= n || used.size >= bs.length) break;
    const b = bs.find((x) => !used.has(x) && ((a.row && x.row === a.row) || x.kind === a.kind)) ?? bs.find((x) => !used.has(x));
    if (!b) break;
    used.add(b);
    out.push([a, b]);
  }
  return out;
}

function towsFrame(c: Ctx, sw: Swot): BriefSection[] {
  // A play pins both cells it pairs, the strength or weakness first.
  // bf15: each pin links its own item's phrase in the play (`at`).
  const so = pairs(sw.o, sw.s).map(([o, s]) => withCells({ text: `Use ${s.short} to ${o.act ?? o.short}.`, tip: o.tip }, cellsAt(c, [s.cellId, s.short], [o.cellId, o.act ?? o.short])));
  const wo = pairs(sw.o, sw.w).map(([o, w]) => withCells({ text: `Turn ${w.short} around: ${o.act ?? o.short}.`, tip: o.tip }, cellsAt(c, [w.cellId, w.short], [o.cellId, o.act ?? o.short])));
  const st = pairs(sw.t, sw.s).map(([t, s]) => withCells({ text: `Use ${s.short} to blunt ${t.short}.`, tip: t.tip }, cellsAt(c, [s.cellId, s.short], [t.cellId, t.short])));
  const wt = pairs(sw.t, sw.w).map(([t, w]) => withCells({ text: `Shore up ${w.short} and watch ${t.short}.`, tip: t.tip }, cellsAt(c, [w.cellId, w.short], [t.cellId, t.short])));
  const none = "Nothing to pair in this wave.";
  const or = (p: BriefPara[]) => (p.length ? p : [{ text: none }]);
  return [
    { key: "promise", paras: [{ text: "TOWS pairs each strength and weakness with an opening or a threat - what to do with what you have." }] },
    {
      key: "tows",
      quads: [
        { headers: ["Strengths x opportunities", "Weaknesses x opportunities"], cells: [or(so), or(wo)] },
        { headers: ["Strengths x threats", "Weaknesses x threats"], cells: [or(st), or(wt)] },
      ],
    },
  ];
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
  const L = { named: "In the conversation", rec: "Recommended", pick: `The ${c.product} to get`, kept: "Customers told to stay" };
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
  const paras: BriefPara[] = [
    withCells({ lead: `${L.named}.`, text: `When buyers ask what to buy, the AI names ${c.name} in ${P(S.mentioned)} of answers.`, tip: tipOf(S.mentioned) }, openCells),
    {
      lead: `${L.rec}.`,
      text: `It recommends ${c.name} in ${P(S.recommended)} of answers - ${pctN(named > 0 ? rec / named : 0)} of the answers that name it.`,
      tip: `${S.recommended.k} recommending of ${S.mentioned.k} naming.`,
      ...(openCells ? { cells: openCells } : {}),
    },
    {
      lead: `${L.pick}.`,
      text:
        (s.firmPickInCategory.k >= MIN
          ? `Only ${P(s.firmPickInCategory)} of answers settle on a single ${c.product}; ${c.name} wins ${P(S.shareOfDecided)} of those settlements, which leaves it the pick in ${pctFine(picked)} of every answer.`
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
      items.push({ label: L.kept, a: rate(k.keep) * 100, value: P(k.keep) });
      paras.push({
        lead: `${L.kept}.`,
        text: `When your customers raise a worry, the AI tells them to stay in ${P(k.keep)} of answers and to leave in ${P(k.leave)}; the other ${pctN(Math.max(0, 1 - rate(k.keep) - rate(k.leave)))} take no side either way.`,
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
  const viz: BriefViz = { kind: "funnel", title, subtitle: "Share of answers at each stage of the AI's verdicts; width is the rate", items };
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
  diagPx: { x: number; y: number };
  notePx?: { x: number; y: number };
  noteLines?: string[];
}

function placeScatter(pts: { label: string; x: number; y: number; accent: boolean; unlabeled: boolean }[], xMax: number, yMax: number, vline: number, vlineLabel: string, diag: number, diagLabel: string, note: string | null): ScatterPlan {
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
  // The visibility line (a thin strip) and its label at the top.
  const v = px(vline, 0);
  const vStrip: Box = [v.x - 3, g.top, v.x + 3, g.h - g.bottom];
  obstacles.push(boxOf(v.x + 6, g.top + 11, vlineLabel, FS_REF));
  // The converting line's label: end-anchored just above the line, at the
  // rightmost spot along it that clears every dot (the UI draws it there).
  const dX = Math.min(xMax, yMax * diag);
  const dl = textW(diagLabel, FS_REF);
  const dotBoxes = [...obstacles];
  let diagPx = { x: 0, y: 0 };
  let diagBox: Box = [0, 0, 0, 0];
  let diagBest = Infinity;
  for (let i = 0; i <= 12; i++) {
    const xx = dX * (1 - i * 0.05);
    const e = px(xx, xx / diag);
    const bx: Box = [e.x - 4 - dl, e.y - 8 - FS_REF * 0.78, e.x - 4, e.y - 8 + FS_REF * 0.24];
    const k = dotBoxes.reduce((a, o) => a + overlap(bx, o), 0) * 10 + i;
    if (k < diagBest) {
      diagBest = k;
      diagPx = { x: Math.round(e.x - 4), y: Math.round(e.y - 8) };
      diagBox = bx;
    }
  }
  obstacles.push(diagBox);
  // The diagonal itself: a rect is hit when the line's y over the rect's x-span meets its y-span.
  const diagHits = (b: Box) => {
    const x0 = Math.max(b[0], g.left);
    const x1 = Math.min(b[2], g.w - g.right);
    if (x1 <= x0) return 0;
    const yAt = (X: number) => {
      const dx = ((X - g.left) / (g.w - g.left - g.right)) * xMax;
      return px(dx, dx / diag).y;
    };
    const ya = yAt(x0);
    const yb = yAt(x1);
    // A 5px clearance either side: a dashed line grazing a label's baseline still reads as crossing it.
    return Math.min(ya, yb) <= b[3] + 5 && Math.max(ya, yb) >= b[1] - 5 ? (x1 - x0) * 6 : 0;
  };
  const inside = (b: Box) => {
    const over = Math.max(0, g.left - 4 - b[0]) + Math.max(0, b[2] - (g.w - 2)) + Math.max(0, g.top - 2 - b[1]) + Math.max(0, b[3] - (g.h - g.bottom + 2));
    return over * 400;
  };
  const placed: Box[] = [];
  const cost = (b: Box) => obstacles.reduce((a, o) => a + overlap(b, o), 0) + overlap(b, vStrip) * 40 + placed.reduce((a, o) => a + overlap(b, o) * 3, 0) + diagHits(b) + inside(b);
  const out = new Map<string, { dx: number; dy: number }>();
  const candsOf = new Map<string, [number, number][]>();
  // Subject first, then by visibility.
  const order = pts.filter((p) => !p.unlabeled).sort((a, b) => Number(b.accent) - Number(a.accent) || b.x - a.x);
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
    // Stacked tiers above the dot for a crowded strip (the UI draws a quiet
    // leader to any label set this far off its dot).
    for (let k = 1; k <= 7; k++) for (const ox of [-w / 2, -3, -w + 3]) cands.push([ox, -(r + 6) - k * 15]);
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
      const costJ = (b: Box) => obstacles.reduce((a, o) => a + overlap(b, o), 0) + overlap(b, vStrip) * 40 + others.reduce((a, o) => a + overlap(b, o) * 3, 0) + diagHits(b) + inside(b);
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
  // The cluster note: near the unlabeled dots, clear of everything placed.
  // One line beside the cluster if it fits; else the same words on two
  // lines beside it; else one line stepping up above it.
  let notePx: ScatterPlan["notePx"];
  let noteLines: string[] | undefined;
  const cl = pts.filter((p) => p.unlabeled);
  if (note && cl.length) {
    const qs = cl.map((p) => px(p.x, p.y));
    const cx = qs.reduce((a, q) => a + q.x, 0) / qs.length;
    const top = Math.min(...qs.map((q) => q.y));
    const minX = Math.min(...qs.map((q) => q.x));
    const maxX = Math.max(...qs.map((q) => q.x));
    const base = Math.max(...qs.map((q) => q.y));
    const LINE = 14;
    const split = (() => {
      const words = note.split(" ");
      let bestI = 1;
      let bestD = Infinity;
      for (let i = 1; i < words.length; i++) {
        const d = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      return [words.slice(0, bestI).join(" "), words.slice(bestI).join(" ")];
    })();
    const boxes = (x: number, y: number, lines: string[]) => lines.map((l, i) => boxOf(x, y + i * LINE, l, FS_REF));
    const w1 = textW(note, FS_REF);
    const cands: { x: number; y: number; lines: string[] }[] = [
      { x: maxX + 10, y: base - 6, lines: [note] },
      { x: maxX + 10, y: base - 6 - LINE, lines: split },
      { x: maxX + 10, y: top - 2 - LINE, lines: split },
    ];
    for (const lift of [12, 24, 36, 48, 60, 72, 84, 96, 110, 124])
      for (const x of [cx - w1 / 2, minX - 4]) cands.push({ x, y: top - lift, lines: [note] });
    let best = cands[0];
    let bestCost = Infinity;
    for (const [i, cnd] of cands.entries()) {
      const k = boxes(cnd.x, cnd.y, cnd.lines).reduce((a, bx) => a + cost(bx), 0) + i * 0.5;
      if (k < bestCost) {
        bestCost = k;
        best = cnd;
      }
    }
    notePx = { x: Math.round(Math.max(g.left + 2, best.x)), y: Math.round(best.y) };
    if (best.lines.length > 1) noteLines = best.lines;
  }
  const items = pts.map((p) => {
    const it: BriefVizItem = { label: p.label, a: Math.round(p.x * 10) / 10, b: Math.round(p.y * 10) / 10 };
    if (p.accent) it.accent = true;
    if (p.unlabeled) it.unlabeled = true;
    const n = out.get(p.label);
    if (n && (n.dx || n.dy)) {
      it.dx = n.dx;
      it.dy = n.dy;
    }
    return it;
  });
  return { items, diagPx, notePx, ...(noteLines ? { noteLines } : {}) };
}

function matrixFrame(c: Ctx): BriefSection[] {
  const s = c.summary;
  // The selectable brands that register (named in >= 10% of answers or >= 1%
  // of the picks; the subject and the target always).
  const set = s.brands.filter((b) => b.key === c.subject.key || b.key === c.target.key || rate(b.mentioned) >= 0.1 || rate(b.shareOfDecided) >= 0.01);
  // The exemplar's lines: visible = named in more than half of answers;
  // converting = share of picks at least a quarter of the named rate.
  const visible = (b: SummaryBrand) => rate(b.mentioned) > 0.5;
  const converting = (b: SummaryBrand) => b.chosen.k > 0 && rate(b.shareOfDecided) >= rate(b.mentioned) / 4;
  const quad = (b: SummaryBrand): Quadrant => (visible(b) && converting(b) ? "The Closers" : visible(b) ? "The Showroom" : converting(b) ? "The Quiet Closer" : "The Background");
  const sorted = [...set].sort((a, b) => b.mentioned.k - a.mentioned.k || a.name.localeCompare(b.name));
  const rows = sorted.map((b) => [b.name, P(b.mentioned), P(b.shareOfDecided), quad(b)]);
  const hi = sorted.findIndex((b) => b.key === c.subject.key);
  const mine = quad(c.subject);
  const conv = converting(c.subject);
  const matrixCells = cellsOf(c, ...subjectPins(c));
  const paras: BriefPara[] = [
    withCells(
      {
        lead: `${c.name} is ${QUAD_PHRASE[mine]}.`,
        text: `It is named in ${P(c.subject.mentioned)} of answers and takes ${P(c.subject.shareOfDecided)} of the picks - ${conv ? "at least" : "less than"} a quarter of how often it is named.`,
        tip: `Named ${tipOf(c.subject.mentioned)}; ${tipOf(c.subject.shareOfDecided)} picks.`,
      },
      matrixCells
    ),
  ];
  const showroom = sorted.find((b) => b.key !== c.subject.key && quad(b) === "The Showroom");
  const quiet = [...sorted].filter((b) => b.key !== c.subject.key && quad(b) === "The Quiet Closer").sort((a, b) => b.shareOfDecided.k - a.shareOfDecided.k)[0];
  const outl: string[] = [];
  if (showroom)
    outl.push(`${showroom.name} is ${mine === "The Showroom" ? "also in the Showroom" : "the most visible brand in the Showroom"} - named in ${P(showroom.mentioned)} of answers but only ${P(showroom.shareOfDecided)} of the picks.`);
  if (quiet) outl.push(`${quiet.name} is ${mine === "The Quiet Closer" ? "another" : "the"} Quiet Closer - named in ${P(quiet.mentioned)} of answers yet ${P(quiet.shareOfDecided)} of the picks.`);
  if (outl.length) paras.push(withCells({ text: outl.join(" ") }, cellsOf(c, showroom ? brandPin(c, showroom.key) : null, quiet ? brandPin(c, quiet.key) : null)));
  paras.push({ text: "Visible means named in more than half of answers. Converting means the brand's share of picks is at least a quarter of how often it is named." });

  // The scatter.
  const pts = sorted.map((b) => {
    const x = rate(b.mentioned) * 100;
    const y = rate(b.shareOfDecided) * 100;
    const accent = b.key === c.subject.key;
    return { label: b.name, x, y, accent, unlabeled: !accent && y < 2 && x < 30 };
  });
  const cluster = pts.filter((p) => p.unlabeled).map((p) => p.label);
  const yMax = Math.max(20, Math.ceil((Math.max(...pts.map((p) => p.y), 0) + 4) / 10) * 10);
  const VL = "visible: named over 50%";
  const DL = "converting line";
  const plan = placeScatter(pts, 100, yMax, 50, VL, 4, DL, cluster.length ? listOf(cluster) : null);
  const headline = `${P(c.subject.shareOfDecided)} of picks on ${P(c.subject.mentioned)} visibility`;
  const title =
    sorted[0]?.key === c.subject.key && !conv
      ? `The most visible brand converts least - ${headline}`
      : `${c.name} is ${QUAD_PHRASE[mine]} - ${headline}`;
  const viz: BriefViz = {
    kind: "scatter",
    title,
    subtitle: "Every brand by how often the AI names it and its share of picks",
    items: plan.items,
    xLabel: "named in answers",
    yLabel: "share of picks",
    vline: 50,
    vlineLabel: VL,
    diag: 4,
    diagLabel: DL,
    diagLabelPx: plan.diagPx,
    xMax: 100,
    yMax,
    ...(cluster.length ? { clusterNote: listOf(cluster), ...(plan.notePx ? { notePx: plan.notePx } : {}), ...(plan.noteLines ? { noteLines: plan.noteLines } : {}) } : {}),
  };
  return [
    { key: "matrix_viz", viz },
    { key: "matrix", table: { headers: ["Brand", "Named", "Share of picks", "Position"], rows, ...(hi >= 0 ? { highlightRow: hi } : {}) } },
    { key: "reading", paras },
  ];
}

/* ----------------------------------- Jobs ---------------------------------- */

function jobsFrame(c: Ctx): BriefSection[] {
  const paras: BriefPara[] = [];
  const valueRooms = new Map((c.inputs.value?.rooms ?? []).map((r) => [r.key, r]));
  for (const r of c.rooms) {
    if (r.answers === 0) continue;
    const parts: string[] = [];
    if (r.description) parts.push(sentence(r.description));
    const mine = r.brands.find((b) => b.key === c.subject.key);
    const share = mine ? mine.share : cell(0, r.firm.k);
    const top = r.brands.filter((b) => b.key !== c.subject.key).sort((a, b) => b.chosen - a.chosen)[0];
    let tip = `${r.answers} answers; ${tipOf(share)} picks`;
    if (r.firm.k < MIN) parts.push(`Too few answers here commit to a pick to call who takes this buying situation.`);
    else if (top && (!mine || top.chosen > mine.chosen)) {
      parts.push(`${c.name} takes ${share.k === 0 ? "none" : P(share)} of the picks here; ${top.name} takes the situation at ${P(top.share)}.`);
      tip += `; ${top.name} ${top.chosen}`;
    } else parts.push(`${c.name} takes this situation with ${P(share)} of the picks${top && top.chosen > 0 ? `, ahead of ${top.name} at ${P(top.share)}` : ""}.`);
    if (c.isTarget) {
      const v = valueRooms.get(r.room);
      if (v && v.answers >= MIN) {
        parts.push(`Asked whether ${v.line ?? c.brand} is worth it over a cheaper option, the AI says yes in ${P(v.worth.yes)} of answers.`);
        tip += `; worth it ${tipOf(v.worth.yes)}`;
      }
      const st = c.stats[`chooses:open:${norm(r.room)}`];
      if (st?.wall) parts.push(`The condition "${st.wall}" - a situation the buyer is already in - sends buyers away here.`);
    }
    const hasValue = c.isTarget && (valueRooms.get(r.room)?.answers ?? 0) >= MIN;
    paras.push(withCells({ lead: r.room, text: parts.join(" "), tip: `${tip}.` }, cellsAt(c, [`chooses:open:${norm(r.room)}`, r.room], [hasValue ? `chooses:value:${norm(r.room)}` : null, r.room])));
  }
  if (!paras.length) paras.push({ text: "This tracker asks every buyer the same questions - there are no separate buying situations to read." });
  const out: BriefSection[] = [];
  const viz = pairsViz(c);
  if (viz) out.push({ key: "situations_viz", viz });
  out.push({ key: "situations", paras });
  return out;
}

/** The by-situation pairs: the subject's share of picks over the situation's
 * leader's (the leading rival's where the subject leads), leader-descending. */
function pairsViz(c: Ctx): BriefViz | null {
  const groups: { room: string; mine: RateCell; leader: { name: string; share: RateCell }; owns: boolean }[] = [];
  for (const r of c.rooms) {
    if (r.answers === 0 || r.firm.k < MIN) continue;
    const mine = r.brands.find((b) => b.key === c.subject.key);
    const top = r.brands.filter((b) => b.key !== c.subject.key).sort((a, b) => b.chosen - a.chosen)[0];
    if (!top) continue;
    const owns = !!mine && mine.chosen > 0 && mine.chosen >= top.chosen;
    groups.push({ room: r.room, mine: mine ? mine.share : cell(0, r.firm.k), leader: { name: top.name, share: top.share }, owns });
  }
  if (!groups.length) return null;
  // Ordered by who holds the situation most firmly (the leader's share; the subject's own where it leads).
  const top = (g: (typeof groups)[number]) => Math.max(rate(g.leader.share), rate(g.mine));
  groups.sort((a, b) => top(b) - top(a) || a.room.localeCompare(b.room));
  const owned = groups.filter((g) => g.owns).map((g) => g.room);
  const title = !owned.length
    ? `Every situation has an owner - and it is never ${c.name}`
    : owned.length === groups.length
      ? `${c.name} owns every buying situation`
      : `${c.name} owns ${listOf(owned)}; the rest have other owners`;
  return {
    kind: "pairs",
    title,
    subtitle: `Share of picks by buying situation: ${c.name} against the situation's leader${owned.length ? ", or its closest rival where it leads" : ""}`,
    legend: [c.name, owned.length ? "the leading rival" : "the situation's leader"],
    items: groups.map((g) => ({
      label: g.room,
      a: rate(g.mine) * 100,
      value: g.mine.k === 0 ? "0%" : P(g.mine),
      b: rate(g.leader.share) * 100,
      bValue: P(g.leader.share),
      who: g.leader.name,
      ...(g.owns ? { accent: true } : {}),
    })),
  };
}

/** A 2-4 word tag for a move, for the pyramid's resolution line. */
function moveTag(m: Move, brand: string): string {
  switch (m.row) {
    case "open":
      return m.label || "the open answer";
    case "social":
      return "the popular pick";
    case "awareness":
      return "problem questions";
    case "explainer":
      return "category lessons";
    case "value": {
      const line = m.label.includes(" - ") ? m.label.split(" - ")[1] : "";
      return `${line || brand} value`;
    }
    case "premium":
      return "premium versus basic";
    case "criteria":
      return "the checklist";
    case "h2h":
      return `the ${m.label} matchup`;
    case "leavers":
      return m.label ? `${poss(m.label)} switchers` : "rival switchers";
    case "buyers":
      return "a buyer worry";
    case "customers":
      return "a customer worry";
    case "hold":
      return "keeping customers";
    case "repertoire":
      return "habit buyers";
    case "settled":
      return "the customer case";
    default:
      return low1(m.lead);
  }
}

/* ----------------------------------- Minto --------------------------------- */

function mintoFrame(c: Ctx): BriefSection[] {
  const sm = c.summary;
  const S = c.subject;
  const leader = leaderOf(c);
  const commit = rate(sm.firmPickInCategory);
  // Situation: what is true, in its own sentence shapes (never now_what's verdict).
  const sit = [
    `Buyers ask the AI what ${c.product} to choose, and it names ${c.name} in ${P(S.mentioned)} of its answers.`,
    `It settles on a single ${c.product} ${commit < 0.5 ? "less than half the time" : "more than half the time"} (${pctN(commit)}); ${c.name} wins ${P(S.shareOfDecided)} of those settlements${
      leader ? `, ${leader.name} ${P(leader.shareOfDecided)}` : ""
    }.`,
  ];
  const out: BriefSection[] = [{ key: "situation", heading: "The situation", paras: [withCells({ text: sit.join(" "), tip: `${tipOf(S.mentioned)}; ${tipOf(S.shareOfDecided)}.` }, cellsOf(c, ...subjectPins(c), leader ? brandPin(c, leader.key) : null))] }];

  // Complication: the sharpest tension, composed in minto's own words.
  let comp: BriefPara | null = null;
  let compKind: "h2h" | "conv" | "rooms" | null = null;
  let roomSpread: [RateCell, RateCell] | null = null;
  const won = sm.headToHead.reduce((a, r) => a + r.won.k, 0);
  const lost = sm.headToHead.reduce((a, r) => a + r.lost.k, 0);
  const pooled = cell(won, won + lost);
  const conv = (b: SummaryBrand) => (b.recommended.k > 0 ? b.chosen.k / b.recommended.k : 0);
  if (c.isTarget && pooled.n >= MIN && rate(pooled) - rate(S.shareOfDecided) >= 0.15) {
    compKind = "h2h";
    comp = {
      text: `Yet when the AI is asked to compare ${c.name} with a rival directly, it picks ${c.name} in ${P(pooled)} of matchups - far more often than it picks ${c.name} unprompted. The preference exists; the open answer does not carry it.`,
      tip: `Matchups ${tipOf(pooled)}; open ${tipOf(S.shareOfDecided)}.`,
      cells: cellsOf(c, pooledOf(c, "fights:h2h:"), OPEN_ALL),
    };
  } else if (leader && S.recommended.k >= MIN && leader.recommended.k >= MIN && conv(leader) > conv(S) + 0.1) {
    compKind = "conv";
    comp = {
      text: `Yet recommendation is not the problem - ${P(S.recommended)} of answers recommend ${c.name}. Conversion is: ${pctN(conv(S))} of those recommendations end in the pick, against ${pctN(conv(leader))} for ${leader.name}.`,
      tip: `${c.name} ${S.chosen.k} of ${S.recommended.k}; ${leader.name} ${leader.chosen.k} of ${leader.recommended.k}.`,
      cells: cellsOf(c, ...subjectPins(c), brandPin(c, leader.key)),
    };
  } else {
    const ok = roomsByShare(c);
    if (ok.length >= 2 && ok[0].share.low > ok[ok.length - 1].share.high) {
      const hi = ok[0];
      const lo = ok[ok.length - 1];
      compKind = "rooms";
      roomSpread = [hi.share, lo.share];
      comp = {
        text: `Yet the standing is uneven: ${c.name} takes ${P(hi.share)} of the picks for ${hi.r.room} but ${lo.share.k === 0 ? "none of them" : `only ${P(lo.share)}`} for ${lo.r.room}.`,
        tip: `${hi.r.room}: ${tipOf(hi.share)}. ${lo.r.room}: ${tipOf(lo.share)}.`,
        cells: cellsOf(c, `chooses:open:${norm(hi.r.room)}`, `chooses:open:${norm(lo.r.room)}`),
      };
    }
  }
  if (comp) out.push({ key: "complication", heading: "The complication", paras: [comp] });

  // The pyramid: one short line per level, from the facts above.
  const sitNote =
    rate(S.mentioned) >= 0.5
      ? `The AI knows the brand: named in ${P(S.mentioned)}, recommended in ${P(S.recommended)} - awareness is solved`
      : `Named in ${P(S.mentioned)}, recommended in ${P(S.recommended)} - awareness is still open`;
  let compNote = "No single tension stands out this wave";
  if (compKind === "h2h") compNote = `Picked in ${P(pooled)} of direct matchups, ${P(S.shareOfDecided)} of open picks`;
  else if (compKind === "conv") compNote = `Only ${pctN(conv(S))} of its recommendations become the pick`;
  else if (compKind === "rooms" && roomSpread) compNote = `${P(roomSpread[0])} of picks at its best, ${roomSpread[1].k === 0 ? "none" : P(roomSpread[1])} at its worst`;
  let resNote: string;
  if (c.isTarget && c.moves.length) {
    const tags: string[] = [];
    for (const m of c.moves) {
      const t = moveTag(m, c.brand);
      if (tags.some((x) => norm(x) === norm(t))) continue;
      if (`The moves: ${listOf([...tags, t])}`.length > 88 && tags.length >= 2) break;
      tags.push(t);
    }
    resNote = `The moves: ${listOf(tags)}`;
  } else if (c.isTarget) resNote = "No contest is lost by a clear margin - keep the standing current";
  else {
    const weak = roomsByShare(c);
    const w = weak.length > 1 ? weak[weak.length - 1] : undefined;
    resNote = w ? `Where it is exposed: ${w.r.room}` : `The moves in this brief belong to ${c.brand}`;
  }
  out.unshift({
    key: "pyramid",
    viz: {
      kind: "pyramid",
      title: "One argument - situation, complication, resolution",
      items: [
        { label: "Situation", note: sitNote },
        { label: "Complication", note: compNote, accent: true },
        { label: "Resolution", note: resNote },
      ],
    },
  });
  if (c.isTarget && c.moves.length)
    out.push({
      key: "resolution",
      heading: "The resolution",
      paras: (() => {
        const seen = new Set<string>();
        return c.moves.map((m) => {
          const rep = seen.has(m.actStem);
          seen.add(m.actStem);
          return withCells({ lead: leadOf(m.lead), text: rep ? `As above - watch ${m.watch}.` : `${cap(m.act)} - watch ${m.watch}.`, tip: m.tip }, cellsAt(c, [m.cellId, m.watch]));
        });
      })(),
    });
  return out;
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
    moves: isTarget ? movesOf(map, stats, brand) : [],
    findings: [],
    placements,
    stagePicks,
    archetype: isTarget ? map.casting.archetype : leaderOfBrands(summary, subject.key) ? "specialist" : "default",
    footer: `${name} - wave ${wave}${month ? ` - ${month}` : ""}.`,
    wave,
    cards: new Map(),
    src,
  };

  ctx.findings = findingsOf(ctx);
  const sw = swotOf(ctx);
  const memo = (frame: BriefFrame, sections: BriefSection[]): BriefMemo =>
    citePins({ frame, title: `${name} - ${BRIEF_FRAME_LABELS[frame]} - wave ${ctx.wave}`, sections, footer: ctx.footer }, ctx.cards);
  const memos: Record<BriefFrame, BriefMemo> = {
    now_what: memo("now_what", nowWhat(ctx)),
    swot: memo("swot", swotFrame(ctx, sw)),
    tows: memo("tows", towsFrame(ctx, sw)),
    funnel: memo("funnel", funnelFrame(ctx)),
    matrix: memo("matrix", matrixFrame(ctx)),
    jobs: memo("jobs", jobsFrame(ctx)),
    minto: memo("minto", mintoFrame(ctx)),
  };
  // Only the cards a surviving pin opens ride the payload.
  const cards: Record<string, AnswerCard> = {};
  for (const m of Object.values(memos))
    for (const id of anchorIds(m)) {
      const card = ctx.cards.get(id);
      if (card) cards[id] = card;
    }
  return { subject: name, subjects: subjects.map((b) => (b.key === target.key ? brand : b.name)), memos, engineCount, cards };
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
const BRIEF_VERSION = "bf23";

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
  const extras = [setupDecision, `ctx:${CONTEXT_JUDGE_VERSION}:${CONTEXT_JUDGE_MODEL}`];
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
