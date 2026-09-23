import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { CALENDAR_SCOPES, calendarOAuthCredentials } from "@/lib/google-calendar/client";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Starts the Google sign-in for a calendar connection. `?target=mine`
 * (any signed-in user: their own calendar) or `?target=company` (Office
 * or Admin only: the company-wide calendar). Mirrors the Drive flow --
 * CSRF state and the target ride in short-lived cookies because the
 * callback is its own request.
 */
export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.redirect(new URL("/login", req.url));

  const settingsUrl = new URL("/settings/google-calendar", req.url);
  const target = req.nextUrl.searchParams.get("target") === "company" ? "company" : "mine";
  if (target === "company" && !isAdminRole(profile)) {
    settingsUrl.searchParams.set("error", "Only Office or Admin users can connect the company calendar.");
    return NextResponse.redirect(settingsUrl);
  }

  const creds = calendarOAuthCredentials();
  if (!creds) {
    settingsUrl.searchParams.set("error", "Google Calendar is not configured on this deployment yet.");
    return NextResponse.redirect(settingsUrl);
  }

  const redirectUri = `${req.nextUrl.origin}/api/oauth/google-calendar/callback`;
  const state = crypto.randomBytes(24).toString("hex");

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", creds.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", CALENDAR_SCOPES);
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", state);

  const cookie = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/" };
  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set("gcal_oauth_state", state, cookie);
  res.cookies.set(
    "gcal_oauth_target",
    JSON.stringify({ company_id: profile.company_id, profile_id: target === "mine" ? profile.id : null }),
    cookie
  );
  return res;
}
