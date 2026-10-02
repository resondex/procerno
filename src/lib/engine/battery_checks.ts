/**
 * Deterministic battery checks (2026-09-28, Tyler's checks-first directive):
 * the defect classes found by hand this week, as mechanical checks the
 * system runs - stage brand rules (the 112-prompt must-name/blind class),
 * seed-number propagation across a cell's paraphrases (the 30-45W class),
 * and exact duplicates. Model-based design fidelity lives in
 * instrument.checkDesignFidelity; this module is pure and free.
 *
 * Validated against the rejected-prompt corpus: the pre-rewrite originals
 * of every hand-fixed prompt must flag, the fixed battery must pass
 * (~/Documents/procerno_eval/internal_models/conformance/checker_fixture.md).
 */
/* -------------------- typed competitor roster (2026-09-30) ----------------
 * Every competitor is typed by WHO IT SELLS TO; its per-tracker ROLE is the
 * intersection with the tracker's audience (engine/roster.ts classifies,
 * the wizard's chip toggle is the human gate):
 * - same_seat: the audience can buy it - full cell rights (angle slots,
 *   writer rivals, forbidden/required brand sets);
 * - upstream: it sells to the rivals / the trade, not the audience (Visa
 *   and Mastercard on an AmEx consumer tracker) - no cells ever; it is
 *   free vocabulary and concern-planner context ("weather").
 * Absent roles = every competitor same_seat = the untyped behavior,
 * byte-identical. Order is preserved: the roster's own order still decides
 * which same-seat rivals get the angle slots. */
export type RosterRole = "same_seat" | "upstream";
export type RosterRoles = Record<string, RosterRole>;

/** The angle-slot budget: comparison / alternatives cells go to the first
 * this-many same-seat rivals. */
export const ANGLE_SLOTS = 4;

/** A competitor's role: exact name first, then a case/punctuation-blind
 * match; anything unlisted (a hand-added rival) is same_seat. */
export function rosterRoleOf(name: string, roles?: RosterRoles | null): RosterRole {
  if (!roles) return "same_seat";
  const exact = roles[name];
  if (exact === "upstream" || exact === "same_seat") return exact;
  const k = key(name);
  for (const [n, r] of Object.entries(roles)) if (key(n) === k) return r === "upstream" ? "upstream" : "same_seat";
  return "same_seat";
}

/** The rivals a buyer actually weighs, in roster order. Returns the input
 * array itself when nothing is upstream, so untyped callers see no change. */
export function sameSeatOf(competitors: string[], roles?: RosterRoles | null): string[] {
  if (!roles || !competitors.some((c) => rosterRoleOf(c, roles) === "upstream")) return competitors;
  return competitors.filter((c) => rosterRoleOf(c, roles) !== "upstream");
}

/** The upstream brands (weather), in roster order. */
export function upstreamOf(competitors: string[], roles?: RosterRoles | null): string[] {
  if (!roles) return [];
  return competitors.filter((c) => rosterRoleOf(c, roles) === "upstream");
}

/** The comparison / alternatives angle slots for a roster: the first
 * ANGLE_SLOTS same-seat rivals - an upstream entry never holds a slot, and
 * never pushes a same-seat rival out of one by its list position. */
export function angleRivals(competitors: string[], roles?: RosterRoles | null): string[] {
  return sameSeatOf(competitors, roles).slice(0, ANGLE_SLOTS);
}

/* ---------------------- class-angle cells (2026-10-01) ---------------------
 * An upstream brand holds no ENTITY cell (its buyer can't buy from it), but
 * when consumers still choose BY it as a class of products ("should I get
 * the Amex or just a Visa card?") it earns a CLASS-ANGLE head-to-head: the
 * client brand weighed against "a Visa card" as a category of products,
 * never against a named rival entity. The roster classifier marks such
 * upstream brands consumerSalient and names their classPhrase; the wizard
 * sends brand -> classPhrase as RosterClasses. Class cells are additive
 * (they never take an entity angle slot) and report on their own dashboard
 * row - never pooled into open_choice or entity head-to-heads (AGENTS.md,
 * the parked rail rollup). Absent classes = no class cells, byte-identical. */
export type RosterClasses = Record<string, string>;

/** At most this many class-angle cells per battery, in roster order. */
export const CLASS_SLOTS = 2;

export interface ClassAngle {
  /** The upstream roster entry the class evokes ("Visa"). */
  classBrand: string;
  /** How a buyer speaks the class ("a Visa card"). */
  classPhrase: string;
}

/** The class angles a roster earns: upstream entries (by role) carrying a
 * class phrase, in roster order, capped at CLASS_SLOTS. A same-seat entry
 * never yields a class (it holds entity cells); no classes = []. */
export function classAnglesOf(
  competitors: string[], roles?: RosterRoles | null, classes?: RosterClasses | null
): ClassAngle[] {
  if (!classes || !roles) return [];
  const phraseOf = (name: string): string => {
    const exact = classes[name];
    if (typeof exact === "string") return exact.trim();
    const k = key(name);
    for (const [n, p] of Object.entries(classes)) if (key(n) === k) return (p ?? "").trim();
    return "";
  };
  // "a Mastercard card" -> "a Mastercard": when the brand token itself ends
  // with the class head noun, the classifier's "<brand> <noun>" template
  // doubles it and no buyer talks that way (audit J9). Collapsed at read
  // time so existing drafts heal without re-classification; the changed
  // phrase self-versions through every cache key that carries it.
  const dedupeHead = (p: string): string => {
    const parts = p.trim().split(/\s+/);
    if (parts.length >= 2) {
      const last = key(parts[parts.length - 1]);
      const prev = key(parts[parts.length - 2]);
      if (last && prev !== last && prev.endsWith(last)) return parts.slice(0, -1).join(" ");
    }
    return p.trim();
  };
  const out: ClassAngle[] = [];
  for (const c of upstreamOf(competitors, roles)) {
    const classPhrase = dedupeHead(phraseOf(c));
    if (classPhrase) out.push({ classBrand: c, classPhrase });
    if (out.length >= CLASS_SLOTS) break;
  }
  return out;
}

/** Stages whose prompts MUST name the client brand (A3, 2026-09-27; owned
 * here so instrument can import the checks without a cycle). */
export const MUST_NAME_STAGES = new Set([
  "objections", "churn_triggers", "renewal", "business_case",
  "problem_resolution", "expansion", "ecosystem", "advocacy", "repertoire",
]);

export const DOUBT_CHECK_STAGES = new Set(["objections", "churn_triggers", "renewal", "repertoire"]);
export const PLAN_CHECK_STAGES = new Set(["problem_resolution", "expansion", "ecosystem", "advocacy"]);

/** The six measurement types (V02_QUESTION_TYPES.md, decided 2026-09-27).
 * The TAG is the story ("picks a brand"); the TYPE is the score - which
 * fields are read and which dashboard view an answer feeds. */
export type QuestionType =
  | "open_choice" | "head_to_head" | "within_brand"
  | "doubt" | "awareness" | "settled_customer";

const STAGE_TYPE: Record<string, QuestionType> = {
  problem_recognition: "awareness", category_education: "awareness", criteria: "awareness",
  discovery: "open_choice", shortlist: "open_choice", feature_screening: "open_choice",
  use_case: "open_choice", social_validation: "open_choice", premium_worth: "open_choice",
  comparison: "head_to_head",
  objections: "doubt", churn_triggers: "doubt", renewal: "doubt", repertoire: "doubt",
  business_case: "settled_customer", problem_resolution: "settled_customer",
  expansion: "settled_customer", ecosystem: "settled_customer", advocacy: "settled_customer",
};

/** The decided per-cell typing, computed mechanically: stage default, with
 * pricing split by whether the cell names the target (its tiers = within
 * brand; generic = open choice) and alternatives split by angle (defensive =
 * keep-or-leave doubt; a rival's cell = open choice with a prompted rival).
 * Advocacy's critic-quoting cells type as doubt at labeling time via their
 * design lines; the stored default is settled_customer. */
export function questionTypeOf(cell: { stage: string; angle: string; text: string }, brand: string, category?: string): QuestionType {
  if (cell.stage === "pricing")
    return textNamesBrand(cell.text, brand, { excludeTokens: new Set(key(category ?? "").split(" ").filter(Boolean)) })
      ? "within_brand" : "open_choice";
  if (cell.stage === "alternatives")
    return cell.angle === "defensive" ? "doubt" : "open_choice";
  return STAGE_TYPE[cell.stage] ?? "open_choice";
}

/** The design a stage's paraphrases must voice, synthesized from the cell
 * seed until cells carry stored design lines. problem_resolution has its
 * own wording - the generic plan line mis-flagged 15 conforming support
 * asks in the harness. */
export function seedDesignLine(
  stage: string, brand: string, seed: string, concern?: string | null,
  /** A class-angle comparison cell's class (2026-10-01): the design is a
   * head-to-head against the CLASS, so a paraphrase that swaps the class
   * for a named rival fails the same-question check. Absent = unchanged. */
  cls?: { classPhrase: string } | null
): string | null {
  if (stage === "comparison" && cls?.classPhrase)
    return `Question design (head-to-head vs a class): the question weighs ${brand} against ${cls.classPhrase} as a CLASS of products - a specific rival product or company name in place of the class does not satisfy the design. Designed as: "${seed}"`;
  // "SAME concern/plan as the designed question" (2026-09-29): the earlier
  // wording only demanded A doubt about the brand, so a gifting objection
  // could drift into nine limited-drops objections and pass - each still
  // voiced a doubt about the brand, just not the designed one. A PLANNED
  // concern (2026-09-30) names the subject outright - the strongest form.
  if (DOUBT_CHECK_STAGES.has(stage)) {
    const keepLeave = stage === "churn_triggers" || stage === "renewal"
      ? ` The asker weighs STAYING with ${brand} against LEAVING it, and the leave option stays stated - a fix-it or tune-it rewording that drops the option of leaving does not satisfy the design.`
      : "";
    return concern
      ? `Question design (doubt): the question voices the buyer's concern about ${brand} on THIS designed subject: ${concern}. THAT worry must be the question's MAIN point - a question whose main worry is something else does not satisfy the design even if it mentions the subject in passing. A value-math request without the stated worry does not voice it, an eligibility or rules lookup does not voice it even when the rules are unfavorable to the asker ("am I likely to be ineligible?" is a lookup, not a doubt), and the question never asks for a price, a cost figure or the money accounting - the money question belongs to the pricing cells.${keepLeave} Same concern, differently worded by a different person. Designed as: "${seed}"`
      : `Question design (doubt): the question voices the SAME concern about ${brand} as the designed question below - the same subject and worry, differently worded by a different person. A DIFFERENT concern about ${brand} does not satisfy the design, and neither does a value-math request without the stated worry, an eligibility or rules lookup (even when the rules are unfavorable), or an ask for a price, a cost figure or the money accounting.${keepLeave} Designed as: "${seed}"`;
  }
  // The circumstance/doubt boundary (DECIDED 2026-10-01): pricing is value
  // MATH, worries are VERDICTS - each design line polices its own side so
  // the two instruments cannot trade clothes.
  if (stage === "pricing")
    return `Question design (value math): the question asks for a price/value accounting - the same one as the designed question below, naming ${brand} only if the designed question does - WITH the asker's usage or situation as an input (financing, trade-in or price figures are prices, not usage), leaving the verdict to the answer. A bare "is it worth it?" carrying no usage inputs is a doubt, not a pricing ask, and does not satisfy the design; neither does presupposing the verdict ("a ripoff", "that huge fee"). Designed as: "${seed}"`;
  if (stage === "premium_worth")
    return `Question design (premium tier): the question weighs the category's premium maker(s) as a TIER against basic/store options and invites named picks - from either side (is the expensive one worth it, is the cheap one good enough). Judging one named brand's own worth does not satisfy the design. Designed as: "${seed}"`;
  if (!PLAN_CHECK_STAGES.has(stage))
    // Every other stage gets the generic same-question line (2026-09-29:
    // open/awareness/comparison cells drifted with no consistency check -
    // Netflix's discovery cell became "what should I look for" in 7 of 9).
    return `Question design: the question asks the SAME designed question below - same subject, same circumstance, same kind of ask - differently worded by a different person. A different subject, a different ask, or a features-only rewrite of a which-one question does not satisfy the design. Designed as: "${seed}"`;
  const intent =
    stage === "problem_resolution"
      ? `an existing ${brand} customer has a problem with ${brand} or its product and wants it fixed`
      : stage === "expansion"
        ? `the customer plans to use ${brand} for more`
        : stage === "ecosystem"
          ? `the customer plans to find products and services that work well with ${brand}`
          : `the customer plans to recommend or defend ${brand} to someone else`;
  return `Question design (plan): ${intent}, on the SAME subject as the designed question below - a different plan or subject does not satisfy the design. Designed as: "${seed}"`;
}

/** The design intent a doubt/plan STAGE demands, independent of any seed -
 * the yardstick for judging seeds themselves (seed-as-design cannot judge
 * the seed). */
export function stageDesignIntent(stage: string, brand: string, concern?: string | null, angle?: string | null, situation?: string | null): string | null {
  if (DOUBT_CHECK_STAGES.has(stage)) {
    // G1/G2 (2026-10-01 seed audit): churn/renewal demand the stay-or-leave
    // choice stated outright, and the money ban covers cost FIGURES, not
    // just methods - "what should we be paying, given <usage>" is pricing's
    // accounting question and slipped the method-only wording.
    const keepLeave = stage === "churn_triggers" || stage === "renewal"
      ? ` The asker weighs STAYING with ${brand} against LEAVING it, and the leave option is stated outright - a fix-it or tune-it ask with no option of leaving does not satisfy the design.`
      : "";
    const stance = stage === "objections"
      ? ` The asker is a PROSPECT weighing the purchase - an existing customer's keep-or-cancel doubt belongs to the churn/renewal cells, so "should I drop/cancel it" does not satisfy an objection's design.`
      : "";
    return `Question design (doubt): the question itself voices the buyer's concern, complaint or "is it still worth it" doubt about ${brand}, stated as the asker's own claim or feeling that an answer could confirm or rebut.${stance} A neutral lookup, spec request, how-to or value-math request on the same topic does not satisfy the design - the math ask belongs to the pricing cells - and an eligibility or rules lookup does not voice a doubt even when the rules are unfavorable to the asker ("am I likely to be ineligible?", "can I check before applying?" are lookups, not doubts). A doubt question never asks for a price, a cost figure or the money accounting, with or without usage details.${keepLeave}${concern ? ` The DESIGNED concern is: ${concern} - the question must voice that worry, not a different one, and when that concern is not itself about price, a bolted-on cheaper-options or price remark does not satisfy the design.` : ""}`;
  }
  if (stage === "pricing")
    // G6: generic pricing cells never name the brand, so the intent accepts
    // both forms rather than pushing every cell to within_brand. The generic
    // form reasons about the category's price STRUCTURE (s17: the first
    // examples were fee-shaped and the checker refused a legitimate
    // financing-vs-unlocked trade-off while "best value phone for my
    // budget" discovery asks slipped into pricing cells).
    return `Question design (value math): the question reasons about a price/value TRADE-OFF in ${brand}'s market, WITH the asker's usage or situation as an input, leaving the verdict to the answer - either naming ${brand} (its tiers, its fee or total-cost math, trade-in or financing on it) or generic to the category's price structure (paid vs free, fee vs no-fee, financing vs buying outright, paying up for a higher tier vs the base). Financing, trade-in or price figures are PRICES, not usage: the asker's own usage (what they do with it, how long they keep it, what they spend on what) must also be present. A "which product is the best value for my budget" ask is an open-choice question, not pricing, and does not satisfy the design; a bare "is it worth it?" with no usage inputs is a doubt; presupposing the verdict ("a ripoff") is neither.`;
  // Alternatives seeds (audit J10/J11, 2026-10-01): an offensive seed that
  // gives a REASON for leaving the rival ("too lightweight for our dev
  // team") steers every answer toward one kind of replacement - often the
  // client's own positioning - and inflates names-us-on-exit by
  // construction; a defensive seed voiced as a prospect ("if we don't go
  // with it") measures a different circumstance than the exit scan.
  if (stage === "alternatives") {
    if (angle === "defensive")
      return `Question design (exit scan): an existing ${brand} customer weighing a move away asks, naming ${brand}, what else is out there. A prospect who merely has not chosen ${brand} yet ("if we don't go with it") does not satisfy the design.`;
    if (angle && angle !== "generic")
      return `Question design (leaving a rival): the asker is moving away from ${angle} and asks what to consider instead, stating the move PLAINLY with no reason given. A reason that says what ${angle} lacks or who it fails ("too lightweight for a dev team") steers the answer toward one kind of replacement and does not satisfy the design, and so does the asker's team or segment identity ("for our dev team", "for a software engineering team") - the category word is the only anchor. Naming ${brand} does not satisfy it either.`;
    return null;
  }
  // Head-to-head seeds were never design-checked (comparison had no intent):
  // "where does each win?" strengths tours shipped without a pick ask, and
  // the head-to-head view scores a WINNER (2026-10-01 s22 audit, F3).
  if (stage === "comparison" && angle && angle !== "generic")
    return `Question design (head-to-head): the question weighs ${brand} against its designed counterpart and ASKS FOR THE PICK - "which would you go with", "which one", and why. A strengths tour ("where does each win", "pros and cons") that never asks which to pick does not satisfy the design.`;
  // Awareness seeds drifted into tier comparisons and reassurance asks
  // (2026-10-01 s24 audit F4): the asker does not know the solution space
  // yet, and this stage reports only how often brands get named unprompted.
  if (stage === "problem_recognition")
    return `Question design (awareness): the asker describes a pain and ends asking for a way out ("how do people handle this?", "what actually fixes this?"). The asker does NOT yet have this kind of product - someone already holding one and doubting it ("I'm paying a big fee for perks I barely use") is a worry about the product, not awareness, and does not satisfy the design. A premium-vs-cheap tier comparison, a which-brand ask, a specs/criteria ask, or a yes/no reassurance ask ("is this common?") does not satisfy the design.${situation ? ` The question also carries the asker's own circumstance matching: ${situation}.` : ""}`;
  if (stage === "category_education")
    return `Question design (awareness): the asker wants to understand what this kind of product actually does and how people use it - nothing is broken, so a "what fixes this" ask does not fit. A premium-vs-cheap tier comparison, a which-brand ask, a specs/criteria ask, or a yes/no reassurance ask does not satisfy the design.${situation ? ` The question also carries the asker's own circumstance matching: ${situation}.` : ""}`;
  // Open-choice seeds must invite NAMED picks (s24 audit F3: a
  // social_validation cell became a features-gush ask and named nothing).
  const pickClause = OPEN_PICK_STAGES.has(stage)
    ? ` The ask must invite NAMED products or brands ("which ones", "name a few worth a look") - a features-only, what-do-people-value or where-to-look ask does not satisfy the design.`
    : "";
  // A scenario-pinned cell's SEED must carry its circumstance (audit M1
  // recurrence, 2026-10-01: two Mid-market cells read as generic feature
  // asks). Any pinned stage without a more specific design above gets this
  // yardstick; invariant cells (situation null) are untouched.
  if (situation)
    return `Question design (circumstance): the question carries the asker's own circumstance matching this buying scenario: ${situation}. The circumstance must live in the question's own words (their size, moment or situation) - a question that would read the same with no circumstance at all does not satisfy the design. When the circumstance is a switch or move (platforms, ecosystems, providers), the DIRECTION must be stated ("from iOS to Android") - "switching platforms" or "from one platform to another" without the direction does not satisfy it, because which products get named then depends on the answer's guess - AND the stated direction must leave ${brand} an eligible answer: a switch toward a platform or ecosystem ${brand} does not run on excludes it by construction and does not satisfy the design. Judge by SUBSTANCE, not label restatement: the circumstance counts when the question's facts fit that scenario's buyer - it need not restate every attribute of the scenario name, and when the scenario name IS the plain buyer phrase for the circumstance ("first credit card", "replacing my everyday card") using those words is correct, not a leak. Only a scenario name in planning register must be re-voiced in the buyer's own words.${pickClause}`;
  if (pickClause)
    return `Question design (open choice): the buyer wants NAMES.${pickClause}`;
  if (stage === "premium_worth")
    return `Question design (premium tier): the question weighs the category's premium maker(s) as a TIER against basic/store options and invites named picks - from either side. Judging one named brand's own worth does not satisfy it - that is a worry cell's job.`;
  if (!PLAN_CHECK_STAGES.has(stage)) return null;
  const intent =
    stage === "problem_resolution"
      ? `an existing ${brand} customer has a problem with ${brand} or its product and wants it fixed`
      : stage === "expansion"
        ? `the customer plans to use ${brand} for more`
        : stage === "ecosystem"
          ? `the customer plans to find products and services that work well with ${brand}`
          : `the customer plans to recommend or defend ${brand} to someone else`;
  return `Question design (plan): ${intent}.`;
}

/** Pre-category stages: the buyer does not know the SOLUTION category
 * exists, so the category noun is legitimately absent (jira's buyer
 * describes workflow pain, not "project management software"). The
 * category-noun rule exempts them; the stage hint governs how the OWNED
 * object is named ("my phone", never "my pocket gadget"). */
export const PRE_CATEGORY_STAGES = new Set(["problem_recognition", "category_education"]);

/** Open-choice stages whose seeds must invite NAMED picks (premium_worth
 * carries its own tier intent). */
const OPEN_PICK_STAGES = new Set(["discovery", "shortlist", "feature_screening", "use_case", "social_validation"]);

export const BLIND_STAGES = new Set([
  "problem_recognition", "category_education", "discovery", "shortlist",
  "criteria", "feature_screening", "use_case", "social_validation", "premium_worth",
]);

/** Short brand forms that are ordinary English words - never matched blind
 * (the "one+" -> "one" and "Max" lessons; prod's detection is model-first
 * for the same reason). */
const STOP_FORMS = new Set(["one", "max", "mini", "pro", "plus", "air", "go", "fire", "prime", "mission", "video", "music", "cloud"]);

/** Brand tokens that are also technical nouns in specific collocations -
 * scrubbed before matching ("pixel size" is a sensor term, not the brand). */
export const TERM_COLLISIONS = /\b(pixel (?:size|sizes|binning|count|density)|keyboard shortcuts?)\b/g;

/** Numeric tokens that are vocabulary, not quantities - repeating them is
 * topic fidelity, not propagation (a 4K cell says 4K in every paraphrase;
 * "0%" is the product term for intro-APR cards, while the months and
 * amounts around it are true quantities and stay checked). */
const TECH_TOKENS = /\b(4k|5g|8k|1080p?|720p?|2160p?|24\/7|mp[34]|wi-?fi ?[67]|usb-?c)\b|\b0\s*%/gi;

const key = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function brandPatterns(name: string, opts?: { required?: boolean; extraForms?: string[]; excludeTokens?: Set<string> }): RegExp[] {
  return brandForms(name, opts).map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`));
}

/** The keyed surface forms brandPatterns matches (see there). */
function brandForms(name: string, opts?: { required?: boolean; extraForms?: string[]; excludeTokens?: Set<string> }): string[] {
  const out = new Set<string>();
  // A parenthetical in a brand name is a qualifier, not a name - "Azure
  // DevOps (Boards)" must never match "kanban boards". Exception: when the
  // base is itself a stopworded common word ("Max (HBO)"), the parenthetical
  // IS the effective name.
  const base = name.replace(/\s*\([^)]*\)/g, "").trim();
  const paren = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(" ");
  const useParen = STOP_FORMS.has(key(base)) && key(paren).length >= 3;
  name = useParen ? paren : base || name;
  const k = key(name);
  if (k && (opts?.required || !STOP_FORMS.has(k))) out.add(k);
  // Every distinctive token of a multi-word name identifies the brand in
  // context ("been on pixel", "my iphone friend") - the live battery names
  // brands by their product token more often than by the full name. Tokens
  // that appear in the study CATEGORY ("Ulta Beauty" in "beauty retailers")
  // are category vocabulary, never brand evidence.
  for (const tok of k.split(" ")) {
    if (tok.length > (useParen ? 2 : 3) && !STOP_FORMS.has(tok) && !opts?.excludeTokens?.has(tok)) out.add(tok);
  }
  for (const f of opts?.extraForms ?? []) {
    const fk = key(f);
    if (fk) out.add(fk);
  }
  return [...out];
}

/** Does the text speak the category's language? A word of the category
 * (>=4 chars) appears, including stem containment both ways - "phone"
 * anchors "smartphones", "retailer" anchors "beauty retailers". Blind
 * SEEDS must pass this: three rounds of instructions failed to stop the
 * writer contorting around the noun ("my pocket gadget"), so it is a
 * mechanical requirement now (2026-09-30). */
/** The category word the text actually uses ("chips" for "tortilla
 * chips", "phone" for "smartphones") - the owned noun a paraphrase set
 * must keep. Null when the text speaks no category word. */
export function categoryNounOf(text: string, category: string): string | null {
  const words = key(text).split(" ").filter((w) => w.length >= 4);
  for (const tok of key(category).split(" ")) {
    if (tok.length < 4) continue;
    for (const wd of words) if (tok === wd || tok.includes(wd) || wd.includes(tok)) return wd;
  }
  return null;
}

export function textNamesCategory(text: string, category: string): boolean {
  const words = key(text).split(" ").filter((w) => w.length >= 4);
  for (const tok of key(category).split(" ")) {
    if (tok.length < 4) continue;
    for (const wd of words) if (tok === wd || tok.includes(wd) || wd.includes(tok)) return true;
  }
  return false;
}

export function textNamesBrand(
  text: string, brand: string, opts?: { required?: boolean; extraForms?: string[]; excludeTokens?: Set<string> }
): boolean {
  const t = key(text).replace(TERM_COLLISIONS, " ");
  return brandPatterns(brand, opts).some((p) => p.test(t));
}

export interface BatteryCheckCell {
  stage: string;
  /** "generic", "defensive", or a rival's name. */
  angle: string;
  /** The seed prompt. */
  text: string;
  /** Paraphrase texts (seed excluded). */
  phrasings: string[];
  /** The cell's typed design, when it carries one (s7+). Absent = the
   * legacy string-derived checks. */
  spec?: CellCheckSpec | null;
  /** Scenario label, for the label-leak check. */
  situation?: string | null;
}

export interface BatteryFinding {
  cell: number;
  check: "must_name_missing_target" | "must_name_names_rival" | "blind_names_brand"
    | "comparison_missing_target" | "comparison_missing_rival" | "comparison_names_extra_rival"
    | "defensive_alt_missing_target" | "offensive_alt_names_target" | "offensive_alt_missing_rival"
    | "alternatives_names_extra_rival" | "pricing_names_rival" | "meta_text"
    | "scenario_label_leak" | "blind_missing_category" | "comparison_class_missing_class"
    // s11: a quantity in a comparison SEED (circumstance-neutrality's
    // mechanical slice - seed-only, raised by the engine's seedRule).
    | "comparison_seed_quantity"
    // r2 seed checks (audit G3/G4/G5, 2026-10-01 - seed-only, engine seedRule):
    // a calendar year goes stale on the next wave and breaks the trend; a
    // 60+ word seed is a requirements list however casual the words; segment
    // vocabulary is the plan's register, not a buyer's.
    | "seed_calendar_year" | "seed_overlong" | "segment_vocabulary" | "seed_switch_direction" | "concern_price_bolt_on" | "seed_multi_ask" | "class_category_tail"
    | "seed_number_changed" | "duplicate_paraphrase";
  /** The offending prompt text (or the seed, for cell-level findings). */
  text: string;
  detail: string;
}

/** Generator self-talk that leaked into a served prompt: correction
 * narration, references to the seed/paraphrase task, bracketed writer
 * notes. Real buyers never type these (2026-09-29 battery audit - "Sorry,
 * small correction:", "15-squad detail in seed can't be reused; instead:").
 * The writer prompts also forbid it; this is the net for when instruction-
 * following fails, like every leak class before it. */
const META_TEXT_PATTERNS: { p: RegExp; why: string }[] = [
  { p: /\bparaphrases?\b/i, why: "mentions 'paraphrase'" },
  { p: /\bseed(?:'s)? (?:number|text|wording|question|prompt|detail)\b/i, why: "references the seed" },
  { p: /\b(?:can't|cannot|can not|won't) be reused\b/i, why: "writer planning language" },
  { p: /;\s*instead:\s/i, why: "writer correction ('; instead:')" },
  { p: /^\s*(?:sorry|oops|apologies)\b/i, why: "opens with an apology/correction" },
  { p: /\bsmall correction\b/i, why: "correction narration" },
  { p: /\bcorrection:\s/i, why: "correction narration" },
  { p: /[\[\]]/, why: "bracketed writer note" },
  { p: /\basker\s*:/i, why: "asker metadata in the text" },
  { p: /^\s*(?:one|two|three|\d+)[- ]?sentence/i, why: "length-instruction opener" },
  // "Terse:"/"Brief:" are writer vocabulary; "Short:"/"Quick:" are NOT
  // banned - the ratified corpus carries 11 of them as genuine chat
  // shorthand (the fixture caught the over-reach, 2026-09-30).
  { p: /^\s*(?:terse|brief)\s*:/i, why: "length-instruction opener" },
  { p: /\b(?:spec|trust|feel)-driven\b/i, why: "planning vocabulary (journey tag)" },
];

export function metaTextViolation(text: string): string | null {
  for (const { p, why } of META_TEXT_PATTERNS) if (p.test(text)) return why;
  return null;
}

/** Every prompt-level brand-rule verdict for ONE text - shared by the
 * battery sweep and the manual-edit path, so an edit cannot break a rule
 * the sweep would catch. */
export function checkPromptBrandRule(input: {
  text: string; stage: string; angle: string; brand: string; competitors: string[];
  /** The study category - its words are excluded as brand evidence. */
  category?: string;
  /** Known alternate surface forms per brand (dictionary aliases), e.g.
   * {"American Express": ["amex"]}. */
  extraForms?: Record<string, string[]>;
  /** The cell's scenario label - a prompt containing it VERBATIM copied
   * the plan's label instead of voicing the circumstance ("Household
   * tune-up question: ..."). */
  situationLabel?: string | null;
}): { check: BatteryFinding["check"]; detail: string }[] {
  const { text, stage, angle, brand } = input;
  const out: { check: BatteryFinding["check"]; detail: string }[] = [];
  const meta = metaTextViolation(text);
  if (meta) out.push({ check: "meta_text", detail: `generator meta-text: ${meta}` });
  const label = (input.situationLabel ?? "").trim();
  if (label.length >= 8 && text.toLowerCase().includes(label.toLowerCase()))
    out.push({ check: "scenario_label_leak", detail: `copies the scenario label "${label}"` });
  const catTokens = new Set(key(input.category ?? "").split(" ").filter(Boolean));
  const target = textNamesBrand(text, brand, { extraForms: input.extraForms?.[brand], excludeTokens: catTokens });
  const rivalsNamed = input.competitors.filter((c) => textNamesBrand(text, c, { extraForms: input.extraForms?.[c], excludeTokens: catTokens }));
  // The cell's own angle brand is never an "extra" rival - match by name
  // containment in both directions so label variants ("Amazon (Beauty)")
  // resolve to their angle spelling.
  const isAngleBrand = (r: string) =>
    textNamesBrand(angle, r, { required: true }) || textNamesBrand(r, angle, { required: true });
  if (BLIND_STAGES.has(stage)) {
    if (target || rivalsNamed.length > 0)
      out.push({ check: "blind_names_brand", detail: `blind stage names ${target ? brand : rivalsNamed.join(", ")}` });
  } else if (MUST_NAME_STAGES.has(stage)) {
    if (!target) out.push({ check: "must_name_missing_target", detail: `${stage} must name ${brand}` });
    // Advocacy may name the rival being argued with; elsewhere a rival is a leak.
    if (rivalsNamed.length > 0 && stage !== "advocacy")
      out.push({ check: "must_name_names_rival", detail: `${stage} names ${rivalsNamed.join(", ")}` });
  } else if (stage === "comparison") {
    if (!target) out.push({ check: "comparison_missing_target", detail: `comparison must name ${brand}` });
    if (angle !== "generic" && angle !== "defensive") {
      if (!textNamesBrand(text, angle, { required: true }))
        out.push({ check: "comparison_missing_rival", detail: `comparison cell for ${angle}` });
      // A comparison cell measures EXACTLY its designed pair - a third
      // tracked brand in the prompt contaminates the head-to-head (the
      // jira-vs-Trello cell naming GitHub, 2026-09-29 audit).
      const extra = rivalsNamed.filter((r) => !isAngleBrand(r));
      if (extra.length > 0)
        out.push({ check: "comparison_names_extra_rival", detail: `comparison for ${angle} also names ${extra.join(", ")}` });
    }
  } else if (stage === "alternatives") {
    if (angle === "defensive") {
      if (!target) out.push({ check: "defensive_alt_missing_target", detail: `defensive alternatives must name ${brand}` });
      // The keep-or-leave ask is open by design - a named rival steers it.
      if (rivalsNamed.length > 0)
        out.push({ check: "alternatives_names_extra_rival", detail: `defensive alternatives names ${rivalsNamed.join(", ")}` });
    } else if (angle !== "generic") {
      if (target) out.push({ check: "offensive_alt_names_target", detail: `offensive alternatives must not name ${brand}` });
      if (!textNamesBrand(text, angle, { required: true }))
        out.push({ check: "offensive_alt_missing_rival", detail: `alternatives cell for ${angle}` });
      const extra = rivalsNamed.filter((r) => !isAngleBrand(r));
      if (extra.length > 0)
        out.push({ check: "alternatives_names_extra_rival", detail: `alternatives for ${angle} also names ${extra.join(", ")}` });
    }
  } else if (stage === "pricing") {
    // Pricing cells price the target's world (branded tiers or the generic
    // category) - a rival name turns them into unlogged comparisons.
    if (rivalsNamed.length > 0)
      out.push({ check: "pricing_names_rival", detail: `pricing names ${rivalsNamed.join(", ")}` });
  }
  return out;
}

/** Quantities in a text: numbers minus years, tech tokens, and numbers glued
 * to brand vocabulary (Pixel 9, iPhone 16). Formats are normalized before
 * extraction so "60k", "60,000" and "60000" are the SAME quantity - a
 * paraphrase preserving a seed number in a different format is fidelity,
 * not a change (the jira "60k issues" cell died on candidates' "60,000",
 * 2026-09-29). */
function quantities(text: string, brandVocab: RegExp[]): string[] {
  let t = ` ${text.toLowerCase()} `.replace(TECH_TOKENS, " ");
  for (const p of brandVocab) t = t.replace(new RegExp(`${p.source}\\s*\\d+[a-z]*`, "g"), " ");
  // Thousands separators out ("60,000" -> "60000"), then the k suffix
  // expanded ("60k" -> "60000"). "m" stays untouched - it is ambiguous
  // (millions, minutes, meters) and both sides of a real mismatch
  // normalize identically anyway.
  while (/\d,\d{3}(?!\d)/.test(t)) t = t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  t = t.replace(/(\d+(?:\.\d+)?)\s*k(?![a-z0-9])/g, (_, n) => String(Math.round(parseFloat(n) * 1000)));
  return [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]).filter((n) => !/^20\d\d$/.test(n));
}

/** A prompt leaking a scenario label: the full label verbatim, or a short
 * "Label-ish:" opener whose distinctive words come from a label ("Camera-
 * first buy:" from the camera-first scenario). Any label counts - the
 * jira leak carried a DIFFERENT cell's scenario label. */
export function scenarioLabelLeak(text: string, labels: (string | null | undefined)[], category?: string): string | null {
  const t = text.toLowerCase();
  for (const raw of labels) {
    const label = (raw ?? "").trim();
    // r3 (2026-10-01): a label that NAMES THE CATEGORY ("First credit card")
    // is plain buyer vocabulary the plan cannot reserve - the substring rule
    // was fighting the voiced-circumstance requirement head on ("this would
    // be my first credit card" is exactly what we demand). Plan-register
    // labels ("Party hosting cart", "Mid-market scale-up") stay caught, and
    // the colon-opener heuristic below still catches meta-headers.
    if (category && textNamesCategory(label, category)) continue;
    // Punctuation-blind containment (r6): "Carrier trade-in upgrade" leaks
    // the label "Carrier trade in upgrade" - hyphens and commas must not
    // hide a copy.
    if (label.length >= 8 && ` ${key(t)} `.includes(` ${key(label)} `)) return label;
  }
  const m = text.match(/^([A-Za-z][A-Za-z0-9 &/-]{3,40}):/);
  if (m) {
    const prefixWords = new Set(key(m[1]).split(" ").filter((w) => w.length >= 5));
    if (prefixWords.size > 0) {
      for (const raw of labels) {
        const lw = new Set(key(raw ?? "").split(" "));
        let hit = 0;
        for (const w of prefixWords) if (lw.has(w)) hit++;
        if (hit > 0 && hit >= Math.ceil(prefixWords.size / 2)) return (raw ?? "").trim();
      }
    }
  }
  return null;
}

export function checkBattery(input: {
  brand: string;
  competitors: string[];
  cells: BatteryCheckCell[];
  category?: string;
  extraForms?: Record<string, string[]>;
  /** Every scenario label in the battery - a prompt copying ANY of them
   * leaked plan vocabulary, not just its own cell's. */
  scenarioLabels?: string[];
}): BatteryFinding[] {
  const findings: BatteryFinding[] = [];
  const brandVocab = [input.brand, ...input.competitors].flatMap((b) => brandPatterns(b, { required: true }));
  input.cells.forEach((cell, i) => {
    const texts = [cell.text, ...cell.phrasings];
    const seen = new Set<string>();
    for (const t of texts) {
      const k = key(t);
      if (seen.has(k)) findings.push({ cell: i, check: "duplicate_paraphrase", text: t, detail: "exact duplicate" });
      seen.add(k);
      // Owned-noun continuity (2026-09-30, round 8): when a pre-category
      // blind SEED names the owned object with a category word ("my
      // phone"), every paraphrase keeps one - a paraphrase saying "my
      // device" re-opens the door a camera answer walks through.
      if (
        PRE_CATEGORY_STAGES.has(cell.stage) &&
        t !== cell.text &&
        input.category &&
        textNamesCategory(cell.text, input.category) &&
        !textNamesCategory(t, input.category)
      )
        findings.push({ cell: i, check: "blind_missing_category", text: t, detail: `paraphrase drops the owned category noun the seed uses` });
      // Path-independent: a prompt that copies a scenario LABEL - any
      // scenario's, full or as a "Label:" opener - shipped the plan's
      // vocabulary instead of voicing the circumstance.
      const leak = scenarioLabelLeak(t, [cell.situation, ...(input.scenarioLabels ?? [])], input.category);
      if (leak)
        findings.push({ cell: i, check: "scenario_label_leak", text: t, detail: `copies the scenario label "${leak}"` });
      // A cell carrying a typed spec is verified AGAINST it; a legacy cell
      // reverse-engineers its design from stage + angle + prose, as before.
      const verdicts = cell.spec
        ? checkPromptAgainstSpec({ text: t, spec: cell.spec, category: input.category, extraForms: input.extraForms })
        : checkPromptBrandRule({ text: t, stage: cell.stage, angle: cell.angle, brand: input.brand, competitors: input.competitors, category: input.category, extraForms: input.extraForms });
      for (const v of verdicts) findings.push({ cell: i, ...v, text: t });
    }
    // Seed numbers are FACTS of the designed question (Tyler, 2026-09-29):
    // a paraphrase keeps them verbatim or leaves them out, and never
    // carries a quantity the seed does not - substituting "0% for 24
    // months" with "about 18 months" or inventing spec texture changes
    // the question being measured. (This inverts the retired propagation
    // check, which treated repetition as the defect.) A spec carries the
    // seed's facts already extracted - including spelled-out ones.
    const seedNums = new Set(cell.spec ? cell.spec.quantities : quantities(cell.text, brandVocab));
    for (const t of cell.phrasings) {
      // Extra 1s and 2s are tolerated: seeds spell them ("under a second",
      // "family of four" restated as "2 kids") and candidates digitize -
      // the mutation class this check exists for (months, percents,
      // dollar thresholds) lives at 3 and up. The jira founder cell died
      // on candidates writing "under 1 second" for the seed's "under a
      // second" (2026-09-29).
      const extras = [...new Set(quantities(t, brandVocab))].filter((n) => !seedNums.has(n) && parseFloat(n) > 2);
      if (extras.length > 0)
        findings.push({
          cell: i, check: "seed_number_changed", text: t,
          detail: `carries quantit${extras.length > 1 ? "ies" : "y"} [${extras.join(", ")}] not in the seed${seedNums.size > 0 ? ` [${[...seedNums].join(", ")}]` : ""}`,
        });
    }
  });
  return findings;
}

/* ------------------------- typed check-spec (s7) --------------------------
 * The string era reverse-engineered every cell's design from its seed's
 * prose, twice per check - and each surface form it misread was a bug
 * (lowercase "visa" not registering the designed rival, "60k" vs "60,000",
 * "under a second" vs "under 1 second", "Apple iPhone" typed "iPhone").
 * The fix that kept working was to derive expectations from the cell
 * DESIGN, not the seed's spelling. The spec makes that the architecture:
 * each cell carries its design as data, derived ONCE (mechanically, no
 * model calls) after its seed's last heal, and every check verifies
 * candidates AGAINST it:
 * - REQUIRED brands are guaranteed by the design, so their detection is
 *   case-blind and format-tolerant (any distinctive token, sub-phrase,
 *   compact form or parenthetical alias) - context disambiguates;
 * - FORBIDDEN brands keep precision-first detection (STOP_FORMS, the
 *   ambiguous-word case guard, TERM_COLLISIONS, category tokens) - a false
 *   positive there kills honest candidates;
 * - quantities are the seed's FACTS, normalized once.
 * Legacy cells (no spec) keep the string-derived path unchanged. */

/** How a cell's brand design is scored. */
export type BrandMode =
  | "blind" | "must_name" | "comparison"
  // A head-to-head against a CLASS of products ("a Visa card") rather
  // than a rival entity (2026-10-01). Its qtype stays head_to_head; THIS
  // mode is the dashboard split key - class cells get their own view row,
  // never pooled with entity head-to-heads or open_choice.
  | "comparison_class"
  | "alternatives_defensive" | "alternatives_offensive"
  | "pricing" | "open";

export interface CellCheckSpec {
  /** Spec schema version. */
  v: 1;
  stage: string;
  angle: string;
  /** The client brand, as configured. */
  target: string;
  /** The roster entry the cell's angle designates (comparison / offensive
   * alternatives), or null. */
  angleBrand: string | null;
  /** The seed text this spec was derived from - a record, and the
   * freshness key (a spec whose seed differs from the cell's text is
   * re-derived, never trusted). */
  seed: string;
  brandMode: BrandMode;
  /** Brands every prompt of the cell must name. */
  requiredBrands: string[];
  /** Tracked brands no prompt of the cell may name. required and
   * forbidden partition [target, ...competitors]. */
  forbiddenBrands: string[];
  /** The seed's quantities (> 2, normalized: "60k" = "60,000" = "60000";
   * spelled-out seed numbers included) - facts a paraphrase keeps or
   * omits, never changes. */
  quantities: string[];
  /** The PLANNED concern a doubt cell measures (2026-09-30): assigned at
   * grid-plan time from the brand's enumerated doubt-space, so diversity
   * holds by construction. Absent on non-doubt cells and legacy cells. */
  concern?: string | null;
  /** The design sentence doubt/plan paraphrases must voice (same-concern
   * form, quoting the seed), or null for stages without one. */
  designLine: string | null;
  qtype: QuestionType;
  /** comparison_class only: how a buyer speaks the class ("a Visa card"). */
  classPhrase?: string;
  /** comparison_class only: the upstream brand the class evokes ("Visa") -
   * every prompt must name it (case-blind, tolerant), and it is never a
   * forbidden-brand leak. Absent on every other mode (keys omitted, so
   * non-class specs serialize byte-identically). */
  classBrand?: string;
}

/** Brand forms that double as ordinary English words: in FORBIDDEN
 * detection these count only when capitalized ("2-3 services max" is not
 * Max, "do I need a visa" is not Visa). Shared with the legacy signature
 * filter in instrument.ts. */
export const AMBIGUOUS_FORMS = new Set([
  "max", "visa", "citi", "prime", "go", "one", "mini", "pro", "plus",
  "air", "fire", "mission", "video", "music", "cloud", "monday",
]);

/** Tokens that never identify a brand on their own ("monday.com" is not
 * named by ".com"). */
const GENERIC_TOKENS = new Set(["com", "net", "org", "inc", "llc", "ltd", "the", "and", "app", "co"]);

/** "Amazon (beauty)" -> "Amazon": the parenthetical is a display
 * disambiguator (mirrors instrument.primaryBrandName). */
function speakable(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Required-brand detection: case-blind and format-tolerant. The cell
 * design guarantees the brand's presence, so any of its identifying forms
 * counts - full name, any distinctive token ("iPhone" for "Apple iPhone",
 * "Monday" for "monday.com"), any contiguous sub-phrase ("Prime Video"),
 * the compact form ("oneplus" / "one plus"), the parenthetical alias
 * ("HBO"), dictionary aliases. Category words never count. */
export function namesRequiredBrand(
  text: string, name: string, opts?: { extraForms?: string[]; excludeTokens?: Set<string> }
): boolean {
  const t = key(text).replace(TERM_COLLISIONS, " ");
  const forms = new Set<string>();
  const base = key(name.replace(/\s*\([^)]*\)/g, ""));
  const paren = key([...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(" "));
  for (const f of [base, paren]) {
    if (!f) continue;
    forms.add(f);
    const toks = f.split(" ");
    if (toks.length > 1) forms.add(toks.join(""));
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (tok.length >= 3 && !STOP_FORMS.has(tok) && !GENERIC_TOKENS.has(tok) && !opts?.excludeTokens?.has(tok)) forms.add(tok);
      for (let j = i + 2; j <= toks.length; j++) forms.add(toks.slice(i, j).join(" "));
    }
  }
  for (const f of opts?.extraForms ?? []) {
    const fk = key(f);
    if (fk) forms.add(fk);
  }
  return [...forms].some((f) => new RegExp(`\\b${esc(f)}s?\\b`).test(t));
}

/** Forbidden-brand detection: precision-first. The same patterns as
 * textNamesBrand (STOP_FORMS, TERM_COLLISIONS, category tokens excluded),
 * with the ambiguous-word case guard: an ambiguous form counts only when
 * capitalized - and a brand whose whole name is an ambiguous stopword
 * ("Max") counts when capitalized, as the legacy signature did. */
export function namesForbiddenBrand(
  text: string, name: string, opts?: { extraForms?: string[]; excludeTokens?: Set<string> }
): boolean {
  const raw = text.replace(new RegExp(TERM_COLLISIONS.source, "gi"), " ");
  const t = key(raw);
  const capitalized = (form: string) => {
    const cap = form[0].toUpperCase() + form.slice(1);
    return new RegExp(`(?:^|[^A-Za-z0-9])(?:${esc(cap)}|${esc(form.toUpperCase())})(?:s|'s)?(?![A-Za-z0-9])`).test(raw);
  };
  for (const form of brandForms(name, opts)) {
    if (AMBIGUOUS_FORMS.has(form) ? capitalized(form) : new RegExp(`\\b${esc(form)}s?\\b`).test(t)) return true;
  }
  const primary = key(speakable(name));
  return STOP_FORMS.has(primary) && AMBIGUOUS_FORMS.has(primary) && capitalized(primary);
}

/** The scoring mode a stage x angle designs - the same branches
 * checkPromptBrandRule walks, named once. */
export function brandModeOf(stage: string, angle: string): BrandMode {
  if (BLIND_STAGES.has(stage)) return "blind";
  if (MUST_NAME_STAGES.has(stage)) return "must_name";
  if (stage === "comparison") return "comparison";
  if (stage === "alternatives") {
    if (angle === "defensive") return "alternatives_defensive";
    return angle === "generic" ? "open" : "alternatives_offensive";
  }
  if (stage === "pricing") return "pricing";
  return "open";
}

/** Spelled-out numbers a seed may carry ("family of four", "a dozen"). */
const SPELLED: Record<string, number> = {
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, dozen: 12,
};

/** The seed's quantity facts: the normalizing extractor's digits plus any
 * spelled-out numbers, > 2 only (1s and 2s are tolerated everywhere).
 * Spelled forms are read on the SEED side only - they can only widen what
 * a paraphrase may say ("four" -> "4"), never add a flag. */
export function seedQuantities(seed: string, brand: string, competitors: string[]): string[] {
  const vocab = [brand, ...competitors].flatMap((b) => brandPatterns(b, { required: true }));
  const out = new Set(quantities(seed, vocab).filter((n) => parseFloat(n) > 2));
  for (const w of key(seed).split(" ")) if (SPELLED[w]) out.add(String(SPELLED[w]));
  return [...out];
}

/** The roster entry an angle designates: exact speakable match first,
 * then name containment either way ("Amazon (Beauty)" vs "Amazon"). */
function angleEntry(angle: string, roster: string[]): string | null {
  if (["generic", "defensive", "open", ""].includes(angle.trim().toLowerCase())) return null;
  const exact = roster.find((b) => speakable(b).toLowerCase() === speakable(angle).toLowerCase());
  if (exact) return exact;
  const loose = roster.find(
    (r) => textNamesBrand(angle, r, { required: true }) || textNamesBrand(r, angle, { required: true })
  );
  return loose ?? speakable(angle);
}

/**
 * The cell's typed check-spec - pure and mechanical, no model calls. Run
 * once after a seed's last heal (generateGrid), on every alternate draw
 * (regenerateCell), and on a confirmed seed edit (cell_review). Brand sets
 * come from stage + angle (the design); only the "open" mode and
 * advocacy's argued rival read the seed, once, here.
 */
export function deriveCheckSpec(
  cell: {
    stage: string; angle: string; text: string; concern?: string | null;
    /** Class-angle comparison cells (2026-10-01) - both present = the
     * comparison_class design; absent = every other path, unchanged. */
    classPhrase?: string | null; classBrand?: string | null;
  },
  brand: string,
  competitors: string[],
  category?: string
): CellCheckSpec {
  const seed = cell.text.trim();
  const cls = classOfCell(cell);
  if (cls) return deriveClassSpec(cell, seed, cls, brand, competitors, category);
  const brandMode = brandModeOf(cell.stage, cell.angle);
  const catTokens = new Set(key(category ?? "").split(" ").filter(Boolean));
  const roster = [brand, ...competitors.filter((c) => c !== brand)];
  const rivals = roster.slice(1);
  const ang = brandMode === "comparison" || brandMode === "alternatives_offensive" ? angleEntry(cell.angle, rivals) : null;
  const isAngle = (r: string) => ang !== null && (r === ang || speakable(r).toLowerCase() === speakable(ang).toLowerCase());
  const seedNames = (b: string) => textNamesBrand(seed, b, { excludeTokens: catTokens });
  const qtype = questionTypeOf({ stage: cell.stage, angle: cell.angle, text: seed }, brand, category);
  let required: string[];
  switch (brandMode) {
    case "blind": required = []; break;
    // Advocacy may argue with a rival - the one its seed names is part of
    // the designed question.
    case "must_name": required = [brand, ...(cell.stage === "advocacy" ? rivals.filter(seedNames) : [])]; break;
    case "comparison": required = [brand, ...(ang ? [ang] : [])]; break;
    case "alternatives_defensive": required = [brand]; break;
    case "alternatives_offensive": required = ang ? [ang] : []; break;
    case "pricing": required = qtype === "within_brand" ? [brand] : []; break;
    default: required = roster.filter(seedNames);
  }
  // The angle may be a label not on the roster; everything tracked that
  // is not required is forbidden.
  const forbidden = roster.filter((b) => !required.includes(b) && !isAngle(b));
  return {
    v: 1,
    stage: cell.stage,
    angle: cell.angle,
    target: brand,
    angleBrand: ang,
    seed,
    brandMode,
    requiredBrands: required,
    forbiddenBrands: forbidden,
    quantities: seedQuantities(seed, brand, competitors),
    concern: cell.concern ?? null,
    designLine: seedDesignLine(cell.stage, brand, seed, cell.concern),
    qtype,
  };
}

/** A cell's class angle, when it is a class-angle comparison cell. */
export function classOfCell(cell: {
  stage: string; classPhrase?: string | null; classBrand?: string | null;
}): ClassAngle | null {
  const classPhrase = (cell.classPhrase ?? "").trim();
  const classBrand = (cell.classBrand ?? "").trim();
  return cell.stage === "comparison" && classPhrase && classBrand ? { classBrand, classPhrase } : null;
}

/** Same brand under label variants ("Visa" / "visa" / "Visa (network)"). */
function sameBrandLabel(a: string, b: string): boolean {
  return speakable(a).toLowerCase() === speakable(b).toLowerCase() ||
    textNamesBrand(a, b, { required: true }) || textNamesBrand(b, a, { required: true });
}

/** The comparison_class spec: the target is required; the class's own
 * upstream brand is required separately (case-blind - the class must be
 * evoked: "a Visa card" names Visa) and is never forbidden; every OTHER
 * tracked brand is forbidden strictly - a Visa-class paraphrase naming
 * Chase is an entity comparison, not the designed class contest. (Other
 * upstream brands are outside the same-seat roster and stay free
 * vocabulary, as everywhere; the same-question design check enforces
 * the class framing per paraphrase.) */
function deriveClassSpec(
  cell: { stage: string; angle: string; concern?: string | null },
  seed: string, cls: ClassAngle,
  brand: string, competitors: string[], category?: string
): CellCheckSpec {
  const roster = [brand, ...competitors.filter((c) => c !== brand)];
  return {
    v: 1,
    stage: cell.stage,
    angle: cell.angle,
    target: brand,
    angleBrand: null,
    seed,
    brandMode: "comparison_class",
    requiredBrands: [brand],
    forbiddenBrands: roster.filter((b) => b !== brand && !sameBrandLabel(b, cls.classBrand)),
    quantities: seedQuantities(seed, brand, competitors),
    concern: cell.concern ?? null,
    designLine: seedDesignLine(cell.stage, brand, seed, cell.concern, cls),
    // head_to_head like any comparison - brandMode is the split key.
    qtype: questionTypeOf({ stage: cell.stage, angle: cell.angle, text: seed }, brand, category),
    classPhrase: cls.classPhrase,
    classBrand: cls.classBrand,
  };
}

/** A carried spec is a record; the design is re-derivable from the cell
 * and roster, so the server re-derives and prefers the derivation - a spec
 * written before a seed edit, a roster change or a derivation fix never
 * governs a check. Null when the cell carries no spec (legacy path). */
export function resolveCellSpec(
  cell: {
    stage: string; angle: string; text: string; spec?: unknown; concern?: string | null;
    classPhrase?: string | null; classBrand?: string | null;
  },
  brand: string, competitors: string[], category?: string
): CellCheckSpec | null {
  // A class-angle cell is spec-era by construction: it has no legacy
  // string-derived design to fall back to (the string path would read
  // angle "class" as a rival named "class").
  if (classOfCell(cell)) return deriveCheckSpec(cell, brand, competitors, category);
  if (!cell.spec || typeof cell.spec !== "object") return null;
  const derived = deriveCheckSpec(cell, brand, competitors, category);
  // A seed edit re-deriving is routine; the same seed yielding a different
  // design (roster change, derivation fix, tampered copy) is worth a line.
  const carried = cell.spec as Partial<CellCheckSpec>;
  if (carried.seed === derived.seed && JSON.stringify(carried) !== JSON.stringify(derived))
    console.warn(`check-spec stale for [${cell.stage}/${cell.angle}] - re-derived | ${cell.text.slice(0, 70)}`);
  return derived;
}

/** Does a candidate carry exactly the cell's brand design? The signature
 * filter's spec form: every required brand named (tolerant), no forbidden
 * brand named (strict). */
export function checkCandidateSignature(
  text: string, spec: CellCheckSpec, opts?: { category?: string; extraForms?: Record<string, string[]> }
): { ok: boolean; missing: string[]; leaked: string[] } {
  const excludeTokens = new Set(key(opts?.category ?? "").split(" ").filter(Boolean));
  const missing = spec.requiredBrands.filter(
    (b) => !namesRequiredBrand(text, b, { extraForms: opts?.extraForms?.[b], excludeTokens })
  );
  const leaked = spec.forbiddenBrands.filter(
    (b) => namesForbiddenBrand(text, b, { extraForms: opts?.extraForms?.[b], excludeTokens })
  );
  // A class cell's expected signature is {target + classBrand}: the class
  // must actually be evoked, detected case-blind and format-tolerant like
  // any design-named brand ("visa card" counts).
  if (spec.brandMode === "comparison_class" && spec.classBrand &&
      !namesRequiredBrand(text, spec.classBrand, { extraForms: opts?.extraForms?.[spec.classBrand], excludeTokens }))
    missing.push(spec.classBrand);
  return { ok: missing.length === 0 && leaked.length === 0, missing, leaked };
}

/** checkPromptBrandRule's spec form: the same finding codes, verified
 * against the cell's typed design instead of re-inferred from stage,
 * angle and prose. */
export function checkPromptAgainstSpec(input: {
  text: string; spec: CellCheckSpec; category?: string; extraForms?: Record<string, string[]>;
}): { check: BatteryFinding["check"]; detail: string }[] {
  const { text, spec } = input;
  const out: { check: BatteryFinding["check"]; detail: string }[] = [];
  const meta = metaTextViolation(text);
  if (meta) out.push({ check: "meta_text", detail: `generator meta-text: ${meta}` });
  const { missing, leaked } = checkCandidateSignature(text, spec, input);
  const misses = (b: string | null) => b !== null && missing.includes(b);
  const rivalLeaks = leaked.filter((b) => b !== spec.target);
  const { target, angleBrand: ang, stage } = spec;
  switch (spec.brandMode) {
    case "blind":
      if (leaked.length > 0)
        out.push({ check: "blind_names_brand", detail: `blind stage names ${leaked.includes(target) ? target : leaked.join(", ")}` });
      break;
    case "must_name":
      if (misses(target)) out.push({ check: "must_name_missing_target", detail: `${stage} must name ${target}` });
      if (rivalLeaks.length > 0) out.push({ check: "must_name_names_rival", detail: `${stage} names ${rivalLeaks.join(", ")}` });
      break;
    case "comparison":
      if (misses(target)) out.push({ check: "comparison_missing_target", detail: `comparison must name ${target}` });
      if (ang) {
        if (misses(ang)) out.push({ check: "comparison_missing_rival", detail: `comparison cell for ${spec.angle}` });
        if (rivalLeaks.length > 0)
          out.push({ check: "comparison_names_extra_rival", detail: `comparison for ${spec.angle} also names ${rivalLeaks.join(", ")}` });
      }
      break;
    case "comparison_class":
      if (misses(target)) out.push({ check: "comparison_missing_target", detail: `class comparison must name ${target}` });
      if (spec.classBrand && misses(spec.classBrand))
        out.push({ check: "comparison_class_missing_class", detail: `class comparison must evoke ${spec.classPhrase ?? spec.classBrand} (name ${spec.classBrand})` });
      if (rivalLeaks.length > 0)
        out.push({ check: "comparison_names_extra_rival", detail: `class comparison vs ${spec.classPhrase ?? spec.classBrand} names ${rivalLeaks.join(", ")} - the counterpart is the class, never a named rival` });
      break;
    case "alternatives_defensive":
      if (misses(target)) out.push({ check: "defensive_alt_missing_target", detail: `defensive alternatives must name ${target}` });
      if (rivalLeaks.length > 0)
        out.push({ check: "alternatives_names_extra_rival", detail: `defensive alternatives names ${rivalLeaks.join(", ")}` });
      break;
    case "alternatives_offensive":
      if (leaked.includes(target)) out.push({ check: "offensive_alt_names_target", detail: `offensive alternatives must not name ${target}` });
      if (misses(ang)) out.push({ check: "offensive_alt_missing_rival", detail: `alternatives cell for ${spec.angle}` });
      if (rivalLeaks.length > 0)
        out.push({ check: "alternatives_names_extra_rival", detail: `alternatives for ${spec.angle} also names ${rivalLeaks.join(", ")}` });
      break;
    case "pricing":
      if (rivalLeaks.length > 0) out.push({ check: "pricing_names_rival", detail: `pricing names ${rivalLeaks.join(", ")}` });
      break;
  }
  return out;
}

/** The paraphrase writer's per-seed brand note, rendered FROM the spec:
 * a blind design says so; a required brand the seed's own wording lacks
 * (a legacy blind seed in a must-name stage, a lowercase or shorthand
 * rival) is named explicitly. Null when the seed already carries its
 * design - the common case adds nothing to the prompt. */
export function specWriterNote(spec: CellCheckSpec): string | null {
  // The class contract always rides with its seed: the paraphrase rule
  // "same brands named" alone would let a writer trade the class for a
  // specific card or issuer.
  if (spec.brandMode === "comparison_class" && spec.classPhrase)
    return `[head-to-head vs a CLASS: every paraphrase weighs ${speakable(spec.target)} against ${spec.classPhrase} as a class of products - speak the class the way a buyer does (any natural wording that names ${speakable(spec.classBrand ?? spec.classPhrase)}), never a specific rival company or product in its place]`;
  if (spec.requiredBrands.length === 0)
    return `[deliberately blind variant: name NO brand - the guidance's subject stays implied ("my subscription", "the service"), never named]`;
  const missing = spec.requiredBrands.filter((b) => !namesRequiredBrand(spec.seed, b));
  if (missing.length === 0) return null;
  if (spec.brandMode === "must_name" && missing.length === 1 && missing[0] === spec.target)
    return `[this stage must name ${spec.target}: every paraphrase names ${spec.target} (the seed's blind wording is a legacy defect - do not preserve it), never a rival]`;
  const names = missing.map(speakable).join(" and ");
  return `[this cell's design names ${names}: every paraphrase names ${names}]`;
}
