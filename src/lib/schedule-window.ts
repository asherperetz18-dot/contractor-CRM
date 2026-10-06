/**
 * Which appointments the Schedule loads (DECISIONS #143).
 *
 * The date range and rep ride in the address (`?range=past&rep=…`), and
 * the server loads only that window -- this page used to load every
 * appointment the company ever booked and filter in the browser. The
 * list still applies its own exact filter (`listWindow`) on the browser's
 * own "today"; the server only knows the UTC date, which can be a day
 * either side of it, so its window (`serverWindow`) is a day wider at
 * every edge that depends on today. History (Past, All) reads newest
 * first, a page at a time. Pure, so the page, the list and the tests
 * share it.
 */

export const SCHEDULE_RANGES = ["upcoming", "today", "tomorrow", "7d", "month", "past", "all", "custom"] as const;
export type ScheduleRange = (typeof SCHEDULE_RANGES)[number];

/** Appointments per page, and the most one window will show. */
export const SCHEDULE_PAGE = 200;
export const SCHEDULE_MAX = 800;

export type ScheduleQuery = {
  range: ScheduleRange;
  /** A custom range's ends; null for every other range. */
  from: string | null;
  to: string | null;
  /** One rep's appointments only (either seat); null for everyone. */
  rep: string | null;
  limit: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address's query, kept only where it is what it should be; the default otherwise. */
export function parseScheduleQuery(p: { range?: unknown; from?: unknown; to?: unknown; rep?: unknown; limit?: unknown }): ScheduleQuery {
  const range = (SCHEDULE_RANGES as readonly unknown[]).includes(p.range) ? (p.range as ScheduleRange) : "upcoming";
  const day = (v: unknown) => (range === "custom" && typeof v === "string" && DAY.test(v) ? v : null);
  const n = Math.floor(Number(p.limit));
  return {
    range,
    from: day(p.from),
    to: day(p.to),
    rep: typeof p.rep === "string" && UUID.test(p.rep) ? p.rep : null,
    limit: Number.isFinite(n) ? Math.min(Math.max(n, SCHEDULE_PAGE), SCHEDULE_MAX) : SCHEDULE_PAGE,
  };
}

/** The query for the address: "" for the default, else "?…" with only what differs. */
export function scheduleQueryString(q: ScheduleQuery): string {
  const params = new URLSearchParams();
  if (q.range !== "upcoming") params.set("range", q.range);
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  if (q.rep) params.set("rep", q.rep);
  if (q.limit !== SCHEDULE_PAGE) params.set("limit", String(q.limit));
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** A "YYYY-MM-DD" date moved by whole days, without any time zone in it. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function monthEnd(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * History reads newest first -- "what happened lately", not a scroll back
 * to the oldest appointment. So does a custom range with no start date
 * yet: it is open at the old end too, and read oldest first a page at a
 * time it would show the company's first appointments ever.
 */
export function newestFirst(range: ScheduleRange, from: string | null): boolean {
  return range === "past" || range === "all" || (range === "custom" && !from);
}

/** The list's exact window on the browser's own "today" (inclusive ends; null is open). */
export function listWindow(
  range: ScheduleRange,
  today: string,
  customFrom: string,
  customTo: string
): { from: string | null; to: string | null } {
  switch (range) {
    case "upcoming":
      return { from: today, to: null };
    case "today":
      return { from: today, to: today };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 1) };
    case "7d":
      return { from: today, to: addDays(today, 7) };
    case "month":
      return { from: monthStart(today), to: monthEnd(today) };
    case "past":
      return { from: null, to: addDays(today, -1) };
    case "custom":
      return { from: customFrom || null, to: customTo || null };
    default:
      return { from: null, to: null };
  }
}

/**
 * What the server loads for a query, from the UTC date: the list's window
 * for any "today" a day either side of it. Custom dates are absolute, so
 * they are loaded exactly.
 */
export function serverWindow(q: ScheduleQuery, utcToday: string): { lo: string | null; hi: string | null } {
  const u = utcToday;
  switch (q.range) {
    case "upcoming":
      return { lo: addDays(u, -1), hi: null };
    case "today":
      return { lo: addDays(u, -1), hi: addDays(u, 1) };
    case "tomorrow":
      return { lo: u, hi: addDays(u, 2) };
    case "7d":
      return { lo: addDays(u, -1), hi: addDays(u, 8) };
    case "month":
      return { lo: monthStart(addDays(u, -1)), hi: monthEnd(addDays(u, 1)) };
    case "past":
      return { lo: null, hi: u };
    case "custom":
      return { lo: q.from, hi: q.to };
    default:
      return { lo: null, hi: null };
  }
}
