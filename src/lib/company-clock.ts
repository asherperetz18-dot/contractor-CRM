/**
 * The company's own calendar, for server code.
 *
 * Vercel's clock is UTC. A bare `new Date().toISOString().slice(0, 10)` on
 * the server says tomorrow from 5pm Pacific on, so a task due today read
 * as overdue after dinner, "today's appointments" moved a day, and an
 * evening signature landed in the next day's report. Every "what day is
 * it" on the server goes through here with the company's zone
 * (`company_profile.timezone` -> `companyIanaZone`), never the machine's.
 *
 * Pure and dependency-free so it runs under node:test; the server-side
 * wrappers that know which company is asking live in
 * `src/lib/data/company-today.ts`.
 */

export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** What the clock on the wall reads in `ianaZone` at `instant`. */
export function wallClockIn(instant: Date, ianaZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Some ICU builds print midnight as "24" under h23; keep it a clock hour.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" on the wall clock of `ianaZone` at `instant`. */
export function isoDateInZone(instant: Date, ianaZone: string): string {
  const w = wallClockIn(instant, ianaZone);
  return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
}

/** `days` after a plain YYYY-MM-DD, as plain calendar arithmetic. */
export function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * A Date whose LOCAL getters read the zone's wall clock.
 *
 * For helpers written against local time -- `isoDay`, `presetWindow`,
 * `resolveWindow` in data/date-range, and the dashboard's week and month
 * bounds -- which are right in the browser and wrong on a UTC server.
 * Only its calendar getters mean anything: getTime() is not the real
 * instant, so never subtract hours from it.
 */
export function localClockIn(instant: Date, ianaZone: string): Date {
  const w = wallClockIn(instant, ianaZone);
  return new Date(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/**
 * A Date whose UTC getters read the zone's wall clock -- the naive-as-UTC
 * encoding the reminder crons compare directly against stored `date` +
 * `time` values (see `parseNaiveDateTime` in lib/timezone). Same caveat
 * as localClockIn: a calendar, not an instant.
 */
export function utcClockIn(instant: Date, ianaZone: string): Date {
  const w = wallClockIn(instant, ianaZone);
  return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Sep 20, 2026" / "September 20, 2026" for a document or report.
 *
 * A plain YYYY-MM-DD is a date, not midnight somewhere, and prints as
 * itself. A timestamp prints on the calendar of `ianaZone`, so a
 * signature at 7:30 PM in Los Angeles reads as that day and not as the
 * UTC tomorrow. "—" when there is nothing to print.
 */
export function dayLabel(
  value: string | null | undefined,
  ianaZone: string,
  style: "short" | "long"
): string {
  if (!value) return "—";
  const plain = PLAIN_DATE.test(value);
  const d = new Date(plain ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: plain ? "UTC" : ianaZone,
    month: style,
    day: "numeric",
    year: "numeric",
  });
}
