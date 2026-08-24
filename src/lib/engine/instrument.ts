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
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000;
// Version the cache: composer-rule or prompt-style changes must not serve
// grids built under old rules.
const INSTRUMENT_VERSION = "g4";

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
    },
    {
      key: "category_education", label: "Category education", layer: "awareness",
      situational: false, rivals: "none", tag: "rules",
      recommended: m.think_feel === "think" && considered,
      hint: "The buyer asks what the category is or does ('what does a X actually do').",
    },
    {
      key: "discovery", label: "Discovery", layer: "awareness",
      situational: true, rivals: "none", tag: "picks", recommended: true,
      hint: "Open category discovery: 'best X for ...' style asks, no brands named.",
    },
    {
      key: "shortlist", label: "Shortlist", layer: "consideration",
      situational: true, rivals: "none", tag: "picks", recommended: true,
      hint: "The buyer asks for a small set of options to consider.",
    },
    {
      key: "criteria", label: "Criteria formation", layer: "consideration",
      situational: false, rivals: "none", tag: "rules", recommended: true,
      hint: "The buyer asks what to look for / what matters when choosing.",
    },
    {
      key: "feature_screening", label: "Feature screening", layer: "consideration",
      situational: true, rivals: "none", tag: "picks",
      recommended: m.verifiability === "spec",
      hint: "Attribute-first asks: which options have a specific capability.",
    },
    {
      key: "use_case", label: "Use-case fit", layer: "consideration",
      situational: true, rivals: "none", tag: "picks", recommended: true,
      hint: "Situation-first asks describing a concrete need or workflow.",
    },
    {
      key: "social_validation", label: "Social validation", layer: "consideration",
      situational: false, rivals: "none", tag: "picks", recommended: true,
      hint: m.think_feel === "feel"
        ? "What people love, compliment, or identify with - social proof in identity terms."
        : "What people actually use and rate well - reviews, communities, popularity.",
    },
    {
      key: "comparison",
      label: m.verifiability === "taste" ? "Dupes & alternatives" : "Comparison",
      layer: "decision", situational: true, rivals: "each", tag: "picks",
      recommended: considered,
      hint: m.verifiability === "taste"
        ? "Head-to-head and 'similar to X but cheaper/different' asks naming the rival."
        : "Head-to-head asks naming the client brand against the rival.",
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
    },
    {
      key: "objections", label: "Objections / risk", layer: "decision",
      situational: true, rivals: "none", tag: "judges", recommended: true,
      hint: `The buyer voices the category's dominant worry (${m.risk}) about the client brand by name.`,
    },
    {
      key: "pricing", label: "Pricing / value", layer: "decision",
      situational: true, rivals: "none", tag: "judges", recommended: true,
      hint: "Cost and value-for-money asks; some generic to the category (including paid-vs-free where free options exist), some naming the client brand (including its own tiers).",
    },
    {
      key: "business_case", label: "Business case", layer: "decision",
      situational: false, rivals: "none", tag: "judges",
      recommended: m.decision_unit === "committee",
      hint: "The buyer asks for help justifying the client brand internally ('make the case to my CFO').",
    },
    {
      key: "churn_triggers", label: "Churn triggers", layer: "retention",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "An existing customer wonders whether the client brand is still the right choice.",
    },
    {
      key: "alternatives", label: "Alternatives", layer: "retention",
      situational: false, rivals: "defensive_offensive", tag: "picks", recommended: true,
      hint: "'Alternatives to X' asks - one for the client brand (defensive) and one per rival (offensive).",
    },
    {
      key: "renewal", label: "Renewal", layer: "retention",
      situational: false, rivals: "none", tag: "judges",
      recommended: m.rhythm === "subscription",
      hint: "At renewal: is the client brand worth keeping, are there cheaper options.",
    },
    {
      key: "problem_resolution", label: "Problem resolution", layer: "retention",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "A support-style ask: something about the client brand is broken or messy, how to fix it.",
    },
    {
      key: "expansion", label: "Expansion", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "A happy customer considers using the client brand for more ('roll it out further', 'use it for Y too').",
    },
    {
      key: "ecosystem", label: "Ecosystem", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "What works well WITH the client brand - add-ons, companions, integrations.",
    },
    {
      key: "advocacy", label: "Advocacy", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "A customer asks how to defend or recommend the client brand to someone else.",
    },
    {
      key: "repertoire", label: "Repertoire", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers",
      recommended: m.rhythm === "replenishment",
      hint: "Deepening the habit: more from the same brand, or is it worth switching from the usual.",
    },
  ];
}

/** A library entry without the verdict - what the cell planner consumes. */
export function stripVerdict(s: LibraryStage): ComposedStage {
  const { key, label, layer, situational, rivals, tag, hint } = s;
  return { key, label, layer, situational, rivals, tag, hint };
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

/**
 * The market read, in one call: the base journey plus 3-4 buying scenarios,
 * each either inheriting the base or carrying its own journey. Deltas are
 * rare by instruction (A3) and capped at one per grid in code (A4).
 */
export async function readScenarios(input: {
  category: string;
  audience: string | null;
}): Promise<{ base: Moderators; scenarios: ScenarioSpec[] }> {
  const key = cacheKey("scenarios_journeys", [input.category, input.audience]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as { base: Moderators; scenarios: ScenarioSpec[] };
  const res = await openaiClient().chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Read a purchase market for a research instrument over its buying " +
          "decision. Return:\n" +
          "1) base: the market's dominant decision-structure read on seven " +
          "dimensions:\n" + DIMENSION_GUIDE +
          "- rationale: ONE sentence in plain buyer language.\n" +
          "2) scenarios: 3 or 4 buying scenarios. A scenario earns its place " +
          "ONLY if it changes what a competent advisor would recommend - " +
          "facts about the decision, never facts about the speaker. Labels " +
          "are 2-4 plain words; descriptions one short sentence. Spend the " +
          "3-4 slots on DIFFERENT axes of circumstance (scale, composition, " +
          "constraint, occasion, recipient), not variants of one.\n" +
          "3) per scenario, deviates: true ONLY if that scenario's buyer " +
          "DECIDES BY A DIFFERENT PROCESS than the base - differing on " +
          "involvement, verifiability, think_feel, or decision_unit (e.g. " +
          "headphones: a daily-commuter scenario buys habitually on taste " +
          "while the base is considered and spec-driven). A circumstance " +
          "that changes the answer but not the process - tight budget, " +
          "compliance constraint, gift deadline - NEVER deviates. Most " +
          "markets have ZERO deviating scenarios; at most one. When " +
          "deviates is false, journey just repeats the base values.",
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
  const scenarios: ScenarioSpec[] = (parsed.scenarios ?? [])
    .slice(0, 4)
    .map((s) => {
      // A3/A4 in code: a delta must really differ, and only one is granted.
      const wants = s.deviates && !sameJourney(base, s.journey);
      const granted = wants && !deltaGranted;
      if (granted) deltaGranted = true;
      return {
        label: s.label.trim(),
        description: s.description.trim(),
        journey: granted ? s.journey : null,
      };
    })
    .filter((s) => s.label);
  const out = { base, scenarios };
  if (scenarios.length > 0) await store.cacheSet(key, JSON.stringify(out));
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
  const key = cacheKey("scenario_more", [
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
          "variant of one). Use " + SITUATION_TEMPLATE[input.decisionUnit] +
          "Label 2-4 plain words; description one short sentence.",
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
    input.brand, input.category, rivals.join(","), input.audience,
    JSON.stringify(input.base),
    JSON.stringify(input.scenarios),
    input.stages.map((s) => `${s.key}:${s.columns.join("+")}`).join(","),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as GridCell[];

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
          "Rules:\n" +
          "- angle=generic: NEVER name the client brand or any competitor. " +
          "Blind prompts are the measurement.\n" +
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
      text: c.text.trim(),
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
    PHRASINGS_VERSION, input.brand, rivals.join(","), input.audience, String(input.count),
    input.cells.map((c) => `${c.situation ?? ""}|${c.mode ?? ""}|${c.text}`).join("\n"),
  ]);
  const hit = input.force ? null : await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as Phrasing[][];

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
function humanize(t: string): string {
  return t
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...");
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
  stages: MaskedStage[];
}> {
  const { base, scenarios } = await readScenarios(input);
  const stages = participationMask(base, scenarios);
  return { base, moderators: base, scenarios, stages };
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
