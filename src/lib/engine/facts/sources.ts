/**
 * Sources (fact layer, layer 1, 2026-11-18): the sites a search assistant's answer cites. Each answer's citations
 * (responses.citations, a list of URLs) come down to one entry per distinct SITE - three pages of one site count
 * once - and each site carries the brands in analysis whose own site it is (none, one or several).
 *
 *  - The site is the registrable domain, lower case: the last two labels of the host name, or the last three when
 *    the last two are a known two-part public suffix (co.uk, com.au ...). "www." and every other subdomain go:
 *    support.atlassian.com -> atlassian.com, uk.pcmag.com -> pcmag.com, finance.yahoo.com -> yahoo.com. A URL that
 *    does not parse to a host name with a dot is skipped.
 *  - Whose own site it is (2026-11-19, siteOwnerResolver), in this order - each rule, when it exists for the site,
 *    fully replaces what is below it (an empty list included: "nobody's" stops the fall-through):
 *      1. what a person entered for this tracker (projects.site_owners, lib/site_owners.ts);
 *      2. the saved model check (engine/site_owner.ts), its brand names resolved through the current dictionary;
 *      3. the name match, mechanical: the site's main label (the site without its suffix), with everything but
 *         letters and digits taken out, must EQUAL a brand's name in the same compact form - its canonical name,
 *         display name, an alias, or a name declared in parentheses ("Max (HBO)") - at least 4 characters long.
 *         Exact equality only, never a part of a word. When two brands match, the tracker's own brand wins, then
 *         the longer matched form, then the entry id. The name match gives one owner at most.
 *    Owners are always brands in analysis (the tracker included), in board order; any other id is dropped.
 *
 * Pure and browser-safe: no imports.
 */

export interface SourceRef {
  /** The site, e.g. "nerdwallet.com". */
  site: string;
  /** The dictionary entry ids of the brands in analysis whose own site it is, in board order; [] = nobody's. */
  owners: string[];
}

/** Where a site's owners come from (siteOwnerResolver); null = nobody's by every rule. */
export type OwnerFrom = "entered" | "check" | "name";

/** The two rules above the name match, as resolved entry ids per site. */
export interface SiteOwnerInputs {
  /** What a person entered for this tracker: site -> entry ids. */
  entered?: Readonly<Record<string, readonly string[]>>;
  /** The saved model check: site -> entry ids (its brand names already resolved). */
  checked?: Readonly<Record<string, readonly string[]>>;
}

/** The two-part public suffixes a site keeps three labels for (a short explicit list, not the full public list). */
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk", "me.uk", "net.uk", "nhs.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "net.nz", "govt.nz",
  "co.jp", "ne.jp", "or.jp", "ac.jp",
  "com.br", "net.br", "org.br", "gov.br",
  "co.in", "net.in", "org.in", "gov.in",
  "com.mx", "org.mx", "gob.mx",
  "co.za", "org.za",
  "com.sg", "com.hk", "com.tw", "com.cn", "co.kr", "or.kr", "com.tr", "com.ar", "co.il", "com.my", "com.ph", "com.pk", "com.ng", "com.vn", "co.id", "co.th", "com.co", "com.pe",
]);

/** The site of a URL (registrable domain, lower case); null = it does not parse to a host name with a dot. */
export function siteOf(url: string): string | null {
  if (typeof url !== "string") return null;
  const raw = url.trim();
  if (!raw || /\s/.test(raw)) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => !l || !/^[a-z0-9-]+$/.test(l))) return null;
  // A bare IP address is no site.
  if (labels.every((l) => /^\d+$/.test(l))) return null;
  if (!/[a-z]/.test(labels[labels.length - 1])) return null;
  const lastTwo = labels.slice(-2).join(".");
  const keep = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (labels.length < keep) return null;
  return labels.slice(-keep).join(".");
}

/** The site's main label: the site without its suffix ("bbc.co.uk" -> "bbc", "americanexpress.com" ->
 * "americanexpress"). */
export function mainLabel(site: string): string {
  const labels = site.split(".");
  const lastTwo = labels.slice(-2).join(".");
  return labels.slice(0, labels.length - (TWO_PART_SUFFIXES.has(lastTwo) && labels.length >= 3 ? 2 : 1)).join(".");
}

/** A name in the compact form an owner match compares: lower case, letters and digits only. */
export const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The shortest compact form that can own a site. */
export const OWNER_MIN = 4;

/** The names a brand is matched on: each name, and the names declared in parentheses ("Max (HBO)" -> Max, HBO). */
export function ownerForms(names: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    out.add(compact(n));
    const m = n.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (m) for (const x of [m[1], m[2], ...m[2].split("/")]) out.add(compact(x));
  }
  return [...out].filter((x) => x.length >= OWNER_MIN);
}

/**
 * The name match alone (rule 3): site -> the entry id of the brand in analysis whose own site it is, or null.
 * `brands` are the brands in analysis (the tracker included) with the names each is matched on.
 */
export function siteOwnerLookup(brands: readonly { key: string; names: readonly (string | null | undefined)[] }[], targetKey: string): (site: string) => string | null {
  const best = new Map<string, { key: string; target: boolean; len: number }>();
  for (const b of brands) {
    const target = b.key === targetKey;
    for (const form of ownerForms(b.names)) {
      const prev = best.get(form);
      const better =
        !prev ||
        (target && !prev.target) ||
        (target === prev.target && (form.length > prev.len || (form.length === prev.len && b.key < prev.key)));
      if (better) best.set(form, { key: b.key, target, len: form.length });
    }
  }
  const memo = new Map<string, string | null>();
  return (site) => {
    let hit = memo.get(site);
    if (hit === undefined) {
      const label = compact(mainLabel(site));
      hit = label.length >= OWNER_MIN ? (best.get(label)?.key ?? null) : null;
      memo.set(site, hit);
    }
    return hit;
  };
}

/**
 * The full owner rule for one tracker (the order in the header): site -> { owners, from }. `brands` are the brands
 * in analysis in board order (the tracker first), each with the names it is matched on; ids in `inputs` that are not
 * one of them are dropped.
 */
export function siteOwnerResolver(
  brands: readonly { key: string; names: readonly (string | null | undefined)[] }[],
  targetKey: string,
  inputs: SiteOwnerInputs = {}
): (site: string) => { owners: string[]; from: OwnerFrom | null } {
  const order = new Map(brands.map((b, i) => [b.key, i]));
  const keep = (ids: readonly string[]) => [...new Set(ids.filter((id) => order.has(id)))].sort((a, b) => order.get(a)! - order.get(b)!);
  const byName = siteOwnerLookup(brands, targetKey);
  const has = (m: SiteOwnerInputs["entered"], site: string) => !!m && Object.prototype.hasOwnProperty.call(m, site);
  const memo = new Map<string, { owners: string[]; from: OwnerFrom | null }>();
  return (site) => {
    let hit = memo.get(site);
    if (!hit) {
      if (has(inputs.entered, site)) hit = { owners: keep(inputs.entered![site]), from: "entered" };
      else if (has(inputs.checked, site)) hit = { owners: keep(inputs.checked![site]), from: "check" };
      else {
        const one = byName(site);
        hit = one ? { owners: [one], from: "name" } : { owners: [], from: null };
      }
      memo.set(site, hit);
    }
    return hit;
  };
}

/** One answer's sources: one entry per distinct site, in order of first citation. */
export function sourcesOf(citations: readonly string[] | null | undefined, ownersOf: (site: string) => readonly string[]): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const u of citations ?? []) {
    const site = siteOf(u);
    if (!site || seen.has(site)) continue;
    seen.add(site);
    out.push({ site, owners: [...ownersOf(site)] });
  }
  return out;
}

/** A dictionary entry as the board reads it (a structural subset of DictionaryEntry - this module imports nothing). */
export interface BoardEntry {
  id: string;
  status: string;
  analyzed?: boolean | null;
  canonical: string;
  display_name?: string | null;
  aliases: readonly string[];
  parent?: string | null;
}

/** A brand in analysis as the site rules read it. */
export interface BoardBrand {
  key: string;
  /** The name shown: the tracker's brand as configured; else the display name, else the canonical name. */
  name: string;
  /** Every name it is matched on. */
  names: string[];
  /** Its parent company on the board, when one is set. */
  parent: string | null;
  /** The tracker's own brand. */
  client: boolean;
}

/**
 * The brands in analysis, the tracker first - the set answer_facts.ts calls "in analysis" (the tracker, and every
 * active entry not switched out of analysis), in dictionary order after the tracker. The name match reads `names`;
 * the model check and the Sites tab show `name`.
 */
export function siteBoard(brand: string, entries: readonly BoardEntry[], targetKey: string): BoardBrand[] {
  const t = entries.find((e) => e.id === targetKey);
  const out: BoardBrand[] = [
    {
      key: targetKey,
      name: brand,
      names: [brand, ...(t ? [t.canonical, t.display_name ?? null, ...t.aliases] : [])].filter((x): x is string => !!x),
      parent: t?.parent ?? null,
      client: true,
    },
  ];
  for (const e of entries) {
    if (e.id === targetKey || e.status !== "active" || e.analyzed === false) continue;
    out.push({
      key: e.id,
      name: e.display_name ?? e.canonical,
      names: [e.canonical, e.display_name ?? null, ...e.aliases].filter((x): x is string => !!x),
      parent: e.parent ?? null,
      client: false,
    });
  }
  return out;
}
