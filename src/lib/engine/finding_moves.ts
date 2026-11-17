import { buyerPhrase, possName } from "./brief_words";

/**
 * am62 (2026-11-16, Tyler: "Fix all seven"): the move each Overview finding
 * carries, written for the finding rather than borrowed from the map cell it
 * is placed on. One entry per insight key (and per direction where a key
 * reads both ways - `variant`): a move family from the map's own seven
 * (analysis_map.ts LEVER) and ONE template sentence with the finding's own
 * names filled in. Plain language, no counts, no category or brand words
 * (names come from the data). A key with no entry falls back to the cell's
 * lever (tensionsOf).
 */

export type MoveFamily = "Keep it" | "Check the facts first" | "Publish your case" | "Back it up" | "Choose where to compete" | "Size the trade-down" | "Fix the record";

/** The names a finding hands its move (every field optional; templates read only theirs). */
export interface MoveNames {
  /** Which way the finding reads, for keys that read both ways ("behind" / "ahead", ...). */
  variant?: string;
  rival?: string;
  topic?: string;
  /** A buying situation's label (quoted in the sentence). */
  buyer?: string;
  buyer2?: string;
  worry?: string;
  vendor?: string;
  vendor2?: string;
  condition?: string;
  /** A question type: its plain name ("value", vendor_outlier) or where it is asked ("in direct matchups", argument_flip). */
  question?: string;
  /** "with web search" / "without web search". */
  mode?: string;
}

export interface FindingMove {
  family: MoveFamily | string;
  text: string;
  /** The same sentence as a move above it on the page: the Overview shows the family and "Same move as above". */
  repeat?: true;
}

const cap = (x: string) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
const low = (x: string) => (x ? x.charAt(0).toLowerCase() + x.slice(1) : x);
const q = (x: string) => `"${x}"`;
const poss = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** bf26: the words a move uses for its subject. Served (Overview, Map): the second person; the Brief: the
 * subject by name, "it" / "its" after the first mention, buyers as words (brief_words.ts). */
interface Voice {
  you: string;
  You: string;
  your: string;
  Your: string;
  /** The subject again, after it has been named ("you" / "it"). */
  it: string;
  its: string;
  /** "you are" / "<name> is". */
  youAre: string;
  /** A buying situation inside the sentence. */
  b: (label: string) => string;
  /** A rival's possessive (the Brief's house style: always 's). */
  p: (name: string) => string;
}
const SECOND: Voice = { you: "you", You: "You", your: "your", Your: "Your", it: "you", its: "your", youAre: "you are", b: (l) => `the buyer in ${q(l)}`, p: (x) => poss(x) };
const thirdOf = (name: string): Voice => ({ you: name, You: name, your: possName(name), Your: possName(name), it: "it", its: "its", youAre: `${name} is`, b: (l) => buyerPhrase(l), p: (x) => possName(x) });

type Entry = { family: MoveFamily; text: (n: MoveNames, y: Voice) => string };

/** key or "key:variant" -> the move. */
export const FINDING_MOVES: Record<string, Entry> = {
  // The Overview's opening funnel paragraph (map tension, never a card) and its insight twin.
  known_vs_picked: { family: "Publish your case", text: (_n, y) => `Give the AI grounds to pick ${y.you}, not just to name ${y.it}: publish the case for choosing ${y.it} where buyers compare.` },
  funnel: { family: "Publish your case", text: (_n, y) => `Give the AI grounds to pick ${y.you}, not just to name ${y.it}: publish the case for choosing ${y.it} where buyers compare.` },

  engine_spread: { family: "Back it up", text: (n, y) => `Read what ${n.vendor} says about ${y.you} beside ${n.vendor2}, which picks ${y.it} most, and close the gap where their answers part.` },
  engine_vendor: { family: "Back it up", text: (n, y) => `Read the answers from ${n.vendor}, the AI company that picks ${y.you} least, beside those from ${n.vendor2}, and find what the first one does not see.` },
  "engine_mode:hurts": { family: "Publish your case", text: (_n, y) => `Check the pages the AI finds when it searches: ${y.your} share drops with web search, so get ${y.its} case onto the sources it reads.` },
  "engine_mode:helps": { family: "Keep it", text: (_n, y) => `The pages the AI finds when it searches work for ${y.you}; keep them current and easy to find.` },
  engine_decisiveness: { family: "Back it up", text: (n, y) => `Read ${y.your} picks ${n.mode} first: that is where the AI commits to one pick most often, so that is where picks are won or lost.` },
  engine_h2h_flip: { family: "Back it up", text: (_n, y) => `Read ${y.your} matchup wins and ${y.its} picks with and without web search side by side before acting; they point in opposite directions.` },
  "engine_pick_concentration:you": { family: "Back it up", text: (n, y) => `Most of ${y.your} picks come from ${n.vendor}; build the proof the other AI companies look for, so ${y.its} picks do not rest on one.` },
  "engine_pick_concentration:rival": { family: "Check the facts first", text: (n, y) => `${cap(y.p(n.rival ?? "this rival"))} picks lean on ${n.vendor}; read those answers before treating ${n.rival} as a threat everywhere.` },
  vendor_outlier: { family: "Check the facts first", text: (n) => `Read what ${n.vendor} says on ${low(n.question ?? "this question")} before acting: it answers very differently from the other AI companies.` },

  room_win: { family: "Choose where to compete", text: (n, y) => `Decide whether to win back ${y.b(n.buyer ?? "")} or to put ${y.your} effort where ${y === SECOND ? "you already win" : "it already wins"}, with ${y.b(n.buyer2 ?? "")}.`.replace(/, with the buyer in /, ", in ") },
  room_value: { family: "Choose where to compete", text: (n, y) => `Lead ${y.your} price case ${y === SECOND ? `in ${q(n.buyer2 ?? "")}` : `with ${y.b(n.buyer2 ?? "")}`}, where the AI already says ${y.youAre} worth paying more for, and decide whether ${y.b(n.buyer ?? "")} is one to win on price.` },
  pick_concentration_room: { family: "Choose where to compete", text: (n, y) => `Defend ${y === SECOND ? q(n.buyer ?? "") : y.b(n.buyer ?? "")}, where most of ${y.your} picks come from, and decide which other buyer is worth a case of its own.` },
  "pick_concentration_question:you": { family: "Back it up", text: (_n, y) => `Most of ${y.your} picks rest on one question; build the case for the other questions buyers ask, so one question is not carrying ${y.it}.` },
  "pick_concentration_question:rival": { family: "Choose where to compete", text: (n, y) => `${cap(y.p(n.rival ?? "this rival"))} picks rest on one question; decide whether to contest that question or leave it to ${n.rival}.` },

  "rival_open:behind": { family: "Publish your case", text: (n, y) => `See what the answers that pick ${n.rival} argue, and publish ${y.your} evidence on those points where the AI looks.` },
  "rival_open:ahead": { family: "Keep it", text: (n, y) => `Keep the evidence that puts ${y.you} ahead of ${n.rival} current and easy for the AI to find.` },
  "rival_h2h:lose": {
    family: "Check the facts first",
    text: (n, y) => (y === SECOND ? `Read what the AI says about ${n.rival} against you and check it against your own data before you answer it.` : `Read what the AI says about ${n.rival} against ${y.you} and check it against ${y.its} own data before answering it.`),
  },
  "rival_h2h:win": { family: "Keep it", text: (n, y) => (y === SECOND ? `You hold your matchup with ${n.rival}; keep the proof behind it current.` : `${y.You} holds its matchup with ${n.rival}; keep the proof behind it current.`) },
  "prompted_vs_open:matchups": { family: "Back it up", text: (_n, y) => `${y.Your} matchup wins do not reach buyers who ask what to buy; build the proof where buyers ask without naming a rival.` },
  "prompted_vs_open:open": {
    family: "Check the facts first",
    text: (_n, y) =>
      y === SECOND
        ? "You win when buyers ask what to buy but lose when compared directly; read what the AI says in the matchups and check it against your own data."
        : `${y.You} wins when buyers ask what to buy but loses when compared directly; read what the AI says in the matchups and check it against ${y.its} own data.`,
  },
  "conversion_vs_rival:behind": { family: "Publish your case", text: (n, y) => `The AI recommends ${y.you} but picks ${n.rival}; give it clear grounds to pick ${y.it} over ${n.rival}, not only to list ${y.it}.` },
  "conversion_vs_rival:ahead": { family: "Keep it", text: (n, y) => `When the AI recommends ${y.you} it picks ${y.it} more often than ${n.rival}; keep the case it makes for ${y.it} current.` },
  unasked_rival: {
    family: "Choose where to compete",
    text: (n, y) => (y === SECOND ? `Ask the AI to pick between you and ${n.rival} at the next collection, so you can see how you would do against it.` : `Ask the AI to pick between ${y.you} and ${n.rival} at the next collection, to see how ${y.you} would do against it.`),
  },

  argument: { family: "Publish your case", text: (n, y) => `Put ${low(n.topic ?? "")} where the AI looks: it comes up most when the AI picks ${y.you}.` },
  "taught_vs_winning:untaught": { family: "Publish your case", text: (n) => `Get ${low(n.topic ?? "")} into the guides and explainers the AI draws on, so it teaches buyers to look for it.` },
  "taught_vs_winning:losing": {
    family: "Publish your case",
    text: (n, y) =>
      y === SECOND
        ? `The AI teaches buyers to weigh ${low(n.topic ?? "")}, which favours your rivals; publish your evidence on it where the AI looks.`
        : `The AI tells buyers to look for ${low(n.topic ?? "")}, which favours ${y.your} rivals; publish its evidence on it where the AI looks.`,
  },
  neutralized_differentiator: {
    family: "Publish your case",
    text: (n, y) => `${cap(n.topic ?? "")} no longer sets ${y.you} apart${n.rival ? ` from ${n.rival}` : ""}; publish evidence on it that ${y.its} rivals cannot claim, or lead with another point.`,
  },
  argument_flip: { family: "Publish your case", text: (n, y) => `Publish a case for ${low(n.topic ?? "")} that holds ${n.question ?? "everywhere"}, where it currently helps ${y.your} rivals.` },

  "doubt_rollup:holds": { family: "Keep it", text: (_n, y) => `Keep answering the worries buyers and customers raise where the AI looks, so it keeps siding with ${y.you}.` },
  "doubt_rollup:loses": { family: "Check the facts first", text: (_n, y) => `Check the worries that send customers away against ${y.your} own data; if they are true, the fix is the product.` },
  doubt_worry: { family: "Check the facts first", text: (n) => `Check whether ${q(n.worry ?? "")} is true; if it is, the fix is the product, and if not, publish the evidence where the AI looks.` },
  worst_worry: { family: "Check the facts first", text: (n, y) => `Answer ${q(n.worry ?? "")} first: check it against ${y.your} own data, since it is the worry that most often has the AI tell customers to leave.` },
  agreed_yet_stay: { family: "Check the facts first", text: (_n, y) => `The AI grants the worry and still sides with ${y.you}; check the worry against ${y.its} own data before that changes.` },
  advocacy_vs_objection: {
    family: "Back it up",
    text: (_n, y) =>
      y === SECOND
        ? "Your case holds when customers ask you to make it, not when buyers raise worries; publish the answers to those worries where the AI looks."
        : `${y.Your} case holds when its customers ask for it, not when buyers raise worries; publish the answers to those worries where the AI looks.`,
  },
  leave_no_exit: { family: "Size the trade-down", text: (_n, y) => `Find out whether a cheaper or paused option of ${y === SECOND ? "your own" : `${y.your} own`} would keep the customers the AI tells to leave with nowhere to go.` },

  "value_in_house:own": { family: "Size the trade-down", text: (_n, y) => `Find out how much of this demand moves to ${y === SECOND ? "your" : y.your} own cheaper option and how much leaves altogether.` },
  "value_in_house:rivals": { family: "Publish your case", text: (_n, y) => `When the AI doubts ${y.your} price it sends buyers to rivals; publish what the extra price buys, where the AI looks.` },

  "leaver_capture:capture": {
    family: "Keep it",
    text: (n, y) => (n.rival ? `Keep what makes customers leaving ${n.rival} pick ${y.you} current and easy for the AI to find.` : `Keep what makes rivals' customers pick ${y.you} current and easy for the AI to find.`),
  },
  "leaver_capture:miss": {
    family: "Publish your case",
    text: (n, y) => `Rivals' customers hear about ${y.you} and go elsewhere${n.rival ? `, most often to ${n.rival}` : ""}; publish why someone leaving a rival should pick ${y.it}, where the AI looks.`,
  },
  own_defense: { family: "Publish your case", text: (n, y) => `When ${y.your} own customers look around, the AI shows them ${n.rival} and gives them nothing to stay for; publish what they would give up by leaving.` },

  "away_condition:fixed": { family: "Choose where to compete", text: (n) => `Don't argue with ${q(n.condition ?? "")}; aim at the buyers it does not describe.` },
  "away_condition:argument": {
    family: "Publish your case",
    text: (n, y) => (y === SECOND ? `Publish your case for buyers who say ${q(n.condition ?? "")}, or decide to leave them to ${n.rival ?? "others"}.` : `Publish ${y.your} case for buyers who say ${q(n.condition ?? "")}, or decide to leave them to ${n.rival ?? "others"}.`),
  },
  assigned_exception: { family: "Choose where to compete", text: (n, y) => `Build on the exception: aim at the buyers for whom the AI still picks ${y.you} over ${n.rival ?? `${y.its} rivals`}.` },

  leak_picks: {
    family: "Choose where to compete",
    text: (n, y) => `Decide whether to cover what buyers who pick outside the category want${n.buyer ? `, starting with ${y === SECOND ? q(n.buyer) : y.b(n.buyer)}` : ""}, or leave those picks to others.`,
  },
  leak_problem: {
    family: "Publish your case",
    text: (n, y) => `When ${n.buyer ? `${y.b(n.buyer)} describes` : "buyers describe"} the problem without naming the category, show how the category solves it, so the AI points them there.`,
  },
};

/** The move for one finding, or null when its key has no entry. `third` = the subject's name: the Brief's
 * third-person rendering of the same move (bf26); absent = the served second person. */
export function findingMove(key: string, names: MoveNames | undefined, third?: string): FindingMove | null {
  const n = names ?? {};
  const e = (n.variant ? FINDING_MOVES[`${key}:${n.variant}`] : undefined) ?? FINDING_MOVES[key];
  if (!e) return null;
  return { family: e.family, text: e.text(n, third ? thirdOf(third) : SECOND).replace(/\s+/g, " ").trim() };
}
