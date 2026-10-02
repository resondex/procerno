# Seed audit, verdict pass (s19 / rules r4) - Jira, American Express, Google Pixel (2026-10-01)

**Scope.** The seed of every cell in the batteries regenerated after commits 360c086 (s18/r4) and a576e0f (s19): Jira 59, AmEx 55, Pixel 51, so 165 seeds. Paraphrases are excluded.

**Rules applied.** I judged against the current contracts:
- Switches state their direction.
- Eligibility lookups are rejected by quoted example.
- Financing figures are prices, so usage must be present too.
- Pricing trade-offs vary across a battery's cells.
- A budget circumstance makes the pricing cell the brand's tier question.
- Offensive alternatives are bare moves anchored only by the category word.
- Stay-or-go endings vary and name the brand once.
- Requirement lists of 4 or more items are a defect.

**Mechanical checks.**
- `seedFlags` is null on all 165 seeds.
- No calendar years.
- The longest seed is 49 words (pixel [37]).

**Severity.** S1 ship-blocker / S2 high (fix before collection) / S3 medium (fix at the gate) / S4 low (polish).

---

## Counts

| Prior class | Verdict | Where |
| --- | --- | --- |
| M1 - label opener / lost circumstance | **FIXED** (S4 watch: fragment openers) | - |
| J2 - pricing "worth it?" with no usage | **FIXED** | - |
| J5 - objection as an eligibility/rules lookup | **RECURS** (S3) - third consecutive failure on this cell | amex [34] |
| J6 - worry cell asks for cost accounting | **FIXED** | - |
| J9 seed | **FIXED** | - |
| J10 - steering in offensive alternatives | **FIXED** | - |
| J11 - defensive voiced as a prospect | **FIXED** | - |
| J12 - segment vocabulary | **FIXED** (S4 note on jira [10]) | - |
| J18 - overloaded seed / 4+ requirement list | **RECURS**, one cell (S4) | jira [6] |
| J19 - two readings (switch direction) | **FIXED** (S4 over-correction, Q4) | - |
| J23 - pre-category seed ends in a criteria ask | **FIXED** | - |

| My s14 / s17 findings | Verdict |
| --- | --- |
| N1, N2, N3, N5, N7, N8, N9, N10 | **FIXED** |
| N4 alternatives residue | "Apple iPhone" fixed. **RECURS** (S4): pixel [45], [47] have no category word |
| N6 generic pricing typed open_choice | Not a seed defect. Now 4 of 4 on Pixel (see Q3) |
| N11 CFO template | **RECURS** (S4): wording varies, but all four jira business_case seeds still pitch the CFO |
| N12 presupposing "how much/how big" | Pixel [33] fixed. **RECURS** (S4): jira [32], pixel [31] |
| N13 grafted circumstance | **RECURS** (S4), same cell: pixel [22] |
| P1 "charge card" in a blind cell | **FIXED** |
| P2 AmEx pricing all fee-vs-no-fee | **RECURS** (S3) |
| P3 templated stay-or-go / doubled brand | **FIXED** |
| P4 bank rivals with no category | **FIXED** |
| P5 near-duplicate siblings | **RECURS** (S4): amex [8]/[12]; new jira [7]/[11] |
| P6 multi-question doubt | **RECURS** (S4): jira [34] |
| P7 hypothetical advocacy | **FIXED** |

| New this pass | Count | IDs |
| --- | --- | --- |
| S1 | 0 | - |
| S2 | 0 | - |
| S3 | 3 | Q1, Q2, Q3 |
| S4 | 3 | Q4, Q5, Q6 |

| Everything still open | S1 | S2 | S3 | S4 |
| --- | --- | --- | --- | --- |
| Total | **0** | **0** | **5** (J5, P2, Q1, Q2, Q3) | **11** |

---

## 1. Prior classes

**M1 - FIXED.** Every scenario-pinned seed carries its circumstance in substance, and none opens with a meta header.

Watch only (S4):
- Fragment openers that restate the label: pixel [14] "Carrier trade-in time.", [15] "Shopping midrange.", [22] "Trade-in deal is good." They read as plausible colloquial speech, but they sit closer to the label than any other seeds.
- jira Mid-market [7] and [11] carry the circumstance only as "a growing dev team" / "a growing software team", with no size.

**J2 - FIXED.** Both s17 offenders are now real trade-offs with usage:
- pixel [37]: carrier credits vs buying unlocked and selling the old phone, with "I keep phones 3 years".
- pixel [39]: new midrange vs refurbished flagship, with "128 GB minimum, want to keep it 2 years".

Every pricing seed carries a usage or size input.

**J5 - RECURS (S3): amex [34] (concern "Welcome bonus confusion").**
"American Express welcome bonuses confuse me: lifetime language, pop ups, different links. I don't want to miss the bonus. **How does it really work?**"
- The s17 version was a quoted lookup ("am I likely to be ineligible?"). The new version is a how-it-works explainer, which the same intent also rejects ("A neutral lookup... how-to... does not satisfy the design"). It nevertheless passed, unflagged.
- This cell has now failed in three regenerations, in three wordings. The concern itself is lookup-shaped: confusion about rules has no claim for an answer to confirm or rebut.
- Fix: replace the concern from the worry pool at the gate, or hand-write a claim ("Amex bonus rules feel built to trip people up - is the welcome offer actually gettable, or mostly fine print?"). Another rule iteration is unlikely to close it.

**J6 - FIXED.** No doubt seed asks for a figure or the money accounting. jira [54] is now "Would you renew, or start moving away?"

**J9 - FIXED.** amex [31] "American Express or a Visa card - which would you pick and why?" and [32] "As a card to carry, would you go with American Express or a Mastercard? What would sway you?" Framing varies between the two, but neither tilts.

**J10 - FIXED.** All 13 offensive seeds are bare moves with no reason and no asker identity:
- jira [49]-[52]: "Leaving Asana." / "Done with monday.com" / "Moving off Trello." / "Quitting ClickUp."
- amex [46]-[49]: "Done with Chase." / "leaving Capital One." / "Citi has been my main card, but I want to move." / "Dropping Discover."
- pixel [44]-[47]: "Done with my iPhone." / "Leaving Samsung Galaxy." / "Switching away from Xiaomi." / "Not staying on OnePlus."

Voices vary within each battery and nothing steers. The bareness is not flagged, per the brief.

**J11 - FIXED.** jira [48] "We're on Jira now but weighing a change.", amex [45] "Thinking about leaving American Express.", pixel [43] "Thinking about leaving Google Pixel."

**J12 - FIXED.** "Standardization" as a noun is gone.

S4 note on jira [10]: it states the circumstance twice in 48 words ("we're unifying on one project management tool... making one tool the company standard... company-wide scale"). Trim it to one statement.

**J18 - RECURS, one cell (S4): jira [6].** This discovery seed has four requirements: "standardize workflows across teams and roll up reporting? needs solid SSO and deep git integration".

The three s17 offenders are fixed:
- jira [25] has 3 items.
- amex [19] "strong grocery rewards and cellphone protection".
- pixel [20] "great selfie camera, solid night mode, and come in fun colors".

Criteria cells that list examples (pixel [15] "screen, chip, cameras, updates") are acceptable.

**J19 - FIXED.** All seven Platform-switcher seeds give the direction "from iOS to Android". [4] grounds it in real friction ("group texts with Android friends are a mess"). The over-correction is Q4.

**J23 - FIXED.** pixel [2] ends "do I patch this again with a repair, or is it smarter to replace at that budget?" and pixel [3] ends "Where do I even start?"

---

## 2. Residuals from earlier findings (S4 unless stated)

- **N4.** "Apple iPhone" is fixed (pixel [44] "Done with my iPhone"). Two seeds still lack the category word that the contract makes the only anchor: pixel [45] "Leaving Samsung Galaxy. Name a few solid alternatives to try." and pixel [47] "Not staying on OnePlus. Point me to a few strong alternatives." Both brands also sell tablets, watches and earbuds.
- **N11.** The wording now varies ("Help me make the case to our CFO", "I need to justify Jira to our CFO", "How do I sell Jira to our CFO", "Help me make the CFO case"). But all four jira business_case seeds still pitch the same audience, and [42] gives a post-seed startup a CFO. Vary the audience (VP Eng, the founders, IT leadership).
- **N12.** Two seeds presume the answer's magnitude:
  - jira [32] "How limited is it out of the box" presumes it is limited.
  - pixel [31] "How big a headache is that?" presumes a headache.

  Each seed's other clause still allows a rebuttal, so the effect is light.
- **N13.** pixel [22] "Trade-in deal is good. I shoot a lot of kids' sports from the sidelines..." is the same cell grafted again in a new wording. The carrier deal has nothing to do with the autofocus/zoom ask.
- **P5.**
  - amex [8] and [12] are both frequent work travelers wanting "lounge access" plus "transfer partners", and [24] repeats both.
  - New: jira [7] "a growing dev team that needs solid sprint planning, kanban, and easy backlog management" and [11] "a growing software team: 3 or 4 project management tools that do sprints well and have strong backlog management" are the same ask.
- **P6.** jira [34] is still three questions, one of them a lookup: "are we basically locked in? How realistic is it to migrate projects and history later, and does the roadmap look stable?"

**P2 [S3] - AmEx pricing still asks one trade-off four times.** This breaks the new "never four cells" rule:
- [38] "Start with a no annual fee card or pay around 95 to 150 a year for richer rewards?"
- [39] "Should I stick to a no annual fee Amex or pay around 250 for one with perks?"
- [40] "does the fee usually beat a no-fee travel card?"
- [41] "Start with a no-annual-fee card, or is a low-fee rewards card worth it?"

The fee story also runs through [20], [37] and [50]. Fix at the gate: reframe two cells, for example:
- [40] as a within-brand tier question (Gold vs Platinum for this travel profile).
- [41] as secured-with-deposit vs unsecured starter.

---

## 3. New findings (ranked)

### S3

**Q1 [S3] jira [24] - the seed is wrapped in literal quotation marks.**
`"Remote team of 6 shipping weekly. We need simple Kanban, a one-page roadmap, and easy Git integration without a weekend of setup. Which project management tools should we start with?"`
This is a generator artifact, and it would go to every engine verbatim. Neither the meta-text check nor the mechanical rules catch a quote-wrapped seed. Fix: strip the quotes. Mechanically, flag any seed whose first and last characters are quote marks.

**Q2 [S3] amex [37] (objections, "Annual fee feels high") - the pre-purchase objection speaks as an existing cardholder.**
"American Express annual fees feel high. If I barely use lounges, is there enough value to keep paying, **or should I drop the card?**"
Objections are the pre-purchase stance; keep-paying-or-drop is the renewal verdict. The same concern already has its in-relationship cell, renewal [50] ("Should I downgrade or cancel, or keep it for another year?"). The two stances now measure the same thing, and the pre-purchase doubt about the fee goes unmeasured. All other objection seeds in the three batteries are voiced pre-purchase. Fix: "...is there enough value to justify signing up, or are the perks too niche for someone like me?"

**Q3 [S3] Pixel pricing - the brand is missing from all four cells, against the s19 budget rule.**
- [37]-[40] are all generic and typed open_choice; none names Google Pixel. In s17 all four named it, so the battery has flipped from 4/0 to 0/4.
- s19's writer rule says "a budget circumstance makes the pricing cell the BRAND's tier question". Yet [38] (Midrange value pick, "$350-ish phone or spend about $450?") and [39] (Teen, "Budget around 300") are budget-pinned and generic.
- Consequences:
  - Pixel has no within-brand price read (A-series vs the regular Pixel).
  - Four structure questions that invite no named pick pool into the open-choice headline (the N6 typing question, now at full strength).
- Fix: make [38] the brand tier question ("Pixel's cheaper A-series around 450, or pay up for the regular Pixel? I keep phones 4 years, lots of photos..."). Keep [37], [39] and [40] generic: three distinct structures (carrier vs unlocked, new vs refurbished, finance vs outright plus storage), which is good variety.

### S4

- **Q4 The switch direction became a stamped opener.** Five of seven Platform-switcher seeds open with the same sentence, "Switching from iOS to Android.": pixel [9], [13], [17], [25], [40]; [21] is "i'm moving from iOS to Android." The direction is right, but it reads machine-stamped. Vary it the way [4] does ("On iOS now, but..."), e.g. "Done with my iPhone after six years, going Android - ...". Do not name the rival in blind cells.
- **Q5 All four Pixel comparisons read "Google Pixel or X as a smartphone".** pixel [27]-[30] add the category clause to names that need none ("Google Pixel or iPhone as a smartphone"), and the client is listed first in all four (s17 varied the order). The contract allows the clause to drop for unambiguous product names, and here it should.
- **Q6 pixel [26] (social_validation) primes for hype.** "Which phones have that fan-love right now, with active communities, creators hyping them, cool cases everywhere? Name a few that people are proud to carry." "Creators hyping them" invites influencer-marketed answers, and "proud to carry" repeats the identity register of the old N13 wording. Prefer reviews and owner satisfaction.

---

## 4. Checker gaps behind the open S3s

- **J5.** The design check passed a how-it-works question on a doubt cell for the third time. Either the judge is not applying the "neutral lookup / how-to" clause, or the concern text ("Welcome bonus confusion") gives it cover. Treat lookup-shaped concerns at the worries gate: a concern with no claim to confirm or rebut should not be selectable.
- **Q1.** No check for a quote-wrapped seed.
- **Q2.** No stance check that objection seeds are pre-purchase and churn/renewal seeds are in-relationship.
- **P2 / Q3.** "Vary the trade-off" and "budget means brand tier" are writer-only rules with no checker net. Both were missed on their first run. Cheap battery-level checks would close them:
  - Flag when every pricing cell in a battery shares one qtype.
  - Flag when every pricing cell names the same structure.

---

## 5. Bottom line

**No ship-blockers: S1 0, S2 0.** The structural classes from all three earlier audits are closed: switch direction, churn exits, money in worries, alternatives steering, label leaks and overloaded pricing.

**Not a clean yes, though.** Five S3 seed edits remain. They should be made at the gate before the first wave, because a seed edited after wave 1 breaks its own trend line:

| Battery | Edit | Finding |
| --- | --- | --- |
| Jira | [24] strip the quotation marks | Q1 |
| AmEx | [34] replace the lookup-shaped "Welcome bonus confusion" concern, or hand-write a claim | J5 |
| AmEx | [37] re-voice as pre-purchase | Q2 |
| AmEx | reframe two of [38]-[41] off fee-vs-no-fee | P2 |
| Pixel | [38] becomes the Pixel tier question | Q3 |

After those edits all three batteries are collection-ready. The eleven S4s are optional polish.
