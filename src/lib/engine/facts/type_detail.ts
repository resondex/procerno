/**
 * "Question type detail" on the fact layer (FACT_LAYER_DESIGN_2026-11-17.md step 8): the per-question-type sections
 * under the Stations page - which should I get, spotting the problem / learning the category, head to head, rivals'
 * customers switching and your customers looking around, buyers' and customers' worries, price, premium vs basic,
 * habit, the settled customers and every argument in the codebook - built from the run's one fact book. Nothing here
 * counts answers: every rate is a fact (FactCell: the counts and the fact id) looked up from the book, every list a
 * selection (its id recorded under `sels`), every plain count of answers the measure "answers" (its id beside it as
 * `answersFact`). The old per-type view engines that counted these for themselves are deleted.
 *
 * Scopes follow the rulings: "which should I get" is the buyer cards' types (ruling 7: discovery + use case; What's
 * popular and Premium vs basic are their own rows and types); an argument "when another brand is picked" is another
 * pick of a brand in analysis (2); price shares are of every price answer (3); a brand outside of analysis is never
 * listed or counted as a brand (8); premise shares are of the answers that agree, partly agree or disagree (9); a pick
 * outside the category is its own share, never "no single pick" (12); a premium answer with no stance is its own share
 * (13); conditions are the run's one grouping (14), counted inside one question type at a time (10).
 *
 * The buyer filter (`request.room`) reaches the sections asked in one buyer's voice (which should I get, spotting the
 * problem, price, the arguments); the rest are computed on every buyer, as the page always showed them.
 */
import { createHash } from "node:crypto";
import { matchKey } from "../../brand_key";
import { ENGINES, engineDisplayLabel, engineFacets } from "../providers";
import { conditionKeysFor, conditionStemKey } from "../condition_groups";
import { excludedWords } from "../definition_overlap";
import { cachedView, condCache, requestOf, type ViewData, type ViewRequest } from "../view_data";
import type { DossierTheme } from "../reason_themes";
import type { HeadToHeadRow, HeadToHeadView, HeadToHeadViews, HeadToHeadSlice } from "../view_types";
import { roleOf } from "../view_types";
import type {
  AlternativesViews,
  AwarenessBlock,
  AwarenessSlice,
  AwarenessView,
  CaptorBrand,
  CaptureRow,
  CaptureSlice,
  DestinationRow,
  DoubtSlice,
  DoubtView,
  DoubtViews,
  EngineGroups,
  ExitRow,
  HeadlineBrand,
  HeadlineSlice,
  HeadlineView,
  HoldSlice,
  ListSels,
  PremiumSlice,
  PremiumView,
  ReasonRow,
  ReasonType,
  ReasonTypeKey,
  ReasonsView,
  RepertoireSlice,
  RepertoireView,
  Route,
  SettledNamed,
  SettledPairing,
  SettledSlice,
  SettledViews,
  StanceRow,
  ValueRow,
  ValueSlice,
  ValueView,
  WorryRow,
} from "../view_types";
import type { EngineFacets } from "../view_data";
import type { Project, Run } from "../../types";
import { sharedRunFacts, cardCondRows, WTB, type RunFacts } from "./overview_facts";
import { fc, parseFactId, type FactCell } from "./statements";
import type { AnswerFact, AnswerFactSet, QuestionType } from "./answer_facts";
import { cleanQuote } from "./slices";
import type { Scope } from "./fact";
import type { AnySelection, SelMember } from "./selections";

/** Bumped whenever the payload's shape or a number's meaning changes. */
// td2 (2026-11-18): a buyer filter's "how they solve it" groups (Spotting the problem) read the run-wide grouping of
// the block - the same grouping the unfiltered page uses - instead of grouping that buyer's quotes on their own.
export const TYPE_DETAIL_VERSION = "td2";

const enc = encodeURIComponent;
const TIER_LABEL: Record<string, string> = { free: "Free tiers", paid: "Paid tiers", both: "Free & paid" };
const MODE_LABEL: Record<string, string> = { search: "Search on", instinct: "Instinct only" };
const LABEL = new Map(ENGINES.map((e) => [e.id, engineDisplayLabel(e)]));

/* ------------------------------- the context ------------------------------- */

export interface Ctx {
  data: ViewData;
  rf: RunFacts;
  set: AnswerFactSet;
  T: string;
  /** The buyer filter: a buying situation, or undefined (every buyer). */
  room: string | undefined;
  request: ViewRequest;
  F: (m: string, s: string, sc: Scope) => FactCell;
  A: (sc: Scope) => { answers: number; answersFact: string };
  rows: (sc: Scope) => AnswerFact[];
  has: (sc: Scope) => boolean;
  subj: (key: string) => string;
  sel: (name: string, subject: string, sc: Scope, opts?: Record<string, unknown>) => AnySelection;
  role: (key: string) => HeadlineBrand["role"];
}

export function ctxOf(data: ViewData, rf: RunFacts, request: ViewRequest): Ctx {
  const { book, sel, set } = rf;
  const T = set.target.key;
  const entryById = new Map(data.dictionary.map((e) => [e.id, e]));
  const legacy = new Set(data.project.competitors.map(matchKey));
  return {
    data,
    rf,
    set,
    T,
    room: request.room,
    request,
    F: (m, s, sc) => fc(book, m, s, sc),
    A: (sc) => {
      const f = book.fact("answers", "ai", sc);
      return { answers: f.k, answersFact: f.id };
    },
    rows: (sc) => book.rows(sc),
    has: (sc) => book.rows(sc).length > 0,
    subj: (key) => (key === T ? "you" : key),
    sel: (name, subject, sc, opts = {}) => sel.selection(name, subject, sc, opts),
    role: (key) => roleOf(key, T, entryById.get(key) ?? null, legacy),
  };
}

const members = (s: AnySelection) => s.members as SelMember[];

/** A scope with the buyer filter applied (a room-pinned section). */
const pin = (c: Ctx, sc: Scope): Scope => (c.room !== undefined ? { ...sc, situation: c.room } : sc);

/** Coded-or-not honesty count (not a measure: a fact exists only for a coded answer): answers on the panel to
 * questions of these stages, in the room when pinned, with no code row. */
function uncodedOf(c: Ctx, stages: string[], pinned: boolean): number {
  const { data } = c;
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const prompts = new Set(
    data.prompts
      .filter((p) => {
        const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
        return !!it && stages.includes(it.stage) && (!pinned || c.room === undefined || it.situation === c.room);
      })
      .map((p) => p.id)
  );
  const coded = new Set(data.codes.map((x) => x.response_id));
  const panel = new Set(c.rf.engines);
  let u = 0;
  for (const r of data.responses) if (prompts.has(r.prompt_id) && panel.has(r.model ?? data.run.model) && !coded.has(r.id)) u++;
  return u;
}

/**
 * The by-engine rows of a section and the same rows pooled by AI company, tier and mode - every row its own fact
 * scope (the engine set narrows the answers; a company, a tier or a mode is a scope field).
 */
function engineRows<T extends { key: string; label: string; answers: number }>(
  c: Ctx,
  base: Scope,
  make: (sc: Scope, key: string, label: string) => T
): { byEngine: (T & EngineFacets)[]; byEngineGroups: EngineGroups<T & EngineFacets> } {
  const models = c.rf.engines.filter((m) => c.has({ ...base, engines: [m] }));
  const byEngine = models.map((m) => ({ ...make({ ...base, engines: [m] }, m, LABEL.get(m) ?? m), ...engineFacets(m) }));
  const facets = new Map(models.map((m) => [m, engineFacets(m)]));
  const group = (field: "vendor" | "tier" | "mode", label: (v: string) => string): (T & EngineFacets)[] => {
    const values = [...new Set(models.map((m) => facets.get(m)![field]))];
    return values.map((v) => {
      const ms = models.filter((m) => facets.get(m)![field] === v);
      const same = <K extends keyof EngineFacets>(f: K) => (ms.every((m) => facets.get(m)![f] === facets.get(ms[0])![f]) ? facets.get(ms[0])![f] : undefined);
      const key = `${field[0]}:${v}`;
      const lbl = label(v);
      return {
        ...make({ ...base, [field]: v }, key, lbl),
        vendor: (same("vendor") as string | undefined) ?? lbl,
        tier: same("tier") ?? "both",
        mode: same("mode") ?? facets.get(ms[0])!.mode,
      } as T & EngineFacets;
    });
  };
  return {
    byEngine,
    byEngineGroups: { vendor: group("vendor", (v) => v), tier: group("tier", (v) => TIER_LABEL[v] ?? v), mode: group("mode", (v) => MODE_LABEL[v] ?? v) },
  };
}

/** The buying situations a scope's answers are asked for, in setup order. */
function situationsOf(c: Ctx, sc: Scope): string[] {
  const present = new Set(c.rows(sc).map((f) => f.situation).filter((s): s is string => !!s));
  const out: string[] = [];
  for (const it of [...c.data.intents].sort((a, b) => a.seq - b.seq)) if (it.situation && present.has(it.situation) && !out.includes(it.situation)) out.push(it.situation);
  return out;
}

/* ------------------------------- which should I get ------------------------------- */

const OPEN_STAGES: QuestionType[] = ["discovery", "use_case", "social_validation", "premium_worth"];

function headline(c: Ctx): HeadlineView | null {
  const H = pin(c, WTB);
  if (!c.has(H)) return null;
  const { F, A, T } = c;
  const named = c.sel("named_brands", "you", H, { rankYou: true, top: 1000 });
  const list = [...members(named)];
  if (!list.some((b) => b.key === T)) list.push({ key: T, name: c.set.target.name, count: 0 });
  const brands: HeadlineBrand[] = list.map((b) => ({
    key: b.key,
    name: b.key === T ? c.set.target.name : b.name,
    role: c.role(b.key),
    mentioned: F("named", c.subj(b.key), H),
    recommended: F("recommended", c.subj(b.key), H),
    chosen: F("picked", c.subj(b.key), H),
    shareOfDecided: F("share_of_picks", c.subj(b.key), H),
    negative: F("negative", c.subj(b.key), H),
  }));
  brands.sort((a, b) => b.mentioned.k - a.mentioned.k || a.name.localeCompare(b.name));
  const slice = (sc: Scope, key: string, label: string): HeadlineSlice => ({
    key,
    label,
    ...A(sc),
    mentioned: F("named", "you", sc),
    recommended: F("recommended", "you", sc),
    chosen: F("picked", "you", sc),
    firmPickInCategory: F("commit_rate", "ai", sc),
  });
  // Each stage its own row and scope; What's popular and Premium vs basic are asked of every buyer (never pinned).
  const byStage = OPEN_STAGES.flatMap((st) => {
    if (c.room !== undefined && (st === "social_validation" || st === "premium_worth")) return [];
    const sc = pin(c, { types: [st] });
    return c.has(sc) ? [slice(sc, st, st)] : [];
  });
  const eng = engineRows(c, H, (sc, key, label) => slice(sc, key, label));
  const pick = F("slice_share", "ai/slice:v:outcome:pick", H);
  return {
    runId: c.data.run.id,
    source: c.data.source,
    brand: c.set.target.name,
    ...A(H),
    uncoded: uncodedOf(c, ["discovery", "use_case"], true),
    outcomes: { pick, conditional: F("outcome_conditional", "ai", H), no_pick: F("outcome_no_pick", "ai", H), clarification: F("outcome_clarification", "ai", H) },
    firmPick: pick,
    firmPickInCategory: F("commit_rate", "ai", H),
    picks: {
      inCategory: F("commit_rate", "ai", H),
      ruledOut: F("slice_share", "ai/slice:pickdict:rejected", H),
      pending: F("slice_share", "ai/slice:pickdict:pending", H),
      notInDictionary: F("slice_share", "ai/slice:pickdict:unknown", H),
    },
    brands,
    byStage,
    ...eng,
    sels: { brands: [named.id] },
  };
}

/* ------------------------------- awareness ------------------------------- */

/** The grouping context of an awareness block's quotes: its kind, the buyer filter and the engine set (the grouping
 * runs over that block's own answers). */
export function quoteCtx(kind: "routing" | "explainer", request: ViewRequest): string {
  const room = request.room !== undefined ? createHash("sha256").update(request.room).digest("hex").slice(0, 8) : "*";
  const eng = request.engines ? createHash("sha256").update(request.engines.join(",")).digest("hex").slice(0, 8) : "*";
  return `${kind}.${room}.${eng}`;
}

/**
 * Attach the "how they solve it" groups of an awareness block's adjacent-routed answers: the answers' cleaned quotes
 * keyed through the run's saved condition grouping for that block (condition_groups.ts, the same inputs as the old
 * awareness view, so the saved key map is read - no new call), the stem key where none is saved. Writes
 * AnswerFact.qgroups[ctx] on the set's own facts; idempotent.
 */
export async function attachQuoteGroups(set: AnswerFactSet, data: ViewData, kind: "routing" | "explainer", request: ViewRequest): Promise<string> {
  const ctx = quoteCtx(kind, request);
  const type: QuestionType = kind === "routing" ? "problem_recognition" : "category_education";
  const inBlock = (f: AnswerFact) => f.type === type && (request.room === undefined || kind !== "routing" || f.situation === request.room);
  const quotesOf = (facts: AnswerFact[]) => {
    const counts = new Map<string, number>();
    for (const f of facts) {
      if (!inBlock(f) || f.verdicts.category_routed !== "adjacent") continue;
      const q = cleanQuote(f.quote ?? "");
      if (q) counts.set(q, (counts.get(q) ?? 0) + 1);
    }
    return counts;
  };
  const counts = quotesOf(set.facts);
  const exclude = excludedWords([data.project.category]);
  // ONE grouping per block per run (ruling 14): the block's quotes over every buyer and the whole core panel, saved
  // once under the block's run-wide scope ("awareness:<kind>"). A buyer filter or an assistant subset looks its quotes
  // up in that grouping - its quotes are a subset of the run-wide block's by construction - so a narrowed request
  // groups a wording exactly as the unfiltered one does and never pays a new embedding call. (Until 2026-11-18 a buyer
  // filter grouped its own quotes under a per-buyer scope that was never saved, so every recompute of a filtered
  // view with a key present re-embedded them.)
  const narrowed = request.engines !== undefined || (request.room !== undefined && kind === "routing");
  const allSet = request.engines ? (await sharedRunFacts(data, {})).set : set;
  const inRunBlock = (f: AnswerFact) => f.type === type;
  const full = narrowed
    ? () => {
        const out = new Map<string, number>();
        for (const f of allSet.facts) {
          if (!inRunBlock(f) || f.verdicts.category_routed !== "adjacent") continue;
          const q = cleanQuote(f.quote ?? "");
          if (q) out.set(q, (out.get(q) ?? 0) + 1);
        }
        return out;
      }
    : null;
  const keys = await conditionKeysFor(counts, full, exclude, { purpose: "views:awareness", cache: condCache(data, `awareness:${kind}`) });
  for (const f of set.facts) {
    if (!inBlock(f) || f.verdicts.category_routed !== "adjacent") continue;
    const q = cleanQuote(f.quote ?? "");
    if (!q) continue;
    (f.qgroups ??= {})[ctx] = keys.get(q) ?? conditionStemKey(q, exclude);
  }
  return ctx;
}

async function awarenessBlock(c: Ctx, kind: "routing" | "explainer"): Promise<AwarenessBlock | null> {
  const type: QuestionType = kind === "routing" ? "problem_recognition" : "category_education";
  const S = kind === "routing" ? pin(c, { types: [type] }) : { types: [type] };
  if (!c.has(S)) return null;
  const { F, A } = c;
  const slice = (sc: Scope, key: string, label: string): AwarenessSlice => ({
    key,
    label,
    ...A(sc),
    routed: { category: F("routed_category", "ai", sc), adjacent: F("routed_adjacent", "ai", sc), none: F("routed_none", "ai", sc) } as Record<Route, FactCell>,
    namesYou: F("named", "you", sc),
    recommendsYou: F("recommended", "you", sc),
    pointsToProducts: F("slice_share", "ai/slice:recany", sc),
  });
  const rooms: AwarenessSlice[] =
    kind === "routing"
      ? [
          ...situationsOf(c, S).map((s) => slice({ ...S, situation: s }, s, s)),
          ...(c.room === undefined && c.has({ ...S, situation: null }) ? [slice({ ...S, situation: null }, "", "No room")] : []),
        ].sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label))
      : [];
  const named = c.sel("named_brands", "you", S, { rankYou: true, top: 12 });
  const topics = c.sel("arg_rank", "ai", S, { top: 10 });
  // "How they solve it": the adjacent answers' quotes in the run's saved grouping.
  const ctx = await attachQuoteGroups(c.set, c.data, kind, kind === "routing" ? c.request : c.request.engines ? { engines: c.request.engines } : {});
  const ADJ: Scope = { ...S, when: "v:category_routed:adjacent" };
  const qg = c.sel("quote_groups", "ai", S, { ctx, top: 8 });
  const groups = members(qg).map((g) => {
    const cell = F("slice_share", `ai/slice:qgroup:${enc(ctx)}:${enc(g.key)}`, ADJ);
    const p = parseFactId(cell.id);
    return { label: g.name, cell, ids: c.rf.book.answers(p.measure, p.subject, p.scope).hit.slice(0, 8).map((f) => f.responseId) };
  });
  const restExpr = ["quoted", ...members(qg).map((g) => `!qgroup:${enc(ctx)}:${enc(g.key)}`)].join("&");
  const keyed = [...new Set(c.rows(ADJ).map((f) => f.qgroups?.[ctx]).filter((k): k is string => !!k))];
  const eng = engineRows(c, S, (sc, key, label) => slice(sc, key, label));
  return {
    ...slice(S, kind, kind),
    view: kind,
    uncoded: uncodedOf(c, [type], kind === "routing"),
    rooms: rooms.length === 1 && rooms[0].key === "" ? [] : rooms,
    ...eng,
    brands: members(named).map((b) => ({ name: b.key === c.T ? c.set.target.name : b.name, you: b.key === c.T, named: F("named", c.subj(b.key), S), recommended: F("recommended", c.subj(b.key), S) })),
    topics: members(topics).map((t) => ({ code: t.key, cell: F("argues", `ai/arg:${t.key}`, S) })),
    without: {
      groups,
      rest: F("slice_share", `ai/slice:${restExpr}`, ADJ),
      noQuote: F("slice_share", "ai/slice:!quoted", ADJ),
      grouping: keyed.some((k) => k.startsWith("e:")) ? "embed" : "stems",
    },
    sels: { brands: [named.id], topics: [topics.id], "without.groups": [qg.id] },
  };
}

async function awareness(c: Ctx): Promise<AwarenessView | null> {
  const routing = await awarenessBlock(c, "routing");
  const explainer = c.room === undefined ? await awarenessBlock(c, "explainer") : null;
  if (!routing && !explainer) return null;
  return { runId: c.data.run.id, source: c.data.source, brand: c.set.target.name, category: c.data.project.category, routing, explainer };
}

/* ------------------------------- head to head ------------------------------- */

/** A condition row as a theme row of the head-to-head boundaries (no situation buckets): its share is the card's fact. */
function condTheme(c: Ctx, r: { label: string; share: FactCell; wall: boolean; routes: { name: string; n: number }[] }, withRoutes: boolean): DossierTheme & { fact: string } {
  const p = parseFactId(r.share.id);
  const hit = c.rf.book.answers(p.measure, p.subject, p.scope).hit;
  const seen = new Set<string>();
  const receipts: { responseId: string; find: string }[] = [];
  for (const f of hit) {
    if (receipts.length >= 5) break;
    if (seen.has(f.engine.id)) continue;
    seen.add(f.engine.id);
    const said = (f.conds ?? []).find((x) => p.subject.includes(x.unit))?.said ?? r.label;
    receipts.push({ responseId: f.responseId, find: said });
  }
  return {
    label: r.label,
    share: c.rf.book.fact(p.measure, p.subject, p.scope).text,
    fact: r.share.id,
    buckets: [],
    ...(r.wall ? { wall: true } : {}),
    receipts,
    ...(withRoutes && r.routes.length ? { routes: r.routes.map((x) => ({ name: x.name, share: "" })) } : {}),
  };
}

function headToHead(c: Ctx): HeadToHeadViews | null {
  const { F, A } = c;
  const kindView = (kind: "entity" | "class"): (HeadToHeadView & { byEngineGroups: EngineGroups<HeadToHeadSlice & EngineFacets>; sels: ListSels }) | null => {
    const type: QuestionType = kind === "entity" ? "comparison_entity" : "comparison_class";
    const E: Scope = { types: [type] };
    if (!c.has(E)) return null;
    const rivals = new Map<string, { name: string; resolved: boolean }>();
    for (const f of c.rows(E)) if (f.rival && !rivals.has(f.rival.key)) rivals.set(f.rival.key, { name: f.rival.name, resolved: !f.rival.key.startsWith("?") });
    const sels: ListSels = {};
    const rows: HeadToHeadRow[] = [...rivals.entries()].map(([key, r]) => {
      const sc: Scope = { ...E, rival: key };
      const other = c.sel("out_names", "ai", sc, { slice: "!pick:none&!pick:you&!pick:rival" });
      sels[`rows.${key}.otherPicks`] = [other.id];
      // The stated boundaries, on this matchup's card scope (one question type, ruling 10): toward rows send the pick to
      // you; away rows sending it to this rival, and away rows sending it elsewhere.
      const toward = cardCondRows(c.rf, c.data, sc, "toward");
      const away = r.resolved ? cardCondRows(c.rf, c.data, sc, "away") : [];
      const toRival = away.filter((a) => a.routes.some((x) => x.name === r.name));
      const elsewhere = away.filter((a) => !toRival.includes(a));
      return {
        key,
        rival: r.name,
        resolved: r.resolved,
        cells: new Set(c.rows(sc).map((f) => f.intentId)).size,
        ...A(sc),
        won: F("h2h_win", "you", sc),
        lost: F("h2h_win", "rival", sc),
        other: F("h2h_another", "ai", sc),
        undecided: F("h2h_no_pick", "ai", sc),
        winOfDecided: F("h2h_two_way", "you", sc),
        otherPicks: members(other).map((m) => ({ name: m.name, n: m.count })),
        ...(toward.length || away.length
          ? {
              conditions: {
                you: [],
                rival: [],
                elsewhere: [],
                themes: { you: toward.map((t) => condTheme(c, t, false)), rival: toRival.map((t) => condTheme(c, t, false)), elsewhere: elsewhere.map((t) => condTheme(c, t, true)) },
              },
            }
          : {}),
      };
    });
    rows.sort((a, b) => b.answers - a.answers || a.rival.localeCompare(b.rival));
    const eng = engineRows(c, E, (sc, key, label): HeadToHeadSlice => ({ key, label, ...A(sc), won: F("h2h_win", "you", sc), lost: F("h2h_win", "rival", sc), undecided: F("h2h_no_pick", "ai", sc) }));
    return {
      kind,
      brand: c.set.target.name,
      ...A(E),
      uncoded: uncodedOf(c, ["comparison"], false),
      overall: { won: F("h2h_win", "you", E), lost: F("h2h_win", "rival", E), other: F("h2h_another", "ai", E), undecided: F("h2h_no_pick", "ai", E), winOfDecided: F("h2h_two_way", "you", E) },
      rows,
      ...eng,
      sels,
    };
  };
  const entity = kindView("entity");
  const klass = kindView("class");
  if (!entity && !klass) return null;
  return { runId: c.data.run.id, source: c.data.source, brand: c.set.target.name, entity, class: klass };
}

/* ------------------------------- switching and looking around ------------------------------- */

function alternatives(c: Ctx): AlternativesViews | null {
  const { F, A, T } = c;
  const SW: Scope = { types: ["switching"] };
  const LA: Scope = { types: ["looking_around"] };
  const captureOf = (sc: Scope) => ({
    named: F("named", "you", sc),
    recommended: F("recommended", "you", sc),
    captured: F("picked", "you", sc),
    // Another brand: a pick of a brand in analysis that is neither you nor the brand the answer's own customer is leaving.
    anotherBrand: F("slice_share", "ai/slice:pick:in_analysis&!pick:you&!pick:rival", sc),
    sameBrand: F("slice_share", "ai/slice:pick:rival", sc),
    outside: F("slice_share", "ai/slice:pick:outside_category", sc),
    undecided: F("slice_share", "ai/slice:pick:none", sc),
  });
  let offensive: AlternativesViews["offensive"] = null;
  if (c.has(SW)) {
    const left = new Map<string, { key: string; name: string; resolved: boolean }>();
    for (const f of c.rows(SW)) {
      const k = f.rival ? f.rival.key : "generic";
      if (!left.has(k)) left.set(k, { key: k, name: f.rival ? f.rival.name : "No rival named", resolved: !!f.rival && !f.rival.key.startsWith("?") });
    }
    const rows: CaptureRow[] = [...left.values()].map((l) => {
      const sc: Scope = { ...SW, rival: l.key };
      const captors = c.sel("pick_brands", "ai", sc);
      return { key: l.key, rival: l.name, resolved: l.resolved, ...A(sc), ...captureOf(sc), captors: members(captors).map((m) => ({ name: m.name, n: m.count })), sels: { captors: [captors.id] } };
    });
    rows.sort((a, b) => b.answers - a.answers || a.rival.localeCompare(b.rival));
    const named = c.sel("named_brands", "you", SW, { rankYou: true, top: 1000 });
    const list = members(named);
    const picked = members(c.sel("pick_brands", "ai", SW));
    const keys = [...new Set([...list.map((b) => b.key), ...picked.map((b) => b.key), T])];
    const nameOf = (k: string) => (k === T ? c.set.target.name : list.find((b) => b.key === k)?.name ?? picked.find((b) => b.key === k)?.name ?? c.set.nameOf(k));
    const captors: CaptorBrand[] = keys
      .map((k) => ({ key: k, name: nameOf(k), role: c.role(k), named: F("named", c.subj(k), SW), chosen: F("picked", c.subj(k), SW), shareOfDecided: F("share_of_picks", c.subj(k), SW) }))
      .sort((a, b) => b.chosen.k - a.chosen.k || b.named.k - a.named.k || a.name.localeCompare(b.name));
    const outside = c.sel("out_names", "ai", SW, { top: 12 });
    const eng = engineRows(c, SW, (sc, key, label): CaptureSlice => ({ key, label, ...A(sc), named: F("named", "you", sc), captured: F("picked", "you", sc), undecided: F("slice_share", "ai/slice:pick:none", sc) }));
    offensive = {
      brand: c.set.target.name,
      ...A(SW),
      uncoded: uncodedOf(c, ["alternatives"], false),
      overall: captureOf(SW),
      rows,
      captors,
      outsidePicks: members(outside).map((m) => ({ name: m.name, n: m.count })),
      ...eng,
      sels: { captors: [named.id, c.sel("pick_brands", "ai", SW).id], outsidePicks: [outside.id] },
    };
  }
  let defensive: AlternativesViews["defensive"] = null;
  if (c.has(LA)) {
    const verdicts = (sc: Scope) => ({ keep: F("stay", "ai", sc), leave: F("leave", "ai", sc), undecided: F("customer_no_side", "ai", sc) });
    const when = (v: string): Scope => ({ ...LA, when: `v:keep_or_leave:${v}` });
    const dests = c.sel("sent_all", "ai", LA);
    const outside = c.sel("sent_outside", "ai", LA, { top: 12 });
    const destinations: DestinationRow[] = members(dests).map((m) => ({
      key: m.key,
      name: m.name,
      role: c.role(m.key),
      offered: F("sent_to", m.key, LA),
      onKeep: F("sent_to", m.key, when("keep")).k,
      onLeave: F("sent_to", m.key, when("leave")).k,
      onUndecided: F("sent_to", m.key, when("undecided")).k,
      by: { keep: F("sent_to", m.key, when("keep")), leave: F("sent_to", m.key, when("leave")), undecided: F("sent_to", m.key, when("undecided")) },
    }));
    const eng = engineRows(c, LA, (sc, key, label): HoldSlice => ({ key, label, ...A(sc), verdicts: verdicts(sc), offersExit: F("sent_to_any", "ai", sc) }));
    defensive = {
      brand: c.set.target.name,
      ...A(LA),
      uncoded: uncodedOf(c, ["alternatives"], false),
      verdicts: verdicts(LA),
      offersExit: F("sent_to_any", "ai", LA),
      offersExitBy: { keep: F("sent_to_any", "ai", when("keep")), leave: F("sent_to_any", "ai", when("leave")), undecided: F("sent_to_any", "ai", when("undecided")) },
      ownProduct: F("sent_own", "ai", LA),
      destinations,
      outsideDestinations: members(outside).map((m) => ({ name: m.name, n: m.count })),
      ...eng,
      sels: { destinations: [dests.id], outsideDestinations: [outside.id] },
    };
  }
  if (!offensive && !defensive) return null;
  return { runId: c.data.run.id, source: c.data.source, brand: c.set.target.name, offensive, defensive };
}

/* ------------------------------- worries ------------------------------- */

const STAGE_ORDER = ["objections", "churn_triggers", "renewal"];

function doubtKind<V extends string>(c: Ctx, kind: "objections" | "keep_or_leave"): DoubtView<V> | null {
  const { F, A } = c;
  const types: QuestionType[] = kind === "objections" ? ["objections"] : ["churn_triggers", "renewal"];
  const base: Scope = { types };
  if (!c.has(base)) return null;
  const VM: Record<string, string> = kind === "objections" ? { proceed: "go_ahead", avoid: "steer_clear", undecided: "buyer_no_side" } : { keep: "stay", leave: "leave", undecided: "customer_no_side" };
  const field = kind === "objections" ? "proceed_or_avoid" : "keep_or_leave";
  const verdicts = (sc: Scope) => Object.fromEntries(Object.entries(VM).map(([v, m]) => [v, F(m, "ai", sc)])) as Record<V, FactCell>;
  const premise = (sc: Scope) => ({ confirms: F("agrees", "ai", sc), mixed: F("partly_agrees", "ai", sc), rebuts: F("disagrees", "ai", sc) });
  const slice = (sc: Scope, key: string, label: string): DoubtSlice<V> => ({ key, label, ...A(sc), verdicts: verdicts(sc), confirms: F("agrees", "ai", sc), offersExit: F("sent_to_any", "ai", sc) });
  // One row per (stage, worry), each on its own scope; cells carrying no worry group under their stage.
  const seen = new Map<string, { stage: QuestionType; concern: string | null }>();
  for (const it of [...c.data.intents].sort((a, b) => a.seq - b.seq)) {
    if (!types.includes(it.stage as QuestionType)) continue;
    const k = `${it.stage}|${it.concern ?? ""}`;
    if (!seen.has(k)) seen.set(k, { stage: it.stage as QuestionType, concern: it.concern ?? null });
  }
  const rows: WorryRow<V>[] = [];
  for (const [k, w] of seen) {
    const sc: Scope = { types: [w.stage], worry: w.concern };
    if (!c.has(sc)) continue;
    const top = c.sel("sent_all", "ai", sc, { top: 4 });
    rows.push({ key: k, stage: w.stage, concern: w.concern ?? "", ...A(sc), verdicts: verdicts(sc), premise: premise(sc), offersExit: F("sent_to_any", "ai", sc), topExits: members(top).map((m) => ({ name: m.name, n: m.count })), sels: { topExits: [top.id] } });
  }
  rows.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || b.answers - a.answers || a.concern.localeCompare(b.concern));
  const vals = Object.keys(VM);
  const matrix = Object.fromEntries((["confirms", "mixed", "rebuts"] as const).map((p) => [p, verdicts({ ...base, when: `v:premise_verdict:${p}` })]));
  const offersExitBy = Object.fromEntries(vals.map((v) => [v, F("sent_to_any", "ai", { ...base, when: `v:${field}:${v}` })])) as Record<V, FactCell>;
  const exitSel = c.sel("sent_all", "ai", base);
  const exits: ExitRow<V>[] = members(exitSel).map((m) => ({
    key: m.key,
    name: m.name,
    role: c.role(m.key),
    offered: F("sent_to", m.key, base),
    by: Object.fromEntries(vals.map((v) => [v, F("sent_to", m.key, { ...base, when: `v:${field}:${v}` })])) as Record<V, FactCell>,
  }));
  const outside = c.sel("sent_outside", "ai", base, { top: 12 });
  const stages = STAGE_ORDER.filter((s) => c.has({ types: [s as QuestionType] }) && types.includes(s as QuestionType));
  const eng = engineRows(c, base, (sc, key, label) => slice(sc, key, label));
  return {
    kind,
    brand: c.set.target.name,
    ...A(base),
    uncoded: uncodedOf(c, types, false),
    stages,
    verdicts: verdicts(base),
    premise: premise(base),
    matrix: matrix as unknown as DoubtView<V>["matrix"],
    offersExit: F("sent_to_any", "ai", base),
    offersExitBy,
    ownProduct: F("sent_own", "ai", base),
    rows,
    exits,
    outsideExits: members(outside).map((m) => ({ name: m.name, n: m.count })),
    ...eng,
    byStage: stages.map((s) => slice({ types: [s as QuestionType] }, s, s)),
    sels: { exits: [exitSel.id], outsideExits: [outside.id] },
  };
}

function doubt(c: Ctx): DoubtViews | null {
  const objections = doubtKind<"proceed" | "avoid" | "undecided">(c, "objections");
  const keepOrLeave = doubtKind<"keep" | "leave" | "undecided">(c, "keep_or_leave");
  if (!objections && !keepOrLeave) return null;
  return { runId: c.data.run.id, source: c.data.source, brand: c.set.target.name, objections, keepOrLeave };
}

/* ------------------------------- price ------------------------------- */

/** Room -> the confirmed price line's counterpart (projects.setup_decision). */
function counterparts(json: string | null | undefined): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!json) return out;
  try {
    const decided = (JSON.parse(json) as { valueLines?: { decided?: Record<string, unknown> } }).valueLines?.decided ?? {};
    for (const [room, v] of Object.entries(decided)) {
      const cp = v && typeof v === "object" ? (v as { counterpart?: unknown }).counterpart : null;
      out.set(room, typeof cp === "string" ? cp : null);
    }
  } catch {
    // an unreadable record names no counterpart
  }
  return out;
}

function value(c: Ctx): ValueView | null {
  const { F, A } = c;
  const PR = pin(c, { types: ["pricing"] });
  if (!c.has(PR)) return null;
  const worth = (sc: Scope) => ({ yes: F("worth_yes", "ai", sc), depends: F("worth_depends", "ai", sc), no: F("worth_no", "ai", sc) });
  const cps = counterparts(c.data.setupDecision);
  const instead = (sc: Scope) => {
    const rivals = c.sel("instead_brands", "ai", sc);
    const own = c.set.ladder ? c.sel("own_options", "ai", sc) : null;
    const list = [...members(rivals).map((m) => ({ name: m.name, n: m.count, own: false })), ...(own ? members(own).map((m) => ({ name: m.name, n: m.count, own: true })) : [])].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    return { list, ids: [rivals.id, ...(own ? [own.id] : [])] };
  };
  const rowOf = (key: string, sc: Scope, rooms: string[], line: string | null, label: string): ValueRow => {
    const ins = instead(sc);
    return {
      key,
      label,
      rooms,
      line,
      counterpart: rooms.length === 1 ? cps.get(rooms[0]) ?? null : null,
      ...A(sc),
      worth: worth(sc),
      recommendsInstead: F("instead_rival", "ai", sc),
      ownRung: F("instead_own", "ai", sc),
      instead: ins.list,
      sels: { instead: ins.ids },
    };
  };
  const rooms: ValueRow[] = situationsOf(c, PR).map((s) => {
    const sc: Scope = { ...PR, situation: s };
    return rowOf(s, sc, [s], c.rows(sc)[0]?.line ?? null, s);
  });
  if (c.room === undefined && c.has({ ...PR, situation: null })) {
    const sc: Scope = { ...PR, situation: null };
    rooms.push(rowOf("", sc, [], c.rows(sc)[0]?.line ?? null, "No room"));
  }
  rooms.sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));
  const lineNames = [...new Set(c.rows(PR).map((f) => f.line).filter((l): l is string => !!l))];
  const lines = lineNames
    .map((l) => {
      const sc: Scope = { ...PR, line: l };
      return rowOf(l, sc, [...new Set(c.rows(sc).map((f) => f.situation ?? ""))], l, l);
    })
    .sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));
  const ins = instead(PR);
  const eng = engineRows(c, PR, (sc, key, label): ValueSlice => ({ key, label, ...A(sc), worth: worth(sc) }));
  return {
    runId: c.data.run.id,
    source: c.data.source,
    brand: c.set.target.name,
    ...A(PR),
    uncoded: uncodedOf(c, ["pricing"], true),
    worth: worth(PR),
    recommendsInstead: F("instead_rival", "ai", PR),
    ownRung: F("instead_own", "ai", PR),
    instead: ins.list,
    rooms,
    lines,
    ...eng,
    sels: { instead: ins.ids },
  };
}

/* ------------------------------- premium vs basic, habit ------------------------------- */

const STANCES = ["premium", "basic", "balanced", "none"] as const;

function premium(c: Ctx): PremiumView | null {
  const { F, A } = c;
  const P: Scope = { types: ["premium_worth"] };
  if (!c.has(P)) return null;
  const stance = (sc: Scope) => ({ premium: F("tier_premium", "ai", sc), basic: F("tier_basic", "ai", sc), balanced: F("tier_balanced", "ai", sc), none: F("tier_none", "ai", sc) });
  const byStance: StanceRow[] = STANCES.map((s) => {
    const sc: Scope = { ...P, when: `v:tier_stance:${s}` };
    const rec = c.sel("rec_brands", "you", sc, { rankYou: true, top: 8 });
    return {
      key: s,
      ...A(sc),
      share: F(`tier_${s}`, "ai", P),
      namesYou: F("named", "you", sc),
      recommendsYou: F("recommended", "you", sc),
      picksYou: F("picked", "you", sc),
      firmPick: F("slice_share", "ai/slice:v:outcome:pick", sc),
      recommended: members(rec).map((m) => ({ name: m.key === c.T ? c.set.target.name : m.name, you: m.key === c.T, n: m.count })),
      sels: { recommended: [rec.id] },
    };
  });
  const eng = engineRows(c, P, (sc, key, label): PremiumSlice => ({ key, label, ...A(sc), stance: stance(sc), picksYou: F("picked", "you", sc) }));
  return {
    runId: c.data.run.id,
    source: c.data.source,
    brand: c.set.target.name,
    category: c.data.project.category,
    ...A(P),
    uncoded: uncodedOf(c, ["premium_worth"], false),
    stance: stance(P),
    namesYou: F("named", "you", P),
    recommendsYou: F("recommended", "you", P),
    picksYou: F("picked", "you", P),
    firmPick: F("slice_share", "ai/slice:v:outcome:pick", P),
    byStance,
    ...eng,
  };
}

function repertoire(c: Ctx): RepertoireView | null {
  const { F, A } = c;
  const R: Scope = { types: ["repertoire"] };
  if (!c.has(R)) return null;
  const slice = (sc: Scope, key: string, label: string): RepertoireSlice => ({
    key,
    label,
    ...A(sc),
    // Stick = the pick is you; switch = any other pick, in the category or not (the Habit card's rule); open = no pick.
    verdict: { stick: F("slice_share", "ai/slice:pick:you", sc), switch: F("picks_other", "ai", sc), open: F("slice_share", "ai/slice:pick:none", sc) },
    recommendsYou: F("recommended", "you", sc),
    recommendsOther: F("slice_share", "ai/slice:rec:anyother", sc),
  });
  const switchTo = c.sel("pick_brands", "ai", R);
  const also = c.sel("rec_brands", "you", R, { top: 10 });
  const eng = engineRows(c, R, (sc, key, label) => slice(sc, key, label));
  return {
    ...slice(R, "all", "All"),
    runId: c.data.run.id,
    source: c.data.source,
    brand: c.set.target.name,
    uncoded: uncodedOf(c, ["repertoire"], false),
    switchTo: members(switchTo)
      .filter((m) => m.key !== c.T)
      .map((m) => ({ name: m.name, n: m.count })),
    alsoRecommended: members(also).map((m) => ({ name: m.name, n: m.count, share: F("recommended", m.key, R) })),
    ...eng,
    sels: { switchTo: [switchTo.id], alsoRecommended: [also.id] },
  };
}

/* ------------------------------- settled customers ------------------------------- */

function settled(c: Ctx): SettledViews | null {
  const { F, A } = c;
  const base = (stage: QuestionType) => {
    const sc: Scope = { types: [stage] };
    if (!c.has(sc)) return null;
    const red = c.sel("redirect_dests", "ai", sc, { top: 10 });
    const eng = engineRows(c, sc, (s2, key, label): SettledSlice => ({ key, label, ...A(s2), strengthens: F("relationship_strengthens", "ai", s2) }));
    // A redirect to a brand in analysis carries its fact; a name outside of analysis is listed by name only.
    const redirects: SettledNamed[] = members(red).map((m) =>
      m.key.startsWith("~") ? { name: m.name, role: "outside", n: m.count } : { name: m.name, role: c.role(m.key), n: m.count, share: F("redirected_to", c.subj(m.key), sc) }
    );
    return {
      sc,
      v: {
        ...A(sc),
        uncoded: uncodedOf(c, [stage], false),
        verdicts: { strengthens: F("relationship_strengthens", "ai", sc), neutral: F("relationship_neutral", "ai", sc), weakens: F("relationship_weakens", "ai", sc) },
        redirectsAny: F("redirected_any", "ai", sc),
        ownProduct: F("slice_share", "ai/slice:sentown", sc),
        redirects,
        ...eng,
        sels: { redirects: [red.id] } as ListSels,
      },
    };
  };
  const bc = base("business_case");
  const ex = base("expansion");
  const eco = base("ecosystem");
  const adv = base("advocacy");
  if (!bc && !ex && !eco && !adv) return null;
  const ps = eco ? c.sel("pairings", "ai", eco.sc, { top: 10 }) : null;
  return {
    runId: c.data.run.id,
    source: c.data.source,
    brand: c.set.target.name,
    businessCase: bc ? { ...bc.v, stage: "business_case", caseStrength: { strong: F("case_strong", "ai", bc.sc), hedged: F("case_hedged", "ai", bc.sc), undermined: F("case_undermined", "ai", bc.sc) } } : null,
    expansion: ex ? { ...ex.v, stage: "expansion", growth: { backs: F("growth_backs", "ai", ex.sc), neutral: F("growth_neutral", "ai", ex.sc), redirects: F("growth_redirects", "ai", ex.sc) } } : null,
    ecosystem:
      eco && ps
        ? {
            ...eco.v,
            stage: "ecosystem",
            pairsAny: F("slice_share", "ai/slice:npair:1-999", eco.sc),
            pairings: members(ps).map((m): SettledPairing => ({ name: m.name, role: m.key.startsWith("~") ? "outside" : c.role(m.key), n: m.count })),
            sels: { ...eco.v.sels, pairings: [ps.id] },
          }
        : null,
    advocacy: adv
      ? {
          ...adv.v,
          stage: "advocacy",
          caseStrength: { strong: F("case_strong", "ai", adv.sc), partial: F("case_partial", "ai", adv.sc), concedes: F("case_concedes", "ai", adv.sc) },
          premise: { confirms: F("agrees", "ai", adv.sc), mixed: F("partly_agrees", "ai", adv.sc), rebuts: F("disagrees", "ai", adv.sc) },
        }
      : null,
  };
}

/* ------------------------------- the arguments ------------------------------- */

interface ReasonTypeDef {
  key: ReasonTypeKey;
  label: string;
  types: QuestionType[];
  /** Asked in one buyer's voice (the buyer filter keeps the room's cells). */
  pinned: boolean;
  buckets: { key: string; label: string; when: string }[];
}

const PICK_B = [
  { key: "you", label: "Picks you", when: "pick:you" },
  // Ruling 2: "another brand is picked" = another pick of a brand in analysis.
  { key: "other", label: "Picks another", when: "pick:other" },
  { key: "none", label: "No single pick", when: "pick:none" },
];
const KEEP_B = [
  { key: "keep", label: "Stay", when: "v:keep_or_leave:keep" },
  { key: "leave", label: "Leave", when: "v:keep_or_leave:leave" },
  { key: "undecided", label: "No side", when: "v:keep_or_leave:undecided" },
];
const SETTLED_B = [
  { key: "strengthens", label: "Strengthens", when: "v:relationship_verdict:strengthens" },
  { key: "neutral", label: "Neutral", when: "v:relationship_verdict:neutral" },
  { key: "weakens", label: "Weakens", when: "v:relationship_verdict:weakens" },
];

export const REASON_TYPES: ReasonTypeDef[] = [
  { key: "headline", label: "Which should I get", types: ["discovery", "use_case"], pinned: true, buckets: PICK_B },
  { key: "headline:discovery", label: "Discovery", types: ["discovery"], pinned: true, buckets: PICK_B },
  { key: "headline:use_case", label: "Use-case fit", types: ["use_case"], pinned: true, buckets: PICK_B },
  { key: "social_validation", label: "What's popular", types: ["social_validation"], pinned: false, buckets: PICK_B },
  { key: "premium_worth", label: "Premium vs basic", types: ["premium_worth"], pinned: false, buckets: PICK_B },
  { key: "head_to_head_entity", label: "Head-to-head", types: ["comparison_entity"], pinned: false, buckets: PICK_B },
  { key: "head_to_head_class", label: "Head-to-head vs a class", types: ["comparison_class"], pinned: false, buckets: PICK_B },
  { key: "offensive_capture", label: "Rivals' leavers", types: ["switching"], pinned: false, buckets: PICK_B },
  { key: "defensive_hold", label: "Your customers weighing a move", types: ["looking_around"], pinned: false, buckets: KEEP_B },
  { key: "repertoire", label: "Habit - stick with you", types: ["repertoire"], pinned: false, buckets: PICK_B },
  {
    key: "value",
    label: "Value",
    types: ["pricing"],
    pinned: true,
    buckets: [
      { key: "yes", label: "Worth it", when: "v:worth_it:yes" },
      { key: "depends", label: "Depends", when: "v:worth_it:depends" },
      { key: "no", label: "Not worth it", when: "v:worth_it:no" },
    ],
  },
  {
    key: "doubt",
    label: "Buyers' worries",
    types: ["objections"],
    pinned: false,
    buckets: [
      { key: "confirms", label: "Agrees with the worry", when: "v:premise_verdict:confirms" },
      { key: "rebuts", label: "Rebuts the worry", when: "v:premise_verdict:rebuts" },
      { key: "mixed", label: "Mixed or no verdict", when: "v:premise_verdict:mixed" },
    ],
  },
  { key: "keep_or_leave", label: "Customers' worries", types: ["churn_triggers", "renewal"], pinned: false, buckets: KEEP_B },
  { key: "criteria_taught", label: "Criteria (taught)", types: ["criteria"], pinned: true, buckets: [{ key: "all", label: "All", when: "" }] },
  { key: "settled_business_case", label: "Business case", types: ["business_case"], pinned: false, buckets: SETTLED_B },
  { key: "settled_expansion", label: "Expansion", types: ["expansion"], pinned: false, buckets: SETTLED_B },
  { key: "settled_ecosystem", label: "What to use alongside you", types: ["ecosystem"], pinned: false, buckets: SETTLED_B },
  { key: "settled_advocacy", label: "Answering a critic", types: ["advocacy"], pinned: false, buckets: SETTLED_B },
];

/** Points by which a member code must lean each way for its group to read as mixed; smallest verdict group; the
 * smallest pooled incidence of a member that counts. */
const MIX_LEAN_PTS = 5;
const MIX_MIN_ANSWERS = 20;
const MIX_MIN_INCIDENCE = 0.02;

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
    for (const x of g.codes) {
      if (typeof x !== "string") continue;
      if (!confirmed.has(x)) unknown.push(x);
      else if (!placed.has(x)) {
        placed.add(x);
        codes.push(x);
      }
    }
    if (codes.length > 0) groups.push({ name, codes });
  }
  return { groups, unknown };
}

/** The scope of a reason type under this request (the arguments' schemas: answers carrying arguments only). */
const reasonScope = (c: Ctx, t: ReasonTypeDef): Scope => ({ types: t.types, ...(c.room !== undefined ? { situation: c.room } : {}), when: "args" });

function reasons(c: Ctx): ReasonsView | null {
  const { F, A } = c;
  // Under the buyer filter every type keeps that room's cells only (types asked of every buyer drop out).
  const live = REASON_TYPES.filter((t) => c.has(reasonScope(c, t)));
  if (live.length === 0) return null;
  const withWhen = (sc: Scope, when: string): Scope => (when ? { ...sc, when: `${sc.when}&${when}` } : sc);
  const types: ReasonType[] = live.map((t) => {
    const sc = reasonScope(c, t);
    return {
      key: t.key,
      label: t.label,
      ...A(sc),
      noReason: F("slice_share", "ai/slice:nargs:0-0", sc),
      verdicts: t.buckets.map((b) => ({ key: b.key, label: b.label, ...A(withWhen(sc, b.when)) })),
    };
  });
  // Pooled: every reason type but criteria (criteria answers list what to check rather than argue), each answer once.
  const pooledTypes = [...new Set(live.filter((t) => t.key !== "criteria_taught" && !t.key.startsWith("headline:")).flatMap((t) => t.types))];
  const POOLED: Scope | null = pooledTypes.length ? { types: pooledTypes, ...(c.room !== undefined ? { situation: c.room } : {}), when: "args" } : null;
  const confirmed = [...c.data.project.reason_taxonomy];
  const seen = new Set(confirmed);
  for (const t of live)
    for (const f of c.rows(reasonScope(c, t)))
      for (const a of f.args ?? [])
        if (!seen.has(a)) {
          seen.add(a);
          confirmed.push(a);
        }
  const parsed = parseCodeGroups(c.data.codeGroups, new Set(confirmed));
  const groupOf = new Map<string, string>();
  for (const g of parsed?.groups ?? []) for (const x of g.codes) groupOf.set(x, g.name);
  const subjOf = (codes: string[]) => (codes.length === 1 ? { m: "argues", s: `ai/arg:${codes[0]}` } : { m: "slice_share", s: `ai/slice:argany:${codes.map(enc).join(",")}` });
  const zero = { k: 0, n: 0, low: 0, high: 0 };
  const rowOf = (key: string, label: string, codes: string[], isGroup: boolean, group: string | null): ReasonRow => {
    const { m, s } = subjOf(codes);
    const byType: ReasonRow["byType"] = {};
    const byVerdict: ReasonRow["byVerdict"] = {};
    for (const t of live) {
      const sc = reasonScope(c, t);
      byType[t.key] = F(m, s, sc);
      byVerdict[t.key] = Object.fromEntries(t.buckets.map((b) => [b.key, F(m, s, withWhen(sc, b.when))]));
    }
    return { key, label, isGroup, codes, group, pooled: POOLED ? F(m, s, POOLED) : zero, byType, byVerdict, mixed: {} };
  };
  const codes = confirmed.map((x) => rowOf(x, x, [x], false, groupOf.get(x) ?? null));
  const codeRow = new Map(codes.map((r) => [r.key, r]));
  const share = (x: { k: number; n: number }) => (x.n > 0 ? x.k / x.n : 0);
  const groupRow = (g: { name: string; codes: string[] }) => {
    const row = rowOf(`group:${g.name}`, g.name, g.codes, true, null);
    for (const t of types) {
      const [a, b] = t.verdicts;
      if (!b || a.answers < MIX_MIN_ANSWERS || b.answers < MIX_MIN_ANSWERS) continue;
      const toward: string[] = [];
      const away: string[] = [];
      for (const code of g.codes) {
        const r = codeRow.get(code);
        const v = r?.byVerdict[t.key];
        if (!r || !v || share(r.pooled) < MIX_MIN_INCIDENCE) continue;
        const d = (share(v[a.key]) - share(v[b.key])) * 100;
        if (d >= MIX_LEAN_PTS) toward.push(code);
        else if (d <= -MIX_LEAN_PTS) away.push(code);
      }
      if (toward.length && away.length) row.mixed[t.key] = { toward, away };
    }
    return row;
  };
  const groups = parsed ? [...parsed.groups.map(groupRow), ...codes.filter((x) => !groupOf.has(x.key))] : null;
  const pooledA = POOLED ? A(POOLED) : { answers: 0, answersFact: undefined };
  return {
    runId: c.data.run.id,
    source: c.data.source,
    brand: c.set.target.name,
    pooledAnswers: pooledA.answers,
    pooledFact: pooledA.answersFact,
    types,
    codes,
    groups,
    unknownGroupCodes: parsed?.unknown ?? [],
  };
}

/* ------------------------------- the bundle ------------------------------- */

export interface TypeDetailBundle {
  version: string;
  headline: HeadlineView | null;
  awareness: AwarenessView | null;
  head_to_head: HeadToHeadViews | null;
  alternatives: AlternativesViews | null;
  doubt: DoubtViews | null;
  value: ValueView | null;
  repertoire: RepertoireView | null;
  premium: PremiumView | null;
  reasons: ReasonsView | null;
  settled: SettledViews | null;
}

export const SECTIONS = ["headline", "awareness", "head_to_head", "alternatives", "doubt", "value", "repertoire", "premium", "reasons", "settled"] as const;
export type SectionKey = (typeof SECTIONS)[number];

/** Every section for one request (buyer filter + engine set), from the run's one fact book. */
export async function computeTypeDetail(data: ViewData, request: ViewRequest = {}): Promise<TypeDetailBundle> {
  const rf = await sharedRunFacts(data, request.engines ? { engines: request.engines } : {});
  const c = ctxOf(data, rf, request);
  return {
    version: TYPE_DETAIL_VERSION,
    headline: headline(c),
    awareness: await awareness(c),
    head_to_head: c.room === undefined ? headToHead(c) : null,
    alternatives: c.room === undefined ? alternatives(c) : null,
    doubt: c.room === undefined ? doubt(c) : null,
    value: value(c),
    repertoire: c.room === undefined ? repertoire(c) : null,
    premium: c.room === undefined ? premium(c) : null,
    reasons: reasons(c),
    settled: c.room === undefined ? settled(c) : null,
  };
}

/** The bundle through the view cache (it reads the setup decision for the price lines and the code groups map). */
export function computeTypeDetailCached(run: Run, project: Project, request: ViewRequest = {}): Promise<TypeDetailBundle | null> {
  const r = requestOf(request, true);
  return cachedView("type_detail", TYPE_DETAIL_VERSION, run, project, (d) => computeTypeDetail(d, r), { setupDecision: true, codeGroups: true, judge: true }, r);
}
