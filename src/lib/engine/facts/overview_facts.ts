/**
 * The Overview on the fact layer (FACT_LAYER_DESIGN_2026-11-17.md, step 5): the brand summary and the detectors'
 * inputs, every number a fact (a FactCell: counts, range and fact id) looked up from the run's one fact book. Nothing
 * here counts answers itself: it chooses which facts to look up (a selection - which brands, which buying situations,
 * which worries) and looks them up.
 *
 * Rulings that land here:
 *  - 7: the Overview's "when buyers ask what to buy" base is the buyer cards' types (discovery + use case), never
 *    What's popular or Premium vs basic - the headline numbers, the picks board, the funnel, the casting inputs, the
 *    by-engine and by-mode splits, the argument lift and every per-buyer and per-question read.
 *  - 2: an argument "when another brand is picked" is another pick of a brand in analysis.
 *  - 3: a price answer points to a rival, else to only the brand's own cheaper option, else nowhere - shares of ALL
 *    price answers, one bucket each.
 *  - 8: share of picks is out of picks of brands in analysis; a pick outside of analysis and a pick outside the
 *    category are their own buckets ("picks leave the category" = outside the category).
 *  - 9: "agrees the worry is fair" is out of the answers that agree, partly agree or disagree.
 *  - 10: a condition finding is counted inside one question type - the What to buy card's own rows (away_condition) and
 *    one lost matchup card's own exception rows (assigned_exception).
 *
 * Every RateCell in the views this builds is a FactCell (the shapes the detectors, the Brief's legacy paths and the
 * dossiers read are kept).
 */
import { matchKey } from "../../brand_key";
import { ENGINES, engineDisplayLabel } from "../providers";
import { roleOf } from "../view_types";
import { computeMemo, coreOf, facetsOf, type PoolRow, type ViewData, type ViewRequest } from "../view_data";
import type { AnswerRef } from "../analysis_types";
import type { BrandSummaryView, SummaryBrand, SummarySlice, ReasonLift } from "../brand_summary";
import type { InsightInputs } from "../summary_insights";
import type { ValueRow, ValueView, InsteadEntry, Worth, DoubtView, ObjectionVerdict, StayVerdict, WorryRow, Premise, AlternativesViews, CaptureRow, CaptorBrand, DestinationRow, SettledViews, SettledBase } from "../view_types";
import { buildAnswerFacts, type AnswerFact, type AnswerFactSet, type QuestionType } from "./answer_facts";
import { attachConditions } from "./conditions";
import { factBook, WHAT_TO_BUY_ALL, type FactBook, type Scope } from "./fact";
import { attachProducts } from "./products";
import { selectionBook, type AnySelection, type SelMember } from "./selections";
import { fc, parseDerived, parseFactId, type FactCell } from "./statements";
import { OVERVIEW_FLOORS as OF } from "./measure_book";
import { isWallWording } from "../wall_wording";
import { isDefaultCondition } from "../condition_groups";
import { containsSeq, famTokens } from "../brand_family";

/* ------------------------------- the run's facts ------------------------------- */

export interface RunFacts {
  set: AnswerFactSet;
  book: FactBook;
  sel: ReturnType<typeof selectionBook>;
  themed: boolean;
  /** response id -> the coded answer with its cell and engine (examples, quotes). */
  rowById: Map<string, PoolRow>;
  /** The engines the set counts, in core-panel order. */
  engines: string[];
}

const runFactsMemo = computeMemo<RunFacts>("run_facts");

/** The run's answer facts, fact book and selection book, once per load and engine set - shared by the brand summary,
 * the Map and its cards. Reads the run's saved condition grouping and themes only (no model call). */
export function sharedRunFacts(data: ViewData, eng: ViewRequest): Promise<RunFacts> {
  const e: ViewRequest = eng.engines ? { engines: eng.engines } : {};
  return runFactsMemo.get(data, e, async (d) => {
    const set = buildAnswerFacts(d, e.engines ? { engines: e.engines } : {});
    attachProducts(set, d.project.category);
    const { themed } = await attachConditions(set, d, { map: false });
    const book = factBook(set);
    const sel = selectionBook(set, book, d);
    const intentById = new Map(d.intents.map((i) => [i.id, i]));
    const promptIntent = new Map(d.prompts.map((p) => [p.id, p.intent_id ? intentById.get(p.intent_id) : undefined]));
    const respOf = new Map(d.responses.map((r) => [r.id, r]));
    const codeOf = new Map(d.codes.map((c) => [c.response_id, c]));
    const rowById = new Map<string, PoolRow>();
    for (const f of set.facts) {
      const code = codeOf.get(f.responseId)!;
      const it = promptIntent.get(respOf.get(f.responseId)!.prompt_id)!;
      rowById.set(f.responseId, { code, intent: it, model: f.engine.id });
    }
    const present = new Set(set.facts.map((f) => f.engine.id));
    const engines = [...coreOf(d, e)].filter((m) => present.has(m));
    return { set, book, sel, themed, rowById, engines };
  });
}

/* ------------------------------- example answers ------------------------------- */

/** The answer's own wording to highlight for a fact about a brand: its first written form, else its pick, else the
 * quote. */
function brandFind(r: PoolRow, set: AnswerFactSet, key: string): string {
  for (const m of r.code.mentions ?? []) if (set.resolve(m.brand).key === key) return quoteWith(r, m.brand);
  if (r.code.top_pick && set.resolve(r.code.top_pick).key === key) return quoteWith(r, r.code.top_pick);
  return (r.code.quote ?? "").trim();
}
const quoteWith = (r: PoolRow, form: string) => {
  const q = (r.code.quote ?? "").trim();
  return q && q.toLowerCase().includes(form.toLowerCase()) ? q : form;
};

/** Up to `k` answers behind a fact's numerator: one per assistant first, response-id order (the summary's old rule). */
export function refsFor(rf: RunFacts, ref: string, k = 5): AnswerRef[] {
  if (parseDerived(ref)) return [];
  let hit: AnswerFact[];
  let subject: string;
  try {
    const p = parseFactId(ref);
    subject = p.subject;
    hit = rf.book.answers(p.measure, p.subject, p.scope).hit;
  } catch {
    return [];
  }
  const head = subject.split("/")[0];
  const key = head === "you" ? rf.set.target.key : head;
  const brandKey = head !== "ai" && head !== "rival" ? key : null;
  const sorted = [...hit].sort((a, b) => (a.responseId < b.responseId ? -1 : a.responseId > b.responseId ? 1 : 0));
  const items: { id: string; find: string; model: string }[] = [];
  for (const a of sorted) {
    const r = rf.rowById.get(a.responseId);
    if (!r) continue;
    const find = (brandKey ? brandFind(r, rf.set, brandKey) : (r.code.premise_quote ?? "").trim() || (r.code.quote ?? "").trim() || (r.code.top_pick ?? "")).trim();
    if (find) items.push({ id: a.responseId, find, model: r.model });
  }
  const out: { id: string; find: string }[] = [];
  const models = new Set<string>();
  const ids = new Set<string>();
  for (const x of items) {
    if (out.length >= k) break;
    if (models.has(x.model) || ids.has(x.id)) continue;
    models.add(x.model);
    ids.add(x.id);
    out.push(x);
  }
  for (const x of items) {
    if (out.length >= k) break;
    if (ids.has(x.id)) continue;
    ids.add(x.id);
    out.push(x);
  }
  return out.map((x) => ({ responseId: x.id, find: x.find }));
}

/* ------------------------------- small helpers ------------------------------- */

export const WTB: Scope = WHAT_TO_BUY_ALL;
const enc = encodeURIComponent;
export const sitSlice = (room: string | null) => (room === null ? "sit:~none" : `sit:${enc(room)}`);
export const worrySlice = (w: string) => `worry:${enc(w)}`;
const engSlice = (models: string[]) => `eng:${models.join(",")}`;
const subj = (set: AnswerFactSet, key: string) => (key === set.target.key ? "you" : key);
/** A scope's rows (the fact book's own filter). */
const rowsOf = (rf: RunFacts, s: Scope) => rf.book.rows(s);

/** The brands in analysis a scope's answers name (or pick), the tracker first if present - a selection of whom to look
 * up; their numbers are facts. */
function brandsIn(rf: RunFacts, scope: Scope): { key: string; name: string }[] {
  const out = new Map<string, string>();
  for (const f of rowsOf(rf, scope)) for (const b of f.brands) if (b.bucket === "in_analysis" && !out.has(b.key)) out.set(b.key, b.key === rf.set.target.key ? rf.set.target.name : b.name);
  return [...out.entries()].map(([key, name]) => ({ key, name }));
}
/** The buying situations of a scope's answers, in setup order. */
function situationsIn(rf: RunFacts, data: ViewData, scope: Scope): string[] {
  const present = new Set(rowsOf(rf, scope).map((f) => f.situation).filter((s): s is string => !!s));
  const out: string[] = [];
  for (const it of [...data.intents].sort((a, b) => a.seq - b.seq)) if (it.situation && present.has(it.situation) && !out.includes(it.situation)) out.push(it.situation);
  return out;
}
const has = (rf: RunFacts, scope: Scope) => rowsOf(rf, scope).length > 0;

/* ------------------------------- the summary ------------------------------- */

export type Summary = Omit<BrandSummaryView, "insights" | "verdict">;

/** The summary (the old pooled brand table and splits) as facts. */
export function summaryFromFacts(data: ViewData, rf: RunFacts): Summary {
  const { book, set } = rf;
  const T = set.target.key;
  const { project, run, source, dictionary } = data;
  const F = (m: string, s: string, sc: Scope) => fc(book, m, s, sc);
  const n = rowsOf(rf, WTB).length;
  const legacy = new Set(project.competitors.map(matchKey));
  const entryById = new Map(dictionary.map((e) => [e.id, e]));
  const outcomes = {
    pick: F("slice_share", "ai/slice:v:outcome:pick", WTB).k,
    conditional: F("outcome_conditional", "ai", WTB).k,
    no_pick: F("outcome_no_pick", "ai", WTB).k,
    clarification: F("slice_share", "ai/slice:v:outcome:clarification", WTB).k,
  };
  const brandOf = (key: string, name: string): SummaryBrand => ({
    key,
    name,
    role: roleOf(key, T, entryById.get(key) ?? null, legacy),
    mentioned: F("named", subj(set, key), WTB),
    recommended: F("recommended", subj(set, key), WTB),
    chosen: F("picked", subj(set, key), WTB),
    shareOfDecided: F("share_of_picks", subj(set, key), WTB),
    converts: F("converts", subj(set, key), WTB),
  });
  const list = brandsIn(rf, WTB);
  if (!list.some((b) => b.key === T)) list.push({ key: T, name: set.target.name });
  const brands = list.map((b) => brandOf(b.key, b.name)).sort((a, b) => b.chosen.k - a.chosen.k || b.mentioned.k - a.mentioned.k || a.name.localeCompare(b.name));
  const target = brands.find((b) => b.key === T)!;

  // Argument lift (ruling 2): wins = the answers that pick you, others = another pick of a brand in analysis.
  const wins = F("share_of_picks", "you", WTB);
  const reasonLift: ReasonLift[] = [];
  const otherPicks = F("slice_share", "ai/slice:pick:other", WTB);
  if (wins.k >= OF.liftMinAnswers && otherPicks.k >= OF.liftMinAnswers) {
    const codes = new Set<string>();
    for (const f of rowsOf(rf, WTB)) for (const a of f.args ?? []) codes.add(a);
    for (const code of [...codes].sort()) {
      const inc = F("argues", `ai/arg:${code}`, { ...WTB, when: "args" });
      if (inc.n === 0 || inc.k / inc.n < OF.liftMinIncidence) continue;
      const w = F("argues_when_picked", `you/arg:${code}`, WTB);
      const o = F("argues_when_other_picked", `you/arg:${code}`, WTB);
      reasonLift.push({ code, wins: w, others: o, lift: (w.n ? w.k / w.n : 0) - (o.n ? o.k / o.n : 0) });
    }
    reasonLift.sort((a, b) => b.lift - a.lift || a.code.localeCompare(b.code));
  }

  const OBJ: Scope = { types: ["objections"] };
  const CUS: Scope = { types: ["churn_triggers", "renewal"] };
  const buyersDoubt = has(rf, OBJ)
    ? { answers: rowsOf(rf, OBJ).length, proceed: F("go_ahead", "ai", OBJ), avoid: F("steer_clear", "ai", OBJ), agree: F("agrees", "ai", OBJ) }
    : null;
  const customersDoubt = has(rf, CUS)
    ? { answers: rowsOf(rf, CUS).length, keep: F("stay", "ai", CUS), leave: F("leave", "ai", CUS), agree: F("agrees", "ai", CUS) }
    : null;

  // Entity head-to-heads: one record per named rival (the question's own rival, as the card reads it).
  const rivals = new Map<string, string>();
  for (const f of set.facts) if (f.type === "comparison_entity" && f.rival) rivals.set(f.rival.key, f.rival.name);
  const headToHead = [...rivals.entries()]
    .map(([key, rival]) => {
      const sc: Scope = { types: ["comparison_entity"], rival: key };
      return { key, rival, answers: rowsOf(rf, sc).length, won: F("h2h_win", "you", sc), lost: F("h2h_win", "rival", sc), winOfDecided: F("h2h_two_way", "you", sc) };
    })
    .sort((a, b) => b.answers - a.answers || a.rival.localeCompare(b.rival));

  // Engine and mode (and company) splits, each its own scope.
  const meta = new Map(ENGINES.map((e) => [e.id, { label: engineDisplayLabel(e), mode: e.mode }]));
  const sliceOf = (key: string, label: string, mode: "instinct" | "search", models: string[], extra: Partial<Scope>): SummarySlice & { firm: FactCell } => {
    const sc: Scope = { ...WTB, ...extra };
    const hs: Scope = { types: ["comparison_entity"], ...extra };
    return {
      key,
      label,
      mode,
      engines: models.length,
      answers: rowsOf(rf, sc).length,
      mentioned: F("named", "you", sc),
      chosen: F("picked", "you", sc),
      decided: F("share_of_picks", "you", sc),
      h2h: F("h2h_two_way", "you", hs),
      firm: F("commit_rate", "ai", sc),
    };
  };
  const engRows = rf.engines.filter((m) => has(rf, { ...WTB, engines: [m] }));
  const byEngine = engRows.map((m) => ({ ...sliceOf(m, meta.get(m)?.label ?? m, meta.get(m)?.mode ?? "instinct", [m], { engines: [m] }), ...facetsOf(m) }));
  const byMode = (["instinct", "search"] as const).flatMap((mode) => {
    const models = engRows.filter((m) => (meta.get(m)?.mode ?? "instinct") === mode);
    return models.length ? [sliceOf(mode, mode, mode, models, { engines: models })] : [];
  });

  return {
    runId: run.id,
    source,
    brand: project.brand,
    category: project.category,
    answers: n,
    uncoded: uncodedOf(data, rf, ["discovery", "use_case"]),
    outcomes,
    firmPick: F("slice_share", "ai/slice:v:outcome:pick", WTB),
    firmPickInCategory: F("commit_rate", "ai", WTB),
    target,
    brands,
    byMode,
    byEngine,
    core: rf.engines.map((id) => ({ id, label: meta.get(id)?.label ?? id, ...facetsOf(id) })),
    reasonLift,
    buyersDoubt,
    customersDoubt,
    headToHeadAll: has(rf, { types: ["comparison_entity"] }) ? F("h2h_two_way", "you", { types: ["comparison_entity"] }) : undefined,
    headToHead,
  };
}

/** Coded-or-not honesty count: answers on the panel to questions of these types with no code row (not a measure -
 * a fact exists only for a coded answer). */
function uncodedOf(data: ViewData, rf: RunFacts, stages: string[]): number {
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const prompts = new Set(data.prompts.filter((p) => p.intent_id && stages.includes(intentById.get(p.intent_id)?.stage ?? "")).map((p) => p.id));
  const coded = new Set(data.codes.map((c) => c.response_id));
  const panel = new Set(rf.engines);
  let u = 0;
  for (const r of data.responses) if (prompts.has(r.prompt_id) && panel.has(r.model ?? data.run.model) && !coded.has(r.id)) u++;
  return u;
}

/* ------------------------------- the views the detectors read ------------------------------- */

function valueView(data: ViewData, rf: RunFacts): ValueView | null {
  const { book, sel, set } = rf;
  const PR: Scope = { types: ["pricing"] };
  if (!has(rf, PR)) return null;
  const F = (m: string, s: string, sc: Scope) => fc(book, m, s, sc);
  const worth = (sc: Scope) => ({ yes: F("worth_yes", "ai", sc), depends: F("worth_depends", "ai", sc), no: F("worth_no", "ai", sc) }) as Record<Worth, FactCell>;
  const instead = (sc: Scope): InsteadEntry[] => [
    ...(sel.selection("instead_brands", "ai", sc).members as SelMember[]).map((m) => ({ name: m.name, n: m.count, own: false })),
    ...(set.ladder ? (sel.selection("own_options", "ai", sc).members as SelMember[]).map((m) => ({ name: m.name, n: m.count, own: true })) : []),
  ].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const rowOf = (key: string, sc: Scope, rooms: string[], line: string | null, label = key || "No room"): ValueRow => ({
    key,
    label,
    rooms,
    line,
    counterpart: null,
    answers: rowsOf(rf, sc).length,
    worth: worth(sc),
    recommendsInstead: F("instead_rival", "ai", sc),
    ownRung: F("instead_own", "ai", sc),
    instead: instead(sc),
  });
  const rooms: ValueRow[] = [];
  const sits = situationsIn(rf, data, PR);
  for (const s of sits) {
    const sc: Scope = { ...PR, situation: s };
    rooms.push(rowOf(s, sc, [s], rowsOf(rf, sc)[0]?.line ?? null));
  }
  if (has(rf, { ...PR, situation: null })) {
    const sc: Scope = { ...PR, situation: null };
    rooms.push(rowOf("", sc, [], rowsOf(rf, sc)[0]?.line ?? null));
  }
  rooms.sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));
  // The confirmed price lines (answers asked about a named line only), most answers first.
  const lineNames = [...new Set(rowsOf(rf, PR).map((f) => f.line).filter((l): l is string => !!l))];
  const lines: ValueRow[] = lineNames
    .map((l) => {
      const sc: Scope = { ...PR, line: l };
      return rowOf(l, sc, [...new Set(rowsOf(rf, sc).map((f) => f.situation ?? ""))], l, l);
    })
    .sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label));
  return {
    runId: data.run.id,
    source: data.source,
    brand: set.target.name,
    answers: rowsOf(rf, PR).length,
    uncoded: 0,
    worth: worth(PR),
    recommendsInstead: F("instead_rival", "ai", PR),
    ownRung: F("instead_own", "ai", PR),
    instead: instead(PR),
    rooms,
    lines,
    byEngine: rf.engines.filter((m) => has(rf, { ...PR, engines: [m] })).map((m) => ({ key: m, label: m, answers: rowsOf(rf, { ...PR, engines: [m] }).length, worth: worth({ ...PR, engines: [m] }), ...facetsOf(m) })),
  };
}

function doubtView<V extends string>(data: ViewData, rf: RunFacts, kind: "objections" | "keep_or_leave"): DoubtView<V> | null {
  const { book, sel } = rf;
  const types: QuestionType[] = kind === "objections" ? ["objections"] : ["churn_triggers", "renewal"];
  const base: Scope = { types };
  if (!has(rf, base)) return null;
  const F = (m: string, s: string, sc: Scope) => fc(book, m, s, sc);
  const VM: Record<string, string> = kind === "objections" ? { proceed: "go_ahead", avoid: "steer_clear", undecided: "buyer_no_side" } : { keep: "stay", leave: "leave", undecided: "customer_no_side" };
  const field = kind === "objections" ? "proceed_or_avoid" : "keep_or_leave";
  const verdicts = (sc: Scope) => Object.fromEntries(Object.entries(VM).map(([v, m]) => [v, F(m, "ai", sc)])) as Record<V, FactCell>;
  const premise = (sc: Scope) => ({ confirms: F("agrees", "ai", sc), mixed: F("partly_agrees", "ai", sc), rebuts: F("disagrees", "ai", sc) }) as Record<Premise, FactCell>;
  const matrix = Object.fromEntries((["confirms", "mixed", "rebuts"] as Premise[]).map((p) => [p, verdicts({ ...base, when: `v:premise_verdict:${p}` })])) as Record<Premise, Record<V, FactCell>>;
  const offersExitBy = Object.fromEntries(Object.keys(VM).map((v) => [v, F("sent_to_any", "ai", { ...base, when: `v:${field}:${({ proceed: "proceed", avoid: "avoid", keep: "keep", leave: "leave", undecided: "undecided" } as Record<string, string>)[v]}` })])) as Record<V, FactCell>;
  // One row per worry and stage (a worry voiced at both stages keeps two rows).
  const seen = new Map<string, { stage: string; concern: string; seq: number }>();
  for (const it of [...data.intents].sort((a, b) => a.seq - b.seq)) {
    if (!types.includes(it.stage as QuestionType) || !it.concern) continue;
    const k = `${it.stage}|${it.concern}`;
    if (!seen.has(k)) seen.set(k, { stage: it.stage, concern: it.concern, seq: it.seq });
  }
  const rows: WorryRow<V>[] = [];
  // Each row on its card's own scope (the Map's rule, analysis_map.ts): a customers' worry asked at one stage only
  // is ONE card pooling both stages for that worry, so its row is that card's scope - same answers, same fact id; a
  // worry asked at both stages is one card per stage.
  const stagesOf = new Map<string, number>();
  const wkey = (c: string) => c.trim().toLowerCase();
  for (const w of seen.values()) if (has(rf, { types: [w.stage as QuestionType], worry: w.concern })) stagesOf.set(wkey(w.concern), (stagesOf.get(wkey(w.concern)) ?? 0) + 1);
  for (const [k, w] of seen) {
    const sc: Scope = types.length > 1 && (stagesOf.get(wkey(w.concern)) ?? 0) < 2 ? { types, worry: w.concern } : { types: [w.stage as QuestionType], worry: w.concern };
    if (!has(rf, sc)) continue;
    rows.push({
      key: k,
      stage: w.stage,
      concern: w.concern,
      answers: rowsOf(rf, sc).length,
      verdicts: verdicts(sc),
      premise: premise(sc),
      offersExit: F("sent_to_any", "ai", sc),
      topExits: (sel.selection("sent_brands", "ai", sc).members as SelMember[]).map((m) => ({ name: m.name, n: m.count })),
    });
  }
  return {
    kind,
    brand: rf.set.target.name,
    answers: rowsOf(rf, base).length,
    uncoded: 0,
    stages: [...new Set(rowsOf(rf, base).map((f) => f.stage))],
    verdicts: verdicts(base),
    premise: premise(base),
    matrix,
    offersExit: F("sent_to_any", "ai", base),
    offersExitBy,
    ownProduct: F("slice_share", "ai/slice:!pick:none&pick:you", base),
    rows,
    exits: [],
    outsideExits: [],
    byEngine: rf.engines
      .filter((m) => has(rf, { ...base, engines: [m] }))
      .map((m) => {
        const sc: Scope = { ...base, engines: [m] };
        return { key: m, label: m, answers: rowsOf(rf, sc).length, verdicts: verdicts(sc), confirms: F("agrees", "ai", sc), offersExit: F("sent_to_any", "ai", sc), ...facetsOf(m) };
      }),
    byStage: [],
  } as unknown as DoubtView<V>;
}

function alternativesViews(data: ViewData, rf: RunFacts): AlternativesViews {
  const { book, sel, set } = rf;
  const T = set.target.key;
  const F = (m: string, s: string, sc: Scope) => fc(book, m, s, sc);
  const SW: Scope = { types: ["switching"] };
  // The looking-around card's own scope (one card, its buying situation - none on every tracker).
  const LA0: Scope = { types: ["looking_around"] };
  const LA: Scope = { ...LA0, situation: rowsOf(rf, LA0)[0]?.situation ?? null };
  const entryById = new Map(data.dictionary.map((e) => [e.id, e]));
  const legacy = new Set(data.project.competitors.map(matchKey));
  const captureOf = (sc: Scope) => ({
    named: F("named", "you", sc),
    recommended: F("recommended", "you", sc),
    captured: F("picked", "you", sc),
    // Another brand: a pick of a brand in analysis that is neither you nor the brand the answer's own customer is
    // leaving - per answer, so the pooled row excludes each answer's own rival too (the Question type detail fact).
    anotherBrand: F("slice_share", "ai/slice:pick:in_analysis&!pick:you&!pick:rival", sc),
    sameBrand: F("slice_share", "ai/slice:pick:rival", sc),
    outside: F("slice_share", "ai/slice:pick:outside_category", sc),
    undecided: F("slice_share", "ai/slice:pick:none", sc),
  });
  let offensive: AlternativesViews["offensive"] = null;
  if (has(rf, SW)) {
    const left = new Map<string, { key: string; name: string; resolved: boolean }>();
    for (const f of rowsOf(rf, SW)) {
      const k = f.rival ? f.rival.key : "generic";
      if (!left.has(k)) left.set(k, { key: k, name: f.rival ? f.rival.name : "No rival named", resolved: !!f.rival && !f.rival.key.startsWith("?") });
    }
    const rows: CaptureRow[] = [...left.values()].map((l) => {
      const sc: Scope = { ...SW, rival: l.key };
      return {
        key: l.key,
        rival: l.name,
        resolved: l.resolved,
        answers: rowsOf(rf, sc).length,
        ...captureOf(sc),
        captors: (sel.selection("pick_brands", "ai", sc).members as SelMember[]).map((m) => ({ name: m.name, n: m.count })),
      };
    });
    const captors: CaptorBrand[] = brandsIn(rf, SW)
      .map((b) => ({
        key: b.key,
        name: b.name,
        role: roleOf(b.key, T, entryById.get(b.key) ?? null, legacy),
        named: F("named", subj(set, b.key), SW),
        chosen: F("picked", subj(set, b.key), SW),
        shareOfDecided: F("share_of_picks", subj(set, b.key), SW),
      }))
      .sort((a, b) => b.chosen.k - a.chosen.k || b.named.k - a.named.k || a.name.localeCompare(b.name));
    offensive = {
      brand: set.target.name,
      answers: rowsOf(rf, SW).length,
      uncoded: 0,
      overall: captureOf(SW),
      rows,
      captors,
      outsidePicks: [],
      byEngine: rf.engines
        .filter((m) => has(rf, { ...SW, engines: [m] }))
        .map((m) => {
          const sc: Scope = { ...SW, engines: [m] };
          return { key: m, label: m, answers: rowsOf(rf, sc).length, named: F("named", "you", sc), captured: F("picked", "you", sc), undecided: F("slice_share", "ai/slice:pick:none", sc), ...facetsOf(m) };
        }),
    };
  }
  let defensive: AlternativesViews["defensive"] = null;
  if (has(rf, LA)) {
    const verdicts = (sc: Scope) => ({ keep: F("stay", "ai", sc), leave: F("leave", "ai", sc), undecided: F("customer_no_side", "ai", sc) });
    const destinations: DestinationRow[] = (sel.selection("sent_brands", "ai", LA).members as SelMember[]).map((m) => ({
      key: m.key,
      name: m.name,
      role: roleOf(m.key, T, entryById.get(m.key) ?? null, legacy),
      offered: F("sent_to", m.key, LA),
      onKeep: F("sent_to", m.key, { ...LA, when: "v:keep_or_leave:keep" }).k,
      onLeave: F("sent_to", m.key, { ...LA, when: "v:keep_or_leave:leave" }).k,
      onUndecided: F("sent_to", m.key, { ...LA, when: "v:keep_or_leave:undecided" }).k,
    }));
    defensive = {
      brand: set.target.name,
      answers: rowsOf(rf, LA).length,
      uncoded: 0,
      verdicts: verdicts(LA),
      offersExit: F("sent_to_any", "ai", LA),
      offersExitBy: {
        keep: F("sent_to_any", "ai", { ...LA, when: "v:keep_or_leave:keep" }),
        leave: F("sent_to_any", "ai", { ...LA, when: "v:keep_or_leave:leave" }),
        undecided: F("sent_to_any", "ai", { ...LA, when: "v:keep_or_leave:undecided" }),
      },
      ownProduct: F("slice_share", "ai/slice:!pick:none&pick:you", LA),
      destinations,
      outsideDestinations: [],
      byEngine: rf.engines
        .filter((m) => has(rf, { ...LA, engines: [m] }))
        .map((m) => {
          const sc: Scope = { ...LA, engines: [m] };
          return { key: m, label: m, answers: rowsOf(rf, sc).length, verdicts: verdicts(sc), offersExit: F("sent_to_any", "ai", sc), ...facetsOf(m) };
        }),
    };
  }
  return { runId: data.run.id, source: data.source, brand: set.target.name, offensive, defensive };
}

function settledViews(data: ViewData, rf: RunFacts): SettledViews {
  const F = (m: string, s: string, sc: Scope) => fc(rf.book, m, s, sc);
  const base = (stage: QuestionType): SettledBase | null => {
    const sc: Scope = { types: [stage] };
    if (!has(rf, sc)) return null;
    return {
      stage: stage as SettledBase["stage"],
      answers: rowsOf(rf, sc).length,
      uncoded: 0,
      verdicts: { strengthens: F("relationship_strengthens", "ai", sc), neutral: F("relationship_neutral", "ai", sc), weakens: F("relationship_weakens", "ai", sc) },
      redirectsAny: F("slice_share", "ai/slice:sent:any", sc),
      ownProduct: F("slice_share", "ai/slice:pick:you", sc),
      redirects: [],
      byEngine: [],
    };
  };
  const bc = base("business_case");
  const adv = base("advocacy");
  const exp = base("expansion");
  const eco = base("ecosystem");
  const BC: Scope = { types: ["business_case"] };
  const AD: Scope = { types: ["advocacy"] };
  return {
    runId: data.run.id,
    source: data.source,
    brand: rf.set.target.name,
    businessCase: bc ? ({ ...bc, stage: "business_case", caseStrength: { strong: F("case_strong", "ai", BC), hedged: F("case_hedged", "ai", BC), undermined: F("case_undermined", "ai", BC) } } as SettledViews["businessCase"]) : null,
    expansion: exp ? ({ ...exp, stage: "expansion", growth: { backs: F("growth_backs", "ai", { types: ["expansion"] }), neutral: F("growth_neutral", "ai", { types: ["expansion"] }), redirects: F("growth_redirects", "ai", { types: ["expansion"] }) } } as SettledViews["expansion"]) : null,
    ecosystem: eco ? ({ ...eco, stage: "ecosystem", pairsAny: F("slice_share", "ai/slice:npair:1-999", { types: ["ecosystem"] }), pairings: [] } as SettledViews["ecosystem"]) : null,
    advocacy: adv
      ? ({
          ...adv,
          stage: "advocacy",
          caseStrength: { strong: F("case_strong", "ai", AD), partial: F("case_partial", "ai", AD), concedes: F("case_concedes", "ai", AD) },
          premise: { confirms: F("agrees", "ai", AD), mixed: F("partly_agrees", "ai", AD), rebuts: F("disagrees", "ai", AD) },
        } as SettledViews["advocacy"])
      : null,
  };
}

/* ------------------------------- conditions (ruling 10) ------------------------------- */

/** A card's condition row, as the detectors read it: its label, the answers stating it over the card's answers (ruling
 * 4), the wordings answers use for it, where it sends the buyer and whether it is a fixed situation. */
export interface CardCondRow {
  label: string;
  units: string[];
  share: FactCell;
  wording: string;
  wordings: { said: string; n: number }[];
  routes: { name: string; n: number }[];
  routed: number;
  wall: boolean;
  /** The longest active dictionary form in the label (the tracker excluded) - the blocker test. */
  names: { key: string; name: string } | null;
}

/** One card's condition rows on one side, from the run's one grouping (the card's own selection - conditions_shown).
 * `toward` rows can be counted inside a slice (a lost matchup card: the answers that pick the rival) - then each share is
 * OF that slice (the card's exception step rows, same fact id). */
export function cardCondRows(rf: RunFacts, data: ViewData, scope: Scope, side: "toward" | "away", towardOnly?: string): CardCondRow[] {
  const { book, sel, set, themed } = rf;
  if (!rowsOf(rf, scope).some((f) => f.conds !== null)) return [];
  const s = sel.selection("conditions_shown", "ai", scope, { side, flavor: themed ? "themed" : "group", ...(towardOnly && side === "toward" ? { towardOnly } : {}) });
  const forms: { seq: string[]; key: string; name: string }[] = [];
  for (const e of data.dictionary) {
    if (e.status !== "active" || e.id === set.target.key) continue;
    for (const f of [e.canonical, ...e.aliases]) {
      const seq = famTokens(f);
      if (seq.length) forms.push({ seq, key: e.id, name: e.display_name ?? e.canonical });
    }
  }
  const namesIn = (label: string) => {
    const hay = famTokens(label);
    let best: (typeof forms)[number] | null = null;
    for (const f of forms) if (containsSeq(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
    return best ? { key: best.key, name: best.name } : null;
  };
  return (s.members as unknown as { label: string; units: string[]; count: number; raw?: string }[]).map((m) => {
    // A toward row counted only in a slice of the answers (the lost-with-an-exception rows: the answers that pick the
    // rival) is a share OF that slice - the head-to-head card's "Who it still sends to you" rows, the same fact id.
    const only = towardOnly && side === "toward" ? towardOnly : null;
    const sub = `ai/cond:${[...m.units].sort().join("+")}`;
    const at: Scope = only ? { ...scope, when: only } : scope;
    const share = fc(book, "cond_share", sub, at);
    const us = new Set(m.units);
    const said = new Map<string, number>();
    for (const a of book.answers("cond_share", sub, at).hit) {
      const w = (a.conds ?? []).find((c) => us.has(c.unit))?.said;
      if (w) said.set(w, (said.get(w) ?? 0) + 1);
    }
    const wordings = [...said.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])).map(([w, n]) => ({ said: w, n }));
    const dest = sel.selection("cond_destinations", "ai", scope, { units: m.units }) as AnySelection;
    const label = m.raw ?? m.label;
    return {
      label: m.label,
      units: m.units,
      share,
      wording: wordings[0]?.said ?? label,
      wordings,
      routes: side === "away" ? (dest.members as SelMember[]).map((x) => ({ name: x.name, n: x.count })) : [],
      routed: side === "away" ? Number((dest.extras as { base?: number }).base ?? 0) : 0,
      wall: side === "away" && isWallWording([label], set.target.name),
      names: namesIn(label),
    };
  }).filter((r) => !isDefaultCondition(r.label));
}

/* ------------------------------- the inputs ------------------------------- */

/** The detectors' inputs, every number a fact. `F` lets a detector look up the pooled facts it states (another buying
 * situation, another AI company, the rest of the worries) - one fact each, never a sum. */
export function inputsFromFacts(data: ViewData, rf: RunFacts, s: Summary): InsightInputs {
  const { book, sel, set } = rf;
  const T = set.target.key;
  const F = (m: string, sb: string, sc: Scope) => fc(book, m, sb, sc);
  const rooms = situationsIn(rf, data, WTB).map((room) => {
    const sc: Scope = { ...WTB, situation: room };
    const decided = F("share_of_picks", "you", sc);
    return { room, decided, picks: decided.k, firm: decided.n, firmAll: F("slice_share", "ai/slice:!pick:none", sc).k };
  });
  // Per question (a cell: a seed and its paraphrases): picks by brand in analysis.
  const intents = new Map<string, { id: string; text: string; seq: number }>();
  for (const f of rowsOf(rf, WTB)) if (!intents.has(f.intentId)) {
    const it = data.intents.find((i) => i.id === f.intentId)!;
    intents.set(f.intentId, { id: it.id, text: it.text, seq: it.seq });
  }
  const questions = [...intents.values()]
    .sort((a, b) => a.seq - b.seq)
    .map((q) => {
      const sc: Scope = { ...WTB, when: `cell:${q.id}` };
      const picks: Record<string, number> = {};
      for (const m of sel.selection("pick_brands", "ai", sc, { youFirst: false }).members as SelMember[]) picks[m.key] = F("picked", subj(set, m.key), sc).k;
      // A brand under the pick_brands floor still counts its picks (the concentration totals).
      for (const f of rowsOf(rf, sc)) if (f.pick.state === "in_analysis" && picks[f.pick.key!] === undefined) picks[f.pick.key!] = F("picked", subj(set, f.pick.key!), sc).k;
      return { id: q.id, text: q.text, answers: rowsOf(rf, sc).length, picks };
    });
  const enginePicks = s.brands
    .filter((b) => b.chosen.k > 0)
    .map((b) => ({ key: b.key, total: b.chosen.k, byModel: Object.fromEntries(rf.engines.map((m) => [m, F("picked", subj(set, b.key), { ...WTB, engines: [m] }).k])) as Record<string, number> }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

  // Criteria taught: every code argued on the what-to-look-for questions.
  const CR: Scope = { types: ["criteria"] };
  const crN = rowsOf(rf, CR).length;
  const codes = new Set<string>();
  for (const f of rowsOf(rf, CR)) for (const a of f.args ?? []) codes.add(a);
  const taught =
    crN >= OF.minBase
      ? [...codes].map((code) => ({ code, rate: F("argues", `ai/arg:${code}`, CR) })).filter((t) => t.rate.k > 0).sort((a, b) => b.rate.k - a.rate.k || a.code.localeCompare(b.code))
      : [];

  // Arguments on the pooled direct matchups: in the matchups you win and those the named rival wins.
  const EN: Scope = { types: ["comparison_entity"] };
  const winsC = F("slice_share", "ai/slice:pick:you", EN);
  const lossC = F("slice_share", "ai/slice:pick:rival", EN);
  const h2hCodes = new Set<string>();
  for (const f of rowsOf(rf, EN)) if (f.pick.state !== "none" && (f.pick.key === T || f.pick.key === f.rival?.key)) for (const a of f.args ?? []) h2hCodes.add(a);
  const rivalNames: Record<string, string> = {};
  for (const r of s.headToHead) rivalNames[r.key] = r.rival;
  const h2hArgs: InsightInputs["h2hArgs"] = {
    wins: winsC.k,
    losses: lossC.k,
    rivals: rivalNames,
    codes: [...h2hCodes]
      .map((code) => {
        const w = F("argues", `ai/arg:${code}`, { ...EN, when: "pick:you" });
        const l = F("argues", `ai/arg:${code}`, { ...EN, when: "pick:rival" });
        const lossesBy: Record<string, number> = {};
        for (const r of s.headToHead) {
          const k = F("argues", `ai/arg:${code}`, { ...EN, rival: r.key, when: "pick:rival" }).k;
          if (k) lossesBy[r.key] = k;
        }
        return { code, wins: w.k, losses: l.k, lossesBy, w, l };
      })
      .sort((a, b) => b.wins - a.wins || a.code.localeCompare(b.code)),
    winsCell: winsC,
    lossesCell: lossC,
  };

  // One argument in each pick contest: the answers that pick you against another pick of a brand in analysis (ruling 2).
  const contests: { type: "headline" | "head_to_head_entity" | "offensive_capture"; scope: Scope }[] = [
    { type: "headline", scope: WTB },
    { type: "head_to_head_entity", scope: EN },
    { type: "offensive_capture", scope: { types: ["switching"] } },
  ];
  const allCodes = new Set<string>();
  for (const c of contests) for (const f of rowsOf(rf, c.scope)) for (const a of f.args ?? []) allCodes.add(a);
  const argSides: InsightInputs["argSides"] = [...allCodes].sort().map((code) => ({
    code,
    types: contests
      .filter((c) => has(rf, c.scope))
      .map((c) => ({ type: c.type, you: F("argues_when_picked", `you/arg:${code}`, c.scope), other: F("argues_when_other_picked", `you/arg:${code}`, c.scope) })),
  }));

  // Picks that leave the category (ruling 8: outside the category; a pick outside of analysis is its own bucket).
  const outName = new Map<string, number>();
  for (const a of book.answers("slice_share", "ai/slice:pick:outside_category", { ...WTB, when: "!pick:none" }).hit) {
    const nm = a.pick.written ?? a.pick.name ?? "";
    if (nm) outName.set(nm, (outName.get(nm) ?? 0) + 1);
  }
  const leak: InsightInputs["leak"] = {
    firm: F("slice_share", "ai/slice:!pick:none", WTB).k,
    inCategory: F("commit_rate", "ai", WTB).k,
    names: [...outName.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n })),
    rooms: rooms.map((r) => ({ room: r.room, firm: r.firmAll, outside: F("slice_share", "ai/slice:pick:outside_category", { ...WTB, situation: r.room }).k })),
    outsideCell: F("slice_share", "ai/slice:pick:outside_category", { ...WTB, when: "!pick:none" }),
    roomCells: Object.fromEntries(rooms.map((r) => [r.room, F("slice_share", "ai/slice:pick:outside_category", { ...WTB, situation: r.room, when: "!pick:none" })])),
  };

  // Problem questions answered outside the category (ruling 5: adjacent only).
  const PR: Scope = { types: ["problem_recognition"] };
  const problem: InsightInputs["problem"] = has(rf, PR)
    ? { all: F("routed_adjacent", "ai", PR), rooms: situationsIn(rf, data, PR).map((room) => ({ room, out: F("routed_adjacent", "ai", { ...PR, situation: room }) })) }
    : null;

  // Ruling 10: the condition findings read one card's own rows - the What to buy card (away), each lost matchup card.
  const awayRows = cardCondRows(rf, data, WTB, "away");
  const away: InsightInputs["away"] = awayRows.length ? { rows: awayRows, scope: WTB, cells: 0, groups: [], grouping: rf.themed ? "embeddings" : "stems" } : null;
  // Lost, with an exception: per matchup lost on balance, the toward rows counted in the answers that pick the rival.
  const exception: InsightInputs["exception"] = (() => {
    const out: NonNullable<InsightInputs["exception"]>["cards"] = [];
    for (const r of s.headToHead) {
      if (r.key.startsWith("?")) continue;
      const sc: Scope = { types: ["comparison_entity"], rival: r.key };
      const won = r.won.k;
      const lost = r.lost.k;
      if (!(won + lost >= OF.minBase && lost > won)) continue;
      const rows = cardCondRows(rf, data, sc, "toward", "pick:rival");
      out.push({ key: r.key, name: r.rival, scope: sc, lost: r.lost as FactCell, any: F("slice_share", `ai/slice:cond:toward:${rf.themed ? "theme" : "group"}`, { ...sc, when: "pick:rival" }), rows });
    }
    return out.length ? { cards: out } : null;
  })();

  const asked = [...new Set(set.facts.filter((f) => (f.type === "comparison_entity" || f.type === "comparison_class") && f.rival && !f.rival.key.startsWith("?")).map((f) => f.rival!.key))].sort();

  return {
    rooms,
    value: valueView(data, rf),
    doubt: { runId: data.run.id, source: data.source, brand: set.target.name, objections: doubtView<ObjectionVerdict>(data, rf, "objections"), keepOrLeave: doubtView<StayVerdict>(data, rf, "keep_or_leave") },
    questions,
    settled: settledViews(data, rf),
    taught,
    alternatives: alternativesViews(data, rf),
    away,
    enginePicks,
    h2hArgs,
    argSides,
    leak,
    problem,
    exception,
    asked,
    F: { fact: F, wtb: WTB, engines: rf.engines, rf },
  };
}

export { sitSlice as situationSlice, engSlice };
