/**
 * The brand resolver (2026-10-02, Tyler's plan): ONE answer to "which
 * tracked brands does this text name", shared by the setup checks (seed
 * rule, paraphrase filter, gate edits) and the answer-side mentions path.
 *
 * Judgment and mechanics are split on purpose:
 * - a model lists the names it sees, VERBATIM as written (the design
 *   check's brands_named on the setup side; the coder's mentions on the
 *   answer side) - context decides "the doorbell ring" vs "Ring", which no
 *   string rule could (seven patches in one day said so);
 * - this module turns that list into roster entries mechanically: each
 *   listed name must appear in the text as a bounded phrase (so a
 *   hallucinated name can never flag a text), then resolves to a roster
 *   brand by matchKey or family containment against the brand's name and
 *   dictionary aliases (the same coRefers semantics brand observations use).
 * The verdict for a text is reproducible from its listed names. Pure - no
 * store or model imports - so it runs client-side too.
 */
import { matchKey } from "../brand_key";
import { coRefers, famTokens } from "./brand_family";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does the listed name occur in the text as a bounded phrase (case-blind,
 * plural-tolerant, flexible inner punctuation/spacing)? Stricter than
 * mention_filter's nameAppearsBounded on purpose: no dictionary shortcut and
 * no single-token fallback - the model was asked for the name as written,
 * so anything else is not in the text. */
export function phraseInText(text: string, name: string): boolean {
  const toks = name.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
  if (toks.length === 0) return false;
  const body = toks.map(esc).join("[^a-z0-9+]*");
  return new RegExp(`(?:^|[^a-z0-9])${body}(?:s|es|'s)?(?:$|[^a-z0-9])`, "i").test(text.toLowerCase());
}

/** A roster label's name-forms as token sequences: the speakable name, a
 * parenthetical's parts ("Max (HBO)" -> max, hbo; "GitHub (Issues/Projects)"
 * -> github, issues projects), slash alternatives, plus dictionary aliases. */
function nameForms(brand: string, aliases: string[] = []): string[][] {
  const out: string[][] = [];
  const base = brand.replace(/\s*\([^)]*\)/g, " ").trim();
  const paren = [...brand.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  for (const f of [base, ...base.split("/"), ...paren, ...paren.flatMap((p) => p.split("/")), ...aliases]) {
    const t = famTokens(f);
    if (t.length > 0) out.push(t);
  }
  // "GitHub Issues / Projects": the maker's name with each alternative.
  if (base.includes("/")) {
    const [head, ...alts] = base.split("/").map((x) => famTokens(x));
    const maker = head.slice(0, 1);
    for (const a of alts) if (a.length > 0) out.push([...maker, ...a]);
  }
  return out;
}

export interface ResolvedBrands {
  /** Roster brands the text names. */
  brands: string[];
  /** Listed names not found as a phrase in the text (never counted). */
  notInText: string[];
  /** Listed names in the text that resolve to no roster brand (free
   * vocabulary: upstream brands, retailers, other companies). */
  unresolved: string[];
}

/** Resolve a model's verbatim name list against a roster. */
export function resolveNamedBrands(
  text: string,
  listed: string[],
  roster: string[],
  aliases?: Record<string, string[]>
): ResolvedBrands {
  const forms = roster.map((b) => ({ b, seqs: nameForms(b, aliases?.[b]), keys: new Set([b, ...(aliases?.[b] ?? [])].map(matchKey)) }));
  const brands = new Set<string>();
  const notInText: string[] = [];
  const unresolved: string[] = [];
  for (const raw of listed) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    if (!phraseInText(text, name)) { notInText.push(name); continue; }
    const k = matchKey(name);
    const toks = famTokens(name);
    // Plural-tolerant ("Had Pixels for a while" listed "Pixels"; validation
    // 2026-10-02): try the name as written, then with a trailing s dropped.
    const sing = toks.map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
    const hits = forms.filter((f) => f.keys.has(k) || f.keys.has(matchKey(sing.join(" "))) || coRefers(toks, f.seqs) || coRefers(sing, f.seqs));
    if (hits.length === 0) unresolved.push(name);
    for (const h of hits) brands.add(h.b);
  }
  return { brands: roster.filter((b) => brands.has(b)), notInText, unresolved };
}
