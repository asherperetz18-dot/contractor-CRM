"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyZone } from "@/lib/data/company-today";
import { isAdminRole } from "@/lib/data/types";
import { closeOpenVisit, readTimeClockSettings } from "@/lib/data/time-clock";
import { parseSettingsInput, usesTimeClock, type SettingsInput } from "@/lib/time-clock/settings";
import { punchChanged, type PunchSnapshot } from "@/lib/time-clock/punch-changes";
import { instantOfWallClock } from "@/lib/company-clock";

type Result = { error?: string; ok?: boolean };
type Fix = { lat: number; lng: number } | null;

const MIGRATION_HINT = "The time clock isn't set up yet — migration 0174_time_clock.sql needs to be run.";

function validFix(fix: Fix): Fix {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
  if (Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) return null;
  return fix;
}

export async function acceptTrackingNotice(): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tracking_notices")
    .upsert({ company_id: profile.company_id, profile_id: profile.id }, { ignoreDuplicates: true });
  if (error) return { error: MIGRATION_HINT };
  revalidatePath("/time-clock");
  return { ok: true };
}

export async function clockIn(fix: Fix): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const supabase = await createClient();
  const settings = await readTimeClockSettings(supabase, profile.company_id);
  if (!usesTimeClock(profile.roles, settings)) return { error: "Your role doesn't use the time clock." };

  const { data: notice } = await supabase
    .from("tracking_notices")
    .select("accepted_at")
    .eq("company_id", profile.company_id)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!notice) return { error: "Please read and accept the location notice first." };

  const at = validFix(fix);
  const { error } = await supabase.from("time_punches").insert({
    company_id: profile.company_id,
    profile_id: profile.id,
    clock_in: new Date().toISOString(),
    in_lat: at?.lat ?? null,
    in_lng: at?.lng ?? null,
  });
  if (error) {
    // The one-open-punch index is what refuses a double tap.
    if (error.code === "23505") return { error: "You're already clocked in." };
    return { error: error.message };
  }
  revalidatePath("/time-clock");
  return { ok: true };
}

async function endOpenPunch(reason: "clock_out" | "break", fix: Fix): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const at = validFix(fix);
  const { data, error } = await supabase
    .from("time_punches")
    .update({ clock_out: now, end_reason: reason, out_lat: at?.lat ?? null, out_lng: at?.lng ?? null })
    .eq("company_id", profile.company_id)
    .eq("profile_id", profile.id)
    .is("clock_out", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You're not clocked in." };
  // Off the clock means not at a job either; tracking stops with it.
  await closeOpenVisit(createAdminClient(), profile.company_id, profile.id, now);
  revalidatePath("/time-clock");
  return { ok: true };
}

export async function startBreak(fix: Fix): Promise<Result> {
  return endOpenPunch("break", fix);
}

export async function clockOut(fix: Fix): Promise<Result> {
  return endOpenPunch("clock_out", fix);
}

export async function saveTimeClockSettings(input: SettingsInput): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can do that." };
  const parsed = parseSettingsInput(input);
  if ("error" in parsed) return parsed;
  const supabase = await createClient();
  const { error } = await supabase.from("time_clock_settings").upsert({
    company_id: profile.company_id,
    ...parsed.settings,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  });
  if (error) return { error: error.code === "42P01" ? MIGRATION_HINT : error.message };
  revalidatePath("/settings/time-clock");
  return { ok: true };
}

// "YYYY-MM-DDTHH:mm" on the company's wall clock -> ISO instant.
function wallToIso(value: string, zone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return instantOfWallClock(new Date(`${value}:00.000Z`), zone).toISOString();
}

// An office correction to someone's hours. Recorded in the append-only
// time_punch_changes trail -- this is payroll.
export async function correctPunch(input: {
  punchId: string;
  clockIn: string;
  clockOut: string;
  reason: string;
}): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change hours." };
  const reason = input.reason.trim();
  if (reason.length < 3) return { error: "Say why the hours are changing — it goes in the history." };

  const zone = await getCompanyZone();
  const clockInIso = wallToIso(input.clockIn, zone);
  const clockOutIso = input.clockOut ? wallToIso(input.clockOut, zone) : null;
  if (!clockInIso || (input.clockOut && !clockOutIso)) return { error: "Enter a date and time." };
  if (clockOutIso && clockOutIso < clockInIso) return { error: "Clock-out can't be before clock-in." };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("time_punches")
    .select("clock_in, clock_out, end_reason")
    .eq("id", input.punchId)
    .eq("company_id", profile.company_id)
    .maybeSingle<PunchSnapshot>();
  if (!before) return { error: "That punch wasn't found." };

  const after: PunchSnapshot = {
    clock_in: clockInIso,
    clock_out: clockOutIso,
    end_reason: clockOutIso ? (before.clock_out ? before.end_reason : "clock_out") : null,
  };
  if (!punchChanged(before, after)) return { ok: true };

  const { data: updated, error } = await supabase
    .from("time_punches")
    .update(after)
    .eq("id", input.punchId)
    .eq("company_id", profile.company_id)
    .select("id");
  if (error) return { error: error.code === "23505" ? "They already have another open punch." : error.message };
  if (!updated?.length) return { error: "Couldn't change that punch." };

  const { error: auditError } = await supabase.from("time_punch_changes").insert({
    company_id: profile.company_id,
    punch_id: input.punchId,
    changed_by: profile.id,
    reason,
    old_punch: before,
    new_punch: after,
  });
  revalidatePath("/timesheets");
  if (auditError) return { error: "Saved, but recording it in the history failed." };
  return { ok: true };
}
