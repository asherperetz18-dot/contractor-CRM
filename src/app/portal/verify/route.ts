import { NextRequest, NextResponse } from "next/server";
import { consumeLoginToken } from "@/lib/portal/session";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/portal?error=missing", req.url));
  }

  const { error } = await consumeLoginToken(token);
  if (error) {
    return NextResponse.redirect(
      new URL(`/portal?error=${encodeURIComponent(error)}`, req.url)
    );
  }

  return NextResponse.redirect(new URL("/portal/home", req.url));
}
