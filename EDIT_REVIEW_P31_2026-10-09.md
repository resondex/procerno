# Prompts-gate edit review of the five live drafts (p31 / s53 / r27), 2026-10-09

One reviewer per brand read every live cell (seed + served paraphrases, as in prod after the p31 rewrite) against STAGE_CONTRACT.md with the owner's rulings and proposed concrete edits. Per-brand files: edit_review_<brand>.md (edits in gate order, exact replacement text); live_<brand>.txt is the draft as reviewed.

| brand | cells | paraphrases | drops | paraphrase rewords | of which measurement | seed rewords / decisions |
| --- | --- | --- | --- | --- | --- | --- |
| Jira | 48 | 427 | 0 | 21 | - | 0 (+2 seed decisions: [24] which worry, [14] restates its room) |
| American Express | 46 | 409 | 0 | 19 | - | 1 ([8] grammar) |
| Netflix | 35 | 310 | 0 | 39 | 18 | 0 |
| Google Pixel | 42 | 373 | 0 | 24 | 7 | 1 ([2] way-out fixed to a parenting rule; redraw cell) |
| Doritos | 35 | 310 | 0 | 23 | - | 1 ([17] premium vs basic never invites named picks; redraw cell) |

---

# Jira prompts gate - edit review (live draft 2026-10-09T19:45Z)

Checked against STAGE_CONTRACT.md and the owner's rulings in force. The p31 audit was used to calibrate what counts. Seeds and paraphrases here are the live draft. They differ from the p31 audit set (for example, Criteria / Company p8 is no longer "what options should we examine first"), so every cell was read fresh.

## 1. Edits to make

1. `[0] problem_recognition / Company standardization - REWORD paraphrase p3 -> "Our org-wide status keeps falling out of sync because each squad uses a different tracker. How do we fix that?"` (the live p3 says "tracks work differently", which drops the stated cause - different trackers. This class has repeated in every roll since p26.)
2. `[24] objections / They'll change the rules - REWORD paraphrase p0 -> "Is it a legitimate worry that once teams are in, Jira keeps changing the way they're supposed to work?"` (the live p0 is a one-time "dictate new ways ... after they've joined". The seed's doubt is ongoing change after you're in.)
3. `[24] objections / They'll change the rules - REWORD paraphrase p3 -> "Is my concern reasonable that once teams are in Jira, it will keep changing how they're supposed to work?"` (same drift: "have their working rules changed" on adoption)
4. `[24] objections / They'll change the rules - REWORD paraphrase p1 -> "I'm concerned Jira keeps changing the expected way teams work once they're using it. Is that fair?"` (the live p1 says "may change" - one-off)
5. `[24] objections / They'll change the rules - REWORD paraphrase p8 -> "Is it overthinking to worry that Jira keeps changing how teams are meant to operate after they come aboard?"` (the live p8 says "changes" - one-off)
6. `[15] use_case / First team system - REWORD paraphrase p2 -> "Which project management tool is best for turning a messy backlog into a clear weekly plan the team actually sticks to, now that we're setting up our first proper tracking system?"` (the live p2 drops "the team sticks to", half of the outcome)
7. `[15] use_case / First team system - REWORD paraphrase p6 -> "Which project management tool would do the best job of turning a messy backlog into a clear weekly plan the team actually sticks to, as we introduce our first proper tracker?"` (the live p6 drops the adoption half of the outcome)
8. `[15] use_case / First team system - REWORD paraphrase p7 -> "Our team needs a weekly plan it will actually follow, made from a messy backlog, and we're just putting a real tracker in place. Which project management tool will do that best?"` (the live p7 asks "what should we look at" - Discovery's shortlist ask, not the which-does-it-best ask)
9. `[4] category_education / - - REWORD paraphrase p5 -> "For a software team, what different kinds of project management tools are out there, and how do they compare?"` (the live p5 asks for tools rather than kinds, which invites a brand list)
10. `[4] category_education / - - REWORD paraphrase p8 -> "How do the different kinds of project management tools for software teams differ from one another?"` (same: tools, not kinds)
11. `[29] pricing (Value) / Client-facing delivery - REWORD paraphrase p3 -> "Would Jira Premium be worth it over more affordable project management tools when our client projects need external stakeholders to see status and approve things?"` (the live p3 "worth more than affordable" is garbled and drops "more")
12. `[27] pricing (Value) / Legacy replacement - REWORD paraphrase p7 -> "For a replacement to our aging tracker, with history migration included, is Jira Premium worth it over cheaper project management tools?"` (the live p7 asks "worth more than", a different call)
13. `[12] criteria / Client-facing delivery - REWORD paraphrase p8 -> "As we review project management tools for client projects where partners need status and approvals, what should we look at, and what should we take into account from there?"` (the live p8 narrows the first ask to partner features, which reads as offered criteria)
14. `[12] criteria / Client-facing delivery - REWORD paraphrase p7 -> "We run client projects and need partners to be able to use a tool for status and approvals. What should we assess in a project management tool, and given that, what should we consider?"` (the live p7 ends "followed by what?" - garbled)
15. `[4] category_education / - - REWORD paraphrase p2 -> "What types of project management tools are there for software teams, and how are those types different?"` (the live p2 says "options", leaning toward products)
16. `[16] use_case / Client-facing delivery - REWORD paraphrase p7 -> "For our client projects, partners need to check status and give approvals in one shared place, without the usual email-thread mess. Which project management tool fits that best?"` (the live p7 opens with a how-to question as well as the which-is-best ask)
17. `[29] pricing (Value) / Client-facing delivery - REWORD paraphrase p8 -> "For client projects that involve external stakeholders and need status visibility and approvals, would Jira Premium be worth the added cost over lower-priced project management tools?"` (the live p8's counterpart dangles at the end)
18. `[8] discovery / Client-facing delivery - REWORD paraphrase p0 -> "We're a dev consultancy handling several client projects and need a shared tracker where clients can see status and approve work. Which ones should we be looking at?"` ("options in this category" reads engine-ish)
19. `[42] alternatives / GitLab - REWORD paraphrase p0 -> "I'm moving my project management away from GitLab and need a new tool. Which one should I choose?"` (the live p0 is garbled "is where we're moving from" and switches between we and I)
20. `[37] churn_triggers / Support won't show up - REWORD paraphrase p2 -> "Help hasn't been available when we need it with Jira. Should we stay or go?"` (the live p2 "Is it time to stay or go?" is garbled)
21. `[43] renewal / Nickel-and-dimed by add-ons - REWORD paraphrase p8 -> "Our Jira renewal has landed, and these add-ons have us feeling nickel-and-dimed. Do we keep it or cancel?"` (the live p8 "the Jira we use" is awkward)

## 2. Cells with no edits

36 cells: 1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 17, 18, 19, 20, 21, 22, 23, 25, 26, 28, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 44, 45, 46, 47.

## 3. Battery-level notes

- **The four head-to-heads (18-21) are one template.** p0-p8 are word-for-word the same sentences across GitHub, ClickUp, Linear and GitLab, with only the rival swapped. Each cell meets row 8, and copied closings are the Comparison formula, so there are no edits. Per-rival results will differ only by rival, never by wording, which is fine for measurement. All four cells also share one lexical footprint: an engine that reacts to a phrasing would move all four rival rates together.
- **Objection [24] - the owner should decide which worry it is.** The label "They'll change the rules" reads as a vendor-lock-in worry: Atlassian changes terms or product once you're committed. The seed reads it as the product changing how teams work. Edits 2-5 only bring the paraphrases back to the seed's "keeps changing once you're in". If the vendor-terms worry is the one intended, reword the seed. Its subject currently overlaps worry [22] (too heavy) and churn [34] (customization sprawl) more than it overlaps [44] (locked in).
- **Use-case / Legacy replacement [14] restates its room.** The outcome ("replace an old tracker without losing issue history or breaking active work") is the room's own circumstance: migrate active work and history. Row 6 says the outcome never restates the situation, so this cell asks Discovery [6]'s question with "least painful" appended. It is left unedited because the answers still read cleanly as "the pick for migration". If you want a distinct job, a seed rewrite is the fix, not paraphrase edits.
- **Discovery adds "first" to the shortlist ask** in about 8 paraphrases (5 p2/p4/p8, 6 p3/p6, 7 p1/p2, 8 several). This is quality only - the shortlist ask survives - and it recurs every roll. It is not worth editing at the gate.
- **The Legacy replacement room converges on migration.** Problem recognition (slow tracker) is distinct, but Discovery, Criteria, Use-case, Value and Business case in that room all lead with "replacing an aging tracker / migrating". That is expected for a terms-defined room, and only Use-case breaks a contract line because of it (see [14]).

## 4. Totals

- Cells reviewed: 48
- Paraphrases reviewed: 427 (47 cells x 9 + Social validation 4)
- DROPs: 0
- Paraphrase REWORDs: 21
- Seed REWORDs: 0 (one optional seed decision flagged for [24], one for [14])

---

# Prompts-gate edit review - American Express (live draft, 2026-10-09)

Source: `live_american_express.txt` (46 cells; 45 serve 9 paraphrases, social validation serves 4). This is a different paraphrase roll from the p31 served audit, so that audit's S2 items are calibration only. They do not recur here: ecosystem keeps ownership in 9 of 9, the defensive cell keeps the tenure in 9 of 9, and no renewal paraphrase leans toward leaving. The draft carries no "[edited]" tags. The owner's two seed edits (category education [4], dining use-case [16]) are kept as the baseline.

## 1. Edits to make

1. `[12] criteria / Dining and going out - REWORD paraphrase p8 -> "Restaurant meals and nights out happen several times a week for me. What should I check in a card for those tabs, and given that, what should I consider?"` (as served, the second ask "what matters most for those tabs" just restates the first ask, so the cell asks one part; row 4 never)
2. `[20] comparison / Citi - REWORD paraphrase p8 -> "Suppose you could have only one credit card of these two: American Express or Citi. Which would you take, and why?"` ("keep one ... from these two" adds that the asker holds both)
3. `[31] business_case / Small business owner - REWORD paraphrase p7 -> "I operate a small shop and want a business card for paying suppliers while separating company spending. What's the best way to get American Express approved by the co-owner who signs off?"` ("small retail business" adds an asker fact; "my sign-off co-owner" is garbled)
4. `[8] discovery / Dining and going out - REWORD SEED -> "I go out to eat and to shows several times a week. What credit cards should I be looking at for that?"` (the served seed "go out to eat and shows" is ungrammatical, against row 3's "situation in plain words"; the fix keeps "shows", so the 9 paraphrases still match)
5. `[16] use_case / Dining and going out - REWORD paraphrase p7 -> "Which card is strongest for earning back on restaurant and bar spending? I'm out several nights a week."` ("money back" narrows the seed's "most back" to cash back, which tilts against points cards)
6. `[44] ecosystem / - - REWORD paraphrase p3 -> "What airline transfer partner should go with my American Express for booking trips to Europe?"` (it dropped "transfer"; "airline partner" can be read as a co-brand airline card)
7. `[4] category_education / - - REWORD paraphrase p1 -> "Could you explain the main types of credit cards and what benefits set them apart? Also, is having one necessary?"` ("main credit card options" invites a product list instead of kinds)
8. `[4] category_education / - - REWORD paraphrase p8 -> "Which types of credit cards exist, and what does each type offer? And do I actually need one?"` ("choices ... benefit you differently" is vague and in the generic second person)
9. `[33] churn_triggers / Lounges overcrowded lately - REWORD paraphrase p2 -> "The crowds at American Express lounges have been spoiling my visits recently. Is it time to move on, or should I keep the card?"` ("time to keep the card or switch away" is garbled)
10. `[3] problem_recognition / Dining and going out - REWORD paraphrase p3 -> "Eating out is constant for me, but my credit card barely earns on restaurants and bars. How could I change that?"` ("eating out hasn't helped much" makes no sense)
11. `[24] objections / Not accepted enough - REWORD paraphrase p0 -> "Does American Express still get turned down often enough for that to be a real concern?"` ("turned down in enough places" is garbled)
12. `[9] criteria / Everyday spender - REWORD paraphrase p4 -> "I need to choose one card for most of my routine buying and bill payments. What should I look at, and from there, what should I consider?"` ("what follows as something to consider" is garbled)
13. `[14] use_case / Small business owner - REWORD paraphrase p0 -> "Paying suppliers on a business card should be straightforward and predictable for me. Which business credit card does that best?"` (the tacked-on "That's all I want..." restates the ask)
14. `[14] use_case / Small business owner - REWORD paraphrase p2 -> "Which business credit card would make paying suppliers easiest in a straightforward, predictable way?"` (tacked-on restated tail)
15. `[14] use_case / Small business owner - REWORD paraphrase p8 -> "Which business credit card would make my supplier payments most straightforward and predictable, without hassle?"` (tacked-on restated tail)
16. `[14] use_case / Small business owner - REWORD paraphrase p5 -> "Which business credit card does the best job of making my supplier payments straightforward and predictable?"` (redundant "when I pay on a business card")
17. `[28] pricing / Small business owner - REWORD paraphrase p8 -> "For paying suppliers and keeping expenses separate, is the American Express Business Gold Card a worthwhile choice over more affordable credit cards?"` ("how does it stack up" asks for a comparison, not the call)
18. `[28] pricing / Small business owner - REWORD paraphrase p4 -> "Would the American Express Business Gold Card be worth it over more affordable credit cards if my needs are supplier payments and keeping expenses separate?"` (awkward double question)
19. `[29] pricing / Premium luxury seeker - REWORD paraphrase p2 -> "For a frequent traveler who accepts paying for perks, is the American Express Platinum Card worth it over more affordable credit cards?"` ("make more sense ... as a worthwhile pick" is garbled)
20. `[30] pricing / Dining and going out - REWORD paraphrase p3 -> "I eat at restaurants several times a week; is the American Express Gold Card worth it over more affordable credit cards?"` ("a better worth-it choice" is garbled)

## 2. Cells with no edits

31 cells: 0, 1, 2, 5, 6, 7, 10, 11, 13, 15, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 45.

## 3. Battery-level notes

- **Use-case seeds restate the room (row 6, your call):** [13] Everyday ("one card for groceries, gas, and monthly bills without thinking") and [15] Premium ("travel a lot, don't mind a big annual fee if it makes trips smoother") ask nearly the same question as the Discovery seeds in their columns ([5] and [7]). Neither names a single concrete outcome. Rewording either seed means redrawing its paraphrases, so this is a redraw decision rather than an edit. [13] also lifts its spending list from the room's writer feed ("groceries, gas, dining, and monthly services"), which the room description itself does not state.
- **Small business Discovery [6]:**
  - The seed starts lowercase ("we're a small shop").
  - Every paraphrase adds "first", "to start" or "shortlist", which the seed lacks.
  - Neither breaks the measurement. Capitalize the seed if you touch it, and decide whether "first" is acceptable drift for the Discovery formula; if it is not, the cell needs a redraw.
- **Criteria softening is widespread but within your ruling:** about two-thirds of the 36 criteria paraphrases join the two asks with a plain "and" or "then" instead of a dependent connector. That is quality only. Only [12] p8 actually lost the second ask (edit 1). The four criteria seeds are also comma splices ("...bills, what should I look at, and given that..."); this is cosmetic.
- **The Dining column invents "shows":** the room says the buyer "eats out and goes out". The Discovery cell [8] narrows that to shows in the seed and all 9 paraphrases, while Criteria, Use-case and Value stay with eating out and tabs. It is harmless for the measurement, but it is the one column detail no room text supports.
- **Value [27]:**
  - The seed reads "is American Express Gold Card worth it", missing "the". This is cosmetic.
  - The Gold Card is the Value line in both the Everyday and Dining rooms. If you want the two columns to read different value questions, change the line at the coverage map; otherwise the Everyday room is a second Gold Card read.

## 4. Totals

- Cells reviewed: 46
- Paraphrases reviewed: 409
- DROPs: 0
- Paraphrase REWORDs: 19
- Seed REWORDs: 1

---

# Prompts-gate edit review - Netflix live draft (2026-10-09)

Source: `live_netflix.txt` (served 2026-10-09T19:45Z). Standard: STAGE_CONTRACT.md plus the owner's rulings in force. Calibration: `para_audit_p31_served_netflix.md`. The live paraphrases differ from the p31 audit roll, so every cell was read fresh.

Every seed meets its contract row, and the brand rules hold in all 35 cells: blind cells name no tracked brand, every Value paraphrase keeps "Netflix Standard" and the generic counterpart, comparisons name only the pair, offensive alternatives name only the rival, and the defensive cell keeps the leave conditional in 9 of 9. No criteria paraphrase drops either part of the ask.

## 1. Edits to make

Measurement items (the doubt subject, the asker, the choice or the ask is changed):

1. [23] churn_triggers / Password rules feel unfair - REWORD paraphrase p4 -> "Netflix's password rules strike me as unfair. Since I subscribe, would you keep it or drop it?"
2. [24] churn_triggers / Too many repetitive ads - REWORD paraphrase p8 -> "The same ads keep playing on my Netflix ad plan. Would you stay with it or switch?"
3. [3] discovery / Long-series binge - REWORD paraphrase p1 -> "We're planning to stick with one long show from start to finish over a month. What streaming services should we look at?"
4. [3] discovery / Long-series binge - REWORD paraphrase p3 -> "What streaming services should we check for our plan to watch one long show continuously for a month?"
5. [3] discovery / Long-series binge - REWORD paraphrase p4 -> "Which streaming services should we consider looking into if the plan is to watch a single long show straight through for a month?"
6. [3] discovery / Long-series binge - REWORD paraphrase p5 -> "We're setting aside a month to make it through one long show in order; which streaming services should we look at?"
7. [3] discovery / Long-series binge - REWORD paraphrase p6 -> "For watching one lengthy show from beginning to end over a month, what streaming services should we explore?"
8. [3] discovery / Long-series binge - REWORD paraphrase p7 -> "One long show, watched straight through across a month, is the plan. Which streaming services should we put on our radar?"
9. [3] discovery / Long-series binge - REWORD paraphrase p8 -> "Can you suggest which streaming services we should review for a month-long run through one long show?"
10. [9] use_case / Budget reset month - REWORD paraphrase p1 -> "It's a tight month and we'll keep one app. Which service is best for having tons to watch without taking on another subscription?"
11. [9] use_case / Budget reset month - REWORD paraphrase p4 -> "We're only keeping one app right now because it's a tight month. What service is best for plenty to watch without adding a subscription?"
12. [9] use_case / Budget reset month - REWORD paraphrase p3 -> "For this tight month, we're down to one app and don't want another subscription. Which service is best for still having a ton to watch?"
13. [9] use_case / Budget reset month - REWORD paraphrase p7 -> "Tight month, so we're pausing the extra apps and keeping one. Which service best keeps us supplied with things to watch without another subscription?"
14. [9] use_case / Budget reset month - REWORD paraphrase p2 -> "We need to cut back this month and keep only one app for now, but still have lots to watch. Which service delivers that best?"
15. [31] renewal / Shows disappear too fast - REWORD paraphrase p0 -> "My Netflix renewal is coming up, and lately shows keep vanishing on me. Is it worth renewing or should I leave?"
16. [18] pricing / Kids-first household - REWORD paraphrase p2 -> "Given that the kids will use profiles daily, would you say Netflix Standard is worth it over cheaper video streaming services?"
17. [8] use_case / Kids-first household - REWORD paraphrase p6 -> "Which streaming service best lets my 7-year-old find something to watch without adult stuff or me hovering?"
18. [11] use_case / Long-series binge - REWORD paraphrase p7 -> "We want to watch one long series from beginning to end next month, with no gaps and no switching services. Which streaming service is the right pick?"

Why each one matters:
- Item 1: "password requirements" reads as password complexity, a different worry from the sharing rules the seed means.
- Item 2: "switch away from Netflix's ad plan" turns the stay-or-leave choice into a plan upgrade inside Netflix, and the hypothetical "if" weakens the claim.
- Items 3-9: the seed and its room speak as a household "we". Seven of nine paraphrases turn it into a solo "I". Owner's ruling: that is a change of asker.
- Items 10-14: the use-case must-keep is the which-is-BEST ask. p1 also asks which service has "enough" rather than "tons". p2, p3, p4 and p7 drop "best", so any qualifying service answers them.
- Item 15: "while I'm watching" adds a mid-watch glitch to the doubt.
- Item 16: "worth more than" asks which is more valuable, not whether Standard is worth its price.
- Item 17: "How well does each..." adds a per-service rundown ask in front of the pick, and it drops "my".
- Item 18: "pauses between services" garbles "no gaps or switches".

Quality items (garbled, formal, engine-ish or duplicate wording a reader would notice):

19. [33] ecosystem / - REWORD paraphrase p8 -> "Our household has Netflix already - what pairs well with it for easy online watch parties with friends?"
20. [33] ecosystem / - REWORD paraphrase p6 -> "We're subscribed to Netflix. What could we add to make online watch parties with friends easy to set up?"
21. [33] ecosystem / - REWORD paraphrase p7 -> "With Netflix in our household, what's a good companion for easy online watch parties with friends?"
22. [33] ecosystem / - REWORD paraphrase p5 -> "Netflix is already part of our subscriptions; what would go well alongside it for low-fuss online watch parties with friends?"
23. [24] churn_triggers / Too many repetitive ads - REWORD paraphrase p3 -> "Netflix's ad plan, which I'm on now, keeps showing me the same ads. Do I stay or switch away?"
24. [25] alternatives / defensive - REWORD paraphrase p1 -> "What video streaming service could we try instead of Netflix if we leave? We've been with it a while."
25. [28] alternatives / Max - REWORD paraphrase p5 -> "I'm leaving Max; where should I turn for streaming now?"
26. [28] alternatives / Max - REWORD paraphrase p7 -> "What's a good streaming replacement for Max? I'm leaving it."
27. [27] alternatives / Amazon Prime Video - REWORD paraphrase p3 -> "We're leaving Prime Video. What should replace it for streaming?"
28. [4] criteria / Kids-first household - REWORD paraphrase p5 -> "Our kids are going to use the streaming service daily. What should we examine, and from there, what should we think about?"
29. [4] criteria / Kids-first household - REWORD paraphrase p3 -> "As we pick a streaming service for everyday use by the kids, what should we check, and given that, what should we consider next?"
30. [5] criteria / Budget reset month - REWORD paraphrase p2 -> "We're sorting through our streaming bills to decide what remains and what we rotate; what should we look at, and from there, what should we consider?"
31. [5] criteria / Budget reset month - REWORD paraphrase p4 -> "While we review our streaming bills and decide what to keep or rotate, what should we look at first, and after that, what should we consider?"
32. [17] premium_worth / - REWORD paraphrase p6 -> "Do premium video streaming services justify paying more than cheaper options, or can the cheaper ones be enough?"
33. [17] premium_worth / - REWORD paraphrase p5 -> "For video streaming services, should someone go premium, or are the cheaper services good enough?"
34. [20] pricing / New home setup - REWORD paraphrase p3 -> "New place, first service to choose: is Netflix Standard worth the price over more affordable video streaming services?"
35. [14] comparison / Amazon Prime Video - REWORD paraphrase p8 -> "Head-to-head for streaming: Amazon Prime Video or Netflix - which one should I choose, and why?"
36. [12] social_validation / - REWORD paraphrase p1 -> "Which streaming services do people recommend most or swear by?"
37. [10] use_case / New home setup - REWORD paraphrase p7 -> "We just moved in, and after work we'd like to choose something together without endless scrolling. Which streaming service makes that easiest?"
38. [2] discovery / New home setup - REWORD paraphrase p3 -> "We just moved in together and are getting the TV ready - which streaming services should we review as our first options?"
39. [31] renewal / Shows disappear too fast - REWORD paraphrase p2 -> "I use Netflix, and the renewal's near; lately, shows keep disappearing. Is staying subscribed still worthwhile?"

What each quality item fixes:
- Items 19-22: the ecosystem paraphrases drift from the one pairing need to "virtual watch sessions", "remote viewing hangouts", "casual group viewing" and "movie nights".
- Item 23: "serving me repeats" reads as reruns.
- Items 24-27: these announce the stance in engine wording ("leaving is still up in the air", "Leaving Max is settled", "already committed", "the decision is made").
- Items 28-31: "followed by", "checklist to explore", a one-sentence "look at and consider", and "come into consideration".
- Items 32-33: "justify being above" and "just as sufficient".
- Item 34: "make the price worth it".
- Item 35: "belongs in my choice".
- Item 36: "services for streaming".
- Item 37: "Our move just happened".
- Item 38: "Having just moved in together while...".
- Item 39: "dropping away".

## 2. Cells with no edits

15 cells: [0], [1], [6], [7], [13], [15], [16], [19], [21], [22], [26], [29], [30], [32], [34].

## 3. Battery-level notes

- **For you to decide - [24] seed's "stay or switch".** "Switch" can mean leaving Netflix or upgrading to an ad-free Netflix plan. The second reading turns a keep-or-leave read into a within-brand plan change. If you want the churn read clean, reword the seed to "...; stay with Netflix or switch services?" The contract does not force this, which is why it is not in the edit list.
- **Criteria Budget seed [5] uses "and then".** The other three criteria seeds use "given that". Under your ruling that is a quality note only, but aligning it would keep the four cells' dependent ask uniform.
- **The we-to-I shift is confined to one cell.** It affects [3] discovery / Long-series binge in 7 of 9 paraphrases. The binge criteria and use-case cells keep "we". The person-less Value seeds rendered with "I" are not counted, per the convention.
- **Softened "best" in use-case is concentrated in the Budget cell [9],** 5 of 9 paraphrases. Elsewhere it shows up once at most. The pattern is the same one the p31 audit flagged, landing in a different cell on this roll.
- **Offensive alternatives keep a decided move and name only the rival in 36 of 36.** The edits there are register only: engine-voiced "decision is made" announcements.

## 4. Totals

- Cells reviewed: 35
- Paraphrases reviewed: 310
- DROPs: 0
- Paraphrase REWORDs: 39 (18 measurement, 21 quality)
- Seed REWORDs: 0

---

# Prompts-gate edit review - Google Pixel (live draft, 2026-10-09)

Source: `live_google_pixel.txt` (42 cells, as served in prod). Judged against STAGE_CONTRACT.md and the owner's rulings in force. This roll's paraphrases differ from the p31 audit roll; the audit was used for calibration only.

## 1. Edits to make

Measurement-breaking first (1-8), then quality items a reader would notice (9-25).

1. `[10] criteria / Midrange value hunt - REWORD paraphrase p2 -> "With my budget fixed and phone deals showing up across stores, I'm deciding between a new mid-priced phone and a discounted last-year flagship. What should I assess first, and on that basis, what should I consider?"` ("and then what?" drops the consider ask - row 4, one part only)
2. `[10] criteria / Midrange value hunt - REWORD paraphrase p0 -> "I've got a firm budget and see deals at different stores: new mid-priced phone or discounted last-year flagship. What should I look at first, and from there, what should I consider?"` ("what follows?" drops the consider ask)
3. `[10] criteria / Midrange value hunt - REWORD paraphrase p1 -> "I'm looking at store deals with a firm budget, split between a discounted last-year flagship and a new mid-priced phone. What should I look at first, and what should I consider after that?"` ("what's my first consideration, and what should follow it?" - neither ask survives intact)
4. `[11] criteria / First phone for teen - REWORD paraphrase p3 -> "There are some rules for my teen's first phone. What should guide my search, and from there, what should I consider?"` ("after looking at the options" turns the first ask into browsing products)
5. `[12] criteria / Friends and family photos - REWORD paraphrase p8 -> "I take most of our family's photos and videos on my phone, and I need to replace it. What should I look for, and what should I factor in afterward?"` (asker fact changed: photos "are on my phone" instead of taken by the asker)
6. `[16] use_case / Friends and family photos - REWORD paraphrase p8 -> "I need a phone for my family-photographer duties: sharp low-light photos of kids who are moving fast. Which one does that best?"` ("which one should I look at?" is Discovery's ask, not the which-is-best ask)
7. `[29] pricing (Value) / Midrange value hunt - REWORD paraphrase p4 -> "While comparing midrange options with last year deals on a tight budget, is Pixel A worth it over more affordable smartphones?"` ("worth more than" asks about value ranking, not worth-its-price)
8. `[2] problem_recognition / First phone for teen - REWORD SEED -> "My teenager keeps borrowing my phone and disappears into it for hours; what's a real way out of this?"` (row 1: "how do we set better limits" fixes the type of way out to a parenting rule, so the answer can't route to the category; the seed must ask for a way out and invite solutions or products. Owner's call: a seed edit means redrawing this cell's 9 paraphrases, which all carry "limits")
9. `[22] objections / Still too buggy - REWORD paraphrase p3 -> "Am I overthinking this, or is it fair to worry that Google Pixel is still too buggy?"` (garbled: "is Google Pixel still too buggy a fair concern?")
10. `[28] pricing (Value) / Plan promo shopper - REWORD paraphrase p8 -> "My plan contract is up and I'm at my plan's store; is Google Pixel worth the money compared with more affordable smartphones?"` (garbled: "has run its course and I'm at its store")
11. `[28] pricing (Value) / Plan promo shopper - REWORD paraphrase p7 -> "At my plan's store, now that my contract is over, should I pay for Google Pixel rather than choose more affordable smartphones?"` (formal: "no longer in force")
12. `[12] criteria / Friends and family photos - REWORD paraphrase p0 -> "I use my phone for most of our family's pictures and videos, and now need to replace it. What should I look at first, and from there, what should I consider?"` ("look at first, then consider?" - one what, consider has no object)
13. `[12] criteria / Friends and family photos - REWORD paraphrase p2 -> "I shoot most of our family photos and videos on my phone, and I'm ready to replace it. What should I pay attention to, and given that, what should I consider?"` (same merged shape, plus "Because I shoot ... I'm ready to replace it" causality)
14. `[12] criteria / Friends and family photos - REWORD paraphrase p6 -> "My phone is up for replacement, and I take most of our family pictures and videos on it. What should I look at, and based on that, what should I take into consideration?"` (merged ask; "are taken by me on it" passive and clumsy)
15. `[12] criteria / Friends and family photos - REWORD paraphrase p5 -> "I take most of our family's photos and videos with my phone, and it's time for a new one. What should I examine first, and what should come next to consider?"` ("time for a new phone because I take most of our photos" - wrong causality)
16. `[11] criteria / First phone for teen - REWORD paraphrase p2 -> "I need a first phone for my teen and have some rules in mind; what should I focus on first, and given that, what should I consider?"` ("focus on first, then consider?" - merged, reads garbled)
17. `[11] criteria / First phone for teen - REWORD paraphrase p5 -> "I'm looking for my teen's first phone, and we'll have some rules. What should I start by checking, and after that, what should I consider?"` (garbled: "followed by what I should consider")
18. `[31] pricing (Value) / Friends and family photos - REWORD paraphrase p3 -> "I take most of our household pictures and videos. Is Google Pixel Pro worth the added cost over more affordable smartphones?"` ("mine to manage" drifts to organizing/storing photos)
19. `[13] use_case / Plan promo shopper - REWORD paraphrase p6 -> "My phones stay with me four years or more. Which smartphone will continue to feel smooth and reliable that long?"` (awkward: "my four-years-or-more phone cycle")
20. `[14] use_case / Midrange value hunt - REWORD paraphrase p7 -> "My budget has a hard limit. Comparing a new midrange phone with last year's flagship on sale, which one gives the best value for the money?"` ("worth more for the money" garbled)
21. `[15] use_case / First phone for teen - REWORD paraphrase p5 -> "We're buying our teen their first phone and want fewer distractions at school and bedtime, without having to check on it every day. Which smartphone handles that best?"` (formal, adds "settings": "supervise settings on a routine basis")
22. `[7] discovery / First phone for teen - REWORD paraphrase p8 -> "Which phone models should we consider together for our teen's first phone, given that we have ground rules?"` ("consider as a pair" reads like buying two phones)
23. `[39] expansion / - - REWORD paraphrase p2 -> "I'm happy with my Google Pixel. For my next trip, should I skip carrying a separate camera and shoot everything on the Pixel?"` (awkward: "My Google Pixel has me happy with it")
24. `[40] ecosystem / - - REWORD paraphrase p5 -> "I'm using a Google Pixel; what would you pair it with for keeping tabs on fitness from my wrist?"` (voice slips to "your wrist")
25. `[27] objections / Google watching me - REWORD paraphrase p6 -> "Does a Google Pixel really let Google watch me more, and is that a real privacy risk?"` (label echo, stilted: "the idea that Google watches me more ... backed by")

## 2. Cells with no edits

26 cells: 0, 1, 3, 4, 5, 6, 8, 9, 17, 18, 19, 20, 21, 23, 24, 25, 26, 30, 32, 33, 34, 35, 36, 37, 38, 41.

These were checked and left alone:
- Criteria / Plan promo shopper [9]: "then", "afterward" and "next" joins, which are quality only under the ruling.
- Objections: fact and hearsay voicings in [23], [24] and [26], which the worry ruling allows.
- The defensive cell [34]: its undecided stance is stated plainly, which the ruling allows.
- All four head-to-heads: each keeps "smartphone" or "phones" in 9 of 9, so the p31 noun-drop class is absent from this roll.

## 3. Battery-level notes

- **The camera dominates the battery.** Six cells sit on the camera:
  - Problem recognition / Plan promo shopper [0] (the camera is slow to open);
  - Problem recognition / photos [3];
  - Use-case / photos [16];
  - the "Missed kid moments" worry [23];
  - Expansion [39] (shooting a trip on the phone);
  - Value Pro [31].

  [0] is defensible as a lag pain, and the promo room's use-case cell [13] is about staying smooth. Still, the photos room owns the camera under s53. Owner's call: re-root [0] in general slowness (for example, apps freezing on open). That is a seed edit plus a redraw.
- **The Midrange value hunt room asks one dilemma four times.** Discovery [6], Criteria [10], Use-case [14] (owner-edited seed) and Value [29] all restate "new midrange vs discounted last-year flagship". The use-case seed is close to Discovery's question with "best overall value" as the outcome. Row 6 allows this in a terms-defined room under s53, so keep it or not as you prefer. Separately, Discovery [6]'s seed "discounted last year high-end" is ungrammatical, and p0-p5 copy it. If you touch the seed, change it to "last year's discounted high-end".
- **Battery life comes up three times:** problem recognition [1] (blind), the objection [24] and advocacy [41]. Advocacy overlapping the objection is by design (row 18). No edit.
- **The offensive alternatives [35]-[38] use one paraphrase template across all four rivals.** It reads uniform but is clean for measurement: every paraphrase states a bare move, names the rival only and keeps "smartphone".
- **Criteria sequence joins:** about 10 of the 36 criteria paraphrases still join the two asks with "then", "next" or "afterward". Only the ones that read merged or garbled are listed above. The rest are quality notes under the ruling.

## 4. Totals

- **Cells reviewed:** 42
- **Paraphrases reviewed:** 373
- **DROPs:** 0
- **Paraphrase REWORDs:** 24 (7 measurement-breaking, 17 quality)
- **Seed REWORDs:** 1 ([2], row 1; needs a redraw of that cell's paraphrases)

---

# Doritos (bagged chips) - prompts-gate edit review, live draft 2026-10-09

Source: `live_doritos.txt` (35 cells, 310 paraphrases, no owner edits yet). Standard: STAGE_CONTRACT.md plus the owner's rulings in force. This is a different roll from the p31 served audit: that audit's four S2s (pit-stop single-serve drops, weekly use-case "make sense") are NOT present here - single-serve, snack-size and big bags survive in every paraphrase of their rooms, and the weekly use-case cell keeps "everyone likes" in 9 of 9.

## 1. Edits to make

1. `[17] premium_worth / -` - REWORD SEED -> "In bagged chips, are the premium brands actually better than the cheaper or store ones, and which would you pick?" (row 9: seed must invite named picks; the current seed and all 9 paraphrases ask only the tier verdict, so "brands named at each end" cannot be read - redraw the paraphrases after the reword)
2. `[4] criteria / Weekly household stock-up` - REWORD paraphrase p4 -> "I'm doing my weekly grocery run and getting a couple bags of chips for the house. What should I focus on first, and based on that, what should I weigh next?"
3. `[6] criteria / School lunch bagger` - REWORD paraphrase p3 -> "I'm buying snack-size chips for school lunches this week. What should I look at first, and from there, what comes next to consider?"
4. `[4] criteria / Weekly household stock-up` - REWORD paraphrase p2 -> "On my weekly grocery run I'm grabbing a couple bags of chips for the house. What should I look at first, and from there, what's the next thing to consider?"
5. `[5] criteria / On-the-go pit stop` - REWORD paraphrase p3 -> "I'm making a quick stop for a single-serve bag to eat in the car. What should I look for in chips, and once I know that, what should I take into account?"
6. `[1] discovery / On-the-go pit stop` - REWORD paraphrase p4 -> "I'm making a quick pit stop and want a single-serve bag to eat now. Which bagged chips should I consider?"
7. `[26] alternatives / defensive` - REWORD paraphrase p8 -> "Doritos make up most of my chip buys. If I take a breather from them, what bagged chips could replace them?"
8. `[19] pricing / On-the-go pit stop` - REWORD paraphrase p0 -> "During a quick convenience-store stop for a single-serve, is Doritos worth the extra over more affordable bagged chips?"
9. `[19] pricing / On-the-go pit stop` - REWORD paraphrase p6 -> "For my single-serve at this convenience stop, is Doritos worth the higher price over affordable bagged chips?"
10. `[20] pricing / School lunch bagger` - REWORD paraphrase p4 -> "I'm stocking up on snack-size packs for school lunches. Would Doritos be worth the extra cost over cheaper bagged chips?"
11. `[21] pricing / Game night host` - REWORD paraphrase p2 -> "I'm getting big bags for guests at game night; is Doritos worth the higher price over cheaper bagged chips?"
12. `[24] churn_triggers / Too processed to feel okay` - REWORD paraphrase p5 -> "I still think Doritos taste great, but lately they feel too processed - should I stick with them or quit?"
13. `[7] criteria / Game night host` - REWORD paraphrase p7 -> "I'm hosting game night and stocking a few big bags of chips with a variety of flavors. What should I look at, and based on that, what should I weigh?"
14. `[4] criteria / Weekly household stock-up` - REWORD paraphrase p0 -> "I'm doing my weekly grocery run and want a couple bags of chips for the house - what should I check out first, and from there, what should I consider?"
15. `[4] criteria / Weekly household stock-up` - REWORD paraphrase p1 -> "A couple bags of chips for home are on this week's grocery list. What should I look at first, and based on that, what should I consider afterward?"
16. `[5] criteria / On-the-go pit stop` - REWORD paraphrase p2 -> "I'm stopping quickly to get a single-serve bag for eating in the car. With chips, what should I look at first, and from there, what should I consider?"
17. `[5] criteria / On-the-go pit stop` - REWORD paraphrase p6 -> "I'm getting a single-serve bag to eat in the car during a quick stop; for chips, what should I check for first, and with that in mind, what should I consider?"
18. `[6] criteria / School lunch bagger` - REWORD paraphrase p1 -> "Snack-size chips for school lunches this week are on my list; what should I seek out first, and from there, what should I take into account?"
19. `[6] criteria / School lunch bagger` - REWORD paraphrase p6 -> "I'm getting snack-size chips for this week's school lunches. What should I start by looking for, and based on that, what should I consider?"
20. `[6] criteria / School lunch bagger` - REWORD paraphrase p8 -> "What should I check out first, and given that, what should I consider next? I'm buying snack-size chips for school lunches this week."
21. `[7] criteria / Game night host` - REWORD paraphrase p0 -> "A few big bags of chips, mix of flavors, are what I'm stocking for game night. What should I look for, and from there, what should I take into account?"
22. `[8] use_case / Weekly household stock-up` - REWORD paraphrase p6 -> "Home for the week, I'm after a couple bags everybody likes. What bagged chips would you say do that best?"
23. `[10] use_case / School lunch bagger` - REWORD paraphrase p8 -> "For school lunches, which bagged chips are a good bet if I want the kids to finish their snack-size bags?"
24. `[3] discovery / Game night host` - REWORD paraphrase p7 -> "I'm hosting game night, so I'm after a handful of large bags with different vibes. Which bagged chips should I scout out?"

Why, for the non-obvious ones:
- 2-5: one-part criteria asks. Each asks only the second part ("what's next to consider once I've figured out what to look at", "what should I focus on next after looking at the options") and presupposes the first; 2 and 3 also say "the options", which reads as products. Row 4: never ask only one of the two parts.
- 6: "What should I consider?" with no "which chips" reads as the Criteria ask in a Discovery cell (row 3).
- 7: "Should I take a breather from them, and ..." turns the conditional break into a should-I-leave question - the inverted-conditional class from p30, which mixes the churn read into the defensive one.
- 8-11: "is Doritos worth more than cheaper chips" asks which is more valuable, not whether the premium is worth paying; an engine can answer "yes, it's a better chip" without making the price call.
- 12: ends as a statement ("has me wondering whether to stick with them"); no question is put to the engine.
- 13-21: quality only. Each ends on a bare verb or a double question ("then consider?", "consider next?", "what should I look at and then weigh?" after a first question). The rewords also put the dependent second ask back - School carried it in 1 of 9 before (p0 "after that").
- 22-24: garbled ("At-home for the week"), awkward conditional ("if the kids should finish"), engine-ish ("different kinds of appeal").

## 2. Cells with no edits

21 cells: 0, 2, 9, 11, 12, 13, 14, 15, 16, 18, 22, 23, 25, 27, 28, 29, 30, 31, 32, 33, 34.

Checked and clean: every head-to-head names both brands and asks for the pick, with no situation added (Cheetos' seed "which one wins" counts as the pick ask); every offensive alternative states a decided move off the rival, keeps the category noun and does not name Doritos; churn cells keep the doubt, the brand and stay-or-leave; the remaining defensive paraphrases are conditional and undecided; repertoire keeps habit plus stick-or-switch in 9 of 9; expansion keeps party-size weekly; ecosystem keeps the one dip need; advocacy keeps the friend and "overrated". No brand-rule violations anywhere.

## 3. Battery-level notes

- **Premium vs basic needs a decision, not just an edit.** The seed asks only "are premium ones better or are cheaper good enough", so the cell cannot produce the second half of its read (which brands sit at each end). After rewording the seed, redraw the cell rather than hand-editing 9 paraphrases.
- **Criteria wording is the weakest family.** 4 one-part asks (cells 4, 5, 6) plus 9 bare-verb endings; School criteria carries the dependency in only 1 of 9. If the rewords above are applied, all 36 criteria paraphrases ask two parts and most carry a dependent connector.
- **Discovery "first" ordering.** The weekly cell asks "which should I check out first" in 5 of 9 (p0, p3, p5, p7, p8) and School in 4. It nudges toward a ranked answer; harmless for the headline (rank is read anyway), left unedited.
- **"Worth more than" is back in Value** (4 paraphrases across three rooms). It was 0 on the p31 audit; worth watching as a roll-to-roll class.
- **Comparison/alternatives roster.** Head-to-heads and offensive alternatives run Takis, Cheetos, Lay's, Ruffles - all Frito-Lay sister brands of Doritos except Takis. If the owner wants portfolio routing separated from true rival wins (decision 3c), Tostitos/Fritos are also sister brands, so no other-parent rival besides Takis exists on this roster; consider adding one (e.g. a Kettle-style or store-brand rival) before confirming.

## 4. Totals

- Cells reviewed: 35
- Paraphrases reviewed: 310
- DROPs: 0
- Paraphrase REWORDs: 23
- Seed REWORDs: 1

