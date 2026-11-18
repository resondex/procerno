/**
 * The payload types of "Question type detail" (the per-question-type sections under the Stations page), moved here
 * from the old per-type view engines when those were deleted (fact layer step 8, 2026-11-18). Pure types and two pure
 * helpers (roleOf, isDescription), so the browser and the fact layer can read them without any server import.
 *
 * Every RateCell in these payloads is a FactCell (facts/statements.ts: the counts plus the fact id) - built by
 * facts/type_detail.ts from the run's one fact book. A plain count rendered as a number carries its fact beside it
 * (`answersFact`, or a FactCell in place of the number).
 */
import { matchKey } from "../brand_key";
import type { DictionaryEntry } from "../types";
import type { EngineFacets, RateCell } from "./view_data";
import type { ViewKey } from "./views";

export type { RateCell };

/** By-engine rows pooled by AI company, by free or paid tier, by search on or off: each row its own fact scope (the
 * engine table's Group-by draws these instead of summing the member rows). Keys "v:<company>", "t:<tier>", "m:<mode>". */
export interface EngineGroups<T> {
  vendor: T[];
  tier: T[];
  mode: T[];
}

/** The fact id beside a plain count of answers (measure "answers": every answer in the scope). */
/** Selection ids beside the lists of an object: field name -> the selection(s) its names come from (facts/selections.ts),
 * so a check can recompute every list from its id. */
export type ListSels = Record<string, string[]>;

export interface Answered {
  answers: number;
  answersFact?: string;
}

/* ------------------------------- the open questions ------------------------------- */

export interface HeadlineBrand {
  key: string;
  name: string;
  role: "target" | "competitor" | "emerged";
  mentioned: RateCell;
  recommended: RateCell;
  chosen: RateCell;
  shareOfDecided: RateCell;
  negative: RateCell;
}

/** The target's rates inside one stage or one engine. */
export interface HeadlineSlice {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
  mentioned: RateCell;
  recommended: RateCell;
  chosen: RateCell;
  firmPickInCategory: RateCell;
}

export interface NamedCount {
  name: string;
  n: number;
}

export interface HeadlineView {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  runId: string;
  source: string;
  brand: string;
  /** Coded headline answers on the core panel - every rate's base. */
  answers: number;
  answersFact?: string;
  /** Headline answers on the core panel with no code row under the source. */
  uncoded: number;
  outcomes: { pick: RateCell; conditional: RateCell; no_pick: RateCell; clarification: RateCell };
  firmPick: RateCell;
  /** B5: picks whose top pick resolves to an active dictionary brand. */
  firmPickInCategory: RateCell;
  /** Picks by where the dictionary puts them (counts of every answer in the pool). */
  picks: {
    inCategory: RateCell;
    /** Resolved to a rejected entry - the board ruled the name out. */
    ruledOut: RateCell;
    pending: RateCell;
    notInDictionary: RateCell;
  };
  /** Active, analyzed brands named at least once, most-mentioned first. */
  brands: HeadlineBrand[];
  byStage: HeadlineSlice[];
  byEngine: (HeadlineSlice & EngineFacets)[];
  /** The by-engine rows pooled by AI company, tier and mode - each row its own fact scope. */
  byEngineGroups?: EngineGroups<HeadlineSlice & EngineFacets>;
}

export function roleOf(
  key: string,
  targetKey: string,
  entry: DictionaryEntry | null,
  legacyCompetitors: Set<string>
): HeadlineBrand["role"] {
  if (key === targetKey) return "target";
  if (entry?.role) return entry.role;
  return entry && legacyCompetitors.has(matchKey(entry.canonical)) ? "competitor" : "emerged";
}

/* ------------------------------- awareness ------------------------------- */

export type Route = "category" | "adjacent" | "none";
export const ROUTES: readonly Route[] = ["category", "adjacent", "none"];

export interface AwarenessSlice {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
  routed: Record<Route, RateCell>;
  namesYou: RateCell;
  recommendsYou: RateCell;
  pointsToProducts: RateCell;
}

/** One group of adjacent routing quotes. */
export interface WithoutGroup {
  label: string;
  cell: RateCell;
  ids: string[];
}

export interface AwarenessBlock extends AwarenessSlice {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  view: "routing" | "explainer";
  uncoded: number;
  /** Room rows (problem recognition); one unlabeled row is dropped. */
  rooms: AwarenessSlice[];
  byEngine: (AwarenessSlice & EngineFacets)[];
  /** The by-engine rows pooled by AI company, tier and mode - each row its own fact scope. */
  byEngineGroups?: EngineGroups<AwarenessSlice & EngineFacets>;
  /** Active brands named, by share of answers; `recommended` counts answers framing it recommended. */
  brands: { name: string; you: boolean; named: RateCell; recommended: RateCell }[];
  topics: { code: string; cell: RateCell }[];
  /** How the adjacent answers solve it, grouped from their quotes; shares are of the adjacent answers. */
  without: {
    groups: WithoutGroup[];
    /** Adjacent answers outside the shown groups. */
    rest: RateCell;
    /** Adjacent answers whose quote is empty. */
    noQuote: RateCell;
    /** embed = embeddings grouping; stems = the keyless fallback. */
    grouping: "embed" | "stems";
  };
}

export interface AwarenessView {
  runId: string;
  source: string;
  brand: string;
  category: string;
  routing: AwarenessBlock | null;
  explainer: AwarenessBlock | null;
}

/* ------------------------------- worries ------------------------------- */

export type ExitRole = HeadlineBrand["role"] | "outside";

export interface ExitRow<V extends string> {
  key: string;
  name: string;
  role: ExitRole;
  /** Answers offering it, over every answer in the view. */
  offered: RateCell;
  /** Of the answers with each verdict, the share offering it. */
  by: Record<V, RateCell>;
}

export type Premise = "confirms" | "mixed" | "rebuts";
export const PREMISES: readonly Premise[] = ["confirms", "mixed", "rebuts"];
export type ObjectionVerdict = "proceed" | "avoid" | "undecided";
export const OBJECTION_VERDICTS: readonly ObjectionVerdict[] = ["proceed", "avoid", "undecided"];
export type StayVerdict = "keep" | "leave" | "undecided";
export const STAY_VERDICTS: readonly StayVerdict[] = ["keep", "leave", "undecided"];

export interface WorryRow<V extends string> {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  key: string;
  stage: string;
  concern: string;
  answers: number;
  answersFact?: string;
  verdicts: Record<V, RateCell>;
  /** Over answers with a premise verdict. */
  premise: Record<Premise, RateCell>;
  /** Answers naming at least one exit (a destination that is not the client). */
  offersExit: RateCell;
  /** Exit names, most offered first. */
  topExits: { name: string; n: number }[];
}

export interface DoubtSlice<V extends string> {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
  verdicts: Record<V, RateCell>;
  confirms: RateCell;
  offersExit: RateCell;
}

export interface DoubtView<V extends string> {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  kind: "objections" | "keep_or_leave";
  brand: string;
  answers: number;
  answersFact?: string;
  uncoded: number;
  stages: string[];
  verdicts: Record<V, RateCell>;
  premise: Record<Premise, RateCell>;
  /** Rows = premise verdict, cells = share of that premise's answers per verdict. */
  matrix: Record<Premise, Record<V, RateCell>>;
  offersExit: RateCell;
  offersExitBy: Record<V, RateCell>;
  ownProduct: RateCell;
  rows: WorryRow<V>[];
  exits: ExitRow<V>[];
  outsideExits: { name: string; n: number }[];
  byEngine: (DoubtSlice<V> & EngineFacets)[];
  /** The by-engine rows pooled by AI company, tier and mode - each row its own fact scope. */
  byEngineGroups?: EngineGroups<DoubtSlice<V> & EngineFacets>;
  byStage: DoubtSlice<V>[];
}

export interface DoubtViews {
  runId: string;
  source: string;
  brand: string;
  objections: DoubtView<ObjectionVerdict> | null;
  keepOrLeave: DoubtView<StayVerdict> | null;
}

/* ------------------------------- switching and looking around ------------------------------- */

export interface CaptureRow {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  /** The rival being left: its dictionary entry id, "?" + name when
   * unresolved, or "generic" for cells that name no rival. */
  key: string;
  rival: string;
  resolved: boolean;
  answers: number;
  answersFact?: string;
  named: RateCell;
  recommended: RateCell;
  captured: RateCell;
  anotherBrand: RateCell;
  sameBrand: RateCell;
  outside: RateCell;
  undecided: RateCell;
  /** Who the firm picks went to, most first (resolved names). */
  captors: NamedCount[];
}

export interface CaptureSlice {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
  named: RateCell;
  captured: RateCell;
  undecided: RateCell;
}

export interface CaptorBrand {
  key: string;
  name: string;
  role: HeadlineBrand["role"];
  named: RateCell;
  chosen: RateCell;
  /** Chosen over the in-category picks (the same-brand returns included). */
  shareOfDecided: RateCell;
}

export interface OffensiveView {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  brand: string;
  answers: number;
  answersFact?: string;
  uncoded: number;
  overall: Omit<CaptureRow, "key" | "rival" | "resolved" | "answers" | "captors">;
  rows: CaptureRow[];
  captors: CaptorBrand[];
  outsidePicks: NamedCount[];
  byEngine: (CaptureSlice & EngineFacets)[];
  /** The by-engine rows pooled by AI company, tier and mode - each row its own fact scope. */
  byEngineGroups?: EngineGroups<CaptureSlice & EngineFacets>;
}

// ---------- defensive hold ----------

export interface Verdicts {
  keep: RateCell;
  leave: RateCell;
  undecided: RateCell;
}

export interface DestinationRow {
  key: string;
  name: string;
  /** "outside" = not an approved, analyzed brand (no row is shown). */
  role: HeadlineBrand["role"] | "outside";
  /** Answers offering it, over all defensive answers. */
  offered: RateCell;
  /** Answers offering it, by the answer's verdict (counts). */
  onKeep: number;
  onLeave: number;
  onUndecided: number;
  /** Question type detail: of the answers with each verdict, the share naming it (each a fact). */
  by?: { keep: RateCell; leave: RateCell; undecided: RateCell };
}

export interface HoldSlice {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
  verdicts: Verdicts;
  offersExit: RateCell;
}

export interface DefensiveView {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  brand: string;
  answers: number;
  answersFact?: string;
  uncoded: number;
  verdicts: Verdicts;
  /** Answers naming at least one exit (a destination that is not the client). */
  offersExit: RateCell;
  /** offersExit within each verdict. */
  offersExitBy: { keep: RateCell; leave: RateCell; undecided: RateCell };
  /** Answers listing the client's own product among the destinations. */
  ownProduct: RateCell;
  destinations: DestinationRow[];
  outsideDestinations: NamedCount[];
  byEngine: (HoldSlice & EngineFacets)[];
  /** The by-engine rows pooled by AI company, tier and mode - each row its own fact scope. */
  byEngineGroups?: EngineGroups<HoldSlice & EngineFacets>;
}

export interface AlternativesViews {
  runId: string;
  source: string;
  brand: string;
  offensive: OffensiveView | null;
  defensive: DefensiveView | null;
}

/* ------------------------------- price ------------------------------- */

export type Worth = "yes" | "depends" | "no";
export const WORTH: readonly Worth[] = ["yes", "depends", "no"];

export interface ValueRow {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  key: string;
  label: string;
  /** Rooms in this row (one for a room row, every room sharing the line for a line row). */
  rooms: string[];
  line: string | null;
  counterpart: string | null;
  answers: number;
  answersFact?: string;
  worth: Record<Worth, RateCell>;
  /** Of the "no" and "depends" answers, how many recommend another brand. */
  recommendsInstead: RateCell;
  /** Of the "no"/"depends" answers: share recommending the brand's own cheaper line or plan (a mention resolving to the target whose surface form is not the bare brand name, or that names the row's counterpart when the counterpart is the brand's own). */
  ownRung: RateCell;
  /** Rivals (own: false, top `limit`) then the brand's own options (own: true, top 3), most named first. */
  instead: InsteadEntry[];
}

export interface InsteadEntry {
  name: string;
  n: number;
  /** True = the brand's own line or plan (the own rung). */
  own: boolean;
}

export interface ValueSlice {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
  worth: Record<Worth, RateCell>;
}

export interface ValueView {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  runId: string;
  source: string;
  brand: string;
  answers: number;
  answersFact?: string;
  uncoded: number;
  worth: Record<Worth, RateCell>;
  recommendsInstead: RateCell;
  /** Of the "no"/"depends" answers: share recommending the brand's own cheaper line or plan (a mention resolving to the target whose surface form is not the bare brand name, or that names the row's counterpart when the counterpart is the brand's own). */
  ownRung: RateCell;
  /** Rivals (own: false, top 10) then the brand's own options (own: true, top 5), most named first. */
  instead: InsteadEntry[];
  rooms: ValueRow[];
  lines: ValueRow[];
  byEngine: (ValueSlice & EngineFacets)[];
  /** The by-engine rows pooled by AI company, tier and mode - each row its own fact scope. */
  byEngineGroups?: EngineGroups<ValueSlice & EngineFacets>;
}


export interface ValueFact {
  worth: Worth;
  instead: Map<string, string>;
  own: Map<string, string>;
}

const DESCRIPTOR = /\b(cheaper|cheapest|lower[- ]cost|low[- ]cost|no[- ](annual[- ])?fee|basic|budget|entry[- ]level|affordable|less expensive|more affordable)\b/i;
export function isDescription(surface: string): boolean {
  return /^(a|an|the)\s/i.test(surface) || /\d+\s?%/.test(surface) || /\bflat[- ]rate\b/i.test(surface) || DESCRIPTOR.test(surface);
}

/* ------------------------------- premium vs basic, habit ------------------------------- */

export type Stance = "premium" | "basic" | "balanced" | "none";
export const STANCES: readonly Stance[] = ["premium", "basic", "balanced", "none"];

export interface StanceRow {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  key: Stance;
  answers: number;
  answersFact?: string;
  share: RateCell;
  namesYou: RateCell;
  recommendsYou: RateCell;
  picksYou: RateCell;
  firmPick: RateCell;
  /** Active brands recommended in answers advocating this end. */
  recommended: { name: string; you: boolean; n: number }[];
}

export interface PremiumSlice {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
  stance: Record<Stance, RateCell>;
  picksYou: RateCell;
}

export interface PremiumView {
  runId: string;
  source: string;
  brand: string;
  category: string;
  answers: number;
  answersFact?: string;
  uncoded: number;
  stance: Record<Stance, RateCell>;
  namesYou: RateCell;
  recommendsYou: RateCell;
  picksYou: RateCell;
  firmPick: RateCell;
  byStance: StanceRow[];
  byEngine: (PremiumSlice & EngineFacets)[];
  /** The by-engine rows pooled by AI company, tier and mode - each row its own fact scope. */
  byEngineGroups?: EngineGroups<PremiumSlice & EngineFacets>;
}

export type Verdict = "stick" | "switch" | "open";
export const VERDICTS: readonly Verdict[] = ["stick", "switch", "open"];

export interface RepertoireSlice {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
  verdict: Record<Verdict, RateCell>;
  recommendsYou: RateCell;
  recommendsOther: RateCell;
}

export interface RepertoireView extends RepertoireSlice {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  runId: string;
  source: string;
  brand: string;
  uncoded: number;
  /** Brands picked instead of the client. */
  switchTo: { name: string; n: number }[];
  /** Other brands recommended, on any answer. */
  alsoRecommended: { name: string; n: number; share: RateCell }[];
  byEngine: (RepertoireSlice & EngineFacets)[];
  /** The by-engine rows pooled by AI company, tier and mode - each row its own fact scope. */
  byEngineGroups?: EngineGroups<RepertoireSlice & EngineFacets>;
}

/* ------------------------------- settled customers ------------------------------- */

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
  /** n over every answer in the stage (a brand in analysis only: a name outside it is not counted as a brand). */
  share?: RateCell;
}

export interface SettledPairing extends SettledNamed {
  /** Majority maker relation across the answers pairing it. */
  makerRelation?: MakerRelation;
  /** True when the name resolves to an active dictionary entry. */
  resolved?: boolean;
}

export interface SettledSlice {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
  strengthens: RateCell;
}

export interface SettledBase {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  stage: "business_case" | "expansion" | "ecosystem" | "advocacy";
  answers: number;
  answersFact?: string;
  uncoded: number;
  verdicts: Record<Relationship, RateCell>;
  /** Answers naming at least one redirect that is not the client. */
  redirectsAny: RateCell;
  /** Answers whose redirects include the client's own product. */
  ownProduct: RateCell;
  /** Redirect brands, most named first (top 10). */
  redirects: SettledNamed[];
  byEngine: (SettledSlice & EngineFacets)[];
  /** The by-engine rows pooled by AI company, tier and mode - each row its own fact scope. */
  byEngineGroups?: EngineGroups<SettledSlice & EngineFacets>;
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
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
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

/* ------------------------------- the arguments ------------------------------- */

export interface ReasonVerdict {
  key: string;
  label: string;
  answers: number;
  answersFact?: string;
}

/** A view key, or a stage sub-type of the open-choice pool
 * ("headline:discovery" ...): the stage split exists only there (Tyler, 2026-11-01). */
export type ReasonTypeKey = ViewKey | `headline:${string}` | "social_validation" | "premium_worth";

export interface ReasonType {
  key: ReasonTypeKey;
  label: string;
  answers: number;
  answersFact?: string;
  /** Answers whose reasons list is empty. */
  noReason: RateCell;
  verdicts: ReasonVerdict[];
}

export interface ReasonRow {
  /** The code, or the group's name on a group row. */
  key: string;
  label: string;
  isGroup: boolean;
  /** Member codes (a code row lists itself). */
  codes: string[];
  /** The group a code row belongs to, when the map places it. */
  group: string | null;
  /** Pooled over every type except criteria. */
  pooled: RateCell;
  byType: Partial<Record<ReasonTypeKey, RateCell>>;
  /** type -> verdict -> incidence among that verdict's answers. */
  byVerdict: Partial<Record<ReasonTypeKey, Record<string, RateCell>>>;
  /**
   * Group rows only: per type, the member codes leaning toward the type's
   * first verdict and toward its second, present only when both sides hold one.
   */
  mixed: Partial<Record<ReasonTypeKey, { toward: string[]; away: string[] }>>;
}

export interface ReasonsView {
  /** Where each list's names come from (selection ids). */
  sels?: ListSels;
  runId: string;
  source: string;
  brand: string;
  /** Answers in the pooled column (every type except criteria). */
  pooledAnswers: number;
  pooledFact?: string;
  types: ReasonType[];
  codes: ReasonRow[];
  /** null when the project has no code_groups map. */
  groups: ReasonRow[] | null;
  /** Map entries that name no confirmed code. */
  unknownGroupCodes: string[];
}
