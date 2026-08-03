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

  // Redirect either way so the token never stays in the address bar,
  // browser history, or an outbound Referer header.
  return NextResponse.redirect(
    new URL(needsChallenge ? "/portal/confirm" : "/portal/home", req.url)
  );
}
