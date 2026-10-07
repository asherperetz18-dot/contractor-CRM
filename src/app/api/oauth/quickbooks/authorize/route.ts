import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { encryptionAvailable } from "@/lib/crypto/secrets";
import { quickbooksAuthorizeUrl, quickbooksCredentials } from "@/lib/quickbooks/oauth";

/**
 * Starts Intuit's sign-in for the company's QuickBooks (DECISIONS #172).
 * Office or Admin only. The CSRF state and the company ride in short-
 * lived cookies because the callback is its own request, as the Google
 * flows do.
 */
export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.redirect(new URL("/login", req.url));

  const settingsUrl = new URL("/settings/quickbooks", req.url);
  const fail = (error: string) => {
    settingsUrl.searchParams.set("error", error);
    return NextResponse.redirect(settingsUrl);
  };
  if (!isAdminRole(profile)) return fail("Only Office or Admin users can connect QuickBooks.");
  const creds = quickbooksCredentials();
  if (!creds) return fail("QuickBooks isn't set up on the CRM yet.");
  // Never hold a QuickBooks login unencrypted.
  if (!encryptionAvailable()) return fail("The CRM's encryption key isn't set, so it can't keep a QuickBooks login.");

  const state = crypto.randomBytes(24).toString("hex");
  const url = quickbooksAuthorizeUrl({
    clientId: creds.clientId,
    redirectUri: `${req.nextUrl.origin}/api/oauth/quickbooks/callback`,
    state,
  });
  const cookie = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/" };
  const res = NextResponse.redirect(url);
  res.cookies.set("qb_oauth_state", state, cookie);
  res.cookies.set("qb_oauth_target", JSON.stringify({ company_id: profile.company_id }), cookie);
  return res;
}
