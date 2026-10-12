# Init audit v2 - examples and the calls needed (2026-10-03)

**What this is.** A companion to `INIT_AUDIT_V2_2026-10-03.md`.

**Where examples come from.** Every example is a real cell from the new-engine cold walk (`~/Documents/procerno_eval/init_audit_2026-10-03/cold_v2/`), named the way the grid shows it: Stage · Scenario column.

**One caveat up front.** The cold walk script builds scenarios with the brand-aware read (`forBrand`), not the category read the wizard uses by default. The brand-aware read carries an extra line - "its flagship line's occasion must be in the core four" - which matters for problem 3.

---

## Problem 1 - Pricing cells weigh the brand against itself

**Grid stage:** *Pricing / value*, one cell per scenario column.

**The rule as built** (decision 1, writer prompt): "name the client brand, weigh its price against a cheaper option - its own lower tier or plan, or a generic cheaper alternative..." The writer mostly takes the first branch.

| brand | grid cell | the seed | counterpart |
| --- | --- | --- | --- |
| Pixel | Pricing · Carrier trade-in deal | "Debating **Pixel Pro vs the regular Pixel** or a cheaper phone... Pay up for Pro, or save and go cheaper?" | own tier (+ generic tacked on) |
| Pixel | Pricing · Android flagship upgrade | "Is a **Google Pixel Pro worth it over the regular Pixel** or a midrange phone?" | own tier (+ generic) |
| Pixel | Pricing · Midrange value buyer | "Looking at a Google Pixel in the midrange, but **a cheaper phone** would free up cash... Worth it for Pixel, or take the cheaper option?" | generic - the intended shape |
| Pixel | Pricing · iPhone switcher trial | "Is a **Google Pixel Pro worth it over the regular Pixel** or a cheaper Android while I try it out?" | own tier (+ generic) |
| Netflix | Pricing · Family-friendly mainstay | "Is paying for the **ad-free plan** worth it, or should we just take the **cheaper tier**?" | own tier |
| Netflix | Pricing · Budget-driven rotation | "Is the **full ad-free plan** worth it, or just go with the cheaper option?" | own tier |
| Netflix | Pricing · Solo viewer pick | "Is the **ad-free plan** worth paying for me, or better to take the **cheaper plan**?" | own tier |
| Netflix | Pricing · Cord-cutting anchor | "Is Netflix worth paying for, or should we take the cheaper plan **or a no-frills service**?" | both |
| Jira | Pricing · Growing agile team | "35 seats... Is **Jira Standard** worth paying for, or can we **stay on Free**?" | own tier (Free caps at 10 users - impossible option) |
| Jira | Pricing · Enterprise standardization | "Is **Jira Enterprise** worth paying for, or should we stick with **Standard**?" | own tier |
| AmEx | Pricing · Airline loyalist card | "Is **American Express** worth paying for as my airline card, or should I stick with **a no-annual-fee option**?" | generic, but which AmEx card? |
| Doritos | Pricing · Pantry staple restock | "are Doritos worth paying more for, or just grab the **store-brand** tortilla chips?" | generic - the intended shape |

**What it means.**
- An own-tier cell asks "which Netflix plan", and every answer keeps the buyer at Netflix. It can never return "Netflix isn't worth it".
- Doritos and the Pixel midrange cell are the intended measurement: "is the brand worth paying more than a cheaper alternative, for this buyer".

**Options:**
- **A (my recommendation).** The counterpart is always a generic cheaper alternative in the category ("a cheaper phone", "a cheaper streaming service", "a cheaper project tool", "a no-annual-fee card", "store brand"). Own tiers never appear in pricing. Within-brand tier questions are a different measurement; they could become their own optional row later.
- **B.** The generic alternative is the default. The own tier is allowed only when the column's buyer is explicitly choosing a tier, and only if that tier can actually serve them.
- **C.** Keep the current wording, but require at least 2 of the 4 cells to use a generic alternative (a battery-level check).

**Also needed:** when the brand sells several products (AmEx cards), the cell names which one ("the Gold card", "an AmEx travel card"). Otherwise the answer picks one at random.

---

## Problem 2 - Rows in one column ask nearly the same question

**Grid stages:** *Discovery*, *Use-case fit*, *Feature screening* (where present), in each scenario column.

**Pixel, column "Android flagship upgrade":**

| grid cell | seed |
| --- | --- |
| Discovery · Android flagship upgrade | "Upgrading my Android phone to a flagship. I want a great camera, strong battery life, and years of updates. Which ones should be on my shortlist right now? Name a few worth a look." |
| Feature screening · Android flagship upgrade | "Upgrading my Android phone to a flagship. Which current models commit to long software support (at least 6 years of OS and security updates) and have top-tier cameras? Name a few by model." |
| Use-case fit · Android flagship upgrade | "Upgrading to a top Android phone. I want the best low light photos without fuss. What would you pick?" |

**Netflix, column "Family-friendly mainstay":**

| grid cell | seed |
| --- | --- |
| Discovery · Family-friendly mainstay | "we're picking one streaming service as our home base for the kids and us... want a solid kids section we can lock down... which streaming services are actually good for this, name a few to try?" |
| Use-case fit · Family-friendly mainstay | "Looking for a streaming service that can be our family default: kid profiles, solid parental controls, lots of animated movies... Which ones would you pick? name a few." |

All three Pixel cells are "name phones for an Android flagship upgrader who wants camera and updates". The two Netflix cells are the same ask.

**What the stage definitions say today** (`stageLibrary` hints):
- Discovery: "Open category discovery: 'best X for ...' style asks, no brands named."
- Use-case fit: "Situation-first asks describing a concrete need or workflow."
- Feature screening: "Attribute-first asks: which options have a specific capability."

Once every cell carries its scenario's circumstance, all three collapse into "best X for my situation".

**Options:**
- **A (my recommendation).** Give each row a distinct ask the others can't produce:
  - Discovery = the broad which-brands ask in the room, with no criteria listed;
  - Use-case fit = ONE concrete job in that room ("will it handle night photos of a moving toddler?"), asking for the pick for that job;
  - Feature screening = ONE checkable capability ("6 years of updates"), asking which ones have it.

  Plus a battery check that flags two seeds in one column that share most of their words.
- **B.** Merge Use-case fit into Discovery as well (like Shortlist), and keep Feature screening only for spec markets.
- **C.** Keep all three and accept the overlap.

---

## Problem 3 - The room instructions, and what they produced

### The scenario writer's room rule (as built, verbatim)

> Each scenario is a ROOM: a buyer occasion in this category - who the buyer is, the situation they are in, and the outcome they want ('shoots a lot, wants the best camera phone, keeps it for years'). Write it in the buyer's outcome language - the need every serious contender's pitch speaks to - and describe circumstances by what is happening ('migrating from a legacy tracker'), never by a specific brand or product. A room is CONTESTED: most of the category's leading brands are plausible contenders for that buyer; a room only one product line serves, or one that belongs to a different category, is not this market's room. Spend the slots on DIFFERENT axes of circumstance (scale, composition, constraint, occasion, recipient), not variants of one.

Plus, still in the prompt from before:

> What good looks like - each scenario is a room the client's brand has to win... Before returning, audit the core four for coverage: rank this market's buying rooms by how much revenue moves through them...

Plus, only in the brand-aware read the cold walk used:

> This instrument is fielded FOR ONE BRAND... Every scenario must be an occasion where that brand genuinely competes - centered on product types it actually sells today - **and its flagship line's occasion must be in the core four.** The wording stays brand-blind as ever: describe the circumstance in the buyer's outcome language, never name any brand, and keep each room contested...

### The fit advisory's room rule (verbatim excerpt)

> Write it as a ROOM: a buyer occasion in THIS category - who the buyer is, their situation, the outcome they want - in the buyer's outcome language every serious contender's pitch speaks to. Never name the brand or any product, and never build the room from the brand's own selling points; the room must be one the brand's rivals compete in too. A room the brand serves with a product in a DIFFERENT category... is not a missing core room for this study.

### The contest check's instructions (verbatim)

> - contenders: which of these brands are plausible contenders for that room's buyer - <direct rivals> - names exactly as given. A brand contends when a buyer in that room would reasonably consider it; it need not be the favorite.
> - pitch: if the room's wording borrows ONE specific brand's own selling-point vocabulary (its signature feature names, taglines or platform labels) instead of the buyer's outcome language, quote that phrase; otherwise an empty string.

"Contested" = at least half of ALL direct rivals contend.

### What came out - Pixel

| room | description | contest check |
| --- | --- | --- |
| Carrier trade-in deal | "At upgrade time they visit carrier or retail to maximize trade-in and promos, open to any ecosystem..." | 7 of 7 |
| **Android flagship upgrade** | "Upgrading a 2-3-year-old **Android** flagship for top-tier camera, performance, AI features, and long support..." | 5 of 7 - lists iPhone as a contender, yet the room's own word "Android" rules iPhone out of every blind cell in this column |
| Midrange value buyer | "With a $300-$500 budget they want the best everyday camera, battery, and durability..." | 6 of 7 (iPhone not a contender at that price) |
| **iPhone switcher trial** | "Ready to leave iOS they want a premium Android that makes setup and social messaging painless..." | 3 of 7, and names Apple iPhone |

So iPhone, the biggest rival, can win blind answers in only one of Pixel's four columns. Two of the four rooms are Android-only by construction: "Android flagship upgrade" is very likely the "flagship line's occasion" instruction at work. "Camera-first chooser" was in the reserve and would have contested all of them.

### What came out - AmEx, and the contest bar

| room | contest check | auditor's read |
| --- | --- | --- |
| Everyday cash back | 7 of 7 | fine |
| Airline loyalist card | 3 of 7 (amber) | false alarm - premium airline cards are a subset-of-issuers market by structure |
| Dining and grocery max | 3 of 7 (amber) | a real defect, for the wrong reason: "monthly credits that offset an annual fee" is the AmEx Gold card's own mechanism |
| Frequent traveler perks | 3 of 7 (amber) | false alarm (miscount) |

### What came out - Jira and Doritos

- **Jira:**
  - "DevOps-integrated planning" was flagged "Names Azure DevOps" because its description contains the word DevOps - a false positive;
  - "Regulated workflows" got 2 of 8 and should read contested.
- **Doritos:**
  - "Nacho build night" was flagged pitch "Scoops" - the word isn't in the room text (Scoops is a Tostitos line);
  - "Game-day haul" got 3 of 7 because this roster is small craft brands.

**Options for the rooms:**
- **A (my recommendation), several parts:**
  - Drop "its flagship line's occasion must be in the core four" from the brand-aware read; keep "occasions the brand genuinely competes in".
  - Add the platform rule to the room rule: "a room never builds in a platform or ecosystem preference that rules out a leading contender (an 'Android upgrader' room excludes iPhone)".
  - Contest bar: at least half of the head-to-head picks AND at least 2 direct rivals.
  - A pitch flag must quote text that appears in the room (mechanical).
  - Brand names in rooms go through the brand judge before a chip shows.
- **B.** Keep the writer as is and rely only on the chips to catch these at the gate.

---

## Problem 4 - Smaller items that need a call

| # | issue | example | options |
| --- | --- | --- | --- |
| 4a | **One buyer need dominates blind cells** | Pixel: "updates for years" is the stated need in 11 of 21 blind cells and all 4 feature screens - a fair outcome Samsung and Apple also promise, but it is Pixel's lead selling point by repetition | add a battery check: no single need in more than ~1/3 of blind cells (rec.) / accept |
| 4b | **Client pitch still leaks in one habitual room** | Doritos, On-the-go column: "bolder flavor and serious crunch" in three blind cells (Doritos' "For the Bold") | outcome rule needs the client's taglines named in the check (rec.) / accept |
| 4c | **Roster lost the closest rival** | Doritos: Takis absent (the profile re-rolled when its cache key bumped) | the profile prompt names "the rival most often bought instead of the brand" first (rec.) / gate-only |
| 4d | **Parents and renames out of date** | auditors claim GitHub -> Microsoft, Discover -> Capital One, Siete -> PepsiCo, Max -> HBO Max, Apple TV+ -> Apple TV | model knowledge cut-off - show the parent on the chip so the user can correct it (rec.) / leave |
| 4e | **Pricing typed `within_brand`** | all 20 new pricing cells type as the product-mix view, but they are value verdicts | add a `value` question type (rec. if problem 1 goes with A) / keep |

---

## What I need from you

| problem | the call |
| --- | --- |
| 1 | Pricing counterpart: A (generic only), B (generic default, own tier when the buyer is choosing tiers) or C (at least 2 of 4 generic) |
| 2 | Row overlap: A (distinct asks per row + similarity check), B (merge Use-case into Discovery) or C (accept) |
| 3 | Rooms: A (drop the flagship-occasion line, platform rule, new contest bar, mechanical chip fixes) or B (chips only) |
| 4 | yes or no on 4a-4e |
