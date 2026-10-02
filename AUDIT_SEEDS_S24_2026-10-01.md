# Seed audit, final verdict (s24) - Jira, American Express, Google Pixel (2026-10-01)

**Scope.** All 165 seeds as regenerated under s24. Pixel [22] and [38] were evicted and re-rolled by the engine. `seedFlags` is null on all 165 seeds. Every seed is 56 words or fewer.

**Bar.** Same adversarial bar as the first audit.

**Severity key.**
- **S1** - ship-blocker.
- **S2** - high (fix before collection).
- **S3** - medium (fix at the gate).
- **S4** - low (polish).

---

## 1. s23 list

| Item | Verdict | Evidence |
| --- | --- | --- |
| F1 - AmEx pricing: no brand-named cell, fee trade-off repeated | **FIXED** | [39] is now the brand tier cell (within_brand): "With American Express, should I stick with a no fee option, go Gold around 250 a year, or Platinum near 700?" Only two generic fee cells remain, and their circumstances differ: [38] business ("no fee business card or paying 95-150 a year") and [40] premium travel ("premium... big annual fee, or stick with a mid-tier or no-fee"). [41] is a different structure (0% intro APR vs rewards). Under the s23 ruling this is acceptable. |
| F2 - AmEx "is this common?" endings | **FIXED** | All four now ask for a way forward: [1] "what's the normal way owners handle team spending...", [2] "is there a cleaner way to handle everyday spending...", [3] "what actually bundles the perks and protections...", [4] "how do people start building credit safely?" |

---

## 2. S3 findings

**F1 [S3] Pixel pricing: no cell names Google Pixel, and two cells repeat one trade-off. The [38] re-roll caused both.**

None of the four Pixel pricing cells names the brand; all are open_choice.
- This breaks the rule s24 says it enforces ("at-least-one-brand-named cell").
- It also breaks s19's rule that a budget circumstance makes the pricing cell the brand's tier question. [38] is the budget-pinned Midrange cell and asks a generic question: "better value to buy a new $450 model or a discounted last year flagship around $650?"
- s23's [38] was the A-series vs regular Pixel tier question. The eviction re-roll replaced it, and the battery-level diversity pass evidently did not re-run afterwards.

Two cells also ask the same trade-off:
- [37] "$650 in bill credits on a 36 month contract... Unlocked is $900 and I could sell my old one for about $250... Take the carrier deal or buy unlocked and resell?"
- [40] "my carrier will give 600 in bill credits over 36 months... Or I can sell my old phone for about 350 cash and buy unlocked for 600... Which is the better value?"

[40] also opens with "Switching from iOS to Android", which has nothing to do with the question.

Fix: make [38] the Pixel tier question again (A-series vs regular Pixel, with the usage it already has), and move [40] onto a different structure.

**F2 [S3] Jira pricing: [37] and [38] ask the same billing trade-off.**
- [37] "...$12 per user month to month or $115 per user billed annually, which ends up cheaper... would you lock annual or stay monthly?"
- [38] "...Better cost to lock in annual billing now or stay monthly until we hit 20 seats and switch?"

This is the duplicate-shape defect from s20 again, and the diversity pass let it through. Fix: move [37] (Mid-market) to a Standard-vs-Premium tier question or to paid vs free.

**F3 [S3] pixel [26] (social_validation, open-choice): the seed no longer asks for named phones.**
"What do people actually gush about in their phones right now? The stuff friends notice and post about."
It asks which features people gush about, not which phones, so answers will list cameras and screens rather than brands. Every open-choice stage must invite named picks; earlier versions ended "Name a few". Fix: "Which phones do people actually gush about right now...? Name a few."

**F4 [S3] pixel [5] (category_education): the seed became a premium-tier question.**
"What does paying more for a phone actually get you? Like, what do 'flagship' models really do better than cheaper ones in day-to-day use?"
- category_education should ask what the product does. This seed asks premium vs basic, which is premium_worth's shape and overlaps the pricing cells.
- It invites flagship model names on a cell that reports brand-named rate only, which inflates that rate by construction.

Fix: return to "What does a smartphone actually do these days beyond calls and texts?", or an equivalent that asks what the product does.

No S1 or S2.

---

## 3. S4 (polish, does not block)

- **Enterprise circumstance stated at mid-market size.** jira [10] (Enterprise) says "about 250 people and growing".
- **Thin circumstance.** jira [23] (Mid-market) has squads and a sprint cadence, but no growth.
- **Grammar.** jira [28] says "for project management tools", plural in the singular slot.
- **Business-case seeds.** All four jira business_case seeds still pitch the CFO ([43] adds the CIO).
- **Renewal not mentioned.** jira [55] never mentions renewal.
- **Near-duplicates.** amex [18] and [22] share employee cards with per-card limits, virtual cards and accounting export.
- **Repeated alternatives template.** amex [46]-[49] all follow "<Rival> credit cards. ...alternatives...".
- **Brand named twice.** amex [42] uses both "American Express" and "Amex".
- **Fee repetition, accepted.** Annual fee remains the dominant pricing axis on AmEx. This is acceptable per the ruling.

**Held across all three batteries:**
- Seed hygiene:
  - No calendar years, label leaks, segment vocabulary, quote wraps or meta text.
  - No brand names in blind cells.
- Comparisons: all neutral, all with a pick ask; class cells are clean.
- Doubt seeds:
  - Objections are voiced pre-purchase, each with its assigned concern.
  - No money asks or "cheaper" add-ons on non-price concerns.
- Churn and renewal: stay-or-go stated, brand named once in Jira.
- Alternatives:
  - Offensive alternatives are bare, with a category anchor (Pixel N4 fixed).
  - Defensive alternatives are existing customers.
- Platform switcher: every switcher seed states iOS to Android.
- Pricing: every pricing seed carries usage.
- Awareness seeds end with a way-forward ask.

---

## 4. Verdict

| Battery | Verdict | What remains |
| --- | --- | --- |
| **AmEx** | **READY** | Both s23 findings fixed. S4 only. |
| **Jira** | **READY after 1 gate edit** | [37] - move off monthly vs annual (F2). |
| **Pixel** | **READY after 3 gate edits** | [38] - restore the Pixel tier question and move [40] off carrier vs unlocked (F1); [26] - ask for named phones (F3); [5] - return to a "what does it do" ask (F4). |

There are no S1 or S2 findings. All four S3s are unflagged, so the reviewer needs this list. All are hand edits that do not need another engine iteration. Make them before the first wave; a seed edited after wave 1 breaks its own trend line.

**Mechanical gaps, for the next tracker:**
- An evicted cell's re-roll must re-enter the battery-level pricing diversity pass. Here it silently removed Pixel's only brand-named pricing cell.
- The trade-off shape labeler treats two monthly-vs-annual billing cells as different shapes (Jira [37] and [38]). Label the trade-off by its two options, not by its wording.
