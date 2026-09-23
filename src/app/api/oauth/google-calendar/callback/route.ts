import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calendarOAuthCredentials, googleAccountEmail } from "@/lib/google-calendar/client";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("gcal_oauth_state")?.value;
  const targetRaw = req.cookies.get("gcal_oauth_target")?.value;

  const settingsUrl = new URL("/settings/google-calendar", req.url);
  const done = (error?: string) => {
    if (error) settingsUrl.searchParams.set("error", error);
    const res = NextResponse.redirect(settingsUrl);
    res.cookies.delete("gcal_oauth_state");
    res.cookies.delete("gcal_oauth_target");
    return res;
  };

  let target: { company_id: string; profile_id: string | null } | null = null;
  try {
    target = targetRaw ? JSON.parse(targetRaw) : null;
  } catch {
    target = null;
  }
  if (!code || !state || !expectedState || state !== expectedState || !target?.company_id) {
    return done("State mismatch — please try connecting again.");
  }

  const creds = calendarOAuthCredentials();
  if (!creds) return done("Google Calendar is not configured on this deployment yet.");

  const redirectUri = `${req.nextUrl.origin}/api/oauth/google-calendar/callback`;
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return done("Could not connect to Google Calendar.");
  const tokens = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!tokens.refresh_token) {
    return done(
      "Google didn't return a refresh token — remove the CRM's access at myaccount.google.com/permissions and try again."
    );
  }

  const email = await googleAccountEmail(tokens.access_token);

  const admin = createAdminClient();
  // Replace rather than upsert: the partial unique indexes (one per rep,
  // one per company) aren't a single conflict target PostgREST can name.
  let del = admin.from("google_calendar_connections").delete().eq("company_id", target.company_id);
  del = target.profile_id ? del.eq("profile_id", target.profile_id) : del.is("profile_id", null);
  await del;
  const { error } = await admin.from("google_calendar_connections").insert({
    company_id: target.company_id,
    profile_id: target.profile_id,
    google_email: email,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    connected_at: new Date().toISOString(),
  });
  if (error) {
    return done(
      /google_calendar_connections/.test(error.message) || /schema cache/i.test(error.message)
        ? "Google Calendar isn't set up in the database yet — run migration 0173 and try again."
        : error.message
    );
  }
  settingsUrl.searchParams.set("connected", target.profile_id ? "mine" : "company");
  return done();
}
