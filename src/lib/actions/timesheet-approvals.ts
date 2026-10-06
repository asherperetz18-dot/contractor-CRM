"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyZone } from "@/lib/data/company-today";
import { getCompanyMembers } from "@/lib/data/company";
import { isAdminRole } from "@/lib/data/types";
import { readTimeClockSettings } from "@/lib/data/time-clock";
import { weekDays, weekSummary, type PunchRow } from "@/lib/time-clock/hours";
import { approvalBlocker, reopenBlocker, weekPeriod } from "@/lib/time-clock/approval";
import { isMissingSchemaError } from "@/lib/schema-drift";

/**
 * Approving a week on Timesheets (DECISIONS #157). Office or Admin signs
 * off each person's week once it is over; the database then refuses any
 * change to its punches (0212). Approving several at once approves the
 * ones that can be and says why the rest can't.
 */

const NEEDS_0212 = "Week approval needs a database update first: run 0212_timesheet_approvals.sql in Supabase.";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function approveWeek(input: {
  /** Any day in the week. */
  week: string;
  /** Whose weeks. */
  profileIds: string[];
}): Promise<{ error?: string; approved?: number; skipped?: string[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can approve hours." };
  if (!DAY.test(input.week)) return { error: "Pick a week." };
  const ids = [...new Set(input.profileIds)];
  if (!ids.length) return { error: "Nobody to approve." };

  const companyId = profile.company_id;
  const zone = await getCompanyZone();
  const days = weekDays(input.week);
  const period = weekPeriod(days, zone);
  const now = new Date();
  const admin = createAdminClient();

  const [settings, members, { data: punchData, error: punchError }, { data: live, error: liveError }] = await Promise.all([
    readTimeClockSettings(admin, companyId),
    getCompanyMembers(companyId),
    admin
      .from("time_punches")
      .select("id, profile_id, clock_in, clock_out, end_reason")
      .eq("company_id", companyId)
      .in("profile_id", ids)
      .gte("clock_in", period.start)
      .lt("clock_in", period.end)
      .order("id"),
    admin
      .from("timesheet_approvals")
      .select("profile_id")
      .eq("company_id", companyId)
      .eq("week_start", days[0])
      .is("reopened_at", null)
      .returns<{ profile_id: string }[]>(),
  ]);
  if (punchError) return { error: punchError.message };
  if (liveError) return { error: isMissingSchemaError(liveError) ? NEEDS_0212 : liveError.message };

  const summary = weekSummary((punchData as PunchRow[] | null) ?? [], days, zone, now, settings.overtime_weekly_hours);
  const already = new Set((live ?? []).map((r) => r.profile_id));
  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m?.name || m?.email || "Someone";
  };
  const isAdmin = profile.roles.includes("Admin");

  let approved = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    // Only people in this company, with hours this week.
    const row = summary.get(id);
    if (!row || !members.some((m) => m.id === id)) continue;
    if (already.has(id)) continue;
    const why = approvalBlocker({ periodEnd: period.end, now, open: row.open, isSelf: id === profile.id, isAdmin });
    if (why) {
      skipped.push(`${nameOf(id)}: ${why}`);
      continue;
    }
    const { error } = await admin.from("timesheet_approvals").insert({
      company_id: companyId,
      profile_id: id,
      week_start: days[0],
      period_start: period.start,
      period_end: period.end,
      total_minutes: row.totalMinutes,
      overtime_minutes: row.overtimeMinutes,
      approved_by: profile.id,
    });
    // Someone else approved it a moment ago: it's approved either way.
    if (error && error.code !== "23505") {
      if (isMissingSchemaError(error)) return { error: NEEDS_0212 };
      skipped.push(`${nameOf(id)}: ${error.message}`);
      continue;
    }
    if (!error) approved += 1;
  }

  revalidatePath("/timesheets");
  return { approved, skipped };
}

export async function reopenWeek(input: {
  week: string;
  profileId: string;
  reason: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can reopen a week." };
  if (!DAY.test(input.week)) return { error: "Pick a week." };
  const why = reopenBlocker({
    reason: input.reason,
    isSelf: input.profileId === profile.id,
    isAdmin: profile.roles.includes("Admin"),
  });
  if (why) return { error: why };

  const days = weekDays(input.week);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("timesheet_approvals")
    .update({ reopened_at: new Date().toISOString(), reopened_by: profile.id, reopen_reason: input.reason.trim() })
    .eq("company_id", profile.company_id)
    .eq("profile_id", input.profileId)
    .eq("week_start", days[0])
    .is("reopened_at", null)
    .select("id");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0212 : error.message };
  if (!data?.length) return { error: "That week isn't approved." };

  revalidatePath("/timesheets");
  return { ok: true };
}
