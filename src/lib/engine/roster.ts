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

/** Bump when the prompt or schema changes. */
const ROSTER_VERSION = "roster1";
const CACHE_TTL_MS = 183 * 24 * 3600 * 1000; // ~6 months, like other setup calls

export interface RosterVerdict {
  name: string;
  /** Who the brand sells to - its customer sets ("consumers", "banks"). */
  sellsTo: string[];
  /** Is the tracker's audience among those customers (buying from this
   * brand directly, as an alternative to the client)? */
  audienceBuyable: boolean;
  /** Derived: audienceBuyable ? same_seat : upstream. */
  role: RosterRole;
  /** One line on why. */
  note: string;
}

export interface RosterClassification {
  competitors: RosterVerdict[];
  /** The client brand's own customer sets. Stored only: the b2b half of a
   * "both" client is a future second-seat product signal. */
  clientSellsTo: string[];
  /** True when the call failed and every competitor defaulted to same_seat. */
  failedOpen?: boolean;
}

const ROSTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    clientSellsTo: { type: "array", items: { type: "string" } },
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
        },
        required: ["name", "sellsTo", "audienceBuyable", "note"],
      },
    },
  },
  required: ["clientSellsTo", "competitors"],
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
      name, sellsTo: [], audienceBuyable: true, role: "same_seat", note: "",
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
            "- sellsTo: the brand's customer sets as short plain noun phrases " +
            "(e.g. 'consumers', 'small businesses', 'enterprises', 'banks', " +
            "'merchants', 'retailers', 'software teams'). A brand selling to " +
            "several sets lists them all.\n" +
            "For each COMPETITOR also:\n" +
            "- audienceBuyable: true when the study's AUDIENCE is among the " +
            "brand's customers - the audience can buy the brand's offering " +
            "FROM THAT BRAND, as an alternative to the client brand. False " +
            "when the brand sells to the client's rivals, intermediaries or " +
            "the trade, and reaches the audience only through another " +
            "seller's product (a payment network behind banks' cards, an " +
            "ingredient or component supplier behind finished goods, a " +
            "wholesaler behind retailers). Selling to businesses is NOT by " +
            "itself false: when the audience IS businesses, a B2B rival " +
            "selling to them is buyable. A brand that sells to both " +
            "consumers and businesses is buyable by either audience.\n" +
            "- note: ONE short plain line saying who it sells to relative to " +
            "the audience (e.g. 'payment network - sells to card issuers and " +
            "merchants, not cardholders').\n" +
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
      competitors?: { name?: string; sellsTo?: string[]; audienceBuyable?: boolean; note?: string }[];
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
      return {
        name,
        sellsTo: (r?.sellsTo ?? []).map((x) => String(x).trim()).filter(Boolean),
        audienceBuyable,
        role: audienceBuyable ? "same_seat" : "upstream",
        note: (r?.note ?? "").trim(),
      };
    });
    const out: RosterClassification = {
      competitors: verdicts,
      clientSellsTo: (parsed.clientSellsTo ?? []).map((x) => String(x).trim()).filter(Boolean),
    };
    await store.cacheSet(key, JSON.stringify(out), { brand: input.brand, category: input.category });
    return out;
  } catch (err) {
    console.error("roster classification failed open (every competitor same_seat):", err);
    return failOpen(competitors);
  }
}
