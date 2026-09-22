<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Procerno operating rules (Tyler's standing instructions)

- **No coding runs, eval passes, or API-spend tests without Tyler's explicit go.** This includes tracker collection runs. Collected data is held UNCODED: `RUN_COLLECT_ONLY` is set in Vercel prod and must be set locally in any driver script.
- **Never code answers into the prod `responses` table during experiments** - eval/reference codes go to local JSONL only. The held runs stay `collected` until Tyler flips prod.
- **Anthropic budget:** Build tier, $1K/month workspace cap. Reference labeling (Opus) may run via the Anthropic **Batch API** (amended 2026-09-21 with Tyler's go): model `claude-opus-5`, output to local JSONL only, NEVER to prod tables; submission itself still needs Tyler's explicit go per run, like all API spend. The old in-session-subagent route remains valid.
- Git: commit straight to master (single dev, no feature branches). No Co-Authored-By or AI attribution trailers. Use " - ", never em dashes, in anything user-facing.
- All extraction/coder calls run at temperature 0 (`anthropicCreateT0` handles sonnet-5 rejecting the param). Answer engines are never pinned to temperature.

## Data locations

- `~/Documents/procerno_response_vault/` - immutable (chflags uchg) gzip+sha256 exports of every collected run. Rebuild with `export_vault.mts` pattern.
- `~/Documents/procerno_eval/` - coder-evaluation ground truth and scripts:
  - `jira/opus_full_jira.jsonl` - Opus reference labels for ALL 5,720 jira answers (run a2b37945); schema `{id, outcome, top_pick, target_framing, reasons, rule, quote, boundary}`.
  - `jira/grok_full_jira.jsonl` - grok-4-fast x decompose2 temp-0 codes for all 5,720 (coder-output schema, keyed `responseId`).
  - `jira/precedents_339.jsonl`, `labels_part1-4.jsonl`, `reference_set_339.jsonl` - the ratified reference set. **Provenance correction (2026-09-21): these labels are FABLE-authored, not human-coded.** Tyler reviewed and okayed a ~20-row subset; no human coded the full 339. They agree 100% with the Opus labels on outcome/framing/top_pick, so scoring "vs the reference set" is equivalent to scoring vs Opus - it is a second-model cross-check, NOT an independent human ceiling. Do not describe these as human labels. `jira/eval_cells/` - every (coder x mechanism) eval cell from the bakeoff.
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

## Calibration-sample round (Netflix, 2026-09-21)

Tested whether a small labeled calibration sample can supply prompt parameters that improve the LoRA coder's weak field (reasons) on an unseen brand. Adapter `procerno-coder-v1` (jira-only training) over the 3,760 Netflix answers from vault run 3edb9206, temp 0, prod untouched. 150 rows drawn at random (seed 20260921, ids in `netflix/calib_150_ids.txt`); all scoring on the 3,610 held-out rows (`netflix/heldout_3610_ids.txt`). Scripts: `finetune/ft_eval_netflix.mts`, `scripts/score_netflix_calibration.py`, `scripts/score_netflix_ablation.py`; outputs `finetune/ft_netflix_{baseline,calibrated,density_only}.jsonl`.

Two parameters were measured from the 150-row sample only: (a) density - truth 1.65 codes/row vs the model's 1.02; (b) top sibling confusion - "ad-supported option" used where truth said "ad frequency".

| condition | outcome | framing | top_pick | reason P | reason R | reason F1 | codes/row |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 85.1% | 88.0% | 86.6% | 78.0% | 55.7% | 65.0% | 1.14 |
| density sentence only | 85.1% | 87.8% | 86.6% | 75.4% | 62.8% | **68.5%** | 1.33 |
| density + confusion | 85.5% | 87.0% | 86.7% | 74.4% | 62.4% | 67.9% | 1.34 |

Truth is 1.60 codes/row on the held-out set. Findings:

1. **Density transfers, and it is the whole gain.** One sentence stating the measured mean buys **+3.5 reason F1** (recall +7.1 against precision -2.6) and moves nothing else: outcome -0.0, framing -0.1, top_pick +0.0, exact-set +0.0. Adapter transfer on outcome/framing/top_pick (85.1 / 88.0 / 86.6) is unaffected by prompt density nudges.
2. **The confusion parameter is harmful - do not re-try it.** Isolated by ablation, the second sentence costs F1 -0.7, precision -1.0, recall -0.4, framing -0.8 versus density-only, and fails at its own job: naming the pair pushed "ad-supported option" from 225 to 359 emissions and from 60% to 69% wrong, with targeted confusion rows rising 87 -> 123. Naming a code pair raises salience of both codes rather than redirecting between them - same "sensitivity lever, not threshold shift" pattern as decompose3 finding (1), now with a controlled ablation behind it.
3. Spend a calibration sample on **distributional priors** (a mean a 150-row draw estimates tightly), never on error-pattern corrections - those need far more rows to estimate and then push the wrong way. The confusion parameter here rested on 3 rows and tied with a non-sibling pair.
4. Density-only still sits 0.27 codes/row under truth, so some recall gap remains reachable; whether a stronger statement recovers it or tips into precision collapse is untested.

Hygiene note: model-authored reason-code definition files (`*_code_defs.json`) are not validated artifacts and one was shown to degrade agreement. The Netflix copy was deleted; do not regenerate them from world knowledge.

## LoRA fine-tune scored (2026-09-21): the presumptive production coder

Adapter `procerno-coder-v1` (muse-glimmer-30b LoRA, jira-only training: 5,081 non-ratified Opus labels; 300 val + 339 ratified held out). Serving note: the addon does NOT serve serverless - stand up a dedicated deployment (2x H100, `enableAddons`), bind the LoRA as a deployedModel, and query with model id `<lora-model>#<deployment>` (the bare LoRA name never routes); tear down after. Eval files `finetune/ft_jira_eval.jsonl`, `ft_amex_eval.jsonl`; scorers `scripts/score_ft_jira.py`, `score_ft_amex.py`.

- jira held-out 639 (clean): outcome 93.1%, framing 90.5%, top_pick 95.3%, reasons P 80.2 / R 79.6. Ratified 339 vs the Fable reference labels: 90.6 / 87.3 / 94.1 (Fable and Opus agree 100% on these rows, so this is a cross-model check, not a human ceiling - see provenance correction above). Grok best (decompose2+tiebreak, never trained): 79.0 / 80.1 / 87.0.
- Routed slice (the rows grok's variants disagree on): routed ∩ held-out (n=184) outcome 87.5% vs grok's 54.7% - the fine-tune IS the escalation coder that the decompose3 round failed to find. Unanimous ∩ held-out: 95.4%.
- AmEx transfer (all 5,390, zero AmEx training): outcome 82.7%, framing 85.0%, top_pick 84.8% - above grok's in-domain jira score. Weakness: reason recall 47.4% (high P everywhere, low R - the adapter memorised jira's codes and density instead of reading the allowed-code list).

## New-category onboarding procedure - AmEx dry run (2026-09-21)

Procedure: (1) collect to vault; (2) author one-line code defs from ground documents; (3) Opus-label a seeded ~300-row calibration sample; (4) measure ONLY distributional priors from it (density; defs validated by paired A/B) - never error-pattern corrections; (5) gate: score the calibrated adapter on the sample, pass -> run the brand, fail -> full-label and add to the next retrain.

Dry run on AmEx (calib `amex/calib_300_ids.txt` seed 20260921, held-out `amex/heldout_5090_ids.txt`; runner `finetune/ft_eval_amex_calib.mts`, output `ft_amex_calibrated.jsonl`, scorer `scripts/score_amex_procedure.py`). Calibrated = defs block (from the 800-row paired test) + density sentence ("about 2.2 codes each", measured 2.16 on the 300; truth 2.09). Held-out 5,090:

| condition | outcome | framing | top_pick | reason P | reason R | F1 | codes/row |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 82.9% | 84.9% | 84.9% | 73.9% | 47.3% | 57.7% | 1.34 |
| defs + density | 82.9% | 85.0% | 85.2% | 77.2% | 63.3% | **69.5%** | 1.72 |

Findings: (1) **defs and density stack cleanly** - +11.8 F1 with recall +16.0 AND precision +3.3, outcomes untouched; better than either alone (defs +7.3R on the 800 sample, density +7.1R on Netflix) and far better than defs+count (+18.3R but scattershot). (2) Recovery concentrates exactly where defs disambiguate finance-specific codes: balance transfer fee R 40->89, intro apr 32->87, cash back 27->58. Localized precision cost on sibling-heavy codes (intro apr P 90->78, interest rate 81->67); travel perks stays a catch-all (P 58). (3) The 300-row gate estimates reason metrics within ~1pt of held-out truth, but outcome carries +-4-5pt sampling noise at n=300 - set gate thresholds on reasons, use outcome only as a coarse check. (4) Still 0.37 codes/row under truth - the residual recall gap is the v2 retrain's job (defs-in-prompt training on all four labeled brands), not more prompt sentences.

## v2 retrain (2026-09-21): taxonomy-reading transfers - v2 is the coder candidate

`procerno-coder-v2` (Fireworks sftj bcinxdi3, ~2.5h): 13,491 rows across jira + AmEx + Pixel with one-line code defs in every training prompt (`build_train_v2.py`; hyperparameters identical to v1 so the delta is data-attributable). Netflix fully held out; other holdouts in `split_v2.json`. Eval runner `finetune/ft_eval_v2.mts` (BRAND=..., DEFS=0 for bare-list ablation); outputs `v2_{jira_heldout,amex_calib,pixel_holdout,netflix_defs,netflix_bare}.jsonl`. Same serving note as v1: dedicated deployment + `model#deployment` id.

- jira, no regression: held-out 639 outcome 93.9 / framing 92.3 / top_pick 95.8 / F1 80.8 (v1: 93.1/90.5/95.3/79.9); ratified 339 vs the Fable reference labels 92.0/89.1/95.0 (cross-model check, not human truth).
- Trained transfer brands on clean holdouts: AmEx calib 300 outcome 89.7, F1 87.3, density 2.17 vs truth 2.16 (v1 baseline on same rows: 78.7 / 58.5). Pixel holdout 300: 92.7 outcome, F1 81.5.
- **Netflix (never trained), held-out 3,610, bare list: outcome 88.7, framing 91.7, top_pick 89.3, F1 75.7, density 1.61 vs truth 1.60** - vs v1 bare 85.1/88.0/86.6/65.0 at 1.14. Recall +20.1 with zero prompt help: multi-brand defs-in-prompt training taught the model to read the allowed list and infer density from the material. This number calibrates the new-category gate: an unseen brand now starts around outcome ~88-89, reason F1 ~75.
- **Authored defs HURT v2 at inference on the unseen brand** (F1 73.6 vs 75.7 bare: -7.3 recall for +4.1 precision - pushes it conservative). Second failed unvalidated Netflix defs sheet, and this one against a defs-trained model. Procedure inversion for v2: **new categories run bare-list by default**; a defs sheet is an optional per-brand lever that ships only if it wins its paired test on the calibration sample. The density sentence is obsolete. (First-draft hygiene reminder: the initial authored Netflix defs contained 8 codes not in the taxonomy - always diff against the project's `reason_taxonomy` before use.)

## Taxonomy defect and fixed labeling pipeline (2026-09-21)

Root cause found: `getReasonTaxonomy` (suggest.ts) generated every codebook from category+competitor names alone, with an 18-22 quota, frozen at creation - a pre-data hypothesis. Consequences measured on jira: 3 of 22 codes never argued from in 5,720 answers, missing real axes (migration tooling appears in 3 of 5 randomly drawn no-reason picks), umbrellas beside their own specifics (AmEx rewards rate P 9.6% - nearly pure noise). Opus complied with the closed list perfectly (29,475 codes across 4 brands, zero off-list), so off-map arguments left NO trace in reasons - 117 jira picks and 530 conditionals carry a verdict with no coded why. The `quote` field is the only (biased) recovery channel for existing labels: it captures the outcome-deciding phrase and only surfaces gaps on rows where nothing else was coded.

Pipeline fixes shipped (this commit + `~/Documents/procerno_eval/labeling/`):
- suggest.ts: taxonomy generation now sees the grid's buying scenarios, quota dropped, no-umbrella rule in the prompt; doc marks the output a PRE-DATA seed pending the discovery revision.
- `labeling/instructions_template.md`: corrected labeler prompt - false "human-ratified" premise removed, `uncoded_reason` escape valve added (off-list argued attributes get named, reasons stays strictly on-list).
- `labeling/build_batch.mts`: builds Batch API request files from vault; modes `discovery` (full label) and `reasons_relabel` (reasons+uncoded only, judgment fields kept); claude-opus-5, no temperature param (Opus 5 rejects sampling params), cached system prompt, optional embedded precedents.
- `labeling/submit_batch.mts`: submit/poll/download, resumable via recorded batch id, refuses double-submission. SPENDS MONEY - per-run go required.
- `labeling/validate_labels.py`: hard-fails on missing/dup ids, off-list codes, bad enums; reports incidence (dead-code flags), empty-reason-by-outcome, uncoded_reason clusters. Every batch validates before the next step spends.

New-brand flow: seed taxonomy (scenario-aware) -> collect -> discovery-label ~500 rows (batch, ~$15) -> curate list from incidence/confusion/uncoded clusters, Tyler reviews -> relabel sample under ratified list -> gate coder -> code brand (or escalate to full label + retrain). Redo of existing brands runs jira first as the pilot of this exact flow (reasons-only relabel ~$80 after a 300-row pilot ~$10); quote-mining is a free cross-check on the discovery clusters, never the curation source (it is biased: outcome-phrase only, and blind to gaps that co-occur with coded reasons). STOPPED before any jira run per Tyler - next step is his go on the jira discovery batch.

Second label defect found (2026-09-21, 30-row audit + full-set check): Opus coded reasons TARGET-BRAND-CENTRICALLY - jira picks carry 2.61 codes/row with 2% empty, other-brand picks 1.02 with 33% empty, and jira-absent conditionals/no_picks are 95-98% empty even when the answer argues from on-list attributes for a competitor. The codebook never stated whose arguments count; Opus generalized the framing section's target-only scope. Tyler's decision: reasons are **BRAND-AGNOSTIC** (the dashboard must answer "what arguments do we lose to") - written into `labeling/instructions_template.md`. Outcome/top_pick were always brand-agnostic (O-TEST has no brand scope) and target_framing stays target-scoped by design, so the redo remains a reasons-only relabel; judgment fields carry forward. Expect relabeled truth density to rise substantially (~2.6 codes/row on argued rows), so pre-relabel reason-F1 numbers are not comparable to post-relabel ones - v3 gets fresh baselines. v2's reason head inherits the target-centric bias; its judgment fields are unaffected.

## Discovery pilots ran on all four labeled brands (2026-09-22, ~$30 total)

Per brand: 500 seeded discovery rows (brand-agnostic REASONS + uncoded_reason valve) + 100 open-coded arm, Batch API, cached codebook prefix (~$7/brand). All hard gates pass. Files: `labeling/results_{brand}_{discovery500,open100}.jsonl`, raw archives `raw_results_*.jsonl`, proposals `proposal_{brand}.json` + `.report.md`. The curation engine (`labeling/curate_taxonomy.py`) mechanizes the manual step: cuts by incidence floor (1%), one index-based Opus clustering call assigns every off-list phrase to an existing code or a new cluster (counts recomputed mechanically; granularity clause + 2% add-floor after the first run over-fragmented at 41 adds), rename signals report-only, valve score decides single-pass vs relabel.

Results: jira keeps 19 / cuts 3 / adds 18; AmEx 21/1/17 (missing at scale: statement credits 15.4%, credit reporting 14.6%, employee cards 11.8%); Netflix 19/1/21 (dvr 15.0%, cancellation policy 9.8%, account sharing 7.4%); Pixel 18/3/20 (data migration tools 15.4%, promotional credits 11.0%, size ergonomics 7.8%). Cross-brand findings: (1) seeds under-cover far more than they over-generate (1-3 cuts vs 17-21 adds per brand) - the missing mass is switching/lifecycle economics (migration, cancellation, lock-in, promo credits), exactly what scenario-aware seeding should capture; (2) valve score is 44-65% on every brand, always below the 75% single-pass threshold -> the relabel-under-ratified-list branch is the de-facto standard path; (3) brand-agnostic scope collapsed jira empty-reason picks 8%->2%, conditionals 33%->5%, and revived codes the target-centric labels had starved (kanban 0->2.2%).

Ops notes baked into the scripts: Opus 5 batch rows occasionally spend the whole max_tokens on thinking (empty text) - recover those ids with live calls at max_tokens 4000; submit_batch must await the write-stream flush before process.exit (two result files were silently lost to this before the fix; raw archives saved both times).

## Taxonomy-free coding round (2026-09-22): the list suppresses discovery; the taxonomy is market-real

Open (no-list) Opus coding of all 500 discovery rows per brand (`labeling/results_open_rest.jsonl` + the pilot open-100s; comparison `compare_open_vs_seeded.py`): taxonomy-free coding rediscovers 99-100% of the incidence-weighted ratified lists on every brand AND finds high-volume arguments the seeded pass buried - the seed list acts as a gravity well (jira git/ci integration: 61 rows open vs 4 via the seeded valve, absorbed into "integrations ecosystem"). Consequence: discovery runs TAXONOMY-FREE; `getReasonTaxonomy` deleted from suggest.ts (projects now create with an empty taxonomy - it is discovered, never guessed). Anchor-free clustering of open phrases over-fragments (66-84 codes/brand at 2% floor, `proposal_*_open.json` held as drafts) - the consolidation stage needs an altitude/scope rule and a ~25-40-code dashboard prior; prod version should be embeddings-first with LLM adjudication, not all-LLM (the all-LLM mapping calls run minutes each).

Cross-model match (grok-4-fast, temp 0, byte-identical open prompts, 2,000 rows, ~$1; `grok_open_runner.mts`, `compare_grok_opus.py`): grok rediscovers 99-100% weighted on all four brands (AmEx 38/38 incl. the one code Opus open missed); zero meaningful model-exclusive codes except grok's benefit-language drift on jira ("risk reduction", "goals and outcomes" - wrong altitude, spec for the consolidation scope rule). Row-level grok-vs-opus Jaccard 0.40-0.57 - equal to Opus-vs-itself across prompt conditions, so ~0.55 is the ambient inter-coder ceiling for exact reason sets; calibrate v3 reason-F1 expectations accordingly (60s-70s = "as good as another Opus"). Economics: Opus batch $7.61/1K rows (thinking dominates: ~300 out-tokens/row) vs grok live ~$0.45/1K, same ~10min wall time. Division of labor: **grok for discovery coding, Opus for ratified-truth relabels**.

Review-gate design (Tyler): invert into a customer feature - after discovery, a findings screen ("your market's arguments") with per-code evidence (incidence, quote snippets) and Claude-authored recommendations (include / out-of-scope / merge / flag), customer confirms -> ratified -> coding wave. Tyler reviews only the bootstrap brands to calibrate thresholds and scope rules.

Open: consolidation stage (altitude rule + size prior, embeddings-first later) -> corrected four-brand proposals -> Tyler/customer-style confirmation -> full reasons-only relabels under ratified lists (Opus batch, ~$250 all four) -> v3 retrain. Production coder decision, prod config flip, and coding the 26,070 held answers await Tyler's go. Remaining fleet to collect (trimmed panel): AG1, athenahealth, Purple, PwC, Nest - 2,440 prompts, ~26,840 answers at the full engine set; per-category calibration labeling is ~$10-25 on the Batch API if the subagent rule is ever lifted for prod.
