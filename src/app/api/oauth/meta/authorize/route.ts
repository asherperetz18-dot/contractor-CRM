import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { metaAuthorizeUrl, metaLoginCredentials } from "@/lib/meta/facebook-login";
import { PICK_COOKIE_OPTIONS } from "@/lib/meta/connect";

/**
 * Starts "Connect with Facebook" for the signed-in person's company.
 * Office or Admin only -- the Page decides where every Facebook lead
 * goes. Same shape as the Google flows: CSRF state and the company ride
 * in short-lived cookies because the callback is its own request.
 */
export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.redirect(new URL("/login", req.url));

  const settingsUrl = new URL("/settings/facebook-lead-ads", req.url);
  if (!isAdminRole(profile)) {
    settingsUrl.searchParams.set("error", "Only Office or Admin users can connect Facebook.");
    return NextResponse.redirect(settingsUrl);
  }
  const creds = metaLoginCredentials();
  if (!creds) {
    settingsUrl.searchParams.set("error", "Facebook sign-in isn't configured on this deployment yet.");
    return NextResponse.redirect(settingsUrl);
  }

  const state = crypto.randomBytes(24).toString("hex");
  const res = NextResponse.redirect(
    metaAuthorizeUrl({
      appId: creds.appId,
      configId: creds.configId,
      redirectUri: `${req.nextUrl.origin}/api/oauth/meta/callback`,
      state,
    })
  );
  res.cookies.set("meta_oauth_state", state, PICK_COOKIE_OPTIONS);
  res.cookies.set("meta_oauth_company", profile.company_id, PICK_COOKIE_OPTIONS);
  return res;
}
