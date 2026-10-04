# Room writer - the prompts that write and check rooms (STYLE s35, 2026-10-03)

The current text of every prompt that writes or judges a room, as the model receives it. `${...}` marks values filled in at run time. Source: `src/lib/engine/instrument.ts`.

| Prompt | Model | What it does | Cache key |
| --- | --- | --- | --- |
| Room writer (`readScenarios`) | gpt-5 | Writes 8 rooms: 4 core plus 4 reserve | `scenarios_journeys18` |
| Suggest one (`suggestScenario`) | gpt-5-mini | "Suggest another" on the scenarios gate | `scenario_more5` |
| Near neighbors (`nearScenarios`) | gpt-5-mini | 3 small variants of one room | `scenario_near_pool7` |
| Room check (`checkRooms`) | claude-sonnet-5 (low effort) | Contenders, contested, pitch, capability, platform switch, no-choice flags; failing core rooms are swapped from the reserve | `room_check5` |

The base journey (buying style) is classified first by claude-opus-5 and handed to the room writer as fixed.

## 1. Room writer

**System prompt:**

> Read a purchase market for a research instrument over its buying decision. The market's base decision-structure read is GIVEN below - take it as fixed. Its dimensions:
> [DIMENSION GUIDE - see section 2]
> Return:
> 1) scenarios: EIGHT buying scenarios, ordered most to least central to the market - the first 4 are the core set a strategist would field; the rest are credible alternates a user might swap in. A scenario earns its place ONLY if it changes what a competent advisor would recommend - facts about the decision, never facts about the speaker. Labels are 2-4 plain words naming the buyer or the circumstance the way a strategist would title a slide - never analytical or methodology words like 'default', 'habitual', 'segment', 'use case'. Descriptions ONE short plain sentence. Each scenario is a ROOM: a buyer occasion in this category - who the buyer is and the situation they are in. Describe what is happening, never a list of features or criteria the buyer wants - the answer decides what matters - and never a specific brand or product. A room is CONTESTED: most of the category's leading brands are plausible contenders for that buyer; a room only one product line serves, or one that belongs to a different category, is not this market's room. A room never builds in a platform or ecosystem preference that rules out a leading contender (naming one platform or ecosystem shuts out the brands tied to the others - describe the situation without it), and is never built on switching between competing platforms or ecosystems when the category's leading brands are tied to them (any stated direction rules a leading maker out). A room is a buyer's circumstance, never a product capability or feature (a label that names something the product does, rather than something happening to the buyer, is a capability). Spend the slots on DIFFERENT axes of circumstance (scale, composition, constraint, occasion, recipient), not variants of one.
> 2) per scenario, deviates: true ONLY if that scenario's buyer DECIDES BY A DIFFERENT PROCESS than the base - differing on involvement, verifiability, think_feel, or decision_unit. Judge each scenario fresh from its own facts, dimension by dimension - a real second journey usually differs on ONE or TWO dimensions, and a flip of all four at once is almost always pattern-matching, not reading. A circumstance that changes the answer but not the process - tight budget, compliance constraint, gift deadline - NEVER deviates. A deviating journey must COHERE with the scenario's own words: 'habitual' requires an established default the buyer reaches for without deliberating - a FIRST-TIME adoption is never habitual, however quick, and 'moving fast' alone is not a different process; 'solo' requires the scenario to describe ONE person deciding, not a small team. The DEFAULT is no deviation: most markets have ZERO deviating scenarios; at most one, and only among the first four. When deviates is false, journey just repeats the base values.
> What good looks like - each scenario is a room the client's brand has to win, vivid enough that a strategist would present it by name: a concrete moment, each core room on a different axis, each changing what an advisor recommends, none a demographic. Your market's rooms come from your market.
> Before returning, audit the core four for coverage: rank this market's buying rooms by how much revenue moves through them, ensuring a diverse sampling, and check none of the biggest is missing. In categories sold to organizations, the large-organization purchase is almost always one of them; if a top room is absent it replaces the weakest scenario in the core set. If the market genuinely has a second decision process - a scenario whose buyer decides differently - its room stays in the core set alongside the revenue-ranked ones.

**User message:**

> Category: ${category}
> Audience: ${audience}
> Base read (given): ${the base journey as JSON}

**Only when fielded for one brand** (prod's default read and the cold walk don't use this):

> This instrument is fielded FOR ONE BRAND, named below. Every scenario must be an occasion where that brand genuinely competes - centered on product types it actually sells today. The wording stays brand-blind as ever: describe the circumstance plainly, never name any brand or list wanted features, and keep each room contested - one the brand's rivals compete in too, not one built on the brand's own selling points.

## 2. Dimension guide (inside the room writer, and in the journey classifier and journey-fit advisory)

> - verifiability: HOW quality is judged. spec = checkable BEFORE buying via specs, demos, trials, RFPs, or side-by-side comparison - software and equipment evaluated through demos are spec even when marketed on 'experience' or 'usability'. taste = judged by personal sensory or aesthetic experience of using it (food, fragrance, comfort). trust = credence: quality hard to verify even AFTER purchase (advisory services, audits, supplements' efficacy). When torn between spec and trust for an organization-bought product: if buyers run demos and compare feature sheets, it is spec.
> - involvement: a considered purchase, or habitual/impulse.
> - think_feel: decided mostly rationally, or by identity/emotion.
> - decision_unit: one person, a household, or a committee/team.
> - rhythm: subscription = an ongoing paid plan or engagement that RENEWS BY DEFAULT unless cancelled (SaaS seats, retainers, auto-renewing audits). replenishment = the same consumable rebought as it runs out. one_shot = each purchase is a fresh decision, however often it recurs (projects won case-by-case, device upgrades). The test is who acts at renewal time: default-continue = subscription, re-decide = one_shot.
> - risk: the buyer's dominant worry - performance, financial, social (how it looks), or physical (safety).
> - channel_retail: true when where-to-buy is a real question (retail/DTC goods), false for direct/contracted purchases.

**Still has category examples** (not changed in s35, needs your call): "software and equipment evaluated through demos", "food, fragrance, comfort", "advisory services, audits, supplements' efficacy", "SaaS seats, retainers, auto-renewing audits", "projects won case-by-case, device upgrades", "retail/DTC goods". The inventory treated these as classifier text, but the room writer reads them too. "Device upgrades" may be why every phone walk gets an upgrade room. Removing them also changes the journey classifier (claude-opus-5), so the buying-style reads would need a check before they're trusted.

## 3. Suggest one

> Propose exactly ONE additional buyer situation for a research instrument. A situation earns its place ONLY if it changes what a competent advisor would recommend - facts about the decision, never facts about the speaker. It must be genuinely different from every situation already listed (a different axis of circumstance, not a variant of one). Scenarios describe circumstances, never a specific brand or product. Use Label 2-4 plain words naming the buyer or the circumstance the way a strategist would title a slide - never analytical or methodology words like 'default', 'habitual', 'segment', 'use case'. Description one short sentence.

"Use" is followed by one of these, chosen by who decides:

> committee:
> buyer circumstances for an organizational purchase: scale (team/org size), composition (who has to use it), and constraint (budget tier). 
> household:
> buyer circumstances for a consumer purchase: occasions, recipients (buying for self vs someone else), and constraints (budget, sensitivities). 
> solo:
> buyer circumstances for an individual considered purchase: use-cases, budget tiers, and constraints.

## 4. Near neighbors

> Propose exactly THREE near variants of a given buyer situation for a research instrument. A near variant is the SAME buyer with the SAME need, adjusted - not a new buyer, persona or occasion. Keep the original's wording and change ONE part of the circumstance: a tighter or looser constraint, a different timing or setting, a different scale, or who else is involved - never a list of wanted features. Give each variant its OWN label: a slight change of the original headline that names the adjusted angle, never the original label unchanged. Change a different part per variant and order them closest-first. Each variant should shift what an advisor would emphasize, differ from the others and from everything already listed, and stay about the decision (never the speaker). NEVER introduce a money angle unless the original situation is itself about price. Scenarios describe circumstances, never a specific brand or product. Labels 2-4 plain words, never analytical or methodology words like 'default', 'habitual', 'segment', 'use case'. Descriptions one short sentence.

**User message:** category, audience, the room to vary, and every room already listed (to avoid).

## 5. Room check

> Each buying room below is a buyer occasion in the ${input.category} market. For each room give:
> - contenders: which of these brands are plausible contenders for that room's buyer - ${rivals.join(", ")} - names exactly as given. A brand contends when a buyer in that room would reasonably consider it; it need not be the favorite.
> - pitch: if the room's wording borrows ONE specific brand's own selling-point vocabulary (its signature feature names, taglines or platform labels) instead of the buyer's outcome language, quote that phrase; otherwise an empty string. Buyer outcomes every contender speaks to are not pitch.
> - capability: true when the room is a product capability or feature being adopted rather than a buyer's circumstance (who they are and what situation they are in).
> - platformSwitch: true when the room is about switching between competing platforms or ecosystems - any direction a question must state rules a leading brand out. Moving off an old or homegrown solution is NOT a platform switch.
> - noChoice: true when the room's buyer makes no real choice between products - accepting the next model by default without comparing - so there is nothing for an answer to steer.
> Reply with ONLY JSON: {"rooms": [{"contenders": [...], "pitch": "...", "capability": false, "platformSwitch": false, "noChoice": false}, ...]} - one entry per room, in order.

**User message:** the rooms, numbered, as "label: description". The rivals list is the tracker's direct rivals (the head-to-head picks plus the bench).

## What s35 removed from these prompts

| Prompt | Removed | Now says |
| --- | --- | --- |
| Room writer, labels | 'Solo founder pick', 'Enterprise procurement' | the way a strategist would title a slide |
| Room writer, room definition | 'existing carrier customer upgrading with trade-in credits', 'migrating from a legacy tracker' | who the buyer is and the situation they are in |
| Room writer, platform lock | 'upgrading my Android phone' excludes iPhone buyers - say 'upgrading a phone I've had for years' | naming one platform or ecosystem shuts out the brands tied to the others - describe the situation without it |
| Room writer, capability | 'rolling out roadmaps' is a feature; 'a fast-growing team outgrowing its first tool' is a circumstance | a label that names something the product does, rather than something happening to the buyer, is a capability |
| Room writer, quality bar | the full email-marketing worked example (four rooms with wanted-feature parentheses) | a concrete moment, each core room on a different axis, each changing what an advisor recommends, none a demographic |
| Suggest one / near neighbors | 'migrating from a legacy tracker', not 'migrating from X' | never a specific brand or product |
| Near neighbors, label | 'Carrier trade-in upgrade' -> 'Carrier upgrade at launch' | a slight change of the original headline that names the adjusted angle |
| Near neighbors, money | (lower cost, budget, refurbished, financing, deals) | never introduce a money angle |
| Suggest one, solo template | ecosystem/compatibility constraints | constraints |
| Room check, pitch | "wants the best camera", "needs it running this week" | buyer outcomes every contender speaks to are not pitch |
| Room check, capability | "rolling out portfolio planning", "adopting roadmaps" | (removed) |
| Room check, platform switch | leaving one phone platform for another, moving between app ecosystems; legacy or homegrown tool | moving off an old or homegrown solution is not a platform switch |
| Room check, no choice | auto-renewing, taking whatever is in stock | accepting the next model by default without comparing |

## Category-shaped instructions still in the room prompts (not examples - your call)

- "In categories sold to organizations, the large-organization purchase is almost always one of them" - forces an enterprise room into every B2B core set.
- The platform-switch rules - written for phones; inert elsewhere.
- Suggest one's committee template: "scale (team/org size), composition (who has to use it), and constraint (budget tier)".
- Room check, no-choice: "accepting the next model by default" - leans toward devices.
