import { matchKey } from "../brand_key";
import { roleOf, type HeadlineBrand } from "./headline";
import { cell, type RateCell } from "./view_data";
import type { Resolver } from "./brand_resolve";
import type { DictionaryEntry, Project } from "../types";

/**
 * Destinations ("exits") shared by the views that read them - defensive
 * alternatives, objections, churn and renewal. Each answer's destinations
 * resolve through the current dictionary and dedupe per answer. A
 * destination resolving to the client is the brand's own product (offered,
 * never an exit). An exit to a ruled-out, pending, unknown or unanalyzed
 * name still counts as an exit; only its table row is hidden ("outside").
 * Exits are always reported paired with the answer's verdict.
 */

export type ExitRole = HeadlineBrand["role"] | "outside";

export interface AnswerExits {
  exits: Map<string, { name: string; role: ExitRole }>;
  ownProduct: boolean;
  /** Display names of this answer's outside exits. */
  outside: Set<string>;
}

export function exitResolver(project: Project, dictionary: DictionaryEntry[], resolve: Resolver, targetKey: string) {
  const entryByKey = new Map(dictionary.map((e) => [e.id, e]));
  const legacy = new Set(project.competitors.map(matchKey));
  return (destinations: string[] | null): AnswerExits => {
    const exits = new Map<string, { name: string; role: ExitRole }>();
    const outside = new Set<string>();
    let ownProduct = false;
    for (const d of destinations ?? []) {
      const r = resolve(d);
      if (r.key === targetKey) {
        ownProduct = true;
        continue;
      }
      if (r.status === "active") {
        const entry = entryByKey.get(r.key) ?? null;
        exits.set(r.key, { name: r.name, role: entry && !entry.analyzed ? "outside" : roleOf(r.key, targetKey, entry, legacy) });
      } else {
        exits.set(r.key, { name: r.name, role: "outside" });
        outside.add(r.name);
      }
    }
    return { exits, ownProduct, outside };
  };
}

export interface ExitRow<V extends string> {
  key: string;
  name: string;
  role: ExitRole;
  /** Answers offering it, over every answer in the view. */
  offered: RateCell;
  /** Answers offering it, by the answer's verdict (counts). */
  by: Record<V, number>;
}

/** One row per approved, analyzed exit brand, most offered first. */
export function exitRows<V extends string>(
  facts: { verdict: V; exits: AnswerExits["exits"] }[],
  verdicts: readonly V[]
): ExitRow<V>[] {
  const n = facts.length;
  const rows = new Map<string, { key: string; name: string; role: ExitRole; k: number; by: Record<V, number> }>();
  for (const f of facts) {
    for (const [key, x] of f.exits) {
      const r =
        rows.get(key) ??
        { key, name: x.name, role: x.role, k: 0, by: Object.fromEntries(verdicts.map((v) => [v, 0])) as Record<V, number> };
      r.k++;
      r.by[f.verdict]++;
      rows.set(key, r);
    }
  }
  return [...rows.values()]
    .filter((r) => r.role !== "outside")
    .map(({ k, ...r }) => ({ ...r, offered: cell(k, n) }))
    .sort((a, b) => b.offered.k - a.offered.k || a.name.localeCompare(b.name));
}

/** Outside exit names with the answers naming them, most first. */
export function outsideCounts(all: AnswerExits[], limit = 12): { name: string; n: number }[] {
  const m = new Map<string, number>();
  for (const a of all) for (const name of a.outside) m.set(name, (m.get(name) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, n]) => ({ name, n }));
}
