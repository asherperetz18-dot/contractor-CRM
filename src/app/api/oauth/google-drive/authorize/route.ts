import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", user.id)
    .single();
  const roles = (profile as { roles: string[] } | null)?.roles ?? [];
  if (!roles.includes("Office") && !roles.includes("Admin")) {
    return NextResponse.redirect(new URL("/settings/cloud-storage", req.url));
  }

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Google Drive is not configured yet." }, { status: 500 });
  }

  const redirectUri = `${req.nextUrl.origin}/api/oauth/google-drive/callback`;
  const state = crypto.randomBytes(24).toString("hex");

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", DRIVE_SCOPE);
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set("gdrive_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
