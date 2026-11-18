import { createHash } from "node:crypto";
import { matchKey } from "../brand_key";
import { store } from "../store";
import { cachedRunRevision } from "./run_revision";
import { RESOLVE_VERSION, buildResolver } from "./brand_resolve";
import { BRAND_SUMMARY_VERSION, sharedBrandSummary, type BrandSummaryView, type SummaryBrand } from "./brand_summary";
import { ANALYSIS_MAP_VERSION, sharedAnalysisMap, type MapCellStat } from "./analysis_map";
import { CONTEXT_JUDGE_MODEL, CONTEXT_JUDGE_VERSION } from "./context_judge";
import { destOf, destPhrase, productNoun, rankedInsights, type Insight, type InsightInputs } from "./summary_insights";
import { findingMove } from "./finding_moves";
import { buyerPhrase, theProduct } from "./brief_words";
import { buildStatRegistry, statId, type CondRowStats, type Stat, type StatRegistry } from "./stat_registry";
import { decode, encode, figOf, fromStatement, hasFigs, kOf, newFigTable, nOf, rateOf, refFig, strip, tipOfStat, trReplace, type FigTable, type Tr } from "./brief_figs";
import { sharedRunFacts, type RunFacts } from "./facts/overview_facts";
import { WHAT_TO_BUY_ALL, type Scope } from "./facts/fact";
import { FLOORS, leadsFirst, liftLead, seldomOf } from "./facts/measure_book";
import { dref, evalRef, parseFactId, pref, type StmtNums } from "./facts/statements";
import type { AnySelection, SelMember } from "./facts/selections";
/** "most" only when over half of the answers that pick the rival still give a case for the brand (the card's exception
 * step's own stat); "half" at exactly half. */
const mostOfLost = (st: import("./stat_registry").Stat | undefined) => {
  if (!st) return "most";
  const r = rateOf(st);
  return r > 0.5 ? "most" : Math.round(r * 100) === 50 ? "half" : "some";
};
import { COMMON_WORDS } from "./everyday_words";
import { condLabel } from "./panel_text";
import { isDefaultCondition } from "./condition_groups";
import { cell, loadViewData, requestOf, VIEW_CACHE_MS, viewCacheOff, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { viewsOf } from "./views";
import type { AnalysisMapView, Position } from "./analysis_types";
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
 * "where" and the watch metric, each a fixed template
 * per map row. A rival subject has no moves (positions are the client's),
 * and the client-only pools (worries, value, leavers, advocacy, the Kept
 * stage) are simply absent from its memos.
 *
 * Per-situation shares are the situations' What to buy cards' own stats (stage 3:
 * every funnel figure, and every decision about one, reads a card stat); a rival's winning arguments are the summary's lift computed for
 * that brand over the same headline pool.
 */

/* --------------------------------- format --------------------------------- */

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
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

/** Anchor ids that are not Map cells: a brand's own page (its By rival card), and the old answer-card keys - used as a
 * number's preferred location only (fact layer step 5, part 2: the brand, assistants and condition answer cards are gone;
 * every number links by its fact id to the card that draws it). */
const BRAND_CARD = (key: string) => `card:brand:${key}`;
const CONDITION_CARD = "card:conditions";

/** A Map cell's answer card (bf14), kept for the phrase links of a unit with no number: the cell's claim and figures,
 * each number with its fact id (`facts`: "headline" and "rows.<i>"). The arguments' bars are not carried - their
 * shares are no facts on the Map's payload (the Map card the phrase opens draws them). */
function cardFor(c: Ctx, id: string): AnswerCard | null {
  if (c.cards.has(id)) return c.cards.get(id) ?? null;
  const p = c.map.positions[id];
  const card: AnswerCard | null = p ? cellCardOf(c, p) : null;
  c.cards.set(id, card);
  return card;
}
function cellCardOf(c: Ctx, p: Position): AnswerCard {
  return {
    kind: "cell",
    crumb: p.where,
    headline: fromStatement(c.figs, p.claim, p.facts?.claim),
    rows: (p.figures ?? []).map((f, i) => ({ label: f.label, value: fromStatement(c.figs, f.value, p.facts?.[`figures.${i}`]), ...(f.tip ? { tip: f.tip } : {}) })),
    go: { label: "Open this contest on the map", target: "map", cellId: p.cellId },
  };
}

/** A pin for a Map cell, or nothing (a non-cell id never pins). `label` is the pin's tooltip (the cell's "where"). */
function anchor(c: Ctx, id: string | null | undefined): Anchor | undefined {
  if (!id || !c.map.positions[id]) return undefined;
  cardFor(c, id);
  return { id, label: c.map.positions[id].where, kind: "cell" };
}

/** A unit's anchors, in order - Map cells, plus a brand's own page (`card:brand:<key>`) as a number's preferred
 * location (linkUnit). Only Map-cell anchors survive into the payload, and only on a unit with no number (pinsByRule). */
function cellsOf(c: Ctx, ...ids: (string | null | undefined)[]): Anchor[] | undefined {
  const out: Anchor[] = [];
  for (const id0 of ids) {
    // The old condition card's numbers are the What to buy card's condition rows.
    const id = id0 === CONDITION_CARD ? OPEN_ALL : id0;
    if (!id || out.some((x) => x.id === id)) continue;
    const a = anchor(c, id);
    if (a) out.push(a);
    else if (id.startsWith("card:brand:")) out.push({ id, label: "", kind: "brand" });
  }
  return out.length ? out : undefined;
}

/** bf14-bf33's row pin is gone: a row's number links by its fact id. */
const rowPin = (_c: Ctx, row: BriefRow, ..._ids: (string | null | undefined)[]): BriefRow => (void _c, void _ids, row);

const withCells = <T extends object>(x: T, cells: Anchor[] | undefined): T => (cells ? { ...x, cells } : x);

/** bf15: anchors for a unit whose visible text may carry no number - each
 * carries `at`, the exact phrase of the unit it attaches to (the fact link
 * when there is no number to click). `at` must be a substring of the unit's
 * visible text; pinsByRule drops it on numbered units and drops an anchor
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
/** bf46: the topics on the AI's "what to look for" list - the What to look for card's own list (all buyers), the
 * one its claim names. The Brief computed its own before and could disagree with the card (it kept a topic the
 * card leaves off as too obvious for the question asked). */
const checklistOf = (c: Ctx): string[] => {
  const id = pooledOf(c, "chooses:criteria:") ?? "";
  const pp = c.map.positions[id]?.panel;
  const sel = pp?.steps.find((x) => x.itemsSelection)?.itemsSelection;
  return (pp?.checklist ?? []).map((x) => nameOn(c, "checklist", id, x, sel));
};
function pooledOf(c: Ctx, prefix: string): string | undefined {
  if (c.map.positions[`${prefix}all`]) return `${prefix}all`;
  const ids = Object.keys(c.map.positions).filter((id) => id.startsWith(prefix));
  return ids.length === 1 ? ids[0] : undefined;
}

const OPEN_ALL = "chooses:open:all";

/* ------------------------- stage 2: funnel figures from the cards ------------------------- */

/**
 * The Brief's funnel figures (named, recommended, recommendations that end as the pick, share of picks, picked of
 * all answers, the commit rate, the average and the most-picked competitor, per buying situation) are the cards'
 * own Stat objects (stat_registry.ts), printed with `fig` - never a number this file computes. The tracker's
 * figures live on the What to buy card (all buyers, or the buyer's own card); a rival's on its By rival card, or
 * the What to buy card's competitor bars. A fact no card draws is printed from the fact book by its id (factFig) and
 * left unlinked; the links harness lists it.
 */
const fig = (c: Ctx, s: Stat) => figOf(c.figs, s);
/** A fact the Brief prints that no card draws (listed by the harness): printed from the fact book by its id. */
const factFig = (c: Ctx, measure: string, subject: string, scope: Scope) => {
  const f = c.rf.book.fact(measure, subject, scope);
  return refFig(c.figs, f.id, f.text);
};
const brandName = (c: Ctx, key: string) => c.summary.brands.find((b) => b.key === key)?.name ?? (key === c.target.key ? c.brand : key);
interface FunnelStats {
  named?: Stat;
  rec?: Stat;
  conv?: Stat;
  share?: Stat;
  picked?: Stat;
}
/** One brand's funnel as the cards show it: the tracker on the What to buy card, a rival on its By rival card. */
function funnelStats(c: Ctx, key: string): FunnelStats {
  const r = c.reg;
  if (key === c.target.key)
    return { named: r.step(OPEN_ALL, "named", "you"), rec: r.step(OPEN_ALL, "recommended", "you"), conv: r.step(OPEN_ALL, "converts", "you"), share: r.line(OPEN_ALL, "share", "you"), picked: r.line(OPEN_ALL, "picked", "you") };
  const n = brandName(c, key);
  return { named: r.rivalStep(n, "named", "rival"), rec: r.rivalBody(n, "named", "recommended"), conv: r.rivalBody(n, "named", "converts"), share: r.rivalStep(n, "open", "rival"), picked: r.rivalStep(n, "picked", "rival") };
}

/**
 * Stage 3 (2026-11-17): every DECISION about a funnel figure reads the same stat the sentence prints - which
 * sentence is written, every threshold, every order of brands and buying situations, "never"/"every" at the ends.
 * The brand summary's funnel cells and the per-situation headline reads are not consulted at all: a brand here is
 * who it is (`Brand`), and its figures are its stats. `fun(c, key)` is the brand's funnel; the readers below decide
 * from the stat's own counts (brief_figs rateOf / kOf / nOf).
 */
type Brand = Pick<SummaryBrand, "key" | "name" | "role">;
/** The brand's funnel stats (cached per Brief). A brand in the funnel universe has named, share and picked. */
function fun(c: Ctx, key: string): FunnelStats {
  let f = c.funnel.get(key);
  if (!f) c.funnel.set(key, (f = funnelStats(c, key)));
  return f;
}
const need = (s: Stat | undefined, what: string): Stat => {
  if (!s) throw new Error(`no card shows ${what}`);
  return s;
};
/** How often the AI names the brand when buyers ask what to buy. */
const namedRate = (c: Ctx, key: string) => rateOf(need(fun(c, key).named, `${key} named`));
const namedK = (c: Ctx, key: string) => kOf(need(fun(c, key).named, `${key} named`));
const namedN = (c: Ctx, key: string) => nOf(need(fun(c, key).named, `${key} named`));
/** Answers that recommend the brand (a rival's card states it only when the brand is named at all). */
const recK = (c: Ctx, key: string) => {
  const s = fun(c, key).rec;
  return s ? kOf(s) : 0;
};
const recRate = (c: Ctx, key: string) => rateOf(need(fun(c, key).rec, `${key} recommended`));
/** Recommendations that end as the pick: the card's own figure; a brand never recommended converts none. */
const convRate = (c: Ctx, key: string) => {
  const s = fun(c, key).conv;
  if (s) return rateOf(s);
  if (recK(c, key) > 0) throw new Error(`no card shows ${key} conversion`);
  return 0;
};
/** The brand's picks (the share-of-picks numerator) and its share of picks. */
const picksOf = (c: Ctx, key: string) => kOf(need(fun(c, key).share, `${key} share of picks`));
const shareRate = (c: Ctx, key: string) => rateOf(need(fun(c, key).share, `${key} share of picks`));
const pickedRate = (c: Ctx, key: string) => rateOf(need(fun(c, key).picked, `${key} picked`));
/** The commit rate's stat (the all-buyers What to buy card), and its count: answers that commit to one product. */
const commitStat = (c: Ctx) => need(c.reg.line(OPEN_ALL, "commit", "rate"), "the commit rate");
const commitK = (c: Ctx) => kOf(commitStat(c));
/** A stat's counts as the Brief's tip ("k of n"). */
const tipOfFig = (s: Stat | undefined) => (s ? tipOfStat(s) : "");

/**
 * The funnel universe: every brand with a funnel on a card (the tracker on the What to buy card, each rival on its
 * By rival card), most picked first - picks, then times named, then name (the brand summary's own order, read from
 * the cards' counts). A brand no card shows has no figure to print and takes no part in a funnel decision; the links
 * harness lists any such brand.
 */
function funnelBrands(c: Ctx): Brand[] {
  if (!c.funnelBrands) {
    const has = (b: Brand) => !!fun(c, b.key).named && !!fun(c, b.key).share && !!fun(c, b.key).picked;
    c.funnelBrands = c.summary.brands.filter(has).sort((a, b) => picksOf(c, b.key) - picksOf(c, a.key) || namedK(c, b.key) - namedK(c, a.key) || a.name.localeCompare(b.name));
  }
  return c.funnelBrands;
}

/** A brand's funnel figures, printed from its stats. */
const fNamed = (c: Ctx, b: Brand) => fig(c, need(fun(c, b.key).named, `${b.name} named`));
const fRec = (c: Ctx, b: Brand) => fig(c, need(fun(c, b.key).rec, `${b.name} recommended`));
/** Recommendations that end as the pick, as a card draws it (a brand never recommended has none: callers say so in words). */
const fConv = (c: Ctx, b: Brand) => fig(c, need(fun(c, b.key).conv, `${b.name} conversion`));
const fShare = (c: Ctx, b: Brand) => fig(c, need(fun(c, b.key).share, `${b.name} share of picks`));
const fPicked = (c: Ctx, b: Brand) => fig(c, need(fun(c, b.key).picked, `${b.name} picked`));
/** The commit rate - about the AI, on the all-buyers What to buy card whoever the subject is. */
const fCommit = (c: Ctx) => fig(c, commitStat(c));
/** A brand's share of the picks with one buyer: the tracker's on the buyer's What to buy card, a rival's in that
 * card's competitors, else on the rival's By rival card ("Where it takes its picks"). */
function roomShareStat(c: Ctx, room: string, key: string): Stat | undefined {
  const id = `chooses:open:${norm(room)}`;
  if (key === c.target.key) return c.reg.line(id, "share", "you") ?? c.reg.competitor(id, "you");
  const n = brandName(c, key);
  const label = c.stats[id]?.label;
  return c.reg.competitor(id, n) ?? (label ? c.reg.rivalTable(n, "byBuyer", "Where it takes its picks", label, 0) : undefined);
}
/** A room share as printed: its stat; a brand the room's cards do not list (it takes no picks there) is the fact itself,
 * which no card draws (the harness lists it). */
const fRoom = (c: Ctx, room: string, key: string) => {
  const s = roomShareStat(c, room, key);
  return s ? fig(c, s) : factFig(c, "share_of_picks", key === c.target.key ? "you" : key, { ...WHAT_TO_BUY_ALL, situation: room });
};

/* ------------------------- stage 4: verdict figures from the cards ------------------------- */

/**
 * Stage 4 (2026-11-17): the verdict figures - Value (worth it / it depends / not worth it, where it points the buyer
 * instead), the buyers' worries (go ahead), the customers' worries and the customers looking around (stay / leave /
 * no side), rivals' customers switching (named, picked) and the direct matchups (who the AI picks when it picks one
 * of the two) - are the verdict cards' own stats: printed with `vfig`, linked by the stat's id, and every decision
 * about them (thresholds, which sentence, which worry or rival is named, sort orders, never / every) reads the same
 * stat's counts. A verdict no card draws is not written (fact layer step 5, part 2 retired the old-view fallback).
 */
interface VF {
  k: number;
  n: number;
  stat: Stat;
}
const vOf = (s: Stat): VF => ({ k: kOf(s), n: nOf(s), stat: s });
const vRate = (f: VF) => (f.n > 0 ? f.k / f.n : 0);
const vTip = (f: VF) => `${f.k} of ${f.n}`;
/** A verdict figure, printed: its card's stat. */
const vfig = (c: Ctx, f: VF) => fig(c, f.stat);
/** The stat as a figure; a verdict no card draws is not written (fact layer step 5, part 2: no old-view fallback). */
const statOr = (s: Stat | undefined): VF | undefined => (s ? vOf(s) : undefined);
/** "<verb> in N% of answers" with "never" / "every" at the extremes. */
const vShareWords = (c: Ctx, x: VF, verb: string, never: string) => (x.k === 0 ? never : x.k === x.n ? `${verb} in every answer` : `${verb} in ${vfig(c, x)} of answers`);

/** A row's cell by its stats (a worry by its wording, a rival's leavers by its key). */
const cellWhere = (c: Ctx, f: (st: MapCellStat) => boolean) => Object.entries(c.stats).find(([, st]) => f(st))?.[0];
const worryCell = (c: Ctx, row: "buyers" | "customers", concern: string) => cellWhere(c, (st) => st.row === row && norm(st.label) === norm(concern));
const leaverCell = (c: Ctx, key: string) => cellWhere(c, (st) => st.row === "leavers" && st.rivalKey === key);
/** A Value cell: the pooled one, or one buying situation's. */
const valueCell = (c: Ctx, room?: string) => (room === undefined ? pooledOf(c, "chooses:value:") : c.map.positions[`chooses:value:${norm(room)}`] ? `chooses:value:${norm(room)}` : undefined);
const seg = (c: Ctx, id: string | undefined, step: string, key: string) => (id ? c.reg.segment(id, step, key) : undefined);

/** The Value card's verdict: worth it / not worth it / it depends (shares of all its answers). */
interface Worth3 {
  yes: VF;
  no: VF;
  depends: VF;
}
function worthOf(c: Ctx, id: string | undefined): Worth3 | null {
  const y = seg(c, id, "worth", "yes");
  const n = seg(c, id, "worth", "no");
  const d = seg(c, id, "worth", "depends");
  return y && n && d ? { yes: vOf(y), no: vOf(n), depends: vOf(d) } : null;
}
/** The pooled Value verdict (all buyers). */
const worthAll = (c: Ctx) => (c.verdicts.value ? worthOf(c, valueCell(c)) : null);
/** One buying situation's Value verdict. */
const worthIn = (c: Ctx, room: string) => worthOf(c, valueCell(c, room));
/** The Value card's "Where it points the buyer instead": a rival, only the brand's own cheaper option. */
function insteadOf(c: Ctx, id: string | undefined): { rival: VF; own?: VF } | null {
  const rival = seg(c, id, "instead", "rival");
  const own = seg(c, id, "instead", "own");
  return rival ? { rival: vOf(rival), ...(own ? { own: vOf(own) } : {}) } : null;
}
/** The rival the Value card names most when it points the buyer elsewhere: its explanation's list ("Where it points
 * the buyer instead"), first row in the card's own order (statids8: never re-sorted here). */
function insteadLeader(c: Ctx, id: string | undefined): string | undefined {
  const first = id ? c.reg.section(id, "instead", "Where it points the buyer instead")[0] : undefined;
  const sel = c.map.positions[id!]?.panel?.details?.instead?.sections?.find((x) => x.title === "Where it points the buyer instead")?.selection;
  return first ? nameOn(c, "instead-rival", id!, first.label, sel) : undefined;
}
/** A worry card's verdict segment (buyers: proceed / avoid / none; customers and looking around: keep / leave / none). */
const verdictOf = (c: Ctx, id: string | undefined, key: string) => seg(c, id, "verdict", key);
/** The pooled buyers' and customers' worries, and the customers looking around. */
const buyersAll = (c: Ctx) => pooledOf(c, "doubts:buyers:");
const customersAll = (c: Ctx) => pooledOf(c, "doubts:customers:");
const holdAll = (c: Ctx) => pooledOf(c, "doubts:hold:");
/** The tracker's direct matchup against one rival: the share of the picks between the two that go to the tracker. */
const matchupWon = (c: Ctx, key: string): VF | undefined => statOr(c.reg.step(rivalCell(c, key) ?? "", "won", "you"));
/** A rival subject's record against the tracker: the share of the picks between the two that go to the rival - on the
 * subject's own named-rival matchup card or, for a brand asked about as a class, its "a <brand> card" matchup card (bf45). */
const vsTargetOf = (c: Ctx): VF | undefined =>
  c.isTarget || !(c.verdicts.h2h.some((r) => r.key === c.subject.key) || classCells(c).has(c.subject.key))
    ? undefined
    : statOr(c.reg.step(rivalCell(c, c.subject.key) ?? "", "won", "vs"));
/** The Wilson range of a verdict figure (the matchups' won / lost bars). */
const vRange = (f: VF) => cell(f.k, f.n);
/** The named rivals with a direct matchup, most answers first (each matchup card's own answers; ties by name). */
function h2hOrder(c: Ctx) {
  const n = (key: string) => {
    const s = c.reg.step(rivalCell(c, key) ?? "", "decided", "you");
    return s ? nOf(s) : -1;
  };
  return [...c.verdicts.h2h].sort((a, b) => n(b.key) - n(a.key) || a.rival.localeCompare(b.rival));
}
/** The Value question's buying situations, most answers first (each situation's Value card; ties by name). */
function valueRoomsOrder(c: Ctx) {
  const rows = (c.verdicts.value?.rooms ?? []).map((r) => ({ r, w: r.rooms.length === 1 ? worthIn(c, r.key) : null }));
  return rows.sort((a, b) => (b.w?.yes.n ?? -1) - (a.w?.yes.n ?? -1) || a.r.key.localeCompare(b.r.key));
}
/** The pooled customers' worries: told to stay / to leave / no side (the card's verdict bar). */
function customersVerdict(c: Ctx): { keep: VF; leave: VF; none: VF } | null {
  const id = customersAll(c);
  const k = verdictOf(c, id, "keep");
  const l = verdictOf(c, id, "leave");
  const x = verdictOf(c, id, "none");
  return k && l && x ? { keep: vOf(k), leave: vOf(l), none: vOf(x) } : null;
}
/** A rival's customers looking to switch: the tracker picked, of all answers, and named (that rival's leavers card). */
function leaverFigs(c: Ctx, key: string): { picked: VF; named: VF } | null {
  const id = leaverCell(c, key);
  const p = id ? c.reg.line(id, "picked", "you") : undefined;
  const nm = id ? c.reg.step(id, "named", "you") : undefined;
  return p && nm ? { picked: vOf(p), named: vOf(nm) } : null;
}
/** The rivals whose customers ask what to switch to, most answers first (each leavers card's own answers; ties by name). */
function leaversOrder(c: Ctx) {
  const n = (key: string) => (key === "generic" ? -1 : leaverFigs(c, key)?.picked.n ?? -1);
  return [...c.verdicts.leavers].sort((a, b) => n(b.key) - n(a.key) || a.rival.localeCompare(b.rival));
}
/** The tracker's own customers looking around: told to stay / to leave (the card's verdict bar). */
function holdFigs(c: Ctx): { keep: VF; leave: VF } | null {
  const id = holdAll(c);
  const k = verdictOf(c, id, "keep");
  const l = verdictOf(c, id, "leave");
  return k && l ? { keep: vOf(k), leave: vOf(l) } : null;
}
/* ------------------- stage 5: conditions and arguments from the cards ------------------- */

/**
 * Stage 5 (2026-11-17): the condition and argument figures - what the AI says about the buyer (a card's condition
 * rows: their share, the other side's share, where they send buyers) and what it says about the category (a card's
 * "What the answer weighs" rows: the share on each side) - are the cards' own stats, printed with `fig`, linked by
 * the stat's id; every decision about them (which argument or condition is named, the lift test, order, floors,
 * whether the sentence is written) reads the same stats' counts. A condition or argument figure no card shows is
 * not written (step 5, part 2: no old-source fallback).
 */

/** An argument figure as the Brief prints it: the stat, or "none" where the card shows 0% ("argued in none of those"). */
const argFig = (t: FigTable, s: Stat) => (s.value === "0%" ? "none" : figOf(t, s));

/** One argument as a card's "What the answer weighs" block shows it on both sides: `subj` = its share when the AI picks
 * the subject, `oth` = when it picks the other side; the lift test reads these stats' counts. */
interface ArgStat {
  code: string;
  name: string;
  /** The weighs block's selection (the card's "What the answer weighs" topics). */
  sel?: string;
  subj: Stat;
  oth: Stat;
  wins: RateCell;
  others: RateCell;
  lift: number;
  /** Raised in under FLOORS.seldomShare of the two sides' answers together (measure_book seldomOf). */
  seldom: boolean;
}
const argOf = (code: string, name: string, subj: Stat, oth: Stat, sel?: string): ArgStat => {
  const wins = cell(kOf(subj), nOf(subj));
  const others = cell(kOf(oth), nOf(oth));
  return { code, name, subj, oth, wins, others, lift: rate(wins) - rate(others), seldom: seldomOf(wins, others), ...(sel ? { sel } : {}) };
};
/** A named lead argument that is seldom raised says so (ruling 1). */
const seldomSaid = (a: { seldom: boolean } | undefined | null) => (a?.seldom ? ", though it is seldom raised" : "");

/**
 * The two sides of a "What the answer weighs" block about `subjectName` on one What to buy card: the tracker reads the
 * card's own competitors view (when it picks you / when it picks another), a rival reads its card inside that cell
 * (when it picks the tracker / when it picks the rival). Each row is an argument only when its name is a codebook code
 * (`codes`, case ignored). Null when the card shows no two-sided block for the subject.
 */
function argSides(reg: StatRegistry, codes: string[], isTarget: boolean, subjectName: string, cellId: string, map?: AnalysisMapView): { subj: ArgStat[]; oth: ArgStat[] } | null {
  let dest: string;
  let view: "plain" | "comp";
  let sc: number;
  let sel: string | undefined;
  const pp = map?.positions[cellId]?.panel;
  if (isTarget) {
    dest = statId.cell(cellId);
    view = "comp";
    sc = 0;
    sel = pp?.weighsComp?.selection;
  } else {
    const part = reg.rivalPart(cellId, subjectName);
    if (!part) return null;
    dest = statId.cellRival(cellId, part);
    view = "plain";
    sc = 1;
    sel = pp?.rivals?.find((r) => r.name === part)?.weighs?.selection;
  }
  const subjRows = reg.weighsRows(dest, view, sc);
  const othRows = reg.weighsRows(dest, view, 1 - sc);
  // A two-sided block: the card draws both columns (a rival's one-column block is not sided).
  if (!isTarget && !subjRows.length) return null;
  if (!subjRows.length && !othRows.length) return null;
  const code = (name: string) => codes.find((x) => x.toLowerCase() === name.toLowerCase());
  const subj = subjRows.filter((r) => r.other && code(r.name)).map((r) => argOf(code(r.name)!, r.name, r.num, r.other!, sel));
  const oth = othRows.filter((r) => r.other && code(r.name)).map((r) => argOf(code(r.name)!, r.name, r.other!, r.num, sel));
  return { subj, oth };
}

/** The strongest argument the card shows on each side that passes the lift test on its own counts (wins clear of the
 * other side's range) - the largest lift first, ties in the card's order; a row that is not seldom raised leads
 * whenever one passes (ruling 1, liftLead). */
function liftPicks(sides: { subj: ArgStat[]; oth: ArgStat[] } | null): { best?: ArgStat; worst?: ArgStat } {
  if (!sides) return {};
  const best = liftLead(sides.subj.filter((a) => a.lift > 0 && a.wins.low > a.others.high).sort((a, b) => b.lift - a.lift))?.row;
  const worst = liftLead(sides.oth.filter((a) => a.lift < 0 && a.others.low > a.wins.high).sort((a, b) => a.lift - b.lift))?.row;
  return { ...(best ? { best } : {}), ...(worst ? { worst } : {}) };
}

/** An argument's figures as the Brief prints them: `here` on the named side, `there` on the other ("none" at 0%). */
function argWords(t: FigTable, a: ArgStat, side: "subject" | "other"): { name: string; here: string; there: string } {
  return side === "subject" ? { name: a.name, here: argFig(t, a.subj), there: argFig(t, a.oth) } : { name: a.name, here: argFig(t, a.oth), there: argFig(t, a.subj) };
}

/** Tips for an argument: its counts on each side. */
const argTip = (a: ArgStat) => `${tipOf(a.wins)} wins; ${tipOf(a.others)} other picks.`;

/** A card's condition rows on one side (the What to buy card, or a rival's card inside it), in the card's order. */
function condRows(c: Ctx, cellId: string, side: "toward" | "away", rivalName?: string): CondRowStats[] {
  const dest = rivalName ? (c.reg.rivalPart(cellId, rivalName) ? statId.cellRival(cellId, c.reg.rivalPart(cellId, rivalName)!) : null) : statId.cell(cellId);
  return dest ? c.reg.conditionRows(dest, side) : [];
}

/* ------------- statids8: the names and lists the Brief states, from the cards ------------- */

/**
 * statids8 (2026-11-17, "one engine" covers names and lists too): every name the Brief states in a role a card shows
 * - a fixed situation, the brand a buyer is sent to, the product a Value question asked about, the rival a price answer
 * names most, the condition that sends buyers away, an argument on the AI's checklist that comes up more when another
 * brand is picked, who takes the picks in a situation, a matchup's or a worry's own name - is read from the card that
 * shows it in that role, in the card's own order: the Brief names it BECAUSE the card shows it. `nameOn` records each
 * (BRIEF_NAME_LOG=1) with the card it is read from, and the links harness checks the card draws it there.
 */
export interface NameLogEntry {
  brand: string;
  subject?: string;
  kind:
    | "wall"
    | "taker"
    | "away-row"
    | "away-to"
    | "value-product"
    | "instead-rival"
    | "checklist"
    | "checklist-against"
    | "cell-label"
    | "weighs-leader"
    | "price-worry"
    | "visibility"
    | "visibility-folded"
    | "leader"
    | "room-leader"
    | "converts-better"
    | "argument"
    | "condition"
    | "competitor";
  name: string;
  cellId: string;
  /** Fact layer step 5, part 2: the selection the name is a member of (its id - the proof recomputes it from the id). */
  sel?: string;
  /** The member's key in that selection (an entry id, a code, a worry's wording), when it differs from the name. */
  key?: string;
}
export const NAME_LOG: NameLogEntry[] = [];
function nameOn<T extends string>(c: Ctx, kind: NameLogEntry["kind"], cellId: string, name: T, sel?: string, key?: string): T {
  if (process.env.BRIEF_NAME_LOG) NAME_LOG.push({ brand: c.brand, ...(c.isTarget ? {} : { subject: c.name }), kind, name, cellId, ...(sel ? { sel } : {}), ...(key !== undefined ? { key } : {}) });
  return name;
}
/** The fixed situation a cell's card names: the move box's why line ("Many of the buyers sent away here are in a
 * situation you cannot argue against: "<wall>"" - drawn on a card that carries a move). */
function cardWall(c: Ctx, id: string): string | null {
  const p = c.map.positions[id];
  return p?.lever && p.notes?.wall ? nameOn(c, "wall", id, p.notes.wall, p.panel?.conditions?.selections?.away) : null;
}
/** The product a Value card asked about, as its steps name it ("Asked about: <product>"); an all-buyers card whose
 * buyers were asked about several products names the brand (its claim's subject). Raw (for comparing) or as words. */
function valueProductRaw(c: Ctx, id: string | undefined): string | null {
  const p = id ? c.map.positions[id]?.panel : undefined;
  if (!p?.product || p.byProduct) return null;
  // The product the question asked about: one of the price lines the cell's answers were asked about (price_lines).
  const scope = c.stats[id!]?.youFact ? parseFactId(c.stats[id!].youFact!).scope : undefined;
  const sel = scope ? c.rf.sel.selection("price_lines", "ai", scope).id : undefined;
  return nameOn(c, "value-product", id!, p.product, sel);
}
const valueProduct = (c: Ctx, id: string | undefined) => {
  const raw = valueProductRaw(c, id);
  return raw ? theProduct(raw, c.brand, COMMON_WORDS) : c.brand;
};
/** A card's condition row as a destination phrase: its "To ..." rows in the card's order ("to X", or "mostly to X and
 * Y" when the first takes under half the row's answers - the finding's own rule, on the card's counts). */
function cardDest(c: Ctx, cellId: string, row: CondRowStats): string {
  // Each destination is the subject of its own fact (cond_dest|<brand>/cond:<units>|scope): the name is that brand's.
  const to = row.to.map((t) => ({ name: nameOn(c, "away-to", cellId, t.name, undefined, t.stat.fact ? parseFactId(t.stat.fact).subject.split("/")[0] : undefined), n: kOf(t.stat) }));
  const d = destOf(to, to.length ? nOf(row.to[0].stat) : 0);
  return d ? destPhrase(d) : "";
}
/** Who takes the picks on a pick contest's card (its "Who takes the picks" block, the first row that is not the
 * tracker's): the name and its share. */
function cardTaker(c: Ctx, cellId: string): { name: string; stat: Stat } | undefined {
  const r = c.reg.competitorRows(cellId).find((x) => !x.you);
  return r ? { name: nameOn(c, "taker", cellId, r.name, c.map.positions[cellId]?.panel?.competitors?.selection), stat: r.stat } : undefined;
}
/** A cell's own name as its card is titled (a matchup's rival, a rival's customers, a worry's wording). */
/** The cell's name is its own scope's subject - the rival it names, the worry, the buying situation - read back from the
 * fact the cell's verdict reads (the proof checks the label against that scope). */
const cardLabel = (c: Ctx, id: string | undefined, fallback: string) => (id && c.stats[id] ? nameOn(c, "cell-label", id, c.stats[id].label, undefined, c.stats[id].youFact) : fallback);

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

/** Fact layer step 5, part 2: a number links by its fact id (linkUnit), so a pin is kept only where there is no number
 * to click - a numberless unit's Map-cell anchor whose `at` phrase is in its text (bf15). A numbered unit and every row
 * carry no pins. */
function pinsByRule(memo: BriefMemo): BriefMemo {
  const para = (p: BriefPara): BriefPara => {
    if (!p.cells?.length) return p;
    const visible = `${p.lead ?? ""} ${p.text}`;
    const kept = briefNumberTokens(visible).size ? [] : p.cells.filter((a) => (a.kind ?? "cell") === "cell" && !!a.at && visible.includes(a.at));
    const { cells: _drop, ...rest } = p;
    void _drop;
    return kept.length ? { ...rest, cells: kept } : rest;
  };
  const row = (r: BriefRow): BriefRow => {
    if (!r.cell) return r;
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
const topRival = (c: Ctx) => funnelBrands(c).find((b) => b.role !== "target" && picksOf(c, b.key) > 0);
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
  engine_spread: { pools: [] },
  engine_mode: { pools: [] },
  engine_vendor: { pools: [] },
  engine_decisiveness: { pools: [] },
  engine_h2h_flip: { pools: ["fights:h2h:"] },
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
  const pools = srcs.map((s) => (s.endsWith(":") ? pooledOf(c, s) : s)).filter((x): x is string => !!x && (!!c.map.positions[x] || x.startsWith("card:brand:") || x === CONDITION_CARD));
  const m = (rule.match || rule.matchFirst) && matched ? [matched] : [];
  const ids = rule.matchFirst ? [...m, ...pools] : [...pools, ...m];
  return [...new Set(ids.length ? ids : matched ? [matched] : [])];
}

/* --------------------------------- context -------------------------------- */

/** Stage 3: a buying situation as its What to buy card shows it - the commit line (answers that commit to one
 * product, of the situation's answers) and every brand's share of the picks there, each a stat. */
interface RoomRead {
  room: string;
  description: string | null;
  /** The situation card's commit line: k = answers that commit to one product (the firm-pick floor), n = its answers. */
  commit?: Stat;
  /** Every brand some card shows a share of the picks for in this situation, most picked first. */
  brands: RoomBrand[];
  /** The situation's leader other than the subject: the leader selection on the situation's What to buy scope, with its
   * share of the picks there. */
  leader?: RoomBrand;
}
interface RoomBrand {
  key: string;
  name: string;
  share: Stat;
}
/** The situation's committed answers and all its answers, from its commit stat (no card: none). */
const roomFirm = (r: RoomRead) => (r.commit ? kOf(r.commit) : 0);
const roomAnswers = (r: RoomRead) => (r.commit ? nOf(r.commit) : 0);

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

/** Stage 3: the brand summary with its funnel cells taken out - brands are who they are; their figures are stats
 * (fun / funnelBrands). The summary's other parts (worries, matchups, insights) are out of this stage's scope. */
type BriefSummary = Omit<BrandSummaryView, "target" | "brands" | "firmPick" | "firmPickInCategory" | "byMode" | "byEngine" | "headToHead" | "buyersDoubt" | "customersDoubt"> & { target: Brand; brands: Brand[] };
/** Stage 4: who the verdict figures are about - names only, no figure (the figures are the cards' stats). */
interface VerdictIdent {
  /** The named rivals with a direct matchup. */
  h2h: { key: string; rival: string }[];
  /** The Value question: its product lines, and the buying situations it is asked in. */
  value: { lines: { label: string }[]; rooms: { key: string; rooms: string[]; line: string | null }[] } | null;
  /** The buyers' worries and the customers' worries, by their wording. */
  buyers: { stage: string; concern: string }[];
  customers: { stage: string; concern: string }[];
  /** The rivals whose customers ask what to switch to. */
  leavers: { key: string; rival: string }[];
}

interface Ctx {
  data: ViewData;
  summary: BriefSummary;
  /** The full brand summary, for the dossier membership rule only. Never read for a figure in this file. */
  outOfScope: { summary: BrandSummaryView };
  /** Stage 3: each brand's funnel stats (fun), and the funnel universe (funnelBrands), built once. */
  funnel: Map<string, FunnelStats>;
  funnelBrands?: Brand[];
  /** Stage 4: who the verdict figures are about (names only). */
  verdicts: VerdictIdent;
  map: AnalysisMapView;
  stats: Record<string, MapCellStat>;
  ranked: Insight[];
  isTarget: boolean;
  target: Brand;
  subject: Brand;
  brand: string;
  name: string;
  product: string;
  rooms: RoomRead[];
  /** Stage 5: the codebook's argument names (a card's weighs row is an argument when its name is one of these). */
  argCodes: string[];
  moves: Move[];
  /** now_what's numbered findings (served insights; rival: composed facts) - the other frames skip them. */
  findings: { lead: string; text: string; tip?: string; key: string; cellIds?: string[] }[];
  /** Ranked insights placed on map cells by the map's own matcher (key + title -> cell id). */
  placements: Map<string, string>;
  /** The closing-sentence archetype (the map's casting for the target; leads/else for a rival). */
  archetype: string;
  footer: string;
  wave: number;
  /** bf14: the Map-cell answer cards built so far, by anchor id (null = nothing to show there). */
  cards: Map<string, AnswerCard | null>;
  /** bf26: the same detectors in the Brief's style (third person, buyers as words), by key - target only. */
  voiced: Map<string, Insight>;
  /** Stage 2 (stat ids): every number the cards draw, and the figures this Brief has printed from them. */
  reg: StatRegistry;
  figs: FigTable;
  /** Fact layer step 5, part 2: the run's facts and selections (the same book the cards, the Map and the Overview read),
   * and where each fact is drawn (fact id -> the card stats that draw it, registry order). */
  rf: RunFacts;
  drawn: Map<string, Stat[]>;
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

function movesOf(map: AnalysisMapView, stats: Record<string, MapCellStat>, brand: string, findingAt: (cellId: string) => Insight | undefined, figs: FigTable): Move[] {
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
      // The Map's claim, a statement: its numbers carry their fact ids.
      claim: fromStatement(figs, p.claim, p.facts?.claim),
      lever: fm ? sentence(fm.text) : sentence(leverAbout(p.lever, brand, st.wall)),
      act,
      actStem: stem,
      family: fm ? fm.family : p.family,
      watch: w.watch,
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

/** A brand's share of the picks in a situation, as the cards show it (absent: no card lists it there). */
const roomBrand = (r: RoomRead, key: string) => r.brands.find((b) => b.key === key);
/** Its picks and share there, from that stat (no stat: none). */
const roomK = (s: Stat | undefined) => (s ? kOf(s) : 0);
const roomRate = (s: Stat | undefined) => (s ? rateOf(s) : 0);
/** "k of n" for a share in a situation (a brand no card lists there: none of the situation's committed answers). */
const roomTip = (r: RoomRead, s: Stat | undefined) => (s ? tipOfStat(s) : `0 of ${roomFirm(r)}`);

/** Rooms ranked by the subject's share of picks there (enough picks to read). */
function roomsByShare(c: Ctx) {
  return c.rooms
    .filter((r) => roomFirm(r) >= MIN)
    .map((r) => {
      const share = roomBrand(r, c.subject.key)?.share;
      const top = r.leader;
      return { r, share, top };
    })
    .sort((a, b) => roomRate(b.share) - roomRate(a.share) || a.r.room.localeCompare(b.r.room));
}

/** The subject's leading rival when buyers ask what to buy: the leader selection (selections.ts - the brand in analysis
 * other than the subject with the most picks; ties by times named, then by name). */
function leaderOf(c: Ctx): Brand | undefined {
  const sel = c.rf.sel.selection("leader", c.isTarget ? "you" : c.subject.key, WHAT_TO_BUY_ALL);
  const m = (sel.members as SelMember[])[0];
  if (!m) return undefined;
  nameOn(c, "leader", OPEN_ALL, m.name, sel.id, m.key);
  return brandOfKey(c, m.key);
}
/** A brand by its entry id, as the Brief names it (the brand summary's display name). */
const brandOfKey = (c: Ctx, key: string): Brand => c.summary.brands.find((b) => b.key === key) ?? (key === c.target.key ? c.target : { key, name: key, role: "rival" as Brand["role"] });
/** The brands whose recommendations end as the pick more often than the subject's: the converts_better selection
 * (recommended in 20+ answers; the best converter first, ties by name; top 3). */
function convertsBetter(c: Ctx): Brand[] {
  const sel = c.rf.sel.selection("converts_better", c.isTarget ? "you" : c.subject.key, WHAT_TO_BUY_ALL, { min: MIN, top: 3 });
  return (sel.members as SelMember[]).map((m) => (nameOn(c, "converts-better", OPEN_ALL, m.name, sel.id, m.key), brandOfKey(c, m.key)));
}

/** now_what's one-paragraph verdict: casting, the funnel with the commit
 * rate, the share of picks against the top rival, and one close templated
 * from the archetype. */
function verdictPara(c: Ctx): BriefPara {
  const S = c.subject;
  const f = fun(c, S.key);
  const parts: string[] = [];
  const tips: string[] = [`Named ${tipOfFig(f.named)}; recommended ${tipOfFig(f.rec)}; picked ${tipOfFig(f.picked)}; ${picksOf(c, S.key)} of ${commitK(c)} in-category picks.`];
  // The Map's casting, a statement: its numbers carry their fact ids.
  if (c.isTarget) parts.push(fromStatement(c.figs, c.map.casting.casting, c.map.casting.facts?.casting));
  // bf29: the scoreboard below carries named, recommended and the leader's share; the verdict keeps the two
  // pick numbers with their bridge.
  parts.push(`The AI commits to one ${c.product} in ${fCommit(c)} of answers; when it does, ${c.name} is the pick ${fShare(c, S)} of the time${pickedHome(c) ? ` - ${fPicked(c, S)} of all answers` : ""}.`);
  const leader = leaderOf(c);
  const ranked = roomsByShare(c);
  // A buying situation the close names (its rival share lives on that cell).
  let roomPin: string | undefined;
  switch (c.archetype) {
    case "default": {
      const weak = ranked[ranked.length - 1];
      if (weak && weak.top && kOf(weak.top.share) > 0) roomPin = `chooses:open:${norm(weak.r.room)}`;
      parts.push(
        weak && weak.top && kOf(weak.top.share) > 0
          ? `When nothing pulls the buyer elsewhere, the answer is ${c.name}; the contest is over the buyers something does pull - ${buyerPhrase(weak.r.room)}, where ${weak.top.name} takes ${fRoom(c, weak.r.room, weak.top.key)}.`
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
            ? `It leads no buying situation - it comes closest with ${buyerPhrase(closest.r.room)}, ${roomK(closest.mine) === 0 ? "none" : fRoom(c, closest.r.room, S.key)} of the picks to ${fRoom(c, closest.r.room, closest.leader.key)} for ${closest.leader.name}.`
            : `The ${c.product} the AI describes is for a specific buyer; the buyer who doesn't say who they are gets someone else's ${c.product}.`
      );
    }
  }
  return withCells({ text: parts.join(" "), tip: tips.join(" ") }, cellsOf(c, ...subjectPins(c), leader ? brandPin(c, leader.key) : null, roomPin));
}

function funnelBreaks(c: Ctx): BriefPara {
  const S = c.subject;
  const parts = [
    // bf29: recommended and picked are the scoreboard's; this line keeps the conversion comparison. A brand no answer
    // recommends has no conversion (the fact's base is empty; no card draws it) - said in words.
    fun(c, S.key).conv ? `Only ${fConv(c, S)} of the answers that recommend ${c.name} end with it as the pick.` : `No answer recommends ${c.name}.`,
  ];
  const tips = [`${picksOf(c, S.key)} picks of ${recK(c, S.key)} recommending answers.`];
  const better = convertsBetter(c);
  if (better.length) {
    parts.push(`${listOf(better.map((b, i) => (i === 0 ? `${b.name} turns ${fConv(c, b)} of its recommendations into picks` : `${b.name} ${fConv(c, b)}`)))}.`);
    tips.push(better.map((b) => `${b.name} ${picksOf(c, b.key)} of ${recK(c, b.key)}`).join("; ") + ".");
  } else parts.push(`No rival turns its recommendations into picks more often.`);
  // bf34: the picks' split by kind of question is gone (Tyler: it analyses the method, not the market).
  // The pooled open cell states the target's funnel; the subject's card its stage split; each better converter's card its rate.
  return withCells({ lead: "How the funnel breaks.", text: parts.join(" "), tip: tips.join(" ") }, cellsOf(c, OPEN_ALL, BRAND_CARD(S.key), ...better.map((b) => brandPin(c, b.key))));
}

/** bf29: "The conditions that decide it" in three short parts - who the AI sends to the subject, who it sends
 * away and to whom, and the buyers no message moves. The one counting rule holds (a themed side counts its themes
 * at answer grain over its own base; a raw side counts questions). */

/** A condition label as a matching key (case, quoting and punctuation ignored). */
const condKey = (t: string) => condLabel(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** bf34 / stage 5: "The conditions that decide it", read off the What to buy card's condition rows - each row's own
 * share stat (a share of all the card's answers), in the card's order; a rival reads its card there (the rows sending
 * buyers to it, and the card's rows for the tracker). Where a row sends buyers is the card's own first destination. */
function conditionsFromCard(c: Ctx): BriefPara[] | null {
  const toward = condRows(c, OPEN_ALL, "toward", c.isTarget ? undefined : c.name);
  const away = condRows(c, OPEN_ALL, "away", c.isTarget ? undefined : c.name);
  if (!toward.length && !away.length) return null;
  // The card's "choose you" side is the tracker's: a rival's own side is its card's away column.
  const toR = (c.isTarget ? toward : away).slice(0, 3);
  const awayR = (c.isTarget ? away : toward).slice(0, 3);
  const pp = c.map.positions[OPEN_ALL]?.panel;
  const part = c.isTarget ? undefined : c.reg.rivalPart(OPEN_ALL, c.name);
  const sels = (c.isTarget ? pp?.conditions : pp?.rivals?.find((r) => r.name === part)?.conditions)?.selections;
  for (const r of toR) nameOn(c, "condition", OPEN_ALL, r.text, c.isTarget ? sels?.toward : sels?.away);
  // A rival's own card inside the cell lists the cell's own "choose you" rows (no selection of its own).
  for (const r of awayR) nameOn(c, "condition", OPEN_ALL, r.text, c.isTarget ? sels?.away : sels?.toward ?? pp?.conditions?.selections?.toward);
  const q = (t: string) => `"${condLabel(t)}"`;
  const pin = cellsOf(c, OPEN_ALL, CONDITION_CARD);
  const out: BriefPara[] = [];
  if (toR.length)
    out.push(
      withCells(
        {
          lead: `Who it sends to ${c.name}.`,
          text: `When buyers ask what to buy, the AI says to choose ${c.name} for buyers who say ${listOf(toR.map((r) => q(r.text)))}. The most common${c.isTarget ? "" : ` for ${c.name}`}, ${q(toR[0].text)}, comes up in ${fig(c, toR[0].share)} of those answers.`,
          tip: toR.map((r) => `${r.text}: ${tipOfStat(r.share)} answers`).join("; "),
        },
        pin
      )
    );
  if (awayR.length) {
    const named = awayR.map((r) => (c.isTarget && r.to[0] ? `${q(r.text)} (to ${r.to[0].name})` : q(r.text)));
    out.push(
      withCells(
        {
          lead: "Who it sends away.",
          text: `It says to choose ${c.isTarget ? `another ${c.product}` : c.brand} for buyers who say ${listOf(named)}. The most common${c.isTarget ? "" : ` against ${c.name}`}, ${q(awayR[0].text)}, comes up in ${fig(c, awayR[0].share)} of those answers.`,
          tip: awayR.map((r) => `${r.text}: ${tipOfStat(r.share)} answers`).join("; "),
        },
        pin
      )
    );
  }
  return out;
}

function conditionsParas(c: Ctx): BriefPara[] {
  // Fact layer step 5, part 2: the What to buy card's own rows, or nothing (a rival with no card of its own inside the
  // What to buy cell has no condition rows to quote - the run-wide rollup that filled the gap counted outside the
  // fact layer and is gone).
  const out: BriefPara[] = conditionsFromCard(c) ?? [];
  if (c.isTarget) {
    const walls: string[] = [];
    // statids8: the fixed situations the cards name (each card's move box), in the Map's order.
    for (const id of Object.keys(c.stats)) {
      const w = cardWall(c, id);
      if (w && !walls.some((x) => norm(x) === norm(w))) walls.push(w);
    }
    if (walls.length)
      out.push(withCells({ lead: "Buyers no message moves.", text: `Buyers who say ${listOf(walls.slice(0, 3).map((w) => `"${condLabel(w)}"`))} are already where they are; no case for ${c.name} changes that.` }, cellsOf(c, OPEN_ALL)));
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
        // The finding is the Overview's statement in the Brief's voice: its numbers carry their fact ids.
        return { lead: leadOf(cap(stmt(c, v, "title"))), text: cap(stmt(c, v, "body")), tip: i.foot, key: i.key, cellIds: insightCells(c, i) };
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
  if (best && roomK(best.share) > 0)
    out.push({ key: "best_room", cellIds: [`chooses:open:${norm(best.r.room)}`], lead: "Its strongest situation.", text: `${c.name} does best with ${buyerPhrase(best.r.room)}: ${fRoom(c, best.r.room, c.subject.key)} of the picks there.`, tip: roomTip(best.r, best.share) });
  if (worst && worst.top)
    out.push({
      key: "worst_room",
      cellIds: [`chooses:open:${norm(worst.r.room)}`],
      lead: "Its weakest situation.",
      text: `Its weakest is ${buyerPhrase(worst.r.room)} - ${roomK(worst.share) === 0 ? "none" : fRoom(c, worst.r.room, c.subject.key)} of the picks there, with ${worst.top.name} taking ${fRoom(c, worst.r.room, worst.top.key)}.`,
      tip: `${roomTip(worst.r, worst.share)}; ${worst.top.name} ${kOf(worst.top.share)}.`,
    });
  // bf34: the arguments as the What to buy card shows them (the rival's card there: when it picks the rival / the tracker).
  const { bestC, worstC } = argsOnCard(c);
  if (bestC)
    out.push({ key: "lift", cellIds: [OPEN_ALL], lead: "The argument it wins on.", text: `${bestC.f.name} is argued in ${bestC.f.here} of the answers that pick ${c.name}, against ${bestC.f.there} when ${c.brand} is picked${seldomSaid(bestC.l)}.`, tip: argTip(bestC.l) });
  const vt = vsTargetOf(c);
  if (vt && vt.n >= MIN)
    out.push({
      key: "vs_target",
      cellIds: [rivalCell(c, c.subject.key)].filter((x): x is string => !!x),
      lead: `Against ${c.brand}.`,
      text:
        vt.k === 0
          ? `Compared directly with ${c.brand}, the AI never sides with ${c.name} when it takes a side.`
          : vt.k === vt.n
            ? `Compared directly with ${c.brand}, the AI sides with ${c.name} every time it takes a side.`
            : `Compared directly with ${c.brand}, the AI sides with ${c.name} ${vfig(c, vt)} of the time it takes a side.`,
      tip: vTip(vt),
    });
  if (worstC && (!bestC || worstC.l.code !== bestC.l.code))
    out.push({ key: "loss_arg", cellIds: [OPEN_ALL], lead: "The argument it loses on.", text: `${worstC.f.name} comes up in ${worstC.f.here} of the answers that pick ${c.brand} and ${worstC.f.there} of those that pick ${c.name}${seldomSaid(worstC.l)}.`, tip: argTip(worstC.l) });
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
  // Stage 2: every column figure is the What to buy card's own stat (the average competitor's bars and lines, the
  // most-picked competitor's bars and its row in "Who takes the picks"). Stage 3: a column is filled where its stat
  // exists, and the most-picked competitor is the listed one whose "Who takes the picks" row counts the most picks
  // (ties: the card's own order).
  const R = c.reg;
  const at = (st: Stat | undefined) => (st ? fig(c, st) : undefined);
  const order = pos.panel.competitorOrder ?? [];
  const comp = order.map((name) => ({ name, row: R.competitor(OPEN_ALL, name) })).filter((x): x is { name: string; row: Stat } => !!x.row);
  const out: { topName?: string; named: CompCol; rec: CompCol; share: CompCol; picked: CompCol } = {
    named: { avg: at(R.step(OPEN_ALL, "named", "usual")) },
    rec: { avg: at(R.step(OPEN_ALL, "recommended", "usual")) },
    share: {},
    picked: {},
  };
  // bf32: the card's own figures (panel avgShare / avgPicked), so the scoreboard and the card can never disagree.
  out.share.avg = at(R.line(OPEN_ALL, "share", "avg"));
  out.picked.avg = at(R.line(OPEN_ALL, "picked", "avg"));
  const top = [...comp].sort((a, b) => kOf(b.row) - kOf(a.row) || order.indexOf(a.name) - order.indexOf(b.name))[0];
  if (top) {
    out.topName = nameOn(c, "competitor", OPEN_ALL, top.name, pos.panel.competitorSelection);
    out.named.top = at(R.step(OPEN_ALL, "named", { rival: top.name }));
    out.rec.top = at(R.step(OPEN_ALL, "recommended", { rival: top.name }));
    out.share.top = fig(c, top.row);
    out.picked.top = at(R.rivalStep(top.name, "picked", "rival"));
  }
  return out;
}

/** bf35: the subject's picked-of-all-answers rate is quoted only where a card shows it (the tracker's What to buy
 * card does; a rival's card may not). */
// Stage 3: the tracker's is the What to buy card's line, a rival's the "picked, of all answers" row of its By rival
// card (am75) - quoted exactly where that stat exists.
const pickedHome = (c: Ctx) => !!fun(c, c.subject.key).picked;

function scoreboard(c: Ctx): BriefRow[] {
  const S = c.subject;
  const f = fun(c, S.key);
  // Each row pins the cell or card that states it (rowPin: the first candidate stating every number).
  const at = (row: BriefRow, ...ids: (string | null | undefined)[]): BriefRow => rowPin(c, row, ...ids);
  const own = subjectPins(c);
  const rows: BriefRow[] = [
    at({ label: "Named when buyers ask what to buy", value: fNamed(c, S), tip: tipOfFig(f.named) }, ...own),
    at({ label: "Recommended", value: fRec(c, S), tip: tipOfFig(f.rec) }, ...own),
    at({ label: `The AI commits to one ${c.product}`, value: fCommit(c), tip: tipOfStat(commitStat(c)) }, OPEN_ALL),
    at({ label: "Share of picks", value: fShare(c, S), tip: tipOfFig(f.share) }, ...own),
    at({ label: "Picked, of all answers", value: fPicked(c, S), tip: tipOfFig(f.picked) }, ...own),
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
  const leader = leaderOf(c);
  if (leader && !vs) rows.push(at({ label: `Share of picks - ${leader.name}`, value: fShare(c, leader), tip: tipOfFig(fun(c, leader.key).share) }, OPEN_ALL, brandPin(c, leader.key)));
  if (c.isTarget) {
    // Stage 4: the verdict cards' own figures (the pooled head-to-head, worries and Value cards).
    const won = statOr(c.reg.step(pooledOf(c, "fights:h2h:") ?? "", "won", "you"));
    if (won && won.n >= MIN) rows.push(at({ label: "Direct matchups won", value: vfig(c, won), tip: `${vTip(won)} matchups that pick one of the two` }, pooledOf(c, "fights:h2h:")));
    const go = statOr(verdictOf(c, buyersAll(c), "proceed"));
    if (go && go.n >= MIN) rows.push(at({ label: "Buyers with a worry told to go ahead", value: vfig(c, go), tip: vTip(go) }, buyersAll(c)));
    const stay = statOr(verdictOf(c, customersAll(c), "keep"));
    if (stay && stay.n >= MIN) rows.push(at({ label: "Customers with a worry told to stay", value: vfig(c, stay), tip: vTip(stay) }, customersAll(c)));
    const w = worthAll(c);
    if (w && w.yes.n >= MIN) rows.push(at({ label: "Judged worth the price", value: vfig(c, w.yes), tip: vTip(w.yes) }, valueCell(c)));
  } else {
    const vt = vsTargetOf(c);
    if (vt && vt.n >= MIN) rows.push(at({ label: `Direct matchups won against ${c.brand}`, value: vfig(c, vt), tip: vTip(vt) }, rivalCell(c, c.subject.key)));
  }
  return pickedHome(c) ? rows : rows.filter((r) => r.label !== "Picked, of all answers");
}

const leadOf = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** An Overview finding's field as Brief text: its numbers marked with the fact ids the statement carries. */
const stmt = (c: Ctx, i: Insight, field: "title" | "body") => fromStatement(c.figs, i[field], i.facts?.[field]);

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

/** bf35: harnesses read which Map claims lost clauses (set BRIEF_TRIM_LOG=1). */
export const TRIMMED_CLAIMS: { brand: string; cellId: string; claim: string; kept: string }[] = [];

/** A cut out of a composed string (plain text and figures), the figures after it moved back. */
function trCut(tr: Tr, from: number, to: number): Tr {
  const d = to - from;
  return { s: tr.s.slice(0, from) + tr.s.slice(to), m: tr.m.filter((x) => x.at + x.len <= from || x.at >= to).map((x) => (x.at >= to ? { ...x, at: x.at - d } : x)) };
}

/**
 * bf35 / fact layer step 5, part 2: a move quotes a Map claim only as far as its numbers are drawn on a card - each
 * number is its fact (the claim's own statement facts); a number whose fact no card draws loses its clause (from the
 * separator before it to the one after it). A claim whose headline (its first number) no card draws, or whose number
 * carries no fact, is dropped whole.
 */
function claimOnCards(c: Ctx, claim: string, cellId: string): string {
  let tr = decode(claim);
  const plainClaim = tr.s;
  const had = [...tr.s.matchAll(NUMBER_TOKEN)].length;
  const homed = (at: number) => {
    const f = tr.m.find((x) => at >= x.at && at < x.at + x.len);
    return !!f && c.drawn.has(c.figs.list[f.i].ref);
  };
  let dropped = false;
  for (let guard = 0; guard < 8; guard++) {
    const toks = [...tr.s.matchAll(NUMBER_TOKEN)];
    const bad = toks.find((m) => !homed(m.index!));
    if (!bad) break;
    if (bad === toks[0]) {
      dropped = true;
      break;
    }
    const text = tr.s;
    const start = bad.index!;
    const end = start + bad[0].length;
    const lefts = ["; ", ", ", " - ", " and "].map((x) => text.lastIndexOf(x, start)).filter((i) => i >= 0);
    const rights = [", ", "; ", " - ", ". "].map((x) => text.indexOf(x, end)).filter((i) => i >= 0);
    const L = lefts.length ? Math.max(...lefts) : -1;
    const Rt = rights.length ? Math.min(...rights) : text.replace(/[.]\s*$/, "").length;
    if (L < 0 || text.lastIndexOf(". ", start) > L) {
      dropped = true;
      break;
    }
    tr = trCut(tr, L, Rt);
  }
  const kept = dropped || (had && ![...tr.s.matchAll(NUMBER_TOKEN)].length) ? "" : encode(tr);
  if (strip(kept) !== plainClaim && process.env.BRIEF_TRIM_LOG) TRIMMED_CLAIMS.push({ brand: c.brand, cellId, claim: plainClaim, kept: strip(kept) });
  return kept;
}

function movePara(c: Ctx, g: MoveGroup): BriefPara {
  const m = g.first;
  const claims = g.moves
    .slice(0, 3)
    .map((x) => claimOnCards(c, sentence(x.claim), x.cellId))
    .filter(Boolean)
    .join(" ");
  // One place: its own move sentence. Several: the shared action once (a finding's sentence on one of them would
  // speak about that place only).
  // bf29: a move always carries an action - a single move without a lever sentence states its own act.
  const act = g.moves.length === 1 ? m.lever || sentence(cap(m.act)) : `${cap(m.actStem)} in each of these.`;
  return withCells({ lead: leadOf(g.lead), text: [claims, act, `Watch: ${m.watch}.`].filter(Boolean).join(" "), tip: g.moves.map((x) => x.tip).join(" ") }, cellsOf(c, ...g.moves.map((x) => x.cellId)));
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

/**
 * A rival one AI company carries (the engine_pick_concentration finding), in the Brief: the finding's own facts - the
 * AI company's share of the rival's picks (printed, and only when a card draws that fact) and its share of the
 * questions (read to decide, never printed). Null when the finding is not about a rival or its first fact is on no card.
 */
function concentrationOf(c: Ctx, conc: Insight): { share: string; ratio: number } | null {
  const v = c.voiced.get(conc.key) ?? conc;
  const nums = v.facts?.body ?? [];
  if (nums.length < 2) return null;
  const [a, b] = nums;
  if (!c.drawn.has(a[2])) return null;
  const x = evalRef(c.rf.book, a[2]).value;
  const y = evalRef(c.rf.book, b[2]).value;
  return { share: refFig(c.figs, a[2], v.body.slice(a[0], a[0] + a[1])), ratio: y > 0 ? x / y : Infinity };
}

/** The Value card's instead figures as one sentence: "It points the buyer to a rival instead in X% of answers and
 * to only <brand>'s own cheaper option in Y%." (never at zero) - the card's own stats (insteadOf, stage 4). */
function valueInsteadText(c: Ctx, vi: NonNullable<ReturnType<typeof insteadOf>>): string {
  const riv = vi.rival.k === 0 ? "never points the buyer to a rival instead" : `points the buyer to a rival instead in ${vfig(c, vi.rival)} of answers`;
  const own = vi.own ? (vi.own.k === 0 ? ` and never to only ${poss(c.brand)} own cheaper option` : ` and to only ${poss(c.brand)} own cheaper option in ${vfig(c, vi.own)}`) : "";
  return `The AI ${riv}${own}.`;
}

/** bf34 / stage 5: the strongest winning and losing arguments the What to buy card shows (the lift test on the card's
 * own counts), with the card's figures. */
function argsOnCard(c: Ctx) {
  const { best, worst } = liftPicks(argSides(c.reg, c.argCodes, c.isTarget, c.name, OPEN_ALL, c.map));
  for (const x of [best, worst]) if (x) nameOn(c, "argument", OPEN_ALL, x.name, x.sel, x.code);
  const bestC = best ? { l: best, f: argWords(c.figs, best, "subject") } : undefined;
  const worstC = worst ? { l: worst, f: argWords(c.figs, worst, "other") } : undefined;
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
  return { lead, text: stmt(c, v, "body"), tip: i.foot, kind: i.kind, effect: i.effect, cellId: ids[0], cellIds: ids, fact: `insight:${i.key}` };
}

/** The recommended-to-picked step (the funnel's break), in the scoreboard's share-of-picks words. */
function funnelBreak(c: Ctx): SwotItem | null {
  const S = c.subject;
  if (recK(c, S.key) < MIN) return null;
  const conv = convRate(c, S.key);
  const drop = recRate(c, S.key) - pickedRate(c, S.key);
  // A weakness only when some rival turns more of its recommendations into picks.
  const better = convertsBetter(c).length > 0;
  if (drop <= 0 || !better) return null;
  return {
    lead: "Recommendations that do not close",
    text: `${c.name} is recommended in ${fRec(c, S)} of answers and takes ${fShare(c, S)} of the picks; ${conv === 0 ? "none" : fConv(c, S)} of the answers that recommend it end with it as the pick.`,
    tip: `${picksOf(c, S.key)} picks of ${recK(c, S.key)} recommendations.`,
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
  const best = bestC?.l as ArgStat;
  const worst = worstC?.l;
  const bestWins = !!bestC;
  if (bestC)
    s.push({
      lead: "An argument that wins for it",
      text: `${bestC.f!.name} comes up more when ${c.name} wins - argued in ${bestC.f!.here} of the answers that pick ${c.name} and ${bestC.f!.there} of those that pick ${otherWho}${seldomSaid(best)}.`,
      tip: argTip(best),
      kind: "argument",
      effect: best.lift,
      cellId: argPin,
      fact: `arg:${best.code}`,
    });
  if (worstC && worst && (!bestWins || worst.code !== best.code))
    w.push({
      lead: c.isTarget ? "An argument that favors rivals" : `An argument that favors ${c.brand}`,
      text: `${worstC.f!.name} shows up when ${c.isTarget ? "another brand" : c.brand} is picked - argued in ${worstC.f!.here} of those answers and ${worstC.f!.there} of the answers that pick ${c.name}${seldomSaid(worst)}.`,
      tip: argTip(worst),
      kind: "argument",
      effect: -worst.lift,
      cellId: argPin,
      fact: `arg:${worst.code}`,
    });
  const fb = funnelBreak(c);
  if (fb) w.push(fb);
  // The winning argument as an opening, when the AI seldom tells buyers to look for it (a second fact about it).
  if (bestWins && checklistOf(c).length >= 5 && !checklistOf(c).some((x) => norm(x) === norm(best.code)))
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
      text: `For ${buyerPhrase(x.r.room)}, ${c.name} takes ${fRoom(c, x.r.room, c.subject.key)} of the picks - more than any other brand.`,
      tip: `${roomTip(x.r, x.mine)} picks.`,
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
      text: `For ${buyerPhrase(worstStand.r.room)}, ${worstStand.leader.name} takes ${fRoom(c, worstStand.r.room, worstStand.leader.key)} of the picks and ${c.name} ${roomK(worstStand.mine) === 0 ? "none" : fRoom(c, worstStand.r.room, c.subject.key)}.`,
      tip: `${roomTip(worstStand.r, worstStand.mine)} picks; ${worstStand.leader.name} ${kOf(worstStand.leader.share)}.`,
      kind: "room",
      effect: worstStand.gap,
      cellId: `chooses:open:${norm(worstStand.r.room)}`,
      fact: `room:${worstStand.r.room}`,
    });
  if (near)
    o.push({
      lead: "The nearest buying situation",
      text: `${cap(buyerPhrase(near.r.room))} is the buying situation where ${c.name} comes closest to the leader: ${roomK(near.mine) === 0 ? "none" : fRoom(c, near.r.room, c.subject.key)} of the picks there against ${fRoom(c, near.r.room, near.leader!.key)} for ${near.leader!.name}.`,
      tip: `${roomTip(near.r, near.mine)} picks; ${near.leader!.name} ${kOf(near.leader!.share)}.`,
      kind: "room",
      effect: 0.5 - near.gap,
      cellId: `chooses:open:${norm(near.r.room)}`,
      fact: `room:${near.r.room}`,
    });

  if (c.isTarget) {
    // Matchups: won (strength), lost (weakness), lost with a case still stated (opening) - each the matchup card's
    // own "who it picks" bar (stage 4), the rivals in the order of the cards' answers.
    for (const r of h2hOrder(c)) {
      const wd = matchupWon(c, r.key);
      if (!wd || wd.n < MIN) continue;
      const id = rivalCell(c, r.key);
      // statids8: the rival as its matchup card is titled.
      const rn = cardLabel(c, id, r.rival);
      const range = vRange(wd);
      if (range.low > 0.5)
        s.push({
          lead: "A matchup it wins",
          text: `Asked to compare ${c.brand} with ${rn} directly, the AI picks ${c.brand} ${wd.k === wd.n ? "every time it picks one of them" : `${vfig(c, wd)} of the time it picks one of them`}.`,
          tip: `Won ${wd.k}, lost ${wd.n - wd.k}.`,
          kind: "rival",
          row: "h2h",
          effect: vRate(wd) - 0.5,
          cellId: id,
          fact: `h2h:${r.key}`,
        });
      else if (range.high < 0.5) {
        // Stage 5: the case left is the matchup card's own "Who it still sends to you" rows (its exception step).
        const exRows = id ? c.reg.section(id, "exception", "Who it still sends to you") : [];
        if (exRows.length)
          o.push({
            lead: "A lost matchup with a case left",
            text: `${rn} wins the direct comparison with ${c.brand}, yet ${mostOfLost(id ? c.reg.segment(id, "exception", "still") : undefined)} of the answers that pick ${rn} still say when to choose ${c.brand} - most often "${condLabel(exRows[0].label)}".`,
            tip: exRows.map((x) => `${x.label}: ${tipOfStat(x.stat)}`).join("; "),
            kind: "rival",
            row: "h2h",
            effect: 0.5 - vRate(wd),
            cellId: id,
            fact: `h2h:${r.key}`,
          });
        else
          w.push({
            lead: "A matchup it loses",
            text: `Asked to compare ${c.brand} with ${rn} directly, the AI ${wd.k === 0 ? `never picks ${c.brand} when it picks one of the two` : `picks ${c.brand} ${vfig(c, wd)} of the time it picks one of them`}.`,
            tip: `Won ${wd.k}, lost ${wd.n - wd.k}.`,
            kind: "rival",
            row: "h2h",
            effect: 0.5 - vRate(wd),
            cellId: id,
            fact: `h2h:${r.key}`,
          });
      }
    }
    // Value: the overall verdict (weakness), a buyer it is judged worth it for (strength, the worth-it side only),
    // the doubts that name a rival (threat).
    const v = c.verdicts.value;
    const wa = worthAll(c);
    if (v && wa && wa.yes.n >= MIN) {
      // statids8: the product the pooled Value card asked about (its "Asked about"), else the brand.
      const what = valueProduct(c, valueCell(c));
      if (vRate(wa.no) >= vRate(wa.yes) && wa.no.k > 0)
        w.push({
          lead: "The price verdict",
          text: wa.yes.k === 0 ? `${cap(what)} is judged not worth it over a cheaper option in ${vfig(c, wa.no)} of answers and never worth it.` : `${cap(what)} is judged not worth it over a cheaper option in ${vfig(c, wa.no)} of answers and worth it in ${vfig(c, wa.yes)}.`,
          tip: `No ${vTip(wa.no)}; yes ${vTip(wa.yes)}.`,
          kind: "value",
          effect: vRate(wa.no) - vRate(wa.yes),
          cellId: valueCell(c),
          fact: "value",
        });
      const good = valueRoomsOrder(c)
        .filter((x): x is { r: (typeof x)["r"]; w: Worth3 } => !!x.w && x.w.yes.n >= MIN && vRate(x.w.yes) > vRate(x.w.no) && vRate(x.w.yes) >= 0.25)
        .sort((a, b) => vRate(b.w.yes) - vRate(a.w.yes))[0];
      if (good)
        s.push({
          lead: "A buyer it is worth it for",
          text: `For ${buyerPhrase(good.r.rooms[0])}, the AI calls ${valueProduct(c, valueCell(c, good.r.key))} worth paying more for in ${good.w.yes.k === good.w.yes.n ? "every answer" : `${vfig(c, good.w.yes)} of answers`}.`,
          tip: vTip(good.w.yes),
          kind: "value",
          effect: vRate(good.w.yes) - vRate(good.w.no),
          cellId: `chooses:value:${norm(good.r.rooms[0])}`,
          fact: `value-room:${good.r.rooms[0]}`,
        });
      // bf34: the Value card's own figure (a share of all its answers), not a share of the doubts; the rival named is
      // the one its explanation lists first (stage 4).
      const vi = insteadOf(c, valueCell(c));
      const rival = insteadLeader(c, valueCell(c));
      if (vi && vRate(vi.rival) >= 0.2 && rival)
        t.push({
          lead: "Price answers that name a rival",
          text: `Asked whether ${c.brand} is worth paying more for, the AI points the buyer to a rival instead in ${vfig(c, vi.rival)} of answers. The rival it names most often is ${rival}.`,
          tip: `${vTip(vi.rival)} answers`,
          kind: "value",
          effect: vRate(vi.rival),
          cellId: valueCell(c),
          fact: "value-instead",
        });
    }
    // Switchers: rivals' customers it takes (strength), switchers who hear its name but pick elsewhere (opening).
    // Stage 4: each rival's customers card - picked, of all answers, and named.
    for (const r of leaversOrder(c)) {
      if (r.key === "generic") continue;
      const id = leaverCell(c, r.key);
      // statids8: the rival as its customers' card is titled.
      const rn = cardLabel(c, id, r.rival);
      const lv = leaverFigs(c, r.key);
      if (!lv || lv.picked.n < MIN) continue;
      const { picked, named } = lv;
      if (vRate(picked) >= 0.3)
        s.push({
          lead: "Rivals' customers it takes",
          text: `When ${poss(rn)} customers ask what to switch to, the AI picks ${c.brand} in ${vfig(c, picked)} of answers.`,
          tip: vTip(picked),
          kind: "leavers",
          effect: vRate(picked),
          cellId: id,
          fact: `leavers:${r.key}`,
        });
      else if (vRate(named) >= 0.5 && vRate(picked) < 0.1)
        o.push({
          lead: "Switchers who hear its name",
          text: `${poss(rn)} customers looking to switch hear ${c.brand} named in ${named.k === named.n ? "every answer" : `${vfig(c, named)} of answers`}, yet it is the pick in ${picked.k === 0 ? "none of them" : vfig(c, picked)}.`,
          tip: `${vTip(named)} named; ${vTip(picked)} picked.`,
          kind: "leavers",
          effect: vRate(named) - vRate(picked),
          cellId: id,
          fact: `leavers:${r.key}`,
        });
    }
    // Threats: the leading rival.
    const leader = leaderOf(c);
    if (leader && commitK(c) >= MIN && shareRate(c, leader.key) > shareRate(c, S.key))
      t.push({
        lead: "The leading rival",
        text: `${leader.name} takes ${fShare(c, leader)} of the picks when buyers ask what to buy, against ${fShare(c, S)} for ${c.brand}.`,
        tip: `${picksOf(c, leader.key)} picks to ${picksOf(c, S.key)}.`,
        kind: "rival",
        effect: shareRate(c, leader.key) - shareRate(c, S.key),
        cellId: OPEN_ALL,
        cellIds: [OPEN_ALL, BRAND_CARD(leader.key)],
        fact: "leader",
      });
    // Fixed situations on the pick-shaped cells (a Value or worry cell's sides are not picks), one per wording.
    // statids8: the fixed situation is the one the cell's card names (its move box), and who takes the picks there is
    // the card's own "Who takes the picks" first row (What to buy, rivals' customers switching) or a named matchup's
    // rival (its card's bar) - with that row's share. The popular and premium cards and the pooled matchup card show no
    // one taker with a share of the picks, so a fixed situation there is not written.
    const wallSeen = new Set<string>();
    for (const [cellId, st] of Object.entries(c.stats)) {
      if (!["open", "leavers", "h2h"].includes(st.row) || (st.row === "h2h" && st.pooled)) continue;
      const wall = cardWall(c, cellId);
      if (!wall || wallSeen.has(norm(wall))) continue;
      const pickRows = st.row === "open" || st.row === "leavers";
      const tk = pickRows ? cardTaker(c, cellId) : undefined;
      const ts = pickRows ? tk?.stat : c.reg.step(cellId, "won", "vs");
      const ys = pickRows ? c.reg.competitor(cellId, "you") : c.reg.step(cellId, "won", "you");
      if (!ts) continue;
      const taker = pickRows ? tk!.name : cardLabel(c, cellId, st.taker);
      const k = kOf(ts);
      const n = nOf(ts);
      if (n < MIN) continue;
      wallSeen.add(norm(wall));
      t.push({
        lead: "A fixed situation",
        text: `${st.row === "h2h" ? `Against ${taker}` : st.label && !st.pooled ? `For ${buyerPhrase(st.label)}` : "Across every buying situation"}, buyers who say "${condLabel(wall)}" are sent elsewhere while ${taker} ${k === n ? "takes every pick there" : `takes ${fig(c, ts)} of the picks there`}.`,
        tip: `${k} of ${n} answers that take a side go to ${taker}.`,
        kind: "wall",
        effect: rateOf(ts) - (ys ? rateOf(ys) : 0),
        cellId,
        fact: `wall:${norm(wall)}`,
      });
    }
    // A rival carried by one AI company: a threat wherever buyers use that company's assistants.
    const conc = c.ranked.find((i) => i.key === "engine_pick_concentration" && i.names?.rival && i.names?.vendor && i.names.rival !== c.brand);
    if (conc) {
      // bf35 / step 5 part 2: cited only when a card draws the rival's share of its picks from that AI company (the
      // finding's first fact); the share of the questions those assistants answer is on no card, so it is never quoted.
      const cx = concentrationOf(c, conc);
      if (cx) {
        const ids = insightCells(c, conc);
        t.push({
          lead: "A rival one AI company carries",
          text: `${conc.names!.vendor}'s assistants pick ${conc.names!.rival} far more often than the others do - they supply ${cx.share} of its picks - so ${conc.names!.rival} is picked more wherever buyers use them.`,
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
    const hold = holdFigs(c);
    if (hold && hold.leave.n >= MIN && vRate(hold.leave) >= HOLD_LEAVE_BAR)
      t.push({
        lead: "Its own customers told to leave",
        text: `When ${poss(c.brand)} own customers ask what else to consider, the AI tells them to leave in ${vfig(c, hold.leave)} of answers.`,
        tip: vTip(hold.leave),
        kind: "hold",
        effect: vRate(hold.leave),
        cellId: holdAll(c),
        fact: "hold",
      });
    // The ranked detectors, by kind: what sends buyers away and the others that could take more (threats);
    // a worry the AI agrees with (weakness).
    const used = new Set(c.findings.map((f) => f.key));
    // What sends buyers away, in this frame's own sentence (the finding's sentence may be quoted elsewhere).
    // statids8: the condition is the What to buy card's own first "choose another" row (the card's order: the most
    // common), and where it sends buyers is that row's own "To ..." rows - the card's words, never the run's rollup.
    // bf47: a condition the SWOT already lists as a fixed situation is not repeated here (Pixel said "already use
    // Apple" twice) - the same situation when one wording's words are all in the other's.
    const wordsOf = (t: string) => new Set(norm(t).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const sameSituation = (a: string, b: string) => {
      const x = wordsOf(a), y = wordsOf(b);
      const [small, big] = x.size <= y.size ? [x, y] : [y, x];
      return small.size > 0 && [...small].every((w) => big.has(w));
    };
    const awayRow = condRows(c, OPEN_ALL, "away").find((r) => !isDefaultCondition(r.text) && ![...wallSeen].some((w) => sameSituation(w, r.text)));
    const awayIns = c.ranked.find((i) => i.key === "away_condition");
    if (awayRow && awayIns) {
      const d = cardDest(c, OPEN_ALL, awayRow);
      t.push({
        lead: "What sends buyers away",
        // bf47: the card read is the What to buy card - say so (the sentence had covered every question type).
        text: `When buyers ask what to buy, the AI most often sends them away from ${c.brand} when they say "${condLabel(nameOn(c, "away-row", OPEN_ALL, awayRow.text, c.map.positions[OPEN_ALL]?.panel?.conditions?.selections?.away))}"${d ? `, ${d}` : ""}.`,
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
    const v = vsTargetOf(c);
    if (v && v.n >= MIN) {
      const range = vRange(v);
      const item: SwotItem = {
        lead: range.low > 0.5 ? "It wins against the tracker" : `${c.brand} wins between the two`,
        text: `Asked to compare ${c.name} with ${c.brand} directly, the AI picks ${c.name} ${v.k === 0 ? "none of the time" : v.k === v.n ? "every time it picks one of them" : `${vfig(c, v)} of the time it picks one of them`}.`,
        tip: vTip(v),
        kind: "rival",
        effect: Math.abs(vRate(v) - 0.5),
        cellId: rivalCell(c, S.key),
        fact: "vs-target",
      };
      if (range.low > 0.5) s.push({ ...item, lead: `A matchup it wins` });
      else if (range.high < 0.5) t.push({ ...item, lead: `${poss(c.brand)} edge` });
    }
    const leader = leaderOf(c);
    if (leader && shareRate(c, leader.key) > shareRate(c, S.key))
      t.push({
        lead: "The leading brand",
        text: `${leader.name} takes ${fShare(c, leader)} of the picks when buyers ask what to buy, against ${fShare(c, S)} for ${c.name}.`,
        tip: `${picksOf(c, leader.key)} picks to ${picksOf(c, S.key)}.`,
        kind: "rival",
        effect: shareRate(c, leader.key) - shareRate(c, S.key),
        cellId: OPEN_ALL,
        cellIds: [OPEN_ALL, brandPin(c, leader.key), BRAND_CARD(S.key)],
        fact: "leader",
      });
    // Its weakest buying situation against the leader there.
    const weak = stands.filter((y) => !y.owns && y.leader).slice(-1)[0];
    if (weak && weak !== near)
      w.push({
        lead: "Its weakest buying situation",
        text: `For ${buyerPhrase(weak.r.room)}, ${c.name} takes ${roomK(weak.mine) === 0 ? "none" : `only ${fRoom(c, weak.r.room, c.subject.key)}`} of the picks - ${weak.leader!.name} takes ${fRoom(c, weak.r.room, weak.leader!.key)}.`,
        tip: `${roomTip(weak.r, weak.mine)} picks.`,
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
      paras: [withCells({ text: `Where ${c.name} stands on this wave: named in ${fNamed(c, c.subject)} of answers, and ${fShare(c, c.subject)} of the picks when the AI commits to one ${c.product}.`, tip: `${tipOfFig(fun(c, c.subject.key).named)}; ${tipOfFig(fun(c, c.subject.key).share)}.` }, cellsOf(c, ...subjectPins(c)))],
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
  const f = fun(c, S.key);
  const named = namedRate(c, S.key);
  const rec = recRate(c, S.key);
  const picked = pickedRate(c, S.key);
  const d1 = named - rec;
  const d2 = rec - picked;
  // One word for the middle stage everywhere: "Recommended" (the scoreboard's
  // and the views' term) - a second name reads as a second metric.
  const L = { named: "In the conversation", rec: "Recommended", pick: `The ${c.product} to get`, kept: "Customers with a worry told to stay" };
  // Share of picks is the lead pick number everywhere; the all-answers rate exists only inside
  // this ladder (the stages must share a denominator) and never without the bridge beside it.
  const ofPicks = commitK(c) >= MIN ? `${fShare(c, S)} of picks` : "";
  // bf35: a rival whose picked-of-all-answers rate is on no card reads its share of the picks alone.
  const home = pickedHome(c) || !ofPicks;
  const pickV = fPicked(c, S);
  const pickValue = home ? (ofPicks ? `${pickV} (${ofPicks})` : pickV) : ofPicks;
  const stagesText = `named in ${fNamed(c, S)}, recommended in ${fRec(c, S)}, ${home ? `picked in ${pickV} of answers${ofPicks ? ` (${ofPicks})` : ""}` : `with ${ofPicks}`}`;
  const oneStage = d1 > 0 && d2 > 0 && Math.max(d1, d2) >= 2 * Math.min(d1, d2);
  let thesis: string;
  if (oneStage)
    thesis = d1 > d2 ? `${c.name} loses exactly one stage - between named and recommended: ${stagesText}.` : `${c.name} loses exactly one stage - between recommended and picked: ${stagesText}.`;
  else if (d1 > 0 && d2 > 0) thesis = `${c.name} loses ground at both steps: ${stagesText}.`;
  else thesis = `${c.name} holds its ground through the funnel: ${stagesText}.`;

  // The recommended stage's conversion (the library funnel's stage-3 line):
  // how many recommendations end as the pick, against the rival that converts best.
  const better = convertsBetter(c)[0];
  const recToPick =
    recK(c, S.key) >= MIN
      ? ` Only ${fConv(c, S)} of its recommendations end as the pick${better ? `; ${better.name} turns ${fConv(c, better)} of its own into picks` : ""}.`
      : "";
  // The named, recommended and pick stages read the pooled open-choice cell; the kept stage the pooled customers' worries.
  // A rival subject's stages read its By rival card (each number links by its fact id).
  const own = subjectPins(c);
  const openCells = cellsOf(c, ...own);
  const keptA = anchor(c, pooledOf(c, "doubts:customers:"));
  const rowAt = (row: BriefRow, a: Anchor | undefined): BriefRow => (a ? { ...row, cell: a } : row);
  const rows: BriefRow[] = [
    rowPin(c, { label: L.named, value: fNamed(c, S), tip: tipOfFig(f.named) }, ...own),
    rowPin(c, { label: L.rec, value: fRec(c, S), tip: tipOfFig(f.rec) }, ...own),
    rowPin(c, { label: L.pick, value: pickValue, tip: tipOfFig(f.picked) }, ...own),
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
    withCells({ lead: `${L.named}.`, text: `When buyers ask what to buy, the AI names ${c.name} in ${fNamed(c, S)} of answers.`, tip: tipOfFig(f.named) }, openCells),
    {
      lead: `${L.rec}.`,
      // bf34: no card states recommended as a share of the answers that name it - the first figure only.
      text: `It recommends ${c.name} in ${fRec(c, S)} of answers.`,
      tip: `${recK(c, S.key)} recommending of ${namedK(c, S.key)} naming.`,
      ...(openCells ? { cells: openCells } : {}),
    },
    {
      lead: `${L.pick}.`,
      text:
        (commitK(c) >= MIN
          ? `The AI commits to one ${c.product} in only ${fCommit(c)} of answers; ${c.name} is the pick ${fShare(c, S)} of the time it does${home ? `, which leaves it the pick in ${pickV} of every answer` : ""}.`
          : `${c.name} is the pick in ${pickV} of all answers.`) + recToPick,
      tip: `${tipOfFig(f.picked)} answers; ${picksOf(c, S.key)} of ${commitK(c)} in-category picks; ${picksOf(c, S.key)} picks of ${recK(c, S.key)} recommendations.`,
      ...((): { cells?: Anchor[] } => {
        const cs = cellsOf(c, ...own, better ? brandPin(c, better.key) : null);
        return cs ? { cells: cs } : {};
      })(),
    },
  ];
  // The hourglass: one band per stage, the stage where the funnel breaks accented.
  const accent = d1 > d2 ? "rec" : "pick";
  const items: BriefVizItem[] = [
    { label: L.named, a: named * 100, value: fNamed(c, S) },
    { label: L.rec, a: rec * 100, value: fRec(c, S), ...(accent === "rec" ? { accent: true } : {}) },
    { label: L.pick, a: picked * 100, value: pickValue, ...(accent === "pick" ? { accent: true } : {}) },
  ];
  if (c.isTarget) {
    // Stage 4: the pooled customers' worries card - its stay / leave / no side bar.
    const k = customersVerdict(c);
    if (k && k.keep.n >= MIN) {
      rows.push(rowAt({ label: L.kept, value: vfig(c, k.keep), tip: vTip(k.keep) }, keptA));
      // The chart's label column is 214 viewBox px at 13.5px: the stage's full name does not fit, so the band reads short.
      items.push({ label: "With a worry, told to stay", a: vRate(k.keep) * 100, value: vfig(c, k.keep) });
      paras.push({
        lead: `${L.kept}.`,
        text: `When ${poss(c.name)} customers raise a worry, the AI tells them to stay in ${vfig(c, k.keep)} of answers and to leave in ${vfig(c, k.leave)}; the other ${vfig(c, k.none)} take no side either way.`,
        tip: `Stay ${vTip(k.keep)}; leave ${vTip(k.leave)}.`,
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
    { key: "thesis", paras: [withCells({ text: thesis, tip: `Named ${tipOfFig(f.named)}; recommended ${tipOfFig(f.rec)}; picked ${tipOfFig(f.picked)}.` }, openCells)] },
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
/** bf35: the scatter collision audit's findings, one entry per chart placed (SCATTER_AUDIT=1). */
export const SCATTER_AUDIT: { labels: string[]; issues: string[] }[] = [];
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
  // bf35: the collision audit (SCATTER_AUDIT=1): every overlap left between labels, dots, the two lines and their
  // labels, the axis and the folded note, in square viewBox pixels.
  if (process.env.SCATTER_AUDIT) {
    const issues: string[] = [];
    const ov = (x: Box, y: Box) => overlap(x, y);
    const noteBoxes = notePx && noteLines ? noteLines.map((l, i) => boxOf(notePx!.x, notePx!.y + i * 14, l, FS_REF)) : notePx && note ? [boxOf(notePx.x, notePx.y, note, FS_REF)] : [];
    order.forEach((p, i) => {
      const b = placed[i];
      placed.forEach((o, j) => j > i && ov(b, o) > 0.5 && issues.push(`label "${p.label}" x label "${order[j].label}" ${Math.round(ov(b, o))}`));
      dotBoxes.forEach((o, j) => pts[j].label !== p.label && ov(b, o) > 0.5 && issues.push(`label "${p.label}" x dot "${pts[j].label}" ${Math.round(ov(b, o))}`));
      for (const [n, o] of [["upright line", vStrip], ["level line", hStrip], ["axis", axis], ["upright line label", vLabel]] as [string, Box][]) if (ov(b, o) > 0.5) issues.push(`label "${p.label}" x ${n} ${Math.round(ov(b, o))}`);
      noteBoxes.forEach((o) => ov(b, o) > 0.5 && issues.push(`label "${p.label}" x the note ${Math.round(ov(b, o))}`));
    });
    noteBoxes.forEach((nb) => {
      dotBoxes.forEach((o, j) => ov(nb, o) > 0.5 && issues.push(`the note x dot "${pts[j].label}"`));
      for (const [n, o] of [["upright line", vStrip], ["level line", hStrip], ["upright line label", vLabel]] as [string, Box][]) if (ov(nb, o) > 0.5) issues.push(`the note x ${n}`);
    });
    SCATTER_AUDIT.push({ labels: pts.map((p) => p.label), issues });
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

/**
 * Ruling 11: "converts" has ONE rule - the visibility view's. The brands on the chart are the visibility selection
 * (selections.ts visibility_brands: named in 10%+ of answers or 1%+ of the picks, class brands out, the subject and the
 * tracker always; placed when recommended in 20+ answers and not small, the rest folded); the level line pools the
 * placed brands' own conversion facts (a derived fact: their picks over their recommendations); a brand converts when
 * it is recommended in 20+ answers and its recommendations end as the pick at or above the line. The diagnosis reads
 * the same object.
 */
interface Visibility {
  sel: AnySelection;
  placed: Brand[];
  folded: Brand[];
  /** The level line: its ref (pool of the placed brands' conversion facts) and value. */
  lineRef: string;
  line: number;
  readable: (b: Brand) => boolean;
  converting: (b: Brand) => boolean;
  visible: (b: Brand) => boolean;
}
function visibilityOf(c: Ctx): Visibility {
  const sel = c.rf.sel.selection("visibility_brands", c.isTarget ? "you" : c.subject.key, WHAT_TO_BUY_ALL);
  const brandOf = (key: string): Brand => c.summary.brands.find((b) => b.key === key) ?? (key === c.target.key ? c.target : { key, name: (sel.members as SelMember[]).find((m) => m.key === key)?.name ?? key, role: "rival" as Brand["role"] });
  const placed = (sel.members as SelMember[]).map((m) => brandOf(m.key));
  const folded = (sel.extras.folded ?? []).map((m) => brandOf(m.key));
  for (const b of placed) nameOn(c, "visibility", "", b.name, sel.id, b.key);
  for (const b of folded) nameOn(c, "visibility-folded", "", b.name, sel.id, b.key);
  const refs = placed.map((b) => need(fun(c, b.key).conv, `${b.name} conversion`).fact!);
  const lineRef = dref("pool", refs);
  const line = refs.length ? evalRef(c.rf.book, lineRef).value : 0;
  const readable = (b: Brand) => recK(c, b.key) >= MIN;
  return { sel, placed, folded, lineRef, line, readable, converting: (b) => readable(b) && convRate(c, b.key) >= line, visible: (b) => namedRate(c, b.key) > 0.5 };
}

function matrixFrame(c: Ctx): BriefSection[] {
  const classes = classCells(c);
  const V = visibilityOf(c);
  const readable = V.readable;
  const conv = (b: Brand) => convRate(c, b.key);
  const placedSet = V.placed;
  const folded = V.folded;
  const line = V.line;
  const visible = V.visible;
  const converting = V.converting;
  const quad = (b: Brand): Quadrant => (visible(b) && converting(b) ? "The Closers" : visible(b) ? "The Showroom" : converting(b) ? "The Quiet Closer" : "The Background");
  const byNamed = (xs: Brand[]) => [...xs];
  const sorted = byNamed(placedSet);
  const S = c.subject;
  const subjReadable = readable(S) && !classes.has(S.key);
  const rows = sorted.map((b) => [b.name, fNamed(c, b), fConv(c, b), fShare(c, b), quad(b)]);
  const foldNames = byNamed(folded).map((b) => b.name);
  if (foldNames.length)
    rows.push([`${foldNames.length === 1 ? "One more brand" : `${foldNames.length} more brands`}, rarely named or picked: ${listOf(foldNames)}`, "", "", "", ""]);
  const hi = sorted.findIndex((b) => b.key === S.key);

  // The scatter.
  const pts = sorted.map((b) => ({ label: b.name, x: namedRate(c, b.key) * 100, y: conv(b) * 100, accent: b.key === S.key }));
  const yMax = Math.min(100, Math.max(20, Math.ceil((Math.max(...pts.map((p) => p.y), line * 100) + 4) / 10) * 10));
  // A threshold, not a fact: said in words (fact layer step 5, part 2 - every printed number is a fact).
  const VL = "visible: named in over half";
  // The level line pools the charted brands' conversion facts (a derived fact): the chart's own reference line, on no
  // card by design (Tyler, 2026-11-17).
  const HL = `all these brands together: ${refFig(c.figs, V.lineRef, evalRef(c.rf.book, V.lineRef).text)}`;
  const note = foldNames.length ? `Rarely named or picked, not placed: ${listOf(foldNames)}` : null;
  const plan = placeScatter(pts, 100, yMax, 50, VL, line * 100, HL, note);
  const vis = sorted.filter(visible);
  const headline = () => `${fConv(c, S)} of recommendations become picks, named in ${fNamed(c, S)}`;
  let title: string;
  if (!subjReadable) title = `${c.name} is recommended too rarely to read how often it converts - named in ${fNamed(c, S)}`;
  else if (visible(S)) {
    const rn = vis.findIndex((b) => b.key === S.key) + 1;
    const byConv = [...vis].sort((a, b) => conv(b) - conv(a));
    const rc = byConv.findIndex((b) => b.key === S.key) + 1;
    if (vis.length >= 2 && rc === vis.length) title = rn === 1 ? `The most visible brand converts least - ${headline()}` : `${c.name} converts least of the visible brands - ${headline()}`;
    else if (vis.length >= 2) title = `${c.name} is named ${ordinal(rn)}most and converts ${ordinal(rc)}best of the visible brands - ${headline()}`;
    else title = `${c.name} is the only visible brand${converting(S) ? " and converts above the line" : " and converts below the line"} - ${headline()}`;
  } else title = converting(S) ? `${c.name} converts but is not visible - ${headline()}` : `${c.name} is neither visible nor converting - ${headline()}`;
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
          text: `The AI names it in ${fNamed(c, S)} of answers, and ${fConv(c, S)} of the answers that recommend it end with it as the pick - ${conv(S) >= line ? "at or above" : "below"} the rate for all these brands together.`,
        },
        subjPins
      )
    );
  // bf35: the outliers' two figures are their own cards' stats (By rival "What to buy"), so every outlier links.
  const showText = (b: Brand) => `${b.name} is ${quad(S) === "The Showroom" ? "also in the Showroom" : "the most visible brand in the Showroom"} - named in ${fNamed(c, b)} of answers, with ${fConv(c, b)} of its recommendations ending as the pick.`;
  const quietText = (b: Brand) => `${b.name} is ${quad(S) === "The Quiet Closer" ? "another" : "the strongest"} Quiet Closer - named in ${fNamed(c, b)} of answers, yet ${fConv(c, b)} of its recommendations end as the pick.`;
  const showroom = sorted.find((b) => b.key !== S.key && quad(b) === "The Showroom");
  const quiet = [...sorted].filter((b) => b.key !== S.key && quad(b) === "The Quiet Closer").sort((a, b) => conv(b) - conv(a))[0];
  const outl: string[] = [];
  if (showroom) outl.push(showText(showroom));
  if (quiet) outl.push(quietText(quiet));
  if (outl.length) paras.push(withCells({ text: outl.join(" ") }, cellsOf(c, showroom ? brandPin(c, showroom.key) : null, quiet ? brandPin(c, quiet.key) : null)));
  // The so-what.
  const closers = sorted.filter((b) => b.key !== S.key && quad(b) === "The Closers").slice(0, 3);
  if (c.isTarget && subjReadable) {
    const where =
      quad(S) === "The Closers"
        ? closers.length
          ? `${c.name} already sits where it wants to be, beside ${listOf(closers.map((b) => `${b.name} (${fConv(c, b)})`))}.`
          : `${c.name} is the only brand that is both visible and converting.`
        : closers.length
          ? `Where ${c.name} wants to be, ${listOf(closers.map((b, i) => `${b.name} (${fConv(c, b)}${i === 0 ? " of its recommendations ending as the pick" : ""})`))} ${closers.length > 1 ? "already sit" : "already sits"}, against ${fConv(c, S)} for ${c.name}.`
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
          // bf35: the subject's own two figures only when a card shows them.
          text: `${c.brand} is ${QUAD_PHRASE[quad(T)]}, named in ${fNamed(c, T)} of answers with ${fConv(c, T)} of its recommendations ending as the pick; ${c.name} is ${quad(S) === quad(T) ? "in the same place" : QUAD_PHRASE[quad(S)]}, at ${fNamed(c, S)} and ${fConv(c, S)}.`,
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
  /** The subject's share of the picks there (absent: no card lists it there - no picks to read). */
  mine?: Stat;
  leader?: RoomBrand;
  owns: boolean;
  /** The leader's share minus the subject's (negative where the subject leads by that much). */
  gap: number;
}

/** bf29: every buying situation with enough picks to read, in ONE order for the chart and the paragraphs -
 * the situations the subject leads first (largest lead first), then by how close it is to the leader
 * (smallest gap first), ties by the setup order. Stage 3: every figure read from the situation's card stats. */
function roomStands(c: Ctx): RoomStand[] {
  const out: RoomStand[] = [];
  c.rooms.forEach((r, seq) => {
    if (roomAnswers(r) === 0 || roomFirm(r) < MIN) return;
    const mine = roomBrand(r, c.subject.key)?.share;
    const leader = r.leader;
    const owns = roomK(mine) > 0 && (!leader || roomK(mine) >= kOf(leader.share));
    out.push({ r, seq, ...(mine ? { mine } : {}), leader, owns, gap: (leader ? rateOf(leader.share) : 0) - roomRate(mine) });
  });
  return out.sort((a, b) => Number(b.owns) - Number(a.owns) || a.gap - b.gap || a.seq - b.seq);
}

/** bf29 (one bar for the Now what verdict, the SWOT opening and the By buying situation close): a buying
 * situation is near when the subject leads it, or trails with at least half the leader's share of the picks. */
const NEAR_RATIO = 0.5;
function nearStand(x: RoomStand): boolean {
  return x.owns || (!!x.leader && roomRate(x.mine) > 0 && roomRate(x.mine) >= rateOf(x.leader.share) * NEAR_RATIO);
}

/** bf29: the three Value sides in one clause - worth it, not worth it, and "it depends" as the rest; a zero side
 * collapses to "never", a whole side to "every answer". */
function worthWords(c: Ctx, w: Worth3): string {
  const rest = w.depends.k > 0;
  if (w.yes.k > 0 && w.yes.k === w.yes.n) return "says it is worth it in every answer";
  if (w.no.k > 0 && w.no.k === w.no.n) return "says it is not worth it in every answer";
  if (w.yes.k === 0 && w.no.k === 0) return "never says it is worth it or not - every answer says it depends";
  if (w.yes.k === 0) return `never says it is worth it - it says it is not worth it in ${vfig(c, w.no)}${rest ? ` and that it depends in ${vfig(c, w.depends)}` : ""}`;
  if (w.no.k === 0) return `says it is worth it in ${vfig(c, w.yes)} and never that it is not${rest ? `, and that it depends in ${vfig(c, w.depends)}` : ""}`;
  return `says it is worth it in ${vfig(c, w.yes)}, not worth it in ${vfig(c, w.no)}${rest ? `, and that it depends in ${vfig(c, w.depends)}` : ""}`;
}

/** What the leader's side of a buying situation's What to buy card weighs (fact layer step 5, part 2): the leader's own
 * card inside the cell (its column, set against the tracker), or - when the leader is the tracker - the tracker's
 * column of the cell's own block (set against another brand). The first two rows that are arguments, in the card's
 * order, each read from the card's weighs selection; null when the card shows no such column. */
function leaderWeighs(c: Ctx, roomId: string, leader: { key: string; name: string }): { codes: string[]; other: string } | null {
  const pp = c.map.positions[roomId]?.panel;
  const code = (name: string) => c.argCodes.find((x) => x.toLowerCase() === name.toLowerCase());
  let rows: { name: string }[];
  let selId: string | undefined;
  let other: string;
  if (leader.key === c.target.key) {
    rows = c.reg.weighsRows(statId.cell(roomId), "comp", 0);
    selId = pp?.weighsComp?.selection;
    other = "another brand";
  } else {
    const part = c.reg.rivalPart(roomId, leader.name);
    if (!part) return null;
    rows = c.reg.weighsRows(statId.cellRival(roomId, part), "plain", 1);
    selId = pp?.rivals?.find((r) => r.name === part)?.weighs?.selection;
    other = c.brand;
  }
  const codes = rows.filter((r) => !!code(r.name)).slice(0, 2).map((r) => nameOn(c, "weighs-leader", roomId, code(r.name)!, selId));
  return { codes, other };
}

const LIFT_SIDE = FLOORS.liftMinSide; // the one lift rule's floor for a two-sided read (picks a side)

function jobsFrame(c: Ctx): BriefSection[] {
  const paras: BriefPara[] = [];
  // Stage 4: each buying situation's Value card (its own worth-it bar).
  const valueRooms = new Map((c.verdicts.value?.rooms ?? []).map((r) => [r.key, r]));
  const worthHere = (room: string) => (valueRooms.has(room) ? worthIn(c, room) : null);
  const stands = roomStands(c);
  const thin = c.rooms.filter((r) => roomAnswers(r) > 0 && roomFirm(r) < MIN);
  for (const r of [...stands.map((x) => x.r), ...thin]) {
    const st = stands.find((x) => x.r === r);
    const parts: string[] = [];
    if (r.description) parts.push(sentence(r.description));
    let tip = `${roomAnswers(r)} answers`;
    if (!st) parts.push(`Too few answers here commit to a pick to call who takes this buying situation.`);
    else {
      tip += `; ${roomTip(st.r, st.mine)} picks`;
      if (!st.owns && st.leader) {
        parts.push(`${c.name} takes ${roomK(st.mine) === 0 ? "none" : fRoom(c, r.room, c.subject.key)} of the picks here; ${st.leader.name} leads with ${fRoom(c, r.room, st.leader.key)} of the picks.`);
        tip += `; ${st.leader.name} ${kOf(st.leader.share)}`;
      } else parts.push(`${c.name} leads here with ${fRoom(c, r.room, c.subject.key)} of the picks${st.leader && kOf(st.leader.share) > 0 ? `, ahead of ${st.leader.name} at ${fRoom(c, r.room, st.leader.key)}` : ""}.`);
      // Why, from this buyer's own answers - stage 5: the buyer's What to buy card ("What the answer weighs" on each
      // side, the lift test on the card's own counts; the subject's and the others' picks from the card's share and
      // commit lines). A rival reads its own card inside that cell, which sets it against the tracker alone ("when it
      // picks <tracker>"); a cell that shows no two-sided block for a rival subject says nothing here.
      const roomId = `chooses:open:${norm(r.room)}`;
      if (c.map.positions[roomId]) {
        const mineK = roomK(st.mine);
        // The other side: every other in-category pick for the tracker; the tracker's own picks for a rival (its card).
        const othersK = c.isTarget ? roomFirm(r) - mineK : roomK(roomBrand(r, c.target.key)?.share);
        if (mineK >= LIFT_SIDE && othersK >= LIFT_SIDE) {
          const sides = argSides(c.reg, c.argCodes, c.isTarget, c.name, roomId, c.map);
          if (sides || c.isTarget) {
            // Named leads: rows not seldom raised first (ruling 1); a named pair that is all seldom raised says so.
            const winA = leadsFirst((sides?.subj ?? []).filter((l) => l.lift > 0 && l.wins.low > l.others.high).sort((x, y) => y.lift - x.lift)).slice(0, 2);
            const loseA = leadsFirst((sides?.oth ?? []).filter((l) => l.lift < 0 && l.others.low > l.wins.high).sort((x, y) => x.lift - y.lift)).slice(0, 2);
            const win = winA.map((l) => nameOn(c, "argument", roomId, l.code, l.sel));
            const lose = loseA.map((l) => nameOn(c, "argument", roomId, l.code, l.sel));
            const pairSeldom = (xs: ArgStat[]) => (xs[0]?.seldom ? (xs.length > 1 ? ", though they are seldom raised" : ", though it is seldom raised") : "");
            if (win.length || lose.length)
              parts.push(
                `${win.length ? `When the AI picks ${c.name} for this buyer, ${listOf(win)} ${win.length > 1 ? "come" : "comes"} up more${pairSeldom(winA)}` : `Nothing comes up clearly more when the AI picks ${c.name} for this buyer`}${lose.length ? `; when it picks ${c.isTarget ? "another brand" : c.brand}, ${listOf(lose)} ${lose.length > 1 ? "come" : "comes"} up more${pairSeldom(loseA)}` : ""}.`
              );
            else parts.push(`No argument in this buyer's answers comes up clearly more on either side.`);
          }
        } else if (mineK < LIFT_SIDE) {
          // Too few picks of the subject for the two-sided read (the card's counts); the leader alone - what its side of
          // this buyer's What to buy card weighs (the leader's own card inside the cell, set against the tracker; the
          // tracker's side of the cell's own block when the leader is the tracker): its first two arguments, in the
          // card's order, number-free. A card with no such rows: the clause is not written.
          const lw = st.leader && !st.owns ? leaderWeighs(c, roomId, st.leader) : null;
          parts.push(`The AI picks ${c.name} here too seldom to say what wins it${lw && lw.codes.length ? `; when it picks ${st.leader!.name}, ${listOf(lw.codes)} ${lw.codes.length > 1 ? "come" : "comes"} up more than when it picks ${lw.other}` : ""}.`);
        } else if (c.isTarget) parts.push(`Too few of these answers pick another brand to say what wins against ${c.name} here.`);
        else if (st.leader?.key !== c.target.key) {
          // bf46 (Tyler): on a rival's Brief the tracker being picked too rarely to compare IS the finding - state
          // the tracker's own share here (the buyer card's figure), never a note about method.
          const tk = roomK(roomBrand(r, c.target.key)?.share);
          parts.push(tk === 0 ? `${c.brand} is never the pick here.` : `${c.brand} takes ${fRoom(c, r.room, c.target.key)} of the picks here.`);
        }
      }
    }
    if (c.isTarget) {
      const v = valueRooms.get(r.room);
      const vw = worthHere(r.room);
      if (v && vw && vw.yes.n >= MIN) {
        const what = valueProduct(c, valueCell(c, r.room));
        parts.push(`Asked whether ${what} is worth paying more for than a cheaper option, the AI ${worthWords(c, vw)}.`);
        tip += `; worth it ${vTip(vw.yes)}`;
      }
      // statids8: the fixed situation this buyer's What to buy card names (its move box).
      const cw = cardWall(c, `chooses:open:${norm(r.room)}`);
      if (cw) parts.push(`Buyers who say "${condLabel(cw)}" are sent elsewhere here - that is where they already are, not something a message can change.`);
    }
    const hasValue = c.isTarget && (worthHere(r.room)?.yes.n ?? 0) >= MIN;
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
      if (!trail.length) close.push(`${c.name} leads every buying situation here, most firmly with ${buyerPhrase(owned[0].r.room)} at ${fRoom(c, owned[0].r.room, c.subject.key)} of the picks.`);
      else {
        close.push(owned.length ? `${c.name} leads with ${listOf(owned.map((x) => buyerPhrase(x.r.room)))}.` : `${c.name} leads no buying situation here.`);
        if (nearT) close.push(`It comes nearest to the leader with ${buyerPhrase(nearT.r.room)} - ${fRoom(c, nearT.r.room, c.subject.key)} of the picks to ${fRoom(c, nearT.r.room, nearT.leader!.key)} for ${nearT.leader!.name}.`);
        else if (!owned.length && trail[0] !== far) close.push(`Its closest is ${buyerPhrase(trail[0].r.room)} - ${roomK(trail[0].mine) === 0 ? "none" : fRoom(c, trail[0].r.room, c.subject.key)} of the picks to ${fRoom(c, trail[0].r.room, trail[0].leader!.key)} for ${trail[0].leader!.name}.`);
        if (far) close.push(`It is furthest behind with ${buyerPhrase(far.r.room)} - ${roomK(far.mine) === 0 ? "none" : fRoom(c, far.r.room, c.subject.key)} of the picks to ${fRoom(c, far.r.room, far.leader!.key)} for ${far.leader!.name}.`);
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
          return { x, t: roomBrand(x.r, T)?.share };
        })
        .map((y) => ({ ...y, d: roomRate(y.x.mine) - roomRate(y.t) }))
        .sort((a, b) => b.d - a.d);
      const hi = vs[0];
      const lo = vs[vs.length - 1];
      close.push(
        `Against ${c.brand}, ${c.name} is strongest with ${buyerPhrase(hi.x.r.room)} - ${roomK(hi.x.mine) === 0 ? "none" : fRoom(c, hi.x.r.room, c.subject.key)} of the picks to ${roomK(hi.t) === 0 ? "none" : fRoom(c, hi.x.r.room, T)} for ${c.brand} - and weakest with ${buyerPhrase(lo.x.r.room)}, ${roomK(lo.x.mine) === 0 ? "none" : fRoom(c, lo.x.r.room, c.subject.key)} to ${roomK(lo.t) === 0 ? "none" : fRoom(c, lo.x.r.room, T)}.`
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
      a: roomRate(g.mine) * 100,
      value: fRoom(c, g.r.room, c.subject.key),
      b: rateOf(g.leader!.share) * 100,
      bValue: fRoom(c, g.r.room, g.leader!.key),
      who: g.leader!.name,
      ...(g.owns ? { accent: true } : {}),
    })),
  };
}

/* -------------------------------- Diagnosis -------------------------------- */

/** The worries about the price: the price_worries selection (selections.ts - its wording names money; one stated
 * rule), on the buyers' worries or the customers' worries, in the cards' order. */
function priceWorries(c: Ctx, row: "buyers" | "customers"): string[] {
  const sel = c.rf.sel.selection("price_worries", "ai", { types: row === "buyers" ? ["objections"] : ["churn_triggers", "renewal"] });
  return (sel.members as SelMember[]).map((m) => nameOn(c, "price-worry", worryCell(c, row, m.key) ?? "", m.key, sel.id, m.key));
}


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
  const leader = leaderOf(c);
  const behind = !!leader && shareRate(c, leader.key) > shareRate(c, S.key);

  // 1. Visibility against conversion - ruling 11: the visibility view's one rule (visibilityOf): visible = named in
  // over half the answers; converting = recommended in 20+ answers and its recommendations end as the pick at or above
  // the level line for the charted brands together.
  if (namedN(c, S.key) >= MIN && commitK(c) >= MIN) {
    const V = visibilityOf(c);
    const visible = V.visible(S);
    const converts = V.converting(S);
    const heading = visible
      ? converts
        ? behind
          ? `Known and chosen - and still behind ${leader!.name}`
          : `Named and chosen more than any rival`
        : "Present everywhere, chosen rarely"
      : converts
        ? "Chosen when named, but not named enough"
        : "Rarely named and rarely chosen";
    const conv = convRate(c, S.key);
    const parts = [
      `When buyers ask the AI what to buy, ${c.name} comes up in ${fNamed(c, S)} of the answers and is recommended in ${fRec(c, S)}.`,
      `The AI settles on one ${c.product} in ${fCommit(c)} of answers, and ${c.name} is that ${c.product} ${picksOf(c, S.key) === 0 ? "none of the time" : `${fShare(c, S)} of the time`}${pickedHome(c) ? ` - ${fPicked(c, S)} of all answers` : ""}.`,
    ];
    if (recK(c, S.key) >= MIN) parts.push(visible && !converts ? `The problem is conversion, not visibility: ${fConv(c, S)} of the answers that recommend ${c.name} end with it as the pick.` : `Of the answers that recommend ${c.name}, ${fConv(c, S)} end with it as the pick.`);
    if (leader && behind) {
      const lc = recK(c, leader.key) >= MIN ? convRate(c, leader.key) : null;
      parts.push(`Buyers are steered to ${leader.name} instead, which takes ${fShare(c, leader)} of the picks${lc !== null && lc > conv ? ` and turns ${fConv(c, leader)} of its recommendations into the pick` : ""}.`);
    } else if (leader) parts.push(`No rival takes more of the picks; the nearest is ${leader.name} at ${fShare(c, leader)}.`);
    out.push({ key: "diag_conversion", heading, paras: [withCells({ text: parts.join(" ") }, cellsOf(c, ...subjectPins(c), BRAND_CARD(S.key), leader ? brandPin(c, leader.key) : null))] });
  }

  // 2. The price (the tracker's own brand only: Value and the worries are its questions).
  // Stage 4: the Value cards and the price worries' cards - every figure and every decision here is theirs.
  const v = c.verdicts.value;
  const wa = c.isTarget ? worthAll(c) : null;
  if (c.isTarget && v && wa && wa.yes.n >= MIN) {
    const yes = vRate(wa.yes);
    const no = vRate(wa.no);
    // Headed by what the verdict is: for a brand that leads, a price doubt is where the lead is exposed.
    const heading = no > yes ? (behind ? "Price is where the case breaks down" : "Price is where the lead is exposed") : yes > no ? "The price holds up" : "Price splits the answer";
    const what = valueProduct(c, valueCell(c));
    const parts = [
      `Asked whether ${what} is worth paying more for than a cheaper option, the AI ${vShareWords(c, wa.yes, "says yes", "never says yes")}, says no in ${vfig(c, wa.no)} and says it depends in ${vfig(c, wa.depends)}.`,
    ];
    const pins: (string | undefined)[] = [valueCell(c)];
    // bf34: where it points the buyer instead, as the Value card states it (shares of all its answers); the rival
    // named is the one its explanation lists first.
    const vi = insteadOf(c, valueCell(c));
    if (vi) {
      const rival = insteadLeader(c, valueCell(c));
      parts.push(valueInsteadText(c, vi));
      if (rival && vi.rival.k > 0) parts.push(`${rival} is the rival it names most.`);
    }
    // The worry about the price: the buyers' worry first, then the customers' with the same wording - each worry's
    // own card, in the cards' order (stage, then answers).
    const goOf = (concern: string) => statOr(verdictOf(c, worryCell(c, "buyers", concern), "proceed"));
    const kl2Of = (concern: string): { keep: VF; leave: VF } | undefined => {
      const id = worryCell(c, "customers", concern);
      const k = verdictOf(c, id, "keep");
      const l = verdictOf(c, id, "leave");
      return k && l ? { keep: vOf(k), leave: vOf(l) } : undefined;
    };
    const ob = priceWorries(c, "buyers")
      // statids8: the worry as its card is titled.
      .map((w) => ({ concern: cardLabel(c, worryCell(c, "buyers", w), w), go: goOf(w) }))
      .find((r): r is { concern: string; go: VF } => !!r.go && r.go.n >= MIN);
    if (ob) {
      parts.push(`A buyer who worries "${ob.concern}" is ${ob.go.k === 0 ? "never told to go ahead" : ob.go.k === ob.go.n ? "told to go ahead every time" : `told to go ahead in ${vfig(c, ob.go)} of answers`}.`);
      pins.push(worryCell(c, "buyers", ob.concern));
    }
    const klRows = priceWorries(c, "customers")
      .map((w) => ({ concern: cardLabel(c, worryCell(c, "customers", w), w), v: kl2Of(w) }))
      .filter((r): r is { concern: string; v: { keep: VF; leave: VF } } => !!r.v && r.v.keep.n >= MIN);
    const kl = klRows.find((r) => ob && norm(r.concern) === norm(ob.concern)) ?? klRows[0];
    if (kl) {
      // bf34: the worry is named, so the figure reads with the card it is on.
      parts.push(`${ob && norm(kl.concern) === norm(ob.concern) ? `A customer with the same worry ("${kl.concern}")` : `A customer who worries "${kl.concern}"`} is ${kl.v.keep.k === 0 ? "never told to stay" : `told to stay in ${vfig(c, kl.v.keep)}`} and ${kl.v.leave.k === 0 ? "never told to leave" : `told to leave in ${vfig(c, kl.v.leave)}`}.`);
      pins.push(worryCell(c, "customers", kl.concern));
    }
    // The buyer who is the exception: the room furthest from the overall verdict, the other way (each room's Value card).
    const rooms = valueRoomsOrder(c).filter((x): x is { r: (typeof x)["r"]; w: Worth3 } => !!x.w && x.w.yes.n >= MIN);
    const ex = [...rooms].sort((a, b) => (no > yes ? vRate(b.w.yes) - vRate(a.w.yes) : vRate(a.w.yes) - vRate(b.w.yes)))[0];
    if (ex && rooms.length >= 2 && Math.abs(vRate(ex.w.yes) - yes) >= 0.15) {
      const exLine = valueProductRaw(c, valueCell(c, ex.r.key));
      const asked = exLine && norm(exLine) !== norm(what) ? `, asked about ${theProduct(exLine, c.brand, COMMON_WORDS)}` : "";
      parts.push(
        no > yes
          ? `The exception is ${buyerPhrase(ex.r.rooms[0])}${asked}: there the AI calls it worth it in ${vfig(c, ex.w.yes)} of answers.`
          : `The exception is ${buyerPhrase(ex.r.rooms[0])}${asked}: there the AI calls it worth it in only ${ex.w.yes.k === 0 ? "none" : vfig(c, ex.w.yes)} of answers.`
      );
      pins.push(`chooses:value:${norm(ex.r.rooms[0])}`);
    }
    out.push({ key: "diag_price", heading, paras: [withCells({ text: parts.join(" ") }, cellsOf(c, ...pins))] });
  }

  // 3. The argument that wins, against what the AI tells buyers to look for.
  const { bestC: bestArg } = argsOnCard(c);
  const best = bestArg?.l;
  if (bestArg && best && checklistOf(c).length >= 5) {
    const top = checklistOf(c).map((code) => ({ code }));
    const onList = top.some((t) => norm(t.code) === norm(best.code));
    const taughtAs = onList;
    const heading = onList
      ? `${poss(c.name)} winning argument is one buyers are told to look for`
      : behind
        ? `${poss(c.name)} winning argument is not what buyers are told to look for`
        : `The lead rests on an argument buyers are not told to look for`;
    const parts = [`When the AI picks ${c.name}, it argues ${bestArg.f.name.toLowerCase()} in ${bestArg.f.here} of those answers; when it picks ${c.isTarget ? "another brand" : c.brand}, in ${bestArg.f.there}${seldomSaid(best)}.`];
    if (!onList) {
      parts.push(`${cap(best.code)} is not among the five things the AI most often tells buyers to look for.`);
      const lead3 = top.slice(0, 3).map((t) => t.code);
      parts.push(`It leads instead with ${listOf(lead3)}.`);
      // statids8: a checklist topic (the What to look for card's own list, in its order) that the What to buy card shows
      // in its "when it picks another" column and that passes the lift test on that card's counts.
      const oth = argSides(c.reg, c.argCodes, c.isTarget, c.name, OPEN_ALL, c.map)?.oth ?? [];
      const against = top.map((t) => oth.find((l) => norm(l.code) === norm(t.code))).find((l) => l && l.lift < 0 && l.others.low > l.wins.high);
      if (against) parts.push(`Of the points it raises most, ${nameOn(c, "checklist-against", OPEN_ALL, against.code, against.sel)} comes up more often when ${c.isTarget ? "another brand" : c.brand} is picked.`);
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
    // statids8: the conditions are the What to buy card's own "choose another" rows, in the card's order, each sending
    // buyers where its own "To ..." rows say.
    const conds = condRows(c, OPEN_ALL, "away").filter((r) => !isDefaultCondition(r.text));
    const sentTo = (g: CondRowStats) => {
      const d = cardDest(c, OPEN_ALL, g);
      // bf43: The diagnosis words this its own way - Now what's finding uses "Buyers who say ... are most often
      // sent away", and with no share on either the two views printed one sentence twice (Doritos).
      return `When buyers ask what to buy, the AI most often sends away those who say "${condLabel(nameOn(c, "away-row", OPEN_ALL, g.text, c.map.positions[OPEN_ALL]?.panel?.conditions?.selections?.away))}"${d ? `, ${d}` : ""}.`;
    };
    const toLeader = conds.find((g) => g.to[0]?.name === leader.name);
    if (toLeader) {
      parts.push(sentTo(toLeader));
      pins.push(CONDITION_CARD);
    }
    const gap = c.rooms
      .filter((r) => roomFirm(r) >= MIN)
      .map((r) => ({ r, mine: roomBrand(r, S.key)?.share, them: roomBrand(r, leader.key)?.share }))
      .filter((x) => roomRate(x.them) > roomRate(x.mine))
      .sort((a, b) => roomRate(b.them) - roomRate(b.mine) - (roomRate(a.them) - roomRate(a.mine)))[0];
    if (gap && c.rooms.filter((r) => roomFirm(r) >= MIN).length >= 2) {
      parts.push(`The gap to ${leader.name} is widest for ${buyerPhrase(gap.r.room)}: ${leader.name} takes ${fRoom(c, gap.r.room, leader.key)} of the picks there and ${c.name} ${roomK(gap.mine) === 0 ? "none" : fRoom(c, gap.r.room, S.key)}.`);
      pins.push(`chooses:open:${norm(gap.r.room)}`);
    }
    // A rival one AI company carries (a threat, the SWOT's sense), only on real concentration: the detector's own bar
    // (>= 40% of the rival's picks, the range clearing that unit's share of the questions) and at least 1.5 times
    // that share.
    const conc = c.ranked.find((i) => i.key === "engine_pick_concentration" && i.names?.variant === "rival" && i.names?.rival && i.names?.vendor);
    let concLine: { rival: string; text: string; ids: string[] } | null = null;
    if (conc) {
      // bf35: as in the SWOT - only when a card draws the share of its picks; never the share of the questions, which
      // is read (its fact) to decide the 1.5x bar.
      const cx = concentrationOf(c, conc);
      if (cx && cx.ratio >= 1.5)
        concLine = {
          rival: conc.names!.rival!,
          text: `${conc.names!.vendor}'s assistants carry ${conc.names!.rival}: ${cx.share} of its picks come from them, far more than the others, so ${conc.names!.rival} is picked more wherever buyers use them.`,
          ids: insightCells(c, conc),
        };
    }
    if (concLine && concLine.rival === leader.name) {
      parts.push(concLine.text);
      pins.push(...concLine.ids);
    }
    // Customers looking around asked for alternatives, so being shown rivals is by design; only stay / leave, and
    // only when it says something (told to leave at the SWOT's bar, or almost never told to stay).
    const dfn = holdFigs(c);
    if (dfn && dfn.keep.n >= MIN && (vRate(dfn.leave) >= HOLD_LEAVE_BAR || (vRate(dfn.keep) <= 0.1 && dfn.leave.k > 0))) {
      const stay = dfn.keep.k === 0 ? "never told to stay" : `told to stay in ${vfig(c, dfn.keep)} of answers`;
      const leave = dfn.leave.k === 0 ? "never told to leave" : `told to leave in ${vfig(c, dfn.leave)}`;
      parts.push(`${poss(c.name)} own customers who ask what else to consider are ${stay} and ${leave}.`);
      pins.push(holdAll(c));
    }
    const paras: BriefPara[] = [];
    if (parts.length) paras.push(withCells({ text: parts.join(" ") }, cellsOf(c, ...pins)));
    const others: string[] = [];
    const otherPins: (string | undefined)[] = [];
    const top = conds[0];
    if (top && top !== toLeader && top.to[0]?.name !== leader.name) {
      others.push(sentTo(top));
      otherPins.push(CONDITION_CARD);
    }
    if (concLine && concLine.rival !== leader.name) {
      others.push(concLine.text);
      otherPins.push(...concLine.ids);
    }
    if (others.length) paras.push(withCells({ lead: "Others who take buyers.", text: others.join(" ") }, cellsOf(c, ...otherPins)));
    if (paras.length) out.push({ key: "diag_threat", heading, paras });
  } else if (!c.isTarget && vsTargetOf(c) && vsTargetOf(c)!.n >= MIN) {
    const w = vsTargetOf(c)!;
    const range = vRange(w);
    const heading = range.low > 0.5 ? `${c.name} wins the straight choice against ${c.brand}` : range.high < 0.5 ? `${c.brand} wins the straight choice against ${c.name}` : `${c.name} and ${c.brand} split the straight choice`;
    const text = `When the AI must choose between ${c.name} and ${c.brand}, it settles on ${c.name} ${w.k === 0 ? "none of the time" : w.k === w.n ? "every time" : `${vfig(c, w)} of the time`}.`;
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
  // Stage 2 (stat ids): text carrying figures is rewritten on its plain text with each figure kept on its number
  // (brief_figs.ts trReplace); text without figures takes the native replace, exactly as before.
  const figs = hasFigs(t);
  let tr: Tr = figs ? decode(t) : { s: t, m: [] };
  const R = (re: RegExp, r: string | ((...a: never[]) => string)) => {
    tr = figs ? trReplace(tr, re, r) : { s: tr.s.replace(re, r as string), m: [] };
  };
  const rules: [RegExp, string][] = [
    [/\ban argument that comes up more when you win\b/g, `an argument that comes up more when ${B} wins`],
    [/\bwhen you win\b/g, `when ${B} wins`],
    [/\bwhen you lose\b/g, `when ${B} loses`],
    [/\banswers that pick you\b/g, `answers that pick ${B}`],
    [/\bWhen your own customer\b/g, `When ${Bs} own customer`],
    [/\byour own customers\b/g, `${Bs} own customers`],
    [/\bYour customers\b/g, `${Bs} customers`],
    [/\byour customers\b/g, `${Bs} customers`],
    [/\bAsked by your customers\b/g, `Asked by ${Bs} customers`],
    [/\balongside you\b/g, `alongside ${B}`],
    [/\bagainst your (\d+%|<1%)/g, `against ${Bs} $1`],
    [/\band you none\b/g, `and ${B} none`],
    [/\bthe matchups you win \/ lose\b/g, `the matchups ${B} wins / loses`],
    [/\bagainst you\b/g, `against ${B}`],
    [/\bwins for you\b/g, `wins for ${B}`],
    [/\brecommending you\b/g, `recommending ${B}`],
    [/\bhelps you\b/g, `helps ${B}`],
    [/\bin your category\b/g, "in the category"],
    [/\byour wins\b/g, `${Bs} wins`],
    [/\bwarranted\b/g, "fair"],
    [/\bthe criteria the AI teaches lead with\b/g, "what the AI tells buyers to look for leads with"],
    [/\bthe criteria the AI teaches\b/g, "what the AI tells buyers to look for"],
    [/\bteaches buyers to weigh\b/g, "tells buyers to look for"],
    [/\bThe worry it backs most\b/g, "The worry it agrees with most"],
    [/\b(the AI) picks (.+?) in 0% of the answers that pick one of them\b/g, "$1 never picks $2 when it picks one of the two"],
    [/\b(the AI) picks (.+?) in 100% of the answers that pick one of them\b/g, "$1 always picks $2 when it picks one of the two"],
    [/\b(the AI) picks (.+?) 0% of the time it picks one of (?:them|the two)\b/g, "$1 never picks $2 when it picks one of the two"],
    [/\b(the AI) picks (.+?) 100% of the time it picks one of (?:them|the two)\b/g, "$1 always picks $2 when it picks one of the two"],
    [/\bis judged worth it over a cheaper option in 0% of answers and not worth it in\b/g, "is never judged worth it over a cheaper option and is judged not worth it in"],
    [/\bis judged worth it over a cheaper option in 0% of answers\b/g, "is never judged worth it over a cheaper option"],
    [/\bthe AI says yes in 0% of answers\b/g, "the AI never says yes"],
    [/\bin 100% of the answers that judge it\b/g, "in every answer that judges it"],
    [/\bin 0% of the answers that judge it\b/g, "in none of the answers that judge it"],
    [/\btells them to go ahead in 0%/g, "never tells them to go ahead"],
    [/\btakes 0% of the picks\b/g, "takes none of the picks"],
    [/\bpicked in 0%/g, "never picked"],
    [/\bsays (\w+) in 0% of answers and (\w+) in 0%/g, "never says $1 or $2"],
    [/\bsays (\w+) in 0% of answers and\b/g, "never says $1, and says"],
    [/\btells them to stay in 0%/g, "never tells them to stay"],
  ];
  for (const [re, r] of rules) R(re, r);
  // Buying situations as words (longest label first; never inside quotes; a possessive left as written).
  const labels = [...new Set(c.rooms.map((r) => r.room.trim()))].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const L of labels) {
    // The map's possessive form ("In <label>'s problem questions").
    R(new RegExp(`\\b(In|in) ${escRe(L)}['’]s problem questions\\b`, "g"), ((_m: string, inW: string) => `${inW} the problem questions of ${buyerPhrase(L)}`) as never);
    const re = new RegExp(`(?<![\\w"-])${escRe(L)}(?![\\w'’-])`, "g");
    R(re, ((m: string, at: number, full: string) => {
      if (inQuotes(full, at)) return m;
      const before = full.slice(0, at);
      const start = before.trim() === "" || /[.!?:]\s+$/.test(before);
      return buyerPhrase(L, { start });
    }) as never);
  }
  return figs ? encode(tr) : tr.s;
}

/** bf29: "every" at the top of the scale in memo sentences (the cards keep their figures - they are the receipts). */
function everyWords(t: string): string {
  const rules: [RegExp, string | ((...a: never[]) => string)][] = [
    [/\bin 100% of the answers that pick (.+?)([,.;]| against| and)/g, ((_m: string, who: string, end: string) => `in every answer that picks ${who}${end}`) as never],
    [/\bin 100% of those answers\b/g, "in all of those answers"],
    [/\bin 100% of (?:the )?answers\b/g, "in every answer"],
    // bf40 (found on the live snapshot - Sephora): shares of picks and of problem questions at 100%.
    [/\b100% of the picks\b/g, "every pick"],
    [/\b100% of the problem questions that do not name\b/g, "every one of the problem questions that do not name"],
  ];
  if (!hasFigs(t)) return rules.reduce((x, [re, r]) => x.replace(re, r as string), t);
  return encode(rules.reduce((x, [re, r]) => trReplace(x, re, r), decode(t)));
}

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

/**
 * Stage 3: the brand summary as the Brief may read it - brands are who they are (key, name, role); the funnel cells
 * (named, recommended, chosen, share of picks, the commit counts, the per-assistant slices) are taken out. Under
 * BRIEF_STRICT_FUNNEL=1 each taken-out field is a getter that throws, so a run proves no funnel path in this file
 * reads the old source (scripts/brief_links_harness.mts runs strict; its negative control reads one and expects the
 * throw).
 */
const FUNNEL_FIELDS = ["mentioned", "recommended", "chosen", "shareOfDecided"] as const;
const SUMMARY_FUNNEL_FIELDS = ["firmPick", "firmPickInCategory", "byMode", "byEngine"] as const;
/** Stage 4: the verdict fields of the summary and the insight inputs (taken out; strict, a read throws). */
const SUMMARY_VERDICT_FIELDS = ["headToHead", "buyersDoubt", "customersDoubt"] as const;
const strictGuard = <T extends object>(o: T, fields: readonly string[], what: string, flag = "BRIEF_STRICT_FUNNEL"): T => {
  if (process.env.BRIEF_STRICT_FUNNEL)
    for (const f of fields)
      Object.defineProperty(o, f, {
        enumerable: false,
        get() {
          throw new Error(`${flag}: the Brief read ${what}.${f} from the old source`);
        },
      });
  return o;
};
export function stripFunnel(summary: BrandSummaryView): { summary: BriefSummary; target: Brand; brands: Brand[] } {
  const asBrand = (b: SummaryBrand): Brand => strictGuard({ key: b.key, name: b.name, role: b.role }, FUNNEL_FIELDS, b.name);
  const brands = summary.brands.map(asBrand);
  const target = brands.find((b) => b.key === summary.target.key) ?? asBrand(summary.target);
  const { target: _t, brands: _b, firmPick: _f, firmPickInCategory: _fi, byMode: _m, byEngine: _e, headToHead: _h, buyersDoubt: _bd, customersDoubt: _cd, ...rest } = summary;
  void [_t, _b, _f, _fi, _m, _e, _h, _bd, _cd];
  return { summary: strictGuard({ ...rest, target, brands }, [...SUMMARY_FUNNEL_FIELDS, ...SUMMARY_VERDICT_FIELDS], "summary"), target, brands };
}

/**
 * Stage 4: who the verdicts are about, as names only (the rivals with a direct matchup, the Value question's lines and
 * buying situations, the worries, the rivals whose customers ask what to switch to). The verdict figures are the
 * verdict cards' stats; nothing else of the inputs is read.
 */
export function stripVerdicts(inputs: InsightInputs, summary: BrandSummaryView): { verdicts: VerdictIdent } {
  const { value, doubt, alternatives } = inputs;
  const verdicts: VerdictIdent = {
    h2h: summary.headToHead.map((r) => ({ key: r.key, rival: r.rival })),
    value: value ? { lines: value.lines.map((l) => ({ label: l.label })), rooms: value.rooms.map((r) => ({ key: r.key, rooms: [...r.rooms], line: r.line })) } : null,
    buyers: (doubt.objections?.rows ?? []).map((r) => ({ stage: r.stage, concern: r.concern })),
    customers: (doubt.keepOrLeave?.rows ?? []).map((r) => ({ stage: r.stage, concern: r.concern })),
    leavers: (alternatives?.offensive?.rows ?? []).map((r) => ({ key: r.key, rival: r.rival })),
  };
  return { verdicts };
}

/** True when some other brand out-picks `key` (a rival subject's archetype: trailing = specialist), by the cards' picks. */
const outPicked = (c: Ctx, key: string) => funnelBrands(c).some((b) => b.key !== key && !!fun(c, key).share && picksOf(c, b.key) > picksOf(c, key));

/** A buying situation as its cards show it: the commit line of its What to buy card, every funnel brand's share of the
 * picks there (roomShareStat, the brands some card lists there), and its leader (the leader selection). */
function roomOf(c: Ctx, room: string, description: string | null): RoomRead {
  const id = `chooses:open:${norm(room)}`;
  const brands = funnelBrands(c)
    .map((b) => ({ key: b.key, name: b.name, share: roomShareStat(c, room, b.key) }))
    .filter((b): b is RoomBrand => !!b.share);
  const commit = c.reg.line(id, "commit", "rate");
  const sel = c.rf.sel.selection("leader", c.isTarget ? "you" : c.subject.key, { ...WHAT_TO_BUY_ALL, situation: room });
  const lm = (sel.members as SelMember[])[0];
  let leader: RoomBrand | undefined;
  if (lm) {
    nameOn(c, "room-leader", id, brandOfKey(c, lm.key).name, sel.id, lm.key);
    const share = brands.find((b) => b.key === lm.key)?.share;
    if (share) leader = { key: lm.key, name: brandOfKey(c, lm.key).name, share };
  }
  return { room, description, ...(commit ? { commit } : {}), brands, ...(leader ? { leader } : {}) };
}

export interface BriefRequest extends ViewRequest {
  /** The subject brand as written (display name or alias); absent = the target. */
  subject?: string;
}

export async function computeBrief(data: ViewData, request: BriefRequest = {}): Promise<BriefView> {
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  // The summary and the map (placements of the full ranked list, cell stats) from the per-load shared computes
  // (view_data computeMemo), and the run's facts and selections - the one book the cards, the Map and the Overview
  // read. READ-ONLY.
  const { view: summary, inputs } = await sharedBrandSummary(data, eng);
  const { view: map, debug, ranked } = await sharedAnalysisMap(data, eng);
  const rf = await sharedRunFacts(data, eng);
  // The map's own matcher places every ranked insight (the same order as probeInsights).
  const placements = new Map<string, string>();
  (debug.placements ?? []).forEach((pl, i) => {
    const ins = ranked[i];
    if (ins && pl.cellId && map.positions[pl.cellId]) placements.set(placementKey(ins.key, ins.title), pl.cellId);
  });
  const stats = debug.cells;
  const resolve = buildResolver(data.dictionary, data.judged, data.names);
  const brand = data.project.brand;
  // Stage 3: the Brief's brands are who they are - their funnel figures are the cards' stats (fun, funnelBrands).
  const { summary: briefSummary, target, brands: briefBrands } = stripFunnel(summary);

  // Subjects: the target, then every brand in the table.
  const subjects = [target, ...briefBrands.filter((b) => b.key !== target.key)];
  let subject = target;
  if (request.subject) {
    const want = matchKey(request.subject);
    const rk = resolve(request.subject).key;
    subject = subjects.find((b) => matchKey(b.name) === want || b.key === rk) ?? target;
  }
  const isTarget = subject.key === target.key;
  const name = isTarget ? brand : subject.name;

  // Buying situations in setup order; each is read from its What to buy card (roomsOf, after the context exists).
  const desc = roomDescriptions(data.setupDecision);
  const roomList: string[] = [];
  for (const it of [...data.intents].sort((a, b) => a.seq - b.seq))
    if (it.situation && viewsOf(it.stage, it.angle).includes("headline") && !roomList.includes(it.situation)) roomList.push(it.situation);

  // Stage 4: the verdict views as names only; their figures are the verdict cards' stats.
  const { verdicts } = stripVerdicts(inputs, summary);

  // Every number the cards draw, where each fact is drawn, and the figures this Brief prints.
  const reg = buildStatRegistry(map);
  const drawn = new Map<string, Stat[]>();
  for (const st of reg.all()) {
    if (!st.fact || st.id.includes("#")) continue;
    const xs = drawn.get(st.fact);
    if (xs) xs.push(st);
    else drawn.set(st.fact, [st]);
  }
  const figs = newFigTable();
  // The codebook's argument names (which weighs rows are arguments - names only, no count).
  const argCodes = [...new Set(rf.set.facts.flatMap((f) => f.args ?? []))].sort();
  // bf26: the same detectors in the Brief's style, about the target by name (the served ones stay second person). Every
  // number a callback hands back is a card's figure printed as a statement marker with its fact id (statements.ts
  // `pref`), so the finished finding carries every number's fact under `facts`.
  const asStmt = (st: Stat | undefined) => (st ? pref(st.fact!, st.value) : null);
  const argStmt = (st: Stat) => (st.value === "0%" ? "none" : pref(st.fact!, st.value));
  const voiced = new Map<string, Insight>(
    isTarget
      ? rankedInsights(summary, inputs, {
          name: brand,
          cardArg: (code, side) => {
            const sides = argSides(reg, argCodes, true, brand, OPEN_ALL, map);
            const a = (side === "you" ? sides?.subj : sides?.oth)?.find((x) => x.code.toLowerCase() === code.toLowerCase());
            return a ? (side === "you" ? { name: a.name, here: argStmt(a.subj), there: argStmt(a.oth) } : { name: a.name, here: argStmt(a.oth), there: argStmt(a.subj) }) : null;
          },
          awayRow: (labels, dests) => {
            // bf36 / stage 5: the What to buy card's row for this condition, and only when the card sends its buyers
            // first to a destination the sentence names; else the head-to-head card against that same destination
            // (its "choose the rival" rows all send buyers to that rival); else none.
            const keys = labels.map(condKey);
            const ds = dests.map(norm);
            const open = reg.conditionRows(statId.cell(OPEN_ALL), "away").find((r) => keys.includes(condKey(r.text)) && !!r.to[0] && ds.includes(norm(r.to[0].name)));
            if (open) return { value: asStmt(open.share)!, where: "when buyers ask what to buy" };
            for (const [id, st] of Object.entries(stats)) {
              if (st.row !== "h2h" || st.pooled || !ds.includes(norm(st.label))) continue;
              const row = reg.conditionRows(statId.cell(id), "away").find((r) => keys.includes(condKey(r.text)));
              if (row) return { value: asStmt(row.share)!, where: `when it compares ${brand} with ${st.label} directly` };
            }
            return null;
          },
          exceptionRow: (labels, rival) => {
            // The head-to-head card's "Who it still sends to you" rows (its exception step), by the row's text.
            const keys = labels.map(condKey);
            const id = Object.entries(stats).find(([, st]) => st.row === "h2h" && !st.pooled && norm(st.label) === norm(rival))?.[0];
            const row = id ? reg.section(id, "exception", "Who it still sends to you").find((x) => keys.includes(condKey(x.label))) : undefined;
            return asStmt(row?.stat);
          },
          outsideShare: (room) => {
            // A Spotting-the-problem card's "Where the other answers point - Points to something other than ..." row.
            const id = room ? `chooses:awareness:${norm(room)}` : "chooses:awareness:all";
            const st = reg.all().find((x) => x.dest.kind === "cell" && x.dest.id === id && !x.id.includes("/rival:") && /^Where the other answers point - Points to something other than/.test(x.words));
            return asStmt(st);
          },
          roomShare: (room) => asStmt(reg.line(room ? `chooses:open:${norm(room)}` : OPEN_ALL, "share", "you")),
          cardStep: (id, step, seg) => asStmt(reg.segment(id, step, seg)),
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
    summary: briefSummary,
    outOfScope: { summary },
    funnel: new Map(),
    verdicts,
    map,
    stats,
    ranked,
    isTarget,
    target,
    subject,
    brand,
    name,
    product: productNoun(data.project.category),
    rooms: [],
    argCodes,
    moves: isTarget ? movesOf(map, stats, brand, findingAt, figs) : [],
    findings: [],
    placements,
    archetype: isTarget ? map.casting.archetype : "default",
    footer: `${name} - wave ${wave}${month ? ` - ${month}` : ""}.`,
    wave,
    cards: new Map(),
    voiced,
    reg,
    figs,
    rf,
    drawn,
  };
  // A rival subject's archetype: trailing (some other brand out-picks it, by the cards' picks) = specialist.
  if (!isTarget && outPicked(ctx, subject.key)) ctx.archetype = "specialist";
  ctx.rooms = roomList.map((room) => roomOf(ctx, room, desc.get(room.trim()) ?? null));

  ctx.findings = findingsOf(ctx);
  const sw = swotOf(ctx);
  // Every number opens the card that draws its fact (linkMemo); pins stay only on units with no number (pinsByRule).
  const memo = (frame: BriefFrame, sections: BriefSection[]): BriefMemo =>
    pinsByRule(linkMemo({ frame, title: `${name} - ${BRIEF_FRAME_LABELS[frame]} - wave ${ctx.wave}`, sections: voiceMemo(sections, ctx), footer: ctx.footer }, ctx));
  const memos: Record<BriefFrame, BriefMemo> = {
    now_what: memo("now_what", nowWhat(ctx)),
    diagnosis: memo("diagnosis", diagnosisFrame(ctx)),
    swot: memo("swot", swotFrame(ctx, sw)),
    funnel: memo("funnel", funnelFrame(ctx)),
    matrix: memo("matrix", matrixFrame(ctx)),
    jobs: memo("jobs", jobsFrame(ctx)),
  };
  // Only the Map-cell cards a surviving pin opens ride the payload - each a statement (its numbers' fact ids in `facts`).
  const cards: Record<string, AnswerCard> = {};
  for (const m of Object.values(memos))
    for (const id of anchorIds(m)) {
      const card = ctx.cards.get(id);
      if (card) cards[id] = finishCard(voiceCard(card, ctx), ctx, id);
    }
  // The subject list in the funnel's own order (most picked first, from the cards), then any brand no card shows.
  const ordered = [target, ...funnelBrands(ctx).filter((b) => b.key !== target.key)];
  for (const b of subjects) if (!ordered.includes(b)) ordered.push(b);
  return { subject: name, subjects: ordered.map((b) => (b.key === target.key ? brand : b.name)), memos, engineCount, cards };
}

/* ------------------------------ number links: by fact id ------------------------------ */

const NUMBER_TOKEN_G = /\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g;

/**
 * Where a fact is drawn (fact layer step 5, part 2 - a lookup, never a match): the stats that draw it, the unit's own
 * cells and its brand's own page first, then on view before behind one interaction, registry order within each. Null
 * when no card draws it (a derived fact, or a fact no card shows) - the number stays plain text and the harness lists it.
 */
function locate(c: Ctx, ref: string, prefer: { cells: string[]; rivals: string[] }): Stat | null {
  const xs = c.drawn.get(ref);
  if (!xs?.length) return null;
  const own = (s: Stat) => (s.dest.kind === "cell" ? prefer.cells.includes(s.dest.id) : prefer.rivals.includes(s.dest.name));
  const rank = (s: Stat) => (own(s) ? 0 : 2) + (s.at === "default" ? 0 : 1);
  return [...xs].sort((a, b) => rank(a) - rank(b))[0];
}

/** A figure's place in a unit's plain text (from the markers). */
type FigAt = { at: number; len: number; i: number };

function linkUnit(c: Ctx, text: string, anchors: BriefAnchor[] | undefined, figsAt: FigAt[]): BriefLink[] {
  const out: BriefLink[] = [];
  const prefer = { cells: [] as string[], rivals: [] as string[] };
  for (const a of anchors ?? []) {
    if (c.map.positions[a.id]) prefer.cells.push(a.id);
    else if (a.id.startsWith("card:brand:")) {
      const key = a.id.slice("card:brand:".length);
      if (key === c.target.key) prefer.cells.push(OPEN_ALL);
      else {
        const b = c.summary.brands.find((x) => x.key === key);
        if (b) prefer.rivals.push(b.name);
      }
    }
  }
  const seen = new Map<string, number>();
  for (const m of text.matchAll(NUMBER_TOKEN_G)) {
    const token = m[0];
    const occurrence = seen.get(token) ?? 0;
    seen.set(token, occurrence + 1);
    const at = figsAt.find((x) => m.index! >= x.at && m.index! < x.at + x.len);
    if (!at) continue;
    const f = c.figs.list[at.i];
    // A card's figure links to the card it was read from; a statement's figure to where its fact is drawn.
    const s = f.stat ?? locate(c, f.ref, prefer);
    if (!s) continue;
    out.push({ token, occurrence, dest: s.dest.kind === "cell" ? { kind: "cell", id: s.dest.id } : { kind: "rival", name: s.dest.name }, ...(s.reveal ? { reveal: s.reveal } : {}), stat: s.id, fact: f.ref });
  }
  return out;
}

/** Every figure the Brief printed, per memo field (BRIEF_FIG_LOG=1) - the links harness reads it. */
export interface FigLogEntry {
  brand: string;
  subject?: string;
  frame: BriefFrame;
  section: string;
  /** The field's place ("para 0 text", "row 3 avg", "table 2 cell 1", "viz item 0 value", "viz title", "card <id> row 0 value"). */
  field: string;
  /** The field's plain text, as served. */
  text: string;
  token: string;
  /** The token's 0-based occurrence among that token in `text`. */
  occurrence: number;
  /** The fact (or derived ref) the number is. */
  ref: string;
  /** The card stat it was printed from (a card's figure), if any. */
  stat?: string;
  /** The printed text of the figure (its full value, e.g. "<1%"). */
  value: string;
}
export const FIG_LOG: FigLogEntry[] = [];
/** Every number token in a field, with or without a figure - the harness fails on one with none. */
export interface FieldLogEntry {
  brand: string;
  subject?: string;
  frame: BriefFrame;
  section: string;
  field: string;
  text: string;
  /** Tokens no figure covers. */
  bare: string[];
}
export const FIELD_LOG: FieldLogEntry[] = [];

/** Decode one field: its plain text and its figures (logged). */
function fieldFigs(c: Ctx, frame: BriefFrame, section: string, field: string, text: string | undefined): { s: string; m: FigAt[] } {
  if (text === undefined) return { s: "", m: [] };
  const tr = hasFigs(text) ? decode(text) : { s: text, m: [] };
  if (process.env.BRIEF_FIG_LOG) {
    const bare: string[] = [];
    for (const tm of tr.s.matchAll(NUMBER_TOKEN_G)) {
      const pos = tm.index!;
      const x = tr.m.find((y) => pos >= y.at && pos < y.at + y.len);
      if (!x) {
        bare.push(tm[0]);
        continue;
      }
      const f = c.figs.list[x.i];
      const occurrence = [...tr.s.slice(0, pos).matchAll(NUMBER_TOKEN_G)].filter((y) => y[0] === tm[0]).length;
      FIG_LOG.push({ brand: c.brand, ...(c.isTarget ? {} : { subject: c.name }), frame, section, field, text: tr.s, token: tm[0], occurrence, ref: f.ref, ...(f.stat ? { stat: f.stat.id } : {}), value: tr.s.slice(x.at, x.at + x.len) });
    }
    if ([...tr.s.matchAll(NUMBER_TOKEN_G)].length) FIELD_LOG.push({ brand: c.brand, ...(c.isTarget ? {} : { subject: c.name }), frame, section, field, text: tr.s, bare });
  }
  return tr;
}

function linkMemo(memo: BriefMemo, c: Ctx): BriefMemo {
  const fr = memo.frame;
  const plain = (sec: string, field: string, t: string | undefined) => fieldFigs(c, fr, sec, field, t).s;
  const para = (sec: string, field: string) => (p: BriefPara): BriefPara => {
    const L = fieldFigs(c, fr, sec, `${field} lead`, p.lead);
    const X = fieldFigs(c, fr, sec, `${field} text`, p.text);
    const off = L.s.length + 1;
    const figsAt: FigAt[] = [...L.m, ...X.m.map((x) => ({ ...x, at: x.at + off }))];
    const lead = p.lead === undefined ? undefined : L.s;
    const text = `${lead ?? ""} ${X.s}`;
    const links = linkUnit(c, text, p.cells, figsAt);
    const q: BriefPara = { ...p, text: X.s, ...(lead !== undefined ? { lead } : {}) };
    return links.length ? { ...q, links } : q;
  };
  return {
    ...memo,
    title: plain("", "title", memo.title),
    footer: plain("", "footer", memo.footer),
    sections: memo.sections.map((s) => ({
      ...s,
      ...(s.heading !== undefined ? { heading: plain(s.key, "heading", s.heading) } : {}),
      ...(s.paras ? { paras: s.paras.map((p, i) => para(s.key, `para ${i}`)(p)) } : {}),
      ...(s.quads ? { quads: s.quads.map((q, qi) => ({ ...q, headers: q.headers.map((h, hi) => plain(s.key, `quad ${qi} header ${hi}`, h)) as [string, string], cells: [q.cells[0].map((p, i) => para(s.key, `quad ${qi}.0 para ${i}`)(p)), q.cells[1].map((p, i) => para(s.key, `quad ${qi}.1 para ${i}`)(p))] as [BriefPara[], BriefPara[]] })) } : {}),
      ...(s.rows
        ? {
            rows: s.rows.map((r, ri) => {
              const V = fieldFigs(c, fr, s.key, `row ${ri} value`, r.value);
              const label = plain(s.key, `row ${ri} label`, r.label);
              const avg = r.avg === undefined ? undefined : plain(s.key, `row ${ri} avg`, r.avg);
              const top = r.top === undefined ? undefined : plain(s.key, `row ${ri} top`, r.top);
              const heads = r.heads ? { subject: plain(s.key, `row ${ri} head`, r.heads.subject), ...(r.heads.top !== undefined ? { top: plain(s.key, `row ${ri} head top`, r.heads.top) } : {}) } : undefined;
              const base: BriefRow = { ...r, label, value: V.s, ...(avg !== undefined ? { avg } : {}), ...(top !== undefined ? { top } : {}), ...(heads ? { heads } : {}) };
              // A note row's figure sits in its label (the sentence); every other row's in its value.
              if (r.kind === "note") {
                const N = fieldFigs(c, fr, s.key, `row ${ri} note`, r.label);
                const nl = linkUnit(c, N.s, [], N.m);
                return nl.length ? { ...base, links: nl } : base;
              }
              const links = linkUnit(c, V.s, r.cell ? [r.cell] : [], V.m);
              return links.length ? { ...base, links } : base;
            }),
          }
        : {}),
      ...(s.table ? { table: { ...s.table, headers: s.table.headers.map((h, hi) => plain(s.key, `table header ${hi}`, h)), rows: s.table.rows.map((row, ri) => row.map((cell, ci) => plain(s.key, `table ${ri} cell ${ci}`, cell))) } } : {}),
      ...(s.viz
        ? {
            viz: {
              ...s.viz,
              title: plain(s.key, "viz title", s.viz.title),
              ...(s.viz.subtitle !== undefined ? { subtitle: plain(s.key, "viz subtitle", s.viz.subtitle) } : {}),
              ...(s.viz.hlineLabel !== undefined ? { hlineLabel: plain(s.key, "viz hline label", s.viz.hlineLabel) } : {}),
              ...(s.viz.vlineLabel !== undefined ? { vlineLabel: plain(s.key, "viz vline label", s.viz.vlineLabel) } : {}),
              ...(s.viz.diagLabel !== undefined ? { diagLabel: plain(s.key, "viz diag label", s.viz.diagLabel) } : {}),
              ...(s.viz.clusterNote !== undefined ? { clusterNote: plain(s.key, "viz cluster note", s.viz.clusterNote) } : {}),
              ...(s.viz.noteLines ? { noteLines: s.viz.noteLines.map((x, i) => plain(s.key, `viz note line ${i}`, x)) } : {}),
              ...(s.viz.legend ? { legend: s.viz.legend.map((x, i) => plain(s.key, `viz legend ${i}`, x)) as [string, string] } : {}),
              items: s.viz.items.map((it, ii) => ({
                ...it,
                label: plain(s.key, `viz item ${ii} label`, it.label),
                ...(it.who !== undefined ? { who: plain(s.key, `viz item ${ii} who`, it.who) } : {}),
                ...(it.value !== undefined ? { value: plain(s.key, `viz item ${ii} value`, it.value) } : {}),
                ...(it.bValue !== undefined ? { bValue: plain(s.key, `viz item ${ii} bValue`, it.bValue) } : {}),
                ...(it.note !== undefined ? { note: plain(s.key, `viz item ${ii} note`, it.note) } : {}),
              })),
            },
          }
        : {}),
    })),
  };
}

/** A Map-cell answer card as served: plain text, and each number's fact id under `facts` ("headline", "rows.<i>") -
 * logged with the frame "card" so the harness recomputes every card number too. */
function finishCard(card: AnswerCard, c: Ctx, id: string): AnswerCard {
  const facts: Record<string, StmtNums> = {};
  const fin = (field: string, t: string) => {
    const tr = fieldFigs(c, "now_what", `card ${id}`, field, t);
    const nums: StmtNums = tr.m.map((x) => [x.at, x.len, c.figs.list[x.i].ref]);
    if (nums.length) facts[field] = nums;
    return tr.s;
  };
  const rows = card.rows.map((r, i) => ({ ...r, label: fin(`rows.${i}.label`, r.label), value: fin(`rows.${i}`, r.value) }));
  const out: AnswerCard = { ...card, crumb: fin("crumb", card.crumb), headline: fin("headline", card.headline), rows };
  return Object.keys(facts).length ? { ...out, facts } : out;
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
const BRIEF_VERSION = "bf52"; // bf52 (2026-11-18, the floor rulings): a named winning or losing argument is one not seldom raised whenever one passes (a seldom lead says so); the two-sided read floor is the one lift rule's; reads am84 / bs30. // bf51 (2026-11-17, fact layer step 6): the three sentences quoting Overview worry findings link to the customers' worry card (bs29); names resolve the same way whatever order they are met in (rs4). // bf50 (2026-11-17, fact layer step 5, part 2): the Brief is statements over the run's facts - every number printed (sentences, tables, charts, competitor columns, answer cards) is a fact with its id, every link a lookup from that id to a card location that draws the same fact (no matching; brief_links.ts deleted), every name and list a member of a selection with its id (leader, converts_better, visibility_brands, price_worries, the cards' own lists); the quoted Overview findings and Map claims carry their statement facts; the old-view fallbacks (legacyFig, legacyV, brief_legacy_inputs.ts) are gone - a rival whose card carries no condition rows has no conditions section; ruling 11 (one "converts": the visibility view's level line, the diagnosis too); "when it picks <leader>" reads the leader's own card ("X and Y come up more than when it picks Z"); a buying situation's leader is the leader selection (a brand with picks there); the brand, assistants and condition answer cards are retired (pins only on numberless units, Map-cell cards with facts); a never-recommended brand reads "No answer recommends X"; the chart's "visible" line says "named in over half". // bf49 (2026-11-17, fact layer step 5, part 1): the Brief quotes the Overview's findings and the Map's claims, which are now statements over the run's facts (rulings 7, 2, 3, 8, 10 move their numbers and wording); its condition paragraph and condition card read the run-wide rollup from brief_legacy_inputs.ts (part 2 moves them). // bf48 (2026-11-17, fact layer step 4): the What to buy and switching cards are built from the fact layer, so every figure the Brief prints from them moves with rulings 7, 8, 12, 14, 15 and the ratified competitor group (the average competitor is every listed rival pooled); the commit-rate note row links to its card stat by id. // bf47 (2026-11-17): every name and list the Brief states that a card shows is read from that card (fixed situations and who takes the picks there, the conditions that send buyers away and where, the Value product, the rival named most, the topic in "Of the points it raises most"); the "sends buyers away" sentences in the SWOT and The diagnosis say "When buyers ask what to buy" (they read the What to buy card), and the SWOT skips a condition it already lists as a fixed situation. // bf46 (2026-11-17, Tyler): which topics are on the AI's "what to look for" list is the What to look for card's own list (PositionPanel.checklist) - "not among the five", "It leads instead with ..."; on a rival's Brief a buying situation where the tracker is picked too rarely to compare states the tracker's own share there ("<tracker> takes N% of the picks here" / "is never the pick here") in place of the method note. // bf45 (2026-11-17, Tyler): a brand the tracker asks about as a class (its "a <brand> card" matchup) reads that matchup card on its own Brief - a scoreboard row, a Now what finding and a diagnosis section, as a named rival's Brief has. // bf44 (2026-11-17, stat ids stage 5): condition and argument figures are printed, linked and decided from the cards' own rows (condition rows, What the answer weighs); a rival-subject Brief reads its card inside the What to buy cell, which sets the rival against the tracker (it had compared the rival with every other brand), so its argument sentences and By buying situation "why" lines change. // bf43 (2026-11-17): The diagnosis words the sent-away condition its own way ("The AI most often sends away buyers who say ...") so it never repeats Now what's sentence. // bf42 (2026-11-17, stat ids stage 4): verdict figures - Value, both kinds of worry, customers looking around, rivals' customers switching, direct matchups, the scoreboard and funnel-table rows about the brand's own questions - are printed, linked and decided from the cards' stats; text unchanged. // bf41 (2026-11-17, stat ids stage 3): every DECISION about a funnel figure (thresholds, which sentence, sort orders, nearest / furthest situation, quadrants, never / every) reads the card stat the sentence prints - the brand summary's funnel fields are no longer reachable from the Brief; a tie for a buying situation's leader falls to the overall pick order when the card does not show both brands' named rate; a figure a card shows as "<1%" prints as "<1%". // bf40 (2026-11-17): "every pick" and "every problem question" at 100% (Sephora's Brief said "100% of the picks"). // bf39 (2026-11-17): a rival's picked-of-all-answers figure is read from its By rival page's new row (rival-subject Briefs, and the most-picked column of the scoreboard and funnel tables). // bf38 (2026-11-17, stat ids stages 1-2): every funnel figure (named, recommended, conversion, share of picks, picked, the commit rate, the average and most-picked competitor, each rival, each buying situation) is printed from a card's own stat (stat_registry.ts) and its link is that stat's location - no matching; text unchanged. // bf37 (2026-11-17, Tyler: "yes add it"): the commit rate links to the What to buy card's new line for any subject; the funnel's pick reading says "The AI commits to one <product> in only N% of answers" (the card's words). // bf36 (2026-11-17): the away condition has one name - the theme's when themes exist (finding, SWOT, diagnosis threat), never a member wording; its share is quoted only from a row naming that condition with the same destination the sentence names (What to buy first, else the head-to-head against that same rival, else no share), as "- in N% of the answers when buyers ask what to buy". // bf35 (2026-11-17, Tyler: close every gap a Brief edit can close): the visibility reading names an outlier brand only when its two figures link to a card (the table and chart keep the bf34 fold); the pick-concentration findings keep only card figures (a buyer's share of the picks against all buyers) and the one-question finding is not cited; an AI company's share of a rival's picks is cited only where a card shows it and never with the share of questions it answers; "name nowhere to go" is not cited; a move quotes a Map claim only as far as its numbers are on a card (headline missing: the claim is dropped); the problem-question comparison sets the buyer against the all-buyers card (no table link); a rival's picked-of-all-answers rate is quoted only where a card shows it; condition shares link to their own row (condition labels are link terms); the away-condition finding reads "Buyers who say ... are most often sent away, to ..." with the share a card row shows (What to buy, else the head-to-head that states it most), and the lost-matchup exception names its matchup with that head-to-head card's own share (no pooled shares); numbers read their own clause (semicolons bound both sides) and the words after them for what they measure. // bf34 (2026-11-17, Tyler: the Brief and the cards read the same figure): Value doubts quote the Value card ("points the buyer to a rival instead in X% of answers and to only <brand>'s own cheaper option in Y%", shares of all its answers); an argument is cited only when the What to buy card shows it in that side's top three, with the card's figures (the matchups won-vs-lost argument finding is not cited - no card sets it out); the conditions paragraph reads the What to buy card's own rows and shares; the away-condition finding's share is the card's (its cell's away row); one worry is set against the all-worries card's figure; a buyer's figure against the other buying situations opens a Data page table (BriefLink dest "table"); "Its picks come X% from ..." and "recommended in N% - M% of the answers that name it" are gone; numbers link before the answer-card pins are pruned. // bf33 (2026-11-17): every number carries its link (BriefPara/BriefRow.links), resolved at compose time against the index of what each card shows (panel_index.ts, brief_links.ts) - the card that shows it beside its subject, with the one interaction that shows it, else the Brief's own answer card; a rival card's onward link names the rival (it passed the dictionary key). // bf32 (2026-11-17): the scoreboard's average-competitor share of picks and picked figures are the What to buy card's own. // bf31 (2026-11-17): the diagnosis threat section is about the rival its heading names (what sends buyers to it, the widest gap), then "Others who take buyers"; a rival one AI company carries is a threat there, only at the detector bar and 1.5x the questions it answers; no "thinner than it looks"; customers looking around read stay / leave only when it says something; conditions read "Buyers who say ... are most often sent away"; the untaught argument line is plain; fixed-situation moves name the situation; every row type has a place name; a bare fact-check move on a non-contest row is dropped. // bf30 (2026-11-17): a move taken from a finding keeps the object after its colon ("build on the exception - aim at the buyers ...") in the SWOT, diagnosis and By buying situation actions. // bf29 (2026-11-16, Tyler's rulings): "The diagnosis" frame after Now what? (conversion, price, the winning argument, the threat, where to act - its own templates); TOWS and Situation - complication - resolution retired (frames, pairing helpers, the SWOT items' TOWS phrases, the pyramid); moves that share an action are one move naming every place (no back-reference stubs) in every frame; the SWOT fills each quadrant by the kind of fact, leads every item, keeps one fact in one quadrant and adds "What to do"; the funnel's stages take the scoreboard's two-table layout (competitorColumns, one source) and "Customers with a worry told to stay"; Visibility vs conversion reads conversion as recommendations that end as the pick (a level line for the charted brands together), drops class brands, folds rarely named or picked brands into one note and one table line, defines the quadrants under the chart and closes on a so-what; By buying situation sorts nearest first, says why from each buyer's own answers (the map's roomLift), states all three Value sides and closes on nearest / furthest and one move; the Brief-style insight bodies state shares in plain words. // bf28 (2026-11-16): the scoreboard is two tables on the tracker's own Brief - four rows against the average and the most-picked competitor, then the rows about the brand's own questions; the commit rate is a sentence. // bf27 (2026-11-16): the Now what scoreboard carries the average competitor beside the subject's named, recommended, share of picks and picked rows (the competitors the what-to-buy card lists; class brands left out). // bf26 (2026-11-16): one voice - the subject in the third person everywhere (the insights re-run in the Brief's style, the moves' third-person form, the map's levers and claims voiced), buyers as words, never / every at the extremes, the cards' vocabulary, a finding's move on its cell, no move sentence twice in a frame. // bf25 (2026-11-13): the conditions line reads "rarely names one winner for every buyer" (was "a rule, not a winner"). // bf24 (2026-11-13): themed conditions name one destination only when it takes half their answers; the fixed-situation line leads with the finding wording.

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
  const cacheOn = rev !== null && !viewCacheOff();
  if (cacheOn) {
    const raw = await store.cacheGet(key, VIEW_CACHE_MS);
    if (raw) return JSON.parse(raw) as BriefView;
  }
  const data = await loadViewData(run, project, { setupDecision: true, judge: true });
  if (!data) return null;
  data.revision = rev;
  const view = await computeBrief(data, r);
  if (cacheOn && !data.judgeIncomplete) {
    await store.cacheSet(key, JSON.stringify(view), { brand: project.brand, category: project.category, projectId: project.id });
    await store.cachePurge(prefix, base);
  }
  return view;
}
