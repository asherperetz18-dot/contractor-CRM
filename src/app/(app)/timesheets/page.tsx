import Link from "next/link";
import { AdminGate } from "@/components/admin-gate";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyZone } from "@/lib/data/company-today";
import { getCompanyMembers } from "@/lib/data/company";
import { readTimeClockSettings } from "@/lib/data/time-clock";
import { addDays, dayEndInZone, dayStartInZone, instantOfWallClock, isoDateInZone } from "@/lib/company-clock";
import { parseNaiveDateTime } from "@/lib/timezone";
import { punchMinutes, timesheetCsv, wallInputValue, weekDays, weekSummary, type PunchRow } from "@/lib/time-clock/hours";
import { appointmentAttendance } from "@/lib/time-clock/attendance";
import { describePunchChange, type PunchSnapshot } from "@/lib/time-clock/punch-changes";
import { TimesheetView, type TimesheetPerson } from "./timesheet-view";

export const dynamic = "force-dynamic";

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  return (
    <AdminGate>
      <Timesheets searchParams={searchParams} />
    </AdminGate>
  );
}

async function Timesheets({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const { week } = await searchParams;
  const zone = await getCompanyZone();
  const today = isoDateInZone(new Date(), zone);
  const days = weekDays(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today);
  const from = dayStartInZone(days[0], zone).toISOString();
  const to = dayEndInZone(days[6], zone).toISOString();
  const now = new Date();

  const supabase = await createClient();
  const companyId = profile.company_id;
  const [settings, members, { data: punchData, error }, { data: visitData }] = await Promise.all([
    readTimeClockSettings(supabase, companyId),
    getCompanyMembers(companyId),
    supabase
      .from("time_punches")
      .select("id, profile_id, clock_in, clock_out, end_reason")
      .eq("company_id", companyId)
      .gte("clock_in", from)
      .lte("clock_in", to)
      .order("clock_in", { ascending: true }),
    supabase
      .from("site_visits")
      .select("profile_id, event_id, arrived_at, left_at")
      .eq("company_id", companyId)
      .gte("arrived_at", from)
      .lte("arrived_at", to),
  ]);

  const toolbar = (
    <div className="module-toolbar">
      <div>
        <h1 className="module-title">Timesheets</h1>
        <p className="module-sub">
          Week of {days[0]} – {days[6]} · hours from the time clock, attendance from job arrivals
        </p>
      </div>
      <div className="chip-row">
        <Link className="btn-ghost" href={`/timesheets?week=${addDays(days[0], -7)}`}>
          ← Previous week
        </Link>
        <Link className="btn-ghost" href={`/timesheets?week=${addDays(days[0], 7)}`}>
          Next week →
        </Link>
      </div>
    </div>
  );
  if (error) {
    return (
      <>
        {toolbar}
        <p className="error-note">The time clock isn&apos;t set up yet — run migration 0174_time_clock.sql.</p>
      </>
    );
  }

  const punches = (punchData as PunchRow[] | null) ?? [];
  const visits =
    (visitData as { profile_id: string; event_id: string | null; arrived_at: string; left_at: string | null }[] | null) ?? [];
  const summary = weekSummary(punches, days, zone, now, settings.overtime_weekly_hours);
  const workerIds = [...summary.keys()];
  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m?.name || m?.email || "Unnamed";
  };

  // Attendance: this week's timed appointments for the people who worked.
  const { data: eventData } = workerIds.length
    ? await supabase
        .from("events")
        .select("id, date, time, assigned_to, second_assigned_to, status")
        .eq("company_id", companyId)
        .gte("date", days[0])
        .lte("date", days[6])
        .not("time", "is", null)
        .or(`assigned_to.in.(${workerIds.join(",")}),second_assigned_to.in.(${workerIds.join(",")})`)
    : { data: [] };
  type Ev = { id: string; date: string; time: string; assigned_to: string | null; second_assigned_to: string | null; status: string | null };
  const lateBy = new Map<string, { late: number; missed: number }>();
  for (const e of ((eventData as Ev[] | null) ?? []).filter((e) => !/cancel/i.test(e.status ?? ""))) {
    const start = instantOfWallClock(parseNaiveDateTime(e.date, e.time), zone);
    if (start > now) continue;
    for (const pid of [e.assigned_to, e.second_assigned_to]) {
      if (!pid || !summary.has(pid)) continue;
      const arrivals = visits.filter((v) => v.profile_id === pid && v.event_id === e.id).map((v) => v.arrived_at);
      const a = appointmentAttendance(start, arrivals, settings.late_after_min, now);
      const tally = lateBy.get(pid) ?? { late: 0, missed: 0 };
      if (a.status === "late") tally.late += 1;
      if (a.status === "missed") tally.missed += 1;
      lateBy.set(pid, tally);
    }
  }

  // The edit history, for Office/Admin only (this page's gate).
  const punchIds = punches.map((p) => p.id);
  const { data: changeData } = punchIds.length
    ? await supabase
        .from("time_punch_changes")
        .select("punch_id, changed_by, changed_at, reason, old_punch, new_punch")
        .in("punch_id", punchIds)
        .order("changed_at", { ascending: false })
    : { data: [] };
  type Change = { punch_id: string; changed_by: string | null; changed_at: string; reason: string; old_punch: PunchSnapshot; new_punch: PunchSnapshot };
  const changes = (changeData as Change[] | null) ?? [];

  const people: TimesheetPerson[] = workerIds
    .map((id) => {
      const row = summary.get(id)!;
      const onSite = visits
        .filter((v) => v.profile_id === id && v.event_id)
        .reduce((s, v) => s + punchMinutes({ id: "", profile_id: id, clock_in: v.arrived_at, clock_out: v.left_at, end_reason: null }, now), 0);
      return {
        id,
        name: nameOf(id),
        minutesByDay: row.minutesByDay,
        totalMinutes: row.totalMinutes,
        overtimeMinutes: row.overtimeMinutes,
        onSiteMinutes: onSite,
        autoClosed: row.autoClosed,
        open: row.open,
        edited: changes.some((c) => punches.find((p) => p.id === c.punch_id)?.profile_id === id),
        late: lateBy.get(id)?.late ?? 0,
        missed: lateBy.get(id)?.missed ?? 0,
        punches: punches
          .filter((p) => p.profile_id === id)
          .map((p) => ({
            id: p.id,
            clockIn: wallInputValue(p.clock_in, zone),
            clockOut: p.clock_out ? wallInputValue(p.clock_out, zone) : "",
            endReason: p.end_reason,
            minutes: punchMinutes(p, now),
            history: changes
              .filter((c) => c.punch_id === p.id)
              .map((c) => ({
                when: new Date(c.changed_at).toLocaleString("en-US", { timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
                who: c.changed_by ? nameOf(c.changed_by) : "System",
                reason: c.reason,
                lines: describePunchChange(c.old_punch, c.new_punch, zone),
              })),
          })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      {toolbar}
      <TimesheetView
        days={days}
        people={people}
        csv={timesheetCsv(summary, days, nameOf)}
        overtimeHours={settings.overtime_weekly_hours}
      />
    </>
  );
}
