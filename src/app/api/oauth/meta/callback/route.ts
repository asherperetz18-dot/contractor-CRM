import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { metaLoginCredentials } from "@/lib/meta/facebook-login";
import { listPages, userTokenFromCode } from "@/lib/meta/graph";
import { PICK_COOKIE, PICK_COOKIE_OPTIONS, connectPageForCompany } from "@/lib/meta/connect";

/**
 * Facebook sends the person back here after they sign in. One Page:
 * connected on the spot. Several: the sign-in waits in a cookie and the
 * settings page asks which one (connectFacebookPage finishes it).
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("meta_oauth_state")?.value;
  const companyId = req.cookies.get("meta_oauth_company")?.value;

  const settingsUrl = new URL("/settings/facebook-lead-ads", req.url);
  const done = (error?: string, pickToken?: string) => {
    if (error) settingsUrl.searchParams.set("error", error);
    const res = NextResponse.redirect(settingsUrl);
    res.cookies.delete("meta_oauth_state");
    res.cookies.delete("meta_oauth_company");
    if (pickToken && companyId) {
      res.cookies.set(PICK_COOKIE, JSON.stringify({ company_id: companyId, token: pickToken }), PICK_COOKIE_OPTIONS);
    }
    return res;
  };

  // Cancelled on Facebook's screen, or a permission declined.
  if (req.nextUrl.searchParams.get("error")) {
    return done("Facebook sign-in was cancelled — nothing was changed.");
  }
  if (!code || !state || !expectedState || state !== expectedState || !companyId) {
    return done("State mismatch — please try connecting again.");
  }
  // The company in the cookie must still be the signed-in admin's own.
  const profile = await getCurrentProfile();
  if (!profile || profile.company_id !== companyId || !isAdminRole(profile)) {
    return done("Only Office or Admin users can connect Facebook.");
  }

  const creds = metaLoginCredentials();
  if (!creds) return done("Facebook sign-in isn't configured on this deployment yet.");

  const userToken = await userTokenFromCode(creds, code, `${req.nextUrl.origin}/api/oauth/meta/callback`);
  if (!userToken) return done("Facebook didn't finish the sign-in — please try again.");

  const pages = await listPages(userToken);
  if (!pages) return done("Facebook wouldn't list your Pages — please try again.");
  if (pages.length === 0) {
    return done(
      "This Facebook account doesn't manage any Pages, or no Page was ticked on Facebook's screen. Connect again and tick the Page your lead forms run on."
    );
  }
  if (pages.length > 1) return done(undefined, userToken);

  const error = await connectPageForCompany(companyId, pages[0]);
  if (error) return done(error);
  settingsUrl.searchParams.set("connected", "1");
  return done();
}
