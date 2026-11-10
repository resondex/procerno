# Stations: the reasons and decision-rules sections - consistency options

2026-11-09, for Tyler's morning read. Task: "look at the reasons and decision rule sections in stations, we need
to make it consistent with the rest of the dashboard. give me options for a wholistic perspective that balances
all the sections needs and parsimony." Nothing here is built; the citation fix (task 1) is a separate commit.

## What "consistent" means now - the grammar the rest of the dashboard settled on

Option D (2026-11-09, am13/do6) left the dashboard with ONE grammar for reasons wherever a customer reads them:

1. **One vocabulary**: the dt4 THEMES (reason_themes.ts) - model-labeled theme rows over the run's condition
   groups, shared through one llm_cache entry, so the Map's position panels and the Rivals dossiers say the same
   words for the same data.
2. **One list shape**: `ReasonList` (view_parts.tsx) - theme label, Fig share bar, ANSWER-GRAIN share of the
   cell ("Each share is of the answers here where..."), situation expanders, wall chips, a "See every reason"
   fold to the flat list, per-column flat fallback (the doubt cells' "Sent to X" exit lines).
3. **One panel grammar**: crumb / claim / The numbers / The arguments / The reasons / The receipts - receipts
   open the answer reader with the quote highlighted.
4. **Lay language**: "reasons", never "conditions", on customer surfaces (the 2026-11-09 naming sweep,
   am14/bs12/bf19); counts in tooltips, never in visible text.
5. **The analyst escape hatch**: the full decision-rules explorer (rules_view.tsx) mounts inside the Map's
   pooled open-choice position panel; Build a table is the free-form tier.

## What Stations does instead - the inventory

| Surface | File | What it shows | Where it diverges |
| --- | --- | --- | --- |
| ConditionsBlock ("When the pick goes your way") | journey_view.tsx:295-335; data journey.ts conditionsOf / roomConditionsOf | Top 3 win / top 3 lose, raw rule-group labels, inline answer counts, ASCII `->` routes | Says "conditions" (missed the naming sweep); RAW group labels, not themes - a different vocabulary than the Map one pill over; counts inline (the old carve-out) where the panels found the honest share denominator; no fold, no receipts, no path to the full read - a dead end |
| ArgumentsBlock ("The arguments behind it") | journey_view.tsx:262-293; data journey.ts argumentsOf | Up to 4 codes, for-you / against chips, "argued in X% when named, Y% when not" | A third format for argument lift (the Map panel draws liftLine bars, the Brief prints "+N points"); cap 4 with no fold; no link to the full reasons table sitting two blocks below |
| ReasonsSection (full table) | reasons_view.tsx, mounted per station with scoped types | Sortable reason x verdict rate table, gap column, group rollup toggle | Right tier (analyst inventory), wrong idioms: a `<select>` for question type where every sibling control is chips (panel, buyer bar, rules pools); otherwise fine |
| (absent) | - | - | From Stations there is NO route to the full rules explorer or to a panel with receipts; the Map has both |

The root cause is historical: the station blocks shipped 2026-11-03 with the analysis tier; the theme vocabulary,
ReasonList and the receipts grammar shipped 2026-11-07..09 on the Map/Rivals side and never reached Stations.

## The options

### Option A - vocabulary sweep only (one evening, no engine change)

Rename "conditions" to "reasons" in the station blocks, fix `->` to the panels' route styling, restate the
ArgumentsBlock line in the liftLine wording, swap the ReasonsSection `<select>` for chips. All client-side
strings (the block titles live in journey_view.tsx; journey.ts's argumentLabels stay), so NO version bump, no
warm, zero spend.

- Buys: the naming sweep finishes; no two surfaces disagree on words for the same concept.
- Leaves: the two-VOCABULARY problem (raw group labels in Stations vs themes in the Map), the dead end, the
  third lift format's structure, inline counts.
- Verdict: honest minimum, but a buyer filter click away from the Map still shows different words for the same
  rules. Not the holistic answer on its own.

### Option B - the station blocks adopt the panel grammar (recommended)

Make the station's reasons/arguments blocks the SAME components the Map panel uses, scoped to the station:

- **ConditionsBlock becomes a ReasonList pair** (You win when / You lose when): the run's dt4 theme assignment
  already maps every condition-group label to a theme, and `themeTree` takes a filter - station scoping is
  filtering the rules capture by the station's pools (journey.ts already knows them: STATION_POOLS). So the
  station speaks the EXACT theme labels the Map speaks, with Fig bars, answer-grain shares, the "See every
  reason" fold to the flat labels (which restores today's raw-label detail one click deep, routes included),
  and the flat fallback for a side with no themes. **Zero new model calls**: the theme call's inputs are the
  run-wide poolInputs the Map already pays - byte-identical inputs, same llm_cache key, cache hit.
- **ArgumentsBlock renders liftLine** (the Map panel's bars + "X% of its picks, Y% of other picks") instead of
  its own chip format - same numbers, one format everywhere. Keep the for-you / against coloring.
- **Receipts**: each theme row carries the sample ids the rules capture already holds (rules_view's Evidence
  hand-off pattern); clicking opens the existing answers reader. The dead end closes without inventing a new
  panel.
- **ReasonsSection**: chips for question type, header copy aligned; otherwise untouched - it stays the analyst
  inventory tier under "Full tables", which is a NEED the panel grammar does not cover (sortable verdict
  columns, the gap read, CSV). Build a table stays the free-form tier.
- Cost: journey view version bump (j4 -> j5; conditions in the payload become themed rows + flat lists), one
  warm_views run after push, ~2 files of engine work + the view. Nothing embeds journey, so no fold ride.
- Risk to flag: a station pools several cells, and the dt4 themes were labeled from run-wide inputs - a theme
  that reads naturally on the open-choice cell may read oddly filtered to, say, the doubts station's pools.
  The flat fallback catches a station whose filtered side has no themed groups; a spot-read of the doubts and
  customer stations on the fixture is the acceptance check.

### Option C - one renderer: stations point at pooled position panels

The extreme parsimony version: strip the station's three blocks to a heading + two or three summary lines, and
route "the reasons" to a position panel per station - the Map's panel grammar as the ONLY deep renderer
anywhere. The ReasonsSection table leaves Stations (survives only inside Build a table presets).

- Buys: one renderer, one grammar, the smallest total surface.
- Costs: the Map has pooled positions only where pooled cells exist (chooses:open:all); the doubts and
  customer-base stations pool MANY worry cells with no pooled position - option C has to invent per-station
  pooled positions in the map engine (am bump, new position construction, new tension/claim templates), which
  is MORE engine work than B, not less. And it demotes Stations from "Analysis home where every collected cell
  has a home" (the ratified 2026-11-01 design) to a router - a design reversal, not a consistency fix.
- Verdict: parsimonious in renderers, expensive in engine and in design churn. Only worth it if you want to
  revisit what Stations IS, which is a bigger question than this task.

## Recommendation

**B, with A's sweep folded in** (A is a subset of B). The holistic principle it lands on:

- **Glance tier** (station blocks, map cells): theme vocabulary, ReasonList, lay language - one grammar.
- **Deep tier** (position panels, dossier panel): same vocabulary plus receipts - already done.
- **Analyst tier** (ReasonsSection table, rules explorer, Build a table): tables with chips, counts in tips,
  CSV - kept, because the panel grammar deliberately does not carry verdict columns or sorting.

Each tier keeps its job; the vocabulary and the words are the same at every tier; every glance has a one-click
path to its deep read. B is roughly one Opus-agent build: journey.ts themed conditions (reuse sharedRules +
the cached theme assignment), journey_view block swaps to shared components, reasons_view chips, j5 bump,
fixture walk, warm.

Not in scope here, recorded so it is not lost: the station blocks' "arguments" and the per-type sections below
them state overlapping numbers in different bases (station-scoped vs type-scoped) - that is by design (the
blocks are the station rollup), but B should add the blocks' one-line base notes so the two never read as a
contradiction.
