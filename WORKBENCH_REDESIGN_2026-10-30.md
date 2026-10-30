# Workbench redesign (2026-10-30) - the analyst grid for the typed instrument

Status: RATIFIED 2026-10-30 (Tyler: "we're on the same page. build it all").
The ratified shape is the "RATIFIED" section directly below; the five candidate
structures and the worked pool-first model after it are the record of how it
was reached.

## RATIFIED: two tiers, one chassis, four analysis lenses

**Summary views** (exist, ride brand_summary): The brief, Boardroom, Five
questions.

**Analysis views** (this build), all riding ONE chassis - the typed fact table
(wb2) plus a single legality layer that knows which measures each pool's
schema asks. Every canned lens is a curated preset over that engine; legality
is enforced in exactly one place.

1. **Journey** - the six-station map with leak numbers, each station opening
   into its stages (the stage lens is the drill, not a separate view; the
   station bodies REUSE the existing per-type section components, so the
   standalone "By question type" pill retires into it). Station mapping,
   ratified: Awareness = problem recognition + category education;
   Consideration = discovery, use-case, social validation, criteria (context,
   no leak number), premium vs basic; Comparison = head-to-head entity +
   class, rival leavers; Doubts = buyers' worries; Value = value; Customer
   base = customers' worries, holding your own, repertoire, Set C (depth, no
   leak number). Copy never implies per-buyer sequence - stations are
   independent populations.

   **The Journey carries a BUYER FILTER** (Tyler, same day: "why can't we
   filter the journey to a specific buyer?" - we can, and it replaces the
   standalone Buyers lens). "All buyers" plus one chip per room. Picking a
   buyer filters the room-pinned stations and stages (awareness problem
   recognition, discovery, use-case, criteria, value) to that room's cells;
   the room-INVARIANT measurements (head-to-heads since s10, the worries
   module, rival leavers, holding your own, premium, repertoire, Set C,
   category education, social validation) cannot be filtered - not a
   dashboard limit but the instrument's: those questions are deliberately
   never asked in one buyer's voice (the s10 confound rule). Under a buyer
   filter those stations stay visible, show their all-buyers numbers, and
   carry a "measured across all buyers by design" marker - never silently
   unfiltered, never hidden. An engine filter rides the same bar. Thin-cell
   muting matters most here: one room x one engine is ~10 answers.
2. **Decision rules** - the aggregate conditions explorer: across every
   rule-bearing answer, what conditions route the pick to you and what routes
   it away, embed-clustered (condition_groups core, one grouping per run,
   stems fallback keyless), with incidence, split by rival and by room, sample
   answers per group. The strategy read is the rules x rooms join: which
   buyer's circumstance matches the conditions you win on. New server engine +
   cached view; prod embedding spend follows the conditions-panel precedent
   (views:conditions, pennies, ledgered).
3. **Metrics** - the generic pivot: any dimension on rows and columns
   (room, worry, rival, stage, engine, mode, brand, argument), any LEGAL
   measure, illegal combinations greyed with the reason. The escape hatch, not
   the workhorse. Client-side over wb2.

Cross-cutting, part of the chassis: Wilson ranges on every cell, thin cells
(n < 20) visually muted rather than printed as confident numbers; arguments
(reasons) are a FILTER/dimension available in every lens, never a lens of
their own; evidence drill-through - every count opens the answers behind it
(response ids ride the fact table; bodies via a small ids->texts route
honoring evidence_drawer and share permissions) - built last in this round.

**Deferred follow-on:** the rival ledger (sketch 5) - every number in it
exists in other views; build it when a customer asks for battlecards.

**Navigation:** the codes-era results pills regroup into Summary (The brief,
Boardroom, Five questions) and Analysis (Journey, Decision rules, Metrics);
the Buyers lens lives inside Journey as its buyer filter; "By question type" retires into Journey's station drill. The
mounted-once-visited pattern stays so pill switches never refetch.

## The five candidate structures

**1. Pool-first (question type as the frame).** The primary selector is the
question type; each pool offers only its own verdict fields, split by room /
worry / rival / engine, with brand as a lens. Answers "how do we do on THIS kind
of question?" Its strength is legality by construction - no measure can be asked
of a pool whose schema does not carry it, so the surface can never show a
nonsense number. Its weakness: cross-cutting questions ("everything about this
buyer", "everything about Capital One") take several pool visits.

**2. Buyer-first (rooms as the frame).** The primary selector is the buyer room
("Premium luxury seeker", "Small business owner") - pick a buyer, see their
whole record: who gets named for them, the value verdict on our line for them,
their awareness routing, their criteria. Answers "how do we do with THIS
buyer?" - the question the scenario engine was built around, and the axis
nothing surfaces today. Weakness: the invariant pools (head-to-heads since s10,
the worries module, repertoire, Set C) belong to no room, so a third of the
measurement sits in an "every buyer" bucket; and a room's n is one cell x
engines per pool, so cuts get thin fast.

**3. Journey-first (the funnel as the frame).** Organized by the buyer's
decision journey: Awareness -> Consideration (discovery / criteria / use-case)
-> Comparison (head-to-heads / leavers) -> Doubts -> Value -> the customer base
(churn / renewal / repertoire / Set C). The analyst walks the funnel and sees
where the brand leaks. Answers "WHERE in the journey do we lose people?" It is
the natural narrative for an executive walkthrough and maps one-to-one onto the
stage contract. Weakness: it is an ordering more than a structure - within each
station you still need pools, measures and splits, so it tends to collapse into
structure 1 with chapter headings; and funnel language implies a sequence the
instrument does not actually measure per buyer.

**4. Pivot grid (free dimensions, legality-enforced).** A true pivot table:
rows, columns and measure freely chosen from any dimension - brand, engine,
mode, room, worry, rival, stage, argument, verdict - with the engine greying
every combination whose pool's schema does not ask the measure. Answers any
question the data can answer, including ones we have not thought of. The most
powerful and the most dangerous: the legality rules ARE the product, and one gap
ships a pooled number the presentation rule forbids; also the costliest to
build and the least guided for a customer.

**5. Brand-first (the competitive ledger).** Keep the legacy frame: pick a brand
or a comparison set, and the surface shows that brand's full ledger across
every question type - its open-choice rates, the head-to-head record against
it, how often it captures our leavers or is offered as an exit, the arguments
that travel with its wins, its negative framing. Answers "tell me everything
about Capital One in our answers." The natural competitive-deep-dive surface
and the one closest to what wb1 already is. Weakness: it inverts the
measurement - verdicts like worth-it, keep-or-leave and premise are about the
TARGET, not about an arbitrary brand, so most of the new coding only appears
where the chosen brand is the target or a named rival.

These are not mutually exclusive: 2 and 5 can ride any chassis as lenses, and 3
is an ordering of 1. The combination question - which is the chassis, which are
lenses - is the real decision.

## Why the ported Workbench misfits

wb1 (be20309) is a faithful port of the LEGACY Workbench: one homogeneous pool,
sliced by brand set x grain x engine, measuring mentions and picks. That was the
whole measurement in the mentions era. It is a corner of the measurement now. The
fact table flattens every answer to [engine, prompt, outcome, pick, mentions,
reasons] and keeps only an `open` flag of the cell's identity - so the Workbench
cannot ask any of the questions the new instrument was built to answer:

- In which BUYER ROOM do we lose the pick? (every scenario-pinned cell carries
  `intents.situation`; nothing in the app slices by room except the Value view)
- On which WORRY does the AI tell customers to leave? (`intents.concern`)
- Which ENGINE flips a verdict - worth-it, stay-or-leave, premise? (the per-type
  verdict fields never reach the fact table)
- Against which RIVAL, under what CONDITIONS, does the pick route away?
  (`intents.angle`, `decision_rules`)
- Which ARGUMENTS travel with a verdict, inside one question type?

## What the instrument measures now (the inventory)

Dimensions on every answer (via its cell): question type / view, stage, room
(situation), worry (concern), rival or class (angle), value line (room -> line via
setup_decision), engine, mode (instinct/search).

Verdicts per schema (answer_codes): outcome + top_pick (choice), worth_it (value),
proceed_or_avoid + premise (objections), keep_or_leave + premise (churn/renewal),
tier_stance (premium), category_routed (awareness), relationship_verdict +
case_strength / growth_stance (Set C), stick/switch (repertoire). Plus: mentions
with framing and first-appearance order, brand-agnostic reasons, topics,
destinations / redirect_to / pairings, decision_rules (choice conditions).

## The model: Pool -> Measure -> Split -> Filter -> Evidence

One organizing principle, replacing brand-first slicing:

1. **Pool** (primary selector): the question type, same vocabulary as the reasons
   view's selector - Open choice, Head-to-head (entity / class), Rival leavers,
   Holding your own, Buyers' worries, Customers' worries, Value, Repertoire,
   Awareness (problem recognition / category education), Criteria, Business case,
   Expansion, Ecosystem, Advocacy. Pools are never pooled with each other
   (presentation rule, 2026-09-27). Default: Open choice.
2. **Measure**: the pool's own verdict fields, offered automatically - open choice
   gets mentioned / recommended / chosen / share-of-decided per brand and the
   outcome mix; doubts get stay-leave x premise and exit-named; value gets the
   worth-it mix and recommends-another; head-to-head gets the record. No measure
   ever appears on a pool whose schema does not ask it.
3. **Split** (table columns / rows): engine, mode, room, worry, rival, line, stage
   - whichever of these vary within the chosen pool. Room is the headline new
   axis: it exists on every scenario-pinned pool and nothing surfaces it today.
4. **Filter**: engine subset; brand lens (any active brand's rates, not only the
   target); argument filter (answers arguing code X); premise filter on doubt
   pools. Grain: family (dictionary) with product-form drill from raw mention
   strings as a later round.
5. **Evidence**: every count clickable -> the answers behind it (response ids are
   in the fact table; bodies via the answers route, `evidence_drawer` flag
   respected). The number-to-answers path is what makes it a workbench instead of
   a report.

## Per-pool matrix (measures x splits)

| pool | measures | splits |
| --- | --- | --- |
| Open choice | mentioned / recommended / chosen / share of decided (per brand); outcome mix | engine, mode, room, stage |
| Head-to-head entity / class | you / rival / other / no side; two-way record | rival or class, engine, mode |
| Rival leavers | named / recommended / picks-you; destinations | rival left, engine |
| Holding your own | stay / leave / no side; exits offered | engine |
| Buyers' worries | proceed / avoid / no side; premise; exit named | worry, engine |
| Customers' worries | keep / leave / no side; premise; exit named | worry, stage (churn vs renewal), engine |
| Value | worth it / depends / not; recommends-another | room, line, engine |
| Premium tier | go premium / basic / depends; recommends / picks target | engine |
| Repertoire | stick / switch / no single answer | engine |
| Awareness PR / CE | category-routed; names / recommends target | room, engine |
| Criteria | topics taught (incidence) | room, engine |
| Set C (4 pools) | relationship verdict; case strength / growth stance; pairings / redirects | engine |

Arguments (reasons) are a FILTER and a contrast table on every pool, never a
cross-pool rollup (the reasons view already owns that comparison).

## Data: fact table v2 (one fetch stays)

Keep wb1's shape - one compact payload, all slicing client-side - but make the
rows typed and move the slicing dimensions onto the prompt metadata:

- `prompts[i]` grows: stage, view, room, worry, angle, line (strings interned in
  side arrays as wb1 does for brands/codes).
- Row: [engine, prompt, v1, v2, premise, pick, mentions[], reasons[],
  destinations[]] where v1/v2 are the schema's verdict enums (meaning fixed per
  view; -1 = not asked). Destinations as brand indexes.
- decision_rules do NOT ride the fact table (≈20K rules x condition text per run).
  The conditions explorer is Phase 2 and reuses the head-to-head view's grouped
  conditions (embed clusters) per matchup; a per-room conditions cut needs its own
  server grouping and is scoped there.
- Version wb1 -> wb2 (cache-era case 2).

## What survives from wb1

Why (argument lift) survives as the per-pool contrast table. Battleground
(per-prompt) survives inside each pool. Risk (framing) survives as the negative
lens on the brand table (rows + extra). Parents grain survives. Position
(first-appearance order) survives on mention measures. The brands/engines/codes
interning scheme survives. The Sources / Style / Answers-bodies tabs stay out
until citations and bodies get their own round.

## Phases

- **P1 (the build):** pool selector + typed fact table v2 + per-pool measures,
  room / worry / rival / engine splits, brand lens, argument filter, evidence
  drill-through to answers.
- **P2:** conditions explorer (decision_rules by rival and room, embed-grouped).
- **P3:** sources / style / answer bodies (non-answer_codes sources).

## Open decisions (Tyler)

1. Ratify Pool -> Measure -> Split as the organizing model (it is also the
   candidate organizing principle for the wider dashboard redesign - the Brief and
   By-question-type stack already follow it implicitly).
2. Evidence drill-through in P1, or deferred? (It is the biggest build item in P1
   but the thing that makes it an analyst tool.)
3. Rooms: beyond the Workbench split, does the dashboard get a per-room section of
   its own in the wider redesign? (Noted here; not part of this build.)
