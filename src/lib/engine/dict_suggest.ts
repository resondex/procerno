import { createHash } from "crypto";
import { tagCosts } from "../cost_log";
import { openaiClient } from "./providers";
import { store } from "../store";
import type { DictionaryEntry } from "../types";

const SUGGEST_MODEL = process.env.SUGGEST_MODEL ?? "gpt-5-mini";
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000; // ~6 months
// v7 (2026-09-23, Tyler-calibrated on the pinned Pixel board): approve is
// reserved for competing offerings from a DIFFERENT maker; independent
// non-category companies (carriers, suppliers, retailers, publications,
// bystander apps) are ignore; an active brand's ecosystem (companion
// devices, first-party services, co-branded components) and named
// models/trims of its lines always merge. 5-run harness: unanimity 68/71
// on Pixel (v5: 60), 68/71 match to the approved board; AmEx stability
// 42 -> 60/72.
// v8 = the v7 rules plus the mechanical family layer (buildFamilyPlan):
// name-containment resolves brand families deterministically and only
// family ROOTS reach the model. Validated 2026-09-23: two fresh Pixel runs
// produced IDENTICAL boards, 69/71 matching the Tyler-ratified board (both
// stable diffs are the rules being more consistent than the ratified roll).
// In the cache key so behavior changes bypass stale suggestions.
const SUGGEST_RULES_VERSION = "v8";

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

/**
 * Mechanical family grouping - the deterministic layer in front of the
 * model. A pending name whose tokens contain a tracked brand's name (or
 * alias) extends that brand and merges into it with no model call at all;
 * a pending name containing another, shorter pending name joins that name's
 * family and inherits its verdict. The relationship between "Sony" and
 * "Sony Xperia 1 VI" is string arithmetic, not judgment - asking a sampled
 * model to rediscover it per name is how families got scattered across
 * approve/ignore/wrong-target. Only family ROOTS reach the model.
 */
export interface FamilyPlan {
  /** pending entry id -> active canonical it mechanically merges into */
  activeMerge: Map<string, string>;
  /** pending child entry id -> its family root's pending entry id */
  rootOf: Map<string, string>;
}

export const famTokens = (s: string) => norm(s).split(/[^a-z0-9+]+/).filter(Boolean);

export function containsSeq(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function buildFamilyPlan(
  pending: DictionaryEntry[],
  active: DictionaryEntry[]
): FamilyPlan {
  const activeSeqs: { seq: string[]; canonical: string }[] = [];
  for (const a of active) {
    if (a.canonical === "Other") continue;
    activeSeqs.push({ seq: famTokens(a.canonical), canonical: a.canonical });
    for (const al of a.aliases) {
      activeSeqs.push({ seq: famTokens(al), canonical: a.canonical });
    }
  }
  const toks = new Map(pending.map((p) => [p.id, famTokens(p.canonical)]));

  // Best head per name: the LONGEST contained sequence; active beats a
  // pending head of equal length. Pending heads must be strictly shorter
  // than the child, so containment can never cycle.
  interface Head { kind: "active" | "pending"; key: string; len: number }
  const bestHead = new Map<string, Head | null>();
  for (const p of pending) {
    const hay = toks.get(p.id)!;
    let best: Head | null = null;
    for (const { seq, canonical } of activeSeqs) {
      if (containsSeq(hay, seq) && (!best || seq.length > best.len)) {
        best = { kind: "active", key: canonical, len: seq.length };
      }
    }
    for (const q of pending) {
      if (q.id === p.id) continue;
      const qs = toks.get(q.id)!;
      if (
        qs.length < hay.length &&
        containsSeq(hay, qs) &&
        (!best || qs.length > best.len)
      ) {
        best = { kind: "pending", key: q.id, len: qs.length };
      }
    }
    bestHead.set(p.id, best);
  }

  // Resolve transitively: a chain of pending heads bottoms out at either an
  // active brand (whole chain merges mechanically) or a root pending name.
  const plan: FamilyPlan = { activeMerge: new Map(), rootOf: new Map() };
  const resolve = (id: string): { active?: string; root?: string } => {
    const h = bestHead.get(id);
    if (!h) return { root: id };
    if (h.kind === "active") return { active: h.key };
    return resolve(h.key);
  };
  for (const p of pending) {
    const r = resolve(p.id);
    if (r.active) plan.activeMerge.set(p.id, r.active);
    else if (r.root && r.root !== p.id) plan.rootOf.set(p.id, r.root);
  }
  return plan;
}

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

/** Per-answer brand-name sets from the discovery brands pass, for the
 * co-occurrence guard. Null when the project has no discovery data yet
 * (pre-bootstrap runs) - the guard then simply doesn't fire. */
async function loadDiscoveryBrandSets(
  projectId: string
): Promise<Set<string>[] | null> {
  // discovery_brands where present, mentions rows otherwise - one query
  // path, no answer text loaded.
  const rows = await store.listProjectBrandRows(projectId);
  if (rows.length === 0) return null;
  return rows.map((r) => new Set(r.brands.map(norm)));
}

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
  let fresh: DictionaryEntry[] = [];
  const hits = await Promise.all(
    pending.map((p) => store.cacheGet(nameKey(projectId, p.canonical), CACHE_TTL_MS))
  );
  pending.forEach((p, i) => {
    const hit = hits[i];
    if (hit) cached.set(p.id, JSON.parse(hit) as CachedVerdict);
    else fresh.push(p);
  });

  // Mechanical family layer: names that extend a tracked brand merge into it
  // deterministically; names that extend another pending name wait for that
  // root's verdict and inherit it. Only family roots reach the model.
  const plan = buildFamilyPlan(pending, active);
  for (const p of fresh) {
    const target = plan.activeMerge.get(p.id);
    if (!target) continue;
    const v: CachedVerdict = {
      action: "merge",
      merge_into: target,
      rationale: `extends the tracked brand "${target}"`,
    };
    cached.set(p.id, v);
    await store.cacheSet(nameKey(projectId, p.canonical), JSON.stringify(v), {
      category,
      projectId,
    });
  }
  const freshChildren = fresh.filter(
    (p) => !plan.activeMerge.has(p.id) && plan.rootOf.has(p.id)
  );
  fresh = fresh.filter(
    (p) => !plan.activeMerge.has(p.id) && !plan.rootOf.has(p.id)
  );

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

    // Co-occurrence guard on the model's merge proposals (string-variant
    // family merges are exempt - they never reach this list). Measured from
    // the brands pass: a satellite that (a) almost never appears without its
    // proposed parent is program/content vocabulary the parent already
    // matched - redundant in the dictionary, its information belongs to the
    // reason codes; (b) often appears WITHOUT the parent lives in its own
    // context, and merging would inflate the parent's share. Both drop to
    // ignore; only the middle band - genuinely referential use - keeps the
    // merge, annotated with the measured number for the human at the gate.
    const guarded = fresh.filter((p) => cached.get(p.id)?.action === "merge");
    if (guarded.length > 0) {
      const brandSets = await loadDiscoveryBrandSets(projectId);
      if (brandSets) {
        for (const p of guarded) {
          const v = cached.get(p.id)!;
          const target = entries.find(
            (e) => norm(e.canonical) === norm(v.merge_into ?? "")
          );
          const satTerm = norm(p.canonical);
          // Short form of the brand itself ("Samsung" -> Samsung Galaxy,
          // "Amazon" -> Amazon Prime Video): the target's name CONTAINS the
          // satellite's, so it is referential by construction - never
          // guarded away, but flagged, since a company short form can also
          // carry the company's other contexts.
          if (
            containsSeq(famTokens(v.merge_into ?? ""), famTokens(p.canonical))
          ) {
            const flagged: CachedVerdict = {
              ...v,
              rationale: `${v.rationale} (short form of the brand name - review)`,
            };
            cached.set(p.id, flagged);
            await store.cacheSet(
              nameKey(projectId, p.canonical),
              JSON.stringify(flagged),
              { category, projectId }
            );
            continue;
          }
          // Parent terms include the target's aliases AND its pending short
          // forms - "Apple" is how answers name the iPhone's parent before
          // the gate makes it an alias, and scoring iMessage without it
          // called a 7%-alone satellite a 32% one.
          const shortForms = pending
            .filter((q) =>
              containsSeq(famTokens(v.merge_into ?? ""), famTokens(q.canonical))
            )
            .map((q) => norm(q.canonical));
          const parentTerms = [
            ...(target
              ? [norm(target.canonical), ...target.aliases.map(norm)]
              : [norm(v.merge_into ?? "")]),
            ...shortForms,
          ];
          let n = 0;
          let withParent = 0;
          for (const set of brandSets) {
            let hasSat = false;
            let hasParent = false;
            for (const b of set) {
              if (!hasSat && b.includes(satTerm)) hasSat = true;
              if (!hasParent && parentTerms.some((t) => t && b.includes(t)))
                hasParent = true;
              if (hasSat && hasParent) break;
            }
            if (!hasSat) continue;
            n++;
            if (hasParent) withParent++;
          }
          if (n < 10) continue; // too thin to judge
          const alone = 1 - withParent / n;
          let next: CachedVerdict | null = null;
          if (alone <= 0.05) {
            next = {
              action: "ignore",
              merge_into: null,
              rationale: `vocabulary of "${v.merge_into}" - named alone in only ${Math.round(alone * 100)}% of ${n} answers; the parent already matches those answers, and the argument belongs to the reason codes`,
            };
          } else if (alone >= 0.3) {
            next = {
              action: "ignore",
              merge_into: null,
              rationale: `own-context brand - named WITHOUT "${v.merge_into}" in ${Math.round(alone * 100)}% of ${n} answers; merging would inflate the parent`,
            };
          } else {
            next = {
              ...v,
              rationale: `${v.rationale} (named without "${v.merge_into}" in ${Math.round(alone * 100)}% of ${n} answers - review)`,
            };
          }
          cached.set(p.id, next);
          await store.cacheSet(nameKey(projectId, p.canonical), JSON.stringify(next), {
            category,
            projectId,
          });
        }
      }
    }
  }

  // Family children inherit their root's verdict: root approved -> the child
  // merges under it; root merged somewhere -> the child follows; root
  // ignored -> the child is ignored. A root that failed to get a verdict
  // leaves its children uncached to retry next visit.
  const byId = new Map(pending.map((p) => [p.id, p]));
  for (const p of freshChildren) {
    const rootId = plan.rootOf.get(p.id)!;
    const rootVerdict = cached.get(rootId);
    const root = byId.get(rootId);
    if (!rootVerdict || !root) continue;
    const v: CachedVerdict =
      rootVerdict.action === "approve"
        ? {
            action: "merge",
            merge_into: root.canonical,
            rationale: `variant of "${root.canonical}"`,
          }
        : rootVerdict.action === "merge"
          ? {
              action: "merge",
              merge_into: rootVerdict.merge_into,
              rationale: `follows "${root.canonical}"`,
            }
          : {
              action: "ignore",
              merge_into: null,
              rationale: `follows "${root.canonical}"`,
            };
    cached.set(p.id, v);
    await store.cacheSet(nameKey(projectId, p.canonical), JSON.stringify(v), {
      category,
      projectId,
    });
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

/** The v7 disposition rules (Tyler-calibrated, harness-validated), exported
 * so evals can run the byte-identical production prompt against other
 * models. */
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
          "- approve: a competing brand or product line from a DIFFERENT " +
          "maker than the active brands - a genuinely new player in this " +
          "category, worth its own row.\n" +
          "- ignore: not an analyzable offering in this category. This " +
          "includes generic or infrastructure descriptors ('a self-hosted " +
          "server', 'open-source tools', 'a spreadsheet'), feature fragments " +
          "with no brand attached, compound names listing multiple DISTINCT " +
          "brands (merging such a name into either would misattribute the " +
          "other), one-off tangents - AND real companies that do not sell " +
          "this category's offering: component suppliers, carriers, platform " +
          "owners, retailers, marketplaces, publications, review sites, and " +
          "apps the products merely run. Appearing in answers is not the " +
          "same as being a choice.\n" +
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
          "A named model, generation, or trim of an active brand's product " +
          "line (a numbered or suffixed variant of its name) merges into " +
          "that line - it is never approve.\n" +
          "ECOSYSTEM RULE — a product, service, app, store, or accessory " +
          "belonging to an active brand's ecosystem (a companion device, " +
          "first-party service, migration tool, accessory line) and a " +
          "partner brand named as part of an active brand's product (a " +
          "co-engineered camera, a licensed feature) are NEVER their own " +
          "row and never ignored: merge them into that brand.\n" +
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
