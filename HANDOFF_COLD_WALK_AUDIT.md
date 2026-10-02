# Handoff: cold-walk all four example brands to seed, then audit (for Opus 5.5, fresh session)

Tyler's go covers exactly this task: generate the four example batteries fresh and audit them. The API spend for generation (~$2-4/brand) and the audit subagents is authorized. Nothing else is - no collection runs, no coding, nothing written to prod tables, per the standing rules in AGENTS.md (read its "Seed-quality hardening loop" and "Hardening reviews" sections first; they are the context for everything below).

## The task

1. **Cold-walk Jira, American Express, Netflix, and Google Pixel from a fresh init to cell seed.** The driver exists and is the whole job:

   ```bash
   mkdir -p /tmp/cold_walk && COLD_OUT=/tmp/cold_walk npx tsx scripts/cold_walk.mts "Jira" "American Express" "Netflix" "Google Pixel"
   ```

   It runs the complete setup chain from nothing - brand profile (the new 5-8 ranked prefill), roster typing, market read + scenarios, worries pool with the planner's recommended picks, recommended coverage, cells - against an empty sqlite store in a temp dir. **It never touches prod**: no reads, no writes, no cache reuse. Expect ~5-10 minutes and ~$2-4 per brand; run it in the background and read the log. Each brand emits `cold_seeds_<brand>.json` and `cold_context_<brand>.json` (the profile/roster/scenarios/picks the audit needs for context).

   Notes on reading the output:
   - `seedFlags` non-null = the engine shipped that cell flagged ("needs your call" chip at the review gate). A flagged seed counts as *surfaced to the human*, not a silent defect - but judge whether each flag is a true defect, checker strictness, or genuinely ambiguous.
   - A `MISSING N rows` line or `missing` entries in the context file = exhausted units (3 failed attempts). Report them; they are a defect in the run.
   - OpenAI connection timeouts can kill groups on slow nights; the script drives up to 4 times and each drive banks its completed groups, so just rerun it if a brand ends incomplete.

2. **Audit the four batteries adversarially.** Launch a fresh general-purpose subagent (fresh eyes - do not audit your own reading of the rules) with the seed + context files and this bar:

   - Judge every seed against the CURRENT contracts, not taste: the writer rules in `CELL_WRITER_SYSTEM` and the design intents in `stageDesignIntent`/`seedDesignLine` (src/lib/engine/battery_checks.ts) are the source of truth. Current eras: STYLE_VERSION s29, SEED_RULES_VERSION r12.
   - The decided boundaries matter most: pricing = a price TRADE-OFF with the asker's usage as input, asking prices never stating them ("Netflix Standard is about $15" is a banned false premise - r12); doubt cells state the worry as a confirmable claim, churn/renewal keep staying genuinely on the table; comparisons ask for the pick, circumstance-neutral; offensive alternatives are bare moves (no leave-reason, no asker identity); switch circumstances state a direction that leaves the client brand eligible; awareness askers don't own the product yet; open-choice invites NAMED picks; no calendar years, no segment vocabulary, ~55 words, 2-3 asks.
   - Cross-cell: pricing trade-off shapes at most twice per battery with at least one brand-named cell; doubt concerns diverse; the s23 ruling allows two same-shape pricing cells when their circumstances differ.
   - Severity ladder: S1 ship-blocker / S2 biases a measurement / S3 fix at the gate / S4 polish. Verdict per battery: READY or the exact blockers, with cell numbers and quoted text for every finding.
   - Write the report to `AUDIT_SEEDS_COLDWALK_<date>.md` in the repo root (counts table, findings ranked, bottom line) and give Tyler the verdict table plus S3+ only.

3. **If the audit finds S2+ defects, fix them BY RULE, never by hand-editing seeds** - that is Tyler's standing constraint for this work. The playbook that converged last time (follow it, don't rediscover it):
   - A rule isn't real until a checker enforces it: writer-prompt-only rules regress within two rolls. Countable defects become mechanical checks in `seedRule` (bump SEED_RULES_VERSION); judgment defects go in the design intents (they self-version through the design_check1 cache keys).
   - Calibrate any new mechanical regex against ALL the generated seeds before shipping it - several candidate checks were rejected for false-positiving natural speech (a comma-list counter hit "snaps, reels, texting, music").
   - Prefer CHECKER-ONLY iterations (an r-bump re-judges cached cells free and regenerates only failures). Bump STYLE_VERSION only when the writer prompt text changes - it re-keys and redraws everything, and full re-rolls historically reopen one closed class per roll.
   - The low-effort sonnet design verdict is the kill decision; do NOT add a medium-effort second opinion (tried, it cleared real defects - recorded in AGENTS.md).
   - Rerun `scripts/cold_walk.mts` fresh after each iteration and re-audit. Verify every engine change with: `npx tsc --noEmit`, `npx tsx scripts/checker_fixture.mts` (8 sections), `npx tsx scripts/serve_logic_harness.mts` (19 checks, zero-spend).

## What NOT to touch

- The three prod setup drafts (Jira / American Express / Google Pixel) sit rewound at the coverage step with certified seeds in the prod llm_cache under s29/r12 keys. The cold walk must not touch prod, and nothing in this task resets or regenerates those drafts.
- RUN_COLLECT_ONLY stays as it is; no runs, no coding, no prod config.
- Commit straight to master, " - " never em dashes in user-facing text, no AI attribution trailers (Tyler's standing git rules).

## Reference points

- Prior audits for the bar and format: `AUDIT_SEEDS_COLD_2026-10-02.md` (the 3-brand cold build, READY) and `AUDIT_SEEDS_NETFLIX_COLD_2026-10-02.md` (the Netflix fresh walk, READY with two S3s that became r12). Expected steady state from those runs: ~0-2 honest gate chips per battery, zero unflagged S2+.
- One nuance the last fresh walks surfaced: the brand-profile prefill is now 5-8 rivals ranked by AI-recommendation share (cache key `analyze2`), so the cold profiles may differ from the prod trackers' configured rosters. That is expected - judge the seeds against the profile the walk drew, which is in the context file.
