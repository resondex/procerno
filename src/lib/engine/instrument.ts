import { createHash } from "crypto";
import { tagCosts, withCostContext } from "../cost_log";
import { anthropicClient, openaiClient } from "./providers";
import { ModeratorsShape } from "./instrument_shapes";
import { INSTRUMENT_HELPER_MODEL } from "./models";
import {
  AMBIGUOUS_FORMS, angleRivals, categoryNounOf, checkBattery, checkCandidateSignature, checkPromptAgainstSpec, classAnglesOf,
  deriveCheckSpec, DOUBT_CHECK_STAGES, MUST_NAME_STAGES, PRE_CATEGORY_STAGES, questionTypeOf, resolveCellSpec, scenarioLabelLeak, seedDesignLine, specWriterNote,
  sameSeatOf, stageDesignIntent, statedPriceFinding, moneyBoltOn, TERM_COLLISIONS, textNamesBrand, textNamesCategory, upstreamOf,
  type CellCheckSpec, type ClassAngle, type QuestionType, type RosterClasses, type RosterRoles,
} from "./battery_checks";
export { MUST_NAME_STAGES };
import { store } from "../store";
import { brandAliasForms } from "./brand_aliases";
import { primeBrandVerdicts } from "./brand_judge";
import { matchKey } from "../brand_key";
import type { CacheMeta } from "../types";

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

/** The market read runs on the full model: it is one cached call per
 * category carrying the most leverage in the pipeline - mini's economy
 * is for the high-volume mechanical calls (cells, phrasings, variants). */
const READ_MODEL = process.env.READ_MODEL ?? "gpt-5";
/** The base-journey CLASSIFICATION runs on Claude Opus, split from the
 * scenario write: a 108-call cross-model matrix (2026-09-16, the four
 * contested walks x v8/v10/v11 x haiku/sonnet/opus) showed Claude the
 * stronger dimension classifier (Opus 23/24 rep-consistent under v11,
 * unanimous on the athena and Pixel boundary cases) while its scenario
 * labels run too vivid for client-facing copy - so Claude classifies,
 * gpt-5 keeps writing. One cached call per category, cost-negligible. */
const JOURNEY_MODEL = process.env.JOURNEY_MODEL ?? "claude-opus-5";
/** The cell writer also runs on the full model: the 52-odd seeds are the
 * DESIGNED questions every paraphrase imitates - one-time, cached, cheap.
 * Paraphrase volume stays on mini. */
const CELLS_MODEL = process.env.CELLS_MODEL ?? "gpt-5";
/** Enumerates a brand's doubt-space at grid-plan time (2026-09-30):
 * one small call per fresh battery, same knowledge class as READ_MODEL. */
const CONCERNS_MODEL = process.env.CONCERNS_MODEL ?? "gpt-5";
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000;
/** Versions the WRITING STYLE of cells and phrasings independently of the
 * instrument rules - a style change regenerates prompt text without
 * discarding scenario reads. */
// s4 = the 2026-09-28 era cut (Tyler): everything generated before the
// checks-and-healing era (must-name rules, seed design healing, in-generation
// filters, tightened number rule) must never serve a NEW project, even for an
// identical brand and category. Existing projects are untouched - their
// prompts are stored rows, not cache reads; orphaned entries age out.
// s5 = the 2026-09-29 audit-fix era (Tyler): meta-text + extra-rival +
// pricing rules, seed-numbers-are-facts inversion, same-concern design
// line, checked alternate-seed path - the six re-walks must not serve
// cells or paraphrases cached before these landed.
// s6 = same day, after the comparison-signature deadlock fix (design-
// derived expected sig, case-blind design-named angle): walk 2 of the six
// drafts regenerates everything under it.
// s7 = typed check-spec era (2026-09-29): every generated cell carries a
// CellCheckSpec derived once from its design after its seed's last heal,
// and the brand/number/design checks verify candidates against it instead
// of re-inferring the design from the seed's spelling - nothing generated
// under the string era serves.
// s8 = the walk-3 audit fixes (2026-09-29): cross-cell doubt-concern
// diversity, universal same-question design lines, pick-eliciting and
// category-term writer rules, product-line (not model-year) naming,
// scenario-label-leak check.
// s9 = concern planning (2026-09-30): doubt cells carry a DESIGNED
// concern assigned from the brand's enumerated doubt-space, and blind
// seeds mechanically require a category noun.
// s10 = scenario-invariant comparisons (2026-10-01): comparison entity and
// class cells carry no scenario (the rival-x-circumstance confound and the
// wrap imbalance are gone) and the writer holds their circumstance light.
// Writer-prompt text changed, so everything generated under the pinned-
// scenario era must not serve.
// s11 = circumstance-NEUTRAL comparisons (2026-10-01, Tyler): s10's "light
// general circumstance" still invited invented flavor (a consulting LLC,
// 4 trips a year) that every paraphrase then had to keep - comparison
// seeds now carry no situation, no identity, no quantities, no spec/size
// qualifiers; the quantity slice is mechanical (comparison_seed_quantity).
// s12 = persona-in-voice-only for INVARIANT cells (2026-10-01, Tyler): an
// invariant cell's paraphrase persona shapes register/length/form and
// never appears in the words (a persona written into neutral comparison
// text re-pins the cell to one buyer's story); situational cells keep the
// leak deliberately - there the circumstance belongs in the text.
// s13 = the circumstance/doubt boundary enforced (2026-10-01, DECIDED):
// pricing design lines demand value-MATH asks, worry lines demand
// VERDICT asks, premium_worth holds the tier-as-class open-choice form
// (never one named brand's own worth) - writer rules and design lines
// changed together.
// "s30" (2026-10-03, init decision 1): pricing is a SCENARIO row - every
// pricing cell names the client brand and asks its value question (worth
// it vs a cheaper option) for the column's buyer; the trade-off-diversity
// rule, the generic-structure cells and the "cheaper line at 450" example
// are gone. Also drops shortlist from the writer's open-choice list
// (decision 2 retired the stage).
// "s31" (2026-10-03, Tyler - vaguer seeds): prompts are short like real
// queries - situation in a few plain words plus the ask, no wanted-features
// list (the answer decides what matters); feature screening asks after ONE
// capability, use-case fit names ONE job. Criteria lists made Discovery /
// Use-case / Feature screening converge in every column and carried the
// client's selling points into blind cells (init audit v2).
// "s32" (2026-10-03, Tyler - stage contract, STAGE_CONTRACT.md): every
// stage's writer rule conforms to its one client question - Value against
// a GENERIC cheaper alternative (never the brand's own tier) with usage in
// plain words; churn/renewal keep leaving possible without a fixed
// both-options closing; comparison and problem_recognition lose their
// quoted shapes; criteria never offers candidate criteria; repertoire is
// habit, not a worry; business_case / expansion / ecosystem / advocacy
// get their contract asks.
// "s33" (2026-10-03, contract audit v4): use_case asks for ONE pick for
// ONE job (it had been left in the open-choice "name a few" rule), each
// use-case cell a different job; switch directions name both platforms
// with no quoted example (every Pixel heal copied "from iOS to Android");
// churn/renewal leaving is a live option, never a token "or"; Value names
// the product LINE; rewrite steers never swap in another client strength.
// "s34" (2026-10-03): use-case asks a job to be done (a task stated without a
// product feature), enforced battery-wide by the use-case job pass; the
// engine's own rules lose their category examples ("years of updates",
// "SSO, reporting and automations") that generated seeds were copying.
// "s35" (2026-10-03, Tyler: no category or brand examples in prompt text): every category or brand example the writers saw is replaced by a
// description of the element - seeds were copying them ("Done with my iPhone",
// carrier trade-in, "a phone I've had for years", "a cheaper phone").
const STYLE_VERSION = "s35";

/** Versions the DETERMINISTIC seed-check set (everything seedRule runs:
 * checkPromptAgainstSpec + blind_missing_category + scenario_label_leak).
 * The cache-era rule's third mechanism, for rules that must reach CACHED
 * cells without redrawing whole batteries: each unit stores the version
 * it was last judged under. A unit judged under an older version (or the
 * legacy bare-array shape) is re-judged at serve exactly once - passing
 * cells upgrade in place with no model call, failing ones regenerate once
 * and the outcome is stored as TERMINAL under the current version,
 * flagged (seedFlags) if the heal couldn't fix them. A current-version
 * unit is never re-judged, so a seed the writer cannot satisfy stops
 * cycling through regeneration on every load (the init-stall loop: round
 * 7's unversioned serve-time re-check had no terminal state). Bump when
 * a deterministic check changes meaning; bumping costs one free re-judge
 * per unit, and model calls only for units the new rules reject. */
export const SEED_RULES_VERSION = "r15"; // r15 (2026-10-02, Tyler's option B): brand mentions = whole names, declared alternates, name words and dictionary aliases, with every ambiguous one-word hit (an everyday word written lowercase or opening a sentence, or a maker word like "Google" of Google Pixel) decided in context by the brand judge (haiku, cached) - no casing rules, no target exemption, no roster word lists. r14 (2026-10-02 review): everyday-word lexicon by lowercase SHARE in two tiers (label words: common and not brand-dominated - "jira", "netflix", "pixel", "apple", "chase" count lowercase again; aliases: merely common - "gold" stays capital-only), coined split words case-blind ("apple or samsung"), the target's own one-word name never case-guarded, "citi" off the case-guard list, and a monthly figure is the asker's plan only in first-person / spend / offer context ("the Pro about 20 a month more" is a stated price). r13 (2026-10-02 cold-walk audit + review): verb-less stated prices ("Gold at 250"); word-anchored price-concern test + money bolt-ons; brand checks read filtered dictionary alias forms ("amex"); everyday words inside brand names never name the brand - category tokens containment-aware, split words of multi-word names in label casing and not sentence-initial, one-word names and aliases in the vault everyday-word lexicon capitalized only, other brands' full names scrubbed first. r4 (2026-10-01): r2 calendar-year/60-word/segment-vocab; r3 category-naming labels exempt from substring leak; r4 'standardization' in segment vocabulary; r5 directionless-switch string check; r6 punctuation-blind label-leak matching; r7-r8 switch direction detected by absence (no OS, no roster brand near switch vocabulary); cheaper bolt-on token on non-price concerns

/** Brand forms that double as ordinary English words: only these demand a
 * capitalized occurrence to count as naming the brand ("2-3 services max"
 * is not Max). Everything else matches case-blind - people type brand
 * names lowercase all the time. */
const SIG_AMBIGUOUS_FORMS = AMBIGUOUS_FORMS;
// Version the cache: composer-rule or prompt-style changes must not serve
// grids built under old rules.
const INSTRUMENT_VERSION = "g7";

function cacheKey(prefix: string, parts: (string | null)[]): string {
  const normalized = parts.map((p) => (p ?? "").trim().toLowerCase()).join("|");
  return `${prefix}:${INSTRUMENT_VERSION}:${createHash("sha256").update(normalized).digest("hex")}`;
}

/** Attribution stamp for llm_cache rows - metadata only, never keyed on.
 * Local brand/category win; the caller's meta fills in source/projectId
 * (and brand for the category-keyed functions that don't take one). */
function stampOf(input: {
  brand?: string;
  category?: string;
  meta?: CacheMeta;
}): CacheMeta {
  return {
    brand: input.brand ?? input.meta?.brand ?? null,
    category: input.category ?? input.meta?.category ?? null,
    source: input.meta?.source ?? null,
    projectId: input.meta?.projectId ?? null,
  };
}

/* --------------------------- in-flight coalescing ------------------------
 * The first request for a key claims it with a pending marker and
 * generates; an identical concurrent request waits for that result instead
 * of repeating the work. Background warms (noWait) never sit blocking on
 * someone else's work. A marker left by a dead generator is taken over
 * once it goes stale - and the wait budget is capped BELOW the routes'
 * time budget, so a takeover still fits inside it. */

/** The WAIT budget: how long a waiter polls a fresh marker before giving
 * up. A waiter that outlives a live generator does not start a duplicate
 * generation - it reports "still cooking" and the caller retries, landing
 * on the finished result. Capped below the routes' time budget so a
 * takeover still fits inside it. */
const COALESCE_PENDING_TTL_MS = 180_000;
const COALESCE_POLL_MS = 2_000;
/** Liveness is a HEARTBEAT, not a claim (2026-09-30): generators refresh
 * their pending markers this often while working, so a marker's age
 * measures time since the generator last proved alive - never total
 * generation time. */
const HEARTBEAT_MS = 20_000;
/** A marker ~2 missed beats old belongs to a dead generator and is taken
 * over. The old scheme trusted a claim-time-only stamp for a TTL sized to
 * the slowest legitimate generation (~120s market reads), so a serverless
 * kill - which runs no cleanup at all - stalled every follow-up request
 * for up to 3 minutes before takeover (the init cell-creation stalls).
 * Heartbeats keep live waits unbounded-safe (the AmEx duplicate-spend
 * failure can't recur: a live generator keeps beating) while dead claims
 * clear in under a minute. */
const ORPHAN_MS = 45_000;
/** generateGrid's self-imposed wall-clock budget (2026-09-30): past this,
 * remaining heal passes are skipped and the pass finalizes what is done -
 * cut-short units as PROVISIONAL (no rules stamp; the next serve
 * re-judges them with a fresh budget), unstarted units released - rather
 * than running into the platform kill at the routes' maxDuration (300s),
 * which runs no cleanup and strands pending markers. Sits just below the
 * wizard's 240s client abort so the server finalizes about when the
 * client gives up and the retry lands on cache. */
const GEN_DEADLINE_MS = 235_000;

/** Refresh the given pending markers every HEARTBEAT_MS until stopped.
 * keys() is read fresh each beat so finished work drops out; callers
 * remove a key from the set and then quiesce() BEFORE its final value
 * write, so a stale beat can never land after the value and re-mask it
 * as pending. stop() also quiesces. */
function startHeartbeat(
  keys: () => string[], meta: CacheMeta | undefined,
  /** Extra fields each beat preserves on a key's marker - a provisional
   * unit's claim carries its CELLS so a platform kill mid-re-judge loses
   * nothing (2026-10-02 review round 4, minor b). */
  payloadOf?: (key: string) => Record<string, unknown> | undefined
): {
  quiesce: () => Promise<void>;
  stop: () => Promise<void>;
} {
  let stopped = false;
  let inflight: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const beat = () => {
    if (stopped) return;
    const ks = keys();
    if (ks.length > 0) {
      inflight = Promise.all(
        ks.map((k) =>
          store.cacheSet(k, JSON.stringify({ __pending: Date.now(), ...(payloadOf?.(k) ?? {}) }), meta).catch(() => {})
        )
      );
    }
    timer = setTimeout(beat, HEARTBEAT_MS);
  };
  timer = setTimeout(beat, HEARTBEAT_MS);
  return {
    quiesce: async () => {
      await inflight.catch(() => {});
    },
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inflight.catch(() => {});
    },
  };
}

function pendingMarkerAt(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { __pending?: number } | unknown[];
    if (Array.isArray(v)) return null;
    return typeof v.__pending === "number" ? v.__pending : null;
  } catch {
    return null;
  }
}

async function coalesced<T>(
  key: string,
  opts: { force?: boolean; noWait?: boolean; meta?: CacheMeta },
  generate: () => Promise<T | null>
): Promise<T | null> {
  const readValue = (raw: string | null): T | null => {
    if (!raw || pendingMarkerAt(raw) !== null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };
  const claimAndRun = async (expectedRaw: string | null, unconditional = false): Promise<T | null> => {
    // CAS claim (2026-10-02 review round 3, item 7): the old read-then-write
    // let two near-simultaneous requests both claim and both generate. A
    // lost race re-enters the wait path once - the winner's work is reused.
    // force claims trample unconditionally (that is what force means).
    const won = unconditional
      ? (await store.cacheSet(key, JSON.stringify({ __pending: Date.now() }), opts.meta), true)
      : await store.cacheClaim(key, expectedRaw, JSON.stringify({ __pending: Date.now() }), CACHE_TTL_MS, opts.meta);
    if (!won) return coalesced(key, opts, generate);
    // Waiters trust the claim only while beats keep landing: a killed
    // invocation is taken over within ~ORPHAN_MS instead of stalling
    // every follow-up request for the whole wait budget.
    const hb = startHeartbeat(() => [key], opts.meta);
    let out: T | null;
    try {
      out = await generate();
    } catch (err) {
      // A THROWN generation (vendor 5xx, timeout, truncated JSON) must not
      // leave the fresh marker standing - the next request would wait on
      // work nobody is doing.
      await hb.stop();
      await store.cacheSet(key, JSON.stringify({ __pending: 0 }), opts.meta).catch(() => {});
      throw err;
    }
    // Stop beating BEFORE the final write - a stale beat landing after it
    // would re-mask the finished value as pending.
    await hb.stop();
    // A failed generation stamps the key retryable (a zero marker reads
    // as stale) instead of caching emptiness or leaving waiters hanging.
    await store.cacheSet(
      key,
      out !== null ? JSON.stringify(out) : JSON.stringify({ __pending: 0 }),
      opts.meta
    );
    return out;
  };
  if (opts.force) return claimAndRun(null, true);
  let raw = await store.cacheGet(key, CACHE_TTL_MS);
  const first = readValue(raw);
  if (first !== null) return first;
  let at = pendingMarkerAt(raw);
  if (at !== null && Date.now() - at < ORPHAN_MS) {
    if (opts.noWait) return null;
    const deadline = Date.now() + COALESCE_PENDING_TTL_MS;
    let orphaned = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, COALESCE_POLL_MS));
      raw = await store.cacheGet(key, CACHE_TTL_MS);
      const v = readValue(raw);
      if (v !== null) return v;
      at = pendingMarkerAt(raw);
      if (at === null || Date.now() - at >= ORPHAN_MS) {
        orphaned = true;
        break;
      }
    }
    // Deadline with the generator still alive: never start a duplicate -
    // report null and let the caller retry onto the finished result.
    if (!orphaned) return null;
  }
  return claimAndRun(raw);
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

// The verifiability and rhythm definitions carry the boundary rules
// because those two dimensions measurably split in sampling (an
// ambulatory-EHR category drew trust/spec/taste 5/3/2 on ten runs
// before the tightening): the classifier needs the tiebreaks, not
// more judgment.
export const DIMENSION_GUIDE =
  "- verifiability: HOW quality is judged. spec = checkable BEFORE " +
  "buying via specs, demos, trials, RFPs, or side-by-side comparison - " +
  "software and equipment evaluated through demos are spec even when " +
  "marketed on 'experience' or 'usability'. taste = judged by personal " +
  "sensory or aesthetic experience of using it (food, fragrance, " +
  "comfort). trust = credence: quality hard to verify even AFTER " +
  "purchase (advisory services, audits, supplements' efficacy). When " +
  "torn between spec and trust for an organization-bought product: if " +
  "buyers run demos and compare feature sheets, it is spec.\n" +
  "- involvement: a considered purchase, or habitual/impulse.\n" +
  "- think_feel: decided mostly rationally, or by identity/emotion.\n" +
  "- decision_unit: one person, a household, or a committee/team.\n" +
  "- rhythm: subscription = an ongoing paid plan or engagement that " +
  "RENEWS BY DEFAULT unless cancelled (SaaS seats, retainers, " +
  "auto-renewing audits). replenishment = the same consumable rebought " +
  "as it runs out. one_shot = each purchase is a fresh decision, " +
  "however often it recurs (projects won case-by-case, device " +
  "upgrades). The test is who acts at renewal time: default-continue = " +
  "subscription, re-decide = one_shot.\n" +
  "- risk: the buyer's dominant worry - performance, financial, " +
  "social (how it looks), or physical (safety).\n" +
  "- channel_retail: true when where-to-buy is a real question " +
  "(retail/DTC goods), false for direct/contracted purchases.\n";

export async function classifyModerators(input: {
  category: string;
  audience: string | null;
  meta?: CacheMeta;
}): Promise<Moderators> {
  tagCosts({ purpose: "setup:moderators" });
  const key = cacheKey("moderators2", [input.category, input.audience]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as Moderators;
  const res = await openaiClient().chat.completions.create({
    model: INSTRUMENT_HELPER_MODEL,
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
  await store.cacheSet(key, JSON.stringify(parsed), stampOf(input));
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
/** Stages removed from the grid. Saved drafts may still carry them in
 * their stage lists; generateGrid / generatePhrasings drop them so no cell
 * is planned or paraphrased for a retired stage. problem_resolution:
 * removed 2026-10-02 (Tyler) - do not re-add until more R&D. */
// shortlist: merged into discovery 2026-10-03 (Tyler, init decision 2) -
// in a single AI question "name a few" and "name 3 or 4" are the same ask
// with the same coded result, so the battery measured it twice per column.
export const RETIRED_STAGES: ReadonlySet<string> = new Set(["problem_resolution", "shortlist"]);

export function stageLibrary(m: Moderators): LibraryStage[] {
  const considered = m.involvement === "considered";
  return [
    {
      // Considered markets only (init decision 2, 2026-10-03): the stage's
      // buyer is someone outside the category, and a habitual market has
      // none - everyone already buys it, so the cells came out as
      // complaints about "my chips".
      key: "problem_recognition", label: "Problem recognition", layer: "awareness",
      situational: true, rivals: "none", tag: "rules", recommended: considered,
      hint: "Pain-phrased and pre-category: the buyer describes the problem and asks for a way out, in their own words, without knowing the SOLUTION category is the answer. Never name the category as a solution, a brand, or ask for a product type. Whatever the buyer already owns is named with the plain category noun, never contorted around - but the asker is never a current customer of the client brand doubting it.",
      why: considered
        ? "A considered journey starts here - buyers describe the pain before they know the category exists."
        : "Habitual buyers are already in the category - there's no pre-category moment to measure.",
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
      hint: "The buyer's situation in plain words plus an ask for which brands or products to look at - no criteria list, no brands named.",
      why: "'Best X for ...' is the front door of AI-assisted buying in every market.",
    },
    {
      // Situational since 2026-08-24: the taught criteria differ by
      // circumstance (an assistant weights simplicity/price for a startup,
      // SSO/compliance for an enterprise) - substantive advice, not a
      // standing verdict.
      key: "criteria", label: "Criteria formation", layer: "consideration",
      situational: true, rivals: "none", tag: "rules", recommended: true,
      hint: "The buyer's situation plus an ask for what to look for or what actually matters - never offering candidate criteria for the answer to rank, never asking which brand.",
      why: "Assistants teach buyers what to value before any brand is named.",
    },
    {
      key: "feature_screening", label: "Feature screening", layer: "consideration",
      situational: true, rivals: "none", tag: "picks",
      recommended: m.verifiability === "spec",
      hint: "Which options have ONE specific capability that buyers in this category commonly screen for - the capability is the whole ask, never one item in a feature list, and never chosen because it suits the client brand.",
      why: m.verifiability === "spec"
        ? "A spec-driven market shops by capability, so attribute asks decide who makes the cut."
        : `Your market verifies by ${m.verifiability}, not specs - buyers don't shop from an attribute checklist.`,
    },
    {
      key: "use_case", label: "Use-case fit", layer: "consideration",
      situational: true, rivals: "none", tag: "picks", recommended: true,
      hint: "ONE job to be done in this situation - something the buyer is trying to get done, stated without naming a product feature - asking which ONE product to pick for it. Never a list of needs, never a feature restated as a job, never the situation itself, and never a job chosen because it suits the client brand.",
      why: "Concrete-need asks are where assistants match options to situations.",
    },
    {
      key: "social_validation", label: "Social validation", layer: "consideration",
      situational: false, rivals: "none", tag: "picks", recommended: true,
      hint: m.think_feel === "feel"
        ? "What people love, compliment, or identify with - social proof in identity terms - inviting named brands or products."
        : "What people actually use and rate well - reviews, communities, popularity - inviting named brands or products.",
      why: "Proof from other people moves every market.",
    },
    {
      key: "comparison",
      label: m.verifiability === "taste" ? "Dupes & alternatives" : "Comparison",
      // Every market since init decision 3 (2026-10-03): "Doritos or Takis
      // for game day?" is a real habitual ask, and the rivals are now the
      // user's head-to-head picks. The old rationale ("habitual buyers
      // don't run head-to-heads") is retired.
      layer: "decision", situational: true, rivals: "each", tag: "picks",
      recommended: true,
      hint: m.verifiability === "taste"
        ? "Names the client brand and the rival and asks which one to pick (any framing is fine as long as it asks for the pick)."
        : "Names the client brand and the rival and asks which one to pick, and why - no situation, no criteria.",
      why: considered
        ? "A considered market weighs finalists head-to-head before committing."
        : "Buyers still weigh one brand against another at the shelf - head-to-heads show who wins those moments.",
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
      hint: "Across brands, not tiers: whether the premium maker genuinely beats the basic/store option - asked from both sides (is the expensive one worth it, is the cheap one good enough). Never one named brand's own worth - that form is a worry cell's job.",
      why: !considered
        ? "A habitual market compresses comparison into one shelf question: is the premium maker worth it."
        : "Your considered market decomposes this moment into Shortlist, Comparison, and Pricing instead.",
    },
    {
      // Considered markets only (init decision 2, 2026-10-03): the stage's
      // buyer is a prospect who isn't a customer yet. In a habitual market
      // the prospect is already an eater, so a worry is asked once, in the
      // in-relationship stance (Churn triggers).
      key: "objections", label: "Objections / risk", layer: "decision",
      situational: true, rivals: "none", tag: "judges", recommended: considered,
      hint: `A prospect states the planned worry about the client brand, by name, as their own claim the answer can confirm or rebut (absent a planned worry: the category's dominant ${m.risk} worry).`,
      why: considered
        ? `Every market has a dominant worry - here it's ${m.risk} risk, voiced about you by name before buying.`
        : "Habitual buyers are already customers - their worries are asked once, as Churn triggers.",
    },
    {
      key: "pricing", label: "Pricing / value", layer: "decision",
      situational: true, rivals: "none", tag: "judges", recommended: true,
      hint: "Value: name the client brand, set it against a GENERIC cheaper alternative in the category (never its own lower tier), give the asker's usage in plain words, and ask for the call - is it worth the price over the cheaper option? Same question in every column - only the buyer changes. Never a rival, never a stated price.",
      why: "Whether the assistant says you're worth the money - and for which buyers - reaches every market.",
    },
    {
      // Situational since 2026-08-24: the justification an assistant writes
      // is built from the circumstance (price/speed for a startup, security
      // review and consolidation for an enterprise) - one cell per
      // committee-reaching column, not one shared case.
      key: "business_case", label: "Business case", layer: "decision",
      situational: true, rivals: "none", tag: "judges",
      recommended: m.decision_unit === "committee",
      hint: "An internal champion in this situation asks for help justifying the client brand, by name, to the people who sign off on the purchase - no rival named.",
      why: m.decision_unit === "committee"
        ? "Committee-bought: someone has to justify the pick internally, and assistants write that case."
        : `A ${m.decision_unit === "household" ? "household" : "solo"} buyer doesn't have to sell the decision internally.`,
    },
    {
      key: "churn_triggers", label: "Churn triggers", layer: "retention",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "An existing customer states a worry about the client brand, by name, leaving the option of leaving open without foreclosing staying.",
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
      hint: "An existing customer whose renewal or bill is coming due asks whether the client brand, named, is still worth paying for - leaving possible, staying not foreclosed.",
      why: m.rhythm === "subscription"
        ? "A subscription market re-decides at every renewal."
        : m.rhythm === "replenishment"
          ? "Your market buys on replenishment - Repertoire carries the repeat decision."
          : "A one-shot market has no renewal moment.",
    },
    // "problem_resolution" REMOVED 2026-10-02 (Tyler): out of the grid and
    // not to be re-added until more R&D. RETIRED_STAGES also drops it from
    // saved drafts' stage lists at the generation boundary.
    {
      key: "expansion", label: "Expansion", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "A satisfied customer names the client brand and ONE specific way of using it more, natural for this category, and asks whether to do it - no rival named, never a support or fix-it ask.",
      why: "Happy customers ask whether to use you for more - growth the assistant can steer.",
    },
    {
      key: "ecosystem", label: "Ecosystem", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "An existing customer names the client brand and asks what to pair with it for ONE specific need - add-ons, companions, integrations.",
      why: "What-works-with-you asks show whether assistants place you at the center of a stack.",
    },
    {
      key: "advocacy", label: "Advocacy", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers", recommended: true,
      hint: "A customer names the client brand and the person they're trying to convince, often quoting that person's objection, and asks for help making the case.",
      why: "Customers recruiting others is your cheapest funnel - if the assistant backs them.",
    },
    {
      key: "repertoire", label: "Repertoire", layer: "loyalty",
      situational: false, rivals: "none", tag: "steers",
      recommended: m.rhythm === "replenishment",
      hint: "A buyer who usually picks the client brand names it and asks whether to stick with it or try something else - the trigger is habit or wanting variety, not a worry.",
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

/** The scenario write's schema - the base journey is classified
 * separately (classifyJourney) and given to the writer, not returned. */
const SCENARIOS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
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
  required: ["scenarios"],
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
/** The base journey, classified by Claude (see JOURNEY_MODEL). Opus 5
 * takes adaptive thinking, which cannot be combined with a FORCED tool
 * call - so the tool stays auto with a hard instruction, and a JSON
 * fallback parse covers the rare prose reply. */
export async function classifyJourney(input: {
  category: string;
  audience: string | null;
}): Promise<Moderators> {
  const a = await anthropicClient();
  const res = await a.messages.create({
    model: JOURNEY_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system:
      "Classify a purchase category on seven decision-structure " +
      "dimensions, for designing a research instrument over its buying " +
      "decision.\n" + DIMENSION_GUIDE +
      "- rationale: ONE sentence justifying the overall read, in plain " +
      "buyer language.\n" +
      "Respond ONLY by calling the base_journey tool - no prose.",
    tools: [{
      name: "base_journey",
      description: "Return the category's base decision-structure read.",
      input_schema: MODERATOR_SCHEMA as never,
    }],
    tool_choice: { type: "auto" },
    messages: [{
      role: "user",
      content: `Category: ${input.category}\nAudience: ${input.audience ?? "unknown"}`,
    }],
  } as never);
  const blocks = (res as { content: { type: string; input?: unknown; text?: string }[] }).content;
  // A malformed read must THROW (retried, never cached) rather than flow a
  // bad base downstream: the routes now validate base, so a cached bad read
  // would 400 every request in its category for six months (2026-10-02
  // review round 4, item 4). The regex fallback especially was unvalidated.
  const validated = (raw: unknown): Moderators => {
    const v = ModeratorsShape.safeParse(raw);
    if (!v.success) throw new Error(`journey classification returned a malformed base: ${v.error.issues[0]?.message ?? "invalid"}`);
    return v.data as Moderators;
  };
  const tool = blocks.find((b) => b.type === "tool_use");
  if (tool?.input) return validated(tool.input);
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const m = firstJsonObject(text);
  if (m) return validated(JSON.parse(m));
  throw new Error("journey classification returned no tool call");
}

export async function readScenarios(input: {
  category: string;
  audience: string | null;
  /** Brand-aware read: scenarios must be occasions THIS brand competes
   * in. Off by default - the shared category read is the cost model -
   * and keyed separately, so tenants sharing a category still share the
   * default read. Offered when the fit advisory finds the shared read
   * handed a multi-product brand rooms it cannot win (Google Nest got
   * robot vacuums; its thermostats got nothing). */
  forBrand?: string | null;
  /** Background warm: never wait on another request's in-flight read. */
  noWait?: boolean;
  meta?: CacheMeta;
  /** A given base journey skips the Opus classification. For evals that
   * hold the journey fixed across model arms; not part of the cache key,
   * so prod callers never pass it. */
  base?: Moderators;
}): Promise<{ base: Moderators; scenarios: ScenarioSpec[]; reserve: ScenarioSpec[] } | null> {
  tagCosts({ purpose: "setup:scenarios" });
  // "scenarios_journeys12": the read is SPLIT - Claude Opus classifies
  // the base journey (see JOURNEY_MODEL), gpt-5 writes the scenarios
  // against that given base. v11 tightened the guide boundaries.
  // 14 (2026-10-03, init decision 4): rooms are written to the positive
  // room rule - a buyer occasion (who, situation, wanted outcome) in the
  // buyer's outcome language, contested by the category's leading
  // brands - instead of only "never name a brand".
  // 15 (2026-10-03, rooms rec A): the brand-aware read no longer forces
  // "its flagship line's occasion" into the core four (it produced Pixel's
  // Android-only "flagship upgrade" room), and no room builds in a
  // platform or ecosystem preference that rules out a leading contender.
  // 16 (2026-10-03, Tyler): rooms go back to the first generation's shape
  // - who the buyer is and their situation, one short plain sentence - with
  // NO wanted-features list. v14's "and the outcome they want" read as a
  // feature wish list ("top-tier camera, screen, and speed", "updates for
  // years") that every cell in the column inherited: rows converged, the
  // client's selling points rode in, and one need dominated blind cells.
  // The contested / in-category / no-platform-lock rules stay.
  // 17 (2026-10-03, contract audit v4): a room is never a product
  // capability (Jira's "Portfolio and roadmaps rollout" collapsed its whole
  // column onto one feature), and never a platform-switch room in a
  // platform-tied category - any stated direction locks a leading maker out
  // (Pixel's "Ecosystem switcher" excluded iPhone from six cells).
  // 18 (2026-10-03): no category examples in the prompt (Tyler's rule).
  // 19 (2026-10-03, room walk v7): the buyer is actively choosing between
  // products (no-choice rooms rose once the active-choice examples were
  // gone), and labels are sentence case.
  const key = cacheKey("scenarios_journeys19", [
    input.category, input.audience, input.forBrand ?? "",
  ]);
  const read = await coalesced<{
    base: Moderators;
    scenarios: ScenarioSpec[];
    reserve: ScenarioSpec[];
  }>(key, { noWait: input.noWait, meta: stampOf(input) }, async () => {
  const base = input.base ?? await classifyJourney(input);
  const res = await openaiClient().chat.completions.create({
    model: READ_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Read a purchase market for a research instrument over its buying " +
          "decision. The market's base decision-structure read is GIVEN " +
          "below - take it as fixed. Its dimensions:\n" + DIMENSION_GUIDE +
          "Return:\n" +
          "1) scenarios: EIGHT buying scenarios, ordered most to least " +
          "central to the market - the first 4 are the core set a " +
          "strategist would field; the rest are credible alternates a user " +
          "might swap in. A scenario earns its place " +
          "ONLY if it changes what a competent advisor would recommend - " +
          "facts about the decision, never facts about the speaker. Labels " +
          "are 2-4 plain words naming the buyer or the circumstance the " +
          "way a strategist would title a slide - never analytical or methodology " +
          "words like 'default', 'habitual', 'segment', 'use case'. " +
          "Labels are in sentence case. Descriptions ONE short plain sentence. Each scenario is a ROOM: " +
          "a buyer occasion in this category - who the buyer is and the " +
          "situation they are in. " +
          "Describe what is happening, never a list of features or criteria " +
          "the buyer wants - the answer decides what matters - and never a " +
          "specific brand or product. " +
          "A room's buyer is actively CHOOSING between products in the " +
          "category - comparing, or at least open to options; a buyer who " +
          "rebuys, renews or takes the next version of what they have " +
          "without looking at anything else is not a room, because there is " +
          "nothing for an answer to steer. A room is CONTESTED: most of the " +
          "category's leading brands are plausible contenders for that " +
          "buyer; a room only one product line serves, or one that belongs " +
          "to a different category, is not this market's room. A room never " +
          "builds in a platform or ecosystem preference that rules out a " +
          "leading contender (naming one platform or ecosystem shuts out " +
          "the brands tied to the others - describe the situation without " +
          "it), and is never " +
          "built on switching between competing platforms or ecosystems when " +
          "the category's leading brands are tied to them (any stated " +
          "direction rules a leading maker out). A room is a buyer's " +
          "circumstance, never a product capability or feature (a label " +
          "that names something the product does, rather than something " +
          "happening to the buyer, is a capability). Spend the " +
          "slots on DIFFERENT axes of circumstance (scale, composition, " +
          "constraint, occasion, recipient), not variants of one.\n" +
          "2) per scenario, deviates: true ONLY if that scenario's buyer " +
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
          "it by name: a concrete moment, each core room on a different " +
          "axis, each changing what an advisor recommends, none a " +
          "demographic. Your market's rooms come from your market.\n" +
          "Before returning, audit the core four for coverage: rank this " +
          "market's buying rooms by how much revenue moves through them, " +
          "ensuring a diverse sampling, and check none of the biggest is " +
          "missing. In categories sold to organizations, the " +
          "large-organization purchase is almost always one of them; if a " +
          "top room is absent it replaces the weakest scenario in the " +
          "core set. If the market genuinely has a second decision " +
          "process - a scenario whose buyer decides differently - its " +
          "room stays in the core set alongside the revenue-ranked ones." +
          (input.forBrand
            ? "\nThis instrument is fielded FOR ONE BRAND, named below. " +
              "Every scenario must be an occasion where that brand " +
              "genuinely competes - centered on product types it actually " +
              "sells today. The wording stays brand-blind as ever: " +
              "describe the circumstance plainly, never name any brand or " +
              "list wanted features, and keep each room contested - one " +
              "the brand's rivals compete in too, not one built on the " +
              "brand's own selling points."
            : ""),
      },
      {
        role: "user",
        content:
          `Category: ${input.category}\nAudience: ${input.audience ?? "unknown"}` +
          `\nBase read (given): ${JSON.stringify(base)}` +
          (input.forBrand ? `\nFielded for brand: ${input.forBrand}` : ""),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "market_read", strict: true, schema: SCENARIOS_SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    scenarios: { label: string; description: string; deviates: boolean; journey: Journey }[];
  };
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
  return out.scenarios.length > 0 ? out : null;
  });
  // Serve-time scrub, cache hits included: the model's labels and
  // descriptions arrive with em dashes and non-breaking hyphens the
  // house style bans. (Ternary, not an if-guard - see composeInstrument.)
  const clean = (sc: ScenarioSpec): ScenarioSpec => ({
    ...sc,
    label: roomLabel(humanize(sc.label)),
    description: humanize(sc.description),
  });
  return read === null
    ? null
    : {
        base: read.base.rationale
          ? { ...read.base, rationale: humanize(read.base.rationale) }
          : read.base,
        scenarios: read.scenarios.map(clean),
        reserve: read.reserve.map(clean),
      };
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
    "buyer circumstances for an individual considered purchase: use-cases, budget tiers, and constraints. ",
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
  meta?: CacheMeta;
}): Promise<Situation | null> {
  tagCosts({ purpose: "setup:scenario_suggest" });
  const avoid = input.exclude.map((s) => s.label.trim().toLowerCase()).filter(Boolean).sort();
  const key = cacheKey("scenario_more6", [
    input.category, input.audience, input.decisionUnit, avoid.join("|"),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) {
    const cached = JSON.parse(hit) as Situation;
    return { label: roomLabel(humanize(cached.label)), description: humanize(cached.description) };
  }
  const res = await openaiClient().chat.completions.create({
    model: INSTRUMENT_HELPER_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Propose exactly ONE additional buyer situation for a research " +
          "instrument. A situation earns its place ONLY if it changes what a " +
          "competent advisor would recommend - facts about the decision, never " +
          "facts about the speaker. It must be genuinely different from every " +
          "situation already listed (a different axis of circumstance, not a " +
          "variant of one), with a buyer actively choosing between products - never one who rebuys or renews without comparing. Scenarios describe circumstances, never a specific brand or product. Use " + SITUATION_TEMPLATE[input.decisionUnit] +
          "Label 2-4 plain words naming the buyer or the circumstance the " +
          "way a strategist would title a slide, in sentence case - never " +
          "analytical or methodology words like 'default', 'habitual', " +
          "'segment', 'use case'. Description one short sentence.",
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
  await store.cacheSet(key, JSON.stringify(fresh), stampOf(input));
  return { label: roomLabel(humanize(fresh.label)), description: humanize(fresh.description) };
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
  meta?: CacheMeta;
}): Promise<Situation[]> {
  tagCosts({ purpose: "setup:scenario_near" });
  const avoid = input.exclude.map((s) => s.label.trim().toLowerCase()).filter(Boolean).sort();
  // scenario_near_pool5 (2026-10-02, Tyler): a near variant is the same buyer
  // with the same need and ONE phrase changed. pool3/4 still swapped in new
  // buyers ("vlogger", "gift for partner") or a refurbished price angle -
  // which read as "Suggest another", not a near neighbor.
  // pool6 (2026-10-03, Tyler): each variant gets its OWN slightly changed
  // headline label naming the adjusted angle, not the original label with
  // a sentence change; and adjustments stay circumstance-shaped (the room
  // rule: no feature emphasis like "low-light photos").
  const key = cacheKey("scenario_near_pool8", [
    input.category, input.audience, input.of.label, input.of.description, avoid.join("|"),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) {
    return (JSON.parse(hit) as Situation[]).map((s) => ({
      label: roomLabel(humanize(s.label)),
      description: humanize(s.description),
    }));
  }
  const res = await openaiClient().chat.completions.create({
    model: INSTRUMENT_HELPER_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Propose exactly THREE near variants of a given buyer situation " +
          "for a research instrument. A near variant is the SAME buyer with " +
          "the SAME need, adjusted - not a new buyer, persona or occasion. " +
          "Keep the original's wording and change ONE part of the " +
          "circumstance: a tighter or looser constraint, a different timing " +
          "or setting, a different scale, or who else is involved - never a " +
          "list of wanted features. Give each variant its OWN label: a " +
          "slight change of the original headline that names the adjusted " +
          "angle, never the original label unchanged. Change a different part per " +
          "variant and order them closest-first. Each " +
          "variant should shift what an advisor would emphasize, differ " +
          "from the others and from everything already listed, and stay " +
          "about the decision (never the speaker). NEVER introduce a money " +
          "angle unless " +
          "the original situation is itself about price, and never turn the " +
          "buyer into one who no longer compares products. Scenarios describe " +
          "circumstances, never a specific brand or product. Labels 2-4 plain " +
          "words in sentence case, never analytical or methodology words like 'default', " +
          "'habitual', 'segment', 'use case'. Descriptions one short sentence.",
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
  // De-duplicate on label AND description: a near variant may keep the
  // original's label and change one phrase of the description. Only an
  // already-listed label (another card) or an exact copy is dropped.
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  const ofKey = `${norm(input.of.label)}|${norm(input.of.description)}`;
  const listed = new Set(avoid.filter((l) => l !== norm(input.of.label)));
  const seen = new Set<string>([ofKey]);
  const pool: Situation[] = [];
  for (const s of parsed.situations ?? []) {
    const k = `${norm(s.label)}|${norm(s.description)}`;
    if (!s.label.trim() || seen.has(k) || listed.has(norm(s.label))) continue;
    seen.add(k);
    pool.push({ label: roomLabel(humanize(s.label.trim())), description: humanize(s.description.trim()) });
    if (pool.length === 3) break;
  }
  if (pool.length > 0) await store.cacheSet(key, JSON.stringify(pool), stampOf(input));
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
  meta?: CacheMeta;
}): Promise<ScenarioVerdict[]> {
  tagCosts({ purpose: "setup:scenario_review" });
  const fp = (s: Situation & { original?: Situation | null }) =>
    `${s.label.trim()}|${s.description.trim()}` +
    (s.original ? `<${s.original.label.trim()}|${s.original.description.trim()}` : "");
  // "scenario_review7": originals in the contract, minimal-edit rules.
  const key = cacheKey("scenario_review8", [
    input.category, input.audience,
    input.candidates.map(fp).join("~"), input.others.map((s) => fp(s)).sort().join("~"),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as ScenarioVerdict[];
  const res = await openaiClient().chat.completions.create({
    model: INSTRUMENT_HELPER_MODEL,
    // A safety net, not a deep thinker - low effort roughly halves the
    // wait at the gate confirm.
    reasoning_effort: "low",
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
  await store.cacheSet(key, JSON.stringify(verdicts), stampOf(input));
  return verdicts;
}

/** A dimension of the base read the BRAND's own buyer may diverge on.
 * The base read is category-modal by design (Opus classifies the
 * category, brand-blind, tenant-shared); a brand whose business model
 * concentrates a different buying pattern - AG1 sells by subscription
 * in a category mostly rebought tub by tub - may warrant a different
 * setting for ITS instrument. Advisory only: applying one is the same
 * radio-pill edit the user could make by hand, pure code, no cache. */
export interface JourneyFit {
  suggestions: {
    dimension: string;
    current: string;
    suggested: string;
    reason: string;
    /** Stages the suggested value would bring into the grid - pure code
     * (a stageLibrary diff), no model. Powers the advisory's SECOND
     * resolution: keep the market-norm read and tick these stages on
     * via the existing keptStages override, instead of flipping the
     * base. The UI offers it only when this list is small (1-2). */
    stagesIn: { key: string; label: string }[];
  }[];
}

const JOURNEY_FIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          dimension: {
            type: "string",
            enum: ["verifiability", "involvement", "think_feel", "decision_unit", "rhythm", "risk"],
          },
          suggested: { type: "string" },
          reason: { type: "string" },
        },
        required: ["dimension", "suggested", "reason"],
      },
    },
  },
  required: ["suggestions"],
} as const;

/**
 * Journey-fit advisory over the base read. Bar set conservative from
 * day one (the scenario advisory needed four calibration rounds to get
 * there): flag ONLY a business-model-level divergence, at most two
 * dimensions, empty for most brands. Suggested values are validated
 * against the dimension enums - an invalid one is dropped, never shown.
 */
export async function reviewJourneyFit(input: {
  brand: string;
  category: string;
  base: Moderators;
  meta?: CacheMeta;
}): Promise<JourneyFit> {
  tagCosts({ purpose: "setup:journey_fit" });
  const dims = ["verifiability", "involvement", "think_feel", "decision_unit", "rhythm", "risk"] as const;
  // "journey_fit3": suggestions carry stagesIn (the stage delta the flip
  // would cause) so cached entries always have it. fit2 framed reasons
  // against the market norm, hinged on audience width.
  // journey_fit5 (2026-10-02): recurring-membership wording + majority of
  // three samples (gpt-5-mini cannot run at temperature 0; one AmEx walk
  // cached an empty advisory where the same prompt usually suggests
  // subscription - the warning was a coin flip).
  const key = cacheKey("journey_fit5", [
    input.brand, input.category,
    dims.map((d) => String(input.base[d])).join("|"),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as JourneyFit;
  const sample = () => openaiClient().chat.completions.create({
    model: INSTRUMENT_HELPER_MODEL,
    reasoning_effort: "low",
    messages: [
      {
        role: "system",
        content:
          "You check whether a brand's TYPICAL buyer decides differently " +
          "than the category at large. The read below describes the " +
          "CATEGORY's dominant decision structure; a brand whose business " +
          "model concentrates a different buying pattern may warrant a " +
          "different setting for its own instrument. Dimensions:\n" +
          DIMENSION_GUIDE +
          "Suggest a change ONLY for a clear BUSINESS-MODEL-level " +
          "difference - a subscription-first brand in a category mostly " +
          "rebought off the shelf, a committee-sold brand in a solo-buyer " +
          "category. When the PRODUCT ITSELF is an account or membership " +
          "that renews by default with a recurring fee (an annual-fee card, " +
          "a warehouse membership, an auto-renewing plan), that is a " +
          "subscription-style relationship even when the category is mostly " +
          "bought once - its buyers re-decide at every renewal. A one-off " +
          "product whose maker ALSO sells add-on services (a phone with a " +
          "cloud plan) is not. Status, prestige or a loyal fan base is never " +
          "a reason to change head-or-heart, and a product shared at home " +
          "is not a household decision unless the household decides together. Never suggest because the brand is premium, popular, " +
          "or big; only when its buyers' PROCESS differs. At most TWO " +
          "suggestions; MOST brands match their category, and an empty " +
          "list is the common, correct answer. suggested must be a valid " +
          "value for that dimension.\n" +
          "reason: one plain sentence framed against the MARKET NORM - " +
          "the current setting is the category's norm, not a mistake, so " +
          "say what the brand's buyers do differently and make clear the " +
          "choice depends on whether the user is measuring this brand's " +
          "own buyers or the category at large. Example shape: 'X appears " +
          "to sell mostly by subscription, so if you are measuring X's " +
          "own buyers rather than the wider market, subscription may fit " +
          "better than the market-norm replenishment.'\n" +
          "Voice: this is ADVICE the user weighs, never a verdict. Write " +
          "every reason tentatively - 'appears to', 'may', 'tends to' - " +
          "and never declare the read wrong.",
      },
      {
        role: "user",
        content: JSON.stringify({
          brand: input.brand,
          category: input.category,
          read: Object.fromEntries(dims.map((d) => [d, input.base[d]])),
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "journey_fit", strict: true, schema: JOURNEY_FIT_SCHEMA },
    },
  });
  const runs = await Promise.all([sample(), sample(), sample()]);
  type Sug = { dimension: string; suggested: string; reason: string };
  const samples = runs.map((r) => (JSON.parse(r.choices[0]?.message?.content ?? "{}") as { suggestions?: Sug[] }).suggestions ?? []);
  // Keep a suggestion only when at least two of three samples make it (same
  // dimension and value); its reason comes from the first sample that does.
  const votes = new Map<string, { n: number; s: Sug }>();
  for (const list of samples) {
    const seen = new Set<string>();
    for (const sg of list) {
      const k = `${sg.dimension}=${sg.suggested}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const v = votes.get(k);
      if (v) v.n++; else votes.set(k, { n: 1, s: sg });
    }
  }
  const parsed = { suggestions: [...votes.values()].filter((v) => v.n >= 2).sort((a, b) => b.n - a.n).map((v) => v.s) };
  const plainText = (t: string) => humanize((t ?? "").replace(/\s*[—–]\s*/g, " - "));
  const valid = (d: string, v: string) =>
    ((MODERATOR_PROPS as Record<string, { enum?: readonly string[] }>)[d]?.enum ?? []).includes(v);
  const fit: JourneyFit = {
    suggestions: (parsed.suggestions ?? [])
      .filter((s) => valid(s.dimension, s.suggested) &&
        String(input.base[s.dimension as (typeof dims)[number]]) !== s.suggested)
      .slice(0, 2)
      .map((s) => {
        // The stage delta the flip would cause - what the "keep the
        // market view" resolution would tick on instead.
        const wasIn = new Set(
          stageLibrary(input.base).filter((st) => st.recommended).map((st) => st.key)
        );
        const flipped = { ...input.base, [s.dimension]: s.suggested } as Moderators;
        const stagesIn = stageLibrary(flipped)
          .filter((st) => st.recommended && !wasIn.has(st.key))
          .map((st) => ({ key: st.key, label: st.label }));
        return {
          dimension: s.dimension,
          current: String(input.base[s.dimension as (typeof dims)[number]]),
          suggested: s.suggested,
          reason: plainText(s.reason),
          stagesIn,
        };
      }),
  };
  await store.cacheSet(key, JSON.stringify(fit), stampOf(input));
  return fit;
}

export interface ScenarioFit {
  /** Scenarios that fall OUTSIDE what the brand actually sells - a
   * category-level scenario the client can never win (Nest asked about
   * robot vacuums). Advisory only; the user decides. */
  offPortfolio: { label: string; reason: string }[];
  /** A scenario the set is INCOMPLETE without - a flagship product line
   * with no scenario (Nest's thermostats) or a major buying occasion
   * central to how this brand is bought (Doritos's single-serve). Null is
   * the expected answer; the bar is "a strategist would insist", never
   * "would also be plausible". */
  missingCore: { label: string; description: string; reason: string } | null;
}

const SCENARIO_FIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    off_portfolio: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          reason: { type: "string" },
        },
        required: ["label", "reason"],
      },
    },
    missing_core: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        description: { type: "string" },
        reason: { type: "string" },
      },
      required: ["label", "description", "reason"],
    },
  },
  required: ["off_portfolio", "missing_core"],
} as const;

/**
 * Portfolio-fit advisory over the composed scenarios. The market read is
 * deliberately brand-blind (keyed on category+audience so tenants share
 * it), which means a multi-product brand can be handed a category-true
 * scenario it can never win, or miss its core line entirely. This check
 * layers brand knowledge ON TOP of the shared read - it never changes
 * the scenarios, it only advises.
 */
export async function reviewScenarioFit(input: {
  brand: string;
  category: string;
  scenarios: Situation[];
  /** The study audience - the suggested scenario is pre-checked with the
   * same reviewScenarios call the gate runs, which takes it. */
  audience?: string | null;
  meta?: CacheMeta;
}): Promise<ScenarioFit> {
  tagCosts({ purpose: "setup:scenario_fit" });
  const empty: ScenarioFit = { offPortfolio: [], missingCore: null };
  if (input.scenarios.length === 0) return empty;
  // "scenario_fit4": tentative voice - advice reads as "you may want
  // to", never a verdict. fit3 softened the bar; fit2 over-suppressed;
  // fit1 suggested on every brand.
  // scenario_fit6 (2026-10-02): the suggested scenario passes the gate's
  // own scenario check before it is offered (the AmEx "Dining & groceries
  // rewards" suggestion was flagged "mixed decision factors" one screen
  // later by reviewScenarios).
  // scenario_fit7 (2026-10-03, init decision 4): the suggestion is written
  // to the room rule (buyer occasion, outcome language, contested, in the
  // category) - fit6 proposed "Buying the top-tier Pixel..." on Pixel and
  // Jira Service Management's help-desk room on Jira - and a suggestion
  // that names the client brand is dropped mechanically.
  // scenario_fit8 (2026-10-03): the suggested room is circumstance-only,
  // like the scenario read (v16) - no wanted-features list.
  const key = cacheKey("scenario_fit9", [
    input.brand, input.category, input.audience ?? "",
    input.scenarios.map((s) => `${s.label.trim()}|${s.description.trim()}`).join("~"),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as ScenarioFit;
  const res = await openaiClient().chat.completions.create({
    model: INSTRUMENT_HELPER_MODEL,
    reasoning_effort: "low",
    messages: [
      {
        role: "system",
        content:
          "You check whether buying scenarios fit a specific brand's actual " +
          "product portfolio. The scenarios were written for the CATEGORY; " +
          "the brand may sell only part of it.\n" +
          "- off_portfolio: scenarios centered on a product type the brand " +
          "does not sell at all (the brand cannot win that buyer). Only " +
          "flag a clear mismatch - a scenario the brand serves indirectly " +
          "or partially is FINE. reason: one plain sentence.\n" +
          "- missing_core: a scenario a competent strategist would " +
          "RECOMMEND adding - a flagship product line with no scenario, or " +
          "a buying occasion central to how THIS brand is bought that the " +
          "set does not cover. Propose at most one (label 2-4 plain words, " +
          "description one short sentence in buyer language). Write it as a " +
          "ROOM: a buyer occasion in THIS category - who the buyer is and " +
          "their situation, in one short plain sentence, never a list of " +
          "features they want, with a buyer actively choosing between " +
          "products (never one who rebuys or renews without comparing). Never name " +
          "the brand or any product, and never build the room from the " +
          "brand's own selling points; the room must be one the brand's " +
          "rivals compete in too. A room the brand serves with a product in " +
          "a DIFFERENT category (a separate product line sold to a " +
          "different kind of buyer) is not a missing core room for this " +
          "study. The bar is a " +
          "real recommendation the strategist would defend, never brain" +
          "storming - if nothing clearly earns a place, null. Many scenario " +
          "sets are complete; null is a normal answer.\n" +
          "Be conservative on off_portfolio: empty is the common, correct " +
          "answer.\n" +
          "Voice: this is ADVICE the user weighs, never a verdict. Write " +
          "every reason tentatively - 'appears to', 'may not', 'does not " +
          "seem to' - and never declare the set wrong or incomplete.",
      },
      {
        role: "user",
        content: JSON.stringify({
          brand: input.brand,
          category: input.category,
          scenarios: input.scenarios.map((s) => ({ label: s.label, description: s.description })),
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "scenario_fit", strict: true, schema: SCENARIO_FIT_SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    off_portfolio?: { label: string; reason: string }[];
    missing_core?: { label: string; description: string; reason: string } | null;
  };
  const labels = new Set(input.scenarios.map((s) => s.label.trim().toLowerCase()));
  // House style: no em dashes in user-facing text.
  const plain = (t: string) => humanize((t ?? "").replace(/\s*[—–]\s*/g, " - "));
  const fit: ScenarioFit = {
    // Only flags that name a real scenario survive - a hallucinated label
    // would render as advice about nothing.
    offPortfolio: (parsed.off_portfolio ?? [])
      .filter((f) => labels.has((f.label ?? "").trim().toLowerCase()))
      .map((f) => ({ label: f.label, reason: plain(f.reason) })),
    missingCore: parsed.missing_core
      ? {
          label: roomLabel(plain(parsed.missing_core.label)),
          description: plain(parsed.missing_core.description),
          reason: plain(parsed.missing_core.reason),
        }
      : null,
  };
  // Decision 4: a suggested room never names the client (mechanical - the
  // prompt rule alone let "the top-tier Pixel" through).
  if (fit.missingCore && textNamesBrand(`${fit.missingCore.label}. ${fit.missingCore.description}`, input.brand)) {
    fit.missingCore = null;
  }
  // Our own suggestion must pass our own check: run it through the gate's
  // scenario review. A flagged suggestion is offered as the review's
  // corrected version; one the review cannot correct is not offered.
  if (fit.missingCore) {
    try {
      const [v] = await reviewScenarios({
        category: input.category, audience: input.audience ?? null,
        candidates: [{ label: fit.missingCore.label, description: fit.missingCore.description }],
        others: input.scenarios, meta: input.meta,
      });
      if (v && !v.ok) {
        const fixed = v.suggestion;
        const changed = fixed && (fixed.label.trim() !== fit.missingCore.label.trim() || fixed.description.trim() !== fit.missingCore.description.trim());
        fit.missingCore = changed ? { ...fit.missingCore, label: plain(fixed.label), description: plain(fixed.description) } : null;
      }
    } catch (err) {
      console.error("scenario fit pre-check failed open:", err);
    }
  }
  await store.cacheSet(key, JSON.stringify(fit), stampOf(input));
  return fit;
}

/** One room's contest verdict (init decision 4). */
export interface RoomCheck {
  label: string;
  /** Direct rivals (names as given) that are plausible contenders for
   * this room's buyer. */
  contenders: string[];
  /** How many direct rivals were weighed. */
  rivals: number;
  /** Contested (rooms rec A, 2026-10-03): at least half of the
   * head-to-head picks AND at least 2 direct rivals contend. Premium rooms
   * are contested by a subset of issuers by market structure, so "half of
   * ALL direct rivals" raised false ambers on AmEx. Without picks, half of
   * the direct rivals. */
  contested: boolean;
  /** A phrase in the room worded as one brand's own selling point rather
   * than the buyer's outcome; empty when none. */
  pitch: string;
  /** Tracked brands (client or rivals) the room's text names. */
  names: string[];
  /** The room is a product capability or feature, not a buyer's
   * circumstance (Jira's "Portfolio planning at scale"). */
  capability: boolean;
  /** The buyer in the room makes no real choice (accepts a default,
   * renews automatically, takes whatever is in stock) - nothing for an
   * answer to steer (Pixel's "Upgrade program autopilot"). */
  noChoice: boolean;
  /** The room is a switch between competing platforms or ecosystems -
   * any direction its seeds must state locks a leading brand out
   * (Pixel's "Cross-ecosystem switcher"). */
  platformSwitch: boolean;
}

/**
 * The scenarios gate's contest check (init decision 4, 2026-10-03): for
 * each room, which of the tracker's DIRECT rivals compete for its buyer,
 * and whether its wording borrows one brand's pitch. Brands tailor their
 * pitch to the rooms that matter, so a room the client is strong in is
 * fine - the test is whether the rivals are in the room too. Runs per
 * tracker (the market read is shared across a category and never sees a
 * roster), cached per room, one batched call for the uncached rooms.
 * Brand names are found mechanically. Fails open to no verdicts.
 */
type RoomCheckInput = {
  brand: string;
  category: string;
  /** Direct rivals only (same_seat + bench) - upstream and adjacent
   * brands are not the room's contenders by definition. */
  rivals: string[];
  /** The head-to-head picks (the contest bar reads them). */
  picks?: string[];
  rooms: Situation[];
  meta?: CacheMeta;
};

/** A room check result fails when the judgment says the room is not a
 * contested buyer occasion. Brand names are a mechanical find, not a
 * judgment, so they never trigger a second opinion. */
const roomJudgedFail = (c: RoomCheck) =>
  !c.contested || !!c.pitch || c.capability || c.platformSwitch || c.noChoice;

/**
 * Room check with a second opinion (2026-10-03 room walk v7: 4 of 7
 * swapped-out rooms passed a re-check - one low-effort roll was deciding
 * the swap). A room whose first check fails on a judgment gets ONE more
 * independent check, cached under its own key; it fails only when both
 * fail, and a passing second check becomes the room's verdict (the gate
 * chips and contest repair read the same result).
 */
export async function checkRooms(input: RoomCheckInput): Promise<RoomCheck[]> {
  const first = await checkRoomsPass(input, 1);
  const failing = first.filter(roomJudgedFail).map((c) => c.label);
  if (failing.length === 0) return first;
  const second = await checkRoomsPass(
    { ...input, rooms: input.rooms.filter((r) => failing.includes(r.label)) }, 2,
  ).catch(() => [] as RoomCheck[]);
  const passed = new Map(second.filter((c) => !roomJudgedFail(c)).map((c) => [c.label, c]));
  return first.map((c) => passed.get(c.label) ?? c);
}

async function checkRoomsPass(input: RoomCheckInput, pass: number): Promise<RoomCheck[]> {
  tagCosts({ purpose: "setup:room_check" });
  const rivals = [...new Set(input.rivals.map((r) => r.trim()).filter(Boolean))];
  const rooms = input.rooms.filter((r) => r.label.trim());
  if (rooms.length === 0) return [];
  const roomText = (r: Situation) => `${r.label}. ${r.description}`;
  // Ambiguous one-word hits ("DevOps" of Azure DevOps) go to the brand
  // judge first, exactly as the seed checks do - an unjudged hit counts as
  // named, which made the chip read "Names Azure DevOps" on a room that
  // only says DevOps.
  try {
    await primeBrandVerdicts({
      items: rooms.map((r) => ({ text: roomText(r), brands: [input.brand, ...rivals] })),
      roster: [input.brand, ...rivals], aliases: {}, category: input.category, meta: input.meta,
    });
  } catch { /* fail open: unjudged hits count as named */ }
  const namesOf = (r: Situation) =>
    [input.brand, ...rivals].filter((b) => textNamesBrand(roomText(r), b));
  const keyOf = (r: Situation) => cacheKey("room_check5", [
    DESIGN_CHECK_MODEL, input.brand, input.category, [...rivals].map((x) => x.toLowerCase()).sort().join(","),
    `${r.label.trim()}|${r.description.trim()}`,
    ...(pass > 1 ? [`pass${pass}`] : []),
  ]);
  const keys = rooms.map(keyOf);
  let cached: Map<string, string>;
  try { cached = await store.cacheGetMany(keys, CACHE_TTL_MS); } catch { cached = new Map(); }
  const verdicts = new Map<number, { contenders: string[]; pitch: string; capability?: boolean; platformSwitch?: boolean; noChoice?: boolean }>();
  rooms.forEach((_, i) => {
    const hit = cached.get(keys[i]);
    if (hit) { try { verdicts.set(i, JSON.parse(hit)); } catch { /* re-judge */ } }
  });
  const misses = rooms.map((_, i) => i).filter((i) => !verdicts.has(i));
  if (misses.length > 0 && rivals.length > 0) {
    try {
      const a = await anthropicClient();
      const res = await a.messages.create({
        model: DESIGN_CHECK_MODEL,
        max_tokens: 1500,
        output_config: { effort: DESIGN_CHECK_EFFORT },
        system:
          `Each buying room below is a buyer occasion in the ${input.category} market. For each room give:\n` +
          `- contenders: which of these brands are plausible contenders for that room's buyer - ${rivals.join(", ")} - names exactly as given. A brand contends when a buyer in that room would reasonably consider it; it need not be the favorite.\n` +
          `- pitch: if the room's wording borrows ONE specific brand's own selling-point vocabulary (its signature feature names, taglines or platform labels) instead of the buyer's outcome language, quote that phrase; otherwise an empty string. Buyer outcomes every contender speaks to are not pitch.\n` +
          `- capability: true when the room is a product capability or feature being adopted rather than a buyer's circumstance (who they are and what situation they are in).\n` +
          `- platformSwitch: true when the room is about switching between competing platforms or ecosystems - any direction a question must state rules a leading brand out. Moving off an old or homegrown solution is NOT a platform switch.\n` +
          `- noChoice: true when the room's buyer makes no real choice between products - accepting the next model by default without comparing - so there is nothing for an answer to steer.\n` +
          `Reply with ONLY JSON: {"rooms": [{"contenders": [...], "pitch": "...", "capability": false, "platformSwitch": false, "noChoice": false}, ...]} - one entry per room, in order.`,
        messages: [{
          role: "user",
          content: misses.map((i, k) => `${k + 1}. ${rooms[i].label}: ${rooms[i].description}`).join("\n"),
        }],
      } as never);
      const text = (res as { content: { type: string; text?: string }[] }).content
        .filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      // Malformed JSON (an unescaped quote inside a pitch phrase) left three
      // brands' rooms unchecked in the 2026-10-03 draws: parse defensively,
      // then ask once more for strict JSON before failing open.
      const parse = (t: string) => { try { return JSON.parse(firstJsonObject(t) ?? t) as { rooms?: { contenders?: string[]; pitch?: string; capability?: boolean; platformSwitch?: boolean; noChoice?: boolean }[] }; } catch { return null; } };
      let j = parse(text);
      if (!j) {
        const res2 = await a.messages.create({
          model: DESIGN_CHECK_MODEL, max_tokens: 1500, output_config: { effort: DESIGN_CHECK_EFFORT },
          system: "Reply with ONLY valid JSON, no prose. Quote marks inside strings must be escaped; if a pitch phrase contains a quote mark, drop it from the phrase.",
          messages: [{ role: "user", content: `Rewrite this as valid JSON of the shape {"rooms": [{"contenders": [...], "pitch": "...", "capability": false, "platformSwitch": false, "noChoice": false}]}:\n${text}` }],
        } as never);
        j = parse((res2 as { content: { type: string; text?: string }[] }).content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim());
      }
      if (!j) throw new Error("room check reply was not valid JSON");
      // Names map back by brand key across a label's forms - "Samsung
      // (Galaxy)" is also "Samsung Galaxy", "Samsung" and "Galaxy" (the
      // exact-string map dropped Samsung and Apple from every Pixel room).
      const formsOf = (r: string) => {
        const base = r.replace(/\s*\([^)]*\)/g, " ").trim();
        const paren = [...r.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
        return [r, base, `${base} ${paren.join(" ")}`, ...paren, ...base.split("/"), ...paren.flatMap((x) => x.split("/"))]
          .map((f) => matchKey(f)).filter(Boolean);
      };
      const rivalForms = rivals.map((r) => ({ r, forms: new Set(formsOf(r)) }));
      const resolve = (name: string): string | undefined => {
        const k = matchKey(name);
        if (!k) return undefined;
        return rivalForms.find((x) => x.forms.has(k))?.r
          ?? rivalForms.find((x) => [...x.forms].some((f) => f.length > 3 && (k.includes(f) || f.includes(k))))?.r;
      };
      await Promise.all(misses.map(async (i, k) => {
        const row = j.rooms?.[k];
        if (!row) return;
        // Only names we sent survive - the model never adds a brand.
        const contenders = [...new Set((row.contenders ?? []).map((c) => resolve(String(c))).filter((c): c is string => !!c))];
        const v = {
          contenders,
          pitch: humanize(String(row.pitch ?? "").replace(/\s*[—–]\s*/g, " - ")).slice(0, 80),
          capability: row.capability === true,
          platformSwitch: row.platformSwitch === true,
          noChoice: row.noChoice === true,
        };
        verdicts.set(i, v);
        await store.cacheSet(keys[i], JSON.stringify(v), stampOf(input)).catch(() => {});
      }));
    } catch (err) {
      console.error("room check failed open:", err);
    }
  }
  return rooms.flatMap((r, i) => {
    const v = verdicts.get(i);
    const names = namesOf(r);
    if (!v && rivals.length > 0) return names.length > 0 ? [{ label: r.label, contenders: [], rivals: rivals.length, contested: true, pitch: "", names, capability: false, platformSwitch: false, noChoice: false }] : [];
    const contenders = v?.contenders ?? [];
    const picks = (input.picks ?? []).filter((p) => rivals.includes(p));
    const contested = rivals.length === 0
      ? true
      : picks.length > 0
        ? contenders.filter((c) => picks.includes(c)).length >= Math.ceil(picks.length / 2) && contenders.length >= Math.min(2, rivals.length)
        : contenders.length >= Math.ceil(rivals.length / 2);
    // A pitch flag must quote words the room actually contains (Doritos'
    // "Scoops" flag quoted a Tostitos line the room never mentioned).
    const pitchRaw = (v?.pitch ?? "").trim().replace(/^["']|["']$/g, "");
    const pitch = pitchRaw && roomText(r).toLowerCase().includes(pitchRaw.toLowerCase()) ? pitchRaw : "";
    return [{ label: r.label, contenders, rivals: rivals.length, contested, pitch, names, capability: v?.capability === true, platformSwitch: v?.platformSwitch === true, noChoice: v?.noChoice === true }];
  });
}

/**
 * Contest-repair a fresh scenario set (contract audit v4, 2026-10-03): a
 * core room that names a tracked brand, borrows one brand's pitch, or is
 * not contested by the tracker's head-to-head rivals is replaced by the
 * best passing reserve room, and the replaced room joins the reserve so
 * the user can bring it back. Runs per tracker (needs the roster). Fails
 * open: no verdicts, no swaps.
 */
export async function contestRoomSet(input: {
  brand: string; category: string; rivals: string[]; picks?: string[];
  scenarios: ScenarioSpec[]; reserve: ScenarioSpec[]; meta?: CacheMeta;
}): Promise<{ scenarios: ScenarioSpec[]; reserve: ScenarioSpec[]; checks: RoomCheck[]; swaps: { out: string; in: string }[] }> {
  const all = [...input.scenarios, ...input.reserve];
  const checks = await checkRooms({
    brand: input.brand, category: input.category, rivals: input.rivals, picks: input.picks,
    rooms: all.map((s) => ({ label: s.label, description: s.description })), meta: input.meta,
  }).catch(() => [] as RoomCheck[]);
  const by = new Map(checks.map((c) => [c.label, c]));
  const passes = (s: ScenarioSpec) => {
    const c = by.get(s.label);
    return !c || (c.contested && c.names.length === 0 && !c.pitch && !c.capability && !c.platformSwitch && !c.noChoice);
  };
  const scenarios = [...input.scenarios];
  let reserve = [...input.reserve];
  const swaps: { out: string; in: string }[] = [];
  // A replacement must not near-duplicate a room that stays (Doritos'
  // "Warehouse club stock-up" replaced a failing room and nearly repeated
  // "Family pantry restock", 2026-10-03 audit).
  const roomWords = (r: ScenarioSpec) => wordSet(`${r.label} ${r.description}`);
  const tooClose = (r: ScenarioSpec, keep: ScenarioSpec[]) =>
    keep.some((k) => jaccard(roomWords(r), roomWords(k)) >= 0.3);
  scenarios.forEach((s, i) => {
    if (!by.has(s.label) || passes(s)) return;
    const keep = scenarios.filter((_, k) => k !== i);
    const j = reserve.findIndex((r) => by.has(r.label) && passes(r) && !tooClose(r, keep));
    if (j < 0) return;
    const incoming = reserve[j];
    reserve = [...reserve.slice(0, j), ...reserve.slice(j + 1), { ...s, journey: null }];
    scenarios[i] = { ...incoming, journey: null };
    swaps.push({ out: s.label, in: incoming.label });
  });
  return { scenarios, reserve, checks, swaps };
}

/** Why a prompt edit was flagged: drift, brand design, coherence, or a
 * doubt/plan cell whose paraphrase no longer voices its design. */
export type CellFlag = "target" | "branding" | "unclear" | "design";

/** See checkDesignFidelity. sonnet-5 at LOW effort per the 2026-09-29
 * bakeoff vs the opus-5.5(medium) reference on the 508-paraphrase
 * same-concern fixture: 99.2% agreement, all 10 real drift kills caught,
 * 4 gray-zone false kills (the reference's own noise band), ~3x cheaper
 * and ~2x faster (design_check_bakeoff/report.md). Opus remains one env
 * flip away (DESIGN_CHECK_MODEL + DESIGN_CHECK_EFFORT=medium). */
const DESIGN_CHECK_MODEL = process.env.DESIGN_CHECK_MODEL ?? "claude-sonnet-5";
const DESIGN_CHECK_EFFORT = process.env.DESIGN_CHECK_EFFORT ?? "low";

export const DESIGN_CHECK_SYSTEM = `You check survey questions against their design. Each question was written for a cell with a stated design:
- Doubt design: the question should itself voice a concern, complaint, doubt or "is it still worth it / should I cut it" about the named brand or option.
- Plan design: the question should itself carry a customer's plan with the named brand (use it for more, find products that work with it, recommend or defend it to someone).
- Same-question design (no doubt/plan named): the question should ask the same designed question - same subject, same circumstance, same kind of ask. A which-one ask rewritten as a features-only or where-to-research ask does not satisfy it.
Decide whether THIS question voices its design. A neutral information request, a how-to, or a lookup that never states or asks the concern (or plan) does NOT voice it, even if it is on the same topic. When the design includes 'Designed as: "..."', the question must carry the SAME specific concern or plan as that designed question - the same subject, not merely any concern or plan of the same kind about the same brand. Different wording, register, backstory and detail are expected and fine; a different subject is not. Judge only the question's words, never what an answer might say.
Reply with ONLY: {"voices_design": true|false, "reason": "<one short sentence>"}`;

/** The extended verdict (2026-10-02, Tyler's resolver plan): the SAME
 * design judgment - the v1 instructions verbatim, so the validated
 * voices_design behavior carries over (validation re-measures it) - plus
 * the semantic facts the string checks kept approximating: which names the
 * question uses (verbatim, for brand_resolver), whether it states a price,
 * whether it remarks on money, whether it rules the client out. Gated by
 * DESIGN_CHECK_V2 until the validation run and the shadow cycle pass. */
export const DESIGN_CHECK_V2 = process.env.DESIGN_CHECK_V2 === "1";
export const DESIGN_CHECK_SYSTEM_V2 = DESIGN_CHECK_SYSTEM.replace(
  /\nReply with ONLY: [\s\S]*$/,
  `

Also report four facts about the question's own words (never about what an answer might say):
- brands_named: every brand, company, product line or product name the question names, copied EXACTLY as written - same spelling and case, lowercase stays lowercase ("is acme any good" -> "acme"; nicknames and short forms count). Casual or lowercase writing still counts as naming the brand. Do NOT list ordinary words that only look like a brand in context ("our target audience", "an apple a day", "on the dot"), generic product types, or the asker's own people and places. Empty list when none.
- states_price: true when the question itself states what a specific product, plan, tier or fee costs - or a price gap between products - as a fact ("the Gold plan is $40", "the big model costs about 300 more"). False for the asker's own spending, budget or bill, and for a price or deal the asker says they were offered or quoted.
- money_remark: true when the question remarks on money at all - cost, price, paying, fees, wasting money, being cheaper, value for money.
- excludes_client: true only when the question requires something the client brand named below clearly cannot offer (a hardware feature its products lack, a platform it does not run on), so the client could not be a valid answer. False when unsure.
Reply with ONLY: {"voices_design": true|false, "reason": "<one short sentence>", "brands_named": ["..."], "states_price": true|false, "money_remark": true|false, "excludes_client": true|false}`
);

export interface DesignVerdict {
  voices: boolean;
  reason: string;
  unchecked?: boolean;
  /** V2 only: names the question uses, verbatim (resolve with brand_resolver). */
  brandsNamed?: string[];
  statesPrice?: boolean;
  moneyRemark?: boolean;
  excludesClient?: boolean;
}

/**
 * Design-fidelity check for doubt/plan cells: does each paraphrase still
 * voice the design its cell declares? Paraphrase drift here is silent and
 * poisons the measurement (an off-design question gets typed as doubt but
 * never states the doubt - the jira "Cloud trial" objection cell lost its
 * entire design this way, unnoticed). One model call per candidate, cached
 * per (design, text). Mirrors the validated offline pattern in
 * labeling/v02_relabel/design_check.mts.
 */
export async function checkDesignFidelity(input: {
  /** client: the study's brand, shown to the V2 verdict for excludes_client. */
  candidates: { text: string; design: string; client?: string }[];
  meta?: CacheMeta;
  /** Effort override: seed-check escalation re-judges low-effort failures
   * at medium before healing or flagging (the low tier's documented ~1%
   * gray zone is 1-2 false chips per battery at seed-check volume). */
  effort?: string;
  /** Force the extended V2 verdict regardless of DESIGN_CHECK_V2 (the
   * validation harness compares both prompts on the same texts). */
  v2?: boolean;
  /** Model override (validation arm B: a stronger seed-tier checker). */
  model?: string;
}): Promise<DesignVerdict[]> {
  const a = await anthropicClient();
  // Scoped, not tagCosts: mutating the shared request context here bled the
  // design_check purpose onto concurrent writer calls in the same request
  // (the stray gpt-5-mini design_check ledger rows).
  const effort = input.effort ?? DESIGN_CHECK_EFFORT;
  return withCostContext({ purpose: "setup:design_check" }, () => Promise.all(
    input.candidates.map(async (c) => {
      const v2 = input.v2 ?? DESIGN_CHECK_V2;
      const model = input.model ?? DESIGN_CHECK_MODEL;
      // V1 keys are untouched (design_check1); V2 has its own key space.
      const key = v2
        ? cacheKey("design_check2", [model, effort, c.design, c.client ?? "", c.text.trim()])
        : cacheKey("design_check1", [model, effort, c.design, c.text.trim()]);
      const hit = await store.cacheGet(key, CACHE_TTL_MS);
      if (hit) return JSON.parse(hit) as DesignVerdict;
      try {
        const res = await a.messages.create({
          model,
          max_tokens: 2000,
          ...(effort === "default" ? {} : { output_config: { effort } }),
          system: v2 ? DESIGN_CHECK_SYSTEM_V2 : DESIGN_CHECK_SYSTEM,
          messages: [{ role: "user", content: v2
            ? `${c.design}\n\nClient brand: ${c.client ?? "(none)"}\n\nQuestion: ${c.text}`
            : `${c.design}\n\nQuestion: ${c.text}` }],
        } as never);
        const text = (res as { content: { type: string; text?: string }[] }).content
          .filter((b) => b.type === "text").map((b) => b.text ?? "").join("")
          .trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
        // Opus occasionally wraps the JSON in prose - take the object, not
        // the whole reply (the classifyJourney pattern).
        const j = JSON.parse(firstJsonObject(text) ?? text) as {
          voices_design: boolean; reason?: string;
          brands_named?: unknown; states_price?: boolean; money_remark?: boolean; excludes_client?: boolean;
        };
        const out: DesignVerdict = { voices: !!j.voices_design, reason: j.reason ?? "" };
        if (v2) {
          out.brandsNamed = Array.isArray(j.brands_named) ? j.brands_named.filter((x): x is string => typeof x === "string") : [];
          out.statesPrice = !!j.states_price;
          out.moneyRemark = !!j.money_remark;
          out.excludesClient = !!j.excludes_client;
        }
        await store.cacheSet(key, JSON.stringify(out), input.meta);
        return out;
      } catch (err) {
        // Fail open for THIS request - an unreachable checker never blocks
        // the gate - but say so: callers must not cache a set containing
        // unchecked verdicts as checked (the 183-day-stale-pass hole).
        console.error("design fidelity check failed:", err);
        return { voices: true, reason: "", unchecked: true };
      }
    })
  ));
}

export interface CellVerdict {
  ok: boolean;
  /** Every problem found, most serious first: "target" = asks a different
   * question than the cell measures; "branding" = breaks the cell's
   * blind/branded design; "unclear" = a reader couldn't tell what's being
   * asked (typos and casual grammar are fine). Empty when ok. */
  flags: CellFlag[];
  /** One plain-language sentence addressed to the user; empty when ok. */
  reason: string;
  /** One edit fixing every flag while keeping the user's wording and
   * register; repeats the input when ok. */
  suggestion: string;
}

const CELL_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          target: { type: "boolean" },
          branding: { type: "boolean" },
          unclear: { type: "boolean" },
          reason: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["target", "branding", "unclear", "reason", "suggestion"],
      },
    },
  },
  required: ["verdicts"],
} as const;

export interface CellReviewCandidate {
  /** The prompt as the user left it. */
  text: string;
  /** The last machine-offered wording, when there was one - the diff lets
   * the reviewer tell a slip from a deliberate rewrite. */
  original: string | null;
  /** Stage label, what it asks, and its market-effect tag. */
  stage: string;
  /** The stage KEY (churn_triggers) - the brand rule is keyed on it; the
   * tag is narrative only. Falls back to `stage` (the generator passes
   * keys there). */
  stageKey?: string;
  hint: string | null;
  tag: string | null;
  situation: string | null;
  situationDescription: string | null;
  angle: string;
  mode: string | null;
  /** Class-angle comparison cells (2026-10-01): the class the cell weighs
   * the client brand against ("a Visa card"). Absent = every other cell. */
  classPhrase?: string | null;
}

/**
 * Quality check on user-edited or user-written prompts, run at the Prompts
 * gate confirm. Judges against the cell's DESIGN - what the stage measures
 * and its blind/branded rules - not against polish: prompts are supposed
 * to read like real typing, so typos and casual grammar pass.
 */
export async function reviewCells(input: {
  brand: string;
  category: string;
  competitors: string[];
  audience: string | null;
  candidates: CellReviewCandidate[];
  /** Typed roster (2026-09-30): upstream brands are not rivals here - they
   * leave the reviewer's rival list (and its cache key). Absent = untyped. */
  rosterRoles?: RosterRoles;
  meta?: CacheMeta;
}): Promise<CellVerdict[]> {
  tagCosts({ purpose: "setup:cell_review" });
  input = { ...input, competitors: sameSeatOf(input.competitors, input.rosterRoles) };
  const fp = (c: CellReviewCandidate) =>
    // hint is in the fingerprint: the target check leans on it, so a
    // sharper hint must not serve verdicts formed without one.
    [c.stageKey ?? "", c.stage, c.situation ?? "", c.angle, c.text.trim(), c.original?.trim() ?? "", c.hint ?? ""].join("|") +
    // Only class cells extend the fingerprint - every other key is unchanged.
    (c.classPhrase ? `|class:${c.classPhrase}` : "");
  // "cell_review3": the 524-cell fixture audit (2026-09-17) traced every
  // one of its 43 flags to the checker, not the cells - the steers
  // exemption was missing (29), "blind" was read as "may not ask for
  // brand recommendations" (10), and rival cells drew flags whose own
  // reasons said allowed (4); the mutation test also showed off-target
  // text slipping through. review2 added incoherence rewrites. review4:
  // target never polices brand presence or naturally blended detail -
  // review3's sharpened target re-flagged 17 deliberate blind variants
  // and buyer-style blends on the same audit corpus.
  // review5: must-name brand rule for the A3 + settled-customer stages
  // (2026-09-27) - brand-free wording there is now a branding flag.
  const key = cacheKey("cell_review6", [
    input.brand, input.category, input.audience, input.competitors.join(","),
    input.candidates.map(fp).join("~"),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as CellVerdict[];
  const brandRule = (c: CellReviewCandidate) =>
    c.classPhrase
      ? `head-to-head vs a CLASS: must name ${input.brand} and weigh it against ${c.classPhrase} as a class of products (naming that class is required) - naming any specific rival company or product is a violation`
    // "open" is the classic battery: no per-cell brand design to enforce.
    : c.angle === "open"
      ? "no restriction - the prompt may name brands where its ask calls for it"
      : c.angle === "generic"
      // "judges" verdicts on the client brand; "steers" retention and
      // loyalty stages are client-anchored by design (their hints tell
      // the writer to name it) - both may name the client, never a rival.
      ? MUST_NAME_STAGES.has(c.stageKey ?? c.stage)
        ? `must name ${input.brand}: the stage concerns the customer's own ` +
          `${input.brand}, and a wording that leaves it implied breaks the ` +
          `measurement` +
          (c.stage === "advocacy"
            ? ` - a rival may appear only as the counterpart being persuaded`
            : ` - never a rival`)
        // Tags are narrative only (2026-09-28 demotion): the sole surviving
        // beneficiary of the old judges/steers tag rule is pricing, whose
        // battery mixes branded tier cells with blind category cells by
        // design - so it is named directly.
        : (c.stageKey ?? c.stage) === "pricing"
        ? `blind except the client brand: may name ${input.brand} (the stage concerns it directly), never a rival`
        : "blind: the prompt TEXT must not contain any brand name - " +
          "asking the assistant to recommend, name, or list brands is " +
          "the point of many cells and is always fine"
      : c.angle === "defensive"
        ? `must ask for alternatives to ${input.brand} by name`
        : `about the rival ${c.angle} - naming ${c.angle} is REQUIRED, and naming ${input.brand} alongside it (a comparison) is fine`;
  const res = await openaiClient().chat.completions.create({
    model: INSTRUMENT_HELPER_MODEL,
    // A safety net, not a deep thinker - low effort roughly halves the
    // wait at the gate confirm.
    reasoning_effort: "low",
    messages: [
      {
        role: "system",
        content:
          "Quality-check prompts a user edited in a research instrument " +
          "that measures a brand's standing in AI assistant answers. Each " +
          "prompt belongs to one CELL: a stage of the buying decision " +
          "(what the prompt must ask about), sometimes a buying scenario " +
          "(a circumstance woven in naturally), and a brand rule (blind " +
          "or naming specific brands - the measurement design). Prompts " +
          "are written the way real people type into a chat assistant: " +
          "typos, lowercase, fragments, and casual grammar are GOOD - " +
          "never flag them. For EACH candidate answer three yes/no " +
          "questions, each judged on its own:\n" +
          "- target: does it ask a materially different question than its " +
          "cell measures? Compare the ask against the stage line: a " +
          "perfectly coherent question that belongs to another stage's " +
          "territory, or that lost its scenario's circumstance entirely, " +
          "is a yes - coherence is not the test, the RIGHT question is. " +
          "Two things are NEVER target drift: whether a brand is named " +
          "(brand presence is solely the branding question - a cell about " +
          "the client brand may still be written blind on purpose, to " +
          "measure whether the assistant brings the brand up itself), and " +
          "adjacent detail woven in the way real people ask (a pain " +
          "description that mentions products, a question that trails " +
          "into what-should-I-look-for). Flag target only when the " +
          "CENTRAL ask belongs to a different stage.\n" +
          "- branding: does it VIOLATE the cell's brand rule (stated per " +
          "candidate) - naming a brand where it must be blind, or missing " +
          "a brand it must name? A brand the rule permits or requires is " +
          "never a violation: when the text matches its rule, the answer " +
          "is no.\n" +
          "- unclear: is it garbled or self-contradictory enough that a " +
          "reader couldn't tell what's being asked? (Not typos, not " +
          "informality - only genuine incoherence.)\n" +
          "On everything else, accept: this is a safety net for edits " +
          "that silently break the measurement, not a style gate. Some " +
          "candidates note the wording the user started from ('edited " +
          "from'). Use the diff: judge the new text on its own merits, " +
          "never revert a deliberate change. When any answer is yes: " +
          "reason is ONE sentence in plain language addressed to the " +
          "user covering every yes, and suggestion is the SMALLEST edit " +
          "that fixes every yes while keeping the user's own words, " +
          "register, and length - as typed by a real person, never an em " +
          "dash, never the tilde character. Smallest never means keeping " +
          "nonsense: when the text is incoherent, replace the parts that " +
          "make no sense with a plain ask that fits the cell, rather " +
          "than patching around them. When all three are no: " +
          "reason is an empty string and suggestion repeats the " +
          "candidate verbatim. Return verdicts in the candidates' order, " +
          "one per candidate.",
      },
      {
        role: "user",
        content:
          `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
          `Audience: ${input.audience ?? "unknown"}\nRivals: ${input.competitors.map(primaryBrandName).join(", ") || "(none)"}\n` +
          `Candidates to check:\n${input.candidates
            .map((c, i) => {
              const lines = [
                `${i + 1}. "${c.text}"`,
                `   stage: ${c.stage}${c.hint ? ` - ${c.hint}` : ""}`,
                `   brand rule: ${brandRule(c)}`,
              ];
              if (c.situation) {
                lines.push(
                  `   scenario: ${c.situation}${c.situationDescription ? ` - ${c.situationDescription}` : ""}`
                );
              }
              if (c.mode) lines.push(`   asked by buyers in: ${c.mode}`);
              if (c.original && c.original.trim() !== c.text.trim()) {
                lines.push(`   (edited from: "${c.original}")`);
              }
              return lines.join("\n");
            })
            .join("\n")}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "cell_review", strict: true, schema: CELL_REVIEW_SCHEMA },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    verdicts: {
      target: boolean; branding: boolean; unclear: boolean;
      reason: string; suggestion: string;
    }[];
  };
  // Flags are derived, most serious first - the model only answers the
  // three questions. A missing or malformed verdict never blocks the user.
  const verdicts: CellVerdict[] = input.candidates.map((c, i) => {
    const v = (parsed.verdicts ?? [])[i];
    if (!v || typeof v.target !== "boolean" || !v.suggestion?.trim()) {
      return { ok: true, flags: [], reason: "", suggestion: c.text };
    }
    const flags: CellFlag[] = [
      ...(v.target ? ["target" as const] : []),
      ...(v.branding ? ["branding" as const] : []),
      ...(v.unclear ? ["unclear" as const] : []),
    ];
    return {
      ok: flags.length === 0,
      flags,
      reason: flags.length === 0 ? "" : humanize(v.reason ?? ""),
      suggestion: flags.length === 0 ? c.text : humanize(v.suggestion),
    };
  });
  await store.cacheSet(key, JSON.stringify(verdicts), stampOf(input));
  return verdicts;
}

/* -------------------------------- cells --------------------------------- */

const CELL_WRITER_SYSTEM =
  "You write the prompts for a research instrument that measures a " +
          "brand's standing in AI assistant answers. For EACH cell in the " +
          "plan, write exactly one prompt as a real person would type it " +
          "into a chat assistant - varied length and register, some lowercase " +
          "and terse, some with backstory; never survey-speak, never a " +
          "requirements list.\n" +
          "Typing, not prose: real asks are short and get to the question " +
          "fast - the asker's situation in a few plain words, then the ask " +
          "(10-35 words is normal; a prompt is not a brief). NEVER a wish " +
          "list of what they want in the product (two or more wanted " +
          "features or criteria strung together): the ANSWER decides what " +
          "matters, and a criteria " +
          "list both steers it and makes every stage ask the same thing. " +
          "The only detail beyond the situation is what the stage itself " +
          "is about: the ONE capability a feature screen asks after, the " +
          "ONE job a use-case ask names (each one buyers commonly ask about, " +
          "never one picked because it suits the client), the asker's usage " +
          "a value ask needs. Fragments happen; details are unpolished. " +
          "NEVER ad-copy patterns - no parallel lists of " +
          "three, no balanced drama, no polished metaphors, no rhetorical closers. If it would read well on a " +
          "landing page, rewrite it until it reads like a chat message.\n" +
          "Rules:\n" +
          "- angle=generic: never name any brand - blind prompts are the " +
          "measurement - UNLESS the cell's stage guidance says the buyer " +
          "names the client brand (objections about it, its value, the " +
          "case for it): there, name the CLIENT brand only, never a rival.\n" +
          "- angle=<rival name>: for comparison-type stages, name the client " +
          "brand AND that rival; for alternatives-type stages, ask for " +
          "alternatives to that rival (client brand NOT named), stating the " +
          "move PLAINLY with no reason given: a leave-reason that says what " +
          "the rival lacks or who it fails steers the answer toward one kind " +
          "of replacement and poisons the measurement - and so does the " +
          "asker's team or segment identity: the category word is the ONLY " +
          "anchor. Vary the voice across these cells, write 'I' for personal " +
          "products and 'we' for team tools, use the name a buyer types " +
          "rather than a roster string, and keep the category clear in each " +
          "ask.\n" +
          "- A comparison cell (angle=<rival> or angle=class) is " +
          "CIRCUMSTANCE-NEUTRAL: ask the head-to-head about the category " +
          "plainly - which one, which would you pick and why, where does " +
          "each win - and give the asker NO situation at all. No role or " +
          "identity, no usage amounts or frequencies, no occasion or " +
          "project, no spec or size qualifier, no criteria list that " +
          "implies a situation: any such detail becomes a fact every " +
          "paraphrase must keep, and the measurement is the head-to-head " +
          "itself, never one buyer's story. EVERY comparison names both " +
          "brands and asks which one the answer would pick, and why - a " +
          "strengths tour that never asks for the pick is not a " +
          "head-to-head. Wording is free and varies across a battery's " +
          "comparison cells; keep the category clear (a company that sells " +
          "in several categories needs it) and grammatical (never a plural " +
          "category pasted into a singular slot).\n" +
          "- angle=defensive: an EXISTING customer of the client brand, " +
          "weighing a move away, asks for alternatives to it by name - " +
          "never a prospect who simply hasn't chosen it.\n" +
          "- angle=class(<class>): a head-to-head of the client brand against " +
          "a CLASS of products, not a company - name the client brand and " +
          "speak the class naturally, the way a buyer does, with no " +
          "belittling 'just': the two sides are weighed even. NEVER name any specific rival company, issuer " +
          "or product: the class itself is the counterpart. Never append a " +
          "redundant category clause the class already carries, and keep a battery's class cells " +
          "parallel in shape so their rates compare.\n" +
          "- Retention and loyalty stages speak as an existing customer and " +
          "MUST name the client brand: a churn, renewal, support, expansion, " +
          "ecosystem or advocacy ask that leaves the brand implied is a " +
          "defect, never a variant. The relationship is stated as fact, " +
          "never hypothetically.\n" +
          "- Churn and renewal cells make LEAVING a live option the question " +
          "actually weighs, and never foreclose STAYING: the asker is " +
          "deciding whether to keep the brand, not announcing a decision and " +
          "not asking for a fix. Both options need not be spelled out, but a " +
          "fix-it or how-to ask with a token 'or' tacked on is a support " +
          "question, not churn, and pause vs cancel is two ways of leaving. " +
          "A renewal " +
          "cell's trigger is the bill or renewal coming due; a churn cell's " +
          "trigger is its stated worry. Name the brand ONCE, and vary the " +
          "wording across cells. The leave side stays plain - never " +
          "'something cheaper' or 'simpler', and never an ask for " +
          "alternatives by name, unless the cell's own concern is price: " +
          "price has its own cells, and bolting it on muddies whose worry " +
          "drove the exit.\n" +
          "- situation: weave the circumstance in naturally, as the asker's " +
          "OWN situation - never as a topic opener, NEVER the scenario's " +
          "label text (a plan label is not something a person types), and " +
          "never the plan's segment vocabulary (buyers say their size and " +
          "stakes in plain words).\n" +
          "- Value cells (stage key pricing) ask the CLIENT BRAND'S value " +
          "question for this column's buyer: name the client brand, set it " +
          "against a GENERIC cheaper alternative in the category, described " +
          "by what it is, not by name - NEVER the brand's own lower tier or " +
          "plan, which keeps every answer inside the brand - give the " +
          "asker's usage in plain words (numbers are allowed, never " +
          "required), and ask for the call. When the brand sells several " +
          "distinct product lines, name the LINE being weighed - never an " +
          "exact model, edition or year. Every value " +
          "cell asks " +
          "the SAME question; only the buyer changes. Never name a rival " +
          "(head-to-heads belong to comparison), never state a price (the " +
          "asker's own budget or an offer made to them is circumstance), " +
          "never a bare 'is it worth it?' with no usage (that is a worry), " +
          "never a presupposed verdict, never a " +
          "spreadsheet of figures.\n" +
          "- Objections speak as a PROSPECT weighing the purchase - 'should " +
          "I drop or cancel it' is a churn/renewal question, never an " +
          "objection. A confusion- or complexity-shaped concern is voiced " +
          "as DISTRUST, never as a request to explain the rules.\n" +
          "- A doubt cell (objections, churn, renewal) STATES " +
          "the worry as the asker's own claim or feeling, something the " +
          "answer can confirm OR REBUT - never a neutral rules, " +
          "eligibility or how-to lookup on the topic, never an ask that " +
          "only sizes an assumed problem (ask whether the problem is real, " +
          "not how big it is), and never an ask for a " +
          "price, a cost figure or the cost accounting (the money question " +
          "belongs to pricing).\n" +
          "- concern(<subject>) on a plan line: that cell's doubt is ABOUT " +
          "that subject and nothing else - voice THAT worry inside the " +
          "cell's circumstance. A doubt about a different subject is " +
          "wrong, however well written.\n" +
          "- Doubt cells (objections, churn, renewal) WITHOUT " +
          "a concern(...) note: EACH cell voices a DIFFERENT real concern " +
          "buyers have about the client brand - never the same worry " +
          "(price, fees, performance) recycled across cells.\n" +
          "- Product names date: name product LINES or say 'the latest " +
          "<line>' - never a specific model or model year. Engines correct a stale model " +
          "premise instead of answering the question.\n" +
          "- Open-choice stages (discovery, " +
          "social_validation, feature_screening, premium_worth): the ask " +
          "must invite NAMED picks - never an ask for what to look for, " +
          "where to find reviews, or a features-only essay. When the category is a " +
          "RETAILER category, the ask is which retailer to buy from, not " +
          "which product to buy.\n" +
          "- use_case: the situation plus ONE job to be done, asking which ONE " +
          "product to pick for it - not a list (that belongs to discovery). A " +
          "job is something the buyer is trying to get done in their life or " +
          "work, stated WITHOUT naming a product feature or capability: if " +
          "the job is really a feature with the words rearranged, or just the " +
          "buying situation repeated, it is not a job. Each use-case cell in " +
          "a battery names a DIFFERENT job, one buyers in that situation " +
          "commonly need done, and never the capability its column's " +
          "feature screen already asks about.\n" +
          "- premium_worth: weigh the category's premium maker(s) as a " +
          "TIER against basic/store options and invite named picks; never " +
          "ask whether one named brand is worth it - that form belongs to " +
          "the worry cells.\n" +
          "- The category term is vocabulary: use the study category's own " +
          "words, never a looser or broader word for it in blind cells - the " +
          "category anchors what is being measured. Blind means no BRAND " +
          "names - the plain category noun is normal speech, never contorted " +
          "around - and no product term only one roster brand is known for " +
          "(it points every answer at that brand).\n" +
          "- problem_recognition: the asker has a pain and isn't shopping for " +
          "a solution yet - they may own an older or makeshift product, but " +
          "never as a current customer of the client brand doubting it " +
          "(that is a worry cell). They describe the pain and ask for a way " +
          "out in their own words - vary it across cells, never the same " +
          "closing every time. category_education asks what this kind of " +
          "product actually does and how people use it - nothing is broken " +
          "there, so never 'what fixes this'. Neither stage asks a yes/no " +
          "reassurance question, a " +
          "premium-vs-cheap tier question, or 'what specs or criteria " +
          "should I care about' (that is the criteria cell's question).\n" +
          "- criteria: the situation plus an ask for what actually matters - " +
          "NEVER offering candidate criteria for the answer to rank or " +
          "complete: the " +
          "measurement is what the answer chooses to teach.\n" +
          "- repertoire: a buyer who usually picks the client brand names it " +
          "and asks whether to stick with it or try something else; the " +
          "trigger is habit or wanting variety, never a stated worry " +
          "(worries belong to churn).\n" +
          "- business_case: an internal champion in this situation asks for " +
          "help justifying the client brand, by name, to the people who sign " +
          "off on the purchase - never a rival named, never a pricing " +
          "question.\n" +
          "- expansion: a satisfied customer names the client brand and ONE " +
          "specific way of using it more, natural for this category, and asks " +
          "whether to do it - never a rival, never a support or fix-it ask.\n" +
          "- ecosystem: an existing customer names the client brand and asks " +
          "what to pair with it for ONE specific need.\n" +
          "- advocacy: a customer names the client brand and the person " +
          "they're convincing, often quoting that person's objection, and " +
          "asks for help making the case.\n" +
          "- One prompt asks at most two or three things, stays under about " +
          "55 words, and reads ONE way: a list of four or more features or " +
          "requirements is survey-speak even in a short prompt (pick the " +
          "two or three this asker would actually type), and an ask with " +
          "two readings measures neither. ONLY when the circumstance is a " +
          "switch between competing platforms or ecosystems, state the " +
          "DIRECTION by naming both platforms (the one being left and the " +
          "one being joined) - platform names are direction vocabulary, not " +
          "brand names; any other change of tool or provider needs no named " +
          "source. A switch with no stated direction is NOT a direction: every " +
          "answer then guesses which way, and the guess decides which " +
          "products get named. The direction must leave the CLIENT brand " +
          "an eligible answer - a switch toward a platform the client " +
          "doesn't run on excludes it by construction.\n" +
          "- Never a calendar year in a prompt ('in 2026'): trackers re-ask " +
          "prompts for years and a dated prompt goes stale.\n" +
          "- Sibling cells of one stage VARY voice and framing: four cells " +
          "that are one sentence with the name swapped read machine-written, " +
          "and a persona the scenario contradicts breaks the voice.\n" +
          "- Never use planning vocabulary in a prompt: 'spec-driven', " +
          "'trust-driven', 'think/feel', 'value math', 'run the math', " +
          "segment labels, journey or scenario terms are OURS, not the " +
          "asker's.\n" +
          "- journey(...): that cell's buyer decides that way - write the " +
          "prompt in that buyer's register.\n" +
          "- reach=<scenarios>: this single cell is asked by buyers in those " +
          "scenarios only - voice it for them.\n" +
          "- Punctuation people actually type: never an em dash, never the " +
          "tilde character.\n" +
          "- The text field holds ONLY the final prompt exactly as the " +
          "person would type it: never a note to yourself, a correction " +
          "('sorry', 'instead:'), a reference to the seed or this task, or " +
          "a bracketed annotation.\n";

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
  /** The measurement type this cell's answers feed (the decided per-cell
   * typing; advocacy critic cells refine to doubt at labeling time). */
  qtype?: QuestionType;
  /** Doubt cells only (2026-09-30): the PLANNED concern this cell
   * measures, assigned at grid-plan time from the brand's enumerated
   * doubt-space. The writer voices it; the design check enforces it. */
  concern?: string;
  /** Class-angle comparison cells only (2026-10-01): the class the client
   * brand is weighed against ("a Visa card") and the upstream roster brand
   * it evokes ("Visa"). Such cells carry angle "class"; qtype stays
   * head_to_head and the spec's brandMode (comparison_class) is the
   * dashboard split key. Absent on every other cell. */
  classPhrase?: string;
  classBrand?: string;
  /** The prompt as a user would type it. */
  text: string;
  /** The cell's typed check-spec (s7+): derived once after the seed's last
   * heal; every check verifies candidates against it. Absent on legacy
   * cells, which keep the string-derived checks. */
  spec?: CellCheckSpec;
  /** Deterministic-check violations the generation pass could not heal
   * (one steered regen per check). Present only on flagged-TERMINAL cells
   * (see SEED_RULES_VERSION): the seed ships, the gate shows the
   * violation, and a human - or an explicit redraw - resolves it; serving
   * never re-enters generation for it. */
  seedFlags?: string[];
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
/** The cache key for ONE grid cell - exported so migrations can seed
 * values under exactly the keys generateGrid will read. */
export function gridCellCacheKey(
  args: {
    brand: string; category: string; competitors: string[];
    audience: string | null; base: Moderators; scenarios: ScenarioSpec[];
    /** Head-to-head picks (decision 3) decide the slots; absent or
     * pick-free rosters key exactly as before. */
    rosterRoles?: RosterRoles;
  },
  row: {
    stage: string; situation: string | null; angle: string; scope: string | null; concern?: string | null;
    classPhrase?: string | null; classBrand?: string | null;
  }
): string {
  // args.competitors is the SAME-SEAT list (generateGrid resolves roles
  // first), so an untyped roster keys exactly as before.
  const rivals = angleRivals(args.competitors, args.rosterRoles);
  const s = row.situation ? args.scenarios.find((x) => x.label === row.situation) : undefined;
  const sctx = s ? `${s.label}|${s.description}|${journeyNote(args.base, s) ?? ""}` : "";
  return cacheKey("grid_cell1", [
    STYLE_VERSION, args.brand, args.category, rivals.join(","), args.audience,
    JSON.stringify(args.base),
    row.stage, row.situation ?? "", row.angle, row.scope ?? "", sctx, row.concern ?? "",
    // A class-angle row's class rides in its key (self-versioning request
    // data, 2026-10-01) - appended ONLY when present, so every other unit
    // keys byte-identically to before.
    ...(row.classPhrase ? [`class:${row.classBrand ?? ""}:${row.classPhrase}`] : []),
  ]);
}

/** The cache key for ONE cell's paraphrase set - same contract. */
export function phrasingCacheKey(
  args: {
    brand: string; competitors: string[]; audience: string | null;
    count: number; base: Moderators; scenarios: ScenarioSpec[];
    rosterRoles?: RosterRoles;
  },
  cell: {
    situation: string | null; mode?: string | null; text: string; spec?: unknown; concern?: string | null;
    classPhrase?: string | null; classBrand?: string | null;
  },
  avoidConcerns?: string[]
): string {
  const rivals = angleRivals(args.competitors, args.rosterRoles);
  const s = cell.situation ? args.scenarios.find((x) => x.label === cell.situation) : undefined;
  const jnote = s ? journeyNote(args.base, s) ?? "" : "";
  return cacheKey("phrasings", [
    PHRASINGS_VERSION, STYLE_VERSION, args.brand, rivals.join(","), args.audience, String(args.count),
    JSON.stringify(args.base),
    // Spec-checked and string-checked sets never share an entry: a legacy
    // draft's set must not serve a spec-era cell or the reverse.
    `${cell.situation ?? ""}|${cell.mode ?? ""}|${cell.text}|${jnote}${cell.spec ? "|spec" : ""}${cell.concern ? `|concern:${cell.concern}` : ""}${avoidConcerns && avoidConcerns.length > 0 ? `|guard:${[...avoidConcerns].sort().join(";")}` : ""}${cell.classPhrase ? `|class:${cell.classBrand ?? ""}:${cell.classPhrase}` : ""}`,
  ]);
}

/** One row of the grid's cell plan. */
export interface CellPlanRow<S extends { key: string } = MaskedStage> {
  stage: S;
  situation: string | null;
  angle: string;
  scope: string | null;
  concern?: string;
  /** Class-angle rows only: angle "class" plus the class it voices. */
  classPhrase?: string;
  classBrand?: string;
}

/** How a plan row's angle is shown to the writer: a class row renders
 * ` angle=class(<class phrase>)`, every other row its speakable angle. */
function planAngle(p: { angle: string; classPhrase?: string | null }): string {
  return p.classPhrase ? `class(${p.classPhrase})` : primaryBrandName(p.angle);
}

/* ---------------------------- worries module ----------------------------
 * The doubt-space gets its own gate (Tyler 2026-10-01): one candidate pool
 * of the brand's worries, stance-tagged; the user picks 3-5 (tier) and the
 * confirmed picks replace the concern-plan zip - one INVARIANT cell per
 * worry-stance, stance mapped onto the existing stage keys so must-name
 * rules, design intents, premise derivation and the dashboard split all
 * keep working. Reporting attributes by the concern riding each cell. */

/** The doubt stages a picked worry may be assigned to (its lifecycle
 * STANCE): pre-purchase -> objections, an existing customer's
 * leave-trigger -> churn_triggers, the pay-again moment -> renewal.
 * repertoire stays on the legacy path (never recommended). */
export { WORRY_STANCE_STAGES } from "./battery_checks";
import { WORRY_STANCE_STAGES } from "./battery_checks";
export type WorryStance = (typeof WORRY_STANCE_STAGES)[number];

export interface WorryCandidate {
  /** The worry, 2-6 plain words - becomes the cell's concern and the
   * dashboard's attribution label. */
  worry: string;
  /** One plain sentence of what buyers actually say - the card's blurb. */
  detail: string;
  /** The stances this worry is naturally voiced at (offered subset). */
  stances: WorryStance[];
  /** The single most natural stance - the chip a card-click toggles. */
  recommended: WorryStance;
  /** The MEASUREMENT PLAN (2026-10-01, uncapped allowance): the stances
   * the planner recommends actually fielding - widely voiced at that
   * moment, distinct from the other recommendations, actionable. Pre-lit
   * at the gate; may be empty (available, unrecommended). The user's
   * deviation from it is stored as projects.worry_decision. */
  recommend: WorryStance[];
}

/** A confirmed pick: one cell, at one stance. */
export interface WorryPick {
  concern: string;
  stage: WorryStance;
}

/** Draw the candidate worry pool for the gate. One cached, coalesced call
 * per (brand, category, audience, scenario set, offered stances); the
 * confirmed PICKS are decision data stored on the draft/project - this
 * pool is only the menu. */
export async function generateWorries(input: {
  brand: string;
  category: string;
  audience: string | null;
  scenarios: ScenarioSpec[];
  /** Doubt stages the participation mask recommends - the only stances
   * offered (no renewal chips on a one-shot-rhythm category). */
  offered: string[];
  noWait?: boolean;
  meta?: CacheMeta;
}): Promise<WorryCandidate[] | null> {
  tagCosts({ purpose: "setup:worries" });
  const offered = WORRY_STANCE_STAGES.filter((s) => input.offered.includes(s));
  if (offered.length === 0) return [];
  const STANCE_DEF: Record<WorryStance, string> = {
    objections: "objections - a prospect deciding whether to choose the brand voices this worry before buying",
    churn_triggers: "churn_triggers - an existing customer voices this worry as a reason to leave",
    renewal: "renewal - the keep-or-cancel moment when payment comes due",
  };
  // worries4: price worries are attitude-shaped per the circumstance/doubt
  // boundary (the pricing battery owns the math). worries3 lacked the
  // hygiene line; worries2 drew empty plans; worries1 predates plans.
  const key = cacheKey("worries4", [
    CONCERNS_MODEL, input.brand, input.category, input.audience,
    input.scenarios.map((s) => s.label).join(","), offered.join(","),
  ]);
  return coalesced<WorryCandidate[]>(key, { noWait: input.noWait, meta: stampOf(input) }, async () => {
    const res = await openaiClient().chat.completions.create({
      model: CONCERNS_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You know what real buyers complain and worry about. List 8 to 12 " +
            "DISTINCT worries buyers voice about the given brand in its " +
            "category - each a different coarse class (price/value, quality, " +
            "performance, complexity, policy/trust, availability, service, " +
            "lock-in, ...), most widely-voiced first. At most TWO " +
            "price/cost/value-class worries in the whole list, and a price " +
            "worry is ATTITUDE-shaped (how the cost feels to the buyer) - never a request to run the value math; the " +
            "pricing battery owns the math. Real worries " +
            "people actually raise, never invented ones.\n" +
            "For each worry give: `worry` (2-6 plain words), `detail` (ONE " +
            "plain sentence of what buyers actually say - their words, not " +
            "marketing language), `stances` (every stage where buyers " +
            "naturally voice it, from the allowed list only), " +
            "`recommended` (the single most natural stance, one of its own " +
            "stances) and `plan` (see below).\n" +
            "`plan` is the MEASUREMENT PLAN: the subset of this worry's " +
            "stances a sharp brand tracker would actually field monthly. " +
            "Across the WHOLE list the plan must total 6 to 10 pairs - " +
            "never zero, never every chip of every worry. Put a pair in " +
            "the plan when the worry is widely voiced AT THAT MOMENT, " +
            "distinct from every other planned pair (never two pairs " +
            "measuring the same underlying doubt at the same moment), and " +
            "actionable - the brand could respond to the reading. Most " +
            "worries carry ONE planned stance; a tail or duplicative " +
            "worry carries an empty plan; the top worries always carry at " +
            "least one.\n" +
            `Allowed stances:\n${offered.map((s) => `- ${STANCE_DEF[s]}`).join("\n")}\n` +
            'Reply with ONLY JSON: {"worries": [{"worry": "...", "detail": "...", "stances": ["..."], "recommended": "...", "plan": ["..."]}]}.',
        },
        {
          role: "user",
          content:
            `Brand: ${input.brand}\nCategory: ${input.category}\n` +
            `Audience: ${input.audience ?? "general buyers"}\n` +
            (input.scenarios.length > 0
              ? `Buying scenarios being measured (context for breadth, not labels to copy): ${input.scenarios
                  .map((s) => s.label)
                  .join("; ")}\n`
              : ""),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "worries", strict: true,
          schema: {
            type: "object", additionalProperties: false,
            properties: {
              worries: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false,
                  properties: {
                    worry: { type: "string" },
                    detail: { type: "string" },
                    stances: { type: "array", items: { type: "string" } },
                    recommended: { type: "string" },
                    plan: { type: "array", items: { type: "string" } },
                  },
                  required: ["worry", "detail", "stances", "recommended", "plan"],
                },
              },
            },
            required: ["worries"],
          },
        },
      },
    });
    const raw = (JSON.parse(res.choices[0]?.message?.content ?? "{}") as { worries?: (WorryCandidate & { plan?: string[] })[] }).worries ?? [];
    const seen = new Set<string>();
    const list: WorryCandidate[] = [];
    for (const w of raw) {
      const worry = String(w.worry ?? "").trim();
      const norm = worry.toLowerCase();
      if (!worry || seen.has(norm)) continue;
      // Stances outside the offered set are dropped; a worry with none
      // left (or a bad recommended) is repaired to the first offered
      // stance rather than discarded - the gate is where judgment lives.
      const stances = WORRY_STANCE_STAGES.filter(
        (s) => offered.includes(s) && (w.stances ?? []).includes(s)
      );
      const safe = stances.length > 0 ? stances : [offered[0]];
      const recommended = safe.includes(w.recommended as WorryStance)
        ? (w.recommended as WorryStance)
        : safe[0];
      // The plan may be empty (available, unrecommended) but never names
      // a stance the worry doesn't carry.
      const recommend = WORRY_STANCE_STAGES.filter(
        (s) => safe.includes(s) && (w.plan ?? []).includes(s)
      );
      seen.add(norm);
      list.push({ worry, detail: String(w.detail ?? "").trim(), stances: safe, recommended, recommend });
      if (list.length >= 12) break;
    }
    return list.length > 0 ? list : null;
  });
}

/** The cell plan, computed in code from the participation mask - which
 * cells exist is a design rule, not a model choice. Pure (exported for
 * the fixture). `rivals` are the entity angle slots (angleRivals of the
 * same-seat roster); `classAngles` (2026-10-01) add ONE comparison row
 * each, AFTER the entity rows - additive, never displacing an entity
 * slot. No class angles = the plan exactly as before. */
export function planGridCells<S extends {
  key: string; columns: string[]; situational: boolean; rivals: "none" | "each" | "defensive_offensive";
}>(
  stages: S[], allLabels: string[], rivals: string[], classAngles: ClassAngle[] = [],
  worries?: WorryPick[]
): CellPlanRow<S>[] {
  const plan: CellPlanRow<S>[] = [];
  for (const st of stages) {
    // A kept stage no journey reaches was forced in by the user: it runs
    // everywhere, in the base journey's voice (override semantics).
    const cols = st.columns.length > 0 ? st.columns.filter((c) => allLabels.includes(c)) : allLabels;
    const columns = cols.length > 0 ? cols : allLabels;
    const scope =
      columns.length < allLabels.length ? columns.join(", ") : null;
    // WORRIES MODULE (2026-10-01): a confirmed worry list replaces the
    // concern zip for the doubt stages - one INVARIANT row per worry
    // assigned to this stage (its stance), zero rows when the user
    // assigned none (a deliberate pick, not a gap). The lifecycle
    // context comes from the STAGE (hint, must-name rule, design
    // intent), never from a scenario. Absent worries = the legacy
    // shapes below, untouched.
    if (worries && (WORRY_STANCE_STAGES as readonly string[]).includes(st.key)) {
      for (const w of worries) {
        if (w.stage === st.key)
          plan.push({ stage: st, situation: null, angle: "generic", scope, concern: w.concern });
      }
      continue;
    }
    if (st.rivals === "each") {
      // SCENARIO-INVARIANT COMPARISONS (2026-10-01, Tyler): a head-to-head
      // belongs to NO single buying scenario. The old build cycled rivals
      // through the scenario columns, which confounded rival with
      // circumstance (vs-Citi only ever asked in the premium-travel
      // voice), gave early scenarios two comparison cells and late ones
      // none whenever rivals wrapped, and paired rival with scenario by
      // roster-order accident that the writer then dressed up as intent.
      // Entity and class rows are invariant like the alternatives stage:
      // situation null, reach carried on scope, and the per-rival read
      // averages over circumstance instead of secretly conditioning on
      // one. Scenario-level head-to-head splits are deliberately not a
      // measurement (n=10 per cell); scenario reads belong to the
      // open-choice columns.
      rivals.forEach((r) => {
        plan.push({ stage: st, situation: null, angle: r, scope });
      });
      if (st.key === "comparison") {
        classAngles.forEach((ca) => {
          plan.push({
            stage: st, situation: null, angle: "class", scope,
            classPhrase: ca.classPhrase, classBrand: ca.classBrand,
          });
        });
      }
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
  return plan;
}

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
  /** Typed roster (2026-09-30): competitor name -> same_seat | upstream.
   * Absent = every competitor same_seat (the untyped behavior). */
  rosterRoles?: RosterRoles;
  /** Class-angle cells (2026-10-01): upstream brand -> its buyer class
   * phrase ("a Visa card"). Only UPSTREAM entries with a phrase earn a
   * class cell (CLASS_SLOTS max, roster order). Absent = none. */
  rosterClasses?: RosterClasses;
  /** Confirmed worry picks (the worries module, 2026-10-01): one
   * invariant doubt cell per pick, concern riding the cell key
   * (self-versioning request data). Absent = the legacy concern-plan
   * zip, byte-identical. */
  worries?: WorryPick[];
  /** Out-parameter (2026-10-02 review round 3): rows the battery shipped
   * WITHOUT (exhausted units) and why a retry answer was given, so the
   * route and the wizard can say so instead of a silent hole. */
  report?: { missing: { stage: string; situation: string | null; angle: string }[]; reason?: "unjudged" | "pending" };
  /** An explicit user action retries exhausted units (each click = one more
   * bounded attempt); automatic paths respect the hour-long marker. */
  retryExhausted?: boolean;
  /** Background warm: never wait on another request's in-flight write. */
  noWait?: boolean;
  meta?: CacheMeta;
}): Promise<GridCell[] | null> {
  tagCosts({ purpose: "setup:cells" });
  input = { ...input, stages: input.stages.filter((st) => !RETIRED_STAGES.has(st.key)) };
  // Wall-clock budget for the whole pass - see GEN_DEADLINE_MS.
  const deadlineAt = Date.now() + GEN_DEADLINE_MS;
  // #7 (2026-10-02 review): the deadline only gated heal STARTS, so a heal
  // started at deadline-minus-epsilon could chain regenerations past the
  // platform kill. Heals now start only with ~a typical chain's room left;
  // skipped heals write the unit provisional and the next drive finishes.
  const healDeadlineAt = deadlineAt - 45_000;
  // TYPED ROSTER (2026-09-30): from here on input.competitors means the
  // rivals a buyer weighs - the SAME-SEAT list, in roster order. It feeds
  // the angle slots, the writer's rivals, every check-spec's brand sets and
  // the cache keys; upstream brands (sold to the trade, not this audience)
  // hold no cell, are free vocabulary in every check, and reach only the
  // concern planner as context. No roles = the input list itself.
  const upstream = upstreamOf(input.competitors, input.rosterRoles);
  // Class angles read the FULL typed roster (they are upstream entries by
  // definition) before the same-seat narrowing below.
  const classAngles = classAnglesOf(input.competitors, input.rosterRoles, input.rosterClasses);
  // r13: the dictionary seed's alias forms ("amex" for American Express),
  // read from the FULL roster so the cache key is the one project creation
  // reuses - every brand check below speaks the same vocabulary.
  const aliasForms = await brandAliasForms([input.brand, ...input.competitors]);
  input = { ...input, competitors: sameSeatOf(input.competitors, input.rosterRoles) };
  const rivals = angleRivals(input.competitors, input.rosterRoles);
  const allLabels = input.scenarios.map((s) => s.label);
  const plan = planGridCells(input.stages, allLabels, rivals, classAngles, input.worries);

  // CONCERN PLANNING (2026-09-30, Tyler): which worry each doubt cell
  // measures is DESIGNED here, not writer-chosen. One call enumerates the
  // brand's distinct doubt-space at a coarse altitude; each doubt row gets
  // one concern assigned, so diversity holds by construction - the writer
  // voices an assigned worry and the design check enforces it per cell.
  // (Post-hoc dedup lost to model gravity on thin-discourse brands: every
  // Doritos objection collapsed to seasoning dust through two fix rounds.)
  // Fails open: unassigned rows keep the legacy free-pick + dedup path.
  // A CONFIRMED worry list (the worries module) IS the plan - the zip
  // below is the legacy path for batteries without one.
  // Repertoire is a habit question, not a worry (stage contract) - it never
  // takes a planned concern.
  const doubtRows = plan.filter((r) => DOUBT_CHECK_STAGES.has(r.stage.key) && r.stage.key !== "repertoire");
  if (!input.worries && doubtRows.length >= 2 && process.env.PHRASINGS_CHECKS !== "0") {
    try {
      // The plan is CACHED per battery: warm and write must agree on the
      // list (each drawing its own would re-key every doubt cell and pay
      // twice), and a regeneration reuses the battery's established
      // doubt-space instead of re-rolling it. coalesced(), not a bare
      // get/set: the AmEx walk's warm and write raced the old bare read
      // and drew two DIFFERENT plans - every doubt cell generated twice
      // under different keys. Both callers now wait on one draw (the
      // call is short; a dead claim orphans in ~ORPHAN_MS).
      // Upstream context changes the plan, so it rides in the key - only
      // when present, so an untyped roster keeps its established plan.
      const planKey = cacheKey("concern_plan1", [
        STYLE_VERSION, CONCERNS_MODEL, input.brand, input.category, input.audience, String(doubtRows.length),
        ...(upstream.length > 0 ? [`upstream:${upstream.map(primaryBrandName).join(",")}`] : []),
      ]);
      const cached = await coalesced<string[]>(planKey, { meta: stampOf(input) }, async () => {
      const res = await openaiClient().chat.completions.create({
        model: CONCERNS_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You know what real buyers complain and worry about. List the " +
              "requested number of DISTINCT concerns buyers voice about the " +
              "given brand in its category - each a different coarse class " +
              "(price/value, quality, health/ingredients, performance, " +
              "complexity, policy/trust, availability, durability, service, " +
              "lock-in, ...), 2-6 plain words each, most widely-voiced " +
              "first. At most ONE price/cost/value-class concern in the whole "
              + "list. Real concerns people actually raise, never invented " +
              "ones. Reply with ONLY JSON: {\"concerns\": [\"...\"]}.",
          },
          {
            role: "user",
            content:
              `Brand: ${input.brand}\nCategory: ${input.category}\n` +
              `Audience: ${input.audience ?? "general buyers"}\n` +
              // Upstream brands are weather, not rivals: frictions with
              // them (a network a merchant won't take) are real worries
              // about the brand, so they enter the doubt-space reliably.
              (upstream.length > 0
                ? `Known upstream brands the rivals ride on: ${upstream.map(primaryBrandName).join(", ")} - ` +
                  `they sell to the trade, not to this buyer; frictions with them are real buyer concerns about ${input.brand}.\n`
                : "") +
              `Number of concerns: ${doubtRows.length}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "concerns", strict: true,
            schema: {
              type: "object", additionalProperties: false,
              properties: { concerns: { type: "array", items: { type: "string" } } },
              required: ["concerns"],
            },
          },
        },
      });
      const concerns = ((JSON.parse(res.choices[0]?.message?.content ?? "{}") as { concerns?: string[] }).concerns ?? [])
        .map((s) => String(s).trim())
        .slice(0, doubtRows.length);
      return concerns.some((c) => c) ? concerns : null;
      });
      if (cached) {
        doubtRows.forEach((r, i) => { if (cached[i]) r.concern = cached[i]; });
      }
      console.warn(`concern plan [${input.brand}]: ${doubtRows.map((r) => `${r.stage.key}=${r.concern ?? "?"}`).join("; ")}`);
    } catch (err) {
      console.error("concern planning failed open:", err);
    }
  }

  // Per-CELL cache units, keyed only on what the cell actually depends
  // on: its stage, angle, reach, and ITS OWN scenario (label,
  // description, journey note) - never the siblings. Editing one
  // scenario therefore regenerates only that scenario's cells; the rest
  // of the grid serves byte-identical from cache. (The old "grid_unit"
  // keyed every stage on the whole scenario array, so a one-word
  // scenario edit redrew the entire grid - and every reviewed prompt
  // with it.) A scoped invariant cell carries the column list in
  // `scope`, so a rename still re-keys exactly the cells it reaches;
  // a journey change re-keys its scenario's cells via the note, and
  // mask movement re-keys scoped cells via `scope`. Model-call batching
  // is unchanged: units group into ~CELL_CHUNK-cell calls either way,
  // and the dedupe seed still spans everything cached.
  const units: (typeof plan)[] = plan.map((row) => [row]);
  const unitOf = new Map<(typeof plan)[number], number>();
  units.forEach((rows, u) => rows.forEach((r) => unitOf.set(r, u)));
  const unitKeys = plan.map((r) =>
    gridCellCacheKey(input, {
      stage: r.stage.key, situation: r.situation, angle: r.angle, scope: r.scope, concern: r.concern ?? null,
      classPhrase: r.classPhrase ?? null, classBrand: r.classBrand ?? null,
    })
  );
  const resolved: (GridCell[] | null)[] = units.map(() => null);
  // A served cell always carries a spec matching its (scrubbed) text: s7
  // entries were written with one, and the derivation is pure, so a
  // mismatch (humanize drift, pre-spec entry) re-derives rather than
  // serving a stale or missing design.
  const rosterLabels = [input.brand, ...input.competitors];
  const scrub = (cells: GridCell[]): GridCell[] =>
    cells.map((c) => {
      const text = stripRosterParens(humanize(c.text), rosterLabels);
      const spec = c.spec && c.spec.seed === text.trim()
        ? c.spec
        : deriveCheckSpec({ ...c, text }, input.brand, input.competitors, input.category, aliasForms);
      return { ...c, text, spec };
    });
  /** A unit's stored value: `{cells, rules}` since the terminal-state era
   * (SEED_RULES_VERSION) - `rules` records the deterministic-check version
   * the unit was last judged under. A bare `GridCell[]` is the legacy
   * shape, read as rules-unknown so the serve path judges it once and
   * upgrades in place or regenerates. */
  const valueOf = (raw: string): { cells: GridCell[]; rules?: string; provisional?: boolean } | null => {
    try {
      const v = JSON.parse(raw) as { __pending?: number; cells?: GridCell[]; rules?: string; provisional?: boolean } | GridCell[];
      if (Array.isArray(v)) return { cells: v };
      return Array.isArray(v.cells) ? { cells: v.cells, rules: v.rules, provisional: v.provisional } : null;
    } catch {
      return null;
    }
  };

  const journeyBySituation = new Map(
    input.scenarios.map((s) => [s.label, journeyNote(input.base, s)] as const)
  );
  const scenarioLabels = new Set(input.scenarios.map((sc) => sc.label));
  const planLine = (p: (typeof plan)[number], i: number) => {
    const jn = p.situation ? journeyBySituation.get(p.situation) : null;
    return (
      `${i + 1}. stage=${p.stage.key} situation=${p.situation ?? "-"} angle=${planAngle(p)}` +
      `${p.scope ? ` reach=${p.scope}` : ""}${jn ? ` journey(${jn})` : ""}` +
      `${p.concern ? ` concern(${p.concern})` : ""}` +
      `\n   guidance: ${p.stage.hint}` +
      (p.classPhrase ? `\n   class contract: the counterpart is the CLASS "${p.classPhrase}", never a named rival company or product` : "")
    );
  };
  /** The plan row a produced cell belongs to: stage + situation + angle,
   * and the class for class rows (two class rows share angle "class"). */
  const rowFor = (rows: typeof plan, c: { stage: string; situation: string | null; angle: string; classBrand?: string | null }) =>
    rows.find((r) =>
      r.stage.key === c.stage && (r.situation ?? null) === c.situation && primaryBrandName(r.angle) === c.angle &&
      (r.classBrand ?? null) === (c.classBrand ?? null)
    );
  const byKey = new Map(input.stages.map((s) => [s.key, s]));
  // One 50-cell call would flirt with the route's time budget; calls of
  // ~this many cells run in parallel instead.
  const CELL_CHUNK = 13;

  /** Generate the given units, grouped into ~CELL_CHUNK-cell model calls
   * (a unit never splits), and cache each unit on its own key. Markers are
   * claimed FIRST so concurrent identical requests join this work. */
  const generate = async (
    idxs: number[], seen: Set<string>,
    /** Provisional units re-enter WITH their cells (2026-10-02 review): the
     * writer call is skipped and only the judgment pipeline (mech checks,
     * heals, design pass, terminal verdict) runs - a redraw would waste
     * warmed paraphrases and re-roll settled text. */
    pre: Map<number, GridCell[]> = new Map(),
    /** Prior retry counts for empty units (bounded liveness - see A5). */
    triesOf: Map<number, number> = new Map(),
    /** The raw each unit held when we decided to claim it - the CAS
     * expectation (null = absent). */
    expected: Map<number, string | null> = new Map()
  ): Promise<void> => {
    if (idxs.length === 0) return;
    // CAS claims (2026-10-02 review round 3, item 7): a lost race means a
    // concurrent request claimed between our read and now - leave the unit
    // to them; it resolves as a hole here and the caller's retry lands on
    // their finished, cached result.
    const markerFor = (u: number) =>
      JSON.stringify(pre.has(u) ? { __pending: Date.now(), cells: pre.get(u) } : { __pending: Date.now() });
    const wonClaims = await Promise.all(
      idxs.map((u) =>
        store.cacheClaim(unitKeys[u], expected.get(u) ?? null, markerFor(u), CACHE_TTL_MS, stampOf(input))
      )
    );
    const lost = idxs.filter((_, k) => !wonClaims[k]);
    if (lost.length > 0) console.warn(`grid unit claims lost to a concurrent request (${lost.length}) - leaving them to it`);
    idxs = idxs.filter((_, k) => wonClaims[k]);
    if (idxs.length === 0) return;
    // Claims stay alive by heartbeat (see ORPHAN_MS): units leave the
    // in-flight set the moment their group settles, and each final write
    // quiesces first so a stale beat can never re-mask it as pending.
    const inFlight = new Set(idxs);
    const keyToUnit = new Map(idxs.map((u) => [unitKeys[u], u] as const));
    const hb = startHeartbeat(
      () => [...inFlight].map((u) => unitKeys[u]),
      stampOf(input),
      (k) => {
        const u = keyToUnit.get(k);
        return u !== undefined && pre.has(u) ? { cells: pre.get(u) } : undefined;
      }
    );
    try {
    const groups: number[][] = [];
    let cur: number[] = [];
    let count = 0;
    for (const u of idxs) {
      if (pre.has(u)) continue; // pre-seeded units group separately below
      if (count > 0 && count + units[u].length > CELL_CHUNK) {
        groups.push(cur);
        cur = [];
        count = 0;
      }
      cur.push(u);
      count += units[u].length;
    }
    if (cur.length > 0) groups.push(cur);
    const preUnits = idxs.filter((u) => pre.has(u));
    for (let k = 0; k < preUnits.length; k += CELL_CHUNK) groups.push(preUnits.slice(k, k + CELL_CHUNK));
    await Promise.all(
      groups.map(async (group) => {
        try {
        if (Date.now() > deadlineAt) {
          // Out of budget before this group's writer even ran (a late
          // orphan takeover): release the claims so the next request
          // regenerates immediately with a fresh budget.
          group.forEach((u) => inFlight.delete(u));
          await hb.quiesce();
          await Promise.all(
            group.map((u) =>
              store.cacheSet(
                unitKeys[u],
                pre.has(u)
                  ? JSON.stringify({ cells: pre.get(u), provisional: true })
                  : JSON.stringify({ __pending: 0 }),
                stampOf(input)
              ).catch(() => {})
            )
          );
          return;
        }
        // Terminal only if every heal stage ran: a deadline skip writes
        // the unit PROVISIONAL (no rules stamp) so the cut-short heal is
        // retried on the next serve, never frozen as final.
        let complete = process.env.PHRASINGS_CHECKS !== "0";
        const rows = group.flatMap((u) => units[u]);
        const isPre = group.every((u) => pre.has(u));
        const planText = rows.map(planLine).join("\n");
        const parsed = isPre
          ? { cells: rows.map((row) => {
              const c = (pre.get(unitOf.get(row)!) ?? [])[0];
              return c
                ? { stage: row.stage.key, situation: c.situation, angle: c.angle, text: c.text }
                : { stage: "", situation: null as string | null, angle: "", text: "" };
            }) }
          : await (async () => {
        const res = await openaiClient().chat.completions.create({
          model: CELLS_MODEL,
          messages: [
            {
              role: "system",
              content: CELL_WRITER_SYSTEM +
                "Return one cell object per plan line, same stage/situation/angle " +
                "values, in order.",
            },
            {
              role: "user",
              content:
                `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
                `Rivals: ${rivals.map(primaryBrandName).join(", ")}\nAudience: ${input.audience ?? "unknown"}\n\n` +
                `Cell plan:\n${planText}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "grid_cells", strict: true, schema: CELLS_SCHEMA },
          },
        });
        return JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
          cells: { stage: string; situation: string | null; angle: string; text: string }[];
        };
          })();
        const produced = new Map<number, GridCell[]>();
        (parsed.cells ?? []).forEach((c, i) => {
          // Positional alignment: answer row i belongs to plan row i.
          const row = rows[i];
          if (!row || !c.text?.trim()) return;
          // A misordered reply puts one row's text on another row with no
          // signal now that identity comes from the plan (2026-10-02
          // review): a VALID echoed stage, situation or angle that
          // disagrees with the row's is that signal - drop the cell, the
          // unit retries. Same-stage swaps hide from the stage guard, so
          // the situation and angle echoes are checked against the other
          // rows of this group too.
          if (c.stage && c.stage !== row.stage.key && byKey.has(c.stage)) {
            console.warn(`echo guard drop (stage): row ${row.stage.key} echoed ${c.stage}`);
            return;
          }
          // Only PINNED rows judge the situation echo (2026-10-02 round 4):
          // an invariant row with reach=<scenarios> plausibly echoes one of
          // its own scope labels, and that is looseness, not a swap.
          const echoSit = c.situation && c.situation.trim() && c.situation.trim() !== "-" ? c.situation.trim() : null;
          if (row.situation && echoSit && echoSit !== row.situation && scenarioLabels.has(echoSit)) {
            console.warn(`echo guard drop (situation): row "${row.situation}" echoed "${echoSit}"`);
            return;
          }
          if (c.angle && c.angle !== planAngle(row) && rows.some((r) => r !== row && planAngle(r) === c.angle)) {
            console.warn(`echo guard drop (angle): row ${planAngle(row)} echoed ${c.angle}`);
            return;
          }
          // #4 (2026-10-02 review): stage and layer are the PLAN row's too -
          // the writer echoing a different valid stage used to cache the
          // cell under the row's key with the wrong stage, and echoing a
          // label dropped the cell silently (the s27 angle fix, completed).
          const st = row.stage;
          const norm = c.text.trim().toLowerCase().replace(/\s+/g, " ");
          if (seen.has(norm)) return; // cheap dedupe; no embeddings needed at this scale
          seen.add(norm);
          const u = unitOf.get(row);
          if (u === undefined) return;
          const cell: GridCell = {
            stage: st.key,
            layer: st.layer,
            // EVERY identity field is the PLAN row's, never the writer's
            // echo of the plan line (s27 audit F4: five cells shipped
            // angle "generic concern(...)" into stored intents and cache
            // keys; the echoed situation was equally trusted).
            situation: row.situation ?? null,
            angle: row.classPhrase ? "class" : primaryBrandName(row.angle),
            mode: row.scope ?? null,
            concern: row.concern,
            ...(row.classPhrase ? { classPhrase: row.classPhrase, classBrand: row.classBrand } : {}),
            text: humanize(c.text.trim()),
          };
          cell.qtype = questionTypeOf(cell, input.brand, input.category, aliasForms);
          const list = produced.get(u);
          if (list) list.push(cell);
          else produced.set(u, [cell]);
        });
        // Fresh cells get one pass of the same checker the Prompts gate
        // runs on user edits; anything flagged is served as its suggested
        // repair. The swap lands BEFORE the unit cache write, so the
        // healed text is the only text downstream ever sees - paraphrase
        // sets, fixtures, and the UI all stay coherent with it. Cached
        // units never re-heal (the approved baseline stands), and a
        // checker failure never blocks generation.
        const flat = group.flatMap((u) => produced.get(u) ?? []);
        if (flat.length > 0 && Date.now() > deadlineAt) complete = false;
        if (flat.length > 0 && Date.now() <= deadlineAt) {
          try {
            const verdicts = await reviewCells({
              brand: input.brand,
              category: input.category,
              competitors: input.competitors,
              audience: input.audience,
              candidates: flat.map((c) => {
                const st = byKey.get(c.stage);
                return {
                  text: c.text,
                  original: null,
                  stage: c.stage,
                  stageKey: c.stage,
                  hint: st?.hint ?? null,
                  tag: st?.tag ?? null,
                  situation: c.situation,
                  situationDescription: null,
                  angle: c.angle,
                  mode: c.mode,
                  ...(c.classPhrase ? { classPhrase: c.classPhrase } : {}),
                };
              }),
              meta: input.meta,
            });
            verdicts.forEach((v, i) => {
              if (!v.ok && v.suggestion?.trim()) flat[i].text = humanize(v.suggestion.trim());
            });
          } catch {
            // The writer's text stands - healing is best-effort.
          }
        }
        // MECHANICAL SEED CHECK (2026-09-29): the free brand rule runs on
        // every fresh seed - a blind seed slipping into a must-name stage
        // otherwise reaches paraphrasing, where the writer's repair
        // instruction and the signature filter used to deadlock into
        // guaranteed starvation. One regeneration with the violation
        // attached, re-checked mechanically; a still-failing seed stands
        // with a loud log (never blocks generation).
        // s7: the seed is checked against the spec its design derives -
        // required brands tolerant, forbidden brands strict - never against
        // a design re-read from its own spelling (seedRule, hoisted to
        // generate() scope so the cross-cell diversity pass shares it).
        if (process.env.PHRASINGS_CHECKS !== "0" && flat.length > 0) {
          await primeCells(flat);
          const flagged = flat
            .map((c, i) => ({ c, i, mech: seedRule(c) }))
            .filter((x) => x.mech.length > 0);
          // Heals are independent per cell, so they run concurrently - a
          // bad batch costs one heal round of wall time, not a chain of
          // sequential writer calls (the blown-budget stalls).
          await Promise.all(flagged.map(async ({ c, i, mech }) => {
            console.warn(`seed brand rule flagged [${c.stage}]: ${mech.map((m) => m.check).join(",")} | ${c.text.slice(0, 90)}`);
            if (Date.now() > deadlineAt) {
              complete = false;
              return;
            }
            const row = rowFor(rows, c) ?? rows.find((r) => r.stage.key === c.stage);
            if (!row) return;
            try {
              const res2 = await openaiClient().chat.completions.create({
                model: CELLS_MODEL,
                messages: [
                  { role: "system", content: CELL_WRITER_SYSTEM + "Return one cell object for the plan line." },
                  { role: "user", content:
                      `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
                      `Rivals: ${rivals.map(primaryBrandName).join(", ")}\nAudience: ${input.audience ?? "unknown"}\n\n` +
                      `Cell plan:\n${planLine(row, 0)}\n` +
                      `   [previous attempt broke the brand rule and was rejected: ${mech.map((m) => m.detail).join(" ")} ` +
                      `Do not reuse this wording: "${c.text}"]` },
                ],
                response_format: { type: "json_schema", json_schema: { name: "grid_cells", strict: true, schema: CELLS_SCHEMA } },
              });
              const cell2 = (JSON.parse(res2.choices[0]?.message?.content ?? "{}") as { cells?: { text?: string }[] }).cells?.[0];
              const text2 = cell2?.text?.trim();
              if (text2) await primeCells([{ ...c, text: text2 }]);
              if (text2 && seedRule({ stage: c.stage, angle: c.angle, text: text2, classPhrase: c.classPhrase, classBrand: c.classBrand }).length === 0) {
                console.warn(`seed brand rule healed [${c.stage}]: ${text2.slice(0, 90)}`);
                flat[i].text = humanize(text2);
              } else {
                console.warn(`seed brand-rule regeneration still failing [${c.stage}] - seed stands, flagged for the gate`);
              }
            } catch (err) {
              console.error("seed brand-rule healing failed open:", err);
            }
          }));
        }
        // SEED SELF-HEALING (2026-09-28): a doubt/plan cell's SEED must
        // itself voice the stage's design - the paraphrase-level filter can
        // only starve a cell whose seed is off-design (the jira p50/p95
        // spec-lookup cell burned 17 candidates this way). Flagged seeds get
        // ONE regeneration with the reason attached, re-checked; a still-
        // failing seed ships flagged-terminal like a mechanical violation
        // (s16: the old path only logged "flagged for the gate" and shipped
        // no flag - a Pixel off-design pricing seed sailed through clean).
        const designFlagged = new Map<number, string>();
        if (process.env.PHRASINGS_CHECKS !== "0" && flat.length > 0) {
          try {
            const seedTargets = flat
              .map((c, i) => ({ c, i, intent: stageDesignIntent(c.stage, input.brand, c.concern, c.angle, c.situation) }))
              .filter((x): x is { c: GridCell; i: number; intent: string } => !!x.intent);
            if (seedTargets.length > 0 && Date.now() > deadlineAt) complete = false;
            if (seedTargets.length > 0 && Date.now() <= deadlineAt) {
              const verdicts = await checkDesignFidelity({
                candidates: seedTargets.map((x) => ({ text: x.c.text, design: x.intent })),
                meta: input.meta,
              });
              // The LOW verdict is the kill decision: the 2026-09-29 bakeoff
              // validated low against the opus-medium reference (99.2%), and
              // an s22 experiment with a medium-effort second opinion CLEARED
              // real defects (directionless switch cells, a lost teen
              // circumstance) - medium is more lenient here, not more
              // accurate. A gray-zone false kill just rewrites a fine seed
              // into another fine seed, or ships a chip a human can dismiss;
              // a silent defect ships a broken measurement.
              // #1 (2026-10-02 review): an UNCHECKED verdict (checker outage,
              // fail-open) must never be stamped as judged - the phrasings
              // path has this guard, the seed path did not, so an Anthropic
              // outage shipped a whole battery terminal with zero design
              // judgment. Unchecked -> the unit writes provisional and the
              // next serve re-enters generation with a fresh budget.
              if (verdicts.some((v) => v.unchecked)) complete = false;
              const bad = seedTargets
                .map((x, k) => ({ ...x, reason: verdicts[k].reason }))
                .filter((_, k) => !verdicts[k].voices && !verdicts[k].unchecked);
              // Independent per cell - concurrent, like the brand-rule heal.
              // #3 (2026-10-02 review): the per-cell try/catch is load-bearing
              // in two ways - without it one vendor error rejected the
              // Promise.all (abandoning every other known-off-design cell,
              // unflagged) while the orphaned sibling promises kept running
              // and could mutate cell text AFTER the spec recompute and
              // cache write.
              await Promise.all(bad.map(async (x) => { try {
                console.warn(`seed design check flagged [${x.c.stage}]: ${x.c.text.slice(0, 90)}`);
                if (Date.now() > healDeadlineAt) {
                  complete = false;
                  return;
                }
                const row = rowFor(rows, x.c) ?? rows.find((r) => r.stage.key === x.c.stage);
                if (!row) return;
                const res2 = await openaiClient().chat.completions.create({
                  model: CELLS_MODEL,
                  messages: [
                    { role: "system", content: CELL_WRITER_SYSTEM + "Return one cell object for the plan line." },
                    { role: "user", content:
                        `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
                        `Rivals: ${rivals.map(primaryBrandName).join(", ")}\nAudience: ${input.audience ?? "unknown"}\n\n` +
                        `Cell plan:\n${planLine(row, 0)}\n` +
                        `   [previous attempt was OFF-DESIGN and was rejected: it did not voice the cell's design. ` +
                        `${x.intent}${swapRule(x.c.stage)} Do not reuse this wording: "${x.c.text}"]` },
                  ],
                  response_format: { type: "json_schema", json_schema: { name: "grid_cells", strict: true, schema: CELLS_SCHEMA } },
                });
                const cell2 = (JSON.parse(res2.choices[0]?.message?.content ?? "{}") as { cells?: { text?: string }[] }).cells?.[0];
                let text2 = cell2?.text?.trim();
                // A design heal must also pass the mechanical rules (the
                // brand-rule and concern-diversity heals already do this) -
                // otherwise the terminal verdict flags the "fix".
                if (text2) await primeCells([{ ...x.c, text: text2 }]);
                let mech2ok = !!text2 && seedRule({ ...x.c, text: text2 }).length === 0;
                let again = mech2ok
                  ? (await checkDesignFidelity({ candidates: [{ text: text2!, design: x.intent }], meta: input.meta }))[0]
                  : null;
                // Second bounded attempt, steered by the first failure (s26:
                // three AmEx worry cells anchored on the famous acceptance
                // doubt and one retry never shook it - still terminal, just
                // two tries instead of one).
                if (!again?.voices && !again?.unchecked && Date.now() <= healDeadlineAt) {
                  const why = again ? `it voiced the wrong thing: ${again.reason}` : text2 ? "it broke a mechanical rule" : "it returned nothing";
                  const res3 = await openaiClient().chat.completions.create({
                    model: CELLS_MODEL,
                    messages: [
                      { role: "system", content: CELL_WRITER_SYSTEM + "Return one cell object for the plan line." },
                      { role: "user", content:
                          `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
                          `Rivals: ${rivals.map(primaryBrandName).join(", ")}\nAudience: ${input.audience ?? "unknown"}\n\n` +
                          `Cell plan:\n${planLine(row, 0)}\n` +
                          `   [two attempts were rejected. The design: ${x.intent}${swapRule(x.c.stage)} ` +
                          `The last attempt failed because ${why}. ` +
                          `Do not reuse these wordings: "${x.c.text}" / "${text2 ?? ""}"]` },
                    ],
                    response_format: { type: "json_schema", json_schema: { name: "grid_cells", strict: true, schema: CELLS_SCHEMA } },
                  });
                  text2 = (JSON.parse(res3.choices[0]?.message?.content ?? "{}") as { cells?: { text?: string }[] }).cells?.[0]?.text?.trim();
                  if (text2) await primeCells([{ ...x.c, text: text2 }]);
                  mech2ok = !!text2 && seedRule({ ...x.c, text: text2 }).length === 0;
                  again = mech2ok
                    ? (await checkDesignFidelity({ candidates: [{ text: text2!, design: x.intent }], meta: input.meta }))[0]
                    : null;
                }
                if (again?.unchecked) {
                  // #1: the re-check never ran (outage) - this is neither a
                  // heal nor a verdict. Ship provisional, not flagged.
                  complete = false;
                  console.warn(`seed design re-check UNCHECKED [${x.c.stage}] - unit ships provisional`);
                } else if (again?.voices) {
                  console.warn(`seed self-healed [${x.c.stage}]: ${text2!.slice(0, 90)}`);
                  flat[x.i].text = humanize(text2!);
                } else {
                  // The flag describes the text that SHIPS (the original -
                  // the rejected regen's reason described discarded text).
                  designFlagged.set(x.i, `off-design: ${x.reason || "does not voice the cell's design"}`);
                  console.warn(`seed regeneration still off-design [${x.c.stage}] - seed ships flagged for the gate`);
                }
              } catch (err) {
                // A thrown heal leaves a KNOWN off-design cell - flag it with
                // the verdict we have rather than shipping it clean.
                designFlagged.set(x.i, `off-design: ${x.reason || "does not voice the cell's design"}`);
                console.error(`seed design heal threw [${x.c.stage}] - seed ships flagged:`, err);
              } }));
            }
          } catch (err) {
            // #2 gap (2026-10-02 review): a thrown design pass (client init,
            // cache read) means NOTHING here was judged - provisional, never
            // stamped final.
            complete = false;
            console.error("seed design healing failed - unit ships provisional:", err);
          }
        }
        // The heals above rewrite seed text after qtype was stamped at
        // parse time - recompute so a healed cell's stored type matches
        // its final wording. The check-spec is written HERE, once, from
        // the final healed seed: everything downstream (paraphrase
        // signature, mechanical battery, design check) reads it.
        flat.forEach((c) => {
          c.qtype = questionTypeOf(c, input.brand, input.category, aliasForms);
          c.spec = deriveCheckSpec(c, input.brand, input.competitors, input.category, aliasForms);
        });
        // TERMINAL VERDICT (SEED_RULES_VERSION): whatever the one steered
        // regen per check could not fix ships FLAGGED - the violation
        // travels to the gate on seedFlags, a human resolves it, and
        // serving never re-enters generation for it. Only a full heal
        // pass may stamp the version; a deadline-cut pass writes the unit
        // provisional so the next serve retries with a fresh budget.
        if (complete) {
          await primeCells(flat);
          flat.forEach((c, i) => {
            const mech = seedRule(c);
            const design = designFlagged.get(i);
            const flags = [...mech.map((m) => m.detail), ...(design ? [design] : [])];
            if (flags.length > 0) {
              c.seedFlags = flags;
              console.warn(`seed ships flagged-terminal [${c.stage}]: ${[...mech.map((m) => m.check), ...(design ? ["off_design"] : [])].join(",")} | ${c.text.slice(0, 80)}`);
            } else delete c.seedFlags;
          });
        }
        group.forEach((u) => inFlight.delete(u));
        await hb.quiesce();
        await Promise.all(
          group.map((u) => {
            const cells = produced.get(u) ?? [];
            resolved[u] = cells;
            if (!complete && cells.length > 0) provisionalOut.add(u);
            // An empty unit stamps itself retryable instead of caching the
            // failure - with a bounded try count, so a unit that can never
            // produce a cell degrades to a logged hole instead of blocking
            // the wizard forever (the stall-loop shape, 2026-10-02 review).
            return store.cacheSet(
              unitKeys[u],
              cells.length > 0
                ? JSON.stringify(complete ? { cells, rules: SEED_RULES_VERSION } : { cells, provisional: true })
                : JSON.stringify({ __pending: 0, tries: (triesOf.get(u) ?? 0) + 1, at: Date.now() }),
              stampOf(input)
            );
          })
        );
        } catch (err) {
          // A thrown group (vendor error, bad JSON) releases its claimed
          // markers so the retry regenerates NOW instead of waiting out
          // the pending TTL. Other groups' results stand; the missing
          // units surface as retryable and the wizard's missing-fill
          // picks them up.
          console.error(`grid cells group failed (${group.length} units) - markers released:`, err);
          group.forEach((u) => inFlight.delete(u));
          await hb.quiesce();
          // A thrown call is a vendor blip, not an attempt - it must not
          // count toward exhaustion (an outage would otherwise ship a short
          // battery that sticks). A pre-seeded unit writes its cells back
          // provisional: the claim overwrote them, and releasing to a bare
          // marker here would lose the very text re-judge-in-place keeps.
          await Promise.all(
            group.map((u) =>
              store.cacheSet(
                unitKeys[u],
                pre.has(u)
                  ? JSON.stringify({ cells: pre.get(u), provisional: true })
                  : JSON.stringify({ __pending: 0, tries: triesOf.get(u) ?? 0 }),
                stampOf(input)
              ).catch(() => {})
            )
          );
        }
      })
    );
    } finally {
      await hb.stop();
    }
  };

  // r15 brand judge: before the sync seed check reads a text, ambiguous
  // one-word brand hits on the cell's FORBIDDEN brands get their verdicts
  // (cached; model only on a miss). See brand_judge / brandMentions.
  const primeCells = async (cells: { stage: string; angle: string; text: string; concern?: string | null; classPhrase?: string | null; classBrand?: string | null }[]) => {
    const items = cells.filter((c) => c.text).map((c) => ({
      text: c.text,
      brands: deriveCheckSpec(c, input.brand, input.competitors, input.category, aliasForms).forbiddenBrands,
    }));
    if (items.length > 0)
      await primeBrandVerdicts({ items, roster: [input.brand, ...input.competitors], aliases: aliasForms, category: input.category, meta: input.meta });
  };
    // The free deterministic seed check, shared by the per-group heal and
  // the battery-wide concern-diversity pass below.
  const seedRule = (c: {
    stage: string; angle: string; text: string; situation?: string | null; concern?: string | null;
    classPhrase?: string | null; classBrand?: string | null;
  }) => {
    const spec = deriveCheckSpec(c, input.brand, input.competitors, input.category, aliasForms);
    const out = checkPromptAgainstSpec({
      text: c.text,
      spec,
      category: input.category,
      extraForms: aliasForms,
    });
    // A blind SEED must speak the category's language ("my phone",
    // "tortilla chips") - three rounds of instructions failed to stop
    // the writer contorting around the noun, so it is mechanical now.
    if (spec.brandMode === "blind" && !PRE_CATEGORY_STAGES.has(c.stage) && !textNamesCategory(c.text, input.category))
      out.push({
        check: "blind_missing_category" as const,
        detail: `blind seed never speaks the category "${input.category}" - use its plain everyday noun (the ordinary word a person calls this thing), never a contortion around it`,
      });
    // A seed that copies ANY scenario's label - full or as a "Label:"
    // opener - shipped the plan's vocabulary, not a person's circumstance.
    const leak = scenarioLabelLeak(c.text, [c.situation, ...input.scenarios.map((s) => s.label)], input.category);
    if (leak)
      out.push({ check: "scenario_label_leak" as const, detail: `copies the scenario label "${leak}"` });
    // COMPARISON SEEDS ARE CIRCUMSTANCE-NEUTRAL (s11): a quantity in a
    // head-to-head seed is a writer-invented segment - a spend level, a
    // trip count, a size - that every paraphrase must then keep, so the
    // whole set measures one arbitrary slice. This is the mechanically
    // detectable piece of the neutrality rule; roles and occasions stay
    // with the writer prompt and the review pass. Spec vocabulary (4K,
    // USB-C, 0%) never reaches spec.quantities.
    if ((spec.brandMode === "comparison" || spec.brandMode === "comparison_class") && spec.quantities.length > 0)
      out.push({
        check: "comparison_seed_quantity" as const,
        detail:
          `comparison seeds are circumstance-neutral - drop the number${spec.quantities.length > 1 ? "s" : ""} ` +
          `(${spec.quantities.join(", ")}): a spend level, frequency or size qualifier conditions the head-to-head on one writer-chosen segment`,
      });
    // r2 (2026-10-01 seed audit): three cheap deterministic nets.
    // A calendar year goes stale on the next wave and editing it later
    // changes the prompt's identity, breaking the trend.
    const yr = c.text.match(/\b20[2-4]\d\b/);
    if (yr)
      out.push({
        check: "seed_calendar_year" as const,
        detail: `the prompt says "${yr[0]}" - trackers re-ask prompts for years, so a calendar year goes stale; say "right now" instead`,
      });
    // A 60+ word seed is a requirements list however casual the words
    // (every over-ceiling seed in the s14 audit was a number-stuffed
    // pricing spreadsheet or a five-part feature list).
    const words = c.text.trim().split(/\s+/).length;
    if (words > 60)
      out.push({
        check: "seed_overlong" as const,
        detail: `${words} words - a prompt is one chat message, not a requirements list; keep the circumstance to one sentence and ask at most two or three things (aim well under 60 words)`,
      });
    // Segment vocabulary is the plan's register, not a buyer's.
    const seg = c.text.match(/\b(mid-?market|enterprise[- ]wide|enterprise standard|standardi[sz]ation|SMBs?)\b/i);
    if (seg)
      out.push({
        check: "segment_vocabulary" as const,
        detail: `"${seg[0]}" is planning vocabulary no buyer uses about themselves - voice the size or stakes in plain words`,
      });
    // r8 (2026-10-01): a directionless switch is detected by ABSENCE, not a
    // banned-phrase list - the writer dodged four widenings of the list
    // ("one mobile platform" / "one phone platform" / "my current platform
    // to the other platform"). Switch vocabulary near platform/ecosystem
    // with no OS named and no roster brand carrying the direction = flagged.
    const sw = c.text.match(/\b(?:switch|mov(?:e|ing)|leav(?:e|ing)|chang(?:e|ing)|jump(?:ing)?|coming|going)\w*\b[^.!?\n]{0,60}\b(?:platform|ecosystem|system|camp|operating system|os)s?\b|\b(?:platform|ecosystem|system|camp|operating system|os)s?\b[^.!?\n]{0,60}\b(?:switch|mov(?:e|ing)|chang(?:e|ing))\w*/i);
    if (
      sw &&
      !/\b(?:iOS|Android)\b/i.test(c.text) &&
      ![input.brand, ...input.competitors].some((b) => textNamesBrand(c.text, b, { extraForms: aliasForms[b] }))
    )
      out.push({
        check: "seed_switch_direction" as const,
        detail: `"${sw[0].trim()}" never says which way - state the direction by naming both platforms (the one left and the one joined), or every answer guesses and the guess decides which products get named`,
      });
    // r10: a multi-ask pile-up is countable - the brand-steer regen packed
    // FOUR trade-offs into one Pixel pricing cell (under the word ceiling,
    // over everything else). Two question marks is natural chat ("which
    // one? and why?" - 21 of 165 current seeds); three or more is a
    // questionnaire. Calibrated: catches exactly that one cell.
    if ((c.text.match(/\?/g) ?? []).length >= 3)
      out.push({
        check: "seed_multi_ask" as const,
        detail: `the prompt asks ${(c.text.match(/\?/g) ?? []).length} separate questions - one prompt asks at most two or three things, and one circumstance carries ONE core ask`,
      });
    // r11 (2026-10-02 cold-build audit): the class-cell "for <category>"
    // tail ("a Visa card for credit cards") is a writer-rule lapse the cold
    // roll exposed - countable, so counted.
    if (spec.brandMode === "comparison_class" && new RegExp(`\\bfor\\s+${input.category.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\s+/g, "\\\\s+")}\\b`, "i").test(c.text))
      out.push({
        check: "class_category_tail" as const,
        detail: `the class phrase already carries the category - drop the redundant "for ${input.category}" tail - it is not how anyone talks`,
      });
    // Stated prices (r12-r14) and money bolt-ons on non-price worries
    // (r8-r14) - pure functions in battery_checks so the validation harness
    // and the resolver shadow can run them on any text.
    const sp = statedPriceFinding(c.text);
    if (sp) out.push({ check: "seed_states_price" as const, detail: sp });
    if (moneyBoltOn(c.text, c.concern))
      out.push({
        check: "concern_price_bolt_on" as const,
        detail: `the cell's concern is "${c.concern}" but the text bolts on a money remark (cheaper options, wasting money, financial risk) - price has its own cells, and the bolt-on muddies whose worry drove the answer`,
      });
    return out;
  };

  /** Battery-wide invariants (concern diversity; the pricing diversity pass
   * was removed by init decision 1), extracted from generate's tail (2026-10-02 review gap
   * #3): a pass skipped by the deadline or a thrown labeling call left the
   * battery permanently without its guarantees, because the units were
   * already terminal and a fully-cached serve never re-entered generate. A
   * completion marker (keyed on the unit-key set, so it self-versions with
   * the eras) is written only when both passes ran uncut; a serve that finds
   * it absent re-runs them. */
  const passesKey = cacheKey("grid_passes2", [...unitKeys]);
  const runBatteryPasses = async (): Promise<boolean> => {
    let passesCut = false;
    // CROSS-CELL CONCERN DIVERSITY (2026-09-29 audit): every per-cell check
    // passes when all of a brand's doubt cells converge on ONE worry (jira:
    // four performance objections; Netflix: price six times) - the doubt
    // dashboard then measures a single concern per brand. One cheap
    // labeling call over this generation's doubt seeds; duplicates get one
    // regeneration steered away from the concerns already covered. Runs
    // battery-wide, after every group has landed; changed units re-cache.
    // Past the deadline it is skipped whole (fail-open, like a thrown
    // labeling call): the units are already written and the pass is a
    // safety net for legacy no-concern cells only.
    if (process.env.PHRASINGS_CHECKS !== "0" && Date.now() > deadlineAt) passesCut = true;
    if (process.env.PHRASINGS_CHECKS !== "0" && Date.now() <= deadlineAt) {
      try {
        // ALL doubt cells are labeled (2026-10-02 review round 3, item 6):
        // planned concerns seed the covered set so a CONCERN-LESS cell (a
        // repertoire cell beside worry picks) cannot duplicate a picked
        // worry; only concern-less cells are ever regenerated.
        const doubt: { u: number; c: GridCell }[] = [];
        // Battery-wide means the WHOLE battery: served units included (the
        // s24 eviction reroll saw only its 2 fresh units, skipped the pass
        // on length, and silently dropped Pixel's brand-named pricing cell).
        // A rewrite of a served unit re-caches terminal like any heal.
        // Repertoire is habit, not a worry (stage contract, 2026-10-03): the
        // pass wrote a worry into Doritos' habit cell.
        for (let u = 0; u < units.length; u++) for (const c of resolved[u] ?? []) if (DOUBT_CHECK_STAGES.has(c.stage) && c.stage !== "repertoire") doubt.push({ u, c });
        const concernless = doubt.filter((d) => !d.c.concern);
        if (concernless.length >= 1 && doubt.length >= 2) {
          const labelConcerns = async (texts: string[]): Promise<string[]> => {
            const a = await anthropicClient();
            const res = await withCostContext({ purpose: "setup:cells" }, () => a.messages.create({
              model: DESIGN_CHECK_MODEL,
              max_tokens: 1500,
              output_config: { effort: DESIGN_CHECK_EFFORT },
              system: `Each question below voices a buyer's concern about ${input.brand}. Label each question's core concern with ONE COARSE class: price/fees, performance/reliability, complexity/admin burden, catalog/content, policy/trust, support/service, compatibility/lock-in, quality/durability - or a 2-3 word class at that same altitude. Two settings of the same worry (peak-load speed vs cross-region speed) are the SAME class. Reply with ONLY JSON: {"concerns": ["...", ...]} - one label per question, in order.`,
              messages: [{ role: "user", content: texts.map((t, i) => `${i + 1}. ${t}`).join("\n") }],
            } as never));
            const text = (res as { content: { type: string; text?: string }[] }).content
              .filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
            const j = JSON.parse(firstJsonObject(text) ?? text) as { concerns?: string[] };
            return (j.concerns ?? []).map((s) => String(s));
          };
          const concerns = await labelConcerns(doubt.map((d) => d.c.text));
          if (concerns.length === doubt.length) {
            const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            const covered = new Map<string, number>();
            const dups: number[] = [];
            // Planned concerns hold their seats first...
            concerns.forEach((lab, i) => {
              if (doubt[i].c.concern) covered.set(norm(lab), i);
            });
            // ...then only concern-less cells can be duplicates.
            concerns.forEach((lab, i) => {
              if (doubt[i].c.concern) return;
              const k = norm(lab);
              if (covered.has(k)) dups.push(i);
              else covered.set(k, i);
            });
            const dirty = new Set<number>();
            // Independent per cell - concurrent, like the seed heals.
            await Promise.all(dups.slice(0, 4).map(async (i) => {
              const d = doubt[i];
              const row = rowFor(units[d.u] ?? [], d.c) ?? (units[d.u] ?? [])[0];
              if (!row) return;
              if (Date.now() > healDeadlineAt) { passesCut = true; return; }
              console.warn(`concern diversity: [${d.c.stage}] duplicates "${concerns[i]}" - regenerating | ${d.c.text.slice(0, 80)}`);
              try {
                const res2 = await openaiClient().chat.completions.create({
                  model: CELLS_MODEL,
                  messages: [
                    { role: "system", content: CELL_WRITER_SYSTEM + "Return one cell object for the plan line." },
                    { role: "user", content:
                        `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
                        `Rivals: ${rivals.map(primaryBrandName).join(", ")}\nAudience: ${input.audience ?? "unknown"}\n\n` +
                        `Cell plan:\n${planLine(row, 0)}\n` +
                        `   [this battery ALREADY covers these concerns about ${input.brand}: ${[...covered.keys()].join("; ")}. ` +
                        `This cell must voice a DIFFERENT real concern buyers have about ${input.brand} in ${input.category}. ` +
                        `Do not reuse this wording: "${d.c.text}"]` },
                  ],
                  response_format: { type: "json_schema", json_schema: { name: "grid_cells", strict: true, schema: CELLS_SCHEMA } },
                });
                const text2 = (JSON.parse(res2.choices[0]?.message?.content ?? "{}") as { cells?: { text?: string }[] }).cells?.[0]?.text?.trim();
                if (!text2) return;
                const cand = { stage: d.c.stage, angle: d.c.angle, text: humanize(text2), situation: d.c.situation, concern: d.c.concern };
                const intent = stageDesignIntent(d.c.stage, input.brand, undefined, d.c.angle, d.c.situation);
                await primeCells([cand]);
                const mechOk = seedRule(cand).length === 0;
                const dv = intent ? (await checkDesignFidelity({ candidates: [{ text: cand.text, design: intent }], meta: input.meta }))[0] : null;
                const designOk = !intent || (!!dv?.voices && !dv?.unchecked);
                if (mechOk && designOk) {
                  d.c.text = cand.text;
                  d.c.qtype = questionTypeOf(d.c, input.brand, input.category, aliasForms);
                  d.c.spec = deriveCheckSpec(d.c, input.brand, input.competitors, input.category, aliasForms);
                  // The swap passed the mechanical check, so any flag the
                  // original wore no longer describes this cell.
                  delete d.c.seedFlags;
                  dirty.add(d.u);
                  console.warn(`concern diversity: healed [${d.c.stage}]: ${cand.text.slice(0, 80)}`);
                } else {
                  console.warn(`concern diversity: regeneration rejected [${d.c.stage}] - original stands`);
                }
              } catch (err) {
                console.error("concern diversity regeneration failed open:", err);
              }
            }));
            // A dirty unit's swap passed both checks, so the rewrite is
            // terminal under the current rules like any full heal.
            await Promise.all(
              [...dirty].map((u) =>
                store.cacheSet(unitKeys[u], JSON.stringify({ cells: resolved[u] ?? [], rules: SEED_RULES_VERSION }), stampOf(input)).catch(() => {})
              )
            );
          }
        }
      } catch (err) {
        passesCut = true;
        console.error("concern diversity pass failed open:", err);
      }
    }
    // USE-CASE JOB DIVERSITY (fix 2, 2026-10-03 contract audit): per-cell
    // checks can't see that two use-case cells name the same job (Doritos:
    // sheet-pan nachos twice), that a "job" is its column's feature screen
    // again (AmEx: employee cards with limits) or just the room restated
    // (Jira: "standardize workflows across all teams"). One labeling call
    // over the battery's use-case seeds; offenders get one steered rewrite
    // that must pass the mechanical and design checks, or the original
    // stands.
    if (process.env.PHRASINGS_CHECKS !== "0" && Date.now() > deadlineAt) passesCut = true;
    if (process.env.PHRASINGS_CHECKS !== "0" && Date.now() <= deadlineAt) {
      try {
        const uc: { u: number; c: GridCell }[] = [];
        const screenBySit = new Map<string, string>();
        for (let u = 0; u < units.length; u++) for (const c of resolved[u] ?? []) {
          if (c.stage === "use_case") uc.push({ u, c });
          if (c.stage === "feature_screening" && c.situation) screenBySit.set(c.situation, c.text);
        }
        if (uc.length >= 1) {
          const roomOf = new Map(input.scenarios.map((s) => [s.label, s.description]));
          const a = await anthropicClient();
          const ask = (extra = "") => withCostContext({ purpose: "setup:cells" }, () => a.messages.create({
            model: DESIGN_CHECK_MODEL,
            max_tokens: 1500,
            output_config: { effort: DESIGN_CHECK_EFFORT },
            system:
              `Each question below asks which product to pick for a job in a buying situation in ${input.category}. For each give: ` +
              `job - the job in 2-5 words, as a task the buyer gets done; ` +
              `feature - true when the "job" is really a product feature or capability rather than a task; ` +
              `restatesRoom - true when the "job" is just the buying situation itself; ` +
              `sameAsScreen - true when the job is the same thing the column's feature-screening question asks about. ` +
              `Reply with ONLY valid JSON: {"jobs": [{"job": "...", "feature": false, "restatesRoom": false, "sameAsScreen": false}, ...]} - one entry per question, in order.${extra}`,
            messages: [{
              role: "user",
              content: uc.map((d, i) => {
                const room = d.c.situation ? `${d.c.situation}: ${roomOf.get(d.c.situation) ?? ""}` : "none";
                const screen = d.c.situation ? screenBySit.get(d.c.situation) : undefined;
                return `${i + 1}. Situation: ${room}\n   Feature screen in this column: ${screen ?? "none"}\n   Question: ${d.c.text}`;
              }).join("\n"),
            }],
          } as never));
          const parseJobs = (res: unknown) => {
            const text = (res as { content: { type: string; text?: string }[] }).content
              .filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
            try { return (JSON.parse(firstJsonObject(text) ?? text) as { jobs?: { job?: string; feature?: boolean; restatesRoom?: boolean; sameAsScreen?: boolean }[] }).jobs ?? null; } catch { return null; }
          };
          let jobs = parseJobs(await ask());
          if (!jobs) jobs = parseJobs(await ask(" Escape any quote marks inside strings."));
          if (jobs && jobs.length === uc.length) {
            const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            const seen = new Map<string, number>();
            const bad: { i: number; why: string }[] = [];
            jobs.forEach((j, i) => {
              const k = norm(j.job ?? "");
              if (j.feature) bad.push({ i, why: "it names a product feature, not a job" });
              else if (j.restatesRoom) bad.push({ i, why: "it repeats the buying situation instead of naming a job" });
              else if (j.sameAsScreen) bad.push({ i, why: "it asks about the same thing as its column's feature screen" });
              else if (k && seen.has(k)) bad.push({ i, why: `it repeats another use-case job (${j.job})` });
              if (k && !seen.has(k)) seen.set(k, i);
            });
            const covered = jobs.map((j) => j.job).filter(Boolean).join("; ");
            const dirty = new Set<number>();
            await Promise.all(bad.slice(0, 4).map(async ({ i, why }) => {
              const d = uc[i];
              const row = rowFor(units[d.u] ?? [], d.c) ?? (units[d.u] ?? [])[0];
              if (!row) return;
              if (Date.now() > healDeadlineAt) { passesCut = true; return; }
              const screen = d.c.situation ? screenBySit.get(d.c.situation) : undefined;
              console.warn(`use-case jobs: [${d.c.situation ?? "-"}] rejected because ${why} | ${d.c.text.slice(0, 80)}`);
              try {
                const res2 = await openaiClient().chat.completions.create({
                  model: CELLS_MODEL,
                  messages: [
                    { role: "system", content: CELL_WRITER_SYSTEM + "Return one cell object for the plan line." },
                    { role: "user", content:
                        `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
                        `Rivals: ${rivals.map(primaryBrandName).join(", ")}\nAudience: ${input.audience ?? "unknown"}\n\n` +
                        `Cell plan:\n${planLine(row, 0)}\n` +
                        `   [the previous attempt was rejected because ${why}. This battery's use-case jobs so far: ${covered}. ` +
                        `Name ONE DIFFERENT job buyers in this situation commonly need done - a task stated without any product feature word, not the situation itself` +
                        `${screen ? `, and not what this column's feature screen asks about ("${screen}")` : ""}. ` +
                        `Ask which ONE product to pick for it.${swapRule("use_case")} Do not reuse this wording: "${d.c.text}"]` },
                  ],
                  response_format: { type: "json_schema", json_schema: { name: "grid_cells", strict: true, schema: CELLS_SCHEMA } },
                });
                const text2 = (JSON.parse(res2.choices[0]?.message?.content ?? "{}") as { cells?: { text?: string }[] }).cells?.[0]?.text?.trim();
                if (!text2) return;
                const cand = { stage: d.c.stage, angle: d.c.angle, text: stripRosterParens(humanize(text2), [input.brand, ...input.competitors]), situation: d.c.situation, concern: d.c.concern };
                const intent = stageDesignIntent(d.c.stage, input.brand, undefined, d.c.angle, d.c.situation);
                await primeCells([cand]);
                const mechOk = seedRule(cand).length === 0;
                const dv = intent ? (await checkDesignFidelity({ candidates: [{ text: cand.text, design: intent }], meta: input.meta }))[0] : null;
                if (mechOk && (!intent || (!!dv?.voices && !dv?.unchecked))) {
                  d.c.text = cand.text;
                  d.c.qtype = questionTypeOf(d.c, input.brand, input.category, aliasForms);
                  d.c.spec = deriveCheckSpec(d.c, input.brand, input.competitors, input.category, aliasForms);
                  delete d.c.seedFlags;
                  dirty.add(d.u);
                  console.warn(`use-case jobs: healed: ${cand.text.slice(0, 80)}`);
                } else {
                  console.warn(`use-case jobs: rewrite rejected - original stands`);
                }
              } catch (err) {
                console.error("use-case job rewrite failed open:", err);
              }
            }));
            await Promise.all(
              [...dirty].map((u) =>
                store.cacheSet(unitKeys[u], JSON.stringify({ cells: resolved[u] ?? [], rules: SEED_RULES_VERSION }), stampOf(input)).catch(() => {})
              )
            );
          }
        }
      } catch (err) {
        passesCut = true;
        console.error("use-case job pass failed open:", err);
      }
    }
    // The cross-cell PRICING TRADE-OFF DIVERSITY pass (s20, 2026-10-01) and
    // its brand-named-cell steer were removed by init decision 1
    // (2026-10-03): pricing is a scenario row - every pricing cell asks the
    // brand's value question for its column's buyer, so "same trade-off in
    // every column" is the design, not a defect, and must-name is enforced
    // per cell by the spec.
    return passesCut;
  };
  /** One coalesced run of the battery passes per unit-key era: concurrent
   * requests WAIT on the claim instead of double-running the labeler and
   * racing regens (2026-10-02 review round 3, items 3/4). "1" = ran uncut
   * (the completion marker); a cut run returns null, which coalesced stamps
   * retryable so the next serve re-enters. Whether this request ran the
   * passes itself or waited on another request's run, they may have
   * rewritten cell text, so resolved is rebuilt from the store afterwards. */
  const maybeRunPasses = async (): Promise<void> => {
    if (process.env.PHRASINGS_CHECKS === "0") return;
    try {
      const out = await coalesced<string>(passesKey, { meta: stampOf(input) }, async () => {
        const cut = await runBatteryPasses();
        if (cut) console.warn("battery passes cut short - retried on the next serve");
        return cut ? null : "1";
      });
      if (out === null) return; // cut, or the wait budget blew - next serve retries
      const freshRaw = await store.cacheGetMany(unitKeys, CACHE_TTL_MS);
      unitKeys.forEach((k, u) => {
        const raw = freshRaw.get(k);
        if (!raw) return;
        const v = valueOf(raw);
        if (v && v.cells.length > 0) resolved[u] = scrub(v.cells);
      });
    } catch (err) {
      console.error("battery passes failed open:", err);
    }
  };


  const mine: number[] = [];
  const theirs: number[] = [];
  /** Units written provisional THIS run: the response must answer retry,
   * not hand unjudged cells to the draft (2026-10-02 review, gap #1). */
  const provisionalOut = new Set<number>();
  /** Units that failed 3+ generation attempts: ship the battery without
   * them (logged loud) rather than blocking the wizard forever. */
  const exhausted = new Set<number>();
  const preCells = new Map<number, GridCell[]>();
  const triesIn = new Map<number, number>();
  /** What each unit's key held at scan time - the CAS claim expectation. */
  const expectedRaw = new Map<number, string | null>();
  {
    const raws = await Promise.all(unitKeys.map((k) => store.cacheGet(k, CACHE_TTL_MS)));
    raws.forEach((raw, u) => expectedRaw.set(u, raw ?? null));
    const upgrades: Promise<unknown>[] = [];
    // r15: every cached cell about to be re-judged under new rules gets its
    // brand-judge verdicts first, in one batch (the loop below is sync).
    if (process.env.PHRASINGS_CHECKS !== "0") {
      const rejudge = raws.flatMap((raw) => {
        if (!raw || pendingMarkerAt(raw) !== null) return [];
        const v = valueOf(raw);
        return v && !v.provisional && v.cells.length > 0 && v.rules !== SEED_RULES_VERSION ? scrub(v.cells) : [];
      });
      if (rejudge.length > 0) await primeCells(rejudge);
    }
    raws.forEach((raw, u) => {
      if (raw) {
        const at = pendingMarkerAt(raw);
        if (at === null) {
          const v = valueOf(raw);
          // #2 (2026-10-02 review): a PROVISIONAL unit (deadline cut or
          // checker outage) was never design-judged, and the mech-only
          // re-judge below would have stamped it terminal with the design
          // layer skipped forever. It re-enters generation instead.
          if (v && v.provisional) {
            if (v.cells.length > 0) preCells.set(u, scrub(v.cells));
            mine.push(u);
            return;
          }
          if (v && v.cells.length > 0) {
            const served = scrub(v.cells);
            // RULES REACH CACHED CELLS - once per rules era (2026-09-30,
            // terminal-state fix over the round-7 audit change): a unit
            // judged under the CURRENT deterministic rules is terminal -
            // flagged or not, it serves as-is. A unit judged under an
            // older era (or the legacy bare-array shape) is re-judged
            // here with the free checks exactly ONCE: passing cells
            // upgrade in place with no model call (a reviewed battery is
            // never redrawn by a version bump - the Pixel C2 protection
            // stays), failing ones regenerate once and land terminal,
            // flagged if the heal can't fix them. Round 7's unversioned
            // serve-time check had no terminal state, so a seed the
            // writer couldn't satisfy regenerated on EVERY open, forever
            // (the init cell-creation stalls).
            if (v.rules === SEED_RULES_VERSION || process.env.PHRASINGS_CHECKS === "0") {
              resolved[u] = served;
              return;
            }
            if (served.every((c) => seedRule(c).length === 0)) {
              const clean = served.map((c) => {
                // A rules-era re-judge can only re-derive MECHANICAL flags;
                // an off-design flag came from the model check at generation
                // and must survive the upgrade (the human clears it at the
                // gate, or an edit/redraw re-keys the cell).
                const kept = (c.seedFlags ?? []).filter((f) => f.startsWith("off-design:"));
                const rest = { ...c };
                if (kept.length > 0) rest.seedFlags = kept;
                else delete rest.seedFlags;
                return rest;
              });
              resolved[u] = clean;
              upgrades.push(
                store
                  .cacheSet(unitKeys[u], JSON.stringify({ cells: clean, rules: SEED_RULES_VERSION }), stampOf(input))
                  .catch(() => {})
              );
              return;
            }
            console.warn(`cached unit fails current rules - regenerating once [${served[0]?.stage}] ${served[0]?.text.slice(0, 70)}`);
          }
        } else if (Date.now() - at < ORPHAN_MS) {
          theirs.push(u);
          return;
        } else {
          try {
            const j = JSON.parse(raw) as { __pending?: number; tries?: number; at?: number; cells?: GridCell[] };
            // A killed re-judge left its provisional cells ON the marker -
            // recover them so the retry re-judges instead of redrawing.
            if (Array.isArray(j.cells) && j.cells.length > 0) preCells.set(u, scrub(j.cells));
            const fresh = typeof j.at === "number" && Date.now() - j.at < 60 * 60 * 1000;
            if (j.__pending === 0 && (j.tries ?? 0) >= 3 && fresh && !input.retryExhausted) {
              console.error(`grid unit exhausted after ${j.tries} attempts - shipping the battery without it [${units[u][0]?.stage.key} ${units[u][0]?.situation ?? "-"}]`);
              exhausted.add(u);
              resolved[u] = [];
              input.report?.missing.push({
                stage: units[u][0]?.stage.key ?? "?",
                situation: units[u][0]?.situation ?? null,
                angle: units[u][0] ? planAngle(units[u][0]) : "?",
              });
              return;
            }
            // An hour-old exhaustion (or a thrown-only marker) starts
            // fresh; so does a user-forced retry.
            triesIn.set(u, fresh && !input.retryExhausted ? (j.tries ?? 0) : 0);
          } catch { /* not a marker - claim below */ }
        }
      }
      mine.push(u);
    });
    await Promise.all(upgrades);
  }
  // Seed the dedupe with everything already cached, so a fresh unit can't
  // duplicate a cached one's text.
  const seen = new Set<string>();
  for (const cells of resolved) {
    for (const c of cells ?? []) seen.add(c.text.trim().toLowerCase().replace(/\s+/g, " "));
  }

  /** Poll for units another request claimed; a stale marker (its
   * generator died) is taken over. On deadline with generators still
   * alive nothing duplicates - the caller retries onto their result. */
  const waitForTheirs = async (): Promise<void> => {
    if (theirs.length === 0 || input.noWait) return;
    const open = new Set(theirs);
    const deadline = Date.now() + COALESCE_PENDING_TTL_MS;
    while (open.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, COALESCE_POLL_MS));
      const pend = [...open];
      const raws = await Promise.all(pend.map((u) => store.cacheGet(unitKeys[u], CACHE_TTL_MS)));
      const orphaned: number[] = [];
      raws.forEach((raw, k) => {
        const u = pend[k];
        const at = pendingMarkerAt(raw);
        if (raw && at === null) {
          const v = valueOf(raw);
          if (v && v.cells.length > 0) {
            // The other generator just wrote this. PROVISIONAL still means
            // unjudged (2026-10-02 review round 3, gap #2): accept the cells
            // for the response shape but answer retry, or the confirm that
            // waited on a warm would hand unjudged seeds to the draft.
            resolved[u] = scrub(v.cells);
            if (v.provisional) provisionalOut.add(u);
            open.delete(u);
            return;
          }
        }
        if (at === null || Date.now() - at >= ORPHAN_MS) {
          orphaned.push(u);
          expectedRaw.set(u, raw ?? null);
          open.delete(u);
        }
      });
      if (orphaned.length > 0) await generate(orphaned, seen, undefined, undefined, expectedRaw);
    }
    // Deadline with generators still alive: never duplicate their work -
    // unresolved units stay empty and the caller's retry lands on the
    // finished, cached result.
  };

  await Promise.all([generate(mine, seen, preCells, triesIn, expectedRaw), waitForTheirs()]);
  // ONE call site for the battery passes (2026-10-02 review round 3, items
  // 3/4): the old tail call inside generate could run twice (an orphan
  // takeover calls generate again) and could stamp a PARTIAL battery (other
  // units still pending elsewhere). Now: only when every unit is resolved
  // and non-empty (or deliberately exhausted); when this request generated
  // something, the marker is pre-invalidated so a stale completion cannot
  // short-circuit the fresh battery's passes.
  if (process.env.PHRASINGS_CHECKS !== "0"
      && resolved.every((r, u) => (r !== null && r.length > 0) || exhausted.has(u))) {
    if (mine.length > 0) {
      await store.cacheSet(passesKey, JSON.stringify({ __pending: 0 }), stampOf(input)).catch(() => {});
      await maybeRunPasses();
    } else {
      const done = await store.cacheGet(passesKey, CACHE_TTL_MS).catch(() => null);
      if (!done || pendingMarkerAt(done) !== null) await maybeRunPasses();
    }
  }
  const all = resolved.flatMap((r) => r ?? []);
  // Ternaries, not if-guards - see composeInstrument. Unresolved units
  // (someone else still generating) mean an incomplete grid: a real
  // request reports retry-shortly rather than shipping holes; a warm
  // returns the partial set for the phrasings chain.
  // #5 (2026-10-02 review): an EMPTY unit (a dropped or failed cell) is as
  // incomplete as an unresolved one - nothing downstream re-requests cells,
  // so a planned-59-shipped-58 battery would persist through create. The
  // unit is already marked retryable; the caller's retry regenerates it.
  // A provisional unit's cells were never fully judged - in wait mode the
  // caller gets retry, same as a hole; the retry re-judges IN PLACE (cheap,
  // text preserved). Exhausted units are the deliberate exception: after 3
  // failed attempts the battery ships without them, logged, so a never-
  // producible cell cannot re-create the init stall loop.
  const holes = resolved.some((r, u) => (r === null || r.length === 0) && !exhausted.has(u));
  if (input.report && !input.noWait) {
    if (provisionalOut.size > 0) input.report.reason = "unjudged";
    else if (holes) input.report.reason = "pending";
  }
  return holes && !input.noWait
    ? null
    : provisionalOut.size > 0 && !input.noWait
      ? null
      : all.length > 0
        ? all
        : null;
}

/**
 * ONE fresh prompt for a single cell - the "New prompt" button. Not a
 * paraphrase: a different way to ask the cell's question, avoiding every
 * previously offered text. Cached by cell identity + avoid list, so the
 * new and previous draws are all cache-backed and cycling costs nothing.
 */
export async function regenerateCell(input: {
  brand: string;
  category: string;
  competitors: string[];
  audience: string | null;
  base: Moderators;
  scenarios: ScenarioSpec[];
  cell: {
    stage: string; situation: string | null; angle: string; mode: string | null; concern?: string | null;
    /** Class-angle comparison cells (2026-10-01): the class survives redraws. */
    classPhrase?: string | null; classBrand?: string | null;
  };
  /** Every text already offered for this cell, newest last. */
  avoid: string[];
  /** Near-variant mode: keep THIS prompt's ask, move one concrete detail -
   * the prompts-card sibling of the scenario near neighbor. */
  nearTo?: string;
  /** Typed roster (see generateGrid). Absent = untyped. */
  rosterRoles?: RosterRoles;
  meta?: CacheMeta;
}): Promise<{ text: string; spec: CellCheckSpec } | null> {
  tagCosts({ purpose: "setup:cells" });
  // r13: the dictionary seed's alias forms ("amex" for American Express),
  // read from the FULL roster so the cache key is the one project creation
  // reuses - every brand check below speaks the same vocabulary.
  const aliasForms = await brandAliasForms([input.brand, ...input.competitors]);
  input = { ...input, competitors: sameSeatOf(input.competitors, input.rosterRoles) };
  // Every alternate draw carries its own check-spec, derived from the
  // cell's design and the drawn seed - the same contract as generateGrid.
  // A planned concern is part of that design and survives redraws.
  const specFor = (text: string) =>
    deriveCheckSpec({
      stage: input.cell.stage, angle: input.cell.angle, text, concern: input.cell.concern,
      ...(input.cell.classPhrase ? { classPhrase: input.cell.classPhrase, classBrand: input.cell.classBrand } : {}),
    }, input.brand, input.competitors, input.category, aliasForms);
  const rivals = angleRivals(input.competitors, input.rosterRoles);
  const stages = participationMask(input.base, input.scenarios);
  const st = stages.find((x) => x.key === input.cell.stage);
  if (!st) return null;
  const avoidNorm = input.avoid.map((t) => t.trim()).filter(Boolean);
  const key = cacheKey("cell_alt", [
    STYLE_VERSION, input.brand, rivals.join(","), input.audience,
    JSON.stringify(input.base), JSON.stringify(input.scenarios),
    `${input.cell.stage}|${input.cell.situation ?? ""}|${input.cell.angle}|${input.cell.mode ?? ""}|${input.cell.concern ?? ""}`,
    avoidNorm.map((t) => t.toLowerCase()).sort().join("~"),
    input.nearTo ? `near:${input.nearTo.trim().toLowerCase()}` : "",
    // Class cells only - every other draw keys as before.
    ...(input.cell.classPhrase ? [`class:${input.cell.classBrand ?? ""}:${input.cell.classPhrase}`] : []),
  ]);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) {
    const text = humanize(JSON.parse(hit) as string);
    return { text, spec: specFor(text) };
  }
  const jn = input.cell.situation
    ? journeyNote(input.base, input.scenarios.find((sc) => sc.label === input.cell.situation) ?? { label: "", description: "", journey: null })
    : null;
  const planText =
    `1. stage=${st.key} situation=${input.cell.situation ?? "-"} angle=${planAngle(input.cell)}` +
    `${input.cell.mode ? ` reach=${input.cell.mode}` : ""}${jn ? ` journey(${jn})` : ""}` +
    `${input.cell.concern ? ` concern(${input.cell.concern})` : ""}` +
    `\n   guidance: ${st.hint}` +
    (input.cell.classPhrase ? `\n   class contract: the counterpart is the CLASS "${input.cell.classPhrase}", never a named rival company or product` : "");
  const draw = async (rejectNote: string | null): Promise<string | null> => {
    const res = await openaiClient().chat.completions.create({
      model: CELLS_MODEL,
      messages: [
        {
          role: "system",
          content: CELL_WRITER_SYSTEM +
            (input.nearTo
              ? "Write exactly ONE NEAR VARIANT of the given prompt for the " +
                "cell below: the SAME designed ask, with ONE concrete detail " +
                "moved (a number, a constraint, a context detail, who is " +
                "affected) - noticeably different, never radically different, " +
                "and never a mere rewording. It must also differ from every " +
                "previous prompt listed. Return one cell object."
              : "Write exactly ONE prompt for the single cell below. It must ask " +
                "the cell's question a genuinely DIFFERENT WAY than every " +
                "previous prompt listed - a different angle of attack, different " +
                "concrete specifics, a different kind of asker - never a " +
                "paraphrase or reordering of one. Return one cell object."),
        },
        {
          role: "user",
          content:
            `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
            `Rivals: ${rivals.map(primaryBrandName).join(", ")}\nAudience: ${input.audience ?? "unknown"}\n\n` +
            `Cell plan:\n${planText}\n\n` +
            (input.nearTo ? `The prompt to vary:\n${input.nearTo.trim()}\n\n` : "") +
            `Previous prompts for this cell (write something DIFFERENT):\n` +
            (avoidNorm.map((t, i) => `${i + 1}. ${t}`).join("\n") || "- (none)") +
            (rejectNote ? `\n\n[your previous draw was rejected: ${rejectNote}]` : ""),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "grid_cells", strict: true, schema: CELLS_SCHEMA },
      },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
      cells: { text?: string }[];
    };
    return humanize((parsed.cells?.[0]?.text ?? "").trim()) || null;
  };
  // "New prompt" / "near variant" / "Suggest another" run the same free
  // checks as generateGrid's writer output (they used to serve raw text -
  // the one seed path that skipped every check): mechanical brand rule,
  // then the doubt/plan design intent, one steered retry, and null rather
  // than an unchecked seed - the client keeps what it has.
  const intent = process.env.PHRASINGS_CHECKS !== "0" ? stageDesignIntent(input.cell.stage, input.brand, input.cell.concern, input.cell.angle, input.cell.situation) : null;
  let text: string | null = null;
  let note: string | null = null;
  for (let attempt = 0; attempt < 3 && !text; attempt++) {
    const cand = await draw(note);
    if (!cand) return null;
    if (avoidNorm.some((t) => t.toLowerCase() === cand.toLowerCase())) return null;
    if (process.env.PHRASINGS_CHECKS !== "0")
      await primeBrandVerdicts({ items: [{ text: cand, brands: specFor(cand).forbiddenBrands }], roster: [input.brand, ...input.competitors], aliases: aliasForms, category: input.category, meta: input.meta });
    const problems =
      process.env.PHRASINGS_CHECKS !== "0"
        ? checkPromptAgainstSpec({ text: cand, spec: specFor(cand), category: input.category, extraForms: aliasForms }).map((m) => m.detail)
        : [];
    // Alternate draws honor the blind category-noun rule too - this path
    // skipped it, which is how a "pocket camera" seed survived redraws.
    if (
      process.env.PHRASINGS_CHECKS !== "0" &&
      specFor(cand).brandMode === "blind" &&
      !PRE_CATEGORY_STAGES.has(input.cell.stage) &&
      !textNamesCategory(cand, input.category)
    ) {
      problems.push(
        `the prompt never speaks the category "${input.category}" - a blind prompt must use its plain everyday noun (the ordinary word a person calls this thing)`
      );
    }
    if (intent && problems.length === 0) {
      const [v] = await checkDesignFidelity({ candidates: [{ text: cand, design: intent }], meta: input.meta });
      if (!v.voices && !v.unchecked) problems.push(`off-design: ${v.reason || "does not voice the cell's design"}`);
    }
    if (problems.length === 0) { text = cand; break; }
    console.warn(`cell alt rejected [${input.cell.stage}]: ${problems.join("; ")} | ${cand.slice(0, 90)}`);
    note = `${problems.join(" ")} Do not reuse this wording: "${cand}"`;
  }
  if (!text) return null;
  await store.cacheSet(key, JSON.stringify(text), stampOf(input));
  return { text, spec: specFor(text) };
}

/* ------------------------------ phrasings ------------------------------- */

/** True when `text` names `brand` as a WORD, never as a substring of a
 * longer word - "purchases" must not read as the rival "Chase", nor
 * "discovering" as Discover. Boundaries are non-alphanumeric, so
 * "jira's" and "Chase Sapphire" match while "purchase" cannot. */
/** The first complete top-level JSON object in a reply (string-aware brace
 * scan). The greedy /\{[\s\S]*\}/ spanned two objects when the checker
 * emitted a second one, and the parse threw (2026-10-02 cold walk: a
 * Netflix drive went provisional on "Unexpected non-whitespace character
 * after JSON"). */
export function firstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** Remove a roster label's display disambiguator when a writer copies it
 * into prompt text ("Done with my iPhone (Apple)" from the label "Apple
 * (iPhone)", 2026-10-03 audit): a parenthetical that is just another form
 * of a tracked label - its base or its parenthetical part - is dropped. */
export function stripRosterParens(text: string, labels: string[]): string {
  const forms = new Set<string>();
  for (const l of labels) {
    if (!/\(/.test(l)) continue;
    forms.add(primaryBrandName(l).toLowerCase());
    for (const m of l.matchAll(/\(([^)]*)\)/g)) for (const part of m[1].split("/")) if (part.trim()) forms.add(part.trim().toLowerCase());
  }
  if (forms.size === 0) return text;
  return text.replace(/\s*\(([^)]{1,40})\)/g, (all, inner: string) => (forms.has(inner.trim().toLowerCase()) ? "" : all));
}

/** A brand label's speakable name: "Amazon (beauty)" -> "Amazon". The
 * parenthetical is a DISPLAY disambiguator - buyers never type it and
 * engines never say it, so any text shown to a model uses this form. */
export function primaryBrandName(brand: string): string {
  return brand.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

export function namesBrandWord(text: string, brand: string): boolean {
  const b = brand.trim();
  if (!b) return false;
  // Match the full label OR its speakable primary name: a rival stored as
  // "Amazon (beauty)" is named by text that says "Amazon" - the literal
  // parenthetical never occurs in natural writing, and matching only it
  // made the blind/branded signature blind to these rivals (and discarded
  // every paraphrase whenever a model copied the label verbatim).
  const forms = [b, primaryBrandName(b)].filter((f, i, a) => f && a.indexOf(f) === i);
  return forms.some((f) => {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${esc}(?:$|[^a-z0-9])`, "i").test(text);
  });
}

/** The brands (client + rivals) a text names, lowercased and sorted - the
 * blind/branded signature a paraphrase must preserve from its seed. */
export function brandSignature(
  text: string,
  brand: string,
  competitors: string[]
): string {
  return [brand, ...competitors]
    .map((b) => b.trim().toLowerCase())
    .filter((b) => b && namesBrandWord(text, b))
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
// "p8": every seed line carries its stage's guidance and the writer is
// told to stay inside it - the A/B (2026-09-17) showed hint-blind
// paraphrases drifting problem_recognition cells into solution-seeking
// ("which card gives cash back" is discovery wearing problem_recognition's
// clothes) on ~30 of 47 sampled, and 0 with the hint; the other stages
// were unchanged by it. p7 added word-boundary brand signatures (the
// "purchases"-reads-as-Chase poisoning) and init retries to quota.
// "p9" (2026-10-03 init audit): the retry's [overused: ...] list never
// names the category, the cell's circumstance/worry or its stage's ask
// verbs (avoidExempt) - retries were being steered away from the very
// words that define the question.
// "p10" (2026-10-03, Tyler: no category or brand examples in prompt text): the paraphrase writer's examples (roles, category terms,
// spec terms, qualifiers) are described, never quoted.
const PHRASINGS_VERSION = "p10";
// Over-generate so the overlap filter can be strict and still fill the set.
const PHRASINGS_EXTRA = 3;
/** Blind cells get a wider first-pass margin: with no brand tokens to
 * exempt, a narrow-vocabulary blind ask (beauty retail's "where should I
 * shop for makeup", detergent's "best detergent") loses more candidates
 * to the overlap filter - Sephora and Tide both ran short ONLY on blind
 * picks-a-brand stages. Output tokens are the cheap side of the call. */
const PHRASINGS_EXTRA_BLIND = 5;
/** Cells per paraphrase model call. Sized so the worst case (~8 cells x
 * 14 candidates of long-winded seeds) finishes well inside the client's
 * 150s deadline - the paraphrase analogue of CELL_CHUNK. */
const PHRASINGS_CHUNK = 8;
/** The retry's wider margin: a cell that came up short is fighting the
 * overlap filter, so give it more candidates to survive it. */
const PHRASINGS_EXTRA_RETRY = 6;
/** Retry rounds during the initial write: the served batch arrives full
 * instead of getting healed later by a visible top-up. 2 -> 3 (Tyler
 * 2026-10-01): the AmEx walk left seven constraint-dense cells at 7-9/10
 * after two rounds; a third fresh-roll round usually buys the last slots.
 * Still bounded - the loop exits early whenever a round adds nothing. No
 * STYLE bump: a short cached set is still a valid set, not a semantics
 * change (the manual top-up covers old entries). */
const PHRASINGS_RETRY_ROUNDS = 3;
/** Wait budget on someone else's in-flight work; the 300s route leaves
 * room to wait out a slow write plus its retry pass. Staleness itself is
 * heartbeat-based (ORPHAN_MS) like the cell path: generators beat while
 * working, so a dead claim clears in under a minute instead of being
 * trusted for a TTL sized to the slowest write. */
const PHRASINGS_WAIT_MS = 150_000;
const PHRASINGS_POLL_MS = 2_000;

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
  cells: {
    stage: string; situation: string | null; angle: string; mode?: string | null; text: string;
    /** The cell's carried check-spec (s7+). Present = the spec path (the
     * design is re-derived from the cell and preferred over the carried
     * copy); absent = the legacy string-derived path, unchanged. */
    spec?: CellCheckSpec | null;
    /** The cell's planned concern (s9+): rides into the re-derived spec's
     * design line so paraphrases are checked against the DESIGNED worry. */
    concern?: string | null;
    /** Class-angle comparison cells (2026-10-01): select the
     * comparison_class spec, writer note and design line. */
    classPhrase?: string | null;
    classBrand?: string | null;
  }[];
  /** Total phrasings wanted per cell including the seed. */
  count: number;
  /** All planned concerns in the battery (doubt cells' assignments):
   * each cell's paraphrases must not import a SIBLING's concern (the
   * Jira C30 bleed - learning-curve paraphrases adding performance). */
  avoidConcerns?: string[];
  /** Typed roster (see generateGrid). Absent = untyped. */
  rosterRoles?: RosterRoles;
  /** Skip the cache read: the user asked for a fresh set. */
  force?: boolean;
  /** A background warm: generate what nobody else is generating, but never
   * sit waiting on another request's in-flight work. */
  noWait?: boolean;
  /** Diagnostic hook: receives the raw parsed model output. */
  onRaw?: (raw: unknown) => void;
  meta?: CacheMeta;
}): Promise<Phrasing[][]> {
  tagCosts({ purpose: "setup:phrasings" });
  // Retired stages get no paraphrases (a saved draft may still hold such a
  // cell): run on the live cells and give retired positions an empty set.
  if (input.cells.some((c) => RETIRED_STAGES.has(c.stage))) {
    const live = input.cells.map((c, i) => ({ c, i })).filter((x) => !RETIRED_STAGES.has(x.c.stage));
    const got = await generatePhrasings({ ...input, cells: live.map((x) => x.c) });
    const out: Phrasing[][] = input.cells.map(() => []);
    live.forEach((x, k) => { out[x.i] = got[k] ?? []; });
    return out;
  }
  // Same-seat rivals only (see generateGrid): the writer's rivals, the
  // signature filter, the spec brand sets, checkBattery's scope and the
  // cache keys all read this list. No roles = the input list itself.
  // r13: the dictionary seed's alias forms ("amex" for American Express),
  // read from the FULL roster so the cache key is the one project creation
  // reuses - every brand check below speaks the same vocabulary.
  const aliasForms = await brandAliasForms([input.brand, ...input.competitors]);
  input = { ...input, competitors: sameSeatOf(input.competitors, input.rosterRoles) };
  const want = Math.max(0, input.count - 1);
  if (want === 0 || input.cells.length === 0) return input.cells.map(() => []);
  const rivals = angleRivals(input.competitors, input.rosterRoles);
  // Brand names are MANDATORY vocabulary in branded cells (the same-brands
  // rule), so counting them in the overlap filter or the worn-words list
  // punishes candidates for obeying the rules. Narrow-lexicon stages
  // (pricing/value: brand + worth/cost/price is most of the ask) plateaued
  // at ~5-6/10 because every pair shared the brand tokens by construction.
  const hintOf = new Map(stageLibrary(input.base).map((s) => [s.key, s.hint]));
  const brandTokens = new Set(
    [input.brand, ...rivals].flatMap((b) => [...wordSet(b)])
  );
  const contentWords = (t: string): Set<string> => {
    const s = wordSet(t);
    for (const b of brandTokens) s.delete(b);
    return s;
  };
  // Per-cell cache entries: one edited question re-buys only itself, any
  // batch slicing hits the same entries, and the single-cell fill shares
  // them. The base read and journeys stay in the key - a read edit that
  // leaves a cell's text identical must not serve paraphrases voiced
  // under the old read.
  // Per-cell keys carry only the cell's OWN scenario dependency (its
  // situation's journey note) - the old composition folded every
  // scenario label into every key, so renaming one scenario re-keyed
  // and redrew all ~500 paraphrases. See phrasingCacheKey.
  const keys = input.cells.map((c) => phrasingCacheKey(input, c, input.avoidConcerns));
  const out: Phrasing[][] = input.cells.map(() => []);
  // Each cell's resolved spec, looked up by cell object: pass() and the
  // filters see subsets, never indices into input.cells.
  const specOf = new Map<(typeof input.cells)[number], CellCheckSpec>();
  for (const c of input.cells) {
    const spec = resolveCellSpec(c, input.brand, input.competitors, input.category);
    if (spec) specOf.set(c, spec);
  }

  /** A pending marker's claim time, or null for a real value / no entry. */
  const pendingAt = (raw: string | null): number | null => {
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as { __pending?: number } | Phrasing[];
      return Array.isArray(v) ? null : typeof v.__pending === "number" ? v.__pending : null;
    } catch {
      return null;
    }
  };
  const valueOf = (raw: string): Phrasing[] | null => {
    try {
      const v = JSON.parse(raw) as { __pending?: number } | Phrasing[];
      return Array.isArray(v) ? v.map((ph) => ({ ...ph, text: humanize(ph.text) })) : null;
    } catch {
      return null;
    }
  };

  // The model reads speakable names; the signature checks the stored
  // labels (the matcher accepts either form, so both sides agree).
  const rivalsShown = rivals.map(primaryBrandName);
  const journeyLines = input.scenarios
    .map((s) => journeyNote(input.base, s))
    .filter((n): n is string => n !== null);
  const journeysText =
    journeyLines.length > 0 ? `Buyer journeys that differ: ${journeyLines.join("; ")}\n` : "";

  /** One model pass over a subset of cells; returns kept phrasings per
   * subset position. Filtering happens here so a retry sees real gaps. */
  async function pass(
    subset: typeof input.cells,
    opts?: {
      /** Wider candidate margin for retry passes. */
      extra?: number;
      /** Keepers from an earlier pass, per subset position: the filter
       * seeds from them so only NEW compatible phrasings come back. */
      have?: Phrasing[][];
      /** Worn-out content words per subset position - the writer is told
       * to find other ways into the ask. */
      avoidWords?: string[][];
      /** Overlap ceiling override for the last-resort round. */
      maxOverlap?: number;
    }
  ): Promise<Phrasing[][]> {
    const blindSeed = (c: (typeof subset)[number]) => {
      const spec = specOf.get(c);
      return spec ? spec.requiredBrands.length === 0 : brandSignature(c.text, input.brand, rivals) === "";
    };
    const extra =
      opts?.extra ??
      (subset.some(blindSeed)
        ? PHRASINGS_EXTRA_BLIND
        : PHRASINGS_EXTRA);
    // The seed's brand note: a spec cell's is rendered FROM its design;
    // a legacy cell's is inferred from the seed's spelling, as before.
    const brandNote = (c: (typeof subset)[number]): string => {
      const spec = specOf.get(c);
      if (spec) {
        const note = specWriterNote(spec);
        // A planned concern rides with the seed: the paraphrases voice
        // THAT worry only, never the battery's other designed concerns.
        const others = (input.avoidConcerns ?? []).filter((x) => x && x.toLowerCase() !== (spec.concern ?? "").toLowerCase());
        const cnote = spec.concern
          ? `\n   [designed concern: ${spec.concern} - every paraphrase voices THIS worry as its main point${others.length > 0 ? `; never these, which other cells cover: ${others.join("; ")}` : ""}]`
          : "";
        return (note ? `\n   ${note}` : "") + cnote;
      }
      return brandSignature(c.text, input.brand, rivals) === ""
        ? MUST_NAME_STAGES.has(c.stage)
          ? `\n   [this stage must name ${input.brand}: every paraphrase names ${input.brand} (the seed's blind wording is a legacy defect - do not preserve it), never a rival]`
          : `\n   [deliberately blind variant: name NO brand - the guidance's subject stays implied by the category noun, never named]`
        : "";
    };
    const cellText = subset
      .map(
        (c, i) =>
          `${i}. [stage=${c.stage} situation=${c.situation ?? "-"} angle=${planAngle(c)}${c.mode ? ` reach=${c.mode}` : ""}] ${c.text}` +
          // The stage's guidance rides with every seed: without it the
          // writer drifted problem_recognition ("pre-category") cells
          // into solution-seeking asks - real people ask for products,
          // and the writer had no way to know this stage must not.
          (hintOf.get(c.stage) ? `\n   [stage guidance: ${hintOf.get(c.stage)}]` : "") +
          // The owned noun travels WITH the seed (2026-10-01): the
          // continuity check rejects paraphrases that trade "chips" for
          // "snacks", but nothing told the writer which word to keep -
          // the Doritos crumbs cell starved to 0/9 on exactly this.
          (PRE_CATEGORY_STAGES.has(c.stage) && categoryNounOf(c.text, input.category)
            ? `\n   [owned noun: every paraphrase keeps the word "${categoryNounOf(c.text, input.category)}" (or a direct form of it) - substituting a broader word like "snacks" or "device" changes what is measured and the paraphrase will be rejected]`
            : "") +
          // But the seed's own brand pattern outranks the guidance: the
          // blind VARIANT of a client-anchored stage exists to measure
          // unprompted recall, and a guidance line saying "the client
          // brand" made the writer name it - every candidate then died
          // as a signature leak (six cells straight to 1/10 under p8).
          brandNote(c) +
          // INVARIANT cells only (s12): the persona is a voice lever, not
          // content. In a SITUATIONAL cell the asker's circumstance
          // belongs in the words - that leak is wanted. An invariant cell
          // (the comparison head-to-heads above all) has no owner, and a
          // persona written into the text re-pins it to one buyer's story.
          (c.situation == null
            ? "\n   [invariant cell: the asker persona shapes VOICE only - register, length, question form - and never appears in the words: no role, identity, occupation or life situation in the text]"
            : "") +
          (opts?.avoidWords?.[i]?.length
            ? `\n   [overused: ${opts.avoidWords[i].join(", ")}]`
            : "")
      )
      .join("\n");
    const res = await openaiClient().chat.completions.create({
      model: INSTRUMENT_HELPER_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You write paraphrase sets for a research instrument that measures " +
            "a brand's standing in AI assistant answers. Each seed prompt below " +
            "is one designed question. For EACH seed, write exactly " +
            `${want + extra} additional DISTINCT ways a real buyer would ask the SAME ` +
            "question - same circumstance, same intent, same brands named - in " +
            "the wordings people actually type into a chat assistant.\n" +
            "Each paraphrase is a DIFFERENT PERSON in the same circumstance " +
            "describing it their own way - NOT a rewording of the seed. Do not " +
            "copy the seed's qualitative details (its examples, its list of " +
            "symptoms); describe the circumstance in your own words or leave " +
            "details out entirely. NUMBERS are different: a number in the " +
            "seed is a FACT of the designed question - keep it exactly as " +
            "written or leave it out, NEVER swap it for a different value, and " +
            "never add a number the seed does not carry. Standard spec terms " +
            "are vocabulary, not quantities - they stay as written. Some askers give backstory, some just ask.\n" +
            "Vary, across the set: who is asking (pick roles realistic for THIS audience and " +
            "circumstance, and tag each with `asker`), register (casual to " +
            "formal, as fits the audience), length (a " +
            "terse 8-word ask to a two-sentence backstory), and question form.\n" +
            "Rules:\n" +
            "- If the seed names NO brand, name NO brand or product in any " +
            "paraphrase. Blind prompts are the measurement. EXCEPTION: a " +
            "seed whose bracket note says its stage must name the client " +
            "brand - the note wins, every paraphrase names it.\n" +
            "- NEVER import a brand from the Rivals line above into a " +
            "paraphrase whose seed does not name it - the roster is context " +
            "for you, not vocabulary for the asker.\n" +
            "- If the seed names brands, every paraphrase names exactly those " +
            "same brands and no others.\n" +
            "- Never change the circumstance or the decision being made; never " +
            "add a new constraint the seed does not have.\n" +
            "- Keep the seed's category term exactly, never a shorter or " +
            "broader word for it - the category term is part of the " +
            "measurement. Never copy a scenario label's text " +
            "into a paraphrase.\n" +
            "- Defining qualifiers in the seed are FACTS, like its numbers: " +
            "a genre, cuisine, nationality, material or format stays exactly " +
            "as written, never broadened to a wider class.\n" +
            "- Blind means no BRAND names. The plain category noun is normal " +
            "speech - never contort around it.\n" +
            "- Never use planning vocabulary in a prompt: 'spec-driven', " +
            "'trust-driven', 'think/feel', journey or scenario terms are " +
            "OURS, not the asker's.\n" +
            "- No single persona in more than 2 of a set's paraphrases: " +
            "nine founders is one person nine times, not nine people.\n" +
            "- A seed's [stage guidance] is part of the SAME question: every " +
            "paraphrase stays inside it. If it says pre-category, the asker " +
            "does not know the category exists - they describe the pain and " +
            "ask for help, never for a product type.\n" +
            "- No verbatim repeats, no trivial reorderings; each paraphrase " +
            "should be something a different person would plausibly type.\n" +
            "- Punctuation people actually type: never an em dash, never the " +
            "tilde character.\n" +
            "- The text field holds ONLY the final prompt exactly as the " +
            "person would type it: never a note to yourself, a correction " +
            "('sorry', 'instead:'), a reference to the seed or this task, " +
            "or a bracketed annotation.\n" +
            "- A seed may carry [overused: ...]: content words its existing " +
            "phrasings already lean on. Do not build new phrasings around " +
            "those words - find other angles into the same ask (different " +
            "details, different framing, different vocabulary).\n" +            "- Typing, not prose: fragments happen, specifics are unpolished; " +
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
            `Rivals: ${rivalsShown.join(", ")}\nAudience: ${input.audience ?? "unknown"}\n` +
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
    // r15 brand judge: verdicts for every candidate's ambiguous one-word hits
    // on its cell's forbidden brands, before the sync signature check.
    if (process.env.PHRASINGS_CHECKS !== "0") {
      const items = (parsed.cells ?? []).flatMap((c) => {
        const sp = subset[c.index] ? specOf.get(subset[c.index]) : undefined;
        if (!sp) return [];
        return (c.phrasings ?? []).map((ph) => ({
          text: stripRosterParens(humanize((ph.text ?? "").trim()), [input.brand, ...input.competitors]).replace(/^asker:\s*[^-:]{1,40}[-:]\s*/i, ""),
          brands: sp.forbiddenBrands,
        })).filter((x) => x.text);
      });
      if (items.length > 0)
        await primeBrandVerdicts({ items, roster: [input.brand, ...input.competitors], aliases: aliasForms, category: input.category, meta: input.meta });
    }
    for (const c of parsed.cells ?? []) {
      const seed = subset[c.index];
      if (!seed) continue;
      // The signature matcher for the cell's OWN angle brand also accepts
      // the label's distinctive first word: a seed written "Sephora or
      // Ulta" never registered "Ulta Beauty", so every candidate that
      // named the rival properly carried a bigger signature and ALL were
      // discarded (the cell served 1/10 through every dial). Scoped to
      // the angle brand - where context makes the shorthand unambiguous -
      // and applied to seed and candidate alike, a stray match can only
      // add a brand both sides already carry. Blind counting elsewhere
      // keeps the strict matcher.
      const angle = seed.angle.trim().toLowerCase();
      const namesForSig = (rawText: string, b: string) => {
        // Shared with battery_checks: "pixel size" is a sensor term, not
        // the brand - unscrubbed it registered the target in blind cells
        // and killed honest candidates.
        const text = rawText.replace(TERM_COLLISIONS, " ");
        // A single short capitalized brand form ("Max", "Visa", "Citi")
        // is also an ordinary English word, and the case-blind matcher
        // poisoned signatures with it: a blind seed saying "2-3 services
        // max" carried sig {Max (HBO)}, so every honest blind candidate
        // was discarded for not naming Max - this cell lived at 2/10 for
        // its whole history. Such forms match case-SENSITIVELY here;
        // longer or lowercase-branded forms (Purple, jira) keep the
        // insensitive match so casual typing still registers. Signature
        // scope only - blind counting elsewhere is unchanged.
        // The cell's own angle brand in a comparison or alternatives cell
        // is DESIGN-NAMED: every text carries it, so context disambiguates
        // an ambiguous English-word form and the case guard is dropped for
        // it. Without this, "american express vs visa" (lowercase seed)
        // registered no rival while candidates' proper "Visa" did - every
        // faithful candidate died as a leak, unhealable (2026-09-29,
        // Tyler live). Blind cells keep the strict guard: "2-3 services
        // max" must still never register Max.
        const designAngle =
          (seed.stage === "comparison" || seed.stage === "alternatives") &&
          b.trim().toLowerCase() === angle;
        const forms = [b, primaryBrandName(b)].filter((f, i, a) => f && a.indexOf(f) === i);
        for (const f of forms) {
          const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          // Case-sensitive only for brand forms that are also ordinary
          // English words - the old shape test (any capitalized word of
          // 2-5 letters) starved real short names typed casually: a seed
          // saying lowercase "asana" registered NO brand, so every
          // candidate that wrote "Asana" properly died as a signature
          // mismatch (44 straight kills on one Jira V2 cell, 2026-09-28).
          const caseSensitive = !designAngle && SIG_AMBIGUOUS_FORMS.has(f.toLowerCase());
          if (new RegExp(`(?:^|[^a-z0-9])${esc}(?:$|[^a-z0-9])`, caseSensitive ? "" : "i").test(text)) return true;
        }
        // Token shorthand applies where context makes it unambiguous: the
        // cell's OWN angle rival, and the TARGET brand in must-name stages
        // (a churn seed saying "Google Pixel" with candidates typing bare
        // "Pixel" killed half of every batch - the family's target-side
        // sibling). Blind stages stay strict: "pixel density" in a blind
        // candidate must never register as the brand.
        const isTarget = b === input.brand;
        // Comparison and pricing join the must-name set here: their
        // target-named cells carry the same context guarantee, and in their
        // BLIND cells a bare-token candidate registering the target is a
        // leak that SHOULD die - correct in both directions.
        const targetOk = isTarget && (MUST_NAME_STAGES.has(seed.stage) || seed.stage === "comparison" || seed.stage === "pricing");
        if (b.trim().toLowerCase() !== angle && !targetOk) return false;
        // ANY distinctive token of the angle brand is its shorthand, split
        // on spaces and dots alike: "Ulta Beauty" is typed "Ulta",
        // "Monday.com" is "Monday" - and "Apple iPhone" is "iPhone", where
        // the distinctive token is SECOND (first-word-only shorthand left
        // the seed's signature empty and killed 14/14 candidates on the
        // Pixel alternatives cell, 2026-09-28). Ambiguous English-word
        // tokens stay case-sensitive.
        for (const tok of primaryBrandName(b).split(/[\s.]+/)) {
          if (tok.length < 4 || tok.toLowerCase() === b.trim().toLowerCase()) continue;
          const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const caseSensitive = !designAngle && SIG_AMBIGUOUS_FORMS.has(tok.toLowerCase());
          if (new RegExp(`(?:^|[^a-z0-9])${esc}(?:$|[^a-z0-9])`, caseSensitive ? "" : "i").test(text)) return true;
        }
        return false;
      };
      const sigOf = (text: string) =>
        [input.brand, ...rivals]
          .map((b) => b.trim().toLowerCase())
          .filter((b, i) => b && namesForSig(text, [input.brand, ...rivals][i]))
          .sort()
          .join("|");
      const spec = specOf.get(seed);
      let sig = spec
        ? `required=[${spec.requiredBrands.join(", ")}] forbidden=[${spec.forbiddenBrands.join(", ")}]`
        : sigOf(seed.text);
      // The expected signature is the CELL DESIGN's, not merely the seed
      // text's - two design-required brands are unioned in:
      // (1) must-name stages require the client brand (a blind seed is a
      //     legacy defect the writer is told to repair);
      // (2) comparison and offensive-alternatives cells require their
      //     angle rival. Seed spelling must not decide this: the AmEx
      //     "vs visa" seed spelled the rival lowercase, the ambiguous-word
      //     case guard didn't count it, and every candidate that wrote
      //     "Visa" properly died as a leak - 12-15/15 killed per batch,
      //     unhealable (2026-09-29, Tyler live).
      const unionSig = (name: string) => {
        const k = name.trim().toLowerCase();
        if (k && !sig.split("|").includes(k)) sig = [...sig.split("|").filter(Boolean), k].sort().join("|");
      };
      if (!spec && (MUST_NAME_STAGES.has(seed.stage) || seed.stage === "comparison")) unionSig(input.brand);
      if (
        !spec &&
        (seed.stage === "comparison" || seed.stage === "alternatives") &&
        seed.angle && !["generic", "defensive"].includes(seed.angle.trim().toLowerCase())
      ) {
        // The angle may be a display label ("Amazon (Beauty)") - union the
        // matching roster entry's sig token, which is what sigOf emits.
        const match = [input.brand, ...rivals].find(
          (b) => primaryBrandName(b).toLowerCase() === primaryBrandName(seed.angle).toLowerCase()
        );
        unionSig(match ?? primaryBrandName(seed.angle));
      }
      const prior = opts?.have?.[c.index] ?? [];
      const seen = new Set<string>([norm(seed.text), ...prior.map((p) => norm(p.text))]);
      const keptWords: Set<string>[] = [contentWords(seed.text), ...prior.map((p) => contentWords(p.text))];
      const kept: Phrasing[] = [];
      // Cull accounting (2026-09-28): a cell whose batch dies usually dies
      // to ONE filter (correlated kill - the Asana signature bug looked
      // exactly like bad luck from outside). Count the kills so a starved
      // cell names its eater in the logs instead of needing archaeology.
      const culls = { empty: 0, sig: 0, dup: 0, overlap: 0 };
      for (const p of c.phrasings ?? []) {
        // The writer occasionally merges its asker metadata into the
        // text ("asker: parent - two big dogs..."); the label belongs in
        // the field, never in a served prompt.
        const text = stripRosterParens(humanize((p.text ?? "").trim()), [input.brand, ...input.competitors]).replace(/^asker:\s*[^-:]{1,40}[-:]\s*/i, "");
        if (!text) { culls.empty++; continue; }
        // The signature check is the blind/branded discipline: a paraphrase of
        // a blind seed that names a brand is not a paraphrase, it is a leak.
        // Spec cells: every required brand named (tolerant), no forbidden
        // brand named (strict) - the design, not the seed's spelling.
        if (spec ? !checkCandidateSignature(text, spec, { category: input.category, extraForms: aliasForms }).ok : sigOf(text) !== sig) {
          culls.sig++;
          continue;
        }
        const n = norm(text);
        if (seen.has(n)) { culls.dup++; continue; }
        // A paraphrase that shares most of its words with the seed or a sibling
        // is a thesaurus pass, not another person asking; drop it. Brand
        // tokens are excluded - required words can't count as copying.
        const ws = contentWords(text);
        if (keptWords.some((k) => jaccard(k, ws) > (opts?.maxOverlap ?? MAX_OVERLAP))) { culls.overlap++; continue; }
        seen.add(n);
        keptWords.push(ws);
        kept.push({ text, asker: (p.asker ?? "").trim() });
        if (prior.length + kept.length >= want) break;
      }
      if (prior.length + kept.length < want) {
        console.warn(
          `phrasings cull [${seed.stage}] kept ${prior.length + kept.length}/${want} - ` +
          `raw ${(c.phrasings ?? []).length}, sig ${culls.sig}, overlap ${culls.overlap}, dup ${culls.dup}, empty ${culls.empty}, sig="${sig}" | ${seed.text.slice(0, 80)}`
        );
      }
      result[c.index] = kept;
    }
    return result;
  }

  /** Generate the given cells in one pass (plus the degenerate-set retry)
   * and cache each cell on its own key. Markers are claimed FIRST so a
   * concurrent identical request joins this work instead of repeating it. */
  const generate = async (idx: number[]): Promise<void> => {
    if (idx.length === 0) return;
    await Promise.all(
      idx.map((i) => store.cacheSet(keys[i], JSON.stringify({ __pending: Date.now() }), stampOf(input)))
    );
    // Same liveness contract as the cell path: the claim stays alive by
    // heartbeat, and the final write quiesces first so a stale beat can
    // never re-mask it as pending.
    const inFlight = new Set(idx);
    const hb = startHeartbeat(() => [...inFlight].map((i) => keys[i]), stampOf(input));
    try {
    const subset = idx.map((i) => input.cells[i]);
    const got = await pass(subset);
    // Reasoning models occasionally return a degenerate, near-empty set
    // for a whole batch. One retry on the cells that came up short fills
    // the gap without re-running what already worked.
    // Top up DURING init: short cells retry - wider margin, worn-word
    // steering, filter seeded from the keepers so only NEW compatible
    // phrasings come back, merged on top - and the retry LOOPS until
    // every cell reaches quota or a round stops helping. The batch is
    // served full; no visible after-the-fact healing.
    for (let round = 0; round < PHRASINGS_RETRY_ROUNDS; round++) {
      const deficient = got.map((k, j) => (k.length < want ? j : -1)).filter((j) => j >= 0);
      if (deficient.length === 0) break;
      const subs = deficient.map((j) => subset[j]);
      const have = deficient.map((j) => got[j]);
      const avoidWords = deficient.map((j) => {
        // Only genuinely WORN words (used in 2+ texts) steer the retry.
        // Banning every word ever used - the old build - outlawed the
        // ask's essential vocabulary on narrow-lexicon cells, so retries
        // returned candidates that failed the signature or drifted the
        // circumstance. Brand tokens never appear (contentWords).
        // p9: words that DEFINE the ask are never "worn" either (see
        // avoidExempt) - they recur in every faithful paraphrase by design.
        const counts = new Map<string, number>();
        for (const t of [subset[j].text, ...got[j].map((p) => p.text)]) {
          for (const w of contentWords(t)) counts.set(w, (counts.get(w) ?? 0) + 1);
        }
        const exempt = avoidExempt(subset[j], input.category);
        return [...counts.entries()]
          .filter(([w, n]) => n >= 2 && !exempt.has(w))
          .sort((a, b) => b[1] - a[1])
          .map(([w]) => w)
          .slice(0, 18);
      });
      const again = await pass(subs, { extra: PHRASINGS_EXTRA_RETRY, have, avoidWords });
      let progressed = false;
      deficient.forEach((j, k) => {
        if (again[k].length > 0) progressed = true;
        got[j] = [...got[j], ...again[k]].slice(0, want);
      });
      if (!progressed) break;
    }
    // LAST RESORT: a cell still short after the steered retries is a
    // narrow-lexicon seed - enumerated constraints or a two-brand
    // criteria ask - whose faithful retellings NEED the seed's words,
    // so the anti-copying bar itself is what starves it (Netflix's
    // use_case road-trip cell held at 2/10 through every dial). One
    // final round accepts higher overlap: ten same-ish retellings
    // measure better than three distinct ones. Normal cells fill in
    // the rounds above and never reach this.
    const starved = got.map((k, j) => (k.length < want ? j : -1)).filter((j) => j >= 0);
    if (starved.length > 0) {
      const again = await pass(starved.map((j) => subset[j]), {
        extra: PHRASINGS_EXTRA_RETRY,
        have: starved.map((j) => got[j]),
        maxOverlap: RELAXED_OVERLAP,
      });
      starved.forEach((j, k) => {
        got[j] = [...got[j], ...again[k]].slice(0, want);
      });
    }
    // CHECKS IN GENERATION (2026-09-28, Tyler's checks-first directive):
    // before anything is cached, doubt/plan cells' paraphrases must voice
    // their design (seed-as-design until cells carry stored lines) and the
    // batch must pass the mechanical battery checks. Design failures are
    // dropped and refilled once; mechanical prompt-level violations are
    // dropped; cell-level findings (seed-number propagation) are logged -
    // their fix is the writer's instruction, measured by its own A/B.
    // PHRASINGS_CHECKS=0 disables (single-change experiments, emergencies).
    const uncheckedCells = new Set<number>();
    if (process.env.PHRASINGS_CHECKS !== "0") {
      const designFilter = async (cellIdxs: number[]): Promise<number[]> => {
        const targets: { j: number; k: number }[] = [];
        const candidates: { text: string; design: string }[] = [];
        for (const j of cellIdxs) {
          // The STORED design line for spec cells; synthesized from the
          // seed for legacy ones (the same string - design-check cache
          // entries carry over).
          const spec = specOf.get(subset[j]);
          // Always derived FRESH from the current seed: a carried spec from
          // an earlier era can hold a null/stale designLine (the Netflix
          // "Korean thrillers" rephrase silently skipped the check on a
          // carried s7 spec, 2026-09-29).
          // A class cell's line is the head-to-head-vs-a-class design (the
          // same-question check then enforces class framing per paraphrase).
          let line = seedDesignLine(
            subset[j].stage, input.brand, subset[j].text, specOf.get(subset[j])?.concern ?? null,
            subset[j].classPhrase ? { classPhrase: subset[j].classPhrase as string } : null
          );
          if (!line) continue;
          const own = (specOf.get(subset[j])?.concern ?? "").toLowerCase();
          const others = (input.avoidConcerns ?? []).filter((x) => x && x.toLowerCase() !== own);
          if (own && others.length > 0)
            line += ` It must NOT primarily voice these OTHER designed concerns the battery covers elsewhere: ${others.join("; ")}.`;
          got[j].forEach((ph, k) => {
            targets.push({ j, k });
            candidates.push({ text: ph.text, design: line });
          });
        }
        if (candidates.length === 0) return [];
        const verdicts = await checkDesignFidelity({ candidates, meta: input.meta });
        const dropAt = new Map<number, Set<number>>();
        verdicts.forEach((v, i) => {
          // An unchecked verdict serves (fail open) but poisons the cell's
          // cacheability - the next request re-runs the check instead of
          // inheriting a stale pass for the cache TTL.
          if (v.unchecked) uncheckedCells.add(targets[i].j);
          if (!v.voices) {
            const t = targets[i];
            (dropAt.get(t.j) ?? dropAt.set(t.j, new Set()).get(t.j)!).add(t.k);
            console.warn(`phrasings design check dropped [${subset[t.j].stage}]: ${got[t.j][t.k]?.text.slice(0, 90)} - ${v.reason}`);
          }
        });
        const short: number[] = [];
        for (const [j, ks] of dropAt) {
          got[j] = got[j].filter((_, k) => !ks.has(k));
          if (got[j].length < want) short.push(j);
        }
        return short;
      };
      // Mechanical drops (free) run BEFORE the paid design pass and share
      // its refill round: a cell trimmed by the brand or number rule used
      // to ship short and lean on the wizard's visible auto top-up - now
      // it heals inside the batch like a design kill (Tyler, 2026-09-29,
      // the AmEx "2 kids" use_case top-up).
      const mechanicalFilter = (cellIdxs: number[]): number[] => {
        const findings = checkBattery({
          brand: input.brand,
          // The FULL same-seat list - the writer's 4-rival cap is a prompt
          // budget, not a check scope (a leak of rival #5 is still a leak);
          // upstream brands are out of scope by TYPE (free vocabulary).
          competitors: input.competitors,
          category: input.category,
          extraForms: aliasForms,
          cells: cellIdxs.map((j) => ({
            stage: subset[j].stage, angle: subset[j].angle, text: subset[j].text,
            phrasings: got[j].map((ph) => ph.text),
            spec: specOf.get(subset[j]) ?? null,
            situation: subset[j].situation ?? null,
          })),
          scenarioLabels: input.scenarios.map((s) => s.label),
        });
        for (const f of findings) {
          const j = cellIdxs[f.cell];
          if (f.check === "duplicate_paraphrase") {
            console.warn(`battery check [${f.check}] cell ${subset[j]?.stage}: ${f.detail}`);
            continue;
          }
          // A prompt-level brand-rule violation never ships: drop the
          // offending paraphrase (a violating SEED is upstream's problem
          // and stays visible in the finding log).
          const before = got[j].length;
          got[j] = got[j].filter((ph) => ph.text !== f.text);
          if (got[j].length < before)
            console.warn(`battery check dropped [${f.check}] ${subset[j].stage}: ${f.text.slice(0, 90)}`);
        }
        return cellIdxs.filter((j) => got[j].length < want);
      };
      const all = subset.map((_, j) => j);
      const mechShort = mechanicalFilter(all);
      const designShort = await designFilter(all);
      const short = [...new Set([...mechShort, ...designShort])];
      if (short.length > 0) {
        // One refill round for cells either filter emptied below target;
        // the refill itself passes both checks, with no second refill.
        const before = short.map((j) => got[j].length);
        const again = await pass(short.map((j) => subset[j]), {
          extra: PHRASINGS_EXTRA_RETRY,
          have: short.map((j) => got[j]),
        });
        short.forEach((j, k) => {
          got[j] = [...got[j], ...again[k]].slice(0, want);
        });
        const grew = short.filter((j, k) => got[j].length > before[k]);
        mechanicalFilter(grew);
        await designFilter(grew.filter((j) => got[j].length > 0));
      }
    }

    idx.forEach((i) => inFlight.delete(i));
    await hb.quiesce();
    await Promise.all(
      idx.map((i, j) => {
        out[i] = got[j];
        // Never cache an empty set as real - that would make a transient
        // failure sticky. A zero-stamped marker reads as stale, so waiters
        // stop waiting and the next request retries. A set whose design
        // check errored is served but NOT cached, for the same reason: a
        // checker outage must not mint a long-lived pass.
        return store.cacheSet(
          keys[i],
          got[j].length > 0 && !uncheckedCells.has(j)
            ? JSON.stringify(got[j])
            : JSON.stringify({ __pending: 0 }),
          stampOf(input)
        );
      })
    );
    } catch (err) {
      // A thrown pass (vendor error, truncated JSON) releases every
      // claimed marker: the retry regenerates immediately instead of
      // waiting out the orphan window and returning empty.
      console.error(`phrasings generation failed (${idx.length} cells) - markers released:`, err);
      idx.forEach((i) => inFlight.delete(i));
      await hb.quiesce();
      await Promise.all(
        idx.map((i) => store.cacheSet(keys[i], JSON.stringify({ __pending: 0 }), stampOf(input)).catch(() => {}))
      );
    } finally {
      await hb.stop();
    }
  };

  const mine: number[] = [];
  const theirs: number[] = [];
  if (input.force) {
    input.cells.forEach((_, i) => mine.push(i));
  } else {
    const raws = await Promise.all(keys.map((k) => store.cacheGet(k, CACHE_TTL_MS)));
    raws.forEach((raw, i) => {
      if (raw) {
        const at = pendingAt(raw);
        if (at === null) {
          const v = valueOf(raw);
          if (v && v.length > 0) {
            out[i] = v;
            return;
          }
        } else if (Date.now() - at < ORPHAN_MS) {
          theirs.push(i);
          return;
        }
      }
      mine.push(i);
    });
  }

  /** Poll for cells another request claimed; a cell whose marker goes
   * stale (its generator died) is taken over here. */
  const waitForTheirs = async (): Promise<void> => {
    if (theirs.length === 0 || input.noWait) return;
    const open = new Set(theirs);
    const deadline = Date.now() + PHRASINGS_WAIT_MS;
    while (open.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, PHRASINGS_POLL_MS));
      const pend = [...open];
      const raws = await Promise.all(pend.map((i) => store.cacheGet(keys[i], CACHE_TTL_MS)));
      const orphaned: number[] = [];
      raws.forEach((raw, k) => {
        const i = pend[k];
        const at = pendingAt(raw);
        if (raw && at === null) {
          const v = valueOf(raw);
          if (v && v.length > 0) {
            out[i] = v;
            open.delete(i);
            return;
          }
        }
        if (at === null || Date.now() - at >= ORPHAN_MS) {
          orphaned.push(i);
          open.delete(i);
        }
      });
      if (orphaned.length > 0) await generate(orphaned);
    }
    // Deadline with generators still alive: never duplicate their work -
    // unresolved cells come back empty and the missing-paraphrases gate
    // heals them from the by-then-finished cache.
  };

  // The writer bounds its own call sizes the way the cell writer does
  // (CELL_CHUNK): one call per ~PHRASINGS_CHUNK cells, chunks in
  // parallel. Without this, a 30-cell request on a verbose brand asks
  // one response for ~400 paraphrases and can outrun the 150s client
  // deadline - athenahealth and Google Nest did exactly that, and the
  // SDK's auto-retries turned each overrun into minutes of dead air.
  const chunks: number[][] = [];
  for (let i = 0; i < mine.length; i += PHRASINGS_CHUNK) {
    chunks.push(mine.slice(i, i + PHRASINGS_CHUNK));
  }
  await Promise.all([...chunks.map((c) => generate(c)), waitForTheirs()]);
  return out;
}

function norm(t: string): string {
  return t.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ");
}

const MAX_OVERLAP = 0.5;
/** The last-resort round's ceiling - loose enough that a retelling
 * reusing a seed's mandatory constraint words survives, tight enough
 * that verbatim-adjacent copies still die. */
const RELAXED_OVERLAP = 0.75;
const STOP = new Set(
  "a an the and or of to for in on with we our us is are it this that how what which do does can should would i my me be as at by from have has need want".split(" ")
);

function wordSet(t: string): Set<string> {
  return new Set(norm(t).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
}

/** Rewrite steer for capability / job stages (2026-10-03 contract audit:
 * a rejected AmEx feature screen swapped "lounge access" for "hotel elite
 * status" - another of the client's signature perks). */
function swapRule(stage: string): string {
  return stage === "feature_screening" || stage === "use_case"
    ? " If you replace the capability or job, pick one buyers commonly ask about across the category - never another of the client brand's signature strengths."
    : "";
}

/** The words a stage's ask is made of: the verbs that carry its question
 * (comparisons ask for the pick, churn/renewal keep staying on the table,
 * open-choice invites named picks, pricing weighs cost). */
const STAGE_ASK_WORDS: Record<string, string> = {
  comparison: "pick choose choosing between versus better",
  churn_triggers: "keep keeping stay staying stick cancel canceling cancelling leave leaving switch switching worth",
  renewal: "renew renewing renewal keep keeping stay staying stick cancel canceling cancelling leave leaving switch switching worth",
  objections: "worth worried worry concern",
  pricing: "worth cost costs price pay paying value",
  premium_worth: "worth premium name names pick picks recommend",
  discovery: "name names recommend recommendations suggest pick picks options brands",
  shortlist: "name names recommend recommendations suggest pick picks options brands shortlist",
  use_case: "name names recommend recommendations suggest pick picks options brands",
  social_validation: "name names recommend recommendations pick picks brands",
  feature_screening: "name names recommend which options brands",
  alternatives: "alternatives alternative instead name names recommend options brands",
  repertoire: "name names recommend pick picks brands",
};

/** Words the worn-words retry list must never contain (p9, 2026-10-03
 * init audit): the overused list counted every content word in 2+ texts,
 * so the CATEGORY ("project management", "tortilla chips" - on 30-36 of
 * ~50 cells' lists), the cell's circumstance and worry, and the stage's
 * ask verbs ("pick", "keep", "cancel") were the first words a retry was
 * told to avoid - the source of category words dropped, comparisons that
 * stopped asking for the pick and churn sets that lost the stay option,
 * all concentrated at the appended retry positions. Singular/plural
 * variants are included so "chip" and "chips" are both exempt. */
function avoidExempt(
  cell: { stage: string; situation: string | null; concern?: string | null; classPhrase?: string | null },
  category: string
): Set<string> {
  const out = new Set<string>();
  const add = (t: string | null | undefined) => {
    for (const w of wordSet(t ?? "")) {
      out.add(w);
      out.add(w.endsWith("s") ? w.slice(0, -1) : `${w}s`);
    }
  };
  add(category);
  add(cell.situation);
  add(cell.concern);
  add(cell.classPhrase);
  add(STAGE_ASK_WORDS[cell.stage]);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Room labels in sentence case (2026-10-03 room walk v7: with the example
 * labels gone, 8 of 60 came back in Title Case). Every word after the first
 * that is a plain capitalized word is lowercased, hyphen parts included;
 * acronyms, figures and mixed-case words (all caps, digits, an inner
 * capital) are kept. Rooms never name brands, so the cost is the rare
 * proper noun after the first word. */
export function roomLabel(label: string): string {
  const t = label.trim();
  if (!t) return t;
  const plainCap = /^[A-Z][a-z'’]+$/;
  return t.split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w)) return w;
    return w.split("-").map((part, k) =>
      (i === 0 && k === 0) || !plainCap.test(part) ? part : part.toLowerCase(),
    ).join("-");
  }).join("").replace(/^[a-z]/, (c) => c.toUpperCase());
}

/** Real people type hyphens and straight quotes; model output leans on em
 * dashes and curly quotes, which reads as machine-written to the engines. */
export function humanize(t: string): string {
  const out = t
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/~\s*(?=\d)/g, "about ")
    .replace(/~/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/  +/g, " ")
    .trim();
  // A prompt wrapped whole in quote marks is the writer quoting itself, not
  // something a person types (s20: a jira seed shipped in literal quotes).
  // Only a full matched wrap whose quote character never recurs inside is
  // stripped - a prompt that quotes someone (my boss said "...") is kept.
  const q = out[0];
  const wrapped =
    out.length > 2 && (q === '"' || q === "'") && out.endsWith(q) && !out.slice(1, -1).includes(q);
  return wrapped ? out.slice(1, -1).trim() : out;
}

/* ------------------------------ orchestrator ---------------------------- */

/** Gate 1 of setup: the market read (base journey + scenarios with their
 * journeys) and the participation mask over the stage library. `moderators`
 * is the base read, kept for the parts of the app that store one read. */
export async function composeInstrument(input: {
  category: string;
  audience: string | null;
  /** Brand-aware read - see readScenarios.forBrand. */
  forBrand?: string | null;
  noWait?: boolean;
  meta?: CacheMeta;
}): Promise<{
  base: Moderators;
  moderators: Moderators;
  scenarios: ScenarioSpec[];
  reserve: ScenarioSpec[];
  stages: MaskedStage[];
} | null> {
  tagCosts({ purpose: "setup:compose" });
  const read = await readScenarios(input);
  // Ternary, not an if-guard: Turbopack's compile-time evaluation folds
  // `if (!read) return null` here as "unreachable" (it wrongly concludes
  // the same-module coalesced call can't resolve null) and ships the
  // destructure against null. The expression form survives compilation.
  return read === null
    ? null
    : {
        base: read.base,
        moderators: read.base,
        scenarios: read.scenarios,
        reserve: read.reserve,
        stages: participationMask(read.base, read.scenarios),
      };
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
  rosterRoles?: RosterRoles;
  rosterClasses?: RosterClasses;
  meta?: CacheMeta;
}): Promise<Instrument> {
  tagCosts({ purpose: "setup:compose" });
  const composed = await composeInstrument({
    category: input.category,
    audience: input.audience,
    meta: { brand: input.brand, ...input.meta },
  });
  if (!composed) throw new Error("the market read came back empty");
  const { base, scenarios, stages } = composed;
  const cells = await generateGrid({
    ...input,
    base,
    scenarios,
    stages: stages.filter((st) => st.recommended),
  });
  if (!cells) throw new Error("the cell write came back empty");
  return { base, moderators: base, scenarios, stages, cells };
}

/** True when a prompt names the brand or any competitor - such prompts are
 * stored with theme "branded" so the unbranded funnel stays blind. */
export function namesAnyBrand(
  text: string,
  brand: string,
  competitors: string[]
): boolean {
  return [brand, ...competitors]
    .filter(Boolean)
    .some((b) => namesBrandWord(text, b));
}
