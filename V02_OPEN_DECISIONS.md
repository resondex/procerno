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
| B4 | Price and spec flags are 74% / 82% true on credit cards (definitions were written for B2B software) | Per-category definitions of what counts / accept as broad "has numbers" flags | Per-category one-liners, generated with each tracker's codebook | yes |
| B5 | Does a pick of an out-of-category product count? (AmEx ecosystem answers "pick Expensify") | Yes, any product / no, only the tracker's category (else conditional or no pick) / count it, but flag out-of-category | Count it and flag it, so loyalty and ecosystem answers aren't miscounted as losses | yes |
| B6 | Small wording fixes: "absent" means not named in the answer; how the focus sentence is chosen; top pick written as the mentions list writes it | Approve / change | Approve | yes |
| B7 | Per-brand role in the mentions list: chosen / branch winner / shortlisted / mentioned / warned against (conditional answers are 40% of AmEx) | Add / leave outcome at answer level | Add | yes |
| B8 | Taxonomy adds for the post-scope residue (AmEx consumer credit-score impact, retention offers; Netflix home bandwidth; jira review-source credibility; Pixel return policy) | Add codes (forces a reasons relabel, already happening) / leave in uncoded | Decide per tracker now, since the relabel is happening anyway | yes (code lists) |
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

**Already decided and needing no prompt change:** mention order is computed from the answer text after labeling; top pick and framing are also resolved through the dictionary as a safety net.

---

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
