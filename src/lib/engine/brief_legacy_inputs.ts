/**
 * The Brief's legacy condition inputs (moved out of summary_insights.ts insightInputs, 2026-11-17, fact layer step 5):
 * the run-wide rollup of the decision rules - the largest toward / away condition groups and themes across every
 * question type pooled, with the questions each appears in. Read by the Brief only (its conditions paragraph, the
 * condition answer card, the specific-situation lines). The Overview's findings no longer read this (ruling 10: they
 * read one card's own rows); this module is the Brief's until part 2 of step 5 moves the Brief onto statements.
 *
 * Counted here, outside the fact layer - listed as such. No model call (the shared rules and themes are the run's
 * saved grouping).
 */
import { containsSeq, famTokens } from "./brand_family";
import { isDefaultCondition } from "./condition_groups";
import type { RuleGroup } from "./rules_explorer";
import { sharedRunThemes, themeRollup, type ThemeRollup } from "./run_themes";
import type { ViewData, ViewRequest } from "./view_data";
import { buildResolver } from "./brand_resolve";
import { cell, poolOf, type RateCell } from "./view_data";

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
import type { InsightInputs } from "./summary_insights";

const AWAY_TOP = 3;

/** The largest groups on one side of the rules, for the brief's conditions paragraph. */
function sideTop(groups: RuleGroup[], side: "you" | "away") {
  return groups
    .filter((g) => g.side === side)
    .sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map((g) => ({ label: g.label, rules: g.rules, cells: g.cells, wall: g.wall, routes: g.routes }));
}

/** The run-wide condition rollup the Brief reads (inputs.conditions, and inputs.away in its old shape). */
export async function briefLegacyConditions(data: ViewData, request: ViewRequest = {}): Promise<Pick<InsightInputs, "conditions" | "away">> {
  const engines = request.engines ? { engines: request.engines } : {};
  const resolve = buildResolver(data.dictionary, data.judged);
  const targetKey = resolve(data.project.brand).key;
  const forms: { seq: string[]; key: string; name: string }[] = [];
  for (const e of data.dictionary) {
    if (e.status !== "active" || e.id === targetKey) continue;
    for (const f of [e.canonical, ...e.aliases]) {
      const seq = famTokens(f);
      if (seq.length) forms.push({ seq, key: e.id, name: e.display_name ?? e.canonical });
    }
  }
  const namesIn = (label: string) => {
    const hay = famTokens(label);
    let best: (typeof forms)[number] | null = null;
    for (const f of forms) if (containsSeq(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
    return best ? { key: best.key, name: best.name } : null;
  };
  const rt = await sharedRunThemes(data, engines);
  const rules = rt.rules.rules;
  const awayThemed = !!rt.away;
  const towardThemed = !!rt.toward;
  const awayRoll = themeRollup(rt.awayPool, rt.away, rt.rules, rt.sitOf, "away", data.project.brand);
  const towardRoll = themeRollup(rt.towardPool, rt.toward, rt.rules, rt.sitOf, "toward", data.project.brand);
  const awayGroups = rules.groups
    .filter((g) => g.side === "away")
    .sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label))
    .slice(0, AWAY_TOP)
    .map((g) => ({ label: g.label, rules: g.rules, answers: g.answers, cells: g.cells, wall: g.wall, routes: g.routes, names: namesIn(g.label) }));
  const answerBase = (pool: RuleGroup[]) => {
    const base = new Set<string>();
    for (const g of pool) for (const ids of rt.rules.cellAnswers.get(g.id)?.values() ?? []) for (const id of ids) base.add(id);
    return base.size;
  };
  const awayBase = awayThemed ? answerBase(rt.awayPool) : 0;
  const towardBase = towardThemed ? answerBase(rt.towardPool) : 0;
  let awayLead: NonNullable<InsightInputs["away"]>["lead"];
  if (awayThemed && awayRoll.length > 0) {
    const t = awayRoll[0];
    awayLead = { label: t.label, answers: t.answers, base: awayBase, wall: t.wall, wording: t.members[0] ?? t.label, routes: t.routes, top: awayRoll.slice(0, AWAY_TOP).map((x) => ({ label: x.label, answers: x.answers })) };
  }
  const themeTop = (xs: ThemeRollup[]) => xs.slice(0, 6).map((t) => ({ label: t.label, rules: t.rules, cells: t.cells, wall: t.wall, routes: t.routes, answers: t.answers, wording: t.members[0] ?? t.label }));
  if (rules.answers === 0) return { conditions: null, away: null };
  return {
    away: { groups: awayGroups, cells: rules.cellsBySide.away, grouping: rules.grouping, ...(awayLead ? { lead: awayLead } : {}) },
    conditions: {
      toward: towardThemed ? themeTop(towardRoll) : sideTop(rules.groups, "you"),
      away: awayThemed ? themeTop(awayRoll) : sideTop(rules.groups, "away"),
      ...(towardThemed ? { towardThemed: true as const } : {}),
      ...(awayThemed ? { awayThemed: true as const } : {}),
      towardCells: rules.cellsBySide.you,
      awayCells: rules.cellsBySide.away,
      ...(towardThemed ? { towardBase } : {}),
      ...(awayThemed ? { awayBase } : {}),
      defaults: (["you", "away"] as const).flatMap((side) => {
        const g = rules.groups.filter((x) => x.side === side && isDefaultCondition(x.label)).sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label))[0];
        return g ? [{ side, label: g.label, cells: g.cells, routes: g.routes }] : [];
      }),
    },
  };
}

/* The Brief's per-brand argument lift (moved from analysis_map.ts; the Map no longer reads it): over the open-choice
 * pool, counted here outside the fact layer until part 2. */
/** Share of answers arguing each code when `key` is picked vs when another
 * in-category brand is, over the headline pool (brand_summary's lift, for any
 * brand) - shared with the brief so a rival's argument numbers match. */
export function liftForBrand(data: ViewData, request: ViewRequest, key: string): { code: string; wins: RateCell; others: RateCell; lift: number }[] {
  const resolve = buildResolver(data.dictionary, data.judged);
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
  if (wins.length < 20 || others.length < 20) return [];
  const withR = facts.filter((f) => f.reasons !== null);
  const counts = new Map<string, number>();
  for (const f of withR) for (const r of f.reasons!) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, k]) => k / withR.length >= 0.02)
    .map(([code]) => {
      const w = cell(wins.filter((f) => f.reasons!.includes(code)).length, wins.length);
      const o = cell(others.filter((f) => f.reasons!.includes(code)).length, others.length);
      return { code, wins: w, others: o, lift: rate(w) - rate(o) };
    })
    .sort((a, b) => b.lift - a.lift);
}

