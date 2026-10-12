# Init audit v5b - contract fixes on repaired rooms (STYLE s33, 2026-10-03)

**Scope.** Seeds were regenerated on the rooms that passed the room check and contest repair (`cold_v5`), with the same profile and roster as `cold_v4`. Five fresh Opus audits against `STAGE_CONTRACT.md` plus `AUDIT_BRIEF_v4.md`.
- Data: `~/Documents/procerno_eval/init_audit_2026-10-03/cold_v5b/` and `cold_v5b_audit/`.
- Nothing touched prod.

| brand | seeds | flags | S1 | S2 | S3 | S4 | verdict | v4 S2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Jira | 50 | 0 | 0 | 1 | 6 | 7 | ready after gate edits | 3 |
| American Express | 48 | 0 | 0 | 5 | 7 | 8 | ready after gate edits | 5 |
| Netflix | 37 | 1 | 0 | 1 | 6 | 5 | ready after gate edits | 4 |
| Google Pixel | 46 | 0 | 0 | 3 | 6 | 7 | ready after gate edits (was NOT READY) | 8 |
| Doritos | 39 | 0 | 0 | 4 | 7 | 2 | ready after gate edits | 3 |
| **total** | **220** | **1** | **0** | **14** | | | | **23** |

**Before the direction fix,** the same rooms shipped 17 flagged seeds. The s33 switch-direction rewrite had widened the rule to every tool or card change; it is fixed in 992bb67.

## Fixed this round (audits confirm)

- **Use-case asks for ONE pick** on all five brands; "name a few" is gone.
- **Switch directions:** zero false flags. Pixel's iPhone is contested in all four columns (none in v4).
- **Churn and Renewal:** leaving is a live option everywhere. Pixel's fix-it churn cells are gone.
- **Rooms pass the room rules.** Contest repair swapped a no-real-choice room (Pixel "Carrier promo upgrade") and an uncontested one (Doritos "Health-conscious swap").
- **Value** names a line where it matters on most cells. Jira and Pixel are effectively one line each.

## Still failing - root causes

1. **Client strengths still slip in** (all five brands).
   - Feature screens pick the client's signature capability: Pixel "longest OS update support", Jira "native Scrum boards".
   - Rewrites swap in another client strength: AmEx transfer partners became lounge access; Doritos gained "big flavor"; Pixel gained update longevity.
   - The "never the client's strength" rule is an instruction only; the model doesn't apply it reliably. **Fix:** derive the client's signature strengths once per tracker (a short list, cached with the brand profile) and have the design check reject a feature screen, use-case job or blind cell that hinges on one.
2. **Use-case jobs collapse** into Discovery, the feature screen or the room (Jira, AmEx, Netflix, Doritos). For credit cards the writer reads "one job" as "one feature" (lounge access), and jobs repeat (Doritos: sheet-pan nachos twice; Pixel: battery twice). **Fix:**
   - define a job as a task the buyer gets done, not a product feature;
   - add a battery check that each use-case job differs from the other use-case jobs, from its column's feature screen capability and from the room itself.
3. **Bug: the worry-diversity pass still treats Repertoire as a worry cell.** It wrote a worry into Doritos' habit cell. The pass must skip Repertoire.
4. **Contest repair can pick a near-duplicate.** Doritos' replacement "Warehouse club stock-up" nearly repeats "Family pantry restock". **Fix:** repair skips reserve rooms too similar to the remaining core rooms.
5. **A roster label leaked into a seed:** "Done with my iPhone (Apple)". **Fix:** the parenthetical must be stripped from the name used in prompts.
6. **Test harness: the walk re-reads the buying style.** Netflix's base journey re-classified, so Problem recognition, Category education and Objections dropped out. That's input variance, not an engine change. **Fix:** fixed-input walks reuse the saved base journey too.
7. **Value product line:** AmEx 3/4 (one "an American Express card"). Acceptable for one-line brands (Jira, Pixel).

## Next

Fixes 1-6 are by rule. Fix 1, the client-strengths list, is the one new mechanism.
