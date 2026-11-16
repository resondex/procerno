import { createHash } from "node:crypto";
import { store } from "../store";
import { withCostContext } from "../cost_log";
import { anthropicClient, openaiClient } from "./providers";
import { QUESTION_LABEL_MODEL } from "./models";
import type { CacheMeta } from "../types";

/**
 * The panel claims' question labels (am31, 2026-11-15, the owner's go): the
 * single-question map positions (What's popular, Learning the category, the
 * settled-customer questions) say what was actually asked. ONE short clause
 * per seed question completes "When a buyer/customer asks ___", written from
 * the brand's point of view ("you" / "your <product>"), checked mechanically
 * (validateLabel), retried once with the failed rule named, and cached
 * forever in llm_cache. No key, a failed call or the deadline -> the claim
 * quotes the tracker's own question verbatim (quotedAsk); a fallback while a
 * key WAS present marks the view incomplete so it is served uncached and
 * retried (the failed-theme-pass convention).
 *
 * The prompt describes the task in general terms only - no category or brand
 * examples (the standing rule); the tracker's question, brand and product
 * noun travel as data.
 */

export const QUESTION_LABEL_VERSION = "ql1";
const CACHE_TTL_MS = 100 * 365 * 24 * 3600 * 1000; // read forever - the saved-tracker rule
const DEADLINE_MS = 40_000;
const CONCURRENCY = 4;
const CALL_TIMEOUT_MS = 20_000;
export const LABEL_MAX_WORDS = 16;
export const LABEL_FIRST_WORDS = ["which", "what", "how", "whether", "if", "why", "who", "where", "when", "about"];

export interface LabelAsk {
  /** The map position the label is for. */
  id: string;
  /** The intent's seed question, as written. */
  seed: string;
  who: "buyer" | "customer";
  /** Advocacy: the quoted criticism the customer wants to answer (intent.concern), when stored. */
  criticism?: string | null;
}

export interface LabelContext {
  projectId: string;
  brand: string;
  category: string;
  /** The category's product noun, singular ("you" / "your <noun>"). */
  noun: string;
  /** The tracker's brand name forms: canonical, display name, aliases. */
  brandForms: string[];
  /** Every other brand name in the dictionary. */
  otherBrands: string[];
  meta?: CacheMeta;
}

export const QUESTION_LABEL_SYSTEM = [
  "You write one short label for a question that was put to AI assistants.",
  'The label completes the sentence "When a buyer asks ___" (or "When a customer asks ___") and names, in plain words, what the asker wants to know.',
  'Write it from the point of view of the brand given in the data: refer to that brand only as "you" or as "your" followed by the product noun given, never by its name.',
  "Rules:",
  `- Start with one of these words: ${LABEL_FIRST_WORDS.join(", ")}.`,
  "- Start with a lower-case letter.",
  `- Use at most ${LABEL_MAX_WORDS} words.`,
  "- No digits, no quotation marks, no dashes, and no punctuation at the end.",
  "- Do not name the brand, and do not name any other company, brand or product.",
  "- Say what is being asked, not how it is worded. Keep a detail of the asker's situation only when the label needs it to say what is being asked.",
  'Reply with JSON only: {"label": "<the label>"}.',
].join("\n");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (text: string, name: string) => {
  const n = name.trim();
  if (n.length < 2) return false;
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRe(n)}($|[^A-Za-z0-9])`, "i").test(text);
};

/** The first rule a label breaks, or null when it is clean. Pure. */
export function validateLabel(label: string, ctx: { brandForms: string[]; otherBrands: string[] }): string | null {
  const t = label.trim();
  if (!t) return "the label is empty";
  if (!/^[a-z]/.test(t)) return "it must start with a lower-case letter";
  const words = t.split(/\s+/);
  if (!LABEL_FIRST_WORDS.includes(words[0])) return `it must start with one of: ${LABEL_FIRST_WORDS.join(", ")}`;
  if (words.length > LABEL_MAX_WORDS) return `it must use at most ${LABEL_MAX_WORDS} words`;
  if (/[.?!,;:]$/.test(t)) return "it must not end with punctuation";
  if (/\d/.test(t)) return "it must contain no digits";
  if (/["“”]/.test(t) || /(^|\s)['‘’]|['‘’](\s|$)/.test(t)) return "it must contain no quotation marks";
  if (/[—–]|\s-\s|--/.test(t)) return "it must contain no dashes";
  for (const f of ctx.brandForms) if (wholeWord(t, f)) return "it must not name the brand - call it you or your";
  for (const f of ctx.otherBrands) if (wholeWord(t, f)) return "it must not name any other company or brand";
  return null;
}

/** The fallback form: the tracker's own question, verbatim. */
export const quotedAsk = (seed: string) => `"${seed.trim()}"`;

export const labelKey = (ctx: LabelContext, ask: LabelAsk, model = QUESTION_LABEL_MODEL) =>
  `question_label:${QUESTION_LABEL_VERSION}:${model}:${ctx.projectId}:${createHash("sha256")
    .update([ask.seed.trim(), ctx.brand, ctx.category, ask.who, ask.criticism?.trim() ?? ""].join("\n"))
    .digest("hex")
    .slice(0, 32)}`;

function keyConfigured(model: string): boolean {
  return Boolean(model.startsWith("gpt-") ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY);
}

/** The model call, swappable for zero-spend tests. Returns the raw reply text. */
export type LabelCaller = (system: string, user: string, model: string) => Promise<string>;

export const defaultLabelCaller: LabelCaller = async (system, user, model) => {
  if (model.startsWith("gpt-")) {
    const res = await openaiClient().chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: 2000,
      reasoning_effort: "none",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "question_label",
          strict: true,
          schema: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false },
        },
      },
    } as never);
    return (res as { choices: { message?: { content?: string | null } }[] }).choices[0]?.message?.content ?? "";
  }
  const a = await anthropicClient();
  const res = await a.messages.create({ model, max_tokens: 200, system, messages: [{ role: "user", content: user }] } as never);
  return (res as { content: { type: string; text?: string }[] }).content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
};

const parseLabel = (text: string): string | null => {
  try {
    const m = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { label?: unknown };
    return typeof m.label === "string" ? m.label.trim() : null;
  } catch {
    return null;
  }
};

export function labelUserMessage(ctx: LabelContext, ask: LabelAsk): string {
  return (
    `Brand: ${ctx.brand}\n` +
    `Product noun: ${ctx.noun}\n` +
    `Category: ${ctx.category}\n` +
    `Asker: ${ask.who === "buyer" ? "a buyer choosing in this category" : "an existing customer of the brand"}\n` +
    `The question:\n${ask.seed.trim()}\n` +
    (ask.criticism?.trim() ? `The criticism the customer wants to answer:\n${ask.criticism.trim()}\n` : "")
  );
}

/** One label: a call, a mechanical check, one retry naming the failed rule. Null when both fail. */
export async function writeLabel(ctx: LabelContext, ask: LabelAsk, call: LabelCaller = defaultLabelCaller, model = QUESTION_LABEL_MODEL): Promise<string | null> {
  const user = labelUserMessage(ctx, ask);
  const first = parseLabel(await call(QUESTION_LABEL_SYSTEM, user, model));
  const why = first === null ? "the reply was not the JSON asked for" : validateLabel(first, ctx);
  if (first !== null && !why) return first;
  const again = parseLabel(await call(QUESTION_LABEL_SYSTEM, `${user}\nYour last label broke this rule: ${why}. Write it again.`, model));
  return again !== null && !validateLabel(again, ctx) ? again : null;
}

export interface QuestionLabels {
  /** id -> the clause ("which ..."), or the quoted seed on fallback. */
  asked: Map<string, string>;
  /** Ids that fell back to the quoted seed. */
  fallback: Set<string>;
  /** A key was present and some label is missing: serve uncached, retry. */
  incomplete: boolean;
}

/**
 * The labels for every ask: one batch cache read, then model calls for the
 * misses (small concurrency, bounded by a deadline). Each ask falls back to
 * its quoted seed. Never throws.
 */
export async function questionLabels(
  asks: LabelAsk[],
  ctx: LabelContext,
  /** call / keyed / noCache: zero-spend tests (a stub model, no llm_cache read or write). */
  opts: { call?: LabelCaller; model?: string; deadlineMs?: number; keyed?: boolean; noCache?: boolean } = {}
): Promise<QuestionLabels> {
  const model = opts.model ?? QUESTION_LABEL_MODEL;
  const asked = new Map<string, string>();
  const fallback = new Set<string>();
  if (asks.length === 0) return { asked, fallback, incomplete: false };
  const keys = asks.map((a) => labelKey(ctx, a, model));
  let cached = new Map<string, string>();
  try {
    if (!opts.noCache) cached = await store.cacheGetMany([...new Set(keys)], CACHE_TTL_MS);
  } catch {
    /* treat as misses */
  }
  const misses: number[] = [];
  asks.forEach((a, i) => {
    const hit = cached.get(keys[i]);
    const label = hit ? parseLabel(hit) : null;
    if (label && !validateLabel(label, ctx)) asked.set(a.id, label);
    else misses.push(i);
  });
  const keyed = opts.keyed ?? keyConfigured(model);
  if (misses.length && keyed) {
    const call = opts.call ?? defaultLabelCaller;
    const deadline = Date.now() + (opts.deadlineMs ?? DEADLINE_MS);
    await withCostContext({ purpose: "views:question_label", projectId: ctx.projectId }, async () => {
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, misses.length) }, async () => {
          while (next < misses.length && Date.now() < deadline) {
            const i = misses[next++];
            try {
              const label = await Promise.race([
                writeLabel(ctx, asks[i], call, model),
                new Promise<null>((r) => setTimeout(() => r(null), CALL_TIMEOUT_MS).unref?.()),
              ]);
              if (!label) continue;
              asked.set(asks[i].id, label);
              if (!opts.noCache) await store.cacheSet(keys[i], JSON.stringify({ label }), ctx.meta).catch(() => {});
            } catch (err) {
              console.error("question label failed open:", err);
            }
          }
        })
      );
    });
  }
  let missing = 0;
  for (const a of asks) {
    if (asked.has(a.id)) continue;
    missing++;
    fallback.add(a.id);
    asked.set(a.id, quotedAsk(a.seed));
  }
  return { asked, fallback, incomplete: keyed && missing > 0 };
}
