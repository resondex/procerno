/**
 * Procerno's spinner: the logo's three bars, angled on a fine glass edge,
 * rising in turn and settling while the view drifts slowly (C1d-b, chosen
 * 2026-10-02). Two sizes, one design:
 * - <Spinner /> for full waits (a step loading, a page preparing);
 * - <InlineSpinner /> beside a line of text or inside a button - it sizes
 *   to the surrounding font, so it fits 11px captions and 14px buttons alike.
 * Styles live in globals.css (.pspin); the geometry is in em, so one rule
 * set scales to both sizes.
 */

export function Spinner({ className = "" }: { className?: string }) {
  return <Bars className={`pspin-lg ${className}`} />;
}

/** `tone="on-primary"` for spinners inside a filled primary button. */
export function InlineSpinner({ tone = "primary", className = "" }: { tone?: "primary" | "on-primary"; className?: string }) {
  return <Bars className={`pspin-inline ${tone === "on-primary" ? "pspin-on-primary" : ""} ${className}`} />;
}

function Bars({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className={`pspin ${className}`}>
      <span className="pspin-bars">
        <span className="pspin-plane" />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
