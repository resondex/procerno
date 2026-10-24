/**
 * Category-reach advisory (2026-10-23, Tyler): the category label is written
 * once at setup (model-prefilled, user-editable) and then treated as truth
 * by everything downstream - the same pre-data-seed defect the taxonomy had.
 * The Doritos tracker carried "bagged chips" while its approved board
 * included puffed snacks and onion rings, so every future emerged name was
 * being judged against a label narrower than the owner's own approvals.
 * This check compares the APPROVED competitors against the label's wording
 * and, when any falls outside it, proposes the smallest wider label - an
 * advisory chip at the gate / Analysis settings, never an auto-change.
 * One cached low-effort call; fails open to null (no chip).
 */
import { createHash } from "crypto";
import { openaiClient } from "./providers";
import { store } from "../store";
import { tagCosts } from "../cost_log";
import { CATEGORY_REACH_MODEL } from "./models";
import type { CacheMeta } from "../types";

// cr2 (2026-10-24): packaging format alone never puts a product outside
// the label (cr1 read a canister brand as outside a "bagged" label).
const REACH_VERSION = "cr2";
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000;

export type CategoryReach = {
  /** Approved competitors whose product here falls outside the label's
   * wording, each with what it sells in this market. */
  outside: { name: string; sells: string }[];
  /** The smallest wider label covering every approved competitor, or null
   * when nothing is outside (or the model's proposal failed the guards). */
  suggestion: string | null;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outside", "suggestion"],
  properties: {
    outside: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "sells"],
        properties: { name: { type: "string" }, sells: { type: "string" } },
      },
    },
    suggestion: { type: ["string", "null"] },
  },
} as const;

export async function checkCategoryReach(input: {
  brand: string;
  category: string;
  /** Approved competitor display names from the confirmed dictionary (or
   * the configured list before a board exists). */
  competitors: string[];
  meta?: CacheMeta;
}): Promise<CategoryReach | null> {
  const names = [...new Set(input.competitors.map((c) => c.trim()).filter(Boolean))].sort();
  if (names.length === 0) return { outside: [], suggestion: null };
  const norm = `${input.category.trim().toLowerCase()}|${input.brand.trim().toLowerCase()}|${names.join("~").toLowerCase()}`;
  const key = `category_reach:${REACH_VERSION}:${CATEGORY_REACH_MODEL}:${createHash("sha256").update(norm).digest("hex")}`;
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit) as CategoryReach;
  tagCosts({ purpose: "setup:category_reach" });
  try {
    const res = await openaiClient().chat.completions.create({
      model: CATEGORY_REACH_MODEL,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content:
            "A brand tracker names its market with ONE category label in " +
            "plain buyer language. You get the label and the competitors " +
            "the tracker's owner approved as selling against the brand in " +
            "that market. For each competitor, judge whether the product " +
            "it competes WITH here falls OUTSIDE the label's wording - a " +
            "buyer reading the label would not expect that product under " +
            "it. A company that also sells other things is outside only " +
            "when its competing product here is outside the wording. A " +
            "product's container or packaging format alone never puts it " +
            "outside the label - only what the product IS can. " +
            "List the outside competitors with what each sells in this " +
            "market (a few plain words). If any are outside, propose ONE " +
            "wider label: plain buyer vocabulary, five words or fewer, " +
            "lowercase like the current label, the SMALLEST widening that " +
            "covers every approved competitor's product - never the whole " +
            "aisle or market, never a brand name. If none are outside, " +
            "outside is empty and suggestion is null.",
        },
        {
          role: "user",
          content:
            `Category label: ${input.category}\nTracked brand: ${input.brand}\n` +
            `Approved competitors:\n${names.map((n) => `- ${n}`).join("\n")}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "category_reach", strict: true, schema: SCHEMA },
      },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as CategoryReach;
    const nameSet = new Set(names.map((n) => n.toLowerCase()));
    const outside = (parsed.outside ?? []).filter((o) => nameSet.has((o.name ?? "").trim().toLowerCase()));
    // Suggestion guards, mechanical: only with something outside; never the
    // current label back; no brand or competitor name inside it; short.
    let suggestion = outside.length > 0 ? (parsed.suggestion ?? "").trim() : "";
    const sLow = suggestion.toLowerCase();
    const namesTokens = [input.brand, ...names].map((n) => n.trim().toLowerCase()).filter((t) => t.length > 2);
    if (
      !suggestion ||
      suggestion.length > 48 ||
      sLow === input.category.trim().toLowerCase() ||
      namesTokens.some((t) => sLow.includes(t))
    ) {
      suggestion = "";
    }
    const out: CategoryReach = { outside, suggestion: suggestion || null };
    await store.cacheSet(key, JSON.stringify(out), input.meta);
    return out;
  } catch (err) {
    console.error("category reach check failed open:", err);
    return null;
  }
}
