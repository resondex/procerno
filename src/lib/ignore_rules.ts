/**
 * Which engine "ignore" verdicts may fold silently behind the auto-ignore
 * receipt, and which must surface as review-flagged pills. One predicate,
 * shared by the brands board, the Analysis view, and the examples pre-warm,
 * so the four surfaces can never disagree.
 *
 * The silent receipt is reserved for verdicts whose precision earns it -
 * the model's direct "not a brand / out of category" calls. Two ignore
 * classes are structurally weaker and always surface (2026-09-25, after
 * Pluto TV and The Roku Channel vanished behind the Netflix receipt):
 *
 * - OWN-CONTEXT guard flips: the co-occurrence guard can only demote a
 *   merge to ignore, never promote to approve - but "own-context brand"
 *   measured in this category is often a real competitor. Never folded,
 *   whatever the share.
 * - INHERITED ignores ("follows <root>"): one hop of string arithmetic,
 *   not a judgment - a real brand can inherit its own short form's ignore
 *   ("Pluto TV" following "Pluto"). Folded only below a small share floor,
 *   where they are almost always true variants.
 * - Everything else keeps the volume escalation: >=10% of answers is where
 *   a wrong ignore is costly, so those flag instead of folding.
 */
export function ignoreSurfaces(
  rationale: string | null | undefined,
  share: number
): "fold" | "flag" {
  const rat = rationale ?? "";
  if (/^own-context brand/.test(rat)) return "flag";
  if (/^follows "/.test(rat) && share >= 0.03) return "flag";
  if (share >= 0.1) return "flag";
  return "fold";
}

/** The user-facing first sentence of a flagged ignore's tooltip - names the
 * reason THIS pill needs a look, per class. */
export function flaggedIgnorePrefix(
  rationale: string | null | undefined,
  share: number
): string {
  const rat = rationale ?? "";
  const pct = Math.round(share * 100);
  if (/^own-context brand/.test(rat)) {
    return (
      "The measurements say this lives in its own context - that is often " +
      "a real competitor, not scenery. Drag it out to track it, or confirm " +
      "Ignore."
    );
  }
  if (/^follows "/.test(rat)) {
    return (
      `Ignored only by following its family root, but named in ${pct}% of ` +
      "answers itself. Confirm, or drag it out to track it."
    );
  }
  return (
    `Ignored by rule, but named in ${pct}% of answers - confirm this is ` +
    "scenery, or drag it out to track it."
  );
}
