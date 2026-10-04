# Init audit v6 - four-arm seed walk (s35 vs s36, fresh vs fixed rooms, 2026-10-04)

**Scope.** Five brands, four arms each, on the same profile and roster as v4/v5b:

| Arm | Engine | Rooms |
| --- | --- | --- |
| A_s35 | s35 - category and brand examples removed | fresh, from the current room writer |
| B_s35 | s35 | v5b's rooms (fixed) |
| A_s36 | s36 - no quoted examples of any kind (scratch worktree, not committed) | fresh |
| B_s36 | s36 | v5b's rooms (fixed) |

Five fresh Opus audits, one per brand, against `STAGE_CONTRACT.md` (brief: `AUDIT_BRIEF_v5.md`). Data and reports: `~/Documents/procerno_eval/init_audit_2026-10-03/cold_v6_*` and `cold_v6_audit/`. Nothing touched prod.

## Results

| Arm | Seeds | Gate flags | S1 | S2 | S3 | S4 | Verdicts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v5b (s33, baseline) | 220 | 1 | 0 | 14 | 32 | 29 | all ready after gate edits |
| A_s35 | 223 | 6 | 0 | 6 | 31 | 38 | Jira not ready, rest ready after gate edits |
| B_s35 | 221 | 1 | 0 | 5 | 24 | 29 | all ready after gate edits |
| A_s36 | 220 | 1 | 0 | 6 | 29 | 31 | all ready after gate edits |
| B_s36 | 224 | 0 | 0 | 6 | 18 | 30 | all ready after gate edits |

- **S2s fell from 14 to 5-6 in every arm.** Fixed since v5b: copied example wording ("a cheaper phone" x4, "Done with my iPhone (Apple)"), roster parentheses, wish lists, Repertoire worries, software vocabulary in Expansion. Use-case improved from 0/4 real jobs on some brands to as many as 3/4.
- **s35 vs s36 (B arms, same rooms): no material difference by any single auditor.** In aggregate s36 has fewer S3s (18 vs 24). s36 dropped one copied shape (Jira Category education "what does ... actually do"). It made Value counterparts more uniform within a brand (all "no-annual-fee", all "basic", all "ad-supported"). It added voice quirks copied from the rule text itself ("ONE" in capitals).
- **Fresh vs fixed rooms: fixed rooms gave better seeds under both engines** (S3 24 vs 31 on s35, 18 vs 29 on s36).

## Cross-brand issues, by root cause

1. **The use-case job pass ships failed seeds silently (engine bug; Jira, AmEx).**
   - When the pass rejects a seed and then rejects its own rewrite, the original ships with no flag. Every other failed fix in the engine ships flagged.
   - Its heals aren't re-checked against the job rules: AmEx A_s35 [19] became a copy of its feature screen.
   - Room restatements still survive in the "hit show" column (Netflix, all four arms) and in the family column (Doritos).
2. **Room description criteria do leak into seeds (all A arms).**
   - Pixel's camera room collapses its whole column - Discovery, Criteria, Feature screening, Use-case and Value - onto camera, Pixel's headline strength.
   - Jira's "Regulated compliance buy" list (audit, data residency, access control) spreads into five seeds, one of them in another column.
   - The AmEx criteria lists reach Feature screening and Use-case.
   - The fresh room writer also varies too much: one Jira roll drew three rooms on the same axis.
3. **Client strengths still chosen as feature screens.** Pixel "long software support" (all arms), AmEx "strongest supermarket rewards". This is the deferred item 2: a category-level capability list.
4. **Removing examples moved the copying to our own descriptions.**
   - Shared wording from the rule text now recurs across cells and brands: "pair with it", "happy with X... smart move?", "make the case", "ONE".
   - Without the bare-move example, offensive alternatives went back to hedges or prospects. AmEx: "Thinking of leaving Chase", "If I leave Citi". Jira B_s36: "If we don't go with Asana" - and the offensive design check let these through.
5. **Stage-design gaps:**
   - AmEx Ecosystem asks for a "backup card for places that don't take Amex" in all arms, so the question forces a rival answer.
   - Netflix's solo column writes the buying-style tag into seeds as content ("I choose by vibe more than specs").
   - The bare-brand Value check is inconsistent: 1 of about 13 bare "Google Pixel" cells flagged.
   - Comparison cells use roster strings ("Apple iPhone", "GitHub Issues/Projects").
6. **Room check false hits.**
   - Everyday words trigger the brand finder: "projects" reads as GitHub Issues/Projects, "DevOps" as Azure DevOps (which caused a swap).
   - "Company-wide platform consolidation" gets a false platform-switch chip.
   - The money bolt-on check flags Renewal's own ask, "still worth paying for".
7. **Roster.** Doritos' four pre-picked head-to-head rivals are three Frito-Lay sister brands plus Takis. Outside rivals (Mission, On The Border, Late July) sit on the bench, so Comparison mostly measures routing inside Frito-Lay.
8. **Harness.** The v5b context has no saved buying style, so the B arms re-classified it. Netflix's stage sets differ between arms, so its comparison isn't controlled.
