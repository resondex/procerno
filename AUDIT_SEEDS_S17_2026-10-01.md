# Seed audit, final pass (s17 / rules r3) - Jira, American Express, Google Pixel (2026-10-01)

Scope: the seed of every cell in the regenerated batteries (Jira 59, AmEx 55, Pixel 51 = 165 seeds). Paraphrases are excluded.

I judged against the CURRENT contracts (commits 763fc43, f1aa984, 3ee3ba1):
- Seeds that name their category ("this would be my first credit card") are exempt from the label rule.
- Pricing is a price TRADE-OFF with usage as input. Pixel's within_brand and financing cells are by design.
- Churn and renewal state the stay-or-leave choice outright.
- Switch direction is given in OS words.
- Sibling cells vary their framing.

`seedFlags` is null on all 165 seeds. The longest seed is 53 words (jira [1], amex [1], amex [40]).

Severity: **S1** ship-blocker / **S2** high (biases a measurement - fix before collection) / **S3** medium (fix at the gate - cheap) / **S4** low (polish).

---

## Counts

| Prior class | Verdict | Where |
| --- | --- | --- |
| M1 - label opener / lost circumstance | **FIXED** | - |
| J2 - pricing as "worth it?" with no usage | **RECURS** (S3) | pixel [37], [39] |
| J5 - objection as an eligibility/rules lookup | **RECURS** (S3) | amex [34] |
| J6 - worry cell asks for cost accounting | **FIXED** | - |
| J9 seed - class phrase / category tail | **FIXED** | - |
| J10 - leave-reasons in offensive alternatives | **FIXED** | - |
| J11 - defensive voiced as a prospect | **FIXED** | - |
| J12 - segment vocabulary | **RECURS** (S4) | jira [10] |
| J18 - overloaded seed | Pricing overload **FIXED**. 5-part requirement lists **RECUR** (S3) | jira [25], amex [19], pixel [20] |
| J19 - two readings | **RECURS** (S2) | pixel Platform switcher [4], [13], [17], [21], [25] |
| J23 - pre-category seed ends in a criteria ask | **FIXED** | - |

| My s14 findings | Verdict | Where |
| --- | --- | --- |
| N1 churn with no leave option | **FIXED** | - |
| N2 calendar year | **FIXED** | - |
| N3 "cheaper" bolt-ons | **FIXED** | - |
| N4 templated alternatives | Template **FIXED**. Residual **RECURS** (S4) | pixel [44], [45], [47] |
| N5 number-stuffed pricing | **RECURS**, one cell (S4) | amex [40] |
| N6 generic pricing typed open_choice | Seed side settled by the s17 contract. The typing question stays open (dashboard, not seed) | - |
| N7 comparison grammar | **FIXED** | - |
| N8 "just" in a class cell | **FIXED** | - |
| N9 contradictory usage | **FIXED** | - |
| N10 weak keep-or-leave | **FIXED** | - |
| N11 planning vocabulary / CFO template | "value math" **FIXED**. CFO template **RECURS** (S4) | jira [40]-[43] |
| N12 "how far behind" presupposition | **FIXED** | - |
| N13 single-seed reads | **FIXED** | - |

New findings this pass:

| Severity | Count | IDs |
| --- | --- | --- |
| S1 | 0 | - |
| S2 | 0 | - |
| S3 | 2 | P1, P2 |
| S4 | 5 | P3-P7 |

Totals across everything still open: **S1 0 / S2 1 (J19) / S3 6 (J2, J5, J18, P1, P2, plus one checker gap behind J5) / S4 9**.

---

## 1. Prior classes

**M1 - FIXED.**
- No meta openers.
- The natural-label exemption works as intended: amex [13] "no credit history yet. this would be my first credit card.", amex [21] "This would be my first credit card.", amex [41] "this would be my first card."
- Both Mid-market cells flagged last time now voice their circumstance:
  - jira [19] "we're about 180 people and hiring fast. engineering has 10 squads."
  - jira [23] "Growing from 4 squads to 8."
- All other scenario-pinned seeds carry their circumstance too.

**J2 - RECURS (S3): pixel [37], [39].** The new contract allows trade-in and financing trade-offs, but still with usage as input. Neither seed gives any usage, and both end in the bare verdict:
- [37] "Carrier is offering $400 trade-in for my old phone, $100 down, then about $35 a month for 24 months. Is a Google Pixel a good value on that deal, or should I pick a cheaper model on the same terms?"
  - Also: "a cheaper model on the same terms" contradicts itself, since a cheaper model has different terms.
- [39] "first phone. i can do $150 upfront and about $25 a month on a 24 month plan. is a Google Pixel worth it for me, or should i start with something cheaper?"

[39] is very close to objection pixel [34], "Am I overpaying if I go Pixel, or is the experience worth the premium?", so the pricing view and the doubt view measure the same thing. That is the J2 failure.

Fix: add one usage clause ("I keep phones 3 years, shoot a lot of video"). Make [37] a real trade-off (carrier deal vs buying unlocked) rather than "or a cheaper model".

**J5 - RECURS (S3): amex [34] (concern "Welcome bonus confusion").** "The American Express welcome bonus rules confuse me. If I had an American Express years ago, am I likely to be ineligible for a new bonus?"
- The question is a pure eligibility lookup. The current intent names this case outright ("an eligibility or rules lookup does not voice a doubt even when the rules are unfavorable to the asker"), yet the seed shipped unflagged (gap C1).
- The premise verdict will come out n/a.

Fix: state the doubt as a claim the answer can confirm or rebut, e.g. "Amex bonus rules feel designed to trip people up - is the welcome offer actually gettable, or mostly fine print?". Or swap in another worry from the pool.

**J6 - FIXED.** jira [54] is now "Is it worth renewing Jira at this size, or is it time to move off Jira?". No doubt seed asks for a cost figure or method.

**J9 seed - FIXED.**
- amex [31] "American Express or a Visa card: which would you go with, and why?"
- amex [32] "American Express or a Mastercard: which would you pick, and why?"

**J10 - FIXED.** No offensive-alternatives seed gives a reason, for example jira [52] "Moving off ClickUp." and amex [49] "Not sticking with Discover anymore.".

**J11 - FIXED.** The relationship is stated as fact:
- jira [48] "We're on Jira now."
- amex [45] "We're on American Express now."
- pixel [43] "Thinking of moving off Google Pixel".

**J12 - RECURS (S4): jira [10].** "...to pilot for **company-wide engineering standardization** and exec rollups". This is the old enterprise-wide phrase with one word swapped, and the r3 term list misses it (C3). The same seed opens "a short shortlist". Fix: "...to pilot as the one tool every engineering team uses".

**J18 - pricing FIXED; requirement lists RECUR (S3).** Pricing seeds are now 29-53 words with 2-5 figures. The 60-word ceiling does not catch five-item requirement lists:
- jira [25] "intake portal, SLAs, on-call escalation, link problems to engineering tasks, plus clear reports"
- amex [19] "cell phone insurance, extended warranty and purchase protection, plus no foreign transaction fees, while keeping flat cash back"
- pixel [20] "great selfie cam with natural skin tones, smooth video for socials, battery that lasts a full school day and practice, not huge, and comes in fun colors"

In feature_screening and use_case cells, five must-haves also shrink the pool of products that qualify, so answers name fewer brands. Fix: cut each to 2-3.

Criteria cells that list five example dimensions are milder because the list is offered as examples (S4): jira [17], amex [15], and pixel [14], which has eight items including a parenthetical.

**J19 - RECURS (S2): pixel Platform switcher, 5 of 7 cells have no direction.**
- [4] "I'm moving from one platform to another."
- [13] "Switching from one platform to another. Shortlist 4 smartphones..."
- [17] "Moving from one mobile platform to another."
- [21] "Switching between mobile platforms."
- [25] "Moving between mobile platforms."

Only [9] "Leaving iOS for Android" and [40] "moving from iOS to Android" follow the new OS-direction rule. Those two read naturally, which shows the fix works when it is applied.

This is now a blocker for three reasons:
- Three of the five cells are open-choice ([13], [21], [25]). Which phones get named depends on the direction the engine guesses: iOS-to-Android users get Pixel and Galaxy, Android-to-iOS users get iPhones. The scenario's naming read mixes two populations.
- "from one platform to another" is a contortion no buyer types.
- The circumstance yardstick passes it, because it carries a switch without a direction (C2).

Fix: rewrite the five seeds with "from iOS to Android" or "off an iPhone onto Android". Pick one direction for the scenario: the one Pixel competes in.

**J23 - FIXED.** pixel [3] ends "where do I even start?". No pre-category seed ends in a criteria ask.

---

## 2. My s14 findings - residuals only

- **N4 (S4).** The template is gone; jira [49]-[52] and amex [46]-[49] are varied and natural. Pixel residue:
  - [44] "done with my **Apple iPhone**" uses the roster string, which no buyer says.
  - [45] "Leaving Samsung Galaxy - name a few solid alternatives" and [47] "I want to move off OnePlus. Recommend some alternatives." have no category anchor, and both brands also sell tablets, watches and earbuds.
- **N5 (S4).** amex [40] still carries five figures ("2 international and 4 domestic trips... $12k on flights and hotels, $2k dining, around 10 lounge visits") against the 2-3 cap. The figures are internally consistent now.
- **N6 (not a seed defect).** Generic pricing cells exist only where the category has a price structure (jira [38], amex [39]-[41], pixel [38], [40]), which is the s17 contract. They are typed open_choice but ask "which way" rather than for a named pick, so whether they belong in the open-choice headline pool is a per-type-views decision. Recorded so it isn't lost.
- **N11 (S4).** All four jira business_case seeds use the same frame: "Help me make the case to (our|my) CFO" ([40]-[43]). The new "siblings vary framing" rule did not reach this stage.

---

## 3. New findings (ranked)

### S3

**P1 [S3] amex [5] (category_education, blind) - "charge card" leads the answer to the client.**
"How is it different from a debit card or a charge card?"
The charge card is American Express's signature product type, so answers will tend to name Amex as the example. That inflates the client's brand-named rate on an awareness cell by construction. Fix: "...different from a debit card?"

**P2 [S3] AmEx pricing - all four cells ask the same trade-off.**
- [38] "a 300 annual fee worth it versus one of their no fee cards"
- [39] "no fee cash back card or pay for a premium one"
- [40] "Pay the fee or stick with a no fee card"
- [41] "no-annual-fee cash back card, or is a $95 annual fee card"

The scenarios vary, but the measured structure is the same in every cell, which goes against the "sibling cells vary framing" rule. It also adds to the annual-fee concentration (objection [37], renewal [50], criteria [16], advocacy [55]). Fix: reframe one or two cells onto a different AmEx price structure, e.g. premium travel as a Gold vs Platinum tier trade-off (within_brand), or the first card as a secured deposit vs an unsecured starter card.

### S4

- **P3 Stay-or-leave tails are now templated, with the brand doubled.** jira [53], [54], [55] all end "...or is it time to move off Jira?", with "Jira" twice in one sentence ("Is it worth renewing Jira at this size, or is it time to move off Jira?"). amex [43] has the same shape: "Can I make American Express spending power more predictable, or is it time to move on from American Express?". This is must-name pressure plus the new stay-or-leave rule; vary the tail and use a pronoun the second time.
- **P4 Rival-only comparisons with no category where the rival is a full bank.** amex [27] "American Express or Chase: which would you go with" and [29] "American Express vs Citi: which is the better pick" can be read as a bank-vs-bank question. Keep "for a credit card" there; [28] and [30] already do.
- **P5 Near-duplicate siblings.**
  - amex [8] and [12] are both work travelers wanting "lounge access and solid travel protections", with that phrase word for word in both.
  - amex [16] (criteria) and [40] (pricing) both ask whether "the big annual fee will actually pay for itself".
  - pixel [10] and [22] both open "My carrier's dangling...".
- **P6 Multi-question seeds that drift toward lookups.**
  - jira [34] "are we stuck later? How clear is the roadmap, and how hard is it to move off if we need to?" has three questions and never states the worry as a claim.
  - jira [5] has four asks, ending "what does good look like?", which is consultant-speak.
- **P7 pixel [51] (advocacy) leaves the relationship hypothetical.** "Friend keeps asking why I'd pick Google Pixel over other phones". Under the relationship-as-fact rule it should be "I've had my Pixel for two years...".

Checked and clean:
- No blind seed names a brand. "iOS" and "Android" appear only where the contract allows them.
- Every comparison seed is circumstance-neutral.
- Every doubt seed voices its assigned concern.
- Every churn and renewal seed states stay-or-leave, with no bolt-ons.
- The alternatives seeds vary without drifting off-design.
- Pricing seeds sit within the trade-off contract, apart from J2 and P2.

---

## 4. Checker gaps behind the residuals

- **C1** The design check passed amex [34], although the current doubt intent names "eligibility or rules lookup" explicitly. Re-run the check on that seed alone; if it still passes, the judge model is not applying the clause.
- **C2** The circumstance yardstick accepts a switch with no direction. For switcher-type scenarios, the design should require the from/to (pixel [4], [13], [17], [21], [25]).
- **C3** The segment-vocabulary list matches exact terms only. "company-wide engineering standardization" slips through. Add a stem match on `standardi[sz]ation` next to a scope word (company-wide / org-wide / enterprise).
- **C4** The pricing intent passed financing seeds with no usage (pixel [37], [39]). The "usage as input" clause is not being enforced on trade-in/financing cells.
- **C5** No check counts list items. The 60-word ceiling cannot catch a five-item must-have list that fits in 40 words.

---

## 5. Bottom line

**Not a clean yes.**

One finding blocks collection: the Pixel Platform switcher scenario (J19, S2). Five seeds still say "from one platform to another", so the scenario's open-choice naming read depends on which direction each engine guesses. Cells: pixel [4], [13], [17], [21], [25].

Seven S3 gate edits (eight seeds) should be made in the same pass before collection:
- amex [34] - eligibility lookup (J5)
- pixel [37], [39] - financing "worth it?" with no usage (J2)
- jira [25], amex [19], pixel [20] - five-item lists (J18)
- amex [5] - "charge card" lead (P1)
- one or two AmEx pricing cells reframed off fee-vs-no-fee (P2)

Battery by battery:
- **Jira** is collectible after one edit (jira [25]); everything else in it is S4.
- **AmEx** needs four edits: [34], [5], [19] and the pricing reframe.
- **Pixel** needs the five switcher cells plus [37], [39] and [20].

All S4s are optional polish.
