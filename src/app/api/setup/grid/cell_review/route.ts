import { NextResponse } from "next/server";
import { tagSetupFromRequest } from "@/lib/cost_log";
import { z } from "zod";
import { cacheSource, requireAuthOrDemo } from "@/lib/auth";
import { apiKeyConfigured } from "@/lib/engine/providers";
import { checkDesignFidelity, reviewCells, type CellFlag } from "@/lib/engine/instrument";
import {
  checkPromptAgainstSpec, checkPromptBrandRule, deriveCheckSpec, sameSeatOf, stageDesignIntent, type CellCheckSpec,
} from "@/lib/engine/battery_checks";
import { store } from "@/lib/store";

export const maxDuration = 60;

const Body = z.object({
  brand: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(120),
  competitors: z.array(z.string().trim().min(1).max(80)).max(12),
  /** Typed roster (2026-09-30): competitor -> same_seat | upstream.
   * Absent = every competitor same_seat (the untyped behavior). */
  rosterRoles: z.record(z.string().max(80), z.enum(["same_seat", "upstream"])).optional(),
  audience: z.string().trim().max(160).optional(),
  /** The user-edited or user-written prompts to check, each with its
   * cell's design context; `original` is the last machine wording. */
  candidates: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(2000),
        original: z.string().trim().max(2000).nullable().optional(),
        stage: z.string().trim().min(1).max(80),
        hint: z.string().trim().max(300).nullable().optional(),
        tag: z.string().trim().max(20).nullable().optional(),
        situation: z.string().trim().max(60).nullable(),
        situationDescription: z.string().trim().max(240).nullable().optional(),
        angle: z.string().trim().min(1).max(80),
        mode: z.string().trim().max(300).nullable().optional(),
        /** The cell's doubt/plan design line, when it declares one - the
         * paraphrase must still voice it (design-fidelity check). */
        design: z.string().trim().max(500).nullable().optional(),
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
  // Typed roster: every check below scopes to the SAME-SEAT rivals -
  // upstream brands are free vocabulary (no roles = the full list).
  const competitors = sameSeatOf(parsed.data.competitors, parsed.data.rosterRoles);
  // Spec-era candidates get their cell's design re-derived from the seed
  // (the edited text itself for a seed edit). A seed is judged against
  // the stage intent (a seed cannot be its own yardstick); a paraphrase
  // against the stored same-concern design line, as in generation.
  const specs: (CellCheckSpec | null)[] = parsed.data.candidates.map((c) => {
    // A class-angle cell is spec-era by construction (no legacy design).
    if ((!c.spec && !c.classPhrase) || !c.stageKey) return null;
    const seedText = c.seedEdit ? c.text : c.seed;
    if (!seedText) return null;
    return deriveCheckSpec(
      {
        stage: c.stageKey, angle: c.angle, text: seedText,
        ...(c.classPhrase ? { classPhrase: c.classPhrase, classBrand: c.classBrand } : {}),
      },
      parsed.data.brand, competitors, parsed.data.category
    );
  });
  const withDesign = parsed.data.candidates
    .map((c, i) => {
      const intent = c.stageKey ? stageDesignIntent(c.stageKey, parsed.data.brand) : null;
      const spec = specs[i];
      const design = c.design ?? (spec && !c.seedEdit ? spec.designLine ?? intent : intent);
      return { c, i, design };
    })
    .filter((x): x is { c: (typeof parsed.data.candidates)[number]; i: number; design: string } => !!x.design);
  // Each model check fails SOFT to a pass-through verdict: the free
  // deterministic brand rule below must reach the client even when the
  // reviewer times out or the checker errors (it used to die with them).
  const [verdicts, fidelity] = await Promise.all([
    reviewCells({
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
    }),
    checkDesignFidelity({
      candidates: withDesign.map((x) => ({ text: x.c.text, design: x.design })),
      meta: { source: cacheSource(auth) },
    }).catch((err) => {
      console.error("cell_review design check failed - mechanical checks still run:", err);
      return withDesign.map(() => ({ voices: true, reason: "" }));
    }),
  ]);
  // Deterministic brand rules on every edit that carries a stage key - a
  // check the model cannot be sweet-talked out of, run BEFORE the confirm
  // proceeds to paraphrase generation.
  parsed.data.candidates.forEach((c, i) => {
    if (!c.stageKey) return;
    const spec = specs[i];
    const mech = spec
      ? checkPromptAgainstSpec({ text: c.text, spec, category: parsed.data.category })
      : checkPromptBrandRule({
          text: c.text, stage: c.stageKey, angle: c.angle,
          brand: parsed.data.brand, competitors,
          category: parsed.data.category,
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
