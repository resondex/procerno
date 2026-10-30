import { SCHEMA_FIELDS, type CodeSchema, type ViewKey } from "./views";

/**
 * The legality layer (2026-10-30, WORKBENCH_REDESIGN_2026-10-30.md): the ONE
 * place that knows which measures each pool's schema asks. The Metrics
 * pivot, and every analysis lens after it, reads the wb2 fact table through
 * this module, so no surface can render a number its pool never asked -
 * a worth-it rate on head-to-heads, a premise mix on business cases, a
 * firm-pick rate on doubts.
 *
 * Pure data and pure functions (no store, no node imports): the server
 * encodes rows with the codec below, the browser decodes and measures with
 * the same constants.
 *
 * Two rules decide legality, both mechanical:
 *   1. a measure names the code fields it reads (`requires`); it is legal on
 *      a pool only when EVERY schema routing into that pool asks every one of
 *      them (SCHEMA_FIELDS, the contract's own per-schema field list);
 *   2. a measure whose VALUES exist on only some schemas (case strength's
 *      "hedged" is business-case vocabulary, "concedes" advocacy's) or whose
 *      read needs a pool-specific fact (a head-to-head's named rival) narrows
 *      itself with `only`.
 * Pools are never pooled with each other (the presentation rule, 2026-09-27):
 * a measure is always computed inside one pool.
 */

// ---------------------------------------------------------------- the wb2 row codec

/** The verdict fields the fact table carries, in row order. */
export const VERDICT_FIELDS = [
  "outcome",
  "tier_stance",
  "worth_it",
  "proceed_or_avoid",
  "keep_or_leave",
  "premise_verdict",
  "category_routed",
  "relationship_verdict",
  "case_strength",
  "growth_stance",
] as const;
export type VerdictField = (typeof VERDICT_FIELDS)[number];

/** Each verdict's value list; the row stores the index. Off-list values
 * (premise "n/a", an empty asked field) store NO_VALUE. case_strength
 * carries both Set C vocabularies (business case strong/hedged/undermined,
 * advocacy strong/partial/concedes). Outcome keeps wb1's order. */
export const VERDICT_VALUES: Record<VerdictField, readonly string[]> = {
  outcome: ["pick", "conditional", "no_pick", "clarification"],
  tier_stance: ["premium", "basic", "balanced", "none"],
  worth_it: ["yes", "depends", "no"],
  proceed_or_avoid: ["proceed", "avoid", "undecided"],
  keep_or_leave: ["keep", "leave", "undecided"],
  premise_verdict: ["confirms", "rebuts", "mixed"],
  category_routed: ["category", "adjacent", "none"],
  relationship_verdict: ["strengthens", "neutral", "weakens"],
  case_strength: ["strong", "hedged", "undermined", "partial", "concedes"],
  growth_stance: ["backs", "neutral", "redirects"],
};

/** The field is not part of the row's schema. */
export const NOT_ASKED = -1;
/** Asked, but no on-list value (null, "n/a", unrecognized). */
export const NO_VALUE = -2;
/** Pick slot: a firm pick outside the category (not an active brand). */
export const PICK_OUTSIDE = -2;
/** Destination slot: an exit to a name outside the active dictionary. */
export const DEST_OUTSIDE = -2;

export const VERDICT_INDEX = Object.fromEntries(VERDICT_FIELDS.map((f, i) => [f, i])) as Record<VerdictField, number>;

export function encodeVerdict(field: VerdictField, value: string | null | undefined, asked: boolean): number {
  if (!asked) return NOT_ASKED;
  const i = value == null ? -1 : VERDICT_VALUES[field].indexOf(value);
  return i >= 0 ? i : NO_VALUE;
}

/** [brand index, framing bits (1 = recommended, 2 = negative)], ordered by
 * first appearance in the answer. */
export type WbMention = [number, number];

/**
 * One coded answer on the core panel:
 * [engine, prompt, response, pick, mentions, args, verdicts, dests]
 * - response: index into the payload's `responseIds` (the evidence drill).
 * - pick: brand index of a firm in-category top pick; PICK_OUTSIDE for a
 *   firm pick outside it; -1 = no firm pick (or not asked).
 * - mentions: as wb1 (the crowned brand always counts as recommended).
 * - args: index into `args` - reasons, or topics on the awareness schemas
 *   (each schema asks one or the other, never both).
 * - verdicts: aligned with VERDICT_FIELDS; NOT_ASKED / NO_VALUE / index.
 * - dests: destinations (alternatives, doubts) or redirect_to (Set C) - no
 *   schema asks both - as brand indexes, the client's own product included;
 *   DEST_OUTSIDE once for any exit outside the active dictionary.
 */
export type WbRow = [number, number, number, number, WbMention[], number[], number[], number[]];
export const R = { engine: 0, prompt: 1, response: 2, pick: 3, mentions: 4, args: 5, verdicts: 6, dests: 7 } as const;

/** The prompt metadata a measure may read (the payload's prompt shape). */
export interface MeasurePrompt {
  views: ViewKey[];
  /** Brand index of the cell's named rival (head-to-heads, rival leavers),
   * or of a class cell's class brand; -1 = none. */
  rival: number;
}

// ---------------------------------------------------------------- pools

/** The schemas that route into each view (views.ts schemaOf x viewsOf). */
export const VIEW_SCHEMAS: Record<ViewKey, readonly CodeSchema[]> = {
  headline: ["choice", "premium"],
  premium_tier: ["premium"],
  repertoire: ["choice"],
  head_to_head_entity: ["choice"],
  head_to_head_class: ["choice"],
  offensive_capture: ["choice"],
  defensive_hold: ["alt_defensive"],
  value: ["value"],
  criteria_taught: ["criteria"],
  awareness_routing: ["awareness_pr"],
  awareness_explainer: ["awareness_ce"],
  doubt: ["objections"],
  keep_or_leave: ["churn_renewal"],
  settled_business_case: ["business_case"],
  settled_expansion: ["expansion"],
  settled_ecosystem: ["ecosystem"],
  settled_advocacy: ["advocacy"],
};

/** Pools in journey order, with the labels the views use. */
export const POOLS: readonly { key: ViewKey; label: string }[] = [
  { key: "awareness_routing", label: "Awareness - problem recognition" },
  { key: "awareness_explainer", label: "Awareness - category education" },
  { key: "headline", label: "Open choice" },
  { key: "criteria_taught", label: "Criteria" },
  { key: "premium_tier", label: "Premium vs basic" },
  { key: "head_to_head_entity", label: "Head-to-head - rivals" },
  { key: "head_to_head_class", label: "Head-to-head - classes" },
  { key: "offensive_capture", label: "Rival leavers" },
  { key: "doubt", label: "Buyers' worries" },
  { key: "value", label: "Value" },
  { key: "keep_or_leave", label: "Customers' worries" },
  { key: "defensive_hold", label: "Holding your own" },
  { key: "repertoire", label: "Repertoire" },
  { key: "settled_business_case", label: "Business case" },
  { key: "settled_expansion", label: "Expansion" },
  { key: "settled_ecosystem", label: "Ecosystem" },
  { key: "settled_advocacy", label: "Advocacy" },
];
export const POOL_LABEL = Object.fromEntries(POOLS.map((p) => [p.key, p.label])) as Record<ViewKey, string>;

/** "arguments" = the row's args slot: reasons, or topics on awareness. */
export type MeasureField = string;

/** Does every schema of the pool ask this field? */
export function poolAsks(view: ViewKey, field: MeasureField): boolean {
  return VIEW_SCHEMAS[view].every((s) => {
    const f = SCHEMA_FIELDS[s];
    return field === "arguments" ? f.includes("reasons") || f.includes("topics") : f.includes(field);
  });
}

// ---------------------------------------------------------------- measures

/** What a measure is evaluated against, beyond the row itself. */
export interface MeasureCtx {
  target: number;
  /** The brand (or a parent's member brands) a brand measure reads. */
  brands: Set<number>;
  /** The argument index an incidence measure reads; -1 = none chosen. */
  arg: number;
  prompt: MeasurePrompt;
}

export interface MeasureDef {
  id: string;
  label: string;
  /** Picker grouping. */
  group: string;
  /** Definition and denominator, shown as the picker's tooltip. */
  tip: string;
  /** Code fields read - every pool schema must ask all of them. */
  requires: readonly MeasureField[];
  /** Pools the measure's values exist on (narrows rule 1). */
  only?: readonly ViewKey[];
  /** Brand-relative: reads ctx.brands (the brand selector or dimension). */
  brand?: boolean;
  /** Incidence: reads ctx.arg (the argument selector or dimension). */
  arg?: boolean;
  /** 1 = counts in the numerator, 0 = denominator only, null = outside the
   * denominator. */
  calc: (row: WbRow, ctx: MeasureCtx) => 0 | 1 | null;
}

const H2H: readonly ViewKey[] = ["head_to_head_entity", "head_to_head_class"];
const b = (x: boolean): 0 | 1 => (x ? 1 : 0);
const verdictOf = (row: WbRow, f: VerdictField) => row[R.verdicts][VERDICT_INDEX[f]] ?? NOT_ASKED;
const valueIndex = (f: VerdictField, v: string) => VERDICT_VALUES[f].indexOf(v);
const named = (row: WbRow, brands: Set<number>) => row[R.mentions].some(([i]) => brands.has(i));

/** A verdict-value share over the answers where the field is asked
 * (`valued`: only over answers carrying an on-list value - the premise
 * read, where "n/a" is no verdict rather than a fourth one). */
function share(
  field: VerdictField,
  values: string[],
  meta: Omit<MeasureDef, "calc" | "requires" | "group"> & { group?: string; valued?: boolean }
): MeasureDef {
  const hits = new Set(values.map((v) => valueIndex(field, v)));
  return {
    group: meta.group ?? field,
    requires: [field],
    ...meta,
    calc: (row) => {
      const v = verdictOf(row, field);
      if (v === NOT_ASKED) return null;
      if (meta.valued && v < 0) return null;
      return b(hits.has(v));
    },
  };
}

export const MEASURES: readonly MeasureDef[] = [
  // Brand measures - per brand, any pool (mentions ride every schema; picks
  // only where top_pick is asked).
  {
    id: "mentioned", group: "Brand", label: "Named", brand: true, requires: ["mentions"],
    tip: "Answers naming the brand, over every answer in the cell.",
    calc: (row, c) => b(named(row, c.brands)),
  },
  {
    id: "recommended", group: "Brand", label: "Recommended", brand: true, requires: ["mentions"],
    tip: "Answers recommending the brand (framed recommended, or crowned), over every answer in the cell.",
    calc: (row, c) => b(row[R.mentions].some(([i, bits]) => c.brands.has(i) && (bits & 1) === 1)),
  },
  {
    id: "chosen", group: "Brand", label: "Chosen (top pick)", brand: true, requires: ["top_pick"],
    tip: "Answers whose single top pick is the brand, over every answer in the cell.",
    calc: (row, c) => b(c.brands.has(row[R.pick])),
  },
  {
    id: "share_of_decided", group: "Brand", label: "Share of decided", brand: true, requires: ["top_pick"],
    tip: "The brand's top picks over answers with a firm in-category pick.",
    calc: (row, c) => (row[R.pick] >= 0 ? b(c.brands.has(row[R.pick])) : null),
  },
  {
    id: "negative", group: "Brand", label: "Negative framing", brand: true, requires: ["mentions"],
    tip: "Answers framing the brand negatively, over answers naming it.",
    calc: (row, c) => {
      const ms = row[R.mentions].filter(([i]) => c.brands.has(i));
      return ms.length === 0 ? null : b(ms.some(([, bits]) => (bits & 2) === 2));
    },
  },
  {
    id: "named_first", group: "Brand", label: "Named first", brand: true, requires: ["mentions"],
    tip: "Answers naming the brand before any other tracked brand, over answers naming it.",
    calc: (row, c) => (named(row, c.brands) ? b(c.brands.has(row[R.mentions][0][0])) : null),
  },

  // The choice outcome.
  share("outcome", ["pick"], { id: "firm_pick", group: "Outcome", label: "Firm pick", tip: "Answers making one firm pick, over every answer." }),
  share("outcome", ["conditional"], { id: "conditional", group: "Outcome", label: "Conditional", tip: "Answers whose pick depends on the buyer's situation, over every answer." }),
  share("outcome", ["no_pick"], { id: "no_pick", group: "Outcome", label: "No pick", tip: "Answers that pick nothing, over every answer." }),
  share("outcome", ["clarification"], { id: "clarification", group: "Outcome", label: "Asks to clarify", tip: "Answers that ask the buyer for more before picking, over every answer." }),
  {
    id: "out_of_category", group: "Outcome", label: "Picks outside the category", requires: ["top_pick"],
    tip: "Firm picks of a name outside the approved dictionary, over every answer.",
    calc: (row) => b(row[R.pick] === PICK_OUTSIDE),
  },

  // Head-to-heads: the named rival is a fact of the cell.
  {
    id: "h2h_you", group: "Head-to-head", label: "You win", requires: ["top_pick"], only: H2H,
    tip: "Answers whose top pick is you, over every answer.",
    calc: (row, c) => b(row[R.pick] === c.target),
  },
  {
    id: "h2h_rival", group: "Head-to-head", label: "Rival wins", requires: ["top_pick"], only: H2H,
    tip: "Answers whose top pick is the rival (or class brand) the question names, over every answer.",
    calc: (row, c) => b(c.prompt.rival >= 0 && row[R.pick] === c.prompt.rival),
  },
  {
    id: "h2h_other", group: "Head-to-head", label: "Another pick", requires: ["top_pick"], only: H2H,
    tip: "Answers picking a third name, neither you nor the named rival, over every answer.",
    calc: (row, c) => b(row[R.pick] !== -1 && row[R.pick] !== c.target && row[R.pick] !== c.prompt.rival),
  },
  {
    id: "h2h_two_way", group: "Head-to-head", label: "Two-way record", requires: ["top_pick"], only: H2H,
    tip: "Your wins over answers picking you or the named rival.",
    calc: (row, c) => {
      const p = row[R.pick];
      if (p === c.target) return 1;
      return c.prompt.rival >= 0 && p === c.prompt.rival ? 0 : null;
    },
  },

  // Repertoire: a habitual buyer asks stick or switch.
  {
    id: "rep_stick", group: "Repertoire", label: "Sticks with you", requires: ["top_pick"], only: ["repertoire"],
    tip: "Answers whose top pick is you, over every answer.",
    calc: (row, c) => b(row[R.pick] === c.target),
  },
  {
    id: "rep_switch", group: "Repertoire", label: "Switches", requires: ["top_pick"], only: ["repertoire"],
    tip: "Answers whose top pick is another name, over every answer.",
    calc: (row, c) => b(row[R.pick] !== -1 && row[R.pick] !== c.target),
  },

  // Premium vs basic.
  share("tier_stance", ["premium"], { id: "tier_premium", group: "Tier", label: "Go premium", tip: "Answers backing the premium tier, over every answer." }),
  share("tier_stance", ["basic"], { id: "tier_basic", group: "Tier", label: "Go basic", tip: "Answers backing the basic tier, over every answer." }),
  share("tier_stance", ["balanced"], { id: "tier_balanced", group: "Tier", label: "Depends", tip: "Answers splitting by situation, over every answer." }),
  share("tier_stance", ["none"], { id: "tier_none", group: "Tier", label: "No tier stance", tip: "Answers taking no tier stance, over every answer." }),

  // Value.
  share("worth_it", ["yes"], { id: "worth_yes", group: "Value", label: "Worth it", tip: "Answers calling the line worth its price over a cheaper option, over every answer." }),
  share("worth_it", ["depends"], { id: "worth_depends", group: "Value", label: "Depends", tip: "Answers saying it depends, over every answer." }),
  share("worth_it", ["no"], { id: "worth_no", group: "Value", label: "Not worth it", tip: "Answers calling the line not worth its price, over every answer." }),
  {
    id: "worth_another", group: "Value", label: "Recommends another", requires: ["worth_it", "mentions"],
    tip: "Of the not-worth-it and depends answers, those recommending another brand.",
    calc: (row, c) => {
      const v = verdictOf(row, "worth_it");
      if (v !== valueIndex("worth_it", "no") && v !== valueIndex("worth_it", "depends")) return null;
      return b(row[R.mentions].some(([i, bits]) => i !== c.target && (bits & 1) === 1));
    },
  },

  // Doubts.
  share("proceed_or_avoid", ["proceed"], { id: "proceed", group: "Buyers' worries", label: "Go ahead", tip: "Answers telling the worried buyer to go ahead, over every answer." }),
  share("proceed_or_avoid", ["avoid"], { id: "avoid", group: "Buyers' worries", label: "Avoid", tip: "Answers telling the worried buyer to avoid you, over every answer." }),
  share("proceed_or_avoid", ["undecided"], { id: "proceed_undecided", group: "Buyers' worries", label: "No side", tip: "Answers taking no side, over every answer." }),
  share("keep_or_leave", ["keep"], { id: "keep", group: "Keep or leave", label: "Stay", tip: "Answers telling the customer to stay, over every answer." }),
  share("keep_or_leave", ["leave"], { id: "leave", group: "Keep or leave", label: "Leave", tip: "Answers telling the customer to leave, over every answer." }),
  share("keep_or_leave", ["undecided"], { id: "keep_undecided", group: "Keep or leave", label: "No side", tip: "Answers taking no side, over every answer." }),
  share("premise_verdict", ["confirms"], { id: "premise_confirms", group: "Premise", label: "Agrees with the worry", valued: true, tip: "Answers confirming the doubt, over answers with a premise verdict." }),
  share("premise_verdict", ["rebuts"], { id: "premise_rebuts", group: "Premise", label: "Rebuts the worry", valued: true, tip: "Answers rebutting the doubt, over answers with a premise verdict." }),
  share("premise_verdict", ["mixed"], { id: "premise_mixed", group: "Premise", label: "Splits on the worry", valued: true, tip: "Answers partly confirming the doubt, over answers with a premise verdict." }),
  {
    id: "exit_named", group: "Exits", label: "Names an exit", requires: ["destinations"],
    tip: "Answers naming somewhere to go other than you, over every answer.",
    calc: (row, c) => b(row[R.dests].some((d) => d !== c.target)),
  },
  {
    id: "own_offered", group: "Exits", label: "Offers your own product", requires: ["destinations"],
    tip: "Answers offering another of your own products as the way out, over every answer.",
    calc: (row, c) => b(row[R.dests].includes(c.target)),
  },

  // Awareness.
  share("category_routed", ["category"], { id: "routed_category", group: "Awareness", label: "Routes to the category", tip: "Answers sending the asker toward your category, over every answer." }),
  share("category_routed", ["adjacent"], { id: "routed_adjacent", group: "Awareness", label: "Routes elsewhere", tip: "Answers sending the asker toward another kind of solution, over every answer." }),
  share("category_routed", ["none"], { id: "routed_none", group: "Awareness", label: "Explains only", tip: "Answers that inform without routing, over every answer." }),

  // Settled customers (Set C).
  share("relationship_verdict", ["strengthens"], { id: "rel_strengthens", group: "Relationship", label: "Strengthens", tip: "Answers strengthening the customer relationship, over every answer." }),
  share("relationship_verdict", ["neutral"], { id: "rel_neutral", group: "Relationship", label: "Neutral", tip: "Answers leaving the relationship where it is, over every answer." }),
  share("relationship_verdict", ["weakens"], { id: "rel_weakens", group: "Relationship", label: "Weakens", tip: "Answers weakening the relationship, over every answer." }),
  share("case_strength", ["strong"], { id: "case_strong", group: "Case strength", label: "Strong case", only: ["settled_business_case", "settled_advocacy"], tip: "Answers making a strong case for you, over every answer." }),
  share("case_strength", ["hedged"], { id: "case_hedged", group: "Case strength", label: "Hedged case", only: ["settled_business_case"], tip: "Business cases that hedge, over every answer." }),
  share("case_strength", ["undermined"], { id: "case_undermined", group: "Case strength", label: "Undermined case", only: ["settled_business_case"], tip: "Business cases the answer undermines, over every answer." }),
  share("case_strength", ["partial"], { id: "case_partial", group: "Case strength", label: "Partial case", only: ["settled_advocacy"], tip: "Advocacy answers arming only part of the case, over every answer." }),
  share("case_strength", ["concedes"], { id: "case_concedes", group: "Case strength", label: "Concedes to the critic", only: ["settled_advocacy"], tip: "Advocacy answers conceding the critic's point, over every answer." }),
  share("growth_stance", ["backs"], { id: "growth_backs", group: "Expansion", label: "Backs growth", tip: "Answers backing growth with you, over every answer." }),
  share("growth_stance", ["neutral"], { id: "growth_neutral", group: "Expansion", label: "Neutral on growth", tip: "Answers neutral on growing with you, over every answer." }),
  share("growth_stance", ["redirects"], { id: "growth_redirects", group: "Expansion", label: "Redirects growth", tip: "Answers redirecting growth elsewhere, over every answer." }),
  {
    id: "redirects_away", group: "Relationship", label: "Redirects to another brand", requires: ["redirect_to"],
    tip: "Answers redirecting the customer to a name other than you, over every answer.",
    calc: (row, c) => b(row[R.dests].some((d) => d !== c.target)),
  },

  // Arguments: incidence of one code (reasons, or topics on awareness).
  {
    id: "argues", group: "Arguments", label: "Argues it", arg: true, requires: ["arguments"],
    tip: "Answers carrying the argument (reasons; topics taught on awareness questions), over every answer.",
    calc: (row, c) => (c.arg < 0 ? null : b(row[R.args].includes(c.arg))),
  },
];

export const MEASURE_BY_ID = new Map(MEASURES.map((m) => [m.id, m]));

/** Why a measure cannot be read on a pool; null = legal. */
export function illegalReason(m: MeasureDef, view: ViewKey): string | null {
  if (m.only && !m.only.includes(view)) return "not asked on this pool";
  if (!m.requires.every((f) => poolAsks(view, f))) return "not asked on this pool";
  return null;
}

export const isLegal = (m: MeasureDef, view: ViewKey) => illegalReason(m, view) === null;

/** The pools a measure can be read on, in journey order. */
export const legalPools = (m: MeasureDef): ViewKey[] => POOLS.map((p) => p.key).filter((k) => isLegal(m, k));

/** The legal measures per pool - the map the report and tests read. */
export function measuresByPool(): Record<ViewKey, string[]> {
  return Object.fromEntries(
    POOLS.map((p) => [p.key, MEASURES.filter((m) => isLegal(m, p.key)).map((m) => m.id)])
  ) as Record<ViewKey, string[]>;
}
