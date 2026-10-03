# Init audit - four independent passes (2026-10-03)

**Scope.** Five brands were checked in four independent passes:
- the r15 cold walk, plus a seed audit of its output;
- a cell audit of the five setups Tyler walked and saved;
- a paraphrase audit of the same five setups;
- an analyst fix pass on the same five setups.

The brands are Jira, American Express, Google Pixel, Doritos and Netflix.

**Nothing touched prod.**
- The saved drafts were read once, through a read-only transaction.
- The cold walk ran on a temporary sqlite store.
- All outputs are local, in `~/Documents/procerno_eval/init_audit_2026-10-03/`. The subfolders are `cell_audit/`, `para_audit/`, `analyst/` and `cold_audit/`, each with a per-brand `.md` and `.json`. Analyst patches are in `*_patched.json` and change logs in `*_changes.jsonl`.

**How it was run.**
- Each pass used a fresh Opus subagent per brand.
- Agents could not read each other's outputs.
- Every agent was judged against the same shared brief (`AUDIT_BRIEF.md`).

## Bottom line

- **The init system is close enough to move to coding, after gate edits.** Across 20 audits there are zero S1s, and every battery comes out ready after gate edits.
- **One real ship-blocker sits in the saved drafts:**
  - It is Pixel cell 37.
  - The seed and all 9 paraphrases state prices ("Pixel at 699 / Pro at 999").
  - The engine flagged it, but the flag was never resolved at the gate.
- **An analyst changes about 1 prompt in 7, and the change is not uniform.**
  - The changes cluster in a few predictable classes.
  - Two of those classes are engine-level and come before the cell writer: the competitor roster, and the scenarios and stage fit.
  - Fixing those would remove most of the S2 mass.
- **On a fresh cold walk, the seeds are cleaner than the saved drafts' paraphrases.**
  - The cold seed audits found 0-2 S2s per brand.
  - The paraphrase audits found 10-27 S2 paraphrases per brand.
  - The paraphrase step is where most of the measurement-biasing drift enters.

## 1. Served vs analyst delta (saved setups)

Counts are computed from the patched files (`delta.py`), not taken from the agents' own reports.

| brand | cells touched | seeds changed | paraphrases changed | prompts changed | applied S2 fixes | analyst verdict |
| --- | --- | --- | --- | --- | --- | --- |
| American Express | 16/57 | 4 | 43/513 (8.4%) | 8.2% | 26 | light edits (~35 min) - code-ready after |
| Jira | 22/54 | 4 | 66/486 (13.6%) | 13.0% | 13 | light edits (<30 min) - code-ready after |
| Google Pixel | 20/50 (+2 added) | 4 | 64/450 (14.2%) | 13.6% | 27 | not fieldable as served (cell 37); ~135 min - code-ready after |
| Netflix | 20/45 | 6 | 65/405 (16.0%) | 15.8% | 27 | heavy by time (~2h), nothing structural; S2 fixes ~35 min |
| Doritos | 17/43 | 8 | 82/387 (21.2%) | 20.9% | 8 | heavy edits (~2h); roster must be settled first |
| **Total** | **95/249 (38%)** | **26** | **320/2,241 (14.3%)** | **13.9%** | **101** | |

No cells were dropped. The analyst added two: Pixel vs iPhone, and alternatives to iPhone.

## 2. Audit verdicts

| brand | cell audit S1/S2/S3/S4 | paraphrase audit: defective / total (S2) | cold-walk seed audit S1/S2/S3/S4 |
| --- | --- | --- | --- |
| Jira | 0/3/8/9 | 75/486 (17) | 0/0/4/16 - 54 seeds, 0 flagged |
| American Express | 0/2/9/15 | 92/513 (23) | 0/1/3/17 - 50 seeds, 0 flagged |
| Google Pixel | 0/4/8/9 | 79/450 (27) | 0/1/2/13 - 51 seeds, 1 flagged (checker strictness) |
| Doritos | 0/4/8/10 | 84/387 (18) | 0/2/11/11 - 48 seeds, 1 flagged (true defect) |
| Netflix | 0/0/10/14 | 120/405 (10; 83 are S4 template sameness) | 0/1/8/20 - 48 seeds, 0 flagged |

All 15 audits are "READY AFTER GATE EDITS". The cold walks had 0 missing rows.

## 3. Where the delta comes from (ranked by impact)

### A. Competitor roster: engine-level, the largest single source

This showed up on every brand, in both the saved and the cold runs.

- **Jira:** rival slots fill in roster order.
  - Asana, monday.com, Trello and ClickUp get the head-to-head and exit cells.
  - Linear, GitHub Issues and Azure DevOps get none, and GitLab is missing entirely.
  - Trello is Atlassian's own product, yet it takes a rival slot.
- **Pixel (saved):** Apple iPhone was typed `upstream`.
  - That left out the iPhone comparison and the leaving-iPhone cell.
  - It also took iPhone off every forbidden list, so 23 paraphrases name iPhone in brand-blind cells.
  - The cold walk typed iPhone `same_seat` correctly. The typing is not stable between runs, or it was changed at the gate.
- **Doritos:** the roster mixes sister brands with brands from other categories.
  - Four or five of the seven competitors are Frito-Lay sister brands: Lay's, Cheetos, Tostitos, and Fritos in some draws.
  - Several are not tortilla chips at all.
  - Takis and Mission get no head-to-head or exit cells.
- **AmEx:** the draw varies between runs. The cold run had no Visa, so the "AmEx vs a Visa card" class cell disappeared.

Fix direction (a rule, not a gate edit):
- Mark same-parent brands as house brands and give rival slots to other makers first.
- Rank rivals by observed alone-share once data exists (already on the to-do list).
- Make same_seat/upstream typing stable for brands whose rivals are platform makers, such as iPhone vs Pixel.

### B. Paraphrase drift: 15-22% of paraphrases, judgment-only

The mechanical checks were clean on all five brands: no brand leaks, no changed numbers, no calendar years. The drift is judgment that no checker catches. The classes, roughly by size:

1. **Criteria added to comparisons and blind cells, tilting answers.**
   - Jira: comparisons gain dev-team, sprint or scale criteria.
   - Netflix: "better value", "for binge-watching".
   - Pixel: "clean software" becomes "stock/pure Android", which is effectively Pixel's own label.
   - Doritos: "bold flavor / heat".
2. **Churn and renewal paraphrases drop the stay option.**
   - They become a leading "should I cancel?" or offer only a pause.
   - AmEx has 27 such paraphrases; Netflix cell 33 fails 7 of 9.
3. **Category words dropped.**
   - Doritos: "tortilla chips" becomes "chips" (32 instances).
   - Jira: pricing paraphrases lose "project management".
   - Unverified hypothesis from the Jira auditor: the retry step's overused-word list strips category words along with brand words.
4. **Circumstance lost.** Example: Pixel pricing cell 38 drops the iPhone-to-Android move in 7 of 9 paraphrases.
5. **Answer leaks in awareness cells.** AmEx adds "with a card", 9 of 9 times in cell 3.
6. **Late-position drift.**
   - Most drift sits at paraphrase positions 6-8, where retry output is appended.
   - Jira: 11 of 15 drift defects are there.

### C. Scenarios and stage fit (engine-level)

- **Problem_recognition askers already own the product.**
  - Cold: Netflix 1 and 3, Pixel 4, AmEx 1.
  - The same class appeared in last round's D4.
  - Scenarios like "budget-saving switch" make the stage unwritable.
- **Doritos and CPG fit.**
  - Awareness, objections (prospect vs customer), discovery vs shortlist, and pricing ("name-brand vs store-brand" three times) assume a considered or subscription purchase.
  - This needs a CPG stage-mask decision.
- **Scenario sets are skewed.**
  - Jira: all four scenarios are large-company (no small-team or startup), and its IT/service-desk column points answers at Jira Service Management.
  - Netflix: the must-watch column never describes the release, so its stages collapse into one question.
- **The audience leaks into blind seeds.** In the cold Pixel run, "Android" from the profile's audience leaked in: 9 of 17 open-choice cells rule out iPhone.

### D. Pricing

- **Repeated trade-off shapes.**
  - Pixel: financing vs upfront, three times.
  - Doritos: bag size, three times.
  - Netflix: ad tier vs ad-free, twice plus a worry.
  - The writer prompt says one cell per shape; AGENTS.md and the brief say two. This conflict needs a ruling.
- **The brand steer can reintroduce a duplicate.** Its output is never re-checked for shape (cold Pixel).
- **Stated-price gaps.**
  - Saved Pixel 37 (flag left unresolved at the gate).
  - Cold AmEx 35: "fees roughly 700 vs 250" passes the mechanical check.
  - The AmEx auditor reports that the design check computes a stated-price judgment that is never used. Unverified in code.

### E. Stale world knowledge

- Netflix: "Max" is HBO Max again; Apple TV+ became Apple TV.
- Netflix: downloads are described as Standard-only.
- AmEx: fee figures are out of date.
- These dates and facts come from the auditors' own knowledge and are unverified.
- The analysts treated them as S2/S3 because they plant false premises.

### F. r15 brand checks

- **On all five cold walks:**
  - no blind-cell leaks;
  - no false alarms in shipped seeds;
  - "Amex" is correctly accepted as naming the brand;
  - "issues", "clicks" and "data center" are not misread as rivals.
- **Two latent gaps (Netflix), neither in the shipped seeds:**
  - "Prime" is never considered, so it is neither a leak nor accepted as Prime Video.
  - "Apple TV", the device, is counted as the rival service.
- **Checker strictness seen this round:**
  - scenario-label copies of ordinary buyer phrases ("Carrier trade-in upgrade", "grocery cash back credit card");
  - "streamers" rejected as missing the category.

## 4. Is init good enough to move to coding?

**Yes, with the gate edits applied.**

- No battery has a structural defect, and every analyst verdict ends in "code-ready after edits".
- The open S2s are bounded and enumerated:
  - 101 applied analyst S2 fixes across five brands;
  - the S2 findings in the audit JSONs.

**Before collection on these five:**
1. Settle the rosters: Jira (Linear et al.), Pixel (iPhone role), Doritos (sister brands).
2. Apply the analyst patches, or the S2 subset of them.
3. Resolve Pixel cell 37.

**Engine work that would shrink the analyst delta most, in order:**
1. Roster construction: house-brand detection and stable rival typing.
2. Paraphrase checks for three classes: added criteria, the stay-or-go verdict, and kept category nouns.
3. Scenario and stage fit: the problem_recognition owner check and a CPG stage mask.
4. Pricing: a ruling on the shape cap, and a re-check after the steer.
5. A stated-price check that catches the "fees N vs M" form.
