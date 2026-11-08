import type { AnswerCard } from "./brief_types";
import type { BrandSummaryView, SummaryBrand } from "./brand_summary";
import { pctFine, type InsightInputs } from "./summary_insights";
import { cell, poolOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import type { Position } from "./analysis_types";
import { buildResolver } from "./brand_resolve";
import { liftForBrand } from "./analysis_map";
import { productNoun } from "./summary_insights";
import { isDefaultCondition } from "./condition_groups";

/**
 * The answer cards (2026-11-07, the owner's ratified shape -
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
export const signedPts = (x: number) => `${x >= 0 ? "+" : "-"}${Math.round(Math.abs(x) * 100)} points`;
const listVal = (xs: string[]) => xs.join(" · ");
const poss = (name: string) => `${name}'s`;
const conv = (b: { chosen: RateCell; recommended: RateCell }) => (b.recommended.k > 0 ? b.chosen.k / b.recommended.k : 0);
type Row = AnswerCard["rows"][number];
const F = (label: string, c: RateCell, value = pct(c)): Row => ({ label, value, tip: tipC(c) });

/** A card read at the same floor as the map's sides (MIN_SIDE). */
const MIN_SIDE = 20;
/** The analysis map's watch threshold (WATCH_ENGINE_SHARE), the detector's unit test. */
const WATCH_ENGINE_SHARE = 0.4;

export type Lift = { code: string; wins: RateCell; others: RateCell; lift: number };

/** One lift line - shared with the map's open-choice cell (am10). */
export function liftLine(l: Lift): string {
  return `${l.code}: ${pct(l.wins)} of its picks, ${pct(l.others)} of other picks (${signedPts(l.lift)})`;
}

/** Everything a card's text states, as one string (RULE 1 and the harness read this). */
export function cardText(card: AnswerCard): string {
  return [
    card.crumb,
    card.headline,
    ...card.rows.flatMap((r) => [r.label, r.value]),
    ...(card.lifts ?? []).flatMap((l) => [l.label, l.wins ?? "", l.others ?? "", liftPoints(l.value)]),
  ].join(" \n ");
}

/** A lift entry's signed points as the briefs print them ("+30 points"). */
export const liftPoints = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(Math.round(v))} points`;

/* ---------------------------------- keys ---------------------------------- */

export const BRAND_CARD = (key: string) => `card:brand:${key}`;
export const ENGINES_CARD = "card:engines";
export const CONDITION_CARD = "card:conditions";

/* ---------------------------------- cell ---------------------------------- */

/** A map cell's own story: the position's claim, its (slimmed) figures and -
 * bf17 - its arguments, drawn as the map panel draws them (bars + shares). */
export function cellCard(p: Position): AnswerCard {
  return {
    kind: "cell",
    crumb: p.where,
    headline: p.claim,
    rows: (p.figures ?? []).map((f) => ({ label: f.label, value: f.value, ...(f.tip ? { tip: f.tip } : {}) })),
    ...(p.lifts.length
      ? {
          lifts: p.lifts.map((l) => ({
            label: l.label,
            value: l.value,
            ...(l.wins ? { wins: l.wins } : {}),
            ...(l.others ? { others: l.others } : {}),
            ...(l.tip ? { tip: l.tip } : {}),
          })),
          ...(p.liftSides ? { liftSides: p.liftSides } : {}),
        }
      : {}),
    go: { label: "Open this contest on the map", target: "map", cellId: p.cellId },
  };
}

/* ---------------------------------- brand --------------------------------- */

export interface CardSources {
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
  const resolve = buildResolver(data.dictionary, data.judged);
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
    .filter((x) => rate(x.picks) >= WATCH_ENGINE_SHARE && x.picks.low > x.base)
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

/** The argument a brand wins on and the one it loses on (its lift list's two ends). */
export function liftEnds(src: CardSources, key: string): { win: Lift; lose: Lift | null } | null {
  const lift = src.liftOf(key);
  if (!lift.length) return null;
  return { win: lift[0], lose: lift.length > 1 ? lift[lift.length - 1] : null };
}

/** The brand card's headline sentence. */
export function brandHeadline(name: string, b: SummaryBrand): string {
  return `${name} is named in ${pct(b.mentioned)} of answers and takes ${pct(b.shareOfDecided)} of the picks - it turns ${pctOf(conv(b))} of its recommendations into picks.`;
}

/** One brand's open buying questions: the funnel, where its picks come from,
 * its arguments and the assistant that supplies them. The target's card also
 * carries its picks by buying situation. Null for a brand not in the table. */
export function brandCard(src: CardSources, key: string): AnswerCard | null {
  const s = src.summary;
  const isTarget = key === s.target.key;
  const b: SummaryBrand | undefined = isTarget ? s.target : s.brands.find((x) => x.key === key);
  if (!b) return null;
  const name = isTarget ? src.brand : b.name;
  const f = funnelRows(b);
  const rows: Row[] = [f.named, f.recommended, f.share, f.picked, f.converts];
  // Where its picks come from, by question type.
  const from = picksFromRow(src, key);
  if (from) rows.push(from);
  // The target: its picks by buying situation, the rest, and each situation's share.
  const inputs = src.inputs;
  if (isTarget && b.chosen.k > 0 && inputs.rooms.length >= 2) {
    const tot = b.chosen.k;
    const rs = [...inputs.rooms].sort((a, c) => c.picks - a.picks || a.room.localeCompare(c.room));
    rows.push({ label: "Its picks by buying situation", value: listVal(rs.filter((r) => r.picks > 0).map((r) => `${r.room} ${pctOf(r.picks / tot)}`)), tip: rs.map((r) => `${r.room} ${r.picks}`).join(", ") + ` of ${tot}` });
    const top = rs[0];
    rows.push(F(`Share of picks outside ${top.room}`, cell(tot - top.picks, Math.max(0, s.firmPickInCategory.k - top.firm))));
    for (const r of rs) if (r.firm > 0) rows.push(F(`Share of picks for ${r.room}`, r.decided));
  }
  // One question's share of its picks.
  const tq = topQuestionRow(src, key);
  if (tq) rows.push(tq);
  // The arguments that travel with its picks.
  const ends = liftEnds(src, key);
  if (ends) {
    rows.push({ label: "The argument it wins on", value: liftLine(ends.win), tip: `${tipC(ends.win.wins)} picks; ${tipC(ends.win.others)} other picks` });
    if (ends.lose) rows.push({ label: "The argument it loses on", value: liftLine(ends.lose), tip: `${tipC(ends.lose.wins)} picks; ${tipC(ends.lose.others)} other picks` });
  }
  const sup = supplyLine(s, inputs, key);
  if (sup) rows.push(sup);
  return {
    kind: "brand",
    crumb: `${name} · open buying questions`,
    headline: brandHeadline(name, b),
    rows,
    go: { label: "Open in Build a table", target: "metrics" },
  };
}

/* --------------------------------- engines -------------------------------- */

/** The assistants: the target's share of picks and how often the AI commits,
 * by mode, company and assistant. Null when fewer than two engines decide. */
export function enginesCard(src: CardSources): AnswerCard | null {
  const s = src.summary;
  const brand = src.brand;
  const eng1 = s.byEngine.filter((e) => e.decided.n > 0);
  if (eng1.length < 2) return null;
  const rows: Row[] = [];
  const modes = (["search", "instinct"] as const).map((m) => {
    const list = s.byEngine.filter((e) => e.mode === m);
    const answers = list.reduce((x, e) => x + e.answers, 0);
    const firm = list.reduce((x, e) => x + e.decided.n, 0);
    const won = list.reduce((x, e) => x + e.decided.k, 0);
    return { m, firm: cell(firm, answers), decided: cell(won, firm) };
  });
  const both = modes.every((x) => x.firm.n > 0);
  if (both) {
    rows.push({ label: "The AI commits to a pick, with / without web search", value: `${pct(modes[0].firm)} / ${pct(modes[1].firm)}`, tip: `${tipC(modes[0].firm)} / ${tipC(modes[1].firm)}` });
    rows.push({ label: "Its share of picks, with / without web search", value: `${pct(modes[0].decided)} / ${pct(modes[1].decided)}`, tip: `${tipC(modes[0].decided)} / ${tipC(modes[1].decided)}` });
  }
  const se = s.byMode.find((m) => m.key === "search");
  const ins = s.byMode.find((m) => m.key === "instinct");
  if (se && ins && se.decided.n > 0 && ins.decided.n > 0) {
    const v = `${pct(se.decided)} / ${pct(ins.decided)}`;
    if (!rows.some((r) => r.value === v)) rows.push({ label: "Its share of picks by mode, with / without web search", value: v });
  }
  if (se && ins && se.h2h.n > 0 && ins.h2h.n > 0) rows.push({ label: "Direct matchups won, with / without web search", value: `${pct(se.h2h)} / ${pct(ins.h2h)}`, tip: `${tipC(se.h2h)} / ${tipC(ins.h2h)}` });
  const vend = new Map<string, { k: number; n: number }>();
  for (const e of s.byEngine) {
    const t = vend.get(e.vendor) ?? { k: 0, n: 0 };
    t.k += e.decided.k;
    t.n += e.decided.n;
    vend.set(e.vendor, t);
  }
  if (vend.size >= 2) rows.push({ label: "Its share of picks, by company", value: listVal([...vend.entries()].map(([v, t]) => `${v} ${pct(cell(t.k, t.n))}`)) });
  rows.push({ label: "Its share of picks, by assistant", value: listVal(eng1.map((e) => `${e.label} ${pct(e.decided)}`)) });
  let headline: string;
  if (both) {
    const [a, b] = modes;
    const gap = Math.abs(rate(a.decided) - rate(b.decided));
    headline = `With web search the AI commits to one ${src.product} in ${pct(a.firm)} of answers, without in ${pct(b.firm)} - ${poss(brand)} share of those picks ${gap < 0.05 ? "barely moves" : `is ${pct(a.decided)} with and ${pct(b.decided)} without`}.`;
  } else {
    const sorted = [...eng1].sort((x, y) => rate(y.decided) - rate(x.decided));
    headline = `${poss(brand)} share of picks runs from ${pct(sorted[0].decided)} on ${sorted[0].label} to ${pct(sorted[sorted.length - 1].decided)} on ${sorted[sorted.length - 1].label}.`;
  }
  return { kind: "engines", crumb: `${brand} · by assistant`, headline, rows, go: { label: "Open in Build a table", target: "metrics" } };
}

/* -------------------------------- condition ------------------------------- */

/** What routes buyers away: the run's away condition groups (where each
 * sends buyers), the biggest reason toward each side, and the blocker brand's
 * share of picks. Null when the run carries no condition groups.
 *
 * 2026-11-08 (the owner's ruling): worded as reasons to leave / pick you, and
 * a default-shaped branch ("otherwise" - isDefaultCondition) leaves the list
 * for one default row. A default group the brief cites (the detector's top
 * group or its wall, or a "biggest" branch) stays where it is cited - its
 * number must remain stated - and only its label is restyled. */
export function conditionCard(src: CardSources, openCellId?: string): AnswerCard | null {
  const s = src.summary;
  const brand = src.brand;
  const k = src.inputs.conditions;
  const a = src.inputs.away;
  const rows: Row[] = [];
  const shown = new Set<string>();
  if (a && a.cells > 0) {
    // Largest share first (the groups arrive ranked by answers).
    for (const g of [...a.groups].sort((x, y) => y.cells - x.cells || x.label.localeCompare(y.label))) {
      const cited = g === a.groups[0] || g.wall;
      if (isDefaultCondition(g.label) && !cited) continue;
      shown.add(`away:${g.label}`);
      rows.push({
        label: isDefaultCondition(g.label) ? "The default away from you - when no stated reason applies" : `A reason to leave you: "${g.label.slice(0, 60)}"`,
        value: `${pctOf(g.cells / a.cells)}${g.routes[0] ? ` → ${g.routes[0].name}` : ""}`,
        tip: `${g.cells} of ${a.cells} questions with an away condition`,
      });
    }
  }
  if (k) {
    const big = (g: { label: string }, plain: string, dflt: string) => (isDefaultCondition(g.label) ? dflt : plain);
    if (k.toward[0] && k.towardCells) {
      shown.add(`you:${k.toward[0].label}`);
      rows.push({ label: big(k.toward[0], "The biggest reason to pick you", "The default toward you - when no stated reason applies"), value: `${pctOf(k.toward[0].cells / k.towardCells)} - "${k.toward[0].label}"`, tip: `${k.toward[0].cells} of ${k.towardCells} questions where any condition routes to it` });
    }
    if (k.away[0] && k.awayCells) {
      shown.add(`away:${k.away[0].label}`);
      rows.push({ label: big(k.away[0], "The biggest reason to leave you", "The default away from you - when no stated reason applies"), value: `${pctOf(k.away[0].cells / k.awayCells)} - "${k.away[0].label}"`, tip: `${k.away[0].cells} of ${k.awayCells} questions where any condition routes away` });
    }
    const seen = new Set<string>();
    for (const g of k.away) {
      const to = g.routes[0]?.name;
      if (!to || seen.has(to) || !k.awayCells) continue;
      seen.add(to);
      // The biggest reason away is already its own row.
      if (g === k.away[0]) continue;
      shown.add(`away:${g.label}`);
      rows.push({ label: big(g, `The biggest reason pointing to ${to}`, `The default pointing to ${to} - when no stated reason applies`), value: `${pctOf(g.cells / k.awayCells)} - "${g.label}"`, tip: `${g.cells} of ${k.awayCells} questions where any condition routes away` });
    }
    // The default branches: one row per side, unless a cited row above already shows it.
    const defs = (k.defaults ?? []).filter((d) => d.routes[0] && !shown.has(`${d.side}:${d.label}`));
    for (const d of defs)
      rows.push({
        label: defs.length > 1 ? `The default ${d.side === "you" ? "toward you" : "away from you"} - when no stated reason applies` : "The default - when no stated reason applies",
        value: `→ ${d.routes[0].name}`,
      });
  }
  const g = a?.groups[0];
  if (g?.names) {
    const b = s.brands.find((x) => x.key === g.names!.key);
    rows.push(F(`${g.names.name}'s share of picks`, b ? b.shareOfDecided : cell(0, s.firmPickInCategory.k)));
  }
  if (!rows.length) return null;
  // The headline names the most common STATED reason - a default branch is not one.
  const top = a?.groups.find((x) => !isDefaultCondition(x.label)) ?? k?.away.find((x) => !isDefaultCondition(x.label)) ?? null;
  const headline = top
    ? `When the AI gives buyers a reason to leave ${brand}, the most common is "${top.label}"${top.routes[0] ? ` - it points them to ${top.routes[0].name}` : ""}.`
    : `The AI hands the buyer a rule, not a winner - these are the conditions that decide it.`;
  return {
    kind: "condition",
    crumb: "What routes buyers away",
    headline,
    rows,
    ...(openCellId ? { go: { label: "See every condition", target: "map" as const, cellId: openCellId } } : {}),
  };
}
