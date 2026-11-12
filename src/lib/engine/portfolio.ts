import { buildResolver, type Resolver } from "./brand_resolve";
import { parentKey } from "./parent_suggest";
import { cachedView, cell, poolOf, requestOf, type RateCell, type ViewData, type ViewRequest } from "./view_data";
import type { AnswerCodes, DictionaryEntry, Project, Run } from "../types";

/**
 * The portfolio view (pf1, 2026-11-11): the headline pool rolled up by
 * parent company, so sister brands read as one portfolio. Same pool, same
 * read-time resolution and same brand set as the headline view
 * (headline.ts): open-choice answers on the core panel, active analyzed
 * brands the pool names, plus the target.
 *
 * A company is a dictionary parent label (exact label, the Parents tab's
 * grouping); a brand with no parent is its own single-member company, and
 * a parentless brand whose own name IS a parent label (the company's own
 * brand) joins that company. Rates never sum members:
 * - named / recommended: an answer counts ONCE if any member is named /
 *   recommended (per-answer union);
 * - share of picks: answers whose pick resolves to any member, over
 *   in-category picks (a pick has one brand, so this IS the members' sum).
 * With no parents anywhere the rows are exactly the headline's brand rows.
 */

export type { RateCell };

export interface PortfolioMember {
  key: string;
  name: string;
  you: boolean;
  named: RateCell;
  shareOfPicks: RateCell;
}

export interface PortfolioCompany {
  /** "p:" + parentKey of the label, or "b:" + the brand's entry key. */
  key: string;
  name: string;
  you: boolean;
  /** The row is a parent label (vs. a parentless brand standing alone). */
  isParent: boolean;
  members: PortfolioMember[];
  named: RateCell;
  recommended: RateCell;
  shareOfPicks: RateCell;
}

export interface PortfolioView {
  runId: string;
  source: string;
  brand: string;
  /** Coded headline answers on the core panel - named/recommended's base. */
  answers: number;
  /** Picks resolving to an active dictionary brand - share of picks' base. */
  inCategoryPicks: number;
  /** False when no active analyzed brand has a parent: the UI shows nothing. */
  hasParents: boolean;
  /** Most picks first; the client's company carries you: true. */
  companies: PortfolioCompany[];
}

interface Facts {
  named: Set<string>;
  recommended: Set<string>;
  pickKey: string | null;
}

/** The headline's per-answer facts (headline.ts factsOf), picks and
 * mentions resolved through the current dictionary. */
function factsOf(c: AnswerCodes, resolve: Resolver): Facts {
  const named = new Set<string>();
  const recommended = new Set<string>();
  for (const m of c.mentions ?? []) {
    const r = resolve(m.brand);
    if (r.status !== "active") continue;
    named.add(r.key);
    if (m.framing === "recommended") recommended.add(r.key);
  }
  let pickKey: string | null = null;
  if (c.outcome === "pick" && c.top_pick) {
    const r = resolve(c.top_pick);
    if (r.status === "active") {
      pickKey = r.key;
      named.add(r.key);
      recommended.add(r.key);
    }
  }
  return { named, recommended, pickKey };
}

export function computePortfolio(data: ViewData, request: ViewRequest = {}): PortfolioView {
  const { run, project, source, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged);
  const targetKey = resolve(project.brand).key;
  const { rows } = poolOf(data, "headline", request);
  const facts = rows.map(({ code }) => factsOf(code, resolve));
  const n = facts.length;
  const inCategoryPicks = facts.filter((f) => f.pickKey !== null).length;

  // The brand set: as the headline (named at least once, analyzed, + target).
  const entryByKey = new Map<string, DictionaryEntry>(dictionary.map((e) => [e.id, e]));
  const seen = new Set<string>([targetKey]);
  for (const f of facts) for (const k of f.named) seen.add(k);
  const brandKeys = [...seen].filter((k) => {
    const e = entryByKey.get(k);
    return k === targetKey || !e || e.analyzed;
  });
  const nameOf = (k: string) => {
    const e = entryByKey.get(k);
    return e ? e.display_name ?? e.canonical : project.brand;
  };

  // Companies: exact parent labels; a parentless brand whose own name is a
  // label joins that company.
  const hasParents = dictionary.some((e) => e.status === "active" && e.analyzed && !!e.parent?.trim());
  const labelByKey = new Map<string, string>();
  for (const e of dictionary) {
    const p = e.status === "active" ? e.parent?.trim() : null;
    if (p && !labelByKey.has(parentKey(p))) labelByKey.set(parentKey(p), p);
  }
  const companyOf = new Map<string, { key: string; name: string; isParent: boolean }>();
  for (const k of brandKeys) {
    const e = entryByKey.get(k);
    const p = e?.parent?.trim();
    if (p) {
      const pk = parentKey(p);
      companyOf.set(k, { key: `p:${pk}`, name: labelByKey.get(pk) ?? p, isParent: true });
      continue;
    }
    const forms = e ? [e.canonical, e.display_name ?? "", ...e.aliases].filter(Boolean) : [project.brand];
    const own = forms.map(parentKey).find((pk) => labelByKey.has(pk));
    companyOf.set(k, own ? { key: `p:${own}`, name: labelByKey.get(own)!, isParent: true } : { key: `b:${k}`, name: nameOf(k), isParent: false });
  }

  const groups = new Map<string, { name: string; isParent: boolean; members: string[] }>();
  for (const k of brandKeys) {
    const c = companyOf.get(k)!;
    const g = groups.get(c.key) ?? { name: c.name, isParent: c.isParent, members: [] };
    g.members.push(k);
    groups.set(c.key, g);
  }

  const companies: PortfolioCompany[] = [];
  for (const [key, g] of groups) {
    const set = new Set(g.members);
    let named = 0;
    let rec = 0;
    let picks = 0;
    const mNamed = new Map<string, number>();
    const mPicks = new Map<string, number>();
    for (const f of facts) {
      let anyNamed = false;
      let anyRec = false;
      for (const k of g.members) {
        if (f.named.has(k)) {
          anyNamed = true;
          mNamed.set(k, (mNamed.get(k) ?? 0) + 1);
        }
        if (f.recommended.has(k)) anyRec = true;
      }
      if (anyNamed) named++;
      if (anyRec) rec++;
      if (f.pickKey !== null && set.has(f.pickKey)) {
        picks++;
        mPicks.set(f.pickKey, (mPicks.get(f.pickKey) ?? 0) + 1);
      }
    }
    const members: PortfolioMember[] = g.members
      .map((k) => ({
        key: k,
        name: nameOf(k),
        you: k === targetKey,
        named: cell(mNamed.get(k) ?? 0, n),
        shareOfPicks: cell(mPicks.get(k) ?? 0, inCategoryPicks),
      }))
      .sort((a, b) => b.shareOfPicks.k - a.shareOfPicks.k || b.named.k - a.named.k || a.name.localeCompare(b.name));
    companies.push({
      key,
      name: g.name,
      you: set.has(targetKey),
      isParent: g.isParent,
      members,
      named: cell(named, n),
      recommended: cell(rec, n),
      shareOfPicks: cell(picks, inCategoryPicks),
    });
  }
  companies.sort(
    (a, b) => b.shareOfPicks.k - a.shareOfPicks.k || b.named.k - a.named.k || a.name.localeCompare(b.name)
  );
  return { runId: run.id, source, brand: project.brand, answers: n, inCategoryPicks, hasParents, companies };
}

const PORTFOLIO_VERSION = "pf1";
export function computePortfolioCached(run: Run, project: Project, request: ViewRequest = {}): Promise<PortfolioView | null> {
  const r = requestOf(request, true);
  return cachedView("portfolio", PORTFOLIO_VERSION, run, project, (d) => computePortfolio(d, r), { judge: true }, r);
}
