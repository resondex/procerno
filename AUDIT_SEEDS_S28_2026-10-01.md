# Seed audit, final verdict (s28) - Jira, American Express, Google Pixel (2026-10-01)

**Scope:** all 165 seeds as regenerated under s28. `seedFlags` is null everywhere. Every angle field is a valid value. No seed is longer than 53 words.

**Bar:** the same adversarial bar as the first audit.

**Severity:** **S1** ship-blocker / **S2** high (fix before collection) / **S3** medium (fix at the gate) / **S4** low.

---

## 1. s27 findings

| Item | Verdict | Evidence |
| --- | --- | --- |
| F1 - pixel [4] switch with no direction | **FIXED** | "Moving from iOS to Android. I'm worried about my photos, message history, and a few paid apps not carrying over..." |
| F2 - pixel [5] overloaded seed with a template ending | **FIXED** | "What does a modern smartphone actually do beyond calls and texts? How do people use one day to day, and what are the big parts that matter?" No category_education seed contains "what fixes this". |
| F3 - all four AmEx pricing cells ask about the fee level | **FIXED** | [39] is a different structure: "0 percent intro APR card or a higher-earning card with an annual fee". [41] is the brand's own tier question: "Blue Cash Preferred (annual fee) and Blue Cash Everyday (no fee)". Only two generic price-level cells remain, [38] (business) and [40] (premium travel), and their circumstances differ. That is acceptable under the s23 ruling. S4 note: three of the four cells still involve choosing a fee level. |
| F4 - malformed angle on amex [33]-[37] | **FIXED** | All five now read `generic`. Every angle in all three batteries is generic, defensive, class or a roster rival. |

---

## 2. S3+ findings

**F1 [S2] pixel [25] (Platform switcher, use_case, open choice): the switch now runs the other way, toward the rival's platform.**
"Switching from **Android to iOS**. I shoot a lot of 4K video, want great battery life, and I keep two numbers on one phone. **Which phones on iOS** would you actually recommend? Any gotchas moving my texts and eSIM over?"
- **Pixel is shut out by construction.** The only phones that run iOS are iPhones. This open-choice cell can only produce iPhone picks, so it feeds the headline open-choice pool with a guaranteed zero for Pixel.
- **The scenario contradicts itself.** The other six Platform-switcher seeds go iOS to Android. One cell measuring the opposite population makes the scenario's per-cell reads incomparable.
- **The checks miss it.** The direction check only asks whether *a* direction is stated. "iOS" is not a roster brand form, so nothing flagged the rival's platform being named.
- **Gate fix:** "Switching from iOS to Android. I shoot a lot of 4K video, want great battery life, and I keep two numbers on one phone. Which Android phones would you actually recommend? Any gotchas moving my texts and eSIM over?"
- **Mechanical fix for the next tracker:** a switcher scenario's direction must be the same in every cell and point toward the side the client competes on.

**F2 [S3] amex [3] (Premium travel card, problem_recognition): the circumstance is inverted.**
"**I'm paying a big annual fee for travel perks I barely use**, lounges are slammed, and flight delays still cost me. What actually makes frequent trips smoother **and worth the fee**?"
The scenario is a buyer moving up to a premium travel card. This asker already holds one and doubts it is worth the fee. That is the "Annual fee feels high" worry (objection [37], renewal [50]) appearing in a blind awareness cell. Its answers will lean toward "downgrade or drop the fee card", not toward the premium card the scenario measures. The fee story also gains one more cell.
- **Fix:** "I'm flying a lot more now and keep paying out of pocket for bags, Wi-Fi and lounge passes, and delays still burn me. How do frequent travelers set themselves up so trips cost less and go smoother?"

No S1. One S2 (F1).

---

## 3. S4 (polish; does not block)

**Pricing duplicates, both acceptable under the s23 ruling:**
- pixel [37] and [38] both weigh a carrier deal against buying unlocked. Their circumstances differ (trade-in vs midrange).
- jira [37] and [38] both involve paying for some seats vs all of them.

**Thin or weak circumstance:**
- pixel [20] "it's for my first phone" gives no age (the s20 flag shape).
- jira [11] "a scaling engineering org" gives no size.

**Overloaded asks:**
- jira [25] lists four requirements ("raise incidents and service requests, link to bugs, track SLAs, run change approvals").
- jira [34] is two questions, one of them a lookup ("How stable is the roadmap").

**Templated wording:**
- amex [46]-[48] repeat "<Rival> credit cards. ...alternatives".
- All four jira business_case seeds pitch the CFO.

**Second ask on a discovery seed:** pixel [6] and [9] each add a criteria-style question ("what should I look for in the fine print?", "anything I should watch out for").

**Leftover framing:** pixel [26] keeps "feel premium in hand".

**Held:**
- no calendar years, label or segment leaks, quote wraps, meta text or malformed fields;
- no brand names in blind cells;
- all 14 comparisons are neutral and ask for a pick, and the class cells are clean;
- objections are voiced pre-purchase with their assigned concern;
- churn and renewal state the stay-or-go choice, with no money asks and no "cheaper" bolt-ons on non-price concerns;
- offensive alternatives carry no reasons and keep a category anchor;
- defensive alternatives are existing customers;
- every pricing seed carries usage, and each battery has a brand-named pricing cell (jira [36], amex [41], pixel [40]);
- awareness seeds end in a way-out ask, and category_education asks what the product does.

---

## 4. Verdict

| Battery | Verdict | Edits before collection |
| --- | --- | --- |
| **Jira** | **READY** | none (S4 only) |
| **AmEx** | **READY after 1 gate edit** | [3]: restore the up-market circumstance (F2, S3) |
| **Pixel** | **NOT READY - 1 blocker** | [25]: Android to iOS / "Which phones on iOS" - flip to iOS to Android and ask for Android phones (F1, S2) |

Both edits are one sentence and need no engine iteration. Neither is flagged, so the reviewer needs this list. With these two edits made, all three batteries are **READY**.

**Mechanical gap that let F1 through:** the switch check tests that a direction is present, not which direction. Pin the scenario's direction once, toward the client's side, and check every switcher cell against it.
