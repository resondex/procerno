import { buildResolver } from "./brand_resolve";
import { viewsOf, type ViewKey } from "./views";
import { cachedView, cell, corePanel, type RateCell, type ViewData } from "./view_data";
import type { AnswerCodes, Intent, Project, Run } from "../types";

/**
 * The reasons view (2026-10-27): per-code incidence of the confirmed reason
 * codes - the arguments an answer argues from, brand-agnostic - by question
 * type and, within a type, by its verdict. Each answer counts in ONE type,
 * the first view its cell routes to (premium_worth counts with the
 * headline). Awareness stages carry no reasons and are left out.
 *
 * Criteria rows are FENCED out of the pooled "arguments in play" column
 * (CODING_DECISIONS section 12): under the taught bar their reasons mean
 * taught, not argued. They keep their own type, read as criteria taught.
 *
 * code_groups (projects.code_groups, JSON {groups: [{name, codes}]}) is a
 * display rollup over the confirmed codes, never a labeling grain: a group's
 * incidence is the share of answers carrying ANY of its codes (deduped per
 * answer, like a dictionary family). Codes the map leaves out stay their own
 * rows; names the codebook does not hold are ignored.
 */

export type { RateCell };

export interface ReasonVerdict {
  key: string;
  label: string;
  answers: number;
}

export interface ReasonType {
  key: ViewKey;
  label: string;
  answers: number;
  /** Answers whose reasons list is empty. */
  noReason: number;
  verdicts: ReasonVerdict[];
}

export interface ReasonRow {
  /** The code, or the group's name on a group row. */
  key: string;
  label: string;
  isGroup: boolean;
  /** Member codes (a code row lists itself). */
  codes: string[];
  /** The group a code row belongs to, when the map places it. */
  group: string | null;
  /** Pooled over every type except criteria. */
  pooled: RateCell;
  byType: Partial<Record<ViewKey, RateCell>>;
  /** type -> verdict -> incidence among that verdict's answers. */
  byVerdict: Partial<Record<ViewKey, Record<string, RateCell>>>;
}

export interface ReasonsView {
  runId: string;
  source: string;
  brand: string;
  /** Answers in the pooled column (every type except criteria). */
  pooledAnswers: number;
  types: ReasonType[];
  codes: ReasonRow[];
  /** null when the project has no code_groups map. */
  groups: ReasonRow[] | null;
  /** Map entries that name no confirmed code. */
  unknownGroupCodes: string[];
}

const TYPE_ORDER: { key: ViewKey; label: string }[] = [
  { key: "headline", label: "Open choice" },
  { key: "head_to_head_entity", label: "Head-to-head" },
  { key: "head_to_head_class", label: "Head-to-head vs a class" },
  { key: "offensive_capture", label: "Rival leavers" },
  { key: "defensive_hold", label: "Your customers weighing a move" },
  { key: "repertoire", label: "Repertoire" },
  { key: "value", label: "Value" },
  { key: "doubt", label: "Buyers' worries" },
  { key: "keep_or_leave", label: "Customers' worries" },
  { key: "criteria_taught", label: "Criteria (taught)" },
  { key: "settled_business_case", label: "Business case" },
  { key: "settled_expansion", label: "Expansion" },
  { key: "settled_ecosystem", label: "Ecosystem" },
  { key: "settled_advocacy", label: "Advocacy" },
];

type Bucketer = { buckets: { key: string; label: string }[]; of: (c: AnswerCodes) => string };

const PICK = (resolve: ReturnType<typeof buildResolver>, targetKey: string): Bucketer => ({
  buckets: [
    { key: "you", label: "Picks you" },
    { key: "other", label: "Picks another" },
    { key: "none", label: "No single pick" },
  ],
  of: (c) => (c.outcome === "pick" && c.top_pick ? (resolve(c.top_pick).key === targetKey ? "you" : "other") : "none"),
});

const field = (
  name: "keep_or_leave" | "proceed_or_avoid" | "worth_it" | "relationship_verdict",
  buckets: { key: string; label: string }[],
  fallback: string
): Bucketer => ({
  buckets,
  of: (c) => {
    const v = c[name];
    return v && buckets.some((b) => b.key === v) ? v : fallback;
  },
});

const KEEP = field(
  "keep_or_leave",
  [
    { key: "keep", label: "Stay" },
    { key: "leave", label: "Leave" },
    { key: "undecided", label: "No side" },
  ],
  "undecided"
);
const SETTLED = field(
  "relationship_verdict",
  [
    { key: "strengthens", label: "Strengthens" },
    { key: "neutral", label: "Neutral" },
    { key: "weakens", label: "Weakens" },
  ],
  "neutral"
);

function bucketerFor(view: ViewKey, pick: Bucketer): Bucketer {
  switch (view) {
    case "headline":
    case "head_to_head_entity":
    case "head_to_head_class":
    case "offensive_capture":
    case "repertoire":
      return pick;
    case "defensive_hold":
    case "keep_or_leave":
      return KEEP;
    case "doubt":
      return field(
        "proceed_or_avoid",
        [
          { key: "proceed", label: "Go ahead" },
          { key: "avoid", label: "Avoid" },
          { key: "undecided", label: "No side" },
        ],
        "undecided"
      );
    case "value":
      return field(
        "worth_it",
        [
          { key: "yes", label: "Worth it" },
          { key: "depends", label: "Depends" },
          { key: "no", label: "Not worth it" },
        ],
        "depends"
      );
    case "settled_business_case":
    case "settled_expansion":
    case "settled_ecosystem":
    case "settled_advocacy":
      return SETTLED;
    default:
      return { buckets: [{ key: "all", label: "All" }], of: () => "all" };
  }
}

interface Coded {
  type: ViewKey;
  verdict: string;
  reasons: Set<string>;
}

/** Parse a code_groups record into group -> member codes, keeping only confirmed codes. */
export function parseCodeGroups(json: string | null | undefined, confirmed: Set<string>) {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const list = (raw as { groups?: unknown })?.groups;
  if (!Array.isArray(list)) return null;
  const groups: { name: string; codes: string[] }[] = [];
  const unknown: string[] = [];
  const placed = new Set<string>();
  for (const g of list) {
    const name = typeof g?.name === "string" ? g.name.trim() : "";
    if (!name || !Array.isArray(g.codes)) continue;
    const codes: string[] = [];
    for (const c of g.codes) {
      if (typeof c !== "string") continue;
      if (!confirmed.has(c)) unknown.push(c);
      else if (!placed.has(c)) {
        placed.add(c);
        codes.push(c);
      }
    }
    if (codes.length > 0) groups.push({ name, codes });
  }
  return { groups, unknown };
}

export function computeReasons(data: ViewData): ReasonsView {
  const { project, dictionary } = data;
  const resolve = buildResolver(dictionary);
  const targetKey = resolve(project.brand).key;
  const pick = PICK(resolve, targetKey);

  // Answer -> its type (first routed view), on the core panel.
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const intentOfPrompt = new Map<string, Intent>();
  for (const p of data.prompts) {
    const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
    if (it) intentOfPrompt.set(p.id, it);
  }
  const core = corePanel(data);
  const typeOf = new Map<string, ViewKey>();
  for (const r of data.responses) {
    const it = intentOfPrompt.get(r.prompt_id);
    if (!it || !core.has(r.model ?? data.run.model)) continue;
    const v = viewsOf(it.stage, it.angle)[0];
    if (v && TYPE_ORDER.some((t) => t.key === v)) typeOf.set(r.id, v);
  }

  const coded: Coded[] = [];
  for (const c of data.codes) {
    const type = typeOf.get(c.response_id);
    if (!type || c.reasons === null) continue;
    coded.push({ type, verdict: bucketerFor(type, pick).of(c), reasons: new Set(c.reasons) });
  }

  const types: ReasonType[] = TYPE_ORDER.flatMap(({ key, label }) => {
    const list = coded.filter((c) => c.type === key);
    if (list.length === 0) return [];
    return [
      {
        key,
        label,
        answers: list.length,
        noReason: list.filter((c) => c.reasons.size === 0).length,
        verdicts: bucketerFor(key, pick).buckets.map((b) => ({
          ...b,
          answers: list.filter((c) => c.verdict === b.key).length,
        })),
      },
    ];
  });

  const pooled = coded.filter((c) => c.type !== "criteria_taught");
  const has = (c: Coded, members: string[]) => members.some((m) => c.reasons.has(m));
  const rowOf = (key: string, label: string, members: string[], isGroup: boolean, group: string | null): ReasonRow => {
    const byType: ReasonRow["byType"] = {};
    const byVerdict: ReasonRow["byVerdict"] = {};
    for (const t of types) {
      const list = coded.filter((c) => c.type === t.key);
      byType[t.key] = cell(list.filter((c) => has(c, members)).length, list.length);
      byVerdict[t.key] = Object.fromEntries(
        t.verdicts.map((v) => {
          const vl = list.filter((c) => c.verdict === v.key);
          return [v.key, cell(vl.filter((c) => has(c, members)).length, vl.length)];
        })
      );
    }
    return {
      key,
      label,
      isGroup,
      codes: members,
      group,
      pooled: cell(pooled.filter((c) => has(c, members)).length, pooled.length),
      byType,
      byVerdict,
    };
  };

  // The confirmed codebook in its own order, plus any code an answer carries that it no longer lists.
  const confirmed = [...project.reason_taxonomy];
  const seen = new Set(confirmed);
  for (const c of coded)
    for (const r of c.reasons)
      if (!seen.has(r)) {
        seen.add(r);
        confirmed.push(r);
      }
  const parsed = parseCodeGroups(data.codeGroups, new Set(confirmed));
  const groupOf = new Map<string, string>();
  for (const g of parsed?.groups ?? []) for (const c of g.codes) groupOf.set(c, g.name);

  const codes = confirmed.map((c) => rowOf(c, c, [c], false, groupOf.get(c) ?? null));
  const groups = parsed
    ? [
        ...parsed.groups.map((g) => rowOf(`group:${g.name}`, g.name, g.codes, true, null)),
        ...codes.filter((c) => !groupOf.has(c.key)),
      ]
    : null;

  return {
    runId: data.run.id,
    source: data.source,
    brand: project.brand,
    pooledAnswers: pooled.length,
    types,
    codes,
    groups,
    unknownGroupCodes: parsed?.unknown ?? [],
  };
}

const REASONS_VERSION = "r1";
export function computeReasonsCached(run: Run, project: Project): Promise<ReasonsView | null> {
  return cachedView("reasons", REASONS_VERSION, run, project, computeReasons, { codeGroups: true });
}
