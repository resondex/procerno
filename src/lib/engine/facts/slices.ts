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
    case "cond":
      return (f) => !!f.conds?.some((c) => c.side === arg);
    case "anybrand":
      return (f) => f.brands.some((b) => b.bucket === "in_analysis");
    case "first": {
      const k = keyFn(arg, set);
      return (f) => f.brands.filter((b) => b.bucket === "in_analysis").sort((a, b) => a.order - b.order)[0]?.key === k(f);
    }
    case "firstsent": {
      const k = keyFn(arg, set);
      return (f) => {
        const ord = new Map(f.brands.filter((b) => b.mentioned).map((b) => [b.key, b.order]));
        const xs = (f.sent?.brands ?? []).map((b, i) => ({ key: b.key, o: ord.get(b.key) ?? 1000 + i })).sort((a, b) => a.o - b.o);
        return xs.length > 0 && xs[0].key === k(f);
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
    case "sentname": {
      const want = arg.trim().toLowerCase();
      return (f) => !!f.sent && (f.sent.brands.some((b) => b.name.toLowerCase() === want) || f.sent.outside.some((w) => w.trim().toLowerCase() === want));
    }
    default:
      throw new Error(`fact layer: slice "${t}": unknown term "${head}"`);
  }
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
