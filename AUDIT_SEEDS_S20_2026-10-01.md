# Seed audit, final pass (s20) - Jira, American Express, Google Pixel (2026-10-01)

Scope: all 165 seeds as regenerated under s20. Three of them carry `seedFlags`, so they reach the review gate as "needs your call" chips. A flagged seed counts as surfaced to the human, not as a silent defect.

## 1. s19 S3 verdicts

| s19 finding | Verdict | Evidence |
| --- | --- | --- |
| Q1 - jira [24] wrapped in quote marks | **FIXED** | Now reads "tiny startup, 3 engineers, shipping our first app..." with no quote marks. No seed in any battery is quote-wrapped. |
| Q2 - amex [37] objection voiced as a cardholder | **FIXED** | "That American Express annual fee feels steep. Do the credits and perks realistically offset it, or am I just paying for a fancy brand?" This is a prospect. Every objection seed in the three batteries is now pre-purchase. |
| Q3 - no Pixel tier question | **FIXED** | pixel [38] (within_brand): "the latest Google Pixel A-series around 450, or pay up for the regular Google Pixel at about 700? I mostly do photos, messaging, streaming..." The four Pixel pricing cells now ask four different things: carrier vs unlocked, brand tier, finance vs pay upfront, and generic midrange vs flagship. |
| J5 - amex [34] eligibility lookup | **FIXED** | "American Express welcome bonus terms feel designed to trip me up. If I hit the spend, do I actually get the bonus, or do those lifetime and family rules end up blocking people?" It voices a distrust claim that an answer can confirm or rebut. |
| P2 - one pricing trade-off repeated | **RECURS, unflagged (S3)** | AmEx still asks fee vs no-fee in 3 of 4 cells: [38] "no annual fee cash back card, or pay around 295", [39] "no fee 2 percent cash back card, or pay about 95", [41] "no annual fee cash back card, or pay for a travel card around a $95 fee". The same rule also fails on Jira: [37] "start on a paid plan now or run free for a year" and [38] "Free plan or pay the entry tier" are the same shape. Only Pixel meets the s20 rule (a trade-off shape in at most one pricing cell). |

## 2. The three flagged seeds

| Seed | Checker's reason | Ruling |
| --- | --- | --- |
| amex [18] "Which business credit cards let me issue employee cards with per-card spend limits?" | "for an employee company, not an owner setting up their own business card" | **True defect, wrong reason.** Issuing employee cards fits an owner fine. The real gap is that the seed has no circumstance at all: no owner, nothing being set up, no business. Gate fix: "I'm setting up our first business card for my 6-person shop - which ones let me issue employee cards with per-card limits?" |
| pixel [20] "which smartphones have a great front camera and strong battery life, good for a first phone?" | "first phone" without a teen is generic and ambiguous about age | **Genuinely ambiguous, leaning checker strictness.** "First phone" almost always means a kid or teen, but "good for a first phone" is tacked on. Approve as is, or add "for my 13-year-old". |
| pixel [21] "switching platforms. Which smartphones include a built-in migration tool..." | no from/to direction | **True defect, correctly flagged.** It uses the exact phrase the s18 writer bans by name. Gate fix: "Moving from iOS to Android." |

## 3. What s20 broke or failed to hold (unflagged)

**S3: jira [53] (renewal, concern "Roadmap and lock-in fears").** "...Renewal's coming up. **I know there are cheaper tools around.** Do we keep it, or is it smarter to move off it now?"
This is the s14 N3 "cheaper" add-on again, on a concern that is not about price. It brings the price worry into the lock-in cell. Delete the sentence.

**S4, polish only:**
- **Comparison wording.** Two Jira seeds slot the plural category into a singular phrase again: jira [27] "Jira or Asana for project management tools", [30] "ClickUp or Jira for project management tools". Pixel puts its own brand first in all four seeds and still adds "as/for a smartphone" in 3 of 4.
- **Stamped switch opener.** "(thinking about) moving from iOS to Android." opens 6 of 7 switcher seeds.
- **Overlong pricing seed.** amex [40] runs 58 words with 7 figures. That is over the ~55-word writer ceiling and the 2-3 figure cap.
- **Advocacy cells without a stated relationship.**
  - jira [59] "Leadership is asking why we should standardize on Jira" is a business-case ask with no relationship, and it duplicates [40].
  - pixel [51] "A friend keeps telling me to switch" reads two ways.
- **Repeated framing.**
  - pixel [26] is still hype- and looks-framed: "fan energy... compliments for look and vibe".
  - AmEx [8], [12] and [16] all repeat "fine with a high annual fee if the perks...".
  - All four Jira business_case seeds still pitch the CFO.
- **Lists.** jira [22] has four requirements (roadmaps, dependencies, rollups, SSO).
- **Confused premise.** pixel [18] "truly unlocked... so I can take a trade-in deal now", but carrier trade-in phones are usually locked.

Held from earlier rounds: no calendar years; no segment vocabulary; every churn and renewal seed states the stay-or-go choice and names the brand once; offensive alternatives are bare, varied and anchored to the category (N4 fixed); no blind seed names a brand; every comparison is circumstance-neutral.

## 4. Bottom line

**Ready for collection once six gate actions are done. No S1 or S2 defects remain.**

Three of those actions are the flagged chips, which the reviewer will see:
- Fix amex [18]: add the owner and setup circumstance.
- Fix pixel [21]: state "from iOS to Android".
- Decide pixel [20]: approve as is, or add an age.

The other three are unflagged S3 defects. No chip will show them, so they must be handed to the reviewer by name:
1. **jira [53]**: delete "I know there are cheaper tools around."
2. **jira [37] or [38]**: reframe one off free vs paid. For example, make the Mid-market cell [37] a Jira Standard-to-Premium question at 110 to 200 users.
3. **AmEx pricing**: reframe two of [38], [39] and [41] off fee vs no-fee. For example, [38] as an AmEx business tier question and [41] as secured vs unsecured starter.

After those six actions, all three batteries are collection-ready. The S4 items are optional polish.

**Checker note.** The battery-level rule "a trade-off shape in at most one pricing cell" was written into s20, but it did not fire on AmEx (3 cells) or Jira (2 cells). Either it is writer-only with no checker, or the checker compares wording rather than the shape of the trade-off. Close that before the next tracker's setup.
