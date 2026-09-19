import { NextResponse } from "next/server";
import { ENGINES } from "@/lib/engine/providers";
import { getPlanFor, planAllowsEngine, requireAuthOrDemo } from "@/lib/auth";

/** The measurement engines and whether this deployment can reach each one. */
export async function GET() {
  const auth = await requireAuthOrDemo();
  if (auth instanceof NextResponse) return auth;
  // Demo sessions have no plan row; show them the full panel (they can't run).
  const plan = await getPlanFor(auth).catch(() => "enterprise" as const);
  return NextResponse.json({
    engines: ENGINES.map((e) => ({
      id: e.id,
      label: e.label,
      vendor: e.vendor,
      available: Boolean(process.env[e.keyEnv]),
      keyEnv: e.keyEnv,
      mode: e.mode,
      locked: !planAllowsEngine(plan, e.id),
    })),
  });
}
