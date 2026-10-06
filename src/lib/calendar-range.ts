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

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The Week view's heading: "Oct 4 – 10, 2026", "Sep 27 – Oct 3, 2026",
 * "Dec 27, 2026 – Jan 2, 2027". Written out here rather than asked of
 * toLocaleDateString, which -- given only a day and a year for the end
 * of a week inside one month -- prints "2026 (day: 10)".
 */
export function weekRangeLabel(startIso: string, endIso: string): string {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const start = `${SHORT_MONTHS[sm - 1]} ${sd}`;
  if (sy !== ey) return `${start}, ${sy} – ${SHORT_MONTHS[em - 1]} ${ed}, ${ey}`;
  if (sm !== em) return `${start} – ${SHORT_MONTHS[em - 1]} ${ed}, ${ey}`;
  return `${start} – ${ed}, ${ey}`;
}
