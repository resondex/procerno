import { NextResponse } from "next/server";

/** The demo link: /api/demo/enter?key=... - a matching key sets the demo
 * cookie and lands on /demo; anything else lands on the homepage with no
 * hint that a key exists. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const expected = process.env.DEMO_ACCESS_KEY;
  if (!expected || key !== expected) {
    return NextResponse.redirect(new URL("/", url.origin));
  }
  const res = NextResponse.redirect(new URL("/demo", url.origin));
  res.cookies.set("ap_demo", key, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  return res;
}
