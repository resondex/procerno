# Dashboard punch list (started 2026-10-30)

How this works: Tyler reviews; anything that reads wrong, confusing or broken
goes on this list (a one-line note in chat is enough - Claude files it here).
Claude burns items down in BATCHES and pushes once per batch, so the surface
under review stops moving mid-review. Measurement-layer facts are stable and
verified; everything here is presentation unless marked otherwise.

## Review state per surface

| Surface | State | Notes |
| --- | --- | --- |
| Pipeline card / tracker list | FROZEN - reviewed | measured state, counts, poll |
| The brief | FROZEN - reviewed | re-cut 2026-10-30, Tyler saw it |
| Boardroom / Five questions | stable, lightly reviewed | verdict wording fixed |
| Stations (was Journey) | BUILT batch 1 (2026-11-01) - ready for review | question cards, rival anchors, 3-block drill, listed inventory, Set C cards |
| Why / Rivals / Buyers lenses | BUILT batch 2 (2026-11-01) - ready for review | Decision rules pill retired into Why's "All conditions" |
| Build a table (was Metrics) | BUILT batch 3 (2026-11-01) - ready for review | presets, one grouped measure select, illegal measures hidden |
| Share links | untested by a human | serves coded-held runs |

## Open items - presentation (none block anything)

- [x] Analysis tier layout: RATIFIED 2026-11-01 (Tyler: "Holds, list + cards") - three tiers + completeness principle, WORKBENCH_REDESIGN_2026-10-30.md top section. Build pending its go.
- [x] Surface rule (Tyler 2026-11-01), batch 1: far fewer answer counts - no n on cards, strips, headlines or per cell; hover range / inventory tables / thin warnings only. Applies to every view incl. the frozen Summary ones on their next touch.
- [ ] Engine filter on the global buyer bar (deferred again in batch 2: the view engines take no engine request data)
- [x] Set C (business case / expansion / ecosystem / advocacy): verdict cards under Customers (batch 1)
- [ ] Evidence drill in the per-type sections (today: Metrics + rules samples only)
- [ ] Journey: leak-severity color on station cards (option C's refinement - decide if wanted)

## Open items - plumbing (scheduled rounds, not review blockers)

- [ ] Coded-held trackers' unplaced names: the queue route (POST /api/projects/[id]/dictionary/queue_unresolved) is never fired from the page any more (2026-11-02: a page-load trigger flooded the keyless fixture with 1,408 pending pills). Running it for the six coded-held prod trackers is an explicit action on Tyler's go; with the judge warm and the admission floors it queues on the order of 100 names per tracker, mostly product forms the family layer merges.

- [ ] Cold-open cost: ~10 independent data loads per tracker open - the shared-load round
- [ ] wb3 payload cleanup (drop wb1's dead fields)
- [ ] Trend / deck / study / brands+mentions exports on answer_codes (ports, proposed 2026-10-30)
- [ ] Rules view: embedding-grouping quality on real embeddings - verify on first prod open

## On Tyler's critical path (his recorded gates, not dashboard work)

1. Finish the dashboard review (gates the fleet collection) - the punch list is
   how findings get captured without derailing the pass.
2. The criticism-persist STYLE bump (writer batch: persist advocacy criticism on
   the intent + writer avoid-list + why-fronted comparison note) - the other
   fleet gate; engine-side, can run as its own session in parallel with review.
3. Standing separate calls, unchanged: prod coder flip, coding wave through the
   prod path, RUN_COLLECT_ONLY.

## Filed findings

### 2026-11-01 - Analysis tier, fresh-eyes read (Claude, walked on the AmEx fixture)

Root finding: the tier is organized by how the measurement works (station =
question-type pool, Decision rules = one code field, Metrics = the legality
layer), not by what the user is asking (where do we stand, where do we lose,
why). Every view opens with a disclaimer before a meaning. Layout options
sketched the same day (Tyler: "sketch options"); the sketch page is the
record, items below are the findings it addresses.

- [ ] Journey cards: six different kinds of number with no anchor (36% names
      you / 7% chosen / 19% you win / 32% go ahead / 11% worth it / 17% stay);
      heading says "lose", numbers are all win rates; no best-rival comparison
      on the card; Comparison promotes "Against a class - you win 1%" to its
      first sub-line.
- [ ] Station drill = the old per-type section stack (Consideration is seven
      cards). A drill wants: the number vs rivals, top reasons, win-when /
      lose-when, then one "full tables" disclosure.
- [ ] Contract vocabulary on customer surfaces: share of decided, firm pick
      in category, names an exit, rebuts it, open choice, holding your own,
      route to you, all buyers by design, core engine panel. Labels in buyer
      language, contract words in tooltips.
- [ ] Decision rules: three headline shares overlap (85 / 62 / 53) and read as
      a broken pie; "As: American Express (32), Amex Gold (26)..." exposes
      brand-string resolution; "10.83x the overall rate" on single-digit
      counts; rival table "route to you 95% / route away 78%" sums past 100.
      Content is the best in the tier; shape should be three bullets each
      side per rival and per buyer, counts only.
- [ ] Metrics: 53 measure chips, mostly greyed, shown to every user. Rename
      "Build a table", open on presets, grouped dropdown of legal measures.
- [ ] Doubts draws customers' worries "because one section reads both";
      Customer base is a card of pointers. Structure explained to the user
      instead of hidden.
- [ ] Buyer and engine filters should be one bar global to the tier.
