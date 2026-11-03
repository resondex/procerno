import { computeHeadline } from "./headline";
import { computeValue, type ValueView } from "./value";
import { computeDoubt, type DoubtViews, type WorryRow } from "./doubt";
import { computeSettled, type SettledViews } from "./settled";
import { computeReasons } from "./reasons";
import { buildResolver } from "./brand_resolve";
import { viewsOf } from "./views";
import { cell, poolOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import type { BrandSummaryView, VerdictFact } from "./brand_summary";

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
 *
 * bs6 (2026-11-03) adds the contrasts BETWEEN pools and the concentrations
 * INSIDE a pool that the cross-tracker findings were built from: prompted
 * head-to-heads vs the open choice, the share of picks that come from one
 * buyer room or one question, worries the AI agrees with and still says
 * proceed or stay, arguments that win but are not taught (and taught ones
 * that lose), whether the Value doubts stay in-house (the brand's own
 * cheaper rung) or go to rivals, and the case the AI makes when asked to
 * defend the brand vs what it concedes when asked about buyers' worries.
 * Where a detector reads a tension rather than a gap, its effect is a
 * stated share (agreed_yet_stay: answers that both agree and still say
 * proceed; advocacy_vs_objection: how far both sides sit above even;
 * concentrations: the share above an even split). The same inputs feed the
 * verdict (composeVerdict): fixed-order template sentences the brief opens
 * with, each only when its inputs clear the floors.
 *
 * The prompted head-to-head record is the summary's own entity rollup
 * (headToHead) - the same rows and rival resolution as computeHeadToHead,
 * without its condition grouping (an embedding call the summary never makes).
 */

export type InsightKind = "engine" | "room" | "rival" | "argument" | "doubt" | "funnel" | "question" | "value";
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
  /** Per buyer room: the target's share of decided in that room's open-choice
   * answers, its picks there and the room's in-category picks. */
  rooms: { room: string; decided: RateCell; picks: number; firm: number }[];
  value: ValueView | null;
  doubt: DoubtViews;
  /** Per open-choice question (cell - seed + paraphrases, named by the seed): picks by resolved active brand key. */
  questions: { id: string; text: string; answers: number; picks: Record<string, number> }[];
  settled: SettledViews;
  /** Criteria-taught incidence per code, most taught first; [] without a criteria pool. */
  taught: { code: string; rate: RateCell }[];
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
    return { room, decided: t ? t.shareOfDecided : cell(0, h.firmPickInCategory.k), picks: t ? t.chosen.k : 0, firm: h.firmPickInCategory.k };
  });
  // Per question (the CELL: a seed and its paraphrases pooled, keyed by the
  // intent like workbench.ts's Question dimension, named by its seed
  // wording): in-category picks by resolved brand, headline pool.
  const resolve = buildResolver(data.dictionary, data.judged);
  const qs = new Map<string, { id: string; text: string; answers: number; picks: Record<string, number> }>();
  for (const { code, intent } of poolOf(data, "headline", engines).rows) {
    const q = qs.get(intent.id) ?? { id: intent.id, text: intent.text, answers: 0, picks: {} };
    q.answers++;
    if (code.outcome === "pick" && code.top_pick) {
      const r = resolve(code.top_pick);
      if (r.status === "active") q.picks[r.key] = (q.picks[r.key] ?? 0) + 1;
    }
    qs.set(intent.id, q);
  }
  const reasons = computeReasons(data, engines);
  const criteria = reasons.types.find((t) => t.key === "criteria_taught");
  const taught =
    criteria && criteria.answers >= MIN_BASE
      ? reasons.codes
          .filter((c) => c.byType.criteria_taught && c.byType.criteria_taught.k > 0)
          .map((c) => ({ code: c.key, rate: c.byType.criteria_taught! }))
          .sort((a, b) => b.rate.k - a.rate.k || a.code.localeCompare(b.code))
      : [];
  return {
    rooms,
    value: computeValue(data, engines),
    doubt: computeDoubt(data, engines),
    questions: [...qs.values()],
    settled: computeSettled(data, engines),
    taught,
  };
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

type Summary = Omit<BrandSummaryView, "insights" | "verdict">;

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

/** The prompted head-to-head record pooled over the entity rivals, with the
 * hardest matchup (lowest win share) that clears the floor. */
function promptedRecord(s: Summary): { pooled: RateCell; won: number; lost: number; hardest: Summary["headToHead"][number] | null } | null {
  const won = s.headToHead.reduce((a, r) => a + r.won.k, 0);
  const lost = s.headToHead.reduce((a, r) => a + r.lost.k, 0);
  if (won + lost < MIN_BASE) return null;
  const ok = s.headToHead.filter((r) => r.winOfDecided.n >= MIN_BASE);
  const hardest = ok.length ? [...ok].sort((a, b) => rate(a.winOfDecided) - rate(b.winOfDecided))[0] : null;
  return { pooled: cell(won, won + lost), won, lost, hardest };
}

function promptedVsOpen(s: Summary): Insight | null {
  const rec = promptedRecord(s);
  const open = s.target.shareOfDecided;
  if (!rec || open.n < MIN_BASE) return null;
  const gap = rate(rec.pooled) - rate(open);
  if (Math.abs(gap) < 0.15) return null;
  if (!(gap > 0 ? apart(rec.pooled, open) : apart(open, rec.pooled))) return null;
  const hard = rec.hardest;
  const hardText = hard ? ` (${pct(hard.winOfDecided)} against ${hard.rival})` : "";
  return {
    key: "prompted_vs_open",
    kind: "rival",
    title: gap > 0 ? "Wins the prompted contests, loses the open choice" : "Wins the open choice, loses the prompted contests",
    body:
      gap > 0
        ? `Named against a rival you win ${pct(rec.pooled)} of head-to-heads${hardText}, but when the AI picks freely you win ${pct(open)} of decided answers.`
        : `When the AI picks freely you win ${pct(open)} of decided answers, but named against a rival you win only ${pct(rec.pooled)} of head-to-heads${hardText}.`,
    foot: `Head-to-heads: won ${rec.won}, lost ${rec.lost} - ${counts(rec.pooled)}${hard ? `; vs ${hard.rival} ${counts(hard.winOfDecided)}` : ""}. Open choice: ${counts(open)}.`,
    look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
    effect: Math.abs(gap),
  };
}

/** The room the target's open-choice picks come from most. */
function roomConcentration(s: Summary, inp: InsightInputs) {
  const total = s.target.chosen.k;
  if (total < MIN_BASE || inp.rooms.length < 2) return null;
  const top = [...inp.rooms].sort((a, b) => b.picks - a.picks || a.room.localeCompare(b.room))[0];
  const share = top.picks / total;
  if (share < 0.5) return null;
  const outside = cell(total - top.picks, Math.max(0, s.firmPickInCategory.k - top.firm));
  return { top, share, total, outside, rooms: inp.rooms.length };
}

function pickConcentrationRoom(s: Summary, inp: InsightInputs): Insight | null {
  const c = roomConcentration(s, inp);
  if (!c) return null;
  return {
    key: "pick_concentration_room",
    kind: "room",
    title: `Your picks come from ${c.top.room}`,
    body: `${pct(c.share)} of the times the AI picks ${s.brand} in an open choice come from one buyer room, ${c.top.room} - there you win ${pct(c.top.decided)} of decided answers, everywhere else ${pct(c.outside)}.`,
    foot: `${c.top.picks} of ${c.total} picks from ${c.top.room} (one of ${c.rooms} rooms). Inside: ${counts(c.top.decided)}. Outside: ${counts(c.outside)}.`,
    look: { pill: "buyers", label: "Buyers" },
    effect: c.share - 1 / c.rooms,
  };
}

const shorten = (t: string, n = 80) => {
  const x = t.replace(/\s+/g, " ").trim();
  return x.length <= n ? x : `${x.slice(0, n - 1).replace(/\s+\S*$/, "").replace(/[\s.,;:!?-]+$/, "")}...`;
};

/** The question (cell) a brand's picks concentrate in, for the target and the top rival. */
function questionConcentration(s: Summary, inp: InsightInputs, key: string) {
  const total = inp.questions.reduce((a, q) => a + (q.picks[key] ?? 0), 0);
  if (total < MIN_BASE || inp.questions.length < 2) return null;
  const top = [...inp.questions].sort((a, b) => (b.picks[key] ?? 0) - (a.picks[key] ?? 0) || a.id.localeCompare(b.id))[0];
  const k = top.picks[key] ?? 0;
  const share = k / total;
  return share >= 0.3 ? { top, k, total, share, n: inp.questions.length } : null;
}

function pickConcentrationQuestion(s: Summary, inp: InsightInputs): Insight | null {
  const rival = s.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
  const cands = [
    { who: s.brand, isTarget: true, c: questionConcentration(s, inp, s.target.key) },
    ...(rival ? [{ who: rival.name, isTarget: false, c: questionConcentration(s, inp, rival.key) }] : []),
  ].filter((x) => x.c !== null);
  if (cands.length === 0) return null;
  const best = cands.sort((a, b) => b.c!.share - a.c!.share)[0];
  const c = best.c!;
  const q = shorten(c.top.text);
  return {
    key: "pick_concentration_question",
    kind: "question",
    title: best.isTarget ? "One question carries your picks" : `One question carries ${best.who}'s picks`,
    body: `${pct(c.share)} of ${best.isTarget ? "your" : `${best.who}'s`} open-choice picks come from one question: "${q}"`,
    foot: `${c.k} of ${c.total} picks of ${best.who} from this question (one of ${c.n} open-choice questions, ${c.top.answers} answers, a seed and its paraphrases pooled).`,
    look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
    effect: c.share - 1 / c.n,
  };
}

function agreedYetStay(inp: InsightInputs): Insight | null {
  type C = { who: "buyer" | "customer"; confirmed: RateCell; given: RateCell; verb: string };
  const cands: C[] = [];
  const o = inp.doubt.objections;
  const k = inp.doubt.keepOrLeave;
  if (o) cands.push({ who: "buyer", confirmed: o.premise.confirms, given: o.matrix.confirms.proceed, verb: "go ahead" });
  if (k) cands.push({ who: "customer", confirmed: k.premise.confirms, given: k.matrix.confirms.keep, verb: "stay" });
  const ok = cands.filter((c) => c.confirmed.n >= MIN_BASE && c.given.n >= MIN_BASE && rate(c.confirmed) >= 0.5 && rate(c.given) >= 0.3);
  if (ok.length === 0) return null;
  const best = ok.sort((a, b) => rate(b.confirmed) * rate(b.given) - rate(a.confirmed) * rate(a.given))[0];
  return {
    key: "agreed_yet_stay",
    kind: "doubt",
    title: best.who === "buyer" ? "Agrees with the worry, still says go ahead" : "Agrees with the worry, still says stay",
    body: `When a ${best.who} raises a worry, the AI agrees it is warranted ${pct(best.confirmed)} of the time it takes a side - and in ${pct(best.given)} of those answers still tells them to ${best.verb}.`,
    foot: `Agrees: ${counts(best.confirmed)}. Of those, ${best.verb}: ${counts(best.given)}.`,
    look: { pill: "stations", station: best.who === "buyer" ? "doubts" : "customer_base", label: best.who === "buyer" ? "Stations - Doubts" : "Stations - Customers" },
    effect: rate(best.confirmed) * rate(best.given),
  };
}

function taughtVsWinning(s: Summary, inp: InsightInputs): Insight | null {
  if (inp.taught.length === 0 || s.reasonLift.length === 0) return null;
  const top5 = inp.taught.slice(0, 5);
  const taughtSet = new Set(top5.map((t) => t.code));
  const best = s.reasonLift[0];
  const untaught = best.lift > 0 && !taughtSet.has(best.code) && apart(best.wins, best.others) ? best : null;
  const losing = top5
    .map((t) => s.reasonLift.find((l) => l.code === t.code))
    .filter((l): l is NonNullable<typeof l> => !!l && l.lift < 0 && apart(l.others, l.wins))
    .sort((a, b) => a.lift - b.lift)[0] ?? null;
  if (!untaught && !losing) return null;
  const taughtOf = (code: string) => inp.taught.find((t) => t.code === code)?.rate;
  const parts: string[] = [];
  const foot: string[] = [];
  if (untaught) {
    parts.push(`${untaught.code} travels with your wins (+${pts(untaught.lift)}) but is not among the five criteria the AI teaches buyers to weigh`);
    const tr = taughtOf(untaught.code);
    foot.push(`${untaught.code}: ${pct(untaught.wins)} of wins vs ${pct(untaught.others)} of rival picks; taught in ${tr ? counts(tr) : "no"} criteria answers.`);
  }
  if (losing) {
    parts.push(`${untaught ? "it" : "the AI"} teaches buyers to weigh ${losing.code}, which shows up more when a rival is picked (-${pts(losing.lift)})`);
    foot.push(`${losing.code}: ${pct(losing.wins)} of wins vs ${pct(losing.others)} of rival picks; taught in ${counts(taughtOf(losing.code)!)}.`);
  }
  const body = parts.join("; ");
  const effect = Math.max(untaught ? Math.abs(untaught.lift) : 0, losing ? Math.abs(losing.lift) : 0);
  return {
    key: "taught_vs_winning",
    kind: "argument",
    title: untaught ? `${untaught.code} wins but is not taught` : `The AI teaches ${losing!.code}, which favors rivals`,
    body: `${body.charAt(0).toUpperCase()}${body.slice(1)}.`,
    foot: `${foot.join(" ")} Top five taught: ${top5.map((t) => t.code).join(", ")}.`,
    look: { pill: "why", label: "Why" },
    effect,
  };
}

function valueInHouse(inp: InsightInputs, brand: string): Insight | null {
  const v = inp.value;
  if (!v || v.ownRung.n < MIN_BASE) return null;
  const own = rate(v.ownRung);
  const riv = rate(v.recommendsInstead);
  if (own < 0.3 && riv < 0.3) return null;
  const inHouse = own >= riv;
  const top = v.instead.find((i) => i.own === inHouse);
  const topText = top ? ` - most often ${top.name}` : "";
  return {
    key: "value_in_house",
    kind: "value",
    title: inHouse ? "The value doubts stay in-house" : "The value doubts go to rivals",
    body: inHouse
      ? `When the AI doubts ${brand} is worth the price, ${pct(own)} of those answers point to its own cheaper option${topText}; ${pct(riv)} point to a rival.`
      : `When the AI doubts ${brand} is worth the price, ${pct(riv)} of those answers point to a rival${topText}; ${pct(own)} point to its own cheaper option.`,
    foot: `Of answers saying no or it depends: own option ${counts(v.ownRung)}; a rival ${counts(v.recommendsInstead)}.${top ? ` ${top.name}: ${top.n}.` : ""}`,
    look: { pill: "stations", station: "value", label: "Stations - Value" },
    effect: Math.abs(own - riv),
  };
}

function advocacyVsObjection(inp: InsightInputs): Insight | null {
  const adv = inp.settled.advocacy;
  const o = inp.doubt.objections;
  if (!adv || !o) return null;
  const strengthens = adv.verdicts.strengthens;
  const strong = adv.caseStrength.strong;
  const defend = rate(strengthens) >= rate(strong) ? strengthens : strong;
  const confirms = o.premise.confirms;
  if (defend.n < MIN_BASE || confirms.n < MIN_BASE || rate(defend) < 0.5 || rate(confirms) < 0.5) return null;
  return {
    key: "advocacy_vs_objection",
    kind: "doubt",
    title: "Defends you when asked, concedes when asked neutrally",
    body: `Asked to defend the brand, the AI strengthens the case ${pct(defend)} of the time; asked about buyers' worries, it agrees they are warranted ${pct(confirms)} of the time.`,
    foot: `Advocacy: ${counts(defend)}. Buyers' worries agreed: ${counts(confirms)}.`,
    look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    effect: Math.min(rate(defend), rate(confirms)) - 0.5,
  };
}

/**
 * The verdict the brief opens with: template sentences in fixed order
 * (standing, prompted vs open, concentration, doubts, value, settled), each
 * only when its inputs clear the floors. Percentages in `text`, counts in `foot`.
 */
export function composeVerdict(s: Summary, inp: InsightInputs): VerdictFact[] {
  const out: VerdictFact[] = [];
  const decidedOk = s.firmPickInCategory.k >= MIN_BASE;

  // 1. Standing.
  if (s.answers >= MIN_BASE) {
    const rival = s.brands.find((b) => b.role !== "target" && b.chosen.k > 0);
    let text = `${s.brand} is named in ${pct(s.target.mentioned)} of open-choice answers and picked in ${pct(s.target.chosen)}`;
    let foot = `Named ${counts(s.target.mentioned)}; picked ${counts(s.target.chosen)}`;
    if (decidedOk) {
      text += `, which is ${pct(s.target.shareOfDecided)} of the picks that land on a brand in the category`;
      foot += `; ${s.target.chosen.k} of ${s.firmPickInCategory.k} decided picks`;
      if (rival) {
        text += `, ${rate(rival.shareOfDecided) > rate(s.target.shareOfDecided) ? "behind" : "ahead of"} ${rival.name} at ${pct(rival.shareOfDecided)}`;
        foot += `; ${rival.name} ${rival.chosen.k}`;
      }
    }
    out.push({ key: "standing", text: `${text}.`, foot: `${foot}.`, look: { pill: "stations", station: "consideration", label: "Stations - Consideration" } });
  }

  // 2. Prompted vs open.
  const rec = promptedRecord(s);
  if (rec && decidedOk) {
    const hard = rec.hardest ? ` (${pct(rec.hardest.winOfDecided)} against ${rec.hardest.rival})` : "";
    const gap = rate(rec.pooled) - rate(s.target.shareOfDecided);
    const openText = `${pct(s.target.shareOfDecided)} of the open choice`;
    const text =
      gap >= 0.1
        ? `It wins ${pct(rec.pooled)} of prompted head-to-heads${hard} but only ${openText}.`
        : gap <= -0.1
          ? `It takes ${openText} but wins only ${pct(rec.pooled)} of prompted head-to-heads${hard}.`
          : `It wins ${pct(rec.pooled)} of prompted head-to-heads${hard} and ${openText}.`;
    out.push({
      key: "prompted_vs_open",
      text,
      foot: `Head-to-heads won ${rec.won}, lost ${rec.lost}${rec.hardest ? `; vs ${rec.hardest.rival} ${rec.hardest.won.k}-${rec.hardest.lost.k}` : ""}. Open choice ${s.target.chosen.k} of ${s.firmPickInCategory.k} decided picks.`,
      look: { pill: "stations", station: "comparison", label: "Stations - Comparison" },
    });
  }

  // 3. Concentration: one buyer room, else one question.
  const room = roomConcentration(s, inp);
  if (room) {
    out.push({
      key: "concentration",
      text: `${pct(room.share)} of its picks come from one buyer room, ${room.top.room}.`,
      foot: `${room.top.picks} of ${room.total} open-choice picks; ${room.rooms} rooms.`,
      look: { pill: "buyers", label: "Buyers" },
    });
  } else {
    const q = questionConcentration(s, inp, s.target.key);
    if (q)
      out.push({
        key: "concentration",
        text: `${pct(q.share)} of its picks come from one question: "${shorten(q.top.text)}"`,
        foot: `${q.k} of ${q.total} open-choice picks; ${q.n} questions.`,
        look: { pill: "stations", station: "consideration", label: "Stations - Consideration" },
      });
  }

  // 4. Doubts.
  const b = s.buyersDoubt && s.buyersDoubt.answers >= MIN_BASE && s.buyersDoubt.agree.n >= MIN_BASE ? s.buyersDoubt : null;
  const c = s.customersDoubt && s.customersDoubt.answers >= MIN_BASE ? s.customersDoubt : null;
  if (b || c) {
    const text = b
      ? `Buyers' worries are confirmed in ${pct(b.agree)} of answers and still told to go ahead in ${pct(b.proceed)}${c ? `; customers are told to stay in ${pct(c.keep)}` : ""}.`
      : `Customers voicing a worry are told to stay in ${pct(c!.keep)} and to leave in ${pct(c!.leave)}.`;
    const foot = [b && `Buyers: agrees ${counts(b.agree)}; go ahead ${counts(b.proceed)}.`, c && `Customers: stay ${counts(c.keep)}; leave ${counts(c.leave)}.`]
      .filter(Boolean)
      .join(" ");
    out.push({ key: "doubts", text, foot, look: { pill: "stations", station: b ? "doubts" : "customer_base", label: b ? "Stations - Doubts" : "Stations - Customers" } });
  }

  // 5. Value.
  const v = inp.value;
  if (v && v.answers >= MIN_BASE) {
    const subject = v.lines.length === 1 ? v.lines[0].label : `${s.brand}'s lines`;
    const verb = v.lines.length === 1 ? "is" : "are";
    let tail = "";
    if (v.ownRung.n >= MIN_BASE) {
      const own = rate(v.ownRung);
      const riv = rate(v.recommendsInstead);
      const topRival = v.instead.find((i) => !i.own);
      if (own >= 0.5 && own >= riv) tail = "; most of the doubts point to its own cheaper option";
      else if (riv >= 0.5 && riv > own) tail = `; most of the doubts point to a rival${topRival ? `, led by ${topRival.name}` : ""}`;
      else if (own >= 0.3 || riv >= 0.3) tail = `; ${pct(own)} of the doubts point to its own cheaper option and ${pct(riv)} to a rival`;
    }
    out.push({
      key: "value",
      text: `${subject} ${verb} judged worth it in ${pct(v.worth.yes)} of answers${tail}.`,
      foot: `Worth it ${counts(v.worth.yes)}.${v.ownRung.n > 0 ? ` Of the no and it-depends answers: own option ${v.ownRung.k}, a rival ${v.recommendsInstead.k}, of ${v.ownRung.n}.` : ""}`,
      look: { pill: "stations", station: "value", label: "Stations - Value" },
    });
  }

  // 6. Settled customers.
  const adv = inp.settled.advocacy && inp.settled.advocacy.answers >= MIN_BASE ? inp.settled.advocacy : null;
  const bc = inp.settled.businessCase && inp.settled.businessCase.answers >= MIN_BASE ? inp.settled.businessCase : null;
  const obj = inp.doubt.objections && inp.doubt.objections.premise.confirms.n >= MIN_BASE ? inp.doubt.objections : null;
  if (adv) {
    out.push({
      key: "settled",
      text: obj
        ? `Asked to defend it, the AI strengthens the case in ${pct(adv.verdicts.strengthens)}; asked neutrally about buyers' worries, it agrees with them in ${pct(obj.premise.confirms)}.`
        : `Asked to defend it, the AI strengthens the case in ${pct(adv.verdicts.strengthens)}.`,
      foot: `Advocacy strengthens ${counts(adv.verdicts.strengthens)}.${obj ? ` Buyers' worries agreed ${counts(obj.premise.confirms)}.` : ""}`,
      look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    });
  } else if (bc) {
    out.push({
      key: "settled",
      text: `Asked for a business case, the AI makes a strong one in ${pct(bc.caseStrength.strong)}.`,
      foot: `Strong case ${counts(bc.caseStrength.strong)}.`,
      look: { pill: "stations", station: "customer_base", label: "Stations - Customers" },
    });
  }
  return out;
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
    promptedVsOpen(s),
    pickConcentrationRoom(s, inp),
    pickConcentrationQuestion(s, inp),
    agreedYetStay(inp),
    taughtVsWinning(s, inp),
    valueInHouse(inp, s.brand),
    advocacyVsObjection(inp),
  ].filter((x): x is Insight => x !== null && x.effect > 0);
  return found.sort((a, b) => b.effect - a.effect || a.key.localeCompare(b.key)).slice(0, MAX_INSIGHTS);
}
