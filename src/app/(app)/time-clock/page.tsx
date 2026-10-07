import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyZone } from "@/lib/data/company-today";
import { getCompanyMembers } from "@/lib/data/company";
import { appointmentsForToday, readTimeClockSettings } from "@/lib/data/time-clock";
import { addDays, dayStartInZone, isoDateInZone } from "@/lib/company-clock";
import { shiftState, weekDays, type PunchRow } from "@/lib/time-clock/hours";
import { myRecentWeeks, myWeekLine, showMyWeeks, type WeekApprovalRow } from "@/lib/time-clock/approval";
import { usesTimeClock } from "@/lib/time-clock/settings";
import { TimeClockView, type PunchStampRow, type VisitRow, type WeekLine } from "./time-clock-view";

/** Finished weeks listed under "Your weeks", besides this one. */
const PAST_WEEKS = 4;

export const dynamic = "force-dynamic";

export default async function TimeClockPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const zone = await getCompanyZone();
  const settings = await readTimeClockSettings(supabase, profile.company_id);
  const today = isoDateInZone(new Date(), zone);
  const dayStart = dayStartInZone(today, zone).toISOString();
  // The Monday that starts the oldest week under "Your weeks".
  const firstMonday = addDays(weekDays(today)[0], -7 * PAST_WEEKS);

  const [{ data: punches, error }, { data: visits }, { data: notice }, appts, weeks] = await Promise.all([
    supabase
      .from("time_punches")
      .select("id, profile_id, clock_in, clock_out, end_reason")
      .eq("company_id", profile.company_id)
      .eq("profile_id", profile.id)
      .or(`clock_in.gte.${dayStart},clock_out.is.null,clock_out.gte.${dayStart}`)
      .order("clock_in", { ascending: true }),
    supabase
      .from("site_visits")
      .select("id, label, arrived_at, left_at")
      .eq("company_id", profile.company_id)
      .eq("profile_id", profile.id)
      .gte("arrived_at", dayStart)
      .order("arrived_at", { ascending: true }),
    supabase
      .from("tracking_notices")
      .select("accepted_at")
      .eq("company_id", profile.company_id)
      .eq("profile_id", profile.id)
      .maybeSingle(),
    appointmentsForToday(supabase, profile.company_id, [profile.id], zone),
    myWeeks(supabase, profile.id, profile.company_id, today, firstMonday, zone, settings.overtime_weekly_hours),
  ]);

  const rows = (punches as PunchRow[] | null) ?? [];
  // Where each punch was checked (0185). A query of its own, so before
  // that migration runs it just comes back empty and the page carries on.
  const { data: stamps } = rows.length
    ? await supabase
        .from("time_punches")
        .select("id, in_check, in_place, in_distance_m, out_check, out_place, out_distance_m")
        .eq("company_id", profile.company_id)
        .in("id", rows.map((r) => r.id))
    : { data: [] };
  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Time Clock</h1>
          <p className="module-sub">Clock in and out. Your location is shared only while you&apos;re on the clock.</p>
        </div>
      </div>
      {error ? (
        <p className="error-note">
          The time clock isn&apos;t set up yet — an admin needs to run migration 0174_time_clock.sql.
        </p>
      ) : (
        <TimeClockView
          zone={zone}
          usesClock={usesTimeClock(profile.roles, settings)}
          noticeAccepted={!!notice}
          state={shiftState(rows, new Date())}
          punches={rows}
          stamps={(stamps as PunchStampRow[] | null) ?? []}
          visits={(visits as VisitRow[] | null) ?? []}
          appointments={appts
            .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))
            .map((a) => ({ id: a.id, title: a.title, start: a.start?.toISOString() ?? null }))}
          weeks={weeks}
        />
      )}
    </>
  );
}

/**
 * This person's weeks, and whether the office approved each one
 * (DECISIONS #157). Their own approvals only -- the database lets a
 * person read just their own. Empty until the office approves one of
 * them, and before 0212 runs.
 */
async function myWeeks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
  companyId: string,
  today: string,
  firstMonday: string,
  zone: string,
  overtimeWeeklyHours: number
): Promise<WeekLine[]> {
  const { data: approvalData } = await supabase
    .from("timesheet_approvals")
    .select("week_start, approved_by, approved_at, total_minutes, overtime_minutes, reopened_by, reopened_at, reopen_reason")
    .eq("company_id", companyId)
    .eq("profile_id", profileId)
    .gte("week_start", firstMonday);
  const approvals = (approvalData as WeekApprovalRow[] | null) ?? [];
  if (!approvals.length) return [];

  const [{ data: punchData }, members] = await Promise.all([
    supabase
      .from("time_punches")
      .select("id, profile_id, clock_in, clock_out, end_reason")
      .eq("company_id", companyId)
      .eq("profile_id", profileId)
      .gte("clock_in", dayStartInZone(firstMonday, zone).toISOString()),
    getCompanyMembers(companyId),
  ]);
  const weeks = myRecentWeeks({
    profileId,
    today,
    zone,
    now: new Date(),
    past: PAST_WEEKS,
    punches: (punchData as PunchRow[] | null) ?? [],
    approvals,
    overtimeWeeklyHours,
  });
  if (!showMyWeeks(weeks)) return [];
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name || "the office";
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: zone, month: "short", day: "numeric" });
  return weeks.map((w) => myWeekLine(w, nameOf, dateOf));
}
