# Coding decisions

Decisions only: what the coding standard is, who decided, when, why, and where the evidence lives. Experiment detail stays in AGENTS.md; this file is the contract. Read it before any labeling, codebook or coder work, and record every new decision here (date, decision, reason, evidence). Evidence paths are under `~/Documents/procerno_eval/` unless noted.

Status tags: **DECIDED** (in force), **PROPOSED** (recommended, awaiting Tyler), **OPEN** (undecided), **SUPERSEDED**.

---

## 1. Current standard at a glance

| Layer | Standard | Status |
| --- | --- | --- |
| Production coder | procerno_reason_coder v0.1 = the v4b process (qwen3p5-9b LoRA, v4 labels) | DECIDED 2026-09-26 (not yet in prod) |
| Next coder | v0.2: same recipe, every field prod reads, trained on v0.2 labels | DECIDED 2026-09-26 (in progress) |
| Reference labeler | claude-opus-5-5, effort high, ONE answer per request | DECIDED 2026-09-27 |
| Labeling prompt | `labeling/build_batch.mts --mode v02_full --defs --design`, no precedents | DECIDED 2026-09-27 (gaps B2-B6 open) |
| Codebook | gate-confirmed code list + confirmed scope sentence per code (v4 contract) | DECIDED 2026-09-25 |
| Brand resolution | the confirmed dictionary is fed to the labeler (and the coder); each mention carries its dictionary entry; post-hoc resolution stays as a safety net | DECIDED 2026-09-27 (test pending) |

---

## 2. Ground truth

- **Provenance (fact, corrected 2026-09-21 and 2026-09-27).** No human-coded truth exists. The codebook and the 339 anchor labels (`jira/precedents_339.jsonl`) were written by Claude Fable 5 subagents in a Fable 5 session (2026-09-19); Tyler reviewed ~20. Claude Opus 5 subagents then labeled all 18,790 answers of jira / AmEx / Netflix / Pixel in-session (2026-09-20), ~88 answers per agent, told to follow the 339 wherever their judgment conflicted. Where a test answer was itself one of the 339, Opus copied Fable's label - the "100% agreement" with the reference set is copying, not independent confirmation. Never call these human labels.
- **Opus is the reference labeler (DECIDED 2026-09-20, Tyler).** Chosen to scale Fable's codebook to full sets (full ground truth, a second reference, training-scale labels) - not picked in a bakeoff. Grok 4 at full reasoning would cost about the same and was never measured; Grok 4 Fast is ~15x cheaper but scores outcome 68-79% against Opus, so it is not a truth candidate.
- **Division of labor (DECIDED 2026-09-22):** grok for discovery coding (open coding, brands pass); Opus for ratified-truth labels.
- **Run-to-run ceiling (measured 2026-09-27):** Opus 5.5 labeling the same answers twice agrees outcome 95%, top pick 92%, framing 98%, reasons Jaccard 0.83, brands Jaccard 0.90 (`labeling/v02_relabel/batching_test/`). Read every labeler-agreement number against it.
- **One answer per request (DECIDED 2026-09-27).** Batching 20 per request made labels less decisive (12 vs 7 one-sided changes), reasoned ~12% less and silently dropped 3 of 200 answers. The old labels' in-session batching explains ~5 points of their gap to new labels. On the API batching saves only ~2% (the codebook is cached). In-session labeling is fine when it is one answer per agent call (AmEx 500-answer test matched the API at the rerun baseline).
- **Precedents excluded from v0.2 (DECIDED 2026-09-27, Tyler).** Adding the 339 (judgment-only) moved Opus 5.5 labels 5-6 points toward the old labels - circular, since the old labels were made with them. Tyler's blind review of the 30 disagreements: plain v0.2 right 9, precedents right 6, both 15; outcome disagreements 9-5 for plain v0.2 (`source_test/blind_votes.json`, artifact claude.ai/artifact/RyUZnCuaKKoBVX7zjJi6vv).
- **One labeling standard per coder version (DECIDED 2026-09-27).** Every label in a version's training data comes from the same labeler, prompt and settings, with provenance recorded; a changed standard means relabeling, not mixing (a directional labeler shift baked into training shows up as fake trends). A fixed, ideally human-reviewed anchor set should vet any new labeler before it labels.

## 3. Codebook contract

- **Reasons are brand-agnostic (DECIDED 2026-09-21, Tyler).** Code the argument whichever product it favors; target framing alone carries the brand-specific read. The dashboard must answer "what arguments do we lose to".
- **The taxonomy is discovered, never guessed (DECIDED 2026-09-22).** Discovery runs taxonomy-free on grok, embeddings-first consolidation proposes codes, the customer confirms at the gate. `getReasonTaxonomy` deleted.
- **Scope sentences travel with the code everywhere (DECIDED 2026-09-25).** The confirmed one-line definition goes into the labeler prompt, the training prompts and inference. Names alone under-specify the contract: the v3 relabel filed covered arguments as uncoded and the coder learned its keys, not its definitions; v4 labels with definitions fixed it. Unseen brands need the sentences at inference (~5 reason F1).
- **v4 definitions stay; v5 contract definitions rejected (DECIDED 2026-09-26).** v5's longer per-code definitions created cross-code overlaps (Netflix plan tiers 30% -> 8%) without shrinking the uncoded residue, and were no easier to learn (v5b). A definition checker must add a cross-code overlap check before it is used for real.
- **uncoded_reason** is a discovery valve only: reasons stay strictly on the confirmed list.
- **Taxonomy adds for the post-scope residue** (AmEx consumer credit-score impact, retention offers; Netflix home bandwidth; etc.): OPEN, Tyler's call. Any codebook change forces a reasons relabel.

## 4. Judgment rules (the codebook's judgment half)

- **Outcome (O-TEST):** could a reader who saw only this answer act now and buy one named product without first classifying themselves? yes -> pick; must self-classify -> conditional; declines to advise with no product direction -> clarification (rare); informs or lays out options while championing none, or recommends only actions -> no_pick.
- **Stated defaults (O-DEFAULT):** a default with exceptions or caveats after it is a pick and its default is the top pick; a #1 in an advice-ranking for the reader's scenario is a default; keep or renew what you have = pick. Two finalists as equals, branches with no default, shortlists to pilot -> conditional. Trailing questions and offers change nothing.
- **Framing by direction, not enthusiasm (F1-F6):** recommended only when the answer points this reader toward the brand (pick, default, best-for, top of an advice-ranking, strong-verb branch, keep/renew); praise without direction, market superlatives, weak-verb hedges and reported opinions are mentioned; negative when the answer itself criticizes or a caveat disqualifies the brand for this reader - a caveat inside a standing endorsement does not flip it.
- **Out-of-category picks:** OPEN (B5). The pick test does not say the product must be in the tracker's category (AmEx ecosystem answers "pick Expensify").

## 5. v0.2 fields

- **Scope (DECIDED 2026-09-26, Tyler):** v0.2 labels and learns every field prod reads, so it can replace the grok pipeline and the separate Haiku focus call. Old answers AND the GPT-5.6 answers are relabeled clean under one standard (set A = existing answers, set B = GPT-5.6 answers); the old gpt-5-mini / gpt-5 answers stay in training.
- **The 7 added fields** use prod's own wording (providers.ts): mentions with per-brand framing (every proper-noun brand, product not its parts, as written), clarification_requested, gives_recommendation, includes_prices, includes_specs, focus_quote, focus_interpretation.
- **Doubt verdict (DECIDED 2026-09-27, Tyler).** Why: an objection answer can confirm the weakness ("yes, Jira can and often does slow badly") while its advice keeps the brand (pick / recommended); nothing recorded that the AI agreed with the criticism. premise_verdict = confirms | rebuts | mixed | n/a, plus premise_quote. "Confirms" = the answer tells the buyer the concern is warranted, even with conditions, fixes, or while still recommending the brand. About a third of confirmations still recommend the brand.
  - **The doubt comes from the cell, not the labeler (DECIDED).** `labeling/v02_relabel/question_designs.json`: doubt stages (objections, churn_triggers, renewal, problem_resolution, premium_worth) plus advocacy prompts that quote a critic; the design line is prepended to the request; everything else is n/a by construction. Self-detection inferred premises the question never stated.
  - **Per-question design check (DECIDED):** prompts that do not voice their cell's design (21 of 410, mostly jira's "Jira Cloud trial" cell) get no design line.
  - **Loyalty "plan" verdict dropped (DECIDED):** backs 16/16 - the question presupposes the brand, so it never varied. Loyalty signal comes from existing fields (first-party vs third-party companions via the dictionary, rival leakage, reason codes in advocacy, the doubt verdict on advocacy prompts that quote a critic).
- **Off-design prompts' answers are left out of the v0.2 relabel (DECIDED 2026-09-27, Tyler).** `labeling/v02_relabel/off_design_prompts.json`; rewrite them before the next collection.
- **Known field gaps (OPEN, from the AmEx labels 2026-09-27):**
  - B2 - **DECIDED 2026-09-27 (Tyler), pending an isolated test:** a brand framed two ways in one answer (384 of 4,868 AmEx answers list AmEx more than once with different framings, e.g. Gold recommended, Platinum criticized). The single brand-level framing is replaced by two signals: **recommended** (any of the brand's products recommended) and **criticized** (any warned against); both can be true. Rejected: negative wins (prod's old merge rule - an answer that picks an AmEx card would read negative for AmEx), recommended wins (hides product criticism), a single brand-level framing with per-product detail (still needs one of those rules). Schema change: target_framing becomes two booleans at brand level; per-brand framing in the mentions list stays; the dashboard funnel shows recommended rate and criticized rate, which can overlap. For comparisons with v0.1, a single framing can be derived from the two signals. **Isolated test (flagged, NOT RUN):** only this change, on the 200-answer set (~$5): the signals match the mentions' per-brand framings; run-to-run stability is at least today's 98%; no other field moves beyond the rerun baseline; the both-true share is hand-checked. Run separately from the B1 dictionary test.
  - B3 - clarification_requested fires on trailing offers ("Want me to compare...?"): true on 52% of answers. Proposal: count only questions asking for information the answer needs.
  - B4 - includes_prices / includes_specs were written for B2B software; on credit cards they are 74% / 82% true. Needs per-category definitions or acceptance as broad "has numbers" flags.
  - B5 - out-of-category picks (see section 4).
  - B7 - per-brand role in the mentions list (added 2026-09-27, Tyler). Outcome is answer-level and the only per-brand judgment is framing, so in conditional answers (40% of AmEx) a branch winner ("Jira if you're enterprise, Linear if you're a startup") and one entry on a five-product shortlist are both just "recommended". Proposal: one extra value per mention - chosen (the top pick) | branch_winner | shortlisted | mentioned | warned_against. Separates winning a scenario from being listed, and shows both roles when a brand's products are chosen and warned against in the same answer (bears on B2). Prompt change, so it goes in with B2-B4 before the freeze.
  - B6 - wording: "absent" should say "never named in the answer"; how to choose the focus sentence; top pick should be written as the mentions list writes it.

## 6. Brand identity and resolution

- **The target includes its products (boundaries DECIDED 2026-09-27, Tyler).** Picking, recommending or criticizing a product the brand sells for the job the study covers counts for the brand. AmEx: its cards, including co-branded cards AmEx issues (Delta SkyMiles, Hilton Honors) - not programs (Membership Rewards), partner brands, or the networks. jira: its editions and same-job products (Jira Software, Service Management, Work Management, Align, Cloud / Data Center) - not Confluence, Bitbucket, Trello or Marketplace apps. Netflix: its plans - not content or devices. Google Pixel: Pixel phone models - not Pixel Watch, Buds, Nest or Android. Matches the dictionary's product_of vs affiliated split.
- **Feed the confirmed dictionary into the prompt (DECIDED 2026-09-27, Tyler; supersedes the "repair only" proposal).** On an init run coding starts only after the gate, so the confirmed dictionary always exists at coding time. Every request (labeler now, coder in prod) carries the tracker's confirmed dictionary: each active entry with its aliases, the target entry marked. Why the whole dictionary, not just the target: every brand's products roll up (Chase Sapphire -> Chase), the conflicting-framing rule applies per brand, and top picks come out as known entries. It also closes the one gap the repair could not: answers naming only the target's products got no focus quote (2.8% of AmEx).
  - **Each mention records both** the name exactly as written and its dictionary entry (null when none). Resolution stays reversible and product-level drill-down stays possible.
  - **New brands are expected:** names not in the dictionary are listed as written with no entry; never force a name into an entry it does not belong to. (A shown list acts as a gravity well - the seeded codebook suppressed discovery the same way.)
  - **Boundaries come from the confirmed board's relationships** (forms and products of a brand roll up; affiliated brands do not), so Tyler's calls above apply automatically.
  - **Post-hoc dictionary resolution stays** as a safety net for unusual spellings and for labels made before this change.
  - **Test before freezing (NOT RUN - Tyler: record, don't run yet):** the 200-answer test set with and without the dictionary in the prompt, Batch API, ~$5 per arm. Pass criteria: new-brand (not-in-dictionary) detection does not drop; labeler entries agree with dictionary resolution; outcome / top pick stay at the rerun baseline.
  - Consequence: this is a prompt change, so it goes in with B2-B4 before the prompt is frozen; the 4,868 AmEx labels made without it are relabeled under the frozen prompt.
- **Mention order is computed, not trusted to the model (DECIDED 2026-09-27, Tyler).** The prompt asks for brands "in order of first appearance", but on 4,241 AmEx labels with 2+ locatable brands only 74% came back in that order (26% flagged by a crude substring check, inflated by nested names like "Chase" inside "Chase Sapphire Reserve"; the true rate is lower but not zero). Order feeds position / share-of-voice metrics, so it becomes a deterministic fact about the text: after labeling (and in prod, after the coder returns its mentions) sort mentions by each name's first standalone, word-bounded occurrence in the answer, reusing prod's word-boundary matcher (mention_filter.ts). The prompt keeps the order instruction as a hint; the stored order is the computed one. Nested names resolve to their first standalone occurrence (build detail to confirm). Post-processing only - no prompt change, no relabel.
- **Dictionary admission and relationships** (decided 2026-09-22 to 09-24, see AGENTS.md): real offerings + string variants + measured-referential satellites; merges carry a relationship (same_offering | product_of | affiliated | content_of); product forms always merge; the target entry can never be rejected or merged away (server-enforced).

## 7. The coder

- **procerno_reason_coder v0.1 (DECIDED 2026-09-26, Tyler):** Fireworks `procerno-coder-v4b` (sftj fsbxx0o1). qwen3p5-9b, LoRA rank 16 / alpha 32, 2 epochs, lr 1e-4 cosine, warmup 20, 8,192 context; data `finetune/train_v4.jsonl` (jira + AmEx + Pixel; Netflix held out). The 9B matched the 30B on trained brands and cost ~a third to serve and ~a sixth to retrain.
- **Inference contract (DECIDED):** prompt layout exactly as training (`finetune/ft_eval_v3.mts`), scope sentences always sent, temperature 0, `reasoning_effort: "none"` (Qwen thinks by default), dedicated 1x H100 deployment, routability probe before use, verified teardown.
- **v0.1 limits (known):** outputs only outcome / top pick / target framing / reasons - no mentions, flags, focus or doubt verdict; not in prod; never seen GPT-5.6 answers; 3 categories trained.
- **Calibration option (DECIDED as an offering, not default):** warm-start on ~10% of a new tracker's answers labeled by the reference labeler (+ equal replay) brings the new category to trained-category reason accuracy (Netflix F1 84.9 -> 87.5, 0 codes off >3 pts) for ~$2 of training. Rebuild calibrations on every base upgrade; never stack warm starts.
- **v0.2 training (DECIDED direction):** v0.2 labels (dictionary-repaired), inputs carry scope sentences and the doubt design line; retrain on the 9B base; gate = no field more than ~1 point behind v0.1 where both have it.

## 8. Evaluation conventions

- Netflix is the unseen-brand segment and is always evaluated WITH scope sentences (DECIDED 2026-09-25).
- Score each coder against labels of its own contract; cross-contract scores measure the contract difference, not the coder.
- Dashboard accuracy = per-code incidence gap; flag codes off by >3 points.
- Score top pick on dictionary-resolved brands, not raw strings (12 of 13 top-pick disagreements in the blind review were naming).
- Report agreement against the Opus rerun ceiling (95% outcome).

## 9. Open decisions (for Tyler)

The working checklist with options, recommendations and costs is `V02_OPEN_DECISIONS.md` (A = cells and prompts, B = prompt freeze, C = labels).

1. B2 - decided (two signals: recommended + criticized); go for its isolated test (~$5).
2. B3 - clarification_requested: information requests only?
3. B4 - price and spec flags: per-category definitions or accept as broad.
4. B5 - do out-of-category picks count as picks?
5. Go for the dictionary-in-prompt test (~$10, two arms on the 200-answer set).
6. Reporting of objection-stage answers (defend / concede / redirect) as their own dashboard metric.
7. Taxonomy adds for the post-scope residue.
8. B7 - add a per-brand role (chosen / branch winner / shortlisted / mentioned / warned against) to the mentions list?
9. Labeling route for the rest of v0.2 (in-session plan allowance vs Batch API vs mix).
