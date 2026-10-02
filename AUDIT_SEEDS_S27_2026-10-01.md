# Seed audit, final verdict (s27) - Jira, American Express, Google Pixel (2026-10-01)

Scope: all 165 seeds as regenerated under s27. Every seed has `seedFlags` null, and every seed is 54 words or fewer.

The bar is the same as the first audit. Severity: **S1** ship-blocker / **S2** high / **S3** medium (fix at the gate) / **S4** low.

---

## 1. s24 findings

| Item | Verdict | Evidence |
| --- | --- | --- |
| F1 - Pixel pricing: no cell names the brand, and two carrier-vs-unlocked cells | **FIXED** | Two cells now name the brand: [37] "latest Google Pixel Pro at $28 a month... or $400 off the regular Pixel at $18 a month" and [38] "pay up for the latest flagship Pixel or save with the latest Pixel a-series". The carrier-vs-unlocked duplicate is gone. [39] is now outright vs a $0 carrier promo; [40] is a storage tier plus financing. [37] and [38] are both brand-tier questions. That is acceptable under the s23 ruling: two instances of the category's main structure, with different circumstances (carrier-financed Pro vs regular; outright flagship vs a-series). |
| F2 - jira [37]/[38] repeat the same billing question | **FIXED** | The billing duplicate is gone. The cells are [36] generic tier upgrade, [37] Jira Standard vs Premium, [38] free first year vs paid from day one, and [39] free plus add-ons vs paid. That leaves two pairs, tier and free-vs-paid. Each pair is a main SaaS price structure, and its two cells sit in different scenarios. Acceptable under the ruling (S4 note). |
| F3 - pixel [26] does not invite named picks | **FIXED** | "Which smartphones have that brag factor right now...? Name a few you'd call out." |
| F4 - pixel [5] was a premium-tier question | **FIXED** on design: the seed now asks what smartphones do. It brings a new S3, though (F2 below). |

---

## 2. S3 findings

**F1 [S3] pixel [4]: the switch direction is missing again, and the new mechanical check let it through.**
The seed reads: "thinking about moving from **one phone platform to another**. my stuff's tied up in cloud backup and my messages app... what actually fixes this?"
The s23 string check catches "from one platform to another". It does not catch the same phrase with a word inserted ("one *phone* platform"). This is a problem_recognition (awareness) cell, so the brands the answer names depend on the direction the engine guesses.
- **Fix at the gate:** "thinking about moving from iOS to Android."
- **Fix in the check:** match the pattern with gaps allowed ("from one … to another" / "between … platforms"), not the exact phrase.

**F2 [S3] pixel [5] (category_education): five questions, ending in a template that doesn't fit.**
The seed reads: "i've stuck with a basic phone forever. what do smartphones really do beyond calls, are they a camera, wallet, map, computer? i'm lost on how people use them without getting sucked in or spending a ton. **what actually fixes this?** how do folks set one up to cover the essentials?"
The new rule that awareness seeds end by asking for a way out added "what actually fixes this?" to a cell with nothing to fix. The same phrase is now stamped across Pixel's awareness seeds: [2] "what actually fixes this without overpaying?", [3] "...what actually fixes it for a first-timer?", and [4]. The seed also asks five things, which is the J18 overload class again.
- **Fix:** "I've had a basic phone forever. What do smartphones really do day to day beyond calls and texts, and how do people actually use them?"

**F3 [S3] AmEx pricing: all four cells ask the same question again, which annual fee to pay.**
- [38] "Pay up for a premium travel business card, stick with a mid-tier one, or just use a no-fee cash back card?"
- [39] "keep a no-fee 2% cash back card, or move to something with a $95 to $150 annual fee"
- [40] "flagship travel card with lounge access or the mid-tier travel card?"
- [41] "no fee Amex like Blue Cash Everyday, or pay for the Gold" (the brand-named cell)

s24's [41] was a different structure (0% intro APR vs rewards). The s27 regeneration lost it, so AmEx is back to one structure in four cells. The s23 ruling allows two cells of the main structure, not four. The labeler apparently treats premium vs mid-tier, a three-way fee ladder and fee vs no-fee as different option pairs, but all four answer the same question.
- **Fix:** move [38] or [40] to a different structure, such as 0% intro APR vs rewards, or a balance-transfer card vs a rewards card.

**F4 [S3] amex [33]-[37]: the stored `angle` field is malformed.** This is a data defect, not a problem with the seed text.
All five objection cells carry `angle: "generic concern(Spotty merchant acceptance)"` and so on, instead of `"generic"`. The writer echoed its own plan line (`angle=generic concern(X)`) into the angle output. No other cell in the three batteries is malformed.
- **Still correct:** brand checks, because `brandModeOf` sends objections to must_name regardless of angle; `qtype` (doubt); and `concern`.
- **Wrong, and it ships with the cell:** the angle reaches `intents.angle`, the cache keys and the paraphrase plan lines.
- **Fix:** normalize these five to `"generic"` at the gate.
- **Mechanically:** validate `angle` against its vocabulary (generic, defensive, class, or a roster rival) when parsing writer output.

No S1 or S2.

---

## 3. S4 (polish; does not block)

- **"what actually fixes this" is stamped across awareness seeds** (pixel [2], [3], [4]; jira [2]). The new intent produced a stock phrase.
- **Invariant category_education cells now carry a scenario persona.** amex [5] ("I've only used debit and my credit file is thin...") nearly duplicates amex [4] (First credit card). jira [5] and pixel [5] also open with a backstory.
- **Contradiction:** amex [10] "employee cards... for a **solo owner**".
- **pixel [38] (Midrange value pick)** states no budget and offers a flagship option, so the midrange circumstance is weak. It also mixes in a trade-in and financing.
- **pixel [40]** grafts "Moving from iOS to Android" onto a storage-and-financing question.
- **Defensive alternatives without a stated move:** jira [48] "We use Jira today. Name a few... alternatives" has no move stated, and pixel [43] "If I bail on Google Pixel" is hypothetical.
- **CFO in every business case:** all four jira business_case seeds pitch the CFO.
- **Look-and-brag framing:** pixel [26] "brag factor" keeps it.

**Held:**
- no calendar years, label or segment leaks, quote wraps or meta text;
- no brand names in blind cells;
- all comparisons are neutral and ask for a pick, and the class cells are clean;
- objections are pre-purchase and voice their assigned concerns;
- churn and renewal state stay-or-go with no money asks or "cheaper" add-ons on non-price concerns;
- offensive alternatives carry no reasons and have a category anchor;
- every Pixel switcher seed except [4] says iOS to Android;
- every pricing seed carries usage, and every battery has a brand-named pricing cell.

---

## 4. Verdict

| Battery | Verdict | Gate edits |
| --- | --- | --- |
| **Jira** | **READY** | none (S4 only) |
| **AmEx** | **READY after 2 gate edits** | Move [38] or [40] off the fee level (F3). Normalize angle to `"generic"` on [33]-[37] (F4). |
| **Pixel** | **READY after 2 gate edits** | [4]: "from iOS to Android" (F1). [5]: rewrite to a simple "what does it do" ask (F2). |

No S1 or S2 findings remain. None of the four S3s is flagged, so the reviewer needs this list. All four are hand edits; another engine iteration is not needed.

Two mechanical gaps to close for the next tracker:
- The directionless-switch check must allow inserted words.
- Writer output needs an `angle` vocabulary validator.

The stock "what actually fixes this" ending and the drift of category_education into a near-copy of problem_recognition are worth a look at the new awareness intent before the next tracker, but they don't block this one.
