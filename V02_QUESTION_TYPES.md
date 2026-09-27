# Question-type table - draft for Tyler's review (2026-09-27)

One declared type per cell, from a closed set of six. Each type has one fixed recipe: which fields get read, which dashboard view shows it, whether it feeds the headline. This consolidates decisions already made (presentation rule, scoring split, visibility-only awareness, A3, the doubt design, B10) into one lookup table; the only genuinely new commitments are the type field itself and the per-cell assignments below.

## 1. The six types

| type | question shape | headline? | dashboard view | fields read |
| --- | --- | --- | --- | --- |
| **open_choice** | No brand named; the buyer asks the market ("best X for...") | **YES** - win / pick / visibility | Headline funnel | outcome, top_pick (dictionary-resolved, B6c), in-category flag (B5), reasons, mentions, prices/specs, gives_recommendation, clarification |
| **head_to_head** | A rival is named ("AmEx vs Chase", "similar to X but cheaper") | no | Prompted win rate, reported separately | outcome, top_pick, reasons, per-brand framing/roles |
| **within_brand** | The brand's own products or tiers ("Gold vs Platinum") | no | Product mix + rival intrusion + reasons | mentions (roles - see dependency 2), reasons; outcome never reported as a win |
| **doubt** | Voices or quotes a concern about the brand, incl. keep-or-leave (churn, renewal, defensive alternatives) | no | Doubt confirmed / rebutted; keep vs leave; later defend / concede / redirect | premise_verdict + premise_quote, outcome (as keep/leave), reasons |
| **awareness** | Pre-category pain or category education; no pick requested | visibility only | Brand-named rate (+ how often the AI already points to products) | mentions only |
| **settled_customer** | The customer already has the brand; relationship, not choice | no | Own scorer + views (group-3 workstream, after v0.2) | outside the coder; answers stay out of core metrics and v0.2 training |

## 2. Stage -> default type (all 21 stages)

| layer | stage | default type | note |
| --- | --- | --- | --- |
| awareness | problem_recognition | awareness | decided (visibility-only rule) |
| awareness | category_education | awareness | decided |
| awareness | discovery | open_choice | |
| consideration | shortlist | open_choice | |
| consideration | criteria | awareness | DECIDED 2026-09-27 (Tyler) |
| consideration | feature_screening | open_choice | |
| consideration | use_case | open_choice | |
| consideration | social_validation | open_choice | |
| decision | comparison | head_to_head | |
| decision | premium_worth | open_choice | DECIDED 2026-09-27 (Tyler); dropped from doubt stages per A3 narrowing |
| decision | objections | doubt | must name the brand (already the rule) |
| decision | pricing | **per-cell** | target-tier cells = within_brand; B10-flagged doubt cells (17) = doubt; generic category cells = open_choice |
| decision | business_case | settled_customer | DECIDED 2026-09-27 (Tyler) |
| retention | churn_triggers | doubt (keep-or-leave) | A3: must name the brand |
| retention | alternatives | **per-cell** | defensive ("alternatives to [target]") = doubt keep-or-leave; offensive ("alternatives to [rival]") = open_choice with a prompted-rival annotation - DECIDED 2026-09-27 (Tyler); B10 flagged 16 |
| retention | renewal | doubt (keep-or-leave) | A3: must name the brand |
| retention | problem_resolution | settled_customer | decided (scoring split) |
| loyalty | expansion | settled_customer | decided |
| loyalty | ecosystem | settled_customer | decided |
| loyalty | advocacy | **per-cell** | critic-quoting cells (22 of 40) = doubt; the rest = settled_customer - already how question_designs.json splits them |
| loyalty | repertoire | doubt (keep-or-leave) | DECIDED 2026-09-27 (Tyler); it is renewal for replenishment markets |

The instrument's existing `tag` field (rules / picks / judges / steers) is a proto-typology but does not align (alternatives is tagged picks though its defensive cells are keep-or-leave; pricing is tagged judges though its cells split three ways). The type is a new per-cell field, not a tag rename.

## 3. Assignment mechanics

- **Set at design time, per CELL** - the doubt-design precedent: per-answer detection failed twice, cell-level declaration got 0 false positives. The stage supplies the default; the cell can override; pricing, alternatives, and advocacy are intrinsically per-cell.
- **Mechanical where possible**: alternatives defensive vs offensive = which brand the cell names; pricing within_brand vs generic = whether the cell names the target or its tiers. Only genuinely ambiguous cells need a judgment at setup time.
- **Coder schema unchanged.** The type rides into the labeling prompt only where it changes a rule - today that is only doubt (the design line, already shipped). The type is stored on the prompt/cell and joined at metrics time; for the four bootstrapped trackers it can extend `question_designs.json` now, and the instrument writes it for new trackers.
- **The 39 B10 prompts** are per-cell overrides into doubt (they get design lines at the freeze).

## 4. Hard dependencies

1. **Design-fidelity lint (to-do, now load-bearing).** A paraphrase that drifts off its cell's design makes the declared type silently wrong at the answer level - measured 21/410 on doubt prompts, including one entire jira cell. Under this design that failure mode applies to every type, so the lint ships with the type field, not after it.
2. **B7 - RESOLVED 2026-09-27 (Tyler): no labeled role field.** branch_winner failed its accuracy bar (94.1% stability, and stable only when coupled to outcome); the surviving role set (chosen/shortlisted/mentioned/warned_against) is fully derivable from per-mention framing + top_pick + outcome with dictionary resolution, so roles are computed at read time. within_brand's product-mix view reads the derived roles; the labeling prompt is unchanged.
3. **B2 - computed at read time** (recorded 2026-09-27, Tyler veto open): recommended/criticized derived from the target's mention framings via the dictionary (identity measured 100%/97% in the B2 arm). No labeled brand-level booleans; the tightened "criticized" wording moves to the per-mention negative rule (~$5 retest pending).
4. **Dictionary-resolved top_pick (B6c)** - decided, read-time; open_choice and head_to_head both require it.
5. **B5 in-category flag** - orthogonal to the type; applies inside open_choice.

## 5. Mapping calls - ALL DECIDED 2026-09-27 (Tyler, per the recommendations)

1. criteria -> awareness. 2. premium_worth -> open_choice. 3. business_case -> settled_customer. 4. repertoire -> doubt keep-or-leave. 5. offensive alternatives -> open_choice with a prompted-rival annotation.

## 6. v0.2 impact

- No new labeled field; no prompt change beyond what the doubt design already does. The type table does not delay the freeze - it only requires the per-cell assignments (section 2 defaults + the pricing/alternatives/advocacy cell splits, most of which question_designs.json and the B10 check already computed).
- The relabel does not wait on the dashboard views; the views do not wait on the relabel. Setup-tool work (type field + lint) and dashboard work (one view per type, replacing the pooled branded row) can run in parallel with labeling.
