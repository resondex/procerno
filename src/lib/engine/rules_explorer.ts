import { createHash } from "node:crypto";
import { buildResolver, type Resolved } from "./brand_resolve";
import { containsSeq, famTokens } from "./brand_family";
import { excludedWords } from "./definition_overlap";
import { conditionKeyMapLarge, conditionStemKey } from "./condition_groups";
import { cachedView, cell, corePanel, poolOf, type PoolRow, type RateCell, type ViewData } from "./view_data";
import { viewsOf, type ViewKey } from "./views";
import type { AnswerCodes, DictionaryEntry, Intent, Project, Run } from "../types";

/**
 * The decision-rules explorer (2026-10-30, WORKBENCH_REDESIGN_2026-10-30.md
 * item 2): across every rule-bearing answer on the core panel, which stated
 * conditions route the AI's answer to the client and which route it away.
 * The head-to-head conditions panel reads the same field per matchup; this
 * is the aggregate, with the rules x rooms join as its strategy read - which
 * buyer's circumstance matches the conditions the client wins on.
 *
 * Which answers feed it: every schema the v0.4 contract asks decision_rules
 * of - choice (open choice, head-to-heads, rival leavers, repertoire),
 * premium, value, objections, churn/renewal, holding your own (drc3), and
 * Set C expansion + ecosystem (drc3_setc). Awareness, criteria, business
 * case and advocacy carry none by design; a row whose decision_rules is
 * null (a source from before v0.4) is not rule-bearing and is left out.
 * Answers keep their question type as a pool, so the view can show one
 * question type at a time - pools are reported side by side, never summed
 * into a rate (the presentation rule).
 *
 * Each rule lands on one side:
 *   you       - the routed destination resolves to the client, or the rule
 *               takes the enum branch toward it (value "worth", churn and
 *               holding "keep", objections "proceed");
 *   away      - it resolves to another ACTIVE dictionary entry (B5: only
 *               active entries are in the category);
 *   elsewhere - anything else: a ruled-out or pending name, a name the
 *               dictionary and the context judge cannot place, or an enum
 *               branch away that names no destination ("a cheaper option").
 *               Kept visible - the maker-less lesson (CODING_DECISIONS 6).
 * Names resolve like a top pick (current dictionary + context-judge verdicts
 * at read time). Premium rules route to a tier, not a brand: they land by
 * their product when one is named and otherwise sit in elsewhere as the
 * tier, since whether the client IS the premium end is not a field.
 *
 * Grouping: ONE condition grouping per run across every pool, so identical
 * wording groups identically whatever question carried it (the per-view
 * precedent of head_to_head.ts, widened to the run). Embeddings-first with
 * the stem fallback whenever no OpenAI key is present - the fixture
 * reproduces byte-stably - through conditionKeyMapLarge (a whole run is
 * ~10K-25K distinct wordings; see condition_groups.ts). Rules are
 * deduplicated per answer by (side, resolved destination, condition group),
 * as in the conditions panel: drc2 repeats a condition once per product.
 */

export type { RateCell };

export type RuleSide = "you" | "away" | "elsewhere";

export type RulePool =
  | "open_choice"
  | "premium"
  | "head_to_head"
  | "rival_leavers"
  | "repertoire"
  | "value"
  | "holding"
  | "buyer_worries"
  | "customer_worries"
  | "expansion"
  | "ecosystem";

/** Question-type labels, the vocabulary of the other views. */
export const RULE_POOL_LABEL: Record<RulePool, string> = {
  open_choice: "Open choice",
  premium: "Premium vs basic",
  head_to_head: "Head-to-head",
  rival_leavers: "Rival leavers",
  repertoire: "Repertoire",
  value: "Value",
  holding: "Holding your own",
  buyer_worries: "Buyers' worries",
  customer_worries: "Customers' worries",
  expansion: "Expansion",
  ecosystem: "Ecosystem",
};

/** Views that can carry rules, premium_tier first so premium_worth answers
 * (which also count in the headline) take the premium pool - their rules
 * route to a tier, not a brand. */
const RULE_VIEWS: [ViewKey, RulePool][] = [
  ["premium_tier", "premium"],
  ["headline", "open_choice"],
  ["head_to_head_entity", "head_to_head"],
  ["head_to_head_class", "head_to_head"],
  ["offensive_capture", "rival_leavers"],
  ["repertoire", "repertoire"],
  ["value", "value"],
  ["defensive_hold", "holding"],
  ["doubt", "buyer_worries"],
  ["keep_or_leave", "customer_worries"],
  ["settled_expansion", "expansion"],
  ["settled_ecosystem", "ecosystem"],
];

export interface NamedCount {
  name: string;
  n: number;
}

/** Shares are over rule-bearing answers in scope (the whole view, a pool, a
 * room or a rival): answers stating at least one rule of the kind. */
export interface SideRates {
  toYou: RateCell;
  away: RateCell;
  elsewhere: RateCell;
}

export interface PoolTotals extends SideRates {
  pool: RulePool;
  label: string;
  /** Rule-bearing answers (decision_rules asked, [] included). */
  answers: number;
  /** Answers whose decision_rules is [] - the answer routes unconditionally. */
  unconditional: number;
  /** Stated rules before the per-answer dedup. */
  rules: number;
}

export interface RuleGroup {
  /** Stable within a computed view: side + condition group. */
  id: string;
  /** The condition group shared across sides (a contested condition
   * appears on more than one side with the same cond). */
  cond: string;
  side: RuleSide;
  /** The group's most frequent surface wording. */
  label: string;
  /** Rules after the per-answer dedup. */
  rules: number;
  /** Distinct answers stating it. */
  answers: number;
  /** answers / every rule-bearing answer in the view. */
  share: RateCell;
  /** Where it routes: for `you`, the client's products as the answers name
   * them; otherwise the resolved destination names. Top 4. */
  routes: NamedCount[];
  /** Per question type: answers, plus up to 3 sample response ids. */
  pools: { pool: RulePool; answers: number; ids: string[] }[];
  /** Head-to-head answers stating it, per rival (RivalRules.key). */
  rivals: { key: string; answers: number }[];
  /** Room-pinned answers stating it, per room (intent.situation). */
  rooms: { room: string; answers: number }[];
  /** Up to 5 sample response ids. */
  ids: string[];
}

/** One condition group's standing inside a slice (a room or a rival). */
export interface SliceGroup {
  id: string;
  label: string;
  /** Answers in the slice stating it. */
  answers: number;
  /** answers / the slice's rule-bearing answers. */
  share: RateCell;
  /** Slice share over the group's view-wide share; null when either is 0. */
  lift: number | null;
  routes: NamedCount[];
  /** Up to 5 sample response ids from the slice. */
  ids: string[];
}

/** A room or a rival: its rule-bearing answers and the condition groups
 * that dominate each side inside it. */
export interface SliceRules extends SideRates {
  key: string;
  label: string;
  /** Head-to-head kind, rivals only. */
  kind?: "entity" | "class";
  /** False when the rival named by the cell is not an active entry. */
  resolved?: boolean;
  answers: number;
  rules: number;
  /** Rule-bearing answers per question type. */
  pools: { pool: RulePool; answers: number }[];
  win: SliceGroup[];
  lose: SliceGroup[];
}

export interface RulesView {
  runId: string;
  source: string;
  brand: string;
  /** "embeddings" or the deterministic stem fallback. */
  grouping: "embeddings" | "stems";
  /** Rule-bearing answers on the core panel. */
  answers: number;
  unconditional: number;
  /** Stated rules before / after the per-answer dedup. */
  rules: number;
  kept: number;
  /** Answers in a rule-bearing question type with no code row yet. */
  uncoded: number;
  overall: SideRates;
  pools: PoolTotals[];
  /** Groups stated by 2+ answers, top GROUP_CAP per side. */
  groups: RuleGroup[];
  /** Groups per side not listed (stated once, or past the cap). */
  more: Record<RuleSide, { groups: number; answers: number }>;
  /** The rules x rooms join, rooms by rule-bearing answers. */
  rooms: SliceRules[];
  /** Head-to-head rivals (entity, then class). */
  rivals: SliceRules[];
}

const GROUP_CAP = 150;
const MIN_ANSWERS = 2;
const ID_CAP = 5;
const POOL_ID_CAP = 3;
const SLICE_TOP = 3;

const ENUM_TOWARD = new Set(["worth", "keep", "proceed"]);
const GENERIC_AWAY: Record<string, string> = {
  premium: "A premium option (none named)",
  basic: "A basic option (none named)",
  cheaper: "A cheaper option (none named)",
  leave: "Leaving (no destination named)",
  avoid: "Steering away (no alternative named)",
};

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);

/** The class brand a class cell names: the longest active entry form in the
 * cell's text, the client excluded (the head-to-head view's rule). */
function classBrandOf(
  intent: Intent,
  forms: { seq: string[]; entry: DictionaryEntry }[],
  targetKey: string
): DictionaryEntry | null {
  const hay = famTokens(intent.text);
  let best: { seq: string[]; entry: DictionaryEntry } | null = null;
  for (const f of forms) {
    if (f.entry.id === targetKey) continue;
    if (containsSeq(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
  }
  return best?.entry ?? null;
}

type Rule = NonNullable<AnswerCodes["decision_rules"]>[number];

interface Destination {
  side: RuleSide;
  /** Identity for the dedup and the routes tally. */
  key: string;
  /** How the routes tally names it. */
  name: string;
}

interface Acc {
  side: RuleSide;
  ck: string;
  rules: number;
  answers: Set<string>;
  surfaces: Map<string, number>;
  routes: Map<string, NamedCount>;
  pools: Map<RulePool, { answers: Set<string>; ids: string[] }>;
  rivals: Map<string, Set<string>>;
  rooms: Map<string, { answers: Set<string>; ids: string[] }>;
  ids: string[];
}

/** A slice's denominators while scanning. */
interface SliceAcc {
  label: string;
  kind?: "entity" | "class";
  resolved?: boolean;
  answers: Set<string>;
  rules: number;
  sides: Record<RuleSide, Set<string>>;
  pools: Map<RulePool, number>;
}

const freshSlice = (label: string): SliceAcc => ({
  label,
  answers: new Set(),
  rules: 0,
  sides: { you: new Set(), away: new Set(), elsewhere: new Set() },
  pools: new Map(),
});

const sideRates = (s: Record<RuleSide, Set<string>>, n: number): SideRates => ({
  toYou: cell(s.you.size, n),
  away: cell(s.away.size, n),
  elsewhere: cell(s.elsewhere.size, n),
});

const labelOf = (surfaces: Map<string, number>) =>
  [...surfaces.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || (x[0] < y[0] ? -1 : 1))[0][0];

const topNamed = (m: Map<string, NamedCount>, cap: number): NamedCount[] =>
  [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, cap);

export async function computeRules(data: ViewData): Promise<RulesView> {
  const { project, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged);
  const target = resolve(project.brand);
  const targetKey = target.key;

  // Every rule-bearing question type's coded answers, each answer once.
  const rows: { row: PoolRow; pool: RulePool }[] = [];
  const taken = new Set<string>();
  for (const [view, pool] of RULE_VIEWS) {
    for (const row of poolOf(data, view).rows) {
      if (taken.has(row.code.response_id)) continue;
      taken.add(row.code.response_id);
      rows.push({ row, pool });
    }
  }
  // Uncoded: answers in those question types on the core panel with no row.
  const ruleViews = new Set(RULE_VIEWS.map(([v]) => v));
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const ruleCellPrompts = new Set(
    data.prompts
      .filter((p) => {
        const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
        return it && viewsOf(it.stage, it.angle).some((v) => ruleViews.has(v));
      })
      .map((p) => p.id)
  );
  const core = corePanel(data);
  const coded = new Set(data.codes.map((c) => c.response_id));
  let uncoded = 0;
  for (const r of data.responses) {
    if (ruleCellPrompts.has(r.prompt_id) && core.has(r.model ?? data.run.model) && !coded.has(r.id)) uncoded++;
  }

  const bearing = rows.filter((x) => x.row.code.decision_rules != null);

  // ONE grouping over the whole run's conditions.
  const exclude = excludedWords([project.category]);
  const condCounts = new Map<string, number>();
  for (const { row } of bearing) {
    for (const rule of row.code.decision_rules!) {
      const c = rule.condition.trim();
      if (c) condCounts.set(c, (condCounts.get(c) ?? 0) + 1);
    }
  }
  const condKeys = await conditionKeyMapLarge(condCounts, exclude);
  const grouping: RulesView["grouping"] = [...condKeys.values()].some((k) => k.startsWith("e:")) ? "embeddings" : "stems";
  const keyOf = (c: string) => condKeys.get(c) ?? conditionStemKey(c, exclude);

  // Head-to-head rival per cell (entity: the angle; class: the class brand).
  const forms: { seq: string[]; entry: DictionaryEntry }[] = [];
  for (const e of dictionary) {
    if (e.status !== "active") continue;
    for (const f of [e.canonical, ...e.aliases]) forms.push({ seq: famTokens(f), entry: e });
  }
  const rivalMemo = new Map<string, { key: string; name: string; kind: "entity" | "class"; resolved: boolean } | null>();
  const rivalOf = (intent: Intent) => {
    if (rivalMemo.has(intent.id)) return rivalMemo.get(intent.id)!;
    let out: { key: string; name: string; kind: "entity" | "class"; resolved: boolean } | null = null;
    if (intent.stage === "comparison") {
      if (intent.angle === "class") {
        const e = classBrandOf(intent, forms, targetKey);
        out = e
          ? { key: `class:${e.id}`, name: e.display_name ?? e.canonical, kind: "class", resolved: true }
          : { key: `class:?${intent.id}`, name: intent.text, kind: "class", resolved: false };
      } else {
        const r = resolve(intent.angle);
        out = r.status === "active"
          ? { key: `entity:${r.key}`, name: r.name, kind: "entity", resolved: true }
          : { key: `entity:${r.key}`, name: intent.angle, kind: "entity", resolved: false };
      }
    }
    rivalMemo.set(intent.id, out);
    return out;
  };

  const byName = (r: Resolved, written: string): Destination =>
    r.key === targetKey
      ? { side: "you", key: targetKey, name: written.trim() || target.name }
      : r.status === "active"
        ? { side: "away", key: r.key, name: r.name }
        : { side: "elsewhere", key: r.key, name: r.name };

  /** Where one rule routes, by its schema's choice vocabulary. */
  const destinationOf = (rule: Rule, schema: string): Destination => {
    const choice = rule.choice.trim();
    const product = rule.product?.trim();
    // Brand-valued choices: the choice schema and Set C's two rule stages.
    if (schema === "choice" || schema === "expansion" || schema === "ecosystem") return byName(resolve(choice), choice);
    if (product) return byName(resolve(product), product);
    if (ENUM_TOWARD.has(choice)) return { side: "you", key: targetKey, name: target.name };
    const generic = GENERIC_AWAY[choice];
    if (generic) return { side: "elsewhere", key: `~${choice}`, name: generic };
    return byName(resolve(choice), choice);
  };

  const groups = new Map<string, Acc>();
  const overallSides: Record<RuleSide, Set<string>> = { you: new Set(), away: new Set(), elsewhere: new Set() };
  const poolAcc = new Map<RulePool, { answers: number; unconditional: number; rules: number; sides: Record<RuleSide, Set<string>> }>();
  const rooms = new Map<string, SliceAcc>();
  const rivals = new Map<string, SliceAcc>();
  let rules = 0;
  let kept = 0;
  let unconditional = 0;

  for (const { row, pool } of bearing) {
    const { code, intent } = row;
    const id = code.response_id;
    const dr = code.decision_rules!;
    let p = poolAcc.get(pool);
    if (!p) {
      p = { answers: 0, unconditional: 0, rules: 0, sides: { you: new Set(), away: new Set(), elsewhere: new Set() } };
      poolAcc.set(pool, p);
    }
    p.answers++;
    p.rules += dr.length;
    rules += dr.length;
    const room = intent.situation ?? null;
    const rival = rivalOf(intent);
    const slices: SliceAcc[] = [];
    if (room) {
      let s = rooms.get(room);
      if (!s) { s = freshSlice(room); rooms.set(room, s); }
      slices.push(s);
    }
    if (rival) {
      let s = rivals.get(rival.key);
      if (!s) { s = { ...freshSlice(rival.name), kind: rival.kind, resolved: rival.resolved }; rivals.set(rival.key, s); }
      slices.push(s);
    }
    for (const s of slices) {
      s.answers.add(id);
      s.rules += dr.length;
      s.pools.set(pool, (s.pools.get(pool) ?? 0) + 1);
    }
    if (dr.length === 0) {
      unconditional++;
      p.unconditional++;
      continue;
    }
    const schema = code.schema;
    const seen = new Set<string>();
    for (const rule of dr) {
      const condition = rule.condition.trim();
      if (!condition) continue;
      const d = destinationOf(rule, schema);
      const ck = keyOf(condition);
      const dedup = `${d.side}|${d.key}|${ck}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      kept++;
      overallSides[d.side].add(id);
      p.sides[d.side].add(id);
      for (const s of slices) s.sides[d.side].add(id);

      const gk = `${d.side}|${ck}`;
      let a = groups.get(gk);
      if (!a) {
        a = {
          side: d.side, ck, rules: 0, answers: new Set(), surfaces: new Map(), routes: new Map(),
          pools: new Map(), rivals: new Map(), rooms: new Map(), ids: [],
        };
        groups.set(gk, a);
      }
      a.rules++;
      a.surfaces.set(condition, (a.surfaces.get(condition) ?? 0) + 1);
      const rk = d.side === "you" ? d.name.toLowerCase() : d.key;
      const rt = a.routes.get(rk) ?? { name: d.name, n: 0 };
      rt.n++;
      a.routes.set(rk, rt);
      if (a.answers.has(id)) continue;
      a.answers.add(id);
      if (a.ids.length < ID_CAP) a.ids.push(id);
      let ap = a.pools.get(pool);
      if (!ap) { ap = { answers: new Set(), ids: [] }; a.pools.set(pool, ap); }
      ap.answers.add(id);
      if (ap.ids.length < POOL_ID_CAP) ap.ids.push(id);
      if (rival) {
        const set = a.rivals.get(rival.key) ?? new Set<string>();
        set.add(id);
        a.rivals.set(rival.key, set);
      }
      if (room) {
        let ar = a.rooms.get(room);
        if (!ar) { ar = { answers: new Set(), ids: [] }; a.rooms.set(room, ar); }
        ar.answers.add(id);
        if (ar.ids.length < ID_CAP) ar.ids.push(id);
      }
    }
  }

  const total = bearing.length;
  const idOf = (a: Acc) => `${a.side}:${shortHash(a.ck)}`;
  const accs = [...groups.values()];

  const outGroups: RuleGroup[] = [];
  const more: RulesView["more"] = { you: { groups: 0, answers: 0 }, away: { groups: 0, answers: 0 }, elsewhere: { groups: 0, answers: 0 } };
  for (const side of ["you", "away", "elsewhere"] as RuleSide[]) {
    const ranked = accs
      .filter((a) => a.side === side)
      .sort((a, b) => b.answers.size - a.answers.size || b.rules - a.rules || (a.ck < b.ck ? -1 : 1));
    ranked.forEach((a, i) => {
      if (a.answers.size < MIN_ANSWERS || i >= GROUP_CAP) {
        more[side].groups++;
        more[side].answers += a.answers.size;
        return;
      }
      outGroups.push({
        id: idOf(a),
        cond: shortHash(a.ck),
        side,
        label: labelOf(a.surfaces),
        rules: a.rules,
        answers: a.answers.size,
        share: cell(a.answers.size, total),
        routes: topNamed(a.routes, 4),
        pools: [...a.pools.entries()]
          .map(([pool, v]) => ({ pool, answers: v.answers.size, ids: v.ids }))
          .sort((x, y) => y.answers - x.answers),
        rivals: [...a.rivals.entries()]
          .map(([key, set]) => ({ key, answers: set.size }))
          .sort((x, y) => y.answers - x.answers),
        rooms: [...a.rooms.entries()]
          .map(([room, v]) => ({ room, answers: v.answers.size }))
          .sort((x, y) => y.answers - x.answers),
        ids: a.ids,
      });
    });
  }

  /** The dominant groups of one side inside a slice. Rooms carry their own
   * sample ids; a rival slice's samples come from the group's rival set. */
  const sliceGroups = (
    side: RuleSide,
    n: number,
    inSlice: (a: Acc) => { answers: number; ids: string[] } | null
  ): SliceGroup[] =>
    accs
      .filter((a) => a.side === side)
      .map((a) => ({ a, hit: inSlice(a) }))
      .filter((x): x is { a: Acc; hit: { answers: number; ids: string[] } } => !!x.hit && x.hit.answers > 0)
      .sort((x, y) => y.hit.answers - x.hit.answers || y.a.answers.size - x.a.answers.size || (x.a.ck < y.a.ck ? -1 : 1))
      .slice(0, SLICE_TOP)
      .map(({ a, hit }) => {
        const inShare = n > 0 ? hit.answers / n : 0;
        const all = total > 0 ? a.answers.size / total : 0;
        return {
          id: idOf(a),
          label: labelOf(a.surfaces),
          answers: hit.answers,
          share: cell(hit.answers, n),
          lift: inShare > 0 && all > 0 ? Math.round((inShare / all) * 100) / 100 : null,
          routes: topNamed(a.routes, 3),
          ids: hit.ids,
        };
      });

  const sliceOut = (key: string, s: SliceAcc, inSlice: (a: Acc) => { answers: number; ids: string[] } | null): SliceRules => {
    const n = s.answers.size;
    return {
      key,
      label: s.label,
      ...(s.kind && { kind: s.kind }),
      ...(s.resolved !== undefined && { resolved: s.resolved }),
      answers: n,
      rules: s.rules,
      ...sideRates(s.sides, n),
      pools: [...s.pools.entries()].map(([pool, answers]) => ({ pool, answers })).sort((x, y) => y.answers - x.answers),
      win: sliceGroups("you", n, inSlice),
      lose: sliceGroups("away", n, inSlice),
    };
  };

  const roomRules = [...rooms.entries()]
    .map(([room, s]) =>
      sliceOut(room, s, (a) => {
        const r = a.rooms.get(room);
        return r ? { answers: r.answers.size, ids: r.ids } : null;
      })
    )
    .sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));

  const rivalRules = [...rivals.entries()]
    .map(([key, s]) =>
      sliceOut(key, s, (a) => {
        const set = a.rivals.get(key);
        return set ? { answers: set.size, ids: [...set].slice(0, ID_CAP) } : null;
      })
    )
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "entity" ? -1 : 1) || b.answers - a.answers || a.label.localeCompare(b.label));

  const pools: PoolTotals[] = RULE_VIEWS.map(([, pool]) => pool)
    .filter((pool, i, all) => all.indexOf(pool) === i && poolAcc.has(pool))
    .map((pool) => {
      const p = poolAcc.get(pool)!;
      return {
        pool,
        label: RULE_POOL_LABEL[pool],
        answers: p.answers,
        unconditional: p.unconditional,
        rules: p.rules,
        ...sideRates(p.sides, p.answers),
      };
    });

  return {
    runId: data.run.id,
    source: data.source,
    brand: project.brand,
    grouping,
    answers: total,
    unconditional,
    rules,
    kept,
    uncoded,
    overall: sideRates(overallSides, total),
    pools,
    groups: outGroups,
    more,
    rooms: roomRules,
    rivals: rivalRules,
  };
}

// ru1 (2026-10-30): first version - one run-wide grouping, context-judged names.
const RULES_VERSION = "ru1";
export function computeRulesCached(run: Run, project: Project): Promise<RulesView | null> {
  return cachedView("rules", RULES_VERSION, run, project, computeRules, { judge: true });
}
