import { brandAliasForms } from "@/lib/engine/brand_aliases";
import { primeBrandVerdicts } from "@/lib/engine/brand_judge";
import { NextResponse } from "next/server";
import { setupIdFromRequest, tagCosts } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireMemberOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { checkDesignFidelity, reviewCells, type CellFlag } from "@/lib/engine/instrument";
import {
  checkPromptAgainstSpec, checkPromptBrandRule, deriveCheckSpec, ROSTER_ROLE_VALUES, sameSeatOf, stageDesignIntent, type CellCheckSpec, type ValueLine,
} from "@/lib/engine/battery_checks";
import { store } from "@/lib/store";

// 120, not 60: the client waits up to 90s on this check (24 edits through
// the reviewer, the design check and the alias read).
export const maxDuration = 120;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  competitors: z.array(z.string().trim().min(1).max(80)).max(12),
  /** Typed roster (2026-09-30): competitor -> same_seat | upstream.
   * Absent = every competitor same_seat (the untyped behavior). */
  rosterRoles: z
    .record(z.string().max(80), z.enum(ROSTER_ROLE_VALUES))
    .refine((r) => Object.keys(r).length <= 24, "too many roster roles")
    .optional(),
  audience: z.string().trim().max(160).optional(),
  /** The user-edited or user-written prompts to check, each with its
   * cell's design context; `original` is the last machine wording. */
  candidates: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(2000),
        original: z.string().trim().max(2000).nullable().optional(),
        stage: z.string().trim().min(1).max(120),
        /** The stage hint verbatim from the wizard's stage list - real
         * hints run to 861 chars (problem_recognition). The old 300 cap
         * 400'd every batch carrying one, and the client then proceeded
         * with NO check at all; caps here sit well above real payloads. */
        hint: z.string().trim().max(2000).nullable().optional(),
        tag: z.string().trim().max(40).nullable().optional(),
        situation: z.string().trim().max(120).nullable(),
        situationDescription: z.string().trim().max(240).nullable().optional(),
        /** null = the cell's generic angle. */
        angle: z.string().trim().max(80).nullable().transform((a) => a || "generic"),
        mode: z.string().trim().max(600).nullable().optional(),
        /** The cell's doubt/plan design line, when it declares one - the
         * paraphrase must still voice it (design-fidelity check). */
        design: z.string().trim().max(4000).nullable().optional(),
        /** The cell's planned worry (worry cells): the edit is checked
         * against THIS doubt, as at generation. */
        concern: z.string().trim().max(120).nullable().optional(),
        /** Value cells: the line and counterpart the edit must keep. */
        valueLine: z
          .object({
            line: z.string().trim().min(1).max(120),
            counterpart: z.string().trim().min(1).max(160),
            fit: z.enum(["contest", "leans_no", "leans_yes"]).optional(),
          })
          .nullable()
          .optional(),
        /** The stage KEY (churn_triggers, not "Churn triggers") - enables the
         * deterministic brand-rule check and the stage-intent design check
         * on manual edits, before any paraphrase generation. */
        stageKey: z.string().trim().max(80).optional(),
        /** s7: the cell carries a typed check-spec. Its presence selects
         * the spec path; the design is re-derived here from stageKey +
         * angle + the seed, never trusted from the client. */
        spec: z.record(z.string(), z.unknown()).nullable().optional(),
        /** This candidate IS the cell's seed (not a paraphrase) - a
         * confirmed seed edit re-derives the cell's spec from its text. */
        seedEdit: z.boolean().optional(),
        /** The cell's current seed text, for paraphrase candidates: the
         * spec (quantities, design line) is the seed's. */
        seed: z.string().trim().max(2000).optional(),
        /** Class-angle comparison cells (2026-10-01): the class phrase
         * and the upstream brand it evokes. Absent on every other cell. */
        classPhrase: z.string().trim().max(60).nullable().optional(),
        classBrand: z.string().trim().max(80).nullable().optional(),
      })
    )
    .min(1)
    .max(24),
});

/** Gate 2 helper: quality check on user-edited prompts at the gate
 * confirm - verdicts in candidate order, each with a minimal suggested
 * edit when not ok. */
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
  // Typed roster: every check below scopes to the SAME-SEAT rivals -
  // upstream brands are free vocabulary (no roles = the full list).
  const competitors = sameSeatOf(parsed.data.competitors, parsed.data.rosterRoles);
  const roomText = (c: (typeof parsed.data.candidates)[number]) =>
    c.situation ? (c.situationDescription ? `${c.situation} - ${c.situationDescription}` : c.situation) : c.situation;
  // The reviewer needs neither aliases nor specs: it starts now, alongside
  // the alias read (up to 20s) instead of after it.
  const reviewing = reviewCells({
    brand: parsed.data.brand,
    category: parsed.data.category,
    competitors,
    audience: parsed.data.audience || null,
    candidates: parsed.data.candidates.map((c) => ({
      text: c.text,
      original: c.original ?? null,
      stage: c.stage,
      stageKey: c.stageKey,
      hint: c.hint ?? null,
      tag: c.tag ?? null,
      situation: c.situation,
      situationDescription: c.situationDescription ?? null,
      angle: c.angle,
      mode: c.mode ?? null,
      ...(c.classPhrase ? { classPhrase: c.classPhrase } : {}),
    })),
    meta: { source: cacheSource(auth) },
  }).catch((err) => {
    console.error("cell_review reviewer failed - mechanical checks still run:", err);
    return parsed.data.candidates.map((c) => ({
      ok: true, flags: [] as CellFlag[], reason: "", suggestion: c.text,
    }));
  });
  // r13: the same alias vocabulary generation checks with ("amex"), read
  // from the full roster (the dictionary seed's cache key).
  const aliasForms = await brandAliasForms([parsed.data.brand, ...parsed.data.competitors]).catch(
    () => ({}) as Record<string, string[]>
  );
  // Spec-era candidates get their cell's design re-derived from the seed
  // (the edited text itself for a seed edit). A seed is judged against
  // the stage intent (a seed cannot be its own yardstick); a paraphrase
  // against the stored same-concern design line, as in generation. The
  // concern and class ride into the derivation exactly as generation
  // passes them.
  const specs: (CellCheckSpec | null)[] = parsed.data.candidates.map((c) => {
    // A class-angle cell is spec-era by construction (no legacy design).
    if ((!c.spec && !c.classPhrase) || !c.stageKey) return null;
    const seedText = c.seedEdit ? c.text : c.seed;
    if (!seedText) return null;
    return deriveCheckSpec(
      {
        stage: c.stageKey, angle: c.angle, text: seedText, concern: c.concern ?? null,
        ...(c.classPhrase ? { classPhrase: c.classPhrase, classBrand: c.classBrand } : {}),
      },
      parsed.data.brand, competitors, parsed.data.category, aliasForms
    );
  });
  // The stage intent with the cell's full design - concern, angle, room
  // and Value line - mirroring generation (instrument.ts stageDesignIntent
  // call on the phrasings path). Without them comparison/alternatives
  // edits got no intent at all, worry edits were not held to their worry
  // and Value edits not to their line.
  const withDesign = parsed.data.candidates
    .map((c, i) => {
      const intent = c.stageKey
        ? stageDesignIntent(c.stageKey, parsed.data.brand, c.concern ?? null, c.angle, roomText(c), (c.valueLine ?? null) as ValueLine | null)
        : null;
      const spec = specs[i];
      const design = c.design ?? (spec && !c.seedEdit ? spec.designLine ?? intent : intent);
      return { c, i, design };
    })
    .filter((x): x is { c: (typeof parsed.data.candidates)[number]; i: number; design: string } => !!x.design);
  // Each model check fails SOFT to a pass-through verdict: the free
  // deterministic brand rule below must reach the client even when the
  // reviewer times out or the checker errors (it used to die with them).
  // The design check and the r15 brand judge (verdicts for ambiguous
  // one-word brand hits on each edit's forbidden brands, read by the sync
  // brand rules below) are independent - they run together.
  const [verdicts, fidelity] = await Promise.all([
    reviewing,
    checkDesignFidelity({
      candidates: withDesign.map((x) => ({ text: x.c.text, design: x.design })),
      meta: { source: cacheSource(auth) },
    }).catch((err) => {
      console.error("cell_review design check failed - mechanical checks still run:", err);
      return withDesign.map(() => ({ voices: true, reason: "" }));
    }),
    primeBrandVerdicts({
      items: parsed.data.candidates.flatMap((c, i) => (specs[i] ? [{ text: c.text, brands: specs[i]!.forbiddenBrands }] : [])),
      roster: [parsed.data.brand, ...competitors], aliases: aliasForms, category: parsed.data.category,
      meta: { source: cacheSource(auth) },
    }).catch((err) => console.error("cell_review brand judge failed open:", err)),
  ]);
  // Deterministic brand rules on every edit that carries a stage key - a
  // check the model cannot be sweet-talked out of, run BEFORE the confirm
  // proceeds to paraphrase generation.
  parsed.data.candidates.forEach((c, i) => {
    if (!c.stageKey) return;
    const spec = specs[i];
    const mech = spec
      ? checkPromptAgainstSpec({ text: c.text, spec, category: parsed.data.category, extraForms: aliasForms })
      : checkPromptBrandRule({
          text: c.text, stage: c.stageKey, angle: c.angle,
          brand: parsed.data.brand, competitors,
          category: parsed.data.category, extraForms: aliasForms,
        });
    if (mech.length > 0) {
      const v = verdicts[i];
      v.ok = false;
      if (!v.flags.includes("branding")) v.flags = [...v.flags, "branding"];
      v.reason = [v.reason, ...mech.map((m) => m.detail)].filter(Boolean).join(" ");
    }
  });
  withDesign.forEach((x, k) => {
    const f = fidelity[k];
    if (f && !f.voices) {
      const v = verdicts[x.i];
      v.ok = false;
      v.flags = [...v.flags, "design"];
      v.reason = [v.reason, f.reason || "This paraphrase no longer voices its cell's design."]
        .filter(Boolean).join(" ");
    }
  });
  // A flag added by the mechanical rule or the design check rides on the
  // model's "ok" echo, whose suggestion IS the flagged text. Serving that
  // as a suggested edit lets one click launder the violation into the
  // machine baseline and out of review forever - blank it, so the client
  // offers no suggestion and the prompt stays under review.
  parsed.data.candidates.forEach((c, i) => {
    const v = verdicts[i];
    if (!v.ok && v.suggestion.trim() === c.text.trim()) v.suggestion = "";
  });
  const flagged = verdicts
    .map((v, i) => ({ candidate: parsed.data.candidates[i], verdict: v }))
    .filter((x) => !x.verdict.ok);
  if (flagged.length > 0) {
    // Visibility only - never read back into generation.
    await store
      .feedbackAdd({
        email: auth.email,
        category: parsed.data.category,
        audience: parsed.data.audience || null,
        kind: "cell_review_flagged",
        payload: { items: flagged },
      })
      .catch(() => {});
  }
  // A confirmed seed edit's re-derived spec rides back (aligned with the
  // candidates; null for paraphrases and legacy cells) for the client to
  // store on the cell.
  return NextResponse.json({
    verdicts,
    specs: parsed.data.candidates.map((c, i) => (c.seedEdit ? specs[i] : null)),
  });
}
