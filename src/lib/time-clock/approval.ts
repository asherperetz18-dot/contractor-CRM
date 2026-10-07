// Week approval (DECISIONS #157): the office signs off a person's week
// once it is over, and from then on its hours can't change -- what goes
// to payroll is the week that was approved. The lock itself is in the
// database (0212, time_punches_week_lock); these are the rules the
// screens and actions say out loud.
import { addDays, dayStartInZone } from "../company-clock.ts";
import { weekDays, weekSummary, type PunchRow } from "./hours.ts";

/** Monday 00:00 to the next Monday 00:00 on the company's clock, as
 *  instants: the stretch an approval locks (end not included). */
export function weekPeriod(days: string[], ianaZone: string): { start: string; end: string } {
  return {
    start: dayStartInZone(days[0], ianaZone).toISOString(),
    end: dayStartInZone(addDays(days[6], 1), ianaZone).toISOString(),
  };
}

const OWN_WEEK = "You can't approve or reopen your own week. An Admin can.";

/** Why this person's week can't be approved yet, or null when it can. */
export function approvalBlocker(input: {
  periodEnd: string;
  now: Date;
  /** They have a punch in the week that's still open. */
  open: boolean;
  /** The person approving is the person whose week it is. */
  isSelf: boolean;
  isAdmin: boolean;
}): string | null {
  if (input.now.getTime() < new Date(input.periodEnd).getTime()) {
    return "This week isn't over yet. Approve it once Sunday has passed.";
  }
  if (input.open) return "They're still clocked in on a punch this week. Fix the open punch first.";
  if (input.isSelf && !input.isAdmin) return OWN_WEEK;
  return null;
}

/** Why an approved week can't be reopened, or null when it can. */
export function reopenBlocker(input: { reason: string; isSelf: boolean; isAdmin: boolean }): string | null {
  if (input.reason.trim().length < 3) return "Say why the week is being reopened — it's kept on record.";
  if (input.isSelf && !input.isAdmin) return OWN_WEEK;
  return null;
}

/** One row of timesheet_approvals, as a person's own weeks need it. */
export type WeekApprovalRow = {
  week_start: string;
  approved_by: string | null;
  approved_at: string;
  total_minutes: number;
  overtime_minutes: number;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
};

export type MyWeekStatus =
  | { kind: "this-week" }
  | { kind: "approved"; by: string | null; at: string }
  | { kind: "reopened"; by: string | null; at: string; reason: string }
  | { kind: "waiting" }
  | { kind: "no-hours" };

export type MyWeek = { days: string[]; totalMinutes: number; overtimeMinutes: number; status: MyWeekStatus };

/**
 * A person's own weeks for the Time Clock page: this week and the `past`
 * weeks before it, newest first. An approved week carries the hours as
 * approved; any other week, the hours its punches add up to now. A week
 * whose approval was reopened reads reopened until it's approved again.
 */
export function myRecentWeeks(input: {
  profileId: string;
  /** Today on the company's calendar. */
  today: string;
  zone: string;
  now: Date;
  past: number;
  punches: PunchRow[];
  approvals: WeekApprovalRow[];
  overtimeWeeklyHours: number;
}): MyWeek[] {
  const thisMonday = weekDays(input.today)[0];
  const weeks: MyWeek[] = [];
  for (let i = 0; i <= input.past; i++) {
    const days = weekDays(addDays(thisMonday, -7 * i));
    const row = weekSummary(input.punches, days, input.zone, input.now, input.overtimeWeeklyHours).get(input.profileId);
    const mine = input.approvals.filter((a) => a.week_start === days[0]);
    const live = mine.find((a) => !a.reopened_at);
    const reopened = mine
      .filter((a) => a.reopened_at)
      .sort((a, b) => b.reopened_at!.localeCompare(a.reopened_at!))[0];
    const totalMinutes = row?.totalMinutes ?? 0;
    const overtimeMinutes = row?.overtimeMinutes ?? 0;
    if (live) {
      weeks.push({
        days,
        totalMinutes: live.total_minutes,
        overtimeMinutes: live.overtime_minutes,
        status: { kind: "approved", by: live.approved_by, at: live.approved_at },
      });
      continue;
    }
    const status: MyWeekStatus = reopened
      ? { kind: "reopened", by: reopened.reopened_by, at: reopened.reopened_at!, reason: reopened.reopen_reason ?? "" }
      : i === 0
        ? { kind: "this-week" }
        : row
          ? { kind: "waiting" }
          : { kind: "no-hours" };
    weeks.push({ days, totalMinutes, overtimeMinutes, status });
  }
  return weeks;
}

/** Show the list once the office approves this person's weeks: before
 *  that, every week would just read "Not approved yet". */
export function showMyWeeks(weeks: MyWeek[]): boolean {
  return weeks.some((w) => w.status.kind === "approved" || w.status.kind === "reopened");
}

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

function duration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
}

/** One week's line, in the words the person reads. */
export function myWeekLine(
  week: MyWeek,
  nameOf: (id: string | null) => string,
  dateOf: (iso: string) => string
): { label: string; hours: string | null; note: string; tone: "good" | "warn" | "soft" } {
  const s = week.status;
  const label = s.kind === "this-week" ? "This week" : `${dayLabel(week.days[0])} – ${dayLabel(week.days[6])}`;
  const hours = week.totalMinutes
    ? duration(week.totalMinutes) +
      (week.overtimeMinutes ? ` · ${duration(week.overtimeMinutes)} overtime` : "") +
      (s.kind === "this-week" ? " so far" : "")
    : null;
  switch (s.kind) {
    case "approved":
      return {
        label,
        hours,
        note: `Approved by ${nameOf(s.by)} · ${dateOf(s.at)}. These hours are locked for payroll.`,
        tone: "good",
      };
    case "reopened":
      return {
        label,
        hours,
        note: `Reopened by ${nameOf(s.by)} · ${dateOf(s.at)}: “${s.reason}”. Waiting to be approved again.`,
        tone: "warn",
      };
    case "waiting":
      return { label, hours, note: "Not approved yet.", tone: "soft" };
    case "this-week":
      return { label, hours, note: "Can be approved once Sunday has passed.", tone: "soft" };
    default:
      return { label, hours, note: "No hours.", tone: "soft" };
  }
}
