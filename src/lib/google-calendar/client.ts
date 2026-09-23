import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { GoogleEvent, GoogleEventBody } from "./sync-plan";

/**
 * The thin layer between the sync and Google: credentials, token
 * refresh, and the four Calendar API calls the runner makes. Raw fetch,
 * like the Drive integration -- the API surface used here is small
 * enough that a client library would cost more than it saves.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const CALENDAR_SCOPES = "https://www.googleapis.com/auth/calendar.events email";

/**
 * Its own client id when set, otherwise Google Drive's: both live in one
 * Google Cloud project, so the only setup the calendar needs is the
 * Calendar API switched on and its callback URL added to that client.
 */
export function calendarOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export type ConnectionRow = {
  id: string;
  company_id: string;
  profile_id: string | null;
  google_email: string | null;
  google_calendar_id: string;
  access_token: string | null;
  refresh_token: string;
  token_expires_at: string | null;
  sync_token: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  connected_at: string;
};

type Admin = ReturnType<typeof createAdminClient>;

/** A live access token for the connection, refreshed if it is about to lapse; null when Google refuses. */
export async function accessTokenFor(admin: Admin, conn: ConnectionRow): Promise<string | null> {
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (conn.access_token && expiresAt - Date.now() > 60_000) return conn.access_token;

  const creds = calendarOAuthCredentials();
  if (!creds) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token: string; expires_in: number };
  const token_expires_at = new Date(Date.now() + json.expires_in * 1000).toISOString();
  await admin
    .from("google_calendar_connections")
    .update({ access_token: json.access_token, token_expires_at })
    .eq("id", conn.id);
  return json.access_token;
}

async function call(
  token: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const enc = encodeURIComponent;

export type ListResult =
  | { ok: true; items: GoogleEvent[]; nextSyncToken: string | null }
  | { ok: false; gone: boolean; status: number };

/**
 * Everything that changed since `syncToken`, or -- with none -- every
 * event from `timeMin` on. Pages until Google hands back the next
 * cursor. A 410 means the cursor is stale and the caller must start
 * over with a full read.
 */
export async function listChanges(
  token: string,
  calendarId: string,
  opts: { syncToken: string | null; timeMin: string }
): Promise<ListResult> {
  const items: GoogleEvent[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ maxResults: "250", showDeleted: "true", singleEvents: "true" });
    if (opts.syncToken) q.set("syncToken", opts.syncToken);
    else q.set("timeMin", opts.timeMin);
    if (pageToken) q.set("pageToken", pageToken);
    const { status, json } = await call(token, "GET", `/calendars/${enc(calendarId)}/events?${q}`);
    if (status === 410) return { ok: false, gone: true, status };
    if (status !== 200) return { ok: false, gone: false, status };
    const data = json as { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
    items.push(...(data.items ?? []));
    if (data.nextPageToken) {
      pageToken = data.nextPageToken;
      continue;
    }
    return { ok: true, items, nextSyncToken: data.nextSyncToken ?? null };
  }
  return { ok: false, gone: false, status: 0 };
}

export type WriteResult = { ok: true; event: GoogleEvent } | { ok: false; status: number; message: string };

function fail(status: number, json: unknown): WriteResult {
  const msg = (json as { error?: { message?: string } } | null)?.error?.message;
  return { ok: false, status, message: msg || `Google answered ${status}` };
}

export async function insertEvent(token: string, calendarId: string, body: GoogleEventBody): Promise<WriteResult> {
  const { status, json } = await call(token, "POST", `/calendars/${enc(calendarId)}/events`, body);
  return status === 200 ? { ok: true, event: json as GoogleEvent } : fail(status, json);
}

export async function patchEvent(
  token: string,
  calendarId: string,
  googleEventId: string,
  body: GoogleEventBody
): Promise<WriteResult> {
  const { status, json } = await call(
    token,
    "PATCH",
    `/calendars/${enc(calendarId)}/events/${enc(googleEventId)}`,
    body
  );
  return status === 200 ? { ok: true, event: json as GoogleEvent } : fail(status, json);
}

/** Gone already (404/410) counts as done: the point is that it is not there. */
export async function deleteEvent(token: string, calendarId: string, googleEventId: string): Promise<{ ok: boolean; status: number }> {
  const { status } = await call(token, "DELETE", `/calendars/${enc(calendarId)}/events/${enc(googleEventId)}`);
  return { ok: status === 204 || status === 404 || status === 410, status };
}

/** The signed-in Google account's address, for "connected as". */
export async function googleAccountEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { email?: string };
  return json.email ?? null;
}
