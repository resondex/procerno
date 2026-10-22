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

/** Brand-board verdicts (dict_suggest.ts). Part of the verdict cache key.
 * gpt-6-luna with the v10 rules since 2026-10-14 (Tyler); verdicts cached
 * under gpt-5-mini keys keep serving through dict_suggest's fallback. */
export const DICT_SUGGEST_MODEL = pick("DICT_SUGGEST_MODEL", "gpt-6-luna");
/** Setup pre-fill: category, competitors, audience (suggest.ts). gpt-6-sol
 * since 2026-10-14 (Tyler): it listed 76% of the competitors the October
 * trackers' answers name most, vs gpt-5-mini 70% and gpt-6-luna 71%
 * (internal_models/seed/profile_score_oct14.md). The model is in the profile
 * cache key, so only brands analyzed from now on get a sol profile. */
export const BRAND_PROFILE_MODEL = pick("BRAND_PROFILE_MODEL", "gpt-6-sol");
/** Starting aliases for the target and competitors (suggest.ts). */
export const DICT_SEED_MODEL = pick("DICT_SEED_MODEL", "gpt-6-luna");
/** Post-run filter of non-brand names before they reach the board (suggest.ts). */
export const JUNK_FILTER_MODEL = pick("JUNK_FILTER_MODEL", "gpt-6-luna");
/** Legacy prompt-battery drafting (suggest.ts) - the classic "Visibility
 * scan" setup. gpt-6-luna since 2026-10-14 (Tyler: switch without a test,
 * ahead of gpt-5-mini's 2026-12-11 shutdown). Batteries cached under the
 * old model keep serving: the battery key carries no model. */
export const BATTERY_MODEL = pick("BATTERY_MODEL", "gpt-6-luna");
/** Battery lint (anchoring / spec-sheet) and its repair round (suggest.ts). */
export const PROMPT_LINT_MODEL = pick("PROMPT_LINT_MODEL", "gpt-6-luna");
/** Post-run prompt health audit (prompt_health.ts). gpt-6-luna since
 * 2026-10-14 (Tyler): on the defective-only contract it judged every prompt
 * on every run of the four held runs; gpt-5-mini timed out on AmEx's 280. */
export const PROMPT_HEALTH_MODEL = pick("PROMPT_HEALTH_MODEL", "gpt-6-luna");
/** Study executive summary (study.ts). */
export const STUDY_SUMMARY_MODEL = pick("STUDY_SUMMARY_MODEL", "gpt-6-luna");
/** Insights narrative when the Claude writer is unavailable (insights.ts).
 * Never runs in prod (an Anthropic key is always set); moved off gpt-5-mini
 * ahead of its 2026-12-11 API shutdown without a test for that reason. */
export const INSIGHTS_FALLBACK_MODEL = pick("INSIGHTS_FALLBACK_MODEL", "gpt-6-luna");
/** The instrument's small setup jobs: moderators, scenario suggest / near,
 * reword, journey and scenario fit, cell review (instrument.ts). gpt-6-luna
 * since 2026-10-21 (Tyler; helpers bakeoff internal_models/helpers/score.md:
 * better or tied on six of seven jobs, a quarter of the cost). */
export const INSTRUMENT_HELPER_MODEL = pick("INSTRUMENT_HELPER_MODEL", "gpt-6-luna");
/** The scenarios-gate room review (reviewScenarios) alone. gpt-6-luna since
 * 2026-10-22 (Tyler; mixed-round internal_models/helpers/mixed_round): with
 * the two-different-buyers mixed line (scenario_review9), false alarms on
 * confirmed rooms 33% -> 15% at mini-level stability, planted two-buyer
 * rooms caught 10/10. */
export const SCENARIO_REVIEW_MODEL = pick("SCENARIO_REVIEW_MODEL", "gpt-6-luna");
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
