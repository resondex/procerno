# Seed audit - Netflix fresh walk (cold roll, s29/r11 engine) (2026-10-02)

**Scope:** all 47 seeds in `cold_seeds_netflix.json`. They were produced by a full setup chain from an empty local store, with defaults accepted at every step. I judged them against `cold_netflix_context.json`:
- **Roster:** 7 same-seat rivals, no class cells.
- **Scenarios:** Cord cutter anchor, Family with kids setup, Solo apartment setup, Budget ad tier.
- **Worry picks:** 9, split 2 objections / 4 churn / 3 renewal.
- **Kept stages:** 16. No category_education and no feature_screening.

The bar is the same adversarial bar as every round, applied to the same contracts: s29/r11 rules, the s23 pricing-shape ruling, and flags counted as surfaced to the human. Severity: **S1** ship-blocker / **S2** high / **S3** medium (fix at the gate) / **S4** low.

---

## Counts

| | Count |
| --- | --- |
| Seeds | 47 |
| Flagged (gate chips) | 0 |
| S1 / S2 | 0 / 0 |
| S3 | 2 findings (3 cells) |
| S4 | 6 |

---

## 1. S3 findings

**F1 [S3] Netflix [43] (renewal, concern "Canceling or pausing hassle"): the seed offers no option to stay, and it reads as a how-to lookup.**

> "Thinking of pausing Netflix for a couple months, but canceling and restarting sounds like a hassle. Is that easy enough to manage, or should I just cancel and move on?"

Both options are exits: pause (cancel and restart) or cancel. That is a problem for two reasons:
- Keeping the subscription is never on the table, so this cell's keep-vs-leave read leans toward "leave" by construction.
- "Is that easy enough to manage" asks how Netflix's cancel and rejoin works, so the answer will be a process explainer.

This is the same shape as the AmEx "Welcome bonus confusion" cell: the concern is about exit-process friction, which naturally becomes a lookup. The stay-or-go design check accepted "pause or cancel" as stay-or-go.

Gate fix: voice the friction as distrust and put both stay and leave on the table. For example: "Netflix seems to make pausing a pain, so I end up paying for months I don't watch. Is it worth keeping it year-round, or should I cancel between shows and come back later?"

**F2 [S3] Netflix [29], [31]: the pricing seeds state Netflix's price points, and those prices are already out of date.**

- [29] (within_brand): "If Netflix **Standard is about 15 and Premium is around 23**, is Premium actually worth it for us...?"
- [31] (generic): "the **ad plan is around 8 bucks and ad-free is roughly 15**". These are Netflix's own tier prices, so the cell is effectively an unnamed brand-tier question.

Why this matters:
- **The figures are already wrong.** They are Netflix's 2023-24 prices, and Netflix raises prices often, so they will drift further with every wave.
- **Every answer starts from a false premise.** An engine has to either correct the figures or reason from them.
- **The error grows over time and contaminates the trend line.** It is the same reason calendar years are banned from seeds (N2): a seed that asserts something time-bound decays across waves.

Usage numbers are fine as input. The problem is figures that describe the brand's own prices. The same flaw is in the warm AmEx battery that passed FINAL: amex [40] reads "American Express Platinum at $695... over Gold at $250", and both fees have since risen.

Gate fix: name the tiers and leave the prices to the answer.
- [29]: "Family of five, three TVs. Is Netflix Premium actually worth it over Standard for us, or will Standard cover it without constant stream conflicts?"
- [31]: "I watch about 25 hours of streaming a month. Would you go with a cheaper ad-supported plan or pay more to skip ads?"

Mechanical follow-up: add a check that flags a currency figure placed next to a brand or tier name in pricing seeds (asserted brand prices). The writer rule should also say that seeds ask for prices rather than state them.

No S1 or S2.

---

## 2. Streaming-specific judgment calls

| Area | Result | Detail |
| --- | --- | --- |
| Ad tier vs premium pricing shapes | Within the s23 ruling | [29] brand tier and [31] ad vs ad-free are two price-level cells. [28] "one premium service plus free apps vs two paid" and [30] "one ad-free vs two ad-supported, or rotate" are two stacking cells. Each pair spans different circumstances, and both structures are central to streaming. [29] is the brand-named cell. Every pricing seed carries usage (nights per week, household size and TVs, hours per week, hours per month). |
| Budget ad tier vs the pricing boundary | No collision | The scenario's blind cells ([4], [8], [12], [16], [20]) treat ads and budget as circumstance and ask open-choice or awareness questions. Only [31] does price math. [8] ("cheapest legit streaming options with ads... best low-cost plans") is a discovery question asked in the right stage. |
| Password sharing and catalog churn worries | Clean | [32] "the password-sharing crackdown broke how our family used it. Do we keep the subscription or drop it?" and [33] "canceling series after a season or two... hanging on, or pause". Both voice the assigned concern and state keep-or-leave; pause reads as leave for a streaming service. |
| Device and platform vocabulary | No problem | There is no switcher scenario. Device vocabulary in [4] (phone, laptop, TV), [27] (TVs and phones) and [46] (streaming boxes, smart TVs, Dolby Vision) is plain buyer speech, and no rival is named. |

Also holding:
- Blind seeds name no brand, and open-choice seeds invite named picks.
- Awareness seeds end with a way-out ask, and problem_recognition askers own cable, not streaming.
- All four comparisons are neutral and ask for a pick.
- The two objections are pre-purchase and on-concern.
- Churn seeds state keep-or-leave, with no money asks or "cheaper" add-ons on non-price concerns. [41] uses "cheaper" on its price concern, which is correct.
- Offensive alternatives are bare and keep the category anchor, and defensive alternatives come from existing customers.
- There are no year, label, segment, quote or meta leaks. Every angle field is valid. No seed exceeds 51 words.

---

## 3. S4 (polish; does not block)

- **Planning vocabulary and repetition in the Solo scenario.** [11] says "a **taste-driven** vibe". That is the journey moderator's vocabulary (verifiability: taste); "-driven" terms are banned as planning vocabulary, and the meta check missed it. "Vibe" also repeats across the Solo scenario ([3] "big vibe nights", [7], [15] "watch by vibe", [19]), so the moderator's think/feel setting shows through as a verbal tic.
- **Label echo.** [17] "to **anchor** a setup... what should be the core?" repeats the label "Cord cutter anchor". It slips past the leak check because the full label never appears.
- **Status framing and a grammar slip.** [21] reads "people **flex about**... rep as **part of their identity**". That is the identity framing flagged earlier, and the sentence is also missing "do".
- **Ad-copy register.** [3] "Small living room, big vibe nights."
- **Renewal moment never mentioned.** No renewal cell ([41]-[43]) mentions renewal. That is acceptable for a monthly subscription, where every billing date is a renewal.
- **Coverage, not a seed defect.** Apple TV+, Peacock and Paramount+ get no comparison or alternatives cell. The cap of 4 comparison/alternatives slots takes the first four rivals in roster order.

---

## 4. Bottom line

**READY for collection after 2 gate edits covering 3 cells. No S1 or S2.**

1. **[43]:** give the renewal a keep option and phrase the cancel/pause friction as a doubt (F1).
2. **[29], [31]:** remove the stated Netflix prices (F2).

No chips exist, so the reviewer needs this list. All three are one-sentence hand edits.

The fresh walk handled the streaming-specific traps well: the ad-tier/pricing boundary, the password-sharing and catalog worries, and device vocabulary. Every contract class from the three-brand loop holds on a brand the engine had never seen.

F2 exposes a flaw that predates this battery: seeds that state the brand's prices go out of date. It should be fixed in the writer and the checker before collection, and the passed AmEx battery's [40] should get the same hand edit.
