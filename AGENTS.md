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
  - `netflix/opus_full_netflix.jsonl` - Opus reference labels for ALL 3,760 Netflix answers (run 3edb9206, coded from vault, prod untouched).
  - `pixel/opus_full_pixel.jsonl` - Opus reference labels for ALL 3,920 Google Pixel answers (run 78704e8f, coded from vault, prod untouched).
  - `*/opus_coding_instructions.md` - the ratified codebook as given to the Opus labelers; each tracker's copy is the jira codebook retargeted to that brand, with its reason list taken verbatim from the project's prod `reason_taxonomy`.
  - `scripts/` - fill/score scripts (`jira_grok_fill.mts` shows the env-before-import pattern: set `EXTRACT_SOLO` / `EXTRACT_OUTCOME_MODE` before importing providers).

## Collection state (reconciled against prod 2026-09-20)

Prod `responses` holds **26,070** rows across 6 runs, matching the vault row-for-row: jira 5,720 (`complete`), American Express 5,390, Google Pixel 3,920, Netflix 3,760, Doritos 3,680, Sephora 3,600 (all `collected`, `completed_at` null). `mentions` is empty - **zero answers are coded anywhere in prod**, jira included. The earlier "~34K" figure was an unsourced estimate; it matched nothing in prod and has been replaced.

Engine-coverage gap: all 11 projects are configured for the same 11-engine set, but the four runs launched 2026-09-19 00:05 (Netflix, Sephora, Google Pixel, Doritos) stored an 8-engine `models` list - `claude-sonnet-5`, `claude-sonnet-5-search` and `claude-haiku-4-5-20251001` are missing, with no error recorded. Only jira and AmEx have Claude coverage. Backfilling the four is 1,870 prompts x 3 engines = 5,610 answers; awaiting Tyler's go like every other run.

## Coder evaluation state (as of 2026-09-21, decompose3 round complete)

Baseline grok-4-fast x decompose2 (temp 0) vs the 5,720-row Opus ground truth: **outcome 77.1%, framing 80.0%, top_pick 86.5%** (reason P 43.9% / R 64.3%). Best config after the decompose3 round: **decompose2 + tiebreak second pass (`EXTRACT_OUTCOME_MODE=decompose3_tiebreak`) - outcome 79.0%, framing 80.1%, top_pick 87.0%**, phantom-clarification 1.3%, ~1.33 grok calls/answer.

Nine prompt variants ran full-set (files in `~/Documents/procerno_eval/jira/decompose3/`, scorer `scripts/score_decompose3.py`): split 78.2%, tiebreak 79.0%, default 77.2%, evidence 67.8%, fewshot 75.6%, contrast 75.2%, traps 77.1%, summarize-then-code 58.0%/65.7% (v1/v2). Findings that should stop repeat work: (1) grok's errors are two-sided at both judgment boundaries - prompt changes shift thresholds and trade cells, they never add discrimination; (2) quote/evidence gates make grok refuse positive judgments (reasons recall 64->20%, outcome 77->68%); (3) errors are shared difficulty, not model noise - on the 339 ratified rows only 2 of grok's 82 errors are grok-alone, and 105 rows are missed by 3+ of 5 bakeoff configs; (4) route-by-instability works as a detector (split+tb+traps disagreement flags 28% of rows carrying ~65% of errors; grok is 89.1% on the unanimous rest) but no cheap escalation coder exists: gpt-5-mini scored 41.1% on the routed slice (grok itself: 54.7%), summarize-then-code 48.3%; (5) gpt-5 family rejects temperature 0 - `openaiCreateT0` handles it (codes at default temp, not deterministic).

Open: Fireworks LoRA fine-tune (qwen-class judgment coder trained on the 5,081 non-ratified Opus labels, 339 held out; `~/Documents/procerno_eval/finetune/`) - launched from a separate session; score it on the full set AND the routed slice (`decompose3/routed_slice.txt`). Production coder decision, prod config flip, and coding the 26,070 held answers all await Tyler's go. Remaining fleet to collect (trimmed panel): AG1, athenahealth, Purple, PwC, Nest - 2,440 prompts, ~26,840 answers at the full engine set.
