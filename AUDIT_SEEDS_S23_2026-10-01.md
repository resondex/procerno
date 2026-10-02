# Seed audit, last look (s23) - Jira, American Express, Google Pixel (2026-10-01)

**Scope.** All 165 seeds as regenerated under s23 (Jira 59, AmEx 55, Pixel 51). `seedFlags` is null on every seed. The longest seed is 54 words (amex [39]).

**Bar.** The same adversarial bar as the first audit, applied to every seed.

**Severity.**
- **S1** - ship-blocker.
- **S2** - high (fix before collection).
- **S3** - medium (fix at the gate).
- **S4** - low (polish).

---

## 1. The s22 blocking list - closed

| Item | Verdict | Evidence |
| --- | --- | --- |
| pixel [17], [21] - switch direction missing | **FIXED** | [17] "Switching from iOS to Android. What should I prioritize..." / [21] "Switching from iOS to Android. Which smartphones include an easy built in transfer tool...". All seven switcher seeds ([4], [9], [13], [17], [21], [25], [40]) state the direction. |
| pixel [20] - teen circumstance lost | **FIXED** | "getting my first phone soon. i'm 16. want a sharp selfie camera and real all-day battery..." |
| jira [29] - head-to-head with no pick | **FIXED** | "jira or trello as a project management tool, what would you choose and why?" |
| amex [29] - head-to-head with no pick | **FIXED** | "American Express vs Citi for credit cards: what's your pick and why?" All 14 comparison seeds now ask for a pick. |

---

## 2. Ruling: two fee-vs-no-fee cells with different circumstances

**Two cells would be acceptable (S4, not a defect).** Fee vs no-fee is the category's main price structure. A business program at around 40k a year and a first card at around $420 a month produce genuinely different economics, so the two answers measure different things.

**That is not the actual state of the battery, though.** The residual is understated in two ways, and together they make an S3:

1. **The fee trade-off appears three times, not two.** amex [39] (Replace everyday card) asks it too: "Is a no-annual-fee card smarter, or pay about 95 to 150 a year for richer rewards and some credits?"
   - [38]: "pay a 95 annual fee for better earn rates and perks, or stick with no annual fee?"
   - [41]: "Start with a no-fee card, or is a $95 annual-fee card with stronger cash back actually worth it"
   - The fourth cell, [40], is a fee ladder: "$550 annual fee... versus a $95 mid-tier card..., or stick with no-fee". All four AmEx pricing cells are therefore about the fee.
2. **No AmEx pricing cell names American Express.** All four are typed open_choice. This breaks the s20 rule that at least one pricing cell names the brand. It is a regression: s22's [40] was the Platinum within-brand cell. As a result, AmEx has no within-brand price read at all.

---

## 3. S3+ findings

**F1 [S3] AmEx pricing - one structure four times, and the brand is absent.** See the ruling above. Fix at the gate with two edits:
- Make [40] the brand tier question, for example: "For my travel pattern - 4 trips, ~8 lounge visits, $1,500 on flights and hotels - is the American Express Platinum worth the jump over the Gold?" That restores a within_brand cell.
- Move [39] off the fee to a different structure, for example flat 2% vs category card, as s22 had.

[38] and [41] can then stay as the two fee-vs-no-fee cells, per the ruling.

**F2 [S3] AmEx problem_recognition - all four seeds now end in a yes/no "is this common?" question.**
- [1] "...Is this a common problem?"
- [2] "...Is this a common problem?" (word for word the same as [1])
- [3] "...Is this something other frequent flyers deal with?"
- [4] "...Is this something I should be worried about?"

This is new in s23, and it appears only on AmEx; Jira and Pixel problem_recognition seeds still end in "how do people/teams handle this". The problem_recognition read is how often the AI names brands, plus how often it already points to products. A yes/no "is this common?" invites reassurance rather than a path to a product, so it depresses exactly that read across the whole stage. Two of the endings are also identical, which the sibling-variety rule forbids.

Fix: restore the solution-seeking endings ("How do people usually keep business spend separate?", and so on).

No S1 or S2.

---

## 4. S4 (polish; does not block)

- **Label echo.** pixel [10] opens "**Carrier trade-in upgrade** coming up." That is the scenario label restated as an opener. The substance follows in the next sentence ("My carrier is offering about $700 in bill credits"). Mechanical gap: `scenarioLabelLeak` does not normalize hyphens, so "trade-in" slips past the label "Carrier trade in upgrade".
- **Enterprise circumstance at mid-market size.** jira [14] (Enterprise standardization): "About 200 people now and hiring." That is the same size as the Mid-market cells ([19] 180, [41] 200).
- **Grafted circumstances.** pixel [40] attaches "Switching from iOS to Android" to a protection-plan vs self-insure question it has nothing to do with. pixel [39] is a budget-pinned spend-level question ("350 now, maybe 500... which way is the better value?") that duplicates [38]'s paying-up shape and leans toward discovery.
- **Thin circumstance.** jira [7] says only "a growing product engineering team".
- **Possible tilt.** pixel [25] adds "spam calls filtered without fuss" to a blind open-choice cell. This is a real buyer argument (a top v3 cluster), but it is also Pixel's home turf. Watch it rather than edit it.
- **Missing category word.** pixel [45] "Leaving Samsung Galaxy. Name a few solid alternatives to try." and [47] "Dropping OnePlus. Suggest a few alternatives..."
- **Near-duplicates.** amex [19] and [23] (2% flat cash back plus automatic statement credits).
- **Brand named twice.** All four jira churn seeds name the brand twice ("...Jira... move off Jira").
- **CFO in every case.** All four jira business_case seeds pitch the CFO.
- **Renewal never said.** jira [55] never mentions renewal.
- **Wording.** pixel [28]-[30] read "for a smartphone" and put the client first in all four. pixel [26] uses "compliments... the vibe" framing.
- **Defensive seed without the move.** amex [45] "We're on American Express now. Name a few credit card alternatives" states the relationship but not that the customer is weighing a move.

**Held across all three batteries:**
- no calendar years, segment vocabulary, quote wraps or meta text;
- no brand names in blind seeds;
- all comparisons are circumstance-neutral, and all ask for a pick;
- objections are pre-purchase and voice their assigned concern, with no money ask or "cheaper" add-on on non-price concerns;
- churn and renewal state the stay-or-go choice;
- offensive alternatives carry no reasons, and defensive alternatives are existing customers;
- class cells are clean;
- Jira and Pixel pricing each have four distinct trade-offs, including one within-brand cell.

---

## 5. Verdict

**Jira: READY.** S4 only.

**Pixel: READY.** S4 only.

**AmEx: READY after two gate edits.** No S1 or S2 remains anywhere. The two S3s are both in AmEx, both unflagged, and both cheap:
1. **Pricing:** make [40] the Platinum vs Gold tier question, and move [39] to flat vs category.
2. **problem_recognition [1]-[4]:** restore the solution-seeking endings in place of "is this common?".

Make these edits before the first wave, because a seed edited after wave 1 breaks its own trend line. No further engine iteration is needed.

One mechanical follow-up for the next tracker: normalize hyphens in `scenarioLabelLeak` (pixel [10]).
