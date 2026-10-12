# Fixes 1 and 2 - design for review (not built)

Every example is a real seed from the `cold_v5b` walk, numbered as in that walk.

---

## Fix 1 - keep the client's signature strengths out of neutral questions

### The problem

The contract says a feature screen, a use-case job or a blind cell must never hinge on something chosen because it suits the client. Today that's an instruction to the writer and the checker. The writer keeps picking the client's own strength anyway, and when a seed is rejected, the rewrite often swaps in another one.

| brand | seed | the strength it hinges on |
| --- | --- | --- |
| Pixel | [15] feature screening: "Which current models promise the longest OS and security update support?" | Pixel's lead claim (years of updates) |
| Pixel | [22] social validation: "...stays fast and keeps getting updates for years. Name a few" | same |
| Jira | [17] feature screening: "...which project management tools have native Scrum boards?" | Jira's signature capability |
| AmEx | [21] use-case: "...want dependable airport lounge access on long layovers" (a rewrite of a rejected "transfer partners" seed) | Centurion lounges, then a second AmEx strength |
| Netflix | [12] use-case: "...a one-person plan that keeps recommending shows I'll actually like" | Netflix's recommendation engine |
| Doritos | [13] social validation: "...brands get rave reactions, with big flavor, stay crunchy" | "For the Bold" |

### The design

1. **A short strengths list per tracker.** When the brand profile is built (the market step), one extra cached model call lists the 3-6 things this brand is specifically known for, compared with its rivals: its signature features and claims. Draft lists the call would likely return:
   - Pixel: years of OS updates, AI photo editing, call screening, stock Android.
   - Jira: Scrum and Kanban boards, issue workflows, Confluence and Bitbucket integration, the Marketplace.
   - AmEx: Centurion lounge access, Membership Rewards transfer partners, travel and dining credits, service.
   - Netflix: personalized recommendations, originals, whole-season drops, international catalog.
   - Doritos: bold flavor, nacho cheese, crunch.
2. **Shown at the market step** as a small editable list ("Your known strengths - we keep these out of neutral questions"). You can remove one that's really category table stakes, or add one the model missed.
3. **Enforced by the checks:**
   - The design check for blind stages, feature screens and use-case jobs gets the list and rejects a seed that hinges on one item.
   - Every rewrite instruction carries the list, so a rejected seed can't swap in another item from it.

### What it would change

| seed | today | after |
| --- | --- | --- |
| Pixel [15] | "longest OS and security update support" | rejected; rewritten to a commonly screened capability, e.g. "which have IP68 water resistance" (not on Pixel's list) |
| Jira [17] | "native Scrum boards" | rejected; e.g. "which have built-in time tracking" |
| AmEx [21] | lounge access | rejected, and the rewrite can't pick transfer partners either |
| Netflix [12] | "keeps recommending shows I'll like" | rejected; e.g. "has the most new movies each month" |
| Doritos [13] | "big flavor" | rejected; the criteria list removed |

### The call you need to make: strictness

Some strengths are shared. Lounge access is also a Chase Sapphire Reserve and Capital One Venture X feature, and "years of updates" is also a Samsung claim. Two options:
- **A (my recommendation).** The list holds only claims that point answers at the client specifically. A strength several rivals also lead with ("lounge access" across premium cards) stays allowed, and you can prune it at the market step.
- **B.** Anything the client markets heavily is excluded, even if rivals share it. Safer against bias, but it bans common, legitimate screens.

**Cost:** one cached call per tracker plus a slightly longer design check. No STYLE bump - the list is request data (the design line carries it), so it self-versions.

---

## Fix 2 - use-case jobs that are real jobs, and distinct

### The problem

The contract says Use-case fit asks for one pick for ONE concrete job. The writer often produces something that isn't a distinct job:

| brand | seed | what it really is |
| --- | --- | --- |
| Jira | [18] "Which project management software would you pick to standardize workflows across all teams?" | the room restated (Company-wide consolidation) |
| Jira | [19] "...pick to migrate our old issues, including comments and attachments" | the feature screen [15] (bulk import) again |
| AmEx | [19] "...mainly to issue employee cards with individual spending limits" | the feature screen [15] word for word |
| AmEx | [21] "...dependable airport lounge access" | the feature screen [17] (lounge access) again |
| Pixel | [18] all-day battery, and [19] "battery life is the priority" | the same job twice |
| Doritos | [9] and [12] "sheet pan nachos" | the same job twice |
| Doritos | [10] "pick one tortilla chip to be the main bowl" | no job at all |
| Netflix | [9] "my main nightly watch after canceling cable" | the room (Discovery's question) |

For credit cards and phones, the writer reads "job" as "feature".

### The design

1. **A sharper definition**, in the writer rule, the hint and the seed check:
   - A job is something the buyer is trying to get done in their life or work, described without naming a product feature.
   - Test: could you state it without a capability word?
     - "keep tabs on what five employees spend each month" is a job; "employee cards with spending limits" is a feature.
     - "pay off a $4k balance this year" is a job; "0% balance transfer" is a feature.
     - "get usable photos of my kids running around indoors" is a job; "night mode" is a feature.
2. **A battery check, like the existing worry-diversity pass.** One labeling call names each use-case cell's job in 2-5 words. A cell is regenerated (one steered retry) when its job:
   - repeats another use-case job;
   - restates its own room; or
   - is the same thing its column's feature screen asks about.

### What it would change

| seed | today | after (illustrative) |
| --- | --- | --- |
| Jira [18] | "standardize workflows across all teams" (= room) | "get every team's status into one weekly update for leadership - which would you pick?" |
| Jira [19] | migrate issues (= feature screen) | "keep shipping during a one-week cutover from the old tracker - which would you pick?" |
| AmEx [19] | employee cards with limits (= feature screen) | "keep tabs on what five employees spend each month - which card would you pick?" |
| Pixel [19] | battery again | "navigate and take photos through a full day abroad without a charger - which phone?" |
| Doritos [12] | sheet-pan nachos again | "something kids will actually eat at a sleepover - which bag?" |
| Doritos [10] | "the main bowl" (no job) | "chips that still taste good after sitting out for the whole game - which bag?" |
| Netflix [9] | "main nightly watch" (= room) | "something to fall asleep to after a long day - which service?" |

### A judgment call worth knowing about

Some rooms make the job and the feature naturally close ("Balance transfer rescue": the job is paying down debt, the screen is a 0% transfer). The check only rejects when they are the same thing, not merely related.

**Cost:** one labeling call per battery plus up to four steered rewrites. This is a writer-rule and check change, so it needs a STYLE bump and redraws seeds; rooms are unaffected.
