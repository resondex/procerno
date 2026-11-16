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
