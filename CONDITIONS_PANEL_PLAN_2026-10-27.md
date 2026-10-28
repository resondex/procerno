# Conditions panel on the head-to-head views - plan (2026-10-27, awaiting the v0.4 recode)

Why: the head-to-head cells are deliberately context-free (s10 invariance), so the win rate
measures the AI's DEFAULT answer on the bare versus question. The circumstance-coloring exists
inside the answers as stated carve-outs ("Linear for teams under ~200, Jira for large orgs") and
the v0.4 `decision_rules` field captures exactly that: [{condition, choice}] per branch, at any
outcome, on every comparison answer. The panel puts the boundaries next to the record, so
"0% vs Linear" reads as "the default is Linear; the AI routes to Jira when ..." instead of
"Jira never wins". No collection change - the conditions come from what the answers state.
Residual recorded: a model that would answer differently for a pinned asker WITHOUT writing the
carve-out is invisible to this; the sampled answers do write their boundaries. If a customer
disputes a lopsided matchup, the probe is a small scenario-pinned run of that one matchup.

## What it shows, per matchup row (entity and class)

- Header reframe: "On the context-free ask, <rival> is the default N% - the AI's stated boundaries:"
- **Routes to you when:** rule choices resolving to the client (mostly carve-outs inside losing answers)
- **Routes to <rival> when:** the rival's conditions
- **Routes elsewhere:** rule choices resolving to a third brand - leakage inside a two-way question
- **Unconditional:** answers with decision_rules [] (pure default picks), counted
- Each condition group: label, count, click-through to the carrying answers (response ids kept per group)

## Build order (nothing starts before the recode lands and validates)

1. Recode acceptance + the merge step (already planned): decision_rules attached to the frozen v2 labels.
2. types.ts: the rule type gains drc3's optional `product` (enum schemas carry it; choice schema never -
   no panel impact, but the type must match the contract before any load).
3. build_dashboard_fixture.mts: read the merged files, populate answer_codes.decision_rules, new check -
   rules present and contract-shaped on every row of the six coded schemas.
4. Engine: extend src/lib/engine/head_to_head.ts (HEAD_TO_HEAD_VERSION hh1 -> hh2; same pool, same
   buildResolver). Per answer, resolve each rule's choice like top_pick (family containment, so a card
   name credits its issuer); bucket per rule into you / rival / other; keep verbatim condition + response id.
5. UI: expandable "When does each side win?" section per rival row in head_to_head_view.tsx - top ~6
   condition groups per direction with counts, "+N more", unconditional tally. Renders nothing when the
   source's decision_rules are NULL (pre-v0.4), so prod is unchanged until the data exists.

## Condition grouping - mechanical first, measure, then decide

Conditions are <=8-word verbatim-anchored free text; pilot rerun token-Jaccard 0.686 means real wording
variance ("at enterprise scale" / "for a large org" are one condition).
- v1: stem-set grouping (the definition_overlap.ts stemming - content-word stems, stop and category
  words out), label = the group's most frequent surface form. Deterministic, zero model calls - the
  fixture runs with blanked keys and must stay runnable.
- Only if v1 measurably fragments (distinct groups per matchup-direction vs a hand-grouped sample on
  Jira-Linear and AmEx-Chase): add the consolidate_embed core (text-embedding-3-large + leader
  clustering) cached per (run, matchup, revision), ~$0.001/run, stems fallback when no key. Not built
  until the measurement says so.

## Cache

Rides cachedView under the hh2 key; runDataRevision already hashes answer_codes, so loading the recode
invalidates automatically. Older-generation keys purged as the existing views do.

## Validation before review

- Counts tie out to raw decision_rules by SQL per matchup and direction.
- Hand-read the Jira-Linear and AmEx-Chase panels against a rules dump (the pilot-walk method).
- Fixture rebuild passes all checks; tsc, checker_fixture, serve_logic_harness clean; zero model calls
  on the fixture run.

## Tyler's calls (defaults proposed)

1. Third-brand routings as their own "Routes elsewhere" group (recommended: it is the leakage the
   two-way record hides) vs folded into other picks.
2. Scope: head-to-head only for now. The same pattern later serves Value (worth/cheaper conditions)
   and churn/renewal (keep/leave conditions) - separate rounds.
