# Seed audit - cold walk of the four example brands (s29/r12 engine) - Jira, American Express, Netflix, Google Pixel (2026-10-02)

**Scope.** All 205 seeds from one cold walk per brand: `cold_seeds_<brand>.json` in the session's `cold_walk/` scratch folder. Each battery came from the full setup chain (profile -> roster -> market read -> worries -> recommended picks and coverage -> cells) run against an empty store, with defaults accepted everywhere. These are new batteries. They are not the ones audited earlier today, and the rosters differ from those runs.

| | Jira | American Express | Netflix | Google Pixel |
| --- | --- | --- | --- | --- |
| Category | project management software | credit cards | streaming video services | smartphones |
| Roster | ClickUp, Asana, Monday.com, Trello, GitHub Issues / Projects, Azure DevOps, Linear (all same-seat) | Visa, Mastercard (upstream, class cells "a Visa card" / "a Mastercard card"); Chase, Capital One, Discover, Citi, Bank of America (same-seat) | Disney+, Amazon Prime Video, Max, YouTube, Hulu, Apple TV+, Peacock (all same-seat) | Samsung Galaxy, Apple iPhone, OnePlus, Xiaomi, Motorola, Oppo (all same-seat) |
| Scenarios | Enterprise tool consolidation; Scaling agile programs; Legacy tracker migration; New squad spin-up | Frequent traveler perks; Airline loyalist co-brand; Small-business spend control; Dining and grocery optimizer | Families with kids; Solo viewer sign-up; Must-watch season return; Rotate to save | Carrier deal upgrade; Value midrange shopper; Flagship launch pre-order; Switching ecosystems |
| Worry picks | objections: process overhead, brittle integrations, exec reporting, risky migration; churn: slow under load, admin/permissions sprawl, slow support; renewal: nickel-and-dimed price | objections: not accepted everywhere, SMB tools lag; churn: lounge unreliable, rewards hard to realize, service slipping, declines/limits; renewal: annual fee high, surprise benefit changes | objections: titles vanish, shows canceled too soon, kids safety; churn: nothing new between hits, password sharing strict, ads tier wrong, 4K limits; renewal: price creeping up | objections: camera inconsistent, price high, privacy, hard to switch from iPhone, update skepticism, carrier/stock; churn: bugs after updates, battery, reception, service/repair |
| Kept stages | 19 (all) | 18 (no business_case) | 16 (no category_education, feature_screening, business_case) | 16 (no category_education, renewal, business_case) |
| Seeds / missing | 54 / 0 | 53 / 0 | 46 / 0 | 52 / 0 |

**Bar and contracts.** The same adversarial bar as every round, applied to the written contracts:
- `CELL_WRITER_SYSTEM` (s29).
- `stageDesignIntent` / `seedDesignLine`.
- `seedRule` (r12).
- The AGENTS.md decided boundaries.
- The s23 pricing-shape ruling.

A flagged seed counts as surfaced to the human, not as a silent defect. Severity: **S1** ship-blocker / **S2** biases a measurement / **S3** fix at the gate / **S4** polish.

**Mechanical facts (all four batteries).**
- No calendar years, em dashes, tildes, quote wraps, segment vocabulary, scenario-label leaks or 3+ question pile-ups.
- Longest seed is 55 words (pixel [39]).
- Every planned worry pick appears as exactly one cell that voices its concern (34 of 34).
- Class cells carry no "for credit cards" tail. r11 healed both during generation.

---

## Counts

| | Jira | AmEx | Netflix | Pixel | Total |
| --- | --- | --- | --- | --- | --- |
| Seeds | 54 | 53 | 46 | 52 | 205 |
| Flagged (gate chips) | 2 | 1 | 0 | 0 | 3 |
| S1 | 0 | 0 | 0 | 0 | 0 |
| S2 | 2 | 2 | 1 | 1 | 6 (4 findings) |
| S3 | 3 | 1 | 2 | 0 | 6 (plus 1 latent checker bug) |
| S4 | 5 | 3 | 5 | 6 | 19 |

The S2 count is per battery. F2 (the brand-token checker bug) is one engine finding that counts once for Jira and once for AmEx.

---

## 1. S2 findings (unflagged unless noted)

**F1 [S2] amex [35], pixel [37]: pricing seeds state the brand's prices, and r12 misses the bare-number form.** COUNTABLE.

> amex [35]: "American Express **Gold at 250 or Platinum at 695**? I take about 10 trips a year..."
>
> pixel [37]: "do I go **Google Pixel A-series around 450** or pay up for the **regular Pixel around 700**?"

- **Rule violated:** the pricing design intent (r12): "The question ASKS what things cost - it never states a product's price or fee".
- **The figures are already stale.** Gold went to 325 in 2024 and Platinum to 895 in 2025. The Pixel a-line and base line launch at 499 and 799. Every answer starts from a false premise, and the gap grows with every wave.
- **This is the warm-AmEx defect the Netflix audit found, reproduced number for number** ("Platinum at $695 ... Gold at $250"). The writer's world knowledge is frozen at those figures.
- **Why r12 missed both:**
  - Its `priceAssert` needs a verb ("is/costs/runs ...") or `at $<digit>`.
  - "Gold at 250" has no dollar sign.
  - "A-series around 450" has no verb.
- **Root cause:** `CELL_WRITER_SYSTEM` still models the defect. Its pricing example reads "the cheaper line **at 450**, or pay up for the regular one?". That example teaches the writer to put a price next to a tier name. The r12 writer fold-in was deferred to "the next natural STYLE bump", so the prompt and the checker disagree.
- **Proposed check:** flag `<Word> (at|around|about|roughly) $?<digits>` when the word directly before the preposition is capitalized or hyphenated (Gold, Platinum, A-series, Pixel), is not sentence-initial, and is not I/We/My. Keep r12's unit, deal and plan exclusions.
  - Grepped against all 205 seeds: 4 matches in exactly these 2 cells, 0 false positives.
  - Near misses it correctly passes: "smartphones around 400 to 600 bucks", "I can spend around 15 a month", "trade in for about 350", "Budget is about 400 to 500".
- **Writer fix:** change the example to "the cheaper a-line, or pay up for the regular one?". This is a writer-text change, so it needs STYLE_VERSION s30.
- **Gate fixes:**
  - amex [35]: "American Express Gold or Platinum? I take about 10 trips a year and spend around 7,000 on flights and hotels. With the lounge access, credits and points, does Platinum's bigger fee actually pay off for me, or is Gold the better value?"
  - pixel [37]: "Pixel a-series or pay up for the regular Pixel? I keep phones 3 years, mostly photos, maps, podcasts. Will the extra money actually buy me 3 years of smoother use?"

**F2 [S2, engine] The brand detector treats common words as brand names, and treats "Amex" as not naming American Express.** COUNTABLE. This surfaced as the jira [20] and amex [50] chips. It also drove **9 silent seed rewrites** in the logs, and it will filter every paraphrase in both batteries.

- **Forbidden side.** `brandForms` turns every token over 3 characters of a multi-word roster name into a brand form. The forbidden-brand matcher then applies those forms case-blind, except for the small AMBIGUOUS_FORMS list.
  - **Jira:** "GitHub Issues / Projects" makes **"issues"** and **"projects"** brand names. These are the two core nouns of the category, and "issues" is Jira's own object.
    - [20] ("import issues with full history") shipped flagged `blind stage names GitHub Issues / Projects`.
    - The writer could not regenerate around the word. The log shows "seed brand-rule regeneration still failing".
    - The original problem_resolution seed ("our scrum board shows no issues") was silently rewritten as `must_name_names_rival`.
  - **AmEx, latent:** "bank" (Bank of America), "chase", "discover", "capital" and "express" are all live brand forms. Probes confirm "we bank with a local credit union" -> Bank of America, "I chase points" -> Chase, "capital expenses" -> Capital One, "I want to discover new cards" -> Discover. It also works the other way: "express checkout" counts as naming American Express.
  - **Netflix and Pixel, latent:** "apple pay" matches Apple TV+ and Apple iPhone. "galaxy" and "peacock" are live.
- **Required side.** `seedRule` and the phrasings signature filter (instrument.ts ~3241 and ~4593) call the matchers with **no extraForms**. On a cold store there are no dictionary aliases at all. So "Amex" never counts as naming American Express.
  - amex [50] ("my Amex") shipped flagged `problem_resolution must name American Express`.
  - The log shows 8 more must-name seeds (advocacy, 3 churn, 2 renewal, expansion, ecosystem) silently rewritten from "Amex" to "American Express".
  - Every "Amex"-only paraphrase will be rejected in the next step.
  - The result is that the brand's most common buyer name is mechanically purged from every retention cell.
- **Why S2:**
  - The seed damage is mostly surfaced.
  - The paraphrase damage is not. Jira paraphrases can never say "issues" or "projects" in any cell. A churn paraphrase such as "Jira has performance issues" is rejected as naming a rival. AmEx retention paraphrases are forced into one register.
  - This narrows exactly the asker variety the 10-paraphrase design exists to supply.
- **Proposed fixes:**
  - (a) Treat single tokens split from a multi-word roster name, and single-word names that are dictionary words (issues, projects, bank, chase, discover, capital, express, galaxy, apple, peacock), as AMBIGUOUS_FORMS. They then count only when capitalized.
    - On the 205 seeds this removes the 1 false positive and loses no true hit. Every true rival mention in the seeds is capitalized or is the full name.
    - Sentence-initial "Discover"/"Chase" stays a small residual.
  - (b) Have the brand profile return buyer short forms (Amex, Moto) and pass them as extraForms to `seedRule`, the design-heal mech checks and `checkCandidateSignature`.
    - This would un-flag [50] and would have prevented all 8 AmEx rewrites.
- **Bump SEED_RULES_VERSION** when this ships. The checks change meaning, and the stored chips on [20] and [50] should re-judge.

**F3 [S2] jira [36] (pricing, typed open_choice): a Jira tier question with Jira's name stripped feeds the open-choice headline.** JUDGMENT, with a countable slice.

> "Scaling agile to about 250 users. **We're on the base plan with marketplace add-ons for portfolio roadmapping and time tracking** (about $3 per user). Over a 3 year horizon, is it cheaper to **move up a tier and drop the apps**...?"

- **The vocabulary points at Jira.** The asker is an existing customer of an unnamed tool whose structure is Jira's: Standard plus Marketplace apps such as roadmaps and Tempo, versus Premium with plans built in. Answers will name Jira and Atlassian products.
- **It is typed as an unprompted question.** `questionTypeOf` types a pricing seed without the brand name as open_choice. Under the presentation rule, open_choice feeds the headline visibility and pick rates. So a mention the prompt practically names gets counted as unprompted.
- **Rule violated:** the blind-vocabulary rule, "no product term only one roster brand is known for" ("charge card" points every answer at American Express). It also breaks the within_brand vs open_choice split.
- **Mechanism (log):**
  - The pricing trade-off diversity pass labeled the original "Is Jira Standard plus a paid roadmap..." as a duplicate "tier vs tier".
  - The heal dropped the brand name and kept the brand's structure.
  - The diversity heal should keep the original's brand naming, or re-derive qtype on the healed text.
- **Countable slice:** flag a generic (open_choice) pricing seed that speaks as an existing customer of an unnamed product: `(we're|I'm) on (the|a) (base|basic|free|standard|premium|starter|current) (plan|tier)` or `move up a tier`. 1 hit across the 16 pricing seeds, 0 false positives.
- **Gate fix:** name Jira, which makes the cell within_brand. For example: "Scaling Jira to about 250 users. We're on Standard plus marketplace apps for roadmaps and time tracking, about $3 per user. Over 3 years, is moving to Premium and dropping the apps cheaper once you count automation limits and admin time?" ([35] is then a second Jira tier cell with a different circumstance, which s23 allows.) Alternatively, replace it with a different generic structure, such as per-seat vs flat or contractor/viewer seats.

**F4 [S2/S3] netflix [27] (S2), netflix [28] (S3): money bolted onto non-price worries.** COUNTABLE.

> [27] "Shows canceled too soon": "I'm **worried about wasting money** if they cancel shows too fast... Is that still a **real financial risk** with them, or am I overreacting?"
>
> [28] "Kids safety and controls": "I'm **worried about wasting money** if the parental controls aren't reliable. Can I actually lock it down..."

- **Rule violated:** the doubt design intent: "when that concern is not itself about price, a bolted-on cheaper-options or price remark does not satisfy the design". The writer rule says the same: price has its own cells.
- **[27] is S2.** Its ask itself becomes a money verdict. A month-to-month service invites "low financial risk, cancel anytime" as the rebut, so the confirm/rebut read measures cost exposure rather than Netflix's cancellation pattern.
- **[28] is S3.** Its ask stays on concern, but the identical preamble ("I'm worried about wasting money if") in two sibling cells also reads machine-written.
- **Why the checks missed it:** both passed the design check, and r8's bolt-on check only knows the token "cheap".
- **Proposed check:** extend `concern_price_bolt_on` with `wast(e|ing) (my|our|the)? money | financial(ly)? | money`.
  - Across the 27 doubt cells that the code treats as non-price: 2 hits, both these cells, 0 false positives.
- **Gate fixes:**
  - [27]: "Thinking about Netflix again, but I hate getting into a series only to see it axed after one season. Do they still cancel shows that fast, or am I overreacting?"
  - [28]: "Considering Netflix for the kids. Can I actually lock it down so my 8-year-old only sees age-appropriate stuff, or do things slip through the parental controls?"

---

## 2. S3 findings

**F5 [S3, surfaced] jira [8] (discovery, flagged off-design): a true defect.**

> "Best project management software for migrating off an old bug tracker with years of history. Imports, preserving IDs and links, auditability matter. **What should I look at?**"

- It is written as a search query, with no asker in it.
- "What should I look at?" sits next to the banned "what should I look for" and has two readings: products, or criteria.
- **Rule violated:** the open-choice intent ("must invite NAMED picks") and the circumstance intent.
- **Gate fix:** "We're moving off an old bug tracker with years of history - imports and keeping IDs and links intact matter most. Which project management tools should we shortlist? Name a few."

**F6 [S3, surfaced] jira [20] (feature_screening, flagged twice): one false flag, one true one.**

> "Which project management software can import issues with full history (comments, attachments, status changes) and map custom fields during migration? Name a few."

- `blind stage names GitHub Issues / Projects` is the F2 checker bug.
- `off-design: no stated personal migration circumstance` is **true**. Take out "during migration" and the question is a generic feature screen, which is exactly what the circumstance intent rejects.
- **Gate fix** (avoids "issues" until F2 ships, because a manual edit runs the same check): "We're leaving an old self-hosted tracker with years of tickets. Which project management tools can import them with full history - comments, attachments, status changes - and map our custom fields? Name a few."

**F7 [S3] amex [37] (pricing, open_choice): an off-category trade-off that states a third-party fee.** JUDGMENT.

> "We spend about 50,000 a month on payables. If we put invoices on credit cards through a **bill-pay service at 2.9%** for the controls and extra float, or pay ACH early to take a 2% discount, which comes out ahead over a year?"

- **No card choice:** the trade-off is a payables method. The answers will name bill-pay services if they name anything, and the cell is typed open_choice.
- **A stated product fee:** "at 2.9%" is a bill-pay product's fee asserted from world knowledge, which is the r12 disease.
- **Mechanism (log):** the diversity pass flagged the original small-business seed as a duplicate "fee vs no-fee" and healed it into this one. The heal reached for an exotic shape instead of another credit-card structure.
- **Gate fix:** keep the circumstance and make it a card structure the category owns. For example: "About 15 employees carry company cards, around 50,000 a month in spend. Does a business card with an annual fee and richer rewards on ads and shipping come out ahead of a no-fee flat cash-back card for us? Which would you get?" This duplicates no other AmEx pricing shape: [36] is co-brand vs flexible and [38] is intro APR vs rewards.

**F8 [S3] netflix [4] (problem_recognition, Rotate to save): the asker already pays for the product.** JUDGMENT.

> "On the TV side, a bunch of little charges keep popping up and **we barely use half of what we pay for**... How do people set this up so you don't overpay?"

- **Rule violated:** the awareness intent: "someone already holding one and doubting it ('I'm paying a big fee for perks I barely use') is a worry about the product, not awareness". This seed is that counter-example almost word for word.
- The design check passed it. The scenario itself presupposes subscriptions, so this stage is structurally hard for it.
- **Gate fix:** voice the pain as a cable or bill problem from someone not yet on streaming. For example: "Our cable bill keeps climbing and we watch maybe five channels. I'm fine taking breaks between shows if it saves money. How do people cut this down without losing the shows they actually watch?"

**F9 [S3] Jira coverage: Linear gets no head-to-head or alternatives cell.** JUDGMENT (profile ranking).

- The cold profile ranked Linear 7th of 7. ANGLE_SLOTS=4 fills comparison and alternatives in roster order, so ClickUp, Asana, Monday.com and Trello got the 8 rival cells.
- Linear appears in 36% of jira answers in the census. It is the documented riser that the "ranked by how often AI assistants name them, risers mandatory" prefill change was made to capture.
- The rival-slot choice is a measurement decision, and it fell on roster order.
- **Gate fix:** drag Linear into the top four at the market step. Trello is the natural one to drop.
- **Follow-up:** the planned post-wave alone-share re-rank should own slot order. GitLab (26% of answers) is not on the roster at all.

**F10 [S3, latent checker bug, no shipped defect] `concern_price_bolt_on` treats any concern containing "feel" as a price concern.** COUNTABLE.

- The concern test is `/price|pricey|pricing|fee|cost|.../i`, with no word boundary, so "fee" matches inside "feel" and "feels".
- Three non-price picks in this walk are therefore exempt from the cheaper bolt-on check:
  - jira "Support feels slow"
  - netflix "Password sharing rules feel strict"
  - netflix "Ads tier feels wrong"
- The worries generator phrases picks as "X feels Y" often (6 of 34 here).
- None of the three exempt cells carries a bolt-on today, so this is latent.
- **Fix:** `\bfees?\b`. Ship it with F4's extension, which inherits the same test.

---

## 3. Flag adjudication

| Cell | Flag | Ruling | Gate action |
| --- | --- | --- | --- |
| jira [8] | off-design: no circumstance, "what should I look at" | **True defect** (F5) | Edit as in F5 |
| jira [20] | blind stage names GitHub Issues / Projects | **Checker bug** (F2): "issues" matched as a brand token | Ignore the chip |
| jira [20] | off-design: no stated migration circumstance | **True defect** (F6) | Edit as in F6, avoiding "issues" until F2 ships |
| amex [50] | problem_resolution must name American Express | **Checker bug** (F2): "Amex" is not a recognized form | Approve as written |

Two of the four flag reasons are checker bugs with one shared root (F2). The other two are real and mild.

---

## 4. Per-brand judgment calls

**Jira**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing shapes | Within s23, but F3 | [35] Standard vs Premium (Jira, 450 seats, 3 years, admin); [36] base + add-ons vs higher tier (Jira unnamed, F3); [37] annual + paid migration vs monthly + in-house (Jira); [38] free vs paid (generic, "Which would you get?"). Two tier shapes ([35], [36]) with different circumstances. |
| Doubt cells | Clean | 8 picks, 8 cells, each a confirmable claim. Churn and renewal keep staying on the table: "tune it and stay", "clean it up and stick with it", "renew or move on", "worth sticking with it". |
| Comparisons and alternatives | Clean except F9 | All four comparisons are neutral and ask for the pick. Offensive alternatives are bare. The defensive seed is an existing customer. |
| Awareness | Accepted | [3] and [2] askers own an old tracker or a board-plus-spreadsheet setup. The migration and scaling scenarios presuppose this, and earlier audits accepted it. Every awareness seed ends on a way-out ask. |

**American Express**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing shapes | Distinct, but F1 and F7 | [35] Gold vs Platinum (brand, F1); [36] co-brand vs flexible card; [37] card bill-pay vs ACH (F7); [38] 0% intro APR vs rewards. |
| Class cells | Clean | [31] "American Express or a Visa card", [32] "American Express vs a Mastercard". The target and the class are named, with no rival and no category tail. |
| Doubt cells | Clean | Objections [33], [34] are prospects. Four churn cells and two renewal cells state the worry and keep staying on the table. No money asks. |
| Register | F2 side effect | All must-name cells except [50] say "American Express" in full, because the checker forced it (8 rewrites). |

**Netflix**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing shapes | Within s23, no stated prices | [29] Standard with ads vs Premium (brand); [30] ad-free vs ad plan + free services, which ASKS current prices (r12 working); [31] one month vs two for a returning season; [32] rotate vs keep two. |
| Churn stay option | Accepted | [33] "hang on ... or pause" is stay vs leave. [35]'s stay option is "upgrade to ad-free" (S4 below). No pause-vs-cancel pairs. |
| Scenario overlap | S4 | "Must-watch season return" and "Rotate to save" are both hop-in-hop-out buyers. Discovery, shortlist, use_case and criteria in both scenarios lean on cancel ease, so 8 of 16 open-choice and criteria seeds weight that one attribute. |

**Google Pixel**

| Area | Result | Detail |
| --- | --- | --- |
| Switch direction | Clean | Every Switching-ecosystems seed points toward Android ([4], [8], [12] say "iOS to Android"), so the client stays eligible. |
| Pricing shapes | Within s23, but F1 | [36] carrier credits vs unlocked outright; [37] a-series vs regular Pixel (brand, F1); [38] pre-order financing vs waiting for discounts; [39] financing vs upfront when switching. [36] and [39] are the same shape with different circumstances. Both seed_states_price catches in the log healed. |
| Doubt cells | Clean | 10 picks, 10 cells. [31] ("paying for the name") voices price as a verdict, not math. |

---

## 5. Contract gaps (not seed defects; for a decision)

- **G1 - generic pricing cells about payment methods are typed open_choice with no pick ask.**
  - Affected: netflix [31], [32]; pixel [36], [38], [39]; amex [37]. None asks which product, because their trade-offs land on payment methods, not products. The writer rule only demands "which would you get" when the trade-off lands on products.
  - Effect: these cells add near-zero-brand answers to the open-choice headline denominator.
  - Options: a separate qtype for price-structure cells, or a pick ask on every generic pricing cell.
- **G2 - the trade-off diversity heal produced both of this walk's pricing problems** (F3, F7). It should keep the original's brand naming, prefer structures the category owns, and re-derive qtype after healing.
- **G3 - the writer prompt still contains a price-stating example** ("the cheaper line at 450"). It contradicts r12 (F1).

---

## 6. S4 (polish; does not block)

**Jira (5)**
- [45] Defensive seed with no stated move ("We're on Jira today. What are the best ... alternatives"). This repeats the earlier amex [45] note.
- [37] couples two independent choices: annual plus outsourced migration vs monthly plus in-house.
- [39]-[41] All three business_case seeds pitch the CFO (carry-over).
- [53] Five-item list ("docs, code, chat, CI, and reporting").
- [33] Stance is ambiguous: "Jira feels fine for tickets" reads as a current user in an objection cell.

**American Express (3)**
- [36] "a 95-150 fee airline co-brand" fixes a class fee band from world knowledge. Mild, generic.
- [31] and [32] The class cells are not parallel ("or a Visa card:" vs "vs a Mastercard,").
- [51] The expansion seed invites splitting to "a different issuer", which shades into alternatives (group 3, parked).

**Netflix (5)**
- "Vibe" appears 5 times in the Solo scenario, and [21] "brag about paying for ... hit different" adds status framing (carry-over).
- [35] Churn's stay option is an upsell ("upgrade to ad-free and stick").
- [45] The ecosystem seed never states the relationship ("What pairs well with Netflix?").
- Scenario overlap: Must-watch and Rotate (see section 4).
- [33] "tentpole" is industry jargon.

**Google Pixel (6)**
- [46] "Leaving Apple iPhone" uses the roster string the writer rule names as wrong. Countable: 1 hit, 0 false positives.
- [16], [20], [24] repeat the contorted opener "Moving/Switching from a different mobile OS to Android". The rule allows saying iOS.
- [32] The privacy objection leans toward a lookup ("how much tracking am I stuck with, and can I lock it down").
- [3] The FOMO pain has a behavioral way out, so the awareness read names no products by construction. At 53 words it is also wordy.
- [39] 55 words, four inputs, and a second ask ("does the switch pencil out").
- [25] "people brag about, post camera flexes" adds status framing (carry-over).

---

## 7. Bottom line

No S1. Three of four batteries need one or more S2 gate edits, and two engine bugs should ship before the phrasing step.

| Battery | Verdict | Exact blockers |
| --- | --- | --- |
| **Jira** | **Not ready** | F3 [36] rewrite (S2); F5 [8] and F6 [20] gate edits (flagged); F9 put Linear in the rival slots; F2 checker fix before phrasings, or every jira paraphrase loses "issues" and "projects" |
| **American Express** | **Not ready** | F1 [35] remove the stale fees (S2); F7 [37] gate edit; [50] approve the chip; F2 "Amex" form before phrasings |
| **Netflix** | **Ready after 3 edits** | F4 [27] (S2) and [28]; F8 [4] |
| **Google Pixel** | **Ready after 1 edit** | F1 [37] remove the stated prices (S2) |

**Engine fixes, in order:**
1. F2: common-word brand tokens count only when capitalized, and buyer short forms such as "Amex" pass as extraForms. Needs an r-bump.
2. F1: widen the stated-price check (4 of 4 catches, 0 false positives) and remove "at 450" from the writer prompt. Needs r- and s-bumps.
3. F4 and F10: money tokens in the bolt-on check, and `\bfees?\b` in the concern test.
4. G2: the diversity heal keeps brand naming.

Fixes 1-3 are countable checks with measured zero false positives on this walk. An r-bump re-judges cached cells for free and regenerates only the failures.
