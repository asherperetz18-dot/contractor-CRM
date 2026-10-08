import { addDays } from "./company-clock.ts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day from year 1000 on: "2026-02-31" and a half-typed "0002-01-15" are not. */
function day(v: unknown): string | null {
  return typeof v === "string" && DAY.test(v) && v >= "1000" && addDays(v, 0) === v ? v : null;
}

/**
 * The period Appointment Reports opens on. A link can carry a custom
 * range (`?from=YYYY-MM-DD&to=YYYY-MM-DD`, either end alone open on the
 * other side) -- the Daily Brief's Showed / No-show tile opens on the
 * days it counted. Anything else opens it as before, on the last 30 days.
 */
export function appointmentReportRange(p: { from?: unknown; to?: unknown }): {
  preset: string;
  from: string;
  to: string;
} {
  return { preset: "30", from: day(p.from) ?? "", to: day(p.to) ?? "" };
}
