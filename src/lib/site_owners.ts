import { siteOf } from "./engine/facts/sources";

/**
 * projects.site_owners (2026-11-19): the sites a person entered, in the Brand dictionary's Sites tab, as brands' own -
 * the first of the three owner rules (engine/facts/sources.ts: entered, then the saved model check, then the name
 * match). One record per site, the whole list of its owners: an empty list is a deliberate "nobody's" and stops the
 * fall-through for that site.
 *
 *   { [site]: { owners: string[] (dictionary entry ids), at: ISO time of the last change } }
 *
 * Pure. Bad JSON, a record that is not an object, or a site that is not one (siteOf(site) !== site) read as absent;
 * ids no longer in the dictionary (or no longer in analysis) are dropped at read time by the resolver, not here.
 */

export interface SiteOwnerRecord {
  owners: string[];
  at: string;
}
export type SiteOwnersMap = Record<string, SiteOwnerRecord>;

/** The stored map, validated: anything unreadable is left out. */
export function parseSiteOwners(json: string | null | undefined): SiteOwnersMap {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SiteOwnersMap = {};
  for (const [site, rec] of Object.entries(raw as Record<string, unknown>)) {
    if (siteOf(site) !== site || !rec || typeof rec !== "object") continue;
    const r = rec as { owners?: unknown; at?: unknown };
    if (!Array.isArray(r.owners)) continue;
    const owners = [...new Set(r.owners.filter((x): x is string => typeof x === "string" && x.length > 0))];
    out[site] = { owners, at: typeof r.at === "string" ? r.at : "" };
  }
  return out;
}

/** The map as the resolver reads it: site -> entry ids. */
export function enteredOwners(map: SiteOwnersMap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [site, r] of Object.entries(map)) out[site] = r.owners;
  return out;
}

/** The map with one site's record replaced (sites kept in sorted order, so equal maps store as equal JSON). */
export function withSiteOwners(map: SiteOwnersMap, site: string, owners: readonly string[], at: string): SiteOwnersMap {
  const next: SiteOwnersMap = { ...map, [site]: { owners: [...new Set(owners)], at } };
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The owners after adding a brand (the current effective owners plus it, order kept, no repeat). */
export function addOwner(current: readonly string[], id: string): string[] {
  return current.includes(id) ? [...current] : [...current, id];
}

/** The owners after removing a brand (possibly none - "nobody's"). */
export function removeOwner(current: readonly string[], id: string): string[] {
  return current.filter((x) => x !== id);
}

/** A pasted URL or bare domain as a site, or a plain message saying why not. */
export function siteFromInput(input: string): { site: string } | { error: string } {
  const raw = (input ?? "").trim();
  if (!raw) return { error: "Type a web address, such as a home page link or a domain name." };
  const site = siteOf(raw);
  if (!site) return { error: "That does not read as a web address. Paste a link or type a domain name." };
  return { site };
}
