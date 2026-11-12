import { createHash } from "crypto";
import { tagCosts } from "../cost_log";
import { matchKey } from "../brand_key";
import { apiKeyConfigured, openaiClient } from "./providers";
import { store } from "../store";
import { PARENT_SUGGEST_MODEL } from "./models";
import type { DictionaryEntry, Project } from "../types";

/**
 * Parent-company suggestions for the brand dictionary's Parents tab
 * (2026-11-11). Sister brands should read as one portfolio; the tab had a
 * drag board but nothing ever proposed a parent, so it sat empty on every
 * tracker.
 *
 * One verdict per ACTIVE brand name - "the company that owns it, or none" -
 * cached per name (rules version + model + project + name hash), the
 * dict_suggest pattern: a name is judged once and never revisited; only
 * never-seen names reach the model, in one batched call per chunk.
 *
 * Free sources first: a tracker built in the setup wizard carries the
 * roster classifier's parent per configured rival and the client's own
 * parent on its draft (`rosterParents` / `clientParent`), linked back to the
 * project through the create route's `setup_created:<setupId>` row. Those
 * become verdicts with source "setup" - no model call.
 *
 * SERVED vs judged: a verdict is per name, a suggestion is a GROUP - a
 * parent shared by at least two active brands on the board (a lone brand
 * under a parent groups nothing). A brand that IS the owning company
 * (its own name keys to the group's parent) joins its group as a member.
 * Nothing is ever applied here: the tab's Accept posts `set_parent`.
 *
 * Keyless environments serve cached and setup verdicts only and never throw.
 * Ledger purpose dict:parents.
 */

// pr1 (2026-11-11): first rules. Bump when the prompt changes meaning; the
// per-name cache then re-judges names on next read (pennies a board).
export const PARENT_RULES_VERSION = "pr1";
/** The saved-tracker rule: a self-versioned verdict reads forever. */
const CACHE_TTL_MS = 100 * 365 * 24 * 3600 * 1000;
/** Names per model call. */
const CHUNK = 60;

const OTHER_CANONICAL = "Other";

export interface ParentVerdict {
  /** The owning company, or null (independent / is itself the company / unsure). */
  parent: string | null;
  source: "model" | "setup";
}

const nameHash = (name: string) =>
  createHash("sha256").update(name.trim().toLowerCase()).digest("hex");
export const parentCacheKey = (projectId: string, name: string, model = PARENT_SUGGEST_MODEL) =>
  `dict_parents:${PARENT_RULES_VERSION}:${model}:${projectId}:${nameHash(name)}`;

/** Legal-form words that never distinguish one company from another. */
const LEGAL = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd",
  "limited", "plc", "sa", "ag", "nv", "se", "gmbh", "lp", "llp", "bv", "spa", "ab",
]);

/** The key two spellings of one company share: case, punctuation, a
 * leading "the" and trailing legal-form words are noise. */
export function parentKey(raw: string): string {
  const toks = raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter(Boolean);
  if (toks[0] === "the" && toks.length > 1) toks.shift();
  while (toks.length > 1 && LEGAL.has(toks[toks.length - 1])) toks.pop();
  return matchKey(toks.join(" ")) || matchKey(raw);
}

const brandLabel = (e: DictionaryEntry) => e.display_name ?? e.canonical;

/** The board's brands a suggestion can place: active, not the Other bucket. */
export function suggestableBrands(entries: DictionaryEntry[]): DictionaryEntry[] {
  return entries.filter((e) => e.status === "active" && e.canonical !== OTHER_CANONICAL);
}

/** A verdict naming the brand itself (or one of its own forms) is no parent. */
function ownParent(e: DictionaryEntry, parent: string | null): string | null {
  if (!parent || !parent.trim()) return null;
  const pk = parentKey(parent);
  const own = [e.canonical, e.display_name ?? "", ...e.aliases].filter(Boolean).map(parentKey);
  return own.includes(pk) ? null : parent.trim().slice(0, 80);
}

export interface ParentGroupMember {
  id: string;
  name: string;
  /** The brand's parent on the board right now (null = none). */
  current: string | null;
  /** The brand is itself the owning company. */
  self?: boolean;
  /** The tracker's own brand. */
  you?: boolean;
}

export interface ParentGroup {
  /** parentKey of the parent - stable across spellings (dismiss memory). */
  key: string;
  /** The label Accept writes: an existing board label for this company when
   * one exists, else the most common suggested spelling. */
  parent: string;
  members: ParentGroupMember[];
  /** Member ids whose board parent is not already `parent` - what Accept posts. */
  apply: string[];
  /** The tracker's own brand is in the group (sister brands of the client). */
  you: boolean;
}

/**
 * Pure: verdicts per entry id -> the groups worth serving. A group needs at
 * least two members and at least one member not already under its label.
 */
export function buildParentGroups(
  brands: DictionaryEntry[],
  verdicts: Map<string, ParentVerdict>,
  targetKey: string | null = null
): ParentGroup[] {
  const byKey = new Map<string, { spellings: Map<string, number>; members: ParentGroupMember[] }>();
  const keyed = new Set<string>();
  const isYou = (e: DictionaryEntry) =>
    targetKey !== null && [e.canonical, ...e.aliases].some((f) => matchKey(f) === targetKey);
  for (const e of brands) {
    const v = verdicts.get(e.id);
    const parent = ownParent(e, v?.parent ?? null);
    if (!parent) continue;
    const k = parentKey(parent);
    const g = byKey.get(k) ?? { spellings: new Map<string, number>(), members: [] as ParentGroupMember[] };
    g.spellings.set(parent, (g.spellings.get(parent) ?? 0) + 1);
    g.members.push({ id: e.id, name: brandLabel(e), current: e.parent, ...(isYou(e) ? { you: true } : {}) });
    byKey.set(k, g);
    keyed.add(e.id);
  }
  // A brand that IS a group's company joins it (it has no parent of its own).
  for (const e of brands) {
    if (keyed.has(e.id)) continue;
    const own = new Set([e.canonical, e.display_name ?? "", ...e.aliases].filter(Boolean).map(parentKey));
    for (const [k, g] of byKey) {
      if (!own.has(k)) continue;
      g.members.push({ id: e.id, name: brandLabel(e), current: e.parent, self: true, ...(isYou(e) ? { you: true } : {}) });
      keyed.add(e.id);
      break;
    }
  }
  // Existing board labels win the display: Accept then joins that box.
  const boardLabels = new Map<string, Map<string, number>>();
  for (const e of brands) {
    if (!e.parent) continue;
    const k = parentKey(e.parent);
    const m = boardLabels.get(k) ?? new Map<string, number>();
    m.set(e.parent, (m.get(e.parent) ?? 0) + 1);
    boardLabels.set(k, m);
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

  const out: ParentGroup[] = [];
  for (const [k, g] of byKey) {
    if (g.members.length < 2) continue;
    const parent = boardLabels.has(k) ? top(boardLabels.get(k)!) : top(g.spellings);
    const apply = g.members.filter((m) => m.current !== parent).map((m) => m.id);
    if (apply.length === 0) continue;
    g.members.sort((a, b) => Number(!!b.self) - Number(!!a.self) || a.name.localeCompare(b.name));
    out.push({ key: k, parent, members: g.members, apply, you: g.members.some((m) => m.you) });
  }
  return out.sort((a, b) => Number(b.you) - Number(a.you) || b.members.length - a.members.length || a.parent.localeCompare(b.parent));
}

/** The model call, injectable for tests: names in -> owner per name
 * (null = none). Names it leaves out stay unjudged. */
export type ParentJudge = (category: string, names: string[]) => Promise<Map<string, string | null>>;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    parents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string" }, parent: { type: "string" } },
        required: ["name", "parent"],
      },
    },
  },
  required: ["parents"],
} as const;

/** No category- or brand-specific examples (operating rule, 2026-10-03). */
export function parentSystemPrompt(category: string): string {
  return (
    `You identify brand ownership for a market study of ${category}. ` +
    "For each brand name in the list, give the company that owns it today, by the short name the company is commonly known by.\n" +
    "Rules:\n" +
    "- Return the empty string when the brand is independent, when the brand is itself the owning company, or when you are not confident who owns it.\n" +
    "- Name the majority owner only - never a distributor, retailer, reseller, licensee, franchisee, minority investor or business partner, and never a company the brand merely sells through or alongside.\n" +
    "- When several brands in the list share an owner, spell that owner exactly the same way every time.\n" +
    "- Leave legal-form words off the owner's name.\n" +
    "- Return every brand exactly once, with its name exactly as given."
  );
}

const openaiJudge: ParentJudge = async (category, names) => {
  const res = await openaiClient().chat.completions.create({
    model: PARENT_SUGGEST_MODEL,
    // gpt-6 / gpt-5 family: no temperature, reasoning off, completion cap
    // (the discoveryParams lesson - an under-sized cap is spent thinking).
    ...(/^gpt-[5-9]/.test(PARENT_SUGGEST_MODEL)
      ? { max_completion_tokens: Math.max(2000, names.length * 40), reasoning_effort: "none" as const }
      : { temperature: 0, max_tokens: Math.max(2000, names.length * 40) }),
    messages: [
      { role: "system", content: parentSystemPrompt(category) },
      { role: "user", content: JSON.stringify(names) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "parents", strict: true, schema: SCHEMA } },
  });
  if (res.choices[0]?.finish_reason === "length") throw new Error(`parent batch truncated (${names.length} names)`);
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{"parents":[]}') as {
    parents?: { name?: string; parent?: string }[];
  };
  const out = new Map<string, string | null>();
  for (const r of parsed.parents ?? []) {
    if (typeof r.name !== "string") continue;
    const p = (r.parent ?? "").trim();
    out.set(r.name.trim().toLowerCase(), p ? p : null);
  }
  return out;
};

/** Parents the setup wizard already classified for this tracker, by
 * entry id: the roster's per-rival parent and the client's parent. Free -
 * a store read. Empty when the tracker has no linked draft. */
async function setupVerdicts(project: Project, brands: DictionaryEntry[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const setupId = await store.setupIdForProject(project.id, project.brand).catch(() => null);
  if (!setupId) return out;
  const draft = await store.getSetupDraft(setupId).catch(() => null);
  const wiz = (draft?.wizard ?? null) as { rosterParents?: Record<string, string>; clientParent?: string } | null;
  if (!wiz) return out;
  const byForm = new Map<string, string>();
  for (const [name, parent] of Object.entries(wiz.rosterParents ?? {})) byForm.set(matchKey(name), parent);
  if (wiz.clientParent) byForm.set(matchKey(project.brand), wiz.clientParent);
  if (byForm.size === 0) return out;
  for (const e of brands) {
    for (const f of [e.canonical, ...e.aliases]) {
      const p = byForm.get(matchKey(f));
      if (p === undefined) continue;
      // The roster writes the brand's own name for "independent".
      out.set(e.id, ownParent(e, p));
      break;
    }
  }
  return out;
}

export interface ParentSuggestions {
  groups: ParentGroup[];
  /** Active brands with no verdict yet (keyless, out of time, or read-only). */
  unjudged: number;
}

/**
 * Cache-first suggestions for one project. `allowModel` false = cached and
 * setup verdicts only (share-link viewers, read-only members). Never throws
 * on a model failure - the unjudged names simply stay unjudged.
 */
export async function suggestParents(
  project: Project,
  opts: { allowModel: boolean; deadlineMs?: number; judge?: ParentJudge } = { allowModel: false }
): Promise<ParentSuggestions> {
  const entries = await store.getDictionary(project.id);
  const brands = suggestableBrands(entries);
  const verdicts = new Map<string, ParentVerdict>();
  if (brands.length === 0) return { groups: [], unjudged: 0 };

  const keys = brands.map((e) => parentCacheKey(project.id, e.canonical));
  const hits = await store.cacheGetMany(keys, CACHE_TTL_MS);
  brands.forEach((e, i) => {
    const raw = hits.get(keys[i]);
    if (!raw) return;
    try {
      const v = JSON.parse(raw) as ParentVerdict;
      verdicts.set(e.id, { parent: v.parent ?? null, source: v.source === "setup" ? "setup" : "model" });
    } catch {
      /* a corrupt row is a miss */
    }
  });

  let missing = brands.filter((e) => !verdicts.has(e.id));
  if (missing.length > 0) {
    const seeds = await setupVerdicts(project, missing);
    for (const e of missing) {
      if (!seeds.has(e.id)) continue;
      const v: ParentVerdict = { parent: seeds.get(e.id) ?? null, source: "setup" };
      verdicts.set(e.id, v);
      await store
        .cacheSet(parentCacheKey(project.id, e.canonical), JSON.stringify(v), { brand: project.brand, category: project.category, projectId: project.id })
        .catch(() => {});
    }
    missing = brands.filter((e) => !verdicts.has(e.id));
  }

  const judge = opts.judge ?? (apiKeyConfigured() ? openaiJudge : null);
  if (missing.length > 0 && opts.allowModel && judge) {
    tagCosts({ projectId: project.id, purpose: "dict:parents" });
    for (let i = 0; i < missing.length; i += CHUNK) {
      if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) break;
      const chunk = missing.slice(i, i + CHUNK);
      try {
        const got = await judge(project.category, chunk.map((e) => e.canonical));
        for (const e of chunk) {
          const k = e.canonical.trim().toLowerCase();
          if (!got.has(k)) continue;
          const v: ParentVerdict = { parent: ownParent(e, got.get(k) ?? null), source: "model" };
          verdicts.set(e.id, v);
          await store.cacheSet(parentCacheKey(project.id, e.canonical), JSON.stringify(v), {
            brand: project.brand,
            category: project.category,
            projectId: project.id,
          });
        }
      } catch (err) {
        console.error(`parent suggestions: batch failed for ${project.id}:`, err);
      }
    }
  }

  return {
    groups: buildParentGroups(brands, verdicts, matchKey(project.brand)),
    unjudged: brands.filter((e) => !verdicts.has(e.id)).length,
  };
}

/** Pre-warm for a pipeline hop (cache-first, compute-only, log-never-throw).
 * Not wired anywhere yet - see the build report for the call sites. */
export async function prewarmParentSuggestions(projectId: string, deadlineMs: number): Promise<void> {
  try {
    const project = await store.getProject(projectId);
    if (!project) return;
    await suggestParents(project, { allowModel: true, deadlineMs });
  } catch (err) {
    console.error(`parent suggestions pre-warm failed for ${projectId}:`, err);
  }
}
