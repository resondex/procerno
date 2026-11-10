import type { JourneyStation, StationKey, StationReasonSide, StationReasons } from "@/lib/engine/journey";

/**
 * The Stations reasons and arguments copy (j5, 2026-11-10): each station's
 * two verdict sides, its one-line base note, and the Summary mode's
 * template sentences - composed from the block's own top rows, client-side,
 * no model. Lay language: no counts, no method words, " - " never an em dash.
 * Pure (no React), so the fixture check can run it on real payloads.
 */

/** Per station: the two sides of its verdict (never a combined verdict), the
 * one-line base note, and the summary sentence's verbs. Awareness carries no
 * reasons (its answers are coded for topics). */
export const REASON_COPY: Record<
  Exclude<StationKey, "awareness">,
  { win: string; lose: string; note: string; winVerb: string; loseVerb: string }
> = {
  consideration: {
    win: "Reasons to pick you",
    lose: "Reasons the pick goes elsewhere",
    note: "Each share is of this station's answers where the pick went that way.",
    winVerb: "win the pick for you",
    loseVerb: "sends the pick elsewhere",
  },
  comparison: {
    win: "Reasons you win the head-to-head",
    lose: "Reasons the rival wins",
    note: "Each share is of this station's answers where the head-to-head went that way.",
    winVerb: "win the head-to-head for you",
    loseVerb: "hands it to the rival",
  },
  doubts: {
    win: "Reasons to go ahead",
    lose: "Reasons to steer away",
    note: "Each share is of this station's answers where the advice went that way.",
    winVerb: "get the buyer told to go ahead",
    loseVerb: "steers the buyer away",
  },
  value: {
    win: "Reasons you are worth it",
    lose: "Reasons you are not worth it",
    note: "Each share is of this station's answers where the verdict went that way.",
    winVerb: "make you worth the price",
    loseVerb: "makes the cheaper option the better buy",
  },
  customer_base: {
    win: "Reasons to stay",
    lose: "Reasons to leave",
    note: "Each share is of this station's answers where the advice went that way.",
    winVerb: "keep your customers with you",
    loseVerb: "sends them elsewhere",
  },
};

/** A side's rows in rank order: the themes when any carries situation
 * buckets (what ReasonList renders), otherwise the flat list. */
const sideLabels = (side: StationReasonSide): string[] =>
  side.themes.some((t) => t.buckets.length > 0) ? side.themes.map((t) => t.label) : side.flat.map((r) => r.label);

export const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The reasons block folded to one sentence, from its own top rows. */
export function reasonsSentence(key: StationKey, r: StationReasons): string {
  if (key === "awareness") return "Awareness answers state no reasons for a pick.";
  const copy = REASON_COPY[key];
  const win = sideLabels(r.win).slice(0, 2);
  const lose = sideLabels(r.lose)[0];
  const q = (s: string) => `"${s}"`;
  const winPart = win.length === 0 ? null : `Reasons like ${win.map(q).join(" and ")} ${copy.winVerb}`;
  const losePart = lose ? `${q(lose)} most often ${copy.loseVerb}` : null;
  if (winPart && losePart) return `${winPart}; ${losePart}.`;
  if (winPart) return `${winPart}; no reason on the other side is stated often enough to name.`;
  if (losePart) return `${capFirst(losePart)}; no reason on your side is stated often enough to name.`;
  return "No reasons are stated at this station.";
}

/** The arguments block folded to one sentence: the top for-you and the top
 * against argument. */
export function argumentsSentence(s: Pick<JourneyStation, "arguments" | "argumentLabels" | "argumentsNote">): string {
  const [yes, no] = s.argumentLabels;
  const f = s.arguments.find((a) => a.forYou);
  const g = s.arguments.find((a) => !a.forYou);
  if (!f && !g) return s.argumentsNote ?? "Too few answers on either side to compare the arguments.";
  const parts = [...(f ? [`"${f.code}" comes up more ${yes}`] : []), ...(g ? [`"${g.code}" comes up more ${no}`] : [])];
  return `${capFirst(parts.join("; "))}.`;
}

