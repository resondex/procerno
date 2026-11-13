import { buildResolver } from "./brand_resolve";
import { BRAND_SUMMARY_VERSION, sharedBrandSummary, type BrandSummaryView, type SummaryBrand } from "./brand_summary";
import { ANALYSIS_MAP_VERSION, receiptsOf, sharedAnalysisMap } from "./analysis_map";
import { brandHeadline, cardSourcesOf, type Lift, conversionOf, funnelRows, liftEnds, pctOf, picksFromRow, supplyLine, topQuestionRow } from "./answer_cards";
import type { RuleGroup } from "./rules_explorer";
import { isDefaultCondition } from "./condition_groups";
import { cachedView, poolOf, requestOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import { rankGroups, spreadRefs, themeTree, type AnswerRule, type DossierTheme, type ThemeEvidence, type ThemeMap } from "./reason_themes";
import { sharedRunThemes } from "./run_themes";
import { clearsMatchupGap } from "./matchup_gap";
import type { AnswerRef, PositionReceipt } from "./analysis_types";
import type { Project, Run } from "../types";

// The theme machinery moved to reason_themes.ts (option D); re-exported for existing importers.
export {
  cleanThemeName,
  scenarioThemeSystem,
  totalThemeSystem,
  validateThemes,
  type DossierTheme,
  type DossierThemeBucket,
  type DossierThemeGroup,
  type ThemeGrouping,
  type ThemeSide,
} from "./reason_themes";

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
  /** do7: up to 2 answers where the brand is the pick and the code is argued (different engines). */
  receipts?: AnswerRef[];
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
  /** The slide-over only: routesAll gathered into themes - per buying
   * situation, then merged across situations (themeReasons). Every share is
   * of routesAll's base, over the UNION of the questions beneath - never a
   * sum. Empty when the theme pass did not run or failed (flat list instead). */
  routesThemes: DossierTheme[];
  /** Every toward-you group (not just the top 6), themed the same way, on routesBack's base. */
  routesBackThemes: DossierTheme[];
  /** The vendor-supply line, when the detector's threshold clears. */
  supply: string | null;
  /** "See more": its picks split per company and per assistant, each with its share of the questions answered. */
  supplyAll: { vendors: SupplyRow[]; assistants: SupplyRow[] };
  /** do6: answers where it is the top pick (open choice, engine-scoped),
   * spread across engines like the map's receipts - the one panel's receipts. */
  receipts: PositionReceipt[];
  /** Map cell ids for the links (null when the map has no such cell). */
  cells: { h2h: string | null; leaver: string | null };
  /** do7: its share of the picks beside yours in each open-choice buying
   * situation where it clears the map's brand floor (Position.brands). */
  rooms?: { cellId: string; label: string; them: string; you: string }[];
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


/** The dossier membership rule: every summary brand but the target that the
 * AI names at least once. One place, so the brief's "Open the X dossier"
 * links (hasDossier) can never point at a brand Rivals does not render. */
const isDossierBrand = (summary: BrandSummaryView, b: SummaryBrand) => b.key !== summary.target.key && b.mentioned.k > 0;

/** Does `key` get a dossier, from the same summary (same engine set) the dossiers read? */
export function hasDossier(summary: BrandSummaryView, key: string): boolean {
  return summary.brands.some((b) => b.key === key && isDossierBrand(summary, b));
}

export async function computeDossiers(data: ViewData, request: ViewRequest = {}): Promise<DossiersView> {
  const eng: ViewRequest = request.engines ? { engines: request.engines } : {};
  // The summary, the map (with its cell stats) and the rules explorer's
  // groups come from the per-load shared computes (view_data computeMemo):
  // the map's reason themes read the same rules capture, so the theme calls
  // key identically. All READ-ONLY here.
  const { view: summary, inputs } = await sharedBrandSummary(data, eng);
  const { view: map, debug, rules: shared } = await sharedAnalysisMap(data, eng);
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
  const { rules, cellSets } = shared;
  const rank = rankGroups;
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
      ? `The default: when no stated condition applies, the AI points buyers back to you (in ${pctOf(backDefault.cells / towardCells)} of those questions).`
      : null;
  // The slide-over's theme tree: one two-level theming PER SIDE (dt4) over
  // that side's listed (non-default) group labels, so a theme's name keeps the
  // side's direction - a wording appearing on both sides may theme and read
  // differently per side, which is the point: the shared pool named only the
  // axis both sides pivot on. Each label is attributed to the buying
  // situations of the questions carrying it. Keyless, or when a side's call
  // fails, both sides get no themes and the slide-over reads the flat lists.
  const towardListed = towardAll.filter((g) => !isDefaultCondition(g.label));
  // 2026-11-12: the theme maps are the run's shared pass (run_themes.ts) over
  // exactly these pools (towardListed / awayGroups are its towardPool /
  // awayPool), so the dt4 calls key identically. A failed pass leaves both
  // maps null and marks the view incomplete (served flat, never cached).
  const rt = await sharedRunThemes(data, eng);
  const sitOf = rt.sitOf;
  const towardMap: ThemeMap | null = rt.toward;
  const awayMap: ThemeMap | null = rt.away;
  const themesOf = (pool: RuleGroup[], base: number, tm: ThemeMap | null, evidence: ThemeEvidence) => themeTree(pool, base, tm, cellSets, sitOf, undefined, evidence);
  const routesBackThemes = themesOf(towardListed, towardCells, towardMap, { rules: shared.answerRules, side: "toward" });
  // do7: the open-choice buying situations' pick splits, for each dossier's "By buyer".
  const roomCells = Object.entries(debug.cells)
    .filter(([id, st]) => st.row === "open" && !st.pooled && map.positions[id]?.brands?.length)
    .map(([id, st]) => ({ id, label: st.label, p: map.positions[id] }));
  // do6: the pick receipts - open-choice answers where the brand is the top
  // pick, on the same engine-scoped headline pool the summary reads.
  const picksBy = new Map<string, Parameters<typeof receiptsOf>[0]>();
  for (const row of poolOf(data, "headline", eng).rows) {
    const c = row.code;
    if (c.outcome !== "pick" || !c.top_pick) continue;
    const k = resolve(c.top_pick).key;
    if (!k) continue;
    const list = picksBy.get(k) ?? [];
    list.push(row);
    picksBy.set(k, list);
  }
  const captors = offensive ? [...offensive.captors].sort((a, b) => b.chosen.k - a.chosen.k || b.named.k - a.named.k || a.name.localeCompare(b.name)) : [];

  const dossiers: Dossier[] = summary.brands
    .filter((b) => isDossierBrand(summary, b))
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
      } else if (clearsMatchupGap(b.shareOfDecided)) {
        // matchup_gap.ts: the same rule as the Overview's unasked_rival finding.
        h2h = {
          kind: "missing",
          note: `No head-to-head was asked against ${b.name} this wave - it takes ${f.share.value} of the picks without ever being put beside you directly. Ask this matchup and the AI is asked to pick between you at the next collection.`,
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
          switchingNoPick = noPickLine(offensive.overall.undecided, "the switching customers'");
        }
      }

      // The arguments: the lift list's two ends, drawn as bars with their shares.
      const ends = liftEnds(src, b.key);
      const toArg = (l: Lift): DossierArg => ({ label: l.code, value: Math.round(l.lift * 100), wins: pct(l.wins), others: pct(l.others) });
      const args: DossierArg[] = ends ? [ends.win, ...(ends.lose ? [ends.lose] : [])].map(toArg) : [];
      // do7: each argument row's receipts - answers picking this brand that argue it.
      const mineRows = picksBy.get(b.key) ?? [];
      const argsAll: DossierArg[] = src.liftOf(b.key).map((l) => {
        const refs = spreadRefs(mineRows.filter((r) => r.code.reasons?.includes(l.code)).map((r) => ({ id: r.code.response_id, find: l.code, model: r.model })));
        return { ...toArg(l), ...(refs.length ? { receipts: refs } : {}) };
      });

      // The reasons pointing to it: every stated reason to leave you whose
      // top route is this brand, in the card's rank, each with its share of
      // the questions where the AI gives any reason to leave you; the
      // section's line states the first (the condition card's "The biggest
      // reason pointing to <brand>").
      const mine = awayGroups.filter((g) => g.routes[0] && resolve(g.routes[0].name).key === b.key);
      const routesAll = awayCells > 0 ? mine.map((g) => ({ label: g.label, share: pctOf(g.cells / awayCells) })) : [];
      const routes = routesAll.length
        ? `When the AI sends buyers away from you, "${routesAll[0].label}" is one of the conditions that sends them to ${b.name}, in ${routesAll[0].share} of those questions${mine[0] === awayGroups[0] ? " - the most common condition of all" : ""}.`
        : null;
      // The default away branch belongs on the dossier of the brand it points to.
      const dflt = awayCells > 0 ? awayDefaults.find((g) => g.routes[0] && resolve(g.routes[0].name).key === b.key) : undefined;
      const toThis = (r: AnswerRule) => r.to.some((n) => resolve(n).key === b.key);
      const routesThemes = themesOf(mine, awayCells, awayMap, { rules: shared.answerRules, side: "away", accept: toThis, only: (n) => n != null && resolve(n).key === b.key, own: data.project.brand });
      const rooms = roomCells.flatMap(({ id, label, p }) => {
        const hit = p.brands!.find((x) => resolve(x.name).key === b.key);
        return hit ? [{ cellId: id, label, them: hit.share, you: p.youShare ?? "0%" }] : [];
      });
      const routesDefault = dflt ? `The default: when no stated condition applies, the AI points buyers to ${b.name} (in ${pctOf(dflt.cells / awayCells)} of those questions).` : null;

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
        receipts: receiptsOf(picksBy.get(b.key) ?? []),
        cells: { h2h: h2hCell, leaver: leaverCell },
        ...(rooms.length ? { rooms } : {}),
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
// do4 (2026-11-09): themes by two LLM grouping calls (per buying situation,
// then across situations) replace the embedding rollup; themes nest buckets.
// do5 (2026-11-09): the theme pass runs per side (dt4) and names keep the
// side's direction - the shared pool coined axis names ("the subject both
// sides pivot on") that read as contradictions across the two columns.
// do6 (2026-11-09): option D - dossiers carry pick receipts for the one-panel slide-over; themes shared with the map via reason_themes.
// do7 (2026-11-10): the one-panel redesign - rooms (its share beside yours per open-choice buying situation, from the map's brands), argsAll receipts, theme receipts and away routes; the routes and default lines say what sends buyers away instead of "reason".
const DOSSIERS_VERSION = "do11"; // do11 (2026-11-13): grouped reasons tagged fixed by their own name only (reason_themes). // do10 (2026-11-13): the never-asked callout reads matchup_gap.ts (one rule with the unasked_rival finding) and points at the "Ask this matchup" action; // do9 (2026-11-12): a rival page's examples name only its own products; // do8 (2026-11-12): theme examples ranked one-way-first and by fit, with `to`
// The fold (2026-11-09): dossiers embed map cells and summary numbers, so
// their versions ride the key (see analysis_map's fold note).
const DOSSIERS_KEY_VERSION = `${DOSSIERS_VERSION}.${ANALYSIS_MAP_VERSION}.${BRAND_SUMMARY_VERSION}`;
export function computeDossiersCached(run: Run, project: Project, request: ViewRequest = {}): Promise<DossiersView | null> {
  const r = requestOf(request);
  return cachedView("dossiers", DOSSIERS_KEY_VERSION, run, project, (d) => computeDossiers(d, r), { judge: true, setupDecision: true }, r);
}
