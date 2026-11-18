/**
 * A fact's id and scope, the pure part of fact.ts (split 2026-11-17, fact layer step 6) so the browser - the Data
 * page counts its tables in the browser from the same answer facts and the same measure book - can name a cell's
 * fact exactly as the server does. No imports beyond types.
 *
 * A fact is a measure, about a subject, in a scope; the triple is its id (fact.ts).
 *
 * Scope: the question types (required), and optionally a buying situation (a string, or null for questions asked of
 * no particular buyer), a worry (null = questions carrying no worry), the rival or class brand the question names,
 * the price line asked about, the assistants (engine ids), an AI company, a tier (free / paid), a mode (search /
 * instinct), one question (its cell: the intent id), and a slice of the answers (`when`, slices.ts - read on the
 * server only).
 *
 * Ruling 7: the scope "what to buy, all buyers" is the buyer cards' types only (discovery + use case). What's
 * popular and Premium vs basic are their own scopes.
 */
import type { AnswerFact, QuestionType } from "./answer_facts";

export interface Scope {
  types: readonly QuestionType[];
  /** A string = that buying situation; null = only questions asked of no particular buyer; absent = any. */
  situation?: string | null;
  /** The worry the cell measures (as stored on the cell); null = only questions carrying no worry; absent = any. */
  worry?: string | null;
  /** The rival or class brand the question names (entry id, or the "?<...>" key of an unplaced one); "generic" =
   * a question that names no rival. */
  rival?: string;
  /** The price line asked about; the tracker's own name matches price questions with no named line. */
  line?: string;
  /** Engine ids; absent = every assistant on the core panel. */
  engines?: readonly string[];
  /** One AI company (vendor display name). */
  vendor?: string;
  /** Free or paid assistants (engine facets: "free" / "paid" / "both"). */
  tier?: string;
  /** Search on or off (engine facets: "search" / "instinct"). */
  mode?: string;
  /** One question: its cell (the intent id) - a seed and its rewordings. */
  intent?: string;
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
  if (s.worry !== undefined) parts.push(`w=${s.worry === null ? "~none" : s.worry}`);
  if (s.rival !== undefined) parts.push(`r=${s.rival}`);
  if (s.line !== undefined) parts.push(`l=${s.line}`);
  if (s.engines !== undefined) parts.push(`e=${[...s.engines].sort().join("+")}`);
  if (s.vendor !== undefined) parts.push(`v=${s.vendor}`);
  if (s.tier !== undefined) parts.push(`k=${s.tier}`);
  if (s.mode !== undefined) parts.push(`m=${s.mode}`);
  if (s.intent !== undefined) parts.push(`i=${s.intent}`);
  if (s.when !== undefined) parts.push(`h=${s.when}`);
  return parts.join("|");
}

/** The fact id: measure | subject | scope. */
export function factId(measureId: string, subject: string, scope: Scope): string {
  return `${measureId}|${subject}|${scopeKey(scope)}`;
}

/** Does an answer fall in the scope - every field but the slice (`when`, read on the server by fact.ts inScope)?
 * `targetName` is the tracker's own name (a price question with no named line is about the bare brand). */
export function inScopeBase(f: AnswerFact, s: Scope, targetName: string): boolean {
  if (!s.types.includes(f.type)) return false;
  if (s.situation !== undefined && f.situation !== s.situation) return false;
  if (s.worry !== undefined && f.worry !== s.worry) return false;
  if (s.rival !== undefined) {
    if (s.rival === "generic" ? f.rival !== null : f.rival?.key !== s.rival) return false;
  }
  if (s.line !== undefined && (f.line ?? targetName) !== s.line) return false;
  if (s.engines !== undefined && !s.engines.includes(f.engine.id)) return false;
  if (s.vendor !== undefined && f.engine.vendor !== s.vendor) return false;
  if (s.tier !== undefined && f.engine.tier !== s.tier) return false;
  if (s.mode !== undefined && f.engine.mode !== s.mode) return false;
  if (s.intent !== undefined && f.intentId !== s.intent) return false;
  return true;
}
