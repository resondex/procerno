import { z } from "zod";
import { store } from "@/lib/store";
import { questionTypeOf } from "@/lib/engine/battery_checks";
import { brandAliasForms } from "@/lib/engine/brand_aliases";
import { humanize, namesAnyBrand } from "@/lib/engine/instrument";
import type { PromptTheme } from "@/lib/types";

/**
 * Shared by tracker create (POST /api/projects) and edit-setup (PUT
 * /api/projects/[id]/setup): one schema for the grid instrument both
 * accept, one builder for the rows both write, one lease shape both hold.
 * Not a route file - colocated helper.
 */

export const JourneyShape = z.object({
  involvement: z.enum(["considered", "habitual"]),
  verifiability: z.enum(["spec", "taste", "trust"]),
  think_feel: z.enum(["think", "feel"]),
  decision_unit: z.enum(["solo", "household", "committee"]),
});

/** Scenario label -> journey delta (null = inherits base). */
export const JourneysShape = z
  .record(z.string().max(120), JourneyShape.nullable())
  .refine((r) => Object.keys(r).length <= 16, "too many scenario journeys");

/** The worries gate's recommended-vs-decided record - stored on the
 * project (worry_decision) as the recommender's training data. */
export const WorryDecisionShape = z.object({
  recommended: z
    .array(z.object({ concern: z.string().trim().min(1).max(80), stage: z.string().trim().min(1).max(40) }))
    .max(40),
  decided: z
    .array(z.object({ concern: z.string().trim().min(1).max(80), stage: z.string().trim().min(1).max(40) }))
    .max(40),
});

/** The setup's offered-vs-accepted record, opaque to the routes but bounded. */
export const SetupDecisionShape = z
  .record(z.string(), z.unknown())
  .refine((d) => JSON.stringify(d).length <= 1_000_000, "setup record too large");

/** One confirmed cell. Caps sit well above real data (stage and layer
 * keys are short identifiers; angle can be a rival's name; mode is
 * comma-joined scenario labels). `qtype` is still accepted from older
 * clients but IGNORED - it is the dashboard's split key, derived here. */
export const CellShape = z.object({
  stage: z.string().trim().min(1).max(40),
  layer: z.string().trim().min(1).max(40),
  situation: z.string().trim().max(120).nullable(),
  angle: z.string().trim().min(1).max(80),
  mode: z.string().trim().max(600).nullable().optional(),
  qtype: z.string().trim().max(40).nullable().optional(),
  concern: z.string().trim().max(120).nullable().optional(),
  text: z.string().trim().min(1).max(2000),
  /** The confirmed paraphrase set for this cell; each becomes its own
   * prompt under the same intent, carrying its buyer voice. */
  phrasings: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(2000),
        asker: z.string().trim().max(300).optional(),
      })
    )
    .max(20)
    .optional(),
});

export type CellInput = z.infer<typeof CellShape>;

/** The rows one grid instrument writes: per cell an intent (qtype derived
 * server side) and its prompts, seed first. A prompt that names the brand
 * or a rival stores theme "branded" so the unbranded funnel stays blind;
 * the theme is decided per prompt, so a paraphrase that names a brand is
 * fenced off individually even if its seed is blind. House punctuation
 * on the way in covers text frozen in older drafts. */
export async function instrumentRows(
  cells: CellInput[],
  brand: string,
  competitors: string[],
  category: string
) {
  // The dictionary seed's cached alias read: "my Amex" in a pricing seed
  // types it within_brand, as generation typed it. Bounded, fails open.
  const aliasForms = await brandAliasForms([brand, ...competitors]).catch(
    () => ({}) as Record<string, string[]>
  );
  return cells.map((c) => ({
    intent: {
      stage: c.stage,
      layer: c.layer,
      situation: c.situation,
      angle: c.angle,
      mode: c.mode ?? null,
      qtype: questionTypeOf({ stage: c.stage, angle: c.angle, text: c.text }, brand, category, aliasForms),
      concern: c.concern ?? null,
      text: humanize(c.text),
    },
    prompts: [
      { text: c.text, asker: null as string | null },
      ...(c.phrasings ?? []).map((p) => ({ text: p.text, asker: (p.asker || null) as string | null })),
    ].map(({ text, asker }) => ({
      text: humanize(text),
      theme: (namesAnyBrand(text, brand, competitors) ? "branded" : c.stage) as PromptTheme,
      asker,
    })),
  }));
}

/** Distinct scenario columns a cell list uses (the plan's scenario cap). */
export function scenarioCount(cells: { situation: string | null }[]): number {
  return new Set(cells.map((c) => c.situation).filter(Boolean)).size;
}

const LEASE_RELEASED = "released";
/** Longer than the routes' maxDuration (120): a live holder is never
 * stolen; a holder killed mid-write frees the key on its own. */
export const WRITE_LEASE_MS = 130_000;

/** A short CAS lease in llm_cache (the run_drive pattern): serializes
 * tracker writes per key. Returns the holder token, or null when another
 * request holds it. */
export async function claimWriteLease(key: string): Promise<string | null> {
  const token = `lease:${crypto.randomUUID()}`;
  return (await store.cacheClaim(key, LEASE_RELEASED, token, WRITE_LEASE_MS)) ? token : null;
}

export async function releaseWriteLease(key: string, token: string): Promise<void> {
  // Only the holder releases (CAS on its own token).
  await store.cacheClaim(key, token, LEASE_RELEASED, WRITE_LEASE_MS).catch(() => false);
}

/** The per-tracker edit-setup lease key. The setup PUT holds it across its
 * run check and replaceInstrument; anything that CREATES a run (manual
 * runs POST, the cron) claims the same key around its own run check and
 * createRun, so a run can never start between the save's check and its
 * write - whichever side claims second sees the other's result. */
export function editSetupLeaseKey(projectId: string): string {
  return `edit_setup:${projectId}`;
}
