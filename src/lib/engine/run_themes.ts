import { isDefaultCondition } from "./condition_groups";
import { computeRules, type RuleGroup, type RulesView } from "./rules_explorer";
import { EVERY_BUYER, poolInputs, rankGroups, situationsOf, slKey, themeReasons, type AnswerRules, type ThemeMap } from "./reason_themes";
import { isWallWording } from "./wall_wording";
import { computeMemo, type ViewData, type ViewRequest } from "./view_data";

/**
 * The run's shared reason themes (2026-11-12, the reasons harmonization):
 * every customer-visible list of buyer conditions reads the same two-level
 * dt4 themes. The rules capture and the per-side theme pass used to be built
 * inline by the analysis map, the Stations and the dossiers (each byte-for-byte
 * the same inputs); they live here once, memoized per load epoch and engine
 * set (view_data computeMemo). The pools are built exactly as the map built
 * them (rankGroups of each side's groups, the default clause left out), so
 * every themeReasons call keys the same `dossier_themes:dt4:` cache entries -
 * moving the pass here makes no new call.
 *
 * Imports neither analysis_map.ts nor summary_insights.ts (the map imports
 * the summary, the dossiers import the map, the head-to-head view and the
 * summary import this).
 */

/** The rules explorer's groups plus the capture the theme pass reads. */
export interface RulesShared {
  rules: RulesView;
  cellSets: Map<string, string[]>;
  surfaces: Map<string, string[]>;
  /** Group id -> intent id -> distinct response ids (answer-grain cell shares). */
  cellAnswers: Map<string, Map<string, Set<string>>>;
  /** am15: group id -> response id -> its statement (receipts and routes). */
  answerRules: AnswerRules;
}

/** computeRules with the theme capture, over the engines-only request (the
 * dossier computes it the same way and hands it in, so it runs once). */
export async function rulesForThemes(data: ViewData, eng: ViewRequest): Promise<RulesShared> {
  const cellSets = new Map<string, string[]>();
  const surfaces = new Map<string, string[]>();
  const cellAnswers = new Map<string, Map<string, Set<string>>>();
  const answerRules: AnswerRules = new Map();
  const rules = await computeRules(data, eng, { cellSets, surfaces, cellAnswers, answerRules });
  return { rules, cellSets, surfaces, cellAnswers, answerRules };
}

const rulesMemo = computeMemo<RulesShared>("rules_for_themes");

/** rulesForThemes once per load epoch and engine set (view_data
 * computeMemo): the map and the dossiers read the same groups and capture.
 * READ-ONLY: the maps and the rules view are shared. */
export function sharedRules(data: ViewData, eng: ViewRequest): Promise<RulesShared> {
  const e: ViewRequest = eng.engines ? { engines: eng.engines } : {};
  return rulesMemo.get(data, e, (d) => rulesForThemes(d, e));
}

/** The run's per-side theme maps over the shared rules capture. */
export interface RunThemes {
  rules: RulesShared;
  /** Intent id -> buying situation (EVERY_BUYER for cells asked of no particular buyer). */
  sitOf: Map<string, string>;
  /** The side pools the theme pass read: ranked, default clause left out. */
  towardPool: RuleGroup[];
  awayPool: RuleGroup[];
  /** Null keyless, on a non-gpt theme model, or when the pass failed (then
   * data.judgeIncomplete is set, so the view serves uncached and retries). */
  toward: ThemeMap | null;
  away: ThemeMap | null;
}

const themesMemo = computeMemo<RunThemes>("run_themes");

/**
 * The run's theme maps once per load epoch and engine set. Keyless or a
 * non-gpt theme model -> null maps (flat lists, cached normally); a failed
 * pass -> null maps AND judgeIncomplete on the caller's data. READ-ONLY.
 */
export function sharedRunThemes(data: ViewData, eng: ViewRequest): Promise<RunThemes> {
  const e: ViewRequest = eng.engines ? { engines: eng.engines } : {};
  return themesMemo.get(data, e, async (d) => {
    const rules = await sharedRules(d, e);
    const { project } = d;
    const sitOf = situationsOf(d.intents);
    const towardPool = rankGroups(rules.rules.groups.filter((g) => g.side === "you")).filter((g) => !isDefaultCondition(g.label));
    const awayPool = rankGroups(rules.rules.groups.filter((g) => g.side === "away")).filter((g) => !isDefaultCondition(g.label));
    let toward: ThemeMap | null = null;
    let away: ThemeMap | null = null;
    try {
      const meta = { brand: project.brand, category: project.category, projectId: project.id };
      const costCtx = { projectId: project.id, runId: d.run.id };
      const t = poolInputs(towardPool, rules.surfaces, rules.cellSets, sitOf);
      const a = poolInputs(awayPool, rules.surfaces, rules.cellSets, sitOf);
      [toward, away] = await Promise.all([
        themeReasons(t.labelCells, t.labelSamples, "toward", meta, costCtx),
        themeReasons(a.labelCells, a.labelSamples, "away", meta, costCtx),
      ]);
    } catch (err) {
      console.warn(`run reason themes failed, flat lists served: ${err instanceof Error ? err.message : err}`);
      d.judgeIncomplete = true;
      toward = away = null;
    }
    return { rules, sitOf, towardPool, awayPool, toward, away };
  });
}

/** One theme as a single row (the brief's sentences and the summary's
 * away-condition detector read these where they read raw groups before). */
export interface ThemeRollup {
  label: string;
  /** Statements: per member group, the distinct answers stating it, summed
   * over the theme's member groups - an answer stating two of its member
   * wordings counts twice. Replaces the raw group's "rules" count. */
  rules: number;
  /** Distinct answers stating any member wording. */
  answers: number;
  /** Distinct questions (cells) with a member statement. */
  cells: number;
  /** isWallWording on the theme name (the away side passes the own brand). */
  wall: boolean;
  /** Where the member answers send the buyer: away - the active brands their
   * rules name; toward - the client's products as the answers name them (the
   * brand's own name when a rule names none). Distinct answers per name, top 4,
   * RuleGroup.routes' shape. */
  routes: { name: string; n: number }[];
  /** Member group labels, most-stated first. */
  members: string[];
}

/**
 * One side's pool rolled up to its total themes. Attribution is per (group,
 * intent): the theme is totOf[stOf(slKey(situation of the intent, group
 * label))], exactly as themeTreeAnswers assigns it. Sorted by distinct
 * answers, then statements, then name. [] with no theme map.
 */
export function themeRollup(
  pool: RuleGroup[],
  tm: ThemeMap | null,
  rs: RulesShared,
  sitOf: Map<string, string>,
  side: "toward" | "away",
  own: string
): ThemeRollup[] {
  if (!tm || pool.length === 0) return [];
  type Acc = { rules: number; answers: Set<string>; cells: Set<string>; members: Map<string, number>; dest: Map<string, Set<string>> };
  const by = new Map<number, Acc>();
  const casing = new Map<string, string>();
  for (const g of pool) {
    const per = rs.cellAnswers.get(g.id);
    if (!per) continue;
    const said = rs.answerRules.get(g.id);
    for (const [c, ids] of per) {
      if (ids.size === 0) continue;
      const s = tm.stOf.get(slKey(sitOf.get(c) ?? EVERY_BUYER, g.label));
      if (s === undefined) continue;
      const t = tm.totOf[s];
      const acc = by.get(t) ?? { rules: 0, answers: new Set<string>(), cells: new Set<string>(), members: new Map<string, number>(), dest: new Map<string, Set<string>>() };
      by.set(t, acc);
      acc.rules += ids.size;
      acc.cells.add(c);
      acc.members.set(g.label, (acc.members.get(g.label) ?? 0) + ids.size);
      for (const id of ids) {
        acc.answers.add(id);
        const r = said?.get(id);
        const names = side === "away" ? r?.to ?? [] : r?.cards?.length ? r.cards : [own];
        for (const raw of names) {
          const name = raw.trim();
          if (!name) continue;
          const k = name.toLowerCase();
          if (!casing.has(k)) casing.set(k, name);
          const set = acc.dest.get(k) ?? new Set<string>();
          set.add(id);
          acc.dest.set(k, set);
        }
      }
    }
  }
  return [...by.entries()]
    .map(([t, a]) => ({
      label: tm.totName[t],
      rules: a.rules,
      answers: a.answers.size,
      cells: a.cells.size,
      wall: isWallWording([tm.totName[t]], side === "away" ? own : null),
      routes: [...a.dest.entries()]
        .map(([k, ids]) => ({ name: casing.get(k)!, n: ids.size }))
        .sort((x, y) => y.n - x.n || x.name.localeCompare(y.name))
        .slice(0, 4),
      members: [...a.members.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([l]) => l),
    }))
    .sort((a, b) => b.answers - a.answers || b.rules - a.rules || a.label.localeCompare(b.label));
}
