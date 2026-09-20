/**
 * The shared date window used by every report filter.
 *
 * Every reporting page had grown its own "last 30 days" cutoff, and they
 * did not agree: some compared a timestamp against an ISO instant, some
 * counted whole days elapsed, some ran to today and some to the end of
 * time. Two pages showing different numbers for the same period is the
 * kind of thing that gets a report distrusted entirely, so the comparison
 * lives in one place.
 */

/**
 * The period, as two open-ended edges rather than one cutoff.
 *
 * The presets only ever needed a start -- "last 30 days" runs to today by
 * definition. A custom range needs both, and half a window cannot express
 * "March only". Both edges are inclusive, and both are plain YYYY-MM-DD.
 */
export type DateWindow = { from: string | null; to: string | null };

/** A window that excludes nothing. */
export const ALL_TIME: DateWindow = { from: null, to: null };

/**
 * Whether a date falls in the window.
 *
 * Compared on the first ten characters so a timestamp and a plain date
 * behave the same. signed_at is "2026-08-14T22:13:43Z" while an event's
 * date is "2026-08-14"; comparing them whole drops everything recorded on
 * the final day of a range, because the timestamp sorts after the bare
 * date. That failure is invisible -- the report is simply a little short.
 */
export function withinWindow(value: string | null | undefined, w: DateWindow): boolean {
  if (!value) return false;
  const d = value.slice(0, 10);
  if (w.from && d < w.from) return false;
  if (w.to && d > w.to) return false;
  return true;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * A preset key ("7", "30", "90", "all", "today") as a window.
 *
 * Anything unrecognised is all time rather than an exception: a filter is
 * not worth crashing a report over, and showing everything is the reading
 * least likely to be mistaken for a real answer.
 */
export function presetWindow(preset: string, now: Date = new Date()): DateWindow {
  if (preset === "all") return ALL_TIME;
  if (preset === "today") return { from: isoDay(now), to: null };
  // Calendar presets: the dashboard asks "how is this month going",
  // which day-count presets cannot express.
  if (preset === "month")
    return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: null };
  if (preset === "quarter")
    return {
      from: isoDay(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)),
      to: null,
    };
  if (preset === "12m")
    return { from: isoDay(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to: null };
  const days = Number(preset);
  if (!Number.isFinite(days) || days <= 0) return ALL_TIME;
  return { from: isoDay(new Date(now.getTime() - days * 86400000)), to: null };
}

/** The first of the current month through today -- the custom starting point. */
export function monthToDate(now: Date = new Date()): { from: string; to: string } {
  const today = isoDay(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * The window a filter's current state actually describes.
 *
 * Custom dates win over the preset. They cannot both apply, and the dates
 * are the ones the user typed.
 */
export function resolveWindow(
  state: { preset: string; from: string; to: string },
  now: Date = new Date()
): DateWindow {
  if (state.from || state.to) return { from: state.from || null, to: state.to || null };
  return presetWindow(state.preset, now);
}

/**
 * The comparison period a delta is measured against.
 *
 * A month-to-date window compares to the same span of last month --
 * "vs August" on September 20th means August 1-20, because that is the
 * comparison a person makes in their head. Every other window compares
 * to the equal-length span immediately before it. All time has no
 * previous period, so a delta is simply not offered there.
 */
export function prevWindow(
  win: DateWindow,
  now: Date = new Date()
): { from: string; to: string } | null {
  if (!win.from) return null;
  const parse = (day: string) => new Date(`${day}T00:00:00`);
  const from = parse(win.from);
  const today = isoDay(now);
  // The effective end never runs past today: "this month" is the month
  // so far, and its comparison span must be equally long.
  const toStr = win.to && win.to < today ? win.to : today;
  const to = parse(toStr);

  const monthToDateShape =
    win.from.slice(8) === "01" && !win.to && toStr.slice(0, 7) === win.from.slice(0, 7);
  if (monthToDateShape) {
    const prevFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1);
    // The day clamps to the previous month's length: there is no Feb 31.
    const lastOfPrev = new Date(from.getFullYear(), from.getMonth(), 0).getDate();
    const prevTo = new Date(
      prevFrom.getFullYear(),
      prevFrom.getMonth(),
      Math.min(to.getDate(), lastOfPrev)
    );
    return { from: isoDay(prevFrom), to: isoDay(prevTo) };
  }

  // Length via rounded ms (DST makes a "day" 23 or 25 hours once a
  // year), then date-component arithmetic so no edge drifts an hour
  // into the wrong calendar day.
  const len = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const prevTo = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  const prevFrom = new Date(
    prevTo.getFullYear(),
    prevTo.getMonth(),
    prevTo.getDate() - (len - 1)
  );
  return { from: isoDay(prevFrom), to: isoDay(prevTo) };
}

function longDate(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * The period in words, for a heading or a printed document.
 *
 * A custom range prints its real dates rather than the word "Custom".
 * On a sheet filed away and read six months later, "Custom" tells the
 * reader nothing at all about what they are looking at.
 */
export function describeWindow(
  state: { preset: string; from: string; to: string },
  labels: Record<string, string>
): string {
  if (state.from && state.to) return `${longDate(state.from)} – ${longDate(state.to)}`;
  if (state.from) return `From ${longDate(state.from)}`;
  if (state.to) return `Up to ${longDate(state.to)}`;
  return labels[state.preset] ?? "All time";
}
