/**
 * Layer 1 of the fact layer (FACT_LAYER_DESIGN_2026-11-17.md, step 2): ONE resolved record per coded answer,
 * computed once from the shared view data (the same ViewData every view reads). It is the only place in the fact
 * layer where a brand name is resolved, and the only place the basic ideas are defined:
 *
 *  - the question: its type, buying situation, worry, the rival or class brand it names, the price line asked about,
 *    the assistant (vendor, tier, mode), the prompt and the cell (intent);
 *  - the pick, in exactly one of four states (ruling 8): none, a brand in analysis, a brand outside of analysis, or
 *    something outside the category. "In analysis" = an active dictionary entry whose analyzed flag is not turned
 *    off (the tracker's own brand is always in analysis);
 *  - every brand named, with its recommended and negative flags, its order of first appearance and its bucket. A
 *    pick always counts as named and recommended (ruling 6);
 *  - every verdict the question type asks, and only those: a field the type does not ask is absent, and a blank or
 *    off-list value where it IS asked throws (ruling 1 - a coding error);
 *  - arguments (reasons) or topics, whichever the schema asks;
 *  - where the buyer is sent (destinations, or redirects on the settled questions), split into brands in analysis,
 *    the tracker's own other products and names outside;
 *  - the price question's "instead" bucket (ruling 3): a rival first, else the tracker's own cheaper option (only
 *    when the tracker sells a ladder of its own lines), else nowhere;
 *  - pairings, and the decision rules as coded (condition text, the choice resolved, the product);
 *  - the conditions it states (`conds`): each rule's condition group and reason theme, read from the run's saved
 *    grouping and themes by attachConditions (conditions.ts, async - it reads the shared run themes).
 *
 * buildAnswerFacts is pure: reads ViewData, writes nothing, calls no model. Built beside the existing counters;
 * nothing on screen reads it yet.
 */
import { matchKey } from "../../brand_key";
import { buildResolver, type Resolved, type Resolver } from "../brand_resolve";
import { containsSeq, famTokens } from "../brand_family";
import { engineFacets } from "../providers";
import { corePanel, type ViewData } from "../view_data";
import { SCHEMA_FIELDS, schemaOf, type CodeSchema } from "../views";
import type { AnswerCodes, DictionaryEntry, Intent } from "../../types";
import type { CondStmt } from "./conditions";

/* ------------------------------- question types ------------------------------- */

// The pure values (question types, verdict fields) live in basics.ts so the browser (the Data page) can import them
// without this module's server imports; re-exported here unchanged.
export { QUESTION_TYPES, questionTypeOf, VERDICT_FIELDS, VERDICT_VALUES } from "./basics";
export type { QuestionType, VerdictField } from "./basics";
import { VERDICT_FIELDS, VERDICT_VALUES, questionTypeOf, type QuestionType, type VerdictField } from "./basics";

/* ------------------------------- the record ------------------------------- */

/** Where a resolved name sits (ruling 8). */
export type Bucket = "in_analysis" | "outside_analysis" | "outside_category";

/** The pick: exactly one state. */
export type PickState = "none" | Bucket;

export interface NamedBrand {
  /** Dictionary entry id; "?" + match key when the dictionary cannot place the name. */
  key: string;
  name: string;
  bucket: Bucket;
  /** Framed recommended in the answer, or the answer's pick (ruling 6). */
  recommended: boolean;
  /** Framed recommended in the answer's text, as coded (the pick not counted) - kept so a screen that still leaves
   * the pick out can be reproduced while it moves onto ruling 6. */
  framedRecommended: boolean;
  /** Framed negative anywhere in the answer. */
  negative: boolean;
  /** Order of first appearance among the brands this answer names, 0-based (a pick never mentioned sits last). */
  order: number;
  /** True when the answer mentions it in its text (false = named only as the pick). */
  mentioned: boolean;
  /** The first surface form as written. */
  written: string;
  /** Every surface form as written, in order of first appearance, deduplicated (the pick's form last when the
   * answer only names it as the pick) - the input of the product-name groupings (selections.ts). */
  forms: string[];
  /** The forms of its mentions framed recommended, as written, deduplicated (the pick not counted). */
  recForms: string[];
}

export interface SentTo {
  /** Brands in analysis other than the tracker, in the order written (deduplicated); `forms` = every destination as
   * written that resolves to it (the input of the lists of products named as where to go - ruling 15). */
  brands: { key: string; name: string; forms: string[] }[];
  /** Names resolving to the tracker itself (its own other products), as written. */
  own: string[];
  /** Names outside of analysis or outside the category, as written. */
  outside: string[];
}

export interface PriceFact {
  /** Ruling 3: each price answer in one bucket - a rival, else the tracker's own cheaper option, else nowhere. */
  bucket: "rival" | "own" | "nowhere";
  /** Brands in analysis other than the tracker the answer recommends. */
  rivals: { key: string; name: string }[];
  /** The tracker's own options it points to: grouping key -> surface as written. */
  own: { key: string; written: string }[];
}

export interface RuleFact {
  condition: string;
  /** As coded: a brand name on brand-choice questions, a verdict word ("premium", "cheaper") elsewhere. */
  choice: string;
  product: string | null;
  /** The choice resolved through the dictionary when it is a brand in analysis; null otherwise. */
  choiceKey: string | null;
  /** "you" = the tracker; "other" = another brand in analysis; null = not a brand in analysis. */
  side: "you" | "other" | null;
}

export interface AnswerFact {
  responseId: string;
  promptId: string;
  intentId: string;
  stage: string;
  type: QuestionType;
  schema: CodeSchema;
  /** Buying situation (null = asked of no particular buyer). */
  situation: string | null;
  /** The worry the cell measures (null = not a worry cell). */
  worry: string | null;
  angle: string | null;
  /** The rival or class brand the question names: a head-to-head's rival, a class head-to-head's class brand, the
   * brand a switching customer is leaving. key "?<...>" when the dictionary cannot place it; null = names none. */
  rival: { key: string; name: string } | null;
  /** The price question's product line asked about (the confirmed Value line); null = the bare brand or not a
   * price question. */
  line: string | null;
  engine: { id: string; vendor: string; tier: string; mode: string };
  pick: { state: PickState; key: string | null; name: string | null; written: string | null; /** The run's product the pick names (products.ts, ruling 15); null = none or not attached. */ product?: string | null };
  /** Every brand named, in order of first appearance (one entry per brand). */
  brands: NamedBrand[];
  /** Only the verdicts this question type asks. */
  verdicts: Partial<Record<VerdictField, string>>;
  /** Reasons, or topics on the awareness types (whichever the schema asks); null = neither asked. */
  args: string[] | null;
  argsKind: "reasons" | "topics" | null;
  /** Destinations (worries, switching away) or redirects (settled questions); null = not asked. */
  sent: SentTo | null;
  /** Price questions only. */
  price: PriceFact | null;
  pairings: { name: string; key: string | null; bucket: Bucket; relation: string; framing: string }[] | null;
  rules: RuleFact[] | null;
  /** The conditions it states, one statement per (unit, answer) - filled by attachConditions (conditions.ts) from the
   * run's saved grouping and themes; null = no decision rules on this answer (or not attached yet). */
  conds: CondStmt[] | null;
  /** The coded quote (the phrase the answer's verdict rests on), as coded. */
  quote?: string;
  /** Question type detail's "how they solve it" groups of an adjacent-routed awareness answer's quote, one per grouping
   * context (type_detail.ts attachQuoteGroups, from the run's saved grouping); absent = not attached. */
  qgroups?: Record<string, string>;
}

/** The set of answer facts for one run, with the few tracker-level facts the measures need. */
export interface AnswerFactSet {
  target: { key: string; name: string };
  /** The tracker sells a ladder of its own lines (a confirmed Value line beyond the bare brand). */
  ladder: boolean;
  /** Entry id -> the bucket a brand of that id sits in. */
  bucketOf: (key: string) => Bucket;
  /** Entry id -> display name. */
  nameOf: (key: string) => string;
  /** Entry id -> where the dictionary puts it ("active" / "rejected" / "pending"); "unknown" = no entry. */
  statusOf?: (key: string) => "active" | "rejected" | "pending" | "unknown";
  /** A company's brands in analysis (the dictionary's parent, or the brand's own name when it has none) - the
   * subject "co:<company>". */
  companyMembers?: (company: string) => string[];
  /** Resolve a name as written (the one resolver this set used). */
  resolve: Resolver;
  facts: AnswerFact[];
  /** Ruling 15: the run's ONE grouping of product names (products.ts attachProducts), by product id. */
  products?: Map<string, ProductInfo>;
  /** The product a brand's name as written falls in (null = names no product beyond the brand). */
  productOf?: (brandKey: string, written: string) => string | null;
  /** productOf, and for a product no pick holds its own product (the lists of products NAMED read this). */
  nameProductOf?: (brandKey: string, written: string) => string | null;
  /** The product test behind the grouping (products.ts productTest): proofs read its decisions. */
  productTest?: import("./products").ProductTest;
}

/** One product of the run's grouping (ruling 15). */
export interface ProductInfo {
  id: string;
  /** The brand it belongs to (entry id). */
  key: string;
  /** The form most answers write. */
  full: string;
  /** The full name with the brand's own leading words dropped, for a truncated view. */
  short: string;
  forms: string[];
}

/* ------------------------------- the build ------------------------------- */

const norm = (s: string) => s.trim().toLowerCase();

/** The bucket of a resolution (ruling 8). */
function bucketOfResolved(r: Resolved, targetKey: string): Bucket {
  if (r.status !== "active") return "outside_category";
  if (r.key === targetKey) return "in_analysis";
  return r.entry?.analyzed === false ? "outside_analysis" : "in_analysis";
}

/** Room -> the confirmed price line and counterpart (projects.setup_decision). */
function decidedLines(json: string | null | undefined): Map<string, { line: string; counterpart: string | null }> {
  const out = new Map<string, { line: string; counterpart: string | null }>();
  if (!json) return out;
  try {
    const decided = (JSON.parse(json) as { valueLines?: { decided?: Record<string, unknown> } }).valueLines?.decided ?? {};
    for (const [room, v] of Object.entries(decided)) {
      if (typeof v === "string") out.set(room, { line: v, counterpart: null });
      else if (v && typeof v === "object" && typeof (v as { line?: unknown }).line === "string") {
        const c = (v as { counterpart?: unknown }).counterpart;
        out.set(room, { line: (v as { line: string }).line, counterpart: typeof c === "string" ? c : null });
      }
    }
  } catch {
    // An unreadable record carries no lines; the verdicts still count.
  }
  return out;
}

/* -- the tracker's own options on a price question (the rule the Value card uses, ported) -- */

const surfaceOf = (raw: string) =>
  raw
    .replace(/\s*\b(at|for)\s+\$\s?\d[\d.,]*(\s*\/\s*\w+)?/gi, "")
    .replace(/\$\s?\d[\d.,]*(\s*\/\s*\w+)?\s*/g, "")
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const wordsOf = (tokens: string[]) => tokens.map((t) => t.replace(/[0-9]/g, "")).filter(Boolean);
const DESCRIPTOR = /\b(cheaper|cheapest|lower[- ]cost|low[- ]cost|no[- ](annual[- ])?fee|basic|budget|entry[- ]level|affordable|less expensive|more affordable)\b/i;
/** A description of an option, never a named one (an article-led phrase, a percentage, a comparative). */
const isDescription = (s: string) => /^(a|an|the)\s/i.test(s) || /\d+\s?%/.test(s) || /\bflat[- ]rate\b/i.test(s) || DESCRIPTOR.test(s);
const OWN_STOP = new Set(["with", "tier", "tiers", "plan", "plans", "supported", "version", "option", "the", "its", "their", "edition", "model", "line"]);

interface OwnBasis {
  brandTokens: Set<string>;
  lineWords: Set<string>[];
}

function ownBasis(resolve: Resolver, brand: string, category: string, lines: Map<string, { line: string; counterpart: string | null }>): OwnBasis {
  const e = resolve(brand).entry;
  const brandTokens = new Set<string>(famTokens(brand));
  if (e) {
    for (const f of [e.canonical, e.display_name ?? ""]) for (const t of famTokens(f)) brandTokens.add(t);
    for (const a of e.aliases) {
      const t = famTokens(a);
      if (t.length === 1) brandTokens.add(t[0]);
    }
  }
  const singular = (w: string) => w.replace(/s$/, "");
  const generic = new Set<string>();
  for (const t of famTokens(category)) generic.add(singular(t));
  for (const { counterpart } of lines.values()) for (const t of famTokens(counterpart ?? "")) generic.add(singular(t));
  const lineWords: Set<string>[] = [];
  for (const { line } of lines.values()) {
    const ws = new Set(wordsOf(famTokens(line).filter((t) => !brandTokens.has(t))).filter((w) => w.length >= 3 && !generic.has(singular(w))));
    if (ws.size > 0) lineWords.push(ws);
  }
  return { brandTokens, lineWords };
}

const ownWords = (surface: string, basis: OwnBasis) =>
  [...new Set(wordsOf(famTokens(surface).filter((t) => !basis.brandTokens.has(t))).filter((w) => !OWN_STOP.has(w)).map((w) => w.replace(/s$/, "")))].sort();

function namesOtherLine(surface: string, line: string | null, basis: OwnBasis): boolean {
  const d = famTokens(surface).filter((t) => !basis.brandTokens.has(t));
  if (d.length === 0) return false;
  const words = wordsOf(d);
  const lineW = line ? wordsOf(famTokens(line).filter((t) => !basis.brandTokens.has(t))) : [];
  if (words.length === 0) return lineW.length > 0;
  const asked = new Set(lineW);
  return !words.every((w) => asked.has(w));
}

/* -- the build -- */

export interface BuildOptions {
  /** Keep only answers from these engines (registry ids); absent = the core panel. */
  engines?: readonly string[];
}

/**
 * One record per coded answer on the core panel, in the shared load's order. Requires the data to be loaded with
 * the setup decision (price lines) and the context judge (judged names) when those are to count.
 */
export function buildAnswerFacts(data: ViewData, opts: BuildOptions = {}): AnswerFactSet {
  const { project, dictionary } = data;
  const resolve = buildResolver(dictionary, data.judged, data.names);
  const targetRes = resolve(project.brand);
  const targetKey = targetRes.key;
  const entryById = new Map<string, DictionaryEntry>(dictionary.map((e) => [e.id, e]));
  const bucketOf = (key: string): Bucket => {
    if (key === targetKey) return "in_analysis";
    const e = entryById.get(key);
    if (!e || e.status !== "active") return "outside_category";
    return e.analyzed === false ? "outside_analysis" : "in_analysis";
  };
  const nameOf = (key: string) => {
    if (key === targetKey) return project.brand;
    const e = entryById.get(key);
    return e ? e.display_name ?? e.canonical : key.replace(/^\?/, "");
  };

  const lines = decidedLines(data.setupDecision);
  const basis = ownBasis(resolve, project.brand, project.category, lines);
  const ladder = basis.lineWords.length > 0;

  // Class head-to-heads name their class brand only in the text: the longest active form there, the tracker excluded.
  const forms: { seq: string[]; entry: DictionaryEntry }[] = [];
  for (const e of dictionary) {
    if (e.status !== "active" || e.id === targetKey) continue;
    for (const f of [e.canonical, ...e.aliases]) forms.push({ seq: famTokens(f), entry: e });
  }
  const classBrandOf = (it: Intent): { key: string; name: string } => {
    const hay = famTokens(it.text);
    let best: { seq: string[]; entry: DictionaryEntry } | null = null;
    for (const f of forms) if (containsSeq(hay, f.seq) && (!best || f.seq.length > best.seq.length)) best = f;
    return best ? { key: best.entry.id, name: best.entry.display_name ?? best.entry.canonical } : { key: `?${it.id}`, name: it.text };
  };
  const rivalOf = (it: Intent, type: QuestionType): AnswerFact["rival"] => {
    if (type === "comparison_class") return classBrandOf(it);
    if (type === "comparison_entity" || (type === "switching" && it.angle && it.angle !== "generic")) {
      const r = resolve(it.angle);
      return r.status === "active" ? { key: r.key, name: r.name } : { key: `?${norm(it.angle)}`, name: it.angle };
    }
    return null;
  };

  // The prompts that route somewhere, with their cell.
  const intentById = new Map(data.intents.map((i) => [i.id, i]));
  const promptMeta = new Map<string, { intent: Intent; type: QuestionType; schema: CodeSchema; asked: Set<string>; rival: AnswerFact["rival"] }>();
  for (const p of data.prompts) {
    const it = p.intent_id ? intentById.get(p.intent_id) : undefined;
    if (!it) continue;
    const type = questionTypeOf(it.stage, it.angle);
    const schema = schemaOf(it.stage, it.angle);
    if (!type || !schema) continue;
    promptMeta.set(p.id, { intent: it, type, schema, asked: new Set(SCHEMA_FIELDS[schema]), rival: rivalOf(it, type) });
  }
  const core = corePanel(data);
  const keep = opts.engines ? new Set(opts.engines) : null;
  const pool = new Map<string, { promptId: string; model: string }>();
  for (const r of data.responses) {
    const model = r.model ?? data.run.model;
    if (!promptMeta.has(r.prompt_id) || !core.has(model) || (keep && !keep.has(model))) continue;
    pool.set(r.id, { promptId: r.prompt_id, model });
  }

  const facts: AnswerFact[] = [];
  for (const c of data.codes) {
    const at = pool.get(c.response_id);
    if (!at) continue;
    const meta = promptMeta.get(at.promptId)!;
    facts.push(factOf(c, at, meta));
  }

  function verdictsOf(c: AnswerCodes, asked: Set<string>): Partial<Record<VerdictField, string>> {
    const out: Partial<Record<VerdictField, string>> = {};
    for (const f of VERDICT_FIELDS) {
      if (!asked.has(f)) continue;
      const v = c[f];
      if (v == null || !VERDICT_VALUES[f].includes(v))
        throw new Error(`answer ${c.response_id}: ${f} is asked by schema ${c.schema} but carries ${v == null ? "no value" : `the off-list value "${v}"`} (ruling 1: a coding error)`);
      out[f] = v;
    }
    return out;
  }

  function factOf(c: AnswerCodes, at: { promptId: string; model: string }, meta: NonNullable<ReturnType<typeof promptMeta.get>>): AnswerFact {
    const { intent: it, type, schema, asked, rival } = meta;
    const facets = engineFacets(at.model);

    // The pick.
    let pick: AnswerFact["pick"] = { state: "none", key: null, name: null, written: null };
    if (asked.has("top_pick") && c.outcome === "pick" && c.top_pick) {
      const r = resolve(c.top_pick);
      pick = { state: bucketOfResolved(r, targetKey), key: r.key, name: r.key === targetKey ? project.brand : r.name, written: c.top_pick };
    }

    // Brands named, one entry per brand in order of first appearance.
    const ms = [...(c.mentions ?? [])].map((m, i) => ({ m, i })).sort((a, b) => (a.m.rank ?? 0) - (b.m.rank ?? 0) || a.i - b.i);
    const byKey = new Map<string, NamedBrand>();
    for (const { m } of ms) {
      if (!m?.brand) continue;
      const r = resolve(m.brand);
      const prev = byKey.get(r.key);
      if (prev) {
        if (m.framing === "recommended") prev.recommended = prev.framedRecommended = true;
        if (m.framing === "recommended" && !prev.recForms.includes(m.brand)) prev.recForms.push(m.brand);
        if (m.framing === "negative") prev.negative = true;
        if (!prev.forms.includes(m.brand)) prev.forms.push(m.brand);
        continue;
      }
      byKey.set(r.key, {
        key: r.key,
        name: r.key === targetKey ? project.brand : r.name,
        bucket: bucketOfResolved(r, targetKey),
        recommended: m.framing === "recommended",
        framedRecommended: m.framing === "recommended",
        negative: m.framing === "negative",
        order: byKey.size,
        mentioned: true,
        written: m.brand,
        forms: [m.brand],
        recForms: m.framing === "recommended" ? [m.brand] : [],
      });
    }
    if (pick.key && pick.state !== "none") {
      const prev = byKey.get(pick.key);
      if (prev) {
        prev.recommended = true;
        if (!prev.forms.includes(pick.written!)) prev.forms.push(pick.written!);
      } else byKey.set(pick.key, { key: pick.key, name: pick.name!, bucket: pick.state, recommended: true, framedRecommended: false, negative: false, order: byKey.size, mentioned: false, written: pick.written!, forms: [pick.written!], recForms: [] });
    }

    // Where the buyer is sent.
    const sentField = asked.has("destinations") ? c.destinations : asked.has("redirect_to") ? c.redirect_to : undefined;
    let sent: SentTo | null = null;
    if (sentField !== undefined) {
      sent = { brands: [], own: [], outside: [] };
      const seen = new Set<string>();
      for (const d of sentField ?? []) {
        const r = resolve(d);
        if (r.key === targetKey) sent.own.push(d);
        else if (bucketOfResolved(r, targetKey) === "in_analysis") {
          if (!seen.has(r.key)) sent.brands.push({ key: r.key, name: r.name, forms: [d] });
          else {
            const b = sent.brands.find((x) => x.key === r.key)!;
            if (!b.forms.includes(d)) b.forms.push(d);
          }
          seen.add(r.key);
        } else sent.outside.push(d);
      }
    }

    // The price question's "instead".
    let price: PriceFact | null = null;
    const line = type === "pricing" ? lines.get(it.situation ?? "") ?? null : null;
    if (type === "pricing") {
      const rivals = new Map<string, string>();
      const own = new Map<string, string>();
      const addOwn = (raw: string) => {
        const surface = surfaceOf(raw);
        if (isDescription(surface)) return;
        const d = ownWords(surface, basis);
        const k = d.length > 0 ? d.join(" ") : matchKey(surface);
        if (k && !own.has(k)) own.set(k, surface);
      };
      const counterpartOwn = line?.counterpart ? resolve(line.counterpart).key === targetKey : false;
      for (const m of c.mentions ?? []) {
        if (m.framing !== "recommended") continue;
        const r = resolve(m.brand);
        if (r.key !== targetKey && bucketOfResolved(r, targetKey) === "in_analysis") rivals.set(r.key, r.name);
        else if (r.key === targetKey) {
          const surface = surfaceOf(m.brand);
          if (namesOtherLine(surface, line?.line ?? null, basis)) addOwn(m.brand);
          else if (counterpartOwn && matchKey(surface) === matchKey(line!.counterpart!)) addOwn(m.brand);
        }
      }
      for (const rule of c.decision_rules ?? []) {
        if (rule.choice !== "cheaper" || !rule.product) continue;
        const surface = surfaceOf(rule.product);
        if (!surface) continue;
        const r = resolve(surface);
        const has = new Set(wordsOf(famTokens(surface)));
        const mine = r.key === targetKey ? namesOtherLine(surface, line?.line ?? null, basis) : r.status !== "active" && basis.lineWords.some((ws) => [...ws].every((w) => has.has(w)));
        if (mine) addOwn(rule.product);
      }
      price = {
        bucket: rivals.size > 0 ? "rival" : ladder && own.size > 0 ? "own" : "nowhere",
        rivals: [...rivals.entries()].map(([key, name]) => ({ key, name })),
        own: [...own.entries()].map(([key, written]) => ({ key, written })),
      };
    }

    const argsKind = asked.has("reasons") ? "reasons" : asked.has("topics") ? "topics" : null;
    const args = argsKind ? [...new Set((argsKind === "reasons" ? c.reasons : c.topics) ?? [])] : null;

    const pairings = asked.has("pairings")
      ? (c.pairings ?? []).map((p) => {
          const r = resolve(p.name);
          return { name: p.name, key: r.status === "unknown" ? null : r.key, bucket: bucketOfResolved(r, targetKey), relation: p.maker_relation, framing: p.framing };
        })
      : null;

    const rules = c.decision_rules
      ? c.decision_rules.map((rule): RuleFact => {
          const r = resolve(rule.choice);
          const b = bucketOfResolved(r, targetKey);
          const inAnalysis = r.status === "active" && b === "in_analysis";
          return {
            condition: rule.condition,
            choice: rule.choice,
            product: rule.product ?? null,
            choiceKey: inAnalysis ? r.key : null,
            side: inAnalysis ? (r.key === targetKey ? "you" : "other") : null,
          };
        })
      : null;

    return {
      responseId: c.response_id,
      promptId: at.promptId,
      intentId: it.id,
      stage: it.stage,
      type,
      schema,
      situation: it.situation ?? null,
      worry: it.concern ?? null,
      angle: it.angle ?? null,
      rival,
      line: line?.line ?? null,
      engine: { id: at.model, vendor: facets.vendor, tier: facets.tier, mode: facets.mode },
      pick,
      brands: [...byKey.values()],
      verdicts: verdictsOf(c, asked),
      args,
      argsKind,
      sent,
      price,
      pairings,
      rules,
      conds: null,
      quote: c.quote ?? "",
    };
  }

  // Companies: each brand in analysis under its dictionary parent, or its own name when it has none.
  const inAnalysisKeys = [targetKey, ...dictionary.filter((e) => e.id !== targetKey && bucketOf(e.id) === "in_analysis").map((e) => e.id)];
  const companyOf = (key: string) => entryById.get(key)?.parent ?? nameOf(key);
  const companyMembers = (company: string) => inAnalysisKeys.filter((k) => companyOf(k) === company);
  const statusOf = (key: string): "active" | "rejected" | "pending" | "unknown" => {
    if (key === targetKey) return "active";
    const e = entryById.get(key);
    return e ? (e.status === "active" || e.status === "rejected" || e.status === "pending" ? e.status : "unknown") : "unknown";
  };
  return { target: { key: targetKey, name: project.brand }, ladder, bucketOf, nameOf, statusOf, companyMembers, resolve, facts };
}
