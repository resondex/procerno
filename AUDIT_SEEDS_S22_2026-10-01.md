# Seed audit, sign-off pass (s22) - Jira, American Express, Google Pixel (2026-10-01)

**Scope:** all 165 seeds as regenerated under s22 (Jira 59, AmEx 55, Pixel 51). Every seed has `seedFlags` null, and none is longer than 55 words.

**Bar:** the same adversarial bar as the first audit, applied to every seed.

**Severity:**
- **S1**: ship-blocker.
- **S2**: high; biases a measurement. Fix before collection.
- **S3**: medium. Fix at the gate.
- **S4**: low. Polish.

---

## 1. The six s20 gate items

| Item | Verdict | Evidence |
| --- | --- | --- |
| jira [53]: "cheaper" add-on | **FIXED** | "Renewal coming up. We're deep in Jira: custom workflows and tons of linked issues. I'm nervous about lock-in if the roadmap shifts. Renew and commit, or start moving off it?" |
| jira [37]/[38]: duplicate free-vs-paid | **FIXED** | The two cells now ask different trade-offs. [37] is free vs paid: "Stick with free project management tools plus docs, or pay for a proper platform". [38] is annual vs monthly billing: "lock in an annual plan for 18 seats to get the discount, or pay monthly for 10 and add as we go?". The other two Jira cells are also distinct: [36] is a brand tier question and [39] is bundle vs separate desk. |
| AmEx fee vs no-fee in every cell | **FIXED** | Only [38] asks fee vs no-fee. [39] is flat 2% vs category card, [40] is Platinum total-cost with balance interest (within_brand), and [41] is 0% intro APR vs rewards. |
| amex [18]: missing business circumstance | **FIXED** | "We're 18 people and I'm setting up our first business card program. Which business credit cards let me issue employee cards..." |
| pixel [20]: teen ambiguity | **RECURS, worse, unflagged (S3)** | "Which phones have an excellent front camera for selfies, with 4K video and good stabilization, but are not huge? Drop a few models." The teen / first-phone circumstance is now gone entirely. The s20 version at least said "good for a first phone". |
| pixel [21]: missing direction | **RECURS, unflagged (S2)** | "**Moving from one mobile platform to another.** Which phones offer the smoothest data transfer..." The same defect is back in pixel [17]: "**Switching from one mobile platform to another.** What should I check so the change is painless?" This is the exact phrase family that s18 bans by name in both the writer and the circumstance check. |

---

## 2. S3+ findings from the fresh sweep

**F1 [S2] pixel [17], [21]: the Platform-switcher direction is missing again, and nothing flagged it.** This is the s17 blocker class (see item 6 above). [21] is an open-choice cell, so which phones it names depends on the direction the engine guesses. The other five switcher seeds state "from iOS to Android" correctly.
Fix at the gate: replace the opener with "Moving from iOS to Android." in both seeds.

**F2 [S3] pixel [20]: the scenario circumstance is lost** (the M1 class). Nothing in the seed says teen or first phone, so the Teen-first-phone read on this cell is just a generic selfie-camera feature ask.
Fix: "First phone for me, I'm 15 - which phones have a great selfie camera with good stabilization and aren't huge?"

**F3 [S3] jira [29] and amex [29]: head-to-heads that never ask for a pick.**
- jira [29]: "Jira vs Trello as a project management tool: where does each one win?"
- amex [29]: "American Express or Citi as a credit card issuer: where does each win?"

The head-to-head view scores a prompted winner. "Where does each one win" invites a balanced "it depends" with no verdict, so these two cells will under-produce picks next to their six siblings, which all ask "which would you go with/choose".
Fix: append "...and which would you pick?" to both.

**F4 [S2 - checker, not a seed]: the new second-opinion pass suppresses true defects.**
- In s20, the checker correctly flagged pixel [20] and [21] for exactly these defects.
- In s22, the same two cells came back with the same defect classes (and [17] joined them), and every flag is null.
- The likely cause is the new medium-effort second opinion. It runs before any heal or flag, and here it overturned verdicts that were right.

As a result, "zero flags" is not evidence that a battery is clean. Before this pass is trusted on the next tracker, re-run the design check on pixel [17], [20] and [21] at both effort levels and look at which verdict the second opinion overrode. A named-phrase rule like "from one platform to another" should be a deterministic string check, not a model judgment.

---

## 3. S4 (polish; does not block)

- **Alternatives anchors and templating.**
  - pixel [45] "Moving off Samsung Galaxy. Suggest a few solid alternatives to try." and pixel [47] "Dropping OnePlus. Point me to a few strong alternatives." still have no category word.
  - pixel [46] "What non-Xiaomi smartphones..." reads machine-written.
  - amex [46]-[49] all repeat "credit card alternatives".
- **Brand named twice in churn.** All four jira churn seeds name the brand twice, for example [45] "...in Jira... migrate away from Jira". The s19 rule says once.
- **Pixel comparisons.**
  - [27] uses the roster string "Google Pixel or Apple iPhone for a smartphone".
  - The client brand is listed first in all four.
- **Duplicated pricing shape on Pixel.** pixel [40] ("base model or... the Pro... Is the Pro tier worth the extra") duplicates [38]'s paying-up-vs-base shape. It also leaves the product line unnamed, so "the Pro" could mean any brand.
- **Circumstance thin or mismatched.**
  - pixel [18] (Carrier trade-in) only says "sold by major carriers".
  - jira [23] (Mid-market scale-up) says "Two product teams plus a platform team", which is small and not scaling.
- **Contortion.** jira [42] "Founder is also our CFO". All four jira business_case seeds still pitch finance.
- **APR inside a pricing cell.** amex [40] brings balance-carrying interest into a Platinum pricing cell. That is allowed as total-cost math, but it overlaps objection [36].
- **Hypothetical relationships.** jira [48] "If we decide to leave Jira" is hypothetical. jira [55] is filed as renewal but never mentions renewal.
- **Look-and-wow framing.** pixel [26] "the most wow from friends... people asking what phone it is" keeps this framing.

Held from earlier rounds:
- no calendar years, segment vocabulary or quote wraps;
- every objection seed is voiced pre-purchase;
- every doubt seed voices its assigned concern with no money ask and no "cheaper" add-on;
- every churn and renewal seed states the stay-or-go choice;
- offensive alternatives carry no reasons;
- comparisons are circumstance-neutral, and class cells are clean;
- no blind seed names a brand;
- pricing seeds carry usage, and each battery has at least one within_brand cell.

---

## 4. Bottom line

**NOT READY: one S2 blocker, plus three S3 edits.** Jira and AmEx are each one sentence from ready.

| Battery | Cell | Edit | Severity |
| --- | --- | --- | --- |
| Pixel | [17], [21] | Replace "from one mobile platform to another" with "from iOS to Android" | S2 (blocker) |
| Pixel | [20] | Restore the teen / first-phone circumstance | S3 |
| Jira | [29] | Add a pick ask ("...and which would you pick?") | S3 |
| AmEx | [29] | Add a pick ask ("...and which would you pick?") | S3 |

None of these will show as a gate chip, so the reviewer needs this list. They are five hand edits; another engine iteration is not needed to clear them. With those edits made, all three batteries are **READY**.

Separately, before the next tracker's setup, fix the checker regression (F4): the medium-effort second opinion is clearing defects that the first pass flagged correctly.
