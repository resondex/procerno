/**
 * Slices (fact layer, layer 2): a named filter on the answers of a scope - "the answers that pick you", "the answers
 * that say worth it", "the answers that name Chase as where to go". A slice is part of a fact's SCOPE (Scope.when),
 * so "share of answers arguing annual fee, among the answers that say leave" is one fact with one id, whichever card
 * draws it. A card's side of "What the answer weighs" is a slice; so is the base of a lost-with-an-exception row.
 *
 * Grammar (a string, so it can sit in a fact id):
 *   expr  := and ( "|" and )*          either
 *   and   := atom ( "&" atom )*        both
 *   atom  := "!" atom | term            not
 *   term  := pick:you | pick:rival | pick:other | pick:<bucket> | pick:<key> | pick:other:<key>
 *          | v:<verdict field>:<value>[,<value>...]
 *          | named:<key> | rec:<key> | frec:<key> | neg:<key>
 *          | sent:<key> | instead:<key> | rec:anyother | sent:any | instead:any
 *          | cond:<side>            the answer states any condition on that side (toward / away)
 *          | anybrand               the answer names a brand in analysis
 *          | first:<key>            the first brand in analysis the answer names (order of appearance) is that brand
 *          | firstsent:<key>        of the brands it sends the buyer to, the one it names first is that brand (a brand
 *                                   it never mentions in the text sits after the mentioned ones, in the order coded)
 *          | firstrec:<key>         of the other brands it recommends (rec:anyother), the one it names first
 *          | nargs:<lo>-<hi>        the answer argues between lo and hi distinct arguments or topics
 *          | nsent:<lo>-<hi>        it sends the buyer to between lo and hi brands in analysis
 *          | npair:<lo>-<hi>        it names between lo and hi products to use alongside (pairings with a name)
 *          | pair:<relation>        it names a product alongside of that maker relation (own / third_party / ...)
 *          | ruleprod:<choice>:<key> a decision rule choosing <choice> (premium / basic / cheaper ...) names a
 *                                   product of that brand (its product resolves to the brand)
 *          | pickprod:<product id>  the pick names that product of the run's product grouping (products.ts)
 *          | sentname:<name>        it sends the buyer to that name: a brand in analysis by its name, else as written
 *                                   (case set aside)
 *          | cond:<side>:<grouping> it states a condition row on that side in that grouping (theme / group), the
 *                                   default clause ("otherwise") left out
 *          | nameprod:<product id>  it names that product of the run's product grouping (any written form of its brand)
 *          | suggprod:<product id>  it suggests that product: a form of its brand framed recommended, or a rule's choice
 *                                   or product naming it
 *          | firstprod:<key>:<product id | none>  the brand's first written form names that product (none: no product)
 *          | sentprod:<product id>  it sends the buyer to that product: a destination as written names it (a rival's,
 *                                   or the tracker's own other product)
 *          | insteadprod:<product id>  a price answer recommends that rival product instead (a form framed recommended
 *                                   of a rival it recommends instead - ruling 3's rival list)
 *          | ownopt:<product id>    a price answer points to that product of the tracker as its own cheaper option
 *          | rulename:<choice>:<form>,<form>...  a rule choosing <choice> names, as its product, one of these names as
 *                                   written (no brand in the category; each form URI-encoded, lower case)
 *   <key>   a brand's dictionary entry id, "you" (the tracker) or "rival" (the answer's own named rival)
 *   <bucket> none | in_analysis | outside_analysis | outside_category  (ruling 8)
 *
 * Definitions (each stated once here):
 *  - pick:other      the pick is a brand in analysis other than the tracker (ruling 2: "another brand is picked");
 *  - rec:<key>       the brand is recommended, the pick counting as a recommendation (ruling 6);
 *  - frec:<key>      framed recommended in the text, the pick NOT counted (today's mention-only count, kept so a card
 *                    that still leaves the pick out can be reproduced while it moves onto ruling 6);
 *  - rec:anyother    some brand other than the tracker is recommended (ruling 6), in or outside of analysis but in the
 *                    category - the Habit card's "suggests another brand";
 *  - sent:<key>      the brand is among the places the answer sends the buyer (destinations or redirects);
 *  - instead:<key>   the price answer recommends that rival (ruling 3's rival list).
 *
 * Pure: reads AnswerFact records only.
 */
import type { AnswerFact, AnswerFactSet, Bucket } from "./answer_facts";
import { VERDICT_FIELDS, type VerdictField } from "./answer_facts";
import { isDefaultCondition } from "../condition_groups";
import { famTokens } from "../brand_family";
import { isDescription } from "../value";
import { pluralNoun, productNoun } from "../panel_text";

const BUCKETS = new Set(["none", "in_analysis", "outside_analysis", "outside_category"]);

type Pred = (f: AnswerFact) => boolean;

/** A brand key as written in a slice: "you" = the tracker; "rival" = per answer. */
function keyFn(raw: string, set: AnswerFactSet): (f: AnswerFact) => string | null {
  if (raw === "you") return () => set.target.key;
  if (raw === "rival") return (f) => f.rival?.key ?? null;
  return () => raw;
}

function term(t: string, set: AnswerFactSet): Pred {
  const [head, ...rest] = t.split(":");
  const arg = rest.join(":");
  switch (head) {
    case "pick": {
      if (arg === "other") return (f) => f.pick.state === "in_analysis" && f.pick.key !== set.target.key;
      if (arg.startsWith("other:")) {
        const k = keyFn(arg.slice(6), set);
        return (f) => f.pick.state === "in_analysis" && f.pick.key !== k(f);
      }
      if (BUCKETS.has(arg)) return (f) => f.pick.state === arg;
      const k = keyFn(arg, set);
      return (f) => f.pick.state !== "none" && !!f.pick.key && f.pick.key === k(f);
    }
    case "v": {
      const i = arg.indexOf(":");
      const field = arg.slice(0, i) as VerdictField;
      if (!VERDICT_FIELDS.includes(field)) throw new Error(`fact layer: slice "${t}": no verdict field "${field}"`);
      const values = new Set(arg.slice(i + 1).split(","));
      return (f) => values.has(f.verdicts[field] ?? "");
    }
    case "named":
    case "rec":
    case "frec":
    case "neg": {
      if (head === "rec" && arg === "anyother")
        return (f) => f.brands.some((b) => b.key !== set.target.key && b.recommended && b.bucket !== "outside_category");
      const k = keyFn(arg, set);
      return (f) => {
        const key = k(f);
        return !!key && f.brands.some((b) => b.key === key && (head === "named" || (head === "rec" ? b.recommended : head === "frec" ? b.framedRecommended : b.negative)));
      };
    }
    case "sent": {
      if (arg === "any") return (f) => (f.sent?.brands.length ?? 0) > 0;
      const k = keyFn(arg, set);
      return (f) => !!f.sent?.brands.some((b) => b.key === k(f));
    }
    case "instead": {
      if (arg === "any") return (f) => (f.price?.rivals.length ?? 0) > 0;
      const k = keyFn(arg, set);
      return (f) => !!f.price?.rivals.some((b) => b.key === k(f));
    }
    case "cond": {
      const [side, grouping] = arg.split(":");
      if (grouping) return (f) => !!f.conds?.some((c) => c.side === side && c.grouping === grouping && !isDefaultCondition(c.label));
      return (f) => !!f.conds?.some((c) => c.side === side);
    }
    case "anybrand":
      return (f) => f.brands.some((b) => b.bucket === "in_analysis");
    case "first": {
      const k = keyFn(arg, set);
      return (f) => f.brands.filter((b) => b.bucket === "in_analysis").sort((a, b) => a.order - b.order)[0]?.key === k(f);
    }
    case "firstsent": {
      const k = keyFn(arg, set);
      return (f) => {
        const x = firstSentOf(f);
        return !!x && x.key === k(f);
      };
    }
    case "firstrec": {
      const k = keyFn(arg, set);
      return (f) => {
        const xs = f.brands.filter((b) => b.key !== set.target.key && b.recommended && b.bucket !== "outside_category").map((b) => ({ key: b.key, o: b.mentioned ? b.order : 1000 + b.order })).sort((a, b) => a.o - b.o);
        return xs.length > 0 && xs[0].key === k(f);
      };
    }
    case "nargs":
    case "nsent":
    case "npair": {
      const [lo, hi] = arg.split("-").map(Number);
      const count = (f: AnswerFact) => (head === "nargs" ? (f.args ?? []).length : head === "nsent" ? (f.sent?.brands.length ?? 0) : (f.pairings ?? []).filter((p) => p.name.trim()).length);
      return (f) => count(f) >= lo && count(f) <= hi;
    }
    case "pair":
      return (f) => !!f.pairings?.some((p) => p.name.trim() && p.relation === arg);
    case "ruleprod": {
      const i = arg.indexOf(":");
      const choice = arg.slice(0, i);
      const k = keyFn(arg.slice(i + 1), set);
      return (f) => !!f.rules?.some((r) => r.choice.trim() === choice && !!r.product?.trim() && set.resolve(r.product.trim()).key === k(f));
    }
    case "pickprod":
      // The run's product the pick names (products.ts, ruling 15).
      // "none": a pick of a brand in analysis that names no specific product of it (the bare brand, or a name the
      // product test says is not a product).
      if (arg === "none") return (f) => f.pick.state === "in_analysis" && !f.pick.product;
      return (f) => f.pick.state === "in_analysis" && !!f.pick.product && f.pick.product === arg;
    case "nameprod":
    case "suggprod": {
      const pid = arg;
      return (f) => {
        const key = set.products?.get(pid)?.key;
        return !!key && productsOf(f, key, head === "suggprod", set).includes(pid);
      };
    }
    case "firstprod": {
      const i = arg.lastIndexOf(":");
      const k = keyFn(arg.slice(0, i), set);
      const want = arg.slice(i + 1);
      return (f) => {
        const key = k(f);
        if (!key) return false;
        const pid = firstProductOf(f, key, set);
        return want === "none" ? pid === null : pid === want;
      };
    }
    case "sentprod":
      return (f) => sentProductsOf(f, set).includes(arg);
    case "insteadprod":
      return (f) => insteadProductsOf(f, set).includes(arg);
    case "insteadbrandprod":
      // A price answer recommends, instead, some product of that rival (the run's one product grouping).
      return (f) => insteadProductsOf(f, set).some((pid) => set.products?.get(pid)?.key === arg);
    case "ownopt":
      return (f) => ownOptionProductsOf(f, set).includes(arg);
    case "rulename": {
      const i = arg.indexOf(":");
      const choice = arg.slice(0, i);
      const forms = new Set(arg.slice(i + 1).split(",").map((x) => decodeURIComponent(x)));
      return (f) => !!f.rules?.some((r) => r.choice.trim() === choice && !!r.product?.trim() && set.resolve(r.product.trim()).status !== "active" && forms.has(looseForm(r.product.trim()).toLowerCase()));
    }
    case "pairin":
    case "firstpair": {
      // A pairings selection's member (selections.ts "pairings" / "first_pairing"): "d:<entry>" a brand in analysis,
      // "~w:<forms>" names as written (each URI-encoded); firstpair = the answer's first named pairing is it.
      const d = arg.startsWith("d:") ? arg.slice(2) : null;
      const pid = arg.startsWith("p:") ? arg.slice(2) : null;
      const forms = d || pid ? null : new Set(arg.replace(/^~w:/, "").split(",").map((x) => decodeURIComponent(x)));
      const is = (p: NonNullable<AnswerFact["pairings"]>[number]) =>
        pairingCounts(p, set) && (d ? p.bucket === "in_analysis" && p.key === d : pid ? pairingProduct(p, set) === pid : (head === "firstpair" ? !pairingProduct(p, set) : p.bucket !== "in_analysis") && forms!.has(p.name.trim()));
      if (head === "firstpair") return (f) => {
        const p = (f.pairings ?? []).find((x) => x.name.trim());
        return !!p && is(p);
      };
      return (f) => !!f.pairings?.some(is);
    }
    case "pairrel":
      // It names something alongside of that maker relation; "own" never counts the tracker's bare name.
      return (f) =>
        !!f.pairings?.some((p) => p.relation === arg && !(arg === "own" && p.key === set.target.key && !set.productTest?.passes(p.name.trim())));
    case "sentw": {
      const want = decodeURIComponent(arg);
      return (f) => !!f.sent?.outside.some((w) => w.trim().toLowerCase() === want);
    }
    case "sentname": {
      const want = arg.trim().toLowerCase();
      return (f) => !!f.sent && (f.sent.brands.some((b) => b.name.toLowerCase() === want) || f.sent.outside.some((w) => w.trim().toLowerCase() === want));
    }
    default:
      throw new Error(`fact layer: slice "${t}": unknown term "${head}"`);
  }
}


/** An alongside pairing a card counts: a name with a capital or a digit (never a generic word in lower case), never the
 * tracker's bare name (resolves to it and names no product of it - the run's one product grouping), never a brand outside
 * of analysis (ruling 8). */
export function pairingCounts(p: { name: string; key: string | null; bucket: string }, set: AnswerFactSet): boolean {
  const nm = p.name.trim();
  if (!nm || !/[A-Z0-9]/.test(nm)) return false;
  if (p.bucket === "outside_analysis") return false;
  if (p.key === set.target.key && !set.productTest?.passes(nm)) return false;
  return true;
}

/** The first-named list's member for a pairing (selections.ts "first_pairing"): a product of a brand in analysis by the
 * run's one product grouping ("p:<product id>"), else null (grouped as written). */
export const pairingProduct = (p: { name: string; key: string | null; bucket: string }, set: AnswerFactSet): string | null =>
  p.bucket === "in_analysis" && p.key ? (set.nameProductOf ?? set.productOf)?.(p.key, p.name.trim()) ?? null : null;

/** A product name as written, cleaned for display: no trade marks, no "from <maker>" tail. */
export const looseForm = (x: string) => x.replace(/[®™]/g, "").replace(/\s+from\s+.+$/i, "").replace(/\s+/g, " ").trim() || x.trim();

/** The run's products (picked, or named and never picked - nameProductOf) of one brand an answer names (any written form), or suggests (`suggest`: a form framed
 * recommended, or a rule's choice or product resolving to the brand) - the run's one product grouping (ruling 15). */
export function productsOf(f: AnswerFact, key: string, suggest: boolean, set: AnswerFactSet): string[] {
  const of = set.nameProductOf ?? set.productOf;
  if (!of) return [];
  const b = f.brands.find((x) => x.key === key);
  const forms = suggest
    ? [...(b?.recForms ?? []), ...(f.rules ?? []).flatMap((r) => [r.choice, r.product ?? ""]).map((w) => w.trim()).filter((w) => w && set.resolve(w).key === key)]
    : b?.forms ?? [];
  const out: string[] = [];
  for (const w of forms) {
    const pid = of(key, w);
    if (pid && !out.includes(pid)) out.push(pid);
  }
  return out;
}

/** Of the brands an answer sends the buyer to, the one it names first (order of appearance; a brand it never mentions
 * in the text sits after the mentioned ones, in the order coded). */
export function firstSentOf(f: AnswerFact): { key: string; name: string } | null {
  const ord = new Map(f.brands.filter((b) => b.mentioned).map((b) => [b.key, b.order]));
  const xs = (f.sent?.brands ?? []).map((b, i) => ({ b, o: ord.get(b.key) ?? 1000 + i })).sort((a, b) => a.o - b.o);
  return xs.length ? { key: xs[0].b.key, name: xs[0].b.name } : null;
}

/** A name the AI gives as one of the TRACKER's own products (a destination resolving to it, a price answer's own cheaper
 * option): its product in the run's one grouping (ruling 15) - the name as written, else the name under the tracker's
 * own name (an option written without the brand, "the ad tier", is still the tracker's: the answer facts placed it
 * there). A description ("a cheaper plan", "any card") is never a product. */
export function ownProductOf(set: AnswerFactSet, written: string): string | null {
  const of = set.nameProductOf ?? set.productOf;
  const w = written.trim();
  if (!of || !w || isDescription(looseForm(w)) || /^(any|a|an|the|another|some)\s/i.test(looseForm(w)) || !/^[A-Za-z0-9]/.test(looseForm(w))) return null;
  return of(set.target.key, w) ?? of(set.target.key, `${set.target.name} ${w}`);
}

const pushNew = (out: string[], pid: string | null) => {
  if (pid && !out.includes(pid)) out.push(pid);
};

/** The products an answer sends the buyer to (destinations as written): a rival's products, and the tracker's own
 * other products (ownProductOf). */
export function sentProductsOf(f: AnswerFact, set: AnswerFactSet): string[] {
  const of = set.nameProductOf ?? set.productOf;
  const out: string[] = [];
  if (!f.sent || !of) return out;
  for (const b of f.sent.brands) for (const w of b.forms) pushNew(out, of(b.key, w));
  for (const w of f.sent.own) pushNew(out, ownProductOf(set, w));
  return out;
}

/** The rival products a price answer recommends instead: the forms framed recommended of the rivals it recommends
 * instead (ruling 3's rival list), in the run's one grouping. */
export function insteadProductsOf(f: AnswerFact, set: AnswerFactSet): string[] {
  const of = set.nameProductOf ?? set.productOf;
  const out: string[] = [];
  if (!f.price || !of) return out;
  for (const r of f.price.rivals) for (const w of f.brands.find((b) => b.key === r.key)?.recForms ?? []) pushNew(out, of(r.key, w));
  return out;
}

/** The tracker's products a price answer points to as its own cheaper option - every one it names, whether or not it
 * also names a rival (the answer's ruling-3 bucket is a separate fact). */
export function ownOptionProductsOf(f: AnswerFact, set: AnswerFactSet): string[] {
  const out: string[] = [];
  for (const o of f.price?.own ?? []) pushNew(out, ownProductOf(set, o.written));
  return out;
}

/** The product the brand's first written form names: its product id; null when that form names no product of the
 * brand (the bare brand, or a name the product test says is not a product - "no specific product named"); "~unplaced"
 * when it names a product the run's grouping holds no row for (a product no answer picks: never "no specific"). */
export function firstProductOf(f: AnswerFact, key: string, set: AnswerFactSet): string | null {
  const b = f.brands.find((x) => x.key === key);
  const of = set.nameProductOf ?? set.productOf;
  if (!b || !of) return null;
  const pid = of(key, b.written);
  if (pid) return pid;
  return set.productTest?.passes(b.written) ? "~unplaced" : null;
}

/** A description of a tier end ("a cheaper one", "premium ones"): never a named example. */
const isEndDescription = (clean: string) => isDescription(clean) || /\b(premiums?|top[- ]tier)\b/i.test(clean);

/** Who a set of answers gives as the example of one end (Premium vs basic): per answer, the products its rules choosing
 * that end name - a brand in the category by its entry id (never a brand outside of analysis, ruling 8), any other name
 * as written in groups (plural endings one; a name whose words sit inside exactly one larger name joins it), keyed
 * "~n:<form>,<form>" (each form URI-encoded, lower case). Counted by answers, most first, ties by name. */
export function endItems(rows: AnswerFact[], choice: string, set: AnswerFactSet, category: string): { key: string; name: string; count: number }[] {
  const T = set.target.key;
  const active = new Map<string, { name: string; ids: Set<string> }>();
  const loose: { form: string; id: string }[] = [];
  for (const f of rows)
    for (const r of f.rules ?? []) {
      if (r.choice.trim() !== choice) continue;
      const w = (r.product ?? "").trim();
      if (!w) continue;
      const res = set.resolve(w);
      if (res.status === "active") {
        if (set.bucketOf(res.key) !== "in_analysis") continue;
        const t = active.get(res.key) ?? { name: res.key === T ? "You" : set.nameOf(res.key), ids: new Set<string>() };
        t.ids.add(f.responseId);
        active.set(res.key, t);
        continue;
      }
      const clean = looseForm(w);
      if (isEndDescription(clean)) continue;
      loose.push({ form: clean, id: f.responseId });
    }
  // Plural endings first, then the name-variant join (the category's own nouns and small words set aside).
  const STOP = new Set(["the", "from", "by", "of", "a", "an", "and", "with", "for"]);
  const nouns = new Set([...famTokens(productNoun(category)), ...famTokens(pluralNoun(category))]);
  type G = { forms: Map<string, number>; ids: Set<string>; toks: Set<string> };
  const sing = new Map<string, G>();
  for (const x of loose) {
    const k = famTokens(x.form).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)).join(" ") || x.form.toLowerCase();
    const g = sing.get(k) ?? { forms: new Map<string, number>(), ids: new Set<string>(), toks: new Set<string>() };
    g.forms.set(x.form, (g.forms.get(x.form) ?? 0) + 1);
    g.ids.add(x.id);
    sing.set(k, g);
  }
  const by = new Map<string, G>();
  for (const g of sing.values()) {
    const top = [...g.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0];
    const toks = famTokens(top);
    const kept = toks.filter((t) => !nouns.has(t) && !STOP.has(t));
    const key = kept.join(" ") || toks.join(" ") || top.toLowerCase();
    const h = by.get(key) ?? { forms: new Map<string, number>(), ids: new Set<string>(), toks: new Set(kept) };
    for (const [f, n] of g.forms) h.forms.set(f, (h.forms.get(f) ?? 0) + n);
    for (const id of g.ids) h.ids.add(id);
    by.set(key, h);
  }
  for (const key of [...by.keys()].sort((a, b) => by.get(a)!.toks.size - by.get(b)!.toks.size)) {
    const g = by.get(key)!;
    if (!g.toks.size) continue;
    const sup = [...by.entries()].filter(([k2, g2]) => k2 !== key && g2.toks.size > g.toks.size && [...g.toks].every((t) => g2.toks.has(t)));
    if (sup.length !== 1) continue;
    const into = sup[0][1];
    for (const [f, n] of g.forms) into.forms.set(f, (into.forms.get(f) ?? 0) + n);
    for (const id of g.ids) into.ids.add(id);
    by.delete(key);
  }
  const up = (x: string) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
  return [
    ...[...active.entries()].map(([key, x]) => ({ key, name: x.name, count: x.ids.size })),
    ...[...by.values()].map((g) => ({
      key: `~n:${[...g.forms.keys()].map((f) => encodeURIComponent(f.toLowerCase())).sort().join(",")}`,
      name: up([...g.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0]),
      count: g.ids.size,
    })),
  ].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function atom(a: string, set: AnswerFactSet): Pred {
  if (a.startsWith("!")) {
    const p = atom(a.slice(1), set);
    return (f) => !p(f);
  }
  return term(a, set);
}

const memo = new WeakMap<AnswerFactSet, Map<string, Pred>>();

/** The slice as a predicate (memoized per set). */
export function slicePred(expr: string, set: AnswerFactSet): Pred {
  let m = memo.get(set);
  if (!m) memo.set(set, (m = new Map()));
  let p = m.get(expr);
  if (p) return p;
  const ors = expr.split("|").map((and) => and.split("&").map((a) => atom(a, set)));
  p = (f) => ors.some((ands) => ands.every((q) => q(f)));
  m.set(expr, p);
  return p;
}

/** Ruling 8 buckets, for slice authors. */
export type { Bucket };
