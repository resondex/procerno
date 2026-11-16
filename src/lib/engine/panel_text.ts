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

/** "a" or "an" before a word. */
export const article = (w: string) => (/^[aeiou]/i.test(w.trim()) ? "an" : "a");

/** Plain text. */
export const T = (t: string): PanelSpan => ({ t });
/** A stated number: its value, answers and counts. */
export const N = (n: PanelNum): PanelSpan => ({ t: n.value, ...(n.refs ? { refs: n.refs } : {}), tip: n.tip });
/** A stated fact (a condition, a product) with its answers. */
export const F = (t: string, n?: PanelNum): PanelSpan => ({ t, ...(n?.refs ? { refs: n.refs } : {}), ...(n ? { tip: n.tip } : {}) });

/** Joins spans, merging adjacent plain text. */
export function join(...parts: (PanelSpan | PanelText | string | null | undefined | false)[]): PanelText {
  const out: PanelText = [];
  const push = (s: PanelSpan) => {
    const last = out[out.length - 1];
    if (last && !last.refs && !last.tip && !s.refs && !s.tip) last.t += s.t;
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
  return out;
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

/** Normal view, a funnel panel: the step furthest from the usual. */
export function funnelDetail(
  focus: { key: string; below: boolean } | null,
  steps: Record<string, { here: PanelNum; usual: PanelNum } | undefined>,
  who: { here: string; usual: string }
): { heading: string; body: PanelText } {
  const rec = steps.recommended;
  const conv = steps.converts;
  const nam = steps.named;
  if (!focus) {
    return {
      heading: `You do about as well ${who.here} as ${who.usual}`,
      body: join(
        nam ? join("You are named in ", N(nam.here), ` of answers ${who.here}, against `, N(nam.usual), ` ${who.usual}.`) : null
      ),
    };
  }
  const line = (k: string, label: string) => {
    const s = steps[k];
    return s ? join(label, " in ", N(s.here), ` of answers ${who.here}, against `, N(s.usual), ` ${who.usual}.`) : null;
  };
  if (focus.key === "recommended" && focus.below && conv && conv.here.pct > conv.usual.pct) {
    return {
      heading: "The AI recommends you less often here, and picks you more often when it does",
      body: join(line("recommended", "You are recommended"), " But ", N(conv.here), " of those recommendations end as the pick, against your usual ", N(conv.usual), "."),
    };
  }
  if (focus.key === "converts" && focus.below && rec && rec.here.pct >= rec.usual.pct) {
    return {
      heading: "The AI recommends you here, and rarely makes you the pick",
      body: join(line("recommended", "You are recommended"), " But only ", N(steps.converts!.here), " of those recommendations end as the pick, against your usual ", N(steps.converts!.usual), "."),
    };
  }
  const more = focus.below ? "less" : "more";
  const HEAD: Record<string, string> = {
    named: `You are named ${more} often here than usual`,
    recommended: `You are recommended ${more} often here than usual`,
    converts: `${focus.below ? "Fewer" : "More"} of your recommendations end as the pick here than usual`,
    category: `The answers stay with the category ${more} often here than usual`,
  };
  const body =
    focus.key === "converts" && conv
      ? join(N(conv.here), ` of your recommendations end as the pick ${who.here}, against `, N(conv.usual), ` ${who.usual}.`)
      : line(focus.key, focus.key === "named" ? "You are named" : focus.key === "recommended" ? "You are recommended" : "The answer is about the category");
  return { heading: HEAD[focus.key] ?? `This step differs from your usual`, body: join(body) };
}

/** Comparison view, a funnel panel: the step where you fall furthest behind. */
export function rankDetail(
  focusKey: string | null,
  step: { label: string; here: PanelNum; rivals: { name: string; num: PanelNum }[] } | null
): { heading: string; body: PanelText } | null {
  if (!focusKey || !step) return null;
  const ahead = step.rivals.filter((r) => r.num.pct > step.here.pct).sort((a, b) => b.num.pct - a.num.pct);
  if (!ahead.length) return { heading: "You lead at every step", body: join("No competitor shown here is ahead of you at any step.") };
  const names = ahead.slice(0, 2).map((r) => r.name);
  const phrase = STEP_PHRASE[focusKey] ?? focusKey;
  return {
    heading: `You fall furthest behind at "${step.label.toLowerCase()}"`,
    body: join(
      listWords(names),
      ahead.length > 1 ? " are both " : " is ",
      `${phrase} more often than you here: `,
      listSpans(ahead.slice(0, 2).map((r) => N(r.num))),
      ", against your ",
      N(step.here),
      "."
    ),
  };
}

/* ---------- am35: the one sentence under a step's heading ---------- */
/* What the reader should take from the step - never a number the step bars
 * already draw; the new facts follow as rows. `than` names the comparison
 * ("across all buyers", "the average competitor", a competitor's name);
 * `thanDo` is the same for a plural verb ("they do across all buyers",
 * "the average competitor's do", "Capital One's do"). */
export type StepDir = -1 | 0 | 1;

export function namedLine(dir: StepDir, than: string): PanelText {
  if (dir < 0) return join(`The AI mentions you less often here than ${than}, so some buyers never hear of you before it decides.`);
  if (dir > 0) return join(`The AI mentions you more often here than ${than}, so what decides it comes after you are named.`);
  return join(`The AI mentions you about as often here as ${than}, so what decides it comes after you are named.`);
}

export function recommendedLine(dir: StepDir, than: string): PanelText {
  if (dir < 0) return join(`The AI recommends you less often here than ${than}, so this is part of where you lose.`);
  if (dir > 0) return join(`The AI recommends you more often here than ${than}, so this is not where the gap opens.`);
  return join(`The AI recommends you about as often here as ${than}, so this is not where the gap opens.`);
}

export function convertsLine(dir: StepDir, thanDo: string): PanelText {
  if (dir < 0) return join(`Fewer of your recommendations end as the pick than ${thanDo}: the AI recommends you, then picks something else.`);
  if (dir > 0) return join(`More of your recommendations end as the pick than ${thanDo}, so once the AI recommends you it tends to stay with you.`);
  return join(`Your recommendations end as the pick about as often as ${thanDo}, so this step is not where the gap opens.`);
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
export function customerWorryDetail(o: { side: KeepSide; often?: OftenWords; topRival?: string; leaveNoDest: boolean; noun: string }): { heading: string; body: PanelText } {
  const heading =
    o.side === "stay"
      ? "It tells customers to stay despite the worry"
      : o.side === "leave"
        ? "It sides with leaving over staying"
        : o.side === "none"
          ? "It mostly leaves the decision to the customer"
          : "It splits between staying and leaving";
  const said = o.side === "stay" ? "it says stay" : o.side === "none" ? "it takes no side" : "it says leave";
  const a = o.often ? `${said} ${oftenPhrase(o.often, "for this worry", "across all your customers' worries")}` : null;
  const b = o.leaveNoDest
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
          ? "It does not push them out, but it shows them the door"
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

export function criteriaDetail(gap: boolean, plural: string): { heading: string; body: PanelText } {
  return gap
    ? { heading: "The checklist the AI hands buyers leaves out your strongest points", body: join(`A buyer who follows this checklist compares ${plural} on things other brands win on.`) }
    : { heading: "The checklist the AI hands buyers covers your case", body: join("What comes up most when the AI picks you is on the list it teaches.") };
}

/** Head-to-head default explanation: no number the two step bars draw. */
export function h2hDetail(o: { exception: boolean; rival: string; pooled: boolean; side: "you" | "rival" | "close"; mostlyDecided: boolean }): { heading: string; body: PanelText } {
  if (o.exception) return { heading: "You lose this one - with an exception", body: join(`Most of the answers that pick ${o.rival} still say when to choose you.`) };
  const heading =
    o.side === "you"
      ? o.pooled ? "You win most of your head-to-heads" : `You win this matchup against ${o.rival}`
      : o.side === "rival"
        ? o.pooled ? "Your named rivals win most of your head-to-heads" : `${o.rival} wins this matchup`
        : "This matchup is close";
  return { heading, body: decidedLine(o.mostlyDecided) };
}
