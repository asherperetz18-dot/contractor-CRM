"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyZone, zoneForCompany } from "@/lib/data/company-today";
import { isAdminRole, type AppRole } from "@/lib/data/types";
import { closeOpenVisit, readTimeClockSettings, zonesForToday } from "@/lib/data/time-clock";
import { parseSettingsInput, usesTimeClock, type SettingsInput, type TimeClockSettings } from "@/lib/time-clock/settings";
import { punchChanged, type PunchSnapshot } from "@/lib/time-clock/punch-changes";
import { clockStamp, type ClockStamp } from "@/lib/time-clock/geo";
import { awayDistance, clockCheckApplies, parseClockInReason, withDeadline } from "@/lib/time-clock/clock-in-check";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { instantOfWallClock } from "@/lib/company-clock";

type Result = { error?: string; ok?: boolean };
type Fix = { lat: number; lng: number; accuracy?: number | null } | null;

const MIGRATION_HINT = "The time clock isn't set up yet — migration 0174_time_clock.sql needs to be run.";

function validFix(fix: Fix): Fix {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
  if (Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) return null;
  const accuracy = Number(fix.accuracy);
  return { lat: fix.lat, lng: fix.lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null };
}

const NOT_REQUIRED: ClockStamp = { check: "not_required", place: null, distanceM: null };
// Past this, the clock-in goes ahead as if nothing were on the map.
const CHECK_BUDGET_MS = 5000;

// Where someone is against their places today (appointments, production
// jobs, the office), worked out here from the phone's location -- the
// phone never says which job it's at.
async function whereFor(
  profile: { id: string; company_id: string; roles: AppRole[] },
  settings: TimeClockSettings,
  fix: Fix
): Promise<ClockStamp> {
  if (!clockCheckApplies(profile.roles, settings)) return NOT_REQUIRED;
  if (!fix) return clockStamp(null, [], settings.zone_radius_m);
  const admin = createAdminClient();
  const lookup = zoneForCompany(admin, profile.company_id)
    .then((zone) => zonesForToday(admin, profile.company_id, profile.id, zone, settings))
    .then((zones) => clockStamp(fix, zones, settings.zone_radius_m));
  return withDeadline(lookup, CHECK_BUDGET_MS, clockStamp(fix, [], settings.zone_radius_m));
}

// The verdict goes on with the service role: for anyone else the 0185
// trigger clears or keeps it. Before 0185 the columns don't exist and
// this does nothing -- the punch itself is already saved, which is what
// matters.
async function stampPunch(companyId: string, punchId: string, columns: Record<string, string | number | null>) {
  await createAdminClient().from("time_punches").update(columns).eq("company_id", companyId).eq("id", punchId);
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

// What the worker answered when the check asked: a reason for clocking
// in away from their places, or "go ahead" without a location.
export type ClockInAnswer = { pick?: string; note?: string; withoutLocation?: boolean };

export type ClockInResult = Result & {
  needsReason?: { place: string; distance: string };
  needsLocation?: boolean;
};

export async function clockIn(fix: Fix, answer: ClockInAnswer = {}): Promise<ClockInResult> {
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
  const stamp = await whereFor(profile, settings, at);
  // "Ask" mode: away from every place, the worker says why (or cancels);
  // no location, they're told so and can go ahead anyway. Never a block.
  let reason: string | null = null;
  if (settings.clock_in_check === "ask" && stamp.check === "away") {
    const needsReason = { place: stamp.place ?? "your nearest job", distance: awayDistance(stamp.distanceM ?? 0) };
    if (answer.pick === undefined) return { needsReason };
    const parsed = parseClockInReason(answer.pick, answer.note ?? "");
    if ("error" in parsed) return { error: parsed.error, needsReason };
    reason = parsed.reason;
  }
  if (settings.clock_in_check === "ask" && stamp.check === "no_location" && !answer.withoutLocation) {
    return { needsLocation: true };
  }

  const { data, error } = await supabase
    .from("time_punches")
    .insert({
      company_id: profile.company_id,
      profile_id: profile.id,
      clock_in: new Date().toISOString(),
      in_lat: at?.lat ?? null,
      in_lng: at?.lng ?? null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    // The one-open-punch index is what refuses a double tap.
    if (error.code === "23505") return { error: "You're already clocked in." };
    return { error: error.message };
  }
  await stampPunch(profile.company_id, data.id, {
    in_check: stamp.check,
    in_place: stamp.place,
    in_distance_m: stamp.distanceM,
    in_reason: reason,
  });
  revalidatePath("/time-clock");
  return { ok: true };
}

// Clocking out or starting a break is never questioned or stopped; where
// it happened is only stamped.
async function endOpenPunch(reason: "clock_out" | "break", fix: Fix): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  const supabase = await createClient();
  const at = validFix(fix);
  const stamp = await whereFor(profile, await readTimeClockSettings(supabase, profile.company_id), at);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("time_punches")
    .update({ clock_out: now, end_reason: reason, out_lat: at?.lat ?? null, out_lng: at?.lng ?? null })
    .eq("company_id", profile.company_id)
    .eq("profile_id", profile.id)
    .is("clock_out", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You're not clocked in." };
  await stampPunch(profile.company_id, (data[0] as { id: string }).id, {
    out_check: stamp.check,
    out_place: stamp.place,
    out_distance_m: stamp.distanceM,
  });
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
  const row = {
    company_id: profile.company_id,
    ...parsed.settings,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  };
  let { error } = await supabase.from("time_clock_settings").upsert(row);
  // Before 0185 the clock-in check has no columns: save everything else.
  if (error && error.code !== "42P01" && isMissingSchemaError(error)) {
    const { clock_in_check: _mode, check_roles: _roles, ...rest } = row;
    ({ error } = await supabase.from("time_clock_settings").upsert(rest));
  }
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
