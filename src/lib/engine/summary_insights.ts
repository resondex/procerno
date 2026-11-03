import { computeHeadline } from "./headline";
import { computeValue, type ValueView } from "./value";
import { computeDoubt, type DoubtViews, type WorryRow } from "./doubt";
import { viewsOf } from "./views";
import { cell, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import type { BrandSummaryView } from "./brand_summary";

/**
 * Insight detection for the summary documents (2026-11-03): mechanical
 * detectors over the brand summary and the sibling views (per-room headline,
 * value, doubt), ranked by effect size. Every detector emits at most one
 * insight; every insight names its effect in points of 1, a one-sentence
 * claim with percentages only (counts live in `foot`, the tooltip) and the
 * place in the dashboard that carries the full table.
 *
 * A spread is reported only when both ends clear the floor and their 95%
 * ranges do not overlap - a gap inside the noise is never a finding. The
 * request's engine set applies to every input (a one-engine set has no
 * engine spread, so those detectors stay silent). The room filter never
 * applies: the summary is the all-buyers read; the room detectors compare
 * rooms against each other.
 */

export type InsightKind = "engine" | "room" | "rival" | "argument" | "doubt" | "funnel";
export type InsightPill = "stations" | "why" | "rivals" | "buyers" | "table";

export interface Insight {
  key: string;
  kind: InsightKind;
  title: string;
  /** One sentence; percentages only, never raw counts. */
  body: string;
  /** Evidence numbers, counts included - the tooltip. */
  foot: string;
  look: { pill: InsightPill; station?: string; label: string };
  /** Points of 1: the gap between the two ends (for the funnel, the drop). */
  effect: number;
}

/** Both ends of a spread need this many decided (or judged) answers -
 * the same floor brand_summary's argument lift uses. */
const MIN_BASE = 20;
const MAX_INSIGHTS = 8;

/** The sibling-view inputs the detectors read, all under the summary's request. */
export interface InsightInputs {
  /** Per buyer room: the target's share of decided in that room's open-choice answers. */
  rooms: { room: string; decided: RateCell }[];
  value: ValueView | null;
  doubt: DoubtViews;
}

/** Computed from the summary's own load (one data read, no extra fetches):
 * the same pure computes the headline, value and doubt routes cache, with
 * the summary's engine set. */
export function insightInputs(data: ViewData, request: ViewRequest = {}): InsightInputs {
  const engines = request.engines ? { engines: request.engines } : {};
  const roomSet = new Set<string>();
  for (const it of data.intents)
    if (it.situation && viewsOf(it.stage, it.angle).includes("headline")) roomSet.add(it.situation);
  const rooms = [...roomSet].sort().map((room) => {
    const h = computeHeadline(data, { room, ...engines });
    const t = h.brands.find((b) => b.role === "target");
    return { room, decided: t ? t.shareOfDecided : cell(0, h.firmPickInCategory.k) };
  });
  return { rooms, value: computeValue(data, engines), doubt: computeDoubt(data, engines) };
}

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pct = (c: RateCell | number) => {
  const x = typeof c === "number" ? c : rate(c);
  return x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`;
};
const pts = (x: number) => `${Math.round(Math.abs(x) * 100)} points`;
const counts = (c: RateCell) => `${c.k} of ${c.n} (95% range ${Math.round(c.low * 100)}-${Math.round(c.high * 100)}%)`;
const apart = (hi: RateCell, lo: RateCell) => hi.low > lo.high;

/** The highest and lowest of the items whose base clears the floor, when
 * their ranges do not overlap. */
function ends<T>(items: T[], cellOf: (t: T) => RateCell): { hi: T; lo: T } | null {
  const ok = items.filter((t) => cellOf(t).n >= MIN_BASE);
  if (ok.length < 2) return null;
  const sorted = [...ok].sort((a, b) => rate(cellOf(b)) - rate(cellOf(a)));
  const hi = sorted[0];
  const lo = sorted[sorted.length - 1];
  return apart(cellOf(hi), cellOf(lo)) ? { hi, lo } : null;
}

type Summary = Omit<BrandSummaryView, "insights">;

function engineSpread(s: Summary): Insight | null {
  const e = ends(s.byEngine, (x) => x.decided);
  if (!e) return null;
  const gap = rate(e.hi.decided) - rate(e.lo.decided);
  return {
    key: "engine_spread",
    kind: "engine",
    title: `${e.hi.label} picks you most, ${e.lo.label} least`,
    body: `When a brand in your category is picked, you win ${pct(e.hi.decided)} on ${e.hi.label} but ${pct(e.lo.decided)} on ${e.lo.label}.`,
    foot: `${e.hi.label}: ${counts(e.hi.decided)}. ${e.lo.label}: ${counts(e.lo.decided)}. Engines with fewer than ${MIN_BASE} decided answers are left out.`,
    look: { pill: "table", label: "Metrics - by engine" },
    effect: gap,
  };
}

/** Pools the by-engine slices on a key: target picks over in-category picks. */
function pooled(s: Summary, keyOf: (e: Summary["byEngine"][number]) => string): { key: string; decided: RateCell; engines: number }[] {
  const m = new Map<string, { k: number; n: number; engines: number }>();
  for (const e of s.byEngine) {
    const k = keyOf(e);
    const t = m.get(k) ?? { k: 0, n: 0, engines: 0 };
    t.k += e.decided.k;
    t.n += e.decided.n;
    t.engines++;
    m.set(k, t);
  }
  return [...m.entries()].map(([key, t]) => ({ key, decided: cell(t.k, t.n), engines: t.engines }));
}

function modeGap(s: Summary): Insight | null {
  const modes = pooled(s, (e) => e.mode);
  const search = modes.find((m) => m.key === "search");
  const instinct = modes.find((m) => m.key === "instinct");
  if (!search || !instinct || search.decided.n < MIN_BASE || instinct.decided.n < MIN_BASE) return null;
  const [hi, lo] = rate(search.decided) >= rate(instinct.decided) ? [search, instinct] : [instinct, search];
  if (!apart(hi.decided, lo.decided)) return null;
  const searchWins = hi === search;
  return {
    key: "engine_mode",
    kind: "engine",
    title: searchWins ? "Search helps you" : "Search hurts you",
    body: `When the assistants search the web you win ${pct(search.decided)} of decided answers; answering from memory, ${pct(instinct.decided)}.`,
    foot: `Search (${search.engines} engines): ${counts(search.decided)}. Instinct (${instinct.engines} engines): ${counts(instinct.decided)}.`,
    look: { pill: "table", label: "Metrics - by mode" },
    effect: rate(hi.decided) - rate(lo.decided),
  };
}

function vendorGap(s: Summary): Insight | null {
  const e = ends(pooled(s, (x) => x.vendor), (x) => x.decided);
  if (!e) return null;
  return {
    key: "engine_vendor",
    kind: "engine",
    title: `${e.hi.key} favors you most, ${e.lo.key} least`,
    body: `Across each vendor's assistants, you win ${pct(e.hi.decided)} of decided answers on ${e.hi.key} and ${pct(e.lo.decided)} on ${e.lo.key}.`,
    foot: `${e.hi.key} (${e.hi.engines} engines): ${counts(e.hi.decided)}. ${e.lo.key} (${e.lo.engines} engines): ${counts(e.lo.decided)}.`,
    look: { pill: "table", label: "Metrics - by vendor" },
    effect: rate(e.hi.decided) - rate(e.lo.decided),
  };
}

function roomWin(inp: InsightInputs): Insight | null {
  const e = ends(inp.rooms, (r) => r.decided);
  if (!e) return null;
  return {
    key: "room_win",
    kind: "room",
    title: `Strongest with ${e.hi.room}, weakest with ${e.lo.room}`,
    body: `When a brand in your category is picked, you win ${pct(e.hi.decided)} for ${e.hi.room} but ${pct(e.lo.decided)} for ${e.lo.room}.`,
    foot: `${e.hi.room}: ${counts(e.hi.decided)}. ${e.lo.room}: ${counts(e.lo.decided)}. Open-choice questions asked for each buyer; rooms under ${MIN_BASE} decided answers left out.`,
    look: { pill: "buyers", label: "Buyers" },
    effect: rate(e.hi.decided) - rate(e.lo.decided),
  };
}

function roomValue(inp: InsightInputs, brand: string): Insight | null {
  const rows = (inp.value?.rooms ?? []).filter((r) => r.key !== "");
  const e = ends(rows, (r) => r.worth.yes);
  if (!e) return null;
  return {
    key: "room_value",
    kind: "room",
    title: `Worth it most for ${e.hi.label}, least for ${e.lo.label}`,
    body: `Asked whether ${brand} is worth paying more for, the AI says yes ${pct(e.hi.worth.yes)} of the time for ${e.hi.label} and ${pct(e.lo.worth.yes)} for ${e.lo.label}.`,
    foot: `${e.hi.label}: ${counts(e.hi.worth.yes)}. ${e.lo.label}: ${counts(e.lo.worth.yes)}.`,
    look: { pill: "stations", station: "value", label: "Stations - Value" },
    effect: rate(e.hi.worth.yes) - rate(e.lo.worth.yes),
  };
}

function rivalOpen(s: Summary): Insight | null {
  const top = s.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
  if (!top || s.firmPickInCategory.k < MIN_BASE) return null;
  const [hi, lo] = rate(top.shareOfDecided) > rate(s.target.shareOfDecided) ? [top.shareOfDecided, s.target.shareOfDecided] : [s.target.shareOfDecided, top.shareOfDecided];
  if (!apart(hi, lo)) return null;
  return {
    key: "rival_open",
    kind: "rival",
    title: rate(top.shareOfDecided) > rate(s.target.shareOfDecided) ? `${top.name} takes the room` : `You lead ${top.name}`,
    body: `${top.name} wins ${pct(top.shareOfDecided)} when a brand in your category is picked - you win ${pct(s.target.shareOfDecided)}.`,
    foot: `${top.chosen.k} picks to your ${s.target.chosen.k}, of ${s.firmPickInCategory.k} decided open-choice answers.`,
    look: { pill: "rivals", label: "Rivals" },
    effect: Math.abs(rate(top.shareOfDecided) - rate(s.target.shareOfDecided)),
  };
}

function rivalHeadToHead(s: Summary): Insight | null {
  const ok = s.headToHead.filter((r) => r.winOfDecided.n >= MIN_BASE);
  if (ok.length === 0) return null;
  const closest = [...ok].sort((a, b) => Math.abs(rate(a.winOfDecided) - 0.5) - Math.abs(rate(b.winOfDecided) - 0.5))[0];
  const worst = [...ok].sort((a, b) => rate(a.winOfDecided) - rate(b.winOfDecided))[0];
  const foot = (r: typeof closest) =>
    `vs ${r.rival}: won ${r.won.k}, lost ${r.lost.k} - 95% range ${Math.round(r.winOfDecided.low * 100)}-${Math.round(r.winOfDecided.high * 100)}%`;
  if (closest.key === worst.key) {
    return {
      key: "rival_h2h",
      kind: "rival",
      title: `Head-to-head with ${worst.rival}`,
      body: `Asked to choose between you and ${worst.rival}, the AI picks you ${pct(worst.winOfDecided)} of the time one of you is picked.`,
      foot: `${foot(worst)}. Matchups under ${MIN_BASE} decided answers left out.`,
      look: { pill: "rivals", label: "Rivals - head-to-head" },
      effect: Math.abs(rate(worst.winOfDecided) - 0.5),
    };
  }
  return {
    key: "rival_h2h",
    kind: "rival",
    title: `Hardest head-to-head: ${worst.rival}`,
    body: `Named against ${worst.rival} you win ${pct(worst.winOfDecided)} of decided answers; your closest contest is ${closest.rival}, at ${pct(closest.winOfDecided)}.`,
    foot: `${foot(worst)}. ${foot(closest)}. Matchups under ${MIN_BASE} decided answers left out.`,
    look: { pill: "rivals", label: "Rivals - head-to-head" },
    effect: Math.abs(rate(closest.winOfDecided) - rate(worst.winOfDecided)),
  };
}

function argument(s: Summary): Insight | null {
  const best = s.reasonLift[0];
  const worst = s.reasonLift.length > 1 ? s.reasonLift[s.reasonLift.length - 1] : undefined;
  if (!best || !worst) return null;
  return {
    key: "argument",
    kind: "argument",
    title: best.code,
    body: `${best.code} travels with your wins (${best.lift >= 0 ? "+" : "-"}${pts(best.lift)} vs answers that pick a rival); the conversations you lose argue ${worst.code} (${worst.lift >= 0 ? "+" : "-"}${pts(worst.lift)}).`,
    foot: `${best.code}: ${pct(best.wins)} of ${best.wins.n} wins vs ${pct(best.others)} of ${best.others.n} rival picks. ${worst.code}: ${pct(worst.wins)} vs ${pct(worst.others)}.`,
    look: { pill: "why", label: "Why" },
    effect: best.lift - worst.lift,
  };
}

function doubtRollup(s: Summary): Insight | null {
  const b = s.buyersDoubt;
  const c = s.customersDoubt;
  if (!b && !c) return null;
  const raw = [b && `buyers told to go ahead ${pct(b.proceed)}`, c && `customers told to stay ${pct(c.keep)}`].filter(Boolean).join(" - ");
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  const body = [
    b && `When a buyer voices a worry about ${s.brand}, the AI agrees it is warranted ${pct(b.agree)} of the time it takes a side.`,
    c && `Customers weighing a worry are told to leave ${pct(c.leave)}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const foot = [
    b && `Buyers: go ahead ${counts(b.proceed)}, avoid ${b.avoid.k}, agrees ${counts(b.agree)}.`,
    c && `Customers: stay ${counts(c.keep)}, leave ${c.leave.k}, agrees ${counts(c.agree)}.`,
    "Reported apart from the open-choice numbers.",
  ]
    .filter(Boolean)
    .join(" ");
  const effect = Math.max(
    b ? Math.abs(rate(b.proceed) - rate(b.avoid)) : 0,
    c ? Math.abs(rate(c.keep) - rate(c.leave)) : 0
  );
  return {
    key: "doubt_rollup",
    kind: "doubt",
    title,
    body,
    foot,
    look: { pill: "stations", station: b ? "doubts" : "customer_base", label: b ? "Stations - Doubts" : "Stations - Customers" },
    effect,
  };
}

function doubtWorry(inp: InsightInputs): Insight | null {
  type Cand = { row: WorryRow<string>; pool: RateCell; who: "buyer" | "customer" };
  const cands: Cand[] = [];
  const o = inp.doubt.objections;
  const k = inp.doubt.keepOrLeave;
  if (o) for (const row of o.rows) cands.push({ row, pool: o.premise.confirms, who: "buyer" });
  if (k) for (const row of k.rows) cands.push({ row, pool: k.premise.confirms, who: "customer" });
  const ok = cands.filter((c) => c.row.premise.confirms.n >= MIN_BASE);
  if (ok.length < 2) return null;
  const top = [...ok].sort((a, b) => rate(b.row.premise.confirms) - rate(a.row.premise.confirms))[0];
  const gap = rate(top.row.premise.confirms) - rate(top.pool);
  // The pool contains the worry, so the test is the worry's range clearing the pool's rate.
  if (top.row.premise.confirms.low <= rate(top.pool)) return null;
  return {
    key: "doubt_worry",
    kind: "doubt",
    title: `The worry it backs most: ${top.row.concern}`,
    body: `When a ${top.who} raises "${top.row.concern}", the AI agrees it is warranted ${pct(top.row.premise.confirms)} of the time it takes a side - against ${pct(top.pool)} across all ${top.who}s' worries.`,
    foot: `${top.row.concern}: ${counts(top.row.premise.confirms)}. All ${top.who} worries: ${counts(top.pool)}. Worries under ${MIN_BASE} judged answers left out.`,
    look: { pill: "stations", station: top.who === "buyer" ? "doubts" : "customer_base", label: top.who === "buyer" ? "Stations - Doubts" : "Stations - Customers" },
    effect: gap,
  };
}

function funnelDrop(s: Summary): Insight | null {
  if (s.answers < MIN_BASE) return null;
  const named = rate(s.target.mentioned);
  const rec = rate(s.target.recommended);
  const picked = rate(s.target.chosen);
  const steps = [
    { from: "named", to: "recommended", a: named, b: rec },
    { from: "recommended", to: "picked", a: rec, b: picked },
  ];
  const worst = steps.sort((x, y) => y.a - y.b - (x.a - x.b))[0];
  const drop = worst.a - worst.b;
  if (drop <= 0) return null;
  return {
    key: "funnel",
    kind: "funnel",
    title: `The drop is from ${worst.from} to ${worst.to}`,
    body: `You are ${worst.from} in ${pct(worst.a)} of open-choice answers but ${worst.to} in ${pct(worst.b)} - the biggest step down in the funnel.`,
    foot: `Named ${counts(s.target.mentioned)}; recommended ${counts(s.target.recommended)}; picked ${counts(s.target.chosen)}.`,
    look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
    effect: drop,
  };
}

/** Every detector once, ranked by effect, capped. */
export function detectInsights(s: Summary, inp: InsightInputs): Insight[] {
  const found = [
    engineSpread(s),
    modeGap(s),
    vendorGap(s),
    roomWin(inp),
    roomValue(inp, s.brand),
    rivalOpen(s),
    rivalHeadToHead(s),
    argument(s),
    doubtRollup(s),
    doubtWorry(inp),
    funnelDrop(s),
  ].filter((x): x is Insight => x !== null && x.effect > 0);
  return found.sort((a, b) => b.effect - a.effect || a.key.localeCompare(b.key)).slice(0, MAX_INSIGHTS);
}
