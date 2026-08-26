import { NextResponse } from "next/server";
import { PLAN_CUSTOM_CELL_ALLOWANCE, PLAN_SCENARIO_CAPS, getPlanFor, requireAuthOrDemo } from "@/lib/auth";

/** The caller's plan and its instrument limits - what the setup wizard
 * needs to size its gates. */
export async function GET() {
  const auth = await requireAuthOrDemo();
  if (auth instanceof NextResponse) return auth;
  const plan = await getPlanFor(auth);
  return NextResponse.json({ plan, scenarioCap: PLAN_SCENARIO_CAPS[plan], customCellAllowance: PLAN_CUSTOM_CELL_ALLOWANCE[plan] });
}
