/**
 * The dashboard's one type scale (2026-11-10, the type harmonization pass).
 * Read off the rest of the tracker page so the analysis pages sit beside it:
 * the tracker title is text-2xl semibold, modal headings text-lg semibold,
 * body text-sm, secondary 13px, captions 12px, labels the `section-label`
 * class (globals.css), stat numbers 2rem semibold. One size and weight per
 * role - pick the role, never a pixel size.
 */
export const T = {
  /** The Overview's casting heading - the page's one hero line. */
  hero: "text-2xl font-semibold leading-tight tracking-tight text-ink",
  /** A page or panel heading: "The Map", "Data", the panel's claim. */
  h2: "text-lg font-semibold leading-snug tracking-tight text-ink",
  /** A card, finding, band or section title. */
  title: "text-[15px] font-semibold leading-snug text-ink",
  /** A lead paragraph under a heading (the casting, a move). */
  lede: "text-[15px] leading-relaxed text-ink",
  /** Body text and table cells. */
  body: "text-sm leading-relaxed",
  /** Secondary: page subs, hints, teasers, notes under a number. */
  sec: "text-[13px] leading-snug text-ink-3",
  /** Captions: an answer's source line, a cell's note, a chart row. */
  cap: "text-[12px] leading-snug",
  /** Uppercase labels (eyebrows, "What to do", "The evidence"). */
  label: "text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3",
  /** The same label in the accent color ("What to do"). */
  labelAccent: "text-[11px] font-semibold uppercase tracking-[0.08em] text-primary",
  /** Headline numbers. */
  num: "text-[2rem] font-semibold leading-none tracking-tight tabular-nums",
  /** Numbers on a card. */
  numSm: "text-2xl font-semibold leading-none tabular-nums",
  /** Buttons, chips and controls. */
  ctl: "text-[13px] font-medium",
} as const;
