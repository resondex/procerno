import { createHash } from "crypto";
import { openaiClient } from "./providers";
import { store } from "../store";

/**
 * The instrument designer: brand → market read (base journey + scenarios,
 * each optionally carrying its own journey) → participation mask → a grid
 * of intents with one prompt each → paraphrase sets. This is the
 * alternative to the classic suggested battery (suggest.ts), not a
 * replacement — both paths produce ordinary prompts for the runner, and a
 * project records which instrument built it.
 *
 * The model, in one sentence: rows are the stages of the decision; columns
 * are the buyers' scenarios; each scenario walks the stages its buyer
 * actually walks. There is no separate "mode" dimension — what a buyer
 * mode carried is a property of the scenario (its journey), and stage
 * participation is DERIVED from journeys, never authored (spec axiom A5).
 *
 * Everything here is setup-time tooling: cache-first LLM calls on the same
 * client and model the classic path uses, plus one pure-code composer. No
 * new services, no new vendors.
 */

const MODEL = process.env.SUGGEST_MODEL ?? "gpt-5-mini";
/** The market read runs on the full model: it is one cached call per
 * category carrying the most leverage in the pipeline - mini's economy
 * is for the high-volume mechanical calls (cells, phrasings, variants). */
const READ_MODEL = process.env.READ_MODEL ?? "gpt-5";
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000;
/** Versions the WRITING STYLE of cells and phrasings independently of the
 * instrument rules - a style change regenerates prompt text without
 * discarding scenario reads. */
const STYLE_VERSION = "s2";
// Version the cache: composer-rule or prompt-style changes must not serve
// grids built under old rules.
const INSTRUMENT_VERSION = "g7";

function cacheKey(prefix: string, parts: (string | null)[]): string {
  const normalized = parts.map((p) => (p ?? "").trim().toLowerCase()).join("|");
  return `${prefix}:${INSTRUMENT_VERSION}:${createHash("sha256").update(normalized).digest("hex")}`;
}

/* ------------------------------ moderators ------------------------------ */

export interface Moderators {
  verifiability: "spec" | "taste" | "trust";
  involvement: "considered" | "habitual";
  think_feel: "think" | "feel";
  decision_unit: "solo" | "household" | "committee";
  rhythm: "one_shot" | "replenishment" | "subscription";
  risk: "performance" | "financial" | "social" | "physical";
  channel_retail: boolean;
  /** One sentence the setup banner shows under the classification chips. */
  rationale: string;
}

const MODERATOR_PROPS = {
  verifiability: { type: "string", enum: ["spec", "taste", "trust"] },
  involvement: { type: "string", enum: ["considered", "habitual"] },
  think_feel: { type: "string", enum: ["think", "feel"] },
  decision_unit: { type: "string", enum: ["solo", "household", "committee"] },
  rhythm: { type: "string", enum: ["one_shot", "replenishment", "subscription"] },
  risk: { type: "string", enum: ["performance", "financial", "social", "physical"] },
  channel_retail: { type: "boolean" },
  rationale: { type: "string" },
} as const;

const MODERATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: MODERATOR_PROPS,
  required: [
    "verifiability", "involvement", "think_feel", "decision_unit",
    "rhythm", "risk", "channel_retail", "rationale",
  ],
} as const;

const DIMENSION_GUIDE =
  "- verifiability: bought on checkable specs, on taste/experience, " +
  "or on trust (credence - quality unverifiable even after use).\n" +
  "- involvement: a considered purchase, or habitual/impulse.\n" +
  "- think_feel: decided mostly rationally, or by identity/emotion.\n" +
  "- decision_unit: one person, a household, or a committee/team.\n" +
  "- rhythm: one-shot purchase, replenishment, or subscription.\n" +
  "- risk: the buyer's dominant worry - performance, financial, " +
  "social (how it looks), or physical (safety).\n" +
  "- channel_retail: true when where-to-buy is a real question " +
  "(retail/DTC goods), false for direct/contracted purchases.\n";

export async function classifyModerators(input: {
  category: string;
  audience: string | null;
}): Promise<Moderators> {
  const key = cacheKey("moderators", [input.category, input.audience]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as Moderators;
  const res = await openaiClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Classify a purchase category on seven decision-structure " +
          "dimensions, for designing a research instrument over its buying " +
          "decision.\n" + DIMENSION_GUIDE +
          "- rationale: ONE sentence justifying the overall read, in plain " +
          "buyer language.",
      },
      {
        role: "user",
        content: `Category: ${input.category}\nAudience: ${input.audience ?? "unknown"}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "moderators", strict: true, schema: MODERATOR_SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Moderators;
  await store.cacheSet(key, JSON.stringify(parsed));
  return parsed;
}

/* ------------------------------- composer ------------------------------- */

export type Layer = "awareness" | "consideration" | "decision" | "retention" | "loyalty";

/** What an AI answer at this stage does to the market - the chip the user
 * sees next to every library row. */
export type StageTag = "picks" | "rules" | "judges" | "steers";

export interface ComposedStage {
  key: string;
  label: string;
  layer: Layer;
  /** Whether this stage's intents vary across buyer scenarios. */
  situational: boolean;
  /** none = generic; each = one cell per named rival; defensive_offensive =
   * one "alternatives to you" cell plus one per rival. */
  rivals: "none" | "each" | "defensive_offensive";
  tag: StageTag;
  /** Guidance handed to the cell generator for this stage. */
  hint: string;
  /** One plain sentence for the user: why the rules recommend this stage
   * for this market - or, when they skip it, why they skip it. Authored
   * per rule branch, no model call (spec: templated rule-derived hover). */
  why: string;
}

export type LibraryStage = ComposedStage & {
  /** Whether the composer's rules pick this stage for the journey. The
   * user sees the whole library and can keep a stage the rules skipped. */
  recommended: boolean;
};

/**
 * The master library, in journey order, with the composer's verdict on each
 * stage. Pure rules on purpose - auditable, consistent, and testable without
 * a model call. This is the part that makes the battery an instrument rather
 * than a suggestion.
 */
export function stageLibrary(m: Moderators): LibraryStage[] {
  const considered = m.involvement === "considered";
  return [
    {
      key: "problem_recognition", label: "Problem recognition", layer: "awareness",
      situational: true, rivals: "none", tag: "rules", recommended: true,
      hint: "Pain-phrased and pre-category: the buyer describes the problem without knowing the category exists. Never name the category, a brand, or a product type.",
      why: "Every journey starts here - buyers describe the pain before they know the category exists.",
    },
    {
      key: "category_education", label: "Category education", layer: "awareness",
      situational: false, rivals: "none", tag: "rules",
      recommended: m.think_feel === "think" && considered,
      hint: "The buyer asks what the category is or does ('what does a X actually do').",
      why: m.think_feel === "think" && considered
        ? "A considered, rational market studies the category before shortlisting."
        : m.think_feel !== "think"
          ? "Identity-led buyers don't pause to study the category definition."
          : "Habitual buyers don't stop to learn what the category is.",
    },
    {
      key: "discovery", label: "Discovery", layer: "awareness",
      situational: true, rivals: "none", tag: "picks", recommended: true,
      hint: "Open category discovery: 'best X for ...' style asks, no brands named.",
      why: "'Best X for ...' is the front door of AI-assisted buying in every market.",
    },
    {
      key: "shortlist", label: "Shortlist", layer: "consideration",
      situational: true, rivals: "none", tag: "picks", recommended: true,
      hint: "The buyer asks for a small set of options to consider.",
      why: "Every buyer narrows to a few options - this cut is where brands live or die.",
    },
    {
      // Situational since 2026-08-24: the taught criteria differ by
      // circumstance (an assistant weights simplicity/price for a startup,
      // SSO/compliance for an enterprise) - substantive advice, not a
      // standing verdict.
      key: "criteria", label: "Criteria formation", layer: "consideration",
      situational: true, rivals: "none", tag: "rules", recommended: true,
      hint: "The buyer asks what to look for / what matters when choosing.",
      why: "Assistants teach buyers what to value before any brand is named.",
    },
    {
      key: "feature_screening", label: "Feature screening", layer: "consideration",
      situational: true, rivals: "none", tag: "picks",
      recommended: m.verifiability === "spec",
      hint: "Attribute-first asks: which options have a specific capability.",
      why: m.verifiability === "spec"
        ? "A spec-driven market shops by capability, so attribute asks decide who makes the cut."
        : `Your market verifies by ${m.verifiability}, not specs - buyers don't shop from an attribute checklist.`,
    },
    {
      key: "use_case", label: "Use-case fit", layer: "consideration",
      situational: true, rivals: "none", tag: "picks", recommended: true,
      hint: "Situation-first asks describing a concrete need or workflow.",
      why: "Concrete-need asks are where assistants match options to situations.",
    },
    {
      key: "social_validation", label: "Social validation", layer: "consideration",
      situational: false, rivals: "none", tag: "picks", recommended: true,
      hint: m.think_feel === "feel"
        ? "What people love, compliment, or identify with - social proof in identity terms."
        : "What people actually use and rate well - reviews, communities, popularity.",
      why: "Proof from other people moves every market.",
    },
    {
      key: "comparison",
      label: m.verifiability === "taste" ? "Dupes & alternatives" : "Comparison",
      layer: "decision", situational: true, rivals: "each", tag: "picks",
      recommended: considered,
      hint: m.verifiability === "taste"
        ? "Head-to-head and 'similar to X but cheaper/different' asks naming the rival."
        : "Head-to-head asks naming the client brand against the rival.",
      why: considered
        ? "A considered market weighs finalists head-to-head before committing."
        : "Habitual buyers don't run head-to-heads - the shelf question (Premium vs. basic) carries this moment.",
    },
    {
      // The habitual journey's comparison moment: the shelf question where
      // premium and basic are DIFFERENT MAKERS. Never a tier question -
      // within-brand tiers live in pricing (spec axiom A7). Considered
      // journeys decompose this moment into shortlist/comparison/pricing.
      key: "premium_worth",
      label: considered ? "Premium vs. basic brands" : "Splurge or save",
      layer: "decision", situational: false, rivals: "none", tag: "picks",
      recommended: !considered,
      hint: "Across brands, not tiers: whether the premium maker genuinely beats the basic/store option - asked from both sides (is the expensive one worth it, is the cheap one good enough).",
      why: !considered
        ? "A habitual market compresses comparison into one shelf question: is the premium maker worth it."
        : "Your considered market decomposes this moment into Shortlist, Comparison, and Pricing instead.",
    },
    {
      key: "objections", label: "Objections / risk", layer: "decision",
      situational: true, rivals: "none", tag: "judges", recommended: true,
      hint: `The buyer voices the category's dominant worry (${m.risk}) about the client brand by name.`,
      why: `Every market has a dominant worry - here it's ${m.risk} risk, voiced about you by name.`,
    },
    {
      key: "pricing", label: "Pricing / value", layer: "decision",
      situational: true, rivals: "none", tag: "judges", recommended: true,
      hint: "Cost and value-for-money asks; some generic to the category (including paid-vs-free where free options exist), some naming the client brand (including its own tiers).",
      why: "Cost and value questions reach every buyer, whatever the journey.",
    },
    {
      // Situational since 2026-08-24: the justification an assistant writes
      // is built from the circumstance (price/speed for a startup, security
      // review and consolidation for an enterprise) - one cell per
      // committee-reaching column, not one shared case.
      key: "business_case", label: "Business case", layer: "decision",
      situational: true, rivals: "none", tag: "judges",
      recommended: m.decision_unit === "committee",
      hint: "The buyer asks for help justifying the client brand internally ('make the case to my CFO').",
      why: m.decision_unit === "committee"
        ? "Committee-bought: someone has to justify the pick internally, and assistants write that case."
        : `A ${m.decision_unit === "household" ? "household" : "solo"} buyer doesn't have to sell the decision internally.`,
    },
    {
      key: "churn_triggers", label: "Churn triggers", layer: "retention",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "An existing customer wonders whether the client brand is still the right choice.",
      why: "Every install base has doubters - this is where assistant-induced churn starts.",
    },
    {
      key: "alternatives", label: "Alternatives", layer: "retention",
      situational: false, rivals: "defensive_offensive", tag: "picks", recommended: true,
      hint: "'Alternatives to X' asks - one for the client brand (defensive) and one per rival (offensive).",
      why: "'Alternatives to X' is the most-typed switching ask - defensive for you, offensive against each rival.",
    },
    {
      key: "renewal", label: "Renewal", layer: "retention",
      situational: false, rivals: "none", tag: "judges",
      recommended: m.rhythm === "subscription",
      hint: "At renewal: is the client brand worth keeping, are there cheaper options.",
      why: m.rhythm === "subscription"
        ? "A subscription market re-decides at every renewal."
        : m.rhythm === "replenishment"
          ? "Your market buys on replenishment - Repertoire carries the repeat decision."
          : "A one-shot market has no renewal moment.",
    },
    {
      key: "problem_resolution", label: "Problem resolution", layer: "retention",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "A support-style ask: something about the client brand is broken or messy, how to fix it.",
      why: "Support moments are where satisfied customers quietly become switchers.",
    },
    {
      key: "expansion", label: "Expansion", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "A happy customer considers using the client brand for more ('roll it out further', 'use it for Y too').",
      why: "Happy customers ask whether to use you for more - growth the assistant can steer.",
    },
    {
      key: "ecosystem", label: "Ecosystem", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "What works well WITH the client brand - add-ons, companions, integrations.",
      why: "What-works-with-you asks show whether assistants place you at the center of a stack.",
    },
    {
      key: "advocacy", label: "Advocacy", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "A customer asks how to defend or recommend the client brand to someone else.",
      why: "Customers recruiting others is your cheapest funnel - if the assistant backs them.",
    },
    {
      key: "repertoire", label: "Repertoire", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers",
      recommended: m.rhythm === "replenishment",
      hint: "Deepening the habit: more from the same brand, or is it worth switching from the usual.",
      why: m.rhythm === "replenishment"
        ? "A replenishment market re-asks the habit question at every purchase."
        : m.rhythm === "subscription"
          ? "Your market buys on subscription - Renewal carries the repeat decision."
          : "A one-shot market has no repeat habit to deepen.",
    },
  ];
}

/** A library entry without the verdict - what the cell planner consumes. */
export function stripVerdict(s: LibraryStage): ComposedStage {
  const { key, label, layer, situational, rivals, tag, hint, why } = s;
  return { key, label, layer, situational, rivals, tag, hint, why };
}

/** The composed skeleton for a single journey, in order. */
export function composeStages(m: Moderators): ComposedStage[] {
  return stageLibrary(m).filter((s) => s.recommended).map(stripVerdict);
}

/* ----------------------------- market read ------------------------------ */

/** The structural dimensions that define HOW a buyer decides. A scenario
 * may carry its own journey; everything else it inherits from the base. */
export interface Journey {
  involvement: Moderators["involvement"];
  verifiability: Moderators["verifiability"];
  think_feel: Moderators["think_feel"];
  decision_unit: Moderators["decision_unit"];
}

export interface ScenarioSpec {
  label: string;
  description: string;
  /** Structural journey delta; null = inherits the base read. Granted only
   * when this scenario's buyer DECIDES BY A DIFFERENT PROCESS - a
   * circumstance (budget, constraint) never grants one (spec axiom A3). */
  journey: Journey | null;
}

function journeyOf(base: Moderators, s: ScenarioSpec): Moderators {
  return s.journey ? { ...base, ...s.journey } : base;
}

function sameJourney(base: Moderators, j: Journey): boolean {
  return (
    j.involvement === base.involvement &&
    j.verifiability === base.verifiability &&
    j.think_feel === base.think_feel &&
    j.decision_unit === base.decision_unit
  );
}

const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    base: MODERATOR_SCHEMA,
    scenarios: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          description: { type: "string" },
          deviates: { type: "boolean" },
          journey: {
            type: "object",
            additionalProperties: false,
            properties: {
              involvement: MODERATOR_PROPS.involvement,
              verifiability: MODERATOR_PROPS.verifiability,
              think_feel: MODERATOR_PROPS.think_feel,
              decision_unit: MODERATOR_PROPS.decision_unit,
            },
            required: ["involvement", "verifiability", "think_feel", "decision_unit"],
          },
        },
        required: ["label", "description", "deviates", "journey"],
      },
    },
  },
  required: ["base", "scenarios"],
} as const;

/** Scenarios the fresh grid opens with; the rest are the reserve pool that
 * makes "Suggest another" instantaneous. */
const CORE_SCENARIOS = 4;

/**
 * The market read, in one call: the base journey plus 8 buying scenarios,
 * ordered most to least central. The first 4 are the core set (columns of a
 * fresh grid); the rest are the reserve pool, cached so "Suggest another"
 * costs nothing. Deltas are rare by instruction (A3), capped at one per
 * grid in code (A4), and granted only in the core set - reserve scenarios
 * always inherit the base journey, like user suggestions.
 */
export async function readScenarios(input: {
  category: string;
  audience: string | null;
}): Promise<{ base: Moderators; scenarios: ScenarioSpec[]; reserve: ScenarioSpec[] }> {
  // "scenarios_journeys8": deviation-coherence rules + plain-language label
  // rule (no methodology words) changed the read.
  const key = cacheKey("scenarios_journeys8", [input.category, input.audience]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as { base: Moderators; scenarios: ScenarioSpec[]; reserve: ScenarioSpec[] };
  const res = await openaiClient().chat.completions.create({
    model: READ_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Read a purchase market for a research instrument over its buying " +
          "decision. Return:\n" +
          "1) base: the market's dominant decision-structure read on seven " +
          "dimensions:\n" + DIMENSION_GUIDE +
          "- rationale: ONE sentence in plain buyer language.\n" +
          "2) scenarios: EIGHT buying scenarios, ordered most to least " +
          "central to the market - the first 4 are the core set a " +
          "strategist would field; the rest are credible alternates a user " +
          "might swap in. A scenario earns its place " +
          "ONLY if it changes what a competent advisor would recommend - " +
          "facts about the decision, never facts about the speaker. Labels " +
          "are 2-4 plain words naming the buyer or the circumstance the " +
          "way a strategist would title a slide ('Solo founder pick', " +
          "'Enterprise procurement') - never analytical or methodology " +
          "words like 'default', 'habitual', 'segment', 'use case'. " +
          "Descriptions one short sentence. Scenarios describe circumstances, never a specific brand or product - 'migrating from a legacy tracker', not 'migrating from X'. Spend the " +
          "slots on DIFFERENT axes of circumstance (scale, composition, " +
          "constraint, occasion, recipient), not variants of one.\n" +
          "3) per scenario, deviates: true ONLY if that scenario's buyer " +
          "DECIDES BY A DIFFERENT PROCESS than the base - differing on " +
          "involvement, verifiability, think_feel, or decision_unit. " +
          "Judge each scenario fresh from its own facts, dimension by " +
          "dimension - a real second journey usually differs on ONE or " +
          "TWO dimensions, and a flip of all four at once is almost " +
          "always pattern-matching, not reading. A circumstance " +
          "that changes the answer but not the process - tight budget, " +
          "compliance constraint, gift deadline - NEVER deviates. A " +
          "deviating journey must COHERE with the scenario's own words: " +
          "'habitual' requires an established default the buyer reaches " +
          "for without deliberating - a FIRST-TIME adoption is never " +
          "habitual, however quick, and 'moving fast' alone is not a " +
          "different process; " +
          "'solo' requires the scenario to describe ONE person deciding, " +
          "not a small team. The DEFAULT is no deviation: most " +
          "markets have ZERO deviating scenarios; at most one, and only " +
          "among the first four. When " +
          "deviates is false, journey just repeats the base values.\n" +
          "What good looks like - each scenario is a room the client's " +
          "brand has to win, vivid enough that a strategist would present " +
          "it by name. For 'email marketing platforms / e-commerce brands' " +
          "the core set might be: 'First store setup' (a shop owner wiring " +
          "up email before launch weekend), 'Agency managing brands' (one " +
          "team running campaigns for a dozen clients), 'Outgrowing the " +
          "starter tool' (lists too big, automations too crude, " +
          "deliverability slipping), 'Marketing team consolidation' " +
          "(email, SMS and reviews pulled into one stack under one budget " +
          "owner). Notice: concrete moments, different axes, each changes " +
          "what an advisor recommends, none is a demographic. Write YOUR " +
          "category at that standard - the example is a bar for quality, " +
          "never a template for content, and never a template for SHAPE: " +
          "your market's rooms are its own.\n" +
          "Before returning, audit the core four for coverage: rank this " +
          "market's buying rooms by how much revenue moves through them, " +
          "ensuring a diverse sampling, and check none of the biggest is " +
          "missing. In categories sold to organizations, the " +
          "large-organization purchase is almost always one of them; if a " +
          "top room is absent it replaces the weakest scenario in the " +
          "core set. If the market genuinely has a second decision " +
          "process - a scenario whose buyer decides differently - its " +
          "room stays in the core set alongside the revenue-ranked ones.",
      },
      {
        role: "user",
        content: `Category: ${input.category}\nAudience: ${input.audience ?? "unknown"}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "market_read", strict: true, schema: READ_SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    base: Moderators;
    scenarios: { label: string; description: string; deviates: boolean; journey: Journey }[];
  };
  const base = parsed.base;
  let deltaGranted = false;
  const all: ScenarioSpec[] = (parsed.scenarios ?? [])
    .slice(0, 8)
    .map((s, i) => {
      // A3/A4 in code: a delta must really differ, only one is granted,
      // and only in the core set (reserve rows inherit like suggestions).
      const wants = i < CORE_SCENARIOS && s.deviates && !sameJourney(base, s.journey);
      const granted = wants && !deltaGranted;
      if (granted) deltaGranted = true;
      return {
        label: s.label.trim(),
        description: s.description.trim(),
        journey: granted ? s.journey : null,
      };
    })
    .filter((s) => s.label);
  const out = {
    base,
    scenarios: all.slice(0, CORE_SCENARIOS),
    reserve: all.slice(CORE_SCENARIOS),
  };
  if (out.scenarios.length > 0) await store.cacheSet(key, JSON.stringify(out));
  return out;
}

/* -------------------------- participation mask -------------------------- */

/** A library row with its mask: which scenario columns the stage runs in.
 * Situational stages compose one cell per listed column; invariant stages
 * one cell (scoped to the listed columns when not universal). Shared
 * cells are measured once - the anti-double-pay rule (A6). */
export interface MaskedStage extends ComposedStage {
  recommended: boolean;
  /** Labels of scenarios whose journey reaches this stage. */
  columns: string[];
}

export function participationMask(
  base: Moderators,
  scenarios: ScenarioSpec[]
): MaskedStage[] {
  const baseLib = stageLibrary(base);
  if (scenarios.length === 0) {
    return baseLib.map((s) => ({ ...stripVerdict(s), recommended: s.recommended, columns: [] }));
  }
  const libs = scenarios.map((s) => stageLibrary(journeyOf(base, s)));
  return baseLib.map((_, i) => {
    const reaching = scenarios.filter((_s, j) => libs[j][i].recommended);
    // Wording (label/hint) follows the first reaching column's journey,
    // the base otherwise - per-cell flavor happens at generation anyway.
    const srcIdx = scenarios.findIndex((_s, j) => libs[j][i].recommended);
    const src = stripVerdict(srcIdx >= 0 ? libs[srcIdx][i] : baseLib[i]);
    return {
      ...src,
      recommended: reaching.length > 0,
      columns: reaching.map((s) => s.label),
    };
  });
}

/* ------------------------------ situations ------------------------------ */

export interface Situation {
  label: string;
  description: string;
}

const SITUATIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    situations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          description: { type: "string" },
        },
        required: ["label", "description"],
      },
    },
  },
  required: ["situations"],
} as const;

const SITUATION_TEMPLATE: Record<Moderators["decision_unit"], string> = {
  committee:
    "buyer circumstances for an organizational purchase: scale (team/org size), composition (who has to use it), and constraint (budget tier). ",
  household:
    "buyer circumstances for a consumer purchase: occasions, recipients (buying for self vs someone else), and constraints (budget, sensitivities). ",
  solo:
    "buyer circumstances for an individual considered purchase: use-cases, budget tiers, and ecosystem/compatibility constraints. ",
};

/**
 * One more scenario for the same category, distinct from the ones already
 * on the table (whether the user kept them or not). Same admission test as
 * the initial set; suggestions always INHERIT the base journey (a delta is
 * the market read's call, not a suggestion's). Cached by what it was asked
 * to avoid, so the next user in the same category gets the same suggestion.
 */
export async function suggestScenario(input: {
  category: string;
  audience: string | null;
  decisionUnit: Moderators["decision_unit"];
  exclude: Situation[];
}): Promise<Situation | null> {
  const avoid = input.exclude.map((s) => s.label.trim().toLowerCase()).filter(Boolean).sort();
  const key = cacheKey("scenario_more3", [
    input.category, input.audience, input.decisionUnit, avoid.join("|"),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as Situation;
  const res = await openaiClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Propose exactly ONE additional buyer situation for a research " +
          "instrument. A situation earns its place ONLY if it changes what a " +
          "competent advisor would recommend - facts about the decision, never " +
          "facts about the speaker. It must be genuinely different from every " +
          "situation already listed (a different axis of circumstance, not a " +
          "variant of one). Scenarios describe circumstances, never a specific brand or product - 'migrating from a legacy tracker', not 'migrating from X'. Use " + SITUATION_TEMPLATE[input.decisionUnit] +
          "Label 2-4 plain words naming the buyer or the circumstance the " +
          "way a strategist would title a slide - never analytical or " +
          "methodology words like 'default', 'habitual', 'segment', 'use " +
          "case'. Description one short sentence.",
      },
      {
        role: "user",
        content:
          `Category: ${input.category}\nAudience: ${input.audience ?? "unknown"}\n` +
          `Already listed:\n${input.exclude.map((s) => `- ${s.label}: ${s.description}`).join("\n") || "- (none)"}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "situations", strict: true, schema: SITUATIONS_SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    situations: Situation[];
  };
  const fresh = (parsed.situations ?? []).find(
    (s) => s.label.trim() && !avoid.includes(s.label.trim().toLowerCase())
  );
  if (!fresh) return null;
  await store.cacheSet(key, JSON.stringify(fresh));
  return fresh;
}

/**
 * The near-variant POOL for one scenario: three alternates of the original,
 * each moving a different concrete detail. Prefetched when the scenarios
 * gate lands so every "Near neighbor" draw is instant, and cached by the
 * original scenario - "Reset to suggested" walks the same pool again.
 */
export async function nearScenarios(input: {
  category: string;
  audience: string | null;
  of: Situation;
  exclude: Situation[];
}): Promise<Situation[]> {
  const avoid = input.exclude.map((s) => s.label.trim().toLowerCase()).filter(Boolean).sort();
  const key = cacheKey("scenario_near_pool", [
    input.category, input.audience, input.of.label, input.of.description, avoid.join("|"),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as Situation[];
  const res = await openaiClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Propose exactly THREE near variants of a given buyer situation " +
          "for a research instrument. Each keeps its general circumstance " +
          "- the same axis - and moves ONE concrete detail (scale, " +
          "constraint, occasion, composition, use-case), a DIFFERENT " +
          "detail per variant, so each reads noticeably but not radically " +
          "different. Order them closest-first. Every variant must still " +
          "change what a competent advisor would recommend, stay about " +
          "the decision (never the speaker), and differ from the others " +
          "and from everything already listed. Scenarios describe " +
          "circumstances, never a specific brand or product - 'migrating " +
          "from a legacy tracker', not 'migrating from X'. Labels 2-4 " +
          "plain words naming the buyer or the circumstance the way a " +
          "strategist would title a slide - never analytical or " +
          "methodology words like 'default', 'habitual', 'segment', 'use " +
          "case'. Descriptions one short sentence.",
      },
      {
        role: "user",
        content:
          `Category: ${input.category}\nAudience: ${input.audience ?? "unknown"}\n` +
          `Vary this situation:\n- ${input.of.label}: ${input.of.description}\n` +
          `Already listed (avoid all of these):\n${input.exclude.map((s) => `- ${s.label}: ${s.description}`).join("\n") || "- (none)"}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "situations", strict: true, schema: SITUATIONS_SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    situations: Situation[];
  };
  const seen = new Set(avoid);
  const pool: Situation[] = [];
  for (const s of parsed.situations ?? []) {
    const k = s.label.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    pool.push({ label: s.label.trim(), description: s.description.trim() });
    if (pool.length === 3) break;
  }
  if (pool.length > 0) await store.cacheSet(key, JSON.stringify(pool));
  return pool;
}

/** Why a scenario was flagged: mechanics, clarity, or bundled axes. */
export type ScenarioFlag = "typo" | "phrasing" | "mixed";

export interface ScenarioVerdict {
  ok: boolean;
  /** Every problem found, most serious first (a check can have several):
   * "mixed" = bundles more than one decision factor; "phrasing" =
   * substance fine, could be said clearer or more precisely; "typo" =
   * spelling or grammar. Empty when ok. */
  flags: ScenarioFlag[];
  /** One plain-language sentence addressed to the user; empty when ok. */
  reason: string;
  /** One edit fixing every flag while keeping the user's intent; repeats
   * the input when ok. */
  suggestion: Situation;
}

/** The model answers each problem as its own yes/no - a single kind label
 * lets it skip questions and wobble between runs; three explicit booleans
 * force every axis to be evaluated. Kind and ok are computed in code. */
const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          typo: { type: "boolean" },
          unclear: { type: "boolean" },
          mixed: { type: "boolean" },
          reason: { type: "string" },
          suggestion: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              description: { type: "string" },
            },
            required: ["label", "description"],
          },
        },
        required: ["typo", "unclear", "mixed", "reason", "suggestion"],
      },
    },
  },
  required: ["verdicts"],
} as const;

/**
 * Quality check on user-written or user-edited scenarios, run once at the
 * gate confirm. Same admission test the generator works to; a failed
 * candidate comes back with a one-sentence reason and a minimal suggested
 * edit that preserves the user's evident intent.
 */
export async function reviewScenarios(input: {
  category: string;
  audience: string | null;
  /** `original` is the version the user started from, when there was one -
   * the diff lets the reviewer tell an accidental slip from a deliberate
   * change. */
  candidates: (Situation & { original?: Situation | null })[];
  others: Situation[];
}): Promise<ScenarioVerdict[]> {
  const fp = (s: Situation & { original?: Situation | null }) =>
    `${s.label.trim()}|${s.description.trim()}` +
    (s.original ? `<${s.original.label.trim()}|${s.original.description.trim()}` : "");
  // "scenario_review7": originals in the contract, minimal-edit rules.
  const key = cacheKey("scenario_review7", [
    input.category, input.audience,
    input.candidates.map(fp).join("~"), input.others.map((s) => fp(s)).sort().join("~"),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as ScenarioVerdict[];
  const res = await openaiClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Quality-check buying scenarios a user wrote for a research " +
          "instrument over a category's buying decision. A good scenario: " +
          "describes a buyer circumstance that changes what a competent " +
          "advisor would recommend; is about the decision, never about the " +
          "speaker's identity or the product itself; is ONE axis of " +
          "circumstance; stays inside the category (a different product or " +
          "market is not a scenario); is distinct from the other scenarios " +
          "on the table; label 2-4 plain words; description one short " +
          "sentence in plain buyer language. For EACH candidate answer " +
          "three yes/no questions, each judged on its own:\n" +
          "- typo: are there spelling, casing, or grammar errors in the " +
          "label or description? (These words appear verbatim in a client " +
          "deliverable.)\n" +
          "- unclear: would a strategist say it clearer or more precisely " +
          "- vague wording, a label that doesn't say what the circumstance " +
          "is - OR does it contain irrelevant or nonsensical content " +
          "(test text, asides that are not part of the circumstance)? " +
          "Answer yes only when the rewrite is a real improvement, not a " +
          "lateral rewording.\n" +
          "- mixed: does it bundle more than one distinct decision factor " +
          "(two axes of circumstance in one scenario, e.g. company size " +
          "AND budget constraint)? If yes, the fix keeps the dominant " +
          "factor and drops the rest.\n" +
          "On substance beyond these three, accept anything reasonable - " +
          "a safety net for confused or empty entries, not a taste gate. " +
          "Some candidates note the version the user started from " +
          "('edited from'). Use the diff: a change that looks accidental " +
          "(e.g. 'Startup first-choice' -> 'Startup first-choicer') is a " +
          "typo whose fix restores those words; a deliberate change is " +
          "judged on the new text's own merits, never reverted. When any " +
          "answer is yes: reason is ONE sentence in plain language " +
          "addressed to the user covering every yes, and suggestion is " +
          "the SMALLEST edit that fixes every yes at once, spelling " +
          "included - change only the words involved, and never rename or " +
          "reframe the scenario beyond what the flags require. When all " +
          "three are no: reason is an empty string and suggestion repeats " +
          "the candidate verbatim. Return verdicts in the candidates' " +
          "order, one per candidate.",
      },
      {
        role: "user",
        content:
          `Category: ${input.category}\nAudience: ${input.audience ?? "unknown"}\n` +
          `Other scenarios already on the table:\n${input.others.map((s) => `- ${s.label}: ${s.description}`).join("\n") || "- (none)"}\n` +
          `Candidates to check:\n${input.candidates
            .map(
              (s, i) =>
                `${i + 1}. ${s.label}: ${s.description}` +
                (s.original ? `\n   (edited from: ${s.original.label}: ${s.original.description})` : "")
            )
            .join("\n")}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "scenario_review", strict: true, schema: REVIEW_SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    verdicts: {
      typo: boolean; unclear: boolean; mixed: boolean;
      reason: string; suggestion: Situation;
    }[];
  };
  // Flags are derived, most serious first - the model only answers the
  // three questions. A missing or malformed verdict never blocks the user.
  const verdicts: ScenarioVerdict[] = input.candidates.map((c, i) => {
    const v = (parsed.verdicts ?? [])[i];
    if (!v || typeof v.typo !== "boolean" || !v.suggestion?.label?.trim()) {
      return { ok: true, flags: [], reason: "", suggestion: c };
    }
    const flags: ScenarioFlag[] = [
      ...(v.mixed ? ["mixed" as const] : []),
      ...(v.unclear ? ["phrasing" as const] : []),
      ...(v.typo ? ["typo" as const] : []),
    ];
    return {
      ok: flags.length === 0,
      flags,
      // House style: no em dashes in user-facing text.
      reason: flags.length === 0 ? "" : (v.reason ?? "").replace(/\s*[—–]\s*/g, " - "),
      suggestion: flags.length === 0 ? c : v.suggestion,
    };
  });
  await store.cacheSet(key, JSON.stringify(verdicts));
  return verdicts;
}

/* -------------------------------- cells --------------------------------- */

export interface GridCell {
  stage: string;
  layer: Layer;
  /** Scenario label, or null for invariant (single-cell) stages. */
  situation: string | null;
  /** "generic", "defensive", or the rival's name. */
  angle: string;
  /** For invariant cells only: the scenario labels whose journeys reach
   * this stage, comma-joined, when not universal. Voices are drawn from
   * these. null = every scenario (or a situational cell, whose situation
   * already says who it serves). Stored on intents.mode. */
  mode: string | null;
  /** The prompt as a user would type it. */
  text: string;
}

const CELLS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cells: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          stage: { type: "string" },
          situation: { type: ["string", "null"] },
          angle: { type: "string" },
          text: { type: "string" },
        },
        required: ["stage", "situation", "angle", "text"],
      },
    },
  },
  required: ["cells"],
} as const;

/** One line describing a deviating column's journey, for prompts. */
function journeyNote(base: Moderators, s: ScenarioSpec): string | null {
  if (!s.journey) return null;
  const j = { ...base, ...s.journey };
  return `${s.label}: decides ${j.involvement === "habitual" ? "habitually" : "deliberately"}, ${j.verifiability}-driven, by ${j.think_feel === "feel" ? "feel/identity" : "reasoning"}${j.decision_unit === "committee" ? ", as a team" : ""}`;
}

/**
 * Fill the grid: one prompt per cell. The cell plan is computed in code
 * from the participation mask (which cells exist is a design rule, not a
 * model choice); the model only writes the prompt texts. Bulk generation
 * is fine here - this is tooling, not measurement.
 */
export async function generateGrid(input: {
  brand: string;
  category: string;
  competitors: string[];
  audience: string | null;
  base: Moderators;
  scenarios: ScenarioSpec[];
  stages: MaskedStage[];
}): Promise<GridCell[]> {
  const rivals = input.competitors.slice(0, 4);
  const allLabels = input.scenarios.map((s) => s.label);
  const plan: { stage: MaskedStage; situation: string | null; angle: string; scope: string | null }[] = [];
  for (const st of input.stages) {
    // A kept stage no journey reaches was forced in by the user: it runs
    // everywhere, in the base journey's voice (override semantics).
    const cols = st.columns.length > 0 ? st.columns.filter((c) => allLabels.includes(c)) : allLabels;
    const columns = cols.length > 0 ? cols : allLabels;
    const scope =
      columns.length < allLabels.length ? columns.join(", ") : null;
    if (st.rivals === "each") {
      const sits = st.situational && columns.length > 0 ? columns : [null as string | null];
      rivals.forEach((r, i) => {
        plan.push({ stage: st, situation: sits[i % sits.length] ?? null, angle: r, scope: null });
      });
    } else if (st.rivals === "defensive_offensive") {
      plan.push({ stage: st, situation: null, angle: "defensive", scope });
      rivals.forEach((r) => plan.push({ stage: st, situation: null, angle: r, scope }));
    } else if (st.situational) {
      for (const label of columns) {
        plan.push({ stage: st, situation: label, angle: "generic", scope: null });
      }
    } else {
      plan.push({ stage: st, situation: null, angle: "generic", scope });
    }
  }

  const key = cacheKey("grid", [
    STYLE_VERSION,
    input.brand, input.category, rivals.join(","), input.audience,
    JSON.stringify(input.base),
    JSON.stringify(input.scenarios),
    input.stages.map((s) => `${s.key}:${s.columns.join("+")}`).join(","),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) {
    const cached = JSON.parse(hit) as GridCell[];
    return cached.map((c) => ({ ...c, text: humanize(c.text) }));
  }

  const journeyBySituation = new Map(
    input.scenarios.map((s) => [s.label, journeyNote(input.base, s)] as const)
  );
  const planText = plan
    .map((p, i) => {
      const jn = p.situation ? journeyBySituation.get(p.situation) : null;
      return (
        `${i + 1}. stage=${p.stage.key} situation=${p.situation ?? "-"} angle=${p.angle}` +
        `${p.scope ? ` reach=${p.scope}` : ""}${jn ? ` journey(${jn})` : ""}` +
        `\n   guidance: ${p.stage.hint}`
      );
    })
    .join("\n");
  const res = await openaiClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You write the prompts for a research instrument that measures a " +
          "brand's standing in AI assistant answers. For EACH cell in the " +
          "plan, write exactly one prompt as a real person would type it " +
          "into a chat assistant - varied length and register, some lowercase " +
          "and terse, some with backstory; never survey-speak, never a " +
          "requirements list.\n" +
          "Typing, not prose: real asks are often short and get to the " +
          "question fast; fragments happen; details are specific but " +
          "unpolished. NEVER ad-copy patterns - no parallel lists of " +
          "three, no balanced drama ('X is impossible and Y is a " +
          "nightmare'), no polished metaphors, no rhetorical closers " +
          "('get everyone on the same page'). If it would read well on a " +
          "landing page, rewrite it until it reads like a chat message.\n" +
          "Rules:\n" +
          "- angle=generic: never name any brand - blind prompts are the " +
          "measurement - UNLESS the cell's stage guidance says the buyer " +
          "names the client brand (objections about it, its pricing, the " +
          "case for it): there, name the CLIENT brand only, never a rival.\n" +
          "- angle=<rival name>: for comparison-type stages, name the client " +
          "brand AND that rival; for alternatives-type stages, ask for " +
          "alternatives to that rival (client brand NOT named).\n" +
          "- angle=defensive: ask for alternatives to the client brand by name.\n" +
          "- Retention and loyalty stages speak as an existing customer and " +
          "name the client brand where the guidance says so.\n" +
          "- situation: weave the circumstance in naturally; do not label it.\n" +
          "- journey(...): that cell's buyer decides that way - write the " +
          "prompt in that buyer's register.\n" +
          "- reach=<scenarios>: this single cell is asked by buyers in those " +
          "scenarios only - voice it for them.\n" +
          "- Punctuation people actually type: never an em dash, never the " +
          "tilde character - write 'about 10', not '~10'.\n" +
          "Return one cell object per plan line, same stage/situation/angle " +
          "values, in order.",
      },
      {
        role: "user",
        content:
          `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
          `Rivals: ${rivals.join(", ")}\nAudience: ${input.audience ?? "unknown"}\n\n` +
          `Cell plan:\n${planText}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "grid_cells", strict: true, schema: CELLS_SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    cells: { stage: string; situation: string | null; angle: string; text: string }[];
  };
  const scopeByPlan = new Map(plan.map((p, i) => [i, p.scope] as const));
  const byKey = new Map(input.stages.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const cells: GridCell[] = [];
  (parsed.cells ?? []).forEach((c, idx) => {
    const st = byKey.get(c.stage);
    if (!st || !c.text?.trim()) return;
    const norm = c.text.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(norm)) return; // cheap dedupe; no embeddings needed at this scale
    seen.add(norm);
    // The plan writes "-" for invariant cells; models echo it back as a
    // string rather than null.
    const situation =
      c.situation && c.situation.trim() && c.situation.trim() !== "-"
        ? c.situation.trim()
        : null;
    cells.push({
      stage: st.key,
      layer: st.layer,
      situation,
      angle: c.angle,
      mode: scopeByPlan.get(idx) ?? null,
      text: humanize(c.text.trim()),
    });
  });
  await store.cacheSet(key, JSON.stringify(cells));
  return cells;
}

/* ------------------------------ phrasings ------------------------------- */

/** The brands (client + rivals) a text names, lowercased and sorted - the
 * blind/branded signature a paraphrase must preserve from its seed. */
export function brandSignature(
  text: string,
  brand: string,
  competitors: string[]
): string {
  const t = text.toLowerCase();
  return [brand, ...competitors]
    .map((b) => b.trim().toLowerCase())
    .filter((b) => b && t.includes(b))
    .sort()
    .join("|");
}

const PHRASINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cells: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer" },
          phrasings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                asker: { type: "string" },
              },
              required: ["text", "asker"],
            },
          },
        },
        required: ["index", "phrasings"],
      },
    },
  },
  required: ["cells"],
} as const;

export interface Phrasing {
  text: string;
  asker: string;
}

// Bump when the paraphrase prompt or filters change: cached sets written
// under old instructions must not be served as if they were new.
const PHRASINGS_VERSION = "p4";
// Over-generate so the overlap filter can be strict and still fill the set.
const PHRASINGS_EXTRA = 3;

/**
 * Paraphrase sets: for each (confirmed) cell, write the other wordings real
 * buyers would use for the same designed question. Variation comes from
 * wording, register, length, and who is asking - never from changing what
 * is asked. Called in small batches so no single request runs long.
 *
 * Constraints are enforced in code, not trusted to the model: a paraphrase
 * must name exactly the brands its seed names (blind cells stay blind,
 * branded cells keep their rival), and near-duplicates are dropped.
 */
export async function generatePhrasings(input: {
  brand: string;
  category: string;
  competitors: string[];
  audience: string | null;
  base: Moderators;
  scenarios: ScenarioSpec[];
  cells: { stage: string; situation: string | null; angle: string; mode?: string | null; text: string }[];
  /** Total phrasings wanted per cell including the seed. */
  count: number;
  /** Skip the cache read: the user asked for a fresh set. */
  force?: boolean;
  /** Diagnostic hook: receives the raw parsed model output. */
  onRaw?: (raw: unknown) => void;
}): Promise<Phrasing[][]> {
  const want = Math.max(0, input.count - 1);
  if (want === 0 || input.cells.length === 0) return input.cells.map(() => []);
  const rivals = input.competitors.slice(0, 4);
  const key = cacheKey("phrasings", [
    PHRASINGS_VERSION, STYLE_VERSION, input.brand, rivals.join(","), input.audience, String(input.count),
    input.cells.map((c) => `${c.situation ?? ""}|${c.mode ?? ""}|${c.text}`).join("\n"),
  ]);
  const hit = input.force ? null : await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) {
    const cached = JSON.parse(hit) as Phrasing[][];
    return cached.map((cell) => cell.map((ph) => ({ ...ph, text: humanize(ph.text) })));
  }

  const rivalsList = rivals;
  const journeyLines = input.scenarios
    .map((s) => journeyNote(input.base, s))
    .filter((n): n is string => n !== null);
  const journeysText =
    journeyLines.length > 0 ? `Buyer journeys that differ: ${journeyLines.join("; ")}\n` : "";

  /** One model pass over a subset of cells; returns kept phrasings per
   * subset position. Filtering happens here so a retry sees real gaps. */
  async function pass(subset: typeof input.cells): Promise<Phrasing[][]> {
    const cellText = subset
      .map(
        (c, i) =>
          `${i}. [stage=${c.stage} situation=${c.situation ?? "-"} angle=${c.angle}${c.mode ? ` reach=${c.mode}` : ""}] ${c.text}`
      )
      .join("\n");
    const res = await openaiClient().chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You write paraphrase sets for a research instrument that measures " +
            "a brand's standing in AI assistant answers. Each seed prompt below " +
            "is one designed question. For EACH seed, write exactly " +
            `${want + PHRASINGS_EXTRA} additional DISTINCT ways a real buyer would ask the SAME ` +
            "question - same circumstance, same intent, same brands named - in " +
            "the wordings people actually type into a chat assistant.\n" +
            "Each paraphrase is a DIFFERENT PERSON in the same circumstance " +
            "describing it their own way - NOT a rewording of the seed. Do not " +
            "copy the seed's specific details (its numbers, its examples, its " +
            "list of symptoms); invent plausible ones of your own that fit the " +
            "scenario, or leave details out entirely. Some askers give " +
            "backstory, some just ask.\n" +
            "Vary, across the set: who is asking (pick realistic roles for the " +
            "audience - e.g. founder, engineering manager, IT director, " +
            "procurement, a parent, a gift buyer - and tag each with `asker`), " +
            "register (casual forum post to formal RFP language), length (a " +
            "terse 8-word ask to a two-sentence backstory), and question form.\n" +
            "Rules:\n" +
            "- If the seed names NO brand, name NO brand or product in any " +
            "paraphrase. Blind prompts are the measurement.\n" +
            "- If the seed names brands, every paraphrase names exactly those " +
            "same brands and no others.\n" +
            "- Never change the circumstance or the decision being made; never " +
            "add a new constraint the seed does not have.\n" +
            "- No verbatim repeats, no trivial reorderings; each paraphrase " +
            "should be something a different person would plausibly type.\n" +
            "- Punctuation people actually type: never an em dash, never the " +
            "tilde character - write 'about 10', not '~10'.\n" +            "- Typing, not prose: fragments happen, specifics are unpolished; " +
            "never ad-copy patterns (parallel lists of three, balanced " +
            "drama, rhetorical closers). If it would read well on a landing " +
            "page, it is wrong.\n" +
            "- A seed whose situation matches a differing buyer journey is " +
            "asked by that kind of buyer: every asker and register must fit. " +
            "A seed marked reach=<scenarios> is asked only by buyers in those " +
            "scenarios - draw its voices from them. Other seeds serve every " +
            "buyer - vary voices across all of them.\n" +
            `Decision unit: ${input.base.decision_unit}. ` +
            "Return one object per seed with its index and its paraphrases, in order.",
        },
        {
          role: "user",
          content:
            `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
            `Rivals: ${rivalsList.join(", ")}\nAudience: ${input.audience ?? "unknown"}\n` +
            journeysText +
            `\nSeeds:\n${cellText}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "phrasings", strict: true, schema: PHRASINGS_SCHEMA },
      },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
      cells: { index: number; phrasings: Phrasing[] }[];
    };
    input.onRaw?.(parsed);
    const result: Phrasing[][] = subset.map(() => []);
    for (const c of parsed.cells ?? []) {
      const seed = subset[c.index];
      if (!seed) continue;
      const sig = brandSignature(seed.text, input.brand, rivalsList);
      const seen = new Set<string>([norm(seed.text)]);
      const keptWords: Set<string>[] = [wordSet(seed.text)];
      const kept: Phrasing[] = [];
      for (const p of c.phrasings ?? []) {
        const text = humanize((p.text ?? "").trim());
        if (!text) continue;
        // The signature check is the blind/branded discipline: a paraphrase of
        // a blind seed that names a brand is not a paraphrase, it is a leak.
        if (brandSignature(text, input.brand, rivalsList) !== sig) continue;
        const n = norm(text);
        if (seen.has(n)) continue;
        // A paraphrase that shares most of its words with the seed or a sibling
        // is a thesaurus pass, not another person asking; drop it.
        const ws = wordSet(text);
        if (keptWords.some((k) => jaccard(k, ws) > MAX_OVERLAP)) continue;
        seen.add(n);
        keptWords.push(ws);
        kept.push({ text, asker: (p.asker ?? "").trim() });
        if (kept.length >= want) break;
      }
      result[c.index] = kept;
    }
    return result;
  }

  const out = await pass(input.cells);
  // Reasoning models occasionally return a degenerate, near-empty set for a
  // whole batch. One retry on the cells that came up short (under half the
  // target) fills the gap without re-running what already worked.
  const deficient = out.map((k, i) => (k.length < want / 2 ? i : -1)).filter((i) => i >= 0);
  if (deficient.length > 0) {
    const again = await pass(deficient.map((i) => input.cells[i]));
    deficient.forEach((i, k) => {
      if (again[k].length > out[i].length) out[i] = again[k];
    });
  }
  // Never cache an all-empty result: that would make a transient failure sticky.
  if (out.some((k) => k.length > 0)) {
    await store.cacheSet(key, JSON.stringify(out));
  }
  return out;
}

function norm(t: string): string {
  return t.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ");
}

const MAX_OVERLAP = 0.5;
const STOP = new Set(
  "a an the and or of to for in on with we our us is are it this that how what which do does can should would i my me be as at by from have has need want".split(" ")
);

function wordSet(t: string): Set<string> {
  return new Set(norm(t).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Real people type hyphens and straight quotes; model output leans on em
 * dashes and curly quotes, which reads as machine-written to the engines. */
export function humanize(t: string): string {
  return t
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/~\s*(?=\d)/g, "about ")
    .replace(/~/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/  +/g, " ")
    .trim();
}

/* ------------------------------ orchestrator ---------------------------- */

/** Gate 1 of setup: the market read (base journey + scenarios with their
 * journeys) and the participation mask over the stage library. `moderators`
 * is the base read, kept for the parts of the app that store one read. */
export async function composeInstrument(input: {
  category: string;
  audience: string | null;
}): Promise<{
  base: Moderators;
  moderators: Moderators;
  scenarios: ScenarioSpec[];
  reserve: ScenarioSpec[];
  stages: MaskedStage[];
}> {
  const { base, scenarios, reserve } = await readScenarios(input);
  const stages = participationMask(base, scenarios);
  return { base, moderators: base, scenarios, reserve, stages };
}

export interface Instrument {
  base: Moderators;
  moderators: Moderators;
  scenarios: ScenarioSpec[];
  stages: MaskedStage[];
  cells: GridCell[];
}

export async function buildInstrument(input: {
  brand: string;
  category: string;
  competitors: string[];
  audience: string | null;
}): Promise<Instrument> {
  const { base, scenarios, stages } = await composeInstrument({
    category: input.category,
    audience: input.audience,
  });
  const cells = await generateGrid({
    ...input,
    base,
    scenarios,
    stages: stages.filter((st) => st.recommended),
  });
  return { base, moderators: base, scenarios, stages, cells };
}

/** True when a prompt names the brand or any competitor - such prompts are
 * stored with theme "branded" so the unbranded funnel stays blind. */
export function namesAnyBrand(
  text: string,
  brand: string,
  competitors: string[]
): boolean {
  const t = text.toLowerCase();
  return [brand, ...competitors]
    .filter(Boolean)
    .some((b) => t.includes(b.trim().toLowerCase()));
}
