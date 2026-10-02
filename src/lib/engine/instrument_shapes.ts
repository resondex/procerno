import { z } from "zod";

/** The market read's base journey as the setup routes receive it back from
 * the client (2026-10-02 review round 3, item 8): the old
 * `z.record(z.string(), z.unknown())` plus an `as Moderators` cast let a
 * malformed base silently compose a default-journey library. passthrough()
 * tolerates fields a future read adds; the six enums and the flag are the
 * contract the engine actually branches on. */
export const ModeratorsShape = z
  .object({
    verifiability: z.enum(["spec", "taste", "trust"]),
    involvement: z.enum(["considered", "habitual"]),
    think_feel: z.enum(["think", "feel"]),
    decision_unit: z.enum(["solo", "household", "committee"]),
    rhythm: z.enum(["one_shot", "replenishment", "subscription"]),
    risk: z.enum(["performance", "financial", "social", "physical"]),
    channel_retail: z.boolean(),
    rationale: z.string().max(600),
  })
  .passthrough();
