# Init audit v4 - the stage contract build (STYLE s32), cold walk (2026-10-03)

**Scope.** Five brands cold-walked on the stage-contract build. Each was audited by a fresh Opus auditor against `STAGE_CONTRACT.md` (brief: `AUDIT_BRIEF_v3.md`).
- Data and reports: `~/Documents/procerno_eval/init_audit_2026-10-03/cold_v4/` and `cold_v4_audit/`.
- Nothing touched prod.

| brand | seeds | gate flags | S1 | S2 | S3 | S4 | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jira | 49 | 1 | 0 | 3 | 10 | 4 | ready after gate edits |
| American Express | 49 | 1 | 0 | 5 | 3 | 10 | ready after gate edits |
| Netflix | 41 | 1 | 0 | 4 | 11 | 6 | ready after gate edits |
| Google Pixel | 46 | 0 | 0 | 8 | 6 | 4 | **not ready** (engine patterns) |
| Doritos | 39 | 0 | 0 | 3 | 7 | 5 | ready after gate edits |

## What the contract build fixed

- **Value:**
  - Before: 6 of 20 cells weighed the brand against a generic cheaper alternative; the rest compared its own tiers (Pixel Pro vs Pixel, ad-free vs ads, Jira Premium vs Standard).
  - Now: 20 of 20 weigh it against a generic cheaper alternative ("Is Netflix worth it over a cheaper streaming service?").
- **Wish lists and candidate-criteria lists:** mostly gone.
- **Doubt, comparison and alternatives cells:** conform across brands (AmEx: every one).
- **Repertoire:** reads as a habit question.
- **Discovery vs Criteria:** distinct in every column.

## What still fails - engine patterns, by root cause

1. **Use-case fit asks for a list, not a pick** (all 5 brands).
   - The writer's open-choice rule still lists use_case among stages that must invite "name a few worth a look", and the seed check's open-choice clause says the same. Both contradict contract row 6 (one pick for one job). This is my miss in the conformance pass.
   - Jobs also repeat within a battery (Doritos 3 of 4 "holds up in dips"; Jira 3 of 4 reporting roll-ups) and sometimes pick the client's strength (Netflix "international content").
2. **A quoted example in a check became the wording - and locked out iPhone** (Pixel).
   - The switch-direction design text quotes "from iOS to Android". Every heal of the "Ecosystem switcher" column copied it, so iPhone was excluded from 6 cells, including Discovery.
   - This is the same "quoted shapes become wording" lesson, now in the checker's own text.
3. **The room check drops rivals with parenthetical names** (Pixel: "Samsung (Galaxy)", "Apple (iPhone)").
   - The check maps the model's answer back to roster names by exact lowercase match, so "Samsung Galaxy" never matches "Samsung (Galaxy)". The contender counts were wrong for every Pixel room.
   - A mechanical bug: match by brand key, like the rest of the brand checks.
4. **Churn cells drift into fix-it asks** (Pixel: "Is there a reliable fix, or...").
   - The contract loosening ("both options need not be spelled out") went too far: the cells keep leaving only technically possible.
   - Leaving must be a live option the question weighs, even if it isn't spelled out word for word.
5. **Rewrites drift toward the client's strength** (AmEx).
   - When the check rejected "lounge access" in a feature screen, the rewrite picked "hotel elite status", another AmEx signature perk. Pixel #16 picked "long update support".
   - The "not the client's strength" rule must be stated in the rewrite instruction, not only in the first-draft rule.
6. **Value cells don't say which product** (AmEx "an American Express cash back card"; Pixel "a Google Pixel").
   - The answer can still compare the brand's own products.
   - Open question: how specific? Naming exact cards or models brings back dated product names.
7. **Rooms:**
   - Room variety is down compared with the decisions walk (Netflix lost its cord-cutting room, and with it Problem recognition's genuine pain).
   - A capability passed as a room (Jira "Portfolio and roadmaps rollout").
   - A room the contest check marked uncontested was kept (Doritos "Dip night").
   - Netflix "Keep one after cuts" pulls Value and Use-case toward retention.
8. **Smaller:**
   - Doritos' category drew as "tortilla and corn chips" (awkward in 17 seeds), and 3 of 4 head-to-head picks are Frito-Lay sister brands.
   - Comparison wording changes by rival on Doritos.
   - "Max" instead of "HBO Max" on Netflix.
   - Discover's parent is stale (Capital One since 2025, per the auditor).
   - A degenerate Value cell: Jira "squad of 9" falls inside Jira's free plan.

## Proposed fixes (by rule; not built)

1. **Use-case fit:**
   - Remove use_case from the open-choice "name a few" rule in both the writer and the seed check; it asks for ONE pick for ONE job.
   - Add a battery check that no two use-case cells name the same job.
2. **No quoted examples in any check or fix text** (switch direction, and a sweep of the rest). Describe the element ("state the direction, and it must leave the client eligible") instead.
3. **Room check name matching:** map contenders by brand key (`matchKey`) and alias, not exact string.
4. **Churn and Renewal:** leaving is a live option the question actually weighs. "Is there a fix, or..." with a token "or" does not count. Keep "both options need not be spelled out".
5. **Rewrite instructions repeat the stage's "never the client's strength" rule** when they ask for a replacement capability or job.
6. **Value product naming:** decision needed - name the product LINE ("a Gold-style rewards card" is still vague); accept brand-level; or name the line ("the Pixel's Pro model").
7. **Room rule:**
   - A room is never a product capability.
   - An uncontested room is replaced from the reserve automatically, not kept.
   - Prefer at least one room per major buying axis (the earlier sets had more variety).
