import { isDefaultCondition } from "./condition_groups";
import { famTokens } from "./brand_family";
import { pickRefs, spreadRefs, themeAnswerSets, type AnswerRules, type ThemeMap } from "./reason_themes";
import type { RuleGroup } from "./rules_explorer";
import { isWallWording } from "./wall_wording";
import type { Resolver } from "./brand_resolve";
import type { PoolRow, RateCell } from "./view_data";
import type { ValueFact } from "./value";
import { filterObvious, type Omission, type OmissionList } from "./panel_filter";
import { TAG_FURTHEST, TAG_GAP_OPENS, duelTag, duelTone, focusOf, neutralUsualTag, otherTag, rankTag, segTag, toneOfTag, usualTag, usualTone, type KN } from "./panel_tags";
import { ROW_NAME } from "./question_names";
import {
  F,
  N,
  NO_CONDITION_ROWS,
  T,
  THIN,
  THIN_RIVAL,
  article,
  attachedLead,
  condLabel,
  countWord,
  funnelDetail,
  join,
  listSpans,
  listWords,
  rankDetail,
  upperFirst,
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
}

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
  const ctx: Ctx = { h, inputs };
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
      r.stackLabel = "Where the gap opens";
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

/** An answer's verdict quote, else a mention of the brand, else the brand. */
const verdictFind = (r: PoolRow, h: PanelHelpers) =>
  (r.code.quote ?? "").trim() || (r.code.premise_quote ?? "").trim() || (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === h.targetKey)?.brand || h.brand;

function seg(key: string, label: string, tone: PanelSegment["tone"], hit: PoolRow[], n: number, h: PanelHelpers, unit = "answers", find?: (r: PoolRow) => string): PanelSegment {
  return { key, label, tone, num: num(hit.length, n, unit, refsOf(hit, find ?? ((r) => verdictFind(r, h)))) };
}

/** "What the answer weighs" over every answer (top 3, ruling 5 filtered). */
function weighsAll(inp: PanelCellInput, ctx: Ctx, list: OmissionList = "weighs", top = 3): PanelLine | null {
  const { h } = ctx;
  const rows = inp.rows;
  const withR = rows.filter((r) => r.code.reasons !== null);
  if (withR.length < ARGS_MIN) return null;
  const counts = new Map<string, number>();
  for (const r of withR) for (const c of new Set(r.code.reasons!)) counts.set(c, (counts.get(c) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, k]) => ({ code, k, share: k / rows.length }));
  const kept = filterObvious(ranked, inp.id, list, h.wordings(inp.cellIntents), h.scopes, h.category, h.omissions).slice(0, top);
  if (!kept.length) return null;
  const spans = kept.map((x) => F(x.code, num(x.k, rows.length, "answers", refsOf(withR.filter((r) => r.code.reasons!.includes(x.code)), () => x.code))));
  return { label: "What the answer weighs", value: listSpans(spans) };
}

/** "A when <side 1> · B when <side 2>" from the cell's two-sided lifts. */
function weighsSides(inp: PanelCellInput, ctx: Ctx, sideA: string, sideB: string, wins: PoolRow[], others: PoolRow[]): PanelLine | null {
  const pos = inp.lifts.filter((l) => l.value > 0).sort((a, b) => b.value - a.value)[0];
  const neg = inp.lifts.filter((l) => l.value < 0).sort((a, b) => a.value - b.value)[0];
  if (!pos && !neg) return weighsAll(inp, ctx);
  const span = (l: LiftItem, rows: PoolRow[]) => {
    const hit = rows.filter((r) => r.code.reasons?.includes(l.label));
    return F(l.label, num(hit.length, rows.length, "answers", refsOf(hit, () => l.label)));
  };
  return {
    label: "What the answer weighs",
    value: join(pos ? join(span(pos, wins), ` ${sideA}`) : null, pos && neg ? " · " : null, neg ? join(span(neg, others), ` ${sideB}`) : null),
  };
}

/** Products as written, grouped case-blind, top `k` with their share of `rows`. */
function productSplit(rows: PoolRow[], nameOf: (r: PoolRow) => string, k: number, unit: string, nounTokens: Set<string> = new Set()): { name: string; num: PanelNum }[] {
  // Grouped on the name's words without the category's own nouns ("Gold Card" = "Gold"), shown as the most written form.
  const by = new Map<string, { forms: Map<string, number>; rows: PoolRow[] }>();
  for (const r of rows) {
    const name = nameOf(r);
    const toks = famTokens(name);
    const key = toks.filter((t) => !nounTokens.has(t)).join(" ") || toks.join(" ") || name.toLowerCase();
    const t = by.get(key) ?? { forms: new Map<string, number>(), rows: [] };
    t.rows.push(r);
    t.forms.set(name, (t.forms.get(name) ?? 0) + 1);
    by.set(key, t);
  }
  return [...by.values()]
    .map((g) => ({ name: [...g.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0], rows: g.rows }))
    .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name))
    .slice(0, k)
    .map((g) => ({ name: g.name, num: num(g.rows.length, rows.length, unit, refsOf(g.rows, (r) => r.code.top_pick || g.name)) }));
}

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

/** A product as written with its brand's leading name words dropped
 * ("<Brand> Gold Card" -> "Gold Card"); null when nothing but the brand is left. */
function productLabel(surface: string, brandName: string, ctx: Ctx): string | null {
  const own = nameTokens(brandName, ctx);
  const words = surface.trim().split(/\s+/);
  let i = 0;
  while (i < words.length && famTokens(words[i]).length > 0 && famTokens(words[i]).every((t) => own.has(t))) i++;
  const rest = words.slice(i).join(" ").replace(/^[^A-Za-z0-9]+/, "").trim();
  if (!rest || !famTokens(rest).some((t) => !own.has(t))) return null;
  // A product whose own name runs on from the brand in lower case ("<Brand> it ...") keeps the brand.
  return i > 0 && /^[a-z]/.test(rest) ? surface.trim() : rest;
}

/** A written pick: the product as written (its brand's name words dropped),
 * or "No <noun> named" for the bare brand. */
function pickedProduct(r: PoolRow, ctx: Ctx, own: boolean): string {
  const tp = (r.code.top_pick ?? "").trim();
  if (!tp) return `No ${ctx.h.noun} named`;
  const brandName = own ? ctx.h.brand : ctx.h.resolve(tp).name;
  return productLabel(tp, brandName, ctx) ?? `No ${ctx.h.noun} named`;
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
    const row: PanelCondition = { text: condLabel(s.label), share: num(ids.size, o.all, "answers", refs) };
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
      const either = new Set([...s.both.ids, ...ids]);
      const st = new Map([...s.both.st, ...s.st]);
      row.both = { either: num(either.size, o.all, "answers", pickRefs([...either].map((id) => ({ id, find: st.get(id)!.said, model: st.get(id)!.model })), s.label, PANEL_REFS)) };
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

function conditionsOf(inp: PanelCellInput, ctx: Ctx, words: CondWords, opts: { pickKind: boolean; towardKeep?: (id: string) => boolean; pickedStamp?: string; onlyTo?: string; towardRows?: PanelCondition[]; toCards?: boolean }): PanelConditions | undefined {
  if (inp.conds.bearing === 0) return undefined;
  const rowOf = new Map(inp.rows.map((r) => [r.code.response_id, r]));
  const skip = new Set<string>();
  const all = inp.rows.length;
  const toward = opts.towardRows ?? condRows(inp.conds.toward, { all, side: "toward", pickKind: opts.pickKind, skip, rowOf, keepId: opts.towardKeep, pickedStamp: opts.pickedStamp }, ctx);
  if (opts.towardRows) for (const r of opts.towardRows) for (const x of r.share.refs ?? []) skip.add(x.responseId);
  const away = condRows(inp.conds.away, { all, side: "away", pickKind: opts.pickKind, skip, rowOf, onlyTo: opts.onlyTo, toCards: opts.toCards }, ctx);
  return {
    ...words,
    grouped: inp.conds.grouped,
    toward,
    away,
    ...(toward.length + away.length === 0 ? { note: NO_CONDITION_ROWS } : {}),
  };
}


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
  const others = split.list.filter((b) => b.key !== h.targetKey);
  const otherCount = others.length;

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
      otherCount ? ` ${countWord(otherCount)} other ${otherCount === 1 ? "brand takes" : "brands take"} the rest.` : ""
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
  if (mine.length >= 5) lines.push({ label: `Which of your ${h.plural} it picks`, value: splitLine(productSplit(mine, (r) => pickedProduct(r, ctx, true), 2, "of your picks", nounToks(ctx))) });
  const weigh = weighsAll(inp, ctx);
  if (weigh) lines.push(weigh);
  linesComp.push(shareLine);
  const othersPicked = inp.rows.filter((r) => h.pickOf(r).status === "active" && h.pickOf(r).key !== h.targetKey);
  const negs = inp.lifts.filter((l) => l.value < 0).sort((a, b) => a.value - b.value).slice(0, 2);
  const poss = inp.lifts.filter((l) => l.value > 0).sort((a, b) => b.value - a.value).slice(0, 1);
  if (negs.length || poss.length) {
    const sp = (l: LiftItem, rows: PoolRow[]) => {
      const hit = rows.filter((r) => r.code.reasons?.includes(l.label));
      return F(l.label, num(hit.length, rows.length, "answers", refsOf(hit, () => l.label)));
    };
    linesComp.push({
      label: "What the answer weighs",
      value: join(negs.length ? join(listSpans(negs.map((l) => sp(l, othersPicked))), " for others") : null, negs.length && poss.length ? " · " : null, poss.length ? join(sp(poss[0], mine), " for you") : null),
    });
  } else if (weigh) linesComp.push(weigh);

  const hereKey = inp.pooled ? "You" : switching ? (generic ? `You, with customers of another ${h.noun}` : `You, with ${rival}'s customers`) : "You, with this buyer";
  return {
    kind: inp.kind,
    claim,
    ...(lead ? { lead } : {}),
    ...(usual ? { usualCellId: usual.id, usualKey: switching ? "You, across all rivals' customers" : "You, across all buyers" } : {}),
    hereKey,
    stackLabel: switching ? "Where you lose these buyers" : inp.pooled ? "Where you lose buyers" : "Where you lose this buyer",
    steps,
    ...(compNums.length ? { compare: true as const, competitorOrder: compNums.map((x) => x.b.name) } : {}),
    ...(competitors ? { competitors } : {}),
    ...(conditions ? { conditions } : {}),
    lines,
    linesComp,
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
  const steps: PanelStep[] = [
    { key: "decided", label: "The AI picks one of the two", here: decided, hereLabel: inp.pooled ? "All your head-to-heads" : "This matchup", usualLabel: "All your head-to-heads" },
    ...(d > 0 ? [{ key: "won" as const, label: "When it picks, who it picks", here: wonN, rivals: [{ name: inp.pooled ? "Your named rivals" : rival, num: lostN }] }] : []),
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
  if (!inp.pooled && lost.length) lines.push({ label: `Which ${rival} ${ctx.h.plural} it picks`, value: splitLine(productSplit(lost, (r) => pickedProduct(r, ctx, false), 2, `picks of ${rival}`, nounToks(ctx))) });
  const w = weighsAll(inp, ctx);
  if (w) lines.push(w);
  const usual = usualOf(inp, ctx.inputs);
  return {
    kind: "h2h",
    claim,
    ...(lead ? { lead } : {}),
    ...(usual ? { usualCellId: usual.id, usualKey: "You, across all your head-to-heads" } : {}),
    hereKey: "You",
    stackLabel: "Where it is decided",
    steps,
    ...(conditions ? { conditions } : {}),
    lines,
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
  const w = buyer ? weighsSides(inp, ctx, "when it says go ahead", "when it concedes", favRows, unfavRows) : weighsSides(inp, ctx, "when it says stay", "when it says leave", favRows, unfavRows);
  if (w) lines.push(w);
  const rivals = comp.map((c) => rivalSmall(inp, ctx, c, (r) => h.activeDests(r.code.destinations).has(c.key), "Named as the alternative"));
  const usual = usualOf(inp, ctx.inputs);
  return {
    kind: inp.kind,
    claim,
    ...(usual ? { usualCellId: usual.id, usualKey: buyer ? "All your buyers' worries" : "All your customers' worries" } : {}),
    hereKey: "This worry",
    stackLabel: "How the answer goes",
    steps: [
      ...(judged.length >= 5 ? [{ key: "agrees" as const, label: "Agrees the worry is fair", here: agrees }] : []),
      { key: "verdict", label: buyer ? "What it tells the buyer to do" : "What it tells the customer to do", segments: segs },
    ],
    ...(block ? { compare: true as const, competitors: block } : {}),
    lines,
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
    segs[0].num.pct === 0 && segs[1].num.pct === 0 ? "never says stay or leave" : join("says stay in ", N(segs[0].num), " of answers and leave in ", N(segs[1].num)),
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
    lead = join(attachedLead(`looking at another ${h.noun}`, a.slice(0, 2), "answers"), towardSum < 15 ? " It gives few conditions for staying." : "");
  }
  const { block, comp } = destBlock(rows, ctx, `Which ${h.plural} it shows`, `Share of these answers that name it as an alternative. Open a rival to see how it gets its picks.`, (r) => r.code.destinations);
  const rivals = comp.map((c) => rivalSmall(inp, ctx, c, (r) => h.activeDests(r.code.destinations).has(c.key), "Shown as an alternative"));
  const lines: PanelLine[] = [];
  const w = weighsAll(inp, ctx);
  if (w) lines.push(w);
  return {
    kind: "looking_around",
    claim,
    ...(lead ? { lead } : {}),
    stackLabel: "How the answer goes",
    steps: [
      { key: "verdict", label: "What it tells the customer to do", segments: segs },
      { key: "offers", label: `Shows another ${h.noun}`, here: offers },
    ],
    ...(block ? { compare: true as const, competitors: block } : {}),
    ...(conditions ? { conditions } : {}),
    lines,
    ...(rivals.length ? { rivals } : {}),
  };
}

function valuePanel(inp: PanelCellInput, ctx: Ctx): PositionPanel {
  const { h } = ctx;
  const rows = inp.rows;
  const all = rows.length;
  const fact = (r: PoolRow) => h.valueFacts.get(r.code.response_id);
  const worth = (w: string) => rows.filter((r) => (fact(r)?.worth ?? (r.code.worth_it === "yes" || r.code.worth_it === "no" ? r.code.worth_it : "depends")) === w);
  const segs = [seg("yes", "worth it", "you", worth("yes"), all, h), seg("depends", "depends", "neutral", worth("depends"), all, h), seg("no", "not worth it", "away", worth("no"), all, h)];
  // Where it points the buyer instead - every answer, one segment each: a rival first, else your own, else nowhere (owner ruling 5).
  const rivalRows = rows.filter((r) => (fact(r)?.instead.size ?? 0) > 0);
  const ownRows = rows.filter((r) => (fact(r)?.instead.size ?? 0) === 0 && (fact(r)?.own.size ?? 0) > 0);
  const nowhere = rows.filter((r) => (fact(r)?.instead.size ?? 0) === 0 && (fact(r)?.own.size ?? 0) === 0);
  const instead: PanelSegment[] = [
    { key: "own", label: `your own cheaper ${h.noun}`, tone: "neutral", num: num(ownRows.length, all, "answers", refsOf(ownRows, (r) => [...fact(r)!.own.values()][0] ?? h.brand)) },
    { key: "rival", label: `a rival's ${h.noun}`, tone: "away", num: num(rivalRows.length, all, "answers", refsOf(rivalRows, (r) => (r.code.mentions ?? []).find((m) => m.framing === "recommended" && fact(r)!.instead.has(h.resolve(m.brand).key))?.brand ?? [...fact(r)!.instead.values()][0])) },
    { key: "nowhere", label: "nowhere", tone: "neutral", num: num(nowhere.length, all, "answers", refsOf(nowhere, (r) => verdictFind(r, h))) },
  ];
  const subject = inp.line ?? h.brand;
  const yes = segs[0].num;
  const no = segs[2].num;
  const claim = join(
    `Asked whether ${subject} is worth it over a cheaper ${h.noun}${inp.pooled ? ", across all buyers" : " for this buyer"}, the AI says no in `,
    N(no),
    " of answers and ",
    yes.pct === 0 ? "never says yes" : join("yes in ", N(yes)),
    "."
  );
  // Competitors: the rivals named instead (top COMP_TOP) plus your own cheaper option.
  const byRival = new Map<string, { key: string; name: string; rows: PoolRow[] }>();
  for (const r of rows) for (const [k, name] of fact(r)?.instead ?? []) byRival.set(k, { key: k, name, rows: [...(byRival.get(k)?.rows ?? []), r] });
  const comp = [...byRival.values()].filter((x) => x.rows.length >= ROW_MIN).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)).slice(0, COMP_TOP);
  const ownAny = rows.filter((r) => (fact(r)?.own.size ?? 0) > 0);
  const blockRows: PanelBrandRow[] = [
    ...comp.map((c) => ({ name: c.name, num: num(c.rows.length, all, "answers", refsOf(c.rows, (r) => (r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === c.key)?.brand ?? c.name)), open: true as const })),
    ...(ownAny.length ? [{ name: `Your own cheaper ${h.noun}`, you: true as const, num: num(ownAny.length, all, "answers", refsOf(ownAny, (r) => [...fact(r)!.own.values()][0] ?? h.brand)) }] : []),
  ].sort((a, b) => b.num.pct - a.num.pct || a.name.localeCompare(b.name));
  const block: PanelBlock | undefined = blockRows.length ? { title: "Where it points the buyer instead", sub: "Share of these answers. Open a rival to see how it gets its picks.", rows: blockRows } : undefined;
  const rivals = comp.map((c) => rivalSmall(inp, ctx, c, (r) => !!fact(r)?.instead.has(c.key), "Named as the cheaper option"));
  const lines: PanelLine[] = [];
  const w = weighsSides(inp, ctx, "when it says worth it", "when it says not worth it", worth("yes"), worth("no"));
  if (w) lines.push(w);
  const usual = usualOf(inp, ctx.inputs);
  return {
    kind: "value",
    claim,
    ...(usual ? { usualCellId: usual.id, usualKey: "All buyers" } : {}),
    hereKey: inp.pooled ? "All buyers" : "This buyer",
    stackLabel: "How the answer goes",
    steps: [
      { key: "worth", label: "Is it worth paying more for?", segments: segs },
      { key: "instead", label: "Where it points the buyer instead", segments: instead },
    ],
    ...(block ? { compare: true as const, competitors: block } : {}),
    lines,
    ...(rivals.length ? { rivals } : {}),
  };
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
          label: x.code,
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
    stackLabel: inp.pooled ? "Where you lose buyers" : "Where you lose this buyer",
    steps: [
      { key: "category", label: `The answer is about ${h.plural} at all`, here: category, ...(compNums.length ? { tagRank: "Same for every brand" } : {}) },
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
  const winners = h.reasonLift
    .filter((l) => l.lift > 0 && l.wins.low > l.others.high && !taughtSet.has(l.code))
    .sort((a, b) => b.wins.k / Math.max(1, b.wins.n) - a.wins.k / Math.max(1, a.wins.n) || a.code.localeCompare(b.code));
  // The headline answers picking you / another brand that argue a code.
  const youPicks = h.headline.filter((r) => h.pickOf(r).key === h.targetKey && r.code.reasons !== null);
  const otherPicks = h.headline.filter((r) => h.pickOf(r).status === "active" && h.pickOf(r).key !== h.targetKey && r.code.reasons !== null);
  const pickNum = (code: string, rs: PoolRow[]) => {
    const hit = rs.filter((r) => r.code.reasons!.includes(code));
    return num(hit.length, rs.length, "answers that pick", refsOf(hit, () => code));
  };
  const untaught = winners.slice(0, 2);
  const claim = join(
    `When buyers ask what to look for in ${article(h.noun)} ${h.noun}, the AI teaches `,
    listSpans(top5.slice(0, 3).map((x) => F(x.code, taughtNum(x.code)))),
    ".",
    untaught.length
      ? join(" ", listSpans(untaught.map((w, i) => F(i === 0 ? upperFirst(w.code) : w.code, pickNum(w.code, youPicks)))), untaught.length > 1 ? ", which come up most when it picks you, are not on its list." : ", which comes up most when it picks you, is not on its list.")
      : top5.length
        ? " Everything that comes up most when it picks you is on its list."
        : ""
  );
  const steps: PanelStep[] = [{ key: "taught", label: "What it tells buyers to look at", items: top5.slice(0, 4).map((x) => ({ label: x.code, num: taughtNum(x.code) })) }];
  if (untaught.length)
    steps.push({
      key: "gap",
      label: "Teaches what its answers weigh when it picks you",
      note: join(listSpans(untaught.map((w, i) => F(i === 0 ? upperFirst(w.code) : w.code, pickNum(w.code, youPicks)))), untaught.length > 1 ? " come up most when it picks you, and neither is taught." : " comes up most when it picks you, and it is not taught."),
    });
  // Table: the winners (up to 4) plus the taught top 5 with lift rows; not taught first, then by lift; at most 6.
  const liftBy = new Map(h.reasonLift.map((l) => [l.code, l]));
  const tableCodes = [...new Set([...winners.slice(0, 4).map((w) => w.code), ...top5.map((x) => x.code).filter((c) => liftBy.has(c))])]
    .map((c) => ({ c, taught: taughtSet.has(c), lift: liftBy.get(c)?.lift ?? 0 }))
    .sort((a, b) => Number(a.taught) - Number(b.taught) || b.lift - a.lift || a.c.localeCompare(b.c))
    .slice(0, 6);
  const table: PanelTable | undefined =
    tableCodes.length && h.reasonLift.length
      ? {
          title: "What the answer weighs, against the checklist",
          sub: "How often each topic comes up in answers that pick you and in answers that pick another brand, and whether the AI teaches buyers to look for it. The when-picked figures come from the What to buy answers, because these questions take no picks.",
          columns: [`When it picks another ${h.noun}`, "When it picks you", "On the checklist"],
          style: "compare",
          rows: tableCodes.map(({ c, taught }) => {
            const tn = taughtNum(c);
            return { label: c, cells: [pickNum(c, otherPicks), pickNum(c, youPicks), taught ? { t: `Taught, ${tn.value}`, ...(tn.refs ? { refs: tn.refs } : {}), tip: tn.tip } : { t: "Not taught" }] };
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
            label: x.code,
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
  const prodRows = [...prods.entries()].filter(([, x]) => x.rows.length >= ROW_MIN).sort((x, y) => y[1].rows.length - x[1].rows.length || x[1].name.localeCompare(y[1].name)).slice(0, 4);
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
        label: x.code,
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
      label: x.code,
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
      if (!nm) continue;
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
  // The own / another company's / in place of yours split.
  const kindRows = (rel: string) => rows.filter((r) => (r.code.pairings ?? []).some((p) => p.maker_relation === rel));
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
    { pickKind: false, toCards: true }
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
      { key: "concedes", label: "gives in to the critic", tone: "away", rows: concedes, phrase: "gives in to the critic" },
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
  const claim = join(
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
          return { label: x.code, cells: [num(sh.length, strong.length, "strong answers", refsOf(sh, () => x.code)), ...(gapOn ? [{ t: `${on.value} in other answers`, ...(on.refs ? { refs: on.refs } : {}), tip: on.tip }] : [])] };
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
      body: join("The AI names you in ", N(you.named), ` of answers here and ${R} in `, N(them.named), "."),
      rows: rowsD,
    };
  } else missing.push("who is named without a recommendation");
  // Recommended: what happens to each brand's recommendations next.
  if (them.f.rec.length >= 5 && you.f.rec.length >= 5) {
    const outcome = (recRows: PoolRow[], k: string, name: string, isYou: boolean) => {
      const picked = recRows.filter((r) => h.pickOf(r).key === k);
      const lost = recRows.filter((r) => h.pickOf(r).status === "active" && h.pickOf(r).key !== k);
      const none = recRows.filter((r) => h.pickOf(r).status !== "active");
      return {
        name,
        ...(isYou ? { you: true as const } : {}),
        picked: num(picked.length, recRows.length, "recommending answers", refsOf(picked, pf(name))),
        lost: num(lost.length, recRows.length, "recommending answers", refsOf(lost, (r) => r.code.top_pick || name)),
        none: num(none.length, recRows.length, "recommending answers", refsOf(none, (r) => verdictFind(r, h))),
      };
    };
    const both = rows.filter((r) => them.f.rec.includes(r) && you.f.rec.includes(r));
    const bothR = both.filter((r) => h.pickOf(r).key === key);
    const bothY = both.filter((r) => h.pickOf(r).key === h.targetKey);
    const t = steps[1].tagRank ?? "Even";
    details.recommended = {
      heading: t === "Even" ? "No gap at this step, but this is where you part" : t === TAG_GAP_OPENS || t === `${R} leads` ? `${R} is recommended more often than you` : `You are recommended more often than ${R}`,
      body: join("The AI recommends you in ", N(you.recommended), ` of answers here and ${R} in `, N(them.recommended), ". What happens to the recommendation next differs."),
      outcomes: [outcome(them.f.rec, key, R, false), outcome(you.f.rec, h.targetKey, h.brand, true)],
      outcomeLabels: { picked: "picked", lost: `lose to another ${h.noun}`, none: "no single pick" },
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
    details.converts = {
      heading:
        rr > yr && ratio >= 1.5
          ? `When it has to name one ${h.noun}, it names ${R} ${ratio >= 2.5 ? `${Math.round(ratio)} times` : ratio >= 1.8 ? "twice" : "more"} as often`
          : yr > rr && rr > 0 && yr / rr >= 1.5
            ? `When it has to name one ${h.noun}, it names you more often`
            : "The two convert their recommendations at a similar rate",
      body: join(N(them.converts), ` of ${R}'s recommendations end as the pick, against `, N(you.converts), " of yours."),
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
  const rp = productSplit(theirPicks, (r) => pickedProduct(r, ctx, false), 1, `picks of ${R}`, nounToks(ctx))[0];
  const yp = mine.length ? productSplit(mine, (r) => pickedProduct(r, ctx, true), 1, "of your picks", nounToks(ctx))[0] : undefined;
  if (rp || yp) lines.push({ label: `Which ${h.plural} it picks`, value: join(rp ? join(`${R}: ${rp.name} `, N(rp.num)) : null, rp && yp ? " · " : null, yp ? join(`You: ${yp.name} `, N(yp.num)) : null) });
  const args = b.here?.args ?? [];
  const posA = args.filter((l) => l.value > 0).sort((x, y) => y.value - x.value)[0];
  const negA = args.filter((l) => l.value < 0).sort((x, y) => x.value - y.value)[0];
  const argSpan = (l: LiftItem, rs: PoolRow[]) => {
    const hit = rs.filter((r) => r.code.reasons?.includes(l.label));
    return F(l.label, num(hit.length, rs.length, "answers that pick", refsOf(hit, () => l.label)));
  };
  if (posA || negA) lines.push({ label: "What the answer weighs", value: join(posA ? join(argSpan(posA, theirPicks), ` for ${R}`) : null, posA && negA ? " · " : null, negA ? join(argSpan(negA, mine), " for you") : null) });
  else if (b.here?.argsRows?.length) {
    const top = b.here.argsRows[0];
    const hit = theirPicks.filter((r) => r.code.reasons?.includes(top.label));
    lines.push({ label: "What the answer weighs", value: join(F(top.label, num(hit.length, theirPicks.length, "answers that pick", refsOf(hit, () => top.label))), ` for ${R}`) });
  }
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
    ...(missing.length ? { thin: THIN_RIVAL(R, missing.join(" or ")) } : {}),
  };
}

/** The smaller rival panel (worries, looking around, value, problem): named, and named as the alternative. */
function rivalSmall(inp: PanelCellInput, ctx: Ctx, c: { key: string; name: string }, isAlt: (r: PoolRow) => boolean, altLabel: string): PanelRival {
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
  const yAlt = problem ? num(youF.rec.length, all, "answers", refsOf(youF.rec, (r) => youF.surf(r, true) ?? h.brand)) : undefined;
  const claim = problem ? join(`The AI recommends ${R} in `, N(altNum), " of these answers.") : join(`The AI names ${R} as the alternative in `, N(altNum), " of these answers.");
  const steps: PanelStep[] = [
    { key: "named", label: "Named", here: yNamed, rivals: [{ name: R, num: named }], tagRank: duelTag(knOf(yNamed)!, knOf(named)!, R).tag },
    { key: "recommended", label: altLabel, ...(yAlt ? { here: yAlt, tagRank: duelTag(knOf(yAlt)!, knOf(altNum)!, R).tag } : {}), rivals: [{ name: R, num: altNum }] },
  ];
  const lines: PanelLine[] = [];
  const surf = (r: PoolRow) => productLabel(them.surf(r, false) ?? altFind(r), R, ctx) ?? `No ${h.noun} named`;
  if (alt.length >= 5) {
    const items = productSplit(alt, surf, 2, "answers naming it", nounToks(ctx));
    lines.push({ label: `Which of its ${h.plural} it names`, value: splitLine(items) });
  }
  const withR = alt.filter((r) => r.code.reasons !== null);
  if (withR.length >= ARGS_MIN) {
    const counts = new Map<string, number>();
    for (const r of withR) for (const x of new Set(r.code.reasons!)) counts.set(x, (counts.get(x) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    lines.push({ label: "What the answer weighs", value: listSpans(ranked.map(([code, k]) => F(code, num(k, withR.length, "answers naming it", refsOf(withR.filter((r) => r.code.reasons!.includes(code)), () => code))))) });
  }
  return {
    name: R,
    full: false,
    claim,
    steps,
    lines,
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
    // Comparison view: rank among the competitors.
    let worst: { key: PanelStepKey; gap: number } | null = null;
    for (const s of p.steps) {
      if (!s.here || !s.rivals?.length || s.tagRank) continue;
      const r = rankTag(knOf(s.here)!, s.rivals.map((x) => knOf(x.num)!));
      s.tagRank = r.tag;
      if (r.gap > 0 && (!worst || r.gap > worst.gap)) worst = { key: s.key, gap: r.gap };
    }
    if (worst) {
      const s = p.steps.find((x) => x.key === worst!.key)!;
      s.tagRank = `${s.tagRank} · furthest behind`;
      p.focusComp = worst.key;
    }
    detailOf(inp, p, up, ctx);
  }
}

function detailOf(inp: PanelCellInput, p: PositionPanel, up: PositionPanel | undefined, ctx: Ctx) {
  const { h } = ctx;
  const stepPair = (k: PanelStepKey) => {
    const s = p.steps.find((x) => x.key === k);
    const u = up?.steps.find((x) => x.key === k);
    return s?.here && u?.here ? { here: s.here, usual: u.here } : undefined;
  };
  const seg = (s: PanelStep | undefined, key: string) => s?.segments?.find((x) => x.key === key)?.num;
  if (FUNNEL_KINDS.has(p.kind)) {
    if (up) {
      const who = p.kind === "switching" ? { here: "with these customers", usual: "across all rivals' customers" } : { here: "with this buyer", usual: "across all buyers" };
      const f = p.focus ? { key: p.focus, below: p.steps.find((s) => s.key === p.focus)?.tagUsual === TAG_FURTHEST } : null;
      p.detail = funnelDetail(f, { named: stepPair("named"), recommended: stepPair("recommended"), converts: stepPair("converts"), category: stepPair("category") }, who);
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
      const rDir = rate(rk) < rate(ru) * 0.9 ? "less" : rate(rk) > rate(ru) * 1.1 ? "more" : "about as";
      const listy = rate(cu) > 0 && rate(ck) / rate(cu) <= 0.6;
      const heading = listy
        ? `The AI answers this with a list, and rarely names one ${h.noun} as the pick`
        : rDir === "about as"
          ? `You are recommended about as often here as when buyers ask ${what}`
          : `You are recommended ${rDir} often here than when buyers ask ${what}`;
      p.detail = det(
        heading,
        join("You are recommended in ", N(rec.here), " of these answers, against ", N(rec.usual), ` when buyers ask ${what}. The AI names one ${h.noun} as the pick in `, N(com.here), " of answers, against ", N(com.usual), ` in ${what}.`)
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
      p.detail = det(
        heading,
        join(
          "It names a brand in ",
          N(any.here),
          " of these answers",
          any.usual ? join(", against ", N(any.usual), " when buyers describe a problem") : "",
          ". When a brand is named, you are in ",
          N(nw.here),
          " of those answers",
          nw.usual ? join(", against ", N(nw.usual), ` in ${ROW_NAME.awareness.toLowerCase()}`) : "",
          "."
        )
      );
      return;
    }
    case "alongside": {
      const v = inp.rows;
      const str = v.filter((r) => r.code.relationship_verdict === "strengthens");
      const weak = v.filter((r) => r.code.relationship_verdict === "weakens");
      const sn = num(str.length, v.length, "answers", refsOf(str, (r) => verdictFind(r, h)));
      const wn = num(weak.length, v.length, "answers", refsOf(weak, (r) => verdictFind(r, h)));
      const heading = weak.length === 0 ? "The AI builds on what the customer already has with you" : weak.length > str.length ? "The AI more often works against what the customer has with you" : "The AI mostly builds on what the customer has with you";
      p.detail = det(
        heading,
        join(
          "The customer asked what to use alongside you, so another company's name in the answer is the question being answered, not the AI steering them away. ",
          str.length === v.length && v.length > 0 ? join(F("Every answer", sn), ` builds on the customer's use of ${h.brand}`) : join(N(sn), ` of answers build on the customer's use of ${h.brand}`),
          weak.length ? join(" and ", N(wn), " work against it.") : "; none works against it."
        )
      );
      return;
    }
    case "critic": {
      const sg = p.steps.find((x) => x.key === "strength");
      const pm = p.steps.find((x) => x.key === "premise");
      const strong = sg?.segments?.find((x) => x.key === "strong")?.num.pct ?? 0;
      const rebuts = pm?.segments?.find((x) => x.key === "rebuts")?.num.pct ?? 0;
      const confirms = pm?.segments?.find((x) => x.key === "confirms")?.num.pct ?? 0;
      const heading = strong >= 50 && rebuts >= 50 ? "The AI arms the customer against the critic" : confirms >= 50 ? "The AI more often sides with the critic" : "The AI gives the customer only part of a defense";
      const red = p.lines?.some((l) => l.label.startsWith("Also points to"));
      p.detail = det(heading, join(`The customer took your side and asked for arguments, so read this as how well the AI equips them. It is not the AI choosing you over a rival.${red ? "" : ` No answer points the customer to another ${h.noun}.`}`));
      return;
    }
    case "h2h": {
      const won = p.steps.find((s) => s.key === "won");
      const decided = p.steps.find((s) => s.key === "decided");
      const R = inp.pooled ? "your named rivals" : inp.rivalName ?? inp.label;
      if (inp.exception && decided?.here && won?.rivals) {
        p.detail = det(
          "You lose this one - with an exception",
          join("The AI names one of you in ", N(decided.here), ` of answers, and it picks ${R} in `, N(won.rivals[0].num), ` of those. Most of the answers that pick ${R} still say when to choose you.`)
        );
      } else if (won?.here) {
        const w = won.here.pct;
        p.detail = det(
          w >= 60 ? (inp.pooled ? "You win most of your head-to-heads" : `You win this matchup against ${R}`) : w <= 40 ? (inp.pooled ? "Your named rivals win most of your head-to-heads" : `${R} wins this matchup`) : "This matchup is close",
          join("When the AI picks one of the two, it picks you in ", N(won.here), " of those answers.", decided?.here ? join(" It picks one of the two in ", N(decided.here), " of all answers.") : "")
        );
      }
      return;
    }
    case "buyer_worry": {
      const v = p.steps.find((s) => s.key === "verdict");
      const go = seg(v, "proceed");
      const none = seg(v, "none");
      const ag = p.steps.find((s) => s.key === "agrees")?.here;
      const uNone = seg(up?.steps.find((s) => s.key === "verdict"), "none");
      if (!go || !none) return;
      const heading =
        ag && ag.pct >= 50 && go.pct < 10
          ? "It grants the worry, then leaves the decision to the buyer"
          : go.pct >= 50
            ? "It tells most buyers to go ahead"
            : "It answers the worry without settling it";
      p.detail = det(heading, join("It takes no side in ", N(none), " of these answers", uNone ? join(", against ", N(uNone), " across all your buyers' worries") : "", "."));
      return;
    }
    case "customer_worry": {
      const v = p.steps.find((s) => s.key === "verdict");
      const keep = seg(v, "keep");
      const leave = seg(v, "leave");
      const ag = p.steps.find((s) => s.key === "agrees");
      if (!keep || !leave) return;
      const heading = leave.pct > keep.pct ? "Where it takes a side, it sides with leaving" : keep.pct > leave.pct ? "Where it takes a side, it sides with staying" : "It rarely takes a side";
      const ua = up?.steps.find((s) => s.key === "agrees")?.here;
      p.detail = det(heading, ag?.here ? join("It agrees with the complaint in ", N(ag.here), " of the answers that judge it", ua ? join(", against ", N(ua), " across all your customers' worries") : "", ".") : join("It says leave in ", N(leave), " of answers and stay in ", N(keep), "."));
      return;
    }
    case "looking_around": {
      const v = p.steps.find((s) => s.key === "verdict");
      const leave = seg(v, "leave");
      const offers = p.steps.find((s) => s.key === "offers")?.here;
      if (!leave || !offers) return;
      p.detail = det(
        leave.pct < 10 && offers.pct >= 50 ? "It does not push them out, but it shows them the door" : leave.pct >= 30 ? "It tells many of your customers to leave" : "It mostly leaves the choice to your customer",
        join(`Asked for alternatives, the AI supplies them in `, N(offers), " of answers. It says leave in ", N(leave), ", so the names it gives are who it puts in front of your customers, not always who it sends them to.")
      );
      return;
    }
    case "value": {
      const w = p.steps.find((s) => s.key === "worth");
      const no = seg(w, "no");
      const yes = seg(w, "yes");
      const uNo = seg(up?.steps.find((s) => s.key === "worth"), "no");
      if (!no || !yes) return;
      const heading = no.pct > yes.pct ? (inp.pooled ? "Across buyers the AI more often says it does not earn the higher price" : "For this buyer the AI does not think it earns the higher price") : yes.pct > no.pct ? "The AI more often says it earns the higher price" : "The AI mostly says it depends";
      p.detail = det(heading, uNo && !inp.pooled ? join("Across all buyers the AI says not worth it in ", N(uNo), " of answers; for this buyer it is ", N(no), ".") : join("It says not worth it in ", N(no), " of answers and worth it in ", N(yes), "."));
      return;
    }
    case "criteria": {
      const gap = p.steps.find((s) => s.key === "gap");
      p.detail = gap
        ? det("The checklist the AI hands buyers leaves out your strongest points", join(`A buyer who follows this checklist compares ${h.plural} on things other brands win on.`))
        : det("The checklist the AI hands buyers covers your case", join("What comes up most when the AI picks you is on the list it teaches."));
      return;
    }
    case "expansion": {
      const s = p.steps.find((x) => x.key === "stance");
      const segs = s?.segments ?? [];
      const top = [...segs].sort((a, b) => b.num.pct - a.num.pct)[0];
      const heading = top?.key === "backs" ? "The AI supports your customers growing their use" : top?.key === "redirects" ? "The AI mostly points your customers elsewhere" : "The AI mostly leaves the decision to the customer";
      p.detail = det(heading, join("The customer set the direction by asking, so read this as the AI not getting in the way. It is not the AI choosing you over a rival."));
      return;
    }
    case "business_case": {
      const top = p.table?.rows.slice(0, 2).map((r) => r.label) ?? [];
      p.detail = det(
        top.length ? `The AI makes your case, most often on ${listWords(top)}` : "The AI makes your case",
        join("The customer already chose you and asked for arguments, so read this as how well the AI equips them. It is not the AI choosing you over a rival.")
      );
      return;
    }
  }
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
  const ctx: Ctx = { h, inputs };
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
      rows: pick.map((x) => ({ label: x.c, cells: [num(x.a.length, t.length, "answers that pick", refsOf(x.a, () => x.c)), num(x.b.length, m.length, "answers that pick", refsOf(x.b, () => x.c))] })),
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
      heading: `Where ${R}'s customers are sent`,
      body: lp?.claim ?? join(`When ${R}'s customers ask where to move, the AI picks you in `, N(num(mine.length, split.n, "picks", refsOf(mine, pf(h.brand)))), " of its picks."),
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
      const prods = productSplit(rs, (r) => productLabel((r.code.mentions ?? []).find((m) => h.resolve(m.brand).key === key)?.brand ?? R, R, ctx) ?? `No ${h.noun} named`, 1, "answers", nounToks(ctx))[0];
      return prods && !prods.name.startsWith("No ") ? { t: `Names ${prods.name} most`, ...(prods.num.refs ? { refs: prods.num.refs } : {}), tip: prods.num.tip } : null;
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
    const ps = productSplit(theirPicks, (r) => pickedProduct(r, ctx, false), 3, `picks of ${R}`, nounToks(ctx)).filter((x) => (knOf(x.num)?.k ?? 0) >= ROW_MIN);
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
  for (const l of [...(p.lines ?? []), ...(p.linesComp ?? [])]) out.push(l.value);
  for (const s of p.steps) if (s.note) out.push(s.note);
  return out;
}

export { T };
