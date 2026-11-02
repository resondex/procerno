import { matchKey } from "../brand_key";
import { ENGINES, engineDisplayLabel } from "./providers";
import { buildResolver } from "./brand_resolve";
import { roleOf } from "./headline";
import { exitResolver, type ExitRole } from "./exits";
import { cachedView, cell, poolOf, type PoolRow, type RateCell, type ViewData } from "./view_data";
import type { ViewKey } from "./views";
import type { Project, Run } from "../types";

/**
 * The settled-customer verdict cards (2026-11-01, Decision 2 of the
 * RATIFIED analysis-tier restructure): simple verdict cards for the four
 * Set C stages - business case, expansion, ecosystem, advocacy - drawn under
 * Customers. The fields are in the labels today; the dedicated group-3
 * scorer later replaces the numbers, not the cards.
 *
 * Every stage reads the relationship verdict (strengthens / neutral /
 * weakens) plus its own stage field: business case and advocacy the case
 * strength, expansion the growth stance, ecosystem the pairings named. The
 * premise (does the AI agree with the quoted critic) is asked on advocacy
 * only. Redirects (redirect_to - "use this instead of the brand") resolve
 * through the current dictionary and the context judge like destinations do
 * (exits.ts); a redirect resolving to the client is its own product and is
 * counted apart. These cells are asked across all buyers, so no room filter
 * applies. Shares are over every coded answer in the stage on the core
 * panel; an off-list value counts toward no bucket.
 */

export type { RateCell };

export type Relationship = "strengthens" | "neutral" | "weakens";
export const RELATIONSHIPS: readonly Relationship[] = ["strengthens", "neutral", "weakens"];
export type BusinessCaseStrength = "strong" | "hedged" | "undermined";
export type AdvocacyStrength = "strong" | "partial" | "concedes";
export type Growth = "backs" | "neutral" | "redirects";
export type SettledPremise = "confirms" | "mixed" | "rebuts";
export type MakerRelation = "own" | "third_party" | "substitute";

export interface SettledNamed {
  /** Display name: the dictionary name where it resolves, else as written. */
  name: string;
  /** "outside" = not an approved, analyzed dictionary brand. */
  role: ExitRole;
  /** Answers naming it. */
  n: number;
  /** n over every answer in the stage. */
  share: RateCell;
}

export interface SettledPairing extends SettledNamed {
  /** Majority maker relation across the answers pairing it. */
  makerRelation: MakerRelation;
  /** True when the name resolves to an active dictionary entry. */
  resolved: boolean;
}

export interface SettledSlice {
  key: string;
  label: string;
  answers: number;
  strengthens: RateCell;
}

export interface SettledBase {
  stage: "business_case" | "expansion" | "ecosystem" | "advocacy";
  answers: number;
  uncoded: number;
  verdicts: Record<Relationship, RateCell>;
  /** Answers naming at least one redirect that is not the client. */
  redirectsAny: RateCell;
  /** Answers whose redirects include the client's own product. */
  ownProduct: RateCell;
  /** Redirect brands, most named first (top 10). */
  redirects: SettledNamed[];
  byEngine: SettledSlice[];
}

export interface BusinessCaseView extends SettledBase {
  stage: "business_case";
  caseStrength: Record<BusinessCaseStrength, RateCell>;
}

export interface AdvocacyView extends SettledBase {
  stage: "advocacy";
  caseStrength: Record<AdvocacyStrength, RateCell>;
  /** Over answers with a premise verdict (the cells that quote a critic). */
  premise: Record<SettledPremise, RateCell>;
}

export interface ExpansionView extends SettledBase {
  stage: "expansion";
  growth: Record<Growth, RateCell>;
}

export interface EcosystemView extends SettledBase {
  stage: "ecosystem";
  /** Answers naming at least one pairing. */
  pairsAny: RateCell;
  /** Top 10 pairings by answers. */
  pairings: SettledPairing[];
}

export interface SettledViews {
  runId: string;
  source: string;
  brand: string;
  businessCase: BusinessCaseView | null;
  expansion: ExpansionView | null;
  ecosystem: EcosystemView | null;
  advocacy: AdvocacyView | null;
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
const TOP = 10;

function enumCells<V extends string>(rows: PoolRow[], values: readonly V[], field: (r: PoolRow) => string | null): Record<V, RateCell> {
  return Object.fromEntries(values.map((v) => [v, cell(count(rows, (r) => field(r) === v), rows.length)])) as Record<V, RateCell>;
}

export function computeSettled(data: ViewData): SettledViews {
  const { project, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const answerExits = exitResolver(project, dictionary, resolve, targetKey);
  const entryByKey = new Map(dictionary.map((e) => [e.id, e]));
  const legacy = new Set(project.competitors.map(matchKey));
  const labels = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));

  const base = (view: ViewKey, stage: SettledBase["stage"]) => {
    const { rows, uncoded, core } = poolOf(data, view);
    if (rows.length === 0 && uncoded === 0) return null;
    const n = rows.length;
    const resolved = rows.map((r) => answerExits(r.code.redirect_to));
    const tally = new Map<string, { name: string; role: ExitRole; n: number }>();
    for (const a of resolved)
      for (const [key, x] of a.exits) {
        const t = tally.get(key) ?? { name: x.name, role: x.role, n: 0 };
        t.n++;
        tally.set(key, t);
      }
    const verdictOf = (r: PoolRow) => r.code.relationship_verdict;
    const out: SettledBase & { rows: PoolRow[] } = {
      stage,
      rows,
      answers: n,
      uncoded,
      verdicts: enumCells(rows, RELATIONSHIPS, verdictOf),
      redirectsAny: cell(count(resolved, (a) => a.exits.size > 0), n),
      ownProduct: cell(count(resolved, (a) => a.ownProduct), n),
      redirects: [...tally.values()]
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
        .slice(0, TOP)
        .map((t) => ({ ...t, share: cell(t.n, n) })),
      byEngine: [...core]
        .map((m) => {
          const list = rows.filter((r) => r.model === m);
          return { key: m, label: labels.get(m) ?? m, answers: list.length, strengthens: cell(count(list, (r) => verdictOf(r) === "strengthens"), list.length) };
        })
        .filter((s) => s.answers > 0),
    };
    return out;
  };
  const strip = <T extends { rows: PoolRow[] }>(x: T): Omit<T, "rows"> => {
    const { rows: _rows, ...rest } = x;
    void _rows;
    return rest;
  };

  const bc = base("settled_business_case", "business_case");
  const businessCase: BusinessCaseView | null = bc
    ? { ...strip(bc), stage: "business_case", caseStrength: enumCells(bc.rows, ["strong", "hedged", "undermined"] as const, (r) => r.code.case_strength) }
    : null;

  const adv = base("settled_advocacy", "advocacy");
  const advocacy: AdvocacyView | null = adv
    ? (() => {
        const judged = adv.rows.filter((r) => ["confirms", "mixed", "rebuts"].includes(r.code.premise_verdict ?? ""));
        return {
          ...strip(adv),
          stage: "advocacy" as const,
          caseStrength: enumCells(adv.rows, ["strong", "partial", "concedes"] as const, (r) => r.code.case_strength),
          premise: enumCells(judged, ["confirms", "mixed", "rebuts"] as const, (r) => r.code.premise_verdict),
        };
      })()
    : null;

  const ex = base("settled_expansion", "expansion");
  const expansion: ExpansionView | null = ex
    ? { ...strip(ex), stage: "expansion", growth: enumCells(ex.rows, ["backs", "neutral", "redirects"] as const, (r) => r.code.growth_stance) }
    : null;

  const eco = base("settled_ecosystem", "ecosystem");
  let ecosystem: EcosystemView | null = null;
  if (eco) {
    const n = eco.rows.length;
    const acc = new Map<string, { name: string; role: ExitRole; resolved: boolean; answers: Set<string>; rel: Map<string, number> }>();
    let pairsAny = 0;
    for (const r of eco.rows) {
      const seen = new Set<string>();
      for (const p of r.code.pairings ?? []) {
        if (!p?.name) continue;
        const res = resolve(p.name);
        const active = res.status === "active";
        const key = active ? res.key : `?${matchKey(p.name)}`;
        const entry = active ? entryByKey.get(res.key) ?? null : null;
        const role: ExitRole = !active ? "outside" : entry && !entry.analyzed && res.key !== targetKey ? "outside" : roleOf(res.key, targetKey, entry, legacy);
        const a = acc.get(key) ?? { name: active ? res.name : p.name, role, resolved: active, answers: new Set<string>(), rel: new Map<string, number>() };
        a.rel.set(p.maker_relation, (a.rel.get(p.maker_relation) ?? 0) + 1);
        a.answers.add(r.code.response_id);
        acc.set(key, a);
        seen.add(key);
      }
      if (seen.size > 0) pairsAny++;
    }
    const majority = (m: Map<string, number>): MakerRelation => {
      const best = [...m.entries()].filter(([k]) => k === "own" || k === "third_party" || k === "substitute").sort((a, b) => b[1] - a[1])[0];
      return (best?.[0] as MakerRelation | undefined) ?? "third_party";
    };
    ecosystem = {
      ...strip(eco),
      stage: "ecosystem",
      pairsAny: cell(pairsAny, n),
      pairings: [...acc.values()]
        .sort((a, b) => b.answers.size - a.answers.size || a.name.localeCompare(b.name))
        .slice(0, TOP)
        .map((a) => ({ name: a.name, role: a.role, resolved: a.resolved, n: a.answers.size, share: cell(a.answers.size, n), makerRelation: majority(a.rel) })),
    };
  }

  return { runId: data.run.id, source: data.source, brand: project.brand, businessCase, expansion, ecosystem, advocacy };
}

// s1 (2026-11-01): first version - Set C verdict cards, context-judged names.
const SETTLED_VERSION = "s2";
export function computeSettledCached(run: Run, project: Project): Promise<SettledViews | null> {
  return cachedView("settled", SETTLED_VERSION, run, project, computeSettled, { judge: true });
}
