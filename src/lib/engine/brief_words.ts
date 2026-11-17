/**
 * bf26 (2026-11-16, Tyler: "Fix all seven" - the Brief): the Brief's shared
 * wording helpers. The Brief speaks about its subject in the third person and
 * names buying situations as words, not labels; the insight detectors
 * (summary_insights.ts, brief style), the move templates (finding_moves.ts,
 * third person) and the memo itself (brief.ts) all read these, so one rule
 * holds everywhere.
 */

/** Possessive of a brand name in the Brief's house style: always 's ("American Express's"), except a name that
 * already ends in 's ("Lay's"). */
export const possName = (name: string) => (/['’]s$/i.test(name) ? name : `${name}'s`);

/** Last words that make a buyer label read as a person (or a group of people). "teen" / "kids" are left out on
 * purpose: a label ending in them is usually a thing for them ("First phone for teen"). */
const PERSON_WORDS = new Set([
  "host", "parent", "parents", "student", "students", "family", "families", "household", "households", "team", "teams", "couple",
  "professional", "professionals", "pro", "pros", "fan", "fans", "guest", "guests",
  "athlete", "athletes", "creator", "creators", "chef", "cook", "nurse", "doctor", "patient", "patients", "client", "clients", "employee",
  "employees", "manager", "managers", "owner", "owners", "founder", "founders", "startup", "startups", "company", "agency", "shop", "squad",
]);
/** Words ending in -er / -or / -ist / -ian that are not people. */
const NOT_PERSON = new Set([
  "dinner", "order", "paper", "water", "number", "corner", "summer", "winter", "power", "cover", "computer", "letter", "border", "center",
  "matter", "weather", "river", "flower", "finger", "filter", "folder", "chapter", "quarter", "trailer", "charger", "carrier",
  "error", "color", "colour", "floor", "door", "flavor", "flavour", "labor", "labour", "motor", "sector", "factor", "monitor", "mirror",
  "anchor", "harbor", "vapor", "humor", "favor", "favour", "major", "minor", "liquor", "behavior", "behaviour",
]);

/** A buyer label reads as a person when its last word is a person noun. */
export function readsAsPerson(label: string): boolean {
  const words = label.trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  if (!last || NOT_PERSON.has(last)) return false;
  if (PERSON_WORDS.has(last)) return true;
  return /(?:er|ers|or|ors|ist|ists|ian|ians)$/.test(last) && last.length > 3;
}

/** A label's words in lower case, keeping words that carry their own capitals ("iPhone", "AI", "Gen Z" stays). */
function lowerWords(label: string): string {
  return label
    .trim()
    .split(/(\s+)/)
    .map((w) => (/\s/.test(w) || w.length < 2 || /[A-Z]/.test(w.slice(1)) || (w === w.toUpperCase() && /[A-Z]/.test(w)) ? w : w.charAt(0).toLowerCase() + w.slice(1)))
    .join("");
}

/**
 * A buying situation's label as a noun phrase inside a sentence: a label that
 * reads as a person is lower-cased with "the" ("Small business owner" -> "the
 * small business owner"); any other label is kept as written, in quotes,
 * behind "the buyer in" ("Dining and going out" -> "the buyer in \"Dining
 * and going out\""), the form the cards use. `start` capitalises it for the
 * opening of a sentence. A heading that is just the label keeps the label.
 */
export function buyerPhrase(label: string, opts: { start?: boolean } = {}): string {
  const t = label.trim();
  const out = readsAsPerson(t) ? `the ${lowerWords(t)}` : `the buyer in "${t}"`;
  return opts.start ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

/** bf29: a product name inside a sentence, with "the" when the name ends in an everyday noun and does not
 * open with the brand's own name ("the Gold Card", "the Business Plan"); a coined name or one led by the brand
 * reads as written ("Netflix Standard", "Pixel A"). The panels' `article` helper decides a / an only; this is
 * the definite form the Brief's sentences need. */
export function theProduct(name: string, brand: string, common: ReadonlySet<string>): string {
  const t = name.trim();
  const words = t.split(/\s+/);
  const last = (words[words.length - 1] ?? "").toLowerCase();
  if (words.length < 2 || last.length < 3 || !common.has(last)) return t;
  if (t.toLowerCase().startsWith(brand.trim().toLowerCase()) || words[0].toLowerCase() === brand.trim().split(/\s+/)[0].toLowerCase()) return t;
  return `the ${t}`;
}
