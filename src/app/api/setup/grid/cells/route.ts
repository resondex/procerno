import { NextResponse } from "next/server";
import { tagSetupFromRequest } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import {
  generateGrid,
  participationMask,
  type Journey,
  type Moderators,
  type ScenarioSpec,
} from "@/lib/engine/instrument";
import { ModeratorsShape } from "@/lib/engine/instrument_shapes";
import { ROSTER_ROLE_VALUES } from "@/lib/engine/battery_checks";

// 300, not 120: a hard category's market read alone runs 90-120s of
// gpt-5 reasoning - the old budget killed first reads at the wall and
// greeted fresh categories with an error. Fluid Compute allows 300.
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
  rosterRoles: z.record(z.string().max(80), z.enum(ROSTER_ROLE_VALUES)).optional(),
  /** Class-angle cells (2026-10-01): upstream brand -> buyer class phrase
   * ("a Visa card"). Only upstream entries with a phrase earn a class
   * cell. Absent = no class cells (byte-identical behavior). */
  rosterClasses: z.record(z.string().max(80), z.string().trim().max(60)).optional(),
  /** Confirmed worry picks (the worries module, 2026-10-01): one invariant
   * doubt cell per pick. Absent = the legacy concern-plan zip. */
  worries: z
    .array(
      z.object({
        concern: z.string().trim().min(1).max(80),
        stage: z.enum(["objections", "churn_triggers", "renewal"]),
      })
    )
    .max(36)
    .optional(),
  /** Value lines per room (2026-10-04), as confirmed at the gate: the line
   * each column's Value cell weighs and its one-tier-down counterpart;
   * null = no Value cell for that room. Absent = the engine default. */
  valueLines: z.record(z.string().max(60), z.object({ line: z.string().trim().min(1).max(80), counterpart: z.string().trim().min(1).max(120) }).nullable()).optional(),
  audience: z.string().trim().max(160).optional(),
  base: ModeratorsShape,
  /** The ACTIVE scenarios as confirmed at gate 1, with their journeys. */
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
  /** Stage keys the user kept at gate 1; the mask is recomputed server
   * side from the journeys so stage hints never leave the engine. */
  stageKeys: z.array(z.string().trim().min(1)).min(1).max(30),
  /** Background warm: fill the cache but never wait on another request's
   * in-flight write - the confirm that needs results does the waiting. */
  warm: z.boolean().optional(),
  /** An explicit user confirm retries units the automatic paths gave up on
   * (the 3-attempt exhaustion marker). Never set by the background warm. */
  retryExhausted: z.boolean().optional(),
});

/** Gate 2: write one seed prompt per masked cell for the confirmed read. */
export async function POST(req: Request) {
  tagSetupFromRequest(req);
  const auth = await requireAuthOrDemo();
  if (auth instanceof NextResponse) return auth;
  if (!apiKeyConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { brand, category, competitors, audience, stageKeys } = parsed.data;
  const base: Moderators = parsed.data.base;
  const scenarios = parsed.data.scenarios as unknown as (ScenarioSpec & { journey: Journey | null })[];
  const kept = new Set(stageKeys);
  const stages = participationMask(base, scenarios).filter((s) => kept.has(s.key));
  if (stages.length === 0) {
    return NextResponse.json({ error: "keep at least one stage" }, { status: 400 });
  }
  const report: { missing: { stage: string; situation: string | null; angle: string }[]; reason?: "unjudged" | "pending" } = { missing: [] };
  const cells = await generateGrid({
    brand,
    category,
    competitors,
    audience: audience || null,
    base,
    scenarios,
    stages,
    rosterRoles: parsed.data.rosterRoles,
    rosterClasses: parsed.data.rosterClasses,
    worries: parsed.data.worries,
    valueLines: parsed.data.valueLines,
    noWait: parsed.data.warm,
    retryExhausted: parsed.data.retryExhausted,
    report,
    meta: { source: cacheSource(auth) },
  });
  if (!cells) {
    return parsed.data.warm
      ? NextResponse.json({ pending: true })
      : NextResponse.json(
          {
            error:
              report.reason === "unjudged"
                ? "the prompt checker is briefly unavailable - your prompts are written and will be checked when you retry in a moment"
                : "the prompts are still being written - try again in a moment",
          },
          { status: 502 }
        );
  }
  return NextResponse.json({ cells, ...(report.missing.length > 0 ? { missing: report.missing } : {}) });
}
