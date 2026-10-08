import { addDays } from "./company-clock.ts";

/**
 * Which appointments Appointment Reports loads, the way Text Reports does
 * it (DECISIONS #146).
 *
 * The period rides in the address (`?range=7|90|all`, or `?from=…&to=…`
 * for a custom range) and the server loads only that window -- this page
 * used to load every appointment the company ever had and filter in the
 * browser, and always opened on the last 30 days. The window is worked
 * out from the company's today, which the server hands to the report, so
 * what it loads and what the report counts are one and the same, and no
 * clock is read while the page renders. Pure, so the page, the view and
 * the tests share it.
 */

export const APPOINTMENT_REPORT_PRESETS = [
  { key: "7", label: "Last 7 Days" },
  { key: "30", label: "Last 30 Days" },
  { key: "90", label: "Last 90 Days" },
  { key: "all", label: "All Time" },
] as const;

const DEFAULT_PRESET = "30";

/** The date filter's own state: a preset, or custom dates that win over it ("" where unset). */
export type AppointmentReportRange = { preset: string; from: string; to: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day from year 1000 on: "2026-02-31" and a half-typed "0002-01-15" are not. */
function day(v: unknown): string | null {
  return typeof v === "string" && DAY.test(v) && v >= "1000" && addDays(v, 0) === v ? v : null;
}

/** The address's period, kept only where it is what it should be; the last 30 days otherwise. */
export function appointmentReportRange(p: { range?: unknown; from?: unknown; to?: unknown }): AppointmentReportRange {
  const preset = APPOINTMENT_REPORT_PRESETS.find((x) => x.key === p.range)?.key ?? DEFAULT_PRESET;
  return { preset, from: day(p.from) ?? "", to: day(p.to) ?? "" };
}

/**
 * Whether a custom date is still being typed -- a year passes through
 * 0002-, 0020-, 0202- in the date box. Until it's a real day the report
 * asks for nothing and stays on the period it has.
 */
export function appointmentReportTyping(r: AppointmentReportRange): boolean {
  return (!!r.from && day(r.from) === null) || (!!r.to && day(r.to) === null);
}

/** The period as an address: "" for the default, else "?…" with only what applies. */
export function appointmentReportQuery(r: AppointmentReportRange): string {
  const params = new URLSearchParams();
  if (r.from || r.to) {
    if (r.from) params.set("from", r.from);
    if (r.to) params.set("to", r.to);
  } else if (r.preset !== DEFAULT_PRESET) {
    params.set("range", r.preset);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * The days a period covers, inclusive (a null start is open), on the
 * company's `today`: the server loads exactly these and the report counts
 * exactly these. Only appointments that have happened can have an
 * outcome -- a show rate that counted next week's bookings as "no result"
 * would drift down every time someone booked ahead -- so it never runs
 * past today, whatever the range says; a custom range running into next
 * month reports on the part of it that has been and gone.
 */
export function appointmentReportWindow(
  r: AppointmentReportRange,
  today: string
): { from: string | null; to: string } {
  const to = r.to && r.to < today ? r.to : today;
  if (r.from || r.to) return { from: r.from || null, to };
  if (r.preset === "all") return { from: null, to };
  return { from: addDays(today, -Number(r.preset)), to };
}
