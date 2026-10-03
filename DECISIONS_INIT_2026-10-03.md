# Init decisions (2026-10-03)

**All four are DECIDED, including Decision 3's companion rules 3b and 3c (confirmed 2026-10-03). None are built yet.**

**Where these come from.** All three surfaced in the 2026-10-03 init audit (`INIT_AUDIT_2026-10-03.md`).

**Where the examples come from.** Every example is a real cell from the five setups you walked and saved, quoted from the saved drafts.

**How cells are referenced.** Cells are named the way the grid shows them:
- **Stage · Scenario column** for scenario cells, e.g. *Pricing / value · Switching from iPhone*.
- **Stage · worry** for worry cells.
- **Stage · rival** for rival cells.

**Status.** Nothing below is built yet. Each decision gets a short call, and I build whichever way you decide.

---

## Decision 1 - DECIDED (Tyler, 2026-10-03): Pricing is a scenario row

**Grid stage:** *Pricing / value* (decision layer). It's one row with a cell per scenario column - 4 cells in each of these batteries.

### The rule this settles

**Every grid row varies on exactly one thing.** Its cells are identical on everything else.

| kind of row | what changes between cells | rows | what a cell is read as |
| --- | --- | --- | --- |
| **Scenario row** | the buyer's situation | Problem recognition, Discovery, Shortlist, Criteria, Feature screening, Use-case fit, **Pricing / value** | the same question asked by a different kind of buyer - read per buyer type |
| **Topic row** | the subject | Comparison (one rival per cell), Alternatives (one rival exit per cell), the worry rows (one worry per cell) | a different subject, circumstance held neutral - read per subject |

### What it is now: Pricing behaves like both kinds at once

- Pricing cells sit in the scenario columns, which makes them a scenario row.
- But the writer prompt and the cross-cell **pricing diversity pass** force every cell onto a different trade-off, which makes them a topic row.
  - The pass is a claude-sonnet-5 call that labels each seed's trade-off and regenerates repeats (`instrument.ts` ~3630).
  - The writer rule reads "at most ONE pricing cell per trade-off shape", and "at least one" cell must name the brand.
- **Where the force came from.** One audit finding (s20, 2026-10-01): AmEx shipped three fee-vs-no-fee cells, reasoned as "four fee-vs-no-fee cells measure one question four times".
- **Why that reasoning doesn't hold.** "One question, four times" is exactly what every other scenario row does on purpose. It also contradicts the decided circumstance/doubt boundary, which pins pricing to scenarios because "a business spender and a student legitimately get different answers".

**The result: each pricing cell pairs a different trade-off with a different buyer, so it can be read neither per buyer nor per trade-off.**

Pixel today:

| grid cell | seed (abridged) | what it weighs |
| --- | --- | --- |
| Pricing / value · Carrier trade-in upgrade | "800 in bill credits over 36 months... take the credits, or buy unlocked?" | payment method, no brand |
| Pricing / value · Unlocked direct buy | "latest Pixel at 699 or Pixel Pro at 999?" | Pixel tier vs tier (and states prices - the one S1) |
| Pricing / value · Switching from iPhone | "sell my current phone for about 300, or a carrier promo at 25 a month for 36 months" | payment method, no brand |
| Pricing / value · Flagship photography & AI | "0% financing over 24 months... financing vs buying outright" | payment method, no brand |

Doritos today:

| grid cell | seed (abridged) | what it weighs |
| --- | --- | --- |
| Pricing / value · Family stock-up run | "BOGO on the name-brand... or the store brand?" | name brand vs store brand, no brand named |
| Pricing / value · Game-day hosting | "two party-size bags, or regular-size bags on a 2-for deal?" | pack size, no brand |
| Pricing / value · Taco-night fixings | "one party-size bag... or two regular bags of flavored chips?" | pack size, no brand |
| Pricing / value · Convenience snack grab | "single-serve Doritos each visit... or one Party Size and portion it out?" | Doritos pack size |

Netflix today:

| grid cell | seed (abridged) | what it weighs |
| --- | --- | --- |
| Pricing / value · Building the streaming stack | "keep two paid services all year, or rotate one month at a time?" | rotation strategy, no brand |
| Pricing / value · Must-watch release signup | "is the ad plan fine or worth paying for ad-free for the month?" | ads vs ad-free, no brand |
| Pricing / value · From shared to own | "pay for a plan with downloads, or use free ad-supported apps and rent?" | paid vs free, no brand |
| Pricing / value · Kids-first household | "For Netflix, is the cheaper ad plan fine or should we pay for Standard?" | Netflix tier |

Only one cell per battery says anything about the client brand's value. The other three measure payment mechanics that no dashboard view reads per brand.

### What it will be: same value question, one per buyer

**Every pricing cell asks the client brand's value question, and only the buyer changes:**

- **Names the brand** - must-name, replacing "at least one cell names the brand".
- **Weighs its price against a cheaper option.** That option is the brand's own lower tier or plan, or a generic cheaper alternative ("a store brand", "a cheaper phone", "a cheaper streamer").
  - It **never names a rival** - head-to-heads belong to Comparison.
  - It never states a price, so the r12 stated-price rule still applies.
- **Gives that column's buyer usage as the input** ("I keep phones 3 years", "we host 12 people", "two kids, 10 hours of cartoons a week").
- **Asks for the call:** worth paying for, or take the cheaper option?

**The read:** for which buyer types the AI says the brand is worth the money. It's comparable across columns and across waves.

**Price-structure doubts move to the worries rows.** Questions like "the fee isn't worth it" or "the ad tier is annoying" are verdicts about the brand, so the worries rows already own them (for example *Objections / risk · worry "Ads tier frustrations"*).

Pixel - what it would be (illustrative wording; the writer still writes it):

| grid cell | today | would be |
| --- | --- | --- |
| Pricing / value · Carrier trade-in upgrade | credits vs unlocked, no brand | "Carrier's pushing a trade-in deal. I keep phones about 3 years and mostly text, stream and take photos of the kids - is a Pixel worth it for that, or should I take a cheaper phone?" |
| Pricing / value · Unlocked direct buy | Pixel at 699 vs Pro at 999 | "Buying unlocked and keeping it 4 years. I shoot a lot. Is the Pixel Pro worth paying up for over the regular Pixel, or is the regular one plenty?" |
| Pricing / value · Switching from iPhone | sell vs carrier promo, no brand | "Moving from iPhone to Android. For a first Android phone I'll keep 3 years, is a Pixel worth the money, or is a cheaper Android just as good for a switcher?" |
| Pricing / value · Flagship photography & AI | financing vs outright, no brand | "I shoot about 150 photos a month and edit some 4K on my phone. Is a Pixel worth the price for that, or would a cheaper phone do the job?" |

Doritos - what it would be:

| grid cell | today | would be |
| --- | --- | --- |
| Pricing / value · Family stock-up run | name brand vs store brand, unbranded | "We go through about 4 bags of tortilla chips a month. Is Doritos worth paying more for, or is the store brand just as good for a family stock-up?" |
| Pricing / value · Game-day hosting | party-size vs 2-for, no brand | "Hosting 12 for the game with salsa and queso. Worth getting Doritos for the spread, or are cheaper tortilla chips fine for a crowd?" |
| Pricing / value · Taco-night fixings | pack size, no brand | "Taco night for 5, about 10 bucks for chips. Are Doritos worth it next to tacos, or should I grab a cheaper plain tortilla chip?" |
| Pricing / value · Convenience snack grab | Doritos single-serve vs Party Size | "I grab a snack bag about 4 times a week at the bodega. Is Doritos worth the extra each time, or do cheaper chips hit the same?" |

Netflix - what it would be:

| grid cell | today | would be |
| --- | --- | --- |
| Pricing / value · Building the streaming stack | keep two vs rotate, no brand | "Three of us watch about 25 hours a week on a 30-a-month budget. Is Netflix worth keeping in the lineup year-round, or is a cheaper service better value?" |
| Pricing / value · Must-watch release signup | ads vs ad-free, no brand | "Signing up for a month to binge one show, about 15 hours. Is Netflix worth paying for, or would a cheaper service's catalog do?" |
| Pricing / value · From shared to own | paid plan vs free apps, no brand | "Getting my own login after sharing. About 2 hours a night plus weekend movies. Is Netflix worth paying for, or would free ad-supported apps cover me?" |
| Pricing / value · Kids-first household | Netflix ad plan vs Standard | "Two kids, about 10 hours of cartoons a week, plus a family movie most weekends. Is Netflix's ad plan enough for us, or is paying up for Standard worth it?" |

### What changes in the engine (to build)

1. **Pricing design intent** (`stageDesignIntent` / `seedDesignLine`) is rewritten to the shape above:
   - names the brand;
   - weighs its price against its own cheaper tier or a generic cheaper option;
   - uses the column's buyer usage as the input;
   - asks for the call;
   - never names a rival, never states a price.
2. **Pricing brand mode** becomes must-name, so every pricing cell requires the client brand. The "at least one brand-named pricing cell" steer is removed.
3. **The cross-cell pricing diversity pass is removed**, and with it the "at most one cell per trade-off shape" writer rule. The trade-off labeler and the "pay now vs pay over time" class question disappear along with it.
4. **Writer prompt (`CELL_WRITER_SYSTEM`)** - the pricing paragraph is rewritten, including the old "the cheaper line at 450" example. This needs a **STYLE bump**, which redraws every cell. Batch it with the other queued writer changes.
5. **Records:**
   - AGENTS.md's circumstance/doubt boundary entry gets the row rule and this ruling.
   - The handoff and audit brief drop their "at most twice" wording.
   - Tyler's 2026-10-02 ruling (1) - generic payment-method cells don't feed the headline - becomes moot, because there are no generic pricing cells.

**Open detail for the build:** in categories with no meaningful cheaper option at the brand's own level, the cheaper side is the generic category alternative. That fits jira ("a cheaper project tool") and AmEx ("a no-annual-fee card"), and the design check enforces it the same way as the rest of the intent.

---

## Decision 2 - DECIDED (Tyler, 2026-10-03): no duplicate rows, and every stage only where its buyer exists

Two rules, decided together:

1. **No two rows ask the same question** (Decision 1's row rule, applied across rows). This merges Discovery and Shortlist in every category.
2. **Each stage assumes a particular buyer, and it's recommended only in categories where that buyer exists.** This generalizes the snack findings to every habitual category. It rides the classification the engine already makes, so no new field is needed.

### The classification it uses (already in the engine)

Every brand's setup classifies its category on fixed dimensions (`classifyModerators`, shown as chips in the setup banner). Two of them decide which buyers exist:
- `involvement`: **considered** (people deliberate) or **habitual** (bought on habit or impulse; everyone in the market already buys the category).
- `rhythm`: **one_shot** (each purchase a fresh decision), **replenishment** (the same consumable rebought), or **subscription** (renews by default).

| brand | involvement | rhythm |
| --- | --- | --- |
| Jira | considered | subscription |
| American Express | considered | one_shot |
| Google Pixel | considered | one_shot |
| Netflix | considered | subscription |
| Doritos | **habitual** | replenishment |

Other habitual categories this would cover: coffee, beer and soft drinks, toothpaste and household cleaners, fast food, gas stations, beauty consumables, OTC remedies.

### Which buyer each stage assumes

| grid row | the buyer it assumes | recommended when | today | change |
| --- | --- | --- | --- | --- |
| Problem recognition | someone with a need who isn't in the category yet | considered | always | **considered only** - habitual markets have no one outside the category |
| Category education | someone who studies what the category is | considered + think | considered + think | unchanged |
| Discovery / shortlist | someone asking which brands to get | always | two rows, Discovery + Shortlist | **merged into one row, every category** |
| Comparison | someone weighing named rivals head-to-head | always | considered only | **always** - "Doritos or Takis for game day?" is a real habitual ask |
| Premium vs. basic / Splurge or save | someone weighing premium makers vs basic ones | habitual | habitual | unchanged (it now sits beside Comparison instead of replacing it) |
| Objections / risk (pre-purchase worry) | a prospect who isn't a customer yet | considered | always | **considered only** - in habitual markets the prospect is already an eater |
| Churn triggers (in-relationship worry) | a current customer doubting the brand | always | always | unchanged; in habitual markets it's the ONLY worry stance |
| Renewal | a customer at a default-renew moment | subscription | subscription | unchanged |
| Repertoire | a repeat buyer deepening or breaking the habit | replenishment | replenishment | unchanged |

**Worries gate:** stance chips are offered only for the worry rows the category recommends. A habitual category's worries come in one stance (in-relationship), with no "both", so each worry is one cell: a current buyer's doubt that ends in keep or switch.

### What it is now (the evidence)

**Discovery and Shortlist ask the same question in every category.** Both ask the AI to "name a few"; only the list length differs ("a few" vs "3 or 4").

| grid cell | Discovery | Shortlist |
| --- | --- | --- |
| Jira · Enterprise consolidation | "best project management software for consolidating multiple dev teams into one system with SSO and solid reporting. name a few to look at?" | "For consolidating engineering orgs under one system, give me 3 or 4 project management software to evaluate. Must support SSO and robust reporting." |
| AmEx · Everyday cashback pick | "Looking for a simple everyday cash back credit card... Name a few I should check out." | "I'm replacing my everyday credit card with a straight cash back one... Can you name 3 or 4 solid cash back cards?" |
| Pixel · Unlocked direct buy | "Best smartphones to buy direct right now? Prefer clean software and fast updates." | "Name a short list of smartphones to consider with clean software and fast updates." |
| Netflix · Must-watch release signup | "Best streaming video services for a one-month signup to catch a new season, then cancel cleanly?" | "I just want a one month signup to binge it and then cancel. which streaming video services are good for that?" |
| Doritos · Family stock-up run | "Best tortilla chips for a weekly family stock-up?... Which ones should I get?" | "Can you name 3 or 4 tortilla chip options that are reliable for family pantry stock-ups and stay tasty after opening?" |

**Problem recognition in a habitual market produces complaints about the asker's own product:**
- *Problem recognition · Family stock-up run*: "The kids crush **my chips** in a day or they sit open and go stale."
- *Problem recognition · Game-day hosting*: "**my chips** keep snapping in the dip and making crumbs everywhere."

**Two worry stances in a habitual market ask the same eater the same thing twice:**
- *Objections / risk · "Feels pricey for chips"*: "Doritos feels pricey for a bag of chips. Am I just paying for the name...?"
- *Churn triggers · "Feels pricey for chips"*: "Doritos keeps creeping up in price... keep buying Doritos or bail?"
- *Objections / risk · "Messy orange dust"* opens "**I like Doritos** but..." - a current eater in the prospect stance.

**Comparison is off in habitual markets today:** Doritos has no head-to-head at all.

### What it will be

| grid row | Doritos now | Doritos after | Jira / AmEx / Pixel / Netflix after |
| --- | --- | --- | --- |
| Problem recognition | 4 | 0 | unchanged (considered) |
| Discovery + Shortlist | 4 + 4 | 4 ("Discovery / shortlist") | 4 + 4 → 4 |
| Objections / risk + Churn triggers | 4 + 4 (two worries asked twice) | one Churn-triggers cell per worry | unchanged (prospect and customer are different people) |
| Comparison ("Dupes & alternatives" for taste markets) | 0 | 4 | unchanged |
| **total cells** | **43** | **~33-35** | **4 fewer each** |

Example habitual worry cell (one stance): "I buy Doritos a lot but they've gotten pricey for a bag of chips. Am I just paying for the name - keep buying them, or switch to something cheaper?"

### Watch-outs

- **The classification is a model call** (cached per category + audience), so a borderline category can land on either side. Example: a premium coffee subscription could read as considered or habitual. The chips show it in the setup banner. If it's wrong there, every downstream stage choice follows it, so the banner should let the user flip `involvement` (to check: whether it's editable today).
- **Overlap to keep in view in habitual markets:** *Splurge or save* (blind: "are premium tortilla chips worth it over store brand - which would you get?") and Decision 1's pricing row ("is Doritos worth it vs a cheaper option, for this buyer") are different instruments:
  - Splurge or save is blind and asks for an open pick; pricing names the brand and asks for a value verdict.
  - Both stay, but the design lines must keep them apart.
- **This reverses a past design choice.** Comparison's old rationale was "habitual buyers don't run head-to-heads - the shelf question carries this moment". That rationale is retired by this decision.

### What changes in the engine (to build)

1. `stageLibrary`:
   - remove `shortlist`, folding its hint into `discovery` (label "Discovery / shortlist");
   - `problem_recognition` recommended only when `involvement === "considered"`;
   - `comparison` recommended always;
   - `objections` recommended only when considered.
2. Worries gate:
   - stances come from the recommended worry rows, as today;
   - for habitual categories that leaves only in-relationship, so no "both" chip is offered.
3. `RETIRED_STAGES` gains `shortlist`, so saved drafts drop it at the generation boundary. Existing projects keep their collected shortlist prompts.
4. No STYLE bump: stage lists and stances are request data, so they self-version. Records go to AGENTS.md.

---

## Decision 3 - DECIDED (Tyler, 2026-10-03): you pick the head-to-head rivals (max 4), from recommendations made at init

**Grid rows involved:** these are both topic rows, one cell per rival:
- *Comparison* ("<brand> or <rival> - which would you pick?");
- *Alternatives* ("leaving <rival>, what instead?", plus one defensive "if we leave <brand>" cell).

The cap stays at **4 rivals** (`ANGLE_SLOTS = 4`), so cost doesn't change. What changes is **who chooses the 4**.

### What it is now

- The 4 slots go to the **first 4 direct rivals in competitor-list order** (`angleRivals`, `battery_checks.ts`).
- The order comes from the brand-profile model's ranking.
- The market step can only remove or add competitors, and additions go to the end. Nothing tells you that the top 4 get head-to-heads.
- Every other rival is still measured in open questions (named in Discovery etc.), but gets no head-to-head and no switching cell.

What that produced:

| brand | competitor list (order) | gets *Comparison* + *Alternatives* | left out |
| --- | --- | --- | --- |
| Jira | Asana, Trello, Monday.com, ClickUp, GitHub Issues, Azure DevOps, Linear | Asana, Trello, Monday.com, ClickUp | GitHub Issues, Azure DevOps, **Linear** |
| Doritos | Tostitos, Takis, Cheetos, Lay's, Pringles, Mission, Ruffles | Tostitos, Takis, Cheetos, Lay's | Pringles, **Mission**, Ruffles |

The left-out brands include Linear, the rival a software-dev buyer weighs most, and Mission, an actual tortilla-chip brand. Meanwhile Cheetos takes a slot, which produces *Alternatives · leaving Cheetos*: "Quitting Cheetos. Point me to a few tortilla chip alternatives."

### What it will be

**A head-to-head pick step at the market step, built like the worries gate:**

- **Every competitor chip shows a "head-to-head" toggle.** Up to 4 can be on, with a counter ("4 of 4 head-to-heads"). The toggles stay independent of list order, so reordering isn't needed.
- **At init the engine pre-selects its recommended 4, each with a one-line reason.** For example: "Linear - the rival dev teams most often weigh against Jira". You can swap any of them.
- **Picks follow your toggles, not list order.** *Comparison* and *Alternatives* cells are minted only for the toggled rivals.
- **Untoggled rivals stay fully measured.** They're named in open questions, forbidden in brand-blind cells, and counted on the dashboard. They just get no head-to-head cell.
- **After the first wave**, the observed data (alone-share and co-mention with the client brand) can propose swaps at the gate. This is the post-wave re-rank already on the to-do list.

**How the init recommendation is made:**
- Roster typing (`classifyRoster`, already a model call at the market step) also ranks the direct rivals by **how often buyers weigh each one against the client brand**, judged against the confirmed category, and gives the reason line.
- This is model judgment before any data exists. It's better than today's list order because it's asked the right question (head-to-head likelihood, not general fame), but it can still miss. The visible toggle is the safety net.

### What it would be

**Jira** (illustrative recommendation): Asana, Linear, monday.com and GitHub Issues pre-selected. Trello stays available to toggle; it's Atlassian's own product (see 3c). ClickUp and Azure DevOps are measured but have no head-to-head unless you swap them in.

**Doritos** (illustrative): Tostitos, Takis and Mission pre-selected. Cheetos, Lay's, Ruffles and Pringles aren't in the confirmed category, so they're not offered as head-to-heads (see 3b). The 4th toggle stays open for a tortilla-chip brand you add, such as Santitas or a store brand.

### Two companion rules - DECIDED (Tyler, 2026-10-03)

**3b - Out-of-category brands never get a head-to-head toggle.**
- Roster typing gains a third role, **adjacent**: a brand that competes for the same occasion but isn't in the confirmed category (Cheetos, Lay's, Ruffles and Pringles for tortilla chips).
- They stay in the roster and stay measured, but get no toggle.
- If you widen the category ("salty snacks"), they become direct rivals again.

**3c - Sister brands get a "same parent" tag and report separately.**
- Roster typing returns each brand's parent company.
- Sister brands (Trello for Jira; Tostitos for Doritos) can be toggled like any rival, because "Jira or Trello?" is a real high-volume question.
- On the dashboard, their head-to-heads report as **portfolio routing** ("how the AI splits buyers between your own brands"), separate from the competitive win rate.

**Not covered here:** Pixel's iPhone typed `upstream` in your saved draft. That's a roster-typing error - platform makers that sell the product directly are never upstream - and it's fixed separately. Upstream brands never get a toggle.

### What changes (to build)

1. **Market step UI:**
   - a head-to-head toggle per direct-rival chip, max 4, pre-set from the recommendation, with the reason on hover;
   - "adjacent" and "same parent" tags (3b/3c).
2. **Roster typing (`classifyRoster`):**
   - a head-to-head rank plus reason per direct rival;
   - the `adjacent` role;
   - a `parent` field.
3. **Slot filling:** `angleRivals` reads the stored head-to-head picks when present, and falls back to "first 4 direct rivals in list order" for drafts without picks.
   - The picks ride the cells request as data, so they self-version: unchanged picks keep every cached cell, and only cells for swapped-in rivals generate.
   - Picks persist in the draft and on the project, like worries.
4. **Dashboard:** a portfolio-routing view for sister-brand head-to-heads, built with the per-type dashboard views.
5. **Records:** AGENTS.md's nonexistent "gate drag" stopgap is corrected.

---

## Decision 4 - DECIDED (Tyler, 2026-10-03): scenarios are contested buyer occasions, described in the buyer's outcome language

**Grid area:** the scenario columns. These are the rooms that every scenario row (Problem recognition, Discovery / shortlist, Criteria, Feature screening, Use-case fit, Pricing / value) is asked in.

### The rule

A scenario (a "room") is:
1. **A buyer occasion in the confirmed category** - who the buyer is, the situation they're in, and the outcome they want.
2. **Written in the buyer's outcome language** - the need every contender's pitch speaks to ("wants the best camera they can get"), not one brand's pitch vocabulary.
3. **Contested** - most of the direct rivals are plausible contenders for that buyer.

**Brands tailor their selling points to the rooms that matter, so the client being strong in a room is expected and fine.** The rival test doesn't ask whether a room favors the client. It asks whether the rivals are in the room too:
- a Pixel-strong room where iPhone, Galaxy and OnePlus all compete passes;
- a room that is really the client's other product's category fails.

The same three rules apply wherever buyer circumstance is written:
- the scenario read;
- the fit advisory's suggestions;
- the audience line;
- brand-blind cells, where the writer voices the room's buyer need.

### How brand knowledge reaches scenarios today

Brand knowledge reaches the scenarios at three places, plus the cell writer:

1. **Fit advisory suggestions.** After the scenario read, a brand-aware check proposes a "missing core" scenario from the client's portfolio. Your saved drafts accepted two:
   - Pixel - *Flagship photography & AI*: "Buying **the top-tier Pixel** for best camera, AI features, and performance...". It names the client and is built on Pixel's pitch.
   - Jira - *IT/service desk adoption*: "selects a service-management platform (helpdesk, incident, change)". The advisory's reason was "Jira offers Jira Service Management as a distinct product". None of Jira's project-management rivals compete there.
2. **The audience line.** The brand profile writes it at the market step, and the scenario read and every cell writer read it.
   - Pixel: "buyers wanting a **clean, Google-powered Android** smartphone". That's why "clean Android" appears in three of Pixel's four scenario descriptions.
3. **The brand-aware scenario read (`forBrand`).** An optional mode the advisory offers to multi-product brands, so that rooms are occasions that brand competes in. Room choice is brand-driven by design; wording is told to stay blind.
4. **The cell writer.** Every cell's spec carries the target brand, so a brand-blind Discovery cell is written knowing it's for Pixel.
   - Saved Pixel: 12 of 17 blind cells use "clean software and fast updates" as the buyer's criteria.

The default scenario read itself sees only category and audience, not the brand. With a neutral audience and no advisory additions, its rooms come out clean, as Doritos and AmEx show.

### What it will be

| | today | with the rule |
| --- | --- | --- |
| Pixel scenario | *Flagship photography & AI* - "Buying the top-tier Pixel for best camera, AI features..." | *Photo-first flagship buyer* - "shoots a lot, wants the best camera phone at the top of the market, keeps it for years". iPhone, Galaxy and Pixel all contend. |
| Pixel audience | "buyers wanting a clean, Google-powered Android smartphone" | "people choosing a new smartphone - upgraders and switchers" |
| Pixel blind-cell criteria | "clean software and fast updates" | "a phone that stays fast and keeps getting updates for years" - an outcome Samsung and Apple also promise |
| Jira scenario | *IT/service desk adoption* (Jira Service Management's category) | fails the rival test; the advisory proposes a contested room instead, e.g. *Small team picking its first tracker* |

### In practice - what the user sees

- **At the market step,** the audience reads as a buyer segment ("people choosing a new smartphone"), not a tagline. It stays editable.
- **At the scenarios gate,** every scenario card carries a contest chip: *"Contested: iPhone, Galaxy, OnePlus, Motorola (4 of 5 rivals)"*.
  - A room with few contenders shows amber - *"Few of your rivals compete here (1 of 6)"* - with the reason and a one-click near-neighbor swap toward a contested version.
  - The user can keep it anyway. It's a call, not a block, because a niche room can be deliberate.
- **Advisory suggestions** arrive already written to the rule and already contest-checked. A suggestion that fails is never offered.
- **Your saved Pixel and Jira drafts** get the amber chip on *Flagship photography & AI* (wording, and the name check) and on *IT/service desk adoption* (contest) the next time they're opened. Nothing changes until you act.

### In practice - what changes in the engine (to build)

1. **Scenario read (`readScenarios`).**
   - The prompt is rewritten in the three positive rules.
   - The cache key bumps (`scenarios_journeys13` -> 14), so new trackers get rule-written rooms. Saved drafts keep their reviewed scenarios.
2. **Contest check (new, at the scenarios gate).**
   - One call per battery to the design-check model (claude-sonnet-5, low effort), with each room plus the tracker's direct-rival list. It returns which rivals contend in each room and whether the wording carries one brand's pitch vocabulary.
   - Cached per room set and roster; a few cents per tracker.
   - It runs per tracker because the base read is category-level and shared, and it never sees a roster.
3. **Fit advisory.**
   - Its suggestion prompt gets the three rules.
   - Before a suggestion is offered, it must pass the contest check and the r15 brand-mention check on its label and description. This extends last night's pre-check (6459e90).
4. **Audience (brand profile).**
   - The prompt asks for "who the buyers are and what they're trying to get done, in category terms".
   - The profile cache key version bumps, so new profiles get it and saved drafts keep theirs.
5. **Scenario gate brand check.** Every scenario label and description, including user-typed ones, runs through the r15 brand-mention check. "the top-tier Pixel" gets a flag wherever it came from.
6. **Brand-blind cells.**
   - The design intent for every blind stage adds: "voice the room's buyer need as an outcome any contender's pitch could answer".
   - The design check is given the direct-rival list so it can judge that. It enforces per seed and per paraphrase.
   - The design line changes, so cached cells re-judge through the design-check keys (sonnet calls, not free) and only failing cells regenerate.
   - **No STYLE bump.**
7. **Records:** AGENTS.md gets the rule.

---

## Summary

| # | decision | recommendation | biggest visible effect |
| --- | --- | --- | --- |
| 1 | pricing - DECIDED | Pricing is a scenario row: every cell asks "is <brand> worth it vs a cheaper option, for this buyer"; the trade-off diversity pass is removed | Pixel/Doritos/Netflix pricing rows go from 1 brand-value cell + 3 unbranded payment-mechanics cells to 4 comparable brand-value cells, one per buyer type |
| 2 | duplicate rows + stage buyer fit - DECIDED | Discovery + Shortlist merged in every category; habitual categories (existing `involvement` classification): Problem recognition off, one worry stance (in-relationship), Comparison on | every battery 4 cells lighter; habitual brands like Doritos 43 -> ~33-35 with head-to-heads added and no repeated questions |
| 3 | head-to-head rivals - DECIDED | user toggles up to 4 head-to-head rivals at the market step, pre-selected from an init recommendation with reasons; 3b: out-of-category brands typed `adjacent` (measured, no toggle); 3c: sister brands toggleable, tagged "same parent", reported as portfolio routing | Jira can carry Linear; Doritos's head-to-heads go to tortilla-chip brands; cost stays at 4 rivals |
| 4 | scenarios - DECIDED | rooms are contested buyer occasions in the category, in the buyer's outcome language; a contest chip at the scenarios gate (which rivals compete per room); the same rules for advisory suggestions, the audience line and blind cells | Pixel's "top-tier Pixel" room and Jira's help-desk room get flagged; audience reads as a segment; blind cells stop borrowing the client's pitch words |
