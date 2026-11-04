# Analysis section, tabula rasa (2026-11-03)

A fresh design, built from three sources only: the service-flows deck (coverage map, portfolio playbook,
treatment ladders), the CMO piece ("six things CMOs miss"), and the Five-Tracker Findings doc. Deliberately
not derived from the current Journey / Decision rules / Metrics structure.

## The diagnosis: why the findings docs land and dashboards don't

Both findings docs were written by analysts reading the measurement views. Four things make them land that
no metric surface does on its own:

1. **Every sentence is a tension, never a rate.** "Named 89%" is inert; "named 89%, picked 7%" is a
   finding. "Wins 89% of head-to-heads, takes 7% of open choice." "Agrees with the worry in 98% and still
   says stay in 70%." "Taught on the three arguments it loses on." A number only means something next to
   the number that should agree with it and doesn't. A dashboard that shows rates makes the customer do
   the subtraction; the analyst docs did the subtraction and that IS the insight.

2. **Every brand gets a casting, not a score.** "The right card for a specific spender, never the default
   card." "The category's reference brand, not its recommendation." "The bold second bag beside a safe
   default." A CMO repeats the sentence in the next meeting; nobody repeats a funnel.

3. **The real grain is the contest, not the tracker.** Finding 4 is the structural one: averages blend
   contests the brand wins outright with contests it never enters. 84 of Jira's 116 picks are one room.
   44% of iPhone's picks against Pixel are one question. A tracker-level rate is a blend that hides the
   thing worth knowing.

4. **Every finding ends in a move.** The CMO doc's "what to do" and the playbook's treatments are where
   the reader feels value. Analysis that ends in a number asks "so what?"; analysis that ends in a door
   answers it.

The deeper point: the sales deck already promised exactly this artifact. Page 1 of the service flows IS
the coverage map ("the AI mentions you here / you are absent - a cell to explain"); page 3 IS the
two-sided portfolio. The customer was sold a map and a playbook. The analysis section should BE the map
and the playbook, measured - not a set of measurement views the customer must learn to assemble into one.

## The design in one sentence

The analysis section is the findings doc, generated live: a one-sentence casting of the brand, read off a
coverage map of named positions - strongholds, contested ground, walls, leaks - each position a claim with
its tension, its why, its receipts, and its door into the playbook.

## Three layers, one verb each

```
  THE VERDICT      read it      who the AI says you are, in one paragraph of claims
  THE MAP          find it      every contest, placed: won / contested / lost / walled / never entered
  THE POSITION     act on it    one contest opened: claim -> tension -> why -> receipts -> lever
```

Navigation is strictly downward. The verdict's sentences each point at a map region; a map cell opens its
position; a position's receipts are the actual answers. No surface shows a number without the sentence
that interprets it, and no sentence is more than one click from the answers that prove it.

### Layer 1 - The Verdict

One screen, three parts, no controls beyond the engine panel:

- **The casting line.** A template sentence from typed facts (composeVerdict's mechanism, extended), built
  on an archetype the engine classifies from three measured facts: share of decided vs the top rival,
  the prompted-vs-open gap, and whether the conditions toward the brand are narrower than the conditions
  away. Archetypes: **the default** (Netflix), **the specialist** (AmEx - picked only when the buyer
  matches), **the reference brand** (Jira - most named, explained against, not recommended), **the
  challenger** (Pixel - wins named fights, loses the open room), **the companion** (Doritos - recommended
  beside the pick, rarely the pick). Each archetype has a fixed sentence frame; the measured facts fill
  it. Template prose from typed facts, never generated prose - same discipline as the current verdict.

- **The two-dot line.** Named vs picked for you and your rivals (the DotTrack). It is the one chart the
  whole product hangs on: the distance IS the conversion problem, and the casting line is its explanation.

- **Three to five position headlines.** The highest-ranked tensions (section "The nine tensions" below),
  each one sentence + its two numbers + a "see the position" link into the map. Not a feed - a brief.
  Ranked by effect size over Wilson floors, capped hard at five.

### Layer 2 - The Map

The coverage map from the sales deck, lit with real data. Rows = the stages the tracker runs (journey
order). Columns = the buyer rooms the customer confirmed at setup, plus one "every buyer" column for
room-invariant cells (head-to-heads, worries). Each cell is one measured contest - one pool, one room -
so nothing is ever summed across pools and the presentation rules hold by construction.

Each cell carries a **verdict glyph**, not a number:

- **Stronghold** - you win it decisively (your share of decided clears the top rival's, outside the ranges)
- **Contested** - decided answers split, or the two-way record sits near even
- **Lost** - a rival or the category default owns it
- **Walled** - lost, and the dominant away-condition is a possession, not an argument ("already owns Apple
  devices", "already pays for Prime"). Detected from the largest condition groups whose wording is a state
  the buyer is in, not a want. A wall gets its own glyph because its treatment is different: you route
  around a wall (strategy), you don't out-argue it (proof).
- **Leak** - the picks leave the category (B5: PBS Kids, lounge memberships, store brands). Already measured.
- **Caught in-house** - lost, but to your own cheaper rung (Netflix's ad tier, the base Pixel). The v6
  ownRung split, promoted to a cell verdict: a loss that isn't lost revenue.
- **Never entered** - you aren't named in the cell's answers (the deck's "a cell to explain")
- **Undecided** - the AI makes no call here (the 50-76% no-single-pick mass is a finding, not an absence)

Hover gives the one-line claim; counts live in the tooltip per the n-rule. The map answers the CMO's first
question - "where exactly?" - in one glance, in the vocabulary the customer themselves ratified at setup
(their rooms, their rivals, their worries). No Procerno schema names anywhere on it.

### Layer 3 - The Position

Click a cell (or a verdict headline) and one contest opens as a position card - the atom of the whole
design. Anatomy, top to bottom:

1. **The claim.** One sentence, plain words, with the tension inline. "Buyers who plan to keep the phone
   four years are sent to iPhone - 98 picks to 1 - and this one question supplies 44% of iPhone's picks
   against you."
2. **The status.** Deficit or surplus, with the playbook triage as an engine SUGGESTION the customer can
   override - exactly like the codebook gate's recommended-vs-decided pattern:
   - Deficit triage ("is the AI right about you?"): **record is wrong** (stale-fact flags detected in the
     answers - fees, discontinued models; already coded), **proof is missing** (the AI concedes an
     argument your setup claims as a strength), **strategy misfit** (a wall, or a room you can't win),
     **product truth** (the AI is right and consistent across engines).
   - Surplus triage ("is the standing earned?"): **earned**, **overclaimed** (strength argued only in
     prompted contests, never in open choice - the advocacy-vs-objection and prompted-vs-open detectors),
     **windfall** (a stronghold in a room you never targeted).
3. **The why.** Two short blocks: the arguments (lift, this cell only) and the conditions (toward you /
   away from you, grouped, with the wall groups flagged). This is the "decisive why" paragraph's content,
   scoped to one contest.
4. **The receipts.** The verbatim answers behind the numerator - the existing evidence drawer. Three
   quotes inline, the rest behind it. A claim with a quote under it is believed; the same claim with only
   a percentage is doubted.
5. **The lever.** One line naming what would move this cell, in the treatment ladder's terms ("counter-
   evidence for the Tensor-headroom concession, published where the AI reads" / "a migration story - the
   away-condition is switching cost, not preference"), plus the door: "Add to playbook."

### The Portfolio (the fourth screen, and the commercial close)

Every position the customer triages (or accepts the engine's triage on) lands in a two-sided portfolio
view - deficits down one side with their treatment family, surpluses down the other with defend / watch /
validate. This is page 3 of the sales deck, rendered from the customer's own data and their own calls.
It is also the wave-over-wave spine: next wave, each position re-measures and the portfolio shows moved /
held / slipped per position - "standing managed as a portfolio", exactly as sold. The decision record
(recommended vs decided triage, per position) is the same stored-decision pattern as every gate.

## The nine tensions (the detector contract)

The nine cross-tracker findings are not examples of what analysis might find - they are the templates the
engine computes per tracker. Each is a named tension with a fixed sentence frame; most detectors already
exist:

| # | Tension | Frame | Detector |
| --- | --- | --- | --- |
| 1 | Known vs picked | "Named X%, picked Y%" | exists (funnel + DotTrack) |
| 2 | Narrow vs median conditions | "Your conditions describe a specific buyer; the away-conditions describe the buyer nobody specified" | partial - needs the narrow/median classification over condition groups |
| 3 | Prompted vs open | "You win the named fight and lose the open room" (or the reverse) | exists (prompted_vs_open) |
| 4 | Concentration | "One question/room supplies X% of the number" | exists (pick_concentration_*) |
| 5 | Agreed yet stay / exit economics | "The AI grants the worry and still says stay - because leaving is expensive, not because you're right" | exists (agreed_yet_stay); add the switching-cost argument incidence |
| 6 | Value loss, in-house vs rival | "The 'not worth it' money goes to your own cheaper rung / to a rival" | exists (value_in_house + ownRung) |
| 7 | Advocacy vs objection | "Asked to defend you the AI delivers; unprompted it concedes the same point" | exists (advocacy_vs_objection) |
| 8 | Taught vs winning | "The criteria stage re-arms the rival: your winning argument goes untaught" | exists (taught_vs_winning) |
| 9 | Engine spread / mode | "A one-engine read would mislead; search moves your pick rate X -> Y" | exists (spread + mode detectors) |

Plus the three map-native detections: **walls** (possession-shaped away-conditions), **leaks** (B5),
**in-house catch** (ownRung). Only #2's narrow/median read and the wall classifier are genuinely new
model-touching work; both are bounded judgments over already-grouped conditions (the month's pattern says
gpt-6-luna, cached per group).

## What this absorbs and what it retires

- **The Verdict absorbs** The brief, Boardroom and Five questions - they are three renderings of layer 1
  and collapse into one screen.
- **The Map absorbs** Journey (stations become rows; the buyer bar becomes columns - same pools, same
  engines, reframed) and becomes the primary navigation. The per-type sections stop being destinations;
  their content is served through positions.
- **The Position absorbs** the rules explorer (conditions are block 3 of every position) and the evidence
  drawer.
- **The pivot survives as "the workbench"** behind a door labeled for analysts - the power tool for the
  5% of users who want arbitrary cuts. It stops being a peer of the main surfaces.
- **The Portfolio is new** and is where the service attaches.

Nothing below the view layer changes: pools, measures legality, caching, the engine panel, room filtering
and the context judge all carry over. This is an architecture-and-presentation round, not a measurement
round.

## Design rules (the contract for every surface)

1. No number without its counterpart - every displayed rate sits in a sentence that pairs it with the
   number it disagrees with.
2. The contest is the grain; tracker averages appear only on the verdict screen, already decomposed.
3. Customer vocabulary only: their rooms, their rivals, their worries, their lines. No stage keys, no
   schema names, no engine model ids.
4. Receipts one click from every claim; counts in tooltips, never on cards.
5. Every deficit ends in a lever and a door; every surplus ends in defend / watch / validate.
6. Undecided is a verdict, not missing data.
7. Engine spread is part of a finding's body, not a filter the reader must remember to apply.

## Alternatives considered (2026-11-03, Tyler: "contrast it against 2 other alternatives")

The three candidates differ on the primary organizing axis: WHERE (the map), THE STORY (a brief), or
WHO (the opponents). Each is steelmanned; the ruling question is which axis the home surface should own,
since all three contents survive in some form whichever wins.

### Alternative B - The Living Brief (story-first)

The analysis section IS the findings doc, generated per wave: the casting line, then five to nine ranked
findings in narrative order - each a tension sentence that expands inline to its why, its receipts and its
move - closing with the recommendations. No grid, no sub-navigation beyond a table of contents. This is
the Five-Tracker doc productized per tracker: the artifact that actually convinced us the data has value,
made literal.

Where it wins: zero learning curve - everyone can read a memo, nobody has to learn a glyph vocabulary;
insights pop by construction, because the surface IS the insights and nothing else; and it is forwardable -
the customer's champion can hand the brief to their CMO whole, which is how this product gets sold upward
inside an account.

Where it loses: (1) **no lookup** - the PM who wants their room, their rival or their worry must scan prose;
the engine ranked the findings, and what it ranked sixth may be the thing this reader came for. (2) **No
stable home for change** - wave two produces another brief, and the reader must diff two documents in their
head; a ranked list reshuffles, so "what moved" has no fixed place to be seen. (3) **Static on repeat
visits** - a report is read once; a subscription product that re-renders the same-shaped memo each month
reads as a PDF pipeline, and the "why do we pay monthly" question arrives early. (4) It silently re-breaks
the grain rule: a linear brief pushes toward tracker-level claims because prose wants few numbers, and
finding 4 says the contest grain is where the truth lives.

### Alternative C - The Opponents Ledger (who-first)

Home screen: "who takes your buyers" - a ranked ledger of everything that beats the brand, as first-class
opponents: the category default (Lay's, iPhone), named rivals (Linear), the undecided mass (the AI's
no-pick), out-of-category leaks (PBS Kids, lounge memberships), the brand's own cheaper rung, and walls
(the Apple ecosystem as an opponent). Each opponent opens to a battlecard: where they take you (rooms,
questions), with what arguments, under what conditions, the receipts, and the counter-move.

Where it wins: it is visceral and budget-shaped - marketing orgs organize campaigns against competitors,
and "your biggest opponent is 'no decision', not Linear" is itself a headline insight the frame produces
for free. It maps cleanly onto battlecards, the artifact competitive teams already maintain.

Where it loses: (1) **it is all threat, no standing** - surpluses, strongholds and the earned/overclaimed/
windfall side of the playbook have no home; the sold service is two-sided and this frame is one-sided.
(2) **The same opponent fragments across mechanisms** - iPhone beats Pixel as a wall (ecosystem), as an
argument (chip headroom on one question), and as a default; one battlecard page flattens three different
treatments into one pile. (3) Retention, doubts and settled-customer measurements fit awkwardly - the
"opponent" of a churn answer is often exit economics, not a brand. (4) The buyer-room grain disappears
again: opponents cut across rooms, so finding 4's "the room is the real grain" has nowhere to live.

### The contrast

| | A - Map | B - Brief | C - Opponents |
| --- | --- | --- | --- |
| First-glance intuition | medium (glyphs to learn) | best | good |
| Insights pop | via verdict layer | best, by construction | good, threat-framed |
| "Look up my thing" | best (their rooms, their rivals) | worst | rivals only |
| Contest grain (finding 4) | native | erodes to tracker level | lost |
| Wave-over-wave change | best - cells flip in place | diff two memos | re-ranked list |
| Two-sided playbook attach | native (deficit AND surplus) | in the close only | deficit side only |
| Matches the sold artifact | exactly (deck pages 1 + 3) | no | no |
| Main risk | grid density, glyph overload | reads as a PDF, churn | mis-frames the real opponent |

The asymmetry that decides it: **B and C both survive inside A, and A survives inside neither.** The
verdict layer IS the brief - generated in narrative order from the same detectors, and exportable whole,
which captures B's forwardability without giving the home surface to prose. C becomes a lens: every
position already names its taker, so "group positions by opponent" is a cheap rollup of the position
table - and "the default" and "undecided" become first-class takers, which keeps C's best insight. The
reverse directions fail: no amount of brief recovers a stable spatial home for wave-over-wave change, and
no opponent ledger recovers the room grain or the surplus side.

Two things the contrast changes in the design (A, amended):

1. **The verdict layer is a real brief, not tiles.** Layer 1 renders as narrative prose in reading order -
   casting, then the ranked tensions as paragraphs - and exports whole (the forwardable memo). B's whole
   strength, absorbed.
2. **The glyph set collapses to four visual classes** - yours / contested / theirs / no contest - with the
   exotic verdicts (walled, leak, caught in-house, never entered) as badges on the cell rather than
   first-class colors. Eight glyph types was A's biggest intuitiveness risk; four classes plus badges keeps
   the taxonomy without asking the reader to learn it before the map reads. Every position also names its
   **taker** explicitly (a rival, the default, your own rung, out-of-category, nobody) - C's frame, kept
   as a field instead of an architecture.

## Map refinement (2026-11-03, Tyler: "too many blank cells, a lot of the real estate useless")

The stage × room matrix wasted its width: most contests are room-invariant by design (head-to-heads,
worries, holding-your-own, settled questions), so seven of ten rows carried one "Every buyer" cell and
four dashes. The map is now BANDED BY WHAT EACH CONTEST VARIES BY, so every cell is a real contest and
blanks cannot occur by construction:

- "Where the buyer chooses" - cells per ROOM (open choice, awareness, value with its line, criteria)
- "The named fights" - cells per RIVAL (the head-to-head record one rival at a time; rival leavers)
- "The doubts" - cells per WORRY, in the worries gate's own vocabulary
- "The settled customer" - cells per QUESTION (business case, expansion, ecosystem, advocacy)

This is finer grain for free - the head-to-head row becomes six verdicts instead of one, the worries row
one verdict per confirmed worry - and every cell label is vocabulary the customer ratified at setup.
Absence appears only as a real verdict ("No call", "not read separately"), never as an empty cell. A
contest spanning its whole band (rival leavers, holding your own) renders as one full-width cell rather
than a column entry. Prototype updated to this layout.

## Open questions for Tyler

1. **Archetype set and wording of the casting line** - the five archetypes above are read off the five
   trackers; a sixth may exist (a brand that wins open choice but loses head-to-heads has no example yet).
   Taste call on the frames.
2. **Who triages?** Engine-suggests-customer-confirms (the gate pattern) vs engine-decides-with-override.
   The portfolio's value as a decision record argues for the gate pattern.
3. **Does the Portfolio ship in v1** or does v1 end at the position's lever line? The portfolio is the
   commercial close but needs the triage flow; the map + positions deliver the "insights pop" goal alone.
4. **Walls and the narrow/median classifier** are the two new judgments - green-light the bounded-judgment
   round (cheap, cached per condition group) or ship v1 with walls hand-flagged?
5. **Naming.** "Positions / strongholds / walls / leaks" is the working vocabulary - it is vivid and maps
   to the playbook, but it's a brand-voice call.
