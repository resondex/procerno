import type { WorkbenchView } from "@/lib/engine/workbench";
import { MEASURES, illegalReason, type MeasureDef } from "@/lib/engine/measures";
import { STATION_LABEL, STATION_OF, type ViewKey } from "@/lib/engine/views";
import { QUESTION_TYPE_LABEL } from "./question_types";
import { DIM_NOUN, mLabel, mTip, presentPools, resolveSettings, type DimKey, type PivotSettings } from "./pivot_compute";
import { LIBRARY, LIB_BY_ID, entryAvailable, type LibEntry } from "./table_library";
import { MODE_LABEL, TIER_LABEL } from "./view_parts";

/**
 * The Data page's search (2026-11-12): one box that finds what a customer
 * types, not only our table names. Built client-side over the workbench
 * payload the page already holds - no request, no model call.
 *
 * It finds ready-made tables (name, description, everyday keywords), the
 * tracker's brands, buying situations, rivals, worries, question types,
 * assistants (by name, AI company, free or paid, search on or off), the
 * arguments, and the numbers (measures). Journey words (awareness,
 * consideration, comparison, switching, doubts, value, loyalty...) and
 * everyday synonyms (price, worry, versus, chatgpt...) map to the question
 * types they mean.
 *
 * Matching is case-insensitive and plural-tolerant: every word of the query
 * must start a word of the candidate, or appear inside its text; exact and
 * prefix hits rank first. Each hit says what opening it shows and opens a
 * table - a library entry, or a table of its own - with the thing searched
 * for highlighted (`focus`) or the table narrowed to it (`where`).
 */

export type SearchKind = "table" | "type" | "brand" | "rival" | "buyer" | "worry" | "assistant" | "argument" | "measure";

export const KIND_TITLE: Record<SearchKind, string> = {
  table: "Tables",
  type: "Question types",
  brand: "Brands",
  rival: "Rivals",
  buyer: "Buying situations",
  worry: "Worries",
  assistant: "Assistants",
  argument: "Arguments",
  measure: "Numbers",
};
const KIND_ORDER: SearchKind[] = ["table", "type", "brand", "rival", "buyer", "worry", "assistant", "argument", "measure"];

/** A row to highlight in the opened table, by its label. */
export interface Focus {
  dim: DimKey;
  match: string;
}

/** What opening a hit does: a library entry, or a table of its own. */
export type SearchOpen = { entry: string; focus?: Focus } | { settings: PivotSettings; title: string; focus?: Focus };

export interface SearchHit {
  id: string;
  kind: SearchKind;
  title: string;
  /** What opening it shows, in one plain line. */
  desc: string;
  open: SearchOpen;
}

interface Candidate extends SearchHit {
  /** Its own names (rank highest). */
  names: string[];
  /** Words chosen for it (rank next). */
  keys?: string[];
  /** Words that lead to it more loosely (rank lower). */
  words: string[];
  /** Order among equal scores (lower first). */
  rank: number;
}

// ---------------------------------------------------------------- words

/** Lower case, punctuation to spaces, each word made singular. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(stem)
    .join(" ");
}
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

/** Journey and everyday words -> the question types they mean. */
const POOL_WORDS: [string[], ViewKey[]][] = [
  [["awareness", "aware", "problem", "pain", "learn", "learning", "education", "explain", "new to", "category", "first heard", "discover", "discovery"], ["awareness_routing", "awareness_explainer"]],
  [["consideration", "consider", "open choice", "what to buy", "which to get", "which should", "shortlist", "choose", "choice", "pick", "recommend", "buy", "buying", "purchase"], ["headline"]],
  [["consideration", "criteria", "what matters", "factors", "look for", "checklist", "requirements"], ["criteria_taught"]],
  [["consideration", "premium", "basic", "tier", "luxury", "high end", "budget", "upmarket"], ["premium_tier"]],
  [["comparison", "compare", "versus", "vs", "head to head", "rival", "competitor", "competition", "matchup", "battle", "against"], ["head_to_head_entity", "head_to_head_class"]],
  [["switching", "switch", "leaver", "leaving", "defect", "steal", "win over", "conquest", "move to", "poach"], ["offensive_capture", "defensive_hold"]],
  [["doubts", "doubt", "worry", "worries", "concern", "objection", "fear", "hesitation", "risk", "complaint", "downside"], ["doubt", "keep_or_leave"]],
  [["value", "price", "pricing", "cost", "expensive", "cheap", "cheaper", "worth", "worth it", "fee", "afford", "money", "budget"], ["value"]],
  [["loyalty", "loyal", "retention", "retain", "churn", "stay", "leave", "keep", "cancel", "renew", "renewal", "customers", "customer base", "existing customer"], ["keep_or_leave", "defensive_hold", "repertoire"]],
  [["habit", "repertoire", "repeat", "routine", "stick with", "regular"], ["repertoire"]],
  [["advocacy", "advocate", "word of mouth", "refer", "referral", "defend", "critic", "recommend to"], ["settled_advocacy"]],
  [["business case", "approval", "approve", "sign off", "boss", "justify", "roi"], ["settled_business_case"]],
  [["expansion", "expand", "grow", "growth", "upgrade", "upsell", "more seats"], ["settled_expansion"]],
  [["ecosystem", "integration", "add on", "companion", "accessory", "partner"], ["settled_ecosystem"]],
];

/** Everyday words for the numbers, by measure id. */
const MEASURE_WORDS: Record<string, string[]> = {
  mentioned: ["named", "mention", "mentioned", "visibility", "visible", "presence", "appear", "awareness", "share of voice"],
  recommended: ["recommend", "recommended", "endorse", "suggest", "shortlist"],
  chosen: ["picked", "pick", "chosen", "choose", "winner", "win", "top pick", "selected"],
  share_of_decided: ["picked", "share of picks", "pick share", "market share", "win rate", "winner"],
  negative: ["negative", "criticized", "criticism", "bad", "complaint"],
  named_first: ["first", "top of mind", "named first", "first mention"],
  firm_pick: ["decisive", "commits", "firm"],
  conditional: ["it depends", "rules", "hedge", "hedging"],
  no_pick: ["no pick", "undecided"],
  out_of_category: ["outside", "leak", "other category"],
  h2h_you: ["win", "wins", "beat", "head to head"],
  h2h_rival: ["lose", "loses", "rival wins"],
  h2h_two_way: ["record", "win rate"],
  worth_yes: ["worth it", "value", "price"],
  worth_no: ["not worth", "overpriced", "too expensive"],
  proceed: ["go ahead", "reassure"],
  avoid: ["avoid", "steer away"],
  keep: ["stay", "keep", "retain", "loyalty"],
  leave: ["leave", "churn", "cancel"],
  premise_confirms: ["agrees", "confirms the worry"],
  premise_rebuts: ["pushes back", "rebuts", "defends"],
  argues: ["argument", "reason", "why"],
  routed_category: ["routes to the category"],
  rep_stick: ["sticks", "loyal", "habit"],
  rep_switch: ["switch", "switches"],
};

const ASSISTANT_WORDS: Record<string, string[]> = {
  chatgpt: ["openai", "gpt", "chat gpt"],
  claude: ["anthropic"],
  gemini: ["google", "bard"],
  grok: ["xai", "x ai", "twitter"],
  perplexity: ["pplx", "sonar"],
  copilot: ["microsoft", "bing"],
};

// ---------------------------------------------------------------- the index

/** The short forms people type for a multi-word brand: its initials and
 * the first two letters of each word ("AE", "Amex" style) - guesses, used
 * beside the dictionary's own aliases (wb6). */
function shortForms(name: string, aliases?: string[]): string[] {
  return [...(aliases ?? []), ...guessedForms(name)];
}
function guessedForms(name: string): string[] {
  const words = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(Boolean);
  if (words.length < 2) return [];
  return [words.map((w) => w[0]).join(""), words.map((w) => w.slice(0, 2)).join("")];
}

/** The row to open a question type's own table on. */
function bestRow(data: WorkbenchView, pool: ViewKey): DimKey {
  const tryRows: DimKey[] =
    pool === "doubt" || pool === "keep_or_leave"
      ? ["worry", "room", "engine"]
      : pool.startsWith("head_to_head") || pool === "offensive_capture" || pool === "defensive_hold"
        ? ["rival", "room", "engine"]
        : pool === "headline"
          ? ["brand", "room"]
          : ["room", "engine"];
  for (const row of tryRows) {
    const r = resolveSettings({ pool, measures: [], row, col: "none", brand: null, arg: null }, data);
    if (r && r.pool === pool && r.rowDim === row) return row;
  }
  return "none";
}

const custom = (title: string, settings: Partial<PivotSettings> & { pool: ViewKey }, focus?: Focus): SearchOpen => ({
  title,
  settings: { measures: [], row: "none", col: "none", brand: null, arg: null, where: null, ...settings },
  focus,
});

/** Does this payload resolve the custom table as asked (its pool present)? */
const fits = (o: SearchOpen, data: WorkbenchView) => {
  if ("entry" in o) {
    const e = LIB_BY_ID.get(o.entry);
    return !!e && entryAvailable(e, data);
  }
  const r = resolveSettings(o.settings, data);
  return !!r && r.pool === o.settings.pool && (!o.settings.where || !!r.where);
};

export function buildSearchIndex(data: WorkbenchView | null, brandName: string, category?: string | null): Candidate[] {
  const out: Candidate[] = [];
  let rank = 0;
  const add = (c: Omit<Candidate, "rank">) => {
    if (data && !fits(c.open, data)) return;
    out.push({ ...c, rank: rank++ });
  };

  // Tables.
  const libOk = (e: LibEntry) => e.kind !== "pivot" || (!!data && entryAvailable(e, data));
  for (const e of LIBRARY) {
    if (!libOk(e)) continue;
    const poolWords = e.pool ? POOL_WORDS.filter(([, pools]) => pools.includes(e.pool!)).flatMap(([w]) => w) : [];
    add({
      id: `t:${e.id}`,
      kind: "table",
      title: e.label,
      desc: e.desc,
      open: { entry: e.id },
      names: [e.label],
      keys: e.keywords ?? [],
      words: [e.group, ...poolWords],
    });
  }
  if (!data?.facts) return out;

  const present = presentPools(data);
  const has = (p: ViewKey) => present.includes(p);
  const listed = data.brands.map((b, i) => ({ b, i })).filter(({ b }) => b.listed);
  const rivalIdx = new Set(data.prompts.filter((p) => p.rival >= 0).map((p) => p.rival));

  // Question types (and the journey stage each sits in).
  for (const pool of present) {
    const label = QUESTION_TYPE_LABEL[pool];
    const station = STATION_LABEL[STATION_OF[pool]];
    const row = bestRow(data, pool);
    add({
      id: `q:${pool}`,
      kind: "type",
      title: `${label} questions`,
      desc: `${station} stage - the main number for these questions${row === "none" ? "" : `, for each ${DIM_NOUN[row]}`}.`,
      open: custom(`${label} questions`, { pool, row }),
      names: [label],
      keys: [station, ...POOL_WORDS.filter(([, pools]) => pools.includes(pool)).flatMap(([w]) => w)],
      words: [],
    });
  }

  // Brands.
  for (const { b, i } of listed) {
    const you = i === data.target;
    add({
      id: `b:${i}`,
      kind: "brand",
      title: you ? `${b.name} (you) beside every brand` : `${b.name} beside every brand`,
      desc: `Named, recommended and picked for every brand, ${b.name} highlighted.`,
      open: { entry: "funnel_brand", focus: { dim: "brand", match: b.name } },
      names: [b.name, ...(b.parent ? [b.parent] : []), ...shortForms(b.name, b.aliases)],
      words: you ? ["you", "us", "our brand", "my brand"] : ["competitor", "rival"],
    });
    add({
      id: `bs:${i}`,
      kind: "brand",
      title: `${b.name} in each buying situation`,
      desc: `How often ${b.name} is named, recommended and picked, buying situation by buying situation.`,
      open: custom(`${b.name} in each buying situation`, { pool: "headline", measures: ["mentioned", "recommended", "share_of_decided"], row: "room", brand: you ? null : b.name }),
      names: [b.name, ...shortForms(b.name, b.aliases)],
      words: [],
    });
    add({
      id: `be:${i}`,
      kind: "brand",
      title: `${b.name} on each assistant`,
      desc: `How often ${b.name} is named, recommended and picked on each AI assistant.`,
      open: custom(`${b.name} on each assistant`, { pool: "headline", measures: ["mentioned", "recommended", "chosen"], row: "engine", brand: you ? null : b.name }),
      names: [b.name, ...shortForms(b.name, b.aliases)],
      words: [],
    });
  }

  // Rivals (the brands asked about head-to-head, and named classes).
  const rivalNames = [
    ...[...rivalIdx].map((i) => data.brands[i].name),
    // Rivals named only by their setup wording (no brand resolved), as the
    // table's rows name them.
    ...new Set(
      data.prompts
        .filter((p) => p.rival < 0 && p.angle >= 0 && !/^(defensive|offensive|generic|class)$/i.test(data.angles[p.angle]))
        .map((p) => data.angles[p.angle].replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()))
    ),
  ];
  for (const name of rivalNames) {
    add({
      id: `r:${name}`,
      kind: "rival",
      title: `${brandName} vs ${name}`,
      desc: `When a buyer asks ${brandName} against ${name}, who the AI picks - ${name} highlighted.`,
      open: { entry: "h2h_rival", focus: { dim: "rival", match: name } },
      names: [name],
      words: ["versus", "vs", "head to head", "compare", "comparison", "rival"],
    });
    add({
      id: `rl:${name}`,
      kind: "rival",
      title: `${name}'s customers switching`,
      desc: `When ${name}'s customers ask where to move, whether the AI names and picks ${brandName}.`,
      open: { entry: "leavers_rival", focus: { dim: "rival", match: name } },
      names: [name],
      words: ["switch", "switching", "leaving", "leavers", "win over"],
    });
  }

  // Buying situations.
  for (const room of data.rooms) {
    add({
      id: `rm:${room}`,
      kind: "buyer",
      title: `Who gets picked - ${room}`,
      desc: `Share of picks for every brand, only when the buyer is "${room}".`,
      open: custom(`Who gets picked - ${room}`, { pool: "headline", measures: ["share_of_decided"], row: "brand", where: { dim: "room", label: room } }),
      names: [room],
      words: ["buyer", "segment", "situation", "persona", "audience"],
    });
    add({
      id: `rmc:${room}`,
      kind: "buyer",
      title: `${room} beside the other buying situations`,
      desc: `Your share of the picks in every buying situation, "${room}" highlighted.`,
      open: { entry: "picks_room", focus: { dim: "room", match: room } },
      names: [room],
      words: ["buyer", "segment", "situation"],
    });
    if (has("value")) {
      add({
        id: `rmv:${room}`,
        kind: "buyer",
        title: `Worth it? - ${room}`,
        desc: `Whether the AI calls your line worth its price for "${room}".`,
        open: { entry: "worth_room", focus: { dim: "room", match: room } },
        names: [room],
        words: ["price", "value", "worth", "cost"],
      });
    }
  }

  // Worries: each where it is asked (buyers before buying, customers after).
  data.worries.forEach((w, wi) => {
    const views = new Set(data.prompts.filter((p) => p.worry === wi).flatMap((p) => p.views));
    if (views.has("doubt")) {
      add({
        id: `wb:${wi}`,
        kind: "worry",
        title: `${w} - buyers`,
        desc: `When a buyer raises "${w}", whether the AI says go ahead or avoid - this worry highlighted.`,
        open: { entry: "worries_buyers", focus: { dim: "worry", match: w } },
        names: [w],
        words: ["worry", "doubt", "objection", "concern", "buyer"],
      });
    }
    if (views.has("keep_or_leave")) {
      add({
        id: `wc:${wi}`,
        kind: "worry",
        title: `${w} - customers`,
        desc: `When a customer raises "${w}", whether the AI tells them to stay or leave - this worry highlighted.`,
        open: { entry: "worries_customers", focus: { dim: "worry", match: w } },
        names: [w],
        words: ["worry", "churn", "stay", "leave", "loyalty", "customer"],
      });
    }
  });

  // Assistants: each assistant, each AI company, free or paid, search on or off.
  const vendors = new Map<string, number>();
  data.engines.forEach((e) => vendors.set(e.vendor ?? e.label, 0));
  for (const e of data.engines) {
    const v = e.vendor ?? e.label;
    add({
      id: `e:${e.id}`,
      kind: "assistant",
      title: e.label,
      desc: `Who gets picked on ${e.label} alone, every brand.`,
      open: custom(`Who gets picked on ${e.label}`, { pool: "headline", measures: ["mentioned", "recommended", "share_of_decided"], row: "brand", where: { dim: "engine", label: e.label } }),
      names: [e.label],
      words: [v, ...(ASSISTANT_WORDS[norm(v)] ?? []), "assistant", "ai"],
    });
  }
  for (const v of vendors.keys()) {
    add({
      id: `v:${v}`,
      kind: "assistant",
      title: `All ${v} assistants`,
      desc: `Who gets picked across ${v}'s assistants, every brand.`,
      open: custom(`Who gets picked on ${v}`, { pool: "headline", measures: ["mentioned", "recommended", "share_of_decided"], row: "brand", where: { dim: "vendor", label: v } }),
      names: [v],
      words: [...(ASSISTANT_WORDS[norm(v)] ?? []), "ai company", "vendor"],
    });
    add({
      id: `vc:${v}`,
      kind: "assistant",
      title: `${v} beside the other AI companies`,
      desc: `You named, recommended and picked on each AI company, ${v} highlighted.`,
      open: { entry: "by_vendor", focus: { dim: "vendor", match: v } },
      names: [v],
      words: ASSISTANT_WORDS[norm(v)] ?? [],
    });
  }
  const tiers = new Set(data.engines.map((e) => e.tier ?? "both"));
  for (const t of tiers) {
    const label = TIER_LABEL[t];
    add({
      id: `tier:${t}`,
      kind: "assistant",
      title: label,
      desc: `You on free assistants beside paid ones, ${label.toLowerCase()} highlighted.`,
      open: { entry: "by_tier", focus: { dim: "tier", match: label } },
      names: [label],
      words: t === "free" ? ["free"] : t === "paid" ? ["paid", "subscription", "plus", "pro"] : ["free", "paid"],
    });
  }
  const modes = new Set(data.engines.map((e) => e.mode));
  for (const m of modes) {
    const label = MODE_LABEL[m];
    add({
      id: `mode:${m}`,
      kind: "assistant",
      title: label,
      desc: `You when the assistant searches the web beside when it answers from memory, "${label}" highlighted.`,
      open: { entry: "by_mode", focus: { dim: "mode", match: label } },
      names: [label],
      words: m === "search" ? ["search", "web", "internet", "online", "browsing", "live"] : ["instinct", "memory", "offline", "no search", "training"],
    });
  }

  // Arguments.
  for (const a of data.args) {
    add({
      id: `a:${a}`,
      kind: "argument",
      title: a,
      desc: `How often "${a}" is argued, beside every other argument.`,
      open: { entry: "args", focus: { dim: "argument", match: a } },
      names: [a],
      words: ["argument", "reason", "why", category ?? ""].filter(Boolean),
    });
  }

  // Numbers (measures): each opened in the first question type that asks it.
  const seen = new Set<string>();
  const poolOrder: ViewKey[] = has("headline") ? ["headline", ...present.filter((p) => p !== "headline")] : present;
  for (const m of MEASURES) {
    const pool = poolOrder.find((p) => !illegalReason(m, p));
    if (!pool) continue;
    const name = mLabel(m);
    const key = `${name}|${pool}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row: DimKey = m.brand ? "brand" : bestRow(data, pool);
    const title = `${name} - ${QUESTION_TYPE_LABEL[pool]} questions`;
    add({
      id: `m:${m.id}`,
      kind: "measure",
      title,
      desc: `${measureSentence(m)}${row === "none" ? "" : ` For each ${DIM_NOUN[row]}.`}`,
      open: custom(title, { pool, measures: [m.id], row }),
      names: [name, m.label],
      words: [m.group, ...(MEASURE_WORDS[m.id] ?? [])],
    });
  }
  return out;
}

function measureSentence(m: MeasureDef): string {
  const t = mTip(m).replace(/,? over (every answer|answers with [^.]*)\.?$/i, ".");
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

// ---------------------------------------------------------------- matching

/** Does a query word lead a text word? Short query words must match whole
 * ("fee" finds "fee" and "fees", never "feel"). */
const leads = (w: string, x: string) => (w.length < 4 ? x === w : x.startsWith(w));
/** Words that carry no meaning on their own in a search. */
const FILLER = new Set(["the", "a", "an", "of", "for", "in", "on", "my", "our", "to", "and", "with", "by", "about", "how", "what", "who", "doe", "do", "is", "are", "vs", "versus", "v", "against"]);

/** How well one text matches the query words; 0 = no match. */
function scoreText(text: string, q: string, qWords: string[], strong: number): number {
  const t = norm(text);
  if (!t) return 0;
  if (t === q) return strong + 40;
  if (t.startsWith(q)) return strong + 25;
  const words = t.split(" ");
  // Every query word starts a word of the text (in any order).
  if (qWords.every((w) => words.some((x) => leads(w, x)))) return strong + 10;
  // The whole query appears inside (one word long enough to mean something).
  if (q.length >= 4 && t.includes(q)) return strong;
  return 0;
}

export interface SearchGroup {
  kind: SearchKind;
  title: string;
  hits: SearchHit[];
}

/** At most this many hits per group (the best first). */
const PER_GROUP = 6;

export function searchIndex(index: Candidate[], query: string): SearchGroup[] {
  const q = norm(query);
  if (!q) return [];
  const qWords = q.split(" ");
  const scored: { c: Candidate; s: number }[] = [];
  for (const c of index) {
    let s = 0;
    for (const n of c.names) s = Math.max(s, scoreText(n, q, qWords, 60));
    // Words that lead to it: a whole-word or prefix match only (no inside
    // matches - "fee" must not find "feel").
    const byWord = (list: string[] | undefined, top: number) => {
      for (const w of list ?? []) {
        const t = norm(w);
        if (!t) continue;
        if (t === q) s = Math.max(s, top);
        else if (t.startsWith(q) && q.length >= 3) s = Math.max(s, top - 15);
        else if (qWords.length > 1 && qWords.every((x) => t.split(" ").some((y) => leads(x, y)))) s = Math.max(s, top - 20);
      }
    };
    byWord(c.keys, 55);
    byWord(c.words, 45);
    // A table's description: every query word starts a word of it.
    if (c.kind === "table" && s === 0 && q.length >= 3) {
      const d = norm(c.desc).split(" ");
      if (qWords.every((w) => d.some((x) => leads(w, x)))) s = 20;
    }
    // Several words spread over its names and words ("vs chase",
    // "chatgpt search"): every meaningful word leads one of them.
    if (s === 0 && qWords.length > 1) {
      const meant = qWords.filter((w) => !FILLER.has(w));
      const tokens = [...c.names, ...(c.keys ?? []), ...c.words].flatMap((t) => norm(t).split(" "));
      const nameTokens = c.names.flatMap((t) => norm(t).split(" "));
      if (meant.length && meant.every((w) => tokens.some((x) => leads(w, x))) && meant.some((w) => nameTokens.some((x) => leads(w, x)))) s = 25;
    }
    if (s > 0) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s || a.c.rank - b.c.rank);
  const groups = new Map<SearchKind, SearchHit[]>();
  for (const { c } of scored) {
    const list = groups.get(c.kind) ?? [];
    if (list.length < PER_GROUP) list.push({ id: c.id, kind: c.kind, title: c.title, desc: c.desc, open: c.open });
    groups.set(c.kind, list);
  }
  // Groups in a fixed order, except that the group holding the best hit
  // leads (typing a brand shows Brands first).
  const best = scored[0]?.c.kind;
  const order = best ? [best, ...KIND_ORDER.filter((k) => k !== best)] : KIND_ORDER;
  return order.filter((k) => groups.has(k)).map((k) => ({ kind: k, title: KIND_TITLE[k], hits: groups.get(k)! }));
}

/** Suggestions for the empty state, from the tracker's own data. */
export function searchSuggestions(data: WorkbenchView | null): string[] {
  if (!data) return ["price", "switching", "consideration"];
  const rival = data.brands.find((b, i) => b.listed && i !== data.target)?.name;
  const room = data.rooms[0];
  const vendor = data.engines[0]?.vendor ?? data.engines[0]?.label;
  return [rival, room, vendor, "price", "switching", "consideration"].filter((x): x is string => !!x);
}
