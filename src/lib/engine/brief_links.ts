/**
 * Where a Brief number opens (2026-11-17, bf33): resolved at compose time against the index of what each card
 * shows (panel_index.ts), never by a number string that happens to appear on a card. A number goes to the card
 * that shows it beside the fact's own subject - a rival, an argument, a buyer, a worry - by default if it can,
 * else behind the one interaction the link opens it with. The unit's own anchors are searched first, then every
 * Map cell and By rival card (never the Overview). A number found nowhere keeps the Brief's own answer card.
 */
import type { AnalysisMapView, Position, RivalAcross } from "./analysis_types";
import type { PanelReveal } from "./panel_view";
import { indexAcross, indexPanel, numberTokens, type IndexEntry } from "./panel_index";

/** A card that shows the number: which card, the one interaction that shows it (if any), and whether it is on view at once. */
export interface FoundLink {
  dest: { kind: "cell" | "rival"; id: string };
  reveal?: PanelReveal;
  at: IndexEntry["at"];
}

export interface LinkResolver {
  /** The card that shows `token` for a sentence, searching `own` (cell ids / rival names) first. */
  find(token: string, local: string, sentence: string, own: { cells: string[]; rivals: string[] }, scope?: "linked" | "anywhere"): FoundLink | null;
  /** Whether `dest` shows `token` beside this sentence's subject, by default or with exactly `reveal`. */
  shows(dest: FoundLink["dest"], token: string, local: string, sentence: string, reveal?: PanelReveal): boolean;
  /** The key terms (rivals, arguments, buyers, worries) a piece of text names. */
  terms(text: string): string[];
}

const low = (s: string) => s.toLowerCase();

/** What a number measures, read from the words beside it (a sentence's stretch, a card's bar or row label). */
const MEASURES: [string, RegExp][] = [
  // "X comes up in N% of the answers" (no "that pick") is how often X is named; "... of the answers that pick Y" is an argument's share.
  ["named", /\bnam(e|ed|es|ing)\b|\bmention|comes up in \S+ of the answers(?! that pick)/i],
  ["recommended", /recommend/i],
  ["picked", /\bpick|\bchose|\bchoos|commits|settles|takes? (none|every|\d)|share of/i],
  ["worth", /worth|depends/i],
  ["stay", /\bstay|\bleave|told to|keep/i],
  ["ahead", /go ahead|steer clear|hold back/i],
  ["agree", /\bagree|\bfair\b|critic|confirm/i],
  ["argued", /argu|comes up (more|in \S+ of (the|those) answers that pick)|bring up|weigh|look for|taught|raises/i],
];
const measures = (s: string) => new Set(MEASURES.filter(([, re]) => re.test(s)).map(([k]) => k));

/**
 * terms: every rival name, reason code, buying situation and worry the tracker has - the subjects a number can be
 * about. The tracker's own brand is "You" on every card, so it is never a term.
 */
export function linkResolver(map: AnalysisMapView, terms: string[], codes: string[] = []): LinkResolver {
  // An argument's name is the subject only of a number about arguments ("comes up in N% of the answers that pick
  // ..."); elsewhere a code that is an everyday word ("price") is just a word in the sentence.
  const codeSet = new Set(codes.map((c) => c.trim().toLowerCase()));
  const subjectTerms = (ts: string[], local: string) => (measures(local).has("argued") ? ts : ts.filter((t) => !codeSet.has(low(t))));
  // bf34: a sentence about one argument ("X comes up in A of the answers that pick Y and B of those that pick a rival")
  // - every number in it is about that argument, even when its own stretch does not name it.
  const localOf = (local: string, sentence: string) => {
    const own = subjectTerms(termsOf(local), local);
    if (own.length || !measures(sentence).has("argued")) return own;
    const codes = termsOf(sentence).filter((t) => codeSet.has(low(t)));
    return codes.length === 1 ? codes : own;
  };
  const list = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 3))].sort((a, b) => b.length - a.length);
  const termsOf = (s: string) => {
    const l = low(s);
    const out: string[] = [];
    for (const t of list) {
      const tl = low(t);
      // A shorter term inside a longer one already taken (a rival inside a product name) is the same mention.
      if (l.includes(tl) && !out.some((o) => low(o).includes(tl))) out.push(t);
    }
    return out;
  };
  const cellIndex = new Map<string, IndexEntry[]>();
  const cellIdx = (id: string): IndexEntry[] => {
    let x = cellIndex.get(id);
    if (!x) {
      const p: Position | undefined = map.positions[id];
      const usual = p?.panel?.usualCellId ? map.positions[p.panel.usualCellId]?.panel?.steps : undefined;
      x = p ? indexPanel(p, usual) : [];
      cellIndex.set(id, x);
    }
    return x;
  };
  const rivalByName = new Map((map.rivalPanels ?? []).map((r) => [low(r.name), r]));
  const rivalIndex = new Map<string, IndexEntry[]>();
  const rivalIdx = (name: string): IndexEntry[] => {
    const r: RivalAcross | undefined = rivalByName.get(low(name));
    if (!r) return [];
    let x = rivalIndex.get(r.name);
    if (!x) {
      x = indexAcross(r);
      rivalIndex.set(r.name, x);
    }
    return x;
  };
  /** The subject a card is about: the terms in its own name (a rival, a buyer, a worry); none on an all-buyers card. */
  const subjectOf = (kind: "cell" | "rival", id: string) => (kind === "rival" ? [id] : termsOf(map.positions[id]?.where ?? ""));

  /**
   * Whether an entry shows this number for this sentence: the same number token, a card whose own subject the
   * sentence names (or a card about no one subject), and - when the number's own stretch of the sentence names a
   * subject - that subject beside the number or as the card's subject.
   */
  const fits = (e: IndexEntry, token: string, localTerms: string[], sentenceTerms: string[], subject: string[], local = "") => {
    if (!numberTokens(e.value).includes(token)) return false;
    // The same measure: when both the number's own words and the card's words name what is measured, they agree.
    const a = measures(local);
    const b = measures(e.words);
    if (a.size && b.size && ![...a].some((m) => b.has(m))) return false;
    if (subject.length && !subject.some((t) => sentenceTerms.some((s) => low(s) === low(t) || low(s).includes(low(t)) || low(t).includes(low(s))))) return false;
    if (!localTerms.length) return true;
    const ctx = low(`${e.words} ${subject.join(" ")}`);
    // A rival's own card inside a cell: its name sits in the entry's words.
    return localTerms.some((t) => ctx.includes(low(t)));
  };

  const best = (cands: { kind: "cell" | "rival"; id: string }[], token: string, localTerms: string[], sentenceTerms: string[], local: string) => {
    let one: { dest: FoundLink["dest"]; reveal?: PanelReveal } | null = null;
    for (const c of cands) {
      const subject = subjectOf(c.kind, c.id);
      const entries = c.kind === "cell" ? cellIdx(c.id) : rivalIdx(c.id);
      for (const e of entries) {
        if (!fits(e, token, localTerms, sentenceTerms, subject, local)) continue;
        // A rival's own card inside a cell is only right when that rival is the subject.
        if (e.reveal?.rival && !sentenceTerms.some((t) => low(t) === low(e.reveal!.rival!))) continue;
        if (e.at === "default") return { dest: c, at: "default" as const } satisfies FoundLink;
        if (!one) one = { dest: c, ...(e.reveal ? { reveal: e.reveal } : {}) };
      }
    }
    return one ? ({ ...one, at: "one" } satisfies FoundLink) : null;
  };

  return {
    terms: termsOf,
    shows(dest, token, local, sentence, reveal) {
      const subject = subjectOf(dest.kind, dest.id);
      const entries = dest.kind === "cell" ? cellIdx(dest.id) : rivalIdx(dest.id);
      const same = (a?: PanelReveal, b?: PanelReveal) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      return entries.some((e) => fits(e, token, localOf(local, sentence), termsOf(sentence), subject, local) && (e.at === "default" || same(e.reveal, reveal)));
    },
    find(token, local, sentence, own, scope = "linked") {
      const localTerms = localOf(local, sentence);
      const sentenceTerms = termsOf(sentence);
      const ownCands = [...own.cells.map((id) => ({ kind: "cell" as const, id })), ...own.rivals.filter((n) => rivalByName.has(low(n))).map((id) => ({ kind: "rival" as const, id }))];
      const mine = best(ownCands, token, localTerms, sentenceTerms, local);
      if (mine) return mine;
      // Beyond the unit's own cards only a number tied to a named subject travels (a bare "11%" never matches by chance).
      // ("anywhere": the harness asking whether an unlinked figure exists on any card at all.)
      if (scope !== "anywhere" && !localTerms.length) return null;
      const all = [
        ...Object.keys(map.positions).map((id) => ({ kind: "cell" as const, id })),
        ...[...rivalByName.values()].map((r) => ({ kind: "rival" as const, id: r.name })),
      ];
      return best(all, token, localTerms, sentenceTerms, local);
    },
  };
}

/**
 * The words a number in a unit is read with: `local` - its own stretch (back to the number before it, on to the
 * next when that names no subject), and `sentence` - its sentence; both carry `context` (a paragraph's lead that
 * names its buying situation, a row's label). The Brief and the links harness read numbers the same way.
 */
export function numberContext(R: LinkResolver, text: string, start: number, end: number, context = ""): { local: string; sentence: string } {
  const toks = [...text.matchAll(/\d+(?:\.\d+)?%|[+-]\d+ (?:pts|points)/g)];
  const i = toks.findIndex((m) => m.index === start);
  const prevEnd = i > 0 ? toks[i - 1].index! + toks[i - 1][0].length : 0;
  const nextStart = i >= 0 && i < toks.length - 1 ? toks[i + 1].index! : text.length;
  const sb = Math.max(text.lastIndexOf(". ", start) + 1, 0);
  const se = text.indexOf(". ", end);
  const sEnd = se < 0 ? text.length : se + 1;
  const back = text.slice(Math.max(prevEnd, sb), end);
  // A clause after a semicolon is another fact ("... leave in 35%; <rival> is where it sends them").
  const semi = text.indexOf(";", end);
  const around = text.slice(Math.max(prevEnd, sb), Math.min(nextStart, sEnd, semi < 0 ? text.length : semi));
  return { local: `${context} ${R.terms(back).length ? back : around}`, sentence: `${context} ${text.slice(sb, sEnd)}` };
}
