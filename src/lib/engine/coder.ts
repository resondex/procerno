/**
 * procerno_reason_coder on Fireworks - the production coding provider
 * (2026-10-29, Tyler's go; architecture in CODING_DECISIONS "Production
 * coding architecture RATIFIED").
 *
 * One call per answer to `<model>#<deployment>` with the trained inference
 * contract: the byte-exact trained request from coder_prompts.ts,
 * temperature 0, reasoning_effort "none" (Qwen3.5 thinks by default and
 * burns the budget otherwise), max_tokens 2048. The reply is parsed
 * tolerantly (fences, prose wrapping, and the split-object shape the
 * Sephora adapter smoke surfaced: two consecutive JSON objects - merged,
 * later objects winning per field) and then validated STRICTLY against the
 * row's schema: a missing field or an off-contract verdict is a failed row,
 * never a silently-null code.
 *
 * Two-pass routing (onboarding-tier trackers, projects.reasons_adapter set):
 * pass 1 = the base coder for every field; pass 2 = the tracker's reasons
 * adapter on the SAME request, of which ONLY reasons + uncoded_reason are
 * read and merged. Awareness rows (topics, no reasons) skip pass 2. A pass-2
 * failure of any kind degrades to pass 1's reasons, flagged in the row's
 * contract ("<contract>;reasons:base") and logged - it never fails the row.
 *
 * The ledger: one row per call (purpose run:coding, engine
 * fireworks:<model>) carrying the vendor-metered tokens at cost 0 - a
 * dedicated deployment bills GPU hours, not tokens - plus GPU-time
 * estimate rows the wave writes (see logCoderGpuEstimate).
 */
import { logCost } from "../cost_log";
import type { AnswerCodes } from "../types";
import { fromChatUsage, type BilledUsage } from "./usage";
import { SCHEMA_FIELDS, type CodeSchema } from "./views";
import { CODER_CONTRACT_ID, type CoderRequest } from "./coder_prompts";
import { inferenceBaseUrl, routedModelId } from "./coder_deployment";

/** The production coder (CODING_DECISIONS "Coder pick: v0.5"). */
export const CODER_MODEL = process.env.CODER_MODEL ?? "procerno-reason-coder-v0-5";
export const CODER_MAX_TOKENS = 2048;
const MODEL_PREFIX = "procerno-reason-coder-";
const CALL_TIMEOUT_MS = 60_000;

/** The answer_codes source a wave writes: "coder:v0-5", or
 * "coder:v0-5+seph-sd2" when a reasons adapter runs pass 2. */
export function coderSource(adapter: string | null, model = CODER_MODEL): string {
  const short = model.startsWith(MODEL_PREFIX) ? model.slice(MODEL_PREFIX.length) : model;
  if (!adapter) return `coder:${short}`;
  const a = adapter.startsWith(`${model}-`) ? adapter.slice(model.length + 1)
    : adapter.startsWith(MODEL_PREFIX) ? adapter.slice(MODEL_PREFIX.length) : adapter;
  return `coder:${short}+${a}`;
}

/** A reasons adapter is a warm start FROM one base; read against any other
 * base its reasons would be another model's. Null = fine. */
export function adapterMismatch(adapter: string | null, model = CODER_MODEL): string | null {
  if (!adapter) return null;
  return adapter.startsWith(`${model}-`)
    ? null
    : `reasons adapter ${adapter} was not trained from the configured coder ${model} (adapters never carry across bases - retrain it, or clear projects.reasons_adapter)`;
}

// ---------------------------------------------------------------- calls

export class CoderTransportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface CoderCallResult {
  content: string;
  finishReason: string | null;
  usage: BilledUsage;
  ms: number;
}

const RETRYABLE = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;

/** One trained-contract call; transport errors (network, 408, 429, 5xx)
 * retry ONCE. Every completed call is ledgered (tokens at cost 0).
 * `hardStop` (epoch ms) bounds the call and its retry so an in-flight row
 * never outlives the serverless function. */
export async function callCoder(
  key: string,
  model: string,
  req: Pick<CoderRequest, "system" | "user">,
  hardStop = Date.now() + 2 * CALL_TIMEOUT_MS
): Promise<CoderCallResult> {
  const body = JSON.stringify({
    model: routedModelId(model),
    temperature: 0,
    max_tokens: CODER_MAX_TOKENS,
    reasoning_effort: "none",
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  });
  const t0 = Date.now();
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let detail = "";
    try {
      const res = await fetch(`${inferenceBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(Math.max(5_000, Math.min(CALL_TIMEOUT_MS, hardStop - Date.now()))),
      });
      status = res.status;
      if (res.ok) {
        const j = (await res.json()) as {
          choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
          usage?: unknown;
        };
        const u = fromChatUsage(j.usage);
        const usage: BilledUsage = {
          ...u,
          // Dedicated deployment: tokens are not billed; GPU time is
          // ledgered separately (logCoderGpuEstimate).
          vendorCostUsd: 0,
          raw: { usage: u.raw, billing: "dedicated deployment - tokens unbilled, GPU hours ledgered separately" },
        };
        logCost({ model, engine: `fireworks:${model}`, usage });
        return {
          content: j.choices?.[0]?.message?.content ?? "",
          finishReason: j.choices?.[0]?.finish_reason ?? null,
          usage,
          ms: Date.now() - t0,
        };
      }
      detail = (await res.text()).slice(0, 200);
    } catch (err) {
      detail = String(err).slice(0, 200);
    }
    if (attempt === 1 && RETRYABLE(status) && hardStop - Date.now() > 10_000) {
      await new Promise((r) => setTimeout(r, 1_500 + Math.random() * 1_500));
      continue;
    }
    throw new CoderTransportError(`coder call to ${model} failed: HTTP ${status || "network"} ${detail}`, status);
  }
}

// ---------------------------------------------------------------- parsing

export type ParsedReply =
  | { ok: true; obj: Record<string, unknown>; mode: "direct" | "extracted" | "split" }
  | { ok: false };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Every top-level {...} span, in order (strings and escapes respected). */
function objectSpans(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = depth > 0;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(s.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/** Tolerant reply parsing: <think> blocks and code fences stripped; one
 * object read directly or out of surrounding prose; two or more
 * consecutive objects (the split shape) merged with later objects winning
 * per field. */
export function parseCoderReply(content: string): ParsedReply {
  const s = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const unfenced = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const v = JSON.parse(unfenced);
    if (isObj(v)) return { ok: true, obj: v, mode: unfenced === s ? "direct" : "extracted" };
  } catch {
    /* fall through to span scanning */
  }
  const objs: Record<string, unknown>[] = [];
  for (const span of objectSpans(unfenced)) {
    try {
      const v = JSON.parse(span);
      if (isObj(v)) objs.push(v);
    } catch {
      /* a non-JSON brace span in prose */
    }
  }
  if (!objs.length) return { ok: false };
  return { ok: true, obj: Object.assign({}, ...objs), mode: objs.length > 1 ? "split" : "extracted" };
}

// ---------------------------------------------------------------- validation

const ENUMS: Record<string, readonly string[]> = {
  outcome: ["pick", "conditional", "clarification", "no_pick"],
  tier_stance: ["premium", "basic", "balanced", "none"],
  worth_it: ["yes", "no", "depends"],
  proceed_or_avoid: ["proceed", "avoid", "undecided"],
  keep_or_leave: ["keep", "leave", "undecided"],
  premise_verdict: ["confirms", "rebuts", "mixed", "n/a"],
  category_routed: ["category", "adjacent", "none"],
  relationship_verdict: ["strengthens", "neutral", "weakens"],
  growth_stance: ["backs", "neutral", "redirects"],
};
const CASE_STRENGTH: Record<string, readonly string[]> = {
  business_case: ["strong", "hedged", "undermined"],
  advocacy: ["strong", "partial", "concedes"],
};
const FRAMINGS = new Set(["recommended", "mentioned", "negative"]);
const MAKER = new Set(["own", "third_party", "substitute"]);
/** Schemas whose trained contract asks decision_rules (choice + premium via
 * drc3, expansion + ecosystem via the Set C rules recode). */
const RULES_SCHEMAS = new Set<CodeSchema>(["choice", "premium", "expansion", "ecosystem"]);
const AWARENESS = new Set<CodeSchema>(["awareness_pr", "awareness_ce"]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Order of first appearance in the answer, 1-based; unfound names follow
 * in label order (the dashboard fixture's ranking). */
export function rankMentions(mentions: { brand: string; framing: string }[], text: string) {
  const lower = text.toLowerCase();
  const pos = mentions.map((m, i) => ({ m, i, at: lower.indexOf(m.brand.toLowerCase()) }));
  pos.sort((a, b) => (a.at < 0 ? 1e9 + a.i : a.at) - (b.at < 0 ? 1e9 + b.i : b.at));
  return pos.map((p, k) => ({ brand: p.m.brand, framing: p.m.framing, rank: k + 1 }));
}

/** Code list on the confirmed book: exact or slug-equal names map to the
 * canonical code, deduped in order; anything else is returned off-list. */
export function splitCodes(list: unknown[], codes: string[]): { on: string[]; off: string[] } {
  const byNorm = new Map(codes.map((c) => [norm(c), c]));
  const on: string[] = [];
  const off: string[] = [];
  for (const x of list) {
    if (typeof x !== "string" || !x.trim()) continue;
    const c = codes.includes(x) ? x : byNorm.get(norm(x));
    if (c) {
      if (!on.includes(c)) on.push(c);
    } else if (!off.includes(x.trim())) off.push(x.trim());
  }
  return { on, off };
}
/** Off-list codes are kept, not dropped: they join the off-list channel. */
const withOffList = (uncoded: string, off: string[]) => [uncoded.trim(), ...off].filter(Boolean).join(", ");

export type ValidatedCodes =
  | { ok: true; row: AnswerCodes; notes: string[] }
  | { ok: false; why: string };

export interface RowBase {
  response_id: string;
  source: string;
  run_id: string;
  project_id: string;
}

/** One parsed reply -> an answer_codes row under the schema's asked
 * fields. Strict on the verdicts and lists the views read; tolerant (with
 * notes) on malformed list ENTRIES. */
export function toAnswerCodes(
  schema: CodeSchema,
  obj: Record<string, unknown>,
  base: RowBase,
  answerText: string,
  codes: string[]
): ValidatedCodes {
  const asked = new Set<string>(SCHEMA_FIELDS[schema]);
  if (RULES_SCHEMAS.has(schema)) asked.add("decision_rules");
  const notes: string[] = [];
  /** Off-list codes, appended to uncoded once the loop has read it. */
  const offList: string[] = [];
  const row: AnswerCodes = {
    ...base,
    contract: CODER_CONTRACT_ID,
    schema,
    outcome: null, top_pick: null, tier_stance: null, worth_it: null, proceed_or_avoid: null,
    keep_or_leave: null, premise_verdict: null, category_routed: null, relationship_verdict: null,
    case_strength: null, growth_stance: null, clarification_requested: null, includes_prices: null,
    includes_specs: null, quote: null, premise_quote: null, reasons: null, topics: null, uncoded: null,
    destinations: null, redirect_to: null, pairings: null, mentions: null, decision_rules: null,
  };
  const labelKey = (f: string) => (f === "uncoded" ? (AWARENESS.has(schema) ? "uncoded_topic" : "uncoded_reason") : f);
  for (const f of asked) if (!(labelKey(f) in obj)) return { ok: false, why: `missing field ${labelKey(f)}` };
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const strList = (v: unknown, f: string): string[] | null => {
    if (!Array.isArray(v)) return null;
    const out = v.filter((x): x is string => typeof x === "string" && !!x.trim());
    if (out.length !== v.length) notes.push(`${f}: dropped ${v.length - out.length} non-string entr${v.length - out.length === 1 ? "y" : "ies"}`);
    return out;
  };

  for (const f of asked) {
    const v = obj[labelKey(f)];
    switch (f) {
      case "outcome": case "tier_stance": case "worth_it": case "proceed_or_avoid": case "keep_or_leave":
      case "premise_verdict": case "category_routed": case "relationship_verdict": case "growth_stance": {
        if (typeof v !== "string" || !ENUMS[f].includes(v)) return { ok: false, why: `${f} ${JSON.stringify(v)} is off the contract` };
        (row as unknown as Record<string, unknown>)[f] = v;
        break;
      }
      case "case_strength": {
        if (typeof v !== "string" || !CASE_STRENGTH[schema]?.includes(v)) return { ok: false, why: `case_strength ${JSON.stringify(v)} is off the ${schema} contract` };
        row.case_strength = v;
        break;
      }
      case "clarification_requested": case "includes_prices": case "includes_specs": {
        if (typeof v !== "boolean") return { ok: false, why: `${f} is not a boolean` };
        row[f] = v;
        break;
      }
      case "top_pick": {
        const s = str(v)?.trim();
        row.top_pick = s && s.toLowerCase() !== "null" ? s : null;
        break;
      }
      case "quote": case "premise_quote": {
        if (v !== null && typeof v !== "string") return { ok: false, why: `${f} is neither text nor null` };
        row[f] = v === null || v === "" ? null : (v as string);
        break;
      }
      case "uncoded": {
        if (typeof v !== "string") return { ok: false, why: `${labelKey(f)} is not text` };
        row.uncoded = v;
        break;
      }
      case "reasons": case "topics": {
        if (!Array.isArray(v)) return { ok: false, why: `${f} is not a list` };
        const { on, off } = splitCodes(v, codes);
        if (off.length) notes.push(`${f}: ${off.length} off-list code(s) moved to uncoded`);
        row[f] = on;
        offList.push(...off);
        break;
      }
      case "destinations": case "redirect_to": {
        const l = strList(v, f);
        if (!l) return { ok: false, why: `${f} is not a list` };
        row[f] = l;
        break;
      }
      case "mentions": {
        if (!Array.isArray(v)) return { ok: false, why: "mentions is not a list" };
        const ok = v.filter((m): m is { brand: string; framing: string } =>
          isObj(m) && typeof m.brand === "string" && !!m.brand.trim() && typeof m.framing === "string" && FRAMINGS.has(m.framing));
        if (ok.length !== v.length) notes.push(`mentions: dropped ${v.length - ok.length} malformed entr${v.length - ok.length === 1 ? "y" : "ies"}`);
        row.mentions = rankMentions(ok.map((m) => ({ brand: m.brand.trim(), framing: m.framing })), answerText);
        break;
      }
      case "pairings": {
        if (!Array.isArray(v)) return { ok: false, why: "pairings is not a list" };
        const ok = v.filter((p): p is { name: string; maker_relation: string; framing: string } =>
          isObj(p) && typeof p.name === "string" && !!p.name.trim() && typeof p.maker_relation === "string" && MAKER.has(p.maker_relation) &&
          typeof p.framing === "string" && FRAMINGS.has(p.framing));
        if (ok.length !== v.length) notes.push(`pairings: dropped ${v.length - ok.length} malformed entr${v.length - ok.length === 1 ? "y" : "ies"}`);
        row.pairings = ok.map((p) => ({ name: p.name, maker_relation: p.maker_relation, framing: p.framing }));
        break;
      }
      case "decision_rules": {
        if (!Array.isArray(v)) return { ok: false, why: "decision_rules is not a list" };
        const ok: { condition: string; choice: string; product?: string }[] = [];
        for (const r of v) {
          if (!isObj(r) || typeof r.condition !== "string" || !r.condition.trim() || typeof r.choice !== "string" || !r.choice.trim()) continue;
          if (schema === "premium" && r.choice !== "premium" && r.choice !== "basic") continue;
          const rule: { condition: string; choice: string; product?: string } = { condition: r.condition, choice: r.choice };
          if (schema === "premium" && typeof r.product === "string" && r.product.trim()) rule.product = r.product;
          ok.push(rule);
        }
        if (ok.length !== v.length) notes.push(`decision_rules: dropped ${v.length - ok.length} malformed rule(s)`);
        row.decision_rules = ok;
        break;
      }
      default:
        return { ok: false, why: `no reader for asked field ${f}` };
    }
  }
  if (offList.length) row.uncoded = withOffList(row.uncoded ?? "", offList);
  // The contract's own rule: "top_pick: null unless pick".
  if (row.top_pick && row.outcome !== "pick") {
    notes.push(`top_pick "${row.top_pick}" dropped on outcome ${row.outcome}`);
    row.top_pick = null;
  }
  return { ok: true, row, notes };
}

/** Pass 2's reasons read: only reasons + uncoded_reason, normalized the
 * same way. Null = unusable (the row keeps pass 1's reasons). */
export function adapterReasons(obj: Record<string, unknown>, codes: string[]): { reasons: string[]; uncoded: string } | null {
  if (!Array.isArray(obj.reasons) || typeof obj.uncoded_reason !== "string") return null;
  const { on, off } = splitCodes(obj.reasons, codes);
  return { reasons: on, uncoded: withOffList(obj.uncoded_reason, off) };
}

// ---------------------------------------------------------------- one answer

export type CodedAnswer =
  | { ok: true; row: AnswerCodes; mode: string; degraded: string | null; notes: string[]; calls: CoderCallResult[] }
  /** The base coder answered but the reply breaks the contract - a terminal
   * per-row failure (the coder is deterministic at temperature 0, so the
   * same request would fail the same way). */
  | { ok: false; why: string; raw: string; calls: CoderCallResult[] };

/**
 * Code one answer. Pass-1 transport failures throw CoderTransportError (the
 * row stays uncoded and is retried by a later chunk); pass-2 failures of any
 * kind degrade to pass 1's reasons.
 */
export async function codeAnswer(args: {
  key: string;
  request: CoderRequest;
  base: RowBase;
  answerText: string;
  codes: string[];
  model?: string;
  adapter: string | null;
  hardStop?: number;
}): Promise<CodedAnswer> {
  const model = args.model ?? CODER_MODEL;
  const twoPass = !!args.adapter && !AWARENESS.has(args.request.schema);
  const [p1, p2] = await Promise.allSettled([
    callCoder(args.key, model, args.request, args.hardStop),
    twoPass ? callCoder(args.key, args.adapter!, args.request, args.hardStop) : Promise.resolve(null),
  ]);
  if (p1.status === "rejected") throw p1.reason;
  const calls = [p1.value, ...(p2.status === "fulfilled" && p2.value ? [p2.value] : [])];
  const parsed = parseCoderReply(p1.value.content);
  if (!parsed.ok) {
    return { ok: false, why: `unparseable reply (finish ${p1.value.finishReason ?? "unknown"})`, raw: p1.value.content, calls };
  }
  const v = toAnswerCodes(args.request.schema, parsed.obj, args.base, args.answerText, args.codes);
  if (!v.ok) return { ok: false, why: v.why, raw: p1.value.content, calls };
  let degraded: string | null = null;
  if (twoPass) {
    if (p2.status === "rejected") degraded = `adapter call failed: ${String((p2.reason as Error)?.message ?? p2.reason).slice(0, 160)}`;
    else {
      const p = parseCoderReply(p2.value!.content);
      const r = p.ok ? adapterReasons(p.obj, args.codes) : null;
      if (!r) degraded = p.ok ? "adapter reply carries no reasons / uncoded_reason" : `adapter reply unparseable (finish ${p2.value!.finishReason ?? "unknown"})`;
      else {
        v.row.reasons = r.reasons;
        v.row.uncoded = r.uncoded;
      }
    }
    if (degraded) v.row.contract = `${v.row.contract};reasons:base`;
  }
  return { ok: true, row: v.row, mode: parsed.mode, degraded, notes: v.notes, calls };
}

// ---------------------------------------------------------------- GPU ledger

/**
 * GPU-time estimate rows. A dedicated deployment bills replica-hours, not
 * tokens, so the per-call rows carry cost 0 and the spend is estimated
 * here. Basis: 1x H100 80GB at CODER_GPU_USD_PER_HOUR (default $8/hr, the
 * account's 1x H100 rate on record) x wall-clock while the wave held the
 * GPU busy - preflight (a scale-from-zero wake is billed) through the last
 * completed call of each chunk. One row per coding chunk; the chunks of a
 * wave sum to the wave. The scale-to-zero idle tail after the last request
 * (~1h by default) is logged once per wave as its own row
 * (CODER_IDLE_TAIL_HOURS, default 1) when the wave completes. Estimates,
 * marked as such in usage_raw; Fireworks' invoice is the authority.
 */
export function logCoderGpuEstimate(kind: "chunk" | "idle_tail", hours: number, detail: Record<string, unknown>): void {
  const rate = Number(process.env.CODER_GPU_USD_PER_HOUR ?? 8);
  const usd = Math.max(0, hours) * rate;
  if (!(usd > 0)) return;
  logCost({
    model: "fireworks-h100-dedicated",
    engine: "fireworks:gpu",
    purpose: "run:coding",
    usage: {
      inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, searches: 0,
      vendorCostUsd: usd,
      raw: { estimate: true, kind, hours, usd_per_hour: rate, accelerator: "1x NVIDIA_H100_80GB", ...detail },
    },
  });
}
