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

## Census + consolidation bakeoff (2026-09-22): embeddings-first wins prod

Full-brand discovery census ran on grok-4-fast (engine module `src/lib/engine/discovery.ts`: coverage param default 100%, equal-per-engine stratified sampling below that, metered to cost_log as discovery:open per project): 18,790/18,790 answers, $5.03 total, ~35-60 min/brand. The ledger also gained an **rnd boolean** (additive to project/run attribution; production COGS = WHERE NOT rnd; backfilled - everything to date except run:*/setup:*/tagged discovery is R&D).

Two consolidation implementations built and compared on all four censuses (`labeling/consolidate_taxonomy.py` = all-LLM reference; `labeling/consolidate_embed.py` = embeddings-first: text-embedding-3-large + leader clustering at tau 0.60, ONE Opus consolidation call for altitude/scope/naming; comparison `compare_consolidations.py`, one-to-one semantic pairing):

| brand | LLM codes | embed codes | weighted match LLM-side / embed-side |
| --- | --- | --- | --- |
| jira | 35 | 37 | 98% / 96% |
| AmEx | 37 | 35 | 80% / 90% |
| Netflix | 38 | 38 | 92% / 92% |
| Pixel | 38 | 33 | 74% / 90% |

Read: embed-side ~90-96% = content agreement; the LLM-side deficit is one-to-one pairing punishing slicing granularity (LLM splits camera/APR into shards; embed consolidates) - the truly unmatched codes are all tail (<16%). **Embed version is the prod consolidation stage**: same content at 8 min/$0.50 vs 60-90 min/$3-4, deterministic similarity core (the all-LLM version needed four robustness patches in one day: thinking-truncation, duplicate assignments, trailing commas, stream-buffer loss), one judgment call to audit, granularity a knob (tau + altitude prompt) instead of per-run drift. The all-LLM version is retained as an occasional QA cross-check only. Consolidation runs log to the ledger (discovery:consolidate, production).

Four ratified-candidate taxonomies exist for review: `labeling/ratified_{brand}_embed.json` (+ .report.md; codes with incidence, evidence phrases, scope flags in/boundary, recommendation, rationale - the confirmation-screen artifact). Known open knob: the two versions slice differently at the same content; the confirmation pass is where slicing taste gets settled.

## Two-gate confirmation flow shipped (2026-09-23)

The tracker page now runs the full pipeline UI: collection progress -> inline codebook review (A+ workbench: unified rows, cross-bucket merge/unmerge, cosmetic renames with canonical kept, M1 move-mode for micro reassignment shipping as phrase_moves, S1 tier sizing - DOMINANT/MAJOR/COMMON/OCCASIONAL from within-brand quartiles, numbers withheld until coding - card scrollers, sticky confirm bar, per-row needs-your-call rationale derived from stored fields, snapshot undo) -> brand dictionary gate -> coding waiter. Decision storage: taxonomy_original (snapshot), taxonomy_proposal (recommendation + top-30 micros/code), taxonomy_decision (recommended-vs-decided, renames, merges, phrase_moves) - the recommender's training data. dictionary_status gates coding behind both confirmations; confirm endpoints under /api/projects/[id]/taxonomy and /dictionary/confirm. jira's stale 'complete' run status reset to 'collected' (Tyler's go) so all four brands sit on the gate.

Brands discovery pass ran (2026-09-23, grok, 18,790 answers, ~$5, ledger purpose discovery:brands): `runBrandDiscovery` in the discovery module + `scripts/run_brand_discovery.mts` + `aggregate_brand_observations.mts` -> projects.brand_observations. The dictionary gate now shows observed tiers per tracked brand, NOT SEEN flags, and emerged brands. Immediate finds: jira's dictionary was missing Linear (36% of answers) and GitLab (26%); Pixel's tracks device names but not Samsung/Apple/Google as makers (36/25/37%); AmEx missing Priority Pass (14%). Files `labeling/grok_brands_*.jsonl`.

Open: Tyler (or customer-style) confirmation of the four embed taxonomies -> full reasons-only relabels under ratified lists (Opus batch, ~$250 all four) -> v3 retrain. Prod build list: embeddings-first consolidation as engine module, confirmation card in console, Fireworks provider integration. Production coder decision, prod config flip, and coding the 26,070 held answers await Tyler's go. Remaining fleet to collect (trimmed panel): AG1, athenahealth, Purple, PwC, Nest - 2,440 prompts, ~26,840 answers at the full engine set; per-category calibration labeling is ~$10-25 on the Batch API if the subagent rule is ever lifted for prod.

## Dictionary suggest: per-name cache + model bakeoff (2026-09-22)

dict_suggest.ts reworked into a one-time pre-review: each pending name gets ONE gpt-5-mini verdict, cached per name (key: rules version + project + name hash), computed against the active set as it stands when the name first appears. User dispositions are ground truth - approving/merging/ignoring never invalidates other names; only never-seen names (new coding/brands passes) hit the model. Merge targets resolve to entry ids fresh at read time. Replaced the queue-snapshot hash key that re-ran the whole queue after every board action. `suggestSystemPrompt()` exported for evals.

Bakeoff on the 4 brands' real pending queues (281 names, byte-identical v5 prompt; `scripts/dict_bakeoff.mts`, files `~/Documents/procerno_eval/dict_bakeoff/`, Fable-adjudicated truth in tiers - rule-clear / calibrated / taste-excluded): **gpt-5-mini wins and stays prod** - rule-clear 91%, full 70% (sonnet-5 82/58, grok 42/58, haiku 33/48; latency 64.6/38.1/19.2/10.6s median batch). Failure modes: grok mass-merges card products into issuers (grain violation); haiku over-ignores real brands and ecosystem merges; sonnet over-approves scope (publications, merchants - the eBay/1Password tray noise). gpt's one systematic miss: merging content brands into carrier streamers (Marvel -> Disney+). sonnet-5 is the designated fallback. Latency now amortized by the per-name cache. Tier-c scope questions for Tyler in the report (co-brand partners, merchants, benefit programs, aggregators).

Brand detection prompts: grok's BRANDS_SYSTEM is category-blind by design (recall-first; relevance is dict_suggest's job - it DOES get the category). The prod coder's mentions instruction (providers.ts ~1088) carries the stronger grain language ("product, not its parts"); aligning runBrandDiscovery's dedupe line with it is a noted forward fix.

## Pipeline gating shipped (2026-09-22): nothing is announced before its algorithms finish

- **Init runs** (taxonomy unratified): runner routes to `src/lib/engine/bootstrap.ts` - open discovery + brands discovery (grok, per-answer resumable via new `responses.discovery_codes/discovery_brands`, 2% failure tolerance), then embeddings-first consolidation (`src/lib/engine/consolidate.ts`, the prod port of consolidate_embed.py: text-embedding-3-large + leader clustering tau 0.60 + one Opus effort-medium call, all robustness patches) -> setTaxonomyProposal, then brand_observations aggregation + emerged-name queue + junk filter + suggestion pre-warm. Run stays "running" (dashboard: "Measuring your market's arguments") and flips to "collected" only when all of it is done. RUN_COLLECT_ONLY parks the run at collected BEFORE any discovery cent. Consolidation gets a dedicated invocation; driver routes maxDuration 300 -> 800 (Vercel fluid).
- **Scheduled runs** (ratified): existing sequence is the contract - collection -> coding wave -> finalize (new-name dictionary triggers, junk filter, suggestions, prompt health) -> only then "complete". Documented on finalizeRun; future codebook-drift triggers belong there.
- **Dictionary gate is now 3 steps in the pipeline card** - (1/3) brands board, (2/3) parents, (3/3) analysis settings - back button, confirm on step 3; Analyze tab extracted to shared `AnalysisSettings` so modal and gate render the same views. No footer-modal detour.

## Suggestion rules v7 shipped (2026-09-23): Tyler-calibrated, harness-validated

The dictionary-suggest wobble was diagnosed end to end: gpt-5-mini rejects temp 0, so borderline names (accessories, first-party services, carriers, camera partners) re-roll between merge/approve/ignore across runs AND across batch compositions - the board Tyler ratified was one favorable v5 batch roll (2026-09-23 02:45), not a reproducible version. A 5-run single-name harness (`scripts/dict_stability_eval.mts` pattern; outputs in ~/Downloads, boards artifact) measured v4 56/71 unanimous, v5 60/71, and drove rule iteration. **v7 rules** (commit 08af64b): approve ONLY for different-maker competitors; independent non-category companies (carriers, suppliers, retailers, publications, bystander apps) are ignore per Tyler; active-brand ecosystems (companion devices, first-party services/stores, migration tools, co-branded components like Leica-on-Xiaomi) and named models/trims of active lines always merge. Validation: Pixel unanimity 68/71, 68/71 match to the ratified board (misses: two single-name harness artifacts + Pixel Watch, where the rule is more consistent than the roll); AmEx stability 42->60/72 with cards merging into issuers. Pixel's ratified board is PINNED verbatim into the v7 per-name cache (never re-rolls); jira/amex/netflix warmed under v7. Open per Tyler: the a-priori dictionary seed itself is still treated as truth (same defect shape the taxonomy had before the seed was deleted) - symmetric confirm-everything gate remains undecided.

## v8 suggestions (2026-09-23): mechanical family layer - determinism achieved

`buildFamilyPlan` (dict_suggest.ts) groups pending names by token containment before any model call: a name extending a tracked brand/alias merges into it mechanically (zero model calls - 17 of Pixel's 71); a name extending another pending name inherits that root's verdict (11 more). Only family roots reach the model (43 on Pixel). Validation: two fresh Pixel runs produced BYTE-IDENTICAL boards, 69/71 matching the Tyler-ratified board; both stable diffs (Pixel Watch, Wear OS -> merge Google Pixel) are the rules out-consisting the ratified roll. The ratified board itself is pinned verbatim under v8 keys. Fresh v8 boards for jira/amex/netflix fixed every scattered family Tyler flagged (Wells Fargo + its cards, BankAmericard -> Bank of America, YouTube + Kids/TV, Sony/Vivo devices, Atlassian Access/Guard now follow Atlassian to ignore). Residual root-level warts awaiting Tyler's taste call: AmEx co-brand partners merged into issuers (Amazon/United/Marriott -> Chase, Delta/Hilton -> AmEx, Costco -> Citi, Walmart -> Capital One - issuer-share inflation); Netflix devices merged into Apple TV+ (iPhone/iPad) and content-brand handling inconsistent at roots (Marvel -> Disney+ but Pixar -> ignore); Bitbucket/Confluence still merge into jira (target-brand inflation). Each is a one-sentence rule + cheap re-warm once decided.

## Co-occurrence guard (2026-09-23): the dictionary's admission rule is now measured

Tyler's insight, operationalized: a merge-candidate's alone-share (answers naming it WITHOUT its proposed parent, computed from responses.discovery_brands) sorts it into three bins - <=5% alone = redundant vocabulary (parent already matches those answers; the information is argument material for the reason codes) -> ignore; >=30% = own-context brand whose merge would inflate the parent -> ignore; 5-30% = genuinely referential (people call Max "HBO") -> merge kept, annotated "- review" with the measured number. String-variant family merges exempt. Guard lives in dict_suggest (fires only when discovery data exists); discovery_brands backfilled into prod for all 18,790 script-era rows. One-off cleanup flipped 37 verdicts across jira/amex/netflix - including Confluence out of jira's bucket (2% alone, n=919: resolved the target-inflation flag mechanically), BankAmericard's bad Visa->BofA merge chain (67% alone), CBS->Paramount+ (77%), Amazon->Chase (66%), and all the AmEx program vocabulary (Membership Rewards 0%, Fine Hotels + Resorts 2% - Tyler's own example). Verified measurement safety first: read-time metrics already dedupe per answer per entry (metrics.ts perResponse), so low-alone aliases were no-ops and dropping them changes nothing. Wells Fargo promoted to active competitor on AmEx with its three card names as aliases (Tyler's call). Dictionary admission principle: real offerings + string variants + measured-referential satellites; everything else is reasons material or scenery.

## Pixel pin retired (2026-09-23): the engine IS the board

Tyler's call after the guard refinement: Pixel's cached pin was deleted and the board regenerated through the live engine (family layer + v7 rules + refined co-occurrence guard). The fresh output matched the offline guard preview on ALL 71 names (37 merge / 5 approve / 29 ignore, 9 review-flagged) - the pipeline is deterministic enough that pinning is no longer needed anywhere. All four boards are now pure engine output; artifact (claude.ai/artifact/4amkYsbjwTN64rMbDQ91Rb) shows exactly what the gates serve. Also: sub-1% emerged names are never served (aggregation floor 1% + board-level filter with a one-line receipt; today's four trays all sit >=1.5% so nothing visibly changed - the floor bites for Doritos/Sephora/fleet bootstraps).

## Brand-detection improvements 1-5 shipped independently (2026-09-24)

1. **Word-boundary validation** (mention_filter.ts, wired into the brands pass AND prod coder mentions parsing): detected name must appear token-bounded in the answer (plural-tolerant, any-distinctive-token fallback, dictionary names exempt). Census-measured: rejects 0.00-0.08% of detections, all true phantoms (Marvel-in-Maisel); naive version over-rejected plurals/canonicalizations (iPhone x56, American Express x164) and was calibrated down.
2. **Unified detection vocabulary**: BRANDS_SYSTEM adopts the prod coder's mentions grain text; guard reads mentions table when discovery_brands absent. A/B (300 answers): +12-44% detections - models/editions/first-party services the family layer absorbs - and compound junk forms gone.
3. **Recomputable family-aware observations** (observations.ts): attribution by matchKey or family containment against the LIVE dictionary; recomputed by bootstrap and after every dictionary action (staleness class dead). Emerged strangers 71/67/72/71 -> 28/28/24/40 across the four boards.
4. **Detection recall audit** (dict_bakeoff/detection_audit.jsonl): 100 answers, sonnet-5 reference with the unified prompt vs the OLD-prompt census: recall 70%, precision 83% - most of the gap is the old-vs-new prompt delta (#2 closes it: Pixel's 49% recall is the completeness classes the A/B showed +44%); true misses concentrate in Netflix content titles. Re-audit on the first fleet bootstrap (new prompt) for the real number. Coder-mentions recall remains unmeasured and the v3 coder's mentions path is an open design decision (v2 trained on Opus labels that have no mentions field).
5. **Observed-form aliases** (refreshObservedAliases): sub-floor surface forms (3+ answers, <1%) alias into their family entry automatically; never-observed seeded aliases reported as prune candidates (~15/brand). familyContains tightens single-token matches (must lead the form) after naive containment aliased 'fire tv stick 4k max' into Max and 51 other-issuer cards into Visa/Mastercard - all swept. Net ~407 clean aliases across four brands; the recurring lesson: the network-vs-issuer seed grain keeps producing the same misattribution shape.

## Coding-phase reminder (Tyler, 2026-09-24): family granularity is cosmetic AT THE BOARD only

The gate collapses family variants (Jira Align/Advanced Roadmaps under jira, device models under their line, "+N variants" chips) and those variants commit as ALIASES of one entry. What that means when coding runs: (1) the coder's mentions resolve to the family entry at read time via matchKey over aliases - variant surface forms MUST stay in the alias sets or their mentions drift to pending; (2) per-variant analytics are not lost - mention rows keep the raw brand string and dictionary resolution is read-time, so model-level or product-level drill-down (S24 vs S25, JSM vs Jira) is recoverable later without recoding; (3) if a variant ever needs its own dashboard row, unalias it and metrics recompute retroactively. Also shipped: declaredForms - a parenthetical in a tracked name ("Max (HBO)") is a declared alternate, exact matches merge silently (HBO unflagged); variant-collapse chips per bucket (hand-moved pills never re-collapse; hidden variants still commit on confirm).

## v9 (2026-09-24): relationship-typed merges - the Business Platinum lesson

Tyler's catch: vocabulary-ignoring a card name is NOT measurement-neutral at coding time - framing and top_pick ride the specific mention ("I'd get the Business Platinum" as an ignored name loses the endorsement; as an alias it credits AmEx). And the 5% alone-share line had split sibling cards incoherently (Blue Cash Everyday review-merge vs Business Platinum vocab-ignore). The semantic distinction no string rule can make - product-form vs affiliated sibling - the model now makes explicitly: every merge suggestion carries relationship (same_offering | product_of | affiliated | content_of). Dispositions: product forms ALWAYS merge (bands only decide the review flag - picking the product is picking the target); affiliated/content keep the measured ignore bands (Confluence correctly stayed ignored - praising Confluence is not praising jira). Re-sweep changed 20 dispositions; classifier over-reach corrected by hand (devices are the company's products, not forms of the streaming service: iPad/iPhone/Fire TV stay ignored; HyperOS had a wrong target). Ignore-audit misses fixed: Microsoft Project approved (real PM competitor the model lumped with Microsoft scenery), JetBrains YouTrack folded into approved YouTrack. Remaining audit flags for Tyler: high-volume rule-consistent ignores (Priority Pass 14%, Slack 22%, Roku 19%, ESPN 13%) and two proposed process improvements not yet built: family-consistency reconciliation after sweeps, and volume-escalated amber ignores in the receipt.

## Target-brand invariant (2026-09-24): the corruption incident and its guard

Incident: the AmEx tracker's dictionary was found with the American Express entry itself REJECTED (its 99 merge-earned aliases still attached), three unrelated entries wearing "your brand" chips, and the gate reset to 1/3. Cause chain: the pre-rewrite Analysis-settings view exposed a reject control on every active row - the target included - and one click there (step 3/3, where Tyler was) rejected the tracker's own subject; the "your brand" chips were a separate defect (role=null rendered as "your brand", so any approve without a role wore the chip). Repaired in place: entry re-activated with aliases intact, wrongly-approved rows returned to pending, re-queued card forms folded back mechanically.

Invariant now enforced in three layers: (1) SERVER - the dictionary route refuses reject/merge/merge_other against any entry whose canonical or alias matchKeys to project.brand (proven by replaying the exact corrupting action: refused, applied 0); (2) confirmAll never emits a reject for a target pill wherever it sits; (3) Analysis settings renders a static "Always in" on the target row. Chips derive from the target identity, never from role defaults. Gate step persists per project in localStorage (cleared on final confirm) so reloads resume, not restart. Lesson: any UI that can emit a status-changing dictionary action must be assumed to eventually hit the target entry - identity invariants belong in the route, not the client.

## v3 relabel complete (2026-09-25, Tyler's go): reasons under the confirmed taxonomies

Reasons-only relabel of all 18,790 answers (jira 5,720 / AmEx 5,390 / Netflix 3,760 / Pixel 3,920) on claude-opus-5-5, effort high, max_tokens 8000, Batch API, no precedents, brand-agnostic scope + uncoded_reason valve, under each tracker's gate-confirmed list exported read-only from prod (`labeling/taxonomy_<brand>_ratified.json`: 37/34/35/33 codes). **Spend $138.99** (jira 47.55, AmEx 36.16, Netflix 27.60, Pixel 27.68; ~$7.40/1K rows at ~400 out-tokens/row) + $0.15 pre-submission probe; zero errored, zero max_tokens, zero live recoveries. All four pass validate_labels.py hard checks. Files: `labeling/v3_relabel/` (requests, batch ids, raw archives `raw_results_v3_*`, `results_*_final.jsonl`, `validate_*.txt`, `cost_*.json`); merged truth `<brand>/v3_truth_<brand>.jsonl` = relabeled reasons + uncoded_reason on carried-forward outcome/top_pick/target_framing/quote. Nothing written to prod.

Findings:
1. **Truth density is ~4 codes/row, not ~2.6** - jira 3.80 (old 1.22), AmEx 4.11 (2.10), Netflix 4.15 (1.60), Pixel 4.18 (1.32); empty rows 2.6-9.0%, concentrated in no_pick/clarification. Spot-checked high-count rows: codes are genuinely argued-from (long comparison answers argue many attributes for many products once scope is brand-agnostic, on 33-37-code lists). Reason metrics are on a new scale - no pre-relabel reason number is comparable.
2. **Uncoded clusters are real gaps in confirmed lists** (rows with any uncoded: jira 13.8%, AmEx 28.0%, Netflix 20.1%, Pixel 25.7%). Largest: AmEx consumer credit-score impact (~250 mentions: score impact 120, history length/age 91, utilization 43 - the list only has business credit reporting), retention offers 99, points forfeiture 64; jira release tracking/management ~64, uptime/SLA ~61; Netflix live-stream latency ~113, free trial ~44; Pixel foldable form factor 63, compact size ~75, spam-call screening ~67, RAM 50. Taxonomy revision is Tyler's call; the training target ignores uncoded_reason.
3. Near-dead confirmed codes: AmEx issuer reputation 0.4%, Pixel health safety features 0.3%, Netflix support and terms 0.3%, jira collaboration notifications 1.0%.

## v4 relabel (2026-09-25, Tyler's go): scope-aware codebook - the "gaps" were a prompt defect

Tracing v3's uncoded clusters back through consolidation showed most were NOT missing codes: the census saw them and consolidation folded them into parents whose confirmed scope sentence names them explicitly (vendor support: "support SLAs/quality, uptime"; cancellation flexibility: "trials"; design build durability: "form factor, size"; ai features: "call/spam screening"; approval odds: "personal credit profile"). The v3 relabel showed Opus code NAMES only, so it filed those arguments as uncoded - and train_v3 therefore pairs a defs block that says "uptime -> vendor support" with answer keys that omit it. v3 was trained anyway (job gxp065t1, per Tyler) as the names-only arm of the comparison.

v4 = identical relabel with the scope-aware codebook: `build_batch.mts --defs finetune/defs_v3_<brand>.json` puts each code's scope sentence in the allowed-code block and restricts uncoded_reason to "arguments NO code's definition covers" (no-flag builds verified byte-identical to v3). **Spend $142.13**, all four validate, zero failures/recoveries. Files `labeling/v4_relabel/`, truth `<brand>/v4_truth_<brand>.jsonl`, `finetune/train_v4.jsonl` (prompts byte-identical to v3, answer keys differ on 10,505/13,491 rows), `build_train_v4.py`, `fireworks_launch_v4.sh`.

| brand | rows w/ uncoded v3 -> v4 | density v3 -> v4 | v3-vs-v4 row Jaccard |
| --- | --- | --- | --- |
| jira | 13.8% -> 3.4% | 3.80 -> 4.14 | 0.63 |
| AmEx | 28.0% -> 7.5% | 4.11 -> 4.00 | 0.80 |
| Netflix | 20.1% -> 11.2% | 4.15 -> 4.53 | 0.76 |
| Pixel | 25.7% -> 4.5% | 4.18 -> 4.30 | 0.79 |

Findings: (1) folded arguments land on their parents (jira uptime/SLA 82 rows -> 0 uncoded, 65 gain vendor support; releases -> portfolio planning 56; Pixel foldable/compact -> design build durability 98, spam screening -> ai features 69). (2) **The definitions move code boundaries far beyond the gaps** - jira developer experience +721 rows, process fit +344, integration ecosystem -307; Netflix plan tiers +554, catalog rotation +419; Pixel earbuds watches -254, total cost financing +201. jira's v3-v4 agreement (0.63) sits near the ~0.55 Opus-vs-Opus ceiling: the codebook contract moves labels as much as coder disagreement does. Names alone are an under-specified contract; the scope sentence the customer confirms must travel with the code everywhere (labeler, training, inference). (3) Genuine residue after scope is small and is where add-decisions belong: AmEx consumer credit-score impact (~39 rows still uncoded; 68 moved to approval odds), retention offers (~24), credit union membership, ATM fee reimbursement; Netflix home bandwidth (~24), local media playback, hardware price; jira review-source credibility, customer-feedback prioritization; Pixel return policy (~13), app availability. (4) Live-stream latency (Netflix, 113 rows) was absorbed by live sports (42) / live tv channels (14) - no definition names latency, so its placement is Opus's inference; a scope-line tweak if Tyler wants it explicit.

Fresh v2 baseline (procerno-coder-v2, byte-identical prompts to v3/v4 evals; `finetune/v3eval/v2_*`, scorer `scripts/score_v3.py`, TRUTH=v3|v4): judgment fields reproduce the recorded v2 numbers (jira held-out 639 93.4/92.3/95.8; Netflix bare 88.7/91.5/89.0), confirming carried-forward truth. Reasons under the new ~4-codes/row truth: high precision, low recall - v2 emits 1.4-2.2 codes/row vs truth 4.0-4.5. Reason F1 vs v4 truth: jira 40.6, AmEx 65.7, Pixel 54.7, Netflix bare 52.3 / consolidation-defs 52.5 (defs neutral for v2 on the unseen brand).

## Training status (2026-09-25 evening): v3 trained, v4 killed by a Fireworks account suspension

- **procerno-coder-v3** (sftj gxp065t1, hand-launched by Tyler 13:19, hyperparameters verified identical to v2 bcinxdi3): COMPLETED ~16:20, model READY. Not yet evaluated.
- **procerno-coder-v4** (sftj hzyfk7ud, launched 13:48, same recipe): FAILED at 84% (16:26:27) - "Account tsolloway-ekhu67i4gj is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices" (412 PRECONDITION_FAILED). No v4 model exists; relaunching = `fireworks_launch_v4.sh` from scratch (datasets procerno-coder-multi-v4/-val already uploaded). Minutes later the account API reported state READY / UNSUSPENDED - cause and whether the limit was raised are unknown. The eval deployment procerno-v34eval (created ~16:25) was torn down immediately (0 replicas); nothing is running on the account. Re-deploying and relaunching v4 wait on Tyler's go given the spend-limit signal.
- Fireworks API changes seen today: deployment create now requires `acceptShapelessRisk=true` (or a deploymentShape) - added to `finetune/deploy_eval_v3.sh`, which keeps the prior 2x H100 BF16 config for comparability; deleted deployment ids stay reserved, so the script now defaults to `procerno-v34eval` (override with DEP=).
- Ready to run on go: `run_v3eval.sh v3|v4` (same matrix as the v2 baseline), `score_v3.py` (TRUTH=v3|v4), `score_scope_uptake.py` (does the coder emit parent codes the names-only keys omitted - v2 baseline: 2-15% of scope pairs vs 34-56% of shared pairs).

## v3 scored (2026-09-25): taxonomy-reading transfer is strong; the coder follows its keys, not its definitions

procerno-coder-v3 evaluated on deployment procerno-v3evalb (torn down after) over the same matrix and byte-identical prompts as the fresh v2 baseline; outputs `finetune/v3eval/v3_*`, tables `finetune/v3eval_scores_{v3,v4}truth.md`. v4 relaunched as sftj r5abctd3 (running).

Reason F1 (v2 -> v3), clean held-out segments:

| segment | vs v3 truth (names-only keys) | vs v4 truth (scope-aware keys) | v3 Jaccard vs v3 truth |
| --- | --- | --- | --- |
| jira 639 | 42.1 -> **83.9** | 40.6 -> 73.9 | 0.75 |
| AmEx 300 | 66.2 -> **93.6** | 65.7 -> 88.0 | 0.88 |
| Pixel 300 | 56.2 -> **90.5** | 54.7 -> 86.7 | 0.86 |
| Netflix 3,610 bare (never trained) | 54.9 -> **83.0** | 52.3 -> 80.5 | 0.72 |
| Netflix 3,610 consolidation defs | 54.7 -> **85.3** | 52.5 -> 83.3 | 0.76 |

Findings:
1. **Reasons solved at the dense truth**: v3 emits 3.7-4.3 codes/row against truth 3.8-4.2 (v2: 1.4-2.2) with P and R balanced (jira 84.6/83.3, AmEx 94.0/93.1). Unseen Netflix bare-list F1 83.0 with 3 off-list emissions in 3,610 rows. Row Jaccard 0.72-0.88 exceeds the ~0.55 cross-condition Opus ceiling - expected, since v3 imitates one fixed labeler/prompt; read it as fidelity to that labeler, not super-human agreement.
2. **Judgment fields flat within noise** (v2 -> v3): jira 639 outcome 93.4 / 93.4, framing 92.3 / 91.1, top_pick 95.8 / 95.1; Netflix 3,610 outcome 88.7 / 88.1, framing 91.5 / 91.3, top_pick 89.0 / 89.2. The denser reason target did not buy anything on judgment, and may cost ~0.5-1pt; watch it in v4.
3. **Consolidation defs HELP at inference on the unseen brand for v3** (+2.3 F1 vs bare, P and R both up) - reverses v2's defs finding. The difference: these are the pipeline's confirmed scope sentences, not world-knowledge authored defs. New-category default should become: consolidation defs in the coder prompt.
4. **The coder follows its answer keys over its prompt definitions** (score_scope_uptake.py): on scope pairs - arguments the definitions assign to a code but the names-only keys omitted - v3 recalls 15% jira / 15% AmEx / 30% Pixel / 32-33% Netflix, against 88-97% on codes both key sets agree on. The definitions in its prompt barely move it off what it was trained to emit. So the codebook contract has to be fixed in the LABELS (v4), not patched at inference - and scoring against v4 truth costs v3 4-10 F1 exactly there.

## v4 scored (2026-09-25): scope-aware labels win - v4 is the coder candidate (production decision is Tyler's)

procerno-coder-v4 (sftj r5abctd3 - relaunch after hzyfk7ud died on the suspension; same recipe) evaluated on deployment procerno-v4eval (torn down after) over the same matrix. Tables `finetune/v3eval_scores_{v3,v4}truth.md`; scope analysis `scripts/score_scope_uptake.py`. Fireworks spend today: two completed LoRA trainings + one failed at 84%, four short 2x H100 eval deployments.

Against v4 truth (scope-aware - the contract the customer confirms on the gate):

| segment | v2 F1 | v3 F1 | **v4 F1** | v4 P / R | v4 codes/row (truth) | v4 Jaccard | v4 exact set | v4 outcome / framing / top_pick |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jira 639 | 40.6 | 73.9 | **84.6** | 85.0 / 84.3 | 4.05 (4.08) | 0.76 | 34.1 | 93.6 / 92.2 / 95.3 |
| AmEx 300 | 65.7 | 88.0 | **93.3** | 93.0 / 93.6 | 4.07 (4.05) | 0.89 | 64.3 | 87.7 / 92.0 / 93.0 |
| Pixel 300 | 54.7 | 86.7 | **92.9** | 91.6 / 94.1 | 4.18 (4.07) | 0.88 | 60.0 | 91.7 / 93.0 / 91.7 |
| Netflix 3,610 bare (unseen) | 52.3 | 80.5 | **80.7** | 80.6 / 80.9 | 4.56 (4.54) | 0.69 | 20.9 | 88.5 / 91.1 / 89.5 |
| Netflix 3,610 scope defs (unseen) | 52.5 | 83.3 | **86.3** | 86.4 / 86.2 | 4.53 (4.54) | 0.77 | 32.6 | 88.2 / 90.7 / 89.6 |

Findings:
1. **v4 learned the scope; v3 did not.** Scope-pair recall (arguments the definitions assign but the names-only keys omitted): v4 74% jira / 74% AmEx / 88% Pixel / 61% Netflix-with-defs, vs v3 15 / 15 / 30 / 32. Shared-pair recall is unchanged (89-97% both). The fix lives in the labels, as predicted.
2. **Each model wins on its own labeler's contract** (v4 scores 73.7 F1 vs v3 truth on jira; v3 scores 73.9 vs v4 truth) - so "which coder is better" reduces to "which contract is right". The scope-aware contract is what the customer confirms, so v4 is the candidate.
3. **Dashboard accuracy on trained brands is near-exact**: mean per-code incidence gap vs v4 truth 0.6 jira / 0.6 AmEx / 0.8 Pixel pts, zero codes off by >3pts (v3: 2.4 / 1.4 / 1.5, with 12 jira codes off >3 - developer experience 17.1% truth vs 5.0%).
4. **On an unseen brand, v4 needs the scope sentences at inference**: bare 80.7 = v3; with consolidation defs 86.3 (+5.6; v3 gained only +2.8). v4 was trained to read definitions, so without them it has nothing to read. New-category default: consolidation scope sentences ALWAYS in the coder prompt (they exist for every brand by construction). Bare list is obsolete.
5. **The unseen-brand residual is per-code, and it is the gate's job.** Netflix-with-defs mean incidence gap 1.6pts, but 5 codes off >3pts - plan tiers 30.1% truth vs 18.0% (every model undercalls it; its scope moved +554 rows in the v4 relabel, a Netflix-specific breadth no model can infer). Gate metric: per-code incidence gap on the ~300-row calibration sample, flagging codes off >3pts - those are where a brand needs calibration labels or a scope-sentence edit before its dashboard ships.
6. Judgment fields flat across v2/v3/v4 within noise (jira framing 92.3 / 91.1 / 92.2; Netflix outcome 88.7 / 88.1 / 88.5). Denser reason targets neither help nor hurt judgment.

New-category gate expectations under v4 + scope sentences: outcome ~88, framing ~91, top_pick ~89-90, reason F1 ~86 vs same-contract labels, mean per-code incidence gap ~1.5-2pts with a handful of brand-specific codes needing calibration. Open for Tyler: production coder decision (v4 candidate) and prod flip; the prod coder prompt must carry the scope sentences (providers.ts + Fireworks provider integration); mentions path (v3/v4 labels carry no mentions field - the v4 coder cannot replace the mentions pass as trained); taxonomy adds for the post-scope residue (AmEx consumer credit-score impact / retention offers, Netflix home bandwidth, etc.); solo-vs-consensus; whether plan-tiers-style breadth gaps get fixed by scope-sentence edits or calibration labels.

## Grok baseline with scope sentences (2026-09-25, Tyler's go): v4 wins every segment on every metric

The PROD coder path (extractCodingConsensus, EXTRACT_SOLO=grok-4-fast, decompose2) over the same held-out segments, with the confirmed code list AND scope sentences via the new optional `reasonDefinitions` coder context (providers.ts, commit eb5edae - inert when absent, and the prerequisite for any coder flip). Runner `scripts/grok_scope_eval.mts`: answers from vault, DATABASE_URL stripped so the ledger logger falls back to a scratch SQLite (nothing to prod), target framing derived from the target's mention framing as prod does. **Spend $13.88** (AmEx 0.83, jira 2.10, Pixel 0.86, Netflix 10.09 - ~$2.8/1K answers, 70% of it the pipeline's Haiku call). Outputs `finetune/v3eval/grok_*_defs.jsonl`.

vs v4 truth, grok -> v4 (outcome / framing / top_pick / reason F1; per-code incidence gap):
- jira 639: 78.1 -> 93.6 / 78.1 -> 92.2 / 87.0 -> 95.3 / F1 50.2 -> 84.6; gap 4.2 -> 0.6 pts (21 -> 0 codes off >3)
- AmEx 300: 68.7 -> 87.7 / 72.0 -> 92.0 / 84.0 -> 93.0 / F1 68.6 -> 93.3; gap 4.0 -> 0.6 (16 -> 0)
- Pixel 300: 75.3 -> 91.7 / 83.0 -> 93.0 / 86.0 -> 91.7 / F1 59.5 -> 92.9; gap 5.1 -> 0.8 (20 -> 0)
- Netflix 3,610 (unseen by v4): 68.3 -> 88.2 / 84.9 -> 90.7 / 78.1 -> 89.6 / F1 65.7 -> 86.3; gap 3.9 -> 1.6 (13 -> 5)

Findings: (1) grok's judgment was tuned on jira and does not transfer - outcome 78 on jira but 68-75 on the other three brands; v4 holds 88-94 everywhere including the brand it never saw. (2) Grok under-codes reasons (2.5-3.2 codes/row vs truth ~4) and ignores most scope: scope-pair recall 13-37% even with the sentences in its prompt (v4 61-88%). (3) On dashboard accuracy grok leaves 13-21 codes per brand off by >3pts; v4 leaves 0 on trained brands and 5 on unseen Netflix. (4) Cost: grok pipeline ~$2.8/1K answers vs v4 ~$0.6/1K GPU time + ~$3 spin-up per batch (plus a mentions pass for v4, ~$0.3/1K).

## Eval convention + escalation routing test (2026-09-25)

- **Tyler's directive: Netflix (the unseen-brand segment) is evaluated WITH scope sentences from now on** - `netflix_defs` is the standard arm; the bare-list arm is retired from reporting (it only existed to test the old bare-list inference default, which v4 made obsolete).
- Escalation routing, measured free from existing outputs: flag rows where v4 and the prod grok coder disagree on outcome. Flags 20% jira / 29% AmEx / 24% Pixel / 32% Netflix of rows and catches 41% / 43% / 52% / 58% of v4's outcome errors; v4 on the unflagged rest is 95.3 / 90.1 / 94.7 / 92.7. If flagged rows were re-coded by Opus (the labeler v4 imitates) the ceiling gain is roughly +2.7 / +5.3 / +4.3 / +6.8 outcome pts - an upper bound, since truth IS Opus-5 judgment. Cost ~ grok on every row (~$2.8/1K) + Opus on the flagged ~25-30% (~$2/1K). Cheaper detectors on v4 itself (outcome-token logprob margin, sampled self-consistency) are untested. v4-with-defs vs v4-bare disagreement is a weak detector (2% flagged, 11% of errors).

## Definition contract - v5 test only, NOT in prod (2026-09-25)

The scope sentences are now load-bearing (labeler, training, inference all read them), but consolidation only ever asked Opus for a "one-line rationale" - the scope style was luck. Tyler's call: make the ask explicit, test it in v5, keep prod (`src/lib/engine/consolidate.ts`) unchanged.
- `labeling/definitions_prompt.py`: DEFINITION_RULE (one line stating what the code COVERS, in its member clusters' own terms; never a rationale; nothing no member mentions) + `check_definition` (fails empty / multi-line / >240 chars / rationale language / names none of its member phrases). The current v4 sheets pass 139/139, so the contract formalizes what worked rather than changing it.
- `labeling/consolidate_embed.py --defs-v2 [--no-ledger]`: consolidation asks for "definition" under the rule and contract-checks each (future brands). Default behavior unchanged.
- `labeling/define_codes.py <brand> [--model --effort] [--check-only]`: v5 path for the four CONFIRMED lists - codes fixed (re-consolidating would re-decide codes and void the gate), Opus rewrites only definitions from each code's member phrases ranked by census count; output `labeling/v5_defs/`, usage recorded locally, no ledger write.
- Consolidation cost, from the ledger (2026-09-22, claude-opus-5 effort medium, one call per brand): jira 51.3K in / 49.3K out = $1.19; AmEx $0.88; Netflix $0.83; Pixel $0.91 (+~$0.01 embeddings). Output (mostly thinking) is ~90% of cost. The "$0.50" figure recorded earlier was low.
- **v5 definitions generated (2026-09-25, Tyler's go, step 1):** `define_codes.py` on all four confirmed lists, claude-opus-5 effort medium (same model/effort as the original consolidation - only the prompt changed). 139/139 pass the contract, ~$0.25 (+~$0.25 for a first round the strict name check refused: the prompt's "code - members" layout made Opus echo "annual fee - members" as keys on two brands - fixed by quoting code names; v4 unaffected, verified its sheets and prompts carry exact names). Checker fix: rationale words that are also member vocabulary (jira "tool consolidation") no longer flag. v5 lines are ~2x longer (jira 84 -> 167 chars, Netflix 75 -> 165) and track member phrases more exhaustively - e.g. Netflix plan tiers now names "ad vs premium tiers ... pricing" (the code every model undercalls), but some lines pick up debatable tail members (jira vendor support gains "trial duration", process fit gains "acceptance criteria"). Review files `labeling/v5_defs/defs_v5_<brand>_claude-opus-5_medium.report.md` (v4 vs v5 per code). Next (needs go): v5 relabel ~$142 -> train -> eval.

## v4b set up (2026-09-26, Tyler's go): the v4 recipe on a ~9B base

Question: does a small base hold v4's accuracy? Fireworks serves fine-tunes ONLY on dedicated deployments (docs: "the only supported method for serving trained models"), so a small base does not become serverless - the savings are a 1x H100 deployment ($8/hr vs 2x H100 $16/hr, likely 2-3x faster per GPU: ~$2-3 vs ~$6-7 per 5K-answer run) and, mainly, retraining: SFT is $0.50/M training tokens up to 16B vs $3.00/M for 16-80B, so a v4-sized run (~29M tokens x 2 epochs) is ~$30 vs ~$175.
- Base: `qwen3p5-9b` (9.4B). Catalog check: llama-v3p1-8b-instruct (deprecated 2025-11-26) and qwen3-8b (deprecated 2026-05-14) are past deprecation; qwen3-vl-8b-instruct carries an unused vision tower; qwen3p5-9b is current, text-only, supervised-LoRA-tunable, in the <=16B price tier.
- `finetune/fireworks_launch_v4b.sh` (hand-run): reuses the uploaded v4 datasets procerno-coder-multi-v4 / -v4-val (13,491 / 300 - no new data), v4 hyperparameters, output `procerno-coder-v4b`. Only the base changes.
- Eval: `BASE=qwen3p5-9b GPUS=1 DEP=<new id> ./deploy_eval_v3.sh create`, bind procerno-coder-v4b, `run_v3eval.sh v4b` (v4's definition sheets, DEFS_VER default), score with `TRUTH=v4`. The runner strips Qwen `<think>` blocks before JSON parsing.

## Netflix warm-start test set up (2026-09-26, Tyler's go): v4-warm10 / v4-warm20

Tests the paid-calibration idea (label 5-20% of a new tracker, tune the prod coder on it): warm-start procerno-coder-v4 (`--warm-start-from`, no full retrain) on a Netflix slice + equal replay rows from train_v4 (anti-forgetting). Labels = existing v4 truth; no new labeling.
- `finetune/build_warm_netflix.py` -> `finetune/warm/`: split by QUESTION (Netflix = 470 questions x 8 engines, seed 20260926), nested - warm10 = 47 questions / 376 answers (+376 replay), warm20 = 94 questions / 752 answers (+752 replay, contains warm10). Eval = 2,882 heldout_3610 answers to the 376 questions neither set trains on (`warm/netflix_warm_eval_ids.txt`; zero question overlap verified).
- `finetune/fireworks_launch_v4warm.sh` (hand-run): uploads both sets, two warm-start sftj from procerno-coder-v4 (epochs 2, lr 1e-4 cosine, warmup 20, 8192 ctx; LoRA shape inherited) -> `procerno-coder-v4-warm10` / `-warm20`. Est. training ~$9 / ~$19 (3.1M / 6.3M tokens at the 30B $3/M tier).
- Eval: 30B deployment (2x H100), bind both, `DEP=<id> ./run_warm.sh v4-warm10` (Netflix scope-sentence arm on the eval subset + jira/AmEx/Pixel segments for forgetting); score `TRUTH=v4 NETFLIX_IDS=../finetune/warm/netflix_warm_eval_ids.txt python3 score_v3.py`.
- Baseline on the eval subset (existing outputs, re-scored): v4 88.1 / 90.9 / 89.2, reason F1 86.2 (full 3,610: 88.2 / 90.7 / 89.6 / 86.3 - subset is representative); v3 83.3 F1; grok 65.4 F1.

## v5 relabel complete (2026-09-26): contract definitions redistribute boundaries, they don't close gaps

All four brands relabeled with the v5 contract definitions (claude-opus-5-5, high, Batch API; `labeling/v5_relabel/`), **$144.44**, all validate, zero failures. jira's batch sat in Anthropic's queue ~2h (vs ~10 min for the others) - no errors, just latency. `finetune/build_train_v5.py` -> train_v5 (13,491 / 300, v4's partition; training prompts carry the v5 definitions; longest ~6.3K tokens). `fireworks_launch_v5.sh` ready (hand-run).

v4 -> v5 labels: uncoded share unchanged (jira 3.4 -> 4.4%, AmEx 7.5 -> 7.4, Netflix 11.2 -> 10.5, Pixel 4.5 -> 5.8), density flat, row Jaccard 0.70 / 0.84 / 0.78 / 0.82. The longer definitions did not recover residue; they moved boundaries between overlapping codes: Netflix plan tiers 30% -> 8% (video quality 24 -> 30% now claims "whether 4K requires a specific tier", monthly price claims "price points and tiers" - 851 of 865 lost rows still coded elsewhere), catalog rotation 16 -> 11%; jira reporting analytics 21 -> 13%, attachments storage 6 -> 12%; Pixel total cost financing 17 -> 10%. Lesson: an exhaustive per-code definition written in isolation creates overlaps with its neighbors; the definition contract needs a cross-code overlap check (a term claimed by two definitions), not just per-code checks. A single code's dashboard share can swing 3x on definition wording - the confirmed definition IS the measurement.

Also 2026-09-26: firectl upgraded to 1.8.10 (Tyler); all finetune launch scripts moved to the noun-first syntax (`firectl sftj create`, `firectl dataset create`, ...). Warm-start launcher needed explicit `--lora-rank 16 --lora-alpha 32` (firectl defaults warm starts to rank 8 and rejects the mismatch). First warm launch (f2w5y9kh / wf7y8z40) cancelled by Tyler at 0%; relaunch pending. Eval chains `chain_v4b_eval.sh` / `chain_warm_eval.sh` deploy, evaluate, tear down (trap) and score automatically.

## v4b scored (2026-09-26): the 9B base holds v4's accuracy on trained brands, ~1pt behind on the unseen brand

procerno-coder-v4b (sftj fsbxx0o1, qwen3p5-9b, v4's exact data/hyperparameters) on 1x H100 (procerno-v4beval, torn down, DELETED verified), same matrix as v4, vs v4 truth. Outputs `finetune/v3eval/v4b_*`, table `finetune/v4b_scores_v4truth.md`.

| segment | v4 outcome / framing / top_pick / F1 | v4b outcome / framing / top_pick / F1 | per-code gap v4 -> v4b |
| --- | --- | --- | --- |
| jira 639 | 93.6 / 92.2 / 95.3 / 84.6 | 92.8 / 91.7 / 93.9 / 84.7 | 0.6 -> 0.6 (0 codes >3) |
| AmEx 300 | 87.7 / 92.0 / 93.0 / 93.3 | 86.7 / 92.0 / 92.0 / 93.0 | 0.6 -> 0.6 (0) |
| Pixel 300 | 91.7 / 93.0 / 91.7 / 92.9 | 92.7 / 95.3 / 92.0 / 92.8 | 0.8 -> 0.6 (0) |
| Netflix 3,610 scope defs | 88.2 / 90.7 / 89.6 / 86.3 | 87.1 / 91.0 / 88.5 / 85.0 | 1.6 -> 1.9 (5 -> 6 codes >3) |

Read: on trained brands the 9B is indistinguishable from the 30B (every difference inside n=300/639 noise; reason F1 within 0.3). On the unseen brand it gives up ~1pt outcome / top_pick and 1.3 F1 at n=3,610 - small but real. Economics: eval ran 4,849 answers in ~7 min on ONE H100 (~43K answers/hr at concurrency 24 vs the 30B's ~26K/hr on two) -> ~$0.19/1K answers vs ~$0.60, and retrains ~$30 vs ~$175. Ops lessons (fixed): (1) Qwen3.5 bases THINK by default even when fine-tuned on bare JSON - every eval answer burned the 400-token budget in reasoning_content; send `reasoning_effort: "none"` (ft_eval_v3.mts REASONING=none) - any prod integration of a Qwen coder must do the same. (2) DEPLOYED status can precede routability (636 model_not_found 404s) - chains now `deploy_eval_v3.sh probe <model>` before evaluating. (3) One teardown call left the deployment READY and billing ~40 min (~$5) while reporting success - teardown now retries until DELETING/DELETED is confirmed.

## Round 3 set up (2026-09-26, Tyler's go): v5b + warm starts on both bases

- **v5b** - v5 data (contract definitions in labels AND training prompts) on qwen3p5-9b, v4 hyperparameters (`fireworks_launch_v5b.sh`, uploads train_v5/val_v5). Compare to v4b (same base, v4 data) to isolate the definitions. Eval `chain_v5b_eval.sh`: DEFS_VER=v5, thinking off, scored vs v5 truth and v4 truth.
- **v4-warm10/20** - v4 (30B) warm-started on the Netflix slices (`fireworks_launch_v4warm.sh`; the first launch was cancelled at 0%).
- **v4b-warm10/20** - v4b (9B) warm-started on the same slices + replay (`fireworks_launch_v4bwarm.sh`, reuses the uploaded warm datasets, rank 16/alpha 32).
- One command for all five: `fireworks_launch_round3.sh` (hand-run). Est. ~$30 + ~$28 + ~$5.
- Eval chains (armed; each waits for its jobs, discovers ids by output model, deploys, probes routability, evaluates, verified teardown, scores): `FAMILY=v4 chain_warm_eval.sh` (30B, 2x H100), `FAMILY=v4b chain_warm_eval.sh` (9B, 1x H100, REASONING=none), `chain_v5b_eval.sh`. Chains run locally - the Mac must stay awake or deployments idle-bill until it wakes.

## v4b-warm scored (2026-09-26): a 10% calibration sample closes the unseen-brand gap

v4b warm-started on Netflix 10% / 20% (+ equal replay), 1x H100 eval, thinking off. Netflix = 2,882 answers to questions no warm model trained on; other brands = standard segments (forgetting check). Table `finetune/warm/warm_scores_v4b_v4truth.md`.

| model | Netflix outcome / framing / top_pick | Netflix reason F1 | exact set | per-code gap | codes off >3 | plan tiers (truth 30.3%) |
| --- | --- | --- | --- | --- | --- | --- |
| v4 (30B, no warm) | 88.1 / 90.9 / 89.2 | 86.2 | 32.4 | 1.7 | 5 | 18.9% |
| v4b (9B, no warm) | 87.0 / 91.3 / 88.4 | 84.9 | 28.8 | 1.9 | 6 | 20.6% |
| v4b-warm10 | 86.7 / 91.6 / 88.1 | **87.5** | 37.0 | **0.7** | **0** | 27.3% |
| v4b-warm20 | 87.8 / 91.4 / 89.2 | **88.2** | 38.1 | **0.6** | **0** | 29.6% |

Findings: (1) **A 376-answer (10%) Netflix sample brings the new brand to trained-brand dashboard accuracy** - per-code gap 1.9 -> 0.7 pts, codes off >3pts 6 -> 0, reason F1 +2.6 (the 9B now beats the un-calibrated 30B). 20% adds a little more (F1 +0.7, plan tiers 27.3 -> 29.6%). The brand-specific breadth no model could infer (plan tiers) is learned from the sample. (2) Judgment fields don't move with calibration (Netflix outcome 87.0 / 86.7 / 87.8) - the sample fixes reasons, not the pick/conditional boundary. (3) Forgetting is small: trained-brand reason F1 -0.3 to -0.7; outcome on AmEx warm20 84.0 vs 86.7 and Pixel -1 to -2 (inside n=300 noise, but it trends down with more new-brand data - watch it; more replay is the lever). Cost: v4b-warm10 trained for ~$2. This is the empirical case for the paid 5-10% calibration tier.
Ops: the warm chain's teardown trap used a relative path and the scoring step cd'd away - procerno-v4bwarmeval stayed READY a few minutes until torn down by hand. chain_v5b_eval.sh fixed (absolute path); chain_warm_eval.sh to be fixed once the running v4-warm chain exits (a guard tears its deployment down on exit).
