import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("gdrive_oauth_state")?.value;

  const settingsUrl = new URL("/settings/cloud-storage", req.url);

  if (!code || !state || !expectedState || state !== expectedState) {
    settingsUrl.searchParams.set("error", "State mismatch — please try connecting again.");
    return NextResponse.redirect(settingsUrl);
  }

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    settingsUrl.searchParams.set("error", "Google Drive is not configured yet.");
    return NextResponse.redirect(settingsUrl);
  }

  const redirectUri = `${req.nextUrl.origin}/api/oauth/google-drive/callback`;

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    settingsUrl.searchParams.set("error", "Could not connect to Google Drive.");
    return NextResponse.redirect(settingsUrl);
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  if (!tokens.refresh_token) {
    settingsUrl.searchParams.set(
      "error",
      "Google didn't return a refresh token — disconnect any prior access at myaccount.google.com/permissions and try again."
    );
    return NextResponse.redirect(settingsUrl);
  }

  const aboutRes = await fetch(`${DRIVE_API}/about?fields=user`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const about = aboutRes.ok
    ? ((await aboutRes.json()) as { user?: { emailAddress?: string } })
    : {};
  const email = about.user?.emailAddress ?? "Connected account";

  const folderRes = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Contractor CRM Files", mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!folderRes.ok) {
    settingsUrl.searchParams.set("error", "Connected, but couldn't create a Drive folder.");
    return NextResponse.redirect(settingsUrl);
  }
  const folder = (await folderRes.json()) as { id: string };

  const admin = createAdminClient();
  await admin.from("google_drive_connection").upsert({
    id: 1,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    connected_email: email,
    folder_id: folder.id,
    connected_at: new Date().toISOString(),
  });

  const res = NextResponse.redirect(settingsUrl);
  res.cookies.delete("gdrive_oauth_state");
  return res;
}
