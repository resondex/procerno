# Seed audit, COLD roll (empty cache, s29/r10 engine) - Jira, American Express, Google Pixel (2026-10-02)

**Scope.** All 165 seeds from one roll per battery against an empty cache: `cold_seeds_jira.json` (59), `cold_seeds_american_express.json` (55), `cold_seeds_google_pixel.json` (51). These batteries are separate from the warm ones audited before.

**Bar and contracts.** I applied the full adversarial bar against the same contracts as the FINAL report: s29 writer rules, r10 mechanical checks, the s23 pricing-shape ruling, and flagged seeds counting as surfaced to the human.

**Mechanical facts.**
- One seed is flagged: amex [2].
- Every angle field is valid.
- No seed exceeds 53 words.
- No calendar years and no quote wraps.

**Severity.** **S1** ship-blocker / **S2** high / **S3** medium (fix at the gate) / **S4** low.

---

## Counts

| | Jira | AmEx | Pixel | Total |
| --- | --- | --- | --- | --- |
| Seeds | 59 | 55 | 51 | 165 |
| Flagged (gate chips) | 0 | 1 | 0 | 1 |
| S1 / S2 / S3 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | **0 / 0 / 0** |
| S4 | 2 | 4 | 2 | 8 |

Every contract class from all earlier rounds holds on the cold roll except one S4 regression (J9's class-cell category tail, below).

---

## 1. The flagged seed: amex [2] - checker strictness, not a defect

> "My everyday card is a headache: rotating categories, points posting late, random limits. I just want to pay for groceries and gas and not feel like I'm leaving money on the table. What do people switch to so day-to-day is simple and fair?"

**Flag:** `copies the scenario label "Replace everyday card"`. The colon-opener heuristic fired because "everyday", a word of five or more letters, appears in both the prefix and the label (1 of 2 qualifying words, which meets its half-threshold).

**Ruling: false positive.**
- "My everyday card is a headache:" is the asker describing their own situation, the shape the s14 writer rule asks for. It is not a topic header like "First card question:".
- The r3 exemption already established that a label naming the plain buyer phrase ("everyday card", "first credit card") is correct usage.
- The seed itself is a good problem_recognition seed. It describes the pain, the asker has not yet chosen the replacement, and it ends on a way-out ask.

**Gate action:** approve as written.

**Checker follow-up:** the colon-opener rule should not fire when the prefix is a sentence (it has a possessive or a verb, "My … is …"), or when the shared word is part of a category-naming label.

---

## 2. S3+ findings

**None.** No S1, S2 or S3 defect on the cold roll.

What I checked, all holding:
- **Scenario circumstance.**
  - Every scenario-pinned seed voices its circumstance in the asker's own words.
  - No meta openers, segment vocabulary or label echoes beyond the false positive above.
- **Blind stages.**
  - No brand names in blind seeds. Apple Pay and Google Pay in amex [21] are not on the AmEx roster.
  - Open-choice seeds invite named picks.
  - Awareness seeds end in a way-out ask.
  - category_education asks what the product does.
  - problem_recognition askers do not yet own the product.
- **Comparisons and doubt cells.**
  - All 14 comparisons are circumstance-neutral and ask for a pick.
  - Objections are pre-purchase and state their assigned concern as a confirm-or-rebut claim.
  - No eligibility lookups and no money asks.
  - Churn and renewal state the stay-or-go choice and name the brand.
  - No "cheaper" bolt-ons on non-price concerns.
- **Alternatives.**
  - Offensive seeds carry no reasons and no asker identity, keep a category anchor, and use varied voice.
  - Defensive seeds come from existing customers.
- **Switch direction.** Every Pixel Platform-switcher seed leaves the client eligible:
  - six state "iOS to Android";
  - [4] states the origin ("I'm on iOS... If I switch platforms"), so its direction is set.
- **Pricing.** Every pricing seed carries usage, every battery has a brand-named cell (jira [36], amex [41], pixel [40]), and the trade-off shapes are within the s23 ruling:

| Battery | Cells and trade-offs | Assessment |
| --- | --- | --- |
| Jira | [36] Premium vs Enterprise, [37] license everyone vs core seats plus viewers, [38] annual vs monthly, [39] bundled service desk tier vs separate ITSM | Four distinct shapes. |
| AmEx | [38] fee vs no-fee (business), [39] 0% intro APR vs 2% cash back, [40] premium vs mid-tier (travel), [41] Amex no-fee vs Gold (brand tier) | Two generic price-level cells with different circumstances, one brand tier and one financing structure. Same configuration accepted in s28. |
| Pixel | [37] carrier credits vs unlocked, [38] finance vs outright, [39] new budget vs used flagship, [40] A-series vs flagship (brand tier) | Four distinct shapes. |

---

## 3. S4 (polish; does not block)

- **amex [31], [32]: the J9 class-cell category tail has come back.** "American Express or a Visa card **for credit cards**" and "American Express or a Mastercard **for credit cards**". The writer rule names this exact phrase as forbidden.
  - Cosmetic only: the class phrase itself is correct, and the head-to-head is neutral.
  - The warm batteries passed this class only through cached cells, which is what this cold test exists to expose.
  - Hand-edit both to drop the tail. Mechanically, flag class cells whose seed adds "for <category>" after the class phrase.
- **amex [40]: unnamed brand tier.** "the top-tier premium travel card in the same family, or stick with the mid-tier one" is a brand tier question with the brand left out, so which "family" is meant is ambiguous. Acceptable as a generic price-level cell. Naming no family is cleaner than an unnamed one.
- **amex [45]: defensive seed with no stated move.** "I'm on American Express now. Name a few solid credit card alternatives to compare" never says the customer is weighing a move away. The intent is implied.
- **jira [26]: second ask pulls toward sources.** It adds "Point me to places with real user chatter too", which invites forum and review-site names alongside tool names.
- **pixel [4]: "If I switch platforms."** This uses the phrase banned in s18. The origin is stated, so the direction is still set.
- **Carry-overs:** pixel [26] status framing ("feel good to be seen with... fan energy"), and all four jira business_case seeds pitch the CFO or finance.

---

## 4. Bottom line

**READY for collection.** The cold roll has zero S1, S2 or S3 defects in all three batteries.

The only gate item is the amex [2] chip, which is checker strictness: approve it as written.

The optional S4 polish worth doing at the same sitting is to drop "for credit cards" from amex [31] and [32]. This is the one regression the cold roll exposed. It is a decided rule the warm batteries met only through cached cells.

The engine produces collection-ready batteries from an empty cache on a single honest roll.
