/**
 * Internal (non-answer-engine) model choices, one per job, so each job can
 * move to a new model on its own evidence. Every job reads its own env
 * override first, then the legacy shared SUGGEST_MODEL (which used to set
 * all of the gpt-5-mini jobs at once), then its default. Defaults are the
 * models each job was calibrated on; changing one is a per-job decision
 * backed by a side-by-side test (see AGENTS.md, "Internal-model tests A-G").
 * Switched to gpt-6-luna 2026-09-27: dictionary seed, junk filter, battery
 * lint, verbatims (tested wins) and the study summary (Tyler's call, untested -
 * no coded run existed to summarize).
 *
 * Not here: answer engines (providers.ts ENGINES), the answer coder
 * (EXTRACT_MODEL), discovery (DISCOVERY_MODEL), consolidation
 * (CONSOLIDATE_MODEL + its embedding model), the insights writer
 * (INSIGHTS_MODEL), and instrument.ts's market read, cell writer and
 * journey classifier (READ_MODEL, CELLS_MODEL, JOURNEY_MODEL), which
 * already had their own overrides.
 */
const pick = (own: string, fallback: string) =>
  process.env[own] ?? process.env.SUGGEST_MODEL ?? fallback;

/** Brand-board verdicts (dict_suggest.ts). Part of the verdict cache key. */
export const DICT_SUGGEST_MODEL = pick("DICT_SUGGEST_MODEL", "gpt-5-mini");
/** Setup pre-fill: category, competitors, audience (suggest.ts). */
export const BRAND_PROFILE_MODEL = pick("BRAND_PROFILE_MODEL", "gpt-5-mini");
/** Starting aliases for the target and competitors (suggest.ts). */
export const DICT_SEED_MODEL = pick("DICT_SEED_MODEL", "gpt-6-luna");
/** Post-run filter of non-brand names before they reach the board (suggest.ts). */
export const JUNK_FILTER_MODEL = pick("JUNK_FILTER_MODEL", "gpt-6-luna");
/** Legacy prompt-battery drafting (suggest.ts). */
export const BATTERY_MODEL = pick("BATTERY_MODEL", "gpt-5-mini");
/** Battery lint (anchoring / spec-sheet) and its repair round (suggest.ts). */
export const PROMPT_LINT_MODEL = pick("PROMPT_LINT_MODEL", "gpt-6-luna");
/** Post-run prompt health audit (prompt_health.ts). */
export const PROMPT_HEALTH_MODEL = pick("PROMPT_HEALTH_MODEL", "gpt-5-mini");
/** Study executive summary (study.ts). */
export const STUDY_SUMMARY_MODEL = pick("STUDY_SUMMARY_MODEL", "gpt-6-luna");
/** Insights narrative when the Claude writer is unavailable (insights.ts). */
export const INSIGHTS_FALLBACK_MODEL = pick("INSIGHTS_FALLBACK_MODEL", "gpt-5-mini");
/** The instrument's small setup jobs: moderators, scenario suggest / near /
 * review, journey and scenario fit, cell review, phrasings (instrument.ts). */
export const INSTRUMENT_HELPER_MODEL = pick("INSTRUMENT_HELPER_MODEL", "gpt-5-mini");
/** The paraphrase writer (p26, 2026-10-08 writer bakeoff): gpt-6-luna on
 * the contract prompt - 1.7% meaning changes vs gpt-5-mini's 3.8% on the
 * same seeds, zero brand-rule violations, a third of the cost. */
export const PHRASINGS_WRITER_MODEL = pick("PHRASINGS_WRITER_MODEL", "gpt-6-luna");
/** Negative-verbatim explanations (runs/[id]/verbatims). Never followed
 * SUGGEST_MODEL, so it doesn't now. */
export const VERBATIM_MODEL = process.env.VERBATIM_MODEL ?? "gpt-6-luna";
/** Typed competitor roster: who each competitor sells to, intersected with
 * the tracker's audience (roster.ts, 2026-09-30). One cached call per
 * roster at setup; a world-knowledge job, so the full model. */
export const ROSTER_MODEL = process.env.ROSTER_MODEL ?? "gpt-5";
