# Fine-tuned judgment coder (Fireworks LoRA)

Prompted coders plateaued: grok-4-fast x decompose2 reaches 77.1% outcome
accuracy against the 5,720-row Opus reference set for jira, 79.0% with the
tiebreak variant. An error-overlap diagnostic showed the residual errors are
shared across every mid-tier prompted coder, so the next lever was training on
cases rather than rewording prompts.

Result: a LoRA adapter trained on jira alone reaches **93.1% outcome accuracy
on held-out jira** and **82.7% on American Express, a brand it never saw**.

Training data, reference labels and run outputs live outside the repo under
`~/Documents/procerno_eval/` and the response vault; only tooling and findings
are versioned here.

## The model

`accounts/tsolloway-ekhu67i4gj/models/procerno-coder-v1` - rank-16 LoRA
(alpha 32, all 7 target modules) on `accounts/fireworks/models/muse-glimmer-30b`.
2 epochs over 5,081 examples, 13.5M training tokens, cosine schedule, 20 warmup
steps, 8192 max context. Cost $40.59 at $3.00 per 1M training tokens; 58 minutes.

Base-model choice matters and is not the obvious one. `llama-v3p1-8b-instruct`
is past its deprecation date and returns an INTERNAL error; `qwen2p5-7b-instruct`
is tunable but absent from the serverless catalogue. muse-glimmer-30b is the
smallest model that is both serverless and `Supervised Lora Tunable`. It is
Apache 2.0 and public on HuggingFace, so the adapter plus base can be self-hosted
(vLLM loads PEFT adapters natively) if Fireworks ever deprecates it.

## Results

Held out from training. The 5,720-row eval set is 5,081 trained-on rows plus
300 val plus 339 ratified, so **the all-rows figure is ~89% memorisation and is
not comparable to a prompted coder** - `score_ft_jira.py` segments accordingly.

| segment | n | outcome | framing | top_pick | reasonP | reasonR |
|---|---|---|---|---|---|---|
| jira held out | 639 | 93.1% | 90.5% | 95.3% | 80.2% | 79.6% |
| jira ratified (hard) | 339 | 90.6% | 87.3% | 94.1% | 72.3% | 78.5% |
| AmEx transfer | 5,390 | 82.7% | 85.0% | 84.8% | 74.0% | 47.4% |
| grok decompose2 / +tiebreak | 5,720 | 77.1% / 79.0% | 80.0% | 86.5% | 43.9% | 64.3% |

Caveat on the ratified 339: those labels are byte-identical to the Opus labels
on the same rows, so they are **not** an independent human check. Every number
above measures agreement with Opus, not with verified truth.

The transfer result is the interesting one. Outcome, framing and top_pick are
brand-agnostic judgments and survive the jump to an unseen brand with unseen
vocabulary; only the reason field collapses. That mirrors the codebook itself,
which is brand-agnostic machinery (O-TEST, O-DEFAULT, framing-by-direction)
with a brand name slotted in, plus a per-client reason list.

Two AmEx failure modes, both calibration rather than knowledge:
- **Family collapse.** `rewards rate` fired 1,292 times against 131 true (8%
  precision); 89% of its false positives sat on rows whose truth used a more
  specific sibling (cash back 819, spending categories 498, points earning 263).
- **Truncation.** 1.34 codes emitted per row against 2.10 true, consistently one
  short at every complexity level, while correctly staying silent on rows that
  earn none.

## Negative result: model-authored code definitions make coding worse

The obvious fix is to define each reason code in the prompt. Do not do this
without validating it.

Adding definitions plus a count instruction to the AmEx prompt appeared to lift
reason F1 from 57.0 to 70.7 (`score_amex_prompt_variants.py`). **That result is
void**: the definitions were written after running the error analysis on the
same rows they were scored against. Two facts were fitted to the test set - the
measured density (2.10) and the one dominant confusion. `amex_code_defs_INVALID.json`
is retained only to reproduce that invalid run.

The honest test ran the generator blind: Opus read 60 uncoded jira answers plus
the bare code names, with no access to labels, and wrote 22 definitions
(`jira_defs_generated_INVALID.json`). Two Opus coders then coded the same 150
held-out jira rows, one with bare names and one with the definitions
(`score_defs_validation.py`):

| condition | precision | recall | F1 | exact-set |
|---|---|---|---|---|
| bare code names | 42.3% | 86.8% | 56.9 | 28.0% |
| generated definitions | 26.5% | 93.4% | **41.3** | 4.7% |

Definitions cost 15.6 F1 points. They **broadened** every code by enumerating
triggers ("per-seat rates, tier jumps, add-on billing..."), pushing emissions
from 404 to 694 against 197 true, and wrongly coding 66 of the 71 rows that
should earn nothing. The codebook's actual rule is the opposite - code only
where the answer argues FROM an attribute with a "because", and
"topic-presence alone earns none".

The deeper reason this cannot work: the convention that varies per study is a
threshold, not a boundary, and it appears nowhere in any document. Identical
codebook rules produce 1.22 codes/row on jira (48% of rows empty), 2.10 on
AmEx (16% empty), 1.60 on Netflix (35% empty). The coding instructions
themselves prescribe the alternative - calibrate on labeled precedents, and
"where your judgment and a precedent's pattern conflict, follow the precedent".

## Difficulty prediction

Answer length is useless (82.0/83.2/81.7/83.6% by quartile). Engine spreads only
9 points. The model's own predicted outcome is weakly informative and free:
predicted `pick` is right 74.3% of the time against 89.3% for `no_pick`, which
makes it a usable production routing signal for human review.

Coder disagreement is the strong signal and needs no labels: where the fine-tune
and grok agree the fine-tune is right 97.4% of the time, where they disagree
90.8%. **Disagreement covers 22% of rows but contains 50% of all errors**, and
carries boundary cases at 3x the rate. This is what the existing 339-row
reference set already does (297 `disagree` + 42 `audit`). Use it for precedent
selection, not for estimating density - hard-case sampling biases a mean.

## Operational notes

- `firectl` refuses every mutating command inside an AI agent, `--dry-run`
  included. Use the Fireworks REST API, or run `fireworks_launch.sh` by hand.
- A custom adapter must be addressed **deployment-scoped** at inference:
  `accounts/<acct>/models/<model>#accounts/<acct>/deployments/<dep>`. The bare
  model name returns 404 even when the deployedModel reports DEPLOYED and the
  catalogue lists it. This cost hours; serverless binding may well work with
  the right identifier.
- muse-glimmer-30b requires a minimum of 2 accelerators per replica.
- Poll a real inference call for HTTP 200, not the resource state.
- Deployment deletion needs `?ignoreChecks=true` after the deployment has served
  traffic, and can wedge: `procerno-eval` and `procerno-eval2` sat in DELETING
  for hours with their bindings stuck in UNDEPLOYING, holding quota (not billed).
- Training usage is billed per token; the dedicated deployments recorded no
  usage at all. Check with
  `firectl billing get-usage --start-time <d> --end-time <d> --usage-type all`.
- Fireworks exposes no training or validation loss curve - the metrics file is a
  token-rendering dump. Overfitting has to be inferred after the fact from the
  trained-on/held-out gap (96.2% vs 93.1%, i.e. mild).

## Next

Untested: whether multi-brand training closes the reason gap, and whether a
small random calibration sample can supply measured prompt parameters
(density plus top confusion) honestly. Both need a quarantined brand - design on
jira and AmEx, measure once on Netflix or Pixel, and never let the prompt author
see the test set's errors first.
