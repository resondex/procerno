import { ENGINES } from "./providers";
import { buildResolver } from "./brand_resolve";
import { cachedView, cell, poolOf, type PoolRow, type RateCell, type ViewData } from "./view_data";
import type { ViewKey } from "./views";
import type { Project, Run } from "../types";

/**
 * The awareness views (2026-10-28), visibility only - never a win or pick
 * rate (CODING_DECISIONS section 4 scoring split, section 12 rows 1-2).
 *
 * Problem recognition (awareness_routing): the asker has a problem and does
 * not yet know the category. Primary read: where the answer routes them -
 * category_routed category (to the tracked category) / adjacent (to a
 * different kind of solution: a fix, a habit, another kind of product) /
 * none. Then: the brand named, the brand recommended, and how often the AI
 * already points to products (any mention framed recommended - the
 * 2026-10-14 measurement that made gives_recommendation a derivable
 * shadow). Per room and per engine.
 *
 * Category education (awareness_explainer): the asker is learning what the
 * category is. Same fields; here only `adjacent` is a de-route (the plain
 * explainer routes nowhere), and points-to-products is the
 * sells-to-newcomers canary. One cell per tracker, so no room table.
 *
 * Both list the brands named (resolved through the dictionary and the
 * context judge; active entries only) and the topics taught (the confirmed
 * codebook under the discussed bar).
 */

export type { RateCell };

export type Route = "category" | "adjacent" | "none";
export const ROUTES: readonly Route[] = ["category", "adjacent", "none"];

export interface AwarenessSlice {
  key: string;
  label: string;
  answers: number;
  routed: Record<Route, RateCell>;
  namesYou: RateCell;
  recommendsYou: RateCell;
  pointsToProducts: RateCell;
}

export interface AwarenessBlock extends AwarenessSlice {
  view: "routing" | "explainer";
  uncoded: number;
  /** Room rows (problem recognition); one unlabeled row is dropped. */
  rooms: AwarenessSlice[];
  byEngine: AwarenessSlice[];
  /** Active brands named, by share of answers; `recommended` counts answers framing it recommended. */
  brands: { name: string; you: boolean; named: RateCell; recommended: number }[];
  topics: { code: string; cell: RateCell }[];
}

export interface AwarenessView {
  runId: string;
  source: string;
  brand: string;
  category: string;
  routing: AwarenessBlock | null;
  explainer: AwarenessBlock | null;
}

interface Facts {
  row: PoolRow;
  room: string;
  route: Route;
  namesYou: boolean;
  recommendsYou: boolean;
  points: boolean;
  /** Active brand key -> [name, framed recommended]. */
  named: Map<string, [string, boolean]>;
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

function slice(key: string, label: string, list: Facts[]): AwarenessSlice {
  const n = list.length;
  return {
    key,
    label,
    answers: n,
    routed: Object.fromEntries(ROUTES.map((r) => [r, cell(count(list, (f) => f.route === r), n)])) as Record<Route, RateCell>,
    namesYou: cell(count(list, (f) => f.namesYou), n),
    recommendsYou: cell(count(list, (f) => f.recommendsYou), n),
    pointsToProducts: cell(count(list, (f) => f.points), n),
  };
}

function block(data: ViewData, view: ViewKey, kind: AwarenessBlock["view"]): AwarenessBlock | null {
  const { rows: pool, uncoded, core } = poolOf(data, view);
  if (pool.length === 0 && uncoded === 0) return null;
  const resolve = buildResolver(data.dictionary, data.judged);
  const targetKey = resolve(data.project.brand).key;

  const facts: Facts[] = pool.map((row) => {
    const named = new Map<string, [string, boolean]>();
    let points = false;
    for (const m of row.code.mentions ?? []) {
      const rec = m.framing === "recommended";
      if (rec) points = true;
      const r = resolve(m.brand);
      if (r.status !== "active") continue;
      const prev = named.get(r.key);
      named.set(r.key, [r.name, (prev?.[1] ?? false) || rec]);
    }
    const c = row.code.category_routed;
    return {
      row,
      room: row.intent.situation ?? "",
      route: c === "category" || c === "adjacent" ? c : "none",
      namesYou: named.has(targetKey),
      recommendsYou: named.get(targetKey)?.[1] ?? false,
      points,
      named,
    };
  });
  const n = facts.length;

  const byRoom = new Map<string, Facts[]>();
  for (const f of facts) byRoom.set(f.room, [...(byRoom.get(f.room) ?? []), f]);
  const rooms = [...byRoom.entries()]
    .map(([room, list]) => slice(room, room || "No room", list))
    .sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));

  const brandCount = new Map<string, { name: string; named: number; recommended: number }>();
  for (const f of facts) {
    for (const [key, [name, rec]] of f.named) {
      const b = brandCount.get(key) ?? { name, named: 0, recommended: 0 };
      b.named += 1;
      if (rec) b.recommended += 1;
      brandCount.set(key, b);
    }
  }
  const topicCount = new Map<string, number>();
  for (const f of facts) for (const t of new Set(f.row.code.topics ?? [])) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);

  const labels = new Map(ENGINES.map((e) => [e.id, e.label]));
  return {
    ...slice(kind, kind, facts),
    view: kind,
    uncoded,
    rooms: rooms.length === 1 && rooms[0].key === "" ? [] : rooms,
    byEngine: [...core]
      .map((m) => slice(m, labels.get(m) ?? m, facts.filter((f) => f.row.model === m)))
      .filter((s) => s.answers > 0),
    brands: [...brandCount.entries()]
      .sort((a, b) => b[1].named - a[1].named || a[1].name.localeCompare(b[1].name))
      .slice(0, 12)
      .map(([key, b]) => ({ name: b.name, you: key === targetKey, named: cell(b.named, n), recommended: b.recommended })),
    topics: [...topicCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([code, k]) => ({ code, cell: cell(k, n) })),
  };
}

export function computeAwareness(data: ViewData): AwarenessView | null {
  const routing = block(data, "awareness_routing", "routing");
  const explainer = block(data, "awareness_explainer", "explainer");
  if (!routing && !explainer) return null;
  return {
    runId: data.run.id,
    source: data.source,
    brand: data.project.brand,
    category: data.project.category,
    routing,
    explainer,
  };
}

const AWARENESS_VERSION = "a1";
export function computeAwarenessCached(run: Run, project: Project): Promise<AwarenessView | null> {
  return cachedView("awareness", AWARENESS_VERSION, run, project, computeAwareness, { judge: true });
}
