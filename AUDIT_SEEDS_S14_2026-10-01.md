# Seed audit after s14 - Jira, American Express, Google Pixel (2026-10-01)

Scope: the SEED of every cell (165 seeds: Jira 59, AmEx 55, Pixel 51) from the regenerated batteries in the session scratchpad (`seeds_<brand>.json`). Paraphrases were excluded on purpose. I judged each seed against the decided contracts in the brief and against the s14 writer rules and design intents (commit 407783e: `CELL_WRITER_SYSTEM`, `stageDesignIntent`, `seedDesignLine`). `seedFlags` is null on all 165.

Severity: **S1** ship-blocker / **S2** high (biases a measurement) / **S3** medium (fix at the gate) / **S4** low (polish).

---

## Counts

| Prior class | Verdict | Where |
| --- | --- | --- |
| M1 - label opener leak + lost circumstance | Opener: **FIXED**. Lost circumstance: **RECURS** (S3) | jira [19], [23] |
| J2 - pricing as a worth-it verdict with no usage | **FIXED** | - |
| J5 - objection as a neutral rules/eligibility lookup | **FIXED** (one borderline, S4) | amex [34] |
| J6 - worry cell asks for cost accounting | **RECURS** in a mutated form (S3) | jira [54] |
| J9 seed - "a Mastercard card", "for credit cards" tail | **FIXED** | - |
| J10 - offensive-alternatives leave-reasons | **FIXED** | - |
| J11 - defensive alternatives voiced as a prospect | **FIXED** | - |
| J12 - segment vocabulary in the text | **RECURS**, residual only (S4) | jira [14] |
| J18 - overloaded 5-6-part seed | **RECURS**, and worse (S3) | pixel [8], [38], [39]; jira [24], [38] |
| J19 - one seed, two readings | Original instance **FIXED**. **RECURS** in a new place (S3) | pixel Platform switcher: [9], [13], [21], [25] |
| J23 - pre-category seed ends in a criteria ask | **FIXED** | - |

New findings (not counting the recurrences above):

| Severity | Count | IDs |
| --- | --- | --- |
| S1 ship-blocker | 0 | - |
| S2 high | 2 | N1, N2 |
| S3 medium | 4 | N3-N6 |
| S4 low | 7 | N7-N13 |

Mechanical gaps (places where seedFlags or the design check should have fired and didn't): 6, listed in section 5.

---

## 1. Verdicts on the prior classes

**M1 - opener: FIXED. Lost circumstance: RECURS (S3).**
- No seed opens with a topic label. Every First-credit-card cell now states the circumstance in the asker's own words: amex [4] "I'm 19, only ever used a debit card", [41] "First time getting a card.", [25] "no credit history, first real job".
- Two colon-header seeds are acceptable because the header IS the asker's circumstance: amex [38] "Setting up our first business card: 8 employees..." and jira [38] "setting up our first project management tool for a small dev startup: 12 people now...". I am noting the shape only. The label-leak regex passes both.
- Lost circumstance. Two Mid-market scale-up cells say nothing about size or growth, so their per-scenario read is just a generic feature ask:
  - jira [19] "Which project management tools have a built-in cross-project dependency view you can use out of the box?"
  - jira [23] "Quarterly planning is messy. We need to map cross-team work, tie it to OKRs, and see capacity before we commit. Which tools do that best?"
- Weaker versions (S4): jira [11] "a fast growing dev org should consider" is third-person and has no size. amex [7] "best everyday credit cards that are simple to use with no rotating categories?" drops the "replace" circumstance.

**J2 - FIXED.** Every pricing seed carries usage inputs, and none presupposes a verdict. The old offender is now proper math: amex [40] "I fly about 8 times a year... spend roughly 6k dining, 5k groceries, 4k airfare yearly. Would an American Express Platinum actually come out ahead for me...". The fix overshot in the other direction, though (see J18 and N5).

**J5 - FIXED.** Every objection states a claim that an answer can confirm or rebut. Borderline (S4): amex [34] "The American Express welcome bonus rules confuse me... How easy is it really to get a bonus without tripping a rule?" The "really" carries the doubt, but the stated claim is the asker's own confusion, which an answer settles by explaining the rules. Watch whether the premise verdict comes out n/a on this cell.

**J6 - RECURS in a mutated form (S3): jira [54].** The method ask is gone, but a figure ask with usage inputs has replaced it. See the ruling in section 4.

**J9 (seed parts) - FIXED.** amex [32] reads "American Express or a Mastercard, which would you go with and why?", and the stored classPhrase is "a Mastercard". Neither class seed has a category tail. One new asymmetry is reported as N8.

**J10 - FIXED.** All 13 offensive-alternatives seeds give no reason for leaving, for example jira [51] "We're moving off Trello. Which project management tools should we test?". This is over-corrected into a template (N4).

**J11 - FIXED.** Every defensive seed now implies a current customer:
- jira [48] "If we decided to leave Jira..."
- amex [45] "I'm on American Express now but thinking about leaving."
- pixel [43] "If I move off Google Pixel..."

The jira and pixel versions are hypothetical "if" forms, but leaving presupposes being on the product, so they pass.

**J12 - RECURS, residual only (S4).** "mid-market" appears nowhere. One leftover: jira [14] "what should we prioritize for an **enterprise standard** so it scales". The same sentence already says it plainly ("picking one project management tool for the whole company"), so the label phrase adds nothing. Fix: drop "for an enterprise standard". The tier names in jira [36] ("Premium vs Enterprise") are product vocabulary, not a leak.

**J18 - RECURS, and worse (S3).** Every seed over 55 words is a pricing seed: pixel [37] 85 words, [38] 74, [39] 98, [40] 68; amex [39] 80; jira [38] 73. Multi-part asks:
- pixel [39] (98 words): seven usage items, a five-item parenthetical "(camera, battery, screen smoothness, storage, update years)", and two asks.
- pixel [38]: six usage items, then "A-series vs the regular Pixel, what I'd actually pay over those years with updates, repairs, and resale, and which comes out the better buy".
- jira [38]: three asks, "can we live on a free plan... ballpark what we'd spend per month... and how you'd judge if the time saved covers the subscription".
- Requirement lists outside pricing: pixel [8] has five requirements ("solid battery, durable build, okay camera, and good parental controls. fun colors are a plus"). jira [24] has four ("kanban to start, easy backlog grooming, light docs for specs, and connects cleanly to our git repo and pull requests").

This is exactly what the s14 rule forbids: "a five-part requirements ask is survey-speak whatever the words". Fix: one usage sentence plus one or two asks.

**J19 - original FIXED; RECURS elsewhere (S3).** pixel [6] now reads one way ("best smartphones to grab on a carrier trade-in"). The Platform switcher scenario never says which direction the asker is switching:
- [9] "best smartphones for switching platforms cleanly?"
- [13] "phones that make switching ecosystems painless"
- [21], [25] "switching platforms"

An iPhone user going to Android and an Android user going to iPhone need opposite answers, so these seeds measure an engine's guess at the direction. The blind rule forbids "iPhone", which is what produces the contortions: [17] "moving my phone to the other platform", [36] "compared to the other camp", [40] "from a different ecosystem". Fix: give the direction without a roster brand, for example "switching to Android after years on the other side", or decide that the scenario is "leaving iOS" and allow "iOS" as non-roster vocabulary.

**J23 - FIXED.** No pre-category seed ends in a specs or criteria ask. pixel [2] now ends "am i overthinking this?" and pixel [3] ends "how do other parents handle this...".

---

## 2. New findings (ranked)

### S2

**N1 [S2] jira [45] (churn_triggers, "Sluggish at scale") - no keep-or-leave verdict.**
"Our Jira instance gets sluggish at scale with big backlogs and lots of custom fields. Can this be tuned to stay fast, or are we going to keep hitting this wall?"
The alternatives offered are fix it or keep suffering. Leaving is not on the table, so this is a problem_resolution ask filed as churn, and the cell's keep-vs-leave measurement is empty for all 10 prompts. The design check let it through (gap G1). Fix: "...or is it time to move off Jira?"

**N2 [S2] jira [26] (social_validation) - a calendar year in a tracker prompt.**
"What are dev teams actually using for project management in **2026**?"
This prompt goes stale on the first 2027 wave. Editing it later changes the prompt's identity and breaks the trend. Fix: "right now", which amex [26] and pixel [26] already use. There is no mechanical check for this (G4).

### S3

**N3 [S3] Renewal seeds bolt a "cheaper" ask onto concerns that are not about price.**
- jira [53] (concern "Roadmap and lock-in fears"): "...If we bail, any cheaper options that won't trap us as hard?"
- jira [55] (concern "Low team adoption"): "...cut seats or switch to something simpler and cheaper?"

Each adds the price worry, which already has its own cells (jira [35], [54]), to a different concern. That muddies concern-level attribution in the doubt view and makes price look bigger than it is. Each also asks for alternatives, which is the defensive cell's job (jira [48]). Fix: drop "cheaper" and the alternatives sub-ask. Keep the keep-or-leave verdict.

**N4 [S3] Offensive alternatives have collapsed into the writer prompt's example sentence.**
- pixel [44]-[47] are the same text apart from the name: "We're moving off Apple iPhone / Samsung Galaxy / Xiaomi / OnePlus. What should we look at instead?"
- jira [49] is the example from `CELL_WRITER_SYSTEM` word for word. amex [46] "We're moving off Chase credit cards. What should we look at instead?" is almost word for word.
- Defects that come with the copy: "We" for a personal phone; the roster string "Apple iPhone", which no buyer says (pixel [27] correctly uses "iPhone"); and no category anchor on any of the four Pixel seeds ("moving off Xiaomi" could mean the whole ecosystem).

Measurement is intact, but these read as machine-written, which is the over-correction the brief asked about. Fix: keep "no reason given" but vary the voice and use the buyer's form of the name ("Done with my iPhone - what phone should I get instead?"). Have the writer prompt say its example is not a template.

**N5 [S3] Pricing seeds have become number-stuffed calculator problems.**
- pixel [37]: "$700 trade-in and $28 a month for 36 months... their $65 plan... about $800... my $25 BYOD plan... around $250... run the math on 3 years". The answer is carrier-plan arithmetic, and Google Pixel is incidental to it. The cell is typed within_brand, but it will carry almost no signal about the brand.
- amex [39]: "2,100 a month on it: roughly 800 groceries, 400 dining, 250 gas, 350 travel... carry around 800 for a month... a 95 to 250 fee". The occasional balance pulls APR into a fees-vs-rewards question.

Every quantity has to survive all 9 paraphrases, so the seed_number_changed check gets brittle. The s14 rule asks for usage as an input, not a spreadsheet. Fix: two or three round figures at most. Keep the brand at the center of within_brand asks.

**N6 [S3] Generic pricing cells are typed open_choice but never ask for a pick, and Pixel has no generic pricing cell.**
- jira [38] (free vs paid), amex [38] ("Is a no-annual-fee card fine here, or does a premium business card usually pay for itself"), amex [39] ("paid vs no-annual-fee"), amex [41] ("keep it no annual fee, or does paying around $95 a year usually come out ahead").
- All four are typed open_choice, so they pool into the headline pick and win rates while asking only about the tier or the math. That pulls the naming rate down.
- All four Pixel pricing seeds name the brand (within_brand), so Pixel has no category-level value read, although the stage hint says "some generic... some naming the client brand".
- Probable driver: the pricing design intent judges every pricing seed as "asks for <brand>'s price/value accounting", including generic ones (G6).

Fix: either type generic pricing cells as their own view rather than open_choice, or have them end with a pick ("...and which card would you get?").

### S4

- **N7 jira [27]-[30] - a grammar regression from s14's comparison shape.** "Jira or Asana for **project management tools**: which would you go with...". The plural category is dropped into the singular slot in all four seeds; before s14 they read "as a project management tool". Fix: substitute a singular category form into the "for <category>" slot, or drop the clause as amex/pixel do.
- **N8 amex [31] vs [32] - the two class cells are not parallel.** [31] "American Express or **just** a Visa card" frames Visa as the plain default, and [32] has no "just". The two prompted class rates are not comparable. Drop "just" (it came from the writer prompt's own example, "or should I just get a Visa card?").
- **N9 The usage data contradicts itself.**
  - amex [40]: "fly about 8 times a year" but "hit lounges a couple times a month".
  - pixel [38]: "Budget about 400 to 500... A-series vs the regular Pixel". pixel [39]: "could stretch to 500... spend more for the regular Pixel". The regular Pixel is above both budgets, so the comparison inside the budget is not a real one.
- **N10 Churn keep-or-leave is weak in two more seeds.** jira [44] "Is Jira still the right choice for us or are we fighting the tool?" leaves the exit implicit. pixel [42] "can it be fixed? Debating if I should stay" states the stay question but asks the fix question (the J8 shape at seed level). Make "or should we move off it?" explicit.
- **N11 Planning vocabulary and templated phrasing.** pixel [38] "run the **value math**" uses our own design-line label ("Question design (value math)"). "run the math" also appears in pixel [37] and amex [39]. All four jira business_case seeds turn on a "CFO case" ([40] and [43] both open "Help me make the CFO case"), and [42] gives a 12-person startup a CFO.
- **N12 pixel [33] (concern "Video still trails iPhone") presupposes the answer.** "How far behind is it on video quality and stabilization?" asks how big the gap is, which presumes there is one. Prefer "...is it actually behind?" so the answer can rebut.
- **N13 Single-seed reads.**
  - pixel [22] "If I upgrade on a carrier deal, I'm in weak signal areas a lot": the carrier-deal circumstance is grafted onto an unrelated signal need.
  - pixel [26] "feel like part of their identity": brand-strategy language.
  - amex [42] "**If** Amex is my main card": it is their main card, so the "if" makes it hypothetical.
  - pixel [24] "night games": sports or gaming.
  - amex [7] and [11] share the same distinctive constraint ("no rotating categories"), so discovery and shortlist are near-duplicates.

---

## 3. Cross-cell checks

- **Concern vs text:** every doubt seed voices its assigned concern as the main point. The only contamination is the "cheaper" add-on in jira [53] and [55] (N3).
- **Duplicates:** pixel [44]-[47] (N4) and amex [7]/[11] (N13). The parallel head-to-head template and the by-design worry pairs at both stances (jira price, admin and lock-in; amex annual fee; pixel overheating) are intended. One more convergence: pixel [38], [39] and [40] all reduce to "A-series vs the regular Pixel" across three scenarios.
- **Scenario variation:** every scenario is carried in most of its cells. Exceptions: jira Mid-market [19], [23] (M1 recurrence), and pixel Platform switcher's missing direction (J19).
- **Blind stages and comparison neutrality:** clean. No brand names appear in blind seeds. No comparison seed carries a role, a quantity, an occasion or a criteria list.
- **Out of seed scope, noticed:** jira's roster still has no Linear, even though s14 widened the prefill to fix exactly that. The draft probably kept its old roster, so re-prefill before the next walk.

---

## 4. Ruling: jira [54]

> "We're at about 240 seats on Jira Cloud, mostly dev + PM + QA. The bill is getting painful. Is Jira still worth it at this size, or should we downshift to something cheaper? Rough ballpark on what we should be paying, given we run sprints, lots of automations, and a few service projects?"

**Violation (S3). It is an accounting ask, not part of the verdict.**
- The verdict is complete without the tail: "Is Jira still worth it at this size, or should we downshift to something cheaper?"
- The tail asks a separate question: what the account should cost, with usage supplied as inputs ("given we run sprints, lots of automations, and a few service projects"). That is the decided pricing shape word for word: "the accounting with the asker's usage as an INPUT". The boundary rule says worries "never ask for a spreadsheet".
- It doesn't technically break the written rule, which bans asking "how to calculate or compare costs" (method), not asking for the result. That is the only reason the design check passed it (G2).
- It costs the measurement in two ways. Answers will spend their length on Standard/Premium seat pricing, which weakens the confirm/rebut premise verdict. It also duplicates the pricing cell jira [37] ("which tier fits and what ballpark monthly cost").

Fix: delete the last sentence. If the 240-seat detail should stay, keep it as context: "We're at about 240 seats... the bill is getting painful. Is Jira still worth it at this size, or is it time to move to something cheaper?"

---

## 5. Mechanical gaps (where seedFlags or the design check should have fired)

- **G1. The doubt design intent never asks for a keep-or-leave verdict.** `stageDesignIntent` has one doubt line shared by objections, churn_triggers and renewal. It demands a voiced doubt but never "for churn/renewal the asker weighs staying vs leaving". That is why jira [45] passed (N1), and jira [44] and pixel [42] passed weakly. Fix: add a churn/renewal clause.
- **G2. The doubt line bans cost method but not cost figures.** "never asks how to calculate or compare costs" does not cover "what should we be paying, given <usage>". jira [54] passed because of this. Fix: "never asks for a price, a cost figure or the accounting - with or without usage".
- **G3. `scenarioLabelLeak` only catches the full label or a "Label:" opener.** jira [14] "an enterprise standard" passes. The writer rule is the only net for segment vocabulary such as "mid-market"; nothing mechanical checks for it. A small list of segment terms (mid-market, enterprise-wide, SMB, scale-up) would be a cheap check.
- **G4. No year check.** jira [26] "in 2026" passes. Flag `\b20\d\d\b` in any seed of a recurring tracker.
- **G5. No length or list check.** A 98-word seed with a five-item parenthetical (pixel [39]) passes cleanly. A word-count ceiling (about 60) or a check for comma lists of five or more items would have caught all six J18/N5 seeds, which are exactly the over-55-word seeds.
- **G6. Generic pricing is judged against a brand-specific intent.** The pricing intent says "asks for <brand>'s price/value accounting" even for cells that should not name the brand. This likely pushes the writer toward within_brand (pixel 4 of 4, jira 3 of 4). Fix: split the intent by qtype.
