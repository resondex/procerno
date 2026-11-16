import { isDefaultCondition } from "./condition_groups";
import { famTokens } from "./brand_family";
import { pickRefs, spreadRefs, themeAnswerSets, type AnswerRules, type ThemeMap } from "./reason_themes";
import type { RuleGroup } from "./rules_explorer";
import { isWallWording } from "./wall_wording";
import { engineFacets } from "./providers";
import type { Resolver } from "./brand_resolve";
import { cell, type PoolRow, type RateCell } from "./view_data";
import type { ValueFact } from "./value";
import { filterObvious, type Omission, type OmissionList } from "./panel_filter";
import { NOWHERE_CLEAR, AVG_COMP, CLOSE_PTS, GAP_TAKEAWAY, TAKEAWAY_TAGS, TAG_FURTHEST, TAG_GAP_OPENS, agreesTakeaway, alongsideTakeaway, avgTag, caseTakeaway, criticStrengthTakeaway, duelTag, insteadTakeaway, keepTakeaway, leanOf, offersTakeaway, oftenOf, premiseTakeaway, proceedTakeaway, stanceTakeaway, taughtTakeaway, usualDir, duelTone, focusOf, neutralUsualTag, otherTag, rankTag, segTag, toneOfTag, usualTag, usualTone, worthTakeaway, type KN, type Takeaway } from "./panel_tags";
import { ROW_NAME } from "./question_names";
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
  commitsDetail,
  ROUTED_TEXT,
  routedDetail,
  ANYBRAND_TEXT,
  anyBrandDetail,
  NAMEDWHEN_TEXT,
  namedWhenDetail,
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
 * The per-question-type panels (am31, PANEL_BUILD_SPEC sections 2-4, E7):
 * one PositionPanel per map cell of the eleven panel kinds, built from the
 * cell's own answers with zero model calls. Every number is a share of the
 * cell's answers (conditions included - ruling 4: distinct answers stating
 * a row over ALL the cell's answers), carries up to PANEL_REFS example
 * answers that show the fact (none at 0%), and keeps its counts in the tip.
 * Tags compare a step with the row's All cell ("your usual"), with the
 * competitors (rank) or with one rival (duel) - panel_tags.ts.
 *
 * The map (analysis_map.ts) hands each panel cell a PanelCellInput during its
 * cell loop and calls buildPanels once after it; nothing here reads the
 * store or any model, and no existing Position field is touched.
 */

export const PANEL_REFS = 3;
export const PANEL_MIN = 20;
export const ROW_MIN = 3;
export const PICKED_MIN = 5;
export const COMP_TOP = 5;
export const GAP_MIN = 0.1;
const BRAND_FLOOR = 5;
const ARGS_MIN = 10;
const COND_ROWS = 6;
const ROUTE_MIN_SHARE = 0.15;
const ROUTE_MIN = 2;
const ROUTE_TOP = 3;
const CASE_MIN = 10;

/* ------------------------------- inputs ------------------------------- */

/** One answer's statement of one condition row. */
export interface CondAnswer {
  said: string;
  model: string;
  /** Active rival brands its rules under the row send the buyer to (away). */
  to: string[];
  /** The products its rules under the row name, as written. */
  cards: string[];
  /** Aligned with cards: the active brand each resolves to (away), else null. */
  cardTo: (string | null)[];
  mixed: number;
}

/** One condition row's source: a run theme, a flat condition group, or an
 * "elsewhere" group beside the themes. ids = distinct answers stating it in the cell. */
export interface CondSrc {
  id: string;
  label: string;
  ids: Set<string>;
  wall: boolean;
  st: Map<string, CondAnswer>;
  /** The same condition stated on the other side too (the both-ways match). */
  both?: { ids: Set<string>; st: Map<string, CondAnswer> };
}

export interface CondSet {
  toward: CondSrc[];
  away: CondSrc[];
  /** Answers in the cell carrying decision rules (0 = the source asks none). */
  bearing: number;
  grouped: boolean;
}

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
  conds: CondSet;
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
  /** The cell's question wordings, indexed for ruling 5. */
  wordings: (cellIntents: Set<string>, extra?: string[]) => { text: string; stems: Map<string, string> };
  scopes: Map<string, string>;
  omissions?: Omission[];
}

/** The themed path's inputs (the run's shared rules capture and theme maps). */
export interface ThemedCondArgs {
  towardPool: RuleGroup[];
  awayPool: RuleGroup[];
  /** The rules explorer's "elsewhere" groups (destinations that are no active brand). */
  elsewherePool: RuleGroup[];
  toward: ThemeMap;
  away: ThemeMap;
  cellAnswers: Map<string, Map<string, Set<string>>>;
  answerRules: AnswerRules;
  sitOf: Map<string, string>;
  cellIntents: Set<string>;
  /** The cell's answers (response ids). */
  inCell: Set<string>;
  /** Both-ways pairs: the toward / away theme they fall in and each side's statements. */
  pairs: { tt: number | null; at: number | null; t: Map<string, CondAnswer>; a: Map<string, CondAnswer> }[];
  bearing: number;
  own: string;
}

const WALL_ROW_MIN = 5;

/** One answer's statements across a row's member groups, merged. */
function statementOf(answerRules: AnswerRules, gids: string[], rid: string): CondAnswer | null {
  let out: CondAnswer | null = null;
  for (const gid of gids) {
    const ar = answerRules.get(gid)?.get(rid);
    if (!ar) continue;
    if (!out) {
      out = { said: ar.said.trim(), model: ar.model, to: [...ar.to], cards: [...(ar.cards ?? [])], cardTo: [...(ar.cardTo ?? [])], mixed: ar.mixed ?? 0 };
      continue;
    }
    for (const t of ar.to) if (!out.to.includes(t)) out.to.push(t);
    (ar.cards ?? []).forEach((c, i) => {
      if (!out!.cards.includes(c)) {
        out!.cards.push(c);
        out!.cardTo.push(ar.cardTo?.[i] ?? null);
      }
    });
    out.mixed = Math.max(out.mixed, ar.mixed ?? 0);
  }
  return out;
}

/** A cell's condition rows in the run's reason themes (answer grain, same
 * attribution as themeTreeAnswers), with the "elsewhere" groups beside the
 * away themes (no active brand to theme them under - owner ruling 6). */
export function themedConds(a: ThemedCondArgs): CondSet {
  const themed = (sets: ReturnType<typeof themeAnswerSets>, side: "toward" | "away"): CondSrc[] =>
    sets.map((t) => {
      const st = new Map<string, CondAnswer>();
      for (const id of t.ids) {
        if (!a.inCell.has(id)) continue;
        const x = statementOf(a.answerRules, t.groupIds, id);
        if (x) st.set(id, x);
      }
      const pair = a.pairs.find((p) => (side === "toward" ? p.tt : p.at) === t.t);
      const other = pair ? (side === "toward" ? pair.a : pair.t) : null;
      return {
        id: `t:${side}:${t.t}`,
        label: t.label,
        ids: new Set(st.keys()),
        wall: side === "away" && t.wall,
        st,
        ...(other ? { both: { ids: new Set(other.keys()), st: other } } : {}),
      };
    });
  const toward = themed(themeAnswerSets(a.towardPool, a.toward, a.cellAnswers, a.sitOf, a.cellIntents), "toward");
  const away = themed(themeAnswerSets(a.awayPool, a.away, a.cellAnswers, a.sitOf, a.cellIntents, undefined, a.own), "away");
  for (const g of a.elsewherePool) {
    const per = a.cellAnswers.get(g.id);
    if (!per) continue;
    const st = new Map<string, CondAnswer>();
    for (const [c, set] of per) {
      if (!a.cellIntents.has(c)) continue;
      for (const id of set) {
        if (!a.inCell.has(id) || st.has(id)) continue;
        const x = statementOf(a.answerRules, [g.id], id);
        if (x) st.set(id, x);
      }
    }
    if (!st.size) continue;
    away.push({ id: `e:${g.id}`, label: g.label, ids: new Set(st.keys()), wall: st.size >= WALL_ROW_MIN && isWallWording([g.label], a.own), st });
  }
  return { toward, away, bearing: a.bearing, grouped: true };
}

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

/** Whether any confirmed Value line names a product of the brand beyond the bare brand. */
function hasLadder(inputs: Map<string, PanelCellInput>, h: PanelHelpers): boolean {
  const c0: Ctx = { h, inputs, ladder: true };
  return [...inputs.values()].some((x) => x.kind === "value" && !!x.line && productLabel(x.line, h.brand, c0) !== null);
}

/** A codebook name as shown (its scope sentence's capitals kept). */
const cname = (code: string, h: PanelHelpers) => codeName(code, h.scopes.get(code));
/** A codebook name as a row label (sentence case). */
const clabel = (code: string, h: PanelHelpers) => upperFirst(cname(code, h));

/** The row's All cell (same band and row, key "all", pooled), when this cell is a split sibling. */
function usualOf(inp: PanelCellInput, inputs: Map<string, PanelCellInput>): PanelCellInput | undefined {
  if (inp.pooled) return undefined;
  const [band, row] = inp.id.split(":");
  const u = inputs.get(`${band}:${row}:all`);
  return u && u.pooled ? u : undefined;
}

/** Sibling split cells of a row (never its All cell). */
function siblingsOf(inp: PanelCellInput, inputs: Map<string, PanelCellInput>): PanelCellInput[] {
  const [band, row] = inp.id.split(":");
  return [...inputs.values()].filter((x) => !x.pooled && x.id.startsWith(`${band}:${row}:`));
}

export function buildPanels(inputs: Map<string, PanelCellInput>, h: PanelHelpers): Map<string, PositionPanel> {
  const ctx: Ctx = { h, inputs, ladder: hasLadder(inputs, h) };
  const panels = new Map<string, PositionPanel>();
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
    if (!p?.rivals?.length || !(inp.kind === "buy" || inp.kind === "switching")) continue;
    const sibs = siblingsOf(inp, inputs);
    if (sibs.length < 2) continue;
    for (const r of p.rivals) {
      if (!r.full) continue;
      const key = h.resolve(r.name).key;
      r.byCell = sibs.map((s) => {
        const split = h.brandSplit(s.rows);
        const them = split.list.find((b) => b.key === key)?.rows ?? [];
        const mine = split.list.find((b) => b.key === h.targetKey)?.rows ?? [];
        return {
          cellId: s.id,
          label: s.label,
          rival: num(them.length, split.n, "picks", refsOf(them, (x) => h.quoteOf(x) || x.code.top_pick || r.name)),
          you: num(mine.length, split.n, "picks", refsOf(mine, (x) => h.quoteOf(x) || x.code.top_pick || h.brand)),
        };
      });
    }
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

function buildPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel | undefined {
  switch (inp.kind) {
    case "buy":
    case "switching":
      return pickPanel(inp, ctx);
    case "h2h":
      return h2hPanel(inp, ctx);
    case "buyer_worry":
    case "customer_worry":
      return worryPanel(inp, ctx);
    case "looking_around":
      return holdPanel(inp, ctx);
    case "value":
      return valuePanel(inp, ctx);
    case "problem":
      return problemPanel(inp, ctx);
    case "criteria":
      return criteriaPanel(inp, ctx);
    case "expansion":
      return expansionPanel(inp, ctx);
    case "business_case":
      return casePanel(inp, ctx);
    case "popular":
      return popularPanel(inp, ctx);
    case "learning":
      return learningPanel(inp, ctx);
    case "alongside":
      return alongsidePanel(inp, ctx);
    case "critic":
      return criticPanel(inp, ctx);
  }
}

/* ------------------------------ shared pieces ------------------------------ */

/** A brand's funnel inside a set of answers (brandRead's definitions). */
function funnelOf(rows: PoolRow[], key: string, h: PanelHelpers) {
  const surf = (r: PoolRow, rec: boolean) => (r.code.mentions ?? []).find((m) => (!rec || m.framing === "recommended") && h.resolve(m.brand).key === key)?.brand;
  const picks = (r: PoolRow) => h.pickOf(r).key === key;
  const named = rows.filter((r) => surf(r, false) || picks(r));
  const rec = rows.filter((r) => surf(r, true) || picks(r));
  const picked = rows.filter(picks);
  return { named, rec, picked, surf };
}

/** The three funnel numbers of one brand. */
function funnelNums(rows: PoolRow[], key: string, name: string, h: PanelHelpers) {
  const f = funnelOf(rows, key, h);
  const all = rows.length;
  return {
    f,
    named: num(f.named.length, all, "answers", refsOf(f.named, (r) => f.surf(r, false) ?? r.code.top_pick ?? name)),
    recommended: num(f.rec.length, all, "answers", refsOf(f.rec, (r) => f.surf(r, true) ?? r.code.top_pick ?? name)),
    converts: num(f.picked.length, f.rec.length, "recommending answers", refsOf(f.picked, (r) => h.quoteOf(r) || r.code.top_pick || name)),
  };
}

/** am37: you are behind on the picks when another brand takes more of them than you. */
function behindOnPicks(split: { list: { key: string; rows: PoolRow[] }[] }, h: PanelHelpers): boolean {
  const mine = split.list.find((b) => b.key === h.targetKey)?.rows.length ?? 0;
  return split.list.some((b) => b.key !== h.targetKey && b.rows.length > mine);
}

/** An answer's verdict quote, else a mention of the brand, else the brand. */
const verdictFind = (r: PoolRow, h: PanelHelpers) =>
  (r.code.quote ?? "").trim() || (r.code.premise_quote ?? "").trim() || (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === h.targetKey)?.brand || h.brand;

function seg(key: string, label: string, tone: PanelSegment["tone"], hit: PoolRow[], n: number, h: PanelHelpers, unit = "answers", find?: (r: PoolRow) => string): PanelSegment {
  return { key, label, tone, num: num(hit.length, n, unit, refsOf(hit, find ?? ((r) => verdictFind(r, h)))) };
}

/** A topic belongs to a side's column only when its share there is this far above the other side's. */
const WEIGHS_GAP = 0.05;

/** am38: one side of "What the answer weighs" - its answers, the words for it, and the topic to rank first. */
interface WeighSide {
  title?: string;
  /** "say worth it", "pick you" - the too-few note's verb phrase. */
  say: string;
  tone: PanelTone;
  rows: PoolRow[];
  /** A topic (code) shown first when it clears the row floor (the side's top-lift topic). */
  lead?: string;
  /** The tip's unit when it is not "answers that <say>" (the unsided version: "answers"). */
  unit?: string;
}

/** "What the answer weighs", sized (am38): per side, the top `top` topics by
 * that side's share, ruling 5 filtered against the whole cell, rows of 3+
 * answers only; a side with fewer than ARGS_MIN answers carrying topics gets
 * a one-line note. Undefined when no side has a row. */
function weighsCols(inp: PanelCellInput, ctx: Ctx, sides: WeighSide[], sub: string, opts: { top?: number; list?: OmissionList; omit?: boolean } = {}): PanelWeighs | undefined {
  const { h } = ctx;
  const top = opts.top ?? 3;
  const list = opts.list ?? "weighs";
  // The ruling-5 share is of ALL the cell's answers, whichever side a list is for.
  const cellCount = new Map<string, number>();
  for (const r of inp.rows) for (const c of new Set(r.code.reasons ?? [])) cellCount.set(c, (cellCount.get(c) ?? 0) + 1);
  const wording = h.wordings(inp.cellIntents);
  let any = false;
  // Two sides, both sized: a column lists the topics that come up MORE on its side than the other
  // (a topic in nearly every answer on both sides says nothing about either), biggest gap first to
  // choose them, then largest share first to draw them.
  const sideShares = sides.map((sd) => {
    const withR = sd.rows.filter((r) => r.code.reasons !== null);
    const m = new Map<string, number>();
    for (const r of withR) for (const c of new Set(r.code.reasons!)) m.set(c, (m.get(c) ?? 0) + 1);
    return { n: withR.length, m };
  });
  const versus = sides.length === 2 && sideShares.every((x) => x.n >= ARGS_MIN);
  const columns: PanelWeighs["columns"] = sides.map((sd, si) => {
    const withR = sd.rows.filter((r) => r.code.reasons !== null);
    const col = { ...(sd.title ? { title: sd.title } : {}), tone: sd.tone };
    if (withR.length < ARGS_MIN) return { ...col, rows: [], note: weighsFewNote(sd.say) };
    const counts = sideShares[si].m;
    const other = versus ? sideShares[1 - si] : null;
    const gap = (code: string, k: number) => (other ? k / withR.length - (other.m.get(code) ?? 0) / other.n : 0);
    const ranked = [...counts.entries()]
      .filter(([code, k]) => k >= ROW_MIN && (!other || gap(code, k) >= WEIGHS_GAP))
      .sort((a, b) => (other ? gap(b[0], b[1]) - gap(a[0], a[1]) : a[0] === sd.lead ? -1 : b[0] === sd.lead ? 1 : 0) || b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, k]) => ({ code, k, share: (cellCount.get(code) ?? k) / Math.max(1, inp.rows.length) }));
    const kept = filterObvious(ranked, inp.id, list, wording, h.scopes, h.category, opts.omit === false ? undefined : h.omissions).slice(0, top);
    if (other) kept.sort((a, b) => b.k - a.k || a.code.localeCompare(b.code));
    if (!kept.length) return { ...col, rows: [], note: WEIGHS_NONE };
    any = true;
    return {
      ...col,
      rows: kept.map((x) => ({ name: clabel(x.code, h), num: num(x.k, sd.rows.length, sd.unit ?? `answers that ${sd.say}`, refsOf(withR.filter((r) => r.code.reasons!.includes(x.code)), () => x.code)) })),
    };
  });
  if (!any) return undefined;
  return { title: WEIGHS_TITLE, sub: versus ? WEIGHS_SUB_VERSUS : sub, columns };
}

/** "What the answer weighs" over every answer (top 3, ruling 5 filtered), one unsided column. */
function weighsAll(inp: PanelCellInput, ctx: Ctx, list: OmissionList = "weighs", top = 3): PanelWeighs | undefined {
  return weighsCols(inp, ctx, [{ say: "come up here", unit: "answers", tone: "neutral", rows: inp.rows }], WEIGHS_SUB_ALL, { top, list });
}

/** Two sides, each led by the cell's top lift that way (the positive lift on
 * the favourable side, the negative on the other); no lift either way, or too
 * few answers on both sides, falls back to the unsided version. */
function weighsSides(inp: PanelCellInput, ctx: Ctx, fav: Omit<WeighSide, "tone" | "lead">, unfav: Omit<WeighSide, "tone" | "lead">): PanelWeighs | undefined {
  const pos = inp.lifts.filter((l) => l.value > 0).sort((a, b) => b.value - a.value)[0];
  const neg = inp.lifts.filter((l) => l.value < 0).sort((a, b) => a.value - b.value)[0];
  const enough = (rs: PoolRow[]) => rs.filter((r) => r.code.reasons !== null).length >= ARGS_MIN;
  if ((!pos && !neg) || (!enough(fav.rows) && !enough(unfav.rows))) return weighsAll(inp, ctx);
  return (
    weighsCols(inp, ctx, [
      { ...fav, tone: "good", ...(pos ? { lead: pos.label } : {}) },
      { ...unfav, tone: "bad", ...(neg ? { lead: neg.label } : {}) },
    ], WEIGHS_SUB_SIDES) ?? weighsAll(inp, ctx)
  );
}

/** A product name as written, cleaned for display: no trade marks, no "from <maker>" tail. */
const cleanProduct = (x: string) => x.replace(/[®™]/g, "").replace(/\s+from\s+.+$/i, "").replace(/\s+/g, " ").trim();

/** The bucket for a pick that names no product of the brand. */
const noneName = (ctx: Ctx) => (ctx.ladder ? `No specific ${ctx.h.noun} named` : "No specific product named");

/** Products as written, grouped on their distinctive words (case, trade
 * marks, "from <maker>", the category's own nouns and small words dropped),
 * a name whose words sit inside exactly one larger name joining it ("Savor" ->
 * "Savor Cash Rewards"); top `k` with their share of `rows`, shown as the most
 * written form. */
function productSplit(rows: PoolRow[], nameOf: (r: PoolRow) => string, k: number, unit: string, nounTokens: Set<string> = new Set(), brandToks: Set<string> = new Set()): { name: string; num: PanelNum }[] {
  type G = { forms: Map<string, number>; rows: PoolRow[]; toks: Set<string> };
  const by = new Map<string, G>();
  for (const r of rows) {
    const raw = nameOf(r);
    const none = /^No specific /.test(raw);
    const name = none ? raw : cleanProduct(raw) || raw;
    const toks = famTokens(name);
    // The maker's own name words never tell two of its products apart ("Amex Platinum" = "Platinum Card").
    const kept = toks.filter((t) => !nounTokens.has(t) && !PRODUCT_STOP.has(t) && !brandToks.has(t));
    const key = none ? "\u0000none" : kept.join(" ") || toks.join(" ") || name.toLowerCase();
    const t = by.get(key) ?? { forms: new Map<string, number>(), rows: [], toks: new Set(none ? [] : kept) };
    t.rows.push(r);
    t.forms.set(name, (t.forms.get(name) ?? 0) + 1);
    by.set(key, t);
  }
  const keys = [...by.keys()].filter((x) => !x.startsWith("\u0000")).sort((a, b) => by.get(a)!.toks.size - by.get(b)!.toks.size);
  for (const key of keys) {
    const g = by.get(key)!;
    if (!g.toks.size) continue;
    const sup = [...by.entries()].filter(([k2, g2]) => k2 !== key && !k2.startsWith("\u0000") && g2.toks.size > g.toks.size && [...g.toks].every((x) => g2.toks.has(x)));
    if (sup.length !== 1) continue;
    const into = sup[0][1];
    for (const [f, n] of g.forms) into.forms.set(f, (into.forms.get(f) ?? 0) + n);
    into.rows.push(...g.rows);
    by.delete(key);
  }
  return [...by.values()]
    .map((g) => ({ name: [...g.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0], rows: g.rows }))
    .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name))
    .slice(0, k)
    .map((g) => ({ name: g.name, num: num(g.rows.length, rows.length, unit, refsOf(g.rows, (r) => r.code.top_pick || g.name)) }));
}

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

/** am43: is a name one of the brand's PRODUCTS, or something the brand also runs (a rewards programme, a lounge,
 * a feature)? Read off the run: in the answers that state conditions, a product is what the AI tells some buyer to
 * choose (the pick, or the choice of a rule); a programme is named and almost never chosen. Per brand and name. */
const PRODUCT_MIN_SHARE = 0.05;
const PRODUCT_MIN_CHOSEN = 2;
/** A rival name that is only ever where a verdict sends the buyer needs this share of the answers naming it. */
const PRODUCT_SENT_SHARE = 0.25;
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
  for (const inp of ctx.inputs.values())
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
  return idx;
}
function isPickedProduct(rest: string, brandName: string, own: Set<string>, ctx: Ctx): boolean {
  const key = brandName === ctx.h.brand ? ctx.h.targetKey : ctx.h.resolve(brandName).key;
  if (!key) return true;
  const nouns = nounToks(ctx);
  const toks = [...new Set(famTokens(rest).filter((t) => !own.has(t) && !nouns.has(t)))].sort();
  if (!toks.length) return true;
  const t = productIndex(ctx).get(`${key}|${toks.join(" ")}`);
  // Never seen in an answer that states conditions: nothing to judge it by, so it stays.
  if (!t || t.named < 5) return true;
  const ok = (t.chosen >= PRODUCT_MIN_CHOSEN && t.chosen / t.named >= PRODUCT_MIN_SHARE) || (t.sent >= PRODUCT_MIN_CHOSEN && t.sent / t.named >= PRODUCT_SENT_SHARE);
  return ok;
}

/** A product as written with its brand's leading name words dropped
 * ("<Brand> Gold Card" -> "Gold Card"); null when nothing but the brand is left. */
function productLabel(surface0: string, brandName: string, ctx: Ctx): string | null {
  const own = nameTokens(brandName, ctx);
  const surface = cleanProduct(surface0) || surface0.trim();
  const words = surface.trim().split(/\s+/);
  let i = 0;
  while (i < words.length && famTokens(words[i]).length > 0 && famTokens(words[i]).every((t) => own.has(t))) i++;
  const rest = words.slice(i).join(" ").replace(/^[^A-Za-z0-9]+/, "").trim();
  if (!rest || !famTokens(rest).some((t) => !own.has(t))) return null;
  // am43: a name counts as one of the brand's products only when some answer in the run picks it (or it is a
  // confirmed Value line) - a rewards programme, a feature or a service the brand also runs is named but never picked.
  if (!isPickedProduct(rest, brandName, own, ctx)) return null;
  // A product whose own name runs on from the brand in lower case ("<Brand> it ...") keeps the brand.
  if (i > 0 && /^[a-z]/.test(rest)) return surface.trim();
  // am37: a bare fragment (a model number, one word) keeps the name it was written with ("11 Pro" -> "Pixel 11 Pro").
  if (i > 0 && (/^\d/.test(rest) || rest.split(/\s+/).length === 1)) return surface.trim();
  return rest;
}

/** A name that resolves to the brand and names nothing beyond it. */
function isBareBrand(name: string, ctx: Ctx): boolean {
  return ctx.h.resolve(name).key === ctx.h.targetKey && productLabel(name, ctx.h.brand, ctx) === null;
}

/** A written pick: the product as written (its brand's name words dropped),
 * or "No <noun> named" for the bare brand. */
function pickedProduct(r: PoolRow, ctx: Ctx, own: boolean): string {
  const tp = (r.code.top_pick ?? "").trim();
  if (!tp) return noneName(ctx);
  const brandName = own ? ctx.h.brand : ctx.h.resolve(tp).name;
  return productLabel(tp, brandName, ctx) ?? noneName(ctx);
}

/** The category's own nouns, singular and plural ("card", "cards"). */
const nounToks = (ctx: Ctx) => new Set([...famTokens(ctx.h.noun), ...famTokens(ctx.h.plural)]);

const splitLine = (items: { name: string; num: PanelNum }[]): PanelText =>
  join(...items.flatMap((x, i) => [i > 0 ? " · " : null, `${x.name} `, N(x.num)]));

/* ---------------------------- condition rows ---------------------------- */

interface CondOpts {
  all: number;
  side: "toward" | "away";
  pickKind: boolean;
  skip: Set<string>;
  rowOf: Map<string, PoolRow>;
  /** Count only these answers (h2h exception rows: answers picking the rival). */
  keepId?: (id: string) => boolean;
  /** Panel 11: an away row counts only answers sending the buyer to this brand, and names only its products. */
  onlyTo?: string;
  pickedStamp?: string;
  /** The other side's row filter, for the "also said for" share of a both-sides row. */
  otherKeep?: (id: string, st: CondSrc["st"]) => boolean;
  /** Alongside: an away row's destinations are the products its rules name, as written (not active brands). */
  toCards?: boolean;
}

function condRows(srcs: CondSrc[], o: CondOpts, ctx: Ctx): PanelCondition[] {
  const { h } = ctx;
  const out: { size: number; label: string; row: PanelCondition }[] = [];
  const rows = srcs
    .filter((s) => !isDefaultCondition(s.label))
    .map((s) => {
      const ids = new Set([...s.ids].filter((id) => (!o.keepId || o.keepId(id)) && (!o.onlyTo || !!s.st.get(id)?.to.includes(o.onlyTo))));
      return { s, ids };
    })
    .filter((x) => x.ids.size >= ROW_MIN)
    .sort((a, b) => b.ids.size - a.ids.size || a.s.label.localeCompare(b.s.label))
    .slice(0, COND_ROWS);
  for (const { s, ids } of rows) {
    const cands = [...ids].map((id) => {
      const a = s.st.get(id)!;
      const cards = o.onlyTo ? a.cards.filter((_, i) => a.cardTo[i] === o.onlyTo) : a.cards;
      return { id, find: a.said, model: a.model, cards, mixed: a.mixed };
    });
    // Toward rows go first and record their examples; an away row never reuses one
    // (am23). An away row whose every answer is already shown toward is left out.
    let refs = pickRefs(cands, s.label, PANEL_REFS, o.side === "away" ? o.skip : undefined);
    if (!refs.length) continue;
    if (o.pickedStamp) refs = refs.map((r) => ({ ...r, picked: o.pickedStamp }));
    if (o.side === "toward") for (const r of refs) o.skip.add(r.responseId);
    const row: PanelCondition = { text: condRowLabel(s.label), share: num(ids.size, o.all, "answers", refs) };
    if (o.side === "away" && s.wall) row.wall = true;
    if (o.side === "toward") {
      const prods = new Map<string, { name: string; ids: string[] }>();
      for (const id of ids)
        for (const c of s.st.get(id)!.cards) {
          const raw = h.productOf(c);
          if (!raw) continue;
          const p = productLabel(raw, h.brand, ctx) ?? raw;
          const t = prods.get(p.toLowerCase()) ?? { name: p, ids: [] };
          if (!t.ids.includes(id)) t.ids.push(id);
          prods.set(p.toLowerCase(), t);
        }
      const top = [...prods.values()].sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name)).slice(0, 2).map((x) => x.name);
      if (top.length) row.products = top;
    } else {
      const by = new Map<string, string[]>();
      let routed = 0;
      const forms = new Map<string, Map<string, number>>();
      for (const id of ids) {
        const to = o.toCards
          ? [
              ...new Set(
                s.st.get(id)!.cards.filter((c) => c.trim()).map((c) => {
                  const k = famTokens(c).join(" ") || c.trim().toLowerCase();
                  const f = forms.get(k) ?? new Map<string, number>();
                  f.set(c.trim(), (f.get(c.trim()) ?? 0) + 1);
                  forms.set(k, f);
                  return k;
                })
              ),
            ]
          : [...new Set(s.st.get(id)!.to)];
        if (!to.length) continue;
        routed++;
        for (const name of to) by.set(name, [...(by.get(name) ?? []), id]);
      }
      const to = [...by.entries()]
        .filter(([, xs]) => xs.length >= ROUTE_MIN && xs.length / routed >= ROUTE_MIN_SHARE)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .slice(0, ROUTE_TOP)
        .map(([name, xs]) => {
          const shown = o.toCards ? [...(forms.get(name)?.entries() ?? [])].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? name : name;
          const cardsOf = (id: string) => (o.toCards ? s.st.get(id)!.cards.filter((c) => (famTokens(c).join(" ") || c.trim().toLowerCase()) === name) : s.st.get(id)!.cards.filter((_, i) => s.st.get(id)!.cardTo[i] === name));
          return {
            name: shown,
            num: num(xs.length, routed, "answers naming a destination", pickRefs(xs.map((id) => ({ id, find: s.st.get(id)!.said, model: s.st.get(id)!.model, cards: cardsOf(id) })), s.label, PANEL_REFS)),
          };
        });
      if (to.length) row.to = to;
    }
    if (o.pickKind && ids.size >= PICKED_MIN) {
      const mine = [...ids].filter((id) => {
        const r = o.rowOf.get(id);
        return r ? h.pickOf(r).key === h.targetKey : false;
      });
      row.youPicked = num(mine.length, ids.size, "answers", pickRefs(mine.map((id) => ({ id, find: s.st.get(id)!.said, model: s.st.get(id)!.model })), s.label, PANEL_REFS));
    }
    if (s.both) {
      // am40: "Also said for <the other side>" is the OTHER side's own share (same filters as its row), so the
      // two sides' figures mirror each other - it was the share saying it for either side, under the other side's name.
      const bst = s.both.st;
      const other = [...s.both.ids].filter((id) => !o.otherKeep || o.otherKeep(id, bst));
      if (other.length) row.both = { either: num(other.length, o.all, "answers", pickRefs(other.map((id) => ({ id, find: bst.get(id)!.said, model: bst.get(id)!.model })), s.label, PANEL_REFS)) };
    }
    out.push({ size: ids.size, label: s.label, row });
  }
  return out.map((x) => x.row);
}

interface CondWords {
  title: string;
  sub: string;
  subComp?: string;
  towardTitle: string;
  awayTitle: string;
  alsoToward: string;
  alsoAway: string;
  toWord: "To" | "Shown";
  towardScope?: "rival_picked";
}

/** am37: a condition label's identity for merging - case, punctuation and the asker's "you" / "they" set aside. */
const condKey = (label: string) => condRowLabel(label).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Generic words that do not change what a condition says ("travel often" = "travel frequently"). */
const COND_SOFT = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "with", "is", "are", "be", "they", "their", "them", "theirs", "often", "frequently", "frequent", "regularly", "regular", "usually", "always", "mostly", "really", "very", "lot", "lots", "much", "many", "more", "most", "heavily", "heavy", "plenty", "want", "wants", "prefer", "prefers", "need", "needs", "like", "likes", "if", "when"]);
/** Content stems of a condition label (first five letters of each word that carries meaning). */
const condCore = (label: string) => [...new Set(condKey(label).split(" ").filter((w) => w && !COND_SOFT.has(w)).map((w) => w.slice(0, 5)))].sort().join(" ");

/** Rows that say the same thing in different case or punctuation are one row. */
function mergeSame(srcs: CondSrc[]): CondSrc[] {
  const out = new Map<string, CondSrc>();
  for (const x of srcs) {
    const k = condKey(x.label);
    const t = out.get(k);
    if (!t) {
      out.set(k, { ...x, ids: new Set(x.ids), st: new Map(x.st) });
      continue;
    }
    for (const id of x.ids) t.ids.add(id);
    for (const [id, a] of x.st) if (!t.st.has(id)) t.st.set(id, a);
    t.wall = t.wall || x.wall;
    if (!t.both && x.both) t.both = x.both;
    if (x.ids.size > t.ids.size) t.label = x.label;
  }
  return [...out.values()];
}

function conditionsOf(inp: PanelCellInput, ctx: Ctx, words: CondWords, opts: { pickKind: boolean; towardKeep?: (id: string) => boolean; pickedStamp?: string; onlyTo?: string; towardRows?: PanelCondition[]; toCards?: boolean; ownSplit?: boolean }): PanelConditions | undefined {
  if (inp.conds.bearing === 0) return undefined;
  const { h } = ctx;
  const rowOf = new Map(inp.rows.map((r) => [r.code.response_id, r]));
  const skip = new Set<string>();
  const all = inp.rows.length;
  let tSrc = mergeSame(inp.conds.toward);
  let aSrc = mergeSame(inp.conds.away);
  // am37 (what to use alongside you): a row whose products are mostly the brand's own sits with "something of yours".
  if (opts.ownSplit) {
    const ownCard = (id: string, c: string) => {
      if (h.resolve(c).key === h.targetKey) return true;
      const k = nameKeyOf(c);
      return (rowOf.get(id)?.code.pairings ?? []).some((p) => p.maker_relation === "own" && nameKeyOf(p.name) === k);
    };
    const mostlyOwn = (x: CondSrc) => {
      let own = 0;
      let named = 0;
      for (const [id, a] of x.st) {
        const cs = a.cards.filter((c) => c.trim());
        if (!cs.length) continue;
        named++;
        if (cs.every((c) => ownCard(id, c))) own++;
      }
      return named > 0 && own * 2 > named;
    };
    const moved = aSrc.filter(mostlyOwn);
    if (moved.length) {
      aSrc = aSrc.filter((x) => !moved.includes(x));
      tSrc = mergeSame([...tSrc, ...moved.map((x) => ({ ...x, wall: false }))]);
    }
  }
  // am37: the same condition on both sides under near-identical names is one reason with the both-sides mark and one label.
  if (!opts.towardRows) {
    const tBy = new Map<string, CondSrc>();
    for (const x of tSrc) if (condCore(x.label)) tBy.set(condCore(x.label), x);
    tSrc = tSrc.map((x) => ({ ...x }));
    const tCopy = new Map(tSrc.map((x) => [condCore(x.label), x]));
    aSrc = aSrc.map((x) => {
      const k = condCore(x.label);
      const t = k ? tBy.get(k) : undefined;
      if (!t) return x;
      const tc = tCopy.get(k)!;
      const label = t.ids.size >= x.ids.size ? t.label : x.label;
      tc.label = label;
      if (!tc.both) tc.both = { ids: x.ids, st: x.st };
      return { ...x, label, ...(x.both ? {} : { both: { ids: t.ids, st: t.st } }) };
    });
  }
  const onlyTo = opts.onlyTo;
  const toward = opts.towardRows ?? condRows(tSrc, { all, side: "toward", pickKind: opts.pickKind, skip, rowOf, keepId: opts.towardKeep, pickedStamp: opts.pickedStamp, ...(onlyTo ? { otherKeep: (id: string, st: CondSrc["st"]) => !!st.get(id)?.to.includes(onlyTo) } : {}) }, ctx);
  if (opts.towardRows) for (const r of opts.towardRows) for (const x of r.share.refs ?? []) skip.add(x.responseId);
  const towardKeep = opts.towardKeep;
  const away = condRows(aSrc, { all, side: "away", pickKind: opts.pickKind, skip, rowOf, onlyTo: opts.onlyTo, toCards: opts.toCards, ...(towardKeep && !opts.towardRows ? { otherKeep: (id: string) => towardKeep(id) } : {}) }, ctx);
  // A reason listed on both sides shows the other side's own row share, exactly.
  {
    const tRow = new Map(toward.map((r) => [condCore(r.text), r]));
    for (const a of away) {
      const t = condCore(a.text) ? tRow.get(condCore(a.text)) : undefined;
      if (!t) continue;
      a.both = { either: t.share };
      // Toward rows handed in from the cell's own panel are shared and keep that panel's figure.
      if (!opts.towardRows) t.both = { either: a.share };
    }
  }
  return {
    ...words,
    grouped: inp.conds.grouped,
    toward,
    away,
    ...(toward.length + away.length === 0 ? { note: NO_CONDITION_ROWS } : {}),
    // am37: one side empty beside a full one says so, never a blank column.
    ...(toward.length === 0 && away.length > 0 ? { towardNote: NO_SIDE_ROWS } : {}),
    ...(away.length === 0 && toward.length > 0 ? { awayNote: NO_SIDE_ROWS } : {}),
  };
}

/** The line in a condition column with no row. */
const NO_SIDE_ROWS = "No condition stated often enough to list.";


/* ------------------------------- the kinds ------------------------------- */

function pickPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const all = inp.rows.length;
  const switching = inp.kind === "switching";
  const generic = switching && inp.key === "generic";
  const rival = inp.rivalName ?? inp.label;
  const split = h.brandSplit(inp.rows);
  const mine = split.list.find((b) => b.key === h.targetKey)?.rows ?? [];
  const share = num(mine.length, split.n, "picks", refsOf(mine, (r) => h.quoteOf(r) || r.code.top_pick || h.brand));
  const you = funnelNums(inp.rows, h.targetKey, h.brand, h);
  // am37: the claim counts the other brands the competitors list shows (never
  // you); unlisted smaller ones make it "most of the rest".
  const listedOthers = split.list.filter((b) => b.key !== h.targetKey && b.rows.length >= BRAND_FLOOR && !(switching && b.key === inp.rivalKey)).slice(0, COMP_TOP);
  const otherCount = listedOthers.length;
  const unlisted = split.list.some((b) => b.key !== h.targetKey && !listedOthers.includes(b));
  const showsList = split.list.filter((b) => b.rows.length >= BRAND_FLOOR).length >= 2;

  let claim: PanelText;
  if (switching) {
    const whose = inp.pooled ? "a rival's customer" : generic ? `a customer of another ${h.noun}` : `${article(rival)} ${rival} customer`;
    claim = join(
      `When ${whose} asks where to move, the AI recommends you in `,
      N(you.recommended),
      " of answers and picks you in ",
      you.f.picked.length === 0 ? "none" : N(num(you.f.picked.length, all, "answers", you.converts.refs)),
      "."
    );
  } else if (split.n < BRAND_FLOOR) {
    claim = join(`The AI commits to one ${h.noun} in `, N(num(split.n, all, "answers", refsOf(inp.rows.filter((r) => h.pickOf(r).status === "active"), (r) => h.quoteOf(r) || r.code.top_pick || h.brand))), " of these answers.");
  } else {
    claim = join(
      inp.pooled ? "Across all buyers you take " : "With this buyer you take ",
      N(share),
      " of the picks.",
      mine.length === split.n
        ? ""
        : showsList && otherCount
          ? ` ${countWord(otherCount)} other ${otherCount === 1 ? "brand takes" : "brands take"} ${unlisted ? "most of " : ""}the rest.`
          : " Other brands take the rest."
    );
  }

  const conditions = conditionsOf(
    inp,
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
    { pickKind: true }
  );
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

  // Competitors: the listed brands (BRAND_FLOOR picks), top COMP_TOP; switching leaves the brand being left out of the bars.
  const clear = split.list.filter((b) => b.rows.length >= BRAND_FLOOR);
  const comp = clear.filter((b) => b.key !== h.targetKey && !(switching && b.key === inp.rivalKey)).slice(0, COMP_TOP);
  const compNums = comp.map((b) => ({ b, f: funnelNums(inp.rows, b.key, b.name, h) }));
  const steps: PanelStep[] = [
    { key: "named", label: "Named", here: you.named, ...(compNums.length ? { rivals: compNums.map((x) => ({ name: x.b.name, num: x.f.named })) } : {}) },
    { key: "recommended", label: "Recommended", here: you.recommended, ...(compNums.length ? { rivals: compNums.map((x) => ({ name: x.b.name, num: x.f.recommended })) } : {}) },
    { key: "converts", label: "Recommendations that end as the pick", here: you.converts, ...(compNums.length ? { rivals: compNums.map((x) => ({ name: x.b.name, num: x.f.converts })) } : {}) },
  ];

  const rivals = (inp.brands ?? []).map((b) => rivalFull(inp, ctx, b, you, conditions));
  const hasRival = new Set(rivals.map((r) => r.name));
  const listed = clear.length >= 2;
  const competitors: PanelBlock | undefined = listed
    ? {
        title: "Who takes the picks",
        sub: `Share of the picks ${switching ? "from these customers" : "here"}. Open a rival to see how it gets them.`,
        rows: [...clear.filter((b) => b.key !== h.targetKey).slice(0, COMP_TOP), { key: h.targetKey, name: h.brand, rows: mine }]
          .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name))
          .map((b): PanelBrandRow => {
            const isYou = b.key === h.targetKey;
            return {
              name: isYou ? h.brand : b.name,
              ...(isYou ? { you: true as const } : {}),
              num: num(b.rows.length, split.n, "picks", refsOf(b.rows, (r) => h.quoteOf(r) || r.code.top_pick || b.name)),
              ...(!isYou && hasRival.has(b.name) ? { open: true as const } : {}),
            };
          }),
      }
    : undefined;

  // Lines.
  const usual = usualOf(inp, ctx.inputs);
  const lines: PanelLine[] = [];
  const linesComp: PanelLine[] = [];
  const shareLine: PanelLine = { label: "Your share of the picks", value: join(N(share), " here") };
  if (usual) {
    const us = h.brandSplit(usual.rows);
    const um = us.list.find((b) => b.key === h.targetKey)?.rows ?? [];
    shareLine.value = join(N(share), " here · ", N(num(um.length, us.n, "picks", refsOf(um, (r) => h.quoteOf(r) || r.code.top_pick || h.brand))), switching ? " across all rivals' customers" : " across all buyers");
  }
  lines.push(shareLine);
  if (mine.length >= 5 && ctx.ladder) {
    const items = productSplit(mine, (r) => pickedProduct(r, ctx, true), 2, "of your picks", nounToks(ctx), nameTokens(h.brand, ctx));
    if (namesAProduct(items)) lines.push({ label: `Which of your ${h.plural} it picks`, value: splitLine(items) });
  }
  const weighs = weighsAll(inp, ctx);
  linesComp.push(shareLine);
  const othersPicked = inp.rows.filter((r) => h.pickOf(r).status === "active" && h.pickOf(r).key !== h.targetKey);
  const negs = inp.lifts.filter((l) => l.value < 0).sort((a, b) => a.value - b.value).slice(0, 2);
  const poss = inp.lifts.filter((l) => l.value > 0).sort((a, b) => b.value - a.value).slice(0, 1);
  // The comparison view: what the answer weighs when it picks you, and when it picks another brand.
  const weighsComp =
    negs.length || poss.length
      ? weighsCols(
          inp,
          ctx,
          [
            { title: "When it picks you", say: "pick you", tone: "good", rows: mine, ...(poss.length ? { lead: poss[0].label } : {}) },
            { title: `When it picks another ${h.noun}`, say: `pick another ${h.noun}`, tone: "bad", rows: othersPicked, ...(negs.length ? { lead: negs[0].label } : {}) },
          ],
          WEIGHS_SUB_SIDES,
          { omit: false }
        ) ?? weighs
      : weighs;

  const hereKey = inp.pooled ? "You" : switching ? (generic ? `You, with customers of another ${h.noun}` : `You, with ${possOf(rival)} customers`) : "You, with this buyer";
  return {
    kind: inp.kind,
    claim,
    ...(lead ? { lead } : {}),
    ...(usual ? { usualCellId: usual.id, usualKey: switching ? "You, across all rivals' customers" : "You, across all buyers" } : {}),
    hereKey,
    stackLabel: behindOnPicks(split, h) ? (switching ? "Where you lose these buyers" : inp.pooled ? "Where you lose buyers" : "Where you lose this buyer") : switching ? "Where you hold these buyers" : inp.pooled ? "Where you hold buyers" : "Where you hold this buyer",
    steps,
    ...(compNums.length ? { compare: true as const, competitorOrder: compNums.map((x) => x.b.name) } : {}),
    ...(competitors ? { competitors } : {}),
    ...(conditions ? { conditions } : {}),
    lines,
    linesComp,
    ...(weighs ? { weighs } : {}),
    ...(weighsComp ? { weighsComp } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
}

function h2hPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const all = inp.rows.length;
  const won = inp.you;
  const lost = inp.them;
  const d = won.length + lost.length;
  const rival = inp.pooled ? "your named rivals" : inp.rivalName ?? inp.label;
  const pf = (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || h.brand;
  const decided = num(d, all, "answers", refsOf([...won, ...lost], pf));
  const wonN = num(won.length, d, "answers that pick one of the two", refsOf(won, pf));
  const lostN = num(lost.length, d, "answers that pick one of the two", refsOf(lost, pf));
  // The all-rivals cell: each rival's share of the answers that pick one of the two (the switch's bars).
  const byRival = inp.pooled
    ? h
        .brandSplit(lost)
        .list.filter((b) => b.key !== h.targetKey && b.rows.length >= 1)
        .slice(0, COMP_TOP)
        .map((b) => ({ name: b.name, num: num(b.rows.length, d, "answers that pick one of the two", refsOf(b.rows, pf)) }))
    : [];
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
            // am37: on the all-rivals cell your share and each rival's are of the same answers, but each rival is asked about only in its own matchup.
            ...(inp.pooled && byRival.length >= 2 ? { note: join("Each share is of all the head-to-head answers that pick one of the two; each rival is asked about only in its own matchup, so yours spans every matchup.") } : {}),
          },
        ]
      : []),
  ];
  let claim: PanelText;
  if (d === 0) claim = join(`Asked to choose between you and ${rival}, the AI picks neither in every answer.`);
  else if (inp.pooled) claim = join("Asked to choose between you and one of your named rivals, the AI picks you in ", N(wonN), " of the answers that pick one of you.");
  else if (won.length === 0 || lost.length === 0) claim = join(`Asked to choose between you and ${rival}, the AI picks ${won.length === 0 ? rival : "you"} every time it picks one of you.`);
  else {
    const leadYou = won.length >= lost.length;
    claim = join(`Asked to choose between you and ${rival}, the AI picks ${leadYou ? "you" : rival} in `, N(leadYou ? wonN : lostN), " of the answers that pick one of you.");
  }
  const exc = inp.exception;
  const rivalKey = inp.rivalKey;
  const conditions = conditionsOf(
    inp,
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
    {
      pickKind: true,
      ...(exc && rivalKey
        ? {
            towardKeep: (id: string) => {
              const r = inp.rows.find((x) => x.code.response_id === id);
              return !!r && h.pickOf(r).key === rivalKey;
            },
            pickedStamp: exc.rival,
          }
        : {}),
    }
  );
  let lead: PanelText | undefined;
  const t = conditions?.toward ?? [];
  const a = conditions?.away ?? [];
  if (exc && t.length) {
    lead = attachedLead("choosing you", t.slice(0, 2), "answers", `Even while picking ${rival}, `);
  } else if (a.length || t.length) {
    lead = join(
      a.length ? attachedLead(inp.pooled ? "choosing the rival" : `choosing ${rival}`, [a[0]], "answers") : null,
      a.length && t.length ? " " : null,
      t.length ? attachedLead("choosing you", [t[0]], "answers") : null
    );
  }
  const lines: PanelLine[] = [];
  if (!inp.pooled && lost.length && ctx.ladder) {
    const items = productSplit(lost, (r) => pickedProduct(r, ctx, false), 2, `picks of ${rival}`, nounToks(ctx), nameTokens(rival, ctx));
    if (namesAProduct(items)) lines.push({ label: `Which ${rival} ${ctx.h.plural} it picks`, value: splitLine(items) });
  }
  const weighs = weighsAll(inp, ctx);
  const usual = usualOf(inp, ctx.inputs);
  return {
    kind: "h2h",
    claim,
    ...(lead ? { lead } : {}),
    ...(usual ? { usualCellId: usual.id, usualKey: "You, across all your head-to-heads" } : {}),
    hereKey: "You",
    stackLabel: "Where it is decided",
    steps,
    ...(byRival.length >= 2 ? { compare: true as const, competitorOrder: byRival.map((x) => x.name) } : {}),
    ...(conditions ? { conditions } : {}),
    lines,
    ...(weighs ? { weighs } : {}),
  };
}

/** The destination brands a doubt answer names (active rivals), per brand. */
function destBlock(rows: PoolRow[], ctx: Ctx, title: string, sub: string, field: (r: PoolRow) => string[] | null): { block?: PanelBlock; comp: { key: string; name: string; rows: PoolRow[] }[] } {
  const { h } = ctx;
  const by = new Map<string, { key: string; name: string; rows: PoolRow[] }>();
  for (const r of rows)
    for (const [k, name] of h.activeDests(field(r))) {
      const t = by.get(k) ?? { key: k, name, rows: [] };
      t.rows.push(r);
      by.set(k, t);
    }
  const comp = [...by.values()].filter((x) => x.rows.length >= ROW_MIN).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)).slice(0, COMP_TOP);
  if (!comp.length) return { comp };
  return {
    comp,
    block: {
      title,
      sub,
      rows: comp.map((c) => ({
        name: c.name,
        num: num(c.rows.length, rows.length, "answers", refsOf(c.rows, (r) => (field(r) ?? []).find((x) => h.resolve(x).key === c.key) ?? c.name)),
        open: true as const,
      })),
    },
  };
}

function worryPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const buyer = inp.kind === "buyer_worry";
  const rows = inp.rows;
  const all = rows.length;
  const judged = rows.filter((r) => r.code.premise_verdict === "confirms" || r.code.premise_verdict === "mixed" || r.code.premise_verdict === "rebuts");
  const conf = judged.filter((r) => r.code.premise_verdict === "confirms");
  const agrees = num(conf.length, judged.length, "answers that judge the worry", refsOf(conf, (r) => (r.code.premise_quote ?? "").trim() || verdictFind(r, h)));
  const segs: PanelSegment[] = buyer
    ? [
        seg("proceed", "go ahead", "you", rows.filter((r) => r.code.proceed_or_avoid === "proceed"), all, h),
        seg("avoid", "steer clear", "away", rows.filter((r) => r.code.proceed_or_avoid === "avoid"), all, h),
        seg("none", "no side", "neutral", rows.filter((r) => r.code.proceed_or_avoid !== "proceed" && r.code.proceed_or_avoid !== "avoid"), all, h),
      ]
    : [
        seg("keep", "stay", "you", rows.filter((r) => r.code.keep_or_leave === "keep"), all, h),
        seg("leave", "leave", "away", rows.filter((r) => r.code.keep_or_leave === "leave"), all, h),
        seg("none", "no side", "neutral", rows.filter((r) => r.code.keep_or_leave !== "keep" && r.code.keep_or_leave !== "leave"), all, h),
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
  const leaveRows = rows.filter((r) => r.code.keep_or_leave === "leave");
  const noDest = leaveRows.filter((r) => h.activeDests(r.code.destinations).size === 0).length;
  const { block, comp } = destBlock(
    rows,
    ctx,
    buyer ? `Which ${h.plural} it names instead` : `Which ${h.plural} it names to move to`,
    `Share of these answers that name it as the alternative. Open a rival to see how it gets its picks.${!buyer && leaveRows.length && noDest > leaveRows.length / 2 ? ` Most answers that say leave name no ${h.noun} at all.` : ""}`,
    (r) => r.code.destinations
  );
  const lines: PanelLine[] = [];
  const favRows = buyer ? rows.filter((r) => r.code.proceed_or_avoid === "proceed") : rows.filter((r) => r.code.keep_or_leave === "keep");
  const unfavRows = buyer
    ? rows.filter((r) => r.code.proceed_or_avoid === "avoid" || (r.code.premise_verdict === "confirms" && r.code.proceed_or_avoid !== "proceed"))
    : leaveRows;
  const weighs = buyer
    ? weighsSides(inp, ctx, { title: "When it says go ahead", say: "say go ahead", rows: favRows }, { title: "When it concedes", say: "concede the worry", rows: unfavRows })
    : weighsSides(inp, ctx, { title: "When it says stay", say: "say stay", rows: favRows }, { title: "When it says leave", say: "say leave", rows: unfavRows });
  const rivals = comp.map((c) => rivalSmall(inp, ctx, c, (r) => h.activeDests(r.code.destinations).has(c.key), "Named as the alternative", { when: "as the alternative" }));
  const usual = usualOf(inp, ctx.inputs);
  return {
    kind: inp.kind,
    claim,
    ...(usual ? { usualCellId: usual.id, usualKey: buyer ? "All your buyers' worries" : "All your customers' worries" } : {}),
    hereKey: "This worry",
    stackLabel: "How the answer goes",
    steps: [
      ...(judged.length >= 5 ? [{ key: "agrees" as const, label: "Agrees the worry is fair", here: agrees, hereLabel: "Answers that judge it" }] : []),
      { key: "verdict", label: buyer ? "What it tells the buyer to do" : "What it tells the customer to do", segments: segs },
    ],
    ...(block ? { compare: true as const, competitors: block } : {}),
    lines,
    ...(weighs ? { weighs } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
}

function holdPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const segs = [
    seg("keep", "stay", "you", rows.filter((r) => r.code.keep_or_leave === "keep"), all, h),
    seg("leave", "leave", "away", rows.filter((r) => r.code.keep_or_leave === "leave"), all, h),
    seg("none", "no side", "neutral", rows.filter((r) => r.code.keep_or_leave !== "keep" && r.code.keep_or_leave !== "leave"), all, h),
  ];
  const shows = rows.filter((r) => h.activeDests(r.code.destinations).size > 0);
  const offers = num(shows.length, all, "answers", refsOf(shows, (r) => (r.code.destinations ?? []).find((x) => h.activeDests([x]).size > 0) ?? verdictFind(r, h)));
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
  const conditions = conditionsOf(
    inp,
    ctx,
    {
      title: `When the AI says stay, and when to look at another ${h.noun}`,
      sub: `Share of these answers that say "stay if the customer..." or "look at another ${h.noun} if...".`,
      towardTitle: "Stay if",
      awayTitle: `Look at another ${h.noun} if`,
      alsoToward: `Also said for another ${h.noun}`,
      alsoAway: "Also said for staying",
      toWord: "Shown",
    },
    { pickKind: false }
  );
  let lead: PanelText | undefined;
  const a = conditions?.away ?? [];
  if (a.length) {
    const towardSum = (conditions?.toward ?? []).reduce((x, c) => x + c.share.pct, 0);
    // am36: the lead quotes the conditions without their shares (the block below carries them), so it never repeats a bar number.
    lead = join(attachedLead(`looking at another ${h.noun}`, a.slice(0, 2).map((c) => ({ text: c.text })), "answers"), towardSum < 15 ? " It gives few conditions for staying." : "");
  }
  const { block, comp } = destBlock(rows, ctx, `Which ${h.plural} it shows`, `Share of these answers that name it as an alternative. Open a rival to see how it gets its picks.`, (r) => r.code.destinations);
  const rivals = comp.map((c) => rivalSmall(inp, ctx, c, (r) => h.activeDests(r.code.destinations).has(c.key), "Shown as an alternative", { when: "as an alternative" }));
  const lines: PanelLine[] = [];
  const weighs = weighsAll(inp, ctx);
  return {
    kind: "looking_around",
    claim,
    ...(lead ? { lead } : {}),
    stackLabel: "How the answer goes",
    steps: [
      { key: "verdict", label: "What it tells the customer to do", segments: segs },
      { key: "offers", label: `Shows another ${h.noun}`, here: offers, hereLabel: "All answers" },
    ],
    ...(block ? { compare: true as const, competitors: block } : {}),
    ...(conditions ? { conditions } : {}),
    lines,
    ...(weighs ? { weighs } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
}

/** am38: what valuePanel hands its own step explanations (built in finishPanel, after the tags). */
const VALUE_EXTRA = new WeakMap<PositionPanel, { sections: PanelDetailSection[]; topRival?: string; byProduct: boolean }>();

/** Rival products as written (am38): grouped per brand on their distinctive
 * words, the brand's own name words and the category's nouns dropped, a name
 * whose words sit inside exactly one larger name of the same brand joining it;
 * the bare brand is never a product. Shares are of distinct answers over `all`. */
function writtenProducts(items: { row: PoolRow; key: string; brandName: string; written: string }[], all: number, ctx: Ctx, unit: string): { name: string; num: PanelNum }[] {
  type G = { key: string; forms: Map<string, number>; ids: Map<string, PoolRow>; toks: Set<string> };
  const by = new Map<string, G>();
  const nouns = nounToks(ctx);
  for (const it of items) {
    if (productLabel(it.written, it.brandName, ctx) === null) continue;
    const name = cleanProduct(it.written) || it.written.trim();
    const own = nameTokens(it.brandName, ctx);
    const kept = famTokens(name).filter((t) => !nouns.has(t) && !PRODUCT_STOP.has(t) && !own.has(t));
    if (!kept.length) continue;
    const gk = `${it.key}|${kept.join(" ")}`;
    const g = by.get(gk) ?? { key: it.key, forms: new Map<string, number>(), ids: new Map<string, PoolRow>(), toks: new Set(kept) };
    g.forms.set(name, (g.forms.get(name) ?? 0) + 1);
    g.ids.set(it.row.code.response_id, it.row);
    by.set(gk, g);
  }
  const keys = [...by.keys()].sort((x, y) => by.get(x)!.toks.size - by.get(y)!.toks.size);
  for (const k of keys) {
    const g = by.get(k);
    if (!g) continue;
    const sup = [...by.entries()].filter(([k2, g2]) => k2 !== k && g2.key === g.key && g2.toks.size > g.toks.size && [...g.toks].every((t) => g2.toks.has(t)));
    if (sup.length !== 1) continue;
    const into = sup[0][1];
    for (const [f, n] of g.forms) into.forms.set(f, (into.forms.get(f) ?? 0) + n);
    for (const [id, r] of g.ids) into.ids.set(id, r);
    by.delete(k);
  }
  return [...by.values()]
    .map((g) => ({ name: [...g.forms.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || x[0].localeCompare(y[0]))[0][0], rows: [...g.ids.values()], forms: g.forms }))
    .filter((g) => g.rows.length >= ROW_MIN)
    .sort((x, y) => y.rows.length - x.rows.length || x.name.localeCompare(y.name))
    .map((g) => ({ name: g.name, num: num(g.rows.length, all, unit, refsOf(g.rows, (r) => (r.code.mentions ?? []).find((m) => g.forms.has(cleanProduct(m.brand) || m.brand.trim()))?.brand ?? g.name)) }));
}

function valuePanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const fact = (r: PoolRow) => h.valueFacts.get(r.code.response_id);
  const worthOf = (r: PoolRow) => fact(r)?.worth ?? (r.code.worth_it === "yes" || r.code.worth_it === "no" ? r.code.worth_it : "depends");
  const worth = (w: string, rs: PoolRow[] = rows) => rs.filter((r) => worthOf(r) === w);
  const segs = [seg("yes", "worth it", "you", worth("yes"), all, h), seg("depends", "depends", "neutral", worth("depends"), all, h), seg("no", "not worth it", "away", worth("no"), all, h)];
  // Where it points the buyer instead - every answer, one segment each: a rival first, else your own, else nowhere (owner ruling 5).
  // am37: one own-cheaper count per panel - this exclusive one; a brand with no ladder of its own lines (ctx.ladder false) has no own-cheaper option at all.
  const ownOf = (r: PoolRow) => (ctx.ladder ? (fact(r)?.own.size ?? 0) : 0);
  const rivalRows = rows.filter((r) => (fact(r)?.instead.size ?? 0) > 0);
  const ownRows = rows.filter((r) => (fact(r)?.instead.size ?? 0) === 0 && ownOf(r) > 0);
  const nowhere = rows.filter((r) => (fact(r)?.instead.size ?? 0) === 0 && ownOf(r) === 0);
  const ownLabel = "only your own cheaper option";
  const rivalFind = (r: PoolRow) => (r.code.mentions ?? []).find((m) => m.framing === "recommended" && fact(r)!.instead.has(h.resolve(m.brand).key))?.brand ?? [...fact(r)!.instead.values()][0];
  const instead: PanelSegment[] = [
    ...(ctx.ladder ? [{ key: "own", label: ownLabel, tone: "neutral" as const, num: num(ownRows.length, all, "answers", refsOf(ownRows, (r) => [...fact(r)!.own.values()][0] ?? h.brand)) }] : []),
    { key: "rival", label: ctx.ladder ? `a rival's ${h.noun}` : "a rival", tone: "away", num: num(rivalRows.length, all, "answers", refsOf(rivalRows, rivalFind)) },
    { key: "nowhere", label: ctx.ladder ? "nowhere" : "no rival", tone: "neutral", num: num(nowhere.length, all, "answers", refsOf(nowhere, (r) => verdictFind(r, h))) },
  ];
  // The product asked about (am38): the cell's confirmed line; on the all-buyers cell, the lines its buyers were asked about.
  const sibs = inp.pooled ? siblingsOf(inp, ctx.inputs).filter((x) => x.kind === "value") : [];
  const sibLines = [...new Set(sibs.filter((x) => x.line).map((x) => x.line!))];
  const subject = inp.pooled ? (sibLines.length === 1 ? sibLines[0] : h.brand) : inp.line ?? h.brand;
  const lineOfSib = (x: PanelCellInput) => x.line || h.brand;
  const lines = [...new Set(sibs.map(lineOfSib))];
  const several = inp.pooled && lines.length >= 2;
  const product = several ? listWords(lines) : inp.pooled ? sibLines[0] : inp.line ?? undefined;
  const yes = segs[0].num;
  const no = segs[2].num;
  const claim = join(
    `Asked whether ${subject} is worth it over a cheaper ${h.noun}${inp.pooled ? ", across all buyers" : " for this buyer"}, the AI says no in `,
    N(no),
    " of answers and ",
    yes.pct === 0 ? "never says yes" : join("yes in ", N(yes)),
    "."
  );
  // By product asked about (the all-buyers cell when its buyers were asked about 2+ products).
  let byProduct: PanelTable | undefined;
  if (several) {
    const lineOfRow = new Map<string, string>();
    for (const x of sibs) for (const r of x.rows) lineOfRow.set(r.code.response_id, lineOfSib(x));
    const groups = new Map<string, PoolRow[]>();
    for (const r of rows) {
      const l = lineOfRow.get(r.code.response_id) ?? h.brand;
      groups.set(l, [...(groups.get(l) ?? []), r]);
    }
    byProduct = {
      title: BY_PRODUCT.title,
      sub: BY_PRODUCT.sub,
      columns: BY_PRODUCT.columns,
      style: "compare",
      rows: [...groups.entries()]
        .sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]))
        .map(([l, rs]) => ({
          label: l,
          cells: [
            ...(["yes", "depends", "no"] as const).map((w) => {
              const hit = worth(w, rs);
              return num(hit.length, rs.length, "answers about it", refsOf(hit, (r) => verdictFind(r, h)));
            }),
            // A buyer's cell label may carry its line after " - "; the row already names it.
            T(listWords(sibs.filter((x) => lineOfSib(x) === l).map((x) => (x.label.endsWith(` - ${l}`) ? x.label.slice(0, -(l.length + 3)) : x.label)))),
          ],
        })),
    };
  }
  // The rivals named instead (top COMP_TOP): the "where it points" explanation lists them, each opening its panel.
  const byRival = new Map<string, { key: string; name: string; rows: PoolRow[] }>();
  for (const r of rows) for (const [k, name] of fact(r)?.instead ?? []) byRival.set(k, { key: k, name, rows: [...(byRival.get(k)?.rows ?? []), r] });
  const comp = [...byRival.values()].filter((x) => x.rows.length >= ROW_MIN).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)).slice(0, COMP_TOP);
  const rivals = comp.map((c) => rivalSmall(inp, ctx, c, (r) => !!fact(r)?.instead.has(c.key), "Named as the better option", { when: "as the better option", youAlt: worth("yes") }));
  // The explanation's lists of new facts (am38), in order.
  const sections: PanelDetailSection[] = [];
  {
    const vrows: PanelDetailSection["rows"] = [];
    const folds: string[] = [];
    for (const v of ["no", "depends", "yes"] as const) {
      const vr = worth(v);
      if (vr.length < ARGS_MIN) continue;
      const hit = vr.filter((r) => (fact(r)?.instead.size ?? 0) > 0);
      if (hit.length >= ROW_MIN) vrows.push({ label: VALUE_VERDICT_ROW[v], num: num(hit.length, vr.length, `answers that say ${segs.find((g) => g.key === v)!.label}`, refsOf(hit, rivalFind)) });
      else folds.push(valueVerdictFold(v, hit.length === 0));
    }
    if (vrows.length || folds.length) sections.push({ ...VALUE_SECTIONS.byVerdict, tone: "bad", rows: vrows, ...(folds.length ? { note: join(folds.join(" ")) } : {}) });
  }
  if (comp.length)
    sections.push({
      ...VALUE_SECTIONS.rivals,
      tone: "bad",
      rows: comp.map((c) => ({ label: c.name, num: num(c.rows.length, all, "answers", refsOf(c.rows, (r) => (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === c.key)?.brand ?? c.name)), open: true as const })),
    });
  {
    const items: { row: PoolRow; key: string; brandName: string; written: string }[] = [];
    for (const r of rivalRows) {
      const f = fact(r)!;
      for (const m of r.code.mentions ?? []) {
        if (m.framing !== "recommended") continue;
        const k = h.resolve(m.brand).key;
        if (k && f.instead.has(k)) items.push({ row: r, key: k, brandName: f.instead.get(k)!, written: m.brand });
      }
    }
    const prods = writtenProducts(items, all, ctx, "answers").slice(0, 5);
    if (prods.length >= 2) sections.push({ ...VALUE_SECTIONS.products(h.plural), tone: "bad", rows: prods.map((x) => ({ label: x.name, num: x.num })) });
  }
  if (ctx.ladder && ownRows.length) {
    // Your own options, on value.ts's grouping words with the category's nouns dropped; a group whose
    // words sit inside larger groups' and name no confirmed line's word folds them in (value.ts foldOwn).
    const nouns = nounToks(ctx);
    const mineToks = nameTokens(h.brand, ctx);
    const sing = (w: string) => w.replace(/s$/, "");
    const lineWords = new Set([...ctx.inputs.values()].filter((x) => x.kind === "value" && x.line).flatMap((x) => famTokens(x.line!).filter((t) => !mineToks.has(t)).map(sing)));
    const own = new Map<string, { forms: Map<string, number>; rows: Set<PoolRow> }>();
    for (const r of rows)
      for (const [k0, surface] of fact(r)?.own ?? []) {
        // A description ("any <noun> ...", "a cheaper ...") is no named option.
        if (/^(any|a|an|the|another|some)\s/i.test(surface.trim()) || !/^[A-Za-z0-9]/.test(cleanProduct(surface) || surface.trim())) continue;
        const k = k0.split(" ").filter((w) => !nouns.has(w) && !nouns.has(`${w}s`)).join(" ") || k0;
        const t = own.get(k) ?? { forms: new Map<string, number>(), rows: new Set<PoolRow>() };
        t.forms.set(surface, (t.forms.get(surface) ?? 0) + 1);
        t.rows.add(r);
        own.set(k, t);
      }
    const setOf = (k: string) => new Set(k.split(" "));
    for (const ka of [...own.keys()].sort((x, y) => setOf(x).size - setOf(y).size)) {
      const A = setOf(ka);
      if (!own.has(ka) || [...A].some((w) => lineWords.has(w))) continue;
      const g = own.get(ka)!;
      for (const kb of [...own.keys()]) {
        if (kb === ka || ![...A].every((w) => setOf(kb).has(w))) continue;
        const t = own.get(kb)!;
        for (const [f, c] of t.forms) g.forms.set(f, (g.forms.get(f) ?? 0) + c);
        for (const r of t.rows) g.rows.add(r);
        own.delete(kb);
      }
    }
    const top = [...own.values()]
      .map((t) => ({ t, rs: [...t.rows], name: [...t.forms.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0] }))
      .filter((x) => x.rs.length >= ROW_MIN)
      .sort((x, y) => y.rs.length - x.rs.length || x.name.localeCompare(y.name))
      .slice(0, 3);
    if (top.length) sections.push({ ...VALUE_SECTIONS.own, tone: "good", rows: top.map((x) => ({ label: cleanProduct(x.name) || x.name, num: num(x.rs.length, all, "answers", refsOf(x.rs, (r) => [...fact(r)!.own.values()].find((v) => x.t.forms.has(v)) ?? x.name)) })) });
  }
  const weighs = weighsSides(inp, ctx, { title: "When it says worth it", say: "say worth it", rows: worth("yes") }, { title: "When it says not worth it", say: "say not worth it", rows: worth("no") });
  const usual = usualOf(inp, ctx.inputs);
  const panel: PositionPanel = {
    kind: "value",
    claim,
    ...(usual ? { usualCellId: usual.id, usualKey: "All buyers" } : {}),
    hereKey: inp.pooled ? "All buyers" : "This buyer",
    stackLabel: "How the answer goes",
    steps: [
      { key: "worth", label: valueStepLabel(product, several), segments: segs },
      { key: "instead", label: "Where it points the buyer instead", segments: instead },
    ],
    ...(product ? { product } : {}),
    ...(byProduct ? { byProduct } : {}),
    lines: [],
    ...(weighs ? { weighs } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
  VALUE_EXTRA.set(panel, { sections, topRival: comp[0]?.name, byProduct: !!byProduct });
  return panel;
}

function problemPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const catRows = rows.filter((r) => r.code.category_routed === "category");
  const category = num(catRows.length, all, "answers", refsOf(catRows, (r) => verdictFind(r, h)));
  const you = funnelNums(rows, h.targetKey, h.brand, h);
  // Competitors: brands recommended in at least BRAND_FLOOR answers, top COMP_TOP.
  const recBy = new Map<string, { key: string; name: string; rows: PoolRow[] }>();
  for (const r of rows) for (const [k, name] of h.recommendsOf(r)) if (k !== h.targetKey) recBy.set(k, { key: k, name, rows: [...(recBy.get(k)?.rows ?? []), r] });
  const comp = [...recBy.values()].filter((x) => x.rows.length >= BRAND_FLOOR).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)).slice(0, COMP_TOP);
  const compNums = comp.map((c) => ({ c, f: funnelNums(rows, c.key, c.name, h) }));
  const claim = join(
    inp.pooled ? `When buyers describe their problem without asking for ${article(h.noun)} ${h.noun}, the AI recommends you in ` : `When this buyer describes their problem without asking for ${article(h.noun)} ${h.noun}, the AI recommends you in `,
    N(you.recommended),
    " of answers."
  );
  // Table: topics, ruling 5 filtered, top 6.
  const usual = usualOf(inp, ctx.inputs);
  const topicShares = (rs: PoolRow[]) => {
    const m = new Map<string, PoolRow[]>();
    for (const r of rs) for (const t of new Set(r.code.topics ?? [])) m.set(t, [...(m.get(t) ?? []), r]);
    return m;
  };
  const here = topicShares(rows);
  const ranked = [...here.entries()].map(([code, rs]) => ({ code, rs, share: rs.length / all })).sort((a, b) => b.rs.length - a.rs.length || a.code.localeCompare(b.code));
  const kept = filterObvious(ranked, inp.id, "topics", h.wordings(inp.cellIntents), h.scopes, h.category, h.omissions).slice(0, 6);
  const uMap = usual ? topicShares(usual.rows) : null;
  const table: PanelTable | undefined = kept.length
    ? {
        title: "What these answers cover",
        sub: "Share of the answers that raise each topic. These questions take no picks, so there is no case for or against one brand.",
        columns: usual ? ["This buyer", "All buyers"] : [inp.pooled ? "All buyers" : "This buyer"],
        style: "compare",
        rows: kept.map((x) => ({
          label: clabel(x.code, h),
          cells: [
            num(x.rs.length, all, "answers", refsOf(x.rs, () => x.code)),
            ...(usual && uMap ? [num(uMap.get(x.code)?.length ?? 0, usual.rows.length, "answers", refsOf(uMap.get(x.code) ?? [], () => x.code))] : []),
          ],
        })),
      }
    : undefined;
  const rivals = comp.map((c) => rivalSmall(inp, ctx, c, (r) => h.recommendsOf(r).has(c.key), "Recommended"));
  return {
    kind: "problem",
    claim,
    ...(usual ? { usualCellId: usual.id, usualKey: "Across all buyers" } : {}),
    hereKey: inp.pooled ? "Across all buyers" : "With this buyer",
    stackLabel: "How the answer goes",
    steps: [
      {
        key: "category",
        label: `The answer points the buyer to ${h.plural}`,
        here: category,
        hereLabel: "All answers",
        ...(compNums.length ? { tagRank: "Same for every brand" } : {}),
        // am37: being named can outrun this step - an answer can mention you while it mainly sends the buyer outside the category.
        ...(knOf(category)!.k < you.f.named.length ? { note: join(`You can be named in an answer that mainly points the buyer away from ${h.plural}.`) } : {}),
      },
      { key: "named", label: "Named", here: you.named, ...(compNums.length ? { rivals: compNums.map((x) => ({ name: x.c.name, num: x.f.named })) } : {}) },
      { key: "recommended", label: "Recommended", here: you.recommended, ...(compNums.length ? { rivals: compNums.map((x) => ({ name: x.c.name, num: x.f.recommended })) } : {}) },
    ],
    ...(compNums.length
      ? {
          compare: true as const,
          competitorOrder: compNums.map((x) => x.c.name),
          competitors: {
            title: "Which brands it recommends",
            sub: "Share of these answers that recommend it. Open a rival to see how it gets them.",
            rows: compNums.map((x) => ({ name: x.c.name, num: x.f.recommended, open: true as const })),
          },
        }
      : {}),
    ...(table ? { table } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
}

function criteriaPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const by = new Map<string, PoolRow[]>();
  for (const r of rows) for (const c of new Set(r.code.reasons ?? [])) by.set(c, [...(by.get(c) ?? []), r]);
  const ranked = [...by.entries()].map(([code, rs]) => ({ code, rs, share: rs.length / all })).sort((a, b) => b.rs.length - a.rs.length || a.code.localeCompare(b.code));
  const taught = filterObvious(ranked, inp.id, "checklist", h.wordings(inp.cellIntents), h.scopes, h.category, h.omissions);
  const top5 = taught.slice(0, 5);
  const taughtSet = new Set(top5.map((x) => x.code));
  const taughtNum = (code: string) => {
    const rs = by.get(code) ?? [];
    return num(rs.length, all, "answers", refsOf(rs, () => code));
  };
  // am37: a buyer's own what-to-buy answers say what wins when it picks you,
  // when there are enough of them; else the all-buyers figures, said so.
  const room = !inp.pooled ? ctx.inputs.get(`chooses:open:${inp.key}`) : undefined;
  const pickSet = (src: PoolRow[]) => ({
    you: src.filter((r) => h.pickOf(r).key === h.targetKey && r.code.reasons !== null),
    other: src.filter((r) => h.pickOf(r).status === "active" && h.pickOf(r).key !== h.targetKey && r.code.reasons !== null),
  });
  const roomSet = room ? pickSet(room.rows) : null;
  const local = !!roomSet && roomSet.you.length >= ARGS_MIN && roomSet.other.length >= ARGS_MIN;
  const { you: youPicks, other: otherPicks } = local ? roomSet! : pickSet(h.headline);
  const lift = local
    ? (() => {
        const codes = new Set([...youPicks, ...otherPicks].flatMap((r) => r.code.reasons!));
        return [...codes].map((code) => {
          const w = cell(youPicks.filter((r) => r.code.reasons!.includes(code)).length, youPicks.length);
          const o = cell(otherPicks.filter((r) => r.code.reasons!.includes(code)).length, otherPicks.length);
          return { code, wins: w, others: o, lift: (w.n ? w.k / w.n : 0) - (o.n ? o.k / o.n : 0) };
        });
      })()
    : h.reasonLift;
  const winners = lift
    .filter((l) => l.lift > 0 && l.wins.low > l.others.high && !taughtSet.has(l.code))
    .sort((a, b) => b.wins.k / Math.max(1, b.wins.n) - a.wins.k / Math.max(1, a.wins.n) || a.code.localeCompare(b.code));
  const pickNum = (code: string, rs: PoolRow[]) => {
    const hit = rs.filter((r) => r.code.reasons!.includes(code));
    return num(hit.length, rs.length, "answers that pick", refsOf(hit, () => code));
  };
  const untaught = winners.slice(0, 2);
  const when = local || inp.pooled ? "when it picks you" : "when it picks you, across all buyers";
  const opener = inp.pooled ? "When buyers ask" : `When the buyer in "${inp.label}" asks`;
  const gapSpans = untaught.map((w, i) => F(i === 0 ? upperFirst(cname(w.code, h)) : cname(w.code, h), pickNum(w.code, youPicks)));
  const claim = join(
    `${opener} what to look for in ${article(h.noun)} ${h.noun}, the AI teaches `,
    listNameSpans(top5.slice(0, 3).map((x) => F(cname(x.code, h), taughtNum(x.code)))),
    ".",
    untaught.length
      ? join(" ", listNameSpans(gapSpans), untaught.length > 1 ? `, which come up most ${when}, are not on its list.` : `, which comes up most ${when}, is not on its list.`)
      : top5.length
        ? ` Everything that comes up most ${when} is on its list.`
        : ""
  );
  // The gap is a sentence on the checklist step, never a card of its own with nothing to draw.
  const steps: PanelStep[] = [
    {
      key: "taught",
      label: "What it tells buyers to look at",
      items: top5.slice(0, 4).map((x) => ({ label: clabel(x.code, h), num: taughtNum(x.code) })),
      ...(untaught.length ? { note: join(listNameSpans(gapSpans), untaught.length > 1 ? ` come up most ${when}, and neither is taught.` : ` comes up most ${when}, and it is not taught.`) } : {}),
    },
  ];
  // Table: the winners (up to 4) plus the taught top 5 with lift rows; not taught first, then by lift; at most 6.
  const liftBy = new Map(lift.map((l) => [l.code, l]));
  const tableCodes = [...new Set([...winners.slice(0, 4).map((w) => w.code), ...top5.map((x) => x.code).filter((c) => liftBy.has(c))])]
    .map((c) => ({ c, taught: taughtSet.has(c), lift: liftBy.get(c)?.lift ?? 0 }))
    .sort((a, b) => Number(a.taught) - Number(b.taught) || b.lift - a.lift || a.c.localeCompare(b.c))
    .slice(0, 6);
  const table: PanelTable | undefined =
    tableCodes.length && lift.length
      ? {
          title: "What the answer weighs, against the checklist",
          sub: `How often each topic comes up in answers that pick you and in answers that pick another brand, and whether the AI teaches buyers to look for it. The when-picked figures come from the What to buy answers${local ? " of this buyer" : inp.pooled ? "" : " of all buyers"}, because these questions take no picks.`,
          columns: [`When it picks another ${h.noun}`, "When it picks you", "On the checklist"],
          style: "compare",
          rows: tableCodes.map(({ c, taught }) => {
            const tn = taughtNum(c);
            return { label: clabel(c, h), cells: [pickNum(c, otherPicks), pickNum(c, youPicks), taught ? { t: `Taught, ${tn.value}`, ...(tn.refs ? { refs: tn.refs } : {}), tip: tn.tip } : { t: "Not taught" }] };
          }),
        }
      : undefined;
  return {
    kind: "criteria",
    claim,
    stackLabel: "How the answer goes",
    steps,
    ...(table ? { table } : {}),
  };
}

function expansionPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const segs = [
    seg("backs", "backs it", "you", rows.filter((r) => r.code.growth_stance === "backs"), all, h),
    seg("neutral", "neither backs nor discourages", "neutral", rows.filter((r) => r.code.growth_stance !== "backs" && r.code.growth_stance !== "redirects"), all, h),
    seg("redirects", "points them elsewhere", "away", rows.filter((r) => r.code.growth_stance === "redirects"), all, h),
  ];
  const claim = join(inp.asked ? `When a customer asks ${inp.asked}, the AI backs it in ` : `Asked by your customers about growing their use of ${h.brand}, the AI backs it in `, N(segs[0].num), " of answers and points them elsewhere in ", N(segs[2].num), ".");
  const conditions = conditionsOf(
    inp,
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
    { pickKind: false }
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

function casePanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const strong = rows.filter((r) => r.code.case_strength === "strong");
  const under = rows.filter((r) => r.code.case_strength === "undermined" || r.code.case_strength === "weak");
  const hedged = rows.filter((r) => r.code.case_strength !== "strong" && !under.includes(r));
  const segs = [seg("strong", "a confident case", "you", strong, all, h), seg("hedged", "a hedged case", "neutral", hedged, all, h), ...(under.length ? [seg("undermined", "argues against you", "away", under, all, h)] : [])];
  const claim = join(
    `When a customer asks ${inp.asked ?? "how to win approval for you"}, the AI hands over a confident case in `,
    N(segs[0].num),
    " of answers and a hedged one in ",
    N(segs[1].num),
    under.length ? join(", and argues against you in ", N(segs[2].num)) : "",
    "."
  );
  const lines: PanelLine[] = [];
  const red = rows.filter((r) => h.activeDests(r.code.redirect_to).size > 0);
  if (red.length) lines.push({ label: `Also points to another ${h.noun}`, value: join(N(num(red.length, all, "answers", refsOf(red, (r) => (r.code.redirect_to ?? [])[0] ?? h.brand))), ` of answers also point to another ${h.noun}, whichever case they give`) });
  let table: PanelTable | undefined;
  if (strong.length >= CASE_MIN) {
    const share = (code: string, rs: PoolRow[]) => rs.filter((r) => r.code.reasons?.includes(code));
    const codes = new Set<string>();
    for (const r of strong) for (const c of r.code.reasons ?? []) codes.add(c);
    const gapOn = hedged.length >= CASE_MIN;
    const ranked = [...codes]
      .map((code) => {
        const s = share(code, strong).length / strong.length;
        const hd = gapOn ? share(code, hedged).length / hedged.length : 0;
        return { code, s, hd, share: share(code, rows).length / all };
      })
      .filter((x) => x.s >= 0.1 && (!gapOn || x.s - x.hd >= GAP_MIN))
      .sort((a, b) => b.s - a.s || a.code.localeCompare(b.code));
    const kept = filterObvious(ranked, inp.id, "case", h.wordings(inp.cellIntents), h.scopes, h.category, h.omissions).slice(0, 5);
    if (kept.length)
      table = {
        title: "What a confident case argues",
        sub: gapOn
          ? "The topics that set a confident case apart. Each share is of the confident cases. Topics the question itself names, and topics that come up about equally in both kinds of case, are left out."
          : "The topics a confident case argues. Each share is of the confident cases; too few hedged cases to set beside them.",
        columns: gapOn ? ["Confident cases", "Hedged cases"] : ["Confident cases"],
        style: "bars",
        rows: kept.map((x) => {
          const sh = share(x.code, strong);
          const hh = share(x.code, hedged);
          const hn = num(hh.length, hedged.length, "hedged cases", refsOf(hh, () => x.code));
          return {
            label: clabel(x.code, h),
            cells: [num(sh.length, strong.length, "confident cases", refsOf(sh, () => x.code)), ...(gapOn ? [{ t: `${hn.value} in hedged cases`, ...(hn.refs ? { refs: hn.refs } : {}), tip: hn.tip }] : [])],
          };
        }),
      };
  }
  return {
    kind: "business_case",
    claim,
    stackLabel: "How the answer goes",
    steps: [{ key: "strength", label: "How strong a case does the AI give the customer?", segments: segs }],
    lines,
    ...(table ? { table } : {}),
  };
}

/* ------------------- am31 round 2: the single-question kinds ------------------- */

/** "When a buyer asks <label>" - the label, else the quoted seed (question_labels.ts). */
const whenAsks = (inp: PanelCellInput, who: "buyer" | "customer", fallback: string) => `When ${who === "buyer" ? "a buyer" : "a customer"} asks ${inp.asked ?? fallback}, `;

/** An active brand the tracker analyzes (the brand table's set: analyzed entries only). */
function counted(name: string, h: PanelHelpers): boolean {
  const x = h.resolve(name);
  return x.status === "active" && (x.key === h.targetKey || x.entry?.analyzed !== false);
}

/** Answers naming any analyzed brand (a mention or an in-category pick). */
function namesAnyBrand(r: PoolRow, h: PanelHelpers): boolean {
  return (r.code.mentions ?? []).some((m) => counted(m.brand, h)) || (h.pickOf(r).status === "active" && !!r.code.top_pick && counted(r.code.top_pick, h));
}

/** Brands named (or recommended) per answer, excluding you: key -> rows. */
function brandsBy(rows: PoolRow[], h: PanelHelpers, rec: boolean): { key: string; name: string; rows: PoolRow[] }[] {
  const by = new Map<string, { key: string; name: string; rows: PoolRow[] }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const m of r.code.mentions ?? []) {
      if (rec && m.framing !== "recommended") continue;
      const x = h.resolve(m.brand);
      if (!counted(m.brand, h) || x.key === h.targetKey || seen.has(x.key)) continue;
      seen.add(x.key);
      const t = by.get(x.key) ?? { key: x.key, name: x.name, rows: [] };
      t.rows.push(r);
      by.set(x.key, t);
    }
    const p = h.pickOf(r);
    if (p.status === "active" && p.key && p.key !== h.targetKey && !seen.has(p.key) && r.code.top_pick && counted(r.code.top_pick, h)) {
      const t = by.get(p.key) ?? { key: p.key, name: p.name ?? p.key, rows: [] };
      t.rows.push(r);
      by.set(p.key, t);
    }
  }
  return [...by.values()].sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
}

const PRODUCT_STOP = new Set(["the", "from", "by", "of", "a", "an", "and", "with", "for"]);

/** Your products named in each answer (mentions of you, as written, brand words dropped). */
function yourProducts(rows: PoolRow[], ctx: Ctx): Map<string, { name: string; rows: PoolRow[] }> {
  const { h } = ctx;
  const nounT = nounToks(ctx);
  const own = nameTokens(h.brand, ctx);
  const out = new Map<string, { name: string; rows: PoolRow[]; forms: Map<string, number> }>();
  for (const r of rows) {
    const seen = new Set<string>();
    const forms = [...(r.code.mentions ?? []).map((m) => m.brand), ...(h.pickOf(r).key === h.targetKey && r.code.top_pick ? [r.code.top_pick] : [])];
    for (const f of forms) {
      if (h.resolve(f).key !== h.targetKey) continue;
      const label = productLabel(f, h.brand, ctx);
      if (!label) continue;
      const toks = famTokens(label).filter((t) => !nounT.has(t) && !own.has(t) && !PRODUCT_STOP.has(t));
      const key = toks.join(" ") || famTokens(label).join(" ");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const t = out.get(key) ?? { name: label, rows: [], forms: new Map<string, number>() };
      t.rows.push(r);
      t.forms.set(label, (t.forms.get(label) ?? 0) + 1);
      out.set(key, t);
    }
  }
  const res = new Map<string, { name: string; rows: PoolRow[] }>();
  for (const [k, t] of out) res.set(k, { name: [...t.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0], rows: t.rows });
  return res;
}

function popularPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const u = ctx.inputs.get("chooses:open:all");
  const uName = ROW_NAME.open.toLowerCase();
  const pf = (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || h.brand;
  const you = funnelNums(rows, h.targetKey, h.brand, h);
  const uf = u ? funnelNums(u.rows, h.targetKey, h.brand, h) : undefined;
  const commitRows = rows.filter((r) => h.pickOf(r).status === "active");
  const commits = num(commitRows.length, all, "answers", refsOf(commitRows, pf));
  const uCommitRows = u ? u.rows.filter((r) => h.pickOf(r).status === "active") : [];
  const uCommits = u ? num(uCommitRows.length, u.rows.length, "answers", refsOf(uCommitRows, pf)) : undefined;
  // Competitors: brands recommended in at least BRAND_FLOOR answers, top COMP_TOP.
  const comp = brandsBy(rows, h, true).filter((x) => x.rows.length >= BRAND_FLOOR).slice(0, COMP_TOP);
  const compNums = comp.map((c) => ({ c, f: funnelNums(rows, c.key, c.name, h) }));
  const every = you.f.named.length === all && all > 0;
  const claim = join(
    whenAsks(inp, "buyer", `which ${h.plural} people choose most`),
    "the AI names you in ",
    every ? F("every answer", you.named) : join(N(you.named), " of answers"),
    you.f.rec.length ? join(", and recommends you in ", N(you.recommended), ".") : ", and never recommends you."
  );
  const conditions = conditionsOf(
    inp,
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
  const lead =
    t.length || a.length
      ? join(t.length ? attachedLead("choosing you", [t[0]]) : null, t.length && a.length ? " " : null, a.length ? attachedLead(`choosing another ${h.noun}`, [a[0]]) : null)
      : undefined;
  const steps: PanelStep[] = [
    { key: "named", label: "Named", here: you.named, ...(uf ? { usual: uf.named } : {}), ...(compNums.length ? { rivals: compNums.map((x) => ({ name: x.c.name, num: x.f.named })) } : {}) },
    { key: "recommended", label: "Recommended", here: you.recommended, ...(uf ? { usual: uf.recommended } : {}), ...(compNums.length ? { rivals: compNums.map((x) => ({ name: x.c.name, num: x.f.recommended })) } : {}) },
    { key: "commits", label: `The answer names one ${h.noun} as the pick`, here: commits, ...(uCommits ? { usual: uCommits } : {}), compHereLabel: `Any ${h.noun}`, ...(compNums.length ? { tagRank: "Same for every brand" } : {}) },
  ];
  // Tables: your products named, and what the answer weighs - this question beside what to buy.
  const tables: PanelTable[] = [];
  const cols = u ? ["This question", `${upperFirst(uName)}, all buyers`] : ["This question"];
  const mineNamed = you.f.named;
  const uNamed = uf?.f.named ?? [];
  const prods = yourProducts(mineNamed, ctx);
  const uProds = yourProducts(uNamed, ctx);
  const prodRows = [...prods.entries()].filter(([, x]) => ctx.ladder && x.rows.length >= ROW_MIN).sort((x, y) => y[1].rows.length - x[1].rows.length || x[1].name.localeCompare(y[1].name)).slice(0, 4);
  if (prodRows.length)
    tables.push({
      title: `Which of your ${h.plural} it names`,
      sub: "Share of the answers that name you.",
      columns: cols,
      style: "compare",
      rows: prodRows.map(([k, x]) => ({
        label: x.name,
        cells: [num(x.rows.length, mineNamed.length, "answers that name you", refsOf(x.rows, () => x.name)), ...(u ? [num(uProds.get(k)?.rows.length ?? 0, uNamed.length, "answers that name you", refsOf(uProds.get(k)?.rows ?? [], () => x.name))] : [])],
      })),
    });
  const codeRows = (rs: PoolRow[]) => {
    const m = new Map<string, PoolRow[]>();
    for (const r of rs) for (const c of new Set(r.code.reasons ?? [])) m.set(c, [...(m.get(c) ?? []), r]);
    return m;
  };
  const here = codeRows(rows);
  const there = u ? codeRows(u.rows) : new Map<string, PoolRow[]>();
  const ranked = [...here.entries()].map(([code, rs]) => ({ code, rs, share: rs.length / all })).filter((x) => x.rs.length >= ROW_MIN).sort((x, y) => y.rs.length - x.rs.length || x.code.localeCompare(y.code));
  const kept = filterObvious(ranked, inp.id, "weighs", h.wordings(inp.cellIntents), h.scopes, h.category, h.omissions).slice(0, 4);
  if (kept.length)
    tables.push({
      title: "What the answer weighs",
      sub: "Share of the answers that raise each argument.",
      columns: cols,
      style: "compare",
      rows: kept.map((x) => ({
        label: clabel(x.code, h),
        cells: [num(x.rs.length, all, "answers", refsOf(x.rs, () => x.code)), ...(u ? [num(there.get(x.code)?.length ?? 0, u.rows.length, "answers", refsOf(there.get(x.code) ?? [], () => x.code))] : [])],
      })),
    });
  // Competitors block and the rival panels (full when the brand is a listed pick taker, else the smaller one).
  const rivals = comp.map((c) => {
    const b = (inp.brands ?? []).find((x) => x.name === c.name);
    return b ? rivalFull(inp, ctx, b, you, conditions) : rivalSmall(inp, ctx, c, (r) => h.recommendsOf(r).has(c.key), "Recommended");
  });
  const competitors: PanelBlock | undefined = compNums.length
    ? {
        title: "Which brands it recommends",
        sub: "Share of these answers that recommend the brand. Open a rival to see how it gets them.",
        rows: [...compNums.map((x) => ({ name: x.c.name, num: x.f.recommended, open: true as const })), { name: h.brand, you: true as const, num: you.recommended }].sort(
          (x, y) => y.num.pct - x.num.pct || x.name.localeCompare(y.name)
        ),
      }
    : undefined;
  return {
    kind: "popular",
    claim,
    ...(lead && lead.length ? { lead } : {}),
    hereKey: "This question",
    ...(u ? { usualKey: `${upperFirst(uName)}, all buyers` } : {}),
    stackLabel: "How the answer goes",
    steps,
    ...(compNums.length ? { compare: true as const, competitorOrder: compNums.map((x) => x.c.name) } : {}),
    ...(competitors ? { competitors } : {}),
    ...(conditions ? { conditions } : {}),
    lines: [],
    ...(tables.length ? { tables } : {}),
    ...(rivals.length ? { rivals } : {}),
  };
}

function learningPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const u = ctx.inputs.get("chooses:awareness:all");
  const uName = ROW_NAME.awareness.toLowerCase();
  const read = (rs: PoolRow[]) => {
    const any = rs.filter((r) => namesAnyBrand(r, h));
    const f = funnelOf(rs, h.targetKey, h);
    const namedAny = f.named.filter((r) => any.includes(r));
    return {
      any: num(any.length, rs.length, "answers", refsOf(any, (r) => (r.code.mentions ?? []).find((m) => counted(m.brand, h))?.brand ?? r.code.top_pick ?? h.brand)),
      named: num(f.named.length, rs.length, "answers", refsOf(f.named, (r) => f.surf(r, false) ?? r.code.top_pick ?? h.brand)),
      namedWhen: num(namedAny.length, any.length, "answers that name a brand", refsOf(namedAny, (r) => f.surf(r, false) ?? r.code.top_pick ?? h.brand)),
      anyN: any.length,
    };
  };
  const me = read(rows);
  const us = u ? read(u.rows) : undefined;
  const comp = brandsBy(rows, h, false).filter((x) => x.rows.length >= ROW_MIN).slice(0, COMP_TOP);
  const compNums = comp.map((c) => ({ c, named: num(c.rows.length, all, "answers", refsOf(c.rows, (r) => (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === c.key)?.brand ?? c.name)) }));
  const myK = knOf(me.named)!.k;
  const leads = compNums.length > 0 && compNums.every((x) => knOf(x.named)!.k < myK);
  const claim = join(
    whenAsks(inp, "buyer", `how ${h.plural} work`),
    "the AI names you in ",
    N(me.named),
    " of answers",
    leads ? ", more than any other brand." : ".",
    me.anyN * 2 < all ? " Most of these answers name no brand at all. When one does, it names you in " : " When the answer names a brand, it names you in ",
    N(me.namedWhen),
    " of them."
  );
  const steps: PanelStep[] = [
    { key: "anybrand", label: "The answer names any brand", here: me.any, ...(us ? { usual: us.any } : {}), compHereLabel: "Any brand", ...(compNums.length ? { tagRank: "Same for every brand" } : {}) },
    { key: "named", label: "Named", here: me.named, ...(us ? { usual: us.named } : {}), ...(compNums.length ? { rivals: compNums.map((x) => ({ name: x.c.name, num: x.named })) } : {}) },
    { key: "namedwhen", label: "Named, when the answer names a brand", here: me.namedWhen, ...(us ? { usual: us.namedWhen } : {}) },
  ];
  // Table: topics, this question beside spotting the problem (ruling 5 filtered).
  const topicShares = (rs: PoolRow[]) => {
    const m = new Map<string, PoolRow[]>();
    for (const r of rs) for (const t of new Set(r.code.topics ?? [])) m.set(t, [...(m.get(t) ?? []), r]);
    return m;
  };
  const here = topicShares(rows);
  const uMap = u ? topicShares(u.rows) : null;
  const ranked = [...here.entries()].map(([code, rs]) => ({ code, rs, share: rs.length / all })).filter((x) => x.rs.length >= ROW_MIN).sort((a, b) => b.rs.length - a.rs.length || a.code.localeCompare(b.code));
  const kept = filterObvious(ranked, inp.id, "topics", h.wordings(inp.cellIntents), h.scopes, h.category, h.omissions).slice(0, 6);
  const mk = (withU: boolean): PanelTable => ({
    title: "What these answers cover",
    sub: withU
      ? "Share of the answers that raise each topic. These questions take no picks, so there is no case for or against one brand."
      : "Share of the answers that raise each topic. The topics are the same whichever brand is named, so this block does not split by competitor.",
    columns: withU ? ["This question", upperFirst(uName)] : ["This question"],
    style: "compare",
    rows: kept.map((x) => ({
      label: clabel(x.code, h),
      cells: [num(x.rs.length, all, "answers", refsOf(x.rs, () => x.code)), ...(withU && u && uMap ? [num(uMap.get(x.code)?.length ?? 0, u.rows.length, "answers", refsOf(uMap.get(x.code) ?? [], () => x.code))] : [])],
    })),
  });
  return {
    kind: "learning",
    claim,
    hereKey: "This question",
    ...(u ? { usualKey: `${upperFirst(uName)}, all buyers` } : {}),
    stackLabel: "How the answer goes",
    steps,
    ...(compNums.length ? { compare: true as const, competitorOrder: compNums.map((x) => x.c.name) } : {}),
    ...(kept.length ? { table: mk(!!u), ...(u ? { tableComp: mk(false) } : {}) } : {}),
    lines: [],
  };
}

/** A written name's word set, for grouping names as written. */
const nameKeyOf = (name: string) => famTokens(name).join(" ") || name.trim().toLowerCase();

function alongsidePanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  // The pairings each answer names, grouped through the dictionary, else as written
  // (a name whose words are inside exactly one larger written group joins it).
  type G = { forms: Map<string, number>; rows: Map<PoolRow, string>; toks: Set<string> };
  const groups = new Map<string, G>();
  const keyOfPair = (name: string) => {
    const x = h.resolve(name);
    return x.status === "active" ? `d:${x.key}` : `w:${nameKeyOf(name)}`;
  };
  for (const r of rows)
    for (const p of r.code.pairings ?? []) {
      const nm = p.name.trim();
      // am37: never the brand itself (the customer's own) and never a generic word written all in lower case ("samples").
      if (!nm || isBareBrand(nm, ctx) || !/[A-Z0-9]/.test(nm)) continue;
      const k = keyOfPair(nm);
      const g = groups.get(k) ?? { forms: new Map<string, number>(), rows: new Map<PoolRow, string>(), toks: new Set(famTokens(nm)) };
      g.forms.set(nm, (g.forms.get(nm) ?? 0) + 1);
      if (!g.rows.has(r)) g.rows.set(r, nm);
      groups.set(k, g);
    }
  const small = [...groups.keys()].filter((k) => k.startsWith("w:")).sort((a, b) => groups.get(a)!.toks.size - groups.get(b)!.toks.size);
  for (const k of small) {
    const g = groups.get(k)!;
    if (!g.toks.size) continue;
    const sup = [...groups.entries()].filter(([k2, g2]) => k2 !== k && k2.startsWith("w:") && g2.toks.size > g.toks.size && [...g.toks].every((t) => g2.toks.has(t)));
    if (sup.length !== 1) continue;
    const into = sup[0][1];
    for (const [f, n] of g.forms) into.forms.set(f, (into.forms.get(f) ?? 0) + n);
    for (const [r, f] of g.rows) if (!into.rows.has(r)) into.rows.set(r, f);
    groups.delete(k);
  }
  const listed = [...groups.entries()]
    .map(([k, g]) => ({ name: k.startsWith("d:") ? h.resolve([...g.forms.keys()][0]).name : [...g.forms.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0][0], g }))
    .filter((x) => x.g.rows.size >= ROW_MIN)
    .sort((a, b) => b.g.rows.size - a.g.rows.size || a.name.localeCompare(b.name))
    .slice(0, 6);
  const items = listed.map((x) => ({ label: x.name, num: num(x.g.rows.size, all, "answers", refsOf([...x.g.rows.keys()], (r) => x.g.rows.get(r) ?? x.name)) }));
  // The own / another company's / in place of yours split (the brand itself named back is not "something of yours").
  const kindRows = (rel: string) => rows.filter((r) => (r.code.pairings ?? []).some((p) => p.maker_relation === rel && !(rel === "own" && isBareBrand(p.name, ctx))));
  const kNum = (rel: string) => {
    const rs = kindRows(rel);
    return num(rs.length, all, "answers", refsOf(rs, (r) => (r.code.pairings ?? []).find((p) => p.maker_relation === rel)?.name ?? h.brand));
  };
  const own = kNum("own");
  const third = kNum("third_party");
  const sub = kNum("substitute");
  const part = (n: PanelNum, what: string) => (n.pct === 0 ? `none ${what}` : join(N(n), ` ${what}`));
  const note = join(
    "Of these answers, ",
    part(third, "name another company's"),
    ", ",
    part(own, "name something of yours"),
    " and ",
    part(sub, "name one to use in place of yours"),
    "."
  );
  const top = listed[0];
  const claim = join(
    whenAsks(inp, "customer", `what to use alongside you`),
    top ? join("the AI names ", F(top.name, items[0].num), " in ", top.g.rows.size === all ? F("every answer", items[0].num) : join(N(items[0].num), " of answers"), ".") : `the AI names nothing alongside you often enough to list.`
  );
  const conditions = conditionsOf(
    inp,
    ctx,
    {
      title: "Which one it picks, and when",
      sub: "The conditions the AI ties to each one it names. Each share is of all the answers to this question; an answer can state several.",
      towardTitle: "Picks something of yours if",
      awayTitle: "Picks another company's if",
      alsoToward: "Also said for another company's",
      alsoAway: "Also said for yours",
      toWord: "To",
    },
    { pickKind: false, toCards: true, ownSplit: true }
  );
  if (conditions) conditions.neutralAway = true;
  const steps: PanelStep[] = [{ key: "alongside", label: "Which ones it names alongside you", items, note }];
  return {
    kind: "alongside",
    claim,
    stackLabel: "How the answer goes",
    steps,
    ...(conditions ? { conditions } : {}),
    lines: [],
  };
}

function criticPanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const pf = (r: PoolRow) => verdictFind(r, h);
  /** Segments of one verdict: those with 3+ answers drawn, the rest folded into a sentence. */
  const fold = (defs: { key: string; label: string; tone: PanelSegment["tone"]; rows: PoolRow[]; phrase: string }[], n: number, unit: string) => {
    const segs: PanelSegment[] = defs.filter((d) => d.rows.length >= ROW_MIN).map((d) => ({ key: d.key, label: d.label, tone: d.tone, num: num(d.rows.length, n, unit, refsOf(d.rows, pf)) }));
    const small = defs.filter((d) => d.rows.length > 0 && d.rows.length < ROW_MIN);
    const none = defs.filter((d) => d.rows.length === 0 && segs.length > 0);
    const parts: (PanelText | string)[] = [];
    small.forEach((d, i) => {
      if (i > 0) parts.push(i === small.length - 1 ? ", and " : ", ");
      parts.push(join(F(i === 0 ? "In a few answers" : "in a few answers", num(d.rows.length, n, unit, refsOf(d.rows, pf))), ` it ${d.phrase}`));
    });
    if (small.length) parts.push(".");
    if (none.length) parts.push(`${small.length ? " " : ""}No answer ${listWords(none.map((d) => d.phrase), "or")}.`);
    return { segs, note: parts.length ? join(...parts) : undefined };
  };
  const strong = rows.filter((r) => r.code.case_strength === "strong");
  const partial = rows.filter((r) => r.code.case_strength === "partial" || r.code.case_strength === "hedged");
  const concedes = rows.filter((r) => r.code.case_strength === "concedes" || r.code.case_strength === "undermined");
  const st = fold(
    [
      { key: "strong", label: "a strong answer", tone: "you", rows: strong, phrase: "gives a strong answer" },
      { key: "partial", label: "a partial answer", tone: "neutral", rows: partial, phrase: "gives a partial answer" },
      { key: "concedes", label: "drops your side", tone: "away", rows: concedes, phrase: "drops the customer's side" },
    ],
    all,
    "answers"
  );
  // The premise: of the answers that judge it (the doubt view's judged-only convention).
  const judged = rows.filter((r) => r.code.premise_verdict === "confirms" || r.code.premise_verdict === "mixed" || r.code.premise_verdict === "rebuts");
  const pv = (v: string) => judged.filter((r) => r.code.premise_verdict === v);
  const pr = fold(
    [
      { key: "rebuts", label: "the critic is wrong", tone: "you", rows: pv("rebuts"), phrase: "says the critic is wrong" },
      { key: "mixed", label: "partly right", tone: "neutral", rows: pv("mixed"), phrase: "says the critic is partly right" },
      { key: "confirms", label: "the critic is right", tone: "away", rows: pv("confirms"), phrase: "says the critic is right" },
    ],
    judged.length,
    "answers that judge the criticism"
  );
  const strongN = num(strong.length, all, "answers", refsOf(strong, pf));
  const rebutN = num(pv("rebuts").length, judged.length, "answers that judge the criticism", refsOf(pv("rebuts"), (r) => (r.code.premise_quote ?? "").trim() || pf(r)));
  const seed = inp.criticism ? `how to answer the criticism "${inp.criticism}"` : "how to answer someone who doubts you";
  // am37: when the answers that judge the criticism mostly say the critic is right, the claim leads with that.
  const confirmsRows = pv("confirms");
  const criticRight = judged.length >= ROW_MIN && confirmsRows.length > Math.max(pv("rebuts").length, pv("mixed").length);
  const confN = num(confirmsRows.length, judged.length, "answers that judge the criticism", refsOf(confirmsRows, (r) => (r.code.premise_quote ?? "").trim() || pf(r)));
  const claim = criticRight
    ? join(whenAsks(inp, "customer", seed), "the AI says the critic is right in ", N(confN), " of the answers that judge it, though it gives a strong answer in ", N(strongN), " of answers.")
    : join(
        whenAsks(inp, "customer", seed),
        "the AI gives a strong answer in ",
        strong.length === all && all > 0 ? F("all of them", strongN) : join(N(strongN), " of answers"),
        judged.length ? join(" and says the critic is wrong in ", N(rebutN), " of the answers that judge it.") : "."
      );
  const steps: PanelStep[] = [{ key: "strength", label: "How strong an answer does the AI give the customer?", segments: st.segs, ...(st.note ? { note: st.note } : {}) }];
  if (judged.length) steps.push({ key: "premise", label: "Does it say the critic is right?", segments: pr.segs, ...(pr.note ? { note: pr.note } : {}) });
  const lines: PanelLine[] = [];
  const red = rows.filter((r) => h.activeDests(r.code.redirect_to).size > 0);
  if (red.length) lines.push({ label: `Also points to another ${h.noun}`, value: join(N(num(red.length, all, "answers", refsOf(red, (r) => (r.code.redirect_to ?? [])[0] ?? h.brand))), ` of answers also point to another ${h.noun}`) });
  // Table: what a strong answer argues (the business-case logic, strong vs the rest).
  let table: PanelTable | undefined;
  const rest = rows.filter((r) => r.code.case_strength !== "strong");
  if (strong.length >= CASE_MIN) {
    const hit = (code: string, rs: PoolRow[]) => rs.filter((r) => r.code.reasons?.includes(code));
    const codes = new Set<string>();
    for (const r of strong) for (const c of r.code.reasons ?? []) codes.add(c);
    const gapOn = rest.length >= CASE_MIN;
    const ranked = [...codes]
      .map((code) => ({ code, s: hit(code, strong).length / strong.length, hd: gapOn ? hit(code, rest).length / rest.length : 0, share: hit(code, rows).length / all, k: hit(code, strong).length }))
      .filter((x) => x.k >= ROW_MIN && x.s >= 0.1 && (!gapOn || x.s - x.hd >= GAP_MIN))
      .sort((a, b) => b.s - a.s || a.code.localeCompare(b.code));
    const before = h.omissions?.length ?? 0;
    const kept = filterObvious(ranked, inp.id, "case", h.wordings(inp.cellIntents, inp.criticism ? [inp.criticism] : []), h.scopes, h.category, h.omissions).slice(0, 5);
    const left = (h.omissions?.length ?? 0) > before || kept.length < Math.min(5, ranked.length);
    if (kept.length)
      table = {
        title: "What a strong answer argues",
        sub: gapOn
          ? `The topics that set a strong answer apart. Each share is of the strong answers.${left ? " Topics the question or the criticism already names are left out." : ""}`
          : `There are too few other answers to set them against, so these are the topics strong answers argue most. Each share is of the strong answers.${left ? " Topics the question or the criticism already names are left out." : ""}`,
        columns: gapOn ? ["Strong answers", "Other answers"] : ["Strong answers"],
        style: "bars",
        rows: kept.map((x) => {
          const sh = hit(x.code, strong);
          const oh = hit(x.code, rest);
          const on = num(oh.length, rest.length, "other answers", refsOf(oh, () => x.code));
          return { label: clabel(x.code, h), cells: [num(sh.length, strong.length, "strong answers", refsOf(sh, () => x.code)), ...(gapOn ? [{ t: `${on.value} in other answers`, ...(on.refs ? { refs: on.refs } : {}), tip: on.tip }] : [])] };
        }),
      };
  }
  return {
    kind: "critic",
    claim,
    stackLabel: "How the answer goes",
    steps,
    lines,
    ...(table ? { table } : {}),
  };
}

/* ---------------------------- panel 11: a rival ---------------------------- */

function rivalFull(inp: PanelCellInput, ctx: Ctx, b: PositionBrand, you: ReturnType<typeof funnelNums>, cellConds: PanelConditions | undefined): PanelRival {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const key = h.resolve(b.name).key;
  const R = b.name;
  const them = funnelNums(rows, key, R, h);
  const split = h.brandSplit(rows);
  const theirPicks = split.list.find((x) => x.key === key)?.rows ?? [];
  const mine = split.list.find((x) => x.key === h.targetKey)?.rows ?? [];
  const pf = (name: string) => (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || name;
  const theirShare = num(theirPicks.length, split.n, "picks", refsOf(theirPicks, pf(R)));
  const myShare = num(mine.length, split.n, "picks", refsOf(mine, pf(h.brand)));
  const claim = join(`${R} takes `, N(theirShare), " of the picks here. You take ", N(myShare), ".");
  const missing: string[] = [];
  const steps: PanelStep[] = [];
  const stepOf = (k: PanelStepKey, label: string, y: PanelNum, r: PanelNum): PanelStep => {
    const yk = knOf(y)!;
    const rk = knOf(r)!;
    return { key: k, label, here: y, rivals: [{ name: R, num: r }], tagRank: duelTag(yk, rk, R).tag };
  };
  steps.push(stepOf("named", "Named", you.named, them.named));
  steps.push(stepOf("recommended", "Recommended", you.recommended, them.recommended));
  if (them.f.rec.length >= 10) steps.push(stepOf("converts", "Recommendations that end as the pick", you.converts, them.converts));
  else missing.push("how its recommendations end");
  // The first step where the rival leads with ranges apart.
  let focus: PanelStepKey | undefined;
  for (const s of steps) {
    if (duelTag(knOf(s.here!)!, knOf(s.rivals![0].num)!, R).rivalLeads) {
      s.tagRank = TAG_GAP_OPENS;
      focus = s.key;
      break;
    }
  }
  const details: PanelRival["details"] = {};
  /** You against this rival on one step: -1 it leads (ranges apart), 1 you lead, 0 even. */
  const duelDir = (y: PanelNum, r: PanelNum): StepDir => {
    const d = duelTag(knOf(y)!, knOf(r)!, R);
    return d.rivalLeads ? -1 : d.tag === "Even" ? 0 : 1;
  };
  // Named: named but not recommended, and of those named as one to avoid.
  const nnr = (f: ReturnType<typeof funnelOf>) => f.named.filter((r) => !f.rec.includes(r));
  const nnrR = nnr(them.f);
  const nnrY = nnr(you.f);
  const neg = (rs: PoolRow[], k: string) => rs.filter((r) => (r.code.mentions ?? []).some((m) => m.framing === "negative" && h.resolve(m.brand).key === k));
  if (nnrR.length + nnrY.length >= 5) {
    const negR = neg(nnrR, key);
    const negY = neg(nnrY, h.targetKey);
    const rowsD: RivalStepDetail["rows"] = [
      { label: "Named but not recommended", rival: num(nnrR.length, all, "answers", refsOf(nnrR, (r) => them.f.surf(r, false) ?? R)), you: num(nnrY.length, all, "answers", refsOf(nnrY, (r) => you.f.surf(r, false) ?? h.brand)) },
    ];
    if (nnrR.length >= 5 && nnrY.length >= 5)
      rowsD.push({
        label: `Of those, named as ${article(h.noun)} ${h.noun} to avoid`,
        rival: num(negR.length, nnrR.length, "answers", refsOf(negR, (r) => them.f.surf(r, false) ?? R)),
        you: num(negY.length, nnrY.length, "answers", refsOf(negY, (r) => you.f.surf(r, false) ?? h.brand)),
      });
    const t = steps[0].tagRank ?? "Even";
    details.named = {
      heading: t === "Even" ? "No gap at this step" : t === TAG_GAP_OPENS || t === `${R} leads` ? `${R} is named more often than you` : `You are named more often than ${R}`,
      body: namedLine(duelDir(you.named, them.named), R),
      rows: rowsD,
    };
  } else missing.push("who is named without a recommendation");
  // Recommended: one sentence, then the answers that recommend both of you (new facts; the step bars carry the rest).
  if (them.f.rec.length >= 5 && you.f.rec.length >= 5) {
    const both = rows.filter((r) => them.f.rec.includes(r) && you.f.rec.includes(r));
    const bothR = both.filter((r) => h.pickOf(r).key === key);
    const bothY = both.filter((r) => h.pickOf(r).key === h.targetKey);
    const t = steps[1].tagRank ?? "Even";
    details.recommended = {
      heading: t === "Even" ? "No gap at this step, but this is where you part" : t === TAG_GAP_OPENS || t === `${R} leads` ? `${R} is recommended more often than you` : `You are recommended more often than ${R}`,
      body: recommendedLine(duelDir(you.recommended, them.recommended), R),
      ...(both.length >= 5
        ? {
            both: join(
              "The AI recommends both of you in ",
              N(num(both.length, all, "answers", refsOf(both, pf(R)))),
              ` of answers. In those it picks ${R} `,
              N(num(bothR.length, both.length, "answers recommending both", refsOf(bothR, pf(R)))),
              " of the time and you ",
              N(num(bothY.length, both.length, "answers recommending both", refsOf(bothY, pf(h.brand)))),
              "."
            ),
          }
        : {}),
    };
  } else missing.push("what happens to its recommendations");
  if (them.f.rec.length >= 10 && you.f.rec.length >= 5) {
    const rc = knOf(them.converts)!;
    const yc = knOf(you.converts)!;
    const rr = rc.n ? rc.k / rc.n : 0;
    const yr = yc.n ? yc.k / yc.n : 0;
    const ratio = yr > 0 ? rr / yr : 0;
    // What happens to the recommendations that do not end as the pick (the pick itself is in the step bars).
    const outcome = (recRows: PoolRow[], k: string, name: string, isYou: boolean) => {
      const lost = recRows.filter((r) => h.pickOf(r).status === "active" && h.pickOf(r).key !== k);
      const none = recRows.filter((r) => h.pickOf(r).status !== "active");
      return {
        name,
        ...(isYou ? { you: true as const } : {}),
        lost: num(lost.length, recRows.length, "recommending answers", refsOf(lost, (r) => r.code.top_pick || name)),
        none: num(none.length, recRows.length, "recommending answers", refsOf(none, (r) => verdictFind(r, h))),
      };
    };
    details.converts = {
      heading:
        rr > yr && ratio >= 1.5
          ? `When it has to name one ${h.noun}, it names ${R} ${ratio >= 2.5 ? `${Math.round(ratio)} times` : ratio >= 1.8 ? "twice" : "more"} as often`
          : yr > rr && rr > 0 && yr / rr >= 1.5
            ? `When it has to name one ${h.noun}, it names you more often`
            : "The two convert their recommendations at a similar rate",
      body: convertsLine(duelDir(you.converts, them.converts), `${possOf(R)} do`),
      outcomes: [outcome(them.f.rec, key, R, false), outcome(you.f.rec, h.targetKey, h.brand, true)],
      outcomeLabels: { lost: `lose to another ${h.noun}`, none: "no single pick" },
    };
  }
  // Conditions: rows sending buyers to this rival; your rows as the cell has them.
  const conditions = cellConds
    ? conditionsOf(
        inp,
        ctx,
        {
          title: `When the AI says to choose ${R}, and when you`,
          sub: `Share of these answers that say "choose this ${h.noun} if the buyer...". The rows for ${R} count only the answers that send the buyer to it.`,
          towardTitle: "Choose you if",
          awayTitle: `Choose ${R} if`,
          alsoToward: `Also said for ${R}`,
          alsoAway: "Also said for you",
          toWord: "To",
        },
        { pickKind: true, onlyTo: R, towardRows: cellConds.toward }
      )
    : undefined;
  const a = conditions?.away ?? [];
  const t = conditions?.toward ?? [];
  const lead =
    a.length || t.length
      ? join(
          a.length ? attachedLead(`choosing ${R}`, a.slice(0, 2), "answers") : null,
          a.length && t.length ? " " : null,
          t.length ? attachedLead("choosing you", t.slice(0, 2), "answers") : null
        )
      : undefined;
  const lines: PanelLine[] = [];
  const named1 = (xs: { name: string; num: PanelNum }[]) => xs.find((x) => !/^No specific /.test(x.name));
  const rp = ctx.ladder ? named1(productSplit(theirPicks, (r) => pickedProduct(r, ctx, false), 2, `picks of ${R}`, nounToks(ctx), nameTokens(R, ctx))) : undefined;
  const yp = ctx.ladder && mine.length ? named1(productSplit(mine, (r) => pickedProduct(r, ctx, true), 2, "of your picks", nounToks(ctx), nameTokens(h.brand, ctx))) : undefined;
  if (rp || yp) lines.push({ label: `Which ${h.plural} it picks`, value: join(rp ? join(`${R}: ${rp.name} `, N(rp.num)) : null, rp && yp ? " · " : null, yp ? join(`You: ${yp.name} `, N(yp.num)) : null) });
  const args = b.here?.args ?? [];
  const posA = args.filter((l) => l.value > 0).sort((x, y) => y.value - x.value)[0];
  const negA = args.filter((l) => l.value < 0).sort((x, y) => x.value - y.value)[0];
  // am38: sized, you on the left: what the answer weighs when it picks you, and when it picks R.
  const weighs =
    posA || negA || b.here?.argsRows?.length
      ? weighsCols(
          inp,
          ctx,
          [
            { title: "When it picks you", say: "pick you", tone: "good", rows: mine, ...(negA ? { lead: negA.label } : {}) },
            { title: `When it picks ${R}`, say: `pick ${R}`, tone: "bad", rows: theirPicks, ...(posA ? { lead: posA.label } : b.here?.argsRows?.length ? { lead: b.here.argsRows[0].label } : {}) },
          ],
          WEIGHS_SUB_SIDES,
          { omit: false }
        )
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

/** The smaller rival panel (worries, looking around, value, problem): named, and named as the alternative. */
/** am42: `when` words the weighs columns ("When it names R <when>"); `youAlt` are the answers that
 * name YOU the same way (Value: the answers saying you are worth it), drawn beside the rival's bar. */
function rivalSmall(inp: PanelCellInput, ctx: Ctx, c: { key: string; name: string }, isAlt: (r: PoolRow) => boolean, altLabel: string, o: { when?: string; youAlt?: PoolRow[] } = {}): PanelRival {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const R = c.name;
  const them = funnelOf(rows, c.key, h);
  const youF = funnelOf(rows, h.targetKey, h);
  const alt = rows.filter(isAlt);
  const named = num(them.named.length, all, "answers", refsOf(them.named, (r) => them.surf(r, false) ?? R));
  const yNamed = num(youF.named.length, all, "answers", refsOf(youF.named, (r) => youF.surf(r, false) ?? h.brand));
  const altFind = (r: PoolRow) => (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === c.key)?.brand ?? (r.code.destinations ?? []).find((d) => h.resolve(d).key === c.key) ?? R;
  const altNum = num(alt.length, all, "answers", refsOf(alt, altFind));
  const problem = inp.kind === "problem" || inp.kind === "popular";
  const yAlt = problem ? num(youF.rec.length, all, "answers", refsOf(youF.rec, (r) => youF.surf(r, true) ?? h.brand)) : o.youAlt ? num(o.youAlt.length, all, "answers", refsOf(o.youAlt, (r) => verdictFind(r, h))) : undefined;
  const claim = problem ? join(`The AI recommends ${R} in `, N(altNum), " of these answers.") : join(`The AI names ${R} ${o.youAlt ? o.when : "as the alternative"} in `, N(altNum), " of these answers.");
  const steps: PanelStep[] = [
    // am42: outside the open questions the question itself names you, so "you named" is always everything and is not drawn.
    problem ? { key: "named", label: "Named", here: yNamed, rivals: [{ name: R, num: named }], tagRank: duelTag(knOf(yNamed)!, knOf(named)!, R).tag } : { key: "named", label: "Named", rivals: [{ name: R, num: named }] },
    { key: "recommended", label: altLabel, ...(yAlt ? { here: yAlt, tagRank: duelTag(knOf(yAlt)!, knOf(altNum)!, R).tag } : {}), rivals: [{ name: R, num: altNum }] },
  ];
  const lines: PanelLine[] = [];
  const surf = (r: PoolRow) => productLabel(them.surf(r, false) ?? altFind(r), R, ctx) ?? noneName(ctx);
  if (alt.length >= 5 && ctx.ladder) {
    const items = productSplit(alt, surf, 2, "answers naming it", nounToks(ctx), nameTokens(R, ctx));
    if (namesAProduct(items)) lines.push({ label: `Which of its ${h.plural} it names`, value: splitLine(items) });
  }
  // am38: sized, over the answers that name it as the alternative.
  // am42: set against the cell's other answers, so the topics every answer weighs drop out (the versus rule).
  const altSet = new Set(alt);
  const rest = rows.filter((r) => !altSet.has(r));
  const weighs = o.when
    ? weighsCols(inp, ctx, [{ title: `When it names ${R} ${o.when}`, say: `name ${R}`, tone: "bad", rows: alt }, { title: "When it does not", say: "leave it out", tone: "neutral", rows: rest }], WEIGHS_SUB_NAMING, { omit: false })
    : weighsCols(inp, ctx, [{ say: "name it", tone: "neutral", rows: alt }], WEIGHS_SUB_NAMING, { omit: false });
  return {
    name: R,
    full: false,
    claim,
    steps,
    lines,
    ...(weighs ? { weighs } : {}),
    ...(alt.length < 5 ? { thin: THIN_RIVAL(R, "more than its numbers") } : {}),
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
};
/** The segment a verdict step compares with the usual, and its noun. */
const SEG_CMP: Partial<Record<PanelKind, Partial<Record<PanelStepKey, [string, string, boolean]>>>> = {
  buyer_worry: { verdict: ["proceed", "go-aheads", true] },
  customer_worry: { verdict: ["leave", "leave answers", false] },
  value: { worth: ["yes", "worth-it answers", true], instead: ["rival", "answers pointing to rivals", false] },
};

function finishPanel(inp: PanelCellInput, p: PositionPanel, up: PositionPanel | undefined, u: PanelCellInput | undefined, ctx: Ctx) {
  const thin = inp.rows.length < PANEL_MIN;
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
  const OTHER: Partial<Record<PanelKind, [string, "about" | "close"]>> = { popular: ["chooses:open:all", "about"], learning: ["chooses:awareness:all", "close"] };
  const other = OTHER[p.kind];
  if (other && !thin) {
    const o = ctx.inputs.get(other[0]);
    const name = (p.kind === "popular" ? ROW_NAME.open : ROW_NAME.awareness).toLowerCase();
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
    verdictTakeaways(inp, p, ctx);
    // am37: a head-to-head's "picks one of the two" step always carries a plain tag (the all-rivals cell has no usual).
    for (const s of p.steps)
      if (s.key === "decided" && s.here && !s.tagUsual) {
        const t = s.here.pct >= 50 ? "Usually picks one of the two" : "Usually picks neither";
        s.tagUsual = t;
        s.tagUsualTone = "neutral";
      }
    for (const s of p.steps) if (s.key === "decided" && s.tagUsual && !s.tagRank) { s.tagRank = s.tagUsual; s.tagRankTone = s.tagUsualTone; }
    detailOf(inp, p, up, ctx);
    stepDetailsOf(inp, p, u, ctx);
    extremeFacts(inp, p, ctx);
    // am37: the highlighted step is one that explains itself (a step a reader can select has an explanation).
    if (p.details && p.focus && !p.details[p.focus]) p.focus = p.steps.find((s) => !!p.details![s.key])?.key;
    if (p.detailsComp && p.focusComp && !p.detailsComp[p.focusComp]) p.focusComp = p.steps.find((s) => !!p.detailsComp![s.key])?.key;
  }
}

/** am37: you are behind on the picks in this cell (the pick kinds); "lose" and "gap" are said only then. */
function behindOf(inp: PanelCellInput, ctx: Ctx): boolean {
  if (inp.kind !== "buy" && inp.kind !== "switching" && inp.kind !== "popular") return false;
  return behindOnPicks(ctx.h.brandSplit(inp.rows), ctx.h);
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
const TAKEAWAY_KINDS = new Set<PanelKind>(["value", "buyer_worry", "customer_worry", "looking_around", "expansion", "business_case", "critic", "alongside", "criteria"]);
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
function verdictTakeaways(inp: PanelCellInput, p: PositionPanel, ctx: Ctx) {
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
    else if (p.kind === "expansion" && s.key === "stance") t = stanceTakeaway(segPct(s, "backs"), segPct(s, "neutral"), segPct(s, "redirects"));
    else if (p.kind === "business_case" && s.key === "strength") t = caseTakeaway(segPct(s, "strong"), segPct(s, "hedged"), segPct(s, "undermined"));
    else if (p.kind === "critic" && s.key === "strength") t = criticStrengthTakeaway(segPct(s, "strong"), segPct(s, "partial"), segPct(s, "concedes"));
    else if (p.kind === "critic" && s.key === "premise") t = premiseTakeaway(segPct(s, "rebuts"), segPct(s, "mixed"), segPct(s, "confirms"));
    else if (p.kind === "alongside" && s.key === "alongside") {
      const all = inp.rows.length || 1;
      const rel = (x: string) => (100 * inp.rows.filter((r) => (r.code.pairings ?? []).some((q) => q.maker_relation === x && !(x === "own" && isBareBrand(q.name, ctx)))).length) / all;
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
      p.detail = funnelDetail(f, who, behindOf(inp, ctx));
    }
    const fs = p.focusComp ? p.steps.find((s) => s.key === p.focusComp) : undefined;
    const d = rankDetail(p.focusComp ?? null, fs && fs.here && fs.rivals ? { label: fs.label, here: fs.here, rivals: fs.rivals } : null);
    if (d) p.detailComp = d;
    return;
  }
  const det = (heading: string, body: PanelText): PanelDetail => ({ heading, body });
  if (p.kind === "popular" || p.kind === "learning") {
    const fs = p.focusComp ? p.steps.find((x) => x.key === p.focusComp) : undefined;
    const d = rankDetail(p.focusComp ?? null, fs && fs.here && fs.rivals ? { label: fs.label, here: fs.here, rivals: fs.rivals } : null);
    if (d) p.detailComp = d;
  }
  // A panel set against the average competitor explains itself step by step (details).
  if (p.avgComp && (p.kind === "popular" || p.kind === "learning")) return;
  switch (p.kind) {
    case "popular": {
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
      const v = inp.rows;
      const str = v.filter((r) => r.code.relationship_verdict === "strengthens").length;
      const weak = v.filter((r) => r.code.relationship_verdict === "weakens").length;
      const heading = weak === 0 ? "The AI builds on what the customer already has with you" : weak > str ? "The AI more often works against what the customer has with you" : "The AI mostly builds on what the customer has with you";
      p.detail = alongsideDetail(heading);
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
      return;
    }
    case "customer_worry": {
      const v = p.steps.find((s) => s.key === "verdict");
      if (!v?.segments) return;
      const side = keepSideOf(v);
      const key = side === "stay" ? "keep" : side === "none" ? "none" : "leave";
      const often = segOften(v, up?.steps.find((s) => s.key === "verdict"), key);
      const leaveRows = inp.rows.filter((r) => r.code.keep_or_leave === "leave");
      const noDest = leaveRows.filter((r) => h.activeDests(r.code.destinations).size === 0).length;
      const agreesPct = p.steps.find((s) => s.key === "agrees")?.here?.pct ?? 0;
      p.detail = customerWorryDetail({
        side,
        stayMajority: segPct(v, "keep") >= 50,
        granted: agreesPct >= 50,
        often,
        topRival: topRivalOf(p),
        // am37: no leave clause when almost no answer says leave.
        leaveRare: segPct(v, "leave") < 5,
        leaveNoDest: side !== "stay" && leaveRows.length > 0 && noDest > leaveRows.length / 2,
        noun: h.noun,
      });
      return;
    }
    case "looking_around": {
      const v = p.steps.find((s) => s.key === "verdict");
      const offers = p.steps.find((s) => s.key === "offers")?.here;
      if (!v?.segments || !offers) return;
      const side = keepSideOf(v);
      p.detail = lookingAroundDetail({ side: segPct(v, "leave") >= 30 ? "leave" : side, showsMost: offers.pct >= 50, topRival: topRivalOf(p) });
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
    case "criteria": {
      p.detail = criteriaDetail(!!p.steps.find((s) => s.key === "taught")?.note?.length, h.plural);
      return;
    }
    case "expansion": {
      const s = p.steps.find((x) => x.key === "stance");
      const top = [...(s?.segments ?? [])].sort((a, b) => b.num.pct - a.num.pct)[0];
      p.detail = expansionDetail(top?.key === "backs" ? "backs" : top?.key === "redirects" ? "redirects" : "neutral");
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
      return;
    }
  }
}

/* ------------- am34: what explains each step (the clicked step card) ------------- */

/** The kinds whose stack is a funnel of `here` steps; their steps carry details. */
const STEP_DETAIL_KINDS = new Set<PanelKind>(["buy", "switching", "problem", "popular", "learning", "h2h"]);
/** A detail never rests on fewer answers than this. */
const DETAIL_MIN = 5;

/** Where a panel's usual comes from and how a sentence names it. */
function usualFor(inp: PanelCellInput, u: PanelCellInput | undefined, ctx: Ctx): { rows: PoolRow[]; you?: PoolRow[]; them?: PoolRow[]; phrase: string; column: string } | null {
  if (inp.kind === "popular" || inp.kind === "learning") {
    const o = ctx.inputs.get(inp.kind === "popular" ? "chooses:open:all" : "chooses:awareness:all");
    if (!o || o.rows.length < PANEL_MIN) return null;
    return inp.kind === "popular"
      ? { rows: o.rows, phrase: `when buyers ask ${ROW_NAME.open.toLowerCase()}`, column: ROW_NAME.open }
      : { rows: o.rows, phrase: "when buyers describe a problem", column: ROW_NAME.awareness };
  }
  if (!u || u.rows.length < PANEL_MIN) return null;
  if (inp.kind === "switching") return { rows: u.rows, phrase: "across all rivals' customers", column: "All rivals' customers" };
  if (inp.kind === "h2h") return { rows: u.rows, you: u.you, them: u.them, phrase: "across all your head-to-heads", column: "All head-to-heads" };
  return { rows: u.rows, phrase: "across all buyers", column: "All buyers" };
}

function stepDetailsOf(inp: PanelCellInput, p: PositionPanel, u: PanelCellInput | undefined, ctx: Ctx) {
  if (!STEP_DETAIL_KINDS.has(p.kind) || inp.rows.length < DETAIL_MIN) return;
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const usual = usualFor(inp, u, ctx);
  const picks = p.kind === "buy" || p.kind === "switching" || p.kind === "popular";
  const step = (k: PanelStepKey) => p.steps.find((s) => s.key === k && !!s.here);
  type Fn = ReturnType<typeof funnelOf>;
  const surfOf = (f: Fn, name: string, rec: boolean) => (r: PoolRow) => f.surf(r, rec) ?? r.code.top_pick ?? name;
  const pf = (name: string) => (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || name;
  const nnr = (f: Fn) => f.named.filter((r) => !f.rec.includes(r));
  const negOf = (rs: PoolRow[], k: string) => rs.filter((r) => (r.code.mentions ?? []).some((m) => m.framing === "negative" && h.resolve(m.brand).key === k));
  const rate = (x: KN) => (x.n > 0 ? x.k / x.n : 0);
  /** Direction of you against the comparison: -1 below (or none here against some), 1 above, 0 about. */
  const dirOf = (a: KN, b: KN): StepDir => (rate(a) === 0 && rate(b) > 0 ? -1 : usualDir(a, b));
  /** Example answers drawn in turn from several brands' rows, each found by its own brand. */
  const refsMulti = (parts: { rows: PoolRow[]; find: (r: PoolRow) => string }[]): AnswerRef[] => {
    const seen = new Set<string>();
    const items: { id: string; find: string; model: string }[] = [];
    const most = Math.max(0, ...parts.map((x) => x.rows.length));
    for (let i = 0; i < most; i++)
      for (const pt of parts) {
        const r = pt.rows[i];
        if (!r || seen.has(r.code.response_id)) continue;
        seen.add(r.code.response_id);
        items.push({ id: r.code.response_id, find: pt.find(r), model: r.model });
      }
    return spreadRefs(items, PANEL_REFS);
  };
  type Other = { f: Fn; n: number; key: string; name: string };
  const youF = funnelOf(rows, h.targetKey, h);
  const sumOf = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  /** Named but not recommended, and of those named as one to avoid: you against one or more other funnels taken together. */
  const namedRowsOf = (others: Other[]) => {
    const a = nnr(youF);
    const bs = others.map((o) => ({ o, rs: nnr(o.f) }));
    const bk = sumOf(bs.map((x) => x.rs.length));
    const bn = sumOf(others.map((o) => o.n));
    if (a.length + bk < DETAIL_MIN) return undefined;
    const out: { label: string; rival: PanelNum; you: PanelNum }[] = [
      {
        label: "Named but not recommended",
        rival: num(bk, bn, "answers", refsMulti(bs.map((x) => ({ rows: x.rs, find: surfOf(x.o.f, x.o.name, false) })))),
        you: num(a.length, all, "answers", refsOf(a, surfOf(youF, h.brand, false))),
      },
    ];
    if (a.length >= DETAIL_MIN && bk >= DETAIL_MIN) {
      const na = negOf(a, h.targetKey);
      const nb = bs.map((x) => ({ x, rs: negOf(x.rs, x.o.key) }));
      out.push({
        label: `Of those, named as ${article(h.noun)} ${h.noun} to avoid`,
        rival: num(sumOf(nb.map((y) => y.rs.length)), bk, "answers named but not recommended", refsMulti(nb.map((y) => ({ rows: y.rs, find: surfOf(y.x.o.f, y.x.o.name, false) })))),
        you: num(na.length, a.length, "answers named but not recommended", refsOf(na, surfOf(youF, h.brand, false))),
      });
    }
    return out;
  };
  /** What happens to recommendations that do not end as the pick: another <noun> picked, or no single pick. The pick itself is in the step bars. */
  const outcomeMulti = (parts: { rec: PoolRow[]; key: string; name: string }[], name: string, extra: { you?: true; usual?: true }) => {
    const lost = parts.map((pt) => ({ pt, rs: pt.rec.filter((r) => h.pickOf(r).status === "active" && h.pickOf(r).key !== pt.key) }));
    const none = parts.map((pt) => ({ pt, rs: pt.rec.filter((r) => h.pickOf(r).status !== "active") }));
    const n = sumOf(parts.map((pt) => pt.rec.length));
    return {
      name,
      ...extra,
      lost: num(sumOf(lost.map((x) => x.rs.length)), n, "recommending answers", refsMulti(lost.map((x) => ({ rows: x.rs, find: (r: PoolRow) => r.code.top_pick || x.pt.name })))),
      none: num(sumOf(none.map((x) => x.rs.length)), n, "recommending answers", refsMulti(none.map((x) => ({ rows: x.rs, find: (r: PoolRow) => verdictFind(r, h) })))),
    };
  };
  const outcomeLabels = { lost: `lose to another ${h.noun}`, none: "no single pick" };
  /** Who takes the pick when the AI recommends you and picks another <noun>: top 3, rows of 3+ answers. */
  const takersList = (): PanelStepDetail["list"] => {
    if (!picks) return undefined;
    const lost = youF.rec.filter((r) => h.pickOf(r).status === "active" && h.pickOf(r).key !== h.targetKey);
    if (lost.length < DETAIL_MIN) return undefined;
    const by = h.brandSplit(lost).list.filter((b) => b.key !== h.targetKey && b.rows.length >= 3).slice(0, 3);
    if (!by.length) return undefined;
    return { title: takersTitle(h.noun), rows: by.map((b) => ({ label: b.name, num: num(b.rows.length, lost.length, "answers that recommend you and pick another", refsOf(b.rows, pf(b.name))) })) };
  };
  // am37: "why you lose" only when you are behind on the picks here; otherwise the heading states the fact.
  const behindPicks = behindOf(inp, ctx);
  const namedHead = (dir: StepDir, than: string) =>
    behindPicks
      ? dir < 0
        ? "Being left out is part of why you lose here"
        : "Being left out is not why you lose here"
      : dir < 0
        ? `You are named less often here than ${than}`
        : dir > 0
          ? `You are named more often here than ${than}`
          : `You are named about as often here as ${than}`;
  const names = p.competitorOrder ?? [];
  const comps = names.map((name) => {
    const key = h.resolve(name).key ?? name;
    return { name, key, f: funnelOf(rows, key, h) };
  });
  const youNamed: KN = { k: youF.named.length, n: all };
  const youRec: KN = { k: youF.rec.length, n: all };
  const youConv: KN = { k: youF.picked.length, n: youF.rec.length };

  /* -------- normal view: here against the usual, or against the average competitor -------- */
  const details: Partial<Record<PanelStepKey, PanelStepDetail>> = {};
  if (p.kind === "h2h") {
    const dec = step("decided");
    const won = p.steps.find((s) => s.key === "won");
    const R = inp.pooled ? "your named rivals" : inp.rivalName ?? inp.label;
    const other = rows.filter((r) => h.pickOf(r).status === "active" && !inp.you.includes(r) && !inp.them.includes(r));
    const none = rows.filter((r) => h.pickOf(r).status !== "active");
    if (dec?.here) {
      const restRows = [
        { label: `Picks another ${h.noun}`, num: num(other.length, all, "answers", refsOf(other, (r) => r.code.top_pick || h.brand)) },
        { label: "No single pick", num: num(none.length, all, "answers", refsOf(none, (r) => verdictFind(r, h))) },
      ].filter((x) => (knOf(x.num)?.k ?? 0) >= 3);
      details.decided = {
        heading: dec.here.pct >= 50 ? "The AI mostly picks one of the two" : "The AI mostly declines to pick one of the two",
        body: decidedLine(dec.here.pct >= 50),
        ...(restRows.length ? { list: { title: "When it picks neither of the two", rows: restRows } } : {}),
      };
    }
    if (won?.here && won.vs) {
      const d = inp.you.length + inp.them.length;
      if (d >= DETAIL_MIN) {
        const w = won.here.pct;
        details.won = {
          heading: w >= 60 ? "When it picks one of the two, it mostly picks you" : w <= 40 ? `When it picks one of the two, it mostly picks ${inp.pooled ? "the rival" : R}` : "When it picks one of the two, it is close",
          body: wonLine(w >= 60 ? "you" : w <= 40 ? "rival" : "close"),
        };
      }
    }
  } else {
    // The comparison the switch-off view draws: your usual, else the competitors taken together.
    const avg = !!p.avgComp && comps.length > 0;
    const side = avg
      ? {
          others: comps.map((c) => ({ f: c.f, n: all, key: c.key, name: c.name })) as Other[],
          than: "the average competitor",
          thanDo: "the average competitor's do",
          columns: { you: "You", rival: AVG_COMP, rivalIsUsual: true as const },
          youName: "You",
          otherName: AVG_COMP,
          otherExtra: {},
        }
      : usual
      ? (() => {
          const uF = funnelOf(usual.rows, h.targetKey, h);
          return {
            others: [{ f: uF, n: usual.rows.length, key: h.targetKey, name: h.brand }] as Other[],
            than: usual.phrase,
            thanDo: `they do ${usual.phrase}`,
            columns: { you: "Here", rival: usual.column, rivalIsUsual: true as const },
            youName: "Here",
            otherName: usual.column,
            otherExtra: { you: true as const, usual: true as const },
          };
        })()
      : null;
    if (side) {
      const oNamed: KN = { k: sumOf(side.others.map((o) => o.f.named.length)), n: sumOf(side.others.map((o) => o.n)) };
      const oRec: KN = { k: sumOf(side.others.map((o) => o.f.rec.length)), n: sumOf(side.others.map((o) => o.n)) };
      const oRecN = sumOf(side.others.map((o) => o.f.rec.length));
      const oConv: KN = { k: sumOf(side.others.map((o) => o.f.picked.length)), n: oRecN };
      const nm = step("named");
      if (nm?.here) {
        const dir = dirOf(youNamed, oNamed);
        const r = namedRowsOf(side.others);
        details.named = {
          heading: namedHead(dir, side.than),
          body: namedLine(dir, side.than, behindPicks),
          ...(r ? { columns: side.columns, rows: r } : {}),
        };
      }
      const rc = step("recommended");
      if (rc?.here && p.kind !== "learning") {
        const dir = dirOf(youRec, oRec);
        const list = takersList();
        details.recommended = {
          heading: dir < 0 ? `You are recommended less often here than ${side.than}` : dir > 0 ? `You are recommended more often here than ${side.than}` : `You are recommended about as often here as ${side.than}`,
          body: recommendedLine(dir, side.than, behindPicks),
          ...(list ? { list } : {}),
        };
      }
      const cv = step("converts");
      if (cv?.here && youF.rec.length >= DETAIL_MIN) {
        const dir = oRecN >= DETAIL_MIN ? dirOf(youConv, oConv) : 0;
        const outcomes = [
          outcomeMulti([{ rec: youF.rec, key: h.targetKey, name: h.brand }], side.youName, { you: true }),
          ...(oRecN >= DETAIL_MIN ? [outcomeMulti(side.others.map((o) => ({ rec: o.f.rec, key: o.key, name: o.name })), side.otherName, side.otherExtra)] : []),
        ];
        details.converts = {
          heading: dir < 0 ? "Fewer of your recommendations end as the pick here" : dir > 0 ? "More of your recommendations end as the pick here" : "Your recommendations end as the pick about as often here",
          body: convertsLine(dir, side.thanDo, behindPicks),
          ...(outcomes.length > 1 ? { outcomes, outcomeLabels } : {}),
        };
      }
    }
  }

  /* -------- comparison view: you against the competitors -------- */
  const detailsComp: Partial<Record<PanelStepKey, PanelStepDetail>> = {};
  // am41: "the answer names one <noun> as the pick" explains itself - what the answer does instead, who gets
  // the pick when there is one, and which AI companies name one. The same in both views (it is not about a brand).
  const sec = (title: string, sub: string, tone: PanelTone, items: { label: string; rs: PoolRow[]; n: number; unit: string; find: (r: PoolRow) => string }[], few: string): PanelDetailSection | null => {
    const ok = items.filter((x) => x.rs.length >= ROW_MIN).sort((a, b) => b.rs.length / b.n - a.rs.length / a.n || a.label.localeCompare(b.label));
    if (!ok.length && !items.some((x) => x.rs.length > 0)) return null;
    return { title, sub, tone, rows: ok.map((x) => ({ label: x.label, num: num(x.rs.length, x.n, x.unit, refsOf(x.rs, x.find)) })), ...(ok.length ? {} : { note: join(few) }) };
  };
  const byVendor = new Map<string, PoolRow[]>();
  for (const r of rows) {
    const v = engineFacets(r.model).vendor;
    byVendor.set(v, [...(byVendor.get(v) ?? []), r]);
  }
  /** The share of each AI company's answers in `hit`, as section rows. */
  const vendorItems = (hit: PoolRow[], find: (r: PoolRow) => string) => [...byVendor.entries()].filter(([, rs]) => rs.length >= ROW_MIN).map(([label, rs]) => ({ label, rs: rs.filter((r) => hit.includes(r)), n: rs.length, unit: `${label} answers`, find }));
  const cm = p.kind === "popular" ? step("commits") : undefined;
  if (cm?.here) {
    const picked = rows.filter((r) => h.pickOf(r).status === "active");
    const depends = rows.filter((r) => !picked.includes(r) && r.code.outcome === "conditional");
    const lists = rows.filter((r) => !picked.includes(r) && r.code.outcome !== "conditional");
    const byBrand = new Map<string, PoolRow[]>();
    for (const r of picked) {
      const nm = h.pickOf(r).name ?? r.code.top_pick ?? "";
      if (nm) byBrand.set(nm, [...(byBrand.get(nm) ?? []), r]);
    }
    const sections = [
      sec(COMMITS_TEXT.instead.title, COMMITS_TEXT.instead.sub, "neutral", [
        { label: COMMITS_TEXT.depends, rs: depends, n: all, unit: "answers", find: (r) => verdictFind(r, h) },
        { label: COMMITS_TEXT.lists, rs: lists, n: all, unit: "answers", find: (r) => verdictFind(r, h) },
      ], COMMITS_TEXT.instead.few),
      sec(COMMITS_TEXT.who.title, COMMITS_TEXT.who.sub, "neutral", [...byBrand.entries()].map(([label, rs]) => ({ label, rs, n: picked.length, unit: "answers that name one pick", find: (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || label })), COMMITS_TEXT.who.few),
      picked.length < ROW_MIN ? null : sec(COMMITS_TEXT.vendor.title, COMMITS_TEXT.vendor.sub, "neutral", vendorItems(picked, (r) => h.quoteOf(r) || r.code.top_pick || h.brand), COMMITS_TEXT.vendor.few),
    ].filter((x): x is PanelDetailSection => !!x);
    const side: CommitsSide = picked.length * 2 >= all ? "picks" : depends.length * 2 >= all ? "depends" : lists.length * 2 >= all ? "lists" : depends.length > lists.length ? "leans_depends" : lists.length > depends.length ? "leans_lists" : "split";
    const d: PanelStepDetail = { ...commitsDetail(side, h.noun), ...(sections.length ? { sections } : {}) };
    details.commits = d;
    if (p.compare) detailsComp.commits = d;
  }
  // am41: "the answer points the buyer to <plural>" (Spotting the problem) - where the rest go, what they name there, and which AI companies stay in the category.
  const cg = p.kind === "problem" ? step("category") : undefined;
  if (cg?.here) {
    const inCat = rows.filter((r) => r.code.category_routed === "category");
    const adjacent = rows.filter((r) => r.code.category_routed === "adjacent");
    const nowhere = rows.filter((r) => r.code.category_routed !== "category" && r.code.category_routed !== "adjacent");
    const outside = new Map<string, { name: string; rs: PoolRow[] }>();
    for (const r of adjacent) {
      const seen = new Set<string>();
      for (const m of r.code.mentions ?? []) {
        if (m.framing !== "recommended") continue;
        const res = h.resolve(m.brand);
        if (res.status === "active" || seen.has(res.key ?? m.brand)) continue;
        seen.add(res.key ?? m.brand);
        const k = res.key ?? m.brand.toLowerCase();
        const t = outside.get(k) ?? { name: res.name ?? m.brand, rs: [] };
        t.rs.push(r);
        outside.set(k, t);
      }
    }
    const vf = (r: PoolRow) => verdictFind(r, h);
    const sections = [
      sec(ROUTED_TEXT.rest.title, ROUTED_TEXT.rest.sub, "neutral", [
        { label: ROUTED_TEXT.adjacent(h.plural), rs: adjacent, n: all, unit: "answers", find: vf },
        { label: ROUTED_TEXT.nowhere, rs: nowhere, n: all, unit: "answers", find: vf },
      ], ROUTED_TEXT.rest.few),
      sec(ROUTED_TEXT.names.title, ROUTED_TEXT.names.sub(h.plural), "bad", [...outside.values()].sort((a, b) => b.rs.length - a.rs.length).slice(0, 5).map((x) => ({ label: x.name, rs: x.rs, n: adjacent.length, unit: "answers that point elsewhere", find: () => x.name })), ROUTED_TEXT.names.few),
      sec(ROUTED_TEXT.vendor.title(h.plural), ROUTED_TEXT.vendor.sub, "neutral", vendorItems(inCat, vf), ROUTED_TEXT.vendor.few),
    ].filter((x): x is PanelDetailSection => !!x);
    const share = all ? inCat.length / all : 0;
    const d: PanelStepDetail = { ...routedDetail(share >= 0.9 ? "nearly" : share >= 0.5 ? "usually" : adjacent.length >= nowhere.length ? "elsewhere" : "nowhere", h.plural), ...(sections.length ? { sections } : {}) };
    details.category = d;
    if (p.compare) detailsComp.category = d;
  }
  // am41: "the answer names any brand" (Learning the category) - which AI companies name brands on a question that asks for none.
  const ab = p.kind === "learning" ? step("anybrand") : undefined;
  if (ab?.here) {
    const any = rows.filter((r) => (r.code.mentions ?? []).some((m) => h.resolve(m.brand).status === "active"));
    const sections = [sec(ANYBRAND_TEXT.vendor.title, ANYBRAND_TEXT.vendor.sub, "neutral", vendorItems(any, (r) => (r.code.mentions ?? []).find((m) => h.resolve(m.brand).status === "active")?.brand ?? h.brand), ANYBRAND_TEXT.vendor.few)].filter((x): x is PanelDetailSection => !!x);
    const share = all ? any.length / all : 0;
    const d: PanelStepDetail = { ...anyBrandDetail(share >= 0.5 ? "usually" : share >= 0.2 ? "sometimes" : "rarely", h.plural), ...(sections.length ? { sections } : {}) };
    details.anybrand = d;
    if (p.compare) detailsComp.anybrand = d;
  }
  // am42: "named, when the answer names a brand" (Learning the category) - who is named when you are not, who is
  // named first, which of your products, and which AI companies name you. Shares of the answers that name a brand.
  const nw = p.kind === "learning" ? step("namedwhen") : undefined;
  if (nw?.here) {
    const activeOf = (r: PoolRow) => {
      const out: { key: string; name: string; rank: number; raw: string }[] = [];
      for (const m of r.code.mentions ?? []) {
        const res = h.resolve(m.brand);
        if (res.status !== "active" || !res.key || out.some((x) => x.key === res.key)) continue;
        out.push({ key: res.key, name: res.key === h.targetKey ? h.brand : res.name ?? m.brand, rank: m.rank ?? out.length + 1, raw: m.brand });
      }
      return out.sort((x, y) => x.rank - y.rank);
    };
    const base = rows.map((r) => ({ r, act: activeOf(r) })).filter((x) => x.act.length > 0);
    const n = base.length;
    const withYou = base.filter((x) => x.act.some((a) => a.key === h.targetKey));
    const without = base.filter((x) => !x.act.some((a) => a.key === h.targetKey));
    const group = (xs: typeof base, pick: (x: (typeof base)[number]) => { key: string; name: string }[]) => {
      const m = new Map<string, { name: string; rs: PoolRow[] }>();
      for (const x of xs) for (const a of pick(x)) m.set(a.key, { name: a.name, rs: [...(m.get(a.key)?.rs ?? []), x.r] });
      return [...m.values()].sort((a, b) => b.rs.length - a.rs.length || a.name.localeCompare(b.name));
    };
    const others = group(without, (x) => x.act).slice(0, 5);
    const first = group(base, (x) => [x.act[0]]);
    const firstShown = [...first.filter((x) => x.name === h.brand), ...first.filter((x) => x.name !== h.brand).slice(0, 3)];
    const prods = new Map<string, PoolRow[]>();
    if (ctx.ladder)
      for (const x of withYou)
        for (const m of x.r.code.mentions ?? []) {
          if (h.resolve(m.brand).key !== h.targetKey) continue;
          const pl = productLabel(m.brand, h.brand, ctx);
          if (pl && !(prods.get(pl) ?? []).includes(x.r)) prods.set(pl, [...(prods.get(pl) ?? []), x.r]);
        }
    const baseRows = new Set(base.map((x) => x.r));
    const youRows = withYou.map((x) => x.r);
    const vend = [...byVendor.entries()].map(([label, rs]) => ({ label, in: rs.filter((r) => baseRows.has(r)) })).filter((v) => v.in.length >= ROW_MIN).map((v) => ({ label: v.label, rs: v.in.filter((r) => youRows.includes(r)), n: v.in.length, unit: `${v.label} answers that name a brand`, find: (r: PoolRow) => activeOf(r).find((a) => a.key === h.targetKey)?.raw ?? h.brand }));
    const item = (unit: string, tot: number) => (x: { name: string; rs: PoolRow[] }) => ({ label: x.name === h.brand ? "You" : x.name, rs: x.rs, n: tot, unit, find: () => x.name });
    const sections = [
      sec(NAMEDWHEN_TEXT.others.title, NAMEDWHEN_TEXT.others.sub, "bad", others.map(item("answers that name a brand but not you", without.length)), NAMEDWHEN_TEXT.others.few),
      sec(NAMEDWHEN_TEXT.first.title, NAMEDWHEN_TEXT.first.sub, "neutral", firstShown.map(item("answers that name a brand", n)), NAMEDWHEN_TEXT.first.few),
      prods.size >= 2 ? sec(NAMEDWHEN_TEXT.products.title(h.plural), NAMEDWHEN_TEXT.products.sub, "good", [...prods.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5).map(([label, rs]) => ({ label, rs, n: withYou.length, unit: "answers that name you", find: () => label })), NAMEDWHEN_TEXT.products.few) : null,
      sec(NAMEDWHEN_TEXT.vendor.title, NAMEDWHEN_TEXT.vendor.sub, "good", vend, NAMEDWHEN_TEXT.vendor.few),
    ].filter((x): x is PanelDetailSection => !!x);
    const share = n ? withYou.length / n : 0;
    const d: PanelStepDetail = { ...namedWhenDetail(share >= 0.5 ? "usually" : share >= 0.2 ? "sometimes" : "rarely"), ...(sections.length ? { sections } : {}) };
    details.namedwhen = d;
    if (p.compare) detailsComp.namedwhen = d;
  }
  if (p.compare && names.length) {
    const nm = step("named");
    if (nm?.here && nm.rivals?.length) {
      const lead = [...nm.rivals].sort((a, b) => b.num.pct - a.num.pct)[0];
      const lc = comps.find((c) => c.name === lead.name)!;
      const ahead = shownPct(lead.num) > shownPct(nm.here);
      const dir = dirOf(knOf(nm.here)!, knOf(lead.num)!);
      const r = namedRowsOf([{ f: lc.f, n: all, key: lc.key, name: lc.name }]);
      detailsComp.named = {
        heading:
          dir < 0
            ? namedHead(dir, lead.name)
            : ahead && behindPicks
              ? `${lead.name} is named a little more often, but being left out is not mainly why you lose here`
              : ahead
                ? `${lead.name} is named a little more often than you here`
                : dir > 0
                  ? "You are named more often than any competitor shown"
                  : `You and ${lead.name} are named about as often here`,
        body: namedLine(dir, lead.name, behindPicks),
        ...(r ? { columns: { you: "You", rival: lead.name }, rows: r } : {}),
      };
    }
    const rc = step("recommended");
    if (rc?.here && rc.rivals?.length) {
      const lead = [...rc.rivals].sort((a, b) => b.num.pct - a.num.pct)[0];
      const ahead = shownPct(lead.num) > shownPct(rc.here);
      const dir = dirOf(knOf(rc.here)!, knOf(lead.num)!);
      const list = takersList();
      detailsComp.recommended = {
        heading: dir < 0 ? `${lead.name} is recommended more often than you here` : dir > 0 && !ahead ? "You are recommended more often than any competitor shown" : `You and ${lead.name} are recommended about as often here`,
        body: recommendedLine(dir, lead.name, behindPicks),
        ...(list ? { list } : {}),
      };
    }
    const cv = step("converts");
    if (cv?.here && cv.rivals?.length && youF.rec.length >= DETAIL_MIN) {
      const ok = cv.rivals.filter((x) => (knOf(x.num)?.n ?? 0) >= DETAIL_MIN);
      const best = [...ok].sort((a, b) => b.num.pct - a.num.pct)[0];
      if (best) {
        const ahead = shownPct(best.num) > shownPct(cv.here);
        const dir = dirOf(knOf(cv.here)!, knOf(best.num)!);
        const recOk = comps.filter((c) => c.f.rec.length >= DETAIL_MIN).sort((a, b) => rate({ k: b.f.picked.length, n: b.f.rec.length }) - rate({ k: a.f.picked.length, n: a.f.rec.length }) || a.name.localeCompare(b.name));
        const outcomes = [
          outcomeMulti([{ rec: youF.rec, key: h.targetKey, name: h.brand }], "You", { you: true }),
          ...recOk.map((c) => outcomeMulti([{ rec: c.f.rec, key: c.key, name: c.name }], c.name, {})),
        ];
        detailsComp.converts = {
          heading: dir < 0 ? `${best.name} turns more of its recommendations into the pick` : dir > 0 && !ahead ? "You turn more of your recommendations into the pick than any competitor shown" : `You and ${best.name} turn about as many recommendations into the pick`,
          body: convertsLine(dir, `${possOf(best.name)} do`, behindPicks),
          ...(outcomes.length > 1 ? { outcomes, outcomeLabels } : {}),
        };
      }
    }
  }
  // The all-rivals head-to-head explains its steps the same way with each rival shown.
  if (p.kind === "h2h" && p.compare) Object.assign(detailsComp, details);
  if (Object.keys(details).length) p.details = details;
  if (Object.keys(detailsComp).length) p.detailsComp = detailsComp;
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
  const ctx: Ctx = { h, inputs, ladder: hasLadder(inputs, h) };
  return rivals.map((r) => rivalAcrossOne(ctx, panels, r)).filter((x): x is RivalAcross => !!x);
}

function rivalAcrossOne(ctx: Ctx, panels: Map<string, PositionPanel>, rv: { key: string; name: string }): RivalAcross | null {
  const { h, inputs } = ctx;
  const R = rv.name;
  const key = rv.key;
  const steps: RivalAcrossStep[] = [];
  const pf = (name: string) => (r: PoolRow) => h.quoteOf(r) || r.code.top_pick || name;
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
  /** What the answer weighs when it picks R vs when it picks you (two codes each way). */
  const weighTable = (theirs: PoolRow[], mine: PoolRow[]): PanelTable | undefined => {
    const t = theirs.filter((r) => r.code.reasons !== null);
    const m = mine.filter((r) => r.code.reasons !== null);
    if (t.length < PICKED_MIN || m.length < PICKED_MIN) return undefined;
    const codes = new Set<string>([...t, ...m].flatMap((r) => r.code.reasons!));
    const rowsOf = (rs: PoolRow[], c: string) => rs.filter((r) => r.code.reasons!.includes(c));
    const scored = [...codes]
      .map((c) => ({ c, a: rowsOf(t, c), b: rowsOf(m, c) }))
      .filter((x) => x.a.length >= ROW_MIN || x.b.length >= ROW_MIN)
      .map((x) => ({ ...x, d: x.a.length / t.length - x.b.length / m.length }));
    const pick = [...scored.filter((x) => x.d > 0).sort((a, b) => b.d - a.d || a.c.localeCompare(b.c)).slice(0, 2), ...scored.filter((x) => x.d < 0).sort((a, b) => a.d - b.d || a.c.localeCompare(b.c)).slice(0, 2)];
    if (!pick.length) return undefined;
    return {
      title: "What the answer weighs",
      sub: "Share of the answers that pick each brand that raise each argument.",
      columns: [`Picks ${R}`, "Picks you"],
      style: "compare",
      rows: pick.map((x) => ({ label: clabel(x.c, h), cells: [num(x.a.length, t.length, "answers that pick", refsOf(x.a, () => x.c)), num(x.b.length, m.length, "answers that pick", refsOf(x.b, () => x.c))] })),
    };
  };
  /** Rows of a by-cell list: 3+ answers drawn, fewer folded into one sentence. */
  const byCellRows = (cells: PanelCellInput[], hit: (r: PoolRow) => boolean, find: (r: PoolRow) => string, extra?: (rs: PoolRow[]) => PanelSpan | null): { table?: PanelTable; fold?: PanelText; title: string } | null => {
    const rows: { label: string; cells: (PanelNum | PanelSpan | null)[]; k: number }[] = [];
    const few: { label: string; n: PanelNum }[] = [];
    const never: string[] = [];
    for (const c of cells) {
      const hits = c.rows.filter(hit);
      const n = num(hits.length, c.rows.length, "answers", refsOf(hits, find));
      const label = c.label || ROW_NAME.open;
      if (hits.length >= ROW_MIN) rows.push({ label, cells: [n, ...(extra ? [extra(hits)] : [])], k: hits.length / Math.max(1, c.rows.length) });
      else if (hits.length > 0) few.push({ label, n });
      else never.push(label);
    }
    if (!rows.length && !few.length) return null;
    rows.sort((a, b) => b.k - a.k || a.label.localeCompare(b.label));
    const parts: (PanelText | string)[] = [];
    if (few.length) parts.push(join("It comes up in ", ...few.flatMap((f, i) => [i ? (i === few.length - 1 ? " and " : ", ") : "", F("a few answers", f.n), ` on ${f.label}`]), "."));
    if (never.length) parts.push(`${few.length ? " " : ""}It never comes up on ${listWords(never)}.`);
    return {
      title: "",
      ...(rows.length ? { table: { title: "", sub: "", columns: extra ? ["Share", ""] : ["Share"], style: "bars" as const, rows: rows.map(({ label, cells }) => ({ label, cells })) } } : {}),
      ...(parts.length ? { fold: join(...parts) } : {}),
    };
  };

  // 1. Spotting the problem - recommended.
  const aw = rowAll(inputs, "chooses", "awareness");
  if (aw) {
    const rR = aw.rows.filter((r) => h.recommendsOf(r).has(key));
    if (rR.length) {
      const rY = aw.rows.filter((r) => h.recommendsOf(r).has(h.targetKey));
      const nR = num(rR.length, aw.rows.length, "answers", refsOf(rR, (r) => (r.code.mentions ?? []).find((m) => m.framing === "recommended" && h.resolve(m.brand).key === key)?.brand ?? R));
      const nY = num(rY.length, aw.rows.length, "answers", refsOf(rY, (r) => (r.code.mentions ?? []).find((m) => m.framing === "recommended" && h.resolve(m.brand).key === h.targetKey)?.brand ?? h.brand));
      const sibs = splitCells(inputs, "chooses", "awareness");
      const table: PanelTable | undefined = sibs.length >= 2
        ? {
            title: "By buyer",
            sub: "Share of each buyer's answers that recommend the brand.",
            columns: [R, "You"],
            style: "compare",
            rows: sibs
              .map((c) => {
                const a = c.rows.filter((r) => h.recommendsOf(r).has(key));
                const b = c.rows.filter((r) => h.recommendsOf(r).has(h.targetKey));
                return { label: c.label, a, b, n: c.rows.length };
              })
              .filter((x) => x.n >= ROW_MIN)
              .sort((x, y) => y.a.length / y.n - x.a.length / x.n || x.label.localeCompare(y.label))
              .map((x) => ({ label: x.label, cells: [num(x.a.length, x.n, "answers", refsOf(x.a, () => R)), num(x.b.length, x.n, "answers", refsOf(x.b, () => h.brand))] })),
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

  // 2. What to buy - share of the picks.
  const op = rowAll(inputs, "chooses", "open");
  let openR: PanelNum | undefined;
  let openY: PanelNum | undefined;
  let theirPicks: PoolRow[] = [];
  if (op) {
    const split = h.brandSplit(op.rows);
    theirPicks = split.list.find((b) => b.key === key)?.rows ?? [];
    const mine = split.list.find((b) => b.key === h.targetKey)?.rows ?? [];
    const named = op.rows.some((r) => (r.code.mentions ?? []).some((m) => h.resolve(m.brand).key === key));
    if (theirPicks.length || named) {
      openR = num(theirPicks.length, split.n, "picks", refsOf(theirPicks, pf(R)));
      openY = num(mine.length, split.n, "picks", refsOf(mine, pf(h.brand)));
      const conditions = conditionsOf(op, ctx, rivalWords, { pickKind: true, onlyTo: R, towardRows: panels.get(op.id)?.conditions?.toward });
      const table = weighTable(theirPicks, mine);
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
    }
  }

  // 3. What's popular - recommended.
  const so = rowAll(inputs, "chooses", "social");
  if (so) {
    const fR = funnelOf(so.rows, key, h);
    if (fR.rec.length) {
      const fY = funnelOf(so.rows, h.targetKey, h);
      const nR = num(fR.rec.length, so.rows.length, "answers", refsOf(fR.rec, (r) => fR.surf(r, true) ?? r.code.top_pick ?? R));
      const nY = num(fY.rec.length, so.rows.length, "answers", refsOf(fY.rec, (r) => fY.surf(r, true) ?? r.code.top_pick ?? h.brand));
      const conditions = conditionsOf(so, ctx, rivalWords, { pickKind: true, onlyTo: R, towardRows: panels.get(so.id)?.conditions?.toward });
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

  // 4. Head to head with you - the pick (the rival's own matchup).
  const hh = [...inputs.values()].find((x) => x.kind === "h2h" && !x.pooled && x.rivalKey === key);
  let hhR: PanelNum | undefined;
  if (hh) {
    const all = hh.rows.length;
    const lostR = hh.rows.filter((r) => h.pickOf(r).key === key);
    const wonY = hh.rows.filter((r) => h.pickOf(r).key === h.targetKey);
    const rest = hh.rows.filter((r) => !lostR.includes(r) && !wonY.includes(r));
    const third = rest.some((r) => h.pickOf(r).status === "active");
    hhR = num(lostR.length, all, "answers", refsOf(lostR, pf(R)));
    const nY = num(wonY.length, all, "answers", refsOf(wonY, pf(h.brand)));
    const nN = num(rest.length, all, "answers", refsOf(rest, (r) => verdictFind(r, h)));
    const hp = panels.get(hh.id);
    const table = weighTable(lostR, wonY);
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

  // 5. Its customers switching - share of the picks.
  const lv = [...inputs.values()].find((x) => x.kind === "switching" && !x.pooled && x.rivalKey === key);
  if (lv) {
    const split = h.brandSplit(lv.rows);
    const mine = split.list.find((b) => b.key === h.targetKey)?.rows ?? [];
    const others = split.list.filter((b) => b.key !== h.targetKey && b.key !== key).slice(0, 3);
    const lp = panels.get(lv.id);
    steps.push({
      key: "leavers",
      label: "Its customers switching - share of the picks",
      cellId: lv.id,
      bars: [bar(h.brand, "you", num(mine.length, split.n, "picks", refsOf(mine, pf(h.brand)))), ...others.map((b) => bar(b.name, "other", num(b.rows.length, split.n, "picks", refsOf(b.rows, pf(b.name)))))],
      heading: `Where ${possOf(R)} customers are sent`,
      body: lp?.claim ?? join(`When ${possOf(R)} customers ask where to move, the AI picks you in `, N(num(mine.length, split.n, "picks", refsOf(mine, pf(h.brand)))), " of its picks."),
      ...(lp?.conditions ? { conditions: lp.conditions } : {}),
    });
  }

  /** A doubt step: the rival named as the alternative (destinations / value facts), beside the top others, with a by-cell list. */
  const doubtStep = (k: string, label: string, inp: PanelCellInput | undefined, sibs: PanelCellInput[], hit: (r: PoolRow, key: string) => boolean, others: (r: PoolRow) => Map<string, string>, heading: string, body: (n: PanelNum) => PanelText, extra?: (rs: PoolRow[]) => PanelSpan | null) => {
    if (!inp) return;
    const hits = inp.rows.filter((r) => hit(r, key));
    if (!hits.length) return;
    const find = (r: PoolRow) => (r.code.destinations ?? []).find((d) => h.resolve(d).key === key) ?? (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === key)?.brand ?? R;
    const nR = num(hits.length, inp.rows.length, "answers", refsOf(hits, find));
    const by = new Map<string, { name: string; rows: PoolRow[] }>();
    for (const r of inp.rows) for (const [k2, name] of others(r)) if (k2 !== key) by.set(k2, { name, rows: [...(by.get(k2)?.rows ?? []), r] });
    const top = [...by.values()].filter((x) => x.rows.length >= ROW_MIN).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)).slice(0, 2);
    const list = sibs.length >= 2 ? byCellRows(sibs, (r) => hit(r, key), find, extra) : null;
    steps.push({
      key: k,
      label,
      cellId: inp.id,
      bars: [bar(R, "rival", nR), ...top.map((x) => bar(x.name, "other", num(x.rows.length, inp.rows.length, "answers", refsOf(x.rows, () => x.name))))],
      heading,
      body: body(nR),
      ...(list?.table ? { table: { ...list.table, title: "", sub: "" } } : {}),
      ...(list?.fold ? { fold: list.fold } : {}),
    });
  };
  const destHit = (r: PoolRow, k: string) => h.activeDests(r.code.destinations).has(k);
  // 6. Buyers' worries - named as the one to get instead.
  doubtStep(
    "buyers",
    `${ROW_NAME.buyers} - named as the ${h.noun} to get instead`,
    rowAll(inputs, "doubts", "buyers"),
    splitCells(inputs, "doubts", "buyers"),
    destHit,
    (r) => h.activeDests(r.code.destinations),
    `Which worries bring up ${R}`,
    (n) => join(`When buyers voice a worry about you, the AI names ${R} as the ${h.noun} to get instead in `, N(n), " of answers. Each share below is of that worry's answers.")
  );
  // 7. Value - recommended instead.
  const vfact = (r: PoolRow) => h.valueFacts.get(r.code.response_id);
  doubtStep(
    "value",
    `${ROW_NAME.value} - recommended instead of your ${h.noun}`,
    rowAll(inputs, "chooses", "value"),
    splitCells(inputs, "chooses", "value"),
    (r, k) => !!vfact(r)?.instead.has(k),
    (r) => vfact(r)?.instead ?? new Map(),
    `Where ${R} is offered in place of yours`,
    (n) => join(`Asked whether your ${h.noun} is worth paying more for, the AI recommends ${R} instead in `, N(n), " of answers. Each share below is of that buyer's answers."),
    (rs) => {
      const prods = productSplit(rs, (r) => productLabel((r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === key)?.brand ?? R, R, ctx) ?? noneName(ctx), 1, "answers", nounToks(ctx), nameTokens(R, ctx))[0];
      return prods && !/^No specific /.test(prods.name) ? { t: `Names ${prods.name} most`, ...(prods.num.refs ? { refs: prods.num.refs } : {}), tip: prods.num.tip } : null;
    }
  );
  // 8. Your customers' worries - named as where to go.
  doubtStep(
    "customers",
    `Your ${ROW_NAME.customers.toLowerCase()} - named as where to go`,
    rowAll(inputs, "doubts", "customers"),
    splitCells(inputs, "doubts", "customers"),
    destHit,
    (r) => h.activeDests(r.code.destinations),
    `Which worries bring up ${R}`,
    (n) => join(`When your customers voice a worry, the AI names ${R} as where to go in `, N(n), " of answers. Each share below is of that worry's answers.")
  );
  // 9. Your customers looking around - shown.
  const ho = rowAll(inputs, "doubts", "hold");
  if (ho) {
    const hits = ho.rows.filter((r) => destHit(r, key));
    if (hits.length) {
      const nR = num(hits.length, ho.rows.length, "answers", refsOf(hits, (r) => (r.code.destinations ?? []).find((d) => h.resolve(d).key === key) ?? R));
      const by = new Map<string, { name: string; rows: PoolRow[] }>();
      for (const r of ho.rows) for (const [k2, name] of h.activeDests(r.code.destinations)) if (k2 !== key) by.set(k2, { name, rows: [...(by.get(k2)?.rows ?? []), r] });
      const top = [...by.values()].filter((x) => x.rows.length >= ROW_MIN).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)).slice(0, 2);
      const conditions = conditionsOf(
        ho,
        ctx,
        {
          title: `When the AI shows ${R}`,
          sub: `Share of these answers that say "look at another ${h.noun} if...". The rows count only the answers that show ${R}.`,
          towardTitle: "Stay if",
          awayTitle: `Look at another ${h.noun} if`,
          alsoToward: `Also said for another ${h.noun}`,
          alsoAway: "Also said for staying",
          toWord: "Shown",
        },
        { pickKind: false, onlyTo: R, towardRows: [] }
      );
      steps.push({
        key: "hold",
        label: `${ROW_NAME.hold} - shown`,
        cellId: ho.id,
        bars: [bar(R, "rival", nR), ...top.map((x) => bar(x.name, "other", num(x.rows.length, ho.rows.length, "answers", refsOf(x.rows, () => x.name))))],
        heading: `When the AI shows ${R} to your customers`,
        body: lead2(conditions) ?? join(`Asked what else to look at, the AI shows ${R} in `, N(nR), " of answers."),
        ...(conditions && conditions.away.length ? { conditions } : {}),
      });
    }
  }
  if (!steps.length) return null;

  // Where it takes its picks (what to buy, by buyer) and which of its products it picks.
  let byBuyer: PanelTable | undefined;
  let products: PanelTable | undefined;
  if (op) {
    const sibs = splitCells(inputs, "chooses", "open");
    const rowsB = sibs
      .map((c) => {
        const sp = h.brandSplit(c.rows);
        return { c, n: sp.n, a: sp.list.find((b) => b.key === key)?.rows ?? [], b: sp.list.find((b) => b.key === h.targetKey)?.rows ?? [] };
      })
      .filter((x) => x.n >= ROW_MIN && (x.a.length || x.b.length));
    if (rowsB.length >= 2)
      byBuyer = {
        title: "Where it takes its picks",
        sub: `Share of the picks when buyers ask ${ROW_NAME.open.toLowerCase()}, by buyer.`,
        columns: [R, "You"],
        style: "compare",
        rows: rowsB
          .sort((x, y) => y.a.length / y.n - x.a.length / x.n || x.c.label.localeCompare(y.c.label))
          .map((x) => ({ label: x.c.label, cells: [num(x.a.length, x.n, "picks", refsOf(x.a, pf(R))), num(x.b.length, x.n, "picks", refsOf(x.b, pf(h.brand)))] })),
      };
    const ps = ctx.ladder ? productSplit(theirPicks, (r) => pickedProduct(r, ctx, false), 4, `picks of ${R}`, nounToks(ctx), nameTokens(R, ctx)).filter((x) => (knOf(x.num)?.k ?? 0) >= ROW_MIN && !/^No specific /.test(x.name)).slice(0, 3) : [];
    if (ps.length)
      products = {
        title: `Which of its ${h.plural} it picks`,
        sub: `Share of the answers to ${ROW_NAME.open.toLowerCase()} that pick ${R}.`,
        columns: ["Share"],
        style: "bars",
        rows: ps.map((x) => ({ label: x.name, cells: [x.num] })),
      };
  }

  const hs = steps.find((s) => s.key === "h2h");
  const claim = join(
    openR && openY
      ? join(`${R} takes `, N(openR), ` of the picks when buyers ask ${ROW_NAME.open.toLowerCase()}. You take `, N(openY), ".")
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
