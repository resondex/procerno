# v0.2 coder - decisions needed (A, B, C)

Updated 2026-09-27. The full record of what is already decided lives in `CODING_DECISIONS.md` in the repo.

Critical path: **B** (freeze the labeling prompt) -> **C** (labels) -> train and evaluate -> prod switch. **A** does not block the coder.

---

## A. Cells and prompts (does not block the coder)

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| A1 | Rewrite the 21 off-design prompts (10 are jira's "Jira Cloud trial" objection cell) | Auto-rewrite with the prompt linter, then you review / rewrite by hand / leave them | Auto-rewrite and review, before each affected tracker's next collection. Their existing answers are already left out of the relabel. |
| A2 | Add a design-fidelity check to setup prompt linting (does each paraphrase still voice its cell's design?) | Build now / build before the next new tracker / skip | Build before the next new tracker (~$0.005 per prompt). Already on the to-do list. |

---

## B. Freeze the labeling prompt (blocks C)

Every item marked "prompt change" must be settled before the freeze. Once the prompt is frozen, the 4,868 AmEx labels made so far are relabeled under it.

| # | Decision | Options | Recommendation | Changes the prompt? |
| --- | --- | --- | --- | --- |
| B1 | **Decided:** feed the confirmed dictionary to the labeler and coder; mentions carry their entry; new brands allowed | Pending only: go for the with/without test (~$10, 200 answers) | Run the test before the freeze | yes |
| B2 | **Decided (option 4), pending an isolated test:** a brand framed two ways in one answer (Gold recommended, Platinum criticized; 384 of 4,868 AmEx answers) | Replace the single brand-level framing with two signals: **recommended** (any of the brand's products recommended) and **criticized** (any warned against); both can be true | Test in isolation before the freeze (see below) | yes |
| B3 | **Decided (option 1), pending an isolated test:** `clarification_requested` (dashboard "Asks back") is true on 52% of answers, almost all trailing offers ("Want me to compare...?") | True only when the answer asks the reader for information it needs to give or refine its advice; offers to do more and rhetorical questions don't count | Test in isolation before the freeze (see below) | yes |
| B4 | **Decided (option 2):** price and spec flags (dashboard "Prices" / "Specs"). They vary widely by engine (prices 55% Sonar - 94% Gemini on AmEx), so they carry signal; the problem is B2B-only examples (APR, "3% cash back", "$300 credit" are ambiguous) | One generic rule for every category: **price** = what the buyer pays (price, fee, subscription, interest rate); **spec** = what the product delivers in numbers (capacity, limits, earn rates, sizes, speeds); examples drawn from many categories, not card cases | Validate on the held-out categories (section H), plus the isolated full-prompt test | yes |
| B5 | **Decided - not a prompt change:** out-of-category picks (AmEx ecosystem answers "pick Expensify") | Labeling stays as is. Reporting to-do: a computed in-category flag (top pick resolves to an approved dictionary brand) so the "firm pick" rate can be filtered to category picks. Future version: code adjacent out-of-category brands as their own class and map their associations with tracked brands | - | no |
| B6a | **Undecided until the branded-prompt review (B10):** when is the target "present"? 10 AmEx answers to branded doubt questions discuss AmEx only by reference ("the card", "the fee", "it") and were marked absent while their doubt verdict said "confirms" | (1) present when discussed by name OR by clear reference to a brand the question names, recorded with a by-reference marker; (2) named in the answer only; (3) named only, and skip stance on branded prompts | Leaning (1), but decide after B10 | yes |
| B6b | **Decided:** which sentence becomes the focus quote | The sentence that most directly states how the answer positions the brand (its verdict on it); first such sentence as tiebreak | - | yes |
| B6c | **Resolved by B1:** top pick naming variants ("Gold" vs "Amex Gold"). B1 already decided the top pick carries its dictionary entry like the mentions do; metrics and scoring use the entry, and the as-written form keeps product detail | - | - | no further change |
| B10 | **Review how branded prompts are handled (added 2026-09-27, Tyler).** Branded prompts (the question names a brand) measure stance, not visibility. Only doubt-stage cells get the doubt verdict today, but value doubts and doubts phrased as comparisons likely sit in other stages too (pricing: "is the Amex fee worth it?"; comparison: "is Jira really slower than Linear?") | Examine: which stages carry branded prompts and how each is reported; a per-question doubt check over ALL branded prompts (~$0.005 each, a few dollars for four trackers) so any question voicing a doubt gets the design line regardless of stage; how reference-only mentions count (B6a) | Do the review before the freeze - it changes which answers carry a design line | yes |
| B7 | **Decided (option 3, built as a split), pending an isolated test:** per-mention role replaces per-mention framing. Today "recommended" lumps the winner with everything listed (AmEx: 3.0 recommended brands per conditional answer, 2.3 per pick answer) | Split recommended only: **chosen** (= the top pick) / **branch winner** (the product named as the answer for a stated condition) / **shortlisted** (recommended under today's rules, neither of the others); **mentioned** unchanged; **warned against** = today's negative renamed. Framing is derived by merging the three back into recommended | Test in isolation before the freeze (see below); if branch winner is unstable, collapse it into shortlisted (no relabel needed) | yes |
| B8 | **Decided (option 1):** no taxonomy adds for v0.2. Residue is small: AmEx 5.0% of answers carry an uncoded reason, largest cluster (credit-score impact) ~1%; every named cluster on the other trackers is under 1%, below discovery's 2% add floor | Confirmed codebooks unchanged; residue stays in uncoded_reason. **R&D exploration, not committed:** train the coder to output uncoded_reason so prod waves collect residue for the codebook gate (drift loop) | Reminder in AGENTS.md To do | no |
| B9 | Freeze and version the prompt, plus a check on the 200-answer test set | Approve (~$5) | Approve after B1-B8 | - |

**How every isolated test works:** each one sends the FULL labeling prompt (all fields) with only its one change applied, over the same 200 answers, and compares every field against a baseline run of the current prompt, so it shows both the intended effect and any spillover onto other fields (outcome, top pick, framing, reasons, brands, doubt verdict). A field moving more than the Opus rerun baseline (95% outcome, 92% top pick, 98% framing, reasons 0.83, brands 0.90) counts as affected. One fresh baseline run of today's prompt (~$5) is shared by all tests; the older runs 1 and 2 predate the doubt field and design lines, so they are not the comparison.

**B2 isolated test (flagged, not run):** run only the B2 change (no other B edits) on the 200-answer test set, Batch API, one answer per request (~$5). Check that:
1. The two signals agree with what the per-brand framings in the mentions list imply.
2. They are as stable run to run as today's single framing (98%).
3. No other field moves beyond the rerun baseline.
4. The share of answers that are both recommended and criticized looks right, from a hand-read sample.

It is run separately from the dictionary test (B1) so each change's effect can be seen on its own.

**B3 isolated test (flagged, not run):** run only the B3 change on the 200-answer test set, Batch API, one answer per request (~$5). Check that:
1. Trailing offers no longer set the flag.
2. Real information requests still do (hand-checked sample).
3. The rate drops from ~52% to the information-request share.
4. No other field moves beyond the rerun baseline.

It is run separately from the B1 and B2 tests.

**B7 isolated test (flagged, not run):** run only the B7 change on the 200-answer test set, Batch API, one answer per request (~$5). Check that:
1. Framing derived from the roles (chosen + branch winner + shortlisted = recommended) matches the baseline run's per-mention framing within the rerun baseline - the split must not move the recommended / mentioned / negative lines.
2. Branch winner vs shortlisted holds up run to run (a second run of the B7 prompt, ~$5 more): if it doesn't, branch winner collapses into shortlisted and the labels stay usable.
3. The mechanical checks pass: chosen = top pick; exactly one chosen in a pick answer; branch winner only in conditional answers; conditional answers with no branch winner are flagged and hand-read.
4. No other field moves beyond the rerun baseline.

Branch-winner rule wording to test: two products named for one branch ("Platinum or Gold if you travel") are both shortlisted; with nested conditions the innermost stated winner counts; "also consider X" is shortlisted. It is run separately from the B1, B2 and B3 tests.

**Already decided and needing no prompt change:** mention order is computed from the answer text after labeling; top pick and framing are also resolved through the dictionary as a safety net.

---

## H. Held-out categories: Doritos and Sephora (validation for the whole frozen prompt)

Doritos and Sephora (~7,300 collected answers, 8 engines each) have never been labeled or used to design any rule, so they are the out-of-sample test for everything decided in B - not just B4 - and a full rehearsal of the new-tracker flow. Nothing here has run.

| # | Step | Decision needed | Size |
| --- | --- | --- | --- |
| H1 | Bootstrap both through the init-run pipeline: open discovery and brands discovery (grok), embeddings-first consolidation (Opus), question designs and the per-question design check | Run it in prod (the real product path, writes discovery data to their rows) or locally from the vault (no prod writes) | ~$3-5 in total |
| H2 | Confirm the codebook and brand dictionary through the gates, as a customer would | You as the customer, or me proposing and you signing off | your time |
| H3 | Label a sample of each with the FROZEN prompt, one answer per request | Sample size (proposal: 500 per category) | ~$25 |
| H4 | Check every decision on categories it was not designed on: dictionary in the prompt (new brands still found), two framing signals, "Asks back", price/spec rule (calories, shade counts, coupons, sizes), out-of-category picks, per-brand roles, doubt verdict, reason codes under new codebooks, computed mention order | A blind review page for you (~40 items across the decisions) plus automatic consistency checks and a rerun subset for stability | ~$5 + your time |
| H5 | After v0.2 trains: unseen-category evaluation of the coder on Doritos and Sephora (alongside Netflix), plus the 10% calibration test | - | ~$5 GPU |

**Rule:** Doritos and Sephora stay out of all prompt and codebook design. If H4 shows a problem, the fix is designed on the four labeled trackers and re-checked on H, so they remain held out. Their engine gap (no Claude engines collected) doesn't affect labeling tests; backfilling it is a separate collection decision.

## C. Labels (after B)

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| C1 | Which trackers get v0.2 labels | Training: jira, AmEx, Pixel. Unseen-brand evaluation: Netflix. Each includes set A (existing answers) and set B (GPT-5.6 answers) | All four, as listed |
| C2 | AmEx's 4,868 labels made before the freeze | Relabel under the frozen prompt / keep and repair | Relabel. B3, B4, B5 and B7 all change fields the repair can't recompute. |
| C3 | Labeling route | In-session on your plan / Batch API / mix | Mix: API for the bulk, in-session when a week's allowance would otherwise go unused. Use one answer per call either way, and one usage-checker session instead of 8 sessions polling. |
| C4 | Order | AmEx, jira, Pixel, Netflix / all in parallel | Parallel on the API; on your plan, AmEx then jira then Pixel then Netflix |

**Size of C**, one answer per request, off-design prompts excluded:

| Tracker | Answers (set A + set B) | Batch API (~$23 per 1,000) | In-session (~0.5% of a week per 100) |
| --- | --- | --- | --- |
| AmEx | 7,350 | ~$170 | ~37% |
| jira | 7,635 | ~$175 | ~38% |
| Pixel | ~5,860 | ~$135 | ~29% |
| Netflix | ~5,640 | ~$130 | ~28% |
| **Total** | **~26,500** | **~$610** | **~1.3 weeks** |

---

## Not in A-C, but open

- Objection-stage reporting on the dashboard: defend / concede / redirect as its own metric.
- Prod integration (Fireworks provider, deployment lifecycle, output mapping, dashboard views) can start any time, in parallel.
