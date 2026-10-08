import { addDays } from "./company-clock.ts";

/**
 * Which appointments Appointment Reports loads, the way Text Reports does
 * it (DECISIONS #146).
 *
 * The period rides in the address (`?range=7|90|all`, or `?from=…&to=…`
 * for a custom range) and the server loads only that window -- this page
 * used to load every appointment the company ever had and filter in the
 * browser, and always opened on the last 30 days. The report still
 * applies its own exact filter on the browser's own "today"; the server
 * only knows the UTC date, a day either side of it, so it loads a day
 * extra each way. Pure, so the page, the view and the tests share it.
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
 * The days the server loads, inclusive (null is open): every appointment
 * the report could show for any "today" a day either side of the UTC
 * date. Only appointments that have happened are reported, so nothing
 * after tomorrow comes, whatever the range says.
 */
export function appointmentReportServerWindow(
  r: AppointmentReportRange,
  utcToday: string
): { lo: string | null; hi: string } {
  const tomorrow = addDays(utcToday, 1);
  if (r.from || r.to) return { lo: r.from || null, hi: r.to && r.to < tomorrow ? r.to : tomorrow };
  if (r.preset === "all") return { lo: null, hi: tomorrow };
  return { lo: addDays(utcToday, -(Number(r.preset) + 1)), hi: tomorrow };
}
