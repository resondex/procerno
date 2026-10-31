import { store } from "../store";
import { computeHeadlineCached, type HeadlineView } from "./headline";
import { computeAwarenessCached } from "./awareness";
import { computeHeadToHeadCached } from "./head_to_head";
import { computeAlternativesCached } from "./alternatives";
import { computeDoubtCached } from "./doubt";
import { computeValueCached } from "./value";
import { computeRepertoireCached } from "./repertoire";
import { viewsOf } from "./views";
import type { RateCell } from "./view_data";
import type { Project, Run } from "../types";

export type { RateCell };

/**
 * The Journey map (2026-10-30, WORKBENCH_REDESIGN_2026-10-30.md item 1):
 * six stations, each with one leak number distilled from the per-type view
 * engines it groups. Nothing is computed here that a view does not already
 * compute - every number is read off a cached view payload, so the map is a
 * cache hit once the views have been opened.
 *
 * Stations are independent populations - each is its own set of questions
 * asked of its own answers - never stages one buyer walks through. Their
 * numbers sit side by side; none is a share of another.
 *
 * Station mapping (ratified):
 * - Awareness: problem recognition (room-pinned) + category education
 *   (one cell, all buyers). Lead: problem recognition names you.
 * - Consideration: the headline pool (discovery, use-case, social
 *   validation, premium vs basic; criteria is depth with no number).
 *   Lead: chosen, beside mentioned - the mentioned -> chosen leak.
 * - Comparison: head-to-heads (entity, pooled across rivals for the map;
 *   class apart) and rival leavers. Lead: entity you-win rate.
 * - Doubts: buyers' worries. Lead: go-ahead rate.
 * - Value: Lead: worth-it rate.
 * - Customer base: customers' worries, holding your own, repertoire.
 *   Lead: customers' worries stay rate.
 *
 * The buyer filter (?room=): headline, awareness and value take the room
 * and keep that room's cells only (poolOf's strict rule). Every other
 * number - head-to-heads since s10, the worries module, rival leavers,
 * holding your own, repertoire, category education, social validation,
 * premium vs basic - is never asked in one buyer's voice, so under a room
 * filter it is returned at its all-buyers value with `invariant: true`,
 * never hidden and never presented as the room's.
 */

export type StationKey = "awareness" | "consideration" | "comparison" | "doubts" | "value" | "customer_base";

export interface JourneyMetric {
  key: string;
  label: string;
  cell: RateCell;
  /** Measured across all buyers by design - the room filter does not reach it. */
  invariant: boolean;
}

export interface JourneyStation {
  key: StationKey;
  label: string;
  /** The station's leak number; null when the tracker asks no question of this kind. */
  lead: JourneyMetric | null;
  /** Companion numbers, lead excluded. */
  metrics: JourneyMetric[];
  /** Every number on the station is measured across all buyers by design. */
  invariant: boolean;
}

export interface JourneyView {
  runId: string;
  source: string;
  brand: string;
  category: string;
  /** The buyer filter applied; null = all buyers. */
  room: string | null;
  /** Every room (cell situation) the instrument asks in, in setup order. */
  rooms: string[];
  stations: JourneyStation[];
}

const m = (key: string, label: string, cell: RateCell, invariant: boolean): JourneyMetric => ({ key, label, cell, invariant });

/** A station from its metrics, lead first. */
function station(key: StationKey, label: string, metrics: JourneyMetric[]): JourneyStation {
  const [lead = null, ...rest] = metrics;
  return { key, label, lead, metrics: rest, invariant: metrics.length > 0 && metrics.every((x) => x.invariant) };
}

/** The target's rates inside one headline stage, for the invariant stages under a room filter. */
function stageMetric(view: HeadlineView | null, stage: string, label: string): JourneyMetric[] {
  const s = view?.byStage.find((x) => x.key === stage);
  return s && s.answers > 0 ? [m(`${stage}_chosen`, label, s.chosen, true)] : [];
}

/** Distinct rooms in setup order, from cells that route to a view. */
async function roomsOf(project: Project): Promise<string[]> {
  const intents = await store.listIntents(project.id);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of [...intents].sort((a, b) => a.seq - b.seq)) {
    if (!it.situation || seen.has(it.situation) || viewsOf(it.stage, it.angle).length === 0) continue;
    seen.add(it.situation);
    out.push(it.situation);
  }
  return out;
}

export async function computeJourney(run: Run, project: Project, room?: string): Promise<JourneyView | null> {
  const filtered = room !== undefined;
  const [headline, headlineAll, awareness, awarenessAll, h2h, alts, doubt, value, repertoire, rooms] = await Promise.all([
    computeHeadlineCached(run, project, room),
    filtered ? computeHeadlineCached(run, project) : Promise.resolve(null),
    computeAwarenessCached(run, project, room),
    filtered ? computeAwarenessCached(run, project) : Promise.resolve(null),
    computeHeadToHeadCached(run, project),
    computeAlternativesCached(run, project),
    computeDoubtCached(run, project),
    computeValueCached(run, project, room),
    computeRepertoireCached(run, project),
    roomsOf(project),
  ]);
  // Every view reads the same codes source; no source = nothing coded to map.
  const any = headline ?? headlineAll ?? h2h ?? doubt ?? alts;
  if (!any) return null;

  // Awareness: problem recognition is room-pinned; category education is
  // one all-buyers cell (absent from a filtered awareness payload).
  const pr = awareness?.routing && awareness.routing.answers > 0 ? awareness.routing : null;
  const ceSource = filtered ? awarenessAll?.explainer : awareness?.explainer;
  const ce = ceSource && ceSource.answers > 0 ? ceSource : null;
  const awarenessMetrics: JourneyMetric[] = [
    ...(pr
      ? [
          m("pr_names", "Problem recognition - names you", pr.namesYou, false),
          m("pr_category", `Problem recognition - told to get ${project.category}`, pr.routed.category, false),
        ]
      : []),
    ...(ce ? [m("ce_names", "Category education - names you", ce.namesYou, true)] : []),
  ];

  // Consideration: the headline pool. Filtered, the pool is the room's
  // discovery + use-case; the all-buyers stages ride beside it.
  const target = headline && headline.answers > 0 ? headline.brands.find((b) => b.role === "target") : undefined;
  const considerationMetrics: JourneyMetric[] = target
    ? [
        m("chosen", "Chosen", target.chosen, false),
        m("mentioned", "Mentioned", target.mentioned, false),
        m("share_of_decided", "Share of decided", target.shareOfDecided, false),
      ]
    : [];
  if (filtered) {
    considerationMetrics.push(
      ...stageMetric(headlineAll, "social_validation", "Social validation - chosen"),
      ...stageMetric(headlineAll, "premium_worth", "Premium vs basic - chosen")
    );
  }

  // Comparison: entity head-to-heads pooled across rivals for the map; class and leavers beside.
  const entity = h2h?.entity && h2h.entity.answers > 0 ? h2h.entity : null;
  const klass = h2h?.class && h2h.class.answers > 0 ? h2h.class : null;
  const offensive = alts?.offensive && alts.offensive.answers > 0 ? alts.offensive : null;
  const comparisonMetrics: JourneyMetric[] = [
    ...(entity ? [m("h2h_won", "Head-to-head - you win", entity.overall.won, true)] : []),
    ...(klass ? [m("h2h_class_won", "Against a class - you win", klass.overall.won, true)] : []),
    ...(offensive ? [m("leavers_captured", "Rival leavers - picks you", offensive.overall.captured, true)] : []),
  ];

  // Doubts: buyers' worries.
  const obj = doubt?.objections && doubt.objections.answers > 0 ? doubt.objections : null;
  const doubtMetrics: JourneyMetric[] = obj
    ? [
        m("go_ahead", "Go ahead", obj.verdicts.proceed, true),
        m("avoid", "Avoid", obj.verdicts.avoid, true),
        m("agrees", "Agrees with the worry", obj.premise.confirms, true),
      ]
    : [];

  // Value: worth it over a cheaper option.
  const val = value && value.answers > 0 ? value : null;
  const valueMetrics: JourneyMetric[] = val
    ? [m("worth_it", "Worth it", val.worth.yes, false), m("not_worth_it", "Not worth it", val.worth.no, false)]
    : [];

  // Customer base: customers' worries first; holding your own and repertoire beside.
  const keep = doubt?.keepOrLeave && doubt.keepOrLeave.answers > 0 ? doubt.keepOrLeave : null;
  const defensive = alts?.defensive && alts.defensive.answers > 0 ? alts.defensive : null;
  const rep = repertoire && repertoire.answers > 0 ? repertoire : null;
  const customerMetrics: JourneyMetric[] = [
    ...(keep
      ? [m("worries_stay", "Customers' worries - stay", keep.verdicts.keep, true), m("worries_leave", "Customers' worries - leave", keep.verdicts.leave, true)]
      : []),
    ...(defensive ? [m("hold_stay", "Weighing a move - stay", defensive.verdicts.keep, true)] : []),
    ...(rep ? [m("repertoire_stick", "Repertoire - stick with you", rep.verdict.stick, true)] : []),
  ];

  return {
    runId: run.id,
    source: any.source,
    brand: project.brand,
    category: project.category,
    room: room ?? null,
    rooms,
    stations: [
      station("awareness", "Awareness", awarenessMetrics),
      station("consideration", "Consideration", considerationMetrics),
      station("comparison", "Comparison", comparisonMetrics),
      station("doubts", "Doubts", doubtMetrics),
      station("value", "Value", valueMetrics),
      station("customer_base", "Customer base", customerMetrics),
    ],
  };
}
