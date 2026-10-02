# Seed audit, final verdict (s29) - Jira, American Express, Google Pixel (2026-10-01)

Scope: all 165 seeds as regenerated under s29. `seedFlags` is null on every seed and every angle field is valid. No seed exceeds 52 words. I applied the same adversarial bar as in the first audit.

Severity: **S1** ship-blocker / **S2** high / **S3** medium (fix at the gate) / **S4** low.

---

## 1. s28 findings

| Item | Verdict | Evidence |
| --- | --- | --- |
| F1 - pixel [25] switch pointed toward the rival | **FIXED** | "Switching from iOS to Android... Which Android phones handle that switch best?" Every switcher seed that states a direction now says iOS to Android ([9], [13], [17], [21], [25], [40]). See F1 below for [4]. |
| F2 - amex [3] asker already owns a premium card | **FIXED** | "I'm flying every month now, paying bag fees, airport food, and sitting at the gate while everyone else hits lounges..." Every problem_recognition asker is now pre-ownership. |

---

## 2. S3 findings (no S1 or S2 this round)

**F1 [S3] pixel [4]: the direction is missing again, in a third wording.**
"Thinking about moving from **my current platform to the other platform**. Group chats, photos, notes, and paid apps feel tangled up with my current phone..."

This is the fourth regeneration in which this one cell has been directionless:
- s22: "from one mobile platform to another"
- s27: "from one phone platform to another"
- s29: "from my current platform to the other platform"

Each time, the negative string check was widened to catch the last wording, and the writer found a new one. s29's new rule says a switch must leave the client brand an eligible answer, and it did not catch this. A seed with no direction leaves the client's eligibility to the engine's guess.

- **Gate fix:** "Thinking about moving from iOS to Android."
- **Mechanical fix:** stop blacklisting phrasings. Require switcher cells to contain the destination token on the client's side ("Android" for this tracker). A positive check closes the class.

**F2 [S3] AmEx pricing: all four cells are one "which price level" class again.**
- [38] (within_brand): "With American Express, stick to a no-fee card or is paying around 350 a year worth it after points and credits?"
- [39]: "Is a no-fee flat cash back card smarter, or does a modest annual fee with higher rewards leave me ahead?"
- [40] (within_brand): "Is American Express Platinum at $695 worth it over Gold at $250 for me?"
- [41]: "should I go no-annual-fee to start, or pay around $95 for better rewards?"

s28's [39] carried a second structure: "0 percent intro APR card or a higher-earning card with an annual fee". It is gone. By the coordinator's own labeler rule ("paying more-or-less for the same line = ONE 'which price level' class"), all four cells are now the same class. The s23 ruling allows two cells of the main structure, not four. This is the s27 F3 problem back again, and the two rejected dedup regens are probably why.

- **Gate fix:** restore s28's [39] text, which passed every check last round: "Replacing my everyday credit card. I spend about 2,000 a month, keep cards 3 years, and might carry a balance for the first 6 months. Better to choose a 0 percent intro APR card or a higher-earning card with an annual fee?"

That leaves one generic fee cell ([41]) and two brand-tier cells ([38], [40]), which is acceptable.

**F3 [S3] jira [53] (renewal, concern "Roadmap and lock-in fears"): the "cheaper" add-on is back.**
"...Do we sign again with Jira or start planning an exit **to something cheaper**?"

The concern is lock-in and roadmap, and the seed brings price into it. This is the s14 N3 / s20 class that the s22 doubt intent was meant to reject. It went unflagged. The price concern already has its own renewal cell ([54]).

- **Gate fix:** "...Do we sign again with Jira or start planning an exit?"

---

## 3. S4 (polish; does not block)

- **Two questions in one seed:**
  - jira [39] asks a tier question, then adds "Also, would bundling the service desk with our project management tool cost less than buying it standalone?"
  - pixel [40] asks Pro vs a-series, then adds "36 month financing... or buy outright?"
- **Four-item requirement list:** jira [24] ("backlog, sprints, bug tracking, and lightweight release notes").
- **Writer-supplied pricing mechanics:** jira [37] reads "Paid project management tools bill per seat; annual plans discount vs monthly." That is the writer explaining the setup, not an asker typing.
- **Generic Midrange pricing cell:** pixel [38] ("last year's $600 model on sale for about $450, or a new $400 one") is the budget-pinned Midrange cell, but it is not the brand tier question; the brand tier sits in [40] instead. This is acceptable because a brand-named cell exists.
- **Thin circumstance:** pixel [20] ("first-phone friendly", no age).
- **Executive audience in every business case:** all four jira business_case seeds pitch the CFO, the CIO, or finance.

**Held:**
- no calendar years, label or segment leaks, quote wraps, meta text or malformed fields
- no brand names in blind cells
- all 14 comparisons are neutral and ask for a pick; class cells are clean
- objections are pre-purchase and voice their assigned concern
- churn and renewal state stay-or-go, with no money asks
- offensive alternatives carry no reasons and keep a category anchor; defensive alternatives come from existing customers
- every pricing seed carries usage, and each battery has a brand-named pricing cell
- awareness seeds end in a way-out ask; category_education asks what the product does
- problem_recognition askers do not yet own the product

---

## 4. Verdict

| Battery | Verdict | Gate edit |
| --- | --- | --- |
| **Jira** | **READY after 1 gate edit** | [53]: delete "to something cheaper" (F3) |
| **AmEx** | **READY after 1 gate edit** | [39]: restore s28's 0% intro APR vs annual-fee text (F2) |
| **Pixel** | **READY after 1 gate edit** | [4]: "from iOS to Android" (F1) |

Nothing blocks at S1 or S2. Three one-line edits remain, none of them flagged, so the reviewer needs this list. Once they are made, all three batteries are **READY**.

The three residuals are all regressions of classes that earlier rounds fixed. Each new regeneration re-rolls cells that were already correct and reopens a closed class somewhere. That is the case for closing this round with hand edits at the gate rather than another engine iteration.

For the next tracker:
- replace the directionless-switch blacklist with a positive destination-token check (F1)
- add "cheaper" and alternatives requests on non-price concerns to the mechanical doubt checks (F3)
