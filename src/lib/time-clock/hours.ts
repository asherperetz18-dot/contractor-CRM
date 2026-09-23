// Hours from time punches: what payroll reads. A shift with a break is
// two punches (the first ends with end_reason "break"), so summing
// punches leaves the break unpaid without any break arithmetic.
import { addDays, isoDateInZone, wallClockIn } from "../company-clock.ts";

export type PunchRow = {
  id: string;
  profile_id: string;
  clock_in: string;
  clock_out: string | null;
  end_reason: "clock_out" | "break" | "auto" | null;
};

export type ShiftState = "off" | "on" | "break";

export type WeekRow = {
  minutesByDay: Record<string, number>;
  totalMinutes: number;
  overtimeMinutes: number;
  autoClosed: number;
  open: boolean;
};

// A break older than this isn't a break any more -- they went home
// without clocking back in (the punch already ended, so no hours leak).
const BREAK_STALE_MS = 4 * 60 * 60 * 1000;

export function punchMinutes(p: PunchRow, now: Date): number {
  const end = p.clock_out ? new Date(p.clock_out) : now;
  return Math.max(0, Math.round((end.getTime() - new Date(p.clock_in).getTime()) / 60000));
}

// One person's state from their punches (any order).
export function shiftState(punches: PunchRow[], now: Date): ShiftState {
  if (punches.length === 0) return "off";
  const latest = [...punches].sort((a, b) => b.clock_in.localeCompare(a.clock_in))[0];
  if (!latest.clock_out) return "on";
  if (latest.end_reason === "break" && now.getTime() - new Date(latest.clock_out).getTime() < BREAK_STALE_MS) {
    return "break";
  }
  return "off";
}

// Per person, minutes on each company-local day (filed on the day the
// punch started), the week's total and what's past the overtime line.
export function weekSummary(
  punches: PunchRow[],
  days: string[],
  ianaZone: string,
  now: Date,
  overtimeWeeklyHours: number
): Map<string, WeekRow> {
  const rows = new Map<string, WeekRow>();
  for (const p of punches) {
    const day = isoDateInZone(new Date(p.clock_in), ianaZone);
    if (!days.includes(day)) continue;
    let row = rows.get(p.profile_id);
    if (!row) {
      row = {
        minutesByDay: Object.fromEntries(days.map((d) => [d, 0])),
        totalMinutes: 0,
        overtimeMinutes: 0,
        autoClosed: 0,
        open: false,
      };
      rows.set(p.profile_id, row);
    }
    const mins = punchMinutes(p, now);
    row.minutesByDay[day] += mins;
    row.totalMinutes += mins;
    if (p.end_reason === "auto") row.autoClosed += 1;
    if (!p.clock_out) row.open = true;
  }
  for (const row of rows.values()) {
    row.overtimeMinutes = Math.max(0, row.totalMinutes - overtimeWeeklyHours * 60);
  }
  return rows;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const hours = (mins: number) => (mins / 60).toFixed(2);

export function timesheetCsv(
  summary: Map<string, WeekRow>,
  days: string[],
  nameOf: (profileId: string) => string
): string {
  const lines = [["Person", ...days, "Total hours", "Overtime hours", "Auto clock-outs"].join(",")];
  const people = [...summary.entries()].sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b)));
  for (const [id, row] of people) {
    lines.push(
      [
        csvCell(nameOf(id)),
        ...days.map((d) => hours(row.minutesByDay[d] ?? 0)),
        hours(row.totalMinutes),
        hours(row.overtimeMinutes),
        String(row.autoClosed),
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

// Monday..Sunday of the week holding `isoDay`.
export function weekDays(isoDay: string): string[] {
  const dow = new Date(`${isoDay}T00:00:00Z`).getUTCDay();
  const monday = addDays(isoDay, -((dow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// "YYYY-MM-DDTHH:mm" for a datetime-local input, on the company's clock.
export function wallInputValue(iso: string, ianaZone: string): string {
  const w = wallClockIn(new Date(iso), ianaZone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}`;
}
