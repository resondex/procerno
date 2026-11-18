/**
 * Ruling 15 (FACT_LAYER_DESIGN_2026-11-17.md): ONE rule decides which written names are one product, per run, used
 * everywhere. The rule has two parts:
 *
 *  1. WHAT IS A PRODUCT (the am43 / am44 product test, moved here from panel_build.ts productIndex /
 *     isPickedProduct): a name counts as one of a brand's products only when the run shows the AI telling buyers to
 *     choose it. Read off the answers that state decision rules (every question type but Habit): per brand and per
 *     name (its distinctive words: the name's words minus the brand's own name words and the category's nouns), the
 *     answers naming it, the answers choosing it (the pick, a rule's choice, or - for the tracker's own brand - a
 *     rule's product), and, for a rival, the answers only sending the buyer to it (a rule's product). A name seen in
 *     fewer than 5 such answers is not judged and stays a product; otherwise it is one when chosen in 2+ answers and
 *     5% of the answers naming it, or (a rival's name that is only ever where a verdict sends the buyer) sent in 2+
 *     answers and 25%. Programmes, lounges, portals, operating systems and apps are named, almost never chosen.
 *  2. WHICH NAMES ARE ONE PRODUCT: the brand's PICKS that pass the test, grouped by their distinctive words; a name
 *     whose words sit inside exactly one larger picked name of the same brand joins it (selections.ts productGroups,
 *     mode "merge" - the join the old "Which ... it picks" lines used, now once per run). Only picks form products:
 *     rule choices and products also write combined names ("Savor/SavorOne", "Everyday/Preferred") that would bridge
 *     two products and stop the join. A rule's name finds its product by the same words: a picked form, a product
 *     with a form of exactly those words, or the one product whose forms contain them; else it names no product.
 *
 * Each product carries a full name (the form most answers write) and a short name (the brand's leading words
 * dropped). The answer facts gain `pick.product` (null = the pick names no specific product of the brand), and the
 * set a lookup from (brand, name as written) to its product. Pure: reads the answer facts only, no model calls.
 */
import { famTokens } from "../brand_family";
import { pluralNoun, productNoun } from "../panel_text";
import type { AnswerFactSet, ProductInfo } from "./answer_facts";
import { brandNameTokens, productForm, productGroups, productTokens, shortProductName, type ProductItem } from "./selections";

const PRODUCT_MIN_NAMED = 5;
const PRODUCT_MIN_SHARE = 0.05;
const PRODUCT_MIN_CHOSEN = 2;
const PRODUCT_SENT_SHARE = 0.25;

export interface ProductTest {
  /** The test's key for a name as written: "<brand key>|<distinctive words>" (null = nothing beyond the brand). */
  keyOf: (written: string) => string | null;
  /** Counts per key. */
  index: Map<string, { named: number; chosen: number; sent: number }>;
  /** Does the name pass (is it a product)? A bare brand name is not a product. */
  passes: (written: string) => boolean;
}

/** The product test (part 1 of the rule), over the run's answer facts. */
export function productTest(set: AnswerFactSet, category: string): ProductTest {
  const T = set.target.key;
  const nouns = new Set([...famTokens(productNoun(category)), ...famTokens(pluralNoun(category))]);
  const own = new Map<string, Set<string>>();
  const keyOf = (written: string): string | null => {
    const r = set.resolve(written);
    if (!r.key) return null;
    let o = own.get(r.key);
    // A name the dictionary cannot place has no entry: its own words are the resolver's name for it (the old test's).
    if (!o) own.set(r.key, (o = r.entry || r.key === T ? brandNameTokens(set, r.key) : new Set(famTokens(r.name ?? written))));
    const toks = [...new Set(famTokens(productForm(written)).filter((t) => !o!.has(t) && !nouns.has(t)))].sort();
    return toks.length ? `${r.key}|${toks.join(" ")}` : null;
  };
  const index = new Map<string, { named: number; chosen: number; sent: number }>();
  for (const f of set.facts) {
    // Habit answers stay out (the old index was built before that card existed - no other list moves).
    if (f.type === "repertoire" || !f.rules?.length) continue;
    const chosen = new Set<string>();
    const named = new Set<string>();
    const sent = new Set<string>();
    for (const r of f.rules)
      if (r.product?.trim()) {
        const k = keyOf(r.product);
        if (k) (set.resolve(r.product).key === T ? chosen : sent).add(k);
      }
    for (const w of [f.pick.state !== "none" ? f.pick.written ?? "" : "", ...f.rules.map((r) => r.choice ?? "")]) {
      const k = w.trim() ? keyOf(w) : null;
      if (k) chosen.add(k);
    }
    for (const b of f.brands) if (b.mentioned) for (const w of b.forms) {
      const k = keyOf(w);
      if (k) named.add(k);
    }
    for (const k of new Set([...named, ...chosen, ...sent])) {
      const t = index.get(k) ?? { named: 0, chosen: 0, sent: 0 };
      t.named++;
      if (chosen.has(k)) t.chosen++;
      else if (sent.has(k)) t.sent++;
      index.set(k, t);
    }
  }
  const passes = (written: string) => {
    const k = keyOf(written);
    if (!k) return false;
    const t = index.get(k);
    if (!t || t.named < PRODUCT_MIN_NAMED) return true;
    return (t.chosen >= PRODUCT_MIN_CHOSEN && t.chosen / t.named >= PRODUCT_MIN_SHARE) || (t.sent >= PRODUCT_MIN_CHOSEN && t.sent / t.named >= PRODUCT_SENT_SHARE);
  };
  return { keyOf, index, passes };
}

export function attachProducts(set: AnswerFactSet, category: string): void {
  const test = productTest(set, category);
  const items: ProductItem[] = [];
  for (const f of set.facts) {
    const w = f.pick.written?.trim();
    if (f.pick.state !== "in_analysis" || !w || !test.passes(w)) continue;
    items.push({ answer: f.responseId, key: f.pick.key!, written: w });
  }
  const rows = productGroups(items, set, "merge", { category });
  const products = new Map<string, ProductInfo>();
  const byForm = new Map<string, string>();
  const formToks = new Map<string, { id: string; toks: Set<string> }[]>();
  const own = new Map<string, Set<string>>();
  for (const r of rows) {
    let o = own.get(r.key);
    if (!o) own.set(r.key, (o = brandNameTokens(set, r.key)));
    products.set(r.id, { id: r.id, key: r.key, full: r.name, short: shortProductName(r.name, o), forms: r.forms });
    for (const f of r.forms) {
      byForm.set(`${r.key}\u0000${f.toLowerCase()}`, r.id);
      const list = formToks.get(r.key) ?? [];
      list.push({ id: r.id, toks: new Set(productTokens(f, r.key, set, category)) });
      formToks.set(r.key, list);
    }
  }
  const memo = new Map<string, string | null>();
  const productOf = (brandKey: string, written: string): string | null => {
    const mk = `${brandKey}\u0000${productForm(written).toLowerCase()}`;
    if (memo.has(mk)) return memo.get(mk)!;
    let out: string | null = null;
    if (test.passes(written)) {
      out = byForm.get(mk) ?? null;
      if (!out) {
        const toks = productTokens(written, brandKey, set, category);
        const list = formToks.get(brandKey) ?? [];
        const exact = [...new Set(list.filter((x) => x.toks.size === toks.length && toks.every((t) => x.toks.has(t))).map((x) => x.id))];
        const within = [...new Set(list.filter((x) => toks.length > 0 && toks.every((t) => x.toks.has(t))).map((x) => x.id))];
        out = exact.length === 1 ? exact[0] : exact.length === 0 && within.length === 1 ? within[0] : null;
      }
    }
    memo.set(mk, out);
    return out;
  };
  set.products = products;
  set.productTest = test;
  set.productOf = productOf;
  for (const f of set.facts) if (f.pick.key && f.pick.written && f.pick.state === "in_analysis") f.pick.product = productOf(f.pick.key, f.pick.written);
}
