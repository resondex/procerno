import { createHash } from "crypto";
import { tagCosts } from "../cost_log";
import { openaiClient } from "./providers";
import { store } from "../store";
import { ROSTER_MODEL } from "./models";
import type { RosterRole } from "./battery_checks";

/**
 * Typed competitor roster (2026-09-30, founder-ratified design). The
 * untyped roster broke on American Express: Visa and Mastercard are real
 * competitors but sell to banks and merchants, not to the tracker's buyer,
 * so they drew unanswerable cells ("Amex or a Mastercard for balance
 * transfers?") and their list positions denied Discover and Citi their
 * head-to-heads.
 *
 * The stored FACT is who each brand sells to (its customer sets - checkable);
 * the per-tracker ROLE is DERIVED by intersecting with the tracker's audience:
 * - the audience can buy it from the brand  -> same_seat (full cell rights)
 * - it sells to the rivals / the trade      -> upstream (no cells; weather)
 * A bare b2c/b2b flag is not the type: Chase is "both" and a clean same-seat
 * rival; jira's whole market is B2B and needs no special casing.
 *
 * The model answers the fact (sellsTo) and the intersection
 * (audienceBuyable); the role is computed from audienceBuyable in code, so
 * role and fact can never disagree. The wizard chip toggle is the human
 * gate on top. Fails open: any error types every competitor same_seat
 * (today's untyped behavior) and caches nothing.
 */

/** Bump when the prompt or schema changes. roster2 (2026-10-01): upstream
 * verdicts carry consumerSalient + classPhrase (class-angle cells).
 * roster3 (2026-10-03, init decision 3): inCategory (-> adjacent), parent
 * company (sister-brand tag), head-to-head rank + reason (the market
 * step's pre-picks), and buyability judged against the category's buyers
 * rather than a platform preference worded into the audience (Pixel's
 * "Android" audience had typed Apple iPhone upstream).
 * roster4 (2026-10-03, Tyler: no category or brand examples in prompt text). */
const ROSTER_VERSION = "roster4";
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000; // ~6 months, like other setup calls

export interface RosterVerdict {
  name: string;
  /** Who the brand sells to - its customer sets ("consumers", "banks"). */
  sellsTo: string[];
  /** Is the tracker's audience among those customers (buying from this
   * brand directly, as an alternative to the client)? */
  audienceBuyable: boolean;
  /** Derived: !audienceBuyable -> upstream; buyable but !inCategory ->
   * adjacent; otherwise same_seat. The market step turns same_seat into
   * same_seat (head-to-head pick) or bench from h2hRank. */
  role: RosterRole;
  /** Is the brand's competing offering in the study's confirmed category?
   * Absent on pre-roster3 verdicts (read as true). */
  inCategory?: boolean;
  /** The brand's parent company ("Atlassian", "PepsiCo"); the brand itself
   * when independent. Sister brands share the client's parent. */
  parent?: string;
  /** Head-to-head recommendation among the same_seat verdicts: 1 = the
   * rival buyers most often weigh against the client. 0 for upstream and
   * adjacent. */
  h2hRank?: number;
  /** One short line on why buyers weigh this rival against the client. */
  h2hReason?: string;
  /** One line on why. */
  note: string;
  /** Upstream only (2026-10-01): do buyers still choose BY this brand as a
   * CLASS of products they buy from others ("a Visa card")? True earns a
   * class-angle head-to-head cell. Always false for same_seat; absent on
   * verdicts cached before roster2 (read as false). */
  consumerSalient?: boolean;
  /** When consumerSalient: the natural buyer phrase for the brand as a
   * product class ("a Visa card", "a Mastercard card"). */
  classPhrase?: string;
}

export interface RosterClassification {
  competitors: RosterVerdict[];
  /** The client brand's own customer sets. Stored only: the b2b half of a
   * "both" client is a future second-seat product signal. */
  clientSellsTo: string[];
  /** The client brand's parent company (sister-brand detection). */
  clientParent?: string;
  /** True when the call failed and every competitor defaulted to same_seat. */
  failedOpen?: boolean;
}

const ROSTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    clientSellsTo: { type: "array", items: { type: "string" } },
    clientParent: { type: "string" },
    competitors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          sellsTo: { type: "array", items: { type: "string" } },
          audienceBuyable: { type: "boolean" },
          note: { type: "string" },
          consumerSalient: { type: "boolean" },
          classPhrase: { type: "string" },
          inCategory: { type: "boolean" },
          parent: { type: "string" },
          h2hRank: { type: "integer" },
          h2hReason: { type: "string" },
        },
        required: [
          "name", "sellsTo", "audienceBuyable", "note", "consumerSalient", "classPhrase",
          "inCategory", "parent", "h2hRank", "h2hReason",
        ],
      },
    },
  },
  required: ["clientSellsTo", "clientParent", "competitors"],
} as const;

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function cacheKey(parts: (string | null)[]): string {
  const normalized = parts.map((p) => (p ?? "").trim().toLowerCase()).join("|");
  return `roster:${createHash("sha256").update(normalized).digest("hex")}`;
}

/** The untyped fallback: every competitor same_seat. */
function failOpen(competitors: string[]): RosterClassification {
  return {
    competitors: competitors.map((name) => ({
      name, sellsTo: [], audienceBuyable: true, role: "same_seat", note: "", consumerSalient: false,
    })),
    clientSellsTo: [],
    failedOpen: true,
  };
}

export async function classifyRoster(input: {
  brand: string;
  category: string;
  audience: string | null;
  competitors: string[];
}): Promise<RosterClassification> {
  tagCosts({ purpose: "setup:roster" });
  const competitors = [...new Set(input.competitors.map((c) => c.trim()).filter(Boolean))];
  if (competitors.length === 0) return { competitors: [], clientSellsTo: [] };
  // Verdicts are per competitor, so list order never re-keys.
  const key = cacheKey([
    ROSTER_VERSION, ROSTER_MODEL, input.brand, input.category, input.audience,
    [...competitors].map((c) => c.toLowerCase()).sort().join(","),
  ]);
  try {
    const hit = await store.cacheGet(key, CACHE_TTL_MS);
    if (hit) return JSON.parse(hit) as RosterClassification;
    const res = await openaiClient().chat.completions.create({
      model: ROSTER_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You type the competitors on a brand-tracking study by WHO EACH " +
            "BRAND SELLS TO. For the client brand and each competitor:\n" +
            "- sellsTo: the brand's customer sets as short plain noun phrases. " +
            "A brand selling to " +
            "several sets lists them all.\n" +
            "For each COMPETITOR also:\n" +
            "- audienceBuyable: true when the study's AUDIENCE is among the " +
            "brand's customers - the audience can buy the brand's offering " +
            "FROM THAT BRAND, as an alternative to the client brand. False " +
            "when the brand sells to the client's rivals, intermediaries or " +
            "the trade, and reaches the audience only through another " +
            "seller's product (a supplier whose offering reaches buyers only " +
            "inside another company's product). Selling to businesses is NOT by " +
            "itself false: when the audience IS businesses, a B2B rival " +
            "selling to them is buyable. A brand that sells to both " +
            "consumers and businesses is buyable by either audience. Judge " +
            "buyability by whether the category's buyers can buy it, never " +
            "by a platform or ecosystem preference worded into the audience " +
            "(a maker selling its finished product to the category's buyers " +
            "is buyable).\n" +
            "- note: ONE short plain line saying who it sells to relative to " +
            "the audience.\n" +
            "- consumerSalient: ONLY for a competitor with audienceBuyable " +
            "false - true when the audience still CHOOSES BY this brand as a " +
            "class of products they buy from other sellers (buyers ask for a " +
            "product by this brand's name); false when buyers rarely " +
            "think of the brand when choosing. Always false when " +
            "audienceBuyable is true.\n" +
            "- classPhrase: when consumerSalient is true, the natural phrase " +
            "a buyer uses for the brand as a product class, with its " +
            "article; otherwise an empty string.\n" +
            "- inCategory: true when the brand's competing offering is a " +
            "product in the study's CATEGORY as named. False for a brand " +
            "buyers might reach for on the same occasion that is a " +
            "different kind of product.\n" +
            "- parent: the brand's parent company as commonly known, " +
            "or the brand's own name when it is " +
            "independent.\n" +
            "- h2hRank: for competitors that are audienceBuyable AND " +
            "inCategory, rank them 1, 2, 3, ... by how often buyers weigh " +
            "each one against the client brand as a direct alternative " +
            "(1 = most often) - the head-to-heads buyers actually run, not " +
            "general fame. 0 for every other competitor.\n" +
            "- h2hReason: for ranked competitors, ONE short plain line (at " +
            "most 12 words) on why buyers weigh it against the client brand, " +
            "in category terms; otherwise an empty string.\n" +
            "Also give clientParent: the client brand's parent company (or " +
            "its own name when independent).\n" +
            "Return every competitor exactly once, in the given order, with " +
            "its name exactly as given. Never add or drop competitors.",
        },
        {
          role: "user",
          content:
            `Client brand: ${input.brand}\nCategory: ${input.category}\n` +
            `Audience: ${input.audience?.trim() || "the category's primary buyers"}\n` +
            `Competitors:\n${competitors.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "roster", strict: true, schema: ROSTER_SCHEMA },
      },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
      clientSellsTo?: string[];
      clientParent?: string;
      competitors?: {
        name?: string; sellsTo?: string[]; audienceBuyable?: boolean; note?: string;
        consumerSalient?: boolean; classPhrase?: string;
        inCategory?: boolean; parent?: string; h2hRank?: number; h2hReason?: string;
      }[];
    };
    const rows = parsed.competitors ?? [];
    // The model never decides the roster: verdicts align to OUR names, by
    // name first, then by position; an unmatched name stays same_seat.
    const used = new Set<number>();
    const verdicts: RosterVerdict[] = competitors.map((name, i) => {
      let j = rows.findIndex((r, k) => !used.has(k) && norm(r.name ?? "") === norm(name));
      if (j < 0 && rows[i] && !used.has(i)) j = i;
      const r = j >= 0 ? rows[j] : undefined;
      if (j >= 0) used.add(j);
      const audienceBuyable = typeof r?.audienceBuyable === "boolean" ? r.audienceBuyable : true;
      // Salience is an upstream property, and a class needs its phrase -
      // enforced in code so a same-seat or phrase-less verdict never
      // yields a class cell.
      const classPhrase = (r?.classPhrase ?? "").trim();
      const consumerSalient = !audienceBuyable && r?.consumerSalient === true && classPhrase.length > 0;
      // Category fit only demotes a BUYABLE brand (upstream stays upstream).
      const inCategory = r?.inCategory !== false;
      const role: RosterRole = !audienceBuyable ? "upstream" : inCategory ? "same_seat" : "adjacent";
      return {
        name,
        sellsTo: (r?.sellsTo ?? []).map((x) => String(x).trim()).filter(Boolean),
        audienceBuyable,
        role,
        note: (r?.note ?? "").trim(),
        consumerSalient,
        ...(consumerSalient ? { classPhrase: classPhrase.slice(0, 60) } : {}),
        inCategory,
        parent: (r?.parent ?? "").trim().slice(0, 60),
        h2hRank: role === "same_seat" && Number.isFinite(r?.h2hRank) ? Math.max(0, Math.round(r!.h2hRank!)) : 0,
        h2hReason: role === "same_seat" ? (r?.h2hReason ?? "").trim().slice(0, 120) : "",
      };
    });
    // Ranks are re-derived in code: same_seat verdicts get 1..n in the
    // model's order, unranked ones after it in roster order - so the
    // market step's pre-picks (the top ANGLE_SLOTS) are always well-defined.
    const seat = verdicts.filter((v) => v.role === "same_seat");
    seat
      .map((v, i) => ({ v, i }))
      .sort((a, b) => ((a.v.h2hRank || 1e9) - (b.v.h2hRank || 1e9)) || a.i - b.i)
      .forEach(({ v }, k) => { v.h2hRank = k + 1; });
    const out: RosterClassification = {
      competitors: verdicts,
      clientSellsTo: (parsed.clientSellsTo ?? []).map((x) => String(x).trim()).filter(Boolean),
      clientParent: (parsed.clientParent ?? "").trim().slice(0, 60),
    };
    await store.cacheSet(key, JSON.stringify(out), { brand: input.brand, category: input.category });
    return out;
  } catch (err) {
    console.error("roster classification failed open (every competitor same_seat):", err);
    return failOpen(competitors);
  }
}
