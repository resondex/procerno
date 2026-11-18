import type { RateCell } from "./view_data";
import type { DossierTheme } from "./reason_themes";

/**
 * The analysis tier's contract (2026-11-03, ANALYSIS_REDESIGN_2026-11-03.md,
 * ratified from the clickable prototype): the coverage map is BANDED BY WHAT
 * EACH CONTEST VARIES BY - buyer rooms, named rivals, confirmed worries,
 * settled-customer questions - so every cell is a real contest and blank
 * cells cannot occur. Each cell opens a POSITION: claim, taker, status with
 * a triage suggestion, the arguments and conditions behind it, receipts,
 * and a lever into the playbook. These types are shared by the map engine
 * (analysis_map.ts), the decision record (store + route) and the UI, so the
 * three stay on one shape.
 */

/** Who holds the cell. "nocall" is a verdict (the AI takes no side), never
 * missing data; thin cells (small n) also read nocall with the count in n. */
export type CellVerdict = "yours" | "contested" | "theirs" | "nocall";

/** wall: lost to a possession, not an argument (route around, don't
 * out-argue). leak: picks leave the category (B5). inhouse: caught by the
 * brand's own cheaper rung (value ownRung). watch: the number reads better
 * than the standing (asked-for advocacy, one-engine dependence). */
export type CellBadge = "wall" | "leak" | "inhouse" | "watch";

export interface MapCell {
  /** Stable id, also the position key and the decision-record key:
   * "<band>:<stage>:<key>" with key the room / rival / worry / question in
   * canonical form. Stable across waves so the portfolio can track it. */
  id: string;
  /** The contest's own name in the customer's vocabulary: the room (with
   * its Value line where one applies), the rival, the worry, the settled
   * question. Empty on a full-width cell whose row names it. */
  label: string;
  verdict: CellVerdict;
  /** One short line under the verdict word - plain words, percentages
   * allowed, raw counts stay in n (the tooltip). */
  note: string;
  badges: CellBadge[];
  /** Spans its whole row (rival leavers, holding your own, criteria). */
  wide?: boolean;
  /** The row's pooled roll-up cell (key "all"), rendered first with a divider
   * after it; set only when the row also carries split cells. */
  all?: boolean;
  /** am27: a head-to-head lost on balance whose position carries `exception`. */
  exception?: true;
  /** Answers behind the cell (the tooltip's denominator). */
  n: number;
}

export interface MapRow {
  stage: string;
  cells: MapCell[];
}

export interface MapBand {
  title: string;
  sub: string;
  rows: MapRow[];
}

/** The engine's read of what the brand IS to the AI, classified from
 * measured facts (share of decided vs top rival, the prompted-vs-open gap,
 * condition breadth). Sentences are templates filled with typed facts -
 * never generated prose. */
export type Archetype = "default" | "specialist" | "reference" | "challenger" | "companion";

export interface CastingLine {
  archetype: Archetype;
  /** The archetype as a heading, e.g. "The specialist". */
  heading: string;
  /** One italic sentence: how the AI casts the brand. */
  casting: string;
  /** One supporting sentence with the two or three numbers behind it. */
  detail: string;
}

export type Triage =
  | "record_wrong"
  | "proof_missing"
  | "strategy_misfit"
  | "product_truth"
  | "earned"
  | "overclaimed"
  | "windfall";

export const TRIAGE_LABEL: Record<Triage, string> = {
  record_wrong: "Record is wrong",
  proof_missing: "Proof is missing",
  strategy_misfit: "Strategy misfit",
  product_truth: "Product truth",
  earned: "Earned",
  overclaimed: "Overclaimed",
  windfall: "Windfall",
};

/** Deficit triage answers "is the AI right about you?"; surplus triage
 * answers "is the standing earned?" (the portfolio playbook's two sides). */
export const DEFICIT_TRIAGES: readonly Triage[] = ["record_wrong", "proof_missing", "strategy_misfit", "product_truth"];
export const SURPLUS_TRIAGES: readonly Triage[] = ["earned", "overclaimed", "windfall"];

export type PositionStatus = "deficit" | "surplus" | "watch";

export interface PositionReceipt {
  responseId: string;
  /** The code row's quote where one exists - the verdict's own receipt. */
  quote?: string;
}

/** am15 (the one-panel redesign, 2026-11-10): a pointer into one answer for
 * the panel's inline passages - the UI fetches the body lazily
 * (/api/runs/[id]/answer_bodies) and highlights `find` in it
 * (answer_passage.ts passageOf): the answer's own wording of a condition, a
 * code label, or the code row's quote. Never the body itself. */
export interface AnswerRef {
  responseId: string;
  find: string;
  /** am21: on a reason-row example, the product(s) this answer's rules under
   * the row send the buyer to - the modal's "Sent to" line. */
  to?: string;
  /** am27: on a "lost, with an exception" example, the brand the answer
   * actually picked - the modal's "Picked" line. */
  picked?: string;
}

/** am27 (2026-11-12): one condition the AI still gives for choosing you in a
 * head-to-head it hands to the rival. share = of the lost answers. */
export interface ExceptionItem {
  text: string;
  share: string;
  /** A situation the buyer is already in (the possession test). Set only when true. */
  wall?: true;
  /** Answers that picked the rival and state this condition toward you. */
  refs?: AnswerRef[];
  tip?: string;
}

/** am27: a head-to-head lost on balance where the AI still assigns you an
 * exception in at least half of the lost answers. */
export interface PositionException {
  /** The rival that wins the matchup. */
  rival: string;
  /** Share of the lost answers stating any condition toward you. */
  lostShare: string;
  /** Counts for the tooltip. */
  tip: string;
  rows: ExceptionItem[];
}

/** One brand's share of a pick contest (Position.brands). */
export interface PositionBrand {
  name: string;
  /** Its share of the in-category picks here - the same number the
   * "Share of the picks here, by brand" figure states. */
  share: string;
  /** Up to 3 quoted answers where it is the pick, spread across engines. */
  proof: PositionReceipt[];
  /** am20: the brand inside this one contest - the rival panel's lead read. */
  here?: RivalHere;
}

/** am20 (2026-11-12): one brand's funnel inside one contest. Every share is of
 * the contest's answers except `converts` (its picks per recommendation).
 * Counts ride `tips` only; `refs` open the answers behind each number. */
export interface BrandRead {
  named: string;
  recommended: string;
  picked: string;
  converts: string;
  tips: { named: string; recommended: string; picked: string; converts: string };
  refs: { named?: AnswerRef[]; recommended?: AnswerRef[]; picked?: AnswerRef[] };
}

/** am20: a rival inside one contest - how it gets its picks here, what the AI
 * argues when it picks it, and which buyers the AI sends to it. */
export interface RivalHere {
  read: BrandRead;
  /** compare: what comes up more when it is picked than when you are (value =
   * its-picks share minus your-picks share; liftSides ["its picks", "your picks"]);
   * alone: you are picked too rarely here to compare, so the share of its pick
   * answers arguing each code (argsRows); absent: too few picks of its own. */
  argsMode?: "compare" | "alone";
  args?: LiftItem[];
  argsRows?: ArgsRow[];
  /** The conditions on the buyer that send picks to it here, share of the
   * answers here that send buyers to it with any stated condition. */
  sends: ConditionItem[];
  /** Share of the contest's answers that send buyers to it with a stated condition. */
  sendsShare?: string;
  /** am22: the same, in the run's reason themes (dt4): the away pool scoped
   * to this contest's questions and to answers whose rule in the group sends
   * the buyer to it; shares are of those answers. Present (possibly empty)
   * whenever the theme map exists - then `sends` is only a fallback. */
  sendsThemes?: DossierTheme[];
}

/** What the panel's "What the AI says about the <category>" section draws:
 * compare = the two-sided lifts (Position.lifts; argsRows absent); rival =
 * your side is under the lift floor, so the share of the rival-pick answers
 * arguing each code; all = no pick on either side, so the share of the
 * contest's answers arguing each code; topics = the schema codes topics, not
 * reasons (awareness, learning the category). */
export type ArgsMode = "compare" | "rival" | "all" | "topics";

export interface ArgsRow {
  label: string;
  share: string;
  receipts: AnswerRef[];
}

/** The badges' meaning as data for the panel's plain sentences. */
export interface PositionNotes {
  /** The top possession-shaped away condition's wording (the wall badge). */
  wall?: string;
  inHouse?: true;
  leak?: true;
  /** one_assistant: one engine carries your side (watch); asked_for: the
   * settled-customer number appears only when the asker sets the side. */
  soft?: "one_assistant" | "asked_for";
}

/** Where an away condition (or theme) sends buyers: an active brand and its
 * share of the condition's answers that name a destination. */
export interface RouteShare {
  name: string;
  share: string;
}

export interface LiftItem {
  label: string;
  /** Signed points (argued-in-your-wins minus argued-in-rival-wins, or the
   * band's own signed read); drawn as bars about zero. */
  value: number;
  /** am11: the two shares behind the bar, formatted like the brief's own
   * sentences ("31%"), for the row's sub-line; the tip carries the counts.
   * Absent on payloads cached before am11. */
  wins?: string;
  others?: string;
  tip?: string;
  /** am15: one answer that picks you (the lift's first side) and one that
   * picks a rival (its second), both arguing the code, when available. */
  receipts?: AnswerRef[];
}

export interface ConditionItem {
  text: string;
  /** Grouped answer count, approximate by construction. */
  n: number;
  wall?: boolean;
  /** am15: answer-grain share of the contest's rule-bearing answers stating it. */
  share?: string;
  /** am15: up to 2 answers stating it (different engines), find = their own wording. */
  receipts?: AnswerRef[];
  /** am15, away side only: the active brands it sends buyers to - top 3 with
   * >= 15% of its answers that name a destination, and at least 2 answers. */
  routes?: RouteShare[];
}

/** am21: one stated condition the AI gives in this contest on BOTH sides -
 * sending some buyers to you and others away - at similar rates. Shares are of
 * the contest's rule-bearing answers, like ConditionItem.share. */
export interface BothWaysItem {
  text: string;
  towardShare: string;
  awayShare: string;
  /** Up to 2 answers per side, each with where it sends the buyer. */
  towardRefs?: AnswerRef[];
  awayRefs?: AnswerRef[];
  /** The active rivals the away side sends buyers to (ConditionItem.routes rule). */
  routes?: RouteShare[];
}

export interface Position {
  cellId: string;
  /** "Open choice · Premium traveler" - the cell's address in words. */
  where: string;
  /** The claim with its tension inline - one template sentence. */
  claim: string;
  /** Who takes the cell: a rival, the category default, the undecided mass,
   * the brand's own rung, out-of-category, or nobody. */
  taker: string;
  takerKind: string;
  status: PositionStatus;
  triageSuggested: Triage;
  /** One or two sentences: why the engine suggests that triage. */
  triageWhy: string;
  lifts: LiftItem[];
  liftNote?: string;
  /** am11: what the two sides of the lift are ("your picks", "rivals' picks")
   * - the sub-line's words. */
  liftSides?: [string, string];
  toward: ConditionItem[];
  away: ConditionItem[];
  /** am21: conditions stated on both sides at similar rates (absent when none). */
  bothWays?: BothWaysItem[];
  /** am13 (option D): the reasons as the dossier's theme trees, scoped to
   * this cell's questions - each share is of the cell's questions where the
   * AI gives buyers any reason that way. Absent keyless, on a failed theme
   * pass, or when no reason that way touches the cell (flat lists render). */
  towardThemes?: DossierTheme[];
  awayThemes?: DossierTheme[];
  receipts: PositionReceipt[];
  /** The move as plain sentences (am15) - a template per triage. */
  lever: string;
  /** The move's name in plain words (am15), e.g. "Publish your case". */
  family: string;
  /** "The numbers" (2026-11-06, the citation ruling): every figure a brief
   * cites from this cell, stated plainly - label left, value right; counts
   * stay in `tip` (the hover). Recomputed from the cell's own pool, or the
   * identical stat where the brief reads the summary. Additive. am10
   * (2026-11-07): cell-scoped only - the brief's brand, engines and condition
   * answer cards carry the figures that are not this cell's question. */
  figures?: { label: string; value: string; tip?: string }[];
  /** am15: the in-category pick split of a pick contest (open choice, social
   * validation, premium vs basic, rivals' customers switching) - the top 5
   * rivals by share, the figure's own numbers. Present only when at least two
   * brands (you included) clear BRAND_FLOOR picks. */
  brands?: PositionBrand[];
  /** Your share of the same picks (present with `brands`). */
  youShare?: string;
  /** am20: your own funnel in this contest, beside each rival's `here.read`. */
  youRead?: BrandRead;
  /** am15: which arguments block the panel draws (absent when none has content). */
  argsMode?: ArgsMode;
  /** am15: top 5 rows for argsMode rival / all / topics. */
  argsRows?: ArgsRow[];
  /** am15: the badges' meaning for the panel's sentences (cells keep `badges`). */
  notes?: PositionNotes;
  /** am27: lost, with an exception (head-to-head cells only; see PositionException). */
  exception?: PositionException;
  /** am31 (the panel build): the per-question-type panel. Absent on cells the
   * old panels still draw (PANEL_BUILD_SPEC section 0). */
  panel?: PositionPanel;
  /** am31: the served map's stand-in for `panel` (slimAnalysisMap). The map
   * route leaves the panel bodies out; the slide-over loads one cell's panel
   * (its rivals included) from /api/runs/[id]/cell_panel when it opens. */
  panelStub?: PanelStub;
}

/** The one payload the Map and Verdict tabs read (positions ride along so
 * a cell click never refetches). */
export interface AnalysisMapView {
  casting: CastingLine;
  /** The brand's two-dot line and who-wins-instead bars (open choice). */
  dots: { named: RateCell; picked: RateCell };
  /** am19 (2026-11-11): the Overview's headline numbers open their answers -
   * up to 5 each, spread across assistants. named = open-choice answers that
   * name the brand; commits = answers that commit to one in-category pick
   * (the "picked" numbers read the brand's own shareOfDecided row's refs). */
  examples?: { named: AnswerRef[]; commits: AnswerRef[] };
  /** refs (am19): answers whose pick resolves to this brand (for "Others",
   * to any brand the board folds into it). */
  shareOfDecided: { brand: string; you: boolean; share: RateCell; refs?: AnswerRef[] }[];
  /** The 3-5 highest-ranked tensions as memo paragraphs, each pointing at
   * a map cell. */
  tensions: {
    /** am62: the finding's identity - the insight key, or "known_vs_picked" for the opening funnel paragraph
     * (the Overview leaves that one out: its header already states those numbers). */
    key: string;
    title: string;
    body: string;
    cellId: string;
    /** am62: the move written for this finding (finding_moves.ts), else the placed cell's lever; `repeat` = the
     * same sentence as a move above it (the Overview shows the family and "Same move as above"). */
    move: { family: string; text: string; repeat?: true };
    /** 2026-11-10 (am17): the finding card's small chart - 2-4 bars of the
     * numbers the sentence states (value 0-100, text as the sentence prints
     * it, hi = the one row the finding is about). Absent when the finding has
     * no clean numeric rows. */
    viz?: {
      label: string;
      value: number;
      text: string;
      hi?: true;
      /** am19: the answers behind the bar's numerator, when the finding has them in hand. */
      refs?: AnswerRef[];
      /** am62: whose number - you (blue), a named rival (pink), anything else (grey). */
      who?: "you" | "rival" | "other";
    }[];
    /** bs23 (2026-11-13): an unasked_rival finding's rival (dictionary entry
     * key + name) - the Overview card offers "Ask this matchup" for it. */
    matchup?: { key: string; name: string };
  }[];
  bands: MapBand[];
  positions: Record<string, Position>;
  /** Pool answers with no code row under the source (honesty line). */
  uncoded: number;
  /** Every served insight (the summary's list) placed on a map cell by the
   * tensions' matcher, generic fallbacks included; only ids present in the
   * map. Match by key AND title - a detector can serve more than one. */
  insightCells?: { key: string; title: string; cellId: string }[];
  /** am31 round 2 (full compute only): each rival across every question type;
   * the served map drops it (slimAnalysisMap) and /rival_panel serves one. */
  rivalPanels?: RivalAcross[];
  /** The served map's stand-in for rivalPanels: the names that carry one. */
  rivalStubs?: string[];
}

/** projects.analysis_decision - the gate pattern (recommended vs decided),
 * one record per project, additive like taxonomy_decision. Keys are cell
 * ids; a cell absent from the record carries the engine's suggestion. */
export interface AnalysisDecisionEntry {
  suggested: Triage;
  decided?: Triage;
  decidedAt?: string;
  inPlaybook?: boolean;
  addedAt?: string;
}

export interface AnalysisDecision {
  v: 1;
  positions: Record<string, AnalysisDecisionEntry>;
}

/* ------------- am31 (panel build): the per-question-type panels ------------- */

export type PanelKind =
  | "buy" | "h2h" | "switching" | "buyer_worry" | "customer_worry" | "looking_around"
  | "value" | "problem" | "criteria" | "expansion" | "business_case"
  // am31 round 2: What's popular, Learning the category, What to use alongside you, Answering a critic.
  | "popular" | "learning" | "alongside" | "critic"
  // am59: Premium vs basic.
  | "premium"
  // am60: Habit (repertoire).
  | "habit"
  // am61: Your customers making your case - All questions (an index to the four questions under it).
  | "settled_all";

/** One piece of a sentence. A span with refs is a stated number or fact that
 * opens its answers (ruling 7); no refs = plain text. tip = counts (hover only). */
export interface PanelSpan {
  t: string;
  refs?: AnswerRef[];
  tip?: string;
  /** A stable name for the one number this span holds (stat ids, stat_registry.ts): "you", "avg", "usual" ... Never drawn. */
  key?: string;
  /** The fact the number is (fact layer: measure | subject | scope). Never drawn. */
  fact?: string;
  /** The span is a name (a product as written): a figure inside it ("Spark 1.5% Cash Select") is part of the name,
   * never a number on the card. Never drawn. */
  name?: true;
}
export type PanelText = PanelSpan[];

/** One number on a panel. refs absent <=> not clickable (0%, or nothing to show). */
export interface PanelNum {
  value: string;     // "47%" | "<1%" | "0%" (pctOf)
  pct: number;       // 0-100, one decimal, bar width only
  tip: string;       // "47 of 100 answers" - the only place counts appear
  refs?: AnswerRef[]; // <= PANEL_REFS (3), spreadRefs / pickRefs, one per assistant first
  /** The fact the number is looked up as (fact layer, FACT_LAYER_DESIGN_2026-11-17.md: "measure|subject|scope", or
   * "avg(<measure>)|<selection id>" for the average competitor). Never drawn. */
  fact?: string;
}

/** The "Other" row of a card's competitor group (ratified 2026-11-17): every brand in analysis the group does not
 * list. Inside it, the brands named in 10% of the answers or picked 5 times (sorted by this block's own number), the
 * rest as one "N more brands" line. Closed by default. */
export interface PanelOther {
  rows: { name: string; num: PanelNum }[];
  /** "3 more brands" - the brands under the floor, as a count. */
  rest?: string;
  /** The selection the list is (fact layer, layer 3). Never drawn. */
  selection?: string;
}

export type PanelStepKey =
  | "named" | "recommended" | "converts"   // funnel (buy, switching, problem, rival)
  | "category"                             // problem: the answer is about the category at all
  | "decided" | "won"                      // h2h
  | "agrees" | "verdict"                   // worries, looking around
  | "offers"                               // looking around: shows another product
  | "worth" | "instead"                    // value
  | "taught" | "gap"                       // criteria
  | "stance"                               // expansion (growth_stance)
  | "strength"                             // business case (case_strength)
  | "exception"                            // h2h lost with an exception: of the answers that pick the rival, how many still say when to choose you
  | "commits"                              // popular: the answer names one product as the pick (any brand)
  | "anybrand" | "namedwhen"               // learning: names any brand; named, when a brand is named
  | "alongside"                            // alongside: the ones it names alongside you
  | "premise"                              // critic: does it say the critic is right
  | "tier"                                 // premium: which end it sides with (premium / basic / balanced)
  | "habit"                                // habit: stick with you, pick another brand, it depends, no pick
  | "relationship";                        // settled_all: what the answer does for the relationship

/** A tag's sentiment: good for you, bad for you, or a neutral fact. */
export type PanelTone = "good" | "bad" | "neutral";

/** The served map's per-cell panel stand-in: which kind to draw and which
 * rivals carry a panel (Open), without the bodies. */
export interface PanelStub {
  kind: PanelKind;
  rivals: { name: string; full: boolean }[];
}

/** One cell's panel as /cell_panel serves it, with its usual cell's steps. */
export interface CellPanelPayload {
  panel: PositionPanel | null;
  usualSteps?: PanelStep[];
}

export interface PanelSegment {
  key: string;   // proceed|avoid|none|keep|leave|yes|depends|no|own|rival|nowhere|backs|neutral|redirects|strong|hedged|undermined
  label: string; // "go ahead", "steer clear", "no side", ...
  tone: "you" | "away" | "neutral";
  num: PanelNum;
}

export interface PanelStep {
  key: PanelStepKey;
  label: string;                       // "Named", "Recommendations that end as the pick", ...
  here?: PanelNum;                     // you, in this cell (absent on segmented / list steps)
  segments?: PanelSegment[];           // a split bar (verdict steps)
  items?: { label: string; num: PanelNum }[]; // criteria checklist bars
  /** The selection the items are (fact layer). Never drawn. */
  itemsSelection?: string;
  note?: PanelText;                    // criteria "gap" sentence
  /** am45: what a term in the label means, behind a "?" (never a count). */
  help?: string;
  tagUsual?: string;                   // compares with usualCellId's same-key step
  tagRank?: string;                    // compares with the competitors (or the one rival on panel 11)
  tagUsualTone?: PanelTone;            // the tag's sentiment (drawn colour)
  tagRankTone?: PanelTone;
  hereLabel?: string;                  // this step's own bar label, when "You" would misread it
  usualLabel?: string;                 // this step's own label for the usual bar
  /** The comparison bar carried on the step itself (popular, learning: the
   * comparison is another question type's all-buyers row, not this row's All cell). */
  usual?: PanelNum;
  /** The "you" bar's label in the comparison view when the step is not about you alone ("Any credit card"). */
  compHereLabel?: string;
  rivals?: { name: string; num: PanelNum }[]; // comparison-view bars, in PositionPanel.competitorOrder
  /** am35, head-to-heads: the rival (or the rivals taken together on the all-rivals cell) drawn beside you in the default view. */
  vs?: { name: string; num: PanelNum };
  /** Fact layer: the competitor group's "Other" row in the comparison view (no bar; it opens the list). */
  other?: PanelOther;
}

export interface PanelDetail { heading: string; body: PanelText }

export interface PanelCondition {
  text: string;                        // theme name or flat group label
  share: PanelNum;                     // distinct answers stating it / ALL answers in the cell (ruling 4)
  wall?: true;                         // "fixed"
  products?: string[];                 // toward: your products as written, top 2, never the bare brand
  to?: { name: string; num: PanelNum }[]; // away: active brands; num = share of the row's answers naming one (routeShares rule)
  youPicked?: PanelNum;                // of THIS row's answers, share picking you (pick kinds only, row >= 5 answers)
  both?: { either: PanelNum };         // stated on the other side too; either = the OTHER side's own share of all answers (am40; the name is historical)
}

export interface PanelConditions {
  title: string;        // "When the AI says to choose you, and when another credit card"
  sub: string;          // block description (comparison view may override with subComp)
  subComp?: string;
  towardTitle: string;  // "Choose you if" | "Stay if" | "Go ahead if"
  awayTitle: string;    // "Choose another credit card if" | "Look at another credit card if" | "Hold back if" | "Choose Chase if"
  alsoToward: string;   // "Also said for another credit card"
  alsoAway: string;     // "Also said for you"
  toWord: "To" | "Shown" | "Names"; // prefix of the destination line
  grouped: boolean;     // true = run themes, false = flat condition groups
  towardScope?: "rival_picked"; // h2h lost with an exception: toward rows count only answers that pick the rival
  toward: PanelCondition[]; // <= 6
  away: PanelCondition[];   // <= 6
  /** The selections the two columns are (fact layer). Never drawn. */
  selections?: { toward?: string; away?: string };
  note?: string;        // rule-bearing answers exist but no row clears the floor
  /** am37: the line drawn in a column with no row while the other column has rows. */
  towardNote?: string;
  awayNote?: string;
  /** The away column is not "away from you" (alongside: another company's
   * product the customer asked about) - drawn neutral, never red. */
  neutralAway?: true;
}

export interface PanelBrandRow {
  name: string;
  you?: true;
  num: PanelNum;
  open?: true; // open <=> a PanelRival exists
  /** am37: the row's shown label when it is yours but not "You" (Value: your own cheaper option). */
  shown?: string;
  /** Fact layer: a short tag drawn beside the name ("head-to-head": a rival listed for its head-to-head, not its picks). */
  tag?: string;
  /** Fact layer: the "Other" row (a real bar); opens the brands inside it. */
  other?: PanelOther;
}
export interface PanelBlock {
  title: string;
  sub: string;
  rows: PanelBrandRow[];
  /** The selection the rows are (fact layer). Never drawn. */
  selection?: string;
  /** Fact layer: the competitor group's "Other" row with NO bar (a block whose shares do not add to 100% - What's
   * popular, Premium vs basic); it opens the brands inside it. */
  other?: PanelOther;
}
export interface PanelLine {
  label: string;
  value: PanelText;
  /** A stable name for the line (stat ids, stat_registry.ts): "commit", "share", "picked", "products". Never drawn. */
  key?: string;
  /** The selection a list line is (fact layer). Never drawn. */
  selection?: string;
}

export interface PanelTable {
  title: string;
  sub: string;
  /** am45: what the table's terms mean, behind a "?" beside the title. */
  help?: string;
  /** am47: column `col` draws a bar with a line at `pct` (0-100); a bar reaching the line is drawn strong. `note` says what the line is. */
  mark?: { col: number; pct: number; note: string };
  columns: string[];
  style: "compare" | "bars";
  rows: { label: string; cells: (PanelNum | PanelSpan | null)[] }[];
  /** The selection the rows are (fact layer). Never drawn. */
  selection?: string;
}

export interface RivalStepDetail {
  heading: string;
  body: PanelText;
  rows?: { label: string; rival: PanelNum; you: PanelNum }[]; // named: named-not-recommended, of those named to avoid
  /** am35: what happens to recommendations that do NOT end as the pick (the step bars show the pick itself, so `picked` is not carried). */
  outcomes?: { name: string; you?: true; picked?: PanelNum; lost: PanelNum; none: PanelNum; outside?: PanelNum }[];
  both?: PanelText;  // "recommends both of you in X% ... picks R Y% and you Z%"
  outcomeLabels?: { picked?: string; lost: string; none: string; outside?: string }; // the outcome line's words (a column per label present)
}

/** am34: what explains one step of a question-type panel (the step a reader
 * clicks). Same shapes as RivalStepDetail; `columns` names the rows' two
 * columns (normal view: here against your usual; comparison view: you against
 * the leading competitor). An outcome line's `name` is its display label. */
export interface PanelStepDetail {
  heading: string;
  body: PanelText;
  columns?: { rival: string; you: string; rivalIsUsual?: true };
  rows?: { label: string; rival: PanelNum; you: PanelNum }[];
  /** am35: one new fact as rows of one number each (who takes the pick when the AI recommends you and picks another; what happens when it picks neither of the two). */
  list?: { title: string; rows: { label: string; num: PanelNum }[]; selection?: string };
  /** am35: the outcomes the step bars do not show (lose to another, no single pick); `picked` is not carried.
   * Ruling 12: a pick outside the category is its own share (`outside`), never "no single pick". */
  outcomes?: { name: string; you?: true; usual?: true; picked?: PanelNum; lost: PanelNum; none: PanelNum; outside?: PanelNum }[];
  outcomeLabels?: { picked?: string; lost: string; none: string; outside?: string };
  both?: PanelText;
  /** am48: a labelled box around the heading and sentence ("The exception"). */
  callout?: string;
  /** am38: further lists of new facts, in order (Value's "where it points the buyer instead"). */
  sections?: PanelDetailSection[];
}

/** am38: one list inside a step explanation. Rows are bars of one number each
 * (3+ answers); `open` rows carry a rival panel; `note` holds what rests on
 * fewer answers, as a sentence. tone colours the bars (good = you, bad = a rival). */
export interface PanelDetailSection {
  title: string;
  sub?: string;
  tone: PanelTone;
  rows: { label: string; num: PanelNum; open?: true; /** am61: the row opens this Map cell's card ("Open"). */ cell?: string }[];
  note?: PanelText;
  /** The selection the rows are (fact layer). Never drawn. */
  selection?: string;
}

/** am38: "What the answer weighs", sized - one column per side (or one column
 * unsided), top 3 topics each with its share of that side's answers. A side
 * with too few answers carries `note` in place of rows. */
export interface PanelWeighs {
  title: string;
  sub: string;
  /** The selection the columns' topics are (fact layer). Never drawn. */
  selection?: string;
  columns: {
    title?: string;
    tone: PanelTone;
    rows: {
      name: string;
      num: PanelNum;
      /** am59: the row is the tracker's own brand (drawn in the you colour). */
      you?: true;
      /** am71: on a two-sided block, the same topic's share on the other side ("13% when it picks you"), drawn small beside the row. */
      other?: { label: string; num: PanelNum };
    }[];
    note?: string;
  }[];
}

/** Panel 11: one rival inside this cell's question type. */
export interface PanelRival {
  name: string;
  full: boolean;                 // false = the smaller non-pick version
  claim: PanelText;
  lead?: PanelText;
  steps: PanelStep[];            // here = you, rivals = [this rival]; tagRank = duel tag
  focus?: PanelStepKey;
  details?: Partial<Record<"named" | "recommended" | "converts", RivalStepDetail>>;
  conditions?: PanelConditions;  // full only: away = rows sending buyers to this rival, toward = the cell's toward rows
  lines: PanelLine[];            // which products it picks (both sides)
  /** am38: what the answer weighs, sized (by side on the full panel). */
  weighs?: PanelWeighs;
  byCell?: { cellId: string; label: string; rival: PanelNum; you: PanelNum }[]; // sibling cells of the row (full, rows with 2+ cells)
  byCellTitle?: string;          // the byCell block's title
  stackLabel?: string;           // the step stack's label
  thin?: string;                 // one sentence when the slice is thin
}

export interface PositionPanel {
  kind: PanelKind;
  claim: PanelText;
  lead?: PanelText;
  usualCellId?: string;          // the row's All cell; absent on All cells and single-cell rows
  hereKey?: string;              // key line: "You, with this buyer"
  usualKey?: string;             // key line: "You, across all buyers"
  stackLabel: string;            // "Where you lose this buyer" | "How the answer goes" | "Where it is decided"
  steps: PanelStep[];
  focus?: PanelStepKey;          // highlighted step, normal view
  focusComp?: PanelStepKey;      // highlighted step, comparison view
  detail?: PanelDetail;
  detailComp?: PanelDetail;
  /** am34: per-step explanations (a clicked step), normal view; `detail` stays the default. */
  details?: Partial<Record<PanelStepKey, PanelStepDetail>>;
  /** am34: per-step explanations, comparison view; `detailComp` stays the default. */
  detailsComp?: Partial<Record<PanelStepKey, PanelStepDetail>>;
  compare?: true;               // the "Show competitors" switch is drawn
  /** am35: a panel with no usual: its steps' `usual` is the listed competitors taken together ("Average competitor"), shown with the switch off. */
  avgComp?: true;
  /** am70: the average listed competitor's share of the picks and its picked-of-all-answers (the Brief's scoreboard quotes them). */
  avgShare?: PanelNum;
  avgPicked?: PanelNum;
  /** What to look for: the topics on the AI's list, most taught first (at most five) - the list the claim names
   * and the table's line is drawn from. Data for the Brief, never drawn. */
  checklist?: string[];
  competitorOrder?: string[];    // brand names behind PanelStep.rivals
  /** The selection behind competitorOrder (fact layer). Never drawn. */
  competitorSelection?: string;
  competitors?: PanelBlock;      // "Who takes the picks" / "Which ... it names instead" / "... it shows" (comparison view only)
  conditions?: PanelConditions;
  lines?: PanelLine[];
  linesComp?: PanelLine[];
  /** am38: what the answer weighs, sized; `weighsComp` is the comparison view's own version. */
  weighs?: PanelWeighs;
  weighsComp?: PanelWeighs;
  /** am38, Value: the product the question asked about ("A, B and C" on an all-buyers cell asking about several). */
  product?: string;
  /** am38, Value all-buyers cell asking about 2+ products: the verdict per product asked about. */
  byProduct?: PanelTable;
  table?: PanelTable;
  /** The comparison view's own version of `table` (when it drops a column). */
  tableComp?: PanelTable;
  /** am59, Premium vs basic: "Who it names at each end" - two lists side by side (as premium, as basic). */
  ends?: PanelWeighs;
  /** Further tables, after `table` (popular: products, arguments). */
  tables?: PanelTable[];
  rivals?: PanelRival[];
  thin?: string;                 // under the 20-answer floor: one sentence; tags and detail absent
}

/* ---- am31 round 2: one rival across every question type (the By rival tab) ---- */

export interface RivalAcrossBar { name: string; who: "rival" | "you" | "other"; num: PanelNum }

/** One question type where the rival appears: its bars and, when selected, the block explaining it. */
export interface RivalAcrossStep {
  key: string;                   // the map row slug (awareness, open, social, h2h, leavers, buyers, value, customers, hold)
  label: string;                 // "What to buy - share of the picks"
  cellId: string;                // the cell the step reads
  bars: RivalAcrossBar[];
  tag?: string;
  tagTone?: PanelTone;
  heading: string;
  body?: PanelText;
  conditions?: PanelConditions;
  table?: PanelTable;
  /** Rows resting on fewer than 3 answers, folded into one sentence. */
  fold?: PanelText;
}

export interface RivalAcross {
  name: string;
  claim: PanelText;
  steps: RivalAcrossStep[];
  focus?: string;                // the step selected first
  byBuyer?: PanelTable;          // "Where it takes its picks" (share of the picks, rival vs you)
  products?: PanelTable;         // "Which of its <products> it picks"
}
