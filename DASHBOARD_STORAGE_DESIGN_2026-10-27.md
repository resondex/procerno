# Dashboard foundation - storage, fixture, router (design for review, 2026-10-27)

Scope: the three foundation tasks for the per-type dashboard views. **APPROVED by Tyler with all five recommendations and BUILT 2026-10-27** (see AGENTS.md, "Dashboard foundation built").

## What exists today

- `responses` carries the v1-era coder columns: outcome, top_pick_brand, reason_codes, the four flags, gives_recommendation, focus_quote / focus_interpretation, total_recommendations. `mentions` is a per-row table (brand, brand_norm, rank, framing). Both are empty in prod: zero answers are coded anywhere.
- None of the v2 contract's native fields has a column: tier_stance, worth_it, proceed_or_avoid, keep_or_leave, destinations, premise_verdict / premise_quote, category_routed, topics / uncoded_topic, the Set C fields, decision_rules (v0.4).
- `intents` carries stage, angle, situation, concern and qtype for every October cell.
- Local Opus labels cover every answer of the five October runs: v2 training/holdout labels (23,985 rows, eight schemas) + Set C v1.3 (2,470 rows). AmEx 5,395 + 520 = 5,915, Jira 5,395 + 780 = 6,175, Pixel 5,005 + 390 = 5,395, Netflix and Doritos 4,095 + 390 = 4,485 each - equal to the vaulted runs.

## 1. Storage: one new table, `answer_codes`

One row per (answer, source). A source is whoever produced the codes: `ref:opus-5-5` for the reference labels, `coder:procerno_reason_coder_v0_4` once the coder flips. Prod reads one source per project. Two sources can sit side by side, so the per-wave audit sample (coder vs reference on the same answers) needs no second table.

| column | type | meaning |
| --- | --- | --- |
| response_id | TEXT | PK part 1 |
| source | TEXT | PK part 2 |
| run_id, project_id | TEXT | indexed; views read by run |
| contract | TEXT | `v2_2026-10-22` or `setc_v1.3` - the frozen contract the codes were made under |
| schema | TEXT | choice, premium, value, criteria, awareness_pr, awareness_ce, objections, churn_renewal, alt_defensive, business_case, expansion, ecosystem, advocacy |
| outcome | TEXT | choice, premium: pick / conditional / no_pick / clarification |
| top_pick | TEXT | choice, premium: brand as written (resolved at read time, never stored resolved) |
| tier_stance | TEXT | premium |
| worth_it | TEXT | value |
| proceed_or_avoid | TEXT | objections |
| keep_or_leave | TEXT | churn_renewal, alt_defensive |
| premise_verdict | TEXT | objections, churn_renewal, advocacy-with-critic |
| category_routed | TEXT | awareness_pr, awareness_ce |
| relationship_verdict | TEXT | Set C |
| case_strength | TEXT | business_case, advocacy |
| growth_stance | TEXT | expansion |
| clarification_requested, includes_prices, includes_specs | INTEGER | every row |
| quote, premise_quote | TEXT | the stage's anchor phrase; the premise phrase |
| reasons, topics | TEXT (JSON array) | reasons on every schema except the two awareness ones, which carry topics |
| uncoded | TEXT | uncoded_reason or uncoded_topic |
| destinations, redirect_to | TEXT (JSON array) | brands as written |
| pairings | TEXT (JSON) | ecosystem: [{name, maker_relation, framing}] |
| mentions | TEXT (JSON) | [{brand, framing, rank}] - rank = first position in the answer, computed at write |
| decision_rules | TEXT (JSON) | NULL until v0.4; [{condition, choice}] after. In the table now so v0.4 needs no migration |
| created_at | TIMESTAMPTZ | |

Rules that keep it honest:
- A column is NULL when its schema does not ask that field. The schema column says which fields were asked, so NULL means "not asked", never "empty answer" (empty lists are stored as `[]`).
- Brands are stored as written. Dictionary resolution stays read-time and reversible (CODING_DECISIONS section 6).
- Scalar verdicts get their own columns because views filter on them. Lists stay JSON because views only ever read them whole.
- Additive in both stores: `CREATE TABLE IF NOT EXISTS` in postgres.ts and sqlite.ts. Nothing existing changes. RLS is switched on by the existing boot loop.
- `runDataRevision` gains a fifth hash over `answer_codes`, so `slice_cache` can never serve metrics computed before a recode.
- Read: `store.listAnswerCodes(runId, source)` selects these columns only - no answer bodies. The label files average 790 bytes a row (26,455 rows), so a full run is ~3.5-5 MB per uncached metrics read, then cached on the revision key.

Not touched: the legacy `responses` coder columns and the `mentions` table stay as they are. They are empty in prod and nothing new reads them. Retiring them, and pointing finalizeRun's new-name queue at `answer_codes.mentions`, belongs to the coder flip, not this step.

## 2. Local fixture: the five October trackers on the Opus labels

A script, `scripts/build_dashboard_fixture.mts`, writes a separate local sqlite file. It is run with DATABASE_URL unset, so nothing can write to prod.

1. Project config from prod through one read-only transaction per query (the per-query rule, never a session SET): projects, intents, prompts, runs, dictionary entries, confirmed taxonomies.
2. Answers from the response vault gz files, not from prod - no answer-body egress.
3. Codes from the local label files into `answer_codes` with source `ref:opus-5-5`.
4. Hard checks before it finishes: every answer has exactly one code row; every label id matches a vault answer; the router's schema (section 3) equals the labeler's schema on every row; per-schema field presence matches the table above. Any failure stops the build.
5. The dev server gets a second launch config, `procerno-fixture`, pointing at the fixture file, so the views can be walked in the browser.

No model calls and no spend.

## 3. View router: `src/lib/engine/views.ts`

One pure function decides each answer's view from its intent (stage + angle). It reuses the inputs the labeler's schema choice uses, and the fixture build proves the two agree on all 26,455 rows.

| stage | angle | schema | view |
| --- | --- | --- | --- |
| discovery, use_case, social_validation | any | choice | headline |
| premium_worth | any | premium | headline + premium tier view |
| repertoire | any | choice | repertoire |
| comparison | entity rival | choice | head-to-head (entity) |
| comparison | class | choice | head-to-head (class) |
| alternatives | defensive | alt_defensive | defensive hold |
| alternatives | offensive / generic | choice | offensive capture |
| pricing | any | value | value |
| criteria | any | criteria | criteria taught |
| problem_recognition | any | awareness_pr | awareness: routing |
| category_education | any | awareness_ce | awareness: explainer |
| objections | any | objections | doubt |
| churn_triggers, renewal | any | churn_renewal | keep or leave |
| business_case, expansion, ecosystem, advocacy | any | (Set C) | settled, one view per stage |
| shortlist, feature_screening, problem_resolution | any | none | not shown (retired) |

The router does NOT route by qtype. qtype puts offensive alternatives in `open_choice` and repertoire in `doubt`, but section 12 gives both their own views. qtype stays what it is: the labeling and coding key.

Each view gets a fixed definition next to the router: its denominator (the answers it counts), the fields it reads and its headline numbers. The headline view's pooled rates come only from the headline row of this table - that is the presentation rule (CODING_DECISIONS section 8) made mechanical.

## Decisions (all five approved as recommended, 2026-10-27)

1. **Source column.** One table keyed by (answer, source), with one active source per project - or a single code set per answer? Recommended: keyed by source, because coder audits need the reference labels side by side.
2. **Offensive alternatives out of the headline.** qtype says open_choice, section 12 says own view. Recommended: own view, as section 12 decided; the router follows the stage table.
3. **premium_worth in the headline.** Section 12 says headline (tier advocacy + who gets named). Recommended: count it in the headline AND give it its own tier view. The alternative is a tier view only.
4. **Repertoire.** Recommended: own view, outside the headline - it is a habitual pick, not an open shopping question.
5. **Fixture config from prod.** The fixture reads five trackers' project config from prod through read-only transactions (small: no answer bodies). Alternative: build it only from the local exports, which lack intents and prompts. Recommended: read from prod.
