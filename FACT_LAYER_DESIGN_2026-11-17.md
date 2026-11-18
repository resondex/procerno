# One fact layer under the whole dashboard (design, 2026-11-17 - NOT built, for Tyler's review)

Read `ENGINE_INVENTORY_2026-11-17.md` first: it is the evidence this design answers.

## 1. The aim, in one sentence

Every number, name and list on the dashboard is LOOKED UP from one set of counted facts; no screen counts anything
for itself.

Then two screens cannot disagree, because there is only one copy of each fact; a link from the Brief to a card is a
lookup, not a search; and a sentence cannot state something that was never counted.

## 2. Why not "make everything read the cards"

That is what the work on 2026-11-17 did for the Brief, and it was the wrong foundation for the rest:

- the cards disagree with themselves (inventory, section 4), so they cannot be the definition of anything;
- the Overview reports things no card shows, and the Data page makes any table you ask for - neither can "read a card";
- a card is a layout. Its numbers should come from somewhere, like everyone else's.

What carries over from that work: the IDs, the rule that a sentence is written from fact objects, the checks, and the
snapshot of live to test against.

## 3. The four layers

```
coded answers + setup + dictionary + saved model results
        |
   1. ANSWER FACTS   one resolved record per answer        (what is true of each answer)
        |
   2. MEASURES       one rulebook: numerator, base, legal question types   (how to count)
        |
   3. SELECTIONS     named lists with one rule each         (who and what gets named, and in what order)
        |
   4. STATEMENTS     findings, claims and sentences that cite facts and selections by ID
        |
   cards · Map · Overview · Brief · Data page · written memos      (layouts and wording only)
```

### Layer 1 - Answer facts: what is true of each answer

One record per answer, computed once per run. It is the only place a brand name is resolved and the only place the
basic ideas are defined:

- **the question**: its type, buying situation, worry, the rival or class it names, the product line asked about, the
  assistant;
- **the pick**: none, a brand in the category, or something outside it - one definition;
- **every brand named**, with whether it was recommended or spoken of negatively, in order of appearance, and whether
  it is in the category - one definition of "named" and one of "recommended";
- **every verdict** the question type asks for, with ONE rule for a missing value;
- **arguments and topics**;
- **where the buyer is sent** (other brands, your own other products, nowhere);
- **the conditions the AI states**: who each sends the buyer to, its group and its theme - one grouping per run;
- **pairings, product names, the price question's "instead"** - the pieces the Data page's row leaves out today.

This is the Data page's existing per-answer row, widened. It already exists for about two thirds of this.

### Layer 2 - Measures: how to count

One rulebook, widened from the Data page's. Each measure states, once:

- its plain name ("share of picks");
- what counts (the numerator) and out of what (the base);
- which question types it is legal on - asking for it elsewhere is refused, not approximated;
- how it is printed (whole points; one decimal under 10%; "<1%"; "never" / "every" at the ends).

**A fact** is a measure, about a subject, in a scope - with its two counts:

```
share of picks | Disney+ | Netflix, what to buy, all buyers, all assistants   ->  157 of 668
```

That triple is the fact's ID. It does not depend on any screen, so it survives a card being redesigned. Where a fact
is DRAWN (which card, which part, shown at once or behind a click) is a separate index from fact ID to location - that
index is what a Brief link looks up.

The floors and tests live here too, in one table: the minimum of 20 answers, when two figures count as "apart", what
"close" means. Today there are at least five versions of some of them.

### Layer 3 - Selections: who gets named, and in what order

Every list the product shows becomes a named selection with ONE rule:

- the competitor group on a card (by your ruling: the top three by picks, plus head-to-head rivals not among them);
- the leader in a buying situation, and how ties break;
- the conditions shown for a side, and their order;
- the AI's "what to look for" list;
- the brands on the visibility chart.

A selection has an ID like a fact does. A screen shows it; it never rebuilds it.

### Layer 4 - Statements: sentences that cite what they say

A finding, a Map claim, a card's takeaway line and a Brief sentence are all the same kind of thing: a template plus the
fact IDs and selection IDs it prints. Deciding whether to write it, and how to word it ("rarely", "most", "the main
threat"), reads those same facts.

So the Overview's finding and the Brief's sentence about the same thing are one statement shown in two places - not two
calculations that are supposed to match.

## 4. What each screen becomes

| Screen | Today | After |
|---|---|---|
| Cards, By rival | Count from the raw answers, 5,000 lines | A layout: which facts and selections go where |
| Map cells and claims | Their own older calculation | Statements over the same facts as the card they open |
| Overview | Its own detectors over the views by question type | The same detectors, reading facts |
| Brief | Two thirds from card IDs, one third quoted or its own | Statements only; links are lookups |
| Data page | Its own row and rulebook | The same answer facts and the same measures, cut any way |
| Written memos | Text in, numbers matched back by words | The writer is given facts with IDs and must keep each ID on its number |
| Views by question type | Eleven separate engines | Removed as counters; "Question type detail" becomes a layout |

## 5. The rulings (Tyler, 2026-11-17)

| # | Question | Ruling |
|---|---|---|
| 1 | A verdict the coder left blank | Not a ruling. No screen reads a field the question type does not ask; the rulebook refuses it. A blank where a verdict IS asked is a coding error (none exist in the 32,214 coded answers). |
| 2 | Arguments "when another brand is picked" | Other picks in the category only. |
| 3 | Price: "points to a rival" | Of all price answers, each answer in one bucket. |
| 4 | A condition's share | Of all the answers to that question. |
| 5 | Problem questions "outside the category" | "Adjacent" only; "none" is shown as its own share. |
| 6 | Is a pick a recommendation? | Yes, everywhere. |
| 7 | The all-buyers "What to buy" | The sum of the buyer cards. What's popular and Premium vs basic keep their own cards and are not in it. |
| 8 | Brands marked "not for analysis" | Out of every brand count and never listed. Every pick falls in exactly one of three buckets: a brand in analysis, **outside of analysis**, or outside the category. "Outside of analysis" is its own bucket, never folded into "outside the category". Share of picks is out of picks of brands in analysis, so it adds to 100%. Everything recomputes when the analysis set changes. |
| 9 | "Agrees the worry is fair" | Of the answers that agree, partly agree or disagree. "Partly agrees" counts as taking a side (Tyler). This is what every screen does today, so nothing moves. |
| 10 | Conditions in the Overview's findings | Each question type on its own, so a finding matches the card it opens. |
| 11 | "Converts" | One rule: the visibility view's (at or above the level line). |

Confirmed by Tyler the same day:
- **Commit rate** = the share of answers that pick one brand in analysis, so "commits in X%, picked Y% of the time it
  does, Z% of all answers" multiplies out. "Outside of analysis" and "outside the category" are shown beside it.
- **12. A pick outside the category is never "no single pick".** On "what happens to the recommendations" and every
  list like it, the card shows it as "outside the category", its own share.
- **13. Premium vs basic: an answer with no stance is its own share**, never added into "balanced".

The list of every number each ruling moves, measured on the test copy of all six trackers: `RULING_MOVES_2026-11-17.md`
(raw data in `~/Documents/procerno_eval/engine_inventory_2026-11-17/rulings/`). Ruling 7 moves 6,789 drawn numbers; under it
What's popular answers need their own group on the Data page.

## 6. How to build it without breaking what works

The measurement gives a safety net: about 2,840 figures already agree across every calculation. The new layer must
reproduce those exactly; the only numbers allowed to move are the ones your rulings move, and each is listed first.

1. **Rulings** (section 5), with the list of what each changes.
2. **Build layers 1 and 2** beside the existing code. Prove on the snapshot that they reproduce every agreeing figure.
   Nothing on screen changes.
3. **Layer 3**, the selections, starting with the competitor group.
4. **Move the cards onto it.** The cards' drawn numbers must match before and after, except where a ruling says
   otherwise.
5. **Move the Map's cells and claims and the Overview's findings onto it** - this also removes the Brief's quoted third.
6. **Move the Data page onto it.**
7. **Written memos carry IDs**; delete the word matching.
8. **Delete the old counters** and the unused files.

Each step ships on its own, is checked against the snapshot, and leaves the product working.

## 7. What it costs, honestly

- It is the largest change since the dashboard was rebuilt: the four files that count today are about 15,000 lines.
  Steps 2 to 5 are the bulk. I would not promise it in days; I would promise each step is provable.
- No new data and no new model calls are needed. The one-off costs are rewriting the written memos (about $2) and
  regrouping conditions once if ruling 10 changes the grouping.
- The risk is in step 4: the cards are what you look at most. The mitigation is the exact before-and-after comparison
  on the snapshot of live, card by card.
- What it does NOT fix by itself: whether a model-written group name describes its members, and whether the coder's
  labels are right. Those are upstream of counting.

## 8. Alternatives considered

- **Keep converting one screen at a time onto the cards** (today's path): rejected - section 2.
- **Only reconcile the definitions, keep five counters**: cheaper, and it would make today's numbers agree, but nothing
  would stop them drifting apart again; every new feature would add a sixth.
- **Compute facts on demand, per request, with no stored layer**: simplest to build, but the Overview alone needs
  thousands of facts per open and the Brief needs them for 139 subjects.
