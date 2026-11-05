# The Brief pill (2026-11-04, Tyler's spec)

Tyler's directives, verbatim scope:
1. The codes-era primary pills become **The Verdict / The Map / The Brief / The Portfolio**.
2. The Brief holds seven selectable memo frames - **Now what? (default), SWOT, TOWS, Funnel, Visibility-conversion, Jobs-to-be-done, Minto** - via a dropdown.
3. The reader can also select the **brand** the memo is about and the **engines** it is computed on (the existing Panel lens); the memo view updates.
4. Every memo is **downloadable as a PDF**.
5. **Language rule, for all briefs AND the Verdict pill**: percentages only, no "x of y", no base sizes, no method terms ("open-choice questions" is banned) - plain speech for a Fortune 500 CEO. Counts survive only in hover tooltips (the recorded less-n rule), never in print.
6. **The two pick numbers are harmonized** (Tyler: "we often toggle between references of pick % based to all and based to only those prompts with picks, it's confusing at the topline").

## The two pick numbers - the convention

Fixed names, fixed jobs, everywhere (briefs, Verdict, scoreboards; analyst tools keep their precision but adopt the names):

- **Picked** = the brand is the AI's answer, as a share of ALL answers. The volume read. Use it for the brand's own funnel and for wave-over-wave tracking - it moves when hedging moves, which the brand should see.
- **Share of picks** = of the answers where the AI commits to one product, the share that land on the brand. The competitive read. Use it for EVERY brand-vs-brand comparison (leaderboards, the matrix, who takes a buying situation) - hedges are no one's win, so they are excluded when comparing.
- **The bridge**: the AI commits to a single product in X% of answers (the commit rate). Picked = commit rate x share of picks. Whenever both pick numbers appear together, the commit rate appears once between them so the reader sees why they differ. Template for the topline: "The AI commits to one card in 44% of answers. When it does, American Express is the pick 15% of the time - 6.7% of all answers."
- Banned words for these: "share of decided", "chosen", "firm in-category pick", "decided picks". The in-category rule (B5) still governs the computation; it is never named in the text.
- Rule of thumb the templates follow: compare brands by share of picks; track yourself by Picked; name the commit rate whenever both appear.

## Language dictionary (applied to all brief text AND the Verdict pill's visible text)

Banned -> replacement:
- "open-choice questions/answers" -> "when buyers ask what to buy" / "open buying questions"
- "share of decided" / "decided picks" -> "share of picks" (see convention above)
- "engines" -> "AI assistants" (counts of them are fine: "13 AI assistants")
- "instinct vs search" -> "with web search / without web search"
- "prompted head-to-heads" -> "direct matchups" or "asked to compare you with <rival> directly"
- "conditional / no_pick / clarification" -> "hedges" / "no clear pick"
- "reason codes" -> "arguments"
- "rooms" -> "buying situations" (or name the buyer: "the everyday spender")
- "premise confirms/rebuts" -> "agrees with the worry / pushes back on it"
- "settled-customer stages" -> "your customers"
- "coded", "labels", "reference labels", "n=", "95% range", any "x of y" -> never in visible text; counts go in `tip` fields only
- Method footers: one line - "One wave of answers from 13 AI assistants, October 2026." Nothing else.
- Brand, rival, worry and buying-situation NAMES must stay in insight/tension body text (the map's placement matcher reads them).

## Architecture

- **Shared contract**: `src/lib/engine/brief_types.ts` (FROZEN; engine may add optional fields only). One payload = all seven frames, server-composed as finished sentences; the UI renders sections verbatim. Sections support paras (bold lead + text), rows (scoreboard), quads (2x2), and a table (the matrix).
- **Engine** (`src/lib/engine/brief.ts`, view id `brief`, version `bf1`, via cachedView): computed from ViewData + the already-cached sibling views (brand_summary, analysis_map positions/casting, doubt, value, alternatives, reasons, workbench facts for per-situation per-brand shares). Zero model calls beyond the cached context judge. Request data in the key: `:sub:<sha12>` (subject brand) and the existing `:eng:` suffix. Subjects list = target first, then active analyzed brands.
- **Subject shift**: for a rival subject, compute its funnel from the brands table, its per-situation shares and winning arguments from the facts table, its matchup record vs the target from the h2h rollup. Client-only pools (worries, value, leavers, advocacy) are OMITTED from a rival's memo - sections simply absent, no methodology note. The funnel frame's Kept and Defended stages exist only for the target.
- **Frames** (sections per frame; every memo opens with the title and closes with the footer):
  - `now_what`: the verdict paragraph (new convention template), the scoreboard rows, then "Now what?" - 3-5 moves from the analysis map's deficit positions (their levers and treatment families are the mechanical source), each para = lead (the opening), evidence sentence, the move, "Watch: <metric>."
  - `swot`: verdict paragraph, then one 2x2 (two quads): Strengths (surplus positions, argument lifts, matchups won, advocacy), Weaknesses (the funnel break, internal deficits: acceptance-class arguments, value losses, under-taught winning arguments), Opportunities (the moves with watch metrics), Threats (top rival's share, walls, away-conditions, leaver destinations, one-assistant concentration). Max 4 entries per quadrant, each one sentence with its percentage.
  - `tows`: the four strategy cells (S-O, W-O, S-T, W-T), 1-2 pairings each, paired by shared cell/kind where available, else top-by-effect; honest template sentences ("Use <strength> to <move>").
  - `funnel`: five stages - Named, Recommended, Picked, Kept, Defended - each a row (rate) plus one sentence; the largest drop called out as the thesis sentence up top ("You lose exactly one stage"). Kept = the stay side of customers' worries; Defended = the case the AI makes when asked. Rivals get the first three stages.
  - `matrix`: the visibility-conversion table - every selectable brand's Named % vs share of picks, quadrant word per brand (high/high "Category leader", high named/low share "Showroom brand", low/high "Quiet converter", low/low "Bystander"; thresholds = the brand set's medians), subject's row highlighted, then a paragraph reading the subject's quadrant and the notable outliers.
  - `jobs`: one para per buying situation - who the buyer is, the subject's share of picks there, who takes the situation, the value verdict where one exists, the standing wall if the map badges one.
  - `minto`: three sections - The situation (standing), The complication (the sharpest contrast: the served insight with the largest effect whose kind is not engine), The resolution (the moves, compressed to one sentence each).
- **UI** (`src/app/projects/[id]/brief_view.tsx`, wired in run_results.tsx): pill order The Verdict / The Map / The Brief / The Portfolio. Controls: frame dropdown (labels from BRIEF_FRAME_LABELS, default now_what), brand dropdown, the existing Panel engine control; frame + brand persist per project in localStorage; one fetch per (brand, engines), frame switches client-side. Mounted-once like the other pills.
- **PDF**: a "Download PDF" button sets document.title to the memo title, adds a print-scoped class that hides everything but the memo (serif, margins, no tooltips, no app chrome), calls window.print(), restores. No server dependency; the browser's Save as PDF is the export. (A server-rendered PDF is a later round if the print dialog proves insufficient.)
- **Versions**: new view `brief:bf1`; the Verdict-pill language pass changes insight/tension/verdict visible text -> brand_summary bs10 -> bs11, analysis_map am4 -> am5. The map harness must still report every placement as "match" (names stay in text).

## Validation (zero spend, fixture + Sephora local db)

tsc, eslint on touched files, checker_fixture, serve_logic_harness, analysis_map_harness (placements all "match"), then a fixture browser walk: AmEx Brief on every frame, subject switched to Capital One (client-only sections absent), a search-only engine subset recomputing, the print view, and the Verdict pill re-read for banned vocabulary (grep the payload text for the banned list as a mechanical check).
