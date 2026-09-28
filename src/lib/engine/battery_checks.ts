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
import { MUST_NAME_STAGES } from "./instrument";

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
const TERM_COLLISIONS = /\b(pixel (?:size|sizes|binning|count|density)|keyboard shortcuts?)\b/g;

/** Numeric tokens that are vocabulary, not quantities - repeating them is
 * topic fidelity, not propagation (a 4K cell says 4K in every paraphrase). */
const TECH_TOKENS = /\b(4k|5g|8k|1080p?|720p?|2160p?|24\/7|mp[34]|wi-?fi ?[67]|usb-?c)\b/gi;

const key = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function brandPatterns(name: string, opts?: { required?: boolean; extraForms?: string[]; excludeTokens?: Set<string> }): RegExp[] {
  const out = new Set<string>();
  const k = key(name);
  if (k && (opts?.required || !STOP_FORMS.has(k))) out.add(k);
  // Every distinctive token of a multi-word name identifies the brand in
  // context ("been on pixel", "my iphone friend") - the live battery names
  // brands by their product token more often than by the full name. Tokens
  // that appear in the study CATEGORY ("Ulta Beauty" in "beauty retailers")
  // are category vocabulary, never brand evidence.
  for (const tok of k.split(" ")) {
    if (tok.length > 3 && !STOP_FORMS.has(tok) && !opts?.excludeTokens?.has(tok)) out.add(tok);
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
    | "comparison_missing_target" | "comparison_missing_rival"
    | "defensive_alt_missing_target" | "offensive_alt_names_target" | "offensive_alt_missing_rival"
    | "seed_number_propagation" | "duplicate_paraphrase";
  /** The offending prompt text (or the seed, for cell-level findings). */
  text: string;
  detail: string;
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
  const catTokens = new Set(key(input.category ?? "").split(" ").filter(Boolean));
  const target = textNamesBrand(text, brand, { extraForms: input.extraForms?.[brand], excludeTokens: catTokens });
  const rivalsNamed = input.competitors.filter((c) => textNamesBrand(text, c, { extraForms: input.extraForms?.[c], excludeTokens: catTokens }));
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
    if (angle !== "generic" && angle !== "defensive" && !textNamesBrand(text, angle, { required: true }))
      out.push({ check: "comparison_missing_rival", detail: `comparison cell for ${angle}` });
  } else if (stage === "alternatives") {
    if (angle === "defensive") {
      if (!target) out.push({ check: "defensive_alt_missing_target", detail: `defensive alternatives must name ${brand}` });
    } else if (angle !== "generic") {
      if (target) out.push({ check: "offensive_alt_names_target", detail: `offensive alternatives must not name ${brand}` });
      if (!textNamesBrand(text, angle, { required: true }))
        out.push({ check: "offensive_alt_missing_rival", detail: `alternatives cell for ${angle}` });
    }
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
  /** A cell flags propagation when more than this share of paraphrases
   * repeat a seed quantity (default 0.5). */
  propagationThreshold?: number;
  category?: string;
  extraForms?: Record<string, string[]>;
}): BatteryFinding[] {
  const findings: BatteryFinding[] = [];
  const thr = input.propagationThreshold ?? 0.5;
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
    const seedNums = [...new Set(quantities(cell.text, brandVocab))];
    if (seedNums.length > 0 && cell.phrasings.length > 0) {
      const rep = cell.phrasings.filter((t) => {
        const nums = new Set(quantities(t, brandVocab));
        return seedNums.some((n) => nums.has(n));
      }).length;
      if (rep / cell.phrasings.length > thr)
        findings.push({
          cell: i, check: "seed_number_propagation", text: cell.text,
          detail: `seed quantities [${seedNums.join(", ")}] repeated in ${rep}/${cell.phrasings.length} paraphrases`,
        });
    }
  });
  return findings;
}
