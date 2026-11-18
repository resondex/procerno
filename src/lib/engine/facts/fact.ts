/**
 * A fact (FACT_LAYER_DESIGN_2026-11-17.md, layer 2): a measure, about a subject, in a scope - with its two counts.
 * The triple is the fact's id; it depends on no screen, so it survives any card being redesigned. Where a fact is
 * DRAWN is a separate index (not built yet).
 *
 *   fact("share_of_picks", "<entry id>", WHAT_TO_BUY_ALL)  ->  { id, k, n, text }
 *
 * Subject: a brand's dictionary entry id, "you" (the tracker - normalised to its entry id, so the id is the same
 * either way), "ai" (a measure about the answer), or "rival" (each answer's own named rival, head-to-heads only).
 * An argument measure carries its code after the subject: "<subject>/arg:<code>".
 *
 * Scope: the question types (required), and optionally a buying situation (a string, or null for questions asked
 * of no particular buyer), a worry, the rival or class brand the question names, the price line asked about, the
 * assistants (engine ids) and an AI company.
 *
 * Ruling 7: the scope "what to buy, all buyers" is the buyer cards' types only (discovery + use case). What's
 * popular and Premium vs basic are their own scopes.
 */
import type { AnswerFact, AnswerFactSet, QuestionType } from "./answer_facts";
import { legalMeasure, printOf, type MeasureCtx } from "./measure_book";

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
    const [head, arg] = subject.split("/arg:");
    return { head: head === "you" ? set.target.key : head, arg: arg ?? null };
  };
  function fact(measureId: string, subject: string, scope: Scope): Fact {
    const m = legalMeasure(measureId, scope.types);
    const { head, arg } = normSubject(subject);
    if (m.subject === "ai" && head !== "ai") throw new Error(`fact layer: measure "${measureId}" is about the answer; subject must be "ai", got "${subject}"`);
    if (m.subject !== "ai" && head === "ai") throw new Error(`fact layer: measure "${measureId}" needs a brand subject`);
    if (head === "rival" && m.subject !== "brand_or_rival") throw new Error(`fact layer: measure "${measureId}" does not take the subject "rival"`);
    if (m.arg && !arg) throw new Error(`fact layer: measure "${measureId}" needs an argument ("<subject>/arg:<code>")`);
    if (head !== "ai" && head !== "rival" && set.bucketOf(head) === "outside_analysis")
      throw new Error(`fact layer: "${set.nameOf(head)}" is outside of analysis (ruling 8) - never a subject`);
    const id = factId(measureId, arg ? `${head}/arg:${arg}` : head, scope);
    const hit = memo.get(id);
    if (hit) return hit;
    const ctx: MeasureCtx = { set, brand: head === "ai" || head === "rival" ? null : head, rival: head === "rival", arg };
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
  return { fact, rows };
}

export type FactBook = ReturnType<typeof factBook>;
