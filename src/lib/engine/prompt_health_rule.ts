import { viewsOf } from "./views";
import type { Intent, Prompt } from "../types";

/* Pure and client-safe: the engine (prompt_health.ts) and the Prompt health
 * dialog read the same rule. */

/**
 * Which questions the health check judges (2026-11-11), by question type
 * (views.ts viewsOf - stage + angle, never qtype).
 *
 * SENT - the question does not name a brand by design, so what its answers
 * recall is the whole signal of whether it was read as being about the
 * category: open choice (discovery, use-case, social validation), premium vs
 * basic, criteria.
 *
 * LEFT OUT:
 *  - questions that name brands by design (head-to-head, rivals' customers
 *    switching, holding your own, buyers' and customers' worries, value,
 *    habit, business case, expansion, advocacy). The named brand pins the
 *    topic, so these cannot drift into another category the way a blind
 *    question can; what their answers recall besides the named brands is
 *    the named brand's own world (its parent's other products, its partners,
 *    its add-ons), which reads as out-of-category recall without meaning the
 *    question was misread. Measured on the fixture 2026-11-11: with the
 *    named brands removed, the top "drift" on every tracker was exactly that
 *    scenery (the target's parent company and sister products, a card's
 *    benefit partners).
 *  - awareness (problem recognition, learning the category): whether the
 *    answer routes to the category or somewhere else IS the measurement, so
 *    out-of-category recall is the finding, not a defect.
 *  - ecosystem: it asks what goes alongside the product, so naming products
 *    from other categories is the design.
 *  - retired stages (no view).
 *
 * A prompt with no intent (classic batteries) keeps the legacy rule: sent
 * unless its theme is "branded".
 */
export function healthChecks(prompt: Pick<Prompt, "theme">, intent: Pick<Intent, "stage" | "angle"> | undefined): boolean {
  if (!intent) return prompt.theme !== "branded";
  const views = viewsOf(intent.stage, intent.angle);
  return views.includes("headline") || views.includes("criteria_taught");
}
