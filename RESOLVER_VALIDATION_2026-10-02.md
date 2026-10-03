# Brand resolver validation (2026-10-02)

**Question.** Can the design check's existing call also report four facts:
- the brands a question names (resolved mechanically by `brand_resolver`);
- whether it states a price;
- whether it remarks on money;
- whether it rules the client out?

The goal is to replace the string checks for those four jobs at no extra cost.

**Answer.**
- **Not in the same call.** The extra fields made the main design judgment more lenient.
- **The resolver design holds up.** Brand detection and money remarks beat the string checks, and the anti-hallucination guard worked as intended.
- **Stated price** needs a contract decision before either path can be scored cleanly.

## Run

| | |
| --- | --- |
| Harness | `scripts/resolver_validation.mts` (batch phases), Anthropic Batch API, local store only |
| Corpus | 6,329 texts assembled, 3,606 selected: 80 fleet cases (out-of-sample rosters, `scripts/fixtures/resolver_fleet_cases.json`), 112 rejected, 1,359 walk seeds, 1,305 live-battery prompts, 750 older walk seeds. Every text that names a roster word or money was kept; a seeded random sample was taken of the rest. |
| Arms | **A:** extended prompt (V2), sonnet-5 low, on all 3,606. **V1:** current prompt on a random 600 subset. **B:** V2 at sonnet default effort on 500 walk seeds. |
| Truth | Opus 5.5 (medium) on all 97 old/new disagreements, a seeded random 300 of the 3,509 agreements, and all 80 fleet cases (470 unique). |
| Spend | **$12.37** ($11.36 design arms + $1.01 adjudication; batch half price; the live estimate was ~$50) |
| Scoring | Scored on the RESOLVED output: model-listed names, then a bounded-phrase check, then matchKey / coRefers against name forms and dictionary aliases. Never on the raw list. |

## Results vs adjudicated truth

| stratum | path | brands named (exact set) | states price | money bolt-on | target-leak misses |
| --- | --- | --- | --- | --- | --- |
| disagreements (97) | strings | 80 | 78 | 64 | 1 |
| | resolver | **94** | 73 | **94** | **0** |
| agreement sample (300 of 3,509) | strings | 297 | 299 | 295 | 0 |
| | resolver | 297 | 299 | 295 | 0 |
| fleet (73 not already in the disagreements) | strings | 69 | 71 | 73 | 1 |
| | resolver | 69 | 71 | 73 | 1 |

- **excludes_client** (resolver only): 88 of 92 on feature screens and fleet cases.
- **Shared misses.** The 3 shared brand "errors" in the agreement sample are all Opus counting "from iOS to Android" as naming Apple iPhone. The switch-direction contract *requires* platform words in blind cells, so these are not errors. Estimated shared brand misses across all agreements: about 0.

### Where each brand path failed

**Strings, on 17 disagreements:**
- 9 near-identical Pixel battery prompts: "Google" in "Google Play Services" read as Google Pixel.
- Everyday words: lowercase "purple" (the color), "a nectar of the gods", "my garden is in full bloom".
- Lowercase coined names it missed: "nest thermostat", "ritual's multivitamin", "is epic overkill".

**Resolver, on 3:**
- "an iPhone fan": the model did not list it.
- "Had Pixels for a while": a plural-resolution bug, **fixed**.
- One iOS row: the contract case above, not an error.

**The anti-hallucination guard worked as designed.** The model listed "Google Pixel" on Play Services prompts that never say it. The bounded-phrase check discarded every one, so the resolver was right where the strings were wrong.

**Shared fleet misses (both paths):**
- Lowercase "thinking ring or something else" for Ring: the model missed it.
- "something like an oracle": the model over-listed it as Oracle Health.
- "athena" and "athenaOne": the alias set lacked athenahealth's short name and product. The one target-leak miss is here: an athenaOne pricing seed typed generic.

### Stated price: a contract question, not a checker question

The two paths fail in opposite directions:

| path | failure mode | examples |
| --- | --- | --- |
| resolver | over-calls the asker's own figures and offers | "my carrier has it at 25 a month", "I can grab a refurbished flagship for about $500" |
| strings | misses class-level fee statements | "is the $95 fee version worth it", "fee near 550" |

Opus treats a class-level fee as a stated price; earlier audits treated it as S4 at most. The rule needs a decision, at least:
- Is a fee attached to a product class ("a $95-fee airline card") a stated price?
- Does an offer the asker describes in the third person count?

## The decisive finding: the extra fields shift the design judgment

The same 600 texts were run under the current prompt (V1) and the extended one (V2). `voices_design` agreed on 563 (93.8%). Of the 37 flips:
- **V2 passed 33 that V1 rejected;**
- V1 passed 4 that V2 rejected.

A 33-to-4 split is a systematic lean toward leniency, not noise. Several of the 33 are rejections the current checker gets right:
- "does American Express require pricey employee card fees…", an objection voiced as a lookup;
- "what are Netflix's current prices for ad tier, ad free, and 4K", a price lookup in a pricing cell.

The 99.2% validation of the design check does not survive four extra tasks in the same prompt.

## Arm B (default effort, seeds)

On the 61 adjudicated seeds:
- brands: 61/61 at both low and default effort;
- stated price: default better on 4, worse on 1.

A stronger seed tier buys nothing for brand detection. It may help price detection once that contract is settled.

## Recommendation

1. **Keep the design check exactly as it is** (V1). Do not add fields to it.
2. **Move the facts into their own call.** Ask a separate fact-extraction prompt for `brands_named`, `money_remark` and `excludes_client`, resolved by `brand_resolver`.
   - This costs one extra call per text, so it is not free.
   - Brand listing is extraction, so a cheaper model (haiku-4-5 or gpt-6-luna) may do. Validate that with the same harness (about $3-6 on batch) before shadow mode.
3. **Stated price:** keep the string check until the contract questions above are decided, then re-score both paths.
4. **Aliases at setup should include short names and product names** ("athena", "athenaOne"). The alias prompt currently asks only for "genuinely equivalent names".
5. **Shadow-mode exit (set before it starts):**
   - through the first three fleet bootstraps, every new/old disagreement adjudicated;
   - zero adjudicated target-leak misses by the resolver;
   - resolver accuracy at or above the strings on each field it replaces;
   - then delete the string brand stack.
