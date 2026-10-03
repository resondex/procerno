import { createHash } from "crypto";
import { openaiClient } from "./providers";
import { store } from "../store";
import { DICT_SEED_MODEL } from "./models";
import { matchKey } from "./metrics";

/** The model-suggested alternate names of a brand list (target first) -
 * ONE source for two consumers (r13, 2026-10-02 cold-walk audit):
 * - seedDictionary, which turns them into the project's dictionary aliases;
 * - the setup checks (seed brand rule, paraphrase signature filter, cell
 *   review), which until now saw only the configured spellings, so "Amex"
 *   never counted as naming American Express: nine must-name seeds were
 *   flagged and eight rewritten to the full name in one walk, every
 *   "Amex"-only paraphrase would be rejected, and a blind seed saying
 *   "Amex" would pass undetected.
 * The cache key is shared with the dictionary seed (sorted brand list +
 * model + prompt version), so setup pays the call once and project creation
 * reuses it. Fails open to no aliases. */

const CACHE_TTL_MS = 183 * 24 * 3600 * 1000; // ~6 months

const ALIAS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          canonical: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
        },
        required: ["canonical", "aliases"],
      },
    },
  },
  required: ["entries"],
} as const;

/** Bump with any change to the alias prompt. The key carries the model and
 * this version (r13 review: the unversioned, model-less key was the same
 * shape as the brand-profile 'analyze' key that served stale profiles for
 * six months). Shared with the dictionary seed, so both move together. */
// a3 (2026-10-02, option B): short names and product-line names
// ("athena", "athenaone" were missing - every check path missed a blind
// "athena vs nextgen" without them).
const ALIAS_PROMPT_VERSION = "a3";

function aliasCacheKey(brands: string[]): string {
  const normalized = [[...brands].sort().join(",")].map((p) => p.trim().toLowerCase()).join("|");
  return `aliases:${ALIAS_PROMPT_VERSION}:${DICT_SEED_MODEL}:${createHash("sha256").update(normalized).digest("hex")}`;
}

/** The raw model reply ({canonical, aliases}[]), cached. Throws on a model
 * failure - callers decide how to fail open. */
export async function suggestBrandAliases(brands: string[]): Promise<{ canonical: string; aliases: string[] }[]> {
  const key = aliasCacheKey(brands);
  const hit = await store.cacheGet(key, CACHE_TTL_MS);
  if (hit) return JSON.parse(hit);
  const res = await openaiClient().chat.completions.create({
    model: DICT_SEED_MODEL,
    messages: [
      {
        role: "system",
        content:
          "For each brand, list the names an AI answer or a person might use " +
          "for the SAME brand: abbreviations, short names, alternate " +
          "spellings, and the names of its own product lines (e.g. " +
          "'American Express' → ['amex', 'americanexpress']; 'Google Pixel' " +
          "→ ['pixel']; 'Samsung Galaxy' → ['galaxy']). Lowercase. Never " +
          "another company's brand, and never a generic word for the " +
          "product type.",
      },
      { role: "user", content: JSON.stringify(brands) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "aliases", strict: true, schema: ALIAS_SCHEMA },
    },
  });
  const suggested = JSON.parse(res.choices[0]?.message?.content ?? '{"entries":[]}').entries;
  await store.cacheSet(key, JSON.stringify(suggested));
  return suggested;
}

/** The setup checks' extraForms map: brand (as configured) -> its alias
 * surface forms. Only forms that can't misfire are kept: an alias that is
 * another tracked brand's name, or shorter than 3 characters, is dropped
 * (same guard as the dictionary seed). Fails open to {} - the checks then
 * behave exactly as before. */
export async function brandAliasForms(brands: string[]): Promise<Record<string, string[]>> {
  let suggested: { canonical: string; aliases: string[] }[];
  try {
    // Bounded: this sits on the cell-generation path (GEN_DEADLINE_MS), so a
    // hung call degrades to "no aliases", never to a stalled battery.
    suggested = await Promise.race([
      suggestBrandAliases(brands),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("alias call timed out after 20s")), 20_000).unref?.()),
    ]);
  } catch (err) {
    console.error("brand alias forms fell back to none:", err);
    return {};
  }
  const brandKeys = new Set(brands.map(matchKey));
  const out: Record<string, string[]> = {};
  for (const b of brands) {
    const k = matchKey(b);
    const hit = suggested.find((s) => matchKey(s.canonical) === k || s.aliases.some((a) => matchKey(a) === k));
    if (!hit) continue;
    const forms = [...new Set([...hit.aliases, hit.canonical].map((a) => a.trim().toLowerCase()))]
      .filter((a) => a.replace(/[^a-z0-9]/g, "").length >= 3 && matchKey(a) !== k && !brandKeys.has(matchKey(a)));
    if (forms.length > 0) out[b] = forms;
  }
  return out;
}
