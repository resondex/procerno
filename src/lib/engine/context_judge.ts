import { createHash } from "node:crypto";
import { matchKey } from "../brand_key";
import { store } from "../store";
import { withCostContext } from "../cost_log";
import { anthropicClient, openaiClient } from "./providers";
import { buildResolver } from "./brand_resolve";
import type { AnswerCodes, CacheMeta, DictionaryEntry, Project } from "../types";

/**
 * The read-time context judge (2026-10-28, Tyler's go; the named successor in
 * CODING_DECISIONS section 6). Labels store brands as written, and ~10% of
 * name occurrences on the fixture resolve to nothing: maker-less products
 * ("Sapphire Reserve", "Freedom Unlimited"), plural and variant forms the
 * family matcher misses, and genuinely out-of-dictionary names. The judge
 * asks a small model ONCE per (project, name): given the category, the
 * tracked board and short excerpts where the name appeared, who offers it -
 * a tracked brand (product_of grain: a product, model, plan or variant of
 * that brand, never a sibling by the same parent), another company by name,
 * or null. The verdict stores the MAKER'S NAME, not an entry id, and the
 * maker resolves through the CURRENT dictionary at read time - so board
 * edits re-resolve every judged name without re-judging (the editability
 * principle), and a maker the board later rejects takes its products with it.
 *
 * Verdicts cache in llm_cache per (version, model, project, name); the
 * fixture and any keyless environment skip judging entirely and the views
 * byte-reproduce their unjudged output. A compute that leaves names unjudged
 * (cap, deadline, vendor failure) reports itself incomplete so the view is
 * not cached half-resolved - the per-name cache makes the next compute pay
 * only for the remainder.
 */

export const CONTEXT_JUDGE_MODEL = process.env.CONTEXT_JUDGE_MODEL ?? "gpt-6-luna";
export const CONTEXT_JUDGE_VERSION = "c3";
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000;
/** Most-frequent-first slab judged per compute; the rest waits for the next. */
const JUDGE_CAP = 300;
const DEADLINE_MS = 50_000;
const CONCURRENCY = 8;
const SNIPPET_CHARS = 160;

// c2 (round 2, measured on the c1 fixture census): three sentences for the
// defect classes the target lists showed, each the dictionary rounds' lesson
// restated - content never merges into its carrier, a parent's sibling
// device or app never merges into the tracked brand, a third party's add-on
// belongs to its own maker. c3 (round 3, declared the LAST prompt round):
// out-of-category products of a company that also sells a tracked brand are
// null - boards deliberately alias maker words into tracked entries, so a
// bare parent-company answer rolls the parent's whole portfolio into the
// tracked brand (c2 measured 720 occurrences on one tracker).
export const CONTEXT_JUDGE_SYSTEM =
  "You connect product names to the companies behind them. You are given a market category, " +
  "the brands a study tracks, one name found in AI shopping-advice answers, and short excerpts " +
  "where it appeared. Decide who offers the named product or service. Reply with ONLY a JSON " +
  'object {"maker": "..."}: the tracked brand the name belongs to - a product, model, plan, ' +
  "edition or variant of that brand, written exactly as listed; a different product sold by the " +
  "same parent company is NOT it, even when answers mention them together. If the name is a " +
  "product or service OUTSIDE the study's category whose maker also sells one of the tracked " +
  "brands, answer null, never that maker. A show, film, game, " +
  "channel or other piece of content is never a product of a service that carries it - answer " +
  "null for content titles. An add-on, plugin or extension another company builds for a tracked " +
  "brand's platform belongs to the company that builds it, not the platform. When the name " +
  "belongs to no tracked brand, answer the name of the company that offers it, or the name " +
  'itself when it is already a company. Answer {"maker": null} when the name is not a product ' +
  "or service, or you are not confident.";

function judgeKey(projectId: string, name: string): string {
  const norm = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `ctx_judge:${CONTEXT_JUDGE_VERSION}:${CONTEXT_JUDGE_MODEL}:${projectId}:${createHash("sha256").update(norm).digest("hex")}`;
}

/** Every brand-string field of a code row. Only the choice schema's
 * decision-rule choices are brand names; the enum schemas carry verdict
 * words (keep/leave, worth/cheaper, ...). */
export function* brandStringsOf(c: AnswerCodes): Generator<string> {
  for (const m of c.mentions ?? []) yield m.brand;
  if (c.top_pick) yield c.top_pick;
  for (const d of c.destinations ?? []) yield d;
  for (const r of c.redirect_to ?? []) yield r;
  for (const p of c.pairings ?? []) yield p.name;
  if (c.schema === "choice") for (const r of c.decision_rules ?? []) yield r.choice;
}

function keyConfigured(): boolean {
  return Boolean(CONTEXT_JUDGE_MODEL.startsWith("gpt-") ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY);
}

/** One verdict, no cache. Returns the maker name, null (judged: no maker),
 * or undefined (call failed - stays unjudged). */
export async function judgeContextName(
  input: { name: string; category: string; roster: string[]; snippets: string[] },
  model = CONTEXT_JUDGE_MODEL
): Promise<string | null | undefined> {
  const user =
    `Category: ${input.category}\n` +
    `Tracked brands:\n${input.roster.map((r) => `- ${r}`).join("\n")}\n` +
    `Name: "${input.name}"\n` +
    (input.snippets.length > 0 ? `Seen in answers:\n${input.snippets.map((s) => `"...${s}..."`).join("\n")}\n` : "") +
    `\nWho offers "${input.name}"?`;
  let text: string;
  if (model.startsWith("gpt-")) {
    const res = await openaiClient().chat.completions.create({
      model,
      messages: [
        { role: "system", content: CONTEXT_JUDGE_SYSTEM },
        { role: "user", content: user },
      ],
      max_completion_tokens: 2000,
      reasoning_effort: "none",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "maker",
          strict: true,
          schema: {
            type: "object",
            properties: { maker: { type: ["string", "null"] } },
            required: ["maker"],
            additionalProperties: false,
          },
        },
      },
    } as never);
    text = (res as { choices: { message?: { content?: string | null } }[] }).choices[0]?.message?.content ?? "";
  } else {
    const a = await anthropicClient();
    const res = await a.messages.create({
      model,
      max_tokens: 100,
      system: CONTEXT_JUDGE_SYSTEM,
      messages: [{ role: "user", content: user }],
    } as never);
    text = (res as { content: { type: string; text?: string }[] }).content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  }
  try {
    const m = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { maker?: unknown };
    if (m.maker === null) return null;
    if (typeof m.maker === "string" && m.maker.trim()) return m.maker.trim();
  } catch {
    /* unparseable - stays unjudged */
  }
  return undefined;
}

export interface JudgedNames {
  /** matchKey(name as written) -> the maker name the verdict stored. */
  judged: Map<string, string>;
  /** True when judgeable names remain unjudged (cap, deadline or failure):
   * the computed view must not be cached. */
  incomplete: boolean;
}

/**
 * Verdicts for every unknown name the codes carry: cached ones in one batch
 * read, then model calls for the most frequent misses (cap + deadline),
 * each grounded by up to two excerpts from answers that carried the name.
 * Fails open per name; a keyless environment judges nothing and is complete.
 */
export async function primeContextVerdicts(input: PrimeInput): Promise<JudgedNames> {
  const { judged, incomplete } = await judgeSlab(input, JUDGE_CAP);
  return { judged, incomplete };
}

interface PrimeInput {
  project: Project;
  dictionary: DictionaryEntry[];
  codes: AnswerCodes[];
  meta?: CacheMeta;
}

/**
 * Finalize-time warm (the review-phase contract applied to the views): judge
 * slab after slab until every unknown name has a cached verdict or the
 * deadline passes, so the first dashboard open after a coding wave reads
 * only cache. Each slab reads only its own snippet bodies. Stops early when
 * a slab judges nothing (vendor failing) - the views' lazy path picks up the
 * remainder. A keyless environment returns before any read.
 */
export async function prewarmContextVerdicts(
  input: PrimeInput,
  deadline: number
): Promise<{ judged: number; incomplete: boolean }> {
  if (input.codes.length === 0 || !keyConfigured()) return { judged: 0, incomplete: false };
  let total = 0;
  while (Date.now() < deadline) {
    const slab = await judgeSlab(input, JUDGE_CAP, deadline);
    total += slab.done;
    if (!slab.incomplete) return { judged: total, incomplete: false };
    if (slab.done === 0) break;
  }
  return { judged: total, incomplete: true };
}

/** One slab: cached verdicts, then up to `cap` model calls until the
 * deadline (default: DEADLINE_MS from the start of judging). `done` counts
 * the verdicts this slab added. */
async function judgeSlab(
  input: PrimeInput,
  cap: number,
  deadlineAt?: number
): Promise<JudgedNames & { done: number }> {
  const none = { judged: new Map<string, string>(), incomplete: false, done: 0 };
  if (input.codes.length === 0) return none;
  const resolve = buildResolver(input.dictionary);
  // Unknown names, with up to two carrying responses each for snippets.
  const unknown = new Map<string, { name: string; n: number; ids: string[] }>();
  for (const c of input.codes) {
    for (const raw of brandStringsOf(c)) {
      if (resolve(raw).status !== "unknown") continue;
      const k = matchKey(raw);
      const a = unknown.get(k) ?? { name: raw.trim(), n: 0, ids: [] };
      a.n++;
      if (a.ids.length < 2 && !a.ids.includes(c.response_id)) a.ids.push(c.response_id);
      unknown.set(k, a);
    }
  }
  if (unknown.size === 0) return none;

  const entries = [...unknown.entries()];
  const keys = entries.map(([, a]) => judgeKey(input.project.id, a.name));
  let cached: Map<string, string>;
  try {
    cached = await store.cacheGetMany(keys, CACHE_TTL_MS);
  } catch {
    cached = new Map();
  }
  const judged = new Map<string, string>();
  const misses: number[] = [];
  entries.forEach(([k], i) => {
    const hit = cached.get(keys[i]);
    if (hit === undefined) {
      misses.push(i);
      return;
    }
    try {
      const v = JSON.parse(hit) as { maker: string | null };
      if (v.maker) judged.set(k, v.maker);
    } catch {
      misses.push(i);
    }
  });
  if (misses.length === 0) return { judged, incomplete: false, done: 0 };
  if (!keyConfigured()) return { judged, incomplete: false, done: 0 };

  // Most frequent first; the slab beyond the cap stays for the next compute.
  misses.sort((a, b) => entries[b][1].n - entries[a][1].n);
  const slab = misses.slice(0, cap);

  // One batched body read for the slab's snippet sources.
  const ids = [...new Set(slab.flatMap((i) => entries[i][1].ids))];
  const bodies = new Map<string, string>();
  try {
    for (let k = 0; k < ids.length; k += 300) {
      for (const row of await store.getResponseTexts(ids.slice(k, k + 300))) bodies.set(row.id, row.text);
    }
  } catch {
    /* snippets are optional */
  }
  const snippetsOf = (a: { name: string; ids: string[] }): string[] => {
    const out: string[] = [];
    const needle = a.name.toLowerCase();
    for (const id of a.ids) {
      const text = bodies.get(id);
      if (!text) continue;
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      out.push(
        text
          .slice(Math.max(0, at - SNIPPET_CHARS), at + needle.length + SNIPPET_CHARS)
          .replace(/\s+/g, " ")
          .trim()
      );
    }
    return out;
  };

  const roster = input.dictionary
    .filter((e) => e.status === "active" && e.canonical !== "Other")
    .map((e) => e.canonical);
  const deadline = deadlineAt ?? Date.now() + DEADLINE_MS;
  let done = 0;
  await withCostContext({ purpose: "views:resolve", projectId: input.project.id }, async () => {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, slab.length) }, async () => {
        while (next < slab.length && Date.now() < deadline) {
          const i = slab[next++];
          const [k, a] = entries[i];
          try {
            const maker = await Promise.race([
              judgeContextName({ name: a.name, category: input.project.category, roster, snippets: snippetsOf(a) }),
              new Promise<undefined>((r) => setTimeout(() => r(undefined), 15_000).unref?.()),
            ]);
            if (maker === undefined) continue;
            done++;
            if (maker) judged.set(k, maker);
            await store.cacheSet(keys[i], JSON.stringify({ maker }), input.meta).catch(() => {});
          } catch (err) {
            console.error("context judge failed open:", err);
          }
        }
      })
    );
  });
  return { judged, incomplete: done < misses.length, done };
}
