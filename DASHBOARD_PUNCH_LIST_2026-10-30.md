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
| Journey | layout settled (funnel strip) | ready for content review |
| Decision rules | FIRST DRAFT layout | needs its layout pass (sketches like Journey's) |
| Metrics pivot | FIRST DRAFT layout | needs its layout pass |
| Share links | untested by a human | serves coded-held runs |

## Open items - presentation (none block anything)

- [ ] Decision rules: layout options to sketch, then settle (like Journey)
- [ ] Metrics: layout options to sketch, then settle
- [ ] Journey: engine filter on the buyer bar (deferred from the build)
- [ ] Set C (business case / expansion / ecosystem / advocacy): no views yet - pointer text only
- [ ] Evidence drill in the per-type sections (today: Metrics + rules samples only)
- [ ] Journey: leak-severity color on station cards (option C's refinement - decide if wanted)

## Open items - plumbing (scheduled rounds, not review blockers)

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

(nothing filed yet)
