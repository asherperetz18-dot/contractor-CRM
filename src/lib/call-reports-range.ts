import { isoDateInZone } from "./company-clock.ts";

/**
 * The days Call Reports' custom From / To boxes show: the period the page
 * loaded, read back off the instants in its address (`fromTs`, and `toTs`
 * for an end -- exclusive, the midnight after the last day). On the
 * company's calendar, so the server and the browser render the same
 * dates. An open end runs to `today`; all time has no first day ("").
 * Pure, so the page and the tests share it.
 */
export function callReportDays(
  fromIso: string | null,
  toIso: string | null,
  zone: string,
  today: string
): { from: string; to: string } {
  return {
    from: fromIso ? isoDateInZone(new Date(fromIso), zone) : "",
    to: toIso ? isoDateInZone(new Date(Date.parse(toIso) - 1), zone) : today,
  };
}
