import type { WorkbenchView } from "@/lib/engine/workbench_rows";
import type { DataPoolKey } from "@/lib/engine/facts/measure_book";
import { resolveSettings, type DimKey, type PivotSettings } from "./pivot_compute";

/**
 * The Data page's table library (2026-11-11, ratified from the clickable
 * prototype): ready-made tables, each named for the question it answers,
 * grouped, plus two non-pivot reads (Every contest, Question type detail)
 * and the builder's own entry ("own").
 *
 * A pivot entry is shown only when its pool is in the run AND every one of
 * its measures and dimensions resolves as asked (the measure book's legality) - a
 * table that would silently fall back to another measure or to "None" is
 * hidden instead. A group with no entries is hidden.
 */

export type LibKind = "pivot" | "contests" | "detail";

export interface LibEntry {
  id: string;
  group: string;
  label: string;
  kind: LibKind;
  pool?: DataPoolKey;
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
  pool: DataPoolKey,
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
  piv(DEFAULT_ID, "Brands", "Share of picks by brand", "what_to_buy", ["share_of_picks"], "brand", "none",
    "When the AI picks one brand, how often each brand is the one it picks.",
    ["winner", "market share", "leaderboard", "ranking", "competitors", "who wins"]),
  piv("funnel_brand", "Brands", "Named, recommended, picked by brand", "what_to_buy", ["named", "recommended", "share_of_picks"], "brand", "none",
    "How often each brand is named, recommended and picked when buyers ask which to get.",
    ["funnel", "visibility", "mentions", "shortlist", "consideration", "competitors"]),
  piv("picks_company", "Brands", "Share of picks by company", "what_to_buy", ["share_of_picks"], "parent", "none",
    "Picks added up by the company that owns each brand.",
    ["parent", "owner", "portfolio", "group"]),
  piv("popular_brand", "Brands", "What's popular, by brand", "popular", ["named", "recommended", "share_of_picks"], "brand", "none",
    "When buyers ask what is popular, how often each brand is named, recommended and picked.",
    ["popular", "popularity", "best known", "most used", "everyone uses", "social proof", "reputation"]),
  piv("popular_engine", "Assistants", "What's popular, by assistant", "popular", ["named", "recommended", "picked"], "engine", "none",
    "How often you are named, recommended and picked on each AI assistant when buyers ask what is popular.",
    ["popular", "popularity", "best known", "ai", "assistant"]),

  piv("picks_room", "Buyers", "Share of picks by buying situation", "what_to_buy", ["share_of_picks"], "room", "none",
    "Your share of the picks in each buying situation.",
    ["segment", "persona", "audience", "customer type", "situation", "scenario", "who buys"]),
  piv("picks_room_brand", "Buyers", "Picks by buying situation and brand", "what_to_buy", ["share_of_picks"], "room", "brand",
    "Who gets picked in each buying situation, brand by brand.",
    ["segment", "persona", "audience", "situation", "scenario", "competitors"]),
  piv("routed_room", "Buyers", "Problem questions answered outside the category, by buying situation", "problem", ["routed_adjacent"], "room", "none",
    "When a buyer describes a problem without naming the category, how often the AI answers with a solution outside it - for each buying situation.",
    ["problem", "awareness", "outside", "elsewhere", "category", "segment", "situation"]),
  piv("worth_room", "Buyers", "Worth it, by buying situation", "value", ["worth_yes", "worth_depends", "worth_no"], "room", "none",
    "Whether the AI calls your line worth its price over a cheaper option, for each buying situation.",
    ["price", "pricing", "value", "cost", "expensive", "cheap", "fee", "money", "segment"]),
  piv("instead_room", "Buyers", "Where the AI points instead, by buying situation", "value", ["instead_rival", "instead_own", "instead_nowhere"], "room", "none",
    "On a price question, whether the AI points to a rival, only to your own cheaper option, or nowhere - for each buying situation.",
    ["price", "cheaper", "instead", "alternative", "trade down", "own option", "segment"]),

  piv("h2h_rival", "Rivals", "Head-to-head by rival", "h2h", ["h2h_you", "h2h_rival", "h2h_another"], "rival", "none",
    "When a buyer asks you against one named rival, who the AI picks.",
    ["versus", "vs", "compare", "comparison", "competitor", "competition", "matchup", "battle"]),
  piv("leavers_rival", "Rivals", "Rivals' customers switching", "switching", ["named", "picked"], "rival", "none",
    "When a rival's customer asks where to move, whether the AI names you and picks you.",
    ["switch", "switching", "leaving", "leavers", "defect", "win over", "steal", "churn"]),

  piv("by_engine", "Assistants", "By assistant", "what_to_buy", ["named", "recommended", "picked"], "engine", "none",
    "How often you are named, recommended and picked on each AI assistant.",
    ["ai", "model", "llm", "chatbot", "engine", "platform"]),
  piv("by_vendor", "Assistants", "By AI company", "what_to_buy", ["named", "recommended", "picked"], "vendor", "none",
    "The same numbers, each AI company's assistants added together.",
    ["ai", "vendor", "provider", "company", "model maker"]),
  piv("by_tier", "Assistants", "Free or paid", "what_to_buy", ["named", "recommended", "picked"], "tier", "none",
    "The same numbers on free assistants and on paid ones.",
    ["free", "paid", "subscription", "plan", "premium tier"]),
  piv("by_mode", "Assistants", "Search on or off", "what_to_buy", ["named", "recommended", "picked"], "mode", "none",
    "The same numbers when the assistant searches the web and when it answers from memory.",
    ["search", "web", "internet", "online", "instinct", "memory", "browsing"]),

  piv("args", "Arguments", "How often each argument is made", "what_to_buy", ["argues"], "argument", "none",
    "The arguments the AI makes when buyers ask which to get, most made first.",
    ["reasons", "why", "drivers", "attributes", "features", "benefits", "themes", "topics"]),
  piv("args_room", "Arguments", "Arguments by buying situation", "what_to_buy", ["argues"], "argument", "room",
    "Which arguments come up in each buying situation.",
    ["reasons", "why", "drivers", "attributes", "segment", "situation"]),

  piv("sources_top", "Sources", "Sources the AI cites most", "what_to_buy", ["cites"], "source", "none",
    "The sites the AI cites when buyers ask which to get, most cited first - out of the answers that cite at least one source.",
    ["source", "sources", "citation", "citations", "cited", "website", "site", "link", "links", "reference", "publisher", "media"]),
  piv("sources_vendor", "Sources", "Sources by AI company", "what_to_buy", ["cites"], "source", "vendor",
    "The sites each AI company's assistants cite when buyers ask which to get.",
    ["source", "sources", "citation", "cited", "website", "ai company", "vendor"]),
  piv("sources_picked", "Sources", "Sources when you are picked, and when a rival is", "what_to_buy", ["cites_when_picked", "cites_when_other_picked"], "source", "none",
    "The sites the AI cites in the answers that pick you, beside the answers that pick another brand.",
    ["source", "sources", "citation", "cited", "website", "win", "lose", "picked"]),
  piv("sources_own_site", "Sources", "Whose own sites the AI cites", "what_to_buy", ["cites_site_of"], "brand", "none",
    "How often the AI cites each brand's own website when buyers ask which to get.",
    ["own site", "website", "brand site", "homepage", "official site", "source", "citation"]),
  piv("sources_engine", "Sources", "How often each assistant cites a source", "what_to_buy", ["cites_any"], "engine", "none",
    "Of the answers from assistants that search the web, how often each cites at least one source.",
    ["source", "citation", "cites", "search", "web", "links", "assistant"]),

  piv("worries_buyers", "Worries", "Buyers' worries", "buyers_worries", ["go_ahead", "steer_clear", "buyer_no_side", "agrees"], "worry", "none",
    "When a buyer voices a worry about you, whether the AI says go ahead, steer clear, or agrees with the worry.",
    ["doubt", "doubts", "objection", "concern", "fear", "hesitation", "risk", "complaint"]),
  piv("worries_customers", "Worries", "Customers' worries", "customers_worries", ["stay", "leave", "customer_no_side"], "worry", "none",
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
  src: null,
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
