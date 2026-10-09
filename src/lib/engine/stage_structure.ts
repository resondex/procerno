/**
 * Stage structure (2026-10-08, Tyler): the shape each stage's question
 * must have, as a closed list of numbered yes/no properties per stage.
 *
 * Why: the paraphrase design check ("does this ask the SAME designed
 * question") ran at 0 kills in 1,824 paraphrases while the audits kept
 * finding comparison cells that asked for reasons either way, offensive
 * alternatives that made the move conditional, Value cells that asked
 * whether the line was "worth considering", criteria cells that dropped
 * the first ask. Three reframings of the same-question line (parts
 * contract, answer-could-change, bare paraphrase-or-not) each flagged a
 * different set with little overlap. Those defects are STRUCTURE
 * violations - one forced pick, a decided move, a verdict, two linked
 * asks - and the checker had never been given the structure. This table
 * is STAGE_CONTRACT.md's must / never / keep columns rewritten as
 * properties (STAGE_STRUCTURE_DRAFT_2026-10-08.md in the eval folder is
 * the reviewed draft).
 *
 * Readers today: the paraphrase checker (checkStructure, one call per
 * cell). Readers to migrate next time the structure is revisited (noted
 * in AGENTS.md): the seed design intents (stageDesignIntent - the seed
 * check, heals, alternates and cell_review), the spec's stored design
 * line (seedDesignLine), the writer's keep note (STAGE_KEEP) and the
 * stage hints - each holds the same contract in its own prose and they
 * drift.
 *
 * A property is about the SHAPE of the question - what it forces the
 * answer to be - never its words. No category- or brand-specific
 * examples anywhere in this text (standing rule); names are filled from
 * the cell.
 */
import { anthropicClient } from "./providers";
import { withCostContext } from "../cost_log";
import { store } from "../store";
import { createHash } from "crypto";
import type { CacheMeta } from "../types";
import type { ValueLine } from "./battery_checks";

/** Bump when a property's meaning changes (cache-era rule: the table is
 * checker text the request cannot see). */
/** ss2 (2026-10-08): wording calibrated on the first 206-cell run (ss1:
 * 169 flags, ~70 earned) - a plain I/we states the asker; possession or
 * use states the customer; one side of keep-or-leave stated still leaves
 * the other open; renewing mentioned is the bill due; "which first" still
 * forces options; a pick asked as a recommendation or better pick is a
 * pick; "its price" states no price; a second ask that treats the first
 * as already answered is one-half criteria; borderline passes. */
/** ss3 (2026-10-08): the second run (ss2: 149 flags, ~70 earned) read
 * "a plain I or we is enough" as "I or we required" and flagged every
 * paraphrase that carried the asker implicitly ("for a game-night crowd",
 * "our teen's first phone"); the current-customer properties did the same.
 * A checker cannot tell implicit from absent, so presence properties are
 * now CONTRADICTION properties: the paraphrase may compress or imply who
 * is asking, it may not change or add to it. The shape asks (one pick, a
 * verdict, a decided move, two linked asks) stay as they were. */
/** ss4 (2026-10-09): on the ss3 run about a dozen listed failures carried
 * a reason that said the property passes ("borderline pass", "acceptable
 * actually") - the forced tool gave the model nowhere to think except the
 * fail list. Each fail now carries `clear`; a fail the model marks unclear
 * is recorded in the log but never drops the paraphrase. */
export const STAGE_STRUCTURE_VERSION = "ss4";

export interface StructureCell {
  stage: string;
  /** "generic", "defensive", "class", or the rival's name. */
  angle: string;
  situation?: string | null;
  classPhrase?: string | null;
  valueLine?: ValueLine | null;
  /** Doubt cells: the designed subject (planned concern) when known. */
  concern?: string | null;
}

/**
 * The numbered properties a cell's paraphrases must all satisfy, or null
 * for a stage the table does not cover (retired stages, a generic
 * alternatives cell). `shape` names the variant for logs.
 */
export function stageStructure(cell: StructureCell, brand: string): { shape: string; properties: string[] } | null {
  const b = brand.trim();
  const pinned = !!cell.situation;
  const circumstance = pinned
    ? "Keeps the asker's circumstance from the seed (the facts about who is asking and their situation) - in any words, compressed or implied is fine, with or without an I or we; it fails only when a fact about the asker is changed, dropped entirely, or added."
    : "Keeps whatever the seed states about who is asking or for whom - compressed or implied is fine; it fails only when that is changed or something about the asker is added.";
  switch (cell.stage) {
    case "problem_recognition":
      return { shape: "problem recognition", properties: [
        circumstance,
        "States one pain - the seed's pain - set in what the asker already uses or does, in the category's own territory.",
        "Asks for a way out, in any wording; forces nothing about the kind of product or fix.",
        `Names no brand, and does not name the category as the fix.`,
      ] };
    case "discovery":
      return { shape: "discovery", properties: [
        circumstance,
        "Forces a set of named options in the category - an ask for WHICH ones to look at, consider or get (asking which to look at FIRST still forces options). An ask for where to start, how to begin, or what to look for does not force options and fails.",
        "Names no brand and lists no wanted features.",
      ] };
    case "criteria":
      return { shape: "criteria", properties: [
        circumstance,
        "Asks what to look at (the first ask) - asking which criteria, factors or things to look at IS this ask.",
        "Asks, conditioned on the answer to the first ask, what to consider (any connector; the dependency is the shape, not the word). A paraphrase with only one of the two asks fails, including one that asks only what to consider and treats what to look at as already settled.",
        "Forces no product: neither ask names or requests products or options; offers no candidate criteria of its own (asking which criteria matter is not offering them); names no brand.",
      ] };
    case "use_case":
      return { shape: "use-case fit", properties: [
        pinned
          ? "Keeps who the asker is, from the seed - in any words, compressed or implied is fine, third person or no I or we is fine; it fails only when the person is changed or someone else is added. Where the seed's situation is only a buying moment or channel, the paraphrase may leave it out."
          : circumstance,
        "States ONE outcome the asker wants - the seed's outcome - in their own words (not a feature, not a list).",
        "Forces one best product for that outcome (which one does that best).",
        "Names no brand.",
      ] };
    case "pricing": {
      const vl = cell.valueLine;
      const lineIsBrand = !!vl && vl.line.trim().toLowerCase() === b.toLowerCase();
      const ends = vl
        ? lineIsBrand
          ? `Names ${b} and weighs it against ${vl.counterpart} (a generic cheaper counterpart, described by tier or price level, never by name, never ${b}'s own lower tier).`
          : `Names the line "${vl.line}" (in any natural wording of its name) and weighs it against ${vl.counterpart} (a generic cheaper counterpart, described by tier or price level, never by name, never ${b}'s own lower tier).`
        : `Names ${b}'s line from the seed and weighs it against a generic cheaper counterpart in the category (described by tier or price level, never by name, never ${b}'s own lower tier).`;
      return { shape: "value", properties: [
        "States the asker's circumstance from the seed, in a few words.",
        ends,
        "Forces a worth-it verdict: is the line worth it over the counterpart, for this asker. The verdict may be asked as a choice between the two, as an opinion, or as whether it is worth more or worth paying the difference. An ask whether it is worth considering, worth a look, or what to think about forces no verdict and fails.",
        "Names no rival; states no price or fee as a FIGURE (an amount) - words like its price, the price, the cost or the fee state no figure and pass; presupposes no verdict.",
      ] };
    }
    case "category_education":
      return { shape: "category education", properties: [
        "Asks what the category is, what kinds of options exist in it, or how people use it - the seed's ask.",
        "Keeps any audience the seed states.",
        "Forces no brand and no specific product; compares no tiers.",
      ] };
    case "social_validation":
      return { shape: "social validation", properties: [
        "Asks what people actually use, love, recommend or swear by.",
        "Forces named brands or products in the answer.",
        "Names none itself.",
      ] };
    case "premium_worth":
      return { shape: "premium vs basic", properties: [
        "Weighs the category's premium options against its basic or store options as TIERS.",
        "Forces a tier verdict (are the premium ones worth it, or are the basic ones enough) and leaves room for named picks.",
        `Judges no single brand's own worth; names no brand.`,
      ] };
    case "comparison": {
      if (cell.classPhrase)
        return { shape: "head-to-head vs a class", properties: [
          `Names ${b} and weighs it against ${cell.classPhrase} as a CLASS of products; a specific rival product or company in place of the class fails.`,
          "Forces ONE pick between the two.",
          "Asks why.",
          "Adds no situation, criteria or usage the seed does not state.",
        ] };
      const rival = cell.angle;
      return { shape: "head-to-head", properties: [
        `Names ${b} and ${rival}, and no other brand.`,
        "Forces ONE pick between them - which one the answerer would choose, recommend or call the better pick; a compare lead-in that ends in that pick still forces it. An ask for reasons on either side, for what would make someone choose one over the other, or an ask that runs both ways forces no single pick and fails.",
        "Asks why.",
        "Adds no situation, criteria or usage the seed does not state (the category word, a buying or for-yourself frame, and asking the answerer's own choice are not additions).",
      ] };
    }
    case "objections":
      return { shape: "objection", properties: [
        `Names ${b}.`,
        `States one doubt about ${b} - the seed's doubt, same subject${cell.concern ? ` (${cell.concern})` : ""} - as the asker's own claim. Hearsay, a fact question or a how-common question are acceptable voicings of it.`,
        "Leaves the verdict open: the answer can confirm or rebut the doubt.",
        `The asker is not a current customer of ${b}; carries no second worry; asks for no price, cost figure or accounting; is not an ask whether ${b} is worth it over a cheaper option.`,
      ] };
    case "churn_triggers":
      return { shape: "churn", properties: [
        `Names ${b}; the asker is not recast as a prospect who has never had ${b} - speaking as someone who has or uses it, however briefly or implicitly (even in a would-you question), passes; it fails only when the paraphrase says or clearly implies the asker does not have it.`,
        `States the worry - the seed's worry, same subject${cell.concern ? ` (${cell.concern})` : ""}.`,
        "Leaves both staying and leaving possible: a question that asks only whether to stay, only whether to leave, or whether one beats the other still leaves the other open and passes. Only a fix-it ask with no option of leaving, an asker who has already decided, or a choice between two ways of leaving fails.",
        "Asks for no price, cost figure or accounting.",
      ] };
    case "renewal":
      return { shape: "renewal", properties: [
        `Names ${b}; the asker is its current customer.`,
        "States that the renewal or bill is coming due - any mention of renewing, another year, or the fee posting states it.",
        "Asks whether to keep paying; asking only whether to renew, only whether to cancel, or whether one beats the other still leaves both possible and passes.",
        "Asks for no price, cost figure or accounting.",
      ] };
    case "repertoire":
      return { shape: "repertoire", properties: [
        `Names ${b}; the asker is its habitual buyer.`,
        "Asks whether to stick with it or try something else; keeps the stick option.",
        "Names no rival.",
      ] };
    case "business_case":
      return { shape: "business case", properties: [
        `Names ${b}.`,
        "States the approver being convinced - someone who signs off on the purchase - the same as the seed's.",
        "Asks for help making the case.",
        "Names no rival; is not a pricing question.",
      ] };
    case "expansion":
      return { shape: "expansion", properties: [
        `Names ${b}; the asker is a satisfied customer.`,
        "States ONE specific growth step - the seed's step.",
        "Asks whether to take it.",
        "Names no rival; is not a support or fix-it question.",
      ] };
    case "ecosystem":
      return { shape: "ecosystem", properties: [
        `Names ${b}; the asker is not recast as someone without ${b} - having or using it may be stated briefly or left implied; it fails only when the paraphrase says or clearly implies the asker does not have it.`,
        `States ONE need - the seed's need - that ${b}'s own companions, add-ons or partners could serve; a need defined by where ${b} is absent or falls short fails.`,
        `Asks what to pair, use or go with ${b} for it, in any words; forces no third-party-only answer.`,
        "Names no rival.",
      ] };
    case "advocacy":
      return { shape: "advocacy", properties: [
        `Names ${b}.`,
        "States the person being convinced - the same person as the seed's - a peer, friend, colleague or the critic themselves, never someone who approves the purchase.",
        "States that person's objection, quoted or reported - the seed's objection.",
        `Asks for help making the case for ${b}; names no rival as the asker's own pick.`,
      ] };
    case "alternatives": {
      const a = cell.angle.trim().toLowerCase();
      if (a === "defensive")
        return { shape: "defensive alternatives", properties: [
          `Names ${b}; the asker is its current customer.`,
          "Asks what else is out there.",
          "Names no rival.",
        ] };
      if (a === "generic" || a === "") return null;
      return { shape: "offensive alternatives", properties: [
        `Names ${cell.angle} as the option being left, and no other brand (never ${b}).`,
        "States the move as decided: the asker is leaving, has left, is done, plans to, is ready to, or will not buy it again - any of these passes, and so does asking what replaces it as the asker's next one. Only a conditional or undecided move fails: if I leave, once I leave, I may switch, I'm considering leaving, suppose I drop it.",
        "Asks what to get instead, within the category.",
        "Gives no reason for leaving, and no team, segment or identity the seed does not state.",
      ] };
    }
    default:
      return null;
  }
}

/**
 * Mechanical readings of four properties whose failing shape has a
 * reliable string form (the draft's "Regexes" rule: named for the
 * property, not a p-number). Calibrated on the 206 p26 served cells: every
 * hit is a paraphrase the model also failed when it looked, and the model
 * misses 2-3 of them per run (either-way head-to-heads, one-half criteria)
 * from call-to-call noise. Free, so they run before the model call.
 */
const EITHER_WAY = /\b(?:or (?:the other way|vice versa|the reverse)|over \w[\w ]{0,30}, or \w[\w ]{0,30} over|(?:rather|instead) than \w[\w ]{0,30}, or \w[\w ]{0,30} (?:rather|instead) than)\b|\bwhy would you (?:choose|pick|go with)\b.*\bor\b.*\bover\b/i;
const CONDITIONAL_MOVE = /^\s*(?:if|suppose|say|assuming|in case|once) (?:i|we)('d| would|'ll| will|'m| am|'re| are)? ?(?:stop|leave|leaving|drop|quit|cancel|move off|moving off|move on|moving on|switch(?:ing)? (?:from|away)|ditch|give up|walk away|get rid of|were to|off\b)\b|\b(?:if|once) (?:i|we)(?:'m|'re| am| are)? (?:leav|switch|mov|stop|dropp|ditch)\w*\b.*\?/i;
const WORTH_CONSIDERING = /\bworth (?:considering|a look|looking at|a thought|thinking about|exploring)\b/i;
const HALF_CRITERIA = /^\s*what should (?:i|we) (?:consider|weigh|think about|factor in)\b.*\b(?:after|once) (?:(?:i|we|i've|we've) )?(?:look|figur|decid|settl|work)\w*\b/i;

export function structureStringFail(cell: StructureCell, text: string): StructureFail | null {
  const a = cell.angle.trim().toLowerCase();
  if (cell.stage === "comparison" && EITHER_WAY.test(text)) return { property: 2, reason: "asks for reasons either way, forces no single pick (string form)", clear: true };
  if (cell.stage === "alternatives" && a !== "defensive" && a !== "generic" && a !== "" && CONDITIONAL_MOVE.test(text)) return { property: 2, reason: "the move is conditional (string form)", clear: true };
  if (cell.stage === "pricing" && WORTH_CONSIDERING.test(text)) return { property: 3, reason: "asks whether it is worth considering, forces no verdict (string form)", clear: true };
  if (cell.stage === "criteria" && HALF_CRITERIA.test(text)) return { property: 3, reason: "asks only what to consider and treats what to look at as settled (string form)", clear: true };
  return null;
}

export const STRUCTURE_CHECK_MODEL = process.env.STRUCTURE_CHECK_MODEL ?? process.env.DESIGN_CHECK_MODEL ?? "claude-sonnet-5";
export const STRUCTURE_CHECK_EFFORT = process.env.STRUCTURE_CHECK_EFFORT ?? "low";

export const STRUCTURE_CHECK_SYSTEM =
  "You check paraphrases of a survey question against the question's structure. " +
  "The seed is the designed question. Each numbered property describes the SHAPE the question must have - what it forces the answer to be - never the words it must use. " +
  "For each paraphrase, decide for every property whether the paraphrase satisfies it. A property is satisfied in any wording, register or order; different detail, backstory and phrasing are expected and fine. " +
  "Judge only the paraphrase's own words, never what an answer might say. Nothing outside the numbered list is a failure. " +
  "Report the properties a paraphrase fails, each with a one-line reason and whether the failure is clear; mark a borderline or arguable call clear: false. Respond ONLY by calling the structure_verdict tool.";

const STRUCTURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer", description: "The paraphrase's number as given." },
          fails: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                property: { type: "integer", description: "The failed property's number." },
                reason: { type: "string", description: "One short sentence." },
                clear: { type: "boolean", description: "true only when the property is clearly failed; false for a borderline or arguable call." },
              },
              required: ["property", "reason", "clear"],
            },
          },
        },
        required: ["index", "fails"],
      },
    },
  },
  required: ["verdicts"],
};

export interface StructureFail { property: number; reason: string; /** false = the model called it borderline; logged, never dropped. */ clear: boolean; }
export interface StructureVerdict {
  /** Per paraphrase (same order as `texts`): the failed properties. */
  fails: StructureFail[][];
  /** The checker could not be reached - every paraphrase served, nothing cached. */
  unchecked?: boolean;
}

/** Tool output sometimes arrives with arrays as JSON strings; read both. */
function asArray(x: unknown): unknown[] {
  if (Array.isArray(x)) return x;
  if (typeof x === "string") { try { const j = JSON.parse(x); return Array.isArray(j) ? j : []; } catch { return []; } }
  return [];
}
function asObj(x: unknown): Record<string, unknown> | null {
  if (x && typeof x === "object" && !Array.isArray(x)) return x as Record<string, unknown>;
  if (typeof x === "string") { try { const j = JSON.parse(x); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; } }
  return null;
}

/**
 * One call per cell: the seed, the numbered properties, the numbered
 * paraphrases; returns each paraphrase's failed properties. Cached per
 * (version, model, effort, properties, seed, texts). Fails open with
 * `unchecked` so a checker outage never blocks the gate - callers must
 * not cache a set containing unchecked verdicts as checked.
 */
export async function checkStructure(input: {
  brand: string;
  cells: { cell: StructureCell; seed: string; texts: string[] }[];
  meta?: CacheMeta;
  model?: string;
  effort?: string;
}): Promise<(StructureVerdict | null)[]> {
  const a = await anthropicClient();
  const model = input.model ?? STRUCTURE_CHECK_MODEL;
  const effort = input.effort ?? STRUCTURE_CHECK_EFFORT;
  return withCostContext({ purpose: "setup:structure_check" }, () => Promise.all(
    input.cells.map(async ({ cell, seed, texts }): Promise<StructureVerdict | null> => {
      const s = stageStructure(cell, input.brand);
      if (!s || texts.length === 0) return null;
      const normalized = [STAGE_STRUCTURE_VERSION, model, effort, s.shape, ...s.properties, seed, ...texts]
        .map((p) => p.trim().toLowerCase()).join("|");
      const key = `structure_check:${STAGE_STRUCTURE_VERSION}:${createHash("sha256").update(normalized).digest("hex")}`;
      const hit = await store.cacheGet(key, 183 * 24 * 3600 * 1000);
      if (hit) return JSON.parse(hit) as StructureVerdict;
      const user =
        `Stage shape: ${s.shape}\nSeed: ${seed}\n\nProperties every paraphrase must satisfy:\n` +
        s.properties.map((p, i) => `${i + 1}. ${p}`).join("\n") +
        `\n\nParaphrases:\n` + texts.map((t, i) => `${i + 1}. ${t}`).join("\n");
      try {
        const res = await a.messages.create({
          model,
          max_tokens: 3000,
          ...(effort === "default" ? {} : { output_config: { effort } }),
          system: STRUCTURE_CHECK_SYSTEM,
          tools: [{ name: "structure_verdict", description: "Return each paraphrase's failed properties.", input_schema: STRUCTURE_SCHEMA as never }],
          tool_choice: { type: "tool", name: "structure_verdict" },
          messages: [{ role: "user", content: user }],
        } as never);
        const blocks = (res as { content: { type: string; input?: unknown }[] }).content;
        const tool = blocks.find((b) => b.type === "tool_use");
        const raw = asObj(tool?.input) ?? {};
        const fails: StructureFail[][] = texts.map(() => []);
        for (const v of asArray(raw.verdicts)) {
          const o = asObj(v); if (!o) continue;
          const idx = Number(o.index) - 1;
          if (!Number.isInteger(idx) || idx < 0 || idx >= texts.length) continue;
          for (const f of asArray(o.fails)) {
            const fo = asObj(f); if (!fo) continue;
            const property = Number(fo.property);
            if (!Number.isInteger(property) || property < 1 || property > s.properties.length) continue;
            fails[idx].push({ property, reason: String(fo.reason ?? ""), clear: fo.clear !== false });
          }
        }
        texts.forEach((t, i) => { const sf = structureStringFail(cell, t); if (sf && !fails[i].some((f) => f.property === sf.property && f.clear)) fails[i].unshift(sf); });
        const out: StructureVerdict = { fails };
        await store.cacheSet(key, JSON.stringify(out), input.meta);
        return out;
      } catch (err) {
        console.error("structure check failed:", err);
        return { fails: texts.map(() => []), unchecked: true };
      }
    })
  ));
}
