import { NextResponse } from "next/server";

/**
 * The setup routes' error contract for an engine call that THREW (vendor
 * outage, malformed reply, a bug): log it and answer with the same
 * structured 502 + retry wording the routes already use for "nothing came
 * back", never a bare empty-body 500 the wizard cannot read. Not a route
 * file - colocated helper.
 */
export function engineFailed(route: string, err: unknown, message: string): NextResponse {
  console.error(`${route}: engine call failed -`, err);
  return NextResponse.json({ error: message }, { status: 502 });
}
