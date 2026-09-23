import { createHash } from "crypto";
import { tagCosts } from "../cost_log";
import { openaiClient } from "./providers";
import { store } from "../store";
import type { DictionaryEntry } from "../types";

const SUGGEST_MODEL = process.env.SUGGEST_MODEL ?? "gpt-5-mini";
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000; // ~6 months
// v5: merge now beats ignore whenever a parent offering is present, and
// every example is category-neutral so the rules do not read as written for
// one study's category. In the cache key so prompt changes bypass stale
// suggestions.
const SUGGEST_RULES_VERSION = "v5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          action: { type: "string", enum: ["merge", "approve", "ignore"] },
          merge_into: { type: ["string", "null"] },
          rationale: { type: "string" },
        },
        required: ["name", "action", "merge_into", "rationale"],
      },
    },
  },
  required: ["suggestions"],
} as const;

export interface DictSuggestion {
  entryId: string;
  name: string;
  action: "merge" | "approve" | "ignore";
  mergeIntoId: string | null;
  mergeIntoName: string | null;
  rationale: string;
}

/** What the model said about one name, cached forever (well, ~6 months).
 * Entry ids are resolved fresh at read time, so the stored form is names. */
interface CachedVerdict {
  action: "merge" | "approve" | "ignore";
  merge_into: string | null;
  rationale: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Per-NAME cache key. Deliberately excludes the queue and active-set state:
 * a suggestion is a one-time pre-review, computed the first time a name shows
 * up and never revisited. The user's own confirmations are ground truth -
 * approving Linear must not send eBay back to the model. */
const nameKey = (projectId: string, name: string) =>
  `dict_suggest:${SUGGEST_RULES_VERSION}:${projectId}:` +
  createHash("sha256").update(norm(name)).digest("hex");

/** Names per request. Small enough that each name gets real attention and a
 * truncated reply costs one batch, large enough to keep the batch count low. */
const CHUNK = 40;

/**
 * AI pre-review of the pending dictionary queue. Each pending name is judged
 * ONCE - against the active brands as they stand when it first appears - and
 * the verdict is cached per name. Later visits only send names the model has
 * never seen (new candidates from a coding or brands pass); everything else,
 * including everything the user has already dispositioned, is settled and
 * never re-evaluated. Warmed at run completion, instant on the Identify view.
 */
export async function getDictionarySuggestions(
  projectId: string,
  category: string
): Promise<DictSuggestion[]> {
  tagCosts({ purpose: "run:dictionary" });
  const entries = await store.getDictionary(projectId);
  const pending = entries.filter((e) => e.status === "pending");
  const active = entries.filter((e) => e.status === "active");
  if (pending.length === 0) return [];

  // Split pending into cached and new.
  const cached = new Map<string, CachedVerdict>(); // entry id -> verdict
  const fresh: DictionaryEntry[] = [];
  const hits = await Promise.all(
    pending.map((p) => store.cacheGet(nameKey(projectId, p.canonical), CACHE_TTL_MS))
  );
  pending.forEach((p, i) => {
    const hit = hits[i];
    if (hit) cached.set(p.id, JSON.parse(hit) as CachedVerdict);
    else fresh.push(p);
  });

  if (fresh.length > 0) {
    // Batches run concurrently, so total latency is roughly one batch, and a
    // batch that fails costs its own names instead of the whole queue. (One
    // 216-name request once exceeded the model's output cap and the truncated
    // JSON threw on parse - keep the chunking.)
    const batches: DictionaryEntry[][] = [];
    for (let i = 0; i < fresh.length; i += CHUNK) {
      batches.push(fresh.slice(i, i + CHUNK));
    }
    // A failed batch (gpt-5-mini's hidden reasoning can eat the output cap,
    // truncating the JSON) splits and retries its halves, so one hard batch
    // strands at most a handful of names instead of all 40 - which showed up
    // as the sorting spinner re-running on every page load, forever.
    const judge = async (
      batch: DictionaryEntry[]
    ): Promise<Map<string, CachedVerdict>> => {
      try {
        return await suggestBatch(projectId, category, batch, active);
      } catch (err) {
        if (batch.length < 2) {
          console.error(`dictionary suggestion failed for "${batch[0]?.canonical}" —`, err);
          return new Map();
        }
        console.error(
          `dictionary suggestions: batch of ${batch.length} failed, splitting —`,
          err
        );
        const mid = Math.ceil(batch.length / 2);
        const [a, b] = await Promise.all([
          judge(batch.slice(0, mid)),
          judge(batch.slice(mid)),
        ]);
        return new Map([...a, ...b]);
      }
    };
    const settled = await Promise.all(batches.map(judge));
    for (const m of settled) for (const [id, v] of m) cached.set(id, v);
  }

  // Resolve names to entry ids fresh at read time - a cached merge target may
  // have been approved (now active) or renamed since the verdict was stored.
  const byName = new Map(entries.map((e) => [norm(e.canonical), e]));
  const out: DictSuggestion[] = [];
  for (const p of pending) {
    const v = cached.get(p.id);
    if (!v) continue;
    const target = v.merge_into ? byName.get(norm(v.merge_into)) : null;
    out.push({
      entryId: p.id,
      name: p.canonical,
      action: v.action,
      mergeIntoId: target?.id ?? null,
      mergeIntoName: target?.canonical ?? v.merge_into,
      rationale: v.rationale,
    });
  }
  return out;
}

/** The v5 disposition rules, exported so evals can run the byte-identical
 * production prompt against other models. */
export function suggestSystemPrompt(
  category: string,
  activeNames: string[]
): string {
  return (
    "You review a brand-dictionary queue for a study of AI answers in " +
          `the category "${category}". For each pending name, propose:\n` +
          "- merge: the name is the SAME offering as one of the active brands " +
          "(alternate name, spelling, sub-surface of the same product). Set " +
          "merge_into to that active brand's canonical name exactly.\n" +
          "- approve: a genuinely distinct brand/product competing in or " +
          "relevant to the category, worth its own row.\n" +
          "- ignore: not an analyzable brand. This includes generic or " +
          "infrastructure descriptors ('a self-hosted server', 'open-source " +
          "tools', 'a spreadsheet'), feature fragments with no brand " +
          "attached, compound names listing multiple DISTINCT brands " +
          "(merging such a name into either would misattribute the other), " +
          "one-off tangents, and products from unrelated categories.\n" +
          "PREFER MERGE OVER IGNORE: when a name is a surface, module, " +
          "add-on, edition, or tier of an offering that appears among the " +
          "active brands or elsewhere in this batch, merge it into that " +
          "offering. Reserve ignore for names with no parent to merge into.\n" +
          "GRAIN RULE — the analyzable unit is the offering a buyer would " +
          "choose in this category. Feature surfaces, sub-modules, editions, " +
          "tiers, and compound phrasings of one offering all merge into that " +
          "offering. Two products a company sells separately, which a buyer " +
          "would weigh against each other, stay separate even under one " +
          "corporate parent; one product's several views or editions do not. " +
          "Every suggestion needs a one-line rationale.\n" +
          `Active brands: ${activeNames.join(", ")}.\n` +
          "Also treat pending names as potential merge targets for OTHER " +
          "pending names by proposing approve for the best-named variant and " +
          "merge for the rest, with merge_into set to the approved variant. " +
          "The approved variant must be the plainest buyer-facing brand " +
          "name — the bare product name rather than any feature-phrased or " +
          "edition-phrased form of it, which are always the ones merged. If " +
    "several pending names are surfaces of one product that is not " +
    "itself listed, approve the plainest name as the parent and merge " +
    "the others into it."
  );
}

/** Judge one batch of never-before-seen names against the CURRENT active set
 * (user-confirmed brands are facts here, not open questions) and cache a
 * verdict per name. Returns entry id -> verdict for the names the model
 * actually answered; names it skipped stay uncached and retry next visit. */
async function suggestBatch(
  projectId: string,
  category: string,
  batch: DictionaryEntry[],
  active: DictionaryEntry[]
): Promise<Map<string, CachedVerdict>> {
  const res = await openaiClient().chat.completions.create({
    model: SUGGEST_MODEL,
    messages: [
      {
        role: "system",
        content: suggestSystemPrompt(
          category,
          active.map((a) => a.canonical)
        ),
      },
      {
        role: "user",
        content: JSON.stringify(batch.map((p) => p.canonical)),
      },
    ],
    // Generous cap: gpt-5-mini's reasoning tokens bill against this too, and
    // a cap hit truncates the strict-schema JSON into a parse failure.
    max_completion_tokens: 24000,
    response_format: {
      type: "json_schema",
      json_schema: { name: "dispositions", strict: true, schema: SCHEMA },
    },
  });
  // Truncation used to surface as an opaque JSON parse error swallowed by a
  // catch upstream; name it so the log says what actually happened.
  if (res.choices[0]?.finish_reason === "length") {
    throw new Error(
      `suggestion batch truncated at the output cap (${batch.length} names)`
    );
  }
  const parsed = JSON.parse(
    res.choices[0]?.message?.content ?? '{"suggestions":[]}'
  ) as { suggestions: (CachedVerdict & { name: string })[] };

  const byName = new Map(batch.map((e) => [norm(e.canonical), e]));
  const verdicts = new Map<string, CachedVerdict>();
  for (const s of parsed.suggestions) {
    const entry = byName.get(norm(s.name));
    if (!entry) continue;
    const verdict: CachedVerdict = {
      action: s.action,
      merge_into: s.merge_into,
      rationale: s.rationale,
    };
    verdicts.set(entry.id, verdict);
    await store.cacheSet(
      nameKey(projectId, entry.canonical),
      JSON.stringify(verdict),
      { category, projectId }
    );
  }
  return verdicts;
}
