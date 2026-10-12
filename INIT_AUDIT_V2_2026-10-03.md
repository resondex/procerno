# Init audit v2 - the decisions build, cold walk (2026-10-03)

**Scope.** Five brands cold-walked on the new engine (decisions 1-4 built; STYLE s30, rules r15), then audited adversarially. One fresh Opus auditor per brand, judged against `AUDIT_BRIEF.md` plus `AUDIT_BRIEF_v2.md`.
- Walk spend: a few dollars (not separately metered).
- Data and reports: `~/Documents/procerno_eval/init_audit_2026-10-03/cold_v2/` and `cold_v2_audit/`.
- Nothing touched prod.

## Bottom line

**What the decisions fixed:**
- Rosters now hold the real rivals: Linear and GitLab for Jira, iPhone for Pixel, tortilla-chip brands for Doritos.
- Sister brands are tagged.
- Audiences are buyer segments.
- The habitual stage set applied correctly on Doritos.
- No client names or pitch wording in rooms, except one AmEx room.

**Three new or remaining engine problems account for most of the S2s:**
1. **Pricing collapses into the brand's own tiers.**
   - Jira, Netflix and Pixel: 3-4 of the 4 pricing cells became own-tier upsells, which can never return "not worth it".
   - AmEx's cells don't say which card.
   - Doritos got it right (store brand).
   - Cause: decision 1's wording allows "its own lower tier OR a generic cheaper option", and the writer takes the own-tier path.
2. **Rows duplicate across a column.** Discovery, Use-case fit and (where present) Feature screening ask nearly the same "name some products for my situation" question in every column, on all 5 brands. Decision 2 merged Shortlist; the same rule applies one level further.
3. **The contest check is noisy:**
   - its bar (half of ALL direct rivals) gives false ambers in subset-contested markets (AmEx premium rooms);
   - its pitch flag misfired twice (AmEx "transfer partners", Doritos "Scoops", a word not in the room text);
   - its name flag reads "DevOps" as Azure DevOps.

**Severity counts are up from the previous cold round** (S2: 5 -> 15). They are not directly comparable: v2 added the new contracts and required roster and scenario verdicts, and the cross-row duplication was not judged before. But the pricing collapse is a real regression the decisions introduced.

| brand | seeds | flagged | S1 | S2 | S3 | S4 | previous cold (S1/S2/S3/S4) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jira | 50 | 0 | 0 | 3 | 7 | 11 | 0/0/4/16 |
| American Express | 45 | 0 | 0 | 2 | 10 | 8 | 0/1/3/17 |
| Netflix | 40 | 0 | 0 | 4 | 9 | 10 | 0/1/8/20 |
| Google Pixel | 45 | 0 | 0 | 3 | 8 | 9 | 0/1/2/14 |
| Doritos | 39 | 0 | 0 | 3 | 8 | 9 | 0/2/11/11 |

All five: READY AFTER GATE EDITS, 0 missing rows.

## Per decision

**Decision 1 (pricing) - REGRESSION.**
- The value-question shape held, with the brand always named.
- The counterpart defaulted to the brand's own tier on 3 brands:
  - Netflix: 3 of 4 cells are ad tier vs ad-free;
  - Pixel: 3 of 4 are Pro vs regular;
  - Jira: all are tier upsells, and one invented a "stay on Free at 35 seats" option that Jira's 10-user cap rules out.
- AmEx's cells are "is American Express worth the fee" with no card named.
- Doritos is correct: all four cells weigh it against store brand.
- All pricing cells type as `within_brand` (the product-mix view), though they are value verdicts.
- The pricing cells now overlap the price worry cell on Pixel.

**Decision 2 (stage fit) - WORKS.**
- Doritos: no Problem recognition, no Objections, all 8 worries as Churn triggers, Comparison present, Shortlist gone.
- Shortlist is absent everywhere.
- Remaining: the cross-column duplication above.

**Decision 3 (head-to-head picks) - MOSTLY WORKS.**
- Picks:
  - Jira: Azure DevOps, GitHub Issues, Linear, GitLab. The auditor suggests one cross-team rival, Asana or ClickUp, in place of GitLab.
  - AmEx: Chase, Capital One, Citi, Discover.
  - Netflix: Disney+, Prime Video, Max, Hulu.
  - Pixel: Galaxy, iPhone, OnePlus, Motorola.
  - Doritos: Tostitos, Santitas, Mission, Late July.
- iPhone is no longer upstream.
- Parent errors and changes the auditors claim (unverified world knowledge):
  - GitHub -> Microsoft;
  - Discover -> Capital One since 2025, so two AmEx picks share a parent;
  - Siete -> PepsiCo;
  - Disney+ and Hulu share a parent.
- **Profile defect:** Takis (Doritos' closest rival) is missing. The profile cache bump re-rolled the competitor list. The adjacent role never fired, because the new profile no longer lists out-of-category brands.

**Decision 4 (rooms) - WORKS, CHECK IS NOISY.**
- The audience line passes on all 5 brands.
- Core rooms pass the room rule, except:
  - Pixel "Android flagship upgrade" bakes in a platform, ruling iPhone out of every blind cell in its column;
  - AmEx Dining borrows the Gold card's credits mechanism (the pitch check missed it).
- Contest chips:
  - correct on Netflix;
  - 8 of 9 correct on Jira;
  - false ambers on AmEx (wrong bar) and Doritos (roster-driven);
  - pitch false positives on AmEx and Doritos;
  - the "DevOps" name false positive on Jira.
- Pitch wording left blind cells, but two problems remain:
  - frequency: "updates for years" carries Pixel's main selling point in 11 of 21 blind cells;
  - Doritos' "bold flavor" leaks into three On-the-go cells.

## Proposed fixes (by rule; not built)

1. **Pricing counterpart.** The cheaper option defaults to a GENERIC cheaper alternative in the category. The brand's own lower tier is allowed only when the column's buyer is choosing between that brand's tiers, and only if that tier can actually serve the buyer. When the brand has several products, name which one is being weighed.
   - Add a value-verdict question type for pricing, or decide that `within_brand` covers it.
   - STYLE bump.
2. **Cross-row duplicates.** Each scenario row asks a distinct kind of question:
   - Discovery = which brands/products to consider;
   - Use-case fit = will it handle a specific job;
   - Feature screening = which ones have capability X.
   - Enforce with design-intent wording plus a battery pass that flags near-identical seeds in one column (a mechanical similarity check).
3. **Contest bar.** Contested = at least half of the head-to-head picks AND at least 2 direct rivals (the AmEx auditor's proposal).
   - Pitch flags must quote text that actually appears in the room (mechanical check).
   - Room names run through the brand judge before a "Names X" chip.
4. **Brand words lifted from multi-word names** ("DevOps" of Azure DevOps): send them to the brand judge like maker words (r16).
5. **Need concentration in blind cells.** Add a battery check that no single buyer need dominates the blind cells (e.g. at most ~1/3 of them).
6. **Rooms must not bake a platform** ("Android flagship upgrade"). Add the platform-preference rule from the audience prompt to the room rule.
7. **Profile roster stability.** The profile must keep the closest category rival (Takis), and the re-roll risk from the cache bump should be checked. Consider asking for 6-8 rivals with in-category rivals first.
8. **Stale world knowledge** (Max -> HBO Max, Apple TV+ -> Apple TV, parent changes): roster and profile facts carry the model's training cut-off. Same open class as before.
