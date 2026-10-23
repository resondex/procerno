# Setup-engine model test plan - the four gpt-5 jobs (2026-10-22, draft for Tyler)

gpt-5 shuts down on the API 2026-12-11. Four jobs still default to it, all inside the settled init engine, so each switch needs its own evidence and Tyler's read:

| job | const | what it writes | settled version |
| --- | --- | --- | --- |
| market read | `READ_MODEL` (instrument.ts) | rooms + base journey | scenarios_journeys30 |
| cell writer | `CELLS_MODEL` (instrument.ts) | every seed | STYLE s54 |
| worry planner | `CONCERNS_MODEL` (instrument.ts) | the worry pool + stances | worries8 |
| roster | `ROSTER_MODEL` (models.ts) | roles, ranks, parents, classes | roster3 |

## Candidates (Tyler decision 1)

- **gpt-5.6-sol** - OpenAI's named gpt-5 replacement; the closest behavioral successor. $4 / $20 per M (the most expensive model we would run anywhere).
- **gpt-6-sol** - half the price ($2 / $10), now literally what consumer ChatGPT's paid tier runs. September test G: its cells read shorter and narrower than gpt-5's; no fresh data on today's prompts.
- **gpt-6-luna** as a third arm on the CHEAP jobs only (roster, worry planner): it won every small-job bakeoff this month and costs 1/40th of 5.6-sol. Not proposed for the writer or the read.
- Baseline arm: **gpt-5** itself on every test, so each candidate is scored against what the settled engine actually does today, not against memory.

## Method - cheap jobs first, the writer last

Answer keys already exist for three of the four jobs: the five October trackers' `setup_decision` records what the engine offered AND what Tyler decided, and the confirmed dictionaries carry his roster calls. Order of play (each step gated on the previous one's read):

1. **Roster** (~$1). `classifyRoster` x 3 runs per arm on the five trackers + the 11-brand fleet set. Score: top-4 same_seat pre-picks vs Tyler's picks (other-parent rule applied), inCategory / parent / consumerSalient agreement, h2hRank stability across runs. Pattern: `internal_models_helpers.mts` (one process per arm, cache bypassed, prod read-only).
2. **Worry planner** (~$1). `generateWorries` x 3 draws per arm per tracker. Score: pool overlap with Tyler's decided picks (worry subject matching, not string equality), stance recommendations vs his kept stances, overlap-grouping sanity, judgment-vs-fact rule (worries6) held.
3. **Market read** (~$3-5). Rooms drawn 3x per brand per arm (the `rooms_v*` draw harness). Score: reproduction of Tyler's decided room sets (served-vs-decided), room check pass rate (sonnet, identical across arms), draw-to-draw stability - the Pixel lesson says stability IS the quality bar here. Then a side-by-side file for Tyler's read; the read's taste calls are his, not scoreable.
4. **Cell writer** (~$10-15 + audits) - only for candidates that survived 1-3. Full cold walk per arm on the five brands (local temp store), then: mechanical ship-check (brand findings, structure strings, flags, empties), served-vs-decided against Tyler's confirmed seeds, and one fresh Opus audit per brand against STAGE_CONTRACT - the p29-p31 lesson is that the five-brand roll + five audits is the only measurement that catches writer regressions; string counts are the cheap first proxy.

Budget: roughly $20-30 all in, spent in gated steps; each step needs its own go per the standing rules.

## Ship mechanics (Tyler decision 3, per the cache-era rule)

- **Cell writer**: a model switch changes what the engine produces for identical inputs - case 2, so shipping is a STYLE bump (s55). Unconfirmed drafts redraw on next open; the five confirmed trackers' stored prompts are untouched.
- **Market read / worry planner / roster**: their caches don't key on the model. Shipping either adds the model to the key or bumps the prompt version (the brand-profile precedent: model + prompt version in the key since 2026-10-02), so settled drafts keep their stored rooms / pools / rosters and only fresh trackers see the new model.
- The switches are independent - each job can move alone, and a split verdict (e.g. 5.6-sol writer, 6-sol roster) is fine since each has its own knob.

## Open questions for Tyler before arms run

1. Candidate set as proposed? (5.6-sol + 6-sol everywhere; + luna on roster/worries only.)
2. Run order as proposed (cheap jobs -> read -> writer), each step on its own go?
3. Any job you want to decide by price alone if accuracy ties (the dictionary precedent: a tie goes to the cheaper model)?
