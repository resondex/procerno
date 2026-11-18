import type { PanelNum, PanelSpan, PanelText } from "./analysis_types";

/**
 * The panel templates (am31, PANEL_BUILD_SPEC section 6, E5): the sentence
 * pieces every panel is assembled from. Plain words only - no method terms
 * (contest, cell, pooled, routes, wall), " - " never a long dash, and no
 * category or brand literal: the category's own noun comes in through
 * productNoun / pluralNoun, every name through the caller. A stated number
 * is a span carrying its answers (refs) and its counts (tip, hover only).
 */

/** The category's product noun, singular ("credit cards" -> "credit card"). */
export function productNoun(category: string): string {
  const words = category.trim().split(/\s+/);
  const last = words[words.length - 1] ?? "";
  let one = last;
  if (/ies$/i.test(last) && last.length > 4) one = last.slice(0, -3) + "y";
  else if (/(ches|shes|sses|xes)$/i.test(last)) one = last.slice(0, -2);
  else if (/[^s]s$/i.test(last) && last.length > 3) one = last.slice(0, -1);
  words[words.length - 1] = one;
  return words.join(" ") || "product";
}

/** The category's noun, plural ("credit card" -> "credit cards"); a category
 * already written in the plural is returned as written. */
export function pluralNoun(category: string): string {
  const one = productNoun(category);
  if (one !== category.trim()) return category.trim();
  if (/(s|x|ch|sh)$/i.test(one)) return `${one}es`;
  if (/[^aeiou]y$/i.test(one)) return `${one.slice(0, -1)}ies`;
  if (/(ware|ment|ing|ness)$/i.test(one)) return one; // mass nouns read as written
  return `${one}s`;
}

/** "a" or "an" before a word, by its sound: "a OnePlus", "a U.S. Bank", "an MBA", "an hour". */
export function article(w: string): string {
  const t = w.trim();
  const first = t.split(/\s+/)[0] ?? "";
  if (/^(one|once|uni|use|usu|uti|eu|ewe|u\.|ur[aeiou])/i.test(first)) return "a";
  if (/^(hour|honest|honou?r|heir)/i.test(first)) return "an";
  // An acronym is read letter by letter ("an MBA", "a BMW").
  if (first.length >= 2 && first.length <= 5 && first === first.toUpperCase() && /^[A-Z]{2}/.test(first)) return /^[AEFHILMNORSX]/.test(first) ? "an" : "a";
  return /^[aeiou]/i.test(t) ? "an" : "a";
}

/** A name's possessive: "Lay's" stays "Lay's", "PBS Kids" -> "PBS Kids'", "Chase" -> "Chase's". */
export function poss(name: string): string {
  const t = name.trim();
  if (/['’]s$/i.test(t)) return t;
  if (/s$/i.test(t)) return `${t}'`;
  return `${t}'s`;
}

/** Plain text. */
export const T = (t: string): PanelSpan => ({ t });
/** A stated number: its value, answers and counts. */
export const N = (n: PanelNum): PanelSpan => ({ t: n.value, ...(n.refs ? { refs: n.refs } : {}), tip: n.tip, ...(n.fact ? { fact: n.fact } : {}) });
/** N with a stable name for its number (stat ids, stat_registry.ts); the name is never drawn. */
export const NK = (key: string, n: PanelNum): PanelSpan => ({ ...N(n), key });
/** A stated fact (a condition, a product) with its answers. */
export const F = (t: string, n?: PanelNum): PanelSpan => ({ t, ...(n?.refs ? { refs: n.refs } : {}), ...(n ? { tip: n.tip } : {}) });

/** Joins spans, merging adjacent plain text. */
export function join(...parts: (PanelSpan | PanelText | string | null | undefined | false)[]): PanelText {
  const out: PanelText = [];
  const push = (s: PanelSpan) => {
    const last = out[out.length - 1];
    if (last && !last.refs && !last.tip && !last.key && !last.name && !s.refs && !s.tip && !s.key && !s.name) last.t += s.t;
    else out.push({ ...s });
  };
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === "string") push({ t: p });
    else if (Array.isArray(p)) p.forEach(push);
    else push(p);
  }
  return out;
}

/** "A", "A and B", "A, B and C". */
export function listWords(xs: string[], last = "and"): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} ${last} ${xs[xs.length - 1]}`;
}

/** Spans joined as a list ("A, B and C"), each span kept. */
export function listSpans(xs: PanelSpan[], last = "and"): PanelText {
  const out: (PanelSpan | string)[] = [];
  xs.forEach((x, i) => {
    if (i > 0) out.push(i === xs.length - 1 ? ` ${last} ` : ", ");
    out.push(x);
  });
  return join(...out);
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** "Three" (sentence start) up to ten, digits after. */
export const countWord = (n: number) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));

/** A buyer-condition label read mid-sentence: the first letter lowered
 * unless the first word looks like a name (a capital inside it, or all caps). */
export function lowerFirst(s: string): string {
  const t = s.trim();
  const first = t.split(/\s+/)[0] ?? "";
  if (first.length > 1 && (/[A-Z]/.test(first.slice(1)) || first === first.toUpperCase())) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** A condition label as shown under an "... if" heading or quoted in a
 * sentence: a leading "if", "if you", "when" or "you" is dropped where what
 * is left still reads ("if you already use X" -> "already use X"); "you are"
 * keeps its subject, and "you" is never dropped to leave one word. */
export function condLabel(text: string): string {
  const t = text.trim();
  const words = (x: string) => x.split(/\s+/).filter(Boolean).length;
  let out = t;
  const lead = /^(?:only if|if|when|whenever)\s+/i;
  if (lead.test(out) && words(out.replace(lead, "")) >= 1) out = out.replace(lead, "");
  const you = /^you\s+(?!(?:are|were|am|is)\b)/i;
  if (you.test(out) && words(out.replace(you, "")) >= 2) out = out.replace(you, "");
  if (out !== t && /^[A-Z]/.test(t)) out = out.charAt(0).toUpperCase() + out.slice(1);
  return theyFor(out);
}

/** am37: a condition's "you" is the asker, not the brand - shown in the third
 * person ("accepted where you shop" -> "accepted where they shop"). */
export function theyFor(text: string): string {
  const cap = (from: string, to: string) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);
  return text
    // "you" as an object ("with you", "for you", at the end) is "them".
    .replace(/\b(with|for|to|at|by|from|about|of|on|near|around|like|without|against|behind|beside|than|toward|towards|into|onto|upon|via)\s+you\b(?!['’])/gi, (_m, prep: string) => `${prep} them`)
    .replace(/\byou(?=\s*[.,;:!?)]|\s*$)/gi, (m) => cap(m, "them"))
    .replace(/\byou['’]re\b/gi, (m) => cap(m, "they're"))
    .replace(/\byou['’]ve\b/gi, (m) => cap(m, "they've"))
    .replace(/\byou['’]ll\b/gi, (m) => cap(m, "they'll"))
    .replace(/\byou['’]d\b/gi, (m) => cap(m, "they'd"))
    .replace(/\byourself\b/gi, (m) => cap(m, "themselves"))
    .replace(/\byours\b/gi, (m) => cap(m, "theirs"))
    .replace(/\byour\b/gi, (m) => cap(m, "their"))
    // am59: "you" as an object is "them", never "they" ("ads don't bother you much" -> "... bother them much").
    .replace(/\b(for|to|with|of|about|on|from|at|by|than|around|near|suits?|fits?|bothers?|costs?|gives?|lets?|helps?|saves?|gets?|keeps?|serves?|rewards?|charges?)\s+you\b/gi, (_m, w: string) => `${w} them`)
    .replace(/\byou\b(?=\s*(?:$|[,.;)]|much\b|most\b|more\b|less\b|a lot\b|at all\b|enough\b|either\b|anymore\b|too\b))/gi, (m) => cap(m, "them"))
    .replace(/\byou\b/gi, (m) => cap(m, "they"));
}

/** A condition row's label as shown under an "... if" heading: sentence case. */
export const condRowLabel = (text: string) => upperFirst(condLabel(text));

/** A codebook name as shown: the codebook stores lower-case names ("support
 * sla"); a word its scope sentence writes in capitals keeps them ("SLA"). */
export function codeName(code: string, scope?: string): string {
  if (!scope) return code;
  const caps = new Set((scope.match(/\b[A-Z][A-Z0-9]{1,5}s?\b/g) ?? []).map((w) => w.replace(/s$/, "")));
  return code.replace(/\b[a-z0-9]{2,6}\b/g, (w) => (caps.has(w.toUpperCase()) ? w.toUpperCase() : w));
}

/** A list of names that may themselves contain "and" ("price and value"):
 * joined by semicolons then, so no item runs into the next. */
export function listNames(xs: string[]): string {
  if (xs.some((x) => /\band\b/i.test(x))) return xs.join("; ");
  return listWords(xs);
}
/** Spans as a list of names, joined like listNames. */
export function listNameSpans(xs: PanelSpan[]): PanelText {
  if (!xs.some((x) => /\band\b/i.test(x.t))) return listSpans(xs);
  const out: (PanelSpan | string)[] = [];
  xs.forEach((x, i) => {
    if (i > 0) out.push("; ");
    out.push(x);
  });
  return join(...out);
}

/** A condition quoted as the condition, never spliced into the sentence's
 * grammar: `"<label>"`, the label carrying its answers. Works for a raw
 * wording and for a coined group name alike. */
export const quoted = (label: string, n?: PanelNum): PanelText => [F(`"${condLabel(label)}"`, n)];

/**
 * The conditions the AI most often attaches to a choice, quoted:
 *   one:  `The condition it most often attaches to <what> is "<a>", in X% of <of>.`
 *   two:  `The conditions it most often attaches to <what> are "<a>" (X% of <of>) and "<b>" (Y%).`
 * `rows` carry the label and its share; a row without a share is quoted bare.
 */
export function attachedLead(what: string, rows: { text: string; share?: PanelNum }[], of = "these answers", opening = ""): PanelText {
  const r = rows.filter((x) => x.text.trim()).slice(0, 2);
  if (!r.length) return [];
  const The = opening ? `${opening}the` : "The";
  if (r.length === 1) {
    const [a] = r;
    return join(`${The} condition it most often attaches to ${what} is `, quoted(a.text, a.share), a.share ? join(", in ", N(a.share), ` of ${of}`) : "", ".");
  }
  const [a, b] = r;
  return join(
    `${The} conditions it most often attaches to ${what} are `,
    quoted(a.text, a.share),
    a.share ? join(" (", N(a.share), ` of ${of})`) : "",
    " and ",
    quoted(b.text, b.share),
    b.share ? join(" (", N(b.share), ")") : "",
    "."
  );
}

/** Sentence case for a heading built from a fragment. */
export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One fixed line for a thin panel. */
export const THIN = "Too few answers here to read this closely.";
export const THIN_RIVAL = (name: string, what: string) => `Too few answers name ${name} here to show ${what}.`;
export const NO_CONDITION_ROWS = "The AI attaches no condition here often enough to list.";

/* ------------------------------ detail templates ------------------------------ */

/** The funnel steps' plain names inside a sentence. */
export const STEP_PHRASE: Record<string, string> = {
  named: "named",
  recommended: "recommended",
  converts: "turned from a recommendation into the pick",
  category: "answered with the category",
};

/** A displayed share as a number ("<1%" reads as half a point). */
export const shownPct = (n: PanelNum) => (n.value === "<1%" ? 0.5 : parseFloat(n.value) || 0);

/** Normal view, a funnel panel with no competitors (the usual is drawn): the
 * step furthest from the usual, said in words. am37: the direction comes from
 * the same closeness rule as the tags; no number the bars draw. */
export function funnelDetail(focus: { key: string; dir: StepDir } | null, who: { here: string; usual: string }, behind: boolean): { heading: string; body: PanelText } {
  if (!focus || focus.dir === 0) return { heading: `You do about as well ${who.here} as ${who.usual}`, body: join("No step here sits clearly above or below your usual.") };
  const more = focus.dir < 0 ? "less" : "more";
  const HEAD: Record<string, string> = {
    named: `You are named ${more} often here than usual`,
    recommended: `You are recommended ${more} often here than usual`,
    converts: `${focus.dir < 0 ? "Fewer" : "More"} of your recommendations end as the pick here than usual`,
    category: `The answers point to the category ${more} often here than usual`,
  };
  const body =
    focus.key === "named"
      ? namedLine(focus.dir, who.usual, behind)
      : focus.key === "recommended"
        ? recommendedLine(focus.dir, who.usual, behind)
        : focus.key === "converts"
          ? convertsLine(focus.dir, `they do ${who.usual}`, behind)
          : join(`The answers point the buyer to the category ${more} often ${who.here} than ${who.usual}.`);
  return { heading: HEAD[focus.key] ?? "This step differs from your usual", body };
}

/** Comparison view, a funnel panel: the step where you fall furthest behind.
 * am37: names only competitors whose shown share is above yours; no numbers. */
export function rankDetail(
  focusKey: string | null,
  step: { label: string; here: PanelNum; rivals: { name: string; num: PanelNum }[] } | null
): { heading: string; body: PanelText } | null {
  if (!focusKey || !step) return null;
  const ahead = step.rivals.filter((r) => shownPct(r.num) > shownPct(step.here)).sort((a, b) => b.num.pct - a.num.pct);
  if (!ahead.length) return { heading: "You lead at every step", body: join("No competitor shown here is ahead of you at any step.") };
  const names = ahead.slice(0, 2).map((r) => r.name);
  const phrase = STEP_PHRASE[focusKey] ?? focusKey;
  return {
    heading: `You fall furthest behind at "${step.label.toLowerCase()}"`,
    body: join(listWords(names), ahead.length > 1 ? " are both " : " is ", `${phrase} more often than you here.`),
  };
}

/* ---------- am35: the one sentence under a step's heading ---------- */
/* What the reader should take from the step - never a number the step bars
 * already draw; the new facts follow as rows. `than` names the comparison
 * ("across all buyers", "the average competitor", a competitor's name);
 * `thanDo` is the same for a plural verb ("they do across all buyers",
 * "the average competitor's do", "Capital One's do"). */
export type StepDir = -1 | 0 | 1;

export function namedLine(dir: StepDir, than: string, behind = true): PanelText {
  if (dir < 0) return join(`The AI mentions you less often here than ${than}, so some buyers never hear of you before it decides.`);
  if (dir > 0) return join(`The AI mentions you more often here than ${than}, so what decides it comes after you are named.`);
  return join(`The AI mentions you about as often here as ${than}, so ${behind ? "what decides it comes after you are named" : "being named is not what sets you apart"}.`);
}

/** am37: "where you lose" / "the gap" only when you are behind on the picks. */
export function recommendedLine(dir: StepDir, than: string, behind = true): PanelText {
  if (dir < 0) return join(`The AI recommends you less often here than ${than}, so ${behind ? "this is part of where you lose" : "this is the step to watch"}.`);
  if (dir > 0) return join(`The AI recommends you more often here than ${than}, so ${behind ? "this is not where the gap opens" : "this step works in your favour"}.`);
  return join(`The AI recommends you about as often here as ${than}, so ${behind ? "this is not where the gap opens" : "this step neither helps nor hurts you"}.`);
}

export function convertsLine(dir: StepDir, thanDo: string, behind = true): PanelText {
  if (dir < 0) return join(`Fewer of your recommendations end as the pick than ${thanDo}: the AI recommends you, then picks something else.`);
  if (dir > 0) return join(`More of your recommendations end as the pick than ${thanDo}, so once the AI recommends you it tends to stay with you.`);
  return join(`Your recommendations end as the pick about as often as ${thanDo}, so ${behind ? "this step is not where the gap opens" : "this step neither helps nor hurts you"}.`);
}

/** Head-to-head, "The AI picks one of the two". */
export const decidedLine = (mostly: boolean): PanelText =>
  join(mostly ? "Most of these answers settle the matchup, so who it picks matters more than whether it picks." : "Most of these answers leave the choice to the buyer, so the matchup is often not settled at all.");

/** Head-to-head, "When it picks, who it picks". */
export const wonLine = (side: "you" | "rival" | "close"): PanelText =>
  join(
    side === "you"
      ? "The AI decides this matchup for you; what is left to win is the answers where it picks neither."
      : side === "rival"
        ? "The loss is in the decision itself, not in being left out of the answer."
        : "Small shifts in what the AI weighs would change who wins this matchup."
  );

/** The title over the rows of who takes the pick after recommending you. */
export const takersTitle = (noun: string) => `When it recommends you and picks another ${noun}, it picks`;

/* ---------- am36: the verdict panels' explanation ----------
 * A heading that states the point and ONE sentence that adds what the bars
 * do not: the comparison with the usual said in words (never its two
 * figures), and where the AI points the reader instead. No number the top
 * bars draw - these sentences carry no number at all. */

/** How often a share here sits against the usual, in words (panel_tags oftenOf). */
export type OftenWords = "far more" | "more" | "about as" | "less" | "far less";
export const oftenPhrase = (w: OftenWords, here: string, usual: string) => (w === "about as" ? `about as often ${here} as ${usual}` : `${w} often ${here} than ${usual}`);

const sentence = (a: string | null, b: string) => (a ? `${upperFirst(a)}, and ${b}.` : `${upperFirst(b)}.`);

export type ValueSide = "no" | "yes" | "depends" | "split";
export type InsteadSide = "rival" | "own" | "nowhere" | "even";
/** am39: about half the answers name no cheaper option - which way the other half goes. */
export type InsteadHalf = "rival" | "own" | "even";
export function valueDetail(o: { side: ValueSide; pooled: boolean; often?: OftenWords; instead: InsteadSide; topRival?: string; noun: string }): { heading: string; body: PanelText } {
  const heading =
    o.side === "no"
      ? o.pooled
        ? "Across buyers the AI more often says it does not earn the higher price"
        : "For this buyer the AI does not think it earns the higher price"
      : o.side === "yes"
        ? o.pooled
          ? "Across buyers the AI more often says it earns the higher price"
          : "For this buyer the AI says it earns the higher price"
        : o.side === "depends"
          ? "The AI mostly says it depends on how the buyer will use it"
          : "The AI gives no clear answer on the higher price";
  const said = o.side === "yes" ? "it says worth it" : o.side === "depends" ? "it says it depends" : "it says not worth it";
  const a = o.often && !o.pooled ? `${said} ${oftenPhrase(o.often, "for this buyer", "across all your buyers")}` : null;
  const b =
    o.instead === "rival"
      ? `when it names a cheaper option it is more often a rival's ${o.noun}${o.topRival ? `, most often ${o.topRival}` : ""}`
      : o.instead === "own"
        ? `when it names a cheaper option it is more often your own than a rival's`
        : o.instead === "nowhere"
          ? "it mostly names no cheaper option at all"
          : "when it names a cheaper option, rivals' and your own come up about equally";
  return { heading, body: join(sentence(a, b)) };
}

/* ---------- am38: Value's two steps explain themselves ---------- */

/** The heading of the "is it worth it" explanation (valueDetail's). */
const valueWorthHeading = (side: ValueSide, pooled: boolean) => valueDetail({ side, pooled, instead: "even", noun: "" }).heading;

const VERDICT_SAID: Record<"yes" | "depends" | "no", string> = { yes: "says it is worth it", depends: "says it depends on how the buyer will use it", no: "says it is not worth it" };

/** "Is it worth paying more for?" - the verdict against all buyers in words;
 * without that comparison, which verdict comes next. No number. */
export function valueWorthDetail(o: { side: ValueSide; pooled: boolean; often?: OftenWords; next?: "yes" | "depends" | "no"; byProduct: boolean }): { heading: string; body: PanelText } {
  const heading = valueWorthHeading(o.side, o.pooled);
  const said = o.side === "yes" ? "it says worth it" : o.side === "depends" ? "it says it depends" : "it says not worth it";
  if (o.often && !o.pooled) return { heading, body: join(`${upperFirst(said)} ${oftenPhrase(o.often, "for this buyer", "across all your buyers")}.`) };
  if (o.byProduct) return { heading, body: join("The answer changes with the product asked about, so read each one in the table above.") };
  if (o.side === "split" || !o.next) return { heading, body: join("No one verdict holds most of these answers.") };
  return { heading, body: join(`Where it does not take that side, it more often ${VERDICT_SAID[o.next]}.`) };
}

/** "Where it points the buyer instead" - a takeaway and one sentence; the lists below carry the new facts. No number. */
export function valueInsteadDetail(o: { instead: InsteadSide; half?: InsteadHalf; ladder: boolean; topRival?: string; noun: string }): { heading: string; body: PanelText } {
  if (o.instead === "nowhere" && o.half) {
    const most = o.topRival ? `, most often ${o.topRival}` : "";
    const body = !o.ladder
      ? o.topRival
        ? `When it does name one, it is most often ${o.topRival}.`
        : "When it does name one, no single rival stands out."
      : o.half === "rival"
        ? `When it does name one, it is more often a rival's ${o.noun} than your own${most}.`
        : o.half === "own"
          ? "When it does name one, it is more often your own than a rival's."
          : "When it does name one, rivals' and your own come up about equally.";
    return { heading: "About half the time it names no cheaper option", body: join(body) };
  }
  const heading =
    o.instead === "rival"
      ? o.ladder
        ? `It points the buyer to a rival's ${o.noun} more often than to your own`
        : `When it points the buyer elsewhere, it is to a rival's ${o.noun}`
      : o.instead === "own"
        ? "It points the buyer to your own cheaper option more often than to a rival's"
        : o.instead === "nowhere"
          ? "It mostly names no cheaper option at all"
          : "Rivals' and your own cheaper options come up about equally";
  const body =
    o.instead === "own"
      ? "When it names a cheaper option, it keeps the buyer with you more often than it sends them to a rival."
      : o.instead === "nowhere"
        ? "It weighs the price without sending the buyer anywhere."
        : o.topRival
          ? `The rival it names most often is ${o.topRival}.`
          : "No single rival stands out.";
  return { heading, body: join(body) };
}

/** The verdict rows of "By what the AI said". */
export const VALUE_VERDICT_ROW: Record<"no" | "depends" | "yes", string> = { no: "Says not worth it", depends: "Says it depends", yes: "Says worth it" };
const VALUE_VERDICT_WORDS: Record<"no" | "depends" | "yes", string> = { no: "not worth it", depends: "it depends", yes: "worth it" };
export const VALUE_SECTIONS = {
  byVerdict: { title: "By what the AI said, the share that name a rival", sub: "Of the answers giving each verdict." },
  rivals: { title: "Where it points the buyer instead", sub: "Share of these answers. Open a rival to see how it gets its picks." },
  products: (plural: string) => ({ title: `Which ${plural} it names`, sub: "Share of these answers that recommend it in place of yours." }),
  own: { title: "Your own cheaper options named", sub: "Share of these answers that name it, whether or not they also name a rival." },
};
/** A verdict whose rival-naming answers are too few for a bar. */
export const valueVerdictFold = (v: "no" | "depends" | "yes", never: boolean) => `Answers that say ${VALUE_VERDICT_WORDS[v]} ${never ? "never" : "almost never"} name a rival.`;

/** am38: Value's step label, naming the product asked about. */
export const valueStepLabel = (product: string | undefined, several: boolean) => (several ? "Are they worth paying more for?" : product ? `Is ${product} worth paying more for?` : "Is it worth paying more for?");
export const BY_PRODUCT = {
  title: "By product asked about",
  sub: "Share of the answers about each product. Each buyer was asked about one product.",
  columns: ["Worth it", "Depends", "Not worth it", "Buyers asked"],
};

/** am38: "What the answer weighs", sized. */
export const WEIGHS_TITLE = "What the answer weighs";
export const WEIGHS_SUB_SIDES = "Share of the answers on each side that weigh it.";
export const WEIGHS_SUB_VERSUS = "The topics that come up more on one side than the other, with the share of that side's answers that weigh each.";
export const WEIGHS_SUB_ALL = "Share of these answers that weigh it.";
export const WEIGHS_SUB_NAMING = "Share of the answers that name it that weigh it.";
/** A side with too few answers to size what they weigh (say: "say worth it", "pick you"). */
/** A side with enough answers where no topic clears the row floor. */
export const WEIGHS_NONE = "No one topic comes up often enough on this side to size.";
export const weighsFewNote = (say: string) => `Too few answers ${say} to size what they weigh.`;

export type BuyerSide = "go" | "avoid" | "grant" | "none" | "split";
export function buyerWorryDetail(o: { side: BuyerSide; often?: OftenWords; topRival?: string }): { heading: string; body: PanelText } {
  const heading =
    o.side === "go"
      ? "The AI tells buyers this worry should not stop them"
      : o.side === "avoid"
        ? "The AI tells buyers to steer clear"
        : o.side === "grant"
          ? "It grants the worry, then leaves the decision to the buyer"
          : o.side === "none"
            ? "It answers the worry without settling it"
            : "It gives no clear answer on the worry";
  const said = o.side === "go" || o.side === "split" ? "it says go ahead" : o.side === "avoid" ? "it says steer clear" : "it takes no side";
  const a = o.often ? `${said} ${oftenPhrase(o.often, "for this worry", "across all your buyers' worries")}` : null;
  const b = o.topRival ? `the rival it names most often instead is ${o.topRival}` : "it names no rival instead often enough to list";
  return { heading, body: join(sentence(a, b)) };
}

export type KeepSide = "stay" | "leave" | "none" | "split";
/** am37: "despite the worry" only when staying is the majority AND the AI
 * grants the worry; the move-to clause only when leaving is said at all. */
export function customerWorryDetail(o: { side: KeepSide; stayMajority: boolean; granted: boolean; often?: OftenWords; topRival?: string; leaveNoDest: boolean; leaveRare: boolean; noun: string }): { heading: string; body: PanelText } {
  const heading =
    o.side === "stay"
      ? o.stayMajority
        ? o.granted
          ? "It tells customers to stay despite the worry"
          : "It tells customers to stay"
        : "It leans toward telling customers to stay"
      : o.side === "leave"
        ? "It sides with leaving over staying"
        : o.side === "none"
          ? "It mostly leaves the decision to the customer"
          : "It gives no single answer on staying or leaving";
  const said = o.side === "stay" ? "it says stay" : o.side === "none" ? "it takes no side" : "it says leave";
  const a = o.often && o.side !== "split" ? `${said} ${oftenPhrase(o.often, "for this worry", "across all your customers' worries")}` : null;
  const b = o.leaveRare
    ? "it rarely points the customer anywhere else"
    : o.leaveNoDest
      ? `most answers that say leave name no other ${o.noun} at all`
      : o.topRival
        ? `the rival it names most often to move to is ${o.topRival}`
        : "it names no rival to move to often enough to list";
  return { heading, body: join(sentence(a, b)) };
}

export function lookingAroundDetail(o: { side: KeepSide; showsMost: boolean; topRival?: string }): { heading: string; body: PanelText } {
  const heading =
    o.side === "leave"
      ? "It tells many of your customers to leave"
      : o.side === "stay"
        ? "It tells your customers to stay"
        : o.showsMost
          ? "It takes no side, and shows them other options"
          : "It mostly leaves the choice to your customer";
  const body = o.topRival
    ? `Your customers asked for alternatives, so the rivals it names, most often ${o.topRival}, are who it puts in front of them, not always who it sends them to.`
    : "Your customers asked for alternatives, so any rival it names is one it puts in front of them, not always one it sends them to.";
  return { heading, body: join(body) };
}

export function expansionDetail(top: "backs" | "redirects" | "neutral"): { heading: string; body: PanelText } {
  return {
    heading: top === "backs" ? "The AI supports your customers growing their use" : top === "redirects" ? "The AI mostly points your customers elsewhere" : "The AI mostly leaves the decision to the customer",
    body: join("The customer set the direction by asking, so read this as the AI not getting in the way, not as it choosing you over a rival."),
  };
}

export type CaseSide = "strong" | "hedged" | "against" | "even";
export function caseDetail(side: CaseSide, topics: string[]): { heading: string; body: PanelText } {
  const on = topics.length ? `, most often on ${listWords(topics)}` : "";
  return {
    heading:
      side === "strong"
        ? `The AI hands your customer a confident case${on}`
        : side === "hedged"
          ? "The AI hedges the case it hands your customer"
          : side === "against"
            ? "The AI argues against you when asked to make your case"
            : "The AI's case for you is as often hedged as confident",
    body: join("The customer already chose you and asked for arguments, so read this as how well the AI equips them, not as it choosing you over a rival."),
  };
}

export function criticDetail(heading: string, redirects: boolean, noun: string): { heading: string; body: PanelText } {
  return {
    heading,
    body: join(`The customer took your side and asked for arguments, so read this as how well the AI equips them, not as it choosing you over a rival${redirects ? "" : `, and no answer points them to another ${noun}`}.`),
  };
}

export function alongsideDetail(heading: string): { heading: string; body: PanelText } {
  return { heading, body: join("The customer asked what to use alongside you, so another company's name in the answer is the question being answered, not the AI steering them away.") };
}

/** am45: the What to look for card's two terms, behind a "?". */
export const CRITERIA_HELP = {
  checklist: "The checklist is the five things the AI most often tells buyers to look at when they ask what to look for, without asking for a product.",
  taught: "Taught means the topic is on that checklist. Seldom taught, or taught less often, means the AI raises it in the share of those answers shown, not often enough to make the checklist.",
};
/** How a topic off the checklist is described, by its share of the look-for answers (0-100). */
export const offChecklist = (pct: number) => (pct <= 0 ? "never taught" : pct >= 30 ? "taught less often" : "seldom taught");

/** am47: what the line on the "Taught in" bars is. */
export const checklistMarkNote = (share: string, n: number) => `The line is the share the ${n >= 5 ? "fifth" : "last"} topic on the AI's list reaches (${share}). A bar that reaches it is on the checklist.`;

/** am48: the head-to-head exception step and its explanation. */
export const EXCEPTION_TEXT = {
  label: (rival: string) => `In the answers that pick ${rival}`,
  still: "still says when to choose you",
  none: "gives no case for you",
  callout: "The exception",
  heading: (rival: string) => `${rival} is the pick, but the AI still sends some buyers to you`,
  body: (rival: string) => `Even in the answers that pick ${rival}, it tells these buyers to choose you instead.`,
  who: { title: "Who it still sends to you", sub: (rival: string) => `Share of the answers that pick ${rival}.`, few: "No one condition comes up often enough to size." },
};

export function criteriaDetail(gap: boolean, plural: string): { heading: string; body: PanelText } {
  return gap
    ? { heading: "The checklist the AI hands buyers leaves out your strongest points", body: join(`A buyer who follows this checklist compares ${plural} on things other brands win on.`) }
    : { heading: "The checklist the AI hands buyers covers your case", body: join("What comes up most when the AI picks you is on the list it teaches.") };
}

/** Head-to-head default explanation: no number the two step bars draw.
 * am37: the body supports its own heading - where the side that loses still
 * wins (the top condition quoted), or why a close matchup can turn. */
export function h2hDetail(o: { exception: boolean; rival: string; pooled: boolean; side: "you" | "rival" | "close"; always?: boolean; rivalCond?: string; youCond?: string; topRival?: string }): { heading: string; body: PanelText } {
  if (o.exception) return { heading: "You lose this one - with an exception", body: join(`Most of the answers that pick ${o.rival} still say when to choose you.`) };
  const R = o.pooled ? "your named rivals" : o.rival;
  const heading =
    o.side === "you"
      ? o.always ? (o.pooled ? "When it picks one of the two, it always picks you" : `When it picks between you and ${o.rival}, it always picks you`) : o.pooled ? "You win most of your head-to-heads" : `You win this matchup against ${o.rival}`
      : o.side === "rival"
        ? o.always ? (o.pooled ? "When it picks one of the two, it always picks the rival" : `When it picks between you and ${o.rival}, it always picks ${o.rival}`) : o.pooled ? "Your named rivals win most of your head-to-heads" : `${o.rival} wins this matchup`
        : "This matchup is close";
  const body =
    o.side === "you"
      ? o.rivalCond
        ? join(`What still wins answers for ${R} is "${condLabel(o.rivalCond)}".`)
        : o.pooled && o.topRival
          ? join(`The rival that takes the most of these answers from you is ${o.topRival}.`)
          : join(`The AI gives no condition for choosing ${R} often enough to list.`)
      : o.side === "rival"
        ? o.youCond
          ? join(`What still wins answers for you is "${condLabel(o.youCond)}".`)
          : join(`The AI gives no condition for choosing you often enough to list.`)
        : join("Small shifts in what the AI weighs would change who wins this matchup.");
  return { heading, body };
}

/* ---------- am41: "the answer names one <noun> as the pick" (What's popular) ---------- */
export type CommitsSide = "picks" | "depends" | "lists" | "leans_depends" | "leans_lists" | "split";
export const COMMITS_TEXT = {
  depends: "Says it depends on the buyer",
  lists: "Lists several without choosing",
  outside: "Picks something outside the category",
  outsideAnalysis: "Picks a brand outside of analysis",
  instead: { title: "What the answer does instead", sub: "Share of these answers.", few: "Too few answers take either course to size." },
  who: { title: "Who gets the pick when it names one", sub: "Share of the answers that name one pick.", few: "Too few answers name one pick to size who gets it." },
  vendor: { title: "Which AI companies name one pick", sub: "Share of each company's answers here.", few: "No AI company names one pick often enough to size." },
};
export function commitsDetail(side: CommitsSide, noun: string): { heading: string; body: PanelText } {
  const heading =
    side === "picks"
      ? `On this question the AI usually names one ${noun}`
      : side === "depends"
        ? "On this question the AI mostly says it depends on the buyer"
        : side === "lists"
          ? "On this question the AI mostly lists several without choosing"
          : side === "leans_depends"
            ? "The AI more often says it depends on the buyer than lists without choosing"
            : side === "leans_lists"
              ? "The AI more often lists several without choosing than says it depends"
              : "The AI splits between saying it depends and listing without choosing";
  const body =
    side === "picks"
      ? "Being the one it names matters here: see who gets the pick below."
      : side === "depends" || side === "leans_depends"
        ? "Popularity alone does not settle it for the AI: it asks who the buyer is before naming one."
        : side === "lists" || side === "leans_lists"
          ? "It treats the question as a request for a shortlist, so being on the list is what counts here."
          : "Either way it rarely names one, so being on the list is what counts here.";
  return { heading, body: join(body) };
}

/* ---------- am41: "the answer points the buyer to <plural>" (Spotting the problem) ---------- */
export const ROUTED_TEXT = {
  adjacent: (plural: string) => `Points to something other than ${plural}`,
  nowhere: "Points to no kind of product",
  rest: { title: "Where the other answers point", sub: "Share of these answers.", few: "Too few answers point elsewhere to size." },
  names: { title: "What it recommends there", sub: (plural: string) => `Share of the answers that point to something other than ${plural}.`, few: "No one name comes up often enough there to size." },
  vendor: { title: (plural: string) => `Which AI companies point to ${plural}`, sub: "Share of each company's answers here.", few: "Too few answers per AI company to size." },
};
export function routedDetail(side: "nearly" | "usually" | "elsewhere" | "nowhere", plural: string): { heading: string; body: PanelText } {
  const heading =
    side === "nearly"
      ? `The AI nearly always reads this problem as one ${plural} solve`
      : side === "usually"
        ? `The AI usually reads this problem as one ${plural} solve`
        : side === "elsewhere"
          ? `The AI more often sends this problem somewhere other than ${plural}`
          : `The AI more often answers this problem without pointing to any kind of product`;
  const body =
    side === "nearly"
      ? "The category is in the answer, so what is left to win is being one of the names in it."
      : side === "usually"
        ? "Some answers leave the category before any brand in it can be named: see where they go below."
        : "Most answers leave the category before any brand in it can be named, so the first thing to win here is the category itself.";
  return { heading, body: join(body) };
}

/* ---------- am41: "the answer names any brand" (Learning the category) ---------- */
export const ANYBRAND_TEXT = {
  vendor: { title: "Which AI companies name a brand", sub: "Share of each company's answers here.", few: "No AI company names a brand often enough to size." },
};
export function anyBrandDetail(side: "usually" | "sometimes" | "rarely", plural: string): { heading: string; body: PanelText } {
  const heading =
    side === "usually"
      ? "Even on a question that asks for no brand, the AI usually names some"
      : side === "sometimes"
        ? "On a question that asks for no brand, the AI sometimes names one anyway"
        : "On a question that asks for no brand, the AI rarely names one";
  const body = side === "rarely" ? `Most answers explain ${plural} in general, so there is little room here for any brand.` : `Where it does name brands it uses them as examples of ${plural}, so the names it reaches for first are the ones to watch.`;
  return { heading, body: join(body) };
}

/* ---------- am42: "named, when the answer names a brand" (Learning the category) ---------- */
export const NAMEDWHEN_TEXT = {
  others: { title: "Who is named when you are not", sub: "Share of the brand-naming answers that leave you out.", few: "Too few brand-naming answers leave you out to size who they name." },
  first: { title: "Who is named first", sub: "Share of the answers that name a brand.", few: "No brand is named first often enough to size." },
  products: { title: (plural: string) => `Which of your ${plural} it names`, sub: "Share of the answers that name you.", few: "No one product is named often enough to size." },
  vendor: { title: "Which AI companies name you", sub: "Share of each company's answers that name a brand.", few: "Too few brand-naming answers per AI company to size." },
};
export function namedWhenDetail(side: "usually" | "sometimes" | "rarely"): { heading: string; body: PanelText } {
  const heading =
    side === "usually"
      ? "When the AI reaches for brand names here, yours is usually among them"
      : side === "sometimes"
        ? "When the AI reaches for brand names here, yours is sometimes among them"
        : "When the AI reaches for brand names here, yours is rarely among them";
  const body = side === "usually" ? "You are one of the names it uses to explain the category: see who else it names, and who comes first, below." : "Other names are doing the explaining: see below who it names when it leaves you out.";
  return { heading, body: join(body) };
}

/* ---------- am50: "Agrees the worry is fair" (buyers' and customers' worries) ---------- */
export type WorryAfter = "few" | "bad" | "fav" | "none" | "split";
export const WORRY_AGREES_TEXT = {
  partly: "Partly agrees",
  wrong: "Says the worry is wrong",
  go: "Go ahead",
  avoid: "Steer clear",
  stay: "Stay",
  leave: "Leave",
  none: "No side",
  judges: { title: "The other judgements", sub: "Share of the answers that judge the worry.", few: "Almost every answer that judges the worry agrees with it." },
  after: { title: "What it advises when it agrees", sub: "Share of the answers that agree.", few: "Too few answers agree to size what follows." },
  afterWrong: { title: "What it advises when it says the worry is wrong", sub: "Share of the answers that say the worry is wrong.", few: "Too few answers say the worry is wrong to size what follows." },
  which: { title: "Which worries it agrees with most", sub: "Share of the answers that judge each worry.", few: "Too few answers judge each worry to compare them." },
  vendor: { title: "Which AI companies agree most", sub: "Share of each company's answers that judge the worry.", few: "Too few answers per AI company to size." },
};
export function worryAgreesDetail(tag: string, after: WorryAfter, buyer: boolean): { heading: string; body: PanelText } {
  const who = buyer ? "the buyer" : "the customer";
  const bad = buyer ? "steer clear" : "leave";
  const fav = buyer ? "go ahead" : "stay";
  const body =
    after === "few"
      ? "Too few answers agree to say what the AI advises next."
      : after === "bad"
        ? `When it agrees, it mostly tells ${who} to ${bad}.`
        : after === "fav"
          ? `Even when it agrees, it mostly tells ${who} to ${fav}.`
          : after === "none"
            ? `Agreeing does not settle it: after agreeing, it mostly takes no side on whether to ${fav} or ${bad}.`
            : `After agreeing, its advice is split between ${fav}, ${bad} and no side.`;
  return { heading: `The AI ${tag.charAt(0).toLowerCase()}${tag.slice(1)}`, body: join(body) };
}

/* ---------- am51: "Shows another <noun>" (your customers looking around) ---------- */
export const LOOKING_TEXT = {
  size: { title: "How long its list is", sub: (plural: string) => `Share of these answers, by how many rival ${plural} they show.`, few: "One or two", mid: "Three to five", many: "Six or more", none: "Almost no answer shows a rival." },
  first: { title: "Who it shows first", sub: "Share of the answers that show a rival.", few: "No rival is shown first often enough to size." },
  products: { title: (plural: string) => `The specific ${plural} it shows`, sub: "Share of these answers that show it.", few: "No one product is shown often enough to size." },
  own: { title: (plural: string) => `Your own other ${plural} it shows`, sub: "Share of these answers that also show it.", few: "It rarely shows another of your own." },
};
export function lookingOffersDetail(size: "long" | "short" | "few" | "none", noun: string, plural: string, first?: string): { heading: string; body: PanelText } {
  const heading =
    size === "long"
      ? `It answers with a long list of ${plural}, not one replacement`
      : size === "short"
        ? `It answers with a shortlist of ${plural}`
        : size === "few"
          ? `It points to one or two other ${plural}`
          : `It rarely shows another ${noun}`;
  const body = first
    ? `Your customer asked what else to look at, so the list is expected; ${first} is the one it most often shows first.`
    : "Your customer asked what else to look at, so the list is expected; no one rival is shown first often.";
  return { heading, body: join(body) };
}

/* ---------- am52: "Does the answer back it?" (expansion) ---------- */
export const EXPANSION_TEXT = {
  products: { title: (plural: string) => `Which of your ${plural} it backs`, sub: "Share of the answers that back it.", few: "No one product is named often enough to size." },
  vendor: { title: "Which AI companies back it most", sub: "Share of each company's answers here." },
  where: { title: "Where it points them instead", sub: "Share of the answers that point elsewhere.", few: "It rarely names where: most answers that point elsewhere name no product." },
};

/* ---------- am53: "How strong a case does the AI give the customer?" (business case) ---------- */
export const CASE_TEXT = {
  vendor: { title: "Which AI companies give a confident case most", sub: "Share of each company's answers here." },
  products: { title: (plural: string) => `Which of your ${plural} the confident case is built on`, sub: "Share of the answers that give a confident case." },
  rivals: { title: "Which rivals come up in the case", sub: "Share of these answers that name it." },
};

/* ---------- am56: "Which ones it names alongside you" (what to use alongside you) ---------- */
export const ALONGSIDE_TEXT = {
  size: { title: "How many it names", sub: "Share of these answers.", one: "One", some: "Two or three", many: "Four or more" },
  first: { title: "Which one it names first", sub: "Share of the answers that name one." },
  vendor: { title: "Which AI companies name one of yours", sub: "Share of each company's answers here." },
};

/* ---------- am57: answering a critic - the two steps ---------- */
export const CRITIC_TEXT = {
  strong: "A strong answer",
  partial: "Only part of a defense",
  vendorStrong: { title: "Which AI companies give a strong answer most", sub: "Share of each company's answers here." },
  rivals: { title: "Which rivals come up while it defends you", sub: "Share of these answers that name it." },
  whenRight: { title: "How it answers when it says the critic is right", sub: "Share of the answers that say the critic is right." },
  whenPartly: { title: "How it answers when it says the critic is partly right", sub: "Share of the answers that say the critic is partly right." },
  vendorRight: { title: "Which AI companies side with the critic most", sub: "Share of each company's answers that judge the criticism." },
};
export function criticPremiseDetail(tag: string, after: "few" | "strong" | "weak"): { heading: string; body: PanelText } {
  const heading = /^No clear answer$/.test(tag) ? "The AI gives no clear answer on whether the critic is right" : /^Split/.test(tag) ? "The AI is split on whether the critic is right" : `The AI ${tag.charAt(0).toLowerCase()}${tag.slice(1)}`;
  const body =
    after === "few"
      ? "Too few answers grant the criticism to say how the AI defends you when it does."
      : after === "strong"
        ? "Granting the criticism does not end the defense: when it concedes the point, it mostly still gives a strong answer."
        : "When it concedes the point, the defense mostly weakens to a partial one.";
  return { heading, body: join(body) };
}

/* ---------- am58: "What it tells buyers to look at" (what to look for) ---------- */
export const CRITERIA_STEP_TEXT = {
  buyers: { title: (topic: string) => `Which buyers are taught ${topic}`, sub: "Share of each buyer's answers that raise it." },
  vendor: { title: (topic: string) => `Which AI companies teach ${topic}`, sub: "Share of each company's answers that raise it." },
  size: { title: "How long its list is", sub: "Share of these answers, by how many topics they raise.", few: "Six or fewer", mid: "Seven to twelve", many: "Thirteen or more" },
  brands: { title: "Which brands it names while teaching", sub: "Share of these answers that name it. The question asks for no brand." },
  oneBuyer: {
    heading: "The AI leaves your strongest point to one buyer",
    body: (topic: string, buyer: string) => `${topic} is taught to the buyer in "${buyer}" and to almost no one else.`,
  },
};

/* ---------- am59: Premium vs basic ---------- */
export type TierWhere = "premium" | "basic" | "both" | "neither";
export const PREMIUM_TEXT = {
  stepLabel: "Which end it sides with",
  premium: "premium",
  basic: "basic",
  balanced: "balanced",
  none: "takes no side",
  conditions: {
    title: "When the AI says premium, and when basic",
    sub: 'Share of these answers that say "choose premium if the buyer..." or "choose basic if the buyer...". The grey bar shows how often it comes up where the AI says it both ways.',
    towardTitle: "Choose premium if",
    awayTitle: "Choose basic if",
    alsoToward: "Also said for basic",
    alsoAway: "Also said for premium",
  },
  ends: {
    title: "Who it names at each end",
    sub: "Share of these answers that give it as the example of that end.",
    premium: "As premium",
    basic: "As basic",
    none: (end: string) => `No ${end} example is named often enough to list.`,
  },
  weighs: { premium: "When it sides with premium", basic: "When it sides with basic", sayPremium: "side with premium", sayBasic: "side with basic" },
  vendor: { title: "Which AI companies side with basic most", sub: "Share of each company's answers here.", few: "No AI company sides with basic often enough to size." },
};
/** The claim: asked whether premium beats basic, which end the AI sides with. */
export function premiumClaim(plural: string, basic: PanelNum, premium: PanelNum, basicAll: boolean, premiumNone: boolean, basicNone: boolean): PanelText {
  const basicPart = basicNone ? "never sides with basic" : basicAll ? F("sides with basic in every answer", basic) : join("sides with basic in ", N(basic), " of answers");
  const premiumPart = basicAll ? "" : premiumNone ? (basicNone ? " or with premium" : " and never with premium") : join(" and with premium in ", N(premium));
  return join(`Asked whether premium ${plural} beat basic ones, the AI `, basicPart, premiumPart, ".");
}
/** The "which end" step explained: heading from its takeaway, one sentence on where you land (no number from the bars). */
export function tierDetail(tag: string, where: TierWhere): { heading: string; body: PanelText } {
  const HEAD: Record<string, string> = {
    "Mostly sides with basic": "The AI mostly sides with basic",
    "Always sides with basic": "The AI always sides with basic",
    "Mostly sides with premium": "The AI mostly sides with premium",
    "Always sides with premium": "The AI always sides with premium",
    "Mostly balanced": "The AI mostly gives a balanced answer",
    "Always balanced": "The AI always gives a balanced answer",
    "Leans premium": "The AI leans premium",
    "Leans basic": "The AI leans basic",
    "No clear side": "The AI takes no clear side between premium and basic",
    Split: "The AI is split between premium and basic",
  };
  const body =
    where === "premium"
      ? "When it names an example of either end, it puts you at the premium end more often than at the basic end."
      : where === "basic"
        ? "When it names an example of either end, it puts you at the basic end more often than at the premium end."
        : where === "both"
          ? "When it names an example of either end, it puts you at each end about as often."
          : "It seldom names you as the example of either end.";
  return { heading: HEAD[tag] ?? "Which end the AI sides with", body: join(body) };
}

/* ---------- am60: Habit (the customer who buys you out of habit) ---------- */
export type HabitSide = "keeps" | "moves" | "leaves";
export const HABIT_TEXT = {
  stepLabel: "Stick with you, or try something else",
  offersLabel: "Suggests another brand",
  stick: "sticks with you",
  other: "picks another brand",
  depends: "says it depends",
  nopick: "names no pick",
  outside: "picks something outside the category",
  outsideAnalysis: "picks a brand outside of analysis",
  conditions: {
    title: "When the AI says stick with you, and when to try something else",
    sub: 'Share of these answers that say "stick with it if the customer..." or "try something else if...".',
    towardTitle: "Stick with you if",
    awayTitle: "Try something else if",
    alsoToward: "Also said for trying something else",
    alsoAway: "Also said for sticking with you",
  },
  weighs: { stick: "When it says stick with you", other: "When it picks another brand", sayStick: "say stick with you", sayOther: "pick another brand" },
  vendor: { title: "Which AI companies say try something else most", sub: "Share of each company's answers that name another brand as the pick.", few: "No AI company names another brand as the pick often enough to size." },
  picks: { title: "When it names a pick, who gets it", sub: "Share of the answers that name a pick.", few: "No brand is the pick often enough to size." },
  suggested: { title: "Which brands it suggests instead", sub: "Share of these answers that suggest it. Open a rival to see how it is suggested." },
  first: { title: "Who it suggests first", sub: "Share of the answers that suggest another brand.", few: "No brand is suggested first often enough to size." },
  own: { title: (plural: string) => `Your own ${plural} it suggests`, sub: "Share of these answers that suggest it.", few: "It rarely names one of your own to try." },
};
/** The claim: whether the AI keeps a habitual customer with you or names another brand as the pick. */
export function habitClaim(stick: PanelNum, other: PanelNum, stickAll: boolean, stickNone: boolean, otherNone: boolean): PanelText {
  const stickPart = stickNone ? "never says stick with you" : stickAll ? F("says stick with you in every answer", stick) : join("says stick with you in ", N(stick), " of answers");
  const otherPart = stickAll ? "" : otherNone ? " and never names another brand as the pick" : join(" and names another brand as the pick in ", N(other));
  return join("When a customer who buys you out of habit asks whether to stick with you or try something else, the AI ", stickPart, otherPart, ".");
}
/** The habit step explained: heading from its takeaway, one sentence on what decides it (no number from the bars). */
export function habitDetail(tag: string, side: HabitSide): { heading: string; body: PanelText } {
  const HEAD: Record<string, string> = {
    "Mostly sticks with you": "The AI mostly tells the customer to stick with you",
    "Always sticks with you": "The AI always tells the customer to stick with you",
    "Mostly says try something else": "The AI mostly tells the customer to try something else",
    "Always says try something else": "The AI always tells the customer to try something else",
    "Mostly says it depends": "The AI mostly says it depends",
    "Always says it depends": "The AI always says it depends",
    "Mostly names no pick": "The AI mostly names no pick",
    "Always names no pick": "The AI always names no pick",
    "Leans stick": "The AI leans toward sticking with you",
    "Leans switch": "The AI leans toward trying something else",
    "No clear side": "The AI takes no clear side between sticking and switching",
    Split: "The AI is split between sticking and switching",
  };
  const body =
    side === "keeps"
      ? "It mostly keeps the customer with you, so the habit holds when the AI is asked."
      : side === "moves"
        ? "It mostly moves the customer to another brand, so asking breaks the habit."
        : "It mostly leaves it to the customer, so what they say about themselves decides whether the habit holds.";
  return { heading: HEAD[tag] ?? "Whether the AI keeps the habit", body: join(body) };
}
/** The "suggests another brand" step explained. */
export function habitOffersDetail(size: "most" | "some" | "rarely", first?: string): { heading: string; body: PanelText } {
  const heading = size === "most" ? "It usually suggests other brands to try" : size === "some" ? "It suggests other brands in some answers" : "It rarely suggests another brand";
  const body =
    size === "rarely"
      ? "It mostly answers without naming another brand to try."
      : first
        ? `The customer asked whether to try something else, so naming others is expected; ${first} is the one it most often suggests first.`
        : "The customer asked whether to try something else, so naming others is expected; no one brand is suggested first often.";
  return { heading, body: join(body) };
}

/* ---------- am61: Your customers making your case - All questions ---------- */
export const SETTLED_ALL_TEXT = {
  stepLabel: "What the answer does for the relationship",
  strengthens: "strengthens",
  neutral: "neutral",
  weakens: "weakens",
  byQuestion: { title: "By question", sub: "Share of each question's answers that strengthen the relationship. Open a question to read it in full." },
  vendor: { title: "Which AI companies strengthen it least", sub: "Share of each company's answers that strengthen the relationship." },
  weak: { title: "Where it weakens the relationship", sub: "Share of each question's answers that weaken it." },
};
/** The claim: what the AI's answers do for the relationship when your own customers ask it to help them with you. */
export function settledAllClaim(str: PanelNum, weak: PanelNum, strAll: boolean, strNone: boolean, weakNone: boolean): PanelText {
  const strPart = strNone ? "never strengthens the relationship" : strAll ? F("strengthens the relationship in every answer", str) : join("strengthens the relationship in ", N(str), " of answers");
  const weakPart = strAll ? "" : weakNone ? " and never weakens it" : join(" and weakens it in ", N(weak));
  return join("When your own customers ask the AI to help them with you, its answer ", strPart, weakPart, ".");
}
/** The step explained: heading from its takeaway, one sentence naming the question where it does least (no number). */
export function settledAllDetail(tag: string, weakest?: string[]): { heading: string; body: PanelText } {
  const HEAD: Record<string, string> = {
    "Mostly strengthens it": "The AI mostly strengthens the relationship",
    "Always strengthens it": "The AI always strengthens the relationship",
    "Mostly weakens it": "The AI mostly weakens the relationship",
    "Always weakens it": "The AI always weakens the relationship",
    "Mostly neutral": "The AI mostly leaves the relationship as it is",
    "Always neutral": "The AI always leaves the relationship as it is",
    "Leans strengthens": "The AI leans toward strengthening the relationship",
    "Leans weakens": "The AI leans toward weakening the relationship",
    "No clear side": "The AI takes no clear side on the relationship",
    Split: "The AI is split on the relationship",
  };
  const q = (x: string) => `"${x}"`;
  const body = weakest?.length
    ? weakest.length === 1
      ? `It does least for the relationship on ${q(weakest[0])}, well below the other questions.`
      : `It does least for the relationship on ${weakest.slice(0, -1).map(q).join(", ")} and ${q(weakest[weakest.length - 1])}, well below the other questions.`
    : "The questions read alike: none does much less for the relationship than the others.";
  return { heading: HEAD[tag] ?? "What the answer does for the relationship", body: join(body) };
}
