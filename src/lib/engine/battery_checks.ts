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
export function seedDesignLine(stage: string, brand: string, seed: string): string | null {
  // "SAME concern/plan as the designed question" (2026-09-29): the earlier
  // wording only demanded A doubt about the brand, so a gifting objection
  // could drift into nine limited-drops objections and pass - each still
  // voiced a doubt about the brand, just not the designed one.
  if (DOUBT_CHECK_STAGES.has(stage))
    return `Question design (doubt): the question voices the SAME concern about ${brand} as the designed question below - the same subject and worry, differently worded by a different person. A DIFFERENT concern about ${brand} does not satisfy the design. Designed as: "${seed}"`;
  if (!PLAN_CHECK_STAGES.has(stage)) return null;
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
export function stageDesignIntent(stage: string, brand: string): string | null {
  if (DOUBT_CHECK_STAGES.has(stage))
    return `Question design (doubt): the question itself voices the buyer's concern, complaint or "is it still worth it" doubt about ${brand}. A neutral lookup, spec request or how-to on the same topic does not satisfy the design.`;
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
  return [...out].map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`));
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
}

export interface BatteryFinding {
  cell: number;
  check: "must_name_missing_target" | "must_name_names_rival" | "blind_names_brand"
    | "comparison_missing_target" | "comparison_missing_rival" | "comparison_names_extra_rival"
    | "defensive_alt_missing_target" | "offensive_alt_names_target" | "offensive_alt_missing_rival"
    | "alternatives_names_extra_rival" | "pricing_names_rival" | "meta_text"
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
}): { check: BatteryFinding["check"]; detail: string }[] {
  const { text, stage, angle, brand } = input;
  const out: { check: BatteryFinding["check"]; detail: string }[] = [];
  const meta = metaTextViolation(text);
  if (meta) out.push({ check: "meta_text", detail: `generator meta-text: ${meta}` });
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
 * to brand vocabulary (Pixel 9, iPhone 16). */
function quantities(text: string, brandVocab: RegExp[]): string[] {
  let t = ` ${text.toLowerCase()} `.replace(TECH_TOKENS, " ");
  for (const p of brandVocab) t = t.replace(new RegExp(`${p.source}\\s*\\d+[a-z]*`, "g"), " ");
  return [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]).filter((n) => !/^20\d\d$/.test(n));
}

export function checkBattery(input: {
  brand: string;
  competitors: string[];
  cells: BatteryCheckCell[];
  category?: string;
  extraForms?: Record<string, string[]>;
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
      for (const v of checkPromptBrandRule({ text: t, stage: cell.stage, angle: cell.angle, brand: input.brand, competitors: input.competitors, category: input.category, extraForms: input.extraForms }))
        findings.push({ cell: i, ...v, text: t });
    }
    // Seed numbers are FACTS of the designed question (Tyler, 2026-09-29):
    // a paraphrase keeps them verbatim or leaves them out, and never
    // carries a quantity the seed does not - substituting "0% for 24
    // months" with "about 18 months" or inventing spec texture changes
    // the question being measured. (This inverts the retired propagation
    // check, which treated repetition as the defect.)
    const seedNums = new Set(quantities(cell.text, brandVocab));
    for (const t of cell.phrasings) {
      const extras = [...new Set(quantities(t, brandVocab))].filter((n) => !seedNums.has(n));
      if (extras.length > 0)
        findings.push({
          cell: i, check: "seed_number_changed", text: t,
          detail: `carries quantit${extras.length > 1 ? "ies" : "y"} [${extras.join(", ")}] not in the seed${seedNums.size > 0 ? ` [${[...seedNums].join(", ")}]` : ""}`,
        });
    }
  });
  return findings;
}
