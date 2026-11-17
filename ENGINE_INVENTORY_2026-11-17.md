# Where every number comes from today (inventory, 2026-11-17)

What this is: a list of every place the dashboard counts something, what it counts, and where two places count the
same thing differently. It was read from the code by four read-only passes and then MEASURED on the snapshot of live
(all six trackers, about 3,200 figures compared). The five source reports and the raw comparison data are in
`~/Documents/procerno_eval/engine_inventory_2026-11-17/`. The design that answers this is `FACT_LAYER_DESIGN_2026-11-17.md`.

## 1. The short version

- There are FIVE places that count, not one: the Overview's findings, the Map's cells and claims, the cards, the Data
  page, and the older views by question type that sit under the Overview and "Question type detail".
- **The basic counts agree.** Named, recommended, picked, share of picks, the commit rate, direct matchups, switching,
  and the worry verdicts come out identical everywhere they are computed: about 2,840 of about 2,842 comparisons, and
  the two exceptions are one name-resolution bug.
- **The disagreements are definitions, not arithmetic.** Where two places differ, each is counting correctly under
  its own rule about what to include and what to divide by. There are roughly forty such rules in conflict. Eleven of
  them change numbers on screen today (section 3).
- **The cards are not internally consistent either**, so "make everything read the cards" would have locked the
  conflicts in.
- **The Data page already has the right shape** - one row per answer and one rulebook of measures - but nothing else
  reads it, and it leaves out things the other screens need.

## 2. What each place computes

| Place | Code | What it produces | Read by |
|---|---|---|---|
| Views by question type | headline, head_to_head, alternatives, doubt, value, reasons, awareness, repertoire, premium, settled, rules explorer | One set of rates per question type, each with its own rules for missing values and for what counts as "another brand" | The Overview's findings (recomputed inline), Question type detail, By rival |
| Brand summary + findings | brand_summary.ts, summary_insights.ts | The pooled brand table, 30 or so detectors, the verdict sentences | Overview, Map tensions, the Brief's quoted findings |
| The Map | analysis_map.ts | Each cell's line, claim, verdict colour, badges, figures, moves; the casting | Map, Overview, the Brief's quoted claims and moves, By rival landing |
| The cards | panel_build.ts (about 5,000 lines) | 17 card types and the By rival pages; every drawn number has an ID by location (stat_registry.ts) | Map panels, By rival pages, the Brief's own sentences |
| The Data page | workbench.ts, measures.ts, pivot_compute.ts | One row per answer; about 55 measures, each with a numerator, a base and the question types it is legal on | Data page tables only |
| The Brief | brief.ts | About 140 kinds of sentence | Brief, written memos |

The Brief by kind of sentence: about 78 print a card's figure, 14 read a name or list from a card, 12 groups are quoted
from Overview findings (covering about 20 findings), 8 are quoted from the Map's claims, moves or casting, 10 are still
worked out by the Brief itself, and 20 are wording with no data. So about two thirds are backed by a card.

## 3. Disagreements that change a number on screen (measured)

| # | What is counted | Where it differs | Size on the snapshot |
|---|---|---|---|
| 1 | Price: "points the buyer to a rival" | Cards: of ALL price answers, each answer in one bucket (rival, then own option, then nowhere). Data page and price view: of the doubting answers only | Pixel "First phone for teen": 70 of 130 against 40 of 57 |
| 2 | Price: "your own cheaper option" | Cards: answers whose ONLY suggestion is your own option, of all answers, and only for brands with a product ladder. Price view: any own option, of the doubting answers | Jira "Client-facing delivery": 18 of 130 against 52 of 130 |
| 3 | Arguments "when another brand is picked" | Cards and the argument-lift finding: other picks IN the category. The by-question-type view and the findings that compare sides: any other pick, in the category or not | American Express: base 379 against 398. Pixel parental controls: 45 of 260 against 94 of 309 |
| 4 | A condition's share on the What to buy card | Card: of all the cell's answers. The Map cell behind the same card: of answers that state a condition on that side | Differs in 59 of 60 rows. American Express "Dining is a major expense": 28% against 36% |
| 5 | Which wordings are one condition | Three separate groupings: the Map's, the rules explorer's (one per run), the head-to-head view's (one per kind) | The top five conditions match on 1 of 12 sides |
| 6 | Conditions in the Overview's findings | Counted over EVERY question type; the card counts what-to-buy answers only | 10 of the cards' 60 top conditions are missing from the findings' lists |
| 7 | Problem questions "answered outside the category" | Cards: anything not routed to the category. Everything else: "adjacent" only | Pixel: 518 of 520 against 516 of 520 |
| 8 | Premium vs basic "balanced" | Cards add "none" into balanced | Sephora: 92 of 130 against 90 of 130 |
| 9 | The all-buyers What to buy card | Pools four question types (what to buy for a buyer, what to buy for a job, what's popular, premium vs basic); each buyer's card pools two. The all-buyers card is therefore not the sum of the buyer cards, and the rules explorer's "what to buy" leaves premium out | Doritos, Netflix, Sephora: 1,235 answers against 1,105 |
| 10 | Hulu "named" on Netflix | The same two spellings of "Hulu + Live TV" resolve to Hulu or to unknown depending on which the resolver meets first | 754 of 1,235 on the rival page against 751 elsewhere |
| 11 | Question type detail, a price figure | Numerator counted over the doubting answers, denominator all price answers | A wrong figure, on screen now |

## 4. Rules that conflict in the code but did not change a number on this snapshot

These agree today only because of what the data happens to contain. Each is a number waiting to split.

- **A missing or off-list verdict** is handled five ways: price counts it as "it depends", worries as "no side",
  problem routing as "none", the Data page leaves it out of every share (so three shares need not add to 100%), and the
  settled questions put it in no bucket.
- **"Agrees the worry is fair"** has three bases: answers that took a side; every answer with any judgement recorded
  (so "not applicable" counts); and the Map's own "conceded" side.
- **"Named"** has three definitions on the cards (any brand in the dictionary; only brands marked for analysis; mentions
  only, ignoring the pick).
- **"Recommended"** counts a pick as a recommendation everywhere except problem questions, where your bar counts it
  and the rival's bar beside it does not.
- **Brands marked "not for analysis"** are left out of the Overview's board rows while their picks stay in its total,
  so the board need not add to 100%.
- **A head-to-head against a rival that cannot be resolved** is a loss in one place and "another brand" in the Data page.
- **"Which argument wins"** is computed five ways with five different minimum sizes (20 a side and 2%; 10 a side and
  5%; 10 a side and no floor; and two more).
- **"One AI company supplies the picks"** has two rules (the Map's watch badge and the Overview's finding).
- **"Converts"** in The diagnosis (share at least a quarter of the named rate) is not the visibility view's rule
  (at or above the pooled line), so the two can call the same brand differently.
- **"Picks another brand" on the Habit card** counts picks outside the category; the picks board does not.
- **A buying situation's open-choice figures** come from two question types on the Map and from any open question
  pinned to that situation in the findings.
- **The competitor list** differs between two blocks of one card (class brands left out of the bars, kept in "Who
  takes the picks") - and by ruling is about to change to "top three by picks plus head-to-head rivals".
- **Minimum size for an AI-company breakdown** is 3 answers in one place and 10 in others.

## 5. Faults found on the way (not design questions)

1. Name resolution depends on the order names are met when two spellings share a normalised form (the Hulu case).
2. The price figure on Question type detail (row 11 above).
3. "Most of the answers that pick the rival still say when to choose you" prints "most" whenever any exist.
4. A written memo is saved against its text, so when links move without the text changing (126 did on 2026-11-17)
   saved memos keep their old links.
5. A written memo's numbers are checked for existing in the fact sheet, not for staying with their subject; outside
   the SWOT only an instruction to the model prevents a figure moving to another brand.
6. The Overview's commit rate is worked out in the page, not in the engine.

## 6. What is unused

`summary_views.tsx`, `rivals_view.tsx` and `head_to_head_view.tsx` are imported by nothing live; the Data page's payload
still carries its first version's rollups; the metrics, insights and slices routes serve only trackers with no codes
source.

## 7. What was not covered

Claims made in words alone were catalogued for the Brief only, not for the Overview's finding sentences or the cards'
one-line takeaways. Setup, the dictionary board and Run history were out of scope. Disagreements were measured on one
wave of six trackers.
