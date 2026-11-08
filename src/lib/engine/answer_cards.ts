import type { AnswerCard } from "./brief_types";
import type { BrandSummaryView, SummaryBrand } from "./brand_summary";
import { pctFine, type InsightInputs } from "./summary_insights";
import { cell, type RateCell } from "./view_data";
import type { Position } from "./analysis_types";

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
  return [card.crumb, card.headline, ...card.rows.flatMap((r) => [r.label, r.value])].join(" \n ");
}

/* ---------------------------------- keys ---------------------------------- */

export const BRAND_CARD = (key: string) => `card:brand:${key}`;
export const ENGINES_CARD = "card:engines";
export const CONDITION_CARD = "card:conditions";

/* ---------------------------------- cell ---------------------------------- */

const cardRank = (label: string) => (label.endsWith("it wins on") ? 0 : label.endsWith("it loses on") ? 1 : 2);

/** A map cell's own story: the position's claim and its (slimmed) figures. */
export function cellCard(p: Position): AnswerCard {
  return {
    kind: "cell",
    crumb: p.where,
    headline: p.claim,
    rows: [
      ...(p.figures ?? []).map((f) => ({ label: f.label, value: f.value, ...(f.tip ? { tip: f.tip } : {}) })),
      // am11: the open-choice cell's argument lines (they left its figures for
      // the panel's arguments section); wins-on, loses-on, then the rest.
      ...[...p.lifts]
        .filter((l) => l.card)
        .sort((a, b) => cardRank(a.card!.label) - cardRank(b.card!.label))
        .map((l) => ({ ...l.card! })),
    ],
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

const STAGE: Record<string, string> = { discovery: "general questions", use_case: "job-described questions", social_validation: "what most people pick", premium_worth: "premium vs basic" };

/** One engine or one company's assistants supplying a brand's picks - the
 * engine_pick_concentration detector's units and test (>= 40% of the picks,
 * the 95% range clearing the unit's share of the answers), best gap first. */
function supplyLine(s: BrandSummaryView, inputs: InsightInputs, key: string): Row | null {
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

/** One brand's open buying questions: the funnel, where its picks come from,
 * its arguments and the assistant that supplies them. The target's card also
 * carries its picks by buying situation. Null for a brand not in the table. */
export function brandCard(src: CardSources, key: string): AnswerCard | null {
  const s = src.summary;
  const isTarget = key === s.target.key;
  const b: SummaryBrand | undefined = isTarget ? s.target : s.brands.find((x) => x.key === key);
  if (!b) return null;
  const name = isTarget ? src.brand : b.name;
  const named = rate(b.mentioned);
  const rows: Row[] = [
    F("Named", b.mentioned),
    { label: "Recommended", value: `${pct(b.recommended)} (${pctOf(named > 0 ? rate(b.recommended) / named : 0)} of the answers that name it)`, tip: `${b.recommended.k} of ${b.recommended.n}; ${b.recommended.k} recommending of ${b.mentioned.k} naming` },
    F("Share of picks", b.shareOfDecided),
    F("Picked, of all answers", b.chosen, pctFine(rate(b.chosen))),
    { label: "Recommendations that end as the pick", value: pctOf(conv(b)), tip: `${b.chosen.k} of ${b.recommended.k}` },
  ];
  // Where its picks come from, by question type.
  const by = src.stagePicks(key);
  const total = [...by.values()].reduce((a, x) => a + x, 0);
  if (total >= MIN_SIDE) {
    const parts = [...by.entries()].filter(([st, k]) => k > 0 && STAGE[st]).sort((a, c) => c[1] - a[1]).map(([st, k]) => `${pctOf(k / total)} ${STAGE[st]}`);
    if (parts.length) rows.push({ label: "Where its picks come from", value: listVal(parts), tip: [...by.entries()].map(([st, k]) => `${st} ${k}`).join(", ") + ` of ${total}` });
  }
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
  const qTot = inputs.questions.reduce((a, q) => a + (q.picks[key] ?? 0), 0);
  if (qTot >= MIN_SIDE && inputs.questions.length >= 2) {
    const q = [...inputs.questions].sort((a, c) => (c.picks[key] ?? 0) - (a.picks[key] ?? 0) || a.id.localeCompare(c.id))[0];
    const k = q.picks[key] ?? 0;
    rows.push({ label: "Picks from its top question", value: pct(cell(k, qTot)), tip: `${k} of ${qTot}: "${q.text.replace(/\s+/g, " ").slice(0, 90)}"` });
  }
  // The arguments that travel with its picks.
  const lift = src.liftOf(key);
  if (lift.length) {
    rows.push({ label: "The argument it wins on", value: liftLine(lift[0]), tip: `${tipC(lift[0].wins)} picks; ${tipC(lift[0].others)} other picks` });
    const lo = lift[lift.length - 1];
    if (lift.length > 1) rows.push({ label: "The argument it loses on", value: liftLine(lo), tip: `${tipC(lo.wins)} picks; ${tipC(lo.others)} other picks` });
  }
  const sup = supplyLine(s, inputs, key);
  if (sup) rows.push(sup);
  return {
    kind: "brand",
    crumb: `${name} · open buying questions`,
    headline: `${name} is named in ${pct(b.mentioned)} of answers and takes ${pct(b.shareOfDecided)} of the picks - it turns ${pctOf(conv(b))} of its recommendations into picks.`,
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
 * sends buyers), the largest branch toward each side, and the blocker brand's
 * share of picks. Null when the run carries no condition groups. */
export function conditionCard(src: CardSources, openCellId?: string): AnswerCard | null {
  const s = src.summary;
  const brand = src.brand;
  const k = src.inputs.conditions;
  const a = src.inputs.away;
  const rows: Row[] = [];
  if (a && a.cells > 0) {
    // Largest share first (the groups arrive ranked by answers).
    for (const g of [...a.groups].sort((x, y) => y.cells - x.cells || x.label.localeCompare(y.label)))
      rows.push({ label: `Questions where "${g.label.slice(0, 60)}" routes away`, value: `${pctOf(g.cells / a.cells)}${g.routes[0] ? ` → ${g.routes[0].name}` : ""}`, tip: `${g.cells} of ${a.cells} questions with an away condition` });
  }
  if (k) {
    if (k.toward[0] && k.towardCells) rows.push({ label: `Largest branch toward ${brand}`, value: `${pctOf(k.toward[0].cells / k.towardCells)} - "${k.toward[0].label}"`, tip: `${k.toward[0].cells} of ${k.towardCells} questions where any condition routes to it` });
    if (k.away[0] && k.awayCells) rows.push({ label: "Largest branch away", value: `${pctOf(k.away[0].cells / k.awayCells)} - "${k.away[0].label}"`, tip: `${k.away[0].cells} of ${k.awayCells} questions where any condition routes away` });
    const seen = new Set<string>();
    for (const g of k.away) {
      const to = g.routes[0]?.name;
      if (!to || seen.has(to) || !k.awayCells) continue;
      seen.add(to);
      // The largest away branch is already its own row.
      if (g === k.away[0]) continue;
      rows.push({ label: `Largest branch toward ${to}`, value: `${pctOf(g.cells / k.awayCells)} - "${g.label}"`, tip: `${g.cells} of ${k.awayCells} questions where any condition routes away` });
    }
  }
  const g = a?.groups[0];
  if (g?.names) {
    const b = s.brands.find((x) => x.key === g.names!.key);
    rows.push(F(`${g.names.name}'s share of picks`, b ? b.shareOfDecided : cell(0, s.firmPickInCategory.k)));
  }
  if (!rows.length) return null;
  const top = g ?? (k?.away[0] ? { label: k.away[0].label, routes: k.away[0].routes } : null);
  const headline = top
    ? `"${top.label}" is the condition that most often routes the AI away from ${brand}${top.routes[0] ? ` - it sends buyers to ${top.routes[0].name}` : ""}.`
    : `The AI hands the buyer a rule, not a winner - these are the conditions that decide it.`;
  return {
    kind: "condition",
    crumb: "What routes buyers away",
    headline,
    rows,
    ...(openCellId ? { go: { label: "See every condition", target: "map" as const, cellId: openCellId } } : {}),
  };
}
