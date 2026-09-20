<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Procerno operating rules (Tyler's standing instructions)

- **No coding runs, eval passes, or API-spend tests without Tyler's explicit go.** This includes tracker collection runs. Collected data is held UNCODED: `RUN_COLLECT_ONLY` is set in Vercel prod and must be set locally in any driver script.
- **Never code answers into the prod `responses` table during experiments** - eval/reference codes go to local JSONL only. The held runs stay `collected` until Tyler flips prod.
- **Anthropic budget:** Build tier, $1K/month workspace cap. Reference labeling (Opus) runs as in-session subagents on Tyler's usage plan, NEVER via the Anthropic API.
- Git: commit straight to master (single dev, no feature branches). No Co-Authored-By or AI attribution trailers. Use " - ", never em dashes, in anything user-facing.
- All extraction/coder calls run at temperature 0 (`anthropicCreateT0` handles sonnet-5 rejecting the param). Answer engines are never pinned to temperature.

## Data locations

- `~/Documents/procerno_response_vault/` - immutable (chflags uchg) gzip+sha256 exports of every collected run. Rebuild with `export_vault.mts` pattern.
- `~/Documents/procerno_eval/` - coder-evaluation ground truth and scripts:
  - `jira/opus_full_jira.jsonl` - Opus reference labels for ALL 5,720 jira answers (run a2b37945); schema `{id, outcome, top_pick, target_framing, reasons, rule, quote, boundary}`.
  - `jira/grok_full_jira.jsonl` - grok-4-fast x decompose2 temp-0 codes for all 5,720 (coder-output schema, keyed `responseId`).
  - `jira/precedents_339.jsonl`, `labels_part1-4.jsonl`, `reference_set_339.jsonl` - the human-ratified reference set; `jira/eval_cells/` - every (coder x mechanism) eval cell from the bakeoff.
  - `amex/opus_full_amex.jsonl` - Opus reference labels for ALL 5,390 AmEx answers (run 34d46b95, coded from vault, prod untouched).
  - `*/opus_coding_instructions.md` - the ratified codebook as given to the Opus labelers.
  - `scripts/` - fill/score scripts (`jira_grok_fill.mts` shows the env-before-import pattern: set `EXTRACT_SOLO` / `EXTRACT_OUTCOME_MODE` before importing providers).

## Collection state (reconciled against prod 2026-09-20)

Prod `responses` holds **26,070** rows across 6 runs, matching the vault row-for-row: jira 5,720 (`complete`), American Express 5,390, Google Pixel 3,920, Netflix 3,760, Doritos 3,680, Sephora 3,600 (all `collected`, `completed_at` null). `mentions` is empty - **zero answers are coded anywhere in prod**, jira included. The earlier "~34K" figure was an unsourced estimate; it matched nothing in prod and has been replaced.

Engine-coverage gap: all 11 projects are configured for the same 11-engine set, but the four runs launched 2026-09-19 00:05 (Netflix, Sephora, Google Pixel, Doritos) stored an 8-engine `models` list - `claude-sonnet-5`, `claude-sonnet-5-search` and `claude-haiku-4-5-20251001` are missing, with no error recorded. Only jira and AmEx have Claude coverage. Backfilling the four is 1,870 prompts x 3 engines = 5,610 answers; awaiting Tyler's go like every other run.

## Coder evaluation state (as of 2026-09-20)

Exact full-set accuracy of grok-4-fast x decompose2 (temp 0) vs the 5,720-row Opus ground truth: **outcome 77.1%, framing 80.0%, top_pick 86.5%** (reason precision 43.9% / recall 64.3%). Runner-up consensus x ladder_bare was 72.9% outcome on the 339-row reference set at ~5x the cost. Grok's dominant error: stated defaults coded conditional (pick->conditional, 31.5% of errors). Production coder decision, prod config flip (`EXTRACT_SOLO=grok-4-fast`, `EXTRACT_OUTCOME_MODE=decompose2`, clear `RUN_COLLECT_ONLY`), and coding the 26,070 held answers all await Tyler's go. Remaining fleet to collect (trimmed panel): AG1, athenahealth, Purple, PwC, Nest - 2,440 prompts, ~26,840 answers at the full engine set.
