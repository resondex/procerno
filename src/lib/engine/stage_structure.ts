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
export const STAGE_STRUCTURE_VERSION = "ss1";

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
    ? "States the asker's circumstance from the seed (the facts about who is asking and their situation), in any words."
    : "Keeps whatever the seed states about who is asking or for whom, in any words.";
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
        "Forces a set of named options in the category - an ask for WHICH ones to look at or get. An ask for where to start, how to begin, or what to look for does not force options and fails.",
        "Names no brand and lists no wanted features.",
      ] };
    case "criteria":
      return { shape: "criteria", properties: [
        circumstance,
        "Asks what to look at (the first ask).",
        "Asks, conditioned on the answer to the first ask, what to consider (any connector; the dependency is the shape, not the word). A paraphrase with only one of the two asks fails.",
        "Forces no product: neither ask names or requests products or options; offers no candidate criteria; names no brand.",
      ] };
    case "use_case":
      return { shape: "use-case fit", properties: [
        pinned
          ? "States who the asker is, from the seed; where the seed's situation is only a buying moment or channel, the paraphrase may leave it out."
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
        "Forces a worth-it verdict: is the line worth it over the counterpart, for this asker. An ask whether it is worth considering, worth a look, or what to think about forces no verdict and fails; an ask whether it is worth more, or whether to pay the difference, is a verdict.",
        "Names no rival; states no price or fee as a fact; presupposes no verdict.",
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
        "Forces ONE pick between them - which one the answerer would choose. An ask for reasons on either side, for what would make someone choose one over the other, for a comparison or a breakdown, or an ask that runs both ways forces no single pick and fails.",
        "Asks why.",
        "Adds no situation, criteria or usage the seed does not state.",
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
        `Names ${b}; the asker is its current customer.`,
        `States the worry - the seed's worry, same subject${cell.concern ? ` (${cell.concern})` : ""}.`,
        "Leaves both staying and leaving possible: neither is foreclosed, and both need not be spelled out. A fix-it ask with no option of leaving, an asker who has already decided, or a choice between two ways of leaving fails.",
        "Asks for no price, cost figure or accounting.",
      ] };
    case "renewal":
      return { shape: "renewal", properties: [
        `Names ${b}; the asker is its current customer.`,
        "States that the renewal or bill is coming due.",
        "Asks whether to keep paying; leaves both keep and cancel possible.",
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
        `Names ${b}; the asker states they are a current customer.`,
        `States ONE need - the seed's need - that ${b}'s own companions, add-ons or partners could serve; a need defined by where ${b} is absent or falls short fails.`,
        `Asks what to pair with ${b} for it; forces no third-party-only answer.`,
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
        "States the move as decided. A conditional move (if I leave, if I move on, I may switch, suppose I drop it) fails.",
        "Asks what to get instead, within the category.",
        "Gives no reason for leaving, and no team, segment or identity the seed does not state.",
      ] };
    }
    default:
      return null;
  }
}

export const STRUCTURE_CHECK_MODEL = process.env.STRUCTURE_CHECK_MODEL ?? process.env.DESIGN_CHECK_MODEL ?? "claude-sonnet-5";
export const STRUCTURE_CHECK_EFFORT = process.env.STRUCTURE_CHECK_EFFORT ?? "low";

export const STRUCTURE_CHECK_SYSTEM =
  "You check paraphrases of a survey question against the question's structure. " +
  "The seed is the designed question. Each numbered property describes the SHAPE the question must have - what it forces the answer to be - never the words it must use. " +
  "For each paraphrase, decide for every property whether the paraphrase satisfies it. A property is satisfied in any wording, register or order; different detail, backstory and phrasing are expected and fine. " +
  "Judge only the paraphrase's own words, never what an answer might say. Nothing outside the numbered list is a failure. " +
  "Report only the properties a paraphrase fails, each with a one-line reason. Respond ONLY by calling the structure_verdict tool.";

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
              },
              required: ["property", "reason"],
            },
          },
        },
        required: ["index", "fails"],
      },
    },
  },
  required: ["verdicts"],
};

export interface StructureFail { property: number; reason: string; }
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
            fails[idx].push({ property, reason: String(fo.reason ?? "") });
          }
        }
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
