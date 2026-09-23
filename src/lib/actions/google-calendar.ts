"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { calendarOAuthCredentials, type ConnectionRow } from "@/lib/google-calendar/client";
import { syncConnection, type SyncSummary } from "@/lib/google-calendar/sync";

/**
 * The settings page's view of Google Calendar: the signed-in person's
 * own connection and, for Office/Admin, the company-wide one. Tokens
 * never leave the server -- only the address and the sync stamps do.
 */

export type CalendarTarget = "mine" | "company";

export type ConnectionInfo = {
  email: string | null;
  connectedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** How many appointments currently have a copy on this calendar. */
  linked: number;
};

export type GoogleCalendarStatus = {
  /** A client id and secret exist on the deployment. */
  configured: boolean;
  /** Migration 0173 has not been run: the tables are missing. */
  migrationMissing: boolean;
  canManageCompany: boolean;
  mine: ConnectionInfo | null;
  company: ConnectionInfo | null;
};

async function loadConnection(
  companyId: string,
  target: CalendarTarget,
  profileId: string
): Promise<{ row: ConnectionRow | null; missing: boolean }> {
  const admin = createAdminClient();
  let q = admin.from("google_calendar_connections").select("*").eq("company_id", companyId);
  q = target === "mine" ? q.eq("profile_id", profileId) : q.is("profile_id", null);
  const { data, error } = await q.maybeSingle();
  if (error) return { row: null, missing: /google_calendar_connections|schema cache/i.test(error.message) };
  return { row: (data as ConnectionRow | null) ?? null, missing: false };
}

async function infoFor(row: ConnectionRow): Promise<ConnectionInfo> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("google_calendar_links")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", row.id);
  return {
    email: row.google_email,
    connectedAt: row.connected_at,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    linked: count ?? 0,
  };
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  const profile = await getCurrentProfile();
  const empty: GoogleCalendarStatus = {
    configured: Boolean(calendarOAuthCredentials()),
    migrationMissing: false,
    canManageCompany: false,
    mine: null,
    company: null,
  };
  if (!profile) return empty;
  const canManageCompany = isAdminRole(profile);

  const mine = await loadConnection(profile.company_id, "mine", profile.id);
  if (mine.missing) return { ...empty, canManageCompany, migrationMissing: true };
  const company = canManageCompany
    ? await loadConnection(profile.company_id, "company", profile.id)
    : { row: null, missing: false };

  return {
    ...empty,
    canManageCompany,
    mine: mine.row ? await infoFor(mine.row) : null,
    company: company.row ? await infoFor(company.row) : null,
  };
}

async function guard(target: CalendarTarget) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." as string, profile: null };
  if (target === "company" && !isAdminRole(profile)) {
    return { error: "Only Office or Admin users can manage the company calendar.", profile: null };
  }
  return { error: undefined, profile };
}

/**
 * Forgets the connection. The copies already on the Google calendar are
 * left alone -- taking them down would need the token this is throwing
 * away, and a rep leaving may well want their history to stay put.
 */
export async function disconnectGoogleCalendar(target: CalendarTarget): Promise<{ error?: string }> {
  const { error, profile } = await guard(target);
  if (error || !profile) return { error };

  const admin = createAdminClient();
  let del = admin.from("google_calendar_connections").delete().eq("company_id", profile.company_id);
  del = target === "mine" ? del.eq("profile_id", profile.id) : del.is("profile_id", null);
  const { error: dbError } = await del;
  if (dbError) return { error: dbError.message };
  revalidatePath("/settings/google-calendar");
  return {};
}

/** The Sync now button: one full pull-and-push for this connection, right away. */
export async function syncGoogleCalendarNow(
  target: CalendarTarget
): Promise<{ error?: string; summary?: SyncSummary }> {
  const { error, profile } = await guard(target);
  if (error || !profile) return { error };

  const { row, missing } = await loadConnection(profile.company_id, target, profile.id);
  if (missing) return { error: "Google Calendar isn't set up in the database yet (migration 0173)." };
  if (!row) return { error: "Not connected." };

  const summary = await syncConnection(createAdminClient(), row);
  revalidatePath("/settings/google-calendar");
  revalidatePath("/calendar");
  revalidatePath("/schedule");
  return { summary };
}
