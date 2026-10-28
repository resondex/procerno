import { createHash } from "node:crypto";
import { store } from "../store";
import { anthropicClient } from "./providers";
import { logCost, withCostContext } from "../cost_log";
import { fromAnthropicUsage } from "./usage";
import type { Project } from "../types";

/**
 * Reason groups (projects.code_groups) drafted by the engine (2026-10-28,
 * Tyler). Groups are a display rollup over the confirmed codebook - never a
 * labeling grain - and are DRAWN ONCE PER CONFIRMED CODEBOOK, never redrawn
 * wave to wave (CODING_DECISIONS section 12). The draft runs once, after the
 * codebook is ratified; a re-ratify with the same code list keeps the map,
 * a changed list draws a new one.
 *
 * Port of scripts/draft_code_groups.mts (the base prompt that drew the five
 * stored maps; the B1/B2 split rules were tested and rejected). One change of
 * input: the script read each code's share from coded answers, which do not
 * exist at confirmation time, so the engine reads the discovery census counts
 * the codebook proposal carries (proposal.codes[].incidence over
 * proposal.rows). A merge target shows its largest member's share (a lower
 * bound - row-level unions are not stored); a user-added code shows none.
 *
 * The reply is checked mechanically and repaired, never trusted: codes not in
 * the codebook are dropped, a code placed twice keeps its first group, codes
 * left out and one-code groups go to ungrouped. What was repaired is stored
 * with the map.
 */

export const CODE_GROUPS_MODEL =
  process.env.CODE_GROUPS_MODEL ?? "claude-opus-5-5";
/** Prompt/check era. Bump only when the drafting prompt changes meaning; an
 * existing map is never redrawn because of a bump (drawn once). */
export const CODE_GROUPS_VERSION = "g1";

export interface CodeGroupsMap {
  groups: { name: string; codes: string[]; why?: string }[];
  ungrouped?: string[];
  /** The confirmed code list this map was drawn from, sorted. */
  codes?: string[];
  drawn?: {
    at: string;
    source: "engine" | "seeded";
    model?: string;
    version?: string;
    /** Mechanical repairs applied to the model's reply. */
    repairs?: string[];
  };
}

export interface CodeInput {
  code: string;
  /** Census share of answers arguing it, 0-1; null when unmeasured. */
  incidence: number | null;
  scope: string;
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The confirmed codes with census share and scope sentence, from the
 * proposal and the ratify record. */
export function codebookInputs(
  project: Pick<
    Project,
    "reason_taxonomy" | "taxonomy_proposal" | "taxonomy_decision"
  >,
): {
  inputs: CodeInput[];
  answers: number | null;
} {
  let proposal: {
    rows?: number;
    codes?: { code: string; incidence?: number; why?: string }[];
  } = {};
  let decision: { merges?: Record<string, string[]> } = {};
  try {
    proposal = JSON.parse(project.taxonomy_proposal ?? "{}");
  } catch {
    // No proposal: codes go in with no share or scope.
  }
  try {
    decision = JSON.parse(project.taxonomy_decision ?? "{}");
  } catch {
    // No record: no merges.
  }
  const byCode = new Map((proposal.codes ?? []).map((c) => [norm(c.code), c]));
  const merges = new Map(
    Object.entries(decision.merges ?? {}).map(([t, m]) => [
      norm(t),
      m.map(norm),
    ]),
  );
  const inputs = project.reason_taxonomy.map((code): CodeInput => {
    const own = byCode.get(norm(code));
    if (own)
      return {
        code,
        incidence: typeof own.incidence === "number" ? own.incidence : null,
        scope: own.why ?? "",
      };
    const members = (merges.get(norm(code)) ?? [])
      .map((m) => byCode.get(m))
      .filter((m): m is NonNullable<typeof m> => !!m);
    if (members.length > 0) {
      const shares = members
        .map((m) => m.incidence)
        .filter((x): x is number => typeof x === "number");
      return {
        code,
        incidence: shares.length > 0 ? Math.max(...shares) : null,
        scope: members
          .map((m) => m.why)
          .filter(Boolean)
          .join("; "),
      };
    }
    return { code, incidence: null, scope: "" };
  });
  return {
    inputs,
    answers: typeof proposal.rows === "number" ? proposal.rows : null,
  };
}

/** The drafting prompt. SYSTEM is the base text of scripts/draft_code_groups.mts verbatim. */
export function codeGroupsPrompt(
  category: string,
  inputs: CodeInput[],
  answers: number | null,
): { system: string; user: string } {
  const system = [
    "You group a market's confirmed reason codes into display groups for an executive dashboard.",
    "Each code is an argument that AI answers make when a buyer chooses a product in this category. The dashboard shows each group as one row, counting an answer once if it argues from any of the group's codes, and lets the reader open a group to see its codes.",
    "",
    "Rules:",
    "- Make about 8 to 14 groups. A group gathers codes a reader would treat as one topic of argument.",
    "- Name each group in one to four plain words, in the buyer's own vocabulary, lowercase.",
    '- Every code appears exactly once: in one group, or in "ungrouped" when it fits no group. Copy code names exactly as written.',
    "- A group must hold at least two codes. A code that would be alone stays ungrouped.",
    "- Group by what is being argued, never by which brand or which buyer it suits.",
    "- No catch-all groups. If a group's name could describe the whole category, or its codes share no more than being about the product, split it or leave codes ungrouped. A group that most answers would hit tells the reader nothing.",
    "- Keep codes apart when buyers weigh them against each other.",
    "",
    'Reply with JSON only: {"groups":[{"name":"...","codes":["..."],"why":"one sentence on what ties these codes together"}],"ungrouped":["..."]}',
  ].join("\n");
  const pct = (x: number) => Math.round(x * 1000) / 10;
  const user = [
    `Category: ${category}`,
    `Answers counted: ${answers ?? "unknown"}`,
    "",
    "Confirmed codes (code | how often argued | what it covers):",
    ...inputs.map(
      (c) =>
        `- ${c.code} | ${c.incidence === null ? "not measured" : `argued in ${pct(c.incidence)}% of answers`} | ${c.scope || "(no description)"}`,
    ),
  ].join("\n");
  return { system, user };
}

/** Check and repair a reply against the confirmed list. */
export function repairDraft(
  raw: unknown,
  confirmed: string[],
): { map: CodeGroupsMap; repairs: string[] } {
  const repairs: string[] = [];
  const known = new Set(confirmed);
  const placed = new Set<string>();
  const r = (raw ?? {}) as { groups?: unknown; ungrouped?: unknown };
  const groups: CodeGroupsMap["groups"] = [];
  const ungrouped: string[] = [];
  const take = (c: unknown, where: string): string | null => {
    if (typeof c !== "string") return null;
    if (!known.has(c)) {
      repairs.push(`dropped "${c}" (not in the codebook) from ${where}`);
      return null;
    }
    if (placed.has(c)) {
      repairs.push(`"${c}" placed twice - kept its first place`);
      return null;
    }
    placed.add(c);
    return c;
  };
  for (const g of Array.isArray(r.groups) ? r.groups : []) {
    const name = typeof g?.name === "string" ? g.name.trim() : "";
    if (!name) continue;
    const codes = (Array.isArray(g.codes) ? g.codes : [])
      .map((c: unknown) => take(c, `"${name}"`))
      .filter((c: string | null): c is string => !!c);
    if (codes.length < 2) {
      if (codes.length === 1)
        repairs.push(`"${name}" held one code - ${codes[0]} left ungrouped`);
      ungrouped.push(...codes);
      continue;
    }
    groups.push({
      name,
      codes,
      ...(typeof g.why === "string" && g.why.trim()
        ? { why: g.why.trim() }
        : {}),
    });
  }
  for (const c of Array.isArray(r.ungrouped) ? r.ungrouped : []) {
    const k = take(c, "ungrouped");
    if (k) ungrouped.push(k);
  }
  for (const c of confirmed) {
    if (!placed.has(c)) {
      repairs.push(`"${c}" left out - placed ungrouped`);
      ungrouped.push(c);
    }
  }
  return { map: { groups, ungrouped }, repairs };
}

const sortedCodes = (codes: string[]) => [...new Set(codes)].sort();

/** True when a stored map was drawn from exactly this code list. A map with
 * no recorded list (pre-engine) counts as current when every code it groups
 * is still confirmed. */
export function mapIsCurrent(
  json: string | null,
  confirmed: string[],
): boolean {
  if (!json) return false;
  let m: CodeGroupsMap;
  try {
    m = JSON.parse(json);
  } catch {
    return false;
  }
  if (Array.isArray(m.codes))
    return (
      JSON.stringify(sortedCodes(m.codes)) ===
      JSON.stringify(sortedCodes(confirmed))
    );
  const known = new Set(confirmed);
  return (
    Array.isArray(m.groups) &&
    m.groups.every(
      (g) => Array.isArray(g.codes) && g.codes.every((c) => known.has(c)),
    )
  );
}

/** One drafting call, ledgered as codebook:groups. Spends ~$0.05 on Opus; never stores. */
export async function draftCodeGroups(
  project: Pick<
    Project,
    | "id"
    | "category"
    | "reason_taxonomy"
    | "taxonomy_proposal"
    | "taxonomy_decision"
  >,
): Promise<CodeGroupsMap> {
  return withCostContext(
    { purpose: "codebook:groups", projectId: project.id },
    async () => {
      const { inputs, answers } = codebookInputs(project);
      const { system, user } = codeGroupsPrompt(
        project.category ?? "",
        inputs,
        answers,
      );
      const anthropic = await anthropicClient();
      const stream = anthropic.messages.stream(
        {
          model: CODE_GROUPS_MODEL,
          max_tokens: 16000,
          output_config: { effort: "medium" },
          system,
          messages: [{ role: "user", content: user }],
        } as never,
        { timeout: 280_000 },
      );
      const res = await stream.finalMessage();
      logCost({
        model: CODE_GROUPS_MODEL,
        usage: fromAnthropicUsage((res as { usage?: unknown }).usage),
      });
      const text = (
        res as { content: { type: string; text?: string }[] }
      ).content
        .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
        .join("");
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      let raw: unknown = null;
      try {
        raw =
          start >= 0 && end > start
            ? JSON.parse(text.slice(start, end + 1))
            : null;
      } catch {
        raw = null;
      }
      if (!raw) throw new Error("code groups: reply was not JSON");
      const { map, repairs } = repairDraft(raw, project.reason_taxonomy);
      return {
        ...map,
        codes: sortedCodes(project.reason_taxonomy),
        drawn: {
          at: new Date().toISOString(),
          source: "engine",
          model: CODE_GROUPS_MODEL,
          version: CODE_GROUPS_VERSION,
          repairs,
        },
      };
    },
  );
}

/**
 * Draw the project's groups if its confirmed codebook has none yet. Runs
 * after the codebook is ratified (the route calls it in after()); safe to
 * call again - a current map, or another request already drafting, is a
 * no-op. Errors are logged, never thrown: groups are display only and the
 * reasons view shows the fine codes without them.
 */
export async function ensureCodeGroups(
  projectId: string,
): Promise<"current" | "drawn" | "busy" | "skipped" | "failed"> {
  const project = await store.getProject(projectId);
  if (
    !project ||
    project.taxonomy_status !== "ratified" ||
    project.reason_taxonomy.length < 3
  )
    return "skipped";
  if (
    mapIsCurrent(await store.getCodeGroups(projectId), project.reason_taxonomy)
  )
    return "current";
  const listHash = createHash("sha256")
    .update(JSON.stringify(sortedCodes(project.reason_taxonomy)))
    .digest("hex")
    .slice(0, 12);
  const claimKey = `code_groups_draft:${CODE_GROUPS_VERSION}:${projectId}:${listHash}`;
  // A claim succeeds when the key is absent, stale (10 min), or holds a
  // failure marker - so a failed draft can be retried at once, while a live
  // one is never doubled.
  const cur = await store.cacheGet(claimKey, 10 * 60 * 1000).catch(() => null);
  const expected = cur && cur.includes('"failed"') ? cur : null;
  const claimed = await store
    .cacheClaim(
      claimKey,
      expected,
      JSON.stringify({ __pending: Date.now() }),
      10 * 60 * 1000,
      {
        brand: project.brand,
        category: project.category,
        projectId,
      },
    )
    .catch(() => false);
  if (!claimed) return "busy";
  try {
    const map = await draftCodeGroups(project);
    // The codebook may have moved while the call ran; store only for the list it was drawn from.
    const now = await store.getProject(projectId);
    if (
      !now ||
      JSON.stringify(sortedCodes(now.reason_taxonomy)) !==
        JSON.stringify(map.codes)
    )
      return "skipped";
    if (mapIsCurrent(await store.getCodeGroups(projectId), now.reason_taxonomy))
      return "current";
    await store.setCodeGroups(projectId, JSON.stringify(map));
    return "drawn";
  } catch (e) {
    console.warn(
      `code groups for ${projectId} failed: ${e instanceof Error ? e.message : e}`,
    );
    // A failure marker: the next ratify (or a manual call) can claim over it.
    await store
      .cacheSet(claimKey, JSON.stringify({ failed: Date.now() }), { projectId })
      .catch(() => {});
    return "failed";
  }
}
