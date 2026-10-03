/**
 * The brand judge (r15, Tyler's option B, 2026-10-02): a small model decides
 * the one case brand-name strings cannot - a ONE-WORD brand form that is
 * also an everyday word, found lowercase or opening a sentence ("the
 * doorbell ring", "an epic fail", "2-3 services max", "my pixel keeps
 * dropping calls"). battery_checks.brandMentions lists those hits as
 * pending; primeBrandVerdicts asks the model about each one ONCE (cached in
 * llm_cache, keyed by model + brand + form + text) and loads the verdicts
 * into the sync checker before the checks run. Failures leave the hit
 * unjudged, which the checker counts as named - never a missed leak.
 */
import { createHash } from "crypto";
import { anthropicClient } from "./providers";
import { store } from "../store";
import { withCostContext } from "../cost_log";
import { brandMentions, setBrandVerdict } from "./battery_checks";
import type { CacheMeta } from "../types";

export const BRAND_JUDGE_MODEL = process.env.BRAND_JUDGE_MODEL ?? "claude-haiku-4-5-20251001";
const JUDGE_VERSION = "j1";
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000;

export const BRAND_JUDGE_SYSTEM =
  "You decide whether a word in a short question refers to a specific brand or is used as an ordinary word. " +
  "Judge only the question's own words. Lowercase or casual spelling can still be the brand. " +
  'Reply with ONLY {"refers": true} or {"refers": false}.';

const cat = (category: string) => new Set(category.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean));

function judgeKey(text: string, brand: string, form: string): string {
  const norm = `${brand.trim().toLowerCase()}|${form}|${text.trim().toLowerCase().replace(/\s+/g, " ")}`;
  return `brand_judge:${JUDGE_VERSION}:${BRAND_JUDGE_MODEL}:${createHash("sha256").update(norm).digest("hex")}`;
}

/** The pending (text, brand, form) judgments for a set of texts. */
export function pendingJudgments(
  texts: string[], roster: string[], aliases: Record<string, string[]>, category: string,
  /** The full tracked roster (scrubbing context) when `roster` is only the
   * brands to judge (a cell's forbidden set). */
  allRoster?: string[]
): { text: string; brand: string; form: string }[] {
  const ex = cat(category);
  const out = new Map<string, { text: string; brand: string; form: string }>();
  for (const text of new Set(texts)) for (const brand of roster)
    for (const form of brandMentions(text, brand, { extraForms: aliases[brand], excludeTokens: ex, others: (allRoster ?? roster).filter((x) => x !== brand) }).pending)
      out.set(`${brand}|${form}|${text}`, { text, brand, form });
  return [...out.values()];
}

/** Judge one hit (no cache). */
export async function judgeBrandMention(item: { text: string; brand: string; form: string }, category: string, model = BRAND_JUDGE_MODEL): Promise<boolean | null> {
  const a = await anthropicClient();
  const res = await a.messages.create({
    model,
    max_tokens: 50,
    system: BRAND_JUDGE_SYSTEM,
    messages: [{
      role: "user",
      content: `Brand: ${item.brand} (a ${category} brand)\nWord: "${item.form}"\nQuestion: ${item.text}\n\nIn this question, does "${item.form}" refer to the brand ${item.brand}?`,
    }],
  } as never);
  const t = (res as { content: { type: string; text?: string }[] }).content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const m = t.match(/"refers"\s*:\s*(true|false)/i);
  return m ? m[1].toLowerCase() === "true" : null;
}

/** Load verdicts for every pending ambiguous hit into the sync checker:
 * cached verdicts first (one batch read), then model calls for the misses
 * (bounded concurrency and time). `items` pairs each text with the brands
 * that matter for it - a cell's FORBIDDEN brands; a required brand never
 * needs a verdict (the must-name check is tolerant). Fails open per hit. */
export async function primeBrandVerdicts(input: {
  items: { text: string; brands: string[] }[]; roster: string[]; aliases: Record<string, string[]>; category: string; meta?: CacheMeta;
}): Promise<void> {
  const seen = new Map<string, { text: string; brand: string; form: string }>();
  for (const x of input.items)
    for (const p of pendingJudgments([x.text], x.brands, input.aliases, input.category, input.roster))
      seen.set(`${p.brand}|${p.form}|${p.text}`, p);
  const items = [...seen.values()];
  if (items.length === 0) return;
  const keys = items.map((i) => judgeKey(i.text, i.brand, i.form));
  let cached: Map<string, string>;
  try { cached = await store.cacheGetMany(keys, CACHE_TTL_MS); } catch { cached = new Map(); }
  const misses: number[] = [];
  items.forEach((it, i) => {
    const hit = cached.get(keys[i]);
    if (hit === "true" || hit === "false") setBrandVerdict(it.text, it.brand, it.form, hit === "true");
    else misses.push(i);
  });
  if (misses.length === 0) return;
  const deadline = Date.now() + 25_000;
  await withCostContext({ purpose: "setup:brand_judge" }, async () => {
    let k = 0;
    await Promise.all(Array.from({ length: Math.min(8, misses.length) }, async () => {
      while (k < misses.length && Date.now() < deadline) {
        const i = misses[k++];
        const it = items[i];
        try {
          const v = await Promise.race([
            judgeBrandMention(it, input.category),
            new Promise<null>((r) => setTimeout(() => r(null), 15_000).unref?.()),
          ]);
          if (v === null) continue;
          setBrandVerdict(it.text, it.brand, it.form, v);
          await store.cacheSet(keys[i], String(v), input.meta).catch(() => {});
        } catch (err) {
          console.error("brand judge failed open:", err);
        }
      }
    }));
  });
}
