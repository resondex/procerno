# Seed audit - cold walk round 5 (s29/r13 engine, post round-4 fixes) - Jira, American Express, Netflix, Google Pixel (2026-10-02)

**Scope.** All 207 seeds from one cold walk per brand (`cold_walk_r13d/cold_seeds_<brand>.json` in the session scratchpad). Each battery came from the full setup chain run against an empty store, with defaults accepted everywhere. The engine is the working tree: STYLE_VERSION s29, SEED_RULES_VERSION r13, plus the three round-4 fixes (brand steer gets a second, told-why attempt and flags on failure; "wastes ... money" and "worth paying" join the money bolt-on check; the design check parses the first JSON object). Rosters, scenarios and worry picks are fresh draws and differ from rounds 1 and 4.

| | Jira | American Express | Netflix | Google Pixel |
| --- | --- | --- | --- | --- |
| Category | project management software | credit cards | streaming services | smartphones |
| Roster | Asana, Trello, ClickUp, Monday.com, GitHub (Issues/Projects), GitLab, Linear (all same-seat) | Chase, Capital One, Citi, Discover, Bank of America, Wells Fargo (same-seat); Visa (upstream, class cell "a Visa card") | Disney+, Amazon Prime Video, Max, Hulu, Apple TV+, Peacock, Paramount+ (all same-seat) | Samsung Galaxy, Apple iPhone, OnePlus, Xiaomi, Motorola Moto, Oppo, Sony Xperia (all same-seat) |
| Rival cells (4 slots) | Asana, Trello, ClickUp, Monday.com | Chase, Capital One, Citi, Discover + 1 class cell | Disney+, Prime Video, Max, Hulu | Galaxy, iPhone, OnePlus, Xiaomi |
| Scenarios | Enterprise standardization; Scaleup migration; Portfolio coordination; Regulated rollout | Everyday spend optimizer; Airline loyalist co-brand; Premium travel perks; Small business rewards setup | Must watch premiere; Cord cutter lineup; Kids first household; Monthly service rotation | Carrier upgrade window; Value midrange refresh; Family plan chooser; Broken phone same-day |
| Worry picks | objections: setup overhead, thin portfolio reporting, compliance/residency; churn: clunky everyday, slow at scale, fragile integrations, instance sprawl, hands-off support; renewal: price steep with add-ons | objections: annual fee steep, spotty acceptance, strict approvals/limits; churn: everyday rewards underwhelm, redemption hoops, benefits denied in claims, statement credits hard to use, fraud declines | objections: hard to find something, plans confusing, kids profiles not trusted; churn: sharing rules punishing, cancels shows too quickly; renewal: not enough must-watch, price too high, titles vanish | objections: weak reception, battery/heat, hard to leave iPhone, Google drops features, repair/parts, hard to find at carriers, AI privacy; churn: bugs, price high |
| Kept stages | 19 (all) | 17 (no business_case, renewal) | 18 (no feature_screening, business_case; premium_worth kept) | 16 (no category_education, renewal, business_case) |
| Seeds / missing | 56 / 0 | 52 / 0 | 48 / 0 | 51 / 0 |

**Bar.** The same adversarial bar as every round, judged against the written contracts: `CELL_WRITER_SYSTEM` (s29), `stageDesignIntent` / `seedDesignLine`, `seedRule` (r13), the AGENTS.md decided boundaries and the s23 pricing-shape ruling (a shape at most twice, when circumstances differ). A flagged seed counts as surfaced. Severity: **S1** ship-blocker / **S2** biases a measurement / **S3** fix at the gate / **S4** polish.

**Mechanical facts (all four batteries, verified by script).**
- No calendar years, em dashes, tildes, curly quotes, segment vocabulary or 3+ question pile-ups. 25 seeds ask two questions.
- Longest seed is 58 words (pixel [40], the brand-steer output). It is the only seed over 55, and under the 60-word ceiling.
- Every worry pick appears as exactly one cell carrying its concern (34 of 34), and each cell voices its own concern.
- The engine's own checks (`deriveCheckSpec` + `checkPromptAgainstSpec` + `scenarioLabelLeak`, with each cold store's cached dictionary aliases, same-seat roster and class brand) pass all 207 seeds. No blind seed names a roster brand. Every stored qtype matches a recomputation.
- Zero gate chips in all four batteries. Every finding below is unflagged.
- Each battery has at least one brand-named pricing cell: jira [34], amex [38], netflix [34] (restored by the brand steer on attempt 1), pixel [40] (restored on attempt 2 after attempt 1 broke the r13 stated-price rule).

---

## Counts

| | Jira | AmEx | Netflix | Pixel | Total |
| --- | --- | --- | --- | --- | --- |
| Seeds | 56 | 52 | 48 | 51 | 207 |
| Flagged (gate chips) | 0 | 0 | 0 | 0 | 0 |
| S1 | 0 | 0 | 0 | 0 | 0 |
| S2 | 0 | 0 | 0 | 0 | 0 |
| S3 | 1 | 0 | 3 | 2 | 6 |
| S4 | 7 | 7 | 7 | 9 | 30 (+3 engine) |

---

## Prior classes: recurred or closed

| Class | Round | Status | Evidence this round |
| --- | --- | --- | --- |
| F1 verb-less stated prices | 1 | **Closed** | No seed states a named product's price. r13 caught the one attempt (the Pixel brand steer's first draft, "the latest Pixel at $0 down, $25/month") and the retry dropped it. Generic class fees remain (amex [35], [36] - S4). |
| F2 common-word brand tokens / "Amex" | 1 | **Closed** | All 207 seeds pass with the cached aliases. "issue types" (jira [53]), "at a bank" (jira [13], [21]), "my bank card" (amex [4]) do not read as rivals. No brand-rule rewrites in any log. No AmEx seed says "Amex" - all use the full name by writer habit (S4 register note). |
| F3 unnamed one-product plan structure | 1 | **Closed** | No pricing seed describes one product's plan with its name removed. |
| F4 / N2 money bolted onto non-price worries | 1, 4 | **Recurred in new word forms** | The round-4 forms are caught (the Netflix log shows a renewal draft rejected as `concern_price_bolt_on` and healed). New forms slip through: netflix [29] "paying more than they expect", [30] "Am I paying for parental controls that don't work". See D2. |
| F5 open-choice without named picks | 1 | **Closed** | Every discovery, shortlist, feature_screening, use_case and social_validation seed asks for names. |
| F6 feature screen with no circumstance | 1 | **Closed** (one S3 neighbour) | Every feature screen carries its scenario in the asker's words. pixel [17] carries it but picks a feature unrelated to it (D5). |
| F7 off-category trade-off / third-party fee | 1 | **Closed** (S4 residue) | No off-category trade-offs. Generic class fee "95" in amex [35], [36]. |
| F8 awareness asker already pays | 1 | **Recurred** | netflix [4] "I keep paying for stuff I'm not watching ... idle subscriptions" - near the design intent's own counter-example. See D4. |
| F9 / N3 dev-native rivals get no cell | 1, 4 | **Recurred** (deferred, pending Tyler) | Linear is 7th of 7; GitHub and GitLab 5th and 6th. All eight rival cells go to Asana, Trello, ClickUp, Monday.com. See D6. |
| F10 "fee" inside "feel" | 1 | **Closed** | "Support feels hands-off" is treated as non-price; its cell [46] has no money remark. |
| G1 generic pricing cells with no pick ask | 1, 4 | **Recurred** (contract gap, open) | 12 cells: jira [35]-[37], amex [35]-[37], netflix [31]-[33], pixel [37]-[39]. |
| G2 diversity heal / brand steer cause the pricing problems | 1, 4 | **Recurred** | Pixel ends with three carrier-deal-vs-unlocked cells (D1): the heals were never re-labeled and the brand steer's output was never shape-checked. |
| G3 writer prompt price example ("at 450") | 1, 4 | **Open** (deliberately) | Still in `CELL_WRITER_SYSTEM`. It cost one rejected steer draft this round (Pixel), recovered by the retry. |
| G4 is "total cost over time" a generic shape | 4 | **Open** | No seed tested it this round (jira [37] weighs two options). |
| N1 Pixel had no Pixel-named pricing cell | 4 | **Closed** | Brand steer attempt 1 rejected (stated price, reason now logged), attempt 2 restored [40]. Netflix's steer restored [34] on attempt 1. |
| N4 cost estimate with no trade-off | 4 | **Closed** | jira [37] weighs cloud per-user vs self-hosted. |
| N5 renewal price worry unvoiced, list price as the asker's bill | 4 | **Closed** | netflix [43] "Netflix keeps getting pricier. Keep paying for it, or cancel and move to something cheaper?" - worry voiced, no figure. |
| N6 premium_worth scenario frame | 4 | **Recurred** | netflix [27] stacks three scenarios' circumstances and asks only for paid picks. See D3. |
| S4: ecosystem never states the relationship | 1, 4 | **Recurred** | amex [51], netflix [47], pixel [50]. jira [55] ("Jira is our hub") does it right. |
| S4: churn stay option is an upsell | 1, 4 | **Closed** | No churn or renewal cell offers an upgrade as the stay side. |
| S4: business_case all pitch the CFO | 1, 4 | **Recurred** | jira [38]-[41]. |
| S4: status / identity framing | 1, 4 | **Recurred** | netflix [22] "what their fans ... identify with", pixel [25] "people say nice phone ... social vibe". |
| S4: defensive seed voiced hypothetically | 4 | **Recurred** | jira [47] "If we decide to leave Jira". |
| S4: scenario label echo | 1, 4 | **Recurred** | netflix [16] "Kids first at our place", pixel [10] "a value midrange upgrade". |
| S4: copy of the writer prompt's alternatives example | 4 | **Recurred** | pixel [44] "Done with Samsung Galaxy. What phones should I try instead?" |
| S4: topic opener ("Phone budget question:") | 4 | **Closed** | None. pixel [11] "Names, please:" is an ask opener, not a topic label. |
| S4: Netflix comparisons one sentence with the name swapped | 4 | **Closed** | [23]-[26] vary. |
| Engine: greedy JSON parse | 4 | **Partly closed** | Fixed in the design check. The same greedy `\{[\s\S]*\}` is still in the pricing-shape labeler (instrument.ts:3557). |

---

## 1. S1 and S2

None. This is the first cold walk with no S2. Every finding below is a gate edit or a contract decision.

---

## 2. S3 findings (all unflagged)

**D1 [S3] Google Pixel pricing: three of four cells weigh the same carrier-deal-vs-unlocked trade-off, and the only brand cell asks two questions at once.** JUDGMENT (s23 shape cap; writer rule "reads ONE way"), with an engine mechanism.

> [37] "My carrier has it at 25 a month for 36 months with 400 in bill credits if I stay, or I can buy unlocked for 700. ... Which route makes more sense?"
>
> [39] "Carrier is offering big trade-in bill credits spread over 36 months, or we can buy unlocked and sell our old phones ourselves after about 2 years. ... Which path typically ends up cheaper?"
>
> [40] "Carrier will give bill credits if I trade in and finance for 36 months, or I can sell the broken one for about 150 and buy an unlocked Pixel for pickup. I keep phones 3 years. **Pixel A-series vs regular vs Pro - which route is cheaper overall?**"

- **Rules violated:**
  - s23: a trade-off shape at most twice per battery. All three weigh "take the carrier's credits and financing" against "buy unlocked". [38] (midrange vs flagship) is the only other shape.
  - Writer rule: "an ask with two readings measures neither". [40] asks route (carrier vs unlocked) and tier (A-series vs regular vs Pro) in one question, at 58 words.
- **Why it matters:** the pricing view reads almost entirely as "what does the AI say about carrier deals", and the within_brand pricing view rides on one muddled cell. "Which is cheaper, A-series or Pro?" has an obvious answer, so the tier half measures nothing.
- **Mechanism (log and code, instrument.ts ~3546-3720):**
  1. The labeler flagged [39] (a "which price level" duplicate) and [40] (a "financing vs buying outright" duplicate).
  2. The duplicate steer tells the writer to pick a different trade-off from a fixed list - "the client brand's own tiers, total cost over time, financing vs buying outright, trade-in math" - without removing the shapes already covered. The writer took "trade-in math" for both.
  3. Healed texts are never re-labeled, so the engine never sees that the heals landed back on a covered shape.
  4. The brand steer then rewrote [40] with "its financing or trade-in" in its instructions and is not shape-checked at all.
  5. The labeler's own vocabulary splits one phone decision three ways ("carrier credits vs unlocked", "financing vs buying outright", "trade-in vs resale"), so even a re-label might pass these three as distinct.
- **Countable?** Not cleanly. A carrier/credit/financing/unlocked keyword count puts 3+ of 4 pricing cells in 16 of 24 Pixel batteries across every walk, but keywords appear in tier questions too, so that count over-fires. The fix is in the engine's own labeler.
- **Engine fixes:**
  - Re-label the pricing shapes after heals and after the brand steer, and re-heal a duplicate once.
  - Drop shapes already covered from the steer's suggestion list.
  - In the labeler prompt, treat carrier credits, financing and trade-in against buying unlocked as one class.
- **Gate fixes:**
  - [39] (Family plan chooser): "Family of 5, and we baby our phones - we keep them about 3 years. For the kids, is certified refurbished the smarter buy than new budget phones over that stretch? Which would you pick?"
  - [40] (Broken phone same-day): "Phone died today and I want a Google Pixel. I keep phones about 3 years, mostly photos, maps and calls. Is the Pixel A-series the smarter buy over that stretch, or is the regular Pixel worth paying up for?" (A second price-level cell next to [38], with a different circumstance, which s23 allows.)

**D2 [S3] netflix [29] and [30]: money framing on non-price objections, in forms the r13 check does not know.** COUNTABLE.

> [29] "Plans and features confusing": "Netflix's plans feel like a shell game, ads here, 4K there, downloads on some. **Do people end up paying more than they expect** to get the basics, or is it straightforward once you're in?"
>
> [30] "Kids profiles not trusted": "I've heard Netflix Kids lets questionable stuff slip through and the filters are easy to bypass. **Am I paying for parental controls that don't work**, or is this overblown?"

- **Rule violated:** the doubt design intent ("when that concern is not itself about price, a bolted-on cheaper-options or price remark does not satisfy the design") and the writer rule that price has its own cells.
- **Why S3, not S2 like round 4's N2:** in both cells the other half of the either/or stays on the worry ("straightforward once you're in", "is this overblown"), so the verdict still reads the concern. But:
  - [29]'s confirm branch is a hidden-cost verdict. That overlaps the renewal "Price feels too high" cell and invites a plan-price rundown instead of a confusion verdict. Plan structure is close to price, which is why this is a judgment call.
  - [30] invites a money rebut ("parental controls are included on every plan") and blurs the stance: "Am I paying" reads as a current subscriber in a prospect cell.
- **Why the checks missed them:** r13's bolt-on regex knows "cheap", "wast... money", "worth paying" and "financial". It does not know "paying for" or "pay more". Round 4 rejected plain "paying for" because churn cells use it for the relationship ("We're paying for Jira").
- **Proposed check:** in **objections cells only** (the asker is a prospect, so "paying" there is never the relationship), with a non-price concern, flag `\bpaying for\b|\bpay(?:ing)? (?:more|extra)\b`.
  - Calibrated on every walk's scratchpad: 4,924 unique stage-tagged texts, 327 objection cells with non-price concerns.
  - 6 hits. 3 are already caught by r13 (round 4's [27], [29] and a "worth paying for Netflix" must-watch cell). 3 are new: these two, and an earlier walk's "Device or stream limits ... unless I pay more" (borderline - stream caps are tier-gated).
  - 0 clear false positives. Needs an r-bump (r14); the re-judge regenerates only these cells.
- **Gate fixes:**
  - [29]: "Netflix's plans feel like a shell game - ads on one, 4K on another, downloads on some. Will I end up on a plan that doesn't actually give me what I signed up for, or is it straightforward once you're in?"
  - [30]: "I've heard Netflix's kids profiles let questionable stuff slip through and the filters are easy to get around. Can I actually trust them, or is that overblown?"

**D3 [S3] netflix [27] (premium_worth): three scenarios' circumstances stacked onto an invariant cell, and a pick ask for one side only.** JUDGMENT. Round 4's N6, recurred.

> "**For big premieres and a kids-heavy household after cutting cable**, is it actually worth paying for a top streaming service, or are the free apps good enough? **If you were me, which subscriptions would you pick?**"

- **Rules violated:**
  - The premium_worth intent: weigh the tier "and invite named picks - from either side". "Which subscriptions would you pick" invites only the paid side; free apps are not subscriptions.
  - premium_worth is invariant (situation null). The opener carries the circumstances of Must watch premiere, Kids first household and Cord cutter lineup, and every paraphrase must keep them. That is the same confound s10 removed from comparisons.
- **Why it matters:** premium_worth measures whether the AI talks buyers out of the paid tier. A one-sided pick ask nudges answers toward naming paid services, and the stacked circumstances make the read about one composite household.
- 3 of the 11 Netflix premium_worth seeds across all walks carry scenario circumstances. The good ones ask "name a few on each side".
- **Proposed check (optional):** premium_worth seeds must contain a both-sides pick phrase (`each side|both sides|each camp|on the premium side ... budget`). JUDGMENT otherwise, owned by the design check - add "a pick ask for one side only does not satisfy it" to the premium_worth intent.
- **Gate fix:** "Are the big paid streaming services actually worth it over the free ones? Name a few you'd pick on each side."

**D4 [S3] netflix [4] (problem_recognition, Monthly service rotation): the asker already pays for streaming.** JUDGMENT. Round 1's F8, recurred.

> "**I keep paying for stuff I'm not watching.** I binge a show, forget to cancel, and another month slips by. Is there a smarter way to plan what I watch month to month so I'm not burning money on **idle subscriptions**?"

- **Rule violated:** the awareness intent: "The asker does NOT yet have this kind of product - someone already holding one and doubting it ('I'm paying a big fee for perks I barely use') is a worry about the product". This seed is that counter-example in streaming form.
- **Why it matters:** problem_recognition reports how often the AI points to category products unprompted. An asker who already subscribes gets subscription-management advice, which names no products by construction.
- **Structural cause:** the scenario ("subscribes for a month ... then cancels and returns later") presupposes owning the category. Round 1's [4] came from the same kind of scenario. The design check passed it.
- **Engine option:** have the participation mask skip problem_recognition for a scenario whose description presupposes owning the category, or tell the writer to voice that scenario's pain from before the first signup.
- netflix [2] (Cord cutter lineup, "My remote is just a grid of apps") is a milder case of the same thing - S4.
- **Gate fix:** "We cut cable to save money, and now some nights there's just nothing to watch. We'd only want something for a month or two at a time. How do people handle this without getting stuck with another monthly bill?"

**D5 [S3] pixel [17] (feature_screening, Carrier upgrade window): a feature pick unrelated to the scenario that excludes Google Pixel by construction.** JUDGMENT, and a contract gap.

> "Upgrade window just opened. Which current smartphones sold by carriers support both eSIM and **a microSD card slot**? Name a few."

- No Pixel has ever had a microSD slot, and neither do current iPhones or Galaxy S models. Among premium carrier phones it points answers at Sony Xperia (on the roster) and some Motorola and Galaxy A models.
- **Rules touched:**
  - The blind-vocabulary rule ("no product term only one roster brand is known for") - near it, not squarely inside it.
  - The eligibility principle the contract writes only for switches ("a switch toward a platform the client doesn't run on excludes it by construction").
  - The scenario is about weighing premium phones with trade-in credits. Nothing in it makes microSD the asker's need.
- **Why it matters:** feature_screening is open_choice and feeds the headline visibility rate. A cell where Pixel can never be correctly named is not a lost opportunity, it is a guaranteed zero.
- Contrast amex [18] (flat 2% back, no categories). AmEx is mostly excluded there too, but that need comes straight from the Everyday spend scenario and is a real weakness worth measuring. So the rule can't be "the client must qualify". It should be "the feature must come from the scenario, and a feature the client structurally lacks needs a reason in the scenario".
- **Contract gap (G5, new):** should feature screens be required to leave the client eligible, the way switches are?
- **Gate fix:** "Upgrade window just opened and I keep phones 5 years or more. Which carrier-sold smartphones have eSIM and the longest software update support? Name a few."

**D6 [S3] Jira: Linear, GitHub and GitLab get no head-to-head or alternatives cell.** JUDGMENT. Round 1's F9 and round 4's N3, recurred - deliberately unchanged, pending Tyler.

- The profile ranked Asana, Trello, ClickUp and Monday.com first, and Linear last of 7. ANGLE_SLOTS = 4 gives those four all eight rival cells.
- The profile's own audience is "product and engineering teams". Linear (36% of jira answers in the census), GitHub and GitLab are the rivals that audience compares against.
- **Gate fix:** at the market step, drag Linear and GitHub (or GitLab) into the top four, and drop Trello and Monday.com.

---

## 3. Flag adjudication

No seed shipped with a gate chip. The logs show every mid-generation flag healed:

| Battery | Mid-generation flags | Outcome |
| --- | --- | --- |
| Jira | 3 label leaks, 1 segment vocabulary, 12 design flags | All healed. One pricing label leak ("Regulated rollout:") healed into [37] "we're rolling this out" - the heal left a dangling "this" (S4). |
| AmEx | 3 label leaks, 13 design flags | All healed. The pricing diversity pass found three "fee vs no-fee" duplicates: two healed ([37], [38] - the brand cell), one regeneration was rejected for a mechanical rule the log does not name ("(mech )"), so [36] stands as a second fee-vs-no-fee cell, which s23 allows. |
| Netflix | 1 money bolt-on, 1 label leak, 7 design flags | All healed. The r13 bolt-on check caught a renewal draft. One "rotate vs keep" duplicate healed, and the brand steer restored [34] on attempt 1. |
| Pixel | 6 design flags | All healed. Two pricing duplicates "healed" back onto the carrier-deal shape (D1). Brand steer attempt 1 was rejected for a stated price, attempt 2 restored [40]. |

Three log events matter:
- **Pixel brand steer, attempt 1.** r13's verb-less price check rejected "Carrier has the latest Pixel at $0 down, $25/month for 36 months". That is a carrier offer to the asker, which the pricing intent calls circumstance ("an offer made to them ... belongs"). `dealBefore` does not know "carrier has/gives", and `planAfter` does not know "down". But an offer on a named product encodes its price ($25 x 36), so whether this was a false positive is a contract call (S4 engine note). The retry worked either way.
- **AmEx "regeneration rejected (mech ) - original stands".** The duplicate-regen rejection log still prints no reason (instrument.ts:3643). Round 4's logging fix covered only the brand steer (S4 engine).
- **No design-check parse crash.** The first-JSON-object fix held. The pricing-shape labeler at instrument.ts:3557 still uses the greedy regex (S4 engine).

---

## 4. Per-brand judgment calls

**Jira**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing shapes | Clean | [34] Premium vs Standard vs Enterprise (Jira, 800 users, 4 years); [35] monthly vs annual billing; [36] consolidate under one vendor vs separate plans; [37] cloud per-user vs self-hosted. Four distinct shapes. [35]-[37] ask no pick (G1). |
| Doubt cells | Clean | 9 picks, 9 cells. Objections speak as prospects. Churn and renewal keep staying on the table: "stick with it or is it time to switch", "handle enterprise volume, or should we plan to move off", "tame it and stay, or bite the bullet", "worth renewing, or should we walk away". [46]'s leave side, "find a platform with stronger support", restates the worry (S4). |
| Comparisons / alternatives | Clean except D6 | Comparisons are neutral and ask for the pick. Offensive alternatives are bare. The defensive seed [47] is conditional ("If we decide to leave Jira") (S4). |
| Awareness | Clean | No asker owns a tracker. All four end on a way-out ask ("What actually fixes this?"). |
| Blind vocabulary | Clean | Generic terms only ("custom fields/workflows", "dry-run import"). [2] names Slack, an out-of-category brand (S4). |

**American Express**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing shapes | Within s23 | [35] no-fee cashback vs a fee card (everyday); [36] co-brand fee card vs its no-fee version (airline) - the same shape twice, different circumstances; [37] keep a premium card vs downgrade and buy lounge passes (bundle vs pay-per-use); [38] Business Gold vs Business Platinum (brand, no stated fees). By the labeler's own wording ("mid-tier vs premium is ONE class"), [37] and [38] could also be read as price level. The healed [37] was never re-labeled, so the engine does not know either (see D1 mechanism). |
| Class cell | Clean, awkward | [31] names AmEx and the class only. Its grammar is odd: "American Express or should I get a Visa card - which would you go with" (S4). |
| Doubt cells | Clean | 8 picks, 8 cells. No money remarks on non-price worries. [32] (fee worry) may weigh value legitimately. Churn cells keep staying on the table. |
| Retention register | S4 | [51] ecosystem and [52] advocacy never say the asker holds an AmEx card. [49] problem_resolution is a merchant pending-charge service ticket (group 3, parked). |

**Netflix**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing shapes | Within s23 | [31] ad plan vs ad-free for a one-month binge; [32] hold two services vs rotate one plus free; [33] one premium service vs two cheaper ad-supported ones; [34] Netflix Premium vs ads tier (brand). [31] and [34] share a shape with different circumstances. [34] says "run the math", which the writer rule bans as planning vocabulary (S4). |
| Doubt cells | D2 | [28] voices the discovery worry ("waste nights hunting" - correctly not a money bolt-on). Renewal [42]-[44] and churn [35]-[36] keep staying on the table; [43] price worry is voiced with no figure (N5 closed). |
| Awareness | D4, plus [2] | Two of four problem_recognition askers already have streaming. |
| Comparisons / alternatives | Clean | [23]-[26] vary. [38] and [40] are near-identical sentences (S4). |

**Google Pixel**

| Area | Result | Detail |
| --- | --- | --- |
| Pricing | D1 | Brand cell present ([40]) but muddled, and three cells share one shape. |
| Doubt cells | Clean except S4s | 9 picks, 9 cells, all prospects for objections. [32] dodges to "the other platform's ecosystem" where "iOS" is allowed (S4). [34] sizes an assumed problem and offers two bad branches ("stuck waiting forever or paying a premium") (S4). [42]'s "Stick with it" is ambiguous between keeping the old phone and staying with Pixel (S4). |
| Switch direction | n/a | No switch scenario this draw. |
| Feature screens | D5 | [17] microSD. [18]-[20] are tied to their scenarios. |
| Comparisons / alternatives | Clean | [27] says "iPhone", the buyer's word. Alternatives are bare. |

---

## 5. Contract gaps (for a decision)

- **G1 (open, recurring).** 12 generic pricing cells weigh payment structures and ask no product pick, feeding the open-choice headline: jira [35]-[37], amex [35]-[37], netflix [31]-[33], pixel [37]-[39].
- **G2 (recurring).** Pricing heals and the brand steer are never re-labeled for shape (D1). The fix is mechanical: re-label after every pricing rewrite.
- **G3 (open, deliberate).** "the cheaper line at 450" is still in the writer prompt. It cost one rejected steer draft this round.
- **G4 (open).** Is generic "total cost over time" a valid shape? Untested this round.
- **G5 (new).** Should a feature screen be required to leave the client eligible, the way switches are (D5)? Proposed wording: the feature comes from the scenario, and a feature the client structurally lacks needs a reason in the scenario.
- **G6 (new, small).** Is a carrier financing offer on a named product ("the latest Pixel at $0 down, $25/month") circumstance or a stated price? The pricing intent says offers are circumstance; r13 rejects this form.

---

## 6. S4 (polish; does not block)

**Jira (7)**
- [38]-[41] All four business_case seeds pitch the CFO (carry-over).
- [55] Ecosystem lists six things; [53] lists four problems plus three actions.
- [11] "Name 4 solid project management software" and [18] "one project management software" put the mass-noun category in a count slot. COUNTABLE: number or "one" directly before "project management software" with no following noun.
- [21] "Rolling this out at a bank" and [37] "we're rolling this out" - "this" has no referent. [37] is a label-leak heal artifact.
- [2] Names Slack in a blind seed.
- [46] Leave side "find a platform with stronger support" restates the worry instead of staying plain.
- [47] Defensive seed is conditional ("If we decide to leave Jira").

**American Express (7)**
- [35] "pay around 95 a year" and [36] "Co-brand card with a 95 fee" state a generic class fee from world knowledge (carry-over).
- [35] Four usage figures (900, 300, 400, plus 95). The rule is two or three.
- [31] Class cell grammar: "American Express or should I get a Visa card - which would you go with".
- [51] Ecosystem seed never states the relationship ("What works well with American Express?").
- [52] Advocacy never says the asker holds the card.
- [49] Problem resolution is a pending-charge service ticket (group 3).
- No seed says "Amex". All 19 brand-named seeds use the full name by writer habit.

**Netflix (7)**
- [34] "run the math" is banned planning vocabulary. COUNTABLE: add "run the math" and "value math" to the planning-vocabulary check. 5 hits across all walks, all pricing seeds, 0 false positives.
- [47] Ecosystem seed never states the relationship.
- [16] "Kids first at our place" echoes the label "Kids first household".
- [22] "what their fans say they love or identify with" adds identity framing.
- [2] The asker already has streaming apps, and the pain ("a grid of apps") leads to devices, not services.
- [38] and [40] are the same sentence with the name swapped.
- [31] Third ask is a promo/free-trial lookup.

**Google Pixel (9)**
- [37] Six figures, a dangling "it" (which phone?), and an irrelevant "8 GB a month".
- [50] Ecosystem seed never states the relationship and lists four accessories.
- [25] Status framing ("people say nice phone ... social vibe").
- [32] "the other platform's ecosystem" where "iOS" is allowed and clearer.
- [34] Sizes an assumed problem ("how rough ... really?") with two bad branches and a money tinge ("paying a premium").
- [42] "Stick with it" is ambiguous (the old phone, or Pixel at the next upgrade).
- [44] Near-copy of the writer prompt's alternatives example.
- [10] "a value midrange upgrade" echoes the label; [11] opens "Names, please:".
- [1] Ends on a wait-or-upgrade timing ask, which invites no products.

**Engine (3)**
- The pricing-shape labeler still parses with the greedy `\{[\s\S]*\}` (instrument.ts:3557) - the bug class fixed in the design check.
- The duplicate-regen rejection log prints "(mech )" with no failed check (instrument.ts:3643).
- r13's verb-less price check rejects carrier financing offers on a named product (G6).

---

## 7. Bottom line

No S1 and, for the first time in a cold walk, no S2. The round-4 fixes held: both batteries that needed the brand steer got a brand-named pricing cell (Pixel on the second, told-why attempt), the new bolt-on forms caught a Netflix renewal draft, and the design-check parse did not crash. Six unflagged S3s remain. Two are recurrences of known classes in new forms (money framing in "paying for" / "pay more" words; premium_worth scenario stacking). One is a new engine gap (pricing heals and the brand steer are never re-labeled for shape). One is deferred (Linear).

| Battery | Verdict | Exact blockers |
| --- | --- | --- |
| **Jira** | **Ready after 1 gate edit** | D6 put Linear and GitHub or GitLab into the rival slots (pending Tyler's roster-ranking decision) |
| **American Express** | **READY** | none (7 S4s) |
| **Netflix** | **Ready after 3 gate edits** | D2 [29] and [30] remove the money framing; D3 [27] drop the stacked circumstances and ask for picks on both sides; D4 [4] voice the pain from before signing up |
| **Google Pixel** | **Ready after 2 gate edits** | D1 rewrite [39] to a new shape and [40] to a single brand tier question; D5 [17] replace microSD with a scenario-derived feature |

**Engine fixes, in order:**
1. **D1 / G2:** re-label pricing shapes after every heal and after the brand steer, re-heal a duplicate once, drop covered shapes from the steer's suggestion list, and merge carrier credits / financing / trade-in vs unlocked into one labeler class.
2. **D2:** objections-only `\bpaying for\b|\bpay(?:ing)? (?:more|extra)\b` on non-price concerns. 6 hits in 327 non-price objection cells across every walk, 3 of them new, 0 clear false positives. r14.
3. **D3:** add "a pick ask for one side only does not satisfy it" to the premium_worth design intent.
4. **D4:** skip or re-voice problem_recognition for scenarios that presuppose owning the category.
5. **S4, countable:** "run the math" / "value math" into the planning-vocabulary check (5 hits, 0 false positives); greedy parse in the shape labeler; name the failed check in the duplicate-regen rejection log.
6. **Decisions for Tyler:** G1, G3, G4, G5 (feature screens and client eligibility), G6 (carrier offers on a named product), and the D6 roster ranking.
