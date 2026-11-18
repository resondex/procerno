/**
 * A fact (FACT_LAYER_DESIGN_2026-11-17.md, layer 2): a measure, about a subject, in a scope - with its two counts.
 * The triple is the fact's id; it depends on no screen, so it survives any card being redesigned. Where a fact is
 * DRAWN is a separate index (not built yet).
 *
 *   fact("share_of_picks", "<entry id>", WHAT_TO_BUY_ALL)  ->  { id, k, n, text }
 *
 * Subject: a brand's dictionary entry id, "you" (the tracker - normalised to its entry id, so the id is the same
 * either way), "ai" (a measure about the answer), or "rival" (each answer's own named rival, head-to-heads only).
 * A parameter follows the subject: "<subject>/arg:<code>" (an argument), "<subject>/cond:<spec>" (a condition, its
 * units sorted so one condition has one id), "ai/slice:<slice>" (a slice as the numerator) - measure_book.ts.
 *
 * Scope: the question types (required), and optionally a buying situation (a string, or null for questions asked
 * of no particular buyer), a worry, the rival or class brand the question names, the price line asked about, the
 * assistants (engine ids), an AI company, and a slice of the answers (`when`, slices.ts).
 *
 * Ruling 7: the scope "what to buy, all buyers" is the buyer cards' types only (discovery + use case). What's
 * popular and Premium vs basic are their own scopes.
 */
import type { AnswerFact, AnswerFactSet, QuestionType } from "./answer_facts";
import { MEASURE_BY_ID, legalMeasure, printOf, type CondSpec, type MeasureCtx } from "./measure_book";
import { slicePred } from "./slices";

export interface Scope {
  types: readonly QuestionType[];
  /** A string = that buying situation; null = only questions asked of no particular buyer; absent = any. */
  situation?: string | null;
  /** The worry the cell measures (as stored on the cell). */
  worry?: string;
  /** The rival or class brand the question names (entry id, or the "?<...>" key of an unplaced one); "generic" =
   * a switching question that names no rival. */
  rival?: string;
  /** The price line asked about; the tracker's own name matches price questions with no named line. */
  line?: string;
  /** Engine ids; absent = every assistant on the core panel. */
  engines?: readonly string[];
  /** One AI company (vendor display name). */
  vendor?: string;
  /** A slice of the scope's answers (slices.ts): "the answers that pick you", "the answers that say leave". */
  when?: string;
}

/** Ruling 7: what to buy, all buyers. */
export const WHAT_TO_BUY_ALL: Scope = { types: ["discovery", "use_case"] };

export interface Fact {
  id: string;
  k: number;
  n: number;
  /** As printed by the measure's rule. */
  text: string;
}

/** The scope as a stable string (types sorted; only the fields present). */
export function scopeKey(s: Scope): string {
  const parts = [`t=${[...s.types].sort().join("+")}`];
  if (s.situation !== undefined) parts.push(`s=${s.situation === null ? "~none" : s.situation}`);
  if (s.worry !== undefined) parts.push(`w=${s.worry}`);
  if (s.rival !== undefined) parts.push(`r=${s.rival}`);
  if (s.line !== undefined) parts.push(`l=${s.line}`);
  if (s.engines !== undefined) parts.push(`e=${[...s.engines].sort().join("+")}`);
  if (s.vendor !== undefined) parts.push(`v=${s.vendor}`);
  if (s.when !== undefined) parts.push(`h=${s.when}`);
  return parts.join("|");
}

/** The fact id: measure | subject | scope. */
export function factId(measureId: string, subject: string, scope: Scope): string {
  return `${measureId}|${subject}|${scopeKey(scope)}`;
}

/** Does an answer fall in the scope? */
export function inScope(f: AnswerFact, s: Scope, set: AnswerFactSet): boolean {
  if (!s.types.includes(f.type)) return false;
  if (s.situation !== undefined && f.situation !== s.situation) return false;
  if (s.worry !== undefined && f.worry !== s.worry) return false;
  if (s.rival !== undefined) {
    if (s.rival === "generic" ? f.rival !== null : f.rival?.key !== s.rival) return false;
  }
  if (s.line !== undefined && (f.line ?? set.target.name) !== s.line) return false;
  if (s.engines !== undefined && !s.engines.includes(f.engine.id)) return false;
  if (s.vendor !== undefined && f.engine.vendor !== s.vendor) return false;
  if (s.when !== undefined && !slicePred(s.when, set)(f)) return false;
  return true;
}

/** A fact lookup over one run's answer facts, memoized by fact id. */
export function factBook(set: AnswerFactSet) {
  const memo = new Map<string, Fact>();
  const rowsMemo = new Map<string, AnswerFact[]>();
  const rows = (scope: Scope) => {
    const k = scopeKey(scope);
    let r = rowsMemo.get(k);
    if (!r) {
      r = set.facts.filter((f) => inScope(f, scope, set));
      rowsMemo.set(k, r);
    }
    return r;
  };
  const normSubject = (subject: string) => {
    const si = subject.indexOf("/slice:");
    const sliceRaw = si >= 0 ? subject.slice(si + 7) : null;
    const rest0 = si >= 0 ? subject.slice(0, si) : subject;
    const ci = rest0.indexOf("/cond:");
    const condRaw = ci >= 0 ? rest0.slice(ci + 6) : null;
    const rest = ci >= 0 ? rest0.slice(0, ci) : rest0;
    const [head, arg] = rest.split("/arg:");
    return { head: head === "you" ? set.target.key : head, arg: arg ?? null, condRaw, sliceRaw };
  };
  /** "<unit>+<unit>[>to:<key>][@<slice>]" -> the condition, with its canonical spelling (units sorted). */
  const parseCond = (raw: string): { spec: CondSpec; key: string } => {
    const at = raw.indexOf("@");
    const slice = at >= 0 ? raw.slice(at + 1) : null;
    const body = at >= 0 ? raw.slice(0, at) : raw;
    const [unitsRaw, ...opts] = body.split(">");
    const opt = (name: string) => opts.find((o) => o.startsWith(`${name}:`))?.slice(name.length + 1) ?? null;
    const units = [...new Set(unitsRaw.split("+").filter(Boolean))].sort();
    const toRaw = opt("to");
    const to = toRaw ? (toRaw === "you" ? set.target.key : toRaw) : null;
    const card = opt("card");
    const key = `${units.join("+")}${to ? `>to:${to}` : ""}${card ? `>card:${card}` : ""}${slice ? `@${slice}` : ""}`;
    return { spec: { units: new Set(units), to, card, only: slice ? slicePred(slice, set) : null }, key };
  };
  function fact(measureId: string, subject: string, scope: Scope): Fact {
    return compute(measureId, subject, scope, true);
  }
  /** The same count with the legality checks skipped - ONLY to reproduce a card's old rule in a proof (a ruling's
   * "before"), never to serve a number. */
  function countUnchecked(measureId: string, subject: string, scope: Scope): Fact {
    return compute(measureId, subject, scope, false);
  }
  function compute(measureId: string, subject: string, scope: Scope, checked: boolean): Fact {
    const m = checked ? legalMeasure(measureId, scope.types) : (MEASURE_BY_ID.get(measureId) ?? legalMeasure(measureId, scope.types));
    const { head, arg, condRaw, sliceRaw } = normSubject(subject);
    if (m.slice && !sliceRaw) throw new Error(`fact layer: measure "${measureId}" needs a slice ("ai/slice:<slice>")`);
    if (m.subject === "ai" && head !== "ai") throw new Error(`fact layer: measure "${measureId}" is about the answer; subject must be "ai", got "${subject}"`);
    if (m.subject !== "ai" && head === "ai") throw new Error(`fact layer: measure "${measureId}" needs a brand subject`);
    if (head === "rival" && m.subject !== "brand_or_rival") throw new Error(`fact layer: measure "${measureId}" does not take the subject "rival"`);
    if (m.arg && !arg) throw new Error(`fact layer: measure "${measureId}" needs an argument ("<subject>/arg:<code>")`);
    if (m.cond && !condRaw) throw new Error(`fact layer: measure "${measureId}" needs a condition ("<subject>/cond:<units>")`);
    // Ruling 10: a condition is counted inside one question type's scope, never pooled across types. (The worries'
    // two stages are one question type on the cards: customers' worries.)
    if (checked && m.cond && new Set(scope.types.map((t) => (t === "renewal" ? "churn_triggers" : t === "use_case" ? "discovery" : t))).size > 1)
      throw new Error(`fact layer: condition measure "${measureId}" refused on a scope pooling question types (${scope.types.join(", ")}) - ruling 10`);
    const cond = condRaw ? parseCond(condRaw) : null;
    if (head !== "ai" && head !== "rival" && set.bucketOf(head) === "outside_analysis")
      throw new Error(`fact layer: "${set.nameOf(head)}" is outside of analysis (ruling 8) - never a subject`);
    const id = (checked ? "" : "unchecked:") + factId(measureId, `${head}${arg ? `/arg:${arg}` : ""}${cond ? `/cond:${cond.key}` : ""}${sliceRaw ? `/slice:${sliceRaw}` : ""}`, scope);
    const hit = memo.get(id);
    if (hit) return hit;
    const ctx: MeasureCtx = { set, brand: head === "ai" || head === "rival" ? null : head, rival: head === "rival", arg, cond: cond?.spec ?? null, slice: sliceRaw ? slicePred(sliceRaw, set) : null };
    let k = 0;
    let n = 0;
    for (const f of rows(scope)) {
      if (!m.base(f, ctx)) continue;
      n++;
      if (m.hit(f, ctx)) k++;
    }
    const out: Fact = { id, k, n, text: printOf(m, k, n) };
    memo.set(id, out);
    return out;
  }
  /** The answers behind a fact: its base and its numerator (the example answers a card opens). */
  const hitMemo = new Map<string, { base: AnswerFact[]; hit: AnswerFact[] }>();
  function answers(measureId: string, subject: string, scope: Scope): { base: AnswerFact[]; hit: AnswerFact[] } {
    const f = fact(measureId, subject, scope);
    const got = hitMemo.get(f.id);
    if (got) return got;
    const m = MEASURE_BY_ID.get(measureId)!;
    const { head, arg, condRaw, sliceRaw } = normSubject(subject);
    const cond = condRaw ? parseCond(condRaw) : null;
    const ctx: MeasureCtx = { set, brand: head === "ai" || head === "rival" ? null : head, rival: head === "rival", arg, cond: cond?.spec ?? null, slice: sliceRaw ? slicePred(sliceRaw, set) : null };
    const base: AnswerFact[] = [];
    const hit: AnswerFact[] = [];
    for (const r of rows(scope)) {
      if (!m.base(r, ctx)) continue;
      base.push(r);
      if (m.hit(r, ctx)) hit.push(r);
    }
    if (base.length !== f.n || hit.length !== f.k) throw new Error(`fact layer: answers of ${f.id} do not reproduce its counts`);
    const out = { base, hit };
    hitMemo.set(f.id, out);
    return out;
  }
  return { fact, countUnchecked, rows, answers };
}

export type FactBook = ReturnType<typeof factBook>;
