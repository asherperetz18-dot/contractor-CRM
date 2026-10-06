/**
 * The dates the Calendar loads at once (DECISIONS #142): one month --
 * the one in the address, `?month=YYYY-MM` -- plus a week either side.
 *
 * The month grid draws up to six days of the months around it, and a
 * week can start in one month and end in the next, so the extra week
 * each way means whatever the month, week or day view shows for a day
 * in that month is already loaded. Pure, so the page and the tests
 * share it.
 */

export type CalendarRange = { from: string; to: string };

const PAD_DAYS = 7;

/** "YYYY-MM" from the address, or null when it isn't one. */
export function parseMonthParam(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

/** The "YYYY-MM" a "YYYY-MM-DD" date is in. */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function isoDay(year: number, monthIndex: number, day: number): string {
  // Through Date.UTC so day 0 and day -6 roll back into the month before,
  // and the year turns over, without the server's time zone in it.
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/** The dates loaded for a month: a week before its first day to a week after its last. */
export function monthRange(month: string): CalendarRange {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: isoDay(y, m - 1, 1 - PAD_DAYS),
    to: isoDay(y, m - 1, lastDay + PAD_DAYS),
  };
}

/** Whether a "YYYY-MM-DD" date falls inside the range. */
export function rangeCovers(range: CalendarRange, dateStr: string): boolean {
  return range.from <= dateStr && dateStr <= range.to;
}

/** A range from the browser, kept only when both ends are real dates in order. */
export function parseRange(value: unknown): CalendarRange | null {
  if (!value || typeof value !== "object") return null;
  const { from, to } = value as Record<string, unknown>;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof from !== "string" || typeof to !== "string" || !day.test(from) || !day.test(to) || from > to) return null;
  return { from, to };
}
