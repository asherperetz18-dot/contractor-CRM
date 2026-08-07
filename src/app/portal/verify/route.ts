import { NextRequest, NextResponse } from "next/server";
import { beginLogin } from "@/lib/portal/session";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/portal?error=missing", req.url));
  }

  const { error, needsChallenge } = await beginLogin(token);
  if (error) {
    return NextResponse.redirect(
      new URL(`/portal?error=${encodeURIComponent(error)}`, req.url)
    );
  }

  // Where to land after signing in -- an estimate link points at its own
  // document rather than the portal home. Only same-site /portal/ paths
  // are honoured, so a crafted link can't turn this into an open redirect
  // that borrows the customer's fresh session.
  const requested = req.nextUrl.searchParams.get("next");
  const safeNext =
    requested && /^\/portal\/[A-Za-z0-9/_-]*$/.test(requested) ? requested : "/portal/home";

  // Redirect either way so the token never stays in the address bar,
  // browser history, or an outbound Referer header.
  if (needsChallenge) {
    const url = new URL("/portal/confirm", req.url);
    if (safeNext !== "/portal/home") url.searchParams.set("next", safeNext);
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(safeNext, req.url));
}
