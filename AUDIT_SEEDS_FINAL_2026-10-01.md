# Seed audit, final (r8/r9 convergence) - Jira, American Express, Google Pixel (2026-10-01)

**Scope.**
- All 165 seeds. `seedFlags` is null everywhere and every angle field is valid.
- I diffed the batteries against the s29 state. Six cells changed: jira [53], amex [39] and [41], pixel [4] and [40], and the cached remainder, which is byte-identical to s29.
- I read every changed cell against the full contract set. The 159 unchanged seeds carry their s29 sweep.

**Severity key.**
- **S1**: ship-blocker.
- **S2**: high.
- **S3**: medium (fix at the gate).
- **S4**: low.

---

## 1. s29 findings

| Item | Verdict | Evidence |
| --- | --- | --- |
| F1: pixel [4] gives no switch direction | **FIXED** | "moving from iOS to Android and I'm freaking out about losing stuff..." All seven Platform-switcher seeds now state iOS to Android. |
| F2: all four AmEx pricing cells are one price-level class | **FIXED** (see section 2) | [39] and [41] now weigh a 0% intro APR card against a rewards card. |
| F3: jira [53] has a "cheaper" bolt-on | **FIXED** | "Our Jira renewal is up soon. I'm uneasy about the roadmap and how locked-in we are with workflows and data. Do we stick another term, or is it time to move off?" The seed stays on its concern, states stay-or-go, and names the brand once. |

## 2. AmEx pricing against the s23 ruling

| Cell | Scenario | Trade-off |
| --- | --- | --- |
| [38] (within_brand) | Business | Price level: "With American Express, stick to a no-fee card or is paying around 350 a year worth it" |
| [40] (within_brand) | Premium travel | Price level: "American Express Platinum at $695 worth it over Gold at $250" |
| [39] | Replace everyday | Financing vs rewards: "would a 0% intro APR card beat a higher-rewards card with no promo?" |
| [41] | First card | Financing vs rewards: "start with a 0% intro APR card, or skip that for higher ongoing cash back?" |

The four cells cover two structures, two cells each. In each pair the two cells sit in different scenarios, and both structures are central to the category.

**Within the ruling**, on the same terms as Jira in s27 and Pixel in s28. The fee-level class that dominated every earlier round is down to the brand's own two tier questions.

S4 note on [41]: a first-time applicant rarely qualifies for a 0% intro APR card. That is a realism wrinkle, and the answer can say so; it is not a design defect.

## 3. S3 finding (CLOSED in r10 - see section 5)

**F1 [S3] pixel [40] (Platform switcher, within_brand, the battery's only brand-named pricing cell): four trade-offs in one seed.**

The seed: "...Better value: regular Pixel or Pixel Pro? 256 vs 128 with cloud? Also new vs certified refurb, and is carrier financing smarter than paying upfront?"

The problems:
- **Too many asks.** That is four separate decisions (tier, storage, new vs refurbished, financing vs upfront). The limit is two or three asks per seed (J18), and the answer will split across all four.
- **Duplicated shapes.** Three of the four repeat shapes the other Pixel pricing cells already own: [37] carrier vs unlocked, [38] older-discounted vs new, and [39] finance vs outright.
- **Diluted within-brand read.** The Pixel tier question, which this cell exists to measure, becomes one clause among four.
- **Introduced this round.** The convergence drive produced it, and nothing flagged it.

**Gate fix:** "Switching from iOS to Android, looking at Google Pixel. I keep phones about 4 years, take around 300 photos a month, and my 128 GB is nearly full. Better value for me: the regular Pixel or the Pixel Pro?"

No S1 or S2 findings.

## 4. S4 (polish, does not block)

- pixel [4] ends on two asks, the second a stamped "what really fixes this?".
- The s29 S4 list carries over unchanged:
  - jira [39]: two questions in one seed.
  - jira [24]: a four-item list.
  - jira [37]: the writer explains the billing mechanics.
  - pixel [20]: thin circumstance.
  - Every jira business-case seed is pitched to an executive.

**Held across all three batteries:**
- No calendar years, label or segment leaks, quote wraps, meta text or malformed fields.
- No brand names in blind cells.
- All 14 comparisons are neutral and ask for a pick. Class cells are clean.
- Objections are pre-purchase and on-concern.
- Churn and renewal state stay-or-go, with no money asks or "cheaper" bolt-ons.
- Alternatives:
  - Offensive alternatives carry no reasons and keep the category anchor.
  - Defensive alternatives are existing customers.
- Switches are directional, toward the client's side.
- Pricing:
  - Every pricing seed carries usage.
  - Each battery has a brand-named pricing cell.
  - Trade-off shapes stay within the ruling.
- Awareness and education stages:
  - Awareness seeds end in a way-out ask.
  - Problem_recognition askers do not yet own the product.
  - Category_education asks what the product does.

## 5. Verdict

**Update (r10, 2026-10-02): pixel [40] re-rolled. F1 is CLOSED.**

I diffed r10 against the audited state. Only pixel [40] changed; the other 164 seeds are byte-identical, and `seedFlags` is null everywhere.

The new seed: "Switching from iOS to Android. Keep phones 3 years, shoot about 2 hours of video a month, and usually fill 100-120 GB. For Pixel, is the A-series around 450 good enough, or is it worth paying about 800 for the regular one? Buy outright or finance over 24 months - what works out better?"

**It passes:**
- **Ask count is within the limit.** It asks two things: the brand tier (A-series vs regular Pixel) and outright vs financing.
- **It meets the pricing contract.**
  - The brand is named, so it is the battery's within-brand pricing cell.
  - The asker's usage is the input (3-year hold, video, 100-120 GB).
  - The verdict is left to the answer.
- **The switch is directional, toward the client's side.**
- **The tier question leads again.**

One S4 note: the financing clause shares [39]'s finance-vs-outright shape. Here it is secondary to the tier question, and it falls under the s23 two-instance allowance, so it does not block.

| Battery | Verdict |
| --- | --- |
| **Jira** | **READY** |
| **AmEx** | **READY** |
| **Pixel** | **READY** |

There are no S1, S2 or S3 findings in any battery, and nothing needs a gate edit. All three batteries are **READY for collection**. The S4 items in section 4 are optional polish.
