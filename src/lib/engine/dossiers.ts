import { buildResolver } from "./brand_resolve";
import { computeBrandSummary, type SummaryBrand } from "./brand_summary";
import { computeAnalysisMap, type AnalysisMapDebug, type MapCellStat } from "./analysis_map";
import { brandHeadline, cardSourcesOf, type Lift, conversionOf, funnelRows, liftEnds, pctOf, picksFromRow, supplyLine, topQuestionRow } from "./answer_cards";
import { createHash } from "node:crypto";
import { computeRules, type RuleGroup } from "./rules_explorer";
import { conditionThemeKeysFor, isDefaultCondition } from "./condition_groups";
import type { InsightInputs } from "./summary_insights";
import { cachedView, condCache, requestOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import type { Project, Run } from "../types";

/**
 * Brand dossiers (2026-11-08, the owner's ratified shape -
 * public/_position_panel_options.html tab 6): the Rivals pill becomes one
 * standing page per rival brand - the brief's brand card promoted to a page,
 * with the brand's own map cells folded in.
 *
 * Every number restates an object the brief already reads, through the SAME
 * helpers the brand card uses (answer_cards.ts funnelRows / picksFromRow /
 * topQuestionRow / liftEnds / supplyLine over cardSourcesOf), so a dossier and
 * the brief's brand card can never disagree. The head-to-head record is the
 * summary's (entity matchups) or, for a class matchup, the map cell's sides;
 * switching reads the leaver cell's own pool (computeAlternatives' capture
 * row, the map's leaver figures); routing reads the run's condition groups
 * (the condition card's away branches). No model call beyond the context
 * judge the summary already pays.
 *
 * No counts: values are percentages and template sentences only.
 */

export interface DossierArg {
  label: string;
  /** Signed points (wins share minus others share), for the bar. */
  value: number;
  wins: string;
  others: string;
}

export interface Dossier {
  key: string;
  name: string;
  /** Leads the chip row: takes >= 2% of the picks, or has a matchup or leaver cell (the rest fold under "More brands"). */
  prominent: boolean;
  headline: string;
  /** Named / Share of picks / Picked, of all answers / Recommendations that end as the pick. */
  tiles: { value: string; label: string }[];
  /** Where its picks come from: by question type and its top question's share (each null under the floor). */
  picksFrom: { byType: string | null; topQuestion: string | null };
  /** Against the tracker's brand: the two-way record, or an absent-matchup note. */
  h2h:
    | { kind: "record"; you: string; them: string; youLabel: string; themLabel: string; /** Asked against the brand's whole class of product, not the brand. */ asClass?: boolean }
    | { kind: "missing"; note: string; alert: boolean };
  /** Its leaver cell's read, or the pooled leavers' line; null when neither applies. */
  switching: string | null;
  /** The no-pick share of those leaver answers (its own cell's, or the pooled leavers' with the pooled line). */
  switchingNoPick: string | null;
  /** The argument it wins on and the one it loses on (empty under the floor). */
  args: DossierArg[];
  /** "See more": its full lift list (every code clearing liftForBrand's floors), best first. */
  argsAll: DossierArg[];
  argSides: [string, string];
  /** The largest stated reason to leave you that points buyers to it, when one exists. */
  routes: string | null;
  /** "See more": every stated reason to leave you whose top route is this brand, with its share of the questions where the AI gives any reason to leave you. */
  routesAll: { label: string; share: string }[];
  /** do2: the default ("otherwise") branch away from you, when its top route is this brand. */
  routesDefault: string | null;
  /** do2, the other side of the contest: the stated reasons that point buyers back to
   * you (the run's toward-you groups, top 6), each with its share of the questions
   * where the AI gives any reason to pick you - a DIFFERENT base from routesAll's. */
  routesBack: { label: string; share: string }[];
  /** do2: the default branch toward you, when one exists. */
  routesBackDefault: string | null;
  /** do3, the slide-over only: routesAll gathered into themes (a looser second
   * grouping over the group labels). Each theme's share is of the same base as
   * routesAll, over the UNION of its members' questions - never a sum. */
  routesThemes: DossierTheme[];
  /** do3: every toward-you group (not just the top 6), gathered into themes, on routesBack's base. */
  routesBackThemes: DossierTheme[];
  /** The vendor-supply line, when the detector's threshold clears. */
  supply: string | null;
  /** "See more": its picks split per company and per assistant, each with its share of the questions answered. */
  supplyAll: { vendors: SupplyRow[]; assistants: SupplyRow[] };
  /** Map cell ids for the links (null when the map has no such cell). */
  cells: { h2h: string | null; leaver: string | null };
}

/** A theme of stated reasons: its largest member's wording, its share over the
 * union of its members' questions, and the member reasons beneath (empty when
 * the theme is a single reason). */
export interface DossierTheme {
  label: string;
  share: string;
  members: { label: string; share: string }[];
}

export interface SupplyRow {
  label: string;
  /** Share of its picks. */
  picks: string;
  /** Share of the questions this unit answers. */
  answers: string;
}

export interface DossiersView {
  runId: string;
  brand: string;
  dossiers: Dossier[];
}

/** A brand taking at least this share of the picks with no matchup asked gets the amber callout. */
const NO_H2H_ALERT = 0.1;
/** The pooled leavers' line needs this share of the leavers' picks, over this many picks. */
const CAPTURE_NOTE = 0.1;
const MIN_SIDE = 20;

const rate = (c: RateCell) => (c.n > 0 ? c.k / c.n : 0);
const pct = (c: RateCell) => pctOf(rate(c));
const poss = (name: string) => `${name}'s`;

function headlineOf(b: SummaryBrand, all: SummaryBrand[], f: ReturnType<typeof funnelRows>): string {
  const top = [...all].sort((x, y) => y.chosen.k - x.chosen.k)[0];
  const mostPicked = top && top.key === b.key && b.chosen.k > 0 && !all.some((x) => x.key !== b.key && x.chosen.k === b.chosen.k);
  const convertible = all.filter((x) => x.recommended.k >= MIN_SIDE);
  const bestConv =
    b.recommended.k >= MIN_SIDE &&
    b.chosen.k > 0 &&
    convertible.length >= 2 &&
    convertible.every((x) => x.key === b.key || conversionOf(x) < conversionOf(b));
  if (mostPicked) return `${b.name} is named in ${f.named.value} of answers and takes ${f.share.value} of the picks - the most of any brand - turning ${f.converts.value} of its recommendations into picks.`;
  if (bestConv && rate(b.mentioned) < 0.5)
    return `${b.name} is named in just ${f.named.value} of answers yet takes ${f.share.value} of the picks - it turns ${f.converts.value} of its recommendations into picks, the best conversion on the board.`;
  if (bestConv) return `${b.name} is named in ${f.named.value} of answers and takes ${f.share.value} of the picks - it turns ${f.converts.value} of its recommendations into picks, the best conversion on the board.`;
  return brandHeadline(b.name, b);
}

export async function computeDossiers(data: ViewData, request: ViewRequest = {}): Promise<DossiersView> {
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  const capture: { inputs?: InsightInputs } = {};
  const summary = await computeBrandSummary(data, eng, capture);
  const inputs = capture.inputs!;
  const debug = { walls: [], casting: {}, cells: {} } as unknown as AnalysisMapDebug & { cells: Record<string, MapCellStat> };
  const map = await computeAnalysisMap(data, eng, debug, { summary, inputs });
  const { src } = cardSourcesOf(data, eng, summary, inputs);
  const resolve = buildResolver(data.dictionary, data.judged);
  const brand = data.project.brand;
  const target = summary.target;
  const targetName = resolve(brand).name;
  const all = [target, ...summary.brands.filter((b) => b.key !== target.key)];

  const cellOf = (row: string, key: string): string | null => {
    for (const [id, st] of Object.entries(debug.cells)) if (st.row === row && !st.pooled && st.rivalKey === key && map.positions[id]) return id;
    return null;
  };
  const offensive = inputs.alternatives.offensive;
  // Every away branch the run's rules explorer groups (its own one-per-run
  // grouping), ranked as the condition card ranks them (by answers stating
  // it), so "the largest single reason" means what the brief means by it.
  // do2: a default-shaped branch ("otherwise") is not a reason - it leaves
  // the lists and renders as one default line per side.
  const cellSets = new Map<string, string[]>();
  const rules = await computeRules(data, eng, { cellSets });
  const rank = <T extends { answers: number; rules: number; label: string }>(xs: T[]) => [...xs].sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label));
  const awayAll = rank(rules.groups.filter((g) => g.side === "away"));
  const awayGroups = awayAll.filter((g) => !isDefaultCondition(g.label));
  const awayDefaults = awayAll.filter((g) => isDefaultCondition(g.label));
  const awayCells = rules.cellsBySide.away;
  const towardAll = rank(rules.groups.filter((g) => g.side === "you"));
  const towardCells = rules.cellsBySide.you;
  const routesBack = towardCells > 0 ? towardAll.filter((g) => !isDefaultCondition(g.label)).slice(0, 6).map((g) => ({ label: g.label, share: pctOf(g.cells / towardCells) })) : [];
  const backDefault = towardAll.find((g) => isDefaultCondition(g.label));
  const routesBackDefault =
    backDefault && towardCells > 0
      ? `The default: when no stated reason applies, the AI points buyers back to you (in ${pctOf(backDefault.cells / towardCells)} of those questions).`
      : null;
  // do3, the slide-over's theme rollup: ONE theme key map over every listed
  // (non-default) group label on both sides, so a wording themes identically
  // wherever it appears; weighted by the group's distinct questions. Keyless
  // or on failure the map is identity, and every theme is one reason.
  const towardListed = towardAll.filter((g) => !isDefaultCondition(g.label));
  const themeWeights = new Map<string, number>();
  for (const g of [...awayGroups, ...towardListed]) themeWeights.set(g.label, (themeWeights.get(g.label) ?? 0) + g.cells);
  const themeCache = condCache(data, "rules:themes");
  if (themeCache && request.engines) themeCache.scope += `:eng:${createHash("sha256").update([...request.engines].sort().join("|")).digest("hex").slice(0, 12)}`;
  const themeKeys = await conditionThemeKeysFor(themeWeights, { cache: themeCache });
  const themesOf = (pool: RuleGroup[], base: number): DossierTheme[] => {
    if (base <= 0 || pool.length === 0) return [];
    const order = new Map(pool.map((g, i) => [g.id, i]));
    const by = new Map<string, RuleGroup[]>();
    for (const g of pool) {
      const k = themeKeys.get(g.label) ?? `i:${g.label}`;
      const list = by.get(k) ?? [];
      list.push(g);
      by.set(k, list);
    }
    return [...by.values()]
      .map((ms) => {
        const members = [...ms].sort((a, b) => b.cells - a.cells || order.get(a.id)! - order.get(b.id)!);
        const union = new Set<string>();
        for (const g of members) for (const c of cellSets.get(g.id) ?? []) union.add(c);
        return {
          label: members[0].label,
          n: union.size,
          share: pctOf(union.size / base),
          members: members.length > 1 ? members.map((g) => ({ label: g.label, share: pctOf(g.cells / base) })) : [],
        };
      })
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
      .map(({ label, share, members }) => ({ label, share, members }));
  };
  const routesBackThemes = themesOf(towardListed, towardCells);
  const captors = offensive ? [...offensive.captors].sort((a, b) => b.chosen.k - a.chosen.k || b.named.k - a.named.k || a.name.localeCompare(b.name)) : [];

  const dossiers: Dossier[] = summary.brands
    .filter((b) => b.key !== target.key && b.mentioned.k > 0)
    .sort((a, b) => b.chosen.k - a.chosen.k || b.mentioned.k - a.mentioned.k || a.name.localeCompare(b.name))
    .map((b): Dossier => {
      const f = funnelRows(b);
      const h2hCell = cellOf("h2h", b.key);
      const leaverCell = cellOf("leavers", b.key);

      // Against you, head to head: the summary's entity record, else a class cell's sides.
      let h2h: Dossier["h2h"];
      const rec = summary.headToHead.find((r) => r.key === b.key);
      const st = h2hCell ? debug.cells[h2hCell] : null;
      const youLabel = `${brand} picked, of the answers that pick one of the two`;
      if (rec && rec.winOfDecided.n > 0) {
        h2h = { kind: "record", you: pct(rec.winOfDecided), them: pctOf(rec.lost.k / rec.winOfDecided.n), youLabel, themLabel: `${b.name} picked` };
      } else if (st && st.you + st.them > 0) {
        h2h = { kind: "record", you: pctOf(st.you / (st.you + st.them)), them: pctOf(st.them / (st.you + st.them)), youLabel, themLabel: `${b.name} picked`, ...(h2hCell!.includes(":class-") ? { asClass: true } : {}) };
      } else if (h2hCell) {
        h2h = { kind: "missing", note: `Asked beside ${brand} directly, the AI picks neither of the two.`, alert: false };
      } else if (rate(b.shareOfDecided) >= NO_H2H_ALERT) {
        h2h = {
          kind: "missing",
          note: `No head-to-head was asked against ${b.name} this wave - it takes ${f.share.value} of the picks without ever being put beside you directly. A matchup cell is a setup decision away.`,
          alert: true,
        };
      } else h2h = { kind: "missing", note: `No head-to-head was asked against ${b.name} this wave.`, alert: false };

      // Switching: its own leavers, else where rival leavers end up.
      let switching: string | null = null;
      let switchingNoPick: string | null = null;
      const noPickLine = (c: RateCell, whose: string) => `The AI commits to no single pick in ${pct(c)} of ${whose} answers.`;
      const row = offensive?.rows.find((r) => r.key === b.key && r.answers > 0);
      if (row) {
        const inCat = row.captured.k + row.anotherBrand.k + row.sameBrand.k;
        const top = row.captors.find((c) => c.name !== targetName);
        let tail = "";
        if (top && inCat > 0) {
          const share = pctOf(top.n / inCat);
          tail = top.name === b.name ? ` - ${share} of those picks stay with ${b.name}` : ` - ${top.name} takes ${share} of those picks`;
        }
        switching = `When ${poss(b.name)} customers ask what to switch to, ${brand} is named in ${pct(row.named)} of answers and picked in ${pct(row.captured)}${tail}.`;
        switchingNoPick = noPickLine(row.undecided, "those");
      } else if (offensive) {
        const c = offensive.captors.find((x) => x.key === b.key);
        if (c && c.shareOfDecided.n >= MIN_SIDE && rate(c.shareOfDecided) >= CAPTURE_NOTE) {
          const rank = captors.findIndex((x) => x.key === b.key);
          const lead = captors[0];
          const tail = rank === 0 ? " - more than any other brand" : rank === 1 && lead ? ` - second only to ${lead.key === target.key ? brand : lead.name}` : "";
          switching = `When a rival's customers ask what to switch to, ${b.name} takes ${pct(c.shareOfDecided)} of the picks${tail}.`;
          switchingNoPick = noPickLine(offensive.overall.undecided, "rival leavers'");
        }
      }

      // The arguments: the lift list's two ends, drawn as bars with their shares.
      const ends = liftEnds(src, b.key);
      const toArg = (l: Lift): DossierArg => ({ label: l.code, value: Math.round(l.lift * 100), wins: pct(l.wins), others: pct(l.others) });
      const args: DossierArg[] = ends ? [ends.win, ...(ends.lose ? [ends.lose] : [])].map(toArg) : [];
      const argsAll: DossierArg[] = src.liftOf(b.key).map(toArg);

      // The reasons pointing to it: every stated reason to leave you whose
      // top route is this brand, in the card's rank, each with its share of
      // the questions where the AI gives any reason to leave you; the
      // section's line states the first (the condition card's "The biggest
      // reason pointing to <brand>").
      const mine = awayGroups.filter((g) => g.routes[0] && resolve(g.routes[0].name).key === b.key);
      const routesAll = awayCells > 0 ? mine.map((g) => ({ label: g.label, share: pctOf(g.cells / awayCells) })) : [];
      const routes = routesAll.length
        ? `When the AI gives buyers a reason to leave you, "${routesAll[0].label}" → ${b.name} is one of them in ${routesAll[0].share} of those questions${mine[0] === awayGroups[0] ? " - the largest single reason" : ""}.`
        : null;
      // The default away branch belongs on the dossier of the brand it points to.
      const dflt = awayCells > 0 ? awayDefaults.find((g) => g.routes[0] && resolve(g.routes[0].name).key === b.key) : undefined;
      const routesThemes = themesOf(mine, awayCells);
      const routesDefault = dflt ? `The default: when no stated reason applies, the AI points buyers to ${b.name} (in ${pctOf(dflt.cells / awayCells)} of those questions).` : null;

      // Who supplies its picks, in full: per company and per assistant.
      const ep = inputs.enginePicks.find((x) => x.key === b.key);
      const supplyAll: Dossier["supplyAll"] = { vendors: [], assistants: [] };
      if (ep && ep.total > 0 && summary.answers > 0) {
        type U = { label: string; p: number; a: number };
        const asst: U[] = summary.byEngine.map((e) => ({ label: e.label, p: ep.byModel[e.key] ?? 0, a: e.answers }));
        const vend = new Map<string, U>();
        for (const e of summary.byEngine) {
          const v = vend.get(e.vendor) ?? { label: e.vendor, p: 0, a: 0 };
          v.p += ep.byModel[e.key] ?? 0;
          v.a += e.answers;
          vend.set(e.vendor, v);
        }
        const out = (us: U[]): SupplyRow[] =>
          [...us]
            .sort((x, y) => y.p - x.p || x.label.localeCompare(y.label))
            .map((u) => ({ label: u.label, picks: pctOf(u.p / ep.total), answers: pctOf(u.a / summary.answers) }));
        supplyAll.assistants = out(asst);
        supplyAll.vendors = vend.size >= 2 ? out([...vend.values()]) : [];
      }

      const sup = supplyLine(summary, inputs, b.key);
      return {
        key: b.key,
        name: b.name,
        prominent: rate(b.shareOfDecided) >= 0.02 || !!h2hCell || !!leaverCell,
        headline: headlineOf(b, all, f),
        tiles: [
          { value: f.named.value, label: "Named when buyers ask what to buy" },
          { value: f.share.value, label: "Share of picks" },
          { value: f.picked.value, label: "Picked, of all answers" },
          { value: f.converts.value, label: "Recommendations that end as the pick" },
        ],
        picksFrom: { byType: picksFromRow(src, b.key)?.value ?? null, topQuestion: topQuestionRow(src, b.key)?.value ?? null },
        h2h,
        switching,
        switchingNoPick,
        args,
        argsAll,
        argSides: ["its picks", "rivals' picks"],
        routes,
        routesAll,
        routesDefault,
        routesBack,
        routesBackDefault,
        routesThemes,
        routesBackThemes,
        supply: sup ? `${sup.label} ${sup.value}.` : null,
        supplyAll,
        cells: { h2h: h2hCell, leaver: leaverCell },
      };
    });
  return { runId: data.run.id, brand, dossiers };
}

// do1 (2026-11-08): first version - the Rivals pill as brand dossiers.
// do2 (2026-11-08): the owner's three rulings - the routes line reworded as a
// reason to leave you; the section two-sided (reasons pointing to it AND back
// to you, each on its own base); default-shaped branches ("otherwise") leave
// the lists for one default line per side.
// do3 (2026-11-08): the slide-over's theme rollup - routesThemes /
// routesBackThemes (additive; the flat lists stay for stale clients).
const DOSSIERS_VERSION = "do3";
export function computeDossiersCached(run: Run, project: Project, request: ViewRequest = {}): Promise<DossiersView | null> {
  const r = requestOf(request);
  return cachedView("dossiers", DOSSIERS_VERSION, run, project, (d) => computeDossiers(d, r), { judge: true, setupDecision: true }, r);
}
