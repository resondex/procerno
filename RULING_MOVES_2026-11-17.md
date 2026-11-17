# What each ruling moves on screen (measured on the snapshot, 2026-11-17)

How this was measured. The engine (src/) was copied to `scratchpad/rulings/w/` and each ruling was applied there as a switch (`RULING=<n>`, `patch.py`, `patch2.py`) - nothing in the repo changed. With the switch off, the copy reproduces the repo byte for byte on every screen dumped (checked: `base.json` = `base_orig.json`). For each ruling, `dump.mts` computed every screen from the snapshot (`data/dashboard_fixture.db`, view cache off, no API keys, no model calls) and `diff.py` compared it with the switch-off run.

What a 'number on screen' is here. A displayed figure token (47%, <1%, 6.7%, or a bare count inside a sentence), on these screens:
- **Map card (panel)** and **By rival page**: every stat in the stat registry (stat_registry.ts) - everything the cards draw, at once or behind one click.
- **Map cell**: each cell's verdict line. **Map position (claim)**: the claim sentence at the top of each card.
- **Overview**: the casting, the dots, the share-of-picks board and the findings (title, body, bars); finding footnotes are tooltips and are counted apart.
- **Brief (own subject)**: every string of every frame of the tracker's own Brief (rival Briefs not computed).
- **Question type detail (views)**: the Journey payload, the station reasons and the eleven per-type views it mounts (all buyers, plus the buyer filter for headline, value, reasons and awareness). These are payload figures each drawable on that screen; not every one is visible at once.
- **Data page tables**: every cell of every ready-made table. **Data page - Every contest**: the num / leader / 'brings buyers' / 'sends buyers' columns. **Data page - build your own**: three tables built by hand for this check (Value 'Recommends another' by buying situation; premise shares by worry) - counted apart, as no one sees them until they build them.
- Counted apart as **not drawn today**: Map position figures beyond the first, and the position's own condition lists (only the old fallback panels draw them, and every cell on the snapshot has a new panel), and finding footnotes.

A place where only the counts behind a figure change (the percentage shown stays the same) is not counted as a move. Each table lists the 25 largest changed figures per tracker (by points moved); places that appear or disappear (a row that is no longer listed, a sentence no longer written) are counted in the total but not listed. Raw data: `MOVES_raw.json` (every place, before and after, with counts).

## Ruling 2: arguments 'when another brand is picked' = another in-category pick

Today the cards and the argument-lift finding already use in-category picks only; the by-question-type reasons view (reasons.ts) counts an out-of-category pick as 'Picks another', and the findings that compare argument shares by side read that view. Switching the reasons view to in-category picks moves **787 numbers**, all on Question type detail (Question type detail (views) 787). No served Overview finding and no Brief sentence changes on any tracker (the side-comparison findings that read it either do not fire or keep their wording). Largest: Google Pixel room[First phone for teen].reasons.codes[connectivity cover… 50% -> 0%; Google Pixel room[First phone for teen].reasons.codes[ecosystem integrat… 50% -> 100%; Google Pixel room[First phone for teen].reasons.codes[plans contracts].b… 50% -> 0%.

**Sephora** - 91 numbers move in 91 places (Question type detail (views) 91).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[Skin changes].reasons.codes[return policy].byVerdict.headline.other | 60% (49/81) | 64% (49/77) | 4 |
| Question type detail (views) | room[Skin changes].reasons.codes[return policy].byVerdict.headline:use_case.other | 47% (27/57) | 51% (27/53) | 4 |
| Question type detail (views) | room[Skin changes].reasons.groups[group:returns and service].byVerdict.headline.other | 60% (49/81) | 64% (49/77) | 4 |
| Question type detail (views) | room[Skin changes].reasons.groups[group:returns and service].byVerdict.headline:use_case.… | 47% (27/57) | 51% (27/53) | 4 |
| Question type detail (views) | room[Skin changes].reasons.codes[dermatologist clinical brands].byVerdict.headline:use_ca… | 37% (21/57) | 34% (18/53) | 3 |
| Question type detail (views) | room[Skin changes].reasons.codes[ingredients formulation].byVerdict.headline:use_case.oth… | 12% (7/57) | 9% (5/53) | 3 |
| Question type detail (views) | room[Skin changes].reasons.groups[group:formula and results].byVerdict.headline:use_case.… | 12% (7/57) | 9% (5/53) | 3 |
| Question type detail (views) | room[Skin changes].reasons.groups[group:premium brands].byVerdict.headline:use_case.other | 39% (22/57) | 36% (19/53) | 3 |
| Question type detail (views) | room[Skin changes].reasons.codes[dermatologist clinical brands].byVerdict.headline.other | 41% (33/81) | 39% (30/77) | 2 |
| Question type detail (views) | room[Skin changes].reasons.codes[ingredients formulation].byVerdict.headline.other | 15% (12/81) | 13% (10/77) | 2 |
| Question type detail (views) | room[Skin changes].reasons.codes[personalized recommendations].byVerdict.headline:use_cas… | 4% (2/57) | 2% (1/53) | 2 |
| Question type detail (views) | room[Skin changes].reasons.codes[product selection].byVerdict.headline.other | 28% (23/81) | 30% (23/77) | 2 |
| Question type detail (views) | room[Skin changes].reasons.codes[product selection].byVerdict.headline:use_case.other | 32% (18/57) | 34% (18/53) | 2 |
| Question type detail (views) | room[Skin changes].reasons.codes[samples and minis].byVerdict.headline.other | 23% (19/81) | 25% (19/77) | 2 |
| Question type detail (views) | room[Skin changes].reasons.groups[group:formula and results].byVerdict.headline.other | 15% (12/81) | 13% (10/77) | 2 |
| Question type detail (views) | room[Skin changes].reasons.groups[group:loyalty perks].byVerdict.headline.other | 23% (19/81) | 25% (19/77) | 2 |
| Question type detail (views) | room[Skin changes].reasons.groups[group:premium brands].byVerdict.headline.other | 42% (34/81) | 40% (31/77) | 2 |
| Question type detail (views) | room[Skin changes].reasons.groups[product selection].byVerdict.headline.other | 28% (23/81) | 30% (23/77) | 2 |
| Question type detail (views) | room[Skin changes].reasons.groups[product selection].byVerdict.headline:use_case.other | 32% (18/57) | 34% (18/53) | 2 |
| Question type detail (views) | room[Tight month].reasons.codes[drugstore alternatives].byVerdict.headline:use_case.other | 54% (53/99) | 52% (50/96) | 2 |
| Question type detail (views) | view.reasons.groups[group:loyalty perks].byVerdict.headline.other | 59% (260/437) | 61% (258/426) | 2 |
| Question type detail (views) | room[Skin changes].reasons.codes[convenience and locations].byVerdict.headline:use_case.o… | 5% (3/57) | 6% (3/53) | 1 |
| Question type detail (views) | room[Skin changes].reasons.codes[customer reviews].byVerdict.headline:use_case.other | 7% (4/57) | 8% (4/53) | 1 |
| Question type detail (views) | room[Skin changes].reasons.codes[online and digital tools].byVerdict.headline.other | 11% (9/81) | 12% (9/77) | 1 |
| Question type detail (views) | room[Skin changes].reasons.codes[online and digital tools].byVerdict.headline:use_case.ot… | 12% (7/57) | 13% (7/53) | 1 |
| | ... 66 more changed places (raw JSON) | | | |

**Doritos** - 308 numbers move in 308 places (Question type detail (views) 308).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[School lunch bagger].reasons.codes[flavor variety].byVerdict.headline:use_case.other | 63% (26/41) | 45% (9/20) | 18 |
| Question type detail (views) | room[School lunch bagger].reasons.groups[group:flavor range].byVerdict.headline:use_case.… | 63% (26/41) | 45% (9/20) | 18 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[greasiness and oil].byVerdict.headline:discovery.… | 18% (7/39) | 35% (6/17) | 17 |
| Question type detail (views) | room[School lunch bagger].reasons.groups[group:mouthfeel].byVerdict.headline:discovery.ot… | 31% (12/39) | 47% (8/17) | 16 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[flavor variety].byVerdict.headline.other | 75% (60/80) | 62% (23/37) | 13 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[bag and portion size].byVerdict.headline:discover… | 77% (30/39) | 65% (11/17) | 12 |
| Question type detail (views) | room[School lunch bagger].reasons.groups[group:flavor range].byVerdict.headline.other | 76% (61/80) | 65% (24/37) | 11 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[cooking method].byVerdict.headline:discovery.other | 8% (3/39) | 18% (3/17) | 10 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[greasiness and oil].byVerdict.headline.other | 14% (11/80) | 24% (9/37) | 10 |
| Question type detail (views) | room[School lunch bagger].reasons.groups[group:how it's made].byVerdict.headline:discover… | 8% (3/39) | 18% (3/17) | 10 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[mess and residue].byVerdict.headline:use_case.oth… | 41% (17/41) | 50% (10/20) | 9 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[nutrition facts].byVerdict.headline:discovery.oth… | 15% (6/39) | 24% (4/17) | 9 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[packaging format].byVerdict.headline:use_case.oth… | 24% (10/41) | 15% (3/20) | 9 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[value per ounce].byVerdict.headline:discovery.oth… | 15% (6/39) | 24% (4/17) | 9 |
| Question type detail (views) | room[School lunch bagger].reasons.groups[group:eating convenience].byVerdict.headline:use… | 41% (17/41) | 50% (10/20) | 9 |
| Question type detail (views) | room[School lunch bagger].reasons.groups[group:health and nutrition].byVerdict.headline:d… | 15% (6/39) | 24% (4/17) | 9 |
| Question type detail (views) | room[School lunch bagger].reasons.codes[deals and promotions].byVerdict.headline:discover… | 8% (3/39) | 0% (0/17) | 8 |
| Question type detail (views) | room[School lunch bagger].reasons.groups[group:packaging].byVerdict.headline:discovery.ot… | 79% (31/39) | 71% (12/17) | 8 |
| Question type detail (views) | room[On-the-go pit stop].reasons.groups[group:clean ingredients].byVerdict.headline:disco… | 9% (4/45) | 2% (1/42) | 7 |
| Question type detail (views) | room[School lunch bagger].reasons.groups[group:mouthfeel].byVerdict.headline.other | 28% (22/80) | 35% (13/37) | 7 |
| Question type detail (views) | view.reasons.codes[bag and portion size].byVerdict.headline:discovery.other | 31% (68/219) | 24% (47/194) | 7 |
| Question type detail (views) | view.reasons.codes[crunch and texture].byVerdict.headline:discovery.other | 68% (149/219) | 75% (145/194) | 7 |
| Question type detail (views) | view.reasons.codes[dip and food pairing].byVerdict.headline:discovery.other | 56% (123/219) | 63% (123/194) | 7 |
| Question type detail (views) | view.reasons.groups[dip and food pairing].byVerdict.headline:discovery.other | 56% (123/219) | 63% (123/194) | 7 |
| Question type detail (views) | view.reasons.groups[group:mouthfeel].byVerdict.headline:discovery.other | 70% (154/219) | 77% (150/194) | 7 |
| | ... 283 more changed places (raw JSON) | | | |

**Netflix** - 76 numbers move in 76 places (Question type detail (views) 76).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[New home setup].reasons.codes[prestige quality].byVerdict.headline:use_case.other | 65% (22/34) | 79% (22/28) | 14 |
| Question type detail (views) | room[New home setup].reasons.groups[group:acclaim and buzz].byVerdict.headline:use_case.o… | 65% (22/34) | 79% (22/28) | 14 |
| Question type detail (views) | room[New home setup].reasons.codes[profiles].byVerdict.headline:use_case.other | 26% (9/34) | 14% (4/28) | 12 |
| Question type detail (views) | room[New home setup].reasons.groups[group:household sharing].byVerdict.headline:use_case.… | 26% (9/34) | 14% (4/28) | 12 |
| Question type detail (views) | room[New home setup].reasons.codes[app interface].byVerdict.headline:use_case.other | 35% (12/34) | 43% (12/28) | 8 |
| Question type detail (views) | room[New home setup].reasons.codes[prestige quality].byVerdict.headline.other | 59% (30/51) | 67% (30/45) | 8 |
| Question type detail (views) | room[New home setup].reasons.codes[profiles].byVerdict.headline.other | 24% (12/51) | 16% (7/45) | 8 |
| Question type detail (views) | room[New home setup].reasons.groups[group:acclaim and buzz].byVerdict.headline.other | 59% (30/51) | 67% (30/45) | 8 |
| Question type detail (views) | room[New home setup].reasons.groups[group:household sharing].byVerdict.headline.other | 25% (13/51) | 18% (8/45) | 7 |
| Question type detail (views) | room[New home setup].reasons.codes[recommendations and discovery].byVerdict.headline.other | 69% (35/51) | 64% (29/45) | 5 |
| Question type detail (views) | room[New home setup].reasons.codes[subscription flexibility].byVerdict.headline.other | 37% (19/51) | 42% (19/45) | 5 |
| Question type detail (views) | room[New home setup].reasons.groups[group:app and discovery].byVerdict.headline.other | 69% (35/51) | 64% (29/45) | 5 |
| Question type detail (views) | room[New home setup].reasons.codes[bundles and perks].byVerdict.headline.other | 27% (14/51) | 31% (14/45) | 4 |
| Question type detail (views) | room[New home setup].reasons.groups[group:price and plans].byVerdict.headline.other | 27% (14/51) | 31% (14/45) | 4 |
| Question type detail (views) | room[New home setup].reasons.codes[app interface].byVerdict.headline.other | 24% (12/51) | 27% (12/45) | 3 |
| Question type detail (views) | room[New home setup].reasons.codes[catalog breadth].byVerdict.headline:use_case.other | 68% (23/34) | 71% (20/28) | 3 |
| Question type detail (views) | room[New home setup].reasons.groups[group:cancel and rotate].byVerdict.headline.other | 41% (21/51) | 44% (20/45) | 3 |
| Question type detail (views) | room[New home setup].reasons.groups[group:library size].byVerdict.headline:use_case.other | 68% (23/34) | 71% (20/28) | 3 |
| Question type detail (views) | view.reasons.codes[profiles].byVerdict.headline:use_case.other | 6% (11/193) | 3% (6/187) | 3 |
| Question type detail (views) | view.reasons.groups[group:household sharing].byVerdict.headline:use_case.other | 6% (11/193) | 3% (6/187) | 3 |
| Question type detail (views) | room[New home setup].reasons.codes[catalog breadth].byVerdict.headline.other | 69% (35/51) | 71% (32/45) | 2 |
| Question type detail (views) | room[New home setup].reasons.codes[free options].byVerdict.headline.other | 20% (10/51) | 22% (10/45) | 2 |
| Question type detail (views) | room[New home setup].reasons.codes[service overlap].byVerdict.headline:use_case.other | 6% (2/34) | 4% (1/28) | 2 |
| Question type detail (views) | room[New home setup].reasons.groups[group:ads and free viewing].byVerdict.headline.other | 20% (10/51) | 22% (10/45) | 2 |
| Question type detail (views) | room[New home setup].reasons.groups[group:library size].byVerdict.headline.other | 69% (35/51) | 71% (32/45) | 2 |
| | ... 51 more changed places (raw JSON) | | | |

**Google Pixel** - 144 numbers move in 144 places (Question type detail (views) 144).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[First phone for teen].reasons.codes[connectivity coverage].byVerdict.headline:discov… | 50% (1/2) | 0% (0/1) | 50 |
| Question type detail (views) | room[First phone for teen].reasons.codes[ecosystem integration].byVerdict.headline:discov… | 50% (1/2) | 100% (1/1) | 50 |
| Question type detail (views) | room[First phone for teen].reasons.codes[plans contracts].byVerdict.headline:discovery.ot… | 50% (1/2) | 0% (0/1) | 50 |
| Question type detail (views) | room[First phone for teen].reasons.codes[software updates].byVerdict.headline:discovery.o… | 50% (1/2) | 100% (1/1) | 50 |
| Question type detail (views) | room[First phone for teen].reasons.codes[storage memory].byVerdict.headline:discovery.oth… | 50% (1/2) | 100% (1/1) | 50 |
| Question type detail (views) | room[First phone for teen].reasons.groups[connectivity coverage].byVerdict.headline:disco… | 50% (1/2) | 0% (0/1) | 50 |
| Question type detail (views) | room[First phone for teen].reasons.groups[group:buying and carriers].byVerdict.headline:d… | 50% (1/2) | 0% (0/1) | 50 |
| Question type detail (views) | room[First phone for teen].reasons.groups[group:ecosystem and compatibility].byVerdict.he… | 50% (1/2) | 100% (1/1) | 50 |
| Question type detail (views) | room[First phone for teen].reasons.groups[group:speed and performance].byVerdict.headline… | 50% (1/2) | 100% (1/1) | 50 |
| Question type detail (views) | room[First phone for teen].reasons.groups[group:updates and stability].byVerdict.headline… | 50% (1/2) | 100% (1/1) | 50 |
| Question type detail (views) | view.reasons.codes[parental controls].byVerdict.headline:use_case.other | 35% (92/260) | 21% (44/212) | 14 |
| Question type detail (views) | view.reasons.groups[group:privacy and safety].byVerdict.headline:use_case.other | 35% (92/260) | 21% (44/212) | 14 |
| Question type detail (views) | view.reasons.codes[parental controls].byVerdict.headline.other | 30% (94/309) | 17% (45/260) | 13 |
| Question type detail (views) | view.reasons.groups[group:privacy and safety].byVerdict.headline.other | 30% (94/309) | 17% (45/260) | 13 |
| Question type detail (views) | view.reasons.codes[software updates].byVerdict.headline:use_case.other | 40% (105/260) | 50% (105/212) | 10 |
| Question type detail (views) | room[First phone for teen].reasons.codes[ecosystem integration].byVerdict.headline.other | 22% (21/94) | 31% (14/45) | 9 |
| Question type detail (views) | view.reasons.codes[performance].byVerdict.headline:use_case.other | 38% (100/260) | 47% (99/212) | 9 |
| Question type detail (views) | view.reasons.groups[group:speed and performance].byVerdict.headline:use_case.other | 39% (102/260) | 48% (101/212) | 9 |
| Question type detail (views) | room[First phone for teen].reasons.codes[ecosystem integration].byVerdict.headline:use_ca… | 22% (20/92) | 30% (13/44) | 8 |
| Question type detail (views) | view.reasons.groups[group:updates and stability].byVerdict.headline:use_case.other | 42% (109/260) | 50% (107/212) | 8 |
| Question type detail (views) | room[First phone for teen].reasons.codes[plans contracts].byVerdict.headline.other | 16% (15/94) | 9% (4/45) | 7 |
| Question type detail (views) | room[First phone for teen].reasons.groups[group:buying and carriers].byVerdict.headline.o… | 16% (15/94) | 9% (4/45) | 7 |
| Question type detail (views) | view.reasons.groups[group:speed and performance].byVerdict.headline.other | 41% (126/309) | 48% (125/260) | 7 |
| Question type detail (views) | room[First phone for teen].reasons.codes[plans contracts].byVerdict.headline:use_case.oth… | 15% (14/92) | 9% (4/44) | 6 |
| Question type detail (views) | room[First phone for teen].reasons.groups[group:buying and carriers].byVerdict.headline:u… | 15% (14/92) | 9% (4/44) | 6 |
| | ... 119 more changed places (raw JSON) | | | |

**Jira** - 88 numbers move in 88 places (Question type detail (views) 88).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[Company standardization].reasons.codes[workflow customization].byVerdict.headline.ot… | 58% (14/24) | 67% (14/21) | 9 |
| Question type detail (views) | room[Company standardization].reasons.codes[workflow customization].byVerdict.headline:us… | 58% (14/24) | 67% (14/21) | 9 |
| Question type detail (views) | room[Company standardization].reasons.groups[group:custom workflows].byVerdict.headline.o… | 58% (14/24) | 67% (14/21) | 9 |
| Question type detail (views) | room[Company standardization].reasons.groups[group:custom workflows].byVerdict.headline:u… | 58% (14/24) | 67% (14/21) | 9 |
| Question type detail (views) | room[Company standardization].reasons.codes[cross team dependencies].byVerdict.headline.o… | 38% (9/24) | 33% (7/21) | 5 |
| Question type detail (views) | room[Company standardization].reasons.codes[cross team dependencies].byVerdict.headline:u… | 38% (9/24) | 33% (7/21) | 5 |
| Question type detail (views) | room[Company standardization].reasons.codes[process fit].byVerdict.headline.other | 38% (9/24) | 33% (7/21) | 5 |
| Question type detail (views) | room[Company standardization].reasons.codes[process fit].byVerdict.headline:use_case.other | 38% (9/24) | 33% (7/21) | 5 |
| Question type detail (views) | room[Company standardization].reasons.codes[reporting and dashboards].byVerdict.headline.… | 38% (9/24) | 43% (9/21) | 5 |
| Question type detail (views) | room[Company standardization].reasons.codes[reporting and dashboards].byVerdict.headline:… | 38% (9/24) | 43% (9/21) | 5 |
| Question type detail (views) | room[Company standardization].reasons.groups[process fit].byVerdict.headline.other | 38% (9/24) | 33% (7/21) | 5 |
| Question type detail (views) | room[Company standardization].reasons.groups[process fit].byVerdict.headline:use_case.oth… | 38% (9/24) | 33% (7/21) | 5 |
| Question type detail (views) | room[Company standardization].reasons.codes[roadmaps and portfolio].byVerdict.headline.ot… | 79% (19/24) | 76% (16/21) | 3 |
| Question type detail (views) | room[Company standardization].reasons.codes[roadmaps and portfolio].byVerdict.headline:us… | 79% (19/24) | 76% (16/21) | 3 |
| Question type detail (views) | room[Company standardization].reasons.codes[adoption and training].byVerdict.headline.oth… | 8% (2/24) | 10% (2/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[adoption and training].byVerdict.headline:use… | 8% (2/24) | 10% (2/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[developer tooling].byVerdict.headline.other | 8% (2/24) | 10% (2/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[developer tooling].byVerdict.headline:use_cas… | 8% (2/24) | 10% (2/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[ease of use].byVerdict.headline.other | 8% (2/24) | 10% (2/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[ease of use].byVerdict.headline:use_case.other | 8% (2/24) | 10% (2/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[governance and standardization].byVerdict.hea… | 21% (5/24) | 19% (4/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[governance and standardization].byVerdict.hea… | 21% (5/24) | 19% (4/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[multiple views].byVerdict.headline.other | 8% (2/24) | 10% (2/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[multiple views].byVerdict.headline:use_case.o… | 8% (2/24) | 10% (2/21) | 2 |
| Question type detail (views) | room[Company standardization].reasons.codes[pricing and licensing].byVerdict.headline.oth… | 8% (2/24) | 10% (2/21) | 2 |
| | ... 63 more changed places (raw JSON) | | | |

**American Express** - 80 numbers move in 80 places (Question type detail (views) 80).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[Small business owner].reasons.codes[expense tracking].byVerdict.headline:use_case.ot… | 26% (24/92) | 14% (10/73) | 12 |
| Question type detail (views) | room[Small business owner].reasons.groups[group:business management].byVerdict.headline:u… | 37% (34/92) | 25% (18/73) | 12 |
| Question type detail (views) | room[Small business owner].reasons.codes[rewards rate].byVerdict.headline:use_case.other | 85% (78/92) | 96% (70/73) | 11 |
| Question type detail (views) | room[Small business owner].reasons.groups[rewards rate].byVerdict.headline:use_case.other | 85% (78/92) | 96% (70/73) | 11 |
| Question type detail (views) | room[Small business owner].reasons.codes[expense tracking].byVerdict.headline.other | 26% (31/121) | 17% (17/102) | 9 |
| Question type detail (views) | room[Small business owner].reasons.groups[group:business management].byVerdict.headline.o… | 38% (46/121) | 29% (30/102) | 9 |
| Question type detail (views) | room[Small business owner].reasons.codes[annual fee].byVerdict.headline:use_case.other | 71% (65/92) | 79% (58/73) | 8 |
| Question type detail (views) | room[Small business owner].reasons.codes[employee cards controls].byVerdict.headline:use_… | 23% (21/92) | 15% (11/73) | 8 |
| Question type detail (views) | room[Small business owner].reasons.codes[rewards rate].byVerdict.headline.other | 88% (106/121) | 96% (98/102) | 8 |
| Question type detail (views) | room[Small business owner].reasons.groups[annual fee].byVerdict.headline:use_case.other | 71% (65/92) | 79% (58/73) | 8 |
| Question type detail (views) | room[Small business owner].reasons.groups[rewards rate].byVerdict.headline.other | 88% (106/121) | 96% (98/102) | 8 |
| Question type detail (views) | room[Small business owner].reasons.codes[bonus categories].byVerdict.headline.other | 37% (45/121) | 44% (45/102) | 7 |
| Question type detail (views) | room[Small business owner].reasons.codes[bonus categories].byVerdict.headline:use_case.ot… | 26% (24/92) | 33% (24/73) | 7 |
| Question type detail (views) | room[Small business owner].reasons.groups[group:bonus categories].byVerdict.headline.other | 37% (45/121) | 44% (45/102) | 7 |
| Question type detail (views) | room[Small business owner].reasons.groups[group:bonus categories].byVerdict.headline:use_… | 26% (24/92) | 33% (24/73) | 7 |
| Question type detail (views) | room[Small business owner].reasons.codes[annual fee].byVerdict.headline.other | 66% (80/121) | 72% (73/102) | 6 |
| Question type detail (views) | room[Small business owner].reasons.groups[annual fee].byVerdict.headline.other | 66% (80/121) | 72% (73/102) | 6 |
| Question type detail (views) | view.reasons.groups[group:business management].byVerdict.headline:use_case.other | 14% (34/236) | 8% (18/217) | 6 |
| Question type detail (views) | room[Small business owner].reasons.codes[employee cards controls].byVerdict.headline.other | 23% (28/121) | 18% (18/102) | 5 |
| Question type detail (views) | room[Small business owner].reasons.codes[interest and apr].byVerdict.headline:use_case.ot… | 26% (24/92) | 21% (15/73) | 5 |
| Question type detail (views) | view.reasons.codes[expense tracking].byVerdict.headline:use_case.other | 10% (24/236) | 5% (10/217) | 5 |
| Question type detail (views) | view.reasons.codes[supplier payment costs].byVerdict.headline:use_case.other | 31% (72/236) | 26% (56/217) | 5 |
| Question type detail (views) | room[Small business owner].reasons.codes[interest and apr].byVerdict.headline.other | 29% (35/121) | 25% (26/102) | 4 |
| Question type detail (views) | room[Small business owner].reasons.groups[group:credit and financing].byVerdict.headline:… | 59% (54/92) | 55% (40/73) | 4 |
| Question type detail (views) | view.reasons.codes[annual fee].byVerdict.headline:use_case.other | 78% (184/236) | 82% (177/217) | 4 |
| | ... 55 more changed places (raw JSON) | | | |

## Ruling 3: price answers: each answer in one bucket, of all price answers

Today the Value card already counts every price answer in one bucket (a rival, else your own cheaper option - only for a brand with a ladder of its own lines - else nowhere). The price view (value.ts: `recommendsInstead`, `ownRung`) counts over the not-worth-it and it-depends answers only, and counts any own option. Moving the price view to the card's rule moves **144 numbers on screen** (Question type detail (views) 124, Overview 12, Brief (own subject) 8); 70 more figures move in places not drawn today (Map position figures beyond the first, finding footnotes, and the build-your-own 'Recommends another' measure). Sentences such as 'X% of the doubts point to ...' keep their wording today but would then be shares of all price answers - their wording must change with the ruling. Largest: Google Pixel summary.verdict[value].text Google Pixel's lines are judged worth it -> Google Pixel's lines are judged worth it; Jira room[Client-facing delivery].value.lines[Jira Premium].ownR… 40% -> 14%; Jira room[Client-facing delivery].value.ownRung 40% -> 14%.

Ladder used (from the Value card: a brand whose card shows an 'own cheaper option' bar): Netflix, Google Pixel, Jira, American Express. Sephora and Doritos have none, so their own-option share goes to 0.

**Sephora** - 24 numbers move in 24 places (Question type detail (views) 23, Overview 1).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[Tight month].value.lines[Sephora].ownRung | 7% (9/130) | 0% (0/130) | 7 |
| Question type detail (views) | room[Tight month].value.ownRung | 7% (9/130) | 0% (0/130) | 7 |
| Question type detail (views) | room[Tight month].value.rooms[Tight month].ownRung | 7% (9/130) | 0% (0/130) | 7 |
| Question type detail (views) | view.value.rooms[Tight month].ownRung | 7% (9/130) | 0% (0/130) | 7 |
| Question type detail (views) | room[Everyday restock].value.lines[Sephora].ownRung | 5% (7/130) | 0% (0/130) | 5 |
| Question type detail (views) | room[Everyday restock].value.ownRung | 5% (7/130) | 0% (0/130) | 5 |
| Question type detail (views) | room[Everyday restock].value.rooms[Everyday restock].ownRung | 5% (7/130) | 0% (0/130) | 5 |
| Question type detail (views) | view.value.rooms[Everyday restock].ownRung | 5% (7/130) | 0% (0/130) | 5 |
| Overview | summary.verdict[value].text | Sephora is judged worth it in 4% of answers; 4% of the doubts point to its own cheaper option and 37% to a rival. | Sephora is judged worth it in 4% of answers; 0% of the doubts point to its own cheaper option and 37% to a rival. | 4 |
| Question type detail (views) | view.value.lines[Sephora].ownRung | 4% (19/500) | 0% (0/520) | 4 |
| Question type detail (views) | view.value.ownRung | 4% (19/500) | 0% (0/520) | 4 |
| Question type detail (views) | room[Building a routine].value.lines[Sephora].ownRung | 2% (2/125) | 0% (0/130) | 2 |
| Question type detail (views) | room[Building a routine].value.ownRung | 2% (2/125) | 0% (0/130) | 2 |
| Question type detail (views) | room[Building a routine].value.rooms[Building a routine].ownRung | 2% (2/125) | 0% (0/130) | 2 |
| Question type detail (views) | view.value.rooms[Building a routine].ownRung | 2% (2/125) | 0% (0/130) | 2 |
| Question type detail (views) | journey.stations[value].anchor.cell | 32% (161/500) | 31% (161/520) | 1 |
| Question type detail (views) | room[Skin changes].value.lines[Sephora].ownRung | 1% (1/115) | 0% (0/130) | 1 |
| Question type detail (views) | room[Skin changes].value.lines[Sephora].recommendsInstead | 16% (18/115) | 15% (20/130) | 1 |
| Question type detail (views) | room[Skin changes].value.ownRung | 1% (1/115) | 0% (0/130) | 1 |
| Question type detail (views) | room[Skin changes].value.recommendsInstead | 16% (18/115) | 15% (20/130) | 1 |
| Question type detail (views) | room[Skin changes].value.rooms[Skin changes].ownRung | 1% (1/115) | 0% (0/130) | 1 |
| Question type detail (views) | room[Skin changes].value.rooms[Skin changes].recommendsInstead | 16% (18/115) | 15% (20/130) | 1 |
| Question type detail (views) | view.value.rooms[Skin changes].ownRung | 1% (1/115) | 0% (0/130) | 1 |
| Question type detail (views) | view.value.rooms[Skin changes].recommendsInstead | 16% (18/115) | 15% (20/130) | 1 |

**Doritos** - 7 numbers move in 7 places (Question type detail (views) 7).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[Game night host].value.lines[Doritos].recommendsInstead | 14% (12/86) | 11% (14/130) | 3 |
| Question type detail (views) | room[Game night host].value.recommendsInstead | 14% (12/86) | 11% (14/130) | 3 |
| Question type detail (views) | room[Game night host].value.rooms[Game night host].recommendsInstead | 14% (12/86) | 11% (14/130) | 3 |
| Question type detail (views) | view.value.rooms[Game night host].recommendsInstead | 14% (12/86) | 11% (14/130) | 3 |
| Question type detail (views) | journey.stations[value].anchor.cell | 8% (36/453) | 7% (36/520) | 1 |
| Question type detail (views) | view.value.lines[Doritos].recommendsInstead | 13% (58/453) | 12% (61/520) | 1 |
| Question type detail (views) | view.value.recommendsInstead | 13% (58/453) | 12% (61/520) | 1 |

**Netflix** - 16 numbers move in 16 places (Question type detail (views) 15, Overview 1).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | journey.stations[value].anchor.cell | 24% (106/437) | 20% (106/520) | 4 |
| Question type detail (views) | room[Long-series binge].value.lines[Netflix Standard].recommendsInstead | 12% (10/82) | 16% (21/130) | 4 |
| Question type detail (views) | room[Long-series binge].value.recommendsInstead | 12% (10/82) | 16% (21/130) | 4 |
| Question type detail (views) | room[Long-series binge].value.rooms[Long-series binge].recommendsInstead | 12% (10/82) | 16% (21/130) | 4 |
| Question type detail (views) | view.value.rooms[Long-series binge].recommendsInstead | 12% (10/82) | 16% (21/130) | 4 |
| Question type detail (views) | room[New home setup].value.lines[Netflix Standard].recommendsInstead | 51% (60/117) | 54% (70/130) | 3 |
| Question type detail (views) | room[New home setup].value.recommendsInstead | 51% (60/117) | 54% (70/130) | 3 |
| Question type detail (views) | room[New home setup].value.rooms[New home setup].recommendsInstead | 51% (60/117) | 54% (70/130) | 3 |
| Question type detail (views) | view.value.rooms[New home setup].recommendsInstead | 51% (60/117) | 54% (70/130) | 3 |
| Question type detail (views) | room[Kids-first household].value.lines[Netflix Standard].recommendsInstead | 61% (66/108) | 63% (82/130) | 2 |
| Question type detail (views) | room[Kids-first household].value.recommendsInstead | 61% (66/108) | 63% (82/130) | 2 |
| Question type detail (views) | room[Kids-first household].value.rooms[Kids-first household].recommendsInstead | 61% (66/108) | 63% (82/130) | 2 |
| Question type detail (views) | view.value.rooms[Kids-first household].recommendsInstead | 61% (66/108) | 63% (82/130) | 2 |
| Overview | summary.verdict[value].text | Netflix Standard is judged worth it in 16% of answers; 0% of the doubts point to its own cheaper option and 38% to a rival. | Netflix Standard is judged worth it in 16% of answers; 0% of the doubts point to its own cheaper option and 39% to a rival. | 1 |
| Question type detail (views) | view.value.lines[Netflix Standard].recommendsInstead | 38% (167/437) | 39% (204/520) | 1 |
| Question type detail (views) | view.value.recommendsInstead | 38% (167/437) | 39% (204/520) | 1 |

**Google Pixel** - 43 numbers move in 42 places (Question type detail (views) 41, Overview 2).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Overview | summary.verdict[value].text | Google Pixel's lines are judged worth it in 56% of answers. | Google Pixel's lines are judged worth it in 56% of answers; 18% of the doubts point to its own cheaper option and 30% to a rival. | 100 |
| Question type detail (views) | room[First phone for teen].value.lines[Pixel A].ownRung | 0% (0/57) | 17% (22/130) | 17 |
| Question type detail (views) | room[First phone for teen].value.ownRung | 0% (0/57) | 17% (22/130) | 17 |
| Question type detail (views) | room[First phone for teen].value.rooms[First phone for teen].ownRung | 0% (0/57) | 17% (22/130) | 17 |
| Question type detail (views) | view.value.rooms[First phone for teen].ownRung | 0% (0/57) | 17% (22/130) | 17 |
| Question type detail (views) | room[First phone for teen].value.lines[Pixel A].recommendsInstead | 70% (40/57) | 54% (70/130) | 16 |
| Question type detail (views) | room[First phone for teen].value.recommendsInstead | 70% (40/57) | 54% (70/130) | 16 |
| Question type detail (views) | room[First phone for teen].value.rooms[First phone for teen].recommendsInstead | 70% (40/57) | 54% (70/130) | 16 |
| Question type detail (views) | room[Midrange value hunt].value.lines[Pixel A].recommendsInstead | 29% (10/34) | 45% (58/130) | 16 |
| Question type detail (views) | room[Midrange value hunt].value.recommendsInstead | 29% (10/34) | 45% (58/130) | 16 |
| Question type detail (views) | room[Midrange value hunt].value.rooms[Midrange value hunt].recommendsInstead | 29% (10/34) | 45% (58/130) | 16 |
| Question type detail (views) | view.value.rooms[First phone for teen].recommendsInstead | 70% (40/57) | 54% (70/130) | 16 |
| Question type detail (views) | view.value.rooms[Midrange value hunt].recommendsInstead | 29% (10/34) | 45% (58/130) | 16 |
| Question type detail (views) | journey.stations[value].anchor.cell | 25% (57/228) | 11% (57/520) | 14 |
| Question type detail (views) | view.value.lines[Pixel A].ownRung | 4% (4/91) | 15% (39/260) | 11 |
| Question type detail (views) | room[Plan promo shopper].value.lines[Google Pixel].recommendsInstead | 9% (6/66) | 17% (22/130) | 8 |
| Question type detail (views) | room[Plan promo shopper].value.recommendsInstead | 9% (6/66) | 17% (22/130) | 8 |
| Question type detail (views) | room[Plan promo shopper].value.rooms[Plan promo shopper].recommendsInstead | 9% (6/66) | 17% (22/130) | 8 |
| Question type detail (views) | view.value.lines[Google Pixel].recommendsInstead | 9% (6/66) | 17% (22/130) | 8 |
| Question type detail (views) | view.value.rooms[Plan promo shopper].recommendsInstead | 9% (6/66) | 17% (22/130) | 8 |
| Question type detail (views) | view.value.lines[Pixel A].recommendsInstead | 55% (50/91) | 49% (128/260) | 6 |
| Question type detail (views) | view.value.ownRung | 14% (33/228) | 18% (92/520) | 4 |
| Question type detail (views) | view.value.recommendsInstead | 26% (59/228) | 30% (156/520) | 4 |
| Question type detail (views) | room[Friends and family photos].value.lines[Pixel Pro].ownRung | 37% (26/71) | 34% (44/130) | 3 |
| Question type detail (views) | room[Friends and family photos].value.ownRung | 37% (26/71) | 34% (44/130) | 3 |
| | ... 17 more changed places (raw JSON) | | | |

**Jira** - 17 numbers move in 16 places (Question type detail (views) 15, Overview 2).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[Client-facing delivery].value.lines[Jira Premium].ownRung | 40% (52/130) | 14% (18/130) | 26 |
| Question type detail (views) | room[Client-facing delivery].value.ownRung | 40% (52/130) | 14% (18/130) | 26 |
| Question type detail (views) | room[Client-facing delivery].value.rooms[Client-facing delivery].ownRung | 40% (52/130) | 14% (18/130) | 26 |
| Question type detail (views) | view.value.rooms[Client-facing delivery].ownRung | 40% (52/130) | 14% (18/130) | 26 |
| Question type detail (views) | view.value.lines[Jira Premium].ownRung | 14% (52/381) | 5% (18/390) | 9 |
| Overview | summary.verdict[value].text | Jira's lines are judged worth it in 2% of answers; 10% of the doubts point to its own cheaper option and 47% to a rival. | Jira's lines are judged worth it in 2% of answers; 3% of the doubts point to its own cheaper option and 46% to a rival. | 7 |
| Question type detail (views) | view.value.ownRung | 10% (52/511) | 3% (18/520) | 7 |
| Question type detail (views) | room[Company standardization].value.lines[Jira Premium].recommendsInstead | 49% (61/124) | 48% (62/130) | 1 |
| Question type detail (views) | room[Company standardization].value.recommendsInstead | 49% (61/124) | 48% (62/130) | 1 |
| Question type detail (views) | room[Company standardization].value.rooms[Company standardization].recommendsInstead | 49% (61/124) | 48% (62/130) | 1 |
| Question type detail (views) | room[Legacy replacement].value.lines[Jira Premium].recommendsInstead | 14% (18/127) | 15% (19/130) | 1 |
| Question type detail (views) | room[Legacy replacement].value.recommendsInstead | 14% (18/127) | 15% (19/130) | 1 |
| Question type detail (views) | room[Legacy replacement].value.rooms[Legacy replacement].recommendsInstead | 14% (18/127) | 15% (19/130) | 1 |
| Question type detail (views) | view.value.recommendsInstead | 47% (239/511) | 46% (241/520) | 1 |
| Question type detail (views) | view.value.rooms[Company standardization].recommendsInstead | 49% (61/124) | 48% (62/130) | 1 |
| Question type detail (views) | view.value.rooms[Legacy replacement].recommendsInstead | 14% (18/127) | 15% (19/130) | 1 |

**American Express** - 37 numbers move in 33 places (Question type detail (views) 23, Brief (own subject) 8, Overview 6); of those, 6 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | room[Small business owner].value.lines[Business Gold Card].ownRung | 30% (39/130) | 6% (8/130) | 24 |
| Question type detail (views) | room[Small business owner].value.ownRung | 30% (39/130) | 6% (8/130) | 24 |
| Question type detail (views) | room[Small business owner].value.rooms[Small business owner].ownRung | 30% (39/130) | 6% (8/130) | 24 |
| Question type detail (views) | view.value.lines[Business Gold Card].ownRung | 30% (39/130) | 6% (8/130) | 24 |
| Question type detail (views) | view.value.rooms[Small business owner].ownRung | 30% (39/130) | 6% (8/130) | 24 |
| Question type detail (views) | room[Everyday spender].value.lines[Gold Card].ownRung | 15% (20/130) | 2% (2/130) | 13 |
| Question type detail (views) | room[Everyday spender].value.ownRung | 15% (20/130) | 2% (2/130) | 13 |
| Question type detail (views) | room[Everyday spender].value.rooms[Everyday spender].ownRung | 15% (20/130) | 2% (2/130) | 13 |
| Question type detail (views) | view.value.rooms[Everyday spender].ownRung | 15% (20/130) | 2% (2/130) | 13 |
| Question type detail (views) | room[Premium luxury seeker].value.lines[Platinum Card].recommendsInstead | 62% (57/92) | 50% (65/130) | 12 |
| Question type detail (views) | room[Premium luxury seeker].value.recommendsInstead | 62% (57/92) | 50% (65/130) | 12 |
| Question type detail (views) | room[Premium luxury seeker].value.rooms[Premium luxury seeker].recommendsInstead | 62% (57/92) | 50% (65/130) | 12 |
| Question type detail (views) | view.value.lines[Platinum Card].recommendsInstead | 62% (57/92) | 50% (65/130) | 12 |
| Question type detail (views) | view.value.rooms[Premium luxury seeker].recommendsInstead | 62% (57/92) | 50% (65/130) | 12 |
| Overview | summary.insights[value_in_house].body | When the AI doubts American Express is worth the price, 46% of those answers point to a rival - most often Capital One; 13% point to its own cheaper option. | When the AI doubts American Express is worth the price, 44% of those answers point to a rival - most often Capital One; 2% point to its own cheaper option. | 11 |
| Overview | summary.insights[value_in_house].viz[Your own cheaper option].text | 13% | 2% | 11 |
| Overview | summary.verdict[value].text | American Express's lines are judged worth it in 11% of answers; 13% of the doubts point to its own cheaper option and 46% to a rival. | American Express's lines are judged worth it in 11% of answers; 2% of the doubts point to its own cheaper option and 44% to a rival. | 11 |
| Question type detail (views) | view.value.ownRung | 13% (59/465) | 2% (10/520) | 11 |
| Question type detail (views) | view.value.lines[Gold Card].ownRung | 8% (20/243) | 1% (2/260) | 7 |
| Question type detail (views) | journey.stations[value].anchor.cell | 39% (180/465) | 35% (180/520) | 4 |
| Question type detail (views) | room[Dining and going out].value.lines[Gold Card].recommendsInstead | 35% (39/113) | 32% (42/130) | 3 |
| Question type detail (views) | room[Dining and going out].value.recommendsInstead | 35% (39/113) | 32% (42/130) | 3 |
| Question type detail (views) | room[Dining and going out].value.rooms[Dining and going out].recommendsInstead | 35% (39/113) | 32% (42/130) | 3 |
| Question type detail (views) | view.value.rooms[Dining and going out].recommendsInstead | 35% (39/113) | 32% (42/130) | 3 |
| Overview | summary.insights[value_in_house].viz[A rival].text | 46% | 44% | 2 |
| | ... 2 more changed places (raw JSON) | | | |

## Ruling 4: a condition's share = of all the answers to that question

The cards already show condition shares of all the cell's answers. The Map position's own condition lists (analysis_map.ts) divide by the answers that state any condition (flat rows: both sides; themes: that side). On screen today those lists are drawn only by the Data page's 'Every contest' table (the first reason on each side, with its share), so **219 numbers move on screen** (Data page - Every contest 219). A further **9056 position condition figures** move but are not drawn on the snapshot (every cell has a new panel; the old panels that drew them are fallbacks). Every share moves down (219 of 219 changed shares), since the base grows to every answer; the largest drops are on the settled-customer cards, where one stated condition was the only one on its side (100% -> <1%). Largest: Doritos settled:settled:all/away Love cheesy flavor 100% -> Love cheesy flavor <1%; American Express settled:settled:all/away Prefer Chase rewards 100% -> Prefer Chase rewards <1%; Doritos settled:settled:expansion/away Love cheesy flavor 100% -> Love cheesy flavor 1%.

**Sephora** - 41 numbers move in 41 places (Data page - Every contest 41).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Data page - Every contest | settled:settled:all/away | Affordable everyday basics 46% | Affordable everyday basics 2% | 44 |
| Data page - Every contest | settled:settled:expansion/away | Affordable everyday basics 46% | Affordable everyday basics 5% | 41 |
| Data page - Every contest | chooses:open:tight month/to | Choose prestige products 43% | Choose prestige products 10% | 33 |
| Data page - Every contest | settled:settled:ecosystem/to | Already have a shade match 63% | Already have a shade match 32% | 31 |
| Data page - Every contest | chooses:social:all/away | Clinical and Asian skincare 76% | Clinical and Asian skincare 48% | 28 |
| Data page - Every contest | chooses:open:all/to | Choose prestige products 46% | Choose prestige products 20% | 26 |
| Data page - Every contest | chooses:premium:all/away | Affordable everyday basics 63% | Affordable everyday basics 38% | 25 |
| Data page - Every contest | chooses:premium:all/to | Choose prestige products 60% | Choose prestige products 35% | 25 |
| Data page - Every contest | fights:leavers:amazon/to | Choose prestige products 54% | Choose prestige products 31% | 23 |
| Data page - Every contest | fights:h2h:nordstrom/to | Beauty is the focus 52% | Beauty is the focus 30% | 22 |
| Data page - Every contest | chooses:open:tight month/away | Save money and earn rewards 63% | Save money and earn rewards 42% | 21 |
| Data page - Every contest | chooses:open:everyday restock/to | Choose prestige products 65% | Choose prestige products 45% | 20 |
| Data page - Every contest | chooses:open:building a routine/to | Choose prestige products 34% | Choose prestige products 16% | 18 |
| Data page - Every contest | chooses:social:all/to | Choose prestige products 31% | Choose prestige products 14% | 17 |
| Data page - Every contest | chooses:open:skin changes/to | Test before committing 22% | Test before committing 7% | 15 |
| Data page - Every contest | fights:h2h:amazon/to | Choose prestige products 38% | Choose prestige products 23% | 15 |
| Data page - Every contest | fights:leavers:target/away | Affordable everyday basics 67% | Affordable everyday basics 52% | 15 |
| Data page - Every contest | chooses:open:all/away | Affordable everyday basics 49% | Affordable everyday basics 35% | 14 |
| Data page - Every contest | chooses:open:everyday restock/away | Affordable everyday basics 67% | Affordable everyday basics 53% | 14 |
| Data page - Every contest | fights:h2h:ulta beauty/away | Affordable everyday basics 32% | Affordable everyday basics 18% | 14 |
| Data page - Every contest | fights:leavers:all/to | Choose prestige products 48% | Choose prestige products 34% | 14 |
| Data page - Every contest | settled:settled:all/to | Already have a shade match 24% | Already have a shade match 11% | 13 |
| Data page - Every contest | chooses:open:skin changes/away | Sensitive or reactive skin 33% | Sensitive or reactive skin 21% | 12 |
| Data page - Every contest | fights:h2h:all/to | Choose prestige products 43% | Choose prestige products 32% | 11 |
| Data page - Every contest | fights:leavers:nordstrom/to | Choose prestige products 41% | Choose prestige products 30% | 11 |
| | ... 16 more changed places (raw JSON) | | | |

**Doritos** - 41 numbers move in 41 places (Data page - Every contest 41).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Data page - Every contest | settled:settled:all/away | Love cheesy flavor 100% | Love cheesy flavor <1% | 100 |
| Data page - Every contest | settled:settled:expansion/away | Love cheesy flavor 100% | Love cheesy flavor 1% | 99 |
| Data page - Every contest | settled:settled:ecosystem/to | Want spicy heat 80% | Want spicy heat 3% | 77 |
| Data page - Every contest | fights:leavers:ruffles/to | Want bold flavor 53% | Want bold flavor 6% | 47 |
| Data page - Every contest | chooses:premium:all/to | Want bold flavor 53% | Want bold flavor 7% | 46 |
| Data page - Every contest | chooses:open:on-the-go pit stop/to | Want bold flavor 60% | Want bold flavor 16% | 44 |
| Data page - Every contest | chooses:social:all/to | Want bold flavor 53% | Want bold flavor 12% | 41 |
| Data page - Every contest | fights:h2h:cheetos/away | Love cheesy flavor 69% | Love cheesy flavor 33% | 36 |
| Data page - Every contest | chooses:premium:all/away | Prefer classic comfort 54% | Prefer classic comfort 20% | 34 |
| Data page - Every contest | doubts:repertoire:all/away | Want more crunch 54% | Want more crunch 20% | 34 |
| Data page - Every contest | fights:h2h:cheetos/to | Want bold flavor 41% | Want bold flavor 7% | 34 |
| Data page - Every contest | chooses:open:all/to | Want bold flavor 39% | Want bold flavor 10% | 29 |
| Data page - Every contest | fights:h2h:ruffles/away | Sturdy for dipping 79% | Sturdy for dipping 50% | 29 |
| Data page - Every contest | fights:h2h:all/to | Snack straight from bag 49% | Snack straight from bag 21% | 28 |
| Data page - Every contest | fights:h2h:takis/to | Snack straight from bag 45% | Snack straight from bag 17% | 28 |
| Data page - Every contest | fights:leavers:cheetos/to | Want cheesy flavor 57% | Want cheesy flavor 30% | 27 |
| Data page - Every contest | fights:leavers:lay's/to | Replacing Flamin’ Hot Cheetos 29% | Replacing Flamin’ Hot Cheetos 2% | 27 |
| Data page - Every contest | fights:h2h:lay's/to | Snack straight from bag 54% | Snack straight from bag 28% | 26 |
| Data page - Every contest | chooses:open:game night host/to | Want bold flavor 34% | Want bold flavor 10% | 24 |
| Data page - Every contest | chooses:open:school lunch bagger/to | For kids’ lunchboxes 30% | For kids’ lunchboxes 6% | 24 |
| Data page - Every contest | settled:settled:all/to | Sharing with a crowd 32% | Sharing with a crowd 8% | 24 |
| Data page - Every contest | chooses:open:weekly household stock-up/to | Want bold flavor 31% | Want bold flavor 9% | 22 |
| Data page - Every contest | fights:h2h:ruffles/to | Snack straight from bag 52% | Snack straight from bag 31% | 21 |
| Data page - Every contest | fights:leavers:all/to | Want spicy heat 32% | Want spicy heat 11% | 21 |
| Data page - Every contest | chooses:social:all/away | Prefer classic comfort 45% | Prefer classic comfort 26% | 19 |
| | ... 16 more changed places (raw JSON) | | | |

**Netflix** - 38 numbers move in 38 places (Data page - Every contest 38).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Data page - Every contest | settled:settled:ecosystem/to | Prefer easy browsing 100% | Prefer easy browsing 2% | 98 |
| Data page - Every contest | settled:settled:all/to | Want offline travel viewing 54% | Want offline travel viewing 12% | 42 |
| Data page - Every contest | chooses:open:long-series binge/to | Looking for a specific title 55% | Looking for a specific title 15% | 40 |
| Data page - Every contest | chooses:open:new home setup/to | Want broad variety 53% | Want broad variety 16% | 37 |
| Data page - Every contest | settled:settled:ecosystem/away | Want multiple services 37% | Want multiple services 5% | 32 |
| Data page - Every contest | chooses:premium:all/to | Ad-free, high-quality viewing 39% | Ad-free, high-quality viewing 8% | 31 |
| Data page - Every contest | fights:h2h:disney+/to | Want broad variety 65% | Want broad variety 39% | 26 |
| Data page - Every contest | chooses:open:all/to | Want broad variety 39% | Want broad variety 14% | 25 |
| Data page - Every contest | settled:settled:all/away | Want multiple services 27% | Want multiple services 2% | 25 |
| Data page - Every contest | settled:settled:expansion/away | Family and kids 27% | Family and kids 2% | 25 |
| Data page - Every contest | chooses:social:all/to | One service covers enough 38% | One service covers enough 14% | 24 |
| Data page - Every contest | chooses:open:budget reset month/to | Want broad variety 36% | Want broad variety 13% | 23 |
| Data page - Every contest | chooses:open:kids-first household/to | Want broad variety 51% | Want broad variety 28% | 23 |
| Data page - Every contest | fights:h2h:apple tv+/to | Want broad variety 55% | Want broad variety 36% | 19 |
| Data page - Every contest | settled:settled:expansion/to | Want offline travel viewing 55% | Want offline travel viewing 36% | 19 |
| Data page - Every contest | fights:h2h:max/to | Want broad variety 69% | Want broad variety 52% | 17 |
| Data page - Every contest | chooses:open:long-series binge/away | Quality over quantity 47% | Quality over quantity 31% | 16 |
| Data page - Every contest | chooses:premium:all/away | Casual and comfort viewing 24% | Casual and comfort viewing 8% | 16 |
| Data page - Every contest | fights:h2h:all/to | Want broad variety 52% | Want broad variety 38% | 14 |
| Data page - Every contest | chooses:open:new home setup/away | Use services you have 57% | Use services you have 45% | 12 |
| Data page - Every contest | fights:leavers:amazon prime video/to | One service covers enough 42% | One service covers enough 30% | 12 |
| Data page - Every contest | chooses:social:all/away | Quality over quantity 63% | Quality over quantity 52% | 11 |
| Data page - Every contest | fights:h2h:apple tv+/away | Quality over quantity 65% | Quality over quantity 55% | 10 |
| Data page - Every contest | fights:leavers:max/to | Want broad variety 59% | Want broad variety 49% | 10 |
| Data page - Every contest | chooses:open:kids-first household/away | Specific shows and franchises 49% | Specific shows and franchises 40% | 9 |
| | ... 13 more changed places (raw JSON) | | | |

**Google Pixel** - 30 numbers move in 30 places (Data page - Every contest 30).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Data page - Every contest | chooses:open:midrange value hunt/to | Photos over video 51% | Photos over video 17% | 34 |
| Data page - Every contest | chooses:open:midrange value hunt/away | Choose a lower-cost iPhone 47% | Choose a lower-cost iPhone 18% | 29 |
| Data page - Every contest | settled:settled:all/away | Durable smartwatch 28% | Durable smartwatch 2% | 26 |
| Data page - Every contest | settled:settled:ecosystem/away | Durable smartwatch 28% | Durable smartwatch 5% | 23 |
| Data page - Every contest | chooses:open:first phone for teen/to | Stay on Android 44% | Stay on Android 23% | 21 |
| Data page - Every contest | chooses:open:friends and family photos/to | Photos over video 60% | Photos over video 42% | 18 |
| Data page - Every contest | chooses:open:all/to | Photos over video 38% | Photos over video 22% | 16 |
| Data page - Every contest | chooses:social:all/to | Photos over video 60% | Photos over video 45% | 15 |
| Data page - Every contest | fights:h2h:oneplus/to | Photos over video 66% | Photos over video 51% | 15 |
| Data page - Every contest | settled:settled:all/to | Travel light for ordinary trips 41% | Travel light for ordinary trips 26% | 15 |
| Data page - Every contest | fights:h2h:motorola/to | Long support and ownership 48% | Long support and ownership 34% | 14 |
| Data page - Every contest | fights:h2h:all/to | Photos over video 53% | Photos over video 40% | 13 |
| Data page - Every contest | fights:h2h:samsung galaxy/to | Photos over video 48% | Photos over video 35% | 13 |
| Data page - Every contest | chooses:open:plan promo shopper/to | Spend less 40% | Spend less 29% | 11 |
| Data page - Every contest | fights:h2h:apple iphone/to | Photos over video 55% | Photos over video 44% | 11 |
| Data page - Every contest | chooses:open:all/away | Already use Apple 41% | Already use Apple 32% | 9 |
| Data page - Every contest | chooses:open:first phone for teen/away | Already use Apple 67% | Already use Apple 61% | 6 |
| Data page - Every contest | chooses:open:friends and family photos/away | Better video 59% | Better video 53% | 6 |
| Data page - Every contest | chooses:social:all/away | Already use Apple 37% | Already use Apple 31% | 6 |
| Data page - Every contest | fights:h2h:apple iphone/away | Already use Apple 92% | Already use Apple 86% | 6 |
| Data page - Every contest | chooses:open:plan promo shopper/away | Open to switching platforms 55% | Open to switching platforms 50% | 5 |
| Data page - Every contest | fights:h2h:motorola/away | Want a foldable 69% | Want a foldable 65% | 4 |
| Data page - Every contest | settled:settled:expansion/to | Travel light for ordinary trips 82% | Travel light for ordinary trips 78% | 4 |
| Data page - Every contest | fights:leavers:motorola/to | Clean, customizable software 61% | Clean, customizable software 58% | 3 |
| Data page - Every contest | fights:leavers:oneplus/to | Clean, customizable software 65% | Clean, customizable software 62% | 3 |
| | ... 5 more changed places (raw JSON) | | | |

**Jira** - 29 numbers move in 29 places (Data page - Every contest 29).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Data page - Every contest | settled:settled:expansion/away | Broader work beyond software 88% | Broader work beyond software 5% | 83 |
| Data page - Every contest | settled:settled:all/away | Customer-led product strategy 78% | Customer-led product strategy 13% | 65 |
| Data page - Every contest | settled:settled:all/to | Already using Atlassian 56% | Already using Atlassian 16% | 40 |
| Data page - Every contest | chooses:open:client-facing delivery/to | Already using Atlassian 57% | Already using Atlassian 19% | 38 |
| Data page - Every contest | fights:leavers:clickup/to | Engineering-led software work 76% | Engineering-led software work 55% | 21 |
| Data page - Every contest | chooses:open:all/to | Engineering-led software work 39% | Engineering-led software work 27% | 12 |
| Data page - Every contest | settled:settled:expansion/to | Product discovery and prioritization 39% | Product discovery and prioritization 28% | 11 |
| Data page - Every contest | chooses:open:first team system/to | Complex workflows and flexibility 44% | Complex workflows and flexibility 35% | 9 |
| Data page - Every contest | chooses:open:legacy replacement/to | Engineering-led software work 46% | Engineering-led software work 37% | 9 |
| Data page - Every contest | chooses:open:company standardization/to | Engineering-led software work 57% | Engineering-led software work 50% | 7 |
| Data page - Every contest | settled:settled:ecosystem/away | Customer-led product strategy 83% | Customer-led product strategy 78% | 5 |
| Data page - Every contest | chooses:open:legacy replacement/away | Software and engineering workflows 70% | Software and engineering workflows 66% | 4 |
| Data page - Every contest | fights:h2h:linear/away | Software and engineering workflows 66% | Software and engineering workflows 62% | 4 |
| Data page - Every contest | fights:leavers:all/to | Complex workflows and flexibility 40% | Complex workflows and flexibility 37% | 3 |
| Data page - Every contest | chooses:open:client-facing delivery/away | Client visibility and approvals 62% | Client visibility and approvals 60% | 2 |
| Data page - Every contest | chooses:open:company standardization/away | Broader work beyond software 85% | Broader work beyond software 83% | 2 |
| Data page - Every contest | chooses:open:first team system/away | Software and engineering workflows 85% | Software and engineering workflows 83% | 2 |
| Data page - Every contest | chooses:social:all/to | Large or scaling organizations 53% | Large or scaling organizations 51% | 2 |
| Data page - Every contest | fights:h2h:all/away | Software and engineering workflows 67% | Software and engineering workflows 65% | 2 |
| Data page - Every contest | fights:h2h:clickup/away | Broader work beyond software 98% | Broader work beyond software 96% | 2 |
| Data page - Every contest | fights:h2h:github/away | Software and engineering workflows 94% | Software and engineering workflows 92% | 2 |
| Data page - Every contest | settled:settled:ecosystem/to | Already using Atlassian 70% | Already using Atlassian 68% | 2 |
| Data page - Every contest | chooses:open:all/away | Broader work beyond software 58% | Broader work beyond software 57% | 1 |
| Data page - Every contest | chooses:social:all/away | Software and engineering workflows 89% | Software and engineering workflows 88% | 1 |
| Data page - Every contest | fights:h2h:all/to | Complex workflows and flexibility 51% | Complex workflows and flexibility 50% | 1 |
| | ... 4 more changed places (raw JSON) | | | |

**American Express** - 40 numbers move in 40 places (Data page - Every contest 40).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Data page - Every contest | settled:settled:all/away | Prefer Chase rewards 100% | Prefer Chase rewards <1% | 100 |
| Data page - Every contest | settled:settled:ecosystem/to | Amex offers better rewards 100% | Amex offers better rewards 1% | 99 |
| Data page - Every contest | settled:settled:expansion/away | Prefer Chase rewards 100% | Prefer Chase rewards 1% | 99 |
| Data page - Every contest | settled:settled:all/to | Put existing spend to use 59% | Put existing spend to use 14% | 45 |
| Data page - Every contest | fights:leavers:discover/to | Dining is a major expense 81% | Dining is a major expense 48% | 33 |
| Data page - Every contest | chooses:social:all/to | Dining is a major expense 79% | Dining is a major expense 52% | 27 |
| Data page - Every contest | chooses:open:everyday spender/to | Dining is a major expense 82% | Dining is a major expense 57% | 25 |
| Data page - Every contest | fights:h2h:class-visa/away | Keep rewards simple 69% | Keep rewards simple 48% | 21 |
| Data page - Every contest | fights:leavers:citi/to | Dining is a major expense 62% | Dining is a major expense 43% | 19 |
| Data page - Every contest | fights:leavers:all/to | Dining is a major expense 71% | Dining is a major expense 53% | 18 |
| Data page - Every contest | fights:h2h:class-mastercard/away | Keep rewards simple 73% | Keep rewards simple 56% | 17 |
| Data page - Every contest | chooses:open:small business owner/to | Moderate everyday spending 36% | Moderate everyday spending 20% | 16 |
| Data page - Every contest | fights:h2h:chase/away | Keep rewards simple 40% | Keep rewards simple 24% | 16 |
| Data page - Every contest | fights:leavers:chase/to | Dining is a major expense 68% | Dining is a major expense 56% | 12 |
| Data page - Every contest | chooses:open:everyday spender/away | Keep rewards simple 61% | Keep rewards simple 50% | 11 |
| Data page - Every contest | chooses:social:all/away | Prefer cash back 51% | Prefer cash back 40% | 11 |
| Data page - Every contest | fights:h2h:capital one/away | Keep rewards simple 48% | Keep rewards simple 38% | 10 |
| Data page - Every contest | fights:leavers:capital one/to | Dining is a major expense 74% | Dining is a major expense 64% | 10 |
| Data page - Every contest | chooses:open:small business owner/away | Earn more on concentrated spending 70% | Earn more on concentrated spending 61% | 9 |
| Data page - Every contest | chooses:open:all/to | Dining is a major expense 36% | Dining is a major expense 28% | 8 |
| Data page - Every contest | fights:h2h:all/away | Keep rewards simple 41% | Keep rewards simple 33% | 8 |
| Data page - Every contest | fights:h2h:discover/away | Prefer cash back 59% | Prefer cash back 52% | 7 |
| Data page - Every contest | fights:h2h:discover/to | Want premium travel perks 56% | Want premium travel perks 49% | 7 |
| Data page - Every contest | fights:h2h:citi/away | Prefer cash back 51% | Prefer cash back 45% | 6 |
| Data page - Every contest | fights:h2h:citi/to | Want premium travel perks 71% | Want premium travel perks 65% | 6 |
| | ... 15 more changed places (raw JSON) | | | |

## Ruling 5: problem questions 'outside the category' = 'adjacent' only, 'none' its own share

The card already shows 'adjacent' and 'none' separately (its detail lists both, of all answers), and so do the Overview inputs and the Data page. The one place that differs is the Map card's claim, which divides 'adjacent' by the answers that point to any solution (category + adjacent, leaving 'none' out of the base). Dividing by all answers moves **2 numbers**: Map position (claim / figures / conditions) 2. The claim's wording ('of the answers that point to a solution') would change with it. Largest: Google Pixel chooses:awareness:all.claim Across every problem question, Google Pi -> Across every problem question, Google Pi; Google Pixel chooses:awareness:plan promo shopper.claim In Plan promo shopper's problem question -> In Plan promo shopper's problem question.

**Sephora**: nothing on screen moves.

**Doritos**: nothing on screen moves.

**Netflix**: nothing on screen moves.

**Google Pixel** - 2 numbers move in 2 places (Map position (claim / figures / conditions) 2).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Map position (claim / figures / conditions) | chooses:awareness:all.claim | Across every problem question, Google Pixel is named in 20% of answers and recommended in <1% - too few answers recommend any brand to call who the category is explained… | Across every problem question, Google Pixel is named in 20% of answers and recommended in <1% - too few answers recommend any brand to call who the category is explained… | 1 |
| Map position (claim / figures / conditions) | chooses:awareness:plan promo shopper.claim | In Plan promo shopper's problem questions, Google Pixel is named in 31% of answers and recommended in 2% - too few answers recommend any brand to call who the category i… | In Plan promo shopper's problem questions, Google Pixel is named in 31% of answers and recommended in 2% - too few answers recommend any brand to call who the category i… | 1 |

**Jira**: nothing on screen moves.

**American Express**: nothing on screen moves.

## Ruling 6: a pick counts as a recommendation everywhere

Applied in the engine's one 'recommends' function (analysis_map.ts recommendsOf), so every card, Map figure and finding counts the pick. **0 numbers move.** The rival's 'Recommended' bar on problem, popular and premium cards is the only place that left the pick out; problem questions carry no pick at all, and on popular and premium questions every pick on the snapshot is also coded as a recommended mention of the same brand (two Doritos popular picks are worded differently but resolve to the same brand), so nothing moves today.

**Sephora**: nothing on screen moves.

**Doritos**: nothing on screen moves.

**Netflix**: nothing on screen moves.

**Google Pixel**: nothing on screen moves.

**Jira**: nothing on screen moves.

**American Express**: nothing on screen moves.

## Ruling 7: the all-buyers What to buy = the buyer cards only (discovery + use_case)

Today the all-buyers What to buy card and everything that reads the headline pool (Overview header and board, Brief scoreboard, By rival pages' what-to-buy rows, the headline view, the Data page's What to buy pool) also pool What's popular (5 questions, 65 answers) and, on Doritos, Netflix and Sephora, Premium vs basic (130 answers). Taking them out moves **6789 numbers on screen** (By rival page 3064, Map card (panel) 1138, Brief (own subject) 885, Data page tables 823, Question type detail (views) 596, Overview 250, Data page - Every contest 15, Map position (claim / figures / conditions) 12, Map cell 6); 1809 more move in places not drawn today. Largest: Sephora map.casting.detail Recommended in 31% of the answers that p -> Named in 79% of answers when buyers ask ; Netflix rival:Amazon Prime Video::steps/open/conditions/away/Prime … 46% -> 0%; Jira brief.matrix.sections[matrix].table.rows[9][2] 9% -> 52%.

Headline figures, before and after, for the tracker's brand and the five competitors with the most picks before (the card's own figures; a rival's are its By rival page's, which equal the card's). 'Commit' is the share of what-to-buy answers that name one pick in the category.

**Sephora**

| Brand | Named | Recommended | Share of picks | Picked, of all answers |
|---|---|---|---|---|
| Sephora (you) | 81% -> 79% | 44% -> 40% | 5% | 1.9% -> 2.1% |
| Ulta Beauty | 94% -> 95% | 69% | 77% | 28% -> 32% |
| Target | 69% | 41% -> 40% | 6% -> 5% | 2% -> 2.3% |
| Walmart | 31% | 13% | 5% | 1.9% -> 2.3% |
| Dermstore | 40% -> 42% | 23% -> 24% | 3% | 1.2% -> 1.4% |
| Sally Beauty | 7% | 4% | 2% | 0.7% -> 0.9% |
| Commit rate | | | 36% (450/1235) -> 42% (437/1040) | |

**Doritos**

| Brand | Named | Recommended | Share of picks | Picked, of all answers |
|---|---|---|---|---|
| Doritos (you) | 71% -> 78% | 41% -> 46% | 13% | 5.6% -> 6.6% |
| Lay's | 76% -> 81% | 44% -> 49% | 34% -> 35% | 15% -> 18% |
| Ruffles | 50% -> 53% | 27% -> 31% | 15% -> 16% | 6.9% -> 8.2% |
| Kettle Brand | 43% -> 41% | 21% | 6% | 2.8% -> 3% |
| Cape Cod | 38% -> 36% | 16% | 6% | 2.6% -> 3% |
| Tostitos | 33% -> 36% | 22% -> 25% | 5% | 2.3% -> 2.7% |
| Commit rate | | | 45% (551/1235) -> 51% (533/1040) | |

**Netflix**

| Brand | Named | Recommended | Share of picks | Picked, of all answers |
|---|---|---|---|---|
| Netflix (you) | 90% -> 91% | 61% -> 65% | 53% -> 51% | 28% -> 31% |
| Disney+ | 71% -> 72% | 43% -> 46% | 24% | 13% -> 15% |
| PBS Kids | 18% -> 21% | 16% -> 19% | 9% -> 10% | 5% -> 6% |
| Max (HBO) | 68% -> 67% | 35% -> 34% | 5% -> 4% | 2.7% -> 2.5% |
| Tubi | 28% -> 25% | 15% -> 13% | 3% | 1.5% -> 1.8% |
| Apple TV+ | 46% -> 45% | 17% -> 14% | 3% | 1.5% -> 1.7% |
| Commit rate | | | 54% (668/1235) -> 60% (626/1040) | |

**Google Pixel**

| Brand | Named | Recommended | Share of picks | Picked, of all answers |
|---|---|---|---|---|
| Google Pixel (you) | 83% -> 82% | 59% -> 58% | 22% -> 23% | 6.8% -> 7.2% |
| Apple iPhone | 91% -> 90% | 66% -> 65% | 67% -> 66% | 20% -> 21% |
| Samsung Galaxy | 82% -> 81% | 55% -> 54% | 4% -> 5% | 1.4% |
| Vivo | 4% -> 5% | 2% | 3% | 0.8% -> 0.9% |
| Gabb | 14% -> 15% | 8% | 3% | 0.8% -> 0.9% |
| OnePlus | 15% -> 11% | 8% -> 6% | 1% | 0.2% |
| Commit rate | | | 30% (335/1105) -> 31% (327/1040) | |

**Jira**

| Brand | Named | Recommended | Share of picks | Picked, of all answers |
|---|---|---|---|---|
| Jira (you) | 85% -> 84% | 57% -> 55% | 26% -> 25% | 10% |
| Teamwork | 20% -> 21% | 17% -> 18% | 22% -> 23% | 8.6% -> 9.1% |
| Linear | 69% -> 67% | 51% -> 49% | 20% | 7.9% -> 8.2% |
| Asana | 77% | 46% -> 45% | 13% | 5.1% -> 5.4% |
| YouTrack | 20% -> 18% | 10% | 5% | 1.9% -> 2% |
| Wrike | 26% -> 27% | 15% -> 16% | 4% | 1.4% -> 1.5% |
| Commit rate | | | 38% (425/1105) -> 40% (415/1040) | |

**American Express**

| Brand | Named | Recommended | Share of picks | Picked, of all answers |
|---|---|---|---|---|
| American Express (you) | 89% -> 88% | 64% -> 65% | 16% | 6.4% -> 6.8% |
| Capital One | 81% -> 80% | 62% | 35% | 14% -> 15% |
| Wells Fargo | 36% -> 34% | 26% | 20% | 8.1% -> 8.6% |
| Chase | 76% -> 75% | 53% | 20% | 8.1% -> 8.6% |
| Citi | 57% -> 55% | 31% | 6% | 2.6% -> 2.8% |
| Visa | 27% | 10% -> 9% | 1% | 0.5% -> 0.6% |
| Commit rate | | | 41% (450/1105) -> 43% (448/1040) | |

Drawn numbers that change on the all-buyers What to buy card and on the By rival pages (the 'of' is every number those screens draw today):

| Tracker | All-buyers What to buy card | By rival pages (all rivals) | Other cards |
|---|---|---|---|
| Sephora | 67 of 100 | 629 of 2051 | 123 |
| Doritos | 71 of 102 | 723 of 2203 | 108 |
| Netflix | 73 of 99 | 595 of 1792 | 170 |
| Google Pixel | 52 of 98 | 314 of 1121 | 119 |
| Jira | 64 of 107 | 600 of 2530 | 137 |
| American Express | 58 of 107 | 203 of 1181 | 96 |

Why other cards move: every card that compares with 'the usual' or 'all buyers' (the buyer cards' usual is the all-buyers card; the What to look for card reads the all-buyers picks for its winning arguments) reads the all-buyers pool. How it was applied: `poolOf("headline")` keeps discovery and use_case only; the What's popular card still reads its own social_validation answers and Premium vs basic its own pool; the Data page's What to buy pool drops the two stages (social_validation then has no Data page pool - an open design point). Kept unchanged on purpose: the rules explorer's run-wide condition pass, because changing its inputs changes the reason-theme call's inputs and, with no API key, the themes cannot be recomputed - in production that is one re-grouping call. So condition rows on the cards below are counted on unchanged groupings.

**Sephora** - 1267 numbers move in 1184 places (By rival page 629, Map card (panel) 190, Brief (own subject) 153, Data page tables 133, Question type detail (views) 110, Overview 50, Map position (claim / figures / conditions) 1, Data page - Every contest 1); of those, 313 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Overview | map.casting.detail | Recommended in 31% of the answers that pick another brand, yet the pick only 5% of the time - Ulta Beauty takes 77%; compared with a rival directly, it wins 71% of match… | Named in 79% of answers when buyers ask what to buy, but the pick only 5% of the time, against 77% for Ulta Beauty; it wins 71% of direct matchups. | 48 |
| By rival page | rival:Beautylish::steps/open/body/0 | <1% | 19% | 19 |
| By rival page | rival:Macy's::steps/open/body/1 | <1% | 19% | 19 |
| By rival page | rival:Neiman Marcus::steps/open/body/0 | <1% | 19% | 19 |
| By rival page | rival:Violet Grey::steps/open/body/0 | <1% | 19% | 19 |
| By rival page | rival:Beautylish::steps/open/body/1 | 20% | 5% | 15 |
| By rival page | rival:Macy's::steps/open/body/2 | 20% | 5% | 15 |
| By rival page | rival:Neiman Marcus::steps/open/body/1 | 20% | 5% | 15 |
| By rival page | rival:Violet Grey::steps/open/body/1 | 20% | 5% | 15 |
| Data page tables | by_engine/ChatGPT (free tier)/Recommended | 34% (32/95) | 24% (19/80) | 10 |
| Question type detail (views) | view.headline.byEngine[gpt-6-luna].recommended | 34% (32/95) | 24% (19/80) | 10 |
| Question type detail (views) | view.headline.byEngine[gpt-6-sol-search].firmPickInCategory | 61% (58/95) | 71% (57/80) | 10 |
| Question type detail (views) | view.headline.byEngine[sonar].firmPickInCategory | 59% (56/95) | 69% (55/80) | 10 |
| Data page tables | by_engine/ChatGPT (paid tier) + search/Recommended | 37% (35/95) | 28% (22/80) | 9 |
| Data page tables | by_vendor/ChatGPT/Recommended | 37% (140/380) | 28% (90/320) | 9 |
| Question type detail (views) | view.headline.byEngine[gpt-6-luna-search].firmPickInCategory | 49% (47/95) | 58% (46/80) | 9 |
| Question type detail (views) | view.headline.byEngine[gpt-6-sol-search].recommended | 37% (35/95) | 28% (22/80) | 9 |
| Data page tables | by_engine/ChatGPT (free tier) + search/Recommended | 38% (36/95) | 30% (24/80) | 8 |
| Data page tables | by_engine/ChatGPT (paid tier)/Recommended | 39% (37/95) | 31% (25/80) | 8 |
| Overview | summary.insights[pick_concentration_room].body | 83% of the times the AI picks Sephora when buyers ask what to buy come from one buying situation, Skin changes - there you take 21% of the picks, everywhere else 1%. | 91% of the times the AI picks Sephora when buyers ask what to buy come from one buying situation, Skin changes - there you take 21% of the picks, everywhere else 1%. | 8 |
| Overview | summary.insights[pick_concentration_room].viz[Your picks from Skin changes].text | 83% | 91% | 8 |
| Overview | summary.verdict[concentration].text | 83% of its picks come from one buying situation, Skin changes. | 91% of its picks come from one buying situation, Skin changes. | 8 |
| Question type detail (views) | view.headline.byEngine[gemini-pro-latest].firmPickInCategory | 42% (40/95) | 50% (40/80) | 8 |
| Question type detail (views) | view.headline.byEngine[gpt-6-luna-search].recommended | 38% (36/95) | 30% (24/80) | 8 |
| Question type detail (views) | view.headline.byEngine[gpt-6-sol].recommended | 39% (37/95) | 31% (25/80) | 8 |
| | ... 846 more changed places (raw JSON) | | | |

**Doritos** - 1428 numbers move in 1354 places (By rival page 723, Data page tables 191, Map card (panel) 179, Brief (own subject) 151, Question type detail (views) 137, Overview 41, Data page - Every contest 3, Map position (claim / figures / conditions) 2, Map cell 1); of those, 315 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| By rival page | rival:Great Value::steps/named/body/converts | 25% (4/16) | 0% (0/3) | 25 |
| By rival page | rival:Santitas::steps/named/body/converts | 13% (1/8) | 0% (0/7) | 13 |
| Brief (own subject) | brief.matrix.sections[matrix].table.rows[7][2] | 7% | 19% | 12 |
| Data page tables | by_engine/Grok (free & paid tiers)/Named | 86% (82/95) | 98% (78/80) | 12 |
| Data page tables | by_tier/Free & paid/Named | 86% (82/95) | 98% (78/80) | 12 |
| Data page tables | by_vendor/Grok/Named | 86% (82/95) | 98% (78/80) | 12 |
| Question type detail (views) | view.headline.byEngine[grok-4.6].mentioned | 86% (82/95) | 98% (78/80) | 12 |
| Data page tables | by_engine/Claude (free tier) + search/Named | 73% (69/95) | 84% (67/80) | 11 |
| Data page tables | by_engine/Grok (free & paid tiers)/Recommended | 57% (54/95) | 68% (54/80) | 11 |
| Data page tables | by_tier/Free & paid/Recommended | 57% (54/95) | 68% (54/80) | 11 |
| Data page tables | by_vendor/Grok/Recommended | 57% (54/95) | 68% (54/80) | 11 |
| Question type detail (views) | view.headline.byEngine[claude-sonnet-5-search].mentioned | 73% (69/95) | 84% (67/80) | 11 |
| Question type detail (views) | view.headline.byEngine[gpt-5.6-sol-search].firmPickInCategory | 69% (66/95) | 80% (64/80) | 11 |
| Question type detail (views) | view.headline.byEngine[grok-4.6].recommended | 57% (54/95) | 68% (54/80) | 11 |
| By rival page | rival:Boulder Canyon::steps/open/body/1 | <1% | 10% | 10 |
| By rival page | rival:Clancy's::steps/open/body/0 | <1% | 10% | 10 |
| By rival page | rival:Funyuns::steps/open/body/1 | <1% | 10% | 10 |
| By rival page | rival:Great Value::steps/open/body/1 | <1% | 10% | 10 |
| By rival page | rival:Kirkland::steps/open/body/0 | <1% | 10% | 10 |
| Brief (own subject) | brief.matrix.sections[matrix].table.rows[5][2] | 16% | 7% | 9 |
| By rival page | rival:Miss Vickie's::steps/open/table/What the answer weighs/Flavor profile/0 | 69% (9/13) | 60% (6/10) | 9 |
| Data page tables | by_engine/Claude (free tier)/Named | 49% (47/95) | 58% (46/80) | 9 |
| Question type detail (views) | view.headline.byEngine[claude-sonnet-5].mentioned | 49% (47/95) | 58% (46/80) | 9 |
| Question type detail (views) | view.headline.byEngine[gemini-3.6-flash].firmPickInCategory | 52% (49/95) | 61% (49/80) | 9 |
| Question type detail (views) | view.headline.byEngine[gpt-5.6-sol].firmPickInCategory | 49% (47/95) | 58% (46/80) | 9 |
| | ... 1014 more changed places (raw JSON) | | | |

**Netflix** - 1320 numbers move in 1249 places (By rival page 595, Map card (panel) 243, Data page tables 169, Brief (own subject) 140, Question type detail (views) 119, Overview 48, Data page - Every contest 3, Map position (claim / figures / conditions) 2, Map cell 1); of those, 155 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| By rival page | rival:Amazon Prime Video::steps/open/conditions/away/Prime benefits included/youPicked | 46% (21/46) | 0% (0/5) | 46 |
| By rival page | rival:Pluto::steps/open/conditions/away/Keep costs low/youPicked | 64% (9/14) | 82% (9/11) | 18 |
| By rival page | rival:Tubi::steps/open/conditions/away/Keep costs low/youPicked | 60% (15/25) | 75% (12/16) | 15 |
| Map card (panel) | cell:chooses:open:all/rival:Tubi::conditions/away/Keep costs low/youPicked | 60% (15/25) | 75% (12/16) | 15 |
| By rival page | rival:Shudder::steps/open/body/1 | <1% | 15% | 15 |
| By rival page | rival:Apple TV+::steps/open/conditions/away/Specific shows and franchises/youPicked | 44% (12/27) | 58% (11/19) | 14 |
| Map card (panel) | cell:chooses:open:all/rival:Apple TV+::conditions/away/Specific shows and franchises/youP… | 44% (12/27) | 58% (11/19) | 14 |
| By rival page | rival:Apple TV+::steps/open/conditions/away/Quality over quantity/youPicked | 42% (30/72) | 30% (13/43) | 12 |
| Map card (panel) | cell:chooses:open:all/rival:Apple TV+::conditions/away/Quality over quantity/youPicked | 42% (30/72) | 30% (13/43) | 12 |
| Map card (panel) | cell:chooses:open:all/rival:Max (HBO)::weighs/plain/0/Price/other | 12% (4/33) | 0% (0/26) | 12 |
| By rival page | rival:Criterion Channel::steps/open/conditions/away/Movie library and rentals/youPicked | 11% (2/18) | 0% (0/6) | 11 |
| By rival page | rival:Pluto::steps/open/conditions/away/Casual and comfort viewing/youPicked | 14% (2/14) | 25% (2/8) | 11 |
| By rival page | rival:Max (HBO)::steps/open/conditions/away/Best value for money/youPicked | 27% (6/22) | 17% (3/18) | 10 |
| Map card (panel) | cell:chooses:open:all/rival:Max (HBO)::conditions/away/Best value for money/youPicked | 27% (6/22) | 17% (3/18) | 10 |
| Overview | summary.insights[engine_pick_concentration].body | Gemini's 2 assistants supply 67% of Max (HBO)'s picks while answering 15% of the questions - a read without them would put Max (HBO) far lower. | Gemini's 2 assistants supply 77% of Max (HBO)'s picks while answering 15% of the questions - a read without them would put Max (HBO) far lower. | 10 |
| Overview | summary.insights[engine_pick_concentration].viz[Picks from Gemini].text | 67% | 77% | 10 |
| Question type detail (views) | view.headline.byEngine[gemini-3.6-flash].firmPickInCategory | 60% (57/95) | 70% (56/80) | 10 |
| Question type detail (views) | view.headline.byEngine[grok-4.6].firmPickInCategory | 49% (47/95) | 59% (47/80) | 10 |
| By rival page | rival:Crunchyroll::steps/open/conditions/away/Specific genres/youPicked | 21% (13/61) | 12% (4/34) | 9 |
| By rival page | rival:Max (HBO)::steps/open/table/What the answer weighs/Catalog depth/0 | 45% (15/33) | 54% (14/26) | 9 |
| By rival page | rival:Shudder::steps/open/body/2 | 14% | 5% | 9 |
| Map card (panel) | cell:chooses:open:all/rival:Max (HBO)::weighs/plain/1/Catalog depth/num | 45% (15/33) | 54% (14/26) | 9 |
| Question type detail (views) | view.headline.byEngine[claude-sonnet-5-search].firmPickInCategory | 49% (47/95) | 58% (46/80) | 9 |
| Brief (own subject) | brief.matrix.sections[matrix].table.rows[6][2] | 4% | 12% | 8 |
| By rival page | rival:MUBI::steps/open/conditions/away/Movie library and rentals/youPicked | 8% (1/12) | 0% (0/9) | 8 |
| | ... 1069 more changed places (raw JSON) | | | |

**Google Pixel** - 884 numbers move in 792 places (By rival page 314, Map card (panel) 171, Brief (own subject) 162, Data page tables 103, Question type detail (views) 79, Overview 47, Map position (claim / figures / conditions) 3, Data page - Every contest 3, Map cell 2); of those, 104 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| By rival page | rival:OnePlus::claim/0 | 15% | 11% | 4 |
| By rival page | rival:OnePlus::steps/named/bar/rival | 15% (169/1105) | 11% (119/1040) | 4 |
| By rival page | rival:OnePlus::steps/named/body/named | 15% (169/1105) | 11% (119/1040) | 4 |
| Data page tables | funnel_brand/OnePlus/Named | 15% (169/1105) | 11% (119/1040) | 4 |
| Question type detail (views) | view.headline.brands[4c3309bf-f634-4605-ad4c-f4a55e1d7c6c].mentioned | 15% (169/1105) | 11% (119/1040) | 4 |
| By rival page | rival:Apple iPhone::products/Which of its smartphones it picks/iPhone 17/0 | 16% (35/225) | 13% (28/217) | 3 |
| Data page tables | by_engine/ChatGPT (free tier)/Recommended | 59% (50/85) | 56% (45/80) | 3 |
| Data page tables | by_engine/Perplexity (paid tier)/Recommended | 64% (54/85) | 61% (49/80) | 3 |
| Question type detail (views) | view.headline.brands[f35f3772-c70e-4d36-bd12-05ecc9a4318e].negative | 19% (9/48) | 22% (9/41) | 3 |
| Question type detail (views) | view.headline.byEngine[gpt-5.6-luna].recommended | 59% (50/85) | 56% (45/80) | 3 |
| Question type detail (views) | view.headline.byEngine[sonar-pro].recommended | 64% (54/85) | 61% (49/80) | 3 |
| By rival page | rival:Apple iPhone::steps/open/table/What the answer weighs/Performance/0 | 44% (100/225) | 46% (99/217) | 2 |
| By rival page | rival:Apple iPhone::steps/open/table/What the answer weighs/Storage memory/0 | 40% (91/225) | 42% (91/217) | 2 |
| By rival page | rival:OnePlus::steps/named/body/recommended | 8% (85/1105) | 6% (58/1040) | 2 |
| By rival page | rival:OnePlus::steps/open/body/0 | 5% | 3% | 2 |
| By rival page | rival:OnePlus::steps/open/conditions/away/Long battery life/share | 5% (51/1105) | 3% (32/1040) | 2 |
| By rival page | rival:Samsung Galaxy::steps/open/conditions/away/Stay on Android/share | 7% (76/1105) | 5% (57/1040) | 2 |
| By rival page | rival:Xiaomi::steps/open/conditions/away/Depends on availability/youPicked | 25% (3/12) | 27% (3/11) | 2 |
| Map card (panel) | cell:chooses:criteria:all::table/What the answer weighs, against the checklist/Price valu… | 16% (42/260) | 14% (36/252) | 2 |
| Map card (panel) | cell:chooses:open:all/rival:Apple iPhone::weighs/plain/1/Performance/num | 44% (100/225) | 46% (99/217) | 2 |
| Map card (panel) | cell:chooses:open:all/rival:Apple iPhone::weighs/plain/1/Storage memory/num | 40% (91/225) | 42% (91/217) | 2 |
| Map card (panel) | cell:chooses:open:all/rival:Vivo::detail/converts/outcome/Google Pixel/none | 68% (443/653) | 66% (402/605) | 2 |
| Map card (panel) | cell:chooses:open:all::detail/converts/outcome/You/none | 68% (443/653) | 66% (402/605) | 2 |
| Map card (panel) | cell:chooses:open:all::detailComp/converts/outcome/You/none | 68% (443/653) | 66% (402/605) | 2 |
| Map card (panel) | cell:chooses:open:all::weighs/plain/0/Camera image quality/num | 45% (495/1105) | 43% (451/1040) | 2 |
| | ... 663 more changed places (raw JSON) | | | |

**Jira** - 1242 numbers move in 1172 places (By rival page 600, Map card (panel) 201, Brief (own subject) 158, Data page tables 145, Question type detail (views) 93, Overview 37, Map position (claim / figures / conditions) 3, Data page - Every contest 3, Map cell 2); of those, 164 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Brief (own subject) | brief.matrix.sections[matrix].table.rows[9][2] | 9% | 52% | 43 |
| By rival page | rival:Aha!::steps/open/body/1 | <1% | 27% | 27 |
| Brief (own subject) | brief.matrix.sections[matrix].table.rows[9][3] | 4% | 23% | 19 |
| Brief (own subject) | brief.matrix.sections[matrix].table.rows[7][2] | 1% | 13% | 12 |
| By rival page | rival:Aha!::steps/open/body/2 | 27% | 17% | 10 |
| By rival page | rival:ClickUp::steps/open/conditions/away/Software and engineering workflows/youPicked | 6% (2/36) | 0% (0/23) | 6 |
| By rival page | rival:Plane::steps/open/conditions/away/Lower cost and overhead/youPicked | 6% (1/17) | 0% (0/15) | 6 |
| Map card (panel) | cell:chooses:open:all::conditions/away/Broader work beyond software/to/ClickUp | 46% (286/625) | 40% (229/577) | 6 |
| Overview | summary.verdict[concentration].text | 75% of its picks come from one buying situation, Company standardization. | 81% of its picks come from one buying situation, Company standardization. | 6 |
| Brief (own subject) | brief.matrix.sections[matrix].table.rows[9][1] | 26% | 21% | 5 |
| Map card (panel) | cell:chooses:open:all::conditions/away/Software and engineering workflows/to/GitHub | 46% (256/555) | 41% (203/498) | 5 |
| By rival page | rival:Asana::steps/open/conditions/away/Software and engineering workflows/youPicked | 11% (5/44) | 15% (5/33) | 4 |
| By rival page | rival:Asana::steps/open/table/What the answer weighs/Process fit/1 | 35% (39/112) | 31% (32/104) | 4 |
| By rival page | rival:Asana::steps/open/table/What the answer weighs/Roadmaps and portfolio/1 | 59% (66/112) | 63% (66/104) | 4 |
| By rival page | rival:ClickUp::steps/open/body/0 | 26% | 22% | 4 |
| By rival page | rival:ClickUp::steps/open/conditions/away/Broader work beyond software/share | 26% (286/1105) | 22% (229/1040) | 4 |
| By rival page | rival:ClickUp::steps/open/conditions/away/Custom workflows and structure/youPicked | 4% (1/25) | 0% (0/22) | 4 |
| By rival page | rival:GitHub::steps/named/body/recommended | 21% (231/1105) | 17% (176/1040) | 4 |
| By rival page | rival:GitHub::steps/open/conditions/away/Existing tools and ecosystems/youPicked | 8% (10/118) | 4% (4/93) | 4 |
| By rival page | rival:Linear::steps/open/table/What the answer weighs/Agile execution/1 | 12% (13/112) | 8% (8/104) | 4 |
| By rival page | rival:Linear::steps/open/table/What the answer weighs/Roadmaps and portfolio/1 | 59% (66/112) | 63% (66/104) | 4 |
| By rival page | rival:ONES.com::steps/open/table/What the answer weighs/Roadmaps and portfolio/1 | 59% (66/112) | 63% (66/104) | 4 |
| By rival page | rival:Teamwork::steps/open/table/What the answer weighs/Roadmaps and portfolio/1 | 59% (66/112) | 63% (66/104) | 4 |
| By rival page | rival:Trello::steps/open/table/What the answer weighs/Roadmaps and portfolio/1 | 59% (66/112) | 63% (66/104) | 4 |
| By rival page | rival:Wrike::steps/open/table/What the answer weighs/Roadmaps and portfolio/1 | 59% (66/112) | 63% (66/104) | 4 |
| | ... 983 more changed places (raw JSON) | | | |

**American Express** - 648 numbers move in 581 places (By rival page 203, Map card (panel) 154, Brief (own subject) 121, Data page tables 82, Question type detail (views) 58, Overview 27, Data page - Every contest 2, Map position (claim / figures / conditions) 1); of those, 88 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| By rival page | rival:Citi::steps/open/conditions/away/Prefer cash back/youPicked | 5% (2/42) | 10% (2/21) | 5 |
| Map card (panel) | cell:chooses:open:all/rival:Citi::conditions/away/Prefer cash back/youPicked | 5% (2/42) | 10% (2/21) | 5 |
| Data page tables | by_engine/Claude (paid tier) + search/Recommended | 69% (59/85) | 74% (59/80) | 5 |
| Question type detail (views) | view.headline.byEngine[claude-opus-5-5-search].recommended | 69% (59/85) | 74% (59/80) | 5 |
| Question type detail (views) | view.headline.byEngine[gpt-5.6-sol-search].firmPickInCategory | 79% (67/85) | 84% (67/80) | 5 |
| By rival page | rival:Discover::claim/0 | 8% | 4% | 4 |
| By rival page | rival:Discover::steps/named/bar/rival | 8% (89/1105) | 4% (45/1040) | 4 |
| By rival page | rival:Discover::steps/named/body/named | 8% (89/1105) | 4% (45/1040) | 4 |
| Map card (panel) | cell:chooses:open:all::conditions/away/Premium travel and lounges/to/Capital One | 72% (146/203) | 68% (120/177) | 4 |
| Map card (panel) | cell:chooses:social:all::tables/Which of your credit cards it names/Gold Card/1 | 33% (321/981) | 29% (270/916) | 4 |
| Data page tables | by_engine/Claude (paid tier)/Recommended | 67% (57/85) | 71% (57/80) | 4 |
| Data page tables | funnel_brand/Discover/Named | 8% (89/1105) | 4% (45/1040) | 4 |
| Question type detail (views) | view.headline.brands[56d4be40-1ce2-4943-a130-72a2a914f2a5].mentioned | 8% (89/1105) | 4% (45/1040) | 4 |
| Question type detail (views) | view.headline.brands[56d4be40-1ce2-4943-a130-72a2a914f2a5].negative | 3% (3/89) | 7% (3/45) | 4 |
| Question type detail (views) | view.headline.byEngine[claude-opus-5-5-search].firmPickInCategory | 60% (51/85) | 64% (51/80) | 4 |
| Question type detail (views) | view.headline.byEngine[claude-opus-5-5].recommended | 67% (57/85) | 71% (57/80) | 4 |
| Map card (panel) | cell:chooses:open:all::conditions/away/Premium travel and lounges/to/Chase | 59% (119/203) | 56% (100/177) | 3 |
| Data page tables | by_engine/Grok (free & paid tiers)/Recommended | 52% (44/85) | 55% (44/80) | 3 |
| Data page tables | by_tier/Free & paid/Recommended | 52% (44/85) | 55% (44/80) | 3 |
| Data page tables | by_vendor/Claude/Recommended | 58% (198/340) | 61% (195/320) | 3 |
| Data page tables | by_vendor/Grok/Recommended | 52% (44/85) | 55% (44/80) | 3 |
| Overview | summary.insights[engine_decisiveness].body | When buyers ask what to buy, the AI commits to one brand in your category in 58% of answers with web search and 26% without web search - your share of those picks does n… | When buyers ask what to buy, the AI commits to one brand in your category in 61% of answers with web search and 28% without web search - your share of those picks does n… | 3 |
| Overview | summary.insights[engine_decisiveness].viz[With web search].text | 58% | 61% | 3 |
| Question type detail (views) | view.headline.byEngine[claude-sonnet-5-search].firmPickInCategory | 42% (36/85) | 45% (36/80) | 3 |
| Question type detail (views) | view.headline.byEngine[gpt-5.6-sol].firmPickInCategory | 52% (44/85) | 55% (44/80) | 3 |
| | ... 468 more changed places (raw JSON) | | | |

## Ruling 8: brands marked 'not for analysis'

No brand is marked 'not for analysis' on any of the six trackers in the snapshot: `dictionary_entries.analyzed` is empty (NULL) on every row, which the store reads as 'analyzed' (sqlite.ts: `analyzed ?? true`). Active entries per tracker: American Express 10, Doritos 32, Google Pixel 12, Jira 34, Netflix 24, Sephora 29 - all in analysis. So no answer picks a brand outside of analysis, the new bucket is empty, share of picks and the commit rate are unchanged, and **nothing moves today**. The ruling only bites once someone turns a brand off. (Checked on the snapshot, which copies the dictionary from live; live itself was not read.)

## Ruling 9: 'agrees the worry is fair' - the ruling moves nothing; below, the sensitivity reading: 'agrees the worry is fair' over confirms + rebuts, 'mixed' shown as no side

**The ruling as written moves nothing.** 'Of the answers that took a side' is doubt.ts's judged base: answers whose premise verdict is confirms, mixed or rebuts (`premiseCells`: `premise !== null`, where any other value is stored as null). The cards (worry card: confirms over confirms + mixed + rebuts), the Map claims and cells ('in X% of the answers that judge it'), the Data page ('valued': on-list values only) and the Overview's brand summary (`premise_verdict !== null`) all divide by that same set on this snapshot, because every buyers' and customers' worry answer on all six trackers carries one of the three values (no null, no 'n/a'). The Map's 'conceded' side (steer clear, or agrees and not told to go ahead) is a different measure, not an 'agrees' figure. So 0 numbers move.

Because 'took a side' could also be read as confirms or rebuts only (with 'mixed' = partly agrees, shown as no side), that reading was measured too: it moves **484 numbers on screen** (Question type detail (views) 205, Map card (panel) 103, Brief (own subject) 90, Overview 36, Map position (claim / figures / conditions) 22, Map cell 16, Data page tables 12), 183 more in undrawn places and build-your-own tables. Every 'agrees' share rises. Largest: American Express cell:doubts:customers:fee feels too high::steps/agrees/you 10% -> 100%; American Express view.doubt.keepOrLeave.rows[renewal/Fee feels too high].pre… 10% -> 100%; Google Pixel view.doubt.keepOrLeave.byEngine[claude-sonnet-5].confirms 35% -> 100%.

**Sephora** - 83 numbers move in 71 places (Question type detail (views) 29, Brief (own subject) 20, Map card (panel) 17, Overview 8, Map position (claim / figures / conditions) 4, Map cell 3, Data page tables 2); of those, 8 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5].confirms | 50% (15/30) | 94% (15/16) | 44 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-opus-5-5].confirms | 83% (25/30) | 100% (25/25) | 17 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5-search].confirms | 83% (25/30) | 96% (25/26) | 13 |
| Map card (panel) | cell:doubts:customers:staff can feel dismissive::steps/agrees/you | 87% (113/130) | 99% (113/114) | 12 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[churn_triggers/Staff can feel dismissive].premise.confirms | 87% (113/130) | 99% (113/114) | 12 |
| Question type detail (views) | view.doubt.objections.byEngine[claude-sonnet-5].confirms | 73% (29/40) | 83% (29/35) | 10 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[sonar-pro].confirms | 93% (28/30) | 100% (28/28) | 7 |
| Question type detail (views) | view.doubt.objections.byEngine[claude-opus-5-5].confirms | 65% (26/40) | 72% (26/36) | 7 |
| Map card (panel) | cell:doubts:customers:all::steps/agrees/you | 93% (361/390) | 99% (361/363) | 6 |
| Map card (panel) | cell:doubts:customers:favorites are often unavailable::steps/agrees/usual | 93% (361/390) | 99% (361/363) | 6 |
| Map card (panel) | cell:doubts:customers:rewards feel stingy::steps/agrees/usual | 93% (361/390) | 99% (361/363) | 6 |
| Map card (panel) | cell:doubts:customers:staff can feel dismissive::steps/agrees/usual | 93% (361/390) | 99% (361/363) | 6 |
| Question type detail (views) | journey.stations[customer_base].inventory[keep_or_leave:churn_triggers].beside | told to leave 24%, agrees with the worry 93% | told to leave 24%, agrees with the worry 99% | 6 |
| Question type detail (views) | journey.stations[customer_base].sub[agrees].cell | 93% (361/390) | 99% (361/363) | 6 |
| Question type detail (views) | view.doubt.keepOrLeave.byStage[churn_triggers].confirms | 93% (361/390) | 99% (361/363) | 6 |
| Question type detail (views) | view.doubt.keepOrLeave.premise.confirms | 93% (361/390) | 99% (361/363) | 6 |
| Map card (panel) | cell:doubts:buyers:returns feel too restrictive::claim/0 | 61% | 66% | 5 |
| Map card (panel) | cell:doubts:buyers:returns feel too restrictive::steps/agrees/you | 61% (79/130) | 66% (79/119) | 5 |
| Map card (panel) | cell:doubts:customers:rewards feel stingy::steps/agrees/you | 95% (123/130) | 100% (123/123) | 5 |
| Data page tables | worries_buyers/Returns feel too restrictive/Agrees with the worry | 61% (79/130) | 66% (79/119) | 5 |
| Map cell | doubts:buyers:returns feel too restrictive | contested / go ahead 52% - agrees with the worry 61% | contested / go ahead 52% - agrees with the worry 66% | 5 |
| Map position (claim / figures / conditions) | doubts:buyers:returns feel too restrictive.claim | When a buyer worries "Returns feel too restrictive", the AI agrees the worry is fair in 61% of the answers that judge it and tells them to go ahead in 52%, including 30%… | When a buyer worries "Returns feel too restrictive", the AI agrees the worry is fair in 66% of the answers that judge it and tells them to go ahead in 52%, including 30%… | 5 |
| Question type detail (views) | journey.stations[doubts].inventory[doubt:objections/Returns feel too restrictive].beside | agrees with the worry 61%, points them to another brand 20% | agrees with the worry 66%, points them to another brand 20% | 5 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[churn_triggers/Rewards feel stingy].premise.confirms | 95% (123/130) | 100% (123/123) | 5 |
| Question type detail (views) | view.doubt.objections.rows[objections/Returns feel too restrictive].premise.confirms | 61% (79/130) | 66% (79/119) | 5 |
| | ... 38 more changed places (raw JSON) | | | |

**Doritos** - 36 numbers move in 34 places (Question type detail (views) 16, Brief (own subject) 9, Map card (panel) 7, Overview 4); of those, 6 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5].confirms | 73% (29/40) | 85% (29/34) | 12 |
| Map card (panel) | cell:doubts:customers:too processed to feel okay::steps/agrees/you | 92% (119/130) | 99% (119/120) | 7 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[churn_triggers/Too processed to feel okay].premise.confirms | 92% (119/130) | 99% (119/120) | 7 |
| Map card (panel) | cell:doubts:customers:all::steps/agrees/you | 80% (417/520) | 82% (417/507) | 2 |
| Map card (panel) | cell:doubts:customers:bag feels half empty::steps/agrees/usual | 80% (417/520) | 82% (417/507) | 2 |
| Map card (panel) | cell:doubts:customers:orange dust mess::steps/agrees/usual | 80% (417/520) | 82% (417/507) | 2 |
| Map card (panel) | cell:doubts:customers:price keeps creeping up::steps/agrees/usual | 80% (417/520) | 82% (417/507) | 2 |
| Map card (panel) | cell:doubts:customers:too processed to feel okay::steps/agrees/usual | 80% (417/520) | 82% (417/507) | 2 |
| Overview | map.tensions[agreed_yet_stay].body | When a customer raises a worry, the AI agrees it is fair 80% of the time it takes a side - and in 50% of those answers still tells them to stay. | When a customer raises a worry, the AI agrees it is fair 82% of the time it takes a side - and in 50% of those answers still tells them to stay. | 2 |
| Overview | map.tensions[agreed_yet_stay].viz[Agrees the worry is fair].text | 80% | 82% | 2 |
| Overview | summary.insights[agreed_yet_stay].body | When a customer raises a worry, the AI agrees it is fair 80% of the time it takes a side - and in 50% of those answers still tells them to stay. | When a customer raises a worry, the AI agrees it is fair 82% of the time it takes a side - and in 50% of those answers still tells them to stay. | 2 |
| Overview | summary.insights[agreed_yet_stay].viz[Agrees the worry is fair].text | 80% | 82% | 2 |
| Question type detail (views) | journey.stations[customer_base].inventory[keep_or_leave:churn_triggers].beside | told to leave 18%, agrees with the worry 80% | told to leave 18%, agrees with the worry 82% | 2 |
| Question type detail (views) | journey.stations[customer_base].sub[agrees].cell | 80% (417/520) | 82% (417/507) | 2 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-opus-5-5].confirms | 85% (34/40) | 87% (34/39) | 2 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5-search].confirms | 80% (32/40) | 82% (32/39) | 2 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna-search].confirms | 75% (30/40) | 77% (30/39) | 2 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[sonar-pro].confirms | 80% (32/40) | 82% (32/39) | 2 |
| Question type detail (views) | view.doubt.keepOrLeave.byStage[churn_triggers].confirms | 80% (417/520) | 82% (417/507) | 2 |
| Question type detail (views) | view.doubt.keepOrLeave.premise.confirms | 80% (417/520) | 82% (417/507) | 2 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[churn_triggers/Bag feels half empty].premise.rebuts | 62% (81/130) | 64% (81/127) | 2 |
| Map card (panel) | cell:doubts:customers:bag feels half empty::steps/agrees/you | 35% (46/130) | 36% (46/127) | 1 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-opus-5-5-search].confirms | 58% (23/40) | 59% (23/39) | 1 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna].confirms | 78% (31/40) | 79% (31/39) | 1 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-sol-search].confirms | 73% (29/40) | 74% (29/39) | 1 |
| | ... 3 more changed places (raw JSON) | | | |

**Netflix** - 32 numbers move in 31 places (Question type detail (views) 21, Map card (panel) 9, Brief (own subject) 2); of those, 1 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Map card (panel) | cell:doubts:customers:password rules feel unfair::steps/agrees/you | 65% (84/130) | 91% (84/92) | 26 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[churn_triggers/Password rules feel unfair].premise.confirms | 65% (84/130) | 91% (84/92) | 26 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-opus-5-5].confirms | 86% (43/50) | 100% (43/43) | 14 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5].confirms | 72% (36/50) | 86% (36/42) | 14 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna].confirms | 86% (43/50) | 100% (43/43) | 14 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-opus-5-5-search].confirms | 88% (44/50) | 100% (44/44) | 12 |
| Question type detail (views) | journey.stations[customer_base].inventory[keep_or_leave:churn_triggers].beside | told to leave 52%, agrees with the worry 87% | told to leave 52%, agrees with the worry 97% | 10 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5-search].confirms | 86% (43/50) | 96% (43/45) | 10 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-sol].confirms | 90% (45/50) | 100% (45/45) | 10 |
| Question type detail (views) | view.doubt.keepOrLeave.byStage[churn_triggers].confirms | 87% (338/390) | 97% (338/347) | 10 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna-search].confirms | 92% (46/50) | 100% (46/46) | 8 |
| Map card (panel) | cell:doubts:customers:all::steps/agrees/you | 91% (589/650) | 98% (589/599) | 7 |
| Map card (panel) | cell:doubts:customers:nothing i want lately::steps/agrees/usual | 91% (589/650) | 98% (589/599) | 7 |
| Map card (panel) | cell:doubts:customers:password rules feel unfair::steps/agrees/usual | 91% (589/650) | 98% (589/599) | 7 |
| Map card (panel) | cell:doubts:customers:price keeps creeping up::steps/agrees/usual | 91% (589/650) | 98% (589/599) | 7 |
| Map card (panel) | cell:doubts:customers:shows disappear too fast::steps/agrees/usual | 91% (589/650) | 98% (589/599) | 7 |
| Map card (panel) | cell:doubts:customers:too many repetitive ads::steps/agrees/usual | 91% (589/650) | 98% (589/599) | 7 |
| Question type detail (views) | journey.stations[customer_base].sub[agrees].cell | 91% (589/650) | 98% (589/599) | 7 |
| Question type detail (views) | view.doubt.keepOrLeave.premise.confirms | 91% (589/650) | 98% (589/599) | 7 |
| Map card (panel) | cell:doubts:customers:price keeps creeping up::steps/agrees/you | 94% (122/130) | 100% (122/122) | 6 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[grok-4.6].confirms | 92% (46/50) | 98% (46/47) | 6 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[sonar-pro].confirms | 94% (47/50) | 100% (47/47) | 6 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[renewal/Price keeps creeping up].premise.confirms | 94% (122/130) | 100% (122/122) | 6 |
| Map card (panel) | cell:doubts:customers:nothing i want lately::steps/agrees/you | 96% (125/130) | 100% (125/125) | 4 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[sonar].confirms | 94% (47/50) | 98% (47/48) | 4 |
| | ... 5 more changed places (raw JSON) | | | |

**Google Pixel** - 117 numbers move in 105 places (Question type detail (views) 50, Map card (panel) 23, Brief (own subject) 20, Map position (claim / figures / conditions) 7, Map cell 6, Overview 6, Data page tables 5); of those, 8 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5].confirms | 35% (7/20) | 100% (7/7) | 65 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna].confirms | 40% (8/20) | 100% (8/8) | 60 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-sol-search].confirms | 60% (12/20) | 100% (12/12) | 40 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[sonar-pro].confirms | 65% (13/20) | 93% (13/14) | 28 |
| Map card (panel) | cell:doubts:customers:runs hot fast::steps/agrees/you | 68% (88/130) | 95% (88/93) | 27 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[churn_triggers/Runs hot fast].premise.confirms | 68% (88/130) | 95% (88/93) | 27 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-sol].confirms | 75% (15/20) | 100% (15/15) | 25 |
| Map card (panel) | cell:doubts:customers:all::steps/agrees/you | 73% (191/260) | 97% (191/196) | 24 |
| Map card (panel) | cell:doubts:customers:repair is a hassle::steps/agrees/usual | 73% (191/260) | 97% (191/196) | 24 |
| Map card (panel) | cell:doubts:customers:runs hot fast::steps/agrees/usual | 73% (191/260) | 97% (191/196) | 24 |
| Question type detail (views) | journey.stations[customer_base].inventory[keep_or_leave:churn_triggers].beside | told to leave 13%, agrees with the worry 73% | told to leave 13%, agrees with the worry 97% | 24 |
| Question type detail (views) | journey.stations[customer_base].sub[agrees].cell | 73% (191/260) | 97% (191/196) | 24 |
| Question type detail (views) | view.doubt.keepOrLeave.byStage[churn_triggers].confirms | 73% (191/260) | 97% (191/196) | 24 |
| Question type detail (views) | view.doubt.keepOrLeave.premise.confirms | 73% (191/260) | 97% (191/196) | 24 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5-search].confirms | 70% (14/20) | 93% (14/15) | 23 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[sonar].confirms | 70% (14/20) | 93% (14/15) | 23 |
| Map card (panel) | cell:doubts:customers:repair is a hassle::steps/agrees/you | 79% (103/130) | 100% (103/103) | 21 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[churn_triggers/Repair is a hassle].premise.confirms | 79% (103/130) | 100% (103/103) | 21 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-opus-5-5-search].confirms | 80% (16/20) | 100% (16/16) | 20 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-opus-5-5].confirms | 85% (17/20) | 100% (17/17) | 15 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna-search].confirms | 75% (15/20) | 88% (15/17) | 13 |
| Map card (panel) | cell:doubts:buyers:google watching me::claim/0 | 78% | 90% | 12 |
| Map card (panel) | cell:doubts:buyers:google watching me::steps/agrees/you | 78% (101/130) | 90% (101/112) | 12 |
| Data page tables | worries_buyers/Google watching me/Agrees with the worry | 78% (101/130) | 90% (101/112) | 12 |
| Map cell | doubts:buyers:google watching me | yours / go ahead 67% - agrees with the worry 78% | yours / go ahead 67% - agrees with the worry 90% | 12 |
| | ... 72 more changed places (raw JSON) | | | |

**Jira** - 99 numbers move in 88 places (Question type detail (views) 38, Map card (panel) 24, Brief (own subject) 19, Overview 8, Map position (claim / figures / conditions) 5, Map cell 3, Data page tables 2); of those, 8 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna].confirms | 71% (50/70) | 94% (50/53) | 23 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5].confirms | 47% (33/70) | 69% (33/48) | 22 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-sol].confirms | 74% (52/70) | 93% (52/56) | 19 |
| Map card (panel) | cell:doubts:customers:support won't show up::steps/agrees/you | 81% (105/130) | 99% (105/106) | 18 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[churn_triggers/Support won't show up].premise.confirms | 81% (105/130) | 99% (105/106) | 18 |
| Map card (panel) | cell:doubts:customers:locked in and stuck::steps/agrees/you | 69% (90/130) | 85% (90/106) | 16 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[renewal/Locked in and stuck].premise.confirms | 69% (90/130) | 85% (90/106) | 16 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna-search].confirms | 76% (53/70) | 90% (53/59) | 14 |
| Map card (panel) | cell:doubts:customers:integrations keep breaking::steps/agrees/you | 75% (98/130) | 88% (98/112) | 13 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[churn_triggers/Integrations keep breaking].premise.confirms | 75% (98/130) | 88% (98/112) | 13 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[sonar].confirms | 81% (57/70) | 93% (57/61) | 12 |
| Map card (panel) | cell:doubts:customers:all::steps/agrees/you | 76% (694/910) | 86% (694/811) | 10 |
| Map card (panel) | cell:doubts:customers:can't trust the reports::steps/agrees/usual | 76% (694/910) | 86% (694/811) | 10 |
| Map card (panel) | cell:doubts:customers:customization sprawl mess::steps/agrees/usual | 76% (694/910) | 86% (694/811) | 10 |
| Map card (panel) | cell:doubts:customers:integrations keep breaking::steps/agrees/usual | 76% (694/910) | 86% (694/811) | 10 |
| Map card (panel) | cell:doubts:customers:locked in and stuck::steps/agrees/usual | 76% (694/910) | 86% (694/811) | 10 |
| Map card (panel) | cell:doubts:customers:nickel-and-dimed by add-ons::steps/agrees/usual | 76% (694/910) | 86% (694/811) | 10 |
| Map card (panel) | cell:doubts:customers:slow and laggy::steps/agrees/usual | 76% (694/910) | 86% (694/811) | 10 |
| Map card (panel) | cell:doubts:customers:support won't show up::steps/agrees/usual | 76% (694/910) | 86% (694/811) | 10 |
| Overview | summary.insights[agreed_yet_stay].body | When a customer raises a worry, the AI agrees it is fair 76% of the time it takes a side - and in 66% of those answers still tells them to stay. | When a customer raises a worry, the AI agrees it is fair 86% of the time it takes a side - and in 66% of those answers still tells them to stay. | 10 |
| Overview | summary.insights[agreed_yet_stay].viz[Agrees the worry is fair].text | 76% | 86% | 10 |
| Question type detail (views) | journey.stations[customer_base].inventory[keep_or_leave:churn_triggers].beside | told to leave 0%, agrees with the worry 73% | told to leave 0%, agrees with the worry 83% | 10 |
| Question type detail (views) | journey.stations[customer_base].inventory[keep_or_leave:renewal].beside | told to leave 1%, agrees with the worry 83% | told to leave 1%, agrees with the worry 93% | 10 |
| Question type detail (views) | journey.stations[customer_base].sub[agrees].cell | 76% (694/910) | 86% (694/811) | 10 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-sol-search].confirms | 87% (61/70) | 97% (61/63) | 10 |
| | ... 55 more changed places (raw JSON) | | | |

**American Express** - 117 numbers move in 101 places (Question type detail (views) 51, Map card (panel) 23, Brief (own subject) 20, Overview 10, Map position (claim / figures / conditions) 6, Map cell 4, Data page tables 3); of those, 12 places appear or disappear (a row or sentence that is no longer drawn, or is newly drawn).

| Screen | What | Before | After | Move (pts) |
|---|---|---|---|---|
| Map card (panel) | cell:doubts:customers:fee feels too high::steps/agrees/you | 10% (13/130) | 100% (13/13) | 90 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[renewal/Fee feels too high].premise.confirms | 10% (13/130) | 100% (13/13) | 90 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5].confirms | 45% (27/60) | 93% (27/29) | 48 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna].confirms | 45% (27/60) | 93% (27/29) | 48 |
| Question type detail (views) | journey.stations[customer_base].inventory[keep_or_leave:renewal].beside | told to leave 9%, agrees with the worry 56% | told to leave 9%, agrees with the worry 100% | 44 |
| Question type detail (views) | view.doubt.keepOrLeave.byStage[renewal].confirms | 56% (219/390) | 100% (219/219) | 44 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[sonar].confirms | 62% (37/60) | 100% (37/37) | 38 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-sol].confirms | 63% (38/60) | 100% (38/38) | 37 |
| Map card (panel) | cell:doubts:customers:perks keep changing::steps/agrees/you | 64% (83/130) | 100% (83/83) | 36 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-opus-5-5].confirms | 53% (32/60) | 89% (32/36) | 36 |
| Question type detail (views) | view.doubt.keepOrLeave.rows[renewal/Perks keep changing].premise.confirms | 64% (83/130) | 100% (83/83) | 36 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[gpt-5.6-luna-search].confirms | 62% (37/60) | 97% (37/38) | 35 |
| Question type detail (views) | view.doubt.objections.byEngine[claude-opus-5-5].confirms | 60% (18/30) | 95% (18/19) | 35 |
| Question type detail (views) | view.doubt.objections.byEngine[claude-sonnet-5].confirms | 60% (18/30) | 95% (18/19) | 35 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[claude-sonnet-5-search].confirms | 53% (32/60) | 86% (32/37) | 33 |
| Question type detail (views) | view.doubt.objections.byEngine[claude-opus-5-5-search].confirms | 50% (15/30) | 83% (15/18) | 33 |
| Question type detail (views) | view.doubt.keepOrLeave.byEngine[sonar-pro].confirms | 63% (38/60) | 95% (38/40) | 32 |
| Map card (panel) | cell:doubts:customers:all::steps/agrees/you | 63% (490/780) | 93% (490/527) | 30 |
| Map card (panel) | cell:doubts:customers:credits too hard to use::steps/agrees/usual | 63% (490/780) | 93% (490/527) | 30 |
| Map card (panel) | cell:doubts:customers:fee feels too high::steps/agrees/usual | 63% (490/780) | 93% (490/527) | 30 |
| Map card (panel) | cell:doubts:customers:lounges overcrowded lately::steps/agrees/usual | 63% (490/780) | 93% (490/527) | 30 |
| Map card (panel) | cell:doubts:customers:perks keep changing::steps/agrees/usual | 63% (490/780) | 93% (490/527) | 30 |
| Map card (panel) | cell:doubts:customers:protections won't back me::steps/agrees/usual | 63% (490/780) | 93% (490/527) | 30 |
| Map card (panel) | cell:doubts:customers:service not premium anymore::steps/agrees/usual | 63% (490/780) | 93% (490/527) | 30 |
| Question type detail (views) | journey.stations[customer_base].sub[agrees].cell | 63% (490/780) | 93% (490/527) | 30 |
| | ... 64 more changed places (raw JSON) | | | |

## Ruling 10: the Overview's condition findings counted on one question type

Two findings count conditions: `away_condition` (what sends buyers away most) is pooled over every question type that carries conditions; `assigned_exception` (the matchups lost with an exception) is pooled over every lost head-to-head. Below: the finding today, the card it opens (where the Map places it), and what that card and the all-buyers What to buy card show as the lead condition. Card shares are of all the answers to that question (ruling 4); the findings' shares are of the answers that give any condition on that side - so the shares differ in base as well as in question type. Read from the current engine (no switch), the ranked insights, `map.insightCells` and the stat registry.

| Tracker | Finding | On the Overview? | Today: lead condition and share (top 3) | Opens | That card's lead (top 3) | What to buy card's lead (top 3) |
|---|---|---|---|---|---|---|
| Sephora | assigned_exception | Yes | Choose prestige products 67%; Want broad selection 18%; Explore brands and products 13% | fights:h2h:ulta beauty | Choose prestige products 67%; Want broad selection 18%; Explore brands and products 13% (of the answers that pick that rival) | Affordable everyday basics 35%; Clinical and Asian skincare 22%; Clean and ingredient-conscious 12% |
| Sephora | away_condition | No (ranked, not served) | Affordable everyday basics 47%; Clinical and Asian skincare 28%; Clean and ingredient-conscious 21% | - | - | Affordable everyday basics 35%; Clinical and Asian skincare 22%; Clean and ingredient-conscious 12% |
| Doritos | away_condition | served (the Brief quotes it), not among the Overview findings | Want more crunch 27%; Want a lighter, healthier snack 26%; Prefer classic comfort 26% | fights:leavers:ruffles | Want more crunch 68%; Want bold flavor 40%; Prefer classic comfort 38% | Prefer classic comfort 17%; Sturdy for dipping 17%; Want more crunch 14% |
| Netflix | away_condition | served (the Brief quotes it), not among the Overview findings | Quality over quantity 45%; Family and kids 35%; Sports and live TV 30% | fights:h2h:max | Quality over quantity 93%; Movie library and rentals 22%; Specific genres 12% | Quality over quantity 23%; Family and kids 23%; Use services they have 21% |
| Google Pixel | away_condition | served (the Brief quotes it), not among the Overview findings | Long battery life 29%; Already use Apple 28%; Want a foldable 23% | fights:h2h:oneplus | Maximum features and power 72%; Long battery life 69%; More hardware for the money 18% | Already use Apple 32%; Spend less 15%; Better video 14% |
| Jira | away_condition | served (the Brief quotes it), not among the Overview findings | Broader work beyond software 62%; Software and engineering workflows 60%; Simple, lightweight tracking 29% | fights:h2h:clickup | Broader work beyond software 96%; Lower cost and overhead 18%; Simple, lightweight tracking 18% | Broader work beyond software 57%; Software and engineering workflows 50%; Existing tools and ecosystems 31% |
| Jira | assigned_exception | served (the Brief quotes it), not among the Overview findings | Large or scaling organizations 55%; Complex workflows and flexibility 53%; Engineering-led software work 51% | fights:h2h:linear | Large or scaling organizations 80%; Complex workflows and flexibility 76%; Already using Atlassian 69% (of the answers that pick that rival) | Broader work beyond software 57%; Software and engineering workflows 50%; Existing tools and ecosystems 31% |
| American Express | assigned_exception | Yes | Want premium travel perks 69%; Dining is a major expense 51%; Want travel points 26% | fights:h2h:chase | Want premium travel perks 79%; Dining is a major expense 54%; Travel often 21% (of the answers that pick that rival) | Earn more on concentrated spending 43%; Keep rewards simple 29%; Avoid annual fees 25% |
| American Express | away_condition | served (the Brief quotes it), not among the Overview findings | Earn more on concentrated spending 36%; Keep rewards simple 36%; Prefer cash back 31% | fights:leavers:discover | Earn more on concentrated spending 75%; Prefer rotating categories 58%; Want flexible travel points 44% | Earn more on concentrated spending 43%; Keep rewards simple 29%; Avoid annual fees 25% |

Reading it. `away_condition`: counted on what-to-buy answers only, the lead condition stays the same on American Express, Jira, Netflix and Sephora, and changes on Doritos ('Want more crunch' -> 'Prefer classic comfort' and 'Sturdy for dipping', tied at 17%) and Google Pixel ('Long battery life' -> 'Already use Apple', 32%). The finding never opens the What to buy card today: it opens a head-to-head or a rivals'-customers card (Doritos: Ruffles' customers switching; Netflix: Max; Pixel: OnePlus; Jira: ClickUp; American Express: Discover's customers switching); that card's lead matches the finding on four of them and differs on Pixel ('Maximum features and power' 72%, with 'Long battery life' second at 69%). On Sephora the finding is ranked but not served, so nothing on screen changes. `assigned_exception`: the lead condition stays the same on all three trackers where it fires; its share goes from the pooled-over-lost-matchups figure to the one card's: American Express 69% -> 79% (Chase), Jira 55% -> 80% (Linear), Sephora 67% -> 67% (one lost matchup).

## Ruling 11: 'converts' - one rule

Two rules today. The diagnosis (brief.ts diagnosisFrame, for the Brief's subject): converts when share of picks >= a quarter of the named rate, read only when the named base and the commit count are 20 or more. The visibility view (matrixFrame): converts when the recommendations that end as the pick are at or above the level line (the charted brands' pooled rate), read only with 20 or more recommendations. Below: every brand on each tracker's visibility table (the own-subject Brief's set), with both calls; rows where they differ are marked. The diagnosis rule is shown on screen only for the Brief's subject (the tracker's own Brief, or a rival's Brief opened from By rival).

**Sephora** - level line 16.6%

| Brand | Named | Share of picks | Recommendations that end as the pick | Visibility rule | Diagnosis rule | Differ |
|---|---|---|---|---|---|---|
| Ulta Beauty | 94% | 76.7% | 40.4% (854 recs) | converts | converts |  |
| Target | 69% | 5.6% | 5.0% (505 recs) | does not | does not |  |
| Sephora (you) | 81% | 5.3% | 4.4% (549 recs) | does not | does not |  |
| Walmart | 31% | 5.3% | 15.5% (155 recs) | does not | does not |  |
| Dermstore | 40% | 3.3% | 5.4% (278 recs) | does not | does not |  |
| Sally Beauty | 7% | 2.0% | 17.3% (52 recs) | converts | converts |  |
| Credo | 21% | 0.9% | 3.8% (106 recs) | does not | does not |  |
| CVS | 45% | 0.4% | 1.1% (176 recs) | does not | does not |  |
| Walgreens | 36% | 0.0% | 0.0% (105 recs) | does not | does not |  |
| Amazon | 26% | 0.0% | 0.0% (49 recs) | does not | does not |  |
| Nordstrom | 22% | 0.0% | 0.0% (104 recs) | does not | does not |  |
| Bluemercury | 13% | 0.0% | 0.0% (56 recs) | does not | does not |  |

**Doritos** - level line 18.6%

| Brand | Named | Share of picks | Recommendations that end as the pick | Visibility rule | Diagnosis rule | Differ |
|---|---|---|---|---|---|---|
| Lay's | 76% | 34.5% | 35.3% (538 recs) | converts | converts |  |
| Ruffles | 50% | 15.4% | 25.2% (337 recs) | converts | converts |  |
| Doritos (you) | 71% | 12.5% | 13.7% (504 recs) | does not | does not |  |
| Kettle Brand | 43% | 6.2% | 13.3% (255 recs) | does not | does not |  |
| Cape Cod | 38% | 5.8% | 16.1% (199 recs) | does not | does not |  |
| Tostitos | 33% | 5.1% | 10.5% (266 recs) | does not | does not |  |
| Fritos | 26% | 3.6% | 18.5% (108 recs) | does not | does not |  |
| Pringles | 22% | 3.1% | 14.3% (119 recs) | does not | does not |  |
| Zapp’s | 10% | 2.5% | 19.4% (72 recs) | converts | converts |  |
| Miss Vickie's | 16% | 2.4% | 17.6% (74 recs) | does not | does not |  |
| Popchips | 16% | 2.4% | 18.1% (72 recs) | does not | does not |  |
| SunChips | 33% | 2.2% | 7.0% (171 recs) | does not | does not |  |
| PopCorners | 13% | 2.0% | 12.6% (87 recs) | does not | does not |  |
| Pirate's Booty | 12% | 0.5% | 4.8% (62 recs) | does not | does not |  |
| Cheetos | 46% | 0.4% | 1.6% (126 recs) | does not | does not |  |
| Utz | 13% | 0.4% | 5.3% (38 recs) | does not | does not |  |
| Takis | 26% | 0.0% | 0.0% (96 recs) | does not | does not |  |

**Netflix** - level line 20.9%

| Brand | Named | Share of picks | Recommendations that end as the pick | Visibility rule | Diagnosis rule | Differ |
|---|---|---|---|---|---|---|
| Netflix (you) | 90% | 52.5% | 46.7% (752 recs) | converts | converts |  |
| Disney+ | 71% | 23.5% | 29.2% (537 recs) | converts | converts |  |
| PBS Kids | 18% | 9.3% | 32.0% (194 recs) | converts | converts |  |
| Max (HBO) | 68% | 4.9% | 7.6% (432 recs) | does not | does not |  |
| Tubi | 28% | 2.8% | 10.5% (181 recs) | does not | does not |  |
| Apple TV+ | 46% | 2.7% | 8.8% (204 recs) | does not | does not |  |
| Hulu | 61% | 2.1% | 4.3% (323 recs) | does not | does not |  |
| Paramount+ | 45% | 1.0% | 4.0% (174 recs) | does not | does not |  |
| Peacock | 41% | 0.6% | 2.9% (140 recs) | does not | does not |  |
| Amazon Prime Video | 53% | 0.1% | 0.5% (199 recs) | does not | does not |  |
| YouTube | 35% | 0.1% | 1.7% (58 recs) | does not | does not |  |
| Pluto | 23% | 0.0% | 0.0% (125 recs) | does not | does not |  |

**Google Pixel** - level line 15.6%

| Brand | Named | Share of picks | Recommendations that end as the pick | Visibility rule | Diagnosis rule | Differ |
|---|---|---|---|---|---|---|
| Apple iPhone | 91% | 67.2% | 30.9% (729 recs) | converts | converts |  |
| Google Pixel (you) | 83% | 22.4% | 11.5% (653 recs) | does not | converts | **yes** |
| Samsung Galaxy | 82% | 4.5% | 2.5% (607 recs) | does not | does not |  |
| Gabb | 14% | 2.7% | 10.3% (87 recs) | does not | does not |  |
| Vivo | 4% | 2.7% | unread (18 recs) | does not | converts | **yes** |
| OnePlus | 15% | 0.6% | 2.4% (85 recs) | does not | does not |  |
| Motorola | 14% | 0.0% | 0.0% (41 recs) | does not | does not |  |

**Jira** - level line 11.9%

| Brand | Named | Share of picks | Recommendations that end as the pick | Visibility rule | Diagnosis rule | Differ |
|---|---|---|---|---|---|---|
| Jira (you) | 85% | 26.4% | 17.7% (631 recs) | converts | converts |  |
| Teamwork | 20% | 22.4% | 51.6% (184 recs) | converts | converts |  |
| Linear | 69% | 20.5% | 15.3% (567 recs) | converts | converts |  |
| Asana | 77% | 13.2% | 11.1% (505 recs) | does not | does not |  |
| YouTrack | 20% | 4.9% | 18.1% (116 recs) | converts | does not | **yes** |
| Wrike | 26% | 3.8% | 9.5% (169 recs) | does not | does not |  |
| Trello | 30% | 2.1% | 11.7% (77 recs) | does not | does not |  |
| ONES.com | 5% | 1.9% | unread (15 recs) | does not | converts | **yes** |
| Planview | 9% | 1.4% | 15.4% (39 recs) | converts | does not | **yes** |
| Monday.com | 63% | 0.9% | 1.2% (329 recs) | does not | does not |  |
| ClickUp | 67% | 0.7% | 0.9% (322 recs) | does not | does not |  |
| GitHub | 50% | 0.5% | 0.9% (231 recs) | does not | does not |  |
| GitLab | 32% | 0.2% | 1.4% (70 recs) | does not | does not |  |
| Basecamp | 18% | 0.2% | 1.1% (88 recs) | does not | does not |  |
| Smartsheet | 15% | 0.2% | 1.2% (85 recs) | does not | does not |  |
| Azure DevOps | 32% | 0.0% | 0.0% (214 recs) | does not | does not |  |
| Shortcut | 26% | 0.0% | 0.0% (68 recs) | does not | does not |  |
| Notion | 18% | 0.0% | 0.0% (38 recs) | does not | does not |  |

**American Express** - level line 16.8%

| Brand | Named | Share of picks | Recommendations that end as the pick | Visibility rule | Diagnosis rule | Differ |
|---|---|---|---|---|---|---|
| Capital One | 81% | 35.1% | 23.1% (684 recs) | converts | converts |  |
| Chase | 76% | 20.0% | 15.4% (583 recs) | does not | converts | **yes** |
| Wells Fargo | 36% | 20.0% | 31.4% (287 recs) | converts | converts |  |
| American Express (you) | 89% | 15.8% | 10.1% (704 recs) | does not | does not |  |
| Citi | 57% | 6.4% | 8.3% (348 recs) | does not | does not |  |
| U.S. Bank | 23% | 1.3% | 4.0% (150 recs) | does not | does not |  |
| Bank of America | 11% | 0.0% | 0.0% (49 recs) | does not | does not |  |

Brands the two rules call differently: Google Pixel (the tracker's own brand: The diagnosis heads it 'Known and chosen - and still behind Apple iPhone'; under the visibility rule it would read 'Present everywhere, chosen rarely' with 'The problem is conversion, not visibility', as the visibility view already puts it in the Showroom), Vivo (Pixel; too few recommendations for the visibility rule to read it), Chase (American Express), YouTrack, ONES.com and Planview (Jira). On screen today that is the tracker's own Brief for Google Pixel (The diagnosis heading and its 'The problem is conversion' sentence) and the rival Briefs for Chase, YouTrack, ONES.com and Planview; Vivo and ONES.com also fall under the visibility view's 20-recommendation floor.
