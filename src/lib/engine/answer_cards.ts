import type { BrandSummaryView, SummaryBrand } from "./brand_summary";
import { FLOORS, seldomOf, liftLead } from "./facts/measure_book";
import { clearsConcentration, pctFine, type InsightInputs } from "./summary_insights";
import { cell, poolOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { buildResolver } from "./brand_resolve";
import { productNoun } from "./summary_insights";

/**
 * The brand dossiers' row helpers (dossiers.ts). Fact layer step 5, part 2: the Brief no longer builds brand, assistants
 * or condition answer cards (every Brief number links by its fact id to the card that draws it); what is left here is
 * what the dossiers read, unchanged - including liftForBrand, moved here from the retired brief_legacy_inputs.ts.
 *
 * Origin (2026-11-07, the owner's ratified shape -
 * public/_position_panel_options.html tab 4). Every brief pin opens one small
 * card that answers ONE question; the citation contract (every visible number
 * in a paragraph or row is stated by one of its pins' cards) is checked
 * against the card's text (cardText).
 *
 * Four kinds:
 *   cell      - a map cell's own story: the position's claim and its
 *               cell-scoped figures (the slimmed am10 panel);
 *   brand     - one brand's open-question funnel, where its picks come from,
 *               its arguments and the assistant that supplies them;
 *   engines   - the assistants split (the target's share and how often the
 *               AI commits, by mode, company and assistant);
 *   condition - what routes buyers away (the run's condition groups).
 *
 * The brand / engines / condition rows were the am9 pooled open-choice
 * panel's figures; their assembly MOVED here from analysis_map.ts (am10),
 * restating the same objects with the same formatting, so a card's numbers
 * stay byte-equal with the brief sentences that read those objects. Pure
 * functions over objects the brief already holds - no model call, no load.
 */

/* --------------------------------- format --------------------------------- */

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
export const pctOf = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const pct = (c: RateCell) => pctOf(rate(c));
const tipC = (c: RateCell) => `${c.k} of ${c.n}`;
const listVal = (xs: string[]) => xs.join(" · ");
const conv = (b: { chosen: RateCell; recommended: RateCell }) => (b.recommended.k > 0 ? b.chosen.k / b.recommended.k : 0);
type Row = { label: string; value: string; tip?: string };
const F = (label: string, c: RateCell, value = pct(c)): Row => ({ label, value, tip: tipC(c) });

/** A card read at the same floor as the map's sides (MIN_SIDE). */
const MIN_SIDE = 20;

export type Lift = { code: string; wins: RateCell; others: RateCell; lift: number; seldom: boolean };

/* ---------------------------------- brand --------------------------------- */

interface CardSources {
  summary: BrandSummaryView;
  inputs: InsightInputs;
  /** The tracker's own brand, as the project writes it. */
  brand: string;
  /** "credit card" - productNoun(category). */
  product: string;
  /** A brand's open-choice picks by question stage, over the headline pool. */
  stagePicks: (key: string) => Map<string, number>;
  /** A brand's argument lift over the headline pool (the summary's for the target). */
  liftOf: (key: string) => Lift[];
}

/** The card sources over one load (shared by the brief and the brand dossiers,
 * so both state the same numbers): every brand's open-choice picks by stage
 * over the headline pool, and each brand's argument lift (the summary's own
 * for the target, liftForBrand for the rest, computed once per key). */
export function cardSourcesOf(data: ViewData, eng: ViewRequest, summary: BrandSummaryView, inputs: InsightInputs): { src: CardSources; byStage: Map<string, Map<string, number>> } {
  const resolve = buildResolver(data.dictionary, data.judged, data.names);
  const byStage = new Map<string, Map<string, number>>();
  for (const { code, intent } of poolOf(data, "headline", eng).rows)
    if (code.outcome === "pick" && code.top_pick) {
      const k = resolve(code.top_pick).key;
      if (!k) continue;
      const m = byStage.get(k) ?? new Map<string, number>();
      m.set(intent.stage, (m.get(intent.stage) ?? 0) + 1);
      byStage.set(k, m);
    }
  const lifts = new Map<string, Lift[]>();
  const liftOf = (key: string): Lift[] => {
    if (key === summary.target.key) return summary.reasonLift;
    let l = lifts.get(key);
    if (!l) {
      l = liftForBrand(data, eng, key);
      lifts.set(key, l);
    }
    return l;
  };
  const src: CardSources = { summary, inputs, brand: data.project.brand, product: productNoun(data.project.category), stagePicks: (k) => byStage.get(k) ?? new Map(), liftOf };
  return { src, byStage };
}

const STAGE: Record<string, string> = { discovery: "general questions", use_case: "job-described questions", social_validation: "what most people pick", premium_worth: "premium vs basic" };

/** One engine or one company's assistants supplying a brand's picks - the
 * engine_pick_concentration detector's units and test (>= 40% of the picks,
 * the 95% range clearing the unit's share of the answers), best gap first.
 * Exported for the brand dossiers (dossiers.ts), which state the same line. */
export function supplyLine(s: BrandSummaryView, inputs: InsightInputs, key: string): Row | null {
  if (s.byEngine.length < 3 || s.answers === 0) return null;
  const b = inputs.enginePicks.find((x) => x.key === key);
  if (!b || b.total < MIN_SIDE) return null;
  type Unit = { label: string; models: string[]; answers: number; vendor: boolean };
  const units: Unit[] = s.byEngine.map((e) => ({ label: e.label, models: [e.key], answers: e.answers, vendor: false }));
  const vs = new Map<string, Unit>();
  for (const e of s.byEngine) {
    const u = vs.get(e.vendor) ?? { label: e.vendor, models: [], answers: 0, vendor: true };
    u.models.push(e.key);
    u.answers += e.answers;
    vs.set(e.vendor, u);
  }
  if (vs.size >= 2) for (const u of vs.values()) if (u.models.length >= 2) units.push(u);
  const best = units
    .map((u) => ({ u, picks: cell(u.models.reduce((x, m) => x + (b.byModel[m] ?? 0), 0), b.total), base: u.answers / s.answers }))
    .filter((x) => clearsConcentration(x.picks, x.base))
    .sort((x, y) => rate(y.picks) - y.base - (rate(x.picks) - x.base) || x.u.label.localeCompare(y.u.label))[0];
  if (!best) return null;
  return {
    label: `${best.u.vendor ? `${best.u.label}'s ${best.u.models.length} assistants` : best.u.label} supply`,
    value: `${pct(best.picks)} of its picks (answering ${pctOf(best.base)} of the questions)`,
    tip: `${best.picks.k} of ${best.picks.n} picks`,
  };
}

/* The brand card's pieces, exported so the brand dossiers (dossiers.ts) state
 * byte-equal numbers: each is the exact row (or object) brandCard uses. */

/** The brand's recommended-to-pick conversion (picks over recommendations). */
export const conversionOf = conv;

/** The open-question funnel, as the card's first five rows. */
export function funnelRows(b: SummaryBrand): { named: Row; recommended: Row; share: Row; picked: Row; converts: Row } {
  const named = rate(b.mentioned);
  return {
    named: F("Named", b.mentioned),
    recommended: { label: "Recommended", value: `${pct(b.recommended)} (${pctOf(named > 0 ? rate(b.recommended) / named : 0)} of the answers that name it)`, tip: `${b.recommended.k} of ${b.recommended.n}; ${b.recommended.k} recommending of ${b.mentioned.k} naming` },
    share: F("Share of picks", b.shareOfDecided),
    picked: F("Picked, of all answers", b.chosen, pctFine(rate(b.chosen))),
    converts: { label: "Recommendations that end as the pick", value: pctOf(conv(b)), tip: `${b.chosen.k} of ${b.recommended.k}` },
  };
}

/** Where a brand's picks come from, by question type (null under the floor). */
export function picksFromRow(src: CardSources, key: string): Row | null {
  const by = src.stagePicks(key);
  const total = [...by.values()].reduce((a, x) => a + x, 0);
  if (total < MIN_SIDE) return null;
  const parts = [...by.entries()].filter(([st, k]) => k > 0 && STAGE[st]).sort((a, c) => c[1] - a[1]).map(([st, k]) => `${pctOf(k / total)} ${STAGE[st]}`);
  if (!parts.length) return null;
  return { label: "Where its picks come from", value: listVal(parts), tip: [...by.entries()].map(([st, k]) => `${st} ${k}`).join(", ") + ` of ${total}` };
}

/** One question's share of a brand's picks (null under the floor). */
export function topQuestionRow(src: CardSources, key: string): Row | null {
  const qs = src.inputs.questions;
  const qTot = qs.reduce((a, q) => a + (q.picks[key] ?? 0), 0);
  if (qTot < MIN_SIDE || qs.length < 2) return null;
  const q = [...qs].sort((a, c) => (c.picks[key] ?? 0) - (a.picks[key] ?? 0) || a.id.localeCompare(c.id))[0];
  const k = q.picks[key] ?? 0;
  return { label: "Picks from its top question", value: pct(cell(k, qTot)), tip: `${k} of ${qTot}: "${q.text.replace(/\s+/g, " ").slice(0, 90)}"` };
}

/** The argument a brand wins on and the one it loses on (its lift list's two ends; each end the strongest row that is
 * not seldom raised, when one exists - liftLead). */
export function liftEnds(src: CardSources, key: string): { win: Lift; lose: Lift | null } | null {
  const lift = src.liftOf(key);
  if (!lift.length) return null;
  const win = liftLead(lift.filter((l) => l.lift > 0))?.row ?? lift[0];
  const lose = lift.length > 1 ? liftLead([...lift].reverse().filter((l) => l.lift < 0))?.row ?? lift[lift.length - 1] : null;
  return { win, lose: lose === win ? null : lose };
}

/** The brand card's headline sentence. */
export function brandHeadline(name: string, b: SummaryBrand): string {
  return `${name} is named in ${pct(b.mentioned)} of answers and takes ${pct(b.shareOfDecided)} of the picks - it turns ${pctOf(conv(b))} of its recommendations into picks.`;
}

/* The dossiers' per-brand argument lift (moved from brief_legacy_inputs.ts, unchanged): over the open-choice pool.
 * Share of answers arguing each code when `key` is picked vs when another in-category brand is, over the headline pool
 * (brand_summary's lift, for any brand). */
function liftForBrand(data: ViewData, request: ViewRequest, key: string): Lift[] {
  const resolve = buildResolver(data.dictionary, data.judged, data.names);
  const rows = poolOf(data, "headline", request).rows;
  const facts = rows.map(({ code }) => {
    let pick: string | null = null;
    if (code.outcome === "pick" && code.top_pick) {
      const r = resolve(code.top_pick);
      if (r.status === "active") pick = r.key;
    }
    return { pick, reasons: code.reasons };
  });
  const wins = facts.filter((f) => f.pick === key && f.reasons !== null);
  const others = facts.filter((f) => f.pick !== null && f.pick !== key && f.reasons !== null);
  // The one lift rule (FLOORS.liftMinSide a side, no incidence gate; seldomOf marks a rarely raised row).
  if (wins.length < FLOORS.liftMinSide || others.length < FLOORS.liftMinSide) return [];
  const codes = new Set<string>();
  for (const f of facts) if (f.reasons !== null) for (const r of f.reasons) codes.add(r);
  return [...codes]
    .map((code) => {
      const w = cell(wins.filter((f) => f.reasons!.includes(code)).length, wins.length);
      const o = cell(others.filter((f) => f.reasons!.includes(code)).length, others.length);
      return { code, wins: w, others: o, lift: rate(w) - rate(o), seldom: seldomOf(w, o) };
    })
    .filter((l) => l.wins.k + l.others.k > 0)
    .sort((a, b) => b.lift - a.lift);
}
