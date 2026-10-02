# Seed audit - cold walk round 2 (s29/r13 engine) - Jira, American Express, Netflix, Google Pixel (2026-10-02)

**Scope.** All 206 seeds from one cold walk per brand (`cold_walk_r13c/cold_seeds_<brand>.json` in the session scratchpad). Each battery came from the full setup chain run against an empty store, with defaults accepted everywhere. The engine is the working tree: STYLE_VERSION s29, SEED_RULES_VERSION r13. The rosters, scenarios and worry picks are fresh draws and differ from round 1.

| | Jira | American Express | Netflix | Google Pixel |
| --- | --- | --- | --- | --- |
| Category | project management tools | credit cards | streaming video services | smartphones |
| Roster | Asana, Trello, ClickUp, monday.com, GitHub Issues, Linear, Azure DevOps (all same-seat) | Visa, Mastercard (upstream, class cells "a Visa card" / "a Mastercard"); Chase, Capital One, Discover, Citi, Bank of America (same-seat) | Disney+, Amazon Prime Video, Max (HBO), Hulu, Apple TV+, Peacock, Paramount+ (all same-seat) | Apple iPhone, Samsung Galaxy, OnePlus, Xiaomi, Motorola, Nothing, Oppo (all same-seat) |
| Rival cells (4 slots) | Asana, Trello, ClickUp, monday.com | Chase, Capital One, Discover, Citi + 2 class cells | Disney+, Prime Video, Max, Hulu | iPhone, Galaxy, OnePlus, Xiaomi |
| Scenarios | Enterprise agile standardization; Replacing legacy tracker; Scaling past starter board; New squad spin-up | Premium travel perks; Airline loyalist co-brand; Small-business travel perks; Dining and grocery maximizer | Household staple service; First-time signup; Kids-first household; Ad-supported value plan | Carrier deal upgrade; Value midrange shopper; Android unlocked upgrade; Parent buying first phone |
| Worry picks | objections: too complex/heavy, reporting gaps, migration pain; churn: admin burden, slow at scale, support, cloud outages; renewal: price creep and add-ons | objections: spotty acceptance; churn: redemption headache, lounge crowding, Amex Travel hassles, shifting terms, unreliable approvals; renewal: annual fee steep, credits hard to use | objections: titles leave quickly, too few streams, parental controls trust; churn: not enough must-watch, sharing crackdown, ads heavy, streaming quality; renewal: price feels high | objections: iMessage lock-in, battery aging, Tensor heat, Google privacy, video behind iPhone, update longevity, price high; churn: buggy, warranty and repairs |
| Kept stages | 19 (all) | 18 (no business_case) | 17 (no category_education, feature_screening, business_case) | 17 (no renewal, business_case) |
| Seeds / missing | 54 / 0 | 53 / 0 | 47 / 0 | 52 / 0 |

**Bar.** The same adversarial bar as every round, judged against the written contracts: `CELL_WRITER_SYSTEM` (s29), `stageDesignIntent` / `seedDesignLine`, `seedRule` (r13), the AGENTS.md decided boundaries and the s23 pricing-shape ruling. A flagged seed counts as surfaced. Severity: **S1** ship-blocker / **S2** biases a measurement / **S3** fix at the gate / **S4** polish.

**Mechanical facts (all four batteries, verified by script).**
- No calendar years, em dashes, tildes, curly quotes, segment vocabulary or 3+ question pile-ups. 26 seeds ask two questions.
- Longest seed is 55 words (amex [36]). None over 55.
- Every worry pick appears as exactly one cell carrying its concern (33 of 33).
- The engine's own checks (`deriveCheckSpec` + `checkPromptAgainstSpec` + `scenarioLabelLeak`, with each cold store's cached dictionary aliases) pass all 206 seeds. No blind seed names a brand under the r13 matcher. Every stored qtype matches a recomputation.
- Zero gate chips in all four batteries. Every finding below is therefore unflagged.

---

## Counts

| | Jira | AmEx | Netflix | Pixel | Total |
| --- | --- | --- | --- | --- | --- |
| Seeds | 54 | 53 | 47 | 52 | 206 |
| Flagged (gate chips) | 0 | 0 | 0 | 0 | 0 |
| S1 | 0 | 0 | 0 | 0 | 0 |
| S2 | 0 | 0 | 2 | 1 | 3 |
| S3 | 2 | 0 | 2 | 0 | 4 |
| S4 | 6 | 7 | 9 | 7 | 29 (+1 engine) |

---

## Round-1 classes: recurred or closed

| Round-1 class | Status | Evidence this round |
| --- | --- | --- |
| F1 verb-less stated prices ("Gold at 250", "A-series around 450") | **Closed in the seeds** | No seed states a product's price in that form. The AmEx brand cell [34] names Platinum with no fee. But see G3: the writer prompt still teaches the form, and that is the likely cause of N1. |
| F2 common-word brand tokens / "Amex" not recognized | **Closed** | "issues" used freely in blind and pricing seeds (jira [23], [35]); "Amex or Discover" [29] and "the case for Amex" [53] pass; "my bank's rewards" (amex [4]) is not Bank of America; no "Nothing" or "phone" false hits. No brand-rule rewrites in any log. |
| F3 unnamed pricing cell that describes one product's plan structure | **Closed** | No pricing seed describes one product's plan or add-on ladder with the name removed. |
| F4 money bolted onto non-price worries | **Recurred** | netflix [27] "wastes my money", [29] "not worth paying for Netflix" - on the same two concern families as round 1 (titles disappearing, parental controls). r13's regex misses both forms. See N2. |
| F5 open-choice seed that does not invite named picks | **Closed** | Every discovery, shortlist, feature_screening, use_case and social_validation seed asks for names. |
| F6 feature screen with no circumstance | **Closed** | All 12 feature_screening seeds carry their scenario in the asker's words. |
| F7 off-category pricing trade-off / third-party fee | **Closed** (one S4 residue) | No off-category trade-offs. amex [35] still states a generic co-brand fee ("$95 fee"), as round 1's [36] did. |
| F8 problem_recognition asker already pays for the product | **Closed** (one S4 ambiguity) | netflix [4] now pays for cable, not streaming. amex [4] "my bank's rewards" is ambiguous (debit or credit). |
| F9 Linear gets no rival cell | **Recurred** | Linear ranked 6th of 7; all four rival slots went to general work-management tools. See N3. |
| F10 "fee" matching inside "feel" | **Closed** | The concern test is word-anchored. "Ads feel heavy/repetitive" is now treated as non-price, and its cell [36] has no bolt-on. |
| G1 generic pricing cells with no pick ask | **Recurred** (contract gap, still open) | Jira [35], [36], [37]; Netflix [30], [31], [32]; Pixel [38], [41] weigh payment structures, not products, and feed open_choice. |
| G2 the trade-off diversity heal causes the pricing problems | **Recurred in new forms** | Jira [37] (heal produced a cost estimate with no trade-off, N4); AmEx [36]/[37] (two different duplicates both healed onto "0% intro APR vs rewards"); Pixel brand steer failed once and stopped (N1). |
| G3 writer prompt still contains a price-stating example | **Open** | `CELL_WRITER_SYSTEM` still reads "the cheaper line at 450, or pay up for the regular one?". r13 now rejects that exact form, so the prompt and the checker fight. |
| S4 carry-overs | Mixed | Recurred: ecosystem seeds never state the relationship (amex [52], netflix [46], pixel [51]); churn stay option is an upsell (netflix [36]); all business_case seeds pitch the CFO (jira [38]-[40]); status framing (netflix [21]). Closed: class cells not parallel; "Leaving Apple iPhone"; Netflix scenario overlap. |

---

## 1. S2 findings (all unflagged)

**N1 [S2] Google Pixel: no pricing cell names Google Pixel. The battery invariant broke silently.** COUNTABLE (the engine already counts it).

- All four pricing seeds are generic and typed open_choice:
  - [38] carrier credits vs buying unlocked
  - [39] "a solid $400-ish model, or spend about $650"
  - [40] "a midrange around 500, or finance a higher-end one around 900"
  - [41] new vs certified refurbished
- **Rule violated:** the writer rule "at least one pricing cell names the client brand and does its own math", and the AGENTS.md hardening rule "at-least-one-brand-named pricing cell enforced on the POST-heal battery".
- **Why it biases a measurement:** the within_brand pricing view (how the AI argues Pixel's own lines, e.g. the a-series vs the regular Pixel) has no cell, so the tracker cannot report it.
- **Mechanism (log):**
  - `pricing diversity: no cell names Google Pixel - steering [3] to the brand's own math`
  - `pricing diversity: brand steer rejected (mech ) - original stands`
  - The steered candidate failed a mechanical rule. The engine made one attempt with no steered retry (the s29 dedup regens get one; the brand steer does not), attached no `seedFlags`, and did not set `passesCut`. So the completion marker was written and the pass will never re-run. The gate shows nothing.
  - The rejected text is not logged. The most likely failure is r13's new verb-less price check: the brand steer asks for "its tiers or lines against each other", and the writer prompt's own example teaches "the cheaper line at 450". "Pixel a-series around 499" is exactly what r13 now rejects. This is the G3 conflict turning into a lost cell.
- **Engine fix:**
  1. Give the brand steer the same steered retry the dedup regens have, passing the failed check.
  2. If it still fails, put a `seedFlags` entry on the steered pricing cell ("no pricing cell names Google Pixel") so the gate shows it.
  3. Log the rejected text and the failed checks.
  4. Close G3: replace "the cheaper line at 450, or pay up for the regular one?" with "the cheaper line, or pay up for the regular one?". This is a writer-text change, so it needs s30.
- **Gate fix:** rewrite [39] (Value midrange shopper) as the brand cell, and leave the generic price-level shape to [40]: "Looking at the Pixel a-series vs stretching to the regular Pixel. I keep phones 4 years, take lots of photos, no gaming. Is the regular one worth the extra over that time, or is the a-series the smarter buy?"

**N2 [S2] netflix [27] and [29]: money bolted onto non-price objections, again.** COUNTABLE.

> [27] "Titles leave too quickly": "Netflix keeps pulling movies right when I find them. Am I going to lose stuff mid-subscription in a way that **wastes my money**, or do they give enough notice so **I'm not paying for** shows that disappear?"
>
> [29] "Parental controls trust": "Can I actually trust Netflix's parental controls? If kids profiles and PINs don't reliably block mature stuff, is that a reason **it's not worth paying for Netflix**, or do sneaky titles still slip through?"

- **Rules violated:**
  - The doubt design intent: "when that concern is not itself about price, a bolted-on cheaper-options or price remark does not satisfy the design".
  - The writer rule: price has its own cells.
- **Why S2:**
  - Both asks turn the confirm/rebut verdict into a money verdict. A month-to-month service invites "low risk, cancel anytime" as the rebut, so the answer measures cost exposure, not Netflix's catalog churn or its controls.
  - [29] also has two readings. "Is that a reason it's not worth paying, or do titles still slip through?" is not a real either/or.
  - [27] also blurs the stance. "Keeps pulling movies right when I find them" and "mid-subscription" sound like a current subscriber, but objections speak as a prospect.
- **Why r13 missed both:** its bolt-on regex is `wast(?:e|ed|ing)\s+(?:my|our)?\s*money`. That pattern does not match "wastes", and nothing in it matches "worth paying". The design check passed both cells.
- **Proposed check:** add `\bwast(?:e|es|ed|ing)\b[^.?!]{0,12}\bmoney\b|\bworth paying\b` to `concern_price_bolt_on`.
  - Calibrated on all 3,561 unique seeds in every walk's scratchpad.
  - Out of 544 doubt cells with non-price concerns, it hits 5 cells: these two, round 1's [27]/[28] (which r13 already catches), and one r13b "Is it worth paying for Netflix if I'll still have to add another..." on a must-watch worry. All 5 are true bolt-ons, with 0 false positives.
  - Plain "paying for" was rejected for the regex: it flags relationship statements ("We're paying for Jira but adoption is weak").
  - Needs an r-bump (r14). The re-judge regenerates only these cells.
- **Gate fixes:**
  - [27]: "Thinking about Netflix, but I keep hearing they pull movies and shows with barely any warning. Do titles really disappear that fast, or is that overblown?"
  - [29]: "Thinking about Netflix for the kids. Can I actually trust the kids profiles and PINs to keep mature stuff out, or do things still slip through?"

---

## 2. S3 findings

**N3 [S3] Jira: the dev-native rivals get no head-to-head or alternatives cell.** JUDGMENT (profile ranking feeds roster order).

- The profile ranked Asana, Trello, ClickUp and monday.com first. ANGLE_SLOTS = 4 gave them all eight rival cells. Linear (6th), GitHub Issues (5th) and Azure DevOps (7th) get none.
- The profile's own audience is "software development teams". The three rivals with no cells are the ones that audience actually compares against. Linear appears in 36% of jira answers in the census and is the riser the "risers mandatory" prefill change was made to capture.
- This is round 1's F9 again, from a different roster draw.
- **Gate fix:** at the market step, drag Linear and GitHub Issues into the top four, and drop Trello and monday.com.
- **Follow-up (already planned):** a post-wave alone-share re-rank should own slot order. Until then, the audience field could weight the ranking ("ranked by how often AI assistants name them to <audience>").

**N4 [S3] jira [37] (pricing, open_choice): a cost estimate, not a trade-off.** JUDGMENT, with a contract gap.

> "Spinning up a squad of 12 for about 18 months. What would the total cost of a project management tool actually look like over that period, with per-seat pricing, a couple paid integrations, and some guest access? Also, **where do costs tend to creep?**"

- **Rule violated:** the pricing design intent ("reasons about a price/value TRADE-OFF ... generic to the category's price structure (paid vs free, fee vs no-fee, financing vs buying outright, paying up for a higher tier vs the base)"). This seed weighs no two options, so the answer has no verdict to give.
  - Its second ask, "where do costs tend to creep?", is a worry in pricing clothes.
  - Typed open_choice, it adds near-brandless answers to the headline denominator.
- **Mechanism (log):** the diversity pass labeled the original Jira tier seed a duplicate of [34] and healed it into this one. The labeler prompt lists "total cost over time" as a valid class, and the heal steer suggests it. The pricing intent lists that form only for brand-named cells. That disagreement is the contract gap: decide whether generic "total cost over time" is a valid generic shape. If it is, require two options.
- **Gate fix:** "Spinning up a squad of 12 that could double in 18 months. For project management tools, does per-seat pricing or a flat team plan come out cheaper over that stretch? Which would you pick?" This per-seat vs flat shape duplicates nothing else in Jira's pricing: [34] is a tier question, [35] is free vs paid and [36] is billing cadence.

**N5 [S3] netflix [43] (renewal, "Price feels high"): the worry is implied, not voiced, and the ask leads with an alternatives scan.** JUDGMENT, with a countable slice.

> "**Netflix is up to about 20 a month for me now.** Are there cheaper streaming video services that cover the basics, or should I just stick with it?"

- **Rule violated:** the doubt design intent ("voices the buyer's concern ... stated as the asker's own claim or feeling that an answer could confirm or rebut").
  - The seed states a figure but never says the price feels high or asks whether Netflix is still worth it.
  - The first ask is an alternatives scan. That is allowed on a price concern, but it makes the answer a list of cheaper services rather than a keep-or-leave verdict on the price.
- **The figure is the r12 disease in the asker's-bill exemption.** "Up to about 20 a month" is Netflix's list price from world knowledge, restated as the asker's bill. The `planAfter` exemption ("a month") lets it through. It will drift as prices change.
- **Countable slice:** flag `(is|are|now|up to|at)` followed within 10 characters by a figure plus "a month / per month / a year" in must-name and doubt cells. Across 913 such seeds in the corpus it has 1 hit (this one) and 0 false positives. The judgment part (the unvoiced worry) is the bigger problem.
- **Gate fix:** "Our Netflix bill keeps creeping up and it's starting to feel like too much for what we actually watch. Is it still worth keeping, or is it time to cancel?"

**N6 [S3] netflix [26] (premium_worth): plan vocabulary and a budget frame tilt the tier verdict.** JUDGMENT.

> "Are the big paid streaming video services actually worth it over the cheaper or free ones? **For a household staple or kid-friendly setup on a budget**, name a few you'd pick in each camp."

- **Rules violated:**
  - The writer rule against scenario-label text. "household staple" is the label "Household staple service", and "kid-friendly setup" echoes "Kids-first household". The leak check only catches full labels.
  - The premium_worth intent says the tier is weighed "from either side". "On a budget" pre-loads the basic side, and the design line makes every paraphrase keep that circumstance.
- premium_worth measures whether the AI talks buyers out of the premium tier. A budget frame on every paraphrase moves that read toward "free is good enough".
- **Gate fix:** "Are the big paid streaming video services actually worth it over the cheaper or free ones? Name a few you'd pick on each side."

---

## 3. Flag adjudication

No seed shipped with a gate chip. The logs show every mid-generation flag healed:
- Jira: 1 switch-direction flag and 6 design flags.
- AmEx: 3 label leaks and 9 design flags. One pricing cell went flagged-terminal, then the diversity pass replaced it with a clean seed.
- Netflix: 7 design flags.
- Pixel: 7 brand-rule flags and 6 design flags.

Two log events matter:
- **Pixel brand steer rejected (N1).** This is the one silent failure. It should have become a chip.
- **Netflix drive 1 design-check crash.** `JSON.parse` threw on a reply with trailing content ("Unexpected non-whitespace character after JSON at position 149"). The greedy `\{[\s\S]*\}` at instrument.ts:1673 grabs from the first `{` to the last `}`. The unit went provisional and drive 2 recovered it as designed. Robustness S4: parse the first balanced object.

---

## 4. Per-brand judgment calls

**Jira**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing shapes | Within s23, but N4 | [34] Premium vs Enterprise (Jira, 480 users, 3 years); [35] paid vs free tiers; [36] annual vs monthly billing; [37] cost estimate (N4). One brand-named cell. |
| Doubt cells | Clean | 8 picks, 8 cells, each a confirmable claim. Objections speak as prospects ("If we buy Jira", "If we switch to Jira"). Churn and renewal keep staying on the table: "still the right call ... or move", "tuned ... or plan a switch", "stick with Jira or move on", "double down and stay ... or plot an exit", "still worth it ... or move off at renewal". |
| Comparisons / alternatives | Clean except N3 | Comparisons are neutral and ask for the pick. Offensive alternatives are bare. The defensive seed [45] is an existing customer ("We're a Jira shop now"). Round 1's S4 note on the defensive seed is closed. |
| Awareness | Accepted (carry-over) | [2] and [3] askers own an old tracker or a starter board, which their scenarios presuppose. All four end on a way-out ask. |
| Blind vocabulary | S4 | [20] "epic > story > sub-task" is Jira's default hierarchy, spelled Jira's way, and [17] "custom issue types" is Jira's noun. Both lean answers toward Jira in blind cells. Mild, because the asker's circumstance points there anyway. |

**American Express**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing shapes | Within s23 | [34] Platinum vs a lower-fee card (brand, no stated fee); [35] mid-tier co-brand vs no-fee vs general travel card ("Which would you pick?"); [36] and [37] both 0% intro APR vs rewards (business vs dining circumstance; two allowed). Both [36] and [37] are diversity-heal outputs that converged on one shape. |
| Class cells | Clean | [31] "American Express or a Visa card", [32] "American Express or a Mastercard". The target and class are named, with no rival and no category tail. |
| Doubt cells | Clean | 8 picks, 8 cells. No money asks. The renewal fee cell [48] keeps "go cheaper" legitimately (price concern). |
| Register | Improved | The checker no longer forces "American Express". [29] and [53] say "Amex". The rest use the full name by writer habit, not by checker pressure. |

**Netflix**

| Area | Result | Detail |
| --- | --- | --- |
| Scenarios | S4 | Two of four scenarios are relationship states, not buying moments ("already-subscribed home ... lets it auto-renew"; "stays subscribed by choosing the ads tier"). The writer re-voiced their acquisition cells as prospects (cord-cutters picking a staple, budget households choosing an ad plan), so the seeds work, but the scenario descriptions do not match their cells. |
| Pricing shapes | Within s23, G1 heavy | [30] keep one year-round vs rotate or free; [31] month-to-month vs trial-hopping; [32] keep one year-round vs rotate (same shape as [30], different circumstance); [33] ad plan vs ad-free (brand). The three generic cells ask no pick. |
| Doubt cells | N2, N5 | [28] (streams) and the four churn cells voice their worries; [34] "keep it going ... or pause" keeps staying on the table. |
| Comparisons | S4 | [22]-[25] are one sentence with the rival swapped. |

**Google Pixel**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing | N1 | No brand cell. Shapes: carrier vs unlocked, price level ([39], [40]), new vs refurbished. |
| Switch direction | Clean | Every Android unlocked upgrade seed stays on Android ("staying on android", "Upgrading my Android"), so Pixel stays eligible. |
| Doubt cells | Clean | 9 picks, 9 cells. [35] voices "behind on video" without naming iPhone, as the must-name rule requires. [37] voices price as a verdict ("is it overpriced?"), not math. Churn cells keep staying on the table. |
| Comparisons / alternatives | Clean | [27] says "iPhone", the buyer's name. Alternatives are bare. |

---

## 5. Contract gaps (for a decision)

- **G1 (open, recurring).** Generic pricing cells that weigh payment structures (billing cadence, free vs paid, carrier vs unlocked, new vs refurbished, rotate vs keep) ask no product pick and feed the open-choice headline. This round has 8 such cells across three batteries. Options: give price-structure cells their own qtype, or require a pick ask on every generic pricing cell.
- **G2 (recurring).** The diversity heal and brand steer still produce this round's pricing problems: N1 (one shot, silent), N4 (cost estimate with no trade-off) and the AmEx [36]/[37] convergence. Fixes: a steered retry plus a flag for the brand steer (N1), and requiring the heal to name two options.
- **G3 (open).** Remove "at 450" from the writer prompt (s30). It now actively causes rejections (N1).
- **G4 (new).** Is generic "total cost over time" a valid generic pricing shape? The labeler and heal steer say yes; the design intent lists it only for brand-named cells (N4).

---

## 6. S4 (polish; does not block)

**Jira (6)**
- [38]-[40] All three business_case seeds pitch the CFO or leadership (carry-over).
- [53] Ecosystem seed lists five things (grooming, code reviews, releases, docs, plus incidents and on-call).
- [20] "epic > story > sub-task" and [17] "custom issue types" are Jira's own schema in blind cells.
- [6] "enterprise-scale agile", [10] "enterprise rollout", and [36]/[40] "starter board" echo the scenario labels.
- [18] "PI-level rollup reporting" is SAFe jargon.
- [35], [36] Price-structure cells with no pick ask (G1).

**American Express (7)**
- [35] "the airline's mid-tier card with a $95 fee" states a class fee from world knowledge (carry-over).
- [36] 55 words and six figures, plus a balance-carrying sub-story. That breaks the two-or-three-figure rule.
- [52] Ecosystem seed never states the relationship ("What pairs well with American Express?") and lists four tool types.
- [49] Leave side reads "cut it and simplify". The writer rule bans "simpler" leave sides on non-price worries. It is ambiguous here because the worry is complexity.
- [16] "For a small-business that travels" is ungrammatical.
- [4] "my bank's rewards" may mean the asker already holds a card (awareness stance unclear).
- [10] Premium shortlist lists features but carries no personal circumstance.

**Netflix (9)**
- [36] Churn stay option is an upsell ("upgrade to ad-free") (carry-over).
- [46] Ecosystem seed never states the relationship.
- [38] Defensive seed is voiced hypothetically ("If we move off Netflix"), not as a stated relationship.
- [22]-[25] Four comparison seeds are one sentence with the name swapped.
- [21] "people brag about keeping" adds status framing and drops a verb; [6] and [14] say "vibe".
- [15] "kids-first house" echoes the label "Kids-first household".
- [28] Objection tails into a plan-rules lookup ("or do you basically have to step up a tier?").
- [35] "the extra fee stings" on the sharing-crackdown worry. This is money-adjacent, but arguably part of the worry itself.
- Two of four scenarios describe existing subscribers (see section 4).

**Google Pixel (7)**
- [39] "Phone budget question:" is a topic opener, which the writer rule bans. COUNTABLE: `^<word>( <word>){0,3} question:` excluding Honest/Quick/Basic/Dumb/Serious/Real has 3 hits in 3,561 seeds, all true.
- [51] Ecosystem seed never states the relationship. Across all walks, 36 of 67 ecosystem seeds have no ownership words, so this is chronic.
- [44] Defensive seed is voiced hypothetically ("If I move off Google Pixel").
- [34] Privacy objection sizes an assumed loss ("How much am I giving up on privacy").
- [5] Category education lists five parts (camera, chip, screen, battery, AI).
- [2] Awareness drifts toward price tier ("without paying top-tier prices", plus a stated budget).
- [45] Copies the writer prompt's example almost verbatim ("Done with my iPhone").

**Engine (1)**
- The design-check JSON parse is greedy (instrument.ts:1673) and crashed one Netflix drive. It recovered on drive 2.

---

## 7. Bottom line

No S1. r13 closed the round-1 brand-detection and stated-price classes cleanly: zero false brand hits and zero verb-less prices in 206 seeds, and zero gate chips. But it leaves three unflagged S2s. Two are the round-1 money bolt-on class surviving through the regex's word forms. One is a broken battery invariant that the engine detected and then dropped silently.

| Battery | Verdict | Exact blockers |
| --- | --- | --- |
| **Jira** | **Ready after 2 gate edits** | N3 put Linear (and GitHub Issues) into the rival slots; N4 rewrite [37] as a two-option trade-off |
| **American Express** | **READY** | none (7 S4s) |
| **Netflix** | **Not ready** | N2 [27] and [29] remove the money bolt-ons (S2); N5 [43] voice the price worry; N6 [26] drop the scenario and budget frame |
| **Google Pixel** | **Not ready** | N1 add a Pixel-named pricing cell (S2) - gate rewrite of [39] |

**Engine fixes, in order:**
1. **N1:** the brand steer gets a steered retry, flags the cell when it still fails, and logs the rejected text. Close G3 in the same change (remove "at 450", s30).
2. **N2:** add `\bwast(?:e|es|ed|ing)\b[^.?!]{0,12}\bmoney\b|\bworth paying\b` to `concern_price_bolt_on`. That is 5 true hits and 0 false positives across 544 non-price doubt cells in every walk. r14.
3. **N5 slice** (optional, r14): a brand's monthly price stated in a must-name or doubt cell. 1 hit and 0 false positives across 913 such cells.
4. **G4 / N4:** decide whether generic "total cost over time" counts as a pricing shape. Either way, require the heal output to weigh two options.
5. **Robustness:** parse the first balanced JSON object in the design check.
