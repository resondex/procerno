# Category-specific examples in the setup (init) engine - inventory

Snapshot of master at commit `1c0213d` (STYLE s34, SEED_RULES r15), read 2026-10-03 22:00 PT. That commit landed while this inventory was being taken; every line number below was re-resolved against it. The one quote the user cited ("stays fast and keeps getting updates for years") was REMOVED in s34 from `battery_checks.ts` outcomeClause, along with the wish-list examples ('great camera, strong battery life and years of updates', 'SSO, reporting and automations'). Everything below is still live.

Scope: string literals the setup engine sends to models (system/user prompts, stage hints, design lines, steer and finding text fed back into rewrites) plus the deterministic word lists that judge output. Code comments are excluded. Read-only inventory; no repo file was changed.

**Columns.** Kind: `EX+` positive example (shown as what to write), `EX-` negative example (shown as what not to write - still primes), `INST` an instruction that only makes sense for that category. Flow: `writer` = text the cell, paraphrase or scenario WRITER reads (copy path); `judge` = a checker reads it; `classifier/advisory` = typing or advice calls; `UI only`; `never sent`; `gated off`. Risk: `H` positive example on the writer path, specific enough to reappear verbatim; `M` primes a category frame or a client selling point, or a negative example on the writer path; `L` judge-only, classification-only, or harmless.

## Summary

**200 items** (98 positive examples, 56 negative examples, 46 category-only instructions). 142 reach a writer. Risk: 28 high, 53 medium, 119 low. Excluding generic-only items: 158 category-specific items.

### By category (an item that cites several categories counts once in each)

| Category | Items | On writer path | High | Medium | Low |
| --- | --- | --- | --- | --- | --- |
| Phones (Pixel, iPhone, Android, Samsung) | 49 | 30 | 11 | 10 | 28 |
| Credit cards (AmEx, Visa, Mastercard, Chase, Citi) | 42 | 29 | 9 | 11 | 22 |
| Project management / B2B software (Jira, monday.com, Atlassian) | 64 | 42 | 8 | 25 | 31 |
| Streaming / subscriptions (Netflix) | 21 | 12 | 5 | 2 | 14 |
| Snacks / CPG (Doritos, tortilla chips, store brand) | 18 | 10 | 2 | 4 | 12 |
| Beauty retail (Sephora, sunscreen) | 7 | 5 | 0 | 2 | 5 |
| Email marketing | 1 | 1 | 1 | 0 | 0 |
| Mattresses (Purple) | 2 | 1 | 1 | 0 | 1 |
| Supplements / professional services (AG1, audits) | 6 | 1 | 0 | 1 | 5 |
| Other (Costco, Intel, Target, CRM, EVs, senior living) | 4 | 0 | 0 | 1 | 3 |
| Generic (no category) | 49 | 40 | 1 | 5 | 43 |

### Named client / rival brands cited (items that cite or target them)

Pixel 22, Jira 22, AmEx 21, iPhone 9, Visa 9, Doritos 7, Netflix 6, Mastercard 4, AG1 3, monday.com 2, Sephora 2, PwC 1, Costco 1, Target 1, Chase 1, Citi 1, Max 1, Prime Video 1, OnePlus 1, Bank of America 1, Intel 1, Purple 1, Samsung 1

### By prompt / function

| Prompt / function | File | Items | High | Medium | Low |
| --- | --- | --- | --- | --- | --- |
| DIMENSION_GUIDE (classifyModerators, classifyJourney, readScenarios, reviewJourneyFit) | instrument.ts | 7 | 0 | 0 | 7 |
| stageLibrary hint (writer plan line, reviewCells stage line, phrasings [stage guidance]) | instrument.ts | 8 | 0 | 4 | 4 |
| stageLibrary why (UI hover only) | instrument.ts | 1 | 0 | 0 | 1 |
| readScenarios system prompt (scenario write, gpt-5) | instrument.ts | 9 | 4 | 2 | 3 |
| SITUATION_TEMPLATE (suggestScenario) | instrument.ts | 3 | 0 | 1 | 2 |
| suggestScenario | instrument.ts | 1 | 0 | 1 | 0 |
| suggestScenario + nearScenarios | instrument.ts | 1 | 0 | 0 | 1 |
| nearScenarios | instrument.ts | 3 | 1 | 1 | 1 |
| reviewScenarios | instrument.ts | 2 | 0 | 0 | 2 |
| reviewJourneyFit (advisory) | instrument.ts | 5 | 0 | 2 | 3 |
| reviewScenarioFit | instrument.ts | 1 | 0 | 0 | 1 |
| checkRooms (room contest check, sonnet) | instrument.ts | 4 | 0 | 1 | 3 |
| DESIGN_CHECK_SYSTEM | instrument.ts | 2 | 0 | 0 | 2 |
| DESIGN_CHECK_SYSTEM_V2 (off unless DESIGN_CHECK_V2=1) | instrument.ts | 4 | 0 | 0 | 4 |
| reviewCells brand rule (its suggestion REPLACES fresh seeds in generateGrid) | instrument.ts | 2 | 0 | 1 | 1 |
| reviewCells system prompt | instrument.ts | 1 | 0 | 0 | 1 |
| CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | instrument.ts | 54 | 14 | 13 | 27 |
| generateWorries | instrument.ts | 2 | 0 | 1 | 1 |
| concern plan (legacy, no worry picks) | instrument.ts | 2 | 0 | 0 | 2 |
| seedRule finding detail (fed verbatim into the brand-rule heal steer; shown as gate chip) | instrument.ts | 8 | 1 | 1 | 6 |
| seedRule regexes (deterministic, never sent) | instrument.ts | 1 | 0 | 0 | 1 |
| concern-diversity labeler (sonnet) | instrument.ts | 2 | 0 | 0 | 2 |
| regenerateCell near-variant system add-on | instrument.ts | 1 | 0 | 0 | 1 |
| generatePhrasings seed-line notes | instrument.ts | 3 | 0 | 1 | 2 |
| generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | instrument.ts | 11 | 1 | 5 | 5 |
| STAGE_ASK_WORDS (retry exempt list, never sent) | instrument.ts | 1 | 0 | 0 | 1 |
| outcomeClause (appended to blind-stage design lines) | battery_checks.ts | 1 | 0 | 0 | 1 |
| seedDesignLine (paraphrase design judge) | battery_checks.ts | 4 | 0 | 1 | 3 |
| seedDesignLine (paraphrase design judge) / stageDesignIntent | battery_checks.ts | 1 | 0 | 0 | 1 |
| stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) | battery_checks.ts | 20 | 3 | 12 | 5 |
| specWriterNote (rides on every blind spec cell's seed line in the paraphrase writer) | battery_checks.ts | 1 | 1 | 0 | 0 |
| statedPriceFinding detail (heal steer) | battery_checks.ts | 1 | 0 | 0 | 1 |
| deterministic word list (judge only, never sent) | battery_checks.ts | 6 | 0 | 0 | 6 |
| classifyRoster system prompt | roster.ts | 8 | 1 | 1 | 6 |
| suggestBrandProfile (category, rivals, audience prefill) | suggest.ts | 4 | 1 | 0 | 3 |
| classifyNonBrands (post-run junk filter, not setup) | suggest.ts | 1 | 0 | 0 | 1 |
| lintAndRepair (classic battery path) | suggest.ts | 3 | 0 | 1 | 2 |
| generateBatteryAi (classic battery path) | suggest.ts | 8 | 1 | 3 | 4 |
| generateBatteryAi branded probes (fixed text) | suggest.ts | 1 | 0 | 0 | 1 |
| generatePromptBattery fallback templates | prompts.ts | 1 | 0 | 1 | 0 |
| suggestBrandAliases | brand_aliases.ts | 1 | 0 | 0 | 1 |

## src/lib/engine/instrument.ts (139 items)

| # | Line | Prompt / function | Quoted text | Category / brand | Kind | Flow | Risk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I1 | 395-396 | DIMENSION_GUIDE (classifyModerators, classifyJourney, readScenarios, reviewJourneyFit) | software and equipment evaluated through demos are spec even when marketed on 'experience' or 'usability' | Project management / B2B software | INST | classifier/advisory | L | Classification tiebreak; never reaches prompt text. |
| I2 | 397 | DIMENSION_GUIDE (classifyModerators, classifyJourney, readScenarios, reviewJourneyFit) | taste = ... (food, fragrance, comfort) | Snacks / CPG; Beauty retail; Mattresses | EX+ | classifier/advisory | L | Classification only. |
| I3 | 399 | DIMENSION_GUIDE (classifyModerators, classifyJourney, readScenarios, reviewJourneyFit) | trust = ... (advisory services, audits, supplements' efficacy) | Supplements / professional services (AG1, PwC) | EX+ | classifier/advisory | L | Classification only. |
| I4 | 400-401 | DIMENSION_GUIDE (classifyModerators, classifyJourney, readScenarios, reviewJourneyFit) | if buyers run demos and compare feature sheets, it is spec | Project management / B2B software | INST | classifier/advisory | L | Classification only. |
| I5 | 406 | DIMENSION_GUIDE (classifyModerators, classifyJourney, readScenarios, reviewJourneyFit) | subscription = ... (SaaS seats, retainers, auto-renewing audits) | Project management / B2B software; Supplements / professional services | EX+ | classifier/advisory | L | Classification only. |
| I6 | 409 | DIMENSION_GUIDE (classifyModerators, classifyJourney, readScenarios, reviewJourneyFit) | one_shot = ... (projects won case-by-case, device upgrades) | Supplements / professional services; Phones | EX+ | classifier/advisory | L | Classification only. |
| I7 | 415 | DIMENSION_GUIDE (classifyModerators, classifyJourney, readScenarios, reviewJourneyFit) | channel_retail: true ... (retail/DTC goods) | Snacks / CPG; Beauty retail | EX+ | classifier/advisory | L | Classification only. |
| I8 | 510 | stageLibrary hint (writer plan line, reviewCells stage line, phrasings [stage guidance]) - problem_recognition | The thing the buyer already owns is named plainly ('my phone'), never contorted around ('my pocket gadget') | Phones | EX+ | writer | M | Sent with every problem_recognition cell in every category - non-phone studies get a phone example. |
| I9 | 519 | stageLibrary hint (writer plan line, reviewCells stage line, phrasings [stage guidance]) - category_education | ('what does a X actually do') | Generic | EX+ | writer | L | A shape template; can converge every category_education seed on one sentence. |
| I10 | 575 | stageLibrary hint (writer plan line, reviewCells stage line, phrasings [stage guidance]) - comparison (taste markets) | (a dupe or 'similar but cheaper' framing is fine as long as it asks for the pick) | Beauty retail | EX+ | writer | M | Invites 'cheaper' into taste-market head-to-heads. |
| I11 | 590 | stageLibrary hint (writer plan line, reviewCells stage line, phrasings [stage guidance]) - premium_worth | whether the premium maker genuinely beats the basic/store option | Snacks / CPG | INST | writer | L | Grocery 'store option' vocabulary; fine for habitual markets. |
| I12 | 621 | stageLibrary hint (writer plan line, reviewCells stage line, phrasings [stage guidance]) - business_case | justifying the client brand, by name, to a CFO, procurement or a security review | Project management / B2B software | INST | writer | M | Committee markets only. The same trio is in the writer rule (I99) and the design intent (B22) - three copies, gets reproduced verbatim. |
| I13 | 655 | stageLibrary hint (writer plan line, reviewCells stage line, phrasings [stage guidance]) - expansion | ONE specific growth step (more teams, seats or uses) | Project management / B2B software | EX+ | writer | M | Expansion is recommended for EVERY market, so 'teams/seats' reaches Doritos, Netflix, AmEx. Also in I100, B6, B27. |
| I14 | 661 | stageLibrary hint (writer plan line, reviewCells stage line, phrasings [stage guidance]) - ecosystem | add-ons, companions, integrations | Generic; Project management / B2B software | EX+ | writer | L |  |
| I15 | 635 | stageLibrary hint (writer plan line, reviewCells stage line, phrasings [stage guidance]) - alternatives | 'Alternatives to X' asks | Generic | EX+ | writer | L |  |
| I16 | 579, 592, 593 | stageLibrary why (UI hover only) | 'at the shelf' / 'one shelf question' / 'decomposes this moment into Shortlist, Comparison, and Pricing' | Snacks / CPG | INST | UI only | L | Never sent to a model. Stale: Shortlist was retired 2026-10-03. |
| I17 | 892 | readScenarios system prompt (scenario write, gpt-5) | ('Solo founder pick', 'Enterprise procurement') | Project management / B2B software | EX+ | writer | M | Label examples; B2B rooms copy them. |
| I18 | 896-897 | readScenarios system prompt (scenario write, gpt-5) | ('existing carrier customer upgrading with trade-in credits', 'migrating from a legacy tracker') | Phones; Project management / B2B software (Pixel, Jira) | EX+ | writer | H | The room definition's only two examples are a Pixel room and a Jira room; carrier trade-in rooms show up in Pixel walks. |
| I19 | 906-907 | readScenarios system prompt (scenario write, gpt-5) | ('upgrading my Android phone' excludes iPhone buyers - say 'upgrading a phone I've had for years') | Phones (Pixel, iPhone) | EX+ | writer | H | The replacement is offered as the correct room. Loaded: 'had for years' points at Pixel's long-update selling point. |
| I20 | 908-910 | readScenarios system prompt (scenario write, gpt-5) | never built on switching between competing platforms or ecosystems when the category's leading brands are tied to them | Phones | INST | writer | L | A phone-shaped rule; inert elsewhere. |
| I21 | 911-913 | readScenarios system prompt (scenario write, gpt-5) | ('rolling out roadmaps' is a feature; 'a fast-growing team outgrowing its first tool' is a circumstance) | Project management / B2B software (Jira) | EX+ | writer | H | Loaded: the positive circumstance is Jira's 'graduate from a starter tool' pitch; same shape as I24's 'Outgrowing the starter tool'. |
| I22 | 914 | readScenarios system prompt (scenario write, gpt-5) | (scale, composition, constraint, occasion, recipient) | Generic | EX+ | writer | L |  |
| I23 | 924 | readScenarios system prompt (scenario write, gpt-5) | tight budget, compliance constraint, gift deadline - NEVER deviates | Generic | EX+ | writer | L |  |
| I24 | 937-944 | readScenarios system prompt (scenario write, gpt-5) | For 'email marketing platforms / e-commerce brands' the core set might be: 'First store setup' (a shop owner wiring up email before launch weekend), 'Agency managing brands' (one team running campaigns for a dozen clients), 'Outgrowing the starter tool' (lists too big, automations too crude, deliverability slipping), 'Marketing team consolidation' (email, SMS and reviews pulled into one stack under one budget owner) | Email marketing | EX+ | writer | H | Marked 'a bar, never a template', but it is the only worked example: 'outgrowing' and 'consolidation' rooms recur in B2B batteries, and its parenthetical is a wanted-features list that the v16 room rule bans. |
| I25 | 952-955 | readScenarios system prompt (scenario write, gpt-5) | In categories sold to organizations, the large-organization purchase is almost always one of them | Project management / B2B software | INST | writer | M | Forces an enterprise room into every B2B core set. |
| I26 | 1091 | SITUATION_TEMPLATE (suggestScenario) - committee | scale (team/org size), composition (who has to use it), and constraint (budget tier) | Project management / B2B software | INST | writer | L |  |
| I27 | 1093 | SITUATION_TEMPLATE (suggestScenario) - household | occasions, recipients (buying for self vs someone else), and constraints (budget, sensitivities) | Generic | INST | writer | L |  |
| I28 | 1095 | SITUATION_TEMPLATE (suggestScenario) - solo | use-cases, budget tiers, and ecosystem/compatibility constraints | Phones | INST | writer | M | Asks for ecosystem-constraint rooms, which readScenarios and checkRooms now reject as platform-locked - a conflicting instruction. |
| I29 | 1133 | suggestScenario | 'migrating from a legacy tracker', not 'migrating from X' | Project management / B2B software (Jira) | EX+ | writer | M |  |
| I30 | 1134-1137, 1219-1220 | suggestScenario + nearScenarios | never analytical or methodology words like 'default', 'habitual', 'segment', 'use case' | Generic | EX- | writer | L |  |
| I31 | 1209 | nearScenarios | ('Carrier trade-in upgrade' -> 'Carrier upgrade at launch') | Phones (Pixel) | EX+ | writer | H | A Pixel room and its near variant, shown for every category. |
| I32 | 1214-1215 | nearScenarios | NEVER introduce a money angle (lower cost, budget, refurbished, financing, deals) | Phones | EX- | writer | L | Phone money vocabulary, negative. |
| I33 | 1217-1218 | nearScenarios | 'migrating from a legacy tracker', not 'migrating from X' | Project management / B2B software (Jira) | EX+ | writer | M | Second copy of I29. |
| I34 | 1364 | reviewScenarios | (two axes of circumstance in one scenario, e.g. company size AND budget constraint) | Project management / B2B software | EX- | judge | L | Reviewer writes suggested fixes, so this reaches user-facing suggestions only. |
| I35 | 1371 | reviewScenarios | (e.g. 'Startup first-choice' -> 'Startup first-choicer') | Project management / B2B software | EX- | judge | L | Typo illustration. |
| I36 | 1520-1522 | reviewJourneyFit (advisory) | a subscription-first brand in a category mostly rebought off the shelf, a committee-sold brand in a solo-buyer category | Supplements / professional services; Project management / B2B software (AG1) | EX+ | classifier/advisory | L |  |
| I37 | 1523-1524 | reviewJourneyFit (advisory) | (an annual-fee card, a warehouse membership, an auto-renewing plan) | Credit cards; Other (AmEx, Costco) | INST | classifier/advisory | M | Written for AmEx (journey_fit5); steers card brands to a subscription advisory. Advisory only, user decides. |
| I38 | 1527-1528 | reviewJourneyFit (advisory) | A one-off product whose maker ALSO sells add-on services (a phone with a cloud plan) is not. | Phones (Pixel) | EX- | classifier/advisory | L |  |
| I39 | 1530 | reviewJourneyFit (advisory) | a product shared at home is not a household decision unless the household decides together | Streaming / subscriptions (Netflix) | INST | classifier/advisory | L |  |
| I40 | 1539-1542 | reviewJourneyFit (advisory) | Example shape: 'X appears to sell mostly by subscription, so if you are measuring X's own buyers rather than the wider market, subscription may fit better than the market-norm replenishment.' | Supplements / professional services (AG1) | EX+ | classifier/advisory | M | Output-shape example; advisory reasons copy its subscription-vs-replenishment framing. |
| I41 | 1717 | reviewScenarioFit | A room the brand serves with a product in a DIFFERENT category (a separate product line sold to a different kind of buyer) is not a missing core room | Project management / B2B software (Jira (JSM)) | INST | classifier/advisory | L |  |
| I42 | 1885 | checkRooms (room contest check, sonnet) - pitch | Buyer outcomes every contender speaks to ("wants the best camera", "needs it running this week") are not pitch. | Phones; Project management / B2B software (Pixel) | EX+ | judge | M | Judge only, but loaded: it certifies 'best camera' (a Pixel headline strength) as neutral outcome language, so camera-led rooms pass the pitch check. |
| I43 | 1886 | checkRooms (room contest check, sonnet) - capability | ("rolling out portfolio planning", "adopting roadmaps") | Project management / B2B software (Jira) | EX- | judge | L |  |
| I44 | 1887 | checkRooms (room contest check, sonnet) - platformSwitch | (leaving one phone platform for another, moving between app ecosystems) ... Moving off a legacy or homegrown tool is NOT a platform switch. | Phones; Project management / B2B software | INST | judge | L |  |
| I45 | 1888 | checkRooms (room contest check, sonnet) - noChoice | accepting the next model by default, auto-renewing, taking whatever is in stock without comparing | Phones; Streaming / subscriptions; Snacks / CPG | EX+ | judge | L |  |
| I46 | 2023 | DESIGN_CHECK_SYSTEM | "is it still worth it / should I cut it" about the named brand or option | Streaming / subscriptions | EX+ | judge | L |  |
| I47 | 2024 | DESIGN_CHECK_SYSTEM | (use it for more, find products that work with it, recommend or defend it to someone) | Generic | EX+ | judge | L |  |
| I48 | 2042 | DESIGN_CHECK_SYSTEM_V2 (off unless DESIGN_CHECK_V2=1) | ("is acme any good" -> "acme") | Generic | EX+ | gated off | L |  |
| I49 | 2042 | DESIGN_CHECK_SYSTEM_V2 (off unless DESIGN_CHECK_V2=1) | ("our target audience", "an apple a day", "on the dot") | Phones; Other (iPhone, Target) | EX- | gated off | L |  |
| I50 | 2043 | DESIGN_CHECK_SYSTEM_V2 (off unless DESIGN_CHECK_V2=1) | ("the Gold plan is $40", "the big model costs about 300 more") | Credit cards; Phones (AmEx Gold) | EX+ | gated off | L |  |
| I51 | 2045 | DESIGN_CHECK_SYSTEM_V2 (off unless DESIGN_CHECK_V2=1) | (a hardware feature its products lack, a platform it does not run on) | Phones | INST | gated off | L |  |
| I52 | 2251-2252 | reviewCells brand rule (its suggestion REPLACES fresh seeds in generateGrid) | a wording that leaves it implied ("my subscription", "the service") breaks the measurement | Streaming / subscriptions | EX- | writer | L |  |
| I53 | 2254 | reviewCells brand rule (its suggestion REPLACES fresh seeds in generateGrid) - advocacy | a rival may appear only as the counterpart being persuaded ("my iPhone friend says...") | Phones (iPhone, Pixel) | EX+ | writer | M | Shown for every brand's advocacy cells; a ready-made Pixel seed opener, a phone frame elsewhere. |
| I54 | 2296-2298 | reviewCells system prompt | (a pain description that mentions products, a question that trails into what-should-I-look-for) | Generic | EX+ | judge | L |  |
| I55 | 2407-2408 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | no balanced drama ('X is impossible and Y is a nightmare') | Generic | EX- | writer | L |  |
| I56 | 2409 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | no rhetorical closers ('get everyone on the same page') | Project management / B2B software | EX- | writer | L |  |
| I57 | 2420-2421 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - offensive alternatives | a leave-reason that says what the rival lacks or who it fails ('too lightweight for our dev team') | Project management / B2B software (Jira) | EX- | writer | M | Negative, but the reason it names is the one that steers toward Jira. Also in B14. |
| I58 | 2423 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - offensive alternatives | the asker's team or segment identity ('for our dev team') | Project management / B2B software (Jira) | EX- | writer | M |  |
| I59 | 2425-2426 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - offensive alternatives | 'Done with my iPhone - what phone should I get instead?' | Phones (iPhone, Pixel) | EX+ | writer | H | A complete seed. Pixel's offensive cell vs Apple is this sentence; the 'Done with my X - what should I get instead?' frame spreads to every brand. |
| I60 | 2426-2427 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - offensive alternatives | 'leaving monday.com. name a few solid alternatives to try' | Project management / B2B software (monday.com, Jira) | EX+ | writer | H | A complete seed. Jira's offensive cell vs monday.com is this sentence. |
| I61 | 2429 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | use the name a buyer types ('iPhone', never the roster string 'Apple iPhone') | Phones (iPhone) | EX+ | writer | M |  |
| I62 | 2435 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - comparison | No role or identity (a student, a founder, a parent) | Credit cards; Project management / B2B software; Generic | EX- | writer | L |  |
| I63 | 2436-2437 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - comparison | no occasion or project ('setting up', 'replacing', 'for my trip') | Credit cards; Project management / B2B software | EX- | writer | L |  |
| I64 | 2444-2445 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - comparison | keep the category clear (a bank or multi-product company name like Chase or Citi needs it) | Credit cards (Chase, Citi) | INST | writer | M | Names two AmEx rivals in every tracker's writer prompt; only meaningful for card studies. |
| I65 | 2446 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - comparison | grammatical ('as a project management tool', never a plural category pasted into a singular slot) | Project management / B2B software (Jira) | EX+ | writer | H | Positive phrase; Jira comparison seeds reuse it verbatim. |
| I66 | 2450 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - defensive | never a prospect ('if we don't go with it') | Generic | EX- | writer | L |  |
| I67 | 2453-2454 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - class cells | speak the class naturally, the way a buyer does ('or should I get a Visa card?' - no belittling 'just') | Credit cards (Visa, AmEx) | EX+ | writer | H | AmEx class cells ship this clause; shown to every tracker. |
| I68 | 2457-2458 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - class cells | Never append a redundant category clause the class already carries ('a Visa card for credit cards') | Credit cards (Visa) | EX- | writer | L |  |
| I69 | 2462-2463 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - retention/loyalty | an ask that leaves the brand implied ('my subscription', 'the service') is a defect | Streaming / subscriptions | EX- | writer | L |  |
| I70 | 2464 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - retention/loyalty | The relationship is stated as fact ('Amex is my main card') | Credit cards (AmEx) | EX+ | writer | H | AmEx retention cells copy it; other brands copy the 'X is my main <noun>' frame. |
| I71 | 2465 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - retention/loyalty | never hypothetically ('if Amex is my main card') | Credit cards (AmEx) | EX- | writer | L |  |
| I72 | 2469-2471 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - churn/renewal | Both options need not be spelled out ('is Netflix still worth it with these price hikes?' qualifies) | Streaming / subscriptions (Netflix) | EX+ | writer | H | A complete churn seed. Also plants a price-hike trigger in churn cells whose concern is not price, against the rule a few lines later. Repeated in B7. |
| I73 | 2472 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - churn/renewal | pause vs cancel is two ways of leaving | Streaming / subscriptions | INST | writer | L |  |
| I74 | 2477 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - churn/renewal | The leave side stays plain - never 'something cheaper' or 'simpler' | Generic | EX- | writer | L |  |
| I75 | 2482 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - situation | weave the circumstance in naturally, as the asker's OWN situation ('this would be my first credit card', ... | Credit cards (AmEx) | EX+ | writer | H |  |
| I76 | 2483 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - situation | ... 'we're about 120 people and doubling') | Project management / B2B software (Jira) | EX+ | writer | H | Also injected into heals via I116. Loaded: fast growth is Jira's scale pitch. |
| I77 | 2484 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - situation | never as a topic opener ('First card question:') | Credit cards | EX- | writer | L |  |
| I78 | 2485 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - situation | NEVER the scenario's label text ('Party hosting cart' is a plan label, not something a person types) | Snacks / CPG (Doritos) | EX- | writer | L |  |
| I79 | 2486-2487 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - situation | ('mid-market', 'enterprise standardization' are OUR words | Project management / B2B software | EX- | writer | L |  |
| I80 | 2491-2493 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - Value (pricing) | set it against a GENERIC cheaper alternative in the category ('a cheaper phone', 'store-brand chips', 'a no-annual-fee card', 'a cheaper streaming service') | Phones; Snacks / CPG; Credit cards; Streaming / subscriptions (Pixel, Doritos, AmEx, Netflix) | EX+ | writer | H | One ready-made counterpart per example tracker; three of them repeat in B9 (heal steer). |
| I81 | 2495 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - Value (pricing) | give the asker's usage in plain words ('we watch most nights', ... | Streaming / subscriptions (Netflix) | EX+ | writer | H |  |
| I82 | 2496 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - Value (pricing) | ... 'I keep a phone 3 or 4 years'; numbers are allowed, never required) | Phones (Pixel) | EX+ | writer | H | Loaded: long ownership is Pixel's long-update selling point (same family as the 'stays fast and keeps getting updates for years' leak). |
| I83 | 2497-2499 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - Value (pricing) | name the LINE being weighed ('an Amex travel card', 'a Pixel Pro') | Credit cards; Phones (AmEx, Pixel) | EX+ | writer | H | The clients' own product lines. Repeated in B11. |
| I84 | 2505 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - Value (pricing) | never a presupposed verdict ('that huge fee') | Credit cards | EX- | writer | L |  |
| I85 | 2509-2511 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - objections | voiced as DISTRUST ('these bonus rules feel designed to trip you up - will I actually get it?') | Credit cards (AmEx) | EX+ | writer | H | A complete card-objection seed. |
| I86 | 2517-2518 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - doubt cells | ('how far behind is it?' presumes the gap - ask 'is it actually behind?') | Generic | EX+ | writer | M | The replacement is a copyable seed ending. |
| I87 | 2528 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - doubt cells | never the same worry (price, fees, performance) recycled across cells | Generic | EX- | writer | L |  |
| I88 | 2530 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | name product LINES ('Pixel vs iPhone') or say 'the latest <line>' | Phones (Pixel, iPhone) | EX+ | writer | H | Pixel's comparison vs Apple is this pair. |
| I89 | 2531 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | never a specific model-year pairing ('Pixel 9 Pro vs iPhone 15 Pro') | Phones (Pixel, iPhone) | EX- | writer | M | Primes model names. |
| I90 | 2535-2536 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - open-choice | the ask must invite NAMED picks - 'which ones', 'name a few worth a look' | Generic | EX+ | writer | M | The same closing lands on every open-choice seed (cross-row convergence). Repeated in B18. |
| I91 | 2536-2537 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - open-choice | never 'what should I look for', 'where do I find reviews' | Generic | EX- | writer | L |  |
| I92 | 2538-2539 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - open-choice | When the category is a RETAILER category, the ask is which retailer to buy from, not which product to buy. | Beauty retail (Sephora) | INST | writer | L |  |
| I93 | 2554 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - category term | use the study category's own words ('tortilla chips', 'beauty retailers') | Snacks / CPG; Beauty retail (Doritos, Sephora) | EX+ | writer | M |  |
| I94 | 2555 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - category term | never a looser genericization ('chips', 'stores') | Snacks / CPG; Beauty retail | EX- | writer | L |  |
| I95 | 2557-2558 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - category term | the plain category noun ('my phone') is normal speech - never contorted around ('the thing in my pocket') | Phones | EX+ | writer | M | Every category gets a phone example (also I8, I138). |
| I96 | 2559-2560 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - category term | no product term only one roster brand is known for ('charge card' points every answer at American Express) | Credit cards (AmEx) | INST | writer | M | Names American Express in every tracker's writer prompt. |
| I97 | 2569-2571 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - awareness | ('is this a common problem?') ... 'what specs or criteria should I care about' | Generic | EX- | writer | L |  |
| I98 | 2574 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - criteria | NEVER offering candidate criteria ... ('is it SSO, reporting or something else?') | Project management / B2B software (Jira) | EX- | writer | M | s34 removed 'SSO, reporting and automations' from the wish-list rule, but this copy survives (and B21). |
| I99 | 2581-2582 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - business_case | help justifying the client brand, by name, to a CFO, procurement or a security review | Project management / B2B software | INST | writer | M | See I12. |
| I100 | 2584-2585 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - expansion | ONE specific growth step (more teams, seats or uses) | Project management / B2B software | EX+ | writer | M | See I13. |
| I101 | 2596-2601 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - switch direction | switch between competing platforms or ecosystems (phone operating systems, app ecosystems) ... OS names are direction vocabulary ... moving off a legacy tool or replacing a card needs no named source | Phones; Project management / B2B software; Credit cards | INST | writer | L |  |
| I102 | 2601-2603 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - switch direction | 'Switching platforms', 'moving between ecosystems' and 'from one platform to another' are NOT directions | Phones | EX- | writer | L |  |
| I103 | 2606-2607 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) - switch direction | (toward iOS, on an Android brand's study) | Phones (Pixel) | EX- | writer | L |  |
| I104 | 2609-2611 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | Never a calendar year in a prompt ('in 2026') ... say 'right now' | Generic | EX+ | writer | L |  |
| I105 | 2614-2615 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | a persona the scenario contradicts (a 12-person startup with a CFO) | Project management / B2B software | EX- | writer | L |  |
| I106 | 2616-2619 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | 'spec-driven', 'trust-driven', 'think/feel', 'value math', 'run the math', segment labels ('mid-market', 'SMB', 'enterprise-wide') | Project management / B2B software; Generic | EX- | writer | L |  |
| I107 | 2625 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | write 'about 10', not '~10' | Generic | EX+ | writer | L |  |
| I108 | 2628 | CELL_WRITER_SYSTEM (every seed write, heal, regen, alternate draw) | never ... a correction ('sorry', 'instead:') | Generic | EX- | writer | L |  |
| I109 | 2847-2849 | generateWorries | (price/value, quality, performance, complexity, policy/trust, availability, service, lock-in, ...) | Generic | EX+ | writer | L |  |
| I110 | 2850-2852 | generateWorries | a price worry is ATTITUDE-shaped (the fee feels high, not worth renewing) | Credit cards; Streaming / subscriptions (AmEx) | EX+ | writer | M | Becomes worry labels and then cell concerns; 'fee' wording fits cards, not chips or phones. |
| I111 | 3127-3129 | concern plan (legacy, no worry picks) - classes | (price/value, quality, health/ingredients, performance, complexity, policy/trust, availability, durability, service, lock-in, ...) | Snacks / CPG; Supplements / professional services; Generic | EX+ | writer | L |  |
| I112 | 3142-3144 | concern plan (legacy, no worry picks) - upstream | Known upstream brands the rivals ride on ... they sell to the trade, not to this buyer; frictions with them are real buyer concerns | Credit cards (Visa, Mastercard) | INST | writer | L | Fires only with upstream roster entries. |
| I113 | 3772 | seedRule finding detail (fed verbatim into the brand-rule heal steer; shown as gate chip) - blind_missing_category | use its plain everyday noun (the ordinary word a person calls this thing), never a contortion around it | Generic | INST | writer | L |  |
| I114 | 3790-3791 | seedRule finding detail (fed verbatim into the brand-rule heal steer; shown as gate chip) - comparison_seed_quantity | a spend level, frequency or size qualifier conditions the head-to-head on one writer-chosen segment | Credit cards; Generic | INST | writer | L |  |
| I115 | 3800 | seedRule finding detail (fed verbatim into the brand-rule heal steer; shown as gate chip) - seed_calendar_year | say "right now" instead | Generic | EX+ | writer | L |  |
| I116 | 3816 | seedRule finding detail (fed verbatim into the brand-rule heal steer; shown as gate chip) - segment_vocabulary | voice the size or stakes in plain words ("we're about 120 people and doubling", "picking one tool for the whole company") | Project management / B2B software (Jira) | EX+ | writer | H | Pasted straight into the rewrite request, so the fix copies it. Loaded: the second line is the Atlassian consolidation pitch. |
| I117 | 3831 | seedRule finding detail (fed verbatim into the brand-rule heal steer; shown as gate chip) - seed_switch_direction | state the direction by naming both platforms (the one left and the one joined) | Phones | INST | writer | L |  |
| I118 | 3841 | seedRule finding detail (fed verbatim into the brand-rule heal steer; shown as gate chip) - seed_multi_ask | one prompt asks at most two or three things, and one circumstance carries ONE core ask | Generic | INST | writer | L |  |
| I119 | 3849 | seedRule finding detail (fed verbatim into the brand-rule heal steer; shown as gate chip) - class_category_tail | ("${brand} or a Visa card for credit cards" is not how anyone talks) | Credit cards (Visa) | EX- | writer | M | Hardcoded Visa / credit-card wording whatever the cell's real class (e.g. 'an Intel laptop'), sent into the heal. |
| I120 | 3859 | seedRule finding detail (fed verbatim into the brand-rule heal steer; shown as gate chip) - concern_price_bolt_on | (cheaper options, wasting money, financial risk) | Generic | EX- | writer | L |  |
| I121 | 3812, 3826 | seedRule regexes (deterministic, never sent) | mid-market, enterprise-wide, enterprise standard, standardization, SMBs / iOS, Android | Project management / B2B software; Phones | INST | never sent | L |  |
| I122 | 3908 | concern-diversity labeler (sonnet) | price/fees, performance/reliability, complexity/admin burden, catalog/content, policy/trust, support/service, compatibility/lock-in, quality/durability | Streaming / subscriptions; Project management / B2B software; Generic | INST | judge | L | Labels only, but the covered labels go into the diversity rewrite steer. |
| I123 | 3908 | concern-diversity labeler (sonnet) | Two settings of the same worry (peak-load speed vs cross-region speed) are the SAME class. | Project management / B2B software (Jira) | EX+ | judge | L |  |
| I124 | 4432-4434 | regenerateCell near-variant system add-on | (a number, a constraint, a context detail, who is affected) | Generic | EX+ | writer | L |  |
| I125 | 4842 | generatePhrasings seed-line notes - legacy blind note | the guidance's subject stays implied ("my subscription", "the service"), never named | Streaming / subscriptions | EX+ | writer | M | Legacy (spec-less) cells only; the same text rides on every blind SPEC cell via B29. |
| I126 | 4859 | generatePhrasings seed-line notes - owned noun | substituting a broader word like "snacks" or "device" changes what is measured | Snacks / CPG; Phones | EX- | writer | L |  |
| I127 | 4873 | generatePhrasings seed-line notes - invariant cell | no role, identity, occupation or life situation in the text | Generic | INST | writer | L |  |
| I128 | 4899 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | ('0% for 24 months' must never become 'about 18 months') | Credit cards; Phones | EX- | writer | M | Illustrates the number rule but plants an intro-APR / financing phrase in every category's paraphrase prompt. |
| I129 | 4901 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | 4K, 5G, HDR10, USB-C stay as written | Phones; Streaming / subscriptions | EX+ | writer | L |  |
| I130 | 4903-4905 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | pick realistic roles for the audience - e.g. founder, engineering manager, IT director, procurement, a parent, a gift buyer | Project management / B2B software; Generic | EX+ | writer | H | The persona menu for every category; four of six are B2B software roles. In situational cells the persona is allowed into the words. |
| I131 | 4906 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | register (casual forum post to formal RFP language) | Project management / B2B software | EX+ | writer | M | Invites RFP register on consumer cells. |
| I132 | 4907 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | length (a terse 8-word ask to a two-sentence backstory) | Generic | EX+ | writer | L |  |
| I133 | 4915-4916 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | (a Pixel owner wondering about switching does not recite four competitor names) | Phones (Pixel) | EX- | writer | M | Names a client brand in every tracker's paraphrase prompt and frames Pixel owners as switch-curious. |
| I134 | 4921-4922 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | Keep the seed's category term exactly: 'tortilla chips' stays 'tortilla chips', never 'chips' or 'snacks' | Snacks / CPG (Doritos) | EX+ | writer | M |  |
| I135 | 4926-4928 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | ('Korean thrillers', 'mineral sunscreen') stays exactly as written - 'Korean' never becomes 'Asian', 'subtitled' or 'foreign' | Streaming / subscriptions; Beauty retail (Netflix) | EX+ | writer | L |  |
| I136 | 4929-4931 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | The plain category noun ('my phone', 'tortilla chips') is normal speech - never contort around it ('the thing in my pocket', 'my carried device') | Phones; Snacks / CPG | EX+ | writer | M |  |
| I137 | 4936 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | nine founders is one person nine times | Project management / B2B software | EX- | writer | L |  |
| I138 | 4947 | generatePhrasings system prompt (gpt-5-mini, every paraphrase call) | never ... a correction ('sorry', 'instead:') | Generic | EX- | writer | L |  |
| I139 | 5486-5500 | STAGE_ASK_WORDS (retry exempt list, never sent) | keep keeping stay staying stick cancel canceling cancelling leave ... (per stage) | Generic | INST | never sent | L |  |

## src/lib/engine/battery_checks.ts (34 items)

| # | Line | Prompt / function | Quoted text | Category / brand | Kind | Flow | Risk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | 204 | outcomeClause (appended to blind-stage design lines) | Any need the buyer mentions is voiced as an OUTCOME ... (its signature feature names, taglines or platform labels) | Generic | INST | writer | L | Clean since s34 - the 'stays fast and keeps getting updates for years' example was removed here. |
| B2 | 225 | seedDesignLine (paraphrase design judge) - churn/renewal | nor a choice between two ways of leaving (pause vs cancel) | Streaming / subscriptions | INST | judge | L |  |
| B3 | 228 | seedDesignLine (paraphrase design judge) - doubt with concern | ("am I likely to be ineligible?" is a lookup, not a doubt) | Credit cards (AmEx) | EX- | judge | L |  |
| B4 | 235 | seedDesignLine (paraphrase design judge) - pricing | presupposing the verdict ("a ripoff") | Generic | EX- | judge | L |  |
| B5 | 237, 342 | seedDesignLine (paraphrase design judge) / stageDesignIntent - premium_worth | against basic/store options | Snacks / CPG | INST | judge | L |  |
| B6 | 247 | seedDesignLine (paraphrase design judge) - expansion | ONE specific growth step (more teams, seats or uses) | Project management / B2B software | EX+ | judge | M | See I13. |
| B7 | 269 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - churn/renewal | both options need not be spelled out ("is it still worth it with these price hikes?" qualifies) | Streaming / subscriptions (Netflix) | EX+ | writer | H | Reaches the writer in every churn/renewal design heal ('The design: <intent>'). |
| B8 | 274 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - doubt | ("am I likely to be ineligible?", "can I check before applying?" are lookups, not doubts) | Credit cards (AmEx) | EX- | writer | M | Heal steer for every brand; primes the card-eligibility topic. |
| B9 | 281 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - pricing | a GENERIC cheaper alternative in the category ("a cheaper phone", "store-brand chips", "a no-annual-fee card") | Phones; Snacks / CPG; Credit cards (Pixel, Doritos, AmEx) | EX+ | writer | H | See I80. |
| B10 | 281 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - pricing | presupposing the verdict ("that huge fee") | Credit cards | EX- | writer | L |  |
| B11 | 281 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - pricing | names the LINE being weighed ("an Amex travel card", "a Pixel Pro") | Credit cards; Phones (AmEx, Pixel) | EX+ | writer | H | See I83. |
| B12 | 281 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - pricing | a bare brand-level "an American Express card" lets the answer pick among ${brand}'s own lines and does not satisfy the design | Credit cards (AmEx) | INST | writer | M | Hardcoded AmEx in every brand's pricing design line - a Pixel heal is told about American Express cards. |
| B13 | 290 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - defensive alternatives | ("if we don't go with it") | Generic | EX- | writer | L |  |
| B14 | 292 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - offensive alternatives | ("too lightweight for a dev team") ... ("for our dev team", "for a software engineering team") | Project management / B2B software (Jira) | EX- | writer | M | Heal steer for every brand's offensive cells. See I57. |
| B15 | 299 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - comparison | ASKS FOR THE PICK - "which would you go with", "which one", and why. A strengths tour ("where does each win", "pros and cons") | Generic | EX+ | writer | M | 'which would you go with' becomes the shared closing of comparison heals. |
| B16 | 304 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - problem_recognition | a current customer of ${brand} doubting it ("I'm paying a big fee for perks I barely use") is a worry | Credit cards (AmEx) | EX- | writer | M | Heal steer for every brand; plants a fee-and-perks worry. |
| B17 | 304, 306 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - awareness | a yes/no reassurance ask ("is this common?") | Generic | EX- | writer | L |  |
| B18 | 311-312 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - open choice / use_case | ("which ones", "name a few worth a look") / ("name a few", which belongs to discovery) | Generic | EX+ | writer | M | See I90. |
| B19 | 318 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - feature_screening | a requirement ${brand} cannot meet by construction (hardware or capabilities its products do not have) | Phones | INST | writer | L |  |
| B20 | 327 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - criteria | ("is it SSO, reporting, or something else?") | Project management / B2B software (Jira) | EX- | writer | M | See I98. |
| B21 | 329 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - business_case | justifying ${brand}, by name, to a CFO, procurement or a security review | Project management / B2B software | INST | writer | M | See I12. |
| B22 | 336 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - circumstance | (phone operating systems, app ecosystems) | Phones | INST | writer | L |  |
| B23 | 336 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - circumstance | (consolidating tools, retiring a legacy or homegrown tracker, replacing an everyday card) | Project management / B2B software; Credit cards (Jira, AmEx) | EX+ | writer | M |  |
| B24 | 336 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - circumstance | "moving off a homegrown tracker" fully satisfies the circumstance | Project management / B2B software (Jira) | EX+ | writer | M | Positive phrase in the heal steer. |
| B25 | 336 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - circumstance | ("first credit card", "replacing my everyday card") | Credit cards (AmEx) | EX+ | writer | M | Positive phrases in the heal steer. |
| B26 | 348 | stageDesignIntent (seed judge AND pasted into the writer's design-heal steer) - expansion | ONE specific growth step (more teams, seats or uses) | Project management / B2B software | EX+ | writer | M | See I13. |
| B27 | 1301 | specWriterNote (rides on every blind spec cell's seed line in the paraphrase writer) | [deliberately blind variant: name NO brand - the guidance's subject stays implied ("my subscription", "the service"), never named] | Streaming / subscriptions | EX+ | writer | H | Fires for EVERY blind cell (discovery, criteria, screens, use case, social, premium, awareness) in every category - a subscription frame on chips, phones and cards. |
| B28 | 1341, 1361 | statedPriceFinding detail (heal steer) | name the tier or product and ASK what it costs or which nets out better (the asker's own spend, budget or a deal offered to them is circumstance and stays) | Generic | INST | writer | L |  |
| B29 | 952-953 | deterministic word list (judge only, never sent) - AMBIGUOUS_FORMS | max, visa, prime, go, one, mini, pro, plus, air, fire, mission, video, music, cloud, monday | Streaming / subscriptions; Credit cards; Phones; Project management / B2B software (Max, Prime Video, Visa, OnePlus, monday.com) | INST | never sent | L |  |
| B30 | 378 | deterministic word list (judge only, never sent) - STOP_FORMS | one, max, mini, pro, plus, air, go, fire, prime, mission, video, music, cloud, american, america | Credit cards; Streaming / subscriptions; Phones (AmEx, Bank of America) | INST | never sent | L |  |
| B31 | 382 | deterministic word list (judge only, never sent) - TERM_COLLISIONS | pixel size / sizes / binning / count / density, keyboard shortcuts | Phones; Project management / B2B software (Pixel) | INST | never sent | L |  |
| B32 | 388 | deterministic word list (judge only, never sent) - TECH_TOKENS | 4k, 5g, 8k, 1080p, 720p, 2160p, 24/7, mp3, mp4, wi-fi 6/7, usb-c, 0% | Streaming / subscriptions; Phones; Credit cards | INST | never sent | L |  |
| B33 | 1321 | deterministic word list (judge only, never sent) - statedPriceFinding unitAfter | engineers, people, employees, users, seats, agents, devs, requesters, hours, trips, nights, photos, videos, gb, tb, times, lines, stores, squads | Project management / B2B software; Credit cards; Phones | INST | never sent | L |  |
| B34 | 1334 | deterministic word list (judge only, never sent) - ownPlanContext | groceries, dining, gas, travel, ads | Credit cards; Streaming / subscriptions | INST | never sent | L |  |

## src/lib/engine/roster.ts (8 items)

| # | Line | Prompt / function | Quoted text | Category / brand | Kind | Flow | Risk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | 163-164 | classifyRoster system prompt - sellsTo | (e.g. 'consumers', 'small businesses', 'enterprises', 'banks', 'merchants', 'retailers', 'software teams') | Credit cards; Project management / B2B software | EX+ | classifier/advisory | L |  |
| R2 | 172-174 | classifyRoster system prompt - audienceBuyable | (a payment network behind banks' cards, an ingredient or component supplier behind finished goods, a wholesaler behind retailers) | Credit cards; Snacks / CPG; Phones (Visa, Mastercard) | EX+ | classifier/advisory | L |  |
| R3 | 180-182 | classifyRoster system prompt - audienceBuyable | (an audience described as wanting Android can still buy an iPhone - a maker selling its finished product to buyers is buyable) | Phones (Pixel, iPhone) | EX+ | classifier/advisory | L | In-sample fix for Pixel; harmless. |
| R4 | 184-185 | classifyRoster system prompt - note | (e.g. 'payment network - sells to card issuers and merchants, not cardholders') | Credit cards (Visa, Mastercard) | EX+ | classifier/advisory | L | Output shape for the chip note. |
| R5 | 189 | classifyRoster system prompt - consumerSalient | (buyers ask for 'a Visa card' or 'an Intel laptop') | Credit cards; Other (Visa, Intel) | EX+ | classifier/advisory | L |  |
| R6 | 194 | classifyRoster system prompt - classPhrase | with its article ('a Visa card', 'a Mastercard card') | Credit cards (Visa, Mastercard) | EX+ | writer | H | classPhrase flows verbatim into class-cell plan lines, seeds and cache keys; 'a Mastercard card' is the doubled-head form dedupeHead has to repair. |
| R7 | 199-201 | classifyRoster system prompt - inCategory | (a cheese-puff or potato-chip brand on a 'tortilla chips' study; a help-desk tool on a 'project management software' study) | Snacks / CPG; Project management / B2B software (Doritos, Jira) | EX+ | classifier/advisory | M | In-sample: pre-answers the adjacency calls for two example trackers. |
| R8 | 203 | classifyRoster system prompt - parent | ('Atlassian', 'PepsiCo') | Project management / B2B software; Snacks / CPG (Jira, Doritos) | EX+ | classifier/advisory | L | The clients' own parents. |

## src/lib/engine/suggest.ts (17 items)

| # | Line | Prompt / function | Quoted text | Category / brand | Kind | Flow | Risk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | 380-381 | suggestBrandProfile (category, rivals, audience prefill) - category | 'CRM software', 'assisted living communities', 'electric SUVs' | Other | EX+ | classifier/advisory | L |  |
| S2 | 393-394 | suggestBrandProfile (category, rivals, audience prefill) - category | (e.g. not 'Android smartphones' with iPhone as a rival) | Phones (Pixel, iPhone) | EX- | classifier/advisory | L |  |
| S3 | 397-398 | suggestBrandProfile (category, rivals, audience prefill) - audience | ('people choosing a new smartphone - upgraders and switchers', 'software development teams') | Phones; Project management / B2B software (Pixel, Jira) | EX+ | writer | H | The audience string feeds every later prompt (scenarios, roster, writer, paraphrases). 'upgraders and switchers' invites the switcher rooms the room rule now rejects. |
| S4 | 400-401 | suggestBrandProfile (category, rivals, audience prefill) - audience | ('buyers wanting a clean Android phone' excludes iPhone buyers) | Phones (Pixel) | EX- | classifier/advisory | L |  |
| S5 | 189-192 | classifyNonBrands (post-run junk filter, not setup) | ('self-hosted server', 'open-source tools', 'a spreadsheet', 'a custom build') ... ('the reporting module', 'the boards') | Project management / B2B software (Jira) | EX+ | judge | L | Runs after a wave (run:dictionary). |
| S6 | 275-276 | lintAndRepair (classic battery path) - lint | A prompt about 'a tool' or 'our tooling' with no category signal is NOT anchored. | Project management / B2B software | EX- | judge | L |  |
| S7 | 282 | lintAndRepair (classic battery path) - lint | vague constraints ('cheap', 'easy to pick up') | Generic | EX+ | judge | L |  |
| S8 | 333-334 | lintAndRepair (classic battery path) - repair | Replace precise round constraints with vague ones ('cheap', 'not too complicated', 'something the team will actually use') | Project management / B2B software | EX+ | writer | M | Repairs inherit 'the team' on consumer studies. |
| S9 | 494 | generateBatteryAi (classic battery path) | make it concrete (team size, budget, what's going wrong) | Project management / B2B software | EX+ | writer | M |  |
| S10 | 501 | generateBatteryAi (classic battery path) | Nobody calls themselves an 'IT leader' or a 'knowledge worker' | Project management / B2B software | EX- | writer | L |  |
| S11 | 501-502 | generateBatteryAi (classic battery path) | they say 'I run IT at a mid-size company' or 'my team of 8' | Project management / B2B software | EX+ | writer | M | 'mid-size company' is the segment vocabulary the instrument path bans. |
| S12 | 518 | generateBatteryAi (classic battery path) | ('handle X, Y, Z, and support A, B, and C') | Generic | EX- | writer | L |  |
| S13 | 520-521 | generateBatteryAi (classic battery path) | ('cheap', 'not too complicated', 'something the team will actually use') | Project management / B2B software | EX+ | writer | M |  |
| S14 | 522-523 | generateBatteryAi (classic battery path) | ('$5,000 annually', 'learn in under two weeks') | Project management / B2B software | EX- | writer | L |  |
| S15 | 526-534 | generateBatteryAi (classic battery path) - register examples | 'best mattress for side sleepers under a grand' / 'my back is killing me every morning, what should I be sleeping on?' / 'whats a decent cheap alternative to the big mattress brands' / 'so we've had the same hand-me-down bed for like 9 years ...' | Mattresses (Purple (fleet)) | EX+ | writer | H | Chosen as 'far from any B2B study' - but Purple is on the fleet list, and on a mattress study these are on-topic seeds. Register-only (low) elsewhere. |
| S16 | 540-541 | generateBatteryAi (classic battery path) | (budget, trust, or a situational constraint) | Generic | EX+ | writer | L |  |
| S17 | 581, 585 | generateBatteryAi branded probes (fixed text) | Is ${brand} a good option? What do people say about it? / How does ${brand} compare to other ${category}? | Generic | INST | never sent | L | Fixed templates, no model. |

## src/lib/engine/prompts.ts (1 items)

| # | Line | Prompt / function | Quoted text | Category / brand | Kind | Flow | Risk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | 25 | generatePromptBattery fallback templates | Top ${category} to consider in 2026 | Generic | INST | never sent | M | Fallback only, but ships a calendar year (the instrument bans it); line 27's template also carries an em dash. |

## src/lib/engine/brand_aliases.ts (1 items)

| # | Line | Prompt / function | Quoted text | Category / brand | Kind | Flow | Risk | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | 70-72 | suggestBrandAliases | 'American Express' -> ['amex', 'americanexpress']; 'Google Pixel' -> ['pixel']; 'Samsung Galaxy' -> ['galaxy'] | Credit cards; Phones (AmEx, Pixel, Samsung) | EX+ | classifier/advisory | L | In-sample (answers itself for two trackers); affects detection only. |

## src/lib/engine/brand_judge.ts (0 items)

BRAND_JUDGE_SYSTEM and the per-hit user message are generic (the examples 'the doorbell ring', '2-3 services max', 'my pixel keeps dropping calls' live only in a code comment). Also checked with no category examples in sent text: `checkRooms` JSON-repair prompt, the use-case job labeler and its rewrite steer (I-rows not needed), `swapRule` (generic by design), the worry stance definitions, `reviewScenarioFit` apart from I41, `classifyJourney`/`classifyModerators` apart from DIMENSION_GUIDE, `models.ts`, `instrument_shapes.ts`. No other file under src/lib/engine/ sends setup-time prompts (instrument.ts imports only providers, instrument_shapes, models, battery_checks, store, brand_aliases, brand_judge; suggest.ts adds prompts.ts).

## Highest copy risk (top 15)

| Rank | Items | Where | Why |
| --- | --- | --- | --- |
| 1 | I59, I60 | CELL_WRITER_SYSTEM | 'Done with my iPhone - what phone should I get instead?' and 'leaving monday.com. name a few solid alternatives to try' - two complete seeds for the Pixel-vs-Apple and Jira-vs-monday.com offensive-alternatives cells, shown on every write. |
| 2 | I80, B9 | CELL_WRITER_SYSTEM + pricing design intent (heal steer) | 'a cheaper phone', 'store-brand chips', 'a no-annual-fee card', 'a cheaper streaming service' - the exact Value-cell counterpart for Pixel, Doritos, AmEx and Netflix, twice over. |
| 3 | I83, B11 | CELL_WRITER_SYSTEM + pricing design intent | 'an Amex travel card', 'a Pixel Pro' - the clients' own product lines as the model answer. |
| 4 | I82, I19 | CELL_WRITER_SYSTEM, readScenarios | 'I keep a phone 3 or 4 years' and 'upgrading a phone I've had for years' - loaded: long ownership is Pixel's update-support selling point, the same family as the removed 'keeps getting updates for years'. |
| 5 | I72, B7 | CELL_WRITER_SYSTEM + churn design intent (heal steer) | 'is Netflix still worth it with these price hikes?' - a full Netflix churn seed, and a price-hike trigger offered to every brand's churn cells. |
| 6 | I70 | CELL_WRITER_SYSTEM | 'Amex is my main card' - AmEx retention seed opener; the 'X is my main <noun>' frame spreads. |
| 7 | I75, I76, I116 | CELL_WRITER_SYSTEM + segment_vocabulary heal steer | 'this would be my first credit card', 'we're about 120 people and doubling', 'picking one tool for the whole company' - situation phrasings for AmEx and Jira; the heal steer pastes the Jira pair straight into the rewrite. |
| 8 | I67, R6 | CELL_WRITER_SYSTEM, classifyRoster | 'or should I get a Visa card?' and classPhrase examples 'a Visa card', 'a Mastercard card' - the AmEx class cells' wording comes from these. |
| 9 | I85 | CELL_WRITER_SYSTEM | 'these bonus rules feel designed to trip you up - will I actually get it?' - a complete card objection. |
| 10 | I88 | CELL_WRITER_SYSTEM | 'Pixel vs iPhone' - Pixel's comparison pair. |
| 11 | I65 | CELL_WRITER_SYSTEM | 'as a project management tool' - reused verbatim in Jira comparisons. |
| 12 | I18, I31 | readScenarios, nearScenarios | 'existing carrier customer upgrading with trade-in credits', 'migrating from a legacy tracker', 'Carrier trade-in upgrade' -> 'Carrier upgrade at launch' - the room examples ARE Pixel and Jira rooms. |
| 13 | I21, I24 | readScenarios | 'a fast-growing team outgrowing its first tool' + the email-marketing core set ('Outgrowing the starter tool', 'Marketing team consolidation') - shape copied into B2B rooms; loaded toward the 'graduate to the bigger tool' pitch. |
| 14 | I130, B27 | generatePhrasings system + specWriterNote | persona menu 'founder, engineering manager, IT director, procurement, a parent, a gift buyer' on every paraphrase call, and '("my subscription", "the service")' on every blind cell's seed line - B2B and subscription frames on every category. |
| 15 | S3, S15 | suggestBrandProfile, generateBatteryAi | audience examples 'people choosing a new smartphone - upgraders and switchers' / 'software development teams' (feed every later prompt), and the mattress register examples (on-topic seeds for the planned Purple tracker). |

Also worth a look (generic-but-loaded, point at a client strength): I42 'wants the best camera' certified as neutral outcome language in the room pitch check (Pixel); I13/I100/B6/B26 '(more teams, seats or uses)' on every market's expansion cells; I98/B20 'is it SSO, reporting or something else?' (Jira enterprise points, survived s34); B12 and I96 name American Express in every tracker's prompts; I133 names Pixel in every tracker's paraphrase prompt; I28 SITUATION_TEMPLATE.solo asks for ecosystem/compatibility rooms that the room rule now rejects.
