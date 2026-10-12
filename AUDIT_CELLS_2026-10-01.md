# Setup battery audit - Jira, American Express, Google Pixel (2026-10-01)

Scope: the three walked setup drafts on prod (`setup_drafts.wizard`, read through a single read-only transaction - no session SET, no writes). 165 cells, 1,650 prompts (each cell = seed + 9 paraphrases). Drafts last saved 2026-10-02 03:15 UTC (Jira, AmEx) and 01:14 UTC (Pixel).

Method:
1. **Mechanical, zero model calls**: the engine's own checks over every prompt. For seeds this is a replica of `seedRule` (`deriveCheckSpec` + `checkPromptAgainstSpec` + `blind_missing_category` + `scenario_label_leak` + `comparison_seed_quantity`). For every seed and paraphrase it is `checkBattery` with `resolveCellSpec`. The scope matches `generatePhrasings`: same-seat roster, all scenario labels, no extraForms. Extra checks: stored spec vs re-derived spec, `phrasedFor` vs seed (stale sets), phrasing counts, seedFlags, and content-word Jaccard for near-duplicates within a cell and across cells.
2. **Judgment**: I read all 1,650 prompts against the s10-s13 contracts, the circumstance/doubt boundary, A3 and the writer rules.

Severity key: **S1 ship-blocker** (fix before collection) / **S2 high** (biases a measurement - fix before collection if at all possible) / **S3 medium** (fix at the gate - cheap and worth it) / **S4 low** (polish, or a pattern to watch).

---

## 1. Hard mechanical findings

The engine's own rules flag exactly one cell across all three batteries.

### M1 [S1] AmEx - pricing [cell 40, First credit card] - terminal-flagged seed, and its circumstance survives nowhere else
- Seed: "First card question: would an American Express actually pencil out for me? I spend about 700 a month, mostly groceries, gas, and takeout, I pay in full, and I hardly travel. What would year 1 and year 2 look like in fees vs rewards or credits I'd likely use, net?"
- Rule: `scenario_label_leak` ("First card question:" opener matches the label "First credit card"). The cell is stored with `seedFlags` and serves as a "needs your call" chip, so the rules-era heal could not clear it.
- Compounding judgment issue: **none of the 9 paraphrases mention a first card.** The leaked opener is the only place the First-credit-card circumstance lives. Deleting the opener leaves a generic everyday-spender pricing cell that duplicates cell 38. The askers also contradict the scenario (small business owner, accountant, CFO-like roles).
- Fix: rewrite the seed to voice the circumstance ("This would be my first credit card - would an American Express actually pencil out...") and redraw the paraphrase set so every paraphrase keeps "first card".

No other mechanical findings: zero brand-rule violations (blind leaks, must-name misses, extra rivals, class misses), zero seed-number changes, zero exact duplicates, zero meta-text and no other label leaks.

---

## 2. Judgment findings (ranked)

### S2 - high

**J1 [S2] Jira - comparison [cells 26-29, all four entity head-to-heads] - paraphrases add Jira's home-turf criteria (14 of 36)**
Every seed is properly neutral ("Jira or Asana as a project management tool, which would you go with and why?"). The paraphrases are not. In each cell, roughly positions 6-9 add dev-team, sprint, issue-tracking or scale criteria, and each of these tilts the prompted win rate toward Jira:
- [26] "If I need solid issue tracking and sprint support, should I go with Jira or Asana..." / "Jira vs Asana - which tends to scale more cleanly for engineering orgs?" / "...better suited for a software dev workflow"
- [27] "If prioritizing developer integrations and code linking, is Jira or monday.com more appropriate?" / "...suits software teams handling sprints and issue triage better?"
- [28] "Jira vs Trello - which handles backlog and issue workflows more effectively for software teams?"
- [29] "Jira or ClickUp - which handles backlogs, sprints, and bug triage for dev teams better?" / "Which platform - Jira or ClickUp - scales better as an engineering org expands?"

This breaks s11 (no situation-implying criteria lists) and the same-question paraphrase rule. Neither the mechanical check (quantities only) nor the design check caught it. AmEx and Pixel show the same pattern only faintly (see J9).
Fix: redraw these 4 sets with the criteria-bearing paraphrases rejected. Keep register variety ("short answer please", "quick take") and drop any added criterion.

**J2 [S2] AmEx - pricing [cell 39, Premium travel card] - a verdict-shaped ask in a pricing cell that duplicates the annual-fee worry**
- Seed: "thinking about getting the American Express Platinum for travel. is that big annual fee actually worth it, or would a no-annual-fee travel card be better value?" Paraphrases push further: "hefty annual fee", "Does splurging on the American Express Platinum's fee make sense...", "Does ... justify its high annual fee".
- The decided boundary (2026-10-01) says pricing asks for the accounting with usage as an input, and "is it worth it" without inputs is a worry wearing pricing's clothes. This cell has no usage profile, asks for no math, and is nearly the same question as objection cell 36 ("That American Express annual fee looks steep... do the credits and perks actually cover it") and renewal cell 49. The pricing view and the worry view will end up measuring the same thing.
- Fix: make it math-shaped with travel inputs, for example "I fly ~4 round trips a year and would use the airline and hotel credits - walk me through what the Platinum costs vs what I'd get back, compared with a no-annual-fee travel card." Drop "big/hefty/splurge" from the paraphrases.

### S3 - medium

**J3 [S3] AmEx - discovery [cell 8, First credit card] - 3 of 9 paraphrases ask for card TYPES, not cards**
P1 "Please suggest a few types to look into", P7 "I'd like a few types to research", P8 "Point out a few kinds that make sense for beginners". The seed asks to "name a few" cards. Asking for types invites "secured card / student card" answers with no brand named, which depresses the open-choice naming rate on exactly this cell. Fix: replace those three.

**J4 [S3] AmEx - use_case [cell 22, Replace everyday card] - 2 paraphrases change the spend profile**
Seed: groceries, gas, streaming. P8: "coffee, commuting, and monthly app bills". P9: "household shopping, car expenses, and streaming alternatives" ("streaming alternatives" is nonsense). Spend categories decide which card wins, so these are different questions. They look like overused-word avoidance. Fix: replace both.

**J5 [S3] AmEx - objections [cell 33, concern "Welcome bonus confusion"] - designed as a neutral rules lookup, not a doubt**
Seed: "...If I had one before, does that kill my chance at a new bonus, and is there any way to check eligibility before I apply?" No paraphrase states a doubt about American Express that the answer could confirm or rebut. All of them are eligibility lookups (the once-per-lifetime rule, the pre-check tool), which `stageDesignIntent` explicitly rejects ("A neutral lookup... does not satisfy the design"). The premise verdict will mostly come out n/a.
Fix: voice the worry ("Amex bonus rules seem designed to trip you up - is the welcome offer actually gettable, or a bait-and-switch?") or swap in a different worry from the pool.

**J6 [S3] Jira - renewal [cell 53, concern "Feels pricey at scale"] - the worry cell requests a spreadsheet**
Seed ends: "How do you sanity check total cost, including Marketplace apps, against the cost to switch?" Every paraphrase keeps it ("How do you calculate total cost of ownership...", "What method do you use to compare..."). The decided rule is that worry cells are verdict asks and never request the accounting. The cell also already carries a verdict ("Is it worth keeping at that scale, or should we move to something cheaper?").
Fix: drop the TCO-method sentence from the seed and redraw.

**J7 [S3] Jira + AmEx - category_education [Jira cell 4, AmEx cell 4] - the category noun drifts in the paraphrases, and the continuity check cannot see it**
- Jira seed says "project management tools". The paraphrases say "project tools", "project systems", "project solutions", "project platforms", "project products" (P1-P8). "Project products" and "project solutions" are not how anyone talks.
- AmEx seed asks what a credit **card** does. 7 of 9 paraphrases ask about **credit** ("how credit works", "what does having credit allow me to do"). That is a different subject (credit in general, not the card product).
- Mechanical gap: the owned-noun continuity check (`textNamesCategory`, token containment) passes both, because "project" and "credit" are tokens of the category string. It accepts any paraphrase that keeps one category token, so contortions survive.
- Fix: redraw both sets. Longer term, have the continuity check require the seed's full category phrase or its head noun ("tools", "card"), not any token.

**J8 [S3] Churn cells across all three batteries - paraphrases drop the keep-or-leave verdict and become how-to lookups**
- AmEx [41, Rewards feel locked-in]: P4 "Is there any way to broaden redemption options?", P5, P8 "Any tricks to use them more freely?", P9 - 4 of 9 lose "or switch".
- Jira [44] P2 "Is this a scalability problem with Jira or fixable?". Jira [46] P2 "Are there support tiers or partners that provide real SLA-worthy help?" and P7 "Are there paid plans or providers that actually guarantee fast fixes?".
- Pixel [41] P7 "Is there a permanent fix?"
- Churn's measurement is keep vs leave. Without the leave option these become problem_resolution asks. Fix: replace these paraphrases (9 total).

**J9 [S3] AmEx - class comparisons [cells 30-31] - awkward class phrase, plus criteria and ask drift**
- "a Mastercard card" appears in the seed and all 9 paraphrases. Buyers say "a Mastercard". The phrase comes from `rosterClasses` ("Mastercard" -> "a Mastercard card"), so it is a classifier-output issue.
- Both seeds carry a redundant "for credit cards" ("American Express or a Visa card for credit cards").
- s11 drift: [30] P8 "...which makes more sense for everyday spending?", [31] P6 "for everyday use", [31] P9 "which is generally better for cash back?". [30] P9 "Pros and cons of American Express versus a Visa card?" drops the pick ask.
- Fix: correct the class phrase to "a Mastercard" in the draft's rosterClasses, drop "for credit cards" from both seeds, and replace the 4 drifted paraphrases.

**J10 [S3] Jira - offensive alternatives [cells 48-50] - the seeds give reasons that steer toward Jira**
"Asana isn't clicking for our dev team", "monday.com feels like a stretch for our engineers", "Trello is too lightweight for our dev team". Each reason points the answer at a heavier, dev-native tool, which is Jira's positioning. The AmEx and Pixel alternatives seeds are neutral ("Not going with Chase", "Not into Samsung Galaxy"), so Jira's "AI names us when buyers leave a rival" rate will read high partly by construction. [51] ClickUp P3 "for sprint planning and issue tracking" and P6 "code-centric teams" do the same.
Fix: neutral leave-reasons ("We're moving off Asana - what should we look at?").

**J11 [S3] Jira - defensive alternatives [cell 47] - the set mixes two circumstances**
The seed is a prospect ("If we don't go with Jira"). P1-P8 are mostly an existing customer leaving ("considering leaving Jira", "Assuming we don't renew Jira", "Planning for a potential Jira exit"). P9 returns to the prospect. Defensive alternatives score as keep-or-leave doubt, and the AmEx sibling ("If I'm moving off American Express") is consistently an existing customer.
Fix: rewrite the seed as an existing customer and redraw.

**J12 [S3] Jira - Mid-market / Enterprise cells [6, 10, 36, 9] - scenario-label vocabulary in the text**
- "mid-market" appears in every prompt of cells 6 and 10, plus cell 36's seed and P7 ("We're mid-market, 120 now...").
- Cell 9's seed: "...to evaluate for enterprise-wide engineering standardization". P5: "for an enterprise engineering standardization program".
- Buyers don't call themselves "mid-market". This is the plan's label wearing a light disguise. `scenarioLabelLeak` only catches the full label or a "Label:" opener, so it passes.
- Fix: voice the circumstance ("we're ~120 people and doubling"), which cells 1, 14 and 40 already do well.

**J13 [S3] Jira - feature_screening [cell 18, Mid-market] - 3 of 9 paraphrases ask a different question**
Seed: multi-team capacity planning with points, velocity and carryover. P7 "sprint-level resource allocation", P8 "team-level workload planning for concurrent sprints" and P9 "balance sprint load among several squads" drop all three named capabilities and become resource or workload planning asks, which answer with different tools. Fix: replace them.

### S4 - low

- **J14 [S4] Jira use_case [24] P9** - "a customer intake page, a ticket sorting board, response-deadline timers, rota-based alerting for whoever's on duty, and a searchable internal docs area". Circumlocution produced by word avoidance, and it reads engine-authored. Replace it.
- **J15 [S4] Category-noun grammar artifacts** - Jira [21] P2 "one project management tools choice", [21] P5 "standardizing on one project management tools", [24] P7 "Need a project management tools that"; AmEx [16] P7 "Looking for a starter credit cards", P9 "Never had a credit cards before". The plural category string is being inserted into singular slots. Fix the 5 prompts. Worth a cheap mechanical check (`a|an|one` + the plural category).
- **J16 [S4] Jira discovery [8, ITSM]** - P3 "Small SaaS org here" and P8 "For a dev team that doubles as first-line IT support" add circumstances the seed does not have.
- **J17 [S4] Jira shortlist [9]** - "tamper-evident audit logs" (P1), "immutable logs" (P4) and "forensic audit trails" (P5) raise the seed's "compliance-friendly audit trails" into a stricter requirement.
- **J18 [S4] Jira pricing [36]** - a 6-part seed (seats per function, tier, annual cost, bill drivers, pays-for-itself). The paraphrases compress it lossily (P1 drops drivers and payback, P3 drops seats, P2 drops payback), so the set is not one consistent question. Trim the seed to 2-3 asks.
- **J19 [S4] Pixel discovery [5, trade-in]** - the seed is ambiguous between "which new phone to buy with trade-in credits" and "which phone is worth most to trade in". P4 ("Which phones are most often accepted for high trade-in credit") and P9 ("usually return the highest trade-in value") take the resale reading.
- **J20 [S4] Pixel churn [41] P4** - "long FaceTimes" on a Pixel is wrong for an Android user and names an Apple product the forbidden-brand detector does not know. Replace it.
- **J21 [S4] AmEx ecosystem [53]** - the seed asks to name companions (wallets, expense apps, lounge). P2 "What kinds of apps", P5 "What memberships or tech features" and P9 "what kinds of integrations" ask for kinds rather than names. This is a group-3 stage, so it is low priority.
- **J22 [S4] AmEx use_case [23] P9** - "As a small-business owner who takes a couple of international trips yearly..." adds a business identity to a consumer premium-travel cell, which pulls in business cards.
- **J23 [S4] Pixel problem_recognition [2, Teen]** - the seed ends "what specs should I actually care about", which is a criteria ask and overlaps criteria cell 15. It is pre-category in form only.
- **J24 [S4] Comparison seeds in all three batteries** - the "X or Y for <category>" template ("Pixel or Xiaomi for smartphones", "American Express or Chase for credit cards", "Jira or Trello as a project management tool") repeats in most paraphrases and reads templated. It is harmless to measurement and keeps the head-to-heads parallel, which is intended. Only J1 and J9 are real problems in these cells. Note also AmEx [27]: "american express" is lowercase in all 10 prompts while "Capital One" is capitalized.

---

## 3. Coverage observations (judgment - labeled as such)

- **Jira: the ITSM scenario fights the category noun.** Ten cells (problem_recognition through business_case) ask for "project management tools" to run a service desk ("Which project management tools include SLA policies with business hours..."). Service-desk buyers say "ITSM / service desk software", so engines may answer with ServiceNow or Freshservice, or say a PM tool is the wrong category. That makes these cells read as a stress test of Jira Service Management's visibility under a mismatched noun, not a natural buyer ask. The cause is the `blind_missing_category` rule forcing the tracker's category noun into an adjacent category's scenario. Decide whether ITSM belongs on this tracker or on its own.
- **Jira: head-to-heads go to the wrong rivals for this audience.** ANGLE_SLOTS takes the first four same-seat rivals in roster order (Asana, monday.com, Trello, ClickUp), which are business-team tools. GitHub (Issues/Projects) and Azure DevOps, the dev-native rivals of a "software development teams" tracker, get no comparison or alternatives cell. Linear is not on the roster at all, although AGENTS.md records it in 36% of jira answers. A roster reorder plus adding Linear changes the head-to-head picture materially.
- **AmEx: annual-fee value is heavily overrepresented.** At least 8 of 55 cells turn on whether the fee pays off: objection 36, renewal 49, renewal 50 (credits), pricing 37/38/39/40, and advocacy 54 (the friend's "not worth the fee"). Combined with J2, the fee story will dominate both the doubt and pricing views.
- **AmEx: co-brand cards are absent.** The fit check proposed "Co-brand airline/retailer card" (Delta, Hilton, Marriott) as a missing core scenario and it was not adopted. That portfolio is a large share of how buyers meet American Express.
- **AmEx: no premium_worth cell** (not recommended, not kept). AGENTS.md calls the category-tier cell "the gateway question" for premium brands. Consider adding it.
- **Pixel: the camera-first purchase is missing.** The fit check proposed "Camera-first upgrade" as the missing core and it was not adopted. No open-choice cell asks for the best camera phone, Pixel's strongest home-turf ask. Camera appears only as one criterion among several (cells 10, 11, 21) and in the video objection (32).
- **Pixel: AI features are never probed.** Gemini, call screening and on-device AI have no cell, although "ai features" is a confirmed Pixel reason code and spam-call screening was a top uncoded cluster in the v3 relabel.
- **problem_resolution in all three** (Jira burndown rollup, AmEx duplicate payment, Pixel Bluetooth drops) is the known sample-size-one design (AGENTS.md group-3 to-do). AmEx's duplicate-payment cell is pure customer-service logistics, the failure shape AGENTS.md predicted. Unchanged and out of core metrics, so noted only.
- **Out of scope, noticed:** there are two byte-identical "Hydro Flask" drafts (saved 21:35:59 UTC, 0.5s apart). This looks like a double-save.

---

## 4. Clean bill - checked and passing

- Brand rules on all 1,650 prompts (blind stages name no brand, must-name stages name the client brand and no rival, comparisons name exactly their pair, class cells evoke their class and name no same-seat rival, offensive alternatives never name the client).
- Seed rules: no blind seed missing its category noun, no quantities in any comparison seed (s11's mechanical slice), and one label leak (M1, flagged).
- Numbers: no paraphrase carries a quantity its seed lacks. Spot-reads confirm the exact preservation of 35->100 engineers, 6 agents / 60 requesters / 300 tickets, 600/250/150/200/300, $400-500, 36 months, OLED/120 Hz/4 years, and 3 employees.
- Specs: every stored cell spec equals its re-derivation from the current roster. No `phrasedFor` drift (no stale paraphrase sets), every cell has exactly 9 paraphrases, and no generator meta-text or planning vocabulary ("spec-driven" etc.) remains.
- s10 invariance: every comparison, worry, alternatives and invariant-stage cell is unscenarioed, and the class cells are additive (2 on AmEx, none where no upstream class exists).
- s12: no paraphrase of an invariant cell writes its persona into the text. The asker roles stay in the asker field. Situational cells carry their circumstance in the words as intended (Teen first phone, Platform switcher and Startup cells are especially good).
- A3: every churn and renewal cell speaks as an existing customer and names the brand. Every worry cell voices its assigned concern as the main point, apart from J5 (a lookup) and the J8 paraphrase-level drift. The "Video still trails iPhone" concern is voiced without naming the rival ("isn't on par with the best phones"), which is correct under must-name rules.
- Product lines, not model years: "Pixel A-series / regular / Pro", "American Express Platinum" and "Jira Service Management" throughout. No model-year pairings.
- Pricing cells other than AmEx 39 are proper value math with usage inputs (Pixel 36-39 and AmEx 38 are model examples).
- Cross-cell: no duplicate asks between cells beyond the intended parallel head-to-head template and the by-design worry-at-both-stances pairs (Jira lock-in, admin burden and price; Pixel overheating; AmEx annual fee).

---

## Counts

| | Jira | AmEx | Pixel | Total |
| --- | --- | --- | --- | --- |
| Cells audited | 59 | 55 | 51 | **165** |
| Prompts audited (seed + 9) | 590 | 550 | 510 | **1,650** |

Findings by severity (one finding can span batteries; counted once):

| Severity | Count | IDs |
| --- | --- | --- |
| S1 ship-blocker | 1 | M1 |
| S2 high | 2 | J1, J2 |
| S3 medium | 11 | J3-J13 |
| S4 low | 11 | J14-J24 |
| Coverage observations | 7 (+1 out-of-scope note) | section 3 |

Mechanical: 1 hard finding (M1). Everything else above is judgment. Most S3/S4 items are paraphrase-level and fixable at the Prompts gate by replacing individual paraphrases; J1, J2, J5, J6, J10 and J11 need a seed edit and a redraw.
