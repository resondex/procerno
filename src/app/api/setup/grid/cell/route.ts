import { NextResponse } from "next/server";
import { setupIdFromRequest, tagCosts } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireMemberOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import {
  regenerateCell,
  type ScenarioSpec,
} from "@/lib/engine/instrument";
import { ModeratorsShape } from "@/lib/engine/instrument_shapes";
import { ROSTER_ROLE_VALUES } from "@/lib/engine/battery_checks";
import { engineFailed } from "../../engine_error";

// 300, not 120: regenerateCell runs up to three writer + check attempts
// with no deadline of its own (nothing is cached until one passes).
export const maxDuration = 300;

const JourneyShape = z.object({
  involvement: z.enum(["considered", "habitual"]),
  verifiability: z.enum(["spec", "taste", "trust"]),
  think_feel: z.enum(["think", "feel"]),
  decision_unit: z.enum(["solo", "household", "committee"]),
});

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  competitors: z.array(z.string().trim().min(1).max(80)).max(12),
  /** Typed roster (2026-09-30): competitor -> same_seat | upstream.
   * Absent = every competitor same_seat (the untyped behavior). */
  rosterRoles: z
    .record(z.string().max(80), z.enum(ROSTER_ROLE_VALUES))
    // 48: drafts saved before the client pruned removed competitors carry stale roles.
    .refine((r) => Object.keys(r).length <= 48, "too many roster roles")
    .optional(),
  audience: z.string().trim().max(160).optional(),
  base: ModeratorsShape,
  scenarios: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        description: z.string().trim().max(240),
        /** journeys30: the want-free restatement the writer reads; absent = derived server side. */
        circumstance: z.string().trim().max(240).optional(),
        journey: JourneyShape.nullable(),
      })
    )
    .min(1)
    .max(4),
  cell: z.object({
    stage: z.string().trim().min(1).max(60),
    situation: z.string().trim().max(60).nullable(),
    angle: z.string().trim().min(1).max(80),
    mode: z.string().trim().max(300).nullable(),
    /** The cell's planned concern (s9+): part of the design, survives redraws. */
    concern: z.string().trim().max(120).nullable().optional(),
    /** Value cells (2026-10-04): the line and counterpart survive redraws. */
    valueLine: z.object({ line: z.string().trim().min(1).max(80), counterpart: z.string().trim().min(1).max(120) }).nullable().optional(),
    /** Class-angle comparison cells (2026-10-01): the class phrase
     * and the upstream brand it evokes. Absent on every other cell. */
    classPhrase: z.string().trim().max(60).nullable().optional(),
    classBrand: z.string().trim().max(80).nullable().optional(),
  }),
  /** Every text already offered for this cell. Blank entries (a blank
   * custom card's history) are dropped, never a 400 - the draw then just
   * has nothing to avoid. */
  avoid: z.array(z.string().trim().max(2000)).max(8).transform((a) => a.filter(Boolean)),
  /** Near-variant mode: keep this prompt's ask, move one detail. */
  nearTo: z.string().trim().min(1).max(2000).optional(),
  /** r26: the same stage's current seeds in the other scenarios (subjects taken). */
  siblings: z.array(z.union([
    z.string().trim().min(1).max(2000),
    z.object({ situation: z.string().trim().max(60).nullable(), text: z.string().trim().min(1).max(2000) }),
  ])).max(8).optional(),
});

/** Gate 2 helper: one fresh prompt for a single cell, different from every
 * previous offer - the "New prompt" button. */
export async function POST(req: Request) {
  const auth = await requireMemberOrDemo();
  if (auth instanceof NextResponse) return auth;
  tagCosts({ setupId: await setupIdFromRequest(req, auth) });
  if (!apiKeyConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  let drawn: Awaited<ReturnType<typeof regenerateCell>>;
  try {
    drawn = await regenerateCell({
      brand: parsed.data.brand,
      category: parsed.data.category,
      competitors: parsed.data.competitors,
      audience: parsed.data.audience || null,
      base: parsed.data.base,
      scenarios: parsed.data.scenarios as ScenarioSpec[],
      cell: parsed.data.cell,
      avoid: parsed.data.avoid,
      nearTo: parsed.data.nearTo,
      siblings: parsed.data.siblings,
      rosterRoles: parsed.data.rosterRoles,
      meta: { source: cacheSource(auth) },
    });
  } catch (err) {
    return engineFailed("cell", err, "no new prompt came back - try again");
  }
  if (!drawn) {
    return NextResponse.json({ error: "no new prompt came back - try again" }, { status: 502 });
  }
  // The draw's check-spec rides back with it: the client stores it on the
  // cell, and every later check reads it. An advocacy draw also carries
  // its quoted criticism (s56), which the client stores on the cell.
  return NextResponse.json({
    text: drawn.text, spec: drawn.spec,
    ...(drawn.flags?.length ? { flags: drawn.flags } : {}),
    ...(drawn.criticism ? { criticism: drawn.criticism } : {}),
  });
}
