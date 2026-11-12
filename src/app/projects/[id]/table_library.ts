import type { WorkbenchView } from "@/lib/engine/workbench";
import type { ViewKey } from "@/lib/engine/views";
import { resolveSettings, type DimKey, type PivotSettings } from "./pivot_compute";

/**
 * The Data page's table library (2026-11-11, ratified from the clickable
 * prototype): ready-made tables, each named for the question it answers,
 * grouped, plus two non-pivot reads (Every contest, Question type detail)
 * and the builder's own entry ("own").
 *
 * A pivot entry is shown only when its pool is in the run AND every one of
 * its measures and dimensions resolves as asked (measures.ts legality) - a
 * table that would silently fall back to another measure or to "None" is
 * hidden instead. A group with no entries is hidden.
 */

export type LibKind = "pivot" | "contests" | "detail";

export interface LibEntry {
  id: string;
  group: string;
  label: string;
  kind: LibKind;
  pool?: ViewKey;
  measures?: string[];
  row?: DimKey;
  col?: DimKey;
}

/** The builder's entry: highlighted once any control is changed by hand. */
export const OWN_ID = "own";
/** The entry the page opens on. */
export const DEFAULT_ID = "picks_brand";
export const CONTESTS_ID = "contests";
export const DETAIL_ID = "detail";

const piv = (id: string, group: string, label: string, pool: ViewKey, measures: string[], row: DimKey, col: DimKey = "none"): LibEntry => ({
  id,
  group,
  label,
  kind: "pivot",
  pool,
  measures,
  row,
  col,
});

export const LIBRARY: LibEntry[] = [
  piv(DEFAULT_ID, "Brands", "Share of picks by brand", "headline", ["share_of_decided"], "brand"),
  piv("funnel_brand", "Brands", "Named, recommended, picked by brand", "headline", ["mentioned", "recommended", "share_of_decided"], "brand"),
  piv("picks_company", "Brands", "Share of picks by company", "headline", ["share_of_decided"], "parent"),

  piv("picks_room", "Buyers", "Share of picks by buying situation", "headline", ["share_of_decided"], "room"),
  piv("picks_room_brand", "Buyers", "Picks by buying situation and brand", "headline", ["share_of_decided"], "room", "brand"),
  piv("worth_room", "Buyers", "Worth it, by buying situation", "value", ["worth_yes", "worth_depends", "worth_no"], "room"),

  piv("h2h_rival", "Rivals", "Head-to-head by rival", "head_to_head_entity", ["h2h_you", "h2h_rival", "h2h_other"], "rival"),
  piv("leavers_rival", "Rivals", "Rivals' customers switching", "offensive_capture", ["mentioned", "chosen"], "rival"),

  piv("by_engine", "Assistants", "By assistant", "headline", ["mentioned", "recommended", "chosen"], "engine"),
  piv("by_vendor", "Assistants", "By AI company", "headline", ["mentioned", "recommended", "chosen"], "vendor"),
  piv("by_tier", "Assistants", "Free or paid", "headline", ["mentioned", "recommended", "chosen"], "tier"),
  piv("by_mode", "Assistants", "Search on or off", "headline", ["mentioned", "recommended", "chosen"], "mode"),

  piv("args", "Arguments", "How often each argument is made", "headline", ["argues"], "argument"),
  piv("args_room", "Arguments", "Arguments by buying situation", "headline", ["argues"], "argument", "room"),

  piv("worries_buyers", "Worries", "Buyers' worries", "doubt", ["proceed", "avoid", "proceed_undecided", "premise_confirms"], "worry"),
  piv("worries_customers", "Worries", "Customers' worries", "keep_or_leave", ["keep", "leave", "keep_undecided"], "worry"),

  { id: CONTESTS_ID, group: "Everything", label: "Every contest", kind: "contests" },
  { id: DETAIL_ID, group: "Everything", label: "Question type detail", kind: "detail" },
];

export const LIB_BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));

/** A pivot entry's settings (brand reset to the tracker's own). */
export const entrySettings = (e: LibEntry): PivotSettings => ({
  pool: e.pool ?? null,
  measures: e.measures ?? [],
  row: e.row ?? "none",
  col: e.col ?? "none",
  brand: null,
  arg: null,
});

/** Does this payload carry the entry exactly as defined? */
export function entryAvailable(e: LibEntry, data: WorkbenchView | null): boolean {
  if (e.kind !== "pivot") return true;
  if (!data?.facts) return false;
  const s = entrySettings(e);
  const r = resolveSettings(s, data);
  return (
    !!r &&
    r.pool === s.pool &&
    r.rowDim === s.row &&
    r.colDim === s.col &&
    r.measures.length === s.measures.length &&
    r.measures.every((m, i) => m.id === s.measures[i])
  );
}
