/**
 * Ruling 5 (am31, PANEL_BUILD_SPEC section 6, E6): the obvious-code filter
 * for a panel's code lists - "What the answer weighs", the topics table, the
 * criteria checklist and the business case's argument table. A code is left
 * out of a cell's list when BOTH hold:
 *   - it is argued in at least OBVIOUS (90%) of the cell's answers, and
 *   - the cell's own question wordings carry its NAME as a phrase.
 * Name only (owner's ruling 2026-11-15): matching any word of the code's
 * scope sentence removed 59 of 61 rows on everyday words ("spending", "cost",
 * "time"). The scope and category arguments are kept for callers and unused.
 * Never applied to the condition lists. Every omission is returned so the
 * harness can print the owner's calibration list (RULING 5 OMISSIONS).
 */

export const OBVIOUS = 0.9;

export type OmissionList = "weighs" | "topics" | "checklist" | "case";

export interface Omission {
  cellId: string;
  list: OmissionList;
  code: string;
  share: number;
  hit: string;
  via: "name" | "scope";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Scope sentences by normalised code name (resolveCodebook's matching). */
export function scopeSentences(proposalJson: string | null | undefined): Map<string, string> {
  const why = new Map<string, string>();
  if (!proposalJson) return why;
  try {
    const prop = JSON.parse(proposalJson) as { codes?: { code?: string; name?: string; why?: string }[] };
    for (const c of prop.codes ?? []) {
      const k = norm(c.code ?? c.name ?? "");
      if (k && c.why?.trim() && !why.has(k)) why.set(k, c.why.trim());
    }
  } catch {
    // An unreadable proposal filters by name only.
  }
  return why;
}

/** The cell's question wordings as one comparable text and its 5-letter stems. */
export function wordingIndex(wordings: string[]): { text: string; stems: Map<string, string> } {
  const text = ` ${wordings.map(norm).join(" ")} `;
  const stems = new Map<string, string>();
  for (const w of text.split(" ")) if (w.length >= 4 && !stems.has(w.slice(0, 5))) stems.set(w.slice(0, 5), w);
  return { text, stems };
}

/**
 * Filters one list. `rows` carry the code and its share of ALL the cell's
 * answers (0-1). Rows keep their order; omitted ones land in `out`.
 */
export function filterObvious<T extends { code: string; share: number }>(
  rows: T[],
  cellId: string,
  list: OmissionList,
  wording: { text: string; stems: Map<string, string> },
  _scopes: Map<string, string>,
  _category: string,
  out?: Omission[]
): T[] {
  return rows.filter((r) => {
    if (r.share < OBVIOUS) return true;
    const name = norm(r.code);
    if (name && wording.text.includes(` ${name} `)) {
      out?.push({ cellId, list, code: r.code, share: r.share, hit: name, via: "name" });
      return false;
    }
    return true;
  });
}
