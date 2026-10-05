# Stage contract (decided 2026-10-03, Tyler) - DRAFT FOR REVIEW

Every stage answers ONE distinct client question. That question is the source of truth for:
- how the stage's **seeds** are written;
- how its **paraphrases** are checked (they ask the same question in other words);
- how its **answers** are evaluated.

When two stages would answer the same question, that's a merge decision, not a wording fix. Decision record: `DECISIONS_INIT_2026-10-03.md`, decision 5.

**Seed principle for every stage:** a seed reads like a real query - the asker's situation in a few plain words plus the stage's ask.
- 10-35 words is normal.
- Never a wish list of wanted features - the answer decides what matters.
- The only detail beyond the situation is what the stage is about: the ONE capability, the ONE job, or the two or three usage figures.
- No calendar years, no segment vocabulary, no stated prices.

**Row kinds:**
- **Scenario row** - one cell per scenario column; only the buyer's situation changes between cells.
- **Topic row** - one cell per subject (a rival, a worry); circumstance held neutral.

**Brand rule:**
- **blind** = no tracked brand named;
- **names client** = names the client brand only;
- **head-to-head** = names the client and the one rival.

## The grid

| # | Stage | Row kind | Runs when | Who is asking | The client question | Seed must | Seed must never | What varies across cells | Paraphrases must keep | Brand rule | Read (how answers are evaluated) | Question type |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Problem recognition | scenario | considered markets | someone with a pain who isn't shopping for a solution yet - they may own an older or makeshift product, but they are not a current customer of the client voicing a doubt about it | Before buyers know the category exists, does the AI route them to our category? (Secondary: does it already name us?) | describe the pain in the asker's situation and ask for a way out, in any natural wording; invite answers that may name solutions or products | name the category as the fix, name a brand, ask for a product type, come from a client customer doubting the client (that's a worry cell) | the buyer's situation | the pain, the situation, the "how do people fix this" ask | blind | primary: category named as the fix (yes/no); secondary: client named (yes/no) | awareness |
| 2 | Category education | topic, one cell | considered + rational markets | someone learning what this kind of product is | When buyers ask what this kind of product is, are we the example the AI uses? | ask what the category is or does and how people use it | describe something broken, ask which brand, compare tiers | - | the what-is-it ask | blind | client used as an example (yes/no) | awareness |
| 3 | Discovery | scenario | always | a buyer ready to look at options | In this situation, which brands does the AI recommend - are we named, and are we first? | the situation in plain words plus "which ones should I look at / get?" | list wanted features, name a brand, ask "what should I look for" (that's Criteria) | the buyer's situation | the situation and the which-ones ask | blind | **headline**: named, rank, top pick | open choice |
| 4 | Criteria | scenario | always | a buyer working out what matters | What does the AI teach buyers in this situation to value? | the situation plus "what should I look for / what actually matters?" | offer candidate criteria, ask which brand, name a brand | the buyer's situation | the situation and the what-matters ask | blind | criteria taught (coded like reasons): which criteria, and do they favor the client's strengths. **Not** a names score | awareness (needs a criteria read) |
| 5 | Feature screening | scenario | spec markets | a buyer asking feature-first | When buyers ask which product has the best features for their need, does the AI name us? | the situation or need in plain words, then which one has the best features for it | name a specific feature or list features; pick a need because it suits the client; name a brand | the buyer's situation | the situation and the best-features ask | blind | client named when buyers ask feature-first | open choice |
| 6 | Use-case fit | scenario | always | a buyer with one outcome they want | For one thing the buyer wants done, does the AI name us? | the outcome the buyer wants, in their own everyday words with a natural detail, then which one will do that best | name a product feature as the outcome; list several needs; restate the situation; pick an outcome because it suits the client's signature strength; name a brand | the buyer's situation (the outcome fits it) | the situation, the ONE outcome and the which-is-best ask | blind | client named / top pick for the outcome | open choice |
| 7 | Social validation | topic, one cell | always | a buyer looking for social proof | Who does the AI say people actually use and rate well? | ask what people actually use, love or recommend (in feel markets: what people identify with), inviting NAMED brands or products | name a brand, turn into a features list | - | the what-do-people-use ask | blind | which brands the AI calls popular or well-loved. **Measure after wave one:** if its named brands track Discovery's closely, merge it into Discovery | open choice |
| 8 | Comparison | topic, one cell per head-to-head pick (max 4) | always | a buyer weighing two brands | Head to head with each rival we picked, does the AI pick us? | name both brands and ask which one the AI would pick, and why - wording free | add a situation, criteria or usage; become a strengths tour without asking for the pick | the rival | both names and the pick ask | head-to-head | head-to-head win | head-to-head |
| 9 | Premium vs basic / Splurge or save | topic, one cell | habitual markets | a buyer deciding whether premium is worth it | Does the AI say the premium tier is worth it, and which brands sit at the premium vs basic end? | weigh premium makers against basic or store options as a tier and invite named picks | judge one brand's own worth (that's Value or a worry), name a brand | - | the tier question and the named-picks ask | blind | tier verdict, plus brands named at each end | open choice |
| 10 | Objections | topic, one cell per picked worry | considered markets | a prospect with a worry about the client | When a prospect voices a worry about us, does the AI confirm or rebut it? | state the picked worry about the brand, by name, as the asker's own claim - one doubt, with the verdict open either way | become a rules, eligibility or fact lookup ("is that how it is?"), report what others say instead of the asker's own claim, ask to size the problem, ask for a price or the accounting, ask the Value cell's worth-it-over-cheaper question, come from an existing customer ("should I cancel"), add a second worry | the worry | the worry, voiced as a claim the answer can confirm or rebut | names client | doubt verdict: confirms / rebuts. Advocacy's secondary read (a quoted critic) overlaps this by design and is kept separate | doubt |
| 11 | **Value** (formerly Pricing) | scenario | always | a buyer weighing the client's price | Does the AI say we're worth our price over a cheaper alternative, for this buyer? | the room's situation in a few words, then whether the brand's premium line (one per tracker, by its real name; a one-line brand uses its own name) is worth it over "more affordable <category>" - no usage detail (s44); ask for the call | use the brand's own tier as the counterpart, name a rival, state a price, add usage details, presuppose the verdict | the buyer's situation | the brand or its line, the generic counterpart, and the ask for the call | names client | value verdict per buyer type: worth it / not worth it. A room whose circumstance settles the verdict (a hard price cap, a top-tier-only buyer) is flagged at the coverage step so the client picks another line or none | value (new; `within_brand` until built) |
| 12 | Business case | scenario | committee markets | an internal champion | When an internal champion asks the AI to make the case for us, does it build a confident case, or hedge, pile on caveats, or steer to a rival? | a champion in this situation asks for help justifying the brand, by name, to a CFO, procurement or a security review | name a rival, turn into a pricing question | the buyer's situation | the brand, the audience being convinced, the ask for the case | names client | case strength (strong / hedged / undermined) plus rival intrusion | settled customer (scorer to build) |
| 13 | Churn triggers | topic, one cell per picked worry | always (the only worry stance in habitual markets) | an existing customer with a worry | When a customer voices a worry about us, does the AI tell them to stay or to leave? | an existing customer states the worry about the brand, by name, in a way that leaves leaving possible and staying not foreclosed - both options need not be spelled out ('is it still worth it with these price hikes?' qualifies) | foreclose staying (a decision already made to leave), turn into a fix-it or how-to with no option of leaving, offer only two ways of leaving (pause vs cancel), ask for a price | the worry | the worry and the stay-or-leave choice | names client | keep vs leave, plus confirms / rebuts. Trigger: a stated worry (Renewal = the bill coming due; Repertoire = habit and variety) | doubt |
| 14 | Alternatives | topic, one defensive cell + one per head-to-head pick | always | offensive: someone leaving a rival; defensive: an existing client customer | Offensive: when buyers leave a rival, are we the replacement? Defensive: when our customers leave, who does the AI send them to? | offensive: state plainly that the asker is moving off the rival and ask what to get instead - a bare move, wording free; defensive: an existing customer names the brand and asks what else is out there | offensive: give a leave reason, the asker's team or identity, or name the client; defensive: come from a prospect | the rival (offensive); - (defensive) | the bare move and the what-instead ask | offensive: names the rival only; defensive: names client | offensive: client named or picked as the replacement; defensive: who captures our leavers | open choice / doubt |
| 15 | Renewal | topic, one cell per picked worry (where offered) | subscription markets | a customer at the pay-again moment | At the moment the bill comes due, does the AI say we're still worth the price? | an existing customer whose renewal or bill is coming due names the brand and asks whether it's still worth paying for - leaving possible, staying not foreclosed; both options need not be spelled out | drop the keep option, ask for the accounting | the worry | the renewal moment and the keep-or-cancel choice | names client | worth the price at renewal: keep vs cancel. Distinct from Churn triggers by its trigger - the bill coming due, not a worry | doubt |
| 16 | Expansion | topic, one cell | always | a satisfied customer | When a satisfied customer considers using us for more, does the AI back growing with us, or redirect them to a rival or a specialist? | an existing customer names the brand and the specific growth step ("roll it out to marketing", "use it for invoicing too") | name a rival, become a support or fix-it question | - | the brand and the growth step | names client | backs / neutral / redirects, plus who it redirects to | settled customer (scorer to build) |
| 17 | Ecosystem | topic, one cell | always | an existing customer building around the product | What does the AI put around us - our own companions and add-ons, partners, or rivals' products? | an existing customer names the brand and asks what to pair with it for ONE specific need | name a rival, list several needs | - | the brand and the ONE pairing need | names client | share of own vs partner vs rival products recommended; rival intrusion | settled customer (scorer to build) |
| 18 | Advocacy | topic, one cell | always | a customer convincing someone else | When a customer recommends or defends us to someone else, does the AI arm them with a strong case or concede the critic's point? | a customer names the brand and the person they're convincing, often quoting that person's objection | name a rival as the asker's own pick, become a how-to | - | the brand, the person being convinced, the quoted objection | names client | primary: case strength - does the AI equip the customer to win the argument (strong / partial / concedes). Secondary: confirms / rebuts when a critic is quoted (the Objections read, kept separate) | settled customer (scorer to build) |
| 19 | Repertoire | topic, one cell | replenishment markets | a habitual buyer of the client | When a habitual buyer considers switching from their usual, does the AI keep them with us? | a buyer who usually picks the brand names it and asks whether to stick with it or try something else | name a rival, drop the stick option | - | the habit and the stick-or-switch choice | names client | keep vs switch. Distinct from Churn triggers by its trigger - habit and wanting variety, not a worry | doubt |

## Retired, optional and pending

- **Retired:**
  - Shortlist - merged into Discovery (decision 2).
  - Problem resolution - out until more R&D (2026-10-02).
- **Optional, not built: Tier pick.** "Which of our tiers does the AI steer each buyer to?" The Value row's companion for brands with tiers (Netflix plans, Jira editions, AmEx cards, Pixel vs Pro). Off by default; topic row, names client.
- **Settled-customer stages** (Business case, Expansion, Ecosystem, Advocacy) stay in the default grid and are collected now. No scorer exists yet (the group-3 workstream). If an adequate scorer can't be built, they default to off.

## What review should settle

1. Each row's client question - is it the one you want answered?
2. Each "Read" column - is that what the dashboard should show for the stage?
3. Any row whose question still overlaps another.

## Refinements applied (Tyler, 2026-10-03)

- **Feature screening and Use-case fit:** the capability or job is one buyers in the category or situation commonly ask about, never one chosen because it suits the client. Pixel's feature screen had picked "fastest OS updates", its own lead strength, which nearly answered "are we included?" by construction.
- **Problem recognition:** the primary read is category routing; the brand being named is secondary, since pre-category answers rarely name brands.
- **Renewal:** sharpened to the bill-coming-due moment. It is distinct from Churn triggers (a worry) and Repertoire (habit) by its trigger, though all three end in keep vs leave.
- **Advocacy:** the primary read is case strength. The confirms / rebuts read on a quoted critic is secondary and overlaps Objections.
- **Social validation:** kept for now and measured after wave one. If its named brands track Discovery's closely, it merges into Discovery.
- **Seed wording (applied the same day):**
  - The contract describes the elements a seed needs, never a quoted shape. A quoted shape becomes every tracker's literal wording.
  - Value usage is in plain words; numbers are allowed but not required.
  - A stage scored on names (Social validation, Problem recognition's secondary read) asks in a way that invites names.
  - Churn and Renewal keep leaving possible and staying unforeclosed, without a fixed both-options phrasing.

## Engine conformance (2026-10-03, STYLE s32)

Each stage's seed is shaped by four engine sources:
- its **hint** (`stageLibrary`, which also feeds the paraphrase writer);
- the seed **writer's rules** (`CELL_WRITER_SYSTEM`);
- the **seed check** (`stageDesignIntent`);
- the **paraphrase check** (`seedDesignLine`).

All four were reviewed against this contract and aligned.

| Stage | What changed to conform |
| --- | --- |
| Problem recognition | Quoted closings removed ("ask for a way out in their own words, varied"). The asker is "not a current customer of the client doubting it" instead of "doesn't own this kind of product" (phones: everyone owns one). |
| Category education | already conformant |
| Discovery | Hint loses its quoted "best X for ..." shape (situation + which-ones ask, no criteria list). |
| Criteria | Writer and seed check: never offer candidate criteria for the answer to rank. |
| Feature screening | Hint, writer and seed check (s39): the need in plain words plus "which has the best features"; a named feature or a feature list fails. |
| Use-case fit | Hint, writer and seed check: ONE commonly needed job, never chosen for the client; a list of needs fails. |
| Social validation | Hint: invites named brands or products. |
| Comparison | Writer: quoted shape replaced by elements (names both brands, asks which to pick, wording free). Hint matches; dupe framing allowed in taste markets if it asks for the pick. |
| Premium vs basic / Splurge or save | already conformant |
| Objections | Hint voices the planned worry as the prospect's own claim. |
| Value | Writer, hint, seed check and paraphrase check: a GENERIC cheaper alternative only (never the brand's own tier), usage in plain words (numbers allowed, not required), and which product when the brand sells several. |
| Business case | Hint, writer and seed check: a champion justifying the brand to a CFO, procurement or security; no rival, no pricing turn. |
| Churn triggers | Writer and both checks: leaving possible, staying not foreclosed, no fixed both-options closing; the trigger is the worry. |
| Alternatives | already conformant (the writer's examples are marked "a shape, not a sentence to copy") |
| Renewal | Hint loses "are there cheaper options". Writer and both checks: the trigger is the bill coming due; same leave and stay rule as Churn. |
| Expansion | Hint, writer and both checks: ONE growth step; no rival, no support ask. |
| Ecosystem | Hint, writer and both checks: ONE pairing need. |
| Advocacy | Hint, writer and both checks: names the person being convinced, often quoting their objection. |
| Repertoire | Writer: removed from the worry-cell rules. Both checks: its own habit design (stick or try something else), not a worry. |

**Not yet aligned, and outside the writer:**
- Criteria's read (criteria taught) and Value's question type need evaluation-side work.
- The settled-customer scorer doesn't exist yet.
- The label "Pricing / value" still shows in the UI; the rename to "Value" is not done.

## Feature screening and Use-case fit are formulaic (Tyler, 2026-10-04, STYLE s39)

Both stages ask in plain buyer words and read which brands come up:
- **Feature screening** asks feature-first: the buyer's need, then which one has the best features for it. The answer decides which features matter.
- **Use-case fit** gives the outcome the buyer wants, in everyday words, then asks which one will do that best.

Some overlap between the two, and with Discovery, is fine: it is the same buyer asked two different ways, to see how the engines respond. The earlier "ONE checkable capability" design was dropped (people filter on jobs and needs, not capabilities), and with it the s38 capability planner.

## Problem recognition is one plain pain (Tyler, 2026-10-04, STYLE s40)

One pain in a plain sentence, then a plain ask for a way out: about 10-25 words, one symptom, never a list of symptoms or a polished description.

## Category education asks what kinds there are (Tyler, 2026-10-04, STYLE s41)

The buyer asks what kinds of products the category has and how they differ, or whether they need one at all, in plain words - never which brand. Recommended for every considered market (was: considered and rational). Read unchanged: whether the AI names the brand when it explains the category.

## Value, Social validation and Premium vs basic in short buyer formulas (Tyler, 2026-10-04, STYLE s42)

- **Value:** the situation in a few words, then "is <brand or its line> worth it over <counterpart>?", with at most one usage detail, about 12-25 words. The counterpart is the next tier down from the brand's line in the category, described by tier or price level, never by name. The cheapest option only when the line sits one step above it (store-brand chips vs Doritos is right; the bottom of the phone market vs a flagship is not).
- **Social validation:** which <category> do people love, recommend or swear by most, optionally saying who, about 8-15 words. Never asks for ratings, reviews or communities.
- **Premium vs basic:** are the premium options actually better than the cheaper ones, or are the cheaper ones good enough, about 10-18 words. Never asks for picks on each side; the answer names brands on its own.

## Value names a premium line against "more affordable" (Tyler, 2026-10-04, STYLE s44)

- **Formula:** the room's situation in a few words, then "is <line> worth it over a more affordable <category>?" No usage detail.
- **Line:** the brand's most premium line that its audience can buy, one per tracker, by its real name. Plans, flavors, sizes and varieties are never lines (a one-product brand uses its own name). A "premium line" aimed at a different buyer than the audience, or that is only a variant, falls back to the tracked brand name. Read three times, majority wins.
- **Counterpart:** "more affordable <category>", set in code. The answer engine decides what more affordable means for that buyer. (Asking the model for the tier below a line was unstable: it sorted phones by shape and put a premium card against its own tier.)
- **Gate:** the coverage step shows each column's pair under the Value row; the client can change either end or set "none" for a room.

## Seed review batch (2026-10-04, SEED_RULES r17, STYLE s46)

Twelve problems from the five-draft seed review, evaluated row by row against this contract (`~/Documents/procerno_eval/init_audit_2026-10-04/SEEDS_FIX_PLAN_2026-10-04.md`). Built: doubt cells are the asker's own one-doubt claim with an open verdict (row 10 wording above); the stance decides the asker; worry stances follow the base journey (row 13: churn is the only stance in habitual markets) and worry rows carry no reach limit; one doubt per worry with overlap groups at the gate; problem recognition carries no purchase moment (ownership of an older product stays allowed, row 1); use-case outcomes are judged across the battery (row 6: no attribute, no situation restated, no client strength); head-to-heads add no situation (row 8); offensive alternatives state a full-sentence move within the category (row 14); advocacy convinces a peer or critic, business case an approver (rows 12 and 18); the Value check branches when the line is the brand name (s44); Value room fit chip (row 11); other-parent head-to-head pre-pick (decision 3c); and the writer now receives each room's description as circumstance only. Withdrawn against the contract: a per-column overlap check (s39 allows it), a fixed class template (row 8 is wording free), and keeping advocacy off picked worries (row 18 quotes the critic by design).

