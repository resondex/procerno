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
  /** One plain sentence: what opening the table shows. */
  desc: string;
  /** Everyday words a reader might type for it (search only). */
  keywords?: string[];
}

/** The builder's entry: highlighted once any control is changed by hand. */
export const OWN_ID = "own";
/** The entry the page opens on. */
export const DEFAULT_ID = "picks_brand";
export const CONTESTS_ID = "contests";
export const DETAIL_ID = "detail";

const piv = (
  id: string,
  group: string,
  label: string,
  pool: ViewKey,
  measures: string[],
  row: DimKey,
  col: DimKey,
  desc: string,
  keywords: string[] = []
): LibEntry => ({
  id,
  group,
  label,
  kind: "pivot",
  pool,
  measures,
  row,
  col,
  desc,
  keywords,
});

export const LIBRARY: LibEntry[] = [
  piv(DEFAULT_ID, "Brands", "Share of picks by brand", "headline", ["share_of_decided"], "brand", "none",
    "When the AI commits to one product, how often each brand is the one it picks.",
    ["winner", "market share", "leaderboard", "ranking", "competitors", "who wins"]),
  piv("funnel_brand", "Brands", "Named, recommended, picked by brand", "headline", ["mentioned", "recommended", "share_of_decided"], "brand", "none",
    "How often each brand is named, recommended and picked when buyers ask which to get.",
    ["funnel", "visibility", "mentions", "shortlist", "consideration", "competitors"]),
  piv("picks_company", "Brands", "Share of picks by company", "headline", ["share_of_decided"], "parent", "none",
    "Picks added up by the company that owns each brand.",
    ["parent", "owner", "portfolio", "group"]),

  piv("picks_room", "Buyers", "Share of picks by buying situation", "headline", ["share_of_decided"], "room", "none",
    "Your share of the picks in each buying situation.",
    ["segment", "persona", "audience", "customer type", "situation", "scenario", "who buys"]),
  piv("picks_room_brand", "Buyers", "Picks by buying situation and brand", "headline", ["share_of_decided"], "room", "brand",
    "Who gets picked in each buying situation, brand by brand.",
    ["segment", "persona", "audience", "situation", "scenario", "competitors"]),
  piv("worth_room", "Buyers", "Worth it, by buying situation", "value", ["worth_yes", "worth_depends", "worth_no"], "room", "none",
    "Whether the AI calls your line worth its price over a cheaper option, for each buying situation.",
    ["price", "pricing", "value", "cost", "expensive", "cheap", "fee", "money", "segment"]),

  piv("h2h_rival", "Rivals", "Head-to-head by rival", "head_to_head_entity", ["h2h_you", "h2h_rival", "h2h_other"], "rival", "none",
    "When a buyer asks you against one named rival, who the AI picks.",
    ["versus", "vs", "compare", "comparison", "competitor", "competition", "matchup", "battle"]),
  piv("leavers_rival", "Rivals", "Rivals' customers switching", "offensive_capture", ["mentioned", "chosen"], "rival", "none",
    "When a rival's customer asks where to move, whether the AI names you and picks you.",
    ["switch", "switching", "leaving", "leavers", "defect", "win over", "steal", "churn"]),

  piv("by_engine", "Assistants", "By assistant", "headline", ["mentioned", "recommended", "chosen"], "engine", "none",
    "How often you are named, recommended and picked on each AI assistant.",
    ["ai", "model", "llm", "chatbot", "engine", "platform"]),
  piv("by_vendor", "Assistants", "By AI company", "headline", ["mentioned", "recommended", "chosen"], "vendor", "none",
    "The same numbers, each AI company's assistants added together.",
    ["ai", "vendor", "provider", "company", "model maker"]),
  piv("by_tier", "Assistants", "Free or paid", "headline", ["mentioned", "recommended", "chosen"], "tier", "none",
    "The same numbers on free assistants and on paid ones.",
    ["free", "paid", "subscription", "plan", "premium tier"]),
  piv("by_mode", "Assistants", "Search on or off", "headline", ["mentioned", "recommended", "chosen"], "mode", "none",
    "The same numbers when the assistant searches the web and when it answers from memory.",
    ["search", "web", "internet", "online", "instinct", "memory", "browsing"]),

  piv("args", "Arguments", "How often each argument is made", "headline", ["argues"], "argument", "none",
    "The arguments the AI makes when buyers ask which to get, most made first.",
    ["reasons", "why", "drivers", "attributes", "features", "benefits", "themes", "topics"]),
  piv("args_room", "Arguments", "Arguments by buying situation", "headline", ["argues"], "argument", "room",
    "Which arguments come up in each buying situation.",
    ["reasons", "why", "drivers", "attributes", "segment", "situation"]),

  piv("worries_buyers", "Worries", "Buyers' worries", "doubt", ["proceed", "avoid", "proceed_undecided", "premise_confirms"], "worry", "none",
    "When a buyer voices a worry about you, whether the AI says go ahead, avoid you, or agrees with the worry.",
    ["doubt", "doubts", "objection", "concern", "fear", "hesitation", "risk", "complaint"]),
  piv("worries_customers", "Worries", "Customers' worries", "keep_or_leave", ["keep", "leave", "keep_undecided"], "worry", "none",
    "When a customer has a worry, whether the AI tells them to stay or leave.",
    ["loyalty", "retention", "churn", "cancel", "renew", "renewal", "stay", "leave", "complaint"]),

  { id: CONTESTS_ID, group: "Everything", label: "Every contest", kind: "contests",
    desc: "Every contest on the Map in one table, question type by question type.",
    keywords: ["map", "overview", "summary", "all", "standing", "contests"] },
  { id: DETAIL_ID, group: "Everything", label: "Question type detail", kind: "detail",
    desc: "The buying journey stage by stage - awareness, consideration, comparison, doubts, value, customers - with every table behind each.",
    keywords: ["journey", "stations", "stages", "funnel", "awareness", "consideration", "comparison", "doubts", "value", "customers"] },
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
  where: null,
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
