import { NextResponse } from "next/server";
import { PLAN_SCENARIO_CAPS, getPlanFor, requireAuth } from "@/lib/auth";

/** The caller's plan and its instrument limits - what the setup wizard
 * needs to size its gates. */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const plan = await getPlanFor(auth);
  return NextResponse.json({ plan, scenarioCap: PLAN_SCENARIO_CAPS[plan] });
}
