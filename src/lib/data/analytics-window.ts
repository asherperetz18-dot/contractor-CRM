import type { DateWindow } from "./date-range.ts";

/**
 * The PostgREST or() filter that prefilters Marketing Analytics' leads
 * to a window: created in it, or won in it. A lead outside both bounds
 * can contribute nothing to the page -- every figure it draws starts
 * from createdInRange or wonInRange -- so it has no business in the
 * payload. Loose on purpose: the day bounds cover whole days in every
 * timezone the timestamp could render in, and the client still applies
 * withinWindow exactly (the SQL-prefilter / app-refilter pact, #008).
 */

/** The calendar day after a YYYY-MM-DD day. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
}

export function analyticsWindowOrFilter(win: DateWindow): string | null {
  const { from, to } = win;
  if (!from && !to) return null;
  // 'to' is inclusive as a day; as a timestamp bound that is "before
  // the next midnight", never "before the day's own midnight".
  const cap = to ? nextDay(to) : null;
  const clause = (col: string) => {
    if (from && cap) return `and(${col}.gte.${from},${col}.lt.${cap})`;
    if (from) return `${col}.gte.${from}`;
    return `${col}.lt.${cap}`;
  };
  return `${clause("created_at")},${clause("won_at")}`;
}
